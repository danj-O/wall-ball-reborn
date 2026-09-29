import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, DEFAULT_ARENA, flagFitsArena, nextArenaObjectId, WALL_TYPES, wallFitsArena } from './arena.ts';

test('larger default arena has a smaller center and two rows of standard wall pieces per side', () => {
  const arena = DEFAULT_ARENA;
  assert.deepEqual(arena.bounds, { minX: -25, maxX: 25, minZ: -13, maxZ: 13 });
  assert.deepEqual(arena.territories.contested[0].bounds, { minX: -3.5, maxX: 3.5, minZ: -13, maxZ: 13 });
  assert.deepEqual(arena.powerupSpawnAreas[0].bounds, { minX: -2.5, maxX: 2.5, minZ: -8, maxZ: 8 });
  for (const team of ['red', 'blue'] as const) {
    for (const type of ['stone', 'wood'] as const) {
      const row = arena.walls.filter(wall => wall.id.startsWith(`${team}-${type}-gate-`))
        .sort((a, b) => a.position.z - b.position.z);
      assert.equal(row.length, type === 'stone' ? 10 : 11);
      for (const wall of row) {
        assert.equal(wallFitsArena(wall, arena), true);
        assert.equal(wall.rotation, Math.PI / 2);
        assert.equal(wall.width, WALL_TYPES[type].placementFootprint.width);
        assert.equal(wall.depth, WALL_TYPES[type].placementFootprint.depth);
      }
      const firstEdge = row[0].position.z - row[0].width / 2;
      const lastEdge = row.at(-1)!.position.z + row.at(-1)!.width / 2;
      assert.ok(firstEdge - arena.bounds.minZ < 0.76);
      assert.ok(arena.bounds.maxZ - lastEdge < 0.76);
      for (let i = 1; i < row.length; i++) {
        const gap = row[i].position.z - row[i - 1].position.z - row[i].width;
        assert.ok(gap > 0 && gap < 0.76);
      }
    }
  }
});

test('flag bases can move within bounds while avoiding walls and the other flag', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  assert.equal(flagFitsArena('red', { x: -13, z: -4 }, arena), true);
  assert.equal(flagFitsArena('red', { x: 0, z: 0 }, arena), false);
  assert.equal(flagFitsArena('red', { x: 22, z: 0 }, arena), false);
  assert.equal(flagFitsArena('red', { x: arena.bounds.minX + 0.5, z: 0 }, arena), false);
});

test('reset preset restores segmented walls, depots, and standard objectives without sharing data', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  assert.equal(arena.walls.length, 45);
  assert.deepEqual(arena.flagPositions, DEFAULT_ARENA.flagPositions);
  assert.deepEqual(arena.depots, DEFAULT_ARENA.depots);
  arena.walls[0].position.x = 5;
  assert.equal(DEFAULT_ARENA.walls[0].position.x, -5);
});

test('editor object IDs avoid saved walls and depots without browser crypto', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  assert.equal(nextArenaObjectId(arena, 'wall'), 'wall-custom-1');
  arena.walls.push({ ...arena.walls[0], id: 'wall-custom-1' });
  arena.depots.push({ id: 'wall-custom-2', type: 'wall', position: { x: 0, z: 6 }, radius: 1.7, capacity: 8 });
  assert.equal(nextArenaObjectId(arena, 'wall'), 'wall-custom-3');
  assert.equal(nextArenaObjectId(arena, 'depot'), 'depot-custom-1');
});
