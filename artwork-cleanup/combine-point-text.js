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
Script Name:    combine-point-text.js
Description:    Approximate port of VectorCraft's Artwork Cleanup > Combine Point Text.
                 VectorCraft's own version keeps every glyph pixel-exact by solving for the
                 letter-spacing between pieces; the Affinity SDK has no way to read a glyph's
                 rendered position, so that guarantee can't be reproduced. This version instead
                 groups one-line point text objects into lines by their bounding boxes, merges
                 each left-to-right run into one object with a plain space between pieces, and
                 lets Affinity's own text layout place it - close in the ordinary case, but not
                 pixel-identical. See combine-point-text.md.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        04/11/2026
Last updated:   04/11/2026
Compatibility:  Affinity by Canva 3.3

See combine-point-text.md for the full guide.

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
    // Within a line, the widest gap (and the most overlap) two pieces may have and still chain
    // together, as a multiple of the smaller piece's box height.
    MAX_GAP_FACTOR: 10,
    MAX_OVERLAP_FACTOR: 1,
    // How far apart two pieces' rotation/scale/shear may be and still count as "turned alike".
    TURN_TOLERANCE: 1e-4,
    MAX_OBJECTS: 5000,
};

const { AddChildNodesCommandBuilder, CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');
const { ArtTextNodeDefinition } = require('/nodes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { BlendMode } = require('/blendmodeinterface.js');
const { FillType } = require('/fills.js');

// ============================================================
// APPEARANCE / ORIENTATION HELPERS (soldKey/paintKey duplicated from check-and-fix.js)
// ============================================================

function soldKey(descriptor) {
    if (!descriptor) return 'none';
    const fill = descriptor.fill;
    if (!fill || fill.fillType === FillType.None) return 'none';
    if (fill.fillType !== FillType.Solid) return null;
    const c = fill.colour.rgba8;
    return 'solid:' + c.r + ',' + c.g + ',' + c.b + ',' + c.alpha;
}

function strokeWidth(node) {
    try { return node.lineStyle.weight; } catch (e) { return 0; }
}

function isStroked(node) {
    return !!node.hasPenFill && strokeWidth(node) > 0;
}

function paintKey(node) {
    const fillKey = node.hasBrushFill ? soldKey(node.brushFillDescriptor) : 'none';
    if (fillKey === null) return null;
    const strokeKey = isStroked(node) ? soldKey(node.penFillDescriptor) : 'none';
    if (strokeKey === null) return null;
    return fillKey + '|' + strokeKey + '|' + strokeWidth(node).toFixed(6);
}

// Whether `a` and `b` look alike apart from their text: paint, opacity and blend mode.
function sameLook(a, b) {
    if (Math.abs(a.globalOpacity - b.globalOpacity) > 1e-6) return false;
    if (a.blendMode !== b.blendMode) return false;
    const pa = paintKey(a), pb = paintKey(b);
    return pa !== null && pa === pb;
}

// Each piece's own rotation/scale/shear (its local transform, ignoring position) - good enough
// for the common case of a flat selection with no differently-rotated ancestors; see
// combine-point-text.md's Known Limitations.
function turnOf(node) {
    return node.transform.decompose();
}

function turnedAlike(a, b) {
    const t = CONFIG.TURN_TOLERANCE;
    return Math.abs(a.rotation - b.rotation) <= t && Math.abs(a.scaleX - b.scaleX) <= t &&
        Math.abs(a.scaleY - b.scaleY) <= t && Math.abs(a.shear - b.shear) <= t;
}

// ============================================================
// COLLECTING CANDIDATES
// ============================================================

// One-line, horizontal point text - the only kind VectorCraft's own Combine Point Text takes.
function isCombinable(node) {
    if (!node.isArtTextNode) return false;
    const text = node.text;
    return text.trim() !== '' && !text.includes('\n') && !text.includes(' ') && !text.includes('\r');
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
// LINES AND RUNS
// ============================================================

// Pieces grouped into lines: turned alike, looking alike, and close enough in box-centre height
// to the first piece already in that line - mirrors VectorCraft's own line-finding, with a box
// height standing in for font size.
function groupIntoLines(pieces) {
    const sorted = [...pieces].sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
    const lines = [];
    for (const piece of sorted) {
        const centreY = piece.box.y + piece.box.height / 2;
        const line = lines.find(l => {
            const first = l[0];
            const firstCentreY = first.box.y + first.box.height / 2;
            const sizeMin = Math.min(first.box.height, piece.box.height);
            return turnedAlike(first.turn, piece.turn) && sameLook(first.node, piece.node) &&
                Math.abs(firstCentreY - centreY) <= CONFIG.SAME_LINE_FRACTION * sizeMin;
        });
        if (line) line.push(piece); else lines.push([piece]);
    }
    return lines;
}

// Each line split into left-to-right runs, breaking wherever the gap is too wide or the
// overlap too deep to plausibly be one run of text.
function splitIntoRuns(line) {
    const sorted = [...line].sort((a, b) => a.box.x - b.box.x);
    const runs = [];
    let run = [];
    for (const piece of sorted) {
        if (run.length > 0) {
            const prev = run[run.length - 1];
            const size = Math.min(prev.box.height, piece.box.height);
            const gap = piece.box.x - (prev.box.x + prev.box.width);
            if (gap > CONFIG.MAX_GAP_FACTOR * size || gap < -CONFIG.MAX_OVERLAP_FACTOR * size) {
                runs.push(run);
                run = [];
            }
        }
        run.push(piece);
    }
    if (run.length > 0) runs.push(run);
    return runs;
}

// ============================================================
// MERGING
// ============================================================

function storyRuns(node) {
    const story = node.storyInterface.story;
    return [...story.attRuns].map(r => ({ glyphAtts: r.glyphAtts, text: story.getText(r.begin, r.end - r.begin) }));
}

function lastGlyphAtts(node) {
    const runs = storyRuns(node);
    return runs.length > 0 ? runs[runs.length - 1].glyphAtts : null;
}

// Builds the merged story for a left-to-right run of two or more pieces: each piece's own
// character styling (including its colour, which Affinity keeps as a character attribute, not
// an object-level fill override) is kept, and a plain space (styled like the piece before it)
// goes between two pieces unless one of them already starts or ends with whitespace.
function buildMergedDefinition(run) {
    const sb = StoryBuilder.create();
    let text = '';
    for (let i = 0; i < run.length; i++) {
        const piece = run[i];
        if (i > 0) {
            const blank = /\s$/.test(text) || /^\s/.test(piece.text);
            if (!blank) {
                const atts = lastGlyphAtts(run[i - 1].node);
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
    // A new text object's `position` lands exactly there in spread space, regardless of its
    // eventual parent's own transform - verified empirically, not documented. The leftmost
    // piece's box bottom-left stands in for its baseline-start point (close enough for ordinary
    // text without descenders on its first character; see combine-point-text.md).
    const anchor = { x: run[0].box.x, y: run[0].box.y + run[0].box.height };
    return ArtTextNodeDefinition.createFromStoryBuilder(anchor, sb);
}

// One compound, one undo step: every run's merged object is added, then every original piece
// (across every run) is deleted. A freshly created node can't be read back before the whole
// compound actually runs (DocumentCommand.newNodes throws INVALID_OP until then), so this never
// tries to - position comes from `buildMergedDefinition`'s anchor, and object-level opacity/
// blend mode are left at their defaults rather than copied; see Known Limitations.
function buildCommand(doc, roots) {
    const pieces = collectCandidates(roots);
    const runs = groupIntoLines(pieces).flatMap(splitIntoRuns).filter(r => r.length >= 2);
    if (runs.length === 0) return { cmd: null, combined: 0, made: 0 };

    const addBuilder = AddChildNodesCommandBuilder.create(doc);
    for (const run of runs) {
        addBuilder.addNode(buildMergedDefinition(run), run[0].node.parent, NodeMoveType.After, NodeChildType.Main);
    }

    const builder = CompoundCommandBuilder.create();
    builder.addCommand(addBuilder.createCommand());
    let combined = 0;
    for (const run of runs) {
        combined += run.length - 1;
        for (const piece of run) builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, piece.node)));
    }
    return { cmd: builder.createCommand(), combined, made: runs.length };
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
        alert('Select two or more one-line point text objects on one baseline to combine');
        return;
    }

    doc.executeCommand(result.cmd);
    alert('Combined ' + result.combined + ' piece' + (result.combined === 1 ? '' : 's') +
        ' into ' + result.made + ' object' + (result.made === 1 ? '' : 's') + '.');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
