import { movePlayerWithCollision, territoryAt, type ArenaDefinition, type Team, type Vec2 } from './arena.ts';
import { createEconomyState, tickEconomy, transferOnTerritoryTag, type EconomyState } from './economy.ts';
import type { GameMode, GameState } from './GameMode.ts';
import {
  AIM_DEAD_ZONE, createDeploymentState, DEPLOYABLES, tickDeploymentState,
  type DeployableId, type DeploymentPreview, type DeploymentState, type PlacementContext,
} from './deployables.ts';

export type MoveInput = Record<Team, Vec2>;

export class Game {
  readonly playerRadius = 0.38;
  readonly speed = 5.2;
  readonly arena: ArenaDefinition;
  readonly mode: GameMode;
  state: GameState;
  deployments: DeploymentState;
  economy: EconomyState;
  lastTheft: { sequence: number; text: string } | null = null;
  private theftSequence = 0;
  private nextEntityId = 0;

  constructor(arena: ArenaDefinition, mode: GameMode) {
    this.arena = arena;
    this.mode = mode;
    this.state = mode.createState(arena);
    this.deployments = createDeploymentState(arena);
    this.economy = createEconomyState(arena);
  }

  reset(): void {
    this.state = this.mode.createState(this.arena);
    this.deployments = createDeploymentState(this.arena);
    this.economy = createEconomyState(this.arena);
    this.lastTheft = null;
    this.theftSequence = 0;
    this.nextEntityId = 0;
  }

  beginDeployAim(team: Team, id: DeployableId): void {
    if (this.state.winner) return;
    this.deployments.aim[team][id] = { definitionId: id, direction: { x: 0, z: 0 }, strength: 0, preview: null };
  }

  updateDeployAim(team: Team, id: DeployableId, direction: Vec2, strength: number): DeploymentPreview | null {
    const aim = this.deployments.aim[team][id];
    if (!aim || this.state.winner) return null;
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
    const aim = this.deployments.aim[team][id];
    if (!aim) return 'cancelled';
    const preview = this.proposePlacement(team, id);
    delete this.deployments.aim[team][id];
    if (aim.strength <= AIM_DEAD_ZONE) return 'cancelled';
    if (!preview?.valid) return 'invalid';
    const definition = DEPLOYABLES[preview.definitionId];
    // Rechecked immediately before spending inventory.
    const entity = definition.deploy(`${team}-${++this.nextEntityId}`, team, preview, this.state.players[team].position);
    if (entity.kind === 'wall') this.deployments.walls.push(entity);
    else this.deployments.bombs.push(entity);
    this.deployments.inventory[team][definition.id] -= definition.inventoryCost;
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
    return {
      ...placement, definitionId: definition.id,
      valid: this.deployments.inventory[team][definition.id] >= definition.inventoryCost &&
        definition.isValid(placement, this.placementContext()),
    };
  }

  update(dt: number, input: MoveInput): void {
    if (this.state.winner) return;
    const step = Math.min(dt, 1 / 30);
    for (const team of ['red', 'blue'] as const) {
      const player = this.state.players[team];
      const raw = input[team];
      const length = Math.hypot(raw.x, raw.z);
      if (length === 0) continue;
      const dx = raw.x / Math.max(1, length) * this.speed * step;
      const dz = raw.z / Math.max(1, length) * this.speed * step;
      player.facing = Math.atan2(dx, dz);
      player.position = movePlayerWithCollision(
        player.position, { x: dx, z: dz }, this.arena, this.playerRadius, this.deployments.walls,
      );
    }
    tickDeploymentState(this.deployments, step);
    tickEconomy(this.economy, this.deployments, this.state.players, step);
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
    if (this.state.winner) return;
    const red = this.state.players.red.position;
    const blue = this.state.players.blue.position;
    if (Math.hypot(red.x - blue.x, red.z - blue.z) < 0.9) {
      for (const invader of ['red', 'blue'] as const) {
        const defender: Team = invader === 'red' ? 'blue' : 'red';
        if (this.economy.territory[invader] !== defender || this.economy.theftUsedThisVisit[invader]) continue;
        const stolen = transferOnTerritoryTag(invader, this.deployments);
        this.economy.theftUsedThisVisit[invader] = true;
        if (stolen.walls + stolen.bombs > 0) {
          const text = `${defender.toUpperCase()} tagged ${invader.toUpperCase()} · +${stolen.walls} walls, +${stolen.bombs} bombs`;
          this.lastTheft = { sequence: ++this.theftSequence, text };
          if (this.state.event === previousEvent) this.state.event = text;
        }
      }
    }
  }
}
