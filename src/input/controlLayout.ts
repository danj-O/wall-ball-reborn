export type ControlId = 'red-move' | 'red-wall' | 'red-bomb' | 'blue-move' | 'blue-wall' | 'blue-bomb';
export type NormalizedPoint = { x: number; y: number };
export type ControlLayout = {
  positions: Record<ControlId, NormalizedPoint>;
  sizes: Record<ControlId, number>;
  floatRadii: Record<ControlId, number>;
};

export const CONTROL_IDS: readonly ControlId[] = [
  'red-move', 'red-wall', 'red-bomb', 'blue-move', 'blue-wall', 'blue-bomb',
];
export const CONTROL_SIZE_RANGE = { min: 56, max: 220 } as const;
export const FLOAT_RADIUS_RANGE = { min: 28, max: 160 } as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function clampControlPosition(point: NormalizedPoint, padSize: number, width: number, height: number): NormalizedPoint {
  const insetX = Math.min(0.5, (padSize / 2 + 4) / Math.max(1, width));
  const insetY = Math.min(0.5, (padSize / 2 + 4) / Math.max(1, height));
  return { x: clamp(point.x, insetX, 1 - insetX), y: clamp(point.y, insetY, 1 - insetY) };
}

export function defaultControlLayout(width: number, height: number): ControlLayout {
  const moveSize = 110;
  const actionSize = 78;
  const moveInset = moveSize / 2 + 12;
  const actionInset = actionSize / 2 + 12;
  const gap = actionSize + 10;
  const point = (x: number, y: number, size: number) => clampControlPosition({ x: x / width, y: y / height }, size, width, height);
  return {
    sizes: { 'red-move': moveSize, 'red-wall': actionSize, 'red-bomb': actionSize,
      'blue-move': moveSize, 'blue-wall': actionSize, 'blue-bomb': actionSize },
    floatRadii: { 'red-move': 70, 'red-wall': 52, 'red-bomb': 52,
      'blue-move': 70, 'blue-wall': 52, 'blue-bomb': 52 },
    positions: {
      'red-move': point(moveInset, moveInset, moveSize),
      'red-wall': point(actionInset, height - actionInset, actionSize),
      'red-bomb': point(actionInset + gap, height - actionInset, actionSize),
      'blue-move': point(width - moveInset, height - moveInset, moveSize),
      'blue-wall': point(width - actionInset, actionInset, actionSize),
      'blue-bomb': point(width - actionInset - gap, actionInset, actionSize),
    },
  };
}

export function normalizeControlLayout(saved: unknown, width: number, height: number): ControlLayout {
  const fallback = defaultControlLayout(width, height);
  if (!saved || typeof saved !== 'object') return fallback;
  const data = saved as Partial<ControlLayout> & { padSize?: number; floatRadius?: number };
  const legacySize = Number.isFinite(data.padSize) ? Number(data.padSize) : undefined;
  const legacyRadius = Number.isFinite(data.floatRadius) ? Number(data.floatRadius) : undefined;
  const sizes = { ...fallback.sizes };
  const floatRadii = { ...fallback.floatRadii };
  const positions = { ...fallback.positions };
  for (const id of CONTROL_IDS) {
    sizes[id] = clamp(Number.isFinite(data.sizes?.[id]) ? Number(data.sizes?.[id]) : legacySize ?? sizes[id],
      CONTROL_SIZE_RANGE.min, CONTROL_SIZE_RANGE.max);
    floatRadii[id] = clamp(Number.isFinite(data.floatRadii?.[id]) ? Number(data.floatRadii?.[id]) : legacyRadius ?? floatRadii[id],
      FLOAT_RADIUS_RANGE.min, FLOAT_RADIUS_RANGE.max);
    const p = data.positions?.[id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
  }
  return { positions, sizes, floatRadii };
}

export function movementZoneRect(point: NormalizedPoint, size: number, floatRadius: number, width: number, height: number) {
  const side = Math.min(Math.max(180, size * 1.8, floatRadius * 2.5), width * 0.45, height * 0.48);
  return {
    left: clamp(point.x * width - side / 2, 0, width - side),
    top: clamp(point.y * height - side / 2, 0, height - side),
    side,
  };
}
