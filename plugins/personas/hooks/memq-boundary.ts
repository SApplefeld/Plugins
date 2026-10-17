// memq-boundary.ts: the kit boundary, the persona module's four reaches into
// the kit plugin's own code. It locates the kit's install from the engine's
// installed_plugins.json, runs the kit's checkpoint command with its boundary
// verb at a compaction, runs node over a kit script, and runs the memq tool,
// with the stand-down and the once-a-day failure latch that govern those
// runs. hooks/index.ts holds the wiring alone: the deps each call takes, the
// spawn adapter and its session state, and the session fields these
// functions read and write.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts, so each of the four reaches
// takes a KitBoundaryDeps that hooks/index.ts builds over `$` at each call,
// and the session it reads and writes as a MemqSession. firstFailureToday
// takes neither: it reads the host clock itself, since the meter's latch in
// hooks/index.ts calls it with no deps. The module holds no state of
// its own, since the tick harness evaluates it once per process while it
// loads a fresh hooks/index.ts per case.

import type { ProcessRunInit, ProcessRunResult } from "claude-code";
import { LINE_TERMINATOR, type AgentState } from "./agent-state";
import { stripBom } from "./text";

// What the kit boundary reads of `$`: the module's one spawn, through which
// every child it starts goes, the absolute path a bare command name resolves
// to or null, the home directory, the two file reads and the clock.
export type KitBoundaryDeps = {
  run: (argv: readonly string[], init: ProcessRunInit) => Promise<ProcessRunResult>;
  executable: (name: string) => Promise<string | null>;
  home: () => Promise<unknown>;
  exists: (path: string) => Promise<unknown>;
  read: (path: string) => Promise<unknown>;
  now: () => number;
};

// The session fields the kit boundary reads and writes, which the session
// object in hooks/index.ts satisfies.
export type MemqSession = {
  mySessionId: string;
  memqLaunchDir: string;
  memqStandDownUntil: number;
  memqFailedDay: { start: string; timeout: string; unavailable: string };
  state: { decisions: AgentState["decisions"] };
};

// The kit plugin's key in the engine's installed_plugins.json, and how long
// its boundary command may run before $.process.run kills it and rejects.
export const KIT_PLUGIN_KEY = "grimoire@applefeld";
export const KIT_BOUNDARY_TIMEOUT_MS = 15_000;

// Where the kit plugin is installed: <home>/.claude/plugins/installed_plugins.json
// holds { plugins: { "grimoire@applefeld": [{ installPath, lastUpdated }, ...] } },
// and the record with the greatest lastUpdated is the build in use. The file is
// the engine's, so every shape miss (no home, no file, a read that fails, text
// that is not JSON, no plugins object, no key, a value that is not an array, an
// empty array, no record with a string installPath and a readable
// lastUpdated) returns a reason rather than throwing.
export async function boundaryKitInstallPathOf(deps: KitBoundaryDeps): Promise<{ installPath: string } | { skip: string }> {
  let home: unknown;
  try {
    home = await deps.home();
  } catch {
    home = undefined;
  }
  if (typeof home !== "string" || home.trim().length === 0) return { skip: "no home directory" };
  const file = `${home.trim().replace(/[/\\]+$/, "")}/.claude/plugins/installed_plugins.json`;
  let text: unknown;
  try {
    if (!(await deps.exists(file))) return { skip: "installed_plugins.json is absent" };
    text = await deps.read(file);
  } catch (err) {
    return { skip: `installed_plugins.json could not be read: ${String(err).slice(0, 150)}` };
  }
  if (typeof text !== "string") return { skip: "installed_plugins.json is not text" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch {
    return { skip: "installed_plugins.json is not JSON" };
  }
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const plugins = isObject(parsed) ? parsed.plugins : undefined;
  if (!isObject(plugins)) return { skip: "installed_plugins.json has no plugins object" };
  if (!Object.hasOwn(plugins, KIT_PLUGIN_KEY)) return { skip: `installed_plugins.json has no ${KIT_PLUGIN_KEY} key` };
  const records = plugins[KIT_PLUGIN_KEY];
  if (!Array.isArray(records)) return { skip: `${KIT_PLUGIN_KEY} is not an array` };
  if (records.length === 0) return { skip: `${KIT_PLUGIN_KEY} has no install record` };
  // A record without a string installPath or a readable lastUpdated is passed
  // over, so a stale or partial entry beside a good one still leaves the good
  // one to run; the run is skipped only when no record qualifies.
  let best: { installPath: string; at: number } | null = null;
  for (const record of records) {
    if (!isObject(record) || typeof record.installPath !== "string" || record.installPath.trim().length === 0) continue;
    const at = typeof record.lastUpdated === "string" ? Date.parse(record.lastUpdated) : NaN;
    if (Number.isNaN(at)) continue;
    if (best === null || at > best.at) best = { installPath: record.installPath.trim(), at };
  }
  if (best === null) return { skip: `no ${KIT_PLUGIN_KEY} record has an installPath and a readable lastUpdated` };
  return { installPath: best.installPath };
}

// Runs the kit's checkpoint command with its boundary verb for this session,
// which records the compaction marker the kit's own gate honors. The marker is
// keyed by session id under ~/.kit, so the child takes the session id in its
// environment and is handed no working directory. It still inherits the
// session's directory, where the kit may create its gitignored .kit/ scratch
// directory. Best-effort: every outcome is one
// decision and nothing throws. The decision carries the exit code and the
// first line the child wrote to stderr, because the command exits zero on a
// marker it could not position and says so only there. turnKind is what
// opened the turn that owed the bank, for the record only.
export async function boundaryBankCompactionBoundary(deps: KitBoundaryDeps, session: MemqSession, turnKind: string): Promise<void> {
  const sessionId = session.mySessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId === "pending") {
    session.state.decisions.push({
      timestamp: deps.now(),
      loop: "monitor",
      action: "compaction_boundary_skipped",
      detail: `no session id; turn ${turnKind}`,
    });
    return;
  }
  const located = await boundaryKitInstallPathOf(deps);
  if ("skip" in located) {
    session.state.decisions.push({
      timestamp: deps.now(),
      loop: "monitor",
      action: "compaction_boundary_skipped",
      detail: `${located.skip}; turn ${turnKind}`,
    });
    return;
  }
  const script = `${located.installPath.replace(/[/\\]+$/, "")}/hooks/kit-compact-checkpoint.js`;
  try {
    const res = await deps.run(["node", script, "boundary"], {
      env: { CLAUDE_CODE_SESSION_ID: sessionId },
      timeoutMs: KIT_BOUNDARY_TIMEOUT_MS,
    });
    const exitCode = res && typeof res.exitCode === "number" ? res.exitCode : null;
    const stderr = res && typeof res.stderr === "string" ? res.stderr : "";
    const firstStderr = (stderr.split(LINE_TERMINATOR).find((line: string) => line.trim() !== "") ?? "").trim().slice(0, 150);
    session.state.decisions.push({
      timestamp: deps.now(),
      loop: "monitor",
      action: exitCode === 0 ? "compaction_boundary_banked" : "compaction_boundary_failed",
      detail: `exit ${exitCode === null ? "unknown" : exitCode}; stderr: ${firstStderr || "none"}; turn ${turnKind}; ${script.slice(0, 150)}`,
    });
  } catch (err) {
    session.state.decisions.push({
      timestamp: deps.now(),
      loop: "monitor",
      action: "compaction_boundary_failed",
      detail: `run failed: ${String(err).slice(0, 150)}; turn ${turnKind}; ${script.slice(0, 150)}`,
    });
  }
}

// How long a read that ran past its bound, or that memq answered with one of
// its store-unavailable lines, keeps later reads from spawning memq. Every
// read in the window would otherwise pay its bound, or memq's own seconds of
// failed probing, against a store host that is down.
export const MEMQ_STAND_DOWN_MS = 60_000;

// How far short of its bound a rejection may land and still read as a
// timeout. A host timer can fire a little early against Date.now(), and a
// command that cannot start fails within milliseconds, far below any bound.
export const MEMQ_TIMEOUT_SLACK_MS = 100;

// The openings of the stderr lines memq recall-candidates prints, with
// nothing on stdout, when the store could not be read, each written by
// memq.js's reportHostUnread. A host that did not answer prints sqlcmd's own
// detail from memory-database.js's runBatch (`sqlcmd exited ...` or `could
// not run sqlcmd ...`) on the read that found it down, and hostDownDetail's
// `the memory database did not answer within the last ...` on a read inside
// memq's down-marker window; reportHostUnread's own `... did not answer this
// read` stands in for an empty detail. standDownText prints `no memory
// database is configured on this machine` and, with exit 0,
// redirectedRootText's sentence for a store root that is not the machine's
// own. kitMemq reads any of them as the
// `unavailable` cause on a read, whatever the exit code. A refusal, a spent
// budget, a cancelled call, a schema mismatch or an embedding server that
// did not answer is not a host to wait for, so none of those arms it.
// Exported so the suite pins each opening against the emitting source.
export const MEMQ_UNAVAILABLE_LINES: readonly string[] = Object.freeze([
  "memq: sqlcmd exited ",
  "memq: could not run sqlcmd",
  "memq: the memory database did not answer",
  "memq: no memory database is configured on this machine",
  "memq: this process is pointed at a store root",
]);

export type KitMemqResult = { exitCode: number | null; stdout: string; stderr: string };

// What a kitMemq caller passes beside the argv: the bound on the run, and the
// callback that receives the cause and reason of a run that did not reach an
// exit.
export type KitMemqOptions = { timeoutMs: number; onNotRun?: (cause: "start" | "timeout", reason: string) => void };

// Whether `cause` has not yet failed today, by the UTC day the latch holds
// for it, which moves to today. A failure logged behind it earns one
// decision per cause per UTC day. The latches are session memory, so a
// restart logs its first failure of the day again.
export function firstFailureToday<K extends string>(latch: Record<K, string>, cause: K): boolean {
  const day = new Date(Date.now()).toISOString().slice(0, 10);
  if (latch[cause] === day) return false;
  latch[cause] = day;
  return true;
}

// Runs node for this session with the arguments `argvOf` builds from the
// located kit install's root, in the launch directory kitMemq runs memq from,
// `node` resolved to an absolute path by the deps' executable first, so it
// never resolves from the launch directory, with the session id in the
// child's environment over the host's, so KIT_MEMORY_ROOT,
// KIT_MEMORY_ROOT_ALLOW_DATA and KIT_MEMORY_PROJECT reach the child
// unchanged. Resolves the child's result, a non-zero exit included, or the
// cause it did not run to an exit, kitMemq's two: `timeout` for a run that
// rejected once `timeoutMs`, less MEMQ_TIMEOUT_SLACK_MS, had passed since the
// spawn, and `start` for every other rejection and for no session id, no
// launch directory, no located kit install or no `node` on PATH, which spawn
// nothing. Logs nothing and throws nothing; the caller decides what a failure
// costs.
export async function boundaryKitNodeRun(
  deps: KitBoundaryDeps,
  session: MemqSession,
  argvOf: (kitRoot: string) => string[],
  timeoutMs: number,
): Promise<{ ran: KitMemqResult } | { cause: "start" | "timeout"; reason: string }> {
  const sessionId = session.mySessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId === "pending") return { cause: "start", reason: "no session id" };
  if (session.memqLaunchDir.length === 0) return { cause: "start", reason: "no launch directory" };
  const located = await boundaryKitInstallPathOf(deps);
  if ("skip" in located) return { cause: "start", reason: located.skip };
  const args = argvOf(located.installPath.replace(/[/\\]+$/, ""));
  const node = await deps.executable("node");
  if (node === null) return { cause: "start", reason: "node is on no absolute PATH entry" };
  const startedAt = deps.now();
  let res: any;
  try {
    res = await deps.run([node, ...args], {
      cwd: session.memqLaunchDir,
      env: { CLAUDE_CODE_SESSION_ID: sessionId },
      timeoutMs,
    });
  } catch (err) {
    const reason = (String(err).split(LINE_TERMINATOR).find((line: string) => line.trim() !== "") ?? "").trim();
    return { cause: deps.now() - startedAt >= timeoutMs - MEMQ_TIMEOUT_SLACK_MS ? "timeout" : "start", reason };
  }
  return {
    ran: {
      exitCode: res && typeof res.exitCode === "number" ? res.exitCode : null,
      stdout: res && typeof res.stdout === "string" ? res.stdout : "",
      stderr: res && typeof res.stderr === "string" ? res.stderr : "",
    },
  };
}

// Runs the kit's memq command with `argv` for this session, as
// node <installPath>/scripts/memq.js ...argv, through boundaryKitNodeRun, in
// the launch directory the first session.start captured rather than wherever
// $.session.cwd() stands now, so memq resolves the launch directory's store
// even after a bare cd in
// a tool call and a plugin reload after it, a reload of the plugin's code
// included, since session.start keeps that directory in $.state as well as
// in the session. Where $.state could not be read, a reload of the code
// captures the session's cwd at that start instead. The child takes the
// session id in its environment. Resolves the child's result, a non-zero exit
// included, for the caller to read, or null where the command did not run to
// an exit. Nothing throws.
//
// A null has one of two causes. `timeout` is a run that rejected once
// `timeoutMs`, less MEMQ_TIMEOUT_SLACK_MS, had passed since the spawn, since
// $.process.run's contract gives no cause for a rejection, so a start that
// itself takes that long also reads as a timeout. `start` is every other
// rejection, and also no session id, no launch directory, no located kit
// install or no `node` on PATH, which spawn nothing. `onNotRun`, where given,
// receives either cause and its reason as the null resolves, whatever the
// decision latch does. A third cause, `unavailable`, is a read that
// ran to an exit with an empty stdout and a stderr line opening one of
// MEMQ_UNAVAILABLE_LINES, memq's lines for a store it could not read; that
// result still resolves for the caller, who reads its exit code. Each cause
// logs one memq_spawn_failed decision per UTC day, carrying the first line of
// the reason, memq's own line for `unavailable`. The verb decides read or
// write, so no caller can mislabel one: a `recall-candidates` call is a read,
// the one the prompt waits on for its memory block, and a read that times
// out or is unavailable stands later reads down for MEMQ_STAND_DOWN_MS, a
// read inside that window resolving null with no spawn and no decision. No
// other stderr line arms it, since an empty answer is normal. Every other
// verb is treated as a write, which neither honours nor arms the stand-down,
// because a write skipped is a fact lost and a write costs the prompt
// nothing. The recall chain's body fetch, `get`,
// takes a third treatment, `fetch`: it honours an armed stand-down, so a
// store the prompt's own read found down costs the fetch no spawn, and it
// never arms one, since a fetch that fails costs one record its body and the
// chain renders that record as unfetched rather than withholding the block.
// A fetch inside the window resolves null, which the chain renders the same
// way. A fetch that fails earns no memq_spawn_failed decision and spends no
// latch either: the once-a-day latch stays the prompt's read's.
export async function boundaryKitMemq(
  deps: KitBoundaryDeps,
  session: MemqSession,
  argv: string[],
  { timeoutMs, onNotRun }: KitMemqOptions,
): Promise<KitMemqResult | null> {
  const verb = typeof argv[0] === "string" ? argv[0] : "none";
  const purpose: "read" | "fetch" | "write" = verb === "recall-candidates" ? "read"
    : verb === "get" ? "fetch" : "write";
  if (purpose !== "write" && session.memqStandDownUntil > deps.now()) return null;
  const failed = (cause: "start" | "timeout" | "unavailable", reason: string): null => {
    if (purpose === "fetch") return null;
    if (firstFailureToday(session.memqFailedDay, cause)) {
      session.state.decisions.push({
        timestamp: deps.now(),
        loop: "memory",
        action: "memq_spawn_failed",
        detail: `cause ${cause}; ${reason.slice(0, 150)}; verb ${verb}`,
      });
    }
    if (cause !== "start" && purpose === "read") session.memqStandDownUntil = deps.now() + MEMQ_STAND_DOWN_MS;
    return null;
  };
  const run = await boundaryKitNodeRun(deps, session, (kitRoot) => [`${kitRoot}/scripts/memq.js`, ...argv], timeoutMs);
  if ("cause" in run) {
    onNotRun?.(run.cause, run.reason);
    return failed(run.cause, run.reason);
  }
  const result = run.ran;
  if (purpose === "read" && result.stdout === "") {
    const unavailable = result.stderr.split(LINE_TERMINATOR).find((line: string) => MEMQ_UNAVAILABLE_LINES.some((opening) => line.startsWith(opening)));
    if (unavailable !== undefined) failed("unavailable", unavailable.trim());
  }
  return result;
}
