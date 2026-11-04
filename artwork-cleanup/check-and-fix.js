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
Script Name:    check-and-fix.js
Description:    Ported from VectorCraft's Artwork Cleanup > Document Health Check ("Fix All
                 Issues"). Scans the selection (or the whole document if nothing is selected) for
                 13 kinds of everyday mess - empty text, stray single-anchor paths, unpainted or
                 invisible objects, duplicated objects, art stranded off every artboard, empty
                 artboards, redundant anchors, tiny handles, nearly-closed paths and needless
                 wrapper groups - and fixes every one it finds, as one undo step. Two of
                 VectorCraft's 16 kinds have no Affinity equivalent and are left out: see
                 check-and-fix.md.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        04/11/2026
Last updated:   04/11/2026
Compatibility:  Affinity by Canva 3.3

See check-and-fix.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // Distance (pt) within which anchors coincide, handles are tiny and path/clip-group ends
    // meet - matches VectorCraft's own NEAR constant.
    NEAR: 0.01,
    // Sine of the turn below which an anchor on an otherwise-straight run is collinear.
    COLLINEAR_SINE: 0.005,
    // Below this, a handle or a gap counts as zero - float noise, not a real distance.
    EPS: 1e-9,
    // A group/opacity counts as fully opaque at or above this.
    OPAQUE: 0.999,
    // Refuse rather than let a pathologically large selection hang the dialog.
    MAX_OBJECTS: 20000,
};

const { CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { CurveBuilder, PolyCurve } = require('/geometry.js');
const { Selection } = require('/selections.js');
const { BlendMode } = require('/blendmodeinterface.js');
const { FillType } = require('/fills.js');

// ============================================================
// VECTOR / ANCHOR HELPERS (duplicated from simplify-anchors.js / rejoin-path-pieces.js)
// ============================================================

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function cross2(a, b) { return a.x * b.y - a.y * b.x; }
function hyp(a) { return Math.hypot(a.x, a.y); }
// `h` (a handle attached to the anchor that used to sit at `fromP`) re-based onto the anchor's
// new position `p`, keeping the same offset.
function moved(p, fromP, h) { return { x: p.x + (h.x - fromP.x), y: p.y + (h.y - fromP.y) }; }
function hasHandle(p, h) { return dist(p, h) > CONFIG.EPS; }

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

// ============================================================
// NODE CLASSIFICATION
// ============================================================

function isArtboard(node) {
    return !!(node.artboardInterface && node.artboardInterface.isArtboardEnabled);
}

// A group with nothing of its own to show - full opacity, normal blending, no layer effects -
// matching VectorCraft's is_plain(); safe to dissolve without changing how anything looks.
function isPlainGroup(node) {
    if (node.globalOpacity < CONFIG.OPAQUE) return false;
    if (node.blendMode !== BlendMode.Normal) return false;
    const fx = node.layerEffectsInterface;
    if (fx && fx.hasAnyVisibleEffects) return false;
    return true;
}

function strokeWidth(node) {
    try { return node.lineStyle.weight; } catch (e) { return 0; }
}

function isStroked(node) {
    return !!node.hasPenFill && strokeWidth(node) > 0;
}

function isFilled(node) {
    return !!node.hasBrushFill;
}

function isPainted(node) {
    return isFilled(node) || isStroked(node);
}

// A plain-colour key for a fill or stroke paint, or null if it's something more complex
// (gradient, bitmap, hatch, mesh, diffusion) that isn't safely comparable here - callers must
// then treat the two objects as not provably identical, never as a false match.
function soldKey(descriptor) {
    if (!descriptor) return 'none';
    const fill = descriptor.fill;
    if (!fill || fill.fillType === FillType.None) return 'none';
    if (fill.fillType !== FillType.Solid) return null;
    const c = fill.colour.rgba8;
    return 'solid:' + c.r + ',' + c.g + ',' + c.b + ',' + c.alpha;
}

// `node`'s paint, as a plain comparable string, or null if any part of it isn't safely
// comparable (see soldKey).
function paintKey(node) {
    const fillKey = node.hasBrushFill ? soldKey(node.brushFillDescriptor) : 'none';
    if (fillKey === null) return null;
    const strokeKey = isStroked(node) ? soldKey(node.penFillDescriptor) : 'none';
    if (strokeKey === null) return null;
    return fillKey + '|' + strokeKey + '|' + strokeWidth(node).toFixed(6);
}

function transformKey(node) {
    return Array.from(node.transform.data).map(n => n.toFixed(6)).join(',');
}

// `node`'s local geometry (every subpath's closed flag and anchors), as a plain comparable
// string - exact matches only, which is what "it's a stacked duplicate" calls for.
function geometryKey(node) {
    const poly = node.curvesInterface.polyCurve;
    const parts = [];
    for (let i = 0; i < poly.curveCount; i++) {
        const { anchors, closed } = extractAnchors(poly.at(i));
        parts.push(closed ? 'C' : 'O');
        for (const a of anchors) {
            parts.push(a.p.x.toFixed(6), a.p.y.toFixed(6), a.hIn.x.toFixed(6), a.hIn.y.toFixed(6), a.hOut.x.toFixed(6), a.hOut.y.toFixed(6));
        }
    }
    return parts.join(',');
}

// ============================================================
// SCOPE WALKING
// ============================================================

// How many editable, visible objects are in scope (own flags only - matches every other check
// here), up to CONFIG.MAX_OBJECTS + 1 (no need to count further once over the cap).
function countScope(roots) {
    let count = 0;
    function visit(node) {
        if (count > CONFIG.MAX_OBJECTS) return;
        if (!node.isLocalEditable || !node.isVisible) return;
        count++;
        if (node.isGroupNode || isArtboard(node)) {
            for (const child of node.children.toArray()) visit(child);
        }
    }
    for (const root of roots) visit(root);
    return count;
}

// ============================================================
// PHASE 1: STRUCTURAL FIXES (delete, or unwrap a needless group)
// ============================================================

// Siblings (direct children of one parent, or the scope's own roots), in order, each marked
// whether a rule below removed it - lets Duplicate Objects compare against the nearest
// surviving sibling above, not a sibling that's itself on its way out.
function markDuplicates(siblings, stats) {
    let lastSurvivor = null;
    for (const s of siblings) {
        if (s.removed) continue;
        if (!s.node.isPolyCurveNode) { lastSurvivor = s; continue; }
        if (lastSurvivor && lastSurvivor.node.isPolyCurveNode &&
            s.node.globalOpacity >= CONFIG.OPAQUE && lastSurvivor.node.globalOpacity >= CONFIG.OPAQUE &&
            s.node.blendMode === BlendMode.Normal && lastSurvivor.node.blendMode === BlendMode.Normal) {
            const pk = paintKey(s.node), lpk = paintKey(lastSurvivor.node);
            if (pk !== null && pk === lpk && transformKey(s.node) === transformKey(lastSurvivor.node) &&
                geometryKey(s.node) === geometryKey(lastSurvivor.node)) {
                s.removed = true;
                stats.duplicateObjects++;
                continue;
            }
        }
        lastSurvivor = s;
    }
}

function isOffArtboard(node, artboards) {
    if (artboards.length === 0) return false;
    const box = node.spreadVisibleBox;
    if (!box) return false;
    return !artboards.some(a => rectsMeet(a, box));
}

function rectsMeet(a, b) {
    return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

// Deletes EmptyText, StrayPoints, Unpainted, ZeroOpacity, DuplicateObjects and (top-level only)
// OffArtboard objects from `siblings` (one parent's children, or the scope's own roots),
// in place, setting `.removed` on each one the rules take.
function markStructuralDeletes(siblings, artboards, stats) {
    for (const s of siblings) {
        const n = s.node;
        // Artboards are the page/canvas structure, never a candidate for any of these rules -
        // Empty Artboards (further down in main()) is the only check that ever removes one.
        if (isArtboard(n)) continue;
        if (n.isTextNode && n.text.trim() === '') { s.removed = true; stats.emptyText++; continue; }
        if (n.isPolyCurveNode) {
            const poly = n.curvesInterface.polyCurve;
            let anchorCount = 0;
            for (let i = 0; i < poly.curveCount; i++) anchorCount += extractAnchors(poly.at(i)).anchors.length;
            if (anchorCount <= 1) { s.removed = true; stats.strayPoints++; continue; }
            if (!isPainted(n)) { s.removed = true; stats.unpainted++; continue; }
        }
        if (n.globalOpacity <= 0) { s.removed = true; stats.zeroOpacity++; continue; }
        if (s.top && isOffArtboard(n, artboards)) { s.removed = true; stats.offArtboard++; continue; }
    }
    markDuplicates(siblings, stats);
}

// Resolves `node` into what survives it after every structural fix: `{ items, changed }`, where
// `items` are the nodes that end up where `node` was (its own siblings' problem to place) and
// `changed` says whether anything here or below was altered. A needless group (at most one
// surviving member, otherwise plain) unwraps into its members; everything else survives as
// itself, with its own children's fixes realized first.
function resolve(node, artboards, stats, groupRebuilds) {
    const artboard = isArtboard(node);
    if (!node.isGroupNode && !artboard) {
        return { items: [node], changed: false };
    }
    const kids = node.children.toArray().map(k => ({ node: k, removed: false }));
    markStructuralDeletes(kids, artboards, stats);
    let items = [], anyChildChanged = false;
    for (const kid of kids) {
        if (kid.removed) { anyChildChanged = true; continue; }
        const r = resolve(kid.node, artboards, stats, groupRebuilds);
        items = items.concat(r.items);
        if (r.changed) anyChildChanged = true;
    }
    // An artboard is never a needless-group candidate - it's the page/canvas, not loose art.
    if (!artboard && items.length <= 1 && isPlainGroup(node)) {
        stats.needlessGroups++;
        return { items, changed: true };
    }
    if (anyChildChanged) groupRebuilds.push({ node, items });
    return { items: [node], changed: anyChildChanged };
}

// Places `items` as consecutive children/siblings right after `after` (NodeMoveType.After), or
// as `inside`'s first children if given instead (NodeMoveType.Inside for the first one).
function placeItems(builder, doc, items, after, inside) {
    let anchor = after;
    let first = true;
    for (const item of items) {
        const moveType = (first && inside != null) ? NodeMoveType.Inside : NodeMoveType.After;
        const target = (first && inside != null) ? inside : anchor;
        builder.addCommand(DocumentCommand.createMoveNodes(Selection.create(doc, item), target, moveType, NodeChildType.Main));
        anchor = item;
        first = false;
    }
}

// Structural fixes across every root, as commands - plus the final top-level survivors (for the
// selection afterward) and how many of each kind were fixed.
function buildStructuralCommands(doc, roots, artboards) {
    const stats = { emptyText: 0, strayPoints: 0, unpainted: 0, zeroOpacity: 0, duplicateObjects: 0, offArtboard: 0, needlessGroups: 0 };
    const groupRebuilds = [];
    const topSiblings = roots.map(n => ({ node: n, removed: false, top: true }));
    markStructuralDeletes(topSiblings, artboards, stats);
    const topRebuild = [];
    let anyTopChanged = false;
    for (const s of topSiblings) {
        if (s.removed) { anyTopChanged = true; continue; }
        const r = resolve(s.node, artboards, stats, groupRebuilds);
        topRebuild.push({ root: s.node, items: r.items });
        if (r.changed) anyTopChanged = true;
    }

    const builder = CompoundCommandBuilder.create();
    let anyCommand = false;
    const finalSelection = [];
    if (anyTopChanged) {
        for (const { root, items } of topRebuild) {
            if (items.length === 1 && items[0] === root) { finalSelection.push(root); continue; }
            placeItems(builder, doc, items, root, null);
            builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, root)));
            anyCommand = true;
            finalSelection.push(...items);
        }
    } else {
        finalSelection.push(...roots);
    }
    for (const { node, items } of groupRebuilds) {
        placeItems(builder, doc, items, null, node);
        anyCommand = true;
    }
    return { builder, anyCommand, stats, finalSelection };
}

// ============================================================
// PHASE 2: PER-PATH ANCHOR REPAIRS (duplicate/tiny/collinear anchors, nearly-closed, filled-open)
// ============================================================

function removeCollinearAnchors(anchors, closed, stats) {
    const minAnchors = closed ? 3 : 2;
    let i = 0;
    while (i < anchors.length && anchors.length > minAnchors) {
        const n = anchors.length;
        const inner = closed || (i > 0 && i + 1 < n);
        const prev = anchors[(i - 1 + n) % n], cur = anchors[i], next = anchors[(i + 1) % n];
        const straight = !hasHandle(prev.p, prev.hOut) && !hasHandle(cur.p, cur.hIn) && !hasHandle(cur.p, cur.hOut) && !hasHandle(next.p, next.hIn);
        const a = sub(cur.p, prev.p), b = sub(next.p, cur.p);
        const len = hyp(a) * hyp(b);
        if (inner && straight && len > CONFIG.EPS && dot(a, b) > 0 && Math.abs(cross2(a, b)) / len <= CONFIG.COLLINEAR_SINE) {
            anchors.splice(i, 1);
            stats.collinearAnchors++;
        } else {
            i++;
        }
    }
}

function mergeDuplicateAnchors(anchors, closed, stats) {
    const out = [];
    for (const a of anchors) {
        const last = out[out.length - 1];
        if (last && dist(last.p, a.p) <= CONFIG.NEAR) {
            last.hOut = moved(last.p, a.p, a.hOut);
            stats.duplicateAnchors++;
        } else {
            out.push({ p: a.p, hIn: a.hIn, hOut: a.hOut });
        }
    }
    if (closed && out.length > 1 && dist(out[0].p, out[out.length - 1].p) <= CONFIG.NEAR) {
        const last = out.pop();
        out[0].hIn = moved(out[0].p, last.p, last.hIn);
        stats.duplicateAnchors++;
    }
    return out;
}

function retractTinyHandles(anchors, stats) {
    for (const a of anchors) {
        const lIn = dist(a.p, a.hIn);
        if (lIn > CONFIG.EPS && lIn < CONFIG.NEAR) { a.hIn = a.p; stats.tinyHandles++; }
        const lOut = dist(a.p, a.hOut);
        if (lOut > CONFIG.EPS && lOut < CONFIG.NEAR) { a.hOut = a.p; stats.tinyHandles++; }
    }
}

// Returns the new `closed` flag (closing merges the last anchor into the first).
function closeNearlyClosed(anchors, closed, stats) {
    if (closed || anchors.length < 3) return closed;
    const first = anchors[0], last = anchors[anchors.length - 1];
    if (dist(first.p, last.p) > CONFIG.NEAR) return closed;
    anchors.pop();
    first.hIn = moved(first.p, last.p, last.hIn);
    stats.nearlyClosed++;
    return true;
}

function reshapeSubpath(anchors, closed, node, stats) {
    anchors = mergeDuplicateAnchors(anchors, closed, stats);
    retractTinyHandles(anchors, stats);
    removeCollinearAnchors(anchors, closed, stats);
    return { anchors, closed };
}

// Nearly Coincident Anchors: groups of points (across every path's anchors) within NEAR of one
// another, skipping pairs that are already-adjacent anchors on the same subpath (Duplicate
// Anchors handles those) - a faithful port of VectorCraft's near_point_groups, a grid + union-find
// over `points`.
function nearPointGroups(points, isLinked) {
    const distance = CONFIG.NEAR;
    const cell = p => [Math.floor(p.x / distance), Math.floor(p.y / distance)];
    const grid = new Map();
    points.forEach((p, i) => {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        const [cx, cy] = cell(p);
        const key = cx + ',' + cy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    });
    const parent = points.map((_, i) => i);
    function root(i) {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    }
    const offsets = [[0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    for (const [key, members] of grid) {
        const [cx, cy] = key.split(',').map(Number);
        for (const [dx, dy] of offsets) {
            const others = grid.get((cx + dx) + ',' + (cy + dy));
            if (!others) continue;
            for (const i of members) {
                for (const j of others) {
                    if (dx === 0 && dy === 0 && j <= i) continue;
                    const d = dist(points[i], points[j]);
                    if (d <= distance && d > 0 && !isLinked(Math.min(i, j), Math.max(i, j))) {
                        const ri = root(i), rj = root(j);
                        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
                    }
                }
            }
        }
    }
    const groups = new Map();
    points.forEach((_, i) => {
        const r = root(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(i);
    });
    return [...groups.values()].filter(g => g.length > 1);
}

// ============================================================
// FINAL ASSEMBLY
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const roots = doc.selection.nodes.toArray();
    const scopeIsDocument = roots.length === 0;
    const effectiveRoots = scopeIsDocument ? doc.currentSpread.children.toArray() : roots;
    if (effectiveRoots.length === 0) { alert('Nothing to check'); return; }
    if (countScope(effectiveRoots) > CONFIG.MAX_OBJECTS) {
        alert('This ' + (scopeIsDocument ? 'document' : 'selection') + ' has too many objects (over ' + CONFIG.MAX_OBJECTS + ') to check at once');
        return;
    }

    const artboardNodes = doc.currentSpread.children.toArray().filter(n => n.artboardInterface && n.artboardInterface.isArtboardEnabled);
    const artboards = artboardNodes.map(n => n.artboardInterface.spreadBaseBox);

    const structural = buildStructuralCommands(doc, effectiveRoots, artboards);

    // Phase 2: anchor repairs, on every surviving path (including ones Phase 1 moved).
    const pathItems = [];
    (function collectPaths(nodes) {
        for (const n of nodes) {
            if (n.isPolyCurveNode) pathItems.push(n);
            else if (n.isGroupNode || isArtboard(n)) collectPaths(n.children.toArray());
        }
    })(structural.finalSelection);

    const stats2 = { duplicateAnchors: 0, tinyHandles: 0, collinearAnchors: 0, nearPoints: 0, nearlyClosed: 0, filledOpenPaths: 0 };
    // Per path, per subpath: reshaped anchors + closed flag, ready for Nearly Coincident Anchors
    // to adjust further, then a final pass to re-close and force-close filled open paths. `touched`
    // tracks whether anything below changed this particular path, so only changed paths are
    // written back.
    const perPath = pathItems.map(node => {
        const poly = node.curvesInterface.polyCurve;
        const subs = [];
        const before = stats2.duplicateAnchors + stats2.tinyHandles + stats2.collinearAnchors;
        for (let i = 0; i < poly.curveCount; i++) {
            const { anchors, closed } = extractAnchors(poly.at(i));
            subs.push(reshapeSubpath(anchors, closed, node, stats2));
        }
        const after = stats2.duplicateAnchors + stats2.tinyHandles + stats2.collinearAnchors;
        return { node, subs, touched: after !== before };
    });

    // Nearly Coincident Anchors across every subpath of every path above.
    const refs = []; // {pi, si, ai} per point, in `points` order
    const points = [];
    perPath.forEach((pp, pi) => {
        pp.subs.forEach((sub, si) => {
            sub.anchors.forEach((a, ai) => {
                refs.push({ pi, si, ai, len: sub.anchors.length, closed: sub.closed });
                points.push(a.p);
            });
        });
    });
    const isLinked = (i, j) => {
        const a = refs[i], b = refs[j];
        if (a.pi !== b.pi || a.si !== b.si) return false;
        const gap = Math.abs(a.ai - b.ai);
        return gap === 1 || (a.closed && gap + 1 === a.len);
    };
    for (const group of nearPointGroups(points, isLinked)) {
        const to = points[group[0]];
        for (const idx of group) {
            const r = refs[idx];
            const a = perPath[r.pi].subs[r.si].anchors[r.ai];
            if (dist(a.p, to) > 0) {
                a.hIn = moved(to, a.p, a.hIn);
                a.hOut = moved(to, a.p, a.hOut);
                a.p = to;
                stats2.nearPoints++;
                perPath[r.pi].touched = true;
            }
        }
    }

    // Nearly Closed, then Filled Open Paths, and build each touched path's new curve.
    const builder = structural.builder;
    let anyCommand = structural.anyCommand;
    for (const pp of perPath) {
        const filled = isFilled(pp.node) && !isStroked(pp.node);
        const newPoly = PolyCurve.create();
        for (const sub of pp.subs) {
            let { anchors, closed } = sub;
            const wasClosed = closed;
            closed = closeNearlyClosed(anchors, closed, stats2);
            if (!closed && filled && anchors.length >= 2) { closed = true; stats2.filledOpenPaths++; }
            if (closed !== wasClosed) pp.touched = true;
            newPoly.addCurve(buildCurveFromAnchors(anchors, closed));
        }
        if (pp.touched) {
            builder.addCommand(DocumentCommand.createSetCurves(pp.node.curvesInterface, newPoly));
            anyCommand = true;
        }
    }

    // Empty Artboards: only for a whole-document check.
    let emptyArtboardCount = 0;
    if (scopeIsDocument && artboards.length > 0) {
        const survivingTop = structural.finalSelection;
        const used = artboards.map(() => false);
        function markUsed(node) {
            // The artboard itself doesn't count as "art" on it - only recurse into its actual
            // content, which may still spill over and count toward a neighbouring artboard too.
            if (!isArtboard(node)) {
                const box = node.spreadVisibleBox;
                if (box) artboards.forEach((a, i) => { if (rectsMeet(a, box)) used[i] = true; });
            }
            if (node.isGroupNode || isArtboard(node)) for (const c of node.children.toArray()) markUsed(c);
        }
        for (const n of survivingTop) markUsed(n);
        artboardNodes.forEach((abNode, i) => {
            if (!used[i]) {
                builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, abNode)));
                anyCommand = true;
                emptyArtboardCount++;
            }
        });
    }

    if (!anyCommand) {
        alert('No issues were found to fix.');
        return;
    }

    const finalSelNodes = structural.finalSelection.filter(n => n.isLocalEditable && n.isVisible);
    if (finalSelNodes.length > 0) builder.addCommand(DocumentCommand.createSetSelection(Selection.create(doc, finalSelNodes)));

    doc.executeCommand(builder.createCommand());

    const s = structural.stats;
    const lines = [
        ['Empty Text', s.emptyText], ['Stray Points', s.strayPoints], ['Unpainted Objects', s.unpainted],
        ['Zero-Opacity Objects', s.zeroOpacity], ['Duplicate Objects', s.duplicateObjects], ['Off-Artboard Art', s.offArtboard],
        ['Duplicate Anchors', stats2.duplicateAnchors], ['Tiny Handles', stats2.tinyHandles], ['Collinear Anchors', stats2.collinearAnchors],
        ['Nearly Coincident Anchors', stats2.nearPoints], ['Nearly Closed Paths', stats2.nearlyClosed], ['Filled Open Paths', stats2.filledOpenPaths],
        ['Needless Groups', s.needlessGroups], ['Empty Artboards', emptyArtboardCount],
    ].filter(([, n]) => n > 0);
    const total = lines.reduce((a, [, n]) => a + n, 0);
    const detail = lines.map(([label, n]) => label + ': ' + n).join('\n');
    alert('Fixed ' + total + ' issue' + (total === 1 ? '' : 's') + '.\n\n' + detail);
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
