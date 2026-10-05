# 3D model pipeline

Wall Ball uses glTF binary (`.glb`) models for optional presentation. Gameplay,
physics, arena editing, and network input use the existing logical dimensions.
Model bounds are fitted **to** those dimensions, never read back into game rules.

## Asset slots

`src/view/AssetRegistry.ts` contains the model slots and their intended paths
under `public/models/`:

| Slot | Suggested file |
| --- | --- |
| player | `characters/Knight.glb` |
| woodWall, stoneWall | `walls/wood.glb`, `walls/stone.glb` |
| bomb, megaBomb | `projectiles/bomb.glb`, `projectiles/mega-bomb.glb` |
| redFlag, blueFlag | `objectives/red-flag.glb`, `objectives/blue-flag.glb` |
| wallDepot, bombDepot | `depots/wall.glb`, `depots/bomb.glb` |
| speedPowerup, shieldPowerup, megaBombPowerup | `powerups/*.glb` |
| scenery/tree, bush, rock, grass, fence | `environment/*.glb` |

Players, walls, and bomb projectiles have model-capable wrappers. Only the
player slot currently has a real model. The other slots keep their primitives.

## First model: KayKit Knight

The player slot uses `public/models/characters/Knight.glb`, with embedded
texture, plus the two compatible `Rig_Medium` animation GLBs under
`public/models/characters/animations/`. No separate texture file is needed.
The imported files are from KayKit Adventurers 2.0 / Character Animations 1.1;
their CC0 license texts are preserved in `docs/licenses/`.

The Knight faces local +Z, so the registry uses zero rotation and offset.
`PlayerVisual` fits it uniformly into a 1.45 × 1.82 × 1.15 visual box; game
colliders and movement values are untouched. The cape and helmet visor receive
the team color as solid material variants, while the rest of the atlas and
character retain their original colors. Existing team ground rings remain.

`Idle_A` and `Running_A` loop. Existing airborne state triggers `Jump_Start`,
then `Jump_Idle`, and landing triggers `Jump_Land`; the one-shot transitions
crossfade with the loops. Run playback follows measured ground distance per clip
cycle, with a brief hold across empty render frames; slow starts and stops no
longer run at a fixed minimum sprint cadence. This is visual-only tuning.
Replay resets the animation state without creating another mixer; theme rebuilds
stop actions and release the old mixer. The same semantic visual layer can later
trigger `Throw`, `Hit_A`/`Hit_B`, and `PickUp` when presentation events are wired.
No gameplay event or rule was added for them in this pass.

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

Name tintable clothing/accessory materials `TEAM_ACCENT` where the art permits.
For shared texture atlases like Knight, list specific mesh names in the
registry's `teamAccentMeshes`; only those meshes receive the team color. Material
variants are cached. Animation clips may live inside the character GLB or in
extra files listed under `animations.files`; map their names in the registry.
`PlayerVisual` owns the optional `AnimationMixer`; missing clips leave the model
static or use the available states.

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
