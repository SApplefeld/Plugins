// The web surface's two marks the operator sets: a per-repo "caught up" time and a per-plan "seen"
// snapshot of the plan's status and chapter count. They live in one file, `web-watermarks.json`, in the
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
import { foldRootName } from "./config.ts";

/** The file's name, beside `broker-state.json`. */
export const WATERMARKS_FILE_NAME = "web-watermarks.json";

const FORMAT_VERSION = 1;

/** What the operator saw of one plan: when, and the two values a later look is compared against. */
export type PlanMark = { root: string; path: string; seenAt: number; status: string; chapters: number };

/** The marks a view reads: caught-up times by roster name, and seen snapshots by `planMarkKey`. */
export type Marks = { repos: ReadonlyMap<string, number>; plans: ReadonlyMap<string, PlanMark> };

export const EMPTY_MARKS: Marks = { repos: new Map(), plans: new Map() };

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
  return { repos, plans };
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
    },
    null,
    2,
  );
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

  return {
    marks: () => current,
    caughtUp(repo, at) {
      commit({ repos: new Map(current.repos).set(repo, at), plans: current.plans });
    },
    seen(root, relativePath, snapshot, at) {
      const mark: PlanMark = { root, path: relativePath, seenAt: at, ...snapshot };
      commit({ repos: current.repos, plans: new Map(current.plans).set(planMarkKey(root, relativePath), mark) });
    },
  };
}
