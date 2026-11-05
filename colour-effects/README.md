# Colour Effects

Affinity ports of VectorCraft's Colour Effects plugin category — scripts
that work with colour across the selected objects (or, where noted, the
whole document). Several of VectorCraft's own Colour Effects tools
(Duotones, Invert Colours, Exposure, Desaturate) are **not** ported here:
VectorCraft itself treats those as live, non-destructive effects, and
Affinity already has its own native equivalents (Recolour, Invert, Exposure,
Black and White) in its own adjustment layers - there's nothing to port.

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
| [`print-ink-fixes.js`](print-ink-fixes.md) | Scales down over-ink CMYK colours, and sets white/black overprint, across the selection or the whole CMYK document. |
| [`find-nearest-swatch.js`](find-nearest-swatch.md) | Reports the colours already used elsewhere that are closest to each colour in your selection. Adapted - see its guide. |
| [`create-swatch-legend.js`](create-swatch-legend.md) | Draws a grid of labelled chips, one per distinct colour used in the selection or the document. Adapted - see its guide. |

See each script's own `.md` guide (linked above) for its full Purpose, How
it works, Features, Usage tips, Known limitations, and Changelog.

## Files

- `*.js` — the scripts themselves (see each file's header for its version)
- `*.md` — each script's full guide
- `README.md` — this file

## Requirements

- Affinity by Canva 3.3
- No external dependencies

## License

BSD 3-Clause — see each script's header for license information.
