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
Script Name:    rejoin-path-pieces.js
Description:    Ported from VectorCraft's Artwork Cleanup > Rejoin Path Pieces. Welds open,
                 single-subpath paths in the selection (and nested inside selected groups) whose
                 ends lie within Gap of each other back into continuous paths, as one undo step.
                 Where an end could meet more than one other, it meets whichever keeps the path
                 straightest (least direction change), then whichever is nearest. A piece may run
                 either way; a chain whose ends meet closes. Each chain becomes its topmost piece
                 (by stacking order) with the others' anchors merged in; the other pieces are
                 deleted. Locked, hidden, closed and compound-subpath paths are left out.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        04/11/2026
Last updated:   04/11/2026
Compatibility:  Affinity by Canva 3.3

See rejoin-path-pieces.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    GAP_MIN_PT: 0,
    GAP_MAX_PT: 6,
    GAP_DEFAULT_PT: 0.1,
    // Refuse rather than let a pathologically large selection (e.g. thousands of trace fragments)
    // hang the dialog for minutes.
    MAX_PIECES: 5000,
};

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { CurveBuilder, CubicBezier, PolyCurve } = require('/geometry.js');
const { Selection } = require('/selections.js');

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

// `h`, moved the same way `fromP` would have to move to land on `p`: used when merging two
// near-coincident (but not exactly matching, within Gap) anchors into one.
function moved(p, fromP, h) {
    return add(p, sub(h, fromP));
}

// ============================================================
// ANCHOR EXTRACTION / REBUILD
// (same approach as simplify-anchors.js - each script here is self-contained, no shared modules)
// ============================================================

// Walk a Curve's on-curve points into {p, hIn, hOut} anchors, in order.
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

// Reverses an anchor list end for end: order flips, and each anchor's in/out handles swap (what
// was arriving at a point now leaves it, and vice versa).
function reverseAnchors(anchors) {
    const out = anchors.slice().reverse().map(a => ({ p: a.p, hIn: a.hOut, hOut: a.hIn }));
    return out;
}

// `anchors` (a Curve's own local coordinates) through Transform `xf`. Each piece has its own
// position/rotation/scale, so endpoints that visually touch can have very different raw local
// coordinates - every cross-piece distance and angle check below needs them in one shared space
// (the spread) first, matching how the canvas itself compares them.
function transformAnchors(anchors, xf) {
    return anchors.map(a => ({ p: xf.applyToPoint(a.p), hIn: xf.applyToPoint(a.hIn), hOut: xf.applyToPoint(a.hOut) }));
}

// ============================================================
// STACKING ORDER
// (same approach as replace-with-top-object.js / sort-objects.js)
// ============================================================

// The node's position among its siblings at every level up to the root, back (0) to front; used
// to find each chain's topmost piece.
function indexPath(node) {
    const path = [];
    let n = node;
    while (n) {
        let index = 0;
        let sib = n.previousSibling;
        while (sib) {
            index++;
            sib = sib.previousSibling;
        }
        path.unshift(index);
        n = n.parent;
    }
    return path;
}

function comparePaths(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; ++i) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
}

// ============================================================
// SELECTION / PIECE GATHERING
// ============================================================

// Every open, single-subpath PolyCurveNode in the selection (and nested inside selected groups),
// excluding locked and hidden ones. Closed paths and compound paths (more than one subpath) are
// left out, matching VectorCraft's own exclusions - as are parametric shapes (not yet curves),
// the same as simplify-anchors.js. Affinity has no scripting-visible equivalent of VectorCraft's
// "clipping path" / "guide" flags, so those aren't filtered out here - see the .md's Known
// limitations.
//
// Each piece's `anchors` are in SPREAD space (via its own baseToSpreadTransform), not its own
// local curve space, so two pieces' endpoints can be compared directly; buildCommand() converts
// back through the surviving node's own transform once a chain's result is known.
function collectPieces(roots) {
    const out = [];
    const consider = (node) => {
        if (!node.isPolyCurveNode || !node.isEditable || !node.isVisibleInDomain) return;
        const poly = node.curvesInterface.polyCurve;
        if (poly.curveCount !== 1) return;
        const cv = poly.at(0);
        if (cv.isClosed) return;
        const { anchors } = extractAnchors(cv);
        if (anchors.length < 2) return;
        out.push({ node, anchors: transformAnchors(anchors, node.baseToSpreadTransform), path: indexPath(node) });
    };
    for (const root of roots) {
        consider(root);
        for (const child of root.children.all) consider(child);
    }
    return out;
}

// ============================================================
// END MATCHING
// ============================================================

// The point and outward-pointing direction of each piece's two ends: `last` false for its first
// anchor, true for its last. "Outward" means away from the piece, so two pieces whose ends face
// each other have outward directions pointing in roughly opposite ways.
function buildEnds(pieces) {
    const ends = [];
    pieces.forEach((piece, pieceIdx) => {
        const a = piece.anchors;
        const n = a.length;
        const firstSeg = makeCubic(a[0].p, a[0].hOut, a[1].hIn, a[1].p);
        const lastSeg = makeCubic(a[n - 2].p, a[n - 2].hOut, a[n - 1].hIn, a[n - 1].p);
        ends.push({ pieceIdx, last: false, point: a[0].p, outward: scale(startTangent(firstSeg), -1) });
        ends.push({ pieceIdx, last: true, point: a[n - 1].p, outward: endTangent(lastSeg) });
    });
    return ends;
}

function endKey(pieceIdx, last) { return pieceIdx + ':' + (last ? 1 : 0); }

// Pairs (i < j) of `points` that may lie within `gap`: those in neighbouring cells of a grid
// sized to `gap`, so this stays well short of checking every pair when pieces are scattered.
function candidatePairs(points, gap) {
    const cellOf = (p) => [Math.floor(p.x / gap), Math.floor(p.y / gap)];
    const grid = new Map();
    points.forEach((p, i) => {
        const [cx, cy] = cellOf(p);
        const key = cx + ',' + cy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    });
    const out = [];
    points.forEach((p, i) => {
        const [cx, cy] = cellOf(p);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const others = grid.get((cx + dx) + ',' + (cy + dy));
                if (!others) continue;
                for (const j of others) if (j > i) out.push([i, j]);
            }
        }
    });
    return out;
}

// Links each end to at most one other: among every pair within `gap`, the straightest-continuing
// pair goes first (then the nearest), and once an end is linked it's taken.
function buildLinks(pieces, ends, gap) {
    const points = ends.map(e => e.point);
    const pairs = [];
    for (const [a, b] of candidatePairs(points, Math.max(gap, 1e-9))) {
        const ea = ends[a], eb = ends[b];
        // A piece's own two ends meet only when closing it leaves a shape (three anchors).
        if (ea.pieceIdx === eb.pieceIdx && pieces[ea.pieceIdx].anchors.length < 3) continue;
        const d = dist(ea.point, eb.point);
        if (d > gap) continue;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(ea.outward, scale(eb.outward, -1)))));
        pairs.push({ angle, d, ea, eb });
    }
    pairs.sort((x, y) => (x.angle - y.angle) || (x.d - y.d));
    const link = new Map();
    for (const { ea, eb } of pairs) {
        const ka = endKey(ea.pieceIdx, ea.last), kb = endKey(eb.pieceIdx, eb.last);
        if (!link.has(ka) && !link.has(kb)) {
            link.set(ka, { pieceIdx: eb.pieceIdx, last: eb.last });
            link.set(kb, { pieceIdx: ea.pieceIdx, last: ea.last });
        }
    }
    return link;
}

// ============================================================
// CHAIN WALKING / ASSEMBLY
// ============================================================

// The pieces of the chain beginning at member `first`, in order, marking each as seen.
function walkChain(link, first, closed, seen) {
    const members = [];
    let cur = first;
    for (;;) {
        if (seen[cur.pieceIdx]) break;
        seen[cur.pieceIdx] = true;
        members.push(cur);
        // A piece run forwards (not reversed) leaves by its own last anchor; reversed, by its
        // own first.
        const leaving = link.get(endKey(cur.pieceIdx, !cur.reversed));
        if (!leaving) break;
        const next = { pieceIdx: leaving.pieceIdx, reversed: leaving.last };
        if (closed && next.pieceIdx === first.pieceIdx) break;
        cur = next;
    }
    return members;
}

// Every chain of two or more linked pieces, and every single piece whose own two ends link (a
// closed loop of one).
function buildChains(pieceCount, link) {
    const seen = new Array(pieceCount).fill(false);
    const chains = [];
    for (let start = 0; start < pieceCount; start++) {
        if (seen[start]) continue;
        if (!link.has(endKey(start, false)) && !link.has(endKey(start, true))) continue;
        // Back up to the chain's actual first piece (or detect it loops all the way to `start`).
        let first = { pieceIdx: start, reversed: false };
        let closed = false;
        for (let step = 0; step < pieceCount; step++) {
            const found = link.get(endKey(first.pieceIdx, first.reversed));
            if (!found) break;
            const prev = { pieceIdx: found.pieceIdx, reversed: !found.last };
            if (prev.pieceIdx === start) { closed = true; break; }
            first = prev;
        }
        const members = walkChain(link, first, closed, seen);
        chains.push({ members, closed });
    }
    return chains;
}

// The anchors of `pieces` along chain `members`, each piece's start merged into the end before
// it; the final point of a closed chain merges back into its first. `null` when there's nothing
// to actually join (a single piece that didn't close on itself).
function assembleChain(pieces, members, closed) {
    if (members.length < 2 && !closed) return null;
    let anchors = [];
    for (const { pieceIdx, reversed } of members) {
        const pa = reversed ? reverseAnchors(pieces[pieceIdx].anchors) : pieces[pieceIdx].anchors;
        if (anchors.length > 0) {
            const last = anchors[anchors.length - 1];
            const first = pa[0];
            anchors[anchors.length - 1] = { p: last.p, hIn: last.hIn, hOut: moved(last.p, first.p, first.hOut) };
            anchors.push(...pa.slice(1));
        } else {
            anchors.push(...pa);
        }
    }
    let closedFinal = false;
    if (closed) {
        if (anchors.length >= 3) {
            const last = anchors.pop();
            const first = anchors[0];
            anchors[0] = { p: first.p, hIn: moved(first.p, last.p, last.hIn), hOut: first.hOut };
            closedFinal = true;
        } else {
            closedFinal = anchors.length >= 2;
        }
    }
    return { anchors, closed: closedFinal };
}

// ============================================================
// COMMAND / DIALOG
// ============================================================

// Every chain Gap would weld, as {pieces, topIdx, assembled} - pieces are indexes into `pieces`,
// topIdx is the index (within that list) of the piece whose identity the result keeps.
function findRejoins(pieces, gapPt) {
    const ends = buildEnds(pieces);
    const link = buildLinks(pieces, ends, gapPt);
    const chains = buildChains(pieces.length, link);
    const rejoins = [];
    for (const { members, closed } of chains) {
        const assembled = assembleChain(pieces, members, closed);
        if (!assembled) continue;
        const memberIdxs = members.map(m => m.pieceIdx);
        let topIdx = memberIdxs[0];
        for (const idx of memberIdxs) {
            if (comparePaths(pieces[idx].path, pieces[topIdx].path) > 0) topIdx = idx;
        }
        rejoins.push({ memberIdxs, topIdx, assembled });
    }
    return rejoins;
}

function buildCommand(doc, pieces, gapPt) {
    const rejoins = findRejoins(pieces, gapPt);
    if (rejoins.length === 0) return { cmd: null, joined: 0, removed: 0 };
    const builder = CompoundCommandBuilder.create();
    let removed = 0;
    for (const { memberIdxs, topIdx, assembled } of rejoins) {
        const top = pieces[topIdx].node;
        // assembled.anchors is in spread space (see collectPieces); curvesInterface wants the
        // surviving node's own local space, so convert back through its own transform.
        const localAnchors = transformAnchors(assembled.anchors, top.baseToSpreadTransform.invert());
        const newCurve = buildCurveFromAnchors(localAnchors, assembled.closed);
        const newPoly = PolyCurve.create();
        newPoly.addCurve(newCurve);
        builder.addCommand(DocumentCommand.createSetCurves(top.curvesInterface, newPoly));
        for (const idx of memberIdxs) {
            if (idx === topIdx) continue;
            builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, pieces[idx].node)));
            removed++;
        }
    }
    return { cmd: builder.createCommand(), joined: rejoins.length, removed };
}

function buildDialog(Dialog, UnitType, doc) {
    const dlg = Dialog.create("Rejoin Path Pieces");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.gap = grp.addUnitValueEditor(
        "Gap:", UnitType.Point, doc.units,
        CONFIG.GAP_DEFAULT_PT, CONFIG.GAP_MIN_PT, CONFIG.GAP_MAX_PT
    ).setShowPopupSlider(true);
    // Live chain-count readout, updated from onControlValueChangedHandler in main() - cheap to
    // recompute (its cost is in the number of loose pieces, not their anchor counts), but this
    // script doesn't live-preview the actual geometry: see replace-with-top-object.js's note that
    // a compound command which deletes and replaces nodes doesn't revert cleanly from a preview.
    dlg.status = grp.addStaticText(" ", " ").setIsFullWidth(true);
    return dlg;
}

function readOptions(dlg) {
    return { gapPt: dlg.gap.value };
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
    const pieces = collectPieces(roots);
    if (pieces.length === 0) {
        alert("No open paths were found in the selection to rejoin");
        return;
    }
    if (pieces.length > CONFIG.MAX_PIECES) {
        alert("The selection has too many open paths (" + pieces.length + ") to rejoin at once");
        return;
    }

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const dlg = buildDialog(Dialog, UnitType, doc);

    const statusText = (gapPt) => {
        const rejoins = findRejoins(pieces, gapPt);
        if (rejoins.length === 0) return "No pieces are within this Gap of each other.";
        const removed = rejoins.reduce((n, r) => n + r.memberIdxs.length - 1, 0);
        return "Would join " + removed + " piece" + (removed === 1 ? "" : "s") +
            " into " + rejoins.length + " path" + (rejoins.length === 1 ? "" : "s") + ".";
    };
    const update = () => { dlg.status.text = statusText(readOptions(dlg).gapPt); };

    dlg.onControlValueChangedHandler = update;
    update();

    if (dlg.runModal() == DialogResult.Ok) {
        const opts = readOptions(dlg);
        const result = buildCommand(doc, pieces, opts.gapPt);
        if (result.cmd) {
            doc.executeCommand(result.cmd);
            alert("Joined " + result.removed + " piece" + (result.removed === 1 ? "" : "s") +
                " into " + result.joined + " path" + (result.joined === 1 ? "" : "s") + ".");
        } else {
            alert("No pieces were within Gap of each other; nothing was joined.");
        }
    }
}

// ============================================================
// RUN
// ============================================================

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
