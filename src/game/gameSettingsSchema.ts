import type { BombType } from './deployables.ts';

export type ProjectileTuning = { throwForce: number; lob: number; mass: number; blastRadius: number };
export type GameSettings = {
  runSpeed: number;
  acceleration: number;
  braking: number;
  playerMass: number;
  projectiles: Record<BombType, ProjectileTuning>;
};

export const GAME_SETTING_RANGES = {
  runSpeed: { min: 3, max: 12, step: 0.1 },
  acceleration: { min: 5, max: 80, step: 1 },
  braking: { min: 5, max: 100, step: 1 },
  playerMass: { min: 1, max: 10, step: 0.1 },
  throwForce: { min: 0.4, max: 2.5, step: 0.05 },
  lob: { min: 0.4, max: 2.5, step: 0.05 },
  mass: { min: 0.4, max: 4, step: 0.05 },
  blastRadius: { min: 0.5, max: 8, step: 0.1 },
} as const;

export const BASE_GAME_SETTINGS: GameSettings = {
  runSpeed: 6.4,
  acceleration: 28,
  braking: 38,
  playerMass: 4,
  projectiles: {
    bomb: { throwForce: 1, lob: 1, mass: 1, blastRadius: 2.5 },
    'mega-bomb': { throwForce: 1.35, lob: 1.25, mass: 1.7, blastRadius: 4 },
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function within(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}
export function validateGameSettings(value: unknown): GameSettings | null {
  if (!record(value) || !within(value.runSpeed, GAME_SETTING_RANGES.runSpeed) ||
    !within(value.acceleration, GAME_SETTING_RANGES.acceleration) ||
    !within(value.braking, GAME_SETTING_RANGES.braking) ||
    !within(value.playerMass, GAME_SETTING_RANGES.playerMass) || !record(value.projectiles)) return null;
  const result: GameSettings = {
    runSpeed: value.runSpeed, acceleration: value.acceleration, braking: value.braking,
    playerMass: value.playerMass, projectiles: {} as GameSettings['projectiles'],
  };
  for (const id of Object.keys(BASE_GAME_SETTINGS.projectiles) as BombType[]) {
    const item = value.projectiles[id];
    if (!record(item) || !within(item.throwForce, GAME_SETTING_RANGES.throwForce) ||
      !within(item.lob, GAME_SETTING_RANGES.lob) || !within(item.mass, GAME_SETTING_RANGES.mass) ||
      !within(item.blastRadius, GAME_SETTING_RANGES.blastRadius)) return null;
    result.projectiles[id] = {
      throwForce: item.throwForce, lob: item.lob, mass: item.mass, blastRadius: item.blastRadius,
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
    projectiles,
  });
}
