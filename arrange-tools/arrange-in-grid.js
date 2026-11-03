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
Script Name:    arrange-in-grid.js
Description:    Ported from VectorCraft's Arrange Tools > Arrange in Grid. Lays the selected objects out in a grid, a single row, or a single column, in stacking order from the back, left to right and top to bottom; each cell is sized to the widest/tallest object in its column/row, with live preview.

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

// GAP_MIN_PT/GAP_MAX_PT are kept well short of VectorCraft's engine-level -1,000,000..1,000,000
// clamp on gapX/gapY: that range makes the popup slider unusable and, uncaught, can fling objects
// far off the artboard on a single drag.
const CONFIG = {
    MAX_COLUMNS: 10000,     // Columns field's upper bound (VectorCraft's addon.arrange.grid spec)
    GAP_MIN_PT: -500,       // H/V Spacing lower bound (pt)
    GAP_MAX_PT: 500,        // H/V Spacing upper bound (pt)
    DEFAULT_GAP_PT: 10,     // H/V Spacing default (pt), matches VectorCraft
};

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Transform, pointInRect, unionRects } = require('/geometry.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');

// The node's position among its siblings at every level up to the root, back (0) to front;
// used to sort arbitrary selected nodes into document stacking order.
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

// The selected top-level objects, back to front, each with its visual bounds (spread coords,
// in document pixels).
function selectedItems(doc) {
    const nodes = doc.selection.nodes.toArray();
    const ordered = nodes.map(node => ({ node, path: indexPath(node) }));
    ordered.sort((a, b) => comparePaths(a.path, b.path));
    return ordered.map(({ node }) => ({ node, box: node.spreadVisibleBox }));
}

// The artboard on `spread` under point `pt`, else the first artboard, else null (no artboards).
function artboardAt(spread, pt) {
    const artboards = [];
    for (const node of spread.children) {
        if (node.artboardInterface && node.artboardInterface.isArtboardEnabled)
            artboards.push(node.artboardInterface.spreadBaseBox);
    }
    if (artboards.length === 0)
        return null;
    return artboards.find(box => pointInRect(box, pt)) ?? artboards[0];
}

// Each item's move (dx, dy) to its grid cell centre, or null with nothing selected. `opts.gapX`
// and `opts.gapY` must already be in document pixels (the same space as the items' boxes) -
// see readOptions, which converts them from the points the dialog collects them in.
function computeMoves(doc, items, opts) {
    const n = items.length;
    if (n === 0)
        return null;
    let cols;
    if (opts.layout === 'row')
        cols = n;
    else if (opts.layout === 'column')
        cols = 1;
    else
        cols = opts.columns;
    cols = Math.max(1, Math.min(cols, n));
    const rows = Math.ceil(n / cols);
    const widths = new Array(cols).fill(0);
    const heights = new Array(rows).fill(0);
    items.forEach((item, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        widths[c] = Math.max(widths[c], item.box.width);
        heights[r] = Math.max(heights[r], item.box.height);
    });
    const total = (sizes, gap) => sizes.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1);

    let all = items[0].box;
    for (let i = 1; i < items.length; ++i)
        all = unionRects(all, items[i].box);

    let originX, originY;
    if (opts.centerOnArtboard) {
        const board = artboardAt(doc.currentSpread, all.centre) ?? all;
        const c = board.centre;
        originX = c.x - total(widths, opts.gapX) / 2;
        originY = c.y - total(heights, opts.gapY) / 2;
    }
    else {
        originX = all.x;
        originY = all.y;
    }

    // The middle of each column (row): the sizes and gaps before it, and half its own size.
    const middles = (sizes, gap, from) => {
        let at = from;
        return sizes.map(size => {
            const mid = at + size / 2;
            at += size + gap;
            return mid;
        });
    };
    const xs = middles(widths, opts.gapX, originX);
    const ys = middles(heights, opts.gapY, originY);

    return items.map((item, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const centre = item.box.centre;
        return { node: item.node, dx: xs[c] - centre.x, dy: ys[r] - centre.y };
    });
}

function buildCommand(doc, moves) {
    const real = moves.filter(m => Math.abs(m.dx) > 1e-9 || Math.abs(m.dy) > 1e-9);
    if (real.length === 0)
        return null;
    if (real.length === 1) {
        const m = real[0];
        return DocumentCommand.createTransform(Selection.create(doc, m.node), Transform.createTranslate(m.dx, m.dy));
    }
    const builder = CompoundCommandBuilder.create();
    for (const m of real)
        builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, m.node), Transform.createTranslate(m.dx, m.dy)));
    return builder.createCommand();
}

// `Dialog` is passed in rather than required at module scope, so the live selection (captured in
// main() before this is called) can't be cleared by loading '/dialog.js' too early.
function buildDialog(Dialog, doc, defaultColumns) {
    const dlg = Dialog.create("Arrange in Grid");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.layoutChoice = grp.addComboBox("Layout:", ["Grid by Row", "Arrange by Row", "Arrange by Column"], 0);
    dlg.columnsEditor = grp.addUnitValueEditor("Columns:", UnitType.Number, UnitType.Number, defaultColumns, 1, CONFIG.MAX_COLUMNS).setPrecision(0);
    dlg.gapX = grp.addUnitValueEditor("H Spacing:", UnitType.Point, doc.units, CONFIG.DEFAULT_GAP_PT, CONFIG.GAP_MIN_PT, CONFIG.GAP_MAX_PT).setShowPopupSlider(true);
    dlg.gapY = grp.addUnitValueEditor("V Spacing:", UnitType.Point, doc.units, CONFIG.DEFAULT_GAP_PT, CONFIG.GAP_MIN_PT, CONFIG.GAP_MAX_PT).setShowPopupSlider(true);
    dlg.center = grp.addCheckBox("Center on Artboard", false);

    const updateColumnsEnabled = () => { dlg.columnsEditor.isEnabled = dlg.layoutChoice.selectedIndex === 0; };
    dlg.layoutChoice.onValueChangedHandler = updateColumnsEnabled;
    updateColumnsEnabled();

    return dlg;
}

// The dialog's fields, with gapX/gapY converted from the points they're collected in (matching
// VectorCraft's pt-based gapX/gapY) to the document pixels computeMoves' geometry is measured in.
function readOptions(doc, dlg) {
    const layouts = ['grid', 'row', 'column'];
    const ptToPx = doc.unitValueConverter.getConversionFactor(UnitType.Point, UnitType.Pixel);
    return {
        layout: layouts[dlg.layoutChoice.selectedIndex] ?? 'grid',
        columns: Math.max(1, Math.round(dlg.columnsEditor.value)),
        gapX: dlg.gapX.value * ptToPx,
        gapY: dlg.gapY.value * ptToPx,
        centerOnArtboard: dlg.center.value
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    // Capture the selection before loading '/dialog.js', which clears it as a side effect.
    const items = selectedItems(doc);
    if (items.length === 0) {
        alert("Please select one or more objects");
        return;
    }

    const { Dialog, DialogResult } = require('/dialog.js');

    const defaultColumns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const dlg = buildDialog(Dialog, doc, defaultColumns);

    const update = (preview) => {
        const moves = computeMoves(doc, items, readOptions(doc, dlg));
        const cmd = moves ? buildCommand(doc, moves) : null;
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
