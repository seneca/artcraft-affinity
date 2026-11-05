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
Description:    Approximate port of VectorCraft's Artwork Cleanup > Break Text (by paragraphs).
                 Splits each selected Frame Text or Artistic Text object into one Artistic Text
                 object per paragraph (only where you actually pressed Enter - not per line), as
                 one undo step. A paragraph that wrapped across several lines in a frame keeps
                 those line breaks inside its own piece (now explicit, where they were auto-wrap).
                 Finding those wrap points uses the same probing technique as break-into-lines.js -
                 see that script's header and break-into-paragraphs.md for why, and the same
                 per-glyph-position SDK gap that makes all of this approximate.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
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
    // A word is read as starting a new (auto-wrapped) line when adding it makes the probe's
    // rendered height jump by more than this fraction of the font's own point size - see
    // break-into-lines.js for how this was picked and verified.
    LINE_JUMP_FRACTION: 0.5,
    // How many times a probe edit is retried if it doesn't stick before giving up on that object.
    SETTEXT_RETRIES: 3,
    // Frame Text objects with more words than this are left alone rather than probed word by word.
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
// ALIGNMENT (duplicated from break-into-lines.js)
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
// LINE DETECTION (duplicated from break-into-lines.js)
// ============================================================

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

function probeHeight(probe) {
    return probe.getExactSpreadVisibleBox(true, false).height;
}

// Every line of `node`'s text as `{start, end, bottomHeight, isParagraphEnd}` - `bottomHeight`
// is the probe's own rendered height once this line (and everything above it) was in it, used
// afterwards to place the first line of each paragraph; `isParagraphEnd` is true only when the
// line's own trailing break is a real typed paragraph break (`\n`), not a forced line break
// (`\u2028`) or a detected auto-wrap - both of the latter keep the following line in the *same*
// paragraph. `wrap`: false only reads the forced breaks already in the text (all Point type
// needs, since it never auto-wraps).
function scanLines(doc, node, wrap, undos) {
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
            lines.push({ start: lineStart, end: atom.at, bottomHeight: lastHeight, isParagraphEnd: text[atom.at] === '\n' });
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
            lines.push({ start: lineStart, end: atom.start, bottomHeight: lastHeight, isParagraphEnd: false });
            lineStart = atom.start;
        }
        lastHeight = h;
    }
    if (wrap) {
        lines.push({ start: lineStart, end: text.length, bottomHeight: lastHeight, isParagraphEnd: true });
    } else {
        if (!setProbeText(doc, probe, text, undos)) return null;
        lines.push({ start: lineStart, end: text.length, bottomHeight: probeHeight(probe), isParagraphEnd: true });
    }

    // Group consecutive lines into paragraphs: only a real typed paragraph break ends a group.
    const groups = [];
    let group = [];
    for (const line of lines) {
        group.push(line);
        if (line.isParagraphEnd) { groups.push(group); group = []; }
    }
    if (group.length) groups.push(group);

    // Each paragraph's own x (its alignment-driven left edge, from its first line probed alone)
    // and y (that first line's own bottomHeight - the same box-bottom anchor convention
    // combine-point-text.js/join-point-text.js use).
    const frameTop = node.getExactSpreadVisibleBox(true, false).y;
    const placed = [];
    for (const g of groups) {
        const first = g[0];
        const trimmed = trimRange(text, first.start, first.end);
        if (!trimmed) continue;
        if (!setProbeText(doc, probe, text.slice(trimmed[0], trimmed[1]), undos)) return null;
        const box = probe.getExactSpreadVisibleBox(true, false);
        placed.push({ group: g, x: box.x, y: frameTop + first.bottomHeight });
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

// Builds one paragraph's definition: its lines trimmed and joined with a forced line break
// (`\u2028`, styled like the end of the line before it) wherever two lines of the same
// paragraph meet - whether that join was already an explicit break in the text or a detected
// auto-wrap. Affinity's own leading then spaces these lines exactly as the original paragraph
// was spaced, since nothing about the paragraph's own font, size or leading has changed - only
// the paragraph's own top needs placing (`anchor`), not each of its lines.
//
// NOTE: a bulleted paragraph's bullet is NOT carried over - the Affinity scripting SDK has no
// list/bullet API at all (checked: nothing on ParagraphAtts or anywhere else). If a future SDK
// version adds one, this is the place to set it.
function buildParagraphDefinition(node, placedGroup, anchor) {
    const text = node.text;
    const story = node.storyInterface.story;
    const trimmedLines = placedGroup.group.map(l => trimRange(text, l.start, l.end)).filter(Boolean);

    const sb = StoryBuilder.create();
    for (let i = 0; i < trimmedLines.length; i++) {
        if (i > 0) {
            const prevEnd = trimmedLines[i - 1][1];
            const atts = story.getGlyphAtts(Math.max(0, prevEnd - 1));
            if (atts) sb.setGlyphAtts(atts);
            sb.addText('\u2028');
        }
        sliceIntoBuilder(sb, node, trimmedLines[i][0], trimmedLines[i][1]);
    }
    const atts = ParagraphAtts.create();
    atts.alignXType = pointAlign(story.getParagraphAtts(trimmedLines[0][0]).alignXType);
    sb.setParagraphAtts(atts);
    return ArtTextNodeDefinition.createFromStoryBuilder(anchor, sb);
}

// ============================================================
// RUN
// ============================================================

function paragraphsOf(doc, node) {
    const undos = { count: 0 };
    let placed = null;
    try {
        if (node.isFrameTextNode) {
            if (isThreaded(node) || isOverflowing(node)) return null;
            placed = scanLines(doc, node, true, undos);
        } else {
            placed = scanLines(doc, node, false, undos);
        }
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
        for (const p of r.placed) {
            addBuilder.addNode(buildParagraphDefinition(r.node, p, { x: p.x, y: p.y }), r.node.parent, NodeMoveType.After, NodeChildType.Main);
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
