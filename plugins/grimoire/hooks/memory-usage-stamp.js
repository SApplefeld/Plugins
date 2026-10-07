#!/usr/bin/env node
// PostToolUse hook: record that a kit memory file was opened, as a read stamp
// on the memory database's local queue.
//
// A stamp names the record by its tier and the key that tier is stored under,
// through the usage entry memq composes: a project's memory dir
// (<root>/projects/<project>/memory), a type dir (<root>/memory-types/<type>),
// or the operator dir (<root>/memory-operator). Which of them a path sits in
// is memq's own answer, through the tierDirFor it exports, so a tier is added
// to the store in one place rather than restated here.
//
// What a stamp attests is narrow: the memory was opened. A read that precedes
// editing, curating, or deleting a memory looks exactly like one that used it,
// so this is not evidence of application. `memq touch <name> --applied` writes
// that separately as an applied stamp, and the decay pass keys on the applied
// records; read records only inform the judgment between summarizing and
// archiving.
//
// Every rule about the store comes from scripts/memq.js, which owns them: the
// root, the tier layout, what counts as a memory file, and the key one is
// recorded under. This hook restates none of them, so it cannot drift from the
// CLI that writes the same stamps.
//
// SAFETY: never blocks, never speaks, never waits on the host. A PostToolUse
// exit code of 2 carries meaning to the harness, so every path here ends at 0:
// an unparseable payload, a path outside the store, a name the store refuses,
// a file that is not there, a queue that will not take the row, and a failed
// require all exit silently, and this hook itself writes nothing to stdout or
// stderr. The one voice memq brings with it is its own: when KIT_MEMORY_ROOT is
// set without its second signal, memq notes the ignored override on stderr,
// which carries no meaning at exit 0 and never enters context. No memory file
// and no sidecar is touched at all.
//
// The stamp goes to the memory database's local queue and nowhere else,
// through memq's own writer. This hook opens no socket and spawns nothing: the
// queue is a local SQLite file, and the next write verb or `memq db-refresh`
// delivers a run's worth of stamps in order. A machine with no client config
// writes nothing at all. The interactive verbs print one sentence when that
// queue refuses a row; this hook asks for no such sentence, because the SAFETY
// note above is the rule and a PostToolUse hook's standard error reaches no
// person.

'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
    let payload = null;
    try {
        payload = JSON.parse(readStdin() || '{}');
    } catch {
        return;
    }
    if (typeof payload !== 'object' || payload === null) return;

    // A hook matcher is a regex tested against the tool name, not an equality
    // check, so the "Read" wiring also selects any tool whose name contains it
    // (NotebookRead, an MCP read resource). A stamp's kind is a claim about
    // which tool fired, so this gate is what makes the claim true and is not a
    // restatement of the wiring. An absent name is tolerated, the same
    // fail-open direction as everything else here.
    if (payload.tool_name && payload.tool_name !== 'Read') return;

    const input = payload.tool_input || {};
    const filePath = input.file_path || input.filePath;
    if (typeof filePath !== 'string' || filePath === '') return;

    // Required only once a payload names a file at all, rather than at module
    // load, so a session's reads of ordinary files do not pay for it. Inside
    // main() it is covered by the same catch as everything else, so a damaged
    // or incomplete plugin cache that cannot supply the store's rules leaves
    // the hook inert instead of ending the process nonzero.
    const memq = require('../scripts/memq.js');

    const resolved = path.resolve(filePath);
    const name = path.basename(resolved);
    if (!memq.isMemoryFilename(name)) return;
    const tierDir = memq.tierDirFor(resolved);
    if (tierDir === null) return;

    // PostToolUse fires after a failed Read as well as a successful one, so the
    // file is confirmed before a stamp claims it was opened. Without this, a
    // Read of a path that does not exist would record a memory that never did
    // and could create a sidecar in a tier that has none.
    let st = null;
    try { st = fs.statSync(resolved); } catch { return; }
    if (!st.isFile()) return;

    // The stamp written to the memory database's local queue, through memq's
    // own writer, so the hook states nothing about tiers or entry shapes that
    // the CLI does not state. The queue is the whole of the write: no
    // usage.jsonl line is appended beside the record, and the next write verb
    // or refresh is what delivers the row. A machine with no database config
    // writes nothing here at all.
    //
    // No reporting option is passed, which is what keeps this path silent on
    // every answer: the writer speaks only for a caller that asks. The
    // payload's `cwd` is the session's working directory, which is what keys
    // a project stamp to its fleet-wide store.
    memq.deliverStamp(tierDir, name, 'read', { cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined });
}

try { main(); } catch { /* a usage stamp is never worth disturbing a session */ }

// Zero without process.exit(): nothing above sets a code and main() is wrapped,
// so the process ends at 0 on every path, and forcing the exit could discard a
// write still in flight.
process.exitCode = 0;
