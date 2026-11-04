# check-and-fix

Scans the selection (or the whole document if nothing is selected) for everyday
mess and fixes every bit of it, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `check-and-fix.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Ported from VectorCraft's Artwork Cleanup > Document Health Check, specifically
its "Fix All Issues" command — the one that runs every one of the Health
Check's findings through its fix in a single step, rather than reviewing and
fixing them one kind at a time. Cleans up the small, easy-to-miss debris that
builds up in a document: invisible objects nobody can see are still there,
anchors nobody needed are still being dragged around, groups that do nothing
are still one more click to get through.

## How it works

Runs immediately on the current selection (or the whole document, if nothing
is selected) — no dialog, no options. It looks for:

- **Empty Text** — text objects with no actual characters — removed.
- **Stray Points** — paths with one anchor or none — removed.
- **Unpainted Objects** — paths with no fill and no stroke — removed.
- **Zero-Opacity Objects** — anything at 0% opacity — removed.
- **Duplicate Objects** — a path stacked directly on an identical copy of
  itself (same shape, same position, same plain-colour fill/stroke) — the
  lower one removed.
- **Off-Artboard Art** — objects lying entirely outside every artboard (only
  checked for top-level objects in the selection or document, and only when
  the document has artboards) — removed.
- **Duplicate Anchors** — anchors right on top of each other, on the same
  path — merged into one.
- **Tiny Handles** — Bezier handles too short to do anything — retracted flat.
- **Collinear Anchors** — an anchor sitting on an otherwise-straight run —
  removed.
- **Nearly Coincident Anchors** — anchors on *different* paths that are
  almost touching — snapped together.
- **Nearly Closed Paths** — an open path whose two ends are a hair apart —
  closed.
- **Filled Open Paths** — a filled, unstroked open path — closed to match how
  it already looks.
- **Needless Groups** — a plain group (full opacity, normal blending, no
  effects) with one member or none — dissolved, folding its own opacity into
  whatever's left in its place.
- **Empty Artboards** — artboards with no art touching them (whole-document
  checks only) — removed, with their guides.

Everything above runs in one pass over the document as it currently stands —
see Known Limitations for what that means for a fix that would itself expose
another one. All of it applies as a single compound command, and the objects
left afterward (whatever survived, plus anything that was never touched)
become the selection, same as a normal run of any of these fixes by hand would
leave you with.

## Features

- **No dialog** — select what you want checked (or nothing, for the whole
  document) and run it
- **Confirms what it did**: on completion, an alert breaks down how many of
  each kind of issue were fixed
- **Single undo step**, however many kinds and objects were involved
- **Locked and hidden objects are left alone** — matching every other script
  in this category
- Looks inside groups (and artboards) for things to check and fix

## Usage tips

- Run it on the whole document (nothing selected) occasionally as a general
  tidy-up, or on a specific selection right after an import/paste you suspect
  brought in debris.
- Duplicate Objects is intentionally conservative: it only recognizes a
  duplicate when both objects have a plain solid-colour fill/stroke (or none).
  A gradient, bitmap, hatch, mesh or diffusion fill is never compared, so it's
  never wrongly called a duplicate — if your duplicates use one of those,
  this won't catch them.
- If you have objects you don't want touched, lock or hide them first — every
  check here skips locked and hidden objects, the same as VectorCraft's own
  Health Check does.

## Known limitations

- **Two of VectorCraft's 16 Health Check kinds have no port here**:
  - *Needless Compound Paths* doesn't apply to Affinity at all — a compound
    path in VectorCraft is its own wrapper node, but in Affinity a compound
    path is just one path object with more than one subpath; there's no
    separate wrapper to ever be "needless."
  - *Needless Clipping Groups* is left out for the same reason Deep Ungroup
    leaves out clip-group handling: the Affinity SDK has no scriptable way to
    tell a clipping group apart from a plain one.
- **One pass, not several.** VectorCraft's own Fix All runs up to three full
  rounds, since fixing one kind of issue can expose another (dissolving a
  needless group can suddenly put two duplicates side by side). This script
  resolves structural fixes (deletions and needless-group unwrapping)
  bottom-up in a single recursive pass, which already catches the most common
  case — a group left empty or with one member after its contents were
  cleaned up — but a rarer multi-step cascade (e.g. unwrapping exposing a
  *new* duplicate pair that then needs its own duplicate check) won't be
  caught until you run the script again.
- **Off-Artboard Art and Empty Artboards are only as good as this session's
  testing could confirm against a document with real artboards** — the
  mechanics (bounding-box overlap against each artboard's rect) were
  verified by code review and reuse the same spread-space bounding-box
  pattern as `arrange-in-grid.js`, but weren't exercised against a live
  artboard during development. If something looks off here, it's the first
  place to check.
- **A cap of 20,000 objects** across the selection (or document) refuses to
  run rather than let a pathologically large document hang.

## Changelog

1.0.0 - Initial version.
