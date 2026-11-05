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
Script Name:    print-ink-fixes.js
Description:    Port of VectorCraft's Colour Effects > Print Ink Fixes. Prepares a CMYK
                 document's inks for print, as one undo step: solid and gradient-stop CMYK
                 colours with more total ink than CONFIG.INK_LIMIT are scaled down to it (pure
                 black ink - no cyan, magenta or yellow - is left alone unless
                 CONFIG.EXCLUDE_PURE_BLACK is turned off), white fills/strokes can have their
                 overprint turned off, and black-ink fills/strokes at or past
                 CONFIG.OVERPRINT_BLACK can have theirs turned on, the same as Affinity's own
                 Edit Colors > Overprint Black. Refused outside a CMYK document, the same as
                 VectorCraft's own tool.

                 Each gradient stop is checked and fixed on its own, since in Affinity (unlike
                 VectorCraft) overprint lives on each Colour value itself - confirmed directly -
                 rather than once per whole gradient.

                 Fill and stroke colours are read and written through each node's own
                 brushFillInterface/lineStyleInterface, confirmed live: a solid fill's CMYK values
                 and overprint flag round-trip correctly through createSetBrushFill, and a
                 gradient's own stops can be rebuilt and swapped in via
                 GradientFill.cloneWithNewGradient + FillDescriptor.cloneWithNewFill without
                 disturbing its transform or blend mode. Setting a stroke's fill while its line
                 type is None flips it to Solid as a side effect - confirmed directly - so strokes
                 are only ever touched when a node already has a real line type.

                 A text object's own node-level fill/stroke (its frame's background, if it has
                 one) is only ever its container - the characters' own ink is a separate, per-run
                 colour read and written through GlyphAtts.brushFill/penFill and StoryDelta, the
                 same mechanism replace-missing-fonts.js uses for a run's font.

                 Settings come from a dialog (Affinity's own Dialog API, /dialog.js) rather than a
                 CONFIG object you edit by hand - CONFIG below only supplies the values the dialog
                 opens with. The dialog live-previews every fix on the real artwork as you change
                 any setting (doc.executeCommand(cmd, true)/doc.clearPreviews(), the same mechanism
                 arrange-in-grid.js uses) - safe to recompute from scratch on every change since a
                 second preview always replaces the first rather than stacking on it, confirmed
                 directly via this project's own test tool. Note for future maintenance: the dialog
                 UI itself still can't be driven by that same test tool (it only runs in the native
                 Scripts panel), so its controls and wiring were checked carefully against
                 /dialog.js and ts/ui.d.ts but not exercised live - test it for real before relying
                 on it.

Author:         Les Pruszynski (Middledot)
Version:        1.2.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See print-ink-fixes.md for the full guide.

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
    // Which objects to fix: 'auto' (the selection if anything is selected, else the whole
    // document), 'document' (always every page) or 'selection' (always just the selection).
    SCOPE: 'auto',

    // Total CMYK ink, 0..400 (percent of C+M+Y+K combined) - any solid or gradient-stop colour
    // over this is scaled down to it. 0 turns ink limiting off.
    INK_LIMIT: 0,

    // A colour made of black ink only (no cyan, magenta or yellow) keeps its ink regardless of
    // INK_LIMIT - true to leave pure blacks and greys alone, false to limit them too.
    EXCLUDE_PURE_BLACK: true,

    // Turns off overprint on any white fill or stroke. false leaves overprint as it is.
    REMOVE_WHITE_OVERPRINT: false,

    // Black ink of at least this percentage (0..100) turns overprint ON for that fill or stroke,
    // the same as Affinity's own Edit Colors > Overprint Black. 0 turns this off.
    OVERPRINT_BLACK: 0,

    // When true, OVERPRINT_BLACK above only touches text objects, not shape fills/strokes.
    TEXT_ONLY: false,

    // Which paints to fix.
    FILL: true,
    STROKE: true,
};

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const { CMYKAf, Gradient, ColourStop } = require('/colours.js');
const { SolidFill } = require('/fills.js');
const { StoryDelta } = require('/storydelta.js');

// ============================================================
// DIALOG
// ============================================================

const SCOPE_KEYS = ['auto', 'document', 'selection'];
const SCOPE_LABELS = ['Automatic (selection if any, else whole document)', 'Whole document', 'Selection only'];

// Builds the settings dialog pre-filled from `defaults`, not yet run. `Dialog`/`UnitType` are
// passed in rather than required at module scope, so the live selection (captured in main() before
// this is called) can't be cleared by loading '/dialog.js' too early - see modern-js.md 2.1 in the
// affinity-scripts-toolkit.
function buildDialog(Dialog, UnitType, defaults) {
    const dlg = Dialog.create('Print Ink Fixes');
    const col = dlg.addColumn();
    const grp = col.addGroup('Settings');

    const scopeIndex = Math.max(0, SCOPE_KEYS.indexOf(defaults.scope));
    dlg.scopeBox = grp.addComboBox('Scope', SCOPE_LABELS, scopeIndex);
    dlg.inkLimitEditor = grp.addUnitValueEditor('Ink limit, % (0 = off)', UnitType.Percentage, UnitType.Percentage, defaults.inkLimitPercent, 0, 400).setShowPopupSlider(true);
    dlg.excludePureBlackBox = grp.addCheckBox('Leave pure blacks/greys at full ink', defaults.excludePureBlack);
    dlg.removeWhiteOverprintBox = grp.addCheckBox('Turn off overprint on white', defaults.removeWhiteOverprint);
    dlg.overprintBlackEditor = grp.addUnitValueEditor('Turn on overprint at this black ink %, (0 = off)', UnitType.Percentage, UnitType.Percentage, defaults.overprintBlackPercent, 0, 100).setShowPopupSlider(true);
    dlg.textOnlyBox = grp.addCheckBox('Limit the overprint-black fix to text only', defaults.textOnly);
    dlg.fillBox = grp.addCheckBox('Fix fill colours', defaults.fill);
    dlg.strokeBox = grp.addCheckBox('Fix stroke colours', defaults.stroke);

    return dlg;
}

// The dialog's current control values, as a plain cfg object.
function readOptions(dlg) {
    return {
        scope: SCOPE_KEYS[dlg.scopeBox.selectedIndex],
        inkLimit: dlg.inkLimitEditor.value / 100,
        excludePureBlack: dlg.excludePureBlackBox.value,
        removeWhiteOverprint: dlg.removeWhiteOverprintBox.value,
        overprintBlack: dlg.overprintBlackEditor.value / 100,
        textOnly: dlg.textOnlyBox.value,
        fill: dlg.fillBox.value,
        stroke: dlg.strokeBox.value,
    };
}

// ============================================================
// COLOUR MATH
// ============================================================

const E = 0.005;

// No cyan, magenta or yellow - black ink only.
function isPureBlackInk(cmyk) {
    return cmyk.c <= E && cmyk.m <= E && cmyk.y <= E;
}

function isWhite(cmyk) {
    return isPureBlackInk(cmyk) && cmyk.k <= E;
}

function isBlackInk(cmyk, minK) {
    return cmyk.k >= minK - E && isPureBlackInk(cmyk);
}

// `cmyk` with its total ink scaled down to `maxTotal`, or null if nothing needs to change.
function limitInk(cmyk, maxTotal, excludePureBlack) {
    const total = cmyk.c + cmyk.m + cmyk.y + cmyk.k;
    if (total <= maxTotal || !isFinite(total)) return null;
    if (excludePureBlack && isPureBlackInk(cmyk)) return null;
    const s = maxTotal / total;
    return { c: cmyk.c * s, m: cmyk.m * s, y: cmyk.y * s, k: cmyk.k * s };
}

// The fixed CMYK colour for a live `colour` object, or null if nothing changes - ink limiting,
// then white-overprint removal, then black overprint, each only if `cfg` asks for it. Non-CMYK
// colours (RGB, Lab, spot swatches resolving to something else) are left alone entirely, the same
// as VectorCraft's own tool only ever touching its Color::Cmyk case.
function fixedColour(colour, cfg) {
    if (colour.type.toString() !== 'CMYK') return null;
    let cmyk = colour.cmykf;
    let changed = false;

    if (cfg.inkLimit > 0) {
        const limited = limitInk(cmyk, cfg.inkLimit, cfg.excludePureBlack);
        if (limited) {
            cmyk = limited;
            changed = true;
        }
    }

    let overprint = colour.overprint;
    if (cfg.removeWhiteOverprint && overprint && isWhite(cmyk)) {
        overprint = false;
        changed = true;
    }
    if (cfg.overprintBlack > 0 && !overprint && isBlackInk(cmyk, cfg.overprintBlack)) {
        overprint = true;
        changed = true;
    }

    if (!changed) return null;
    const result = CMYKAf(cmyk.c, cmyk.m, cmyk.y, cmyk.k, cmyk.alpha);
    result.overprint = overprint;
    return result;
}

// ============================================================
// FIXING ONE FILL DESCRIPTOR
// ============================================================

// `desc` (a solid colour, or a gradient) with every colour it holds fixed, or null if nothing
// needs to change. Its transform and blend mode are kept exactly as they were.
function fixedFillDescriptor(desc, cfg) {
    const kind = desc.fillType.toString();

    if (kind === 'Solid') {
        const fixed = fixedColour(desc.fill.colour, cfg);
        return fixed ? desc.cloneWithNewFill(SolidFill.create(fixed)) : null;
    }

    if (kind === 'Gradient') {
        const stops = desc.fill.gradient.stops;
        let any = false;
        const newStops = stops.map(stop => {
            const fixed = fixedColour(stop.colour, cfg);
            if (fixed) any = true;
            return new ColourStop(fixed || stop.colour, stop.position, stop.midpoint, stop.smoothness);
        });
        if (!any) return null;
        return desc.cloneWithNewFill(desc.fill.cloneWithNewGradient(Gradient.create(newStops)));
    }

    // Bitmap, hatch, mesh and diffusion fills aren't touched - the same as VectorCraft's own tool
    // leaving images and patterns alone.
    return null;
}

// ============================================================
// FIXING ONE NODE
// ============================================================

// The same signal replace-missing-fonts.js uses for "is this a text object".
function hasStory(node) {
    try {
        return !!node.storyInterface;
    } catch (error) {
        return false;
    }
}

// Queues a command fixing a node-level fill (the object's own brush or pen fill - for a text
// object, its frame's background, not its characters') if it needs it, built via
// `setCommand(selection, newDescriptor)`. true if anything was queued.
function queueNodeFillFix(sel, desc, setCommand, cfg, builder) {
    const fixed = fixedFillDescriptor(desc, cfg);
    if (!fixed) return false;
    builder.addCommand(setCommand(sel, fixed));
    return true;
}

// Queues one createFormatText command per character run of `node`'s own text whose fill or
// stroke ink needs fixing - each run's own range stays exactly where it is. Only ever reached for
// text objects, so CONFIG.TEXT_ONLY never has to narrow this: VectorCraft's own tool always lets
// text through regardless of that setting.
function queueTextRunFixes(doc, node, cfg, builder) {
    if (!hasStory(node)) return 0;
    const story = node.storyInterface.story;
    let fixed = 0;
    for (const run of story.attRuns) {
        const atts = story.getGlyphAtts(run.begin).clone();
        let changed = false;

        if (cfg.fill) {
            const fixed2 = fixedFillDescriptor(atts.brushFill, cfg);
            if (fixed2) {
                atts.brushFill = fixed2;
                changed = true;
            }
        }
        if (cfg.stroke) {
            const fixed2 = fixedFillDescriptor(atts.penFill, cfg);
            if (fixed2) {
                atts.penFill = fixed2;
                changed = true;
            }
        }
        if (!changed) continue;

        const sel = Selection.create(doc, node);
        sel.addSubSelectionForNode(node, TextSelection.create([{ begin: run.begin, end: run.end }]));
        builder.addCommand(DocumentCommand.createFormatText(sel, StoryDelta.createFromGlyphAtts(atts)));
        fixed++;
    }
    return fixed;
}

function queueNodeFixes(doc, node, cfg, builder) {
    let fixed = 0;
    const sel = Selection.create(doc, node);
    // CONFIG.TEXT_ONLY only narrows the Overprint Black fix on a non-text object's own fill and
    // stroke - ink limiting and white-overprint removal always apply everywhere, matching
    // VectorCraft's own tool.
    const nodeCfg = (cfg.textOnly && !hasStory(node)) ? Object.assign({}, cfg, { overprintBlack: 0 }) : cfg;

    if (cfg.fill) {
        try {
            const bfi = node.brushFillInterface;
            if (bfi && queueNodeFillFix(sel, bfi.currentDescriptor,
                    (s, v) => DocumentCommand.createSetBrushFill(s, v), nodeCfg, builder)) {
                fixed++;
            }
        } catch (error) { /* this node has no brush fill */ }
    }

    if (cfg.stroke) {
        try {
            const lsi = node.lineStyleInterface;
            if (lsi && lsi.lineType.toString() !== 'None' &&
                    queueNodeFillFix(sel, lsi.getCurrentFillDescriptor(),
                    (s, v) => DocumentCommand.createSetPenFill(s, v), nodeCfg, builder)) {
                fixed++;
            }
        } catch (error) { /* this node has no stroke */ }
    }

    fixed += queueTextRunFixes(doc, node, cfg, builder);

    return fixed;
}

// ============================================================
// FINDING THE OBJECTS
// ============================================================

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

// The roots to search: the selection, or the whole document while nothing is selected - the same
// default VectorCraft's own tool uses - unless CONFIG.SCOPE forces one or the other. `selected`
// must be captured before buildDialog() is used - see that function's own comment on why. Returns
// null (quietly - no alert here) for "Selection only" with nothing selected: this is called on
// every live-preview tick, not just once on OK, so the caller decides when that's worth telling
// the user about.
function resolveRoots(doc, cfg, selected) {
    const scope = cfg.scope === 'auto' ? (selected.length > 0 ? 'selection' : 'document') : cfg.scope;
    if (scope === 'selection') {
        return selected.length > 0 ? selected : null;
    }
    return doc.spreads.toArray();
}

// Builds the full compound command for `cfg` over `selected`, without executing it. Returns
// { cmd, fixedCount, nodeCount, reason } - cmd is null if nothing would change; `reason` is
// 'nothingToDo' (everything left at 0/unchecked), 'noSelection' ("Selection only" with nothing
// selected) or null (ran fine, fixedCount just happened to be 0). This is called on every
// live-preview tick, not just once on OK, so it never alerts itself - the caller decides when
// `reason` is worth telling the user about.
function buildFixCommand(doc, selected, cfg) {
    if (cfg.inkLimit <= 0 && cfg.overprintBlack <= 0 && !cfg.removeWhiteOverprint) {
        return { cmd: null, fixedCount: 0, nodeCount: 0, reason: 'nothingToDo' };
    }
    const roots = resolveRoots(doc, cfg, selected);
    if (!roots) return { cmd: null, fixedCount: 0, nodeCount: 0, reason: 'noSelection' };

    const nodes = collectNodes(roots);
    const builder = CompoundCommandBuilder.create();
    let fixedCount = 0;
    let nodeCount = 0;
    for (const node of nodes) {
        const fixed = queueNodeFixes(doc, node, cfg, builder);
        if (fixed > 0) {
            fixedCount += fixed;
            nodeCount++;
        }
    }
    return { cmd: fixedCount > 0 ? builder.createCommand() : null, fixedCount, nodeCount, reason: null };
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    if (doc.colourProfile.colourSpaceStr !== 'CMYK') {
        alert('Print Ink Fixes works on CMYK documents - choose File > Document Color Mode > ' +
            'CMYK Color first.');
        return;
    }

    const selected = doc.selection.nodes.toArray();

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const dlg = buildDialog(Dialog, UnitType, {
        scope: SCOPE_KEYS.includes(CONFIG.SCOPE) ? CONFIG.SCOPE : SCOPE_KEYS[0],
        inkLimitPercent: isFinite(Number(CONFIG.INK_LIMIT)) ? Number(CONFIG.INK_LIMIT) : 0,
        excludePureBlack: CONFIG.EXCLUDE_PURE_BLACK !== false,
        removeWhiteOverprint: !!CONFIG.REMOVE_WHITE_OVERPRINT,
        overprintBlackPercent: isFinite(Number(CONFIG.OVERPRINT_BLACK)) ? Number(CONFIG.OVERPRINT_BLACK) : 0,
        textOnly: !!CONFIG.TEXT_ONLY,
        fill: CONFIG.FILL !== false,
        stroke: CONFIG.STROKE !== false,
    });

    let last = { cmd: null, fixedCount: 0, nodeCount: 0, reason: null };
    const update = (preview) => {
        last = buildFixCommand(doc, selected, readOptions(dlg));
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
        } else if (result.reason === 'nothingToDo') {
            alert('Nothing to do - the ink limit and overprint-black percentage were both left at 0, ' +
                'and "Turn off overprint on white" was left unchecked.');
        } else if (result.fixedCount === 0) {
            alert('Nothing needed fixing.');
        } else {
            alert('Fixed ' + result.fixedCount + ' paint' + (result.fixedCount === 1 ? '' : 's') + ' across ' +
                result.nodeCount + ' object' + (result.nodeCount === 1 ? '' : 's') + '.');
        }
    }
    doc.clearPreviews();
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
