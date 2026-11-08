# add-anchors

Adds a chosen number of new anchors to every selected path, spaced evenly
along the curve, without changing its shape, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `add-anchors.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Approximate port of VectorCraft's Path Precision Tools > Add Anchors (one of
its live Path Effects there). Gives a path more anchors to work with — for
distributing objects along it, for finer manual reshaping, or just to match
a density another operation expects — without moving anything or changing
how the path looks. Affinity's own Node tool only adds one anchor at a time
(double-click), with no batch, evenly-spaced equivalent.

## How it works

1. **Anchors to Add** sets how many new anchors each selected path (and
   every subpath of a compound path, and every path nested in a selected
   group) gets, independently — a path with three subpaths and a Count of 5
   gets 5 new anchors added to *each* subpath, not 5 split between them.
2. The new anchors are placed evenly by arc length along the whole subpath
   (not evenly by Bezier parameter, which bunches up on tight curves and
   spreads out on flat ones) and never land exactly on an existing anchor.
3. Each new anchor is inserted by splitting the one Bezier segment it falls
   inside (via De Casteljau subdivision) — an exact operation, not an
   approximation, so the outline's shape is unchanged to the limits of
   floating-point precision.
4. All changes across the whole selection apply as one compound command.

## Features

- **Anchors to Add** field (1–1000), with a popup slider
- **Live preview** while the total added is small enough (see Known
  limitations); a line under the field reports how many anchors the current
  Count would add
- **Confirms what it did**: on OK, an alert reports how many anchors were
  added
- **Single undo step**, even across many paths and compound-path subpaths
- Looks inside selected groups and compound paths for paths to add anchors
  to, and skips locked, hidden, or parametric (not yet curves) ones

## Usage tips

- Run this before a script or effect that works anchor-by-anchor (like
  distributing copies along a path) if the path doesn't already have enough
  points for the density you want.
- Because spacing is by arc length, a Count that looks right on one subpath
  may look different on a much shorter or longer one in the same selection —
  each is spaced independently along its own length.

## Known limitations

- **VectorCraft's own Add Anchors dialog wasn't available to check this
  against** — it's one of its live Path Effects, documented only as
  "distributes additional anchor points along path without changing shape."
  This port's choice of exactly-even arc-length spacing, applied once as a
  destructive command rather than a live, re-editable effect, is a
  reasonable reading of that description rather than a confirmed match.
- **No live preview above roughly 4,000 anchors added** across the
  selection. Past that threshold the dialog still works and OK still
  applies the real result, just without a live preview.
- **A hard cap of 50,000 new anchors** across the selection refuses to run
  rather than let a very high Count on a large selection hang the dialog.
- **Parametric shapes** (rectangles, ellipses, stars, etc.) are left out,
  matching this repo's other path scripts — convert them to curves first
  (**Layer > Convert to Curves**).
- Not tested against a live Affinity session — written and reasoned through
  against this repo's own proven curve-geometry helpers (see
  `simplify-anchors.js`), but please verify on a real document before
  relying on it.

## Changelog

1.0.0 - Initial version.
