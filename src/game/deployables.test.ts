import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA as DEFAULT_ARENA, WALL_HEIGHT, WALL_TYPES } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { Game } from './Game.ts';
import {
  AIM_DEAD_ZONE, BOMB_THROW, DEPLOYABLES, tickDeploymentState,
  type RuntimeBomb, type RuntimeWall,
} from './deployables.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const makeGame = () => { const game = new Game(cloneArena(DEFAULT_ARENA), new CaptureTheFlag()); game.start(); return game; };

test('successful wall and bomb deployment spend only their own inventory', () => {
  const game = makeGame();
  game.beginDeployAim('red', 'wall');
  const wallPreview = game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 0.6);
  assert.equal(wallPreview?.valid, true);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'placed');
  assert.equal(game.deployments.inventory.red.wall, game.settings.startingInventory.wall - 1);
  assert.equal(game.deployments.inventory.red.bomb, game.settings.startingInventory.bomb);
  assert.equal(game.deployments.walls.at(-1)?.owner, 'red');
  assert.equal(game.deployments.walls.at(-1)?.hp, WALL_TYPES.wood.maxHealth);

  game.beginDeployAim('red', 'bomb');
  assert.equal(game.updateDeployAim('red', 'bomb', { x: 0, z: -1 }, 0.5)?.valid, true);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'placed');
  assert.equal(game.deployments.inventory.red.bomb, game.settings.startingInventory.bomb - 1);
  assert.equal(game.deployments.bombs.length, 1);
});

test('relative aim returning to center cancels without spending inventory', () => {
  const game = makeGame();
  game.beginDeployAim('red', 'wall');
  assert.ok(game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 0.7));
  assert.equal(game.updateDeployAim('red', 'wall', { x: 0, z: 0 }, 0), null);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'cancelled');
  assert.equal(game.deployments.inventory.red.wall, game.settings.startingInventory.wall);
  assert.equal(game.deployments.walls.length, DEFAULT_ARENA.walls.length);
});

test('bomb throw distance follows aim magnitude and cancel threshold', () => {
  const game = makeGame();
  game.state.players.red.position = { x: 0, z: 0 };
  game.beginDeployAim('red', 'bomb');
  assert.equal(game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, AIM_DEAD_ZONE)?.position, undefined);
  const close = game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, AIM_DEAD_ZONE + 0.05)!;
  const far = game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, 1)!;
  assert.ok(close.position.x >= BOMB_THROW.minimumDistance);
  assert.ok(close.position.x < far.position.x);
  assert.equal(far.position.x, BOMB_THROW.maximumDistance);
  game.updateDeployAim('red', 'bomb', { x: 0, z: 0 }, 0);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'cancelled');
  assert.equal(game.deployments.inventory.red.bomb, game.settings.startingInventory.bomb);
});

test('wall and bomb aim sessions remain independent for both players', () => {
  const game = makeGame();
  game.beginDeployAim('red', 'wall');
  game.beginDeployAim('red', 'bomb');
  game.beginDeployAim('blue', 'wall');
  game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 0.6);
  game.updateDeployAim('red', 'bomb', { x: 0, z: -1 }, 0.7);
  game.updateDeployAim('blue', 'wall', { x: -1, z: 0 }, 0.6);
  assert.ok(game.deployments.aim.red.wall?.preview);
  assert.ok(game.deployments.aim.red.bomb?.preview);
  assert.ok(game.deployments.aim.blue.wall?.preview);
  game.cancelDeployAim('red', 'wall');
  assert.ok(game.deployments.aim.red.bomb?.preview);
  assert.ok(game.deployments.aim.blue.wall?.preview);
});

test('bomb rigid bodies collide with floor, walls, bombs, and players', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'barrier', type: 'stone', position: { x: 0, z: 0 }, width: 0.8, depth: 5, rotation: 0 }];
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  const makeBomb = (id: string, x: number) => {
    const bomb = DEPLOYABLES.bomb.deploy(id, 'red', { position: { x: 0, z: 0 }, rotation: 0 }, { x, z: 0 }) as RuntimeBomb;
    game.deployments.bombs.push(bomb);
    game.physics.addBomb(bomb);
    return { bomb, body: game.physics.getBombBody(id)! };
  };
  const first = makeBomb('first', -4);
  const second = makeBomb('second', -3);
  first.body.position.set(-2, 0.34, 0);
  second.body.position.set(-1, 0.34, 0);
  first.body.velocity.set(6, 0, 0);
  second.body.velocity.setZero();
  for (let i = 0; i < 10; i++) game.update(1 / 60, idle);
  assert.ok(second.body.velocity.x > 1, `bomb received momentum: ${second.body.velocity.x}`);
  assert.ok(first.body.velocity.x < 6);
  for (let i = 0; i < 10; i++) game.update(1 / 60, idle);
  assert.ok(second.body.position.x < -0.4);
  assert.ok(second.body.velocity.x < 0, `wall bounced bomb: ${second.body.velocity.x}`);
  assert.equal(second.bomb.phase, 'lit');
});

test('bomb impact transfers momentum to a player', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [];
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  game.state.players.red.position = { x: 0, z: 0 };
  game.update(1 / 60, idle);
  const bomb = DEPLOYABLES.bomb.deploy('player-hit', 'blue', { position: { x: 0, z: 0 }, rotation: 0 }, { x: -3, z: 0 }) as RuntimeBomb;
  game.deployments.bombs.push(bomb);
  game.physics.addBomb(bomb);
  const body = game.physics.getBombBody(bomb.id)!;
  body.position.set(-1.2, 0.4, 0);
  body.velocity.set(9, 0, 0);
  for (let i = 0; i < 8; i++) game.update(1 / 60, idle);
  assert.ok(game.state.players.red.position.x > 0);
  assert.ok(body.velocity.x < 9);
});

test('close wall throws start outside solid geometry and do not gain explosive bounce speed', () => {
  const game = makeGame();
  game.state.players.red.position = { x: -6, z: 0 };
  game.update(1 / 60, idle);
  game.beginDeployAim('red', 'bomb');
  const preview = game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, 0.5);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'placed');
  const bomb = game.deployments.bombs.at(-1)!;
  const body = game.physics.getBombBody(bomb.id)!;
  assert.ok(preview?.trajectory);
  assert.ok(Math.abs(preview.trajectory.points[0].x - body.position.x) < 0.001);
  assert.ok(Math.abs(preview.trajectory.points[0].y - body.position.y) < 0.001);
  const launchSpeed = body.velocity.length();
  let peakSpeed = launchSpeed;
  for (let i = 0; i < 60; i++) {
    game.update(1 / 60, idle);
    peakSpeed = Math.max(peakSpeed, body.velocity.length());
  }
  assert.ok(peakSpeed < launchSpeed * 1.5, `wall bounce ${peakSpeed} from ${launchSpeed}`);
});

test('gravity lands bombs on top of walls and they can fall off', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'platform', type: 'stone', position: { x: 0, z: 0 }, width: 2, depth: 2, rotation: 0 }];
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  const bomb = DEPLOYABLES.bomb.deploy('top', 'red', { position: { x: 0, z: 0 }, rotation: 0 }, { x: -3, z: 0 }) as RuntimeBomb;
  game.deployments.bombs.push(bomb);
  game.physics.addBomb(bomb);
  const body = game.physics.getBombBody(bomb.id)!;
  body.position.set(0, WALL_HEIGHT + 0.54, 0);
  body.velocity.setZero();
  for (let i = 0; i < 20; i++) game.update(1 / 60, idle);
  assert.ok(Math.abs(bomb.height - WALL_HEIGHT) < 0.12);
  body.velocity.x = 5;
  for (let i = 0; i < 35; i++) game.update(1 / 60, idle);
  assert.ok(bomb.position.x > 1.4);
  assert.ok(bomb.height < WALL_HEIGHT - 0.2);
});

test('invalid wall overlap and invalid bomb placement spend nothing', () => {
  const game = makeGame();
  const preview = () => {
    game.beginDeployAim('red', 'wall');
    return game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 0.6);
  };
  assert.equal(preview()?.valid, true);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'placed');
  assert.equal(preview()?.valid, false);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'invalid');
  assert.equal(game.deployments.inventory.red.wall, game.settings.startingInventory.wall - 1);
  game.state.players.red.position = { x: 23, z: 0 };
  game.beginDeployAim('red', 'bomb');
  assert.equal(game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, 1)?.valid, false);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'invalid');
  assert.equal(game.deployments.inventory.red.bomb, game.settings.startingInventory.bomb);
});

test('wall footprints reject static walls, bases, players and arena borders', () => {
  const game = makeGame();
  const context = {
    arena: game.arena, walls: game.deployments.walls,
    bombs: game.deployments.bombs, players: game.state.players,
  };
  for (const position of [
    { x: -5, z: -6 }, // starting stone wall row
    { x: -23.2, z: 0 }, // red base
    { x: 21.5, z: 0 }, // blue player
    { x: 24.7, z: 4 }, // perimeter
  ]) {
    assert.equal(DEPLOYABLES.wall.isValid({ position, rotation: 0 }, context), false);
  }
  assert.equal(DEPLOYABLES.wall.isValid({ position: { x: -9, z: 1 }, rotation: 0.4 }, context), true);
});

test('deployed walls block movement and never mutate the initial arena', () => {
  const game = makeGame();
  const original = cloneArena(game.arena);
  game.beginDeployAim('red', 'wall');
  game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 0.6);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'placed');
  for (let i = 0; i < 120; i++) game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  const wall = game.deployments.walls.at(-1)!;
  assert.ok(game.state.players.red.position.x < wall.position.x - wall.depth / 2);
  assert.deepEqual(game.arena, original);
  game.reset();
  assert.deepEqual(game.arena, original);
  assert.equal(game.deployments.walls.length, original.walls.length);
});

test('impact starts the fuse and blast destroys walls without changing the arena definition', () => {
  const game = makeGame();
  const original = cloneArena(game.arena);
  const near = DEPLOYABLES.wall.deploy('near', 'red', { position: { x: -3, z: 0 }, rotation: 0 }, { x: -5, z: 0 }) as RuntimeWall;
  game.deployments.walls.push(near);
  game.physics.syncWalls(game.deployments.walls);
  for (let hit = 1; hit <= 2; hit++) {
    const bomb = DEPLOYABLES.bomb.deploy(`blast-${hit}`, 'red', { position: { x: -3, z: 1.3 }, rotation: 0 }, { x: -5, z: 1.3 }) as RuntimeBomb;
    bomb.position = { x: -3, z: 1.3 };
    bomb.phase = 'lit';
    bomb.fuseRemaining = 0.01;
    game.deployments.bombs.push(bomb);
    tickDeploymentState(game.deployments, 0.02);
    game.physics.syncWalls(game.deployments.walls);
    assert.equal(game.deployments.walls.find(w => w.id === near.id)?.hp, hit === 1 ? WALL_TYPES.wood.maxHealth - 50 : undefined);
  }
  assert.deepEqual(game.arena, original);
  assert.equal(game.physics.world.bodies.some(body => body.position.x === -3 && body.position.z === 0), false);
});
