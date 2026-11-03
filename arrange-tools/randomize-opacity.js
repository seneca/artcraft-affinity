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
Script Name:    randomize-opacity.js
Description:    Ported from VectorCraft's Arrange Tools > Randomize Opacity. Gives each selected
                 object (the top-level ones) its own opacity, picked at random and evenly between
                 Minimum and Maximum, as one undo step. The same Seed, selection and range always
                 reproduce the same opacities. VectorCraft's own default Seed comes from the
                 document's revision counter (so repeated runs vary unless nothing changed) - not
                 exposed to scripts, so a freshly randomized Seed serves the same purpose here.
                 Minimum given greater than Maximum is swapped rather than rejected, since this
                 SDK has no way to disable OK the way VectorCraft's dialog does.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        03/11/2026
Last updated:   03/11/2026
Compatibility:  Affinity by Canva 3.3

See randomize-opacity.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    SEED_MAX: 999999,  // Seed field's upper bound, matching VectorCraft's dialog (its command takes any whole number)
};

// Modules that clear the live selection when require()'d (/dialog among them) are loaded lazily,
// after the selection is captured - see modern-js.md 2.1 in the affinity-scripts-toolkit.
const { CompoundCommandBuilder, DocumentCommand } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');

// A small, deterministic PRNG (mulberry32): the same seed always yields the same sequence, which
// is what "the same seed, objects and range give the same opacities" requires. It doesn't need to
// match VectorCraft's own generator bit-for-bit, only to be reproducible within this script.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// One random opacity (0..1) per node, in the selection's own order, from a fresh RNG seeded with
// opts.seed - so the sequence (and hence each node's result) only depends on the dialog's state.
function buildCommand(doc, nodes, opts) {
    if (nodes.length === 0)
        return null;
    const lo = Math.min(opts.min, opts.max) / 100;
    const hi = Math.max(opts.min, opts.max) / 100;
    const rand = mulberry32(opts.seed);
    const builder = CompoundCommandBuilder.create();
    for (const node of nodes) {
        const o = lo + rand() * (hi - lo);
        builder.addCommand(DocumentCommand.createSetOpacity(Selection.create(doc, node), o));
    }
    return builder.createCommand();
}

// `Dialog`/`UnitType` are passed in rather than required at module scope, so the live selection
// (captured in main() before this is called) can't be cleared by loading '/dialog.js' too early.
function buildDialog(Dialog, UnitType, defaultSeed) {
    const dlg = Dialog.create("Randomize Opacity");
    const col = dlg.addColumn();
    const grp = col.addGroup("");
    dlg.min = grp.addUnitValueEditor("Minimum:", UnitType.Percentage, UnitType.Percentage, 30, 0, 100).setShowPopupSlider(true);
    dlg.max = grp.addUnitValueEditor("Maximum:", UnitType.Percentage, UnitType.Percentage, 100, 0, 100).setShowPopupSlider(true);
    dlg.seed = grp.addUnitValueEditor("Seed:", UnitType.Number, UnitType.Number, defaultSeed, 0, CONFIG.SEED_MAX).setPrecision(0).setShowPopupSlider(true);
    return dlg;
}

function readOptions(dlg) {
    return { min: dlg.min.value, max: dlg.max.value, seed: Math.round(dlg.seed.value) };
}

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    // Capture the selection before loading '/dialog.js', which clears it as a side effect.
    const nodes = doc.selection.nodes.toArray();
    if (nodes.length === 0) {
        alert("Please select one or more objects");
        return;
    }

    const { Dialog, DialogResult } = require('/dialog.js');
    const { UnitType } = require('/units.js');

    const defaultSeed = Math.floor(Math.random() * (CONFIG.SEED_MAX + 1));
    const dlg = buildDialog(Dialog, UnitType, defaultSeed);

    const update = (preview) => {
        const cmd = buildCommand(doc, nodes, readOptions(dlg));
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
