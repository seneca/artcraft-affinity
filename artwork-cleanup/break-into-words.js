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
Script Name:    break-into-words.js
Description:    Approximate port of VectorCraft's Artwork Cleanup > Break Text (by words).
                 Splits each selected Frame Text or Artistic Text object into one Artistic Text
                 object per word, as one undo step. Always produces Artistic Text, for both
                 source types - a single word is inherently a one-line thing, so there's no
                 Frame Text question here the way there was for break-into-paragraphs.js.
                 Harder than break-into-lines.js/break-into-paragraphs.js: those only ever needed
                 to place a whole line or paragraph (one number: how far down the page it starts).
                 This has to place every word *within* its own line too, which the SDK has no
                 API for (same per-glyph-position gap as the other text scripts) - solved here by
                 probing each word alone and probing its line's text so far, and subtracting the
                 two widths. See break-into-words.md for exactly how and its limits.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See break-into-words.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // A word is read as starting a new (auto-wrapped) line when adding it makes its line's own
    // probe height jump by more than this fraction of the font's own point size - see
    // break-into-lines.js for how this was picked and verified.
    LINE_JUMP_FRACTION: 0.5,
    // How many times a probe edit is retried if it doesn't stick before giving up on that object.
    SETTEXT_RETRIES: 3,
    // Frame Text objects with more words than this are left alone rather than probed word by
    // word - each word here costs two probes (see scanWords), twice break-into-lines.js's own cap.
    MAX_WORDS_PER_TEXT: 1500,
    MAX_OBJECTS: 500,
};

const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const { ArtTextNodeDefinition } = require('/nodes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { ParagraphAtts, ParagraphAlignXType } = require('/paragraphatts.js');

// ============================================================
// CANDIDATES (duplicated from break-into-lines.js)
// ============================================================

function isOnPathOrShape(node) {
    const name = node.constructor && node.constructor.name;
    return name === 'CurvePathTextNode' || name === 'ShapeTextNode';
}

function isCandidate(node) {
    if (!(node.isFrameTextNode || node.isArtTextNode)) return false;
    if (isOnPathOrShape(node)) return false;
    return node.isLocalEditable && node.isVisible;
}

function collectCandidates(roots) {
    const out = [];
    function visit(node) {
        if (out.length >= CONFIG.MAX_OBJECTS) return;
        if (isCandidate(node)) { out.push(node); return; }
        if (node.isGroupNode) for (const child of node.children.toArray()) visit(child);
    }
    for (const root of roots) visit(root);
    return out;
}

function isThreaded(node) {
    const tfi = node.textFrameInterface;
    return !!(tfi && (tfi.isMultiFrameTextFlow || !tfi.isTextFlowFront || !tfi.isTextFlowBack));
}

function isOverflowing(node) {
    const exact = node.getExactSpreadVisibleBox(true, false);
    const nominal = node.spreadVisibleBox;
    return exact.height > nominal.height + 0.5 || exact.width > nominal.width + 0.5;
}

// ============================================================
// ALIGNMENT (duplicated from break-into-lines.js) - every word becomes Artistic Text
// ============================================================

function pointAlign(x) {
    switch (x) {
        case ParagraphAlignXType.JustifyLeft:
        case ParagraphAlignXType.JustifyAll:
        case ParagraphAlignXType.AwayFromSpine:
        case ParagraphAlignXType.TowardsSpine:
            return ParagraphAlignXType.Left;
        case ParagraphAlignXType.JustifyCentre:
            return ParagraphAlignXType.Centre;
        case ParagraphAlignXType.JustifyRight:
            return ParagraphAlignXType.Right;
        default:
            return x;
    }
}

// ============================================================
// WORD DETECTION
// ============================================================

// Every word (its own `[start, end)`) and every forced line break's position, in text order
// (duplicated from break-into-lines.js).
function atomsOf(text) {
    const atoms = [];
    const wordRe = /\S+/g;
    let m;
    while ((m = wordRe.exec(text))) atoms.push({ type: 'word', start: m.index, end: m.index + m[0].length });
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n' || text[i] === '\u2028') atoms.push({ type: 'break', at: i });
    }
    atoms.sort((x, y) => (x.start ?? x.at) - (y.start ?? y.at));
    return atoms;
}

function setProbeText(doc, probe, s, undos) {
    for (let attempt = 0; attempt <= CONFIG.SETTEXT_RETRIES; attempt++) {
        const range = probe.storyInterface.storyRange;
        const textSel = TextSelection.create([{ begin: range.begin, end: range.end - 1 }]);
        const sel = Selection.create(doc, probe);
        sel.addSubSelectionForNode(probe, textSel);
        doc.executeCommand(DocumentCommand.createSetText(sel, s));
        undos.count++;
        if (probe.text === s) return true;
    }
    return false;
}

// Every word of `node`'s text as `{start, end, x, y}`. Unlike break-into-lines.js, this has to
// place each word *within* its own line, not just place a whole line - and the SDK's tight
// bounding box drops trailing white space entirely (verified: "ab", "ab ", "ab  " all measure
// the same width), so a word's own left edge isn't directly readable either. Both numbers come
// from the same two probes, done for every word in turn:
// - `aloneBox`: that word's own text, probed by itself - its rendered width, with no neighbours.
// - `prefixBox`: the current line's text so far, up to and including this word - its height
//   (`> lastLocalHeight` by more than a font-sized margin means this word didn't fit the current
//   line after all, and starts a new one instead) and its width.
// A word's left edge within its line is then `prefixBox` 's width minus the word's own width -
// everything rendered before it, since trailing white space before it leaves no visible trace to
// measure directly. Once a line is known to be finished (a forced break, a wrapped-away word, or
// the end of the text), every word buffered for it is placed using that line's own final,
// settled height - not whatever smaller height an earlier, shorter prefix of the same line
// happened to measure (glyph-shape noise alone moved a single line's measured height by several
// points in testing - see break-into-lines.js - which would otherwise put words on the same line
// at very slightly different y).
//
// `wrap`: false skips the auto-wrap check entirely and only closes a line at the forced breaks
// already in the text (all Point type needs, since it never auto-wraps).
function scanWords(doc, node, wrap, undos) {
    const text = node.text;
    const atoms = atomsOf(text);
    const wordCount = atoms.filter(a => a.type === 'word').length;
    if (wordCount === 0) return null;
    if (wrap && wordCount > CONFIG.MAX_WORDS_PER_TEXT) return null;

    const probe = node.duplicate();
    undos.count++;
    const story = node.storyInterface.story;
    const frameTop = node.getExactSpreadVisibleBox(true, false).y;

    const words = [];
    let lineStart = 0;
    let cumulativeY = 0;
    let lastLocalHeight = 0;
    let buffer = [];

    function flushLine(finalHeight) {
        const y = frameTop + cumulativeY + finalHeight;
        for (const w of buffer) words.push({ start: w.start, end: w.end, x: w.x, y });
        cumulativeY += finalHeight;
        buffer = [];
    }

    for (const atom of atoms) {
        if (atom.type === 'break') {
            flushLine(lastLocalHeight);
            lineStart = atom.at + 1;
            lastLocalHeight = 0;
            continue;
        }

        const wordText = text.slice(atom.start, atom.end);
        if (!setProbeText(doc, probe, wordText, undos)) return null;
        const aloneBox = probe.getExactSpreadVisibleBox(true, false);

        let prefixBox;
        if (!setProbeText(doc, probe, text.slice(lineStart, atom.end), undos)) return null;
        prefixBox = probe.getExactSpreadVisibleBox(true, false);

        if (wrap && buffer.length > 0) {
            const fontHeight = story.getGlyphAtts(atom.start).height || 1;
            if (prefixBox.height - lastLocalHeight > fontHeight * CONFIG.LINE_JUMP_FRACTION) {
                flushLine(lastLocalHeight);
                lineStart = atom.start;
                prefixBox = aloneBox; // the new line's content so far is just this word
            }
        }

        const x = prefixBox.x + (prefixBox.width - aloneBox.width);
        buffer.push({ start: atom.start, end: atom.end, x });
        lastLocalHeight = prefixBox.height;
    }
    flushLine(lastLocalHeight);
    return words;
}

// ============================================================
// BUILDING THE PIECES
// ============================================================

function sliceIntoBuilder(sb, node, start, end) {
    const story = node.storyInterface.story;
    for (const r of story.attRuns) {
        const a = Math.max(r.begin, start), b = Math.min(r.end, end);
        if (a >= b) continue;
        if (r.glyphAtts) sb.setGlyphAtts(r.glyphAtts);
        sb.addText(story.getText(a, b - a));
    }
}

function buildWordDefinition(node, word) {
    const story = node.storyInterface.story;
    const sb = StoryBuilder.create();
    sliceIntoBuilder(sb, node, word.start, word.end);
    const atts = ParagraphAtts.create();
    atts.alignXType = pointAlign(story.getParagraphAtts(word.start).alignXType);
    sb.setParagraphAtts(atts);
    return ArtTextNodeDefinition.createFromStoryBuilder({ x: word.x, y: word.y }, sb);
}

// ============================================================
// RUN
// ============================================================

function wordsOf(doc, node) {
    const undos = { count: 0 };
    let words = null;
    try {
        if (node.isFrameTextNode) {
            if (isThreaded(node) || isOverflowing(node)) return null;
            words = scanWords(doc, node, true, undos);
        } else {
            words = scanWords(doc, node, false, undos);
        }
    } finally {
        for (let i = 0; i < undos.count; i++) doc.undo();
    }
    return words;
}

function buildCommand(doc, roots) {
    const candidates = collectCandidates(roots);
    const results = [];
    let skipped = 0;
    for (const node of candidates) {
        if (!node.text || !node.text.trim()) { skipped++; continue; }
        const words = wordsOf(doc, node);
        if (!words || words.length < 2) { skipped++; continue; }
        results.push({ node, words });
    }
    if (results.length === 0) return { cmd: null, skipped };

    const addBuilder = AddChildNodesCommandBuilder.create(doc);
    let pieceCount = 0;
    for (const r of results) {
        for (const word of r.words) {
            addBuilder.addNode(buildWordDefinition(r.node, word), r.node.parent, NodeMoveType.After, NodeChildType.Main);
            pieceCount++;
        }
    }
    const builder = CompoundCommandBuilder.create();
    builder.addCommand(addBuilder.createCommand());
    const delSel = Selection.createEmpty(doc);
    for (const r of results) delSel.addNode(r.node);
    builder.addCommand(DocumentCommand.createDeleteSelection(delSel));
    return { cmd: builder.createCommand(), objects: results.length, pieces: pieceCount, skipped };
}

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const roots = doc.selection.nodes.toArray();
    if (roots.length === 0) { alert('Please select one or more Frame Text or Artistic Text objects'); return; }

    const result = buildCommand(doc, roots);
    if (!result.cmd) {
        alert('Select Frame Text or Artistic Text with more than one word to break apart');
        return;
    }

    doc.executeCommand(result.cmd);
    alert('Broke ' + result.objects + ' object' + (result.objects === 1 ? '' : 's') + ' into ' +
        result.pieces + ' word' + (result.pieces === 1 ? '' : 's') +
        (result.skipped ? ' (' + result.skipped + ' skipped)' : '') + '.');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
