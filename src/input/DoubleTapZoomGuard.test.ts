import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleTapZoomGuard } from './DoubleTapZoomGuard.ts';

const point = (identifier: number, x = 100, y = 100) => ({ identifier, x, y });

test('only the second nearby rapid tap needs browser-default prevention', () => {
  const guard = new DoubleTapZoomGuard();
  guard.begin(1, point(1), 0, true);
  assert.equal(guard.end(0, point(1), 50, true), false);
  guard.begin(1, point(2, 110), 130, true);
  assert.equal(guard.end(0, point(2, 110), 180, true), true);
  guard.begin(1, point(3, 110), 250, true);
  assert.equal(guard.end(0, point(3, 110), 280, true), false);
});

test('drags, separated taps, and slow taps do not trigger the guard', () => {
  const guard = new DoubleTapZoomGuard();
  guard.begin(1, point(1), 0, true);
  guard.move(1, point(1, 150));
  assert.equal(guard.end(0, point(1), 100, true), false);
  guard.begin(1, point(2), 120, true);
  assert.equal(guard.end(0, point(2), 160, true), false);
  guard.begin(1, point(3, 200), 220, true);
  assert.equal(guard.end(0, point(3, 200), 260, true), false);
  guard.begin(1, point(4), 700, true);
  assert.equal(guard.end(0, point(4), 1100, true), false);
});

test('simultaneous fingers and interactive form targets remain untouched', () => {
  const guard = new DoubleTapZoomGuard();
  guard.begin(1, point(1), 0, true);
  guard.begin(2, point(2), 20, true);
  assert.equal(guard.end(1, point(1), 60, true), false);
  assert.equal(guard.end(0, point(2), 70, true), false);
  guard.begin(1, point(3), 100, false);
  assert.equal(guard.end(0, point(3), 140, false), false);
  guard.begin(1, point(4), 200, true);
  assert.equal(guard.end(0, point(4), 240, true), false);
  guard.cancel();
  guard.begin(1, point(5), 280, true);
  assert.equal(guard.end(0, point(5), 320, true), false);
});
