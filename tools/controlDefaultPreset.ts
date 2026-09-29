import {
  CONTROL_IDS, CONTROL_SIZE_RANGE, FLOAT_RADIUS_RANGE, MOVE_AREA_RANGE, MOVE_INSET_RANGE,
  type ControlLayout,
} from '../src/input/controlSchema.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Accept only complete, bounded layout data. Never use a request value as a path. */
export function validateControlPreset(value: unknown): ControlLayout | null {
  if (!isRecord(value) || !isRecord(value.positions) || !isRecord(value.sizes) ||
      !isRecord(value.floatRadii) || !isRecord(value.moveAreas) || !isRecord(value.moveInsets)) return null;
  const positions = {} as ControlLayout['positions'];
  const sizes = {} as ControlLayout['sizes'];
  const floatRadii = {} as ControlLayout['floatRadii'];
  const moveAreas = {} as ControlLayout['moveAreas'];
  const moveInsets = {} as ControlLayout['moveInsets'];
  for (const id of CONTROL_IDS) {
    const point = value.positions[id];
    if (!isRecord(point) || !inRange(point.x, 0, 1) || !inRange(point.y, 0, 1) ||
        !inRange(value.sizes[id], CONTROL_SIZE_RANGE.min, CONTROL_SIZE_RANGE.max) ||
        !inRange(value.floatRadii[id], FLOAT_RADIUS_RANGE.min, FLOAT_RADIUS_RANGE.max)) return null;
    positions[id] = { x: point.x, y: point.y };
    sizes[id] = value.sizes[id];
    floatRadii[id] = value.floatRadii[id];
  }
  for (const id of ['red-move', 'blue-move'] as const) {
    if (!inRange(value.moveAreas[id], MOVE_AREA_RANGE.min, MOVE_AREA_RANGE.max) ||
        !inRange(value.moveInsets[id], MOVE_INSET_RANGE.min, MOVE_INSET_RANGE.max)) return null;
    moveAreas[id] = value.moveAreas[id];
    moveInsets[id] = value.moveInsets[id];
  }
  return { positions, sizes, floatRadii, moveAreas, moveInsets };
}
