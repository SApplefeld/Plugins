// tool-call.ts: the tool.call handler's served body. The off-arming path,
// which runs the guard region and the compaction pass's rerun watch alone;
// the call counting and the recall touches; the compaction bank a held
// boundary owes; the persona tools, agentic_identity through
// agentic_resolve; the Bash constraint; the memory-recognition ask; the
// guard region around the engine's own run of the call; the rerun watch;
// the held-compaction reminder; the pair-draft scan; and the break-in scan
// that puts an urgent or long-waited record on the call's result.
// hooks/index.ts holds the wiring: the registration, the redactor's refusal,
// the hook budget and its clearing, the served answer, the catch that
// replays the call on a failure, the context builder, and every statement a
// test reads from that file's source: the completeRoot call line
// test-personas/supervisor-natural-exit-test.sh reads and the deliveryText
// site test-personas/injection-ledger.mjs counts.
//
// No `import $` and no side effects at load. The engine's loader follows
// `$` only into functions declared in hooks/index.ts, so serveToolCall
// takes a ToolCallContext, which hooks/index.ts builds at each call, after
// the refusal and the hook budget and before the body runs. The engine's
// verbs and the helpers that take `$` cross as closures; the call's
// continuation crosses inside the guardedNext closure and never as a value;
// the session and the register-scope constants cross as the same
// references; each register-scope and module-level `let` crosses as a
// getter, and a setter where the body writes it, read at the moment the
// body reads it. The module holds no state of its own, since the tick
// harness evaluates it once per process while it loads a fresh
// hooks/index.ts per case.

import { ASKS_OPEN_MAX, AUTONOMY_LEVELS, AWAITING_YES_REASON, LINE_TERMINATOR, LONG_TERM_GOAL_CAP, MAX_TASKS_PER_GOAL, PLAN_PATH_PATTERN, PLAN_PATH_REQUIRED_FORM, activateNext, awaitingEntryAtOrAbove, blockedAncestorsToFree, bracketSafeText, closeAsk, createDefaultState, isAutonomyLevel, liftAsk, newTaskId, oneLine, openAskEntries, openBlockingAsks, openTurnRecord, parseState, planHolderOf, previousSessionsText, recordPreviousSession, type AgentState, type GoalNode, type LongTermGoal, type TaskItem } from "./agent-state";
import type { openWorkerAsk as openWorkerAskFromModule } from "./ask-layer";
import { ASKED_BY_MAX_CHARS, TASK_ID_MAX_CHARS, TASK_TEXT_MAX_CHARS, targetPersonaOf, type ExpectedTurn } from "./channel-text";
import { claimResource, commonsWinner, readAllClaims, readAllEntries, readHolderMeta, releaseResource, type CommonsStore } from "./commons";
import { COMPACT_REMINDER_INTERVAL_MS, COMPACT_VALVE_PERCENT, checkpointCommandClause, toolCallInputOf } from "./compaction";
import { compactionRerunAtCall, type CompactionPassDeps } from "./compaction-pass";
import type { SharedHandlerState } from "./controller-tick";
import type { drainPairDraftOwed as drainPairDraftOwedFromModule, noteMemoryWrite as noteMemoryWriteFromModule, notePairDraftsDropped as notePairDraftsDroppedFromModule, writeMemoryRecord as writeMemoryRecordFromModule } from "./drains";
import { AUTONOMY_REFUSED_TEXT, AWAITING_YES_DONE_REFUSED_TEXT, AWAITING_YES_DROP_REFUSED_TEXT, AWAITING_YES_RESUME_REFUSED_TEXT, CLOSING_LEAF_DROP_REFUSED_TEXT, EFFORT_REFUSED_TEXT } from "./effort-texts";
import { FLEET_RESTART_MIN_INTERVAL_MS, FLEET_RESTART_REASON_MAX, fleetLineText, liveClaimsOf, readFleetRows, readRosterFile, rosterRunDir, type RosterEntry } from "./fleet";
import type { PluginHost } from "./host";
import type { HookBudget } from "./jev-live";
import type { boundaryBankCompactionBoundary, boundaryKitInstallPathOf } from "./memq-boundary";
import { memqVerbArgsOf } from "./memq-command";
import { COORDINATOR_GROUND, askKey, claimReaderRole, deliveryArchitectLine, deliveryGroundAtSend, deliveryGroundIn, deliveryRecordProblem, getHighestInboxSeq, listAskRecords, listInboxRecords, mayReachPersona, personaNameProblem, readAskRecord, readReplyRecord, writeInboxRecord, type InboxRecord } from "./operator";
import { parseScanPairs } from "./pair-drafter";
import type { PlanRecordReading } from "./plan-record";
import { isPlanEntry, planLeftOpenText, planStatusText, reactivateAskedEntry } from "./plan-route";
import type { recognitionAsk as recognitionAskFromModule, settleRecognitionOutcomes as settleRecognitionOutcomesFromModule } from "./recall";
import { memqGetsOf, memqTouchesOf } from "./recall-text";
import { shellCommandOf } from "./recognition";
import type { addGoalEntry as addGoalEntryFromModule, clearChildBlockedAncestors as clearChildBlockedAncestorsFromModule, promoteOpenRecord as promoteOpenRecordFromModule } from "./records";
import { skillPickTool } from "./skill-pick";
import { GOAL_HISTORY_FILENAME, parsePersonaStore, stateNotLoadedText } from "./store-files";
import { markStretchApplied, noteStretchShown, stretchShownOfGet } from "./stretch-distillation";
import { FREE_TEXT_MAX, boundedText, safeErrorText, stripBom } from "./text";
import { isNudgeCountWork, isWorkTool } from "./turn-state-text";
import { ASK_TURN_MAX, type WorkerAskRefusal } from "./worker-ask";
import type { ToolCallInput, ToolCallResult } from "claude-code";

// The parameters of a module function after its deps argument, so a
// context field over a records, ask-layer, drains or recall wrapper carries
// that wrapper's own parameter list.
type AfterDeps<F> = F extends (deps: any, ...rest: infer R) => any ? R : never;

// The acts turnMayStartEffort decides. goal_add_plan is the one the
// autonomy level reaches.
export type EffortAct = "goal_create" | "goal_add_plan" | "goal_longterm" | "goal_done_root" | "goal_resume_awaiting";

// What hooks/index.ts hands the served body, over the fields it shares with
// the tick bodies. The engine's verbs; the host adapters, built at each call
// as the body built them; the helpers that take `$`; the guard region,
// which holds the call's continuation; the two statements kept in
// hooks/index.ts for the tests that read its source; the helpers and values
// that cross by reference; the hook budget this call runs under; and the
// getters and setters over the `let`s the body shares with the other
// handlers.
export interface ToolCallContext extends SharedHandlerState {
  log: (line: string) => void;
  fsExists: (path: string) => Promise<boolean>;
  fsRead: (path: string) => Promise<string>;
  fsWrite: (path: string, text: string) => Promise<void>;
  commonsStore: () => CommonsStore;
  host: () => PluginHost;
  compactionPassDeps: () => CompactionPassDeps;
  persist: (rollBackOnYield?: () => void) => Promise<boolean>;
  persistOrRollBack: (rollBack: () => void) => Promise<boolean>;
  activate: (nextId: string | null, reason: string) => void;
  runHealth: (forNodeId: string | null) => Promise<void>;
  queueMemoryCheck: (expectedTurns: ExpectedTurn[], goalId: string, title: string, goalIds: string[]) => void;
  writeClaimDirect: () => Promise<void>;
  migrateLegacyMemories: () => Promise<void>;
  completeLeafReturningClosed: (id: string, note: string, leftOpen?: Map<string, { status: string; leaf: GoalNode }>) => Promise<string[]>;
  drainPairDraftOwed: (...args: AfterDeps<typeof drainPairDraftOwedFromModule>) => ReturnType<typeof drainPairDraftOwedFromModule>;
  guardedNext: (askRecognition?: () => Promise<void>) => Promise<{ early: ToolCallResult } | { r: ToolCallResult }>;
  originIsEngine: () => boolean;
  settleRecognitionOutcomes: (...args: AfterDeps<typeof settleRecognitionOutcomesFromModule>) => void;
  bankCompactionBoundary: (turnKind: string) => ReturnType<typeof boundaryBankCompactionBoundary>;
  appendLines: (path: string, lines: string[], known?: string) => Promise<void>;
  addGoalEntry: (...args: AfterDeps<typeof addGoalEntryFromModule>) => ReturnType<typeof addGoalEntryFromModule>;
  readPlanDocument: (planPath: string) => Promise<{ reading: PlanRecordReading; liveDir: string | null; planDir: string | null }>;
  completeRootByGoalDone: (named: GoalNode, note: string) => Promise<void>;
  closeAsksOnCompletedNodes: (nodeIds: readonly string[], closedBy: string, now: number) => Promise<void>;
  openWorkerAsk: (...args: AfterDeps<typeof openWorkerAskFromModule>) => ReturnType<typeof openWorkerAskFromModule>;
  writeMemoryRecord: (...args: AfterDeps<typeof writeMemoryRecordFromModule>) => ReturnType<typeof writeMemoryRecordFromModule>;
  kitInstallPathOf: () => ReturnType<typeof boundaryKitInstallPathOf>;
  recognitionAsk: (...args: AfterDeps<typeof recognitionAskFromModule>) => ReturnType<typeof recognitionAskFromModule>;
  pushDeliveryLine: (lines: string[], ground: string, rec: InboxRecord, waited: boolean) => void;
  promoteOpenRecord: (...args: AfterDeps<typeof promoteOpenRecordFromModule>) => ReturnType<typeof promoteOpenRecordFromModule>;
  workdirPathOf: (filename: string) => string;
  notePairDraftsDropped: (...args: AfterDeps<typeof notePairDraftsDroppedFromModule>) => void;
  noteMemoryWrite: (...args: AfterDeps<typeof noteMemoryWriteFromModule>) => void;
  clearChildBlockedAncestors: (...args: AfterDeps<typeof clearChildBlockedAncestorsFromModule>) => void;
  openClosingLeafOf: (plan: GoalNode) => GoalNode | undefined;
  noteTurnToolCall: (tool: string, args: { file_path?: unknown; path?: unknown; notebook_path?: unknown; command?: unknown }) => void;
  turnMayStartEffort: (act: EffortAct, autonomy?: string) => boolean;
  turnIsOperatorsOrCoordinators: () => boolean;
  turnIsOperators: () => boolean;
  hookBudget: HookBudget;
  COMPACT_HOLD_REMINDER_TEXT: string;
  urgentCheckMinMs: number;
  breakInAfterMs: number;
  toolErrorsThisTurn: () => number;
  setToolErrorsThisTurn: (value: number) => void;
  toolCallsThisTurn: () => number;
  setToolCallsThisTurn: (value: number) => void;
  nudgeCountWorkThisTurn: () => number;
  setNudgeCountWorkThisTurn: (value: number) => void;
  goalDoneClosedThisTurn: () => Map<string, number>;
  setReplyCalledThisTurn: (value: boolean) => void;
  pendingCompactionBank: () => { turnKind: string } | null;
  setPendingCompactionBank: (value: { turnKind: string } | null) => void;
  currentTurnOriginKind: () => string;
  currentTurnAuthor: () => string;
  turnLeafId: () => string | null;
  currentTurnEntry: () => ExpectedTurn | null;
  currentGateTurnId: () => string | null;
  compactionHeld: () => { percent: number } | null;
  proposalLedgeredTurnId: () => string | null;
  setProposalLedgeredTurnId: (value: string | null) => void;
  compactionReminderAt: () => number;
  setCompactionReminderAt: (value: number) => void;
  lastBreakInCheckAt: () => number;
  setLastBreakInCheckAt: (value: number) => void;
}

// The served body: what the handler's try block in hooks/index.ts answered
// with before the served answer's scrub, from the off-arming path to the
// break-in scan.
export async function serveToolCall(ctx: ToolCallContext, e: ToolCallInput): Promise<ToolCallResult> {
  const { log, fsExists, fsRead, fsWrite, commonsStore, host, compactionPassDeps, persist, persistOrRollBack, activate, runHealth, queueMemoryCheck, writeClaimDirect, migrateLegacyMemories, completeLeafReturningClosed, drainPairDraftOwed, guardedNext, originIsEngine, settleRecognitionOutcomes, bankCompactionBoundary, appendLines, addGoalEntry, readPlanDocument, completeRootByGoalDone, closeAsksOnCompletedNodes, openWorkerAsk, writeMemoryRecord, kitInstallPathOf, recognitionAsk, pushDeliveryLine, promoteOpenRecord, workdirPathOf, notePairDraftsDropped, noteMemoryWrite, clearChildBlockedAncestors, openClosingLeafOf, noteTurnToolCall, turnMayStartEffort, turnIsOperatorsOrCoordinators, turnIsOperators, hookBudget, COMPACT_HOLD_REMINDER_TEXT, urgentCheckMinMs, breakInAfterMs, toolErrorsThisTurn, setToolErrorsThisTurn, toolCallsThisTurn, setToolCallsThisTurn, nudgeCountWorkThisTurn, setNudgeCountWorkThisTurn, goalDoneClosedThisTurn, setReplyCalledThisTurn, pendingCompactionBank, setPendingCompactionBank, currentTurnOriginKind, currentTurnAuthor, turnLeafId, currentTurnEntry, currentGateTurnId, compactionHeld, proposalLedgeredTurnId, setProposalLedgeredTurnId, compactionReminderAt, setCompactionReminderAt, lastBreakInCheckAt, setLastBreakInCheckAt, sess, cfg, expectedTurns, openTurns, coordinatorPersona, architectPersona, fleetRoster, jevMode, compactionPassOption, selfReviewLessonCount, dropDecision, commonsMeta, planningInFlight, arming, setCountResetSinceNudgeOpened } = ctx;
  // An "off" session runs the guard and after-hook region around next(e)
  // and the compaction pass's rerun watch, and nothing else: no call
  // counting, no persona tool, no constraint. The watch counts a call
  // under the armed path's condition below: a main-loop call the model
  // made that the engine ran, under live with the seam sending.
  if (arming() === "off") {
    const offGuarded = await guardedNext();
    if ("early" in offGuarded) return offGuarded.early;
    const modelMadeCall = originIsEngine();
    const inSubagent = typeof e.agentId === "string" && e.agentId.length > 0;
    if (modelMadeCall && !inSubagent && typeof (offGuarded.r as { deny?: unknown }).deny !== "string" && compactionPassOption === "live" && jevMode === "shadow") {
      try {
        await compactionRerunAtCall(compactionPassDeps(), e.tool, toolCallInputOf(e));
      } catch { /* the window stands as it was; the result stands */ }
    }
    return offGuarded.r;
  }
  sess.state.monitor.totalToolCalls += 1;
  if (isWorkTool(e.tool)) setToolCallsThisTurn(toolCallsThisTurn() + 1);
  // Whether this call comes from a loop other than the main one: e.agentId,
  // the loop's id, is non-empty on a dispatched subagent's, a teammate's, a
  // workflow agent's or an engine fork's calls and absent on the main
  // loop's. The break-in check below reads it too.
  const inSubagent = typeof e.agentId === "string" && e.agentId.length > 0;
  // A subagent's own calls do not count as the main loop's work for the
  // nudge count: an agent dispatched in an earlier turn can still be
  // running, and its calls say nothing about whether the worker answered.
  if (!inSubagent && isNudgeCountWork(e.tool)) setNudgeCountWorkThisTurn(nudgeCountWorkThisTurn() + 1);
  // Section 5 (goal-every-turn): the main loop's call joins the turn's tool
  // activity, on the same ground the nudge count excludes a subagent's.
  if (!inSubagent && typeof e.tool === "string") noteTurnToolCall(e.tool, e as { file_path?: unknown; path?: unknown; notebook_path?: unknown; command?: unknown });
  if (!inSubagent) skillPickTool(e);
  // The recall chain's outcome input: a shell command of any loop that
  // fetches a record through memq get without --no-stamp names it as acted
  // on, a subagent's fetch being the session's own as much as the main
  // loop's. Every name is kept, since the prompt's candidates are known
  // only once its chain has collected them, and the outcome step reads the
  // set against the candidates alone. A text read of the command and never
  // a run, of a Bash or PowerShell call's command, the tool named in any
  // case as the recognition match reads it, and read once for both outcomes.
  // The recall outcome reads the names whatever tier each get reads, and
  // skips a get memq refuses. A memq touch --applied in the same command
  // is the outcome's other input, kept with the tier it stamps, since it
  // counts only for a candidate shown from that tier; a touch memq refuses
  // stamps nothing and is skipped the same way.
  const shellCommand = shellCommandOf(e.tool, (e as { command?: unknown }).command);
  const fetches = memqGetsOf(shellCommand);
  for (const g of fetches) if (g.tier !== "refused") sess.recallGetNames.add(g.name.toLowerCase());
  // A get shows the record to the stretch fork, and a touch stamps it.
  for (const g of fetches) if (g.tier !== "refused") sess.state.stretchShown = noteStretchShown(sess.state.stretchShown, stretchShownOfGet(g), Date.now());
  for (const t of memqTouchesOf(shellCommand)) {
    if (t.tier === "refused") continue;
    sess.recallTouches.push(t);
    markStretchApplied(sess.state.stretchShown, t.name);
  }
  // The recognition ask's outcome input: each main-loop call counts
  // against the open nudge_acted windows, since a nudge reaches the main
  // loop alone, the nudge standing down on a subagent's calls.
  if (!inSubagent) settleRecognitionOutcomes(fetches);
  // Steer 68/69: the reply tool ran somewhere in this turn, so the
  // channel-reply backstop at turn.complete has nothing to backfill.
  if (typeof e.tool === "string" && (e.tool.includes("__reply") || e.tool.endsWith("_reply"))) {
    setReplyCalledThisTurn(true);
  }

  // The compaction boundary the persona's last own turn owed, taken at the
  // first main-loop tool call after it, before this call's tool is served
  // or passed on, so the marker records a position before that tool's
  // work. A sibling call from the same assistant message is not held back
  // while the bank runs, so its work may land after the marker. By
  // this point the turn's opening prompt line is on disk, which turn.start
  // cannot guarantee. Only a call the model made takes it: next.origin
  // names "engine" there. A call a plugin raised through the engine's tool verb
  // reaches this hook too, this plugin's own reply backfill among them,
  // which runs inside turn.complete, the one moment a marker is never
  // honored. So a call whose origin names a plugin, or carries no origin,
  // neither runs nor clears the owed bank, and neither does a subagent's
  // call. The owed bank is cleared before the command runs, so it clears
  // whatever the exit, and runs only while this session is still the
  // owner, since ownership lost between the two events leaves nothing this
  // session should bank. bankCompactionBoundary never throws, and its one
  // decision is saved the way this handler's other bookkeeping lines are.
  const modelMadeCall = originIsEngine();
  // Whether this call ran the boundary verb, so the hold reminder below
  // does not tell the session to run what this call just ran.
  let bankedOnThisCall = false;
  if (modelMadeCall && !inSubagent && pendingCompactionBank() !== null) {
    const owedBank = pendingCompactionBank()!;
    setPendingCompactionBank(null);
    if (sess.isOwner) {
      bankedOnThisCall = true;
      await bankCompactionBoundary(owedBank.turnKind);
      try { await persist(); } catch { /* persist could not read or write the store; the decision waits in memory */ }
    }
  }

  // Serve agentic_identity (F9: single arbiter = commons; epoch is only the
  // same-directory write fence). Claim in commons FIRST; if a live earlier
  // holder exists, join as reader (no epoch bump, no ownership).
  if (e.tool === "mcp__personas__agentic_identity") {
    // A call naming no persona (absent, null, empty, blank, or not a string at
    // all) is a read of the identity the session holds: it answers from the
    // session's own state and returns before the name rule, the store read and
    // the claim, so it switches nothing and writes nothing. Only a non-blank
    // string name switches.
    const rawPersona = (e as any).persona;
    if (typeof rawPersona !== "string" || rawPersona.trim() === "") {
      if (sess.stateNotLoaded !== null) return { result: stateNotLoadedText(sess.stateNotLoaded) };
      return {
        result: sess.isOwner
          ? `persona '${sess.persona}' active (epoch ${sess.myEpoch}, owner). ${selfReviewLessonCount()} self-review lessons. ${previousSessionsText(sess.state)}`
          : `persona '${sess.persona}': joined as reader (${arming() === "reader" ? "arming reader" : `epoch ${sess.myEpoch}`}). ${selfReviewLessonCount()} self-review lessons. ${previousSessionsText(sess.state)}`,
      };
    }
    const name = rawPersona.trim();
    // The shared name rule, before any claim or store write: a persona
    // that fails it could be owned but never addressed, and its inbox
    // listing would read another persona's keys.
    const nameProblem = personaNameProblem(name);
    if (nameProblem) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_identity: 'persona' ${nameProblem} (got '${name}').` };
    }
    // A store that is not an object of persona entries throws here, as a
    // store that does not parse does, before the session takes the new
    // name, resets its untracked-work line or releases its old claim. A
    // refused switch leaves the session on the persona it held.
    const store: Record<string, unknown> = await fsExists(sess.storePath)
      ? parsePersonaStore(await fsRead(sess.storePath))
      : {};
    const previousPersona = sess.persona;
    sess.persona = name;
    // The held untracked_work line lives in the previous persona's log, so
    // a switch starts the new persona's line afresh rather than carrying
    // the old count into it.
    if (name !== previousPersona) {
      sess.untrackedWorkAt = null;
      sess.untrackedWorkCount = 0;
    }
    if (arming() === "reader") {
      // A reader session never claims persona:<name> here, never
      // arbitrates for it, and never becomes its owner: it only ever
      // joins as a reader. It keeps every reader:<target> claim it has
      // made, because delivery grounds each pending record on a live
      // reader:<target> claim at delivery time.
      const existing = store[name] as AgentState | undefined;
      // The store parsed as an object, so the state below is the persona's own.
      sess.stateNotLoaded = null;
      if (existing) {
        sess.state = parseState(JSON.stringify(existing));
        sess.state.persona = name;
      } else {
        sess.state = createDefaultState(name, sess.mySessionId);
      }
      sess.isOwner = false;
      sess.myEpoch = existing?.epoch ?? 0;
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "passive_reader",
        detail: `Joining '${sess.persona}' as reader (arming reader)`,
      });
      await claimReaderRole(commonsStore(), sess.persona, sess.mySessionId, Date.now(), commonsMeta());
      return {
        result: `persona '${sess.persona}': joined as reader (arming reader). ${selfReviewLessonCount()} self-review lessons. ${previousSessionsText(sess.state)}`,
      };
    }
    // Backlog fix (commons claim staleness): a commons session record shares
    // one lastSeen across every claim it has ever made, so a persona claim
    // left behind on switch reads as live for as long as this session keeps
    // heartbeating under its NEW persona - blocking any other session from
    // ever winning that old persona's arbitration. Release it here, the one
    // place a session's persona actually changes.
    if (previousPersona && previousPersona !== name) {
      try {
        await releaseResource(commonsStore(), `persona:${previousPersona}`, sess.mySessionId, Date.now(), commonsMeta());
      } catch { /* non-fatal: commons is a coordination layer */ }
    }
    const existing = store[name] as AgentState | undefined;
    // The store parsed as an object, so the state below is the persona's
    // own. This is how a session whose session.start did not finish
    // recovers its state: the goal tools answer from it once this has run.
    sess.stateNotLoaded = null;
    if (existing) {
      sess.state = parseState(JSON.stringify(existing));
      sess.state.persona = name;
    } else {
      sess.state = createDefaultState(name, sess.mySessionId);
    }
    // The nudge count is the loaded persona's from here, so answers given
    // under the previous persona neither carry into it nor are added by
    // the answer closing this turn.
    sess.nudgedAnswersWithoutStatus = 0;
    sess.nudgeCapRefusedFor = null;
    setCountResetSinceNudgeOpened(true);
    // F9: commons is the single arbiter. Claim first, then check if a live
    // earlier holder exists. Only the commons winner takes ownership.
    const resource = `persona:${sess.persona}`;
    let winnerId = sess.mySessionId; // default: we are the winner
    let shouldYieldTo: string | null = null;
    try {
      await claimResource(commonsStore(), resource, sess.mySessionId, Date.now(), commonsMeta());
      const claims = await readAllClaims(commonsStore(), sess.staleAfterMs);
      const winner = commonsWinner(claims, resource);
      if (winner && winner !== sess.mySessionId) {
        shouldYieldTo = winner;
      } else {
        winnerId = winner ?? sess.mySessionId;
      }
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "persona_claim_commons",
        detail: `Claimed ${resource} in commons (session ${sess.mySessionId}, winner ${winnerId})`,
      });
    } catch { /* non-fatal: commons is a coordination layer, not a hard dependency */ }

    if (shouldYieldTo) {
      // F9: a live earlier holder exists. Join as reader, do NOT bump epoch,
      // do NOT set isOwner, do NOT write the heartbeat.
      sess.isOwner = false;
      sess.myEpoch = existing?.epoch ?? 0;
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "passive_reader",
        detail: `Joining '${sess.persona}' as reader (holder: ${shouldYieldTo}, commons arbitration)`,
      });
      try { log(`Agentic: joined '${sess.persona}' as reader (held by ${shouldYieldTo})`); } catch { /* non-fatal */ }
      // Round 32: the claimResource call above speculatively claimed
      // `persona:<p>` before the winner was known. A reader join must not
      // keep that claim - left in place, it reads as a live persona holder
      // under this session's own heartbeat and blocks the next relaunch's
      // pre-gate for the full stale-after window, exactly as the stale
      // `persona:default` claim did. Release it before claiming the reader
      // role, so the joiner ends with reader:<p> only.
      try {
        await releaseResource(commonsStore(), resource, sess.mySessionId, Date.now(), commonsMeta());
      } catch { /* non-fatal: commons is a coordination layer */ }
      // D2: Claim the reader role
      await claimReaderRole(commonsStore(), sess.persona, sess.mySessionId, Date.now(), commonsMeta());
      return {
        result: `persona '${sess.persona}' is held by session ${shouldYieldTo}; joined as reader. ${selfReviewLessonCount()} self-review lessons. ${previousSessionsText(sess.state)}`,
      };
    }

    // Commons winner: take ownership, bump epoch, write heartbeat.
    recordPreviousSession(sess.state, sess.state.activeSessionId, sess.mySessionId);
    sess.state.activeSessionId = sess.mySessionId;
    sess.state.epoch += 1;
    sess.myEpoch = sess.state.epoch;
    sess.isOwner = true;
    sess.state.monitor.sessionStart = Date.now();
    sess.state.monitor.turnCount = 0;
    sess.state.monitor.totalToolCalls = 0;
    sess.state.monitor.errors = 0;
    sess.state.monitor.lastTurnComplete = Date.now();
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "monitor",
      action: "identity_set",
      detail: `persona '${sess.persona}' (session ${sess.mySessionId}, epoch ${sess.myEpoch}, commons winner)`,
    });
    // Commons winner: one of the three claim sites that share writeClaimDirect
    // (the other two are session.start and the heartbeat tick promotion).
    // The claimant is the commons winner (activeSessionId = self), so the write
    // must not go through persist's yield check.
    await writeClaimDirect();
    // The new owner moves the distillates this persona's JSON still holds,
    // as the start's claim does.
    try {
      await migrateLegacyMemories();
    } catch { /* non-fatal */ }
    return {
      result: `persona '${sess.persona}' active (epoch ${sess.myEpoch}, owner). ${selfReviewLessonCount()} self-review lessons. ${previousSessionsText(sess.state)}`,
    };
  }

  // Serve goal_create (v3: creates the root node, NO planning in handler: R1).
  if (e.tool === "mcp__personas__goal_create") {
    // Before the owner check: a session that never loaded its state is not
    // an owner either, and "held by a live session" would be untrue of it.
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    // A new tree is a new effort, so the turn-origin gate runs before any
    // argument is read.
    if (!turnMayStartEffort("goal_create")) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: EFFORT_REFUSED_TEXT };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const objective = String((e as any).objective || "").trim();
    if (!objective) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "goal_create requires a non-empty 'objective'." };
    }
    const maxRounds = Math.min(Math.max(parseInt(String((e as any).maxRounds || "10"), 10) || 10, 1), 50);
    const roadmapPath = String((e as any).roadmapPath || "").trim() || undefined;
    // Arguments can arrive stringified, as maxRounds above can, so the
    // string "true" counts. Any other value leaves replace unset.
    const rawReplace = (e as any).replace;
    const replace = rawReplace === true || rawReplace === "true";

    // An unfinished tree, one whose root is neither complete nor abandoned,
    // is replaced only when the call says so. A finished tree needs no
    // replace, so starting the next goal after one completes stays one call.
    const oldRoot = sess.state.goals.find((g) => g.parentId === null);
    const isOpen = (g: GoalNode) => g.status !== "complete" && g.status !== "abandoned";
    if (oldRoot && isOpen(oldRoot) && !replace) {
      const openCount = sess.state.goals.filter((g) => g.parentId !== null && isOpen(g)).length;
      const openText = openCount === 0
        ? `its root is ${oldRoot.status}`
        : `${openCount === 1 ? "1 entry under its root is" : `${openCount} entries under its root are`} not complete or abandoned`;
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return {
        deny:
          `The goal tree "${oldRoot.title}" is unfinished: ${openText}. ` +
          `Pass replace: true to replace the tree, or use goal_add to extend it.`,
      };
    }

    const now = Date.now();

    // A tree holding any entry besides its root is copied to the history
    // file before it is replaced. The copy comes first, so a replacement
    // whose copy could not be written is refused and the tree stands.
    if (sess.state.goals.some((g) => g.parentId !== null)) {
      const line = JSON.stringify({ timestamp: now, persona: sess.persona, reason: "goal_create", goals: sess.state.goals });
      try {
        await appendLines(workdirPathOf(GOAL_HISTORY_FILENAME), [line]);
      } catch (err) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return {
          deny:
            `The history copy in ${GOAL_HISTORY_FILENAME} could not be written, so the goal tree was not replaced: ` +
            boundedText(safeErrorText(err)),
        };
      }
    }

    const rootId = `root-${now.toString(36)}`;
    const root: GoalNode = {
      id: rootId,
      parentId: null,
      kind: "root",
      title: objective.slice(0, 80),
      objective,
      status: "pending",
      source: "operator",
      maxRounds, // L9: operator's value as the default for plans
      completedRounds: 0,
      scores: [],
      notes: [],
      roadmapPath,
      planningRounds: 0,
      consecutiveBlockedPlannings: 0,
      consecutivePlanningFailures: 0,
      planningRound: 0,
      createdAt: now,
      updatedAt: now,
    };
    // A root created on a channel turn records who asked, where the
    // envelope named them, cut to ASKED_BY_MAX_CHARS.
    if (currentTurnOriginKind() === "channel" && currentTurnAuthor() !== "") root.askedBy = currentTurnAuthor().slice(0, ASKED_BY_MAX_CHARS);

    // Every open ask belongs to the tree being replaced, and an open
    // blocking one would hold goal_add's activation on the new tree. Each
    // closes as superseded on the ledger and, where its record is still
    // open, on the record.
    {
      const store = commonsStore();
      for (const entry of openAskEntries(sess.state)) {
        const askRecord = await readAskRecord(store, sess.persona, entry.id);
        if (askRecord && askRecord.status === "open") {
          askRecord.status = "superseded";
          await store.set(askKey(sess.persona, entry.id), askRecord);
        }
        closeAsk(sess.state, entry.id, "superseded", "goal_create", "tree replaced", now);
        sess.state.decisions.push({
          timestamp: now,
          loop: "monitor",
          action: "ask_answered",
          detail: `ask ${entry.id} closed by goal_create (status: superseded)`,
        });
      }
    }

    // Replace any existing tree.
    sess.state.goals = [root];
    sess.state.activeGoalId = null;

    sess.state.decisions.push({
      timestamp: now,
      loop: "goal",
      action: "create",
      detail: `Root ${rootId} "${objective.slice(0, 80)}" created (max ${maxRounds} rounds)`,
    });
    // Route two of the promotion routes: the message this turn is answering
    // is what the operator turned into this tree, so its record is marked
    // promoted with the root's id and rides the same write. The undo is
    // dropped rather than kept, since this handler rolls nothing back on a
    // refused write: the replaced tree stands in memory either way, and a
    // record marked against the root it names is no worse off than the tree.
    promoteOpenRecord(rootId, "goalId", now);
    // H2b: a new goal inherits a clean nudge budget.
    sess.nudgedAnswersWithoutStatus = 0;
    sess.nudgeCapRefusedFor = null;
    setCountResetSinceNudgeOpened(true);
    sess.lastNudgeAt = 0;

    const writeOk = await persist();
    if (writeOk) {
      return {
        result: `Root created; planning runs at the next controller tick.`,
      };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve goal_add (R4: parent resolution).
  if (e.tool === "mcp__personas__goal_add") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const givenTitle = String((e as any).title || "").trim();
    const objective = String((e as any).objective || "").trim();
    // Route three of the promotion routes: an add made from a task of the
    // working list. The task's own text is the title where the call gives
    // none, so turning a working item into a tree entry is one call rather
    // than a copy, and the task leaves the list inside this add's own write.
    // An id no task carries is refused before anything is read off it, the
    // way an unknown parentId is. The lookup is over the whole list rather
    // than under the active goal alone, since the entry this add builds is
    // placed by parentId and need not sit under the goal the task did.
    const rawTaskId = (e as any).taskId;
    let sourceTask: TaskItem | undefined;
    if (rawTaskId !== undefined && rawTaskId !== null) {
      const taskId = String(rawTaskId).trim();
      sourceTask = sess.state.tasks.find((t) => t.id === taskId);
      if (sourceTask === undefined) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `taskId "${taskId.slice(0, TASK_ID_MAX_CHARS)}" not found in the task list.` };
      }
    }
    const title = givenTitle || (sourceTask === undefined ? "" : sourceTask.text);
    if (!title || !objective) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "goal_add requires non-empty 'title' and 'objective'." };
    }
    const kind = String((e as any).kind || "task").trim() === "plan" ? "plan" : "task";
    // A plan is a new effort, so it passes the turn-origin gate once its
    // kind is known and before anything is written. A task works inside
    // what the persona already holds and is never gated. At plan-and-ask
    // and plan-and-start the gate admits a plan in every turn, and a plan
    // added outside the operator's and the coordinator persona's turns is
    // reported to the coordinator persona below.
    // The level is read once, so the gate and the entry's status below
    // decide on the same value.
    const autonomy = sess.state.autonomy;
    if (kind === "plan" && !turnMayStartEffort("goal_add_plan", autonomy)) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: EFFORT_REFUSED_TEXT };
    }
    const maxRounds = Math.min(Math.max(parseInt(String((e as any).maxRounds || "10"), 10) || 10, 1), 50);
    const explicitParent = String((e as any).parentId || "").trim();

    // Section 1 (plan-health-from-the-record): planPath is validated before
    // anything is mutated, same as every other goal_add refusal below. The
    // kind check comes first so a task carrying a syntactically valid path
    // is refused for the kind reason, not the pattern reason - each rule
    // owns exactly the cases it names, since a later reader (Section 2)
    // joins this value onto the working directory and reads the file it
    // names, and needs to know a task never held one. Both refusals state
    // the required form, so the rule that fired is named by how the
    // message opens rather than by which of them mentions the form.
    //
    // Absent means undefined or null, and nothing else. A present but
    // empty or whitespace-only value is a caller that meant to pass a path
    // and passed nothing, so on a task it is the kind refusal like any
    // other value.
    //
    // A plan entry is one with a plan document, judged from that document
    // rather than from a count of turns, so an add of kind "plan" must
    // name one. An absent, empty or whitespace-only value names none and
    // is refused by the no-path rule, whose message opens with the rule
    // and closes with the required form; a value that names something is
    // held to the pattern by the form rule. A plan entry has no round
    // budget either, so maxRounds on kind "plan" is refused once the path
    // is settled, and an add both rules would refuse reads the no-path
    // refusal alone. Present for maxRounds means neither undefined nor
    // null, as for planPath, so a string or a zero is refused too.
    const rawPlanPath = (e as any).planPath;
    let planPath: string | undefined;
    if (rawPlanPath !== undefined && rawPlanPath !== null && kind !== "plan") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: 'planPath is only allowed on kind "plan". ' + PLAN_PATH_REQUIRED_FORM };
    }
    if (kind === "plan") {
      const trimmed = rawPlanPath === undefined || rawPlanPath === null ? "" : String(rawPlanPath).trim();
      if (trimmed === "") {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return {
          deny:
            "A plan entry names its plan document, and an entry without one runs on a round budget, " +
            "so goal_add of a plan requires planPath. " + PLAN_PATH_REQUIRED_FORM,
        };
      }
      if (!PLAN_PATH_PATTERN.test(trimmed)) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: PLAN_PATH_REQUIRED_FORM };
      }
      const rawMaxRounds = (e as any).maxRounds;
      if (rawMaxRounds !== undefined && rawMaxRounds !== null) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return {
          deny:
            "A plan entry has no round budget: it is judged from its plan document. " +
            'maxRounds is for kind "task"; add this plan without it.',
        };
      }
      planPath = trimmed;
    }

    const root = sess.state.goals.find((g) => g.parentId === null);
    if (!root) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "No goal tree exists. Call goal_create first." };
    }

    // R4: parent resolution.
    let parentId: string;
    if (explicitParent) {
      const parent = sess.state.goals.find((g) => g.id === explicitParent);
      if (!parent) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `parentId "${explicitParent}" not found in goal tree.` };
      }
      if (kind === "plan" && parent.parentId !== null) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: 'kind "plan" is only allowed under the root.' };
      }
      parentId = explicitParent;
    } else if (kind === "plan") {
      // Section 10 fix round: a plan always resolves to the root when no
      // parentId is given, whatever is active. Without this, Section 10's
      // own no-active-leaf branch below activates the first plan a worker
      // adds in a turn, and a second plan add in the same turn - with no
      // parentId, exactly what this tool's own description tells a worker
      // to omit - would resolve under that now-active first plan and be
      // denied ("plan" only allowed under the root), which never happened
      // before this section since no plan stayed active mid-turn.
      parentId = root.id;
    } else {
      const active = sess.state.activeGoalId
        ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
        : null;
      if (active) {
        if (active.kind === "plan") {
          parentId = active.id;
        } else {
          // Active task's parent.
          parentId = active.parentId ?? root.id;
        }
      } else {
        parentId = root.id;
      }
    }

    // Validate kind under parent.
    const parentNode = sess.state.goals.find((g) => g.id === parentId)!;
    if (kind === "plan" && parentNode.parentId !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: 'kind "plan" is only allowed under the root.' };
    }
    // M6: deny goal_add whose resolved parent is a task (three levels max: root > plan > task).
    if (parentNode.kind === "task") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "Cannot add a node under a task. The tree is root > plan > task; nothing deeper." };
    }

    // The add itself, the coordinator record it sends, the task it drops and
    // the open turn record it promotes all run in addGoalEntry, which route
    // one of the promotion routes calls too, so neither route holds a second
    // copy of the dial's shape. What stays here is what only a tool call can
    // read: whether this turn's origin makes the add unprompted, and the text
    // the model is answered with.
    const unprompted = kind === "plan" && !turnIsOperatorsOrCoordinators();
    const awaitingYes = unprompted && autonomy === "plan-and-ask";
    const added = await addGoalEntry({
      kind,
      title,
      objective,
      parentId,
      root,
      maxRounds,
      planPath,
      unprompted,
      awaitingYes,
      dropTaskId: sourceTask?.id,
      coordinatorPersona,
      architectPersona,
    });
    if (!added.ok) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: added.deny };
    }
    const newNode = added.node;
    {
      const nextActive = sess.state.activeGoalId
        ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
        : null;
      const told = !unprompted ? ""
        : awaitingYes ? ` It waits paused for the operator's yes, and a [PROPOSAL] record naming ${newNode.id} went to the coordinator persona.`
        : ` A [STARTED] record naming ${newNode.id} went to the coordinator persona.`;
      const fromTask = sourceTask === undefined ? "" : ` The task ${sourceTask.id} it was made from left the list.`;
      return {
        result: (nextActive
          ? `Added ${kind} "${title.slice(0, 50)}". Now active: ${nextActive.id} "${nextActive.title}".`
          : `Added ${kind} "${title.slice(0, 50)}". No active goal; planning or activation will occur at the next tick.`) + told + fromTask,
      };
    }
  }

  // Serve goal_edit (plan item 3: drop / pause / reprioritize a node in
  // response to an operator steer). Each branch logs a decision naming the
  // change, so the decision log plus the resulting tree diff is the proof
  // the operator's request actually changed something.
  if (e.tool === "mcp__personas__goal_edit") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const nodeId = String((e as any).nodeId || "").trim();
    const action = String((e as any).action || "").trim();
    const reason = String((e as any).reason || "").trim();
    if (!nodeId || !["drop", "pause", "reprioritize"].includes(action)) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: 'goal_edit requires a valid nodeId and action ("drop" | "pause" | "reprioritize").' };
    }
    const node = sess.state.goals.find((g) => g.id === nodeId);
    if (!node) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `nodeId "${nodeId}" not found in goal tree.` };
    }
    if (node.parentId === null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "Cannot edit the root; goal_create with replace: true replaces the whole tree instead." };
    }
    const now = Date.now();

    if (action === "drop") {
      // Item 8.1's own bullet in one line: a blocked node (e.g. a stale duplicate the planner
      // left behind) could not be retired at all before this - drop refused it alongside every
      // other status, and nothing else marks a blocked node done or dropped. Allowed here, same
      // as pending/paused, with the reason always recorded (never optional for this status, so
      // the tree can say why a blocked node was let go rather than just that it was).
      //
      // A plan's open closing leaf is the plan's one reachable entry while
      // its document reads short of Complete, so it is never dropped on
      // its own, whatever its status or whose turn this is; dropping the
      // plan takes it. This refusal comes first, ahead of the status and
      // awaiting-yes refusals, so the leaf's usual state, active, gets this
      // answer rather than the generic one, and it names the plan to drop.
      const dropParent = sess.state.goals.find((g) => g.id === node.parentId);
      if (dropParent && dropParent.kind === "plan" && openClosingLeafOf(dropParent) === node) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `${CLOSING_LEAF_DROP_REFUSED_TEXT} Its id is ${dropParent.id}.` };
      }
      if (node.status !== "pending" && node.status !== "paused" && node.status !== "blocked") {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `Cannot drop ${nodeId}: status is "${node.status}" (only pending, paused, or blocked nodes can be dropped).` };
      }
      if (node.awaitingYes && !turnIsOperatorsOrCoordinators()) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: AWAITING_YES_DROP_REFUSED_TEXT };
      }
      // A dropped plan's open closing leaf is abandoned with it, and the
      // active slot leaves it where it named it, so no open leaf stays
      // under a dropped plan. No other child is touched.
      const droppedLeaf = node.kind === "plan" ? openClosingLeafOf(node) : undefined;
      node.status = "abandoned";
      node.blockedReason = reason || "dropped by operator";
      // A dropped entry no longer waits for the operator's yes.
      node.awaitingYes = undefined;
      node.updatedAt = now;
      sess.state.decisions.push({
        timestamp: now,
        loop: "goal",
        action: "drop",
        detail: `${nodeId}: ${node.blockedReason}`,
      });
      if (droppedLeaf) {
        droppedLeaf.status = "abandoned";
        droppedLeaf.blockedReason = `dropped with ${nodeId}`;
        droppedLeaf.updatedAt = now;
        if (sess.state.activeGoalId === droppedLeaf.id) sess.state.activeGoalId = null;
      }
    } else if (action === "pause") {
      if (node.status !== "active" && node.status !== "pending") {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `Cannot pause ${nodeId}: status is "${node.status}" (only an active or pending node can be paused).` };
      }
      const wasActive = node.status === "active";
      node.status = "paused";
      node.blockedReason = reason || "paused by operator";
      node.updatedAt = now;
      if (wasActive && sess.state.activeGoalId === nodeId) {
        sess.state.activeGoalId = null;
      }
      sess.state.decisions.push({
        timestamp: now,
        loop: "goal",
        action: "paused_by_operator",
        detail: `${nodeId}: ${node.blockedReason}`,
      });
    } else {
      // reprioritize: move nodeId to activate before its pending siblings.
      if (node.status !== "pending") {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `Cannot reprioritize ${nodeId}: status is "${node.status}" (only a pending node can be reprioritized).` };
      }
      const siblings = sess.state.goals.filter((g) => g.parentId === node.parentId && g.id !== nodeId);
      const earliestKey = siblings.length > 0
        ? Math.min(...siblings.map((g) => g.sortKey ?? g.createdAt))
        : node.sortKey ?? node.createdAt;
      node.sortKey = earliestKey - 1;
      node.updatedAt = now;
      sess.state.decisions.push({
        timestamp: now,
        loop: "goal",
        action: "reprioritized",
        detail: `${nodeId}: moved to front of ${node.parentId ?? "root"}'s pending siblings${reason ? ` (${reason})` : ""}`,
      });
    }

    const writeOk = await persist();
    if (writeOk) {
      return { result: `${action} applied to ${nodeId}. Now: [${node.status}] "${node.title}".` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve goal_longterm: add or drop one entry of the long-term goal list.
  // The list sits beside the tree, so nothing here reads or writes goals or
  // activeGoalId. Each change logs a decision, and a drop's decision
  // carries its reason.
  if (e.tool === "mcp__personas__goal_longterm") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    // Both actions change what the persona works towards, so the
    // turn-origin gate runs before any argument is read.
    if (!turnMayStartEffort("goal_longterm")) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: EFFORT_REFUSED_TEXT };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const action = String((e as any).action || "").trim();
    if (action !== "add" && action !== "drop") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: 'goal_longterm requires action "add" or "drop".' };
    }
    const list = sess.state.longTermGoals;
    const now = Date.now();
    let resultText: string;

    if (action === "add") {
      const title = String((e as any).title || "").trim();
      const objective = String((e as any).objective || "").trim();
      if (!title || !objective) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: "goal_longterm add requires non-empty 'title' and 'objective'." };
      }
      if (list.length >= LONG_TERM_GOAL_CAP) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return {
          deny:
            `goal_longterm add refused: ${list.length} long-term goals are held and the cap is ${LONG_TERM_GOAL_CAP}. ` +
            `Drop one with goal_longterm drop first.`,
        };
      }
      // The node id form with its own prefix, so a long-term id never reads
      // as a root, plan or task id. The title and objective are cut to the
      // lengths the planner cuts a plan's to, since the list is shown in a
      // prompt as plans are.
      const entry: LongTermGoal = {
        id: `lt-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title: title.slice(0, 80),
        objective: objective.slice(0, 500),
        createdAt: now,
      };
      list.push(entry);
      sess.state.decisions.push({
        timestamp: now,
        loop: "goal",
        action: "longterm_added",
        detail: `${entry.id} "${entry.title.slice(0, 50)}"`,
      });
      resultText = `Long-term goal added: ${entry.id} "${entry.title}".`;
    } else {
      const id = String((e as any).id || "").trim();
      const reason = String((e as any).reason || "").trim();
      const index = id ? list.findIndex((g) => g.id === id) : -1;
      if (index === -1) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        const held = list.length > 0 ? list.map((g) => g.id).join(", ") : "none";
        return {
          deny:
            `goal_longterm drop needs the id of a held long-term goal, and ` +
            `${id ? `"${id.slice(0, 50)}" is not one` : "no id was given"}. Held: ${held}.`,
        };
      }
      if (!reason) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: "goal_longterm drop requires a non-empty 'reason', which is recorded." };
      }
      const [dropped] = list.splice(index, 1);
      sess.state.decisions.push({
        timestamp: now,
        loop: "goal",
        action: "longterm_dropped",
        detail: `${dropped.id} "${String(dropped.title ?? "").slice(0, 50)}": ${reason.slice(0, 80)}`,
      });
      resultText = `Long-term goal dropped: ${dropped.id} "${String(dropped.title ?? "")}".`;
    }

    const writeOk = await persist();
    if (writeOk) {
      return { result: resultText };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve goal_autonomy: set the persona's autonomy level. The level is the
  // operator's alone, so the turn gate runs before the owner check and
  // before the argument is read. A write that is not saved puts the old
  // level and the decision log back, so what the session holds matches the
  // store.
  if (e.tool === "mcp__personas__goal_autonomy") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!turnIsOperators()) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: AUTONOMY_REFUSED_TEXT };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const rawLevel = (e as any).level;
    const level = typeof rawLevel === "string" ? rawLevel.trim() : "";
    if (!isAutonomyLevel(level)) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `goal_autonomy requires level to be one of ${AUTONOMY_LEVELS.map((l) => `"${l}"`).join(", ")}.` };
    }
    const previous = sess.state.autonomy;
    sess.state.autonomy = level;
    const decision: AgentState["decisions"][number] = {
      timestamp: Date.now(),
      loop: "goal",
      action: "autonomy_set",
      detail: `${previous} -> ${level}`,
    };
    sess.state.decisions.push(decision);
    const writeOk = await persistOrRollBack(() => {
      sess.state.autonomy = previous;
      dropDecision(decision);
    });
    if (writeOk) {
      return { result: `Autonomy level set: ${level} (was ${previous}).` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve goal_done (R3: use completeLeaf + activateNext). With no nodeId it
  // completes the active leaf. With a nodeId it completes that entry by
  // name, where the entry is not the root, is not already complete or
  // abandoned, and has no child still open. An entry that was not the
  // active one when the call arrived earns no round or score credit and
  // leaves any other active entry active.
  if (e.tool === "mcp__personas__goal_done") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const note = String((e as any).note || "").trim();
    const byNameId = String((e as any).nodeId || "").trim();
    const active = sess.state.activeGoalId
      ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
      : null;
    // A plan's closing leaf completes with its plan once the document reads
    // Complete. While the document reads a Status: value short of that,
    // goal_done on the leaf completes nothing and answers with the same
    // finish-the-document sentence the walk up gives, so the leaf stays
    // the entry the controller nudges on. A document that does not read or
    // has no Status: line holds nothing here, as it holds nothing in the
    // walk up. Both branches below ask this before they change anything.
    const closingLeafRefusal = async (node: GoalNode): Promise<string | null> => {
      const plan = node.parentId ? sess.state.goals.find((g) => g.id === node.parentId) : undefined;
      if (!plan || !plan.planPath || openClosingLeafOf(plan) !== node) return null;
      const { reading } = await readPlanDocument(plan.planPath);
      if (reading.kind !== "read" || reading.status === null || reading.complete) return null;
      return `Not complete: "${node.title}" closes itself once the plan document reads Complete.${planLeftOpenText(plan, planStatusText(reading.status))}`;
    };
    let target: GoalNode;
    if (byNameId) {
      const named = sess.state.goals.find((g) => g.id === byNameId);
      if (!named) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `nodeId "${byNameId.slice(0, 50)}" not found in goal tree.` };
      }
      if (named.parentId === null) {
        // The root completes by name on one admission: every descendant
        // is complete or abandoned with at least one complete, in a turn
        // the operator or the coordinator persona opened. That is the
        // operator's word that a breakdown the planner made is done, which
        // isRootFinished cannot read on its own (a planned root stays the
        // planner's there). The tool's note is the root_complete detail,
        // the same decision the controller's own completion writes, and
        // none of the leaf follow-on below runs.
        if (named.status === "complete" || named.status === "abandoned") {
          setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
          return { deny: `Cannot complete ${byNameId}: status is already "${named.status}".` };
        }
        const descendants = sess.state.goals.filter((g) => g.parentId !== null);
        const openDescendant = descendants.find((g) => g.status !== "complete" && g.status !== "abandoned");
        if (openDescendant) {
          setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
          return { deny: `Cannot complete ${byNameId}: it is the root, status "${named.status}", and its descendant ${openDescendant.id} is "${openDescendant.status}". The root completes by name only once every entry under it is complete or abandoned; complete or drop ${openDescendant.id} first.` };
        }
        if (!descendants.some((g) => g.status === "complete")) {
          setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
          return { deny: `Cannot complete ${byNameId}: it is the root, status "${named.status}", and no entry under it is complete. A root with nothing done under it is not finished; drop it with goal_create replace: true or add the work.` };
        }
        if (!turnMayStartEffort("goal_done_root")) {
          setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
          return { deny: `Cannot complete ${byNameId}: it is the root, and the root closes only on the operator's or the coordinator persona's word, in a turn one of them opened. Retry in such a turn; this turn was not one.` };
        }
        // A finished root is exactly the state the planner is due in, so a
        // planner call the last tick started can still be out. The tick's
        // own finished-root path refuses under an in-flight call for the
        // same reason: a call that resolves after the root closed would add
        // plan nodes under a complete root. The planner also re-reads the
        // root after its call, so the two guards cover both orders.
        if (planningInFlight()) {
          setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
          return { deny: `Cannot complete ${byNameId} right now: a planner call is in flight for it. Retry in a few seconds.` };
        }
        named.blockedReason = undefined;
        named.lead = null;
        await completeRootByGoalDone(named, note);
        const rootWriteOk = await persist();
        if (!rootWriteOk) {
          setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
          return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
        }
        return { result: `Complete: "${named.title}" (the root). Every entry under it was complete or abandoned; the goal tree is finished.` };
      }
      if (named.status === "complete" || named.status === "abandoned") {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `Cannot complete ${byNameId}: status is already "${named.status}".` };
      }
      const openChild = sess.state.goals.find(
        (g) => g.parentId === named.id && g.status !== "complete" && g.status !== "abandoned",
      );
      if (openChild) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `Cannot complete ${byNameId}: status is "${named.status}" and its child ${openChild.id} is "${openChild.status}". Complete or drop every child first.` };
      }
      // An entry awaiting the operator's yes, or a node under one, completes
      // by name only in a turn the operator or the coordinator persona
      // started, since completing it would settle the wait without that
      // word.
      const awaitingAbove = awaitingEntryAtOrAbove(sess.state, named);
      if (awaitingAbove && !turnIsOperatorsOrCoordinators()) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: AWAITING_YES_DONE_REFUSED_TEXT };
      }
      // An allowed completion under an entry awaiting the operator's yes is
      // that word on the entry, as an allowed resume is: its flag goes, and
      // its awaiting reason with it, and it stays paused. A named entry
      // that is itself awaiting is settled by completeLeaf.
      const namedRefusal = await closingLeafRefusal(named);
      if (namedRefusal !== null) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: namedRefusal };
      }
      if (awaitingAbove && awaitingAbove !== named) {
        awaitingAbove.awaitingYes = undefined;
        if (awaitingAbove.blockedReason === AWAITING_YES_REASON) awaitingAbove.blockedReason = undefined;
        awaitingAbove.updatedAt = Date.now();
      }
      target = named;
    } else {
      if (!active || active.status !== "active") {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: "No active goal leaf to complete." };
      }
      const activeRefusal = await closingLeafRefusal(active);
      if (activeRefusal !== null) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: activeRefusal };
      }
      target = active;
    }
    // Which entries were active is read before anything changes, so the
    // follow-on below keys on the tree as the call found it. The credit
    // goes to the target only where activeGoalId names it and its status
    // is active. Another entry is active where any node besides the target
    // has status active, whatever activeGoalId names, the same test
    // goal_add's no-active-leaf branch reads.
    const wasActive = active != null && active.status === "active" && active.id === target.id;
    const otherActive = sess.state.goals.find((g) => g.status === "active" && g.id !== target.id) ?? null;
    const completedId = target.id;
    const completedTitle = target.title;
    const statusBefore = new Map(sess.state.goals.map((g) => [g.id, g.status]));
    const leftOpen = new Map<string, { status: string; leaf: GoalNode }>();
    const closedIds = await completeLeafReturningClosed(completedId, note || "goal_done", leftOpen);
    for (const id of closedIds) goalDoneClosedThisTurn().set(id, nudgeCountWorkThisTurn());
    if (byNameId) {
      target.blockedReason = undefined;
      target.lead = null;
    }
    // E2: health run at completeLeaf site (goal_done).
    await runHealth(completedId);
    if (wasActive) {
      // M11: credit the round and score in goal_done, not turn.complete.
      // The score is recorded for every entry; the round is spent on a task
      // entry only, since a plan entry has no round budget.
      active.scores.push({ round: active.scores.length + 1, result: "on-goal" });
      if (!isPlanEntry(sess.state, active)) active.completedRounds += 1;
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "score",
        detail: `${completedId} Round ${active.scores.length}: on-goal (goal_done)`,
      });
    }
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "goal",
      action: "done",
      detail: `${completedId} "${completedTitle.slice(0, 50)}" marked complete${byNameId ? " by name" : ""}${note ? `: ${note.slice(0, 80)}` : ""}`,
    });
    queueMemoryCheck(expectedTurns, completedId, completedTitle, closedIds);
    // A completion by name can finish a blocked child, so the ancestors it
    // freed from "Child task blocked" are logged after its done line and
    // restored before any activation below, so activateNext reads them as
    // pending. The call with no nodeId completes the active leaf, which
    // is not a blocked child, and runs no such walk.
    if (byNameId) {
      clearChildBlockedAncestors(completedId);
    }
    // Every open ask on an entry this call completed closes as stood,
    // blocking or not, whichever branch completed it. Those entries are
    // the target and any plan completeLeaf's walk took to complete. An ask
    // on any other entry stays open and keeps its hold.
    {
      const completedNow = sess.state.goals
        .filter((g) => g.status === "complete" && statusBefore.get(g.id) !== "complete")
        .map((g) => g.id);
      await closeAsksOnCompletedNodes(completedNow, "goal_done", Date.now());
    }

    // The completed entry was active: activate the next one, as the call
    // with no nodeId always does. Another entry is active: it stays so.
    // None is active: activate the next one unless an open blocking ask
    // holds the tree, the one hold goal_add's no-active-leaf branch honors.
    let nextId: string | null = null;
    let heldBy = "";
    if (wasActive) {
      nextId = activateNext(sess.state, completedId);
      activate(nextId, `${completedId} done`);
    } else if (!otherActive) {
      if (openBlockingAsks(sess.state).length > 0) {
        heldBy = "an operator ask is open";
      } else {
        nextId = activateNext(sess.state, completedId);
        activate(nextId, `${completedId} done by name`);
      }
    }
    // activeGoalId never names the entry this call completed. Where it still
    // does, it moves to the entry that is still active, or to null where
    // none is, the same pointer a store load's invariant repair would set.
    if (!wasActive && sess.state.activeGoalId === completedId) {
      sess.state.activeGoalId = otherActive ? otherActive.id : null;
    }

    // S9: goal_done sets pendingPeriodic; the tick runs the review.
    if (wasActive && sess.state.monitor.selfReview) {
      sess.state.monitor.selfReview.pendingPeriodic = true;
    }

    const writeOk = await persist();
    if (writeOk) {
      // F4: goal_done result names the health command, exit code, and first tail line.
      const health = sess.state.monitor.env.health;
      let healthText = "";
      if (health) {
        const firstLine = health.tail.split("\n")[0] || "no output";
        healthText = ` Health: ${health.command.join(" ")} exit ${health.exitCode} (${firstLine}).`;
      }
      // A plan the walk up left open is named with the status its document
      // read and the closing leaf added under it, in every result below,
      // and the no-pending sentence gives way to it, since an open plan is
      // pending work and holds the planner.
      const leftOpenText = [...leftOpen].map(([planId, { status, leaf }]) => {
        const plan = sess.state.goals.find((g) => g.id === planId);
        const opened = plan ? planLeftOpenText(plan, status) : "";
        return `${opened} Its closing entry ${leaf.id} "${leaf.title}" was added and is ${leaf.status}.`;
      }).join("");
      // R8: goal_done result names newly active leaf OR planning message.
      // Where this call completed the plan holder the turn started on and
      // the entry it activated sits under another plan holder, the result
      // also tells the worker to end the turn here, so the compaction
      // boundary the turn owes lands before the next plan's work. The
      // boundary step reads only the turn-start holder, so a plan this call
      // completed by name in a turn that started elsewhere gets no such
      // sentence. A task under the same plan becoming active keeps the
      // plain result.
      if (nextId) {
        const nextNode = sess.state.goals.find((g) => g.id === nextId)!;
        const completedHolder = planHolderOf(sess.state, target);
        const nextHolder = planHolderOf(sess.state, nextNode);
        const turnStartLeaf = turnLeafId() ? sess.state.goals.find((g) => g.id === turnLeafId()) : undefined;
        const turnStartHolder = turnStartLeaf ? planHolderOf(sess.state, turnStartLeaf) : undefined;
        const handsOver = completedHolder !== undefined && closedIds.includes(completedHolder.id)
          && turnStartHolder !== undefined && turnStartHolder.id === completedHolder.id
          && nextHolder !== undefined && nextHolder.id !== completedHolder.id;
        const handOverText = handsOver
          ? ` A plan is finished and another is next: report and end this turn now, with no WAITING: or BLOCKED: line. The next turn starts ${nextId}.`
          : "";
        return {
          result: `Complete: "${completedTitle}".${leftOpenText} Next active: ${nextId} "${nextNode.title}".${handOverText}${healthText}`,
        };
      }
      if (otherActive && !wasActive) {
        return { result: `Complete: "${completedTitle}".${leftOpenText} ${otherActive.id} "${otherActive.title}" is still active.${healthText}` };
      }
      if (heldBy) {
        return { result: `Complete: "${completedTitle}".${leftOpenText} Nothing was activated: ${heldBy}.${healthText}` };
      }
      if (leftOpenText !== "") return { result: `Complete: "${completedTitle}".${leftOpenText}${healthText}` };
      return { result: `Complete: "${completedTitle}". No pending goals; planning runs at the next tick.${healthText}` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve ask_open: the owner files one question to the operator through
  // openWorkerAsk, the path a closing text's ASK: line takes, so the call
  // meets the line's guards and shares its per-turn cap. The ask rises
  // from the entry the turn started on, read as turn.complete reads it
  // for a line. The stored question joins the recommendation as a line
  // does, `<question> Recommend: <recommend>`, with a question mark
  // closing the question where the worker wrote none, since
  // askRecommendOf reads the recommendation from after "?" and
  // "Recommend:". A refusal writes no entry and no commons record, logs
  // the decision the line route logs for its guard, and names the guard.
  // A subagent's call is refused, as turn.complete refuses a subagent's
  // closing text, since only the main loop files an ask. A save that
  // fails takes the entry back off the ledger before the yield's own
  // write and marks its commons record withdrawn, so the deny saying the
  // write was not saved is true.
  if ((e as any).tool === "mcp__personas__ask_open") {
    if (inSubagent) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `ask_open: refused, only the main loop files an ask; a subagent's call files nothing.` };
    }
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const askQuestion = String((e as any).question || "").trim();
    const askRecommend = String((e as any).recommend || "").trim();
    if (askQuestion === "" || askRecommend === "") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `ask_open: question and recommend must both be given and non-empty.` };
    }
    const askBlocking = (e as any).blocking === true;
    const nodeId = turnLeafId() || sess.state.activeGoalId || "unknown";
    const askReaskSuppressMs = typeof cfg.askReaskSuppressMs === "number" ? (cfg.askReaskSuppressMs as number) : 10 * 60_000;
    const storedQuestion = `${askQuestion.endsWith("?") ? askQuestion : `${askQuestion}?`} Recommend: ${askRecommend}`;
    // The rollback below restores the owed list whole, so an owed brief the
    // push evicted from a full queue comes back with the open undone.
    const owedBeforeOpen = sess.state.askBriefOwed.slice();
    const opened = await openWorkerAsk("tool", sess, nodeId, storedQuestion, askQuestion, askRecommend, askBlocking, askReaskSuppressMs);
    if (typeof opened === "string") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      if (opened === "turn-cap" || opened === "cap") {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "ask_cap_refused",
          detail: `${nodeId}: ask_open refused: past the ${opened === "turn-cap" ? `per-turn cap of ${ASK_TURN_MAX}` : `open cap of ${ASKS_OPEN_MAX}`}`,
        });
      }
      const refusedBy: Record<WorkerAskRefusal, string> = {
        "placeholder": "the question still carries an angle-bracket template placeholder; write the question itself",
        "reask": `the same question closed on ${nodeId} recently; proceed on its answer`,
        "already-open": `the same question is already open on ${nodeId}`,
        "turn-cap": `this turn has already opened ${ASK_TURN_MAX} asks, the per-turn cap`,
        "cap": `${ASKS_OPEN_MAX} asks already stand open, the open cap; close one with ask_close first`,
        "duplicate": "an entry with this id already stands on the ledger",
        "seed": "the question is the ledger's seed text",
      };
      return { deny: `ask_open: refused, ${refusedBy[opened]}.` };
    }
    const openWriteOk = await persist(() => {
      sess.state.asks = sess.state.asks.filter((a) => a !== opened);
      sess.state.askBriefOwed = owedBeforeOpen;
      sess.asksOpenedThisTurn -= 1;
    });
    if (!openWriteOk) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      try {
        const store = commonsStore();
        const askRecord = await readAskRecord(store, sess.persona, opened.id);
        if (askRecord && askRecord.status === "open") {
          askRecord.status = "withdrawn";
          await store.set(askKey(sess.persona, opened.id), askRecord);
        }
      } catch { /* non-fatal: the owner start expires an open record no ledger entry names */ }
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    return { result: JSON.stringify({ id: opened.id, blocking: opened.blocking, open: openAskEntries(sess.state).map((a) => a.id) }, null, 2) };
  }

  // Serve ask_close: the owner closes one open ledger entry by id, with the
  // outcome it names and the note as given, cut by closeAsk, and the
  // entry's commons record takes the same status where it is still open,
  // once the ledger is saved. Any open entry closes, whichever opener
  // opened it. A refusal writes nothing to the ledger and no commons
  // record. The record step is non-fatal: the ledger is the owner's
  // truth, and the owner start's reconcile gives an open record a closed
  // entry's status.
  if ((e as any).tool === "mcp__personas__ask_close") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const askId = String((e as any).id || "").trim();
    const outcome = String((e as any).outcome || "").trim();
    if (outcome !== "answered" && outcome !== "stood" && outcome !== "withdrawn") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `ask_close: outcome must be "answered", "stood" or "withdrawn".` };
    }
    const entry = sess.state.asks.find((a) => a.id === askId);
    if (!entry) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `ask_close: no ask on this persona's ledger has id "${askId.slice(0, 50)}".` };
    }
    if (entry.status !== "open") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `ask_close: ask ${entry.id} is not open; it closed as ${entry.status}.` };
    }
    const rawNote = (e as any).note;
    const noteText = typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote.trim() : null;
    const closedAt = Date.now();
    // The values the close overwrites are read first, so a refused save
    // puts each one back.
    const priorEntry = { status: entry.status, closedAt: entry.closedAt, closedBy: entry.closedBy, answer: entry.answer };
    const askedNode = sess.state.goals.find((n) => n.id === entry.nodeId);
    const priorNode = askedNode
      ? { lastAskQuestion: askedNode.lastAskQuestion, lastAskClosedAt: askedNode.lastAskClosedAt, blockedReason: askedNode.blockedReason, updatedAt: askedNode.updatedAt }
      : null;
    closeAsk(sess.state, entry.id, outcome, "ask_close", noteText, closedAt);
    // The closed question is remembered on its node, as the drain's close
    // remembers it, so the re-ask guard does not reopen it right away, and
    // the node is reactivated as the drain's and the reply's are.
    if (askedNode) {
      askedNode.lastAskQuestion = entry.question;
      askedNode.lastAskClosedAt = closedAt;
      reactivateAskedEntry(askedNode);
    }
    const closeDecision: AgentState["decisions"][number] = {
      timestamp: closedAt,
      loop: "monitor",
      action: "ask_closed",
      detail: `ask ${entry.id} closed by ask_close (outcome: ${outcome})`,
    };
    sess.state.decisions.push(closeDecision);
    const closeWriteOk = await persistOrRollBack(() => {
      entry.status = priorEntry.status;
      entry.closedAt = priorEntry.closedAt;
      entry.closedBy = priorEntry.closedBy;
      entry.answer = priorEntry.answer;
      if (askedNode && priorNode) {
        askedNode.lastAskQuestion = priorNode.lastAskQuestion;
        askedNode.lastAskClosedAt = priorNode.lastAskClosedAt;
        askedNode.blockedReason = priorNode.blockedReason;
        askedNode.updatedAt = priorNode.updatedAt;
      }
      dropDecision(closeDecision);
    });
    if (!closeWriteOk) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    // The record follows the saved ledger, so a save that fails leaves
    // both open and a reader can still answer the ask.
    try {
      const store = commonsStore();
      const askRecord = await readAskRecord(store, sess.persona, entry.id);
      if (askRecord && askRecord.status === "open") {
        askRecord.status = outcome;
        await store.set(askKey(sess.persona, entry.id), askRecord);
      }
    } catch { /* non-fatal: the owner start mirrors the closed entry onto the record */ }
    return { result: JSON.stringify({ closed: entry.id, outcome, open: openAskEntries(sess.state).map((a) => a.id) }, null, 2) };
  }

  // Serve task_add, task_done and task_clear: the per-goal working list.
  // The active goal is activeGoalId's node, read the same way goal_done
  // reads it, and only where its own status is "active" - the same test
  // the [GOAL TREE] injection uses to decide it has an active leaf at all.
  // None of the three checks turnMayStartEffort: the list is the persona's
  // own scratch pad on the goal it already holds, not a new effort.
  if (e.tool === "mcp__personas__task_add") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const active = sess.state.activeGoalId
      ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
      : null;
    if (!active || active.status !== "active") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "task_add refused: no active goal to add a task under." };
    }
    // planHolderOf returns the active leaf itself, or its nearest ancestor,
    // only when that node carries a planPath - so a defined result always
    // means a plan tracks this goal already, whichever node holds it.
    const holder = planHolderOf(sess.state, active);
    if (holder) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return {
        deny:
          `task_add refused: ${active.id} is tracked by the plan document ${holder.planPath}, whose own chapters ` +
          `are already its task list. Track this work there instead of in a second list.`,
      };
    }
    const existing = sess.state.tasks.filter((t) => t.goalId === active.id);
    if (existing.length >= MAX_TASKS_PER_GOAL) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return {
        deny: `task_add refused: ${active.id} already holds ${existing.length} tasks, the cap (${MAX_TASKS_PER_GOAL}). Clear the list with task_clear first.`,
      };
    }
    // Folded the same way kaizenLine folds stored text: a newline in the
    // caller's text would otherwise ride into the store and, later, into
    // the injected [TASK LIST] block as a line break that is not this
    // task's own.
    const rawText = String((e as any).text || "").split(LINE_TERMINATOR).join(" ").trim();
    if (!rawText) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "task_add requires non-empty 'text'." };
    }
    const now = Date.now();
    const task: TaskItem = {
      id: newTaskId(now),
      goalId: active.id,
      text: rawText.slice(0, TASK_TEXT_MAX_CHARS),
      done: false,
      addedAt: now,
    };
    sess.state.tasks.push(task);
    // Route two of the promotion routes: a turn holding an open record that
    // is a step of this very entry marks that record promoted with the task's
    // id, since the step the message asked for is now this working item. A
    // bare record is left alone, and so is one attached to another entry:
    // neither named the goal this task sits under, so neither is what the
    // task was made from. The mark rides the add's own write and the rollback
    // takes it back with the task.
    const stepRecord = openTurnRecord(sess.state);
    const undoPromotion = stepRecord !== null && stepRecord.goalId === active.id
      ? promoteOpenRecord(task.id, "taskId", now)
      : null;
    const writeOk = await persistOrRollBack(() => {
      sess.state.tasks.pop();
      if (undoPromotion !== null) undoPromotion();
    });
    if (writeOk) {
      return { result: `Task added: ${task.id} "${task.text}" under ${active.id}.` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  if (e.tool === "mcp__personas__task_done") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const active = sess.state.activeGoalId
      ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
      : null;
    if (!active || active.status !== "active") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "task_done refused: no active goal to complete a task under." };
    }
    const id = String((e as any).id || "").trim();
    const task = sess.state.tasks.find((t) => t.id === id && t.goalId === active.id);
    if (!task) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return {
        deny: `task_done refused: "${id.slice(0, 50)}" is unknown under the active goal ${active.id}.`,
      };
    }
    if (task.done) {
      return { result: `Task already done: ${task.id} "${task.text}".` };
    }
    const priorDoneAt = task.doneAt;
    const now = Date.now();
    task.done = true;
    task.doneAt = now;
    const allDone = sess.state.tasks.filter((t) => t.goalId === active.id).every((t) => t.done);
    const writeOk = await persistOrRollBack(() => {
      task.done = false;
      if (priorDoneAt === undefined) delete task.doneAt;
      else task.doneAt = priorDoneAt;
    });
    if (writeOk) {
      return {
        result: allDone
          ? `Task done: ${task.id} "${task.text}". Every task under ${active.id} is done; consider goal_done.`
          : `Task done: ${task.id} "${task.text}".`,
      };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  if (e.tool === "mcp__personas__task_clear") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const active = sess.state.activeGoalId
      ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
      : null;
    if (!active || active.status !== "active") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "task_clear refused: no active goal to clear tasks under." };
    }
    const priorTasks = sess.state.tasks;
    sess.state.tasks = sess.state.tasks.filter((t) => t.goalId !== active.id);
    const removed = priorTasks.length - sess.state.tasks.length;
    const writeOk = await persistOrRollBack(() => { sess.state.tasks = priorTasks; });
    if (writeOk) {
      return { result: `Cleared ${removed} task(s) from ${active.id}.` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve supervisor_shutdown (plan item 4: distinct from a finished goal,
  // which the supervisor's poll does not act on; supervise.sh's decide unit exits
  // the whole loop on this signal).
  // park: true writes park_requested in place of shutdown_requested, so the
  // supervisor exits on the park code and the keeper brings the persona back
  // at the next boot or a start after the operator's -Release.
  if (e.tool === "mcp__personas__supervisor_shutdown") {
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    // Arguments can arrive stringified, so the string "true" counts. Any
    // other value is a stop.
    const rawPark = (e as any).park;
    const park = rawPark === true || rawPark === "true";
    const reason = String((e as any).reason || "").trim() || (park ? "operator requested park" : "operator requested shutdown");
    const now = Date.now();
    sess.state.decisions.push({
      timestamp: now,
      loop: "monitor",
      action: park ? "park_requested" : "shutdown_requested",
      detail: reason,
    });
    const writeOk = await persist();
    if (writeOk) {
      if (park) {
        return { result: `Park requested: ${reason}. The supervisor will stop after this turn ends, and the keeper brings this persona back at the next boot or a start after the operator's -Release.` };
      }
      return { result: `Shutdown requested: ${reason}. The supervisor will stop after this turn ends.` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve supervisor_restart (plan item 8.3: mirrors supervisor_shutdown;
  // supervise.sh's decide unit maps this fact to restart_passive, so the
  // child is relaunched with the goal tree kept rather than the run ending).
  if (e.tool === "mcp__personas__supervisor_restart") {
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const reason = String((e as any).reason || "").trim() || "operator requested restart";
    const now = Date.now();
    sess.state.decisions.push({
      timestamp: now,
      loop: "monitor",
      action: "restart_requested",
      detail: reason,
    });
    const writeOk = await persist();
    if (writeOk) {
      return { result: `Restart requested: ${reason}. The supervisor will relaunch the child after this turn ends; the goal tree is kept and the new child resumes the active plan.` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
  }

  // Serve goal_status (read-only, passive-reader OK).
  if (e.tool === "mcp__personas__goal_status") {
    // A session that never loaded its state holds no tree to show, and
    // "No goal tree exists." would read as a fact about the store.
    if (sess.stateNotLoaded !== null) {
      return { result: stateNotLoadedText(sess.stateNotLoaded) };
    }
    const root = sess.state.goals.find((g) => g.parentId === null);
    // The long-term goals print one line each, so any line break a title or
    // objective carries is joined into a space, through the shared fold every
    // context block reads from the store module. Each field is read through
    // String, so a malformed stored entry prints as blanks rather than
    // throwing goal_status for the whole persona.
    const longTerm = sess.state.longTermGoals;
    const longTermLines = longTerm.length === 0
      ? ["Long-term goals: (none)"]
      : ["Long-term goals:", ...longTerm.map((g) =>
        `  ${String(g?.id ?? "")} "${oneLine(String(g?.title ?? ""))}": ${oneLine(String(g?.objective ?? ""))}`)];
    // The autonomy level, on its own line above the long-term goals, and
    // ahead of the no-tree sentence where there is no tree.
    const autonomyLine = `Autonomy: ${sess.state.autonomy}`;
    // The open turn record, on one line above everything else, so the
    // operator sees the intention the plugin is holding without reading the
    // store. A record is not a goal entry, so it sits outside the tree. There
    // is no line at all where no record is open, which is the usual case
    // between turns. Both fields are strings by the time they reach here,
    // fillTurnRecords having dropped any stored entry whose status or text is
    // anything else, so the only shaping this line does is the one the
    // long-term lines do: fold the text onto one line. The bracket guard the
    // sibling lines apply here is applied to the field instead, by
    // clampTurnRecordText, which every producer of the text and the load both
    // call, so the text arrives bracket-safe.
    const openRecord = openTurnRecord(sess.state);
    const recordLines = openRecord === null
      ? []
      : [`Turn record: ${openRecord.status} ${oneLine(openRecord.text)}`];
    if (!root) {
      // With no tree, the list is shown only where it holds an entry.
      return { result: [...recordLines, autonomyLine, "No goal tree exists.", ...(longTerm.length === 0 ? [] : longTermLines)].join("\n") };
    }
    const lines: string[] = [...recordLines];
    // A folded plan's children left the tree for the history file, so its
    // one line names how many.
    const statusOf = (id: string) => {
      const n = sess.state.goals.find((g) => g.id === id)!;
      const folded = n.foldedChildren ?? 0;
      const foldedText = folded > 0 ? ` (${folded} child${folded === 1 ? "" : "ren"} folded)` : "";
      return `[${n.status}] ${n.id} (${n.kind}) "${n.title}"${foldedText}`;
    };
    lines.push(statusOf(root.id));
    const children = (pid: string) =>
      sess.state.goals.filter((g) => g.parentId === pid)
        .sort((a, b) => (a.sortKey ?? a.createdAt) - (b.sortKey ?? b.createdAt));
    const render = (pid: string, indent: string) => {
      for (const c of children(pid)) {
        lines.push(indent + statusOf(c.id));
        render(c.id, indent + "  ");
      }
    };
    render(root.id, "  ");
    lines.push(autonomyLine, ...longTermLines);
    return { result: lines.join("\n") };
  }

  // M5: Serve goal_resume (owner only: resumes paused leaf, resets nudge budget).
  if (e.tool === "mcp__personas__goal_resume") {
    if (sess.stateNotLoaded !== null) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: stateNotLoadedText(sess.stateNotLoaded) };
    }
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "goal_resume requires ownership of this persona." };
    }
    const nodeId = String((e as any).nodeId || "").trim();
    // An entry awaiting the operator's yes, or a node under one, is resumed
    // only in a turn the operator or the coordinator persona started.
    // Outside those turns a call naming one is refused, and a call naming
    // none passes over them to the other paused entries.
    const mayResumeAwaiting = turnMayStartEffort("goal_resume_awaiting");
    // A call naming an entry the round budget blocked releases it: the
    // literal "Max rounds reached" is the one blocked reason it lifts, and
    // the entry's round count restarts below. Any other blocked entry, and
    // every entry for the call naming none, stays out of reach.
    let target: GoalNode | undefined;
    if (nodeId) {
      target = sess.state.goals.find((g) => g.id === nodeId
        && (g.status === "paused" || (g.status === "blocked" && g.blockedReason === "Max rounds reached")));
      if (target && awaitingEntryAtOrAbove(sess.state, target) && !mayResumeAwaiting) {
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: AWAITING_YES_RESUME_REFUSED_TEXT };
      }
    } else {
      target = sess.state.goals
        .filter((g) => g.status === "paused" && (mayResumeAwaiting || awaitingEntryAtOrAbove(sess.state, g) === undefined))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    }
    if (!target) {
      const passedOver = nodeId ? undefined : sess.state.goals
        .filter((g) => g.status === "paused")
        .map((g) => awaitingEntryAtOrAbove(sess.state, g))
        .find((g) => g !== undefined);
      if (passedOver) {
        return { result: `No paused node to resume here: ${passedOver.id} "${passedOver.title}" waits for the operator's word, and so does anything under it.` };
      }
      return { result: "No paused nodes to resume." };
    }
    // M9: if a different node is active, pause it first (M10: write blockedReason).
    if (sess.state.activeGoalId && sess.state.activeGoalId !== target.id) {
      const activeNode = sess.state.goals.find((g) => g.id === sess.state.activeGoalId);
      if (activeNode && activeNode.status === "active") {
        activeNode.status = "paused";
        activeNode.blockedReason = `Paused by goal_resume of ${target.id}`;
        activeNode.updatedAt = Date.now();
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "paused_by_resume",
          detail: `${activeNode.id} paused (goal_resume of ${target.id})`,
        });
      }
    }
    // M10: clear blockedReason on resume.
    const pausedReason = target.blockedReason || "unknown";
    const budgetRelease = target.status === "blocked";
    // An allowed resume at or under an entry awaiting the operator's yes is
    // that word on the entry, so the entry's flag goes, and its awaiting
    // reason with it. An entry above the resumed node stays paused.
    const awaitingAbove = awaitingEntryAtOrAbove(sess.state, target);
    const admittedBy = !awaitingAbove ? ""
      : currentTurnEntry() !== null && currentTurnEntry()!.kind === "delivery" ? `; admitted by coordinator record ${(currentTurnEntry() as Extract<ExpectedTurn, { kind: "delivery" }>).recordId}`
      : `; admitted by origin ${currentTurnOriginKind()}`;
    if (awaitingAbove && awaitingAbove !== target) {
      awaitingAbove.awaitingYes = undefined;
      if (awaitingAbove.blockedReason === AWAITING_YES_REASON) awaitingAbove.blockedReason = undefined;
      awaitingAbove.updatedAt = Date.now();
    }
    target.blockedReason = undefined;
    target.awaitingYes = undefined;
    target.status = "active";
    // A released entry left at its maxRounds would re-block on its next
    // scored round, so its count restarts. Its scores stay.
    if (budgetRelease) target.completedRounds = 0;
    // completeLeaf's walk blocked each plan above the released entry with
    // "Child task blocked", and activateNext never descends into a blocked
    // plan, so a release that left them would strand their pending work.
    // blockedAncestorsToFree decides the chain as the load-time recovery
    // does, and undefined is an ancestor in a state it cannot explain,
    // which leaves every ancestor as it is and is named in the decision.
    const releaseChain = budgetRelease ? blockedAncestorsToFree(sess.state, target) : [];
    const chainNote = releaseChain === undefined ? "; ancestors left as they are, one above in a state the release does not free" : "";
    // A resume lifts a blocked lead whatever paused the entry, since the
    // lead would otherwise hold the idle branch until a working turn that
    // may never come. A worker still blocked restates BLOCKED: at its next
    // turn end and is held again. A waiting lead keeps its own hold window
    // and stays.
    const liftedLead = target.lead && target.lead.state === "blocked" ? target.lead : null;
    if (liftedLead) target.lead = null;
    target.updatedAt = Date.now();
    sess.state.activeGoalId = target.id;
    sess.nudgedAnswersWithoutStatus = 0;
    sess.nudgeCapRefusedFor = null;
    setCountResetSinceNudgeOpened(true);
    sess.lastNudgeAt = 0;
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "goal",
      action: "resume",
      detail: budgetRelease
        ? `Node ${target.id} resumed (blocked: ${pausedReason}; round budget restarted${chainNote}${admittedBy})`
        : `Node ${target.id} resumed (paused: ${pausedReason}${admittedBy})`,
    });
    // From the nearest ancestor up, one is freed only while its reason is
    // exactly "Child task blocked" and no child of it is still blocked:
    // the released entry is active and a lower ancestor freed here is
    // pending. A pending or active ancestor is passed over, as the helper
    // passes it. The first blocked ancestor that fails ends the walk,
    // leaving it and everything above it as they are.
    for (const ancestor of releaseChain ?? []) {
      if (ancestor.blockedReason !== "Child task blocked"
        || sess.state.goals.some((g) => g.parentId === ancestor.id && g.status === "blocked")) break;
      ancestor.status = "pending";
      ancestor.blockedReason = undefined;
      ancestor.updatedAt = Date.now();
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "unblocked",
        detail: `${ancestor.id}: returned to pending, goal_resume's release of ${target.id} cleared "Child task blocked"`,
      });
    }
    if (liftedLead) {
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "lead_cleared",
        detail: `${target.id}: blocked lead cleared by goal_resume`,
      });
    }
    // goal_resume lifts the hold on the resumed node's asks and closes
    // none: every open blocking entry on the node is lifted on the
    // ledger alone, its record left open for a reader to answer. A
    // blocking entry on another node keeps holding.
    for (const entry of openBlockingAsks(sess.state)) {
      if (entry.nodeId === target.id) liftAsk(sess.state, entry.id);
    }
    sess.state.updatedAt = Date.now();
    await persist();
    return { result: `Resumed ${target.id} (${target.kind}) "${target.title}". Nudge budget reset.${budgetRelease ? " Round budget restarted." : ""}` };
  }

  // Serve memory_add.
  if (e.tool === "mcp__personas__memory_add") {
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    const text = String((e as any).text || "").trim();
    if (!text) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "memory_add requires a non-empty 'text'." };
    }
    // The seat is confirmed through a guarded write before the put, so an
    // owner another session has displaced since its last write is refused
    // as a non-owner is, and writes no record.
    if (!(await persist())) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `persona '${sess.persona}' is held by a live session; this write was not saved.` };
    }
    // One record in the kit's memory store. A confidence argument is
    // ignored, since the record carries none. The reply names the record,
    // so the worker can touch or forget it with memq later. The decision is
    // saved with the state, and the record stands in the store whatever
    // that save returns.
    const kind = String((e as any).kind ?? "").trim();
    const written = await writeMemoryRecord(text, { kind, source: "worker", createdAt: Date.now() });
    noteMemoryWrite(written, text);
    await persist();
    if (written.outcome === "written") {
      return { result: `Wrote memory record ${written.name} to the shared memory store.` };
    }
    if (written.outcome === "duplicate" && written.retired) {
      return { result: `The shared memory store holds this text as record ${written.name}, retired under archive/; nothing new was written.` };
    }
    if (written.outcome === "duplicate") {
      return { result: `The shared memory store already holds this text as record ${written.name}; nothing new was written.` };
    }
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    return { deny: `memory_add could not write record ${written.name}: ${bracketSafeText(written.reason)}` };
  }

  // The closing clause of agentic_say's and agentic_inbox's reach refusal,
  // naming the legs that could have admitted the target. The architect
  // persona is named only where the plugin holds one, and the answer leg
  // only to the session that owns it.
  const reachDenyTail = (persona: string, verb: "push" | "read"): string => {
    if (persona === coordinatorPersona || (architectPersona !== "" && persona === architectPersona)) {
      return `owns no named persona of its own to ${verb} from`;
    }
    if (architectPersona === "") return `'${persona}' is not the coordinator persona`;
    const seats = `'${persona}' is neither the coordinator persona nor the '${architectPersona}' architect persona`;
    return sess.isOwner && sess.persona === architectPersona
      ? `${seats}, and no live owner of '${persona}' has a record to '${architectPersona}' that is delivered or answered`
      : seats;
  };

  // D2: Serve agentic_say (a message to the owner of a persona)
  // Plan D2: agentic_say(text, answers?, urgent?, persona?). The target is
  // the persona argument when given, else sess.persona; sess.persona itself
  // never changes here, and no claim is written.
  if ((e as any).tool === "mcp__personas__agentic_say") {
    const targetOrDeny = targetPersonaOf((e as any).persona, sess.persona);
    if ("deny" in targetOrDeny) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_say: ${targetOrDeny.deny}` };
    }
    const persona = targetOrDeny.persona;
    const text = String((e as any).text || "").trim();
    const answers = (e as any).answers as string | undefined;
    const urgent = (e as any).urgent === true;
    if (!text) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "agentic_say requires a non-empty 'text'." };
    }
    // Self-message guard: an owner addressing the persona it owns is
    // talking to itself. The guard keys on ownership rather than on the
    // name alone, because a reader's sess.persona is the persona it reads.
    if (sess.isOwner && persona === sess.persona) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_say cannot address '${persona}': this session owns that persona, and the owner does not need to send itself a message.` };
    }
    // The reach rule: a live reader claim on the target, the coordinator
    // persona held by this session, the target being the coordinator or
    // architect persona while this session owns a named persona of its
    // own, or this session owning the architect persona while the target's
    // owner has an open record to it.
    // An answer admitted on the answer leg is stamped with the id of the
    // record that opened it, and the delivery sites admit it on that stamp
    // without reading the architect's inbox again.
    const sendGround = await deliveryGroundAtSend(commonsStore(), persona, sess.mySessionId, coordinatorPersona, architectPersona, sess.staleAfterMs);
    if (!("ground" in sendGround)) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_say cannot reach '${persona}': this session holds no live reader claim on it and does not hold the '${coordinatorPersona}' persona, and ${reachDenyTail(persona, "push")}.` };
    }
    // BD3 part 2: when answers is set, verify it names a live open ask.
    if (answers) {
      const askRec = await readAskRecord(commonsStore(), persona, answers);
      if (!askRec || askRec.status !== "open") {
        const allAsks = await listAskRecords(commonsStore(), persona);
        const openIds = allAsks.filter((a) => a.status === "open").map((a) => a.id);
        setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
        return { deny: `no open ask '${answers}'; open asks: ${openIds.length ? openIds.join(", ") : "(none)"}` };
      }
    }
    // Write the inbox record
    const seq = await getHighestInboxSeq(commonsStore(), persona, sess.mySessionId) + 1;
    const id = await writeInboxRecord(commonsStore(), persona, sess.mySessionId, seq, text, "say", answers, urgent, sendGround.answersRecord);
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "worker",
      action: "say_sent",
      detail: `${persona}: "${text.slice(0, 80)}" (id: ${id}${urgent ? ", urgent" : ""})`,
    });
    // Inside the idle proposal's own turn, the first message to the
    // coordinator persona is the proposal. It is entered in
    // monitor.proposal.sent, which the tick's idle-proposal step settles
    // and sends again where the record reads skipped. A message in any
    // other turn, [PROPOSAL] or not, is not entered.
    if (currentTurnEntry()?.kind === "proposal" && persona === coordinatorPersona && proposalLedgeredTurnId() !== currentGateTurnId()) {
      setProposalLedgeredTurnId(currentGateTurnId());
      sess.state.monitor.proposal.sent = { text, writer: sess.mySessionId, seq, delivered: false };
      // Attempted rather than depended on: the record is written above and
      // the entry stands in memory, so the first write that is not refused
      // carries it.
      try { await persist(); } catch { /* persist could not read or write the store; the entry waits in memory */ }
    }
    return { result: `Message sent to owner of ${persona} (id: ${id}${urgent ? ", urgent: delivered inside the owner's running turn if one is in flight" : ", delivered on the owner's next quiet tick or as its running turn ends, each further waiting message following as the previous delivery turn ends, or, unless it is labelled COORDINATOR at delivery, into a turn already running once it has waited past the break-in bound; a delivery on the wait alone is not replied to, and the owner closes the record with agentic_resolve"})` };
  }

  // D2: Serve agentic_inbox (replies from the owner of a persona)
  // Plan D2: agentic_inbox(persona?). The target is the persona argument
  // when given, else sess.persona, under the same guard and reach rule as
  // agentic_say; no identity switch, no claim written.
  if ((e as any).tool === "mcp__personas__agentic_inbox") {
    const targetOrDeny = targetPersonaOf((e as any).persona, sess.persona);
    if ("deny" in targetOrDeny) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_inbox: ${targetOrDeny.deny}` };
    }
    const persona = targetOrDeny.persona;
    if (sess.isOwner && persona === sess.persona) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_inbox cannot address '${persona}': this session owns that persona, and the owner reads its own replies directly.` };
    }
    const mayReach = await mayReachPersona(commonsStore(), persona, sess.mySessionId, coordinatorPersona, architectPersona, sess.staleAfterMs);
    if (!mayReach) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_inbox cannot reach '${persona}': this session holds no live reader claim on it and does not hold the '${coordinatorPersona}' persona, and ${reachDenyTail(persona, "read")}.` };
    }
    // D2: List inbox records for the target persona, filtered to the caller's messages
    const allRecords = await listInboxRecords(commonsStore(), persona);
    const myRecords = allRecords.filter((rec) => rec.from === sess.mySessionId);
    // D2: Append open asks for this persona
    const allAsks = await listAskRecords(commonsStore(), persona);
    const openAsks = allAsks.filter((ask) => ask.status === "open");
    // Plan item 8.3: the owner's commons entry carries turnStartedAt while
    // a turn runs. A record still pending behind that turn is reported as
    // deferred, with how long the turn has run, so the sender knows the
    // message is held rather than lost. The stamp alone is not enough: an
    // owner killed mid-turn never clears it, so the report also requires
    // the entry's lastSeen within staleAfterMs of now, since a stale owner
    // is dead rather than busy. The commons store is machine-global, so a
    // reader in another working directory sees the same entry. The heartbeat
    // file cannot give it that: it sits in one session's own launch directory.
    let ownerTurnStartedAt: number | null = null;
    // The owner's working directory rides on the result too, so a
    // coordinator in another repository knows where the worker's own
    // store file sits without asking for it in a record.
    let ownerWorkdir: string | null = null;
    try {
      const holder = await readHolderMeta(commonsStore(), `persona:${persona}`, sess.staleAfterMs);
      if (holder) { ownerTurnStartedAt = holder.turnStartedAt; ownerWorkdir = holder.workdir; }
    } catch { /* commons read failed; report records without the deferred view */ }
    // Attach replies to records, and the deferred view to pending ones.
    const withReplies = await Promise.all(myRecords.map(async (rec) => {
      const reply = await readReplyRecord(commonsStore(), persona, rec.id);
      const base = reply ? { ...rec, reply: reply.text } : rec;
      if (rec.status === "pending" && ownerTurnStartedAt !== null) {
        return { ...base, deferred: true, turnRunningMs: Math.max(0, Date.now() - ownerTurnStartedAt) };
      }
      return base;
    }));
    return { result: JSON.stringify({ inbox: withReplies, asks: openAsks, ...(ownerWorkdir !== null ? { workdir: ownerWorkdir } : {}) }, null, 2) };
  }

  // Section 3: serve fleet_status (one row per roster persona: what the
  // process keeper last decided for it and what its commons entry says).
  // Read-only: the roster, each persona's keeper state and the commons
  // entries are read, and nothing is written, created or deleted. The
  // commons entries are read once, before the reach check, and serve both:
  // the claims readAllClaims would return are derived from them, which
  // keeps the read-only promise, since readAllClaims collects stale entries
  // on its own read and those entries are what a stopped persona's
  // heartbeat age is read from.
  if ((e as any).tool === "mcp__personas__fleet_status") {
    const now = Date.now();
    // Every commons entry on the machine, read without readAllClaims'
    // staleness filter and without the garbage collection it performs on its
    // own read: the fleet report writes and deletes nothing, and a persona
    // whose heartbeat has stopped is exactly what it exists to show.
    const entries = await readAllEntries(commonsStore());
    // The reach rule with the coordinator persona as the target, narrowed
    // to the two standings that read fleet state: holding that persona, or
    // holding a live reader claim on it. deliveryGroundIn decides its legs
    // here; the worker leg, a session owning a named persona of its own,
    // reaches the coordinator persona to send it a record and is not a
    // standing to read the fleet from, so its WORKER ground is refused. The
    // answer leg reads no records here, since no ground it alone admits is
    // one this check accepts.
    const ground = deliveryGroundIn(liveClaimsOf(entries, sess.staleAfterMs, now), coordinatorPersona, sess.mySessionId, coordinatorPersona, { persona: architectPersona, records: [] });
    const mayRead = "ground" in ground && (ground.ground === "COORDINATOR" || ground.ground === `READER:${coordinatorPersona}`);
    if (!mayRead) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      const standing = "ground" in ground ? `the ground '${ground.ground}'` : "no ground on that persona at all";
      return { deny: `fleet_status cannot read the fleet: the plugin's reach rule admits two standings to fleet state, holding the '${coordinatorPersona}' persona and holding a live reader claim on it, and this session holds ${standing}. A WORKER ground, which a session owning a named persona of its own holds, is refused here: it reaches '${coordinatorPersona}' to send it a record, and a record is a write to one inbox where fleet state is every persona's health.` };
    }
    // The reading itself is readFleetRows, shared with the controller
    // tick's fleet watcher, so the tool and the watcher cannot drift on
    // what a row says. This handler adds the staleness bound the ages in
    // it were read against.
    const report = await readFleetRows(host(), fleetRoster, entries, sess.staleAfterMs, now);
    return { result: JSON.stringify({
      roster: report.roster,
      staleAfterMs: sess.staleAfterMs,
      rows: report.rows,
      ...(report.problem !== undefined ? { problem: fleetLineText(report.problem) } : {}),
      ...(report.problems !== undefined ? { problems: report.problems.map(fleetLineText) } : {}),
    }, null, 2) };
  }

  // Serve fleet_restart (the coordinator restarts another persona's child).
  // The request is a file in the target's run directory, which that
  // persona's supervisor reads as the same fact as its store's
  // restart_requested (bin/supervise-restart-request.mjs), so no session
  // writes into a store another session owns. The refusals are a closed set,
  // checked in this order, and each one writes nothing. The ground is the
  // one the reach rule computes for fleet_status, narrowed to COORDINATOR
  // alone, since a reader claim reads the fleet without steering it. That
  // ground fences this tool and not the file: every persona runs as the
  // operator's own account, so any local process can write restart.request
  // directly, the same boundary the persona store already sits inside.
  if ((e as any).tool === "mcp__personas__fleet_restart") {
    const now = Date.now();
    const target = String((e as any).persona || "").trim();
    const reason = String((e as any).reason || "").trim().slice(0, FLEET_RESTART_REASON_MAX);
    // The caller's own argument, as every refusal and the result echo it.
    const shown = boundedText(bracketSafeText(target));
    const refuse = (why: string) => {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `fleet_restart refused: ${why}` };
    };
    const entries = await readAllEntries(commonsStore());
    const ground = deliveryGroundIn(liveClaimsOf(entries, sess.staleAfterMs, now), coordinatorPersona, sess.mySessionId, coordinatorPersona, { persona: architectPersona, records: [] });
    if (!("ground" in ground) || ground.ground !== COORDINATOR_GROUND) {
      const standing = "ground" in ground ? `the ground '${ground.ground}'` : "no ground on that persona at all";
      return refuse(`only the session holding the '${coordinatorPersona}' persona may restart another persona's child, and this session holds ${standing}.`);
    }
    if (fleetRoster === "") {
      return refuse("the plugin's fleetRoster setting names no roster file, so there is no persona to restart.");
    }
    let roster: unknown;
    try {
      roster = await readRosterFile(host(), fleetRoster);
    } catch (err) {
      return refuse(`the roster '${fleetRoster}' could not be read or parsed: ${boundedText(safeErrorText(err))}`);
    }
    if (!Array.isArray(roster)) {
      return refuse(`the roster '${fleetRoster}' does not hold a JSON array of persona entries.`);
    }
    // The first entry under the name, as the fleet reading gives the first
    // one a row and reports a repeat as a problem.
    const entry = (roster as unknown[]).find((candidate) => {
      const name = ((candidate ?? {}) as RosterEntry).name;
      return typeof name === "string" && name.trim() === target;
    }) as RosterEntry | undefined;
    if (entry === undefined) {
      return refuse(`the roster '${fleetRoster}' carries no entry named '${shown}'.`);
    }
    if (entry.enabled !== true) {
      return refuse(`the roster entry for '${shown}' is not enabled, and only a persona the roster enables is restarted.`);
    }
    if (target === sess.persona) {
      return refuse(`'${shown}' is this session's own persona, whose restart lever is supervisor_restart.`);
    }
    const runDir = rosterRunDir(entry);
    const runDirExists = runDir !== null && await fsExists(runDir).catch(() => false);
    if (runDir === null || !runDirExists) {
      return refuse(runDir === null
        ? `the roster entry for '${shown}' names neither a run directory nor a working directory, so there is nowhere to write the request.`
        : `the run directory '${runDir}' for '${shown}' does not exist.`);
    }
    // A request the supervisor would read as no request is no request here
    // either: one that does not parse, carries no numeric at, or is dated
    // ahead of this clock is overwritten rather than holding the lever off.
    const requestPath = `${runDir}/restart.request`;
    let standingAt: number | null = null;
    try {
      if (await fsExists(requestPath)) {
        const parsed = JSON.parse(stripBom(String(await fsRead(requestPath))));
        const at = parsed !== null && typeof parsed === "object" ? (parsed as { at?: unknown }).at : undefined;
        if (typeof at === "number" && Number.isFinite(at) && at <= now) standingAt = at;
      }
    } catch { /* an unreadable request is treated as absent and overwritten */ }
    if (standingAt !== null && now - standingAt < FLEET_RESTART_MIN_INTERVAL_MS) {
      return refuse(`a restart.request for '${shown}' was written ${Math.floor((now - standingAt) / 1000)} seconds ago, and a second request inside fifteen minutes of the first is refused.`);
    }
    // One write rather than a temporary file renamed over the target, since
    // the host's filesystem has no rename. A supervisor that reads the file
    // mid-write parses a truncated object as no request and reads the whole
    // file at its next poll.
    try {
      await fsWrite(requestPath, JSON.stringify({ at: now, by: sess.persona, reason }));
    } catch (err) {
      return refuse(`the request file '${requestPath}' could not be written: ${boundedText(safeErrorText(err))}`);
    }
    return { result: `Restart requested for '${shown}': where its supervisor is running, it restarts the child at its next poll and lets a running turn end first. Where none is running, the next child launched for that persona starts after the request and reads it as served.` };
  }

  // Serve fleet_interrupt (the coordinator ends another persona's running
  // turn in place, keeping its conversation). Clones fleet_restart's gates
  // above in the same order, minus the fifteen-minute interval refusal:
  // interrupt.request carries no lever a second write could jam, since the
  // supervisor's own served-time record is what makes one request send one
  // interrupt, not this tool. The ground, the roster read and the run
  // directory check are the same rule for the same reason fleet_restart's
  // comment gives: every persona runs as the operator's own account, so
  // this tool's ground fences the tool, not the file.
  if ((e as any).tool === "mcp__personas__fleet_interrupt") {
    const now = Date.now();
    const target = String((e as any).persona || "").trim();
    const reason = String((e as any).reason || "").trim().slice(0, FLEET_RESTART_REASON_MAX);
    const shown = boundedText(bracketSafeText(target));
    const refuse = (why: string) => {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `fleet_interrupt refused: ${why}` };
    };
    const entries = await readAllEntries(commonsStore());
    const ground = deliveryGroundIn(liveClaimsOf(entries, sess.staleAfterMs, now), coordinatorPersona, sess.mySessionId, coordinatorPersona, { persona: architectPersona, records: [] });
    if (!("ground" in ground) || ground.ground !== COORDINATOR_GROUND) {
      const standing = "ground" in ground ? `the ground '${ground.ground}'` : "no ground on that persona at all";
      return refuse(`only the session holding the '${coordinatorPersona}' persona may interrupt another persona's child, and this session holds ${standing}.`);
    }
    if (fleetRoster === "") {
      return refuse("the plugin's fleetRoster setting names no roster file, so there is no persona to interrupt.");
    }
    let roster: unknown;
    try {
      roster = await readRosterFile(host(), fleetRoster);
    } catch (err) {
      return refuse(`the roster '${fleetRoster}' could not be read or parsed: ${boundedText(safeErrorText(err))}`);
    }
    if (!Array.isArray(roster)) {
      return refuse(`the roster '${fleetRoster}' does not hold a JSON array of persona entries.`);
    }
    const entry = (roster as unknown[]).find((candidate) => {
      const name = ((candidate ?? {}) as RosterEntry).name;
      return typeof name === "string" && name.trim() === target;
    }) as RosterEntry | undefined;
    if (entry === undefined) {
      return refuse(`the roster '${fleetRoster}' carries no entry named '${shown}'.`);
    }
    if (entry.enabled !== true) {
      return refuse(`the roster entry for '${shown}' is not enabled, and only a persona the roster enables is interrupted.`);
    }
    if (target === sess.persona) {
      return refuse(`'${shown}' is this session's own persona.`);
    }
    const runDir = rosterRunDir(entry);
    const runDirExists = runDir !== null && await fsExists(runDir).catch(() => false);
    if (runDir === null || !runDirExists) {
      return refuse(runDir === null
        ? `the roster entry for '${shown}' names neither a run directory nor a working directory, so there is nowhere to write the request.`
        : `the run directory '${runDir}' for '${shown}' does not exist.`);
    }
    const requestPath = `${runDir}/interrupt.request`;
    try {
      await fsWrite(requestPath, JSON.stringify({ at: now, by: sess.persona, reason }));
    } catch (err) {
      return refuse(`the request file '${requestPath}' could not be written: ${boundedText(safeErrorText(err))}`);
    }
    return { result: `Interrupt requested for '${shown}': where its supervisor is running, it relays the request to the child's holder at its next poll, and the holder relays the interrupt to the child at its own next poll, up to about 12 seconds after this call at the plugin's default poll intervals. The turn ends keeping the conversation. Where no turn begun at or before this call is running, the supervisor records the request served without relaying it instead. A message sent with agentic_say afterwards arrives as that persona's next prompt.` };
  }

  // Section 12: serve agentic_resolve (the owner marks a record's work
  // finished or declined). Owner only, and only for a record listed under
  // the session's own persona, so a reader holding the persona cannot
  // resolve, and a record keyed to another persona does not resolve here.
  // A pending record has not been read, and a skipped record's writer is
  // gone, so neither has anything to resolve.
  if ((e as any).tool === "mcp__personas__agentic_resolve") {
    const persona = sess.persona;
    const id = String((e as any).id || "").trim();
    const outcome = (e as any).outcome as string | undefined;
    const note = typeof (e as any).note === "string" ? (e as any).note : "";
    if (!sess.isOwner) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "agentic_resolve is for the owner session only; a reader does not resolve the owner's records." };
    }
    // The note goes whole into the machine-global store, which every live
    // session rewrites and polls, so it is bounded here at the handler.
    if (note.length > FREE_TEXT_MAX) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `agentic_resolve note is ${note.length} characters; the bound is ${FREE_TEXT_MAX}. Shorten it.` };
    }
    if (!id) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "agentic_resolve requires a non-empty 'id'." };
    }
    if (outcome !== "done" && outcome !== "declined") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: "agentic_resolve requires 'outcome' of done or declined." };
    }
    const store = commonsStore();
    const target = (await listInboxRecords(store, persona)).find((rec) => rec.id === id);
    if (!target) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `no record '${id}' addressed to persona ${persona}.` };
    }
    if (target.status === "pending") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `record '${id}' is still pending (not delivered yet); nothing to resolve.` };
    }
    if (target.status === "skipped") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `record '${id}' was skipped at delivery (the decision log names why); nothing to resolve.` };
    }
    if (target.status !== "delivered" && target.status !== "answered") {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `record '${id}' is already ${target.status} (${target.outcome ?? "no outcome"}).` };
    }
    const existing = await store.get(target.key);
    if (!existing) {
      setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
      return { deny: `record '${id}' left the store before it could be resolved.` };
    }
    const parsed = typeof existing === "string" ? JSON.parse(existing) : existing;
    parsed.status = "resolved";
    parsed.resolvedAt = Date.now();
    parsed.outcome = outcome;
    parsed.note = note;
    await store.set(target.key, parsed);
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "worker",
      action: "operator_resolved",
      detail: `record ${id} resolved ${outcome}${note ? `: "${note.slice(0, 80)}"` : ""}`,
    });
    // Attempted rather than depended on. The resolve itself is the commons
    // record written above, which stands whatever the persona store does, so
    // a throw here would tell the caller the resolve failed after it landed
    // and invite a second call on a record that is already resolved. The
    // decision line stands in memory and the first write that is not refused
    // carries it.
    try { await persist(); } catch { /* persist could not read or write the store; the line above waits in memory */ }
    return { result: `Record ${id} resolved (${outcome}).` };
  }

  // Goal constraint: deny Bash if the ROOT objective says so (R10).
  const rootForConstraint = sess.state.goals.find((g) => g.parentId === null);
  if (rootForConstraint &&
      e.tool === "Bash" && rootForConstraint.objective.toLowerCase().includes("no bash")) {
    setToolErrorsThisTurn(toolErrorsThisTurn() + 1);
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "goal",
      action: "deny",
      detail: `${rootForConstraint.id}: Bash denied by root constraint`,
    });
    await persist();
    return { deny: "Bash is not allowed by the current goal" };
  }

  // The recognition ask of a main-loop call, started once whichever site
  // reaches it first: the nudge's after hook awaits it before it claims,
  // so the answer gates this call's pointers, and the lines below start
  // it unawaited where no nudge ran, as on a call a plugin raised, since
  // no pointer of this call waits on it. A failed ask settles as no
  // answer, so it never silences a pointer. It reads the call and never
  // the result.
  let recognitionAsked: Promise<void> | null = null;
  const askRecognition = inSubagent ? undefined : (): Promise<void> => {
    recognitionAsked ??= recognitionAsk(e.tool, (e as { command?: unknown }).command, jevMode, hookBudget).catch(() => undefined);
    return recognitionAsked;
  };

  // The guard and after-hook region around next(e), guardedNext's.
  const guarded = await guardedNext(askRecognition);
  if ("early" in guarded) return guarded.early;
  let r = guarded.r;
  if ((r as { isError?: boolean }).isError === true) setToolErrorsThisTurn(toolErrorsThisTurn() + 1);

  // The recognition ask on the after side of a main-loop call that ran:
  // awaited where the nudge's after hook started it, by then settled,
  // and started and left to settle on its own where no nudge ran. That
  // start holds on an unmetered budget rather than this hook's, which
  // ends before the ask can answer.
  if (askRecognition !== undefined) {
    if (recognitionAsked !== null) await recognitionAsked;
    else void recognitionAsk(e.tool, (e as { command?: unknown }).command, jevMode, { live: false, remainingMs: () => Infinity }).catch(() => undefined);
  }

  // The rerun window a live pass opened: a main-loop call the model made
  // and the engine ran counts once against the watch list, and one of a
  // watched tool and input writes rerun_within true. A subagent's call and
  // a plugin-raised one count nothing. Under shadow and off nothing is
  // watched and nothing is read. A failure costs the outcome and never
  // the call's result.
  if (modelMadeCall && !inSubagent && typeof (r as { deny?: unknown }).deny !== "string" && compactionPassOption === "live" && jevMode === "shadow") {
    try {
      await compactionRerunAtCall(compactionPassDeps(), e.tool, toolCallInputOf(e));
    } catch { /* the window stands as it was; the result stands */ }
  }

  // The boundary reminder a held compaction armed, on the next tool
  // result the model reads: a main-loop call the model made, at most
  // once in COMPACT_REMINDER_INTERVAL_MS, since a vetoed offer recurs
  // every turn and the session needs telling once rather than at every
  // call. A subagent's result and a plugin-raised call's carry none and
  // spend nothing: the engine drops a plugin call's context, and the
  // reminder is for the main loop whose context is held. The call that
  // ran the boundary verb above carries none and spends nothing either,
  // since the reminder would ask for what it just did. A deny from beneath
  // carries none and spends nothing, since the engine's deny arm takes no
  // context and skips a result of any other shape. The command names
  // the kit's install path where installed_plugins.json resolves one,
  // with the home directory spelled $HOME, and the bare verb where it
  // does not; compaction.ts composes the clause under its own grammar,
  // and it is folded to one bracket-safe line here as every other context
  // line the plugin writes is. The fills are function replacements, so
  // no dollar sequence in a value is read as a replacement pattern.
  if (modelMadeCall && !inSubagent && !bankedOnThisCall && typeof r.deny !== "string" && compactionHeld() !== null && Date.now() - compactionReminderAt() >= COMPACT_REMINDER_INTERVAL_MS) {
    setCompactionReminderAt(Date.now());
    const located = await kitInstallPathOf();
    let home: unknown;
    try {
      home = await host().getHome();
    } catch {
      home = undefined;
    }
    const command = checkpointCommandClause("installPath" in located ? located.installPath : null, home).clause;
    const held = compactionHeld()!.percent;
    const line = COMPACT_HOLD_REMINDER_TEXT
      .replace("{percent}", () => String(held))
      .replace("{valve}", () => String(COMPACT_VALVE_PERCENT))
      .replace("{command}", () => bracketSafeText(oneLine(command)));
    const prior = Array.isArray(r.context) ? r.context : [];
    r = { ...r, context: [...prior, line] } as typeof r;
  }

  // The close-out pair drafts, on a main-loop call the model made that a
  // hook beneath did not deny: a subagent's result and a plugin-raised
  // call's carry none and owe nothing, since the hygiene step is the main
  // loop's own, and a deny takes no context. First the delivery: the
  // block the drain holds for the running turn rides this result's
  // context, once, and is cleared here, so the call after it carries
  // none. Then the owe: a shell command running memq decay-scan without
  // --pairs all, in either spelling memq takes and with or without one
  // pair of quotes around the word, whose result text lists a pair, owes
  // the listed pairs to the drain under the running turn's id and starts
  // the drain where none is running. The start is not awaited, so this
  // result goes back at once and the block rides a later call; an item
  // owed while a drain runs waits for the heartbeat tick to drain it.
  // A --pairs all backlog drain is one the session redirects to a file
  // and judges by hand, so nothing is drafted for it. The text is the
  // result as the model reads it, stderr included, where memq prints the
  // pair block. A later scan in the same turn replaces an item still owed,
  // under one decision. A reader session owes nothing, as it drains
  // nothing. The owed item and the block live on the session beside
  // its state, never in it.
  if (modelMadeCall && !inSubagent && typeof r.deny !== "string") {
    if (sess.pairDrafts !== null && currentGateTurnId() !== null && sess.pairDrafts.turnId === currentGateTurnId()) {
      const prior = Array.isArray(r.context) ? r.context : [];
      r = { ...r, context: [...prior, sess.pairDrafts.block] } as typeof r;
      sess.pairDrafts = null;
    }
    if (sess.isOwner && currentGateTurnId() !== null && typeof r.text === "string") {
      const scans = memqVerbArgsOf(shellCommand, "decay-scan");
      const unquoted = (a: string): string => a.replace(/^(["'])(.*)\1$/, "$2").replace(/^(--pairs=)(["'])(.*)\2$/, "$1$3");
      const backlog = (args: string[]) => args.some((a, i) => unquoted(a) === "--pairs=all" || (unquoted(a) === "--pairs" && i + 1 < args.length && unquoted(args[i + 1]) === "all"));
      if (scans.length > 0 && !scans.some(backlog)) {
        const listed = parseScanPairs(r.text);
        if (listed.pairs.length > 0) {
          if (sess.pairDraftOwed !== null && sess.pairDraftOwed.turnId === currentGateTurnId()) notePairDraftsDropped(currentGateTurnId()!, "replaced by a later scan");
          sess.pairDraftOwed = { turnId: currentGateTurnId()!, pairs: listed.pairs, notDrafted: listed.notDrafted, at: Date.now() };
          if (openTurns.has(currentGateTurnId()!)) void drainPairDraftOwed((turnId) => openTurns.has(turnId));
        }
      }
    }
  }

  // Plan item 8.3: a record from a writer that may reach this persona
  // (deliveryGroundIn over one claims read, the tick's own rule) reaches
  // the owner inside the running turn, either because the sender flagged
  // it urgent or because it has waited breakInAfterMs without being
  // delivered, a leg no coordinator-ground record takes. The age leg is
  // what a long turn needs: a turn that runs for
  // hours holds every record sent during it, and no sender can be asked to
  // predict that, so waiting past the bound is itself the qualification.
  // The controller tick cannot deliver while a turn is in flight, so the
  // record rides here instead: marked delivered, its text appended as
  // context on this tool's result, which the model reads after the result
  // itself. The two legs differ in what they claim about the turn. A
  // flagged record is stamped with it, and turn.complete files that turn's
  // answer as the record's reply, which is what flagging asked for. An aged
  // record is not stamped: the turn opened for something else and its answer
  // is not a reply to the message, so the sender's feedback path is the
  // owner's own agentic_resolve call. One scan carries at most one aged
  // record, the oldest deliverable one, matching the tick drain's own rule
  // that one record rides each pass, so a backlog
  // built up over a quiet stretch drains one record per scan rather than
  // emptying into a single tool result. Flagged records are unrestricted.
  // A record that answers an open ask is left to the tick, which owns the
  // ask lifecycle.
  // Only the main loop's own tool calls carry a break-in: this hook also
  // runs for every other loop's tool calls (a dispatched subagent, the
  // case that matters, and also a teammate, a workflow's agents and the
  // engine's own forks), and e.agentId, the loop's id, is non-empty on
  // those and absent on the main loop. A steer delivered into a
  // subagent's tool result reaches a loop that cannot verify it and never
  // reaches the owner, so such a call neither reads nor advances the
  // throttle, and the record stays pending for the tick or for the
  // owner's own next call. inSubagent is read at the top of this handler.
  if (!inSubagent && sess.isOwner && r.deny === undefined && Date.now() - lastBreakInCheckAt() >= urgentCheckMinMs) {
    // One clock reading for the whole scan, so every record in it is
    // judged against the same instant.
    const scanAt = Date.now();
    setLastBreakInCheckAt(scanAt);
    try {
      const store = commonsStore();
      const persona = sess.persona;
      const pending = (await listInboxRecords(store, persona))
        .filter((rec) => rec.status === "pending" && !rec.answers);
      const candidates = pending.filter((rec) => rec.urgent === true || scanAt - rec.at >= breakInAfterMs);
      const lines: string[] = [];
      const claims = candidates.length > 0 ? await readAllClaims(store, sess.staleAfterMs) : [];
      // A record whose writer persona cannot sit inside the bracket, or
      // whose id or text fails the record rule, is left pending here; the
      // tick's drain marks it skipped. The ground a record passes on is the
      // label its text opens with, so it is kept here rather than recomputed
      // at delivery, and no record is judged twice in one scan.
      const grounds = new Map<InboxRecord, string>();
      const groundFor = (rec: InboxRecord): string | null => {
        const ground = deliveryGroundIn(claims, persona, rec.from, coordinatorPersona, deliveryArchitectLine(architectPersona, rec));
        if ("refused" in ground || deliveryRecordProblem(rec) !== null) return null;
        return ground.ground;
      };
      for (const rec of candidates) {
        if (rec.urgent !== true) continue;
        const ground = groundFor(rec);
        if (ground !== null) grounds.set(rec, ground);
      }
      // The oldest deliverable record qualifying on its wait alone, and only
      // that one; listInboxRecords returns its records oldest first. The
      // deliverability check comes before the slot rather than after it,
      // because the drain that would mark an undeliverable record skipped
      // cannot run while the turn is in flight: a record picked on age alone
      // and then refused would hold the scan's one aged slot for the whole
      // turn and block every sender behind it. A record that is both flagged
      // and aged rides the flagged leg, so it never consumes the slot.
      //
      // A coordinator-ground record is not eligible on its wait at all, and
      // is passed over here without spending the slot. The worker's standing
      // steer instruction names `[COORDINATOR id=<record id>, urgent]` as
      // the one coordinator form carrying no delegated authority, and covers
      // no other marker, so a coordinator bracket reading `, waited` is one
      // a worker has no instruction for and would read as a steer to act on
      // without an operator round trip. A coordinator record still breaks in
      // on the sender's own urgent flag, and otherwise waits for the tick.
      // Reader and worker brackets carry no delegated authority under that
      // instruction whatever marker they arrive with.
      for (const rec of candidates) {
        if (rec.urgent === true) continue;
        const ground = groundFor(rec);
        // A coordinator-ground record never takes the wait leg. The worker
        // steer instruction names only the flagged coordinator bracket as
        // carrying no delegated authority, so a coordinator record reaches a
        // tool result on the flagged leg alone. The ground it is compared
        // against is the one deliveryGroundIn produces, read from the same
        // constant, so producer and check cannot drift.
        if (ground === null || ground === COORDINATOR_GROUND) continue;
        grounds.set(rec, ground);
        break;
      }
      for (const rec of candidates) {
        const ground = grounds.get(rec);
        if (ground === undefined) continue;
        const existing = await store.get(rec.key);
        if (!existing) continue;
        const parsed = typeof existing === "string" ? JSON.parse(existing) : existing;
        parsed.status = "delivered";
        // The scan's own reading, the same instant the age test used, so the
        // minutes the decision logs and the wait self-review measures as
        // deliveredAt - at cannot disagree.
        parsed.deliveredAt = scanAt;
        // The ground the context line opens with, stored for the wait signal.
        parsed.ground = ground;
        // A record that is both flagged and aged reads as urgent: the
        // sender's own flag is the stronger statement of why it is here.
        const waited = rec.urgent !== true;
        // Only a flagged record is stamped, so only a flagged record takes
        // the turn's answer as its reply in turn.complete.
        if (!waited) parsed.turnId = sess.state.monitor.lastTurnId;
        await store.set(rec.key, parsed);
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: waited ? "operator_delivered_waited" : "operator_delivered_urgent",
          detail: waited
            ? `record ${rec.id} delivered inside the running turn as context on ${e.tool} after waiting ${Math.floor((scanAt - rec.at) / 60_000)} min`
            : `record ${rec.id} delivered inside the running turn as context on ${e.tool}`,
        });
        pushDeliveryLine(lines, ground, rec, waited);
      }
      if (lines.length > 0) {
        await persist();
        const prior = Array.isArray(r.context) ? r.context : [];
        return { ...r, context: [...prior, ...lines] } as typeof r;
      }
    } catch { /* commons read failed; the tick delivers the record after the turn */ }
  }
  return r;
}
