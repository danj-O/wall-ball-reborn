import { localPoint, territoryAt, WALL_HEIGHT, type ArenaDefinition, type Team, type Vec2 } from './arena.ts';
import { createEconomyState, tickEconomy, transferOnTerritoryTag, type EconomyState } from './economy.ts';
import type { GameMode, GameState } from './GameMode.ts';
import {
  AIM_DEAD_ZONE, createDeploymentState, DEPLOYABLES, tickDeploymentState,
  type DeployableId, type DeploymentPreview, type DeploymentState, type PlacementContext,
} from './deployables.ts';
import { PhysicsWorld } from './PhysicsWorld.ts';
import { createPowerUpState, POWER_UP_CONFIG, POWER_UPS, tickPowerUps, type PowerUpState } from './powerups.ts';
import { predictBombTrajectory } from './trajectory.ts';
import { createMatchState, type MatchState } from './match.ts';
import { DEFAULT_GAME_SETTINGS } from './gameSettings.ts';
import type { GameSettings } from './gameSettingsSchema.ts';

export type MoveInput = Record<Team, Vec2>;

export class Game {
  readonly playerRadius = 0.38;
  get speed(): number { return this.settings.runSpeed; }
  get acceleration(): number { return this.settings.acceleration; }
  get braking(): number { return this.settings.braking; }
  readonly arena: ArenaDefinition;
  readonly mode: GameMode;
  state: GameState;
  deployments: DeploymentState;
  economy: EconomyState;
  physics: PhysicsWorld;
  powerUps: PowerUpState;
  match: MatchState = createMatchState();
  lastTheft: { sequence: number; text: string; defender: Team; invader: Team; walls: number; bombs: number } | null = null;
  private theftSequence = 0;
  private nextEntityId = 0;
  private readonly rng: () => number;
  settings: GameSettings;

  constructor(arena: ArenaDefinition, mode: GameMode, rng: () => number = Math.random, settings: GameSettings = DEFAULT_GAME_SETTINGS) {
    this.arena = arena;
    this.mode = mode;
    this.rng = rng;
    this.settings = structuredClone(settings);
    this.state = mode.createState(arena);
    this.deployments = createDeploymentState(arena, this.settings.startingInventory);
    this.economy = createEconomyState(arena, this.settings);
    this.physics = new PhysicsWorld(arena, this.state, this.deployments, this.playerRadius, this.settings.playerMass);
    this.powerUps = createPowerUpState(rng);
  }

  reset(): void {
    this.match = createMatchState();
    this.state = this.mode.createState(this.arena);
    this.deployments = createDeploymentState(this.arena, this.settings.startingInventory);
    this.economy = createEconomyState(this.arena, this.settings);
    this.lastTheft = null;
    this.theftSequence = 0;
    this.nextEntityId = 0;
    this.physics = new PhysicsWorld(this.arena, this.state, this.deployments, this.playerRadius, this.settings.playerMass);
    this.powerUps = createPowerUpState(this.rng);
  }

  start(): boolean {
    if (this.match.phase !== 'ready') return false;
    this.match.phase = 'playing';
    return true;
  }

  setSettings(settings: GameSettings): void {
    const previous = this.settings;
    this.settings = structuredClone(settings);
    this.physics.setPlayerMass(this.settings.playerMass);
    this.physics.capPlayerSpeed('red', this.speed * (this.powerUps.players.red.speedRemaining > 0 ? POWER_UP_CONFIG.speedMultiplier : 1));
    this.physics.capPlayerSpeed('blue', this.speed * (this.powerUps.players.blue.speedRemaining > 0 ? POWER_UP_CONFIG.speedMultiplier : 1));
    for (const team of ['red', 'blue'] as const) {
      for (const resource of ['wall', 'bomb'] as const) {
        const remaining = resource === 'wall' ? this.economy.passiveWallRemaining : this.economy.passiveBombRemaining;
        const before = previous.passiveRegenSeconds[resource];
        const after = this.settings.passiveRegenSeconds[resource];
        if (before !== after) remaining[team] = after === 0 ? 0 : before === 0 ? after : Math.max(0.01, remaining[team] / before * after);
      }
    }
    for (const depot of this.economy.depots) {
      const before = previous.depotGenerationSeconds[depot.type];
      const after = this.settings.depotGenerationSeconds[depot.type];
      if (before !== after) depot.generationRemaining = Math.max(0.01, depot.generationRemaining / before * after);
    }
  }

  beginDeployAim(team: Team, id: DeployableId): void {
    if (this.match.phase !== 'playing') return;
    if (id === 'mega-bomb' && this.powerUps.players[team].charges['mega-bomb'] <= 0) return;
    this.deployments.aim[team][id] = { definitionId: id, direction: { x: 0, z: 0 }, strength: 0, preview: null };
  }

  updateDeployAim(team: Team, id: DeployableId, direction: Vec2, strength: number): DeploymentPreview | null {
    const aim = this.deployments.aim[team][id];
    if (!aim || this.match.phase !== 'playing') return null;
    aim.strength = Math.max(0, Math.min(1, strength));
    const length = Math.hypot(direction.x, direction.z);
    aim.direction = length > 0 ? { x: direction.x / length, z: direction.z / length } : { x: 0, z: 0 };
    aim.preview = this.proposePlacement(team, id);
    return aim.preview;
  }

  cancelDeployAim(team: Team, id?: DeployableId): void {
    if (id) delete this.deployments.aim[team][id];
    else this.deployments.aim[team] = {};
  }

  releaseDeployAim(team: Team, id: DeployableId): 'placed' | 'cancelled' | 'invalid' {
    if (this.match.phase !== 'playing') { this.cancelDeployAim(team, id); return 'cancelled'; }
    const aim = this.deployments.aim[team][id];
    if (!aim) return 'cancelled';
    const preview = this.proposePlacement(team, id);
    delete this.deployments.aim[team][id];
    if (aim.strength <= AIM_DEAD_ZONE) return 'cancelled';
    if (!preview?.valid) return 'invalid';
    const definition = DEPLOYABLES[preview.definitionId];
    // Rechecked immediately before spending inventory.
    const entity = definition.deploy(`${team}-${++this.nextEntityId}`, team, preview, this.state.players[team].position);
    if (entity.kind === 'wall') {
      this.match.stats[team].wallsPlaced++;
      this.deployments.walls.push(entity);
      this.physics.syncWalls(this.deployments.walls);
    } else {
      entity.fuseDuration = this.settings.projectiles[entity.definitionId].fuseSeconds;
      entity.fuseRemaining = entity.fuseDuration;
      entity.blastRadius = this.settings.projectiles[entity.definitionId].blastRadius;
      entity.blastForce = this.settings.projectiles[entity.definitionId].blastForce;
      entity.blastLift = this.settings.projectiles[entity.definitionId].blastLift;
      entity.originHeight = this.state.players[team].height;
      this.match.stats[team].bombsThrown++;
      this.deployments.bombs.push(entity);
      this.physics.addBomb(entity, this.settings.projectiles[entity.definitionId], this.deployments.walls);
    }
    if (definition.id === 'mega-bomb') this.powerUps.players[team].charges['mega-bomb']--;
    else this.deployments.inventory[team][definition.id] -= definition.inventoryCost;
    return 'placed';
  }

  private placementContext(): PlacementContext {
    return {
      arena: this.arena, walls: this.deployments.walls, bombs: this.deployments.bombs,
      players: this.state.players,
    };
  }

  private proposePlacement(team: Team, id: DeployableId): DeploymentPreview | null {
    const aim = this.deployments.aim[team][id];
    if (!aim || aim.strength <= AIM_DEAD_ZONE) return null;
    const player = this.state.players[team];
    const direction = Math.hypot(aim.direction.x, aim.direction.z) > 0
      ? aim.direction : { x: Math.sin(player.facing), z: Math.cos(player.facing) };
    const definition = DEPLOYABLES[id];
    const amount = (aim.strength - AIM_DEAD_ZONE) / (1 - AIM_DEAD_ZONE);
    const distance = definition.range.min + (definition.range.max - definition.range.min) * amount;
    const placement = {
      position: { x: player.position.x + direction.x * distance, z: player.position.z + direction.z * distance },
      rotation: Math.atan2(direction.x, direction.z),
    };
    const wallTop = this.deployments.walls.some(wall => {
      const local = localPoint(placement.position, wall);
      return Math.abs(local.x) <= wall.width / 2 && Math.abs(local.z) <= wall.depth / 2;
    }) ? WALL_HEIGHT : 0;
    const bombTop = this.deployments.bombs.reduce((height, bomb) =>
      Math.hypot(placement.position.x - bomb.position.x, placement.position.z - bomb.position.z) < 0.6
        ? Math.max(height, bomb.height + bomb.physicalRadius * 2) : height, 0);
    return {
      ...placement, definitionId: definition.id,
      landingHeight: id !== 'wall' ? Math.max(wallTop, bombTop) : 0,
      trajectory: definition.footprint.kind === 'circle'
        ? predictBombTrajectory(player.position, placement.position, definition.footprint.radius,
          this.arena.bounds, this.deployments.walls, this.state.players, this.playerRadius,
          this.deployments.bombs, team, this.settings.projectiles[id as 'bomb' | 'mega-bomb'], player.height)
        : undefined,
      valid: (id === 'mega-bomb' ? this.powerUps.players[team].charges['mega-bomb'] > 0
        : this.deployments.inventory[team][id] >= definition.inventoryCost) &&
        definition.isValid(placement, this.placementContext()),
    };
  }

  update(dt: number, input: MoveInput): void {
    if (this.match.phase !== 'playing') return;
    const step = Math.min(dt, 1 / 30);
    this.match.duration += step;
    const speedBefore = { red: this.powerUps.players.red.speedRemaining, blue: this.powerUps.players.blue.speedRemaining };
    const speeds = {
      red: this.speed * (this.powerUps.players.red.speedRemaining > 0 ? POWER_UP_CONFIG.speedMultiplier : 1),
      blue: this.speed * (this.powerUps.players.blue.speedRemaining > 0 ? POWER_UP_CONFIG.speedMultiplier : 1),
    };
    this.physics.step(step, this.state, this.deployments, input, speeds, this.acceleration, this.braking,
      this.settings.airControl, this.settings.airBraking);
    tickDeploymentState(this.deployments, step, owner => { this.match.stats[owner].wallsDestroyed++; },
      bomb => this.physics.applyBlast(bomb, {
        blastForce: bomb.blastForce ?? this.settings.projectiles[bomb.definitionId].blastForce,
        blastLift: bomb.blastLift ?? this.settings.projectiles[bomb.definitionId].blastLift,
      }, this.state));
    this.physics.removeMissingBombs(this.deployments.bombs);
    this.physics.syncWalls(this.deployments.walls);
    const priorCollection = this.powerUps.lastCollection?.sequence;
    tickPowerUps(this.powerUps, this.arena, this.deployments.walls, this.state.players, step, this.rng,
      team => { this.match.stats[team].powerUpsCollected++; });
    for (const team of ['red', 'blue'] as const) {
      if (speedBefore[team] > 0 && this.powerUps.players[team].speedRemaining === 0) this.physics.capPlayerSpeed(team, this.speed);
    }
    if (this.powerUps.lastCollection?.sequence !== priorCollection && this.powerUps.lastCollection) {
      const collection = this.powerUps.lastCollection;
      this.state.event = `${collection.team.toUpperCase()} picked up ${POWER_UPS[collection.definitionId].presentation.label}!`;
    }
    tickEconomy(this.economy, this.deployments, this.state.players, step, this.settings);
    for (const team of ['red', 'blue'] as const) {
      for (const id of Object.keys(this.deployments.aim[team]) as DeployableId[]) {
        const aim = this.deployments.aim[team][id];
        if (aim) aim.preview = this.proposePlacement(team, id);
      }
    }
    for (const team of ['red', 'blue'] as const) {
      const territory = territoryAt(this.state.players[team].position, this.arena);
      this.economy.territory[team] = territory;
      if (territory === team || territory === 'contested') this.economy.theftUsedThisVisit[team] = false;
    }
    const previousEvent = this.state.event;
    this.mode.update(this.state, this.arena);
    if (this.state.winner) {
      this.match.winner = this.state.winner;
      this.match.phase = 'finished';
      this.cancelDeployAim('red');
      this.cancelDeployAim('blue');
      return;
    }
    const red = this.state.players.red.position;
    const blue = this.state.players.blue.position;
    if (!this.state.players.red.airborne && !this.state.players.blue.airborne &&
        Math.hypot(red.x - blue.x, red.z - blue.z) < 0.9) {
      for (const invader of ['red', 'blue'] as const) {
        const defender: Team = invader === 'red' ? 'blue' : 'red';
        if (this.economy.territory[invader] !== defender || this.economy.theftUsedThisVisit[invader]) continue;
        if (this.powerUps.players[invader].shieldRemaining > 0) continue;
        const stolen = transferOnTerritoryTag(invader, this.deployments);
        this.economy.theftUsedThisVisit[invader] = true;
        if (stolen.walls + stolen.bombs > 0) {
          this.match.stats[defender].resourcesStolen += stolen.walls + stolen.bombs;
          const text = `${defender.toUpperCase()} tagged ${invader.toUpperCase()} · +${stolen.walls} walls, +${stolen.bombs} bombs`;
          this.lastTheft = { sequence: ++this.theftSequence, text, defender, invader, walls: stolen.walls, bombs: stolen.bombs };
          if (this.state.event === previousEvent) this.state.event = text;
        }
      }
    }
  }
}
