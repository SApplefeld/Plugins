// decision-journal.ts: the append-only record of every shadow question this
// plugin puts to Jev, in the row shape a later bulk load into SQL reads.
//
// One file per persona per UTC day per session:
//   <home>/.claude/agentic-decisions/<persona>/<YYYY-MM-DD>-<session>.jsonl
// A file per day bounds the read-and-rewrite an append costs, and a file per
// session means no two processes ever share one.
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
// where `$` crosses an import, so this file takes a JournalHost instead: four
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

// What the journal needs from the host: the home directory and the three file
// calls an append costs.
export type JournalHost = Pick<PluginHost, "getHome" | "writeFile" | "readFile" | "fileExists">;

export const JOURNAL_DIR = ".claude/agentic-decisions";

// One line in five is holdout, which the retraining plan never reads when it
// proposes a wording. The split is a function of the stamp id alone, so it is
// the same answer every time it is asked.
export const HOLDOUT_EVERY = 5;

// The longest a free text field the journal did not author may be. An append
// reads the whole file and rewrites it, so one unbounded message would grow
// that cost for every later line of the day. Every such field is cut to this
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
// persona passes through segment, as at journalPath below, since this is where
// a persona name becomes part of a path. Exported for hooks/index.ts's daily
// outcome pass, which lists this folder to read the calls it answers, so the
// writer and that reader name one folder.
export function journalDirOf(home: string, persona: string): string {
  return joined(home, JOURNAL_DIR, segment(persona));
}

// The journal file name a line of one UTC day and one session lands in, read
// back by the daily outcome pass to tell a journal file from anything else in
// the folder: the day, a dash, a session segment, then `.jsonl`.
export const JOURNAL_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]+\.jsonl$/;

// The file this session's lines for this UTC day belong in, or null where the
// host could not name a home directory. Both segments are sanitized: a persona
// name and a session id are the caller's strings, and this is the one place
// either one becomes part of a path.
async function journalPath(host: JournalHost, persona: string, session: string, at: number): Promise<string | null> {
  let home: unknown;
  try {
    home = await host.getHome();
  } catch {
    home = undefined;
  }
  if (typeof home !== "string" || home.trim().length === 0) return null;
  return `${journalDirOf(home.trim(), persona)}/${utcDay(at)}-${segment(session)}.jsonl`;
}

// --- The write chain and the failure latch ---

// One promise chain per path, so two writes started together both land: the
// append reads the whole file and rewrites it, and two of those interleaved
// would drop a line. A Map rather than an object literal because its keys are
// paths built from a caller's strings.
const chains = new Map<string, Promise<void>>();

function chained(path: string, work: () => Promise<boolean>): Promise<boolean> {
  const prior = chains.get(path) ?? Promise.resolve();
  const next = prior.then(work, work);
  // The chain's own tail swallows both settlements, so one failed write never
  // leaves the next one waiting on a rejected promise.
  chains.set(path, next.then(() => undefined, () => undefined));
  return next;
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

// The append itself, run inside the chain. A file that exists and cannot be
// read is left alone rather than rewritten: a write built on an unreadable
// read would replace the day's lines with one. A line already carrying its
// terminator keeps the one it has.
async function appendLine(host: JournalHost, path: string, line: string): Promise<boolean> {
  try {
    // Read as unknown for the same reason the body below is: a hook above the
    // caller may answer this op event with a value of its own. An answer that
    // is neither true nor false says nothing about the file, and falling
    // through on one would rewrite the day's lines as a single line. The
    // stronger failure is guarded here and the weaker one below.
    const exists: unknown = await host.fileExists(path);
    if (exists !== true && exists !== false) return false;
    let existing = "";
    if (exists === true) {
      const read: unknown = await host.readFile(path);
      if (typeof read !== "string") return false;
      existing = read;
    }
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await host.writeFile(path, existing + sep + (line.endsWith("\n") ? line : line + "\n"));
    return true;
  } catch {
    return false;
  }
}

// Every writer's one path to the file: queue each line on that path's chain
// and report. Nothing here rejects.
async function writeLines(
  host: JournalHost,
  path: string,
  at: number,
  lines: readonly string[],
): Promise<JournalWrite> {
  if (lines.length === 0) return LANDED;
  let allLanded = true;
  for (const line of lines) {
    let landed = false;
    try {
      landed = await chained(path, () => appendLine(host, path, line));
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

// The last state written per site, per file, so a run of calls on an unchanged
// state stores it once. Held in memory rather than read back from the file: a
// restart re-writes the state once per site per file, which is the same shape
// the failure latch has. A Map for the same reason the chain registry is one.
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

  let path: string | null;
  try {
    path = await journalPath(host, record.persona, record.session, at);
  } catch {
    path = null;
  }
  if (path === null) return failed(at);

  // The state rides the line only where this site's last state on this file
  // differed. Otherwise the line points at the stamp id that carries it.
  const stampId = journalText(record.stampId);
  const siteKey = `${path}\u0000${record.site}`;
  const prior = lastState.get(siteKey);
  // A null state is never a repeat: there is no measured text for a later line
  // to point back at, so such a line carries a null reference like the first.
  const repeat = stateHash !== null && prior !== undefined && prior.stateHash === stateHash;

  const line = {
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
    state: repeat ? null : state,
    stateRef: repeat && prior !== undefined ? prior.stampId : null,
    // Null on a call that made no request, which is what the seam's own null
    // latency already says.
    inputTokens: result.ok ? countOf(result.usage.input_tokens) : null,
    outputTokens: result.ok ? countOf(result.usage.output_tokens) : null,
    latencyMs: countOf(result.latencyMs),
    result: result.ok ? "ok" : journalText(result.reason),
    // Built from a message the host or the resolver produced, so bounded by
    // neither until it crosses this boundary.
    detail: result.ok ? null : textOrNull(result.detail),
  };
  const written = await writeLines(host, path, at, [JSON.stringify(line) + "\n"]);
  // The reference is recorded only once the line carrying the state is in the
  // file. A line that never landed is one no later stateRef may name, or a
  // repeat would point at a stamp id no load can find and the state would be
  // lost for the rest of the day.
  if (written.ok && !repeat && stateHash !== null) lastState.set(siteKey, { stateHash, stampId });
  return written;
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
  let path: string | null;
  try {
    path = await journalPath(host, record.persona, record.session, at);
  } catch {
    path = null;
  }
  if (path === null) return failed(at);
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
  return writeLines(host, path, at, lines);
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
  let path: string | null;
  try {
    path = await journalPath(host, record.persona, record.session, at);
  } catch {
    path = null;
  }
  if (path === null) return failed(at);
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
  return writeLines(host, path, at, [JSON.stringify(line) + "\n"]);
}

// The rendering text a `rendering` line carries whole: one under this many
// characters. A rendering at or past it is written as an empty text with
// `textOmitted` true, and the line still carries every record's name and
// rendered length, so a scoring pass rebuilds the text from the names
// through `memq get --no-stamp` and checks the rebuild against the counts.
// The bound sits on this channel rather than on the module that renders,
// since an append rewrites the day's file and the engine refuses a read or a
// write over 4 MiB, past which every later line of the day fails to land: a
// row that could fill the file would silence every question's shadow rows
// for the rest of that day.
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
  let path: string | null;
  try {
    path = await journalPath(host, record.persona, record.session, at);
  } catch {
    path = null;
  }
  if (path === null) return failed(at);
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
  return writeLines(host, path, at, [JSON.stringify(line) + "\n"]);
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
//
// The union and the array carry the same members in the same order: a member
// in the union alone compiles and is refused by writeEvent at runtime.
export type EventName = "compaction_gate" | "compaction_pass" | "compaction_pass_disabled";
export const EVENT_NAMES: readonly EventName[] = ["compaction_gate", "compaction_pass", "compaction_pass_disabled"];

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
  let path: string | null;
  try {
    path = await journalPath(host, record.persona, record.session, at);
  } catch {
    path = null;
  }
  if (path === null) return failed(at);
  const line = {
    lineKind: "event",
    stampId: newStampId(record.persona, record.session),
    at: new Date(at).toISOString(),
    persona: journalText(record.persona),
    session: journalText(record.session),
    event: record.event,
    detail: detailOf(record.detail),
  };
  return writeLines(host, path, at, [JSON.stringify(line) + "\n"]);
}
