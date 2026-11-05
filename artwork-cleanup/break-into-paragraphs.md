# break-into-paragraphs

Splits each selected **Frame Text** or **Artistic Text** object into one
Artistic Text object per paragraph — only where you actually pressed Enter,
not per line — as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `break-into-paragraphs.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

An **approximate** port of VectorCraft's Artwork Cleanup > Break Text, in its
"by paragraphs" mode — the sibling of `break-into-lines.js` that groups
whole paragraphs into one object each, rather than giving every line its own
object. A paragraph that wrapped across several lines in a Frame Text box
keeps all of that wrapping *inside* its own piece — it still looks like
several lines, they're just forced line breaks now, not auto-wrap.

## How it works

1. For each selected Frame Text or Artistic Text object (inside selected
   groups too), skips it if it's threaded to another frame, if its text
   doesn't all fit, if it's on a path or wrapped around a shape, or if it's
   empty.
2. Finds every line the same way `break-into-lines.js` does — including
   working out Frame Text's real auto-wrapped lines by duplicating the
   frame and watching a probe's rendered height for the jump a new line
   causes. See that script's guide for exactly how and why.
3. Groups those lines back together: only a real typed paragraph break (not
   a forced line break, and not an auto-wrap) starts a new group. A
   paragraph that took five wrapped lines in the frame becomes one five-line
   group.
4. Builds one new Artistic Text object per group: each line trimmed and
   joined to the next with a forced line break, keeping each line's own
   character styling. Because nothing about the paragraph's own font, size,
   or leading has changed, Affinity's own text engine spaces those lines
   exactly the way the original paragraph was spaced — this script only has
   to place the paragraph's own top-left, not every line inside it.
5. Every probing step used to find the lines is undone, in order, before
   anything else happens — none of it is left in your undo history.
6. The original is deleted and the new paragraph pieces take its place,
   selected, all as one compound command.

## Features

- **No dialog** — select everything and run it
- **Finds real auto-wrapped lines** inside each paragraph, not just typed
  ones, in Frame Text
- **Keeps character styling** — each line's own font, size, colour and
  tracking survive
- **Single undo step** — none of the internal probing shows up in your undo
  history
- Looks inside selected groups; locked, hidden, threaded, on-path, or
  overflowing text is left alone

## Usage tips

- Use this instead of `break-into-lines.js` when you want to keep each
  paragraph together as one movable/restylable object, rather than breaking
  every line apart.
- A bulleted paragraph loses its bullet — see Known Limitations.
- A Frame Text box with text that doesn't fit is left alone rather than
  guessed at; make the box big enough to show everything first.

## Known limitations

Shares `break-into-lines.js`'s and `combine-point-text.js`'s core
limitations and for the same reason — no per-glyph position API in the
Affinity SDK:

- **Auto-wrap detection is the same height-jump heuristic**
  `break-into-lines.js` uses, with the same wide-but-not-absolute safety
  margin — see that script's Known Limitations for the detail.
- **Bulleted paragraphs lose their bullet.** The Affinity scripting SDK has
  no list/bullet API at all — nothing on `ParagraphAtts` or anywhere else —
  so there's nothing to port this feature onto. Numbered lists lose their
  numbers for the same reason VectorCraft itself drops them (no renumbering
  logic once split apart). **If a future Affinity SDK version adds a
  list/bullet API, this is a real feature to come back and add** - the
  script's `buildParagraphDefinition` function has a note marking where it
  would go.
- **Positioning is approximate**, in the same sense as the other text
  scripts in this folder — each paragraph is placed from its own measured
  bounding box, not an exact baseline/click point.
- **Threaded (linked) Frame Text, text on a path, text wrapped around a
  shape, overflowing text, and vertical text** are all handled the same way
  `break-into-lines.js` handles them.
- **The new paragraph objects' object-level opacity and blend mode are left
  at their defaults**, not copied from the original, for the same
  newly-created-node-isn't-readable-until-the-compound-runs reason
  documented in `combine-point-text.md`.
- **A cap of 3,000 words per text object** skips a pathologically large
  text object rather than probing it word by word for a very long time; a
  cap of 500 objects across the selection applies too.

## Changelog

1.0.0 - Initial version.
