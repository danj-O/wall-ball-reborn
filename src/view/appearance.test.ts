import assert from 'node:assert/strict';
import test from 'node:test';
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, loadAppearance, validateAppearance } from './appearance.ts';

test('warm meadow defaults are a valid global appearance preset', () => {
  assert.deepEqual(validateAppearance(DEFAULT_APPEARANCE), DEFAULT_APPEARANCE);
  assert.notEqual(DEFAULT_APPEARANCE.field, DEFAULT_APPEARANCE.contestedField);
  assert.notEqual(DEFAULT_APPEARANCE.stone, DEFAULT_APPEARANCE.wood);
  assert.notEqual(DEFAULT_APPEARANCE.red, DEFAULT_APPEARANCE.blue);
});

test('appearance settings persist on a device and reject malformed presets', () => {
  const saved = { ...DEFAULT_APPEARANCE, wood: '#8A633D', keyIntensity: 2.2 };
  const storage = { getItem: (key: string) => key === APPEARANCE_STORAGE_KEY ? JSON.stringify(saved) : null };
  assert.deepEqual(loadAppearance(storage), saved);
  assert.equal(validateAppearance({ ...saved, wood: 'red' }), null);
  assert.equal(validateAppearance({ ...saved, ambientIntensity: 99 }), null);
  assert.equal(validateAppearance({ ...saved, field: '#6F9270', extra: 'ignored' })?.field, '#6F9270');
});
