// follow-ups.ts: the follow-up queue, and the documentation check that is
// its one source.
//
// The queue carries what the module observed at a turn's end into the next
// prompt's context. It is one $.store value per session, under
// `followups:<sessionId>`, holding at most FOLLOW_UPS_MAX entries. An entry
// past the bound drops the oldest with a followup_dropped decision, and an
// entry whose source and subject the queue already holds replaces that
// entry in its place. A typed prompt and a delivered record list each entry
// not yet shown once, in hooks/context-assembly.ts's [FOLLOW-UP] block; the
// next turn.start stamps those entries with its turn id, and that turn's end
// writes each one's own `outcome`, true where a tool call's path argument or
// the reply names the subject, with a followup_outcome decision. That
// `outcome` is the entry's field and never a decision journal outcome kind.
//
// The documentation check reads the session's working directory at a turn's
// end and returns one finding per plan under docs/plans/ that reads complete
// and per scratch file under docs/, each read through the engine's $.fs
// under the bounds stated beside its scan below.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts (hooks/host.ts says why), so
// this file takes the store and the file calls it needs as small interfaces
// hooks/index.ts builds over `$`. Nothing here throws: a store or file call
// that rejects costs the read or the entry it served.

import { bracketSafeText, oneLine } from "./agent-state";
import { followUpsKey, type CommonsStore } from "./commons";

// The store key of one session's queue. It is spelled in hooks/commons.ts,
// whose stale-entry collection deletes a dead session's queue with its
// commons entry, and re-exported here for the queue's own readers.
export { followUpsKey };

// --- The queue ---

// How many entries one session's queue holds.
export const FOLLOW_UPS_MAX = 12;

// One follow-up. `id` is stable for its source and subject. `turnId` is the
// turn whose end enqueued it, `shownTurnId` the turn that opened with the
// prompt listing it, unset until one did, and `outcome` whether that turn
// acted on it, unset until that turn ended.
export type FollowUpEntry = {
  id: string;
  source: string;
  subject: string;
  text: string;
  createdAt: number;
  turnId: string;
  shownTurnId?: string;
  outcome?: boolean;
};

// What a source hands the queue: the entry before its id, times and turns.
export type FollowUpInput = { source: string; subject: string; text: string };

// hooks/index.ts's commonsStoreOf over `$`, of which the queue reads and
// writes one key.
export type FollowUpStore = Pick<CommonsStore, "get" | "set">;

// The persona's decision writer, for the queue's two decisions.
export type FollowUpDecide = (action: "followup_dropped" | "followup_outcome", detail: string) => void;

export function followUpId(source: string, subject: string): string {
  return `${source}:${subject}`;
}

// A decision detail carries file names a repository supplied, and the
// controller's decisions tail puts details in front of a model, so each is
// folded to one line, bracket-safe and cut.
const DECISION_DETAIL_MAX = 200;
function detailText(text: string): string {
  return bracketSafeText(oneLine(text)).slice(0, DECISION_DETAIL_MAX);
}

// The entries of a stored value, read by shape: an entry with a field of the
// wrong type is left out, and a list past the bound reads as its newest
// FOLLOW_UPS_MAX. Anything but an array is an empty queue.
export function followUpsOf(raw: unknown): FollowUpEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: FollowUpEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.source !== "string" || typeof r.subject !== "string" || typeof r.text !== "string") continue;
    if (typeof r.createdAt !== "number" || typeof r.turnId !== "string") continue;
    if (r.shownTurnId !== undefined && typeof r.shownTurnId !== "string") continue;
    if (r.outcome !== undefined && typeof r.outcome !== "boolean") continue;
    const entry: FollowUpEntry = { id: r.id, source: r.source, subject: r.subject, text: r.text, createdAt: r.createdAt, turnId: r.turnId };
    if (r.shownTurnId !== undefined) entry.shownTurnId = r.shownTurnId;
    if (r.outcome !== undefined) entry.outcome = r.outcome;
    entries.push(entry);
  }
  return entries.slice(-FOLLOW_UPS_MAX);
}

// The session's queue, or null where the store read rejected, which the
// caller reads as nothing to show, settle or add to.
export async function readFollowUps(store: FollowUpStore, sessionId: string): Promise<FollowUpEntry[] | null> {
  try {
    return followUpsOf(await store.get(followUpsKey(sessionId)));
  } catch {
    return null;
  }
}

// Writes the session's queue whole. Answers false where the store refused.
export async function writeFollowUps(store: FollowUpStore, sessionId: string, queue: readonly FollowUpEntry[]): Promise<boolean> {
  try {
    await store.set(followUpsKey(sessionId), queue);
    return true;
  } catch {
    return false;
  }
}

// The queue with `inputs` added, each as a fresh entry stamped `at` and
// `turnId`. An input whose source and subject an entry already carries
// replaces that entry where it stands. Past FOLLOW_UPS_MAX the oldest
// entries drop, with one followup_dropped decision naming how many and
// their ids.
export function enqueueFollowUps(
  queue: readonly FollowUpEntry[],
  inputs: readonly FollowUpInput[],
  at: number,
  turnId: string,
  decide: FollowUpDecide,
): FollowUpEntry[] {
  const next = [...queue];
  for (const input of inputs) {
    const id = followUpId(input.source, input.subject);
    const entry: FollowUpEntry = { id, source: input.source, subject: input.subject, text: input.text, createdAt: at, turnId };
    const place = next.findIndex((e) => e.id === id);
    if (place >= 0) next[place] = entry;
    else next.push(entry);
  }
  if (next.length > FOLLOW_UPS_MAX) {
    const dropped = next.splice(0, next.length - FOLLOW_UPS_MAX);
    decide("followup_dropped", detailText(`${dropped.length} past the bound of ${FOLLOW_UPS_MAX}: ${dropped.map((e) => e.id).join(", ")}`));
  }
  return next;
}

// The entries a prompt lists: those no turn has been stamped as showing,
// and that no earlier prompt waiting on its turn already listed, in queue
// order.
export function unshownFollowUps(queue: readonly FollowUpEntry[], offeredIds: readonly string[]): FollowUpEntry[] {
  return queue.filter((e) => e.shownTurnId === undefined && !offeredIds.includes(e.id));
}

// Stamps `turnId` on each named entry no turn has been stamped as showing.
// Answers whether any entry changed.
export function markFollowUpsShown(queue: FollowUpEntry[], ids: readonly string[], turnId: string): boolean {
  let changed = false;
  for (const entry of queue) {
    if (entry.shownTurnId === undefined && ids.includes(entry.id)) {
      entry.shownTurnId = turnId;
      changed = true;
    }
  }
  return changed;
}

// Separators read as "/" and case folded, so a path names the file it names
// whichever separator and case the model wrote it with.
function foldPath(text: string): string {
  return text.replace(/\\/g, "/").toLowerCase();
}

// A subject holding a "/" is a path; any other subject is plain text.
function isPathSubject(subject: string): boolean {
  return subject.includes("/") || subject.includes("\\");
}

// Whether one tool call's path argument names a path subject: the argument
// is the subject, or ends in "/" and the subject, so mydocs/plans/p1.md does
// not name docs/plans/p1.md. An empty or plain-text subject names no path.
export function followUpPathNames(subject: string, path: string): boolean {
  if (subject.length === 0 || !isPathSubject(subject)) return false;
  const folded = foldPath(subject);
  const arg = foldPath(path);
  return arg === folded || arg.endsWith("/" + folded);
}

// Whether a reply names a subject. A path subject is named under the path
// rule's boundary: the text before it is the reply's start, a "/" or a
// character no path name carries, and the text after it is the reply's end
// or such a character, a sentence's closing period included, so neither
// mydocs/plans/p1.md nor docs/plans/p1.md.bak names docs/plans/p1.md. A
// plain-text subject is read anywhere in the reply. An empty subject is
// never named.
export function followUpReplyNames(subject: string, reply: string): boolean {
  if (subject.length === 0) return false;
  if (!isPathSubject(subject)) return reply.toLowerCase().includes(subject.toLowerCase());
  const folded = foldPath(subject);
  const text = foldPath(reply);
  for (let at = text.indexOf(folded); at >= 0; at = text.indexOf(folded, at + 1)) {
    const before = at === 0 ? "" : text[at - 1];
    const after = text.slice(at + folded.length, at + folded.length + 2);
    const openOk = before === "" || before === "/" || !/[\w.-]/.test(before);
    const closeOk = after === "" || !(/^[\w/-]/.test(after) || /^\.\w/.test(after));
    if (openOk && closeOk) return true;
  }
  return false;
}

// Whether the turn acted on a subject: one of its tool calls' path
// arguments names it, or its reply does.
export function followUpActed(subject: string, toolPaths: readonly string[], reply: string): boolean {
  return toolPaths.some((p) => followUpPathNames(subject, p)) || followUpReplyNames(subject, reply);
}

// At the end of turn `turnId`: each entry that turn showed and that holds no
// outcome yet takes one, true where its id is among `hitIds`, the entries a
// tool call's path argument named during the turn, or the reply names its
// subject, with a followup_outcome decision naming its id, its source and
// the value. Answers whether any entry changed.
export function settleFollowUps(
  queue: FollowUpEntry[],
  turnId: string,
  hitIds: readonly string[],
  reply: string,
  decide: FollowUpDecide,
): boolean {
  let changed = false;
  for (const entry of queue) {
    if (entry.shownTurnId !== turnId || entry.outcome !== undefined) continue;
    entry.outcome = hitIds.includes(entry.id) || followUpReplyNames(entry.subject, reply);
    changed = true;
    decide("followup_outcome", detailText(`${entry.id} source ${entry.source}: ${entry.outcome}`));
  }
  return changed;
}

// --- The documentation check ---

export const DOCS_CHECK_SOURCE = "docs-check";

// One entry of a listing as the engine's $.fs.list gives it: the entry's own
// kind, a link being `other`, and a file's size in bytes.
export type DocsCheckEntry = { name: string; kind: string; size: number };

// What the check reads through: hooks/index.ts builds it over $.fs.list and
// $.fs.read. Both reject on a path that is missing or of the wrong kind.
export type DocsCheckFs = {
  list(path: string): Promise<readonly DocsCheckEntry[]>;
  read(path: string): Promise<string>;
};

// How many plan-doc names the plans scan keeps. A project carries a few dozen
// plan docs, so the cap sits far above any real shape and binds only where
// something arranged for it to; what the listing examines is bounded
// separately, by DIR_SCAN_MAX_ENTRIES.
const MAX_PLAN_FILES = 50;

// How many entries one directory listing may examine. A directory nothing
// here controls can hold any number of them, and a walk that reads every one
// is unbounded work at every turn end. The figure sits far above any real
// shape, so it binds only where something arranged for it to.
const DIR_SCAN_MAX_ENTRIES = 4096;

// How much of a plan doc any header question here reads. A plan's header
// rows sit at the top by the machine contract the curating-docs skill
// freezes, so a fixed head answers every one of them.
const PLAN_HEAD_MAX_BYTES = 2048;

// The ceiling on one file the check reads, on its listed size. $.fs.read takes
// the whole file and has no length option, so the head window is cut only
// after the whole file is read. A plan doc or a report is tens of KB, so an honest
// file never approaches the ceiling. It sits below the engine's own 4 MiB
// read ceiling, so a file the engine would refuse is passed over here first.
const DOCS_CHECK_FILE_READ_CEILING_BYTES = 1024 * 1024;

// The budget on what one docsCheckFindings call reads, across every file both
// scans open. The ceiling bounds one file and nothing bounds their product, so
// without this the worst case at every main turn end is the 50 plan reads and
// the scratch walk's header reads each at the ceiling. A file is read only
// where its listed size fits both the ceiling and the budget still left. Each
// read is charged the larger of its listed size and the UTF-8 bytes it
// returned, since a file can grow between the listing and the read. Once the
// budget is spent no further file is read. So the worst case per turn end is
// this 4 MiB plus one read's overshoot, and the engine's own 4 MiB read
// ceiling bounds that one read. An honest docs/ tree reads well under it.
const DOCS_CHECK_READ_BUDGET_BYTES = 4 * 1024 * 1024;

// The read budget one docsCheckFindings call shares across both scans: the
// bytes left.
type DocsCheckBudget = { left: number };

// Whether a file listed at `size` bytes may still be read under `budget`. A
// size that is not a finite, non-negative number is refused, since it bounds
// nothing.
function withinReadBudget(budget: DocsCheckBudget, size: number): boolean {
  if (!(Number.isFinite(size) && size >= 0)) return false;
  return budget.left > 0 && size <= DOCS_CHECK_FILE_READ_CEILING_BYTES && size <= budget.left;
}

// The scratch walk's bounds: how deep below docs/ it reads, how many entries
// it examines in all, and how many hits it reports.
const SCRATCH_WALK_MAX_DEPTH = 6;
const SCRATCH_WALK_MAX_ENTRIES = 2000;
const SCRATCH_HITS_MAX = 20;

// A path's directory segment naming review or report scratch, and a file name
// naming a review or report.
const SCRATCH_DIR = /(^|[\\/])(reviews|_impl_reports)([\\/]|$)/i;
const SCRATCH_NAME = /(_adversarial|_blind|_security|_qa|_rev[_-])/i;
// A curated plan spec is never scratch, even when its project or topic name
// embeds a SCRATCH_NAME word (e.g. neo_security-packet_spec_v1.md). Recognize
// it by the spec naming contract (a fast, zero-I/O path for the common case)
// or, failing that, the plan header contract, and veto only the name-based
// match: a file physically inside a reviews/ dir is still caught by
// SCRATCH_DIR.
const SPEC_NAME = /_spec_v\d+\.md$/i;

// A path from a repository, kept to printable ASCII and cut, since it reaches
// a model's context as a subject and every character of it is the
// repository's choice.
function safeRepoPath(text: string, max: number): string {
  return text.replace(/[^\x20-\x7E]/g, "").slice(0, max);
}

// The loose reading of a plan doc's Status header: 'complete', 'in progress',
// 'ready', or 'unknown'. A copy of classifyPlanStatus in the kit's
// hooks/kit-plan-lib.js, its vocabulary and its regexes unchanged: the engine
// loads this module apart from the kit's scripts, so it cannot import that
// one, and a value the kit's classifier learns must be learned here too.
// Deliberately looser than the frozen machine contract the kit's
// planReadsTerminal answers to, and the two are separate because they decide
// different things. This one decides whether the docs check nags, where a
// header carrying trailing text after Complete ("Complete (archived)") is a
// plan whose author called it finished, and nagging a finished plan over the
// parenthetical is the more expensive error. The strict reading decides
// whether a plan may be counted as finished on the filesystem's evidence
// alone, with no author in the loop, so it takes the strict contract.
//
// The consequence of the two rules meeting on one plan is worth naming,
// because it is a state an operator will see: a plan whose header reads
// 'Status: Complete (archived)' is finished to this reading and unfinished to
// the strict one.
export function classifyPlanStatus(head: unknown): "complete" | "in progress" | "ready" | "unknown" {
  // A non-string head has no header to classify, the same guard the strict
  // twin takes. Every caller reads through planHeadOf and checks for text
  // first, so this is the shape of the contract rather than a live path.
  if (typeof head !== "string") return "unknown";
  // Classify from the Status header only: anchored to a line start (m flag)
  // so body prose cannot match, and the value must sit on the same line as
  // the header ([^\S\r\n]* is horizontal whitespace only, never a newline),
  // so a bare "Status:" line above a line beginning "Complete" or "in
  // progress" does not misclassify the plan. A leading UTF-8 BOM (PowerShell
  // Set-Content writes one) is stripped by the reader so the anchor sees the
  // header. The Status header sits on its own line near the top by convention.
  //
  // Ready is the value of a plan that is authored and deliberately parked
  // before any run starts. It is a value of its own rather than an
  // unrecognized one so a reporting surface can list such a plan as parked
  // instead of not listing it at all, which is what hides finished, ready
  // work from every recovery surface. It ranks below the two started
  // readings: a doc carrying Ready alongside In Progress or Complete is one
  // somebody began, and reporting a run in flight as parked is the more
  // expensive error.
  //
  // Ready is the one leg that does not take its siblings' bare prefix match.
  // It must be the whole value, optionally followed by a parenthetical
  // ("Ready (parked pending the design round)"), because unlike Complete and
  // In Progress this word has ordinary English continuations that reverse
  // what it claims: "Ready for review", "Ready to merge" and "Ready to
  // archive" all name work somebody already did, and classifying them as
  // parked would have every reporting surface assert of them that the plan
  // is written and not started. Those fall through to 'unknown', the same
  // answer any other unrecognized value gets.
  const inProgress = /^status:[^\S\r\n]*in[^\S\r\n]*progress/im.test(head);
  const complete = /^status:[^\S\r\n]*complete/im.test(head) && !inProgress;
  const ready = /^status:[^\S\r\n]*ready[^\S\r\n]*(?:\([^)\r\n]*\)[^\S\r\n]*)?\r?$/im.test(head);
  if (complete) return "complete";
  if (inProgress) return "in progress";
  if (ready) return "ready";
  return "unknown";
}

// The head of a file a listing reported as a regular file of `size` bytes:
// its first PLAN_HEAD_MAX_BYTES of UTF-8, with a leading BOM stripped, or
// null where withinReadBudget refuses the read or the read rejected. A read
// that returns text spends from `budget` the larger of its listed size and
// the UTF-8 bytes it returned, so a file that grew past its listing is charged
// what was read. One read is bounded by the engine's 4 MiB read ceiling, so a
// read overshoots the budget by at most that. Only an entry the listing calls
// a file reaches here, so a FIFO, a device, a directory or a link is never
// opened. $.fs.read takes the whole file, so the window is cut from the text
// it returns.
async function planHeadOf(fs: DocsCheckFs, path: string, size: number, budget: DocsCheckBudget): Promise<string | null> {
  if (!withinReadBudget(budget, size)) return null;
  let text: unknown;
  try {
    text = await fs.read(path);
  } catch {
    return null;
  }
  if (typeof text !== "string") return null;
  const bytes = new TextEncoder().encode(text);
  budget.left -= Math.max(size, bytes.length);
  let head = new TextDecoder().decode(bytes.subarray(0, PLAN_HEAD_MAX_BYTES));
  if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1);
  return head;
}

// The entries of one listing, or null where it rejected or answered with
// something that is not a list. An entry not shaped as a listing's is left
// out.
async function listingOf(fs: DocsCheckFs, path: string): Promise<DocsCheckEntry[] | null> {
  let listed: unknown;
  try {
    listed = await fs.list(path);
  } catch {
    return null;
  }
  if (!Array.isArray(listed)) return null;
  return listed.filter((e): e is DocsCheckEntry =>
    e !== null && typeof e === "object" && typeof e.name === "string" && typeof e.kind === "string" && typeof e.size === "number");
}

// Does a docs/ file carry the plan-spec header contract: a Status: header and
// a Commit Model: header near the top? A curated plan doc has both; a leaked
// review or scratch report has neither. This is the definitive "curated plan,
// not scratch" signal, used to exempt a spec whose project or topic name
// embeds a word the SCRATCH_NAME set matches.
//
// It asks whether the rows are present, never what they say, which is why it
// spells its own presence test rather than going through classifyPlanStatus:
// any Status value at all marks the file as a plan here, including one no
// classifier has a name for, so a curated doc is never read as scratch on the
// strength of a header value nothing recognizes yet.
async function hasPlanHeaderContract(fs: DocsCheckFs, path: string, size: number, budget: DocsCheckBudget): Promise<boolean> {
  const head = await planHeadOf(fs, path, size, budget);
  if (head === null) return false;
  return /^status:[^\S\r\n]*\S/im.test(head) && /^commit[^\S\r\n]+model:[^\S\r\n]*\S/im.test(head);
}

// Plans marked complete still living directly under docs/plans/: each `.md`
// file but the index README whose head classifyPlanStatus reads as complete.
// The listing examines at most DIR_SCAN_MAX_ENTRIES entries and keeps at most
// MAX_PLAN_FILES names. An entry that is not a regular file, or whose head
// cannot be read or does not fit the read budget, is passed over.
async function completedPlans(fs: DocsCheckFs, docsDir: string, budget: DocsCheckBudget): Promise<string[]> {
  const plansDir = `${docsDir}/plans`;
  const listed = await listingOf(fs, plansDir);
  if (listed === null) return [];
  const kept: DocsCheckEntry[] = [];
  let seen = 0;
  for (const entry of listed) {
    seen += 1;
    if (seen > DIR_SCAN_MAX_ENTRIES) break;
    const lower = entry.name.toLowerCase();
    // The index README documents the phrase "Status: Complete"; it is not a
    // plan. Only a regular file counts toward the cap, so directories or
    // links named *.md cannot use it up.
    if (entry.kind !== "file" || !lower.endsWith(".md") || lower === "readme.md") continue;
    if (kept.length >= MAX_PLAN_FILES) break;
    kept.push(entry);
  }
  const subjects: string[] = [];
  for (const entry of kept) {
    const head = await planHeadOf(fs, `${plansDir}/${entry.name}`, entry.size, budget);
    if (head === null) continue;
    if (classifyPlanStatus(head) === "complete") subjects.push(`docs/plans/${safeRepoPath(entry.name, 120)}`);
  }
  return subjects;
}

// Scratch that does not belong in the curated docs/ tree: each file whose
// path below docs/ has a SCRATCH_DIR segment, or whose name SCRATCH_NAME
// matches and which is neither SPEC_NAME-named nor carrying the plan header
// contract. A bounded walk: SCRATCH_WALK_MAX_DEPTH levels below docs/,
// SCRATCH_WALK_MAX_ENTRIES entries examined in all, and SCRATCH_HITS_MAX
// hits. A directory that will not list is passed over. A name-matched file
// whose header read does not fit the read budget is passed over too, since
// its header is never seen. The patterns are conservative, so a legitimate
// curated doc (docs/security-model.md is not "_security") is not flagged.
async function docsScratch(fs: DocsCheckFs, docsDir: string, top: readonly DocsCheckEntry[], readBudget: DocsCheckBudget): Promise<string[]> {
  const hits: string[] = [];
  let budget = SCRATCH_WALK_MAX_ENTRIES;
  async function walk(dir: string, rel: string, depth: number, entries: readonly DocsCheckEntry[] | null): Promise<void> {
    if (depth > SCRATCH_WALK_MAX_DEPTH || budget <= 0 || hits.length >= SCRATCH_HITS_MAX) return;
    const listed = entries ?? await listingOf(fs, dir);
    if (listed === null) return;
    for (const entry of listed) {
      if (budget-- <= 0 || hits.length >= SCRATCH_HITS_MAX) return;
      const full = `${dir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.kind === "dir") {
        await walk(full, childRel, depth + 1, null);
      } else if (entry.kind === "file" && (SCRATCH_DIR.test(childRel)
        || (SCRATCH_NAME.test(entry.name) && !SPEC_NAME.test(entry.name) && withinReadBudget(readBudget, entry.size)
          && !(await hasPlanHeaderContract(fs, full, entry.size, readBudget))))) {
        hits.push(safeRepoPath(`docs${childRel}`, 160));
      }
    }
  }
  await walk(docsDir, "", 0, top);
  return hits;
}

// The two follow-up texts. Each names its subject and what to do, on one
// line.
function completedPlanText(subject: string): string {
  return `${subject} reads Status: Complete and still sits in docs/plans/. Archive it with the curating-docs skill.`;
}
function scratchText(subject: string): string {
  return `${subject} is scratch inside the curated docs/ tree. Move it to .kit/ or remove it before commit.`;
}

// The documentation check over the working directory `cwd`: nothing where
// `cwd` holds no docs/ that lists, and otherwise one docs-check finding per
// completed plan, then one per scratch file, each with the file's path below
// `cwd` as its subject. Both scans share one read budget of
// DOCS_CHECK_READ_BUDGET_BYTES. Never rejects.
export async function docsCheckFindings(fs: DocsCheckFs, cwd: string): Promise<FollowUpInput[]> {
  try {
    const docsDir = `${cwd.replace(/[\\/]+$/, "")}/docs`;
    const top = await listingOf(fs, docsDir);
    if (top === null) return [];
    const findings: FollowUpInput[] = [];
    const budget: DocsCheckBudget = { left: DOCS_CHECK_READ_BUDGET_BYTES };
    for (const subject of await completedPlans(fs, docsDir, budget)) {
      findings.push({ source: DOCS_CHECK_SOURCE, subject, text: completedPlanText(subject) });
    }
    for (const subject of await docsScratch(fs, docsDir, top, budget)) {
      findings.push({ source: DOCS_CHECK_SOURCE, subject, text: scratchText(subject) });
    }
    return findings;
  } catch {
    return [];
  }
}
