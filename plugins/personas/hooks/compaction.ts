// compaction.ts: the rule behind the session.compact veto, and the reads it
// rests on. The hook in hooks/index.ts decides whether an automatic
// compaction of the main conversation may run; this file holds what that
// decision is made of, as functions that take their inputs and return their
// answers, so the harness and the hook read one rule. It also holds the
// compaction pass: the survey of a transcript, the plan built from the
// stale-result verdicts, and the pure apply of a plan to a message list,
// which the timer and the hook in hooks/index.ts drive and the harness
// reads directly.
//
// Two release markers the kit's checkpoint CLI writes are read here. The
// role-boundary marker, `~/.kit/role-boundary/compact-role-boundary.<session>.json`,
// is a session's own declaration that it stands at a durable point; the
// consent marker, `.kit/compact-consent.json` under the working directory's
// scratch directory, is the operator's release. The paths and the age bounds
// match the CLI's own, carried here so the marker the CLI writes is the marker
// this file finds; test/kit-compact-lib.test.js pins the two equal. The match
// rule and the moment rule a declared marker lapses under are this module's
// own: the moment rule reads new work off the turn.start this module saw.
// Any process on the machine can write either file, and this file parses
// them, so every access is guarded and nothing here throws on what a file
// holds. The reads go by name through `$.fs`, which hands out
// no descriptor, so the stat that screens a path's kind and size and the read
// that follows are two lookups of the same name, and a file swapped between
// them is read as whatever stands there at the read, under the parse guards
// below and the engine's own read cap.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts and refuses the whole module
// where `$` crosses an import, so the reads here take a CompactionFs, four
// members hooks/index.ts builds over `$.fs` in a top-level adapter.

import { bracketSafeText, oneLine } from "./agent-state";
import { fnv1aHash } from "./cost-ledger";
import { TOOL_RESULT_STALE_INPUT_MAX, TOOL_RESULT_STALE_RESULT_MAX } from "./question-catalog";

// --- Constants ---

// The valve: the context percent at or past which an automatic compaction
// runs whatever the session declared, read from the percent the engine
// reports.
export const COMPACT_VALVE_PERCENT = 85;

// How often a held session is reminded to declare a boundary, through the
// next tool result after a veto: at most once in this many milliseconds.
export const COMPACT_REMINDER_INTERVAL_MS = 30 * 60 * 1000;

// How long a release marker stays honorable. The kit defines both markers'
// windows as this one value, so one constant retunes both here as there.
export const GATE_HOLD_MAX_IDLE_MS = 4 * 60 * 60 * 1000;
export const ROLE_BOUNDARY_MAX_AGE_MS = GATE_HOLD_MAX_IDLE_MS;
export const CONSENT_MAX_AGE_MS = GATE_HOLD_MAX_IDLE_MS;

// How far into the future a marker's writtenAt may sit and still be read: a
// small clock adjustment between the write and the read is tolerated, and a
// far-future stamp is refused so a clock change can never mint an immortal
// marker.
export const CHECKPOINT_FUTURE_SKEW_MS = 2 * 60 * 1000;

// A marker file's read cap. The writer produces a few short fields and never
// grows, so anything past this is not something it wrote.
export const MARKER_MAX_BYTES = 64 * 1024;

// The kit's checkpoint CLI and the verb that declares a boundary, as a skip
// reason and a reminder name them where no install path renders.
export const CHECKPOINT_CLI_NAME = "kit-compact-checkpoint.js";
export const BOUNDARY_VERB = `${CHECKPOINT_CLI_NAME} boundary`;

// The grammar an install path is held to before it is composed into a
// command the model is told to run: letters, digits, space, and the
// punctuation a real install path needs. Every shell metacharacter that
// survives double-quoting is outside it, the dollar sign and the backtick
// above all, and so is every non-ASCII byte and every backslash, since the
// path is rendered with forward slashes inside double quotes. The length is
// bounded so no pathological path reaches the context.
export const SAFE_CLI_PATH = /^[A-Za-z0-9 _.:/~()+-]{1,256}$/;

// --- The host ---

// What the marker reads need from the engine's file system: existence, the
// stat that screens a path's kind and size before it is opened, the read,
// and the write that consumes a marker. Each member is one `$.fs` call.
export type CompactionFs = {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ kind: string; size: number; isLink: boolean }>;
  read(path: string): Promise<unknown>;
  write(path: string, text: string): Promise<void>;
};

// --- Paths ---

// The join hooks/decision-journal.ts uses: trailing separators off the root,
// then an unconditional forward slash, which Windows resolves as readily as
// POSIX.
function joined(root: string, ...parts: string[]): string {
  return [root.replace(/[/\\]+$/, ""), ...parts.filter((p) => p !== "")].join("/");
}

// Whether a path spells a network location, `\\host\share` or `//host/share`:
// reading one makes this machine authenticate outbound and block for the
// connection's timeout, so no marker path is composed from it.
export function namesNetworkShare(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return /^[\\/]{2}/.test(value);
}

// Whether a path is absolute on either platform: a drive letter with a
// separator, or a leading separator.
function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]/.test(value);
}

// A path with forward slashes, no trailing separator and its `.` and `..`
// segments resolved, for comparison: a parent segment steps over the segment
// before it and stops at an absolute path's root, while a relative path
// keeps a parent segment it cannot step over. The kit's resolver compares
// paths through path.relative, which resolves the same segments, so a
// directory spelled into or out of another through `..` is placed where the
// kit places it rather than where its text starts.
function normalized(value: string): string {
  const slashed = value.replace(/\\/g, "/");
  const root = /^(?:[A-Za-z]:)?\/?/.exec(slashed)![0];
  const segments: string[] = [];
  for (const segment of slashed.slice(root.length).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") { segments.push(segment); continue; }
    if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
    else if (root === "") segments.push("..");
  }
  return root + segments.join("/");
}

// Whether a path spells a Windows drive, which the file system compares case
// insensitively.
function isDrivePath(value: string): boolean {
  return /^[A-Za-z]:/.test(value);
}

// The relative path of `target` under `root`, with forward slashes: "" where
// they are one directory, null where target is not under root. The
// comparison is on components, and case-insensitive where either is a drive
// path, which is how the kit's resolver decides the same question.
function relativeUnder(root: string, target: string): string | null {
  const r = normalized(root);
  const t = normalized(target);
  const fold = isDrivePath(r) || isDrivePath(t) ? (s: string) => s.toLowerCase() : (s: string) => s;
  if (fold(r) === fold(t)) return "";
  const prefix = r.endsWith("/") ? r : `${r}/`;
  if (!fold(t).startsWith(fold(prefix))) return null;
  return t.slice(prefix.length);
}

// A session id a marker may be scoped to, or null. Charset plus a leading
// character rule: a value opening with a dash reads as an option to any
// parser that meets it later. A passing value is a single path component, so
// an id carrying a separator, a parent segment or a leading dash resolves to
// nothing rather than to a path somewhere else.
export function usableSessionId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : null;
}

// Two session ids compared as opaque, case-insensitive strings, since the
// harness surfaces session UUIDs in mixed case. False when either side is
// missing, which is the treat-as-absent handling a marker with no session
// needs.
export function sameSessionId(a: unknown, b: unknown): boolean {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// The directory every role-boundary marker on this machine lives in,
// `~/.kit/role-boundary`, or null where no such root can be opened. It hangs
// off the home directory rather than off any project directory, so a
// session's marker resolves to one file however many directories that
// session works in. A home that is unknown, empty, relative or a network
// share answers null, which every reader here takes as "no marker".
export function roleBoundaryRoot(home: unknown): string | null {
  if (typeof home !== "string" || home.trim() === "" || !isAbsolutePath(home.trim()) || namesNetworkShare(home.trim())) return null;
  return joined(home.trim(), ".kit", "role-boundary");
}

// One session's role-boundary marker in that root, or null where the id or
// the root composes no path. The id composes the name as it is given, while
// the match rule compares ids case-insensitively, as the CLI does.
export function roleBoundaryPath(home: unknown, sessionId: unknown): string | null {
  const id = usableSessionId(sessionId);
  if (id === null) return null;
  const root = roleBoundaryRoot(home);
  if (root === null) return null;
  return joined(root, `compact-role-boundary.${id}.json`);
}

// The kit's scratch directory for a working directory: `.kit` under it, or,
// for a working directory under the home's `.claude`, which is the memory
// store's git-synced repository, `~/.kit/store/<rel>`, keeping the relative
// shape so two store-backed project directories cannot collide. A consent the
// CLI wrote for a store-homed session is found only through this redirect.
export function kitScratchDir(home: unknown, cwd: string): string {
  if (typeof home === "string" && home.trim() !== "") {
    const rel = relativeUnder(joined(home.trim(), ".claude"), cwd);
    if (rel !== null) return joined(home.trim(), ".kit", "store", rel);
  }
  return joined(cwd, ".kit");
}

// The operator-consent marker for a working directory, or null where the
// directory is not yet known: the module holds "" for it until session.start
// reads it, and a path composed from "" would sit at the file system's root.
export function consentPath(home: unknown, cwd: string): string | null {
  if (typeof cwd !== "string" || cwd.trim() === "") return null;
  return joined(kitScratchDir(home, cwd), "compact-consent.json");
}

// --- The match rule ---

// Why a marker did not match, naming the first failed clause in evaluation
// order, or null on a match.
export type MarkerMismatch = "no-marker" | "consumed" | "wrong-session" | "no-timestamp" | "expired" | "future" | "inbound";
export type MarkerMatch = { ok: true; reason: null } | { ok: false; reason: MarkerMismatch };

// The one marker match rule, this module's own. A marker counts only for the
// session it names, only while unconsumed, and only within the age bound the
// caller passes: the two marker kinds differ in nothing but that bound.
// `consumed` must be a literal false: the writer always records one, so a
// record without it is not one of ours, and the conservative reading is the
// dead one. A caller that passes no finite bound narrows the window to
// nothing rather than widening it. Never throws on JSON-derived input.
export function markerMatches(marker: unknown, sessionId: unknown, nowMs: number, maxAgeMs: number): MarkerMatch {
  const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!marker || typeof marker !== "object" || Array.isArray(marker) || typeof (marker as { session?: unknown }).session !== "string") {
    return { ok: false, reason: "no-marker" };
  }
  const record = marker as { session: string; consumed?: unknown; writtenAt?: unknown };
  if (record.consumed !== false) return { ok: false, reason: "consumed" };
  if (!sameSessionId(record.session, sessionId)) return { ok: false, reason: "wrong-session" };
  if (typeof record.writtenAt !== "string") return { ok: false, reason: "no-timestamp" };
  const written = Date.parse(record.writtenAt);
  if (!Number.isFinite(written)) return { ok: false, reason: "no-timestamp" };
  if (typeof maxAgeMs !== "number" || !Number.isFinite(maxAgeMs)) return { ok: false, reason: "expired" };
  const age = now - written;
  if (age > maxAgeMs) return { ok: false, reason: "expired" };
  if (age < -CHECKPOINT_FUTURE_SKEW_MS) return { ok: false, reason: "future" };
  return { ok: true, reason: null };
}

// Whether a marker declares a moment: the boundary verb stamps the marker it
// writes `declared: true`, saying the session's context held at that instant
// and no other. The seat-stop hook's turn-end bank carries no such field and
// is outside the moment rule, on its age bound alone: it is written at a
// turn's end, while a compaction offer only ever arrives inside a later
// turn, so a moment test over it would lapse every marker it wrote.
export function markerDeclaresMoment(marker: unknown): boolean {
  return !!marker && typeof marker === "object" && !Array.isArray(marker) && (marker as { declared?: unknown }).declared === true;
}

// Whether a marker still describes the moment it was written in. A declared
// marker lapses once new work arrives in the main conversation, which is a
// main-loop turn starting after it was written: `lastTurnStartMs` is when the
// latest one started, 0 where none has, as the module saw the turn start
// itself. The answer for a marker that declares no moment is a match, and
// for one whose writtenAt the match rule would already refuse, the match
// rule's own refusal, so this rule and that one compose in either order.
// Never throws on JSON-derived input.
export function markerMomentHolds(marker: unknown, lastTurnStartMs: number): MarkerMatch {
  if (!markerDeclaresMoment(marker)) return { ok: true, reason: null };
  const writtenAt = (marker as { writtenAt?: unknown }).writtenAt;
  const written = typeof writtenAt === "string" ? Date.parse(writtenAt) : Number.NaN;
  if (!Number.isFinite(written)) return { ok: false, reason: "no-timestamp" };
  if (typeof lastTurnStartMs === "number" && Number.isFinite(lastTurnStartMs) && written < lastTurnStartMs) return { ok: false, reason: "inbound" };
  return { ok: true, reason: null };
}

// --- The marker reads ---

// What a marker read answered. `marker` is the parsed record or null, and
// `reason` names why none was read: `absent` where nothing is at the path,
// `illegible` where a file there is not JSON, `null` where it is the JSON
// null, which parses to no record and would otherwise read as a match's own
// null reason, `kind` where the path is not a plain file (a directory, a
// link, something else), `oversized` where it is past the read cap, `stat`
// or `unreadable` where the engine refused the stat or the read, and
// `no-path` where no path composed. Every refusal means the same thing to
// the veto: no marker releases anything.
export type MarkerRead = { marker: unknown; reason: string | null };

export async function readMarker(fs: CompactionFs, path: string | null): Promise<MarkerRead> {
  if (path === null) return { marker: null, reason: "no-path" };
  try {
    if ((await fs.exists(path)) !== true) return { marker: null, reason: "absent" };
  } catch {
    return { marker: null, reason: "absent" };
  }
  // The path's kind and size are read before it is opened: a link is judged
  // as a link rather than as its target, and a file nothing here wrote is
  // not copied into the plugin's environment.
  try {
    const st = await fs.stat(path);
    if (st.kind !== "file" || st.isLink === true) return { marker: null, reason: "kind" };
    if (typeof st.size === "number" && st.size > MARKER_MAX_BYTES) return { marker: null, reason: "oversized" };
  } catch {
    return { marker: null, reason: "stat" };
  }
  let raw: unknown;
  try {
    raw = await fs.read(path);
  } catch {
    return { marker: null, reason: "unreadable" };
  }
  if (typeof raw !== "string") return { marker: null, reason: "unreadable" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { marker: null, reason: "illegible" };
  }
  if (parsed === null) return { marker: null, reason: "null" };
  return { marker: parsed, reason: null };
}

// Consumes a marker that released a compaction: the record is written back
// with `consumed: true`, which the match rule reads as dead. The file is
// never deleted, since `$.fs` offers no delete, and the write-back is what
// marks the marker spent.
// Resolves whether the write landed; a refused write leaves the marker live,
// which costs one extra release inside its age bound and never a held session.
export async function consumeMarker(fs: CompactionFs, path: string, marker: unknown): Promise<boolean> {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false;
  try {
    await fs.write(path, JSON.stringify({ ...(marker as Record<string, unknown>), consumed: true }));
    return true;
  } catch {
    return false;
  }
}

// --- The usage read ---

// The context percent out of what `$.session.usage()` answered, or null where
// the answer carries none: a fresh or just-compacted window has no percent
// until its first response, and a rejected call is passed here as undefined.
export function percentOf(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const context = (usage as { context?: unknown }).context;
  if (typeof context !== "object" || context === null) return null;
  const percent = (context as { percent?: unknown }).percent;
  return typeof percent === "number" && Number.isFinite(percent) ? percent : null;
}

// The live context percent out of a `$.session.usage({ breakdown })` answer:
// the breakdown's `totalTokens` over the answer's own `context.window`, as a
// percentage, or null where either is missing. `context.percent` is the last
// response's input side and sits still while a prompt grows, so an `auto`
// compaction the engine runs for a prompt too long can arrive under the
// valve by that figure; `totalTokens` is the engine's live estimate of the
// tokens in use, unclamped past the window when over it, and `window` is the
// model's context window, the base `context.percent` is on, so the two
// percents compare. The breakdown's own `percentage` is not that figure: it
// is `totalTokens` over `rawMaxTokens`, the compaction window, which a
// configured auto-compaction window makes smaller than the model's, and a
// hold compared on it opens the valve at a fill the bare percent reads far
// under. A non-finite or non-positive window, a non-finite totalTokens, an
// absent breakdown and a rejected call, passed here as undefined, each
// answer null. The percent is rounded to a whole number, as the engine's own
// percents are, so the skip line and the journal never print a fraction.
export function breakdownPercentOfWindow(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const context = (usage as { context?: unknown }).context;
  if (typeof context !== "object" || context === null) return null;
  const window = (context as { window?: unknown }).window;
  if (typeof window !== "number" || !Number.isFinite(window) || window <= 0) return null;
  const breakdown = (context as { breakdown?: unknown }).breakdown;
  if (typeof breakdown !== "object" || breakdown === null) return null;
  const totalTokens = (breakdown as { totalTokens?: unknown }).totalTokens;
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens)) return null;
  return Math.round(totalTokens / window * 100);
}

// Which engine reading the valve was decided on: the bare usage call's
// `context.percent`, or the breakdown's `totalTokens` against the model's
// window where a held compaction took that second reading and it was the
// larger.
export type PercentSource = "usage" | "breakdown";

// --- The rule ---

// What released an allowed compaction, so the hook consumes exactly that:
// the module's own bank, the role-boundary marker, or the consent marker.
export type CompactionRelease = "bank" | "marker" | "consent";

// A skip carries the percent it was decided at, which the rule guarantees is
// a number: no percent allows.
export type CompactionDecision =
  | { verdict: "allow"; reason: "boundary" | "consent" | "valve" | "illegible"; release: CompactionRelease | null }
  | { verdict: "skip"; reason: "no-boundary"; release: null; percent: number };

// The allow order, each a named reason. The session's own durable point
// first, the bank or a live marker, then the operator's consent, then the
// valve, then the illegible read: a veto the module cannot bound would be the
// death spiral the kit's ceiling existed to stop, so no percent allows.
// Otherwise the compaction is held.
export function decideCompaction(input: { bankSet: boolean; marker: MarkerMatch; consent: MarkerMatch; percent: number | null }): CompactionDecision {
  if (input.bankSet) return { verdict: "allow", reason: "boundary", release: "bank" };
  if (input.marker.ok) return { verdict: "allow", reason: "boundary", release: "marker" };
  if (input.consent.ok) return { verdict: "allow", reason: "consent", release: "consent" };
  if (input.percent !== null && input.percent >= COMPACT_VALVE_PERCENT) return { verdict: "allow", reason: "valve", release: null };
  if (input.percent === null) return { verdict: "allow", reason: "illegible", release: null };
  return { verdict: "skip", reason: "no-boundary", release: null, percent: input.percent };
}

// --- The texts ---

// The one line the engine prints for a held compaction. It names the
// boundary verb and the percent the session stands at, and the valve.
export function skipReasonText(percent: number): string {
  return `The persona module held this automatic compaction at ${percent} percent of the context window: no boundary is declared for it to land at. Declare one with ${BOUNDARY_VERB}, or it runs at ${COMPACT_VALVE_PERCENT} percent.`;
}

// The checkpoint CLI's boundary verb as a command the reminder tells a
// session to run: `node "<install>/hooks/kit-compact-checkpoint.js" boundary`
// with forward slashes as node accepts them on Windows, and the bare verb
// where no install path resolves or the path fails the grammar, since the
// install record is a file on disk and this clause is text the model is told
// to execute. An install path under the home directory renders with the home
// spelled `$HOME`, this module's own spelling. An installed kit sits
// under `~/.claude/plugins/cache/`, so the composed command would otherwise
// carry the OS account name into the model's context on every fire. It is
// `$HOME` rather than `~` because the line is one to run, and a tilde inside
// double quotes is expanded by neither shell a session has in front of it.
// Containment is decided on path components, case-insensitively on a drive
// path, as the kit decides it, and the grammar then runs over the tail
// alone, which is the whole of what is composed here out of a value. A home
// that is unknown or relative is a different fact from an install path
// outside the home, and only the second licenses printing an absolute path
// into this channel, so the first answers the bare verb.
export function checkpointCommandClause(installPath: unknown, home: unknown): { clause: string; runnable: boolean } {
  const bare = { clause: BOUNDARY_VERB, runnable: false };
  if (typeof installPath !== "string" || installPath.trim() === "") return bare;
  if (typeof home !== "string" || home.trim() === "" || !isAbsolutePath(home.trim())) return bare;
  const script = `${normalized(installPath.trim())}/hooks/${CHECKPOINT_CLI_NAME}`;
  const rel = isAbsolutePath(script) ? relativeUnder(home.trim(), script) : null;
  const tail = rel === null ? script : rel;
  if (rel === "" || !SAFE_CLI_PATH.test(tail)) return bare;
  return { clause: `node "${rel === null ? "" : "$HOME/"}${tail}" boundary`, runnable: true };
}

// --- The pass: constants ---

// The context percent at or above which the timer computes a plan. Below it
// a compaction is far enough off that the verdicts would go stale, and the
// asks would cost calls for nothing.
export const COMPACT_PASS_FLOOR_PERCENT = 50;

// How many messages must arrive after a plan before the timer recomputes
// it, so a quiet session is not re-surveyed every tick.
export const COMPACT_PLAN_STALE_MESSAGES = 10;

// How many of the newest messages the pass keeps whole and asks nothing
// about: the session's working set.
export const COMPACT_TAIL_MESSAGES = 20;

// The most results the timer asks about in one tick, each its own request;
// the rest wait for the next tick.
export const COMPACT_ASK_BATCH = 20;

// The prompt cache's life on the one-hour tier, and the margin past it at
// which the module reads the cache as expired, both in seconds. The engine
// reports expiry only at a resumed start and a model switch, so an idle
// running session is read from the module's own clock.
export const COMPACT_CACHE_LIFE_S = 3600;
export const COMPACT_CACHE_MARGIN_S = 300;

// The size estimate's rate, characters per token, and the share of the
// auto-compaction threshold (or of the window, where no threshold is read) a
// plan may keep and still apply.
export const COMPACT_CHARS_PER_TOKEN = 4;
export const COMPACT_TARGET_FRACTION = 0.6;

// The most characters of a tool input the pass carries into a question's
// state or a cut line, and the most of a result it carries into a state: the
// question's own bounds, declared once in hooks/question-catalog.ts.
export const COMPACT_INPUT_HEAD_MAX = TOOL_RESULT_STALE_INPUT_MAX;
export const COMPACT_RESULT_HEAD_MAX = TOOL_RESULT_STALE_RESULT_MAX;

// The most identifiers taken from one tool input for the later-reference
// read, and the most characters of each.
export const COMPACT_REFERENCE_TOKENS_MAX = 8;
export const COMPACT_REFERENCE_TOKEN_CHARS = 120;

// The tool whose answer carries a skill's body, and the text that opens the
// body block in the Messages API form of the user message answering it. A
// skill's body is instructions the session works under, never a stale
// result, so the pass treats it apart from every other result.
export const SKILL_TOOL = "Skill";
export const SKILL_BODY_OPENING = "Base directory for this skill:";

// --- The pass: shapes ---

// A verdict on one tool result: keep it as it is, cut its text to one line,
// or drop it with its call.
export type ToolVerdict = "keep" | "cut" | "drop";
export const TOOL_VERDICTS: readonly ToolVerdict[] = ["keep", "cut", "drop"];

// Whether a value is one of the three verdicts.
export function isToolVerdict(value: unknown): value is ToolVerdict {
  return typeof value === "string" && (TOOL_VERDICTS as readonly string[]).includes(value);
}

// One message in the rows form, as $.session.messages() returns it and as
// session.compact's e.messages carries it: the fields the pass reads, with
// the engine's handle where the hook supplied one.
export type PassToolUse = { tool_use_id: string; tool: string; input?: unknown; text?: string; isError?: boolean };
export type PassToolResult = { tool_use_id: string; text: string; isError?: boolean };
export type PassMessage = {
  role: "user" | "assistant";
  text: string;
  toolUses?: readonly PassToolUse[];
  toolResults?: readonly PassToolResult[];
  handle?: string;
};

// One cached verdict: what is applied, what Jev answered, and whether the
// stamp fell on the journal's holdout split, where the applied verdict is
// keep whatever Jev said.
export type CachedVerdict = { verdict: ToolVerdict; answered: string; holdout: boolean };

// What the pass knows about one result it is about to ask about.
export type ResultCandidate = {
  id: string;
  tool: string;
  inputHead: string;
  resultHead: string;
  resultChars: number;
  errored: boolean;
  messagesOld: number;
  referencedLater: boolean;
};

// The survey of a transcript: its stand-in keys, the results to ask about,
// and the skill rule's reading.
export type PassSurvey = {
  rowCount: number;
  keys: string[];
  tailStart: number;
  ask: ResultCandidate[];
  skillKept: string[];
  skillSuperseded: string[];
  skillBodyChars: Record<string, number>;
  unjudged: number;
};

// A plan: the verdicts over the transcript as it stood, the ordered stand-in
// keys of its rows, and what applying it to that transcript kept.
export type CompactionPlan = {
  builtAt: number;
  rowCount: number;
  keys: string[];
  verdicts: Record<string, ToolVerdict>;
  skillKept: string[];
  skillSuperseded: number;
  skillBodyChars: Record<string, number>;
  counts: { keep: number; cut: number; drop: number; holdout: number };
  unjudged: number;
  keptCount: number;
  keptTokens: number;
  droppedTokens: number;
  targetTokens: number | null;
};

// What applying a plan to a message list produced.
export type ApplyResult = {
  messages: PassMessage[];
  counts: { keep: number; cut: number; drop: number };
  keptCount: number;
  keptChars: number;
  droppedChars: number;
  skillKept: number;
  skillSuperseded: number;
  alternates: boolean;
};

// --- The pass: reading a transcript ---

// The stand-in for a message handle. A row from $.session.messages() carries
// no handle, and only the hook's e.messages does, so a plan built on the
// timer matches the hook's messages by this key: the role, the ids of the
// row's tool blocks, and a hash of its text. Two forms of one transcript
// give the same sequence of keys, and a message the engine rewrote gives
// another, which the coverage test reads as a mismatch.
export function rowKey(message: PassMessage): string {
  const uses = (message.toolUses ?? []).map((u) => u.tool_use_id).join(",");
  const results = (message.toolResults ?? []).map((r) => r.tool_use_id).join(",");
  return `${message.role}|${uses}|${results}|${fnv1aHash(typeof message.text === "string" ? message.text : "").toString(16)}`;
}

// Whether the plan's keys open the message list: the plan covers the
// transcript where every key it holds matches the message at its position.
export function keysPrefix(keys: readonly string[], messages: readonly PassMessage[]): boolean {
  if (keys.length > messages.length) return false;
  for (let i = 0; i < keys.length; i += 1) {
    if (rowKey(messages[i]) !== keys[i]) return false;
  }
  return true;
}

// A tool input's head: its JSON on one line, cut at the input bound, with its
// brackets folded, since the head reaches a question's state and a cut line.
export function inputHeadOf(input: unknown): string {
  let text: string;
  try {
    text = input === undefined ? "" : JSON.stringify(input) ?? "";
  } catch {
    text = "";
  }
  return bracketSafeText(oneLine(text)).slice(0, COMPACT_INPUT_HEAD_MAX);
}

// The characters a message costs in the context: its text, each tool call's
// name, input and recorded text, and each result's text. A kept skill body
// adds its body's size, read from the API form at survey time, since the
// rows carry no body.
export function messageChars(message: PassMessage, skillBodyChars: Readonly<Record<string, number>> = {}): number {
  let n = typeof message.text === "string" ? message.text.length : 0;
  for (const u of message.toolUses ?? []) {
    n += u.tool.length;
    try { n += (JSON.stringify(u.input) ?? "").length; } catch { /* an input that cannot be stringified costs its name alone */ }
    if (typeof u.text === "string") n += u.text.length;
  }
  for (const r of message.toolResults ?? []) {
    n += typeof r.text === "string" ? r.text.length : 0;
    const body = skillBodyChars[r.tool_use_id];
    if (typeof body === "number" && Number.isFinite(body)) n += body;
  }
  return n;
}

// Characters as tokens, at the estimate's rate, rounded up.
export function tokensOf(chars: number): number {
  return Math.ceil(Math.max(0, chars) / COMPACT_CHARS_PER_TOKEN);
}

// The body-carrying Skill results in a transcript's Messages API form, by
// tool_use_id, each with its body's size: a user message holding a
// tool_result block answering a Skill call and, beside it, a text block
// opening with the skill body opening marks each such tool_result in that
// message as body-carrying, the body text shared equally among them; a
// result answering another tool in the same message takes none. The Skill
// calls are read from the assistant messages' tool_use blocks. The join to
// the rows is by id, since the rows split a thinking-only assistant message
// into a row of its own and the two forms' indexes do not align. Never
// throws on what the engine answered.
export function skillBodiesOf(api: unknown): Record<string, number> {
  const out: Record<string, number> = Object.create(null);
  if (!Array.isArray(api)) return out;
  const skillCalls = new Set<string>();
  for (const message of api) {
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: unknown; id?: unknown; name?: unknown };
      if (b.type === "tool_use" && b.name === SKILL_TOOL && typeof b.id === "string") skillCalls.add(b.id);
    }
  }
  for (const message of api) {
    if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    const ids: string[] = [];
    let bodyChars = 0;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: unknown; tool_use_id?: unknown; text?: unknown };
      if (b.type === "tool_result" && typeof b.tool_use_id === "string" && skillCalls.has(b.tool_use_id)) ids.push(b.tool_use_id);
      else if (b.type === "text" && typeof b.text === "string" && b.text.startsWith(SKILL_BODY_OPENING)) bodyChars += b.text.length;
    }
    if (bodyChars === 0 || ids.length === 0) continue;
    for (const id of ids) out[id] = Math.ceil(bodyChars / ids.length);
  }
  return out;
}

// The identifiers a tool input names: the string values of its fields, split
// on whitespace and quotes, keeping tokens that read as a path or an
// identifier, bounded in count and length.
export function referenceTokensOf(input: unknown): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const take = (value: unknown): void => {
    if (tokens.length >= COMPACT_REFERENCE_TOKENS_MAX) return;
    if (typeof value === "string") {
      for (const raw of value.split(/[\s"'`]+/)) {
        const token = raw.replace(/^[(\[{<]+|[)\]}>,;:]+$/g, "").slice(0, COMPACT_REFERENCE_TOKEN_CHARS);
        if (token.length < 6) continue;
        if (!/[/\\._-]/.test(token) && token.length < 8) continue;
        if (!/[A-Za-z0-9]/.test(token)) continue;
        if (seen.has(token)) continue;
        seen.add(token);
        tokens.push(token);
        if (tokens.length >= COMPACT_REFERENCE_TOKENS_MAX) return;
      }
    } else if (Array.isArray(value)) {
      for (const v of value) take(v);
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) take(v);
    }
  };
  take(input);
  return tokens;
}

// The text the later-reference read searches in one row: its text and each
// tool call's input as JSON. Results' text is not read: a later result that
// repeats a path says nothing about whether the session acted on it. Built
// once per row per survey, since every candidate reads the rows after it.
export function rowSearchText(row: PassMessage): string {
  const texts: string[] = [typeof row.text === "string" ? row.text : ""];
  for (const u of row.toolUses ?? []) {
    try { texts.push(JSON.stringify(u.input) ?? ""); } catch { /* unreadable input names nothing */ }
  }
  return texts.join("\n");
}

// Whether any row's search text from `from` on names one of the tokens.
export function referencedAfter(searchTexts: readonly string[], from: number, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  for (let i = from; i < searchTexts.length; i += 1) {
    const text = searchTexts[i];
    for (const token of tokens) if (text.includes(token)) return true;
  }
  return false;
}

// The survey of a transcript. Every tool call is paired with its result by
// id; a result in the tail is left alone; a Skill call is never asked, and
// the skill rule decides it: the newest body-carrying call of each skill is
// kept, an older body-carrying call of the same skill outside the tail is
// superseded and dropped with its call, and a call whose answer carries no
// body is kept. Every other result outside the tail with no cached verdict
// is a candidate to ask about. `verdicts` is the cache, read for membership
// alone. Only the oldest `askLimit` candidates are built, since building one
// scans every later message; `unjudged` counts them all.
export function surveyTranscript(
  rows: readonly PassMessage[],
  api: unknown,
  verdicts: Readonly<Record<string, unknown>>,
  tail: number = COMPACT_TAIL_MESSAGES,
  askLimit: number = COMPACT_ASK_BATCH,
): PassSurvey {
  const skillBodyChars = skillBodiesOf(api);
  const tailStart = Math.max(0, rows.length - tail);
  const searchTexts = rows.map(rowSearchText);
  const calls = new Map<string, { tool: string; input: unknown; callRow: number }>();
  const results = new Map<string, { text: string; errored: boolean; resultRow: number }>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    for (const u of row.toolUses ?? []) {
      if (typeof u.tool_use_id === "string" && !calls.has(u.tool_use_id)) calls.set(u.tool_use_id, { tool: typeof u.tool === "string" ? u.tool : "", input: u.input, callRow: i });
    }
    for (const r of row.toolResults ?? []) {
      if (typeof r.tool_use_id === "string" && !results.has(r.tool_use_id)) results.set(r.tool_use_id, { text: typeof r.text === "string" ? r.text : "", errored: r.isError === true, resultRow: i });
    }
  }
  // The skill rule, over every Skill call with a result, in or out of the
  // tail: the newest body-carrying call per skill name is the kept one.
  const newestBody = new Map<string, { id: string; row: number }>();
  for (const [id, call] of calls) {
    if (call.tool !== SKILL_TOOL || skillBodyChars[id] === undefined) continue;
    const result = results.get(id);
    if (result === undefined) continue;
    const name = skillNameOf(call.input);
    const held = newestBody.get(name);
    if (held === undefined || result.resultRow > held.row) newestBody.set(name, { id, row: result.resultRow });
  }
  const skillKept: string[] = [];
  const skillSuperseded: string[] = [];
  const ask: ResultCandidate[] = [];
  let unjudged = 0;
  for (const [id, result] of results) {
    const call = calls.get(id);
    if (call === undefined) continue;
    if (call.tool === SKILL_TOOL) {
      if (skillBodyChars[id] === undefined) { skillKept.push(id); continue; }
      const newest = newestBody.get(skillNameOf(call.input));
      if (newest !== undefined && newest.id === id) skillKept.push(id);
      else if (result.resultRow < tailStart) skillSuperseded.push(id);
      else skillKept.push(id);
      continue;
    }
    if (result.resultRow >= tailStart) continue;
    if (Object.hasOwn(verdicts, id)) continue;
    unjudged += 1;
    if (ask.length >= askLimit) continue;
    ask.push({
      id,
      tool: call.tool,
      inputHead: inputHeadOf(call.input),
      resultHead: result.text.slice(0, COMPACT_RESULT_HEAD_MAX),
      resultChars: result.text.length,
      errored: result.errored,
      messagesOld: rows.length - 1 - result.resultRow,
      referencedLater: referencedAfter(searchTexts, result.resultRow + 1, referenceTokensOf(call.input)),
    });
  }
  return { rowCount: rows.length, keys: rows.map(rowKey), tailStart, ask, skillKept, skillSuperseded, skillBodyChars, unjudged };
}

// The skill a Skill call names, from its input, or "" where it names none.
function skillNameOf(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const skill = (input as { skill?: unknown }).skill;
  return typeof skill === "string" ? skill : "";
}

// --- The pass: the plan ---

// The target a plan's kept estimate must sit at or under to apply: the
// auto-compaction threshold's share where the usage breakdown gives one,
// else the same share of the model's window, null where neither is read.
export function targetTokensOf(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const context = (usage as { context?: unknown }).context;
  if (typeof context !== "object" || context === null) return null;
  const breakdown = (context as { breakdown?: unknown }).breakdown;
  const threshold = typeof breakdown === "object" && breakdown !== null ? (breakdown as { autoCompactThreshold?: unknown }).autoCompactThreshold : undefined;
  if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0) return Math.floor(threshold * COMPACT_TARGET_FRACTION);
  const window = (context as { window?: unknown }).window;
  if (typeof window === "number" && Number.isFinite(window) && window > 0) return Math.floor(window * COMPACT_TARGET_FRACTION);
  return null;
}

// A plan over a surveyed transcript from the verdict cache: each judged
// result outside the tail takes its cached verdict, a superseded skill body
// drops, and everything else keeps. The plan is applied to the rows once
// here, so its kept estimate is the estimate the hook compares against the
// target.
export function buildPlan(
  rows: readonly PassMessage[],
  survey: PassSurvey,
  cache: Readonly<Record<string, CachedVerdict>>,
  targetTokens: number | null,
  now: number,
): CompactionPlan {
  const verdicts: Record<string, ToolVerdict> = Object.create(null);
  const counts = { keep: 0, cut: 0, drop: 0, holdout: 0 };
  const skillIds = new Set([...survey.skillKept, ...survey.skillSuperseded]);
  for (let i = 0; i < survey.tailStart; i += 1) {
    for (const r of rows[i].toolResults ?? []) {
      if (skillIds.has(r.tool_use_id)) continue;
      const cached = cache[r.tool_use_id];
      if (cached === undefined || !isToolVerdict(cached.verdict)) continue;
      verdicts[r.tool_use_id] = cached.verdict;
      counts[cached.verdict] += 1;
      if (cached.holdout) counts.holdout += 1;
    }
  }
  for (const id of survey.skillSuperseded) verdicts[id] = "drop";
  const applied = applyPlan(rows, { verdicts, skillKept: survey.skillKept, skillBodyChars: survey.skillBodyChars });
  return {
    builtAt: now,
    rowCount: survey.rowCount,
    keys: survey.keys,
    verdicts,
    skillKept: survey.skillKept,
    skillSuperseded: survey.skillSuperseded.length,
    skillBodyChars: survey.skillBodyChars,
    counts,
    unjudged: survey.unjudged,
    keptCount: applied.keptCount,
    keptTokens: tokensOf(applied.keptChars),
    droppedTokens: tokensOf(applied.droppedChars),
    targetTokens,
  };
}

// Why a plan does not apply to a message list, or null where it does: no
// plan, keys that do not open the list, a kept estimate over the target or
// no target to read it against, and an apply that broke a role alternation
// the list had.
export type PlanRefusal = "no-plan" | "prefix" | "over-target" | "no-target" | "alternation";

export function planRefusal(
  plan: CompactionPlan | null,
  messages: readonly PassMessage[],
  applied: ApplyResult | null,
  covers: boolean = plan !== null && keysPrefix(plan.keys, messages),
): PlanRefusal | null {
  if (plan === null) return "no-plan";
  if (!covers) return "prefix";
  if (plan.targetTokens === null) return "no-target";
  if (applied !== null && rolesAlternate(messages) && !applied.alternates) return "alternation";
  const keptTokens = applied === null ? plan.keptTokens : tokensOf(applied.keptChars);
  if (keptTokens > plan.targetTokens) return "over-target";
  return null;
}

// Whether the prompt cache is read as expired: no turn open, a main-thread
// turn has ended, and more than the cache's life plus the margin has passed
// since it ended. A session whose last turn is unknown is never read as
// expired, since a wrong reading here would journal a cut the operator's
// ruling protects against.
export function cacheExpired(nowMs: number, lastMainTurnEndedMs: number, turnOpen: boolean): boolean {
  if (turnOpen) return false;
  if (typeof lastMainTurnEndedMs !== "number" || !Number.isFinite(lastMainTurnEndedMs) || lastMainTurnEndedMs <= 0) return false;
  return nowMs - lastMainTurnEndedMs > (COMPACT_CACHE_LIFE_S + COMPACT_CACHE_MARGIN_S) * 1000;
}

// --- The pass: applying a plan ---

// The one line a cut result keeps: the tool, the head of its input, the
// size of what was there, and that it was dropped at compaction. The tool
// name and the head are text the model wrote, so each is folded to one line
// with its brackets turned, and the head is already cut at its bound.
export function cutLine(tool: string, inputHead: string, size: number): string {
  return `Result of ${bracketSafeText(oneLine(tool))} ${bracketSafeText(oneLine(inputHead)).slice(0, COMPACT_INPUT_HEAD_MAX)} (${Math.max(0, Math.floor(size))} characters) dropped at compaction.`;
}

// Whether the roles alternate, user and assistant in turn, over a list.
export function rolesAlternate(messages: readonly PassMessage[]): boolean {
  for (let i = 1; i < messages.length; i += 1) if (messages[i].role === messages[i - 1].role) return false;
  return true;
}

// Applies a plan to a message list, as a copy, and never to the list it was
// handed. A drop removes the tool_use block from its assistant message and
// the matching tool_result block from the user message answering it; a cut
// replaces the result's text with the one line above. A message the apply
// emptied, its blocks gone and its text empty, is removed, and its pair
// with it, the user message after an assistant and the assistant before a
// user, so roles still alternate where they did. The first message is
// always kept. A message untouched keeps its handle and so stays the
// engine's own; a touched one carries none, so the engine builds it. A
// result the plan names as a kept skill body takes keep whatever verdict the
// plan holds for it, and so does one the plan does not name and one whose
// call has no result in the list. Pure.
export function applyPlan(
  messages: readonly PassMessage[],
  plan: { verdicts: Readonly<Record<string, ToolVerdict>>; skillKept: readonly string[]; skillBodyChars?: Readonly<Record<string, number>> },
): ApplyResult {
  const bodyChars = plan.skillBodyChars ?? {};
  const kept = new Set(plan.skillKept);
  const out: PassMessage[] = messages.map((m) => ({
    ...m,
    toolUses: (m.toolUses ?? []).map((u) => ({ ...u })),
    toolResults: m.toolResults === undefined ? undefined : m.toolResults.map((r) => ({ ...r })),
  }));
  const touched = new Set<number>();
  const counts = { keep: 0, cut: 0, drop: 0 };
  let skillKept = 0;
  let skillSuperseded = 0;
  let droppedChars = 0;
  // Where each result sits, by id, so a drop or a cut finds it whatever
  // message holds it.
  const resultAt = new Map<string, number>();
  for (let i = 0; i < out.length; i += 1) for (const r of out[i].toolResults ?? []) if (!resultAt.has(r.tool_use_id)) resultAt.set(r.tool_use_id, i);
  for (let i = 0; i < out.length; i += 1) {
    const message = out[i];
    if (message.role !== "assistant" || message.toolUses === undefined || message.toolUses.length === 0) continue;
    const remaining: PassToolUse[] = [];
    for (const u of message.toolUses) {
      const id = u.tool_use_id;
      const verdict: ToolVerdict = kept.has(id) ? "keep" : (plan.verdicts[id] ?? "keep");
      if (kept.has(id) && u.tool === SKILL_TOOL) skillKept += 1;
      const at = resultAt.get(id);
      // A call with no result in the list is in flight or unanswered, so a
      // verdict on it changes nothing and counts as keep.
      if (verdict === "keep" || at === undefined) {
        remaining.push(u);
        counts.keep += 1;
        continue;
      }
      const holder = out[at];
      const result = (holder.toolResults ?? []).find((r) => r.tool_use_id === id);
      if (verdict === "drop") {
        if (u.tool === SKILL_TOOL) skillSuperseded += 1;
        counts.drop += 1;
        droppedChars += u.tool.length + inputHeadOf(u.input).length + (typeof u.text === "string" ? u.text.length : 0);
        if (result !== undefined) {
          droppedChars += result.text.length + (bodyChars[id] ?? 0);
          holder.toolResults = (holder.toolResults ?? []).filter((r) => r.tool_use_id !== id);
          touched.add(at);
        }
        touched.add(i);
        continue;
      }
      // cut
      remaining.push(u);
      counts.cut += 1;
      if (result !== undefined) {
        const line = cutLine(u.tool, inputHeadOf(u.input), result.text.length);
        droppedChars += Math.max(0, result.text.length - line.length);
        result.text = line;
        touched.add(at);
      }
    }
    message.toolUses = remaining;
  }
  // An emptied message goes with its pair, never the first message.
  const remove = new Set<number>();
  const emptied = (i: number): boolean => touched.has(i) && out[i].text === "" && (out[i].toolUses ?? []).length === 0 && (out[i].toolResults ?? []).length === 0;
  for (let i = 1; i < out.length; i += 1) {
    if (!emptied(i)) continue;
    remove.add(i);
    if (out[i].role === "assistant" && i + 1 < out.length && out[i + 1].role === "user") remove.add(i + 1);
    if (out[i].role === "user" && i - 1 >= 1 && out[i - 1].role === "assistant") remove.add(i - 1);
  }
  const result: PassMessage[] = [];
  let keptChars = 0;
  for (let i = 0; i < out.length; i += 1) {
    const message = out[i];
    if (remove.has(i)) {
      if (!emptied(i)) droppedChars += messageChars(message, bodyChars);
      continue;
    }
    if (touched.has(i)) delete message.handle;
    if (message.toolResults === undefined) delete message.toolResults;
    keptChars += messageChars(message, bodyChars);
    result.push(message);
  }
  return { messages: result, counts, keptCount: result.length, keptChars, droppedChars, skillKept, skillSuperseded, alternates: rolesAlternate(result) };
}
