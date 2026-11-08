# split-at-anchors

Splits every selected path into separate open pieces at either its corners
or every anchor, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `split-at-anchors.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Approximate port of VectorCraft's Path Precision Tools > Split at Anchors
(one of its live Path Effects there). A batch version of Affinity's own
single-node **Break Curve** — instead of clicking through a path's anchors
one at a time, this splits every one that matches a rule across the whole
selection in one pass.

## How it works

1. **Split at** chooses the rule: **Corners Only** splits at anchors where
   the path turns by more than **Corner Angle**; **Every Anchor** splits at
   every one.
2. For a closed path, a split point duplicates that anchor into two
   independent, coincident endpoints — one piece ends there, the next
   starts there — exactly like Break Curve does, so nothing moves and no
   gap opens up; the pieces just stop being connected.
3. An open path's own two ends are never treated as split points — there's
   nothing to split there.
4. Each resulting piece becomes its own open subpath inside the same
   compound path object the original path belonged to (see Known
   limitations).
5. All changes across the whole selection apply as one compound command.

## Features

- **Split at** choice: Corners Only or Every Anchor
- **Corner Angle** field (1–179°), with a popup slider — only meaningful in
  Corners Only mode
- **Live preview** while the piece count is small enough (see Known
  limitations); a line under the fields reports how many pieces the current
  settings would produce
- **Confirms what it did**: on OK, an alert reports how many pieces were
  produced
- **Single undo step**, even across many paths and compound-path subpaths
- Looks inside selected groups and compound paths for paths to split, and
  skips locked, hidden, or parametric (not yet curves) ones

## Usage tips

- Corners Only at a low angle (10–20°) is a quick way to break a hand-drawn
  or traced path into its straighter runs and its tight turns separately.
- Every Anchor fully decomposes a path into its individual segments — handy
  before an operation that only ever looks at one segment at a time, less
  so as an everyday cleanup step since it can produce a lot of pieces fast.

## Known limitations

- **Can't target only the anchors you've selected with the Node tool.**
  Affinity's own SDK exposes no way to read which individual anchors are
  selected within a path from a script — only which whole objects are
  selected — so this always works from a rule (corner angle, or every
  anchor) across the *whole* path rather than letting you hand-pick the
  split points the way Break Curve itself does. Revisit if a future SDK
  version exposes anchor-level selection.
- **Each piece becomes a separate open subpath, not a separate top-level
  object**, for the same reasons given in `divide-into-dashes.md`'s Known
  limitations (which this script shares the underlying approach with).
- **No live preview above roughly 4,000 pieces.** Past that threshold the
  dialog still works and OK still applies the real result, just without a
  live preview.
- **A hard cap of 50,000 pieces** refuses to run rather than let Every
  Anchor on a very dense selection hang the dialog.
- **Parametric shapes** (rectangles, ellipses, stars, etc.) are left out,
  matching this repo's other path scripts — convert them to curves first
  (**Layer > Convert to Curves**).
- Not tested against a live Affinity session — written and reasoned through
  against this repo's own proven curve-geometry helpers (see
  `simplify-anchors.js`), but please verify on a real document before
  relying on it.

## Changelog

1.0.0 - Initial version.
