# replace-with-top-object

Puts a copy of the frontmost selected object on each of the other selected
objects, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `replace-with-top-object.js` into the editor and
   press **Run** — or, to keep it around, click **Save As...** to save it
   to the Script Library (**Window > Scripting > Script Library**), then
   click it there to run it any time.

## Purpose

Ported from VectorCraft's Arrange Tools > Replace with Top Object. Finds
the frontmost (topmost in stacking order) object among the current
selection, then replaces every *other* selected object with a copy of it,
centred in that object's place and (by default) taking its place in the
stacking order too.

## How it works

1. The selected objects are read in back-to-front stacking order; the last
   one is the "top" object, the rest are the ones to be replaced.
2. For each other selected object, the top object is duplicated, sized per
   the **Size** choice (kept as-is, scaled to the target's bounds, or
   scaled to fit inside them proportionally), and centred on the target's
   own centre — all measured by visual bounds.
3. The duplicate is moved into the target's place in the stacking order.
4. Unless **Keep Original** is checked, the original (replaced) object is
   deleted.
5. All of this runs as one compound command, committed once on OK.

Unlike the other Arrange Tools scripts, this one does **not** live-preview:
testing showed a compound command that duplicates, reorders, and deletes
nodes doesn't revert cleanly via `doc.clearPreviews()`, so it only runs
once, for real, when OK is clicked.

## Features

- **Size** choice — Actual Size (keep the top object's own size), Bounds
  (scale to exactly match the target), Bounds (Fit Proportionally) (scale
  to fit inside the target, preserving the top object's own proportions)
- **Keep Original** checkbox (off by default) — leaves the replaced objects
  in place, underneath their new copies, instead of deleting them
- **Scale Strokes & Effects** checkbox (default on) — sets each copy's own
  "Scale with object" stroke/effects setting to match (see Known
  Limitations)
- **Single undo step** for the whole operation, regardless of how many
  objects are replaced

## Usage tips

- The "top" object is determined purely by stacking order (frontmost of
  the selection), not by selection order or object type.
- With only two objects selected, this behaves like "replace the back one
  with a copy of the front one."

## Known limitations

- **No live preview** — a duplicate-and-delete compound doesn't revert
  cleanly via `doc.clearPreviews()`, confirmed by direct testing, so
  results are only visible after clicking OK.
- **Scale Strokes & Effects is a lasting change** on each new copy, unlike
  a hypothetical per-operation preference — Affinity's SDK has no
  per-operation or document-level override for stroke/effect scaling, only
  a lasting, per-object setting. With it off and a stroke present, the
  resulting size is only approximate, since this script scales the
  geometric box directly rather than solving for the exact visual size the
  way VectorCraft's own margin-correction algorithm does.
- Requires at least two selected objects.

## Changelog

1.0.0 - Initial version.
