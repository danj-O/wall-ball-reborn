# Arena Editor 2.0 results

The editor now uses `ArenaDefinition` for authored data, a `Set<string>` for editor-only selection, and snapshots for undo/redo. Runtime match walls, bombs, inventories, depot stock, and power-ups remain in game state. A drag records one history entry when released. Pointer cancellation restores the position at touch-down. Only the pointer that began the gesture can move or finish it.

## Touch workflow

1. From the ready screen choose a built-in or local map, then tap **Customize Arena**.
2. Expand **Place Objects**, choose a type, inspect the green/red placement ghost, and tap to place. **Cancel Placement** or Escape backs out.
3. Tap an object to select it. Use **Multi** to toggle objects, or **Box** and drag a rectangle. The box projects both touch points to the XZ plane before testing object centers.
4. Drag any selected object to move the whole group. The D-pad nudges all selected objects by 0.25 arena units. Rotate applies 90° to each selected wall around its own center. Duplicate shifts a copy by the selection's horizontal span plus 3 units. Mirror copies across the arena's X center. Alignment and distribution preserve the selected objects' authored types and IDs.
5. **Undo** and **Redo** restore authored map snapshots. **Save Custom** persists locally. **Done Editing** returns to the ready screen.

The compact editor keeps selection and movement controls at the top. Place, Arena Size, and Maps & Save sections collapse independently. The grid is visible while editing. There is no hover-only action.

## Map data and persistence

Built-in maps live in `src/maps/*.json` as `{ id, name, schemaVersion: 1, arena: ArenaDefinition }`. The build discovers files with Vite's glob loader. `classic.json` is the existing arena. Its source is never mutated by normal play or editing. Entering the editor from a built-in uses an in-memory working copy and creates no chooser entry. **Save Custom** explicitly creates a browser-stored map; existing custom maps autosave on edits. Custom maps are held under `wall-ball-reborn-local-maps-v1`, and the selected map under `wall-ball-reborn-active-map-v1`. The chooser labels project files and device-only maps separately. The former single-arena key migrates to a custom **My Arena** entry, and an intentionally emptied local library does not remigrate it.

**Create New Built-In Map** and **Save Changes to This Built-In** use the development-only `/__dev/maps` endpoint. The endpoint checks same-origin POST, JSON size/type, map schema, full arena validity, and a restricted stable ID before writing only within `src/maps/`. New files use exclusive creation and reject an existing built-in name, so an accidental repeat does not make another project map. Output is deterministic formatted JSON. Production builds have no writer or Dev Save controls. A saved project file is selected in the chooser, survives Vite reload, and must be committed for other devices. New and copied map names use an in-page mobile-friendly dialog; game shortcuts ignore focused text fields.

## Validation and scope

Editor commands propose a full cloned arena and commit only after `validateArenaDefinition` accepts it. This checks bounds, flags/spawns, finite object dimensions, IDs, territories, power-up regions, depot constraints, and rotated wall overlaps. The same validator is used for local persistence, built-in loading, and Dev Save. Failed group operations leave the group unmoved.

Flags may be selected and moved, but duplication, deletion, alignment, distribution, and mirror skip them. Spawn points remain data-driven and validated; they are not directly edited. D-pad taps make separate undo steps. Large deletes (five or more authored objects) ask for confirmation; single deletes do not. Placement preview uses a primitive shape and validity color.

## Physical iPad checks

Check landscape safe-area spacing; Box Select with one finger; group drag and a second simultaneous touch; pointer cancellation after an app switch; D-pad touch targets; whether the collapsed dock leaves enough space to reach objects near the Red base; and the Save As/Dev Save name entry keyboard. Confirm the Home Screen installation still lays out the editor and ready map chooser correctly.
