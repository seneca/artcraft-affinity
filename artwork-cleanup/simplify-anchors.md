# simplify-anchors

Removes as many anchors as it can from each selected path while keeping its
outline shape, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `simplify-anchors.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Ported from VectorCraft's Artwork Cleanup > Simplify Anchors (Keep Shape).
Thins out over-dense paths — hand-drawn strokes, image traces, paths from
other apps — by removing redundant anchors and refitting the Bezier handles
beside each one, so the outline stays visually the same while needing far
fewer points to describe it.

## How it works

1. **Tolerance** (1–100) sets how far the outline is allowed to drift from
   where it was — about `tolerance × 0.02` points, matching VectorCraft's
   own dialog.
2. For every selected path (and every subpath of a compound path, and every
   path nested inside a selected group), the script repeatedly looks for the
   anchor whose removal would move the outline least. It fits a single
   Bezier segment in its place — a least-squares curve fit through points
   sampled along the two segments it replaces, holding the untouched ends'
   tangent directions fixed — and accepts the removal only if that fit
   segment stays within Tolerance of the **original** outline at that
   point, not just the most recently simplified version of it. That keeps
   small errors from quietly adding up past the tolerance over many passes.
3. This repeats, one pass at a time (never removing two neighbouring
   anchors in the same pass, so each fit is measuring the segment that
   actually results), until no more anchors can go.
4. **Protect Corners** keeps any anchor where the path turns by more than
   30°, matching VectorCraft's own threshold.
5. Open ends always stay. A closed path keeps at least three anchors; an
   open one keeps at least two.
6. All changes across the whole selection apply as one compound command.

## Features

- **Tolerance** field (1–100), with a popup slider
- **Protect Corners** checkbox
- **Live preview** while the selection is small enough (see Known
  limitations); cancel reverts cleanly, and a line under the checkbox
  updates as you adjust Tolerance or Protect Corners, reporting how many
  anchors would be removed at the current settings
- **Confirms what it did**: on OK, an alert reports how many anchors were
  removed (out of the total), or says none could be removed at this
  Tolerance — since a successful run often looks unchanged by design, this
  is the way to tell it worked
- **Single undo step**, even across many paths and compound-path subpaths
- Looks inside selected groups and compound paths for paths to simplify,
  and skips locked, hidden, or parametric (not yet curves) ones — matching
  VectorCraft's own exclusions

## Usage tips

- Start with the default Tolerance (20) and raise it if you want a more
  aggressive reduction — watch the preview for visible flattening on tight
  curves and sharp corners.
- Turn on Protect Corners for artwork with meaningful sharp points (arrows,
  stars, UI icons) so Tolerance doesn't round them off.
- Run it after Image Trace, or after pasting artwork from another app, to
  clean up paths with far more anchors than their shape actually needs.

## Known limitations

- **No live preview above 400 anchors across the selection.** The
  underlying curve fit (a least-squares Bezier fit with a golden-section
  search, repeated per candidate anchor per pass) is run in script rather
  than compiled code, and its cost scales with anchor count — fast enough
  for ordinary paths, but slow enough on thousands of anchors that updating
  it on every dialog change would make the dialog feel unresponsive. Above
  that threshold the dialog still works and Tolerance/Protect Corners still
  take effect — they're just applied once, on OK, instead of live. The
  fitting constants (sample points, golden-section rounds, Newton
  reparameterization rounds) are already tuned down from Graphics Gems'
  usual values for this reason; cutting them further starts visibly
  misplacing the refit segments.
- **Parametric shapes (rectangles, ellipses, stars, etc.) are left out.**
  VectorCraft's own version only simplifies true anchor-based paths too;
  this SDK additionally requires converting a Shape to curves
  (**Layer > Convert to Curves**) before it has editable anchors to
  simplify, which this script doesn't do automatically since that's a
  separate, visible change to the object's type.
- **A hard cap of 20,000 anchors** across the selection refuses to run
  rather than let a pathologically large selection (e.g. a dense,
  un-simplified image trace) hang the dialog for minutes.

## Changelog

1.0.1 - Retuned the fitting constants for roughly 4x the speed (confirmed on
        a 2000+ anchor path) with no visible quality loss; raised the live
        preview threshold accordingly. Added a completion alert reporting
        how many anchors were removed, since a successful run can otherwise
        look like nothing happened.
1.0.0 - Initial version.
