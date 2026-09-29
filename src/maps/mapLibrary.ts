import { cloneArena, migrateArena, validateArenaDefinition, type ArenaDefinition } from '../game/arena.ts';

export const MAP_SCHEMA_VERSION = 1;
export const LOCAL_MAPS_KEY = 'wall-ball-reborn-local-maps-v1';
export const ACTIVE_MAP_KEY = 'wall-ball-reborn-active-map-v1';
export const LEGACY_ARENA_KEY = 'wall-ball-reborn-arena-v1';

export type MapDocument = { id: string; name: string; schemaVersion: number; arena: ArenaDefinition };
export type MapSource = 'built-in' | 'custom';
export type MapChoice = MapDocument & { source: MapSource };

export function safeMapId(name: string): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  if (!slug) return 'untitled-map';
  return /^[a-z]/.test(slug) ? slug : `map-${slug}`.slice(0, 48);
}

export function validateMapDocument(value: unknown, report?: (reason: string) => void): MapDocument | null {
  const invalid = (message: string) => { report?.(message); return null; };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Map document is missing.');
  const map = value as Record<string, unknown>;
  if (map.schemaVersion !== MAP_SCHEMA_VERSION) return invalid('Unsupported map schema version.');
  if (typeof map.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(map.id)) return invalid('Map ID is invalid.');
  if (typeof map.name !== 'string' || !map.name.trim() || map.name.length > 64) return invalid('Map name is invalid.');
  const arena = validateArenaDefinition(map.arena, report);
  return arena ? { id: map.id, name: map.name.trim(), schemaVersion: MAP_SCHEMA_VERSION, arena } : null;
}

export function uniqueMapId(name: string, used: ReadonlySet<string>): string {
  const root = safeMapId(name) || 'untitled-map';
  let id = root;
  for (let n = 2; used.has(id); n++) id = `${root.slice(0, 44)}-${n}`;
  return id;
}

export function loadLocalMaps(storage: Pick<Storage, 'getItem'>): MapDocument[] {
  try {
    const saved = storage.getItem(LOCAL_MAPS_KEY);
    if (saved !== null) {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed.map(item => validateMapDocument(item)).filter((item): item is MapDocument => !!item);
    }
  } catch { /* Corrupt local data cannot overwrite built-ins. */ }
  try {
    const legacy = storage.getItem(LEGACY_ARENA_KEY);
    if (legacy) {
      const arena = validateArenaDefinition(migrateArena(JSON.parse(legacy))) ?? null;
      if (arena) return [{ id: 'my-arena', name: 'My Arena', schemaVersion: MAP_SCHEMA_VERSION, arena }];
    }
  } catch { /* Use built-in map. */ }
  return [];
}

export function saveLocalMaps(storage: Pick<Storage, 'setItem'>, maps: readonly MapDocument[]): void {
  const checked = maps.map(map => validateMapDocument(map));
  if (checked.some(map => !map)) throw new Error('A custom map is invalid.');
  storage.setItem(LOCAL_MAPS_KEY, JSON.stringify(checked));
}

export function workingCopy(map: MapDocument): ArenaDefinition { return cloneArena(map.arena); }
