# combine-point-text

Merges one-line point text objects that sit side by side into as few objects
as it can, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `combine-point-text.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Combine Point
Text. Fixes the same problem — text that was imported (from an SVG, a PDF,
an OCR scan) as several separate point-text fragments that together read as
one line — but with a real difference from VectorCraft's own version: see
Known Limitations before relying on this for anything where exact
positioning matters.

## How it works

1. Looks at the selection's one-line, horizontal point text objects (inside
   selected groups too). Multi-line text, text on a path, and frame text are
   left alone.
2. Groups them into **lines**: pieces that are rotated/scaled alike, look
   alike (same paint, opacity and blend mode), and whose bounding boxes sit
   at about the same height count as one line.
3. Within a line, sorts pieces left to right and splits them into **runs**
   wherever the gap between two pieces is too wide, or they overlap too
   much, to plausibly belong together.
4. Each run of two or more pieces merges into **one new text object**: every
   piece's own character styling (font, size, color, tracking — Affinity
   keeps these as character attributes) carries over, with a plain space
   inserted between pieces that don't already have one at the join.
5. The new object is positioned at the leftmost piece's own starting point;
   the original pieces are deleted.
6. All of it applies as one compound command.

## Features

- **No dialog** — select the fragments and run it
- **Keeps character styling** — each piece's own font, size, color and
  tracking survive the merge
- **Single undo step**
- Looks inside selected groups for fragments to combine
- Locked and hidden objects are left alone

## Usage tips

- Select everything you suspect is fragmented and run it once — pieces that
  don't belong together (different line, too far apart, don't look alike)
  simply won't be touched.
- If a merge comes out positioned slightly differently than you'd like,
  nudge it — this is the cost of the approximation described below.
- For multiple *lines* that should become one paragraph instead of several
  single-line objects, that's VectorCraft's **Join Point Text**, a related
  but different tool not yet ported here.

## Known limitations

**This is the one script in this project that can't make VectorCraft's own
guarantee.** VectorCraft's Combine Point Text keeps every glyph exactly
where it was — it does that by reading each glyph's rendered pixel position
and solving for the letter-spacing needed to reproduce it. The Affinity
scripting SDK has no way to read a glyph's rendered position (`storyInterface`
and the glyph APIs expose character *classification* — is it a letter, a
line break — not layout coordinates), so that guarantee can't be
reproduced. Concretely, this means:

- **Positioning is approximate.** The merged object is placed at the
  leftmost piece's own starting point (using its bounding box, which isn't
  exactly its baseline/click point for characters with descenders), and a
  plain space is inserted between pieces rather than a precisely measured
  one. Affinity's own text layout then takes over. For ordinary same-size,
  same-style fragments this looks right; the further the pieces differ, the
  less exact it gets.
- **"Same line" and gaps are judged by bounding box, not font size or
  baseline**, since neither is directly readable either. A box's height
  stands in for font size, and its vertical centre for baseline position.
- **Rotation/scale/shear are compared on each piece's own local transform
  only** — not accounting for a parent group's own rotation. Fine for a
  flat selection of plain point text (the overwhelming majority of real
  cases); a selection mixing pieces from differently-rotated ancestor
  groups may misjudge "turned alike."
- **The merged object's object-level opacity and blend mode are left at
  their defaults**, not copied from the leftmost piece, because of a deeper
  SDK constraint: a brand-new node's identity isn't available for further
  commands until the *entire* compound command has actually run, and by
  then it's too late to still be building that same compound. (Character
  color, font and size aren't affected by this — they're per-character
  attributes copied directly into the new text while it's being built, not
  object-level properties set afterward.)
- **A cap of 5,000 objects** across the selection refuses to run rather than
  let a pathologically large selection hang.

If pixel-exact positioning matters for your use case, this script isn't the
right tool for it — check each result after running it.

## Changelog

1.0.0 - Initial version.
