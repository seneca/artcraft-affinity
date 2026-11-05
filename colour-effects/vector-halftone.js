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
Script Name:    vector-halftone.js
Description:    Approximate port of VectorCraft's Colour Effects > Vector Halftone. Turns the one
                 selected object into real vector halftone dots sized by its own tone, as one
                 undo step: a grid of cells turned by CONFIG.ANGLE, each sampled for how dark (or,
                 with CONFIG.INVERT, how light) the art is there, each getting a dot shape whose
                 area follows that tone. CONFIG.MODE "cmyk" draws four such screens, one per ink
                 at the classic offset angles, reading the art's own colour-managed ink amounts
                 instead of lightness.

                 The art is sampled by actually rendering the selected object to a real bitmap -
                 confirmed live: `NodeRenderingEngine.create(node, format, options)` with
                 `options.scale`/`options.sourceRect` renders at exactly the region and pixel
                 density asked for, baking in the object's own effects; pixels outside its filled
                 area come back alpha=0, used here as "no ink there". A CMYKA8-format render
                 (confirmed live) gives real, colour-managed ink percentages per pixel, not a
                 naive RGB-to-CMYK guess - the same quality of separation CONFIG.MODE "cmyk" needs.

                 Each dot is a real vector shape (`Curve.createEllipse/createRectangle/
                 createDiamond`), placed by rotating then translating it into its cell - confirmed
                 live against hand-calculated bounding boxes - and every dot of one screen is
                 combined into a single multi-contour `PolyCurve`, turned into one real path
                 object via `PolyCurveNodeDefinition.create`.

                 Settings come from a dialog (Affinity's own Dialog API, /dialog.js) rather than a
                 CONFIG object you edit by hand - CONFIG below only supplies the values the dialog
                 opens with. Confirmed directly via this project's own test tool: an add-nodes-
                 plus-delete-original compound (what this script builds) reverts cleanly from a
                 preview, same as a plain add, so it's safe to live-preview. The render-and-sample
                 pass itself is too expensive to want on every tick of a slider drag (it can mean
                 thousands of cells, each sampled from a freshly rendered bitmap) - the original
                 design used a `transient`-flag-based split (a cheap grid-math estimate while
                 dragging, the full preview on release) to cope with that, but Frequency/Angle's
                 popup sliders were removed entirely after the user confirmed, live, that dragging
                 one didn't trigger a live preview at all, even though typing a value does; the
                 transient-based cheap/expensive split in the code below is dead weight now (no
                 slider means no drag to throttle) but harmless, and is left in case a future SDK
                 change makes sliders behave as originally assumed. Note for future maintenance:
                 the dialog UI itself still can't be driven by this project's own MCP test tool (it
                 only runs in the native Scripts panel), so its controls and wiring were checked
                 carefully against /dialog.js and ts/ui.d.ts but not exercised live - test it for
                 real before relying on it.

Author:         Les Pruszynski (Middledot)
Version:        1.2.1
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See vector-halftone.md for the full guide, including what's different from VectorCraft's own
tool (no clip-to-outline, and CMYK screens aren't given a Multiply blend mode).

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

// These are only the values the dialog opens with - change them if you want different starting
// defaults, but everything here can also be changed in the dialog each time the script runs.
const CONFIG = {
    // "circle" | "ellipse" | "square" | "diamond" | "line".
    SHAPE: 'circle',

    // Lines per inch, 1..300 - how fine the dot grid is.
    FREQUENCY: 20,

    // Degrees. In "cmyk" mode, this is the black screen's angle; cyan, magenta and yellow sit at
    // their own classic offsets from it.
    ANGLE: 45,

    // "mono" (one screen, in CONFIG.COLOR) or "cmyk" (four screens, one per process ink, read
    // from the art's own colour-managed separation).
    MODE: 'mono',

    // "mono" mode's dot colour, as a #rrggbb hex string. Ignored in "cmyk" mode, and when
    // CONFIG.FROM_ART is on.
    COLOR: '#000000',

    // "mono" mode only: each dot takes the art's own colour under it instead of CONFIG.COLOR.
    FROM_ART: false,

    // Dots for light tones instead of dark ones.
    INVERT: false,

    // Keep the original object too, instead of replacing it with the dots.
    KEEP_ORIGINAL: false,
};

// Most halftone cells per screen - the same cap VectorCraft's own tool uses.
const MAX_CELLS = 100000;
// Most pixels the tone is sampled from.
const MAX_SAMPLE_PIXELS = 16.0e6;
// Cells lighter than this get no dot at all.
const MIN_TONE = 0.01;
// Levels per channel CONFIG.FROM_ART's sampled colours are rounded to (one path per colour).
const COLOR_LEVELS = 15;

const { CompoundCommandBuilder, DocumentCommand, AddChildNodesCommandBuilder } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');
const { Rectangle, Transform, Curve, PolyCurve } = require('/geometry.js');
const { PolyCurveNodeDefinition } = require('/nodes.js');
const { FillDescriptor } = require('/fills.js');
const { RGBA8, CMYKf } = require('/colours.js');
const { NodeRenderingEngine, NodeRenderingEngineOptions, RasterFormat } = require('/rasterobject.js');
const { PixelReaderRGBA8, PixelReaderCMYKA8 } = require('/pixelaccessor.js');

// ============================================================
// SMALL HELPERS
// ============================================================

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function parseHexColor(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) return RGBA8(0, 0, 0);
    const n = parseInt(m[1], 16);
    return RGBA8((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

// ============================================================
// DIALOG
// ============================================================

const SHAPE_KEYS = ['circle', 'ellipse', 'square', 'diamond', 'line'];
const SHAPE_LABELS = ['Circle', 'Ellipse', 'Square', 'Diamond', 'Line'];
const MODE_KEYS = ['mono', 'cmyk'];
const MODE_LABELS = ['Mono (one screen)', 'CMYK (four screens)'];

// Builds the settings dialog pre-filled from `defaults`, not yet run. `Dialog`/`UnitType` are
// passed in rather than required at module scope, so the live selection (captured in main() before
// this is called) can't be cleared by loading '/dialog.js' too early - see modern-js.md 2.1 in the
// affinity-scripts-toolkit.
function buildDialog(Dialog, UnitType, defaults) {
    const dlg = Dialog.create('Vector Halftone');
    const col = dlg.addColumn();
    const grp = col.addGroup('Settings');

    const shapeIndex = Math.max(0, SHAPE_KEYS.indexOf(defaults.shape));
    dlg.shapeBox = grp.addComboBox('Dot shape', SHAPE_LABELS, shapeIndex);
    // No popup slider: confirmed directly by the user that dragging one doesn't fire the live-
    // preview handler at all, even though typing a value does - plain editors are used here so
    // the live preview actually works, at the cost of the slider's drag affordance. Without a
    // slider to drag, every change is really a discrete, committed edit - the transient-based
    // throttling below still applies in case that ever isn't true, but in practice every change
    // now likely runs the full (expensive) preview rather than the cheap estimate.
    dlg.frequencyEditor = grp.addUnitValueEditor('Frequency (lines per inch)', UnitType.Number, UnitType.Number, defaults.frequency, 1, 300);
    dlg.angleEditor = grp.addUnitValueEditor('Angle (degrees)', UnitType.Degree, UnitType.Degree, defaults.angleDeg);
    const modeIndex = Math.max(0, MODE_KEYS.indexOf(defaults.mode));
    dlg.modeBox = grp.addComboBox('Mode', MODE_LABELS, modeIndex);
    dlg.colorPicker = grp.addColourPicker('Dot colour (Mono mode only, ignored if "from art" is on)', defaults.color);
    dlg.fromArtBox = grp.addCheckBox('Mono mode: take each dot\'s colour from the art underneath', defaults.fromArt);
    dlg.invertBox = grp.addCheckBox('Invert (dots for light tones instead of dark)', defaults.invert);
    dlg.keepOriginalBox = grp.addCheckBox('Keep the original object', defaults.keepOriginal);
    // Live-updated from main() - see the note there on why this is a cheap status line rather
    // than a full geometry preview while a slider is actively being dragged.
    dlg.status = grp.addStaticText(' ', ' ').setIsFullWidth(true);

    return dlg;
}

// The dialog's current control values, as a plain cfg object.
function readOptions(dlg, defaultColor) {
    return {
        shape: SHAPE_KEYS[dlg.shapeBox.selectedIndex],
        frequency: dlg.frequencyEditor.value,
        angleDeg: dlg.angleEditor.value,
        mode: MODE_KEYS[dlg.modeBox.selectedIndex],
        color: dlg.colorPicker.value || defaultColor,
        fromArt: dlg.fromArtBox.value,
        invert: dlg.invertBox.value,
        keepOriginal: dlg.keepOriginalBox.value,
    };
}

// ============================================================
// SAMPLING PLAN
// ============================================================

// Where the art is sampled from and at how many pixels per point - about four per cell, at most
// MAX_SAMPLE_PIXELS - or null when the area has no size or the turned grid would need more than
// MAX_CELLS cells (the frequency is too fine for an object this large).
function planSampling(bounds, cell) {
    if (!(bounds.width > 0 && bounds.height > 0)) return null;
    const area = bounds.width * bounds.height;
    if (!isFinite(area) || area <= 0) return null;
    const cellsEstimate = Math.pow(bounds.width + bounds.height, 2) / 2 / (cell * cell);
    if (cellsEstimate > MAX_CELLS) return null;
    let scale = Math.min(4.0 / cell, Math.sqrt(MAX_SAMPLE_PIXELS / area));
    scale = clamp(scale, 0.01, 16.0);
    const region = { x: bounds.x - cell, y: bounds.y - cell, width: bounds.width + 2 * cell, height: bounds.height + 2 * cell };
    return { region, scale };
}

// ============================================================
// READING THE ART
// ============================================================

// A function (px, py, channel) => tone (0..1) at document point (px, py). `channel` is 'mono' for
// the one mono screen, or 'c'/'m'/'y'/'k' for a cmyk screen. Outside the sampled region counts as
// no ink at all (pre-invert).
function makeToneSampler(region, scale, w, h, reader, mono, invert) {
    return function toneAt(px, py, channel) {
        const bx = Math.floor((px - region.x) * scale);
        const by = Math.floor((py - region.y) * scale);
        let t;
        if (bx < 0 || by < 0 || bx >= w || by >= h) {
            t = 0;
        } else {
            const p = reader.readPixel(bx, by);
            if (mono) {
                // The raw render is transparent (not pre-composited onto white) outside the art's
                // own filled area, so alpha is folded in by hand here, the same effect
                // VectorCraft's own "pixels drawn on white" sampling has.
                const a = p.alpha / 255;
                const r = p.r * a + 255 * (1 - a);
                const g = p.g * a + 255 * (1 - a);
                const b = p.b * a + 255 * (1 - a);
                t = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            } else {
                t = p[channel] / 255;
            }
        }
        return invert ? 1 - t : t;
    };
}

// The mean tone over a cell centred at (cx, cy), turned by (cosA, sinA) - a 3x3 grid of samples,
// the same averaging VectorCraft's own sampling uses.
function cellTone(toneAt, cx, cy, cell, cosA, sinA, channel) {
    let sum = 0;
    for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
            const lx = (kx * cell) / 3, ly = (ky * cell) / 3;
            const px = cx + lx * cosA - ly * sinA;
            const py = cy + lx * sinA + ly * cosA;
            sum += toneAt(px, py, channel);
        }
    }
    return sum / 9;
}

// The mean RGB colour over a cell (as cellTone, but the art's own colour, white outside it),
// rounded to COLOR_LEVELS steps per channel - CONFIG.FROM_ART's one path per colour.
function cellColor(region, scale, w, h, reader, cx, cy, cell, cosA, sinA) {
    let r = 0, g = 0, b = 0;
    for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
            const lx = (kx * cell) / 3, ly = (ky * cell) / 3;
            const px = cx + lx * cosA - ly * sinA;
            const py = cy + lx * sinA + ly * cosA;
            const bx = Math.floor((px - region.x) * scale);
            const by = Math.floor((py - region.y) * scale);
            if (bx < 0 || by < 0 || bx >= w || by >= h) {
                r += 255; g += 255; b += 255;
                continue;
            }
            const p = reader.readPixel(bx, by);
            const a = p.alpha / 255;
            r += p.r * a + 255 * (1 - a);
            g += p.g * a + 255 * (1 - a);
            b += p.b * a + 255 * (1 - a);
        }
    }
    const round = v => Math.round((v / 9 / 255) * COLOR_LEVELS) * (255 / COLOR_LEVELS);
    return { r: Math.round(round(r)), g: Math.round(round(g)), b: Math.round(round(b)) };
}

// ============================================================
// DOT SHAPES
// ============================================================

// The dot shape for tone `t` (0..1) in a cell of side `cell`, centred on the origin - the screen
// itself is turned afterwards, by rotating and translating the whole curve into place.
function dotCurve(shape, t, cell) {
    switch (shape) {
        case 'circle': {
            const r = cell * Math.sqrt(t / Math.PI);
            return Curve.createEllipse(new Rectangle(-r, -r, 2 * r, 2 * r));
        }
        case 'ellipse': {
            const r = cell * Math.sqrt(t / Math.PI);
            const rw = 1.3 * r, rh = r / 1.3;
            return Curve.createEllipse(new Rectangle(-rw, -rh, 2 * rw, 2 * rh));
        }
        case 'square': {
            const side = cell * Math.sqrt(t);
            return Curve.createRectangle(new Rectangle(-side / 2, -side / 2, side, side));
        }
        case 'diamond': {
            const side = cell * Math.sqrt(t);
            return Curve.createDiamond(new Rectangle(-side / 2, -side / 2, side, side));
        }
        default: { // 'line': cells along a row join into a line as thick as the tone.
            const h = cell * t;
            const w = cell * 1.001;
            return Curve.createRectangle(new Rectangle(-w / 2, -h / 2, w, h));
        }
    }
}

// ============================================================
// ONE SCREEN'S DOTS
// ============================================================

// The dots of one screen over `bounds`: every curve (CONFIG.FROM_ART off), or every curve grouped
// by its own sampled colour (CONFIG.FROM_ART on) via `colorAt(cx, cy, cosA, sinA)`.
function screenDots(toneAt, bounds, cell, screen, shape, fromArt, colorAt) {
    const angleRad = (screen.angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

    // The grid turned by the screen angle covers the bounds - find that range in screen space.
    const corners = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
    ];
    let lo = { x: Infinity, y: Infinity }, hi = { x: -Infinity, y: -Infinity };
    for (const c of corners) {
        const qx = c.x * cosA + c.y * sinA;
        const qy = -c.x * sinA + c.y * cosA;
        lo.x = Math.min(lo.x, qx); lo.y = Math.min(lo.y, qy);
        hi.x = Math.max(hi.x, qx); hi.y = Math.max(hi.y, qy);
    }
    const i0 = Math.floor(lo.x / cell) - 1, i1 = Math.ceil(hi.x / cell) + 1;
    const j0 = Math.floor(lo.y / cell) - 1, j1 = Math.ceil(hi.y / cell) + 1;
    const nx0 = bounds.x - cell, ny0 = bounds.y - cell;
    const nx1 = bounds.x + bounds.width + cell, ny1 = bounds.y + bounds.height + cell;

    const curves = [];
    const byColor = new Map();
    let count = 0;

    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const sx = (i + 0.5) * cell, sy = (j + 0.5) * cell;
            const cx = sx * cosA - sy * sinA;
            const cy = sx * sinA + sy * cosA;
            if (cx < nx0 || cx > nx1 || cy < ny0 || cy > ny1) continue;

            const t = clamp(cellTone(toneAt, cx, cy, cell, cosA, sinA, screen.channel), 0, 1);
            if (t < MIN_TONE) continue;
            count++;

            const curve = dotCurve(shape, t, cell);
            curve.transform(Transform.createTranslate(cx, cy).multiply(Transform.createRotate(angleRad)));

            if (fromArt) {
                const c = colorAt(cx, cy, cosA, sinA);
                const key = c.r + ',' + c.g + ',' + c.b;
                let entry = byColor.get(key);
                if (!entry) {
                    entry = { color: RGBA8(c.r, c.g, c.b), curves: [] };
                    byColor.set(key, entry);
                }
                entry.curves.push(curve);
            } else {
                curves.push(curve);
            }
        }
    }
    return { curves, byColor, count };
}

// Does the actual rendering + sampling + curve-building work for `cfg` against `node`/`bounds`,
// without executing anything. Returns { cmd, totalDots, layerCount, reason } - cmd is null if
// nothing would be drawn; `reason` is 'noArea', 'tooMany', 'noDots' or null. This is the expensive
// part (NodeRenderingEngine render + per-cell pixel sampling) - see main()'s note on why it's only
// called on a committed change, not on every tick of a slider drag.
function buildHalftoneCommand(doc, node, bounds, cfg) {
    const shape = cfg.shape;
    const frequency = clamp(cfg.frequency, 1, 300);
    const cell = 72 / frequency;
    const angleDeg = cfg.angleDeg;
    const mono = cfg.mode !== 'cmyk';
    const invert = cfg.invert;
    const fromArt = mono && cfg.fromArt;
    const monoColor = cfg.color;

    const plan = planSampling(bounds, cell);
    if (!plan) return { cmd: null, totalDots: 0, layerCount: 0, reason: 'tooMany' };

    const format = mono ? RasterFormat.RGBA8 : RasterFormat.CMYKA8;
    const options = NodeRenderingEngineOptions.create();
    options.scale = plan.scale;
    options.sourceRect = plan.region;
    const engine = NodeRenderingEngine.create(node, format, options);
    const bitmap = engine.createCompatibleBitmap(true);
    const reader = mono ? PixelReaderRGBA8.create(bitmap) : PixelReaderCMYKA8.create(bitmap);
    const toneAt = makeToneSampler(plan.region, plan.scale, bitmap.width, bitmap.height, reader, mono, invert);
    const colorAt = fromArt
        ? (cx, cy) => cellColor(plan.region, plan.scale, bitmap.width, bitmap.height, reader, cx, cy, cell, Math.cos((angleDeg * Math.PI) / 180), Math.sin((angleDeg * Math.PI) / 180))
        : null;

    // Bottom to top: yellow, magenta, cyan, black - the same order and classic offsets
    // VectorCraft's own tool uses.
    const screens = mono
        ? [{ color: monoColor, angleDeg, channel: 'mono' }]
        : [
            { color: CMYKf(0, 0, 1, 0), angleDeg: angleDeg - 45, channel: 'y' },
            { color: CMYKf(0, 1, 0, 0), angleDeg: angleDeg + 30, channel: 'm' },
            { color: CMYKf(1, 0, 0, 0), angleDeg: angleDeg - 30, channel: 'c' },
            { color: CMYKf(0, 0, 0, 1), angleDeg, channel: 'k' },
        ];

    const layers = [];
    let totalDots = 0;
    for (const screen of screens) {
        const result = screenDots(toneAt, bounds, cell, screen, shape, fromArt, colorAt);
        totalDots += result.count;
        if (fromArt) {
            for (const entry of result.byColor.values()) layers.push(entry);
        } else if (result.curves.length > 0) {
            layers.push({ color: screen.color, curves: result.curves });
        }
    }
    reader.dispose();

    if (totalDots === 0) return { cmd: null, totalDots: 0, layerCount: 0, reason: 'noDots' };

    const addBuilder = AddChildNodesCommandBuilder.create();
    for (const layer of layers) {
        const poly = PolyCurve.create();
        for (const curve of layer.curves) poly.addCurve(curve);
        addBuilder.addNode(PolyCurveNodeDefinition.create(poly, FillDescriptor.createSolid(layer.color)));
    }
    const addCmd = addBuilder.createCommand(false);

    const compound = CompoundCommandBuilder.create();
    compound.addCommand(addCmd);
    if (!cfg.keepOriginal) {
        compound.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, [node])));
    }
    return { cmd: compound.createCommand(), totalDots, layerCount: layers.length, reason: null };
}

// A cheap (no rendering) estimate of how many cells the current frequency/angle would produce -
// just the same grid math planSampling already does, used for the status line while a slider is
// actively being dragged, see main()'s note.
function cheapCellEstimate(bounds, cfg) {
    const cell = 72 / clamp(cfg.frequency, 1, 300);
    const cellsEstimate = Math.pow(bounds.width + bounds.height, 2) / 2 / (cell * cell);
    if (cellsEstimate > MAX_CELLS) return 'Too many dots for this size - lower the frequency.';
    return '~' + Math.round(cellsEstimate) + ' cell' + (Math.round(cellsEstimate) === 1 ? '' : 's') +
        ' at this frequency (release the slider to preview the actual dots).';
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const selected = doc.selection.nodes.toArray();
    if (selected.length !== 1) {
        alert('Select exactly one object first - a group counts as one object, so group ' +
            'several objects together first if you need to.');
        return;
    }
    const node = selected[0];
    const bounds = node.getExactSpreadVisibleBox(true, false);
    if (!(bounds.width > 0 && bounds.height > 0)) {
        alert('The selection has no area.');
        return;
    }

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const defaultColor = parseHexColor(CONFIG.COLOR);
    const dlg = buildDialog(Dialog, UnitType, {
        shape: SHAPE_KEYS.includes(CONFIG.SHAPE) ? CONFIG.SHAPE : SHAPE_KEYS[0],
        frequency: clamp(Number(CONFIG.FREQUENCY) || 20, 1, 300),
        angleDeg: isFinite(CONFIG.ANGLE) ? Number(CONFIG.ANGLE) : 45,
        mode: MODE_KEYS.includes(CONFIG.MODE) ? CONFIG.MODE : MODE_KEYS[0],
        color: defaultColor,
        fromArt: !!CONFIG.FROM_ART,
        invert: !!CONFIG.INVERT,
        keepOriginal: !!CONFIG.KEEP_ORIGINAL,
    });

    // The full render-and-sample pass is too expensive to run on every tick of a slider drag (it
    // can involve thousands of cells, each sampled from a real rendered bitmap) - it only runs on
    // a committed change (transient === false: a slider release, or any discrete control like a
    // combo box or checkbox, which only ever report a single committed change). While a slider is
    // actively being dragged (transient === true), only the cheap grid-math estimate updates, and
    // the canvas keeps showing the last committed preview rather than flickering.
    let last = { cmd: null, totalDots: 0, layerCount: 0, reason: null };
    const update = (preview) => {
        const cfg = readOptions(dlg, defaultColor);
        last = buildHalftoneCommand(doc, node, bounds, cfg);
        if (last.cmd) doc.executeCommand(last.cmd, preview);
        else doc.clearPreviews();
        dlg.status.text = last.reason === 'tooMany'
            ? 'Too many dots for this size - lower the frequency and try again.'
            : last.reason === 'noDots'
                ? 'No dots - the tone is below the minimum everywhere.'
                : 'Would draw ' + last.totalDots + ' dot' + (last.totalDots === 1 ? '' : 's') +
                    ' across ' + last.layerCount + ' layer' + (last.layerCount === 1 ? '' : 's') + '.';
        return last;
    };

    dlg.onControlValueChangedHandler = (transient) => {
        if (transient) {
            dlg.status.text = cheapCellEstimate(bounds, readOptions(dlg, defaultColor));
        } else {
            update(true);
        }
    };
    update(true);

    if (dlg.runModal() === DialogResult.Ok) {
        const result = update(false);
        if (result.reason === 'tooMany') {
            alert('Too many dots for this size - lower the frequency and try again.');
        } else if (result.reason === 'noDots') {
            alert('No dots - the tone is below the minimum everywhere. Try turning Invert on, or ' +
                'check the dot colour and mode.');
        } else {
            try {
                // The sub-command's own newNodes isn't readable after running inside a compound -
                // confirmed live - but the compound command's own newNodes is.
                const newNodes = result.cmd.newNodes;
                if (newNodes && newNodes.length > 0) doc.selection = Selection.create(doc, newNodes);
            } catch (error) { /* selecting the result is a nicety, not essential */ }
            alert('Drew ' + result.totalDots + ' dot' + (result.totalDots === 1 ? '' : 's') + ' across ' +
                result.layerCount + ' layer' + (result.layerCount === 1 ? '' : 's') + '.');
        }
    }
    doc.clearPreviews();
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
