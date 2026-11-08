# extend-path

Lengthens the open end(s) of every selected open path by a set amount,
straight along the end's own direction, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `extend-path.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Approximate port of VectorCraft's Path Precision Tools > Extend Path (one of
its live Path Effects there — not its separate interactive Extend Path
*tool*, which drags an extension by hand and can stretch or curve it).
Useful for overshooting a cut or score line past where two paths should
meet (a common fabrication trick so an imperfect join still looks clean),
or for simply making an open path longer without redrawing its end.
Affinity has no built-in command for this.

## How it works

1. **Length** sets how far each chosen end moves, in the document's units.
2. **Extend Start** / **Extend End** choose which end(s) of each selected
   open path get a new segment.
3. The new segment is a straight line continuing along the direction the
   path was already heading at that end (its tangent there) — see Known
   limitations for why this is straight-only.
4. Closed paths have no open end and are left alone.
5. All changes across the whole selection apply as one compound command.

## Features

- **Length** field, in the document's units, with a popup slider
- **Extend Start** and **Extend End** checkboxes (both on by default)
- **Live preview** as you adjust Length or the checkboxes
- **Confirms what it did**: on OK, an alert reports how many ends were
  extended
- **Single undo step**, even across many paths and compound-path subpaths
- Looks inside selected groups and compound paths for open paths to extend,
  and skips locked, hidden, or parametric (not yet curves) ones

## Usage tips

- A short Length (a few points) is usually enough to fix a visible gap at a
  join without the overshoot itself being noticeable.
- Run **Rejoin Path Pieces** (in this repo's `artwork-cleanup` category)
  afterwards if the point of extending was to close a gap between two
  pieces that should become one path.

## Known limitations

- **Only straight continuations, not VectorCraft's fancier "stretched" or
  curved options.** Continuing a Bezier's own curvature convincingly is an
  ill-defined, fragile thing to compute in general — small, noisy handle
  data can send a curved extrapolation shooting off in an unintended
  direction. A straight continuation along the end's tangent is simple,
  predictable, and reliable; it's also the only option VectorCraft's own
  separate Extend Path *tool* offers by default before you drag to stretch
  it by hand, so it's a reasonable floor for a one-shot script.
- **Parametric shapes** (rectangles, ellipses, stars, etc.) are left out,
  matching this repo's other path scripts — convert them to curves first
  (**Layer > Convert to Curves**), though a closed primitive shape has no
  open end to extend regardless.
- Not tested against a live Affinity session — written and reasoned through
  against this repo's own proven curve-geometry helpers (see
  `simplify-anchors.js`), but please verify on a real document before
  relying on it.

## Changelog

1.0.0 - Initial version.
