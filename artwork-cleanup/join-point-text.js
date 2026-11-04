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
Script Name:    join-point-text.js
Description:    Approximate port of VectorCraft's Artwork Cleanup > Join Point Text. Unlike its
                 sibling combine-point-text.js (which only welds same-line neighbours and can
                 leave several objects behind), this always produces exactly one object: every
                 selected one-line Artistic Text piece turned like the top-left one becomes one
                 line of a real paragraph, top to bottom, left-aligned, with the gap between
                 lines kept as leading. Pieces turned a different way are left untouched. Same
                 SDK constraint as combine-point-text.js - no per-glyph position API - so this
                 is approximate, not pixel-exact; see join-point-text.md.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        04/11/2026
Last updated:   04/11/2026
Compatibility:  Affinity by Canva 3.3

See join-point-text.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // Two pieces are on the same line when their boxes' vertical centres are within this
    // fraction of the smaller piece's box height - a stand-in for VectorCraft's 0.4 em baseline
    // check, since box height is the closest thing to a font size this SDK exposes.
    SAME_LINE_FRACTION: 0.5,
    // How far apart two pieces' rotation/scale/shear may be and still count as "turned alike".
    TURN_TOLERANCE: 1e-4,
    MAX_OBJECTS: 5000,
};

const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');
const { ArtTextNodeDefinition } = require('/nodes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { ParagraphAtts, ParagraphAlignXType, ParagraphLeadingType } = require('/paragraphatts.js');

// ============================================================
// ORIENTATION HELPERS (duplicated from combine-point-text.js)
// ============================================================

function turnOf(node) {
    return node.transform.decompose();
}

function turnedAlike(a, b) {
    const t = CONFIG.TURN_TOLERANCE;
    return Math.abs(a.rotation - b.rotation) <= t && Math.abs(a.scaleX - b.scaleX) <= t &&
        Math.abs(a.scaleY - b.scaleY) <= t && Math.abs(a.shear - b.shear) <= t;
}

// ============================================================
// COLLECTING CANDIDATES (duplicated from combine-point-text.js)
// ============================================================

// One-line, horizontal Artistic Text - the only kind VectorCraft's own Join Point Text takes.
// Frame Text, multi-line text and text on a path are left alone entirely.
function isCombinable(node) {
    if (!node.isArtTextNode) return false;
    const text = node.text;
    return text.trim() !== '' && !text.includes('\n') && !text.includes('\u2028') && !text.includes('\r');
}

function collectCandidates(roots) {
    const out = [];
    function visit(node) {
        if (out.length >= CONFIG.MAX_OBJECTS) return;
        if (!node.isLocalEditable || !node.isVisible) return;
        if (isCombinable(node)) {
            out.push({ node, box: node.spreadVisibleBox, turn: turnOf(node), text: node.text });
        } else if (node.isGroupNode) {
            for (const child of node.children.toArray()) visit(child);
        }
    }
    for (const root of roots) visit(root);
    return out;
}

// ============================================================
// LINES
// ============================================================

// The piece highest, then furthest left, among `pieces` - the reference every other piece's
// orientation is checked against, and whose own place and paint the joined object takes.
function topLeftOf(pieces) {
    return pieces.reduce((best, p) => {
        if (!best) return p;
        return (p.box.y < best.box.y || (p.box.y === best.box.y && p.box.x < best.box.x)) ? p : best;
    }, null);
}

// `pieces` (already filtered to ones turned like the reference) grouped into lines, top to
// bottom by box-centre height, each line sorted left to right - no appearance check, unlike
// combine-point-text.js's line-finding, matching VectorCraft's own Join Point Text.
function groupIntoLines(pieces) {
    const sorted = [...pieces].sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
    const lines = [];
    for (const piece of sorted) {
        const centreY = piece.box.y + piece.box.height / 2;
        const line = lines.find(l => {
            const first = l[0];
            const firstCentreY = first.box.y + first.box.height / 2;
            const sizeMin = Math.min(first.box.height, piece.box.height);
            return Math.abs(firstCentreY - centreY) <= CONFIG.SAME_LINE_FRACTION * sizeMin;
        });
        if (line) line.push(piece); else lines.push([piece]);
    }
    for (const line of lines) line.sort((a, b) => a.box.x - b.box.x);
    return lines;
}

// A line's own baseline-ish y (its first piece's box bottom) - used only to measure the gap
// between one line and the next, since no real baseline is readable.
function lineBaselineY(line) {
    return line[0].box.y + line[0].box.height;
}

// ============================================================
// BUILDING THE JOINED TEXT
// ============================================================

function storyRuns(node) {
    const story = node.storyInterface.story;
    return [...story.attRuns].map(r => ({ glyphAtts: r.glyphAtts, text: story.getText(r.begin, r.end - r.begin) }));
}

function lastGlyphAtts(node) {
    const runs = storyRuns(node);
    return runs.length > 0 ? runs[runs.length - 1].glyphAtts : null;
}

// Adds one line's pieces to `sb`, left to right, with a plain space (styled like the piece
// before it) between two pieces that don't already have one at the join - same rule as
// combine-point-text.js's merge, just writing into a shared builder instead of a fresh one.
function addLine(sb, line) {
    let text = '';
    for (let i = 0; i < line.length; i++) {
        const piece = line[i];
        if (i > 0) {
            const blank = /\s$/.test(text) || /^\s/.test(piece.text);
            if (!blank) {
                const atts = lastGlyphAtts(line[i - 1].node);
                if (atts) sb.setGlyphAtts(atts);
                sb.addText(' ');
                text += ' ';
            }
        }
        for (const r of storyRuns(piece.node)) {
            if (r.glyphAtts) sb.setGlyphAtts(r.glyphAtts);
            sb.addText(r.text);
            text += r.text;
        }
    }
}

// Builds the whole joined definition: every line as one left-aligned paragraph, in order, each
// (but the first) keeping the gap to the line above as its own exact leading.
function buildJoinedDefinition(lines, anchor) {
    const sb = StoryBuilder.create();
    let prevY = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i > 0) sb.addParagraphBreak();
        const atts = ParagraphAtts.create();
        atts.alignXType = ParagraphAlignXType.Left;
        const y = lineBaselineY(line);
        if (prevY !== null) {
            const leading = y - prevY;
            if (Number.isFinite(leading) && leading > 0) {
                atts.leadingType = ParagraphLeadingType.ExactlyAbsolute;
                atts.absoluteLeading = leading;
            }
        }
        prevY = y;
        sb.setParagraphAtts(atts);
        addLine(sb, line);
    }
    return ArtTextNodeDefinition.createFromStoryBuilder(anchor, sb);
}

// One compound, one undo step: the joined object is added, then every piece it used (not the
// ones left out for being turned differently) is deleted. See combine-point-text.md for why
// this can't copy the reference piece's object-level opacity/blend mode onto the result, or
// place it any more precisely than by its own box.
function buildCommand(doc, roots) {
    const pieces = collectCandidates(roots);
    if (pieces.length === 0) return { cmd: null };
    const topLeft = topLeftOf(pieces);
    const kept = pieces.filter(p => turnedAlike(topLeft.turn, p.turn));
    if (kept.length < 2) return { cmd: null };

    const lines = groupIntoLines(kept);
    const anchor = { x: topLeft.box.x, y: topLeft.box.y + topLeft.box.height };
    const def = buildJoinedDefinition(lines, anchor);

    const addBuilder = AddChildNodesCommandBuilder.create(doc);
    addBuilder.addNode(def, topLeft.node.parent, NodeMoveType.After, NodeChildType.Main);

    const builder = CompoundCommandBuilder.create();
    builder.addCommand(addBuilder.createCommand());
    for (const piece of kept) builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, piece.node)));
    return { cmd: builder.createCommand(), joined: kept.length, lines: lines.length };
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const roots = doc.selection.nodes.toArray();
    if (roots.length === 0) { alert('Please select two or more one-line point text objects'); return; }

    const result = buildCommand(doc, roots);
    if (!result.cmd) {
        alert('Select two or more one-line point text objects to join');
        return;
    }

    doc.executeCommand(result.cmd);
    alert('Joined ' + result.joined + ' piece' + (result.joined === 1 ? '' : 's') +
        ' into one object (' + result.lines + ' line' + (result.lines === 1 ? '' : 's') + ').');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
