# Artwork Cleanup

Affinity ports of VectorCraft's Artwork Cleanup plugin category — scripts
that tidy up path geometry on the selected objects (or, where noted, the
whole document).

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
| [`simplify-anchors.js`](simplify-anchors.md) | Removes as many anchors as it can from each selected path while keeping its outline shape. |
| [`rejoin-path-pieces.js`](rejoin-path-pieces.md) | Welds open path pieces in the selection whose ends lie close together back into continuous paths. |

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
