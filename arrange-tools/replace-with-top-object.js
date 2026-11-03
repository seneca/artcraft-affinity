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
Script Name:    replace-with-top-object.js
Description:    Ported from VectorCraft's Arrange Tools > Replace with Top Object. Puts a
                 copy of the frontmost selected object centred on each of the other selected
                 objects, in that object's place in the stacking order, as one undo step. Sizes
                 and centres are measured by visual bounds (strokes and effects as drawn). Scale
                 Strokes & Effects sets each copy's own "Scale with object" stroke/effects setting
                 to match (a lasting change, since Affinity has no per-operation equivalent); with
                 it off and a stroke present, the resulting size is only approximate, since this
                 script scales the geometric box directly rather than solving for the exact visual
                 size as VectorCraft's own algorithm does.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        03/11/2026
Last updated:   03/11/2026
Compatibility:  Affinity by Canva 3.3

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Transform } = require('/geometry.js');
const { LineStyleDescriptor, LineStyleMask } = require('/linestyle.js');
const { Selection } = require('/selections.js');

// The node's position among its siblings at every level up to the root, back (0) to front;
// used to find the frontmost of the selected objects.
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

// The top object's target size against `otherBox`, or null to keep its own size ("Actual Size").
function computeSize(fit, topBox, otherBox) {
    if (fit === 'bounds')
        return { width: otherBox.width, height: otherBox.height };
    if (fit === 'proportional') {
        // The smaller of the two scales that fit inside otherBox, preserving the top object's own
        // proportions; a side the top object doesn't have (near zero) doesn't count.
        const ratios = [];
        if (topBox.width > 1e-9)
            ratios.push(otherBox.width / topBox.width);
        if (topBox.height > 1e-9)
            ratios.push(otherBox.height / topBox.height);
        if (ratios.length === 0)
            return null;
        const k = Math.min(...ratios);
        return { width: topBox.width * k, height: topBox.height * k };
    }
    return null;
}

function translateTransform(box, targetCentre) {
    const centre = box.centre;
    return Transform.createTranslate(targetCentre.x - centre.x, targetCentre.y - centre.y);
}

// Moves `box`'s centre to `targetCentre` and scales it to `targetSize`'s width/height.
function boundsTransform(box, targetCentre, targetSize) {
    const centre = box.centre;
    const sx = targetSize.width / box.width;
    const sy = targetSize.height / box.height;
    return Transform.createTranslate(targetCentre.x, targetCentre.y)
        .multiply(Transform.createScale(sx, sy))
        .multiply(Transform.createTranslate(-centre.x, -centre.y));
}

// Adjusts the live selection - the duplicate the transform just before this call created - to
// match `scaleOn`'s stroke/effects scaling. Affinity has no per-operation "scale strokes" transform
// option: a stroke's own "Scale with object" (LineStyleDescriptor.isScale) and each layer effect's
// own scaleWithObject govern it instead, read automatically by the renderer whenever a transform
// runs. `topLineStyle` is `top`'s own current descriptor - the duplicate starts out identical to
// it, so that decides whether a change is even needed. Selection `null` (rather than a captured
// one) means "whatever is currently selected": there is no JS reference to the not-yet-created
// duplicate available while this compound is still being built, but it is the live selection
// immediately after the preceding duplicating transform runs, and stays so through these two calls.
function applyScaleStrokesToSelection(topLineStyle, scaleOn, builder) {
    if (topLineStyle.isScale !== scaleOn) {
        const newDesc = LineStyleDescriptor.create(topLineStyle.lineStyle, { isScale: scaleOn });
        builder.addCommand(DocumentCommand.createSetLineStyleDescriptor(null, newDesc, { lineStyleMask: LineStyleMask.Scale }));
    }
    builder.addCommand(DocumentCommand.createSetAllLayerEffectsScaleWithObject(null, scaleOn));
}

// For each `other`, duplicates `top`, places the duplicate on `other`'s centre (sized per
// `opts.fit`), moves it into `other`'s place in the stacking order, and - unless `opts.keep` -
// deletes `other`.
function buildCommand(doc, top, topBox, others, opts) {
    if (others.length === 0)
        return null;
    const topLineStyle = top.lineStyleDescriptor;
    const builder = CompoundCommandBuilder.create();
    for (const { node: other, box: otherBox } of others) {
        const size = computeSize(opts.fit, topBox, otherBox);
        const xf = size ? boundsTransform(topBox, otherBox.centre, size) : translateTransform(topBox, otherBox.centre);
        builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, top), xf, { duplicateNodes: true }));
        applyScaleStrokesToSelection(topLineStyle, opts.scaleStrokes, builder);
        builder.addCommand(DocumentCommand.createMoveNodes(null, other, NodeMoveType.After, NodeChildType.Main));
        if (!opts.keep)
            builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, other)));
    }
    return builder.createCommand();
}

// `Dialog` is passed in rather than required at module scope, so the live selection (captured in
// main() before this is called) can't be cleared by loading '/dialog.js' too early.
function buildDialog(Dialog) {
    const dlg = Dialog.create("Replace with Top Object");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    const fits = ["Actual Size", "Bounds", "Bounds (Fit Proportionally)"];
    dlg.fit = grp.addComboBox("Size:", fits, 0);
    dlg.keep = grp.addCheckBox("Keep Original", false).setIsFullWidth(true);
    dlg.scaleStrokes = grp.addCheckBox("Scale Strokes & Effects", true).setIsFullWidth(true);
    return dlg;
}

function readOptions(dlg) {
    const fits = ['keep', 'bounds', 'proportional'];
    return { fit: fits[dlg.fit.selectedIndex] ?? 'keep', keep: dlg.keep.value, scaleStrokes: dlg.scaleStrokes.value };
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

    // Capture the selection, in stacking order, before loading '/dialog.js', which clears the
    // selection as a side effect. The frontmost object is the one copied; the rest are replaced.
    const ordered = nodes.map(node => ({ node, path: indexPath(node) }))
        .sort((a, b) => comparePaths(a.path, b.path))
        .map(({ node }) => node);
    const top = ordered[ordered.length - 1];
    const topBox = top.spreadVisibleBox;
    const others = ordered.slice(0, -1).map(node => ({ node, box: node.spreadVisibleBox }));

    const { Dialog, DialogResult } = require('/dialog.js');
    const dlg = buildDialog(Dialog);

    // Unlike the other Arrange Tools scripts, this one doesn't live-preview: live-testing showed a
    // compound command that duplicates, reorders and deletes nodes doesn't revert cleanly on
    // doc.clearPreviews(), so it only runs once, for real, on OK.
    if (dlg.runModal() == DialogResult.Ok) {
        const cmd = buildCommand(doc, top, topBox, others, readOptions(dlg));
        if (cmd)
            doc.executeCommand(cmd);
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
