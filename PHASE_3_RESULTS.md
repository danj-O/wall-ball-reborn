# Phase 3 — Economy and territory foundation

## Implemented

- Default arena grew from 24 × 16 to **36 × 22 world units** without scaling players, flags, bombs, or wall footprints. The shared camera still fits the complete tabletop through `frameArena`.
- `ArenaDefinition` stores red, contested, and blue rectangular regions; initial walls with `wood` or `stone` type; persistent depot positions and trigger radii; and allowed contested areas for future random power-ups. The latter is data only.
- Contested territory has a subtle green floor tint. Depot zones are translucent rings with wall or bomb icons and stock pips. They are non-solid and do not create build exclusion zones.
- Economy state is match-local. Each player receives passive bombs, depots generate capped stock and automatically transfer it to occupants, and defenders can take resources from tagged invaders once per enemy-territory visit. Flag carrier tagging and CTF victory still use the mode rules.
- Customize Arena can add, select, move, resize, and delete depots. It can add Wood and Stone walls and retains wall movement, rotation, and deletion. The existing `wall-ball-reborn-arena-v1` local save is migrated: old default bounds expand, generic walls become Stone, and territory/depot data is supplied when absent.
- `?debug=1` displays territory, inventory, passive bomb countdown, depot stock and generation countdown, and wall type/HP. Normal gameplay hides it.

## Initial balance values

| Setting | Value | Source |
| --- | ---: | --- |
| Arena width × depth | 36 × 22 | `ARENA_SIZE` in `src/game/arena.ts` |
| Contested half-width | 5.5 | `ARENA_SIZE` |
| Starting inventory per player | 5 walls, 2 bombs | `DEPLOYABLES` in `src/game/deployables.ts` |
| Passive bombs | +1 every 10 s, no cap | `ECONOMY_CONFIG` in `src/game/economy.ts` |
| Wall Depot | 1 initial, first +1 at 6 s, then every 6 s | `ECONOMY_CONFIG` |
| Bomb Depot | 1 initial, first +1 at 15 s, then every 6 s | `ECONOMY_CONFIG` |
| Depot capacity | 8 by default, 1–32 per depot in Customize Arena | `DEFAULT_DEPOT_CAPACITY` / `DepotDefinition` |
| Wood Wall | 100 HP, 2.25 × 0.5 footprint, player default | `WALL_TYPES` in `src/game/arena.ts` |
| Stone Wall | 200 HP, 2.4 × 0.8 editor footprint | `WALL_TYPES` |
| Normal bomb | 50 wall damage, 2.5 radius | `BOMB_DAMAGE` / `BOMB_RADIUS` in `src/game/deployables.ts` |
| Territory tag | Defender receives floor(invader inventory / 2), each resource | `transferOnTerritoryTag` in `src/game/economy.ts` |

## Architecture decisions

`ArenaDefinition` describes a layout and is never used as mutable runtime stock. `Game` creates `DeploymentState` and `EconomyState` for every match. `CaptureTheFlag` remains responsible for flags and victory; territory resource transfer is a general game rule in `Game`. The renderer reads state and arena definitions but rules do not depend on Three.js objects. When two players occupy the same depot, collection alternates between them. Each depot's saved capacity controls its runtime stock cap. Depot generation continues at stock cap, so its next interval remains predictable after collection. Passive bombs do not have an inventory cap, preserving the escape mechanism.

The initial economy values are provisional. The larger arena and starting inventory should be playtested for travel time, visibility on tablet screens, and how quickly central control converts into walls or bombs. Future random power-ups should use `powerupSpawnAreas`, independently of depots; no spawn timing or ability rules have been chosen.

## Verification

`npm test`: 27 passing tests. `npm run build`: TypeScript and Vite build pass. Browser preview checked for full arena presentation, control dragging and resizing, and depot capacity editing. No lint command exists in `package.json`.
