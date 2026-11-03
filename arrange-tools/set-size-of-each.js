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
Script Name:    set-size-of-each.js
Description:    Ported from VectorCraft's Arrange Tools > Set Size of Each. Gives every selected
                 object (the top-level ones) a width and/or height, each measured and set as the
                 corresponding visual bounds (strokes and effects as drawn), as one undo step. The
                 point of each object held fixed while it resizes is set by the Reference Point
                 (a 3x3 grid, as VectorCraft's own); with only one of width/height given, the other
                 can follow it in proportion. Scale Strokes & Effects sets each object's own
                 "Scale with object" stroke/effects setting to match (a lasting change, since
                 Affinity has no per-operation equivalent); with it off and a stroke present, the
                 resulting size is only approximate, since this script scales the geometric box
                 directly rather than solving for the exact visual size as VectorCraft's own
                 algorithm does.

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

// SIZE_MAX_PT is kept well short of VectorCraft's engine-level 1,000,000pt clamp: that range makes
// the popup slider unusable (see GAP_MIN_PT/GAP_MAX_PT in arrange-in-grid.js for the same tradeoff).
const CONFIG = {
    SIZE_MIN_PT: 0.001,     // Width/Height fields' lower bound (pt), VectorCraft's addon.arrange.size spec
    SIZE_MAX_PT: 5000,      // Width/Height fields' upper bound (pt) - about 69 inches
};

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Transform } = require('/geometry.js');
const { LineStyleDescriptor, LineStyleMask } = require('/linestyle.js');
const { Selection } = require('/selections.js');

function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
}

function isIdentity(xf) {
    const d = xf.data;
    return Math.abs(d[0] - 1) < 1e-9 && Math.abs(d[1]) < 1e-9 && Math.abs(d[2]) < 1e-9 &&
        Math.abs(d[3]) < 1e-9 && Math.abs(d[4] - 1) < 1e-9 && Math.abs(d[5]) < 1e-9;
}

// The width/height `object.setBounds` would give box `box`: the one not ticked stays, or - with
// exactly one ticked and Proportional on - follows the one that is.
function wantedSize(box, opts) {
    let w = opts.widthOn ? opts.width : box.width;
    let h = opts.heightOn ? opts.height : box.height;
    if (opts.proportional && opts.widthOn !== opts.heightOn) {
        if (opts.widthOn && box.width > 1e-9)
            h = box.height * w / box.width;
        else if (opts.heightOn && box.height > 1e-9)
            w = box.width * h / box.height;
    }
    return { width: w, height: h };
}

// The point of `box` that Reference Point `anchorValue` names, from `anchorMap` (built in main()
// from the dialog's own SpatialAnchor values, since this runs after '/dialog.js' is required).
function referencePoint(box, anchorMap, anchorValue) {
    const [row, col] = anchorMap.get(anchorValue) ?? [1, 1];
    const xs = [box.x, box.x + box.width / 2, box.x + box.width];
    const ys = [box.y, box.y + box.height / 2, box.y + box.height];
    return { x: xs[col], y: ys[row] };
}

// Scales `box` to `size` about its own Reference Point, which stays where it is.
function anchoredScaleTransform(box, anchorMap, anchorValue, size) {
    const rp = referencePoint(box, anchorMap, anchorValue);
    const sx = box.width > 1e-9 ? size.width / box.width : 1;
    const sy = box.height > 1e-9 ? size.height / box.height : 1;
    return Transform.createTranslate(rp.x, rp.y)
        .multiply(Transform.createScale(sx, sy))
        .multiply(Transform.createTranslate(-rp.x, -rp.y));
}

// Affinity has no per-operation "scale strokes" transform option: a stroke's own "Scale with
// object" (LineStyleDescriptor.isScale) and each layer effect's own scaleWithObject govern it
// instead, read automatically by the renderer whenever a transform runs. Matching the Scale
// Strokes & Effects checkbox for this resize means setting those - which, unlike VectorCraft's
// per-operation preference, also persists on the object afterward.
function applyScaleStrokes(doc, node, scaleOn, builder) {
    const lsd = node.lineStyleDescriptor;
    if (lsd.isScale !== scaleOn) {
        const newDesc = LineStyleDescriptor.create(lsd.lineStyle, { isScale: scaleOn });
        builder.addCommand(DocumentCommand.createSetLineStyleDescriptor(Selection.create(doc, node), newDesc, { lineStyleMask: LineStyleMask.Scale }));
    }
    builder.addCommand(DocumentCommand.createSetAllLayerEffectsScaleWithObject(Selection.create(doc, node), scaleOn));
}

function buildCommand(doc, items, anchorMap, opts) {
    const real = items
        .map(({ node, box }) => ({ node, xf: anchoredScaleTransform(box, anchorMap, opts.anchor, wantedSize(box, opts)) }))
        .filter(({ xf }) => !isIdentity(xf));
    if (real.length === 0)
        return null;
    const builder = CompoundCommandBuilder.create();
    for (const { node, xf } of real) {
        applyScaleStrokes(doc, node, opts.scaleStrokes, builder);
        builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, node), xf));
    }
    return builder.createCommand();
}

// `Dialog`/`SpatialAnchor`/`UnitType` are passed in rather than required at module scope, so the
// live selection (captured in main() before this is called) can't be cleared by loading
// '/dialog.js' too early.
function buildDialog(Dialog, SpatialAnchor, UnitType, doc, defaultWidthPt, defaultHeightPt) {
    const dlg = Dialog.create("Set Size of Each");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    // A column stack puts each row's checkbox and field side by side (one lane per control, each
    // lane's first - and only - row aligning with the other's), matching VectorCraft's own
    // checkbox+field row layout instead of stacking them as two separate full-width rows.
    const widthRow = grp.addColumnStack();
    dlg.widthCheck = widthRow.addColumn().addGroup().addCheckBox("Width", true).setIsFullWidth(true);
    dlg.widthField = widthRow.addColumn().addGroup("Width")
        .addUnitValueEditor("Width", UnitType.Point, doc.units, defaultWidthPt, CONFIG.SIZE_MIN_PT, CONFIG.SIZE_MAX_PT)
        .setShowPopupSlider(true);

    const heightRow = grp.addColumnStack();
    dlg.heightCheck = heightRow.addColumn().addGroup().addCheckBox("Height", true).setIsFullWidth(true);
    dlg.heightField = heightRow.addColumn().addGroup("Height")
        .addUnitValueEditor("Height", UnitType.Point, doc.units, defaultHeightPt, CONFIG.SIZE_MIN_PT, CONFIG.SIZE_MAX_PT)
        .setShowPopupSlider(true);
    dlg.proportional = grp.addCheckBox("Constrain Width and Height Proportions", false).setIsFullWidth(true);
    dlg.reference = grp.addSpatialAnchor("Reference Point:", SpatialAnchor.Centre);
    dlg.scaleStrokes = grp.addCheckBox("Scale Strokes & Effects", true).setIsFullWidth(true);
    return dlg;
}

// The Width/Height fields are only usable when their own checkbox is ticked, and Constrain only
// when exactly one of the two is - same rule the command itself applies (see wantedSize).
function updateEnabled(dlg) {
    dlg.widthField.isEnabled = dlg.widthCheck.value;
    dlg.heightField.isEnabled = dlg.heightCheck.value;
    dlg.proportional.isEnabled = dlg.widthCheck.value !== dlg.heightCheck.value;
}

function readOptions(dlg, ptToPx) {
    return {
        widthOn: dlg.widthCheck.value,
        heightOn: dlg.heightCheck.value,
        width: dlg.widthField.value * ptToPx,
        height: dlg.heightField.value * ptToPx,
        proportional: dlg.proportional.value,
        anchor: dlg.reference.value,
        scaleStrokes: dlg.scaleStrokes.value,
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    // Capture the selection and its state before loading '/dialog.js', which clears the selection
    // as a side effect.
    const nodes = doc.selection.nodes.toArray();
    if (nodes.length === 0) {
        alert("Please select one or more objects");
        return;
    }
    const items = nodes.map(node => ({ node, box: node.spreadVisibleBox }));

    const { Dialog, DialogResult, SpatialAnchor } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    // The Width/Height fields are collected in points; the boxes above are in document pixels.
    const ptToPx = doc.unitValueConverter.getConversionFactor(UnitType.Point, UnitType.Pixel);
    const pxToPt = doc.unitValueConverter.getConversionFactor(UnitType.Pixel, UnitType.Point);
    const first = items[0].box;
    const defaultWidthPt = clamp(first.width * pxToPt, CONFIG.SIZE_MIN_PT, CONFIG.SIZE_MAX_PT);
    const defaultHeightPt = clamp(first.height * pxToPt, CONFIG.SIZE_MIN_PT, CONFIG.SIZE_MAX_PT);

    // Reference Point's 3x3 grid, row by row from the top-left, keyed by the dialog's own
    // SpatialAnchor values (reference.value returns one of these, not a plain number).
    const anchorMap = new Map([
        [SpatialAnchor.TopLeft, [0, 0]], [SpatialAnchor.TopCentre, [0, 1]], [SpatialAnchor.TopRight, [0, 2]],
        [SpatialAnchor.CentreLeft, [1, 0]], [SpatialAnchor.Centre, [1, 1]], [SpatialAnchor.CentreRight, [1, 2]],
        [SpatialAnchor.BottomLeft, [2, 0]], [SpatialAnchor.BottomCentre, [2, 1]], [SpatialAnchor.BottomRight, [2, 2]],
    ]);

    const dlg = buildDialog(Dialog, SpatialAnchor, UnitType, doc, defaultWidthPt, defaultHeightPt);

    const update = (preview) => {
        updateEnabled(dlg);
        const cmd = buildCommand(doc, items, anchorMap, readOptions(dlg, ptToPx));
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
