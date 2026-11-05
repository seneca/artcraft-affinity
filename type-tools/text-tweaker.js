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
Script Name:    text-tweaker.js
Description:    Approximate port of VectorCraft's Type Tools > Text Tweaker. Gives one character
                 attribute to the selected text, letter by letter, from a start value to an end
                 value along a shape, as one undo step; the text stays live and editable. Not a
                 repackaged version of an existing Affinity command - VectorCraft's own source
                 notes even Illustrator has nothing like it.

                 Each character attribute is read and written through its own GlyphAtts, the same
                 mechanism replace-missing-fonts.js and print-ink-fixes.js already use for a run's
                 font and colour, just one character at a time here. Every mapping below was
                 confirmed live against a real text object before shipping: `height` is the
                 character's own size in points; `offsetY` moves its baseline (positive moves it
                 down); `scaleX`/`scaleY` are fractions of 1.0, not percent, so the From/To dialog
                 values for hScale/vScale (given in percent, matching VectorCraft's own units) are
                 divided by 100 before being written; `characterSpacing` is a fraction of the
                 character's own em (1.0 = one full em of extra space), confirmed by measuring the
                 exact width added per unit, so the From/To values for tracking (given in
                 VectorCraft's own units of 1/1000 em) are divided by 1000; `absoluteLeading` is in
                 points directly.

                 Story positions for TextSelection/getGlyphAtts are confirmed live to be plain
                 UTF-16 code-unit offsets, matching `node.text` indexing exactly - no byte-offset
                 conversion needed (unlike VectorCraft's own Rust implementation, which does use
                 UTF-8 byte offsets internally; this is specific to Affinity's own scripting SDK).

                 Settings come from a dialog (Affinity's own Dialog API, /dialog.js) rather than a
                 CONFIG object you edit by hand - CONFIG below only supplies the values the dialog
                 opens with. The dialog live-previews the ramp as you change any setting, the same
                 way arrange-in-grid.js does: doc.executeCommand(cmd, true) applies the preview,
                 doc.clearPreviews() reverts it, and - confirmed directly via this project's own
                 test tool, which can execute preview commands even though it can't open dialogs -
                 a second preview call always replaces the first rather than stacking on it, so
                 recomputing the full ramp from CONFIG's From/To on every change is safe and never
                 compounds. Note for future maintenance: the dialog UI itself still can't be
                 exercised live (dialogs only run in the native Scripts panel, not through this
                 project's own MCP test tool) - only the preview mechanics underneath it were
                 actually tested. Test the dialog for real before relying on it.

Author:         Les Pruszynski (Middledot)
Version:        1.3.0
Created:        05/11/2026
Last updated:   05/11/2026
Compatibility:  Affinity by Canva 3.3

See text-tweaker.md for the full guide, including which of VectorCraft's own eight attributes
aren't included in this version and why.

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
    // "size" (pt) | "baselineShift" (pt) | "hScale" (%) | "vScale" (%) | "tracking" (1/1000 em,
    // VectorCraft's own units) | "leading" (pt). "rotation" and "strokeWidth" aren't included -
    // see the guide's Known Limitations.
    ATTRIBUTE: 'size',

    // The first and last character's own value, in the attribute's own units above.
    FROM: 12,
    TO: 36,

    // "straight" (an even ramp) | "ease" (slow at both ends) | "bow" (from at both ends, rising
    // smoothly to `to` in the middle) | "spike" (from at both ends, straight up to `to` in the
    // middle) | "random" (each character anywhere from `from` to `to`).
    SHAPE: 'straight',

    // "random" shape only - the same seed and text always give the same values (though not the
    // same values VectorCraft's own tool would give for that seed - see the guide).
    SEED: 0,

    // Spaces and line breaks keep their own value and don't count towards the ramp's position.
    SKIP_SPACES: true,
};

const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection, TextSelection, SubSelectionType } = require('/selections.js');
const { StoryDelta } = require('/storydelta.js');

// ============================================================
// ATTRIBUTES
// ============================================================

// How to write one character's value of each VectorCraft attribute into its own GlyphAtts -
// confirmed live against a real text object (see the file header for each mapping's details).
// `height` and `absoluteLeading` throw INVALID_ARGS below their own minimum - confirmed directly,
// live, by trying every value from -1000 to 100000 on a real GlyphAtts clone: `height` must be
// strictly positive (0 itself fails; 0.001 is the smallest tested value that didn't), and
// `absoluteLeading` must be >= 0. `offsetY`, `scaleX`, `scaleY` and `characterSpacing` accept any
// value tested, including negative - which baselineShift and tracking both genuinely need (a
// negative baseline shift moves a character up; negative tracking tightens it). Since the From/To
// dialog fields are shared across all six attributes and can't have a different range per
// attribute (the SDK exposes no way to change a UnitValueEditor's min/max after it's created),
// each attribute clamps its own value to its own valid floor here instead of relying on the
// dialog's shared range to keep it safe - narrowing that shared range to stay positive would have
// broken baselineShift/tracking's negative ramps for everyone.
const ATTRIBUTES = {
    size: value => atts => { atts.height = Math.max(0.001, value); },
    baselineShift: value => atts => { atts.offsetY = value; },
    hScale: value => atts => { atts.scaleX = value / 100; },
    vScale: value => atts => { atts.scaleY = value / 100; },
    tracking: value => atts => { atts.characterSpacing = value / 1000; },
    leading: value => atts => { atts.absoluteLeading = Math.max(0, value); },
};
const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES);
const ATTRIBUTE_LABELS = [
    'Size (pt)', 'Baseline shift (pt)', 'Horizontal scale (%)', 'Vertical scale (%)',
    'Tracking (1/1000 em)', 'Leading (pt)',
];

const SHAPE_KEYS = ['straight', 'ease', 'bow', 'spike', 'random'];
const SHAPE_LABELS = ['Straight', 'Ease', 'Bow', 'Spike', 'Random'];

// From/To fields' slider bound - see buildDialog's own comment on why this needs to be a real,
// explicit range rather than left "unbounded".
const FROM_TO_BOUND = 1000;
const POSITIVE_FROM_TO_MIN = 0.001;

// "size" and "leading" can't go to zero or negative (see the ATTRIBUTES map above) - everything
// else can and does use negative values for real effects (shifting up, tightening). The dialog
// shows a different From/To field pair for each group, see buildDialog's own comment on why.
function isPositiveOnlyAttribute(attribute) {
    return attribute === 'size' || attribute === 'leading';
}

// ============================================================
// SHAPES
// ============================================================

// Where along `shape` (0 at `from`, 1 at `to`) character `i` of `n` lands - VectorCraft's own
// formulas, verified against its source directly.
function amount(shape, i, n, random) {
    const t = n > 1 ? i / (n - 1) : 0;
    switch (shape) {
        case 'ease': return t * t * (3 - 2 * t);
        case 'bow': return Math.sin(Math.PI * t);
        case 'spike': return 1 - Math.abs(2 * t - 1);
        case 'random': return random;
        default: return t;
    }
}

// A small seeded PRNG (mulberry32) - deterministic for a given seed, but not the same sequence
// VectorCraft's own (different, undocumented) generator would produce for that seed.
function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function isSkippable(ch) {
    return /\s/.test(ch) || ch.codePointAt(0) < 32;
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// ============================================================
// DIALOG
// ============================================================

// Builds the settings dialog pre-filled from `defaults` and returns it with its controls attached
// (dlg.attributeBox, dlg.fromPositiveEditor, etc.) - not yet run. `Dialog`/`UnitType` are passed
// in rather than required at module scope, so the live selection (captured in main() before this
// is called) can't be cleared by loading '/dialog.js' too early - see modern-js.md 2.1 in the
// affinity-scripts-toolkit.
function buildDialog(Dialog, UnitType, defaults) {
    const dlg = Dialog.create('Text Tweaker');
    const col = dlg.addColumn();
    const grp = col.addGroup('Settings');

    const attributeIndex = Math.max(0, ATTRIBUTE_KEYS.indexOf(defaults.attribute));
    dlg.attributeBox = grp.addComboBox('Attribute', ATTRIBUTE_LABELS, attributeIndex);

    // An explicit min/max is required for the popup slider to have any travel at all: reading
    // DialogGroup.addUnitValueEditor in /dialog.js shows that omitting them defaults both to
    // the field's own initial value (a zero-width range) before the separate "no min/no max"
    // flag gets applied, by which point the slider widget has already been sized from that
    // zero-width min/max - this is why the slider couldn't be dragged at all, not a live-preview
    // wiring issue (confirmed from the SDK's own source, not run live). The bound is deliberately
    // kept well short of a real "unbounded" range, the same tradeoff arrange-in-grid.js's
    // GAP_MIN_PT/GAP_MAX_PT documents for the same reason (a huge range makes the slider too
    // coarse to be useful) - type a value directly for anything outside it.
    //
    // There are two separate From/To field *pairs* here, not one: a UnitValueEditor's min/max is
    // fixed at creation with no API to change it afterward, but "size"/"leading" need a
    // positive-only range while every other attribute needs a signed one - one shared pair could
    // only ever be right for one of those two groups. Both pairs share the same "From"/"To"
    // labels and only one pair is ever visible at a time (toggled in syncFromToVisibility, below,
    // whenever the selected Attribute crosses between the two groups) so this looks like one
    // field to the user. This is the first time this project has swapped a dialog control's
    // visibility rather than just enabling/disabling it - untested live (same as every other part
    // of this dialog's own UI), so confirm there's no leftover blank gap where the hidden pair was.
    const startsPositive = isPositiveOnlyAttribute(defaults.attribute);
    const startFrom = clamp(defaults.from, startsPositive ? POSITIVE_FROM_TO_MIN : -FROM_TO_BOUND, FROM_TO_BOUND);
    const startTo = clamp(defaults.to, startsPositive ? POSITIVE_FROM_TO_MIN : -FROM_TO_BOUND, FROM_TO_BOUND);

    dlg.fromPositiveEditor = grp.addUnitValueEditor('From', UnitType.Number, UnitType.Number, startsPositive ? startFrom : POSITIVE_FROM_TO_MIN, POSITIVE_FROM_TO_MIN, FROM_TO_BOUND).setShowPopupSlider(true).setPrecision(1);
    dlg.toPositiveEditor = grp.addUnitValueEditor('To', UnitType.Number, UnitType.Number, startsPositive ? startTo : POSITIVE_FROM_TO_MIN, POSITIVE_FROM_TO_MIN, FROM_TO_BOUND).setShowPopupSlider(true).setPrecision(1);
    dlg.fromSignedEditor = grp.addUnitValueEditor('From', UnitType.Number, UnitType.Number, startsPositive ? 0 : startFrom, -FROM_TO_BOUND, FROM_TO_BOUND).setShowPopupSlider(true).setPrecision(1);
    dlg.toSignedEditor = grp.addUnitValueEditor('To', UnitType.Number, UnitType.Number, startsPositive ? 0 : startTo, -FROM_TO_BOUND, FROM_TO_BOUND).setShowPopupSlider(true).setPrecision(1);
    dlg.fromPositiveEditor.setIsVisible(startsPositive);
    dlg.toPositiveEditor.setIsVisible(startsPositive);
    dlg.fromSignedEditor.setIsVisible(!startsPositive);
    dlg.toSignedEditor.setIsVisible(!startsPositive);
    dlg._positiveGroupShown = startsPositive;

    const shapeIndex = Math.max(0, SHAPE_KEYS.indexOf(defaults.shape));
    dlg.shapeBox = grp.addComboBox('Shape', SHAPE_LABELS, shapeIndex);
    dlg.seedEditor = grp.addUnitValueEditor('Random seed (Shape = Random only)', UnitType.Number, UnitType.Number, defaults.seed).setPrecision(0);
    dlg.skipSpacesBox = grp.addCheckBox('Skip spaces and line breaks', defaults.skipSpaces);

    return dlg;
}

// Shows whichever From/To field pair matches the currently-selected Attribute, carrying the
// previous pair's value across (clamped to the new pair's own range) when the selection just
// crossed between the positive-only and signed groups. Must run before readOptions reads
// From/To's value on every update, not just when Attribute's own control fires, since this
// project's dialogs re-derive everything from scratch on every change anyway.
function syncFromToVisibility(dlg) {
    const attribute = ATTRIBUTE_KEYS[dlg.attributeBox.selectedIndex];
    const positive = isPositiveOnlyAttribute(attribute);
    if (positive === dlg._positiveGroupShown) return;

    if (positive) {
        dlg.fromPositiveEditor.value = clamp(dlg.fromSignedEditor.value, POSITIVE_FROM_TO_MIN, FROM_TO_BOUND);
        dlg.toPositiveEditor.value = clamp(dlg.toSignedEditor.value, POSITIVE_FROM_TO_MIN, FROM_TO_BOUND);
    } else {
        dlg.fromSignedEditor.value = clamp(dlg.fromPositiveEditor.value, -FROM_TO_BOUND, FROM_TO_BOUND);
        dlg.toSignedEditor.value = clamp(dlg.toPositiveEditor.value, -FROM_TO_BOUND, FROM_TO_BOUND);
    }
    dlg.fromPositiveEditor.setIsVisible(positive);
    dlg.toPositiveEditor.setIsVisible(positive);
    dlg.fromSignedEditor.setIsVisible(!positive);
    dlg.toSignedEditor.setIsVisible(!positive);
    dlg._positiveGroupShown = positive;
}

// The dialog's current control values, as a plain cfg object. Call syncFromToVisibility(dlg)
// first - this reads whichever From/To pair that leaves visible.
function readOptions(dlg) {
    const attribute = ATTRIBUTE_KEYS[dlg.attributeBox.selectedIndex];
    const positive = isPositiveOnlyAttribute(attribute);
    return {
        attribute,
        from: positive ? dlg.fromPositiveEditor.value : dlg.fromSignedEditor.value,
        to: positive ? dlg.toPositiveEditor.value : dlg.toSignedEditor.value,
        shape: SHAPE_KEYS[dlg.shapeBox.selectedIndex],
        seed: Math.trunc(dlg.seedEditor.value) || 0,
        skipSpaces: dlg.skipSpacesBox.value,
    };
}

// ============================================================
// APPLYING TO ONE OBJECT
// ============================================================

// Tweaks the characters of `node` in [start, end) (UTF-16 code-unit offsets, matching `node.text`
// indexing directly), queuing one createFormatText command per changed character into `builder`.
// Returns how many characters changed. Each character's value is always computed fresh from
// `cfg.from`/`cfg.to` and its position in the ramp, never read back off the node itself - so this
// is safe to call repeatedly for a live preview without compounding: Affinity's own preview
// mechanism already resets to the true committed state before each new preview is applied
// (confirmed directly - a second preview command replaces the first rather than stacking on it).
function tweakNode(doc, node, start, end, cfg, makeApply, builder) {
    const text = node.text;
    const indices = [];
    for (let i = start; i < end; i++) {
        if (cfg.skipSpaces && isSkippable(text[i])) continue;
        indices.push(i);
    }
    const n = indices.length;
    if (n === 0) return 0;

    const story = node.storyInterface.story;
    const rng = makeRng(cfg.seed);
    let changed = 0;

    indices.forEach((charIndex, i) => {
        const random = cfg.shape === 'random' ? rng() : 0;
        const value = cfg.from + (cfg.to - cfg.from) * amount(cfg.shape, i, n, random);
        const atts = story.getGlyphAtts(charIndex).clone();
        makeApply(value)(atts);

        const sel = Selection.create(doc, node);
        sel.addSubSelectionForNode(node, TextSelection.create([{ begin: charIndex, end: charIndex + 1 }]));
        builder.addCommand(DocumentCommand.createFormatText(sel, StoryDelta.createFromGlyphAtts(atts)));
        changed++;
    });
    return changed;
}

// Builds the full compound command for `targets` under `cfg`, without executing it. Returns
// { cmd, changed } - cmd is null if nothing would change.
function buildTweakCommand(doc, targets, cfg) {
    const makeApply = ATTRIBUTES[cfg.attribute];
    const builder = CompoundCommandBuilder.create();
    let changed = 0;
    for (const { node, start, end } of targets) {
        changed += tweakNode(doc, node, start, end, cfg, makeApply, builder);
    }
    return { cmd: changed > 0 ? builder.createCommand() : null, changed };
}

// ============================================================
// FINDING WHAT TO TWEAK
// ============================================================

function hasStory(node) {
    try {
        return !!node.storyInterface;
    } catch (error) {
        return false;
    }
}

// The same priority VectorCraft's own tool uses: a live Type-tool text range on one object; else,
// at a caret, all of that one object's text; else every selected type object, each its own ramp.
function resolveTargets(doc) {
    const sub = doc.selection.getFirstSubSelectionOfType(SubSelectionType.Text);
    if (sub) {
        const nodes = doc.selection.nodes.toArray();
        if (nodes.length === 1 && hasStory(nodes[0])) {
            const node = nodes[0];
            const a = Math.min(sub.caret, sub.anchor), b = Math.max(sub.caret, sub.anchor);
            if (a >= 0 && b <= node.text.length) {
                return [{ node, start: a === b ? 0 : a, end: a === b ? node.text.length : b }];
            }
        }
    }
    return doc.selection.nodes.toArray()
        .filter(hasStory)
        .map(node => ({ node, start: 0, end: node.text.length }));
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) { alert('This script requires an open document'); return; }

    const targets = resolveTargets(doc);
    if (targets.length === 0) {
        alert('Select one or more type objects first, or place the Type tool\'s cursor in one.');
        return;
    }

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const dlg = buildDialog(Dialog, UnitType, {
        attribute: ATTRIBUTES[CONFIG.ATTRIBUTE] ? CONFIG.ATTRIBUTE : ATTRIBUTE_KEYS[0],
        from: isFinite(Number(CONFIG.FROM)) ? Number(CONFIG.FROM) : 0,
        to: isFinite(Number(CONFIG.TO)) ? Number(CONFIG.TO) : 0,
        shape: SHAPE_KEYS.includes(CONFIG.SHAPE) ? CONFIG.SHAPE : SHAPE_KEYS[0],
        seed: Math.trunc(Number(CONFIG.SEED)) || 0,
        skipSpaces: CONFIG.SKIP_SPACES !== false,
    });

    let last = { cmd: null, changed: 0 };
    const update = (preview) => {
        syncFromToVisibility(dlg);
        last = buildTweakCommand(doc, targets, readOptions(dlg));
        if (last.cmd) doc.executeCommand(last.cmd, preview);
        else doc.clearPreviews();
        return last;
    };

    dlg.onControlValueChangedHandler = () => update(true);
    update(true);

    if (dlg.runModal() === DialogResult.Ok) {
        const result = update(false);
        if (result.changed === 0) {
            alert('Nothing to change - there were no characters in range (after skipping spaces, if that option is on).');
        } else {
            alert('Tweaked ' + result.changed + ' character' + (result.changed === 1 ? '' : 's') + ' across ' +
                targets.length + ' object' + (targets.length === 1 ? '' : 's') + '.');
        }
    }
    doc.clearPreviews();
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
