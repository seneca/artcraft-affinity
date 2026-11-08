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
Script Name:    add-anchors.js
Description:    Approximate port of VectorCraft's Path Precision Tools > Add Anchors (one of its
                 live Path Effects there; this applies the same idea destructively, once). Adds
                 Count new anchors to every selected path (and every subpath of a compound path,
                 and every path nested in a selected group), spaced evenly by arc length along
                 each subpath independently, without moving any existing anchor or changing the
                 outline's shape, as one undo step. VectorCraft's own dialog for this effect
                 wasn't available to check against; the even-by-length spacing here matches how
                 this repo's own divide-into-dashes.js already measures paths.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        08/11/2026
Last updated:   08/11/2026
Compatibility:  Affinity by Canva 3.3

See add-anchors.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    COUNT_MIN: 1,
    COUNT_MAX: 1000,
    COUNT_DEFAULT: 1,
    // Points sampled per original Bezier segment when measuring its length and inverting length
    // back to a parameter - fine for even spacing, not sub-point precision.
    LENGTH_SAMPLES: 24,
    // Refuse rather than let a pathologically large selection combined with a high Count produce
    // an unmanageable number of anchors.
    MAX_NEW_ANCHORS: 50000,
    LIVE_PREVIEW_MAX_NEW_ANCHORS: 4000,
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
function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

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

// ============================================================
// EVEN-SPACING INSERTION
// ============================================================

// Inserts `count` new anchors into `segs` (closed or open), spaced evenly by arc length across
// the whole subpath, landing strictly between the existing anchors (never on top of one) and
// never moving the curve. Returns the new segment list.
function addEvenAnchors(segs, count) {
    const segCount = segs.length;
    const segLens = segs.map(s => cubicLength(s, CONFIG.LENGTH_SAMPLES));
    const cumBefore = [0];
    for (let i = 0; i < segCount; i++) cumBefore.push(cumBefore[i] + segLens[i]);
    const totalLen = cumBefore[segCount];
    if (totalLen < 1e-6) return segs;

    // cutsBySegment[i] is a sorted list of local t values (0, 1) to split segment i at.
    const cutsBySegment = segs.map(() => []);
    for (let k = 1; k <= count; k++) {
        const arc = (k / (count + 1)) * totalLen;
        let idx = segCount - 1;
        for (let i = 0; i < segCount; i++) {
            if (arc <= cumBefore[i + 1] + 1e-9) { idx = i; break; }
        }
        const localTarget = Math.max(0, Math.min(segLens[idx], arc - cumBefore[idx]));
        const t = paramAtLength(segs[idx], localTarget, segLens[idx], CONFIG.LENGTH_SAMPLES);
        if (t > 1e-6 && t < 1 - 1e-6) cutsBySegment[idx].push(t);
    }

    const newSegs = [];
    for (let i = 0; i < segCount; i++) {
        const ts = cutsBySegment[i].sort((a, b) => a - b);
        if (ts.length === 0) { newSegs.push(segs[i]); continue; }
        let remaining = segs[i], prevT = 0;
        for (const t of ts) {
            const localT = (t - prevT) / Math.max(1e-9, 1 - prevT);
            const { left, right } = splitCubic(remaining, Math.max(0, Math.min(1, localT)));
            newSegs.push(left);
            remaining = right;
            prevT = t;
        }
        newSegs.push(remaining);
    }
    return newSegs;
}

// ============================================================
// SELECTION / NODE GATHERING
// ============================================================

// Every selected PolyCurveNode, plus every PolyCurveNode nested inside a selected group,
// excluding locked and hidden ones (isEditable/isVisibleInDomain already account for locked or
// hidden ancestors) and parametric shapes (not yet converted to curves).
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

function buildCommand(nodes, count, maxNewAnchors) {
    let added = 0, tooMany = false;
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
            const newSegs = addEvenAnchors(segs, count);
            const gained = newSegs.length - segs.length;
            if (gained <= 0) { newPoly.addCurve(cv); continue; }
            added += gained;
            if (added > maxNewAnchors) { tooMany = true; break; }
            changed = true;
            newPoly.addCurve(buildCurveFromAnchors(fullAnchors(newSegs, closed), closed));
        }
        if (tooMany) break;
        if (changed) commands.push(DocumentCommand.createSetCurves(node.curvesInterface, newPoly));
    }
    if (tooMany) return { cmd: null, added, tooMany: true };
    if (commands.length === 0) return { cmd: null, added, tooMany: false };
    if (commands.length === 1) return { cmd: commands[0], added, tooMany: false };
    const builder = CompoundCommandBuilder.create();
    for (const cmd of commands) builder.addCommand(cmd);
    return { cmd: builder.createCommand(), added, tooMany: false };
}

function buildDialog(Dialog, UnitType) {
    const dlg = Dialog.create("Add Anchors");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.count = grp.addUnitValueEditor(
        "Anchors to Add:", UnitType.Number, UnitType.Number,
        CONFIG.COUNT_DEFAULT, CONFIG.COUNT_MIN, CONFIG.COUNT_MAX
    ).setPrecision(0).setShowPopupSlider(true);
    dlg.status = grp.addStaticText(" ", " ").setIsFullWidth(true);
    return dlg;
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
    const compute = (count, maxNewAnchors) => {
        const key = count + ':' + maxNewAnchors;
        if (key !== lastKey) {
            lastResult = buildCommand(nodes, count, maxNewAnchors);
            lastKey = key;
        }
        return lastResult;
    };

    const statusText = (result) => {
        if (result.tooMany) return "Too many anchors to add at this Count - lower it and try again.";
        return "Would add " + result.added + " anchor" + (result.added === 1 ? "" : "s") + ".";
    };

    const update = (preview) => {
        const count = Math.round(dlg.count.value);
        const maxNewAnchors = preview ? CONFIG.LIVE_PREVIEW_MAX_NEW_ANCHORS : CONFIG.MAX_NEW_ANCHORS;
        const result = compute(count, maxNewAnchors);
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
            alert("That Count would add too many anchors across this selection - lower it and try again.");
        } else if (result.added > 0) {
            alert("Added " + result.added + " anchor" + (result.added === 1 ? "" : "s") + ".");
        } else {
            alert("No anchors were added.");
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
