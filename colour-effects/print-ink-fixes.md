# print-ink-fixes

Prepares a **CMYK document's** inks for print, as one undo step: scales down
colours with too much combined ink, turns off overprint on white, and turns
on overprint for black - the selection, or the whole document while nothing
is selected.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `print-ink-fixes.js` into the editor and press
   **Run** - or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.
3. A dialog opens for the settings below, previewing every fix live on
   the real artwork as you change anything - click **OK** to keep it, or
   **Cancel** to back out without changing anything.

## Purpose

A port of VectorCraft's Colour Effects > Print Ink Fixes. CMYK colours that
add up to more combined ink than a press can hold cause problems at print
time (slow drying, cracking, show-through); white ink set to overprint can
go missing over a dark background; black ink set to knock out instead of
overprint can leave a hairline gap at its edges. This script fixes all three
at once, across everything you choose.

## How it works

1. Refuses to run outside a CMYK document - choose **File > Document Color
   Mode > CMYK Color** first, the same requirement VectorCraft's own tool
   has.
2. Looks at `CONFIG.SCOPE` to decide what to search: the selection, the
   whole document, or (by default) whichever of those applies - the
   selection if you have one, the whole document if you don't.
3. Walks into every group and nested object it finds there, and for each
   one:
   - Checks its own fill and stroke (a text object's is its frame's
     background, not its characters') - a solid colour, or every stop of a
     gradient.
   - Checks every character run of its own text, if it has any, the same
     way - each run's own fill and stroke ink, independently.
4. For each CMYK colour found, in order:
   - If `CONFIG.INK_LIMIT` is set and its total ink is over it, scales C, M,
     Y and K down together until the total matches - unless it's pure black
     ink (no cyan, magenta or yellow) and `CONFIG.EXCLUDE_PURE_BLACK` is on,
     which is left alone either way.
   - If `CONFIG.REMOVE_WHITE_OVERPRINT` is on and the colour is white and
     currently overprinting, turns that off.
   - If `CONFIG.OVERPRINT_BLACK` is set and the colour is black ink at or
     past that percentage and isn't already overprinting, turns that on.
5. Queues a command for everything that changed and runs it all as one
   compound command - the whole thing becomes a single **Undo**.

## Features

- **A settings dialog with a live preview** — opens pre-filled with
  `CONFIG`'s values, and updates the actual artwork as you change anything,
  before you ever click OK
- **Fixes fills, strokes and character-level text colour** in the same pass
- **Keeps blend mode, transform and everything else about a fill exactly as
  it was** — only the colour itself (and its overprint flag) changes
- **A gradient's stops are each checked and fixed on their own**, not forced
  to match each other
- **Single undo step** for however many fixes it makes

## Usage tips

- All three fixes are off by default - turn on at least one of **Ink
  limit**, **Turn on overprint at this black ink %**, or **Turn off
  overprint on white** in the dialog.
- The ink limit is a percentage of combined C+M+Y+K, so 100 means "one
  full channel's worth," not "fully saturated in every channel" (which would
  be 400). A common press limit is 240-300.
- **Limit the overprint-black fix to text only** only narrows the
  overprint-black fix - it decides whether a *shape's* own fill/stroke
  counts as eligible for it alongside text. Ink limiting and white-overprint
  removal always apply everywhere regardless of this setting, matching
  VectorCraft's own tool.
- Run it once with everything you want set, rather than multiple times with
  different settings - each run is its own separate undo step.

## Known limitations

- **Bitmap, hatch, mesh and diffusion fills aren't touched** - only a solid
  colour or a plain gradient's stops. VectorCraft's own tool also limits
  gradient-mesh ink; this doesn't reach meshes at all.
- **Overprint is checked and fixed per gradient stop, not per whole
  gradient** - a deliberate difference from VectorCraft, which requires
  every stop of a gradient to qualify before touching any of them. In
  Affinity, overprint is a property of each colour value itself, so each
  stop is judged on its own.
- **Spot colours and Registration aren't limited or touched** - this script
  only ever looks at a colour's own CMYK value, the same as VectorCraft's
  own tool leaving spot inks and Registration alone.
- **Images and pattern fills aren't touched**, the same as VectorCraft's own
  tool.
- **The dialog UI itself couldn't be tested the way this project's other
  scripts are** - Affinity's scripting SDK's dialogs only run in the
  native Scripts panel, not through this project's own MCP-based test
  tool. The live-preview mechanics underneath it were confirmed directly
  (that doesn't need a dialog to test), but the dialog's own controls and
  wiring were only checked against the SDK's source, not run live. Flag
  it if it misbehaves.

## Changelog

1.2.2 - Restored the ink-limit/overprint-black fields' popup sliders
(briefly removed in 1.2.1) - the real cause of the live preview
appearing not to work turned out to be a bug in vector-halftone.js's
dialog, not a general problem with popup sliders; see that script's own
changelog.
1.2.1 - (superseded) Removed the ink-limit/overprint-black fields'
popup sliders, believing dragging one didn't trigger the live preview.
1.2.0 - The dialog now live-previews every fix on the real artwork as you
change any setting, instead of only applying it after clicking OK.
1.1.0 - Replaced the CONFIG-only workflow with a settings dialog (opens
pre-filled from CONFIG's values); CONFIG now only sets the dialog's
defaults.
1.0.0 - Initial version.
