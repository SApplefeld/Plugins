#!/usr/bin/env node
// SessionEnd hook: key every pointer the judged fleet block showed this session
// and the session never read to an outcome row, then clear the session's
// entries from the shown file.
//
// The judged fleet block records each candidate it judged in the project's
// `.kit/jev-shown.json`, under the session id, and `memq get` of a shown name
// marks that name's entries and writes a `kit.jev.pointer` pass row. What is
// still unmarked when the session ends is a pointer the session saw and did not
// open, so this hook writes one `kit.jev.pointer` fail row for each shown entry
// of its own session still unmarked, removes every entry of its own session,
// runs memq's stale sweep over the rest, and deletes the file once no entry
// remains. The sweep drops every entry older than seven days whoever wrote it,
// with a fail row for each one shown and unmarked, so a session killed before
// its own SessionEnd still has its misses counted. It also drops an entry
// dated more than a day ahead, with no row, since a clock stepped back could
// otherwise record a miss for a live session's pointer. A peer session's entry
// younger than the stale bound is never read or touched, with those two
// exceptions: the future-dated entry above, and a file grown past its
// reader's ceiling, which the rewrite resets whole with every entry dropped
// uncounted. A miss is thereby a row rather than an absence, which is what
// lets the calibration query count it.
//
// SessionEnd rather than Stop, because Stop fires at the end of every response
// turn and an unread row written there would count every pointer as missed
// after one turn. The session id is the payload's `session_id`, which names the
// same session as the `CLAUDE_CODE_SESSION_ID` its tool shells carry, and the
// project is the payload's `cwd`, the directory the session-start block wrote
// the file under.
//
// Every rule about the file and the journal comes from memq.js and jev-judge.js,
// which own them: the file's path, its bounded reader, its lock and its entry
// shape, the journal's write, and the shared index's local queue behind it.
// This hook restates none of them.
//
// SAFETY: never blocks, never speaks. Every path ends at exit 0 and this hook
// writes nothing to stdout or stderr: an unparseable payload, an id not of a
// session's shape, a working directory on a network share with no store pin,
// an absent or unreadable file, a lock held past its short wait, and a failed
// require all end silently.

'use strict';

const fs = require('fs');

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
    if (typeof payload.cwd !== 'string' || payload.cwd === '') return;
    if (typeof payload.session_id !== 'string' || payload.session_id === '') return;

    // Required only once a payload names a session, and inside main() so a
    // damaged plugin cache leaves the hook inert rather than ending it nonzero.
    const memq = require('../scripts/memq.js');

    // A share-shaped working directory with no store pin is not walked, the
    // session-start hook's own gate, since a synchronous walk under it can hang
    // for the SMB timeout on an unreachable host.
    if (memq.pinnedProjectSegment() === null && memq.namesNetworkShare(payload.cwd)) return;
    memq.recordUnreadPointers(payload.cwd, payload.session_id);
}

try { main(); } catch { /* an unread pointer is never worth disturbing a session's end */ }

// Zero without process.exit(): nothing above sets a code and main() is wrapped,
// so the process ends at 0 on every path, and forcing the exit could discard a
// write still in flight.
process.exitCode = 0;
