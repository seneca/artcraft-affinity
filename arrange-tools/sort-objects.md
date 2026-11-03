# sort-objects

Sorts the selected objects by one attribute and gives them another, in that
order, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `sort-objects.js` into the editor and press **Run**
   — or, to keep it around, click **Save As...** to save it to the Script
   Library (**Window > Scripting > Script Library**), then click it there
   to run it any time.

## Purpose

Ported from VectorCraft's Arrange Tools > Sort Objects. Takes the selected
top-level objects, ranks them by one attribute (**Sort By**), then changes
a second attribute (**Apply To**) to express that ranking — resize them,
move them, relayer them, or fade them, depending on which attribute you
pick. Also adds **Distribute Spacing Evenly**, a checkbox not present in
VectorCraft, for the one thing its own "Distribute Evenly" can't do: give
differently-sized objects equal physical gaps along an axis.

## How it works

The script works in two independent steps:

1. **Rank** — every selected object gets a rank (1st, 2nd, 3rd, ...) by
   reading its current **Sort By** attribute (Width, Height, Area, X
   Position, Y Position, Opacity, or Stacking Order) and sorting those
   values according to **Order** (Small to Large, Large to Small, or
   Random).
2. **Apply** — the selection's own **existing** values of the **Apply To**
   attribute (which can be the same as, or different from, Sort By) are
   collected, sorted smallest to largest, and handed back out to the
   objects in rank order: the 1st-ranked object gets the smallest existing
   value, the 2nd-ranked gets the next, and so on.

Nothing is computed "fresh" from a formula (except Distribute Evenly/
Distribute Spacing Evenly, see below) — the values being assigned are
always values that already existed somewhere in the selection before the
script ran. The script only decides *who gets which one*.

**Apply To: Stacking Order** is the one exception to the "resize/move/fade"
description above — it doesn't go through the value-redistribution model at
all. Instead, within each layer/group that has selected members, those
members trade places among their own original stacking slots only; every
other sibling (selected or not, in that layer or any other) stays exactly
where it is. This is why it's the only Apply To option that changes how
objects are *layered*, rather than their size, position, or opacity — see
"Understanding Sort By vs. Apply To" below for the full breakdown of what
each option actually does.

Everything runs as a single compound command (one undo step), with a full
live preview that updates as any field or checkbox changes.

## Understanding Sort By vs. Apply To

This is the part of the script most likely to feel unintuitive at first,
so it's worth spelling out in full — including two mathematical properties
of the tool that are easy to trip over without knowing they're there.

### What Apply To actually changes

| Apply To | What happens |
|---|---|
| **Stacking Order** | Reorders the real layer/z-order. The only option that changes layering. |
| **X Position** / **Y Position** | Moves objects along that axis, by redistributing the selection's own existing left-edge/top-edge values. |
| **Width** / **Height** | Resizes objects along *one axis only*, by redistributing the selection's own existing width or height values. Changes nothing else about the object — including its other dimension, which is why a circle can become an ellipse (see Known Limitations). |
| **Area** | Resizes objects *proportionally* (both axes together), by redistributing the selection's own existing area values. The only resizing option that preserves aspect ratio. |
| **Opacity** | Changes transparency, by redistributing the selection's own existing opacity values. |

A common first assumption is that this script always "sorts objects on the
page" the way a layers panel sorts by name — but only `Apply To: Stacking
Order` touches layering at all. Every other option repositions, resizes, or
fades objects; none of them move anything up or down the Layers panel.

### The redistribution model, worked example

Say three selected objects have widths 10, 50, and 30, and their areas (in
back-to-front stacking order) are 400, 100, 900.

With **Sort By: Area, Apply To: Width, Order: Small to Large**:

1. Rank by area ascending: the 100-area object is 1st, the 400-area object
   is 2nd, the 900-area object is 3rd.
2. The selection's own widths — 10, 50, 30 — sorted ascending are 10, 30, 50.
3. Handed out in rank order: the 100-area object (1st) gets width 10, the
   400-area object (2nd) gets width 30, the 900-area object (3rd) gets
   width 50.

Notice none of the three final widths (10, 30, 50) are new numbers — they're
the same three widths the selection already had, just reassigned. This is
true of every Apply To option except Stacking Order (which reassigns
*positions in the layer stack*, not a numeric value) and Distribute Evenly/
Distribute Spacing Evenly (which replace this step with computed values —
see below).

### The guaranteed no-op: Sort By = Apply To, Order = Small to Large

**Whenever Sort By and Apply To are the same attribute, and Order is Small
to Large, the result is always unchanged — for any selection, any sizes,
always.** This isn't a bug or a coincidence of particular test data; it
follows directly from the redistribution model above:

- Ranking by an attribute and sorting that *same* attribute's values both
  use the identical sort (ascending) over the identical numbers.
- So the object ranked 1st (smallest value of that attribute) is, by
  definition, the object that *owns* the smallest value — and gets handed
  back that exact value. Same for every other rank.
- Every object ends up reassigned its own pre-existing value. Nothing
  moves.

Concretely: two rectangles, one bigger, one smaller. Running **Sort By:
Area, Apply To: Area, Order: Small to Large** ranks the smaller one 1st and
the bigger one 2nd, then hands out their own areas — smallest to the
smaller one, biggest to the bigger one. Each gets back exactly what it
started with. No visible change is the *correct* result, not a failure.

### The reverse case: Sort By = Apply To, Order = Large to Small

Flip Order to Large to Small in the same scenario, and the objects' own
values get handed out in the *opposite* direction: the smallest-ranked
object (by its own value) now receives the *largest* existing value, and
vice versa. For exactly two objects this is a true swap — the two
rectangles trade sizes. With more than two objects it's a full reversal of
the value assignment, not a pairwise swap (the 1st-ranked gets the
largest, the 2nd-ranked gets the 2nd-largest, and so on).

### Order: Random

Shuffles which rank each object gets (via a seeded PRNG, see Known
Limitations), then redistributes Apply To's existing values across that
shuffled ranking the same way Small to Large would across the sorted one.
The seed is fixed for the lifetime of one dialog session, so Preview and OK
always agree, but a fresh seed is picked every time the dialog is opened.

### Distribute Evenly and Distribute Spacing Evenly

Both checkboxes replace step 2 above (handing out the selection's *own*
existing values) with freshly computed ones — they're the only two options
that don't just redistribute pre-existing numbers.

- **Distribute Evenly** (VectorCraft's own option; Width/Height/Area/X
  Position/Y Position/Opacity, not Stacking Order) steps the Apply To
  attribute's value evenly from the selection's own smallest to its own
  largest, by rank — e.g. three objects become evenly spaced *values*
  (10, 30, 50 for a 10–50 range), regardless of what their original three
  values actually were.
- **Distribute Spacing Evenly** (this port's own addition; X/Y Position
  only) instead solves for equal **physical gaps** between neighbouring
  objects along that axis, accounting for each object's own width/height.
  This is the thing VectorCraft's "Distribute Evenly" can't do: evening out
  *position values* gives equal gaps only when every object happens to be
  the same size. Three objects of width 10, 60, 30 placed with Distribute
  Evenly get equal *steps between their left edges*, which are visibly
  unequal gaps once their different widths are accounted for; Distribute
  Spacing Evenly instead solves directly for the gap size that makes every
  edge-to-edge space identical.

## Features

- **7 attributes**, independently selectable for Sort By and Apply To:
  Width, Height, Area, X Position, Y Position, Opacity, Stacking Order
- **3 orders** — Small to Large, Large to Small, Random (seeded per dialog
  session)
- **Distribute Evenly** — VectorCraft's own "step values evenly" option
  (Width/Height/Area/X/Y/Opacity)
- **Distribute Spacing Evenly** — this port's own addition; equal physical
  gaps between differently-sized objects (X/Y Position only)
- **Scale Strokes & Effects** — sets each resized object's own "Scale with
  object" stroke/effects setting to match (Width/Height/Area only; see
  Known Limitations)
- **Apply To: Stacking Order** reorders each selected object only among its
  own original slots within its own layer/group — every other object,
  selected or not, stays exactly where it is
- **Live preview** on every field and checkbox change; cancel reverts
  cleanly
- **Single undo step** regardless of how many objects are affected

## Usage tips

- To see **Stacking Order** do anything, the selected objects need to
  physically overlap — reordering non-overlapping objects' z-order is, by
  definition, invisible.
- If nothing happens when you change settings, check whether Sort By and
  Apply To are the same attribute with Order left on Small to Large — see
  "The guaranteed no-op" above. Switch Order to Large to Small, or set
  Apply To to a different attribute than Sort By, to see a real effect.
- Sorting by Width or Height only changes that one dimension — a circle can
  become an ellipse. Use Apply To: Area for a resize that keeps proportions.
- Distribute Spacing Evenly only has an effect (and is only enabled) when
  Apply To is X Position or Y Position.

## Known limitations

- **Width/Height distort non-square objects by design** — this matches
  VectorCraft's own behavior exactly (confirmed against its engine source,
  `crates/engine/src/cmd/addons/arrange.rs`: the `width`/`height` cases
  build a resize query with only that one dimension set; only `area` scales
  both sides together, in proportion). It isn't something this port
  introduced or could "fix" without diverging from the original tool.
- **Scale Strokes & Effects is a lasting change**, unlike VectorCraft's own
  per-operation preference — Affinity's SDK has no per-operation or
  document-level override for stroke/effect scaling (confirmed by reading
  the official SDK source directly, not just a hint), only a lasting,
  per-object setting (`LineStyleDescriptor.isScale` and each layer effect's
  own `scaleWithObject`). With it off and a stroke present, the resulting
  size is only approximate, since this script scales the geometric box
  directly rather than solving for the exact visual size the way
  VectorCraft's own margin-correction algorithm does.
- **Order "Random"'s seed** is freshly randomized every time the dialog
  opens, rather than tied to a document revision counter — VectorCraft's
  own hidden seed does the latter, which this SDK doesn't expose to
  scripts.
- **Apply To: Stacking Order only reorders within one layer/group at a
  time** — selected objects in different parents are reordered
  independently, each only among its own siblings; nothing moves objects
  between layers or groups.

## Changelog

1.0.1 - Fixed Apply To: Stacking Order's live preview getting stuck mid-way
through a dialog session. `buildStackingCommand` reads the live sibling
order to decide each group's moves, and skips a group whose ranked order
already matches its originally-captured order. A prior preview's moves
were still visibly in effect on the document at that point, so toggling a
field back toward a state whose rank matched the original order tripped
that "no move needed" check against the stale, already-previewed
arrangement instead of the real one — leaving objects stuck in whatever the
previous preview left them in. Fixed by clearing any active preview before
rebuilding and re-applying each one, so the read and the check are always
against the true, committed order.

1.0.0 - Initial version. Unifies the redistribution model described above
with VectorCraft's original Sort Objects behavior, adds Distribute Spacing
Evenly, and implements a real (if lasting) Scale Strokes & Effects via
`LineStyleDescriptor.isScale` and `createSetAllLayerEffectsScaleWithObject`.
