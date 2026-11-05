# break-into-words

Splits each selected **Frame Text** or **Artistic Text** object into one
Artistic Text object per word, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `break-into-words.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Break Text, in its
"by words" mode. Always produces Artistic Text, for both source types - a
single word is inherently a one-line thing, so there's no "should this be a
Frame Text box instead" question the way there was for
`break-into-paragraphs.js`.

This is a harder problem than `break-into-lines.js` or
`break-into-paragraphs.js`. Those only ever had to place a whole line or
paragraph - one number each (how far down the page it starts). This has to
place every word *within* its own line too, since several words share one
line, and the Affinity SDK has no API for that (the same per-glyph-position
gap documented in `combine-point-text.md`, just showing up at a finer
grain).

## How it works

1. For each selected Frame Text or Artistic Text object (inside selected
   groups too), skips it if it's threaded to another frame, if its text
   doesn't all fit, if it's on a path or wrapped around a shape, or if it's
   empty.
2. Walks the text word by word. For each word it takes two probes on a
   duplicate of the original (never touching your original): the word by
   itself (its own rendered width, with no neighbours), and the current
   line's text so far including this word (its height - a jump of more
   than about half the font's point size means this word didn't actually
   fit the current line and starts a new one instead - and its width).
3. A word's left edge within its line is the line-so-far's width minus the
   word's own width - everything rendered before it. The SDK's tight
   bounding box drops trailing white space entirely (verified directly:
   `"ab"`, `"ab "`, `"ab  "` all measure the same width), so there's no more
   direct way to read it.
4. Once a line is finished (a forced break, a word that didn't fit, or the
   end of the text), every word on it is placed using that line's own
   final, settled height - not whatever a shorter, earlier prefix of the
   same line happened to measure.
5. Every probing step is undone, in order, before anything else happens -
   none of it is left in your undo history.
6. The original is deleted and the new word objects take its place,
   selected, all as one compound command.

## Features

- **No dialog** — select everything and run it
- **Finds real auto-wrapped lines** in Frame Text, the same as
  `break-into-lines.js`, to know which words share a line
- **Keeps character styling** — each word's own font, size, colour and
  tracking survive
- **Single undo step** — none of the internal probing shows up in your undo
  history
- Looks inside selected groups; locked, hidden, threaded, on-path, or
  overflowing text is left alone

## Usage tips

- This is the most expensive of the four text-breaking scripts to run - two
  probes per word, against one per word for `break-into-lines.js` and a
  couple per paragraph for `break-into-paragraphs.js`. Expect it to take
  noticeably longer on a large selection.
- Word-to-word spacing is usually very close (consistently within a point
  or two of a real space's width in testing) but can occasionally be
  visibly off for a specific pair of words - see Known Limitations.

## Known limitations

Shares the other text scripts' core limitation and for the same reason —
no per-glyph position API in the Affinity SDK:

- **A word's own left edge is approximated**, not read directly: it's the
  line-so-far's measured width minus that word probed completely alone.
  This assumes the word renders the same width in isolation as it does
  next to its real neighbours (true for ordinary kerning almost always, but
  not guaranteed) - in testing across a 79-word paragraph, 77 of 78 gaps
  between neighbouring words landed within a point or two of each other;
  one pair measured noticeably tighter than the rest. Occasional small
  misses like this are the trade-off for not reading a real glyph position
  at all.
- **Non-left-aligned lines (centre, right, justified) are measured the
  same way as left-aligned ones** - growing a partial prefix of a centred
  or right-aligned line doesn't actually recreate how the *full* line was
  centred or right-aligned, since alignment depends on the whole line's
  width, not just the part measured so far. Word positions on such a line
  are more approximate than on a left-aligned one. Justified lines in
  particular stretch the gaps *between* words to fill the line, which this
  script's word-by-word probing has no way to detect or reproduce - it
  always places words at their natural (non-stretched) spacing.
- **Auto-wrap detection is the same height-jump heuristic**
  `break-into-lines.js` uses, with the same wide-but-not-absolute safety
  margin — see that script's Known Limitations for the detail.
- **Threaded (linked) Frame Text, text on a path, text wrapped around a
  shape, overflowing text, and vertical text** are all handled the same way
  `break-into-lines.js` handles them.
- **The new word objects' object-level opacity and blend mode are left at
  their defaults**, not copied from the original, for the same
  newly-created-node-isn't-readable-until-the-compound-runs reason
  documented in `combine-point-text.md`.
- **A cap of 1,500 words per text object** (half `break-into-lines.js`'s own
  cap, since each word here costs twice the probing) skips a pathologically
  large text object rather than probing it word by word for a very long
  time; a cap of 500 objects across the selection applies too.

## Changelog

1.0.0 - Initial version.
