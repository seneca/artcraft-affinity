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
Script Name:    create-swatch-legend.js
Description:    Adapted port of VectorCraft's Colour Effects > Create Swatch Legend. VectorCraft's
                 own tool draws a chip per named swatch from the document's Swatches panel - the
                 Affinity scripting SDK has no API at all to read that panel (the same confirmed
                 gap find-nearest-swatch.js documents). This draws a chip per distinct colour
                 actually PAINTED somewhere in CONFIG.SCOPE instead - the whole document by
                 default, or just the selection - labelled with its own values, since there's no
                 swatch name to show.

                 Each chip is a plain filled rectangle, created with its own colour already set
                 via ShapeNodeDefinition.create's own brushFill parameter - confirmed live this
                 needs no separate recolour step afterward. Its label is a small Artistic Text
                 object built the same way break-into-words.js builds one, with its own GlyphAtts
                 coloured black or light text depending on the chip's own Lab lightness - the same
                 "light chips get dark text, dark chips get light text" idea VectorCraft's own
                 tool uses. The pieces are left ungrouped (grouping newly created nodes needs a
                 second, separate command once they actually exist, which this project's other
                 scripts avoid to keep everything inside a single undo step - the same reason the
                 SDK's own makeGrid.js example leaves its own grid cells ungrouped); they're all
                 selected when it finishes, ready for Ctrl/Cmd+G if you want them bundled.

                 Settings come from a dialog (Affinity's own Dialog API, /dialog.js) rather than a
                 CONFIG object you edit by hand - CONFIG below only supplies the values the dialog
                 opens with. The dialog live-previews the actual legend as you change any setting
                 (doc.executeCommand(cmd, true)/doc.clearPreviews(), the same mechanism
                 arrange-in-grid.js uses) - confirmed directly via this project's own test tool
                 that a plain add-nodes command (no delete/reorder/duplicate) reverts cleanly from
                 a preview, and that a second preview always replaces the first rather than
                 stacking on it, so rebuilding the whole legend from scratch on every change is
                 safe. Note for future maintenance: the dialog UI itself still can't be driven by
                 that same test tool (it only runs in the native Scripts panel), so its controls
                 and wiring were checked carefully against /dialog.js and ts/ui.d.ts but not
                 exercised live - test it for real before relying on it.

Author:         Les Pruszynski (Middledot)
Version:        1.2.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See create-swatch-legend.md for the full guide.

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
    // Which colours to show: 'document' (every colour painted anywhere) or 'selection' (only
    // within the selected objects).
    SCOPE: 'document',

    // Which paints count.
    FILL: true,
    STROKE: true,

    // Layout, in points.
    COLUMNS: 4,
    CHIP_SIZE: 72,
    GAP: 12,

    // Labels each chip with its own colour values (hex, and CMYK too in a CMYK document).
    SHOW_VALUES: true,
    LABEL_SIZE: 9,

    // The legend's top-left corner, in the current spread's own space. null insets it by GAP
    // from the spread's own top-left corner.
    X: null,
    Y: null,
};

// Most chips one legend draws - the same cap VectorCraft's own tool uses.
const MAX_CHIPS = 2000;

const { AddChildNodesCommandBuilder } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');
const { RGBA8 } = require('/colours.js');
const { FillDescriptor } = require('/fills.js');
const { Rectangle } = require('/geometry.js');
const { ShapeNodeDefinition, ArtTextNodeDefinition } = require('/nodes.js');
const { ShapeRectangle } = require('/shapes.js');
const { StoryBuilder } = require('/storybuilder.js');

// ============================================================
// DIALOG
// ============================================================

const SCOPE_KEYS = ['document', 'selection'];
const SCOPE_LABELS = ['Whole document', 'Selection only'];

// Builds the settings dialog pre-filled from `defaults`, not yet run. `Dialog`/`UnitType` are
// passed in rather than required at module scope, so the live selection (captured in main() before
// this is called) can't be cleared by loading '/dialog.js' too early - see modern-js.md 2.1 in the
// affinity-scripts-toolkit.
function buildDialog(Dialog, UnitType, defaults) {
    const dlg = Dialog.create('Create Swatch Legend');
    const col = dlg.addColumn();
    const grp = col.addGroup('Settings');

    const scopeIndex = Math.max(0, SCOPE_KEYS.indexOf(defaults.scope));
    dlg.scopeBox = grp.addComboBox('Colours to show', SCOPE_LABELS, scopeIndex);
    dlg.fillBox = grp.addCheckBox('Include fill colours', defaults.fill);
    dlg.strokeBox = grp.addCheckBox('Include stroke colours', defaults.stroke);
    dlg.columnsEditor = grp.addUnitValueEditor('Columns', UnitType.Number, UnitType.Number, defaults.columns, 1, 50);
    dlg.chipSizeEditor = grp.addUnitValueEditor('Chip size (pt)', UnitType.Number, UnitType.Number, defaults.chipSize, 1, null);
    dlg.gapEditor = grp.addUnitValueEditor('Gap (pt)', UnitType.Number, UnitType.Number, defaults.gap, 0, null);
    dlg.showValuesBox = grp.addCheckBox('Label each chip with its colour values', defaults.showValues);
    dlg.labelSizeEditor = grp.addUnitValueEditor('Label size (pt)', UnitType.Number, UnitType.Number, defaults.labelSize, 1, null);
    dlg.autoPositionBox = grp.addCheckBox('Position automatically (inset from the corner)', defaults.autoPosition);
    dlg.xEditor = grp.addUnitValueEditor('X (if not automatic)', UnitType.Number, UnitType.Number, defaults.x);
    dlg.yEditor = grp.addUnitValueEditor('Y (if not automatic)', UnitType.Number, UnitType.Number, defaults.y);

    return dlg;
}

// The dialog's current control values, as a plain cfg object.
function readOptions(dlg) {
    return {
        scope: SCOPE_KEYS[dlg.scopeBox.selectedIndex],
        fill: dlg.fillBox.value,
        stroke: dlg.strokeBox.value,
        columns: dlg.columnsEditor.value,
        chipSize: dlg.chipSizeEditor.value,
        gap: dlg.gapEditor.value,
        showValues: dlg.showValuesBox.value,
        labelSize: dlg.labelSizeEditor.value,
        x: dlg.autoPositionBox.value ? null : dlg.xEditor.value,
        y: dlg.autoPositionBox.value ? null : dlg.yEditor.value,
    };
}

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
// DESCRIBING A COLOUR
// ============================================================

// Affinity's 16-bit Lab, converted to standard L* (0..100) - just enough to pick a readable
// label colour, the same calibration find-nearest-swatch.js uses in full.
function labLightness(colour) {
    return colour.laba16.l / 655.35;
}

function describeColour(colour) {
    const rgb = colour.rgba8;
    const hex = '#' + [rgb.r, rgb.g, rgb.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    if (colour.type.toString() === 'CMYK') {
        const c = colour.cmykf;
        // A forced line break within one Artistic Text object is U+2028, not "\n" - the same
        // convention split-text-at-cursor.js and break-into-paragraphs.js rely on.
        return hex + '\u2028C' + Math.round(c.c * 100) + ' M' + Math.round(c.m * 100) + ' Y' +
            Math.round(c.y * 100) + ' K' + Math.round(c.k * 100);
    }
    return hex;
}

// ============================================================
// BUILDING THE PIECES
// ============================================================

function buildChipDefinition(rect, colour) {
    return ShapeNodeDefinition.create(ShapeRectangle.create(), rect, colour);
}

function buildLabelDefinition(doc, text, x, y, textColour, labelSize) {
    const sb = StoryBuilder.create();
    sb.setToArtisticTextDefaultStyle(doc.dpi, doc.rasterFormat);
    const atts = sb.glyphAtts.clone();
    atts.height = labelSize;
    atts.brushFill = FillDescriptor.createSolid(textColour);
    sb.setGlyphAtts(atts);
    sb.addText(text);
    return ArtTextNodeDefinition.createFromStoryBuilder({ x, y }, sb);
}

// Builds the full add-nodes command for `cfg` over `selected`/`doc`, without executing it. Returns
// { cmd, count, reason } - cmd is null if nothing would be created; `reason` is 'noSelection'
// ("Selection only" with nothing selected), 'noColours' (nothing paintable was found) or null.
// This is called on every live-preview tick, not just once on OK, so it never alerts itself.
function buildLegendCommand(doc, selected, cfg) {
    if (cfg.scope === 'selection' && selected.length === 0) {
        return { cmd: null, count: 0, reason: 'noSelection' };
    }
    const roots = cfg.scope === 'selection' ? selected : doc.spreads.toArray();
    const colours = collectColours(roots, cfg).slice(0, MAX_CHIPS);
    if (colours.length === 0) {
        return { cmd: null, count: 0, reason: 'noColours' };
    }

    const cols = Math.max(1, Math.round(cfg.columns));
    const size = cfg.chipSize;
    const gap = cfg.gap;
    const originX = cfg.x != null ? cfg.x : gap;
    const originY = cfg.y != null ? cfg.y : gap;
    const black = RGBA8(0, 0, 0);
    const white = RGBA8(255, 255, 255);

    const builder = AddChildNodesCommandBuilder.create();
    colours.forEach((colour, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = originX + col * (size + gap);
        const y = originY + row * (size + gap);
        builder.addNode(buildChipDefinition(new Rectangle(x, y, size, size), colour));
        if (cfg.showValues) {
            const textColour = labLightness(colour) > 50 ? black : white;
            builder.addNode(buildLabelDefinition(doc, describeColour(colour), x + 4, y + size - 8, textColour, cfg.labelSize));
        }
    });

    return { cmd: builder.createCommand(false), count: colours.length, reason: null };
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const selected = doc.selection.nodes.toArray();

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const dlg = buildDialog(Dialog, UnitType, {
        scope: SCOPE_KEYS.includes(CONFIG.SCOPE) ? CONFIG.SCOPE : SCOPE_KEYS[0],
        fill: CONFIG.FILL !== false,
        stroke: CONFIG.STROKE !== false,
        columns: Math.max(1, Math.round(Number(CONFIG.COLUMNS)) || 4),
        chipSize: isFinite(Number(CONFIG.CHIP_SIZE)) ? Number(CONFIG.CHIP_SIZE) : 72,
        gap: isFinite(Number(CONFIG.GAP)) ? Number(CONFIG.GAP) : 12,
        showValues: CONFIG.SHOW_VALUES !== false,
        labelSize: isFinite(Number(CONFIG.LABEL_SIZE)) ? Number(CONFIG.LABEL_SIZE) : 9,
        autoPosition: CONFIG.X == null && CONFIG.Y == null,
        x: CONFIG.X != null ? Number(CONFIG.X) : 0,
        y: CONFIG.Y != null ? Number(CONFIG.Y) : 0,
    });

    let last = { cmd: null, count: 0, reason: null };
    const update = (preview) => {
        last = buildLegendCommand(doc, selected, readOptions(dlg));
        if (last.cmd) doc.executeCommand(last.cmd, preview);
        else doc.clearPreviews();
        return last;
    };

    dlg.onControlValueChangedHandler = () => update(true);
    update(true);

    if (dlg.runModal() === DialogResult.Ok) {
        const result = update(false);
        if (result.reason === 'noSelection') {
            alert('Nothing is selected - select some objects first, or choose "Whole document" in the dialog.');
        } else if (result.reason === 'noColours') {
            alert('No solid or gradient colours were found.');
        } else {
            const newNodes = result.cmd.newNodes;
            if (newNodes.length > 0) doc.selection = Selection.create(doc, newNodes);
            alert('Created a legend of ' + result.count + ' colour' + (result.count === 1 ? '' : 's') + '.');
        }
    }
    doc.clearPreviews();
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
