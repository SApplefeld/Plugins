// decision-journal.ts: the append-only record of every shadow question this
// plugin puts to Jev, in the row shape a later bulk load into SQL reads.
//
// One journal per persona per UTC day per session, written as a numbered
// series of segment files:
//   <home>/.claude/agentic-decisions/<persona>/<YYYY-MM-DD>-<session>.<NNNN>.jsonl
// The engine offers no append, so an append reads its file whole and writes it
// back, and the engine refuses a read or a write over 4 MiB. A segment is
// capped at JOURNAL_SEGMENT_MAX_BYTES, which bounds the read-and-rewrite an
// append costs and keeps every file below that refusal: a segment passes the
// cap by at most its last line, which the write itself refuses past 4 MiB. A journal
// per session means no two processes ever share one. A file named with no number,
// `<YYYY-MM-DD>-<session>.jsonl`, is a journal from before the segments: every
// reader reads it and nothing writes it again.
//
// Five line kinds and no others: `call` records the request, `answer` records
// what came back beside what Haiku said, `outcome` records a signal the
// plugin produced later, `rendering` records what the recall shadow would
// have put in front of a prompt, one line per prompt, and `event` records a
// fact the plugin observed on its own, under a name from a closed set, with
// no question behind it. Every field is present on every line of its kind,
// and a value that does not apply is null, so a load can read a column per
// field without a per-line shape test.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts and refuses the whole module
// where `$` crosses an import, so this file takes a JournalHost instead: five
// members of the PluginHost that hooks/index.ts builds over `$` in its
// top-level hostOf adapter.
//
// Nothing here throws into a caller. Each writer resolves to true or false,
// and the first failure of a UTC day is flagged so the caller can log it once.
// A tick that cannot write its journal line is still a tick that must finish.
//
// This module is the journal's output channel, so a guard that needs only the
// text it is handed lives here and is exported rather than kept private: the
// clamp that bounds a field nobody else bounds, and the prototype-free map. A
// later module that writes a journal line calls them rather than writing its
// own, which is what stops the next boundary from being unguarded.
//
// The guard that keeps the vendor API key out of a line is not one of those,
// and it is not here. It needs the key, and this boundary must not hold one.
// It lives in the seam, which already holds the only copy in order to build
// the request header, and which scrubs the state once before the request body
// is built. So the bytes the vendor receives are the bytes a line records. A
// call line reads its state from the seam's result rather than from a field of
// its own, which is what makes that structural for a call line: no field on it
// carries the worker's own text unscrubbed, and that scrub covers the vendor
// API key alone and no other secret a worker may have printed. Six further
// fields on it are caller-supplied (the
// stamp id, the persona, the session, the site, the question set and the
// mode), and those are the plugin's own identifiers rather than anything a
// worker wrote. A result that read no key carries a null
// state and a reason naming which of the two reasons it was, so nothing on the
// line records whether the scrub ran.
//
// The outcome line is the other place worker-authored free text could reach a
// line, and it is guarded here by kind rather than by the seam: an ask marker's
// value is a fixed token, because the text that matched is the worker's own.
// That guard needs only the kind it is handed, so it belongs on this channel
// rather than on the joiner that will call it.
//
// The answer line is the one place a caller's own strings are written as they
// were given, and it is deliberate. Its option ids and its `haikuValue` are the
// vocabulary agreement is measured in: the seam validates the vendor's answer
// against the same ids it sent, and agreement is exact equality of option id
// between that answer and Haiku's. Rewriting them would corrupt the instrument
// rather than protect it. Every Choice set but one draws those ids from the
// catalog's own constants; that one is the plan switch, whose ids are
// pending plan ids the caller supplies. They are bounded by the clamp and
// carried on a prototype-free map, and they are not scrubbed.
//
// A line's `primitive` names which question type answered, since the three
// share the answer line's columns. A Score's `value` is its position on the
// levels and its probabilities are keyed by level number; a Noul's `value` is
// the probability of yes, with no distribution and no confidence beside it.
// The four questions asked of a plan entry have no Haiku counterpart, so
// their `haikuValue` is null and their `agrees` is null with it: there is no
// agreement to record, and their measurement is the outcome lines instead.

import type { PluginHost } from "./host";
import type { SeamResult, SeamSetResult } from "./decision-seam";
// The closed set of question types, single-sourced from the module that
// sends them: an answer line names which of the three answered, and a load
// reads that column against this set.
import { QUESTION_PRIMITIVES } from "./decision-seam";
import { fnv1aHash } from "./cost-ledger";

// What the journal needs from the host: the home directory, the three file
// calls an append costs, and the folder listing the first append on a journal
// reads to find where its series stands.
export type JournalHost = Pick<PluginHost, "getHome" | "writeFile" | "readFile" | "fileExists" | "listDir">;

export const JOURNAL_DIR = ".claude/agentic-decisions";

// One line in five is holdout, which the retraining plan never reads when it
// proposes a wording. The split is a function of the stamp id alone, so it is
// the same answer every time it is asked.
export const HOLDOUT_EVERY = 5;

// The longest a free text field the journal did not author may be. An append
// reads the whole segment and rewrites it, so one unbounded message would grow
// that cost for every later line of the segment. Every such field is cut to this
// rather than refused: a truncated detail still names what happened.
export const FREE_TEXT_MAX = 512;

// The mark a cut field ends in, so a reader can tell a bounded value from a
// short one.
export const TEXT_CUT_MARK = "...[cut]";

// The longest a path segment built from a persona name or a session id may be.
export const SEGMENT_MAX = 64;

// The closed set of outcome kinds. The first two belong to a controller
// call: a `next_score` is the first turn scored after one, and an
// `ask_marker` the first worker ASK: line matched after one.
//
// The other four belong to the plan health call, each recording something
// the plugin observed for itself after it. A `next_speaker` is what opened
// the next turn: a channel message, a delivered record, or neither. The
// plugin writes it at the end of the next turn in the same session, so a
// plan health call with no later turn in that session carries none. It is
// block-owner's outcome. The other three belong to the three retired plan
// health questions, and nothing in the plugin writes them: a `lead_blocked` is
// whether the same turn's closing text opened with the worker's own BLOCKED:
// lead, a `chapter_within` whether the entry's plan document gained a
// Chapter within the next few turns on that entry, and a
// `continued_unprompted` whether work continued on its own with nobody else
// acting first. They stay in the set because the journal holds lines of each
// and its reader takes them as they are.
//
// The next two belong to the two turn record questions. A
// `record_delivered_within` answers turn-open: whether the record that call
// opened or continued reached delivered within a fixed number of the
// persona's own turns, written once as true or false. A `next_prompt_kind`
// answers turn-disposition: the verdict the next external message took on
// turn-open, one of its option ids; `fallback` where no verdict was read, which
// includes every call while the question is not live and every call that failed;
// or `none` where the record expired first.
//
// The next belongs to the memory-kind question asked live. A `haiku_kind` is
// the label Haiku gave the same exchange on a call the gate passed through to
// Haiku, so the journal holds Jev's answer and Haiku's for one input, as a
// shadow answer line's `haikuValue` does.
//
// The next belongs to the turn-score question asked live. A `haiku_score` is
// the label Haiku gave the same turn, written against the live call's line
// whether Jev answered or the call failed, so the journal sets Jev's answers
// and its failures alike against what Haiku said.
//
// The next three belong to the three memory questions, each written as the
// string true or false. An `applied_since_call` answers memory-value: whether
// the record the call was about was present and stamped applied at or after
// the call, as the daily pass reads it thirty to thirty-seven days later. A
// `recall_acted` answers memory-recall: whether the session opened the record
// or stamped it applied before its next prompt. A `nudge_acted` answers
// memory-recognition: whether the session opened the record within three
// tool calls.
//
// The next two belong to the controller question. A `haiku_decision` is the
// label Haiku gave the same idle state on a call asked live, written against
// the live call's line whether Jev answered or the call failed, as
// `haiku_score` is for the turn score. An `acted` is what the turn a
// controller call's nudge opened did, written at that turn's end against the
// call, live or shadow: `tools` where the turn made a tool call, `reply`
// where it only answered, `none` where the nudge's submit failed or the turn
// ended with no answer.
//
// The next belongs to the step watch's question. A `turn_score_label` is the
// label the turn scorer gave the whole turn, written at that turn's end
// against each step-drift call the turn made that asked about the entry the
// scorer labelled. A turn the scorer left without a label writes none.
//
// The last belongs to the turn-score question. A `next_trigger` is what
// opened the next turn in the same session, written at that turn's start
// against the score call: `nudge`, `ask-answered` for an answer to an open ask
// whether delivered as a record or typed by the operator, `delivery` for any
// other delivered record, `operator` for any other prompt from an origin the
// operator types at (the keyboard, the bridge, the sdk) that is not a channel
// message, or `other`, which takes channel messages, the supervisor's own
// prompts, task notifications and every other origin. A score call whose
// turn ended with another turn still open, or saw one start during its end,
// carries none.
//
// The union and the array carry the same members in the same order: a member
// in the union alone compiles and is refused by writeOutcome at runtime.
export type OutcomeKind =
  | "next_score" | "ask_marker" | "lead_blocked" | "chapter_within" | "next_speaker" | "continued_unprompted"
  | "record_delivered_within" | "next_prompt_kind" | "haiku_kind" | "haiku_score"
  | "applied_since_call" | "recall_acted" | "nudge_acted"
  | "haiku_decision" | "acted"
  | "turn_score_label" | "next_trigger";
export const OUTCOME_KINDS: readonly OutcomeKind[] = [
  "next_score", "ask_marker", "lead_blocked", "chapter_within", "next_speaker", "continued_unprompted",
  "record_delivered_within", "next_prompt_kind", "haiku_kind", "haiku_score",
  "applied_since_call", "recall_acted", "nudge_acted",
  "haiku_decision", "acted",
  "turn_score_label", "next_trigger",
];

// The value every `ask_marker` outcome line carries, whatever the caller passes.
// What matched is a line the worker wrote, and a journal line records that the
// marker fired rather than what it said. A `next_score` value is the plugin's
// own label from a closed set, so it rides as it was given.
export const ASK_MARKER_VALUE = "matched";

export type JournalSplit = "holdout" | "dev";

// What a writer resolves to. `ok` is whether the line landed. `firstFailureToday`
// is true on the first failed write of a UTC day and never on a write that
// landed, so a caller logging it pushes one decision a day rather than one a
// tick. The latch is in memory, so a restart lets the day's first failure be
// reported again.
export type JournalWrite = { ok: boolean; firstFailureToday: boolean };

// --- The clamp on this boundary ---

// The one call every free text field the journal did not author goes through.
// `state` is the exception and goes through neither this nor anything else
// here: it arrives already scrubbed from the seam, and it is the one field
// whose exact bytes a later reader needs.
export function journalText(value: unknown): string {
  // String() raises a TypeError on an object with a null prototype and on any
  // object whose toString throws, which is the shape JSON.parse and this plan's
  // own prototype-free maps produce. Every caller today hands this a string the
  // plugin authored, so nothing host-supplied reaches it. It is exported as the
  // one helper every unauthored free-text field goes through, so the next caller
  // is the one this guard is for.
  let text;
  try {
    text = typeof value === "string" ? value : String(value);
  } catch {
    text = "unconvertible value";
  }
  return text.length <= FREE_TEXT_MAX ? text : text.slice(0, FREE_TEXT_MAX - TEXT_CUT_MARK.length) + TEXT_CUT_MARK;
}

// --- Stamp ids and the split ---

// Per session and never reset, so two ids minted in the same millisecond
// differ. Module state, which is per loaded plugin instance and so per session.
let counter = 0;

// A path segment or an id part built from a caller's string: everything
// outside the safe set becomes an underscore and the result is cut. It is the
// guard on two boundaries at once. On the path it leaves no separator and no
// parent traversal for a persona name or a session id to carry. In the stamp
// id it leaves no dot, so the four parts of an id are the four parts a reader
// splits out. A value that sanitizes away entirely becomes a single underscore,
// since an empty segment would collapse the path. It is exported because it is
// the guard of the channel rather than of this module: the meter's file names
// under the same home take a session id through it too.
export function segment(value: string): string {
  const out = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, SEGMENT_MAX);
  return out.length > 0 ? out : "_";
}

// The id minted when a call starts rather than when it settles, so a joiner
// always has an id to cite even where the outcome line reaches the file before
// the call line does.
export function newStampId(persona: string, session: string): string {
  counter += 1;
  return `${segment(persona)}.${segment(session)}.${Date.now()}.${counter}`;
}

// Whether a stamp id's lines are holdout or dev. A function of the id alone,
// so an id's split never changes and no line needs to carry a decision made
// elsewhere.
export function splitOf(stampId: string): JournalSplit {
  return fnv1aHash(stampId) % HOLDOUT_EVERY === 0 ? "holdout" : "dev";
}

// --- The path ---

// The join hooks/question-catalog.ts uses for the override layer, and
// hooks/index.ts uses at workdirPathOf: trailing separators off the root, then
// an unconditional forward slash, which Windows resolves as readily as POSIX.
function joined(root: string, ...parts: string[]): string {
  return [root.replace(/[/\\]+$/, ""), ...parts].join("/");
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

// The folder one persona's journal files sit in under a home directory. The
// persona passes through segment, as at journalOf below, since this is where
// a persona name becomes part of a path. Exported for hooks/index.ts's daily
// outcome pass, which lists this folder to read the calls it answers, so the
// writer and that reader name one folder.
export function journalDirOf(home: string, persona: string): string {
  return joined(home, JOURNAL_DIR, segment(persona));
}

// The journal file names the daily outcome pass reads, told from anything else
// in the folder: the day, a dash, a session segment, then either `.jsonl`
// alone, the unnumbered name a journal from before the segments carries, or a
// dot, a segment number of four or more digits and `.jsonl`. A session segment
// never carries a dot, so the number splits off without ambiguity, and the
// day is the name's first ten characters either way.
export const JOURNAL_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+(?:\.\d{4,})?\.jsonl$/;

// The largest a segment grows before a line opens the next number, the channel
// log's segment bound. A line is measured in UTF-8 bytes with its newline and
// any separator the file needs, and a line that would take a segment already
// holding bytes strictly past the bound lands in the next number instead. A
// line alone larger than the bound still lands, in a segment of its own, so no
// segment holds more than the bound plus one line.
export const JOURNAL_SEGMENT_MAX_BYTES = 1_048_576;

// One session's journal for one UTC day: the folder it sits in and the file
// name stem every one of its segments shares. `key` is the stem under its
// folder with no segment number, which is what the write chain and the
// current-number table are keyed by.
type Journal = { key: string; dir: string; stem: string };

// The journal this session's lines for this UTC day belong in, or null where
// the host could not name a home directory. Both caller-supplied parts are
// sanitized: a persona name and a session id are the caller's strings, and
// this is the one place either one becomes part of a path.
async function journalOf(host: JournalHost, persona: string, session: string, at: number): Promise<Journal | null> {
  let home: unknown;
  try {
    home = await host.getHome();
  } catch {
    home = undefined;
  }
  if (typeof home !== "string" || home.trim().length === 0) return null;
  const dir = journalDirOf(home.trim(), persona);
  const stem = `${utcDay(at)}-${segment(session)}`;
  return { key: `${dir}/${stem}`, dir, stem };
}

// The file one segment of a journal is: the stem, a dot, the number padded to
// at least four digits, then `.jsonl`. A number past four digits keeps all of
// them.
function segmentPathOf(journal: Journal, n: number): string {
  return `${journal.dir}/${journal.stem}.${String(n).padStart(4, "0")}.jsonl`;
}

// The segment number a listing entry names for this journal, or 0 where it
// names none: an entry that is not an object, is not a file, carries no
// string name, belongs to another day or session, carries no number of four
// or more digits, or carries one too large to read exactly. The name is only
// read. What later becomes part of a path is the number parsed from it, never
// the name.
function segmentNumberOf(journal: Journal, entry: unknown): number {
  if (entry === null || typeof entry !== "object") return 0;
  const { name, kind } = entry as { name?: unknown; kind?: unknown };
  if (kind !== "file" || typeof name !== "string") return 0;
  const prefix = `${journal.stem}.`;
  const suffix = ".jsonl";
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return 0;
  const digits = name.slice(prefix.length, name.length - suffix.length);
  if (!/^\d{4,}$/.test(digits)) return 0;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : 0;
}

// UTF-8 bytes, the measure the segment bound is stated in.
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

// --- The write chain and the failure latch ---

// One promise chain per journal, so two writes started together both land:
// the append reads the whole segment and rewrites it, and two of those
// interleaved would drop a line. It is keyed by the journal rather than the
// segment, so the choice of segment is made inside the chain and two appends
// at the bound cannot each open one. A Map rather than an object literal
// because its keys are paths built from a caller's strings.
const chains = new Map<string, Promise<void>>();

function chained(key: string, work: () => Promise<boolean>): Promise<boolean> {
  const prior = chains.get(key) ?? Promise.resolve();
  const next = prior.then(work, work);
  // The chain's own tail swallows both settlements, so one failed write never
  // leaves the next one waiting on a rejected promise.
  chains.set(key, next.then(() => undefined, () => undefined));
  return next;
}

// The segment number each journal's lines currently land in. In memory, and
// read from the folder listing at the first append on a journal in a module
// instance, so a plugin reload continues the series rather than starting it
// over. A Map for the chain registry's reason.
const segmentNumbers = new Map<string, number>();

// Where a journal's series stands at its first append in this module
// instance: the highest numbered segment for its day and session, else 1. A
// folder that does not exist holds no segment, so it starts the series at 1
// with no listing taken. Null where neither can be known: an existence answer
// that is neither true nor false, or a listing that is not a list. A listing
// that rejects reaches the append's own catch. Either way the write fails
// with no file touched, since a line placed without knowing the series could
// overwrite a segment. The unnumbered name from before the segments never
// sets the number.
async function firstSegmentNumber(host: JournalHost, journal: Journal): Promise<number | null> {
  const folder: unknown = await host.fileExists(journal.dir);
  if (folder === false) return 1;
  if (folder !== true) return null;
  const entries: unknown = await host.listDir(journal.dir);
  if (!Array.isArray(entries)) return null;
  let highest = 0;
  for (const entry of entries) {
    const n = segmentNumberOf(journal, entry);
    if (n > highest) highest = n;
  }
  return highest > 0 ? highest : 1;
}

// The UTC day the last reported failure fell on. In memory, so a restart lets
// that day's first failure be reported again, which is the shape the plan
// accepts in exchange for a latch that costs no file.
let failureDay: string | null = null;

function failed(at: number): JournalWrite {
  const day = utcDay(at);
  if (failureDay === day) return { ok: false, firstFailureToday: false };
  failureDay = day;
  return { ok: false, firstFailureToday: true };
}

const LANDED: JournalWrite = { ok: true, firstFailureToday: false };

// One line waiting for its segment. `fit` is the form carrying the line's
// state, and `build` is the line as written into a candidate segment, which a
// call line may shorten to a reference. The fit test measures the larger of
// the two, since a reference can run longer than a short state. `landed` runs
// once the line is in the file, still inside the chain.
type PendingLine = {
  fit: string;
  build: (segmentPath: string) => string;
  landed?: (segmentPath: string) => void;
};

// A line whose every form is the same text, which is every line but a call's.
function plain(line: string): PendingLine {
  return { fit: line, build: () => line };
}

// The append itself, run inside the journal's chain. It reads the current
// segment and tests the line's fit there. Where the segment holds bytes and
// those bytes, a separator where the file lacks a final newline, and the line
// with its newline would pass JOURNAL_SEGMENT_MAX_BYTES, it moves to the next
// number and runs the same read and test on that file, in case a file by that
// name exists, rather than overwriting it. A segment that is absent or empty
// takes the line whatever its size. A file that exists and cannot be read is
// left alone rather than rewritten: a write built on an unreadable read would
// replace the segment's lines with one. A line already carrying its
// terminator keeps the one it has.
async function appendLine(host: JournalHost, journal: Journal, pending: PendingLine): Promise<boolean> {
  try {
    let n = segmentNumbers.get(journal.key) ?? await firstSegmentNumber(host, journal);
    if (n === null) return false;
    const terminated = (line: string) => (line.endsWith("\n") ? line : line + "\n");
    const fitBytes = utf8Bytes(terminated(pending.fit));
    for (;;) {
      const path = segmentPathOf(journal, n);
      // Read as unknown for the same reason the body below is: a hook above
      // the caller may answer this op event with a value of its own. An
      // answer that is neither true nor false says nothing about the file,
      // and falling through on one would rewrite the segment's lines as a
      // single line. The stronger failure is guarded here and the weaker one
      // below.
      const exists: unknown = await host.fileExists(path);
      if (exists !== true && exists !== false) return false;
      let existing = "";
      if (exists === true) {
        const read: unknown = await host.readFile(path);
        if (typeof read !== "string") return false;
        existing = read;
      }
      const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      const line = terminated(pending.build(path));
      const lineBytes = Math.max(fitBytes, utf8Bytes(line));
      if (existing.length > 0 && utf8Bytes(existing) + sep.length + lineBytes > JOURNAL_SEGMENT_MAX_BYTES) {
        n += 1;
        continue;
      }
      segmentNumbers.set(journal.key, n);
      await host.writeFile(path, existing + sep + line);
      pending.landed?.(path);
      return true;
    }
  } catch {
    return false;
  }
}

// Every writer's one path to the journal: queue each line on the journal's
// chain and report. Nothing here rejects.
async function writeLines(
  host: JournalHost,
  journal: Journal,
  at: number,
  lines: readonly PendingLine[],
): Promise<JournalWrite> {
  if (lines.length === 0) return LANDED;
  let allLanded = true;
  for (const line of lines) {
    let landed = false;
    try {
      landed = await chained(journal.key, () => appendLine(host, journal, line));
    } catch {
      landed = false;
    }
    if (!landed) allLanded = false;
  }
  return allLanded ? LANDED : failed(at);
}

// --- Field helpers ---

// A count the line may carry: a non-negative integer, else null. The same bar
// the seam holds the vendor's own usage numbers to.
function countOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function finiteOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function textOrNull(v: unknown): string | null {
  return typeof v === "string" ? journalText(v) : null;
}

// The probabilities map as a line carries it: prototype-free, since its keys
// are option ids that reach here from a response body, and an ordinary literal
// would swallow a key named __proto__ on the way in and be rewired by a null
// value at that key. Every value is a finite number or null.
function probabilitiesOf(from: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = Object.create(null);
  if (typeof from !== "object" || from === null) return out;
  // The key is bounded like every other text this module did not author. It is
  // the one that arrives as a key rather than a value. The bound is stated on
  // this boundary rather than on any producer: this module writes whatever it
  // is handed, and an append rewrites the whole file, so one unbounded key
  // would grow that cost for every later line of the day. The seam does
  // refuse a key outside the ids it offered, and that is a second guard on a
  // second channel rather than a reason to drop this one. The next module to
  // write a journal line will not reimplement a guard it cannot see.
  for (const [id, p] of Object.entries(from as Record<string, unknown>)) out[journalText(id)] = finiteOf(p);
  return out;
}

// --- The three writers ---

// What a call line needs beyond the result the seam returned. There is no
// state field here: the state comes off the result, already scrubbed by the
// seam, so no caller can hand this boundary raw text.
export type CallRecord = {
  stampId: string;
  persona: string;
  session: string;
  site: string;
  questionSet: string;
  mode: string;
  result: SeamResult | SeamSetResult;
};

// The last state written per site, per segment, so a run of calls on an
// unchanged state stores it once. Keyed by the segment file rather than the
// journal, so every segment is self-contained: the first call line per site in
// a segment carries its state whole, and a `stateRef` only ever names a line
// in the same file. Held in memory rather than read back from the file: a
// restart re-writes the state once per site per segment, which is the same
// shape the failure latch has. A Map for the same reason the chain registry
// is one.
const lastState = new Map<string, { stateHash: number; stampId: string }>();

// One `call` line: the request as it was made and how it ended.
export async function writeCall(host: JournalHost, record: CallRecord): Promise<JournalWrite> {
  const at = Date.now();
  const result = record.result;
  // The state the seam scrubbed with the key it sent. Null where the call read
  // no key, which is the `off` and `no_key` reasons: the mode check precedes
  // the key read, so neither carries a state and neither has anything to dedup
  // on. The `result` column is what tells the two apart.
  const state = typeof result.state === "string" ? result.state : null;
  const stateHash = state === null ? null : fnv1aHash(state);

  let journal: Journal | null;
  try {
    journal = await journalOf(host, record.persona, record.session, at);
  } catch {
    journal = null;
  }
  if (journal === null) return failed(at);

  const stampId = journalText(record.stampId);
  // The line in either of its two forms: carrying the state, or pointing at
  // the stamp id of the line in the same segment that carries it.
  const lineWith = (lineState: string | null, stateRef: string | null): string => JSON.stringify({
    // The closed set of line kinds, which an outcome line's own `kind` field
    // does not name: that one is the closed set of outcome kinds.
    lineKind: "call",
    stampId: stampId,
    at: new Date(at).toISOString(),
    persona: journalText(record.persona),
    session: journalText(record.session),
    site: journalText(record.site),
    questionSet: journalText(record.questionSet),
    mode: journalText(record.mode),
    // Computed from the clamped id the line stores, not the raw one, so the
    // split a reader derives from the stored id is the split recorded beside
    // it. Unreachable through newStampId, which two segment cuts already bound.
    split: splitOf(stampId),
    stateHash,
    state: lineState,
    stateRef,
    // Null on a call that made no request, which is what the seam's own null
    // latency already says.
    inputTokens: result.ok ? countOf(result.usage.input_tokens) : null,
    outputTokens: result.ok ? countOf(result.usage.output_tokens) : null,
    latencyMs: countOf(result.latencyMs),
    result: result.ok ? "ok" : journalText(result.reason),
    // Built from a message the host or the resolver produced, so bounded by
    // neither until it crosses this boundary.
    detail: result.ok ? null : textOrNull(result.detail),
  }) + "\n";
  const whole = lineWith(state, null);

  // Each candidate segment's last state for the site is read as the line is
  // built for it: the state rides the line only where it differed, and
  // otherwise the line points at the stamp id that carries it. The segment is
  // chosen against the larger of that line and the form carrying the state.
  let repeat = false;
  return writeLines(host, journal, at, [{
    fit: whole,
    build: (segmentPath) => {
      const prior = lastState.get(`${segmentPath}\u0000${record.site}`);
      // A null state is never a repeat: there is no measured text for a later
      // line to point back at, so such a line carries a null reference like
      // the first.
      repeat = stateHash !== null && prior !== undefined && prior.stateHash === stateHash;
      return repeat && prior !== undefined ? lineWith(null, prior.stampId) : whole;
    },
    // The reference is recorded only once the line carrying the state is in
    // the file. A line that never landed is one no later stateRef may name, or
    // a repeat would point at a stamp id no load can find and the state would
    // be lost for the rest of the segment.
    landed: (segmentPath) => {
      if (!repeat && stateHash !== null) lastState.set(`${segmentPath}\u0000${record.site}`, { stateHash, stampId });
    },
  }]);
}

// One answer as it came back, beside the value Haiku gave for the same
// question. `agrees` is computed here rather than passed: agreement is exact
// equality of option id, and it is an agreement record and never a truth.
// `primitive` names which question type answered, since the three shapes
// share these columns: a Choice's `value` is the option id it chose and its
// probabilities are keyed by option id, a Score's is its position on the
// levels and its probabilities are keyed by level number, and a Noul's is the
// probability of yes with no distribution and no confidence beside it.
export type AnswerRecord = {
  callStampId: string;
  questionId: string;
  questionVersion: string;
  overrideRefused: string | null;
  primitive: string;
  value: string;
  probabilities: Record<string, number>;
  confidence: number | null;
  haikuValue: string | null;
};

export type AnswersRecord = {
  persona: string;
  session: string;
  answers: readonly AnswerRecord[];
};

// One `answer` line per answer, each with a stamp id of its own and the call's
// id to join on. A record with no answers writes nothing and reports a landed
// write, since a failed call has no answer to record.
export async function writeAnswers(host: JournalHost, record: AnswersRecord): Promise<JournalWrite> {
  const at = Date.now();
  const answers = Array.isArray(record.answers) ? record.answers : [];
  if (answers.length === 0) return LANDED;
  let journal: Journal | null;
  try {
    journal = await journalOf(host, record.persona, record.session, at);
  } catch {
    journal = null;
  }
  if (journal === null) return failed(at);
  const lines = answers.map((answer) => {
    // Agreement is decided on the values as they arrived, before the clamp,
    // so two option ids that differ only past the cut are not recorded as
    // agreeing. Where such a pair is cut, the two stored columns are byte
    // identical while `agrees` is false, and `agrees` is the authoritative
    // one: the stored pair is lossy and the `...[cut]` suffix is the tell.
    const rawValue = typeof answer.value === "string" ? answer.value : null;
    const rawHaiku = typeof answer.haikuValue === "string" ? answer.haikuValue : null;
    const value = textOrNull(answer.value);
    const haikuValue = textOrNull(answer.haikuValue);
    return JSON.stringify({
      lineKind: "answer",
      stampId: newStampId(record.persona, record.session),
      callStampId: journalText(answer.callStampId),
      questionId: journalText(answer.questionId),
      questionVersion: journalText(answer.questionVersion),
      overrideRefused: textOrNull(answer.overrideRefused),
      // A closed vocabulary, so a value outside it is written as null rather
      // than passed through: a load reads this column to know which of the
      // three shapes the columns beside it carry.
      primitive: QUESTION_PRIMITIVES.includes(answer.primitive as never) ? answer.primitive as string : null,
      value,
      probabilities: probabilitiesOf(answer.probabilities),
      confidence: finiteOf(answer.confidence),
      haikuValue,
      agrees: rawValue !== null && rawHaiku !== null ? rawValue === rawHaiku : null,
    }) + "\n";
  });
  return writeLines(host, journal, at, lines.map(plain));
}

// A signal the plugin produced after the call, joined to it by the call's
// stamp id.
export type OutcomeRecord = {
  persona: string;
  session: string;
  callStampId: string;
  kind: OutcomeKind;
  // Read for a `next_score` and ignored for an `ask_marker`, which always
  // writes ASK_MARKER_VALUE.
  value: string;
};

// One `outcome` line. A kind outside the closed set is refused rather than
// written, because a load reads this column as a closed vocabulary.
export async function writeOutcome(host: JournalHost, record: OutcomeRecord): Promise<JournalWrite> {
  const at = Date.now();
  // Refused without touching the latch. The latch reports the channel
  // failing, and a kind outside the closed set is the caller being wrong
  // rather than the file being unwritable. Arming it here would silence the
  // day's first real write failure.
  if (!OUTCOME_KINDS.includes(record.kind)) return { ok: false, firstFailureToday: false };
  let journal: Journal | null;
  try {
    journal = await journalOf(host, record.persona, record.session, at);
  } catch {
    journal = null;
  }
  if (journal === null) return failed(at);
  const line = {
    lineKind: "outcome",
    stampId: newStampId(record.persona, record.session),
    callStampId: journalText(record.callStampId),
    kind: record.kind,
    // The one field on this line a caller could fill with worker text, so an
    // ask marker's is substituted rather than clamped.
    value: record.kind === "ask_marker" ? ASK_MARKER_VALUE : textOrNull(record.value),
    at: new Date(at).toISOString(),
  };
  return writeLines(host, journal, at, [plain(JSON.stringify(line) + "\n")]);
}

// The rendering text a `rendering` line carries whole: one under this many
// characters. A rendering at or past it is written as an empty text with
// `textOmitted` true, and the line still carries every record's name and
// rendered length, so a scoring pass rebuilds the text from the names
// through `memq get --no-stamp` and checks the rebuild against the counts.
// The bound sits on this channel rather than on the module that renders,
// since every append rewrites its whole segment: a row of unbounded text
// would grow that cost for every later line of the segment and fill segments
// with one prompt's text.
export const RENDERING_TEXT_MAX = 2_000;

// What the recall shadow would have shown for one prompt, written once per
// prompt. `promptSeq` is the prompt's number in its session, which a skip
// line names its predecessor by. `judged` names the records today's memq
// judged read showed, in printed order, and `procedure` the records
// usp_Recall returned, in its fused order, or null where the procedure was
// absent, with `procedureAbsent` the reason. `shown` holds the records the
// rendering holds, in rendering order, each with its rendered text's length
// and whether its body was shown whole rather than as a pointer line.
// `calls` maps each candidate's name to the stamp id of its memory-recall
// call line, so a reader joins a rendering to its candidates' verdicts and
// outcomes by stamp id rather than by time. `rendering` is the text the
// prompt would have carried. A prompt whose shadow did not run writes the
// same line with `skipped` naming why and `skippedFor` the prompt whose
// chain was still collecting, or null where the reason names no prompt,
// and its lists empty; it rides this kind because every reader of the
// journal's kinds already passes a rendering line it does not read.
export type RenderingRecord = {
  persona: string;
  session: string;
  promptSeq: number;
  promptHead: string;
  judged: readonly string[];
  procedure: readonly string[] | null;
  procedureAbsent: string | null;
  // The named read's failure, memq's own sentence, where the procedure
  // answered and the --name records could not be read; null otherwise.
  namedFailed: string | null;
  shown: ReadonlyArray<{ name: string; characters: number; whole: boolean }>;
  calls: Readonly<Record<string, string>>;
  rendering: string;
  skipped: string | null;
  skippedFor: number | null;
};

// One `rendering` line. Every name goes through the clamp, since a name is
// store text. `characters` is the rendering's whole length; `rendering` is
// the text where that length is under RENDERING_TEXT_MAX and empty
// otherwise, with `textOmitted` saying which.
export async function writeRendering(host: JournalHost, record: RenderingRecord): Promise<JournalWrite> {
  const at = Date.now();
  let journal: Journal | null;
  try {
    journal = await journalOf(host, record.persona, record.session, at);
  } catch {
    journal = null;
  }
  if (journal === null) return failed(at);
  const names = (list: readonly string[] | null) => (Array.isArray(list) ? list.map(journalText) : null);
  // Prototype-free for probabilitiesOf's reason: the keys are record names
  // that reach here from store text.
  const calls: Record<string, string> = Object.create(null);
  if (typeof record.calls === "object" && record.calls !== null) {
    for (const [name, stampId] of Object.entries(record.calls)) calls[journalText(name)] = journalText(stampId);
  }
  const rendering = typeof record.rendering === "string" ? record.rendering : "";
  const shown = Array.isArray(record.shown)
    ? record.shown.map((s) => ({ name: journalText(s.name), characters: countOf(s.characters), whole: s.whole === true }))
    : [];
  const omitted = rendering.length >= RENDERING_TEXT_MAX;
  const line = {
    lineKind: "rendering",
    stampId: newStampId(record.persona, record.session),
    at: new Date(at).toISOString(),
    persona: journalText(record.persona),
    session: journalText(record.session),
    promptSeq: countOf(record.promptSeq),
    promptHead: journalText(record.promptHead),
    judged: names(record.judged) ?? [],
    procedure: names(record.procedure),
    procedureAbsent: textOrNull(record.procedureAbsent),
    namedFailed: textOrNull(record.namedFailed),
    shown,
    calls,
    characters: rendering.length,
    textOmitted: omitted,
    rendering: omitted ? "" : rendering,
    skipped: textOrNull(record.skipped),
    skippedFor: countOf(record.skippedFor),
  };
  return writeLines(host, journal, at, [plain(JSON.stringify(line) + "\n")]);
}

// The closed set of event names. A `compaction_gate` is one decision the
// session.compact hook made on a compaction of the main conversation: its
// detail carries the trigger, the verdict, the reason and the context
// percent the engine reported, so a reader counts compactions by trigger and
// verdict without a decision ring to parse. A `compaction_pass` is one
// reading of the compaction pass: at an allowed automatic compaction or its
// precompute, what the pass's plan would have kept beside what the engine's
// summary kept, or why no plan applied; on the timer, with trigger
// `cold_cache`, the same counts at the moment the prompt cache is read as
// expired. A `compaction_pass_disabled` says once per session that the pass
// option is on while the seam's mode sends nothing, so no plan can exist.
// The guard seam's handlers in hooks/index.ts write three: a `guard_verdict`
// is one before-tool guard's verdict on one call, with the guard, the tool,
// `deny` or `allow`, the deny's reason and the guard's own milliseconds, and
// for the memq grant on tool.check `allow` or `silent`; a `guard_shadow` sets
// a guard's verdict beside the kit command hook's for the same call, with the
// call's id as `call`, `module` and `command` each `deny` or `allow` and
// `agree`; a `guard_error` is a guard's or an after hook's own failure, with
// the guard, the phase (`before`, `after`, `catch`, or `check` for the
// grant) and the failure's text. A
// `recognition_nudge` is one record the memory-recognition nudge pointed at,
// with the record's name, its tier, the trigger type (`anchor` for a file
// anchor), the pattern as printable ASCII and the boundary it fired at.
//
// The union and the array carry the same members in the same order: a member
// in the union alone compiles and is refused by writeEvent at runtime.
export type EventName = "compaction_gate" | "compaction_pass" | "compaction_pass_disabled" | "guard_verdict" | "guard_shadow" | "guard_error" | "recognition_nudge";
export const EVENT_NAMES: readonly EventName[] = ["compaction_gate", "compaction_pass", "compaction_pass_disabled", "guard_verdict", "guard_shadow", "guard_error", "recognition_nudge"];

// A value an event's detail may carry: a string, a number, a boolean or null.
export type EventDetailValue = string | number | boolean | null;

// A fact the plugin observed, with no call line to join to. `detail` is a
// flat map whose keys and values the caller chose; this boundary bounds them.
export type EventRecord = {
  persona: string;
  session: string;
  event: EventName;
  detail: Readonly<Record<string, unknown>>;
};

// The detail map as a line carries it: prototype-free, for probabilitiesOf's
// reason, with every key and every string through the clamp. A finite number
// and a boolean ride as themselves; any other value, an undefined or an
// object among them, rides as null, since a column a load reads holds one of
// the four journal types or nothing.
function detailOf(from: unknown): Record<string, EventDetailValue> {
  const out: Record<string, EventDetailValue> = Object.create(null);
  if (typeof from !== "object" || from === null) return out;
  for (const [key, value] of Object.entries(from as Record<string, unknown>)) {
    out[journalText(key)] = typeof value === "string" ? journalText(value)
      : typeof value === "boolean" ? value
      : finiteOf(value);
  }
  return out;
}

// One `event` line. A name outside the closed set is refused rather than
// written, before the host is asked anything and without touching the latch,
// as writeOutcome refuses a kind: the caller is wrong, not the file.
export async function writeEvent(host: JournalHost, record: EventRecord): Promise<JournalWrite> {
  const at = Date.now();
  if (!EVENT_NAMES.includes(record.event)) return { ok: false, firstFailureToday: false };
  let journal: Journal | null;
  try {
    journal = await journalOf(host, record.persona, record.session, at);
  } catch {
    journal = null;
  }
  if (journal === null) return failed(at);
  const line = {
    lineKind: "event",
    stampId: newStampId(record.persona, record.session),
    at: new Date(at).toISOString(),
    persona: journalText(record.persona),
    session: journalText(record.session),
    event: record.event,
    detail: detailOf(record.detail),
  };
  return writeLines(host, journal, at, [plain(JSON.stringify(line) + "\n")]);
}
