# 3D model pipeline

Wall Ball uses glTF binary (`.glb`) models for optional presentation. Gameplay,
physics, arena editing, and network input use the existing logical dimensions.
Model bounds are fitted **to** those dimensions, never read back into game rules.

## Asset slots

`src/view/AssetRegistry.ts` contains the model slots and their intended paths
under `public/models/`:

| Slot | Suggested file |
| --- | --- |
| player | `characters/player.glb` |
| woodWall, stoneWall | `walls/wood.glb`, `walls/stone.glb` |
| bomb, megaBomb | `projectiles/bomb.glb`, `projectiles/mega-bomb.glb` |
| redFlag, blueFlag | `objectives/red-flag.glb`, `objectives/blue-flag.glb` |
| wallDepot, bombDepot | `depots/wall.glb`, `depots/bomb.glb` |
| speedPowerup, shieldPowerup, megaBombPowerup | `powerups/*.glb` |
| scenery/tree, bush, rock, grass, fence | `environment/*.glb` |

Only players, walls, and bomb projectiles are mounted in this phase. The other
slots are reserved for later visual passes. No model files are bundled yet; the
existing primitives remain visible.

## Replacing a placeholder with a real model

1. Copy a licensed `.glb` into its suggested path in `public/models/`.
2. Add `file` to that registry slot's options, for example
   `woodWall: slot('walls/wood.glb', { file: 'walls/wood.glb' })`.
3. Adjust `scale`, `rotation` (Euler radians), `offset` (world units), and
   `fit` if needed; reload the game.
4. Compare with **Appearance → Use 3D Models** off and on, including in
   Customize Arena. Commit both the registry edit and `.glb`.

`fit: 'bounds'` scales independently to the logical visual box; `uniform` uses
one scale factor; `native` uses only the configured scale. The loader centers
X/Z and puts the asset bottom at the logical ground anchor, then applies
offset. Export characters facing local **+Z**. A rotation correction belongs
in the registry, not in movement code.

Name just the tintable clothing/accessory material `TEAM_ACCENT` in the GLB.
Only that material receives the Red/Blue color. A material variant is cached
for each team color, and all other materials retain the artist's colors. For
animation, name clips `idle`, `run`, and `airborne`, or change the registry's
semantic name mapping. `PlayerVisual` owns the optional `AnimationMixer`;
missing clips simply leave the model static.

`ModelLibrary` loads each URL once, caches the glTF, clones its scene for each
entity (including skinned meshes), and shares source geometry/materials. It
keeps primitive visuals until loading succeeds. Missing files, failed loads,
and the model toggle retain primitives. Model disposal does not dispose shared
glTF resources. Keep models low poly and material counts small for tablets;
repeated scenery can use instancing when that visual pass begins. Shadow
casting/receiving is configured per slot.

Paths must be relative to `public/models/`. `ModelLibrary` prefixes Vite's
`import.meta.env.BASE_URL`, so development loads `/models/...` and GitHub Pages
loads `/wall-ball-reborn/models/...`. Do not use root-relative `/models/...`
URLs in registry entries or in GLB external resource references. Prefer
self-contained GLBs with embedded textures.
