import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, DEFAULT_ARENA, WALL_HEIGHT, WALL_TYPES } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { Game } from './Game.ts';
import {
  AIM_DEAD_ZONE, BOMB_FUSE, BOMB_RADIUS, BOMB_THROW, createDeploymentState, DEPLOYABLES, tickDeploymentState,
  type RuntimeBomb, type RuntimeWall,
} from './deployables.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const makeGame = () => new Game(cloneArena(DEFAULT_ARENA), new CaptureTheFlag());

test('successful wall and bomb deployment spend only their own inventory', () => {
  const game = makeGame();
  game.beginDeployAim('red', 'wall');
  const wallPreview = game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 0.6);
  assert.equal(wallPreview?.valid, true);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'placed');
  assert.equal(game.deployments.inventory.red.wall, 4);
  assert.equal(game.deployments.inventory.red.bomb, 2);
  assert.equal(game.deployments.walls.at(-1)?.owner, 'red');
  assert.equal(game.deployments.walls.at(-1)?.hp, WALL_TYPES.wood.maxHealth);

  game.beginDeployAim('red', 'bomb');
  assert.equal(game.updateDeployAim('red', 'bomb', { x: 0, z: -1 }, 0.5)?.valid, true);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'placed');
  assert.equal(game.deployments.inventory.red.bomb, 1);
  assert.equal(game.deployments.bombs.length, 1);
});

test('relative aim returning to center cancels without spending inventory', () => {
  const game = makeGame();
  game.beginDeployAim('red', 'wall');
  assert.ok(game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 0.7));
  assert.equal(game.updateDeployAim('red', 'wall', { x: 0, z: 0 }, 0), null);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'cancelled');
  assert.equal(game.deployments.inventory.red.wall, 5);
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
  assert.equal(game.deployments.inventory.red.bomb, 2);
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

test('bomb travels in an arc and its two-second fuse starts on landing', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const state = createDeploymentState(arena);
  const bomb = DEPLOYABLES.bomb.deploy('flight', 'red',
    { position: { x: 5, z: 0 }, rotation: 0 }, { x: 0, z: 0 }) as RuntimeBomb;
  state.bombs.push(bomb);
  tickDeploymentState(state, bomb.travelDuration / 2, arena);
  assert.equal(bomb.phase, 'flying');
  assert.equal(bomb.position.x, 2.5);
  assert.equal(bomb.height, BOMB_THROW.trajectoryHeight);
  assert.equal(bomb.fuseRemaining, BOMB_FUSE);
  tickDeploymentState(state, bomb.travelDuration / 2, arena);
  assert.equal(bomb.phase, 'lit');
  assert.equal(bomb.position.x, 5);
  assert.equal(bomb.height, 0);
  assert.equal(bomb.fuseRemaining, BOMB_FUSE);
  tickDeploymentState(state, BOMB_FUSE, arena);
  assert.equal(state.bombs.length, 0);
  assert.equal(state.explosions.length, 1);
});

test('bombs can land on walls, players, bases, and other bombs', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const state = createDeploymentState(arena);
  const context = { arena, walls: state.walls, bombs: state.bombs,
    players: new CaptureTheFlag().createState(arena).players };
  for (const position of [arena.walls[0].position, arena.flagPositions.red, arena.playerSpawns.red]) {
    assert.equal(DEPLOYABLES.bomb.isValid({ position, rotation: 0 }, context), true);
  }
  const target = arena.walls[0].position;
  const first = DEPLOYABLES.bomb.deploy('stack-1', 'red', { position: target, rotation: 0 },
    { x: target.x - 3, z: target.z }) as RuntimeBomb;
  state.bombs.push(first);
  tickDeploymentState(state, first.travelDuration, arena);
  assert.equal(first.height, WALL_HEIGHT);
  assert.equal(first.support?.kind, 'wall');
  assert.equal(DEPLOYABLES.bomb.isValid({ position: target, rotation: 0 }, context), true);
  const second = DEPLOYABLES.bomb.deploy('stack-2', 'blue', { position: target, rotation: 0 },
    { x: target.x + 3, z: target.z }) as RuntimeBomb;
  state.bombs.push(second);
  tickDeploymentState(state, second.travelDuration, arena);
  assert.equal(second.support?.kind, 'bomb');
  assert.ok(second.height > first.height + 0.6);
});

test('landed bomb rolls with friction and remains inside arena', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [];
  const state = createDeploymentState(arena);
  const bomb = DEPLOYABLES.bomb.deploy('rolling', 'red',
    { position: { x: 4, z: 0 }, rotation: 0 }, { x: 0, z: 0 }) as RuntimeBomb;
  state.bombs.push(bomb);
  tickDeploymentState(state, bomb.travelDuration, arena);
  const landingX = bomb.position.x;
  for (let i = 0; i < 30; i++) tickDeploymentState(state, 1 / 60, arena);
  assert.ok(bomb.position.x > landingX);
  assert.ok(bomb.position.x < arena.bounds.maxX);
  assert.ok(Math.hypot(bomb.velocity.x, bomb.velocity.z) < 0.2);
});

test('bomb rolling off a wall falls back to the ground', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'platform', type: 'stone', position: { x: 0, z: 0 }, width: 1, depth: 1, rotation: 0 }];
  const state = createDeploymentState(arena);
  const bomb = DEPLOYABLES.bomb.deploy('edge', 'red',
    { position: { x: 0.3, z: 0 }, rotation: 0 }, { x: -2, z: 0 }) as RuntimeBomb;
  state.bombs.push(bomb);
  tickDeploymentState(state, bomb.travelDuration, arena);
  assert.equal(bomb.height, WALL_HEIGHT);
  bomb.velocity = { x: 5, z: 0 };
  for (let i = 0; i < 65; i++) tickDeploymentState(state, 1 / 60, arena);
  assert.equal(bomb.support, null);
  assert.equal(bomb.height, 0);
  assert.ok(bomb.position.x > 0.8);
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
  assert.equal(game.deployments.inventory.red.wall, 4);
  game.state.players.red.position = { x: 16, z: 0 };
  game.beginDeployAim('red', 'bomb');
  assert.equal(game.updateDeployAim('red', 'bomb', { x: 1, z: 0 }, 1)?.valid, false);
  assert.equal(game.releaseDeployAim('red', 'bomb'), 'invalid');
  assert.equal(game.deployments.inventory.red.bomb, 2);
});

test('wall footprints reject static walls, bases, players and arena borders', () => {
  const game = makeGame();
  const context = {
    arena: game.arena, walls: game.deployments.walls,
    bombs: game.deployments.bombs, players: game.state.players,
  };
  for (const position of [
    { x: -7, z: -6 }, // starting wall
    { x: -16.4, z: 0 }, // red base
    { x: 14.5, z: 0 }, // blue player
    { x: 17.7, z: 4 }, // perimeter
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

test('bomb fuse, spatial blast, two-hit wood destruction and explosion cleanup', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const state = createDeploymentState(arena);
  state.walls = [
    DEPLOYABLES.wall.deploy('near', 'red', { position: { x: 0, z: 0 }, rotation: 0 }, { x: 0, z: 0 }) as RuntimeWall,
    DEPLOYABLES.wall.deploy('far', 'blue', { position: { x: BOMB_RADIUS + 4, z: 0 }, rotation: 0 }, { x: 0, z: 0 }) as RuntimeWall,
  ];
  for (let hit = 1; hit <= 2; hit++) {
    const bomb = DEPLOYABLES.bomb.deploy(`bomb-${hit}`, 'red', {
      position: { x: 0, z: 1.3 }, rotation: 0,
    }, { x: 0, z: 0 }) as RuntimeBomb;
    state.bombs.push(bomb);
    tickDeploymentState(state, bomb.travelDuration, arena);
    assert.equal(state.bombs[0].phase, 'lit');
    tickDeploymentState(state, BOMB_FUSE - 0.01, arena);
    assert.equal(state.bombs.length, 1);
    assert.equal(state.explosions.length, 0);
    tickDeploymentState(state, 0.02, arena);
    assert.equal(state.bombs.length, 0);
    assert.equal(state.explosions.length, 1);
    assert.equal(state.walls.find(w => w.id === 'near')?.hp, hit < 2 ? WALL_TYPES.wood.maxHealth - hit * 50 : undefined);
    assert.equal(state.walls.find(w => w.id === 'far')?.hp, WALL_TYPES.wood.maxHealth);
  }
  tickDeploymentState(state, 1, arena);
  assert.equal(state.explosions.length, 0);
});

test('destroying a starting wall changes only match state', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const original = cloneArena(arena);
  const state = createDeploymentState(arena);
  for (let i = 0; i < 4; i++) {
    const bomb = DEPLOYABLES.bomb.deploy(`initial-hit-${i}`, 'red', {
      position: { x: -7, z: -4.7 }, rotation: 0,
    }, { x: -7, z: -8 }) as RuntimeBomb;
    state.bombs.push(bomb);
    tickDeploymentState(state, bomb.travelDuration, arena);
    tickDeploymentState(state, BOMB_FUSE, arena);
  }
  assert.equal(state.walls.some(wall => wall.id === 'north-west'), false);
  assert.deepEqual(arena, original);
});
