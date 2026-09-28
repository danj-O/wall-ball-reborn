export type ControlId = 'red-move' | 'red-wall' | 'red-bomb' | 'blue-move' | 'blue-wall' | 'blue-bomb';
export type NormalizedPoint = { x: number; y: number };
export type ControlLayout = {
  positions: Record<ControlId, NormalizedPoint>;
  padSize: number;
  floatRadius: number;
};

export const CONTROL_IDS: readonly ControlId[] = [
  'red-move', 'red-wall', 'red-bomb', 'blue-move', 'blue-wall', 'blue-bomb',
];
export const CONTROL_SIZE_RANGE = { min: 64, max: 120 } as const;
export const FLOAT_RADIUS_RANGE = { min: 28, max: 110 } as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function clampControlPosition(point: NormalizedPoint, padSize: number, width: number, height: number): NormalizedPoint {
  const insetX = Math.min(0.5, (padSize / 2 + 4) / Math.max(1, width));
  const insetY = Math.min(0.5, (padSize / 2 + 4) / Math.max(1, height));
  return { x: clamp(point.x, insetX, 1 - insetX), y: clamp(point.y, insetY, 1 - insetY) };
}

export function defaultControlLayout(width: number, height: number): ControlLayout {
  const padSize = 82;
  const inset = padSize / 2 + 12;
  const gap = padSize + 10;
  const point = (x: number, y: number) => clampControlPosition({ x: x / width, y: y / height }, padSize, width, height);
  return {
    padSize, floatRadius: 56,
    positions: {
      'red-move': point(inset, inset),
      'red-wall': point(inset, height - inset),
      'red-bomb': point(inset + gap, height - inset),
      'blue-move': point(width - inset, height - inset),
      'blue-wall': point(width - inset, inset),
      'blue-bomb': point(width - inset - gap, inset),
    },
  };
}

export function normalizeControlLayout(saved: unknown, width: number, height: number): ControlLayout {
  const fallback = defaultControlLayout(width, height);
  if (!saved || typeof saved !== 'object') return fallback;
  const data = saved as Partial<ControlLayout>;
  const padSize = Number.isFinite(data.padSize) ? clamp(Number(data.padSize), CONTROL_SIZE_RANGE.min, CONTROL_SIZE_RANGE.max) : fallback.padSize;
  const floatRadius = Number.isFinite(data.floatRadius) ? clamp(Number(data.floatRadius), FLOAT_RADIUS_RANGE.min, FLOAT_RADIUS_RANGE.max) : fallback.floatRadius;
  const positions = { ...fallback.positions };
  for (const id of CONTROL_IDS) {
    const p = data.positions?.[id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[id] = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
  }
  return { positions, padSize, floatRadius };
}
