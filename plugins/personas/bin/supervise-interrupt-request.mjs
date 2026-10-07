// bin/supervise-interrupt-request.mjs - When was this persona's child last
// asked to interrupt its running turn, and by whom and why.
//
// The coordinator persona's fleet_interrupt tool (hooks/index.ts) asks for an
// interrupt of another persona's child by writing one file into that
// persona's run directory, interrupt.request, holding one JSON object
// { at, by, reason } with at in epoch milliseconds. The request is a file
// rather than a store decision for the same reason restart.request is: the
// persona's store has one writer, the session that owns it, and the
// coordinator is not that session.
//
// readInterruptRequest(runDir, now) returns { at, by, reason }, or null. The
// supervisor reads it on every poll of a running child (bin/supervise.sh),
// comparing at against the child's own start and against the time of the
// last interrupt this child's supervisor relayed, so nothing here decides
// whether to relay; this module only says what the standing request is.
//
// Null for a file that is missing or unreadable, that is not JSON, that is
// not an object, whose at is not a finite number, or whose at is more than
// one minute ahead of now. A request dated ahead of the clock stays newer
// than every child the supervisor launches, so reading it would relay an
// interrupt on every poll; the minute is slack for two clocks on one
// machine. A now that is not a number admits no request, the side on which a
// missed interrupt is the cost rather than a loop. by and reason are read as
// strings where the file carries them so, and as empty strings where either
// is absent or not a string: a shape this loose cannot itself trigger a
// relay, since at alone decides that.
// The tool writes the file in one write rather than through a rename, so a
// read that lands mid-write sees a truncated object, parses as nothing, and
// reads as no request until the next poll reads the whole file. Never throws.
//
// Exports one pure function and runs nothing at load, so bin/supervise.sh can
// call it from a node --input-type=module -e snippet.

import fs from 'node:fs';
import path from 'node:path';

const FUTURE_SLACK_MS = 60000;

export function readInterruptRequest(runDir, now) {
  if (!runDir) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(runDir, 'interrupt.request'), 'utf8'));
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const at = parsed.at;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (!(at <= now + FUTURE_SLACK_MS)) return null;
  const by = typeof parsed.by === 'string' ? parsed.by : '';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  return { at, by, reason };
}
