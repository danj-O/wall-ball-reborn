import './controller.css';
import { DoubleTapZoomGuard } from '../input/DoubleTapZoomGuard.ts';
import { RoomControllerLink, normalizeRoomCode, relayUrl } from './RoomControllerLink.ts';
import type { RemoteAction, StateMessage } from './protocol.ts';
import { defaultPhoneLayout, PHONE_ACTIONS, validatePhoneLayout, type PhoneControlLayout } from './phoneLayout.ts';

document.title = 'Wall Ball — Phone Controller';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<main id="controller">
  <div class="controller-head"><button id="connection-button" type="button">CONNECTION</button><button id="customize-button" type="button" hidden>CUSTOMIZE</button><strong id="team-badge">PHONE</strong><span id="connection-short">NEW</span><span id="inventory">W 0 · B 0</span></div>
  <div class="portrait-note">Rotate for landscape controls</div>
  <div class="controller-surface">
    <div id="move-zone" class="move-zone"><div id="move-pad" class="move-pad"><i class="knob"></i></div><span>MOVE · TOUCH ANYWHERE</span></div>
    <div class="action-zone">
      <div class="action-pad" data-action="wall" role="button" aria-label="Wall joystick">WALL<i class="knob"></i><span class="count">0</span></div>
      <div class="action-pad" data-action="bomb" role="button" aria-label="Bomb joystick">BOMB<i class="knob"></i><span class="count">0</span></div>
      <div id="mega-pad" class="action-pad" data-action="mega-bomb" role="button" aria-label="Mega Bomb joystick" hidden>MEGA<i class="knob"></i><span class="count">0</span></div>
    </div>
  </div>
  <div id="connect-panel" class="connect-panel"><section class="connect-card">
    <h1>Wall Ball Phone Controller</h1><p>On the host, create one room. Enter its code here, choose Red or Blue, and wait for the host to accept your seat. The game stays on the host.</p>
    <label for="room-input">8-character room code</label><input id="room-input" maxlength="8" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD2345" />
    <label for="seat-select">Play as</label><select id="seat-select"><option value="red">Red</option><option value="blue">Blue</option></select>
    <div class="connect-actions"><button id="join-button" type="button">Join Room</button><button id="disconnect-button" type="button">Disconnect</button><button id="close-panel" type="button">Hide</button><button id="customize-from-connect" type="button" hidden>Customize Controls</button></div>
    <strong id="connection-state">NEW</strong><p id="phone-diagnostics"></p>
  </section></div>
  <div id="customize-panel" class="phone-customize-panel" hidden><strong>CUSTOMIZE PHONE CONTROLS</strong><p>Drag a control or use the sliders. Tap HIDE OPTIONS to reach pads behind this panel.</p>
    <label for="customize-target">Control</label><select id="customize-target"><option value="move">Movement</option><option value="wall">Wall</option><option value="bomb">Bomb</option><option value="mega-bomb">Mega Bomb</option></select>
    <label for="customize-x">Across <output id="customize-x-value"></output></label><input id="customize-x" type="range" step="1" />
    <label for="customize-y">Down <output id="customize-y-value"></output></label><input id="customize-y" type="range" step="1" />
    <label for="customize-size">Size <output id="customize-size-value"></output></label><input id="customize-size" type="range" />
    <div id="move-dimensions"><label for="customize-width">Move area width <output id="customize-width-value"></output></label><input id="customize-width" type="range" min="25" max="48" step="1" /><label for="customize-height">Move area height <output id="customize-height-value"></output></label><input id="customize-height" type="range" min="35" max="88" step="1" /></div>
    <div class="connect-actions"><button id="reset-phone-controls" type="button">Reset</button><button id="done-phone-controls" type="button">Done</button><button id="save-phone-default" type="button">Dev Save Default</button></div>
    <p id="phone-control-save-status" role="status"></p>
  </div>
</main>`;

const panel = document.querySelector<HTMLElement>('#connect-panel')!;
const state = document.querySelector<HTMLElement>('#connection-state')!;
if (!relayUrl()) {
  state.textContent = 'Remote relay unavailable in this build';
  document.querySelector<HTMLButtonElement>('#join-button')!.disabled = true;
}
const short = document.querySelector<HTMLElement>('#connection-short')!;
const inventory = document.querySelector<HTMLElement>('#inventory')!;
const teamBadge = document.querySelector<HTMLElement>('#team-badge')!;
const moveZone = document.querySelector<HTMLElement>('#move-zone')!;
const movePad = document.querySelector<HTMLElement>('#move-pad')!;
const moveKnob = movePad.querySelector<HTMLElement>('.knob')!;
const surface = document.querySelector<HTMLElement>('.controller-surface')!;
const controllerRoot = document.querySelector<HTMLElement>('#controller')!;
const customizePanel = document.querySelector<HTMLElement>('#customize-panel')!;
const layoutStorageKey = 'wall-ball-phone-control-layout-v1';
function loadPhoneLayout(): PhoneControlLayout {
  if (import.meta.env.DEV) {
    try {
      const saved = localStorage.getItem(layoutStorageKey);
      const parsed = saved && validatePhoneLayout(JSON.parse(saved));
      if (parsed) return parsed;
    } catch { /* A malformed local draft falls back to the bundled default. */ }
  }
  return defaultPhoneLayout();
}
let phoneLayout = loadPhoneLayout();
let customizing = false;
let selectedEdit: 'move' | RemoteAction = 'move';
type EditSession = { pointerId: number; target: HTMLElement; selected: 'move' | RemoteAction;
  startX: number; startY: number; originX: number; originY: number };
let editSession: EditSession | null = null;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
function constrainMove(): void {
  const move = phoneLayout.move;
  move.x = clamp(move.x, Math.max(.13, .01 + move.width / 2), Math.min(.36, .49 - move.width / 2));
  move.y = clamp(move.y, Math.max(.25, .08 + move.height / 2), Math.min(.75, .96 - move.height / 2));
}
function applyPhoneLayout(): void {
  const move = phoneLayout.move;
  const visualScale = Math.min(1, Math.max(1, surface.clientWidth) / 700);
  moveZone.style.left = `${(move.x - move.width / 2) * 100}%`;
  moveZone.style.top = `${(move.y - move.height / 2) * 100}%`;
  moveZone.style.width = `${move.width * 100}%`;
  moveZone.style.height = `${move.height * 100}%`;
  movePad.style.width = `${move.padSize * visualScale}px`;
  movePad.style.height = `${move.padSize * visualScale}px`;
  if (!movePad.classList.contains('active')) { movePad.style.left = '50%'; movePad.style.top = '50%'; }
  for (const id of PHONE_ACTIONS) {
    const pad = document.querySelector<HTMLElement>(`[data-action="${id}"]`)!;
    const control = phoneLayout.actions[id];
    pad.style.left = `${control.x * 100}%`;
    pad.style.top = `${control.y * 100}%`;
    pad.style.width = `${control.size * visualScale}px`;
    pad.style.height = `${control.size * visualScale}px`;
  }
}
function persistPhoneLayout(): void {
  if (import.meta.env.DEV) localStorage.setItem(layoutStorageKey, JSON.stringify(phoneLayout));
}
function showEditTarget(): void {
  document.querySelector<HTMLSelectElement>('#customize-target')!.value = selectedEdit;
  moveZone.classList.toggle('selected', selectedEdit === 'move');
  for (const id of PHONE_ACTIONS) document.querySelector<HTMLElement>(`[data-action="${id}"]`)!.classList.toggle('selected', selectedEdit === id);
  const selected = selectedEdit === 'move' ? phoneLayout.move : phoneLayout.actions[selectedEdit];
  const x = document.querySelector<HTMLInputElement>('#customize-x')!;
  const y = document.querySelector<HTMLInputElement>('#customize-y')!;
  x.min = String(Math.round((selectedEdit === 'move' ? Math.max(.13, .01 + phoneLayout.move.width / 2) : .54) * 100));
  x.max = String(Math.round((selectedEdit === 'move' ? Math.min(.36, .49 - phoneLayout.move.width / 2) : .96) * 100));
  y.min = String(Math.round((selectedEdit === 'move' ? Math.max(.25, .08 + phoneLayout.move.height / 2) : .2) * 100));
  y.max = String(Math.round((selectedEdit === 'move' ? Math.min(.75, .96 - phoneLayout.move.height / 2) : .8) * 100));
  x.value = String(Math.round(selected.x * 100));
  y.value = String(Math.round(selected.y * 100));
  document.querySelector<HTMLOutputElement>('#customize-x-value')!.value = `${x.value}%`;
  document.querySelector<HTMLOutputElement>('#customize-y-value')!.value = `${y.value}%`;
  const size = document.querySelector<HTMLInputElement>('#customize-size')!;
  size.min = selectedEdit === 'move' ? '80' : '54';
  size.max = selectedEdit === 'move' ? '200' : '180';
  size.value = String(selectedEdit === 'move' ? phoneLayout.move.padSize : phoneLayout.actions[selectedEdit].size);
  document.querySelector<HTMLOutputElement>('#customize-size-value')!.value = `${size.value}px`;
  document.querySelector<HTMLElement>('#move-dimensions')!.hidden = selectedEdit !== 'move';
  const width = document.querySelector<HTMLInputElement>('#customize-width')!;
  const height = document.querySelector<HTMLInputElement>('#customize-height')!;
  width.value = String(Math.round(phoneLayout.move.width * 100));
  height.value = String(Math.round(phoneLayout.move.height * 100));
  document.querySelector<HTMLOutputElement>('#customize-width-value')!.value = `${width.value}%`;
  document.querySelector<HTMLOutputElement>('#customize-height-value')!.value = `${height.value}%`;
}
function beginEdit(target: HTMLElement, selected: 'move' | RemoteAction, event: PointerEvent): void {
  if (editSession) return;
  event.preventDefault();
  selectedEdit = selected;
  showEditTarget();
  const origin = selected === 'move' ? phoneLayout.move : phoneLayout.actions[selected];
  editSession = { pointerId: event.pointerId, target, selected, startX: event.clientX, startY: event.clientY,
    originX: origin.x, originY: origin.y };
  target.setPointerCapture(event.pointerId);
}
function moveEdit(event: PointerEvent): void {
  const session = editSession;
  if (!session || event.pointerId !== session.pointerId) return;
  event.preventDefault();
  const x = session.originX + (event.clientX - session.startX) / Math.max(1, surface.clientWidth);
  const y = session.originY + (event.clientY - session.startY) / Math.max(1, surface.clientHeight);
  if (session.selected === 'move') { phoneLayout.move.x = x; phoneLayout.move.y = y; constrainMove(); }
  else {
    phoneLayout.actions[session.selected].x = clamp(x, .54, .96);
    phoneLayout.actions[session.selected].y = clamp(y, .2, .8);
  }
  applyPhoneLayout();
  showEditTarget();
}
function endEdit(pointerId: number): void {
  if (editSession?.pointerId !== pointerId) return;
  const session = editSession;
  editSession = null;
  if (session.target.hasPointerCapture(pointerId)) session.target.releasePointerCapture(pointerId);
  persistPhoneLayout();
}
function openCustomizer(): void {
  cancelPointers();
  panel.hidden = true;
  customizing = true;
  controllerRoot.classList.add('customizing');
  customizePanel.hidden = false;
  document.querySelector<HTMLButtonElement>('#customize-button')!.textContent = 'HIDE OPTIONS';
  showEditTarget();
  updateMegaVisibility();
  applyPhoneLayout();
}
function closeCustomizer(): void {
  if (editSession) endEdit(editSession.pointerId);
  customizing = false;
  controllerRoot.classList.remove('customizing');
  customizePanel.hidden = true;
  document.querySelector<HTMLButtonElement>('#customize-button')!.textContent = 'CUSTOMIZE';
  if (!link.isConnected) panel.hidden = false;
  updateMegaVisibility();
}
applyPhoneLayout();
window.addEventListener('resize', applyPhoneLayout);
if (import.meta.env.DEV) {
  const customizeButton = document.querySelector<HTMLButtonElement>('#customize-button')!;
  customizeButton.hidden = false;
  customizeButton.addEventListener('click', () => {
    if (!customizing) openCustomizer();
    else {
      customizePanel.hidden = !customizePanel.hidden;
      customizeButton.textContent = customizePanel.hidden ? 'OPTIONS' : 'HIDE OPTIONS';
    }
  });
  const fromConnect = document.querySelector<HTMLButtonElement>('#customize-from-connect')!;
  fromConnect.hidden = false;
  fromConnect.addEventListener('click', openCustomizer);
  document.querySelector<HTMLButtonElement>('#done-phone-controls')!.onclick = closeCustomizer;
  document.querySelector<HTMLSelectElement>('#customize-target')!.onchange = event => {
    selectedEdit = (event.target as HTMLSelectElement).value as 'move' | RemoteAction;
    showEditTarget();
  };
  for (const [id, axis] of [['customize-x', 'x'], ['customize-y', 'y']] as const) {
    document.querySelector<HTMLInputElement>(`#${id}`)!.oninput = event => {
      const selected = selectedEdit === 'move' ? phoneLayout.move : phoneLayout.actions[selectedEdit];
      selected[axis] = Number((event.target as HTMLInputElement).value) / 100;
      if (selectedEdit === 'move') constrainMove();
      applyPhoneLayout(); showEditTarget(); persistPhoneLayout();
    };
  }
  document.querySelector<HTMLInputElement>('#customize-size')!.oninput = event => {
    const size = Number((event.target as HTMLInputElement).value);
    if (selectedEdit === 'move') phoneLayout.move.padSize = size;
    else phoneLayout.actions[selectedEdit].size = size;
    applyPhoneLayout(); showEditTarget(); persistPhoneLayout();
  };
  for (const [id, dimension] of [['customize-width', 'width'], ['customize-height', 'height']] as const) {
    document.querySelector<HTMLInputElement>(`#${id}`)!.oninput = event => {
      phoneLayout.move[dimension] = Number((event.target as HTMLInputElement).value) / 100;
      constrainMove(); applyPhoneLayout(); showEditTarget(); persistPhoneLayout();
    };
  }
  document.querySelector<HTMLButtonElement>('#reset-phone-controls')!.onclick = () => {
    phoneLayout = defaultPhoneLayout();
    applyPhoneLayout(); showEditTarget(); persistPhoneLayout();
  };
  document.querySelector<HTMLButtonElement>('#save-phone-default')!.onclick = async () => {
    if (!window.confirm('Save this phone layout as the code default for all phones? This writes src/remote/phoneControlDefaults.json.')) return;
    const button = document.querySelector<HTMLButtonElement>('#save-phone-default')!;
    const status = document.querySelector<HTMLElement>('#phone-control-save-status')!;
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      const response = await fetch('/__dev/phone-control-defaults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(phoneLayout),
      });
      if (response.status === 404) throw new Error('Save route unavailable. Restart npm run dev and reload.');
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      status.textContent = 'Saved as the code default. Commit and deploy the JSON file to share it with all phones.';
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Could not save'; }
    finally { button.disabled = false; }
  };
}

let stateSeq = 0;
let eventSeq = 0;
let lastStateSent = 0;
let flushTimer: number | null = null;
let pending = new Map<string, StateMessage>();
let sentWindow = 0;
let sentInWindow = 0;
let sendRate = 0;
let desiredMegaVisible = false;
const link = new RoomControllerLink('phone', {
  status(value) { state.textContent = (value === 'FAILED' || value === 'DISCONNECTED') && link.failureReason
    ? `${value} · ${link.failureReason}` : value; short.textContent = value; },
  connected() { panel.hidden = true; flush(); },
  disconnected() { cancelPointers(); panel.hidden = false; inventory.textContent = 'W 0 · B 0'; },
});
link.onControllerStatus = status => {
  teamBadge.textContent = status.team.toUpperCase();
  teamBadge.classList.toggle('blue', status.team === 'blue');
  inventory.textContent = `W ${status.wall} · B ${status.bomb}${status.mega ? ` · MEGA ${status.mega}` : ''}${status.carrying ? ' · FLAG' : ''}${status.shield ? ' · SHIELD' : ''}${status.speed ? ' · SPEED' : ''}`;
  for (const id of ['wall', 'bomb', 'mega-bomb'] as const) {
    const pad = document.querySelector<HTMLElement>(`[data-action="${id}"]`)!;
    const amount = id === 'wall' ? status.wall : id === 'bomb' ? status.bomb : status.mega;
    pad.querySelector<HTMLElement>('.count')!.textContent = String(amount);
    pad.classList.toggle('unavailable', amount <= 0);
    if (id === 'mega-bomb') desiredMegaVisible = amount > 0;
  }
  updateMegaVisibility();
};
link.onFeedback = () => { if ('vibrate' in navigator) navigator.vibrate(35); };

document.querySelector<HTMLButtonElement>('#connection-button')!.onclick = () => { if (customizing) closeCustomizer(); panel.hidden = false; cancelPointers(); };
document.querySelector<HTMLButtonElement>('#close-panel')!.onclick = () => { if (link.isConnected) panel.hidden = true; };
document.querySelector<HTMLButtonElement>('#disconnect-button')!.onclick = () => link.disconnect();
const roomInput = document.querySelector<HTMLInputElement>('#room-input')!;
roomInput.addEventListener('input', () => { roomInput.value = normalizeRoomCode(roomInput.value); });
document.querySelector<HTMLButtonElement>('#join-button')!.onclick = async () => {
  try { state.textContent = 'CONNECTING'; await link.joinRoom(roomInput.value,
    document.querySelector<HTMLSelectElement>('#seat-select')!.value as 'red' | 'blue'); }
  catch (error) { state.textContent = error instanceof Error ? error.message : 'Could not join room'; }
};

type PointerSession = { id: number; target: HTMLElement; origin: { x: number; y: number }; action?: RemoteAction;
  x: number; y: number; strength: number };
const pointers = new Map<number, PointerSession>();
const occupied = new Set<HTMLElement>();
const MOVE_TRAVEL = 72;
function updateMegaVisibility(): void {
  if (customizing) { document.querySelector<HTMLElement>('#mega-pad')!.hidden = false; return; }
  if ([...pointers.values()].some(session => session.action)) return;
  document.querySelector<HTMLElement>('#mega-pad')!.hidden = !desiredMegaVisible;
}
function queue(message: StateMessage, immediate = false): void {
  pending.set(message.type === 'aim' ? message.id : 'move', message);
  const wait = 33 - (performance.now() - lastStateSent);
  if (immediate || wait <= 0) flush();
  else if (flushTimer === null) flushTimer = window.setTimeout(() => { flushTimer = null; flush(); }, wait);
}
function flush(): void {
  if (flushTimer !== null) { window.clearTimeout(flushTimer); flushTimer = null; }
  if (!link.isConnected) { pending.clear(); return; }
  for (const [key, message] of pending) if (link.sendState(message)) {
    pending.delete(key);
    sentInWindow++;
  }
  lastStateSent = performance.now();
}
function displacement(session: PointerSession, event: PointerEvent): void {
  const radius = session.action ? Math.max(42, session.target.clientWidth * 0.62) : MOVE_TRAVEL;
  const dx = event.clientX - session.origin.x;
  const dy = event.clientY - session.origin.y;
  const length = Math.hypot(dx, dy);
  session.strength = Math.min(1, length / radius);
  session.x = length ? dx / length : 0;
  session.y = length ? dy / length : 0;
  const knob = session.action ? session.target.querySelector<HTMLElement>('.knob')! : moveKnob;
  knob.style.marginLeft = `${session.x * Math.min(length, radius)}px`;
  knob.style.marginTop = `${session.y * Math.min(length, radius)}px`;
  if (session.action) queue({ v: 1, type: 'aim', id: session.action, x: session.x, y: session.y,
    strength: session.strength, seq: ++stateSeq });
  else queue({ v: 1, type: 'move', x: session.x * session.strength, y: session.y * session.strength, seq: ++stateSeq });
}
function end(pointerId: number, cancelled: boolean, event?: PointerEvent): void {
  const session = pointers.get(pointerId);
  if (!session) return;
  if (event && !cancelled) displacement(session, event);
  pointers.delete(pointerId);
  occupied.delete(session.target);
  if (session.target.hasPointerCapture(pointerId)) session.target.releasePointerCapture(pointerId);
  session.target.classList.remove('active');
  const knob = session.action ? session.target.querySelector<HTMLElement>('.knob')! : moveKnob;
  knob.style.marginLeft = ''; knob.style.marginTop = '';
  if (session.action) link.sendEvent({ v: 1, type: 'action', id: session.action,
    phase: cancelled ? 'cancel' : 'release', x: session.x, y: session.y, strength: session.strength, seq: ++eventSeq });
  else {
    movePad.classList.remove('active');
    queue({ v: 1, type: 'move', x: 0, y: 0, seq: ++stateSeq }, true);
    link.sendEvent({ v: 1, type: 'moveStop', seq: ++eventSeq, moveSeq: stateSeq });
  }
  updateMegaVisibility();
}
function cancelPointers(): void { for (const id of [...pointers.keys()]) end(id, true); }
function bind(target: HTMLElement, action?: RemoteAction): void {
  target.addEventListener('pointerdown', event => {
    if (customizing) { beginEdit(target, action ?? 'move', event); return; }
    if (!link.isConnected || occupied.has(target) || (action && target.classList.contains('unavailable'))) return;
    event.preventDefault();
    const session: PointerSession = { id: event.pointerId, target, origin: { x: event.clientX, y: event.clientY }, action,
      x: 0, y: 0, strength: 0 };
    pointers.set(event.pointerId, session);
    occupied.add(target);
    try { target.setPointerCapture(event.pointerId); }
    catch { end(event.pointerId, true); return; }
    target.classList.add('active');
    if (!action) {
      const rect = moveZone.getBoundingClientRect();
      movePad.style.left = `${event.clientX - rect.left}px`;
      movePad.style.top = `${event.clientY - rect.top}px`;
      movePad.classList.add('active');
    } else link.sendEvent({ v: 1, type: 'action', id: action, phase: 'start', x: 0, y: 0,
      strength: 0, seq: ++eventSeq });
    displacement(session, event);
  });
  target.addEventListener('pointermove', event => {
    if (customizing && editSession?.pointerId === event.pointerId) { moveEdit(event); return; }
    const session = pointers.get(event.pointerId);
    if (session?.target === target) { event.preventDefault(); displacement(session, event); }
  });
  target.addEventListener('pointerup', event => {
    if (customizing && editSession?.pointerId === event.pointerId) { moveEdit(event); endEdit(event.pointerId); return; }
    event.preventDefault(); end(event.pointerId, false, event);
  });
  target.addEventListener('pointercancel', event => { if (editSession?.pointerId === event.pointerId) endEdit(event.pointerId); else end(event.pointerId, true); });
  target.addEventListener('lostpointercapture', event => { if (editSession?.pointerId === event.pointerId) endEdit(event.pointerId); else end(event.pointerId, true); });
}
bind(moveZone);
for (const target of document.querySelectorAll<HTMLElement>('.action-pad')) bind(target, target.dataset.action as RemoteAction);
window.setInterval(() => {
  if (!link.isConnected) return;
  flush();
  link.heartbeat(++eventSeq);
}, 200);
window.setInterval(async () => {
  const now = performance.now();
  if (now - sentWindow >= 1000) { sendRate = sentInWindow; sentInWindow = 0; sentWindow = now; }
  const stats = await link.diagnostics();
  if (link.isConnected) short.textContent = stats.transport;
  document.querySelector<HTMLElement>('#phone-diagnostics')!.textContent =
    `Path ${stats.transport} · room ${stats.connection} · RTT ${stats.rttMs?.toFixed(0) ?? '?'} ms · state ${sendRate}/s · sent ${stats.sent} · received ${stats.received} · buffered ${stats.buffered} B`;
}, 500);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPointers(); });
window.addEventListener('pagehide', () => { cancelPointers(); link.disconnect(); });

const zoomGuard = new DoubleTapZoomGuard();
const point = (touch: Touch | null) => touch ? { identifier: touch.identifier, x: touch.clientX, y: touch.clientY } : null;
const gestureEligible = (target: EventTarget | null) => !(target instanceof HTMLElement && !!target.closest('textarea, button'));
app.addEventListener('touchstart', event => zoomGuard.begin(event.touches.length, point(event.changedTouches.item(0)),
  performance.now(), gestureEligible(event.target)), { passive: true });
app.addEventListener('touchmove', event => zoomGuard.move(event.touches.length, point(event.changedTouches.item(0))), { passive: true });
app.addEventListener('touchend', event => {
  if (zoomGuard.end(event.touches.length, point(event.changedTouches.item(0)), performance.now(), gestureEligible(event.target))) event.preventDefault();
}, { passive: false });
app.addEventListener('touchcancel', () => zoomGuard.cancel(), { passive: true });
app.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
