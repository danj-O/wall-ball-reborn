import { circleTouchesWall, pointInRegion, territoryAt, type ArenaDefinition, type Team, type Vec2 } from './arena.ts';
import type { RuntimeWall } from './deployables.ts';
import type { PlayerState } from './GameMode.ts';

export type PowerUpId = 'speed' | 'shield' | 'mega-bomb';
export type PowerUpPickup = { id: string; definitionId: PowerUpId; position: Vec2; remaining: number; age: number };
export type PlayerPowerUps = { speedRemaining: number; shieldRemaining: number; charges: { 'mega-bomb': number } };
export type PowerUpState = {
  active: PowerUpPickup[];
  bursts: { id: string; position: Vec2; definitionId: PowerUpId; remaining: number }[];
  nextSpawnRemaining: number;
  sequence: number;
  players: Record<Team, PlayerPowerUps>;
  rejected: Record<string, number>;
  lastCollection: { sequence: number; team: Team; definitionId: PowerUpId } | null;
};
export type PowerUpDefinition = {
  id: PowerUpId;
  weight: number;
  presentation: { color: number; label: string; shape: 'bolt' | 'sphere' | 'bomb' };
  pickupRadius: number;
  lifetime: number;
  grant(state: PowerUpState, team: Team): void;
};

export const POWER_UP_CONFIG = {
  firstSpawnSeconds: [10, 15], intervalSeconds: [15, 25], maxActive: 2,
  locationAttempts: 40, spawnRadius: 0.65, minPlayerDistance: 3,
  wallClearance: 0.9, depotClearance: 0.5, baseClearance: 1.9,
  speedMultiplier: 1.35, speedSeconds: 6, shieldSeconds: 8,
  maxMegaCharges: 2,
} as const;

export const POWER_UPS: Record<PowerUpId, PowerUpDefinition> = {
  speed: { id: 'speed', weight: 1, presentation: { color: 0xffd364, label: 'SPEED', shape: 'bolt' }, pickupRadius: 0.9, lifetime: 30,
    grant: (state, team) => { state.players[team].speedRemaining = POWER_UP_CONFIG.speedSeconds; } },
  shield: { id: 'shield', weight: 1, presentation: { color: 0x80e5ed, label: 'SHIELD', shape: 'sphere' }, pickupRadius: 0.9, lifetime: 30,
    grant: (state, team) => { state.players[team].shieldRemaining = POWER_UP_CONFIG.shieldSeconds; } },
  'mega-bomb': { id: 'mega-bomb', weight: 1, presentation: { color: 0xef85ec, label: 'MEGA', shape: 'bomb' }, pickupRadius: 0.9, lifetime: 30,
    grant: (state, team) => { state.players[team].charges['mega-bomb'] = Math.min(POWER_UP_CONFIG.maxMegaCharges, state.players[team].charges['mega-bomb'] + 1); } },
};

const randomBetween = (rng: () => number, [min, max]: readonly [number, number]) => min + rng() * (max - min);
export function createPowerUpState(rng: () => number = Math.random): PowerUpState {
  const player = (): PlayerPowerUps => ({ speedRemaining: 0, shieldRemaining: 0, charges: { 'mega-bomb': 0 } });
  return { active: [], bursts: [], nextSpawnRemaining: randomBetween(rng, POWER_UP_CONFIG.firstSpawnSeconds), sequence: 0,
    players: { red: player(), blue: player() }, rejected: {}, lastCollection: null };
}

export function powerUpSpawnRejection(position: Vec2, arena: ArenaDefinition, walls: readonly RuntimeWall[],
  players: Record<Team, PlayerState>, active: readonly PowerUpPickup[]): string | null {
  const c = POWER_UP_CONFIG;
  const b = arena.bounds;
  if (position.x < b.minX + c.spawnRadius || position.x > b.maxX - c.spawnRadius ||
      position.z < b.minZ + c.spawnRadius || position.z > b.maxZ - c.spawnRadius) return 'bounds';
  if (territoryAt(position, arena) !== 'contested' || !arena.powerupSpawnAreas.some(region => pointInRegion(position, region))) return 'region';
  if (walls.some(wall => circleTouchesWall(position, c.wallClearance, wall))) return 'wall';
  if (arena.depots.some(depot => Math.hypot(position.x - depot.position.x, position.z - depot.position.z) < depot.radius + c.depotClearance)) return 'depot';
  if (Object.values(arena.flagPositions).some(base => Math.hypot(position.x - base.x, position.z - base.z) < c.baseClearance)) return 'base';
  if (Object.values(players).some(player => Math.hypot(position.x - player.position.x, position.z - player.position.z) < c.minPlayerDistance)) return 'player';
  if (active.some(pickup => Math.hypot(position.x - pickup.position.x, position.z - pickup.position.z) < 2 * c.spawnRadius + 0.4)) return 'pickup';
  return null;
}

function chooseDefinition(rng: () => number): PowerUpDefinition {
  const definitions = Object.values(POWER_UPS);
  const total = definitions.reduce((sum, definition) => sum + definition.weight, 0);
  let ticket = rng() * total;
  for (const definition of definitions) { ticket -= definition.weight; if (ticket < 0) return definition; }
  return definitions.at(-1)!;
}

export function attemptPowerUpSpawn(state: PowerUpState, arena: ArenaDefinition, walls: readonly RuntimeWall[],
  players: Record<Team, PlayerState>, rng: () => number = Math.random): PowerUpPickup | null {
  if (state.active.length >= POWER_UP_CONFIG.maxActive) { state.rejected.maxActive = (state.rejected.maxActive ?? 0) + 1; return null; }
  const areas = arena.powerupSpawnAreas.filter(area => area.bounds.maxX > area.bounds.minX && area.bounds.maxZ > area.bounds.minZ);
  if (!areas.length) { state.rejected.noRegion = (state.rejected.noRegion ?? 0) + 1; return null; }
  const totalArea = areas.reduce((sum, area) => sum + (area.bounds.maxX - area.bounds.minX) * (area.bounds.maxZ - area.bounds.minZ), 0);
  for (let attempt = 0; attempt < POWER_UP_CONFIG.locationAttempts; attempt++) {
    let ticket = rng() * totalArea;
    let area = areas.at(-1)!;
    for (const candidate of areas) {
      ticket -= (candidate.bounds.maxX - candidate.bounds.minX) * (candidate.bounds.maxZ - candidate.bounds.minZ);
      if (ticket < 0) { area = candidate; break; }
    }
    const position = {
      x: randomBetween(rng, [area.bounds.minX, area.bounds.maxX]),
      z: randomBetween(rng, [area.bounds.minZ, area.bounds.maxZ]),
    };
    const rejection = powerUpSpawnRejection(position, arena, walls, players, state.active);
    if (rejection) { state.rejected[rejection] = (state.rejected[rejection] ?? 0) + 1; continue; }
    const definition = chooseDefinition(rng);
    const pickup = { id: `power-up-${++state.sequence}`, definitionId: definition.id, position,
      remaining: definition.lifetime, age: 0 };
    state.active.push(pickup);
    return pickup;
  }
  state.rejected.attemptLimit = (state.rejected.attemptLimit ?? 0) + 1;
  return null;
}

export function collectPowerUp(state: PowerUpState, pickupId: string, team: Team): boolean {
  const index = state.active.findIndex(pickup => pickup.id === pickupId);
  if (index < 0) return false;
  const [pickup] = state.active.splice(index, 1);
  POWER_UPS[pickup.definitionId].grant(state, team);
  state.bursts.push({ id: pickup.id, position: { ...pickup.position }, definitionId: pickup.definitionId, remaining: 0.55 });
  state.lastCollection = { sequence: ++state.sequence, team, definitionId: pickup.definitionId };
  return true;
}

export function tickPowerUps(state: PowerUpState, arena: ArenaDefinition, walls: readonly RuntimeWall[],
  players: Record<Team, PlayerState>, dt: number, rng: () => number = Math.random,
  onCollect: (team: Team) => void = () => {}): void {
  for (const team of ['red', 'blue'] as const) {
    state.players[team].speedRemaining = Math.max(0, state.players[team].speedRemaining - dt);
    state.players[team].shieldRemaining = Math.max(0, state.players[team].shieldRemaining - dt);
  }
  for (const pickup of state.active) { pickup.age += dt; pickup.remaining -= dt; }
  for (const burst of state.bursts) burst.remaining -= dt;
  state.bursts = state.bursts.filter(burst => burst.remaining > 0);
  state.active = state.active.filter(pickup => pickup.remaining > 0);
  for (const pickup of [...state.active]) {
    const collectors = (['red', 'blue'] as const).filter(team =>
      !players[team].airborne &&
      Math.hypot(players[team].position.x - pickup.position.x, players[team].position.z - pickup.position.z) <= POWER_UPS[pickup.definitionId].pickupRadius);
    if (collectors.length && collectPowerUp(state, pickup.id, collectors[0])) onCollect(collectors[0]);
  }
  state.nextSpawnRemaining -= dt;
  if (state.nextSpawnRemaining <= 0) {
    attemptPowerUpSpawn(state, arena, walls, players, rng);
    state.nextSpawnRemaining = randomBetween(rng, POWER_UP_CONFIG.intervalSeconds);
  }
}
