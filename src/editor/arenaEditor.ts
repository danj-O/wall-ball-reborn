import { cloneArena, nextArenaObjectId, validateArenaDefinition, type ArenaDefinition, type ArenaBounds, type Vec2 } from '../game/arena.ts';

export const EDITOR_GRID = 0.25;
export type EditorSelection = ReadonlySet<string>;
export type EditResult = { arena: ArenaDefinition; selection: Set<string> };
export type EditorSnapshot = EditResult;

export function snap(value: number): number { return Math.round(value / EDITOR_GRID) * EDITOR_GRID; }
export function selectObject(selection: EditorSelection, id: string | null, toggle = false): Set<string> {
  if (!id) return toggle ? new Set(selection) : new Set();
  if (!toggle) return new Set([id]);
  const next = new Set(selection);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function entityCenter(arena: ArenaDefinition, id: string): Vec2 | null {
  const wall = arena.walls.find(item => item.id === id);
  if (wall) return wall.position;
  const depot = arena.depots.find(item => item.id === id);
  if (depot) return depot.position;
  const region = arena.powerupSpawnAreas.find(item => item.id === id);
  if (region) return { x: (region.bounds.minX + region.bounds.maxX) / 2, z: (region.bounds.minZ + region.bounds.maxZ) / 2 };
  if (id === 'flag:red') return arena.flagPositions.red;
  if (id === 'flag:blue') return arena.flagPositions.blue;
  return null;
}

export function objectsInBox(arena: ArenaDefinition, a: Vec2, b: Vec2): Set<string> {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
  const ids = [...arena.walls, ...arena.depots, ...arena.powerupSpawnAreas].map(item => item.id);
  return new Set(ids.filter(id => {
    const center = entityCenter(arena, id)!;
    return center.x >= minX && center.x <= maxX && center.z >= minZ && center.z <= maxZ;
  }));
}

function shiftBounds(bounds: ArenaBounds, dx: number, dz: number): ArenaBounds {
  return { minX: bounds.minX + dx, maxX: bounds.maxX + dx, minZ: bounds.minZ + dz, maxZ: bounds.maxZ + dz };
}
function moveOne(arena: ArenaDefinition, id: string, dx: number, dz: number): void {
  const wall = arena.walls.find(item => item.id === id);
  if (wall) { wall.position = { x: wall.position.x + dx, z: wall.position.z + dz }; return; }
  const depot = arena.depots.find(item => item.id === id);
  if (depot) { depot.position = { x: depot.position.x + dx, z: depot.position.z + dz }; return; }
  const region = arena.powerupSpawnAreas.find(item => item.id === id);
  if (region) { region.bounds = shiftBounds(region.bounds, dx, dz); return; }
  if (id === 'flag:red') arena.flagPositions.red = { x: arena.flagPositions.red.x + dx, z: arena.flagPositions.red.z + dz };
  if (id === 'flag:blue') arena.flagPositions.blue = { x: arena.flagPositions.blue.x + dx, z: arena.flagPositions.blue.z + dz };
}
function checked(arena: ArenaDefinition, selection: EditorSelection): EditResult | null {
  const valid = validateArenaDefinition(arena);
  return valid ? { arena: valid, selection: new Set(selection) } : null;
}

export function translateSelection(arena: ArenaDefinition, selection: EditorSelection, dx: number, dz: number): EditResult | null {
  if (!selection.size || (!dx && !dz)) return null;
  const candidate = cloneArena(arena);
  for (const id of selection) moveOne(candidate, id, dx, dz);
  return checked(candidate, selection);
}

export function rotateSelection(arena: ArenaDefinition, selection: EditorSelection, direction: -1 | 1): EditResult | null {
  const candidate = cloneArena(arena);
  let changed = false;
  for (const wall of candidate.walls) if (selection.has(wall.id)) {
    wall.rotation = ((wall.rotation + direction * Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    changed = true;
  }
  return changed ? checked(candidate, selection) : null;
}

export function deleteSelection(arena: ArenaDefinition, selection: EditorSelection): EditResult | null {
  const candidate = cloneArena(arena);
  candidate.walls = candidate.walls.filter(item => !selection.has(item.id));
  candidate.depots = candidate.depots.filter(item => !selection.has(item.id));
  candidate.powerupSpawnAreas = candidate.powerupSpawnAreas.filter(item => !selection.has(item.id));
  if (candidate.walls.length === arena.walls.length && candidate.depots.length === arena.depots.length &&
    candidate.powerupSpawnAreas.length === arena.powerupSpawnAreas.length) return null;
  return checked(candidate, new Set());
}

function copySelected(arena: ArenaDefinition, selection: EditorSelection, mirror = false): EditResult | null {
  const ids = [...selection].filter(id => !id.startsWith('flag:'));
  if (!ids.length) return null;
  const centers = ids.map(id => entityCenter(arena, id)!).filter(Boolean);
  const offsetX = snap(Math.max(...centers.map(point => point.x)) - Math.min(...centers.map(point => point.x)) + 3);
  const centerX = (arena.bounds.minX + arena.bounds.maxX) / 2;
  const candidate = cloneArena(arena);
  const copies = new Set<string>();
  for (const id of ids) {
    const wall = arena.walls.find(item => item.id === id);
    if (wall) {
      const copy = structuredClone(wall);
      copy.id = nextArenaObjectId(candidate, 'wall');
      copy.position.x = mirror ? 2 * centerX - copy.position.x : copy.position.x + offsetX;
      if (mirror) copy.rotation = ((Math.PI - copy.rotation) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      candidate.walls.push(copy); copies.add(copy.id); continue;
    }
    const depot = arena.depots.find(item => item.id === id);
    if (depot) {
      const copy = structuredClone(depot);
      copy.id = nextArenaObjectId(candidate, 'depot');
      copy.position.x = mirror ? 2 * centerX - copy.position.x : copy.position.x + offsetX;
      candidate.depots.push(copy); copies.add(copy.id); continue;
    }
    const region = arena.powerupSpawnAreas.find(item => item.id === id);
    if (region) {
      const copy = structuredClone(region);
      copy.id = nextArenaObjectId(candidate, 'power-region');
      copy.bounds = mirror
        ? { ...copy.bounds, minX: 2 * centerX - region.bounds.maxX, maxX: 2 * centerX - region.bounds.minX }
        : shiftBounds(copy.bounds, offsetX, 0);
      candidate.powerupSpawnAreas.push(copy); copies.add(copy.id);
    }
  }
  return checked(candidate, copies);
}
export function duplicateSelection(arena: ArenaDefinition, selection: EditorSelection): EditResult | null {
  return copySelected(arena, selection);
}
export function mirrorSelection(arena: ArenaDefinition, selection: EditorSelection): EditResult | null {
  return copySelected(arena, selection, true);
}

export function alignSelection(arena: ArenaDefinition, selection: EditorSelection, axis: 'x' | 'z'): EditResult | null {
  if (selection.size < 2) return null;
  const candidate = cloneArena(arena);
  const anchor = entityCenter(candidate, selection.values().next().value as string);
  if (!anchor) return null;
  for (const id of selection) {
    if (id.startsWith('flag:')) continue;
    const center = entityCenter(candidate, id);
    if (center) moveOne(candidate, id, axis === 'x' ? anchor.x - center.x : 0, axis === 'z' ? anchor.z - center.z : 0);
  }
  return checked(candidate, selection);
}

export function distributeSelection(arena: ArenaDefinition, selection: EditorSelection, axis: 'x' | 'z'): EditResult | null {
  const sorted = [...selection].filter(id => !id.startsWith('flag:'))
    .map(id => ({ id, center: entityCenter(arena, id)! })).filter(item => item.center)
    .sort((a, b) => a.center[axis] - b.center[axis]);
  if (sorted.length < 3) return null;
  const candidate = cloneArena(arena);
  const start = sorted[0].center[axis], end = sorted.at(-1)!.center[axis];
  sorted.forEach((item, index) => {
    const target = snap(start + (end - start) * index / (sorted.length - 1));
    moveOne(candidate, item.id, axis === 'x' ? target - item.center.x : 0,
      axis === 'z' ? target - item.center.z : 0);
  });
  return checked(candidate, selection);
}

export function snapshot(arena: ArenaDefinition, selection: EditorSelection): EditorSnapshot {
  return { arena: cloneArena(arena), selection: new Set(selection) };
}
export class EditorHistory {
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  clear(): void { this.past = []; this.future = []; }
  record(before: EditorSnapshot, after: EditorSnapshot): void {
    if (JSON.stringify(before.arena) === JSON.stringify(after.arena)) return;
    this.past.push(before);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  undo(current: EditorSnapshot): EditorSnapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    return snapshot(previous.arena, previous.selection);
  }
  redo(current: EditorSnapshot): EditorSnapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return snapshot(next.arena, next.selection);
  }
}
