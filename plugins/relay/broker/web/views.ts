// The web surface's view models: four pure functions over one `Readings` object, each returning the
// JSON a page draws. Nothing here reads a file, a clock or the registry; the pass in `./pass.ts` holds
// the last good reading of each source and the request handler hands the latest of them in, so the
// same readings always answer the same views.
//
// Two kinds of fact meet in a view. A source's reading is as old as the pass that took it, and its
// `asOf` says when. A measure against the clock, such as a heartbeat's age or whether an account's
// numbers have gone stale, is taken here from `readings.now`, because a reading cached at the pass
// would age wrong between passes.
//
// A source that has never been read, or whose latest read failed with nothing good behind it, has a
// null value. A list drawn from it is empty and a count drawn from it is null, and the source is in
// `held` so the page can say "no reading yet".
import path from "node:path";
import { eventPlanName, planName } from "../board/card.ts";
import { comparablePath, initialEventState } from "../board/events.ts";
import type { EventReaderState } from "../board/events.ts";
import type { PlanReading } from "../board/plans.ts";
import type { PersonaQueue, QueueEntry, QueuePlanReading } from "../board/queues.ts";
import type { RosterPersona } from "../board/roster.ts";
import { personaStatus } from "../board/status.ts";
import type { PersonaStatus, StatusWord } from "../board/status.ts";
import type { AskEntry, LedgerReading } from "../decisions/ledger.ts";
import { DEFAULT_EXITED_AFTER_MS, DEFAULT_IDLE_AFTER_MS } from "../discord/config.ts";
import { deriveSurfaceState, toView } from "../discord/state.ts";
import type { StateThresholds, SurfaceState, ViewSignals } from "../discord/state.ts";
import { liveByLineage } from "../registry.ts";
import type { SessionRecord } from "../registry.ts";
import type { UsageAccount } from "../usage/cache.ts";
import { PACE_PERIOD_MS } from "../usage/card.ts";
import { foldRootName } from "./config.ts";
import { EMPTY_MARKS, planMarkKey } from "./watermarks.ts";
import type { Marks } from "./watermarks.ts";

/** The sources a view draws from, in the order `asOf` and `held` list them. */
export const SOURCES = ["registry", "roster", "queues", "plans", "ledger", "events", "usage"] as const;
export type SourceName = (typeof SOURCES)[number];

/** One source's last good value and when it was read; both null until a read has succeeded. */
export type Reading<T> = { value: T | null; at: number | null };

/** One roster persona's queue with the modification time of its heartbeat file. */
export type QueueReading = { queue: PersonaQueue; heartbeatAt: number | null };

/** The plans swept under the configured roots: the live ones, and those filed in the archive. */
export type PlansReading = { live: readonly PlanReading[]; archived: readonly PlanReading[] };

export type Readings = {
  /** The request's clock. Every age in a view is taken against it. */
  now: number;
  /** `CHANNEL_HOST_NAME`. */
  host: string;
  /** `CHANNEL_STALE_AFTER_MS`: a heartbeat younger than this is fresh. */
  staleAfterMs: number;
  thresholds: StateThresholds;
  /** `CHANNEL_BOARD_PROJECTS`, as configured. */
  roots: readonly string[];
  /** The registry's records, read in-process for this request. */
  records: readonly SessionRecord[];
  /** The signals no record carries, per record, as the Discord surfaces take them. */
  signals: (record: SessionRecord) => ViewSignals;
  /**
   * When the pass first saw each blocked queue entry blocked, in epoch milliseconds, keyed by
   * `blockKey`. No reader carries a block's start for a store or lead block, so this is the time of
   * the first pass that saw it, and it is lost when the broker restarts.
   */
  blockedSince: ReadonlyMap<string, number>;
  /** The operator's caught-up times and seen snapshots; absent reads as none set. */
  marks?: Marks;
  roster: Reading<readonly RosterPersona[]>;
  queues: Reading<readonly QueueReading[]>;
  plans: Reading<PlansReading>;
  ledger: Reading<readonly LedgerReading[]>;
  events: Reading<EventReaderState>;
  usage: Reading<readonly UsageAccount[]>;
  /** The sources whose latest read failed, in `SOURCES` order. */
  held: readonly SourceName[];
};

export type AsOf = Record<SourceName, string | null>;

export type RepoState = "asking" | "blocked" | "stalled" | "working" | "idle" | "dormant";

export type Item = {
  kind: "ask" | "blocked" | "hands";
  repo: string | null;
  text: string;
  recommend: string | null;
  blocking: boolean;
  openedAt: string | null;
  planPath: string | null;
  askId: string | null;
};

export type Worker = {
  lineage: string;
  surfaceState: SurfaceState | null;
  lastTurnAt: string | null;
  leaseOpen: false;
};

export type RepoRow = {
  name: string;
  state: RepoState;
  queueDepth: number;
  worker: Worker;
  unseen: number;
  lastDoneAt: string | null;
  oldestOpenAt: string | null;
  asOf: AsOf;
  held: readonly SourceName[];
};

/** A plan as a row. A queue entry whose plan is in no swept root has null root, path and counts. */
export type PlanRow = {
  root: string | null;
  path: string | null;
  title: string;
  status: string | null;
  section: number | null;
  sectionCount: number | null;
  next: string | null;
  changedAt: string | null;
  prState: null;
  serves: null;
};

export type HealthLine = {
  expected: number | null;
  reporting: number | null;
  holes: number;
  hands: number;
  held: number;
};

export type StandupView = {
  sandbox: string;
  heading: null;
  needsYou: Item[];
  rollout: null;
  repos: RepoRow[];
  shared: null;
  health: HealthLine;
  asOf: AsOf;
  held: readonly SourceName[];
};

export type RepoView = {
  name: string;
  heading: null;
  rollout: null;
  changed: PlanRow[] | null;
  upNext: PlanRow[];
  worker: Worker;
  unseenSince: string | null;
  asOf: AsOf;
  held: readonly SourceName[];
};

export type PlanView = {
  root: string;
  path: string;
  title: string;
  status: string;
  goal: string | null;
  brief: null;
  sections: { number: number; name: string; done: boolean }[];
  chapters: { number: number; completed: string | null; next: string | null }[];
  next: string | null;
  openAsks: Item[];
  asOf: AsOf;
  held: readonly SourceName[];
};

export type Hole = { name: string; reason: "no-heartbeat" | "stale-heartbeat" };

export type SessionLine = {
  name: string;
  lineage: string | null;
  surfaceState: SurfaceState;
  idleFor: number;
};

export type WindowLine = { pct: number; resetsAt: string | null };

export type AccountLine = {
  number: number;
  email: string | null;
  organizationName: string | null;
  active: boolean;
  fiveHour: WindowLine | null;
  sevenDay: WindowLine | null;
  spend: UsageAccount["spend"];
  scoped: (WindowLine & { name: string })[];
  fetchedAt: string | null;
  consecutiveFailures: number;
  failing: boolean;
  backoffUntil: string | null;
  /** The window with the highest percentage among the five-hour, the seven-day and `Fable`. */
  binding: (WindowLine & { name: string }) | null;
  /** The share of the binding window already elapsed, from its reset time and its length. */
  elapsedPct: number | null;
};

export type HealthView = {
  expected: number | null;
  reporting: number | null;
  holes: Hole[];
  sessions: SessionLine[];
  kit: null;
  capacity: AccountLine[];
  verdict: null;
  hands: Item[];
  asOf: AsOf;
  held: readonly SourceName[];
};

/** A persona whose heartbeat is older than this, or absent, and which has nothing queued is dormant. */
export const DORMANT_AFTER_MS = 24 * 60 * 60 * 1000;

/** An account whose numbers were fetched longer ago than this needs signing in again. */
export const ACCOUNT_STALE_MS = 60 * 60 * 1000;

/** A plan counts as changed when its file moved inside this window, until a watermark replaces it. */
export const CHANGED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The windows a session line's state is derived under when Discord is not configured, which are the
 * Discord surfaces' own defaults, so a session reads the same on either surface.
 */
export const DEFAULT_THRESHOLDS: StateThresholds = {
  idleAfterMs: DEFAULT_IDLE_AFTER_MS,
  exitedAfterMs: DEFAULT_EXITED_AFTER_MS,
};

/** The sentence a blocked item carries where its source gave no reason. */
export const BLOCKED_FALLBACK_TEXT = "Run stopped needing a person";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const FABLE_WINDOW = "Fable";

const ARCHIVE_DIR = "docs/archive/plans/";
const PLANS_DIR = "docs/plans/";

function iso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function asOf(readings: Readings): AsOf {
  return {
    registry: iso(readings.now),
    roster: iso(readings.roster.at),
    queues: iso(readings.queues.at),
    plans: iso(readings.plans.at),
    ledger: iso(readings.ledger.at),
    events: iso(readings.events.at),
    usage: iso(readings.usage.at),
  };
}

/** The name `root` goes by in a request: the last segment of the configured path. */
export function rootName(root: string): string {
  return path.basename(root);
}

/** Whether two paths name one folder, by the comparison the event join and the root list use. */
function sameFolder(left: string, right: string): boolean {
  return comparablePath(path.resolve(left)) === comparablePath(path.resolve(right));
}

/** The key `blockedSince` holds a queue entry under. */
export function blockKey(persona: string, entryId: string): string {
  return JSON.stringify([persona, entryId]);
}

/** Whether the status rule calls an entry blocked: the one test the views and the pass share. */
function isBlocked(entry: { word: StatusWord }): boolean {
  return entry.word === "blocked";
}

/**
 * The keys of the queue entries the status rule calls blocked, so the pass can time them with the
 * rule the views apply and no copy of it.
 */
export function blockedKeys(queues: readonly QueueReading[], events: EventReaderState | null, now: number): string[] {
  const statuses = statusesOf(queues, events, now);
  return queues.flatMap(({ queue }) =>
    (statuses.get(queue)?.entries ?? []).filter(isBlocked).map((entry) => blockKey(queue.name, entry.id)),
  );
}

type Statuses = { events: EventReaderState | null; byQueue: ReadonlyMap<PersonaQueue, PersonaStatus> };
const statusMemo = new WeakMap<readonly QueueReading[], Statuses>();

/**
 * The status of every queue in a queues reading, computed once for that reading and the events it was
 * read with: the pass calls this when it takes the reading, and a request finds the result held. A
 * status word turns on the kept events and the queue alone, and `now` reaches a word only to cap an
 * event's own timestamp, so the reading's time stands for the request's for every view that reads the
 * words. The worker line a status also carries is as of the pass. The events are compared by identity,
 * which holds because the event reader hands back a new state for every read and never changes one.
 */
export function statusesOf(
  queues: readonly QueueReading[],
  events: EventReaderState | null,
  now: number,
): ReadonlyMap<PersonaQueue, PersonaStatus> {
  const held = statusMemo.get(queues);
  if (held !== undefined && held.events === events) return held.byQueue;
  const state = events ?? initialEventState();
  const byQueue = new Map(queues.map(({ queue }) => [queue, personaStatus(queue, state, now)] as const));
  statusMemo.set(queues, { events, byQueue });
  return byQueue;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

export type StateInput = {
  /** Open asks the ledger holds for the persona. */
  openAsks: number;
  /** The status word of each of the persona's queue entries. */
  words: readonly StatusWord[];
  /** Modification time of the persona's heartbeat file, null when there is none. */
  heartbeatAt: number | null;
  now: number;
};

/**
 * The state of one repo, the first that holds in this order: an open ask, a blocked entry, a
 * stalled one, one in flight; otherwise idle, or dormant when the heartbeat is older than a day or
 * absent and nothing is up next or queued. An open ask outranks everything, a dormant-looking
 * persona included, because the operator owes it an answer whatever the worker is doing.
 */
export function repoState(input: StateInput): RepoState {
  if (input.openAsks > 0) return "asking";
  if (input.words.includes("blocked")) return "blocked";
  if (input.words.includes("stalled")) return "stalled";
  if (input.words.includes("in flight")) return "working";
  const waiting = input.words.some((word) => word === "up next" || word === "queued");
  const cold = input.heartbeatAt === null || input.now - input.heartbeatAt > DORMANT_AFTER_MS;
  return cold && !waiting ? "dormant" : "idle";
}

// ---------------------------------------------------------------------------------------------
// The fleet: one record per roster persona, joined once per view
// ---------------------------------------------------------------------------------------------

type Repo = {
  persona: RosterPersona;
  queue: PersonaQueue | null;
  heartbeatAt: number | null;
  status: PersonaStatus | null;
  asks: readonly AskEntry[];
  record: SessionRecord | null;
  state: RepoState;
};

function fleet(readings: Readings): Repo[] {
  const personas = readings.roster.value;
  if (personas === null) return [];
  const statuses = statusesOf(readings.queues.value ?? [], readings.events.value, readings.now);
  return personas.map((persona) => {
    const held = readings.queues.value?.find(
      (item) => item.queue.name === persona.name && item.queue.workdir === persona.workdir,
    );
    const queue = held?.queue ?? null;
    const status = queue === null ? null : (statuses.get(queue) ?? null);
    const asks = readings.ledger.value?.find((item) => item.name === persona.name)?.open ?? [];
    const heartbeatAt = held?.heartbeatAt ?? null;
    return {
      persona,
      queue,
      heartbeatAt,
      status,
      asks,
      record: liveByLineage(readings.records, persona.name),
      state: repoState({
        openAsks: asks.length,
        words: status?.entries.map((entry) => entry.word) ?? [],
        heartbeatAt,
        now: readings.now,
      }),
    };
  });
}

function workerOf(readings: Readings, repo: Repo): Worker {
  let surfaceState: SurfaceState | null = null;
  if (repo.record !== null) {
    const view = toView(repo.record, readings.signals(repo.record));
    surfaceState = deriveSurfaceState(view, readings.now, readings.thresholds);
  }
  return {
    lineage: repo.persona.name,
    surfaceState,
    lastTurnAt: iso(repo.queue?.lastTurnComplete),
    leaseOpen: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

type FoundPlan = { reading: PlanReading; dir: string; rel: string };

/** The swept plans keyed each way a view looks one up, so a request does lookups and no walk. */
export type PlanIndex = {
  /** By the folder a plan's root names, as `folderKey` writes it. */
  byRoot: ReadonlyMap<string, readonly FoundPlan[]>;
  /** By the plan file's path, as `folderKey` writes it. */
  byFile: ReadonlyMap<string, FoundPlan>;
  /** By the root's folded name and the plan's relative path, the first sweep order winning. */
  byName: ReadonlyMap<string, FoundPlan>;
};

const planIndexMemo = new WeakMap<PlansReading, PlanIndex>();
const rootsMemo = new WeakMap<readonly string[], ReadonlySet<string>>();

function folderKey(folder: string): string {
  return comparablePath(path.resolve(folder));
}

function nameKey(rootFolder: string, rel: string): string {
  return JSON.stringify([foldRootName(rootName(rootFolder)), rel]);
}

/**
 * The index of one plans reading, built the first time it is asked for and held for as long as the
 * reading is. The pass asks when it takes a reading, so a request finds it built.
 */
export function planIndex(plans: PlansReading): PlanIndex {
  const held = planIndexMemo.get(plans);
  if (held !== undefined) return held;
  const byRoot = new Map<string, FoundPlan[]>();
  const byFile = new Map<string, FoundPlan>();
  const byName = new Map<string, FoundPlan>();
  const add = (dir: string) => (reading: PlanReading) => {
    const plan: FoundPlan = { reading, dir, rel: dir + path.basename(reading.path) };
    const key = folderKey(reading.root);
    const list = byRoot.get(key);
    if (list === undefined) byRoot.set(key, [plan]);
    else list.push(plan);
    byFile.set(folderKey(reading.path), plan);
    const named = nameKey(reading.root, plan.rel);
    if (!byName.has(named)) byName.set(named, plan);
  };
  plans.live.forEach(add(PLANS_DIR));
  plans.archived.forEach(add(ARCHIVE_DIR));
  const built = { byRoot, byFile, byName };
  planIndexMemo.set(plans, built);
  return built;
}

const NO_PLANS: PlanIndex = { byRoot: new Map(), byFile: new Map(), byName: new Map() };

function indexOf(readings: Readings): PlanIndex {
  return readings.plans.value === null ? NO_PLANS : planIndex(readings.plans.value);
}

/** Whether some configured root is this folder: the join of a plan to a repo, and its absence. */
function rootMatches(readings: Readings, workdir: string): boolean {
  let keys = rootsMemo.get(readings.roots);
  if (keys === undefined) {
    keys = new Set(readings.roots.map(folderKey));
    rootsMemo.set(readings.roots, keys);
  }
  return keys.has(folderKey(workdir));
}

function plansOf(readings: Readings, workdir: string): readonly FoundPlan[] {
  return indexOf(readings).byRoot.get(folderKey(workdir)) ?? [];
}

function planRow(plan: FoundPlan): PlanRow {
  const { reading } = plan;
  return {
    root: rootName(reading.root),
    path: plan.rel,
    title: reading.stem,
    status: reading.status,
    section: reading.chapterList.length,
    sectionCount: reading.sections,
    next: reading.next,
    changedAt: iso(reading.mtimeMs),
    prState: null,
    serves: null,
  };
}

/** The row for a queue entry: its swept plan where the path joins one, else what the queue holds. */
function entryRow(
  entry: QueueEntry,
  reading: QueuePlanReading | undefined,
  swept: ReadonlyMap<string, FoundPlan>,
): PlanRow {
  const joined = reading === undefined ? undefined : swept.get(folderKey(reading.path));
  if (joined !== undefined) return planRow(joined);
  const parsed = reading !== undefined && !reading.archived ? reading : null;
  return {
    root: null,
    path: null,
    title: entry.title,
    status: parsed?.status ?? null,
    section: entry.chapterCount ?? null,
    sectionCount: entry.sectionCount ?? null,
    next: entry.nextSection ?? null,
    changedAt: iso(parsed?.mtimeMs),
    prState: null,
    serves: null,
  };
}

function planRelative(reading: QueuePlanReading): string {
  return (reading.archived ? ARCHIVE_DIR : PLANS_DIR) + path.basename(reading.path);
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

/** The absolute path an ask's plan names, read against the repo's folder, or null where it names none. */
function askPlanFile(workdir: string, ask: AskEntry): string | null {
  return ask.planPath === null ? null : path.resolve(workdir, ask.planPath);
}

/** `file` as a forward-slash path under `workdir`, or null where it lies outside that folder. */
function relativeUnder(workdir: string, file: string): string | null {
  const relative = path.relative(workdir, file);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join("/");
}

function askItem(repo: Repo, ask: AskEntry): Item {
  const file = askPlanFile(repo.persona.workdir, ask);
  return {
    kind: "ask",
    repo: repo.persona.name,
    text: ask.question,
    recommend: ask.recommend,
    blocking: ask.blocking === true,
    openedAt: iso(ask.openedAt),
    planPath: file === null ? null : relativeUnder(repo.persona.workdir, file),
    askId: ask.id,
  };
}

/** When the kit last reported the run on this entry's plan blocked, or null where it has not. */
function blockEventAt(
  events: EventReaderState,
  workdir: string,
  reading: QueuePlanReading | undefined,
): number | null {
  if (reading === undefined || reading.archived) return null;
  const wanted = comparablePath(workdir);
  const name = planName(reading.stem);
  let latest: number | null = null;
  for (const event of events.latest.values()) {
    if (event.event !== "goal-blocked") continue;
    if (comparablePath(event.root) !== wanted || eventPlanName(event.plan) !== name) continue;
    const at = Date.parse(event.ts);
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

type BlockedEntry = { repo: string; title: string; reason: string | null; item: Item };

/**
 * The blocked queue entries of one repo, each with the item that stands for it. An entry is blocked
 * where `personaStatus` gives it the word blocked, and the reason is the one `personaStatus` carries
 * for it, so the item and the card cannot disagree. The block's start is the kit event's time where
 * one names the plan, else the time the pass first saw the entry blocked, else null.
 */
function blockedEntries(readings: Readings, repo: Repo): BlockedEntry[] {
  if (repo.queue === null || repo.status === null) return [];
  const queue = repo.queue;
  const events = readings.events.value ?? initialEventState();
  const entries = new Map(queue.entries.map((entry) => [entry.id, entry]));
  const found: BlockedEntry[] = [];
  for (const status of repo.status.entries) {
    if (!isBlocked(status)) continue;
    const reading = queue.readings.get(status.id);
    const at =
      blockEventAt(events, queue.workdir, reading) ??
      readings.blockedSince.get(blockKey(repo.persona.name, status.id)) ??
      null;
    found.push({
      repo: repo.persona.name,
      title: entries.get(status.id)?.title ?? "",
      reason: status.reason,
      item: {
        kind: "blocked",
        repo: repo.persona.name,
        text: status.reason ?? BLOCKED_FALLBACK_TEXT,
        recommend: null,
        blocking: true,
        openedAt: iso(at),
        planPath: reading === undefined ? null : planRelative(reading),
        askId: null,
      },
    });
  }
  return found;
}

function handsItems(readings: Readings, repos: readonly Repo[]): Item[] {
  const items: Item[] = [];
  for (const repo of repos) {
    for (const blocked of blockedEntries(readings, repo)) {
      if (blocked.reason === null || !blocked.reason.toLowerCase().includes("operator")) continue;
      items.push({
        kind: "hands",
        repo: repo.persona.name,
        text: `Queue entry ${blocked.title} waits on your yes`,
        recommend: null,
        blocking: false,
        openedAt: blocked.item.openedAt,
        planPath: null,
        askId: null,
      });
    }
  }
  for (const account of readings.usage.value ?? []) {
    const stale = account.fetchedAt === null || readings.now - account.fetchedAt > ACCOUNT_STALE_MS;
    if (!account.failing && !stale) continue;
    items.push({
      kind: "hands",
      repo: null,
      text: `Account ${account.email ?? `#${String(account.number)}`} needs sign-in`,
      recommend: null,
      blocking: false,
      openedAt: iso(account.fetchedAt),
      planPath: null,
      askId: null,
    });
  }
  return items;
}

function needsYou(readings: Readings, repos: readonly Repo[]): Item[] {
  const asks = repos.flatMap((repo) => repo.asks.map((ask) => askItem(repo, ask)));
  const blocked = repos.flatMap((repo) => blockedEntries(readings, repo).map((entry) => entry.item));
  return [...asks, ...blocked, ...handsItems(readings, repos)];
}

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

function holesOf(readings: Readings, repos: readonly Repo[]): Hole[] {
  const holes: Hole[] = [];
  for (const repo of repos) {
    const fresh = repo.heartbeatAt !== null && readings.now - repo.heartbeatAt < readings.staleAfterMs;
    if (fresh || repo.record !== null) continue;
    holes.push({
      name: repo.persona.name,
      reason: repo.heartbeatAt === null ? "no-heartbeat" : "stale-heartbeat",
    });
  }
  return holes;
}

function windowLine(value: { pct: number; resetsAt: number | null }): WindowLine {
  return { pct: value.pct, resetsAt: iso(value.resetsAt) };
}

function accountLine(account: UsageAccount, now: number): AccountLine {
  const candidates: { name: string; length: number; pct: number; resetsAt: number | null }[] = [];
  if (account.fiveHour !== null) candidates.push({ name: "five_hour", length: FIVE_HOURS_MS, ...account.fiveHour });
  if (account.sevenDay !== null) candidates.push({ name: "seven_day", length: PACE_PERIOD_MS, ...account.sevenDay });
  const fable = account.scoped.find((scoped) => scoped.name === FABLE_WINDOW);
  if (fable !== undefined) candidates.push({ ...fable, length: PACE_PERIOD_MS });
  // Strictly higher wins, so a tie goes to the shorter window listed first.
  let binding: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (binding === null || candidate.pct > binding.pct) binding = candidate;
  }
  let elapsedPct: number | null = null;
  if (binding !== null && binding.resetsAt !== null) {
    const elapsed = ((binding.length - (binding.resetsAt - now)) / binding.length) * 100;
    elapsedPct = Math.round(Math.min(Math.max(elapsed, 0), 100) * 10) / 10;
  }
  return {
    number: account.number,
    email: account.email,
    organizationName: account.organizationName,
    active: account.active,
    fiveHour: account.fiveHour === null ? null : windowLine(account.fiveHour),
    sevenDay: account.sevenDay === null ? null : windowLine(account.sevenDay),
    spend: account.spend,
    scoped: account.scoped.map((scoped) => ({ name: scoped.name, ...windowLine(scoped) })),
    fetchedAt: iso(account.fetchedAt),
    consecutiveFailures: account.consecutiveFailures,
    failing: account.failing,
    backoffUntil: iso(account.backoffUntil),
    binding: binding === null ? null : { name: binding.name, ...windowLine(binding) },
    elapsedPct,
  };
}

function sessionLine(readings: Readings, record: SessionRecord): SessionLine {
  const view = toView(record, readings.signals(record));
  return {
    name: view.name ?? view.title ?? view.lineage ?? view.sessionId,
    lineage: view.lineage,
    surfaceState: deriveSurfaceState(view, readings.now, readings.thresholds),
    idleFor: Math.max(0, readings.now - view.lastHookAt),
  };
}

// ---------------------------------------------------------------------------------------------
// The four views
// ---------------------------------------------------------------------------------------------

function healthLine(readings: Readings, repos: readonly Repo[], hands: number): HealthLine {
  const holes = holesOf(readings, repos).length;
  const known = readings.roster.value !== null;
  return {
    expected: known ? repos.length : null,
    reporting: known ? repos.length - holes : null,
    holes,
    hands,
    held: readings.held.length,
  };
}

function oldestOpen(items: readonly Item[], repo: string): string | null {
  let oldest: number | null = null;
  for (const item of items) {
    if (item.repo !== repo || item.kind === "hands" || item.openedAt === null) continue;
    const at = Date.parse(item.openedAt);
    if (oldest === null || at < oldest) oldest = at;
  }
  return iso(oldest);
}

function lastDone(readings: Readings, workdir: string): string | null {
  let latest: number | null = null;
  for (const plan of plansOf(readings, workdir)) {
    if (!plan.reading.terminal) continue;
    if (latest === null || plan.reading.mtimeMs > latest) latest = plan.reading.mtimeMs;
  }
  return iso(latest);
}

/**
 * When a repo's unseen window opens: its caught-up time, or a day before the request where the
 * operator has not caught it up. The one instant `unseen`, `changed` and `unseenSince` share.
 */
function sinceOf(readings: Readings, repo: Repo): { since: number; caughtUpAt: number | null } {
  const caughtUpAt = (readings.marks ?? EMPTY_MARKS).repos.get(repo.persona.name) ?? null;
  return { since: caughtUpAt ?? readings.now - CHANGED_WINDOW_MS, caughtUpAt };
}

/**
 * What the operator has not looked at in one repo: plans modified after the window opened whose status
 * or chapter count differs from the snapshot the operator took, or that have none, plus open asks
 * filed after it. A seen plan with the same status and chapter count is not counted again however
 * often its file is touched.
 */
function unseenOf(readings: Readings, repo: Repo): number {
  const { since } = sinceOf(readings, repo);
  const seen = (readings.marks ?? EMPTY_MARKS).plans;
  let count = repo.asks.filter((ask) => ask.openedAt !== null && ask.openedAt > since).length;
  for (const plan of plansOf(readings, repo.persona.workdir)) {
    if (plan.reading.mtimeMs <= since) continue;
    const mark = seen.get(planMarkKey(rootName(plan.reading.root), plan.rel));
    if (
      mark === undefined ||
      mark.status !== plan.reading.status ||
      mark.chapters !== plan.reading.chapterList.length
    ) {
      count += 1;
    }
  }
  return count;
}

function queueDepth(repo: Repo): number {
  return (
    repo.status?.entries.filter((entry) => entry.word === "up next" || entry.word === "queued").length ?? 0
  );
}

export function standupView(readings: Readings): StandupView {
  const repos = fleet(readings);
  const items = needsYou(readings, repos);
  return {
    sandbox: readings.host,
    heading: null,
    needsYou: items,
    rollout: null,
    repos: repos.map((repo) => ({
      name: repo.persona.name,
      state: repo.state,
      queueDepth: queueDepth(repo),
      worker: workerOf(readings, repo),
      unseen: unseenOf(readings, repo),
      lastDoneAt: lastDone(readings, repo.persona.workdir),
      oldestOpenAt: oldestOpen(items, repo.persona.name),
      asOf: asOf(readings),
      held: readings.held,
    })),
    shared: null,
    health: healthLine(readings, repos, items.filter((item) => item.kind === "hands").length),
    asOf: asOf(readings),
    held: readings.held,
  };
}

/** The view of one roster entry, or null when no entry is called `name`. */
export function repoView(readings: Readings, name: string): RepoView | null {
  const repo = fleet(readings).find((candidate) => candidate.persona.name === name);
  if (repo === undefined) return null;
  const { workdir } = repo.persona;
  const { since, caughtUpAt } = sinceOf(readings, repo);

  // A repo whose folder no configured root names carries no plan list, since nothing was swept for it.
  let changed: PlanRow[] | null = null;
  if (rootMatches(readings, workdir) && readings.plans.value !== null) {
    changed = plansOf(readings, workdir)
      .filter((plan) => plan.reading.mtimeMs > since)
      .sort((left, right) => right.reading.mtimeMs - left.reading.mtimeMs)
      .map(planRow);
  }

  const swept = indexOf(readings).byFile;
  const queue = repo.queue;
  const upNext: PlanRow[] = [];
  if (queue !== null && repo.status !== null) {
    const entries = new Map(queue.entries.map((entry) => [entry.id, entry]));
    for (const status of repo.status.entries) {
      if (status.word !== "up next" && status.word !== "queued") continue;
      const entry = entries.get(status.id);
      if (entry !== undefined) upNext.push(entryRow(entry, queue.readings.get(status.id), swept));
    }
  }

  return {
    name: repo.persona.name,
    heading: null,
    rollout: null,
    changed,
    upNext,
    worker: workerOf(readings, repo),
    unseenSince: iso(caughtUpAt),
    asOf: asOf(readings),
    held: readings.held,
  };
}

/** The view of one swept plan, or null when no plan under that root name has that relative path. */
export function planView(readings: Readings, root: string, relativePath: string): PlanView | null {
  const plan = indexOf(readings).byName.get(JSON.stringify([foldRootName(root), relativePath]));
  if (plan === undefined) return null;
  const { reading } = plan;
  const wanted = comparablePath(path.resolve(reading.path));
  const openAsks = fleet(readings)
    .filter((repo) => sameFolder(repo.persona.workdir, reading.root))
    .flatMap((repo) =>
      repo.asks
        .filter((ask) => {
          const file = askPlanFile(repo.persona.workdir, ask);
          return file !== null && comparablePath(file) === wanted;
        })
        .map((ask) => askItem(repo, ask)),
    );
  return {
    root: rootName(reading.root),
    path: plan.rel,
    title: reading.stem,
    status: reading.status,
    goal: reading.goal,
    brief: null,
    sections: [...reading.sectionList],
    chapters: [...reading.chapterList],
    next: reading.next,
    openAsks,
    asOf: asOf(readings),
    held: readings.held,
  };
}

export function healthView(readings: Readings): HealthView {
  const repos = fleet(readings);
  return {
    expected: readings.roster.value === null ? null : repos.length,
    reporting: readings.roster.value === null ? null : repos.length - holesOf(readings, repos).length,
    holes: holesOf(readings, repos),
    sessions: readings.records.map((record) => sessionLine(readings, record)),
    kit: null,
    capacity: (readings.usage.value ?? []).map((account) => accountLine(account, readings.now)),
    verdict: null,
    hands: handsItems(readings, repos),
    asOf: asOf(readings),
    held: readings.held,
  };
}
