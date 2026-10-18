// controller-tick.ts: the controller tick's bodies. The armed heartbeat
// tick, which stamps the liveness files, refreshes or yields the claim,
// promotes a passive reader whose holder went stale and runs the pair
// drain; the inbox drain, one record per call; the always part of the
// controller tick, the supervisor mailbox pass; the idle part, the fleet
// wake, the reconciliation pass, the cost bookkeeping, the self-review, the
// git probe, the finding and plan-record routing, the planner, the ask tick,
// the proposal, the controller decision and its actuators; and the tick
// that runs them in order. hooks/index.ts holds the wiring: the two timer
// registrations, the catch that carries a tick's failure to the fleet
// reading, the context builder, and every statement a test reads from that
// file's source: the prompt submits and the delivery frames
// test-personas/injection-ledger.mjs sizes, the fleet notes it reads, the
// model calls whose scrub test-personas/redactor-module-test.mjs pins, and
// the completeRoot call lines test-personas/supervisor-natural-exit-test.sh
// reads.
//
// No `import $` and no side effects at load. The engine's loader follows
// `$` only into functions declared in hooks/index.ts, so each function here
// takes a TickContext, which hooks/index.ts builds once per session.start,
// after every state declaration the bodies read and before either timer
// registers. The engine's verbs and the helpers that take `$` cross as
// closures; the session and the register-scope constants cross as the same
// references; each register-scope and module-level `let` crosses as a
// getter, and a setter where a body writes it, read at the moment the body
// reads it. The module holds no state of its own, since the tick harness
// evaluates it once per process while it loads a fresh hooks/index.ts per
// case.

import { ASKS_OPEN_MAX, LINE_TERMINATOR, activateNext, bracketSafeText, closeAsk, createDefaultState, hasStartableWork, holdOf, isPlanningDue, isRootFinished, openAskEntries, parseState, planningCapReached, previousRoundBlocked, recordPreviousSession, shouldYield, type AgentState, type AskEntry, type EnvGit, type GoalNode, type SentFinding, type SentPlanRecord } from "./agent-state";
import type { liveAsk as liveAskFromModule, openLedgerAsk as openLedgerAskFromModule, shadowAsk as shadowAskFromModule, shadowOutcome as shadowOutcomeFromModule, tickOpenAsk as tickOpenAskFromModule, withdrawLiftedAskBy as withdrawLiftedAskByFromModule } from "./ask-layer";
import { stampBeat, stampSupervisorFile, type BeatHost, type HeartbeatEntry } from "./beat";
import { cacheTick, type CacheClockState } from "./cache-clock";
import type { ExpectedTurn, SubmitOutcome } from "./channel-text";
import { claimResource, commonsWinner, readAllClaims, readAllEntries, type CommonsStore } from "./commons";
import { compactionPassStep, type CompactionPassDeps, type CompactionPassOption } from "./compaction-pass";
import { backoffFactor, bumpWindow, effectiveWindowCount, estimateTokens, fnv1aHash, shouldRunClassify } from "./cost-ledger";
import { splitOf } from "./decision-journal";
import type { drainSupervisorMailbox as drainSupervisorMailboxFromModule } from "./drains";
import { fleetReadingOf, readFleetRows, type FleetLine, type fleetPromptText } from "./fleet";
import type { PluginHost } from "./host";
import type { HookBudget, LiveAskResult } from "./jev-live";
import { SweepDeleteError, askKey, claimReaderRole, deliveryArchitectLine, deliveryGroundIn, deliveryPrefix, deliveryRecordProblem, enforceChannelWindow, listInboxRecords, mayReachPersona, readAskRecord, readInboxRecord, sendPluginRecord, sweepExpiredRecords, type InboxRecord } from "./operator";
import { isPlanEntry, reactivateAskedEntry, roundSummaryText } from "./plan-route";
import { CONTROLLER_DECISION, PLAN_SWITCH, PLAN_SWITCH_NO_MATCH, controllerLabelsOf, controllerLastAnswerText, controllerStateText, kaizenLine, resolverOf, type ControllerStateFact } from "./question-catalog";
import { FINDING_COOLOFF_MS, FINDING_UNROUTABLE_AFTER_MS, buildSelfReviewInput, dedupeSelfReview, evictSelfReview, isSelfScoringLesson, reviewOwnRecord, shouldSelfReview } from "./self-review";
import type { SessionState } from "./session-state";
import { safeErrorText } from "./text";
import { AGENT_HOLD_REPORT_MS } from "./turn-state-text";
import { openAskBy, ownAskStands } from "./worker-ask";
import type { ProcessRunResult } from "claude-code";

// The parameters of a module function after its deps argument, so a
// context field over an ask-layer or drains wrapper carries that wrapper's
// own parameter list.
type AfterDeps<F> = F extends (deps: any, ...rest: infer R) => any ? R : never;

// The hold a running background agent puts on the idle branch, as
// hooks/index.ts keeps it.
export type AgentHold = { entryId: string; since: number; beginLogged: boolean; hourLogged: number };

// The fields the tick bodies share with the tool-call body in
// hooks/tool-call.ts: the session, the register-scope constants and the
// three module helpers both read, and the getters and setter both take.
// Each context hooks/index.ts builds carries its own closures over them.
export interface SharedHandlerState {
  selfReviewLessonCount: () => number;
  dropDecision: (entry: AgentState["decisions"][number]) => void;
  commonsMeta: () => { turnStartedAt: number | null; workdir: string };
  sess: SessionState;
  cfg: Record<string, unknown>;
  expectedTurns: ExpectedTurn[];
  openTurns: Map<string, number>;
  coordinatorPersona: string;
  architectPersona: string;
  fleetRoster: string;
  jevMode: string;
  compactionPassOption: CompactionPassOption;
  planningInFlight: () => boolean;
  arming: () => "off" | "reader" | "owner";
  setCountResetSinceNudgeOpened: (value: boolean) => void;
}

// What hooks/index.ts hands the tick bodies. The engine's verbs; the five
// model calls, each kept in hooks/index.ts with its scrub; the host
// adapters, built at each call as the bodies built them; the helpers that
// take `$`; the prompt submits, the delivery frames and the fleet notes
// kept in hooks/index.ts for the tests that read its source; the helpers
// and values that cross by reference; the register-scope constants; and the
// getters and setters over the `let`s the bodies share with the other
// handlers. The fields SharedHandlerState names are the ones the tool-call
// body shares.
export interface TickContext extends SharedHandlerState {
  log: (line: string) => void;
  toast: (text: string) => void;
  status: (text: string) => void;
  fsExists: (path: string) => Promise<boolean>;
  fsRead: (path: string) => Promise<string>;
  fsWrite: (path: string, text: string) => Promise<void>;
  completeSelfReview: (prompt: string) => Promise<unknown>;
  completePlanner: (planPrompt: string) => Promise<unknown>;
  classifyController: (summary: string, labels: readonly string[]) => Promise<string | undefined>;
  completePlanSwitch: (switchPrompt: string) => Promise<unknown>;
  completeReason: (finalDecision: string, summary: string) => Promise<unknown>;
  commonsStore: () => CommonsStore;
  host: () => PluginHost;
  beatHost: () => BeatHost;
  compactionPassDeps: () => CompactionPassDeps;
  persist: () => Promise<boolean>;
  persistOrRollBack: (rollBack: () => void) => Promise<boolean>;
  activate: (nextId: string | null, reason: string) => void;
  runChild: (argv: readonly string[]) => Promise<ProcessRunResult>;
  runHealth: (forNodeId: string | null) => Promise<void>;
  tickOpenAsk: (...args: AfterDeps<typeof tickOpenAskFromModule>) => ReturnType<typeof tickOpenAskFromModule>;
  openLedgerAsk: (...args: AfterDeps<typeof openLedgerAskFromModule>) => ReturnType<typeof openLedgerAskFromModule>;
  withdrawLiftedAskBy: (...args: AfterDeps<typeof withdrawLiftedAskByFromModule>) => ReturnType<typeof withdrawLiftedAskByFromModule>;
  submitKaizen: (expectedTurns: ExpectedTurn[], announced: string[]) => Promise<void>;
  queueMemoryCheck: (expectedTurns: ExpectedTurn[], goalId: string, title: string, goalIds: string[]) => void;
  writeClaimDirect: () => Promise<void>;
  yieldNow: (onDisk: { activeSessionId: string; epoch: number }) => Promise<void>;
  liveTopLevelAgentRunning: () => Promise<boolean>;
  meterDrainStep: (now: number) => void;
  appendToChannelLog: (lines: string[]) => Promise<string>;
  drainSupervisorMailbox: (...args: AfterDeps<typeof drainSupervisorMailboxFromModule>) => ReturnType<typeof drainSupervisorMailboxFromModule>;
  drainMemoryOwed: () => Promise<void>;
  drainAskBriefOwed: (cfg: Record<string, unknown>, expectedTurns: ExpectedTurn[]) => Promise<void>;
  drainPairDraftOwed: (turnOpen: (turnId: string) => boolean) => Promise<void>;
  completeLeafReturningClosed: (id: string, note: string) => Promise<string[]>;
  migrateLegacyMemories: () => Promise<void>;
  completeRootUnplanned: (rootId: string) => Promise<void>;
  completeRootZeroPlans: (rootId: string) => Promise<void>;
  answerBlocksOf: (answer: InboxRecord, answerFollowUps: string[]) => Promise<string[] | null>;
  submitAnswerDelivery: (answer: InboxRecord, askEntry: AskEntry, answerLabel: string, answerBlocks: string[]) => Promise<SubmitOutcome>;
  deliveryBlocksOf: (oldest: InboxRecord, deliveryFollowUps: string[]) => Promise<string[] | null>;
  submitDelivery: (oldest: InboxRecord, ground: string, deliveryBlocks: string[]) => Promise<SubmitOutcome>;
  fleetStoreRefusedNote: (err: unknown) => FleetLine;
  submitFleet: (changed: Parameters<typeof fleetPromptText>[0], notes: FleetLine[], movedKeys: number, fleetNow: number) => Promise<SubmitOutcome>;
  noteReconcileStoreRefused: (err: unknown) => void;
  submitReconcile: () => Promise<SubmitOutcome>;
  submitTrunkGate: () => Promise<SubmitOutcome>;
  expectProposalTurn: () => ExpectedTurn;
  submitProposal: (expectedProposalTurn: ExpectedTurn) => Promise<SubmitOutcome>;
  submitNudge: (g: GoalNode, idleGapConverted: boolean, idleDisplay: string, controllerStampId: string | null) => Promise<{ nudgeOutcome: SubmitOutcome; unlinedAnswers: number }>;
  liveAsk: (...args: AfterDeps<typeof liveAskFromModule>) => ReturnType<typeof liveAskFromModule>;
  shadowAsk: (...args: AfterDeps<typeof shadowAskFromModule>) => ReturnType<typeof shadowAskFromModule>;
  shadowOutcome: (...args: AfterDeps<typeof shadowOutcomeFromModule>) => ReturnType<typeof shadowOutcomeFromModule>;
  withdrawFollowUpsOffered: (ids: readonly string[]) => void;
  nudgeCapAskText: (persona: string, title: string, nudges: number) => string;
  completionText: (value: unknown) => string | null;
  completionShape: (value: unknown) => string;
  noteCompletionShape: (site: string, value: unknown) => void;
  clearAgentHold: () => void;
  heartbeatPathOf: () => string;
  recordFailedDelivery: (rec: InboxRecord, outcome: { how: string; reason: string }) => void;
  cacheClock: CacheClockState;
  cacheWatch: { warmSeen: boolean };
  PROPOSAL_EVERY_MS: number;
  PLAN_RECORD_MAX_RESENDS: number;
  turnIsOpen: () => boolean;
  MAX_CONSECUTIVE_NUDGES: number;
  staleAfterMs: number;
  controllerTickMs: number;
  architectLegRefusal: string;
  supervisorMailbox: string;
  supervisorHeartbeatPath: string;
  supervisorMailboxSkipped: Set<string>;
  reconcileEveryMs: number;
  trunkGateHour: number | undefined;
  nudgeFloorMs: number;
  nudgeIdleMs: number;
  gitProbeMs: number;
  selfReviewStreak: number;
  selfReviewDebounceTurns: number;
  selfReviewMaxPerHour: number;
  costEnabled: boolean;
  costMaxNudgesPerHour: number;
  costMaxPluginCallsPerHour: number;
  costBackoffAfterTicks: number;
  costBackoffMaxMs: number;
  jevLive: readonly string[];
  setPlanningInFlight: (value: boolean) => void;
  startStoreProblem: () => FleetLine | null;
  setStartStoreProblem: (value: FleetLine | null) => void;
  reconcileStoreProblem: () => FleetLine | null;
  setReconcileStoreProblem: (value: FleetLine | null) => void;
  claimUnpublished: () => boolean;
  setClaimUnpublished: (value: boolean) => void;
  tickFailure: () => FleetLine | null;
  selfReviewEveryTurns: () => number;
  setSelfReviewEveryTurns: (value: number) => void;
  agentHold: () => AgentHold | null;
  setAgentHold: (value: AgentHold | null) => void;
  gitProbeInFlight: () => boolean;
  setGitProbeInFlight: (value: boolean) => void;
  fleetBlockInFlight: () => boolean;
  setFleetBlockInFlight: (value: boolean) => void;
  drainInFlight: () => Promise<boolean> | null;
  setDrainInFlight: (value: Promise<boolean> | null) => void;
  gitUnavailable: () => boolean;
  setGitUnavailable: (value: boolean) => void;
}

// --- Heartbeat: refresh the sidecar every heartbeatMs ---
// Only the owner stamps its own heartbeat. A passive reader must NOT
// overwrite the holder's heartbeat, or it will (a) mask the real holder's
// staleness and (b) make its own promotion check compare the holder id to
// itself and never fire.
export async function heartbeatTick(ctx: TickContext): Promise<void> {
  const { commonsMeta, heartbeatPathOf, cacheClock, cacheWatch, sess, openTurns, turnIsOpen, staleAfterMs, supervisorHeartbeatPath, jevMode, compactionPassOption } = ctx;
  // One instant for this tick: every liveness file the tick writes, and
  // the claim refresh beside them, carry it, so a reader comparing two
  // of the files never finds them a tick apart.
  const at = Date.now();
  // The child's own heartbeat file, stamped first and whether or not
  // this session still owns the persona: a child that yielded is still
  // the child its supervisor launched and is watching, and nothing the
  // tick does after this, a store read that hangs among them, can delay
  // the file the supervisor reads for liveness. It carries the tick's
  // instant, and the beat below is handed no supervisor path, so the
  // file is written once per tick.
  if (supervisorHeartbeatPath !== "") {
    try { await stampSupervisorFile(ctx.beatHost(), sess, at, supervisorHeartbeatPath); } catch { /* heartbeat file write failed; non-fatal */ }
  }
  // The meter's drain, for every session, started before the ownership
  // checks below can return from the tick and never awaited, so a host
  // that stalls never delays this session's yield.
  try { ctx.meterDrainStep(at); } catch { /* the meter never fails a tick */ }
  // The compaction pass's step, for every armed session, owner or
  // reader: this timer is the one registered before the reader gate
  // the controller tick sits behind. It awaits engine reads alone and
  // fires its Jev asks without awaiting them, so it holds the stamps
  // below for the engine's own answer time and never for the vendor.
  try { await compactionPassStep(ctx.compactionPassDeps(), compactionPassOption, jevMode, turnIsOpen, at); } catch { /* the step counts its own failures */ }
  // The cache clock's tick, owner or reader: the beat below publishes
  // the warm-until instant, and a turn from warm to cold pushes one
  // cache_cold decision per idle stretch. A throw costs the reading only.
  try {
    const tick = cacheTick(at, cacheClock, cacheWatch, turnIsOpen());
    sess.cacheWarmUntil = tick.warmUntil;
    if (tick.coldDetail !== null) sess.state.decisions.push({ timestamp: at, loop: "monitor", action: "cache_cold", detail: tick.coldDetail });
  } catch { /* the beat still stamps */ }
  // The heartbeat tick verifies ownership BEFORE stamping.
  // If the store's (sessionId, epoch) no longer matches this session,
  // another session has claimed the persona and this one must yield
  // here, not on its next guarded write. Without this check a demoted
  // owner keeps stamping its own id over the new owner's heartbeat,
  // and the sidecar ends up naming a session the store does not.
  if (sess.isOwner) {
    let onDisk: { activeSessionId: string; epoch: number } | null = null;
    try {
      if (await ctx.fsExists(sess.storePath)) {
        const store = JSON.parse(await ctx.fsRead(sess.storePath)) as Record<string, unknown>;
        const existing = store[sess.persona] as AgentState | undefined;
        if (existing) onDisk = existing;
      }
    } catch { /* store read failed */ }

    if (onDisk && shouldYield(onDisk, sess.mySessionId, sess.myEpoch)) {
      // A session that came up on a store it could not read holds the
      // persona by its heartbeat and its commons claim, and by nothing
      // in the store. The name the store carries at the first read that
      // parses is then the one it held before this session started
      // rather than a successor's, and yielding to it hands the persona
      // to a session that is very likely gone. What it costs is the
      // whole watcher: this session's own sidecar stamp names the
      // holder for the promotion check below, which reads that holder
      // as itself and so never promotes again for the life of the
      // process, and the controller tick returns at its owner check
      // from here on, so no [FLEET] and no [RECONCILE] prompt is ever
      // submitted and the start-up refusal that session.start in
      // hooks/index.ts records as startStoreProblem reaches nobody. So a
      // session that has its persona's state to publish takes the claim
      // here instead, at the first read that parses, with commons
      // deciding whether a live session got there first.
      // A session that never loaded its state does not publish here.
      // What writeClaimDirect below writes is the whole of sess.state,
      // so a session still carrying the built-in default would put an
      // empty tree into the store it has just managed to read. Where the
      // state never loaded the branch is skipped, claimTaken stays false,
      // and the yield below hands the persona to the name the store
      // carries: giving it up costs this session's watcher, where
      // publishing costs the persona's stored tree. Such a session can
      // still take the claim the ordinary way, through a persist that
      // finds no entry for its persona and writes its own, which is the
      // self-heal and destroys nothing, so what this branch guards is the
      // store that does hold a tree. A session that recovered through
      // agentic_identity has the real state and its field cleared, so it
      // publishes here. With the field cleared this way the branch is
      // reached only when a foreign entry lands in the store after
      // agentic_identity's own claim write, since that write puts this
      // session's name in the store and the next tick reads it as its own.
      let claimTaken = false;
      if (ctx.claimUnpublished() && sess.stateNotLoaded === null) {
        try {
          const claims = await readAllClaims(ctx.commonsStore(), staleAfterMs);
          const winner = commonsWinner(claims, `persona:${sess.persona}`);
          if (winner === null || winner === sess.mySessionId) {
            recordPreviousSession(sess.state, onDisk.activeSessionId, sess.mySessionId);
            sess.state.activeSessionId = sess.mySessionId;
            // Above the epoch the store carries, so that the guarded
            // write this session makes next reads its own claim rather
            // than yielding to the epoch it just wrote past.
            sess.state.epoch = Math.max(sess.state.epoch, onDisk.epoch) + 1;
            sess.myEpoch = sess.state.epoch;
            await ctx.writeClaimDirect();
            ctx.setClaimUnpublished(false);
            claimTaken = true;
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "monitor",
              action: "persona_claim_published",
              detail: `Wrote this session's claim on '${sess.persona}' into a store that would not read when it started (prev ${onDisk.activeSessionId}, epoch ${sess.state.epoch})`,
            });
          }
        } catch { /* commons or the store refused; the yield below stands */ }
      }
      if (!claimTaken) await ctx.yieldNow(onDisk);
      // No claim refresh here: a yielded session is a reader to the
      // beat below, which then leaves the sidecar alone, and a
      // published claim has just written the sidecar through
      // writeClaimDirect.
    } else {
      // The store read and carries this session's own claim, so there
      // is nothing left waiting to be published into it and a later
      // name in it is a successor's rather than a predecessor's.
      if (onDisk !== null) ctx.setClaimUnpublished(false);
      // Commons: refresh the persona claim's lastSeen at the tick's
      // instant, the one the beat below stamps, so the claim and the
      // entry's stamp never disagree.
      try {
        const resource = `persona:${sess.persona}`;
        await claimResource(ctx.commonsStore(), resource, sess.mySessionId, at, commonsMeta());
      } catch { /* non-fatal */ }
    }
  }

  // BE3: non-owner heartbeat tick refreshes the reader claim (idempotent).
  // Without this, the reader claim goes stale at 90s and agentic_inbox
  // denies the reader. At the tick's instant, as the owner's refresh is.
  if (!sess.isOwner) {
    try {
      await claimReaderRole(ctx.commonsStore(), sess.persona, sess.mySessionId, at, commonsMeta());
    } catch { /* non-fatal */ }
  }

  // The beat: the sidecar, the commons entry and the meter beat from
  // the tick's one instant, the supervisor's file having taken it at
  // the top. It runs after the ownership check so a demoted owner
  // stamps nothing over its successor's sidecar entry, and so a meter
  // spool that stalls, which holds the stamp for the meter's bound at
  // most and only once, never delays this session's yield. Nothing in
  // it throws into the tick, and a file that cannot be written costs
  // that file alone.
  await stampBeat(ctx.beatHost(), sess, at, { sidecarPath: heartbeatPathOf(), supervisorPath: "" });

  // Passive reader: promote if the sidecar holder is stale and not self.
  // With the shouldYield check above, the sidecar is only ever
  // written by the store's current owner, so a stale sidecar means no
  // live owner, no store-owner comparison needed. A reader-tier
  // session never promotes: it stays a reader even when the holder
  // it reads goes stale.
  // A session whose state never loaded stays a reader too. Taking the
  // persona here loads the stored state and raises the epoch, and the
  // field is cleared only by session.start, where its own store read
  // parsed, and by agentic_identity, so what it would make is
  // an owner every write of which is refused, holding the persona away
  // from a session that could keep it. The same condition guards the
  // claim publish above, so the tick's two persona-taking branches read
  // alike, and a healthy session promotes in this one's place.
  if (!sess.isOwner && ctx.arming() !== "reader" && sess.stateNotLoaded === null) {
    let holderHb: HeartbeatEntry | null = null;
    let sidecarRead = false;
    try {
      if (await ctx.fsExists(heartbeatPathOf())) {
        const hb = JSON.parse(await ctx.fsRead(heartbeatPathOf())) as Record<string, HeartbeatEntry>;
        holderHb = hb[sess.persona] ?? null;
      }
      sidecarRead = true;
    } catch { /* heartbeat read failed */ }

    const now = Date.now();
    // An absent entry is promotable as a stale one is: a session that
    // joined as a reader on a live commons claim with no sidecar entry
    // behind it would otherwise stay a reader forever. The commons check
    // below still guards the promotion, so it waits until that claim
    // goes stale. A sidecar that could not be read promotes nothing.
    const holderIsStale = sidecarRead && (holderHb === null || (now - holderHb.lastSeen) > staleAfterMs);
    const holderIsSelf = holderHb?.sessionId === sess.mySessionId;
    if (holderIsStale && !holderIsSelf) {
      // BE1: check commons before promoting. If a live claim exists
      // on the persona from anyone, stay reader and do not bump epoch.
      try {
        const claims = await readAllClaims(ctx.commonsStore(), staleAfterMs);
        const personaResource = `persona:${sess.persona}`;
        const commonsWinner = claims.find(
          (c) => c.resource === personaResource && c.holder !== sess.mySessionId
        );
        if (commonsWinner) {
          const alreadyLogged = sess.state.decisions.some(
            (d) => d.action === "promotion_deferred_commons" && d.detail?.includes(commonsWinner.holder)
          );
          if (!alreadyLogged) {
            sess.state.decisions.push({
              timestamp: now,
              loop: "monitor",
              action: "promotion_deferred_commons",
              detail: `Deferring promotion: live commons claim by ${commonsWinner.holder}`,
            });
            // Persist the decision to disk (reader path, so persist() won't work).
            // Merge into an existing slot only: read it, push the decision
            // onto it, write back. Where the store holds no slot for the
            // persona, nothing is written. A slot built here from this
            // reader's own state would name the reader as the holder, and
            // a live owner whose own slot is missing would read it at its
            // next persist and yield to a session that owns nothing.
            try {
              const store: Record<string, unknown> = await ctx.fsExists(sess.storePath)
                ? (JSON.parse(await ctx.fsRead(sess.storePath)) as Record<string, unknown>)
                : {};
              const existing = store[sess.persona] as AgentState | undefined;
              if (existing) {
                const existingDecisions = existing.decisions ?? [];
                existingDecisions.push({
                  timestamp: now,
                  loop: "monitor",
                  action: "promotion_deferred_commons",
                  detail: `Deferring promotion: live commons claim by ${commonsWinner.holder}`,
                });
                existing.decisions = existingDecisions;
                existing.updatedAt = now;
                store[sess.persona] = existing;
                await ctx.fsWrite(sess.storePath, JSON.stringify(store, null, 2));
              }
            } catch { /* non-fatal */ }
          }
          return;
        }
      } catch {
        // The commons check failed. A stale sidecar entry proceeds with
        // a local-only promotion, as it always has. An absent entry does
        // not: that reader joined on a live commons claim, so the commons
        // read is the only evidence the holder has gone, and without it
        // nothing is promoted.
        if (holderHb === null) return;
      }
      const store: Record<string, unknown> = await ctx.fsExists(sess.storePath)
        ? (JSON.parse(await ctx.fsRead(sess.storePath)) as Record<string, unknown>)
        : {};
      const existing = store[sess.persona] as AgentState | undefined;
      if (existing) {
        sess.state = parseState(JSON.stringify(existing));
        sess.state.persona = sess.persona;
      } else {
        sess.state = createDefaultState(sess.persona, sess.mySessionId);
      }
      // The count this session held before it yielded counted answers
      // on a tree it no longer holds, so it does not carry into this one.
      // The heartbeat runs with a turn open, so a nudged turn begun
      // before the yield is not added to this tree's count either.
      sess.nudgedAnswersWithoutStatus = 0;
      sess.nudgeCapRefusedFor = null;
      ctx.setCountResetSinceNudgeOpened(true);
      // The store's holder, not the sidecar's, as at the session.start claim.
      recordPreviousSession(sess.state, sess.state.activeSessionId, sess.mySessionId);
      sess.state.activeSessionId = sess.mySessionId;
      sess.state.epoch += 1;
      sess.myEpoch = sess.state.epoch;
      sess.isOwner = true;
      sess.state.decisions.push({
        timestamp: now,
        loop: "monitor",
        action: "reader_promoted",
        detail: holderHb === null
          ? `Promoted from reader to owner (no sidecar entry, no live commons claim)`
          : `Promoted from reader to owner (prev ${holderHb.sessionId ?? "unknown"}, stale after ${now - holderHb.lastSeen}ms)`,
      });
      // AD1: Write the stale-takeover claim directly to the store so that
      // the subsequent persist() call finds the new holder, not the dead one.
      await ctx.writeClaimDirect();
      ctx.log(`Agentic: promoted to owner of '${sess.persona}' (previous holder stale)`);
      // The promoted owner moves the distillates this persona's JSON
      // still holds, as the start's claim does.
      try {
        await ctx.migrateLegacyMemories();
      } catch { /* non-fatal */ }
    }
  }

  // The pair drain's catch, for the owner alone, where the turn its
  // scan ran in is still open: the owe in tool.call starts the drain,
  // and an item owed while a drain was already running is still owed
  // here. Started and not awaited, as the compaction pass's asks are,
  // so a fork that takes a minute never holds the next tick's stamps;
  // the drain's own watch keeps this tick from draining beside a running
  // drain. The drain never throws.
  if (sess.isOwner && sess.pairDraftOwed !== null && openTurns.has(sess.pairDraftOwed.turnId)) void ctx.drainPairDraftOwed((turnId) => openTurns.has(turnId));
}

// The inbox drain, the controller tick's D3 block held in a name so a
// turn's completion can run it too: the turn.complete body in hooks/turn-complete.ts calls it
// through its context's drainInboxNow once a turn this session saw start has closed and
// no other is open, so a burst of records drains at turn pace rather than
// one per tick. It returns true where it submitted a record, or where a
// drain already running when it was called submitted one. A running
// drain holds its place until its submit settles, which the harness
// states is when the submitted turn starts or is queued, never when it
// ends. So the hold keeps a second drain from submitting beside a prompt
// not yet entered, and is gone before the delivered turn can complete.
export async function drainInbox(ctx: TickContext): Promise<boolean> {
  while (ctx.drainInFlight() !== null) {
    // A running drain that throws is reported by its own caller, so a
    // waiter reads the throw as nothing delivered and drains itself.
    try { if (await ctx.drainInFlight()) return true; } catch { /* reported by the drain's own caller */ }
  }
  const drain = drainInboxOnce(ctx).finally(() => { ctx.setDrainInFlight(null); });
  ctx.setDrainInFlight(drain);
  return drain;
}

export async function drainInboxOnce(ctx: TickContext): Promise<boolean> {
  const { withdrawFollowUpsOffered, recordFailedDelivery, sess, turnIsOpen, coordinatorPersona, architectPersona, architectLegRefusal } = ctx;
  // D3: drain operator inbox (one record per call, owner only).
  // List pending inbox records whose writer may reach this persona
  // (deliveryGroundIn over one claims read: a reader claim on it, the
  // coordinator persona owned, a named persona owned when this persona
  // is the coordinator or the architect, or the architect persona owned
  // by the writer of an answer agentic_say admitted on the answer leg
  // and stamped), take the lowest at, mark delivered, submit as a prompt
  // opening with the provenance label that same read produced.
  // D5: if a pending record answers the open ask, close the ask first
  // (ask_answered path) before the general drain.
  // The open-turn reading is taken here rather than trusted from the
  // caller. The tick's blocks before this call submit, and a submit
  // resolves once its turn has started or been queued rather than when
  // that turn ends, so a turn can have opened underneath them by the time
  // this line runs. This drain marks
  // a record delivered and then submits it, and a submit into an open turn
  // is queued rather than answered, so the record would carry a delivered
  // stamp with no turn that ever read it. Skipping leaves it pending and
  // the next quiet tick takes it, which costs one tick and loses nothing.
  if (sess.isOwner && !turnIsOpen()) {
    const persona = sess.persona;
    const store = ctx.commonsStore();
    const allRecords = await listInboxRecords(store, persona);
    const pending = allRecords.filter((rec) => rec.status === "pending");

    // D5: an answering record closes the open ledger entry it names,
    // whichever open entry that is, before the general drain. A record
    // naming a closed or unknown id is no answer here and is left to the
    // drain below, as any other record is.
    if (pending.length > 0) {
      const openEntries = openAskEntries(sess.state);
      const answer = pending.find((rec) => typeof rec.answers === "string" && openEntries.some((entry) => entry.id === rec.answers));
      if (answer) {
        const askId = answer.answers as string;
        const askEntry = openEntries.find((entry) => entry.id === askId) as AskEntry;
        const askRecord = await readAskRecord(store, persona, askId);
        // One claims read gates the answer and labels it. A dead
        // writer's answer is logged here and skipped by the general
        // drain below; an answer whose writer persona cannot sit
        // inside the bracket, or whose id or text fails the record
        // rule, is marked skipped here, once, so the drain never
        // lists it.
        const answerGround = deliveryGroundIn(await readAllClaims(store, sess.staleAfterMs), persona, answer.from, coordinatorPersona, deliveryArchitectLine(architectPersona, answer));
        const answerProblem = deliveryRecordProblem(answer);
        if ("refused" in answerGround && answerGround.refused === "no_claim") {
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "monitor",
            action: "operator_skipped_no_claim",
            detail: `answer ${answer.id} from ${answer.from} holds no live claim that reaches '${persona}' (no reader claim, no '${coordinatorPersona}' persona claim, no named persona of its own${architectLegRefusal})`,
          });
        } else if ("refused" in answerGround || answerProblem !== null) {
          answer.status = "skipped";
          await store.set(answer.key, { ...answer });
          sess.state.decisions.push("refused" in answerGround && answerGround.refused === "bad_name"
            ? {
              timestamp: Date.now(),
              loop: "monitor",
              action: "operator_skipped_bad_name",
              detail: `answer at ${answer.key} would be labelled with persona ${JSON.stringify(answerGround.persona)}, which ${answerGround.problem}; marked skipped`,
            }
            : {
              timestamp: Date.now(),
              loop: "monitor",
              action: "operator_skipped_bad_record",
              detail: `answer at ${answer.key}: ${answerProblem}; marked skipped`,
            });
        } else {
          const answerLabel = answerGround.ground;
          // The goal block, the task list, the standing text and any
          // follow-up block ride ahead of the answer; a delivery carries
          // no memory block, contextSourcesOf in hooks/index.ts says why. They are built
          // before anything below is written, since the sources read
          // the store and a turn can open meanwhile. Null means one
          // did: the ask stays open and the answer pending, nothing is
          // written, and the next quiet tick delivers it with the
          // blocks as they stand then.
          const answerFollowUps: string[] = [];
          const answerBlocks = await ctx.answerBlocksOf(answer, answerFollowUps);
          if (answerBlocks === null) return false;
          // Close the ask on the ledger and, where its record is still
          // open, on the record in the same step. The ledger is the
          // owner's truth, so a record that is missing or already
          // closed does not keep the entry open.
          if (askRecord && askRecord.status === "open") {
            askRecord.status = "answered";
            await store.set(askKey(persona, askId), askRecord);
          }
          closeAsk(sess.state, askId, "answered", `record ${answer.id}`, answer.text, Date.now());
          // D5b: remember the closed question so the classifier does
          // not reopen it on this node right away (bullet 2).
          const askedNodeInbox = sess.state.goals.find((n) => n.id === askEntry.nodeId);
          if (askedNodeInbox) {
            askedNodeInbox.lastAskQuestion = askEntry.question;
            askedNodeInbox.lastAskClosedAt = Date.now();
          }
          // Mark the answer as delivered
          answer.status = "delivered";
          answer.deliveredAt = Date.now();
          // The ground the answer is submitted under, stored so the wait
          // signal can tell a record the delivery rule holds on purpose.
          answer.ground = answerLabel;
          const existing = await store.get(answer.key);
          if (existing) {
            const parsed = typeof existing === "string" ? JSON.parse(existing) : existing;
            parsed.status = "delivered";
            parsed.deliveredAt = answer.deliveredAt;
            parsed.ground = answer.ground;
            await store.set(answer.key, parsed);
          }
          // Deliver the answer as a labelled prompt.
          // The entry is the one the ledger entry names, or the active
          // entry where it is gone from the tree. The close moves no
          // status; see reactivateAskedEntry.
          const targetNode = sess.state.goals.find((g) => g.id === askEntry.nodeId) ?? null;
          const activeNode = targetNode || (sess.state.activeGoalId
            ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
            : null);
          if (activeNode) reactivateAskedEntry(activeNode);
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "monitor",
            action: "ask_answered",
            detail: `ask ${askId} closed by record ${answer.id}`,
          });
          const answerOutcome = await ctx.submitAnswerDelivery(answer, askEntry, answerLabel, answerBlocks);
          if (!answerOutcome.ok) {
            // A refused submit opens no turn, so the follow-up entries
            // its blocks listed list again on the next prompt.
            withdrawFollowUpsOffered(answerFollowUps);
            recordFailedDelivery(answer, answerOutcome);
          }
          await ctx.persist();
          return true;
        }
      }
    }

    // General drain (D3)
    // Filter to writers whose live claims reach this persona, over one
    // claims read for the whole pending list; the same read yields the
    // label each deliverable record carries. A record whose writer's
    // persona cannot sit inside the label's bracket, or whose id or
    // text fails the record rule, is skipped like a dead writer's,
    // under its own decision. An answer the ask step above already
    // marked skipped is not listed again.
    const withClaim: { rec: InboxRecord; ground: string }[] = [];
    const withoutClaim: typeof pending = [];
    const badName: { rec: InboxRecord; persona: string; problem: string }[] = [];
    const badRecord: { rec: InboxRecord; problem: string }[] = [];
    const claims = pending.length > 0 ? await readAllClaims(store, sess.staleAfterMs) : [];
    for (const rec of pending) {
      if (rec.status !== "pending") continue;
      const ground = deliveryGroundIn(claims, persona, rec.from, coordinatorPersona, deliveryArchitectLine(architectPersona, rec));
      const recordProblem = deliveryRecordProblem(rec);
      if ("refused" in ground) {
        if (ground.refused === "no_claim") withoutClaim.push(rec);
        else badName.push({ rec, persona: ground.persona, problem: ground.problem });
      } else if (recordProblem !== null) badRecord.push({ rec, problem: recordProblem });
      else withClaim.push({ rec, ground: ground.ground });
    }
    // Round 32/36: mark a dead writer's record skipped once, on its own
    // key, rather than re-logging the same decision every tick forever -
    // once `status` is "skipped" it drops out of `pending` above on the
    // next `listInboxRecords` read, so the record costs one line total.
    for (const rec of withoutClaim) {
      await store.set(rec.key, { ...rec, status: "skipped" });
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "operator_skipped_no_claim",
        detail: `record ${rec.id} writer ${rec.from} holds no live claim that reaches '${persona}' (no reader claim, no '${coordinatorPersona}' persona claim, no named persona of its own${architectLegRefusal}; marked skipped)`,
      });
    }
    for (const { rec, persona: writerPersona, problem } of badName) {
      await store.set(rec.key, { ...rec, status: "skipped" });
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "operator_skipped_bad_name",
        detail: `record at ${rec.key} would be labelled with persona ${JSON.stringify(writerPersona)}, which ${problem}; marked skipped`,
      });
    }
    for (const { rec, problem } of badRecord) {
      await store.set(rec.key, { ...rec, status: "skipped" });
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "operator_skipped_bad_record",
        detail: `record at ${rec.key}: ${problem}; marked skipped`,
      });
    }
    // Take the oldest record with a live claim
    if (withClaim.length > 0) {
      withClaim.sort((a, b) => a.rec.at - b.rec.at);
      const { rec: oldest, ground } = withClaim[0];
      // The goal block, the task list, the standing text and any
      // follow-up block ride ahead of the record; a delivery carries no
      // memory block, contextSourcesOf in hooks/index.ts says why. They are built before
      // the delivered stamp, as at the answer above: null means a turn
      // opened while the sources read, so the record stays pending with
      // nothing written and the next quiet tick delivers it.
      const deliveryFollowUps: string[] = [];
      const deliveryBlocks = await ctx.deliveryBlocksOf(oldest, deliveryFollowUps);
      if (deliveryBlocks === null) return false;
      oldest.status = "delivered";
      oldest.deliveredAt = Date.now();
      // The ground the decision line and the bracket name, stored so the
      // wait signal can tell a record the delivery rule holds on purpose.
      oldest.ground = ground;
      const existing = await store.get(oldest.key);
      if (existing) {
        const parsed = typeof existing === "string" ? JSON.parse(existing) : existing;
        parsed.status = "delivered";
        parsed.deliveredAt = oldest.deliveredAt;
        parsed.ground = oldest.ground;
        await store.set(oldest.key, parsed);
      }
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "monitor",
        action: "operator_delivered",
        detail: `record ${oldest.id} submitted as ${deliveryPrefix(ground, oldest.id, "plain")}`,
      });
      const deliveryOutcome = await ctx.submitDelivery(oldest, ground, deliveryBlocks);
      if (!deliveryOutcome.ok) {
        // A refused submit opens no turn, so the follow-up entries its
        // blocks listed list again on the next prompt.
        withdrawFollowUpsOffered(deliveryFollowUps);
        recordFailedDelivery(oldest, deliveryOutcome);
      }
      await ctx.persist();
      return true; // One record per call
    }
  }
  return false;
}

// The always part of the tick: what runs on every tick an owner takes,
// turn open or not. The supervisor's mailbox, where the launcher set one:
// a probe is acknowledged with no turn spent, during a long turn as
// between turns, so a supervisor probing a session inside a long turn
// reads it alive; a shutdown is delivered once as a labelled turn where
// no turn is open, after which the tick ends as the inbox drain's does,
// so nothing else queues behind a session that has been asked to leave;
// a shutdown read while a turn is open stays in the mailbox for the first
// idle tick's pass. The cost bookkeeping stays in the idle part, below
// the fleet block: its persist is the bare store write whose throw the
// fleet's tick-failure reading reports, and its sweep collects stale
// commons entries the fleet block must read first. Resolves false where
// nothing more runs this tick.
export async function alwaysTick(ctx: TickContext): Promise<boolean> {
  const { sess, expectedTurns, turnIsOpen, supervisorMailbox, supervisorMailboxSkipped } = ctx;
  // 1. Owner check.
  if (!sess.isOwner) return false;
  if (supervisorMailbox !== "") {
    const mailbox = await ctx.drainSupervisorMailbox(supervisorMailbox, expectedTurns, supervisorMailboxSkipped, turnIsOpen);
    if (mailbox.logged) {
      try { await ctx.persist(); } catch { /* the store refused; the lines above wait in memory */ }
    }
    if (mailbox.delivered) return false;
  }

  return true;
}

// A Date's local calendar date as YYYY-MM-DD, the shape trunkGateDate holds.
function localDateOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The daily trunk gate's decision for one tick, on the local date and hour
// of `now`. With no stamp yet it stamps and does not fire: today where the
// hour has come, so a session launched inside or after the hour gates the
// next day, and yesterday where it has not, so the gate still fires at
// today's hour. With a stamp it fires at or past the hour where the stamp is
// earlier than today and no turn is open, and the date it returns is written
// before the submit. A stamp later than today, as a clock moved back or a
// hand edit leaves, reads as a spent day, since YYYY-MM-DD compares as a
// string in date order. Otherwise it does nothing, returning the stamp as it
// stands.
export function trunkGateDecision(now: Date, hour: number, stampedDate: string | undefined, turnOpen: boolean): { act: "none" | "stamp" | "fire"; date: string } {
  const today = localDateOf(now);
  const pastHour = now.getHours() >= hour;
  if (stampedDate === undefined) {
    return { act: "stamp", date: pastHour ? today : localDateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) };
  }
  if (pastHour && stampedDate < today && !turnOpen) return { act: "fire", date: today };
  return { act: "none", date: stampedDate };
}

// The idle part of the tick: everything that needs no turn open, run
// after the always part where this session owns the persona and no turn
// is open.
export async function idleTick(ctx: TickContext): Promise<void> {
  const { liveAsk, shadowAsk, shadowOutcome, selfReviewLessonCount, nudgeCapAskText, completionText, completionShape, noteCompletionShape, dropDecision, clearAgentHold, PROPOSAL_EVERY_MS, PLAN_RECORD_MAX_RESENDS, sess, cfg, expectedTurns, turnIsOpen, MAX_CONSECUTIVE_NUDGES, controllerTickMs, coordinatorPersona, architectPersona, fleetRoster, reconcileEveryMs, trunkGateHour, nudgeFloorMs, nudgeIdleMs, gitProbeMs, selfReviewStreak, selfReviewDebounceTurns, selfReviewMaxPerHour, costEnabled, costMaxNudgesPerHour, costMaxPluginCallsPerHour, costBackoffAfterTicks, costBackoffMaxMs, jevMode, jevLive } = ctx;
  // Section 6: the fleet wake. The steward is woken by this block rather
  // than by a cadence written into its own standing instruction. A duty
  // written "on each tick" states a trigger the runtime does not have:
  // everything else in this tick, save the daily [TRUNK GATE] turn the
  // coordinator never takes, submits nothing at all on a persona holding no
  // active goal leaf and an empty inbox, which is exactly the
  // quiet fleet on which a crashed persona most needs reporting. It runs
  // for the coordinator persona only, that being the seat whose standing
  // instruction carries the fleet duty, and only with a roster
  // configured, there being no fleet to read without one.
  // It runs ahead of the inbox drain below, which delivers one record and
  // returns for the rest of the tick. Behind that return, a coordinator
  // with a backlog in its inbox would read no fleet and advance no
  // reconciliation stamp for as many ticks as the backlog is long, which
  // is a fleet going unwatched for exactly as long as the operator is
  // busy. A fleet change is rare and cannot wait; a queued record is
  // durable and is delivered a tick later at worst.
  if (sess.persona === coordinatorPersona && fleetRoster !== "" && !ctx.fleetBlockInFlight()) {
    ctx.setFleetBlockInFlight(true);
    try {
      const fleetNow = Date.now();
      const fleetEntries = await readAllEntries(ctx.commonsStore());
      const report = await readFleetRows(ctx.host(), fleetRoster, fleetEntries, sess.staleAfterMs, fleetNow);
      // The reading this one is compared against, which this session made on
      // an earlier tick. It is held in session memory and read back from no
      // file, so nothing a persona can write decides what is said about it.
      const previousMap = sess.fleetHealth;
      // Whether a clean roster reading has been made, as it stood before
      // this tick. It rolls back with the reading below, so the two advance
      // and retreat together: a flag that advanced while the reading went
      // back would compare the next tick's personas against FLEET_UNSEEN
      // with no memo to hold, which reports every one of them as new.
      const previousFirstReadingDone = sess.fleetFirstReadingDone;
      const { current, changed, notes, movedKeys } = fleetReadingOf(report, previousMap, previousFirstReadingDone, fleetNow, { tickFailure: ctx.tickFailure(), startStoreProblem: ctx.startStoreProblem(), reconcileStoreProblem: ctx.reconcileStoreProblem() });
      // The reading is advanced here, before the submit below, and not when
      // the model reports. What the order guards is the window between a
      // submit and the turn it opens: the prompt submit does not resolve until
      // the session is next idle, and until that turn opens the tick sees no
      // open turn and runs in full. A tick landing in that window reads the
      // same fleet, and against a reading still holding the previous one it
      // queues a second copy of this prompt. Submitted prompts accumulate
      // rather than replacing one another, so that is a pile of identical
      // prompts at the next idle moment.
      // The first-reading flag advances with it, on a tick whose roster read
      // cleanly and on no other, and every rollback below puts the two back
      // together. A flag advancing over a reading that rolled back would
      // leave the next tick comparing personas it holds no memo for against
      // FLEET_UNSEEN, which reports a whole fleet as new.
      sess.fleetHealth = current;
      if (report.problem === undefined) sess.fleetFirstReadingDone = true;
      if (changed.length === 0 && notes.length === 0) {
        // Nothing to say, and nothing to write either: the reading is this
        // session's own memory and the line above has already advanced it.
      } else if (turnIsOpen()) {
        // The open-turn reading is taken again here rather than trusted from
        // the top of the tick. Several awaits stand between the two, the
        // roster and every keeper state file among them, and a delivered
        // record or the operator's own message can open a turn across any of
        // them. A prompt submitted into an open turn wakes nothing: it is
        // queued and arrives as part of the next turn's prompt, behind
        // whatever opened the turn it was queued against.
        // The reading goes back to the one it replaced, so the next quiet
        // tick composes these same lines again rather than waiting for every
        // one of those keys to move a second time. The first-reading flag
        // goes back with it: the two are one reading.
        sess.fleetHealth = previousMap;
        sess.fleetFirstReadingDone = previousFirstReadingDone;
        sess.state.decisions.push({
          timestamp: fleetNow,
          loop: "monitor",
          action: "fleet_skipped_turn_in_flight",
          detail: `a turn opened while the fleet was being read, so the reading is back at the one before it and the next quiet tick reports it: ${[...changed.map(({ row, from, to }) => `${row.name}: ${from} -> ${to}`), ...notes.map((note) => note.composed)].join("; ")}`.slice(0, 400),
        });
        // Attempted rather than depended on, as at the submit below. The
        // store is a file a watched persona can leave unparseable, and a
        // throw from here ends the tick where it stands: the reconciliation
        // block, the inbox drain and the actuator would all be skipped for
        // as long as that persona chooses to hold the store. The reading is
        // session memory and stands whatever the file does, so what a
        // refused write costs is the audit line alone.
        try { await ctx.persist(); } catch { /* the store refused; the line above waits for one that parses */ }
      } else {
        // The line saying the change was reported, pushed before the write
        // that carries it and taken back out with the reading wherever the
        // prompt does not go out. The store is this session's own record,
        // and the yield path below writes it as it hands the persona over,
        // so a line left standing there says the operator was told something
        // no prompt ever carried.
        const changeDecision = {
          timestamp: fleetNow,
          loop: "monitor" as const,
          action: "fleet_health_changed",
          detail: [...changed.map(({ row, from, to }) => `${row.name}: ${from} -> ${to}`), ...notes.map((note) => note.composed)].join("; ").slice(0, 400),
        };
        sess.state.decisions.push(changeDecision);
        // The submit runs on a persist that landed, and a persist that did
        // not land fails in two ways this branch reads apart.
        // A false return is the seat. This session has just given the
        // persona up, on a raised epoch or a lost commons claim, and
        // submitting then would put a fleet reading in front of a session
        // that no longer holds the seat, the reading it was composed
        // against being nowhere. The rollback goes with the call rather
        // than after it, because the lost-claim path writes the state as it
        // gives the persona up and the owner check refuses every write
        // after that, so a rollback assigned below the call would rest in
        // memory while the advanced value rested on disk.
        // A throw is the store. It is a file inside a persona's own working
        // directory, and the live roster gives one directory to more than
        // one persona, so a watched persona that leaves it unparseable
        // makes every persist of every tick throw. A report gated on that
        // write is a report held back about every persona of the fleet for
        // as long as one persona chooses to hold it, which is the silence
        // this whole block exists to refuse. The reading itself needs no
        // file, being this session's own memory, so what the throw costs is
        // the audit line and nothing else: the report goes out carrying a
        // line that names the refusal, the reading stays advanced so the
        // next tick does not compose these same lines again, and the
        // decision line waits in memory for a store that parses.
        // Submitting there does not race the seat. A parse that refuses
        // fires before persist's own yield check, and the same parse
        // refuses any successor's claim write, so no other session took the
        // seat through a store that does not parse; a write that fails
        // comes after a yield check that passed.
        // The line naming the refused write, held here because its own text
        // says the report went out. Where the submit below then fails, that
        // sentence is untrue and the line goes back out of the store beside
        // the one saying the change was reported, rather than standing there
        // asserting a submission this tick did not make.
        let storeRefusedDecision: AgentState["decisions"][number] | null = null;
        try {
          if (!await ctx.persistOrRollBack(() => {
            sess.fleetHealth = previousMap;
            sess.fleetFirstReadingDone = previousFirstReadingDone;
            dropDecision(changeDecision);
          })) return;
        } catch (err) {
          // persistOrRollBack ran the rollback on its way out, which is
          // what a caller that does not submit needs. This branch does
          // submit, so the reading goes forward again and the line saying
          // the change was reported goes back with it, to be written by the
          // first persist that finds a store it can parse.
          sess.fleetHealth = current;
          if (report.problem === undefined) sess.fleetFirstReadingDone = true;
          if (!sess.state.decisions.includes(changeDecision)) sess.state.decisions.push(changeDecision);
          // What the line waits on, said without promising it lands. The
          // repair is a store that parses again, and it is the only thing
          // named here: a session carrying the built-in default rather
          // than the persona's own state comes to hold that state only
          // through a worker calling agentic_identity, which no background
          // path does, so naming it beside the repair would name a wait
          // that may never end. What the line does after the repair depends
          // on what the file then says, and no sentence here tells an
          // operator it will arrive.
          storeRefusedDecision = {
            timestamp: Date.now(),
            loop: "monitor",
            action: "fleet_store_write_failed",
            detail: `the store refused the write that carries this tick's fleet line, so the report went out and both lines wait for a store that parses: ${safeErrorText(err)}`.slice(0, 400),
          };
          sess.state.decisions.push(storeRefusedDecision);
          // The line the prompt carries, composed the way the roster read's
          // own failure is. A failed write's message is built out of the
          // store path and, for a parse, out of the bytes the parser
          // stopped on, so it carries store text whoever wrote the store:
          // it rides a carried line of its own, and the composed line above
          // it holds the plugin's own sentence alone.
          notes.push(ctx.fleetStoreRefusedNote(err));
          // Swallowed rather than rethrown. The clock timer takes a callback
          // it does not await, so an exception out of this tick reaches no
          // caller at all and becomes an unhandled rejection whose
          // consequence is the host process's to decide. The store read in
          // the heartbeat tick swallows this same failure for the same
          // reason. The tick carries on from here and the next one runs.
          try { ctx.log(`Agentic: the persona store refused a write during the fleet read; the [FLEET] report goes out and its decision line waits for a store that parses`); } catch { /* non-fatal */ }
        }
        const fleetOutcome = await ctx.submitFleet(changed, notes, movedKeys, fleetNow);
        if (!fleetOutcome.ok) {
          // No turn is coming, so nothing in that prompt was reported. The
          // reading goes back to the one it replaced, which is what makes
          // the next tick report the same lines again instead of waiting for
          // every one of those keys to move a second time. The line saying
          // the change was reported goes with it, the decision below being
          // what this tick actually did. The first-reading flag goes back
          // with it, the two being one reading.
          sess.fleetHealth = previousMap;
          sess.fleetFirstReadingDone = previousFirstReadingDone;
          dropDecision(changeDecision);
          // And the line naming the refused write, whose own text says the
          // report went out. Left standing it would put "the report went
          // out" and "the prompt failed" in one store.
          if (storeRefusedDecision !== null) dropDecision(storeRefusedDecision);
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "monitor",
            action: "fleet_prompt_failed",
            detail: `the [FLEET] prompt was ${fleetOutcome.how}, so the reading is back at the one before it: ${fleetOutcome.reason}`.slice(0, 200),
          });
          // Attempted rather than depended on: a store that refuses the
          // write is one of the things this tick reaches this line for, and
          // the rolled-back reading is session memory and stands whatever
          // the file does. The line waits in memory for a store that parses.
          try { await ctx.persist(); } catch { /* the store refused; the line above waits for one that parses */ }
        } else {
          // A prompt carrying the start-up store line went out, so the line
          // is done. It is cleared here rather than where it was composed
          // into the notes, because every path that does not submit leaves
          // it for the next tick to carry. The reconciliation block's line
          // rides the same prompt and is done on the same terms.
          ctx.setStartStoreProblem(null);
          ctx.setReconcileStoreProblem(null);
        }
      }
    } finally {
      // Released here rather than at the foot of the block, so a throw
      // out of any of the reads above leaves the flag clear and the next
      // tick reads the fleet. Wedged shut, it would stop the fleet being
      // watched for the life of the session behind a process the keeper
      // reads as healthy, which is the silence this block exists to refuse.
      ctx.setFleetBlockInFlight(false);
    }
  }

  // Section 6: the kit Coordinator seat's reconciliation pass, on that
  // seat's own four-hour cadence and never more often. The first tick of
  // the first session starts the cadence rather than firing it, because
  // the seat is taken and its board read at priming; the prompt is for the
  // pass that follows. The stamp is persisted at that first tick, so a
  // steward relaunched more often than the cadence still reconciles rather
  // than restarting the wait every launch. It is written before the submit,
  // for the reason the reading above is.
  if (sess.persona === coordinatorPersona) {
    const reconcileNow = Date.now();
    const lastReconcileAt = sess.state.lastReconcileAt;
    if (lastReconcileAt === undefined) {
      sess.state.lastReconcileAt = reconcileNow;
      // Attempted rather than depended on, as at the submit below. A
      // throw from here ends the tick where it stands, so the inbox drain
      // and the actuator would be skipped for as long as a watched
      // persona chooses to hold the store unparseable. The stamp stands in
      // memory and holds the cadence for as long as this session runs,
      // which is what a refused write costs: one extra pass after a
      // relaunch inside the cadence.
      try { await ctx.persist(); } catch { /* the store refused; the stamp stands in memory */ }
    } else if (reconcileNow - lastReconcileAt >= reconcileEveryMs) {
      // The open-turn reading is taken again here rather than trusted from
      // the top of the tick. The fleet block above submits, and a submit
      // does not resolve until the session is next idle, so a turn can
      // have opened underneath it by the time this line runs. A prompt
      // submitted into that turn wakes nothing: it is queued and arrives
      // as part of the next turn's prompt, beside the [FLEET] line that
      // opened the turn it was queued behind. The stamp is left where it
      // is, so the next tick with no turn open asks again.
      if (turnIsOpen()) {
        // The stamp is not written, so this costs the pass nothing: the
        // next tick with no turn open finds the cadence still satisfied
        // and asks then. The tick carries on from here rather than
        // returning, because everything below this block is a worker's own
        // bookkeeping and has nothing to do with the seat.
        sess.state.decisions.push({
          timestamp: reconcileNow,
          loop: "monitor",
          action: "reconcile_skipped_turn_in_flight",
          detail: "the reconciliation pass is due and a turn is in flight, so the cadence stamp stands and the next quiet tick asks for it",
        });
        // Attempted rather than depended on, for the reason the write
        // above is: the tick has the inbox drain and the actuator still
        // to run, and the stamp this branch leaves alone is unaffected by
        // what the file does.
        try { await ctx.persist(); } catch { /* the store refused; the line above waits for one that parses */ }
      } else {
        sess.state.lastReconcileAt = reconcileNow;
        // The line naming the submission, taken back out with the stamp
        // wherever the prompt does not go out, as at the fleet submit
        // above. A stamp back at its previous value beside a decision
        // saying the pass was asked for is a store that contradicts
        // itself about the one thing this branch does.
        const reconcileDecision = {
          timestamp: reconcileNow,
          loop: "monitor" as const,
          action: "reconcile_due",
          detail: `submitted the [RECONCILE] prompt on the ${reconcileEveryMs}ms cadence`,
        };
        sess.state.decisions.push(reconcileDecision);
        // As at the fleet submit above, and read apart the same way.
        // A persist that returned false is a session that has just given
        // the persona up, and the seat is no longer this session's to
        // reconcile. The stamp rolls back with the call for the reason
        // the reading above does: the lost-claim path writes this state,
        // so a stamp left advanced would rest on disk with no [RECONCILE]
        // submitted, and the successor would find the cadence freshly
        // satisfied and skip the pass for a whole four hours behind a
        // decision line saying it was asked for.
        // A persist that threw is the store, which a watched persona can
        // hold unparseable for as long as it likes. An unreconciled seat
        // for that whole time is the worse of the two outcomes, so the
        // pass is asked for and the stamp stays advanced in memory. What
        // that costs is one extra pass after a relaunch inside the
        // cadence, the stamp being off disk, against a prompt pile this
        // session cannot make: the in-memory stamp holds the cadence for
        // as long as the session runs.
        // Held for the reason the fleet block's own is: its text says the
        // pass was asked for, so it goes back out of the store wherever
        // the submit below does not make that true.
        let reconcileStoreRefusedDecision: AgentState["decisions"][number] | null = null;
        try {
          if (!await ctx.persistOrRollBack(() => {
            sess.state.lastReconcileAt = lastReconcileAt;
            dropDecision(reconcileDecision);
          })) return;
        } catch (err) {
          // The rollback ran on the way out, and this branch submits, so
          // the stamp goes forward again and the line naming the
          // submission goes back with it for the first persist that finds
          // a store it can parse.
          sess.state.lastReconcileAt = reconcileNow;
          if (!sess.state.decisions.includes(reconcileDecision)) sess.state.decisions.push(reconcileDecision);
          reconcileStoreRefusedDecision = {
            timestamp: Date.now(),
            loop: "monitor",
            action: "reconcile_store_write_failed",
            detail: `the store refused the write that carries the cadence stamp, so the pass was asked for and the stamp stands in memory alone: ${safeErrorText(err)}`.slice(0, 400),
          };
          sess.state.decisions.push(reconcileStoreRefusedDecision);
          // The line the operator reads, composed the way the fleet
          // block's own refused write is and carried on the next [FLEET]
          // prompt. Without it this failure reaches them nowhere: the
          // [RECONCILE] text is fixed and says nothing about the store,
          // and the decision line above is held by the file that refused
          // it. A failed write's message is built out of the store path
          // and, for a parse, out of the bytes the parser stopped on, so
          // it carries store text whoever wrote the store and rides a
          // carried line of its own.
          // It is composed only where a roster is configured, which is the
          // one condition the fleet block takes past this block's own. The
          // [FLEET] prompt is the only thing that carries this line, and
          // that prompt is composed nowhere without a roster, so a line
          // composed here on a rosterless steward would stand uncarried
          // and uncleared for the life of the session and reach the
          // operator at no point. Where there is no roster the log line
          // below is the whole of what this failure leaves.
          if (fleetRoster !== "") {
            ctx.noteReconcileStoreRefused(err);
          }
          // Swallowed for the reason the fleet submit above swallows: the
          // timer does not await this callback, so an exception reaches no
          // caller and the tick would end in an unhandled rejection.
          try { ctx.log(`Agentic: the persona store refused the write carrying the reconciliation cadence stamp; the [RECONCILE] prompt goes out and the stamp stands in memory`); } catch { /* non-fatal */ }
        }
        const reconcileOutcome = await ctx.submitReconcile();
        if (!reconcileOutcome.ok) {
          // No turn is coming, so the pass was never asked for. The stamp
          // goes back, and the next tick asks again rather than leaving
          // the seat unreconciled for a whole further cadence. The line
          // naming the submission goes with it.
          sess.state.lastReconcileAt = lastReconcileAt;
          dropDecision(reconcileDecision);
          // And the line naming the refused write, whose own text says the
          // pass was asked for. The operator's copy of it goes with the
          // decision line, for the same reason: it would otherwise reach
          // the next prompt saying a pass was asked for that this tick
          // never asked for.
          // Both go back on one condition, which is that this tick is the
          // tick that composed them. The operator's copy waits for the
          // next [FLEET] rather than for a store that parses, so a copy
          // standing here can be one an earlier tick composed and no
          // prompt has carried yet. Cleared unconditionally, that one is a
          // refused write this tick had nothing to do with, thrown away
          // where the decision line naming it is held by the store that
          // refused it and the [RECONCILE] text says nothing about a
          // store: it would reach the operator at no point at all.
          if (reconcileStoreRefusedDecision !== null) {
            dropDecision(reconcileStoreRefusedDecision);
            ctx.setReconcileStoreProblem(null);
          }
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "monitor",
            action: "reconcile_prompt_failed",
            detail: `the [RECONCILE] prompt was ${reconcileOutcome.how}, so the cadence stamp is back at its previous value: ${reconcileOutcome.reason}`.slice(0, 200),
          });
          // Attempted rather than depended on, as at the fleet submit
          // above: the store may be the thing that failed, and the
          // rolled-back stamp stands in memory whatever the file does.
          try { await ctx.persist(); } catch { /* the store refused; the line above waits for one that parses */ }
        }
      }
    }
  }

  // The daily trunk gate: one [TRUNK GATE] turn a local date, at or past
  // trunkGateHour, for a session with that option set. It sits here, above
  // the inbox drain and ahead of the planning gate and the idle branch,
  // so it runs on every tick with no turn open, a day the persona has work
  // included. The coordinator persona and the default persona are skipped,
  // as the idle proposal skips them. trunkGateDecision reads the local date
  // and hour, since the hour is the operator's quiet hour on this box. The
  // date is stamped and persisted before the submit, for the idle proposal's
  // reason: the submit does not resolve until the session is next idle, so a
  // stamp written after it would leave every tick in between queueing
  // another copy, and a relaunch while it waits would ask again. A submit
  // that fails has still spent the day, which the trunk_gate_failed record
  // makes visible. A persist that throws is attempted rather than depended
  // on, as the reconciliation block's is, so a store held unparseable does
  // not skip the inbox drain and the actuator below; the stamp stands in
  // memory.
  if (trunkGateHour !== undefined && sess.persona !== coordinatorPersona && sess.persona !== "default") {
    const trunkGateNow = Date.now();
    const gate = trunkGateDecision(new Date(trunkGateNow), trunkGateHour, sess.state.trunkGateDate, turnIsOpen());
    if (gate.act === "stamp") {
      sess.state.trunkGateDate = gate.date;
      sess.state.updatedAt = trunkGateNow;
      try { await ctx.persist(); } catch { /* the store refused; the stamp stands in memory */ }
    }
    if (gate.act === "fire") {
      const trunkGateDate = sess.state.trunkGateDate;
      sess.state.trunkGateDate = gate.date;
      sess.state.updatedAt = trunkGateNow;
      // A persist that returned false is a session that has just given the
      // persona up, and the commons yield writes this state on its way out.
      // The stamp rolls back with the call, so the successor finds the day
      // unspent and gates it, and no turn goes to a session that no longer
      // holds the persona. A persist that threw ran the rollback too, and
      // this branch submits, so the stamp goes forward again in memory.
      try {
        if (!await ctx.persistOrRollBack(() => {
          sess.state.trunkGateDate = trunkGateDate;
        })) return;
      } catch {
        sess.state.trunkGateDate = gate.date;
      }
      const trunkGateOutcome = await ctx.submitTrunkGate();
      sess.state.decisions.push(trunkGateOutcome.ok
        ? {
          timestamp: trunkGateNow,
          loop: "monitor",
          action: "trunk_gate_asked",
          detail: `[TRUNK GATE] turn submitted for ${gate.date} at or past hour ${trunkGateHour}`,
        }
        : {
          timestamp: trunkGateNow,
          loop: "monitor",
          action: "trunk_gate_failed",
          detail: `submit ${trunkGateOutcome.how}, ${gate.date} already spent: ${trunkGateOutcome.reason}`.slice(0, 200),
        });
      sess.state.updatedAt = Date.now();
      try { await ctx.persist(); } catch { /* the store refused; the line above waits for one that parses */ }
    }
  }

  // D3: drain operator inbox, one record per call; drainInbox above
  // owns the block, and a turn's completion calls it too.
  if (await drainInbox(ctx)) return;

  // D4: increment tick index for backoff and cost_summary cadence.
  sess.controllerTickCount = (sess.controllerTickCount ?? 0) + 1;
  const tickIndex = sess.controllerTickCount;

  // D1: emit cost_summary on cadence (AJ2: at top of tick, independent of idle gate).
  const costSummaryEveryNTicks = typeof cfg.costSummaryEveryNTicks === "number" ? (cfg.costSummaryEveryNTicks as number) : 20;
  if (tickIndex % costSummaryEveryNTicks === 0) {
    const cost = sess.state.monitor.cost;
    const totalEstTokens = cost.classify.estTokens + cost.reason.estTokens + cost.selfReview.estTokens + cost.planner.estTokens;
    const totalCalls = cost.classify.count + cost.reason.count + cost.selfReview.count + cost.planner.count + cost.nudge.count;
    sess.state.decisions.push({
      timestamp: Date.now(),
      loop: "monitor",
      action: "cost_summary",
      detail: `classify:${cost.classify.count} reason:${cost.reason.count} selfReview:${cost.selfReview.count} planner:${cost.planner.count} nudge:${cost.nudge.count} estTokens:${totalEstTokens} totalCalls:${totalCalls}`,
    });
    await ctx.persist();

    // AT5: Sweep expired operator records on the summary cadence (owner only).
    // The sweep appends each inbox and reply record to the channel log
    // before deleting it and throws on a refused append with every record
    // still in the store, so a refusal reads as its own decision rather
    // than as a quiet count of zero, the same split the window roll below
    // makes.
    if (sess.isOwner) {
      const ttlMs = typeof cfg.operatorRecordTtlMs === "number" ? (cfg.operatorRecordTtlMs as number) : 86400000;
      try {
        const swept = await sweepExpiredRecords(
          ctx.commonsStore(),
          sess.persona,
          async (lines) => { await ctx.appendToChannelLog(lines); },
          ttlMs,
        );
        if (swept > 0) {
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "worker",
            action: "sweep_expired_records",
            detail: `swept ${swept} expired operator records (persona: ${sess.persona})`,
          });
        }
      } catch (err) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "worker",
          action: "sweep_expired_records_failed",
          detail: err instanceof SweepDeleteError
            ? `sweep partly applied, every record logged, ${err.removed} of ${err.total} removed (persona: ${sess.persona}): ${err.message}`
            : `sweep refused, records left in store (persona: ${sess.persona}): ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Item 5 (Bounded store): the shared store keeps only a short
      // window of recent inbox/reply records - overflow rolls to the
      // append-only channel log instead of staying in the one JSON
      // file forever. Open asks are untouched (a different function,
      // a different lifecycle).
      const channelWindowSize = typeof cfg.channelRecordWindow === "number" ? (cfg.channelRecordWindow as number) : 50;
      // Round 50 point 3: enforceChannelWindow now throws instead of
      // swallowing a failed append, so "nothing to roll" (0, no error)
      // and "a roll was refused" (thrown, records still in the store)
      // read as two different decisions - the next gate can tell them
      // apart instead of seeing the store quietly stop shrinking.
      try {
        let rolledTo = "";
        const rolled = await enforceChannelWindow(
          ctx.commonsStore(),
          sess.persona,
          channelWindowSize,
          async (lines) => { rolledTo = await ctx.appendToChannelLog(lines); },
        );
        if (rolled > 0) {
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "worker",
            action: "channel_window_rolled",
            detail: `rolled ${rolled} closed inbox/reply records to ${rolledTo} (persona: ${sess.persona})`,
          });
        }
      } catch (err) {
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "worker",
          action: "channel_window_roll_failed",
          detail: `roll refused, records left in store (persona: ${sess.persona}): ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }
  // 2a. C3: error streak branch (before the idle gate; H1: move out of the classify path).
  // F6: with an active node, route through the ask-operator path (paused, not blocked).
  // Re-fire rule: only when a new error occurred after handledAt.
  const envErrors = sess.state.monitor.env.errors;
  if (envErrors.consecutiveErrorTurns >= 3 && (!envErrors.handledAt || (envErrors.lastErrorAt && envErrors.lastErrorAt > envErrors.handledAt))) {
    const streakTs = Date.now();
    const streakHead = `Error streak ${envErrors.consecutiveErrorTurns} turns`;
    envErrors.handledAt = streakTs;
    // Look up the active node; with none to pause, there is nothing for
    // an ask to resume, so the streak is logged and nothing more. With no
    // ask open, step 4 below still activates pending work on this tick.
    const activeForStreak = sess.state.goals.find((n) => n.status === "active");
    if (!activeForStreak) {
      sess.state.decisions.push({
        timestamp: streakTs,
        loop: "monitor",
        action: "error_streak",
        detail: `no-active-node: ${streakHead}; no leaf to pause, no ask opened`,
      });
      sess.state.updatedAt = streakTs;
      await ctx.persist();
    } else if (ownAskStands(sess.state, "error-streak", activeForStreak.id)) {
      // The streak's own question still holds this leaf, so the
      // operator already has it. A second one would add nothing, and
      // pausing the leaf with no ask of its own would leave nothing to
      // resume it, so the streak is logged and the leaf keeps running.
      const openStreakAsk = openAskBy(sess.state, "error-streak", activeForStreak.id);
      sess.state.decisions.push({
        timestamp: streakTs,
        loop: "monitor",
        action: "error_streak",
        detail: `${activeForStreak.id}: ${streakHead}; ask ${openStreakAsk?.id} already open, no second ask`,
      });
      sess.state.updatedAt = streakTs;
      await ctx.persist();
    } else {
      const nodeId = activeForStreak.id;
      const streakReason = `${streakHead}; escalating`;
      sess.state.decisions.push({
        timestamp: streakTs,
        loop: "monitor",
        action: "error_streak",
        detail: `${nodeId}: ${streakReason}`,
      });
      // D5: open the blocking entry and its ask record. A streak ask of
      // this leaf whose hold was lifted is withdrawn first, so the fresh
      // one replaces it rather than standing beside it.
      await ctx.withdrawLiftedAskBy(sess.state, sess.persona, "error-streak", nodeId, streakTs);
      const opened = await ctx.openLedgerAsk(sess.state, sess.persona, sess.mySessionId, nodeId, streakReason, "", "error-streak", true, streakTs);
      if (typeof opened === "string") {
        sess.state.decisions.push({
          timestamp: streakTs,
          loop: "monitor",
          action: "ask_cap_refused",
          detail: `${nodeId}: error-streak ask refused: ${opened === "cap" ? `the open cap of ${ASKS_OPEN_MAX}` : opened}`,
        });
      } else {
        sess.state.decisions.push({
          timestamp: streakTs,
          loop: "monitor",
          action: "ask_opened",
          detail: `${nodeId}: error-streak: ${streakReason} (ask ${opened.id})`,
        });
        try { ctx.toast(`Agentic: ${streakReason}`); } catch { /* non-fatal */ }
      }
      // The open ask is the hold: the leaf stays active with no reason
      // written on it, and the idle branch reads the ask through holdOf.
      sess.state.updatedAt = streakTs;
      await ctx.persist();
    }
  }

  // 2a2. Self-review (S9: single execution site in the tick handler).
  // The open-turn reading is taken again here rather than trusted from the
  // top of the tick. The blocks above await store reads and submits, so a
  // turn can have opened underneath them by the time this line runs, and
  // an agentic_say in that turn writes to the coordinator persona's inbox
  // under this session's id. sendPluginRecord and the agentic_say handler
  // each read the highest sequence and then write under the same writer
  // id, so the two could take one sequence number and one would overwrite
  // the other's record. Skipping leaves the settle step, the routing and
  // the review to the next quiet tick, which costs one tick and loses
  // nothing.
  if (sess.state.monitor.selfReview && !turnIsOpen()) {
    const sr = sess.state.monitor.selfReview;
    const now = Date.now();

    // Lines for the [KAIZEN] thread message, which carries only the
    // findings that have no coordinator persona to reach. Each line is
    // made safe by kaizenLine. No line names a node id.
    const announced: string[] = [];
    const announce = (line: string, signal: string): void => {
      announced.push(kaizenLine(`${line} (${signal})`));
    };
    // A finding's text below its [FINDING] line, for an announcement made
    // from a ledger entry.
    const findingBody = (text: string): string => text.split(LINE_TERMINATOR).slice(1).join(" ") || text;

    // Sends one finding to the coordinator persona as a [FINDING] record
    // and enters it in the ledger, or, given `resend`, sends that entry's
    // text again and replaces its writer and seq while keeping its sentAt.
    // A session on the default persona, a write the reach rule refuses,
    // and a store that throws have no road: the finding is logged as
    // finding_unroutable, announced on this persona's own thread, and
    // entered as delivered with an empty writer and a seq of 0, so it is
    // never read back or retried and still starts the cool-off. A resend
    // takes the open-turn reading once more right before its write, as
    // the proposal resend does, and a turn open by then leaves the entry
    // untouched for the next quiet tick. Returns the record id, or null
    // on the unroutable path and on a resend left for a later tick.
    const sendFinding = async (signal: string, text: string, announceLine: string, resend?: SentFinding): Promise<string | null> => {
      let problem: string;
      try {
        if (sess.persona === "default") {
          problem = "the session is on the default persona, which has no road to a coordinator persona";
        } else if (!await mayReachPersona(ctx.commonsStore(), coordinatorPersona, sess.mySessionId, coordinatorPersona, architectPersona, sess.staleAfterMs)) {
          problem = `the reach rule refuses this session's write to '${coordinatorPersona}'`;
        } else {
          // A turn can have opened under the settle step's record read and
          // the reach check, and an agentic_say in it takes the highest
          // sequence under this session's id exactly as the write below does.
          if (resend && turnIsOpen()) return null;
          const sent = await sendPluginRecord(ctx.commonsStore(), coordinatorPersona, sess.mySessionId, text);
          if (resend) {
            resend.writer = sent.writer;
            resend.seq = sent.seq;
          } else {
            sr.sent.push({ signal, text, sentAt: now, writer: sent.writer, seq: sent.seq, delivered: false });
          }
          sess.state.decisions.push({
            timestamp: now,
            loop: "monitor",
            action: "finding_sent",
            detail: `${signal}: record ${sent.id} to '${coordinatorPersona}'${resend ? " (sent again, the earlier record was skipped)" : ""}`,
          });
          return sent.id;
        }
      } catch (err) {
        problem = `the write to '${coordinatorPersona}' failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (resend) {
        resend.writer = "";
        resend.seq = 0;
        resend.delivered = true;
      } else {
        sr.sent.push({ signal, text, sentAt: now, writer: "", seq: 0, delivered: true });
      }
      sess.state.decisions.push({
        timestamp: now,
        loop: "monitor",
        action: "finding_unroutable",
        detail: `${signal}: ${problem}; announced on this persona's own thread`,
      });
      announce(announceLine, signal);
      return null;
    };

    // The settle step, on every tick that reaches this block and not only
    // on one where a review is due: a persona with little to do takes few
    // turns, and a lost record would otherwise go unnoticed for days. Each
    // entry not yet delivered is read back. A record that reads delivered,
    // answered or resolved settles the entry, and so does an absent one,
    // since a pending record is never swept and an absent record has
    // therefore already left pending. A record that was skipped and then
    // swept before this tick also reads absent and is not sent again,
    // which the plan accepts: it needs the finder down for longer than the
    // record survives. A skipped record is sent again. A
    // record still pending FINDING_UNROUTABLE_AFTER_MS after the send has
    // no coordinator persona to take it: the finding is announced here and
    // the record is left in the store.
    const ledgerBefore = JSON.stringify(sr.sent);
    for (const entry of sr.sent) {
      if (entry.delivered) continue;
      const rec = await readInboxRecord(ctx.commonsStore(), coordinatorPersona, entry.writer, entry.seq);
      if (rec === null || rec.status === "delivered" || rec.status === "answered" || rec.status === "resolved") {
        entry.delivered = true;
      } else if (rec.status === "skipped") {
        await sendFinding(entry.signal, entry.text, findingBody(entry.text), entry);
      } else if (now - entry.sentAt >= FINDING_UNROUTABLE_AFTER_MS) {
        entry.delivered = true;
        sess.state.decisions.push({
          timestamp: now,
          loop: "monitor",
          action: "finding_unroutable",
          detail: `${entry.signal}: record ${rec.id} to '${coordinatorPersona}' still pending after ${Math.round(FINDING_UNROUTABLE_AFTER_MS / 3_600_000)}h; announced on this persona's own thread, record left in the store`,
        });
        announce(findingBody(entry.text), entry.signal);
      }
    }
    // A delivered entry past the cool-off is dropped to keep the list
    // short, except where it is its signal's latest: the review counts only
    // the events after a signal's latest sentAt, so that entry is kept.
    // The list holds at most one such entry per signal, plus the entries
    // still inside the cool-off. Two entries with one sentAt are ordered
    // by their place in the list, the later one counting as later.
    sr.sent = sr.sent.filter((e, i) => !(e.delivered && now - e.sentAt > FINDING_COOLOFF_MS
      && sr.sent.some((later, j) => later.signal === e.signal
        && (later.sentAt > e.sentAt || (later.sentAt === e.sentAt && j > i)))));

    // A goal node an earlier self-review wrote, still open, is sent as a
    // finding and abandoned, so the signal is in the ledger before the
    // review below reads it and the node never holds the active slot.
    let routedAny = false;
    for (const node of sess.state.goals) {
      if (typeof node.kaizenSignal !== "string") continue;
      if (node.status !== "pending" && node.status !== "active" && node.status !== "paused" && node.status !== "blocked") continue;
      const signal = node.kaizenSignal;
      const wasActive = node.status === "active" || sess.state.activeGoalId === node.id;
      // The node is closed before the send is awaited, so a tick that
      // overlaps this one finds it abandoned and does not route it again.
      node.status = "abandoned";
      node.updatedAt = now;
      if (sess.state.activeGoalId === node.id) sess.state.activeGoalId = null;
      const recordId = await sendFinding(signal, `[FINDING] ${sess.persona} ${signal}\n${node.objective}`, node.objective);
      node.notes = [...(node.notes ?? []), recordId !== null
        ? `Sent to the '${coordinatorPersona}' persona as finding record ${recordId}.`
        : "The finding was announced on this persona's own thread."];
      sess.state.decisions.push({
        timestamp: now,
        loop: "goal",
        action: "kaizen_node_routed",
        detail: `${node.id} -> ${recordId ?? "announced on this persona's own thread"}`,
      });
      if (wasActive) {
        const nextId = activateNext(sess.state);
        ctx.activate(nextId, `${node.id} routed as a finding`);
      }
      routedAny = true;
    }
    if (routedAny || JSON.stringify(sr.sent) !== ledgerBefore) {
      sess.state.updatedAt = now;
      await ctx.persist();
    }

    // S10: reset the hourly cap when the window has expired.
    if (sr.windowStart > 0 && now - sr.windowStart >= 3600000) {
      sr.count = 0;
      sr.windowStart = now;
    }

    const srOpts = { selfReviewStreak, selfReviewEveryTurns: ctx.selfReviewEveryTurns(), selfReviewDebounceTurns, selfReviewMaxPerHour };
    // Reactive check (error streak trigger).
    const reactive = shouldSelfReview(
      { monitor: sess.state.monitor, decisions: sess.state.decisions, memory: sess.state.memory, goals: sess.state.goals, activeGoalId: sess.state.activeGoalId },
      srOpts, now, "reactive",
    );
    // Periodic check (pendingPeriodic or turnsSince >= everyTurns).
    const periodic = shouldSelfReview(
      { monitor: sess.state.monitor, decisions: sess.state.decisions, memory: sess.state.memory, goals: sess.state.goals, activeGoalId: sess.state.activeGoalId },
      srOpts, now, "periodic",
    );

    if (reactive.eligible || periodic.eligible) {
      const trigger = reactive.eligible ? reactive.reason : periodic.reason;
      // Stamp the attempt before the first await. The clock timer does not
      // await the tick, so a tick that overlaps a slow review must read it
      // as spent, and a review that throws is spent exactly as one that
      // succeeds: the debounce and the hourly cap bound both.
      const owedPeriodic = sr.pendingPeriodic;
      sr.count += 1;
      if (sr.windowStart === 0) sr.windowStart = now;
      sr.lastAt = now;
      sr.turnsSince = 0;
      sr.pendingPeriodic = false;
      try {
        // Plan item 8.4: before asking the model for a lesson, read the
        // worker's own record mechanically. A repeated weakness becomes a
        // finding sent to the coordinator persona, and where the loop can
        // answer it by changing its own configuration, that change is
        // applied here as well. When a finding is made the review is spent
        // on it and no model lesson is written: a finding about the
        // worker's own record is exactly the class item 8.2 keeps out of
        // memory. A finding writes no goal node and leaves activeGoalId
        // alone.
        const inboxForReview = sess.isOwner ? await listInboxRecords(ctx.commonsStore(), sess.persona) : [];
        const findings = reviewOwnRecord(
          { decisions: sess.state.decisions, memory: sess.state.memory, inbox: inboxForReview, sent: sr.sent.map((e) => ({ signal: e.signal, sentAt: e.sentAt })) },
          { selfReviewEveryTurns: ctx.selfReviewEveryTurns(), selfReviewDebounceTurns, now },
        );
        for (const f of findings) {
          if (f.configFix) {
            ctx.setSelfReviewEveryTurns(f.configFix.to);
            sess.state.decisions.push({
              timestamp: now,
              loop: "monitor",
              action: "kaizen_config_adjusted",
              detail: `${f.signal} x${f.count}: ${f.configFix.knob} ${f.configFix.from} -> ${f.configFix.to}`,
            });
          }
          const text = `[FINDING] ${sess.persona} ${f.signal} x${f.count}\n${f.configFix ? f.rationale : f.objective}`;
          await sendFinding(f.signal, text, f.rationale);
        }
        if (findings.length > 0) {
          sess.state.decisions.push({
            timestamp: now,
            loop: "monitor",
            action: "self-review",
            detail: `${trigger}: own record -> ${findings.length} finding(s), no lesson`,
          });
          sess.state.updatedAt = now;
          await ctx.persist();
        }
        if (findings.length === 0) {
          const input = buildSelfReviewInput(
            { monitor: sess.state.monitor, decisions: sess.state.decisions, memory: sess.state.memory, goals: sess.state.goals, activeGoalId: sess.state.activeGoalId },
            now,
          );
          const raw = await ctx.completeSelfReview(input.prompt);
          // D1: increment self-review ledger
          sess.state.monitor.cost.selfReview.count += 1;
          sess.state.monitor.cost.selfReview.estTokens += estimateTokens(input.prompt.length, 80);
          const lessonText = completionText(raw);
          if (lessonText === null) {
            // The result carried no text: the catch below writes the
            // site's own error decision naming the shape, and no lesson
            // is written. The attempt is already stamped, so the debounce
            // bounds the retry as it does for any other throw here.
            throw new Error(`review returned no text ${completionShape(raw)}`);
          }
          const lesson = lessonText.trim();
          if (lesson.length > 0 && lesson.toUpperCase() !== "NONE") {
            // Item 8.2: a memory entry comes from a proof passing or an
            // operator correction, never from the classifier scoring its
            // own confusion. Refuse the latter before the dedupe check.
            if (isSelfScoringLesson(lesson)) {
              sess.state.decisions.push({
                timestamp: Date.now(),
                loop: "memory",
                action: "memory_lesson_refused",
                detail: `self-scoring lesson refused: ${lesson.slice(0, 80)}`,
              });
            } else if (!dedupeSelfReview(sess.state.memory, lesson)) {
              const entryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              sess.state.memory.push({
                id: entryId,
                kind: "lesson",
                text: lesson,
                confidence: 0.5,
                source: "self-review",
                createdAt: Date.now(),
                lastAccessed: Date.now(),
                accessCount: 0,
                pinned: false,
                provenance: {
                  decisionTimestamps: input.decisionTimestamps,
                  windowRange: input.decisionTimestamps.length > 0
                    ? [input.decisionTimestamps[0], input.decisionTimestamps[input.decisionTimestamps.length - 1]]
                    : undefined,
                  streak: input.streak,
                  trigger: trigger,
                },
              });
              // Evict old self-review lessons (S8: keep max 5, never touch pinned).
              evictSelfReview(sess.state.memory, 5);
              sess.state.decisions.push({
                timestamp: Date.now(),
                loop: "monitor",
                action: "self-review",
                detail: `${trigger}: ${lesson.slice(0, 80)}`,
              });
            } else {
              sess.state.decisions.push({
                timestamp: Date.now(),
                loop: "monitor",
                action: "self-review",
                detail: `${trigger}: dupe, skipped`,
              });
            }
          } else {
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "monitor",
              action: "self-review",
              detail: `${trigger}: NONE`,
            });
          }
        }
      } catch (err) {
        // Self-review failed; non-fatal. The attempt is already stamped, so
        // the debounce and the hourly cap bound the retry. The decision
        // names the error on one line, so the next failure says what threw.
        let message = "";
        try {
          message = safeErrorText(err);
        } catch {
          // A thrown value whose conversion itself throws.
        }
        if (message === "" && err instanceof Error) {
          try {
            message = bracketSafeText(String(err.name));
          } catch {
            // An Error whose name itself throws.
          }
        }
        const foldedMessage = message.split(LINE_TERMINATOR).join(" ").slice(0, 200) || "unprintable error";
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "self-review",
          detail: `${trigger}: error: ${foldedMessage}`,
        });
        // A failed attempt did not serve the goal_done review it was owed,
        // so that request stays set and is retried once the debounce
        // admits it. A failed reactive-only review sets nothing.
        if (owedPeriodic) sr.pendingPeriodic = true;
      }
      sess.state.updatedAt = now;
      await ctx.persist();
    }

    if (announced.length > 0) await ctx.submitKaizen(expectedTurns, announced);
  }

  // 2b. Git probe (E4, C6): time-based cadence, fire-and-forget.
  if (!ctx.gitProbeInFlight() && !ctx.gitUnavailable()) {
    const env = sess.state.monitor.env;
    const now = Date.now();
    const gitProbeMs = sess.options.gitProbeMs ?? 120000;
    if (env.git === null || now - env.git.sampledAt >= gitProbeMs) {
      ctx.setGitProbeInFlight(true);
      ctx.runChild(["git", "status", "--porcelain=v1", "-b"])
        .then((res) => {
          if (res.exitCode === 0) {
            const lines = (res.stdout || "").split("\n").filter((l) => l.trim());
            const branchLine = lines.find((l) => l.startsWith("## "));
            const branch = branchLine ? branchLine.slice(3).split(" ")[0] : "unknown";
            const dirty = lines.filter((l) => !l.startsWith("## ") && l.trim()).length;
            let ahead = 0;
            let behind = 0;
            // Parse ahead/behind from the branch line if present.
            if (branchLine) {
              const aheadMatch = branchLine.match(/ahead (\d+)/);
              const behindMatch = branchLine.match(/behind (\d+)/);
              if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
              if (behindMatch) behind = parseInt(behindMatch[1], 10);
            }
            return ctx.runChild(["git", "log", "-1", "--format=%ct"]).then((logRes) => {
              const lastCommitAt = logRes.exitCode === 0 ? parseInt((logRes.stdout || "0").trim(), 10) * 1000 : 0;
              const newGit: EnvGit = { branch, dirty, ahead, behind, lastCommitAt, sampledAt: Date.now() };
              const prevGit = env.git;
              if (prevGit === null || prevGit.dirty !== dirty || prevGit.branch !== branch) {
                const detail = prevGit === null
                  ? `env_git first sample dirty=${dirty} branch ${branch}`
                  : `env_git dirty=${dirty} (was ${prevGit.dirty}) branch ${branch}`;
                sess.state.decisions.push({
                  timestamp: Date.now(),
                  loop: "monitor",
                  action: "env_git",
                  detail,
                });
              }
              sess.state.monitor.env.git = newGit;
            });
          } else if (res.exitCode === 128) {
            // F7: non-git cwd confirmed; stop probing for the session.
            if (!ctx.gitUnavailable()) {
              ctx.setGitUnavailable(true);
              sess.state.decisions.push({
                timestamp: Date.now(),
                loop: "monitor",
                action: "env_git_null",
                detail: `env_git_null exit 128`,
              });
            }
          } else {
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "monitor",
              action: "env_git_error",
              detail: `env_git_error exit ${res.exitCode}`,
            });
          }
        })
        .catch(() => { /* non-fatal */ })
        .finally(() => { ctx.setGitProbeInFlight(false); });
    }
  }

  // 2c. The plan record settle step, for the [PROPOSAL] and [STARTED]
  // records goal_add sent. It sits ahead of every step that can end the
  // tick on the tree, so it runs on each quiet owner tick whether or not an
  // entry is active: a [STARTED] plan is usually the active entry, and the
  // idle proposal's settle step in 4a never runs while one is. The
  // coordinator persona and the default persona are skipped, as 4a skips
  // them. The open-turn reading is taken again here, since the awaits
  // above leave room for a turn to open, and an agentic_say in it and a
  // resend below each take the highest inbox sequence under this
  // session's id.
  //
  // An entry whose goal entry no longer needs it leaves the ledger unread:
  // a [PROPOSAL] once its node is gone or no longer carries awaitingYes,
  // and a [STARTED] once its node is gone, complete or abandoned. Any
  // other entry's record is read back. One that reads delivered, answered,
  // resolved or absent settles the entry, which leaves the ledger. One
  // that reads skipped is sent again with the same text under this
  // session, taking the new writer and seq and counting one more resend.
  // One that reads skipped after PLAN_RECORD_MAX_RESENDS resends, and a
  // resend the reach rule refuses, have no road: the entry leaves the
  // ledger, plan_record_unroutable is logged, and the record's text is
  // announced on this persona's own thread through the [KAIZEN] frame. A
  // resend whose reach check or store write throws leaves the entry for
  // the next quiet tick. A turn open by the time a resend would write
  // stops the step: what it settled so far is still saved and announced,
  // and the tick then ends, as step 4a ends on a turn it finds open.
  if (sess.persona !== coordinatorPersona && sess.persona !== "default"
    && sess.state.monitor.planRecords.length > 0 && !turnIsOpen()) {
    const ledger = sess.state.monitor.planRecords;
    const planRecordNow = Date.now();
    const unroutableLines: string[] = [];
    let planRecordsChanged = false;
    let turnOpenedUnderStep = false;
    const settle = (entry: SentPlanRecord): void => {
      const at = ledger.indexOf(entry);
      if (at !== -1) ledger.splice(at, 1);
      planRecordsChanged = true;
    };
    // Settles an entry that has no road left, logs why, and queues its
    // text for the [KAIZEN] announcement.
    const settleUnroutable = (entry: SentPlanRecord, recordId: string, why: string): void => {
      settle(entry);
      unroutableLines.push(kaizenLine(entry.text));
      sess.state.decisions.push({
        timestamp: planRecordNow,
        loop: "monitor",
        action: "plan_record_unroutable",
        detail: `${entry.nodeId}: record ${recordId} to '${coordinatorPersona}' ${why}; announced on this persona's own thread`,
      });
    };
    for (const entry of [...ledger]) {
      const node = sess.state.goals.find((g) => g.id === entry.nodeId);
      const needed = !!node && (entry.awaitingYes
        ? node.awaitingYes === true
        : node.status !== "complete" && node.status !== "abandoned");
      if (!needed) {
        settle(entry);
        continue;
      }
      const rec = await readInboxRecord(ctx.commonsStore(), coordinatorPersona, entry.writer, entry.seq);
      if (rec === null || rec.status === "delivered" || rec.status === "answered" || rec.status === "resolved") {
        settle(entry);
        continue;
      }
      if (rec.status !== "skipped") continue;
      if (entry.resends >= PLAN_RECORD_MAX_RESENDS) {
        settleUnroutable(entry, rec.id, `was skipped after ${entry.resends} resends and is not sent again`);
        continue;
      }
      try {
        if (!await mayReachPersona(ctx.commonsStore(), coordinatorPersona, sess.mySessionId, coordinatorPersona, architectPersona, sess.staleAfterMs)) {
          settleUnroutable(entry, rec.id, `was skipped and is not sent again: the reach rule refuses this session's write to '${coordinatorPersona}'`);
          continue;
        }
        // Taken once more, since a turn can have opened under the record
        // read and the reach check.
        if (turnIsOpen()) {
          turnOpenedUnderStep = true;
          break;
        }
        const again = await sendPluginRecord(ctx.commonsStore(), coordinatorPersona, sess.mySessionId, entry.text);
        entry.writer = again.writer;
        entry.seq = again.seq;
        entry.resends += 1;
        planRecordsChanged = true;
        sess.state.decisions.push({
          timestamp: planRecordNow,
          loop: "monitor",
          action: "plan_record_resent",
          detail: `${entry.nodeId}: record ${again.id} to '${coordinatorPersona}' (sent again, the earlier record ${rec.id} was skipped)`,
        });
      } catch (err) {
        planRecordsChanged = true;
        sess.state.decisions.push({
          timestamp: planRecordNow,
          loop: "monitor",
          action: "plan_record_resend_failed",
          detail: `${entry.nodeId}: record ${rec.id} to '${coordinatorPersona}' was skipped and not sent again: ${safeErrorText(err)}`.slice(0, 200),
        });
      }
    }
    // The ledger is written before the announcement is submitted, since
    // the submit does not resolve until the session is next idle. A save
    // that throws still lets the announcement go out, and the settled
    // ledger waits in memory for the next save.
    if (planRecordsChanged) {
      try { await ctx.persist(); } catch { /* the store refused; the ledger above waits in memory */ }
    }
    if (unroutableLines.length > 0) await ctx.submitKaizen(expectedTurns, unroutableLines);
    if (turnOpenedUnderStep) return;
  }

  // Get the active node.
  const activeNode = sess.state.activeGoalId
    ? sess.state.goals.find((g) => g.id === sess.state.activeGoalId)
    : null;
  const root = sess.state.goals.find((g) => g.parentId === null);

  // 3a. A finished root completes with no planner call: every descendant
  // is complete or abandoned, at least one is complete, and the planner
  // has never broken the root down (isRootFinished). isPlanningDue reads
  // false for such a root, so this is read first and consumes the tick.
  // It waits while a planner call is in flight: a tree edited into the
  // finished shape during that call takes the call's own outcome, and a
  // root completed under it would receive the call's plans.
  if (isRootFinished(sess.state) && !ctx.planningInFlight()) {
    await ctx.completeRootUnplanned(root!.id);
    await ctx.persist();
    return;
  }

  // 3. Planning gate (R1, R5): planning runs here, NOT in a tool handler.
  // Due when root exists, not complete/abandoned, no
  // pending/active/paused descendants, and the root is not finished.
  // M8: reentrancy guard: a planner call slower than one tick must not fire twice.
  if (isPlanningDue(sess.state) && !ctx.planningInFlight()) {
    ctx.setPlanningInFlight(true);
    // M13: a failing planner is capped. Each call, shape or parse failure,
    // and any throw inside the gate, increments the root counter and
    // persists; at 3 the root is blocked so the planner is not retried
    // every tick. A successful planning round (created or complete) resets
    // it. Declared above the gate's try so its catch can reach it: a
    // register the catch could not call was how a throw after the model
    // call looped one Haiku call per tick without ever counting.
    // planningSettled is set once this attempt has counted, one way or
    // the other: a failure registered, a round created or completed, or
    // a reply discarded. The gate's catch registers a throw only where it
    // is still false, so a persist that throws after the count neither
    // counts the attempt twice nor turns a created round into a failure.
    let planningSettled = false;
    const registerPlanningFailure = async (rootId: string, detail: string): Promise<void> => {
      planningSettled = true;
      const rootNow = sess.state.goals.find((g) => g.id === rootId);
      if (rootNow) {
        rootNow.consecutivePlanningFailures = (rootNow.consecutivePlanningFailures || 0) + 1;
      }
      const failCount = rootNow?.consecutivePlanningFailures || 0;
      sess.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "planning_failed",
        detail,
      });
      if (rootNow && failCount >= 3 && rootNow.status !== "blocked") {
        rootNow.status = "blocked";
        rootNow.blockedReason = `Planner failing: ${detail}`;
        rootNow.updatedAt = Date.now();
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "block",
          detail: `Root ${rootNow.id}: Planner failing after ${failCount} consecutive failures`,
        });
        try { ctx.toast(`Agentic: root blocked: planner failing`); } catch { /* non-fatal */ }
        try { ctx.status(""); } catch { /* non-fatal */ }
      }
      await ctx.persist();
    };
    try {
      const planTs = Date.now();
      sess.state.decisions.push({
        timestamp: planTs,
        loop: "goal",
        action: "planning_fired",
        detail: `Root ${root!.id} has no pending/active/paused descendants; planning`,
      });

      // H5 / M15: cap check BEFORE the model call.
      // The blocked-planning streak is evaluated over the PREVIOUS planning
      // round's plans only (planningRound === planningRounds - 1), never
      // over every node the root has ever produced. A completed plan from an
      // earlier round therefore cannot mask two consecutive all-blocked
      // rounds, and a stale blocked node cannot mask a fresh round.
      const prevBlocked = previousRoundBlocked(root!, sess.state.goals);
      if (prevBlocked) {
        root!.consecutiveBlockedPlannings = (root!.consecutiveBlockedPlannings || 0) + 1;
      } else {
        root!.consecutiveBlockedPlannings = 0;
      }
      const capReason = planningCapReached(root!, root!.consecutiveBlockedPlannings);
      if (capReason) {
        root!.status = "blocked";
        root!.blockedReason = capReason;
        root!.updatedAt = Date.now();
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "block",
          detail: `Root ${root!.id}: ${capReason}`,
        });
        try { ctx.toast(`Agentic: root blocked: planning cap reached`); } catch { /* non-fatal */ }
        try { ctx.status(""); } catch { /* non-fatal */ }
        await ctx.persist();
        return;
      }

      // R2: re-read the roadmap file at every planning event.
      let roadmapText = "";
      const rp = root!.roadmapPath;
      if (rp) {
        try {
          if (await ctx.fsExists(rp)) {
            roadmapText = await ctx.fsRead(rp);
          }
        } catch { /* roadmap unreadable; planner gets empty text */ }
      }

      // Planning call: Haiku complete, JSON array of plans.
      // H3-part2: carry history and a cap in the prompt.
      const completedPlans = sess.state.goals.filter((g) => g.parentId === root!.id && g.status === "complete");
      const blockedPlans = sess.state.goals.filter((g) => g.parentId === root!.id && g.status === "blocked");
      const abandonedPlans = sess.state.goals.filter((g) => g.parentId === root!.id && g.status === "abandoned");
      const historyLines: string[] = [];
      for (const cp of completedPlans) {
        const lastNote = cp.notes.length > 0 ? cp.notes[cp.notes.length - 1] : "no note";
        historyLines.push(`Completed: ${cp.title}: ${lastNote}`);
      }
      for (const bp of blockedPlans) {
        historyLines.push(`Blocked: ${bp.title}: ${bp.blockedReason || "unknown"}`);
      }
      for (const ap of abandonedPlans) {
        historyLines.push(`Abandoned: ${ap.title}`);
      }
      const historyBlock = historyLines.length > 0 ? `\n${historyLines.join("\n")}\n\n` : "";
      const planPrompt =
        `You are the planner for an agentic plugin. ` +
        `The operator's objective is: "${root!.objective}".\n\n` +
        (roadmapText
          ? `Roadmap file content:\n${roadmapText}\n\n`
          : "") +
        historyBlock +
        `Create a plan of 0 to 7 steps to accomplish the objective.\n` +
        (roadmapText
          ? `When a roadmap is provided, produce exactly one plan per numbered roadmap item.\n`
          : "") +
        `Return a JSON array. Each element: {"title": string, "objective": string, "maxRounds": number (5-20)}.\n` +
        `Return [] (empty array) if the objective and roadmap are fully met by the completed items.\n` +
        `Never repeat a completed item. A blocked item may be retried at most once with a different approach.\n` +
        `Return a JSON array only: no prose, no markdown fences.`;

      // H4 / M14: planner fault injection via a single cwd-relative file
      // flag, beside the store path (which also resolves cwd-relative).
      // A file named .agentic-planner-fault makes the planner return "not
      // json" so parsing fails. The test runs with cwd = harness root, the
      // same cwd the store resolves against, so the flag belongs there.
      let fault = false;
      try { if (await ctx.fsExists(".agentic-planner-fault")) { fault = true; } } catch { /* non-fatal */ }

      // H4: AGENTIC_PLANNER_FAULT file flag replaces the raw response with "not json".
      let rawResult: unknown;
      try {
        rawResult = await ctx.completePlanner(planPrompt);
        // D1: increment planner ledger
        sess.state.monitor.cost.planner.count += 1;
        sess.state.monitor.cost.planner.estTokens += estimateTokens(planPrompt.length, 1500);
      } catch (e) {
        await registerPlanningFailure(root!.id, `Planner call failed: ${String(e).slice(0, 150)}`);
        return;
      }
      // The root may have closed while the call was out: goal_done on the
      // root, in an operator turn, completes exactly the tree the planner
      // is due for. A round for a root no longer open is dropped whole,
      // so no plan node lands under a complete root.
      const rootAfterCall = sess.state.goals.find((g) => g.id === root!.id);
      if (!rootAfterCall || rootAfterCall.status === "complete" || rootAfterCall.status === "abandoned") {
        planningSettled = true;
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "planning_discarded",
          detail: `Root ${root!.id} is ${rootAfterCall ? rootAfterCall.status : "gone"} since the planner call went out; its reply is dropped`,
        });
        await ctx.persist();
        return;
      }
      // The result is read through the one reader before any parse. A
      // result with no text is a failure the counter sees, named by its
      // shape, so an engine that changes the result's shape again blocks
      // the root after three ticks rather than looping on every one.
      const rawText = completionText(rawResult);
      if (rawText === null) {
        await registerPlanningFailure(root!.id, `Planner returned no text ${completionShape(rawResult)}`);
        return;
      }
      let raw: string = rawText;
      if (fault) {
        raw = "not json";
      }

      // H4: parsed flag set only when JSON.parse returns an array.
      let plans: Array<{ title: string; objective: string }> = [];
      let parsedOk = false;
      try {
        const trimmed = raw.trim().replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          plans = parsed
            .filter((p) => p && typeof p.title === "string" && typeof p.objective === "string")
            .slice(0, 7);
          parsedOk = true;
        }
      } catch { /* parse failed */ }

      if (!parsedOk) {
        // H4: parse failure is not "objective met".
        await registerPlanningFailure(root!.id, `Planner parse failure: ${raw.slice(0, 100)}`);
        return;
      }

      if (plans.length === 0) {
        // Objective met or nothing to plan: complete the root.
        const rootNow = sess.state.goals.find((g) => g.id === root!.id);
        // M13: a successful planning round clears the failure streak.
        if (rootNow) rootNow.consecutivePlanningFailures = 0;
        planningSettled = true;
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "planning_complete",
          detail: `Planner returned 0 plans`,
        });
        await ctx.completeRootZeroPlans(root!.id);
      } else {
        // Create plan nodes under the root.
        // L9: per-plan maxRounds from the planner, defaulting to root.maxRounds.
        // H3-part2: increment planningRounds on the root.
        for (const p of plans) {
          const perPlanMaxRounds = typeof (p as any).maxRounds === "number"
            ? Math.min(Math.max((p as any).maxRounds, 5), 20)
            : (root!.maxRounds > 0 ? root!.maxRounds : 10);
          const node: GoalNode = {
            id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            parentId: root!.id,
            kind: "plan",
            title: p.title.slice(0, 80),
            objective: p.objective.slice(0, 500),
            status: "pending",
            source: "controller",
            maxRounds: perPlanMaxRounds,
            completedRounds: 0,
            scores: [],
            notes: [],
            planningRounds: 0,
            consecutiveBlockedPlannings: 0,
            consecutivePlanningFailures: 0,
            planningRound: root!.planningRounds || 0, // M15: which round created this plan
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          sess.state.goals.push(node);
        }
        // H3-part2: count this planning round on the root.
        root!.planningRounds = (root!.planningRounds || 0) + 1;
        // M13: a successful planning round clears the failure streak.
        root!.consecutivePlanningFailures = 0;
        planningSettled = true;

        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "planning_created",
          detail: `${plans.length} plans under root ${root!.id}: ${plans.map((p) => p.title.slice(0, 30)).join("; ")}`,
        });

        // BM2: Check planner variance (flag, not trim)
        if (roadmapText) {
          // Count numbered items in the roadmap
          const numberedItems = roadmapText.match(/^\d+\./gm) || [];
          const roadmapCount = numberedItems.length;
          if (plans.length !== roadmapCount) {
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "goal",
              action: "planner_variance",
              detail: `planner ${plans.length}, roadmap ${roadmapCount}`,
            });
          }
        }

        // Activate the first plan.
        const firstPlan = sess.state.goals.find((g) => g.parentId === root!.id && g.status === "pending");
        if (firstPlan) {
          firstPlan.status = "active";
          firstPlan.updatedAt = Date.now();
          sess.state.activeGoalId = firstPlan.id;
          ctx.activate(firstPlan.id, `Plan ${firstPlan.id} "${firstPlan.title}" activated`);
        }
      }

      await ctx.persist();
    } catch (err) {
      // A throw anywhere in the gate before the attempt has counted is a
      // planning failure the counter sees, so three block the root. No
      // second wrap: a register whose own persist throws has nothing left
      // to write, and the throw reaches the tick's own catch as any other
      // does. A throw after the count (a persist failing) is not counted
      // again.
      if (!planningSettled) {
        await registerPlanningFailure(root!.id, `Planner threw: ${safeErrorText(err)}`);
      }
    } finally {
      ctx.setPlanningInFlight(false);
    }
    return; // Planning gate consumed this tick.
  }

  // 4. No active leaf: activate pending work if any exists (H1), else return.
  if (!activeNode || activeNode.status !== "active") {
    const askResult = await ctx.tickOpenAsk(sess.state, sess.persona, cfg, null, expectedTurns);
    if (askResult !== "none") return;
    const nextId = activateNext(sess.state);
    if (nextId) {
      ctx.activate(nextId, "no active leaf, pending work found");
      await ctx.persist();
      return;
    }

    // 4a. The idle proposal. A persona that holds a long-term goal and
    // has nothing the controller will start is asked, at most once per
    // PROPOSAL_EVERY_MS, for the single next piece of work toward one of
    // its goals, which it sends to the coordinator persona as a
    // [PROPOSAL] record and does not start. The coordinator persona is
    // never asked, since a session cannot message the persona it owns. A
    // session on the default persona is never asked either: it has no
    // road to a coordinator persona, and it is refused here as the
    // finding path refuses it, so it is not asked every day for a message
    // it cannot send. A reader session never reaches this line: the
    // tick's owner check returns first.
    if (sess.persona === coordinatorPersona || sess.persona === "default") return;
    // The open-turn reading is taken again here rather than trusted from
    // the top of the tick, as the self-review block does before its settle
    // step. The awaits above leave room for a turn to open, and an
    // agentic_say in it and a resend below each read the highest sequence
    // and then write under this session's id, so the two could take one
    // sequence number. The settle and the ask wait for the next quiet tick.
    if (turnIsOpen()) return;
    const proposal = sess.state.monitor.proposal;
    const proposalNow = Date.now();
    let proposalChanged = false;

    // The settle step for the proposal the persona sent, on every tick
    // that reaches this line and ahead of the interval check. It reads the
    // record back as the findings ledger's settle step does, without the
    // 24-hour rule: a record that reads delivered, answered, resolved or
    // absent settles the entry, and one that reads skipped is sent again
    // with the same text under this session, taking the new writer and
    // seq. A resend the reach rule refuses has no road, so the entry is
    // settled once in the finding's unroutable form, an empty writer and
    // a seq of 0, proposal_unroutable is logged, and the proposal is
    // announced on this persona's own thread through the [KAIZEN] frame,
    // as an unroutable finding is. A resend whose reach check or store
    // write throws leaves the entry as it was, and the next tick that
    // reaches this line tries again.
    const sentProposal = proposal.sent;
    let unroutableLine: string | null = null;
    if (sentProposal && !sentProposal.delivered) {
      const rec = await readInboxRecord(ctx.commonsStore(), coordinatorPersona, sentProposal.writer, sentProposal.seq);
      if (rec === null || rec.status === "delivered" || rec.status === "answered" || rec.status === "resolved") {
        sentProposal.delivered = true;
        proposalChanged = true;
      } else if (rec.status === "skipped") {
        proposalChanged = true;
        try {
          if (!await mayReachPersona(ctx.commonsStore(), coordinatorPersona, sess.mySessionId, coordinatorPersona, architectPersona, sess.staleAfterMs)) {
            sentProposal.writer = "";
            sentProposal.seq = 0;
            sentProposal.delivered = true;
            unroutableLine = kaizenLine(sentProposal.text);
            sess.state.decisions.push({
              timestamp: proposalNow,
              loop: "monitor",
              action: "proposal_unroutable",
              detail: `record ${rec.id} to '${coordinatorPersona}' was skipped and is not sent again: the reach rule refuses this session's write to '${coordinatorPersona}'; announced on this persona's own thread`,
            });
          } else {
            // The open-turn reading is taken once more, since a turn can
            // have opened under the record read and the reach check. A
            // turn that opens after this line and writes before the resend
            // does is the race docs/backlog.md files under two writers
            // taking one inbox sequence number.
            if (turnIsOpen()) return;
            const again = await sendPluginRecord(ctx.commonsStore(), coordinatorPersona, sess.mySessionId, sentProposal.text);
            sentProposal.writer = again.writer;
            sentProposal.seq = again.seq;
            sess.state.decisions.push({
              timestamp: proposalNow,
              loop: "monitor",
              action: "proposal_sent",
              detail: `record ${again.id} to '${coordinatorPersona}' (sent again, the earlier record was skipped)`,
            });
          }
        } catch (err) {
          // A thrown reach check or store write: the entry is left as it
          // was, so the next tick that reaches this line reads the skipped
          // record and tries again.
          sess.state.decisions.push({
            timestamp: proposalNow,
            loop: "monitor",
            action: "proposal_resend_failed",
            detail: `record ${rec.id} to '${coordinatorPersona}' was skipped and not sent again: ${safeErrorText(err)}`.slice(0, 200),
          });
        }
      }
    }
    // The settled entry is written before the announcement is submitted,
    // since the submit does not resolve until the session is next idle.
    if (unroutableLine !== null) {
      sess.state.updatedAt = Date.now();
      await ctx.persist();
      await ctx.submitKaizen(expectedTurns, [unroutableLine]);
    }

    // The ask. askedAt is stamped before the submit, for the reason the
    // nudge floor is spent first: the prompt submit does not resolve until
    // the session is next idle, so a stamp written after it would leave
    // every tick in between passing the interval and queueing another
    // copy. A submit that fails has still spent the interval, which the
    // proposal_failed record makes visible. The stamp is persisted before
    // the submit as well, so a relaunch while the submit waits does not
    // ask again. The open-turn reading is taken again here rather than
    // trusted from the top of the tick, since a turn can have opened
    // under the awaits above.
    if (sess.state.longTermGoals.length > 0 && !hasStartableWork(sess.state) && !turnIsOpen()
      && proposalNow - proposal.askedAt >= PROPOSAL_EVERY_MS) {
      proposal.askedAt = Date.now();
      const unsettled = proposal.sent;
      if (unsettled && !unsettled.delivered) {
        sess.state.decisions.push({
          timestamp: proposal.askedAt,
          loop: "monitor",
          action: "proposal_dropped",
          detail: `the proposal at writer ${unsettled.writer} seq ${unsettled.seq} to '${coordinatorPersona}' never read delivered and is cleared by the next ask`,
        });
      }
      proposal.sent = null;
      const expectedProposalTurn = ctx.expectProposalTurn();
      sess.state.updatedAt = proposal.askedAt;
      await ctx.persist();
      const proposalOutcome = await ctx.submitProposal(expectedProposalTurn);
      sess.state.decisions.push(proposalOutcome.ok
        ? {
          timestamp: proposalNow,
          loop: "monitor",
          action: "proposal_asked",
          detail: `proposal turn submitted over ${sess.state.longTermGoals.length} long-term goal(s)`,
        }
        : {
          timestamp: proposalNow,
          loop: "monitor",
          action: "proposal_failed",
          detail: `submit ${proposalOutcome.how}, interval already spent: ${proposalOutcome.reason}`.slice(0, 200),
        });
      proposalChanged = true;
    }
    if (proposalChanged) {
      sess.state.updatedAt = Date.now();
      await ctx.persist();
    }
    return;
  }
  const g = activeNode;

  // 5. Idle gate.
  const now = Date.now();
  const idleMs = sess.state.monitor.lastTurnComplete
    ? now - sess.state.monitor.lastTurnComplete
    : now - sess.state.monitor.sessionStart;
  const eligible = idleMs >= nudgeIdleMs;
  if (!eligible) {
    clearAgentHold();
    return;
  }

  // A blocked lead on the active entry whose ask closed after the lead
  // was set, answered by the operator or the coordinator or expired, is
  // cleared before the hold is read: the ask settled what the block
  // waited on, so an answered ask on a BLOCKED: worker lifts the hold.
  if (g.lead && g.lead.state === "blocked"
    && typeof g.lastAskClosedAt === "number" && g.lastAskClosedAt > g.lead.at) {
    g.lead = null;
    g.updatedAt = now;
    sess.state.decisions.push({
      timestamp: now,
      loop: "goal",
      action: "lead_cleared",
      detail: `${g.id}: blocked lead cleared by an ask closed after it was set`,
    });
    if (!(await ctx.persist())) return;
  }

  // The hold: one read of holdOf decides whether this branch nudges. An
  // open blocking ask, a blocked lead or a waiting lead inside its window
  // holds the whole branch, no classifier call and no nudge, and nothing
  // is logged per held tick. An ask hold still runs tickOpenAsk, which
  // records ask_waiting once a minute, re-raises each question once, and
  // lifts an entry's hold at its timeout. Both read the same ledger
  // predicate, so "none" here is a tick on which the hold lifted between
  // the two reads, and the hold is read again since a lead can still
  // hold once the ask is gone.
  let hold = holdOf(sess.state, now);
  if (hold === "ask") {
    const askResult = await ctx.tickOpenAsk(sess.state, sess.persona, cfg, g.id, expectedTurns);
    if (askResult !== "none") {
      clearAgentHold();
      return;
    }
    hold = holdOf(sess.state, now);
  }
  if (hold !== null) {
    clearAgentHold();
    return;
  }

  // The agent hold: any running agent with no parentId on the engine's agent list,
  // whether the worker or a plugin started it, holds the branch as a
  // waiting lead does, on any entry, for as long as the agent runs: no
  // classifier call, no nudge, no completion, nothing spent. It has no
  // time bound, since a nudge into a turn awaiting its own agent is the
  // fault this hold exists to prevent. It is read after holdOf so the host
  // call is made only on a tick that would otherwise go on to nudge. The
  // hold is keyed to the active entry it began on, and its clock is the
  // first held tick's, set before any write. One idle_hold_agent line is
  // logged as it begins, and one idle_hold_agent_held line carrying its
  // age in whole minutes on the first tick at or past each further hour,
  // a tick that crosses several hours writing one line for the latest.
  // Each line's mark is set before its write so an overlapping tick
  // writes nothing, and a write that fails or yields takes back the line
  // and its mark, never the clock, so a later tick retries it. A list
  // that cannot be read is no agent, and the branch goes on as
  // liveTopLevelAgentRunning states.
  if (await ctx.liveTopLevelAgentRunning()) {
    if (ctx.agentHold() === null || ctx.agentHold()!.entryId !== g.id) {
      ctx.setAgentHold({ entryId: g.id, since: now, beginLogged: false, hourLogged: 0 });
    }
    // Non-null: the write above fills the hold where the reads found none.
    const held = ctx.agentHold()!;
    if (!held.beginLogged) {
      held.beginLogged = true;
      const begun: AgentState["decisions"][number] = {
        timestamp: now,
        loop: "goal",
        action: "idle_hold_agent",
        detail: `${g.id}: a running background agent holds the idle branch until it ends`,
      };
      sess.state.decisions.push(begun);
      await ctx.persistOrRollBack(() => {
        dropDecision(begun);
        held.beginLogged = false;
      });
      return;
    }
    const hour = Math.floor((now - held.since) / AGENT_HOLD_REPORT_MS);
    if (hour >= 1 && hour > held.hourLogged) {
      const previousHour = held.hourLogged;
      held.hourLogged = hour;
      const ageMinutes = Math.floor((now - held.since) / 60_000);
      const report: AgentState["decisions"][number] = {
        timestamp: now,
        loop: "goal",
        action: "idle_hold_agent_held",
        detail: `${g.id}: the agent hold has stood ${ageMinutes} minutes with an agent still running`,
      };
      sess.state.decisions.push(report);
      await ctx.persistOrRollBack(() => {
        dropDecision(report);
        if (held.hourLogged === hour) held.hourLogged = previousHour;
      });
    }
    return;
  }
  clearAgentHold();

  // L6: print seconds below one minute, minutes otherwise
  const idleDisplay = idleMs < 60_000 ? `${Math.floor(idleMs / 1000)}s` : `${Math.floor(idleMs / 60_000)}min`;
  const last5 = g.scores.slice(-5).map((s) => s.result).join(", ") || "none";
  const onGoalCount = g.scores.filter((s) => s.result === "on-goal").length;

  // R6: switch is offered on a task entry alone, and only when at least
  // one pending plan exists, since the idle controller never moves a plan
  // entry off the active slot. The state names each pending plan by id
  // and title on its own line.
  const pendingPlans = sess.state.goals.filter((x) => x.kind === "plan" && x.status === "pending");
  const planEntry = isPlanEntry(sess.state, g);
  const hasSwitch = pendingPlans.length > 0 && !planEntry;

  // C7: Environment line only when env.git or env.health is non-null.
  const env = sess.state.monitor.env;
  let envText: string | null = null;
  if (env.git !== null || env.health !== null) {
    const parts: string[] = [];
    if (env.git !== null) {
      parts.push(`git: ${env.git.branch} dirty ${env.git.dirty} ahead ${env.git.ahead} behind ${env.git.behind}`);
    }
    if (env.health !== null) {
      parts.push(`health: exit ${env.health.exitCode} for ${env.health.forNodeId || "no-node"}`);
    }
    envText = parts.join(", ");
  }
  const envLine = envText === null ? "" : `Environment: ${envText}\n`;

  // The ids in force this tick: complete on a task entry alone, since a
  // plan entry's done is read from its plan document, and switch on a task
  // entry alone where a pending plan exists.
  const classifyLabels: readonly string[] = controllerLabelsOf(!planEntry, hasSwitch);

  // The controller's state's inputs, read here in the synchronous region
  // so they are this tick's readings: the facts, the last answer where
  // it was given on this node and none otherwise, and the pending plans.
  // The state itself is built below, once the question is resolved, since
  // its option list carries the resolved descriptions.
  const lastAnswer = sess.lastAnswer !== null && sess.lastAnswer.goalId === g.id ? sess.lastAnswer.text : null;
  const facts: ControllerStateFact[] = [
    ["Objective", g.objective],
    ["Node", `${g.id} (${g.kind}), status ${g.status}, ${roundSummaryText(sess.state, g)}`],
    ["Last 5 scores", last5],
    ["On-goal count", `${onGoalCount} of ${g.scores.length}`],
    ["Idle time", idleDisplay],
    ["Nudged answers with no status line", String(sess.nudgedAnswersWithoutStatus)],
    ["Decisions tail", sess.state.decisions.slice(-5).map((d) => `${d.loop}:${d.action}`).join(", ")],
    ["Memory", `${selfReviewLessonCount()} self-review lessons, ${sess.memqWrittenThisSession} written this session`],
  ];
  {
    const sr = sess.state.memory.filter((m) => m.source === "self-review" && m.kind === "lesson");
    if (sr.length > 0) {
      const newest = sr.sort((a, b) => b.createdAt - a.createdAt)[0];
      facts.push(["LESSON", newest.text.slice(0, 120)]);
    }
  }
  if (envText !== null) facts.push(["Environment", envText]);
  const statePendingPlans = pendingPlans.map((p) => ({ id: p.id, title: p.title }));

  // Fire-and-forget: the timer callback is sync, so we schedule async work.
  Promise.resolve().then(async () => {
    try {
      // Cap check before spending a classify call. A cap whose ask was
      // refused on an earlier tick, with the count still at the cap, the
      // refusal logged for this entry and the open cap still full, logs
      // nothing more and sends no nudge. Once an entry closes and the
      // ledger has room, the cap tries its ask again.
      if (sess.nudgedAnswersWithoutStatus >= MAX_CONSECUTIVE_NUDGES) {
        if (sess.nudgeCapRefusedFor === g.id && openAskEntries(sess.state).length >= ASKS_OPEN_MAX) return;
        const capTs = Date.now();
        const capReason = `${sess.nudgedAnswersWithoutStatus} nudged answers carried no status line`;
        // A retry after a refusal is the same cap episode, which has
        // already logged its cap and toasted.
        if (sess.nudgeCapRefusedFor !== g.id) {
          sess.state.decisions.push({
            timestamp: capTs,
            loop: "monitor",
            action: "nudge_cap_reached",
            detail: `${g.id}: ${capReason}`,
          });
          try { ctx.toast(`Agentic: ${capReason}`); } catch { /* non-fatal */ }
        }
        // The cap holds by opening an ask, the same way the cost cap
        // below does: the entry stays active with no reason written on
        // it, holdOf reads the open ask as the hold, and the ask's
        // close, by an answer or by expiry, is the lift. The ask's
        // question is nudgeCapAskText, which names the persona and the
        // entry for the operator. The count is reset as the ask opens,
        // which serves as the reset at the ask's close: the count rises
        // only at a nudged turn's end, and while the ask is open holdOf
        // holds every nudge, so no nudge is sent in between. Nor is a
        // nudged turn under way as the ask opens: this branch runs only
        // with no turn open, and the count moves only at the completion
        // of a turn whose start recorded a nudged id. So the close finds
        // the count at zero. A count left at the cap would reopen the ask
        // on the tick after the close in place of the nudge the lift
        // promises. The floor is left alone, since the last nudge's
        // spacing still applies.
        //
        // The record is written as the entry opens, and the count is
        // reset only once the write returns: a write that throws undoes
        // the open and leaves the count at the cap, so the cap fires
        // again on a later tick. The cap asks once per entry: while its
        // own question still holds this entry the idle branch returns on
        // that hold above and never reaches this check, so the cap opens
        // no second one. An own question whose hold was lifted is
        // withdrawn and a fresh one opened in its place. A
        // refused open leaves the count at the cap: no question of the
        // cap's own stands, so a reset would send the next tick's nudge
        // as if the cap had asked. The refusal is latched on the entry
        // instead, so the next ticks neither nudge nor log it again.
        let capAskStands = ownAskStands(sess.state, "nudge-cap", g.id);
        if (!capAskStands) {
          const askQuestion = nudgeCapAskText(sess.persona, g.title, sess.nudgedAnswersWithoutStatus);
          await ctx.withdrawLiftedAskBy(sess.state, sess.persona, "nudge-cap", g.id, capTs);
          const opened = await ctx.openLedgerAsk(sess.state, sess.persona, sess.mySessionId, g.id, askQuestion, "", "nudge-cap", true, capTs);
          if (typeof opened === "string") {
            sess.nudgeCapRefusedFor = g.id;
            sess.state.decisions.push({
              timestamp: capTs,
              loop: "monitor",
              action: "ask_cap_refused",
              detail: `${g.id}: nudge-cap ask refused: ${opened === "cap" ? `the open cap of ${ASKS_OPEN_MAX}` : opened}`,
            });
          } else {
            capAskStands = true;
            sess.state.decisions.push({
              timestamp: capTs,
              loop: "monitor",
              action: "ask_opened",
              detail: `${g.id}: nudge-cap: ${capReason} (ask ${opened.id})`,
            });
          }
        }
        if (capAskStands) {
          sess.nudgedAnswersWithoutStatus = 0;
          sess.nudgeCapRefusedFor = null;
        }
        sess.state.updatedAt = capTs;
        await ctx.persist();
        return;
      }

      const tickTs = Date.now();

      // D3: Call cap check. If the call window is latched, skip classify.
      // AK2: emit cost_cap_reached once per window (latched by capNoticeWindowStart).
      if (costEnabled && costMaxPluginCallsPerHour > 0) {
        const callWin = sess.state.monitor.cost.callWindow;
        const callWinCount = effectiveWindowCount(callWin, now);
        if (callWinCount >= costMaxPluginCallsPerHour) {
          if (sess.state.monitor.cost.capNoticeWindowStart !== callWin.start) {
            sess.state.decisions.push({
              timestamp: tickTs,
              loop: "monitor",
              action: "cost_cap_reached",
              detail: `${g.id}: call cap reached (${callWinCount}/${costMaxPluginCallsPerHour} per hour), skipping classify`,
            });
            sess.state.monitor.cost.capNoticeWindowStart = callWin.start;
          }
          sess.state.updatedAt = tickTs;
          await ctx.persist();
          return;
        }
      }

      // AH5: Nudge cap check before classify. If the nudge cap is latched, skip classify entirely.
      // AK2: emit cost_cap_reached once per window (latched by capNoticeWindowStart).
      // The cost-cap ask opens once per nudge window, under the same
      // latch as the notice: the entry stays active with no reason
      // written on it and the open ask is the hold. Once that ask
      // closes inside the window the refusal alone holds, no nudge and
      // no second ask, and a new window that reaches the cap latches
      // afresh and opens one again. The cap asks once per entry: while
      // its own question still holds this entry it opens no second, and
      // an own question whose hold was lifted is withdrawn and replaced.
      const nudgeCapped = costEnabled && costMaxNudgesPerHour > 0 &&
        effectiveWindowCount(sess.state.monitor.cost.nudgeWindow, now) >= costMaxNudgesPerHour;
      if (nudgeCapped) {
        if (sess.state.monitor.cost.capNoticeWindowStart !== sess.state.monitor.cost.nudgeWindow.start) {
          sess.state.decisions.push({
            timestamp: tickTs,
            loop: "monitor",
            action: "cost_cap_reached",
            detail: `${g.id}: nudge cap reached (${effectiveWindowCount(sess.state.monitor.cost.nudgeWindow, now)}/${costMaxNudgesPerHour} per hour), refusing nudge`,
          });
          sess.state.monitor.cost.capNoticeWindowStart = sess.state.monitor.cost.nudgeWindow.start;
          if (!ownAskStands(sess.state, "cost-cap", g.id)) {
            const capReason = `cost-cap: nudge budget spent (${effectiveWindowCount(sess.state.monitor.cost.nudgeWindow, now)}/${costMaxNudgesPerHour} per hour)`;
            await ctx.withdrawLiftedAskBy(sess.state, sess.persona, "cost-cap", g.id, tickTs);
            const opened = await ctx.openLedgerAsk(sess.state, sess.persona, sess.mySessionId, g.id, capReason, "", "cost-cap", true, tickTs);
            if (typeof opened === "string") {
              sess.state.decisions.push({
                timestamp: tickTs,
                loop: "monitor",
                action: "ask_cap_refused",
                detail: `${g.id}: cost-cap ask refused: ${opened === "cap" ? `the open cap of ${ASKS_OPEN_MAX}` : opened}`,
              });
            } else {
              sess.state.decisions.push({
                timestamp: tickTs,
                loop: "monitor",
                action: "ask_opened",
                detail: `${g.id}: ${capReason} (ask ${opened.id})`,
              });
              try { ctx.toast(`Agentic: ${capReason}`); } catch { /* non-fatal */ }
            }
          }
        }
        sess.state.updatedAt = tickTs;
        await ctx.persist();
        return;
      }

      // D4: Backoff gate. After K consecutive skipped ticks, run classify less often.
      if (costEnabled) {
        const consecutiveSkips = sess.state.monitor.cost.consecutiveSkips;
        if (!shouldRunClassify(tickIndex, consecutiveSkips, costBackoffAfterTicks, costBackoffMaxMs, controllerTickMs)) {
          // Skip classify and nudge; carry forward the previous decision.
          const factor = backoffFactor(consecutiveSkips, costBackoffAfterTicks, costBackoffMaxMs, controllerTickMs);
          sess.state.decisions.push({
            timestamp: tickTs,
            loop: "monitor",
            action: "controller_tick",
            detail: `${g.id}: backed off (factor ${factor}, tick ${tickIndex})`,
          });
          sess.state.updatedAt = tickTs;
          await ctx.persist();
          return;
        }
      }

      // D2: Idle tick skip. Hash the stable subset of the summary.
      // Skip classify+reason only when the hash is unchanged AND the nudge is not due.
      if (costEnabled) {
        // Build the stable subset string (exclude idle time, nudge count,
        // decisions tail). The last answer is in it: a tick whose only
        // change is a new answer on this node is a new situation to
        // classify, not a repeat of the last one.
        const stableSubset =
          `Objective: ${g.objective}\n` +
          `Node: ${g.id} (${g.kind}), status ${g.status}, ${roundSummaryText(sess.state, g)}\n` +
          `Last 5 scores: ${last5}\n` +
          `On-goal count: ${onGoalCount} of ${g.scores.length}\n` +
          `Memory: ${selfReviewLessonCount()} self-review lessons, ${sess.memqWrittenThisSession} written this session\n` +
          (() => {
            const sr = sess.state.memory.filter((m) => m.source === "self-review" && m.kind === "lesson");
            if (sr.length === 0) return "";
            const newest = sr.sort((a, b) => b.createdAt - a.createdAt)[0];
            return `LESSON: ${newest.text.slice(0, 120)}\n`;
          })() +
          envLine +
          `Last answer: ${controllerLastAnswerText(lastAnswer)}\n`;
        const currentHash = fnv1aHash(stableSubset);
        const prevHash = sess.state.monitor.cost.lastSummaryHash;
        const nudgeDue = idleMs >= nudgeIdleMs && (now - sess.lastNudgeAt >= nudgeFloorMs);
        if (currentHash === prevHash && !nudgeDue) {
          // Skip classify and reason; carry forward the previous decision.
          sess.state.monitor.cost.consecutiveSkips += 1;
          sess.state.decisions.push({
            timestamp: tickTs,
            loop: "monitor",
            action: "controller_tick",
            detail: `${g.id}: unchanged, skipped`,
          });
          sess.state.updatedAt = tickTs;
          await ctx.persist();
          return;
        }
        // Hash changed or nudge due: reset skip counter, update hash, run classify.
        sess.state.monitor.cost.consecutiveSkips = 0;
        sess.state.monitor.cost.lastSummaryHash = currentHash;
      }

      // The controller's state, one text for Haiku and for the shadow
      // call. The catalog builds it, so .kit/jev-gold/replay.mjs builds
      // the same state from a sampled record. Its option list is the
      // labels in force, so the text names switch only where it is
      // offered, each with the description of the question as resolved
      // now, an admitted override's or the shipped entry's; the same
      // resolution is handed to the shadow call, so Haiku's text and
      // Jev's criteria carry one wording.
      const controllerHost = ctx.host();
      const controllerQuestion = await resolverOf(controllerHost)(CONTROLLER_DECISION);
      const summary = controllerStateText(
        facts,
        lastAnswer,
        statePendingPlans,
        classifyLabels,
        controllerQuestion.primitive === "choice" ? controllerQuestion.options : {},
      );
      // Where the controller question is named live, Jev is asked live
      // over the same label array and state as Haiku, and the two calls
      // are started together and awaited together, so the tick waits only
      // for whatever Jev takes beyond Haiku, bounded at the wait rule's
      // Jev figure for controller.tick. That row is the timer's own: no
      // hook meters this call, so the budget it holds under reads
      // unmetered and is not live, and a shadow fired from it keeps the
      // flat shadow bound. Haiku's classify is timer-side and off the
      // chain, so it is not held. Everywhere else this is null and the
      // step is Haiku, then Jev in shadow with Haiku's value. The branch
      // is tested here rather than left to liveAsk, whose not-live path
      // would journal a shadow call carrying no Haiku value. On the
      // not-live path a classify that throws reaches the tick's catch as
      // it always has. On the live path Haiku's classify is settled
      // rather than awaited bare, since liveAsk never rejects and Jev's
      // answer decides the tick: a Haiku throw beside an answered call
      // acts on Jev's label and logs controller_haiku_failed, and one
      // beside a failed call is rethrown, so the catch is that tick's one
      // record.
      const controllerBudget: HookBudget = { live: false, remainingMs: () => Infinity };
      const liveControllerCall = jevMode === "shadow" && jevLive.includes(CONTROLLER_DECISION)
        ? liveAsk(controllerHost, "controller.tick", controllerBudget, "controller", CONTROLLER_DECISION, classifyLabels, summary, jevMode, jevLive)
        : null;
      const haikuControllerCall = ctx.classifyController(summary, classifyLabels);
      let liveController: LiveAskResult | null = null;
      let decision: Awaited<typeof haikuControllerCall> | null;
      if (liveControllerCall === null) {
        decision = await haikuControllerCall;
      } else {
        const [live, haiku] = await Promise.all([
          liveControllerCall,
          haikuControllerCall.then(
            (value) => ({ ok: true as const, value }),
            (err: unknown) => ({ ok: false as const, err }),
          ),
        ]);
        liveController = live;
        if (haiku.ok) {
          decision = haiku.value;
        } else if (live === null || "reason" in live) {
          throw haiku.err;
        } else {
          sess.state.decisions.push({
            timestamp: Date.now(),
            loop: "monitor",
            action: "controller_haiku_failed",
            detail: `${g.id}: stamp ${live.stampId}, ${safeErrorText(haiku.err).slice(0, 150)}`,
          });
          decision = null;
        }
      }
      // D1: increment classify ledger
      sess.state.monitor.cost.classify.count += 1;
      sess.state.monitor.cost.classify.estTokens += estimateTokens(summary.length, 30);
      // D3: update call window (count the classify call)
      sess.state.monitor.cost.callWindow = bumpWindow(sess.state.monitor.cost.callWindow, Date.now());
      // Haiku's value, the one an agreement figure is read against: the
      // tick acts on each answer as given, with no rewrite between them.
      const haikuDecision = typeof decision === "string" ? decision : null;
      // The answer the tick acts on, and the stamp id of the controller
      // call the three joiners cite: the next score, the worker's ASK
      // marker and the nudged turn's acted outcome. The stamp is held
      // whatever it is: a null clears the previous tick's call, which is
      // what leaves each joiner citing the latest one.
      let chosen: string | null;
      let controllerStampId: string | null;
      if (liveController === null) {
        // The decision seam, in shadow. Jev is asked the same question
        // over the same option ids Haiku was just offered, and its answer
        // is journaled beside Haiku's. It sits after the ledger rather
        // than inside it because the ledger counts the Haiku call and
        // does not count this one.
        controllerStampId = shadowAsk(
          controllerHost,
          "controller",
          CONTROLLER_DECISION,
          classifyLabels,
          summary,
          jevMode,
          haikuDecision,
          async () => controllerQuestion,
        );
        chosen = haikuDecision;
      } else if ("reason" in liveController) {
        // Haiku's label is the tick's, with no shadow call beside it. A
        // seam reason has its own call line naming it, written by
        // liveAsk, and Haiku's label is joined to it. A `rejected` call
        // has none, since liveAsk's catch returns before any line is
        // written, so this decision is its only record, no outcome is
        // written against a call line that does not exist, and the
        // joiners cite no call either.
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "controller_fallback",
          detail: `${g.id}: reason ${liveController.reason}, stamp ${liveController.stampId}, split ${splitOf(liveController.stampId)}`,
        });
        if (liveController.reason !== "rejected" && haikuDecision !== null) {
          shadowOutcome(controllerHost, liveController.stampId, "haiku_decision", haikuDecision);
        }
        controllerStampId = liveController.reason === "rejected" ? null : liveController.stampId;
        chosen = haikuDecision;
      } else {
        // Jev's choice is the tick's decision, and Haiku's label is joined
        // to the live call, so the journal holds both answers for one
        // input as a shadow answer line does.
        if (haikuDecision !== null) {
          shadowOutcome(controllerHost, liveController.stampId, "haiku_decision", haikuDecision);
        }
        controllerStampId = liveController.stampId;
        chosen = liveController.answer.choice;
      }
      sess.jevScoreOutcomeStampId = controllerStampId;
      sess.jevAskMarkerOutcomeStampId = controllerStampId;
      // A verdict outside the labels offered is read as nudge, as a null
      // one is: the decider was handed a closed set, so any other string
      // is no decision, and leaving the tick without an actuator on it
      // would let the worker sit idle for the tick. Each answer in the
      // set acts as given: idle-gap-nudge sends the idle-gap text,
      // complete, offered on a task entry alone, completes the entry, and
      // switch takes the pending plan.
      let finalDecision: string = typeof chosen === "string" && classifyLabels.includes(chosen) ? chosen : "nudge";

      // A turn can open under the classify call above, and a worker inside
      // an open turn is not idle. A complete or a switch that finds one
      // open changes nothing and says so, as the nudge arm does. The
      // reading is taken again at each await that precedes a change: the
      // plan pick and the reason call before it, and the health run
      // before the complete arm's activation. The one await left
      // unfenced is the plan-document read inside
      // completeLeafReturningClosed, ahead of the completion itself.
      const skipForOpenTurn = (what = "not acted on"): boolean => {
        if (!turnIsOpen()) return false;
        sess.state.decisions.push({
          timestamp: tickTs,
          loop: "monitor",
          action: "controller_skipped_turn_in_flight",
          detail: `${g.id}: ${finalDecision} ${what}, turn in flight`,
        });
        return true;
      };
      // R6: switch, second Haiku call to pick a plan id.
      if (finalDecision === "switch" && pendingPlans.length > 0 && skipForOpenTurn()) {
        finalDecision = "skipped";
      } else if (finalDecision === "switch" && pendingPlans.length > 0) {
        const switchPrompt =
          `Choose which plan to switch to. Plans:\n` +
          pendingPlans.map((p) => `- ${p.id}: ${p.title}`).join("\n") +
          `\nReturn the plan id only.`;
        let switchRaw: unknown;
        let pickFailed = false;
        try {
          switchRaw = await ctx.completePlanSwitch(switchPrompt);
        } catch {
          // The plan-pick failed: the tick falls through to the plain
          // nudge, so no arm is left holding a decision it cannot act on.
          pickFailed = true;
          finalDecision = "nudge";
        }
        if (!pickFailed) {
          // A result with no text reads as an empty reply, which matches
          // no plan id and logs switch_failed below, after one line
          // naming the shape the engine handed back.
          const switchText = completionText(switchRaw);
          if (switchText === null) noteCompletionShape("plan-switch", switchRaw);
          const switchId = (switchText ?? "").trim().split(/\s/)[0];
          const target = pendingPlans.find((p) => p.id === switchId);
          // The decision seam, in shadow. This one site answers in free
          // text rather than from a label array, so the options in force
          // are the pending plan ids the prompt listed plus the catalog's
          // own "no_match", and Haiku's value is its reply where that is
          // exactly one of those ids and "no_match" where it is not.
          shadowAsk(
            ctx.host(),
            "plan-switch",
            PLAN_SWITCH,
            [...pendingPlans.map((p) => p.id), PLAN_SWITCH_NO_MATCH],
            switchPrompt,
            jevMode,
            target ? switchId : PLAN_SWITCH_NO_MATCH,
          );
          if (target && skipForOpenTurn()) {
            finalDecision = "skipped";
          } else if (target) {
            // Demote current active to paused (M10: write blockedReason).
            g.status = "paused";
            g.blockedReason = "Switched to another plan";
            g.updatedAt = Date.now();
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "goal",
              action: "switch_from",
              detail: `${g.id} demoted to paused (switch)`,
            });
            // Activate target.
            target.status = "active";
            target.updatedAt = Date.now();
            sess.state.activeGoalId = target.id;
            sess.nudgedAnswersWithoutStatus = 0;
            sess.nudgeCapRefusedFor = null;
            sess.lastNudgeAt = 0;
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "goal",
              action: "switch_to",
              detail: `${target.id} "${target.title}" activated (switch)`,
            });
            // The decision stays switch, which is what the tick's record
            // names. No nudge goes out on this tick: the nudge arm reads
            // the entry the tick started on, now paused. The floor is
            // zero, so the next idle tick nudges the new plan.
          } else {
            sess.state.decisions.push({
              timestamp: Date.now(),
              loop: "goal",
              action: "switch_failed",
              detail: `No pending plan matched id "${switchId}"`,
            });
            finalDecision = "nudge";
          }
        }
      }

      // Get a reason with a second complete call (for non-nudge decisions).
      // Item 3: an ask record must carry the worker's FULL question, so the
      // model's reason is kept whole (fullReason) for that purpose. The
      // 100-char slice (finalReason) exists only to keep the decision-log
      // detail line terse; it must never be the text a reader sees as "the
      // question asked" - that was the earlier defect (a reader seeing a
      // fragment cut off mid-word).
      let finalReason = "";
      let fullReason = "";
      // Only a complete carries a reason: both nudges say why in their own
      // text, and a switch is explained by the plan it takes up, so a
      // reason call would spend a completion on each.
      if (finalDecision === "complete" && skipForOpenTurn()) {
        finalDecision = "skipped";
      }
      if (finalDecision === "complete") {
        try {
          const reason = await ctx.completeReason(finalDecision, summary);
          // D1: increment reason ledger
          sess.state.monitor.cost.reason.count += 1;
          sess.state.monitor.cost.reason.estTokens += estimateTokens(summary.length, 30);
          // D3: update call window (count the reason call)
          sess.state.monitor.cost.callWindow = bumpWindow(sess.state.monitor.cost.callWindow, Date.now());
          // A result with no text leaves the reason empty, and the tick's
          // decision reads "no reason" as it does when the call throws,
          // after one line naming the shape the engine handed back.
          const reasonText = completionText(reason);
          if (reasonText === null) noteCompletionShape("controller-reason", reason);
          fullReason = (reasonText ?? "").trim().replace(/\*{1,2}/g, "");
          finalReason = fullReason.slice(0, 100);
        } catch { /* reason call failed; non-fatal */ }
      }

      sess.state.decisions.push({
        timestamp: tickTs,
        loop: "monitor",
        action: "controller_tick",
        detail: `${g.id}: ${finalDecision}: ${finalReason || "no reason"} (idle ${idleDisplay})`,
      });

      // Actuate (controller only: actuators 2 to 4 of the four in the file
      // header, since context injection, the first, is always on). Whether
      // this is the idle-gap nudge, whose text hooks/index.ts's submitNudge carries. The
      // identifier is the anchor test-personas/injection-ledger.mjs's
      // extractNudgeFrames reads the two nudge frames by.
      const idleGapConverted = finalDecision === "idle-gap-nudge";
      if ((finalDecision === "nudge" || idleGapConverted) && g.status === "active") {
        // A nudge wakes an idle worker, and a worker inside an open turn is
        // not idle, so no nudge is sent while a turn is open. The tick's
        // in-flight check passes synchronously while the classify call that
        // follows is async, so a turn can open underneath a tick already on
        // its way to this line. That is why the open-turn reading is taken
        // again here rather than trusted from the top of the tick. A
        // submission made here would not reach the running turn at all. It
        // is queued and runs once the session is idle, so it arrives as
        // part of the next turn's prompt, one identical copy per tick,
        // rather than waking anything.
        if (turnIsOpen()) {
          sess.state.decisions.push({
            timestamp: tickTs,
            loop: "monitor",
            action: "nudge_skipped_turn_in_flight",
            detail: `${g.id}: idle ${idleDisplay}, turn in flight`,
          });
        } else if (now - sess.lastNudgeAt >= nudgeFloorMs) {
          // Nudge floor.
          // AK2: Guard only (silent). The nudge-cap check before classify already handles the cap.
          // If we reached here, the cap was not latched at the pre-classify check.
          if (nudgeCapped) {
            return;
          }
          // The nudge's text, floor stamp, expected-turn entry and submit are
          // one synchronous region in hooks/index.ts's submitNudge, since
          // test-personas/injection-ledger.mjs reads that text from that file.
          const { nudgeOutcome, unlinedAnswers } = await ctx.submitNudge(g, idleGapConverted, idleDisplay, controllerStampId);
          if (!nudgeOutcome.ok) {
            // Non-fatal, as every actuator failure here is. It is recorded
            // because the floor was already spent in hooks/index.ts's submitNudge, so a refused submit
            // costs a whole nudge window and would otherwise leave nothing
            // anywhere saying the worker went un-nudged. No nudged turn is
            // coming, so its entry has left the list: left in, the tick's
            // next delivery turn would open as the nudge and lose its stamp.
            sess.state.decisions.push({
              timestamp: tickTs,
              loop: "monitor",
              action: "nudge_failed",
              detail: `${g.id}: submit ${nudgeOutcome.how}, floor already spent: ${nudgeOutcome.reason}`.slice(0, 200),
            });
            // No nudged turn is coming, so the controller call's acted
            // outcome is none, written at once, and the stamp submitNudge held
            // is released where it still names this call.
            if (sess.jevActedStampId === controllerStampId) sess.jevActedStampId = null;
            if (controllerStampId !== null) shadowOutcome(controllerHost, controllerStampId, "acted", "none");
          }
          if (nudgeOutcome.ok) {
            // D1: increment nudge ledger (count only, no token estimate)
            sess.state.monitor.cost.nudge.count += 1;
            // D3: update nudge window
            sess.state.monitor.cost.nudgeWindow = bumpWindow(sess.state.monitor.cost.nudgeWindow, now);
            sess.state.decisions.push({
              timestamp: tickTs,
              loop: "monitor",
              action: "nudge_sent",
              detail: `${g.id}: idle ${idleDisplay}, nudged answers without a status line: ${unlinedAnswers}`,
            });
          }
        } else {
          // The decider said nudge and the floor held. This is the ordinary
          // outcome for the second of two ticks alive at once, and it is
          // recorded so that a quiet stretch reads as the floor doing its
          // job rather than as the decider never having run.
          sess.state.decisions.push({
            timestamp: tickTs,
            loop: "monitor",
            action: "nudge_skipped_floor",
            detail: `${g.id}: idle ${idleDisplay}, floor not elapsed`,
          });
        }
      } else if (finalDecision === "complete" && g.status === "active" && skipForOpenTurn()) {
        // Nothing is completed or activated under an open turn.
      } else if (finalDecision === "complete" && g.status === "active") {
        // R3: use completeLeaf + activateNext.
        const completedId = g.id;
        const closedIds = await ctx.completeLeafReturningClosed(completedId, finalReason || "controller complete");
        // E2: health run at completeLeaf site (controller complete).
        await ctx.runHealth(completedId);
        sess.state.decisions.push({
          timestamp: Date.now(),
          loop: "goal",
          action: "completed_by_controller",
          detail: `${completedId}: ${finalReason || "controller complete"}`,
        });
        ctx.queueMemoryCheck(expectedTurns, completedId, g.title, closedIds);
        // R3: activate next, unless a turn opened under the health run
        // above. The entry stays complete, and the next idle tick, which
        // finds no active entry, activates pending work.
        if (!skipForOpenTurn("activation skipped")) {
          const nextId = activateNext(sess.state, completedId);
          ctx.activate(nextId, `${completedId} complete`);
        }
        // L11: plan completion is a log line, not a speech.
        try { ctx.log(`Agentic: ${completedId} plan complete (controller)`); } catch { /* non-fatal */ }
        try { ctx.status(""); } catch { /* non-fatal */ }
      }

      // Visible status line while a goal is actively driving.
      const currentActive = sess.state.activeGoalId
        ? sess.state.goals.find((x) => x.id === sess.state.activeGoalId)
        : null;
      if (currentActive && currentActive.status === "active") {
        // A plan entry has no round budget, so its status line carries
        // no round text.
        const roundText = isPlanEntry(sess.state, currentActive)
          ? ""
          : ` | round ${currentActive.completedRounds}/${currentActive.maxRounds}`;
        try {
          ctx.status(`Goal: ${currentActive.title.slice(0, 50)} | ${currentActive.kind} | ${currentActive.id}${roundText}`);
        } catch { /* non-fatal */ }
      }

      // Persist (owner only, guarded write).
      sess.state.updatedAt = Date.now();
      await ctx.persist();
    } catch {
      // Controller tick failed; non-fatal.
    }
  });
}

// The tick: the always part, then, where this session owns the persona
// and no turn is open, the idle part.
export async function controllerTick(ctx: TickContext): Promise<void> {
  const { cfg, expectedTurns, turnIsOpen } = ctx;
  if (!(await alwaysTick(ctx))) return;
  // 2. In-flight check: the idle part runs with no turn open.
  if (turnIsOpen()) return;
  // The memory drain runs ahead of the idle part, so a persona with no
  // active goal leaf, or one held at the planning gate, still writes the
  // record it owes: every early return inside idleTick sits behind this
  // call. The always part's owner check has run, so the drain is the
  // owner's alone. A turn can open while the drain awaits its model, so
  // the open-turn check runs again before the idle part.
  await ctx.drainMemoryOwed();
  if (turnIsOpen()) return;
  // The ask brief drain follows on the same terms: owner only, no turn
  // open, ahead of every early return inside idleTick, and the open-turn
  // check runs again after its fork.
  await ctx.drainAskBriefOwed(cfg, expectedTurns);
  if (turnIsOpen()) return;
  await idleTick(ctx);
}
