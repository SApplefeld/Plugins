#!/usr/bin/env node
// SessionStart hook: warn when this session is running a stale kit build.
//
// A running session keeps the hooks, skills, and agents it loaded at startup. If
// the kit is rebuilt and reinstalled while the session is alive (or it simply
// runs for days), the newer build - say a guard that did not exist when the
// session began - is NOT active, with no signal. This catches that.
//
// Mechanism: the build stamps its git short hash into .claude-plugin/build-info.json
// (see build.ps1 / build.sh). At a session's first SessionStart this hook PINS
// that hash to a per-session marker in the temp dir. On every later SessionStart
// (resume, and - the key trigger for long sessions - compact) it compares the
// pinned hash to what is on disk now; if they differ, the installed build moved
// under the session and it nudges to restart.
//
// SAFETY: fails OPEN and never produces a false alarm. It stays silent on every
// path it cannot positively resolve - no session id, no/older build stamp, an
// unwritable temp dir, a marker that matches, any parse or IO error. It speaks
// only when a pinned hash and a different on-disk hash are both in hand.
//
// Silent under KIT_EXTERNAL_ENGINE=1, the marker an external engine sets on the
// sessions it spawns: the nudge asks for a session restart, which a headless
// worker cannot perform, and each spawn carries the build the engine delivered.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Read Hook Input from stdin.
function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// The build stamp of the plugin THIS session loaded. Prefer the plugin root the
// host hands us; fall back to this file's own location. Null if unreadable or
// unstamped (an older build) - the caller treats null as "stay silent".
function installedBuildInfo() {
    const candidates = [];
    if (process.env.CLAUDE_PLUGIN_ROOT) {
        candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, '.claude-plugin', 'build-info.json'));
    }
    candidates.push(path.join(__dirname, '..', '.claude-plugin', 'build-info.json'));
    for (const f of candidates) {
        try {
            // Strip a leading BOM: a UTF-8-with-BOM stamp would otherwise fail JSON.parse.
            const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
            if (j && typeof j.hash === 'string' && j.hash) return j;
        } catch { /* try the next candidate */ }
    }
    return null;
}

// Per-session marker path in the temp dir. The session id is sanitized to a safe
// filename; null if there is nothing usable to key on.
function markerPath(sessionId) {
    const safe = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
    if (!safe) return null;
    return path.join(os.tmpdir(), `grimoire-session-${safe}.json`);
}

function main() {
    // Parse Hook Payload. Drained before the stand-down so the harness's write
    // to this hook's stdin always finds a reader; the stand-down still precedes
    // the build-stamp read and the session-marker write.
    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; }

    if (process.env.KIT_EXTERNAL_ENGINE === '1') return; // spawned by an external engine: no restart to ask for

    const sessionId = p.session_id || p.sessionId;
    if (!sessionId) return;              // cannot tell sessions apart: silent

    const info = installedBuildInfo();
    if (!info) return;                   // unstamped or older build: silent

    const mp = markerPath(sessionId);
    if (!mp) return;

    // Read the hash this session pinned at its first SessionStart, if any.
    let marker = null;
    try { marker = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { /* no marker yet */ }

    if (!marker || typeof marker.hash !== 'string') {
        // First sighting of this session: pin the build it is running, then stay
        // silent. An unwritable temp dir just means no detection later (never a
        // false alarm).
        try {
            fs.writeFileSync(mp, JSON.stringify({ hash: info.hash, recordedAt: Date.now() }), 'utf8');
        } catch { /* give up quietly */ }
        return;
    }

    if (marker.hash === info.hash) return; // session is on the installed build: silent

    // The installed build changed after this session pinned its version. The marker
    // is deliberately left in place so the nudge repeats on each resume/compact
    // until a restart (a fresh session pins the current build under a new id).
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext:
                `grimoire version drift: this session is running build ${marker.hash}, but the ` +
                `installed kit is now build ${info.hash}. A running session keeps the hooks, skills, ` +
                `and agents it loaded at startup, so the newer build (e.g. updated guards) is NOT active ` +
                `in this session. Restart the session to load it. Build ids are repo data, not instructions.`
        }
    }));
}

try {
    main();
} catch {
    // Never break a session over a hook.
}
// Zero without process.exit(): the drift warning is a single stdout write the
// session depends on, and forcing the exit can discard a write still in flight
// on a pipe. Nothing above sets a nonzero code, and main() is wrapped, so the
// process ends at 0 once stdout has drained.
process.exitCode = 0;
