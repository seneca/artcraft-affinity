# deep-ungroup

Dissolves every selected group, recursively, down to the objects actually
inside them, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `deep-ungroup.js` into the editor and press
   **Run** — or, to keep it around, click **Save As...** to save it to the
   Script Library (**Window > Scripting > Script Library**), then click it
   there to run it any time.

## Purpose

Ported from VectorCraft's Artwork Cleanup > Deep Ungroup. Affinity's own
**Layer > Ungroup** only peels off one level of grouping at a time, so a
group nested several levels deep (common after copy-pasting artwork from
another app, or after years of grouping-on-top-of-grouping) takes repeated
runs to fully flatten. This does it all in one step.

## How it works

1. Runs immediately on the current selection — no dialog, no options.
2. For every selected group, it works downward through everything inside
   it. Each nested group it finds is dissolved the same way, all the way
   down, until it reaches objects that aren't groups, or a group that's
   locked or hidden.
3. A locked or hidden group stops the recursion right there and is kept
   whole, exactly as it was — it isn't dissolved, and nothing inside it is
   touched.
4. Everything a dissolved group leaves behind — its own objects, and any
   kept-whole locked/hidden groups found along the way — takes over that
   group's place in the stacking order, in their original relative order.
   The now-empty group shells are deleted.
5. A dissolved group's own opacity doesn't just disappear — it's folded
   into whatever ends up left in its place, multiplied together with every
   other dissolved ancestor's own opacity, so the artwork looks the same
   even though the grouping is gone.
6. Anything selected that isn't an ungroupable group (a shape, a locked or
   hidden group, an artboard) is left exactly as is, and stays selected.
7. Afterward, the selection becomes everything that was freed, plus
   anything that was left untouched — matching what you'd expect to have
   selected right after ungrouping by hand.
8. All of it — every level, every group — applies as one compound command.

## Features

- **No dialog** — select one or more groups and run it
- **Fully recursive**, unlike Affinity's own one-level-at-a-time Ungroup
- **Opacity-safe**: a dissolved group's opacity is baked into its freed
  contents rather than lost
- **Respects locks and hidden layers**: a locked or hidden group (at any
  depth) is kept whole instead of being dissolved
- **Single undo step**, however many levels or groups are involved
- **Confirms what it did**: on completion, an alert reports how many
  groups were dissolved and how many objects were freed

## Usage tips

- Select the outermost group(s) you want flattened — everything nested
  inside is handled automatically; you don't need to select the inner
  groups too.
- If a group you expected to be dissolved was left whole, check whether it
  (or an ancestor of it) is locked or hidden.
- Artboards are never treated as ungroupable groups, even though they can
  contain objects the same way a group does.

## Known limitations

- **No equivalent of VectorCraft's "clipping/clip group" handling.** The
  Affinity SDK has no scriptable way to distinguish a clip-nesting
  structure from an ordinary group, so this script doesn't try to — it
  only recognizes plain Cmd+G groups (and never artboards) as ungroupable.
  In practice this only matters if a clip structure in your document
  happens to also look like a plain group to the SDK.
- **A cap of 5,000 dissolved groups** across the whole selection refuses to
  run rather than let a pathologically large group tree hang on a single
  giant compound command.

## Changelog

1.0.0 - Initial version.
