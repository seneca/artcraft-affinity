# join-point-text

Joins one-line **Artistic Text** objects into a single multi-line paragraph,
as one undo step. Does not touch **Frame Text**.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `join-point-text.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.
3. A small dialog opens for the one setting below, previewing the actual
   join live on the real objects as you move the slider - click **OK**
   to keep it, or **Cancel** to back out without joining anything.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Join Point Text —
the more aggressive sibling of `combine-point-text.js`. Where Combine only
welds together fragments that are clearly pieces of the *same* line (and can
leave several objects behind), Join always produces exactly **one** object:
every eligible fragment, however many separate lines they form, gets folded
into one real multi-line paragraph.

Only **Artistic Text** (point type - one click with the Text tool, no fixed
box) is ever touched. **Frame Text** is always left exactly as it is,
matching VectorCraft's own tool - see `combine-point-text.md`'s Purpose for
why.

## How it works

1. Looks at the selection's one-line, horizontal Artistic Text objects
   (inside selected groups too).
2. Picks the piece highest on the page, then furthest left, as the
   **reference** — its rotation/scale/shear sets what "turned alike" means
   for everything else, and it's whose place and paint the joined object
   ends up taking.
3. Keeps only the pieces turned the same way as the reference; anything
   turned differently is left out of the join entirely — not merged, not
   touched, not an error by itself (needing at least two kept pieces overall
   is).
4. Sorts what's kept top to bottom by baseline, then left to right within
   each line (lines found the same way `combine-point-text.js` finds them,
   but **without** checking whether pieces look alike first — Join doesn't
   care if two lines are different colours).
5. Builds **one new text object**: each line becomes a real paragraph (an
   actual line break between them), left-aligned, with the vertical gap
   between one line's baseline and the next kept as that paragraph's exact
   leading. Within a line, pieces join left to right with a plain space
   between them where there wasn't one already.
6. Every piece's own character styling (font, size, colour, tracking)
   carries over, same as Combine.
7. The new object is positioned at the reference piece's own starting
   point; every piece that was used (not the ones left out in step 3) is
   deleted.
8. All of it applies as one compound command.

## Features

- **A same-line tolerance dialog with a live preview** — opens pre-filled
  with `CONFIG`'s value, and redraws the actual joined object on the
  canvas as you move the slider, before you ever click OK
- **Keeps character styling** — each piece's own font, size, colour and
  tracking survive
- **Rebuilds real paragraph structure**: actual line breaks, left alignment,
  and leading that matches the original line spacing
- **Single undo step**
- Looks inside selected groups; pieces turned a different way from the
  reference, and locked or hidden objects, are left alone

## Usage tips

- Use this instead of `combine-point-text.js` when you have several
  separate *lines* of fragmented text that should become one text block;
  use Combine when you just want neighbouring fragments on the same line
  welded together without reflowing anything.
- If your selection mixes text at more than one rotation, only the group
  that matches the top-left piece's own rotation gets joined — reselect and
  run it again for the others.
- Because the result is forced left-aligned, re-apply your own alignment
  afterward if the original was centered or right-aligned.

## Known limitations

Shares `combine-point-text.js`'s core limitation and for the same reason —
no per-glyph position API in the Affinity SDK:

- **Positioning is approximate.** The joined object is placed at the
  reference piece's own bounding-box corner (not its exact baseline/click
  point), and spaces and line leading are plain/measured-by-box rather than
  pixel-solved.
- **"Same line" is judged by bounding box**, not font size or baseline - a
  box's height stands in for font size, its vertical centre for baseline.
- **"Turned alike" compares each piece's own local transform only** — not
  accounting for a parent group's own rotation; see
  `combine-point-text.md`'s Known Limitations for the same note in more
  detail.
- **The joined object's object-level opacity and blend mode are left at
  their defaults**, not copied from the reference piece, for the same
  newly-created-node-isn't-readable-until-the-compound-runs reason
  documented in `combine-point-text.md`.
- **A cap of 5,000 objects** across the selection refuses to run rather than
  let a pathologically large selection hang.
- **The dialog UI itself couldn't be tested the way this project's other
  scripts are** - Affinity's scripting SDK's dialogs only run in the
  native Scripts panel, not through this project's own MCP-based test
  tool. The live-preview mechanics underneath it were confirmed directly
  (that doesn't need a dialog to test), but the dialog's own wiring was
  only checked against the SDK's source, not run live. Flag it if it
  misbehaves.

## Changelog

1.2.0 - The dialog now live-previews the actual join on the real objects
as the slider moves, instead of only applying it after clicking OK.
1.1.0 - Replaced the CONFIG-only workflow for the same-line tolerance with a
small settings dialog (opens pre-filled from CONFIG's value); CONFIG now
only sets the dialog's default.
1.0.0 - Initial version.
