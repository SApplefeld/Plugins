// The local door's reading of the open asks: what `GET /door/pending` lists under `asks` for a
// lineage. The door reads the roster and each persona's ask ledger itself, since it may run on a
// host with no web surface, and it hides an ask by the one store of handled marks the pages' ask
// acts write, so an ask answered on the operator's page leaves the door's list.
//
// A reading is every roster persona's open asks, taken together, because the ledger reader holds a
// last good reading for exactly the personas of its latest call. A listing reuses a reading no
// older than `DOOR_ASKS_REUSE_MS`, so a caller that polls every lineage spends one reading in that
// time and not one for each call. Where `prunes` is set, which the broker sets on a host whose web
// surface is off, each new reading drops the handled mark of every ask the ledgers no longer list
// open, the one exit an ask mark has on a host with no page. Where the page is on, the page's own
// pass prunes, from the reading it draws, and this reading never does: the two readings are taken
// at different times, so a second pruner would drop a mark the page still needs to hide an ask it
// lists open. The rule that hides an ask is applied at each listing against the marks as they stand
// then, never held with the reading, so a mark written since the reading hides its ask at once.
//
// An answer to an ask, `POST /door/ask`, is judged against a reading taken for that answer and
// never a reused one, since an ask that closed or changed in the last second must take no line.
// Where a persona's ledger file cannot be read then, the ledger reader's last good reading of it is
// the one judged. That reading is taken as any other is, pruning where `prunes` is set, and is then
// the one the listings reuse.
import type { RosterPersona } from "./board/roster.ts";
import type { AskEntry, LedgerReading } from "./decisions/ledger.ts";
import { drawnAsk } from "./web/views.ts";
import { handledHides, handledKey } from "./web/watermarks.ts";
import type { WatermarkStore } from "./web/watermarks.ts";

/** A listing reuses a reading at most this old, in milliseconds by the reading's clock. */
export const DOOR_ASKS_REUSE_MS = 1_000;

/**
 * One open ask as the door lists it. `question`, `openedAt` and `reraisedAt` are the fields
 * `drawnAsk` draws for the pages, the question cut at its recommendation segment and each time an
 * ISO string or null, so a caller that sends them back with `recommend` sends what the ask checks
 * compare byte for byte. `blocking` is true only where the ledger's entry reads true. `title`,
 * `recommend` and `brief` are null where the ledger holds none.
 */
export type DoorAsk = {
  id: string;
  title: string | null;
  question: string;
  recommend: string | null;
  blocking: boolean;
  openedAt: string | null;
  reraisedAt: string | null;
  brief: string | null;
};

export type DoorAsksOptions = {
  /** The roster's personas, read whole at each reading; a host with no roster answers none. */
  roster: () => readonly RosterPersona[];
  /** The ask ledgers of those personas, each keeping its last good reading where its file fails. */
  ledger: (personas: readonly RosterPersona[]) => readonly LedgerReading[];
  /** The one store of handled marks: read at each listing, pruned at each reading by `prunes`. */
  marks: Pick<WatermarkStore, "marks" | "pruneHandled">;
  /**
   * Whether each new reading prunes the marks: true where no web surface runs, false where one
   * does, since the page's pass prunes there. Defaults to true, the door with no page beside it.
   */
  prunes?: boolean;
  /**
   * Takes a log line. A failed reading writes one, and none again until a reading succeeds. A
   * reading made without it logs nothing.
   */
  log?: (line: string) => void;
  /** The clock a reading's age is measured by, in milliseconds. Injected so a test moves it. */
  now?: () => number;
};

export type DoorAsks = {
  /**
   * The open asks of the roster persona whose name is exactly `lineage`, in the ledger reading's
   * order, less each whose current version a handled mark hides by `handledHides`. A lineage that
   * names no roster persona lists none, and so does a persona whose ledger has never been read.
   */
  list: (lineage: string) => readonly DoorAsk[];
  /**
   * The open ask of that id of the roster persona whose name is exactly `lineage`, as the ledger
   * holds it, or null where there is none. Each call takes a new reading and never reuses one,
   * and the listings that follow reuse that reading. Where the ledgers cannot be read, the last
   * good reading is the one searched. No handled mark is read here: the ask checks answer for a
   * version a mark hides, after they have answered for an ask that is not open.
   */
  openAsk: (lineage: string, id: string) => Readonly<AskEntry> | null;
};

/** A reading: each roster persona's open asks under the persona's name. */
type Reading = { open: ReadonlyMap<string, readonly Readonly<AskEntry>[]> };

function shown(ask: AskEntry): DoorAsk {
  const drawn = drawnAsk(ask);
  return {
    id: ask.id,
    title: ask.title,
    question: drawn.question,
    recommend: ask.recommend,
    blocking: ask.blocking === true,
    openedAt: drawn.openedAt,
    reraisedAt: drawn.reraisedAt,
    brief: ask.brief,
  };
}

/** Makes the door's reading of asks. Called once for a broker process, so one reading is reused. */
export function createDoorAsks(options: DoorAsksOptions): DoorAsks {
  const now = options.now ?? Date.now;
  const { marks } = options;
  const prunes = options.prunes ?? true;
  const log = options.log ?? ((): void => {});
  // The last good reading, and when the latest reading was tried, whether or not it read well.
  let held: Reading | null = null;
  let triedAt: number | null = null;
  let loggedFailure = false;

  /**
   * Takes a new reading, prunes the marks by it where `prunes` is set, and holds it for the
   * listings that follow. The page prunes from the reading it draws, so on a host with the page on
   * a prune here, from another reading, would disagree with it. A read that throws leaves the last
   * good reading standing, or none, and prunes nothing. As a failed source of the web pass does, it
   * logs one line until a reading succeeds, its error dropped unread, since it can quote a path.
   */
  function fresh(at: number): Reading | null {
    triedAt = at;
    let readings: readonly LedgerReading[];
    try {
      readings = options.ledger(options.roster());
    } catch {
      if (!loggedFailure) log("local door: the asks could not be read, the last good reading stands");
      loggedFailure = true;
      return held;
    }
    loggedFailure = false;
    // Null for the blocked reasons, and no review readings: only an ask's mark can leave on this
    // reading, and a blocked entry's and a review's stand whatever the ledgers say.
    if (prunes) marks.pruneHandled(readings, null);
    held = { open: new Map(readings.map((reading) => [reading.name, reading.open])) };
    return held;
  }

  /**
   * The held reading, or none, where the latest reading was tried recently enough to reuse, else a
   * new one. A reading that failed is not tried again inside that time either.
   */
  function current(): Reading | null {
    const at = now();
    if (triedAt !== null) {
      // An age below zero is a clock set back, and is no reading to keep listing from.
      const age = at - triedAt;
      if (age >= 0 && age <= DOOR_ASKS_REUSE_MS) return held;
    }
    return fresh(at);
  }

  return {
    list(lineage) {
      const open = current()?.open.get(lineage);
      if (open === undefined) return [];
      const handled = marks.marks().handled;
      return open.filter((ask) => !handledHides(handled.get(handledKey(lineage, ask.id)), ask)).map(shown);
    },
    openAsk(lineage, id) {
      return fresh(now())?.open.get(lineage)?.find((ask) => ask.id === id) ?? null;
    },
  };
}
