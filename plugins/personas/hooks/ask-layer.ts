// ask-layer.ts: the ask layer, the questions the persona module puts to Jev
// and to the operator. It holds the shadow measurement beside a Haiku call,
// the live ask whose answer a branch may read, the plan health measurement
// at a turn's end, the outcome joiner, the held tick's open blocking asks
// with their re-raise and timeout, the ledger's open and its withdraw of a
// lifted entry, and the one path a worker's ask opens by.
// hooks/index.ts holds the wiring: the deps each call takes, the session
// object these functions read and write, the turn's Jev call counters the
// journal's call lines bump, and the [STILL WAITING] turn's frame and
// submit, which test-personas/injection-ledger.mjs sizes from that file.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts, so each function here takes
// an AskLayerDeps, or the slice of it the journal-only functions read, that
// hooks/index.ts builds at each call. The session crosses as the object
// itself, so each field is read at the moment the code reads it. The module
// holds no state of its own, since the tick harness evaluates it once per
// process while it loads a fresh hooks/index.ts per case.

import { type AgentState, type AskEntry, type AskOpener, type AskOpenRefusal, closeAsk, liftAsk, openAsk, openAskEntries, openBlockingAsks, oweAskBrief } from "./agent-state";
import type { ExpectedTurn } from "./channel-text";
import type { CommonsStore } from "./commons";
import { newStampId, writeAnswers, writeCall, writeOutcome, type JournalWrite, type OutcomeKind } from "./decision-journal";
import { ask, askAll, heldFailure, holdFor, HOLD_TIMEOUT, type HoldHost, type HoldTimeout, type QuestionAsk, type QuestionResolver, type SeamResult, type SeamSetResult } from "./decision-seam";
import type { PluginHost } from "./host";
import { journalValuesOf, shadowMsOf, type HookBudget, type LiveAskResult } from "./jev-live";
import { askKey, readAskRecord, writeAskRecord } from "./operator";
import { PLAN_HEALTH_SITE } from "./plan-route";
import { PLAN_HEALTH_SET_IDS, PLAN_HEALTH_STATE_CLOSING, PLAN_HEALTH_STATE_RECENT, resolverOf, SHIPPED_QUESTIONS } from "./question-catalog";
import type { SessionState } from "./session-state";
import { ASK_MARKER_LINE_BREAK, ASK_TURN_MAX, newAskId, openAskBy, shouldSuppressReask, type WorkerAskRefusal } from "./worker-ask";

// The session fields the ask layer reads and writes, which the session object
// in hooks/index.ts satisfies.
export type AskSession = Pick<SessionState, "persona" | "mySessionId" | "state">;

// What hooks/index.ts hands the ask layer: the session, the journal's two
// call-line and write-failure notes and the wait rule's decision writer, which
// the journal-only functions read, and the commons store, the persist, the
// re-raise turn's submit and the toast over `$`, which the ledger's
// functions, tickOpenAsk and openWorkerAsk read as well.
export interface AskLayerDeps {
  session: AskSession;
  noteJevCallLine: (write: JournalWrite, result: { latencyMs: number | null }) => void;
  noteJournalWrite: (write: JournalWrite, site: string) => void;
  pushHoldDecision: (action: string, detail: string) => void;
  store: CommonsStore;
  persist: () => Promise<boolean>;
  submitStillWaitingReraise: (expectedTurns: ExpectedTurn[], due: readonly AskEntry[]) => Promise<void>;
  toast: (text: string) => void;
}

// The slice of AskLayerDeps the journal-only functions read, which a caller
// holding no `$` builds.
export type AskJournalDeps = Pick<AskLayerDeps, "session" | "noteJevCallLine" | "noteJournalWrite" | "pushHoldDecision">;

/**
 * Start one shadow measurement beside a Haiku call that has already returned,
 * and journal it once it settles. Returns the stamp id its lines carry, or
 * null where the kill switch is off, which is also what the two outcome
 * joiners read as having no call to cite.
 *
 * Nothing here is awaited by the caller, so a slow, failing or hung Jev cannot
 * delay the tick or the turn it sits in. Nothing it produces reaches a branch,
 * a state field, a decision action or a nudge text: Haiku has already decided
 * by the time this runs, and the only state it touches is the one decision an
 * unwritable journal earns.
 *
 * `mode` off stops the writing as well as the sending. The seam would answer
 * an off call with an off result and the journal would write it, which on a
 * machine where the operator turned Jev off is a file per session per day
 * saying so.
 */
// `resolve` is the resolver the seam reads the question through, the host's
// own by default. The controller passes the resolver that already answered
// for this tick, so the option descriptions its state embeds and the
// criteria the request carries come from one resolution rather than two
// reads of the override layer that could straddle an edit.
//
// `onResult`, where given, receives the seam's result once its journal lines
// are written, so a chain that is itself unawaited can read a shadow verdict
// for its own journal row. It is called exactly once on every path but the
// kill switch's null return: with null where a host broke the seam's or the
// journal's never-rejects contract, so a waiter on it always settles. A
// throw inside it on the result path is caught below with the rest of the
// chain.
export function shadowAsk(
  deps: AskJournalDeps,
  host: PluginHost,
  site: string,
  questionSetId: string,
  optionIds: readonly string[],
  state: string,
  mode: string,
  haikuValue: string | null,
  resolve: QuestionResolver = resolverOf(host),
  onResult?: (result: SeamResult | null) => void,
  budget?: HookBudget,
): string | null {
  // The bound is read here, as the call fires and before any await, so a
  // shadow fired from a running handler takes its share of that hook's budget
  // as it stands now, and the seam's own awaits cannot move the reading past
  // the handler's return. The exact string `shadow` and nothing else. The seam's other sending
  // mode, `live`, is its own internal mode: liveAsk chooses it per question
  // and hands it to the seam directly, and it is not a settings value. So a
  // settings file hand-edited to `live` reads here as off, which sends
  // nothing and writes no line saying so.
  if (mode !== "shadow") return null;
  // Read once here rather than in the continuation: these name the session the
  // call was made in, and the continuation runs after the caller has returned.
  const persona = deps.session.persona;
  const session = deps.session.mySessionId;
  // Minted when the call starts rather than when it settles, so a joiner
  // always has an id to cite even where its outcome line reaches the file
  // before this call's own line does.
  const stampId = newStampId(persona, session);
  const shadowMs = shadowMsOf(budget);
  void ask(host, questionSetId, optionIds, state, mode, haikuValue, resolve, shadowMs)
    .then(async (result: SeamResult) => {
      const callWrite = await writeCall(host, {
        stampId,
        persona,
        session,
        site,
        questionSet: questionSetId,
        mode,
        result,
      });
      deps.noteJevCallLine(callWrite, result);
      deps.noteJournalWrite(callWrite, site);
      // A failed call has no answer to record, and writeAnswers would write
      // nothing for it anyway.
      if (result.ok) {
        deps.noteJournalWrite(await writeAnswers(host, {
          persona,
          session,
          answers: [{
            callStampId: stampId,
            questionId: result.questionId,
            questionVersion: result.questionVersion,
            overrideRefused: result.overrideRefused,
            primitive: result.primitive,
            value: result.answer.choice,
            probabilities: result.answer.probabilities,
            confidence: result.answer.confidence,
            haikuValue: result.haikuValue,
          }],
        }), site);
      }
      if (onResult) onResult(result);
    })
    .catch(() => {
      // The seam and the journal each hold a never-rejects contract, so this
      // catches a host that broke one rather than a path either module takes.
      // It stays because no caller awaits this chain: a rejection with nothing
      // attached is an unhandled rejection, which ends the process rather than
      // losing one measurement. The hook still fires, with no result, so a
      // waiter on it is never left pending.
      if (onResult) {
        try { onResult(null); } catch { /* the waiter's own throw; nothing awaits this chain */ }
      }
    });
  return stampId;
}

/**
 * The one entry point for a question that may be asked live, and the only
 * wrapper whose return a branch may read. Takes shadowAsk's arguments with
 * the live list in place of Haiku's value, since no classifier answers these
 * questions.
 *
 * Where `jevMode` is not `shadow`, or `jevLive` does not name the question,
 * this is shadowAsk with the same arguments: the question is journaled in
 * shadow, nothing is awaited, and the return is null. Where both hold, the
 * seam is awaited in mode `live`, the call and answer lines are written with
 * that mode, and the return carries the stamp id those lines carry, with
 * either the validated answer or the reason the call failed. The reason is
 * the seam's own closed failure reason, read off the result's `ok` rather
 * than off a list of reasons so a reason added to the seam is a failure here
 * too, or `rejected` where a host broke the seam's never-rejects contract.
 *
 * So null means only that the question was not live, and a caller that
 * needs nothing but the answer reads a `reason` return as it reads null: the
 * question's stated default. A caller that joins something to the live call,
 * or names why it fell back, reads the stamp id and the reason as well.
 *
 * A live call is awaited on the hook that asked it, and `event` names that
 * hook's event. `budget` is that hook's own, built by hookBudgetOf in hooks/index.ts. The one
 * exception is step-effort's call, which turn.step fires and never awaits,
 * under the turn.step.effort event with an unmetered budget, so its hold
 * runs on a detached chain. The call holds through holdFor at the
 * wait rule's Jev figure for that event, held under the hook's remaining
 * budget, from the moment this is called, which covers the key read, the
 * override resolver and the request alike; that hold is the call's one
 * bound, since the seam's live mode races no timer of its own. Where the hold
 * gives up, the call's line is written as a timeout with the time held, and
 * the return carries the `timeout` reason. The hold's timer is aborted when
 * the call answers first. The two journal writes are not awaited: they ride
 * a detached chain, as shadowAsk's do, since an append rewrites the day's
 * file and queues behind every pending append to it, and a hook holding for
 * that would hold past the budget. Nothing here can throw into the path,
 * given the one precondition the caller owes: `jevLive` is an array. The
 * list is read with `includes` and nothing here checks its shape, since the
 * shape belongs to the settings read that turns the configured value into
 * this list, filtered to the promotable set. `jevMode` is read before the
 * list, so under `off` a question the list names is not sent either.
 *
 * `onStamp` is how a caller learns the stamp id before the await, on both
 * paths, including the not-live one whose null return carries none: it is
 * called once per call with the stamp id the journal lines carry, or null
 * where no line was written at all (the kill switch off, which mints no id).
 * The comment at the call itself names the one case where a minted id
 * reaches no line. A caller with no outcome to write passes nothing.
 *
 * hooks/index.ts exports a wrapper under this name, so the test suite can
 * call it directly over the fake host.
 */
export async function liveAsk(
  deps: AskJournalDeps,
  host: PluginHost,
  event: string,
  budget: HookBudget,
  site: string,
  questionSetId: string,
  optionIds: readonly string[],
  state: string,
  jevMode: string,
  jevLive: readonly string[],
  onStamp?: (stampId: string | null) => void,
): Promise<LiveAskResult | null> {
  if (jevMode !== "shadow" || !jevLive.includes(questionSetId)) {
    const shadowStampId = shadowAsk(deps, host, site, questionSetId, optionIds, state, jevMode, null, undefined, undefined, budget);
    if (onStamp) onStamp(shadowStampId);
    return null;
  }
  // The seam's live mode is chosen here, per question, and never read from
  // the settings: `jevMode` admits `shadow` alone as a sending value.
  const mode = "live";
  const persona = deps.session.persona;
  const session = deps.session.mySessionId;
  const stampId = newStampId(persona, session);
  // Handed over before the await, so a caller holds the stamp whatever the
  // request then does: a result carrying a failure reason writes its call line
  // all the same, and the outcome that joins it is about what the plugin
  // observed rather than about an answer that came back. The one stamp that
  // joins nothing is the catch below: a host that broke the seam's never-
  // rejects contract sends this call back before any line is written, and the
  // caller is already holding the id. A labelling pass reads that as an
  // outcome line whose call line is absent.
  if (onStamp) onStamp(stampId);
  const heldFrom = Date.now();
  const hold: HoldHost = { sleep: (ms: number, signal: AbortSignal) => host.sleep(ms, signal), decide: deps.pushHoldDecision, remainingMs: budget.remainingMs };
  let held: SeamResult | HoldTimeout;
  try {
    held = await holdFor(hold, event, "jev", ask(host, questionSetId, optionIds, state, mode, null, resolverOf(host)));
  } catch {
    // As in shadowAsk: the seam never rejects, so this catches a host that
    // broke that contract. This await sits on a hook's path, so the catch is
    // what keeps a broken host from throwing into it. The reason is this
    // wrapper's own, since no seam reason names a call that never resolved.
    return { stampId, reason: "rejected" };
  }
  const result: SeamResult = held === HOLD_TIMEOUT ? heldFailure(questionSetId, Date.now() - heldFrom, null) : held;
  // The journal writes ride a detached chain, as shadowAsk's do, so the hook
  // that awaited the answer is not held for them.
  void writeCall(host, {
    stampId,
    persona,
    session,
    site,
    questionSet: questionSetId,
    mode,
    result,
  })
    .then(async (write) => {
      deps.noteJevCallLine(write, result);
      deps.noteJournalWrite(write, site);
      // A failed call has no answer to record, and writeAnswers would write
      // nothing for it anyway.
      if (!result.ok) return;
      deps.noteJournalWrite(await writeAnswers(host, {
        persona,
        session,
        answers: [{
          callStampId: stampId,
          questionId: result.questionId,
          questionVersion: result.questionVersion,
          overrideRefused: result.overrideRefused,
          primitive: result.primitive,
          value: result.answer.choice,
          probabilities: result.answer.probabilities,
          confidence: result.answer.confidence,
          haikuValue: null,
        }],
      }), site);
    })
    .catch(() => {
      // The journal holds a never-rejects contract, so this catches a host
      // that broke it rather than a path the module takes. It stays because
      // no caller awaits this chain: a rejection with nothing attached is an
      // unhandled rejection, which ends the process rather than losing one
      // measurement.
    });
  return result.ok ? { stampId, answer: result.answer } : { stampId, reason: result.reason };
}

/**
 * Start the plan health measurement at the end of a turn on a plan entry:
 * block-owner alone, in one request over one state, journaled once it
 * settles as one call line and one answer line. Returns the stamp id its
 * lines carry, or null where the kill switch is off, which is also what the
 * next_speaker joiner reads as having no call to cite.
 *
 * Not awaited by the caller, for the reason shadowAsk is not: a slow,
 * failing or hung Jev cannot delay the turn's end. Nothing it produces
 * reaches a branch, a state field, a decision action or a nudge text; the
 * only state it touches is the one decision an unwritable journal earns.
 * There is no Haiku value beside the answer, since no classifier asks it:
 * what it is measured against is the next_speaker outcome the plugin writes
 * from what it observes afterwards.
 */
export function shadowAskPlanHealth(
  deps: AskJournalDeps,
  host: PluginHost,
  closingText: string,
  recentClosingTexts: readonly string[],
  mode: string,
  budget?: HookBudget,
): string | null {
  if (mode !== "shadow") return null;
  // Read as the call fires, for shadowAsk's reason.
  const shadowMs = shadowMsOf(budget);
  const persona = deps.session.persona;
  const session = deps.session.mySessionId;
  const stampId = newStampId(persona, session);
  // PLAN_HEALTH_SET_IDS decides both the sets this request asks and the
  // questionSet its call line journals. Each ask takes its primitive and
  // option ids from the set's shipped catalog entry, and the seam resolves
  // its wording through the catalog's resolver.
  const asks: readonly QuestionAsk[] = PLAN_HEALTH_SET_IDS.map((questionSetId): QuestionAsk => {
    const shipped = SHIPPED_QUESTIONS[questionSetId];
    return shipped.primitive === "choice"
      ? { questionSetId, primitive: "choice", optionIds: Object.keys(shipped.options) }
      : { questionSetId, primitive: shipped.primitive };
  });
  // The one state the request carries, whose fields a question names by
  // their field names. The replay's byte-identity check in
  // .kit/jev-gold/replay.mjs rebuilds this object from the journaled text and
  // compares it byte for byte, so it holds while recentClosingTexts stays in
  // the state and the two fields keep this order.
  const state = {
    [PLAN_HEALTH_STATE_CLOSING]: closingText,
    [PLAN_HEALTH_STATE_RECENT]: recentClosingTexts,
  };
  void askAll(host, asks, state, mode, resolverOf(host), shadowMs)
    .then(async (result: SeamSetResult) => {
      const callWrite = await writeCall(host, {
        stampId,
        persona,
        session,
        site: PLAN_HEALTH_SITE,
        questionSet: PLAN_HEALTH_SET_IDS.join(","),
        mode,
        result,
      });
      deps.noteJevCallLine(callWrite, result);
      deps.noteJournalWrite(callWrite, PLAN_HEALTH_SITE);
      if (!result.ok) return;
      deps.noteJournalWrite(await writeAnswers(host, {
        persona,
        session,
        answers: result.answers.map((answered) => ({
          callStampId: stampId,
          questionId: answered.questionId,
          questionVersion: answered.questionVersion,
          overrideRefused: answered.overrideRefused,
          primitive: answered.primitive,
          ...journalValuesOf(answered.answer),
          haikuValue: null,
        })),
      }), PLAN_HEALTH_SITE);
    })
    .catch(() => {
      // As in shadowAsk: nothing awaits this chain, so a host that broke a
      // never-rejects contract is caught here rather than ending the process.
    });
  return stampId;
}

/**
 * Join one signal the plugin produced onto the shadow call held for it. Not
 * awaited, for the reason shadowAsk is not, and the value it writes is read
 * from nothing the journal returns.
 */
export function shadowOutcome(deps: AskJournalDeps, host: PluginHost, callStampId: string, kind: OutcomeKind, value: string): void {
  void writeOutcome(host, { persona: deps.session.persona, session: deps.session.mySessionId, callStampId, kind, value })
    .then((write) => deps.noteJournalWrite(write, kind))
    .catch(() => { /* as in shadowAsk: nothing awaits this chain. */ });
}

// Withdraws the open entry of `opener` on `nodeId` whose hold was lifted, so
// the opener can open a fresh blocking one in its place: the condition it
// asked about holds again, and the lifted entry no longer stops the work.
// The entry closes as withdrawn by ask_close, since the Approach's close
// routes name no controller route, with a note naming its successor, and its
// commons record takes withdrawn where it is still open. The successor's id
// is the one newAskId gives at `now`, which is the id openLedgerAsk computes
// for the open that follows at the same `now`, because a close frees no id.
// The close runs before that open, so the open cap never counts the
// predecessor against its successor. Nothing happens where no lifted own
// entry stands.
export async function withdrawLiftedAskBy(deps: AskLayerDeps, state: AgentState, persona: string, opener: AskOpener, nodeId: string, now: number): Promise<void> {
  const own = openAskBy(state, opener, nodeId);
  if (own === undefined || own.blocking) return;
  const successorId = newAskId(state, nodeId, now);
  const store = deps.store;
  const askRecord = await readAskRecord(store, persona, own.id);
  if (askRecord && askRecord.status === "open") {
    askRecord.status = "withdrawn";
    await store.set(askKey(persona, own.id), askRecord);
  }
  closeAsk(state, own.id, "withdrawn", "ask_close", `replaced by ${successorId}`, now);
}

// Opens one ledger entry on `nodeId` and, where the open was accepted, its
// commons record in the same step. Returns the entry, or the refusal with
// nothing written: the caller logs a "cap" refusal as ask_cap_refused. A
// record write that throws undoes the open whole before the throw goes on,
// since an entry with no record would hold the work on a question no reader
// session can see or answer.
export async function openLedgerAsk(
  deps: AskLayerDeps,
  state: AgentState,
  persona: string,
  ownerSessionId: string,
  nodeId: string,
  question: string,
  recommend: string,
  opener: AskOpener,
  blocking: boolean,
  now: number,
): Promise<AskEntry | AskOpenRefusal> {
  const node = state.goals.find((g) => g.id === nodeId);
  const id = newAskId(state, nodeId, now);
  const result = openAsk(state, {
    id,
    nodeId,
    planPath: node?.planPath ?? null,
    entryTitle: node?.title ?? "",
    question,
    recommend,
    opener,
    blocking,
  }, now);
  if (typeof result === "string") return result;
  try {
    await writeAskRecord(deps.store, persona, id, nodeId, question, ownerSessionId);
  } catch (err) {
    state.asks = state.asks.filter((entry) => entry !== result);
    throw err;
  }
  return result;
}

/**
 * D5: the open blocking asks during a held tick.
 * Returns "waiting" while every open blocking entry is inside its wait
 * (persist and return), "expired" where at least one entry's wait elapsed
 * this tick (its hold lifts, the entry stays open, no status moves and
 * nothing is activated; persist, return), and "none" where no open blocking
 * entry stands (the caller proceeds normally). A non-blocking entry is read
 * by none of this: it is never re-raised and never times out.
 */
export async function tickOpenAsk(
  deps: AskLayerDeps,
  state: AgentState,
  persona: string,
  cfg: Record<string, unknown>,
  contextId: string | null,
  // register()'s list of queued plugin turns, so the re-raise, which
  // submitStillWaitingReraise in hooks/index.ts submits, can be queued as a
  // plugin-opened turn for the stamp guard at turn.start.
  expectedTurns: ExpectedTurn[],
): Promise<"waiting" | "expired" | "none"> {
  const blocking = openBlockingAsks(state);
  if (blocking.length === 0) return "none";
  const store = deps.store;

  const now = Date.now();
  const lastAskWaiting = state.decisions.findLast((d) => d.action === "ask_waiting");
  if (!lastAskWaiting || now - lastAskWaiting.timestamp >= 60_000) {
    state.decisions.push({
      timestamp: now,
      loop: "monitor",
      action: "ask_waiting",
      detail: `${contextId ? contextId + ": " : ""}ask ${blocking.map((entry) => entry.id).join(", ")} still open`,
    });
  }

  // D5b (bullet 3): a quiet channel means the operator may never see the
  // ask_waiting log line. Past a bounded window, re-raise each question into
  // the thread once (a real turn, not a log line) rather than sit silent. One
  // turn carries every entry due this tick, each stamped on the ledger and,
  // where its record is in the store, on the record too.
  const reraiseMs = typeof cfg.askReraiseWindowMs === "number" ? (cfg.askReraiseWindowMs as number) : 15 * 60_000;
  const due = reraiseMs > 0 ? blocking.filter((entry) => entry.reraisedAt === null && now - entry.openedAt >= reraiseMs) : [];
  if (due.length > 0) {
    for (const entry of due) {
      entry.reraisedAt = now;
      const askRecord = await readAskRecord(store, persona, entry.id);
      if (askRecord) {
        askRecord.reraisedAt = now;
        await store.set(askKey(persona, entry.id), askRecord);
      }
      state.decisions.push({
        timestamp: now,
        loop: "monitor",
        action: "ask_reraised",
        detail: `${contextId ? contextId + ": " : ""}ask ${entry.id} re-raised after ${Math.round((now - entry.openedAt) / 1000)}s: ${entry.question.slice(0, 100)}`,
      });
    }
    await deps.submitStillWaitingReraise(expectedTurns, due);
  }

  // Round 34: an absent option must still resolve to a real wait, not to 0 -
  // whether the engine fills plugin.json's userConfig default into `cfg` is
  // not established anywhere in this repo, so the code fallback carries its
  // own default (60 minutes, larger than the 15-minute re-raise window),
  // matching how the askReraiseWindowMs fallback above is written in code.
  // A wait of 0 is no timeout.
  const waitMs = typeof cfg.askOperatorWaitMs === "number" ? (cfg.askOperatorWaitMs as number) : 3_600_000;
  let lifted = false;
  if (waitMs > 0) {
    for (const entry of blocking) {
      const elapsed = now - entry.openedAt;
      if (elapsed < waitMs) continue;
      // The timeout lifts the hold and nothing else: the entry stays open on
      // the ledger and in the commons, since the question is still the
      // operator's to answer, and the work proceeds on its recommendation.
      // The asked entry keeps its status and no other entry is activated, so
      // the controller's nudges resume on the entry that asked. The decision
      // carries the id as a field, which is how the next nudge on the entry
      // finds the question it names as timed out, and lastAskClosedAt takes
      // this clock so the re-ask guard reads the lift as it reads a close.
      state.decisions.push({
        timestamp: now,
        loop: "monitor",
        action: "ask_timeout",
        detail: `${contextId ? contextId + ": " : ""}ask ${entry.id} timed out after ${Math.round(elapsed / 1000)}s, work proceeds on its recommendation`,
        askId: entry.id,
      });
      liftAsk(state, entry.id);
      const askedNode = state.goals.find((n) => n.id === entry.nodeId);
      if (askedNode) {
        askedNode.lastAskQuestion = entry.question;
        askedNode.lastAskClosedAt = now;
      }
      lifted = true;
    }
  }
  if (lifted) {
    await deps.persist();
    return "expired";
  }
  await deps.persist();
  return "waiting";
}

// Opens one worker ask on `nodeId`, the one path both of the worker's routes
// take: an ASK: line in its closing text, which turn.complete reads, and the
// ask_open tool. `question` is the stored question, recommendation joined,
// and `recommend` the choice alone. Both are folded to one line at
// ASK_MARKER_LINE_BREAK, which a line already is, so a tool's text reaches
// the ledger, the [GOAL TREE] block and the card in the shape a line's does.
// `placeholderScope` is the text the placeholder refusal reads: the whole
// line for a line, and the question alone for the tool, whose recommendation
// may carry angle brackets of its own, such as a generic type. `turn` holds
// the count of this turn's opens that the per-turn cap reads: the session's
// own count for the tool, and for the line route the count turn.complete
// took before its first await, so a turn.start landing mid-handler cannot
// reset the completing turn's count.
// The guards run in this order: the placeholder refusal, the re-ask
// suppression, the same-question-open refusal, the per-turn cap, and the
// open cap inside openLedgerAsk. The first three log their decision here.
// The two caps log nothing, since the line route folds a turn's cap
// refusals into one ask_cap_refused and the tool logs its own. Every guard
// and the entry's push into the ledger run before the first await, and the
// turn's count is reserved there too and released on a refusal or a throw,
// so parallel calls in one assistant message each see the opens before them
// and cannot together pass a cap or open one question twice. An accepted
// open logs ask_opened naming the route where it is the tool, and toasts
// the question. A refusal writes no entry and no commons record.
export async function openWorkerAsk(
  deps: AskLayerDeps,
  route: "line" | "tool",
  turn: { asksOpenedThisTurn: number; endedAt?: number },
  nodeId: string,
  question: string,
  placeholderScope: string,
  recommend: string,
  blocking: boolean,
  suppressMs: number,
): Promise<AskEntry | WorkerAskRefusal> {
  const storedQuestion = question.split(ASK_MARKER_LINE_BREAK).join(" ");
  const storedRecommend = recommend.split(ASK_MARKER_LINE_BREAK).join(" ");
  // A worker that copies a template without filling it in is not stating a
  // fork.
  if (/<[^<>]+>/.test(placeholderScope)) {
    deps.session.state.decisions.push({
      timestamp: Date.now(),
      loop: "monitor",
      action: "ask_marker_placeholder_refused",
      detail: `worker's ${route === "line" ? "ASK line" : "ask_open question"} still carries a template placeholder, refused: ${storedQuestion.slice(0, 100)}`,
    });
    return "placeholder";
  }
  const askedNode = deps.session.state.goals.find((node) => node.id === nodeId);
  if (shouldSuppressReask(askedNode, storedQuestion, Date.now(), suppressMs)) {
    deps.session.state.decisions.push({
      timestamp: Date.now(),
      loop: "monitor",
      action: "ask_reask_suppressed",
      detail: `${nodeId}: suppressed identical question closed ${Math.round((Date.now() - (askedNode?.lastAskClosedAt || Date.now())) / 1000)}s ago: ${storedQuestion.slice(0, 80)}`,
    });
    return "reask";
  }
  // A question already open on this node, from an earlier turn or earlier
  // in this one by either route, is not opened again: the operator holds it
  // once, and a restatement adds nothing to the ledger.
  if (openAskEntries(deps.session.state).some((entry) => entry.nodeId === nodeId && entry.question === storedQuestion)) {
    deps.session.state.decisions.push({
      timestamp: Date.now(),
      loop: "monitor",
      action: "ask_reask_suppressed",
      detail: `${nodeId}: the same question is already open: ${storedQuestion.slice(0, 80)}`,
    });
    return "already-open";
  }
  if (turn.asksOpenedThisTurn >= ASK_TURN_MAX) return "turn-cap";
  turn.asksOpenedThisTurn += 1;
  let opened: AskEntry | AskOpenRefusal;
  try {
    opened = await openLedgerAsk(deps, deps.session.state, deps.session.persona, deps.session.mySessionId, nodeId, storedQuestion, storedRecommend, "worker", blocking, Date.now());
  } catch (err) {
    turn.asksOpenedThisTurn -= 1;
    throw err;
  }
  // The id is fresh and a worker's question carries "Recommend:", so it is
  // never the seed question, and the open cap is the one refusal it meets.
  if (typeof opened === "string") {
    turn.asksOpenedThisTurn -= 1;
    return opened;
  }
  // Every open here is the worker's, so every accepted one owes the brief
  // the controller tick drafts, by either route. A line is read after its
  // turn has ended, so its item owes already stamped with the end the
  // turn.complete handler read at its delete.
  oweAskBrief(deps.session.state, opened, Date.now(), route === "line" ? turn.endedAt : undefined);
  deps.session.state.decisions.push({
    timestamp: Date.now(),
    loop: "monitor",
    action: "ask_opened",
    detail: `${nodeId}: worker-stated fork${route === "tool" ? " by ask_open" : ""}${blocking ? " (blocking)" : ""}: ${storedQuestion.slice(0, 100)} (ask ${opened.id})`,
  });
  try { deps.toast(`Agentic: ${storedQuestion.slice(0, 100)}`); } catch { /* non-fatal */ }
  // A blocking entry is itself the hold on the idle branch, so the entry
  // keeps its status and carries no reason; the ask record carries the
  // question.
  return opened;
}
