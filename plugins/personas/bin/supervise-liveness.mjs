// bin/supervise-liveness.mjs - Is the child alive, frozen or gone.
//
// Five signals in, one verdict out, from the closed set alive, frozen, gone.
// Each signal errs in a known direction and none alone establishes that a
// session is gone, so the verdict is frozen or gone only where every signal is
// silent past its own bound at once:
//
//   transcript  the newest timestamp on a turn record, a record whose type is
//               assistant or user, across the last 256 KiB of the session's own
//               transcript and of every transcript under its subagents/
//               directory. A running turn writes one at least every ten
//               minutes, because the harness caps every tool call there, and a
//               session awaiting a dispatch is read through the dispatch's own
//               transcript. Silent past supervisorSilenceBoundMs.
//   stream      how long ago the supervisor last saw the child's stdout.jsonl
//               change size, on its own clock. Silent past the same bound.
//   heartbeat   the lastSeen in <rundir>/heartbeat.json, a file only this
//               child writes. Silent past staleAfterMs. A file never written
//               is not silent.
//   probe       a probe record in <rundir>/mailbox.jsonl that the child's
//               plugin acknowledges in mailbox.ack.jsonl. Silent while a probe
//               older than its window has no ack, and no ack has arrived for
//               a probe written after it, whatever newer probes are still
//               inside their own windows. A probe never written is not silent.
//   walk        the process-tree walk the poll loop ran: live, none, or
//               failed where it did not complete.
//
// The verdict, decided in this order:
//   1. alive, reason usage_limit, where the newest stream record is a
//      usage-limit record and the walk found a live process. The cause is the
//      API, so a restart cannot help.
//   2. alive, reason startup_grace, inside supervisorSilenceBoundMs of launch.
//   3. alive, reason transcript_unreadable, where no turn record can be read:
//      the path is unknown or missing, every transcript is unreadable, or no
//      tail holds a turn record. A wrong project key lands here, and reads
//      every child as alive rather than killing working ones.
//   4. alive, reason transcript_ahead, where the newest turn record is more
//      than five minutes ahead of the clock. A smaller lead is skew and reads
//      as now.
//   5. alive, reason walk_incomplete, where the walk did not complete.
//   6. alive, reason signal, where any signal is not silent.
//   7. frozen where every signal is silent and the walk found a live process;
//      gone where it found none.
// Every fail-closed case reads alive, because killing a live session costs
// two sessions in one tree and waiting on a dead one costs the bound.
//
// Pure apart from reading the transcript files it is handed. Every read is
// wrapped, so a missing or unparsable file yields its fail-closed reading and
// never a throw. The same rule is the kit's leash-takeover instrument in the
// grimoire repository; a divergence between the two readers goes to
// docs/backlog.md rather than being reconciled silently in one of them.

import fs from 'node:fs';
import path from 'node:path';

export const TRANSCRIPT_SCAN_BYTES = 262144;
export const AHEAD_TOLERANCE_MS = 300000;
export const VERDICTS = Object.freeze(['alive', 'frozen', 'gone']);

/**
 * @typedef {Object} HeartbeatEntry
 * @property {number} lastSeen - Epoch ms the child last stamped its own heartbeat file.
 */

/**
 * @typedef {Object} ProbeRecord
 * @property {string} id - The probe's id, as written to the mailbox.
 * @property {number} at - Epoch ms the supervisor wrote it.
 */

/**
 * @typedef {Object} AckRecord
 * @property {string} id - The id of the probe the plugin acknowledged.
 */

/**
 * @typedef {Object} LivenessInput
 * @property {string} [transcriptPath] - The session's own transcript, '' where it cannot be named yet.
 * @property {string} [subagentsDir] - The session's subagents/ directory.
 * @property {HeartbeatEntry|null} [heartbeat] - The child's own heartbeat entry, null where the file was never written.
 * @property {number|null} [streamAgeMs] - Time since the supervisor last saw stdout.jsonl change size, null where unreadable.
 * @property {boolean} [streamUsageLimit] - True where the newest stream record is a usage-limit record.
 * @property {ProbeRecord[]} [probes] - Probe records in the mailbox, in file order.
 * @property {AckRecord[]} [acks] - Ack records in the ack file.
 * @property {number} [probeWindowMs] - How long a probe waits for its ack before it reads silent.
 * @property {string} [walk] - 'live', 'none', or anything else for a walk that did not complete.
 * @property {number} [silenceBoundMs] - supervisorSilenceBoundMs: the transcript and stream bound, and the startup grace.
 * @property {number} [staleAfterMs] - The heartbeat's bound.
 * @property {number} [launchedAt] - Epoch ms the child was launched.
 * @property {number} now - The clock this reading is taken against.
 */

/**
 * @typedef {Object} LivenessOutput
 * @property {string} verdict - 'alive' | 'frozen' | 'gone'
 * @property {string} reason - One word naming the rule that decided the verdict.
 * @property {{transcript: number|null, stream: number|null, heartbeat: number|null, probe: number|null}} ages - Each signal's age in ms, null where it has none.
 * @property {{transcript: boolean, stream: boolean, heartbeat: boolean, probe: boolean}} silent - Which signals read silent.
 * @property {string} walk - The walk result as handed in.
 * @property {string} detail - The five signals in one line, for the log.
 */

/**
 * The harness's project key for a working directory: its absolute Windows
 * path with every character that is not an ASCII letter or digit replaced by
 * a hyphen. The underscore is replaced too, which a rule keyed on separators
 * alone misses, and a wrong key finds no transcript at all.
 * @param {string} workdirWindows
 * @returns {string}
 */
export function projectKey(workdirWindows) {
  return String(workdirWindows || '').replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Where the harness keeps one session's transcript and its subagents/
 * directory, under <profile>/.claude/projects/<key>/. Empty strings where the
 * profile, the working directory or a usable session id is missing, which the
 * verdict reads as an unreadable transcript.
 * @param {string} profileRoot
 * @param {string} workdirWindows
 * @param {string} sessionId
 * @returns {{transcriptPath: string, subagentsDir: string}}
 */
export function transcriptPathsFor(profileRoot, workdirWindows, sessionId) {
  if (!profileRoot || !workdirWindows || !/^[A-Za-z0-9_-]+$/.test(String(sessionId || ''))) {
    return { transcriptPath: '', subagentsDir: '' };
  }
  const dir = path.join(profileRoot, '.claude', 'projects', projectKey(workdirWindows));
  return {
    transcriptPath: path.join(dir, sessionId + '.jsonl'),
    subagentsDir: path.join(dir, sessionId, 'subagents'),
  };
}

// The tail of a file as whole lines, or null where it cannot be read. The
// tail can start mid-line and the file can end mid-line while it is being
// written, and neither partial is a record.
function readTailLines(file, scanBytes) {
  let text = '';
  let scanStart = 0;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size > scanBytes) scanStart = size - scanBytes;
      const len = size - scanStart;
      const buf = Buffer.alloc(len);
      let bytesRead = 0;
      while (bytesRead < len) {
        const n = fs.readSync(fd, buf, bytesRead, len - bytesRead, scanStart + bytesRead);
        if (n === 0) break;
        bytesRead += n;
      }
      text = buf.toString('utf8', 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
  const lines = text.split('\n');
  if (scanStart > 0) lines.shift();
  lines.pop();
  return lines;
}

// The newest turn-record timestamp in one transcript's tail, or null.
function newestTurnTsIn(file) {
  const lines = readTailLines(file, TRANSCRIPT_SCAN_BYTES);
  if (!lines) return null;
  let newest = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch (e) { continue; }
    if (!record || typeof record !== 'object') continue;
    if (record.type !== 'assistant' && record.type !== 'user') continue;
    const ts = typeof record.timestamp === 'string' || typeof record.timestamp === 'number'
      ? new Date(record.timestamp).getTime() : NaN;
    if (Number.isFinite(ts) && (newest === null || ts > newest)) newest = ts;
  }
  return newest;
}

// Every .jsonl file under a directory, at any depth. A directory that cannot
// be listed contributes nothing.
function transcriptsUnder(dir) {
  const out = [];
  if (!dir) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...transcriptsUnder(p));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

/**
 * The newest turn-record timestamp across the session's own transcript and
 * every transcript under its subagents/ directory. Null where the session's
 * own transcript cannot be read, or where no tail holds a turn record.
 *
 * The session's own transcript is always read. A subagent transcript is read
 * only where its modification time is at or after minSubagentMtimeMs: a file
 * last written before that holds no record that could read as not silent, and
 * a long session accumulates many finished dispatches whose tails would
 * otherwise be read on every poll. A subagent file that cannot be stat'ed
 * contributes nothing, as one that cannot be read does.
 * @param {string} transcriptPath
 * @param {string} subagentsDir
 * @param {number} [minSubagentMtimeMs] - Subagent transcripts modified before this are not read.
 * @returns {{ts: number|null, source: string}}
 */
export function readNewestTurnTs(transcriptPath, subagentsDir, minSubagentMtimeMs = -Infinity) {
  if (!transcriptPath) return { ts: null, source: 'none' };
  try {
    fs.accessSync(transcriptPath, fs.constants.R_OK);
  } catch (e) {
    return { ts: null, source: 'none' };
  }
  let ts = newestTurnTsIn(transcriptPath);
  let source = ts === null ? 'none' : 'own';
  for (const file of transcriptsUnder(subagentsDir)) {
    let mtimeMs;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch (e) { continue; }
    if (!(mtimeMs >= minSubagentMtimeMs)) continue;
    const sub = newestTurnTsIn(file);
    if (sub !== null && (ts === null || sub > ts)) {
      ts = sub;
      source = 'subagent';
    }
  }
  return { ts, source };
}

// The openings of the messages the harness writes when a usage limit ends a
// turn, copied from the harness's own recognizer for this state, which
// matches a message that starts with one of them. The middle dot in the two
// org messages is U+00B7, as the harness writes it.
const USAGE_LIMIT_PREFIXES = Object.freeze([
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  "Your org is out of usage \u00B7 add funds to continue",
  "Your org is out of usage \u00B7 contact your admin",
  "Your seat type doesn't include usage credits",
  "Your seat type doesn't include usage",
  "Your usage allocation has been disabled by your admin",
  "Your group's usage limit is set to $0",
  "Fable 5 requires usage credits",
  "You're out of extra usage",
  "Your seat type doesn't include extra usage",
]);
// The one pattern the harness adds beside that list, for a model that needs
// usage credits.
const USAGE_LIMIT_PATTERNS = Object.freeze([/^Fable(?: [^\u00B7\n]{1,40})? requires usage credits\./]);
// The assistant errors a usage limit ends a turn on. The harness reports
// rate_limit as rate limited and billing_error as a usage limit reached, and
// in both the cause is the API, which a restart cannot change.
const USAGE_LIMIT_ERRORS = Object.freeze(['rate_limit', 'billing_error']);

/**
 * Whether a stream record is one a usage limit leaves as the child's newest
 * word. Two kinds count: the engine's api_retry carrying error_status 429,
 * and the no-usage error a turn ends on, which is an assistant record whose
 * error is rate_limit or billing_error, or the result record closing that
 * turn. The result is matched on its is_error flag with either the turn's
 * own assistant record carrying one of those errors, handed in as the second
 * argument, or a result text that starts, once trimmed, with one of the
 * harness's limit-message openings or matches its model-credit pattern.
 * @param {object|null} record
 * @param {object|null} [lastAssistant]
 * @returns {boolean}
 */
export function isUsageLimitRecord(record, lastAssistant = null) {
  if (!record || typeof record !== 'object') return false;
  if (record.type === 'system' && record.subtype === 'api_retry' && Number(record.error_status) === 429) return true;
  if (record.type === 'assistant' && USAGE_LIMIT_ERRORS.includes(record.error)) return true;
  if (record.type === 'result' && record.is_error === true) {
    if (lastAssistant && typeof lastAssistant === 'object' && USAGE_LIMIT_ERRORS.includes(lastAssistant.error)) return true;
    const text = typeof record.result === 'string' ? record.result.trim() : '';
    return USAGE_LIMIT_PREFIXES.some((p) => text.startsWith(p)) || USAGE_LIMIT_PATTERNS.some((re) => re.test(text));
  }
  return false;
}

function finiteOrNull(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// The probe signal. Silent where a probe older than its window has no ack and
// no probe written at or after it has one either: an ack arriving for a
// later probe is the child answering. A fresh probe every probe interval
// therefore cannot hold a frozen child at alive.
function probeReading(probes, acks, windowMs, now) {
  const list = Array.isArray(probes) ? probes.filter((p) => p && typeof p.id === 'string' && finiteOrNull(p.at) !== null) : [];
  const acked = new Set(Array.isArray(acks) ? acks.filter((a) => a && typeof a.id === 'string').map((a) => a.id) : []);
  if (list.length === 0) return { age: null, silent: false };
  const window = finiteOrNull(windowMs) === null ? 0 : windowMs;
  for (const p of list) {
    if (acked.has(p.id) || now - p.at <= window) continue;
    const answeredLater = list.some((q) => q.at >= p.at && acked.has(q.id));
    if (!answeredLater) return { age: now - p.at, silent: true };
  }
  const newest = list.reduce((a, b) => (b.at >= a.at ? b : a));
  return { age: now - newest.at, silent: false };
}

function secs(ms) {
  return ms === null ? 'none' : Math.round(ms / 1000) + 's';
}

/**
 * The liveness verdict for one poll.
 * @param {LivenessInput} input
 * @returns {LivenessOutput}
 */
export function liveness(input) {
  const {
    transcriptPath = '',
    subagentsDir = '',
    heartbeat = null,
    streamAgeMs = null,
    streamUsageLimit = false,
    probes = [],
    acks = [],
    probeWindowMs = 0,
    walk = '',
    silenceBoundMs = 900000,
    staleAfterMs = 90000,
    launchedAt = 0,
    now,
  } = input || {};

  const turn = readNewestTurnTs(transcriptPath, subagentsDir, now - silenceBoundMs);
  let transcriptAge = turn.ts === null ? null : now - turn.ts;
  const ahead = transcriptAge !== null && transcriptAge < -AHEAD_TOLERANCE_MS;
  if (transcriptAge !== null && transcriptAge < 0 && !ahead) transcriptAge = 0;

  const streamAge = finiteOrNull(streamAgeMs);
  const lastSeen = heartbeat && typeof heartbeat === 'object' ? finiteOrNull(heartbeat.lastSeen) : null;
  const heartbeatAge = lastSeen === null ? null : now - lastSeen;
  const probe = probeReading(probes, acks, probeWindowMs, now);

  const silent = {
    transcript: transcriptAge !== null && !ahead && transcriptAge > silenceBoundMs,
    stream: streamAge !== null && streamAge > silenceBoundMs,
    heartbeat: heartbeatAge !== null && heartbeatAge > staleAfterMs,
    probe: probe.silent,
  };
  const ages = { transcript: ahead ? null : transcriptAge, stream: streamAge, heartbeat: heartbeatAge, probe: probe.age };
  const walkResult = walk === 'live' || walk === 'none' ? walk : 'failed';
  const detail = 'transcript ' + (turn.ts === null ? 'unreadable' : ahead ? 'ahead' : secs(transcriptAge) + (turn.source === 'subagent' ? ' (subagent)' : ''))
    + ', stream ' + secs(streamAge)
    + ', heartbeat ' + (heartbeatAge === null ? 'never written' : secs(heartbeatAge))
    + ', probe ' + (probe.age === null ? 'never written' : secs(probe.age) + (probe.silent ? ' unacknowledged' : ''))
    + ', walk ' + walkResult;
  const out = (verdict, reason) => ({ verdict, reason, ages, silent, walk: walkResult, detail });

  if (streamUsageLimit === true && walkResult === 'live') return out('alive', 'usage_limit');
  if (now - launchedAt < silenceBoundMs) return out('alive', 'startup_grace');
  if (turn.ts === null) return out('alive', 'transcript_unreadable');
  if (ahead) return out('alive', 'transcript_ahead');
  if (walkResult === 'failed') return out('alive', 'walk_incomplete');
  if (!silent.transcript || !silent.stream || !silent.heartbeat || !silent.probe) return out('alive', 'signal');
  return out(walkResult === 'live' ? 'frozen' : 'gone', 'all_silent');
}

export default liveness;
