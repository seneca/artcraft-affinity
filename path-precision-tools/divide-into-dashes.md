# divide-into-dashes

Cuts every selected path into separate open pieces of a set length along the
curve, with a gap between them, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `divide-into-dashes.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Ported from VectorCraft's Path Precision Tools > Divide into Dashes. Turns a
path into a set of real, separate open pieces spaced like a dashed line —
useful for laser cutters, pen plotters, and other tools that need actual gaps
in the geometry, not just a dashed stroke style that still cuts or draws as
one continuous line. Affinity's own **Layer > Expand Stroke** can separate a
dashed stroke's visible dashes too, but it turns each one into a *filled
outline* (both sides of the stroke, offset by half its width) rather than an
*open, stroked centreline* — the wrong shape for a plotter pen or for a laser
that should cut once per line, not trace both edges of it.

## How it works

1. **Dash** and **Gap** set the length of each piece and the space after it,
   measured along the curve (not straight-line distance).
2. **Fit to Corners and Ends** splits each path into "runs" — the stretch
   between two corners (anchors where the path turns by more than 30°,
   matching this repo's own `simplify-anchors.js`), or between a corner and
   an open path's end. Within each run, Dash and Gap are scaled together (so
   their ratio stays the same) until some whole number *N* of dashes, with
   *N − 1* gaps between them, fits the run exactly — so the run both starts
   *and* ends on a dash, with no sliver of a dash or gap dangling off a
   corner. With it off, the pattern just repeats from each subpath's own
   start, and the final cycle is simply cut short at the path's end.
3. **Remove Gaps** discards the gap pieces (the usual choice for cutting or
   plotting). Unchecked, gap pieces are kept too — the whole path ends up
   divided into alternating-length pieces, nothing discarded.
4. Every kept piece becomes its own open subpath inside the same compound
   path object the original path belonged to (see Known limitations).
5. All changes across the whole selection apply as one compound command.

## Features

- **Dash** and **Gap** length fields, in the document's units, each with a
  popup slider
- **Fit to Corners and Ends** checkbox (on by default)
- **Remove Gaps** checkbox (on by default)
- **Live preview** while the piece count is small enough (see Known
  limitations); a line under the checkboxes reports how many pieces the
  current settings would produce
- **Confirms what it did**: on OK, an alert reports how many pieces were
  produced
- **Single undo step**, even across many paths and compound-path subpaths
- Looks inside selected groups and compound paths for paths to divide, and
  skips locked, hidden, or parametric (not yet curves) ones

## Usage tips

- For a laser or plotter cut line, leave Remove Gaps on and set Gap to your
  machine's minimum travel move; set Dash to whatever length survives
  handling without falling apart (perforated card, fabric, etc.).
- Turn Fit to Corners and Ends off if you specifically want a continuous,
  unbroken dash rhythm running through corners (e.g. matching a dashed
  stroke style you're about to replace) rather than one that resets at every
  corner.
- Turn Remove Gaps off to divide a long path into manageable, independently
  selectable pieces without throwing any of it away.

## Known limitations

- **Each dash becomes a separate open subpath, not a separate top-level
  object.** VectorCraft's own version may produce fully independent objects;
  this port keeps all the pieces of one original path together as a single
  compound-path object (the same approach `simplify-anchors.js` and
  `rejoin-path-pieces.js` use for multi-piece results in this repo), since
  rebuilding a selected object's curves is a well-tested operation on this
  SDK while bulk object creation and deletion is not, and because a dash
  count in the thousands would otherwise mean creating thousands of new
  layer objects. If you need each dash as its own selectable object, use
  **Layer > Split Curves** (or similar) afterwards, or ask for that as a
  follow-up if it matters for your workflow.
- **No live preview above 2,000 pieces.** Converting a result into actual
  curve data on every dialog change is proportional to piece count; past
  that threshold the dialog still works and OK still applies the real
  result, just without a live preview.
- **A hard cap of 100,000 pieces**, matching VectorCraft's own, refuses to
  run rather than let a pathological Dash/Gap setting (e.g. a tiny Dash over
  a very long path) hang on an effectively unbounded result.
- **A closed path with no corners at all** (a perfect circle, for instance)
  picks an arbitrary start point for its one single run — there's no
  "natural" start on a loop with nothing to anchor it to.
- **Parametric shapes** (rectangles, ellipses, stars, etc.) are left out,
  matching this repo's other path scripts — convert them to curves first
  (**Layer > Convert to Curves**).
- Not tested against a live Affinity session — written and reasoned through
  against this repo's own proven curve-geometry helpers (see
  `simplify-anchors.js`), but please verify on a real document before
  relying on it for production cutting or plotting.

## Changelog

1.0.0 - Initial version.
