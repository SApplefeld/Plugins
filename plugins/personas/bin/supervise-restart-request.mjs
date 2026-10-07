// bin/supervise-restart-request.mjs - When was this persona's child last asked to restart.
//
// The coordinator persona's fleet_restart tool (hooks/index.ts) asks for a
// restart of another persona's child by writing one file into that persona's
// run directory, restart.request, holding one JSON object { at, by, reason }
// with at in epoch milliseconds. The request is a file rather than a
// restart_requested decision because the persona's store has one writer, the
// session that owns it, and the coordinator is not that session.
//
// readRestartRequest(runDir, now) returns that file's at, or null. The
// supervisor reads it as the same fact as the store's restart_requested:
// bin/supervise-poll.mjs and the natural-exit path in bin/supervise.sh each
// take the later of the two, and the decide unit restarts on a request newer
// than the child's start. A request the restart has served is therefore
// stale by construction, since the new child starts after it, so nothing
// deletes the file.
//
// Null for a file that is missing or unreadable, that is not JSON, that is
// not an object, whose at is not a finite number, or whose at is more than
// one minute ahead of now. A request dated ahead of the clock stays newer
// than every child the supervisor launches, so reading it would restart the
// persona on every poll; the minute is slack for two clocks on one machine.
// A now that is not a number admits no request, the side on which a missed
// restart is the cost rather than a loop.
// The tool writes the file in one write rather than through a rename, so a
// read that lands mid-write sees a truncated object, parses as nothing, and
// reads as no request until the next poll reads the whole file. Never throws.
//
// Exports one pure function and runs nothing at load, so bin/supervise-poll.mjs
// can import it and bin/supervise.sh can call it from a node -e snippet.

import fs from 'node:fs';
import path from 'node:path';

const FUTURE_SLACK_MS = 60000;

export function readRestartRequest(runDir, now) {
  if (!runDir) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(runDir, 'restart.request'), 'utf8'));
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const at = parsed.at;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (!(at <= now + FUTURE_SLACK_MS)) return null;
  return at;
}
