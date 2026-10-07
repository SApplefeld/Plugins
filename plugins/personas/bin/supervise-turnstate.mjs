// bin/supervise-turnstate.mjs - Is the child inside a turn, or between them.
//
// A path and a clock value in, one word out: busy or idle. Answers from the
// newest conversational record it can find in the child's own
// child-<n>/stdout.jsonl, touching nothing else the child wrote. The
// contract this serves: a child mid-turn gets more time before a stop
// signals it, a child that has finished a turn and gone quiet does not.
// The patient stop the plan's Section 2 builds is what reads this.
//
// Arguments, both positional:
//   1 path to child-<n>/stdout.jsonl
//   2 clock value in epoch milliseconds, used as "now" when aging a quiet
//     text-only reply. Milliseconds, not seconds: a value too small to be a
//     plausible epoch-ms "now" is not trusted as a mis-scaled clock, and
//     Date.now() is used in its place instead.
//
// Prints exactly one word, busy or idle, and nothing else. Most failure paths
// -- a missing file, an unreadable one, a tail whose scan reaches the start
// of the file and holds no conversational record or turn-start marker --
// read idle, so a fault in this reader falls back to the stop phases'
// behavior before this module existed, rather than holding a dead child's
// persona for the patient cap. Where the tail's scan does not reach the
// start of the file and neither is found, this reads busy on purpose: a
// record (or run of records) wider than the widening ceiling sits behind the
// window, and giving up and reading idle there is the kill-a-working-child
// direction (see the widening note below).
//
// Conversational records are of type assistant and user; rate_limit_event
// records are skipped when looking for the newest one, as are system records
// other than the two turn-start subtypes described below. A user record
// reads busy (the model owes a reply). An assistant record carrying a
// tool_use block reads busy (a tool is running). An assistant record with no
// tool_use block reads busy while younger than five minutes and idle once
// older. Inside a turn, the record that follows a text-only record is most
// often a tool_use block of the same API response, and the stream writes
// nothing while the model generates that block's input, which scales with
// the input's size. The age is taken from that record's own
// timestamp field, not the file's modification time: a run of later system
// records (a rate-limit retry, an init line) can keep the file's mtime fresh
// long after the turn that produced the text reply has ended, and mtime
// aging would then misread that child as busy. The file's modification time
// is used only when the record carries no timestamp field the reader can
// parse.
//
// A channel-driven child's own prompt is never written to the stream as a
// user record: the marker records visible for a new turn are a system
// record of subtype init, followed by a run of system records of subtype
// thinking_tokens while the model is still generating. thinking_tokens also
// appears mid-turn, on a response the model is still generating, and busy
// is the right answer either way. Neither subtype carries a timestamp.
// Where one of those sits after the newest conversational record in the
// tail, or the tail holds one and no conversational record at all, this
// reads busy regardless of how old the previous reply is: the child has
// started a new turn, or is still generating, not gone quiet. Every other
// system subtype still leaves the verdict resting on the newest
// conversational record.
// Ahead of every other rule: the newest record of ANY type, not only the
// newest conversational one, is checked for a rate-limit shape first, and if
// it is one this reads idle regardless of what sits under it. A rate-limit
// record is a system record of subtype api_retry with error_status 429, or a
// rate_limit_event record whose rate_limit_info.status is rejected AND whose
// rate_limit_info does not show the child proceeding on overage. A
// rate_limit_event record is routine quota information emitted on ordinary
// API responses and carries this shape on almost every turn; most of them
// (status allowed or allowed_warning) describe a child that is not parked at
// all. A rejected status alone is not enough either: a child whose included
// quota is exhausted keeps writing a rejected record for the whole length of
// the tool call it is running while it proceeds on overage, and
// rate_limit_info.isUsingOverage true or rate_limit_info.overageStatus
// "allowed" is what that looks like on the wire. Either field reading as "the
// child proceeds" makes the record routine, not blocking. A record whose
// overage fields are missing, or whose status cannot be read at all, is not
// treated as parked, since erring that way reads busy and the other way can
// kill a working child. A child truly parked on a limit rewrites a rejected
// record with no overage fields, so its stream never goes quiet on its own,
// and it has nothing left to finish.
//
// It reads the file's tail and not the whole file: a real stream reaches
// tens of megabytes. The tail read mirrors readRateLimitReset in
// bin/supervise-poll.mjs (same scan window, same first/last partial-line
// drop), since that is the tree's only other reader of this same hostile
// path and there is nothing here to import: that file runs its own poll
// unconditionally at load, so importing it would run a poll as a side
// effect of loading this one. Unlike that reader, this one widens the
// window when the first pass turns up no conversational record: a single
// record (a large tool_result, say) can exceed the base window on its own,
// and reading no conversational record there is not the same fact as there
// being none in the file.

import fs from 'node:fs';

const SCAN_BYTES = 262144;
// Doubled from SCAN_BYTES up to this ceiling when the base window turns up
// no conversational record. High enough to cover a single oversized record
// running several megabytes; far short of reading a multi-ten-megabyte
// stream whole.
const SCAN_BYTES_MAX = 8 * 1024 * 1024;
const IDLE_AFTER_MS = 300000;

// The tail of the stream as whole lines, plus the file's own modification
// time and size read from the same handle. A missing file, one that cannot
// be opened, and any other read failure all return null, which the caller
// reads as idle.
function readTail(streamPath, scanBytes) {
  let text = '';
  let scanStart = 0;
  let mtimeMs = null;
  let size = 0;
  try {
    const fd = fs.openSync(streamPath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      mtimeMs = Math.floor(stat.mtimeMs);
      size = stat.size;
      if (size > scanBytes) scanStart = size - scanBytes;
      const len = size - scanStart;
      const buf = Buffer.alloc(len);
      // A single readSync call is not guaranteed to fill the buffer, so this
      // loops until len bytes are read or a call returns 0 (end of file):
      // stopping after one short read would drop the newest bytes of the
      // window, which is exactly the record this reader needs.
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
  // The tail can start mid-line, and the file can end mid-line while the
  // child is writing. Neither partial is a record, exactly as in
  // readRateLimitReset.
  if (scanStart > 0) lines.shift();
  lines.pop();
  return { lines, mtimeMs, scanStart };
}

// True when a record is a system record marking a prompt cycle that produces
// no conversational record of its own: init (sent once per turn before the
// model's first block) or thinking_tokens (sent while the model is still
// generating). Neither carries a timestamp, so they are ordered by line
// position -- the order they were written in -- rather than by age.
function isTurnStartMarker(record) {
  return record && record.type === 'system'
    && (record.subtype === 'init' || record.subtype === 'thinking_tokens');
}

// The newest record of any type, the newest conversational one (type
// assistant or user), and whether a turn-start marker (init or
// thinking_tokens) sits after the newest conversational record in line
// order, among a tail's parsed lines. A result record clears that marker
// without setting newestConversational: a turn that opens with init and
// ends in a result with no assistant record (the first API call failed
// after retries) leaves the marker cleared rather than stuck set for a
// child that has gone quiet between turns. An unparsable line is skipped,
// as is a JSON value that is not an object.
function parseTail(lines) {
  let newestAny = null;
  let newestConversational = null;
  let markerAfterConversational = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (!record || typeof record !== 'object') continue;
    newestAny = record;
    if (record.type === 'assistant' || record.type === 'user') {
      newestConversational = record;
      markerAfterConversational = false;
    } else if (isTurnStartMarker(record)) {
      markerAfterConversational = true;
    } else if (record.type === 'result') {
      // A result with no assistant record after it in the same turn (the
      // first API call failed after retries) leaves no conversational
      // record to reset the marker. Clearing it here on the result itself
      // is what keeps a child quiet between turns from reading busy for the
      // whole patient cap; a result is never treated as conversational and
      // never changes newestConversational.
      markerAfterConversational = false;
    }
  }
  return { newestAny, newestConversational, markerAfterConversational };
}

function isRateLimitRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.type === 'rate_limit_event') {
    const info = record.rate_limit_info;
    const status = info && info.status;
    // allowed and allowed_warning describe routine quota reporting, not a
    // parked child. A status this reader cannot read as a string is not
    // treated as parked either; the verdict rests on the conversational
    // record instead.
    if (status !== 'rejected') return false;
    // A rejected status alone does not mean the child is parked: a child
    // whose included quota is exhausted keeps writing a rejected record for
    // the whole length of a tool call it runs on overage, and that record
    // is the newest of any type for that entire span. Either overage field
    // reading as "the child proceeds" makes the record routine; a record
    // with neither field present is read as not proceeding, so a bare
    // rejected still blocks.
    const proceedingOnOverage = (info && info.isUsingOverage) === true
      || (info && info.overageStatus) === 'allowed';
    return !proceedingOnOverage;
  }
  return record.type === 'system'
    && record.subtype === 'api_retry'
    && Number(record.error_status) === 429;
}

function hasToolUse(record) {
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => block && block.type === 'tool_use');
}

// The age, in milliseconds, of a text-only assistant record: its own
// timestamp field against now where that field parses to a finite number,
// the file's modification time otherwise. Returns null when neither is
// finite, which the caller reads as idle. A negative age -- the record's own
// clock reading ahead of the clock argument, or ordinary skew against a
// record written an instant before this ran -- is a young record and reads
// busy through the ordinary comparison against IDLE_AFTER_MS below; nothing
// here screens it out.
function conversationalAgeMs(record, mtimeMs, now) {
  const raw = record && record.timestamp;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const ts = new Date(raw).getTime();
    if (Number.isFinite(ts)) return Number(now) - ts;
  }
  const age = Number(now) - mtimeMs;
  return Number.isFinite(age) ? age : null;
}

function turnstate(streamPath, now) {
  let scanBytes = SCAN_BYTES;
  let tail = readTail(streamPath, scanBytes);
  if (!tail) return 'idle';
  let { newestAny, newestConversational, markerAfterConversational } = parseTail(tail.lines);

  // The rate-limit check is settled on this base window and is not re-run
  // after widening: a parked child's newest record is always here already,
  // so checking first avoids widening all the way to the ceiling to reach a
  // verdict this window has already settled.
  if (isRateLimitRecord(newestAny)) return 'idle';

  // The base window found no conversational record and no turn-start
  // marker. Where the window already covers the whole file, that absence is
  // the true answer. Where it does not, a single record wider than the
  // window could be sitting just behind it, so widen and look again before
  // concluding idle. Either a conversational record or a turn-start marker
  // settles the verdict, so either stops the widening.
  while (!newestConversational && !markerAfterConversational && tail.scanStart > 0 && scanBytes < SCAN_BYTES_MAX) {
    scanBytes *= 2;
    tail = readTail(streamPath, scanBytes);
    if (!tail) return 'idle';
    ({ newestAny, newestConversational, markerAfterConversational } = parseTail(tail.lines));
  }

  // A channel-driven child's prompt is never written as a user record: the
  // marker records visible for a new turn are init and a run of
  // thinking_tokens while the model generates, and thinking_tokens also
  // appears mid-turn on a response the model is still generating, where
  // busy is right either way. Neither carries a timestamp. Where one of
  // those sits after the newest conversational record -- or the tail holds
  // one and no conversational record at all, a child in its first turn --
  // the child is inside the new turn, or still generating, regardless of
  // how old the previous reply is.
  if (markerAfterConversational) return 'busy';

  if (!newestConversational) {
    // The window still does not reach the start of the file: a record (or a
    // run of records) wider than the widening ceiling sits behind it, and
    // that record may well be finished rather than still being written.
    // Reading busy here is chosen because idle is the kill-a-working-child
    // direction, and a wedged child that never turns idle here is still
    // bounded by the patient stop's own cap (see the widening note above).
    // Where the window does cover the whole file, an absence of
    // conversational records and turn-start markers is the true answer.
    if (tail.scanStart > 0) return 'busy';
    return 'idle';
  }
  if (newestConversational.type === 'user') return 'busy';
  if (hasToolUse(newestConversational)) return 'busy';

  const age = conversationalAgeMs(newestConversational, tail.mtimeMs, now);
  if (age === null) return 'idle';
  return age > IDLE_AFTER_MS ? 'idle' : 'busy';
}

// The smallest magnitude an epoch-millisecond "now" can plausibly carry
// (roughly the year 2001). bin/supervise.sh passes `date +%s%3N` at its one
// call, and its patient wait reads that clock too, but the rest of that
// script reads `date +%s`, seconds, three orders of magnitude below any
// real epoch-ms value. A caller reaching for that habit passes seconds. A
// value below this threshold is therefore read as a mis-scaled clock
// rather than trusted, and Date.now() is used instead. A seconds-valued
// clock taken at face value as milliseconds lands decades behind the
// record it is compared against, which reads as a hugely negative age:
// wrongly busy under the ordinary comparison, whatever the record's true
// age. Guarding at the clock read is what keeps that scenario from ever
// reaching the age comparison.
const MIN_PLAUSIBLE_EPOCH_MS = 1e12;

function parseClock(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_PLAUSIBLE_EPOCH_MS ? n : Date.now();
}

// Run unconditionally: this file is only ever launched, never imported, and
// exports nothing. A guard comparing this module's URL against argv would
// turn on how the launch path was spelled, and a mismatch would print
// nothing, which the patient stop would read as a wedged child forever.
const [streamPathArg, clockArg] = process.argv.slice(2);
process.stdout.write(turnstate(streamPathArg, parseClock(clockArg)) + '\n');
