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
                 attribute to the selected text, letter by letter, from CONFIG.FROM to CONFIG.TO
                 along CONFIG.SHAPE, as one undo step; the text stays live and editable. Not a
                 repackaged version of an existing Affinity command - VectorCraft's own source
                 notes even Illustrator has nothing like it.

                 Each character attribute is read and written through its own GlyphAtts, the same
                 mechanism replace-missing-fonts.js and print-ink-fixes.js already use for a run's
                 font and colour, just one character at a time here. Every mapping below was
                 confirmed live against a real text object before shipping: `height` is the
                 character's own size in points; `offsetY` moves its baseline (positive moves it
                 down); `scaleX`/`scaleY` are fractions of 1.0, not percent, so CONFIG.FROM/TO for
                 hScale/vScale (given in percent, matching VectorCraft's own units) are divided by
                 100 before being written; `characterSpacing` is a fraction of the character's own
                 em (1.0 = one full em of extra space), confirmed by measuring the exact width
                 added per unit, so CONFIG.FROM/TO for tracking (given in VectorCraft's own units
                 of 1/1000 em) are divided by 1000; `absoluteLeading` is in points directly.

                 Story positions for TextSelection/getGlyphAtts are confirmed live to be plain
                 UTF-16 code-unit offsets, matching `node.text` indexing exactly - no byte-offset
                 conversion needed (unlike VectorCraft's own Rust implementation, which does use
                 UTF-8 byte offsets internally; this is specific to Affinity's own scripting SDK).

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
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
const ATTRIBUTES = {
    size: value => atts => { atts.height = value; },
    baselineShift: value => atts => { atts.offsetY = value; },
    hScale: value => atts => { atts.scaleX = value / 100; },
    vScale: value => atts => { atts.scaleY = value / 100; },
    tracking: value => atts => { atts.characterSpacing = value / 1000; },
    leading: value => atts => { atts.absoluteLeading = value; },
};

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

// A small seeded PRNG (mulberry32) - deterministic for a given CONFIG.SEED, but not the same
// sequence VectorCraft's own (different, undocumented) generator would produce for that seed.
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

// ============================================================
// APPLYING TO ONE OBJECT
// ============================================================

// Tweaks the characters of `node` in [start, end) (UTF-16 code-unit offsets, matching `node.text`
// indexing directly), queuing one createFormatText command per changed character. Returns how
// many characters changed.
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

    const makeApply = ATTRIBUTES[CONFIG.ATTRIBUTE];
    if (!makeApply) {
        alert('CONFIG.ATTRIBUTE must be one of: ' + Object.keys(ATTRIBUTES).join(', '));
        return;
    }
    const cfg = {
        from: Number(CONFIG.FROM),
        to: Number(CONFIG.TO),
        shape: ['straight', 'ease', 'bow', 'spike', 'random'].includes(CONFIG.SHAPE) ? CONFIG.SHAPE : 'straight',
        seed: Math.trunc(Number(CONFIG.SEED)) || 0,
        skipSpaces: CONFIG.SKIP_SPACES !== false,
    };
    if (!isFinite(cfg.from) || !isFinite(cfg.to)) {
        alert('CONFIG.FROM and CONFIG.TO must both be numbers.');
        return;
    }

    const targets = resolveTargets(doc);
    if (targets.length === 0) {
        alert('Select one or more type objects first, or place the Type tool\'s cursor in one.');
        return;
    }

    const builder = CompoundCommandBuilder.create();
    let totalChanged = 0;
    for (const { node, start, end } of targets) {
        totalChanged += tweakNode(doc, node, start, end, cfg, makeApply, builder);
    }

    if (totalChanged === 0) {
        alert('Nothing to change - there were no characters in range (after skipping spaces, if CONFIG.SKIP_SPACES is on).');
        return;
    }

    doc.executeCommand(builder.createCommand());
    alert('Tweaked ' + totalChanged + ' character' + (totalChanged === 1 ? '' : 's') + ' across ' +
        targets.length + ' object' + (targets.length === 1 ? '' : 's') + '.');
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
