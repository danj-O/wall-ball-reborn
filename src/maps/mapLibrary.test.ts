import assert from 'node:assert/strict';
import test from 'node:test';
import classic from './classic.json' with { type: 'json' };
import { cloneArena } from '../game/arena.ts';
import { ACTIVE_MAP_KEY, LEGACY_ARENA_KEY, loadLocalMaps, LOCAL_MAPS_KEY, MAP_SCHEMA_VERSION,
  safeMapId, saveLocalMaps, uniqueMapId, validateMapDocument, workingCopy } from './mapLibrary.ts';

test('bundled classic map is a versioned source definition and copies are independent', () => {
  const source = validateMapDocument(classic)!;
  assert.equal(source.id, 'classic');
  assert.equal(source.schemaVersion, MAP_SCHEMA_VERSION);
  const copy = workingCopy(source);
  copy.walls[0].position.x += 1;
  assert.notEqual(copy.walls[0].position.x, source.arena.walls[0].position.x);
});

test('map IDs are sanitized and unique without paths', () => {
  assert.equal(safeMapId('../Depot Madness!'), 'depot-madness');
  assert.equal(safeMapId('2026 Arena'), 'map-2026-arena');
  assert.equal(uniqueMapId('Classic', new Set(['classic'])), 'classic-2');
  assert.equal(validateMapDocument({ ...classic, id: '../other' }), null);
  assert.equal(validateMapDocument({ ...classic, schemaVersion: 9 }), null);
});

test('custom maps round-trip locally and legacy single arena migrates', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const source = validateMapDocument(classic)!;
  saveLocalMaps(storage, [source]);
  assert.ok(data.has(LOCAL_MAPS_KEY));
  assert.deepEqual(loadLocalMaps(storage), [source]);
  data.delete(LOCAL_MAPS_KEY);
  data.set(LEGACY_ARENA_KEY, JSON.stringify(cloneArena(source.arena)));
  const migrated = loadLocalMaps(storage);
  assert.equal(migrated[0].name, 'My Arena');
  assert.deepEqual(migrated[0].arena, source.arena);
  saveLocalMaps(storage, []);
  assert.deepEqual(loadLocalMaps(storage), [], 'removing the last local map must not revive the legacy map');
  assert.equal(typeof ACTIVE_MAP_KEY, 'string');
});

test('Dev Save JSON serialization remains valid and deterministic', () => {
  const source = validateMapDocument(classic)!;
  const text = `${JSON.stringify(source, null, 2)}\n`;
  assert.deepEqual(validateMapDocument(JSON.parse(text)), source);
  assert.equal(`${JSON.stringify(validateMapDocument(JSON.parse(text)), null, 2)}\n`, text);
  const polluted = structuredClone(source) as typeof source & { arena: typeof source.arena & { runtime?: unknown } };
  polluted.arena.runtime = { bombs: 5 };
  (polluted.arena.walls[0] as typeof polluted.arena.walls[0] & { hp?: number }).hp = 1;
  const cleaned = validateMapDocument(polluted)!;
  assert.equal('runtime' in cleaned.arena, false);
  assert.equal('hp' in cleaned.arena.walls[0], false);
});
