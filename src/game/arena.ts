import classicMap from '../maps/classic.json' with { type: 'json' };

export type Team = 'red' | 'blue';
export type Vec2 = { x: number; z: number };
export type ArenaBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type RectRegion = { id: string; bounds: ArenaBounds };
export type Territory = Team | 'contested';
export type WallType = 'wood' | 'stone';
export type DepotType = 'wall' | 'bomb';
export type WallDefinition = { id: string; type: WallType; position: Vec2; width: number; depth: number; rotation: number };
export type DepotDefinition = { id: string; type: DepotType; position: Vec2; radius: number; capacity: number };

export const ARENA_SIZE = { halfWidth: 25, halfDepth: 13, contestedHalfWidth: 3.5 } as const;
export const ARENA_DIMENSIONS = { width: { min: 30, max: 80 }, length: { min: 18, max: 48 } } as const;
export const WALL_TYPES = {
  wood: { label: 'Wood', maxHealth: 100, placementFootprint: { width: 2.25, depth: 0.5 } },
  stone: { label: 'Stone', maxHealth: 200, placementFootprint: { width: 2.4, depth: 0.8 } },
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
  powerupSpawnAreas: RectRegion[];
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
function entryWallRow(team: Team, type: WallType, x: number, count: number, gap: number): WallDefinition[] {
  const { width, depth } = WALL_TYPES[type].placementFootprint;
  const length = count * width + (count - 1) * gap;
  return Array.from({ length: count }, (_, index) => ({
    id: `${team}-${type}-gate-${index + 1}`, type,
    position: { x, z: -length / 2 + width / 2 + index * (width + gap) },
    width, depth, rotation: Math.PI / 2,
  }));
}
const defaultEntryWalls: WallDefinition[] = [
  ...entryWallRow('red', 'stone', -5, 10, 0.16),
  ...entryWallRow('red', 'wood', -3.85, 11, 0.07),
  ...entryWallRow('blue', 'wood', 3.85, 11, 0.07),
  ...entryWallRow('blue', 'stone', 5, 10, 0.16),
];
export const BASE_ARENA: ArenaDefinition = {
  bounds: defaultBounds,
  playerSpawns: { red: { x: -21.5, z: 0 }, blue: { x: 21.5, z: 0 } },
  flagPositions: { red: { x: -23.2, z: 0 }, blue: { x: 23.2, z: 0 } },
  territories: defaultTerritories(defaultBounds),
  powerupSpawnAreas: [{ id: 'central-opportunities', bounds: { minX: -2.5, maxX: 2.5, minZ: -8, maxZ: 8 } }],
  walls: [
    ...defaultEntryWalls,
    { id: 'center', type: 'stone', position: { x: 0, z: 0 }, width: 0.8, depth: 3.2, rotation: 0 },
    { id: 'red-cover', type: 'wood', position: { x: -18.5, z: 3.5 }, width: 2.25, depth: 0.5, rotation: 0 },
    { id: 'blue-cover', type: 'wood', position: { x: 18.5, z: -3.5 }, width: 2.25, depth: 0.5, rotation: 0 },
  ],
  depots: [
    { id: 'wall-depot', type: 'wall', position: { x: 0, z: -6.7 }, radius: 1.7, capacity: DEFAULT_DEPOT_CAPACITY },
    { id: 'bomb-depot', type: 'bomb', position: { x: 0, z: 6.7 }, radius: 1.7, capacity: DEFAULT_DEPOT_CAPACITY },
  ],
};

// A saved developer preset becomes the new reset/new-device arena.
export const DEFAULT_ARENA: ArenaDefinition = validateArenaDefinition(classicMap.arena) ?? BASE_ARENA;

export function cloneArena(arena: ArenaDefinition): ArenaDefinition { return structuredClone(arena); }
export function nextArenaObjectId(arena: ArenaDefinition, kind: 'wall' | 'depot' | 'power-region'): string {
  const used = new Set([...arena.walls, ...arena.depots, ...arena.powerupSpawnAreas].map(object => object.id));
  let number = 1;
  while (used.has(`${kind}-custom-${number}`)) number++;
  return `${kind}-custom-${number}`;
}
export function powerUpRegionFitsArena(region: RectRegion, arena: ArenaDefinition): boolean {
  const b = region.bounds;
  const contested = arena.territories.contested;
  return b.maxX - b.minX >= 1.5 && b.maxZ - b.minZ >= 1.5 &&
    b.minX >= arena.bounds.minX + 0.5 && b.maxX <= arena.bounds.maxX - 0.5 &&
    b.minZ >= arena.bounds.minZ + 0.5 && b.maxZ <= arena.bounds.maxZ - 0.5 &&
    contested.some(area => b.minX >= area.bounds.minX && b.maxX <= area.bounds.maxX &&
      b.minZ >= area.bounds.minZ && b.maxZ <= area.bounds.maxZ);
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
    arena.territories = defaultTerritories(arena.bounds);
    if (arena.playerSpawns.red.x === -9 && arena.playerSpawns.blue.x === 9) arena.playerSpawns = structuredClone(BASE_ARENA.playerSpawns);
    if (arena.flagPositions.red.x === -10.5 && arena.flagPositions.blue.x === 10.5) arena.flagPositions = structuredClone(BASE_ARENA.flagPositions);
  }
  arena.walls = arena.walls.map(wall => ({ ...wall, type: wall.type === 'wood' ? 'wood' : 'stone' }));
  arena.territories ??= defaultTerritories(arena.bounds);
  arena.powerupSpawnAreas ??= structuredClone(BASE_ARENA.powerupSpawnAreas);
  arena.depots ??= structuredClone(BASE_ARENA.depots).filter(depot => depotFitsArena(depot, arena));
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
export function wallsOverlap(a: WallDefinition, b: WallDefinition): boolean {
  const axes = [a.rotation, a.rotation + Math.PI / 2, b.rotation, b.rotation + Math.PI / 2];
  const deltaX = b.position.x - a.position.x, deltaZ = b.position.z - a.position.z;
  return axes.every(angle => {
    const axisX = Math.cos(angle), axisZ = -Math.sin(angle);
    const projection = Math.abs(deltaX * axisX + deltaZ * axisZ);
    const radius = (wall: WallDefinition) =>
      (Math.abs(Math.cos(wall.rotation) * axisX - Math.sin(wall.rotation) * axisZ) * wall.width +
        Math.abs(Math.sin(wall.rotation) * axisX + Math.cos(wall.rotation) * axisZ) * wall.depth) / 2;
    return projection < radius(a) + radius(b) - 1e-5;
  });
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
    !Object.values(arena.flagPositions).some(point => circleTouchesWall(point, 1.3, wall)) &&
    !arena.walls.some(other => other.id !== wall.id && wallsOverlap(wall, other));
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function validPoint(value: unknown): value is Vec2 {
  return object(value) && finite(value.x) && finite(value.z);
}
function validBounds(value: unknown): value is ArenaBounds {
  return object(value) && finite(value.minX) && finite(value.maxX) && finite(value.minZ) && finite(value.maxZ) &&
    value.minX < value.maxX && value.minZ < value.maxZ;
}

export function validateArenaDefinition(value: unknown, report?: (reason: string) => void): ArenaDefinition | null {
  const invalid = (reason: string): null => { report?.(reason); return null; };
  if (!object(value) || !validBounds(value.bounds) || !object(value.playerSpawns) ||
    !object(value.flagPositions) || !object(value.territories) ||
    !Array.isArray(value.walls) || !Array.isArray(value.depots) || !Array.isArray(value.powerupSpawnAreas)) return invalid('Arena data is incomplete.');
  const arena = value as unknown as ArenaDefinition;
  const width = arena.bounds.maxX - arena.bounds.minX;
  const length = arena.bounds.maxZ - arena.bounds.minZ;
  if (width < ARENA_DIMENSIONS.width.min || width > ARENA_DIMENSIONS.width.max ||
    length < ARENA_DIMENSIONS.length.min || length > ARENA_DIMENSIONS.length.max) return invalid('Width or length is outside the allowed range.');
  for (const team of ['red', 'blue', 'contested'] as const) {
    const regions = arena.territories[team];
    if (!Array.isArray(regions) || regions.length !== 1 || !object(regions[0]) ||
      typeof regions[0].id !== 'string' || !validBounds(regions[0].bounds)) return invalid(`${team} territory is invalid.`);
  }
  const red = arena.territories.red[0].bounds;
  const middle = arena.territories.contested[0].bounds;
  const blue = arena.territories.blue[0].bounds;
  if (red.minX !== arena.bounds.minX || red.maxX !== middle.minX || middle.maxX !== blue.minX ||
    blue.maxX !== arena.bounds.maxX ||
    [red, middle, blue].some(bounds => bounds.minZ !== arena.bounds.minZ || bounds.maxZ !== arena.bounds.maxZ)) return invalid('Territories do not cover the resized arena.');
  for (const team of ['red', 'blue'] as const) {
    const spawn = arena.playerSpawns[team];
    const flag = arena.flagPositions[team];
    if (!validPoint(spawn) || !validPoint(flag) ||
      spawn.x < arena.bounds.minX + 0.85 || spawn.x > arena.bounds.maxX - 0.85 ||
      spawn.z < arena.bounds.minZ + 0.85 || spawn.z > arena.bounds.maxZ - 0.85) return invalid(`${team} spawn needs more room at the edge.`);
  }
  const ids = new Set<string>();
  for (const wall of arena.walls) {
    if (!object(wall) || typeof wall.id !== 'string' || !wall.id || ids.has(wall.id) ||
      !['wood', 'stone'].includes(wall.type) || !validPoint(wall.position) ||
      !finite(wall.width) || !finite(wall.depth) || !finite(wall.rotation) ||
      wall.width <= 0 || wall.depth <= 0 || !wallFitsArena(wall, arena)) return invalid(`Wall ${wall.id} no longer fits.`);
    ids.add(wall.id);
  }
  for (const team of ['red', 'blue'] as const) {
    if (!flagFitsArena(team, arena.flagPositions[team], arena) ||
      arena.walls.some(wall => circleTouchesWall(arena.playerSpawns[team], 0.85, wall))) return invalid(`${team} flag or spawn no longer fits.`);
  }
  for (const depot of arena.depots) {
    if (!object(depot) || typeof depot.id !== 'string' || !depot.id || ids.has(depot.id) ||
      !['wall', 'bomb'].includes(depot.type) || !validPoint(depot.position) ||
      !finite(depot.radius) || !finite(depot.capacity) || !depotFitsArena(depot, arena)) return invalid(`Depot ${depot.id} no longer fits.`);
    ids.add(depot.id);
  }
  for (const region of arena.powerupSpawnAreas) {
    if (!object(region) || typeof region.id !== 'string' || !region.id || ids.has(region.id) ||
      !validBounds(region.bounds) || !powerUpRegionFitsArena(region, arena)) return invalid(`Power-up region ${region.id} no longer fits.`);
    ids.add(region.id);
  }
  return {
    bounds: { ...arena.bounds },
    playerSpawns: { red: { ...arena.playerSpawns.red }, blue: { ...arena.playerSpawns.blue } },
    flagPositions: { red: { ...arena.flagPositions.red }, blue: { ...arena.flagPositions.blue } },
    territories: {
      red: arena.territories.red.map(region => ({ id: region.id, bounds: { ...region.bounds } })),
      contested: arena.territories.contested.map(region => ({ id: region.id, bounds: { ...region.bounds } })),
      blue: arena.territories.blue.map(region => ({ id: region.id, bounds: { ...region.bounds } })),
    },
    powerupSpawnAreas: arena.powerupSpawnAreas.map(region => ({ id: region.id, bounds: { ...region.bounds } })),
    walls: arena.walls.map(wall => ({ id: wall.id, type: wall.type, position: { ...wall.position },
      width: wall.width, depth: wall.depth, rotation: wall.rotation })),
    depots: arena.depots.map(depot => ({ id: depot.id, type: depot.type, position: { ...depot.position },
      radius: depot.radius, capacity: depot.capacity })),
  };
}

export function resizedArena(arena: ArenaDefinition, width: number, length: number,
  report?: (reason: string) => void): ArenaDefinition | null {
  if (!Number.isInteger(width) || !Number.isInteger(length)) { report?.('Use whole numbers for width and length.'); return null; }
  const resized = cloneArena(arena);
  const centerX = (arena.bounds.minX + arena.bounds.maxX) / 2;
  const centerZ = (arena.bounds.minZ + arena.bounds.maxZ) / 2;
  resized.bounds = {
    minX: centerX - width / 2, maxX: centerX + width / 2,
    minZ: centerZ - length / 2, maxZ: centerZ + length / 2,
  };
  // Keep the edited center lane and power-up area in world space. Resizing
  // changes the outer edges, not the layout players have built in the middle.
  const redEdge = arena.territories.red[0].bounds.maxX;
  const blueEdge = arena.territories.blue[0].bounds.minX;
  resized.territories = {
    red: [{ ...arena.territories.red[0], bounds: { ...resized.bounds, maxX: redEdge } }],
    contested: [{ ...arena.territories.contested[0], bounds: { ...resized.bounds, minX: redEdge, maxX: blueEdge } }],
    blue: [{ ...arena.territories.blue[0], bounds: { ...resized.bounds, minX: blueEdge } }],
  };
  return validateArenaDefinition(resized, report);
}

/** Smallest even dimensions that retain every existing arena object in place. */
export function minimumArenaDimensions(arena: ArenaDefinition): { width: number; length: number } {
  const width = arena.bounds.maxX - arena.bounds.minX;
  const length = arena.bounds.maxZ - arena.bounds.minZ;
  const smallest = (axis: 'width' | 'length'): number => {
    const range = ARENA_DIMENSIONS[axis];
    for (let size = range.min; size <= range.max; size += 2) {
      if (resizedArena(arena, axis === 'width' ? size : width, axis === 'length' ? size : length)) return size;
    }
    return range.max;
  };
  return { width: smallest('width'), length: smallest('length') };
}
