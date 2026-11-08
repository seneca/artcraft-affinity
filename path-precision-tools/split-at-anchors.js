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
Script Name:    split-at-anchors.js
Description:    Approximate port of VectorCraft's Path Precision Tools > Split at Anchors (one of
                 its live Path Effects there; this applies the same idea destructively, once, as
                 a batch of Affinity's own single-node Break Curve). Splits every selected path
                 (and every subpath of a compound path, and every path nested in a selected
                 group) into separate open pieces at either every anchor or just its corners (an
                 adjustable turn-angle threshold), as one undo step. A split duplicates the
                 anchor into two independent, coincident endpoints exactly like Break Curve does,
                 so nothing moves and no gap opens up - the pieces just stop being one path.
                 Affinity's own SDK exposes no way to read which individual anchors are selected
                 within a path, so this can't target only the selected nodes the way Break Curve
                 itself does; see split-at-anchors.md's Known limitations.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        08/11/2026
Last updated:   08/11/2026
Compatibility:  Affinity by Canva 3.3

See split-at-anchors.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    ANGLE_MIN: 1,
    ANGLE_MAX: 179,
    ANGLE_DEFAULT: 30,
    MODE_CORNERS: 0,
    MODE_EVERY: 1,
    MODE_DEFAULT: 0,
    // Refuse rather than let a pathologically large selection in Every Anchor mode produce an
    // unmanageable number of pieces.
    MAX_PIECES: 50000,
    LIVE_PREVIEW_MAX_PIECES: 4000,
};

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { CurveBuilder, PolyCurve } = require('/geometry.js');

// ============================================================
// VECTOR / CUBIC BEZIER HELPERS
// ============================================================

function makeCubic(p0, p1, p2, p3) { return { start: p0, c1: p1, c2: p2, end: p3 }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }

function unit(v) {
    const l = Math.hypot(v.x, v.y);
    return (l > 1e-12 && isFinite(l)) ? { x: v.x / l, y: v.y / l } : null;
}
function dot(a, b) { return a.x * b.x + a.y * b.y; }

function startTangent(c) {
    return unit(sub(c.c1, c.start)) || unit(sub(c.c2, c.start)) || unit(sub(c.end, c.start)) || { x: 1, y: 0 };
}
function endTangent(c) {
    return unit(sub(c.end, c.c2)) || unit(sub(c.end, c.c1)) || unit(sub(c.end, c.start)) || { x: 1, y: 0 };
}
function turnDeg(inDir, outDir) {
    const d = Math.max(-1, Math.min(1, dot(inDir, outDir)));
    return Math.acos(d) * 180 / Math.PI;
}

// ============================================================
// CURVE EXTRACTION / REBUILD
// ============================================================

function extractSegments(cv) {
    const closed = cv.isClosed;
    const first = cv.firstOnCurvePointIndex, last = cv.lastOnCurvePointIndex;
    const segs = [];
    let i = first;
    while (i < last) {
        const bez = cv.getCubicBezier(i);
        segs.push(makeCubic(bez.start, bez.c1, bez.c2, bez.end));
        i = cv.getNextOnCurvePointIndex(i, false);
    }
    return { segs, closed };
}

function fullAnchors(segs, closed) {
    const n = closed ? segs.length : segs.length + 1;
    const anchors = [];
    for (let k = 0; k < n; k++) {
        const p = k < segs.length ? segs[k].start : segs[segs.length - 1].end;
        const hOut = k < segs.length ? segs[k].c1 : p;
        const hIn = (k > 0 || closed) ? segs[(k - 1 + segs.length) % segs.length].c2 : p;
        anchors.push({ p, hIn, hOut });
    }
    return anchors;
}

// The open-chain {p, hIn, hOut} anchors of a plain segment list - the new path ends (anchor 0's
// hIn, and the last anchor's hOut) are zeroed, exactly like Break Curve leaves them.
function segsToAnchorsOpen(segs) {
    const n = segs.length + 1;
    const anchors = [];
    for (let k = 0; k < n; k++) {
        const p = k < segs.length ? segs[k].start : segs[segs.length - 1].end;
        const hOut = k < segs.length ? segs[k].c1 : p;
        const hIn = k > 0 ? segs[k - 1].c2 : p;
        anchors.push({ p, hIn, hOut });
    }
    return anchors;
}

function buildCurveFromAnchorsOpen(anchors) {
    const cb = CurveBuilder.create();
    const n = anchors.length;
    cb.beginXY(anchors[0].p.x, anchors[0].p.y);
    for (let k = 1; k < n; k++) cb.addBezier(anchors[k - 1].hOut, anchors[k].hIn, anchors[k].p);
    return cb.createCurve();
}

// ============================================================
// SPLIT LOGIC
// ============================================================

// The interior turn angle (degrees) at anchor `i` - only ever called for a true interior anchor
// (never an open subpath's own two ends), so the modular neighbour lookup never actually wraps
// for an open subpath.
function cornerAngleAt(anchors, i) {
    const n = anchors.length;
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    const segPrev = makeCubic(anchors[prev].p, anchors[prev].hOut, anchors[i].hIn, anchors[i].p);
    const segNext = makeCubic(anchors[i].p, anchors[i].hOut, anchors[next].hIn, anchors[next].p);
    return turnDeg(endTangent(segPrev), startTangent(segNext));
}

function findSplitIndices(anchors, closed, mode, angleDeg) {
    const n = anchors.length;
    const idxs = [];
    if (closed) {
        for (let i = 0; i < n; i++) {
            if (mode === CONFIG.MODE_EVERY || cornerAngleAt(anchors, i) > angleDeg) idxs.push(i);
        }
    } else {
        for (let i = 1; i < n - 1; i++) {
            if (mode === CONFIG.MODE_EVERY || cornerAngleAt(anchors, i) > angleDeg) idxs.push(i);
        }
    }
    return idxs;
}

// Builds the open pieces that result from splitting `segs` at the given anchor-index
// `splitIndices` (interior-only for an open subpath; any index for a closed one). Returns null
// if there's nothing to split. For a closed subpath, the segment list is first rotated so the
// first split point becomes its new start, so no piece ever has to wrap past the array's own
// end.
function buildPieces(segs, closed, splitIndices) {
    if (splitIndices.length === 0) return null;
    const segCount = segs.length;
    let workSegs = segs, boundaries;
    if (closed) {
        const sorted = splitIndices.slice().sort((a, b) => a - b);
        const rot = sorted[0];
        workSegs = rot === 0 ? segs : segs.slice(rot).concat(segs.slice(0, rot));
        const rotated = sorted.map(i => ((i - rot) + segCount) % segCount).filter(i => i !== 0);
        rotated.sort((a, b) => a - b);
        boundaries = [0, ...rotated, segCount];
    } else {
        boundaries = [0, ...splitIndices.slice().sort((a, b) => a - b), segCount];
    }
    const pieces = [];
    for (let j = 0; j < boundaries.length - 1; j++) {
        const a = boundaries[j], b = boundaries[j + 1];
        if (b > a) pieces.push(segsToAnchorsOpen(workSegs.slice(a, b)));
    }
    // A single split point on a closed subpath is still a real change - it opens the loop into
    // one piece, same as Break Curve at one node. An open subpath's non-empty splitIndices
    // always yields at least 2 pieces already, so this only matters for that closed case.
    return pieces.length > 0 ? pieces : null;
}

// ============================================================
// SELECTION / NODE GATHERING
// ============================================================

function collectPathNodes(roots) {
    const out = [];
    const consider = (node) => {
        if (node.isPolyCurveNode && node.isEditable && node.isVisibleInDomain) out.push(node);
    };
    for (const root of roots) {
        consider(root);
        for (const child of root.children.all) consider(child);
    }
    return out;
}

// ============================================================
// COMMAND / DIALOG
// ============================================================

function buildCommand(nodes, opts, maxPieces) {
    let totalPieces = 0, tooMany = false;
    const commands = [];
    for (const node of nodes) {
        if (tooMany) break;
        const poly = node.curvesInterface.polyCurve;
        const total = poly.curveCount;
        let changed = false;
        const newPoly = PolyCurve.create();
        for (let i = 0; i < total; i++) {
            const cv = poly.at(i);
            const { segs, closed } = extractSegments(cv);
            if (segs.length === 0) { newPoly.addCurve(cv); continue; }
            const anchors = fullAnchors(segs, closed);
            const idxs = findSplitIndices(anchors, closed, opts.mode, opts.angle);
            const pieces = buildPieces(segs, closed, idxs);
            if (!pieces) { newPoly.addCurve(cv); continue; }
            changed = true;
            for (const pieceAnchors of pieces) {
                totalPieces++;
                if (totalPieces > maxPieces) { tooMany = true; break; }
                newPoly.addCurve(buildCurveFromAnchorsOpen(pieceAnchors));
            }
            if (tooMany) break;
        }
        if (tooMany) break;
        if (changed) commands.push(DocumentCommand.createSetCurves(node.curvesInterface, newPoly));
    }
    if (tooMany) return { cmd: null, pieces: totalPieces, tooMany: true };
    if (commands.length === 0) return { cmd: null, pieces: totalPieces, tooMany: false };
    if (commands.length === 1) return { cmd: commands[0], pieces: totalPieces, tooMany: false };
    const builder = CompoundCommandBuilder.create();
    for (const cmd of commands) builder.addCommand(cmd);
    return { cmd: builder.createCommand(), pieces: totalPieces, tooMany: false };
}

function buildDialog(Dialog, UnitType) {
    const dlg = Dialog.create("Split at Anchors");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.mode = grp.addComboBox("Split at:", ["Corners Only", "Every Anchor"], CONFIG.MODE_DEFAULT);
    dlg.angle = grp.addUnitValueEditor(
        "Corner Angle:", UnitType.Degree, UnitType.Degree, CONFIG.ANGLE_DEFAULT, CONFIG.ANGLE_MIN, CONFIG.ANGLE_MAX
    ).setShowPopupSlider(true);
    dlg.status = grp.addStaticText(" ", " ").setIsFullWidth(true);
    return dlg;
}

function readOptions(dlg) {
    return { mode: dlg.mode.value, angle: dlg.angle.value };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    // Capture the selection before loading '/dialog.js', which clears it as a side effect.
    const roots = doc.selection.nodes.toArray();
    if (roots.length === 0) {
        alert("Please select one or more paths");
        return;
    }
    const nodes = collectPathNodes(roots);
    if (nodes.length === 0) {
        alert("No editable curve paths were found in the selection");
        return;
    }

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const dlg = buildDialog(Dialog, UnitType);

    let lastKey = null;
    let lastResult = null;
    const compute = (opts, maxPieces) => {
        const key = opts.mode + ':' + opts.angle + ':' + maxPieces;
        if (key !== lastKey) {
            lastResult = buildCommand(nodes, opts, maxPieces);
            lastKey = key;
        }
        return lastResult;
    };

    const statusText = (result) => {
        if (result.tooMany) return "Too many pieces at this setting - try Corners Only, or raise the angle.";
        if (result.pieces === 0) return "No split points found at this setting.";
        return "Would produce " + result.pieces + " piece" + (result.pieces === 1 ? "" : "s") + ".";
    };

    const update = (preview) => {
        const opts = readOptions(dlg);
        const maxPieces = preview ? CONFIG.LIVE_PREVIEW_MAX_PIECES : CONFIG.MAX_PIECES;
        const result = compute(opts, maxPieces);
        if (preview && result.tooMany) {
            doc.clearPreviews();
            dlg.status.text = statusText(result);
            return result;
        }
        if (result.cmd) doc.executeCommand(result.cmd, preview);
        else doc.clearPreviews();
        if (preview) dlg.status.text = statusText(result);
        return result;
    };

    dlg.onControlValueChangedHandler = () => update(true);
    update(true);

    if (dlg.runModal() == DialogResult.Ok) {
        const result = update(false);
        if (result.tooMany) {
            alert("That setting would produce too many pieces - try Corners Only, or raise the angle, and try again.");
        } else if (result.pieces > 0) {
            alert("Produced " + result.pieces + " piece" + (result.pieces === 1 ? "" : "s") + ".");
        } else {
            alert("No split points were found at this setting.");
        }
    }

    doc.clearPreviews();
}

// ============================================================
// RUN
// ============================================================

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
