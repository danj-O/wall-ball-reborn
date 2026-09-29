import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA as DEFAULT_ARENA, type ArenaDefinition } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { DEPLOYABLES, type RuntimeBomb, type RuntimeWall } from './deployables.ts';
import { Game } from './Game.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const setup = (arena: ArenaDefinition = cloneArena(DEFAULT_ARENA)) => new Game(arena, new CaptureTheFlag(), () => 0.5);

test('ready state blocks movement, deployment, economy, power-up clocks and scoring until Start', () => {
  const game = setup();
  assert.equal(game.match.phase, 'ready');
  const initial = {
    player: structuredClone(game.state.players.red.position),
    bombTimer: game.economy.passiveBombRemaining.red,
    depotTimer: game.economy.depots[0].generationRemaining,
    powerTimer: game.powerUps.nextSpawnRemaining,
  };
  game.state.players.red.position = { ...game.arena.flagPositions.blue };
  game.beginDeployAim('red', 'wall');
  assert.equal(game.deployments.aim.red.wall, undefined);
  for (let i = 0; i < 900; i++) game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  assert.deepEqual(game.state.players.red.position, game.arena.flagPositions.blue);
  assert.equal(game.state.players.red.carrying, null);
  assert.equal(game.match.duration, 0);
  assert.equal(game.economy.passiveBombRemaining.red, initial.bombTimer);
  assert.equal(game.economy.depots[0].generationRemaining, initial.depotTimer);
  assert.equal(game.powerUps.nextSpawnRemaining, initial.powerTimer);
  game.reset();
  assert.deepEqual(game.state.players.red.position, initial.player);
  assert.equal(game.start(), true);
  assert.equal(game.start(), false);
  assert.equal(game.match.phase, 'playing');
  game.update(1 / 60, idle);
  assert.ok(game.match.duration > 0);
});

test('match statistics count placements, explosions, pickups and territory theft', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [];
  const game = setup(arena);
  game.start();
  game.beginDeployAim('red', 'wall');
  game.updateDeployAim('red', 'wall', { x: 1, z: 0 }, 1);
  assert.equal(game.releaseDeployAim('red', 'wall'), 'placed');
  game.beginDeployAim('blue', 'bomb');
  game.updateDeployAim('blue', 'bomb', { x: -1, z: 0 }, 1);
  assert.equal(game.releaseDeployAim('blue', 'bomb'), 'placed');
  assert.equal(game.match.stats.red.wallsPlaced, 1);
  assert.equal(game.match.stats.blue.bombsThrown, 1);
  const wall = DEPLOYABLES.wall.deploy('target', 'red', { position: { x: 0, z: 0 }, rotation: 0 }, { x: 0, z: 0 }) as RuntimeWall;
  wall.hp = 50;
  game.deployments.walls = [wall];
  const bomb = DEPLOYABLES.bomb.deploy('blast', 'blue', { position: { x: 0, z: 0 }, rotation: 0 }, { x: 0, z: 0 }) as RuntimeBomb;
  bomb.position = { x: 0, z: 0 };
  bomb.phase = 'lit';
  bomb.fuseRemaining = 0.01;
  game.deployments.bombs = [bomb];
  game.update(1 / 60, idle);
  assert.equal(game.match.stats.blue.wallsDestroyed, 1);
  game.powerUps.active.push({ id: 'collect', definitionId: 'speed', position: { ...game.state.players.red.position }, remaining: 10, age: 0 });
  game.update(1 / 60, idle);
  assert.equal(game.match.stats.red.powerUpsCollected, 1);
  game.deployments.inventory.red = { wall: 7, bomb: 5 };
  game.state.players.red.position = { x: 10, z: 0 };
  game.state.players.blue.position = { x: 10, z: 0 };
  game.update(1 / 60, idle);
  assert.equal(game.match.stats.blue.resourcesStolen, 5);
});

test('victory finishes once, freezes gameplay, and replay retains customized arena but resets runtime', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'custom', type: 'wood', position: { x: 0, z: 9 }, width: 2.4, depth: 0.8, rotation: 0 }];
  const game = setup(arena);
  game.start();
  game.powerUps.players.red.speedRemaining = 4;
  game.powerUps.players.red.charges['mega-bomb'] = 1;
  game.state.players.red.position = { ...arena.flagPositions.blue };
  game.update(1 / 60, idle);
  game.state.players.red.position = { ...arena.flagPositions.red };
  game.update(1 / 60, idle);
  assert.equal(game.match.phase, 'finished');
  assert.equal(game.match.winner, 'red');
  const frozen = {
    duration: game.match.duration,
    player: structuredClone(game.state.players.red.position),
    economy: structuredClone(game.economy),
    power: structuredClone(game.powerUps),
  };
  game.beginDeployAim('blue', 'wall');
  assert.equal(game.deployments.aim.blue.wall, undefined);
  for (let i = 0; i < 600; i++) game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
  assert.equal(game.match.duration, frozen.duration);
  assert.deepEqual(game.state.players.red.position, frozen.player);
  assert.deepEqual(game.economy, frozen.economy);
  assert.deepEqual(game.powerUps, frozen.power);
  assert.equal(game.match.phase, 'finished');
  game.reset();
  assert.equal(game.match.phase, 'ready');
  assert.equal(game.match.duration, 0);
  assert.equal(game.match.winner, null);
  assert.equal(game.match.stats.red.wallsPlaced, 0);
  assert.equal(game.powerUps.players.red.speedRemaining, 0);
  assert.equal(game.powerUps.players.red.charges['mega-bomb'], 0);
  assert.equal(game.powerUps.active.length, 0);
  assert.equal(game.deployments.bombs.length, 0);
  assert.equal(game.deployments.walls.find(wall => wall.id === 'custom')?.hp, 100);
  assert.deepEqual(arena.walls, [{ id: 'custom', type: 'wood', position: { x: 0, z: 9 }, width: 2.4, depth: 0.8, rotation: 0 }]);
});
