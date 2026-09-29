import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_ARENA, cloneArena, type ArenaDefinition } from '../game/arena.ts';
import { alignSelection, deleteSelection, distributeSelection, duplicateSelection, EditorHistory, mirrorSelection,
  objectsInBox, rotateSelection, selectObject, snapshot, translateSelection } from './arenaEditor.ts';

function arena(): ArenaDefinition {
  const map = cloneArena(BASE_ARENA);
  map.walls = [
    { id: 'a', type: 'wood', position: { x: -12, z: -5 }, width: 2.25, depth: 0.5, rotation: 0 },
    { id: 'b', type: 'stone', position: { x: -12, z: 0 }, width: 2.4, depth: 0.8, rotation: 0 },
    { id: 'c', type: 'wood', position: { x: -12, z: 6 }, width: 2.25, depth: 0.5, rotation: 0 },
  ];
  map.depots = [];
  map.powerupSpawnAreas = [];
  return map;
}

test('selection toggles and world-space box selects object centers', () => {
  let selected = selectObject(new Set(), 'a');
  selected = selectObject(selected, 'b', true);
  assert.deepEqual([...selected], ['a', 'b']);
  assert.deepEqual([...selectObject(selected, 'a', true)], ['b']);
  assert.deepEqual([...selectObject(selected, null)], []);
  assert.deepEqual([...objectsInBox(arena(), { x: -15, z: -6 }, { x: -10, z: 1 })], ['a', 'b']);
});

test('group move is atomic and preserves relative positions', () => {
  const original = arena();
  const selected = new Set(['a', 'b']);
  const moved = translateSelection(original, selected, 2, 1)!;
  assert.deepEqual(moved.arena.walls[0].position, { x: -10, z: -4 });
  assert.deepEqual(moved.arena.walls[1].position, { x: -10, z: 1 });
  assert.equal(moved.arena.walls[1].position.z - moved.arena.walls[0].position.z, 5);
  assert.equal(translateSelection(original, selected, -100, 0), null);
  assert.equal(original.walls[0].position.x, -12);
});

test('duplicate, rotate, mirror and delete author independent valid objects', () => {
  const original = arena();
  const selected = new Set(['a']);
  const duplicate = duplicateSelection(original, selected)!;
  assert.equal(duplicate.arena.walls.length, 4);
  const copyId = [...duplicate.selection][0];
  assert.notEqual(copyId, 'a');
  assert.deepEqual(original.walls.length, 3);
  const rotated = rotateSelection(duplicate.arena, duplicate.selection, 1)!;
  assert.equal(rotated.arena.walls.find(wall => wall.id === copyId)!.rotation, Math.PI / 2);
  const mirrored = mirrorSelection(original, selected)!;
  assert.equal(mirrored.arena.walls.at(-1)!.position.x, 12);
  assert.equal(mirrored.arena.walls.at(-1)!.rotation, Math.PI);
  const removed = deleteSelection(duplicate.arena, duplicate.selection)!;
  assert.equal(removed.arena.walls.length, 3);
  assert.equal(duplicate.arena.walls.length, 4);
});

test('alignment and distribution retain ordering and obey validation', () => {
  const original = arena();
  const selected = new Set(['a', 'b', 'c']);
  const aligned = alignSelection(original, selected, 'x')!;
  assert.deepEqual(aligned.arena.walls.map(wall => wall.position.x), [-12, -12, -12]);
  const spread = distributeSelection(original, selected, 'z')!;
  assert.deepEqual(spread.arena.walls.map(wall => wall.position.z), [-5, 0.5, 6]);
});

test('undo and redo restore one grouped edit without mutating the source', () => {
  const original = arena();
  const selection = new Set(['a', 'b']);
  const history = new EditorHistory();
  const before = snapshot(original, selection);
  const after = translateSelection(original, selection, 1, 0)!;
  history.record(before, snapshot(after.arena, after.selection));
  assert.equal(history.canUndo, true);
  const restored = history.undo(snapshot(after.arena, after.selection))!;
  assert.deepEqual(restored.arena, original);
  const redone = history.redo(restored)!;
  assert.deepEqual(redone.arena, after.arena);
  assert.equal(original.walls[0].position.x, -12);
});
