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
Script Name:    break-into-glyphs.js
Description:    Approximate port of VectorCraft's Artwork Cleanup > Break Text (by glyphs).
                 Splits each selected Frame Text or Artistic Text object into one Artistic Text
                 object per rendered glyph cluster, as one undo step. VectorCraft reads its own
                 text-shaping engine to keep a font ligature (e.g. "fi" rendered as one fused
                 glyph) or a base character plus its combining accent mark together as one piece.
                 The Affinity SDK exposes no such thing - no way to ask whether two characters
                 became one glyph (checked directly: GlyphType only distinguishes field/anchor
                 kinds, not shaping). This instead splits on Unicode grapheme clusters (via
                 Intl.Segmenter) - the closest honest match: it keeps a base character with its
                 combining mark or a multi-part emoji together, but still splits an actual font
                 ligature into its separate letters, since that's a font-rendering choice Unicode
                 itself doesn't encode.

                 Placing each glyph is a two-level version of the same probing
                 break-into-lines.js/break-into-words.js use. Growing a probe's text one grapheme
                 at a time can't be used to find *where a line wraps* - tested directly, it wraps
                 mid-word, because the probe doesn't yet contain the rest of whatever word is
                 still being typed into it, and Affinity reasonably wraps based on what it's been
                 given so far. So line-wrapping is found first, at the word level, exactly as
                 break-into-lines.js does it; only once a line's own full text is known does this
                 script probe *within* it, grapheme by grapheme, for each glyph's own place.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See break-into-glyphs.md for the full guide.

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
    // word, to find where its lines wrap (break-into-lines.js's own cap).
    MAX_WORDS_PER_TEXT: 3000,
    // ...and with more glyphs than this are left alone rather than probed glyph by glyph, to
    // place each one within its line (break-into-words.js's own cap - each glyph here costs the
    // same two probes a whole word costs there).
    MAX_GLYPHS_PER_TEXT: 1500,
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
// ALIGNMENT (duplicated from break-into-lines.js) - every glyph becomes Artistic Text
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
// LINE DETECTION (duplicated from break-into-lines.js, unchanged) - word-level, since that's
// the granularity Affinity itself actually wraps at.
// ============================================================

function wordAtomsOf(text) {
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

// Every line of `node`'s text as `{start, end, bottomHeight}` - see break-into-lines.js for the
// full explanation of how and why. `wrap`: false only reads the forced breaks already in the
// text (all Point type needs, since it never auto-wraps).
function detectLines(doc, node, wrap, undos) {
    const text = node.text;
    const atoms = wordAtomsOf(text);
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
            lastHeight = probe.getExactSpreadVisibleBox(true, false).height;
            lineStart = atom.at + 1;
            continue;
        }
        if (!wrap) continue;
        if (!setProbeText(doc, probe, text.slice(0, atom.end), undos)) return null;
        const h = probe.getExactSpreadVisibleBox(true, false).height;
        const fontHeight = story.getGlyphAtts(atom.start).height || 1;
        if (atom.start > lineStart && h - lastHeight > fontHeight * CONFIG.LINE_JUMP_FRACTION) {
            lines.push({ start: lineStart, end: atom.start, bottomHeight: lastHeight });
            lineStart = atom.start;
        }
        lastHeight = h;
    }
    lines.push({ start: lineStart, end: text.length, bottomHeight: lastHeight });
    return lines;
}

// ============================================================
// GLYPH (GRAPHEME CLUSTER) DETECTION, WITHIN AN ALREADY-KNOWN LINE
// ============================================================

// Every non-blank Unicode grapheme cluster of `text` as `{start, end}` - a base character with
// its own combining accent mark, or a multi-part emoji, stays one piece; a font ligature (two
// letters shaped into one fused glyph) does not - see this script's own header for why.
function graphemesOf(text) {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const out = [];
    for (const s of seg.segment(text)) {
        if (s.segment.trim() === '') continue; // whitespace has no glyph of its own
        out.push({ start: s.index, end: s.index + s.segment.length });
    }
    return out;
}

// Every glyph of one already-known line's text as `{start, end, x}` (`start`/`end` relative to
// the line's own text, not the whole story) - `x` the same way break-into-words.js finds a
// word's own left edge: the line's text so far (up to and including this glyph) probed alone,
// minus this glyph probed completely alone, since trailing white space leaves no visible trace
// to measure (verified directly: "ab", "ab ", "ab  " all measure the same width) - except here
// there's usually no white space to lose, since most glyphs sit right against their neighbours.
function glyphsInLine(doc, probe, lineText, undos) {
    const glyphs = graphemesOf(lineText);
    const placed = [];
    for (const g of glyphs) {
        if (!setProbeText(doc, probe, lineText.slice(0, g.end), undos)) return null;
        const prefixBox = probe.getExactSpreadVisibleBox(true, false);
        if (!setProbeText(doc, probe, lineText.slice(g.start, g.end), undos)) return null;
        const aloneBox = probe.getExactSpreadVisibleBox(true, false);
        placed.push({ start: g.start, end: g.end, x: prefixBox.x + (prefixBox.width - aloneBox.width) });
    }
    return placed;
}

// Every glyph of `node`'s text as `{start, end, x, y}` (`start`/`end` into the whole story).
// Finds lines first (word-level - the granularity Affinity actually wraps at), then probes
// within each one, grapheme by grapheme, purely for position - no wrap-checking there, since a
// line already known to fit can't wrap partway through it.
function scanGlyphs(doc, node, wrap, undos) {
    const lines = detectLines(doc, node, wrap, undos);
    if (!lines) return null;

    const text = node.text;
    const totalGlyphs = lines.reduce((sum, l) => sum + graphemesOf(text.slice(l.start, l.end)).length, 0);
    if (totalGlyphs === 0) return null;
    if (totalGlyphs > CONFIG.MAX_GLYPHS_PER_TEXT) return null;

    const frameTop = node.getExactSpreadVisibleBox(true, false).y;
    const probe = node.duplicate();
    undos.count++;

    const out = [];
    for (const line of lines) {
        const lineText = text.slice(line.start, line.end);
        const glyphs = glyphsInLine(doc, probe, lineText, undos);
        if (!glyphs) return null;
        const y = frameTop + line.bottomHeight;
        for (const g of glyphs) out.push({ start: line.start + g.start, end: line.start + g.end, x: g.x, y });
    }
    return out;
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

function buildGlyphDefinition(node, glyph) {
    const story = node.storyInterface.story;
    const sb = StoryBuilder.create();
    sliceIntoBuilder(sb, node, glyph.start, glyph.end);
    const atts = ParagraphAtts.create();
    atts.alignXType = pointAlign(story.getParagraphAtts(glyph.start).alignXType);
    sb.setParagraphAtts(atts);
    return ArtTextNodeDefinition.createFromStoryBuilder({ x: glyph.x, y: glyph.y }, sb);
}

// ============================================================
// RUN
// ============================================================

function glyphsOf(doc, node) {
    const undos = { count: 0 };
    let glyphs = null;
    try {
        if (node.isFrameTextNode) {
            if (isThreaded(node) || isOverflowing(node)) return null;
            glyphs = scanGlyphs(doc, node, true, undos);
        } else {
            glyphs = scanGlyphs(doc, node, false, undos);
        }
    } finally {
        for (let i = 0; i < undos.count; i++) doc.undo();
    }
    return glyphs;
}

function buildCommand(doc, roots) {
    const candidates = collectCandidates(roots);
    const results = [];
    let skipped = 0;
    for (const node of candidates) {
        if (!node.text || !node.text.trim()) { skipped++; continue; }
        const glyphs = glyphsOf(doc, node);
        if (!glyphs || glyphs.length < 2) { skipped++; continue; }
        results.push({ node, glyphs });
    }
    if (results.length === 0) return { cmd: null, skipped };

    const addBuilder = AddChildNodesCommandBuilder.create(doc);
    let pieceCount = 0;
    for (const r of results) {
        for (const glyph of r.glyphs) {
            addBuilder.addNode(buildGlyphDefinition(r.node, glyph), r.node.parent, NodeMoveType.After, NodeChildType.Main);
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
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
        alert('This script needs Intl.Segmenter, which this version of Affinity\'s scripting engine does not provide.');
        return;
    }

    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const roots = doc.selection.nodes.toArray();
    if (roots.length === 0) { alert('Please select one or more Frame Text or Artistic Text objects'); return; }

    const result = buildCommand(doc, roots);
    if (!result.cmd) {
        alert('Select Frame Text or Artistic Text with more than one glyph to break apart');
        return;
    }

    doc.executeCommand(result.cmd);
    alert('Broke ' + result.objects + ' object' + (result.objects === 1 ? '' : 's') + ' into ' +
        result.pieces + ' glyph' + (result.pieces === 1 ? '' : 's') +
        (result.skipped ? ' (' + result.skipped + ' skipped)' : '') + '.');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
