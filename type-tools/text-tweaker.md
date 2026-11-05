# text-tweaker

Gives one character attribute to the selected text, letter by letter, from
a start value to an end value along a shape - a bow, a spike, an eased
ramp, a straight ramp, or at random - as one undo step. The text stays
live and fully editable afterward.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `text-tweaker.js` into the editor and press
   **Run** - or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.
3. A dialog opens for the settings below - change what you want and click
   **OK**, or **Cancel** to back out without changing anything.

## Purpose

An **approximate** port of VectorCraft's Type Tools > Text Tweaker.
VectorCraft's own source notes that even Illustrator has no command for
this - it's a genuinely distinctive effect, not a scripted stand-in for
something already a menu click away: the classic "letters grow across a
word," "text that waves up and down," or "each letter randomly tilted and
sized" look, built directly into the character styling, not a live effect
that could come undone.

## How it works

1. Works out what to tweak, the same priority VectorCraft's own tool uses:
   a live Type tool text selection in one object; else, with just a
   blinking cursor, all of that object's text; else every selected type
   object, each getting its own independent ramp.
2. Within each object's range, counts the characters that matter (skipping
   spaces and line breaks when `CONFIG.SKIP_SPACES` is on, the default).
3. For each one, works out how far along `CONFIG.SHAPE` it sits (0 at the
   first, 1 at the last) and the value that gives, between `CONFIG.FROM`
   and `CONFIG.TO`.
4. Writes that value into just that one character's own styling, the same
   way the Character panel would.
5. Queues all of it as one compound command - the whole ramp, across
   however many characters and objects, becomes a single **Undo**.

## Features

- **A settings dialog** — opens pre-filled with `CONFIG`'s values, so you
  can either edit `CONFIG` for new defaults or just change things in the
  dialog each time
- **The text stays completely live** — select it, retype it, restyle it
  afterward like anything else
- **Five shapes** — straight, ease, bow, spike, random
- **Works with a live Type tool selection**, not just whole objects -
  tweak just a few letters without having to split them out first
- **Single undo step**

## Usage tips

- Click into the text with the Type tool and select just the letters you
  want tweaked before running it, if you don't want the whole object - the
  object your cursor is in counts as selected, the same as this project's
  other live-cursor scripts. Do this *before* running the script - the
  target text is locked in before the dialog opens.
- The dialog's **Attribute** units match VectorCraft's own: Horizontal/
  Vertical scale are percent (100 = unchanged), Tracking is 1/1000 em
  (VectorCraft's own unit, matching Illustrator's), everything else is in
  points. The dialog's From/To fields are plain numbers - they don't
  relabel themselves per attribute, so keep the chosen attribute's units
  in mind when typing a value.
- `"bow"` and `"spike"` both rise from `CONFIG.FROM` at both ends to
  `CONFIG.TO` in the middle - `"bow"` smoothly, `"spike"` as a sharp
  triangular peak. `"ease"` runs start-to-end like `"straight"` but eases
  in and out at both ends instead of moving at a constant rate.
- `"random"`'s sequence is deterministic for a given `CONFIG.SEED` and
  text (run it twice with the same settings and get the same result), but
  it is **not** the same sequence VectorCraft's own tool would produce for
  that seed - there was no way to match its own, undocumented generator,
  so this uses its own.

## Known limitations

- **`"rotation"` isn't included.** Confirmed directly: Affinity's own
  character-styling model (`GlyphAtts`) has no per-character rotation
  attribute at all - only a shear/skew property, which slants a letter
  rather than spinning it, so it wasn't used as a stand-in. **Revisit this
  once Affinity's scripting SDK exposes a real per-character rotation
  attribute.**
- **`"strokeWidth"` isn't included.** VectorCraft's own version is a minor
  attribute even there ("stroke weight only shows on characters with a
  stroke"); a first attempt at writing a character's line weight through
  its own `lineStyleDescriptor` didn't take (the value read back
  unchanged), and it wasn't worth the extra time to track down for this
  version. **Revisit this once that mechanism is understood** - the
  building blocks (`GlyphAtts.lineStyleDescriptor`, `GlyphAtts.penFill`)
  do exist, they just need more investigation than this version got.
- **A character outside the Basic Multilingual Plane** (most emoji, some
  rarer scripts) **may count as two characters for the ramp** instead of
  one - VectorCraft's own tool addresses Unicode scalars directly; this
  addresses the same UTF-16 code-unit positions Affinity's own SDK uses
  for text ranges, which can split such a character across two of them.
- **The dialog doesn't switch From/To's default values per attribute** the
  way VectorCraft's own tool does - whatever was last typed (or `CONFIG`'s
  starting values) carries over when you switch Attribute, so re-check
  From/To's units after changing it.
- **The dialog couldn't be tested the way this project's other scripts
  are** - Affinity's scripting SDK's dialogs only run in the native
  Scripts panel, not through this project's own MCP-based test tool, so
  this one was checked carefully against the SDK's own source rather than
  run live before shipping. Flag it if it misbehaves.

## Changelog

1.1.0 - Replaced the CONFIG-only workflow with a settings dialog (opens
pre-filled from CONFIG's values); CONFIG now only sets the dialog's
defaults.
1.0.0 - Initial version.
