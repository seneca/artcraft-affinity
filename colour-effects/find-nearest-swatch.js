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
Script Name:    find-nearest-swatch.js
Description:    Adapted port of VectorCraft's Colour Effects > Find Nearest Swatch. VectorCraft's
                 own tool matches a colour against the document's named Swatches panel - the
                 Affinity scripting SDK has no API at all to read that panel (confirmed directly:
                 searched SDK hints and every documented module; colours.js only exposes raw
                 Colour values, with no concept of a named swatch or a swatch library). This finds
                 the closest colours actually PAINTED somewhere in CONFIG.PALETTE_SCOPE instead -
                 the selection's own distinct colours, matched against every distinct colour used
                 there - and reports them; it changes nothing.

                 Closeness is CIEDE2000 (ΔE), the same metric VectorCraft's own tool uses,
                 implemented directly here (the standard Sharma/Wu/Dalal 2005 formula) and
                 verified against eight of its own published reference test pairs. The Lab values
                 it runs on come from each Colour's own colour-managed `.laba16`, confirmed live:
                 Affinity's 16-bit L is 0..65535 for standard L* 0..100 (divide by 655.35), and its
                 a/b are already signed, scaled 257 per standard a*/b* unit (divide by 257) -
                 calibrated against known sRGB primaries' published Lab values.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See find-nearest-swatch.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // Where to gather the candidate colours to match against: 'document' (every colour painted
    // anywhere in the document) or 'selection' (only within the selected objects).
    PALETTE_SCOPE: 'document',

    // How many closest matches to report for each of the selection's own distinct colours, 1..50.
    COUNT: 5,

    // Which paints count, both for gathering the palette and for the selection's own colours.
    FILL: true,
    STROKE: true,
};

const { Document } = require('/document.js');

// ============================================================
// FINDING THE COLOURS
// ============================================================

// The same signal replace-missing-fonts.js uses for "is this a text object".
function hasStory(node) {
    try {
        return !!node.storyInterface;
    } catch (error) {
        return false;
    }
}

function collectNodes(roots) {
    const out = [];
    function visit(node) {
        out.push(node);
        if (node.children) {
            for (const child of node.children.toArray()) visit(child);
        }
    }
    for (const root of roots) visit(root);
    return out;
}

// Calls `note(colour)` for every colour a fill descriptor actually holds - its one solid colour,
// or every stop of a gradient.
function notedColours(desc, note) {
    const kind = desc.fillType.toString();
    if (kind === 'Solid') {
        note(desc.fill.colour);
    } else if (kind === 'Gradient') {
        for (const stop of desc.fill.gradient.stops) note(stop.colour);
    }
}

// Every distinct colour painted anywhere under `roots` - fills, strokes and (for text) each
// character run's own fill/stroke - deduplicated by its rendered RGB, in the order first seen.
function collectColours(roots, cfg) {
    const seen = new Map();
    const note = colour => {
        if (!colour) return;
        const rgb = colour.rgba8;
        const key = rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + rgb.alpha;
        if (!seen.has(key)) seen.set(key, colour);
    };

    for (const node of collectNodes(roots)) {
        if (cfg.fill) {
            try { notedColours(node.brushFillInterface.currentDescriptor, note); } catch (error) { /* no brush fill */ }
        }
        if (cfg.stroke) {
            try {
                const lsi = node.lineStyleInterface;
                if (lsi && lsi.lineType.toString() !== 'None') notedColours(lsi.getCurrentFillDescriptor(), note);
            } catch (error) { /* no stroke */ }
        }
        if (hasStory(node)) {
            try {
                const story = node.storyInterface.story;
                for (const run of story.attRuns) {
                    const atts = story.getGlyphAtts(run.begin);
                    if (cfg.fill) notedColours(atts.brushFill, note);
                    if (cfg.stroke) notedColours(atts.penFill, note);
                }
            } catch (error) { /* no text here */ }
        }
    }
    return [...seen.values()];
}

// ============================================================
// COLOUR DISTANCE (CIEDE2000)
// ============================================================

// Affinity's 16-bit Lab, converted to standard L*a*b* (L 0..100, a/b roughly -128..127).
function standardLab(colour) {
    const lab = colour.laba16;
    return { l: lab.l / 655.35, a: lab.a / 257, b: lab.b / 257 };
}

// The CIEDE2000 colour difference (Sharma, Wu & Dalal, 2005) between two standard Lab colours -
// verified against eight of the paper's own published reference pairs before use here.
function deltaE2000(lab1, lab2) {
    const avgLp = (lab1.l + lab2.l) / 2;
    const c1 = Math.sqrt(lab1.a * lab1.a + lab1.b * lab1.b);
    const c2 = Math.sqrt(lab2.a * lab2.a + lab2.b * lab2.b);
    const avgC = (c1 + c2) / 2;
    const g = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
    const a1p = lab1.a * (1 + g);
    const a2p = lab2.a * (1 + g);
    const c1p = Math.sqrt(a1p * a1p + lab1.b * lab1.b);
    const c2p = Math.sqrt(a2p * a2p + lab2.b * lab2.b);
    const avgCp = (c1p + c2p) / 2;

    let h1p = Math.atan2(lab1.b, a1p); if (h1p < 0) h1p += 2 * Math.PI;
    let h2p = Math.atan2(lab2.b, a2p); if (h2p < 0) h2p += 2 * Math.PI;

    let deltahp;
    if (c1p * c2p === 0) {
        deltahp = 0;
    } else {
        deltahp = h2p - h1p;
        if (deltahp > Math.PI) deltahp -= 2 * Math.PI;
        else if (deltahp < -Math.PI) deltahp += 2 * Math.PI;
    }
    const deltaLp = lab2.l - lab1.l;
    const deltaCp = c2p - c1p;
    const deltaHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(deltahp / 2);

    let avgHp;
    if (c1p * c2p === 0) {
        avgHp = h1p + h2p;
    } else {
        avgHp = (h1p + h2p) / 2;
        if (Math.abs(h1p - h2p) > Math.PI) avgHp += Math.PI;
    }
    if (avgHp < 0) avgHp += 2 * Math.PI;
    if (avgHp >= 2 * Math.PI) avgHp -= 2 * Math.PI;

    const t = 1 - 0.17 * Math.cos(avgHp - Math.PI / 6) + 0.24 * Math.cos(2 * avgHp) +
        0.32 * Math.cos(3 * avgHp + Math.PI / 30) - 0.20 * Math.cos(4 * avgHp - 63 * Math.PI / 180);
    const deltaTheta = (30 * Math.PI / 180) * Math.exp(-Math.pow((avgHp * 180 / Math.PI - 275) / 25, 2));
    const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
    const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
    const Sc = 1 + 0.045 * avgCp;
    const Sh = 1 + 0.015 * avgCp * t;
    const Rt = -Math.sin(2 * deltaTheta) * Rc;

    const term1 = deltaLp / Sl;
    const term2 = deltaCp / Sc;
    const term3 = deltaHp / Sh;
    return Math.sqrt(term1 * term1 + term2 * term2 + term3 * term3 + Rt * term2 * term3);
}

// ============================================================
// REPORTING
// ============================================================

function describeColour(colour) {
    const rgb = colour.rgba8;
    const hex = '#' + [rgb.r, rgb.g, rgb.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    if (colour.type.toString() === 'CMYK') {
        const c = colour.cmykf;
        return hex + ' (C' + Math.round(c.c * 100) + ' M' + Math.round(c.m * 100) + ' Y' +
            Math.round(c.y * 100) + ' K' + Math.round(c.k * 100) + ')';
    }
    return hex;
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const selected = doc.selection.nodes.toArray();
    if (selected.length === 0) {
        alert('Select one or more objects first - their own colours are what gets looked up.');
        return;
    }

    const cfg = { fill: CONFIG.FILL, stroke: CONFIG.STROKE };
    const count = Math.max(1, Math.min(50, Math.round(CONFIG.COUNT) || 5));

    const lookupColours = collectColours(selected, cfg);
    if (lookupColours.length === 0) {
        alert('The selection has no solid or gradient colours to look up.');
        return;
    }

    const paletteRoots = CONFIG.PALETTE_SCOPE === 'selection' ? selected : doc.spreads.toArray();
    const paletteColours = collectColours(paletteRoots, cfg)
        .map(colour => ({ colour, lab: standardLab(colour) }));
    if (paletteColours.length === 0) {
        alert('Nothing to match against - CONFIG.PALETTE_SCOPE finds no colours at all.');
        return;
    }

    const lines = [];
    lookupColours.forEach((colour, i) => {
        const lab = standardLab(colour);
        const matches = paletteColours
            .map(p => ({ colour: p.colour, deltaE: deltaE2000(lab, p.lab) }))
            .sort((a, b) => a.deltaE - b.deltaE)
            .slice(0, count);
        lines.push((i + 1) + '. ' + describeColour(colour));
        matches.forEach((m, j) => {
            lines.push('     ' + (j + 1) + '. ' + describeColour(m.colour) + '  ΔE ' + m.deltaE.toFixed(2));
        });
    });

    const report = lines.join('\n');
    console.log(report);
    alert(lookupColours.length + ' colour' + (lookupColours.length === 1 ? '' : 's') +
        ' in the selection, matched against ' + paletteColours.length + ' found in the ' +
        CONFIG.PALETTE_SCOPE + ':\n\n' + report);
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
