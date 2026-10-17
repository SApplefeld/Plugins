// recall.ts: the memory reads a typed prompt and a main-loop tool call make.
// It holds the recall chain, which reads usp_Recall's candidates at a typed
// prompt, asks memory-recall of each and renders the records Jev said show,
// with the recall_acted outcome the next prompt writes; and the
// memory-recognition question, which loads the snapshot's index of `cmd:`
// triggers under the session's scope, asks memory-recognition of the records
// a command matched, and writes each one's nudge_acted outcome.
// hooks/index.ts holds the wiring: the deps each call takes, the session
// object these functions read and write, the wait on the snapshot check in
// flight, and the memory-recognition nudge, which reads the index built here.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts, so each function here takes
// a RecallDeps that hooks/index.ts builds at each call. The session crosses
// as the object itself, so each field is read at the moment the code reads
// it. The module holds no state of its own, since the tick harness evaluates
// it once per process while it loads a fresh hooks/index.ts per case.

import { writeRendering, type JournalWrite, type OutcomeKind } from "./decision-journal";
import { HOLD_HEADROOM_MS } from "./decision-seam";
import type { PluginHost } from "./host";
import type { HookBudget, LiveAskResult } from "./jev-live";
import { MEMQ_TIMEOUT_SLACK_MS, type KitMemqOptions, type KitMemqResult } from "./memq-boundary";
import { MEMORY_RECALL, MEMORY_RECALL_OPTIONS, MEMORY_RECOGNITION, MEMORY_RECOGNITION_OPTIONS } from "./question-catalog";
import { fetchedRecordOf, firstCodePoints, memoryRecallStateText, memoryRecognitionStateText, MEMQ_READ_TIMEOUT_MS, MEMQ_SITUATION_MAX, procedureCandidatesOf, PROMPT_HEAD_MAX, RECALL_ASK_MAX, RECALL_BODY_HEAD_MAX, RECALL_BODY_MAX, RECALL_SHOW_MAX, RECALL_SHOW_THRESHOLD, recallRecordText, RECOGNITION_CHECK_EVERY_MS, RECOGNITION_READ_MAX, RECOGNITION_SKIP_THRESHOLD, RECOGNITION_SNAPSHOT_FILE, touchStampsCandidate, type MemqGetTier, type RecallCandidate, type RecallInjection } from "./recall-text";
import { nudgeIndexOf, recognitionIndexOf, recognitionKeyOf, recognitionMatches, recognitionScopeOf, RECOGNITION_ACT_WINDOW, RECOGNITION_SCOPE_RETRY_MS, RECOGNITION_SCOPE_SCRIPT, type RecognitionScope, type RecognitionTier } from "./recognition";
import type { SessionState } from "./session-state";
import { MEMQ_NAME_CHARSET, noteStretchShown } from "./stretch-distillation";

// The session fields the recall chain and the recognition question read and
// write, which the session object in hooks/index.ts satisfies.
export type RecallSession = Pick<SessionState, "persona" | "mySessionId" | "state" | "memqStandDownUntil" | "recallPromptSeq" | "recallPending" | "recallGetNames" | "recallAppliedNames" | "recallTouches" | "recallChainBusy" | "recallShownNames" | "recognition" | "recognitionPending" | "recognitionAsked" | "recognitionAsking" | "recognitionSkipped">;

// What hooks/index.ts hands the recall layer: the session; the host; the memq
// run and the kit's node run; the file stat the snapshot check reads; liveAsk
// and shadowOutcome, the ask layer's wrappers there; and the journal write
// note.
export interface RecallDeps {
  session: RecallSession;
  host: PluginHost;
  kitMemq: (argv: string[], opts: KitMemqOptions) => Promise<KitMemqResult | null>;
  kitNodeRun: (argvOf: (kitRoot: string) => string[], timeoutMs: number) => Promise<{ ran: KitMemqResult } | { cause: "start" | "timeout"; reason: string }>;
  statFile: (path: string) => Promise<{ kind?: unknown; size?: unknown; mtimeMs?: unknown } | null>;
  liveAsk: (
    host: PluginHost,
    event: string,
    budget: HookBudget,
    site: string,
    questionSetId: string,
    optionIds: readonly string[],
    state: string,
    jevMode: string,
    jevLive: readonly string[],
    onStamp?: (stampId: string | null) => void,
  ) => Promise<LiveAskResult | null>;
  shadowOutcome: (host: PluginHost, callStampId: string, kind: OutcomeKind, value: string) => void;
  noteJournalWrite: (write: JournalWrite, site: string) => void;
}

const MEMQ_RECALL_LIMIT = String(RECALL_ASK_MAX);

// --- The recall chain: the candidates, the asks, the rendering and the outcome ---
//
// At a typed prompt the chain reads usp_Recall's candidates through memq
// recall-candidates, asks memory-recall of each, live, renders the records
// Jev said show into the prompt's memory block and the journal's rendering
// line, and at the session's next typed prompt writes each candidate's
// recall_acted outcome. The context builder awaits the chain for its memory
// block, and the whole chain, read, asks and body fetches, runs inside
// MEMQ_READ_TIMEOUT_MS from its spawn: past it the prompt carries no memory
// block. No list reaches the prompt unjudged.

// The least of the window a body fetch is started with. Under it the fetch
// would read as a timeout before memq could answer, so the record renders as
// unfetched instead and no memq is spawned.
const RECALL_FETCH_FLOOR_MS = MEMQ_TIMEOUT_SLACK_MS;

// The recall chain for one typed prompt, the context builder's memory
// source. It resolves to the memory block's rendering and the names it
// shows, or to null where the prompt gets no memory block, and it writes one
// rendering line either way, a skip naming why where it is null. `seq` is
// the prompt's number in this session, and `budget` the prompt hook's own.
//
// Nothing is injected without Jev's word. `mode` off, which shadowAsk sends
// nothing under, spawns nothing and journals a `stand-down` skip. Inside a
// read stand-down window, which a read arms for the prompts after its own, the
// chain spawns nothing and journals `stand-down` too. One
// chain runs per session at a time: a prompt arriving while its
// predecessor's chain is still collecting journals `chain-busy` naming that
// prompt, and a chain whose next prompt arrived while its one collecting
// spawn ran journals `overtaken` naming that prompt and asks nothing, since
// no outcome could ever settle its rows.
//
// The chain makes one spawn to collect the candidates, memq recall-candidates
// over the situation with no tag, so the pool is the project's rows with the
// type and operator tiers, in the procedure's fused order and at most
// RECALL_ASK_MAX in all. Each candidate is then asked once through liveAsk,
// with memory-recall named live at this one site, and the asks fire together.
// The candidates are registered for their outcome as soon as the rows are
// known, ahead of the asks settling, so a next prompt inside the Jev bound
// still finds them; a candidate the session has shown before is asked and
// registered like any other. Where no ask came back answered, Jev did not
// answer this prompt, and the chain journals `stand-down` and injects
// nothing. The rendering takes, in candidate order, the first RECALL_SHOW_MAX
// candidates whose answer carries a `show` probability of at least
// RECALL_SHOW_THRESHOLD and whose name the session's recallShownNames does
// not hold.
// A body no longer than RECALL_BODY_HEAD_MAX is whole in the row's head and
// renders from it; one longer than RECALL_BODY_MAX shows as its pointer
// whatever the body says; the rest are fetched together through memq get
// --no-stamp, each under what is left of the window, and none is started
// with under RECALL_FETCH_FLOOR_MS left. Every fetch carries --no-stamp, so
// none writes a pointer outcome, and none can count as the session opening
// the record. The names rendered join the session's recallShownNames, so the
// session never sees one twice.
//
// The whole chain runs inside MEMQ_READ_TIMEOUT_MS from the spawn. The asks
// see the window's remainder as their budget, raised by HOLD_HEADROOM_MS so
// holdFor's headroom leaves them the remainder itself, and the hook's own
// remaining budget binds them as it binds every hold; a hook with no share
// left before the asks journals `budget` without asking. A chain past the
// window at any of its gates journals a `budget` skip and injects nothing,
// and so does a collecting spawn that failed with under MEMQ_TIMEOUT_SLACK_MS
// of the window left, which is its timeout read either side of the bound.
// Every rendering write rides a detached chain, so the prompt is not held
// for it; the one decision a failed write earns is noteJournalWrite's.
export async function recallInjection(deps: RecallDeps, promptText: string, mode: string, seq: number, budget: HookBudget): Promise<RecallInjection | null> {
  const host = deps.host;
  const persona = deps.session.persona;
  const session = deps.session.mySessionId;
  const promptHead = firstCodePoints(promptText, PROMPT_HEAD_MAX);
  const skip = (reason: string, skippedFor: number | null): null => {
    void writeRendering(host, {
      persona, session, promptSeq: seq, promptHead, procedure: null, procedureAbsent: null, namedFailed: null, shown: [], calls: {}, rendering: "",
      skipped: reason, skippedFor,
    })
      .then((write) => deps.noteJournalWrite(write, MEMORY_RECALL))
      .catch(() => { /* the journal never rejects; a host that broke that loses one line */ });
    return null;
  };
  if (mode !== "shadow" || deps.session.memqStandDownUntil > Date.now()) return skip("stand-down", null);
  if (deps.session.recallChainBusy !== null) return skip("chain-busy", deps.session.recallChainBusy.seq);
  deps.session.recallChainBusy = { seq };
  try {
    const deadline = Date.now() + MEMQ_READ_TIMEOUT_MS;
    const leftMs = (): number => deadline - Date.now();
    // The hook's own figure, where its `next` carries one; a reader that
    // throws or answers no number leaves the window's own bound.
    const hookLeftMs = (): number => {
      try {
        const ms = budget.remainingMs();
        return typeof ms === "number" && Number.isFinite(ms) ? ms : Infinity;
      } catch {
        return Infinity;
      }
    };
    const chainBudget: HookBudget = { get live() { return budget.live; }, remainingMs: () => Math.min(hookLeftMs(), leftMs() + HOLD_HEADROOM_MS) };
    const recall = await deps.kitMemq([
      "recall-candidates",
      "--situation", firstCodePoints(promptText, MEMQ_SITUATION_MAX),
      "--limit", MEMQ_RECALL_LIMIT,
    ], { timeoutMs: MEMQ_READ_TIMEOUT_MS });
    if (seq !== deps.session.recallPromptSeq) return skip("overtaken", deps.session.recallPromptSeq);
    if (leftMs() <= 0 || (recall === null && leftMs() < MEMQ_TIMEOUT_SLACK_MS)) return skip("budget", null);
    const procedure = procedureCandidatesOf(recall);
    const asked = "rows" in procedure ? procedure.rows.slice(0, RECALL_ASK_MAX) : [];
    if (asked.length > 0 && chainBudget.remainingMs() - HOLD_HEADROOM_MS <= 0) return skip("budget", null);
    // liveAsk hands the stamp id over before its first await, so every ask
    // has fired and every stamp is held before the registration below, ahead
    // of any answer.
    const asks = asked.map((c) => {
      const held: { stampId: string | null } = { stampId: null };
      const done = deps.liveAsk(host, "prompt.submit", chainBudget, MEMORY_RECALL, MEMORY_RECALL, MEMORY_RECALL_OPTIONS, memoryRecallStateText(promptHead, c), mode, [MEMORY_RECALL], (id) => { held.stampId = id; });
      return { c, stampId: held.stampId, done };
    });
    const registered = asks.filter((a): a is { c: RecallCandidate; stampId: string; done: Promise<LiveAskResult | null> } => a.stampId !== null);
    deps.session.recallPending = { seq, candidates: registered.map((a) => ({ name: a.c.name, tier: a.c.tier, typeName: a.c.typeName, stampId: a.stampId })) };
    const results = await Promise.all(asks.map((a) => a.done));
    if (leftMs() <= 0) return skip("budget", null);
    if (asked.length > 0 && results.every((r) => r === null || !("answer" in r))) return skip("stand-down", null);
    const picked: RecallCandidate[] = [];
    for (let i = 0; i < asked.length && picked.length < RECALL_SHOW_MAX; i += 1) {
      const result = results[i];
      if (result === null || !("answer" in result)) continue;
      const show = result.answer.probabilities.show;
      if (!(typeof show === "number" && show >= RECALL_SHOW_THRESHOLD)) continue;
      if (deps.session.recallShownNames.has(asked[i].name.toLowerCase())) continue;
      picked.push(asked[i]);
    }
    // A name off memq's record-name charset, or opening with a dash memq
    // would read as a flag, is not fetched and renders as unfetched.
    const fetchable = (c: RecallCandidate): boolean => MEMQ_NAME_CHARSET.test(c.name) && !c.name.startsWith("-");
    const fetchBoundMs = leftMs();
    const shown = await Promise.all(picked.map(async (c): Promise<{ c: RecallCandidate; body: string | null; length: number | null }> => {
      if (c.bodyLength !== null && c.bodyLength <= RECALL_BODY_HEAD_MAX) return { c, body: c.bodyHead, length: c.bodyLength };
      if (c.bodyLength !== null && c.bodyLength > RECALL_BODY_MAX) return { c, body: null, length: c.bodyLength };
      if (fetchBoundMs < RECALL_FETCH_FLOOR_MS || !fetchable(c)) return { c, body: null, length: c.bodyLength };
      const fetched = fetchedRecordOf(await deps.kitMemq(["get", c.name, "--no-stamp"], { timeoutMs: fetchBoundMs }));
      return fetched === null ? { c, body: null, length: c.bodyLength } : { c, body: fetched.body, length: fetched.length };
    }));
    if (leftMs() <= 0) return skip("budget", null);
    const rendered = shown.map((s) => ({ name: s.c.name, ...recallRecordText(s.c, s.body, s.length) }));
    const rendering = rendered.map((r) => r.text).join("\n\n");
    const calls: Record<string, string> = Object.create(null);
    for (const a of registered) calls[a.c.name] = a.stampId;
    for (const r of rendered) deps.session.recallShownNames.add(r.name.toLowerCase());
    // The stretch fork's shown set, with each record's tier.
    for (const s of shown) deps.session.state.stretchShown = noteStretchShown(deps.session.state.stretchShown, { name: s.c.name, tier: s.c.tier, typeName: s.c.typeName }, Date.now());
    // The rendering line rides a detached chain, as the asks' lines do, so the
    // prompt is not held for it.
    void writeRendering(host, {
      persona,
      session,
      promptSeq: seq,
      promptHead,
      procedure: "rows" in procedure ? procedure.rows.map((r) => r.name) : null,
      procedureAbsent: "absent" in procedure ? procedure.absent : null,
      namedFailed: null,
      shown: rendered.map((r) => ({ name: r.name, characters: r.text.length, whole: r.whole })),
      calls,
      rendering,
      skipped: null,
      skippedFor: null,
    })
      .then((write) => deps.noteJournalWrite(write, MEMORY_RECALL))
      .catch(() => { /* the journal never rejects; a host that broke that loses one line */ });
    return rendered.length === 0 ? null : { rendering, names: rendered.map((r) => r.name) };
  } finally {
    if (deps.session.recallChainBusy !== null && deps.session.recallChainBusy.seq === seq) deps.session.recallChainBusy = null;
  }
}

// Writes the last prompt's candidates their recall_acted outcome and opens
// the next prompt's window: true where the session's own tool calls since
// that prompt fetched the record through memq get without --no-stamp or
// stamped it through memq touch --applied in the tier it was shown from, or
// the goal-close check stamped it applied, false otherwise. Names are matched
// without regard to case, as the goal-close check matches them, since memq
// compares record names without case on Windows. A touch after this prompt
// is in the next window and counts for the next prompt's candidates alone,
// as a get is. Nothing here is awaited: each outcome rides shadowOutcome's
// detached chain.
export function settleRecallOutcomes(deps: RecallDeps): void {
  const pending = deps.session.recallPending;
  const fetched = deps.session.recallGetNames;
  const applied = deps.session.recallAppliedNames;
  const touches = deps.session.recallTouches;
  deps.session.recallPending = null;
  deps.session.recallGetNames = new Set<string>();
  deps.session.recallAppliedNames = new Set<string>();
  deps.session.recallTouches = [];
  deps.session.recallPromptSeq += 1;
  if (pending === null) return;
  for (const c of pending.candidates) {
    const name = c.name.toLowerCase();
    const acted = fetched.has(name) || applied.has(name) || touches.some((t) => touchStampsCandidate(t, c));
    deps.shadowOutcome(deps.host, c.stampId, "recall_acted", acted ? "true" : "false");
  }
}

// --- The memory-recognition question: the index, the match, the gate and the outcome ---
//
// At session.start the plugin reads the memory snapshot's index.json and
// builds the index of `cmd:` triggers hooks/recognition.ts describes, in the
// tiers the memory-recognition nudge reads for the launch directory. After each
// main-loop Bash or PowerShell call has run, its command is matched against
// that index inside the hook's own time, memory-recognition is asked live
// once a session of each record it matched, and within the session's next
// three tool calls a memq get of the record in its tier writes nudge_acted
// true, the third writing false otherwise. The question's state carries the matched trigger
// and the record, and nothing of the command. The tool call awaits the asks,
// each under its hold, before its nudge is claimed, and awaits as well an
// ask another call still holds on a record this call matched. An answer
// whose `skip` probability is at least RECOGNITION_SKIP_THRESHOLD withholds
// that record's `cmd:` pointer at every tool-call boundary for the rest of
// the session, its pointers under other trigger kinds and anchors kept; any
// other ending, a `nudge` answer, a hold that ran out, a failed call or no
// ask at all, leaves the nudge as it would be with no gate. The answer reaches
// nothing else: not the tool's result, a branch or a decision action. The
// nudge itself, read from the same snapshot, is the memory-recognition nudge
// section's in hooks/index.ts.

// The index's scope, from one run of RECOGNITION_SCOPE_SCRIPT in the launch
// directory through kitNodeRun, so the kit's own resolvers answer under the
// environment every memq spawn of this session inherits. A run that did not
// start, ran past its bound, exited other than 0 or printed other than the
// script's one object did not answer, and gives null.
async function recognitionScopeRead(deps: RecallDeps): Promise<RecognitionScope | null> {
  const run = await deps.kitNodeRun((kitRoot) => [
    "-e", RECOGNITION_SCOPE_SCRIPT, `${kitRoot}/scripts/memq.js`, `${kitRoot}/scripts/memory-database.js`,
  ], MEMQ_READ_TIMEOUT_MS);
  if ("cause" in run || run.ran.exitCode !== 0) return null;
  return recognitionScopeOf(run.ran.stdout);
}

// The scope the session holds, or one run of the scope program where it
// holds none and the last run started at least RECOGNITION_SCOPE_RETRY_MS
// ago, or null.
async function recognitionScopeEnsured(deps: RecallDeps): Promise<RecognitionScope | null> {
  const r = deps.session.recognition;
  if (r.scope !== null) return r.scope;
  if (r.scopeRunAt !== null && Date.now() - r.scopeRunAt < RECOGNITION_SCOPE_RETRY_MS) return null;
  r.scopeRunAt = Date.now();
  r.scope = await recognitionScopeRead(deps);
  return r.scope;
}

// One check of the snapshot. Where `mayRunScope` is set and the session holds
// no scope, the scope program runs first, before the snapshot is looked at,
// so the session holds a scope whatever state the snapshot is in. Then a
// size and mtime equal to the index's stamp leave the
// index as it is, and otherwise the file is read and both indexes, the
// ask's and the nudge's, rebuilt from that one read. session.start's load
// and prompt.submit's retry set `mayRunScope`: a check a tool call starts
// reads the scope the session holds and never spawns the scope program,
// since the only child a call spawns is a formatter or a stamp. A scope that
// answered is kept for the session, one that does not serve included. A run
// that did not answer leaves the scope unread, and the next run starts no
// sooner than RECOGNITION_SCOPE_RETRY_MS after it started, so a failing host
// sees at most one run per back-off. A snapshot that is absent, not a file,
// past RECOGNITION_READ_MAX, unreadable or of another version, an unread
// scope, and a scope that does not serve, each leave an empty index and no
// stamp, silently, so the next check stats the file again. Never rejects.
async function recognitionLoad(deps: RecallDeps, mayRunScope: boolean): Promise<void> {
  const r = deps.session.recognition;
  r.checkedAt = Date.now();
  const clear = (): void => {
    r.index = [];
    r.nudge = [];
    r.stamp = null;
  };
  try {
    if (mayRunScope) await recognitionScopeEnsured(deps);
    const home: unknown = await deps.host.getHome();
    if (typeof home !== "string" || home.trim().length === 0) return clear();
    const file = `${home.trim().replace(/[/\\]+$/, "")}/${RECOGNITION_SNAPSHOT_FILE}`;
    const stat = await deps.statFile(file);
    if (stat === null || typeof stat !== "object" || stat.kind !== "file") return clear();
    const size = Number(stat.size);
    const mtimeMs = Number(stat.mtimeMs);
    const stamp = `${size}:${Math.round(mtimeMs)}`;
    if (stamp === r.stamp) return;
    if (!Number.isFinite(size) || size > RECOGNITION_READ_MAX) return clear();
    const scope = r.scope;
    if (scope === null || !scope.serves) return clear();
    const text = String(await deps.host.readFile(file));
    const index = recognitionIndexOf(text, scope);
    const nudge = nudgeIndexOf(text, scope);
    if (index === null || nudge === null) return clear();
    r.index = index;
    r.nudge = nudge;
    r.stamp = stamp;
  } catch {
    clear();
  }
}

// Starts a check of the snapshot unless one is in flight, awaited by nothing
// where it starts. `mayRunScope` is session.start's and prompt.submit's
// alone, recognitionLoad's reason.
export function startRecognitionLoad(deps: RecallDeps, mayRunScope: boolean): void {
  const r = deps.session.recognition;
  if (r.loading !== null) return;
  r.loading = recognitionLoad(deps, mayRunScope).finally(() => { r.loading = null; });
}

// prompt.submit's recovery from a scope run that did not answer: where the
// session holds no scope and RECOGNITION_SCOPE_RETRY_MS has passed since the
// last scope run started, a check that may run the scope program starts,
// awaited by nothing here. A prompt is not a tool call, so no call spawns
// the scope program, and a failing host sees at most one run per back-off.
export function recognitionScopeRetry(deps: RecallDeps): void {
  const r = deps.session.recognition;
  if (r.scope !== null) return;
  if (r.scopeRunAt !== null && Date.now() - r.scopeRunAt < RECOGNITION_SCOPE_RETRY_MS) return;
  startRecognitionLoad(deps, true);
}

// The after side of one main-loop tool call: where a minute has passed since
// the last check, a new one starts; then the command is matched against the
// index as it stands, and memory-recognition is asked live, through liveAsk
// with the question named live at this one site, of each matched record not
// yet asked about this session. The asks fire together, and each opens its
// record's nudge_acted window as it fires, whatever it then answers. A
// matched record already asked whose ask another call still holds in the
// session's recognitionAsking is awaited too. Settles once every one of
// those has: a record answered skip at or above RECOGNITION_SKIP_THRESHOLD
// joins the session's recognitionSkipped, and a record answered otherwise,
// or whose ask ran out its hold or failed, joins nothing. `mode` off checks
// nothing, asks nothing and writes nothing, liveAsk's rule.
export async function recognitionAsk(deps: RecallDeps, tool: unknown, command: unknown, mode: string, budget: HookBudget): Promise<void> {
  if (mode !== "shadow") return;
  if (Date.now() - deps.session.recognition.checkedAt >= RECOGNITION_CHECK_EVERY_MS) startRecognitionLoad(deps, false);
  const matched = recognitionMatches(deps.session.recognition.index, tool, command);
  // Read before this call's own asks start, so it waits on other calls' asks
  // alone.
  const waits = new Set<Promise<void>>();
  for (const m of matched) {
    const key = recognitionKeyOf(m);
    const asking = deps.session.recognitionAsked.has(key) ? deps.session.recognitionAsking.get(key) : undefined;
    if (asking !== undefined) waits.add(asking);
  }
  const matches = matched.filter((m) => !deps.session.recognitionAsked.has(recognitionKeyOf(m)));
  if (matches.length === 0 && waits.size === 0) return;
  const host = deps.host;
  // liveAsk hands the stamp id over before its first await, so each record is
  // marked asked, and its window opened, before any answer comes back. The
  // record's recognitionAsking entry on the session is set in the same
  // synchronous stretch, and settles once its answer has been read, never
  // rejecting.
  const asks = matches.map((m) => {
    const key = recognitionKeyOf(m);
    const ask = deps.liveAsk(host, "tool.call", budget, MEMORY_RECOGNITION, MEMORY_RECOGNITION, MEMORY_RECOGNITION_OPTIONS, memoryRecognitionStateText(m), mode, [MEMORY_RECOGNITION], (stampId) => {
      if (stampId === null) return;
      deps.session.recognitionAsked.add(key);
      deps.session.recognitionPending.push({ tier: m.tier, name: m.name.toLowerCase(), stampId, left: RECOGNITION_ACT_WINDOW });
    }).then((result) => {
      if (result === null || !("answer" in result)) return;
      const skip = result.answer.probabilities.skip;
      if (typeof skip === "number" && skip >= RECOGNITION_SKIP_THRESHOLD) deps.session.recognitionSkipped.add(key);
    });
    const settled = ask.then(() => undefined, () => undefined);
    deps.session.recognitionAsking.set(key, settled);
    void settled.then(() => {
      if (deps.session.recognitionAsking.get(key) === settled) deps.session.recognitionAsking.delete(key);
    });
    return ask;
  });
  await Promise.allSettled([...asks, ...waits]);
}

// The tier one `memq get` reads, for the record of that lowercased name, or
// null where it reads none the session knows of. A flag names its tier, and
// `--type=<type>` the type tier only where it names the declared type, the
// one the index reads. A bare get reads the nearest tier holding the name,
// read here from the tiers the session's index and its open windows hold it
// in. memq's own walk reads a journal key and a pending memory before the
// project tier, and a nearer record carrying no `cmd:` trigger is not in the
// index, so a get any of those answers is credited to the nearest tier the
// index holds the name in.
function recognitionTierOfGet(deps: RecallDeps, g: { name: string } & MemqGetTier): RecognitionTier | null {
  if (g.tier === "refused") return null;
  if (g.tier === "operator") return "operator";
  if (g.tier === "type") return g.namedType === null || g.namedType === deps.session.recognition.scope?.projectType ? "type" : null;
  const name = g.name.toLowerCase();
  const holding = new Set<RecognitionTier>([
    ...deps.session.recognition.index.filter((r) => r.name.toLowerCase() === name).map((r) => r.tier),
    ...deps.session.recognitionPending.filter((p) => p.name === name).map((p) => p.tier),
  ]);
  return (["project", "type", "operator"] as const).find((t) => holding.has(t)) ?? null;
}

// One main-loop tool call counted against every open nudge_acted window:
// a record the call's command fetches through memq get without --no-stamp,
// in the tier that get reads, writes true, and a window this call closes
// without one writes false. Names match without case, as the recall outcome
// matches them.
export function settleRecognitionOutcomes(deps: RecallDeps, fetches: ReadonlyArray<{ name: string } & MemqGetTier>): void {
  if (deps.session.recognitionPending.length === 0) return;
  const credited = new Set<string>();
  for (const g of fetches) {
    const tier = recognitionTierOfGet(deps, g);
    if (tier !== null) credited.add(recognitionKeyOf({ tier, name: g.name.toLowerCase() }));
  }
  const open: Array<{ tier: RecognitionTier; name: string; stampId: string; left: number }> = [];
  for (const p of deps.session.recognitionPending) {
    if (credited.has(recognitionKeyOf(p))) deps.shadowOutcome(deps.host, p.stampId, "nudge_acted", "true");
    else if (p.left <= 1) deps.shadowOutcome(deps.host, p.stampId, "nudge_acted", "false");
    else open.push({ ...p, left: p.left - 1 });
  }
  deps.session.recognitionPending = open;
}
