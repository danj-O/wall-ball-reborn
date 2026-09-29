import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA as DEFAULT_ARENA, migrateArena, WALL_TYPES } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { BOMB_DAMAGE, BOMB_FUSE, createDeploymentState, DEPLOYABLES, tickDeploymentState, type RuntimeBomb } from './deployables.ts';
import { createEconomyState, ECONOMY_CONFIG, tickEconomy, transferOnTerritoryTag } from './economy.ts';
import { Game } from './Game.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const setup = () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  return { arena, game };
};
function run(game: Game, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) game.update(1 / 60, idle);
}

test('passive bombs regenerate independently, including from zero', () => {
  const { game } = setup();
  game.deployments.inventory.red.bomb = 0;
  run(game, 9.9);
  assert.equal(game.deployments.inventory.red.bomb, 0);
  run(game, 0.2);
  assert.equal(game.deployments.inventory.red.bomb, 1);
  assert.equal(game.deployments.inventory.blue.bomb, DEPLOYABLES.bomb.initialInventory + 1);
  run(game, 10);
  assert.equal(game.deployments.inventory.red.bomb, 2);
  game.reset();
  assert.equal(game.economy.passiveBombRemaining.red, ECONOMY_CONFIG.passiveBombInterval);
});

test('wall and bomb depots generate on their own schedules and cap stock', () => {
  const { arena, game } = setup();
  const wall = game.economy.depots.find(d => d.type === 'wall')!;
  const bomb = game.economy.depots.find(d => d.type === 'bomb')!;
  assert.equal(wall.stock, 1);
  assert.equal(bomb.stock, 1);
  tickEconomy(game.economy, game.deployments, game.state.players, 6);
  assert.equal(wall.stock, 2);
  assert.equal(bomb.stock, 1);
  tickEconomy(game.economy, game.deployments, game.state.players, 9);
  assert.equal(wall.stock, 3);
  assert.equal(bomb.stock, 2);
  tickEconomy(game.economy, game.deployments, game.state.players, 100);
  assert.equal(wall.stock, wall.capacity);
  assert.equal(bomb.stock, bomb.capacity);
  assert.deepEqual(arena.depots, DEFAULT_ARENA.depots);
});

test('each depot uses its arena capacity setting', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.depots[0].capacity = 4;
  arena.depots[1].capacity = 11;
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  tickEconomy(game.economy, game.deployments, game.state.players, 120);
  assert.deepEqual(game.economy.depots.map(d => d.stock), [4, 11]);
  assert.deepEqual(arena.depots.map(d => d.capacity), [4, 11]);
});

test('depot collection transfers all available stock without changing saved arena', () => {
  const { arena, game } = setup();
  const original = cloneArena(arena);
  const depot = game.economy.depots.find(d => d.type === 'wall')!;
  depot.stock = 3;
  game.state.players.red.position = { ...depot.position };
  tickEconomy(game.economy, game.deployments, game.state.players, 0);
  assert.equal(game.deployments.inventory.red.wall, DEPLOYABLES.wall.initialInventory + 3);
  assert.equal(depot.stock, 0);
  const bombDepot = game.economy.depots.find(d => d.type === 'bomb')!;
  game.state.players.red.position = { ...bombDepot.position };
  tickEconomy(game.economy, game.deployments, game.state.players, 0);
  assert.equal(game.deployments.inventory.red.bomb, DEPLOYABLES.bomb.initialInventory + 1);
  assert.equal(bombDepot.stock, 0);
  assert.deepEqual(arena, original);
});

test('legacy saved layouts migrate without losing customized walls', () => {
  const old = cloneArena(DEFAULT_ARENA);
  old.bounds = { minX: -12, maxX: 12, minZ: -8, maxZ: 8 };
  old.playerSpawns = { red: { x: -9, z: 0 }, blue: { x: 9, z: 0 } };
  old.flagPositions = { red: { x: -10.5, z: 0 }, blue: { x: 10.5, z: 0 } };
  old.walls = [{ id: 'custom', type: 'stone', position: { x: 1, z: 2 }, width: 2.4, depth: 0.8, rotation: 0 }];
  const serialized = JSON.parse(JSON.stringify(old));
  delete serialized.territories;
  delete serialized.powerupSpawnAreas;
  delete serialized.depots;
  delete serialized.walls[0].type;
  const migrated = migrateArena(serialized);
  assert.deepEqual(migrated.bounds, DEFAULT_ARENA.bounds);
  assert.deepEqual(migrated.playerSpawns, DEFAULT_ARENA.playerSpawns);
  assert.equal(migrated.walls[0].id, 'custom');
  assert.equal(migrated.walls[0].type, 'stone');
  assert.equal(migrated.depots.length, 2);
  assert.equal(migrated.territories.contested.length, 1);
  const phaseThreeSave = JSON.parse(JSON.stringify(DEFAULT_ARENA));
  delete phaseThreeSave.depots[0].capacity;
  assert.equal(migrateArena(phaseThreeSave).depots[0].capacity, DEFAULT_ARENA.depots[0].capacity);
});

test('depot footprint round-trips through arena serialization and permits nearby construction', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.depots.push({ id: 'extra', type: 'wall', position: { x: -2, z: 5 }, radius: 2.25, capacity: 12 });
  const loaded = migrateArena(JSON.parse(JSON.stringify(arena)));
  assert.deepEqual(loaded.depots.at(-1), arena.depots.at(-1));
  const game = new Game(loaded, new CaptureTheFlag());
  game.start();
  game.state.players.red.position = { x: -2, z: 7.5 };
  const context = { arena: loaded, walls: game.deployments.walls, bombs: game.deployments.bombs, players: game.state.players };
  assert.equal(DEPLOYABLES.wall.isValid({ position: { x: -2, z: 5 }, rotation: 0 }, context), true);
});

test('wood takes two bomb hits and stone takes four at configured health', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const state = createDeploymentState(arena);
  state.walls = [
    { ...DEPLOYABLES.wall.deploy('wood', 'red', { position: { x: 0, z: 0 }, rotation: 0 }, { x: 0, z: 0 }), kind: 'wall' } as typeof state.walls[number],
    { id: 'stone', type: 'stone', position: { x: 8, z: 0 }, width: 2.4, depth: 0.8, rotation: 0,
      kind: 'wall', definitionId: 'wall', owner: null, source: 'initial', hp: WALL_TYPES.stone.maxHealth },
  ];
  assert.equal(WALL_TYPES.wood.maxHealth, BOMB_DAMAGE * 2);
  assert.equal(WALL_TYPES.stone.maxHealth, BOMB_DAMAGE * 4);
  for (const [id, x, hits] of [['wood', 0, 2], ['stone', 8, 4]] as const) {
    for (let hit = 1; hit <= hits; hit++) {
      const bomb = DEPLOYABLES.bomb.deploy(`hit-${id}-${hit}`, 'red',
        { position: { x, z: 0 }, rotation: 0 }, { x, z: -2 }) as RuntimeBomb;
      bomb.position = { x, z: 0 };
      bomb.phase = 'lit';
      state.bombs.push(bomb);
      tickDeploymentState(state, BOMB_FUSE);
      assert.equal(state.walls.find(w => w.id === id)?.hp,
        hit === hits ? undefined : WALL_TYPES[id].maxHealth - BOMB_DAMAGE * hit);
    }
  }
});

test('territory theft rounds down and triggers once per enemy territory visit', () => {
  const { game } = setup();
  game.deployments.inventory.red = { wall: 7, bomb: 5 };
  game.deployments.inventory.blue = { wall: 1, bomb: 1 };
  game.state.players.red.position = { x: 10, z: 0 };
  game.state.players.blue.position = { x: 10, z: 0 };
  game.update(1 / 60, idle);
  assert.deepEqual(game.deployments.inventory.red, { wall: 4, bomb: 3 });
  assert.deepEqual(game.deployments.inventory.blue, { wall: 4, bomb: 3 });
  assert.equal(game.economy.theftUsedThisVisit.red, true);
  game.update(1 / 60, idle);
  assert.deepEqual(game.deployments.inventory.red, { wall: 4, bomb: 3 });
  game.state.players.red.position = { x: 0, z: 3 };
  game.update(1 / 60, idle);
  assert.equal(game.economy.theftUsedThisVisit.red, false);
  game.state.players.red.position = { x: 10, z: 0 };
  game.update(1 / 60, idle);
  assert.deepEqual(game.deployments.inventory.red, { wall: 2, bomb: 2 });
  assert.deepEqual(game.deployments.inventory.blue, { wall: 6, bomb: 4 });
});

test('direct transfer leaves odd remainder with invader', () => {
  const { game } = setup();
  game.deployments.inventory.red = { wall: 7, bomb: 5 };
  const transfer = transferOnTerritoryTag('red', game.deployments);
  assert.deepEqual(transfer, { walls: 3, bombs: 2 });
  assert.deepEqual(game.deployments.inventory.red, { wall: 4, bomb: 3 });
});
