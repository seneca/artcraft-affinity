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
Script Name:    box-3d.js
Description:    Ported from VectorCraft's 3D Box tool. Creates a rotatable 3D box as a single
                 object: one closed quad per visible cube face, sorted back to front, filling a
                 given Width x Height silhouette. Angle X/Y/Z rotate the underlying cube; Parallel
                 X/Y/Z each switch that axis between true orthographic projection (on) and a
                 cheap foreshortened "perspective" look (off) - matching VectorCraft's own formula
                 exactly, not a physically-accurate camera. VectorCraft's own tool is a draggable
                 canvas tool (drag to set size and position, arrow keys to spin it live, further
                 options in a control bar) with no dialog of its own; this SDK has no equivalent
                 to a custom draggable canvas tool, so this script is a dialog instead, with the
                 same parameters, live-previewed, and placed centred on the artboard under the
                 current spread's own centre (its first artboard if none is there, or the spread
                 itself if it has no artboards at all).

See box-3d.md for the full guide.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        08/11/2026
Last updated:   08/11/2026
Compatibility:  Affinity by Canva 3.3

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    SIZE_MIN_PT: 1,
    SIZE_MAX_PT: 5000,
    DEFAULT_SIZE_PT: 200,
    ANGLE_MIN: -180,
    ANGLE_MAX: 180,
    DEFAULT_ANGLE_X: 30,
    DEFAULT_ANGLE_Y: 35,
    DEFAULT_ANGLE_Z: 0,
};

// The cube's 8 corners, (-1,-1,-1)..(1,1,1), in the fixed order every other table below indexes into.
const CUBE_CORNERS = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

// The cube's 6 faces as corner indices, each already in outward-facing winding order in 3D -
// VectorCraft's own grouping (crates/geom/src/shapes.rs), kept in the same order so a tie in
// depth sorting (never expected, but possible at some exact angles) breaks the same way.
const FACES = [
    [4, 5, 6, 7], // +Z front
    [1, 0, 3, 2], // -Z back
    [0, 4, 7, 3], // -X left
    [5, 1, 2, 6], // +X right
    [0, 1, 5, 4], // -Y top
    [7, 6, 2, 3], // +Y bottom
];

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily -
// see modern-js.md 2.1 in the affinity-scripts-toolkit. This script doesn't need a selection, but
// stays consistent with the other scripts in this repo regardless.
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { Document } = require('/document.js');
const { CurveBuilder, PolyCurve, pointInRect } = require('/geometry.js');
const { FillDescriptor } = require('/fills.js');
const { LineStyleDescriptor } = require('/linestyle.js');
const { PolyCurveNodeDefinition } = require('/nodes.js');
const { SVG11 } = require('/colours.js');
const { BlendMode } = require('affinity:common');

// `x`/`y`/`z` of one cube corner, rotated by (angleX, angleY, angleZ) about the origin (X, then Y,
// then Z) and - unless the matching Parallel flag is on - cheaply foreshortened toward that axis
// first (VectorCraft's own stand-in for perspective, not a real camera projection) or divided down
// by a simple 1/(1 - 0.25 * depth) factor for Z. Returns [x, y, depth] - depth (post-rotation,
// pre-Z-perspective) is also what face visibility and draw order are decided by, below.
function transformCorner(x, y, z, sincos, parallel) {
    const { sx, cx, sy, cy, sz, cz } = sincos;
    if (!parallel.x) {
        const k = 1 - 0.22 * x;
        y *= k;
        z *= k;
    }
    if (!parallel.y) {
        const k = 1 - 0.22 * y;
        x *= k;
        z *= k;
    }
    const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
    const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
    const x3 = x2 * cz - y1 * sz, y3 = x2 * sz + y1 * cz;
    const persp = parallel.z ? 1 : 1 / Math.max(1 - 0.25 * z2, 0.2);
    return [x3 * persp, y3 * persp, z2];
}

// Shoelace signed area of a closed 4-point polygon - positive when `pts` runs clockwise on screen
// (y down), matching VectorCraft's own SubPath::signed_area() exactly (verified against its
// source, crates/geom/src/path.rs), which is what decides which faces are outward (visible) below.
function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < 4; ++i) {
        const p0 = pts[i], p1 = pts[(i + 1) % 4];
        a += p0.x * p1.y - p1.x * p0.y;
    }
    return a / 2;
}

// The visible faces of a box inscribed in the rect (ox, oy, w, h), rotated by angleX/Y/Z degrees,
// each a closed 4-point polygon in document coordinates, sorted back to front for painter's-
// algorithm drawing. Faithfully ported from VectorCraft's box3d() (crates/geom/src/shapes.rs):
// rotate the unit cube's 8 corners, normalize their 2D projection to exactly fill (w, h), then keep
// only the faces whose projected quad is outward-facing (positive signed area) - typically 2-3 of
// the 6, for any non-degenerate view.
function box3dFaces(w, h, angleX, angleY, angleZ, parallel, ox, oy) {
    const rx = angleX * Math.PI / 180, ry = angleY * Math.PI / 180, rz = angleZ * Math.PI / 180;
    const sincos = { sx: Math.sin(rx), cx: Math.cos(rx), sy: Math.sin(ry), cy: Math.cos(ry), sz: Math.sin(rz), cz: Math.cos(rz) };

    const rawVerts = CUBE_CORNERS.map(([x, y, z]) => transformCorner(x, y, z, sincos, parallel));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [vx, vy] of rawVerts) {
        minX = Math.min(minX, vx); maxX = Math.max(maxX, vx);
        minY = Math.min(minY, vy); maxY = Math.max(maxY, vy);
    }
    const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6);
    const proj = i => {
        const [vx, vy] = rawVerts[i];
        return { x: ox + (vx - minX) / spanX * w, y: oy + (vy - minY) / spanY * h };
    };

    const facesWithDepth = [];
    for (const idx of FACES) {
        const zAvg = (rawVerts[idx[0]][2] + rawVerts[idx[1]][2] + rawVerts[idx[2]][2] + rawVerts[idx[3]][2]) / 4;
        let pts = idx.map(proj);
        const area = signedArea(pts);
        if (area > 1e-4) {
            facesWithDepth.push([zAvg, pts]);
        } else if (facesWithDepth.length === 0 && Math.abs(area) > 1e-4) {
            // No outward face found yet at a fully degenerate angle (e.g. looking straight along an
            // axis): fall back to this one, reversed, same as VectorCraft's own fallback.
            facesWithDepth.push([zAvg, pts.slice().reverse()]);
        }
    }
    facesWithDepth.sort((a, b) => a[0] - b[0]);
    return facesWithDepth.map(([, pts]) => pts);
}

// The artboard under `spread`'s own centre, else its first artboard, else null (no artboards) -
// same lookup as arrange-in-grid.js's artboardAt, reused here to anchor the box's default position.
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

// Where new boxes are centred by default: the artboard under the spread's own centre (or its first
// artboard), else the spread's own extents - fixed once per script run, so the box grows or shrinks
// from the same point as Width/Height change rather than drifting.
function defaultCentre(doc) {
    const spread = doc.currentSpread;
    const extents = spread.getSpreadExtents(true, false, false);
    const spreadCentre = { x: extents.x + extents.width / 2, y: extents.y + extents.height / 2 };
    const board = artboardAt(spread, spreadCentre);
    return board ? { x: board.x + board.width / 2, y: board.y + board.height / 2 } : spreadCentre;
}

function buildCommand(doc, centre, opts) {
    const ox = centre.x - opts.width / 2, oy = centre.y - opts.height / 2;
    const faces = box3dFaces(opts.width, opts.height, opts.angleX, opts.angleY, opts.angleZ, opts.parallel, ox, oy);
    if (faces.length === 0)
        return null;

    const poly = PolyCurve.create();
    for (const pts of faces) {
        const cb = CurveBuilder.create()
            .beginXY(pts[0].x, pts[0].y)
            .lineToXY(pts[1].x, pts[1].y)
            .lineToXY(pts[2].x, pts[2].y)
            .lineToXY(pts[3].x, pts[3].y)
            .close();
        poly.addCurve(cb.createCurve());
    }

    const brushFill = FillDescriptor.createSolid(SVG11.white, BlendMode.Normal);
    const lineFill = FillDescriptor.createSolid(SVG11.black, BlendMode.Normal);
    const lineStyle = LineStyleDescriptor.createDefault(1);
    const noFill = FillDescriptor.createNone();
    const def = PolyCurveNodeDefinition.create(poly, brushFill, lineFill, lineStyle, noFill);
    def.userDescription = "3D Box";

    const builder = AddChildNodesCommandBuilder.create();
    builder.setInsertionTarget(doc.currentSpread);
    builder.addNode(def);
    return builder.createCommand(true);
}

// `Dialog`/`UnitType` are passed in rather than required at module scope, so loading '/dialog.js'
// can't clear a selection this script doesn't otherwise touch (kept for consistency regardless).
function buildDialog(Dialog, UnitType, doc) {
    const dlg = Dialog.create("3D Box");
    const col = dlg.addColumn();

    const size = col.addGroup("Size");
    dlg.width = size.addUnitValueEditor("Width:", UnitType.Point, doc.units, CONFIG.DEFAULT_SIZE_PT, CONFIG.SIZE_MIN_PT, CONFIG.SIZE_MAX_PT).setShowPopupSlider(true);
    dlg.height = size.addUnitValueEditor("Height:", UnitType.Point, doc.units, CONFIG.DEFAULT_SIZE_PT, CONFIG.SIZE_MIN_PT, CONFIG.SIZE_MAX_PT).setShowPopupSlider(true);

    const rotation = col.addGroup("Rotation");
    dlg.angleX = rotation.addUnitValueEditor("Angle X:", UnitType.Degree, UnitType.Degree, CONFIG.DEFAULT_ANGLE_X, CONFIG.ANGLE_MIN, CONFIG.ANGLE_MAX).setShowPopupSlider(true);
    dlg.angleY = rotation.addUnitValueEditor("Angle Y:", UnitType.Degree, UnitType.Degree, CONFIG.DEFAULT_ANGLE_Y, CONFIG.ANGLE_MIN, CONFIG.ANGLE_MAX).setShowPopupSlider(true);
    dlg.angleZ = rotation.addUnitValueEditor("Angle Z:", UnitType.Degree, UnitType.Degree, CONFIG.DEFAULT_ANGLE_Z, CONFIG.ANGLE_MIN, CONFIG.ANGLE_MAX).setShowPopupSlider(true);

    const projection = col.addGroup("Projection");
    dlg.parallelX = projection.addCheckBox("Parallel X", true).setIsFullWidth(true);
    dlg.parallelY = projection.addCheckBox("Parallel Y", true).setIsFullWidth(true);
    dlg.parallelZ = projection.addCheckBox("Parallel Z", true).setIsFullWidth(true);

    return dlg;
}

function readOptions(dlg) {
    return {
        width: dlg.width.value,
        height: dlg.height.value,
        angleX: dlg.angleX.value,
        angleY: dlg.angleY.value,
        angleZ: dlg.angleZ.value,
        parallel: { x: dlg.parallelX.value, y: dlg.parallelY.value, z: dlg.parallelZ.value },
    };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    // Fixed once per run, before '/dialog.js' is loaded, so the box's anchor point can't shift if
    // loading it has any side effect on the current spread/selection.
    const centre = defaultCentre(doc);

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');
    const dlg = buildDialog(Dialog, UnitType, doc);

    const update = (preview) => {
        const cmd = buildCommand(doc, centre, readOptions(dlg));
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
