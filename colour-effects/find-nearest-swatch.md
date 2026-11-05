# find-nearest-swatch

Reports the colours, already painted elsewhere, that are closest to each
distinct colour in your **selection** - a report only; nothing changes.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `find-nearest-swatch.js` into the editor and press
   **Run** - or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.
3. A dialog opens for the settings below, with a running summary that
   updates live as you change anything (there's nothing on the canvas to
   preview, since this script never changes the document) - click **OK**
   to see the full report, or **Cancel** to back out.

## Purpose

An **adapted** port of VectorCraft's Colour Effects > Find Nearest Swatch.
VectorCraft's own tool matches a colour against the document's named
Swatches panel. The Affinity scripting SDK has **no API at all** to read
that panel - confirmed directly, there's no way to enumerate, look up, or
even detect a named swatch from a script. So instead of a swatch library,
this matches against every colour actually **painted** somewhere in
`CONFIG.PALETTE_SCOPE` - useful for the same real question VectorCraft's
tool answers ("is there already a colour close to this one I should be
using instead?"), just without needing named swatches to ask it.

## How it works

1. Requires a selection - its own distinct colours (deduplicated) are what
   gets looked up.
2. Gathers every distinct colour painted anywhere in
   `CONFIG.PALETTE_SCOPE` - the whole document by default, or just the
   selection.
3. For each of the selection's own colours, ranks every palette colour by
   **ΔE (CIEDE2000)** - a well-established, perceptually-weighted colour
   difference metric, the same one VectorCraft's own tool uses - closest
   first.
4. Reports the top `CONFIG.COUNT` matches for each, both in an alert and in
   the Script Editor's console (in case the alert runs long).

## Features

- **A settings dialog with a live summary** — select your objects, run
  it, and a dialog opens pre-filled with `CONFIG`'s values, showing a
  running count of colours and matches as you change anything
- **Checks fills, strokes and character-level text colour**, the same
  reach `print-ink-fixes.js` has
- **ΔE under ~1 is essentially imperceptible, ~2-3 is a close match** - a
  handy rule of thumb when reading the report
- **Changes nothing** — purely a report

## Usage tips

- A ΔE of 0.00 against your own colour just means that colour is painted
  somewhere else too (or, with `CONFIG.PALETTE_SCOPE` left at `'document'`,
  trivially against itself) - not a bug, just confirmation it's already in
  use.
- Set `CONFIG.PALETTE_SCOPE` to `'selection'` to compare the selected
  objects' colours only against each other, ignoring the rest of the
  document - handy for spotting near-duplicate colours within one group of
  objects you're about to clean up.

## Known limitations

- **Matches against colours actually used, not named swatches** - see
  Purpose above. There's no name or spot-colour flag to show, just the
  colour's own values.
- **Images and pattern fills aren't looked at**, the same as VectorCraft's
  own tool leaving them out of its own colour matching.
- **Gradient meshes aren't looked at** - only a solid colour or a plain
  gradient's stops.
- **The dialog couldn't be tested the way this project's other scripts
  are** - Affinity's scripting SDK's dialogs only run in the native
  Scripts panel, not through this project's own MCP-based test tool, so
  this one was checked carefully against the SDK's own source rather than
  run live before shipping. Flag it if it misbehaves.

## Changelog

1.2.0 - The dialog now shows a running summary (colours found, matched
against how many) that updates as you change any setting.
1.1.0 - Replaced the CONFIG-only workflow with a settings dialog (opens
pre-filled from CONFIG's values); CONFIG now only sets the dialog's
defaults.
1.0.0 - Initial version.
