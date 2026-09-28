import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, DEFAULT_ARENA, flagFitsArena, nextArenaObjectId, simpleArena } from './arena.ts';

test('flag bases can move within bounds while avoiding walls and the other flag', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  assert.equal(flagFitsArena('red', { x: -13, z: -4 }, arena), true);
  assert.equal(flagFitsArena('red', { x: 0, z: 0 }, arena), false);
  assert.equal(flagFitsArena('red', { x: 17.5, z: 0 }, arena), false);
  assert.equal(flagFitsArena('red', { x: arena.bounds.minX + 0.5, z: 0 }, arena), false);
});

test('reset arena provides a single center wall and restores standard objectives', () => {
  const arena = simpleArena();
  assert.equal(arena.walls.length, 1);
  assert.equal(arena.walls[0].id, 'center');
  assert.deepEqual(arena.walls[0].position, { x: 0, z: 0 });
  assert.deepEqual(arena.flagPositions, DEFAULT_ARENA.flagPositions);
  assert.deepEqual(arena.depots, []);
  arena.walls[0].position.x = 5;
  assert.equal(DEFAULT_ARENA.walls.find(w => w.id === 'center')?.position.x, 0);
});

test('editor object IDs avoid saved walls and depots without browser crypto', () => {
  const arena = simpleArena();
  assert.equal(nextArenaObjectId(arena, 'wall'), 'wall-custom-1');
  arena.walls.push({ ...arena.walls[0], id: 'wall-custom-1' });
  arena.depots.push({ id: 'wall-custom-2', type: 'wall', position: { x: 0, z: 6 }, radius: 1.7, capacity: 8 });
  assert.equal(nextArenaObjectId(arena, 'wall'), 'wall-custom-3');
  assert.equal(nextArenaObjectId(arena, 'depot'), 'depot-custom-1');
});
