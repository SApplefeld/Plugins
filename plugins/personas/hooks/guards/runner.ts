// runner.ts: the seam the before-tool guards and the after-call hooks plug
// into, with the merge rules the kit's hook dispatcher applied. The module's
// tool.call handler calls runBefore ahead of next(e) and runAfter on its
// result; the handler owns the mode, the journal and the deny, and this file
// owns registration, matching, concurrency and the merge.
//
// Nothing here reads `$`: the engine's loader follows `$` only into a
// top-level function of hooks/index.ts, so the handler builds a GuardContext
// over `$` there and hands the context down.

// A tool.call envelope as the handler reads it: the tool, the call's id, the
// loop's agent id in a subagent, and the tool's own arguments spread beside
// them (`command` for Bash, `file_path` for the file tools).
export type GuardCall = {
  readonly tool: string;
  readonly tool_use_id?: string;
  readonly agentId?: string;
  readonly [key: string]: unknown;
};

// What next(e) resolved to: the tool's result, `{ deny }` from a hook
// beneath, or from core an error result carrying a classic hook's refusal as
// its text with `isError` set.
export type GuardResult = {
  readonly deny?: string;
  readonly context?: readonly string[];
  readonly isError?: boolean;
  readonly text?: unknown;
  readonly result?: unknown;
  readonly [key: string]: unknown;
};

// The `$` nouns a guard reaches, each a full call at its own site in
// hooks/index.ts. `run` is $.process.run, bounded by `timeoutMs`; the hook's
// own-time clock stops while it runs. `fileExists` is $.fs.exists.
export interface GuardHost {
  run(argv: readonly string[], init: { cwd?: string; env?: Record<string, string>; timeoutMs: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  fileExists(path: string): Promise<boolean>;
}

// What a guard decides against beside the call: the session's working
// directory, the agent type of the loop the call runs in where e.agentId is
// set, and the host.
export type GuardContext = {
  readonly cwd: string;
  readonly agentType?: string;
  readonly host: GuardHost;
};

// A guard's verdict: `deny` refuses the call; otherwise `context` is the
// lines the call's result carries where the guard's verdict is the call's,
// and `reason` is the allow's own reason for the journal, where the guard
// states one.
export type BeforeVerdict = { deny?: string; context?: string[]; reason?: string };

export interface BeforeGuard {
  readonly name: string;
  // The fixed phrase the kit command hook this guard shadows opens its
  // refusal with. Under shadow the command hook's verdict for the same call
  // reads deny where this phrase is in next(e)'s error text.
  readonly commandPhrase?: string;
  matches(e: GuardCall): boolean;
  decide(e: GuardCall, ctx: GuardContext): BeforeVerdict | Promise<BeforeVerdict>;
}

// An after hook either reads the shared GuardContext or, with `readsContext`
// false, does not. One that does not is never handed one, so a call only such
// hooks match builds no context and cannot fail on building it.
export type AfterHook = {
  readonly name: string;
  readonly readsContext?: true;
  matches(e: GuardCall, r: GuardResult): boolean;
  apply(e: GuardCall, r: GuardResult, ctx: GuardContext): { context?: string[] } | Promise<{ context?: string[] }>;
} | {
  readonly name: string;
  readonly readsContext: false;
  matches(e: GuardCall, r: GuardResult): boolean;
  apply(e: GuardCall, r: GuardResult): { context?: string[] } | Promise<{ context?: string[] }>;
};

// One matched guard's verdict, for the journal: the guard, deny or allow,
// the deny's reason, else the allow's stated reason or "", and the guard's
// own time in milliseconds.
export type GuardVerdictRecord = { guard: string; verdict: "deny" | "allow"; reason: string; ms: number };

// A guard's or an after hook's own failure, with the guard's name and the
// phase it failed in. runBefore and runAfter wrap every rejection in one, so
// the handler tells a guard's failure from its own with instanceof.
export class GuardError extends Error {
  readonly guard: string;
  readonly phase: "before" | "after";
  readonly reason: string;
  constructor(guard: string, phase: "before" | "after", cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${guard} failed: ${reason}`);
    this.name = "GuardError";
    this.guard = guard;
    this.phase = phase;
    this.reason = reason;
  }
}

// The registries, in registration order. A registration returns its undo.
const beforeGuards: BeforeGuard[] = [];
const afterHooks: AfterHook[] = [];

export function registerBeforeGuard(guard: BeforeGuard): () => void {
  beforeGuards.push(guard);
  return () => {
    const i = beforeGuards.indexOf(guard);
    if (i >= 0) beforeGuards.splice(i, 1);
  };
}

export function registerAfterHook(hook: AfterHook): () => void {
  afterHooks.push(hook);
  return () => {
    const i = afterHooks.indexOf(hook);
    if (i >= 0) afterHooks.splice(i, 1);
  };
}

// The registered before guards that match a call, in registration order. A
// matcher that throws is that guard's own failure: it is thrown as a
// GuardError naming the guard in the before phase, so the handler takes the
// guard failure path rather than its own.
export function matchingBeforeGuards(e: GuardCall, guards: readonly BeforeGuard[] = beforeGuards): BeforeGuard[] {
  return guards.filter((g) => {
    try {
      return g.matches(e);
    } catch (err) {
      throw new GuardError(g.name, "before", err);
    }
  });
}

// The registered after hooks that match a call and its result, in
// registration order. A matcher that throws is thrown as a GuardError naming
// the hook in the after phase.
export function matchingAfterHooks(e: GuardCall, r: GuardResult, hooks: readonly AfterHook[] = afterHooks): AfterHook[] {
  return hooks.filter((h) => {
    try {
      return h.matches(e, r);
    } catch (err) {
      throw new GuardError(h.name, "after", err);
    }
  });
}

// The names of the matched guards or hooks, joined as a GuardError names them
// where the failure is the shared context's rather than one guard's.
function namesOf(matched: readonly { name: string }[]): string {
  return matched.map((m) => m.name).join(", ");
}

// The context the matched guards decide against, or a GuardError naming them
// all in `phase` where building it fails: a context that cannot be built,
// such as a subagent's call whose agent type the host cannot name, is every
// matched guard's failure.
async function contextOrThrow(ctxOf: () => Promise<GuardContext>, matched: readonly { name: string }[], phase: "before" | "after"): Promise<GuardContext> {
  try {
    return await ctxOf();
  } catch (err) {
    throw new GuardError(namesOf(matched), phase, err);
  }
}

// A deny is a non-empty string; anything else on `deny` is no deny.
function denyOf(v: unknown): string | null {
  const deny = (v as { deny?: unknown } | null)?.deny;
  return typeof deny === "string" && deny.length > 0 ? deny : null;
}

// An allow's stated reason, a string on `reason`, else "".
function allowReasonOf(v: unknown): string {
  const reason = (v as { reason?: unknown } | null)?.reason;
  return typeof reason === "string" ? reason : "";
}

// The strings on `context`; anything else there is dropped.
function contextOf(v: unknown): string[] {
  const context = (v as { context?: unknown } | null)?.context;
  return Array.isArray(context) ? context.filter((s): s is string => typeof s === "string" && s.length > 0) : [];
}

// Runs every settled entry's work concurrently and rejects with a GuardError
// for the first failure in registration order, else resolves the answers.
async function settledOrThrow<T>(names: readonly string[], phase: "before" | "after", work: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(work);
  const out: T[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "rejected") throw new GuardError(names[i], phase, s.reason);
    out.push(s.value);
  }
  return out;
}

/**
 * Runs every guard matching `e` concurrently against one context, built
 * through `ctxOf` once and only where a guard matches, and merges as the
 * dispatcher did: any deny wins and the denies' reasons join on a blank line,
 * else the contexts join in registration order, and no match is `{}`.
 * `observe` receives each matched guard's verdict. A guard whose matcher or
 * decide throws rejects the whole run with a GuardError naming it, and a
 * context that cannot be built rejects it with one naming every matched
 * guard.
 */
export async function runBefore(
  e: GuardCall,
  ctxOf: () => Promise<GuardContext>,
  observe?: (record: GuardVerdictRecord) => void,
  guards: readonly BeforeGuard[] = beforeGuards,
): Promise<BeforeVerdict> {
  const matched = matchingBeforeGuards(e, guards);
  if (matched.length === 0) return {};
  const ctx = await contextOrThrow(ctxOf, matched, "before");
  const settled = await Promise.allSettled(matched.map(async (g) => {
    const t0 = Date.now();
    const v = await g.decide(e, ctx);
    return { v, ms: Date.now() - t0 };
  }));
  // Every guard that decided is observed before a sibling's failure rejects
  // the run, so the journal keeps their verdicts beside the failure.
  const denies: string[] = [];
  const contexts: string[] = [];
  let failure: GuardError | null = null;
  for (let i = 0; i < matched.length; i++) {
    const s = settled[i];
    if (s.status === "rejected") {
      failure ??= new GuardError(matched[i].name, "before", s.reason);
      continue;
    }
    const deny = denyOf(s.value.v);
    if (observe) observe({ guard: matched[i].name, verdict: deny === null ? "allow" : "deny", reason: deny ?? allowReasonOf(s.value.v), ms: s.value.ms });
    if (deny !== null) denies.push(deny);
    else contexts.push(...contextOf(s.value.v));
  }
  if (failure !== null) throw failure;
  if (denies.length > 0) return { deny: denies.join("\n\n") };
  if (contexts.length > 0) return { context: contexts };
  return {};
}

/**
 * Runs every after hook matching `e` and `r` concurrently and joins their
 * contexts in registration order; no match is `{}`. The hooks that read a
 * context share one, built through `ctxOf` once and only where such a hook
 * matches. A hook whose matcher or apply throws rejects the whole run with a
 * GuardError naming it, and a context that cannot be built rejects it with
 * one naming every matched hook that reads it.
 */
export async function runAfter(
  e: GuardCall,
  r: GuardResult,
  ctxOf: () => Promise<GuardContext>,
  hooks: readonly AfterHook[] = afterHooks,
): Promise<{ context?: string[] }> {
  const matched = matchingAfterHooks(e, r, hooks);
  if (matched.length === 0) return {};
  const reading = matched.filter((h) => h.readsContext !== false);
  const ctx = reading.length > 0 ? await contextOrThrow(ctxOf, reading, "after") : null;
  const answers = await settledOrThrow(matched.map((h) => h.name), "after", matched.map(async (h) => {
    // A hook that reads a context is in `reading`, so `ctx` was built.
    return h.readsContext === false ? h.apply(e, r) : h.apply(e, r, ctx!);
  }));
  const contexts: string[] = [];
  for (const a of answers) contexts.push(...contextOf(a));
  return contexts.length > 0 ? { context: contexts } : {};
}

// How core opens the error result of a call a classic PreToolUse command hook
// refused, `Error: ` on the result alone: "PreToolUse:Bash hook error: [<the
// hook's command>]: <its stderr>".
const COMMAND_HOOK_ERROR_LEAD = /^(?:Error: )?PreToolUse:[^\s:]+ hook error:/;

/**
 * The kit command hook's verdict for a call, read from what next(e) resolved
 * to: deny where the guard has a phrase and the result is a refusal carrying
 * it, in a `{ deny }` from beneath, or in an error result's text that opens
 * with core's command-hook refusal lead and carries the phrase after it, else
 * allow. A tool's own error output that echoes the phrase, with no such lead,
 * is no refusal.
 */
export function commandVerdictOf(r: GuardResult, phrase: string | undefined): "deny" | "allow" {
  if (phrase === undefined || phrase.length === 0) return "allow";
  if (typeof r.deny === "string") return r.deny.includes(phrase) ? "deny" : "allow";
  if (r.isError !== true) return "allow";
  const texts = [r.text, r.result].filter((t): t is string => typeof t === "string");
  return texts.some((t) => {
    const lead = COMMAND_HOOK_ERROR_LEAD.exec(t);
    return lead !== null && t.indexOf(phrase, lead[0].length) >= 0;
  }) ? "deny" : "allow";
}
