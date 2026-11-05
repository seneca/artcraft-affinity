# vector-halftone

Turns the one selected object into real vector halftone dots sized by its
own tone, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `vector-halftone.js` into the editor and press
   **Run** - or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.
3. A dialog opens for the settings below. Combo boxes and checkboxes
   preview the actual dots live; while dragging a slider you'll see a
   quick dot-count estimate instead (rendering live from a real bitmap on
   every tick of a drag would be too slow) - let go, and it snaps to the
   real preview. Click **OK** to keep it, or **Cancel** to back out
   without changing anything.

## Purpose

An **approximate** port of VectorCraft's Colour Effects > Vector Halftone.
Unlike Affinity's own Halftone (a raster live filter), this draws genuine
vector geometry - real dot, square, diamond or line shapes you can scale,
recolour or edit like any other path - sized by how dark (or light) the art
is in each cell of a grid turned by your chosen screen angle.

## How it works

1. Requires exactly one object selected - a group counts as one, so group
   several objects together first if you need to.
2. Works out the cell size from `CONFIG.FREQUENCY` (lines per inch) and
   renders the object to a real bitmap over its own bounds, inflated by one
   cell - at roughly 4 pixels per cell, capped so it never allocates an
   enormous image.
3. For `CONFIG.MODE` `"mono"`: one screen, reading each cell's lightness
   (so a dark area gets a big dot). For `"cmyk"`: four screens, one per
   process ink at the classic offset angles, reading the art's own
   **colour-managed** ink percentages, not a naive RGB guess.
4. Each cell's tone sizes its own dot - a circle's radius, say, grows with
   the square root of the tone, so its *area* follows the tone linearly.
5. Every dot of one screen becomes one real multi-shape path object, filled
   with that screen's ink (or, with `CONFIG.FROM_ART`, each dot takes the
   art's own colour under it instead).
6. The dots replace the original object (or sit alongside it, with
   `CONFIG.KEEP_ORIGINAL` on) as one undo step, and are selected when it's
   done.

## Features

- **Real vector output** — dots are actual editable paths, not a raster
  effect
- **A settings dialog with a live preview** — opens pre-filled with
  `CONFIG`'s values; combo boxes and checkboxes preview the real dots
  immediately, sliders show a quick estimate while dragging and the real
  dots once released
- **Genuine colour-managed CMYK separation** in `"cmyk"` mode, not a naive
  conversion
- **Five dot shapes** — circle, ellipse, square, diamond, line
- **"Take each dot's colour from the art underneath"** — Mono mode only
- **Single undo step**

## Usage tips

- **Frequency** is lines per inch, the same units a halftone screen is
  always described in - lower numbers mean bigger, coarser dots.
- A frequency that's too fine for a large object is refused outright
  ("Too many dots for this size") rather than left to grind - lower it, or
  work on a smaller selection.
- **Angle** is the mono screen's angle, or the black screen's in CMYK mode -
  cyan, magenta and yellow sit at their own classic offsets from it
  automatically.
- Turn on **Keep the original object** the first time you try a new setting
  on something, so you can compare the dots against the original before
  deciding to replace it.

## Known limitations

- **Dots aren't clipped to the art's own outline** - VectorCraft's own tool
  can clip dots exactly to a non-rectangular shape's silhouette; this
  always covers the object's full rectangular bounds instead, so a dot
  near a shape's edge may extend slightly past it. Affinity's scripting SDK
  does expose boolean path operations that could add this later.
- **`"cmyk"` mode's four screens aren't given a Multiply blend mode** -
  VectorCraft's own tool overlays them that way so the inks visually
  combine; here they're added as ordinary separate layers (all selected
  when the script finishes, so setting Multiply yourself is one blend-mode
  change away if you want the classic look).
- **The four `"cmyk"` layers aren't grouped** - the same reason
  `create-swatch-legend.js`'s chips aren't: grouping newly created nodes
  needs a second, separate command once they exist. They're all selected
  when the script finishes.
- **Images inside a group are sampled as rendered**, same as everything
  else in the selection - there's no separate "image couldn't be decoded"
  warning the way VectorCraft's own tool gives; a render that comes out
  blank there would still just sample as blank here.
- **The dialog UI itself couldn't be tested the way this project's other
  scripts are** - Affinity's scripting SDK's dialogs only run in the
  native Scripts panel, not through this project's own MCP-based test
  tool. The preview mechanics underneath it (that an add-plus-delete
  compound reverts cleanly) were confirmed directly, since that doesn't
  need a dialog to test - but the dialog's own controls, wiring, and
  specifically whether a slider's `transient` flag behaves as assumed
  (true while dragging, false on release or on any discrete control)
  were only checked against the SDK's source, not run live. Flag it if
  it misbehaves - in particular if the slider estimate never snaps to a
  real preview, or if the real preview runs on every drag tick and feels
  slow.

## Changelog

1.2.0 - The dialog now live-previews the actual dots as you change a
combo box or checkbox, and a quick dot-count estimate while dragging a
frequency/angle slider (snapping to the real preview on release) - the
full render-and-sample pass is too slow to run on every drag tick.
1.1.0 - Replaced the CONFIG-only workflow with a settings dialog (opens
pre-filled from CONFIG's values); CONFIG now only sets the dialog's
defaults.
1.0.0 - Initial version.
