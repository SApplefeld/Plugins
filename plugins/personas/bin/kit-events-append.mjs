// bin/kit-events-append.mjs - One line onto the kit event stream.
//
// The personas plugin spawns this script for every event it writes, since the
// engine's file API has no append and a whole rewrite of a file six personas
// share would lose each other's lines. It reads one event as JSON on stdin
// and appends one line to the sink, the file the Channels broker tails:
//
//   node bin/kit-events-append.mjs <sink>
//
// The sink is the one argument, <home>/.claude/kit-events.jsonl as the hook
// resolves it; the script reads no environment of its own. The record on
// stdin is { ts, event, project, plan, session, detail }. A record that is
// not a JSON object, that lacks event, plan or session, or that carries a
// field that is not a string, is dropped. ts is kept as given only where it
// is an ISO 8601 UTC instant ending in Z, to the second or the millisecond,
// and stamped from this process's clock otherwise; project reads as empty
// where absent; detail is written only where it was given.
//
// Every field is sanitized display data: each is reduced to printable ASCII
// and cut, at 40 characters for event and detail, 120 for plan and session,
// and 260 for project, a Windows absolute path bound. A goal-blocked
// record's detail, the worker's reason for the stop, is cut at 200 instead.
// The cut adds no mark: the hook marks a reason it cut and hands this script
// a detail inside the bound. The values carry session data such as a path
// and a session id, and the contract holds at this boundary for the whole
// record, so no caller can widen what reaches the consumer.
//
// A sink that exists and is not a regular file is left untouched and nothing
// is written: opening a FIFO blocks, which no try/catch can rescue. The stat
// is an lstat, so a symbolic link or junction already at the path reads as a
// link, not as its target, and is refused. A link raced in between the lstat
// and the append, or a hard link, is not refused, and the append writes
// through it. Only a process under the operator's own account can plant
// either, which the threat models exclude. An absent sink is the ordinary
// case: its directory is created and the append starts the file.
//
// Rotation is best-effort: a sink already larger than 1 MB is renamed to
// <sink>.old, replacing any previous .old, and the append starts a fresh
// file. The stat, rename and append are not atomic across processes, and a
// rename that keeps failing degrades to a sink that grows without bound
// rather than to lost events.
//
// The stream is observability, never a decision input. The whole body is
// wrapped, nothing is written to stdout, and the exit is 0 whatever happens,
// so an unwritable sink, a full disk or a bad record can neither throw into
// the hook's control flow nor give it something to branch on.

import fs from 'node:fs';
import path from 'node:path';

const CAPS = { event: 40, detail: 40, plan: 120, session: 120, project: 260 };
// The detail cap of a record whose written event is goal-blocked.
const BLOCKED_DETAIL_CAP = 200;
const ROTATE_BYTES = 1024 * 1024;
// The one ts shape the consumer is handed: a UTC instant with its Z, to the
// second or the millisecond, naming a real calendar instant.
const ISO_TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/;

// True where ts has the shape and names the instant it spells: a value such
// as 2026-02-30T00:00:00Z, which Date would roll into March, is refused.
function isInstant(ts) {
  if (typeof ts !== 'string' || !ISO_TS.test(ts)) return false;
  const ms = Date.parse(ts);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === ts.slice(0, 19);
}

// One field as printable ASCII, cut to its cap.
function eventField(value, cap) {
  return String(value).replace(/[^\x20-\x7E]/g, '').slice(0, cap);
}

// The record to write, or null where the input is not one.
function recordOf(text) {
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  for (const k of Object.keys(d)) if (typeof d[k] !== 'string') return null;
  if (!d.event || !d.plan || !d.session) return null;
  const record = {
    ts: isInstant(d.ts) ? d.ts : new Date().toISOString(),
    event: eventField(d.event, CAPS.event),
    project: eventField(d.project === undefined ? '' : d.project, CAPS.project),
    plan: eventField(d.plan, CAPS.plan),
    session: eventField(d.session, CAPS.session),
  };
  // The key is present exactly when the caller supplied a detail.
  if (d.detail !== undefined && d.detail !== '') {
    record.detail = eventField(d.detail, record.event === 'goal-blocked' ? BLOCKED_DETAIL_CAP : CAPS.detail);
  }
  return record;
}

try {
  const sink = process.argv[2];
  const record = sink ? recordOf(fs.readFileSync(0, 'utf8')) : null;
  if (record) {
    let st = null;
    try { st = fs.lstatSync(sink); } catch { /* no sink yet: the append creates it */ }
    if (!st || st.isFile()) {
      if (st && st.size > ROTATE_BYTES) {
        try { fs.renameSync(sink, sink + '.old'); } catch { /* cannot rotate: append to the sink as it is */ }
      }
      fs.mkdirSync(path.dirname(sink), { recursive: true });
      fs.appendFileSync(sink, JSON.stringify(record) + '\n', 'utf8');
    }
  }
} catch { /* the event stream is best-effort; a failed append changes nothing */ }
process.exitCode = 0;
