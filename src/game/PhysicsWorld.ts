import { Body, Box, ContactMaterial, Material, Plane, Sphere, Vec3, World } from 'cannon-es';
import { WALL_HEIGHT, type ArenaDefinition, type Team, type Vec2 } from './arena.ts';
import type { GameState } from './GameMode.ts';
import { type DeploymentState, type RuntimeBomb, type RuntimeWall } from './deployables.ts';
import { BOMB_FLIGHT, bombLaunch } from './trajectory.ts';

/** The simulation owns rigid bodies. Three.js only consumes the plain positions copied out here. */
export class PhysicsWorld {
  readonly world = new World({ gravity: new Vec3(0, -BOMB_FLIGHT.gravity, 0) });
  private readonly players: Record<Team, Body>;
  private readonly walls = new Map<string, Body>();
  private readonly bombs = new Map<string, Body>();
  private readonly lastPlayerPosition: Record<Team, Vec2>;
  private readonly solid = new Material('arena');
  private readonly playerMaterial = new Material('player');
  private readonly bombMaterial = new Material('bomb');

  constructor(arena: ArenaDefinition, state: GameState, deployments: DeploymentState, playerRadius: number) {
    this.world.allowSleep = true;
    this.world.addContactMaterial(new ContactMaterial(this.bombMaterial, this.solid, { friction: 0.55, restitution: 0.42 }));
    this.world.addContactMaterial(new ContactMaterial(this.bombMaterial, this.bombMaterial, { friction: 0.3, restitution: 0.62 }));
    this.world.addContactMaterial(new ContactMaterial(this.bombMaterial, this.playerMaterial, { friction: 0.25, restitution: 0.5 }));
    this.world.addContactMaterial(new ContactMaterial(this.playerMaterial, this.solid, { friction: 0, restitution: 0 }));
    this.world.addContactMaterial(new ContactMaterial(this.playerMaterial, this.playerMaterial, { friction: 0, restitution: 0 }));

    const floor = new Body({ mass: 0, material: this.solid, shape: new Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floor);
    const b = arena.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const width = b.maxX - b.minX;
    const depth = b.maxZ - b.minZ;
    for (const [x, z, sx, sz] of [
      [b.minX - 0.3, cz, 0.6, depth + 1.2], [b.maxX + 0.3, cz, 0.6, depth + 1.2],
      [cx, b.minZ - 0.3, width + 1.2, 0.6], [cx, b.maxZ + 0.3, width + 1.2, 0.6],
    ]) {
      this.world.addBody(new Body({ mass: 0, material: this.solid, shape: new Box(new Vec3(sx / 2, 2, sz / 2)), position: new Vec3(x, 2, z) }));
    }

    this.players = {
      red: this.makePlayer(state.players.red.position, playerRadius),
      blue: this.makePlayer(state.players.blue.position, playerRadius),
    };
    this.lastPlayerPosition = {
      red: { ...state.players.red.position }, blue: { ...state.players.blue.position },
    };
    this.syncWalls(deployments.walls);
  }

  private makePlayer(position: Vec2, radius: number): Body {
    const body = new Body({ mass: 4, material: this.playerMaterial, shape: new Sphere(radius), position: new Vec3(position.x, radius, position.z), linearDamping: 0, fixedRotation: true });
    body.linearFactor.set(1, 0, 1);
    this.world.addBody(body);
    return body;
  }

  syncWalls(walls: readonly RuntimeWall[]): void {
    const ids = new Set(walls.map(wall => wall.id));
    for (const [id, body] of this.walls) if (!ids.has(id)) { this.world.removeBody(body); this.walls.delete(id); }
    for (const wall of walls) {
      if (this.walls.has(wall.id)) continue;
      const body = new Body({ mass: 0, material: this.solid,
        shape: new Box(new Vec3(wall.width / 2, WALL_HEIGHT / 2, wall.depth / 2)),
        position: new Vec3(wall.position.x, WALL_HEIGHT / 2, wall.position.z),
      });
      body.quaternion.setFromEuler(0, wall.rotation, 0);
      this.world.addBody(body);
      this.walls.set(wall.id, body);
    }
  }

  addBomb(bomb: RuntimeBomb): void {
    const launch = bombLaunch(bomb.origin, bomb.target, bomb.physicalRadius);
    const body = new Body({ mass: bomb.definitionId === 'mega-bomb' ? 1.7 : 1, material: this.bombMaterial, shape: new Sphere(bomb.physicalRadius),
      position: new Vec3(launch.position.x, launch.position.y, launch.position.z),
      linearDamping: BOMB_FLIGHT.linearDamping, angularDamping: 0.35, sleepSpeedLimit: 0.08, sleepTimeLimit: 0.6,
    });
    body.velocity.set(launch.velocity.x, launch.velocity.y, launch.velocity.z);
    body.addEventListener('collide', () => { bomb.phase = 'lit'; });
    this.world.addBody(body);
    this.bombs.set(bomb.id, body);
    this.copyBomb(bomb, body);
  }

  removeMissingBombs(bombs: readonly RuntimeBomb[]): void {
    const ids = new Set(bombs.map(bomb => bomb.id));
    for (const [id, body] of this.bombs) if (!ids.has(id)) { this.world.removeBody(body); this.bombs.delete(id); }
  }

  getBombBody(id: string): Body | undefined { return this.bombs.get(id); }
  getPlayerBody(team: Team): Body { return this.players[team]; }
  capPlayerSpeed(team: Team, maximum: number): void {
    const velocity = this.players[team].velocity;
    const horizontal = Math.hypot(velocity.x, velocity.z);
    if (horizontal > maximum) {
      velocity.x *= maximum / horizontal;
      velocity.z *= maximum / horizontal;
    }
  }

  step(dt: number, state: GameState, deployments: DeploymentState, input: Record<Team, Vec2>, speed: Record<Team, number>, acceleration: number, braking: number): void {
    this.syncWalls(deployments.walls);
    for (const team of ['red', 'blue'] as const) {
      const body = this.players[team];
      const player = state.players[team];
      const last = this.lastPlayerPosition[team];
      // Editor/tests can reposition plain state; bring the matching rigid body with it.
      if (Math.hypot(player.position.x - last.x, player.position.z - last.z) > 0.001) {
        body.position.set(player.position.x, body.shapes[0].boundingSphereRadius, player.position.z);
        body.velocity.setZero();
        body.wakeUp();
      }
      const raw = input[team];
      const length = Math.hypot(raw.x, raw.z);
      const targetX = raw.x / Math.max(1, length) * speed[team];
      const targetZ = raw.z / Math.max(1, length) * speed[team];
      const differenceX = targetX - body.velocity.x;
      const differenceZ = targetZ - body.velocity.z;
      const distance = Math.hypot(differenceX, differenceZ);
      const change = Math.min(distance, (length > 0 ? acceleration : braking) * dt);
      if (distance > 0) {
        body.velocity.x += differenceX / distance * change;
        body.velocity.z += differenceZ / distance * change;
        if (change > 0) body.wakeUp();
      }
      if (length > 0) player.facing = Math.atan2(raw.x, raw.z);
    }
    this.world.step(1 / 120, dt, 3);
    for (const team of ['red', 'blue'] as const) {
      const body = this.players[team];
      state.players[team].position = { x: body.position.x, z: body.position.z };
      this.lastPlayerPosition[team] = { ...state.players[team].position };
    }
    for (const bomb of deployments.bombs) {
      const body = this.bombs.get(bomb.id);
      if (body) this.copyBomb(bomb, body);
    }
  }

  private copyBomb(bomb: RuntimeBomb, body: Body): void {
    bomb.position = { x: body.position.x, z: body.position.z };
    bomb.height = body.position.y - bomb.physicalRadius;
    bomb.velocity = { x: body.velocity.x, z: body.velocity.z };
    bomb.verticalVelocity = body.velocity.y;
    bomb.orientation = { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w };
  }
}
