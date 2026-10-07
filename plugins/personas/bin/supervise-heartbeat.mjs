// bin/supervise-heartbeat.mjs - the child's own heartbeat file, read as a
// pure function.
//
// bin/supervise-poll.mjs writes this file's shape and is the file's first
// reader, for the liveness verdict's own heartbeat signal. bin/supervise.sh's
// relay_interrupt_request reads the same file for a second question, whether
// the child's currently running turn began at or before the coordinator's
// interrupt request. The read belongs here, its own module, rather than in
// bin/supervise-poll.mjs, because that script runs its own top-level CLI
// logic unconditionally on load (never imported, by its own header comment),
// so importing it from bin/supervise.sh's node --input-type=module -e
// snippet would run that logic against the wrong argv. Both readers import
// this module instead, so neither can disagree about what counts as this
// child's heartbeat or as unreadable.
//
// Exports one pure function and runs nothing at load.

import fs from 'node:fs';

function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    return null;
  }
}

// The child's own heartbeat file, { sessionId, lastSeen, turnStartedAt }, which
// only that child writes. The shared workdir sidecar is not read: every
// persona launched in one directory rewrites it whole, so one session's entry
// can read stale while it stamps on time. Null where the file was never
// written, cannot be parsed, carries no lastSeen, or names another session
// than this child's, which is the file an earlier child left behind.
// turnStartedAt is read the same way lastSeen is: null where the field is
// absent or not a whole number, which is the shape between turns.
export function readChildHeartbeat(heartbeatPath, childSessionId) {
  const hb = heartbeatPath ? readJson(heartbeatPath) : null;
  if (!hb || typeof hb !== 'object') return null;
  const lastSeen = intOrNull(hb.lastSeen);
  if (lastSeen === null) return null;
  if (hb.sessionId && childSessionId && String(hb.sessionId) !== childSessionId) return null;
  return { lastSeen, turnStartedAt: intOrNull(hb.turnStartedAt) };
}
