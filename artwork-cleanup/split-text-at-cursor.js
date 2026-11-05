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
Script Name:    split-text-at-cursor.js
Description:    Approximate port of VectorCraft's Artwork Cleanup > Split Text at Cursor - built
                 as break-into-paragraphs.js is, just splitting at the Type tool's cursor instead
                 of at paragraph breaks. While a live cursor or text selection sits in a selected
                 Frame Text or Artistic Text object, splits it into two pieces at a plain cursor
                 (before/after) or three at a selection (before/the selection itself/after), as
                 one undo step. A Frame Text source's pieces become new Frame Text boxes the same
                 width as the original, left to auto-wrap on their own; an Artistic Text source's
                 pieces become Artistic Text, keeping whatever forced line breaks they already
                 had - see break-into-paragraphs.js for why, which this otherwise matches exactly.

                 Reads a *live* Type tool cursor position rather than working from the object
                 selection alone - confirmed directly that
                 `doc.selection.getFirstSubSelectionOfType(SubSelectionType.Text)` reflects it in
                 real time (tested: caret moved to a place, then to 0, then a real range
                 selected, each read back correctly).

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See split-text-at-cursor.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // How many times a probe edit is retried if it doesn't stick before giving up.
    SETTEXT_RETRIES: 3,
    // Added to a new Frame Text piece's measured content height, so float rounding in the
    // measurement can never leave it a hair too short for its own text.
    FRAME_HEIGHT_MARGIN: 2,
};

const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, SubSelectionType, TextSelection } = require('/selections.js');
const { ArtTextNodeDefinition, FrameTextNodeDefinition } = require('/nodes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { ParagraphAtts, ParagraphAlignXType } = require('/paragraphatts.js');

// ============================================================
// CANDIDATE CHECKS (duplicated from break-into-paragraphs.js)
// ============================================================

function isOnPathOrShape(node) {
    const name = node.constructor && node.constructor.name;
    return name === 'CurvePathTextNode' || name === 'ShapeTextNode';
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
// ALIGNMENT - only for Artistic Text output (duplicated from break-into-paragraphs.js). A new
// Frame Text piece keeps the original's real ParagraphAtts verbatim instead.
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
// TRIMMING (duplicated from break-into-paragraphs.js)
// ============================================================

function trimRange(text, a, b) {
    const s = text.slice(a, b);
    const start = a + (s.length - s.replace(/^\s+/, '').length);
    const end = b - (s.length - s.replace(/\s+$/, '').length);
    return start < end ? [start, end] : null;
}

// ============================================================
// THE LIVE CURSOR
// ============================================================

// The live Type tool cursor or text selection in `node`, as `[a, b)` (`a === b`: a plain
// cursor) - null if there isn't one, or it's out of range for this node's own text.
function liveCursorRange(doc, node) {
    const sub = doc.selection.getFirstSubSelectionOfType(SubSelectionType.Text);
    if (!sub) return null;
    const a = Math.min(sub.caret, sub.anchor), b = Math.max(sub.caret, sub.anchor);
    if (a < 0 || b > node.text.length) return null;
    return [a, b];
}

// `[start, end)` of each piece the cursor cuts `text` into: two pieces at a plain cursor
// (before/after), three at a selection (before/the selection itself/after) - matching
// VectorCraft's own Split Text at Cursor.
function cursorRanges(text, a, b) {
    return a === b ? [[0, a], [a, text.length]] : [[0, a], [a, b], [b, text.length]];
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

// Every piece the cursor cuts `node`'s text into, as `{start, end, x, y, height}` - built the
// same way break-into-paragraphs.js's scanParagraphs builds a paragraph, just over
// `cursorRanges` instead of paragraph ranges, with one difference: a real paragraph break
// always falls at a line boundary in the original, so measuring the original's own cumulative
// height up to each one lines up with each paragraph's own standalone height. A cursor can fall
// *mid-line*, where that stops being true (a piece cut out of the middle of a line is shorter,
// alone, than however much of the original's vertical space it shared a line with) - stacking
// by the original's own cumulative height then put two pieces here measurably overlapping in
// testing. So each piece is simply stacked directly beneath the one before it, by its own
// measured height, starting from the original's own top.
function scanPieces(doc, node, ranges, undos) {
    const text = node.text;
    const probe = node.duplicate();
    undos.count++;

    let y = node.getExactSpreadVisibleBox(true, false).y;
    const placed = [];
    for (let i = 0; i < ranges.length; i++) {
        const trimmed = trimRange(text, ranges[i][0], ranges[i][1]);
        if (!trimmed) continue;
        if (!setProbeText(doc, probe, text.slice(trimmed[0], trimmed[1]), undos)) return null;
        const box = probe.getExactSpreadVisibleBox(true, false);
        placed.push({ start: trimmed[0], end: trimmed[1], x: box.x, y, height: box.height });
        y += box.height;
    }
    return placed;
}

// ============================================================
// BUILDING THE PIECES (duplicated from break-into-paragraphs.js)
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

// A Frame Text piece: the text and real paragraph attributes (alignment, justify included)
// copied verbatim, in a new box the same width as the original frame - no forced line breaks
// inserted; Affinity wraps it on its own, exactly as the original did.
//
// NOTE: the original frame's own text insets (if it has any) can't be read via the SDK at all,
// so they can't be copied either - see break-into-paragraphs.md's Known Limitations.
function buildFramePieceDefinition(node, piece) {
    const story = node.storyInterface.story;
    const sb = StoryBuilder.create();
    sliceIntoBuilder(sb, node, piece.start, piece.end);
    sb.setParagraphAtts(story.getParagraphAtts(piece.start));
    const frameBox = node.spreadVisibleBox;
    const box = { x: frameBox.x, y: piece.y, width: frameBox.width, height: piece.height + CONFIG.FRAME_HEIGHT_MARGIN };
    return FrameTextNodeDefinition.createFromStoryBuilder(box, sb);
}

// An Artistic Text piece: the text copied verbatim, including any forced line break it already
// had - point type can't auto-wrap, so there's no hidden wrap point to insert one for.
function buildPointPieceDefinition(node, piece) {
    const story = node.storyInterface.story;
    const sb = StoryBuilder.create();
    sliceIntoBuilder(sb, node, piece.start, piece.end);
    const atts = ParagraphAtts.create();
    atts.alignXType = pointAlign(story.getParagraphAtts(piece.start).alignXType);
    sb.setParagraphAtts(atts);
    return ArtTextNodeDefinition.createFromStoryBuilder({ x: piece.x, y: piece.y }, sb);
}

// ============================================================
// RUN
// ============================================================

function buildCommand(doc, node, a, b) {
    const ranges = cursorRanges(node.text, a, b);
    const undos = { count: 0 };
    let placed;
    try {
        placed = scanPieces(doc, node, ranges, undos);
    } finally {
        for (let i = 0; i < undos.count; i++) doc.undo();
    }
    if (!placed || placed.length < 2) return { cmd: null };

    const build = node.isFrameTextNode ? buildFramePieceDefinition : buildPointPieceDefinition;
    const addBuilder = AddChildNodesCommandBuilder.create(doc);
    for (const piece of placed) addBuilder.addNode(build(node, piece), node.parent, NodeMoveType.After, NodeChildType.Main);

    const builder = CompoundCommandBuilder.create();
    builder.addCommand(addBuilder.createCommand());
    builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, node)));
    return { cmd: builder.createCommand(), pieces: placed.length };
}

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const roots = doc.selection.nodes.toArray();
    if (roots.length !== 1 || !(roots[0].isFrameTextNode || roots[0].isArtTextNode) || isOnPathOrShape(roots[0])) {
        alert('Click into a single Frame Text or Artistic Text object with the Type tool, and place your cursor (or select some text) where you want to split it.');
        return;
    }
    const node = roots[0];
    if (node.isFrameTextNode && (isThreaded(node) || isOverflowing(node))) {
        alert('This Frame Text object is threaded to another frame, or its text doesn\'t all fit - left alone.');
        return;
    }

    const range = liveCursorRange(doc, node);
    if (!range) {
        alert('Click into the text with the Type tool and place your cursor (or select some text) first.');
        return;
    }
    const [a, b] = range;
    if (a === 0 && b === node.text.length) {
        alert('Nothing to split - your cursor or selection covers the whole text.');
        return;
    }

    const result = buildCommand(doc, node, a, b);
    if (!result.cmd) {
        alert('Nothing to split at that cursor - try a different position.');
        return;
    }

    doc.executeCommand(result.cmd);
    alert('Split into ' + result.pieces + ' piece' + (result.pieces === 1 ? '' : 's') + '.');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
