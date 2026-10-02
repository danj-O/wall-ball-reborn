import bundled from './phoneControlDefaults.json' with { type: 'json' };
import type { RemoteAction } from './protocol.ts';

export type PhoneControlLayout = {
  version: 1;
  move: { x: number; y: number; width: number; height: number; padSize: number };
  actions: Record<RemoteAction, { x: number; y: number; size: number }>;
};
export const PHONE_ACTIONS: readonly RemoteAction[] = ['wall', 'bomb', 'mega-bomb'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Shared with the Vite writer: reject incomplete, out-of-range or extra-shaped presets. */
export function validatePhoneLayout(value: unknown): PhoneControlLayout | null {
  if (!record(value) || value.version !== 1 || !record(value.move) || !record(value.actions)) return null;
  const move = value.move;
  if (!inRange(move.x, .13, .36) || !inRange(move.y, .25, .75) ||
      !inRange(move.width, .25, .48) || !inRange(move.height, .35, .88) ||
      !inRange(move.padSize, 80, 200) ||
      move.x - move.width / 2 < .01 || move.x + move.width / 2 > .49 ||
      move.y - move.height / 2 < .08 || move.y + move.height / 2 > .96) return null;
  const actions = {} as PhoneControlLayout['actions'];
  for (const id of PHONE_ACTIONS) {
    const action = value.actions[id];
    if (!record(action) || !inRange(action.x, .54, .96) || !inRange(action.y, .2, .8) ||
        !inRange(action.size, 54, 180)) return null;
    actions[id] = { x: action.x, y: action.y, size: action.size };
  }
  return { version: 1, move: { x: move.x, y: move.y, width: move.width, height: move.height,
    padSize: move.padSize }, actions };
}
export function defaultPhoneLayout(): PhoneControlLayout {
  const layout = validatePhoneLayout(bundled);
  if (!layout) throw new Error('Bundled phone control layout is invalid');
  return layout;
}
