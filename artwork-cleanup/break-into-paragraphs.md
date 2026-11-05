# break-into-paragraphs

Splits each selected **Frame Text** or **Artistic Text** object into one
object per paragraph — only where you actually pressed Enter, not per line —
as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `break-into-paragraphs.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Break Text, in its
"by paragraphs" mode — with one deliberate departure from VectorCraft's own
behaviour, closer to what Affinity itself would do:

- A **Frame Text** source's paragraphs become new **Frame Text** boxes, the
  same width as the original, left to auto-wrap on their own exactly as the
  original did - no line breaks are inserted anywhere.
- An **Artistic Text** source's paragraphs become new **Artistic Text**
  objects, same as VectorCraft's own tool - since point type has no width to
  wrap with, a paragraph's own already-typed forced line breaks (if any)
  just carry over verbatim; there's never a hidden auto-wrap point to find
  or insert for a point type source in the first place.

VectorCraft's own tool always produces point-type pieces, even from a wrapped
Frame Text paragraph, by baking each of its auto-wrap points into an explicit
forced line break. That's a reasonable choice for VectorCraft's own text
engine, but it means the result can never really *wrap* again - it's frozen
at whatever width it happened to wrap to originally. Producing a same-width
Frame Text piece instead means the result keeps behaving like a normal,
editable text box: resize it, retype it, and it reflows, the same as before
it was split apart.

## How it works

1. For each selected Frame Text or Artistic Text object (inside selected
   groups too), skips it if it's threaded to another frame, if its text
   doesn't all fit, if it's on a path or wrapped around a shape, or if it's
   empty.
2. Splits its text into paragraphs on real typed paragraph breaks (`\n`)
   only - a forced line break stays inside its paragraph, matching
   VectorCraft's own Break Text (by paragraphs).
3. For each paragraph, duplicates the original off to the side (never
   touching your original) and probes it twice: once to find the paragraph's
   own place (the original's own cumulative rendered height right up to
   where this paragraph starts, preserving whatever gap the original had
   before it), and once more with just that paragraph's own text to find its
   size and, for an Artistic Text source, its alignment-driven left edge.
4. Builds the real pieces:
   - **From a Frame Text source:** a new Frame Text box per paragraph, the
     same width as the original, sized to the paragraph's own measured
     height, with the paragraph's own real alignment (including justified
     text, which a Frame Text box supports properly) copied as-is. No forced
     line breaks - the new box wraps the plain text on its own.
   - **From an Artistic Text source:** a new Artistic Text object per
     paragraph, its text (any already-existing forced line break included)
     and character styling copied verbatim.
5. Every probing step is undone, in order, before anything else happens -
   none of it is left in your undo history.
6. The original is deleted and the new pieces take its place, selected, all
   as one compound command.

## Features

- **No dialog** — select everything and run it
- **A Frame Text source stays resizable and retypeable** — its paragraph
  pieces are real Frame Text boxes with no baked-in line breaks
- **Keeps character styling** — each paragraph's own font, size, colour and
  tracking survive
- **Keeps real paragraph alignment** on Frame Text pieces, justified text
  included — nothing is collapsed the way point type forces it to be
- **Single undo step** — none of the internal probing shows up in your undo
  history
- Looks inside selected groups; locked, hidden, threaded, on-path, or
  overflowing text is left alone

## Usage tips

- Use this instead of `break-into-lines.js` when you want to keep each
  paragraph together as one object, rather than breaking every line apart.
- A bulleted paragraph loses its bullet regardless of source type — see
  Known Limitations.
- A Frame Text box with text that doesn't fit is left alone rather than
  guessed at; make the box big enough to show everything first.
- If the original Frame Text box had custom text insets (margins), the new
  per-paragraph boxes won't - see Known Limitations.

## Known limitations

- **Bulleted paragraphs lose their bullet.** The Affinity scripting SDK has
  no list/bullet API at all — nothing on `ParagraphAtts` or anywhere else —
  so there's nothing to port this feature onto. Numbered lists lose their
  numbers for the same reason VectorCraft itself drops them (no renumbering
  logic once split apart). **If a future Affinity SDK version adds a
  list/bullet API, this is a real feature to come back and add** - the
  script's `buildFramePieceDefinition`/`buildPointPieceDefinition` functions
  have a note marking where it would go.
- **A Frame Text source's custom text insets (margins), if it has any,
  aren't carried over to the new per-paragraph boxes.** The SDK has no way
  to read a frame's insets at all, so there's nothing to copy - checked
  directly. The new boxes get Affinity's default insets, which could in
  principle make their real wrap width differ slightly from what this
  script measured (which was measured on a duplicate of the *original*,
  insets included). In practice this only matters for a frame whose insets
  were changed from the default.
- **Positioning is approximate**, in the same sense as the other text
  scripts in this folder — each paragraph is placed from its own measured
  bounding box, not an exact baseline/click point.
- **Threaded (linked) Frame Text, text on a path, text wrapped around a
  shape, overflowing text, and vertical text** are all handled the same way
  `break-into-lines.js` handles them.
- **The new pieces' object-level opacity and blend mode are left at their
  defaults**, not copied from the original, for the same
  newly-created-node-isn't-readable-until-the-compound-runs reason
  documented in `combine-point-text.md`.
- **A cap of 2,000 paragraphs per text object** skips a pathologically large
  text object rather than probing it paragraph by paragraph for a very long
  time; a cap of 500 objects across the selection applies too.

## Changelog

2.0.0 - A Frame Text source's paragraphs now become new, same-width Frame
Text boxes that auto-wrap on their own, instead of Artistic Text objects
with forced line breaks baked in at each auto-wrap point. An Artistic Text
source is unaffected by this change. This also removed the need for this
script's own word-by-word auto-wrap probing entirely (every remaining probe
works at the paragraph level), making it both closer to how Affinity itself
would do this and noticeably simpler than the 1.0.0 version.

1.0.0 - Initial version.
