# set-size-of-each

Gives every selected object the same width and/or height, as one undo
step.

## Purpose

Ported from VectorCraft's Arrange Tools > Set Size of Each. Independently
set a target width and/or height for all selected top-level objects, about
a chosen 9-point reference point, with live preview.

## How it works

1. **Width** and **Height** each have their own checkbox and field — either
   can be set alone, or both together.
2. With exactly one of them checked, **Constrain Width and Height
   Proportions** becomes available: the unchecked dimension follows the
   checked one's scale factor, keeping each object's own aspect ratio.
3. **Reference Point** (Affinity's native 9-point `SpatialAnchor` grid, the
   exact equivalent of VectorCraft's own reference-point picker) decides
   which point of each object stays fixed while it resizes — e.g. Top-Left
   keeps that corner in place, Centre keeps the middle in place.
4. Every object is scaled individually (visual bounds — strokes and
   effects as drawn) and all moves/scales run as one compound command.

## Features

- **Width** / **Height** checkboxes, each with its own field — can be used
  independently or together
- **Constrain Width and Height Proportions** — enabled only when exactly
  one of Width/Height is checked
- **Reference Point** — Affinity's native 9-point spatial anchor picker
- **Scale Strokes & Effects** checkbox (default on) — sets each object's
  own "Scale with object" stroke/effects setting to match (see Known
  Limitations)
- **Live preview** on every field and checkbox change; cancel reverts
  cleanly
- **Single undo step**

## Usage tips

- With both Width and Height checked, Constrain Proportions has no effect
  (there's nothing left to derive) and is disabled.
- Reference Point only matters visually when objects actually change size —
  with identical before/after dimensions, no reference point produces a
  visible difference.

## Known limitations

- **Scale Strokes & Effects is a lasting change**, unlike a hypothetical
  per-operation preference — Affinity's SDK has no per-operation or
  document-level override for stroke/effect scaling, only a lasting,
  per-object setting (`LineStyleDescriptor.isScale` and each layer effect's
  own `scaleWithObject`). With it off and a stroke present, the resulting
  size is only approximate, since this script scales the geometric box
  directly rather than solving for the exact visual size the way
  VectorCraft's own margin-correction algorithm does.
- The Width/Height field range is narrowed to 0.001–5000pt (from
  VectorCraft's 1,000,000pt) for popup-slider usability.

## Changelog

1.0.0 - Initial version. Uses Affinity's native 9-point `SpatialAnchor`
widget as the exact equivalent of VectorCraft's own reference-point picker,
and a real (if lasting) Scale Strokes & Effects via
`LineStyleDescriptor.isScale` and `createSetAllLayerEffectsScaleWithObject`.
