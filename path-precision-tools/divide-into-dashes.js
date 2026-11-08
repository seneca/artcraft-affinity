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
Script Name:    divide-into-dashes.js
Description:    Ported from VectorCraft's Path Precision Tools > Divide into Dashes. Cuts every
                 selected path (and every subpath of a compound path, and every path nested in a
                 selected group) into separate open pieces of Dash length measured along the
                 curve, with a Gap between them that's either discarded (Remove Gaps) or kept as
                 pieces of its own, as one undo step. With Fit to Corners and Ends, each stretch
                 between two corners (or a corner and a path end) has its Dash/Gap lengths
                 scaled, as a pair, so that stretch starts and ends exactly on a dash - no
                 partial dash is left dangling at a corner or an open end.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        08/11/2026
Last updated:   08/11/2026
Compatibility:  Affinity by Canva 3.3

See divide-into-dashes.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    DASH_MIN_PT: 0.1,
    DASH_MAX_PT: 10000,
    DASH_DEFAULT_PT: 36,
    GAP_MIN_PT: 0,
    GAP_MAX_PT: 10000,
    GAP_DEFAULT_PT: 18,
    // An anchor where the path turns by more than this many degrees is a "corner" that bounds a
    // run for Fit to Corners and Ends - matching simplify-anchors.js's own Protect Corners
    // threshold, which is VectorCraft's own.
    SHARP_CORNER_DEG: 30,
    // Points sampled per original Bezier segment when measuring its length and inverting
    // length back to a parameter - fine for dividing into dash lengths, not sub-point precision.
    LENGTH_SAMPLES: 24,
    // Above this many resulting pieces, live preview is skipped (the final result on OK is not
    // affected) - see divide-into-dashes.md's Known limitations.
    LIVE_PREVIEW_MAX_PIECES: 2000,
    // Refuse rather than let a pathological setting (e.g. a tiny Dash over a very long path)
    // produce an unbounded number of pieces - matching VectorCraft's own cap.
    MAX_PIECES: 100000,
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
function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function dot(a, b) { return a.x * b.x + a.y * b.y; }

function unit(v) {
    const l = Math.hypot(v.x, v.y);
    return (l > 1e-12 && isFinite(l)) ? { x: v.x / l, y: v.y / l } : null;
}

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

function evalCubic(c, t) {
    const s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    return {
        x: c.start.x * b0 + c.c1.x * b1 + c.c2.x * b2 + c.end.x * b3,
        y: c.start.y * b0 + c.c1.y * b1 + c.c2.y * b2 + c.end.y * b3,
    };
}

// De Casteljau subdivision of `c` at parameter `t`, splitting it into two cubics that together
// trace exactly the same curve.
function splitCubic(c, t) {
    const p01 = lerp(c.start, c.c1, t), p12 = lerp(c.c1, c.c2, t), p23 = lerp(c.c2, c.end, t);
    const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    const p0123 = lerp(p012, p123, t);
    return { left: makeCubic(c.start, p01, p012, p0123), right: makeCubic(p0123, p123, p23, c.end) };
}

function cubicLength(c, samples) {
    let len = 0, prev = c.start;
    for (let i = 1; i <= samples; i++) {
        const p = evalCubic(c, i / samples);
        len += dist(prev, p);
        prev = p;
    }
    return len;
}

// The parameter t in [0, 1] on `c` where the arc length from c.start reaches `targetLen` (out of
// the segment's own total `segLen`), found by sampling + linear interpolation between samples.
function paramAtLength(c, targetLen, segLen, samples) {
    if (targetLen <= 0) return 0;
    if (targetLen >= segLen) return 1;
    let prevP = c.start, prevLen = 0;
    for (let i = 1; i <= samples; i++) {
        const p = evalCubic(c, i / samples);
        const step = dist(prevP, p);
        const curLen = prevLen + step;
        if (curLen >= targetLen) {
            const frac = step > 1e-9 ? (targetLen - prevLen) / step : 0;
            return ((i - 1) + frac) / samples;
        }
        prevLen = curLen; prevP = p;
    }
    return 1;
}

// ============================================================
// CURVE EXTRACTION / REBUILD
// ============================================================

// The ordered list of cubic Bezier segments making up a Curve, open or closed, in its own
// coordinate space - same walk as simplify-anchors.js's extractAnchors, stopping one short of
// deriving anchors since this script cuts within segments rather than removing them.
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

// The {p, hIn, hOut} anchors an (open) chain of segments would have - segsToAnchors(segs, false)
// always, since every piece this script produces is open.
function segsToAnchors(segs) {
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

// The closed-or-open {p, hIn, hOut} anchors of a full segment chain - used only for corner
// detection below, where closed wraparound matters.
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

function buildCurveFromAnchors(anchors) {
    const cb = CurveBuilder.create();
    const n = anchors.length;
    cb.beginXY(anchors[0].p.x, anchors[0].p.y);
    for (let k = 1; k < n; k++) {
        cb.addBezier(anchors[k - 1].hOut, anchors[k].hIn, anchors[k].p);
    }
    return cb.createCurve();
}

// ============================================================
// DASH DIVISION
// ============================================================

function isCornerAt(anchors, closed, i) {
    const n = anchors.length;
    if (!closed && (i === 0 || i === n - 1)) return true;
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    const segPrev = makeCubic(anchors[prev].p, anchors[prev].hOut, anchors[i].hIn, anchors[i].p);
    const segNext = makeCubic(anchors[i].p, anchors[i].hOut, anchors[next].hIn, anchors[next].p);
    return turnDeg(endTangent(segPrev), startTangent(segNext)) > CONFIG.SHARP_CORNER_DEG;
}

// Divides one subpath's worth of segments into open pieces per CONFIG and `opts`. Returns the
// list of pieces (each an anchors array ready for buildCurveFromAnchors) and whether anything
// about this subpath changed.
function divideSubpath(cvSegs, closed, opts) {
    let segs = cvSegs;
    const segCount = segs.length;
    if (segCount === 0) return { pieces: [], changed: false };

    // For a closed subpath with corner-bounded runs, rotate the segment list so the first corner
    // found becomes the new start - so no run ever has to wrap past the segment list's own end.
    if (closed && opts.fit) {
        const anchors0 = fullAnchors(segs, true);
        let firstCorner = -1;
        for (let i = 0; i < anchors0.length; i++) {
            if (isCornerAt(anchors0, true, i)) { firstCorner = i; break; }
        }
        if (firstCorner > 0) segs = segs.slice(firstCorner).concat(segs.slice(0, firstCorner));
    }

    const segLens = segs.map(s => cubicLength(s, CONFIG.LENGTH_SAMPLES));
    const cumBefore = [0];
    for (let i = 0; i < segCount; i++) cumBefore.push(cumBefore[i] + segLens[i]);
    const totalLen = cumBefore[segCount];
    if (totalLen < 1e-6) return { pieces: [], changed: false };

    const anchors = fullAnchors(segs, closed);
    const n = anchors.length;

    let boundaries;
    if (!opts.fit) {
        boundaries = closed ? [0] : [0, n - 1];
    } else if (!closed) {
        boundaries = [0];
        for (let i = 1; i < n - 1; i++) if (isCornerAt(anchors, false, i)) boundaries.push(i);
        boundaries.push(n - 1);
    } else {
        boundaries = [0];
        for (let i = 1; i < n; i++) if (isCornerAt(anchors, true, i)) boundaries.push(i);
    }

    const runs = [];
    for (let i = 0; i < boundaries.length; i++) {
        const isLast = i === boundaries.length - 1;
        const startArc = cumBefore[boundaries[i]];
        const endArc = isLast ? totalLen : cumBefore[boundaries[i + 1]];
        if (endArc > startArc + 1e-9) runs.push({ startArc, endArc });
    }

    const keptIntervals = [];
    for (const run of runs) {
        const runLen = run.endArc - run.startArc;
        let dash = opts.dash, gap = opts.gap;
        if (opts.fit) {
            // A run of N dashes has N-1 gaps between them (it starts AND ends on a dash, per
            // Fit to Corners and Ends), not N - so the scaled total is N*dash + (N-1)*gap, not
            // N*(dash+gap). Picking N from (runLen+gap)/(dash+gap) comes from solving that
            // equation for N at the original, unscaled dash:gap ratio.
            const cycle = Math.max(dash + gap, 1e-6);
            const dashes = Math.max(1, Math.round((runLen + gap) / cycle));
            const denom = Math.max(dash * dashes + gap * (dashes - 1), 1e-6);
            const scale = runLen / denom;
            dash *= scale; gap *= scale;
        }
        let pos = run.startArc, isDash = true, guard = 0;
        while (pos < run.endArc - 1e-9 && guard++ < CONFIG.MAX_PIECES + 2) {
            const step = Math.max(isDash ? dash : gap, 1e-6);
            const next = Math.min(run.endArc, pos + step);
            if (isDash || !opts.removeGaps) keptIntervals.push([pos, next]);
            pos = next;
            isDash = !isDash;
        }
    }
    if (keptIntervals.length === 0) return { pieces: [], changed: false };

    function locate(arc) {
        let idx = segCount - 1;
        for (let i = 0; i < segCount; i++) {
            if (arc <= cumBefore[i + 1] + 1e-9) { idx = i; break; }
        }
        const localTarget = Math.max(0, Math.min(segLens[idx], arc - cumBefore[idx]));
        const t = paramAtLength(segs[idx], localTarget, segLens[idx], CONFIG.LENGTH_SAMPLES);
        return { idx, t };
    }

    function piece(a, b) {
        const from = locate(a), to = locate(b);
        let pieceSegs;
        if (from.idx === to.idx) {
            const right = splitCubic(segs[from.idx], from.t).right;
            const denom = Math.max(1e-9, 1 - from.t);
            const localEndT = Math.max(0, Math.min(1, (to.t - from.t) / denom));
            pieceSegs = [splitCubic(right, localEndT).left];
        } else {
            pieceSegs = [splitCubic(segs[from.idx], from.t).right];
            for (let i = from.idx + 1; i < to.idx; i++) pieceSegs.push(segs[i]);
            pieceSegs.push(splitCubic(segs[to.idx], to.t).left);
        }
        return segsToAnchors(pieceSegs);
    }

    const pieces = keptIntervals.map(([a, b]) => piece(a, b));
    return { pieces, changed: true };
}

// ============================================================
// SELECTION / NODE GATHERING
// ============================================================

// Every selected PolyCurveNode, plus every PolyCurveNode nested inside a selected group,
// excluding locked and hidden ones (isEditable/isVisibleInDomain already account for locked or
// hidden ancestors) and parametric shapes (not yet converted to curves) - matching
// simplify-anchors.js's own exclusions, which match VectorCraft's.
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
        const count = poly.curveCount;
        let changed = false;
        const newPoly = PolyCurve.create();
        for (let i = 0; i < count; i++) {
            const cv = poly.at(i);
            const { segs, closed } = extractSegments(cv);
            const result = divideSubpath(segs, closed, opts);
            if (!result.changed) { newPoly.addCurve(cv); continue; }
            changed = true;
            for (const anchors of result.pieces) {
                totalPieces++;
                if (totalPieces > maxPieces) { tooMany = true; break; }
                newPoly.addCurve(buildCurveFromAnchors(anchors));
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

function buildDialog(Dialog, UnitType, doc) {
    const dlg = Dialog.create("Divide into Dashes");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.dash = grp.addUnitValueEditor(
        "Dash:", UnitType.Point, doc.units, CONFIG.DASH_DEFAULT_PT, CONFIG.DASH_MIN_PT, CONFIG.DASH_MAX_PT
    ).setShowPopupSlider(true);
    dlg.gap = grp.addUnitValueEditor(
        "Gap:", UnitType.Point, doc.units, CONFIG.GAP_DEFAULT_PT, CONFIG.GAP_MIN_PT, CONFIG.GAP_MAX_PT
    ).setShowPopupSlider(true);
    dlg.fit = grp.addCheckBox("Fit to Corners and Ends", true).setIsFullWidth(true);
    dlg.removeGaps = grp.addCheckBox("Remove Gaps", true).setIsFullWidth(true);
    dlg.status = grp.addStaticText(" ", " ").setIsFullWidth(true);
    return dlg;
}

function readOptions(dlg) {
    return {
        dash: dlg.dash.value,
        gap: dlg.gap.value,
        fit: dlg.fit.value,
        removeGaps: dlg.removeGaps.value,
    };
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

    const dlg = buildDialog(Dialog, UnitType, doc);

    let lastKey = null;
    let lastResult = null;
    const compute = (opts, maxPieces) => {
        const key = opts.dash + ':' + opts.gap + ':' + opts.fit + ':' + opts.removeGaps + ':' + maxPieces;
        if (key !== lastKey) {
            lastResult = buildCommand(nodes, opts, maxPieces);
            lastKey = key;
        }
        return lastResult;
    };

    const statusText = (result) => {
        if (result.tooMany) {
            return "More than " + CONFIG.MAX_PIECES + " pieces at these settings - raise Dash or Gap.";
        }
        if (result.pieces === 0) return "No pieces at these settings.";
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
            alert("These settings would produce more than " + CONFIG.MAX_PIECES + " pieces - raise Dash or Gap and try again.");
        } else if (result.pieces > 0) {
            alert("Produced " + result.pieces + " piece" + (result.pieces === 1 ? "" : "s") + ".");
        } else {
            alert("No pieces were produced at these settings.");
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
