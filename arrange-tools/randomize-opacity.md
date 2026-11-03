# randomize-opacity

Gives each selected object its own random opacity, as one undo step.

## Purpose

Ported from VectorCraft's Arrange Tools > Randomize Opacity. Assigns each
selected top-level object a random opacity, evenly distributed between a
Minimum and Maximum, reproducible from the same Seed.

## How it works

1. **Minimum** and **Maximum** (%) set the range; if Minimum ends up
   greater than Maximum, they're swapped rather than rejected, since this
   SDK has no way to disable OK the way VectorCraft's own dialog does.
2. **Seed** drives a small deterministic PRNG (mulberry32) — the same
   seed, selection, and range always reproduce the same opacities. It
   doesn't need to match VectorCraft's own generator bit-for-bit, only to
   be reproducible within one run of this script.
3. Each selected object, in selection order, gets the next value the PRNG
   produces, scaled into the Minimum–Maximum range.
4. All opacity changes run as one compound command.

## Features

- **Minimum** / **Maximum** (%) fields, each with a popup slider
- **Seed** field (0–999,999), with a popup slider — freshly randomized
  every time the dialog opens
- **Live preview** on every field change; cancel reverts cleanly
- **Single undo step**

## Usage tips

- Re-running with the same Seed, selection, and range reproduces the exact
  same opacities — useful for comparing Minimum/Maximum ranges without the
  randomness changing between tries.
- To intentionally get a new random result on the same selection, just
  reopen the dialog — the Seed field defaults to a fresh value every time.

## Known limitations

- **Order "Random"'s seed** is freshly randomized every time the dialog
  opens, rather than tied to a document revision counter — VectorCraft's
  own hidden default does the latter, which this SDK doesn't expose to
  scripts.

## Changelog

1.0.0 - Initial version.
