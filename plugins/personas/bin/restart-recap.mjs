// bin/restart-recap.mjs - What the session before this one was doing.
//
// A restarted persona session starts with no memory of the conversation the
// operator sees as one thread. This script reads the transcripts of the
// sessions that held the persona before this one and prints a bounded digest
// of what the operator said and what the persona replied, so the new session
// can say where things stood rather than misread its own finished goal.
//
//   node bin/restart-recap.mjs [--store <path>] [--persona <name>] [--exclude <id>]
//                              [--projects <dir>] [--sessions <n>] [--since <hours>]
//
// Defaults: the store is .agentic-personas.json in the working directory; the
// persona is the one that store holds where it holds exactly one, and
// otherwise --persona is required; the excluded session is the one
// CLAUDE_CODE_SESSION_ID names, which is the session running this script; the
// transcript root is <home>/.claude/projects; two sessions; 48 hours.
//
// Which sessions. The source is the lineage ring, previousSessionIds on the
// persona's store entry, newest first, which the plugin writes at every claim.
// Two personas can share a working directory and so a transcript folder, and
// the ring is what names this persona's own sessions among them. Where the
// ring is empty, absent or unreadable, the fallback is the newest other
// transcript in the folder, and the header reads "lineage": "unrecorded", since
// that transcript may be another persona's. The excluded session is left out of
// both the ring read and the fallback.
//
// Which folder. The harness keys a transcript folder on the working directory
// with every character outside ASCII letters and digits turned to a hyphen,
// and projectKey in bin/supervise-liveness.mjs is that rule. The harness has
// written one directory under two letter cases, so the folder is found by
// listing the transcript root and taking every entry whose name equals the key
// without regard to case, each real folder read once however many names reach
// it.
//
// Output. Line one is always the header, one JSON object:
//   { "lineage": "recorded" | "unrecorded", "sessions": [ids],
//     "lastRecordAt": iso | null, "lastOperatorAt": iso | null,
//     "activeGoal": true | false | null }
// sessions names the sessions whose transcripts were read, oldest first as
// the digest prints them. lastRecordAt and lastOperatorAt are the newest
// across every session read; lastOperatorAt reads operator messages only.
// activeGoal is true where the persona's entry names an active goal, false
// where it names none, and null where the store or the entry cannot be read.
// The lines after it are the digest, oldest session first: a session line
// naming the first and last record of the tail read and the version, then
// "operator <hh:mm>: <text>" and "persona <hh:mm>: <text>" in file order, which
// is time order, then "last words: <text>", then one count line for the whole
// digest. A message whose channel tag reads as a participant's prints as
// "participant <hh:mm>: <text>" in the same order, and counts as neither an
// operator message nor a reply. An operator or participant line whose channel
// tag names an author reads "<kind> <hh:mm>: <author>: <text>", the author
// cut to RECAP_AUTHOR_CHARS. hh:mm is UTC. A session whose last record is
// older than --since prints as one line naming its age and nothing else.
//
// What the digest admits. An operator message is a user record whose content
// is a string opening the relay's channel tag, or, for a message that arrived
// while a turn was running, a queued_command attachment whose prompt opens it,
// each bearing the harness's relay origin stamp. Every such record prints, so
// the same text sent twice prints twice. Its tag decides whether it prints as
// an operator's or a participant's, by the rule taggedSender states. A
// persona session is headless,
// so every user record without that tag is text a program submitted: the
// supervisor's priming turn, a prompt the plugin injected, a coordinator or
// worker record delivered as a turn, a tool result. A reply is the relay
// reply tool's message. The last words are the session's last assistant text.
// Nothing else is read: no tool call or result, no thinking, no sidechain
// record, and no subagent transcript, which lives in a folder under the
// session's own and is never listed.
//
// Why the text is folded. The digest is placed in front of a model as context,
// so each piece of transcript text is folded to one line, its control and
// format characters closed up, and its square brackets turned to parentheses:
// a line the script did not compose must not read as one it did, and a '['
// would let stored text forge a delivery label such as [COORDINATOR id=7].
// This is the same guard hooks/agent-state.ts applies as oneLine and
// bracketSafeText, which a .mjs script cannot import from TypeScript.
//
// Bounds. Each transcript is read from its last RECAP_TAIL_BYTES only, and a
// first line the cut landed inside is dropped, as is a last line with no
// newline after it, which is a record still being written. Each message is
// cut to RECAP_MESSAGE_CHARS and the whole digest to RECAP_DIGEST_CHARS, the
// oldest message lines dropped first and then the oldest frame lines, with a
// line saying how many were dropped.
//
// Failure. A store, a folder or a transcript that cannot be read, and a
// record that is not JSON, is skipped with one line on stderr naming it. The
// script still prints the header and exits 0, with an empty digest where
// nothing could be read, so a caller always has the header to decide on.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectKey, transcriptPathsFor } from './supervise-liveness.mjs';

export const RECAP_TAIL_BYTES = 2 * 1024 * 1024;
export const RECAP_MESSAGE_CHARS = 400;
// The most characters of an author a channel line carries, operator or
// participant, a cap of its own so an author cannot double a line's budget.
export const RECAP_AUTHOR_CHARS = 64;
export const RECAP_DIGEST_CHARS = 6000;
export const DEFAULT_SESSIONS = 2;
export const DEFAULT_SINCE_HOURS = 48;
// The most ring entries read, the same bound the plugin cuts the ring to on
// load, so a hand-edited store cannot widen the read.
export const PREVIOUS_SESSIONS_MAX = 3;
export const STORE_FILENAME = '.agentic-personas.json';
// The opening of an operator message: the relay's channel tag.
export const OPERATOR_TAG = '<channel source="plugin:relay:channel-relay"';
// The server the harness names in an operator message's origin stamp.
export const RELAY_SERVER = 'plugin:relay:channel-relay';
// The tool a persona replies to the operator through.
export const REPLY_TOOL = 'mcp__plugin_relay_channel-relay__reply';
const VERSION_CHARS = 40;

// Where one line of text ends, as hooks/agent-state.ts defines the set: CRLF,
// or any one of LF, CR, VT, FF, NEL, LINE SEPARATOR or PARAGRAPH SEPARATOR.
const LINE_TERMINATOR = /\r\n|[\n\r\v\f\u{85}\u{2028}\u{2029}]/u;

/**
 * One piece of transcript text as one digest-safe line: folded on every line
 * terminator, its runs of whitespace, control and format characters closed up
 * to one space, its square brackets turned to parentheses, and cut to the cap.
 * @param {unknown} text
 * @param {number} cap
 * @returns {string}
 */
export function digestText(text, cap = RECAP_MESSAGE_CHARS) {
  return String(text === undefined || text === null ? '' : text)
    .split(LINE_TERMINATOR).join(' ')
    .replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ')
    .trim()
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .slice(0, cap);
}

/**
 * The named arguments, as --flag value pairs. A flag with no value is left
 * out rather than guessed at.
 * @param {string[]} argv
 * @returns {Record<string,string>}
 */
export function parseArgs(argv) {
  const list = Array.isArray(argv) ? argv.map(String) : [];
  const flags = {};
  for (let i = 0; i < list.length; i += 1) {
    if (!list[i].startsWith('--')) continue;
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) continue;
    flags[list[i].slice(2)] = next;
    i += 1;
  }
  return flags;
}

/**
 * Every transcript folder under the root whose name equals the working
 * directory's project key without regard to case, as { name, path }, the name
 * as the listing stores it. A folder reached under two names is returned
 * once, by its resolved path, so no transcript is read twice. A name equal to
 * the derived key comes first. Returns null where the root cannot be listed.
 * @param {string} projectsDir
 * @param {string} workdir
 * @returns {{name: string, path: string}[]|null}
 */
export function transcriptFolders(projectsDir, workdir) {
  const key = projectKey(workdir);
  if (!key) return [];
  let names;
  try { names = fs.readdirSync(projectsDir); } catch (e) { return null; }
  const wanted = key.toLowerCase();
  const matches = names
    .filter((name) => name.toLowerCase() === wanted)
    .sort((a, b) => (a === key ? -1 : b === key ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const seen = new Set();
  const out = [];
  for (const name of matches) {
    const p = path.join(projectsDir, name);
    try { if (!fs.statSync(p).isDirectory()) continue; } catch (e) { continue; }
    let real = p;
    try { real = fs.realpathSync.native(p); } catch (e) { real = p; }
    const identity = process.platform === 'win32' ? real.toLowerCase() : real;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({ name, path: p });
  }
  return out;
}

// The transcript file name for a session id, or '' where the id is not one a
// file name can safely carry. transcriptPathsFor owns that check, so the id
// passes the same guard the liveness verdict's does before it reaches a path.
// Only the name is taken from its answer: the root handed in is a placeholder,
// and the folder the name is joined to comes from the case-insensitive lookup.
function transcriptFileName(workdir, sessionId) {
  const { transcriptPath } = transcriptPathsFor('placeholder-root', workdir, sessionId);
  return transcriptPath ? path.basename(transcriptPath) : '';
}

/**
 * The records in the last tailBytes of a transcript, in file order, with the
 * lines that are not JSON counted by their line number in the tail. A first
 * line the cut landed inside is dropped, since it is not a record. Returns
 * null where the file cannot be read.
 * @param {string} file
 * @param {number} [tailBytes]
 * @returns {{records: object[], bad: number[]}|null}
 */
export function readRecords(file, tailBytes = RECAP_TAIL_BYTES) {
  let text = '';
  let start = 0;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const stat = fs.fstatSync(fd);
      // A directory opens on Windows and reads as empty, which would pass
      // for a transcript with no records.
      if (!stat.isFile()) return null;
      const size = stat.size;
      if (size > tailBytes) start = size - tailBytes;
      const len = size - start;
      const buf = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const n = fs.readSync(fd, buf, got, len - got, start + got);
        if (n === 0) break;
        got += n;
      }
      text = buf.toString('utf8', 0, got);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
  if (start > 0) {
    const cut = text.indexOf('\n');
    text = cut >= 0 ? text.slice(cut + 1) : '';
  }
  const records = [];
  const bad = [];
  // The piece after the last newline is a record still being written, or
  // nothing, and is passed over without a note either way.
  const lines = text.split('\n');
  lines.pop();
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let o;
    try { o = JSON.parse(line); } catch (e) { bad.push(i + 1); return; }
    if (o && typeof o === 'object' && !Array.isArray(o)) records.push(o);
    else bad.push(i + 1);
  });
  return { records, bad };
}

// A record's timestamp as an ISO string, or null where it carries none.
function isoOf(record) {
  const t = record.timestamp;
  if (typeof t !== 'string' && typeof t !== 'number') return null;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// The five XML entities this reader decodes in an attribute value, in one
// pass so a decoded '&' never starts a second decode.
const TAG_ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };

/**
 * The opening channel tag of a tagged record: its attributes as [name, value]
 * pairs in the order the tag gives them, and the index just past its closing
 * '>' and the line break after it. The tag is read as a run of name="value"
 * pairs, so a '>' inside a quoted value does not end it; a name given twice
 * appears twice. The tag is whole only where its closing '>' ends its line,
 * followed by a line break or the end of the text, since the envelope puts
 * the message on the lines below: anything else after it on the tag's line is
 * text that broke the tag, such as an author value holding an unescaped '">'.
 * The whole tag sits on one line: a line break inside an attribute value,
 * between two pairs, or before the closing '>' breaks it.
 * Returns null where the text does not open with a whole tag. This is the rule
 * channelEnvelopeAttributes in hooks/index.ts applies, which a .mjs script
 * cannot import from TypeScript.
 * @param {string} content
 * @returns {{attributes: [string, string][], end: number}|null}
 */
function channelTag(content) {
  const open = '<channel';
  if (!content.startsWith(open)) return null;
  const pair = /[ \t]+([A-Za-z_][\w.:-]*)="([^"\r\n]*)"/y;
  const attributes = [];
  let at = open.length;
  for (;;) {
    pair.lastIndex = at;
    const m = pair.exec(content);
    if (!m) break;
    attributes.push([m[1], m[2].replace(/&(quot|amp|lt|gt|apos);/g, (_, name) => TAG_ENTITIES[name])]);
    at = pair.lastIndex;
  }
  const close = /^[ \t]*>(?:\r?\n|$)/.exec(content.slice(at));
  return close ? { attributes, end: at + close[0].length } : null;
}

// The words in a tagged record, without the tag around them. Where the tag
// does not parse whole, the words are what follows its first line break, so
// a tag broken only at its end leaves no fragment in the digest, while one
// broken by a line break between its pairs leaves its later pairs in the
// words; a record with no line break at all falls back to what follows its
// first '>'.
function taggedWords(content) {
  const tag = channelTag(content);
  let body;
  if (tag) {
    body = content.slice(tag.end);
  } else {
    const lineBreak = content.indexOf('\n');
    const open = lineBreak >= 0 ? lineBreak : content.indexOf('>');
    body = open >= 0 ? content.slice(open + 1) : '';
  }
  return body.replace(/<\/channel>\s*$/, '');
}

/**
 * Who sent a tagged record, by the rule channelSenderOf in hooks/index.ts
 * applies: a tag that does not parse whole, or that names sender_class more
 * than once, is a participant's with no author, since either shape can come
 * from author text the envelope did not escape. A whole tag with no
 * sender_class, or with one whose value is exactly "operator", is the
 * operator's; one with any other value is a participant's. The author is the
 * first author attribute's value, or ''.
 * @param {string} content
 * @returns {{kind: 'operator'|'participant', author: string}}
 */
export function taggedSender(content) {
  const tag = channelTag(content);
  const classes = tag ? tag.attributes.filter(([name]) => name === 'sender_class') : [];
  if (!tag || classes.length > 1) return { kind: 'participant', author: '' };
  const author = tag.attributes.find(([name]) => name === 'author');
  return {
    kind: classes.length === 0 || classes[0][1] === 'operator' ? 'operator' : 'participant',
    author: author ? author[1] : '',
  };
}

/**
 * The tagged text of an operator message, or null where the record is not
 * one. The harness records a relay message in one of two carriers: a user
 * record whose content is the tagged string, where the message opened a turn,
 * and a queued_command attachment whose prompt is the tagged string, where it
 * arrived while a turn was running. Each carrier also bears the harness's
 * origin stamp, kind "channel" from the relay's server, which text a program
 * submitted cannot acquire by opening with the tag. A queue-operation record
 * carries the same text and is the queue's own bookkeeping, not a message. A
 * tool result that holds the tag is tool output quoting a message, often
 * another session's or another persona's, and is never read as one.
 * @param {object} r
 * @returns {string|null}
 */
export function operatorCarrier(r) {
  if (r.type === 'user') {
    const content = r.message && typeof r.message === 'object' ? r.message.content : undefined;
    return typeof content === 'string' && content.startsWith(OPERATOR_TAG) && relayStamped(r.origin) ? content : null;
  }
  if (r.type === 'attachment') {
    const a = r.attachment && typeof r.attachment === 'object' ? r.attachment : null;
    return a && a.type === 'queued_command' && typeof a.prompt === 'string' && a.prompt.startsWith(OPERATOR_TAG) && relayStamped(a.origin) ? a.prompt : null;
  }
  return null;
}

// Whether an origin stamp names the relay's channel.
function relayStamped(origin) {
  return !!origin && typeof origin === 'object' && origin.kind === 'channel' && origin.server === RELAY_SERVER;
}

/**
 * What one session's records hold for the digest: the operator messages and
 * replies in file order, the last assistant text, the first and last
 * timestamps, and the version. Everything outside the three admitted shapes is
 * passed over here, and a sidechain record is passed over whatever its shape.
 * @param {object[]} records
 * @returns {{lines: {kind: string, at: string|null, text: string, author?: string}[], lastWords: string|null, firstAt: string|null, lastAt: string|null, lastOperatorAt: string|null, version: string}}
 */
export function sessionDigest(records) {
  const lines = [];
  let lastWords = null;
  let firstAt = null;
  let lastAt = null;
  let lastOperatorAt = null;
  let version = '';
  for (const r of records) {
    const at = isoOf(r);
    if (at) {
      if (firstAt === null || at < firstAt) firstAt = at;
      if (lastAt === null || at > lastAt) lastAt = at;
    }
    if (typeof r.version === 'string' && r.version) version = r.version;
    if (r.isSidechain === true) continue;
    // Every carrier is its own message. The tag names no message id, so the
    // same text twice in a session is the sender writing it twice, and both
    // print. Only an operator's message moves lastOperatorAt; a participant's
    // prints under its own kind and moves nothing.
    const tagged = operatorCarrier(r);
    if (tagged !== null) {
      const sender = taggedSender(tagged);
      lines.push({ kind: sender.kind, at, text: taggedWords(tagged), author: sender.author });
      if (sender.kind === 'operator' && at && (lastOperatorAt === null || at > lastOperatorAt)) lastOperatorAt = at;
      continue;
    }
    const message = r.message && typeof r.message === 'object' ? r.message : null;
    if (!message) continue;
    if (r.type === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use' && block.name === REPLY_TOOL && block.input && typeof block.input.message === 'string') {
          lines.push({ kind: 'persona', at, text: block.input.message });
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          lastWords = block.text;
        }
      }
    }
  }
  return { lines, lastWords, firstAt, lastAt, lastOperatorAt, version };
}

/**
 * The digest lines cut to RECAP_DIGEST_CHARS, each line counted with its
 * newline. The oldest message lines go first; where the frame lines alone
 * still pass the cap, the oldest of those go next. The last entry, the count
 * line, is kept, and a first line says how many lines were dropped.
 * @param {{text: string, message: boolean}[]} entries
 * @returns {string[]}
 */
export function capDigest(entries) {
  const size = (list) => list.reduce((n, e) => n + e.text.length + 1, 0);
  let dropped = 0;
  const dropNote = () => ({ text: 'dropped ' + dropped + ' of the oldest line(s) to keep the digest within ' + RECAP_DIGEST_CHARS + ' characters' });
  let kept = entries.slice();
  while (size(dropped > 0 ? [dropNote(), ...kept] : kept) > RECAP_DIGEST_CHARS) {
    let i = kept.findIndex((e) => e.message);
    if (i < 0) i = kept.length > 1 ? 0 : -1;
    if (i < 0) break;
    kept.splice(i, 1);
    dropped += 1;
  }
  return (dropped > 0 ? [dropNote(), ...kept] : kept).map((e) => e.text);
}

function hhmm(iso) {
  return iso ? iso.slice(11, 16) : '--:--';
}

// A whole number of at least one, or the default where the value is absent or
// is anything else, with a note naming what was refused.
function wholeCount(flags, name, fallback, notes) {
  if (flags[name] === undefined) return fallback;
  const n = Number(flags[name]);
  if (Number.isInteger(n) && n >= 1) return n;
  notes.push('--' + name + ' "' + digestText(flags[name], 40) + '" is not a whole number of at least 1; using ' + fallback);
  return fallback;
}

// A positive number, or the default where the value is absent or is not one,
// with a note naming what was refused.
function positive(flags, name, fallback, notes) {
  if (flags[name] === undefined) return fallback;
  const n = Number(flags[name]);
  if (Number.isFinite(n) && n > 0) return n;
  notes.push('--' + name + ' "' + digestText(flags[name], 40) + '" is not a positive number; using ' + fallback);
  return fallback;
}

/**
 * The recap: the header object, the digest lines and the notes for stderr.
 * @param {Record<string,string>} flags
 * @param {{env?: NodeJS.ProcessEnv, cwd?: string, now?: number}} [opts]
 * @returns {{header: object, digest: string[], notes: string[]}}
 */
export function recap(flags, opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now === undefined ? Date.now() : opts.now;
  const notes = [];
  const storePath = path.resolve(opts.cwd || process.cwd(), flags.store || STORE_FILENAME);
  // The store sits in the persona's working directory, which is the directory
  // the transcript folder is keyed on.
  const workdir = path.dirname(storePath);
  const home = String(env.USERPROFILE || env.HOME || os.homedir());
  const projectsDir = path.resolve(flags.projects || path.join(home, '.claude', 'projects'));
  const exclude = flags.exclude !== undefined ? String(flags.exclude) : String(env.CLAUDE_CODE_SESSION_ID || '');
  const sessionsWanted = wholeCount(flags, 'sessions', DEFAULT_SESSIONS, notes);
  const sinceHours = positive(flags, 'since', DEFAULT_SINCE_HOURS, notes);
  if (!exclude) notes.push('no session to exclude: neither --exclude nor CLAUDE_CODE_SESSION_ID names one');
  const excluded = (id) => exclude !== '' && id.toLowerCase() === exclude.toLowerCase();

  // --- The persona's store entry. ---
  let entry = null;
  let store = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) store = parsed;
    else notes.push('the store ' + storePath + ' is not an object of persona entries');
  } catch (e) {
    notes.push('the store ' + storePath + ' cannot be read: ' + digestText(e && e.message, 200));
  }
  if (store) {
    let persona = flags.persona;
    if (persona === undefined) {
      const names = Object.keys(store).filter((k) => store[k] && typeof store[k] === 'object' && !Array.isArray(store[k]));
      if (names.length === 1) persona = names[0];
      else notes.push('the store ' + storePath + ' holds ' + names.length + ' personas, so --persona must name one');
    }
    if (persona !== undefined) {
      const e = Object.prototype.hasOwnProperty.call(store, persona) ? store[persona] : null;
      if (e && typeof e === 'object' && !Array.isArray(e)) entry = e;
      else notes.push('the store ' + storePath + ' holds no entry for ' + digestText(persona, 80));
    }
  }
  const activeGoal = entry ? entry.activeGoalId !== null && entry.activeGoalId !== undefined && entry.activeGoalId !== '' : null;
  const ring = entry && Array.isArray(entry.previousSessionIds)
    ? entry.previousSessionIds.filter((id) => typeof id === 'string' && id !== '').slice(0, PREVIOUS_SESSIONS_MAX)
    : [];
  const lineageIds = ring.filter((id) => !excluded(id));

  // --- The transcript folder. ---
  const folders = transcriptFolders(projectsDir, workdir);
  if (folders === null) notes.push('the transcript root ' + projectsDir + ' cannot be listed');
  else if (folders.length === 0) notes.push('no transcript folder under ' + projectsDir + ' matches ' + projectKey(workdir));
  const folderList = folders || [];

  // --- Which sessions, and where each transcript is. ---
  // A transcript counts as chosen only once its tail has been read.
  const readChosen = (file) => {
    const read = readRecords(file);
    if (read === null) notes.push('the transcript ' + file + ' cannot be read');
    return read;
  };
  let lineage;
  const chosen = [];
  if (lineageIds.length > 0) {
    lineage = 'recorded';
    // The ring is walked until enough transcripts are read, so a gone or
    // unreadable session does not hide a readable older one.
    for (const id of lineageIds) {
      if (chosen.length >= sessionsWanted) break;
      const fileName = transcriptFileName(workdir, id);
      if (!fileName) {
        notes.push('the ring names ' + digestText(id, 80) + ', which is not a session id a transcript file can carry');
        continue;
      }
      const hit = folderList.map((f) => path.join(f.path, fileName)).find((p) => fs.existsSync(p));
      if (!hit) {
        notes.push('no transcript for session ' + digestText(id, 80) + ' in the transcript folder');
        continue;
      }
      const read = readChosen(hit);
      if (read) chosen.push({ id, file: hit, read });
    }
  } else {
    lineage = 'unrecorded';
    let newest = null;
    for (const f of folderList) {
      let names;
      try { names = fs.readdirSync(f.path); } catch (e) {
        notes.push('the transcript folder ' + f.path + ' cannot be listed');
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.slice(0, -'.jsonl'.length);
        if (excluded(id) || !transcriptFileName(workdir, id)) continue;
        const p = path.join(f.path, name);
        let stat;
        try { stat = fs.statSync(p); } catch (e) { continue; }
        if (!stat.isFile()) continue;
        if (newest === null || stat.mtimeMs > newest.mtimeMs) newest = { id, file: p, mtimeMs: stat.mtimeMs };
      }
    }
    if (newest) {
      const read = readChosen(newest.file);
      if (read) chosen.push({ id: newest.id, file: newest.file, read });
    }
  }

  // --- Digest each session, oldest first. ---
  const sessions = [];
  for (const c of chosen.slice().reverse()) {
    for (const n of c.read.bad) notes.push('skipped a record that is not JSON at line ' + n + ' of the tail of ' + c.file);
    sessions.push({ id: c.id, ...sessionDigest(c.read.records) });
  }

  let lastRecordAt = null;
  let lastOperatorAt = null;
  for (const s of sessions) {
    if (s.lastAt && (lastRecordAt === null || s.lastAt > lastRecordAt)) lastRecordAt = s.lastAt;
    if (s.lastOperatorAt && (lastOperatorAt === null || s.lastOperatorAt > lastOperatorAt)) lastOperatorAt = s.lastOperatorAt;
  }

  // --- The digest, cut to its cap. ---
  const entries = [];
  let operators = 0;
  let replies = 0;
  let counted = 0;
  const sinceMs = sinceHours * 3600000;
  for (const s of sessions) {
    if (s.lastAt === null) {
      entries.push({ text: 'session ' + s.id + ': no records', message: false });
      continue;
    }
    const ageMs = now - new Date(s.lastAt).getTime();
    if (ageMs > sinceMs) {
      entries.push({ text: 'session ' + s.id + ': last record ' + s.lastAt + ', ' + Math.round(ageMs / 3600000) + ' hours ago, outside the ' + sinceHours + '-hour window', message: false });
      continue;
    }
    counted += 1;
    entries.push({ text: 'session ' + s.id + ': tail from ' + s.firstAt + ' to ' + s.lastAt + ', version ' + (digestText(s.version, VERSION_CHARS) || 'unknown'), message: false });
    for (const l of s.lines) {
      // A participant's message is neither an operator message nor a persona
      // reply, so it counts in neither.
      if (l.kind === 'operator') operators += 1;
      else if (l.kind === 'persona') replies += 1;
      // A channel line whose tag named an author opens its words with them.
      const author = l.author ? digestText(l.author, RECAP_AUTHOR_CHARS) : '';
      entries.push({ text: l.kind + ' ' + hhmm(l.at) + ': ' + (author ? author + ': ' : '') + digestText(l.text), message: true });
    }
    entries.push({ text: 'last words: ' + (s.lastWords === null ? '(none)' : digestText(s.lastWords)), message: false });
  }
  let digest = [];
  if (entries.length > 0) {
    entries.push({ text: 'count: ' + operators + ' operator message(s) and ' + replies + ' persona reply(ies) across ' + counted + ' session(s)', message: false });
    digest = capDigest(entries);
  }

  const header = {
    lineage,
    sessions: sessions.map((s) => s.id),
    lastRecordAt,
    lastOperatorAt,
    activeGoal,
  };
  return { header, digest, notes };
}

// Whether node was asked to run this file, rather than one that imported it.
// It stands down where node was given no script path, as under -e, and where
// the entry point is another readable file, which is what an import looks
// like. A launch through a path this cannot resolve still prints.
function launchedDirectly() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  const real = (p) => { try { return fs.realpathSync(p).toLowerCase(); } catch (e) { return p.toLowerCase(); } };
  // Any entry point other than this file is an importer.
  return real(entry) === real(self);
}

// The header is line one whatever happens, and the exit is 0, so a caller
// always has a header to decide on. An unexpected error prints the header a
// recap with nothing read would, and names itself on stderr.
if (launchedDirectly()) {
  let out;
  try {
    out = recap(parseArgs(process.argv.slice(2)));
  } catch (e) {
    out = {
      header: { lineage: 'unrecorded', sessions: [], lastRecordAt: null, lastOperatorAt: null, activeGoal: null },
      digest: [],
      notes: ['unexpected error: ' + digestText(e && e.stack ? e.stack : e, 1000)],
    };
  }
  process.stdout.write([JSON.stringify(out.header), ...out.digest].join('\n') + '\n');
  for (const n of out.notes) process.stderr.write('restart-recap: ' + n + '\n');
  process.exitCode = 0;
}
