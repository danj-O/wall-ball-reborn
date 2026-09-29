import { territoryAt, type ArenaDefinition, type DepotDefinition, type Team, type Vec2 } from './arena.ts';
import type { DeploymentState } from './deployables.ts';
import type { PlayerState } from './GameMode.ts';
import type { GameSettings } from './gameSettingsSchema.ts';

export const ECONOMY_CONFIG = {
  passiveBombInterval: 10,
  depots: {
    wall: { initialStock: 1, firstGenerationDelay: 6, generationInterval: 6 },
    bomb: { initialStock: 1, firstGenerationDelay: 15, generationInterval: 6 },
  },
} as const;

export type RuntimeDepot = DepotDefinition & {
  stock: number; generationRemaining: number; nextCollector: Team;
};
export type EconomyState = {
  passiveBombRemaining: Record<Team, number>;
  passiveWallRemaining: Record<Team, number>;
  depots: RuntimeDepot[];
  territory: Record<Team, 'red' | 'blue' | 'contested'>;
  theftUsedThisVisit: Record<Team, boolean>;
};

export function createEconomyState(arena: ArenaDefinition, settings?: GameSettings): EconomyState {
  const bombInterval = settings?.passiveRegenSeconds.bomb ?? ECONOMY_CONFIG.passiveBombInterval;
  const wallInterval = settings?.passiveRegenSeconds.wall ?? 0;
  return {
    passiveBombRemaining: { red: bombInterval, blue: bombInterval },
    passiveWallRemaining: { red: wallInterval, blue: wallInterval },
    depots: arena.depots.map(depot => ({
      ...structuredClone(depot), stock: ECONOMY_CONFIG.depots[depot.type].initialStock,
      generationRemaining: ECONOMY_CONFIG.depots[depot.type].firstGenerationDelay *
        (settings?.depotGenerationSeconds[depot.type] ?? ECONOMY_CONFIG.depots[depot.type].generationInterval) /
        ECONOMY_CONFIG.depots[depot.type].generationInterval,
      nextCollector: 'red',
    })),
    territory: {
      red: territoryAt(arena.playerSpawns.red, arena),
      blue: territoryAt(arena.playerSpawns.blue, arena),
    },
    theftUsedThisVisit: { red: false, blue: false },
  };
}

export function depotContains(depot: DepotDefinition, point: Vec2): boolean {
  return Math.hypot(point.x - depot.position.x, point.z - depot.position.z) <= depot.radius;
}

export function transferOnTerritoryTag(invader: Team, deployment: DeploymentState): { walls: number; bombs: number } {
  const defender: Team = invader === 'red' ? 'blue' : 'red';
  const walls = Math.floor(deployment.inventory[invader].wall / 2);
  const bombs = Math.floor(deployment.inventory[invader].bomb / 2);
  deployment.inventory[invader].wall -= walls;
  deployment.inventory[invader].bomb -= bombs;
  deployment.inventory[defender].wall += walls;
  deployment.inventory[defender].bomb += bombs;
  return { walls, bombs };
}

export function tickEconomy(
  economy: EconomyState, deployment: DeploymentState, players: Record<Team, PlayerState>, dt: number,
  settings?: GameSettings,
): void {
  for (const team of ['red', 'blue'] as const) {
    for (const resource of ['wall', 'bomb'] as const) {
      const interval = settings?.passiveRegenSeconds[resource] ?? (resource === 'bomb' ? ECONOMY_CONFIG.passiveBombInterval : 0);
      const remaining = resource === 'bomb' ? economy.passiveBombRemaining : economy.passiveWallRemaining;
      if (interval === 0) { remaining[team] = 0; continue; }
      remaining[team] -= dt;
      while (remaining[team] <= 0) {
        deployment.inventory[team][resource]++;
        remaining[team] += interval;
      }
    }
  }
  for (const depot of economy.depots) {
    const config = ECONOMY_CONFIG.depots[depot.type];
    const interval = settings?.depotGenerationSeconds[depot.type] ?? config.generationInterval;
    depot.generationRemaining -= dt;
    while (depot.generationRemaining <= 0) {
      depot.stock = Math.min(depot.capacity, depot.stock + 1);
      depot.generationRemaining += interval;
    }
    const occupants = (['red', 'blue'] as const).filter(team => depotContains(depot, players[team].position));
    while (depot.stock > 0 && occupants.length > 0) {
      const collector = occupants.includes(depot.nextCollector) ? depot.nextCollector : occupants[0];
      deployment.inventory[collector][depot.type]++;
      depot.stock--;
      depot.nextCollector = collector === 'red' ? 'blue' : 'red';
    }
  }
}
