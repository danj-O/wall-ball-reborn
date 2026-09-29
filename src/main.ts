import './style.css';
import { ARENA_DIMENSIONS, cloneArena, DEFAULT_ARENA, DEFAULT_DEPOT_CAPACITY, depotFitsArena, flagFitsArena, MAX_DEPOT_CAPACITY, migrateArena, minimumArenaDimensions, nextArenaObjectId, powerUpRegionFitsArena, resizedArena, WALL_TYPES, wallFitsArena, type ArenaDefinition, type DepotDefinition, type DepotType, type RectRegion, type WallDefinition, type WallType } from './game/arena.ts';
import { CaptureTheFlag } from './game/CaptureTheFlag.ts';
import { Game, type MoveInput } from './game/Game.ts';
import type { Team, Vec2 } from './game/arena.ts';
import { AIM_DEAD_ZONE, DEPLOYABLES, type DeployableId } from './game/deployables.ts';
import { TouchControls, type ActionSlot } from './input/TouchControls.ts';
import { CONTROL_SIZE_RANGE, MOVE_AREA_RANGE, MOVE_INSET_RANGE, normalizeControlLayout, type ControlId, type ControlLayout } from './input/controlLayout.ts';
import { ArenaView } from './view/ArenaView.ts';
import { DEFAULT_GAME_SETTINGS, loadGameSettings } from './game/gameSettings.ts';
import { GAME_SETTING_RANGES, type GameSettings, type ProjectileTuning } from './game/gameSettingsSchema.ts';

const STORAGE_KEY = 'wall-ball-reborn-arena-v1';
const CONTROL_STORAGE_KEY = 'wall-ball-reborn-controls-v1';
const GAME_SETTINGS_STORAGE_KEY = 'wall-ball-reborn-game-settings-v1';
const GAME_DEFAULT_SAVED_KEY = 'wall-ball-reborn-game-default-saved';
const ARENA_DEFAULT_SAVED_KEY = 'wall-ball-reborn-arena-default-saved';

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
    if (!Array.isArray(migrated.powerupSpawnAreas) || !migrated.powerupSpawnAreas.every(region =>
      typeof region.id === 'string' && powerUpRegionFitsArena(region, migrated))) return cloneArena(DEFAULT_ARENA);
    return migrated;
  } catch { return cloneArena(DEFAULT_ARENA); }
}

let arena = loadArena();
const mode = new CaptureTheFlag();
let gameSettings = loadGameSettings(localStorage);
let game = new Game(arena, mode, Math.random, gameSettings);
let editing = false;
let editingControls = false;
let selectedControl: ControlId = 'red-move';
let selectedId: string | null = null;
type PlacementTool = 'wood' | 'stone' | 'wall-depot' | 'bomb-depot' | 'power-region';
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
      <div class="menu-actions"><button id="new-match-button" type="button">Start / New Match</button><button id="touch-toggle" type="button">Touch Controls</button><button id="edit-button" type="button">Customize Arena</button><button id="controls-button" type="button">Customize Controls</button><button id="game-settings-button" type="button" aria-expanded="false">Game Tuning</button><button id="reset-button" type="button">Return to Start</button><button id="fullscreen-button" type="button" aria-pressed="false">Enter Fullscreen</button></div>
      <div id="game-settings-panel" class="game-settings-panel" hidden>
        <div class="section-kicker">GAME TUNING</div><p class="hint">Speed is units/sec; acceleration and braking are units/sec². Player and projectile weight affect collisions. Blast radius is in arena units. Starting supplies apply next match; generation rates and movement apply now. A regeneration value of 0 turns it off.</p>
        <div id="game-settings-sliders"></div>
        <div class="editor-actions"><button id="reset-game-settings" type="button">Reset Tuning</button><button id="done-game-settings" type="button">Done</button></div>
        <div id="developer-game-defaults" class="developer-controls" hidden><button id="save-game-default" class="editor-wide-button" type="button">Save as Game Default</button><p class="hint">Developer mode: writes the preset used by new devices.</p><p id="game-default-status" class="control-default-status" role="status" aria-live="polite"></p></div>
      </div>
      <div id="display-help" class="display-help" hidden></div>
      <div class="section-kicker">CURRENT MODE</div><h1>Capture<br>the Flag<span>.</span></h1>
      <p class="intro">Steal the other team's flag and bring it back to your base. Touch an enemy carrier to return your flag. Cross depot circles for resources; tag invaders in your territory to take half their supplies.</p>
      <div id="status" class="status" role="status" aria-live="polite"></div>
      <div id="play-panel">
        <div class="divider"></div><div class="section-kicker">INVENTORY</div>
        <div class="inventory-card" data-team="red"><strong>RED</strong><span>Wall <b id="red-wall-count">8</b></span><span>Bomb <b id="red-bomb-count">2</b></span></div>
        <div class="inventory-card" data-team="blue"><strong>BLUE</strong><span>Wall <b id="blue-wall-count">8</b></span><span>Bomb <b id="blue-bomb-count">2</b></span></div>
        <div class="divider"></div><div class="section-kicker">CONTROLS</div>
        <div class="control-row"><span class="team-dot red"></span><strong>RED</strong><span>Move W A S D</span></div>
        <div class="control-row"><span class="team-dot blue"></span><strong>BLUE</strong><span>Move ↑ ← ↓ →</span></div>
        <p class="hint">Red aims T F G H; hold Space for Wall, E for Bomb, or Q for a charged Mega Bomb. Blue aims I J K L; hold Enter for Wall, right Shift for Bomb, or P for Mega Bomb. Release to act. Esc cancels. Scroll over the arena while aiming a bomb to adjust keyboard throw distance.</p>
      </div>
      <div class="sidebar-footer">LOCAL TWO-PLAYER PROTOTYPE <span>01 / CTF</span></div>
    </aside>
    <div id="edit-panel" class="editor-dock" hidden>
      <div class="editor-heading"><strong>ARENA EDITOR</strong><span id="selection">Nothing selected</span></div>
      <div class="section-kicker">PLACE</div>
      <div class="editor-actions"><button id="add-wood" type="button">Wood Wall</button><button id="add-stone" type="button">Stone Wall</button><button id="add-wall-depot" type="button">Wall Depot</button><button id="add-bomb-depot" type="button">Bomb Depot</button><button id="add-power-region" type="button">Power-Up Region</button></div>
      <button id="cancel-placement" class="editor-wide-button" type="button" hidden>Cancel Placement</button>
      <div id="wall-options" class="editor-options" hidden><div class="section-kicker">WALL</div><div class="editor-actions"><button id="rotate-wall" type="button">Rotate 90°</button><button id="delete-wall" type="button">Delete Wall</button></div></div>
      <div id="depot-options" class="editor-options" hidden><div class="section-kicker">DEPOT</div><div class="editor-actions"><button id="shrink-depot" type="button">Size −</button><button id="grow-depot" type="button">Size +</button><button id="delete-depot" type="button">Delete Depot</button></div><label id="depot-capacity-setting" class="editor-setting">Capacity <input id="depot-capacity" type="number" min="1" max="32" step="1" value="8" inputmode="numeric"></label></div>
      <div id="flag-options" class="editor-options" hidden><div class="section-kicker">FLAG + BASE</div><button id="reset-flag" class="editor-wide-button" type="button">Return to Default</button></div>
      <div id="power-region-options" class="editor-options" hidden><div class="section-kicker">POWER-UP REGION</div><div class="editor-actions"><button id="region-width-down" type="button">Width −</button><button id="region-width-up" type="button">Width +</button><button id="region-depth-down" type="button">Depth −</button><button id="region-depth-up" type="button">Depth +</button><button id="delete-power-region" type="button">Delete Region</button></div></div>
      <div class="editor-options"><div class="section-kicker">ARENA SIZE</div><label class="control-setting"><span>Width</span><output id="arena-width-value" for="arena-width"></output><input id="arena-width" type="range" min="${ARENA_DIMENSIONS.width.min}" max="${ARENA_DIMENSIONS.width.max}" step="2"></label><label class="control-setting"><span>Length</span><output id="arena-length-value" for="arena-length"></output><input id="arena-length" type="range" min="${ARENA_DIMENSIONS.length.min}" max="${ARENA_DIMENSIONS.length.max}" step="2"></label><p id="arena-size-hint" class="hint">Drag a slider to resize the arena. Existing objects stay in place.</p></div>
      <div class="editor-actions"><button id="reset-arena" type="button">Reset Arena</button><button id="play-arena" type="button">Play Arena</button></div>
      <div id="developer-arena-defaults" class="developer-controls" hidden><button id="save-arena-default" class="editor-wide-button" type="button">Save as Default Map</button><p class="hint">Developer mode: use this layout and size for new devices and Reset Arena.</p><p id="arena-default-status" class="control-default-status" role="status" aria-live="polite"></p></div>
      <p class="hint">Choose an object, then tap the arena to place it. Tap an existing object to select it; drag to move. Power-up regions are visible only here. Reset Arena restores the current saved default map.</p>
    </div>
    <div id="controls-panel" class="editor-dock controls-dock" hidden>
      <div class="editor-heading"><strong>CONTROLS</strong><span>Tap a pad to edit it, then drag it to move it.</span></div>
      <div class="section-kicker">SELECTED: <span id="selected-control">RED MOVE</span></div>
      <label class="control-setting"><span id="pad-size-label">Pad size</span> <output id="pad-size-value">110px</output><input id="pad-size" type="range" min="38" max="280" step="2" value="110"></label>
      <label id="move-area-setting" class="control-setting">Movement touch area <output id="move-area-value">320px</output><input id="move-area" type="range" min="150" max="480" step="2" value="320"></label>
      <label id="move-inset-setting" class="control-setting">Edge inset <output id="move-inset-value">6px</output><input id="move-inset" type="range" min="0" max="32" step="1" value="6"></label>
      <label id="float-radius-setting" class="control-setting">Aim travel <output id="float-radius-value">70px</output><input id="float-radius" type="range" min="28" max="160" step="2" value="70"></label>
      <p class="hint">Movement starts anywhere in the dashed corner area and floats under your finger. Area size and edge inset do not change joystick travel. Action size changes only the visible/touch pad, not game distance.</p>
      <div id="developer-control-defaults" class="developer-controls" hidden><button id="save-code-default" class="editor-wide-button" type="button">Save as Code Default</button><p class="hint">Developer mode: use this layout for new devices and Reset Layout.</p><p id="control-default-status" class="control-default-status" role="status" aria-live="polite"></p></div>
      <div class="editor-actions"><button id="reset-controls" type="button">Reset Layout</button><button id="done-controls" type="button">Done</button></div>
    </div>
  </main>
  <div id="match-overlay" class="match-overlay" role="dialog" aria-live="polite" aria-label="Match state">
    <div id="ready-screen" class="match-card"><div class="section-kicker">CAPTURE THE FLAG</div><h2>WALL BALL</h2><div class="instruction-grid">
      <div><b>◆ Objective</b><span>Steal the enemy gem and bring it to your base.</span></div>
      <div><b>✥ Move</b><span>Touch and drag anywhere in your movement corner.</span></div>
      <div><b>▣ Build</b><span>Drag Wall to preview. Release to build; return to center to cancel.</span></div>
      <div><b>● Bomb</b><span>Drag to aim and set distance. Release to throw; return to center to cancel.</span></div>
      <div><b>✦ Center</b><span>Depots give walls and bombs. Power-ups appear in the contested middle.</span></div>
      <div><b>↔ Defend</b><span>Tag an invader to return your flag and potentially steal resources.</span></div>
    </div><button id="start-game" class="match-primary" type="button">START GAME</button></div>
    <div id="results-screen" class="match-card" hidden><div class="section-kicker">MATCH COMPLETE</div><h2 id="winner-heading"></h2><div id="match-duration" class="match-duration"></div><div id="results-table" class="results-table"></div><div class="results-actions"><button id="play-again" class="match-primary" type="button">PLAY AGAIN</button><button id="results-menu" type="button">MENU</button></div></div>
  </div>
  <div id="developer-confirm" class="developer-confirm" hidden role="alertdialog" aria-modal="true" aria-labelledby="developer-confirm-title" aria-describedby="developer-confirm-message"><div class="developer-confirm-card"><h2 id="developer-confirm-title">Save game default?</h2><p id="developer-confirm-message"></p><div class="editor-actions"><button id="developer-cancel" type="button">Cancel</button><button id="developer-accept" type="button">Yes, change code</button></div></div></div>
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
const matchOverlay = document.querySelector<HTMLDivElement>('#match-overlay')!;
const readyScreen = document.querySelector<HTMLDivElement>('#ready-screen')!;
const resultsScreen = document.querySelector<HTMLDivElement>('#results-screen')!;
const debugEnabled = new URLSearchParams(location.search).has('debug');
let touchController: TouchControls;
const visibleAbilitySlots: Record<Team, boolean> = { red: false, blue: false };

function refreshAbilityControls(): void {
  for (const team of ['red', 'blue'] as const) {
    const visible = editingControls || game.powerUps.players[team].charges['mega-bomb'] > 0;
    if (visible !== visibleAbilitySlots[team]) {
      visibleAbilitySlots[team] = visible;
      touchController.setActionSlots(team, visible ? [...actionSlots, megaActionSlot] : actionSlots);
    }
  }
}

function updateInventoryUi(): void {
  refreshAbilityControls();
  for (const team of ['red', 'blue'] as const) {
    for (const item of ['wall', 'bomb'] as const) {
      document.querySelector<HTMLElement>(`#${team}-${item}-count`)!.textContent =
        String(game.deployments.inventory[team][item]);
    }
    touchController.setInventory(team, { ...game.deployments.inventory[team], 'mega-bomb': game.powerUps.players[team].charges['mega-bomb'] });
  }
}

function updateUi(): void {
  const phase = game.match.phase;
  status.classList.toggle('winner', phase === 'finished');
  status.innerHTML = phase === 'finished'
    ? `<span class="status-kicker">MATCH COMPLETE</span><strong>${game.match.winner?.toUpperCase()} WINS</strong>`
    : `<span class="status-kicker">${editing || editingControls ? 'EDITOR ACTIVE' : phase === 'ready' ? 'READY' : 'MATCH LIVE'}</span><strong>${editing ? 'Customize Arena' : editingControls ? 'Customize Controls' : phase === 'ready' ? 'Start when both players are ready.' : game.state.event}</strong>`;
  matchOverlay.hidden = editing || editingControls || phase === 'playing';
  readyScreen.hidden = phase !== 'ready';
  resultsScreen.hidden = phase !== 'finished';
  if (phase === 'finished') updateResultsUi();
  editButton.textContent = editing ? 'Play Arena' : 'Customize Arena';
  controlsButton.textContent = editingControls ? 'Done Controls' : 'Customize Controls';
  document.querySelector('#mode-label')!.textContent = editing ? 'CUSTOMIZE ARENA' : editingControls ? 'CUSTOMIZE CONTROLS' : 'MATCH / CAPTURE THE FLAG';
  playPanel.hidden = editing || editingControls;
  editPanel.hidden = !editing;
  controlsPanel.hidden = !editingControls;
  const wall = selectedWall();
  const depot = selectedDepot();
  const flag = selectedFlag();
  const region = selectedPowerRegion();
  const toolNames: Record<PlacementTool, string> = {
    wood: 'Wood Wall', stone: 'Stone Wall', 'wall-depot': 'Wall Depot', 'bomb-depot': 'Bomb Depot', 'power-region': 'Power-Up Region',
  };
  selection.textContent = editorMessage || (placementTool ? `Tap arena to place ${toolNames[placementTool]}` :
    wall ? `${WALL_TYPES[wall.type].label} wall · ${WALL_TYPES[wall.type].maxHealth} HP` :
    depot ? `${depot.type === 'wall' ? 'Wall' : 'Bomb'} depot · radius ${depot.radius.toFixed(2)} · holds ${depot.capacity}` :
    region ? `Power-up region · ${(region.bounds.maxX - region.bounds.minX).toFixed(1)} × ${(region.bounds.maxZ - region.bounds.minZ).toFixed(1)}` :
    flag ? `${flag.toUpperCase()} flag + base · drag to move` : 'Choose an object or tap one to select');
  for (const [tool, id] of [['wood', 'add-wood'], ['stone', 'add-stone'], ['wall-depot', 'add-wall-depot'], ['bomb-depot', 'add-bomb-depot'], ['power-region', 'add-power-region']] as const) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`)!;
    button.setAttribute('aria-pressed', String(placementTool === tool));
  }
  document.querySelector<HTMLElement>('#cancel-placement')!.hidden = !placementTool;
  document.querySelector<HTMLElement>('#wall-options')!.hidden = !wall || !!placementTool;
  document.querySelector<HTMLElement>('#depot-options')!.hidden = !depot || !!placementTool;
  document.querySelector<HTMLElement>('#flag-options')!.hidden = !flag || !!placementTool;
  document.querySelector<HTMLElement>('#power-region-options')!.hidden = !region || !!placementTool;
  if (depot) document.querySelector<HTMLInputElement>('#depot-capacity')!.value = String(depot.capacity);
  touchControls.hidden = editing || (!touchVisible && !editingControls) || menuOpen || portraitBlocked || (phase !== 'playing' && !editingControls);
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

function updateResultsUi(): void {
  const winner = game.match.winner!;
  const heading = document.querySelector<HTMLElement>('#winner-heading')!;
  heading.textContent = `${winner.toUpperCase()} WINS!`;
  heading.dataset.team = winner;
  const seconds = Math.floor(game.match.duration);
  document.querySelector<HTMLElement>('#match-duration')!.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const red = game.match.stats.red;
  const blue = game.match.stats.blue;
  document.querySelector<HTMLElement>('#results-table')!.innerHTML = [
    ['WALL BALL', 'RED', 'BLUE'], ['Walls', red.wallsPlaced, blue.wallsPlaced],
    ['Bombs', red.bombsThrown, blue.bombsThrown], ['Broken', red.wallsDestroyed, blue.wallsDestroyed],
    ['Powers', red.powerUpsCollected, blue.powerUpsCollected], ['Stolen', red.resourcesStolen, blue.resourcesStolen],
  ].map(row => row.map(value => `<span>${value}</span>`).join('')).join('');
}

function saveAndRefresh(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arena));
  if (editing) syncArenaSizeInputs();
  view.rebuildArena(arena, selectedId);
  updateUi();
}

function resetMatch(): void {
  touchController.cancelAll();
  keyboardOwned.clear();
  game = new Game(arena, mode, Math.random, gameSettings);
  lastTheftSequence = 0;
  toastUntil = 0;
  touchMove.red = { x: 0, z: 0 };
  touchMove.blue = { x: 0, z: 0 };
  updateUi();
}

function startMatch(): void {
  if (editingControls) finishControlsCustomization();
  if (editing) editButton.click();
  held.clear();
  keyboardOwned.clear();
  touchController.cancelAll();
  touchMove.red = { x: 0, z: 0 };
  touchMove.blue = { x: 0, z: 0 };
  if (game.match.phase !== 'ready') resetMatch();
  game.start();
  menuOpen = false;
  accumulator = 0;
  updateUi();
}
document.querySelector<HTMLButtonElement>('#start-game')!.addEventListener('click', startMatch);
document.querySelector<HTMLButtonElement>('#play-again')!.addEventListener('click', () => { resetMatch(); menuOpen = false; updateUi(); });
document.querySelector<HTMLButtonElement>('#results-menu')!.addEventListener('click', () => { resetMatch(); setMenuOpen(true); });
document.querySelector<HTMLButtonElement>('#new-match-button')!.addEventListener('click', startMatch);

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
  else syncArenaSizeInputs();
  view.rebuildArena(arena);
  updateUi();
});
function syncControlSettings(): void {
  const layout = touchController.getLayout();
  const movement = selectedControl.endsWith('-move');
  document.querySelector<HTMLElement>('#selected-control')!.textContent = selectedControl.replace('-', ' ').toUpperCase();
  document.querySelector<HTMLElement>('#pad-size-label')!.textContent = movement ? 'Joystick visual size' : 'Action pad size';
  document.querySelector<HTMLInputElement>('#pad-size')!.min = String(CONTROL_SIZE_RANGE.min);
  document.querySelector<HTMLInputElement>('#pad-size')!.max = String(CONTROL_SIZE_RANGE.max);
  document.querySelector<HTMLInputElement>('#pad-size')!.value = String(layout.sizes[selectedControl]);
  document.querySelector<HTMLInputElement>('#float-radius')!.value = String(layout.floatRadii[selectedControl]);
  document.querySelector<HTMLOutputElement>('#pad-size-value')!.textContent = `${layout.sizes[selectedControl]}px`;
  document.querySelector<HTMLOutputElement>('#float-radius-value')!.textContent = `${layout.floatRadii[selectedControl]}px`;
  document.querySelector<HTMLElement>('#move-area-setting')!.hidden = !movement;
  document.querySelector<HTMLElement>('#move-inset-setting')!.hidden = !movement;
  document.querySelector<HTMLElement>('#float-radius-setting')!.hidden = movement;
  if (movement) {
    const id = selectedControl as 'red-move' | 'blue-move';
    document.querySelector<HTMLInputElement>('#move-area')!.value = String(layout.moveAreas[id]);
    document.querySelector<HTMLInputElement>('#move-inset')!.value = String(layout.moveInsets[id]);
    document.querySelector<HTMLOutputElement>('#move-area-value')!.textContent = `${layout.moveAreas[id]}px`;
    document.querySelector<HTMLOutputElement>('#move-inset-value')!.textContent = `${layout.moveInsets[id]}px`;
  }
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

type MovementTuningField = 'runSpeed' | 'acceleration' | 'braking' | 'playerMass';
type ProjectileTuningField = keyof ProjectileTuning;
type ResourceTuningField = 'startingInventory' | 'passiveRegenSeconds' | 'depotGenerationSeconds';
type TuningRow =
  | { label: string; field: MovementTuningField; kind?: undefined; groupStart?: boolean }
  | { label: string; field: ProjectileTuningField; kind: keyof GameSettings['projectiles']; groupStart?: boolean }
  | { label: string; field: ResourceTuningField; resource: 'wall' | 'bomb'; kind?: undefined; groupStart?: boolean };
const tuningRows: TuningRow[] = [
  { label: 'Player run speed', field: 'runSpeed' },
  { label: 'Start acceleration', field: 'acceleration' },
  { label: 'Stopping brake', field: 'braking' },
  { label: 'Player weight', field: 'playerMass' },
  { label: 'Starting walls', field: 'startingInventory', resource: 'wall', groupStart: true },
  { label: 'Starting bombs', field: 'startingInventory', resource: 'bomb' },
  { label: 'Wall auto-regeneration (sec)', field: 'passiveRegenSeconds', resource: 'wall' },
  { label: 'Bomb auto-regeneration (sec)', field: 'passiveRegenSeconds', resource: 'bomb' },
  { label: 'Wall depot generation (sec)', field: 'depotGenerationSeconds', resource: 'wall' },
  { label: 'Bomb depot generation (sec)', field: 'depotGenerationSeconds', resource: 'bomb' },
  ...Object.keys(DEFAULT_GAME_SETTINGS.projectiles).flatMap(id => {
    const kind = id as keyof GameSettings['projectiles'];
    const name = id === 'mega-bomb' ? 'Mega Bomb' : id.charAt(0).toUpperCase() + id.slice(1).replaceAll('-', ' ');
    return ([
      { label: `${name} throw force`, kind, field: 'throwForce', groupStart: true },
      { label: `${name} lob`, kind, field: 'lob' },
      { label: `${name} weight`, kind, field: 'mass' },
      { label: `${name} blast radius`, kind, field: 'blastRadius' },
    ] satisfies TuningRow[]);
  }),
];
const settingsPanel = document.querySelector<HTMLElement>('#game-settings-panel')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#game-settings-button')!;
const sliders = document.querySelector<HTMLElement>('#game-settings-sliders')!;
function tuningValue(row: typeof tuningRows[number]): number {
  if ('resource' in row) return gameSettings[row.field][row.resource];
  return row.kind ? gameSettings.projectiles[row.kind][row.field] : gameSettings[row.field];
}
function refreshTuningSliders(): void {
  for (const [index, row] of tuningRows.entries()) {
    const input = document.querySelector<HTMLInputElement>(`#tuning-${index}`)!;
    input.value = String(tuningValue(row));
    document.querySelector<HTMLOutputElement>(`#tuning-value-${index}`)!.value = tuningValue(row).toFixed(2).replace(/\.00$/, '');
  }
}
for (const [index, row] of tuningRows.entries()) {
  const range = GAME_SETTING_RANGES[row.field];
  const label = document.createElement('label');
  label.className = `control-setting${row.groupStart ? ' tuning-group-start' : ''}`;
  label.innerHTML = `<span>${row.label}</span><output id="tuning-value-${index}"></output><input id="tuning-${index}" type="range" min="${range.min}" max="${range.max}" step="${range.step}">`;
  sliders.append(label);
  label.querySelector('input')!.addEventListener('input', event => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if ('resource' in row) gameSettings[row.field][row.resource] = value;
    else if (row.kind) gameSettings.projectiles[row.kind][row.field] = value;
    else gameSettings[row.field] = value;
    game.setSettings(gameSettings);
    localStorage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(gameSettings));
    refreshTuningSliders();
  });
}
refreshTuningSliders();
settingsButton.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsButton.setAttribute('aria-expanded', String(!settingsPanel.hidden));
  if (!settingsPanel.hidden) settingsPanel.scrollIntoView({ block: 'nearest' });
});
document.querySelector<HTMLButtonElement>('#done-game-settings')!.addEventListener('click', () => {
  settingsPanel.hidden = true;
  settingsButton.setAttribute('aria-expanded', 'false');
});
document.querySelector<HTMLButtonElement>('#reset-game-settings')!.addEventListener('click', () => {
  gameSettings = structuredClone(DEFAULT_GAME_SETTINGS);
  game.setSettings(gameSettings);
  localStorage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(gameSettings));
  refreshTuningSliders();
});

function confirmCodeDefault(file: string, title: string): Promise<boolean> {
  const overlay = document.querySelector<HTMLElement>('#developer-confirm')!;
  document.querySelector<HTMLElement>('#developer-confirm-title')!.textContent = title;
  document.querySelector<HTMLElement>('#developer-confirm-message')!.textContent =
    `Are you sure? This alters the game code by writing ${file}. New devices and Reset will use this preset.`;
  overlay.hidden = false;
  const cancel = document.querySelector<HTMLButtonElement>('#developer-cancel')!;
  const accept = document.querySelector<HTMLButtonElement>('#developer-accept')!;
  cancel.focus();
  return new Promise(resolve => {
    const finish = (approved: boolean) => {
      overlay.hidden = true;
      cancel.removeEventListener('click', onCancel);
      accept.removeEventListener('click', onAccept);
      document.removeEventListener('keydown', onKey);
      resolve(approved);
    };
    const onCancel = () => finish(false);
    const onAccept = () => finish(true);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); finish(false); } };
    cancel.addEventListener('click', onCancel);
    accept.addEventListener('click', onAccept);
    document.addEventListener('keydown', onKey);
  });
}
if (import.meta.env.DEV) {
  document.querySelector<HTMLElement>('#developer-control-defaults')!.hidden = false;
  document.querySelector<HTMLElement>('#developer-game-defaults')!.hidden = false;
  document.querySelector<HTMLElement>('#developer-arena-defaults')!.hidden = false;
  document.querySelector<HTMLButtonElement>('#save-code-default')!.addEventListener('click', async () => {
    if (!await confirmCodeDefault('src/input/mobileControlDefaults.json', 'Save control default?')) return;
    const button = document.querySelector<HTMLButtonElement>('#save-code-default')!;
    const status = document.querySelector<HTMLElement>('#control-default-status')!;
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      const response = await fetch('/__dev/control-defaults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(touchController.getLayout()),
      });
      if (response.status === 404) throw new Error('Save route unavailable. Restart npm run dev, then reload this page.');
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      status.textContent = 'Saved in src/input/mobileControlDefaults.json. New devices and Reset Layout use this preset.';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not save layout';
    } finally { button.disabled = false; }
  });
  document.querySelector<HTMLButtonElement>('#save-game-default')!.addEventListener('click', async () => {
    if (!await confirmCodeDefault('src/game/gameSettingsDefaults.json', 'Save game default?')) return;
    const button = document.querySelector<HTMLButtonElement>('#save-game-default')!;
    const status = document.querySelector<HTMLElement>('#game-default-status')!;
    button.disabled = true;
    status.textContent = 'Saving…';
    sessionStorage.setItem(GAME_DEFAULT_SAVED_KEY, '1');
    try {
      const response = await fetch('/__dev/game-defaults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gameSettings),
      });
      if (response.status === 404) throw new Error('Save route unavailable. Restart npm run dev, then reload this page.');
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      status.textContent = 'Saved in src/game/gameSettingsDefaults.json. New devices and Reset Tuning use this preset after reload.';
    } catch (error) {
      sessionStorage.removeItem(GAME_DEFAULT_SAVED_KEY);
      status.textContent = error instanceof Error ? error.message : 'Could not save defaults';
    }
    finally { button.disabled = false; }
  });
  document.querySelector<HTMLButtonElement>('#save-arena-default')!.addEventListener('click', async () => {
    if (!await confirmCodeDefault('src/game/arenaDefaults.json', 'Save default map?')) return;
    const button = document.querySelector<HTMLButtonElement>('#save-arena-default')!;
    const status = document.querySelector<HTMLElement>('#arena-default-status')!;
    button.disabled = true;
    status.textContent = 'Saving…';
    sessionStorage.setItem(ARENA_DEFAULT_SAVED_KEY, '1');
    try {
      const response = await fetch('/__dev/arena-defaults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arena),
      });
      if (response.status === 404) throw new Error('Save route unavailable. Restart npm run dev, then reload this page.');
      if (!response.ok) throw new Error(`Save failed (${response.status})`);
      status.textContent = 'Saved as the default map. New devices and Reset Arena use it after reload.';
    } catch (error) {
      sessionStorage.removeItem(ARENA_DEFAULT_SAVED_KEY);
      status.textContent = error instanceof Error ? error.message : 'Could not save map';
    } finally { button.disabled = false; }
  });
}
for (const [selector, key] of [['#pad-size', 'sizes'], ['#float-radius', 'floatRadii']] as const) {
  document.querySelector<HTMLInputElement>(selector)!.addEventListener('input', event => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    const layout = touchController.getLayout();
    layout[key][selectedControl] = value;
    touchController.setLayout(layout);
    persistControlLayout(touchController.getLayout());
  });
}
for (const [selector, key] of [['#move-area', 'moveAreas'], ['#move-inset', 'moveInsets']] as const) {
  const slider = document.querySelector<HTMLInputElement>(selector)!;
  slider.min = String(key === 'moveAreas' ? MOVE_AREA_RANGE.min : MOVE_INSET_RANGE.min);
  slider.max = String(key === 'moveAreas' ? MOVE_AREA_RANGE.max : MOVE_INSET_RANGE.max);
  slider.addEventListener('input', () => {
    if (!selectedControl.endsWith('-move')) return;
    const layout = touchController.getLayout();
    layout[key][selectedControl as 'red-move' | 'blue-move'] = Number(slider.value);
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
    ? `${team.toUpperCase()} threw a bomb.` : id === 'mega-bomb'
      ? `${team.toUpperCase()} threw a Mega Bomb.` : `${team.toUpperCase()} built a wall.`;
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
  onMove: (team, input) => { if (!editing && !editingControls && game.match.phase === 'playing') touchMove[team] = input; },
  onAimStart: (team, id) => { if (!editing && !editingControls && game.match.phase === 'playing') game.beginDeployAim(team, id); },
  onAim: (team, id, direction, strength) => { if (!editing && !editingControls && game.match.phase === 'playing') game.updateDeployAim(team, id, direction, strength); },
  onAimRelease: (team, id) => { if (!editing && !editingControls && game.match.phase === 'playing') reportDeployment(team, id, game.releaseDeployAim(team, id)); },
  onAimCancel: (team, id) => game.cancelDeployAim(team, id),
}, loadControlLayout(), persistControlLayout, id => { selectedControl = id; syncControlSettings(); });
const actionSlots: ActionSlot[] = (['wall', 'bomb'] as const).map(id => DEPLOYABLES[id]).map(definition => ({
  id: definition.id, label: definition.label, icon: definition.control.icon, size: definition.control.size,
}));
const megaActionSlot: ActionSlot = { id: 'mega-bomb', label: 'Mega', icon: 'bomb', size: 'secondary', layoutSlot: 'ability-1' };
touchController.setActionSlots('red', actionSlots);
touchController.setActionSlots('blue', actionSlots);

function selectedWall(): WallDefinition | undefined { return arena.walls.find(w => w.id === selectedId); }
function selectedDepot(): DepotDefinition | undefined { return arena.depots.find(d => d.id === selectedId); }
function selectedPowerRegion(): RectRegion | undefined { return arena.powerupSpawnAreas.find(region => region.id === selectedId); }
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
for (const [id, tool] of [['add-wood', 'wood'], ['add-stone', 'stone'], ['add-wall-depot', 'wall-depot'], ['add-bomb-depot', 'bomb-depot'], ['add-power-region', 'power-region']] as const) {
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
  } else if (placementTool === 'power-region') {
    const region: RectRegion = { id: nextArenaObjectId(arena, 'power-region'), bounds: {
      minX: position.x - 2.5, maxX: position.x + 2.5, minZ: position.z - 2.5, maxZ: position.z + 2.5,
    } };
    if (powerUpRegionFitsArena(region, arena)) { arena.powerupSpawnAreas.push(region); selectedId = region.id; }
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
  Object.assign(arena, cloneArena(DEFAULT_ARENA));
  selectedId = null;
  placementTool = null;
  editorMessage = '';
  saveAndRefresh();
  syncArenaSizeInputs();
  view.resizeToContainer(viewport, arena);
});
function syncArenaSizeInputs(): void {
  const limits = minimumArenaDimensions(arena);
  for (const axis of ['width', 'length'] as const) {
    const input = document.querySelector<HTMLInputElement>(`#arena-${axis}`)!;
    const size = axis === 'width' ? arena.bounds.maxX - arena.bounds.minX : arena.bounds.maxZ - arena.bounds.minZ;
    input.min = String(limits[axis]);
    input.value = String(size);
    document.querySelector<HTMLOutputElement>(`#arena-${axis}-value`)!.value = `${size} units`;
  }
  document.querySelector<HTMLElement>('#arena-size-hint')!.textContent =
    `Minimum with current objects: ${limits.width} wide × ${limits.length} long. Move objects inward to shrink further.`;
}
for (const axis of ['width', 'length'] as const) {
  document.querySelector<HTMLInputElement>(`#arena-${axis}`)!.addEventListener('input', event => {
    const size = Number((event.currentTarget as HTMLInputElement).value);
    const width = axis === 'width' ? size : arena.bounds.maxX - arena.bounds.minX;
    const length = axis === 'length' ? size : arena.bounds.maxZ - arena.bounds.minZ;
    const next = resizedArena(arena, width, length);
    if (!next) { syncArenaSizeInputs(); return; }
    Object.assign(arena, next);
    editorMessage = '';
    saveAndRefresh();
    view.resizeToContainer(viewport, arena);
  });
}
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
function resizePowerRegion(axis: 'x' | 'z', change: number): void {
  const region = selectedPowerRegion();
  if (!region) return;
  const old = { ...region.bounds };
  if (axis === 'x') { region.bounds.minX -= change / 2; region.bounds.maxX += change / 2; }
  else { region.bounds.minZ -= change / 2; region.bounds.maxZ += change / 2; }
  if (!powerUpRegionFitsArena(region, arena)) region.bounds = old;
  saveAndRefresh();
}
for (const [id, axis, change] of [
  ['region-width-down', 'x', -0.5], ['region-width-up', 'x', 0.5],
  ['region-depth-down', 'z', -0.5], ['region-depth-up', 'z', 0.5],
] as const) document.querySelector(`#${id}`)!.addEventListener('click', () => resizePowerRegion(axis, change));
document.querySelector('#delete-power-region')!.addEventListener('click', () => {
  if (!selectedPowerRegion()) return;
  arena.powerupSpawnAreas = arena.powerupSpawnAreas.filter(region => region.id !== selectedId);
  selectedId = null;
  saveAndRefresh();
});
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
  const region = selectedPowerRegion();
  const position = selectedWall()?.position ?? selectedDepot()?.position ?? (region ? {
    x: (region.bounds.minX + region.bounds.maxX) / 2, z: (region.bounds.minZ + region.bounds.maxZ) / 2,
  } : flag ? arena.flagPositions[flag] : null);
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
  const region = selectedPowerRegion();
  const old = wall ? { ...wall.position } : depot ? { ...depot.position } : region ? {
    x: (region.bounds.minX + region.bounds.maxX) / 2, z: (region.bounds.minZ + region.bounds.maxZ) / 2,
  } : flag ? { ...arena.flagPositions[flag] } : null;
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
  } else if (region) {
    const previous = { ...region.bounds };
    const dx = position.x - old.x;
    const dz = position.z - old.z;
    region.bounds = { minX: previous.minX + dx, maxX: previous.maxX + dx,
      minZ: previous.minZ + dz, maxZ: previous.maxZ + dz };
    if (!powerUpRegionFitsArena(region, arena)) region.bounds = previous;
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
  Space: ['red', 'wall'], KeyE: ['red', 'bomb'], KeyQ: ['red', 'mega-bomb'],
  Enter: ['blue', 'wall'], ShiftRight: ['blue', 'bomb'], KeyP: ['blue', 'mega-bomb'],
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
  game.updateDeployAim(team, id, direction, id !== 'wall' ? keyboardThrowStrength[team] : 0.67);
}
canvas.addEventListener('wheel', event => {
  if (editing || editingControls || game.match.phase !== 'playing') return;
  const team = keyboardOwned.has('KeyE') || keyboardOwned.has('KeyQ') ? 'red'
    : keyboardOwned.has('ShiftRight') || keyboardOwned.has('KeyP') ? 'blue' : null;
  if (!team) return;
  event.preventDefault();
  keyboardThrowStrength[team] = Math.max(AIM_DEAD_ZONE + 0.02,
    Math.min(1, keyboardThrowStrength[team] - Math.sign(event.deltaY) * 0.06));
  keyboardAim(team, keyboardOwned.has(team === 'red' ? 'KeyQ' : 'KeyP') ? 'mega-bomb' : 'bomb');
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
  if (!editing && game.match.phase !== 'playing') {
    if (event.code === 'Enter') {
      event.preventDefault();
      if (game.match.phase === 'ready') startMatch();
      else { resetMatch(); menuOpen = false; updateUi(); }
    }
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
    else if (selectedPowerRegion()) document.querySelector<HTMLButtonElement>('#delete-power-region')!.click();
  }
  if (editing || event.repeat) return;
  if (event.code === 'Escape') {
    game.cancelDeployAim('red');
    game.cancelDeployAim('blue');
    keyboardOwned.clear();
  }
  const action = actionKeys[event.code];
  if (action) {
    if (game.deployments.aim[action[0]][action[1]]) return;
    game.beginDeployAim(action[0], action[1]);
    keyboardOwned.add(event.code);
    keyboardAim(action[0], action[1]);
  }
});
window.addEventListener('keyup', event => {
  if (menuOpen || portraitBlocked || editingControls || game.match.phase !== 'playing') {
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
  if (game.match.phase === 'playing' && !editing && !editingControls) accumulator += Math.min((now - previous) / 1000, 0.1);
  else accumulator = 0;
  previous = now;
  if (!editing && !editingControls && game.match.phase === 'playing') {
    while (accumulator >= 1 / 60) {
      game.update(1 / 60, input());
      accumulator -= 1 / 60;
      if (game.match.winner !== null) {
        held.clear();
        keyboardOwned.clear();
        touchController.cancelAll();
        touchMove.red = { x: 0, z: 0 };
        touchMove.blue = { x: 0, z: 0 };
        accumulator = 0;
        updateUi();
        break;
      }
    }
    for (const code of game.match.phase === 'playing' ? keyboardOwned : []) {
      const [team, id] = actionKeys[code];
      if (held.has(code) && game.deployments.aim[team][id]) keyboardAim(team, id);
    }
  } else accumulator = 0;
  if (game.state.event !== lastEvent) { lastEvent = game.state.event; updateUi(); }
  const inventory = JSON.stringify([game.deployments.inventory,
    game.powerUps.players.red.charges, game.powerUps.players.blue.charges]);
  if (inventory !== lastInventory) { lastInventory = inventory; updateInventoryUi(); }
  if (game.lastTheft && game.lastTheft.sequence !== lastTheftSequence) {
    lastTheftSequence = game.lastTheft.sequence;
    gameToast.textContent = game.lastTheft.text;
    toastUntil = now + 2400;
  }
  gameToast.hidden = editing || now > toastUntil;
  if (debugEnabled && now - lastDebug > 250) {
    lastDebug = now;
    const teamLine = (team: Team) => `${team.toUpperCase()} ${game.economy.territory[team]}  W:${game.deployments.inventory[team].wall} B:${game.deployments.inventory[team].bomb}  passive:${game.economy.passiveBombRemaining[team].toFixed(1)}s  speed:${game.powerUps.players[team].speedRemaining.toFixed(1)}s shield:${game.powerUps.players[team].shieldRemaining.toFixed(1)}s mega:${game.powerUps.players[team].charges['mega-bomb']}`;
    debugPanel.textContent = [teamLine('red'), teamLine('blue'),
      `power-ups: next ${game.powerUps.nextSpawnRemaining.toFixed(1)}s active ${game.powerUps.active.length} rejected ${JSON.stringify(game.powerUps.rejected)}`,
      ...game.powerUps.active.map(pickup => `${pickup.definitionId} ${pickup.id} (${pickup.position.x.toFixed(1)}, ${pickup.position.z.toFixed(1)}) ${pickup.remaining.toFixed(1)}s`),
      ...game.economy.depots.map(d => `${d.type} depot ${d.id}: stock ${d.stock}/${d.capacity}, next ${d.generationRemaining.toFixed(1)}s`),
      ...game.deployments.walls.map(w => `${w.id}: ${w.type} ${w.hp}/${WALL_TYPES[w.type].maxHealth} HP`),
    ].join('\n');
  }
  view.sync(game.state, arena, editing, game.deployments, game.economy, game.powerUps);
  requestAnimationFrame(frame);
}
refreshPortraitState();
refreshFullscreenUi();
if (sessionStorage.getItem(GAME_DEFAULT_SAVED_KEY) === '1') {
  sessionStorage.removeItem(GAME_DEFAULT_SAVED_KEY);
  menuOpen = true;
  settingsPanel.hidden = false;
  settingsButton.setAttribute('aria-expanded', 'true');
  document.querySelector<HTMLElement>('#game-default-status')!.textContent =
    'Saved as the game default. New devices and Reset Tuning use this preset.';
  updateUi();
}
if (sessionStorage.getItem(ARENA_DEFAULT_SAVED_KEY) === '1') {
  sessionStorage.removeItem(ARENA_DEFAULT_SAVED_KEY);
  editing = true;
  syncArenaSizeInputs();
  document.querySelector<HTMLElement>('#arena-default-status')!.textContent =
    'Saved as the default map. New devices and Reset Arena use this layout and size.';
  updateUi();
}
requestAnimationFrame(frame);
