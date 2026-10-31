// The web surface's three marks the operator sets: a per-repo "caught up" time, a per-plan "seen"
// snapshot of the plan's status and chapter count, and a per-ask "done" mark that hides an open ask on
// the pages until the persona closes it or raises it again. They live in one file, `web-watermarks.json`, in the
// directory of the broker's state file, written whole through `writeSnapshot`, the same
// temp-and-rename the registry snapshot uses, so a crash mid-write leaves the previous file intact.
//
// The store holds the marks in memory and the file is read once, when the store opens. A write is made
// to a copy and committed to memory only after the file write succeeded, so memory never runs ahead of
// the disk: a failed write throws and leaves both as they were.
//
// A file that is missing, unreadable, not the expected version or not JSON opens as an empty store. A
// missing file is the first run and says nothing. Any other cause is logged once, by fixed sentence,
// and the next write replaces the file; what the file held is not recovered. An entry inside a readable
// file that does not validate is dropped alone and the rest stand.
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeSnapshot } from "../persistence.ts";
import type { LedgerReading } from "../decisions/ledger.ts";
import { MAX_ASKS_PER_LIST } from "../decisions/ledger.ts";
import { foldRootName } from "./config.ts";

/** The file's name, beside `broker-state.json`. */
export const WATERMARKS_FILE_NAME = "web-watermarks.json";

const FORMAT_VERSION = 1;

/** What the operator saw of one plan: when, and the two values a later look is compared against. */
export type PlanMark = { root: string; path: string; seenAt: number; status: string; chapters: number };

/**
 * One ask the operator marked done on the page: its persona's roster name, its ledger id, the
 * `openedAt` it carried when marked (null where the ledger gave none), the `reraisedAt` the page drew
 * (null where the ask had never been raised again), and when the operator tapped, which is for display.
 */
export type DoneMark = { repo: string; askId: string; openedAt: number | null; seenRaise: number | null; markedAt: number };

/** The marks a view reads: caught-up times by roster name, seen snapshots by `planMarkKey`, and done marks by `doneKey`. */
export type Marks = {
  repos: ReadonlyMap<string, number>;
  plans: ReadonlyMap<string, PlanMark>;
  done: ReadonlyMap<string, DoneMark>;
};

export const EMPTY_MARKS: Marks = { repos: new Map(), plans: new Map(), done: new Map() };

/** The key a done mark is held under: the persona's name and the ask's id, since ids are the ledger's per persona. */
export function doneKey(repo: string, askId: string): string {
  return JSON.stringify([repo, askId]);
}

/**
 * Whether a done mark hides this open ask: the mark carries the ask's `openedAt`, which the ledger keeps
 * across a re-raise, and the ledger shows no re-raise the mark did not see. A re-raise is the persona
 * asking again, so the ask returns. No clock is compared, so the tap's time decides nothing.
 */
export function doneHides(mark: DoneMark | undefined, ask: { openedAt: number | null; reraisedAt: number | null }): boolean {
  if (mark === undefined || mark.openedAt !== ask.openedAt) return false;
  if (ask.reraisedAt === null) return true;
  return mark.seenRaise !== null && ask.reraisedAt <= mark.seenRaise;
}

/** The key a plan's seen mark is held under: the root's folded name and the plan's relative path. */
export function planMarkKey(root: string, relativePath: string): string {
  return JSON.stringify([foldRootName(root), relativePath]);
}

export type WatermarkStore = {
  /** The marks as they stand now. Read-only, and replaced rather than changed by a write. */
  marks: () => Marks;
  /** Sets a repo's caught-up time. Throws if the file cannot be written, and then changes nothing. */
  caughtUp: (repo: string, at: number) => void;
  /** Sets a plan's seen mark. Throws if the file cannot be written, and then changes nothing. */
  seen: (root: string, relativePath: string, snapshot: { status: string; chapters: number }, at: number) => void;
  /** Sets an ask's done mark, replacing any earlier one. Throws if the file cannot be written, and then changes nothing. */
  markDone: (mark: DoneMark) => void;
  /**
   * Drops each done mark whose ask the ledger reading shows closed. A persona the reading does not cover,
   * one off the roster among them, or whose reading cannot answer, keeps its marks:
   * one with no ledger, no good file read, or an open list at the reader's cap, since an ask missing
   * there may still be open. Never throws: a write that fails is logged once, is not retried on the same
   * reading, and the marks stand.
   */
  pruneDone: (ledger: readonly LedgerReading[] | null) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timeOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** The marks a file's text holds, or null where the text is not a file this store wrote. */
function parseMarks(text: string): Marks | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== FORMAT_VERSION) return null;
  const repos = new Map<string, number>();
  const plans = new Map<string, PlanMark>();
  const done = new Map<string, DoneMark>();
  for (const item of Array.isArray(parsed.repos) ? (parsed.repos as unknown[]) : []) {
    if (!isRecord(item) || typeof item.name !== "string") continue;
    const at = timeOf(item.caughtUpAt);
    if (at !== null) repos.set(item.name, at);
  }
  for (const item of Array.isArray(parsed.plans) ? (parsed.plans as unknown[]) : []) {
    if (!isRecord(item)) continue;
    const { root, path: planPath, status, chapters } = item;
    const at = timeOf(item.seenAt);
    if (typeof root !== "string" || typeof planPath !== "string" || typeof status !== "string") continue;
    if (typeof chapters !== "number" || !Number.isInteger(chapters) || chapters < 0 || at === null) continue;
    plans.set(planMarkKey(root, planPath), { root, path: planPath, seenAt: at, status, chapters });
  }
  // A file written before the done list existed has none, and reads with an empty one.
  for (const item of Array.isArray(parsed.done) ? (parsed.done as unknown[]) : []) {
    if (!isRecord(item) || typeof item.repo !== "string" || typeof item.askId !== "string") continue;
    const markedAt = timeOf(item.markedAt);
    const openedAt = item.openedAt === null ? null : timeOf(item.openedAt);
    const seenRaise = item.seenRaise === null || item.seenRaise === undefined ? null : timeOf(item.seenRaise);
    if (markedAt === null || (item.openedAt !== null && openedAt === null)) continue;
    if (item.seenRaise !== null && item.seenRaise !== undefined && seenRaise === null) continue;
    done.set(doneKey(item.repo, item.askId), { repo: item.repo, askId: item.askId, openedAt, seenRaise, markedAt });
  }
  return { repos, plans, done };
}

function serialize(marks: Marks): string {
  return JSON.stringify(
    {
      version: FORMAT_VERSION,
      repos: [...marks.repos].map(([name, at]) => ({ name, caughtUpAt: new Date(at).toISOString() })),
      plans: [...marks.plans.values()].map((mark) => ({
        root: mark.root,
        path: mark.path,
        seenAt: new Date(mark.seenAt).toISOString(),
        status: mark.status,
        chapters: mark.chapters,
      })),
      done: [...marks.done.values()].map((mark) => ({
        repo: mark.repo,
        askId: mark.askId,
        openedAt: mark.openedAt === null ? null : new Date(mark.openedAt).toISOString(),
        seenRaise: mark.seenRaise === null ? null : new Date(mark.seenRaise).toISOString(),
        markedAt: new Date(mark.markedAt).toISOString(),
      })),
    },
    null,
    2,
  );
}

/**
 * Whether a persona's reading could have listed an ask open and did not: it holds a ledger, read from a
 * good file, and its open list is under the reader's cap. The same three conditions as `answers` in
 * `broker/decisions/thread.ts`, which closes the decisions card's asks on the same question.
 */
function answers(reading: LedgerReading): boolean {
  return reading.hasLedger && reading.fileAge !== null && reading.open.length < MAX_ASKS_PER_LIST;
}

/**
 * The readings a view is drawn from, with the operator's marks merged in: the merge first drops the done
 * marks of asks the ledger no longer lists open, then carries the marks as they stand. The one merge the
 * broker and the tests share.
 */
export function withMarks<T extends { ledger: { value: readonly LedgerReading[] | null } }>(
  base: T,
  store: WatermarkStore,
): T & { marks: Marks } {
  store.pruneDone(base.ledger.value);
  return { ...base, marks: store.marks() };
}

/** The file for a broker whose state file is `stateFile`. */
export function watermarksFileFor(stateFile: string): string {
  return path.join(path.dirname(stateFile), WATERMARKS_FILE_NAME);
}

/** Opens the store over `file`, reading it once; see the header for what an unreadable file does. */
export function openWatermarks(file: string, log: (message: string) => void = (): void => {}): WatermarkStore {
  let current: Marks = EMPTY_MARKS;
  let text: string | null = null;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log("web watermarks: the file could not be read, so every mark starts empty");
    }
  }
  if (text !== null) {
    const parsed = parseMarks(text);
    if (parsed === null) log("web watermarks: the file is not a mark file, so every mark starts empty");
    else current = parsed;
  }

  function commit(next: Marks): void {
    writeSnapshot(file, serialize(next));
    current = next;
  }

  /** The ledger reading whose prune last failed to write, so the same reading is not written again. */
  let failedOn: readonly LedgerReading[] | null = null;

  return {
    marks: () => current,
    caughtUp(repo, at) {
      commit({ ...current, repos: new Map(current.repos).set(repo, at) });
    },
    seen(root, relativePath, snapshot, at) {
      const mark: PlanMark = { root, path: relativePath, seenAt: at, ...snapshot };
      commit({ ...current, plans: new Map(current.plans).set(planMarkKey(root, relativePath), mark) });
    },
    markDone(mark) {
      commit({ ...current, done: new Map(current.done).set(doneKey(mark.repo, mark.askId), mark) });
    },
    pruneDone(ledger) {
      // A reading that failed to write is not retried until the next pass brings a new one.
      if (ledger === null || current.done.size === 0 || ledger === failedOn) return;
      const covered = new Map(ledger.map((reading) => [reading.name, reading]));
      const kept = new Map<string, DoneMark>();
      for (const [key, mark] of current.done) {
        const reading = covered.get(mark.repo);
        const keep = reading === undefined || !answers(reading) || reading.open.some((ask) => ask.id === mark.askId);
        if (keep) kept.set(key, mark);
      }
      if (kept.size === current.done.size) return;
      try {
        commit({ ...current, done: kept });
        failedOn = null;
      } catch {
        if (failedOn === null) log("web watermarks: a closed ask's done mark could not be dropped, so the file keeps it");
        failedOn = ledger;
      }
    },
  };
}
