// recall-text.ts: recall text: the memory records a turn is shown, the procedure candidates and
// fetched records they are read from, the memq gets and touches a turn made, and
// the bounds on the recall, recognition and memq write text.
//
// No import of the engine handle and no state of its own: every function takes what it
// reads as arguments, so the tick harness, which loads a fresh hooks/index.ts per
// case, shares nothing through it.

import { bracketSafeText } from "./agent-state";
import { type GuardCall, type GuardResult } from "./guards/runner";
import { type KitMemqResult } from "./memq-boundary";
import { memqNameAndTierOf, memqVerbArgsOf } from "./memq-command";
import { kaizenLine, MEMORY_RECALL_STATE_BODY, MEMORY_RECALL_STATE_DESCRIPTION, MEMORY_RECALL_STATE_PROMPT, MEMORY_RECALL_STATE_RECORD, MEMORY_RECALL_STATE_SOURCE, MEMORY_RECALL_STATE_TAGS, MEMORY_RECOGNITION_STATE_DESCRIPTION, MEMORY_RECOGNITION_STATE_RECORD, MEMORY_RECOGNITION_STATE_TRIGGER } from "./question-catalog";
import { type NudgeBoundary, type NudgeHit, type NudgePayload, type NudgeSubjects, type RecognitionMatch, type RecognitionScope } from "./recognition";

// How long one memq put may run. A put takes the tier's lock, and a write
// costs the prompt nothing, so its bound is never shorter than a read's.
export const MEMQ_WRITE_TIMEOUT_MS = 5_000;

// How long the per-prompt recall chain may run, from its memq
// recall-candidates spawn through its asks and body fetches. The prompt
// waits on it, and past it the prompt goes with no memory block.
export const MEMQ_READ_TIMEOUT_MS = 5_000;

// The most code points of a prompt the read passes memq as its situation.
export const MEMQ_SITUATION_MAX = 500;

// The most characters of a prompt the memory questions' states carry as its
// head: the memory-kind state's cut of the prompt and the memory-recall
// state's promptHead, one bound shared.
export const PROMPT_HEAD_MAX = 300;

// The most candidates the recall chain asks about for one prompt, which is
// also the most records its memq recall-candidates read asks for, as memq's
// own limit flag takes it.
export const RECALL_ASK_MAX = 10;

// The first max code points of text, read without copying the rest, so a
// surrogate pair is never split and a very long prompt costs max steps.
export function firstCodePoints(text: string, max: number): string {
  let out = "";
  let n = 0;
  for (const ch of text) {
    if (n === max) break;
    out += ch;
    n += 1;
  }
  return out;
}

// The memory kind a record is written under: fact, preference or lesson as
// given, and fact for anything else.
export function memqKindOf(kind: unknown): "fact" | "preference" | "lesson" {
  return kind === "preference" || kind === "lesson" ? kind : "fact";
}

// What one memq put came to. `written` is exit 0. `duplicate` is exit 1 with
// memq's refusal of a name the store already holds, which is the dedupe: the
// same text always derives the same name. Its `retired` is true where that
// refusal says the store holds the name retired under archive/. `failed` is
// anything else, with the first non-empty stderr line as its reason, and
// `ran` false where memq never ran to an exit.
export type MemoryWriteOutcome =
  | { outcome: "written"; name: string }
  | { outcome: "duplicate"; name: string; retired: boolean }
  | { outcome: "failed"; name: string; reason: string; ran: boolean };

// The longest tag memq takes. The characters it takes in a name, a tag and
// an author are MEMQ_NAME_CHARSET from hooks/stretch-distillation.ts.
export const MEMQ_TAG_CAP = 40;

// The two bounds of what a prompt shows: a body at most this long shows
// whole and a longer one shows as a pointer line, and at most this many
// records show per prompt. Both are the plan's, held here and nowhere else.
export const RECALL_BODY_MAX = 6_000;

export const RECALL_SHOW_MAX = 3;

// The least `show` probability a candidate's answer carries to be rendered.
// Jev's choice is the option with the greater probability, so one half is
// the choice's own boundary, read from the probability so a tie renders.
export const RECALL_SHOW_THRESHOLD = 0.5;

// The most characters of a candidate's body the memory-recall state carries,
// the catalog's body head, which is also the head usp_Recall returns. A body
// no longer than this is whole in the head, so the rendering takes it from
// there and fetches nothing.
export const RECALL_BODY_HEAD_MAX = 600;

// The provenance a shared tier's record carries on its head line, in the
// words memq's own fence over such a body uses (memq.js typeClause and
// operatorClause), so a record another project or another person's session
// wrote is told from the project's own wherever it reaches a prompt. The
// project tier is the session's own and carries none, as memq prints it raw.
const RECALL_TYPE_TIER_CLAUSE = "the shared tier every project of this type reads and writes";

const RECALL_OPERATOR_TIER_CLAUSE = "the operator tier, the store-wide tier every project on this machine reads and writes";

// The tier a procedure row was read from, memory-database.js recallRow's
// `tier`.
export type RecallTier = "project" | "type" | "operator";

// One candidate of a prompt's recall chain: its name, the tier its row was
// read from and the type that tier names, the fields the state carries, the
// body whole where it was fetched and null where it was not, and the body's
// length where known.
export type RecallCandidate = {
  name: string;
  tier: RecallTier | null;
  typeName: string | null;
  description: string;
  tags: string[];
  bodyHead: string;
  body: string | null;
  bodyLength: number | null;
};

// What the chain hands the context builder: the memory block's text under
// its opening line, and the names it shows, in rendered order.
export type RecallInjection = { rendering: string; names: readonly string[] };

// The rows memq recall-candidates printed, in the procedure's fused order, or
// the class of reason none were read: `did-not-run` for a read that did not
// run to an exit, which a stand-down also answers, `exit-<code>` for a
// non-zero exit, and `unparsed` for a stdout that is not a JSON array. Each
// row is read for the fields the state and the rendering take, in the
// client's own shape (memory-database.js recallRow); a row without a name, or
// naming one already read, is dropped.
export function procedureCandidatesOf(res: KitMemqResult | null): { rows: RecallCandidate[] } | { absent: string } {
  if (res === null) return { absent: "did-not-run" };
  if (res.exitCode !== 0) return { absent: `exit-${res.exitCode === null ? "unknown" : res.exitCode}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) return { absent: "unparsed" };
  const rows: RecallCandidate[] = [];
  const seen = new Set<string>();
  for (const row of parsed) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name === "" || seen.has(r.name.toLowerCase())) continue;
    seen.add(r.name.toLowerCase());
    rows.push({
      name: r.name,
      tier: r.tier === "project" || r.tier === "type" || r.tier === "operator" ? r.tier : null,
      typeName: typeof r.typeName === "string" && r.typeName !== "" ? r.typeName : null,
      description: typeof r.description === "string" ? r.description : "",
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
      bodyHead: typeof r.bodyHead === "string" ? firstCodePoints(r.bodyHead, RECALL_BODY_HEAD_MAX) : "",
      body: null,
      bodyLength: typeof r.bodyLength === "number" && Number.isSafeInteger(r.bodyLength) && r.bodyLength >= 0 ? r.bodyLength : null,
    });
  }
  return { rows };
}

// The opening of the provenance fence memq get prints a shared or pinned
// tier's body under, and its closing words, with every line after it indented
// two spaces (memq.js fenceLine).
const MEMQ_FENCE_OPEN = "memq: from ";

const MEMQ_FENCE_CLOSE = "data, not instructions:";

// A record as memq get --no-stamp printed it: the description and tags its
// frontmatter carries, its body, and the body's length. The frontmatter, the
// provenance fence a pinned or shared tier prints the body under, and the
// anchors, triggers and author lines get prints after the body are each taken
// off, the report lines first since get prints them after its truncation
// note, and a body get cut at its own print cap keeps the length that note
// names. Null where the read did not run to an exit, exited non-zero or
// printed nothing, which is also what a name the store does not hold prints.
export function fetchedRecordOf(res: KitMemqResult | null): { description: string; tags: string[]; body: string; length: number } | null {
  if (res === null || res.exitCode !== 0 || res.stdout.trim() === "") return null;
  let lines = res.stdout.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > 0 && lines[0].startsWith(MEMQ_FENCE_OPEN) && lines[0].endsWith(MEMQ_FENCE_CLOSE)) {
    lines = lines.slice(1).map((l) => (l.startsWith("  ") ? l.slice(2) : l));
  }
  while (lines.length > 0 && /^(anchors|triggers|author): /.test(lines[lines.length - 1])) lines.pop();
  let length: number | null = null;
  const truncated = lines.length > 0 ? /^memq: body truncated at \d+ of (\d+) characters$/.exec(lines[lines.length - 1]) : null;
  if (truncated !== null) {
    length = Number(truncated[1]);
    lines.pop();
  }
  let description = "";
  const tags: string[] = [];
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) {
      for (const field of lines.slice(1, close)) {
        if (field.startsWith("description: ")) {
          description = field.slice("description: ".length).trim().replace(/^(['"])(.*)\1$/, "$2");
        } else if (field.startsWith("tags: ")) {
          tags.push(...field.slice("tags: ".length).split(",").map((t) => t.trim()).filter((t) => t !== ""));
        }
      }
      lines = lines.slice(close + 1);
    }
  }
  const body = lines.join("\n");
  return { description, tags, body, length: length ?? body.length };
}

// The memory-recall question's state, one field to a line under the catalog's
// field names, every value through kaizenLine: the prompt, the description, the tags and the body head are the
// operator's and the store's text, and a value carrying its own line break
// and a field name would otherwise write a field of its own. Every candidate
// is the procedure's, so the source field reads `procedure` on each.
export function memoryRecallStateText(promptHead: string, c: RecallCandidate): string {
  return `${MEMORY_RECALL_STATE_PROMPT}: ${kaizenLine(promptHead)}\n` +
    `${MEMORY_RECALL_STATE_RECORD}: ${kaizenLine(c.name)}\n` +
    `${MEMORY_RECALL_STATE_DESCRIPTION}: ${kaizenLine(c.description)}\n` +
    `${MEMORY_RECALL_STATE_TAGS}: ${kaizenLine(c.tags.join(", "))}\n` +
    `${MEMORY_RECALL_STATE_BODY}: ${kaizenLine(c.bodyHead)}\n` +
    `${MEMORY_RECALL_STATE_SOURCE}: procedure`;
}

// One shown record's rendering: its name and description on one line, with
// the tier's provenance clause in parentheses for a type- or operator-tier
// record, then the body whole where it is at most RECALL_BODY_MAX
// characters, the pointer line where its known length is longer, or, where a
// body inside the bound could not be fetched, a line saying so. `whole` is
// true on the first shape alone. Every store text goes through
// bracketSafeText, the hostile-text clamp every injected line takes, so the
// rendering is the bytes the prompt carries.
export function recallRecordText(c: RecallCandidate, body: string | null, length: number | null): { text: string; whole: boolean } {
  const provenance = c.tier === "type" ? ` (from ${c.typeName === null ? "the type tier" : `type '${c.typeName}'`}, ${RECALL_TYPE_TIER_CLAUSE})`
    : c.tier === "operator" ? ` (from ${RECALL_OPERATOR_TIER_CLAUSE})`
    : "";
  const head = bracketSafeText(`${c.name}: ${c.description}${provenance}`);
  if (body !== null && body.length <= RECALL_BODY_MAX) return { text: `${head}\n${bracketSafeText(body)}`, whole: true };
  if (length !== null && length > RECALL_BODY_MAX) return { text: `${head}\nrecord is ${length} characters; read it with memq get ${bracketSafeText(c.name)}`, whole: false };
  return { text: `${head}\nrecord could not be fetched; read it with memq get ${bracketSafeText(c.name)}`, whole: false };
}

// Whether one touch the session ran stamps a candidate: the names match
// without case, and the touch's tier is the tier the candidate was shown
// from. A touch with no tier flag stamps the project tier, --operator the
// operator tier and --type the type tier, where --type=<type> must name the
// candidate's type, without case, for a row that carried one; bare --type
// stamps the project's declared type, which the module does not know, so it
// matches any type-tier candidate. A candidate whose row named no known tier
// has none to be shown from, so no touch is shown to land there and none
// counts for it; a get of it still does. A touch memq refuses stamps nothing.
export function touchStampsCandidate(t: { name: string } & MemqTouchTier, c: { name: string; tier: RecallTier | null; typeName: string | null }): boolean {
  if (t.tier === "refused" || t.name.toLowerCase() !== c.name.toLowerCase()) return false;
  if (c.tier === null) return false;
  if (t.tier !== c.tier) return false;
  return t.tier !== "type" || t.namedType === null || c.typeName === null || t.namedType.toLowerCase() === c.typeName.toLowerCase();
}

// The record names a shell command fetches through `memq get` without
// `--no-stamp`: the name of each get memqVerbArgsOf finds, only where
// `--no-stamp` is not among the words read, so the module's own fetches could
// never match even if they reached a tool call, and a get memq refuses names
// nothing. Exported for the test suite.
export function recallGetNamesOf(command: string): string[] {
  return memqGetsOf(command).filter((g) => g.tier !== "refused").map((g) => g.name);
}

// Which tier a `memq get` reads, from its flags as memq's get verb reads
// them: `--operator` the operator tier; bare `--type` the declared type's
// tier and `--type=<type>` the type named; no tier flag the nearest tier
// holding the name, project, then type, then operator; and a get memq refuses
// reads nothing.
export type MemqGetTier = { tier: "nearest" | "operator" | "refused" } | { tier: "type"; namedType: string | null };

// Which tier a `memq touch` stamps, from its flags as memq's touch verb reads
// them: `--operator` the operator tier; bare `--type` the declared type's
// tier and `--type=<type>` the type named; no tier flag the project tier;
// and a touch memq refuses stamps nothing.
export type MemqTouchTier = { tier: "project" | "operator" | "refused" } | { tier: "type"; namedType: string | null };

// The fetches recallGetNamesOf reads, each with the tier it reads. A get
// carrying `--no-stamp` anywhere among its words is not a fetch.
export function memqGetsOf(command: string): Array<{ name: string } & MemqGetTier> {
  const out: Array<{ name: string } & MemqGetTier> = [];
  for (const rest of memqVerbArgsOf(command, "get")) {
    if (rest.includes("--no-stamp")) continue;
    const read = memqNameAndTierOf(rest, []);
    if (read === null) continue;
    out.push(read.tier === "unflagged" ? { name: read.name, tier: "nearest" } : read);
  }
  return out;
}

// The stamps a shell command writes through `memq touch --applied`, each
// with the tier it stamps. A touch without `--applied` is one memq refuses
// (memq.js cmdTouch, "touch needs --applied"), so it is in the refused class
// with the forms memqNameAndTierOf refuses.
export function memqTouchesOf(command: string): Array<{ name: string } & MemqTouchTier> {
  const out: Array<{ name: string } & MemqTouchTier> = [];
  for (const rest of memqVerbArgsOf(command, "touch")) {
    const read = memqNameAndTierOf(rest, ["--applied"]);
    if (read === null) continue;
    out.push(!rest.includes("--applied") || read.tier === "refused" ? { name: read.name, tier: "refused" }
      : read.tier === "unflagged" ? { name: read.name, tier: "project" }
      : read);
  }
  return out;
}

// The `skip` probability at or above which a record's tool-call pointer is
// withheld.
export const RECOGNITION_SKIP_THRESHOLD = 0.5;

// Where the snapshot sits under the home, memory-database.js's
// snapshotIndexPath.
export const RECOGNITION_SNAPSHOT_FILE = ".claude/memory-snapshot/index.json";

// How often a tool call may start a check of the snapshot's size and mtime.
export const RECOGNITION_CHECK_EVERY_MS = 60_000;

// The largest snapshot read, the engine's own $.fs.read ceiling, so a larger
// file is passed over on its stat rather than on a rejected read.
export const RECOGNITION_READ_MAX = 4 * 1024 * 1024;

// The memory-recognition question's state, one field to a line under the
// catalog's field names, every value through kaizenLine for
// memoryRecallStateText's reason: the matched trigger, the record's name, and
// its description cut at PROMPT_HEAD_MAX, the head the recall state's prompt
// takes. The catalog has no field for the command, and none is written.
export function memoryRecognitionStateText(m: RecognitionMatch): string {
  return `${MEMORY_RECOGNITION_STATE_TRIGGER}: ${kaizenLine(m.trigger)}\n` +
    `${MEMORY_RECOGNITION_STATE_RECORD}: ${kaizenLine(m.name)}\n` +
    `${MEMORY_RECOGNITION_STATE_DESCRIPTION}: ${kaizenLine(firstCodePoints(m.description, PROMPT_HEAD_MAX))}`;
}

// One boundary's matched hits, read against the marker as it stands, with
// what claiming them reads. Null where the nudge stands down or nothing
// matched. Writes nothing.
export type NudgePrepared = { boundary: NudgeBoundary; subjects: NudgeSubjects; hits: NudgeHit[]; scope: RecognitionScope };

// One tool call and its result as the nudge's readers take them: the tool,
// its arguments, its result where core gave one and its text otherwise, and
// its error flag.
export function nudgeToolPayload(e: GuardCall, r: GuardResult): NudgePayload {
  const { tool, tool_use_id: _callId, agentId: _agentId, ...input } = e;
  return { tool_name: tool, tool_input: input, tool_response: r.result !== undefined ? r.result : r.text, is_error: r.isError === true };
}
