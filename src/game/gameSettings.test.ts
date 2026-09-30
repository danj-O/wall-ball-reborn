import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA as DEFAULT_ARENA } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { Game } from './Game.ts';
import { bombLaunch } from './trajectory.ts';
import { BASE_GAME_SETTINGS, migrateGameSettings, validateGameSettings } from './gameSettingsSchema.ts';
import { DEFAULT_GAME_SETTINGS, loadGameSettings } from './gameSettings.ts';
import { createDeploymentState, tickDeploymentState } from './deployables.ts';
import { createEconomyState, tickEconomy } from './economy.ts';

test('tuning preset accepts only complete finite values in safe ranges', () => {
  assert.deepEqual(validateGameSettings(BASE_GAME_SETTINGS), BASE_GAME_SETTINGS);
  assert.deepEqual(validateGameSettings(DEFAULT_GAME_SETTINGS), DEFAULT_GAME_SETTINGS);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, runSpeed: Infinity }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: { bomb: BASE_GAME_SETTINGS.projectiles.bomb } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: {
    ...BASE_GAME_SETTINGS.projectiles, bomb: { ...BASE_GAME_SETTINGS.projectiles.bomb, mass: 0 },
  } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: {
    ...BASE_GAME_SETTINGS.projectiles, bomb: { ...BASE_GAME_SETTINGS.projectiles.bomb, blastRadius: Infinity },
  } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: {
    ...BASE_GAME_SETTINGS.projectiles, bomb: { ...BASE_GAME_SETTINGS.projectiles.bomb, fuseSeconds: 0.1 },
  } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, startingInventory: { wall: 2.5, bomb: 2 } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, passiveRegenSeconds: { wall: -1, bomb: 10 } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, playerMass: 30 })?.playerMass, 30);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: {
    ...BASE_GAME_SETTINGS.projectiles, bomb: { ...BASE_GAME_SETTINGS.projectiles.bomb, blastForce: 200, blastLift: 200 },
  } })?.projectiles.bomb.blastLift, 200);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: {
    ...BASE_GAME_SETTINGS.projectiles, bomb: { ...BASE_GAME_SETTINGS.projectiles.bomb, blastForce: 201 },
  } }), null);
});

test('older on-device tuning migrates without losing the saved speed or projectile settings', () => {
  const previous = { runSpeed: 8.8, projectiles: {
    bomb: { throwForce: 1.2, lob: 1, mass: 1 },
    'mega-bomb': { throwForce: 1.35, lob: 1.25, mass: 1.7 },
  } };
  const migrated = migrateGameSettings(previous, DEFAULT_GAME_SETTINGS)!;
  assert.equal(migrated.runSpeed, 8.8);
  assert.equal(migrated.projectiles.bomb.throwForce, 1.2);
  assert.equal(migrated.projectiles.bomb.blastRadius, DEFAULT_GAME_SETTINGS.projectiles.bomb.blastRadius);
  assert.equal(migrated.projectiles.bomb.blastForce, DEFAULT_GAME_SETTINGS.projectiles.bomb.blastForce);
  assert.equal(migrated.projectiles.bomb.blastLift, DEFAULT_GAME_SETTINGS.projectiles.bomb.blastLift);
  assert.equal(migrated.projectiles.bomb.fuseSeconds, DEFAULT_GAME_SETTINGS.projectiles.bomb.fuseSeconds);
  assert.equal(migrated.airControl, DEFAULT_GAME_SETTINGS.airControl);
  assert.equal(migrated.airBraking, DEFAULT_GAME_SETTINGS.airBraking);
  assert.equal(migrated.acceleration, DEFAULT_GAME_SETTINGS.acceleration);
  assert.deepEqual(migrated.startingInventory, DEFAULT_GAME_SETTINGS.startingInventory);
  assert.equal(loadGameSettings({ getItem: () => JSON.stringify(previous) }).projectiles.bomb.throwForce, 1.2);
});

test('starting supplies and passive/depot generation rates use saved tuning', () => {
  const settings = structuredClone(BASE_GAME_SETTINGS);
  settings.startingInventory = { wall: 3, bomb: 1 };
  settings.passiveRegenSeconds = { wall: 2, bomb: 3 };
  settings.depotGenerationSeconds = { wall: 4, bomb: 8 };
  const arena = cloneArena(DEFAULT_ARENA);
  const deployments = createDeploymentState(arena, settings.startingInventory);
  const economy = createEconomyState(arena, settings);
  assert.deepEqual(deployments.inventory.red, { wall: 3, bomb: 1 });
  assert.deepEqual(deployments.inventory.blue, { wall: 3, bomb: 1 });
  assert.equal(economy.depots.find(depot => depot.type === 'wall')!.generationRemaining, 4);
  assert.equal(economy.depots.find(depot => depot.type === 'bomb')!.generationRemaining, 20);
  const game = new Game(arena, new CaptureTheFlag(), Math.random, settings);
  assert.deepEqual(game.deployments.inventory.red, { wall: 3, bomb: 1 });
  game.deployments.inventory.red.wall = 99;
  game.reset();
  assert.deepEqual(game.deployments.inventory.red, { wall: 3, bomb: 1 });
  const players = new CaptureTheFlag().createState(arena).players;
  tickEconomy(economy, deployments, players, 2.1, settings);
  assert.equal(deployments.inventory.red.wall, 4);
  assert.equal(deployments.inventory.red.bomb, 1);
  tickEconomy(economy, deployments, players, 1, settings);
  assert.equal(deployments.inventory.red.bomb, 2);
  settings.passiveRegenSeconds.wall = 0;
  tickEconomy(economy, deployments, players, 5, settings);
  assert.equal(deployments.inventory.red.wall, 4);
});

test('projectile force, lob, and weight change the shared rigid-body launch independently', () => {
  const origin = { x: 0, z: 0 };
  const target = { x: 5, z: 0 };
  const baseline = bombLaunch(origin, target, 0.2);
  const strong = bombLaunch(origin, target, 0.2, { throwForce: 2, lob: 1, mass: 1 });
  const high = bombLaunch(origin, target, 0.2, { throwForce: 1, lob: 2, mass: 1 });
  const heavy = bombLaunch(origin, target, 0.2, { throwForce: 1, lob: 1, mass: 2 });
  assert.equal(strong.velocity.x, baseline.velocity.x * 2);
  assert.equal(high.velocity.x, baseline.velocity.x);
  assert.equal(high.velocity.y, baseline.velocity.y * 2);
  assert.equal(heavy.velocity.x, baseline.velocity.x / 2);
  assert.equal(heavy.velocity.y, baseline.velocity.y / 2);
});

test('game applies tuned run speed and distinct bomb and Mega Bomb masses', () => {
  const settings = structuredClone(BASE_GAME_SETTINGS);
  settings.runSpeed = 9;
  settings.playerMass = 6;
  settings.acceleration = 42;
  settings.braking = 55;
  settings.projectiles.bomb.mass = 0.8;
  settings.projectiles.bomb.blastRadius = 3.6;
  settings.projectiles.bomb.blastForce = 42;
  settings.projectiles.bomb.blastLift = 61;
  settings.projectiles.bomb.fuseSeconds = 0.8;
  settings.projectiles['mega-bomb'].mass = 2.4;
  settings.projectiles['mega-bomb'].blastRadius = 5.2;
  settings.projectiles['mega-bomb'].blastForce = 77;
  settings.projectiles['mega-bomb'].blastLift = 99;
  settings.projectiles['mega-bomb'].fuseSeconds = 4.2;
  const game = new Game(cloneArena(DEFAULT_ARENA), new CaptureTheFlag(), Math.random, settings);
  assert.equal(game.speed, 9);
  assert.equal(game.acceleration, 42);
  assert.equal(game.braking, 55);
  assert.equal(game.physics.getPlayerBody('red').mass, 6);
  assert.equal(game.start(), true);
  game.beginDeployAim('red', 'bomb');
  game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, 0.5);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'placed');
  const bomb = game.deployments.bombs.at(-1)!;
  assert.equal(game.physics.getBombBody(bomb.id)!.mass, 0.8);
  assert.equal(bomb.blastRadius, 3.6);
  assert.equal(bomb.blastForce, 42);
  assert.equal(bomb.blastLift, 61);
  assert.equal(bomb.fuseDuration, 0.8);
  assert.equal(bomb.fuseRemaining, 0.8);
  game.powerUps.players.red.charges['mega-bomb'] = 1;
  game.beginDeployAim('red', 'mega-bomb');
  game.updateDeployAim('red', 'mega-bomb', { x: 1, z: 0 }, 0.7);
  assert.equal(game.releaseDeployAim('red', 'mega-bomb'), 'placed');
  const mega = game.deployments.bombs.at(-1)!;
  assert.equal(game.physics.getBombBody(mega.id)!.mass, 2.4);
  assert.equal(mega.blastRadius, 5.2);
  assert.equal(mega.blastForce, 77);
  assert.equal(mega.blastLift, 99);
  assert.equal(mega.fuseDuration, 4.2);
  settings.playerMass = 3;
  settings.projectiles.bomb.blastRadius = 1.4;
  settings.projectiles.bomb.blastForce = 1;
  settings.projectiles.bomb.fuseSeconds = 1.6;
  game.setSettings(settings);
  assert.equal(game.physics.getPlayerBody('red').mass, 3);
  assert.equal(bomb.blastRadius, 3.6); // Existing bombs keep their original blast size.
  assert.equal(bomb.blastForce, 42); // Existing bombs also keep their blast impulse.
  assert.equal(bomb.fuseDuration, 0.8); // Existing bombs keep their timer.
  bomb.phase = 'lit';
  tickDeploymentState(game.deployments, 0.7);
  assert.ok(game.deployments.bombs.includes(bomb));
  tickDeploymentState(game.deployments, 0.11);
  assert.ok(!game.deployments.bombs.includes(bomb));
});

test('acceleration and braking settings change actual movement response', () => {
  const slowSettings = structuredClone(BASE_GAME_SETTINGS);
  slowSettings.acceleration = 6;
  slowSettings.braking = 6;
  const fastSettings = structuredClone(BASE_GAME_SETTINGS);
  fastSettings.acceleration = 60;
  fastSettings.braking = 80;
  const slow = new Game(cloneArena(DEFAULT_ARENA), new CaptureTheFlag(), Math.random, slowSettings);
  const fast = new Game(cloneArena(DEFAULT_ARENA), new CaptureTheFlag(), Math.random, fastSettings);
  slow.start(); fast.start();
  const forward = { red: { x: 1, z: 0 }, blue: { x: 0, z: 0 } };
  const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
  slow.update(1 / 60, forward);
  fast.update(1 / 60, forward);
  assert.ok(fast.physics.getPlayerBody('red').velocity.x > slow.physics.getPlayerBody('red').velocity.x);
  for (let i = 0; i < 70; i++) { slow.update(1 / 60, forward); fast.update(1 / 60, forward); }
  slow.update(1 / 60, idle);
  fast.update(1 / 60, idle);
  assert.ok(fast.physics.getPlayerBody('red').velocity.x < slow.physics.getPlayerBody('red').velocity.x);
});
