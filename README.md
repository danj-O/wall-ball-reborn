# Wall Ball Reborn

A local, shared-camera, two-player Capture the Flag prototype built with TypeScript and Three.js. The older Unity `Wall-Ball` project was used as a behavioral reference for movement, flag pickup, and returning the objective to base. This project has its own architecture.

## Run

```sh
npm install
npm run dev
```

Open the URL printed by Vite. `npm run build` checks TypeScript and builds the static site. `npm test` runs the core rule and collision tests.

The game uses a fixed viewport with no document scrolling. The **Menu** tab opens the match controls, rules, and inventory without keeping a toolbar across the arena. Its **Enter Fullscreen** action uses the browser API where supported. On browsers that cannot fullscreen a page, **Display Options** explains how to launch the game from the Home Screen instead. The included web app manifest requests a fullscreen landscape presentation for installed launches; actual system-bar behavior depends on the browser and device. On a clearly portrait viewport, a rotate-device prompt covers the game until landscape returns.

## Controls and rules

| Action | Red | Blue |
| --- | --- | --- |
| Move and face | W A S D | Arrow keys |
| Aim deployable | T F G H | I J K L |
| Wall preview / build | Hold Space / release | Hold Enter / release |
| Bomb aim / throw | Hold E / release | Hold right Shift / release |

Hold either action key while aiming to see its placement ghost. Release to act. **Esc** cancels keyboard aiming. Without an aim key, keyboard aiming uses the character's facing direction. Scroll over the arena while holding a bomb key to adjust throw distance.

**Touch Controls** reveals Red movement at top left, Red actions at bottom left, Blue actions at top right, and Blue movement at bottom right. Control labels and icons read upright to players seated at the left and right of the device. Drag either movement pad toward the direction you want to travel on screen: Red moves forward toward the right and Blue moves forward toward the left. Wall and Bomb each have a persistent joystick, icon, and inventory badge. Each touch begins at its own floating origin, and four simultaneous touches are tracked independently. Drag a Wall pad to preview the oriented wall. Drag a Bomb pad to choose direction and distance; its arc and landing marker show the throw. Release away from the origin to act, or drag back to the origin and release to cancel. Invalid ghosts are red and do not spend inventory.

Use **Menu → Customize Controls** to pause the match and drag each of the six touch pads independently. The **Pad size** slider changes their touch targets; **Floating area** changes the drag distance needed for full movement or throw strength. Dashed rings show that response area while editing. **Reset Layout** restores the default arrangement. Control positions and sizes are saved separately from the arena in this browser.

Walk over the enemy flag to pick it up. The carried flag is shown above the player. Walk over the carrier to tag them and send the flag home. Bring the enemy flag to your own colored base to win. **Reset Match** starts a fresh match in the current arena.

Each player also gains one bomb every 10 seconds. The translucent central **Wall Depot** and **Bomb Depot** automatically transfer their stocked resource when a player enters their circle. Stock is shown by small pips beside the depot icon. A defender who touches an invader inside the defender's territory takes half the invader's walls and bombs, rounded down, once per visit. The invader can leave and return to become vulnerable again. This also works when no flag is carried.

**Customize Arena** pauses play and opens a compact editor dock. Choose Wood Wall, Stone Wall, Wall Depot, or Bomb Depot, then tap or click the arena where it should appear. Tap an existing wall, depot, or flag to select it and drag to move it in quarter-unit steps. Options appear for the selected object: rotate or delete a wall, resize/change capacity or delete a depot, or return a flag to its default position. Press **R** to rotate a selected wall and **Delete** to remove a selected wall or depot. Placement and movement must stay within arena bounds and keep walls clear of spawns and flags. Depots are non-solid and may be surrounded by walls. **Reset Arena** restores the flags and a single wall down the center, removing all depots and other walls. Choose **Play Arena** to start a match using that configuration. Edits are saved to local storage in this browser; older saved layouts are migrated. The default depot capacity is 8.

## Architecture

- [`ArenaDefinition`](src/game/arena.ts) is the data model for bounds, spawns, flags, territories, initial typed walls, depots, and allowed regions for future random power-ups. The editor modifies this model; each match copies starting structures from it. Runtime depot stock does not change saved arena data.
- [`Game`](src/game/Game.ts) owns the simulation step, player movement and facing, circle-versus-rotated-wall collision, and match reset. Collision movement advances to contact and slides the remaining motion along the wall face, including diagonals. It accepts plain movement vectors, so input handling is replaceable.
- [`deployables.ts`](src/game/deployables.ts) defines the shared placement, preview, inventory, validation, and deployed-behavior contract. The wall and bomb definitions use it. A bomb travels along a deterministic arc, then starts its two-second fuse on landing. Match walls and bombs live outside `ArenaDefinition`; starting walls are copied into each match so blasts can destroy them without changing the customized layout.
- [`economy.ts`](src/game/economy.ts) owns independent passive bomb timers, depot stock and collection, territory state, and resource transfer. `Game` applies these rules during its fixed simulation step. Match reset recreates all timers and stock.
- [`GameMode`](src/game/GameMode.ts) defines the mode contract and state. [`CaptureTheFlag`](src/game/CaptureTheFlag.ts) is its only implementation and owns pickup, tagging, capture, and win rules.
- [`ArenaView`](src/view/ArenaView.ts) creates dimensional primitive geometry, lights, and soft shadows, then projects simulation state to the screen. The rules modules do not import Three.js.
- [`camera.ts`](src/view/camera.ts) centralizes pitch, yaw, field of view, distance padding, and perspective framing. It fits the entire arena when the viewport changes.
- [`main.ts`](src/main.ts) handles keyboard and pointer input, the editor UI, local storage, and the fixed-step loop.
- [`TouchControls`](src/input/TouchControls.ts) builds action pads from deployable definitions and tracks each pointer by ID. [`controlLayout.ts`](src/input/controlLayout.ts) defines independent normalized positions for all six pads, plus shared pad and floating-area sizes. Player orientation is centralized in `TouchControls`. Touch and keyboard call the same deployment methods in `Game`.

The fixed perspective camera views the entire 3D tabletop from nearly straight above while simulation and editor positions remain on the XZ plane. Pitch, yaw, field of view, and framing remain configurable in `camera.ts`. The simulation runs at 60 steps per second, with a capped frame catch-up interval. Bombs have a 2.5-unit blast radius; each blast deals 50 damage to walls. Open `/?debug=1` for developer-only territory, inventory, timer, depot, and wall HP diagnostics. This phase contains no player damage, actual power-ups, stores, networking, or AI. See [Phase 3 results](PHASE_3_RESULTS.md) for tuning values and design choices.
