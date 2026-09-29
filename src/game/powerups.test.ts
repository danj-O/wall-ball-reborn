import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA as DEFAULT_ARENA, pointInRegion, powerUpRegionFitsArena, WALL_TYPES } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { AIM_DEAD_ZONE, BOMB_TYPES, createDeploymentState, DEPLOYABLES, tickDeploymentState, type RuntimeBomb, type RuntimeWall } from './deployables.ts';
import { Game } from './Game.ts';
import { attemptPowerUpSpawn, collectPowerUp, createPowerUpState, POWER_UP_CONFIG, powerUpSpawnRejection, POWER_UPS, tickPowerUps, type PowerUpId, type PowerUpPickup } from './powerups.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const makeGame = () => { const game = new Game(cloneArena(DEFAULT_ARENA), new CaptureTheFlag(), () => 0.5); game.start(); return game; };
function addPickup(game: Game, id: PowerUpId, position = game.state.players.red.position): PowerUpPickup {
  const pickup = { id: `test-${id}-${game.powerUps.sequence++}`, definitionId: id, position: { ...position }, remaining: POWER_UPS[id].lifetime, age: 0 };
  game.powerUps.active.push(pickup);
  return pickup;
}

test('spawns inside an allowed contested region and keeps the arena definition immutable', () => {
  const game = makeGame();
  const original = cloneArena(game.arena);
  const pickup = attemptPowerUpSpawn(game.powerUps, game.arena, game.deployments.walls, game.state.players, () => 0.25);
  assert.ok(pickup);
  assert.ok(game.arena.powerupSpawnAreas.some(region => pointInRegion(pickup.position, region)));
  assert.equal(powerUpSpawnRejection(pickup.position, game.arena, game.deployments.walls, game.state.players, []), null);
  assert.deepEqual(game.arena, original);
});

test('first spawn and later spawn timers use configured random ranges', () => {
  const game = makeGame();
  const state = createPowerUpState(() => 0);
  assert.equal(state.nextSpawnRemaining, POWER_UP_CONFIG.firstSpawnSeconds[0]);
  tickPowerUps(state, game.arena, game.deployments.walls, game.state.players, 9.99, () => 0);
  assert.equal(state.active.length, 0);
  tickPowerUps(state, game.arena, game.deployments.walls, game.state.players, 0.02, () => 0);
  assert.equal(state.active.length, 1);
  assert.equal(state.nextSpawnRemaining, POWER_UP_CONFIG.intervalSeconds[0]);
});

test('spawn checks reject walls, depots, players, other pickups, and arena edges', () => {
  const game = makeGame();
  const check = (x: number, z: number) => powerUpSpawnRejection({ x, z }, game.arena, game.deployments.walls, game.state.players, game.powerUps.active);
  assert.equal(check(0, 0), 'wall');
  assert.equal(check(0, -6.7), 'depot');
  game.state.players.red.position = { x: -2, z: 4 };
  assert.equal(check(-2, 4), 'player');
  game.powerUps.active.push({ id: 'near', definitionId: 'speed', position: { x: 2, z: 4 }, remaining: 10, age: 0 });
  assert.equal(check(2, 4), 'pickup');
  assert.equal(check(25, 0), 'bounds');
  assert.equal(check(-10, 0), 'region');
  const custom = cloneArena(game.arena);
  custom.territories.red = [];
  custom.territories.blue = [];
  custom.territories.contested = [{ id: 'all', bounds: { ...custom.bounds } }];
  custom.powerupSpawnAreas = [{ id: 'all-spawns', bounds: { ...custom.bounds } }];
  const distantPlayers = structuredClone(game.state.players);
  distantPlayers.red.position = { x: 10, z: 8 };
  distantPlayers.blue.position = { x: 10, z: -8 };
  assert.equal(powerUpSpawnRejection(custom.flagPositions.red, custom, [], distantPlayers, []), 'base');
});

test('spawn cap and bounded attempts prevent unbounded retries', () => {
  const game = makeGame();
  addPickup(game, 'speed', { x: -3, z: 4 });
  addPickup(game, 'shield', { x: 3, z: 4 });
  assert.equal(attemptPowerUpSpawn(game.powerUps, game.arena, game.deployments.walls, game.state.players, () => 0.5), null);
  assert.equal(game.powerUps.rejected.maxActive, 1);
  const blocked = cloneArena(game.arena);
  blocked.powerupSpawnAreas = [{ id: 'blocked', bounds: { minX: -0.8, maxX: 0.8, minZ: -0.8, maxZ: 0.8 } }];
  const state = createPowerUpState(() => 0.5);
  assert.equal(attemptPowerUpSpawn(state, blocked, game.deployments.walls, game.state.players, () => 0.5), null);
  assert.equal(state.rejected.attemptLimit, 1);
});

test('pickup contact grants effect, removes world item, and ignored items expire', () => {
  const game = makeGame();
  const speed = addPickup(game, 'speed');
  tickPowerUps(game.powerUps, game.arena, game.deployments.walls, game.state.players, 1 / 60, () => 0.5);
  assert.equal(game.powerUps.active.some(item => item.id === speed.id), false);
  assert.equal(game.powerUps.players.red.speedRemaining, POWER_UP_CONFIG.speedSeconds);
  assert.equal(game.powerUps.bursts.length, 1);
  const ignored = addPickup(game, 'shield', { x: 2, z: 8 });
  ignored.remaining = 0.01;
  tickPowerUps(game.powerUps, game.arena, game.deployments.walls, game.state.players, 0.02, () => 0.5);
  assert.equal(game.powerUps.active.some(item => item.id === ignored.id), false);
});

test('Speed increases movement, refreshes instead of stacking, and returns to normal', () => {
  const boosted = makeGame();
  const normal = makeGame();
  const speed = addPickup(boosted, 'speed');
  assert.equal(collectPowerUp(boosted.powerUps, speed.id, 'red'), true);
  for (let i = 0; i < 35; i++) {
    boosted.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
    normal.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  }
  assert.ok(boosted.state.players.red.position.x > normal.state.players.red.position.x + 0.5);
  const again = addPickup(boosted, 'speed');
  assert.equal(collectPowerUp(boosted.powerUps, again.id, 'red'), true);
  assert.equal(boosted.powerUps.players.red.speedRemaining, POWER_UP_CONFIG.speedSeconds);
  boosted.powerUps.players.red.speedRemaining = 0.01;
  boosted.physics.getPlayerBody('red').velocity.set(boosted.speed * POWER_UP_CONFIG.speedMultiplier, 0, 0);
  boosted.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  assert.equal(boosted.powerUps.players.red.speedRemaining, 0);
  assert.ok(Math.hypot(boosted.physics.getPlayerBody('red').velocity.x,
    boosted.physics.getPlayerBody('red').velocity.z) <= boosted.speed + 1e-9);
  for (let i = 0; i < 370; i++) boosted.update(1 / 60, idle);
  assert.equal(boosted.powerUps.players.red.speedRemaining, 0);
  for (let i = 0; i < 20; i++) boosted.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  assert.ok(Math.abs(boosted.physics.getPlayerBody('red').velocity.x - boosted.speed) < 0.02);
});

test('Shield blocks territory resource theft but still allows a flag return and expires', () => {
  const game = makeGame();
  game.deployments.inventory.red = { wall: 7, bomb: 5 };
  game.deployments.inventory.blue = { wall: 1, bomb: 1 };
  game.state.players.red.position = { x: 10, z: 0 };
  game.state.players.blue.position = { x: 10, z: 0 };
  const shield = addPickup(game, 'shield');
  collectPowerUp(game.powerUps, shield.id, 'red');
  game.update(1 / 60, idle);
  assert.deepEqual(game.deployments.inventory.red, { wall: 7, bomb: 5 });
  assert.equal(game.economy.theftUsedThisVisit.red, false);
  const renewed = addPickup(game, 'shield');
  collectPowerUp(game.powerUps, renewed.id, 'red');
  assert.equal(game.powerUps.players.red.shieldRemaining, POWER_UP_CONFIG.shieldSeconds);
  game.powerUps.players.red.shieldRemaining = 0.01;
  game.update(1 / 60, idle);
  assert.equal(game.powerUps.players.red.shieldRemaining, 0);
  assert.deepEqual(game.deployments.inventory.red, { wall: 4, bomb: 3 });

  const flagGame = makeGame();
  flagGame.state.players.red.position = { ...flagGame.arena.flagPositions.blue };
  flagGame.update(1 / 60, idle);
  assert.equal(flagGame.state.players.red.carrying, 'blue');
  flagGame.powerUps.players.red.shieldRemaining = POWER_UP_CONFIG.shieldSeconds;
  flagGame.state.players.blue.position = { ...flagGame.state.players.red.position };
  flagGame.update(1 / 60, idle);
  assert.equal(flagGame.state.players.red.carrying, null);
  assert.equal(flagGame.state.flags.blue.carrier, null);
});

test('Mega Bomb pickup grants a charge; cancel keeps it and successful throw spends it', () => {
  const game = makeGame();
  const pickup = addPickup(game, 'mega-bomb');
  collectPowerUp(game.powerUps, pickup.id, 'red');
  assert.equal(game.powerUps.players.red.charges['mega-bomb'], 1);
  game.beginDeployAim('red', 'mega-bomb');
  game.updateDeployAim('red', 'mega-bomb', { x: 1, z: 0 }, 0);
  assert.equal(game.releaseDeployAim('red', 'mega-bomb'), 'cancelled');
  assert.equal(game.powerUps.players.red.charges['mega-bomb'], 1);
  game.beginDeployAim('red', 'mega-bomb');
  const preview = game.updateDeployAim('red', 'mega-bomb', { x: 1, z: 0 }, AIM_DEAD_ZONE + 0.5);
  assert.equal(preview?.valid, true);
  assert.equal(game.releaseDeployAim('red', 'mega-bomb'), 'placed');
  assert.equal(game.powerUps.players.red.charges['mega-bomb'], 0);
  assert.equal(game.deployments.bombs.at(-1)?.definitionId, 'mega-bomb');
  assert.equal(game.deployments.inventory.red.bomb, 2);
});

test('Mega Bomb uses configured 4-unit blast and wood/stone damage', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const state = createDeploymentState(arena);
  const wood = DEPLOYABLES.wall.deploy('wood', 'red', { position: { x: 0, z: 0 }, rotation: 0 }, { x: -2, z: 0 }) as RuntimeWall;
  const stone = { ...wood, id: 'stone', type: 'stone' as const, position: { x: 0, z: 2.8 }, hp: WALL_TYPES.stone.maxHealth };
  state.walls = [wood, stone];
  for (let hit = 1; hit <= 2; hit++) {
    const bomb = DEPLOYABLES['mega-bomb'].deploy(`mega-${hit}`, 'red', { position: { x: 0, z: 0 }, rotation: 0 }, { x: -2, z: 0 }) as RuntimeBomb;
    bomb.position = { x: 0, z: 0 };
    bomb.phase = 'lit';
    bomb.fuseRemaining = 0.01;
    state.bombs.push(bomb);
    tickDeploymentState(state, 0.02);
    assert.equal(state.explosions.at(-1)?.radius, BOMB_TYPES['mega-bomb'].blastRadius);
    assert.equal(state.walls.some(wall => wall.id === 'wood'), false);
    assert.equal(state.walls.find(wall => wall.id === 'stone')?.hp, hit === 1 ? 100 : undefined);
  }
});

test('reset clears pickups, modifiers, charges, and deployed Mega Bombs', () => {
  const game = makeGame();
  const original = cloneArena(game.arena);
  addPickup(game, 'speed');
  game.powerUps.players.red.speedRemaining = 5;
  game.powerUps.players.red.shieldRemaining = 7;
  game.powerUps.players.red.charges['mega-bomb'] = 1;
  game.reset();
  assert.equal(game.powerUps.active.length, 0);
  assert.equal(game.powerUps.players.red.speedRemaining, 0);
  assert.equal(game.powerUps.players.red.shieldRemaining, 0);
  assert.equal(game.powerUps.players.red.charges['mega-bomb'], 0);
  assert.equal(game.deployments.bombs.length, 0);
  assert.deepEqual(game.arena, original);
});

test('power-up regions can be resized and kept inside contested territory', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  assert.equal(powerUpRegionFitsArena(arena.powerupSpawnAreas[0], arena), true);
  const region = { id: 'custom', bounds: { minX: -2, maxX: 2, minZ: -3, maxZ: 3 } };
  assert.equal(powerUpRegionFitsArena(region, arena), true);
  region.bounds.maxX = 10;
  assert.equal(powerUpRegionFitsArena(region, arena), false);
});
