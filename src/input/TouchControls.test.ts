import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROL_VISUAL_ROTATION, movementFromTouch, orientPadVector, orientScreenVector, PointerRegistry } from './TouchControls.ts';
import { defaultControlLayout, movementZoneRect, normalizeControlLayout } from './controlLayout.ts';
import { DEPLOYABLES } from '../game/deployables.ts';

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
  const baseline = structuredClone(layout);
  layout.positions['red-bomb'] = { x: 0.32, y: 0.74 };
  layout.sizes['red-move'] = 200;
  layout.sizes['red-bomb'] = 60;
  layout.floatRadii['red-move'] = 120;
  const restored = normalizeControlLayout(JSON.parse(JSON.stringify(layout)), 1024, 768);
  assert.deepEqual(restored.positions['red-bomb'], { x: 0.32, y: 0.74 });
  assert.equal(restored.sizes['red-move'], 200);
  assert.equal(restored.sizes['red-bomb'], 60);
  assert.equal(restored.sizes['blue-move'], baseline.sizes['blue-move']);
  assert.equal(restored.floatRadii['red-move'], 120);
  assert.equal(restored.floatRadii['red-bomb'], baseline.floatRadii['red-bomb']);
  assert.equal(restored.moveAreas['red-move'], baseline.moveAreas['red-move']);
  assert.equal(restored.moveInsets['blue-move'], baseline.moveInsets['blue-move']);
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
  assert.equal(restored.moveAreas['red-move'], defaultControlLayout(844, 390).moveAreas['red-move']);
});

test('movement touch square fills its corner and moves with its pad', () => {
  const corner = movementZoneRect({ x: 0.08, y: 0.17 }, 320, 6, 844, 390);
  assert.equal(corner.left, 6);
  assert.equal(corner.top, 6);
  assert.ok(corner.width >= 300);
  assert.ok(corner.height >= 180);
  const moved = movementZoneRect({ x: 0.35, y: 0.35 }, 180, 6, 844, 390);
  assert.ok(moved.left > corner.left);
  assert.ok(moved.top > corner.top);
});

test('movement acquisition size and inset do not alter joystick travel', () => {
  const layout = defaultControlLayout(844, 390);
  const radius = layout.floatRadii['red-move'];
  layout.moveAreas['red-move'] = 200;
  const original = movementZoneRect(layout.positions['red-move'], layout.moveAreas['red-move'], layout.moveInsets['red-move'], 844, 390);
  layout.moveAreas['red-move'] = 460;
  layout.moveInsets['red-move'] = 0;
  const expanded = movementZoneRect(layout.positions['red-move'], layout.moveAreas['red-move'], layout.moveInsets['red-move'], 844, 390);
  assert.ok(expanded.width > original.width);
  assert.equal(layout.floatRadii['red-move'], radius);
  assert.ok(expanded.left >= 0);
});

test('movement starts at touch origin, follows drag magnitude, and clamps at travel radius', () => {
  const toWorld = (dx: number, dy: number) => ({ x: dx ? Math.sign(dx) : 0, z: dy ? Math.sign(dy) : 0 });
  const origin = { x: 170, y: 90 };
  assert.deepEqual(movementFromTouch('red', origin, origin, 70, toWorld), { x: 0, z: 0 });
  assert.deepEqual(movementFromTouch('red', origin, { x: 205, y: 90 }, 70, toWorld), { x: 0.5, z: 0 });
  assert.deepEqual(movementFromTouch('red', origin, { x: 310, y: 90 }, 70, toWorld), { x: 1, z: 0 });
  assert.deepEqual(movementFromTouch('blue', origin, { x: 100, y: 90 }, 70, toWorld), { x: -1, z: 0 });
});

test('action visual size range is independent of deployment distances', () => {
  const small = defaultControlLayout(844, 390);
  const large = defaultControlLayout(844, 390);
  small.sizes['red-bomb'] = 38;
  large.sizes['red-bomb'] = 280;
  assert.equal(small.floatRadii['red-bomb'], large.floatRadii['red-bomb']);
  assert.equal(DEPLOYABLES.bomb.range.max, 6);
  assert.equal(DEPLOYABLES.wall.range.max, 2.7);
  assert.deepEqual(DEPLOYABLES.bomb.range, DEPLOYABLES['mega-bomb'].range);
});

test('two independent optional ability slots are reserved for each player', () => {
  const layout = defaultControlLayout(844, 390);
  for (const team of ['red', 'blue'] as const) {
    assert.ok(layout.positions[`${team}-ability-1`]);
    assert.ok(layout.positions[`${team}-ability-2`]);
    assert.ok(layout.sizes[`${team}-ability-1`] >= 38);
  }
});
