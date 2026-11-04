# rejoin-path-pieces

Welds open path pieces in the selection whose ends lie close together back
into continuous paths, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `rejoin-path-pieces.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Ported from VectorCraft's Artwork Cleanup > Rejoin Path Pieces. Repairs a
line that's been accidentally split into separate path objects — common
after an image trace, an SVG import, or one cut too many with the Node tool
— by finding the loose ends that belong together and welding them back into
one path.

## How it works

1. It looks at every open, single-subpath path in the selection (including
   ones nested in selected groups) — not closed shapes, not compound paths.
   Each one is a "piece," with two ends: its first anchor and its last.
2. **Gap** (0–6pt, default 0.1pt) sets how close two ends need to be to
   count as touching.
3. For every pair of ends within Gap, it measures two things: how much the
   path would turn at that junction (less is better - it prefers the
   straightest continuation), then, only to break a tie, how far apart they
   are. An end can match at most one other.
4. It works through all the candidate junctions in that order, locking in
   the best ones first; once an end is taken, it's out of the running for
   anything else. This is a one-pass best-first match, not a search for the
   single best overall arrangement.
5. It follows the resulting links into chains. A piece can run backwards in
   a chain if that's the direction it fits. If a chain's last open end
   loops back to its own first, the result is a closed path instead of an
   open one.
6. Each chain of two or more pieces is merged into a single path: the
   shared point between two pieces becomes one anchor (keeping the earlier
   piece's position and incoming handle, the later piece's outgoing one).
   The merged path takes over the **topmost** piece's identity (fill,
   stroke, position in the stacking order); the rest are deleted. A single
   piece whose own two ends meet (and would leave three or more anchors)
   closes the same way, keeping its own identity.
7. Pieces that found no match are left exactly as they are.
8. All changes apply as one compound command.

## Features

- **Gap** field (0–6pt), with a popup slider
- A line under it updates live as you adjust Gap, reporting how many pieces
  it would join into how many paths — see Known limitations for why this
  doesn't preview the joined shape itself
- **Single undo step**, even across many pieces and several separate chains
- Looks inside selected groups for pieces to rejoin
- Works across pieces with different positions, rotations or scales (each
  piece's own transform is accounted for before comparing its ends to any
  other piece's)

## Usage tips

- Start with the default Gap (0.1pt) and raise it only as far as you need
  to catch the gaps your pieces actually have — too large a Gap can weld
  ends that were never meant to meet.
- If a join doesn't happen at the Gap you expect, the pieces may be
  farther apart than they look on screen; the live count under the
  checkbox confirms what Gap actually catches before you commit to it.
- Whichever piece is topmost in the stacking order keeps its fill and
  stroke after the join, so stack the one with the paint you want on top
  first if it matters.

## Known limitations

- **No live preview of the joined shape itself** — only the live count of
  how many pieces/paths it would produce. `replace-with-top-object.js`
  (Arrange Tools) found that a compound command which deletes and replaces
  nodes doesn't revert cleanly from `doc.clearPreviews()`, so this script
  doesn't attempt one either; it commits once, on OK.
- **No equivalent of VectorCraft's "clipping path" / "guide" exclusions.**
  VectorCraft leaves clipping paths and guide curves out of what it
  rejoins; the Affinity SDK has no scripting-visible flag for either, so
  this script doesn't filter them out. In practice this only matters if a
  clipping path or guide is itself an open, single-subpath path sitting in
  the selection.
- **A cap of 5,000 pieces** across the selection refuses to run rather than
  let a pathologically large selection hang the dialog.

## Changelog

1.0.0 - Initial version.
