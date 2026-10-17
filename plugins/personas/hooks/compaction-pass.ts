// compaction-pass.ts: the compaction pass. The pass judges each old tool
// result as keep, cut or drop through the tool-result-stale question, on a
// timer (the heartbeat in an armed session, its own in an unarmed one) and
// never inside a hook, and builds a plan the session.compact hook reads. Its
// rule lives in hooks/compaction.ts; what sits here is the state the timer
// and the hook share, the timer step, the shadow line, the Jev asks through
// shadowAsk, the journal lines and the rerun watch.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts and refuses the whole module
// where `$` crosses an import, so this file takes a CompactionPassDeps that
// hooks/index.ts builds over `$` with compactionPassDepsOf, as the fleet
// reading takes a FleetHost built with hostOf. The state instance is the
// caller's too, handed in as deps.pass, since each loaded instance of
// hooks/index.ts holds the pass for its own session.

import {
  COMPACT_CUT_MARKER,
  COMPACT_PASS_FLOOR_PERCENT,
  COMPACT_PLAN_STALE_MESSAGES,
  applyPlan,
  buildPlan,
  cacheExpired,
  cutWorthStarting,
  isToolVerdict,
  keysPrefix,
  passFillPercentOf,
  planRefusal,
  rerunEntriesOf,
  rerunListOf,
  settleRerunCall,
  surveyTranscript,
  targetTokensOf,
  tokensOf,
  toolInputHash,
  type ApplyResult,
  type CachedVerdict,
  type CompactionPlan,
  type PassMessage,
  type PlanRefusal,
  type RerunEntry,
} from "./compaction";
import { splitOf, writeEvent, type JournalWrite, type OutcomeKind } from "./decision-journal";
import type { QuestionResolver, SeamResult } from "./decision-seam";
import type { PluginHost } from "./host";
import { TOOL_RESULT_STALE, TOOL_RESULT_STALE_OPTIONS, toolResultStaleStateText } from "./question-catalog";
import { boundedText, safeErrorText } from "./text";

// What the pass needs from the host: the eight engine calls it makes itself,
// the verdict cache's state read and write, the rerun list's three store
// calls, the usage read, the transcript read in both forms and the marked
// compaction's command run, and the members the journal and the seam reach
// through shadowAsk and shadowOutcome. Those two take the host whole, so the
// Pick names every member PluginHost declares, and it stays a Pick so a
// member added to PluginHost reaches the pass only by being named here.
export type CompactionPassHost = Pick<PluginHost,
  | "getCompactionVerdicts" | "setCompactionVerdicts" | "getStore" | "setStore" | "deleteStore"
  | "sessionUsage" | "sessionMessages" | "runCommand"
  | "getApiKey" | "getHome" | "readFile" | "writeFile" | "fileExists" | "listDir" | "fetch" | "sleep">;

// What hooks/index.ts hands the pass at each call: the host, the session's
// pass state, the persona and session its journal lines name, a writer that
// pushes one monitor decision, and the three seam and journal helpers
// hooks/index.ts declares, each taking the host as its first argument.
export type CompactionPassDeps = {
  host: CompactionPassHost;
  pass: CompactionPassState;
  persona: string;
  sessionId: string;
  decide: (action: string, detail: string) => void;
  shadowAsk: (
    host: PluginHost,
    site: string,
    questionSetId: string,
    optionIds: readonly string[],
    state: string,
    mode: string,
    haikuValue: string | null,
    resolve?: QuestionResolver,
    onResult?: (result: SeamResult | null) => void,
  ) => string | null;
  shadowOutcome: (host: PluginHost, callStampId: string, kind: OutcomeKind, value: string) => void;
  noteJournalWrite: (write: JournalWrite, site: string) => void;
};

// The site label the pass's call lines carry. The verdict cache lives in the
// engine's state under compactionVerdicts, declared in hooks/personas.d.ts,
// and hostOf in hooks/index.ts names that key as a literal in each of its two
// calls, which the plugin validator requires.
const COMPACTION_SITE = "compaction";

// The pass option's three values. Any other value reads as off.
export type CompactionPassOption = "off" | "shadow" | "live";

// The option as the configuration spells it: one of the three, or off with
// the value that was refused, so session.start can log it once.
export function compactionPassOptionOf(value: unknown): { option: CompactionPassOption; invalid: string | null } {
  if (value === undefined) return { option: "live", invalid: null };
  if (value === "off" || value === "shadow" || value === "live") return { option: value, invalid: null };
  return { option: "off", invalid: typeof value === "string" ? value : JSON.stringify(value) ?? String(value) };
}

// The pass's state. hooks/index.ts holds the one instance, per loaded plugin
// instance and so per session, as sess is, and hands it in as deps.pass. The
// plan and the latches live in memory alone: a reload loses the plan, which
// the next tick above the floor rebuilds from the verdict cache, and the cache
// itself lives in the engine's state, which the host keeps across a reload,
// so a result is asked about once per session.
export type CompactionPassState = {
  // The plan as last built, or null before the first build.
  plan: CompactionPlan | null;
  // The verdict cache, read from the engine's state at the first tick that
  // needs it.
  cache: Record<string, CachedVerdict> | null;
  // Counts up at every verdict that lands, and the count the plan was built
  // at, so a tick folds landed verdicts into the plan without new messages.
  cacheVersion: number;
  planCacheVersion: number;
  // Whether a tick's step is running, so a slow engine read never lets two
  // overlap.
  busy: boolean;
  // Whether the once-per-session disabled line has been written.
  disabledJournaled: boolean;
  // When the last main-thread turn ended, in Date.now() milliseconds, as the
  // meter row carries it, or 0 where none has; the cache clock runs from it.
  lastMainTurnEndedAt: number;
  // Whether the current idle stretch has had its cold_cache line, and under
  // live its marked compaction. A turn ending opens a new stretch.
  coldCacheJournaled: boolean;
  // Whether the seam has answered no_key in this session. Once it has, the
  // step still builds its plan from the cache and asks nothing more, since
  // every later ask would only journal the same refusal again.
  seamNoKey: boolean;
  // The rerun watch list, the results a live pass dropped or cut, as read
  // from the plugin store at the first call that needs it and written
  // through at every change, or null before that read.
  rerun: RerunEntry[] | null;
  // The rerun list's store writes, chained so they run one after another.
  rerunWrites: Promise<void>;
};

// A fresh state, as a session starts with it.
export function newCompactionPassState(): CompactionPassState {
  return { plan: null, cache: null, cacheVersion: 0, planCacheVersion: -1, busy: false, disabledJournaled: false, lastMainTurnEndedAt: 0, coldCacheJournaled: false, seamNoKey: false, rerun: null, rerunWrites: Promise.resolve() };
}

// The verdict cache, read from the engine's state once and held. A read
// that fails or holds no map starts an empty cache, which re-asks what the
// host lost.
async function compactionVerdictCache(deps: CompactionPassDeps): Promise<Record<string, CachedVerdict>> {
  if (deps.pass.cache !== null) return deps.pass.cache;
  let held: unknown;
  try {
    held = (await deps.host.getCompactionVerdicts()).value;
  } catch {
    held = undefined;
  }
  const cache: Record<string, CachedVerdict> = Object.create(null);
  if (held && typeof held === "object" && !Array.isArray(held)) {
    for (const id of Object.keys(held as Record<string, unknown>)) {
      if (!Object.hasOwn(held as Record<string, unknown>, id)) continue;
      const v: unknown = (held as Record<string, unknown>)[id];
      if (v && typeof v === "object" && isToolVerdict((v as { verdict?: unknown }).verdict)) {
        const entry = v as { verdict: string; answered?: unknown; holdout?: unknown; stampId?: unknown };
        cache[id] = {
          verdict: entry.verdict as CachedVerdict["verdict"],
          answered: typeof entry.answered === "string" ? entry.answered : entry.verdict,
          holdout: entry.holdout === true,
          ...(typeof entry.stampId === "string" ? { stampId: entry.stampId } : {}),
        };
      }
    }
  }
  deps.pass.cache = cache;
  return cache;
}

// One compaction_pass event line. The detail is flat, as the journal's
// event line takes it.
export async function compactionPassEvent(deps: CompactionPassDeps, detail: Record<string, string | number | boolean | null>): Promise<void> {
  deps.noteJournalWrite(await writeEvent(deps.host, {
    persona: deps.persona,
    session: deps.sessionId,
    event: "compaction_pass",
    detail,
  }), "compaction_pass");
}

// A plan's counts as a line carries them.
export function compactionPlanDetail(plan: CompactionPlan | null): Record<string, number | null> {
  if (plan === null) {
    return { keep: 0, cut: 0, drop: 0, holdout: 0, unjudged: 0, keptCount: null, keptTokens: null, droppedTokens: null, targetTokens: null, skillKept: 0, skillSuperseded: 0, planRows: null };
  }
  return {
    keep: plan.counts.keep,
    cut: plan.counts.cut,
    drop: plan.counts.drop,
    holdout: plan.counts.holdout,
    unjudged: plan.unjudged,
    keptCount: plan.keptCount,
    keptTokens: plan.keptTokens,
    droppedTokens: plan.droppedTokens,
    targetTokens: plan.targetTokens,
    skillKept: plan.skillKept.length,
    skillSuperseded: plan.skillSuperseded,
    planRows: plan.rowCount,
  };
}

// The pass's tick, run from the heartbeat in an armed session, owner or
// reader, and from the one timer an unarmed session starts for it. With the
// compactionPass option off it does nothing. Where the seam's mode sends
// nothing, no plan can exist, so it journals one disabled line per session
// and does nothing more. With no turn open it reads the
// usage with its breakdown and, where a plan stands and the cache has
// expired, reads the rows and journals one cold_cache line for the idle
// stretch if the plan still covers them, and under live starts one marked
// compaction beside it. Then, where the fill reaches the floor, read against
// the auto-compaction threshold, and where no plan stands, ten
// messages have arrived since the last one, or verdicts have landed since
// it was built, it reads both forms of the transcript, surveys them, asks
// tool-result-stale of at most COMPACT_ASK_BATCH results that hold no
// verdict, each through shadowAsk as its own call of site compaction, and
// builds the plan from the cache as it stands. Once the seam has answered
// no_key in the session, the step builds the plan and asks nothing. A verdict
// lands through the ask's result hook, into the cache and the engine's state,
// keep where its stamp is a holdout. The asks are never awaited here: the
// next tick folds what landed. Every failure is caught and counted as one
// decision, since the engine's timer swallows a rejection and nobody would
// receive it.
export async function compactionPassStep(deps: CompactionPassDeps, option: CompactionPassOption, jevMode: string, turnOpen: () => boolean, now: number): Promise<void> {
  if (option === "off" || deps.pass.busy) return;
  deps.pass.busy = true;
  try {
    if (jevMode !== "shadow") {
      if (!deps.pass.disabledJournaled) {
        deps.pass.disabledJournaled = true;
        deps.noteJournalWrite(await writeEvent(deps.host, {
          persona: deps.persona,
          session: deps.sessionId,
          event: "compaction_pass_disabled",
          detail: { option, jevMode },
        }), "compaction_pass_disabled");
      }
      return;
    }
    if (turnOpen()) return;
    // One usage read per idle tick, with the breakdown, so the floor reads
    // the fill against the auto-compaction threshold and the plan's target
    // comes from the same reading.
    let usage: unknown;
    try {
      usage = await deps.host.sessionUsage({ breakdown: "summary" });
    } catch {
      usage = undefined;
    }
    const fill = passFillPercentOf(usage);
    let rows: PassMessage[] | null = null;
    const readRows = async (): Promise<PassMessage[] | null> => {
      if (rows !== null) return rows;
      try {
        const read: unknown = await deps.host.sessionMessages();
        rows = Array.isArray(read) ? (read as PassMessage[]) : null;
      } catch {
        rows = null;
      }
      return rows;
    };
    // The expired-cache reading, over the plan as it stands.
    const standing = deps.pass.plan;
    if (standing !== null && !deps.pass.coldCacheJournaled && cacheExpired(now, deps.pass.lastMainTurnEndedAt, turnOpen())) {
      const current = await readRows();
      if (current !== null && !turnOpen() && keysPrefix(standing.keys, current)) {
        deps.pass.coldCacheJournaled = true;
        // Under live the plan must save at least COMPACT_CUT_MIN_SAVED_TOKENS
        // for this moment to start a cut; a live line declining for that
        // reason names it as its why.
        const startCut = option === "live" && cutWorthStarting(standing.droppedTokens);
        await compactionPassEvent(deps, {
          trigger: "cold_cache",
          option,
          plan: "covering",
          why: option === "live" && !startCut ? "under-minimum" : null,
          ...compactionPlanDetail(standing),
          tokensAfter: null,
          idleS: Math.floor((now - deps.pass.lastMainTurnEndedAt) / 1000),
          messages: current.length,
        });
        // Under live the same moment starts the marked compaction, once per
        // idle stretch since the line above is. The engine runs it through
        // the session.compact hook in hooks/index.ts, which cuts by the plan or
        // skips, and never summarizes. Not awaited: the command queues until
        // the session is idle, and a refusal is counted as one decision.
        if (startCut) {
          void Promise.resolve()
            .then(() => deps.host.runCommand({ command: "compact", args: COMPACT_CUT_MARKER }))
            .catch((err: unknown) => {
              deps.decide("compaction_pass_failed", boundedText(safeErrorText(err)));
            });
          // The queued compaction reads the plan as it stands, and the hook
          // drops the plan once it runs, so this tick builds no new one.
          return;
        }
      }
    }
    // The pass, from the floor up.
    if (fill === null || fill < COMPACT_PASS_FLOOR_PERCENT) return;
    const current = await readRows();
    if (current === null) return;
    const cache = await compactionVerdictCache(deps);
    // Stale where no plan stands, where ten messages arrived since it was
    // built, where verdicts landed since, or where its keys no longer open
    // the rows, as after a compaction that shrank the transcript.
    const stale = standing === null
      || current.length - standing.rowCount >= COMPACT_PLAN_STALE_MESSAGES
      || deps.pass.planCacheVersion !== deps.pass.cacheVersion
      || !keysPrefix(standing.keys, current);
    if (!stale) return;
    let api: unknown;
    try {
      api = await deps.host.sessionMessages({ as: "api" });
    } catch {
      api = [];
    }
    if (turnOpen()) return;
    const survey = surveyTranscript(current, api, cache);
    // A session whose seam has answered no_key asks nothing; the plan below
    // is still built from the cache as it stands.
    const asks = deps.pass.seamNoKey ? [] : survey.ask;
    for (const candidate of asks) {
      const id = candidate.id;
      let stampId: string | null = null;
      stampId = deps.shadowAsk(deps.host, COMPACTION_SITE, TOOL_RESULT_STALE, TOOL_RESULT_STALE_OPTIONS, toolResultStaleStateText(candidate), jevMode, null, undefined, (result) => {
        if (result !== null && !result.ok && result.reason === "no_key") deps.pass.seamNoKey = true;
        if (result === null || !result.ok || result.primitive !== "choice") return;
        const answered = result.answer.choice;
        if (!isToolVerdict(answered)) return;
        const holdout = stampId !== null && splitOf(stampId) === "holdout";
        cache[id] = { verdict: holdout ? "keep" : answered, answered, holdout, ...(stampId !== null ? { stampId } : {}) };
        deps.pass.cacheVersion += 1;
        // Written through as it lands, so a reload between a verdict and the
        // next tick re-asks nothing. A refused write costs one re-ask after a
        // reload and nothing else.
        void Promise.resolve()
          .then(() => deps.host.setCompactionVerdicts(cache))
          .catch(() => { /* the engine's state is unavailable; the cache in memory still serves this session */ });
      });
    }
    deps.pass.plan = buildPlan(current, survey, cache, targetTokensOf(usage), now);
    deps.pass.planCacheVersion = deps.pass.cacheVersion;
  } catch (err) {
    deps.decide("compaction_pass_failed", boundedText(safeErrorText(err)));
  } finally {
    deps.pass.busy = false;
  }
}

// The shadow branch, run by the session.compact hook on an allowed auto or
// precompute compaction of the main conversation once next has resolved.
// With a plan whose keys open the hook's messages, it applies the plan to a
// copy and reads the kept estimate against the target; the hook's own result
// is never changed here. One compaction_pass line records what the plan
// would have kept beside what the summary kept, or why no plan applied: no
// plan, a prefix mismatch, no target, an estimate over the target, or an
// apply that would split a call from its result. No Jev call and no model
// call runs here: the plan is read as the timer left it.
export async function compactionPassShadow(deps: CompactionPassDeps, e: { trigger: string; messages?: unknown }, result: { tokensAfter?: number; skip?: string }, option: CompactionPassOption): Promise<void> {
  const reading = compactionPassReading(deps.pass, e.messages);
  await compactionPassEvent(deps, {
    trigger: e.trigger,
    option,
    ...compactionReadingDetail(reading),
    tokensAfter: typeof result.tokensAfter === "number" ? result.tokensAfter : null,
    messages: reading.messages.length,
  });
}

// The plan read against a compaction's messages: whether it covers them,
// the copy it applies to, and why it does not apply where it does not. The
// shadow line and the live pass both read this one. `protect` names the
// results the live pass keeps whole; the shadow line passes none.
// `sizeChecks` is planRefusal's: the live pass at an automatic compaction
// passes false, and the shadow line and the marked compaction keep every
// refusal. Pure over the plan as the timer left it.
export type CompactionPassReading = { plan: CompactionPlan | null; messages: PassMessage[]; applied: ApplyResult | null; why: PlanRefusal | null };
export function compactionPassReading(pass: CompactionPassState, raw: unknown, protect: readonly string[] = [], { sizeChecks = true }: { sizeChecks?: boolean } = {}): CompactionPassReading {
  const plan = pass.plan;
  const messages: PassMessage[] = Array.isArray(raw) ? (raw as PassMessage[]) : [];
  const covers = plan !== null && keysPrefix(plan.keys, messages);
  const applied: ApplyResult | null = plan !== null && covers ? applyPlan(messages, plan, protect) : null;
  return { plan, messages, applied, why: planRefusal(plan, messages, applied, covers, { sizeChecks }) };
}

// The summarizer's usage as the compaction_pass line carries it: its whole
// input, the uncached, cache-read and cache-written input counts summed over
// those that are finite numbers, and its output. Both are null where the
// engine reported no usage object, as where a hook answered in its place or
// it reused a summary already computed.
export function compactionSummaryUsageDetail(usage: unknown): { summaryInputTokens: number | null; summaryOutputTokens: number | null } {
  if (typeof usage !== "object" || usage === null) return { summaryInputTokens: null, summaryOutputTokens: null };
  const read = usage as Record<string, unknown>;
  const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const inputs = [read.input_tokens, read.cache_read_input_tokens, read.cache_creation_input_tokens].map(finite).filter((n): n is number => n !== null);
  return {
    summaryInputTokens: inputs.length === 0 ? null : inputs.reduce((a, b) => a + b, 0),
    summaryOutputTokens: finite(read.output_tokens),
  };
}

// The compaction_pass line's plan fields for one reading.
export function compactionReadingDetail(reading: CompactionPassReading): Record<string, string | number | boolean | null> {
  const applied = reading.applied;
  return {
    plan: reading.why === null ? "applied" : "none",
    why: reading.why,
    ...compactionPlanDetail(reading.plan),
    ...(applied === null ? {} : {
      keptCount: applied.keptCount,
      keptTokens: tokensOf(applied.keptChars),
      droppedTokens: tokensOf(applied.droppedChars),
      skillKept: applied.skillKept,
      skillSuperseded: applied.skillSuperseded,
      paired: applied.paired,
    }),
  };
}

// The rerun watch list's plugin store key, one per session, since the window
// counts this session's own calls.
function compactionRerunKey(sessionId: string): string {
  return `compactionRerun:${sessionId}`;
}

// The watch list, read from the plugin store at the first call that needs it
// and held in memory after. A read that fails or holds nothing well formed
// watches nothing. Two callers racing the first read keep whichever list
// landed first, so neither replaces changes the other made since.
async function compactionRerunList(deps: CompactionPassDeps): Promise<RerunEntry[]> {
  if (deps.pass.rerun !== null) return deps.pass.rerun;
  let held: unknown;
  try {
    held = await deps.host.getStore(compactionRerunKey(deps.sessionId));
  } catch {
    held = undefined;
  }
  if (deps.pass.rerun === null) deps.pass.rerun = rerunListOf(held);
  return deps.pass.rerun;
}

// Writes the watch list through to the plugin store as memory holds it when
// the write runs, deleting the key where nothing is watched. Writes run one
// after another, so the last to run carries the newest list. Never awaited
// and never thrown: a refused write costs only the outcomes a reload would
// lose.
function saveCompactionRerun(deps: CompactionPassDeps): void {
  deps.pass.rerunWrites = deps.pass.rerunWrites
    .then(async () => {
      const list = deps.pass.rerun ?? [];
      if (list.length === 0) await deps.host.deleteStore(compactionRerunKey(deps.sessionId));
      else await deps.host.setStore(compactionRerunKey(deps.sessionId), list);
    })
    .catch(() => { /* the store refused; the list in memory still serves this session */ });
}

// A compaction of the main conversation that ran ends every open window:
// each entry still watched writes rerun_within false. Then a live pass whose
// plan applied, its cut list sent down to the engine's summary or returned as
// the marked compaction's result, starts a window for each result it dropped
// or cut whose verdict carries a stamp.
export async function compactionRerunAtCompaction(deps: CompactionPassDeps, applied: ApplyResult | null): Promise<void> {
  const open = await compactionRerunList(deps);
  const host = deps.host;
  for (const entry of open) deps.shadowOutcome(host, entry.stampId, "rerun_within", "false");
  deps.pass.rerun = applied === null ? [] : rerunEntriesOf(applied.changed, deps.pass.cache ?? {});
  if (open.length > 0 || deps.pass.rerun.length > 0) saveCompactionRerun(deps);
}

// One main-loop tool call counted against the watch list, on the tool.call
// after side: a call of a watched tool and input writes rerun_within true,
// an entry past its window writes false, and the rest count down. The list
// is read and replaced in one synchronous step after the load, so calls
// running side by side each count once.
export async function compactionRerunAtCall(deps: CompactionPassDeps, tool: string, input: unknown): Promise<void> {
  await compactionRerunList(deps);
  const entries = deps.pass.rerun ?? [];
  if (entries.length === 0) return;
  const settled = settleRerunCall(entries, tool, toolInputHash(input));
  deps.pass.rerun = settled.open;
  const host = deps.host;
  for (const outcome of settled.outcomes) deps.shadowOutcome(host, outcome.stampId, "rerun_within", outcome.value);
  saveCompactionRerun(deps);
}
