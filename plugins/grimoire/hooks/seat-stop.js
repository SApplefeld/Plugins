#!/usr/bin/env node
// Stop hook: the registered seat's heartbeat stamp and compaction boundary.
//
// A seat's compaction boundary was prose, and prose that a seat has to remember
// at the end of every pass. This hook makes it structural: the seat pushes
// status to its own registry entry at its banked moments, which is a
// declaration it already owes the coordinator, and this hook turns that
// declaration into the marker the PreCompact gate honors.
//
// Two independent legs, both keyed on the calling session's registry entry at
// ~/.claude/coordinator/<hostname>/registry/<session-id>.md:
//
//   1. The heartbeat. The entry's `Heartbeat:` line is stamped with now,
//      throttled to one write per HEARTBEAT_THROTTLE_MS. It is how a session
//      the roster cannot show (an elevated one) proves it is alive, and it is
//      the reading the coordinator's prune of a dead entry is gated on.
//   2. The boundary. Where the entry's `Status-updated:` stamp is within
//      STATUS_FRESH_MS of now and the project directory's tree is clean, the
//      role-boundary marker is opened for this session. The status push is the
//      seat's own banked declaration; this hook only makes it reach the gate.
//      The freshness test is on the wall clock and not on the turn, so every
//      turn ending inside that window opens the marker, and a Stop inside the
//      window after the gate has consumed one opens it again. What that buys
//      is a marker for a moment the seat declared minutes earlier rather than
//      at this exact turn end, which is the cost the marker design already
//      prices: a compaction landing anywhere inside the window costs a re-read
//      and never state, the invariant the declaration carries.
//
// The whole cost for a session the registry does not carry is one stat, which
// is what makes it affordable on every Stop of every session on the machine.
//
// The marker file is per session, one file under the machine-local root
// ~/.kit/role-boundary keyed by the session id (roleBoundaryPath in
// kit-compact-lib.js), so two registered seats working the same project
// directory open two files and neither Stop can overwrite the other's, and a
// seat's marker is one file however many directories it works in. The
// payload's cwd names no marker; it answers the tree question below and is
// the project whose scratch directory the bank ensures afterward, so the gate
// has somewhere to record the deferrals it holds for this seat there.
//
// It never blocks: nothing is written to stdout on any path, so the stop is
// always allowed and no stop_hook_active guard is needed. Any failure exits 0,
// so a hook bug can never trap a session.

'use strict';

const fs = require('fs');
const { gitOutput } = require('./kit-git-lib.js');
const {
    writeRoleBoundary, ensureProjectScratchDir, registryEntryPath,
    readRegistryEntryText, writeRegistryEntryAtomic,
    registryField
} = require('./kit-compact-lib.js');

// How often the heartbeat is rewritten. The stamp's only reader asks whether
// the session was alive recently, so a stamp per turn would buy nothing and
// cost a write on every stop of every registered session on the machine.
const HEARTBEAT_THROTTLE_MS = 10 * 60 * 1000;

// How recently the session must have pushed status for a turn end to rest the
// marker on that push. The two windows are the same figure and are deliberately
// separate constants: this one bounds how stale a declaration may be before the
// marker stops resting on it, a question about the declaration's age, while the
// one above bounds a write rate.
const STATUS_FRESH_MS = 10 * 60 * 1000;

// How long the tree read may take before the turn end stops waiting on it.
const GIT_TIMEOUT_MS = 5000;

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Whether a recorded ISO stamp is within maxAgeMs of now. An absent,
// unparseable, or future stamp is not fresh: a future one would otherwise open
// a window that never closes, which is the reading the registry's own
// heartbeat rule takes for the same reason.
function stampIsFresh(value, maxAgeMs) {
    if (typeof value !== 'string' || value === '') return false;
    const at = Date.parse(value);
    if (!Number.isFinite(at)) return false;
    const age = Date.now() - at;
    return age >= 0 && age <= maxAgeMs;
}

// Rewrite the entry's existing `Heartbeat:` line in place. `Heartbeat:` is the
// only field this hook stamps, and the bound is the contract's rather than a
// convenience: the entry's other time fields are the seat's own declaration,
// and the marker leg below rests on `Status-updated:` being one, so a hook that
// stamped it at every turn end would be reading its own writing and every stop
// would bank a boundary the seat never declared. A seat reads the clock for
// that field through the stamping helper its push step runs, so the value is an
// instrument's either way and the write stays the session's.
//
// The rewrite goes out through the shared
// atomic write every mechanical stamp of a registry entry goes out by, which
// owns the unguessable temporary, the exclusive create and the cleanup that
// removes only what this writer made. The session that registered is the
// entry's only writer bar this line, so nothing else in the file is touched
// and a missing line is left missing rather than added: an entry without one is
// not the shape the contract defines, and restructuring a peer's single-writer
// artifact is not this hook's to do.
//
// The read behind `text` and this rewrite are not locked against each other, a
// second residual named here rather than left for a reader to find: an entry
// rewritten between that read and the rename below is replaced wholesale by
// the pre-read text carrying this stamp. The window is the two syscalls
// between them, and the entry's only other writer is its own session at its
// own push moments, so the worst loss is one status push, visible to that
// session and repaired by its next one.
function stampHeartbeat(full, text) {
    if (!/^Heartbeat:/m.test(text)) return;
    // The entry's own line ending survives the rewrite: a carriage return is a
    // line terminator, which `.` never matches, so the match ends before it and
    // the rewrite replaces the line's text without reaching its ending.
    const stamped = text.replace(/^Heartbeat:.*$/m,
        'Heartbeat: ' + new Date().toISOString());
    writeRegistryEntryAtomic(full, stamped);
}

// Whether the project directory holds no uncommitted work. A non-git directory
// and a git that fails or times out both read as clean, deliberately: the
// marker's worst case is a compaction landing at a boundary the session itself
// declared, so the conservative direction here is the permissive one, and a
// seat whose project directory is not a checkout has no tree to be mid-work on.
function treeIsClean(cwd) {
    const out = gitOutput(cwd, ['status', '--porcelain'], { timeoutMs: GIT_TIMEOUT_MS });
    if (out === null) return true;
    return out.trim() === '';
}

function main() {
    let payload = {};
    try { payload = JSON.parse(readStdin() || '{}'); } catch { /* defaults */ }

    // One spelling of the entry's location serves this hook and the checkpoint
    // CLI's `Banked:` stamp, from kit-compact-lib.js, which this hook already
    // loads for the marker write: the id is held to the shared marker-scope
    // rule there before it composes anything, so a value carrying a separator
    // or a parent segment never reaches a path join.
    const sessionId = payload.session_id || payload.sessionId;
    const full = registryEntryPath(sessionId);
    if (full === null) return;
    // The same screen the boundary verb's stamp reads through: lstat rather
    // than stat, so a link at the entry path is refused rather than followed by
    // the rewrite below, plus the kind and size bounds. This is also the leg
    // that makes an unregistered session cost one syscall.
    const text = readRegistryEntryText(full).text;
    if (text === null) return;

    if (!stampIsFresh(registryField(text, 'Heartbeat'), HEARTBEAT_THROTTLE_MS)) {
        stampHeartbeat(full, text);
    }

    const cwd = payload.cwd || process.cwd();
    if (stampIsFresh(registryField(text, 'Status-updated'), STATUS_FRESH_MS) && treeIsClean(cwd)) {
        writeRoleBoundary(sessionId);
        // The project's own scratch directory, ensured after the marker and
        // best-effort. The marker lives under the home, so banking it no
        // longer creates this directory as a side effect, and the gate records
        // a decision only where it already exists: a seat in
        // a fresh checkout would otherwise have its deferrals recorded nowhere
        // and the deferral nudge's hold directive, which reads that record,
        // would never fire. The directory is the payload's cwd, the one the
        // gate's own payload names for this session's offers. The clean-tree
        // test above ran before this create, and the ignore marker the create
        // writes keeps the directory out of the next stop's reading of it.
        ensureProjectScratchDir(cwd);
    }
}

// Run as the Stop hook only when invoked directly, so a require() of this file
// loads its module without stopping anything: the throttle below is read that
// way by the stamp audit.
if (require.main === module) {
    try { main(); } catch { /* never trap the session */ }
    process.exitCode = 0;
}

// The throttle is exported because the stamp audit reads a session-written
// stamp against this heartbeat and needs the window in which the hook declines
// to restamp. One spelling of the figure serves both, so the bound and the
// behaviour it describes cannot drift apart.
module.exports = { HEARTBEAT_THROTTLE_MS };
