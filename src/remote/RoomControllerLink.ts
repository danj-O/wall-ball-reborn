import type { Team } from '../game/arena.ts';
import { parseControllerMessage, type ControllerMessage, type ControllerStatus, type EventMessage, type StateMessage } from './protocol.ts';
import { DirectPeer } from './DirectPeer.ts';
import { parseSignalPayload, type SignalPayload } from './signaling.ts';

type LinkStatus = 'NEW' | 'CREATING ROOM' | 'WAITING FOR PHONE' | 'WAITING FOR HOST' | 'CONNECTING' | 'CONNECTED' | 'DIRECT ONLY' | 'DISCONNECTED' | 'FAILED';
type Callbacks = { status(value: LinkStatus): void; connected(team: Team): void; disconnected(team: Team): void };
export type LinkDiagnostics = { connection: string; transport: 'DIRECT' | 'RELAY'; rttMs: number | null;
  buffered: number; received: number; sent: number };

export function relayUrl(): string {
  const configured = import.meta.env.VITE_CONTROLLER_RELAY_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return import.meta.env.DEV ? `ws://${location.hostname}:8787` : '';
}
export function normalizeRoomCode(value: string): string { return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8); }

/** One host socket owns a room; each phone joins one independently approved seat. */
export class RoomControllerLink {
  readonly role: 'host' | 'phone';
  private callbacks: Callbacks;
  private socket: WebSocket | null = null;
  private team: Team | null = null;
  private seats = new Set<Team>();
  private received = 0;
  private sent = 0;
  private pingAt: Record<Team, number> = { red: 0, blue: 0 };
  private rttMs: Record<Team, number | null> = { red: null, blue: null };
  private peers: Record<Team, DirectPeer | null> = { red: null, blue: null };
  private retryTimers: Record<Team, number | null> = { red: null, blue: null };
  private directAttempts: Record<Team, number> = { red: 0, blue: 0 };
  private lastRelayKeepalive = 0;
  private generation = 0;
  failureReason = '';
  onInput: (team: Team, message: ControllerMessage) => void = () => {};
  onControllerStatus: (status: ControllerStatus) => void = () => {};
  onFeedback: (kind: string) => void = () => {};
  onJoinRequest: (team: Team, pending: boolean) => void = () => {};

  constructor(role: 'host' | 'phone', callbacks: Callbacks) { this.role = role; this.callbacks = callbacks; }
  get assignedTeam(): Team | null { return this.team; }
  get isConnected(): boolean { return this.role === 'phone' ? this.team !== null : this.seats.size > 0; }
  isSeatConnected(team: Team): boolean { return this.seats.has(team); }

  async createRoom(): Promise<string> {
    const relay = relayUrl();
    if (!relay) throw new Error('Relay URL is not configured for this build');
    this.disconnect();
    this.failureReason = '';
    this.callbacks.status('CREATING ROOM');
    const url = new URL(relay);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/rooms`;
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) throw new Error(`Room service returned HTTP ${response.status}`);
    const room: unknown = await response.json();
    if (!room || typeof room !== 'object' || !('code' in room) || !('token' in room) ||
        typeof room.code !== 'string' || typeof room.token !== 'string') throw new Error('Invalid room response');
    await this.open(room.code, 'host', undefined, room.token);
    return room.code;
  }

  async joinRoom(codeInput: string, seat: Team): Promise<void> {
    const code = normalizeRoomCode(codeInput);
    if (code.length !== 8) throw new Error('Enter the 8-character room code');
    this.disconnect();
    this.failureReason = '';
    this.callbacks.status('CONNECTING');
    await this.open(code, 'phone', seat);
  }

  private open(code: string, role: 'host' | 'phone', seat?: Team, token?: string): Promise<void> {
    const relay = relayUrl();
    if (!relay) return Promise.reject(new Error('Relay URL is not configured for this build'));
    const url = new URL(relay);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/rooms/${code}/ws`;
    url.searchParams.set('role', role);
    if (seat) url.searchParams.set('seat', seat);
    if (token) url.searchParams.set('token', token);
    const generation = ++this.generation;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let opened = false;
      const timeout = window.setTimeout(() => {
        if (this.socket !== socket || opened) return;
        reject(new Error('Room connection timed out'));
        this.disconnect();
      }, 10000);
      socket.onopen = () => {
        if (this.generation !== generation) return;
        opened = true;
        window.clearTimeout(timeout);
        this.callbacks.status(role === 'host' ? 'WAITING FOR PHONE' : 'WAITING FOR HOST');
        resolve();
      };
      socket.onerror = () => { if (!opened) { window.clearTimeout(timeout); reject(new Error('Could not reach room relay')); } };
      socket.onclose = event => {
        if (this.socket !== socket) return;
        window.clearTimeout(timeout);
        if (!opened) reject(new Error(event.reason || 'Room unavailable or seat occupied'));
        this.socket = null;
        this.handleRelayClose();
        if (event.reason) {
          this.failureReason = event.reason;
          if (!this.isConnected) this.callbacks.status(event.code === 1000 ? 'DISCONNECTED' : 'FAILED');
        }
      };
      socket.onmessage = event => this.receive(event.data);
    });
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > 20000) return;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return; }
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    if (message.v !== 1 || typeof message.type !== 'string') return;
    this.received++;
    if (message.type === 'error' && typeof message.reason === 'string') {
      this.failureReason = message.reason;
      this.callbacks.status('FAILED');
      return;
    }
    if (message.type === 'signal' && (message.seat === 'red' || message.seat === 'blue')) {
      const signal = parseSignalPayload(message.payload);
      if (signal && (this.role === 'host' ? this.seats.has(message.seat) : this.team === message.seat)) {
        void this.receiveSignal(message.seat, signal);
      }
      return;
    }
    if (this.role === 'host') {
      if (message.seat !== 'red' && message.seat !== 'blue') return;
      const seat = message.seat;
      if (message.type === 'join-request') { this.onJoinRequest(seat, true); return; }
      if (message.type === 'joined') {
        if (this.seats.has(seat)) return;
        this.seats.add(seat);
        this.onJoinRequest(seat, false);
        this.callbacks.connected(seat);
        this.callbacks.status('CONNECTED');
        this.startDirect(seat);
        return;
      }
      if (message.type === 'peer-left') {
        if (this.peers[seat]?.ready) return;
        this.closeDirect(seat);
        this.onJoinRequest(seat, false);
        if (this.seats.delete(seat)) this.callbacks.disconnected(seat);
        this.callbacks.status(this.seats.size ? 'CONNECTED' : 'WAITING FOR PHONE');
        return;
      }
      if (message.type === 'input' && this.seats.has(seat)) {
        const input = parseControllerMessage(JSON.stringify(message.payload));
        if (!input) return;
        if (input.type === 'pong') { this.rttMs[seat] = performance.now() - input.stamp; return; }
        this.onInput(seat, input);
      }
      return;
    }
    if (message.type === 'joined' && (message.team === 'red' || message.team === 'blue')) {
      this.team = message.team;
      this.callbacks.status('CONNECTED');
      this.callbacks.connected(message.team);
      return;
    }
    if (message.type === 'peer-left') {
      if (this.team && this.peers[this.team]?.ready) return;
      if (this.team) { const old = this.team; this.closeDirect(old); this.team = null; this.callbacks.disconnected(old); }
      this.callbacks.status('DISCONNECTED');
      return;
    }
    if (!this.team) return;
    if (message.type === 'ping' && typeof message.stamp === 'number') {
      this.sendRaw({ v: 1, type: 'pong', stamp: message.stamp });
    } else if (message.type === 'status' && message.team === this.team) {
      this.onControllerStatus(message as ControllerStatus);
    } else if (message.type === 'feedback' && typeof message.kind === 'string') this.onFeedback(message.kind);
  }

  approveJoin(team: Team): void { if (this.role === 'host') this.sendRaw({ v: 1, type: 'approve', seat: team }); }
  rejectJoin(team: Team): void { if (this.role === 'host') this.sendRaw({ v: 1, type: 'reject', seat: team }); }
  private sendRaw(message: unknown, maxBuffer = Number.POSITIVE_INFINITY): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > maxBuffer) return false;
    this.socket.send(JSON.stringify(message)); this.sent++; return true;
  }
  sendState(message: StateMessage): boolean {
    if (this.role !== 'phone' || !this.isConnected) return false;
    if (this.team && this.peers[this.team]?.send(message, 'state')) { this.sent++; return true; }
    return this.sendRaw(message, 2048);
  }
  sendEvent(message: EventMessage | ControllerStatus | { v: 1; type: 'feedback'; kind: string }, seat?: Team): boolean {
    const target = this.role === 'phone' ? this.team : seat;
    if (!target || (this.role === 'host' && !this.seats.has(target))) return false;
    if (this.peers[target]?.send(message, 'events')) { this.sent++; return true; }
    return this.role === 'phone' ? this.sendRaw(message) : this.sendRaw({ v: 1, type: 'to-seat', seat: target, payload: message });
  }
  heartbeat(seq: number): void {
    if (this.team) this.checkDirectSilence(this.team, performance.now());
    this.keepRelayAlive(performance.now());
    this.sendEvent({ v: 1, type: 'heartbeat', seq });
  }
  ping(now: number, seat: Team): void {
    this.checkDirectSilence(seat, now);
    this.keepRelayAlive(now);
    if (now - this.pingAt[seat] < 1000) return;
    this.pingAt[seat] = now;
    this.sendEvent({ v: 1, type: 'ping', stamp: now }, seat);
  }
  async diagnostics(seat?: Team): Promise<LinkDiagnostics> {
    const target = seat ?? this.team;
    const direct = target ? !!this.peers[target]?.ready : false;
    return { connection: this.socket?.readyState === WebSocket.OPEN ? (seat ? this.seats.has(seat) ? 'connected' : 'waiting' : this.isConnected ? 'connected' : 'waiting') : 'closed',
      transport: direct ? 'DIRECT' : 'RELAY',
      rttMs: seat ? this.rttMs[seat] : this.team ? this.rttMs[this.team] : null,
      buffered: direct && target ? this.peers[target]?.buffered ?? 0 : this.socket?.bufferedAmount ?? 0,
      received: this.received, sent: this.sent };
  }
  disconnect(): void {
    ++this.generation;
    for (const seat of ['red', 'blue'] as const) this.closeDirect(seat);
    const active = [...this.seats];
    const phoneTeam = this.team;
    this.seats.clear(); this.team = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    for (const seat of active) this.callbacks.disconnected(seat);
    if (phoneTeam) this.callbacks.disconnected(phoneTeam);
    for (const seat of ['red', 'blue'] as const) if (this.role === 'host') this.onJoinRequest(seat, false);
    if (socket) this.callbacks.status('DISCONNECTED');
  }

  private startDirect(seat: Team): void {
    if (this.role !== 'host' || !this.seats.has(seat) || typeof RTCPeerConnection === 'undefined') return;
    this.closeDirect(seat);
    let peer: DirectPeer;
    try { peer = this.makePeer(seat); }
    catch { return; /* Browser WebRTC setup failed; the room relay remains usable. */ }
    void peer.offer().catch(() => this.directFailed(seat, peer));
    this.retryTimers[seat] = window.setTimeout(() => {
      if (this.peers[seat] === peer && !peer.ready) this.directFailed(seat, peer);
    }, 12000);
  }

  private makePeer(seat: Team): DirectPeer {
    const peer = new DirectPeer(this.role,
      signal => this.sendRaw({ v: 1, type: 'signal', seat, payload: signal }),
      (raw, kind) => this.receiveDirect(seat, raw, kind),
      () => { if (peer.ready) this.directAttempts[seat] = 0; },
      () => this.directFailed(seat, peer));
    this.peers[seat] = peer;
    return peer;
  }

  private async receiveSignal(seat: Team, signal: SignalPayload): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    if (this.role === 'phone' && signal.kind === 'description' && signal.description.type === 'offer') {
      this.closeDirect(seat);
      try { this.makePeer(seat); }
      catch { return; /* Keep the approved relay path. */ }
    }
    const peer = this.peers[seat];
    if (!peer) return;
    try { await peer.receive(signal); }
    catch { this.directFailed(seat, peer); }
  }

  private receiveDirect(seat: Team, raw: string, kind: 'state' | 'events'): void {
    if (raw.length > 1024 || !this.peers[seat]?.ready) return;
    this.received++;
    if (this.role === 'host') {
      if (!this.seats.has(seat)) return;
      const message = parseControllerMessage(raw);
      if (!message || ((message.type === 'move' || message.type === 'aim') !== (kind === 'state'))) return;
      if (message.type === 'pong') { this.rttMs[seat] = performance.now() - message.stamp; return; }
      this.onInput(seat, message);
      return;
    }
    if (this.team !== seat || kind !== 'events') return;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return; }
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    if (message.v !== 1) return;
    if (message.type === 'ping' && typeof message.stamp === 'number') {
      this.sendEvent({ v: 1, type: 'pong', stamp: message.stamp });
    } else if (message.type === 'status' && message.team === seat) {
      this.onControllerStatus(message as ControllerStatus);
    } else if (message.type === 'feedback' && typeof message.kind === 'string') this.onFeedback(message.kind);
  }

  private directFailed(seat: Team, peer: DirectPeer): void {
    if (this.peers[seat] !== peer) return;
    this.closeDirect(seat);
    if (this.role === 'host' && this.seats.has(seat) && this.socket?.readyState === WebSocket.OPEN) {
      const delay = Math.min(30000, 3000 * 2 ** Math.min(this.directAttempts[seat]++, 4));
      this.retryTimers[seat] = window.setTimeout(() => this.startDirect(seat), delay);
    } else if (this.socket?.readyState !== WebSocket.OPEN) this.dropSeat(seat);
  }

  private closeDirect(seat: Team): void {
    if (this.retryTimers[seat] !== null) window.clearTimeout(this.retryTimers[seat]!);
    this.retryTimers[seat] = null;
    this.peers[seat]?.close();
    this.peers[seat] = null;
    this.rttMs[seat] = null;
  }

  private checkDirectSilence(seat: Team, now: number): void {
    const peer = this.peers[seat];
    if (peer?.ready && peer.silenceMs(now) > 1500) this.directFailed(seat, peer);
  }

  private keepRelayAlive(now: number): void {
    if (!this.isConnected || now - this.lastRelayKeepalive < 15000 ||
        this.socket?.readyState !== WebSocket.OPEN) return;
    const direct = this.role === 'phone' ? !!this.team && !!this.peers[this.team]?.ready :
      [...this.seats].some(seat => this.peers[seat]?.ready);
    if (direct && this.sendRaw({ v: 1, type: 'keepalive' })) this.lastRelayKeepalive = now;
  }

  private handleRelayClose(): void {
    for (const seat of ['red', 'blue'] as const) {
      if (!this.peers[seat]?.ready) this.dropSeat(seat);
      if (this.role === 'host') this.onJoinRequest(seat, false);
    }
    this.callbacks.status(this.isConnected ? 'DIRECT ONLY' : 'DISCONNECTED');
  }

  private dropSeat(seat: Team): void {
    this.closeDirect(seat);
    if (this.role === 'host' && this.seats.delete(seat)) this.callbacks.disconnected(seat);
    if (this.role === 'phone' && this.team === seat) {
      this.team = null;
      this.callbacks.disconnected(seat);
    }
    if (!this.isConnected) this.callbacks.status('DISCONNECTED');
  }
}
