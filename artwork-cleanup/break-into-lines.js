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
Script Name:    break-into-lines.js
Description:    Approximate port of VectorCraft's Artwork Cleanup > Break Text (by lines).
                 Splits each selected Frame Text or Artistic Text object into one-line Artistic
                 Text pieces, one per line - including lines that exist only because a Frame
                 Text object auto-wrapped, not just lines you typed. The Affinity SDK has no API
                 to read where a frame actually wrapped a line (same per-glyph-position gap as
                 combine-point-text.js/join-point-text.js), so this finds those wrap points itself:
                 it duplicates the frame, grows a copy of its text one word at a time, and watches
                 the duplicate's own rendered height for the jump a new line causes - the same
                 signal a person watching the frame redraw would see. Every probing step is
                 undone before the real, visible change is made, as one undo step. See
                 break-into-lines.md.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See break-into-lines.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // A word is read as starting a new (auto-wrapped) line when adding it makes the probe's
    // rendered height jump by more than this fraction of the font's own point size - comfortably
    // above the few points of noise a tall or deep glyph alone can add within one line, and
    // comfortably below a real line's own height.
    LINE_JUMP_FRACTION: 0.5,
    // How many times a probe edit is retried if it doesn't stick before giving up on that object.
    SETTEXT_RETRIES: 3,
    // Frame Text objects with more words than this are left alone rather than probed word by
    // word - probing is real, undo-tracked document edits, one per word, and this keeps a huge
    // frame from taking forever (and the undo stack temporarily huge) to work out its lines.
    MAX_WORDS_PER_TEXT: 3000,
    MAX_OBJECTS: 500,
};

const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const { ArtTextNodeDefinition } = require('/nodes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { ParagraphAtts, ParagraphAlignXType } = require('/paragraphatts.js');

// ============================================================
// CANDIDATES
// ============================================================

// Text on a path or wrapped around a shape - never touched, matching VectorCraft's own tool.
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

// A Frame Text object threaded to (or from) another frame - its text isn't all here, so it's
// left alone, matching VectorCraft's own tool.
function isThreaded(node) {
    const tfi = node.textFrameInterface;
    return !!(tfi && (tfi.isMultiFrameTextFlow || !tfi.isTextFlowFront || !tfi.isTextFlowBack));
}

// A Frame Text object whose text doesn't all fit would lose the overflow part if split up.
function isOverflowing(node) {
    const exact = node.getExactSpreadVisibleBox(true, false);
    const nominal = node.spreadVisibleBox;
    return exact.height > nominal.height + 0.5 || exact.width > nominal.width + 0.5;
}

// ============================================================
// ALIGNMENT (point type keeps no justified lines - same collapsing as combine/join-point-text.js)
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
// TRIMMING
// ============================================================

// `[a, b)` of `text` without the white space at its ends; null when nothing else is left.
function trimRange(text, a, b) {
    const s = text.slice(a, b);
    const start = a + (s.length - s.replace(/^\s+/, '').length);
    const end = b - (s.length - s.replace(/\s+$/, '').length);
    return start < end ? [start, end] : null;
}

// ============================================================
// LINE DETECTION
// ============================================================

// Every word (its own `[start, end)`) and every forced line break's position, in text order.
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

// Replaces every character of `probe`'s own story with `s`, verifying it actually took (a
// command that reports success without the story actually changing has been seen in testing) -
// retrying a few times before giving up, since probing a wrong length silently would mean a
// wrong line split.
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

function probeHeight(probe) {
    return probe.getExactSpreadVisibleBox(true, false).height;
}

// The lines of `node`'s text as `{start, end, bottomHeight}` (`bottomHeight`: the probe's own
// rendered height once this line - and everything above it - was in it; used afterwards to place
// each line without ever having read a real glyph position). `wrap`: false skips the word-by-word
// auto-wrap probing entirely and only splits at the forced breaks already in the text (all Point
// type needs, since it never wraps). Returns null if a probe edit never stuck (something to skip,
// not guess at) - the caller must still undo `undos.count` steps either way.
function detectLines(doc, node, wrap, undos) {
    const text = node.text;
    const atoms = atomsOf(text);
    if (wrap && atoms.filter(a => a.type === 'word').length > CONFIG.MAX_WORDS_PER_TEXT) return null;

    const probe = node.duplicate();
    undos.count++;
    const story = node.storyInterface.story;

    const lines = [];
    let lineStart = 0;
    let lastHeight = 0;
    for (const atom of atoms) {
        if (atom.type === 'break') {
            lines.push({ start: lineStart, end: atom.at, bottomHeight: lastHeight });
            if (!setProbeText(doc, probe, text.slice(0, atom.at + 1), undos)) return null;
            lastHeight = probeHeight(probe);
            lineStart = atom.at + 1;
            continue;
        }
        if (!wrap) continue;
        if (!setProbeText(doc, probe, text.slice(0, atom.end), undos)) return null;
        const h = probeHeight(probe);
        const fontHeight = story.getGlyphAtts(atom.start).height || 1;
        if (atom.start > lineStart && h - lastHeight > fontHeight * CONFIG.LINE_JUMP_FRACTION) {
            lines.push({ start: lineStart, end: atom.start, bottomHeight: lastHeight });
            lineStart = atom.start;
        }
        lastHeight = h;
    }
    if (wrap) {
        lines.push({ start: lineStart, end: text.length, bottomHeight: lastHeight });
    } else {
        // Point type's last (or only) segment: height was never measured since no auto-wrap
        // probing ran; one more probe gets it.
        if (!setProbeText(doc, probe, text.slice(0, text.length), undos)) return null;
        lines.push({ start: lineStart, end: text.length, bottomHeight: probeHeight(probe) });
    }

    // Each line's own x (its alignment-driven left edge, read by probing it alone - the running
    // prefix above only ever gave the leftmost x of everything probed so far, not this line's own).
    const placed = [];
    const frameTop = node.getExactSpreadVisibleBox(true, false).y;
    for (const line of lines) {
        const trimmed = trimRange(text, line.start, line.end);
        if (!trimmed) continue;
        const lineText = text.slice(trimmed[0], trimmed[1]);
        if (!setProbeText(doc, probe, lineText, undos)) return null;
        const box = probe.getExactSpreadVisibleBox(true, false);
        placed.push({ start: trimmed[0], end: trimmed[1], x: box.x, y: frameTop + line.bottomHeight });
    }
    return placed;
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

function buildPieceDefinition(node, piece) {
    const sb = StoryBuilder.create();
    sliceIntoBuilder(sb, node, piece.start, piece.end);
    const atts = ParagraphAtts.create();
    atts.alignXType = pointAlign(node.storyInterface.story.getParagraphAtts(piece.start).alignXType);
    sb.setParagraphAtts(atts);
    return ArtTextNodeDefinition.createFromStoryBuilder({ x: piece.x, y: piece.y }, sb);
}

// ============================================================
// RUN
// ============================================================

// `node`'s lines, probing it if it's Frame Text (auto-wrap possible) or just reading its forced
// breaks if it's Point Type (never wraps) - undoing every probing step either way before
// returning, so nothing of the probing is left for the real, final command to see.
function linesOf(doc, node) {
    const undos = { count: 0 };
    let lines = null;
    try {
        if (node.isFrameTextNode) {
            if (isThreaded(node) || isOverflowing(node)) return null;
            lines = detectLines(doc, node, true, undos);
        } else {
            lines = detectLines(doc, node, false, undos);
        }
    } finally {
        for (let i = 0; i < undos.count; i++) doc.undo();
    }
    return lines;
}

function buildCommand(doc, roots) {
    const candidates = collectCandidates(roots);
    const results = [];
    let skipped = 0;
    for (const node of candidates) {
        if (!node.text || !node.text.trim()) { skipped++; continue; }
        const lines = linesOf(doc, node);
        if (!lines || lines.length < 2) { skipped++; continue; }
        results.push({ node, lines });
    }
    if (results.length === 0) return { cmd: null, skipped };

    const addBuilder = AddChildNodesCommandBuilder.create(doc);
    let pieceCount = 0;
    for (const r of results) {
        for (const piece of r.lines) {
            addBuilder.addNode(buildPieceDefinition(r.node, piece), r.node.parent, NodeMoveType.After, NodeChildType.Main);
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
        alert('Select Frame Text or Artistic Text with more than one line to break apart');
        return;
    }

    doc.executeCommand(result.cmd);
    alert('Broke ' + result.objects + ' object' + (result.objects === 1 ? '' : 's') + ' into ' +
        result.pieces + ' line' + (result.pieces === 1 ? '' : 's') +
        (result.skipped ? ' (' + result.skipped + ' skipped)' : '') + '.');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
