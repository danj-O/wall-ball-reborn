import type { Team, Vec2 } from '../game/arena.ts';
import type { DeployableId } from '../game/deployables.ts';
import {
  defaultControlLayout, movementZoneRect, normalizeControlLayout,
  type AbilitySlot, type ControlId, type ControlLayout,
} from './controlLayout.ts';

export type ActionSlot = {
  id: DeployableId;
  label: string;
  icon: string;
  size: 'primary' | 'secondary';
  layoutSlot?: AbilitySlot;
};

// Both players drag in the direction they want to move on the shared screen.
// Blue's "forward" is screen-left, toward the red side of the arena.
export const PLAYER_ORIENTATION: Record<Team, number> = { red: 0, blue: 0 };
// Rotate the artwork so it reads upright from the left and right tablet edges.
export const CONTROL_VISUAL_ROTATION: Record<Team, number> = { red: 90, blue: -90 };

function rotateVector(dx: number, dy: number, degrees: number): { x: number; y: number } {
  const angle = degrees * Math.PI / 180;
  return { x: dx * Math.cos(angle) - dy * Math.sin(angle), y: dx * Math.sin(angle) + dy * Math.cos(angle) };
}

export function orientScreenVector(team: Team, dx: number, dy: number): { x: number; y: number } {
  return rotateVector(dx, dy, PLAYER_ORIENTATION[team]);
}
export function orientPadVector(team: Team, dx: number, dy: number): { x: number; y: number } {
  return rotateVector(dx, dy, -CONTROL_VISUAL_ROTATION[team]);
}

export class PointerRegistry<T> {
  private readonly sessions = new Map<number, T>();
  claim(pointerId: number, value: T): boolean {
    if (this.sessions.has(pointerId)) return false;
    this.sessions.set(pointerId, value);
    return true;
  }
  get(pointerId: number): T | undefined { return this.sessions.get(pointerId); }
  release(pointerId: number): T | undefined {
    const value = this.sessions.get(pointerId);
    this.sessions.delete(pointerId);
    return value;
  }
  values(): IterableIterator<T> { return this.sessions.values(); }
  get size(): number { return this.sessions.size; }
}

type Callbacks = {
  toWorld(dx: number, dy: number): Vec2;
  onMove(team: Team, input: Vec2): void;
  onAimStart(team: Team, id: DeployableId): void;
  onAim(team: Team, id: DeployableId, direction: Vec2, strength: number): void;
  onAimRelease(team: Team, id: DeployableId): void;
  onAimCancel(team: Team, id: DeployableId): void;
};
type Session = {
  pointerId: number; pad: HTMLElement; captureTarget: HTMLElement; knob: HTMLElement; team: Team;
  kind: 'move' | 'action'; itemId?: DeployableId; origin: { x: number; y: number };
};
type EditSession = { pointerId: number; pad: HTMLElement; id: ControlId; offset: { x: number; y: number } };

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly callbacks: Callbacks;
  private readonly onLayoutChange: (layout: ControlLayout) => void;
  private readonly onSelectionChange: (id: ControlId) => void;
  private readonly pointers = new PointerRegistry<Session>();
  private readonly occupiedPads = new Set<HTMLElement>();
  private layout: ControlLayout;
  private usingDefaultLayout: boolean;
  private customizing = false;
  private editSession: EditSession | null = null;
  private selectedControl: ControlId = 'red-move';

  private dimensions(): { width: number; height: number } {
    const surface = this.root.parentElement ?? this.root;
    return { width: Math.max(1, surface.clientWidth), height: Math.max(1, surface.clientHeight) };
  }

  private visiblePosition(point: { x: number; y: number }, size: number, width: number, height: number): { x: number; y: number } {
    const style = getComputedStyle(this.root);
    const half = size / 2 + 4;
    const minX = Math.min(0.5, ((parseFloat(style.paddingLeft) || 0) + half) / width);
    const maxX = Math.max(0.5, 1 - ((parseFloat(style.paddingRight) || 0) + half) / width);
    const minY = Math.min(0.5, ((parseFloat(style.paddingTop) || 0) + half) / height);
    const maxY = Math.max(0.5, 1 - ((parseFloat(style.paddingBottom) || 0) + half) / height);
    return { x: Math.max(minX, Math.min(maxX, point.x)), y: Math.max(minY, Math.min(maxY, point.y)) };
  }

  constructor(root: HTMLElement, callbacks: Callbacks, layout?: ControlLayout,
    onLayoutChange: (layout: ControlLayout) => void = () => {}, onSelectionChange: (id: ControlId) => void = () => {}) {
    this.root = root;
    this.callbacks = callbacks;
    this.onLayoutChange = onLayoutChange;
    this.onSelectionChange = onSelectionChange;
    root.replaceChildren();
    const { width, height } = this.dimensions();
    this.usingDefaultLayout = !layout;
    this.layout = layout ?? defaultControlLayout(width, height);
    this.makeMoveZone('red');
    this.makeMoveZone('blue');
    this.makePad('red', 'move', undefined, 'Move', 'move');
    this.makePad('blue', 'move', undefined, 'Move', 'move');
    this.applyLayout();
  }

  getLayout(): ControlLayout { return structuredClone(this.layout); }
  getSelectedControl(): ControlId { return this.selectedControl; }

  setLayout(layout: ControlLayout): void {
    this.cancelAll();
    this.usingDefaultLayout = false;
    const { width, height } = this.dimensions();
    this.layout = normalizeControlLayout(layout, width, height);
    this.applyLayout();
  }

  resetLayout(): void {
    const { width, height } = this.dimensions();
    this.setLayout(defaultControlLayout(width, height));
    this.usingDefaultLayout = true;
    this.onLayoutChange(this.getLayout());
  }

  refreshBounds(): void {
    const { width, height } = this.dimensions();
    if (this.usingDefaultLayout) this.layout = defaultControlLayout(width, height);
    this.applyLayout();
  }

  setCustomizeMode(enabled: boolean): void {
    this.cancelAll();
    this.customizing = enabled;
    this.root.classList.toggle('customizing', enabled);
    if (enabled) this.selectControl(this.selectedControl);
    if (!enabled && this.editSession) this.finishEdit(this.editSession.pointerId);
  }

  setActionSlots(team: Team, slots: readonly ActionSlot[]): void {
    const visible = slots.slice(0, 4); // Two permanent actions plus up to two acquired abilities.
    const wanted = new Set(visible.map(slot => slot.id));
    const existing = [...this.root.querySelectorAll<HTMLElement>(`.action-pad[data-team="${team}"]`)];
    for (const pad of existing) {
      if (wanted.has(pad.dataset.item as DeployableId)) continue;
      for (const session of [...this.pointers.values()]) if (session.pad === pad) this.end(session.pointerId, true);
      pad.remove();
    }
    for (const slot of visible) {
      if (!this.root.querySelector(`.action-pad[data-team="${team}"][data-item="${slot.id}"]`)) {
        this.makePad(team, 'action', slot.id, slot.label, slot.icon, slot.layoutSlot);
      }
    }
    if (this.customizing) this.selectControl(this.selectedControl);
    this.applyLayout();
  }

  setInventory(team: Team, inventory: Partial<Record<DeployableId, number>>): void {
    for (const pad of this.root.querySelectorAll<HTMLElement>(`.action-pad[data-team="${team}"]`)) {
      const id = pad.dataset.item as DeployableId;
      const count = inventory[id] ?? 0;
      pad.querySelector<HTMLElement>('.touch-count')!.textContent = String(count);
      pad.classList.toggle('unavailable', count <= 0);
      pad.setAttribute('aria-disabled', String(count <= 0));
    }
  }

  cancelAll(): void {
    for (const session of [...this.pointers.values()]) this.end(session.pointerId, true);
  }

  private controlId(team: Team, kind: 'move' | 'action', itemId?: DeployableId, layoutSlot?: AbilitySlot): ControlId {
    return `${team}-${kind === 'move' ? 'move' : layoutSlot ?? itemId}` as ControlId;
  }

  private selectControl(id: ControlId): void {
    this.selectedControl = id;
    for (const pad of this.root.querySelectorAll<HTMLElement>('.touch-pad')) {
      pad.classList.toggle('selected-control', pad.dataset.controlId === id);
    }
    for (const zone of this.root.querySelectorAll<HTMLElement>('.move-zone')) {
      zone.classList.toggle('selected-control', zone.dataset.controlId === id);
    }
    this.onSelectionChange(id);
  }

  private makeMoveZone(team: Team): void {
    const zone = document.createElement('div');
    zone.className = 'move-zone';
    zone.dataset.controlId = `${team}-move`;
    zone.dataset.team = team;
    zone.setAttribute('aria-label', `${team} movement touch area`);
    this.root.appendChild(zone);
    this.bindPointerTarget(zone, () => this.root.querySelector<HTMLElement>(`.move-pad[data-team="${team}"]`));
  }

  private makePad(team: Team, kind: 'move' | 'action', itemId: DeployableId | undefined, label: string, icon: string, layoutSlot?: AbilitySlot): HTMLElement {
    const pad = document.createElement('div');
    pad.className = `touch-pad ${kind === 'action' ? 'action-pad' : 'move-pad'}`;
    pad.dataset.team = team;
    pad.dataset.kind = kind;
    pad.dataset.controlId = this.controlId(team, kind, itemId, layoutSlot);
    if (itemId) pad.dataset.item = itemId;
    pad.style.setProperty('--visual-rotation', `${CONTROL_VISUAL_ROTATION[team]}deg`);
    pad.setAttribute('role', 'button');
    pad.setAttribute('aria-label', `${team} ${label.toLowerCase()} joystick`);
    const symbol = document.createElement('span');
    symbol.className = `touch-icon icon-${icon}`;
    symbol.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'touch-label';
    name.textContent = label;
    const knob = document.createElement('span');
    knob.className = 'touch-knob';
    const floatArea = document.createElement('span');
    floatArea.className = 'float-area';
    pad.append(symbol, name, knob, floatArea);
    if (kind === 'action') {
      const count = document.createElement('span');
      count.className = 'touch-count';
      count.textContent = '0';
      pad.appendChild(count);
    }
    this.root.appendChild(pad);
    this.bindPointerTarget(pad, () => pad);
    return pad;
  }

  private applyLayout(): void {
    const { width, height } = this.dimensions();
    for (const pad of this.root.querySelectorAll<HTMLElement>('.touch-pad')) {
      const id = pad.dataset.controlId as ControlId;
      const size = this.layout.sizes[id];
      const position = this.layout.positions[id] && this.visiblePosition(this.layout.positions[id], size, width, height);
      if (!position) continue;
      pad.style.setProperty('--control-size', `${size}px`);
      pad.style.setProperty('--float-diameter', `${this.layout.floatRadii[id] * 2}px`);
      if (pad.classList.contains('active') && pad.dataset.kind === 'move') continue;
      pad.style.left = `${position.x * 100}%`;
      pad.style.top = `${position.y * 100}%`;
    }
    for (const zone of this.root.querySelectorAll<HTMLElement>('.move-zone')) {
      const id = zone.dataset.controlId as ControlId;
      const center = this.visiblePosition(this.layout.positions[id], this.layout.sizes[id], width, height);
      const rect = movementZoneRect(center, this.layout.sizes[id], this.layout.floatRadii[id], width, height);
      zone.style.left = `${rect.left}px`;
      zone.style.top = `${rect.top}px`;
      zone.style.width = `${rect.side}px`;
      zone.style.height = `${rect.side}px`;
    }
  }

  private beginEdit(pad: HTMLElement, event: PointerEvent): void {
    if (this.editSession) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = this.root.getBoundingClientRect();
    const id = pad.dataset.controlId as ControlId;
    this.selectControl(id);
    const center = this.visiblePosition(this.layout.positions[id], this.layout.sizes[id], rect.width, rect.height);
    this.editSession = {
      pointerId: event.pointerId, pad, id,
      offset: { x: center.x * rect.width - (event.clientX - rect.left), y: center.y * rect.height - (event.clientY - rect.top) },
    };
    pad.setPointerCapture(event.pointerId);
    pad.classList.add('being-moved');
  }

  private moveEdit(event: PointerEvent): void {
    const session = this.editSession;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rect = this.root.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left + session.offset.x) / rect.width,
      y: (event.clientY - rect.top + session.offset.y) / rect.height,
    };
    this.layout.positions[session.id] = this.visiblePosition(point, this.layout.sizes[session.id], rect.width, rect.height);
    this.usingDefaultLayout = false;
    this.applyLayout();
  }

  private finishEdit(pointerId: number): void {
    const session = this.editSession;
    if (!session || session.pointerId !== pointerId) return;
    this.editSession = null;
    session.pad.classList.remove('being-moved');
    if (session.pad.hasPointerCapture(pointerId)) session.pad.releasePointerCapture(pointerId);
    this.onLayoutChange(this.getLayout());
  }

  private bindPointerTarget(target: HTMLElement, resolvePad: () => HTMLElement | null): void {
    target.addEventListener('pointerdown', event => {
      const pad = resolvePad();
      if (!pad) return;
      if (this.customizing) { if (target === pad) this.beginEdit(pad, event); return; }
      if (this.occupiedPads.has(pad) || pad.classList.contains('unavailable')) return;
      event.stopPropagation();
      const team = pad.dataset.team as Team;
      const kind = pad.dataset.kind as 'move' | 'action';
      const itemId = pad.dataset.item as DeployableId | undefined;
      const session: Session = {
        pointerId: event.pointerId, pad, captureTarget: target, knob: pad.querySelector<HTMLElement>('.touch-knob')!,
        team, kind, itemId, origin: { x: event.clientX, y: event.clientY },
      };
      if (!this.pointers.claim(event.pointerId, session)) return;
      event.preventDefault();
      this.occupiedPads.add(pad);
      try { target.setPointerCapture(event.pointerId); }
      catch { this.end(event.pointerId, true); return; }
      pad.classList.add('active');
      if (kind === 'move') {
        const bounds = this.root.getBoundingClientRect();
        pad.style.left = `${event.clientX - bounds.left}px`;
        pad.style.top = `${event.clientY - bounds.top}px`;
        session.knob.style.left = '50%';
        session.knob.style.top = '50%';
      } else {
        const rect = pad.getBoundingClientRect();
        const local = orientPadVector(team, event.clientX - rect.left - rect.width / 2,
          event.clientY - rect.top - rect.height / 2);
        session.knob.style.left = `${rect.width / 2 + local.x}px`;
        session.knob.style.top = `${rect.height / 2 + local.y}px`;
      }
      session.knob.style.transform = '';
      if (kind === 'action') this.callbacks.onAimStart(team, itemId!);
      this.update(session, event);
    });
    target.addEventListener('pointermove', event => {
      if (this.editSession?.pointerId === event.pointerId) { this.moveEdit(event); return; }
      const session = this.pointers.get(event.pointerId);
      if (session?.captureTarget === target) { event.preventDefault(); this.update(session, event); }
    });
    target.addEventListener('pointerup', event => {
      if (this.editSession?.pointerId === event.pointerId) { this.moveEdit(event); this.finishEdit(event.pointerId); return; }
      const session = this.pointers.get(event.pointerId);
      if (session?.captureTarget !== target) return;
      event.preventDefault();
      this.update(session, event);
      this.end(event.pointerId, false);
    });
    target.addEventListener('pointercancel', event => {
      if (this.editSession?.pointerId === event.pointerId) this.finishEdit(event.pointerId);
      else this.end(event.pointerId, true);
    });
    target.addEventListener('lostpointercapture', event => {
      if (this.editSession?.pointerId === event.pointerId) this.finishEdit(event.pointerId);
      else this.end(event.pointerId, true);
    });
  }

  private update(session: Session, event: PointerEvent): void {
    const dx = event.clientX - session.origin.x;
    const dy = event.clientY - session.origin.y;
    const length = Math.hypot(dx, dy);
    const radius = this.layout.floatRadii[session.pad.dataset.controlId as ControlId];
    const clamped = Math.min(radius, length);
    const visual = orientPadVector(session.team, dx, dy);
    session.knob.style.transform = `translate(${visual.x / (length || 1) * clamped}px, ${visual.y / (length || 1) * clamped}px)`;
    const input = orientScreenVector(session.team, dx, dy);
    const direction = this.callbacks.toWorld(input.x, input.y);
    const strength = Math.min(1, length / radius);
    if (session.kind === 'move') this.callbacks.onMove(session.team, { x: direction.x * strength, z: direction.z * strength });
    else this.callbacks.onAim(session.team, session.itemId!, direction, strength);
  }

  private end(pointerId: number, cancelled: boolean): void {
    const session = this.pointers.release(pointerId);
    if (!session) return;
    this.occupiedPads.delete(session.pad);
    if (session.captureTarget.hasPointerCapture(pointerId)) session.captureTarget.releasePointerCapture(pointerId);
    session.pad.classList.remove('active');
    session.knob.style.left = '50%';
    session.knob.style.top = '50%';
    session.knob.style.transform = '';
    if (session.kind === 'move') this.applyLayout();
    if (session.kind === 'move') this.callbacks.onMove(session.team, { x: 0, z: 0 });
    else if (cancelled) this.callbacks.onAimCancel(session.team, session.itemId!);
    else this.callbacks.onAimRelease(session.team, session.itemId!);
  }
}
