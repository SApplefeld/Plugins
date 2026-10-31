// The turn.complete body: what the handler's try block in hooks/index.ts
// runs at every turn end of an armed session, from the delete of the turn's
// open entry to the completion drain. It takes the TurnCompleteContext that
// hooks/index.ts builds at each completion, over SharedHandlerState, the
// fields it shares with the tick and tool-call bodies. The context keeps the
// engine calls, the two model calls with their scrub, the reply backstop's
// submit and the register-scope values behind closures, so this module
// never receives the engine object and holds no state of its own.
import { ASKS_OPEN_MAX, activateNext, applyTurnToErrors, openBlockingAsks, planHolderOf, reapTurnRecords, stampAskBriefTurnEnd, type GoalNode, type TurnRecordStamp } from "./agent-state";
import type { liveAsk as liveAskFromModule, openLedgerAsk as openLedgerAskFromModule, openWorkerAsk as openWorkerAskFromModule, shadowAsk as shadowAskFromModule, shadowAskPlanHealth as shadowAskPlanHealthFromModule, shadowOutcome as shadowOutcomeFromModule, withdrawLiftedAskBy as withdrawLiftedAskByFromModule } from "./ask-layer";
import { meterSessionKnown } from "./beat";
import type { ChannelSender, ExpectedTurn, SubmitOutcome } from "./channel-text";
import type { CommonsStore } from "./commons";
import type { CompactionPassState } from "./compaction-pass";
import { deliveredRecordText } from "./context-assembly";
import { TURN_BUDGET_PAUSED_REASON, TURN_BUDGET_REASON, turnBudgetAskText } from "./goal-persona";
import type { SharedHandlerState } from "./controller-tick";
import type { MeterTurnInput } from "./cost-ledger";
import { ASK_MARKER_VALUE, splitOf } from "./decision-journal";
import type { HoldTimeout } from "./decision-seam";
import type { noteMemoryOwedDropped as noteMemoryOwedDroppedFromModule, notePairDraftsDropped as notePairDraftsDroppedFromModule } from "./drains";
import type { PluginHost } from "./host";
import { answeredOrThrow, type HookBudget, type LiveAskResult } from "./jev-live";
import { MEMORY_OWED_MAX, pushMemoryOwed } from "./memory-writer";
import { chainReprompt, openRepromptWindow } from "./mid-turn-reprompt";
import { listInboxRecords, writeReplyRecord } from "./operator";
import type { PlanRecordReading } from "./plan-record";
import { PLAN_HEALTH_RECENT_MAX, PLAN_HEALTH_TEXT_MAX, isPlanEntry } from "./plan-route";
import { MEMORY_KIND, MEMORY_KIND_LABELS, RECORD_OUTCOME_TURNS, SCORER_LABELS, SCORER_LABELS_AFTER_NUDGE, STEP_EFFORT_OPTIONS, TURN_SCORE, kaizenLine, turnOpeningText, turnScoreStateText } from "./question-catalog";
import { PROMPT_HEAD_MAX, memqKindOf } from "./recall-text";
import type { closeTurnRecordAtTurnEnd as closeTurnRecordAtTurnEndFromModule, promotePlanTouchingRecord as promotePlanTouchingRecordFromModule } from "./records";
import { scrubText } from "./redactor";
import { KAIZEN_LONG_TURN_MS } from "./self-review";
import { skillPickSettle } from "./skill-pick";
import { safeErrorText } from "./text";
import { stepWatchOf, turnScoreToolsOf, turnToolActivityText, type TurnToolFlags } from "./turn-state-text";
import { ASK_MARKER_LINE, ASK_MARKER_LINE_BREAK, ASK_TURN_MAX, askRecommendOf, ownAskStands, readStatusLine } from "./worker-ask";
import type { TurnCompleteInput } from "claude-code";

// The parameters of a module function after its deps argument, so a
// context field over an ask-layer, records or drains wrapper carries that
// wrapper's own parameter list.
type AfterDeps<F> = F extends (deps: any, ...rest: infer R) => any ? R : never;

// What hooks/index.ts hands the turn-end body, over the fields it shares
// with the tick and tool-call bodies. The engine's verbs; the two model
// calls, each kept in hooks/index.ts with its scrub; the host adapters,
// built at each call as the body built them; the helpers that take the
// engine object; the reply backstop's submit, kept in hooks/index.ts for the
// tests that read its source; the helpers and values that cross by
// reference; the hook budget this completion runs under; and the getters
// and setters over the `let`s the body shares with the other handlers, each
// read or written at the point the body read or wrote the `let`.
export interface TurnCompleteContext extends SharedHandlerState {
  log: (line: string) => void;
  status: (text: string) => void;
  toast: (text: string) => void;
  toolCall: (args: { tool: string; message: string }) => Promise<unknown>;
  classifyTurnScore: (state: string, labels: readonly string[]) => Promise<string | undefined | HoldTimeout>;
  classifyMemoryKind: (state: string) => Promise<string | undefined | HoldTimeout>;
  host: () => PluginHost;
  commonsStore: () => CommonsStore;
  stampTurnEndBeat: (at: number) => Promise<void>;
  meterTurnComplete: (facts: MeterTurnInput) => Promise<void>;
  submitReplyBackstop: (answer: string) => Promise<SubmitOutcome>;
  // The [MID-TURN MESSAGE] re-prompt over the carried window, which opens
  // at the closing turn's start stamp where no earlier one is still open;
  // hooks/index.ts wires it over hooks/mid-turn-reprompt.ts.
  queueMidTurnReprompt: (turnStartedAt: number) => Promise<void>;
  openWorkerAsk: (...args: AfterDeps<typeof openWorkerAskFromModule>) => ReturnType<typeof openWorkerAskFromModule>;
  persist: () => Promise<boolean>;
  activate: (nextId: string | null, reason: string) => void;
  runHealth: (forNodeId: string | null) => Promise<void>;
  completeLeafReturningClosed: (id: string, note: string) => Promise<string[]>;
  queueMemoryCheck: (expectedTurns: ExpectedTurn[], goalId: string, title: string, goalIds: string[]) => void;
  readPlanDocument: (planPath: string) => Promise<{ reading: PlanRecordReading; liveDir: string | null; planDir: string | null }>;
  readPlanCheckout: (dir: string) => Promise<{ upstream: boolean; ahead: number; dirty: number } | null>;
  closeAsksOnCompletedNodes: (nodeIds: readonly string[], closedBy: string, now: number) => Promise<void>;
  foldSettledPlans: () => Promise<void>;
  liveTopLevelAgentRunning: () => Promise<boolean>;
  settleExpiredDispositionStamps: () => void;
  promotePlanTouchingRecord: (...args: AfterDeps<typeof promotePlanTouchingRecordFromModule>) => ReturnType<typeof promotePlanTouchingRecordFromModule>;
  closeTurnRecordAtTurnEnd: (...args: AfterDeps<typeof closeTurnRecordAtTurnEndFromModule>) => ReturnType<typeof closeTurnRecordAtTurnEndFromModule>;
  answerMemoryCheck: (goalId: string, goalIds: string[], answer: string | null) => Promise<void>;
  followUpsAtTurnEnd: (turnId: string, reply: string, hitIds: readonly string[]) => Promise<void>;
  liveAsk: (...args: AfterDeps<typeof liveAskFromModule>) => ReturnType<typeof liveAskFromModule>;
  shadowAsk: (...args: AfterDeps<typeof shadowAskFromModule>) => ReturnType<typeof shadowAskFromModule>;
  shadowOutcome: (...args: AfterDeps<typeof shadowOutcomeFromModule>) => ReturnType<typeof shadowOutcomeFromModule>;
  shadowAskPlanHealth: (...args: AfterDeps<typeof shadowAskPlanHealthFromModule>) => ReturnType<typeof shadowAskPlanHealthFromModule>;
  notePairDraftsDropped: (...args: AfterDeps<typeof notePairDraftsDroppedFromModule>) => void;
  noteMemoryOwedDropped: (...args: AfterDeps<typeof noteMemoryOwedDroppedFromModule>) => void;
  openClosingLeafOf: (plan: GoalNode) => GoalNode | undefined;
  turnIsOpen: () => boolean;
  deriveTurnStartedAt: () => number | null;
  compactionPass: CompactionPassState;
  memoryCheckTurns: Map<string, { goalId: string; goalIds: string[] }>;
  planCompleteHeldLogged: Map<string, string>;
  planRecordDirResolvedLogged: Set<string>;
  planRecordUnreadableLogged: Set<string>;
  jevLive: readonly string[];
  hookBudget: HookBudget;
  jevTurnCalls: () => number;
  setJevTurnCalls: (value: number) => void;
  jevTurnLatencyMs: () => number;
  setJevTurnLatencyMs: (value: number) => void;
  toolErrorsThisTurn: () => number;
  setToolErrorsThisTurn: (value: number) => void;
  toolCallsThisTurn: () => number;
  nudgeCountWorkThisTurn: () => number;
  goalDoneClosedThisTurn: () => Map<string, number>;
  turnToolFlags: () => TurnToolFlags;
  turnToolRing: () => readonly string[];
  turnWorkToolCalls: () => number;
  replyCalledThisTurn: () => boolean;
  turnPlanEditedPaths: () => readonly string[];
  turnFollowUps: () => { turnId: string | null; hits: readonly string[] };
  countResetSinceNudgeOpened: () => boolean;
  currentGateTurnId: () => string | null;
  setCurrentGateTurnId: (value: string | null) => void;
  currentTurnKind: () => ExpectedTurn["kind"] | "unaccounted";
  setCurrentTurnKind: (value: ExpectedTurn["kind"] | "unaccounted") => void;
  currentPrompt: () => string;
  currentTurnAskedText: () => string;
  currentTurnNudged: () => boolean;
  setCurrentTurnNudged: (value: boolean) => void;
  currentTurnIsChannelOrigin: () => boolean;
  setCurrentTurnIsChannelOrigin: (value: boolean) => void;
  currentTurnIsReprompt: () => boolean;
  setCurrentTurnIsReprompt: (value: boolean) => void;
  currentTurnIsPriming: () => boolean;
  setCurrentTurnIsPriming: (value: boolean) => void;
  setCurrentTurnSenderClass: (value: ChannelSender["senderClass"]) => void;
  setCurrentTurnOriginKind: (value: string) => void;
  setCurrentTurnAuthor: (value: string) => void;
  setCurrentTurnEntry: (value: ExpectedTurn | null) => void;
  isPrimingTurn: () => boolean;
  nudgedTurnId: () => string | null;
  setNudgedTurnId: (value: string | null) => void;
  turnLeafId: () => string | null;
  setTurnLeafId: (value: string | null) => void;
  turnStartSeq: () => number;
  setPendingCompactionBank: (value: { turnKind: string } | null) => void;
  memoryGateDiscardPercent: () => number;
  drainInboxNow: () => (() => Promise<boolean>) | null;
  openLedgerAsk: (...args: AfterDeps<typeof openLedgerAskFromModule>) => ReturnType<typeof openLedgerAskFromModule>;
  withdrawLiftedAskBy: (...args: AfterDeps<typeof withdrawLiftedAskByFromModule>) => ReturnType<typeof withdrawLiftedAskByFromModule>;
}

// The turn-end body: what the handler's try block in hooks/index.ts runs
// before its `next(e)`, from the delete of the turn's open entry to the
// completion drain it fires after itself.
export async function serveTurnComplete(ctx: TurnCompleteContext, e: TurnCompleteInput): Promise<void> {
  const { log, status, toast, toolCall, classifyTurnScore, classifyMemoryKind, host, commonsStore, stampTurnEndBeat, meterTurnComplete, submitReplyBackstop, queueMidTurnReprompt, openWorkerAsk, persist, activate, runHealth, completeLeafReturningClosed, queueMemoryCheck, readPlanDocument, readPlanCheckout, closeAsksOnCompletedNodes, foldSettledPlans, liveTopLevelAgentRunning, settleExpiredDispositionStamps, promotePlanTouchingRecord, closeTurnRecordAtTurnEnd, answerMemoryCheck, followUpsAtTurnEnd, liveAsk, shadowAsk, shadowOutcome, shadowAskPlanHealth, notePairDraftsDropped, noteMemoryOwedDropped, openClosingLeafOf, turnIsOpen, deriveTurnStartedAt, compactionPass, memoryCheckTurns, planCompleteHeldLogged, planRecordDirResolvedLogged, planRecordUnreadableLogged, jevLive, hookBudget, jevTurnCalls, setJevTurnCalls, jevTurnLatencyMs, setJevTurnLatencyMs, toolErrorsThisTurn, setToolErrorsThisTurn, toolCallsThisTurn, nudgeCountWorkThisTurn, goalDoneClosedThisTurn, turnToolFlags, turnToolRing, turnWorkToolCalls, replyCalledThisTurn, turnPlanEditedPaths, turnFollowUps, countResetSinceNudgeOpened, currentGateTurnId, setCurrentGateTurnId, currentTurnKind, setCurrentTurnKind, currentPrompt, currentTurnAskedText, currentTurnNudged, setCurrentTurnNudged, currentTurnIsChannelOrigin, setCurrentTurnIsChannelOrigin, currentTurnIsReprompt, setCurrentTurnIsReprompt, currentTurnIsPriming, setCurrentTurnIsPriming, setCurrentTurnSenderClass, setCurrentTurnOriginKind, setCurrentTurnAuthor, setCurrentTurnEntry, isPrimingTurn, nudgedTurnId, setNudgedTurnId, turnLeafId, setTurnLeafId, turnStartSeq, setPendingCompactionBank, memoryGateDiscardPercent, drainInboxNow, openLedgerAsk, withdrawLiftedAskBy, sess, cfg, expectedTurns, openTurns, coordinatorPersona, architectPersona, jevMode } = ctx;
  // The answer with its secrets hidden, scanned once here and read by
  // these copies this handler sends or stores: the reply backstop's
  // direct reply and its fallback re-prompt, the memory queue's answer head
  // and the reply record. Empty where the completion carries no answer text.
  const answerScrubbed = typeof e.answer === "string" ? scrubText(e.answer).text : "";
  // Session-scoped and unconditional by design, whether or not this
  // completion matches a turn this session saw start. The plan doc's
  // Decisions entry on the idle anchor owns the reasoning.
  sess.state.monitor.lastTurnComplete = Date.now();
  // This turn's own entry, read before the delete below removes it.
  const mapStartedAt = openTurns.get(e.turnId);
  // Closing by id: a completion for a turn this session never saw start
  // removes nothing, so it cannot clear a different turn that is still open.
  // Whether it removed one is what lets the completion drain run below.
  const removedOwnEntry = openTurns.delete(e.turnId);
  // The compaction boundary step's facts, read together here at the delete
  // and before any await, because the awaits below can let the next
  // turn.start in and that start rewrites every one of them: whether this
  // completion is the persona's own turn ending (by the id its turn.start
  // carried), what opened that turn (for the step's decision), whether a
  // turn is still open once this completion's own entry is gone, and how
  // many turns have started so far. The step compares that last count with
  // the live one: a newer turn started in between means this completion
  // settled too late to owe a bank. The entry active now, as the turn left
  // it, is read here too, for a turn that opened with none active.
  // A completion naming a subagent loop (e.agentId set) is never the
  // persona's own turn end, whatever turn id it carries. The scorer reads
  // the same fact: a subagent's report is not the worker's answer.
  const completesSubagentLoop = typeof e.agentId === "string" && e.agentId.length > 0;
  const completesGateTurn = currentGateTurnId() !== null && e.turnId === currentGateTurnId()
    && !completesSubagentLoop;
  const turnKindAtStart: string = currentTurnKind();
  // Whether the turn ending is the supervisor's priming turn, or a
  // [SUPERVISOR-ASK] turn, which the same reading marks, read here for the
  // same reason, since the reset below and the next turn.start both rewrite
  // it. It is the turn's own reading from its turn.start, where
  // isPrimingTurn carries the last typed prompt's over every turn the
  // plugin submits after it. The turn budget spends nothing on that turn.
  const completesPrimingTurn = completesGateTurn && currentTurnIsPriming();
  // The step watch's reading of this turn, read here for the same reason,
  // since the next turn.start replaces it, and spent here: the persona's
  // own completion of the turn the watch opened under takes it, so a
  // second completion carrying that id finds none, and a subagent's
  // completion takes none.
  const stepWatchAtDelete = !completesSubagentLoop && sess.stepWatch.turnId !== null && e.turnId === sess.stepWatch.turnId
    ? sess.stepWatch
    : null;
  const askSeenAtStepAtDelete = sess.askSeenAtStep;
  if (stepWatchAtDelete !== null) sess.stepWatch = stepWatchOf(null);
  if (!completesSubagentLoop) skillPickSettle((...o) => shadowOutcome(host(), ...o));
  const turnOpenAfterDelete = turnIsOpen();
  const turnStartSeqAtDelete = turnStartSeq();
  // A main turn's end is the clock each owed decision brief's life counts
  // from, stamped here before any await, since a controller tick can drain
  // the queue during the awaits below. The ASK: lines read below owe
  // theirs already stamped with the same end.
  const turnEndedAtDelete = Date.now();
  if (sess.isOwner && !completesSubagentLoop) stampAskBriefTurnEnd(sess.state, turnEndedAtDelete);
  const activeIdAtDelete = sess.state.activeGoalId;
  // The entry this turn started on, read here for the same reason, since
  // the next turn.start rewrites it: the last answer is keyed to it below.
  const turnLeafIdAtDelete = turnLeafId();
  // The asks this turn's ask_open calls opened, read here for the same
  // reason, since the next turn.start resets the count: the closing
  // text's ASK: lines count their opens from it against ASK_TURN_MAX.
  const asksOpenedAtDelete = sess.asksOpenedThisTurn;
  // The compaction boundary step's goal_done facts, read here for the same
  // reason, since the next turn.start resets the record and the count: the
  // turn-start entry's plan holder where it reads complete now and a
  // goal_done call this turn completed it, and whether the main loop made a
  // work call after that call. The status is the holder's as the turn left
  // it, before this handler's own steps, so an abandoned holder and one no
  // goal_done completed read as neither.
  const turnStartLeafAtDelete = turnLeafIdAtDelete ? sess.state.goals.find((g) => g.id === turnLeafIdAtDelete) : undefined;
  const turnStartHolderAtDelete = turnStartLeafAtDelete ? planHolderOf(sess.state, turnStartLeafAtDelete) : undefined;
  const workAtHolderDone = turnStartHolderAtDelete !== undefined && turnStartHolderAtDelete.status === "complete"
    ? goalDoneClosedThisTurn().get(turnStartHolderAtDelete.id)
    : undefined;
  const holderDoneByGoalDoneIdAtDelete = workAtHolderDone !== undefined ? turnStartHolderAtDelete!.id : null;
  const workAfterHolderDoneAtDelete = workAtHolderDone !== undefined && nudgeCountWorkThisTurn() > workAtHolderDone;
  // Section 5 (goal-every-turn): the record close's own facts, read here for
  // the same reason. The text this turn opened with, and the tool activity
  // the turn's own calls wrote, are both rewritten by the next turn.start.
  const askedTextAtDelete = currentTurnAskedText();
  const turnNudgedAtDelete = currentTurnNudged();
  // Cleared here, before the handler's first await, so a completion that
  // lands during those awaits is not read as the nudged turn's.
  if (completesGateTurn) setCurrentTurnNudged(false);
  const activityTextAtDelete = turnToolActivityText(turnToolFlags(), turnToolRing(), turnWorkToolCalls(), replyCalledThisTurn());
  // The turn-score state's tool activity, read here for the same reason:
  // the next turn.start rewrites it, and the scorer reads it after the
  // awaits below. Its opening text is askedTextAtDelete above.
  const scoreToolsAtDelete = turnScoreToolsOf(turnToolFlags(), turnToolRing(), replyCalledThisTurn());
  // Section 6 (goal-every-turn): route one's own fact, read here for the same
  // reason. The plan documents this turn edited are rewritten by the next
  // turn.start too, and route one reads them after an await of its own. The
  // list is copied rather than aliased: the reset at the next turn.start
  // replaces the array, but a tool call landing before route one reads it
  // pushes onto this one.
  const planEditedPathsAtDelete = [...turnPlanEditedPaths()];
  // The follow-up outcome's fact, read here for the same reason: the
  // entries this turn showed that a main-loop tool call's path argument
  // named, where the running turn's reading is this turn's.
  const followUpHitsAtDelete = turnFollowUps().turnId === e.turnId ? [...turnFollowUps().hits] : [];
  // The metered row's facts, read here for the same reason: the next
  // turn.start rewrites the turn's kind and its entry. The Jev tally is the
  // persona's own turn's, read and reset by its own completion, so a
  // subagent's row counts none. The turn's start is its end less the
  // duration the engine measured, or the open-turn entry's time without one.
  const meterEndedAt = Date.now();
  const meterFacts: MeterTurnInput = {
    sessionId: sess.mySessionId,
    turnId: typeof e.turnId === "string" ? e.turnId : "",
    agentId: completesSubagentLoop ? e.agentId : null,
    persona: sess.persona,
    goalId: turnLeafIdAtDelete,
    planPath: turnStartHolderAtDelete?.planPath ?? null,
    trigger: turnKindAtStart,
    usage: e.usage,
    jevCalls: completesSubagentLoop ? 0 : jevTurnCalls(),
    jevLatencyMs: completesSubagentLoop ? 0 : jevTurnLatencyMs(),
    startedAt: typeof e.durationMs === "number" ? meterEndedAt - e.durationMs : (mapStartedAt ?? null),
    endedAt: meterEndedAt,
  };
  if (!completesSubagentLoop) {
    setJevTurnCalls(0);
    setJevTurnLatencyMs(0);
    // The compaction pass's cache clock runs from this end, the last
    // main-thread response, and a turn ending opens a new idle stretch
    // for the cold_cache line.
    compactionPass.lastMainTurnEndedAt = meterEndedAt;
    compactionPass.coldCacheJournaled = false;
  }
  // A [MEMORY CHECK] turn names records shown under a closed goal and does
  // no work, so it leaves the owed bank as it found it. That turn runs at
  // the next idle after the close, ahead of the turn that starts the next
  // entry, so clearing there would drop the bank the closing turn owed
  // before that next turn's first tool call takes it. Read from the id
  // its turn.start recorded, before the read below spends that id.
  const completesMemoryCheckTurn = completesGateTurn && typeof e.turnId === "string" && memoryCheckTurns.has(e.turnId);
  // Every other persona turn end clears any owed bank here, before any
  // await, and the step below sets it again only where this turn ended
  // durable. A throw on the way there leaves nothing owed: a missed bank
  // costs one compaction point, while a bank an earlier turn owed and this
  // mid-work turn failed to clear would license compaction mid-work.
  if (completesGateTurn && !completesMemoryCheckTurn) setPendingCompactionBank(null);
  // The pair drafts owed or held for the ending turn go with it, before
  // any await, since a draft delivered on a later turn would restate
  // bodies that may have changed. A subagent's completion ends no turn
  // of the main loop's and drops nothing.
  if (!completesSubagentLoop) {
    if (sess.pairDraftOwed !== null && sess.pairDraftOwed.turnId === e.turnId) {
      notePairDraftsDropped(sess.pairDraftOwed.turnId, "turn ended");
      sess.pairDraftOwed = null;
    }
    if (sess.pairDrafts !== null && sess.pairDrafts.turnId === e.turnId) {
      notePairDraftsDropped(sess.pairDrafts.turnId, "turn ended");
      sess.pairDrafts = null;
    }
  }
  try { log(`Agentic: turn complete ${kaizenLine(String(e.turnId ?? "none"))}`); } catch { /* non-fatal */ }
  // Plan item 8.4: a turn that ran past an hour is one of the weaknesses
  // the own-record pass counts, so record it as a decision here, the only
  // point that knows both ends of the turn.
  // The harness measures the turn itself and carries the figure whatever the
  // turn's reason, so where it arrives the record needs no hook-side clock
  // and no open-turn entry, and still counts a turn whose start this session
  // never saw.
  // The map entry is kept as a defensive fallback against a contract this
  // plugin has never exercised: the field is declared required, and no other
  // line here reads it, so an absent one would switch this record off with
  // nothing saying so.
  {
    const turnMs = typeof e.durationMs === "number"
      ? e.durationMs
      : mapStartedAt === undefined ? null : Date.now() - mapStartedAt;
    if (turnMs !== null && turnMs >= KAIZEN_LONG_TURN_MS) {
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "turn_over_hour",
        detail: `Turn ${e.turnId || "unknown"} ran ${Math.round(turnMs / 1000)}s`,
      });
    }
  }
  // The deferred-status stamp is derived from what is still open rather than
  // cleared, so it names the earliest turn still running, or null when none
  // is. This value leaves the process: it is published to the heartbeat and
  // read by another session to report how long a pending record has waited.
  // A stamp cleared by whichever completion arrived first would tell that
  // reader no turn is running while one still is, and a stamp left set by an
  // unmatched completion would strand and report a turn that ended hours
  // ago. Deriving it cannot strand the in-memory value, because an empty map
  // yields null. The published file is a weaker claim: the sidecar stamp is
  // a read-modify-write made from both turn handlers and from the heartbeat
  // tick, so two in-flight calls can land out of build order and publish a
  // non-null stamp just after the map emptied. The next tick repairs it, so
  // that exposure is one heartbeat interval rather than unbounded. The
  // commons entry carries the same exposure for the same reason, repaired by
  // the owner's next tick claim write (a reader's tick passes no meta, so its
  // copy holds until its next turn boundary).
  sess.turnStartedAt = deriveTurnStartedAt();
  // The persona's own last turn, which the beat file names; a subagent's
  // completion names none.
  if (!completesSubagentLoop && meterSessionKnown(sess.mySessionId)) sess.meterLastTurnId = meterFacts.turnId;
  // Every liveness file from this end's one instant, the one the metered
  // row ends at: the sidecar for the owner, the supervisor's file, the
  // commons entry and the meter beat; and beside them the meter's spool
  // file. The beat's write and the spool write are each bounded at
  // METER_WRITE_TIMEOUT_MS and run together, so the meter holds this turn
  // end for at most that bound once: the engine meters a pending clock
  // wait whether or not anything awaits it, so two bounded writes in
  // series would spend two. Neither can fail the turn: each failure is
  // one decision per cause per UTC day, and this handler's result is
  // next(e)'s whatever the meter did.
  await Promise.all([
    stampTurnEndBeat(meterEndedAt),
    meterTurnComplete(meterFacts).catch(() => { /* the meter never fails a turn */ }),
  ]);

  // Read what this turn opened as once, up front, and reset it so a stale
  // reading never leaks into a later turn (a completion for a turn whose
  // start this session never saw reads as unaccounted). The expected-turn
  // list itself is not touched here: its entries leave it at turn.start,
  // one per turn the plugin opened.
  const wasNudged = currentTurnKind() === "nudge";
  // Section 4 (plan-health-from-the-record): captured before the resets
  // below clear both facts, so the scorer can read what this turn opened
  // as. A channel message or a delivered record carries no worker
  // judgment to score.
  const wasDelivery = currentTurnKind() === "delivery";
  // The idle proposal's turn asks for a proposal rather than work on a
  // node, so it is scored against none and spends no round.
  const wasProposal = currentTurnKind() === "proposal";
  // A closed goal's [MEMORY CHECK] turn asks about records shown under that
  // goal, not about the entry active now, so it too is scored against none
  // and spends no round.
  const wasMemoryCheck = currentTurnKind() === "memoryCheck";
  // Whether this completion is the nudged turn's own, read by id rather
  // than from currentTurnKind, which the first of the persona's own
  // completions to arrive resets whatever turn it belongs to. The id is
  // spent here, so the nudged turn is read once. A subagent's completion
  // is never the nudged turn's own, whatever turn id it carries, and
  // resets neither the id nor the kind, so the persona's own completion
  // after it still reads what its turn opened as.
  const completesNudgedTurn = !completesSubagentLoop && nudgedTurnId() !== null && e.turnId === nudgedTurnId();
  if (completesNudgedTurn) setNudgedTurnId(null);
  // The goals a [MEMORY CHECK] turn asked about, where this completion is
  // that turn's own: read by the id its turn.start carried and spent here.
  // A subagent's completion inside the turn is not the worker's answer,
  // whatever id it carries.
  const memoryCheck = typeof e.turnId === "string" && !(typeof e.agentId === "string" && e.agentId.length > 0)
    ? memoryCheckTurns.get(e.turnId)
    : undefined;
  if (memoryCheck !== undefined) memoryCheckTurns.delete(e.turnId);
  // A [MEMORY CHECK] turn's answer names records rather than work on the
  // active entry, so the last-answer writer, plan health and memory
  // curation below leave it unread.
  const isMemoryCheckTurn = wasMemoryCheck || memoryCheck !== undefined;
  if (!completesSubagentLoop) setCurrentTurnKind("unaccounted");
  if (e.turnId === currentGateTurnId() && !(typeof e.agentId === "string" && e.agentId.length > 0)) {
    setCurrentTurnOriginKind("unclassified");
    setCurrentTurnIsPriming(false);
    setCurrentTurnSenderClass("operator");
    setCurrentTurnAuthor("");
    setCurrentTurnEntry(null);
    setCurrentGateTurnId(null);
  }

  // C3: error streak fold.
  const toolErrors = toolErrorsThisTurn();
  setToolErrorsThisTurn(0);
  sess.state.monitor.env.errors = applyTurnToErrors(
    sess.state.monitor.env.errors,
    { reason: e.reason || "unknown", toolErrors },
  );

  // Skip scoring on aborted or errored turns (no answer to judge). The
  // engine names the interruption flag `isAborted` from 2.1.280; earlier
  // engines named it `aborted`, and the reason covers both.
  const skipped = (e as { isAborted?: boolean; aborted?: boolean }).isAborted === true
    || (e as { aborted?: boolean }).aborted === true
    || e.reason === "aborted" || e.reason === "error" || e.reason === "refusal" || !e.answer;
  // The worker's most recent answer, for the controller's state: the
  // persona's own turn end with an answer to judge, keyed to the entry the
  // turn started on. The reading is `skipped` above, an aborted, errored,
  // refused or answerless completion, and nothing more: a turn a channel
  // message or a delivered record opened, which the scorer leaves
  // unscored, still ends on the worker's own answer and moves this.
  // completesGateTurn excludes a subagent's completion, and a [MEMORY CHECK]
  // turn's answer names records rather than work on the next goal.
  if (completesGateTurn && !skipped && !isMemoryCheckTurn && typeof e.answer === "string") {
    sess.lastAnswer = { goalId: turnLeafIdAtDelete, text: e.answer };
  }

  // The acted outcome of the controller call whose nudge opened this
  // turn, written once against that call's stamp, which is then cleared:
  // tools where the turn's main loop called a tool other than the reply
  // tool, reply where it only answered, none where no answer arrived. The
  // calls are read off the ring taken at the delete, before the awaits
  // above could let the next turn.start reset it. A subagent's completion
  // is never the nudged turn's own, by completesNudgedTurn.
  if (completesNudgedTurn) {
    const actedStampId = sess.jevActedStampId;
    if (actedStampId !== null) {
      sess.jevActedStampId = null;
      const calledATool = scoreToolsAtDelete.calls.some((tool) => !(tool.includes("__reply") || tool.endsWith("_reply")));
      shadowOutcome(host(), actedStampId, "acted", skipped ? "none" : calledATool ? "tools" : "reply");
    }
  }

  // Steer 68/69: a Discord message opened this turn and the turn ended
  // with an answer but no reply-tool call - exactly the shape that left
  // an operator's question answered in the transcript and invisible on
  // the thread, twice, because the priming instruction alone did not
  // reliably make the model call the reply tool. Gated off priming and
  // nudged turns for the same reason the item 2 `untracked_work` backstop below is: an
  // internal turn was never a Discord message and must not be treated
  // as one. Sends the model's own leftover text directly through the
  // reply tool rather than trusting a second instruction to work where
  // the first already didn't; falls back to one re-prompt, carrying the
  // exact text, only if the direct call itself fails.
  // Only the persona's own turn end is backfilled (completesGateTurn). A
  // background subagent's completion arrives while the persona's channel
  // turn is still open and carries the subagent's report as e.answer (the
  // harness type: a subagent's answer is its own turn.complete, carrying
  // its agentId), so backfilling it would post that report to the
  // operator's thread. A nudged turn is excluded by its id as well as its
  // kind: the kind is reset by every completion, a subagent's included,
  // while the channel flag survives one, so a turn that is both a nudge and
  // channel-origin would otherwise post the nudge's answer.
  // A mid-turn re-prompt turn carries the operator's thread words, so its
  // answer is backfilled too, on its own flag, which survives a subagent's
  // completion as the channel flag does.
  let submittedReplyBackstop = false;
  if (!skipped && sess.isOwner && completesGateTurn && (currentTurnIsChannelOrigin() || currentTurnIsReprompt()) && !replyCalledThisTurn() && !isPrimingTurn() && !wasNudged && !completesNudgedTurn) {
    try {
      await toolCall({ tool: "mcp__plugin_relay_channel-relay__reply", message: answerScrubbed });
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "channel_reply_backfilled",
        detail: `turn ${e.turnId} answered with no reply-tool call; sent through reply directly`,
      });
    } catch (directErr) {
      // A refused re-prompt means both paths failed; nothing more to do
      // without a live channel, and its entry has left the list. The
      // completion drain is skipped on the attempt, whatever its outcome:
      // a refused one costs the waiting record one tick, while a delivery
      // queued beside an accepted one would pile into a prompt the turn
      // matcher cannot read as a delivery.
      submittedReplyBackstop = true;
      const backstopOutcome = await submitReplyBackstop(answerScrubbed);
      if (backstopOutcome.ok) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "channel_reply_backfill_reprompted",
          detail: `turn ${e.turnId} direct reply call failed (${(directErr as Error).message}); re-prompted instead`,
        });
      }
    }
  }
  // Section 4 (plan-health-from-the-record): captured beside wasNudged,
  // before this same reset clears it for the next turn.
  const wasChannelOrigin = currentTurnIsChannelOrigin();
  // The flag clears only on the persona's own turn end, so a subagent's
  // completion inside the channel turn leaves it set and the persona's own
  // completion afterwards is still backfilled.
  if (completesGateTurn) {
    setCurrentTurnIsChannelOrigin(false);
    setCurrentTurnIsReprompt(false);
  }

  // Item 2 sub-bullet (f016b69): a turn that did real work with no open
  // root logs one `untracked_work` decision and leaves the goal tree
  // alone. The tree changes only through a goal tool call that names the
  // change, so this block builds no root, assigns nothing to goals and
  // leaves activeGoalId as it is. A complete root can still hold a live
  // plan that goal_add put under it, and that plan stays.
  // The session keeps at most one such line. The first firing pushes it
  // with count 1. Each later firing removes the one entry this session
  // pushed, matched on action and on the held timestamp so a line an
  // earlier session wrote stays, and pushes a fresh line at the tail with
  // the new clock, the raised count and the new prompt excerpt. The log
  // stays in time order, and the supervisor's clean-exit path reads the
  // line's clock as newer than the child's start. Where the decision cap
  // has already dropped the held line, the firing pushes and carries the
  // count on. The match cannot be "the log's last entry", because turn
  // starts, cost summaries and the like land between firings.
  // The condition is "no open root", not "goals.length === 0": a request
  // after a finished one arrives with that root still in state. Gated off
  // real work only (isWorkTool, Round 28) and off priming/nudge turns
  // (isPrimingTurn, wasNudged), since a channel-attached passive child's
  // own acknowledgment turn is not task work. The turn's persist below
  // carries the write.
  const currentRoot = sess.state.goals.find((g) => g.parentId === null);
  const noActiveRoot = !currentRoot || currentRoot.status === "complete" || currentRoot.status === "abandoned";
  if (!skipped && sess.isOwner && !isPrimingTurn() && !wasNudged && noActiveRoot && toolCallsThisTurn() > 0) {
    const untrackedNow = Date.now();
    const excerpt = (currentPrompt() || "Untitled request").slice(0, 80);
    const heldAt = sess.untrackedWorkAt;
    if (heldAt !== null) {
      const decisions = sess.state.decisions;
      for (let i = decisions.length - 1; i >= 0; i--) {
        if (decisions[i].action === "untracked_work" && decisions[i].timestamp === heldAt) {
          decisions.splice(i, 1);
          break;
        }
      }
    }
    const count = sess.untrackedWorkCount + 1;
    sess.state.decisions.push({
      timestamp: untrackedNow,
      loop: "goal",
      action: "untracked_work",
      detail: `x${count}: ${excerpt}`,
    });
    sess.untrackedWorkAt = untrackedNow;
    sess.untrackedWorkCount = count;
  }

  // Item 8.2: an ask record opens only when the worker's own completed
  // turn states a real fork as a literal marker line, never from the
  // classifier's idle-gap reading, which the controller answers with the
  // idle-gap nudge. The
  // stored question is the worker's own line, not a reason the classifier
  // produced. Two guards on the marker itself: refuse a match that still
  // carries the literal template's angle-bracket placeholders (a worker
  // that copies the nudge instruction verbatim without filling it in is
  // not stating a fork), and suppress a re-open of the identical question
  // this same node just closed (the D5b reask guard, driven through this
  // path now that it is the only path that opens an ask from the idle
  // tick's own read of the goal). A subagent's completion opens none: its
  // answer is the subagent's report, not a line the worker wrote.
  // The closing text's status line, read once here: the ask lines below,
  // the lead, the WORKING: clear and the nudge count all take it from
  // this one reading.
  const statusLine = readStatusLine(e.answer);
  // Whether the turn ended on a BLOCKED: or WAITING: lead, the reading the
  // record close and the compaction boundary below both take: on a lead the
  // open record is in flight and the turn end is not durable.
  const endedOnLead = statusLine !== null && statusLine.state !== "working";
  // Every ASK: line of the closing text opens its own ledger entry
  // through openWorkerAsk, the path the ask_open tool takes too, so each
  // line meets the same guards and counts from asksOpenedAtDelete, the
  // opens of the turn's ask_open calls, against the same ASK_TURN_MAX.
  // The entries block where the same
  // text's first line reads BLOCKED:, and are open questions the work
  // proceeds past under any other lead or none. A line past the turn cap,
  // or one the ledger's open cap refuses, is counted into one
  // ask_cap_refused decision for the turn.
  if (!skipped && sess.isOwner && !completesSubagentLoop) {
    const askMarkerMatches = e.answer.split(ASK_MARKER_LINE_BREAK).map((line) => line.match(ASK_MARKER_LINE)).filter((m) => m !== null);
    if (askMarkerMatches.length > 0) {
      // The outcome joiner for the ask marker. The first marker matched
      // after a controller call writes one outcome against that call and
      // clears this half of the hold, so a second marker writes none. The
      // value is not the matched text and need not be: what matched is a
      // line the worker wrote, and the journal writes a fixed token for
      // this kind whatever the caller passes.
      const askMarkerCallStampId = sess.jevAskMarkerOutcomeStampId;
      if (askMarkerCallStampId !== null) {
        sess.jevAskMarkerOutcomeStampId = null;
        shadowOutcome(host(), askMarkerCallStampId, "ask_marker", ASK_MARKER_VALUE);
      }
      const nodeId = turnLeafIdAtDelete || sess.state.activeGoalId || "unknown";
      const askReaskSuppressMs = typeof cfg.askReaskSuppressMs === "number" ? (cfg.askReaskSuppressMs as number) : 10 * 60_000;
      const askBlocking = statusLine !== null && statusLine.state === "blocked";
      let refusedByTurnCap = 0;
      let refusedByOpenCap = 0;
      const lineTurn = { asksOpenedThisTurn: asksOpenedAtDelete, endedAt: turnEndedAtDelete };
      for (const askMarkerMatch of askMarkerMatches) {
        const question = askMarkerMatch[1].trim();
        const opened = await openWorkerAsk("line", lineTurn, nodeId, question, question, askRecommendOf(question), askBlocking, askReaskSuppressMs);
        if (opened === "turn-cap") refusedByTurnCap += 1;
        else if (opened === "cap") refusedByOpenCap += 1;
      }
      if (refusedByTurnCap > 0 || refusedByOpenCap > 0) {
        const reasons: string[] = [];
        if (refusedByTurnCap > 0) reasons.push(`${refusedByTurnCap} past the per-turn cap of ${ASK_TURN_MAX}`);
        if (refusedByOpenCap > 0) reasons.push(`${refusedByOpenCap} past the open cap of ${ASKS_OPEN_MAX}`);
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "ask_cap_refused",
          detail: `${nodeId}: ${refusedByTurnCap + refusedByOpenCap} ASK line(s) refused: ${reasons.join("; ")}`,
        });
      }
    }
  }

  // H2: Score against the leaf that was active at this turn's start, read
  // from turnLeafIdAtDelete, the snapshot taken before this handler's
  // first await. Neither the node active now, which goal_done or the
  // scorer may have activated mid-turn, nor the live turnLeafId, which a
  // turn starting during this handler's awaits rewrites to its own leaf.
  const turnLeaf = turnLeafIdAtDelete
    ? sess.state.goals.find((g) => g.id === turnLeafIdAtDelete)
    : null;
  // Spends the turn-start leaf once the scorer below is done with it. The
  // scorer runs after this handler's awaits, and a turn that started
  // during them wrote its own leaf at its start, which its own end
  // scores, so the leaf is cleared only where no turn has started since.
  const spendTurnLeaf = (): void => {
    if (turnStartSeq() === turnStartSeqAtDelete) setTurnLeafId(null);
  };

  // Section 3 (plan-health-from-the-record): the worker's lead, read from
  // the first non-blank line of the closing text for the entry that was
  // active at turn start, whatever its kind, at the end of every turn
  // whatever opened it. A BLOCKED: or WAITING: line writes the lead
  // fresh (state, reason, and the clock now, which is what the waiting
  // hold measures from). A WORKING: line sets no lead and clears a waiting
  // one. Any other first line clears a lead when the turn made at least one
  // work tool call, the count isWorkTool keeps, so a reply to the operator
  // clears nothing. lead_set and lead_cleared are logged once
  // per change: a turn re-reading the same state and reason logs nothing.
  // The entry's status, the nudge count and the active entry are not
  // touched here. An entry
  // already complete or abandoned at turn end (goal_done in the same turn)
  // takes no lead, and a subagent's completion neither sets nor clears one,
  // since its answer is the subagent's report. The ASK: marker above is
  // handled as it is whether or not this line is present, and the status
  // line is the one reading taken above the marker step.
  if (!skipped && sess.isOwner && !completesSubagentLoop && turnLeaf) {
    const leadLine = statusLine !== null && statusLine.state !== "working" ? { state: statusLine.state, reason: statusLine.reason } : null;
    const workingLine = statusLine !== null && statusLine.state === "working";
    const previous = turnLeaf.lead ?? null;
    const entryOver = turnLeaf.status === "complete" || turnLeaf.status === "abandoned";
    if (leadLine && !entryOver) {
      const changed = !previous || previous.state !== leadLine.state || previous.reason !== leadLine.reason;
      turnLeaf.lead = { state: leadLine.state, reason: leadLine.reason, at: Date.now() };
      turnLeaf.updatedAt = Date.now();
      if (changed) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "lead_set",
          detail: `${turnLeaf.id}: ${leadLine.state}: ${leadLine.reason.slice(0, 150)}`,
        });
      }
    } else if (workingLine && previous && previous.state === "waiting") {
      turnLeaf.lead = null;
      turnLeaf.updatedAt = Date.now();
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "lead_cleared",
        detail: `${turnLeaf.id}: waiting lead cleared by a WORKING: line`,
      });
    } else if (!leadLine && previous && toolCallsThisTurn() > 0) {
      turnLeaf.lead = null;
      turnLeaf.updatedAt = Date.now();
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "lead_cleared",
        detail: `${turnLeaf.id}: ${previous.state} lead cleared by a turn that called a work tool`,
      });
    }
  }

  // The nudge count, one per session whatever entry the turn ran under. A
  // turn that called a work tool or dispatched an agent, the calls
  // isNudgeCountWork keeps, resets it, and so does a turn opened from a
  // channel message, each whatever else the turn carried. Otherwise a
  // nudged turn's own completion, the one carrying the id nudgedTurnId
  // recorded at turn.start, resets it when its closing text opens with a
  // status line and adds one when it opens with none. Every other
  // completion moves nothing: an unaccounted turn, so a nudge whose turn
  // cannot be placed never counts toward the cap; a subagent's completion,
  // under whatever turn id it carries; and an aborted, errored or
  // refused turn. A nudged completion with no answer
  // opens with none of the three lines, so it adds one. Where an entry was
  // activated, the tree replaced or the state loaded while the nudged turn
  // was open, its answer resets the count rather than adding one, so the
  // reset that act performs is
  // not undone by the answer that follows it. Only the owner session keeps
  // the count. The other resets are activation, which activate() and the
  // switch and goal_resume sites perform, a new tree from goal_create, the
  // root's completion, a persona's state loading at agentic_identity or at
  // a reader's promotion, and the cap's own ask, which resets the count as
  // it opens.
  if (!sess.isOwner) {
    // A reader session never nudges, so it keeps no count.
  } else if (nudgeCountWorkThisTurn() > 0 || wasChannelOrigin) {
    sess.nudgedAnswersWithoutStatus = 0;
    sess.nudgeCapRefusedFor = null;
  } else if (completesNudgedTurn && !(e.isAborted === true || (e as { aborted?: boolean }).aborted === true || e.reason === "aborted" || e.reason === "error" || e.reason === "refusal")) {
    if (statusLine !== null || countResetSinceNudgeOpened()) {
      sess.nudgedAnswersWithoutStatus = 0;
      sess.nudgeCapRefusedFor = null;
    } else {
      sess.nudgedAnswersWithoutStatus += 1;
    }
  }

  // A subagent's completion is not scored: its answer is the subagent's
  // report rather than the worker's, so it makes no classify, no shadow call
  // and no score, and leaves the turn-start leaf for the persona's own
  // completion to score.
  if (!skipped && turnLeaf && !completesSubagentLoop) {
    if (turnLeaf.status === "complete") {
      // M11: goal_done ran during this turn, the credit is already in the
      // goal_done handler. Log score_skipped here.
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "score_skipped",
        detail: `${turnLeaf.id} already complete (goal_done)`,
      });
      spendTurnLeaf();
    } else if (turnLeaf.status === "active") {
      const g = turnLeaf;
      const planEntry = isPlanEntry(sess.state, g);
      // Section 4 (plan-health-from-the-record): a channel-origin or
      // delivered-record turn carries no worker judgment to score, for
      // any entry, and a plan entry's own unaccounted turn is skipped
      // too, since only a nudged turn is scored for one. wasNudged is
      // checked first: a turn matched as a nudge is scored as a nudge
      // whatever else it also carries, so the channel/delivery skip
      // below reaches only a turn that was not a matched nudge.
      const skippedForOrigin = !wasNudged && (wasChannelOrigin || wasDelivery || wasProposal || wasMemoryCheck);
      if (skippedForOrigin) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "score_skipped",
          detail: `${g.id}: turn opened from ${wasChannelOrigin ? "a channel message" : wasDelivery ? "a delivered record" : wasProposal ? "the idle proposal" : "a memory check"}`,
        });
        spendTurnLeaf();
      } else if (planEntry && !wasNudged) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "score_skipped",
          detail: `${g.id}: plan entry, turn not opened by a nudge`,
        });
        spendTurnLeaf();
      } else {
        // Still active at turn end: classify as before.
        const labels = wasNudged
          ? SCORER_LABELS_AFTER_NUDGE
          : SCORER_LABELS;
        try {
          // Bound to a name so the same bytes reach Haiku and Jev, whether
          // Jev is asked live or in shadow. The catalog builds it, so .kit/jev-gold/replay.mjs
          // builds the same state from a sampled turn.
          const scoreState = turnScoreStateText(askedTextAtDelete, e.answer, g.objective, scoreToolsAtDelete);
          // Where turn-score is named live, Jev is asked live over the same
          // label array and state as Haiku, and the two calls are started
          // together and awaited together, so a live turn waits only for
          // whatever Jev takes beyond Haiku, bounded at the wait rule's Jev
          // budget for turn.complete. Haiku's classify holds at the rule's
          // model budget, and a hold that gives up throws as a failed
          // classify does, so it takes the same paths below.
          // Everywhere else this is null and the step is Haiku, then Jev in
          // shadow with Haiku's value. The branch is tested here rather than
          // left to liveAsk, whose not-live path would journal a shadow call
          // carrying no Haiku value. On the not-live path a classify that
          // throws reaches the catch below as it always has. On the live
          // path Haiku's classify is settled rather than awaited bare, since
          // liveAsk never rejects and Jev's answer decides the turn: a Haiku
          // throw beside an answered call scores Jev's label and logs
          // turn_score_haiku_failed, and one beside a failed call is
          // rethrown, so the catch's score_failed is that turn's one record.
          const liveScoreCall = jevMode === "shadow" && jevLive.includes(TURN_SCORE)
            ? liveAsk(host(), "turn.complete", hookBudget, "turn-score", TURN_SCORE, labels, scoreState, jevMode, jevLive)
            : null;
          const haikuScoreCall = classifyTurnScore(scoreState, labels).then(answeredOrThrow);
          let liveScore: LiveAskResult | null = null;
          let result: Awaited<typeof haikuScoreCall> | null;
          if (liveScoreCall === null) {
            result = await haikuScoreCall;
          } else {
            const [live, haiku] = await Promise.all([
              liveScoreCall,
              haikuScoreCall.then(
                (value) => ({ ok: true as const, value }),
                (err: unknown) => ({ ok: false as const, err }),
              ),
            ]);
            liveScore = live;
            if (haiku.ok) {
              result = haiku.value;
            } else if (live === null || "reason" in live) {
              throw haiku.err;
            } else {
              sess.state.decisions.push({
                timestamp: Date.now(),
                loop: "goal",
                action: "turn_score_haiku_failed",
                detail: `${g.id}: stamp ${live.stampId}, ${safeErrorText(haiku.err).slice(0, 150)}`,
              });
              result = null;
            }
          }
          let label: string;
          // The stamp the turn-score call's journal lines carry, which its
          // next_trigger outcome is written against: the shadow call's, or
          // the live call's where liveAsk wrote a line for it.
          let scoreStampId: string | null = null;
          if (liveScore === null) {
            // The decision seam, in shadow, over the same variant of the label
            // array the caller offered Haiku.
            scoreStampId = shadowAsk(
              host(),
              "turn-score",
              TURN_SCORE,
              labels,
              scoreState,
              jevMode,
              typeof result === "string" ? result : null,
              undefined,
              undefined,
              hookBudget,
            );
            label = result ?? "unknown";
          } else if ("reason" in liveScore) {
            // Haiku's label is the turn's, with no shadow call beside it. A
            // seam reason has its own call line naming it, written by
            // liveAsk, and Haiku's label is joined to it. A `rejected` call
            // has none, since liveAsk's catch returns before any line is
            // written, so this decision is its only record and no outcome
            // is written against a call line that does not exist.
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "goal",
              action: "turn_score_fallback",
              detail: `${g.id}: reason ${liveScore.reason}, stamp ${liveScore.stampId}, split ${splitOf(liveScore.stampId)}`,
            });
            if (liveScore.reason !== "rejected" && typeof result === "string") {
              shadowOutcome(host(), liveScore.stampId, "haiku_score", result);
            }
            if (liveScore.reason !== "rejected") scoreStampId = liveScore.stampId;
            label = result ?? "unknown";
          } else {
            // Jev's choice is the turn's label, and Haiku's label is joined
            // to the live call, so the journal holds both answers for one
            // input as a shadow answer line does.
            if (typeof result === "string") {
              shadowOutcome(host(), liveScore.stampId, "haiku_score", result);
            }
            label = liveScore.answer.choice;
            scoreStampId = liveScore.stampId;
          }
          // Held for the next turn.start, which writes what opened that
          // turn against this call. Where another turn was still open at
          // this turn's delete, or a turn has started during this
          // handler's awaits, the next turn to start is not this one's
          // successor, so nothing is held and one measurement is lost
          // rather than a wrong one written.
          if (scoreStampId !== null && !turnOpenAfterDelete && turnStartSeq() === turnStartSeqAtDelete) sess.jevNextTriggerStampId = scoreStampId;
          // The outcome joiner for the next score. The first turn scored after a
          // controller call writes one outcome against that call and clears this
          // half of the hold, so a second scored turn writes none.
          const scoreCallStampId = sess.jevScoreOutcomeStampId;
          if (scoreCallStampId !== null) {
            sess.jevScoreOutcomeStampId = null;
            shadowOutcome(host(), scoreCallStampId, "next_score", label);
          }
          g.scores.push({
            round: g.scores.length + 1,
            result: label,
          });

          // Only on-goal, drift, and complete burn rounds, and only on a
          // task entry: a plan entry has no round budget, so no label
          // spends one.
          if (!planEntry && (label === "on-goal" || label === "drift" || label === "complete")) {
            g.completedRounds += 1;
          }

          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "goal",
            action: "score",
            detail: `${g.id} Round ${g.scores.length}: ${label}`,
          });

          // No label moves the nudge count, which reads the closing
          // text's status line and the turn's work instead. A plan
          // entry's complete verdict at the scorer moves nothing.
          if (label === "complete" && !planEntry) {
            // R3: use completeLeaf + activateNext. Never for a plan
            // entry: done is read from the plan document (Section 2),
            // not from this classifier's label.
            const completedId = g.id;
            const closedIds = await completeLeafReturningClosed(completedId, "scorer complete");
            // E2: health run at completeLeaf site (scorer complete).
            await runHealth(completedId);
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "goal",
              action: "complete",
              detail: `${completedId}: Goal completed in ${g.completedRounds} rounds`,
            });
            queueMemoryCheck(expectedTurns, completedId, g.title, closedIds);
            const nextId = activateNext(sess.state, completedId);
            activate(nextId, `${completedId} complete`);
            // L11: plan completion is a log line, not a speech.
            try { log(`Agentic: ${completedId} plan complete`); } catch { /* non-fatal */ }
            try { status(""); } catch { /* non-fatal */ }
          } else if (!planEntry && g.completedRounds >= g.maxRounds) {
            // R7: round budget → leaf blocked, toast once, then activateNext.
            // Never for a plan entry, whose maxRounds is not read.
            // blockedReason stays the literal the load-time recovery in
            // agent-state.ts matches. The detail and the toast name the
            // entry's kind, and an entry of kind "plan" here has no plan
            // document, so they also name how a plan entry is added.
            const kindNote = g.kind === "plan"
              ? "(kind plan with no plan document; a plan entry is added with planPath)"
              : "(kind task)";
            g.status = "blocked";
            g.blockedReason = "Max rounds reached";
            g.updatedAt = Date.now();
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "goal",
              action: "block",
              detail: `${g.id}: Max rounds reached ${kindNote}`,
            });
            try { toast(`Agentic: ${g.id} blocked: max rounds reached ${kindNote}`); } catch { /* non-fatal */ }
            const nextId = activateNext(sess.state, g.id);
            activate(nextId, `${g.id} blocked`);
            try { status(""); } catch { /* non-fatal */ }
          }
          g.updatedAt = Date.now();
        } catch (err) {
          // The score joiner above sits after the awaited classify, so a
          // classify that throws leaves the hold set and the next turn that
          // does score writes its outcome against this controller call with
          // an unscored turn in between. The journal defines next_score as
          // the first turn scored after the call, which that row would still
          // satisfy, and a load reading it as the very next turn's verdict
          // would still be misled. Clearing here writes nothing and loses
          // one measurement rather than recording a misleading one.
          sess.jevScoreOutcomeStampId = null;
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "goal",
            action: "score_failed",
            detail: `${g.id}: ${String(err).slice(0, 150)}`,
          });
        }
        spendTurnLeaf();
      }
    } else {
      // H2: node is paused, blocked, or switched: skip scoring.
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "score_skipped",
        detail: `${turnLeaf.id}: status ${turnLeaf.status} at turn end`,
      });
      spendTurnLeaf();
    }
  }

  // The step watch's readings of this turn, as one decision wherever the
  // turn's main loop made a step, aborted turns included: the steps, the
  // tool calls they made and the first step whose answer carried an ASK:
  // line. The turn id is event text, so it is folded to one line and made
  // bracket-safe.
  if (stepWatchAtDelete !== null && stepWatchAtDelete.steps > 0) {
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "goal",
      action: "step_readings",
      detail: `turn ${kaizenLine(String(e.turnId))}: steps ${stepWatchAtDelete.steps}, tool uses ${stepWatchAtDelete.toolUses}, ask at step ${askSeenAtStepAtDelete ?? "none"}`,
    });
    // The step-effort readings of the same turn, as one decision beside
    // it: the steps, the readings fired, the settled readings by choice,
    // the readings that settled with no choice, the readings still
    // unsettled now, the rewrites applied by level and refused, and the
    // readings still unsettled when the step they were for fired. The
    // turn's last reading had no step after it, so its next_step_tools
    // outcome is none.
    const effort = stepWatchAtDelete.effort;
    const byChoice = STEP_EFFORT_OPTIONS.map((id) => `${id} ${effort.choices[id] ?? 0}`).join(", ");
    const chosen = STEP_EFFORT_OPTIONS.reduce((sum, id) => sum + (effort.choices[id] ?? 0), 0);
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "goal",
      action: "step_effort_readings",
      detail: `turn ${kaizenLine(String(e.turnId))}: steps ${stepWatchAtDelete.steps}, readings ${effort.readings} (${byChoice}, failed ${effort.settled - chosen}, pending ${effort.readings - effort.settled}), lowered ${effort.lowered}, raised ${effort.raised}, unrewritable ${effort.unrewritable}, late ${effort.late}`,
    });
    const lastReading = stepWatchAtDelete.effortReading;
    if (lastReading !== null) {
      stepWatchAtDelete.effortReading = null;
      shadowOutcome(host(), lastReading.stampId, "next_step_tools", "none");
    }
  }

  // Section 2 (plan-health-from-the-record): done and progress from the
  // plan document. For the entry that was active at turn start, when it is
  // a plan entry, read the document its plan holder names. Complete
  // (a header Status: Complete, or the document moved to an archive place)
  // completes the holder with the same steps the scorer's complete label
  // runs: completeLeaf, runHealth, a complete decision naming the document,
  // activateNext, activate. That completion waits for the checkout holding
  // the document: git status runs in planDir, and a branch with an
  // upstream, no commit ahead and no other line lets it run. Any other
  // answer leaves the entry active and logs one plan_complete_held
  // decision per holder per checkout state. A git read that cannot be used
  // completes as before and logs nothing. A Chapter count above the
  // stored one stores the new count and logs plan_progress; an
  // unchanged count logs nothing. A read document also sets the holder's
  // sectionCount and nextSection, silently. An unreadable or archived
  // document writes neither of those two. An unreadable document changes
  // nothing and logs one plan_record_unreadable decision per holder per
  // session.
  // Only the owner reads: a reader's state is never saved, and completion
  // would spawn a health run for nothing.
  // The reader never throws on a document it cannot read; the try/catch
  // here covers the completion steps, as the scorer's does.
  // The document is read under the directory the session runs in now, which
  // readPlanDocument in hooks/index.ts reads, because a persona works its plan in a linked worktree
  // while sess.workdir stays the launch checkout, whose copy gains no
  // Chapter and no Complete status until the plan's branch merges.
  // The held launch directory is the anchor the persona store and the workdir
  // files resolve against, and no document is ever read under it. Where the call
  // throws or answers with no directory, the reading is unreadable with the
  // live directory named as unavailable, and it takes the same once-per-
  // holder plan_record_unreadable log as a document the reader cannot read.
  // A shell that moved into a subdirectory of its checkout leaves the live
  // directory below the document, so resolvePlanDir walks up from it to the
  // nearest directory holding the document at planPath or an archive place.
  // The walk stops at the checkout's root, the first folder holding a .git
  // entry, so it never reaches the launch checkout a worktree sits inside.
  // A read under such an ancestor logs one plan_record_dir_resolved decision
  // per holder naming both directories. Where the walk ends with no hit, the
  // live directory is read and the reader names its own reason. A holder
  // whose status is complete or abandoned when this block runs, a goal_done
  // call during the turn among the ways, is still read, so its closing
  // Chapter is counted, but it logs neither plan_record_dir_resolved nor
  // plan_record_unreadable, and neither log is marked as written, so the
  // once-per-holder budget is not spent on a closed holder.
  const planHolder = turnLeaf ? planHolderOf(sess.state, turnLeaf) : undefined;
  const planPath = planHolder?.planPath;
  // Whether this turn's read found a Chapter above the stored count, or
  // found the document Complete or archived and completed the holder. The
  // compaction boundary step below reads a plan holder as mid-work unless
  // one of the two is true; an unreadable document sets neither.
  let planChapterAdvanced = false;
  let planCompletedByDocument = false;
  // Whether the checkout holding `holder`'s document, read in `planDir`,
  // holds its completion: true where git answers a branch line with no
  // upstream, a commit ahead, or any line after it. A held entry logs one
  // plan_complete_held decision naming the holder, the document, the
  // directory, the dirty count, the ahead count and whether an upstream is
  // set, again only when that reason text changes. A read that cannot be
  // used, or no planDir, holds nothing, so the completion runs as it does
  // for a tree git cannot see. Not holding re-arms the log.
  const heldByCheckout = async (holder: GoalNode, docPath: string, planDir: string | null): Promise<boolean> => {
    const checkout = planDir === null ? null : await readPlanCheckout(planDir);
    if (planDir === null || checkout === null || (checkout.upstream && checkout.ahead === 0 && checkout.dirty === 0)) {
      planCompleteHeldLogged.delete(holder.id);
      return false;
    }
    const reason = `dirty ${checkout.dirty}, ahead ${checkout.ahead}, upstream ${checkout.upstream ? "set" : "none"}`;
    if (planCompleteHeldLogged.get(holder.id) !== reason) {
      planCompleteHeldLogged.set(holder.id, reason);
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "plan_complete_held",
        detail: `${holder.id}: ${docPath.slice(0, 150)}: held until the checkout at ${planDir.slice(0, 200)} is clean and pushed: ${reason}`,
      });
    }
    return true;
  };
  // Completes `holder` on a document reading Complete or archived.
  // The document is the record for the holder's whole subtree, so its live
  // descendants (pending, active or paused, a task the worker added under
  // the plan node among them) are marked complete before the holder is,
  // each with one note naming the document and one complete decision, the
  // shape the scorer's complete branch writes for the one node it
  // completes. A descendant already complete or abandoned is left as it
  // is, nothing outside the holder's subtree is touched, and no walk goes
  // upward past the holder. An open operator ask on an entry this close
  // completed closes as goal_done closes one. The next entry is then
  // activated only where no operator ask is still open, the hold
  // goal_done's none-active branch honours, and with `onlyWhenIdle` only
  // where no entry is active as well, since a plan read beside the turn's
  // own holder can complete while another entry is being worked. Where
  // activation is held, an activeGoalId naming an entry this close
  // completed is cleared, so no pointer is left on a node the closing
  // write can fold away.
  const completeByDocument = async (holder: GoalNode, docPath: string, reading: Exclude<PlanRecordReading, { kind: "unreadable" }>, onlyWhenIdle: boolean): Promise<void> => {
    const completedId = holder.id;
    const cause = reading.kind === "archived"
      ? `plan document ${docPath} is archived at ${reading.at}`
      : `plan document ${docPath} reads Status: Complete`;
    const subtree: string[] = [holder.id];
    for (let i = 0; i < subtree.length; i++) {
      for (const child of sess.state.goals) {
        if (child.parentId === subtree[i] && !subtree.includes(child.id)) subtree.push(child.id);
      }
    }
    // The goals this close completes, the holder and each live
    // descendant, which its [MEMORY CHECK] asks about with any plan
    // parent completeLeaf's walk up completes.
    const closedHere: string[] = [holder.id];
    for (const id of subtree.slice(1)) {
      const descendant = sess.state.goals.find((g) => g.id === id);
      if (!descendant) continue;
      if (descendant.status !== "pending" && descendant.status !== "active" && descendant.status !== "paused") continue;
      closedHere.push(descendant.id);
      descendant.status = "complete";
      descendant.lead = null;
      descendant.notes.push(`completed with ${cause}`);
      descendant.updatedAt = Date.now();
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "complete",
        detail: `${descendant.id}: completed under ${completedId}, ${cause}`,
      });
    }
    for (const id of await completeLeafReturningClosed(completedId, "plan document complete")) {
      if (!closedHere.includes(id)) closedHere.push(id);
    }
    // A holder blocked over a child ("Child task blocked") ends
    // complete with no live reason and no lead left on it.
    holder.blockedReason = undefined;
    holder.lead = null;
    await runHealth(completedId);
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "goal",
      action: "complete",
      detail: `${completedId}: ${cause}`,
    });
    queueMemoryCheck(expectedTurns, completedId, holder.title, closedHere);
    // Every open ask on an entry this completion closed stands as
    // goal_done's do.
    await closeAsksOnCompletedNodes(closedHere, "goal_done (plan document)", Date.now());
    if (openBlockingAsks(sess.state).length === 0 && (!onlyWhenIdle || !sess.state.goals.some((g) => g.status === "active"))) {
      const nextId = activateNext(sess.state, completedId);
      activate(nextId, `${completedId} complete`);
    } else if (sess.state.activeGoalId !== null && closedHere.includes(sess.state.activeGoalId)) {
      sess.state.activeGoalId = null;
    }
    try { log(`Agentic: ${completedId} plan complete (${cause})`); } catch { /* non-fatal */ }
    try { status(""); } catch { /* non-fatal */ }
  };
  if (sess.isOwner && planHolder && planPath) {
    const holder = planHolder;
    const holderClosed = holder.status === "complete" || holder.status === "abandoned";
    try {
      const { reading, liveDir, planDir } = await readPlanDocument(planPath);
      if (liveDir !== null && planDir !== null && planDir !== liveDir) {
        if (!holderClosed && !planRecordDirResolvedLogged.has(holder.id)) {
          planRecordDirResolvedLogged.add(holder.id);
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "goal",
            action: "plan_record_dir_resolved",
            detail: `${holder.id}: ${planPath.slice(0, 150)}: resolved to ${planDir.slice(0, 200)} for live directory ${liveDir.slice(0, 200)}`,
          });
        }
      } else if (planDir !== null) {
        planRecordDirResolvedLogged.delete(holder.id);
      }
      if (reading.kind === "unreadable") {
        if (!holderClosed && !planRecordUnreadableLogged.has(holder.id)) {
          planRecordUnreadableLogged.add(holder.id);
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "goal",
            action: "plan_record_unreadable",
            detail: `${holder.id}: ${planPath.slice(0, 150)}: ${reading.reason}${liveDir !== null ? `; live directory ${liveDir.slice(0, 200)}` : ""}`,
          });
        }
      } else {
        // A readable document re-arms the once-per-session log, so a
        // document that becomes unreadable again later logs once more.
        planRecordUnreadableLogged.delete(holder.id);
        if (reading.kind === "read" && reading.chapters > (holder.chapterCount ?? 0)) {
          const previous = holder.chapterCount ?? 0;
          holder.chapterCount = reading.chapters;
          holder.updatedAt = Date.now();
          planChapterAdvanced = true;
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "goal",
            action: "plan_progress",
            detail: `${holder.id}: ${planPath} Chapters ${previous} -> ${reading.chapters}`,
          });
        }
        // The section total and the latest Chapter's Next: line, for the
        // board card that reads the store. Each is written only where it
        // differs, a null line removes the field, and neither write touches
        // updatedAt or logs a decision, since neither is progress.
        if (reading.kind === "read") {
          if (holder.sectionCount !== reading.sections) holder.sectionCount = reading.sections;
          if (reading.next === null) {
            if (holder.nextSection !== undefined) delete holder.nextSection;
          } else if (holder.nextSection !== reading.next) {
            holder.nextSection = reading.next;
          }
        }
        const documentComplete = reading.kind === "archived" || reading.complete;
        if (documentComplete && holder.status !== "complete" && holder.status !== "abandoned"
          && !(await heldByCheckout(holder, planPath, planDir))) {
          await completeByDocument(holder, planPath, reading, false);
          planCompletedByDocument = true;
        }
      }
    } catch (err) {
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "plan_record_failed",
        detail: `${holder.id}: ${String(err).slice(0, 150)}`,
      });
    }
  }

  // The plan entries the walk up left open, read at every turn end on top
  // of the turn's own holder, so a document that turns Complete in a later
  // turn completes its plan whatever entry that turn started on. They are
  // derived from the tree rather than recorded: a plan node with a
  // planPath, not complete, abandoned or blocked, with at least one child
  // and every child complete or abandoned save its open closing leaf, so a
  // turn started on some other entry still completes it. A completion
  // marks the closing leaf complete with the plan, as a live descendant of
  // the holder, and the fold takes it at its next write. The turn's own
  // holder was read above and is not read twice. A reading short of
  // Complete, or unreadable, changes nothing and logs nothing, since such
  // a plan is read at every turn end until it closes. A Complete reading
  // waits for the checkout holding the document as the holder's does, with
  // the same once-per-state plan_complete_held log. One read per such
  // plan; the owner alone reads, as for the holder, and a subagent's
  // completion, which is not the persona's own turn end, reads none.
  if (sess.isOwner && !completesSubagentLoop) {
    const leftOpen = sess.state.goals.filter((g) => {
      if (g.kind !== "plan" || !g.planPath || g === planHolder) return false;
      if (g.status === "complete" || g.status === "abandoned" || g.status === "blocked") return false;
      const closingLeaf = openClosingLeafOf(g);
      return sess.state.goals.some((c) => c.parentId === g.id)
        && sess.state.goals.every((c) => c.parentId !== g.id || c === closingLeaf || c.status === "complete" || c.status === "abandoned");
    });
    for (const plan of leftOpen) {
      try {
        const { reading, planDir } = await readPlanDocument(plan.planPath!);
        if (reading.kind === "unreadable" || (reading.kind === "read" && !reading.complete)) continue;
        if (plan.status === "complete" || plan.status === "abandoned") continue;
        if (await heldByCheckout(plan, plan.planPath!, planDir)) continue;
        await completeByDocument(plan, plan.planPath!, reading, true);
      } catch (err) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "plan_record_failed",
          detail: `${plan.id}: ${String(err).slice(0, 150)}`,
        });
      }
    }
  }

  // The plan health request and its one outcome joiner. Everything here
  // writes journal lines and session memory and nothing else: no branch
  // above or below reads a value from it, and the one decision it can push
  // is the journal's own write-failure line.
  //
  // The origin of this turn settles the next_speaker outcome of the
  // previous plan health call, whatever entry that call was on. Every
  // record held for an entry that has completed, been abandoned or left
  // the tree is dropped, whichever entry this turn was on. Last, on a
  // completed turn on a plan entry, block-owner is asked over this turn's
  // closing text and the entry's last few.
  if (jevMode === "shadow") {
    const nextSpeakerStampId = sess.jevNextSpeakerStampId;
    if (nextSpeakerStampId !== null) {
      sess.jevNextSpeakerStampId = null;
      shadowOutcome(host(), nextSpeakerStampId, "next_speaker", wasChannelOrigin ? "channel" : wasDelivery ? "delivery" : "neither");
    }
    for (const heldId of [...sess.jevPlanHealth.keys()]) {
      const heldEntry = sess.state.goals.find((g) => g.id === heldId);
      if (!heldEntry || heldEntry.status === "complete" || heldEntry.status === "abandoned") sess.jevPlanHealth.delete(heldId);
    }
    if (turnLeaf && isPlanEntry(sess.state, turnLeaf)) {
      const entryId = turnLeaf.id;
      const entryOver = turnLeaf.status === "complete" || turnLeaf.status === "abandoned";
      // A subagent's completion is its report, not the worker's closing
      // text, so it asks nothing and enters no recent text.
      if (!skipped && !isMemoryCheckTurn && !completesSubagentLoop && sess.isOwner && !entryOver) {
        let record = sess.jevPlanHealth.get(entryId);
        if (record === undefined) {
          record = { closingTexts: [] };
          sess.jevPlanHealth.set(entryId, record);
        }
        // The one cut of the closing text, which both the request's
        // closingText and the recent list carry: the journal's state
        // column is exempt from the field clamp, so what bounds a call
        // line and the request body is this cut alone.
        const closingText = e.answer.slice(0, PLAN_HEALTH_TEXT_MAX);
        record.closingTexts.push(closingText);
        while (record.closingTexts.length > PLAN_HEALTH_RECENT_MAX) record.closingTexts.shift();
        const stampId = shadowAskPlanHealth(host(), closingText, [...record.closingTexts], jevMode, hookBudget);
        if (stampId !== null) sess.jevNextSpeakerStampId = stampId;
      }
    }
  }

  // Memory curation: distill, don't snapshot.
  // Skip curation on nudged turns: the controller's own instruction
  // is not a user preference and must not be distilled into a memory.
  // The turn's start recorded whether a nudge opened it, so a subagent
  // completing inside the turn does not make its end read as un-nudged.
  // A [MEMORY CHECK] turn is skipped too: its prompt and answer are the
  // plugin's question and a list of record names. A subagent's completion
  // is skipped as well: its answer is the subagent's report, not an
  // exchange with the operator, so it owes no record.
  if (!skipped && !turnNudgedAtDelete && !isMemoryCheckTurn && !completesSubagentLoop) {
    try {
      if (askedTextAtDelete.trimStart().startsWith("<task-notification>")) {
        // A turn opened by the harness's notification block for a finished
        // background task or subagent makes no memory call at all: no seam
        // call, no classify and no distill. What such an exchange holds is
        // the persona's own report rather than anything the operator stated.
        // A prompt carrying the block anywhere but its opening is an
        // operator's message and is classified as any other. The test reads
        // the text this turn opened with, recorded at turn.start, rather
        // than currentPrompt, which only the prompt hook sets: a plugin
        // turn or a continuation after a notification turn would otherwise
        // read the notification and be skipped.
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "memory",
          action: "memory_skipped_task_notification",
          detail: "the turn opened with a task notification, so no memory call was made",
        });
      } else {
        // The exchange, cut once: the kind state's last part.
        const exchangeText = `User asked: ${currentPrompt().slice(0, PROMPT_HEAD_MAX)}\nWorker answered: ${e.answer.slice(0, 500)}`;
        // Bound to a name so the same bytes reach Haiku and Jev, whether
        // Jev is asked live ahead of Haiku or in shadow beside it.
        const memoryKindState =
          `What kind of memorable content is in this exchange? Answer with exactly one label.\n` +
          `A description of what happened this turn is "discard".\n` +
          `Only a fact or preference the user stated explicitly. An instruction to call a tool is discard.\n` +
          exchangeText;
        // The memory gate. Where memory-kind is named live, Jev is asked
        // first and awaited, bounded at the wait rule's Jev budget for
        // turn.complete. The classify below races the rule's model figure
        // and the distill bounds itself with its own timeoutMs. A classify
        // hold that gives up throws into the catch at the step's end as a
        // failed call does. Everywhere else
        // the gate is null and the step is Haiku, then Jev in shadow with
        // Haiku's value. The branch is tested here rather than left to
        // liveAsk, whose not-live path would journal a shadow call carrying
        // no Haiku value.
        const gate = jevMode === "shadow" && jevLive.includes(MEMORY_KIND)
          ? await liveAsk(host(), "turn.complete", hookBudget, "memory-kind", MEMORY_KIND, MEMORY_KIND_LABELS, memoryKindState, jevMode, jevLive)
          : null;
        // Whether a confident discard skips both Haiku calls, and the live
        // stamp a call the gate passed joins Haiku's label to.
        let gateSkips = false;
        let passedStampId: string | null = null;
        if (gate !== null) {
          const split = splitOf(gate.stampId);
          if ("reason" in gate) {
            // Haiku runs as today with no shadow call beside it. A seam
            // reason has its own call line naming it, written by liveAsk. A
            // `rejected` call has none, since liveAsk's catch returns before
            // any line is written, so this decision is its only record.
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "memory",
              action: "memory_gate_fallback",
              detail: `reason ${gate.reason}, stamp ${gate.stampId}, split ${split}`,
            });
          } else {
            const discard = gate.answer.probabilities["discard"];
            const p = typeof discard === "number" ? discard : null;
            // A holdout stamp, one in five by a hash of its id, runs Haiku
            // whatever Jev said, so the rate at which the gate would have
            // skipped a memory Haiku kept stays readable from the journal.
            if (split === "dev" && p !== null && Math.round(p * 100) >= memoryGateDiscardPercent()) {
              gateSkips = true;
              sess.state.decisions.push({
                timestamp: Date.now(),
                loop: "memory",
                action: "memory_gate_skipped",
                detail: `p ${p}, stamp ${gate.stampId}, split ${split}`,
              });
            } else {
              passedStampId = gate.stampId;
              sess.state.decisions.push({
                timestamp: Date.now(),
                loop: "memory",
                action: "memory_gate_passed",
                detail: `${p === null ? "" : `p ${p}, `}stamp ${gate.stampId}, split ${split}, ${split === "holdout" ? "holdout" : "below-floor"}`,
              });
            }
          }
        }
        const kind = gateSkips ? null : answeredOrThrow(await classifyMemoryKind(memoryKindState));
        if (gate === null) {
          // The decision seam, in shadow.
          shadowAsk(
            host(),
            "memory-kind",
            MEMORY_KIND,
            MEMORY_KIND_LABELS,
            memoryKindState,
            jevMode,
            typeof kind === "string" ? kind : null,
            undefined,
            undefined,
            hookBudget,
          );
        } else if (passedStampId !== null && typeof kind === "string") {
          // Haiku's label against the live call, so the journal holds both
          // answers for one input as a shadow answer line does.
          shadowOutcome(host(), passedStampId, "haiku_kind", kind);
        }
        if (kind && kind !== "discard" && sess.isOwner) {
          // The record is owed, not written here: the controller tick's
          // drainMemoryOwed writes it, by a fork of the transcript while
          // the prompt cache is warm and by the Haiku distill otherwise,
          // so the handler makes no model call past the gate and a slow
          // writer never holds the next turn. The item carries the bytes
          // the gate saw, and the turn head names the turn to the fork by
          // the text it opened with, a delivery's context block removed:
          // currentPrompt, which the prompt head reads, is an earlier
          // turn's on a delivery, proposal or continuation turn. Only the
          // session that owns the persona writes
          // its records, so a passive reader's gate result is dropped and
          // its queue stays empty. A fifth item drops the oldest.
          const dropped = pushMemoryOwed(sess.state.memoryOwed, {
            turnId: typeof e.turnId === "string" ? e.turnId : "",
            kind: memqKindOf(kind),
            promptHead: currentPrompt().slice(0, PROMPT_HEAD_MAX),
            answerHead: answerScrubbed.slice(0, 500),
            turnHead: deliveredRecordText(turnOpeningText(askedTextAtDelete)).trim().slice(0, PROMPT_HEAD_MAX),
            at: Date.now(),
          });
          for (const old of dropped) noteMemoryOwedDropped(old, `the queue held ${MEMORY_OWED_MAX}, so the oldest item made way for the newest`);
        }
      }
    } catch {
      // Curation failed; non-fatal.
    }
  }

  // S12: increment turnsSince for self-review debounce.
  if (sess.state.monitor.selfReview) {
    sess.state.monitor.selfReview.turnsSince += 1;
  }

  // D4: every record stamped with this turn gets the turn's answer as its
  // reply and is marked answered. One break-in scan can stamp several
  // flagged records with the running turn, so a turn can close over more
  // than one; the model read all of them before it answered, so the one
  // answer is the reply to each. A record may already be resolved: the owner
  // does the work and calls agentic_resolve inside the stamped turn, so the
  // reply is filed for a resolved record too and its resolution stays as it
  // is. A record delivered on its wait alone is never stamped, so it never
  // matches here. A subagent's completion files nothing, whatever turn id it
  // carries: its answer is the subagent's report, not the reply.
  if (sess.isOwner && !completesSubagentLoop) {
    const persona = sess.persona;
    const store = commonsStore();
    const allRecords = await listInboxRecords(store, persona);
    // An absent turn id matches nothing. A record delivered on its wait
    // alone is delivered and unstamped by design, so an undefined id
    // compared against an unstamped record would match every one of them
    // at once and file this turn's answer as a reply to each.
    const turnId = typeof e.turnId === "string" && e.turnId.length > 0 ? e.turnId : null;
    const matching = turnId === null ? [] : allRecords.filter(
      (rec) => (rec.status === "delivered" || rec.status === "resolved") && rec.turnId === turnId
    );
    const answering = Boolean(e.answer) && e.reason !== "aborted";
    for (const record of matching) {
      // One record whose stored value fails to read or parse must not cost
      // the rest of them their replies, nor the persist below. The guard is
      // the per-record body and nothing wider: the listInboxRecords read
      // that feeds this loop sits outside it, and a failure there throws
      // past the persist.
      try {
        if (answering) {
          // AX4: write reply, mark answered
          // The read and the parse, the only steps here that can throw, run
          // before either write, so a stored value that cannot be read back
          // leaves nothing written at all: no reply record on a record that
          // never reaches answered, which is the state the failure decision
          // below reports.
          const existing = await store.get(record.key);
          const parsed = existing
            ? (typeof existing === "string" ? JSON.parse(existing) : existing)
            : null;
          // BE2: use writeReplyRecord so the value is an object, not a string
          await writeReplyRecord(store, persona, record.id, answerScrubbed);
          if (parsed !== null) {
            if (parsed.status === "delivered") parsed.status = "answered";
            await store.set(record.key, parsed);
          }
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "monitor",
            action: "operator_answered",
            detail: `record ${record.id} replied`,
          });
        } else {
          // AX4: empty answer or aborted. The record keeps its status
          // (delivered, or resolved with its resolution), its stamp and no
          // reply until the TTL: a later turn is not the one the plugin
          // opened for it, so none re-stamps it.
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "monitor",
            action: "operator_turn_unanswered",
            detail: `record ${record.id} turn ${e.turnId} ended with no answer (empty or aborted); left ${record.status}`,
          });
        }
      } catch (err) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "operator_reply_failed",
          detail: `record ${record.id} reply refused, left ${record.status}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
        });
      }
    }
  }

  // Section 5 (goal-every-turn): the live-agent reading, shared by the
  // record close just below and the compaction boundary further down, and
  // taken at most once per completion, at the first of the two that
  // consults it. The close consults it only once its lead rule and open-ask
  // rule have both declined, and the boundary only where a turn end could
  // be durable, so a completion neither needs it on never reads the list.
  // A read that fails is no live agent, which liveTopLevelAgentRunning
  // explains and logs once.
  let liveAgentRead: Promise<boolean> | null = null;
  const readLiveAgent = (): Promise<boolean> => {
    if (liveAgentRead === null) liveAgentRead = liveTopLevelAgentRunning();
    return liveAgentRead;
  };

  // Section 6 (goal-every-turn): route one, promoting a plan-touching bare
  // record into the goal tree, runs inside the record block below, above the
  // close and under the same guard. The order is load-bearing: the close can
  // set the open record `delivered` on a live verdict, and route one reads the
  // open record, so a plan-touching bare record is promoted before the close
  // judges it, or it reads `delivered` where the plan says `promoted`. It sits
  // after the reap for the same reason the close does, so a record the timeout
  // has already judged is never promoted, and it shares the close's own
  // skipped-turn rule: a turn the operator aborted leaves the record as it
  // was, and an entry queued off an aborted turn would announce itself to the
  // coordinator persona all the same.

  // The turn budget: a root seeded with one counts each of the persona's own
  // completed turns, and at the budget blocks with "Turn budget reached",
  // pauses every active entry and opens one blocking ask to the operator
  // naming the goal and the count. A root with no budget counts nothing,
  // which is every root goal_create makes. Every completed turn counts, a
  // nudge, a delivered record and a memory check among them, since each
  // follows or drives the goal's work, save the supervisor's priming turn,
  // so a restart costs the goal nothing, and a [SUPERVISOR-ASK] turn, which
  // the same reading marks. An aborted, errored or refused turn
  // spends none, and a root the budget already blocked counts none until
  // goal_resume lifts it. The ask is one per block, as the cost cap's
  // is: a standing own ask is left, and a lifted one is withdrawn before the
  // next opens. The step sits above the record close, so the blocking ask
  // it opens is one the close's open-ask rule reads.
  if (completesGateTurn && sess.isOwner && !skipped && !completesPrimingTurn) {
    const root = sess.state.goals.find((g) => g.parentId === null);
    if (root && typeof root.turnBudget === "number" && root.status !== "complete" && root.status !== "abandoned"
      && !(root.status === "blocked" && root.blockedReason === TURN_BUDGET_REASON)) {
      const budgetNow = Date.now();
      root.turnsSpent = (root.turnsSpent ?? 0) + 1;
      root.updatedAt = budgetNow;
      if (root.turnsSpent >= root.turnBudget) {
        root.status = "blocked";
        root.blockedReason = TURN_BUDGET_REASON;
        for (const g of sess.state.goals) {
          if (g.status !== "active") continue;
          g.status = "paused";
          g.blockedReason = TURN_BUDGET_PAUSED_REASON;
          g.updatedAt = budgetNow;
        }
        sess.state.activeGoalId = null;
        sess.state.decisions.push({
          timestamp: budgetNow,
          loop: "goal",
          action: "block",
          detail: `${root.id}: ${TURN_BUDGET_REASON} (${root.turnsSpent} of ${root.turnBudget} turns)`,
        });
        if (!ownAskStands(sess.state, "turn-budget", root.id)) {
          const askText = turnBudgetAskText(root);
          await withdrawLiftedAskBy(sess.state, sess.persona, "turn-budget", root.id, budgetNow);
          const opened = await openLedgerAsk(sess.state, sess.persona, sess.mySessionId, root.id, askText, "", "turn-budget", true, budgetNow);
          if (typeof opened === "string") {
            sess.state.decisions.push({
              timestamp: budgetNow,
              loop: "monitor",
              action: "ask_cap_refused",
              detail: `${root.id}: turn-budget ask refused: ${opened === "cap" ? `the open cap of ${ASKS_OPEN_MAX}` : opened}`,
            });
          } else {
            sess.state.decisions.push({
              timestamp: budgetNow,
              loop: "monitor",
              action: "ask_opened",
              detail: `${root.id}: turn-budget: ${root.turnsSpent} of ${root.turnBudget} turns (ask ${opened.id})`,
            });
            try { toast(`Agentic: ${root.id} blocked: turn budget reached (${root.turnsSpent} of ${root.turnBudget} turns)`); } catch { /* non-fatal */ }
          }
        }
        try { status(""); } catch { /* non-fatal */ }
      }
    }
  }

  // Section 5 (goal-every-turn): the record close, at the persona's own turn
  // end under the true-boundary guard, and the `none` arm of the
  // next_prompt_kind outcome beside it. The reap runs first, so a record
  // past its timeout is expired here as well as at the load and the store
  // write, and the close then reads a record the timeout has already judged.
  // The expiry writer runs on every own turn end whether or not the turn
  // was skipped, since an expired record's stamps are bookkeeping the turn
  // did not touch; the close itself runs only where the turn was not
  // skipped, so a skipped turn leaves the record exactly as it was. Position
  // is load-bearing on both sides: the ask step above is what opens a
  // blocking ledger entry, which the close's open-ask rule reads, and the
  // outcome loop below reads the status the close sets.
  if (completesGateTurn && sess.isOwner) {
    reapTurnRecords(sess.state, Date.now());
    settleExpiredDispositionStamps();
    if (!turnOpenAfterDelete && !skipped) {
      // A promotion whose add was refused leaves its record open, and the
      // close is skipped this turn end so a live verdict cannot deliver it
      // before the next boundary tries again. A noted reading made no add, so
      // its record goes to the close like any other.
      const keptOpen = await promotePlanTouchingRecord(
        planEditedPathsAtDelete, coordinatorPersona, architectPersona,
        () => turnStartSeq() !== turnStartSeqAtDelete,
      );
      if (!keptOpen) await closeTurnRecordAtTurnEnd(
        turnLeaf ? turnLeaf.objective : "", e.answer, askedTextAtDelete, activityTextAtDelete, endedOnLead,
        readLiveAgent, () => turnStartSeq() !== turnStartSeqAtDelete, jevMode, jevLive, hookBudget,
      );
    }
  }

  // Section 4 (goal-every-turn): the record_delivered_within outcome, which
  // answers every turn-open call that opened or continued a record. Each such
  // call is held on its record as a pending stamp and settles exactly once:
  // true at the first of the persona's own completions that finds the record
  // delivered, false at the third of them without one. The entry is dropped as
  // its line is written, which is what holds one call to one outcome line.
  //
  // A record carried across several messages holds several pending stamps, one
  // per call, and each counts its own turns from where it joined, so the call
  // that opened the record settles earlier than the call that continued it.
  //
  // Only the persona's own turn end counts a turn, which completesGateTurn is
  // the test for: a background subagent's completion arrives while the
  // persona's turn is still open and carries the subagent's agentId, so it
  // advances nothing here. A reader session counts nothing either, since the
  // records are the holder's. A record with no pending stamp is a record no
  // call is waiting on, which is every record under the kill switch, so the
  // absence of a stamp is the mode gate and no mode is read here.
  //
  // Position is load-bearing: this reads `record.status` and must run after
  // everything on this handler that can set it. The step that closes a record
  // `delivered` belongs between the lead read above and the compaction
  // boundary below, so this block sits at the far end of that window, right
  // before the boundary. Anything inserted into the window therefore lands
  // ahead of it. Put a status-setting step below this block instead and a
  // record delivered on its own third turn has `false` written for that call:
  // the outcome reads the status one step before it is set, which is exactly
  // the boundary case the journal's labelling pass is for, and no assertion
  // on a record delivered earlier than its third turn can see it.
  if (completesGateTurn && sess.isOwner) {
    for (const record of sess.state.turnRecords) {
      const pending = record.pendingStamps;
      if (pending === undefined || pending.length === 0) continue;
      const delivered = record.status === "delivered";
      const held: TurnRecordStamp[] = [];
      for (const stamp of pending) {
        if (delivered) {
          shadowOutcome(host(), stamp.stampId, "record_delivered_within", "true");
          continue;
        }
        const turns = stamp.turns + 1;
        if (turns >= RECORD_OUTCOME_TURNS) {
          shadowOutcome(host(), stamp.stampId, "record_delivered_within", "false");
          continue;
        }
        held.push({ stampId: stamp.stampId, turns });
      }
      if (held.length === 0) delete record.pendingStamps;
      else record.pendingStamps = held;
    }
  }

  // The compaction boundary: every completion of the persona's own turn,
  // the one carrying the id turn.start carried, recomputes the owed bank,
  // save a [MEMORY CHECK] turn's, which leaves it as it found it.
  // The owed bank was cleared at the delete, so here it is only set, where
  // that turn stopped at a durable point, and the first main-loop tool call
  // of a later turn runs the kit's boundary command, which records the
  // marker the session.compact handler in hooks/index.ts honors. A turn that made no tool call
  // therefore never carries a stale bank into a later turn that ended
  // mid-work or on a lead, even where this handler throws before reaching
  // this step. A background subagent's completion inside the open turn, or
  // one for a turn this session never saw start, is not the persona's own
  // and leaves the owed bank as it is. A turn still open after this
  // completion's delete, a reader session and a skipped turn each owe none.
  // A durable point is read from fixed signals: the closing text opens with
  // no BLOCKED: or WAITING: line, whatever the entry's kind, and the entry
  // active at turn start either has no plan holder (a task entry) or its
  // holder's document gained a Chapter or completed the holder this turn,
  // or a goal_done call this turn completed the holder, named on the holder
  // itself or on any descendant whose completion closed it. goal_done is the worker's own
  // statement that the entry is finished. That holder is read at the
  // delete and must still read complete there, so a holder left with every
  // child closed by a drop, and an abandoned holder, are not finished this
  // way. A plan holder that did none of these is mid-section and owes
  // nothing, since a marker there would license compaction mid-work.
  // Where the entry the turn left active differs from the one active at
  // turn start (goal_add activating a plan in a turn that opened with none,
  // or goal_done moving on to a pending plan), that end entry is read too:
  // a plan holder of its own, not complete or abandoned and not the
  // turn-start holder, is mid-section, since no plan-record read ran for it
  // this turn and a plan the turn only reached has banked no Chapter. The
  // one exception is the turn between two plans: where goal_done completed
  // the turn-start holder and the main loop made no isNudgeCountWork call
  // after that goal_done, the plan it activated got no work in the turn,
  // so it does not make the turn mid-section. goal_done's answer tells the
  // worker to end the turn there. A channel reply and a record to another
  // persona are not work calls, and one work call or agent dispatch after
  // the goal_done keeps the end holder mid-section. An end entry under the
  // turn-start holder changes nothing. The end entry is the one the turn
  // itself left active, read at the delete, before this handler's own
  // scorer or document-complete step activates the next entry. An entry
  // this handler activates got no work in the turn, so the point between
  // plans stays durable. A background agent the main loop started and
  // still running, read from the engine's agent list through the shared thunk
  // above, makes the turn not durable either: its work lands after this
  // turn's end, so a marker here would license compaction while that work
  // is in flight. The list is read here only where every other durable
  // signal already holds, and the record close above will already have
  // read it on a turn its agent rule reached, so the two consult one
  // reading. A blocking ask open at the turn's end, read off the ledger
  // after the marker step above that opens it, makes the turn not durable
  // as a WAITING: lead does: the plan's Goal lists an open ask beside the
  // lead and the live agent as what puts an open record in flight, and an
  // outstanding blocking ask is the waiting state reached by an ASK: line
  // under a BLOCKED: lead. A non-blocking ask is a question the work
  // proceeds past, so it holds nothing here either. The open ask is a
  // synchronous fact like the lead, so it gates the list read too. An
  // open turn record with no lead, no open ask and no live agent is idle, and idle is
  // durable, so a record alone never withholds the bank. It runs after the
  // plan-record read, which settles the Chapter signal. Its boundary facts
  // were read at the delete. Where a newer turn has started since, this
  // completion settled too late: that turn's first tool call may have run
  // already, so a bank set now could only land mid-turn, and nothing is set
  // or logged. The count is compared after the read below, so a turn that
  // starts during that read is seen. A [MEMORY CHECK] turn's end neither
  // clears nor sets the owed bank, as at the delete above.
  const askHolds = openBlockingAsks(sess.state).length > 0;
  const liveAgent = completesGateTurn && !turnOpenAfterDelete && sess.isOwner && !skipped && !endedOnLead && !askHolds
    ? await readLiveAgent()
    : false;
  if (completesGateTurn && !completesMemoryCheckTurn) {
    if (turnStartSeq() !== turnStartSeqAtDelete) {
      setPendingCompactionBank(null);
    } else {
      const endLeaf = activeIdAtDelete === null || activeIdAtDelete === turnLeaf?.id
        ? undefined
        : sess.state.goals.find((g) => g.id === activeIdAtDelete);
      const endHolder = endLeaf ? planHolderOf(sess.state, endLeaf) : undefined;
      const holderDoneByGoalDone = planHolder !== undefined && planHolder.id === holderDoneByGoalDoneIdAtDelete;
      const endHolderOpen = endHolder !== undefined && endHolder !== planHolder
        && endHolder.status !== "complete" && endHolder.status !== "abandoned"
        && !(holderDoneByGoalDone && !workAfterHolderDoneAtDelete);
      const midSection = (planHolder !== undefined && !planChapterAdvanced && !planCompletedByDocument && !holderDoneByGoalDone) || endHolderOpen;
      const durable = !turnOpenAfterDelete && sess.isOwner && !skipped && !endedOnLead && !askHolds && !midSection && !liveAgent;
      setPendingCompactionBank(durable ? { turnKind: turnKindAtStart } : null);
    }
  }

  // A [MEMORY CHECK] turn's answer stamps the records it names, before the
  // save below carries the cleared list. An aborted, errored, refused or
  // empty turn has no answer to read, which is not the same as NONE.
  if (memoryCheck !== undefined) {
    await answerMemoryCheck(memoryCheck.goalId, memoryCheck.goalIds, skipped || typeof e.answer !== "string" ? null : e.answer);
  }

  // The follow-up queue, after every step above: the entries this turn
  // showed take their outcome, and the documentation check enqueues what
  // it finds in the working tree. The persona's own turn end alone, in a
  // claimed or an unclaimed session, since a subagent's loop is not the
  // turn a prompt opened. It sits before the save so its decisions ride
  // that save, and nothing in it throws into this handler.
  if (!completesSubagentLoop && typeof e.turnId === "string") {
    await followUpsAtTurnEnd(e.turnId, typeof e.answer === "string" ? e.answer : "", followUpHitsAtDelete);
  }

  // M7: single guarded-write path (shared helper).
  // Attempted rather than depended on. A throw from here would skip the
  // next(e) call in the handler in hooks/index.ts and leave the turn hook chain unfinished for every hook
  // behind this one, which is a cost out of all proportion to a save this
  // handler has no caller to report. The state stands in memory and the
  // first write that is not refused carries it.
  // The main turn's closing write folds what this turn completed, where
  // no other turn is open or has started since this one's delete; see
  // foldSettledPlans for the two writes that fold.
  try {
    if (sess.isOwner && !completesSubagentLoop && !turnIsOpen() && turnStartSeq() === turnStartSeqAtDelete) await foldSettledPlans();
    await persist();
  } catch { /* persist could not read or write the store; this turn's record waits in memory */ }

  // The completion drain: a turn this session saw start has closed and no
  // other is open, so the next waiting record is delivered now rather than
  // at the next tick, and a burst drains one record per turn. It runs after
  // this handler rather than inside it, so its store reads and its submit
  // never hold the hook chain the engine awaits before the next turn
  // starts. A refused submit is recorded inside the drain as at the tick. A
  // throw out of it is caught here into one decision, and skips it wrote
  // are saved, since no tick save follows this path.
  const drain = drainInboxNow();
  // A completion naming a subagent loop is never the persona's own turn
  // end, whatever turn id it carries, as at completesGateTurn above.
  const completesSubagent = typeof e.agentId === "string" && e.agentId.length > 0;
  // The re-prompt window opens at every owner turn end, the ones the gate
  // below skips included, at the start stamp read off openTurns above
  // before the delete. A turn end that scans nothing, because a reply
  // backstop went out or another turn is open, leaves its window for the
  // next owner turn end that scans, which reads from this start.
  if (removedOwnEntry && !completesSubagent && sess.isOwner && mapStartedAt !== undefined) openRepromptWindow(sess, mapStartedAt);
  if (removedOwnEntry && !completesSubagent && sess.isOwner && !turnOpenAfterDelete && !submittedReplyBackstop && drain !== null) {
    void Promise.resolve().then(async () => {
      // The ring is read by identity as well as length, since a save
      // that trims it swaps the array for a shorter one.
      const ring = sess.state.decisions;
      const logged = ring.length;
      // The operator's mid-turn messages come before new work: the
      // re-prompt over the carried window, which opens at this turn's
      // start where no earlier one is still open, is queued ahead of the
      // drain's submit. Its spawn runs here, off the hook chain, after the
      // previous owner turn end's re-prompt has settled, so two that
      // overlap never take one record twice. A failure inside it is its
      // own skip decision and never stops the drain, and a throw past that
      // is one decision here.
      try {
        if (mapStartedAt !== undefined) await chainReprompt(sess, () => queueMidTurnReprompt(mapStartedAt));
      } catch (err) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "mid_turn_reprompt_skipped",
          detail: `read-failed: the re-prompt at a turn's end threw: ${safeErrorText(err)}`.slice(0, 200),
        });
      }
      try {
        if (!(await drain()) && (sess.state.decisions !== ring || sess.state.decisions.length !== logged)) await persist();
      } catch (err) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "operator_delivery_error",
          detail: `the inbox drain at a turn's end stopped: ${safeErrorText(err)}`.slice(0, 200),
        });
        try { await persist(); } catch { /* the store refused; the line above waits in memory */ }
      }
    });
  }
}
