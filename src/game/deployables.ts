import { circleTouchesWall, DEFAULT_PLAYER_WALL_TYPE, WALL_HEIGHT, WALL_TYPES, type ArenaDefinition, type Team, type Vec2, type WallDefinition } from './arena.ts';
import type { PlayerState } from './GameMode.ts';
import type { BombTrajectory } from './trajectory.ts';

export type ResourceId = 'wall' | 'bomb';
export type DeployableId = ResourceId | BombType;
export type BombType = keyof typeof BOMB_TYPES;
export type PreviewShape =
  | { kind: 'box'; width: number; depth: number; height: number }
  | { kind: 'sphere'; radius: number };
export type Footprint =
  | { kind: 'box'; width: number; depth: number }
  | { kind: 'circle'; radius: number };
export type Placement = { position: Vec2; rotation: number };
export type RuntimeWall = WallDefinition & { kind: 'wall'; definitionId: ResourceId; owner: Team | null; hp: number; source: 'initial' | 'deployed' };
export type RuntimeBomb = {
  kind: 'bomb'; definitionId: BombType; id: string; owner: Team;
  origin: Vec2; target: Vec2; position: Vec2; height: number;
  orientation: { x: number; y: number; z: number; w: number };
  phase: 'flying' | 'lit'; travelDuration: number;
  velocity: Vec2; verticalVelocity: number;
  fuseRemaining: number; fuseDuration: number;
  blastRadius: number; wallDamage: number; physicalRadius: number;
};
export type RuntimeEntity = RuntimeWall | RuntimeBomb;
export type Explosion = { id: string; definitionId: BombType; position: Vec2; radius: number; remaining: number; duration: number };
export type DeploymentPreview = Placement & { definitionId: DeployableId; valid: boolean; landingHeight: number; trajectory?: BombTrajectory };
export type AimSession = { definitionId: DeployableId; direction: Vec2; strength: number; preview: DeploymentPreview | null };
export type DeploymentState = {
  walls: RuntimeWall[];
  bombs: RuntimeBomb[];
  explosions: Explosion[];
  inventory: Record<Team, Record<ResourceId, number>>;
  aim: Record<Team, Partial<Record<DeployableId, AimSession>>>;
};
export type PlacementContext = {
  arena: ArenaDefinition;
  walls: readonly RuntimeWall[];
  bombs: readonly RuntimeBomb[];
  players: Record<Team, PlayerState>;
};
export type TickContext = { state: DeploymentState; dt: number; onWallDestroyed?: (owner: Team, wall: RuntimeWall) => void };

export interface DeployableDefinition {
  readonly id: DeployableId;
  readonly label: string;
  readonly control: { icon: string; size: 'primary' | 'secondary' };
  readonly preview: PreviewShape;
  readonly footprint: Footprint;
  readonly range: { min: number; max: number };
  readonly inventoryCost: number;
  readonly initialInventory: number;
  isValid(placement: Placement, context: PlacementContext): boolean;
  deploy(id: string, team: Team, placement: Placement, origin: Vec2): RuntimeEntity;
  tick?(entity: RuntimeEntity, context: TickContext): boolean; // false removes entity
}

const PLAYER_CLEARANCE = 0.16;
const BASE_CLEARANCE = 1.33;
const BOUNDARY_CLEARANCE = 0.15;
export const BOMB_DAMAGE = 50;
export const BOMB_RADIUS = 2.5;
export const BOMB_FUSE = 2;
export const AIM_DEAD_ZONE = 0.18;
export const EXPLOSION_DURATION = 0.6;
export const BOMB_THROW = {
  minimumDistance: 1,
  maximumDistance: 6,
  travelSpeed: 10,
  minimumTravelTime: 0.24,
} as const;
export const BOMB_RADIUS_PHYSICS = 0.34;
export const BOMB_TYPES = {
  bomb: { fuse: BOMB_FUSE, blastRadius: BOMB_RADIUS, wallDamage: BOMB_DAMAGE, physicalRadius: BOMB_RADIUS_PHYSICS },
  'mega-bomb': { fuse: 2, blastRadius: 4, wallDamage: 100, physicalRadius: 0.48 },
} as const;
const WALL_FOOTPRINT = { kind: 'box', ...WALL_TYPES[DEFAULT_PLAYER_WALL_TYPE].placementFootprint } as const;

function boxInsideArena(wall: WallDefinition, arena: ArenaDefinition): boolean {
  const c = Math.cos(wall.rotation);
  const s = Math.sin(wall.rotation);
  const halfX = Math.abs(c) * wall.width / 2 + Math.abs(s) * wall.depth / 2;
  const halfZ = Math.abs(s) * wall.width / 2 + Math.abs(c) * wall.depth / 2;
  const b = arena.bounds;
  return wall.position.x - halfX >= b.minX + BOUNDARY_CLEARANCE &&
    wall.position.x + halfX <= b.maxX - BOUNDARY_CLEARANCE &&
    wall.position.z - halfZ >= b.minZ + BOUNDARY_CLEARANCE &&
    wall.position.z + halfZ <= b.maxZ - BOUNDARY_CLEARANCE;
}

function boxesOverlap(a: WallDefinition, b: WallDefinition, clearance = 0.08): boolean {
  const axes = [a.rotation, a.rotation + Math.PI / 2, b.rotation, b.rotation + Math.PI / 2];
  const delta = { x: b.position.x - a.position.x, z: b.position.z - a.position.z };
  for (const angle of axes) {
    const axis = { x: Math.cos(angle), z: -Math.sin(angle) };
    const radius = (wall: WallDefinition) => {
      const widthAxis = { x: Math.cos(wall.rotation), z: -Math.sin(wall.rotation) };
      const depthAxis = { x: Math.sin(wall.rotation), z: Math.cos(wall.rotation) };
      return Math.abs(axis.x * widthAxis.x + axis.z * widthAxis.z) * wall.width / 2 +
        Math.abs(axis.x * depthAxis.x + axis.z * depthAxis.z) * wall.depth / 2;
    };
    if (Math.abs(delta.x * axis.x + delta.z * axis.z) >= radius(a) + radius(b) + clearance) return false;
  }
  return true;
}

function wallPlacementValid(placement: Placement, context: PlacementContext): boolean {
  const candidate: WallDefinition = {
    id: '', type: DEFAULT_PLAYER_WALL_TYPE, position: placement.position,
    width: WALL_FOOTPRINT.width, depth: WALL_FOOTPRINT.depth, rotation: placement.rotation,
  };
  if (!boxInsideArena(candidate, context.arena)) return false;
  if (context.walls.some(wall => boxesOverlap(candidate, wall))) return false;
  if (Object.values(context.players).some(player => circleTouchesWall(player.position, 0.38 + PLAYER_CLEARANCE, candidate))) return false;
  if (Object.values(context.arena.flagPositions).some(point => circleTouchesWall(point, BASE_CLEARANCE, candidate))) return false;
  if (context.bombs.some(bomb => circleTouchesWall(bomb.phase === 'flying' ? bomb.target : bomb.position, 0.44, candidate))) return false;
  return true;
}

function bombPlacementValid(placement: Placement, context: PlacementContext, radius: number): boolean {
  const p = placement.position;
  const b = context.arena.bounds;
  if (p.x - radius < b.minX + BOUNDARY_CLEARANCE || p.x + radius > b.maxX - BOUNDARY_CLEARANCE ||
      p.z - radius < b.minZ + BOUNDARY_CLEARANCE || p.z + radius > b.maxZ - BOUNDARY_CLEARANCE) return false;
  return true;
}

function tickBomb(entity: RuntimeEntity, { state, dt, onWallDestroyed }: TickContext): boolean {
  if (entity.kind !== 'bomb') return true;
  if (entity.phase === 'flying') return true;
  entity.fuseRemaining -= dt;
  if (entity.fuseRemaining > 0) return true;
  state.explosions.push({
    id: entity.id, definitionId: entity.definitionId, position: { ...entity.position }, radius: entity.blastRadius,
    remaining: EXPLOSION_DURATION, duration: EXPLOSION_DURATION,
  });
  // A spatial event: nearest point on each wall footprint determines the hit.
  for (const wall of state.walls) {
    if (circleTouchesWall(entity.position, entity.blastRadius, wall)) {
      wall.hp -= entity.wallDamage;
      if (wall.hp <= 0) onWallDestroyed?.(entity.owner, wall);
    }
  }
  state.walls = state.walls.filter(wall => wall.hp > 0);
  return false;
}

export const DEPLOYABLES: Record<DeployableId, DeployableDefinition> = {
  wall: {
    id: 'wall', label: 'Wall',
    control: { icon: 'wall', size: 'primary' },
    preview: { ...WALL_FOOTPRINT, height: WALL_HEIGHT },
    footprint: WALL_FOOTPRINT,
    range: { min: 1.25, max: 2.7 },
    inventoryCost: 1, initialInventory: 8,
    isValid: wallPlacementValid,
    deploy: (id, owner, placement): RuntimeWall => ({
      kind: 'wall', definitionId: 'wall', id, owner, source: 'deployed', type: DEFAULT_PLAYER_WALL_TYPE,
      position: { ...placement.position }, rotation: placement.rotation,
      width: WALL_FOOTPRINT.width, depth: WALL_FOOTPRINT.depth, hp: WALL_TYPES[DEFAULT_PLAYER_WALL_TYPE].maxHealth,
    }),
  },
  bomb: bombDefinition('bomb', 'Bomb', 'primary', 1, 2),
  'mega-bomb': bombDefinition('mega-bomb', 'Mega', 'secondary', 0, 0),
};

function bombDefinition(id: BombType, label: string, size: 'primary' | 'secondary', inventoryCost: number, initialInventory: number): DeployableDefinition {
  const config = BOMB_TYPES[id];
  return {
    id, label, control: { icon: 'bomb', size },
    preview: { kind: 'sphere', radius: config.physicalRadius },
    footprint: { kind: 'circle', radius: config.physicalRadius },
    range: { min: BOMB_THROW.minimumDistance, max: BOMB_THROW.maximumDistance },
    inventoryCost, initialInventory,
    isValid: (placement, context) => bombPlacementValid(placement, context, config.physicalRadius),
    deploy: (entityId, owner, placement, origin): RuntimeBomb => ({
      kind: 'bomb', definitionId: id, id: entityId, owner,
      origin: { ...origin }, target: { ...placement.position }, position: { ...origin }, height: 0,
      orientation: { x: 0, y: 0, z: 0, w: 1 }, phase: 'flying',
      velocity: { x: 0, z: 0 }, verticalVelocity: 0,
      travelDuration: Math.max(BOMB_THROW.minimumTravelTime,
        Math.hypot(placement.position.x - origin.x, placement.position.z - origin.z) / BOMB_THROW.travelSpeed),
      fuseRemaining: config.fuse, fuseDuration: config.fuse,
      blastRadius: config.blastRadius, wallDamage: config.wallDamage, physicalRadius: config.physicalRadius,
    }),
    tick: tickBomb,
  };
}

export function createDeploymentState(arena: ArenaDefinition): DeploymentState {
  return {
    walls: arena.walls.map(wall => ({
      ...structuredClone(wall), kind: 'wall', definitionId: 'wall', owner: null,
      source: 'initial', hp: WALL_TYPES[wall.type].maxHealth,
    })),
    bombs: [], explosions: [],
    inventory: {
      red: { wall: DEPLOYABLES.wall.initialInventory, bomb: DEPLOYABLES.bomb.initialInventory },
      blue: { wall: DEPLOYABLES.wall.initialInventory, bomb: DEPLOYABLES.bomb.initialInventory },
    },
    aim: { red: {}, blue: {} },
  };
}

export function tickDeploymentState(state: DeploymentState, dt: number, onWallDestroyed?: (owner: Team, wall: RuntimeWall) => void): void {
  for (const explosion of state.explosions) explosion.remaining -= dt;
  state.explosions = state.explosions.filter(explosion => explosion.remaining > 0);
  state.bombs = state.bombs.filter(bomb => DEPLOYABLES[bomb.definitionId].tick?.(bomb, { state, dt, onWallDestroyed }) !== false);
}
