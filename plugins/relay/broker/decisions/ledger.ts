// The ask ledger reader: each roster persona's `asks` array, read out of the same store file the
// board's queue reader opens, bounded and typed for the decisions card.
//
// The file is read through the board's one capped, last-good-reading file read (`readHeldFile` in
// `broker/board/queues.ts`), so a store over `MAX_STORE_FILE_BYTES`, a torn write or a file that
// is briefly gone costs a pass nothing but the last good reading. Nothing but `asks` is read out of
// the file. Every string in it is written by a worker and reaches a trusted channel later, so each
// is cut here and escaped by whatever renders it.
//
// A reader holds each persona's last good reading between passes, so it is a factory like
// `createQueueReader` and not a bare function: a function called afresh could not keep one.
import path from "node:path";
import { readCappedFile } from "../capped-read.ts";
import { STORE_FILE_NAME, freshHeld, readHeldFile } from "../board/queues.ts";
import type { HeldFile, PlanStat, QueueReaderOptions } from "../board/queues.ts";
import type { RosterPersona } from "../board/roster.ts";

/** A string field is cut to this many code points. */
export const MAX_ASK_FIELD_LENGTH = 1_000;

/** Each list the reader returns holds at most this many entries. */
export const MAX_ASKS_PER_LIST = 64;

/** An entry closed longer ago than this is not recently closed. */
export const RECENTLY_CLOSED_MS = 24 * 60 * 60 * 1000;

/**
 * One ask as the ledger writes it. `id` and `question` are the two a reading cannot do without, so
 * an entry lacking either is dropped. Every other field is null where the file carries none or
 * carries the wrong type. `status`, `opener` and `closedBy` are strings and not closed sets, so a
 * value a later plugin writes passes through verbatim. Timestamps are epoch milliseconds.
 */
export type AskEntry = {
  id: string;
  nodeId: string | null;
  planPath: string | null;
  entryTitle: string | null;
  question: string;
  recommend: string | null;
  opener: string | null;
  blocking: boolean | null;
  openedAt: number | null;
  reraisedAt: number | null;
  status: string | null;
  closedAt: number | null;
  closedBy: string | null;
  answer: string | null;
};

export type LedgerReading = {
  name: string;
  /** The 64 newest entries whose status is `open`, newest `openedAt` first. */
  open: readonly Readonly<AskEntry>[];
  /** The 64 newest entries closed within a day of the pass, newest `closedAt` first. */
  recentlyClosed: readonly Readonly<AskEntry>[];
  /** The pass clock minus the modification time of the file the reading came from, or null when no
   * good reading is currently held. */
  fileAge: number | null;
  /** False for a file with no `asks` array: a persona on a plugin that writes no ledger. */
  hasLedger: boolean;
};

/** The seams the queue reader takes, narrowed to the three this reader uses, and its own stat. */
export type LedgerSeams = Pick<QueueReaderOptions, "log" | "now" | "readStore"> & {
  /** The one stat a pass makes per persona. Injected so a test can pin which store files are tried. */
  statStore?: (file: string) => PlanStat | null;
};

export type LedgerReader = {
  read: (personas: readonly RosterPersona[]) => readonly LedgerReading[];
};

/** What one parse of the store file holds for one persona, before the pass clock is applied. */
type Parsed = {
  /** Null when the persona's value carries no `asks` array. */
  asks: { open: readonly Readonly<AskEntry>[]; closed: readonly Readonly<AskEntry>[] } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first `limit` code points of a string, as written. A cut never lands inside a surrogate pair. */
export function cut(text: string, limit: number): string {
  // A code point takes at most two UTF-16 units, so this prefix holds at least `limit` of them and
  // the array stays small whatever the value's size.
  return [...text.slice(0, limit * 2)].slice(0, limit).join("");
}

function textField(value: unknown): string | null {
  return typeof value === "string" ? cut(value, MAX_ASK_FIELD_LENGTH) : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function entryOf(value: unknown): Readonly<AskEntry> | null {
  if (!isRecord(value)) return null;
  const id = textField(value.id);
  const question = textField(value.question);
  if (id === null || question === null) return null;
  return Object.freeze({
    id,
    nodeId: textField(value.nodeId),
    planPath: textField(value.planPath),
    entryTitle: textField(value.entryTitle),
    question,
    recommend: textField(value.recommend),
    opener: textField(value.opener),
    blocking: typeof value.blocking === "boolean" ? value.blocking : null,
    openedAt: numberField(value.openedAt),
    reraisedAt: numberField(value.reraisedAt),
    status: textField(value.status),
    closedAt: numberField(value.closedAt),
    closedBy: textField(value.closedBy),
    answer: textField(value.answer),
  });
}

/** Newest first by one timestamp, an entry with none after every entry with one. */
function newestFirst(
  entries: Readonly<AskEntry>[],
  stamp: (entry: AskEntry) => number | null,
): Readonly<AskEntry>[] {
  const key = (entry: AskEntry): number => stamp(entry) ?? Number.NEGATIVE_INFINITY;
  return entries.sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a === b ? 0 : a < b ? 1 : -1;
  });
}

/**
 * One persona's ask entries out of the whole store file, or null when the file is not a JSON object
 * at all.
 *
 * The first entry per `id` in file order is kept, across open and closed together, before the
 * split. The split into open and closed is made before either list is bounded, so a run of closed
 * entries never pushes an open one out. An entry whose status is not `open`, an unknown word
 * included, is on the closed side. A closed-side entry with no `closedAt` is dropped here, since it
 * can never be recently closed. Only the 64 newest closed by `closedAt` are held, which is safe
 * because the pass clock only moves forward: an entry outside the newest 64 now is outside them
 * on every later pass.
 */
function parseStore(value: unknown, persona: string): Parsed | null {
  if (!isRecord(value)) return null;
  const own = value[persona];
  if (!isRecord(own) || !Array.isArray(own.asks)) return { asks: null };

  const seen = new Set<string>();
  const open: Readonly<AskEntry>[] = [];
  const closed: Readonly<AskEntry>[] = [];
  for (const raw of own.asks) {
    const entry = entryOf(raw);
    if (entry === null || seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (entry.status === "open") open.push(entry);
    else if (entry.closedAt !== null) closed.push(entry);
  }
  return {
    asks: {
      open: newestFirst(open, (entry) => entry.openedAt).slice(0, MAX_ASKS_PER_LIST),
      closed: newestFirst(closed, (entry) => entry.closedAt).slice(0, MAX_ASKS_PER_LIST),
    },
  };
}

/**
 * A reader over a roster's ask ledgers, holding each persona's last good reading between passes.
 *
 * A pass makes one stat and one read per persona at most, of that persona's store file under its
 * `workdir`, and takes the persona's entries from under its own name inside that file. State is
 * filed per persona and rebuilt from the roster on every pass, so a persona that leaves the roster
 * loses its held reading.
 */
export function createLedgerReader(seams: LedgerSeams = {}): LedgerReader {
  const log = seams.log ?? ((): void => {});
  const now = seams.now ?? Date.now;
  const readFile = seams.readStore ?? readCappedFile;
  let slots = new Map<string, HeldFile<Parsed>>();

  return {
    read: (personas) => {
      const at = now();
      const next = new Map<string, HeldFile<Parsed>>();
      const readings: LedgerReading[] = [];

      for (const persona of personas) {
        const key = `${persona.name}\u0000${persona.workdir}`;
        const slot = slots.get(key) ?? freshHeld<Parsed>();
        const parsed = readHeldFile(
          path.join(persona.workdir, STORE_FILE_NAME),
          slot,
          "decisions card: ask ledger",
          (value) => parseStore(value, persona.name),
          now,
          log,
          readFile,
          seams.statStore,
        );
        next.set(key, slot);

        const asks = parsed?.asks ?? null;
        const recentlyClosed =
          asks === null
            ? []
            : asks.closed
                .filter((entry) => entry.closedAt !== null && at - entry.closedAt <= RECENTLY_CLOSED_MS)
                .slice(0, MAX_ASKS_PER_LIST);
        readings.push({
          name: persona.name,
          open: asks === null ? [] : [...asks.open],
          recentlyClosed,
          fileAge: slot.held === null ? null : at - slot.held.stat.mtimeMs,
          hasLedger: asks !== null,
        });
      }

      slots = next;
      return readings;
    },
  };
}
