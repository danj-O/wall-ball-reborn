import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultControlLayout, normalizeControlLayout } from '../src/input/controlLayout.ts';
import { validateControlPreset } from './controlDefaultPreset.ts';

test('a complete edited touch layout can become the code default', () => {
  const layout = defaultControlLayout(844, 390);
  layout.moveAreas['red-move'] = 400;
  layout.sizes['blue-bomb'] = 140;
  const preset = validateControlPreset(layout);
  assert.ok(preset);
  assert.equal(preset.moveAreas['red-move'], 400);
  assert.equal(preset.sizes['blue-bomb'], 140);
  assert.deepEqual(normalizeControlLayout(preset, 844, 390), preset);
});

test('incomplete or out-of-range presets cannot be written', () => {
  assert.equal(validateControlPreset({}), null);
  const layout = defaultControlLayout(844, 390);
  layout.positions['red-move'].x = 3;
  assert.equal(validateControlPreset(layout), null);
  layout.positions['red-move'].x = 0.1;
  layout.sizes['red-wall'] = 999;
  assert.equal(validateControlPreset(layout), null);
});
