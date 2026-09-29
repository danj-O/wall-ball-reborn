import assert from 'node:assert/strict';
import test from 'node:test';
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, loadAppearance, validateAppearance } from './appearance.ts';

test('warm meadow defaults are a valid global appearance preset', () => {
  assert.equal(validateAppearance(DEFAULT_APPEARANCE)?.field, '#6F9270');
  assert.equal(DEFAULT_APPEARANCE.stone, '#D8D0B8');
  assert.equal(DEFAULT_APPEARANCE.blue, '#4E9ED6');
});

test('appearance settings persist on a device and reject malformed presets', () => {
  const saved = { ...DEFAULT_APPEARANCE, wood: '#8A633D', keyIntensity: 2.2 };
  const storage = { getItem: (key: string) => key === APPEARANCE_STORAGE_KEY ? JSON.stringify(saved) : null };
  assert.deepEqual(loadAppearance(storage), saved);
  assert.equal(validateAppearance({ ...saved, wood: 'red' }), null);
  assert.equal(validateAppearance({ ...saved, ambientIntensity: 99 }), null);
  assert.equal(validateAppearance({ ...saved, field: '#6F9270', extra: 'ignored' })?.field, '#6F9270');
});
