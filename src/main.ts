import './style.css';
import { cloneArena, DEFAULT_ARENA, DEFAULT_DEPOT_CAPACITY, depotFitsArena, flagFitsArena, MAX_DEPOT_CAPACITY, migrateArena, nextArenaObjectId, simpleArena, WALL_TYPES, wallFitsArena, type ArenaDefinition, type DepotDefinition, type DepotType, type WallDefinition, type WallType } from './game/arena.ts';
import { CaptureTheFlag } from './game/CaptureTheFlag.ts';
import { Game, type MoveInput } from './game/Game.ts';
import type { Team, Vec2 } from './game/arena.ts';
import { AIM_DEAD_ZONE, DEPLOYABLES, type DeployableId } from './game/deployables.ts';
import { TouchControls, type ActionSlot } from './input/TouchControls.ts';
import { normalizeControlLayout, type ControlLayout } from './input/controlLayout.ts';
import { ArenaView } from './view/ArenaView.ts';

const STORAGE_KEY = 'wall-ball-reborn-arena-v1';
const CONTROL_STORAGE_KEY = 'wall-ball-reborn-controls-v1';

function loadArena(): ArenaDefinition {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return cloneArena(DEFAULT_ARENA);
    const candidate = JSON.parse(saved) as ArenaDefinition;
    if (!Array.isArray(candidate.walls) || !candidate.bounds || !candidate.playerSpawns || !candidate.flagPositions ||
        !candidate.walls.every(w => typeof w.id === 'string' && Number.isFinite(w.position?.x) &&
          Number.isFinite(w.position?.z) && Number.isFinite(w.width) && Number.isFinite(w.depth) &&
          Number.isFinite(w.rotation) && w.width > 0 && w.depth > 0 && wallFitsArena(w, candidate))) {
      return cloneArena(DEFAULT_ARENA);
    }
    const migrated = migrateArena(candidate);
    if (!Array.isArray(migrated.depots) || !migrated.depots.every(depot =>
      ['wall', 'bomb'].includes(depot.type) && depotFitsArena(depot, migrated))) return cloneArena(DEFAULT_ARENA);
    return migrated;
  } catch { return cloneArena(DEFAULT_ARENA); }
}

let arena = loadArena();
const mode = new CaptureTheFlag();
let game = new Game(arena, mode);
let editing = false;
let editingControls = false;
let selectedId: string | null = null;
type PlacementTool = 'wood' | 'stone' | 'wall-depot' | 'bomb-depot';
let placementTool: PlacementTool | null = null;
let editorMessage = '';
let dragging = false;
let dragOffset = { x: 0, z: 0 };
const held = new Set<string>();
const touchMove: Record<Team, Vec2> = { red: { x: 0, z: 0 }, blue: { x: 0, z: 0 } };
const keyboardThrowStrength: Record<Team, number> = { red: 0.62, blue: 0.62 };
let touchVisible = matchMedia('(pointer: coarse)').matches;
let menuOpen = false;
let portraitBlocked = false;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <button id="menu-button" class="menu-tab" type="button" aria-expanded="false" aria-controls="sidebar"><span aria-hidden="true">☰</span> MENU</button>
  <div id="menu-scrim" class="menu-scrim" hidden></div>
  <main class="layout">
    <section class="arena-panel">
      <div id="viewport" class="viewport"></div>
      <div id="touch-controls" class="touch-controls" hidden></div>
      <div id="game-toast" class="game-toast" hidden></div>
      <pre id="debug-panel" class="debug-panel" hidden></pre>
      <div class="arena-corner">RED BASE <span>←</span> BLUE BASE <span>→</span></div>
    </section>
    <aside id="sidebar" class="sidebar" hidden>
      <div class="menu-heading"><span class="brand-mark">WB</span><div><strong>WALL BALL</strong><small id="mode-label">MATCH / CAPTURE THE FLAG</small></div></div>
      <div class="menu-actions"><button id="touch-toggle" type="button">Touch Controls</button><button id="edit-button" type="button">Customize Arena</button><button id="controls-button" type="button">Customize Controls</button><button id="reset-button" type="button">Reset Match</button><button id="fullscreen-button" type="button" aria-pressed="false">Enter Fullscreen</button></div>
      <div id="display-help" class="display-help" hidden></div>
      <div class="section-kicker">CURRENT MODE</div><h1>Capture<br>the Flag<span>.</span></h1>
      <p class="intro">Steal the other team's flag and bring it back to your base. Touch an enemy carrier to return your flag. Cross depot circles for resources; tag invaders in your territory to take half their supplies.</p>
      <div id="status" class="status" role="status" aria-live="polite"></div>
      <div id="play-panel">
        <div class="divider"></div><div class="section-kicker">INVENTORY</div>
        <div class="inventory-card" data-team="red"><strong>RED</strong><span>Wall <b id="red-wall-count">5</b></span><span>Bomb <b id="red-bomb-count">2</b></span></div>
        <div class="inventory-card" data-team="blue"><strong>BLUE</strong><span>Wall <b id="blue-wall-count">5</b></span><span>Bomb <b id="blue-bomb-count">2</b></span></div>
        <div class="divider"></div><div class="section-kicker">CONTROLS</div>
        <div class="control-row"><span class="team-dot red"></span><strong>RED</strong><span>Move W A S D</span></div>
        <div class="control-row"><span class="team-dot blue"></span><strong>BLUE</strong><span>Move ↑ ← ↓ →</span></div>
        <p class="hint">Red aims T F G H; hold Space for Wall or E for Bomb. Blue aims I J K L; hold Enter for Wall or right Shift for Bomb. Release to act. Esc cancels. Scroll over the arena while aiming a bomb to adjust keyboard throw distance.</p>
      </div>
      <div class="sidebar-footer">LOCAL TWO-PLAYER PROTOTYPE <span>01 / CTF</span></div>
    </aside>
    <div id="edit-panel" class="editor-dock" hidden>
      <div class="editor-heading"><strong>ARENA EDITOR</strong><span id="selection">Nothing selected</span></div>
      <div class="section-kicker">PLACE</div>
      <div class="editor-actions"><button id="add-wood" type="button">Wood Wall</button><button id="add-stone" type="button">Stone Wall</button><button id="add-wall-depot" type="button">Wall Depot</button><button id="add-bomb-depot" type="button">Bomb Depot</button></div>
      <button id="cancel-placement" class="editor-wide-button" type="button" hidden>Cancel Placement</button>
      <div id="wall-options" class="editor-options" hidden><div class="section-kicker">WALL</div><div class="editor-actions"><button id="rotate-wall" type="button">Rotate 90°</button><button id="delete-wall" type="button">Delete Wall</button></div></div>
      <div id="depot-options" class="editor-options" hidden><div class="section-kicker">DEPOT</div><div class="editor-actions"><button id="shrink-depot" type="button">Size −</button><button id="grow-depot" type="button">Size +</button><button id="delete-depot" type="button">Delete Depot</button></div><label id="depot-capacity-setting" class="editor-setting">Capacity <input id="depot-capacity" type="number" min="1" max="32" step="1" value="8" inputmode="numeric"></label></div>
      <div id="flag-options" class="editor-options" hidden><div class="section-kicker">FLAG + BASE</div><button id="reset-flag" class="editor-wide-button" type="button">Return to Default</button></div>
      <div class="editor-actions"><button id="reset-arena" type="button">Reset Arena</button><button id="play-arena" type="button">Play Arena</button></div>
      <p class="hint">Choose an object, then tap the arena to place it. Tap an existing object to select it; drag to move. Reset Arena restores the flags and one center wall.</p>
    </div>
    <div id="controls-panel" class="editor-dock controls-dock" hidden>
      <div class="editor-heading"><strong>CONTROLS</strong><span>Drag each Move, Wall, or Bomb pad where it feels comfortable.</span></div>
      <label class="control-setting">Pad size <output id="pad-size-value">82px</output><input id="pad-size" type="range" min="64" max="120" step="2" value="82"></label>
      <label class="control-setting">Floating area <output id="float-radius-value">56px</output><input id="float-radius" type="range" min="28" max="110" step="2" value="56"></label>
      <p class="hint">Floating area sets how far you drag from touch-down for full movement or throw strength. The dashed rings show it while editing.</p>
      <div class="editor-actions"><button id="reset-controls" type="button">Reset Layout</button><button id="done-controls" type="button">Done</button></div>
    </div>
  </main>
  <div id="rotate-overlay" class="rotate-overlay" hidden role="status" aria-live="polite"><div class="rotate-icon" aria-hidden="true">↻</div><strong>Rotate your device</strong><span>Wall Ball is designed for landscape play.</span></div>`;

const viewport = document.querySelector<HTMLDivElement>('#viewport')!;
const view = new ArenaView(viewport, arena);
const status = document.querySelector<HTMLDivElement>('#status')!;
const editButton = document.querySelector<HTMLButtonElement>('#edit-button')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset-button')!;
const playPanel = document.querySelector<HTMLDivElement>('#play-panel')!;
const editPanel = document.querySelector<HTMLDivElement>('#edit-panel')!;
const controlsPanel = document.querySelector<HTMLDivElement>('#controls-panel')!;
const controlsButton = document.querySelector<HTMLButtonElement>('#controls-button')!;
const selection = document.querySelector<HTMLElement>('#selection')!;
const touchToggle = document.querySelector<HTMLButtonElement>('#touch-toggle')!;
const touchControls = document.querySelector<HTMLDivElement>('#touch-controls')!;
const fullscreenButton = document.querySelector<HTMLButtonElement>('#fullscreen-button')!;
const menuButton = document.querySelector<HTMLButtonElement>('#menu-button')!;
const menuScrim = document.querySelector<HTMLDivElement>('#menu-scrim')!;
const sidebar = document.querySelector<HTMLElement>('#sidebar')!;
const displayHelp = document.querySelector<HTMLDivElement>('#display-help')!;
const rotateOverlay = document.querySelector<HTMLDivElement>('#rotate-overlay')!;
const gameToast = document.querySelector<HTMLDivElement>('#game-toast')!;
const debugPanel = document.querySelector<HTMLElement>('#debug-panel')!;
const debugEnabled = new URLSearchParams(location.search).has('debug');
let touchController: TouchControls;

function updateInventoryUi(): void {
  for (const team of ['red', 'blue'] as const) {
    for (const item of ['wall', 'bomb'] as const) {
      document.querySelector<HTMLElement>(`#${team}-${item}-count`)!.textContent =
        String(game.deployments.inventory[team][item]);
    }
    touchController.setInventory(team, game.deployments.inventory[team]);
  }
}

function updateUi(): void {
  status.classList.toggle('winner', !!game.state.winner);
  status.innerHTML = game.state.winner
    ? `<span class="status-kicker">MATCH COMPLETE</span><strong>${game.state.winner.toUpperCase()} WINS</strong><span>Reset Match to play again.</span>`
    : `<span class="status-kicker">${editing || editingControls ? 'EDITOR ACTIVE' : 'MATCH LIVE'}</span><strong>${editing ? 'Customize Arena' : editingControls ? 'Customize Controls' : game.state.event}</strong>`;
  editButton.textContent = editing ? 'Play Arena' : 'Customize Arena';
  controlsButton.textContent = editingControls ? 'Done Controls' : 'Customize Controls';
  document.querySelector('#mode-label')!.textContent = editing ? 'CUSTOMIZE ARENA' : editingControls ? 'CUSTOMIZE CONTROLS' : 'MATCH / CAPTURE THE FLAG';
  playPanel.hidden = editing || editingControls;
  editPanel.hidden = !editing;
  controlsPanel.hidden = !editingControls;
  const wall = selectedWall();
  const depot = selectedDepot();
  const flag = selectedFlag();
  const toolNames: Record<PlacementTool, string> = {
    wood: 'Wood Wall', stone: 'Stone Wall', 'wall-depot': 'Wall Depot', 'bomb-depot': 'Bomb Depot',
  };
  selection.textContent = editorMessage || (placementTool ? `Tap arena to place ${toolNames[placementTool]}` :
    wall ? `${WALL_TYPES[wall.type].label} wall · ${WALL_TYPES[wall.type].maxHealth} HP` :
    depot ? `${depot.type === 'wall' ? 'Wall' : 'Bomb'} depot · radius ${depot.radius.toFixed(2)} · holds ${depot.capacity}` :
    flag ? `${flag.toUpperCase()} flag + base · drag to move` : 'Choose an object or tap one to select');
  for (const [tool, id] of [['wood', 'add-wood'], ['stone', 'add-stone'], ['wall-depot', 'add-wall-depot'], ['bomb-depot', 'add-bomb-depot']] as const) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`)!;
    button.setAttribute('aria-pressed', String(placementTool === tool));
  }
  document.querySelector<HTMLElement>('#cancel-placement')!.hidden = !placementTool;
  document.querySelector<HTMLElement>('#wall-options')!.hidden = !wall || !!placementTool;
  document.querySelector<HTMLElement>('#depot-options')!.hidden = !depot || !!placementTool;
  document.querySelector<HTMLElement>('#flag-options')!.hidden = !flag || !!placementTool;
  if (depot) document.querySelector<HTMLInputElement>('#depot-capacity')!.value = String(depot.capacity);
  touchControls.hidden = editing || (!touchVisible && !editingControls) || menuOpen || portraitBlocked;
  sidebar.hidden = !menuOpen;
  menuScrim.hidden = !menuOpen;
  menuButton.setAttribute('aria-expanded', String(menuOpen));
  menuButton.classList.toggle('selected', menuOpen);
  rotateOverlay.hidden = !portraitBlocked;
  touchToggle.setAttribute('aria-pressed', String(touchVisible));
  touchToggle.classList.toggle('selected', touchVisible);
  updateInventoryUi();
  debugPanel.hidden = !debugEnabled;
}

function saveAndRefresh(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arena));
  view.rebuildArena(arena, selectedId);
  updateUi();
}

function resetMatch(): void {
  touchController.cancelAll();
  keyboardOwned.clear();
  game = new Game(arena, mode);
  lastTheftSequence = 0;
  toastUntil = 0;
  touchMove.red = { x: 0, z: 0 };
  touchMove.blue = { x: 0, z: 0 };
  updateUi();
}

editButton.addEventListener('click', () => {
  if (editingControls) finishControlsCustomization();
  editing = !editing;
  menuOpen = false;
  held.clear();
  keyboardOwned.clear();
  touchController.cancelAll();
  game.cancelDeployAim('red');
  game.cancelDeployAim('blue');
  touchMove.red = { x: 0, z: 0 };
  touchMove.blue = { x: 0, z: 0 };
  dragging = false;
  selectedId = null;
  placementTool = null;
  editorMessage = '';
  if (!editing) resetMatch();
  view.rebuildArena(arena);
  updateUi();
});
function syncControlSettings(): void {
  const layout = touchController.getLayout();
  document.querySelector<HTMLInputElement>('#pad-size')!.value = String(layout.padSize);
  document.querySelector<HTMLInputElement>('#float-radius')!.value = String(layout.floatRadius);
  document.querySelector<HTMLOutputElement>('#pad-size-value')!.textContent = `${layout.padSize}px`;
  document.querySelector<HTMLOutputElement>('#float-radius-value')!.textContent = `${layout.floatRadius}px`;
}
function persistControlLayout(layout: ControlLayout): void {
  localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(layout));
  syncControlSettings();
}
function finishControlsCustomization(): void {
  editingControls = false;
  touchController.setCustomizeMode(false);
  updateUi();
}
controlsButton.addEventListener('click', () => {
  if (editingControls) { menuOpen = false; finishControlsCustomization(); return; }
  if (editing) editButton.click();
  held.clear();
  keyboardOwned.clear();
  touchController.cancelAll();
  game.cancelDeployAim('red');
  game.cancelDeployAim('blue');
  touchMove.red = { x: 0, z: 0 };
  touchMove.blue = { x: 0, z: 0 };
  editingControls = true;
  menuOpen = false;
  touchController.setCustomizeMode(true);
  syncControlSettings();
  updateUi();
});
document.querySelector<HTMLButtonElement>('#done-controls')!.addEventListener('click', finishControlsCustomization);
document.querySelector<HTMLButtonElement>('#reset-controls')!.addEventListener('click', () => touchController.resetLayout());
for (const [selector, key] of [['#pad-size', 'padSize'], ['#float-radius', 'floatRadius']] as const) {
  document.querySelector<HTMLInputElement>(selector)!.addEventListener('input', event => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    const layout = touchController.getLayout();
    layout[key] = value;
    touchController.setLayout(layout);
    persistControlLayout(touchController.getLayout());
  });
}
document.querySelector<HTMLButtonElement>('#play-arena')!.addEventListener('click', () => editButton.click());
resetButton.addEventListener('click', () => { menuOpen = false; resetMatch(); });
touchToggle.addEventListener('click', () => {
  touchVisible = !touchVisible;
  menuOpen = false;
  if (!touchVisible) {
    touchController.cancelAll();
    touchMove.red = { x: 0, z: 0 };
    touchMove.blue = { x: 0, z: 0 };
  }
  updateUi();
});
function setMenuOpen(open: boolean): void {
  menuOpen = open;
  if (open) {
    touchController.cancelAll();
    held.clear();
    keyboardOwned.clear();
    game.cancelDeployAim('red');
    game.cancelDeployAim('blue');
    touchMove.red = { x: 0, z: 0 };
    touchMove.blue = { x: 0, z: 0 };
  }
  updateUi();
}
menuButton.addEventListener('click', () => setMenuOpen(!menuOpen));
menuScrim.addEventListener('click', () => setMenuOpen(false));

const fullscreenAvailable = typeof app.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
function showDisplayHelp(): void {
  const installed = matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  displayHelp.innerHTML = installed
    ? '<strong>App display active</strong><span>Wall Ball is already running from the Home Screen. Some system bars remain under device control.</span>'
    : '<strong>Fill the screen on mobile</strong><span>This browser does not offer one-tap fullscreen for this page. On iPhone or iPad, open it in Safari, tap Share, then Add to Home Screen. On Android, use the browser menu’s Install app or Add to Home Screen action. Launch Wall Ball from its new icon.</span>';
  displayHelp.hidden = false;
}
function refreshFullscreenUi(): void {
  const full = document.fullscreenElement === app;
  touchController.cancelAll();
  fullscreenButton.textContent = full ? 'Exit Fullscreen' : fullscreenAvailable ? 'Enter Fullscreen' : 'Display Options';
  fullscreenButton.setAttribute('aria-pressed', String(full));
  if (full) displayHelp.hidden = true;
  requestAnimationFrame(() => view.resizeToContainer(viewport, arena));
}
fullscreenButton.addEventListener('click', async () => {
  if (!fullscreenAvailable) { showDisplayHelp(); return; }
  try {
    if (document.fullscreenElement === app) await document.exitFullscreen();
    else await app.requestFullscreen();
  } catch {
    showDisplayHelp();
  }
  if (document.fullscreenElement === app) menuOpen = false;
  updateUi();
  refreshFullscreenUi();
});
document.addEventListener('fullscreenchange', refreshFullscreenUi);

function refreshPortraitState(): void {
  const blocked = window.innerWidth <= 900 && window.innerHeight > window.innerWidth * 1.2;
  if (blocked && !portraitBlocked) {
    touchController.cancelAll();
    held.clear();
    keyboardOwned.clear();
    game.cancelDeployAim('red');
    game.cancelDeployAim('blue');
    touchMove.red = { x: 0, z: 0 };
    touchMove.blue = { x: 0, z: 0 };
  }
  portraitBlocked = blocked;
  updateUi();
  requestAnimationFrame(() => { view.resizeToContainer(viewport, arena); touchController.refreshBounds(); });
}
window.addEventListener('resize', refreshPortraitState);
window.addEventListener('orientationchange', refreshPortraitState);
window.visualViewport?.addEventListener('resize', refreshPortraitState);

function reportDeployment(team: Team, id: DeployableId, result: ReturnType<Game['releaseDeployAim']>): void {
  if (result === 'placed') game.state.event = id === 'bomb'
    ? `${team.toUpperCase()} threw a bomb.` : `${team.toUpperCase()} built a wall.`;
  else if (result === 'invalid') game.state.event = `${team.toUpperCase()}: invalid placement or no inventory.`;
  else game.state.event = `${team.toUpperCase()} cancelled deployment.`;
  updateUi();
}

function loadControlLayout(): ControlLayout | undefined {
  try {
    const saved = localStorage.getItem(CONTROL_STORAGE_KEY);
    return saved ? normalizeControlLayout(JSON.parse(saved), viewport.clientWidth, viewport.clientHeight) : undefined;
  } catch { return undefined; }
}
touchController = new TouchControls(touchControls, {
  toWorld: (dx, dy) => view.screenDirectionToGround(dx, dy),
  onMove: (team, input) => { if (!editing && !editingControls) touchMove[team] = input; },
  onAimStart: (team, id) => { if (!editing && !editingControls) game.beginDeployAim(team, id); },
  onAim: (team, id, direction, strength) => { if (!editing && !editingControls) game.updateDeployAim(team, id, direction, strength); },
  onAimRelease: (team, id) => { if (!editing && !editingControls) reportDeployment(team, id, game.releaseDeployAim(team, id)); },
  onAimCancel: (team, id) => game.cancelDeployAim(team, id),
}, loadControlLayout(), persistControlLayout);
const actionSlots: ActionSlot[] = Object.values(DEPLOYABLES).map(definition => ({
  id: definition.id, label: definition.label, icon: definition.control.icon, size: definition.control.size,
}));
touchController.setActionSlots('red', actionSlots);
touchController.setActionSlots('blue', actionSlots);

function selectedWall(): WallDefinition | undefined { return arena.walls.find(w => w.id === selectedId); }
function selectedDepot(): DepotDefinition | undefined { return arena.depots.find(d => d.id === selectedId); }
function selectedFlag(): Team | null {
  return selectedId === 'flag:red' ? 'red' : selectedId === 'flag:blue' ? 'blue' : null;
}

function rotateWall(): void {
  const wall = selectedWall();
  if (!wall) return;
  const previous = wall.rotation;
  wall.rotation = (wall.rotation + Math.PI / 2) % (2 * Math.PI);
  if (!wallFitsArena(wall, arena)) wall.rotation = previous;
  saveAndRefresh();
}

document.querySelector('#rotate-wall')!.addEventListener('click', rotateWall);
document.querySelector('#delete-wall')!.addEventListener('click', () => {
  if (!selectedWall()) return;
  arena.walls = arena.walls.filter(w => w.id !== selectedId);
  selectedId = null;
  saveAndRefresh();
});
document.querySelector('#delete-depot')!.addEventListener('click', () => {
  if (!selectedDepot()) return;
  arena.depots = arena.depots.filter(d => d.id !== selectedId);
  selectedId = null;
  saveAndRefresh();
});
function armTool(tool: PlacementTool): void {
  placementTool = placementTool === tool ? null : tool;
  selectedId = null;
  editorMessage = '';
  view.rebuildArena(arena);
  updateUi();
}
for (const [id, tool] of [['add-wood', 'wood'], ['add-stone', 'stone'], ['add-wall-depot', 'wall-depot'], ['add-bomb-depot', 'bomb-depot']] as const) {
  document.querySelector(`#${id}`)!.addEventListener('click', () => armTool(tool));
}
document.querySelector('#cancel-placement')!.addEventListener('click', () => {
  placementTool = null;
  editorMessage = '';
  updateUi();
});
function snapPoint(point: Vec2): Vec2 {
  return { x: Math.round(point.x * 4) / 4, z: Math.round(point.z * 4) / 4 };
}
function placeObject(point: Vec2): void {
  if (!placementTool) return;
  const position = snapPoint(point);
  if (placementTool === 'wood' || placementTool === 'stone') {
    const type: WallType = placementTool;
    const wall: WallDefinition = {
      id: nextArenaObjectId(arena, 'wall'), type, position,
      ...WALL_TYPES[type].placementFootprint, rotation: 0,
    };
    if (wallFitsArena(wall, arena)) { arena.walls.push(wall); selectedId = wall.id; }
  } else {
    const type: DepotType = placementTool === 'wall-depot' ? 'wall' : 'bomb';
    const depot: DepotDefinition = {
      id: nextArenaObjectId(arena, 'depot'), type, position,
      radius: 1.7, capacity: DEFAULT_DEPOT_CAPACITY,
    };
    if (depotFitsArena(depot, arena)) { arena.depots.push(depot); selectedId = depot.id; }
  }
  if (!selectedId) {
    editorMessage = 'That spot is blocked or outside the arena. Tap another spot.';
    updateUi();
    return;
  }
  placementTool = null;
  editorMessage = '';
  saveAndRefresh();
}
document.querySelector('#reset-arena')!.addEventListener('click', () => {
  Object.assign(arena, simpleArena());
  selectedId = null;
  placementTool = null;
  editorMessage = '';
  saveAndRefresh();
  view.resizeToContainer(viewport, arena);
});
document.querySelector('#reset-flag')!.addEventListener('click', () => {
  const team = selectedFlag();
  if (!team) return;
  const position = { ...DEFAULT_ARENA.flagPositions[team] };
  if (!flagFitsArena(team, position, arena)) {
    editorMessage = 'Default flag spot is blocked by a wall.';
    updateUi();
    return;
  }
  arena.flagPositions[team] = position;
  editorMessage = '';
  saveAndRefresh();
});
function resizeDepot(change: number): void {
  const depot = selectedDepot();
  if (!depot) return;
  const old = depot.radius;
  depot.radius = Math.round((old + change) * 4) / 4;
  if (!depotFitsArena(depot, arena)) depot.radius = old;
  saveAndRefresh();
}
document.querySelector('#shrink-depot')!.addEventListener('click', () => resizeDepot(-0.25));
document.querySelector('#grow-depot')!.addEventListener('click', () => resizeDepot(0.25));
document.querySelector<HTMLInputElement>('#depot-capacity')!.addEventListener('change', event => {
  const depot = selectedDepot();
  if (!depot) return;
  const input = event.currentTarget as HTMLInputElement;
  const value = Number(input.value);
  depot.capacity = Number.isFinite(value) ? Math.max(1, Math.min(MAX_DEPOT_CAPACITY, Math.round(value))) : depot.capacity;
  saveAndRefresh();
});

const canvas = view.renderer.domElement;
const arenaPanel = document.querySelector<HTMLElement>('.arena-panel')!;
for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
  arenaPanel.addEventListener(type, event => event.preventDefault());
}
arenaPanel.addEventListener('touchmove', event => event.preventDefault(), { passive: false });
arenaPanel.addEventListener('gesturestart', event => event.preventDefault(), { passive: false });
canvas.addEventListener('pointerdown', event => {
  if (!editing) return;
  event.preventDefault();
  const point = view.groundPoint(event.clientX, event.clientY);
  if (placementTool) {
    if (point) placeObject(point);
    return;
  }
  selectedId = view.pickArenaObject(event.clientX, event.clientY);
  editorMessage = '';
  const flag = selectedFlag();
  const position = selectedWall()?.position ?? selectedDepot()?.position ?? (flag ? arena.flagPositions[flag] : null);
  dragging = !!position && !!point;
  if (position && point) dragOffset = { x: position.x - point.x, z: position.z - point.z };
  if (dragging) {
    try { canvas.setPointerCapture(event.pointerId); }
    catch { dragging = false; }
  }
  view.rebuildArena(arena, selectedId);
  updateUi();
});
canvas.addEventListener('pointermove', event => {
  if (!editing || !dragging) return;
  const point = view.groundPoint(event.clientX, event.clientY);
  if (!point) return;
  const wall = selectedWall();
  const depot = selectedDepot();
  const flag = selectedFlag();
  const old = wall ? { ...wall.position } : depot ? { ...depot.position } : flag ? { ...arena.flagPositions[flag] } : null;
  if (!old) return;
  const position = {
    x: Math.round((point.x + dragOffset.x) * 4) / 4,
    z: Math.round((point.z + dragOffset.z) * 4) / 4,
  };
  if (wall) {
    wall.position = position;
    if (!wallFitsArena(wall, arena)) wall.position = old;
  } else if (depot) {
    depot.position = position;
    if (!depotFitsArena(depot, arena)) depot.position = old;
  } else if (flag) {
    arena.flagPositions[flag] = position;
    if (!flagFitsArena(flag, position, arena)) arena.flagPositions[flag] = old;
  }
  view.rebuildArena(arena, selectedId);
});
function finishDrag(): void {
  if (dragging) saveAndRefresh();
  dragging = false;
}
canvas.addEventListener('pointerup', finishDrag);
canvas.addEventListener('pointercancel', finishDrag);
canvas.addEventListener('lostpointercapture', finishDrag);

const actionKeys: Record<string, [Team, DeployableId]> = {
  Space: ['red', 'wall'], KeyE: ['red', 'bomb'],
  Enter: ['blue', 'wall'], ShiftRight: ['blue', 'bomb'],
};
const keyboardOwned = new Set<string>();
const controlKeys = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'KeyT', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL',
  ...Object.keys(actionKeys),
]);
function keyboardAim(team: Team, id: DeployableId): void {
  const down = (key: string) => Number(held.has(key));
  const raw = team === 'red'
    ? { x: down('KeyH') - down('KeyF'), z: down('KeyG') - down('KeyT') }
    : { x: down('KeyL') - down('KeyJ'), z: down('KeyK') - down('KeyI') };
  const player = game.state.players[team];
  const direction = Math.hypot(raw.x, raw.z) > 0
    ? raw : { x: Math.sin(player.facing), z: Math.cos(player.facing) };
  game.updateDeployAim(team, id, direction, id === 'bomb' ? keyboardThrowStrength[team] : 0.67);
}
canvas.addEventListener('wheel', event => {
  if (editing || editingControls) return;
  const team = keyboardOwned.has('KeyE') ? 'red' : keyboardOwned.has('ShiftRight') ? 'blue' : null;
  if (!team) return;
  event.preventDefault();
  keyboardThrowStrength[team] = Math.max(AIM_DEAD_ZONE + 0.02,
    Math.min(1, keyboardThrowStrength[team] - Math.sign(event.deltaY) * 0.06));
  keyboardAim(team, 'bomb');
}, { passive: false });
window.addEventListener('keydown', event => {
  if (menuOpen || portraitBlocked) {
    if (menuOpen && event.code === 'Escape') setMenuOpen(false);
    return;
  }
  if (editingControls) {
    if (event.code === 'Escape') finishControlsCustomization();
    return;
  }
  if (controlKeys.has(event.code) || (editing && ['KeyR', 'Delete', 'Backspace', 'Escape'].includes(event.code))) event.preventDefault();
  held.add(event.code);
  if (editing && !event.repeat && event.code === 'Escape') {
    placementTool = null;
    selectedId = null;
    editorMessage = '';
    view.rebuildArena(arena);
    updateUi();
  }
  if (editing && !event.repeat && event.code === 'KeyR') rotateWall();
  if (editing && !event.repeat && ['Delete', 'Backspace'].includes(event.code)) {
    if (selectedWall()) document.querySelector<HTMLButtonElement>('#delete-wall')!.click();
    else if (selectedDepot()) document.querySelector<HTMLButtonElement>('#delete-depot')!.click();
  }
  if (editing || event.repeat) return;
  if (event.code === 'Escape') {
    game.cancelDeployAim('red');
    game.cancelDeployAim('blue');
    keyboardOwned.clear();
  }
  const action = actionKeys[event.code];
  if (action) {
    if (game.state.winner && event.code === 'Enter') { resetMatch(); return; }
    if (game.deployments.aim[action[0]][action[1]]) return;
    game.beginDeployAim(action[0], action[1]);
    keyboardOwned.add(event.code);
    keyboardAim(action[0], action[1]);
  }
});
window.addEventListener('keyup', event => {
  if (menuOpen || portraitBlocked || editingControls) {
    keyboardOwned.delete(event.code);
    held.delete(event.code);
    return;
  }
  const action = actionKeys[event.code];
  if (!editing && action && keyboardOwned.has(event.code)) {
    keyboardAim(action[0], action[1]);
    reportDeployment(action[0], action[1], game.releaseDeployAim(action[0], action[1]));
  }
  keyboardOwned.delete(event.code);
  held.delete(event.code);
});
window.addEventListener('blur', () => {
  touchController.cancelAll();
  held.clear();
  keyboardOwned.clear();
  game.cancelDeployAim('red');
  game.cancelDeployAim('blue');
  touchMove.red = { x: 0, z: 0 };
  touchMove.blue = { x: 0, z: 0 };
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    touchController.cancelAll();
    held.clear();
    keyboardOwned.clear();
    game.cancelDeployAim('red');
    game.cancelDeployAim('blue');
    touchMove.red = { x: 0, z: 0 };
    touchMove.blue = { x: 0, z: 0 };
  }
});

function input(): MoveInput {
  const down = (key: string) => Number(held.has(key));
  return {
    red: { x: down('KeyD') - down('KeyA') + touchMove.red.x, z: down('KeyS') - down('KeyW') + touchMove.red.z },
    blue: { x: down('ArrowRight') - down('ArrowLeft') + touchMove.blue.x, z: down('ArrowDown') - down('ArrowUp') + touchMove.blue.z },
  };
}

let previous = performance.now();
let accumulator = 0;
let lastEvent = '';
let lastInventory = '';
let lastTheftSequence = 0;
let toastUntil = 0;
let lastDebug = 0;
function frame(now: number): void {
  accumulator += Math.min((now - previous) / 1000, 0.1);
  previous = now;
  if (!editing && !editingControls) {
    while (accumulator >= 1 / 60) {
      game.update(1 / 60, input());
      accumulator -= 1 / 60;
    }
    for (const code of keyboardOwned) {
      const [team, id] = actionKeys[code];
      if (held.has(code) && game.deployments.aim[team][id]) keyboardAim(team, id);
    }
  } else accumulator = 0;
  if (game.state.event !== lastEvent) { lastEvent = game.state.event; updateUi(); }
  const inventory = JSON.stringify(game.deployments.inventory);
  if (inventory !== lastInventory) { lastInventory = inventory; updateInventoryUi(); }
  if (game.lastTheft && game.lastTheft.sequence !== lastTheftSequence) {
    lastTheftSequence = game.lastTheft.sequence;
    gameToast.textContent = game.lastTheft.text;
    toastUntil = now + 2400;
  }
  gameToast.hidden = editing || now > toastUntil;
  if (debugEnabled && now - lastDebug > 250) {
    lastDebug = now;
    const teamLine = (team: Team) => `${team.toUpperCase()} ${game.economy.territory[team]}  W:${game.deployments.inventory[team].wall} B:${game.deployments.inventory[team].bomb}  passive:${game.economy.passiveBombRemaining[team].toFixed(1)}s`;
    debugPanel.textContent = [teamLine('red'), teamLine('blue'),
      ...game.economy.depots.map(d => `${d.type} depot ${d.id}: stock ${d.stock}/${d.capacity}, next ${d.generationRemaining.toFixed(1)}s`),
      ...game.deployments.walls.map(w => `${w.id}: ${w.type} ${w.hp}/${WALL_TYPES[w.type].maxHealth} HP`),
    ].join('\n');
  }
  view.sync(game.state, arena, editing, game.deployments, game.economy);
  requestAnimationFrame(frame);
}
refreshPortraitState();
refreshFullscreenUi();
requestAnimationFrame(frame);
