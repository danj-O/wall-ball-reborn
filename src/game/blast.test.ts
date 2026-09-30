import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA, WALL_HEIGHT } from './arena.ts';
import { CaptureTheFlag } from './CaptureTheFlag.ts';
import { DEPLOYABLES, type RuntimeBomb } from './deployables.ts';
import { Game } from './Game.ts';
import { BASE_GAME_SETTINGS } from './gameSettingsSchema.ts';
import { tickEconomy } from './economy.ts';
import { tickPowerUps } from './powerups.ts';

const idle = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };

function litBomb(game: Game, x: number, z = 0): RuntimeBomb {
  const bomb = DEPLOYABLES.bomb.deploy('blast', 'red', { position: { x, z }, rotation: 0 }, { x, z });
  assert.equal(bomb.kind, 'bomb');
  bomb.phase = 'lit';
  bomb.position = { x, z };
  bomb.height = 0;
  bomb.fuseRemaining = 0;
  game.deployments.bombs.push(bomb);
  return bomb;
}

test('one explosion pushes and lifts both teams, including its owner', () => {
  const arena = cloneArena(BASE_ARENA);
  arena.walls = [];
  const settings = structuredClone(BASE_GAME_SETTINGS);
  settings.playerMass = 5;
  const game = new Game(arena, new CaptureTheFlag(), Math.random, settings);
  game.start();
  game.state.players.red.position = { x: -0.7, z: 0 };
  game.state.players.blue.position = { x: 0.7, z: 0 };
  game.update(1 / 60, idle);
  litBomb(game, 0);
  game.update(1 / 60, idle);
  assert.ok(game.physics.getPlayerBody('red').velocity.x < 0);
  assert.ok(game.physics.getPlayerBody('blue').velocity.x > 0);
  assert.ok(game.physics.getPlayerBody('red').velocity.y > 0);
  assert.ok(game.physics.getPlayerBody('blue').velocity.y > 0);
  assert.equal(game.state.players.red.airborne, true);
  assert.equal(game.state.players.blue.airborne, true);
  game.reset();
  assert.equal(game.state.players.red.height, 0);
  assert.equal(game.state.players.red.airborne, false);
});

test('player weight and separate bomb tuning change the blast response', () => {
  const response = (mass: number, force: number, lift: number) => {
    const arena = cloneArena(BASE_ARENA);
    arena.walls = [];
    const settings = structuredClone(BASE_GAME_SETTINGS);
    settings.playerMass = mass;
    settings.projectiles.bomb.blastForce = force;
    settings.projectiles.bomb.blastLift = lift;
    const game = new Game(arena, new CaptureTheFlag(), Math.random, settings);
    game.start();
    game.state.players.red.position = { x: -0.7, z: 0 };
    game.state.players.blue.position = { x: 4, z: 0 };
    game.update(1 / 60, idle);
    litBomb(game, 0);
    game.update(1 / 60, idle);
    return game.physics.getPlayerBody('red').velocity.clone();
  };
  const light = response(3, 30, 50);
  const heavy = response(9, 30, 50);
  const noLift = response(3, 30, 0);
  const noPush = response(3, 0, 50);
  assert.ok(Math.abs(light.x) > Math.abs(heavy.x));
  assert.ok(light.y > heavy.y);
  assert.ok(Math.abs(noLift.y) < 0.1);
  assert.ok(Math.abs(noPush.x) < 0.1);
});

test('a lifted player can steer over a wall, while horizontal push alone cannot cross it', () => {
  const arena = cloneArena(BASE_ARENA);
  arena.walls = [{ id: 'jump-wall', type: 'stone', position: { x: 0, z: 0 },
    width: 2.4, depth: 0.8, rotation: Math.PI / 2 }];
  const run = (lift: number) => {
    const settings = structuredClone(BASE_GAME_SETTINGS);
    settings.playerMass = 5.3;
    settings.projectiles.bomb.blastRadius = 2;
    settings.projectiles.bomb.blastLift = lift;
    const game = new Game(cloneArena(arena), new CaptureTheFlag(), Math.random, settings);
    game.start();
    game.state.players.red.position = { x: -0.85, z: 0 };
    game.state.players.blue.position = { x: 4, z: 0 };
    game.update(1 / 60, idle);
    litBomb(game, -1.2);
    game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
    let peakHeight = 0;
    for (let i = 0; i < 100; i++) {
      game.update(1 / 60, { ...idle, red: { x: 1, z: 0 } });
      peakHeight = Math.max(peakHeight, game.state.players.red.height);
    }
    return { x: game.state.players.red.position.x, peakHeight };
  };
  const launched = run(50);
  const grounded = run(0);
  assert.ok(launched.peakHeight > WALL_HEIGHT);
  assert.ok(launched.x > 0.8, `landed beyond wall at ${launched.x}`);
  assert.ok(grounded.x < -0.75, `wall blocked ground player at ${grounded.x}`);
});

test('blast against a wall keeps vertical lift without rebounding sideways away from it', () => {
  const arena = cloneArena(BASE_ARENA);
  arena.walls = [{ id: 'side-wall', type: 'stone', position: { x: 0, z: 0 },
    width: 2.4, depth: 0.8, rotation: Math.PI / 2 }];
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  game.state.players.red.position = { x: -0.85, z: 0 };
  game.state.players.blue.position = { x: 4, z: 0 };
  game.update(1 / 60, idle);
  litBomb(game, -1.2);
  for (let i = 0; i < 8; i++) game.update(1 / 60, idle);
  const player = game.physics.getPlayerBody('red');
  assert.ok(game.state.players.red.height > 1, 'blast still lifts the player alongside the wall');
  assert.ok(player.velocity.x > -0.2, `wall did not bounce player away at ${player.velocity.x}`);
  assert.ok(game.state.players.red.position.x > -0.9, 'player stays near the wall while rising');
});

test('airborne players cannot take flags, score, or tag carriers until landing', () => {
  const mode = new CaptureTheFlag();
  const arena = cloneArena(BASE_ARENA);
  const state = mode.createState(arena);
  state.players.red.position = { ...arena.flagPositions.blue };
  state.players.red.airborne = true;
  mode.update(state, arena);
  assert.equal(state.players.red.carrying, null);
  state.players.red.airborne = false;
  mode.update(state, arena);
  assert.equal(state.players.red.carrying, 'blue');
  state.players.blue.position = { x: state.players.red.position.x + 0.8, z: state.players.red.position.z };
  state.players.blue.airborne = true;
  mode.update(state, arena);
  assert.equal(state.players.red.carrying, 'blue');
  state.players.blue.position = { ...arena.playerSpawns.blue };
  state.players.red.position = { ...arena.flagPositions.red };
  state.players.red.airborne = true;
  mode.update(state, arena);
  assert.equal(state.winner, null);
  state.players.red.airborne = false;
  mode.update(state, arena);
  assert.equal(state.winner, 'red');
});

test('airborne players cannot collect depot stock or power-ups', () => {
  const arena = cloneArena(BASE_ARENA);
  const game = new Game(arena, new CaptureTheFlag());
  const wallDepot = game.economy.depots.find(depot => depot.type === 'wall')!;
  game.state.players.red.position = { ...wallDepot.position };
  game.state.players.red.airborne = true;
  const wallsBefore = game.deployments.inventory.red.wall;
  tickEconomy(game.economy, game.deployments, game.state.players, 0, game.settings);
  assert.equal(game.deployments.inventory.red.wall, wallsBefore);
  assert.equal(wallDepot.stock, 1);
  game.powerUps.active.push({ id: 'test-pickup', definitionId: 'speed', position: { ...wallDepot.position },
    remaining: 10, age: 0 });
  tickPowerUps(game.powerUps, arena, game.deployments.walls, game.state.players, 0);
  assert.equal(game.powerUps.active.length, 1);
  game.state.players.red.airborne = false;
  tickEconomy(game.economy, game.deployments, game.state.players, 0, game.settings);
  tickPowerUps(game.powerUps, arena, game.deployments.walls, game.state.players, 0);
  assert.equal(game.deployments.inventory.red.wall, wallsBefore + 1);
  assert.equal(game.powerUps.active.length, 0);
});
