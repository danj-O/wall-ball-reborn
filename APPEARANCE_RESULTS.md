# Warm Meadow visual pass

The global theme is [appearanceDefaults.json](src/view/appearanceDefaults.json). Arena maps remain layout and gameplay definitions. The [appearance schema](src/view/appearance.ts) validates the global default and any browser-stored override; [ArenaView](src/view/ArenaView.ts) consumes it for arena materials, team objects, depots, and lighting. The main UI uses the same team and dark-neutral colors through CSS variables.

| Element | Default |
| --- | --- |
| Field | `#6F9270` |
| Contested center | `#819B68` |
| Outside | `#293B34` |
| Stone | `#D8D0B8` |
| Wood | `#A97546` |
| Sand / neutral accent | `#D4B77A` |
| Red / Blue | `#E85B52` / `#4E9ED6` |
| Dark UI | `#263238` |
| Key light | `#FFF2DF`, intensity `1.5` |
| Ambient sky / ground | `#E9EFE4` / `#77816F`, intensity `0.9` |
| Tone-mapping exposure | `1.1` |

Choose **Menu → Appearance** to tune these values while looking at the arena. Changes persist on that device. **Reset Theme** uses the committed default. On `npm run dev`, **Dev Save as Default** confirms before writing the preset file; the control and write route are absent from the GitHub Pages build. Existing maps and gameplay rules are unchanged.

At the fixed gameplay camera distance, the two wall materials, both team characters/bases, depots, and center strip remain distinct. The visual pass adds no models, textures, geometry, camera changes, or post-processing. Native color pickers and final brightness should still be checked on the target iPad display before playtesting.
