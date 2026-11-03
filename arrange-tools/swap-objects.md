# swap-objects

Swaps the places of two selected objects, with optional size and colour
swapping, as one undo step.

## Purpose

Unifies VectorCraft's Arrange Tools > Swap Objects and > Swap Objects and
Sizes into a single script, and adds a third option (Swap Colours) not
present in either original. Exactly two objects must be selected.

## How it works

1. The two selected objects' bounding-box centres (measured visually —
   strokes and effects as drawn) are always swapped.
2. With **Swap Sizes** checked, each object is also scaled to the other's
   width and height (about its own new centre), so they fully trade places
   and sizes.
3. With **Swap Colours** checked, each object's fill and stroke colour/fill
   descriptors are also exchanged.
4. All selected effects are built as one compound command and committed as
   a single undo step.

## Features

- **Swap Sizes** checkbox (off by default) — VectorCraft's "and Sizes"
  variant
- **Swap Colours** checkbox (off by default, not part of VectorCraft) —
  swaps fill and stroke descriptors
- **Scale Strokes & Effects** checkbox (default on, enabled only when Swap
  Sizes is checked) — sets each object's own "Scale with object"
  stroke/effects setting to match (see Known Limitations)
- **Live preview** on every checkbox change; cancel reverts cleanly
- **Single undo step**

## Usage tips

- Swap Colours swaps both the fill *and* the stroke colour together — there
  is no way to swap only one.
- With Swap Sizes off, only position changes; the two objects keep their
  own original sizes.

## Known limitations

- **Scale Strokes & Effects is a lasting change**, unlike a hypothetical
  per-operation preference — Affinity's SDK has no per-operation or
  document-level override for stroke/effect scaling, only a lasting,
  per-object setting (`LineStyleDescriptor.isScale` and each layer effect's
  own `scaleWithObject`). With it off and a stroke present, the resulting
  size is only approximate, since this script scales the geometric box
  directly rather than solving for the exact visual size the way
  VectorCraft's own margin-correction algorithm does.
- Requires exactly two selected objects; more or fewer and the script
  alerts and exits without changing anything.

## Changelog

1.0.0 - Initial version. Unifies VectorCraft's Swap Objects and Swap
Objects and Sizes into one dialog, and adds Swap Colours.
