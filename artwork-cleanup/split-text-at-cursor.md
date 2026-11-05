# split-text-at-cursor

While a Type tool cursor or text selection sits in a selected **Frame Text**
or **Artistic Text** object, splits it into pieces at that point, as one
undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `split-text-at-cursor.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Split Text at
Cursor, built the same way `break-into-paragraphs.js` is - just splitting at
wherever your cursor is, instead of at paragraph breaks:

- A plain blinking cursor splits the text into **two** pieces: everything
  before it, and everything after.
- A text selection splits it into **three**: everything before the
  selection, the selected text itself, and everything after.

A **Frame Text** source's pieces become new Frame Text boxes the same width
as the original, left to auto-wrap on their own. An **Artistic Text**
source's pieces become Artistic Text, keeping whatever forced line breaks
(or real paragraph breaks) they already had. See `break-into-paragraphs.md`
for why this is a better match for Affinity than always producing point
type the way VectorCraft's own tool does.

This reads a **live** Type tool cursor position, not just the object
selection - confirmed directly, live, in Affinity: moving the cursor to a
place, then to the very start, then selecting a real range, were all read
back correctly via
`doc.selection.getFirstSubSelectionOfType(SubSelectionType.Text)`.

## How it works

1. Requires exactly one Frame Text or Artistic Text object selected (not on
   a path or wrapped around a shape), and a live cursor or text selection
   in it. A Frame Text object that's threaded to another frame, or whose
   text doesn't all fit, is left alone.
2. Reads where that live cursor or selection actually is.
3. Cuts the text there into two or three pieces.
4. Duplicates the original (never touching it) and, for each piece,
   measures its own trimmed text alone: its rendered size, and (for an
   Artistic Text piece) its alignment-driven left edge.
5. Builds the real pieces - a new Frame Text box per piece for a Frame Text
   source, a new Artistic Text object per piece for an Artistic Text source
   - each stacked directly beneath the one before it, starting from the
   original's own top.
6. Every probing step is undone, in order, before anything else happens -
   none of it is left in your undo history.
7. The original is deleted and the new pieces take its place, selected, all
   as one compound command.

## Features

- **No dialog** — place your cursor (or select text) and run it
- **A Frame Text source stays resizable and retypeable** — its pieces are
  real Frame Text boxes with no baked-in line breaks
- **Keeps character styling** — each piece's own font, size, colour and
  tracking survive
- **A real paragraph break inside a piece stays a real paragraph break** -
  nothing is flattened into a forced line break
- **Single undo step** — none of the internal probing shows up in your undo
  history

## Usage tips

- Click into the text with the Type tool, place your cursor (or select a
  word or phrase) exactly where you want to split it, then run the script -
  you don't need to select the object separately first; the object your
  cursor is in counts as selected.
- Because each piece is simply stacked beneath the one before it (not
  placed to preserve whatever vertical gap it had in the original - a
  cursor cut usually doesn't land on a natural boundary like a paragraph
  does, so there's no original gap to preserve in the first place), the
  pieces always end up touching, with no blank space between them.

## Known limitations

- **The original frame's own text insets (if it has any) aren't carried
  over** to a new Frame Text piece - the SDK has no way to read a frame's
  insets at all, so there's nothing to copy. See
  `break-into-paragraphs.md`'s Known Limitations for the same note in more
  detail.
- **Threaded (linked) Frame Text, text on a path, text wrapped around a
  shape, and overflowing text** are all left alone, the same as
  `break-into-paragraphs.js`.
- **The new pieces' object-level opacity and blend mode are left at their
  defaults**, not copied from the original, for the same
  newly-created-node-isn't-readable-until-the-compound-runs reason
  documented in `combine-point-text.md`.

## Changelog

1.0.0 - Initial version.
