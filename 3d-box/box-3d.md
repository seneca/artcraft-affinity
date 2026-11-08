# box-3d

Creates a rotatable 3D box as a single object, with Angle X/Y/Z rotation
and per-axis parallel/perspective projection.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `box-3d.js` into the editor and press **Run** —
   or, to keep it around, click **Save As...** to save it to the Script
   Library (**Window > Scripting > Script Library**), then click it there
   to run it any time.

## Purpose

Ported from VectorCraft's 3D Box tool (part of its customizable-shapes
add-on). Builds a box out of a unit cube's 8 corners, rotated in 3D and
projected down to a flat 2D silhouette that exactly fills a given Width x
Height, drawn as one object with one closed quad per visible face.

**This is a dialog, not a drawing tool** — see "Why a dialog, not a tool"
below for why, and what's different as a result.

## How it works

1. The unit cube's 8 corners are rotated by Angle X, then Angle Y, then
   Angle Z (degrees), each is optionally foreshortened toward its own axis
   first if that axis's **Parallel** checkbox is off (VectorCraft's own
   cheap stand-in for perspective, not a real camera projection), and the Z
   axis is optionally perspective-divided afterward if Parallel Z is off.
2. The 8 rotated corners are projected to 2D and rescaled so their
   silhouette exactly fills the dialog's Width x Height.
3. Each of the cube's 6 faces is tested: outward-facing (visible) faces
   keep a positive signed area once projected; the rest are discarded.
   Ordinarily 2-3 of the 6 are visible for any generic angle.
4. The visible faces are sorted back to front and drawn as one object: a
   single path with one closed 4-point subpath per face, each a straight-
   edged quad (no curves).
5. The whole thing commits as one undo step, selected, with live preview
   on every field and checkbox change.

## Why a dialog, not a tool

VectorCraft's own 3D Box is a **draggable canvas tool**: you drag out its
size and position directly on the page, hold Shift to constrain it, and
use the arrow keys to spin it live while dragging, with further options
(via a control bar) layered on top. Affinity's scripting SDK has no
equivalent of a custom, persistent, draggable canvas tool — a script runs
once, shows at most a modal dialog, and exits. There's no way for a script
to install itself into the tool palette or handle live pointer drag events
the way the original tool does.

The closest faithful equivalent is what this script does instead: the same
parameters (Width, Height taking the place of the drag gesture; Angle X/Y/Z;
Parallel X/Y/Z) in a dialog, with the same live preview VectorCraft's own
control bar gives you after the fact, and the box placed at a sensible
default position (see Features) instead of wherever you happened to drag.

## Features

- **Width** / **Height** fields — the box's overall silhouette size
- **Lock Width and Height** checkbox (not part of VectorCraft - its tool has no numeric fields to
  link, since size comes from a drag gesture) - while on, changing either field rescales the other
  to keep whatever ratio was active the moment the checkbox was last turned on (or last left alone),
  the same way a link-icon control works elsewhere
- **Angle X / Angle Y / Angle Z** (-180°..180°) — rotates the cube about
  each axis in turn, X then Y then Z; defaults (30°, 35°, 0°) match
  VectorCraft's own tool defaults
- **Parallel X / Parallel Y / Parallel Z** checkboxes (default on) — true
  orthographic projection along that axis when on, VectorCraft's cheap
  foreshortened "perspective" look when off
- **Live preview** on every field and checkbox change; cancel reverts
  cleanly (confirmed safe for a newly-added object, unlike a
  duplicate-or-delete compound elsewhere in this repo)
- **Single undo step**, and the new box is selected on commit
- Placed centred on the artboard under the current spread's own centre (or
  its first artboard, or the spread itself with no artboards at all) —
  fixed once per dialog session, so the box grows or shrinks from that same
  point as Width/Height change

## Usage tips

- With all three Parallel checkboxes on, the result is a true orthographic
  (axis-aligned isometric-style) box — the classic "3D box" icon look.
  Turning one or more off adds VectorCraft's cheap perspective skew instead.
  It isn't a real camera; it's the same formula VectorCraft's own tool
  uses, kept exactly so the look matches.
- The box is one object with multiple subpaths (one per face) sharing a
  single fill and stroke — the "3D" look comes from the stroke outlining
  each face's edges, not from different colours per face. Restyle it like
  any other shape afterward.
- At some extreme angle combinations only 1-2 faces end up visible instead
  of the usual 2-3 (e.g. looking straight down one axis) — this is correct,
  not a bug; VectorCraft's own tool does the same.

## Known limitations

- **No draggable canvas tool** — see "Why a dialog, not a tool" above. Size
  and position come from dialog fields and a computed default placement,
  not a drag gesture.
- **The faces share one fill and stroke** — VectorCraft's own box3d()
  function (crates/geom/src/shapes.rs) returns a single multi-subpath path,
  not separate per-face objects, and this port matches that exactly; there
  is no per-face shading.
- **Parallel-off "perspective" is a stylized approximation**, not a real
  camera projection — ported bit-for-bit from VectorCraft's own formula
  (a simple 1 - 0.22 x coordinate-position foreshortening per axis, plus a
  1 / (1 - 0.25 x depth) divide for Z) for visual fidelity with the
  original, not physical accuracy.

## Changelog

1.0.1 - Added Lock Width and Height, a link-icon-style checkbox not present in VectorCraft's own
tool (which has no numeric fields to link). While on, changing either field rescales the other to
preserve whatever ratio was active the moment the checkbox was last turned on.

1.0.0 - Initial version.
