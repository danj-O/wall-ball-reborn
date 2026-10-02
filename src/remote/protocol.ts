import type { Team } from '../game/arena.ts';

export const CONTROLLER_PROTOCOL_VERSION = 1;
export type RemoteAction = 'wall' | 'bomb' | 'mega-bomb';
export type StateMessage =
  | { v: 1; type: 'move'; x: number; y: number; seq: number }
  | { v: 1; type: 'aim'; id: RemoteAction; x: number; y: number; strength: number; seq: number };
export type EventMessage =
  | { v: 1; type: 'action'; id: RemoteAction; phase: 'start' | 'release' | 'cancel'; x: number; y: number; strength: number; seq: number }
  | { v: 1; type: 'moveStop'; seq: number; moveSeq: number }
  | { v: 1; type: 'heartbeat'; seq: number }
  | { v: 1; type: 'ping' | 'pong'; stamp: number };
export type ControllerMessage = StateMessage | EventMessage;
export type ControllerStatus = {
  v: 1; type: 'status'; team: Team; phase: 'ready' | 'playing' | 'finished';
  wall: number; bomb: number; mega: number; carrying: boolean; shield: boolean; speed: boolean;
};

const actions = new Set<RemoteAction>(['wall', 'bomb', 'mega-bomb']);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sequence = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parseControllerMessage(raw: unknown): ControllerMessage | null {
  if (typeof raw !== 'string' || raw.length > 1024) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!object(value) || value.v !== CONTROLLER_PROTOCOL_VERSION || typeof value.type !== 'string') return null;
  if (value.type === 'ping' || value.type === 'pong') {
    return finite(value.stamp) ? { v: 1, type: value.type, stamp: value.stamp } : null;
  }
  if (!sequence(value.seq)) return null;
  if (value.type === 'heartbeat') return { v: 1, type: 'heartbeat', seq: value.seq };
  if (value.type === 'moveStop') return sequence(value.moveSeq)
    ? { v: 1, type: 'moveStop', seq: value.seq, moveSeq: value.moveSeq } : null;
  if (value.type === 'move') {
    if (!finite(value.x) || !finite(value.y)) return null;
    const length = Math.max(1, Math.hypot(value.x, value.y));
    return { v: 1, type: 'move', x: clamp(value.x / length, -1, 1), y: clamp(value.y / length, -1, 1), seq: value.seq };
  }
  if ((value.type === 'aim' || value.type === 'action') && actions.has(value.id as RemoteAction) &&
      finite(value.x) && finite(value.y) && finite(value.strength)) {
    const length = Math.max(1, Math.hypot(value.x, value.y));
    const common = { v: 1 as const, id: value.id as RemoteAction, x: clamp(value.x / length, -1, 1),
      y: clamp(value.y / length, -1, 1), strength: clamp(value.strength, 0, 1), seq: value.seq };
    if (value.type === 'aim') return { ...common, type: 'aim' };
    if (value.phase === 'start' || value.phase === 'release' || value.phase === 'cancel') {
      return { ...common, type: 'action', phase: value.phase };
    }
  }
  return null;
}

export function controllerStatus(team: Team, phase: ControllerStatus['phase'], wall: number, bomb: number,
  mega: number, carrying: boolean, shield: boolean, speed: boolean): ControllerStatus {
  return { v: 1, type: 'status', team, phase, wall, bomb, mega, carrying, shield, speed };
}
