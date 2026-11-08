# Path Precision Tools

Affinity ports of VectorCraft's Path Precision Tools plugin category —
scripts that cut, extend, or add anchors to the selected paths' geometry.

Most of VectorCraft's own Path Precision Tools add-on is an interactive
toolbox (an Anchor Eraser Brush, a Corner Tool, a Parametric Shape tool, and
others) and a live-updating Anchor Inspector panel — none of which a script
can reproduce, since Affinity's scripting SDK can only run a dialog and
apply a command, not add a persistent on-canvas tool or a panel bound to
whatever node is currently selected. The four scripts here are the add-on's
one-shot, dialog-driven commands: the parts of it that *are* reachable from
a script, and that nothing already built into Affinity already covers in
one command (see each script's own guide for the specific native command it
was checked against, where one exists).

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
| [`divide-into-dashes.js`](divide-into-dashes.md) | Cuts the selected paths into separate open pieces of a set length, with a gap between them. |
| [`add-anchors.js`](add-anchors.md) | Adds a chosen number of new anchors to each selected path, spaced evenly, without changing its shape. |
| [`split-at-anchors.js`](split-at-anchors.md) | Splits the selected paths into separate open pieces at their corners, or at every anchor. |
| [`extend-path.js`](extend-path.md) | Lengthens the open end(s) of each selected open path by a set amount, straight along its own direction. |

See each script's own `.md` guide (linked above) for its full Purpose, How
it works, Features, Usage tips, Known limitations, and Changelog.

## Files

- `*.js` — the scripts themselves (see each file's header for its version)
- `*.md` — each script's full guide
- `README.md` — this file

## Known Limitations

A few things apply across more than one script in this category; see each
script's own guide for the full reasoning behind each:

- **Every script here produces its multiple pieces as separate open
  subpaths within the original compound-path object, not as separate
  top-level layer objects.** This SDK's `DocumentCommand.createSetCurves`
  (rewriting a selected object's own curve data) is a well-tested operation
  already proven elsewhere in this repo; bulk creation and deletion of new
  layer objects, at the piece counts these scripts can produce, is not.
- **Parametric shapes** (rectangles, ellipses, stars, etc.) are left out of
  every script here — convert them to curves first (**Layer > Convert to
  Curves**).
- **None of these scripts could be tested against a live Affinity session**
  while writing them (the Affinity MCP connection used elsewhere in this
  project's development wasn't available this session). Each one reuses
  this repo's own already-proven curve-geometry helpers (from
  `artwork-cleanup/simplify-anchors.js`) wherever possible, and the new
  geometry each one adds (De Casteljau subdivision, arc-length sampling) is
  standard, dependency-free math reasoned through carefully - but please
  verify each on a real document before relying on it for production work,
  and report back anything that doesn't behave as documented.

## Not ported

Everything else in VectorCraft's Path Precision Tools add-on was left out,
each for a specific reason:

- **Anchor Eraser Brush, Extend Path (tool), Measure & Inspect, Parametric
  Shape Tool, Slide Anchor Along Path, Shared Edge Merge Tool** — all
  interactive, on-canvas tools; not reachable from a script.
- **The Anchor Inspector / Parametric Shape / Corners / Shared Edges
  panels** — live, selection-bound panels; not reachable from a script.
- **Corner Tool** — Affinity already has its own native Corner Tool, with
  more corner kinds (Rounded, Straight, Concave, Cutout) than VectorCraft's,
  live and editable, on arbitrary paths.
- **Reverse Direction, Close Path, Smooth Anchors, Retract Handles** — each
  already one click away in Affinity's own Node tool (Reverse Curve, Close
  Curve, Convert: Smooth, Convert: Sharp).
- **Simplify Anchors** — already ported, from a different VectorCraft
  category, as `artwork-cleanup/simplify-anchors.js`.
- **Set Corners…** and **Add Points at / Split at Crossings** — set aside
  for now rather than ruled out: Set Corners' core job already has a native
  one-tool answer (see above), and Add Points at Crossings needs a robust
  Bezier-Bezier intersection algorithm that's a meaningfully larger, riskier
  piece of work than anything else in this category.

## Requirements

- Affinity by Canva 3.3
- No external dependencies

## License

BSD 3-Clause — see each script's header for license information.
