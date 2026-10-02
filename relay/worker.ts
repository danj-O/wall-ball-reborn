import { DurableObject } from 'cloudflare:workers';
import { parseControllerMessage } from '../src/remote/protocol.ts';
import { parseSignalPayload } from '../src/remote/signaling.ts';
import type { Team } from '../src/game/arena.ts';

interface Env { ROOMS: DurableObjectNamespace<Room>; }
type Attachment = { role: 'host'; approved: false } | { role: 'phone'; seat: Team; approved: boolean };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = (): string => Array.from(crypto.getRandomValues(new Uint8Array(8)), n => CODE_CHARS[n % CODE_CHARS.length]).join('');
const reply = (socket: WebSocket, message: object): void => socket.send(JSON.stringify({ v: 1, ...message }));
const isTeam = (value: unknown): value is Team => value === 'red' || value === 'blue';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/rooms' && request.method === 'POST') {
      for (let tries = 0; tries < 5; tries++) {
        const code = roomCode();
        const token = crypto.randomUUID();
        const room = env.ROOMS.getByName(code);
        const response = await room.fetch(new Request('https://room/create', { method: 'POST', headers: { 'X-Host-Token': token } }));
        if (response.status === 409) continue;
        if (!response.ok) return new Response('Could not create room', { status: 500 });
        return Response.json({ code, token }, { headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      return new Response('Could not allocate room', { status: 503 });
    }
    if (url.pathname === '/rooms' && request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    }
    const match = /^\/rooms\/([A-HJ-NP-Z2-9]{8})\/ws$/.exec(url.pathname);
    if (!match || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Not found', { status: 404 });
    return env.ROOMS.getByName(match[1]).fetch(request);
  },
};

export class Room extends DurableObject<Env> {
  private host(): WebSocket | undefined {
    return this.ctx.getWebSockets().find(socket => (socket.deserializeAttachment() as Attachment | null)?.role === 'host');
  }
  private phone(seat: Team): WebSocket | undefined {
    return this.ctx.getWebSockets().find(socket => {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      return attachment?.role === 'phone' && attachment.seat === seat;
    });
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/create') {
      if (this.host() || await this.ctx.storage.get('token')) return new Response('Room exists', { status: 409 });
      const token = request.headers.get('X-Host-Token');
      if (!token) return new Response('Missing token', { status: 400 });
      await this.ctx.storage.put('token', token);
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return new Response(null, { status: 204 });
    }
    const role = url.searchParams.get('role');
    if (role !== 'host' && role !== 'phone') return new Response('Invalid role', { status: 400 });
    const token = await this.ctx.storage.get<string>('token');
    if (!token) return new Response('Room expired', { status: 404 });
    if (role === 'host' && (url.searchParams.get('token') !== token || this.host())) {
      return new Response('Host unauthorized or already connected', { status: 403 });
    }
    const seat = url.searchParams.get('seat');
    if (role === 'phone' && (!isTeam(seat) || !this.host() || this.phone(seat))) {
      return new Response('Host unavailable or seat occupied', { status: 409 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if (role === 'host') server.serializeAttachment({ role: 'host', approved: false } satisfies Attachment);
    else {
      server.serializeAttachment({ role: 'phone', seat: seat as Team, approved: false } satisfies Attachment);
      reply(this.host()!, { type: 'join-request', seat });
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > 20000) return;
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    let value: unknown;
    try { value = JSON.parse(data); } catch { return; }
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    if (message.v !== 1 || typeof message.type !== 'string') return;
    if (message.type === 'keepalive') return;
    if (attachment.role === 'host') {
      if (!isTeam(message.seat)) return;
      const phone = this.phone(message.seat);
      if (!phone) return;
      const phoneState = phone.deserializeAttachment() as Attachment | null;
      if (message.type === 'approve' && phoneState?.role === 'phone' && !phoneState.approved) {
        phone.serializeAttachment({ role: 'phone', seat: message.seat, approved: true } satisfies Attachment);
        reply(socket, { type: 'joined', seat: message.seat });
        reply(phone, { type: 'joined', team: message.seat });
      } else if (message.type === 'reject' && phoneState?.role === 'phone' && !phoneState.approved) {
        reply(phone, { type: 'error', reason: 'Host declined the request' });
        phone.close(1000, 'Host declined');
      } else if (message.type === 'remove-seat' && phoneState?.role === 'phone' && phoneState.approved) {
        // Free this seat immediately so a replacement can join the same room.
        phone.serializeAttachment(null);
        reply(phone, { type: 'removed' });
        phone.close(1000, 'Host disconnected this controller');
        reply(socket, { type: 'peer-left', seat: message.seat, final: true });
      } else if (message.type === 'signal' && phoneState?.role === 'phone' && phoneState.approved) {
        const signal = parseSignalPayload(message.payload);
        if (signal?.kind === 'candidate' || signal?.description.type === 'offer') {
          reply(phone, { type: 'signal', seat: message.seat, payload: signal });
        }
      } else if (message.type === 'to-seat' && phoneState?.role === 'phone' && phoneState.approved &&
          message.payload && typeof message.payload === 'object') {
        const payload = message.payload as Record<string, unknown>;
        if (payload.v !== 1 || (payload.type !== 'status' && payload.type !== 'feedback' && payload.type !== 'ping')) return;
        if (payload.type === 'status' && payload.team !== message.seat) return;
        const encoded = JSON.stringify(payload);
        if (encoded.length <= 1024) phone.send(encoded);
      }
    } else if (message.type === 'leave') {
      socket.serializeAttachment(null);
      socket.close(1000, 'Controller left');
      const host = this.host();
      if (host) reply(host, { type: 'peer-left', seat: attachment.seat, final: true });
    } else if (attachment.approved) {
      const host = this.host();
      if (host && message.type === 'signal') {
        const signal = parseSignalPayload(message.payload);
        if (signal?.kind === 'candidate' || signal?.description.type === 'answer') {
          reply(host, { type: 'signal', seat: attachment.seat, payload: signal });
        }
        return;
      }
      const input = parseControllerMessage(data);
      if (host && input) reply(host, { type: 'input', seat: attachment.seat, payload: input });
    }
  }
  async webSocketClose(socket: WebSocket): Promise<void> { await this.left(socket); }
  async webSocketError(socket: WebSocket): Promise<void> { await this.left(socket); }
  async alarm(): Promise<void> { if (!this.host()) await this.ctx.storage.delete('token'); }
  private async left(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    socket.serializeAttachment(null);
    if (attachment.role === 'host') {
      await this.ctx.storage.delete('token');
      for (const seat of ['red', 'blue'] as const) {
        const phone = this.phone(seat);
        if (phone) { reply(phone, { type: 'peer-left' }); phone.close(1000, 'Host left'); }
      }
    } else {
      const host = this.host();
      if (host) reply(host, { type: 'peer-left', seat: attachment.seat });
    }
  }
}
