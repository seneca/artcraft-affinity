# break-into-lines

Splits each selected **Frame Text** or **Artistic Text** object into one-line
Artistic Text pieces, one per line, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `break-into-lines.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Break Text, in its
"by lines" mode — the opposite direction from `combine-point-text.js` and
`join-point-text.js`, which weld Artistic Text fragments back together. This
one takes apart a block of text (typed into either a Frame Text box or a
multi-line Artistic Text object) into one Artistic Text object per line,
keeping each line's own font, size, colour and other character styling, and
leaving it exactly where that line was.

A "line" here means every line you'd actually see: lines you get from
pressing Enter, lines from a forced line break (Shift+Enter), **and** lines
that exist only because a Frame Text box auto-wrapped a long paragraph
to fit its width.

## How it works

That last part — auto-wrapped lines — is the hard part, and the reason this
script exists at all rather than just splitting on `\n`. The Affinity SDK has
no API that tells you where a frame actually wrapped a line (the same
per-glyph-position gap documented in `combine-point-text.md`), so this script
works it out itself:

1. For each selected Frame Text or Artistic Text object (inside selected
   groups too), skips it if it's threaded to another frame, if its text
   doesn't all fit, if it's on a path or wrapped around a shape, or if it's
   empty.
2. For Artistic Text (which never auto-wraps — it has no fixed width), lines
   are just the text split on its own typed line breaks.
3. For Frame Text, it duplicates the frame off to the side (never touching
   your original), then grows a copy of its text one word at a time, after
   each word reading the duplicate's own rendered height. Adding a word that
   fits the current line barely moves that height; adding a word that starts
   a new (wrapped) line jumps it by roughly a full line's height — the same
   thing you'd see happen on screen, just read back as a number instead of
   watched with your eyes. A typed line break is simpler still: it's a known
   line boundary, no probing needed for it.
4. Once every line's text range is known, it probes each one standing alone
   to find where it would sit on its own (respecting left/centre/right
   alignment), and combines that with the running height from step 3 to
   place it.
5. Every probing step on the duplicate is then undone, in order, before
   anything else happens — none of it is left in your undo history.
6. Only then does the script build the real result: one new Artistic Text
   object per line (keeping that line's own character styling), and deletes
   the original. All of this is one compound command, so one **Undo**
   reverts the whole thing.

## Features

- **No dialog** — select everything and run it
- **Finds real auto-wrapped lines**, not just typed ones, in Frame Text
- **Keeps character styling** — each line's own font, size, colour and
  tracking survive
- **Single undo step** — none of the internal probing shows up in your undo
  history
- Looks inside selected groups; locked, hidden, threaded, on-path, or
  overflowing text is left alone

## Usage tips

- Use this when you want to grab, move, or restyle individual lines of a
  paragraph as separate objects — the reverse of what `join-point-text.js`
  does.
- If a Frame Text box has text that doesn't fit (its box is too small), this
  script leaves it alone rather than guess at the part you can't see — make
  the box big enough to show everything first.
- A huge Frame Text object (many thousands of words) is left alone too,
  rather than taking a very long time probing word by word; see Known
  Limitations.

## Known limitations

Shares `combine-point-text.js`'s core limitation and for the same reason —
no per-glyph position API in the Affinity SDK:

- **Auto-wrap detection is a heuristic, not a read of the real layout.** It
  tells lines apart by watching a probe's rendered height jump by more than
  half the current font's point size. This has a wide safety margin in
  testing (a real line's jump was consistently many times bigger than the
  noise one tall or deep glyph alone can add), but an unusual font, a very
  tightly set leading, or a huge jump in character size mid-paragraph could
  in principle confuse it.
- **The probe used to measure wrapping assumes fairly uniform character
  styling within a paragraph.** It measures using plain text, not the
  original's exact mix of styles, so a paragraph that changes font or size
  markedly partway through a wrapped line could probe a slightly different
  wrap point than what you actually see — though the **output** pieces
  always keep each character's true original styling regardless.
- **Positioning is approximate** in the same sense as `combine-point-text.js`
  and `join-point-text.js` — each line is placed from its own measured
  bounding box, not an exact baseline/click point.
- **Threaded (linked) Frame Text, text on a path, text wrapped around a
  shape, and overflowing text are all left alone entirely**, not guessed at.
- **Vertical text isn't specially detected** — the SDK doesn't expose a way
  to check for it — so running this on vertical type isn't recommended.
- **The new line objects' object-level opacity and blend mode are left at
  their defaults**, not copied from the original, for the same
  newly-created-node-isn't-readable-until-the-compound-runs reason
  documented in `combine-point-text.md`.
- **A cap of 3,000 words per text object** skips a pathologically large
  Frame Text object rather than probing it word by word for a very long
  time; a cap of 500 objects across the selection applies too.

## Changelog

1.0.0 - Initial version.
