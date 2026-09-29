import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, DEFAULT_ARENA } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { Game } from './Game.ts';
import { bombLaunch } from './trajectory.ts';
import { BASE_GAME_SETTINGS, migrateGameSettings, validateGameSettings } from './gameSettingsSchema.ts';
import { DEFAULT_GAME_SETTINGS, loadGameSettings } from './gameSettings.ts';

test('tuning preset accepts only complete finite values in safe ranges', () => {
  assert.deepEqual(validateGameSettings(BASE_GAME_SETTINGS), BASE_GAME_SETTINGS);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, runSpeed: Infinity }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: { bomb: BASE_GAME_SETTINGS.projectiles.bomb } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: {
    ...BASE_GAME_SETTINGS.projectiles, bomb: { ...BASE_GAME_SETTINGS.projectiles.bomb, mass: 0 },
  } }), null);
  assert.equal(validateGameSettings({ ...BASE_GAME_SETTINGS, projectiles: {
    ...BASE_GAME_SETTINGS.projectiles, bomb: { ...BASE_GAME_SETTINGS.projectiles.bomb, blastRadius: Infinity },
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
  assert.equal(migrated.projectiles.bomb.blastRadius, 2.5);
  assert.equal(migrated.acceleration, 28);
  assert.equal(loadGameSettings({ getItem: () => JSON.stringify(previous) }).projectiles.bomb.throwForce, 1.2);
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
  settings.projectiles['mega-bomb'].mass = 2.4;
  settings.projectiles['mega-bomb'].blastRadius = 5.2;
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
  game.powerUps.players.red.charges['mega-bomb'] = 1;
  game.beginDeployAim('red', 'mega-bomb');
  game.updateDeployAim('red', 'mega-bomb', { x: 1, z: 0 }, 0.7);
  assert.equal(game.releaseDeployAim('red', 'mega-bomb'), 'placed');
  const mega = game.deployments.bombs.at(-1)!;
  assert.equal(game.physics.getBombBody(mega.id)!.mass, 2.4);
  assert.equal(mega.blastRadius, 5.2);
  settings.playerMass = 3;
  settings.projectiles.bomb.blastRadius = 1.4;
  game.setSettings(settings);
  assert.equal(game.physics.getPlayerBody('red').mass, 3);
  assert.equal(bomb.blastRadius, 3.6); // Existing bombs keep their original blast size.
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
