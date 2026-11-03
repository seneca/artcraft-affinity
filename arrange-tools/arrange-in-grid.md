# arrange-in-grid

Lays the selected objects out in a grid, a single row, or a single column,
as one undo step.

## Purpose

Ported from VectorCraft's Arrange Tools > Arrange in Grid. Takes the
selected top-level objects, in their current stacking order from the back,
and arranges them left to right and top to bottom into a grid (or a single
row, or a single column), with live preview as you adjust layout, spacing,
or centering.

## How it works

1. The selected objects are read in back-to-front stacking order (their
   actual document order is used, not selection order, since the SDK
   doesn't expose a meaningful order for `doc.selection.nodes`).
2. The number of columns comes from the **Layout** choice: a single row
   (columns = object count), a single column (columns = 1), or a grid,
   where **Columns** sets it directly (default `⌈√count⌉`).
3. Each column is as wide as its widest member; each row is as tall as its
   tallest member — measured by visual bounds (strokes and effects as
   drawn), not just the geometric path.
4. Objects are centred within their cell. The whole grid's origin is either
   the top-left of the union of all selected objects' bounds, or — with
   **Center on Artboard** checked — centred under whichever artboard sits
   under the selection's own centre (falling back to the spread's first
   artboard, or the uncentered origin if the spread has none at all).
5. Every object's move is a pure translation (no scaling) to its cell
   centre, applied as one compound command.

## Features

- **3 layouts** — Grid by Row (explicit column count), Arrange by Row
  (single row), Arrange by Column (single column)
- **Columns** field, enabled only for Grid by Row, defaulting to
  `⌈√selection count⌉`
- **Independent H/V Spacing** fields (both default 10pt, adjustable
  separately after that)
- **Center on Artboard** checkbox — centres the grid under the artboard
  beneath the selection, instead of starting at the selection's own
  top-left
- **Live preview** on every field and checkbox change; cancel reverts
  cleanly
- **Single undo step** regardless of how many objects are affected

## Usage tips

- Column/row sizing is driven by the *widest*/*tallest* member of each
  column/row — a single oversized object in a column will widen every cell
  in that column, not just its own.
- Center on Artboard only has an effect when there's an artboard under (or
  near) the selection; with no artboards on the spread at all, it silently
  falls back to the same top-left origin as having it unchecked.

## Known limitations

- H/V Spacing's dialog range (±500pt) is narrower than VectorCraft's own
  engine-level clamp (±1,000,000pt) — the full range makes the popup slider
  unusable and, uncaught, can fling objects far off the artboard on a
  single drag.
- Stacking order itself is never changed — only position. Objects keep
  whichever layer order they had before the grid was built.

## Changelog

1.0.0 - Initial version.
