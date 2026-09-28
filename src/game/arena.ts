export type Team = 'red' | 'blue';
export type Vec2 = { x: number; z: number };
export type ArenaBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type RectRegion = { id: string; bounds: ArenaBounds };
export type Territory = Team | 'contested';
export type WallType = 'wood' | 'stone';
export type DepotType = 'wall' | 'bomb';
export type WallDefinition = { id: string; type: WallType; position: Vec2; width: number; depth: number; rotation: number };
export type DepotDefinition = { id: string; type: DepotType; position: Vec2; radius: number; capacity: number };

export const ARENA_SIZE = { halfWidth: 18, halfDepth: 11, contestedHalfWidth: 5.5 } as const;
export const WALL_TYPES = {
  wood: { label: 'Wood', maxHealth: 100, appearance: { side: 0x92694c, top: 0xc49b6d }, placementFootprint: { width: 2.25, depth: 0.5 } },
  stone: { label: 'Stone', maxHealth: 200, appearance: { side: 0x788b95, top: 0xb3c1c4 }, placementFootprint: { width: 2.4, depth: 0.8 } },
} as const;
export const DEFAULT_PLAYER_WALL_TYPE: WallType = 'wood';
export const WALL_HEIGHT = 1.35;
export const DEFAULT_DEPOT_CAPACITY = 8;
export const MAX_DEPOT_CAPACITY = 32;

export interface ArenaDefinition {
  bounds: ArenaBounds;
  playerSpawns: Record<Team, Vec2>;
  flagPositions: Record<Team, Vec2>;
  territories: Record<Territory, RectRegion[]>;
  powerupSpawnAreas: RectRegion[]; // Future random locations; no power-ups yet.
  walls: WallDefinition[];
  depots: DepotDefinition[];
}

export function defaultTerritories(bounds: ArenaBounds): ArenaDefinition['territories'] {
  const center = (bounds.minX + bounds.maxX) / 2;
  const half = Math.min(ARENA_SIZE.contestedHalfWidth, (bounds.maxX - bounds.minX) / 4);
  return {
    red: [{ id: 'red-territory', bounds: { ...bounds, maxX: center - half } }],
    contested: [{ id: 'contested-territory', bounds: { ...bounds, minX: center - half, maxX: center + half } }],
    blue: [{ id: 'blue-territory', bounds: { ...bounds, minX: center + half } }],
  };
}

const defaultBounds: ArenaBounds = { minX: -ARENA_SIZE.halfWidth, maxX: ARENA_SIZE.halfWidth, minZ: -ARENA_SIZE.halfDepth, maxZ: ARENA_SIZE.halfDepth };
export const DEFAULT_ARENA: ArenaDefinition = {
  bounds: defaultBounds,
  playerSpawns: { red: { x: -14.5, z: 0 }, blue: { x: 14.5, z: 0 } },
  flagPositions: { red: { x: -16.4, z: 0 }, blue: { x: 16.4, z: 0 } },
  territories: defaultTerritories(defaultBounds),
  powerupSpawnAreas: [{ id: 'central-opportunities', bounds: { minX: -4.5, maxX: 4.5, minZ: -9, maxZ: 9 } }],
  walls: [
    { id: 'north-west', type: 'stone', position: { x: -7, z: -6 }, width: 3, depth: 0.8, rotation: 0 },
    { id: 'south-west', type: 'stone', position: { x: -7, z: 6 }, width: 3, depth: 0.8, rotation: 0 },
    { id: 'north-east', type: 'stone', position: { x: 7, z: -6 }, width: 3, depth: 0.8, rotation: 0 },
    { id: 'south-east', type: 'stone', position: { x: 7, z: 6 }, width: 3, depth: 0.8, rotation: 0 },
    { id: 'center', type: 'stone', position: { x: 0, z: 0 }, width: 0.8, depth: 3.2, rotation: 0 },
    { id: 'red-cover', type: 'wood', position: { x: -12, z: 3.5 }, width: 2.25, depth: 0.5, rotation: 0 },
    { id: 'blue-cover', type: 'wood', position: { x: 12, z: -3.5 }, width: 2.25, depth: 0.5, rotation: 0 },
  ],
  depots: [
    { id: 'wall-depot', type: 'wall', position: { x: 0, z: -6.7 }, radius: 1.7, capacity: DEFAULT_DEPOT_CAPACITY },
    { id: 'bomb-depot', type: 'bomb', position: { x: 0, z: 6.7 }, radius: 1.7, capacity: DEFAULT_DEPOT_CAPACITY },
  ],
};

export function cloneArena(arena: ArenaDefinition): ArenaDefinition { return structuredClone(arena); }
export function simpleArena(): ArenaDefinition {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'center', type: 'stone', position: { x: 0, z: 0 }, width: 0.8, depth: 6, rotation: 0 }];
  arena.depots = [];
  return arena;
}
export function nextArenaObjectId(arena: ArenaDefinition, kind: 'wall' | 'depot'): string {
  const used = new Set([...arena.walls, ...arena.depots].map(object => object.id));
  let number = 1;
  while (used.has(`${kind}-custom-${number}`)) number++;
  return `${kind}-custom-${number}`;
}
export function pointInRegion(point: Vec2, region: RectRegion): boolean {
  const b = region.bounds;
  return point.x >= b.minX && point.x <= b.maxX && point.z >= b.minZ && point.z <= b.maxZ;
}
export function territoryAt(point: Vec2, arena: ArenaDefinition): Territory {
  if (arena.territories.red.some(region => pointInRegion(point, region))) return 'red';
  if (arena.territories.blue.some(region => pointInRegion(point, region))) return 'blue';
  return 'contested';
}
export function depotFitsArena(depot: DepotDefinition, arena: ArenaDefinition): boolean {
  const b = arena.bounds;
  return Number.isInteger(depot.capacity) && depot.capacity >= 1 && depot.capacity <= MAX_DEPOT_CAPACITY &&
    depot.radius >= 0.75 && depot.radius <= 4 &&
    depot.position.x - depot.radius >= b.minX + 0.2 && depot.position.x + depot.radius <= b.maxX - 0.2 &&
    depot.position.z - depot.radius >= b.minZ + 0.2 && depot.position.z + depot.radius <= b.maxZ - 0.2;
}
export function flagFitsArena(team: Team, position: Vec2, arena: ArenaDefinition): boolean {
  const b = arena.bounds;
  if (position.x < b.minX + 1.35 || position.x > b.maxX - 1.35 ||
      position.z < b.minZ + 1.35 || position.z > b.maxZ - 1.35) return false;
  const enemy = team === 'red' ? 'blue' : 'red';
  if (Math.hypot(position.x - arena.flagPositions[enemy].x, position.z - arena.flagPositions[enemy].z) < 2.6) return false;
  return !arena.walls.some(wall => circleTouchesWall(position, 1.3, wall));
}

// Old saves keep customized walls and expand the original stock map in place.
export function migrateArena(saved: ArenaDefinition): ArenaDefinition {
  const arena = cloneArena(saved);
  const legacy = arena.bounds.minX === -12 && arena.bounds.maxX === 12 && arena.bounds.minZ === -8 && arena.bounds.maxZ === 8;
  if (legacy) {
    arena.bounds = { ...defaultBounds };
    if (arena.playerSpawns.red.x === -9 && arena.playerSpawns.blue.x === 9) arena.playerSpawns = structuredClone(DEFAULT_ARENA.playerSpawns);
    if (arena.flagPositions.red.x === -10.5 && arena.flagPositions.blue.x === 10.5) arena.flagPositions = structuredClone(DEFAULT_ARENA.flagPositions);
  }
  arena.walls = arena.walls.map(wall => ({ ...wall, type: wall.type === 'wood' ? 'wood' : 'stone' }));
  arena.territories ??= defaultTerritories(arena.bounds);
  arena.powerupSpawnAreas ??= structuredClone(DEFAULT_ARENA.powerupSpawnAreas);
  arena.depots ??= structuredClone(DEFAULT_ARENA.depots).filter(depot => depotFitsArena(depot, arena));
  arena.depots = arena.depots.map(depot => ({ ...depot, capacity: depot.capacity ?? DEFAULT_DEPOT_CAPACITY }));
  return arena;
}

export function localPoint(point: Vec2, wall: WallDefinition): Vec2 {
  const dx = point.x - wall.position.x;
  const dz = point.z - wall.position.z;
  const c = Math.cos(wall.rotation);
  const s = Math.sin(wall.rotation);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}
export function circleTouchesWall(point: Vec2, radius: number, wall: WallDefinition): boolean {
  const p = localPoint(point, wall);
  const x = Math.max(-wall.width / 2, Math.min(wall.width / 2, p.x));
  const z = Math.max(-wall.depth / 2, Math.min(wall.depth / 2, p.z));
  return (p.x - x) ** 2 + (p.z - z) ** 2 < radius ** 2;
}
export function wallFitsArena(wall: WallDefinition, arena: ArenaDefinition): boolean {
  const c = Math.cos(wall.rotation);
  const s = Math.sin(wall.rotation);
  const halfX = Math.abs(c) * wall.width / 2 + Math.abs(s) * wall.depth / 2;
  const halfZ = Math.abs(s) * wall.width / 2 + Math.abs(c) * wall.depth / 2;
  const b = arena.bounds;
  if (wall.position.x - halfX < b.minX + 0.2 || wall.position.x + halfX > b.maxX - 0.2 ||
      wall.position.z - halfZ < b.minZ + 0.2 || wall.position.z + halfZ > b.maxZ - 0.2) return false;
  return !Object.values(arena.playerSpawns).some(point => circleTouchesWall(point, 0.85, wall)) &&
    !Object.values(arena.flagPositions).some(point => circleTouchesWall(point, 1.3, wall));
}
