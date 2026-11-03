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
Script Name:    swap-objects-and-sizes.js
Description:    Ported from VectorCraft's Arrange Tools > Swap Objects and Sizes. Swaps the places (bounding-box centres) AND the widths/heights of the two selected objects, as one undo step. Bounds are measured visually (strokes and effects as drawn).

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        03/11/2026
Last updated:   03/11/2026
Compatibility:  Affinity by Canva 3.3

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Transform } = require('/geometry.js');
const { Selection } = require('/selections.js');

function centreOf(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// The transform that moves `box`'s centre to `targetCentre` and scales it to `targetSize`'s
// width/height - equivalent to object.setBounds with reference point 4 (centre).
function boundsTransform(box, targetCentre, targetSize) {
    const centre = centreOf(box);
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

    const [a, b] = nodes;
    const boxA = a.spreadVisibleBox;
    const boxB = b.spreadVisibleBox;

    const xfA = boundsTransform(boxA, centreOf(boxB), boxB);
    const xfB = boundsTransform(boxB, centreOf(boxA), boxA);

    if (isIdentity(xfA) && isIdentity(xfB))
        return;

    const builder = CompoundCommandBuilder.create();
    builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, a), xfA));
    builder.addCommand(DocumentCommand.createTransform(Selection.create(doc, b), xfB));
    doc.executeCommand(builder.createCommand());
}

// ============================================================
// RUN
// ============================================================

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
