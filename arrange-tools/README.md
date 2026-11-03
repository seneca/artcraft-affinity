# Arrange Tools

Affinity ports of VectorCraft's Arrange Tools plugin category — layout,
sizing, and stacking-order scripts for the selected objects on a spread.

## Installation

Each script is a single, self-contained `.js` file — no shared modules or
external dependencies. For any script in this folder:

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the script's contents into the editor and press **Run**.
3. To keep it around, click **Save As...** to save it to the Script
   Library (**Window > Scripting > Script Library**), then click it there
   to run it any time.

## Description

| Script | What it does |
|---|---|
| [`arrange-in-grid.js`](arrange-in-grid.md) | Lays the selected objects out in a grid, a single row, or a single column. |
| [`swap-objects.js`](swap-objects.md) | Swaps the places of two selected objects, with optional size and colour swapping. |
| [`replace-with-top-object.js`](replace-with-top-object.md) | Puts a copy of the frontmost selected object on each of the other selected objects. |
| [`set-size-of-each.js`](set-size-of-each.md) | Gives every selected object the same width and/or height, about a chosen reference point. |
| [`randomize-opacity.js`](randomize-opacity.md) | Gives each selected object its own random opacity, within a chosen range. |
| [`sort-objects.js`](sort-objects.md) | Sorts the selected objects by one attribute and gives them another in that order — resize, move, relayer, or fade, plus an equal-physical-spacing option not in the original. |

Every script here runs as a single undo step (except
`replace-with-top-object.js`, see its own guide), live-previews as dialog
fields change (except where noted), and measures objects by their visual
bounds — strokes and effects as drawn — matching how VectorCraft's own
originals measure them.

See each script's own `.md` guide (linked above) for its full Purpose, How
it works, Features, Usage tips, Known limitations, and Changelog.

## Files

- `*.js` — the scripts themselves (see each file's header for its version)
- `*.md` — each script's full guide
- `README.md` — this file

## Known Limitations

A few things apply across more than one script in this category; see each
script's own guide for the full reasoning behind each:

- **Scale Strokes & Effects is always a lasting change** in every script
  that offers it (`swap-objects`, `replace-with-top-object`,
  `set-size-of-each`, `sort-objects`) — unlike VectorCraft's own
  per-operation preference, Affinity's SDK exposes no per-operation or
  document-level override for stroke/effect scaling, only a lasting,
  per-object setting.
- **`replace-with-top-object.js` has no live preview** — a
  duplicate-and-delete compound doesn't revert cleanly via
  `doc.clearPreviews()` on this SDK, confirmed by direct testing.
- **Random seeds are freshly randomized per dialog session**, not tied to
  a document revision counter the way VectorCraft's own hidden defaults
  are — this SDK doesn't expose that counter to scripts.

## Requirements

- Affinity by Canva 3.3
- No external dependencies

## License

BSD 3-Clause — see each script's header for license information.
