import mobileControlDefaults from './mobileControlDefaults.json' with { type: 'json' };
import {
  CONTROL_IDS, CONTROL_SIZE_RANGE, FLOAT_RADIUS_RANGE, MOVE_AREA_RANGE, MOVE_INSET_RANGE,
  type ControlLayout, type NormalizedPoint,
} from './controlSchema.ts';
export {
  CONTROL_IDS, CONTROL_SIZE_RANGE, FLOAT_RADIUS_RANGE, MOVE_AREA_RANGE, MOVE_INSET_RANGE,
  type AbilitySlot, type ControlId, type ControlLayout, type NormalizedPoint,
} from './controlSchema.ts';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function clampControlPosition(point: NormalizedPoint, padSize: number, width: number, height: number): NormalizedPoint {
  const insetX = Math.min(0.5, (padSize / 2 + 4) / Math.max(1, width));
  const insetY = Math.min(0.5, (padSize / 2 + 4) / Math.max(1, height));
  return { x: clamp(point.x, insetX, 1 - insetX), y: clamp(point.y, insetY, 1 - insetY) };
}

function generatedControlLayout(width: number, height: number): ControlLayout {
  const moveSize = 110;
  const actionSize = 78;
  const moveInset = moveSize / 2 + 12;
  const actionInset = actionSize / 2 + 12;
  const gap = actionSize + 10;
  const point = (x: number, y: number, size: number) => clampControlPosition({ x: x / width, y: y / height }, size, width, height);
  return {
    moveAreas: { 'red-move': 320, 'blue-move': 320 },
    moveInsets: { 'red-move': 6, 'blue-move': 6 },
    sizes: { 'red-move': moveSize, 'red-wall': actionSize, 'red-bomb': actionSize,
      'red-ability-1': 62, 'red-ability-2': 62,
      'blue-move': moveSize, 'blue-wall': actionSize, 'blue-bomb': actionSize,
      'blue-ability-1': 62, 'blue-ability-2': 62 },
    floatRadii: { 'red-move': 70, 'red-wall': 52, 'red-bomb': 52,
      'red-ability-1': 48, 'red-ability-2': 48,
      'blue-move': 70, 'blue-wall': 52, 'blue-bomb': 52,
      'blue-ability-1': 48, 'blue-ability-2': 48 },
    positions: {
      'red-move': point(moveInset, moveInset, moveSize),
      'red-wall': point(actionInset, height - actionInset, actionSize),
      'red-bomb': point(actionInset + gap, height - actionInset, actionSize),
      'red-ability-1': point(actionInset + gap / 2, height - actionInset - 74, 62),
      'red-ability-2': point(actionInset + gap * 1.35, height - actionInset - 74, 62),
      'blue-move': point(width - moveInset, height - moveInset, moveSize),
      'blue-wall': point(width - actionInset, actionInset, actionSize),
      'blue-bomb': point(width - actionInset - gap, actionInset, actionSize),
      'blue-ability-1': point(width - actionInset - gap / 2, actionInset + 74, 62),
      'blue-ability-2': point(width - actionInset - gap * 1.35, actionInset + 74, 62),
    },
  };
}

export function defaultControlLayout(width: number, height: number): ControlLayout {
  return normalizeAgainst(mobileControlDefaults, generatedControlLayout(width, height));
}

export function normalizeControlLayout(saved: unknown, width: number, height: number): ControlLayout {
  return normalizeAgainst(saved, defaultControlLayout(width, height));
}

function normalizeAgainst(saved: unknown, fallback: ControlLayout): ControlLayout {
  if (!saved || typeof saved !== 'object') return fallback;
  const data = saved as Partial<ControlLayout> & { padSize?: number; floatRadius?: number };
  const legacySize = Number.isFinite(data.padSize) ? Number(data.padSize) : undefined;
  const legacyRadius = Number.isFinite(data.floatRadius) ? Number(data.floatRadius) : undefined;
  const sizes = { ...fallback.sizes };
  const floatRadii = { ...fallback.floatRadii };
  const moveAreas = { ...fallback.moveAreas };
  const moveInsets = { ...fallback.moveInsets };
  const positions = { ...fallback.positions };
  for (const id of CONTROL_IDS) {
    sizes[id] = clamp(Number.isFinite(data.sizes?.[id]) ? Number(data.sizes?.[id]) : legacySize ?? sizes[id],
      CONTROL_SIZE_RANGE.min, CONTROL_SIZE_RANGE.max);
    floatRadii[id] = clamp(Number.isFinite(data.floatRadii?.[id]) ? Number(data.floatRadii?.[id]) : legacyRadius ?? floatRadii[id],
      FLOAT_RADIUS_RANGE.min, FLOAT_RADIUS_RANGE.max);
    const p = data.positions?.[id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
  }
  for (const id of ['red-move', 'blue-move'] as const) {
    moveAreas[id] = clamp(Number.isFinite(data.moveAreas?.[id]) ? Number(data.moveAreas?.[id]) : moveAreas[id], MOVE_AREA_RANGE.min, MOVE_AREA_RANGE.max);
    moveInsets[id] = clamp(Number.isFinite(data.moveInsets?.[id]) ? Number(data.moveInsets?.[id]) : moveInsets[id], MOVE_INSET_RANGE.min, MOVE_INSET_RANGE.max);
  }
  return { positions, sizes, floatRadii, moveAreas, moveInsets };
}

export function movementZoneRect(point: NormalizedPoint, areaSize: number, inset: number, width: number, height: number) {
  const areaWidth = Math.min(areaSize, width * 0.45);
  const areaHeight = Math.min(areaSize * 0.7, height * 0.48);
  return {
    left: clamp(point.x * width - areaWidth / 2, inset, Math.max(inset, width - areaWidth - inset)),
    top: clamp(point.y * height - areaHeight / 2, inset, Math.max(inset, height - areaHeight - inset)),
    width: areaWidth,
    height: areaHeight,
  };
}
