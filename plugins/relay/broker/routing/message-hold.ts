// The message hold: an operator's lines kept for a persona while no session of it can take them,
// keyed by the persona's lineage, so the next session of that lineage reads them.
//
// The hold decides nothing about when a line is held or handed over. The inbound router admits a
// line here, reads the lines back when a session of the lineage can take them, and removes each
// one its event carried. What this module owns is the bound, the order, the time limit and what
// reaches disk.
//
// It reads no clock and writes no file. The time arrives as an argument to every act that needs
// one, and the write is the `persist` function the caller hands in, which is handed everything
// held after each change, as the response gate's persist seam is. It takes types alone from the
// router, the gate and the attachment intake, so any of them may import this module at run time
// with no import running both ways.
//
// A lineage holds at most `MAX_HELD_LINES` lines. Its time limit runs from its oldest held line,
// and every line it holds is dropped together when the limit is reached, a line held a minute
// earlier included, so the operator is told of one drop with one count. A lineage restored from
// the file carries a `notBefore` in memory, the earliest time it may be dropped, so a line is not
// dropped at a start before a session has had its grace to reconnect. A restored lineage whose
// oldest line is already older than the limit plus that grace when `release` runs is dropped there
// instead, a line admitted into it since the restore included, so an outage longer than the hold
// plus the restart window never hands a session lines from before it.
//
// A line whose text or quoted text matches the secret screen is held in memory and never handed
// to `persist`, so a broker restart loses it. Each write replaces the file whole, so the bound and
// the time limit are what empty it.
import { SECRET_SCREEN } from "../jev/client.ts";
import type { InboundAttachment } from "./attachments.ts";
import type { BufferedMessage } from "./response-gate.ts";

/** The most lines one lineage holds: the count the inbound rate window admits in a minute. */
export const MAX_HELD_LINES = 20;

/** How often the router checks whether a lineage holding lines has a session that can take them. */
export const HOLD_POLL_MS = 5_000;

/**
 * The hold file's format. The file is `{ "version": 1, "holds": [...] }`, each hold a `StoredHold`.
 * A file of another format restores nothing.
 */
export const MESSAGE_HOLDS_FORMAT_VERSION = 1;

/** What every held line carries: the hold's own key for it, its thread, and when it was held. */
type HeldLineBase = {
  /** Given by the hold at admission, unique in the hold, and never written to the file. */
  key: string;
  /** The thread the line was held under, which its notices are posted to. */
  threadId: string;
  /** Epoch ms by the router's clock. The lineage's time limit runs from its oldest line's. */
  heldAt: number;
};

/**
 * A line sent in a persona's Discord thread. The message is the gate's buffered message with no
 * saved file on it, since nothing is fetched before the hand-over, and `files` lists the
 * attachments as Discord described them, for the intake to take in for the session that receives
 * the line.
 */
export type HeldDiscordLine = HeldLineBase & {
  surface: "discord";
  message: Omit<BufferedMessage, "attachments">;
  files: readonly InboundAttachment[];
};

/**
 * A line typed on the page. It has no Discord message until its copy is posted to a thread, so it
 * carries what the page's typed line carries: the writer's name, the author label, the sender id,
 * the text bounded as a delivered line's is, whether that cut it, `copyId`, the posted copy's
 * Discord id, and `copyThreadId`, the thread that copy was posted to. The two are null together
 * until a copy is posted, and set together after, so a hand-over to another thread can tell that
 * the copy it holds is not in the receiving thread.
 */
export type HeldWebLine = HeldLineBase & {
  surface: "web";
  name: string;
  author: string;
  senderId: string;
  text: string;
  truncated: boolean;
  copyId: string | null;
  copyThreadId: string | null;
};

export type HeldLine = HeldDiscordLine | HeldWebLine;

/** Each form of a union with the named fields left off, the form kept apart from the others. */
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A held line as `admit` takes it: the hold gives the key and the time. */
export type AdmittedLine = Without<HeldLine, "key" | "heldAt">;

/** A held line as the file carries it: everything but the key, which is the hold's own. */
export type StoredLine = Without<HeldLine, "key">;

/** One lineage's lines as the file carries them, oldest first and never empty. */
export type StoredHold = { lineage: string; lines: readonly StoredLine[] };

/** One lineage's lines dropped at the time limit, by `expire` or by `release`, oldest first. */
export type ExpiredHold = { lineage: string; lines: readonly HeldLine[] };

export type MessageHoldOptions = {
  /**
   * Handed everything held after each change to it, less every line the secret screen matches. A
   * throw out of it is logged and never reaches the caller. Absent, nothing is persisted.
   */
  persist?: (holds: readonly StoredHold[]) => void;
  /** Where a failed write, a screened line or a refused restore is named: never a line's text. */
  log?: (message: string) => void;
};

export type MessageHold = {
  /**
   * Holds `line` for `lineage` at `now` and answers `held`, or answers `full` and holds nothing
   * where the lineage already holds `MAX_HELD_LINES`.
   */
  admit: (lineage: string, line: AdmittedLine, now: number) => "held" | "full";
  /** Each lineage that holds a line, with its count and its oldest line's time. */
  lineages: () => Array<{ lineage: string; count: number; oldestAt: number }>;
  /** The lineage's lines, oldest first, or none. Removes nothing. */
  lines: (lineage: string) => readonly HeldLine[];
  /** Removes the lineage's lines whose keys are named. A key it does not hold is passed over. */
  remove: (lineage: string, keys: readonly string[]) => void;
  /**
   * Records the posted copy's id, and the thread it was posted to, on a held web line, replacing any
   * copy recorded before. A key it does not hold is passed over.
   */
  setCopyId: (lineage: string, key: string, id: string, threadId: string) => void;
  /**
   * Removes and answers the lines of every lineage that is due at `now`: its oldest line is
   * `holdMs` old or more, and `now` is at or past its `notBefore` where it has one.
   */
  expire: (now: number, holdMs: number) => ExpiredHold[];
  /**
   * Holds the lines an earlier broker process left, each lineage's in its order, and sets
   * `notBefore` on each lineage it loads. A lineage already holding lines keeps them, and the
   * restored ones are logged and not taken. For startup, before the first admit. A `notBefore` of
   * `Number.POSITIVE_INFINITY` leaves the time unset, so `expire` does not drop the lineage, and
   * `release` decides it: dropped there where it is already too old, or given a time.
   */
  restore: (entries: readonly StoredHold[], notBefore: number) => void;
  /**
   * Settles each lineage whose `notBefore` is unset, `Number.POSITIVE_INFINITY`, at `now`, the
   * moment the restored lines may first reach a session. One whose oldest line is more than
   * `holdMs` plus `graceMs` old is removed and answered, as `expire` answers a due lineage, and a
   * lineage exactly that old is kept. Every other one takes `notBefore` at `now` plus `graceMs`, so
   * its limit applies from then. Writes once where it removed a lineage and not otherwise, since
   * `notBefore` lives in memory alone.
   */
  release: (now: number, graceMs: number, holdMs: number) => ExpiredHold[];
};

/** One lineage's held lines, oldest first, and the earliest time it may be dropped where restored. */
type Lineage = { lines: HeldLine[]; notBefore?: number };

/**
 * An epoch-ms time to the second in UTC, in the form `utcSecond` in `response-gate.ts` writes, so
 * the hold line reads as the gate's restart line does. Written here rather than imported, so this
 * module takes types alone from the gate and the gate may import it at run time with no cycle.
 */
function utcSecondOf(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A whole number of minutes, rounded up, with its noun. */
function minutes(holdMs: number): string {
  const count = Math.ceil(holdMs / 60_000);
  return count === 1 ? "1 minute" : `${String(count)} minutes`;
}

/**
 * The line a handed-over event opens with: the broker's own, saying the lines under it were held
 * and naming when the oldest was held. The relay's instructions have no room to explain the hold,
 * so this line is how the session learns the lines are late. Its width is fixed.
 */
export function holdLine(oldestAt: number): string {
  return `Lines held while no session of this persona could be reached follow, the oldest held since ${utcSecondOf(oldestAt)}.`;
}

/** Posted to the thread when a lineage's first line is held. */
export function heldNotice(holdMs: number): string {
  return (
    "No session of this persona can be reached now, so a message just sent to it is held, and so is " +
    "any that follows. The next session to connect reads them. If none connects within " +
    `${minutes(holdMs)} of the first held message, they are all dropped, and this thread says so.`
  );
}

/** Posted to the thread when a line is refused because its lineage holds `MAX_HELD_LINES`. */
export const HOLD_FULL_NOTICE =
  `The hold for this persona is full at ${String(MAX_HELD_LINES)} messages, so this message was not ` +
  "kept. Send it again once a session is up.";

/** Posted to a thread when the time limit drops the `count` lines held under it. */
export function expiredHoldNotice(count: number, holdMs: number): string {
  const what = count === 1 ? "the message it held was" : `the ${String(count)} messages it held were`;
  return (
    `No session of this persona connected within ${minutes(holdMs)}, so ${what} not delivered. ` +
    `Nothing is held now: send ${count === 1 ? "it" : "them"} again once a session is up.`
  );
}

/** Posted to a thread when `count` lines held under it lose their sender's operator standing. */
export function declassedHoldNotice(count: number): string {
  const what = count === 1 ? "message was" : "messages were";
  return `${String(count)} held ${what} not delivered, because the sender is no longer an operator on this host.`;
}

/** Whether a line's text, or the text it quotes, matches the secret screen. */
function screened(line: HeldLine): boolean {
  if (line.surface === "web") return SECRET_SCREEN.test(line.text);
  const { text, quote } = line.message;
  return SECRET_SCREEN.test(text) || (quote?.kind === "message" && SECRET_SCREEN.test(quote.text));
}

/** A held line as the file carries it. */
function stored(line: HeldLine): StoredLine {
  const { key, ...rest } = line;
  return rest as StoredLine;
}

/** The time a lineage's oldest line was held. */
function oldestOf(lines: readonly HeldLine[]): number {
  return Math.min(...lines.map((line) => line.heldAt));
}

export function createMessageHold(options: MessageHoldOptions = {}): MessageHold {
  const log = options.log ?? ((): void => {});
  const held = new Map<string, Lineage>();
  /** The keys of lines already named as screened, so a held secret is logged once and not on every write. */
  const screenedLogged = new Set<string>();
  let nextKey = 0;

  function keyed(line: StoredLine): HeldLine {
    nextKey += 1;
    return { ...line, key: String(nextKey) } as HeldLine;
  }

  /**
   * Everything held, to the persist seam, less each line the screen matches, which is named once by
   * lineage and never by text. A lineage left with no line is left out. The seam's failure is
   * logged and stops nothing.
   */
  function save(): void {
    if (options.persist === undefined) return;
    const holds: StoredHold[] = [];
    for (const [lineage, entry] of held) {
      const kept: StoredLine[] = [];
      for (const line of entry.lines) {
        if (!screened(line)) {
          kept.push(stored(line));
          continue;
        }
        if (!screenedLogged.has(line.key)) {
          screenedLogged.add(line.key);
          log(
            `routing: a line held for lineage ${lineage} matches the secret screen, so it is held in ` +
              "memory only and would not survive a broker restart",
          );
        }
      }
      if (kept.length > 0) holds.push({ lineage, lines: kept });
    }
    try {
      options.persist(holds);
    } catch (error) {
      log(`routing: the message hold could not write its held lines: ${String(error)}`);
    }
  }

  /** Drops the lineage's entry once it holds nothing, so it is listed no longer. */
  function settle(lineage: string, entry: Lineage): void {
    if (entry.lines.length === 0) held.delete(lineage);
  }

  return {
    admit(lineage, line, now) {
      const entry = held.get(lineage) ?? { lines: [] };
      if (entry.lines.length >= MAX_HELD_LINES) return "full";
      entry.lines.push(keyed({ ...line, heldAt: now } as StoredLine));
      held.set(lineage, entry);
      save();
      return "held";
    },

    lineages: () =>
      [...held].map(([lineage, entry]) => ({
        lineage,
        count: entry.lines.length,
        oldestAt: oldestOf(entry.lines),
      })),

    lines: (lineage) => [...(held.get(lineage)?.lines ?? [])],

    remove(lineage, keys) {
      const entry = held.get(lineage);
      if (entry === undefined) return;
      const named = new Set(keys);
      const kept = entry.lines.filter((line) => !named.has(line.key));
      if (kept.length === entry.lines.length) return;
      for (const line of entry.lines) if (named.has(line.key)) screenedLogged.delete(line.key);
      entry.lines = kept;
      settle(lineage, entry);
      save();
    },

    setCopyId(lineage, key, id, threadId) {
      const entry = held.get(lineage);
      const index = entry?.lines.findIndex((line) => line.key === key && line.surface === "web") ?? -1;
      if (entry === undefined || index === -1) return;
      const line = entry.lines[index] as HeldWebLine;
      if (line.copyId === id && line.copyThreadId === threadId) return;
      entry.lines[index] = { ...line, copyId: id, copyThreadId: threadId };
      save();
    },

    expire(now, holdMs) {
      const expired: ExpiredHold[] = [];
      for (const [lineage, entry] of [...held]) {
        if (entry.notBefore !== undefined && now < entry.notBefore) continue;
        if (now - oldestOf(entry.lines) < holdMs) continue;
        held.delete(lineage);
        for (const line of entry.lines) screenedLogged.delete(line.key);
        expired.push({ lineage, lines: entry.lines });
      }
      if (expired.length > 0) save();
      return expired;
    },

    restore(entries, notBefore) {
      let loaded = false;
      for (const { lineage, lines } of entries) {
        if (lines.length === 0) continue;
        if (held.has(lineage)) {
          log(
            `routing: lineage ${lineage} already holds lines, so the ${String(lines.length)} restored ` +
              "lines held for it are not taken",
          );
          continue;
        }
        held.set(lineage, { lines: lines.map(keyed), notBefore });
        loaded = true;
      }
      // Only where something was taken, so a file the loader refused stays on disk for the operator
      // to read until the first admit writes over it.
      if (loaded) save();
    },

    release(now, graceMs, holdMs) {
      const dropped: ExpiredHold[] = [];
      for (const [lineage, entry] of [...held]) {
        if (entry.notBefore !== Number.POSITIVE_INFINITY) continue;
        if (now - oldestOf(entry.lines) > holdMs + graceMs) {
          held.delete(lineage);
          for (const line of entry.lines) screenedLogged.delete(line.key);
          dropped.push({ lineage, lines: entry.lines });
          continue;
        }
        entry.notBefore = now + graceMs;
      }
      if (dropped.length > 0) save();
      return dropped;
    },
  };
}
