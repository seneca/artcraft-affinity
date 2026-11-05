# break-into-glyphs

Splits each selected **Frame Text** or **Artistic Text** object into one
Artistic Text object per rendered glyph, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `break-into-glyphs.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Break Text, in its
"by glyphs" mode — the finest-grained of the four. VectorCraft reads its own
text-shaping engine to know exactly which characters became one rendered
glyph: a font ligature (e.g. "fi" fused into a single shape) or a base
character with its own combining accent mark both stay together as one
piece.

The Affinity SDK has nothing like this at all — checked directly: `GlyphType`
only tells apart things like an ordinary character versus a cross-reference
or a page-number field, never whether two characters were shaped into one
glyph. So this script instead splits on **Unicode grapheme clusters** (via
JavaScript's own `Intl.Segmenter`, confirmed available in Affinity's
scripting engine) — the closest honest match available: a base letter with
its own accent mark, or a multi-part emoji, stays one piece, but an actual
font ligature does not, since that's a font-rendering choice Unicode itself
doesn't encode.

## How it works

Placing each glyph needed a different approach than
`break-into-lines.js`/`break-into-words.js` use, found by testing: growing a
probe's text one grapheme at a time, the way those scripts grow a probe one
line or one word at a time, does not correctly find where a line wraps. A
real test showed a word wrapping *mid-word* this way, because when a
probe's text only has the first letter or two of a word typed into it so
far, Affinity reasonably decides whether *that* fits - it has no way to know
the rest of the word is coming. The real original text never had this
problem, because the whole word was always there when Affinity made its one
real wrapping decision.

So this script finds lines first, the same way `break-into-lines.js` does -
word by word, which is the granularity Affinity's own wrapping actually
happens at - and only afterwards, within each line's own now-fully-known
text, probes grapheme by grapheme for each glyph's own place:

1. For each selected Frame Text or Artistic Text object (inside selected
   groups too), skips it if it's threaded to another frame, if its text
   doesn't all fit, if it's on a path or wrapped around a shape, or if it's
   empty.
2. Finds every line, exactly as `break-into-lines.js` does (word by word,
   watching a duplicate's own rendered height for the jump a new line
   causes, for a Frame Text source; just its already-typed forced breaks,
   for an Artistic Text source).
3. Splits each line's own text into Unicode grapheme clusters, skipping
   whitespace (it has no glyph of its own).
4. For each glyph, probes the line's text so far (up to and including this
   glyph) and the glyph completely alone, and subtracts the two widths to
   find its left edge within the line - the same trick
   `break-into-words.js` uses for a word's own left edge, one level finer.
5. Every probing step is undone, in order, before anything else happens -
   none of it is left in your undo history.
6. The original is deleted and the new glyph objects take its place,
   selected, all as one compound command.

## Features

- **No dialog** — select everything and run it
- **Keeps a combining accent mark or a multi-part emoji together** as one
  piece, even though it can't do the same for a font ligature
- **Finds real auto-wrapped lines** in Frame Text, the same as
  `break-into-lines.js`/`break-into-words.js`, to know which glyphs share a
  line
- **Keeps character styling** — each glyph's own font, size, colour and
  tracking survive
- **Single undo step** — none of the internal probing shows up in your undo
  history
- Looks inside selected groups; locked, hidden, threaded, on-path, or
  overflowing text is left alone

## Usage tips

- This is the most expensive of the four text-breaking scripts to run - a
  typical word has several glyphs, each costing the same two probes a
  whole word costs in `break-into-words.js`. Expect it to take noticeably
  longer than any of the others on anything but a short selection.
- A font ligature (common in some typefaces for pairs like "fi", "fl",
  "ffi") comes out as separate letter pieces, not one piece - see Known
  Limitations.
- Verified directly on a 434-glyph, 3-paragraph Frame Text object: correct
  wrapping, correct paragraph spacing, and the glyphs' own text, read back
  in order, exactly reconstructs the original (minus the whitespace between
  them, which was never meant to become a piece of its own).

## Known limitations

Shares the other text scripts' core limitation and for the same reason —
no per-glyph position API in the Affinity SDK:

- **A font ligature is split into its separate letters**, not kept as one
  piece - the SDK has no way to tell that two characters shaped into one
  rendered glyph, so there's nothing to detect this with.
- **A glyph's own left edge is approximated**, not read directly - the
  same trick, and the same occasional small miss, documented in
  `break-into-words.md`'s Known Limitations (there, for a whole word; here,
  for one glyph).
- **Non-left-aligned lines (centre, right, justified) are measured the
  same way as left-aligned ones**, for the same reason documented in
  `break-into-words.md` - growing a partial prefix of a centred or
  right-aligned line doesn't recreate how the *full* line was aligned.
- **Auto-wrap detection is the same height-jump heuristic**
  `break-into-lines.js` uses, with the same wide-but-not-absolute safety
  margin — see that script's Known Limitations for the detail.
- **Threaded (linked) Frame Text, text on a path, text wrapped around a
  shape, overflowing text, and vertical text** are all handled the same way
  `break-into-lines.js` handles them.
- **The new glyph objects' object-level opacity and blend mode are left at
  their defaults**, not copied from the original, for the same
  newly-created-node-isn't-readable-until-the-compound-runs reason
  documented in `combine-point-text.md`.
- **A cap of 3,000 words per text object** (to find lines) and **1,500
  glyphs per text object** (to place them) skip a pathologically large text
  object rather than probing it for a very long time; a cap of 500 objects
  across the selection applies too.

## Changelog

1.0.0 - Initial version.
