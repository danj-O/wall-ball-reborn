import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneArena, BASE_ARENA as DEFAULT_ARENA, DEFAULT_ARENA as SAVED_DEFAULT_ARENA, flagFitsArena, minimumArenaDimensions, nextArenaObjectId, resizedArena, validateArenaDefinition, WALL_TYPES, wallFitsArena } from './arena.ts';

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

test('saved default arena is valid and independent of the baseline layout', () => {
  assert.ok(validateArenaDefinition(SAVED_DEFAULT_ARENA));
  const clone = cloneArena(SAVED_DEFAULT_ARENA);
  clone.bounds.maxX += 1;
  assert.notEqual(clone.bounds.maxX, SAVED_DEFAULT_ARENA.bounds.maxX);
});

test('arena resize changes centered bounds and territories while preserving placed objects', () => {
  const original = cloneArena(DEFAULT_ARENA);
  const wider = resizedArena(original, 60, 30)!;
  assert.ok(wider);
  assert.deepEqual(wider.bounds, { minX: -30, maxX: 30, minZ: -15, maxZ: 15 });
  assert.deepEqual(wider.walls, original.walls);
  assert.deepEqual(wider.flagPositions, original.flagPositions);
  assert.equal(wider.territories.red[0].bounds.minX, -30);
  assert.equal(wider.territories.contested[0].bounds.maxZ, 15);
  assert.deepEqual(original.bounds, { minX: -25, maxX: 25, minZ: -13, maxZ: 13 });
  assert.equal(resizedArena(original, 40, 20), null); // Flags and gate rows need room.
});

test('arena can shrink after edge objects are moved or removed', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [];
  arena.depots = [];
  arena.powerupSpawnAreas = [];
  arena.flagPositions = { red: { x: -16, z: 0 }, blue: { x: 16, z: 0 } };
  arena.playerSpawns = { red: { x: -15, z: 0 }, blue: { x: 15, z: 0 } };
  const smaller = resizedArena(arena, 40, 20);
  assert.ok(smaller);
  assert.deepEqual(smaller.bounds, { minX: -20, maxX: 20, minZ: -10, maxZ: 10 });
});

test('arena resize preserves a customized contested lane and its power-up region', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.territories.red[0].bounds.maxX = -4.5;
  arena.territories.contested[0].bounds.minX = -4.5;
  arena.territories.contested[0].bounds.maxX = 4.5;
  arena.territories.blue[0].bounds.minX = 4.5;
  arena.powerupSpawnAreas[0].bounds.minX = -4;
  arena.powerupSpawnAreas[0].bounds.maxX = 4;
  assert.ok(validateArenaDefinition(arena));
  const resized = resizedArena(arena, 60, 30)!;
  assert.ok(resized);
  assert.deepEqual(resized.territories.contested[0].bounds,
    { minX: -4.5, maxX: 4.5, minZ: -15, maxZ: 15 });
  assert.deepEqual(resized.powerupSpawnAreas, arena.powerupSpawnAreas);
});

test('authored walls reject hard overlaps even when rotated', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  arena.walls = [{ id: 'first', type: 'stone', position: { x: -10, z: 3 }, width: 2.4, depth: 0.8, rotation: Math.PI / 4 }];
  const overlapping = { id: 'second', type: 'wood' as const, position: { x: -10.25, z: 3.25 }, width: 2.25, depth: 0.5, rotation: 0 };
  assert.equal(wallFitsArena(overlapping, arena), false);
  arena.walls.push(overlapping);
  assert.equal(validateArenaDefinition(arena), null);
});

test('slider minimum tracks the closest existing objects in two-unit increments', () => {
  const arena = cloneArena(DEFAULT_ARENA);
  const minimum = minimumArenaDimensions(arena);
  assert.equal(minimum.width % 2, 0);
  assert.equal(minimum.length % 2, 0);
  assert.ok(resizedArena(arena, minimum.width, arena.bounds.maxZ - arena.bounds.minZ));
  assert.ok(resizedArena(arena, arena.bounds.maxX - arena.bounds.minX, minimum.length));
  assert.equal(resizedArena(arena, minimum.width - 2, arena.bounds.maxZ - arena.bounds.minZ), null);
  assert.equal(resizedArena(arena, arena.bounds.maxX - arena.bounds.minX, minimum.length - 2), null);

  arena.walls = [];
  arena.depots = [];
  arena.powerupSpawnAreas = [];
  arena.flagPositions = { red: { x: -16, z: 0 }, blue: { x: 16, z: 0 } };
  arena.playerSpawns = { red: { x: -15, z: 0 }, blue: { x: 15, z: 0 } };
  const cleared = minimumArenaDimensions(arena);
  assert.ok(cleared.width < minimum.width);
  assert.ok(cleared.length < minimum.length);
});
