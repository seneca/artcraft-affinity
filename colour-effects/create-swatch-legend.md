# create-swatch-legend

Draws a grid of labelled colour chips, one per distinct colour actually
painted somewhere in `CONFIG.SCOPE`, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `create-swatch-legend.js` into the editor and
   press **Run** - or, to keep it around, click **Save As...** to save it
   to the Script Library (**Window > Scripting > Script Library**), then
   click it there to run it any time.
3. A dialog opens for the settings below, previewing the legend live on
   the canvas as you change anything - click **OK** to keep it, or
   **Cancel** to back out without changing anything.

## Purpose

An **adapted** port of VectorCraft's Colour Effects > Create Swatch Legend.
VectorCraft's own tool draws a chip per named swatch from the document's
Swatches panel - the Affinity scripting SDK has no API at all to read that
panel (the same confirmed gap `find-nearest-swatch.md` documents in full).
This draws a chip per distinct colour actually **painted** somewhere
instead - the whole document by default, or just the selection - labelled
with its own values, since there's no swatch name to show.

## How it works

1. Gathers every distinct colour painted anywhere in `CONFIG.SCOPE` - the
   whole document by default, or just the selection - across fills,
   strokes and character-level text colour.
2. Lays them out in a grid of `CONFIG.COLUMNS` columns, each chip
   `CONFIG.CHIP_SIZE` points square with `CONFIG.GAP` between them, in the
   order each colour was first found.
3. Builds every chip (a plain filled rectangle, already the right colour)
   and, if `CONFIG.SHOW_VALUES` is on, a small label inside it showing the
   colour's hex value (and its CMYK breakdown too, in a CMYK document) -
   black text on a light chip, white text on a dark one.
4. Adds everything in one compound command - one undo step - and selects
   all of it when it's done.

## Features

- **A settings dialog with a live preview** — opens pre-filled with
  `CONFIG`'s values, and draws the actual legend on the canvas as you
  change anything, before you ever click OK
- **Checks fills, strokes and character-level text colour**, the same
  reach `print-ink-fixes.js` has
- **Chips are already the right colour the moment they're created** - no
  separate recolouring step
- **Label text always stays readable** against its own chip
- **Single undo step** for however many chips it draws

## Usage tips

- `CONFIG.SCOPE` set to `'selection'` makes a legend of just a few objects'
  colours - handy right after selecting a handful of things you're about
  to check against each other.
- Everything the script draws is selected when it finishes - press
  **Ctrl/Cmd+G** right after if you'd like it bundled into one group
  (VectorCraft's own tool draws its legend as a group; this leaves that as
  a one-key manual step instead, see Known Limitations).
- `CONFIG.X` / `CONFIG.Y` place the legend's top-left corner precisely, in
  the current spread's own coordinates, if the default (just inside its
  top-left corner) isn't where you want it.

## Known limitations

- **The legend isn't grouped** - grouping newly created nodes needs a
  second, separate command once they actually exist, which this project's
  scripts avoid in order to keep everything inside a single undo step (the
  same reason the Affinity SDK's own `makeGrid.js` example leaves its own
  grid cells ungrouped). Everything is selected when the script finishes,
  so grouping it yourself is one keystroke away if you want it.
- **Chips show colour values, not swatch names** - see Purpose above.
- **Images and pattern fills aren't looked at**, the same as VectorCraft's
  own tool leaving them out of its own legend.
- **Gradient meshes aren't looked at** - only a solid colour or a plain
  gradient's stops.
- **The dialog UI itself couldn't be tested the way this project's other
  scripts are** - Affinity's scripting SDK's dialogs only run in the
  native Scripts panel, not through this project's own MCP-based test
  tool. The live-preview mechanics underneath it were confirmed directly
  (that doesn't need a dialog to test), but the dialog's own controls and
  wiring were only checked against the SDK's source, not run live. Flag
  it if it misbehaves.

## Changelog

1.2.1 - Columns shows a whole number and the pt/position fields show
one decimal place (`setPrecision`) instead of several.
1.2.0 - The dialog now live-previews the legend on the canvas as you
change any setting, instead of only drawing it after clicking OK.
1.1.0 - Replaced the CONFIG-only workflow with a settings dialog (opens
pre-filled from CONFIG's values); CONFIG now only sets the dialog's
defaults.
1.0.0 - Initial version.
