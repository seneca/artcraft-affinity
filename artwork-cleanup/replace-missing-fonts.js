/*
================================================================================
Copyright (c) 2026, Les Pruszynski (Middledot).
All rights reserved.

BSD 3-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

------------------------------------------------------------
Script Name:    replace-missing-fonts.js
Description:    Port of VectorCraft's Artwork Cleanup > Replace Missing Fonts. Scans the whole
                 document - every page, not just the selection or the current one - for any text
                 using a font family that isn't actually available, and replaces it with
                 CONFIG.REPLACEMENT_FONT, picking whichever style of that family (regular, bold,
                 italic, bold italic, ...) is closest to what the missing font was set to, as one
                 undo step. A Symbol's own content needs no special handling - unlike VectorCraft,
                 Affinity has no separate hidden master-content store a script can't reach; an
                 instance's content already shows up as ordinary nested objects in the normal
                 node tree, which this already walks into.

                 "Missing" is detected the same way Affinity's own Font panel would flag a font:
                 a font whose family isn't installed resolves to a `Font` object with an empty
                 `postscriptName` - confirmed directly, live, including after actually assigning
                 a non-existent font to a real text run (not just constructing one in isolation).
                 The closest style match uses `Font.getDistance()`, a real built-in similarity
                 metric between two fonts - confirmed it correctly prefers an available family's
                 "Regular" style over its others for an unstyled missing font.

                 The replacement font name comes from a small dialog (Affinity's own Dialog API,
                 /dialog.js) rather than a CONFIG edit - CONFIG.REPLACEMENT_FONT below only
                 supplies the text the dialog opens with. The dialog live-previews the actual
                 replacement as you type (FormatText-only, no node creation/deletion, so this is
                 safe to recompute on every keystroke - confirmed directly via this project's own
                 test tool that a second preview always replaces the first rather than stacking on
                 it); while the typed name doesn't resolve to an installed family, the status line
                 just says so instead of erroring on every keystroke. Note for future maintenance:
                 the dialog UI itself still can't be driven by this project's own MCP test tool (it
                 only runs in the native Scripts panel), so its wiring was checked carefully
                 against /dialog.js's own source but not exercised live - test it for real before
                 relying on it.

Author:         Les Pruszynski (Middledot)
Version:        1.2.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See replace-missing-fonts.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // The font family every missing font is replaced with - must be actually installed. Arial
    // is close to universally available on both macOS and Windows. This is only the dialog's
    // starting value - type a different family name there each run, or change this for a
    // different default.
    REPLACEMENT_FONT: 'Arial',
};

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const { FontFamily } = require('/fonts.js');
const { StoryDelta } = require('/storydelta.js');

// ============================================================
// FONT MATCHING
// ============================================================

// A font whose family isn't actually installed resolves with no real face behind it - its
// `postscriptName` comes back empty, the same signal Affinity's own UI uses to flag it as
// missing (verified directly: a real font reports a real postscript name; a non-existent family,
// even after being assigned to and read back from an actual text run, reports "").
function isMissing(font) {
    return !font.postscriptName;
}

// Whichever of `candidates` (all real fonts in the replacement family) is closest to `requested`
// (the missing font's own stored family/weight/italic/width, unresolved as it is) - using
// `Font.getDistance()`, a real built-in similarity metric, the same idea VectorCraft's own tool
// uses to keep a bold or italic run bold or italic after its font is replaced.
function closestFont(requested, candidates) {
    let best = candidates[0];
    let bestDistance = requested.getDistance(best);
    for (let i = 1; i < candidates.length; i++) {
        const distance = requested.getDistance(candidates[i]);
        if (distance < bestDistance) {
            best = candidates[i];
            bestDistance = distance;
        }
    }
    return best;
}

// ============================================================
// FINDING TEXT, EVERYWHERE
// ============================================================

// The most reliable sign a node actually holds text: it has a real `storyInterface` - true for
// every text node kind (Frame, Artistic, on a path, wrapped around a shape, in a table, ...),
// not just the two this project's other text scripts care about, since this one only ever
// restyles character runs and never has to place anything.
function hasStory(node) {
    try {
        return !!node.storyInterface;
    } catch (error) {
        return false;
    }
}

// Every text-bearing node under `roots`, found by walking into every node's own children - which
// already reaches a Symbol instance's own content, since Affinity keeps no separate master copy
// a script can't see; an instance's art and text are just ordinary nested children here.
function collectTextNodes(roots) {
    const out = [];
    function visit(node) {
        if (hasStory(node)) out.push(node);
        if (node.children) {
            for (const child of node.children.toArray()) visit(child);
        }
    }
    for (const root of roots) visit(root);
    return out;
}

// ============================================================
// BUILDING THE FIX
// ============================================================

// Queues one `createFormatText` command per run of `node`'s own text whose font is missing,
// each one replacing just that run's font with the closest match in `replacementFonts` - a
// style change only, so every run's own character range stays exactly where it is regardless of
// how many of these end up queued together → how many runs this node needed fixed.
function queueNodeFixes(doc, node, replacementFonts, builder) {
    const story = node.storyInterface.story;
    let count = 0;
    for (const run of story.attRuns) {
        const font = run.glyphAtts && run.glyphAtts.font;
        if (!font || !isMissing(font)) continue;

        const atts = story.getGlyphAtts(run.begin).clone();
        atts.font = closestFont(font, replacementFonts);
        const delta = StoryDelta.createFromGlyphAtts(atts);

        const sel = Selection.create(doc, node);
        sel.addSubSelectionForNode(node, TextSelection.create([{ begin: run.begin, end: run.end }]));
        builder.addCommand(DocumentCommand.createFormatText(sel, delta));
        count++;
    }
    return count;
}

// Builds the full compound command replacing every missing font across `nodes` with
// `replacementFontName`, without executing it. Returns { cmd, runCount, nodeCount, reason } -
// cmd is null if nothing would change; `reason` is 'fontNotFound' (the typed family isn't
// installed) or 'nothingMissing' (there's nothing to fix) or null. Cheap to call on every
// keystroke: no rendering, just a doc-wide scan of each run's own font.
function buildFontFixCommand(doc, nodes, replacementFontName) {
    const family = FontFamily.all.find(f => f.name === replacementFontName);
    if (!family || family.fontCount === 0) {
        return { cmd: null, runCount: 0, nodeCount: 0, reason: 'fontNotFound' };
    }
    const replacementFonts = family.fonts;

    const builder = CompoundCommandBuilder.create();
    let runCount = 0;
    let nodeCount = 0;
    for (const node of nodes) {
        const fixed = queueNodeFixes(doc, node, replacementFonts, builder);
        if (fixed > 0) {
            runCount += fixed;
            nodeCount++;
        }
    }
    if (runCount === 0) return { cmd: null, runCount: 0, nodeCount: 0, reason: 'nothingMissing' };

    return { cmd: builder.createCommand(), runCount, nodeCount, reason: null };
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const nodes = collectTextNodes(doc.spreads.toArray());

    const { Dialog, DialogResult } = require('/dialog.js');
    const dlg = Dialog.create('Replace Missing Fonts');
    const col = dlg.addColumn();
    const grp = col.addGroup('Settings');
    const fontBox = grp.addTextBox('Replacement font family', CONFIG.REPLACEMENT_FONT);
    // Live-updated from update() below - a running status, since a typo-in-progress ("not
    // installed yet") shouldn't pop its own alert on every keystroke.
    const status = grp.addStaticText(' ', ' ').setIsFullWidth(true);

    // FormatText-only (no node creation/deletion), so this is safe to live-preview on every
    // keystroke the same way text-tweaker.js/print-ink-fixes.js are - confirmed directly via
    // this project's own test tool that a second preview always replaces the first.
    let last = { cmd: null, runCount: 0, nodeCount: 0, reason: null };
    const update = (preview) => {
        last = buildFontFixCommand(doc, nodes, fontBox.text);
        if (last.cmd) doc.executeCommand(last.cmd, preview);
        else doc.clearPreviews();
        status.text = last.reason === 'fontNotFound'
            ? 'Not installed on this system (yet) - keep typing, or pick a family that is.'
            : last.reason === 'nothingMissing'
                ? 'No fonts are missing.'
                : 'Would replace ' + last.runCount + ' run' + (last.runCount === 1 ? '' : 's') +
                    ' across ' + last.nodeCount + ' object' + (last.nodeCount === 1 ? '' : 's') + '.';
        return last;
    };

    dlg.onControlValueChangedHandler = () => update(true);
    update(true);

    if (dlg.runModal() === DialogResult.Ok) {
        const replacementFont = fontBox.text;
        const result = update(false);
        if (result.reason === 'fontNotFound') {
            alert('The replacement font "' + replacementFont + '" is not available on this system - ' +
                'run it again with a family name that is.');
        } else if (result.reason === 'nothingMissing') {
            alert('No fonts are missing.');
        } else {
            alert('Replaced ' + result.runCount + ' run' + (result.runCount === 1 ? '' : 's') + ' of missing font' +
                (result.runCount === 1 ? '' : 's') + ' across ' + result.nodeCount + ' object' +
                (result.nodeCount === 1 ? '' : 's') + ' with "' + replacementFont + '".');
        }
    }
    doc.clearPreviews();
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
