import type { BombType } from './deployables.ts';

export type ProjectileTuning = { throwForce: number; lob: number; mass: number; fuseSeconds: number; blastRadius: number; blastForce: number; blastLift: number };
export type GameSettings = {
  runSpeed: number;
  acceleration: number;
  braking: number;
  playerMass: number;
  airControl: number;
  airBraking: number;
  startingInventory: { wall: number; bomb: number };
  passiveRegenSeconds: { wall: number; bomb: number };
  depotGenerationSeconds: { wall: number; bomb: number };
  projectiles: Record<BombType, ProjectileTuning>;
};

export const GAME_SETTING_RANGES = {
  runSpeed: { min: 3, max: 12, step: 0.1 },
  acceleration: { min: 5, max: 80, step: 1 },
  braking: { min: 5, max: 100, step: 1 },
  playerMass: { min: 0.5, max: 30, step: 0.1 },
  airControl: { min: 0, max: 1, step: 0.05 },
  airBraking: { min: 0, max: 1, step: 0.01 },
  startingInventory: { min: 0, max: 32, step: 1 },
  passiveRegenSeconds: { min: 0, max: 60, step: 1 },
  depotGenerationSeconds: { min: 1, max: 60, step: 1 },
  throwForce: { min: 0.4, max: 2.5, step: 0.05 },
  lob: { min: 0.4, max: 2.5, step: 0.05 },
  mass: { min: 0.4, max: 4, step: 0.05 },
  fuseSeconds: { min: 0.5, max: 10, step: 0.1 },
  blastRadius: { min: 0.5, max: 8, step: 0.1 },
  blastForce: { min: 0, max: 200, step: 1 },
  blastLift: { min: 0, max: 200, step: 1 },
} as const;

export const BASE_GAME_SETTINGS: GameSettings = {
  runSpeed: 6.4,
  acceleration: 28,
  braking: 38,
  playerMass: 4,
  airControl: 0.25,
  airBraking: 0.02,
  startingInventory: { wall: 8, bomb: 2 },
  passiveRegenSeconds: { wall: 0, bomb: 10 },
  depotGenerationSeconds: { wall: 6, bomb: 6 },
  projectiles: {
    bomb: { throwForce: 1, lob: 1, mass: 1, fuseSeconds: 2, blastRadius: 2.5, blastForce: 30, blastLift: 50 },
    'mega-bomb': { throwForce: 1.35, lob: 1.25, mass: 1.7, fuseSeconds: 2, blastRadius: 4, blastForce: 55, blastLift: 80 },
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function within(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}
function resourcePair(value: unknown, range: { min: number; max: number }, integer = true): value is { wall: number; bomb: number } {
  return record(value) && within(value.wall, range) && within(value.bomb, range) &&
    (!integer || (Number.isInteger(value.wall) && Number.isInteger(value.bomb)));
}
export function validateGameSettings(value: unknown): GameSettings | null {
  if (!record(value) || !within(value.runSpeed, GAME_SETTING_RANGES.runSpeed) ||
    !within(value.acceleration, GAME_SETTING_RANGES.acceleration) ||
    !within(value.braking, GAME_SETTING_RANGES.braking) ||
    !within(value.playerMass, GAME_SETTING_RANGES.playerMass) ||
    !within(value.airControl, GAME_SETTING_RANGES.airControl) ||
    !within(value.airBraking, GAME_SETTING_RANGES.airBraking) ||
    !resourcePair(value.startingInventory, GAME_SETTING_RANGES.startingInventory) ||
    !resourcePair(value.passiveRegenSeconds, GAME_SETTING_RANGES.passiveRegenSeconds) ||
    !resourcePair(value.depotGenerationSeconds, GAME_SETTING_RANGES.depotGenerationSeconds) ||
    !record(value.projectiles)) return null;
  const result: GameSettings = {
    runSpeed: value.runSpeed, acceleration: value.acceleration, braking: value.braking,
    playerMass: value.playerMass, airControl: value.airControl, airBraking: value.airBraking,
    startingInventory: { wall: value.startingInventory.wall, bomb: value.startingInventory.bomb },
    passiveRegenSeconds: { wall: value.passiveRegenSeconds.wall, bomb: value.passiveRegenSeconds.bomb },
    depotGenerationSeconds: { wall: value.depotGenerationSeconds.wall, bomb: value.depotGenerationSeconds.bomb },
    projectiles: {} as GameSettings['projectiles'],
  };
  for (const id of Object.keys(BASE_GAME_SETTINGS.projectiles) as BombType[]) {
    const item = value.projectiles[id];
    if (!record(item) || !within(item.throwForce, GAME_SETTING_RANGES.throwForce) ||
      !within(item.lob, GAME_SETTING_RANGES.lob) || !within(item.mass, GAME_SETTING_RANGES.mass) ||
      !within(item.fuseSeconds, GAME_SETTING_RANGES.fuseSeconds) ||
      !within(item.blastRadius, GAME_SETTING_RANGES.blastRadius) ||
      !within(item.blastForce, GAME_SETTING_RANGES.blastForce) ||
      !within(item.blastLift, GAME_SETTING_RANGES.blastLift)) return null;
    result.projectiles[id] = {
      throwForce: item.throwForce, lob: item.lob, mass: item.mass, fuseSeconds: item.fuseSeconds, blastRadius: item.blastRadius,
      blastForce: item.blastForce, blastLift: item.blastLift,
    };
  }
  return result;
}

/** Fill fields added since the previous preset format; invalid present values still fail validation. */
export function migrateGameSettings(value: unknown, baseline: GameSettings = BASE_GAME_SETTINGS): GameSettings | null {
  if (!record(value) || !record(value.projectiles)) return null;
  const projectiles = {} as GameSettings['projectiles'];
  for (const id of Object.keys(baseline.projectiles) as BombType[]) {
    const saved = value.projectiles[id];
    if (!record(saved)) return null;
    projectiles[id] = { ...baseline.projectiles[id], ...saved };
  }
  return validateGameSettings({
    runSpeed: value.runSpeed,
    acceleration: value.acceleration ?? baseline.acceleration,
    braking: value.braking ?? baseline.braking,
    playerMass: value.playerMass ?? baseline.playerMass,
    airControl: value.airControl ?? baseline.airControl,
    airBraking: value.airBraking ?? baseline.airBraking,
    startingInventory: value.startingInventory ?? baseline.startingInventory,
    passiveRegenSeconds: value.passiveRegenSeconds ?? baseline.passiveRegenSeconds,
    depotGenerationSeconds: value.depotGenerationSeconds ?? baseline.depotGenerationSeconds,
    projectiles,
  });
}
