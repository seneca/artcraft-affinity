# replace-missing-fonts

Scans the **whole document** — every page, not just the selection or the
current one — for any text using a font family that isn't actually
available, and replaces it with a font you choose, as one undo step.

## Installation

1. Open the Script Editor panel (**Window > Scripting > Script Editor**).
2. Paste the contents of `replace-missing-fonts.js` into the editor and
   press **Run** — or, to keep it around, click **Save As...** to save it
   to the Script Library (**Window > Scripting > Script Library**), then
   click it there to run it any time.
3. A small dialog opens asking for the replacement font's family name -
   type it and click **OK**, or **Cancel** to back out without changing
   anything.

## Purpose

A port of VectorCraft's Artwork Cleanup > Replace Missing Fonts. If a
document references a font that isn't installed on your system, this finds
every piece of text using it and swaps in a font you specify instead —
picking whichever **style** of that replacement family (Regular, Bold,
Italic, Bold Italic, ...) is closest to what the missing font was actually
set to, so a bold or italic run doesn't come back as plain Regular.

Unlike this folder's other scripts, this one needs no selection at all — it
checks the entire document on its own, the same way VectorCraft's own tool
does, including inside Symbols: Affinity keeps no separate hidden copy of a
Symbol's own content that a script can't see, so an instance's art and text
already show up as ordinary objects this script's normal search already
walks into.

## How it works

1. Asks for a replacement font family name in a small dialog (pre-filled
   with `CONFIG.REPLACEMENT_FONT`), then looks it up among the fonts
   actually installed on your system. If it isn't there, stops and tells
   you to run it again with a family name that is.
2. Walks every page of the document, into every group and nested object,
   looking for anything with its own text.
3. For each one, checks every run of its text (a run is a stretch of
   characters that all share the same styling) for whether its font is
   actually available - the same way Affinity's own Font panel would
   notice: a font whose family isn't installed resolves with no real face
   behind it, which shows up as an empty postscript name.
4. For each run whose font is missing, finds whichever style of the
   replacement family is closest to what that run's font was actually set
   to (its weight, italic, and width), and queues a command to change just
   that run to it.
5. If anything was queued, runs it all as one compound command - the whole
   document's worth of fixes becomes a single **Undo**.

## Features

- **A one-field dialog** — no selection needed, just the replacement font's
  family name, pre-filled from `CONFIG.REPLACEMENT_FONT`
- **Keeps bold/italic styling** — a run's closest matching style in the
  replacement family is used, not always its plain Regular
- **Checks the whole document**, every page, not just what's in front of
  you
- **Reaches into Symbols** automatically, the same as everything else
- **Single undo step** for however many fixes it makes

## Usage tips

- The dialog's field defaults to **Arial**, chosen for being close to
  universally available on both macOS and Windows - type any family name
  `FontFamily.all` reports instead (open the Script Editor's console and
  run `require('/fonts.js').FontFamily.all.map(f => f.name)` to see them
  all) if you'd rather replace with something else. Edit
  `CONFIG.REPLACEMENT_FONT` at the top of the script if you want a
  different default to open with.
- Running it when nothing is actually missing just tells you so - it's
  safe to run as a check.

## Known limitations

- **One replacement font for the whole document, in one pass.**
  VectorCraft's own tool works the same way - every missing font found
  gets the same replacement family, just in its own closest-matching
  style. If your document is missing two different fonts and you want
  them replaced with two different families, this can't tell them apart
  in a single run - it fixes everything missing with whatever family name
  you typed into the dialog.
- **The dialog couldn't be tested the way this project's other scripts
  are** - Affinity's scripting SDK's dialogs only run in the native
  Scripts panel, not through this project's own MCP-based test tool, so
  this one was checked carefully against the SDK's own source rather than
  run live before shipping. Flag it if it misbehaves.

## Changelog

1.1.0 - Replaced the CONFIG-only workflow with a one-field settings dialog
(opens pre-filled from CONFIG.REPLACEMENT_FONT); CONFIG now only sets the
dialog's default.
1.0.0 - Initial version.
