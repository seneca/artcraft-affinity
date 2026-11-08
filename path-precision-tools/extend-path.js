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
Script Name:    extend-path.js
Description:    Approximate port of VectorCraft's Path Precision Tools > Extend Path (one of its
                 live Path Effects there; this applies the same idea destructively, once - not
                 VectorCraft's separate interactive Extend Path tool, which drags an extension by
                 hand and can stretch or curve it). Lengthens the open end(s) of every selected
                 open path (and every open subpath nested in a selected group) by Length, with a
                 new straight segment continuing along the end's own tangent direction, as one
                 undo step. Closed paths have no open end and are left alone. Only a straight
                 continuation is offered - see extend-path.md's Known limitations for why.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        08/11/2026
Last updated:   08/11/2026
Compatibility:  Affinity by Canva 3.3

See extend-path.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    LENGTH_MIN_PT: 0,
    LENGTH_MAX_PT: 10000,
    LENGTH_DEFAULT_PT: 36,
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
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function scale(a, s) { return { x: a.x * s, y: a.y * s }; }

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

function fullAnchorsOpen(segs) {
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
// EXTENSION
// ============================================================

// Extends the open ends of `segs` (already known to be an open subpath) by `length` points,
// straight along each extended end's own tangent direction. Returns null if nothing changed
// (both ends left alone, or length is effectively zero).
function extendSegs(segs, length, extendStart, extendEnd) {
    if (segs.length === 0 || length <= 1e-6 || (!extendStart && !extendEnd)) return null;
    let anchors = fullAnchorsOpen(segs);
    let changed = false;

    if (extendStart) {
        const dir = startTangent(segs[0]);
        const newPoint = add(anchors[0].p, scale(dir, -length));
        anchors = [{ p: newPoint, hIn: newPoint, hOut: newPoint }, ...anchors];
        changed = true;
    }
    if (extendEnd) {
        const dir = endTangent(segs[segs.length - 1]);
        const last = anchors[anchors.length - 1];
        const newPoint = add(last.p, scale(dir, length));
        anchors = [...anchors, { p: newPoint, hIn: newPoint, hOut: newPoint }];
        changed = true;
    }
    return changed ? anchors : null;
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

function buildCommand(nodes, opts) {
    let endsExtended = 0;
    const commands = [];
    for (const node of nodes) {
        const poly = node.curvesInterface.polyCurve;
        const total = poly.curveCount;
        let changed = false;
        const newPoly = PolyCurve.create();
        for (let i = 0; i < total; i++) {
            const cv = poly.at(i);
            const { segs, closed } = extractSegments(cv);
            if (closed || segs.length === 0) { newPoly.addCurve(cv); continue; }
            const anchors = extendSegs(segs, opts.length, opts.extendStart, opts.extendEnd);
            if (!anchors) { newPoly.addCurve(cv); continue; }
            changed = true;
            if (opts.extendStart) endsExtended++;
            if (opts.extendEnd) endsExtended++;
            newPoly.addCurve(buildCurveFromAnchorsOpen(anchors));
        }
        if (changed) commands.push(DocumentCommand.createSetCurves(node.curvesInterface, newPoly));
    }
    if (commands.length === 0) return { cmd: null, endsExtended };
    if (commands.length === 1) return { cmd: commands[0], endsExtended };
    const builder = CompoundCommandBuilder.create();
    for (const cmd of commands) builder.addCommand(cmd);
    return { cmd: builder.createCommand(), endsExtended };
}

function buildDialog(Dialog, UnitType, doc) {
    const dlg = Dialog.create("Extend Path");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.length = grp.addUnitValueEditor(
        "Length:", UnitType.Point, doc.units, CONFIG.LENGTH_DEFAULT_PT, CONFIG.LENGTH_MIN_PT, CONFIG.LENGTH_MAX_PT
    ).setShowPopupSlider(true);
    dlg.extendStart = grp.addCheckBox("Extend Start", true).setIsFullWidth(true);
    dlg.extendEnd = grp.addCheckBox("Extend End", true).setIsFullWidth(true);
    dlg.status = grp.addStaticText(" ", " ").setIsFullWidth(true);
    return dlg;
}

function readOptions(dlg) {
    return { length: dlg.length.value, extendStart: dlg.extendStart.value, extendEnd: dlg.extendEnd.value };
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
        alert("Please select one or more open paths");
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
    const compute = (opts) => {
        const key = opts.length + ':' + opts.extendStart + ':' + opts.extendEnd;
        if (key !== lastKey) {
            lastResult = buildCommand(nodes, opts);
            lastKey = key;
        }
        return lastResult;
    };

    const statusText = (result) =>
        "Would extend " + result.endsExtended + " end" + (result.endsExtended === 1 ? "" : "s") + ".";

    const update = (preview) => {
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
        if (result.endsExtended > 0) {
            alert("Extended " + result.endsExtended + " end" + (result.endsExtended === 1 ? "" : "s") + ".");
        } else {
            alert("No open path ends were extended - check Extend Start/End and Length, and that the selection has open paths.");
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
