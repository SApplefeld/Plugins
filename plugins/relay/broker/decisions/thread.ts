// The decisions card's thread: one thread this broker owns in the configured channel, whose starter
// message is the card, edited in place forever after, and whose messages are the asks.
//
// One card, edits only: the thread is
// created once and rebound from the state file across restarts, its name is never changed, and the
// card is rewritten only when the body the renderer composed differs byte for byte from the one this
// broker last saw land.
//
// The card also posts into its thread. An ask the ledger shows open for the first
// time earns one message there, carrying the question whole. That message is edited to its outcome
// when its persona's reading lists the ask recently closed, and to a bare `closed` only when that
// reading could have listed the ask open and did not: the persona is on the roster, its reading
// holds a ledger read from a good file, and its open list is under the reader's cap, so an ask
// absent from it is absent from the file's open asks rather than cut off past the cap. A reading
// that cannot answer leaves the record for a later pass, since a failed read or a dropped persona
// says nothing about the ask. Each pass posts at most `MAX_POSTS_PER_PASS` new asks and edits at
// most `MAX_EDITS_PER_PASS` closed ones, the rest waiting for the next pass, so a fleet opening many
// asks at once never spends a burst of messages. Which ask has which message is the ask map, keyed
// by persona and id as the ledger reader keys its slots, read at construction and handed to the
// caller to persist once per pass that changed it, so a restart neither posts an ask twice nor loses
// the message a close has to edit.
//
// This module reads no setting of its own: whether the card is built at all, and what it reads to
// draw it, are its caller's to decide. It takes the ledger readings, the link resolver, the two
// transports and the refresh interval, and does nothing else with configuration.
//
// Nothing is queued. A call that cannot be afforded, or that Discord refuses for the moment, is
// dropped and retried on the next tick, because the next tick reads every ledger fresh: a queued
// edit would land later carrying asks that had stopped being true.
import { createBudget } from "../discord/budget.ts";
import type { Budget } from "../discord/budget.ts";
import type { CallOutcome, DiscordTransport, ThreadMessenger } from "../discord/transport.ts";
import { createRepeatLog } from "../repeat-log.ts";
import type { RepeatLogSurface } from "../repeat-log.ts";
import { openAsks, renderAskMessage, renderClosedMessage, renderDecisionsCard } from "./card.ts";
import type { AskLink, OpenAsk } from "./card.ts";
import { MAX_ASK_RECORDS, askKey, capAskRecords } from "./binding.ts";
import type { AskRecord, DecisionsCardBinding } from "./binding.ts";
import { MAX_ASKS_PER_LIST } from "./ledger.ts";
import type { LedgerReading } from "./ledger.ts";

/**
 * What the thread is called, for its whole life. Static by design: the name is the operator's handle
 * on the thread in a channel list, and the card inside it carries every changing fact.
 */
export const DECISIONS_THREAD_NAME = "Fleet: Decisions";

/** How many newly seen open asks one pass posts into the thread. The rest wait for the next pass. */
export const MAX_POSTS_PER_PASS = 3;

/** How many closed asks' messages one pass edits to their outcome. The rest wait for the next pass. */
export const MAX_EDITS_PER_PASS = 3;

/**
 * How long one reason waits before it may be logged again, on the board card's own reasoning: wide
 * enough that a refresh timer producing the same line every tick is not what floods the log.
 */
const REPEAT_WINDOW_MS = 5 * 60 * 1000;

/** Refusals of one route inside the decay window, after which that route is not attempted again. */
const MAX_PERMANENT_FAILURES = 3;

/**
 * Rebuilds inside the decay window after Discord reported the card gone, after which the card is
 * given up on, on the board card's own reasoning.
 */
const MAX_REBUILDS = 3;

/** How many refresh passes a failure counts for, on the board card's own reasoning. */
const DECAY_PASSES = 3;

/**
 * The decisions card's repeat log, keyed by the fixed phrase naming the cause; the varying detail
 * rides beside it. Its reasons are a fixed handful of literals, like the sibling cards', so it needs
 * no sweep.
 */
export const DECISIONS_CARD_REPEAT_LOG: RepeatLogSurface<[detail: string]> = {
  windowMs: REPEAT_WINDOW_MS,
  firstLine: (reason, detail) => `decisions card: ${reason} (${detail})`,
  countLine: (reason, suppressed) =>
    `decisions card: ${reason} occurred ${String(suppressed)} more time(s) in the last ` +
    `${String(REPEAT_WINDOW_MS / 60_000)} minutes`,
};

export type DecisionsCardOptions = {
  /** Every roster persona's ledger, read fresh on every tick. */
  ledgers: () => readonly LedgerReading[];
  /**
   * The link resolver for one pass, called once per pass and then once per entry: the caller
   * resolves each persona's session once behind it rather than once per entry.
   */
  links: () => AskLink;
  /** What the card writes to and reads its rate limits from. */
  transport: DiscordTransport;
  /** What the thread's messages are posted and edited through. */
  messenger: ThreadMessenger;
  /**
   * The thread this broker already owns, from the previous run. Read through a call rather than
   * passed, matching the sibling cards. The read happens at construction, not at `start`, so a
   * caller with nothing to build must not construct this module at all.
   */
  binding: () => DecisionsCardBinding | null;
  /** Called whenever the binding is created or changes, so the caller can persist it. */
  onBind?: (binding: DecisionsCardBinding) => void;
  /** The asks already posted into the thread, from the previous run, read at construction. */
  asks: () => readonly AskRecord[];
  /**
   * Called at the end of every pass that changed the ask map, with the whole map held to its cap,
   * so the caller can persist it. A return of `false` reports the write failed, and the map is
   * handed over again on the next pass, changed or not; any other return is a write that landed.
   */
  onAsks?: (asks: readonly AskRecord[]) => boolean | void;
  /** How often the ledgers are re-read and the card re-rendered. An edit is spent only when it
   * changed. */
  refreshMs: number;
  /** Injected so a test drives budgets and ages without sleeping. */
  now?: () => number;
  log?: (message: string) => void;
  /** Injected so a test drives the refresh without waiting on a real interval. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

export type DecisionsCard = {
  /**
   * Reconciles the card and its thread against the ledgers. Safe to call on a timer: a call that
   * lands while a pass is running joins that pass rather than starting a second one, and the promise
   * it returns is the running pass's own.
   */
  tick: () => Promise<void>;
  /** Runs one pass at once and begins the refresh. Calling it twice runs one timer, not two. */
  start: () => void;
  /**
   * Clears the refresh timer synchronously and returns the drain: the promise of a pass already on
   * the wire. Waiting on it is what keeps a shutdown from racing an edit whose binding write has not
   * happened yet, and the synchronous clear is what lets a caller take this timer down in the same
   * block as its own, before it starts awaiting anything.
   */
  stop: () => Promise<void>;
  /**
   * The message the card is drawn on, for the channel's pin list, and null until one exists. Null
   * again for as long as a card Discord reported gone has not been rebuilt, so the pin the old
   * identifier held is dropped rather than kept against a message that is not there.
   */
  cardMessage: () => string | null;
};

/**
 * One Discord route this card writes on, with the budget it spends and the refusals it has taken,
 * on the sibling cards' own reasoning: a message create, a thread create, a message edit, a post
 * into the thread and an edit inside it fail for unrelated reasons and sit on their own rate
 * buckets, so a block on one holds none of the others back.
 */
type Route = {
  budget: Budget;
  /** Refusals in the current run; a landed call on this route clears them. */
  refusals: number;
  /** When the last refusal landed, and null when none has: nothing to accumulate against. */
  refusedAt: number | null;
  /** True once the ceiling is reached. The other routes keep working. */
  stopped: boolean;
  /**
   * What a 404 on this route means. On the card's own routes, and on a post into its thread, the
   * card or its thread is gone and the card is rebuilt. On an edit inside the thread only that one
   * message is gone, which the caller settles by itself, and the card stands. A refusal on that
   * route is that one message's too, as an archived thread refuses an edit, so it never stops the
   * route: the caller closes the message's record, and each record is tried once.
   */
  missing: "rebuild" | "message";
};

function createRoute(missing: Route["missing"]): Route {
  return { budget: createBudget(), refusals: 0, refusedAt: null, stopped: false, missing };
}

/**
 * The count a failure arriving now carries: one more of a run still going, or the first of a new one.
 * A gap wider than the window says nothing about the call being made now, so it starts over.
 */
function accumulate(count: number, last: number | null, at: number, windowMs: number): number {
  return last !== null && at - last < windowMs ? count + 1 : 1;
}

/** The card's thread, built unconditionally from whatever this is handed: the caller decides whether
 * to call this at all, and what the ledgers and the links answer. */
export function createDecisionsCard(options: DecisionsCardOptions): DecisionsCard {
  const log = options.log ?? ((): void => {});
  const transport = options.transport;
  const messenger = options.messenger;
  const now = options.now ?? Date.now;
  const repeats = createRepeatLog(DECISIONS_CARD_REPEAT_LOG, log, now);
  const setTimer = options.setTimer ?? setInterval;
  const clearTimer = options.clearTimer ?? clearInterval;

  // How long a failure of one kind counts toward its ceiling, in wall time.
  const decayMs = options.refreshMs * DECAY_PASSES;

  // Five routes, five budgets, on the sibling cards' own reasoning: these are the card's own budget
  // instances rather than the thread messenger's or the other cards', so a refusal here never delays
  // a permission alert and a busy board never delays this card.
  const posts = createRoute("rebuild");
  const opens = createRoute("rebuild");
  const edits = createRoute("rebuild");
  const askPosts = createRoute("rebuild");
  const askEdits = createRoute("message");

  const persisted = options.binding();
  let messageId = persisted?.messageId ?? null;
  let threadId = persisted?.threadId ?? null;
  // What the card on Discord actually says, as far as an accepted call reported. Null after a
  // restart even when the message is rebound: its ages have moved on regardless, and the one edit
  // that re-establishes them costs less than persisting a body that may already be wrong.
  let rendered: string | null = null;
  let rebuilds = 0;
  let rebuiltAt: number | null = null;
  // Set only by the two failures that end the whole card: a rejected token, and a card being rebuilt
  // faster than it can be kept. A single route giving up carries its own flag instead.
  let halted = false;
  let timer: NodeJS.Timeout | null = null;
  // The pass on the wire, kept so shutdown can wait for it: clearing the timer cancels nothing that
  // has already been sent, or the binding write that follows it.
  let inFlight: Promise<void> = Promise.resolve();
  // The pass currently running, and null between passes. It is what a `tick` arriving mid-pass is
  // answered with, so every caller waits on the call actually on the wire.
  let pass: Promise<void> | null = null;
  // That same pass paired with the one copy of it whose failure is reported, so a timer fire landing
  // on a pass already running waits on that copy instead of attaching a second reporter to it.
  let observed: { pass: Promise<void>; reported: Promise<void> } | null = null;

  // The ask map, keyed by persona and id, in the order the asks were first posted. Read once here,
  // and handed back whole at the end of every pass that changed it.
  const asks = new Map<string, AskRecord>();
  for (const record of options.asks()) asks.set(askKey(record.persona, record.id), record);
  // Whether the map has changed since the caller last reported it written.
  let dirty = false;
  // The personas the last pass's readings named, which is the roster the cap evicts against.
  let roster: ReadonlySet<string> = new Set();

  function bound(): void {
    if (messageId === null) return;
    options.onBind?.({ messageId, threadId });
  }

  function keep(record: AskRecord): void {
    asks.set(askKey(record.persona, record.id), record);
    dirty = true;
  }

  /**
   * Hands the map to the caller once per pass that changed it, held to its cap first so what is
   * written is what is kept. One write per pass rather than one per post, since a pass can post and
   * close several asks and the file is the same after the last. A write the caller reports failed
   * leaves the map pending, so the next pass hands it over again whether or not it changed.
   */
  function remember(): void {
    if (!dirty) return;
    const kept = capAskRecords([...asks.values()], roster);
    if (kept.length !== asks.size) {
      asks.clear();
      for (const record of kept) asks.set(askKey(record.persona, record.id), record);
    }
    dirty = options.onAsks?.(kept) === false;
  }

  /**
   * How many records the map holds open for a persona on the roster, which is how many the cap
   * cannot evict: a departed persona's records go ahead of any of these, so they never hold the map
   * full against an ask that is on the roster.
   */
  function openRecords(): number {
    let count = 0;
    for (const record of asks.values()) {
      if (record.closedAt === null && roster.has(record.persona)) count += 1;
    }
    return count;
  }

  /**
   * The card, or its thread, is gone, which is what an operator deleting either looks like. Both
   * identifiers are dropped so the next tick builds a new card rather than calling a dead one
   * forever, bounded by the rebuild ceiling. The ask map goes with them: every message it names sat
   * in the thread that is gone, and the new thread holds one message per open ask only if each is
   * posted again.
   */
  function gone(at: number): void {
    messageId = null;
    threadId = null;
    rendered = null;
    if (asks.size > 0) {
      asks.clear();
      dirty = true;
    }
    rebuilds = accumulate(rebuilds, rebuiltAt, at, decayMs);
    rebuiltAt = at;
    if (rebuilds < MAX_REBUILDS) return;
    halted = true;
    log(
      `decisions card: the card went missing ${String(rebuilds)} times in a row, ` +
        `it is not rebuilt again`,
    );
  }

  /**
   * Folds one call's outcome into the budget it came from and into the health of this card. A failed
   * call's headers are deliberately not observed: a 4xx reports a bucket with room in it, and letting
   * that clear a standing block would turn a refusal into a retry storm.
   */
  function settle(route: Route, outcome: CallOutcome<unknown>, what: string): void {
    const at = now();
    if (outcome.status !== "failed") route.budget.observe(outcome.rate, at);

    if (outcome.status === "rate-limited") {
      repeats(`the ${what} was dropped and will be retried`, "the bucket is empty");
      return;
    }
    if (outcome.status === "ok") {
      route.refusals = 0;
      route.refusedAt = null;
      return;
    }

    repeats(`the ${what} failed`, outcome.error);
    if (outcome.fatal === true) {
      halted = true;
      // Reported once, and not through the limiter: the REST client discards a rejected token, so
      // every later call would fail complaining about a missing token rather than a refused one, and
      // this card makes none of them.
      log("decisions card: the bot token was rejected, the card is stopped");
      return;
    }
    if (outcome.missing === true) {
      if (route.missing === "rebuild") gone(at);
      return;
    }
    if (outcome.permanent !== true || route.missing === "message") return;
    route.refusals = accumulate(route.refusals, route.refusedAt, at, decayMs);
    route.refusedAt = at;
    if (route.refusals < MAX_PERMANENT_FAILURES) return;
    route.stopped = true;
    log(
      `decisions card: the ${what} was refused ${String(route.refusals)} times in a row, ` +
        `it is not attempted again`,
    );
  }

  /** Whether a route may be spent on now: the card still running, the route not given up on, and
   * its bucket with room. */
  function affordable(route: Route): boolean {
    return !halted && !route.stopped && route.budget.affordable(now());
  }

  /** Posts the card. Returns true when there is a message to work with afterwards. */
  async function post(card: string): Promise<boolean> {
    if (!affordable(posts)) return false;
    const posted = await transport.postCard({ card });
    settle(posts, posted, "card post");
    if (posted.status !== "ok") return false;
    messageId = posted.value.messageId;
    rendered = card;
    bound();
    return true;
  }

  /**
   * Opens the thread on the posted card. Separate from the post against separate failures: a thread
   * that could not be opened leaves a message that is kept and retried against, because reposting the
   * card whenever thread creation failed would fill the channel with orphaned cards at the refresh
   * interval.
   */
  async function openThread(messageIdentifier: string): Promise<void> {
    if (!affordable(opens)) return;
    const opened = await transport.openThread({
      messageId: messageIdentifier,
      name: DECISIONS_THREAD_NAME,
    });
    settle(opens, opened, "thread open");
    if (opened.status !== "ok") return;
    threadId = opened.value.threadId;
    bound();
  }

  async function edit(messageIdentifier: string, card: string): Promise<void> {
    if (!affordable(edits)) return;
    const outcome = await transport.editCard({ messageId: messageIdentifier, card });
    settle(edits, outcome, "card edit");
    if (outcome.status !== "ok") return;
    rendered = card;
  }

  /**
   * Posts one message per open ask the map does not hold yet, oldest first and at most
   * `MAX_POSTS_PER_PASS` of them. A call that does not land ends the posting for this pass, since
   * the next ask would meet the same bucket or the same refusal; the next pass starts over from the
   * oldest ask still missing.
   *
   * A map holding `MAX_ASK_RECORDS` open asks posts nothing: the cap could only make room by
   * dropping an open record, and the ask that record named would then be posted again on the next
   * pass, forever. The pass says so once, with a count and no ask's text, and the posting resumes
   * when a close frees a record.
   */
  async function postAsks(thread: string, open: readonly OpenAsk[], links: AskLink): Promise<void> {
    let posted = 0;
    let held = openRecords();
    for (const ask of open) {
      if (asks.has(askKey(ask.persona, ask.entry.id))) continue;
      if (posted >= MAX_POSTS_PER_PASS || !affordable(askPosts)) return;
      if (held >= MAX_ASK_RECORDS) {
        repeats("the ask map is full, the rest wait for a close", `${String(MAX_ASK_RECORDS)} open asks posted`);
        return;
      }
      const text = renderAskMessage(ask.persona, ask.entry, links(ask.entry, ask.persona));
      const outcome = await messenger.postToThread({ threadId: thread, text });
      settle(askPosts, outcome, "ask post");
      if (outcome.status !== "ok") return;
      posted += 1;
      held += 1;
      keep({
        persona: ask.persona,
        id: ask.entry.id,
        messageId: outcome.value.messageId,
        body: text,
        openedAt: ask.entry.openedAt,
        closedAt: null,
      });
    }
  }

  /**
   * Whether a reading could have listed an ask open and did not: it holds a ledger, read from a
   * good file, and its open list is under the reader's cap, so an ask not on it is not open in the
   * file rather than cut off past the cap.
   */
  function answers(ledger: LedgerReading): boolean {
    return ledger.hasLedger && ledger.fileAge !== null && ledger.open.length < MAX_ASKS_PER_LIST;
  }

  /**
   * Edits the message of every ask the map holds open whose persona's reading shows it closed, at
   * most `MAX_EDITS_PER_PASS` of them: to its outcome where the reading lists it recently closed,
   * and to closed alone where the reading could have listed it open and does not. A record whose
   * persona has no reading this pass, or whose reading cannot answer, is left for a later pass. A
   * message Discord reports gone or refuses to edit is marked closed too, with no second attempt. A
   * rejected token refuses every call rather than this message, so its record stays open. A message
   * that was posted with no readable id is marked closed with no call made.
   */
  async function closeAsks(thread: string, ledgers: readonly LedgerReading[], at: number): Promise<void> {
    const readings = new Map<string, LedgerReading>();
    for (const ledger of ledgers) if (!readings.has(ledger.name)) readings.set(ledger.name, ledger);
    let edited = 0;
    for (const record of [...asks.values()]) {
      if (record.closedAt !== null) continue;
      const ledger = readings.get(record.persona);
      if (ledger === undefined) continue;
      if (ledger.open.some((entry) => entry.id === record.id)) continue;
      const closed = ledger.recentlyClosed.find((entry) => entry.id === record.id) ?? null;
      if (closed === null && !answers(ledger)) continue;
      if (record.messageId === null) {
        keep({ ...record, closedAt: at });
        continue;
      }
      if (edited >= MAX_EDITS_PER_PASS || !affordable(askEdits)) return;
      const text = renderClosedMessage(record.body, closed, at);
      const outcome = await messenger.editInThread({ threadId: thread, messageId: record.messageId, text });
      settle(askEdits, outcome, "ask edit");
      // A message Discord reports gone, or refuses to edit, is settled closed: the same edit sent
      // again is refused again, and an open record left behind would hold the map toward its cap. A
      // rejected token refuses every call rather than this message, so its record stays open.
      const landed =
        outcome.status === "ok" ||
        (outcome.status === "failed" &&
          outcome.fatal !== true &&
          (outcome.missing === true || outcome.permanent === true));
      if (!landed) return;
      edited += 1;
      keep({ ...record, closedAt: at });
    }
  }

  /** One pass over the card and its thread. The ask map is handed to the caller after it, once,
   * whichever step changed it, a thread reported gone included. */
  async function run(): Promise<void> {
    try {
      await reconcile();
    } finally {
      remember();
    }
  }

  async function reconcile(): Promise<void> {
    const at = now();
    const ledgers = options.ledgers();
    roster = new Set(ledgers.map((ledger) => ledger.name));
    const links = options.links();
    const card = renderDecisionsCard(ledgers, links, at);

    // Creation first, and it is not held back by anything else: a card is worth far more than an
    // empty channel.
    if (messageId === null) await post(card);
    const identifier = messageId;
    if (identifier === null) return;
    if (threadId === null) await openThread(identifier);
    // The open can report the card itself gone, which drops the identifier this pass is holding.
    // Editing it anyway would spend a call on a message Discord has already said is not there.
    if (messageId === null) return;

    // A card that already says the right thing costs no Discord call.
    if (card !== rendered) await edit(identifier, card);

    // The thread's messages, once the card and the thread both stand: the asks newly seen open, then
    // the ones the ledgers have since closed. Each is bounded per pass and reads the same readings
    // the card was drawn from, so the thread never says more than the card does.
    const thread = threadId;
    if (thread === null || messageId === null || halted) return;
    await postAsks(thread, openAsks(ledgers), links);
    if (threadId === null || halted) return;
    await closeAsks(thread, ledgers, at);
  }

  /**
   * One pass at a time. A caller arriving mid-pass is answered with the pass already running rather
   * than with a promise of nothing: shutdown waits on what this returns, and a resolved stand-in
   * there would let a broker go down with a post still on the wire, whose binding never lands and
   * whose card the next start posts a second time.
   */
  function tick(): Promise<void> {
    if (halted) return Promise.resolve();
    if (pass !== null) return pass;
    const started = run().finally(() => {
      pass = null;
    });
    pass = started;
    return started;
  }

  /** One refresh pass, held so shutdown can wait for it. */
  function fire(): void {
    // A fire that joined the pass already running takes the copy that pass is already reported on.
    // One pass that fails is one failure however many fires observed it, and a second reporter on
    // the same rejection would count it again and log a repeat that never happened.
    if (observed !== null && observed.pass === pass) {
      inFlight = observed.reported;
      return;
    }
    // A rejection out of a pass would be fatal to the process under Node 24, taking the hook intake
    // down with the card, and the intake is the half that has to keep running.
    const started = tick();
    const reported = started.catch(() => {
      // The error is discarded unread: a transport failure can carry the request object, which holds
      // both the credential and the body the call was writing, and a ledger read failure can carry
      // a path under the operator's own profile.
      repeats("a refresh pass failed", "the detail is withheld, it can carry the request");
    });
    observed = { pass: started, reported };
    inFlight = reported;
  }

  return {
    tick,

    cardMessage: () => messageId,

    start: () => {
      if (timer !== null) return;
      timer = setTimer(fire, options.refreshMs);
      // And one pass now, rather than one interval from now. Creating or rebinding the thread is what
      // starting is for, and at the configured ceiling the card would otherwise be absent from the
      // channel for a refresh interval after a restart.
      fire();
    },

    stop: (): Promise<void> => {
      // Cleared before anything is awaited and before this returns, so a caller can take this timer
      // down in the same synchronous block as its own and await the drain later.
      if (timer !== null) clearTimer(timer);
      timer = null;
      // Every pass the timer starts is assigned here, which is every pass in a running card. A
      // `tick` a caller drives by hand is that caller's own to await.
      return inFlight;
    },
  };
}
