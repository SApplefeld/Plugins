// The blocked-state desk: the session surface's half of the kit's goal event stream.
//
// It holds the session fold's reader state, advances it once per Discord refresh pass, and answers
// two questions from what the fold keeps. Whether a session *stands* blocked, which is what the
// card and the thread title render, is the standing computation: the latest kept goal event is a
// `goal-blocked` newer than the session's last engagement. Whether a block *episode* gets its
// alert is a different question with a different key: the episode is the event itself, so a
// mid-queue block whose engagement already cleared the rendered state still posts its alert, and the
// standing computation gates only the drawn state, never the alert.
//
// Who the run waits on decides the alert's words and whether it mentions the operators. The desk
// asks its `waitsOn` seam at the moment it would post, and the broker answers it from the session
// persona's ask ledger: `asked` where the persona holds an open ask, `unasked` where its ledger
// was read well and holds none, and `unknown` where the broker cannot place the session. An
// `asked` or `unknown` episode mentions the operators as the alert window allows; an `unasked` one
// mentions no one, under a window of its own. An episode posted as `unasked` is read again on each
// tick while it is fresh, and the first `asked` reading posts the `asked` alert once.
//
// The desk exists whenever Discord does, independent of whether the board card is on: the two folds
// of the stream hold independent offsets in `broker/board/events.ts`, so neither surface starves
// the other. The feed is lower-privilege than the broker's token-gated surfaces (append access to
// the operator's home directory, no process token), which is why every log line here names a cause
// and a session id and never the plan or the reason the events carry.
import {
  MAX_TRACKED_SESSIONS,
  initialSessionEventState,
  readSessionEvents,
} from "../board/events.ts";
import type { ReadSessionEventsResult, SessionEventReaderState } from "../board/events.ts";
import { createRosterReader } from "../board/roster.ts";
import type { RosterPersona } from "../board/roster.ts";
import { createLedgerReader } from "../decisions/ledger.ts";
import type { LedgerReading } from "../decisions/ledger.ts";
import type { SessionRecord } from "../registry.ts";
import {
  ALERT_WINDOW_MS,
  MAX_QUESTION_ALERTS_PER_WINDOW,
  MAX_QUESTION_PINGS_PER_WINDOW,
  createAlertVolume,
} from "../security/permission.ts";
import { renderBlockedAlert } from "./render.ts";
import type { CallOutcome } from "./transport.ts";

/**
 * How recent a `goal-blocked` event has to be for its alert to be posted at all, measured from the
 * event's admitted instant to the observing tick.
 *
 * Episode identity is the event, not the rendered state: a mid-queue block that never renders
 * blocked (the queue moved on and the next tool call cleared the standing marker) still posts its
 * alert, because the run did stop and the alert is the fast channel that says so. What the
 * bound refuses is the backlog: a broker restart re-reads the stream from the top, and a block
 * replayed from it pings only while it is still recent enough to be news. An older one is the `⛔`
 * title alone.
 */
export const BLOCKED_PING_FRESH_MS = 10 * 60 * 1000;

/**
 * The most posted episode keys the desk remembers, the oldest recorded evicted to make room, the
 * way the narration maps bound theirs.
 *
 * Episode instants come from another program's file, so without a ceiling the set grows for as long
 * as the broker runs. Twice the session fold's own ceiling, because the fold holds at most
 * `MAX_TRACKED_SESSIONS` live episodes at once: at this size an eviction can only reach a key whose
 * episode has itself long been superseded or evicted from the fold, and the cost of one that has
 * not is a session's block episode pinging a second time.
 */
export const MAX_POSTED_BLOCK_KEYS = 2 * MAX_TRACKED_SESSIONS;

/**
 * The posted-key for one block episode: the session id and the event's admitted instant.
 *
 * The instant, never the raw `ts` string: `Date.parse` accepts unlimited spellings of one instant,
 * so a dedup keyed on the raw stamp would hand the key to whatever writes the file, and one block
 * respelled per line would ping once per spelling. The separator is a NUL because a session id is
 * free-form text from another program's file, and any separator it could contain would let two
 * different episodes produce one key.
 */
function episodeKey(sessionId: string, tsMs: number): string {
  return `${sessionId}\u0000${String(tsMs)}`;
}

/** Who a blocked run waits on, as far as the broker can tell. */
export type BlockedWaitState = "asked" | "unasked" | "unknown";

/**
 * A session's wait state from its lineage, the roster's personas and the ask ledgers read over
 * that whole roster.
 *
 * A session reaches its persona by lineage, since the supervisor launches each persona with its
 * name as the lineage. The answer is `unknown` where the session carries no lineage, where no
 * roster persona carries it as its name, where no good reading of the persona's store is held
 * (`fileAge` null), and where the store holds no ledger. Otherwise it is `asked` where the persona
 * holds any open ask, whatever its plan and its `blocking` flag, and `unasked` where it holds none.
 * An ask whose wait timed out is still open, so it still counts.
 */
export function blockedWaitState(
  lineage: string | null,
  personas: readonly RosterPersona[],
  readings: readonly LedgerReading[],
): BlockedWaitState {
  if (lineage === null) return "unknown";
  if (!personas.some((persona) => persona.name === lineage)) return "unknown";
  const reading = readings.find((candidate) => candidate.name === lineage);
  if (reading === undefined || reading.fileAge === null || !reading.hasLedger) return "unknown";
  return reading.open.length > 0 ? "asked" : "unasked";
}

/**
 * The desk's `waitsOn` seam as the broker builds it: the session's lineage, found in the broker's
 * session list, the roster read through the desk's own reader, and the ask ledger read through the
 * desk's own reader, apart from the decisions card's and the web pass's. The whole roster goes to
 * one ledger read, since the reader rebuilds its held readings from the list each call hands it.
 * With an empty roster path neither reader is built and every session is `unknown`, which mentions
 * as the alert window allows.
 */
export function createDeskWaitsOn(options: {
  rosterPath: string;
  /** The broker's registered sessions, whose record for the blocked session carries its lineage. */
  sessions: () => readonly Pick<SessionRecord, "sessionId" | "lineage">[];
  log?: (message: string) => void;
}): (sessionId: string) => BlockedWaitState {
  if (options.rosterPath === "") return () => "unknown";
  const roster = createRosterReader(options.rosterPath, { log: options.log });
  const ledgers = createLedgerReader({ log: options.log, label: "blocked desk: ask ledger" });
  return (sessionId) => {
    const personas = roster.read();
    const lineage = options.sessions().find((record) => record.sessionId === sessionId)?.lineage ?? null;
    return blockedWaitState(lineage, personas, ledgers.read(personas));
  };
}

export type BlockedDeskOptions = {
  /** The resolved path of the kit's goal event stream, the same path the board fold reads. */
  eventsPath: string;
  /** The session's thread, or null while it has none, in which case the episode retries next tick. */
  threadFor: (sessionId: string) => string | null;
  /**
   * The steering writer's alert tier: the phone-reaching write, which also ends the thread's
   * narration block on a successful post. An empty mention list posts the same text quietly.
   */
  alert: (
    threadId: string,
    text: string,
    mentionUserIds: readonly string[],
  ) => Promise<CallOutcome<{ messageId: string | null }>>;
  /** Every operator, in roster order: who the ping tier mentions. */
  operatorIds: readonly string[];
  /**
   * Who the session's run waits on, read at the moment of a post. Called only for an episode that
   * is fresh, has a thread and is not finally posted, so an idle tick reads nothing. A throw counts
   * as `unknown`. The broker builds it with `createDeskWaitsOn`.
   */
  waitsOn: (sessionId: string) => BlockedWaitState;
  now?: () => number;
  /**
   * The fold's read, one tick's worth. Injected so a test drives the kept state without a real
   * file, mirroring the board card's `readEvents` seam; production reads the configured path.
   */
  readEvents?: (previous: SessionEventReaderState) => ReadSessionEventsResult;
  log: (message: string) => void;
};

export type BlockedDesk = {
  /**
   * Advances the session fold by one tick and posts the alerts the new state owes. The fold and
   * every gate ahead of a post run synchronously inside the call, so views built after it return
   * read this tick's events; the returned promise carries only the posts already on the wire and
   * never rejects, so a caller can fold it into the pass it drains at shutdown.
   */
  tick: () => Promise<void>;
  /**
   * Whether the session stands blocked: its latest kept goal event is a `goal-blocked` newer than
   * its last engagement. The one computation both `toView` call sites read, so the fleet card and
   * the thread cannot disagree; a `goal-complete`, or an engagement newer than the block, clears it.
   */
  standing: (session: Pick<SessionRecord, "sessionId" | "lastEngagementAt">) => boolean;
};

export function createBlockedDesk(options: BlockedDeskOptions): BlockedDesk {
  const now = options.now ?? Date.now;
  const read =
    options.readEvents ??
    ((previous: SessionEventReaderState): ReadSessionEventsResult =>
      readSessionEvents(previous, { path: options.eventsPath, now }));
  let state = initialSessionEventState();
  // One line per outage rather than one per tick: the flag arms on the first unreadable read and
  // holds until a read succeeds again, so a standing failure costs the log a single line and a new
  // outage after a recovery is the news it is.
  let unreadableReported = false;
  const waitsOn = options.waitsOn;
  /**
   * Episodes finally posted, as `asked` or `unknown`, insertion-ordered so eviction drops the
   * oldest recorded first. An episode's key is added when its post goes on the wire, so a tick
   * arriving while the post is still in flight cannot double it, and removed again when the post
   * did not land, so the fold retries the episode on its next tick for as long as the block stays
   * fresh. Nothing is queued: the retry is the standing fold walking its own kept state.
   */
  const posted = new Set<string>();
  /**
   * Episodes whose `unasked` alert landed: still open to the second look, which posts the `asked`
   * alert on the first tick that reads `asked` while the episode is fresh. A key is added only
   * once the post lands, so a refused post is retried as a first post. Bounded like `posted`.
   */
  const postedUnasked = new Set<string>();
  /**
   * Episodes whose `unasked` post is on the wire. A tick arriving mid-post skips them, as `posted`
   * makes it skip an `asked` or `unknown` post in flight. Every key leaves when its post settles,
   * so the set holds no more than the posts in flight.
   */
  const unaskedInFlight = new Set<string>();
  // Its own window instance, never the question alert's or the permission desk's: shared stamps
  // would let a run of one class spend another's slots and push it into drop, the starvation the
  // damping exists to prevent. The ceilings are the question alert's, because the two are the same
  // class of write: a mention-bearing alert for a session waiting on a person.
  const volume = createAlertVolume({
    now,
    pingCeiling: MAX_QUESTION_PINGS_PER_WINDOW,
    postCeiling: MAX_QUESTION_ALERTS_PER_WINDOW,
    windowMs: ALERT_WINDOW_MS,
  });
  // The window for `unasked` posts alone, of the same ceilings. It only decides whether such a post
  // lands or drops, since an `unasked` post mentions no one; kept apart so a run of them cannot
  // spend the one ping a minute that an `asked` post in the same thread is owed.
  const unaskedVolume = createAlertVolume({
    now,
    pingCeiling: MAX_QUESTION_PINGS_PER_WINDOW,
    postCeiling: MAX_QUESTION_ALERTS_PER_WINDOW,
    windowMs: ALERT_WINDOW_MS,
  });

  /**
   * Episodes whose trouble has already been logged, so a stuck episode costs the log one line
   * rather than one per tick for the length of the freshness window. Every failure class of one
   * episode shares the entry: the first line names the cause, and the retries behind it are the
   * ping pass's ordinary walk, not news. Bounded like `posted`, and an evicted key's cost is the
   * mirror of its sibling's: one repeated line, never a lost one.
   */
  const reported = new Set<string>();

  /** Adds a key to one of the bounded sets, evicting the oldest other key past the ceiling. */
  function remember(held: Set<string>, key: string): void {
    held.add(key);
    if (held.size <= MAX_POSTED_BLOCK_KEYS) return;
    for (const oldest of held) {
      if (oldest === key) continue;
      held.delete(oldest);
      break;
    }
  }

  /** Logs an episode's first trouble line and swallows the repeats the retrying tick would emit. */
  function reportOnce(key: string, message: string): void {
    if (reported.has(key)) return;
    remember(reported, key);
    options.log(message);
  }

  /**
   * One episode's post, fire-and-forget like every write off a timer pass: a ping that could not
   * be posted costs an alert the operator reads as the `⛔` title instead. The log lines carry the
   * cause and the session id only, never the plan or the reason the alert renders: both are
   * kit-shaped on the honest path, but the feed is writable by anything with append access to the
   * operator's home directory, and the log discipline here is uniform.
   *
   * An `asked` or `unknown` post, the second look's `asked` post among them, spends from the
   * mention window and mentions where it answers a ping. An `unasked` post spends from its own
   * window and mentions no one. Each failure path hands back what the post took, so the next tick
   * tries the episode again as it tried it this time.
   */
  async function deliver(
    sessionId: string,
    threadId: string,
    key: string,
    plan: string,
    reason: string | null,
    wait: BlockedWaitState,
  ): Promise<void> {
    const unasked = wait === "unasked";
    const window = unasked ? unaskedVolume : volume;
    const level = window(threadId);
    if (level === "drop") {
      reportOnce(
        key,
        `broker: session ${sessionId}'s blocked alert is over its window; the next tick goes again while the block is fresh`,
      );
      return;
    }
    const mention = !unasked && level === "ping" ? options.operatorIds : [];
    if (unasked) unaskedInFlight.add(key);
    else remember(posted, key);
    // What a post that did not land hands back: its slot, since the window counts messages that
    // reached the channel and a stamp kept for a refusal would quiet or drop the retry that finally
    // lands, and its key, so the fold retries the episode on its next tick.
    const release = (): void => {
      if (!unasked) posted.delete(key);
      window.refund(threadId);
    };
    try {
      const outcome = await options.alert(
        threadId,
        // The fold's reason goes to the renderer as the fold kept it.
        renderBlockedAlert({ operatorIds: mention, plan, reason, state: wait }),
        mention,
      );
      if (outcome.status !== "ok") {
        release();
        reportOnce(
          key,
          `broker: session ${sessionId}'s blocked alert was not written; nothing is queued, ` +
            "the next tick goes again while the block is fresh",
        );
      } else if (unasked) {
        remember(postedUnasked, key);
      } else {
        // A landed second look ends the episode's open state; `posted` now holds it.
        postedUnasked.delete(key);
      }
    } catch {
      release();
      // The message renders event-carried text, so the error detail is withheld: it can quote what
      // it failed to post.
      reportOnce(
        key,
        `broker: session ${sessionId}'s blocked alert could not be posted; ` +
          "the error detail is withheld, it can carry content",
      );
    } finally {
      if (unasked) unaskedInFlight.delete(key);
    }
  }

  /** The seam's answer, with a throw read as `unknown`: a wait the desk cannot place. */
  function readWait(sessionId: string): BlockedWaitState {
    try {
      return waitsOn(sessionId);
    } catch {
      return "unknown";
    }
  }

  function tick(): Promise<void> {
    const result = read(state);
    state = result.state;
    if (result.unreadable) {
      if (!unreadableReported) {
        unreadableReported = true;
        // The path is not named, since it is configurable to anywhere. Distinct wording from the
        // board card's line for the same file, so the log says which surface went blind.
        options.log(
          "broker: the session surface could not read the goal event stream; " +
            "blocked states and their pings lag until it reads again",
        );
      }
    } else {
      unreadableReported = false;
    }

    // The ping pass walks the kept state rather than a queue, which is what makes an episode with
    // no thread yet, or one whose post failed, retry on its own: it is still in the fold, still
    // fresh, and still unrecorded. The same walk is the second look at an episode posted as
    // `unasked`, so it ends where the freshness bound does.
    const at = now();
    const posts: Promise<void>[] = [];
    for (const [sessionId, event] of state.latest) {
      if (event.event !== "goal-blocked") continue;
      if (at - event.tsMs > BLOCKED_PING_FRESH_MS) continue;
      const key = episodeKey(sessionId, event.tsMs);
      if (posted.has(key) || unaskedInFlight.has(key)) continue;
      // No thread yet is not a failure and records nothing: the surface opens threads on its own
      // pass, so the episode simply goes again next tick.
      const threadId = options.threadFor(sessionId);
      if (threadId === null) continue;
      // Read only here, past every gate, so a tick with nothing to post or look at again reads
      // neither the roster nor a ledger.
      const wait = readWait(sessionId);
      // The second look: only an `asked` reading changes an episode posted as `unasked`.
      if (postedUnasked.has(key) && wait !== "asked") continue;
      posts.push(deliver(sessionId, threadId, key, event.plan, event.reason, wait));
    }
    return Promise.all(posts).then(() => undefined);
  }

  return {
    tick,
    standing: (session) => {
      const event = state.latest.get(session.sessionId);
      return (
        event !== undefined && event.event === "goal-blocked" && event.tsMs > session.lastEngagementAt
      );
    },
  };
}
