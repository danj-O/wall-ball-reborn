import { parseSignalPayload, type SignalPayload } from './signaling.ts';

type ChannelKind = 'state' | 'events';

/** One browser-to-browser connection. The room relay is used only to exchange ICE signaling. */
export class DirectPeer {
  private readonly connection: RTCPeerConnection;
  private state: RTCDataChannel | null = null;
  private events: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private localCandidates: SignalPayload[] = [];
  private descriptionSent = false;
  private closed = false;
  private wasReady = false;
  private lastMessageAt = performance.now();
  private readonly role: 'host' | 'phone';
  private readonly signal: (message: SignalPayload) => void;
  private readonly message: (raw: string, kind: ChannelKind) => void;
  private readonly changed: () => void;
  private readonly failed: () => void;

  constructor(
    role: 'host' | 'phone',
    signal: (message: SignalPayload) => void,
    message: (raw: string, kind: ChannelKind) => void,
    changed: () => void,
    failed: () => void,
  ) {
    this.role = role;
    this.signal = signal;
    this.message = message;
    this.changed = changed;
    this.failed = failed;
    const stun = import.meta.env.VITE_CONTROLLER_STUN_URL?.trim() || 'stun:stun.l.google.com:19302';
    this.connection = new RTCPeerConnection({ iceServers: [{ urls: stun }] });
    this.connection.onicecandidate = event => {
      if (!this.closed && event.candidate) {
        const candidate = parseSignalPayload({ kind: 'candidate', candidate: event.candidate.toJSON() });
        if (candidate) {
          if (this.descriptionSent) this.signal(candidate);
          else this.localCandidates.push(candidate);
        }
      }
    };
    this.connection.ondatachannel = event => this.attach(event.channel);
    this.connection.onconnectionstatechange = () => {
      if (this.closed) return;
      if (this.connection.connectionState === 'failed' || this.connection.connectionState === 'closed') this.failed();
      else this.changed();
    };
  }

  get ready(): boolean { return this.state?.readyState === 'open' && this.events?.readyState === 'open'; }
  get buffered(): number { return (this.state?.bufferedAmount ?? 0) + (this.events?.bufferedAmount ?? 0); }
  silenceMs(now: number): number { return now - this.lastMessageAt; }

  async offer(): Promise<void> {
    if (this.role !== 'host' || this.closed) return;
    this.attach(this.connection.createDataChannel('state', { ordered: false }));
    this.attach(this.connection.createDataChannel('events'));
    await this.connection.setLocalDescription(await this.connection.createOffer());
    this.sendDescription();
  }

  async receive(signal: SignalPayload): Promise<void> {
    if (this.closed) return;
    if (signal.kind === 'candidate') {
      if (this.connection.remoteDescription) await this.connection.addIceCandidate(signal.candidate);
      else this.pendingCandidates.push(signal.candidate);
      return;
    }
    if ((this.role === 'phone' && signal.description.type !== 'offer') ||
        (this.role === 'host' && signal.description.type !== 'answer')) return;
    await this.connection.setRemoteDescription(signal.description);
    for (const candidate of this.pendingCandidates.splice(0)) {
      try { await this.connection.addIceCandidate(candidate); } catch { /* A stale ICE candidate is harmless. */ }
    }
    if (this.role === 'phone') {
      await this.connection.setLocalDescription(await this.connection.createAnswer());
      this.sendDescription();
    }
  }

  send(value: object, kind: ChannelKind): boolean {
    if (!this.ready) return false;
    const channel = kind === 'state' ? this.state : this.events;
    if (!channel || channel.bufferedAmount > (kind === 'state' ? 2048 : 16384)) return false;
    try { channel.send(JSON.stringify(value)); return true; } catch { return false; }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.onicecandidate = null;
    this.connection.ondatachannel = null;
    this.connection.onconnectionstatechange = null;
    this.state?.close(); this.events?.close();
    this.connection.close();
  }

  private sendDescription(): void {
    const description = this.connection.localDescription;
    if (description?.sdp && (description.type === 'offer' || description.type === 'answer')) {
      this.signal({ kind: 'description', description: { type: description.type, sdp: description.sdp } });
      this.descriptionSent = true;
      for (const candidate of this.localCandidates.splice(0)) this.signal(candidate);
    }
  }

  private attach(channel: RTCDataChannel): void {
    if (channel.label !== 'state' && channel.label !== 'events') { channel.close(); return; }
    const kind = channel.label;
    if (kind === 'state') this.state = channel;
    else this.events = channel;
    channel.onopen = () => {
      if (this.closed) return;
      this.wasReady ||= this.ready;
      if (this.ready) this.lastMessageAt = performance.now();
      this.changed();
    };
    channel.onclose = () => {
      if (this.closed) return;
      this.changed();
      if (this.wasReady) this.failed();
    };
    channel.onmessage = event => {
      if (!this.closed && typeof event.data === 'string') {
        this.lastMessageAt = performance.now();
        this.message(event.data, kind);
      }
    };
  }
}
