import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROL_VISUAL_ROTATION, orientPadVector, orientScreenVector, PointerRegistry } from './TouchControls.ts';
import { defaultControlLayout, movementZoneRect, normalizeControlLayout } from './controlLayout.ts';

test('four simultaneous pointers have independent owners and releases', () => {
  const pointers = new PointerRegistry<string>();
  for (const [id, owner] of [[1, 'red move'], [2, 'red bomb'], [3, 'blue move'], [4, 'blue wall']] as const) {
    assert.equal(pointers.claim(id, owner), true);
  }
  assert.equal(pointers.size, 4);
  assert.equal(pointers.claim(2, 'red wall'), false);
  assert.equal(pointers.release(2), 'red bomb');
  assert.equal(pointers.get(1), 'red move');
  assert.equal(pointers.get(3), 'blue move');
  assert.equal(pointers.get(4), 'blue wall');
});

test('blue input follows screen direction so left is forward toward red', () => {
  assert.deepEqual(orientScreenVector('red', 0, -50), { x: 0, y: -50 });
  assert.deepEqual(orientScreenVector('blue', -50, 0), { x: -50, y: 0 });
  assert.deepEqual(orientScreenVector('blue', 50, 0), { x: 50, y: 0 });
  assert.deepEqual(orientScreenVector('blue', 0, -50), { x: 0, y: -50 });
});

test('control artwork reads upright from each side and knob follows the drag', () => {
  assert.deepEqual(CONTROL_VISUAL_ROTATION, { red: 90, blue: -90 });
  assert.deepEqual(orientScreenVector('red', 50, 0), { x: 50, y: 0 });
  const redLocal = orientPadVector('red', 50, 0);
  assert.ok(Math.abs(redLocal.x) < 1e-10);
  assert.ok(Math.abs(redLocal.y + 50) < 1e-10);
  const blueLocal = orientPadVector('blue', -50, 0);
  assert.ok(Math.abs(blueLocal.x) < 1e-10);
  assert.ok(Math.abs(blueLocal.y + 50) < 1e-10);
});

test('control layout retains independent pad sizes, drag areas, and positions', () => {
  const layout = defaultControlLayout(1024, 768);
  layout.positions['red-bomb'] = { x: 0.32, y: 0.74 };
  layout.sizes['red-move'] = 200;
  layout.sizes['red-bomb'] = 60;
  layout.floatRadii['red-move'] = 120;
  const restored = normalizeControlLayout(JSON.parse(JSON.stringify(layout)), 1024, 768);
  assert.deepEqual(restored.positions['red-bomb'], { x: 0.32, y: 0.74 });
  assert.equal(restored.sizes['red-move'], 200);
  assert.equal(restored.sizes['red-bomb'], 60);
  assert.equal(restored.sizes['blue-move'], 110);
  assert.equal(restored.floatRadii['red-move'], 120);
  assert.equal(restored.floatRadii['red-bomb'], 52);
  restored.positions['red-wall'] = { x: -4, y: 9 };
  const clamped = normalizeControlLayout(restored, 1024, 768);
  assert.deepEqual(clamped.positions['red-wall'], { x: 0, y: 1 });
});

test('older shared-size layouts migrate without losing their positions', () => {
  const legacy = { positions: { 'blue-bomb': { x: 0.74, y: 0.15 } }, padSize: 118, floatRadius: 84 };
  const restored = normalizeControlLayout(legacy, 844, 390);
  assert.equal(restored.sizes['red-move'], 118);
  assert.equal(restored.sizes['blue-bomb'], 118);
  assert.equal(restored.floatRadii['blue-bomb'], 84);
  assert.deepEqual(restored.positions['blue-bomb'], legacy.positions['blue-bomb']);
});

test('movement touch square fills its corner and moves with its pad', () => {
  const layout = defaultControlLayout(844, 390);
  const corner = movementZoneRect(layout.positions['red-move'], layout.sizes['red-move'], layout.floatRadii['red-move'], 844, 390);
  assert.equal(corner.left, 0);
  assert.equal(corner.top, 0);
  assert.ok(corner.side >= 180);
  const moved = movementZoneRect({ x: 0.35, y: 0.35 }, 180, 100, 844, 390);
  assert.ok(moved.left > corner.left);
  assert.ok(moved.top > corner.top);
});

test('two independent optional ability slots are reserved for each player', () => {
  const layout = defaultControlLayout(844, 390);
  for (const team of ['red', 'blue'] as const) {
    assert.ok(layout.positions[`${team}-ability-1`]);
    assert.ok(layout.positions[`${team}-ability-2`]);
    assert.ok(layout.sizes[`${team}-ability-1`] < layout.sizes[`${team}-move`]);
    assert.notDeepEqual(layout.positions[`${team}-ability-1`], layout.positions[`${team}-ability-2`]);
  }
});
