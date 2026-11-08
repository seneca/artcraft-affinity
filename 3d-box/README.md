# 3D Box

An Affinity port of VectorCraft's 3D Box add-on tool — a rotatable
pseudo-3D box, drawn as a single flat-faced object.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the script's contents into the editor and press **Run**.
3. To keep it around, click **Save As...** to save it to the Script
   Library (**Window > Scripting > Script Library**), then click it there
   to run it any time.

## Description

| Script | What it does |
|---|---|
| [`box-3d.js`](box-3d.md) | Creates a rotatable 3D box as a single object, with Angle X/Y/Z rotation, per-axis parallel/perspective projection, and a Width/Height lock. |

VectorCraft's original 3D Box is a draggable canvas tool with no dialog of
its own; Affinity's scripting SDK has no equivalent of a custom draggable
tool, so this is a dialog with the same parameters instead, live-previewed,
committed as one undo step. See [`box-3d.md`](box-3d.md) for the full
breakdown of why, and the geometry it faithfully ports.

**Lock Width and Height is not part of VectorCraft's own tool** — added in
this port as a link-icon-style checkbox, since VectorCraft's tool has no
numeric width/height fields to link in the first place (its size comes
from a drag gesture, not typed values). Everything else in `box-3d.js` is
a faithful port of VectorCraft's own geometry and parameters.

## Files

- `box-3d.js` — the script itself (see its header for its version)
- `box-3d.md` — its full guide
- `README.md` — this file

## Known Limitations

- No draggable canvas tool exists in this SDK — size, rotation, and
  projection all come from dialog fields instead of a drag gesture.
- The box's faces share one fill and one stroke (a single multi-subpath
  object, matching VectorCraft's own output) — no per-face shading.
- The "perspective" look from turning a Parallel checkbox off is a
  stylized approximation ported bit-for-bit from VectorCraft's own formula,
  not a physically accurate camera projection.

See `box-3d.md` for the full reasoning behind each.

## Requirements

- Affinity by Canva 3.3
- No external dependencies

## License

BSD 3-Clause — see the script's header for license information.
