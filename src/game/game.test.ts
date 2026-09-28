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
  assert.ok(game.state.players.blue.position.x <= arena.bounds.maxX - game.playerRadius);
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
    assert.equal(circleTouchesWall(game.state.players.red.position, game.playerRadius, wall), false);
  }
  assert.ok(game.state.players.red.position.x > start.x + 0.35);
  assert.ok(game.state.players.red.position.z < start.z - 0.35);
});
