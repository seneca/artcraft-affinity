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
Script Name:    swap-objects.js
Description:    Unifies VectorCraft's Arrange Tools > Swap Objects and Swap Objects
                 and Sizes into one dialog: swaps the places (bounding-box centres)
                 of the two selected objects, with two optional checkboxes - Swap
                 Sizes (also swaps their widths/heights, VectorCraft's "and Sizes"
                 variant) and Swap Colours (also swaps their fill and stroke colour/
                 fill descriptors; not part of VectorCraft, added per request). All
                 selected effects apply as one undo step. Bounds are measured
                 visually (strokes and effects as drawn). Scale Strokes & Effects (only
                 meaningful with Swap Sizes on) sets each object's own "Scale with
                 object" stroke/effects setting to match (a lasting change, since
                 Affinity has no per-operation equivalent); with it off and a stroke
                 present, the resulting size is only approximate, since this script
                 scales the geometric box directly rather than solving for the exact
                 visual size as VectorCraft's own algorithm does.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        03/11/2026
Last updated:   03/11/2026
Compatibility:  Affinity by Canva 3.3

See swap-objects.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Transform } = require('/geometry.js');
const { LineStyleDescriptor, LineStyleMask } = require('/linestyle.js');
const { Selection } = require('/selections.js');

// Moves `box`'s centre to `targetCentre`, keeping its own size.
function translateTransform(box, targetCentre) {
    const centre = box.centre;
    return Transform.createTranslate(targetCentre.x - centre.x, targetCentre.y - centre.y);
}

// Moves `box`'s centre to `targetCentre` and scales it to `targetSize`'s width/height -
// equivalent to object.setBounds with reference point 4 (centre).
function boundsTransform(box, targetCentre, targetSize) {
    const centre = box.centre;
    const sx = targetSize.width / box.width;
    const sy = targetSize.height / box.height;
    return Transform.createTranslate(targetCentre.x, targetCentre.y)
        .multiply(Transform.createScale(sx, sy))
        .multiply(Transform.createTranslate(-centre.x, -centre.y));
}

function isIdentity(xf) {
    const d = xf.data;
    return Math.abs(d[0] - 1) < 1e-9 && Math.abs(d[1]) < 1e-9 && Math.abs(d[2]) < 1e-9 &&
        Math.abs(d[3]) < 1e-9 && Math.abs(d[4] - 1) < 1e-9 && Math.abs(d[5]) < 1e-9;
}

// Affinity has no per-operation "scale strokes" transform option: a stroke's own "Scale with
// object" (LineStyleDescriptor.isScale) and each layer effect's own scaleWithObject govern it
// instead, read automatically by the renderer whenever a transform runs. Matching the Scale
// Strokes & Effects checkbox for this swap means setting those - which, unlike VectorCraft's
// per-operation preference, also persists on the object afterward.
function applyScaleStrokes(doc, node, scaleOn, builder) {
    const lsd = node.lineStyleDescriptor;
    if (lsd.isScale !== scaleOn) {
        const newDesc = LineStyleDescriptor.create(lsd.lineStyle, { isScale: scaleOn });
        builder.addCommand(DocumentCommand.createSetLineStyleDescriptor(Selection.create(doc, node), newDesc, { lineStyleMask: LineStyleMask.Scale }));
    }
    builder.addCommand(DocumentCommand.createSetAllLayerEffectsScaleWithObject(Selection.create(doc, node), scaleOn));
}

// `a`/`b`'s pre-swap state is captured once in main() and passed in unchanged on every call -
// never re-read from the nodes, since a preview already in effect would otherwise be compounded.
function buildCommand(doc, a, b, state, opts) {
    const builder = CompoundCommandBuilder.create();
    let any = false;

    const xfA = opts.swapSizes
        ? boundsTransform(state.boxA, state.boxB.centre, state.boxB)
        : translateTransform(state.boxA, state.boxB.centre);
    const xfB = opts.swapSizes
        ? boundsTransform(state.boxB, state.boxA.centre, state.boxA)
        : translateTransform(state.boxB, state.boxA.centre);

    if (opts.swapSizes) {
        applyScaleStrokes(doc, a, opts.scaleStrokes, builder);
        applyScaleStrokes(doc, b, opts.scaleStrokes, builder);
        any = true;
    }

    if (!isIdentity(xfA)) {
        builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, a), xfA));
        any = true;
    }
    if (!isIdentity(xfB)) {
        builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, b), xfB));
        any = true;
    }

    if (opts.swapColours) {
        builder.addCommand(DocumentCommand.createSetBrushFill(Selection.create(doc, a), state.fillB));
        builder.addCommand(DocumentCommand.createSetBrushFill(Selection.create(doc, b), state.fillA));
        builder.addCommand(DocumentCommand.createSetPenFill(Selection.create(doc, a), state.penB));
        builder.addCommand(DocumentCommand.createSetPenFill(Selection.create(doc, b), state.penA));
        any = true;
    }

    return any ? builder.createCommand() : null;
}

// `Dialog` is passed in rather than required at module scope, so the live selection (captured in
// main() before this is called) can't be cleared by loading '/dialog.js' too early.
function buildDialog(Dialog) {
    const dlg = Dialog.create("Swap Objects");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.swapSizes = grp.addCheckBox("Swap Sizes", false).setIsFullWidth(true);
    dlg.swapColours = grp.addCheckBox("Swap Colours", false).setIsFullWidth(true);
    dlg.scaleStrokes = grp.addCheckBox("Scale Strokes & Effects", true).setIsFullWidth(true);
    return dlg;
}

// Scale Strokes & Effects only means anything when sizes are actually swapped.
function updateEnabled(dlg) {
    dlg.scaleStrokes.isEnabled = dlg.swapSizes.value;
}

function readOptions(dlg) {
    return { swapSizes: dlg.swapSizes.value, swapColours: dlg.swapColours.value, scaleStrokes: dlg.scaleStrokes.value };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    const nodes = doc.selection.nodes.toArray();
    if (nodes.length !== 2) {
        alert("Please select exactly two objects");
        return;
    }

    // Capture the selection and its state before loading '/dialog.js', which clears the selection
    // as a side effect.
    const [a, b] = nodes;
    const state = {
        boxA: a.spreadVisibleBox,
        boxB: b.spreadVisibleBox,
        fillA: a.brushFillDescriptor,
        fillB: b.brushFillDescriptor,
        penA: a.penFillDescriptor,
        penB: b.penFillDescriptor,
    };

    const { Dialog, DialogResult } = require('/dialog.js');
    const dlg = buildDialog(Dialog);

    const update = (preview) => {
        updateEnabled(dlg);
        const cmd = buildCommand(doc, a, b, state, readOptions(dlg));
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
