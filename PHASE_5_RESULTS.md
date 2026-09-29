# Phase 5 — touch acquisition and match flow

## Match flow

`Game.match` owns `ready → playing → finished`, elapsed match time, winner, and per-player statistics. The game starts in **ready**. `Game.start()` begins simulation. `Game.update()` returns immediately in ready and finished, so physics, movement, bombs, depots, passive regeneration, power-up timers, pickups, and CTF scoring stay still. Victory transitions to finished during the scoring update, clears aim sessions, and freezes subsequent updates. Input callbacks and the browser frame loop also gate on playing.

The ready screen gives short CTF and control instructions. The results screen shows winner, duration, and walls placed, bombs thrown, walls destroyed, power-ups collected, and resources stolen by territory tags. A stolen resource is one wall or bomb transferred to the defender. A destroyed wall is credited to the owner of the bomb that dealt its final damage. Mega Bomb throws count as bombs. Results are local to the match and live in gameplay state, not Three.js objects.

**Play Again** resets the complete runtime and returns to ready, with the current `ArenaDefinition` retained. **Start / New Match** in the menu begins a clean game immediately; **Return to Start** returns to ready. Customize Arena and Customize Controls continue through the existing menu. The menu remains available over ready and finished screens.

## Touch dimensions and sensitivity

The movement joystick still appears at touch-down and uses the same screen-direction mapping, drag magnitude, 70 px default travel radius, pointer capture, release-to-zero behavior, and visual knob travel. Only its acquisition rectangle changed. On an 844 × 390 landscape surface, each default movement region is approximately **320 × 187 px**, with a **6 px edge inset**, versus the prior approximately 187 × 187 px cap. Its width is limited to 45% and height to 48% of the surface, leaving separate action corners and a central menu tab. Action pads have higher hit priority than movement regions. Safe-area padding is added to the region inset on devices that report it.

Customize Controls now has separate sliders for movement touch area (150–480 px) and edge inset (0–32 px), per movement side. Its visual pad size remains independently editable. Movement travel radius is deliberately kept at its established value and is no longer exposed for movement in the editor. Saved older layouts gain the new defaults without losing positions, visual sizes, or travel radii. **Reset Layout** restores the larger touch areas.

Action controls retain their existing fixed-pad aiming behavior and travel radius. Their visual/touch size slider now spans **38–280 px**, individually for Wall, Bomb, Mega Bomb, and ability slots. Size does not feed wall placement distance, bomb throw distance, blast radius, or ability strength. The existing Aim Travel control remains separate for actions and changes how far a player drags to reach full aim strength; it does not change the configured maximum gameplay range.

## Verification and review

The test suite covers ready and finished timer freezes, start transition, statistics, victory, replay reset, customized arena retention, movement acquisition geometry and origin/magnitude/clamp math, and action-size independence. `npm test` and `npm run build` pass. There is no lint script in this repository.

The default region is intentionally capped by corner fractions in landscape. Playtesting on actual iPad/iPhone home-screen installs should confirm whether the 320 px default and 6 px inset feel right for hands at opposite sides of the device. Those are configurable in Customize Controls.
