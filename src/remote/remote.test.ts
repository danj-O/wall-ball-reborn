import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteInput, REMOTE_INPUT_TIMEOUT_MS } from './RemoteInput.ts';
import { controllerStatus, parseControllerMessage } from './protocol.ts';
import { localControlAllowed, selectedMovement } from './inputOwnership.ts';
import { normalizeRoomCode } from './RoomControllerLink.ts';
import { cloneArena, BASE_ARENA, type Team, type Vec2 } from '../game/arena.ts';
import { Game } from '../game/Game.ts';
import { CaptureTheFlag } from '../game/CaptureTheFlag.ts';

const encoded = (value: unknown) => JSON.stringify(value);
const message = (value: unknown) => {
  const parsed = parseControllerMessage(encoded(value));
  assert.ok(parsed);
  return parsed;
};

test('protocol rejects malformed or unsupported input and clamps bounded controls', () => {
  for (const bad of ['{', 'x'.repeat(1100), encoded({ v: 2, type: 'move', x: 1, y: 0, seq: 1 }),
    encoded({ v: 1, type: 'move', x: Infinity, y: 0, seq: 1 }),
    encoded({ v: 1, type: 'action', id: 'unknown', phase: 'release', x: 0, y: 0, strength: 1, seq: 2 })]) {
    assert.equal(parseControllerMessage(bad), null);
  }
  assert.deepEqual(message({ v: 1, type: 'move', x: 3, y: 4, seq: 3 }),
    { v: 1, type: 'move', x: 0.6, y: 0.8, seq: 3 });
  assert.deepEqual(message({ v: 1, type: 'aim', id: 'bomb', x: -9, y: 0, strength: 8, seq: 4 }),
    { v: 1, type: 'aim', id: 'bomb', x: -1, y: 0, strength: 1, seq: 4 });
});

test('room code normalizes mobile entry without changing control input', () => {
  assert.equal(normalizeRoomCode('12 34'), '1234');
  assert.equal(normalizeRoomCode('0000'), '0000');
  assert.equal(normalizeRoomCode('ab cd-2345'), 'ABCD2345');
  assert.equal(normalizeRoomCode('O0I1ABCD2345'), 'ABCD2345');
  assert.equal(normalizeRoomCode('23456789'), '23456789');
});

function harness() {
  const moves: Array<[Team, Vec2]> = [];
  const actions: string[] = [];
  const input = new RemoteInput({
    toWorld: (x, y) => ({ x: y, z: -x }),
    move: (team, value) => moves.push([team, value]),
    start: (team, id) => actions.push(`${team}:${id}:start`),
    aim: (team, id) => actions.push(`${team}:${id}:aim`),
    release: (team, id) => actions.push(`${team}:${id}:release`),
    cancel: (team, id) => actions.push(`${team}:${id}:cancel`),
  });
  return { input, moves, actions };
}

test('remote movement maps through host view, stale states drop, and local-only mode is inert', () => {
  const { input, moves } = harness();
  input.receive(message({ v: 1, type: 'move', x: 1, y: 0, seq: 1 }), 0);
  assert.equal(moves.length, 0);
  input.connect('red', 100);
  input.receive(message({ v: 1, type: 'move', x: 0.6, y: -0.8, seq: 2 }), 101);
  assert.deepEqual(moves.at(-1), ['red', { x: -0.8, z: -0.6 }]);
  input.receive(message({ v: 1, type: 'move', x: 1, y: 0, seq: 1 }), 102);
  assert.equal(input.dropped, 1);
  assert.deepEqual(moves.at(-1), ['red', { x: -0.8, z: -0.6 }]);
  input.receive(message({ v: 1, type: 'moveStop', seq: 1, moveSeq: 2 }), 103);
  assert.deepEqual(moves.at(-1), ['red', { x: 0, z: 0 }]);
  input.receive(message({ v: 1, type: 'move', x: 0, y: 1, seq: 3 }), 104);
  input.receive(message({ v: 1, type: 'moveStop', seq: 2, moveSeq: 2 }), 105);
  assert.equal(moves.at(-1)?.[0], 'red');
  assert.equal(moves.at(-1)?.[1].x, 1);
  assert.equal(Math.abs(moves.at(-1)![1].z), 0);
});

test('reliable release invokes existing bomb deployment once', () => {
  const arena = cloneArena(BASE_ARENA);
  arena.walls = [];
  const game = new Game(arena, new CaptureTheFlag());
  game.start();
  const input = new RemoteInput({
    toWorld: (x, y) => ({ x, z: y }), move: () => {},
    start: (team, id) => game.beginDeployAim(team, id),
    aim: (team, id, direction, strength) => { game.updateDeployAim(team, id, direction, strength); },
    release: (team, id) => { game.releaseDeployAim(team, id); },
    cancel: (team, id) => game.cancelDeployAim(team, id),
  });
  input.connect('red', 0);
  const before = game.deployments.inventory.red.bomb;
  input.receive(message({ v: 1, type: 'action', id: 'bomb', phase: 'start', x: 1, y: 0, strength: 0, seq: 1 }), 1);
  input.receive(message({ v: 1, type: 'action', id: 'bomb', phase: 'release', x: 1, y: 0, strength: 0.6, seq: 2 }), 2);
  input.receive(message({ v: 1, type: 'action', id: 'bomb', phase: 'release', x: 1, y: 0, strength: 0.6, seq: 2 }), 3);
  assert.equal(game.deployments.inventory.red.bomb, before - 1);
  assert.equal(game.deployments.bombs.length, 1);
});

test('disconnect, timeout, and ownership switch neutralize and cancel held actions', () => {
  const { input, moves, actions } = harness();
  input.connect('red', 0);
  input.receive(message({ v: 1, type: 'move', x: 1, y: 0, seq: 1 }), 1);
  input.receive(message({ v: 1, type: 'action', id: 'wall', phase: 'start', x: 1, y: 0, strength: 0.5, seq: 1 }), 2);
  input.connect('blue', 3);
  assert.deepEqual(moves.at(-1), ['red', { x: 0, z: 0 }]);
  assert.ok(actions.includes('red:wall:cancel'));
  assert.equal(input.owns('red'), false);
  assert.equal(input.owns('blue'), true);
  input.receive(message({ v: 1, type: 'move', x: 0, y: 1, seq: 1 }), 4);
  assert.equal(input.expire(4 + REMOTE_INPUT_TIMEOUT_MS - 1), false);
  assert.equal(input.expire(5 + REMOTE_INPUT_TIMEOUT_MS), true);
  assert.deepEqual(moves.at(-1), ['blue', { x: 0, z: 0 }]);
  assert.equal(input.owner, 'blue');
  assert.equal(input.expire(6 + REMOTE_INPUT_TIMEOUT_MS), false);
  input.receive(message({ v: 1, type: 'move', x: 1, y: 0, seq: 2 }), 2000);
  assert.deepEqual(moves.at(-1), ['blue', { x: 0, z: -1 }]);
  input.disconnect();
  assert.equal(input.owner, null);
});

test('brief phone silence cancels a held aim while preserving the room owner', () => {
  const { input, moves, actions } = harness();
  input.connect('red', 0);
  input.receive(message({ v: 1, type: 'action', id: 'bomb', phase: 'start', x: 1, y: 0, strength: 0.5, seq: 1 }), 1);
  input.receive(message({ v: 1, type: 'move', x: 1, y: 0, seq: 1 }), 2);
  assert.equal(input.expire(2 + REMOTE_INPUT_TIMEOUT_MS + 1), true);
  assert.ok(actions.includes('red:bomb:cancel'));
  assert.deepEqual(moves.at(-1), ['red', { x: 0, z: 0 }]);
  assert.equal(input.owner, 'red');
  input.receive(message({ v: 1, type: 'heartbeat', seq: 2 }), 900);
  input.receive(message({ v: 1, type: 'action', id: 'bomb', phase: 'start', x: 1, y: 0, strength: 0.5, seq: 3 }), 901);
  assert.equal(actions.filter(action => action === 'red:bomb:start').length, 2);
});

test('status serialization contains presentation data only', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(controllerStatus('blue', 'playing', 8, 3, 1, true, false, true))),
    { v: 1, type: 'status', team: 'blue', phase: 'playing', wall: 8, bomb: 3, mega: 1,
      carrying: true, shield: false, speed: true });
});

test('remote ownership selects one player input and leaves the other local', () => {
  const keyboard = { x: 1, z: 0 };
  const touch = { x: 0, z: 0.5 };
  const remote = { x: -0.4, z: -0.3 };
  assert.deepEqual(selectedMovement('red', null, keyboard, touch, remote), { x: 1, z: 0.5 });
  assert.deepEqual(selectedMovement('red', 'red', keyboard, touch, remote), remote);
  assert.deepEqual(selectedMovement('blue', 'red', keyboard, touch, remote), { x: 1, z: 0.5 });
  assert.equal(localControlAllowed('red', 'red'), false);
  assert.equal(localControlAllowed('blue', 'red'), true);
});
