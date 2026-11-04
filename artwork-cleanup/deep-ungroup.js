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
Script Name:    deep-ungroup.js
Description:    Ported from VectorCraft's Artwork Cleanup > Deep Ungroup. Dissolves every
                 selected group, recursively, down to the objects actually inside them -
                 unlike Affinity's own Ungroup, which only peels off one level at a time. A
                 locked or hidden group stops the recursion there and is kept whole; every
                 other dissolved group's own opacity is folded into whatever ends up left in
                 its place, so the result looks the same even though the grouping is gone.
                 Runs immediately on the selection, as one undo step - no dialog.

Author:         Les Pruszynski (Middledot)
Version:        1.0.0
Created:        04/11/2026
Last updated:   04/11/2026
Compatibility:  Affinity by Canva 3.3

See deep-ungroup.md for the full guide.

Contact:        lpruszynski@middledot.com
================================================================================
*/

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    // Refuse rather than let a pathologically deep/wide group tree hang on a huge compound
    // command.
    MAX_GROUPS: 5000,
};

const { CompoundCommandBuilder, DocumentCommand, NodeChildType, NodeMoveType } = require('/commands.js');
const { Document } = require('/document.js');
const { Selection } = require('/selections.js');

// ============================================================
// GROUP WALKING
// ============================================================

function isArtboard(node) {
    return !!(node.artboardInterface && node.artboardInterface.isArtboardEnabled);
}

// Only a plain Cmd+G group counts - not an artboard, and (per project convention) never a clip
// structure, since Affinity's SDK has no scriptable equivalent of VectorCraft's clip-group flag
// to tell those apart safely.
function isUngroupableGroup(node) {
    return node.isGroupNode && !isArtboard(node);
}

// Recursively walks `node`, which sits at `multiplier` worth of accumulated opacity from every
// ancestor group already decided to dissolve. Appends one entry per surviving node to `out`,
// each with the globalOpacity it must end up with (its own, times every dissolved ancestor's
// own) - globalOpacity is each node's own value only, never compounded automatically. A group
// that's itself locked or hidden stops the recursion and is kept whole, matching VectorCraft's
// own `n.locked` / `!n.visible` check. `stats.count` counts every group actually dissolved.
function flatten(node, multiplier, out, stats) {
    if (!isUngroupableGroup(node) || !node.isLocalEditable || !node.isVisible) {
        out.push({ node: node, opacity: multiplier * node.globalOpacity });
        return;
    }
    stats.count++;
    const ownOpacity = node.globalOpacity;
    const children = node.children.toArray();
    for (const child of children) {
        flatten(child, multiplier * ownOpacity, out, stats);
    }
}

// Plans dissolving `root` itself, or returns null if `root` isn't an ungroupable, editable,
// visible group (it then stays in the selection exactly as it is).
function planRoot(root) {
    if (!isUngroupableGroup(root) || !root.isLocalEditable || !root.isVisible) {
        return null;
    }
    const out = [];
    const stats = { count: 0 };
    const children = root.children.toArray();
    for (const child of children) {
        flatten(child, root.globalOpacity, out, stats);
    }
    // +1 for root itself - flatten() only tallies the groups it recurses into below root, never
    // root's own dissolution.
    return { root: root, members: out, count: stats.count + 1 };
}

// ============================================================
// COMMAND
// ============================================================

function buildCommand(doc, roots) {
    const plans = [];
    let totalGroups = 0;
    const finalSelection = [];
    for (const root of roots) {
        const plan = planRoot(root);
        if (!plan) {
            finalSelection.push(root);
            continue;
        }
        plans.push(plan);
        totalGroups += plan.count;
    }
    if (plans.length === 0) return { cmd: null, ungrouped: 0, freed: 0, overLimit: false };
    if (totalGroups > CONFIG.MAX_GROUPS) return { cmd: null, ungrouped: 0, freed: 0, overLimit: true };

    const builder = CompoundCommandBuilder.create();
    let freed = 0;
    for (const plan of plans) {
        // Each freed member is moved to sit right after wherever the previous one landed,
        // starting right after the dissolving group's own former position - so the whole group
        // of freed objects keeps its original stacking order and takes over the group's old
        // slot, before the now-empty group shell is deleted.
        let anchor = plan.root;
        for (const member of plan.members) {
            builder.addCommand(DocumentCommand.createMoveNodes(
                Selection.create(doc, member.node), anchor, NodeMoveType.After, NodeChildType.Main
            ));
            anchor = member.node;
            if (Math.abs(member.opacity - member.node.globalOpacity) > 1e-6) {
                builder.addCommand(DocumentCommand.createSetOpacity(Selection.create(doc, member.node), member.opacity));
            }
            finalSelection.push(member.node);
            freed++;
        }
        builder.addCommand(DocumentCommand.createDeleteSelection(Selection.create(doc, plan.root)));
    }
    builder.addCommand(DocumentCommand.createSetSelection(Selection.create(doc, finalSelection)));
    return { cmd: builder.createCommand(), ungrouped: totalGroups, freed: freed, overLimit: false };
}

// ============================================================
// RUN
// ============================================================

function main() {
    const doc = Document.current;
    if (!doc) {
        alert("This script requires an open document");
        return;
    }

    const roots = doc.selection.nodes.toArray();
    if (roots.length === 0) {
        alert("Please select one or more groups");
        return;
    }

    const result = buildCommand(doc, roots);
    if (result.overLimit) {
        alert("This selection has too many nested groups (over " + CONFIG.MAX_GROUPS + ") to ungroup at once");
        return;
    }
    if (!result.cmd) {
        alert("Nothing in the selection is an ungroupable group (locked and hidden groups are left as they are).");
        return;
    }

    doc.executeCommand(result.cmd);
    alert("Ungrouped " + result.ungrouped + " group" + (result.ungrouped === 1 ? "" : "s") +
        ", freeing " + result.freed + " object" + (result.freed === 1 ? "" : "s") + ".");
}

try {
    main();
} catch (error) {
    console.error('Script failed: ' + (error && error.message ? error.message : error));
}
