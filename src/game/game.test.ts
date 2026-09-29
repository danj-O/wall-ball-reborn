import assert from 'node:assert/strict';
import test from 'node:test';
import { circleTouchesWall, cloneArena, DEFAULT_ARENA } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { Game } from './Game.ts';
import { DEPLOYABLES, type RuntimeWall } from './deployables.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };

test('enemy flag pickup, visible carrier state, and capture at own base', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const game = new Game(arena, new CaptureTheFlag());
  game.state.players.red.position = { ...arena.flagPositions.blue };
  game.update(1 / 60, idle);
  assert.equal(game.state.players.red.carrying, 'blue');
  assert.equal(game.state.flags.blue.carrier, 'red');
  game.state.players.red.position = { ...arena.flagPositions.red };
  game.update(1 / 60, idle);
  assert.equal(game.state.winner, 'red');
  game.reset();
  assert.equal(game.state.winner, null);
  assert.equal(game.state.flags.blue.carrier, null);
  assert.deepEqual(game.state.players.red.position, arena.playerSpawns.red);
});

test('touching a carrier returns the enemy flag to its base', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const game = new Game(arena, new CaptureTheFlag());
  game.state.players.red.position = { ...arena.flagPositions.blue };
  game.update(1 / 60, idle);
  game.state.players.blue.position = { ...game.state.players.red.position };
  game.update(1 / 60, idle);
  assert.equal(game.state.players.red.carrying, null);
  assert.equal(game.state.flags.blue.carrier, null);
  assert.equal(game.state.winner, null);
});

test('configured walls and bounds block movement while facing follows input', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'test', type: 'stone', position: { x: -12, z: 0 }, width: 0.8, depth: 3, rotation: 0 }];
  const game = new Game(arena, new CaptureTheFlag());
  for (let i = 0; i < 60; i++) game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  assert.ok(game.state.players.red.position.x < -12.7);
  assert.equal(game.state.players.red.facing, Math.PI / 2);
  for (let i = 0; i < 300; i++) game.update(1 / 60, { ...idle, blue: { x: 1, z: 0 } });
  assert.ok(game.state.players.blue.position.x <= arena.bounds.maxX - game.playerRadius + 0.01);
});

test('both default wall layers must be removed before a player can enter contested ground', () => {
  const game = new Game(cloneArena(DEFAULT_ARENA), new CaptureTheFlag());
  assert.equal(game.deployments.inventory.red.wall, 8);
  assert.equal(game.deployments.inventory.blue.wall, 8);
  game.state.players.red.position = { x: -6.5, z: -0.6 };
  const advance = () => {
    for (let i = 0; i < 75; i++) game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  };
  advance();
  assert.ok(game.state.players.red.position.x < -5.7);
  game.deployments.walls = game.deployments.walls.filter(wall => wall.id !== 'red-stone-gate-5');
  advance();
  assert.ok(game.state.players.red.position.x < -4.4);
  game.deployments.walls = game.deployments.walls.filter(wall => wall.id !== 'red-wood-gate-6');
  advance();
  assert.ok(game.state.players.red.position.x > -3.5);
});

test('movement into a diagonal wall slides along its face without crossing it', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [];
  const game = new Game(arena, new CaptureTheFlag());
  const wall = DEPLOYABLES.wall.deploy('diagonal', 'red',
    { position: { x: 0, z: 0 }, rotation: Math.PI / 4 }, { x: -2, z: 0 }) as RuntimeWall;
  wall.width = 6;
  game.deployments.walls.push(wall);
  game.state.players.red.position = { x: -0.6, z: -0.6 };
  const start = { ...game.state.players.red.position };
  for (let i = 0; i < 30; i++) {
    game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
    assert.equal(circleTouchesWall(game.state.players.red.position, game.playerRadius - 0.02, wall), false);
  }
  assert.ok(game.state.players.red.position.x > start.x + 0.35);
  assert.ok(game.state.players.red.position.z < start.z - 0.35);
});

test('players accelerate to a faster run, brake smoothly, and reset motion', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [];
  const game = new Game(arena, new CaptureTheFlag());
  const start = game.state.players.red.position.x;
  game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  const firstStep = game.state.players.red.position.x - start;
  assert.ok(firstStep > 0 && firstStep < game.speed / 60);
  for (let i = 0; i < 20; i++) game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  const running = game.state.players.red.position.x;
  game.update(1 / 60, idle);
  assert.ok(game.state.players.red.position.x > running);
  for (let i = 0; i < 20; i++) game.update(1 / 60, idle);
  const stopped = game.state.players.red.position.x;
  game.update(1 / 60, idle);
  assert.equal(game.state.players.red.position.x, stopped);
  game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  game.reset();
  game.update(1 / 60, idle);
  assert.ok(Math.hypot(game.state.players.red.position.x - arena.playerSpawns.red.x,
    game.state.players.red.position.z - arena.playerSpawns.red.z) < 1e-6);
});
