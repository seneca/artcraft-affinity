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
Script Name:    sort-objects.js
Description:    Ported from VectorCraft's Arrange Tools > Sort Objects, plus one addition. Sorts
                 the selected objects (the top-level ones) by one attribute (Width, Height, Area,
                 X Position, Y Position, Opacity or Stacking Order) and gives them another in that
                 order, as one undo step. Applying to Stacking Order reorders each object only
                 among its own original slots within its own layer/group, leaving every other
                 object - selected or not - exactly where it is. Distribute Evenly steps the
                 applied attribute's own values evenly from smallest to largest (VectorCraft's own
                 option) rather than using each object's actual value.

                 Addition: Distribute Spacing Evenly (only with Apply To X/Y Position) instead
                 gives every object the same empty gap to its neighbour along that axis, regardless
                 of how large or small each one is - what Distribute Evenly cannot do, since it
                 only evens out positions, not the leftover space between differently-sized objects.

                 Scale Strokes & Effects (Width/Height/Area only) sets each object's own
                 "Scale with object" stroke/effects setting to match (a lasting change, since
                 Affinity has no per-operation equivalent); with it off and a stroke present, the
                 resulting size is only approximate, since this script scales the geometric box
                 directly rather than solving for the exact visual size as VectorCraft's own
                 algorithm does. The Order "Random" and VectorCraft's own hidden Seed are the same
                 idea here: freshly randomized each time the dialog opens, rather than tied to a
                 document revision counter this SDK doesn't expose.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        03/11/2026
Last updated:   03/11/2026
Compatibility:  Affinity by Canva 3.3

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    MAX_OBJECTS: 20000,     // VectorCraft's addon.arrange.sort spec
};

const SORT_KEYS = ['width', 'height', 'area', 'x', 'y', 'opacity', 'stacking'];

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Transform } = require('/geometry.js');
const { LineStyleDescriptor, LineStyleMask } = require('/linestyle.js');
const { Selection } = require('/selections.js');

// The node's position among its siblings at every level up to the root, back (0) to front; used
// to put the selected objects in stacking order (and, for "by": "stacking", as the attribute
// itself - each item's own index in that order).
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
        if (a[i] !== b[i])
            return a[i] - b[i];
    }
    return a.length - b.length;
}

function isIdentity(xf) {
    const d = xf.data;
    return Math.abs(d[0] - 1) < 1e-9 && Math.abs(d[1]) < 1e-9 && Math.abs(d[2]) < 1e-9 &&
        Math.abs(d[3]) < 1e-9 && Math.abs(d[4] - 1) < 1e-9 && Math.abs(d[5]) < 1e-9;
}

// A small, deterministic PRNG (mulberry32) for Order "Random" - doesn't need to match
// VectorCraft's own generator, only to be reproducible within one run of this script.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// `item`'s value of attribute `key`, one of SORT_KEYS. "stacking" falls through to the item's own
// index in the (already back-to-front) items array, i.e. its current stacking position.
function attribute(key, item) {
    switch (key) {
        case 'width': return item.box.width;
        case 'height': return item.box.height;
        case 'area': return item.box.width * item.box.height;
        case 'x': return item.box.x;
        case 'y': return item.box.y;
        case 'opacity': return item.opacity * 100;
        default: return item.stackIndex;
    }
}

// Affinity has no per-operation "scale strokes" transform option: a stroke's own "Scale with
// object" (LineStyleDescriptor.isScale) and each layer effect's own scaleWithObject govern it
// instead, read automatically by the renderer whenever a transform runs.
function applyScaleStrokes(doc, node, scaleOn, builder) {
    const lsd = node.lineStyleDescriptor;
    if (lsd.isScale !== scaleOn) {
        const newDesc = LineStyleDescriptor.create(lsd.lineStyle, { isScale: scaleOn });
        builder.addCommand(DocumentCommand.createSetLineStyleDescriptor(Selection.create(doc, node), newDesc, { lineStyleMask: LineStyleMask.Scale }));
    }
    builder.addCommand(DocumentCommand.createSetAllLayerEffectsScaleWithObject(Selection.create(doc, node), scaleOn));
}

// The transform that gives `box` attribute `apply`'s value `value`: a plain move for x/y (the
// left/top edge, reference point 0), else a scale about the box's own centre (reference point 4,
// object_bounds_transform's default when none is given) - width/height change one side only; area
// scales both sides by the same factor, in proportion.
function resizeOrMoveTransform(box, apply, value) {
    if (apply === 'x')
        return Transform.createTranslate(value - box.x, 0);
    if (apply === 'y')
        return Transform.createTranslate(0, value - box.y);
    const rp = box.centre;
    let sx = 1, sy = 1;
    if (apply === 'width')
        sx = box.width > 1e-9 ? value / box.width : 1;
    else if (apply === 'height')
        sy = box.height > 1e-9 ? value / box.height : 1;
    else if (apply === 'area') {
        const k = box.width * box.height > 1e-12 ? Math.sqrt(value / (box.width * box.height)) : 1;
        sx = sy = k;
    }
    return Transform.createTranslate(rp.x, rp.y)
        .multiply(Transform.createScale(sx, sy))
        .multiply(Transform.createTranslate(-rp.x, -rp.y));
}

// Applies `wanted`'s (item, value) pairs as Apply To "width"/"height"/"area"/"x"/"y" transforms.
function buildResizeOrMoveCommand(doc, wanted, opts) {
    const resizing = opts.apply === 'width' || opts.apply === 'height' || opts.apply === 'area';
    const builder = CompoundCommandBuilder.create();
    let any = false;
    for (const { item, value } of wanted) {
        const xf = resizeOrMoveTransform(item.box, opts.apply, value);
        if (isIdentity(xf))
            continue;
        if (resizing)
            applyScaleStrokes(doc, item.node, opts.scaleStrokes, builder);
        builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, item.node), xf));
        any = true;
    }
    return any ? builder.createCommand() : null;
}

function buildOpacityCommand(doc, wanted) {
    const builder = CompoundCommandBuilder.create();
    let any = false;
    for (const { item, value } of wanted) {
        const o = value / 100;
        if (Math.abs(o - item.opacity) < 1e-6)
            continue;
        builder.addCommand(DocumentCommand.createSetOpacity(Selection.create(doc, item.node), o));
        any = true;
    }
    return any ? builder.createCommand() : null;
}

// Distribute Spacing Evenly: in `rank` order, every object gets the same gap to the next one along
// `opts.apply` ("x"/"y"), using its own width/height - the leftmost edge and the rightmost edge of
// the whole selection stay where they are, same as VectorCraft's Distribute Evenly keeping its
// first/last values, but here the objects' own sizes are accounted for rather than ignored.
function buildSpacingCommand(doc, items, rank, opts) {
    const axis = opts.apply;
    const sizeKey = axis === 'x' ? 'width' : 'height';
    const rankedItems = rank.map(i => items[i]);
    const n = rankedItems.length;
    if (n === 0)
        return null;
    const lo = Math.min(...items.map(it => it.box[axis]));
    const hiEdge = Math.max(...items.map(it => it.box[axis] + it.box[sizeKey]));
    const totalSize = rankedItems.reduce((sum, it) => sum + it.box[sizeKey], 0);
    const gap = n > 1 ? (hiEdge - lo - totalSize) / (n - 1) : 0;
    const wanted = [];
    let at = lo;
    for (const it of rankedItems) {
        wanted.push({ item: it, value: at });
        at += it.box[sizeKey] + gap;
    }
    return buildResizeOrMoveCommand(doc, wanted, opts);
}

// The selected items sharing parent `p`, in whatever order `items` is already in - used for both
// the original (back-to-front) grouping and the ranked grouping. Node references from different
// fetches never === each other even for the same node, so group matching goes through
// isSameNode(), not object identity (see docs/sdk-issues.md's node-identity note).
function groupByParent(items) {
    const groups = [];
    for (const item of items) {
        let group = groups.find(g => g.parent.isSameNode(item.parent));
        if (!group) {
            group = { parent: item.parent, items: [] };
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
}

// Apply To "Stacking Order": within each layer/group that has selected members, those members
// trade places among their own original slots only - every other sibling, selected or not, stays
// exactly where it is. `finalChildren[j]`, once placed, never moves again, so placing it "After"
// finalChildren[j-1] (already correct, by induction) and working forwards reconstructs the whole
// arrangement correctly in one pass, including slots that happen to need no explicit move at all.
function buildStackingCommand(doc, items, rank) {
    const groups = groupByParent(items);
    for (const g of groups)
        g.rankedItems = [];
    for (const i of rank) {
        const item = items[i];
        groups.find(g => g.parent.isSameNode(item.parent)).rankedItems.push(item);
    }

    const builder = CompoundCommandBuilder.create();
    let any = false;
    for (const g of groups) {
        const originalNodes = g.items.map(it => it.node);
        const rankedNodes = g.rankedItems.map(it => it.node);
        if (rankedNodes.every((n, i) => n.isSameNode(originalNodes[i])))
            continue;

        const isSelected = node => originalNodes.some(n => n.isSameNode(node));
        const allChildren = g.parent.children.toArray();
        let k = 0;
        const finalChildren = allChildren.map(node => isSelected(node) ? rankedNodes[k++] : node);

        for (let j = 0; j < finalChildren.length; ++j) {
            const node = finalChildren[j];
            if (!isSelected(node))
                continue;
            if (j === 0) {
                if (!node.isSameNode(allChildren[0])) {
                    builder.addCommand(DocumentCommand.createMoveNodes(Selection.create(doc, node), allChildren[0], NodeMoveType.Before, NodeChildType.Main));
                    any = true;
                }
            } else {
                builder.addCommand(DocumentCommand.createMoveNodes(Selection.create(doc, node), finalChildren[j - 1], NodeMoveType.After, NodeChildType.Main));
                any = true;
            }
        }
    }
    return any ? builder.createCommand() : null;
}

function buildCommand(doc, items, opts) {
    const keys = items.map(it => attribute(opts.by, it));
    let rank = items.map((_, i) => i);
    if (opts.order === 'random') {
        const rand = mulberry32(opts.seed);
        for (let i = rank.length - 1; i > 0; --i) {
            const j = Math.floor(rand() * (i + 1));
            [rank[i], rank[j]] = [rank[j], rank[i]];
        }
    } else if (opts.order === 'descending') {
        rank.sort((a, b) => keys[b] - keys[a]);
    } else {
        rank.sort((a, b) => keys[a] - keys[b]);
    }

    if (opts.apply === 'stacking')
        return buildStackingCommand(doc, items, rank);

    if (opts.distributeSpacing && (opts.apply === 'x' || opts.apply === 'y'))
        return buildSpacingCommand(doc, items, rank, opts);

    // The values the objects get, smallest first: theirs, or (Distribute Evenly) evenly from the
    // smallest to the largest.
    let values = items.map(it => attribute(opts.apply, it)).sort((a, b) => a - b);
    if (opts.distribute && values.length > 1) {
        const lo = values[0], hi = values[values.length - 1];
        const steps = values.length - 1;
        values = values.map((_, j) => lo + (hi - lo) * j / steps);
    }
    const wanted = rank.map((idx, j) => ({ item: items[idx], value: values[j] }));

    if (opts.apply === 'opacity')
        return buildOpacityCommand(doc, wanted);
    return buildResizeOrMoveCommand(doc, wanted, opts);
}

// `Dialog` is passed in rather than required at module scope, so the live selection (captured in
// main() before this is called) can't be cleared by loading '/dialog.js' too early.
function buildDialog(Dialog) {
    const dlg = Dialog.create("Sort Objects");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    const labels = ["Width", "Height", "Area", "X Position", "Y Position", "Opacity", "Stacking Order"];
    dlg.by = grp.addComboBox("Sort By:", labels, SORT_KEYS.indexOf('area'));
    dlg.apply = grp.addComboBox("Apply To:", labels, SORT_KEYS.indexOf('stacking'));
    dlg.order = grp.addComboBox("Order:", ["Small to Large", "Large to Small", "Random"], 0);
    dlg.distribute = grp.addCheckBox("Distribute Evenly", false).setIsFullWidth(true);
    dlg.distributeSpacing = grp.addCheckBox("Distribute Spacing Evenly", false).setIsFullWidth(true);
    dlg.scaleStrokes = grp.addCheckBox("Scale Strokes & Effects", true).setIsFullWidth(true);
    return dlg;
}

// Distribute Spacing Evenly only means anything with Apply To X/Y Position, and takes over from
// Distribute Evenly there; Distribute Evenly otherwise only means anything short of Stacking
// Order; Scale Strokes & Effects only means anything when Apply To actually resizes.
function updateEnabled(dlg) {
    const apply = SORT_KEYS[dlg.apply.selectedIndex];
    const isXY = apply === 'x' || apply === 'y';
    dlg.distributeSpacing.isEnabled = isXY;
    dlg.distribute.isEnabled = apply !== 'stacking' && !(isXY && dlg.distributeSpacing.value);
    dlg.scaleStrokes.isEnabled = apply === 'width' || apply === 'height' || apply === 'area';
}

function readOptions(dlg, seed) {
    const orders = ['ascending', 'descending', 'random'];
    return {
        by: SORT_KEYS[dlg.by.selectedIndex] ?? 'area',
        apply: SORT_KEYS[dlg.apply.selectedIndex] ?? 'stacking',
        order: orders[dlg.order.selectedIndex] ?? 'ascending',
        distribute: dlg.distribute.value,
        distributeSpacing: dlg.distributeSpacing.value,
        scaleStrokes: dlg.scaleStrokes.value,
        seed,
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    const nodes = doc.selection.nodes.toArray();
    if (nodes.length < 2) {
        alert("Please select two or more objects");
        return;
    }
    if (nodes.length > CONFIG.MAX_OBJECTS) {
        alert("Please select no more than 20,000 objects");
        return;
    }

    // Capture the selection, in stacking order, before loading '/dialog.js', which clears it as a
    // side effect.
    const ordered = nodes.map(node => ({ node, path: indexPath(node) }))
        .sort((a, b) => comparePaths(a.path, b.path))
        .map(({ node }) => node);
    const items = ordered.map((node, i) => ({
        node, parent: node.parent, box: node.spreadVisibleBox, opacity: node.globalOpacity, stackIndex: i,
    }));

    const { Dialog, DialogResult } = require('/dialog.js');

    // Order "Random"'s seed: fixed for this run (so Preview and OK agree), not a visible field -
    // VectorCraft's own is hidden too, seeded from the document's revision counter instead.
    const seed = Math.floor(Math.random() * 1000000);
    const dlg = buildDialog(Dialog);

    const update = (preview) => {
        updateEnabled(dlg);
        const cmd = buildCommand(doc, items, readOptions(dlg, seed));
        if (cmd)
            doc.executeCommand(cmd, preview);
        else
            doc.clearPreviews();
        return cmd;
    };

    dlg.onControlValueChangedHandler = () => update(true);
    update(true);

    if (dlg.runModal() == DialogResult.Ok)
        update(false);

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
