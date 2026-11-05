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
Script Name:    break-into-paragraphs.js
Description:    Approximate port of VectorCraft's Artwork Cleanup > Break Text (by paragraphs) -
                 with one deliberate deviation from VectorCraft's own behaviour. Splits each
                 selected Frame Text or Artistic Text object into one object per paragraph (only
                 where you actually pressed Enter - not per line), as one undo step. VectorCraft
                 always produces point-type pieces, forcing a wrapped paragraph's lines into
                 forced line breaks since point type can't auto-wrap on its own. A Frame Text
                 source has no such problem - it has a real width - so each of its paragraphs
                 becomes a new Frame Text box of that same width instead, left to auto-wrap on
                 its own exactly as the original did, with no inserted line breaks at all. An
                 Artistic Text source still becomes Artistic Text pieces, forced line breaks and
                 all, exactly as before (see break-into-lines.js for why that's still necessary
                 there). Still approximate: see break-into-paragraphs.md.

Author:         Les Pruszynski (Middledot)
Version:        2.0.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See break-into-paragraphs.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // How many times a probe edit is retried if it doesn't stick before giving up on that object.
    SETTEXT_RETRIES: 3,
    // Text objects with more paragraphs than this are left alone rather than probed one by one.
    MAX_PARAGRAPHS_PER_TEXT: 2000,
    MAX_OBJECTS: 500,
    // Added to each new Frame Text box's measured content height, so float rounding in the
    // measurement can never leave it a hair too short for its own text.
    FRAME_HEIGHT_MARGIN: 2,
};

const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const { ArtTextNodeDefinition, FrameTextNodeDefinition } = require('/nodes.js');
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
// ALIGNMENT - only for Artistic Text output (duplicated from break-into-lines.js). A new Frame
// Text piece keeps the original's real ParagraphAtts verbatim instead - frames support justified
// text properly, so there's nothing to collapse.
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
// TRIMMING (duplicated from break-into-lines.js)
// ============================================================

function trimRange(text, a, b) {
    const s = text.slice(a, b);
    const start = a + (s.length - s.replace(/^\s+/, '').length);
    const end = b - (s.length - s.replace(/\s+$/, '').length);
    return start < end ? [start, end] : null;
}

// ============================================================
// PARAGRAPH DETECTION
// ============================================================

// `[start, end)` of every paragraph in `text` - split on real typed paragraph breaks (`\n`) only.
// A forced line break (`\u2028`) stays inside its paragraph; VectorCraft's own Break Text (by
// paragraphs) splits the same way.
function paragraphRanges(text) {
    const out = [];
    let a = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') { out.push([a, i]); a = i + 1; }
    }
    out.push([a, text.length]);
    return out;
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

function probeHeight(probe) {
    return probe.getExactSpreadVisibleBox(true, false).height;
}

// Every paragraph of `node`'s text as `{start, end, x, y, height}`. Unlike break-into-lines.js,
// this never has to guess *where* a paragraph wraps - a new Frame Text piece just gets the same
// width and wraps on its own, and an Artistic Text piece keeps whatever forced line breaks were
// already typed into it (point type can't auto-wrap, so there's never a hidden wrap point to
// find there either). All that's probed for is each paragraph's own size and place:
// - `y`: the probe's own cumulative rendered height right at this paragraph's start, in the
//   original's own flow - this preserves whatever gap the original had before this paragraph
//   (including any "space before" its paragraph style sets), not just "stack with no gap".
// - `height`/`x`: that paragraph's own text, probed alone at the same width/attributes - its
//   rendered height (to size a new Frame Text piece) and left edge (`x`, which only matters for
//   an Artistic Text piece - a new Frame Text piece uses the original frame's own left edge and
//   lets its own paragraph alignment place the text within it, same as the original did).
function scanParagraphs(doc, node, undos) {
    const text = node.text;
    const ranges = paragraphRanges(text);
    if (ranges.length > CONFIG.MAX_PARAGRAPHS_PER_TEXT) return null;

    const probe = node.duplicate();
    undos.count++;

    const startHeights = [0];
    for (let i = 0; i < ranges.length - 1; i++) {
        if (!setProbeText(doc, probe, text.slice(0, ranges[i][1] + 1), undos)) return null;
        startHeights.push(probeHeight(probe));
    }

    const frameTop = node.getExactSpreadVisibleBox(true, false).y;
    const placed = [];
    for (let i = 0; i < ranges.length; i++) {
        const trimmed = trimRange(text, ranges[i][0], ranges[i][1]);
        if (!trimmed) continue;
        if (!setProbeText(doc, probe, text.slice(trimmed[0], trimmed[1]), undos)) return null;
        const box = probe.getExactSpreadVisibleBox(true, false);
        placed.push({ start: trimmed[0], end: trimmed[1], x: box.x, y: frameTop + startHeights[i], height: box.height });
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

// A Frame Text piece: the paragraph's own text and real paragraph attributes (alignment,
// justify included) copied verbatim, in a new box the same width as the original frame - no
// forced line breaks inserted; Affinity wraps it on its own, exactly as the original did, since
// nothing about its font, size, width or leading has changed.
//
// NOTE: a bulleted paragraph's bullet is still NOT carried over here either, and for the same
// reason as the Artistic Text case below - no list/bullet API anywhere in the SDK.
//
// NOTE: the original frame's own text insets (if it has any) can't be read via the SDK at all -
// checked directly, nothing exposes them - so they can't be copied either; the new piece gets
// Affinity's default insets. For a frame with non-default insets this could make its real wrap
// width differ slightly from what was measured. See break-into-paragraphs.md.
function buildFramePieceDefinition(node, piece) {
    const story = node.storyInterface.story;
    const sb = StoryBuilder.create();
    sliceIntoBuilder(sb, node, piece.start, piece.end);
    sb.setParagraphAtts(story.getParagraphAtts(piece.start));
    const frameBox = node.spreadVisibleBox;
    const box = { x: frameBox.x, y: piece.y, width: frameBox.width, height: piece.height + CONFIG.FRAME_HEIGHT_MARGIN };
    return FrameTextNodeDefinition.createFromStoryBuilder(box, sb);
}

// An Artistic Text piece: the paragraph's own text copied verbatim, including any forced line
// break it already had - point type can't auto-wrap, so there's no hidden wrap point to insert
// one for, unlike break-into-lines.js's situation. Alignment is collapsed to a point-compatible
// one the same way break-into-lines.js does.
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

function paragraphsOf(doc, node) {
    const undos = { count: 0 };
    let placed = null;
    try {
        if (node.isFrameTextNode && (isThreaded(node) || isOverflowing(node))) return null;
        placed = scanParagraphs(doc, node, undos);
    } finally {
        for (let i = 0; i < undos.count; i++) doc.undo();
    }
    return placed;
}

function buildCommand(doc, roots) {
    const candidates = collectCandidates(roots);
    const results = [];
    let skipped = 0;
    for (const node of candidates) {
        if (!node.text || !node.text.trim()) { skipped++; continue; }
        const placed = paragraphsOf(doc, node);
        if (!placed || placed.length < 2) { skipped++; continue; }
        results.push({ node, placed });
    }
    if (results.length === 0) return { cmd: null, skipped };

    const addBuilder = AddChildNodesCommandBuilder.create(doc);
    let pieceCount = 0;
    for (const r of results) {
        const build = r.node.isFrameTextNode ? buildFramePieceDefinition : buildPointPieceDefinition;
        for (const piece of r.placed) {
            addBuilder.addNode(build(r.node, piece), r.node.parent, NodeMoveType.After, NodeChildType.Main);
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
        alert('Select Frame Text or Artistic Text with more than one paragraph to break apart');
        return;
    }

    doc.executeCommand(result.cmd);
    alert('Broke ' + result.objects + ' object' + (result.objects === 1 ? '' : 's') + ' into ' +
        result.pieces + ' paragraph' + (result.pieces === 1 ? '' : 's') +
        (result.skipped ? ' (' + result.skipped + ' skipped)' : '') + '.');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
