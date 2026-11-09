// hooks/kit-events.ts: the kit event stream's writer side. One JSON line per
// event lands in <home>/.claude/kit-events.jsonl, the file the Channels
// broker tails for its Workers board, through bin/kit-events-append.mjs,
// since the engine's file API has no append and a whole rewrite of a file six
// personas share would lose lines. The record is
// { ts, event, project, plan, session, detail }: ts the clock as ISO 8601
// with its Z, event one of the eleven kinds, project the session's working
// directory at its start, plan the entry's planPath as stored, session the session's own
// id, and detail only where the kind carries one. The script normalizes and
// caps every field, so this side hands it the values as they are.
//
// Three things live here. The emit spawns the script with the record on
// stdin, one promise chain per session so two emits never interleave and the
// file keeps the order the moments had. The diff compares the plan holders'
// statuses and open asks at a landed store write against a snapshot the
// session keeps in memory, and emits the five status kinds, ask-opened and
// ask-closed from the change, so a transition writer anywhere in the plugin
// is covered without an emit beside it: openLedgerAsk in ask-layer.ts runs
// before a write that may be refused and rolled back, and closeAsk in
// agent-state.ts is synchronous, edits the ledger before that write, and has
// seven callers. The Chapter advance's helper gates section-closed, which
// the turn-end body holds with the lead kinds until its write lands.
//
// The snapshot follows the session's hold on the persona. Wherever the
// session's state is replaced by a loaded or switched one, or its ownership
// flips, followKitEventsOwner reseeds it from the state now held with no emit,
// or marks it unseeded where the session is no longer the owner, so a
// promotion or a persona switch never replays the tree it took over.
//
// The stream is observability and never a decision input: no failure here
// throws into a caller, changes a store write or alters a tool's answer. A
// spawn that fails or overruns logs one kit_event_failed note naming the
// kind, re-armed by the next emit that lands and by each change of
// ownership, and the event is lost. The note goes through the deps' decide,
// a decision on the session's state, except on persist's commons yield,
// whose note goes to the yield log, since that state is already written and
// handed over.
//
// An overrunning append: the engine's declaration of $.process.run states the
// call rejects when the child is still running at timeoutMs, so the chain
// moves on at the bound and the event reads as failed. The declaration does
// not state that the host kills the child at that point, and runChild adds no
// kill of its own, so whether an overrunning node process is ended is
// unconfirmed. The script reads one record and makes one append, so an
// overrun means a blocked disk or a stalled node start.

import type { ProcessRunInit, ProcessRunResult } from "claude-code";
import { headPoints, planHolderOf, type AgentState, type GoalNode } from "./agent-state";
import { scrubText } from "./redactor";

export const KIT_EVENTS_FILENAME = "kit-events.jsonl";
export const KIT_EVENTS_SCRIPT = "bin/kit-events-append.mjs";
// How long one append may run before the host's run rejects and the emit
// reads it as failed. The caller awaits the chain's tail, so this bounds what
// a tool's answer or a turn's end waits on.
export const KIT_EVENT_TIMEOUT_MS = 5000;
// The script's cap on detail. The emit cuts every detail here, after its
// scrub, so the record names what the script will keep.
export const KIT_EVENT_DETAIL_MAX = 40;

export type KitEventKind =
  | "plan-queued" | "plan-started" | "section-closed" | "goal-complete" | "goal-blocked"
  | "waiting" | "ask-opened" | "ask-closed" | "pr-ready" | "paused" | "resumed";

export type KitEventRecord = {
  ts: string;
  event: KitEventKind;
  project: string;
  plan: string;
  session: string;
  detail?: string;
};

// What the emit reads of the session and the host, built over `$` in
// hooks/index.ts as the other deps there are.
export type KitEventDeps = {
  run: (argv: readonly string[], init: ProcessRunInit) => Promise<ProcessRunResult>;
  pluginRoot: () => string;
  home: () => Promise<unknown>;
  workdir: () => string;
  sessionId: () => string;
  now: () => number;
  decide: (action: string, detail: string) => void;
};

// The snapshot the diff reads and moves: the plan holders' statuses the last
// landed write showed, keyed by entry id, and the open asks on nodes under a
// plan holder, keyed by ask id, each holding the plan path of its node's
// holder as it stood when the ask was seen. An ask-closed emit reads the
// plan from here, since the goal_create route closes asks as it replaces the
// tree and the landed state no longer holds the node.
export type KitEventsSnapshot = {
  statuses: Map<string, GoalNode["status"]>;
  asks: Map<string, string>;
};

// The session's own memory of the stream: the snapshot, the tail of the
// spawn chain, and whether a failure has been logged since the last landed
// spawn. Never written to the store.
export type KitEventsState = KitEventsSnapshot & {
  seeded: boolean;
  chain: Promise<void>;
  failureLogged: boolean;
};

export function newKitEventsState(): KitEventsState {
  return { seeded: false, statuses: new Map(), asks: new Map(), chain: Promise.resolve(), failureLogged: false };
}

// What the diff and the seed read of a state: its tree and its ask ledger.
export type KitEventsTree = Pick<AgentState, "goals" | "asks">;

// The sink under a home directory, joined as the restart recap's spawn joins
// the plugin root to its script.
export function kitEventSinkOf(home: string): string {
  return `${home}/.claude/${KIT_EVENTS_FILENAME}`;
}

/**
 * Queues one event on the session's chain and returns the chain's tail, which
 * resolves once that event's spawn has landed or failed. Never rejects.
 *
 * Every event's detail passes here, so this is where it is scrubbed: a
 * pause's or a lead's reason is the model's own text and can carry a
 * secret. The whole detail is scrubbed with the redactor's scrubText before
 * the cut, so a value is judged whole and never cut past the shape the
 * detector reads. A fixed detail, `pr <n>`, `<n> of <m>` or an ask id,
 * passes the scrub unchanged.
 */
export function emitKitEvent(deps: KitEventDeps, events: KitEventsState, kind: KitEventKind, plan: string, detail?: string): Promise<void> {
  const record: KitEventRecord = {
    ts: new Date(deps.now()).toISOString(),
    event: kind,
    project: deps.workdir(),
    plan,
    session: deps.sessionId(),
  };
  if (detail !== undefined && detail !== "") record.detail = headPoints(scrubText(detail).text, KIT_EVENT_DETAIL_MAX);
  events.chain = events.chain.then(() => appendOne(deps, events, record)).catch(() => undefined);
  return events.chain;
}

// One spawn of the script. A home that cannot be read, a run that rejects,
// which is how the host reports a start failure and a timeout alike, and a
// non-zero exit, which the script never returns itself, all read as failed.
async function appendOne(deps: KitEventDeps, events: KitEventsState, record: KitEventRecord): Promise<void> {
  let failure: string | null = null;
  try {
    const home = await deps.home();
    if (typeof home !== "string" || home === "") {
      failure = "no home directory";
    } else {
      const res = await deps.run(
        ["node", `${deps.pluginRoot()}/${KIT_EVENTS_SCRIPT}`, kitEventSinkOf(home)],
        { stdin: JSON.stringify(record), timeoutMs: KIT_EVENT_TIMEOUT_MS },
      );
      const exitCode = res && typeof res.exitCode === "number" ? res.exitCode : null;
      if (exitCode !== 0) failure = `exit ${exitCode === null ? "unknown" : exitCode}`;
    }
  } catch (err) {
    failure = `run failed: ${headPoints(String(err), 150)}`;
  }
  if (failure === null) {
    events.failureLogged = false;
    return;
  }
  if (events.failureLogged) return;
  events.failureLogged = true;
  deps.decide("kit_event_failed", `${record.event} for ${headPoints(record.plan, 120)} was lost: ${failure}`);
}

// The plan holders: the entries carrying planPath. A task leaf under one has
// none and so never enters the snapshot, since the broker's per-plan fold
// keys on the plan and would read a leaf's completion as the plan's.
function holdersOf(state: Pick<AgentState, "goals">): GoalNode[] {
  return state.goals.filter((g) => typeof g.planPath === "string" && g.planPath !== "");
}

// The open asks on nodes under a plan holder, as [ask id, holder's plan
// path]. An ask whose node is gone or under no holder is left out, so it
// enters no snapshot and its close emits nothing.
function openAsksOf(state: KitEventsTree): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const entry of state.asks) {
    if (entry.status !== "open") continue;
    const node = state.goals.find((g) => g.id === entry.nodeId);
    const holder = node === undefined ? undefined : planHolderOf(state, node);
    if (holder?.planPath) pairs.push([entry.id, holder.planPath]);
  }
  return pairs;
}

/**
 * Seeds the snapshot from a loaded state with no emit, so a restart never
 * replays the tree or its open asks as events. followKitEventsOwner runs it
 * wherever the session takes ownership, before that ownership's first write.
 */
export function seedKitEvents(events: KitEventsState, state: KitEventsTree): void {
  events.statuses = new Map(holdersOf(state).map((g) => [g.id, g.status]));
  events.asks = new Map(openAsksOf(state));
  events.seeded = true;
}

/**
 * Moves the snapshot to the session's hold, with no emit: seeded from `state`
 * where the session owns the persona, unseeded where it does not. The
 * failure log re-arms on either side, so each span of ownership logs its own
 * first failed append, wherever the last span's note landed. Called
 * wherever the session's state is replaced by a loaded or switched one or its
 * ownership flips, after the new state and owner flag are in place, so the
 * next landed write diffs against the tree this session took over, never
 * against one it held before.
 */
export function followKitEventsOwner(events: KitEventsState, isOwner: boolean, state: KitEventsTree): void {
  events.failureLogged = false;
  if (isOwner) {
    seedKitEvents(events, state);
    return;
  }
  events.statuses = new Map();
  events.asks = new Map();
  events.seeded = false;
}

/**
 * Emits the status transitions a landed store write made on the plan holders
 * and the closes it made on their open asks, against the snapshot, and moves
 * the snapshot to what was written. Returns the chain's tail where the write
 * queued an event, else a resolved promise, so a write with no change never
 * waits on another write's events. Never rejects.
 *
 * Every path that makes the session an owner seeds the snapshot through
 * followKitEventsOwner first, so an unseeded snapshot here is a defensive
 * default only: it seeds from the written state and emits nothing.
 */
export function emitGoalDiff(deps: KitEventDeps, events: KitEventsState, state: KitEventsTree): Promise<void> {
  if (!events.seeded) {
    seedKitEvents(events, state);
    return Promise.resolve();
  }
  return emitGoalDiffFrom(deps, events, events, state);
}

/**
 * The diff over a given snapshot rather than the session's: emits the
 * transitions and ask closes `state` made against `snapshot` and moves that
 * snapshot to what was written, on the session's chain. The commons yield in
 * persist hands it the maps taken before the yield unseeded the session's,
 * so the change its own store write landed is emitted while the session's
 * snapshot stays unseeded for the next owner's reseed. Returns as
 * emitGoalDiff does.
 *
 * An ask open in the snapshot and closed or absent in `state` emits
 * ask-closed once, detail the ask's id, for the plan the snapshot holds. An
 * ask open in `state` under a plan holder and absent from the snapshot
 * emits ask-opened once, detail the ask's id, for the holder's plan, and
 * enters the snapshot. So an ask open at the seed emits nothing, an ask
 * opened and closed inside one write window emits neither, and an open
 * whose write was refused and rolled back is never an event.
 */
export function emitGoalDiffFrom(deps: KitEventDeps, events: KitEventsState, snapshot: KitEventsSnapshot, state: KitEventsTree): Promise<void> {
  const { statuses, asks } = snapshot;
  let queued = false;
  const emit = (kind: KitEventKind, plan: string, detail?: string) => {
    queued = true;
    emitKitEvent(deps, events, kind, plan, detail);
  };
  const seen = new Set<string>();
  for (const g of holdersOf(state)) {
    seen.add(g.id);
    const before = statuses.get(g.id);
    const after = g.status;
    if (before === after) continue;
    statuses.set(g.id, after);
    const plan = g.planPath as string;
    if (before === undefined) {
      emit("plan-queued", plan, g.pullRequest === undefined ? undefined : `pr ${g.pullRequest}`);
      if (after === "active") emit("plan-started", plan);
      continue;
    }
    if (after === "active" && before === "pending") emit("plan-started", plan);
    else if ((after === "active" || after === "pending") && before === "paused") emit("resumed", plan);
    else if (after === "paused") emit("paused", plan, g.blockedReason ?? "");
    else if (after === "complete") emit("goal-complete", plan);
  }
  // An entry the write no longer holds, folded to the history file or
  // dropped, leaves the snapshot, so the map is bounded by the tree.
  for (const id of [...statuses.keys()]) if (!seen.has(id)) statuses.delete(id);
  for (const [id, plan] of [...asks]) {
    const entry = state.asks.find((a) => a.id === id);
    if (entry !== undefined && entry.status === "open") continue;
    asks.delete(id);
    emit("ask-closed", plan, id);
  }
  for (const [id, plan] of openAsksOf(state)) {
    if (asks.has(id)) continue;
    asks.set(id, plan);
    emit("ask-opened", plan, id);
  }
  return queued ? events.chain : Promise.resolve();
}

/**
 * section-closed's detail for a plan document read with `chapters` Chapters
 * of `sections` sections, `<n> of <m>`, where that count is above the
 * `storedChapters` the holder carries; null where the count did not advance,
 * so an unchanged document emits nothing. The turn-end body stores the new
 * count and logs plan_progress under the same test.
 */
export function sectionClosedDetailOf(storedChapters: number, chapters: number, sections: number): string | null {
  return chapters > storedChapters ? `${chapters} of ${sections}` : null;
}
