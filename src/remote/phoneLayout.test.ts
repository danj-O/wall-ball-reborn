import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPhoneLayout, validatePhoneLayout } from './phoneLayout.ts';

test('bundled phone layout is complete and independent across callers', () => {
  const first = defaultPhoneLayout();
  assert.deepEqual(validatePhoneLayout(first), first);
  first.actions.bomb.x = .6;
  assert.notEqual(defaultPhoneLayout().actions.bomb.x, .6);
});

test('phone layout validation rejects invalid movement bounds and action sizes', () => {
  const layout = defaultPhoneLayout();
  layout.move.x = .49;
  assert.equal(validatePhoneLayout(layout), null);
  layout.move.x = .225;
  layout.actions.wall.size = 300;
  assert.equal(validatePhoneLayout(layout), null);
});
