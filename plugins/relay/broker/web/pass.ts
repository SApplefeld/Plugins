// The web surface's pass: the timer that runs the readers the views draw on, and the store of what
// each of them last read.
//
// The readers run here, on this surface's own timer, and never per request: the plans sweep opens up
// to 64 files per root, and two devices polling every few seconds would otherwise run it a dozen
// times a minute. The Discord board card runs the same readers on a timer of its own that exists only
// inside the Discord block; this one must outlive Discord, so the two share nothing.
//
// Each source keeps its own last good reading with the time it was read. A source whose read throws,
// or returns a reading it marks unusable, is recorded as held: the pass keeps the value it had and
// the views say so. One source failing never touches another, and never fails the pass or a request.
// A source that has never read well has a null value and is held until it does, which is every source
// before the first pass.
//
// Nothing a failed reader throws is logged or carried: an error can quote the path or the text it was
// reading. A source going from read to held is logged once, by name, and again only after it has read
// well in between.
import path from "node:path";
import { initialEventState, readEvents } from "../board/events.ts";
import type { EventReaderState, ReadEventsResult } from "../board/events.ts";
import { sweepArchivedPlans, sweepPlans, statPlanFile } from "../board/plans.ts";
import type {
  PlanDirectoryListing,
  PlanFailureReason,
  PlanParse,
  PlanReading,
  PlanSweep,
  SweepPlansOptions,
} from "../board/plans.ts";
import { HEARTBEAT_FILE_NAME, createQueueReader } from "../board/queues.ts";
import type { PersonaQueue } from "../board/queues.ts";
import { createRosterReader } from "../board/roster.ts";
import type { RosterPersona } from "../board/roster.ts";
import { EVENT_DRAIN_WINDOWS } from "../board/thread.ts";
import { createLedgerReader } from "../decisions/ledger.ts";
import type { LedgerReading } from "../decisions/ledger.ts";
import type { StateThresholds, ViewSignals } from "../discord/state.ts";
import type { SessionRecord } from "../registry.ts";
import { readUsage } from "../usage/cache.ts";
import type { UsageAccount, UsageReading } from "../usage/cache.ts";
import type { BrokerConfig } from "../config.ts";
import { SOURCES, blockedKeys, planIndex } from "./views.ts";
import type { PlansReading, QueueReading, Reading, Readings, SourceName } from "./views.ts";

/** What a read returns when it got no usable reading and threw nothing, so the source is held. */
export const UNREADABLE = Symbol("unreadable");

/** The reads one pass makes. Each is a seam a test replaces; `webPassSources` is production's. */
export type PassSources = {
  roster: () => readonly RosterPersona[];
  queues: (personas: readonly RosterPersona[]) => readonly PersonaQueue[];
  ledger: (personas: readonly RosterPersona[]) => readonly LedgerReading[];
  plans: () => PlansReading;
  events: (previous: EventReaderState, roots: readonly string[]) => ReadEventsResult;
  usage: () => UsageReading;
  /** Modification time of a persona's heartbeat file, null where there is none. */
  heartbeatAt: (workdir: string) => number | null;
};

export type WebPassConfig = Pick<
  BrokerConfig,
  | "host"
  | "staleAfterMs"
  | "boardProjects"
  | "boardCardRefreshMs"
  | "boardRosterPath"
  | "boardEventsPath"
  | "usageCacheRoot"
>;

export type WebPassOptions = {
  config: Pick<WebPassConfig, "host" | "staleAfterMs" | "boardProjects" | "boardCardRefreshMs">;
  sources: PassSources;
  thresholds: StateThresholds;
  /** The registry's records, read in-process on each request. */
  records: () => readonly SessionRecord[];
  signals: (record: SessionRecord) => ViewSignals;
  now?: () => number;
  log?: (message: string) => void;
  /** Injected so a test drives the interval without waiting on it. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

export type WebPass = {
  /** One pass over every source, now. */
  run: () => void;
  /** Runs one pass at once and begins the refresh. Calling it twice runs one timer, not two. */
  start: () => void;
  /** Clears the refresh timer. Passes are synchronous, so there is nothing to drain. */
  stop: () => void;
  /** The latest of every source with the registry read now, for the views. */
  readings: () => Readings;
};

type HeldParse = { parse: PlanParse; mtimeMs: number; sizeBytes: number };
type HeldFailure = { reason: PlanFailureReason; mtimeMs: number; sizeBytes: number };

/**
 * One sweep with the holds the Discord board card keeps (`broker/board/thread.ts`): a parse is handed
 * back only under the modification time and size it was read at, so an unchanged file costs a stat
 * and a changed one is read again; a failure and a directory listing are held on the same terms. A
 * file that fails to read or parse this pass keeps the parse held for it, so a plan caught mid-write
 * stays drawn from its last good text. The live and archive sweeps each take their own, so a name in
 * both folders never meets the other's hold.
 */
function heldSweep(
  sweep: (roots: readonly string[], options: SweepPlansOptions) => PlanSweep,
): (roots: readonly string[]) => PlanReading[] {
  let parses = new Map<string, HeldParse>();
  let failures = new Map<string, HeldFailure>();
  let listings = new Map<string, PlanDirectoryListing>();
  return (roots) => {
    const previousParses = parses;
    const previousFailures = failures;
    const previousListings = listings;
    const swept = sweep(roots, {
      heldParse: (file, mtimeMs, sizeBytes) => {
        const held = previousParses.get(file);
        return held === undefined || held.mtimeMs !== mtimeMs || held.sizeBytes !== sizeBytes ? undefined : held.parse;
      },
      heldFailure: (file, mtimeMs, sizeBytes) => {
        const failed = previousFailures.get(file);
        return failed === undefined || failed.mtimeMs !== mtimeMs || failed.sizeBytes !== sizeBytes
          ? undefined
          : failed.reason;
      },
      heldListing: (dir, mtimeMs) => {
        const listed = previousListings.get(dir);
        return listed === undefined || listed.mtimeMs !== mtimeMs
          ? undefined
          : { names: listed.names, dropped: listed.dropped };
      },
    });
    listings = new Map(swept.listings.map((listed): [string, PlanDirectoryListing] => [listed.dir, listed]));
    const keptParses = new Map<string, HeldParse>();
    const keptFailures = new Map<string, HeldFailure>();
    const readings: PlanReading[] = [];
    for (const reading of swept.readings) {
      keptParses.set(reading.path, { parse: reading, mtimeMs: reading.mtimeMs, sizeBytes: reading.sizeBytes });
      readings.push(reading);
    }
    for (const failure of swept.failures) {
      // A failure with no stat behind it is one whose stat is what failed: the next pass stats again.
      if (failure.stat !== undefined) {
        keptFailures.set(failure.path, {
          reason: failure.reason,
          mtimeMs: failure.stat.mtimeMs,
          sizeBytes: failure.stat.sizeBytes,
        });
      }
      const held = previousParses.get(failure.path);
      if (held === undefined) continue;
      keptParses.set(failure.path, held);
      readings.push({
        ...held.parse,
        root: failure.root,
        path: failure.path,
        stem: failure.stem,
        mtimeMs: held.mtimeMs,
        sizeBytes: held.sizeBytes,
      });
    }
    parses = keptParses;
    failures = keptFailures;
    return readings;
  };
}

/** The production reads, over the same readers and files the Discord board card reads. */
export function webPassSources(config: WebPassConfig, log: (message: string) => void): PassSources {
  // Unset roster path reads nothing, as the board card's default does.
  const roster =
    config.boardRosterPath === "" ? null : createRosterReader(config.boardRosterPath, { log });
  const queues = createQueueReader({ log });
  const ledger = createLedgerReader({ log });
  const live = heldSweep(sweepPlans);
  const archived = heldSweep(sweepArchivedPlans);
  return {
    roster: () => (roster === null ? [] : roster.read()),
    queues: (personas) => queues.read(personas),
    ledger: (personas) => ledger.read(personas),
    plans: () => ({ live: live(config.boardProjects), archived: archived(config.boardProjects) }),
    events: (previous, roots) => readEvents(previous, roots, { path: config.boardEventsPath }),
    usage: () => readUsage(config.usageCacheRoot === null ? {} : { root: config.usageCacheRoot }),
    heartbeatAt: (workdir) => statPlanFile(path.join(workdir, HEARTBEAT_FILE_NAME), true)?.mtimeMs ?? null,
  };
}

function sameRoots(left: readonly string[], right: readonly string[] | null): boolean {
  return right !== null && left.length === right.length && left.every((root, index) => root === right[index]);
}

export function createWebPass(options: WebPassOptions): WebPass {
  const { config, sources } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => {});
  const setTimer = options.setTimer ?? setInterval;
  const clearTimer = options.clearTimer ?? clearInterval;

  const roster: Reading<readonly RosterPersona[]> = { value: null, at: null };
  const queues: Reading<readonly QueueReading[]> = { value: null, at: null };
  const plans: Reading<PlansReading> = { value: null, at: null };
  const ledger: Reading<readonly LedgerReading[]> = { value: null, at: null };
  const events: Reading<EventReaderState> = { value: null, at: null };
  const usage: Reading<readonly UsageAccount[]> = { value: null, at: null };
  // Every source is held until it first reads well. The registry is read in-process at each request
  // and is never held.
  const held = new Set<SourceName>(SOURCES.filter((name) => name !== "registry"));
  const loggedHeld = new Set<SourceName>();
  // The time of the first pass that saw each queue entry blocked. It is not kept across a restart.
  const blockedSince = new Map<string, number>();

  // The event reader is incremental, so its state outlives one pass whether or not a pass read well.
  let eventState = initialEventState();
  let eventRoots: readonly string[] | null = null;
  let timer: NodeJS.Timeout | null = null;

  /** Runs one source's read; a throw or an unusable reading holds the source and keeps its value. */
  function attempt<T>(name: SourceName, slot: Reading<T>, at: number, read: () => T | typeof UNREADABLE): void {
    let value: T | typeof UNREADABLE;
    try {
      value = read();
    } catch {
      value = UNREADABLE;
    }
    if (value === UNREADABLE) {
      // The error is dropped unread: it can quote the path or the text the reader was holding.
      if (!loggedHeld.has(name)) log(`web pass: ${name} could not be read, the last good reading stands`);
      loggedHeld.add(name);
      held.add(name);
      return;
    }
    slot.value = value;
    slot.at = at;
    held.delete(name);
    loggedHeld.delete(name);
  }

  function readEventStream(personas: readonly RosterPersona[]): EventReaderState | typeof UNREADABLE {
    // A persona enabled since the last pass widens the root list, and an event for its folder already
    // stepped over under the narrower list would never be seen again: a changed list sends the stream
    // back to its start, keeping the events already kept, and drains several windows to catch up.
    const roots = [...config.boardProjects, ...personas.map((persona) => persona.workdir)];
    const reset = !sameRoots(roots, eventRoots);
    let state = reset ? { ...initialEventState(), latest: eventState.latest } : eventState;
    let unreadable = false;
    for (let step = 0; step < (reset ? EVENT_DRAIN_WINDOWS : 1); step += 1) {
      const result = sources.events(state, roots);
      unreadable = result.unreadable;
      const advanced = result.state.offset > state.offset;
      state = result.state;
      if (unreadable || !advanced) break;
    }
    eventState = state;
    // The list is recorded only once a drain read well, so a reset that read badly resets again.
    if (unreadable) return UNREADABLE;
    eventRoots = roots;
    return state;
  }

  function run(): void {
    const at = now();
    attempt("roster", roster, at, () => sources.roster());
    // A roster that failed this pass leaves the last good one for the sources that read per persona.
    // One that has never read well leaves none, and the sources that read per persona stay held,
    // unread and unlogged, until it does: the roster's own held line is the one that names the cause.
    const personas = roster.value;
    if (personas !== null) {
      attempt("queues", queues, at, () =>
        sources.queues(personas).map((queue) => ({ queue, heartbeatAt: sources.heartbeatAt(queue.workdir) })),
      );
      attempt("ledger", ledger, at, () => sources.ledger(personas));
    }
    attempt("plans", plans, at, () => sources.plans());
    if (plans.value !== null) planIndex(plans.value);
    if (personas !== null) attempt("events", events, at, () => readEventStream(personas));
    attempt("usage", usage, at, () => {
      const reading = sources.usage();
      return reading.available ? reading.accounts : UNREADABLE;
    });
    // Also the one run of the status rule over the queues: the views read its result for this reading.
    const blocked = new Set(blockedKeys(queues.value ?? [], events.value, at));
    for (const key of blocked) if (!blockedSince.has(key)) blockedSince.set(key, at);
    for (const key of [...blockedSince.keys()]) if (!blocked.has(key)) blockedSince.delete(key);
  }

  return {
    run,
    start() {
      if (timer !== null) return;
      timer = setTimer(run, config.boardCardRefreshMs);
      run();
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    readings() {
      return {
        now: now(),
        host: config.host,
        staleAfterMs: config.staleAfterMs,
        thresholds: options.thresholds,
        roots: config.boardProjects,
        records: options.records(),
        signals: options.signals,
        blockedSince: new Map(blockedSince),
        roster: { ...roster },
        queues: { ...queues },
        plans: { ...plans },
        ledger: { ...ledger },
        events: { ...events },
        usage: { ...usage },
        held: SOURCES.filter((name) => held.has(name)),
      };
    },
  };
}
