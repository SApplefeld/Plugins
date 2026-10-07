// bin/supervise-poll.mjs - One poll's readings and its decision, in one process.
//
// bin/supervise.sh runs this once per poll. It reads the clock, the child's
// own heartbeat file, the decision store, the run directory's restart request
// and mailbox, the tail and size of the child's stream and the harness
// transcript, takes the liveness verdict on them, hands the lot to the decide
// unit, and prints what the poll loop acts on. Each store reading follows the
// shell helper of the same name in bin/supervise.sh and bin/agentic-common.sh,
// which the paths outside the poll loop still call. A process launch under
// Git for Windows costs tenths of a second on a loaded box, so a poll that
// launches one process per reading spends longer reading than it sleeps.
//
// It writes to one file, the mailbox, through one writer (appendMailboxRecord):
// a probe where the child's heartbeat is stale and no probe has been written
// inside supervisorProbeMs, and the shutdown ask where <rundir>/shutdown.request
// is present and no ask to this child is open. Each record is built with
// JSON.stringify and ends in a newline, since the plugin parses that file and
// leaves a line with no newline yet for its next tick.
//
// Arguments, all positional so the MSYS launcher converts each path:
//   1 the child's own heartbeat file, <rundir>/heartbeat.json
//   2 store path            3 persona              4 child stream path
//   5 profile root the harness keeps its transcripts under ('' where unknown)
//   6 child session id ('' until the init line names one)
//   7 childStartTs          8 launchedAt           9 staleAfterMs
//  10 minRunMs             11 maxRestartsPerHour  12 crashCount
//  13 restartCount         14 crashLimit
//  15 run directory, which holds the restart.request file the coordinator's
//     fleet_restart tool writes ('' or absent where there is none to read)
//  16 working directory in Windows form, which names the transcript's project
//  17 the process walk this poll ran: live, none, or failed
//  18 the stream's size as the last poll saw it ('' before any poll has)
//  19 when the last poll saw that size change, epoch ms
//  20 supervisorSilenceBoundMs  21 supervisorProbeMs  22 the probe's window
//  23 supervisorFinalAskMs      24 when the final ask was written ('' if none)
//  25 the supervisor's start time, epoch ms, which prefixes every probe id
//  26 the mailbox, <rundir>/mailbox.jsonl
//  27 the plugin's ack file, <rundir>/mailbox.ack.jsonl
//  28 supervisorAskGraceMs
//  29 the open shutdown ask's id ('' if none)
//  30 when that ask was written, epoch ms ('' if none)
//  31 the shutdown ask's text, which bin/supervise.sh holds as
//     SUPERVISOR_SHUTDOWN_TEXT
// A caller passing only the first fifteen gets a walk read as incomplete,
// which reads alive: no liveness restart without the readings that earn it.
// A caller passing no mailbox writes no record of either kind.
//
// Prints eleven lines:
//   action
//   reason
//   <rate-limit reset epoch ms> <ISO 8601>, or "- -" where the child is not parked
//   child session id, or an empty line where the stream does not name one yet
//   <verdict> <reason>, the liveness reading, e.g. "alive signal"
//   the stream's size now, or an empty line where it cannot be read
//   when that size last changed, epoch ms, or an empty line
//   the final ask's time for the next poll to hand in, or an empty line
//   HEARTBEAT_ABSENT where the heartbeat file was never written and the
//     startup grace is over, or "-"
//   the open shutdown ask's id for the next poll to hand in, or an empty line
//   that ask's time, or an empty line

import fs from 'node:fs';
import path from 'node:path';
import { decide } from './supervise-decide.mjs';
import { readRestartRequest } from './supervise-restart-request.mjs';
import { liveness, transcriptPathsFor, isUsageLimitRecord } from './supervise-liveness.mjs';
import { readChildHeartbeat } from './supervise-heartbeat.mjs';

// A reading off a file reads back through parseInt, and an unparseable one
// reaches the decide unit as null. The supervisor's own settings and counts
// go through intOr instead: bin/supervise.sh validates them at startup, and
// one that still arrives unparseable takes the decide unit's own default
// rather than a null that would fire a restart or the crash limit.
function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

function intOr(value, fallback) {
  const n = intOrNull(value);
  return n === null ? fallback : n;
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    return null;
  }
}

// readChildHeartbeat is exported from bin/supervise-heartbeat.mjs, imported
// above: bin/supervise.sh's interrupt relay reads the same file for the same
// shape, through the same reader, and that script runs unconditional
// top-level CLI logic on load, so it must never be imported itself.

// The newest decision matching a test, as get_fact reads it: last in the
// array, since decisions[] is append-ordered. Null where there is none.
function newestDecision(decisions, test) {
  let newest = null;
  for (const d of decisions) {
    if (test(d)) newest = d;
  }
  return newest;
}

// Every store-borne fact the poll reads, from one read of the store, so no two
// of them can describe different moments.
export function readStoreFacts(storePath, persona) {
  const facts = {
    shutdownRequestedTs: null,
    parkRequestedTs: null,
    restartRequestedTs: null,
  };
  const store = storePath ? readJson(storePath) : null;
  const p = store && typeof store === 'object' ? store[persona] : null;
  if (!p) return facts;
  const decisions = Array.isArray(p.decisions) ? p.decisions : [];
  const ts = (d) => (d ? intOrNull(d.timestamp || 0) : null);

  // An entry that is not an object matches nothing rather than throwing, so
  // one malformed entry costs no other fact.
  const is = (action) => (x) => !!x && x.action === action;
  facts.shutdownRequestedTs = ts(newestDecision(decisions, is('shutdown_requested')));
  facts.parkRequestedTs = ts(newestDecision(decisions, is('park_requested')));
  facts.restartRequestedTs = ts(newestDecision(decisions, is('restart_requested')));
  return facts;
}

// The complete records in the tail of the child's stream, oldest first, or
// null where the stream cannot be read. Both stream readings below take their
// records from here, so they parse the same lines, but they read different
// records as the newest. The usage-limit reading passes over rate_limit_event
// records, which are quota reports written beside ordinary turns and can
// follow the record a limit ended a turn on. The rate-limit reset reads the
// last record of any type, as get_rate_limit_reset in bin/supervise.sh does,
// so the log names a park only while the retry is the last thing written.
export function readStreamRecords(streamPath) {
  const SCAN_BYTES = 262144;
  let text = '';
  let scanStart = 0;
  try {
    const fd = fs.openSync(streamPath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size > SCAN_BYTES) scanStart = size - SCAN_BYTES;
      const len = size - scanStart;
      const buf = Buffer.alloc(len);
      if (len > 0) fs.readSync(fd, buf, 0, len, scanStart);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) { return null; }
  const lines = text.split('\n');
  // The tail can start mid-line, and the file can end mid-line while the child
  // is writing. Neither partial is a record.
  if (scanStart > 0) lines.shift();
  lines.pop();
  const records = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch (e) { continue; }
    if (record && typeof record === 'object') records.push(record);
  }
  return records;
}

// Whether the child's newest word in its stream is a usage limit. The
// engine's rate_limit_event records are quota reports written beside ordinary
// turns, so they are passed over in finding the newest record, and the
// newest assistant record is handed in beside it so a result closing a turn
// the limit ended is read as that limit.
export function readStreamUsageLimit(records) {
  if (!Array.isArray(records)) return false;
  let newest = null;
  let lastAssistant = null;
  for (const record of records) {
    if (record.type === 'rate_limit_event') continue;
    newest = record;
    if (record.type === 'assistant') lastAssistant = record;
  }
  return isUsageLimitRecord(newest, lastAssistant);
}

// How much longer a rate-limited child has to wait, as get_rate_limit_reset
// reads it: only the newest complete record in the tail of the stream counts.
export function readRateLimitReset(streamPath, records = readStreamRecords(streamPath)) {
  const now = Date.now();
  if (!records) return '- -';
  const newest = records.length > 0 ? records[records.length - 1] : null;
  const isRetry = newest
    && newest.type === 'system'
    && newest.subtype === 'api_retry'
    && Number(newest.error_status) === 429
    && Number.isFinite(Number(newest.retry_delay_ms))
    && Number(newest.retry_delay_ms) > 0;
  if (!isRetry) return '- -';
  const until = now + Number(newest.retry_delay_ms);
  return until + ' ' + new Date(until).toISOString();
}

// The child's session id off the stream's init line. Runs only until a poll
// finds one. A line that is not a record is passed over, where
// read_child_session_id stops at it: the transcript reading needs this id, and a
// stray first line would otherwise leave it unread for the child's whole life.
export function readChildSessionId(streamPath) {
  let lines;
  try {
    lines = fs.readFileSync(streamPath, 'utf8').split('\n');
  } catch (e) { return ''; }
  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o && o.session_id) return String(o.session_id);
  }
  return '';
}

// The stream's age on the supervisor's own clock: the time since a poll last
// saw the file's size change. The poll process is fresh every poll, so the
// size and the moment it last changed come in from the poll loop and go back
// out with this poll's reading. A poll that has not yet seen the file, the
// first one or one after an adoption, starts the age from the file's
// modification time. An unreadable stream has no age, which is not silent.
export function readStreamAge(streamPath, seenSize, seenChangedAt, now) {
  let stat;
  try { stat = fs.statSync(streamPath); } catch (e) { return { size: null, changedAt: null, ageMs: null }; }
  const size = stat.size;
  const prevSize = intOrNull(seenSize);
  const prevAt = intOrNull(seenChangedAt);
  let changedAt;
  if (prevSize === null || prevAt === null) changedAt = Math.floor(stat.mtimeMs);
  else if (size !== prevSize) changedAt = now;
  else changedAt = prevAt;
  return { size, changedAt, ageMs: Math.max(0, now - changedAt) };
}

// Every line of a JSON-lines file that parses to an object, in file order. A
// missing or unreadable file is an empty list, and a line that does not parse
// is passed over.
function readJsonLines(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o);
  }
  return out;
}

// The probe records in the mailbox and the probe acknowledgements the child's
// plugin writes beside them. Both paths are bin/supervise.sh's, which names
// the pair once and truncates it at each launch.
export function readProbeState(mailbox, ack) {
  const records = mailbox ? readJsonLines(mailbox) : [];
  const probes = records
    .filter((r) => r.kind === 'probe' && typeof r.id === 'string' && Number.isFinite(Number(r.at)))
    .map((r) => ({ id: r.id, at: Number(r.at) }));
  const acks = (ack ? readJsonLines(ack) : [])
    .filter((r) => r.action === 'ack' && typeof r.id === 'string')
    .map((r) => ({ id: r.id }));
  return { probes, acks };
}

// The one writer of the mailbox. Appends one record { id, kind, at, text },
// built with JSON.stringify and ending in a newline, and returns its id and
// time. The id is the supervisor's start time and one more than the number of
// records already in the mailbox, so ids stay unique across supervisors
// sharing a run directory and across both kinds, and an adopting
// supervisor's first record never matches an id already in the ack file.
export function appendMailboxRecord(mailbox, kind, text, now, supervisorStartMs) {
  const record = {
    id: supervisorStartMs + '-' + (readJsonLines(mailbox).length + 1),
    kind,
    at: now,
    text,
  };
  fs.appendFileSync(mailbox, JSON.stringify(record) + '\n');
  return { id: record.id, at: record.at };
}

// Appends one probe to the mailbox where the child's heartbeat is stale and no
// probe has been written inside probeMs. Returns the probe written, or null.
export function writeProbeIfDue(mailbox, state, heartbeat, now, staleAfterMs, probeMs, supervisorStartMs) {
  if (!mailbox || supervisorStartMs === null || !heartbeat) return null;
  if (now - heartbeat.lastSeen <= staleAfterMs) return null;
  const newest = state.probes.reduce((a, p) => (a === null || p.at > a ? p.at : a), null);
  if (newest !== null && now - newest < probeMs) return null;
  return appendMailboxRecord(mailbox, 'probe',
    'liveness probe from the supervisor, acknowledged by the controller tick and never answered as a turn',
    now, supervisorStartMs);
}

// Whether the run directory holds a shutdown request: a regular file named
// shutdown.request, whatever it contains, which is how the operator or a
// keeper stops a persona on purpose. bin/supervise.sh reads the same file
// with `[ -f ]` at each launch. Never throws.
export function shutdownRequestPresent(runDir) {
  if (!runDir) return false;
  try {
    return fs.statSync(path.join(runDir, 'shutdown.request')).isFile();
  } catch (e) {
    return false;
  }
}

// Asks the child to end its session at a boundary: one shutdown record in the
// mailbox, written where a shutdown request is present and no ask to this
// child is open yet, so an open ask is never written twice. The plugin
// delivers it as a turn opening [SUPERVISOR id=<id>]. The mailbox is
// truncated at each launch, so a shutdown record already in it is this
// child's ask: where the poll loop lost its carried id, that record is handed
// back as the open ask rather than a second one written, and its grace runs
// from its own time. Returns the ask written or found, or null.
export function writeShutdownAskIfDue(runDir, mailbox, openAskId, text, now, supervisorStartMs) {
  if (!mailbox || supervisorStartMs === null || openAskId) return null;
  if (typeof text !== 'string' || text === '') return null;
  if (!shutdownRequestPresent(runDir)) return null;
  const earlier = readJsonLines(mailbox).filter((r) => r.kind === 'shutdown' && typeof r.id === 'string');
  if (earlier.length > 0) {
    const r = earlier[earlier.length - 1];
    const at = Number(r.at);
    return { id: r.id, at: Number.isFinite(at) ? at : now };
  }
  return appendMailboxRecord(mailbox, 'shutdown', text, now, supervisorStartMs);
}

export function poll(argv) {
  const [heartbeatPath, storePath, persona, streamPath, profileRoot, knownSessionId,
    childStartTs, launchedAt, staleAfterMs, minRunMs, maxRestartsPerHour,
    crashCount, restartCount, crashLimit, runDir,
    workdirWindows, walk, streamSeenSize, streamSeenChangedAt,
    silenceBoundMs, probeMs, probeWindowMs, finalAskMs, finalAskAt, supervisorStartMs,
    mailboxPath, ackPath, askGraceMs, shutdownAskId, shutdownAskAt, shutdownText] = argv;

  // Each reading fails on its own. One the reader cannot make reads as absent
  // and the rest still reach the decide unit, so a malformed store entry
  // cannot switch off a stop, and a liveness reading that throws reads alive.
  const safe = (read, absent) => { try { return read(); } catch (e) { return absent; } };
  const now = Date.now();
  const records = safe(() => readStreamRecords(streamPath), null);
  const rateLimit = safe(() => readRateLimitReset(streamPath, records), '- -');
  const childSessionId = knownSessionId || safe(() => readChildSessionId(streamPath), '');
  const facts = safe(() => readStoreFacts(storePath, persona), readStoreFacts('', persona));
  // A restart can be asked for in two places: the persona's own store, which
  // its owner writes through supervisor_restart, and the run directory's
  // request file, which the coordinator writes through fleet_restart. They
  // are one fact, so the later of the two is the one the decide unit reads.
  const requestAt = safe(() => readRestartRequest(runDir, now), null);
  const restartRequestedTs = facts.restartRequestedTs === null ? requestAt
    : requestAt === null ? facts.restartRequestedTs
      : Math.max(facts.restartRequestedTs, requestAt);

  // The liveness reading. The transcript is addressed by the session id, so
  // the poll that first reads the id off the stream reads the transcript too.
  const staleMs = intOr(staleAfterMs, 90000);
  const silenceMs = intOr(silenceBoundMs, 900000);
  const launched = intOr(launchedAt, 0);
  const heartbeat = safe(() => readChildHeartbeat(heartbeatPath, childSessionId), null);
  const stream = safe(() => readStreamAge(streamPath, streamSeenSize, streamSeenChangedAt, now), { size: null, changedAt: null, ageMs: null });
  const probeState = safe(() => readProbeState(mailboxPath, ackPath), { probes: [], acks: [] });
  const written = safe(() => writeProbeIfDue(mailboxPath, probeState, heartbeat, now, staleMs,
    intOr(probeMs, 120000), intOrNull(supervisorStartMs)), null);
  if (written) probeState.probes.push(written);
  // The shutdown ask: written once per child, then carried by the poll loop
  // as an id and a time until the child is stopped or honors it.
  const carriedAskId = shutdownAskId ? String(shutdownAskId) : '';
  const asked = safe(() => writeShutdownAskIfDue(runDir, mailboxPath, carriedAskId, shutdownText,
    now, intOrNull(supervisorStartMs)), null);
  const askId = asked ? asked.id : carriedAskId;
  // A carried id whose time does not parse starts its grace at this poll, so
  // the ask can still time out rather than stay open forever.
  const carriedAskAt = intOrNull(shutdownAskAt);
  const askAtMs = asked ? asked.at : (carriedAskId ? (carriedAskAt === null ? now : carriedAskAt) : null);
  const { transcriptPath, subagentsDir } = safe(() => transcriptPathsFor(profileRoot, workdirWindows, childSessionId),
    { transcriptPath: '', subagentsDir: '' });
  const reading = safe(() => liveness({
    transcriptPath,
    subagentsDir,
    heartbeat,
    streamAgeMs: stream.ageMs,
    streamUsageLimit: readStreamUsageLimit(records),
    probes: probeState.probes,
    acks: probeState.acks,
    probeWindowMs: intOr(probeWindowMs, 30000),
    walk: walk || 'failed',
    silenceBoundMs: silenceMs,
    staleAfterMs: staleMs,
    launchedAt: launched,
    now,
  }), { verdict: 'alive', reason: 'reading_failed', detail: 'the liveness reading failed' });
  const askAt = intOrNull(finalAskAt);

  const result = decide({
    childExitCode: null,
    shutdownRequestedTs: facts.shutdownRequestedTs,
    parkRequestedTs: facts.parkRequestedTs,
    restartRequestedTs,
    crashCount: intOr(crashCount, 0),
    crashLimit: intOr(crashLimit, 3),
    restartCount: intOr(restartCount, 0),
    childStartTs: intOr(childStartTs, 0),
    liveness: reading,
    finalAskAt: askAt,
    finalAskMs: intOr(finalAskMs, 660000),
    shutdownAskAt: askAtMs,
    askGraceMs: intOr(askGraceMs, 1200000),
    now,
    minRunMs: intOr(minRunMs, 120000),
    maxRestartsPerHour: intOr(maxRestartsPerHour, 6),
  });

  // The final ask's time for the next poll: set by the poll that asks, and
  // cleared only by a reading alive on evidence, a signal that moved or a
  // usage limit, so a later silence earns a fresh ask. A reading alive only
  // because it could not read something, an unreadable or future transcript
  // or a walk that did not complete, carries the ask's time unchanged: no
  // signal moved, and clearing there would let one failed read inside each
  // window restart a frozen child's window indefinitely.
  const clearsAsk = reading.verdict === 'alive' && (reading.reason === 'signal' || reading.reason === 'usage_limit');
  const nextAskAt = result.action === 'final_ask' ? now
    : clearsAsk ? null
      : askAt;
  const heartbeatNote = heartbeat === null && now - launched >= silenceMs ? 'HEARTBEAT_ABSENT' : '-';

  // One value per line, so a reason carrying a newline cannot shift the lines
  // under it.
  const oneLine = (s) => String(s === undefined || s === null ? '' : s).replace(/[\r\n]+/g, ' ');
  return [
    oneLine(result.action || 'continue'),
    oneLine(result.reason || ''),
    rateLimit,
    oneLine(childSessionId),
    oneLine(reading.verdict + ' ' + reading.reason),
    oneLine(stream.size),
    oneLine(stream.changedAt),
    oneLine(nextAskAt),
    heartbeatNote,
    oneLine(askId),
    oneLine(askAtMs),
  ];
}

// Run unconditionally: this file is only ever launched, never imported. A
// guard comparing this module's URL against argv would turn on how the launch
// path was spelled, and a mismatch would print nothing, which the poll loop
// reads as a failed poll on every pass.
process.stdout.write(poll(process.argv.slice(2)).join('\n') + '\n');
