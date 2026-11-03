'use strict';

// Arrange in Grid (VectorCraft: Object > Plug-ins > Arrange Tools > Arrange in Grid).
// Lays the selected objects out in a grid, a single row, or a single column, in their
// stacking order from the back, left to right and top to bottom. Each cell is as wide as
// the widest object in its column and as tall as the tallest in its row, each object is
// centred in its cell, and bounds are measured visually (strokes and effects as drawn).

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Dialog, DialogResult } = require('/dialog.js');
const { Document } = require('/document.js');
const { Transform, pointInRect, unionRects } = require('/geometry.js');
const { Selection } = require('/selections.js');
const { UnitType } = require('/units.js');

const MAX_COLUMNS = 10000;
const GAP_LIMIT = 1000000;

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

// The selected top-level objects, back to front, each with its visual bounds (spread coords).
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

function centreOf(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// Each item's move (dx, dy) to its grid cell centre, or null with nothing selected.
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
        const board = artboardAt(doc.currentSpread, centreOf(all)) ?? all;
        const c = centreOf(board);
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
        const centre = centreOf(item.box);
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

function buildDialog(doc, defaultColumns) {
    const dlg = Dialog.create("Arrange in Grid");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.layoutChoice = grp.addComboBox("Layout:", ["Grid by Row", "Arrange by Row", "Arrange by Column"], 0);
    dlg.columnsEditor = grp.addUnitValueEditor("Columns:", UnitType.Number, UnitType.Number, defaultColumns, 1, MAX_COLUMNS).setPrecision(0);
    dlg.gapX = grp.addUnitValueEditor("H Spacing:", UnitType.Point, doc.units, 10, -GAP_LIMIT, GAP_LIMIT);
    dlg.gapY = grp.addUnitValueEditor("V Spacing:", UnitType.Point, doc.units, 10, -GAP_LIMIT, GAP_LIMIT);
    dlg.center = grp.addCheckBox("Center on Artboard", false);

    const updateColumnsEnabled = () => { dlg.columnsEditor.isEnabled = dlg.layoutChoice.selectedIndex === 0; };
    dlg.layoutChoice.onValueChangedHandler = updateColumnsEnabled;
    updateColumnsEnabled();

    return dlg;
}

function readOptions(dlg) {
    const layouts = ['grid', 'row', 'column'];
    return {
        layout: layouts[dlg.layoutChoice.selectedIndex] ?? 'grid',
        columns: Math.max(1, Math.round(dlg.columnsEditor.value)),
        gapX: dlg.gapX.value,
        gapY: dlg.gapY.value,
        centerOnArtboard: dlg.center.value
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    const items = selectedItems(doc);
    if (items.length === 0) {
        alert("Please select one or more objects");
        return;
    }

    const defaultColumns = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const dlg = buildDialog(doc, defaultColumns);

    const update = (preview) => {
        const moves = computeMoves(doc, items, readOptions(dlg));
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

main();
