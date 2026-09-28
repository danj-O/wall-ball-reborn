# Phase 2 results — deployment controls, walls and bombs

## Implemented

- Raised the configurable shared perspective camera to **66° above horizontal**. Pitch, yaw, FOV, minimum distance and framing padding remain in `src/view/camera.ts`.
- Added a deployable definition contract with an ID, preview shape, range, placement footprint, validation, inventory cost, initial inventory, deployment factory and optional per-step behavior. Wall and bomb are its first two definitions.
- Added keyboard aim/preview/release controls and floating-origin touch movement/deploy pads for both players. A release inside the relative cancel dead zone consumes nothing. Invalid previews appear red and cannot spend inventory.
- Added team-owned, 150 HP walls that block movement and cannot overlap another wall, boundary, player, base/flag, or bomb. Walls have continuous position and rotation; there is no placement grid.
- Added placed bombs with a visible two-second fuse, a 2.5-unit danger ring, and a brief 3D explosion. Each blast deals 50 damage to every wall whose footprint intersects its radius. Bombs never damage players in this phase.
- Added per-player counts and selection for 10 walls and 6 bombs. Counts do not regenerate.
- Kept deployed objects in match state. Starting arena walls are copied into a new match with 150 HP; they can be destroyed during play and return on reset. `ArenaDefinition` and the saved Customize Arena layout are never mutated by deployment or explosions.

## Controls

| | Red | Blue |
| --- | --- | --- |
| Move | W A S D | Arrow keys |
| Aim | T F G H | I J K L |
| Select wall / bomb | 1 / 2 | 8 / 9 |
| Hold to preview, release to place | Space | Enter |

Escape cancels keyboard aiming. Without an aim key, placement follows the player's current facing. Touch controls can be toggled on desktop and appear automatically on coarse-pointer devices. Their start and cancel point follows each touch, even though each pad has a fixed allowed region. The blue pad pair is rotated for opposite-side seating.

## Verification

- `npm test`: **11 passed**. Tests cover successful, cancelled and invalid deployment; inventory; footprint exclusions; runtime wall collision; bomb fuse and explosion lifecycle; damage inside and outside the radius; destruction after three hits; unchanged customized arena data; existing CTF rules; and camera framing.
- `npm run build`: passed TypeScript and Vite production build. Vite reports a non-blocking bundle-size advisory for the Three.js build.
- Browser checked red keyboard placement; red and blue touch placement; bomb fuse/radius visibility; touch cancellation without inventory use; and Customize Arena hiding match-only walls and resetting inventory on return to play.

## Decisions to review

- Bombs are placed rather than thrown, and blasts pass through walls. Damage uses the distance from the bomb to the nearest point on each wall footprint.
- Initial arena walls have the same 150 HP as deployed walls during a match. Their destruction is temporary and does not edit the saved layout.
- Keyboard placement uses a fixed mid-range distance and current facing when no aim key is held. Touch drag length adjusts placement distance continuously.
- The touch HUD uses separate team clusters and an inverted blue orientation for an eventual opposite-side tablet layout. This is a prototype layout, not final tablet UI.

No power-ups, pickups, traps, stores, regeneration, player damage, AI, networking, or polished assets were added.
