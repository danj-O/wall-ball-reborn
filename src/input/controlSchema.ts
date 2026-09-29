export type AbilitySlot = 'ability-1' | 'ability-2';
export type ControlId = `${'red' | 'blue'}-${'move' | 'wall' | 'bomb' | AbilitySlot}`;
export type NormalizedPoint = { x: number; y: number };
export type ControlLayout = {
  positions: Record<ControlId, NormalizedPoint>;
  sizes: Record<ControlId, number>;
  floatRadii: Record<ControlId, number>;
  moveAreas: Record<'red-move' | 'blue-move', number>;
  moveInsets: Record<'red-move' | 'blue-move', number>;
};

export const CONTROL_IDS: readonly ControlId[] = [
  'red-move', 'red-wall', 'red-bomb', 'red-ability-1', 'red-ability-2',
  'blue-move', 'blue-wall', 'blue-bomb', 'blue-ability-1', 'blue-ability-2',
];
export const CONTROL_SIZE_RANGE = { min: 38, max: 280 } as const;
export const FLOAT_RADIUS_RANGE = { min: 28, max: 160 } as const;
export const MOVE_AREA_RANGE = { min: 150, max: 480 } as const;
export const MOVE_INSET_RANGE = { min: 0, max: 32 } as const;
