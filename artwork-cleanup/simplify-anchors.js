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
Script Name:    simplify-anchors.js
Description:    Ported from VectorCraft's Artwork Cleanup > Simplify Anchors (Keep Shape). Removes
                 as many anchors as it can from each selected path (including every subpath of a
                 compound path, and every path nested in a selected group), refitting the Bezier
                 handles beside each removed anchor so the outline keeps its shape within
                 Tolerance, as one undo step. Open ends always stay; a closed path keeps at least
                 three anchors and an open one at least two. With Protect Corners, anchors where
                 the path turns by more than 30 degrees stay. Locked and hidden paths, and
                 parametric shapes (rectangles, ellipses, stars, etc. - not yet converted to
                 curves), are left out, matching VectorCraft's own exclusions.

Author:         Les Pruszynski (Middledot)
Version:        1.0.1
Created:        04/11/2026
Last updated:   04/11/2026
Compatibility:  Affinity by Canva 3.3

See simplify-anchors.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    TOLERANCE_MIN: 1,
    TOLERANCE_MAX: 100,
    TOLERANCE_DEFAULT: 20,
    // Points of allowed outline drift per tolerance step, matching VectorCraft's own dialog
    // (its tooltip reads "up to tolerance x 0.02 pt").
    PT_PER_TOLERANCE: 0.02,
    // An anchor where the path turns by more than this many degrees is a "sharp corner" that
    // Protect Corners keeps, matching VectorCraft's own threshold.
    SHARP_CORNER_DEG: 30,
    // Points sampled on each side of an anchor being removed, when locally refitting the single
    // Bezier segment that replaces its two neighbours. Tuned down from Graphics Gems' usual 16 -
    // each candidate's fit cost scales with this, and running in script (not compiled code) makes
    // that cost matter; 6 points is still enough to stably fit a cubic's 2 free handle lengths.
    FIT_SAMPLES: 6,
    // Golden-section search rounds used to place that refit segment's "where the removed anchor
    // used to be" parameter. 10 rounds narrows the search interval by 0.618^10 (about 0.008) -
    // tighter than this dialog's tolerances need; cutting further starts visibly misplacing the
    // refit. This is the single biggest cost multiplier in the whole reducer, so it's the first
    // thing to tune if it still feels slow.
    GOLDEN_ITERS: 10,
    // Newton reparameterization rounds for the least-squares curve fit beneath each refit. Most of
    // the error reduction happens in the first round or two; a 3rd-4th round earns its cost back
    // on sharp curvature but is rarely worth it here given the tolerance this tool already allows.
    MAX_REPARAM: 2,
    // Points sampled per original segment when measuring how far a candidate refit strays from
    // the outline it would replace.
    DEVIATION_SAMPLES: 5,
    // Skip the live preview above this many anchors across the selection (the fit-and-measure
    // work scales with anchor count and gets noticeably slow past this point in script); the
    // final result is still computed in full on OK. See simplify-anchors.md's Known limitations.
    LIVE_PREVIEW_MAX_ANCHORS: 400,
    // Refuse rather than let a pathologically large selection (e.g. a dense image trace) hang
    // the dialog for minutes.
    MAX_ANCHORS: 20000,
};

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { CurveBuilder, CubicBezier, PolyCurve } = require('/geometry.js');

// ============================================================
// VECTOR / CUBIC BEZIER HELPERS
// ============================================================

function makeCubic(p0, p1, p2, p3) {
    const c = new CubicBezier();
    c.start = p0; c.c1 = p1; c.c2 = p2; c.end = p3;
    return c;
}
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function scale(a, s) { return { x: a.x * s, y: a.y * s }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Unit vector, or null for one too short to have a direction.
function unit(v) {
    const l = Math.hypot(v.x, v.y);
    return (l > 1e-12 && isFinite(l)) ? { x: v.x / l, y: v.y / l } : null;
}

// Direction the curve leaves its start point, robust to a retracted handle.
function startTangent(c) {
    return unit(sub(c.c1, c.start)) || unit(sub(c.c2, c.start)) || unit(sub(c.end, c.start)) || { x: 1, y: 0 };
}
// Direction the curve arrives at its end point (forward travel direction).
function endTangent(c) {
    return unit(sub(c.end, c.c2)) || unit(sub(c.end, c.c1)) || unit(sub(c.end, c.start)) || { x: 1, y: 0 };
}

function bern(t) {
    const s = 1 - t;
    return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
}

// Least-squares cubic Bezier through `pts` (parameterized by `u`, one per point) with fixed end
// tangent directions t0 (leaving the start) and t1 (arriving at the end); only the two handle
// lengths are solved for, via the standard 2x2 normal equations (Graphics Gems' curve fit).
function generate(pts, u, t0, t1) {
    const p0 = pts[0], p3 = pts[pts.length - 1];
    const dirIn = scale(t1, -1);
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], t = u[i], b = bern(t);
        const a0 = scale(t0, b[1]), a1 = scale(dirIn, b[2]);
        c00 += dot(a0, a0);
        c01 += dot(a0, a1);
        c11 += dot(a1, a1);
        const base = add(scale(p0, b[0] + b[1]), scale(p3, b[2] + b[3]));
        const tmp = sub(p, base);
        x0 += dot(a0, tmp);
        x1 += dot(a1, tmp);
    }
    const det = c00 * c11 - c01 * c01;
    const seg = dist(p0, p3);
    const eps = 1e-6 * seg;
    let al, ar;
    if (Math.abs(det) > 1e-12) {
        al = (x0 * c11 - x1 * c01) / det;
        ar = (c00 * x1 - c01 * x0) / det;
    } else {
        al = seg / 3; ar = seg / 3;
    }
    if (!isFinite(al) || !isFinite(ar) || al < eps || ar < eps) {
        al = seg / 3; ar = seg / 3;
    }
    const cap = seg * 4 + 1e-9;
    al = Math.min(al, cap);
    ar = Math.min(ar, cap);
    return makeCubic(p0, add(p0, scale(t0, al)), add(p3, scale(dirIn, ar)), p3);
}

function maxFitError(pts, c, u) {
    let e = 0;
    for (let i = 0; i < pts.length; i++) {
        const d = dist(c.evaluate(u[i]), pts[i]);
        if (d > e) e = d;
    }
    return e;
}

// One Newton step reparameterizing `t`, the point on `c` nearest `p`.
function newtonStep(c, p, t) {
    const q = sub(c.evaluate(t), p);
    const q1 = c.getVelocity(t), q2 = c.getAcceleration(t);
    const num = dot(q, q1), den = dot(q1, q1) + dot(q, q2);
    if (Math.abs(den) < 1e-12) return t;
    const nt = t - num / den;
    return isFinite(nt) ? Math.min(1, Math.max(0, nt)) : t;
}

// `generate()`, refined by a few rounds of Newton reparameterization - each round keeps the
// result only if it reduces the max fit error, matching Graphics Gems' curve-fitting algorithm.
function fitSingleFrom(pts, uIn, t0, t1) {
    let u = uIn.slice();
    let best = generate(pts, u, t0, t1);
    let bestErr = maxFitError(pts, best, u);
    for (let iter = 0; iter < CONFIG.MAX_REPARAM; iter++) {
        for (let i = 0; i < u.length; i++) u[i] = newtonStep(best, pts[i], u[i]);
        const c = generate(pts, u, t0, t1);
        const e = maxFitError(pts, c, u);
        if (e < bestErr) { best = c; bestErr = e; } else break;
    }
    return { bez: best, err: bestErr };
}

// Golden-section search for the x in [a, b] minimizing f(x).err.
function goldenMin(f, a, b) {
    const R = 0.6180339887498949;
    let x1 = b - R * (b - a), x2 = a + R * (b - a);
    let f1 = f(x1), f2 = f(x2);
    for (let i = 0; i < CONFIG.GOLDEN_ITERS; i++) {
        if (f1.err < f2.err || isNaN(f2.err)) {
            b = x2; x2 = x1; f2 = f1;
            x1 = b - R * (b - a);
            f1 = f(x1);
        } else {
            a = x1; x1 = x2; f1 = f2;
            x2 = a + R * (b - a);
            f2 = f(x2);
        }
    }
    return f1.err <= f2.err ? f1 : f2;
}

function sampleBez(c, n, out, includeStart) {
    const start = includeStart ? 0 : 1;
    for (let i = start; i <= n; i++) out.push(c.evaluate(i / n));
}

// The single segment that takes the place of `left` (ending at the anchor being removed) and
// `right` (leaving it): a least-squares cubic fit to points sampled along both, with the end
// tangents of the untouched anchors held fixed. A golden-section search finds where the removed
// anchor's old position falls along the new combined parameterization, so the fit isn't biased
// toward either original segment.
function mergedSegment(left, right) {
    const N = CONFIG.FIT_SAMPLES;
    const pts = [];
    sampleBez(left, N, pts, true);
    sampleBez(right, N, pts, false);
    const t0 = startTangent(left), t1 = endTangent(right);
    const fitAtK = (k) => {
        const u = [];
        for (let i = 0; i <= N; i++) u.push(k * i / N);
        for (let i = 1; i <= N; i++) u.push(k + (1 - k) * i / N);
        return fitSingleFrom(pts, u, t0, t1);
    };
    return goldenMin(fitAtK, 0, 1).bez;
}

// How far `fitted` strays from the original outline segments it would replace, measured both
// ways (the farthest a sampled point of either lies from the other).
function deviation(originalSegs, fitted) {
    const SAMPLES = CONFIG.DEVIATION_SAMPLES;
    let worst = 0;
    for (const c of originalSegs) {
        for (let k = 0; k <= SAMPLES; k++) {
            const p = c.evaluate(k / SAMPLES);
            const d = dist(p, fitted.getClosestPoint(p));
            if (d > worst) worst = d;
        }
    }
    for (let k = 1; k < SAMPLES; k++) {
        const p = fitted.evaluate(k / SAMPLES);
        let best = Infinity;
        for (const c of originalSegs) {
            const d = dist(p, c.getClosestPoint(p));
            if (d < best) best = d;
        }
        if (best > worst) worst = best;
    }
    return worst;
}

function turnDeg(inDir, outDir) {
    const d = Math.max(-1, Math.min(1, dot(inDir, outDir)));
    return Math.acos(d) * 180 / Math.PI;
}

// ============================================================
// ANCHOR EXTRACTION / REBUILD
// ============================================================

// Walk a Curve's on-curve points into {p, hIn, hOut} anchors, in order. Works for both open and
// closed curves without special-case wraparound: a closed curve's lastOnCurvePointIndex is
// already the "back to start" sentinel, so the segments collected equal the anchor count; an
// open curve collects one fewer segment than anchors.
function extractAnchors(cv) {
    const closed = cv.isClosed;
    const first = cv.firstOnCurvePointIndex, last = cv.lastOnCurvePointIndex;
    const segs = [];
    let i = first;
    while (i < last) {
        segs.push(cv.getCubicBezier(i));
        i = cv.getNextOnCurvePointIndex(i, false);
    }
    const n = closed ? segs.length : segs.length + 1;
    const anchors = [];
    for (let k = 0; k < n; k++) {
        const p = k < segs.length ? segs[k].start : segs[segs.length - 1].end;
        const hOut = k < segs.length ? segs[k].c1 : p;
        const hIn = (k > 0 || closed) ? segs[(k - 1 + segs.length) % segs.length].c2 : p;
        anchors.push({ p, hOut, hIn });
    }
    return { anchors, closed };
}

function buildCurveFromAnchors(anchors, closed) {
    const cb = CurveBuilder.create();
    const n = anchors.length;
    cb.beginXY(anchors[0].p.x, anchors[0].p.y);
    const segCount = closed ? n : n - 1;
    for (let k = 1; k <= segCount; k++) {
        const from = anchors[(k - 1) % n], to = anchors[k % n];
        cb.addBezier(from.hOut, to.hIn, to.p);
    }
    if (closed) cb.close();
    return cb.createCurve();
}

function isSharpCorner(anchors, closed, i) {
    const n = anchors.length;
    if (!closed && (i === 0 || i === n - 1)) return false;
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    const segPrev = makeCubic(anchors[prev].p, anchors[prev].hOut, anchors[i].hIn, anchors[i].p);
    const segNext = makeCubic(anchors[i].p, anchors[i].hOut, anchors[next].hIn, anchors[next].p);
    return turnDeg(endTangent(segPrev), startTangent(segNext)) > CONFIG.SHARP_CORNER_DEG;
}

// Remove as many anchors of `cv` as can go while every new segment stays within `tolerance`
// points of the original outline it replaces, refitting the handles beside each. Every
// candidate's error is measured against the TRUE original segments it would cumulatively
// replace (not the previous pass's already-simplified curve), so removals never add up past the
// tolerance even after many passes. With protectCorners, anchors turning more than
// CONFIG.SHARP_CORNER_DEG stay. Open ends always stay; a closed path keeps at least three
// anchors, an open one at least two.
function simplifySubpath(cv, tolerance, protectCorners) {
    const { anchors, closed } = extractAnchors(cv);
    const n0 = anchors.length;
    const minAnchors = closed ? 3 : 2;
    if (n0 <= minAnchors) return { curve: cv, before: n0, after: n0 };

    const origSegCount = closed ? n0 : n0 - 1;
    const origSegs = [];
    for (let i = 0; i < origSegCount; i++) {
        const a = anchors[i], b = anchors[(i + 1) % n0];
        origSegs.push(makeCubic(a.p, a.hOut, b.hIn, b.p));
    }
    const kept = anchors.map((_, i) => protectCorners && isSharpCorner(anchors, closed, i));
    let cur = anchors.map(a => ({ p: a.p, hIn: a.hIn, hOut: a.hOut }));
    // origin[k] is cur[k]'s index among the ORIGINAL anchors, so a later candidate's error can
    // still be measured against the true original segments it spans, however many passes ago
    // its neighbours were themselves merged.
    let origin = anchors.map((_, i) => i);

    function neighbours(n, i) {
        if (closed) return n === 0 ? null : [(i + n - 1) % n, (i + 1) % n];
        return (i > 0 && i + 1 < n) ? [i - 1, i + 1] : null;
    }
    function originalSpan(from, to) {
        return from < to ? origSegs.slice(from, to) : origSegs.slice(from).concat(origSegs.slice(0, to));
    }
    function candidate(i, tolerance) {
        if (kept[origin[i]]) return null;
        const nb = neighbours(cur.length, i);
        if (!nb) return null;
        const [prevI, nextI] = nb;
        const left = makeCubic(cur[prevI].p, cur[prevI].hOut, cur[i].hIn, cur[i].p);
        const right = makeCubic(cur[i].p, cur[i].hOut, cur[nextI].hIn, cur[nextI].p);
        const bez = mergedSegment(left, right);
        const err = deviation(originalSpan(origin[prevI], origin[nextI]), bez);
        return (err <= tolerance) ? { err, i, bez } : null;
    }
    // Each pass removes the anchors whose removal strays least, no two side by side (so the
    // segment measured for each is the one that actually results), until none can go.
    function pass() {
        const m = cur.length;
        if (m <= minAnchors) return false;
        const found = [];
        for (let i = 0; i < m; i++) {
            const c = candidate(i, tolerance);
            if (c) found.push(c);
        }
        found.sort((a, b) => a.err - b.err);
        const gone = new Array(m).fill(false);
        let left = m - minAnchors;
        for (const { i, bez } of found) {
            const nb = neighbours(m, i);
            if (!nb) continue;
            const [prevI, nextI] = nb;
            if (left === 0 || gone[prevI] || gone[nextI]) continue;
            cur[prevI] = { ...cur[prevI], hOut: bez.c1 };
            cur[nextI] = { ...cur[nextI], hIn: bez.c2 };
            gone[i] = true;
            left--;
        }
        const anyGone = gone.some(g => g);
        if (anyGone) {
            cur = cur.filter((_, idx) => !gone[idx]);
            origin = origin.filter((_, idx) => !gone[idx]);
        }
        return anyGone;
    }
    while (pass()) { /* keep going until a pass removes nothing */ }

    if (cur.length === n0) return { curve: cv, before: n0, after: n0 };
    return { curve: buildCurveFromAnchors(cur, closed), before: n0, after: cur.length };
}

// ============================================================
// SELECTION / NODE GATHERING
// ============================================================

// Every selected PolyCurveNode, plus every PolyCurveNode nested inside a selected group,
// excluding locked and hidden ones (isEditable/isVisibleInDomain already account for locked or
// hidden ancestors). Parametric ShapeNodes are left out, matching VectorCraft's own exclusion of
// anything that isn't already anchor-based curve data.
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

function totalAnchors(nodes) {
    let total = 0;
    for (const node of nodes) {
        const poly = node.curvesInterface.polyCurve;
        for (let i = 0; i < poly.curveCount; i++) total += extractAnchors(poly.at(i)).anchors.length;
    }
    return total;
}

// ============================================================
// COMMAND / DIALOG
// ============================================================

function buildCommand(nodes, opts) {
    const tolerance = opts.tolerance * CONFIG.PT_PER_TOLERANCE;
    let before = 0, after = 0;
    const commands = [];
    for (const node of nodes) {
        const poly = node.curvesInterface.polyCurve;
        const count = poly.curveCount;
        let changed = false;
        const newPoly = PolyCurve.create();
        for (let i = 0; i < count; i++) {
            const result = simplifySubpath(poly.at(i), tolerance, opts.protectCorners);
            before += result.before;
            after += result.after;
            if (result.after !== result.before) changed = true;
            newPoly.addCurve(result.curve);
        }
        if (changed) commands.push(DocumentCommand.createSetCurves(node.curvesInterface, newPoly));
    }
    if (commands.length === 0) return { cmd: null, before, after };
    if (commands.length === 1) return { cmd: commands[0], before, after };
    const builder = CompoundCommandBuilder.create();
    for (const cmd of commands) builder.addCommand(cmd);
    return { cmd: builder.createCommand(), before, after };
}

function buildDialog(Dialog, UnitType) {
    const dlg = Dialog.create("Simplify Anchors (Keep Shape)");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.tolerance = grp.addUnitValueEditor(
        "Tolerance:", UnitType.Number, UnitType.Number,
        CONFIG.TOLERANCE_DEFAULT, CONFIG.TOLERANCE_MIN, CONFIG.TOLERANCE_MAX
    ).setPrecision(0).setShowPopupSlider(true);
    dlg.protectCorners = grp.addCheckBox("Protect Corners", false).setIsFullWidth(true);
    // Live anchor-count readout, updated from onControlValueChangedHandler in main().
    dlg.status = grp.addStaticText(" ", " ").setIsFullWidth(true);
    return dlg;
}

function readOptions(dlg) {
    return { tolerance: Math.round(dlg.tolerance.value), protectCorners: dlg.protectCorners.value };
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
        alert("Please select one or more objects");
        return;
    }
    const nodes = collectPathNodes(roots);
    if (nodes.length === 0) {
        alert("No editable curve paths were found in the selection");
        return;
    }
    const anchorCount = totalAnchors(nodes);
    if (anchorCount > CONFIG.MAX_ANCHORS) {
        alert("The selected paths have too many anchors (" + anchorCount + ") to simplify at once");
        return;
    }

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const dlg = buildDialog(Dialog, UnitType);

    // Avoids rebuilding the (potentially expensive) command when the dialog's own change
    // notifications fire without the options actually changing.
    let lastKey = null;
    let lastResult = null;
    const compute = (opts) => {
        const key = opts.tolerance + ':' + opts.protectCorners;
        if (key !== lastKey) {
            lastResult = buildCommand(nodes, opts);
            lastKey = key;
        }
        return lastResult;
    };

    const statusText = (result) => {
        if (!result) {
            return "Preview is skipped above " + CONFIG.LIVE_PREVIEW_MAX_ANCHORS + " anchors (" +
                anchorCount + " in selection); OK still applies it.";
        }
        const removed = result.before - result.after;
        const plural = result.before === 1 ? "" : "s";
        return removed > 0
            ? "Would remove " + removed + " of " + result.before + " anchor" + plural + "."
            : "No anchors removable at this Tolerance (" + result.before + " anchor" + plural + ").";
    };

    const update = (preview) => {
        if (preview && anchorCount > CONFIG.LIVE_PREVIEW_MAX_ANCHORS) {
            doc.clearPreviews();
            dlg.status.text = statusText(null);
            return null;
        }
        const result = compute(readOptions(dlg));
        if (result.cmd) doc.executeCommand(result.cmd, preview);
        else doc.clearPreviews();
        if (preview) dlg.status.text = statusText(result);
        return result;
    };

    dlg.onControlValueChangedHandler = () => update(true);
    update(true);

    if (dlg.runModal() == DialogResult.Ok) {
        const result = update(false);
        const removed = result.before - result.after;
        if (removed > 0) {
            alert("Removed " + removed + " of " + result.before + " anchor" + (result.before === 1 ? "" : "s") + ".");
        } else {
            alert("No anchors could be removed within this tolerance (" + result.before + " anchor" + (result.before === 1 ? "" : "s") + "). Try raising Tolerance, or unchecking Protect Corners.");
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
