import type { Team, Vec2 } from '../game/arena.ts';
import type { RemoteAction, ControllerMessage } from './protocol.ts';

export const REMOTE_INPUT_TIMEOUT_MS = 650;
type Callbacks = {
  toWorld(x: number, y: number): Vec2;
  move(team: Team, value: Vec2): void;
  start(team: Team, id: RemoteAction): void;
  aim(team: Team, id: RemoteAction, direction: Vec2, strength: number): void;
  release(team: Team, id: RemoteAction): void;
  cancel(team: Team, id: RemoteAction): void;
};

/** Converts remote control intent into the same game commands used by local controls. */
export class RemoteInput {
  private team: Team | null = null;
  private lastSeen = 0;
  private readonly lastSequence = new Map<string, number>();
  private readonly active = new Set<RemoteAction>();
  private stale = false;
  private readonly callbacks: Callbacks;
  dropped = 0;
  received = 0;

  constructor(callbacks: Callbacks) { this.callbacks = callbacks; }
  get owner(): Team | null { return this.team; }
  owns(team: Team): boolean { return this.team === team; }
  connect(team: Team, now: number): void {
    this.disconnect();
    this.team = team;
    this.lastSeen = now;
    this.stale = false;
    this.lastSequence.clear();
    this.dropped = 0;
    this.received = 0;
  }
  disconnect(): void {
    if (this.team) {
      this.callbacks.move(this.team, { x: 0, z: 0 });
      for (const id of this.active) this.callbacks.cancel(this.team, id);
    }
    this.active.clear();
    this.stale = false;
    this.team = null;
    this.lastSequence.clear();
  }
  age(now: number): number { return this.team ? Math.max(0, now - this.lastSeen) : 0; }
  timedOut(now: number): boolean { return !!this.team && !this.stale && this.age(now) > REMOTE_INPUT_TIMEOUT_MS; }
  expire(now: number): boolean {
    if (!this.timedOut(now)) return false;
    // Neutralize held controls after a short silence, but keep the room and its
    // sequence history. Mobile browsers can pause timers briefly while active.
    const team = this.team!;
    this.callbacks.move(team, { x: 0, z: 0 });
    for (const id of this.active) this.callbacks.cancel(team, id);
    this.active.clear();
    this.stale = true;
    return true;
  }

  receive(message: ControllerMessage, now: number): void {
    const team = this.team;
    if (!team || 'stamp' in message) return;
    const key = message.type === 'aim' ? `aim:${message.id}` : message.type === 'action' ? 'events' : message.type;
    if (message.seq <= (this.lastSequence.get(key) ?? -1)) { this.dropped++; return; }
    this.lastSequence.set(key, message.seq);
    this.lastSeen = now;
    this.stale = false;
    this.received++;
    if (message.type === 'heartbeat') return;
    if (message.type === 'moveStop') {
      if (message.moveSeq >= (this.lastSequence.get('move') ?? -1)) this.callbacks.move(team, { x: 0, z: 0 });
      return;
    }
    if (message.type === 'move') {
      const magnitude = Math.min(1, Math.hypot(message.x, message.y));
      const direction = this.callbacks.toWorld(message.x, message.y);
      this.callbacks.move(team, { x: direction.x * magnitude, z: direction.z * magnitude });
      return;
    }
    const direction = this.callbacks.toWorld(message.x, message.y);
    if (message.type === 'aim') {
      if (this.active.has(message.id)) this.callbacks.aim(team, message.id, direction, message.strength);
      return;
    }
    if (message.phase === 'start') {
      if (this.active.has(message.id)) return;
      this.active.add(message.id);
      this.callbacks.start(team, message.id);
      this.callbacks.aim(team, message.id, direction, message.strength);
    } else if (this.active.delete(message.id)) {
      if (message.phase === 'release') {
        this.callbacks.aim(team, message.id, direction, message.strength);
        this.callbacks.release(team, message.id);
      } else this.callbacks.cancel(team, message.id);
    }
  }
}
