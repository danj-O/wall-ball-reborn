import { localPoint, WALL_HEIGHT, type ArenaBounds, type Team, type Vec2 } from './arena.ts';
import type { RuntimeBomb, RuntimeWall } from './deployables.ts';
import type { PlayerState } from './GameMode.ts';

export type FlightPoint = { x: number; y: number; z: number };
export type FlightImpact = { kind: 'floor' | 'wall' | 'boundary' | 'player' | 'bomb'; id?: string; point: FlightPoint };
export type BombTrajectory = { points: FlightPoint[]; impact: FlightImpact };

// Keep launch values shared with the rigid body that is actually thrown.
export const BOMB_FLIGHT = {
  gravity: 18, startHeight: 1.1, startOffset: 0.55,
  minimumTime: 0.55, maximumTime: 0.95, speedDivisor: 8,
  linearDamping: 0.14, predictionStep: 1 / 120, maximumPredictionTime: 2,
} as const;

export function bombLaunch(origin: Vec2, target: Vec2, radius: number): { position: FlightPoint; velocity: FlightPoint } {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const distance = Math.hypot(dx, dz);
  const travelTime = Math.max(BOMB_FLIGHT.minimumTime, Math.min(BOMB_FLIGHT.maximumTime, distance / BOMB_FLIGHT.speedDivisor));
  const offset = distance > 0 ? BOMB_FLIGHT.startOffset / distance : 0;
  return {
    position: { x: origin.x + dx * offset, y: BOMB_FLIGHT.startHeight, z: origin.z + dz * offset },
    velocity: {
      x: dx / travelTime,
      y: (radius - BOMB_FLIGHT.startHeight + BOMB_FLIGHT.gravity * travelTime * travelTime / 2) / travelTime,
      z: dz / travelTime,
    },
  };
}

function sphereTouchesWall(point: FlightPoint, radius: number, wall: RuntimeWall): boolean {
  const local = localPoint(point, wall);
  const dx = Math.max(Math.abs(local.x) - wall.width / 2, 0);
  const dz = Math.max(Math.abs(local.z) - wall.depth / 2, 0);
  const dy = Math.max(-point.y, point.y - WALL_HEIGHT, 0);
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

function firstContact(point: FlightPoint, radius: number, bounds: ArenaBounds,
  walls: readonly RuntimeWall[], players: Record<Team, PlayerState>, playerRadius: number,
  bombs: readonly RuntimeBomb[], thrower: Team): Omit<FlightImpact, 'point'> | null {
  for (const wall of walls) if (sphereTouchesWall(point, radius, wall)) return { kind: 'wall', id: wall.id };
  if (point.x - radius <= bounds.minX || point.x + radius >= bounds.maxX ||
      point.z - radius <= bounds.minZ || point.z + radius >= bounds.maxZ) return { kind: 'boundary' };
  for (const team of ['red', 'blue'] as const) {
    if (team === thrower) continue;
    const other = players[team].position;
    if (Math.hypot(point.x - other.x, point.y - playerRadius, point.z - other.z) <= radius + playerRadius)
      return { kind: 'player', id: team };
  }
  for (const bomb of bombs) {
    if (Math.hypot(point.x - bomb.position.x, point.y - bomb.height - bomb.physicalRadius,
      point.z - bomb.position.z) <= radius + bomb.physicalRadius) return { kind: 'bomb', id: bomb.id };
  }
  if (point.y <= radius) return { kind: 'floor' };
  return null;
}

/** Predicts first contact only. A bounce can depend on moving players/bombs after release. */
export function predictBombTrajectory(origin: Vec2, target: Vec2, radius: number, bounds: ArenaBounds,
  walls: readonly RuntimeWall[], players: Record<Team, PlayerState>, playerRadius: number,
  bombs: readonly RuntimeBomb[], thrower: Team): BombTrajectory {
  const launch = bombLaunch(origin, target, radius);
  const points: FlightPoint[] = [{ ...launch.position }];
  const velocity = { ...launch.velocity };
  const dt = BOMB_FLIGHT.predictionStep;
  const damping = Math.pow(1 - BOMB_FLIGHT.linearDamping, dt);
  for (let elapsed = dt; elapsed <= BOMB_FLIGHT.maximumPredictionTime + dt / 2; elapsed += dt) {
    velocity.y -= BOMB_FLIGHT.gravity * dt;
    const next = {
      x: points.at(-1)!.x + velocity.x * dt,
      y: points.at(-1)!.y + velocity.y * dt,
      z: points.at(-1)!.z + velocity.z * dt,
    };
    velocity.x *= damping;
    velocity.y *= damping;
    velocity.z *= damping;
    const contact = firstContact(next, radius, bounds, walls, players, playerRadius, bombs, thrower);
    if (contact) {
      const previous = points.at(-1)!;
      let low = 0;
      let high = 1;
      for (let i = 0; i < 10; i++) {
        const middle = (low + high) / 2;
        const candidate = {
          x: previous.x + (next.x - previous.x) * middle,
          y: previous.y + (next.y - previous.y) * middle,
          z: previous.z + (next.z - previous.z) * middle,
        };
        if (firstContact(candidate, radius, bounds, walls, players, playerRadius, bombs, thrower)) high = middle;
        else low = middle;
      }
      const point = {
        x: previous.x + (next.x - previous.x) * high,
        y: previous.y + (next.y - previous.y) * high,
        z: previous.z + (next.z - previous.z) * high,
      };
      points.push(point);
      return { points, impact: { ...contact, point } };
    }
    points.push(next);
  }
  const point = points.at(-1)!;
  return { points, impact: { kind: 'floor', point } };
}
