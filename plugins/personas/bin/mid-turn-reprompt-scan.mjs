// bin/mid-turn-reprompt-scan.mjs - The operator messages that arrived while
// a turn was running, read from the session's own transcript.
//
//   node bin/mid-turn-reprompt-scan.mjs <home> <workdir> <session id> <stamp>
//
// The persona plugin runs this at a turn's end, from hooks/mid-turn-reprompt.ts,
// because a hook reads a file only whole and only under 4 MiB, and a
// session's transcript passes that within hours. The read is the tail
// readRecords in bin/restart-recap.mjs reads, RECAP_TAIL_BYTES long first,
// widened by SCAN_GROWTH until it reaches the window's floor or the file's
// head, and never past SCAN_CEILING_BYTES. A window whose floor lies past
// the ceiling is still scanned over what the ceiling's reach holds, and the
// closing line then names the floor the reach stopped short of, since a
// transcript only grows and no later read could reach it either.
//
// Which file. The transcript root is <home>/.claude/projects, the folder is
// the one whose name equals projectKey(workdir) without regard to case, as
// transcriptFolders resolves it, and the file is <session id>.jsonl. A
// session id the file-name guard in transcriptPathsFor refuses names no file.
//
// Which records. A message the harness delivers while a turn is running is
// recorded as an attachment record of type queued_command whose prompt is
// the message's own <channel ...> tag and text, stamped with the relay's
// origin. operatorCarrier reads that stamp, and only an attachment carrier
// counts here: a user record is a message that opened a turn of its own, and
// the queue-operation records that bracket a queued message carry its text
// and are the queue's bookkeeping. A carrier whose tag reads as the
// operator's is taken; one whose tag reads as a participant's is counted and
// not taken. A record with any other origin, the keyboard's kind "human"
// among them, is neither.
//
// The window. A record is in the window where its timestamp, parsed as
// milliseconds, is at or after the stamp less TOLERANCE_MS, since the
// harness stamps the record and the plugin stamps the turn on two paths of
// the same clock. The plugin keeps a record from being taken twice across
// that tolerance by the covered timestamp it holds.
//
// Output. One JSON line per taken record, in file order, each
//   { "timestamp": <milliseconds>, "prompt": <the record's prompt> }
// then one closing line { "participants": <count> }. Where the ceiling's
// reach stopped short of the window's floor, the closing line also carries
//   "unreached": { "floor": <the window's floor>, "reachFloor": <the stamp
//   of the first record the reach held, or null where none carried one> }
// in milliseconds. The exit code is 0 where the transcript was read, the
// unreached case included, and 2 where it could not be found or read, with
// the reason on stderr; a usage error exits 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcriptPathsFor } from './supervise-liveness.mjs';
import { RECAP_TAIL_BYTES, operatorCarrier, readRecords, taggedSender, transcriptFolders } from './restart-recap.mjs';

// How far before the turn's start stamp a record may sit and still be in
// the window.
export const TOLERANCE_MS = 2000;

// The most of a transcript the read widens to, in bytes. A turn rarely
// writes past the recap's 2 MiB tail, and a day of a busy session is near
// this bound. The hook kills the scan at RECAP_TIMEOUT_MS, which bounds the
// widening reads together with everything else the scan does.
export const SCAN_CEILING_BYTES = 64 * 1024 * 1024;
// The factor each widened read grows by, so the tail runs 2, 8, 32 then
// 64 MiB.
const SCAN_GROWTH = 4;

/**
 * The four positional arguments, or a usage error.
 * @param {string[]} argv
 * @returns {{home: string, workdir: string, sessionId: string, stamp: number}}
 */
export function parseArgs(argv) {
  if (argv.length !== 4) throw new Error('usage: mid-turn-reprompt-scan.mjs <home> <workdir> <session id> <stamp>');
  const [home, workdir, sessionId, stampText] = argv;
  const stamp = Number(stampText);
  if (!home || !workdir || !sessionId) throw new Error('home, workdir and session id must each be non-empty');
  if (!Number.isFinite(stamp)) throw new Error('the stamp must be a number of milliseconds');
  return { home, workdir, sessionId, stamp };
}

/**
 * The transcript file for a session, by the recap's folder rule, or null
 * where the root cannot be listed, no folder matches or no folder holds the
 * file. The first matching folder holding the file wins, the one named
 * exactly by the key first.
 * @param {string} home
 * @param {string} workdir
 * @param {string} sessionId
 * @returns {string|null}
 */
export function transcriptFileFor(home, workdir, sessionId) {
  const { transcriptPath } = transcriptPathsFor('placeholder-root', workdir, sessionId);
  if (!transcriptPath) return null;
  const name = path.basename(transcriptPath);
  const folders = transcriptFolders(path.join(home, '.claude', 'projects'), workdir);
  if (folders === null) return null;
  for (const folder of folders) {
    const file = path.join(folder.path, name);
    try { if (fs.statSync(file).isFile()) return file; } catch (e) { /* this folder does not hold it */ }
  }
  return null;
}

/**
 * The scan over records already read: the taken records in file order and
 * the participant count.
 * @param {object[]} records
 * @param {number} stamp
 * @returns {{taken: {timestamp: number, prompt: string}[], participants: number}}
 */
export function scanRecords(records, stamp) {
  const floor = stamp - TOLERANCE_MS;
  const taken = [];
  let participants = 0;
  for (const r of records) {
    if (!r || r.type !== 'attachment') continue;
    const prompt = operatorCarrier(r);
    if (prompt === null) continue;
    const at = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN;
    if (!Number.isFinite(at) || at < floor) continue;
    if (taggedSender(prompt).kind === 'operator') taken.push({ timestamp: at, prompt });
    else participants += 1;
  }
  return { taken, participants };
}

/**
 * Whether records read from a tail reach the window's floor: the first one
 * carrying a parseable timestamp is stamped at or before it. A tail whose
 * records all lack a timestamp reaches nothing.
 * @param {object[]} records
 * @param {number} floor
 * @returns {boolean}
 */
export function reachesFloor(records, floor) {
  const at = firstStamp(records);
  return at !== null && at <= floor;
}

/**
 * The stamp of the first record in file order carrying a parseable
 * timestamp, in milliseconds, or null where none carries one. The reach's
 * floor, since the harness appends records in time order.
 * @param {object[]} records
 * @returns {number|null}
 */
export function firstStamp(records) {
  for (const r of records) {
    if (!r || typeof r.timestamp !== 'string') continue;
    const at = Date.parse(r.timestamp);
    if (Number.isFinite(at)) return at;
  }
  return null;
}

/**
 * The whole scan for one session. Throws where the transcript cannot be
 * found or read, which the launcher below turns into exit 2. Where the
 * window's floor lies more than SCAN_CEILING_BYTES before the end of the
 * file, the scan runs over the ceiling's reach and the result carries
 * `unreached`, naming the floor and the reach's own floor.
 * @param {{home: string, workdir: string, sessionId: string, stamp: number}} args
 * @returns {{taken: {timestamp: number, prompt: string}[], participants: number, unreached?: {floor: number, reachFloor: number|null}}}
 */
export function scan(args) {
  const file = transcriptFileFor(args.home, args.workdir, args.sessionId);
  if (file === null) throw new Error('no transcript for session ' + args.sessionId + ' under ' + path.join(args.home, '.claude', 'projects'));
  const floor = args.stamp - TOLERANCE_MS;
  let tailBytes = RECAP_TAIL_BYTES;
  for (;;) {
    const read = readRecords(file, tailBytes);
    if (read === null) throw new Error('the transcript could not be read: ' + file);
    // The size is read after the records, so a file that grew while they
    // were read widens once more rather than passing for one read whole.
    let size;
    try { size = fs.statSync(file).size; } catch (e) { throw new Error('the transcript could not be read: ' + file); }
    if (tailBytes >= size || reachesFloor(read.records, floor)) return scanRecords(read.records, args.stamp);
    if (tailBytes >= SCAN_CEILING_BYTES) {
      return { ...scanRecords(read.records, args.stamp), unreached: { floor, reachFloor: firstStamp(read.records) } };
    }
    tailBytes = Math.min(tailBytes * SCAN_GROWTH, SCAN_CEILING_BYTES);
  }
}

// Whether node was asked to run this file, rather than one that imported it,
// by the rule bin/restart-recap.mjs applies.
function launchedDirectly() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  const real = (p) => { try { return fs.realpathSync(p).toLowerCase(); } catch (e) { return p.toLowerCase(); } };
  return real(entry) === real(self);
}

if (launchedDirectly()) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write('mid-turn-reprompt-scan: ' + e.message + '\n');
    process.exitCode = 1;
  }
  if (args) {
    try {
      const out = scan(args);
      const lines = out.taken.map((t) => JSON.stringify(t));
      lines.push(JSON.stringify(out.unreached ? { participants: out.participants, unreached: out.unreached } : { participants: out.participants }));
      process.stdout.write(lines.join('\n') + '\n');
      process.exitCode = 0;
    } catch (e) {
      process.stderr.write('mid-turn-reprompt-scan: ' + e.message + '\n');
      process.exitCode = 2;
    }
  }
}
