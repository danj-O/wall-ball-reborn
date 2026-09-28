# Phase 2A — Control layout and camera correction

## Implemented

- The shared perspective camera now uses an 88° pitch above the ground and zero yaw. `CAMERA_SETTINGS` remains the single place to tune pitch, yaw, FOV, and framing. Three-dimensional players, walls, bases, flags, plinth, lighting, and soft shadows remain.
- The tablet overlay has four corners: Red movement top left, Red actions bottom left, Blue actions top right, and Blue movement bottom right. Blue's visual controls and input vectors use one centralized 180° orientation setting.
- Each team has persistent Wall and Bomb joysticks with separate icons and inventory counts. Controls with zero inventory stay in place and appear unavailable. Action slots are built from deployable definitions, so additional slots can be registered later.
- Pointer sessions are keyed by pointer ID. Movement and action touches are independent across both teams. Entering Customize Arena cancels active touches and hides the overlay.
- Wall aim retains the oriented placement ghost, invalid state, return-to-center cancellation, and inventory spending only after a valid release.
- Bomb aim maps stick magnitude to configurable throw distance. A translucent landing ghost, ring, and arc preview the target. The bomb follows a deterministic parabolic flight, then starts its existing two-second fuse on landing. Throw parameters and dead zone live in `deployables.ts`.
- Keyboard actions use the same game methods: Space/E for Red Wall/Bomb and Enter/right Shift for Blue Wall/Bomb. Aim keys remain TFGH and IJKL. Mouse wheel changes keyboard bomb distance while the bomb key is held.

## Verification

- `npm test` covers CTF and arena collision, independent aim sessions, magnitude-to-distance mapping, return-to-center cancellation, bomb flight and delayed fuse, and four pointer IDs with Blue orientation.
- `npm run build` checks TypeScript and produces the Vite bundle.
- Browser inspection confirmed the near-top-down 3D arena and four-corner action layout, including opposite-side Blue labels. Customize Arena remains the same XZ-plane wall editor.

## Feel questions for review

- Is 88° the right pitch, or should the view reveal slightly more wall height?
- Are the maximum bomb range (6 units), flight speed (10 units/second), and arc height (1.8 units) comfortable on a tablet?
- Are the primary joystick sizes and spacing comfortable for two people playing simultaneously on the target device?
