// shipped-surfaces: the one walk over the markdown the kit ships under its
// plugin root, and the predicate that marks a rationale ledger, for every
// sweep that reads that markdown. A surface added to or excluded from the walk
// here reaches every sweep at once, so no sweep's scope can drift from
// another's through a copy edited in one place only.
//
// Three test files walk with it. test/doctrine-parity.test.js and
// test/em-dash-sweep.test.js walk with ledgers false, since they sweep the
// markdown as instruction surfaces. test/markdown-marker-parity.test.js walks
// with ledgers true, since a ledger renders as ordinary markdown and its bold
// markers must balance like any other file's. Four sweeps call
// isRationaleLedger directly: doctrine-parity's own boundary walker,
// test/heading-shape.test.js, test/review-loop-provenance.test.js and
// test/skill-compaction-fit.test.js.
//
// liveLedgerText is the verdict filter over a ledger entry. Two tests read
// entries through it: doctrine-parity's passage pin, which reads a rewrite
// entry by its passage lines over the entries ledgerEntries parses, and
// test/map-ledger-pin.test.js, which reads one by its proposed lines.
//
// One exclusion holds in every mode: grimoire-doctrine.md directly at the
// plugin root. It is gitignored build output the doctrine-refresh hook
// regenerates from the operating-instructions skill body, not a file anyone
// authors. A file of that name anywhere below the root is walked.
//
// The module lives in the scripts directory rather than under test/ because a
// test file exports nothing, and kit-size.js leaves this directory unmeasured.
// It reads the tree and writes nothing.

'use strict';

const fs = require('fs');
const path = require('path');

// A rationale ledger, references/rationale-ledger.md under a skill, is the
// corpus audit's journal layer rather than a surface a session loads: nobody
// loads it by default, and its entries quote rule wordings, retired ones
// included, as their subject, with provenance narrative beside them. A sweep
// over instruction surfaces leaves it out through this predicate, so a new
// walker has one thing to reuse rather than a literal to copy.
function isRationaleLedger(dir, name) {
    return name === 'rationale-ledger.md' && path.basename(dir) === 'references';
}

// Every entry of a rationale ledger's text, each as its id from its `### `
// heading and its fields, a field being a `- name: value` line under it and a
// repeated field such as `passage:` keeping every value in order.
function ledgerEntries(text) {
    const entries = [];
    for (const line of text.split(/\r?\n/)) {
        if (/^### /.test(line)) { entries.push({ id: line.slice(4).trim(), fields: {} }); continue; }
        const f = /^- ([a-z-]+):\s*(.+?)\s*$/.exec(line);
        if (f && entries.length > 0) (entries[entries.length - 1].fields[f[1]] ||= []).push(f[2]);
    }
    return entries;
}

// The text a live rationale-ledger entry quotes, or null for a retired one.
// entry.fields maps each field name to its values in order. A `retire` entry
// is not live. rewrite names what a `rewrite` entry is read by: 'proposed'
// reads its `proposed:` lines where it carries any, for a document whose
// proposals landed as written, and 'passage' reads its `passage:` lines, which
// quote the source as it reads now. Any other entry is read by its `passage:`
// lines. A rewrite value other than those two throws, so each caller states
// its reading.
function liveLedgerText(entry, { rewrite } = {}) {
    if (rewrite !== 'proposed' && rewrite !== 'passage') {
        throw new TypeError("liveLedgerText needs rewrite as 'proposed' or 'passage', got " + String(rewrite));
    }
    const verdict = (entry.fields.verdict || [])[0];
    if (verdict === 'retire') return null;
    if (verdict === 'rewrite' && rewrite === 'proposed' && entry.fields.proposed) return entry.fields.proposed;
    return entry.fields.passage || [];
}

// Every .md file under root, depth first in readdirSync order, each file
// pushed as the walk meets it. root is the plugin root the caller resolves.
// ledgers is required as a boolean: false leaves every rationale ledger out
// and true keeps them, and any other value throws, so each caller states its
// own scope rather than inheriting a default. A directory the walk cannot
// read throws as readdirSync does, so an unreadable surface is never a
// silent pass.
function shippedKitMarkdown({ root, ledgers } = {}) {
    if (typeof root !== 'string' || root === '') {
        throw new TypeError('shippedKitMarkdown needs root, the plugin root path');
    }
    if (typeof ledgers !== 'boolean') {
        throw new TypeError('shippedKitMarkdown needs ledgers as true or false, got ' + String(ledgers));
    }
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (entry.name === 'grimoire-doctrine.md' && dir === root) continue;
            if (!ledgers && isRationaleLedger(dir, entry.name)) continue;
            if (entry.name.endsWith('.md')) files.push(full);
        }
    };
    walk(root);
    return files;
}

module.exports = {
    isRationaleLedger,
    ledgerEntries,
    liveLedgerText,
    shippedKitMarkdown
};
