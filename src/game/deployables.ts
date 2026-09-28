import { circleTouchesWall, DEFAULT_PLAYER_WALL_TYPE, localPoint, movePlayerWithCollision, WALL_HEIGHT, WALL_TYPES, type ArenaDefinition, type Team, type Vec2, type WallDefinition } from './arena.ts';
import type { PlayerState } from './GameMode.ts';

export type DeployableId = 'wall' | 'bomb';
export type PreviewShape =
  | { kind: 'box'; width: number; depth: number; height: number }
  | { kind: 'sphere'; radius: number };
export type Footprint =
  | { kind: 'box'; width: number; depth: number }
  | { kind: 'circle'; radius: number };
export type Placement = { position: Vec2; rotation: number };
export type RuntimeWall = WallDefinition & { kind: 'wall'; definitionId: DeployableId; owner: Team | null; hp: number; source: 'initial' | 'deployed' };
export type RuntimeBomb = {
  kind: 'bomb'; definitionId: DeployableId; id: string; owner: Team;
  origin: Vec2; target: Vec2; position: Vec2; height: number;
  phase: 'flying' | 'lit'; travelElapsed: number; travelDuration: number;
  velocity: Vec2; verticalVelocity: number; support: { kind: 'wall' | 'bomb'; id: string } | null;
  fuseRemaining: number; fuseDuration: number;
};
export type RuntimeEntity = RuntimeWall | RuntimeBomb;
export type Explosion = { id: string; position: Vec2; radius: number; remaining: number; duration: number };
export type DeploymentPreview = Placement & { definitionId: DeployableId; valid: boolean; landingHeight: number };
export type AimSession = { definitionId: DeployableId; direction: Vec2; strength: number; preview: DeploymentPreview | null };
export type DeploymentState = {
  walls: RuntimeWall[];
  bombs: RuntimeBomb[];
  explosions: Explosion[];
  inventory: Record<Team, Record<DeployableId, number>>;
  aim: Record<Team, Partial<Record<DeployableId, AimSession>>>;
};
export type PlacementContext = {
  arena: ArenaDefinition;
  walls: readonly RuntimeWall[];
  bombs: readonly RuntimeBomb[];
  players: Record<Team, PlayerState>;
};
export type TickContext = { state: DeploymentState; arena: ArenaDefinition; dt: number };

export interface DeployableDefinition {
  readonly id: DeployableId;
  readonly label: string;
  readonly control: { icon: string; size: 'primary' | 'secondary' };
  readonly preview: PreviewShape;
  readonly footprint: Footprint;
  readonly range: { min: number; max: number };
  readonly inventoryCost: number;
  readonly initialInventory: number;
  readonly motion?: ProjectileMotion;
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
  trajectoryHeight: 1.8,
} as const;
export type ProjectileMotion = {
  response: 'roll' | 'bounce' | 'stick';
  gravity: number; landingSpeed: number; groundDrag: number; airDrag: number;
  restitution: number; settleSpeed: number;
};
// Motion data is independent of rendering; future projectiles can use other responses.
export const BOMB_MOTION: ProjectileMotion = {
  response: 'roll', gravity: 18, landingSpeed: 1.65, groundDrag: 5.5,
  airDrag: 0.5, restitution: 0.22, settleSpeed: 0.16,
};
const WALL_FOOTPRINT = { kind: 'box', ...WALL_TYPES[DEFAULT_PLAYER_WALL_TYPE].placementFootprint } as const;
const BOMB_FOOTPRINT = { kind: 'circle', radius: 0.34 } as const;

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

function bombPlacementValid(placement: Placement, context: PlacementContext): boolean {
  const p = placement.position;
  const radius = BOMB_FOOTPRINT.radius;
  const b = context.arena.bounds;
  if (p.x - radius < b.minX + BOUNDARY_CLEARANCE || p.x + radius > b.maxX - BOUNDARY_CLEARANCE ||
      p.z - radius < b.minZ + BOUNDARY_CLEARANCE || p.z + radius > b.maxZ - BOUNDARY_CLEARANCE) return false;
  return true;
}

type LandingSurface = { height: number; support: RuntimeBomb['support'] };
export function bombLandingSurface(position: Vec2, walls: readonly RuntimeWall[], bombs: readonly RuntimeBomb[], excludeId?: string): LandingSurface {
  let surface: LandingSurface = { height: 0, support: null };
  for (const wall of walls) {
    const local = localPoint(position, wall);
    if (Math.abs(local.x) <= wall.width / 2 && Math.abs(local.z) <= wall.depth / 2 && WALL_HEIGHT > surface.height) {
      surface = { height: WALL_HEIGHT, support: { kind: 'wall', id: wall.id } };
    }
  }
  for (const bomb of bombs) {
    if (bomb.id === excludeId || bomb.phase !== 'lit') continue;
    if (Math.hypot(position.x - bomb.position.x, position.z - bomb.position.z) > BOMB_FOOTPRINT.radius * 1.5) continue;
    const height = bomb.height + BOMB_FOOTPRINT.radius * 2;
    if (height > surface.height) surface = { height, support: { kind: 'bomb', id: bomb.id } };
  }
  return surface;
}

function supportedHeight(bomb: RuntimeBomb, state: DeploymentState): number | null {
  if (!bomb.support) return 0;
  if (bomb.support.kind === 'wall') {
    const wall = state.walls.find(wall => wall.id === bomb.support?.id);
    return wall && circleTouchesWall(bomb.position, BOMB_FOOTPRINT.radius, wall) ? WALL_HEIGHT : null;
  }
  const lower = state.bombs.find(other => other.id === bomb.support?.id && other.phase === 'lit');
  return lower && Math.hypot(bomb.position.x - lower.position.x, bomb.position.z - lower.position.z) <= BOMB_FOOTPRINT.radius * 2
    ? lower.height + BOMB_FOOTPRINT.radius * 2 : null;
}

function advanceBombMotion(bomb: RuntimeBomb, state: DeploymentState, arena: ArenaDefinition, dt: number): void {
  const motion = DEPLOYABLES[bomb.definitionId].motion ?? BOMB_MOTION;
  const supportHeight = supportedHeight(bomb, state);
  if (supportHeight === null) bomb.support = null;
  const grounded = supportHeight !== null && bomb.height <= supportHeight + 0.01 && bomb.verticalVelocity <= 0;
  const damping = Math.exp(-(grounded ? motion.groundDrag : motion.airDrag) * dt);
  bomb.velocity.x *= damping;
  bomb.velocity.z *= damping;
  if (grounded && Math.hypot(bomb.velocity.x, bomb.velocity.z) < motion.settleSpeed) bomb.velocity = { x: 0, z: 0 };

  const previous = bomb.position;
  const wanted = { x: previous.x + bomb.velocity.x * dt, z: previous.z + bomb.velocity.z * dt };
  const bounds = arena.bounds;
  const radius = BOMB_FOOTPRINT.radius;
  const candidate = {
    x: Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, wanted.x)),
    z: Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, wanted.z)),
  };
  if (candidate.x !== wanted.x) bomb.velocity.x *= -motion.restitution;
  if (candidate.z !== wanted.z) bomb.velocity.z *= -motion.restitution;
  if (bomb.height < WALL_HEIGHT - 0.01 && bomb.support?.kind !== 'wall') {
    bomb.position = movePlayerWithCollision(previous,
      { x: candidate.x - previous.x, z: candidate.z - previous.z }, arena, radius, state.walls);
    if (dt > 0) {
      if (Math.abs(bomb.position.x - candidate.x) > 0.001) bomb.velocity.x = (bomb.position.x - previous.x) / dt;
      if (Math.abs(bomb.position.z - candidate.z) > 0.001) bomb.velocity.z = (bomb.position.z - previous.z) / dt;
    }
  } else bomb.position = candidate;

  const currentSupport = supportedHeight(bomb, state);
  if (currentSupport === null) bomb.support = null;
  const floor = currentSupport ?? 0;
  if (bomb.height > floor + 0.001 || bomb.verticalVelocity > 0) {
    bomb.verticalVelocity -= motion.gravity * dt;
    bomb.height += bomb.verticalVelocity * dt;
    if (bomb.height <= floor) {
      bomb.height = floor;
      bomb.verticalVelocity = Math.abs(bomb.verticalVelocity) * motion.restitution;
      if (bomb.verticalVelocity < motion.settleSpeed || motion.response === 'stick') bomb.verticalVelocity = 0;
      if (motion.response === 'stick') bomb.velocity = { x: 0, z: 0 };
    }
  } else {
    bomb.height = floor;
    bomb.verticalVelocity = 0;
  }
}

function tickBomb(entity: RuntimeEntity, { state, arena, dt }: TickContext): boolean {
  if (entity.kind !== 'bomb') return true;
  if (entity.phase === 'flying') {
    const remaining = entity.travelDuration - entity.travelElapsed;
    const travelStep = Math.min(dt, remaining);
    entity.travelElapsed += travelStep;
    const progress = Math.min(1, entity.travelElapsed / entity.travelDuration);
    entity.position = {
      x: entity.origin.x + (entity.target.x - entity.origin.x) * progress,
      z: entity.origin.z + (entity.target.z - entity.origin.z) * progress,
    };
    const landing = bombLandingSurface(entity.target, state.walls, state.bombs, entity.id);
    entity.height = landing.height * progress + 4 * BOMB_THROW.trajectoryHeight * progress * (1 - progress);
    if (progress < 1) return true;
    entity.phase = 'lit';
    entity.position = { ...entity.target };
    entity.height = landing.height;
    entity.support = landing.support;
    const direction = { x: entity.target.x - entity.origin.x, z: entity.target.z - entity.origin.z };
    const distance = Math.hypot(direction.x, direction.z);
    entity.velocity = distance > 0 ? { x: direction.x / distance * BOMB_MOTION.landingSpeed, z: direction.z / distance * BOMB_MOTION.landingSpeed } : { x: 0, z: 0 };
    dt -= travelStep;
    if (dt <= 0) return true;
  }
  advanceBombMotion(entity, state, arena, dt);
  entity.fuseRemaining -= dt;
  if (entity.fuseRemaining > 0) return true;
  state.explosions.push({
    id: entity.id, position: { ...entity.position }, radius: BOMB_RADIUS,
    remaining: EXPLOSION_DURATION, duration: EXPLOSION_DURATION,
  });
  // A spatial event: nearest point on each wall footprint determines the hit.
  for (const wall of state.walls) {
    if (circleTouchesWall(entity.position, BOMB_RADIUS, wall)) wall.hp -= BOMB_DAMAGE;
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
    inventoryCost: 1, initialInventory: 5,
    isValid: wallPlacementValid,
    deploy: (id, owner, placement): RuntimeWall => ({
      kind: 'wall', definitionId: 'wall', id, owner, source: 'deployed', type: DEFAULT_PLAYER_WALL_TYPE,
      position: { ...placement.position }, rotation: placement.rotation,
      width: WALL_FOOTPRINT.width, depth: WALL_FOOTPRINT.depth, hp: WALL_TYPES[DEFAULT_PLAYER_WALL_TYPE].maxHealth,
    }),
  },
  bomb: {
    id: 'bomb', label: 'Bomb',
    motion: BOMB_MOTION,
    control: { icon: 'bomb', size: 'primary' },
    preview: { kind: 'sphere', radius: BOMB_FOOTPRINT.radius },
    footprint: BOMB_FOOTPRINT,
    range: { min: BOMB_THROW.minimumDistance, max: BOMB_THROW.maximumDistance },
    inventoryCost: 1, initialInventory: 2,
    isValid: bombPlacementValid,
    deploy: (id, owner, placement, origin): RuntimeBomb => ({
      kind: 'bomb', definitionId: 'bomb', id, owner,
      origin: { ...origin }, target: { ...placement.position }, position: { ...origin }, height: 0,
      phase: 'flying', travelElapsed: 0,
      velocity: { x: 0, z: 0 }, verticalVelocity: 0, support: null,
      travelDuration: Math.max(BOMB_THROW.minimumTravelTime,
        Math.hypot(placement.position.x - origin.x, placement.position.z - origin.z) / BOMB_THROW.travelSpeed),
      fuseRemaining: BOMB_FUSE, fuseDuration: BOMB_FUSE,
    }),
    tick: tickBomb,
  },
};

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

export function tickDeploymentState(state: DeploymentState, dt: number, arena: ArenaDefinition): void {
  for (const explosion of state.explosions) explosion.remaining -= dt;
  state.explosions = state.explosions.filter(explosion => explosion.remaining > 0);
  state.bombs = state.bombs.filter(bomb => DEPLOYABLES[bomb.definitionId].tick?.(bomb, { state, arena, dt }) !== false);
}
