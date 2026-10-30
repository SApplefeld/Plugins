// records.ts: the record layer, the turn records a persona's messages open
// and its own turn ends close, and the goal entries a record becomes. It
// holds the hold of an external message as a record at the prompt with the
// one-line wording of a new record, the next_prompt_kind outcome joined onto
// a record's pending disposition calls, the close of the open record at the
// persona's own turn end, the mark that promotes a record to the entry or
// task it became, the goal_done walk that frees an ancestor a completed child
// left "Child task blocked", addGoalEntry, the one path a goal entry is added by, and
// route one, which promotes a record whose turn wrote a plan document.
// hooks/index.ts holds the wiring: the deps each call takes, the session
// object these functions read and write, the nudge-reset flag activate sets,
// and the wording call's model request, whose scrub
// test-personas/redactor-module-test.mjs reads from that file.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts, so each function here takes
// a RecordsDeps, or the slice of it the record mark or the goal_done walk reads, that
// hooks/index.ts builds at each call. The session crosses as the object
// itself, so each field is read at the moment the code reads it. The module
// holds no state of its own, since the tick harness evaluates it once per
// process while it loads a fresh hooks/index.ts per case.

import { AWAITING_YES_REASON, clampTurnRecordText, isActivationEligible, newTurnRecordId, openBlockingAsks, openTurnRecord, PLAN_PATH_PATTERN, reapTurnRecords, type AgentState, type GoalNode, type TurnRecord } from "./agent-state";
import type { CommonsStore } from "./commons";
import { estimateTokens } from "./cost-ledger";
import type { OutcomeKind } from "./decision-journal";
import { COMPLETE_TIMEOUT_MS, holdFor, type HoldHost } from "./decision-seam";
import { unpromptedPlanNotUndoneText, unpromptedPlanRecordText, unpromptedPlanRefusedText } from "./effort-texts";
import type { PluginHost } from "./host";
import { answeredOrThrow, type HookBudget, type LiveAskResult } from "./jev-live";
import { mayReachPersona, sendPluginRecord } from "./operator";
import { planPathUnderCwd } from "./plan-route";
import { kaizenLine, TURN_DELIVERED_THRESHOLD, TURN_DISPOSITION, TURN_DISPOSITION_OPTIONS, TURN_OPEN, TURN_OPEN_OPTIONS } from "./question-catalog";
import type { SessionState } from "./session-state";
import { TURN_OPEN_MESSAGE_MAX, turnDispositionStateText, turnOpenStateText } from "./turn-state-text";

// The session fields the record layer reads and writes, which the session
// object in hooks/index.ts satisfies.
export type RecordsSession = Pick<SessionState, "persona" | "mySessionId" | "staleAfterMs" | "state" | "lastNudgeAt" | "nudgedAnswersWithoutStatus" | "nudgeCapRefusedFor" | "lastPlanRouteLine">;

// What hooks/index.ts hands the record layer: the session; the host and the
// commons store over `$`; the wait rule's hold host for a hook's budget; the
// wording call's scrubbed model request with the completion reader and the
// no-text note; liveAsk and shadowOutcome, the ask layer's wrappers there;
// the persist, its rollback form, the goal tools' answering form, activate
// and the decision drop; the getter and setter of the nudge-reset flag
// activate sets; and the session's working-directory read.
export interface RecordsDeps {
  session: RecordsSession;
  host: PluginHost;
  store: CommonsStore;
  holdHost: (budget: HookBudget) => HoldHost;
  completeRecordWording: (prompt: string) => Promise<unknown>;
  completionText: (value: unknown) => string | null;
  noteCompletionShape: (site: string, value: unknown) => void;
  liveAsk: (
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
  ) => Promise<LiveAskResult | null>;
  shadowOutcome: (host: PluginHost, callStampId: string, kind: OutcomeKind, value: string) => void;
  persist: () => Promise<boolean>;
  // persistAnswering in hooks/tool-call.ts: persist's boolean on a settled
  // write, or the error text of a write that threw, journaled. A `rollBack`
  // given is handed to persist for the yield path and run on a throw.
  persistAnswering: (tool: string, applied: string, rollBack?: () => void) => Promise<boolean | { failed: string }>;
  activate: (nextId: string | null, reason: string) => void;
  dropDecision: (entry: AgentState["decisions"][number]) => void;
  countResetSinceNudgeOpened: () => boolean;
  setCountResetSinceNudgeOpened: (value: boolean) => void;
  cwd: () => Promise<unknown>;
}

// The slice of RecordsDeps the record mark reads, which a caller holding no
// `$` builds.
export type RecordMarkDeps = Pick<RecordsDeps, "session" | "dropDecision">;

// --- Section 4 (goal-every-turn): opening a turn record at the prompt ---

// One line naming what a message asks for, for the record a live `new-goal`
// verdict opens. Null on every failure, which is a call that threw or that the
// wait rule gave up on, a result carrying no text, and a text that is empty
// once folded and trimmed; the
// caller's fallback is the message excerpt. The line is not cut here: the
// record field's own clamp is what bounds it, so the prompt's "under 80
// characters" is a request to Haiku rather than the guard.
//
// The call is billed to the `reason` bucket, beside the controller's own reason
// call whose shape this one clones: a one-line Haiku completion over text the
// plugin composed. Every completion site, here and in hooks/index.ts, bumps a
// bucket next to itself and the cost summary sums exactly those buckets, so a site with none
// would drop one Haiku call per external message out of the spend line the
// operator reads. The per-hour call window is not bumped: that cap bounds the
// controller's own tick, which is the only thing that can back itself off.
// The bump comes before the call, so a call the engine cut at its own timeout,
// or one that failed, is billed as the call it was.
//
// The completion bounds itself with its request's own `timeoutMs`, set where
// recordsDepsOf in hooks/index.ts builds the request, which the
// hook's dispatch budget does not run through, so holdFor starts no timer for
// it and only records a cut at that timeout.
async function wordNewRecordText(deps: RecordsDeps, message: string, budget: HookBudget): Promise<string | null> {
  const prompt =
    `A message has just arrived for an autonomous agent. In one line of under 80 characters, ` +
    `plain text with no Markdown, name what the message asks for. Answer with that line alone.\n` +
    message;
  deps.session.state.monitor.cost.reason.count += 1;
  deps.session.state.monitor.cost.reason.estTokens += estimateTokens(prompt.length, 40);
  try {
    // The one caller is the prompt.submit step, so the hold is that event's.
    const raw = answeredOrThrow(await holdFor(deps.holdHost(budget), "prompt.submit", "model", deps.completeRecordWording(prompt), { ownTimeoutMs: COMPLETE_TIMEOUT_MS }));
    const text = deps.completionText(raw);
    if (text === null) {
      deps.noteCompletionShape("turn-record-wording", raw);
      return null;
    }
    const line = kaizenLine(text).trim();
    return line.length > 0 ? line : null;
  } catch {
    // A failed wording call costs the excerpt rather than the record.
    return null;
  }
}

/**
 * Hold a genuine external message as a turn record, before the model reads it.
 * Called from the real prompt.submit hook, which fires for exactly the messages
 * that arrive as a turn of their own: the operator's, a peer session's, which
 * the harness delivers through this same hook, and the harness's own. The
 * plugin's own submits bypass it, so a coordinator persona's message, which
 * reaches the model through the inbox drain's submit, opens no record here. The caller runs this on the owner session of an
 * owner-armed session alone, so a reader-armed session and a session that does
 * not hold the claim open nothing.
 *
 * The fixed rules run first and each decides without Jev. A priming or
 * supervisor-ask turn is refused by the caller, because the text it carries is
 * the plugin's own and a record of it would hold the supervisor's words as the
 * persona's own intention. A turn that answered an open ask opens one record
 * attached to the entry the ask named, supersedes whatever was open, and asks
 * nothing: the prompt.submit handler in hooks/index.ts has already closed that ask, so what the message
 * is about is settled without a classifier.
 *
 * What the rules leave goes to the turn-open question, through liveAsk, the one
 * wrapper whose answer a branch may read. Live, `new-goal` supersedes the open
 * record and opens one worded by Haiku, `step` opens one attached to the active
 * entry, and `continuation` keeps the open record for the turn about to open.
 * Not live, or on a failed live call, the fallback is continue-or-attach-or-bare-
 * record: an open record carries over until it expires, a message arriving on
 * an active entry attaches to it, and anything else opens a bare record holding
 * the message's own opening. No route opens a goal, which is the plan's ruling.
 *
 * The store write is the one failure this step catches, and the handler's job
 * is to deliver the message: a write that fails leaves the record in memory and
 * the turn goes on. The step is not wrapped beyond that, so what keeps the rest
 * of it off the prompt's path is that each await here answers with a value
 * rather than throwing. The wording call catches its own failure and returns
 * null, and liveAsk catches a host that broke the seam's never-rejects
 * contract. A record opened for a prompt a hook beneath then drops stays open
 * and is what the next message continues, which is the carry-over the plan asks
 * for rather than a leak.
 */
export async function holdMessageAsRecord(
  deps: RecordsDeps,
  message: string,
  answeredAskNodeId: string | null,
  jevMode: string,
  jevLive: readonly string[],
  budget: HookBudget,
): Promise<void> {
  const now = Date.now();
  // The reap runs before the open record is read, so what this step reads as
  // open is a record the timeout has already judged. Reading first instead
  // loses the arriving message outright: the step would carry over a record
  // already past its timeout, and the persist at the end of this same step
  // would then expire it, leaving the message with no record at all.
  reapTurnRecords(deps.session.state, now);
  // The same two-part reading the [GOAL TREE] block takes: activeGoalId names
  // the entry, and its status is what says the persona is working on it.
  const activeNode = deps.session.state.activeGoalId
    ? deps.session.state.goals.find((g) => g.id === deps.session.state.activeGoalId)
    : undefined;
  const activeEntry = activeNode && activeNode.status === "active" ? activeNode : null;
  const excerpt = message.slice(0, TURN_OPEN_MESSAGE_MAX);

  // One decision per act, each naming the record it acted on. Where the detail
  // carries the record's text it goes through kaizenLine first, as every
  // decision detail built from text the plugin did not write does.
  const logRecord = (action: string, detail: string): void => {
    deps.session.state.decisions.push({ timestamp: Date.now(), loop: "monitor", action, detail });
  };
  // Section 5 (goal-every-turn): what the turn-open question said this message
  // was, which is the next_prompt_kind outcome every turn-disposition call
  // still pending on a record is waiting for. It carries a live verdict's own
  // option id where one was read, and the token `fallback` where none was:
  // the question not live, not asked, or failed. The arm the fallback then
  // runs is a function of the record's own status, so writing the arm would
  // restate the verdict the outcome exists to score. The shadow verdict for a
  // fallback call sits on the journal's answer line for that call, joined by
  // the stamp id, which is where a labelling pass reads it. Null until an act
  // runs.
  let promptKind: string | null = null;
  // Closes the open record as the act that replaced it. The record layer holds
  // at most one open record, so every route that opens one runs this first. The
  // record is passed in rather than read here, because a caller that awaited
  // anything reads the open record again first: another invocation of this hook,
  // for a message that arrived while this one was in a call, can have opened one
  // since.
  const supersede = (record: TurnRecord | null): void => {
    if (record === null) return;
    record.status = "superseded";
    record.closedAt = now;
    logRecord("turn_record_superseded", `record ${record.id} superseded by a new message`);
  };
  const openNew = (text: string, goalId: string | null, stampId: string | null): void => {
    const record: TurnRecord = {
      id: newTurnRecordId(now),
      text: clampTurnRecordText(text),
      openedAt: now,
      status: "open",
    };
    if (goalId !== null) record.goalId = goalId;
    if (stampId !== null) record.pendingStamps = [{ stampId, turns: 0 }];
    deps.session.state.turnRecords.push(record);
    logRecord(
      goalId === null ? "turn_record_opened" : "turn_record_attached",
      `record ${record.id}${goalId === null ? "" : ` on ${goalId}`}: ${kaizenLine(record.text)}`,
    );
  };
  // Keeps the open record for the turn about to open. Its text stands, because
  // a continuation adds to the same request rather than replacing it, and the
  // turn id is stamped by turn.start, the first point at which one exists. The
  // continuing call's stamp joins the pending list rather than replacing what is
  // there: the call that opened the record owes an outcome of its own, and each
  // pending entry counts the turns from where it joined.
  const continueOpen = (record: TurnRecord, stampId: string | null): void => {
    if (stampId !== null) {
      const pending = record.pendingStamps ?? [];
      pending.push({ stampId, turns: 0 });
      record.pendingStamps = pending;
    }
    logRecord("turn_record_continued", `record ${record.id} continued: ${kaizenLine(record.text)}`);
  };

  if (answeredAskNodeId !== null) {
    // An asked entry the tree no longer holds leaves the record bare rather
    // than pointing its goalId at an id nothing resolves.
    const asked = deps.session.state.goals.find((g) => g.id === answeredAskNodeId);
    supersede(openTurnRecord(deps.session.state));
    openNew(excerpt, asked === undefined ? null : asked.id, null);
    // This route asks the question of no one, so no verdict steered it.
    promptKind = "fallback";
  } else {
    const openAtEntry = openTurnRecord(deps.session.state);
    // The stamp id rides a holder filled by onStamp, because onStamp is called
    // on the not-live path too, whose null return carries no id. Null where no
    // journal line was written at all.
    const call: { stampId: string | null } = { stampId: null };
    const live = await deps.liveAsk(
      deps.host,
      "prompt.submit",
      budget,
      // One hook site asks this question, so the journal site is its own id.
      TURN_OPEN,
      TURN_OPEN,
      TURN_OPEN_OPTIONS,
      turnOpenStateText(activeEntry === null ? "" : activeEntry.objective, openAtEntry === null ? "" : openAtEntry.text, excerpt),
      jevMode,
      jevLive,
      (stampId) => { call.stampId = stampId; },
    );
    // The open record is read again here, after the call: at most one record is
    // open at a time, and a message that arrived while this one was in the call
    // runs this same step, so the record read before it may already be closed
    // and a record it opened is the one this act has to answer to.
    const open = openTurnRecord(deps.session.state);
    // A failed live call reads as the not-live path does: no verdict.
    const verdict = live !== null && "answer" in live ? live.answer.choice : null;
    // The outcome is the verdict itself, whichever arm below it lands in: a
    // live `step` with nothing active or a live `continuation` with nothing
    // open runs a fallback arm and still reads as the verdict Jev gave.
    promptKind = verdict ?? "fallback";
    if (verdict === "new-goal") {
      const worded = await wordNewRecordText(deps, excerpt, budget);
      // Read again for the same reason, the wording call being a second await.
      supersede(openTurnRecord(deps.session.state));
      openNew(worded ?? excerpt, null, call.stampId);
    } else if (verdict === "step" && activeEntry !== null) {
      supersede(open);
      openNew(excerpt, activeEntry.id, call.stampId);
    } else if (open !== null) {
      // The fallback's first arm, and where a live `continuation` verdict
      // lands. A `step` verdict with nothing active and a `continuation`
      // verdict with nothing open take the fallback too, which is what the
      // plan means by treating the latter as the fallback: neither names a
      // record the plugin could act on.
      continueOpen(open, call.stampId);
    } else if (activeEntry !== null) {
      openNew(excerpt, activeEntry.id, call.stampId);
    } else {
      openNew(excerpt, null, call.stampId);
    }
  }

  // Section 5 (goal-every-turn): the next_prompt_kind outcome, written once
  // against every turn-disposition stamp still pending on a record that has
  // not expired, whatever the record's status. A record delivered at its turn
  // end holds its stamps until this message arrives, since the verdict this
  // message took is exactly what that outcome measures. The reap at the top of
  // this step has already expired a stale record, so an expired one is skipped
  // here and settled as `none` at the persona's next own turn end instead,
  // which is the writer for that arm. It runs after the acts above, so a
  // record they superseded is read in its closed state, and before the
  // persist, so the cleared list is what the store write carries.
  if (promptKind !== null) {
    for (const record of deps.session.state.turnRecords) {
      if (record.status === "expired") continue;
      writeNextPromptKind(deps, record, promptKind);
    }
  }

  // Attempted rather than depended on, as the turn-id stamp in the
  // prompt.submit handler in hooks/index.ts is: a throw here would leave the prompt undelivered over
  // bookkeeping, and the first write that is not refused carries the record.
  try { await deps.persist(); } catch { /* the record stands in memory until a write lands */ }
}

// --- Section 5 (goal-every-turn): closing a turn record at the turn's end ---

// Joins one next_prompt_kind value onto every turn-disposition call still
// pending on a record, and drops the list as the lines are written, which is
// what holds one call to one outcome line. A record with no pending stamp is a
// record no call is waiting on, which is every record under the kill switch.
function writeNextPromptKind(deps: RecordsDeps, record: TurnRecord, value: string): void {
  const stamps = record.dispositionStamps;
  if (stamps === undefined || stamps.length === 0) return;
  for (const stampId of stamps) deps.shadowOutcome(deps.host, stampId, "next_prompt_kind", value);
  delete record.dispositionStamps;
}

// The `none` arm of next_prompt_kind: a record that expired before the next
// external message arrived. It runs here, at the persona's own turn end,
// rather than inside reapTurnRecords, because the reap lives in the store
// module and has no host to write a journal line with. That placement also
// covers a record the reap expired at a load or at a store write elsewhere,
// since the expired record is still in the array to be read here.
export function settleExpiredDispositionStamps(deps: RecordsDeps): void {
  for (const record of deps.session.state.turnRecords) {
    if (record.status === "expired") writeNextPromptKind(deps, record, "none");
  }
}

/**
 * Decide at the persona's own turn end whether the open record was delivered,
 * and close it when it was. Called from turn.complete under the true-boundary
 * guard: the completing id is the one turn.start carried, no subagent id is on
 * the completion, no turn is open once this completion's own entry is gone,
 * this session holds the persona, and the turn was not skipped. A record is
 * never deleted here; it changes status and gains closedAt, and the cap is
 * the reap's alone.
 *
 * The fixed rules run first, in the plan's order, and each decides without
 * Jev, logging one turn_record_in_flight decision naming itself. A closing
 * text opening with a BLOCKED: or WAITING: lead, an ask open at the turn's
 * end, and a background agent the main loop started and still running each
 * leave the record open and in flight. The agent list is read through the
 * caller's thunk only once the first two rules have declined, since those
 * two are synchronous facts already in hand and the list is a host call
 * with a suspension of its own. What they leave goes to the
 * turn-disposition question through liveAsk over the four-field state, whose
 * active_goal is the objective of the entry that was active at the turn's
 * start, the entry the turn served, read by the caller from the same
 * turn-start leaf the scorer ahead of it in serveTurnComplete in hooks/turn-complete.ts
 * judges. The entry active at the turn's
 * end is often a different one: the scorer that ran ahead of this can have
 * blocked or completed the served entry and activated the next, and the
 * closing text and tool activity beside the field describe the served one,
 * so the served one is what the question is asked about. Live,
 * the record is delivered when the answer's probability for `delivered` is at
 * least TURN_DELIVERED_THRESHOLD, the equal case included, else it stays open.
 * Not live, or on a failed live call, the fallback is not delivered, which keeps the
 * record open and costs nothing on a record, since a record is never nudged.
 *
 * The stamp of every call this asks is parked on the record before the await,
 * on the disposition list rather than the turn-open one, so the next
 * message's verdict can answer it. After the await, two facts are read again
 * before anything is written. The turn-start count is compared with the one
 * the caller read at its delete, which is the same reading the compaction
 * boundary takes of the same fact: a newer turn started while this
 * completion awaited means it no longer owns the turn, and a completion that
 * does not own the turn writes nothing. And the open record is read again,
 * since a store write in between can have expired it. Nothing here throws
 * to the caller: liveAsk catches a host that broke the seam's never-rejects
 * contract, and every other line is a read or a write of state already in
 * memory.
 */
export async function closeTurnRecordAtTurnEnd(
  deps: RecordsDeps,
  activeGoal: string,
  closingText: string,
  askedText: string,
  activityText: string,
  endedOnLead: boolean,
  readLiveAgent: () => Promise<boolean>,
  newerTurnStarted: () => boolean,
  jevMode: string,
  jevLive: readonly string[],
  budget: HookBudget,
): Promise<void> {
  const open = openTurnRecord(deps.session.state);
  if (open === null) return;
  const inFlight = (rule: string): void => {
    deps.session.state.decisions.push({
      timestamp: Date.now(),
      loop: "monitor",
      action: "turn_record_in_flight",
      detail: `record ${open.id} left open: ${rule}`,
    });
  };
  // A blocking ask is read ahead of the lead: a BLOCKED: lead with an ASK:
  // line under it is in flight on that question, which the decision names.
  const blockingAsks = openBlockingAsks(deps.session.state);
  if (blockingAsks.length > 0) {
    inFlight(`a blocking ask is open (${blockingAsks.map((entry) => entry.id).join(", ")})`);
    return;
  }
  if (endedOnLead) {
    inFlight("the closing text opens with a BLOCKED: or WAITING: lead");
    return;
  }
  if (await readLiveAgent()) {
    inFlight("a background agent the main loop started is still running");
    return;
  }
  const live = await deps.liveAsk(
    deps.host,
    "turn.complete",
    budget,
    // One hook site asks this question, so the journal site is its own id.
    TURN_DISPOSITION,
    TURN_DISPOSITION,
    TURN_DISPOSITION_OPTIONS,
    turnDispositionStateText(activeGoal, askedText, closingText, activityText),
    jevMode,
    jevLive,
    (stampId) => {
      if (stampId === null) return;
      const stamps = open.dispositionStamps ?? [];
      stamps.push(stampId);
      open.dispositionStamps = stamps;
    },
  );
  // A completion that no longer owns the turn writes nothing, on the boundary
  // step's own reading of the turn-start count it captured at the delete.
  if (newerTurnStarted()) return;
  // A failed live call reads as the not-live path does: not delivered.
  if (live === null || !("answer" in live)) return;
  const delivered = live.answer.probabilities["delivered"];
  if (typeof delivered !== "number" || delivered < TURN_DELIVERED_THRESHOLD) return;
  const current = openTurnRecord(deps.session.state);
  if (current === null || current.id !== open.id) return;
  current.status = "delivered";
  current.closedAt = Date.now();
  deps.session.state.decisions.push({
    timestamp: Date.now(),
    loop: "monitor",
    action: "turn_record_delivered",
    detail: `record ${current.id} delivered at p ${delivered}`,
  });
}

// Section 6 (goal-every-turn): marks one turn record promoted with the id of the
// goal node or the task it became, and returns the undo of that mark, or null
// where there is no record to mark. Route two's three handlers and route one all
// promote through this one function, so the fields a promotion writes are one
// rule: the closed status, the id on whichever field names its kind, the plan
// path where the add carried one, and the clock the promotion happened at. A
// promoted record is no longer open, so it drops out of the close's view and out
// of the status line's, which is what keeps a record from dangling beside the
// entry it became.
//
// The record is the caller's reading rather than this function's, because a
// caller that awaited anything between resolving the record and marking it has
// to mark the record it resolved: the one a message that arrived in that window
// opened asked for nothing, and marking it would leave the record the entry was
// made from superseded with its plan path and never promoted.
//
// The plan path is written because the entry the record became is found by path
// at the next boundary, and the record is the only place a path-keyed reader can
// see that route two's own add already covered the document. An add naming no
// path leaves whatever the record carried.
//
// The undo is returned rather than applied by the caller's own hand because a
// caller that can roll its add back has to put every field of the record back
// as it was, including the ones it never wrote, and a caller that cannot roll
// back simply drops the undo.
function promoteTurnRecord(
  deps: RecordMarkDeps,
  record: TurnRecord | null,
  id: string,
  field: "goalId" | "taskId",
  now: number,
  planPath: string | undefined,
): (() => void) | null {
  if (record === null) return null;
  const before = {
    status: record.status, goalId: record.goalId, taskId: record.taskId,
    planPath: record.planPath, closedAt: record.closedAt,
  };
  record.status = "promoted";
  record[field] = id;
  if (planPath !== undefined) record.planPath = planPath;
  record.closedAt = now;
  const decision: AgentState["decisions"][number] = {
    timestamp: now,
    loop: "monitor",
    action: "turn_record_promoted",
    detail: `record ${record.id} promoted to ${field === "goalId" ? "entry" : "task"} ${id}`,
  };
  deps.session.state.decisions.push(decision);
  return () => {
    record.status = before.status;
    if (before.goalId === undefined) delete record.goalId; else record.goalId = before.goalId;
    if (before.taskId === undefined) delete record.taskId; else record.taskId = before.taskId;
    if (before.planPath === undefined) delete record.planPath; else record.planPath = before.planPath;
    if (before.closedAt === undefined) delete record.closedAt; else record.closedAt = before.closedAt;
    deps.dropDecision(decision);
  };
}

// The same mark on whichever record is open now, for the three route-two handlers
// that read the record and mark it with nothing awaited in between.
export function promoteOpenRecord(deps: RecordMarkDeps, id: string, field: "goalId" | "taskId", now: number): (() => void) | null {
  return promoteTurnRecord(deps, openTurnRecord(deps.session.state), id, field, now, undefined);
}

// completeLeaf's walk marks a plan parent blocked with the reason "Child task
// blocked" while a child is blocked, and leaves that status and reason in
// place when goal_done later completes the blocked child by name. A parent
// left blocked is never descended into by activateNext's DFS, so its pending
// children are stranded. This walks up from the completed entry through each
// non-root ancestor carrying that reason. A complete ancestor has the stale
// reason cleared, whether the walk completed it in this call or earlier, and
// the walk goes on above it. A blocked ancestor with no child still blocked returns to pending.
// A blocked ancestor with a child still blocked stays blocked and ends the
// walk, as does any other state. Each ancestor changed gets one decision.
// The walk is bounded by the node count, as isActivationEligible's is.
export const clearChildBlockedAncestors = (deps: Pick<RecordsDeps, "session">, completedId: string): void => {
  const goals = deps.session.state.goals;
  let current = goals.find((g) => g.id === completedId);
  let steps = goals.length;
  while (current && current.parentId) {
    if (steps-- <= 0) return;
    const parent = goals.find((g) => g.id === current!.parentId);
    if (!parent || parent.parentId === null || parent.blockedReason !== "Child task blocked") return;
    const cause = `goal_done's completion of ${completedId} cleared "Child task blocked"`;
    if (parent.status === "complete") {
      parent.blockedReason = undefined;
      parent.updatedAt = Date.now();
      deps.session.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "reason_cleared",
        detail: `${parent.id}: ${cause}`,
      });
    } else if (parent.status === "blocked" && !goals.some((g) => g.parentId === parent.id && g.status === "blocked")) {
      parent.status = "pending";
      parent.blockedReason = undefined;
      parent.updatedAt = Date.now();
      deps.session.state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "unblocked",
        detail: `${parent.id}: returned to pending, ${cause}`,
      });
    } else {
      return;
    }
    current = parent;
  }
};

// Section 6 (goal-every-turn): what an add of a goal entry does once its
// arguments are settled, and the one path that does it. The goal_add handler
// calls this with the arguments the model gave, and route one of the promotion
// routes calls it at a turn's end with the arguments it read off the record, so
// the paused-awaiting-yes shape, the [PROPOSAL] and [STARTED] records and the
// rollback are the autonomy dial's own on both routes rather than a second copy
// of them. `unprompted` and `awaitingYes` are the caller's readings, since only
// a tool call can read a turn's origin: route one is the plugin's own act and is
// unprompted whatever turn it lands in.
//
// What it does not do is build the caller's message. The deny text of a refusal
// is returned, so the tool can pass it to the model and the boundary can log it,
// and the entry is returned, so the tool can name what is active now. A
// prompted add whose store write threw keeps the entry in memory and returns it
// with the error text in writeFailed, so the tool answers with both. An
// unprompted add whose store write threw takes the entry back out of the tree,
// sends no record and returns the error text in failed, with no deny, so the
// tool answers that the plan was not added and the promotion route logs the
// cause.
export type GoalEntryAdd =
  | { ok: true; node: GoalNode; writeFailed?: string }
  | { ok: false; deny: string; failed?: undefined }
  | { ok: false; failed: string; deny?: undefined };

export async function addGoalEntry(
  deps: RecordsDeps,
  a: {
    kind: "plan" | "task";
    title: string;
    objective: string;
    parentId: string;
    root: GoalNode;
    maxRounds: number;
    planPath: string | undefined;
    unprompted: boolean;
    awaitingYes: boolean;
    dropTaskId: string | undefined;
    coordinatorPersona: string;
    architectPersona: string;
  },
): Promise<GoalEntryAdd> {
  const { kind, parentId, root, planPath, unprompted, awaitingYes, coordinatorPersona, architectPersona } = a;
  // The record this add is made for, read here rather than at the mark below,
  // because the reach check is an await and a message arriving inside it opens a
  // record of its own and supersedes this one. The mark belongs on the record the
  // add answered, whatever is open by the time it runs.
  const recordAtEntry = openTurnRecord(deps.session.state);
  // A plan the gate admitted outside the operator's and the coordinator
  // persona's turns was admitted by the autonomy level, and one record
  // tells the coordinator persona about it: a [PROPOSAL] at plan-and-ask,
  // where the entry waits paused for the operator's yes, and a [STARTED]
  // at plan-and-start. The road to the coordinator persona is checked
  // here, with the other refusals. The record goes out only after the
  // entry is saved, so the coordinator's inbox never names an entry the
  // store does not hold, and a record that then cannot be written takes
  // the add back out of the tree and the store.
  if (unprompted) {
    let noRoad: string | null = null;
    try {
      if (deps.session.persona === "default") {
        noRoad = "the session is on the default persona, which has no road to a coordinator persona";
      } else if (!await mayReachPersona(deps.store, coordinatorPersona, deps.session.mySessionId, coordinatorPersona, architectPersona, deps.session.staleAfterMs)) {
        noRoad = `the reach rule refuses this session's write to '${coordinatorPersona}'`;
      }
    } catch (err) {
      noRoad = `the reach check for '${coordinatorPersona}' failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (noRoad !== null) {
      return { ok: false, deny: unpromptedPlanRefusedText(noRoad) };
    }
  }

  const now = Date.now();
  const newNode: GoalNode = {
    id: `${kind}-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    parentId,
    kind,
    title: a.title.slice(0, 80),
    objective: a.objective.slice(0, 500),
    status: awaitingYes ? "paused" : "pending",
    ...(awaitingYes ? { blockedReason: AWAITING_YES_REASON, awaitingYes: true } : {}),
    source: "worker",
    planningRounds: 0,
    consecutiveBlockedPlannings: 0,
    consecutivePlanningFailures: 0,
    planningRound: 0,
    maxRounds: a.maxRounds,
    completedRounds: 0,
    scores: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
    ...(planPath ? { planPath } : {}),
  };
  // What this add changes, so an unprompted add whose save yields, whose
  // store write throws or whose record cannot be written can take it back:
  // the root's fields where the add reopened it, the active slot before any activation,
  // the task route three drops, the open record it promotes, and the
  // decision lines the add pushed.
  const priorActiveGoalId = deps.session.state.activeGoalId;
  let reopenedRoot: { status: GoalNode["status"]; blockedReason: string | undefined; updatedAt: number } | null = null;
  const addDecisions: AgentState["decisions"] = [];
  let nudgeBefore: { answers: number; capRefusedFor: string | null; resetSinceOpened: boolean; lastNudgeAt: number } | null = null;
  // A node added directly under a finished root reopens the root, so the
  // tree never holds live work under a root that reads finished. A node
  // added under a plan leaves the root as it was, since a finished plan
  // keeps its child out of reach and a reopened root over it would read
  // live with nothing to activate. It runs after every refusal above, so a
  // refused add reopens nothing, and it touches no other node: finished
  // children stay finished.
  if (parentId === root.id && (root.status === "complete" || root.status === "abandoned")) {
    const priorStatus = root.status;
    reopenedRoot = { status: root.status, blockedReason: root.blockedReason, updatedAt: root.updatedAt };
    root.status = "pending";
    root.blockedReason = undefined;
    root.updatedAt = now;
    const reopenDecision: AgentState["decisions"][number] = {
      timestamp: now,
      loop: "goal",
      action: "root_reopened",
      detail: `${root.id} reopened from ${priorStatus} to pending for a new ${kind}`,
    };
    deps.session.state.decisions.push(reopenDecision);
    addDecisions.push(reopenDecision);
  }
  deps.session.state.goals.push(newNode);

  const addDecision: AgentState["decisions"][number] = {
    timestamp: now,
    loop: "goal",
    action: "add",
    detail: `${newNode.id} (${kind}) under ${parentId}: "${a.title.slice(0, 50)}"`,
  };
  deps.session.state.decisions.push(addDecision);
  addDecisions.push(addDecision);

  // R4: adding a task under the active plan demotes the plan to pending
  // and activates the new task.
  if (kind === "task") {
    const parent = deps.session.state.goals.find((g) => g.id === parentId)!;
    if (parent.status === "active") {
      parent.status = "pending";
      parent.updatedAt = now;
      newNode.status = "active";
      deps.session.state.activeGoalId = newNode.id;
      deps.activate(newNode.id, `${parent.id} demoted to pending; ${newNode.id} activated`);
    }
  }

  // Section 10: if the tree still has no active leaf, activate the node
  // just created rather than deferring to the next tick, mirroring the
  // task branch above (set status and activeGoalId directly, then call
  // activate() to log the decision and reset the nudge budget). Without
  // this, the node stays pending for the rest of this turn, so a
  // same-turn goal_done has nothing of this node's to close.
  //
  // isActivationEligible carries activateNext's own ancestor rule, so a
  // node added under an abandoned or blocked parent is refused here the
  // same way activateNext's DFS would refuse it - this branch never
  // activates into a closed subtree.
  //
  // The hold check beside it is one thing: an open blocking ask on the
  // ledger is the operator's own open question the work is stopped on,
  // whatever opened it, and the controller keeps no other hold. A paused
  // node, dropped by an operator pause or left over from a plan switch, is
  // not a hold and must not disable this branch for the rest of the session.
  if (
    !deps.session.state.goals.some((g) => g.status === "active") &&
    openBlockingAsks(deps.session.state).length === 0 &&
    isActivationEligible(deps.session.state, newNode)
  ) {
    newNode.status = "active";
    newNode.updatedAt = now;
    deps.session.state.activeGoalId = newNode.id;
    nudgeBefore = { answers: deps.session.nudgedAnswersWithoutStatus, capRefusedFor: deps.session.nudgeCapRefusedFor, resetSinceOpened: deps.countResetSinceNudgeOpened(), lastNudgeAt: deps.session.lastNudgeAt };
    deps.activate(newNode.id, `${newNode.id} added with no active leaf`);
    // activate() pushes its one decision line last.
    addDecisions.push(deps.session.state.decisions[deps.session.state.decisions.length - 1]);
  }

  // Route three's reap: the task this entry was made from leaves the list as
  // the entry replaces it, in this add's own write rather than in a second
  // one, so a save that does not land leaves both the task and the tree as
  // they were. The prior array is kept whole for the rollback, the way
  // task_clear keeps it, since a task put back by hand would lose its place
  // in the list.
  const tasksBefore = deps.session.state.tasks;
  const droppedTask = a.dropTaskId === undefined
    ? undefined
    : deps.session.state.tasks.find((t) => t.id === a.dropTaskId);
  if (droppedTask !== undefined) deps.session.state.tasks = deps.session.state.tasks.filter((t) => t !== droppedTask);

  // Route two of the promotion routes, and the mark route one takes as well:
  // where the turn holding this add held an open turn record, that record is
  // the intention the message arrived with and this entry is what the
  // intention became. Any open record counted, bare or attached, since a record
  // attached to the active entry is still the message this add answered. The
  // record is the one read above, before the reach check, and the plan path this
  // add named goes onto it, so the next boundary's path-keyed reading of the tree
  // and of the record agree about which document is already covered. The mark
  // rides this add's own write and the rollback takes it back, so no record reads
  // promoted against an entry the store does not hold.
  const undoPromotion = promoteTurnRecord(deps, recordAtEntry, newNode.id, "goalId", now, planPath);

  // Takes this add back out of memory: the node, the root's reopening,
  // the activation with the session-local nudge fields activate() reset,
  // the dropped task, the promoted record, and the decision lines. The
  // active slot goes back only where it names this entry.
  const rollBackAdd = (): void => {
    const at = deps.session.state.goals.indexOf(newNode);
    if (at !== -1) deps.session.state.goals.splice(at, 1);
    if (reopenedRoot !== null) {
      root.status = reopenedRoot.status;
      root.blockedReason = reopenedRoot.blockedReason;
      root.updatedAt = reopenedRoot.updatedAt;
    }
    if (deps.session.state.activeGoalId === newNode.id) deps.session.state.activeGoalId = priorActiveGoalId;
    if (nudgeBefore !== null) {
      deps.session.nudgedAnswersWithoutStatus = nudgeBefore.answers;
      deps.session.nudgeCapRefusedFor = nudgeBefore.capRefusedFor;
      deps.setCountResetSinceNudgeOpened(nudgeBefore.resetSinceOpened);
      deps.session.lastNudgeAt = nudgeBefore.lastNudgeAt;
    }
    if (droppedTask !== undefined) deps.session.state.tasks = tasksBefore;
    if (undoPromotion !== null) undoPromotion();
    for (const d of addDecisions) deps.dropDecision(d);
  };

  // A thrown write is answered, not rethrown. The prompted add keeps the entry
  // in memory and returns it with the error. The unprompted add rolls the
  // entry back and returns the error with no entry, and sends no record, since
  // a record goes out only behind a landed write. The helper writes the one
  // goal_write_failed line for either.
  const written = unprompted
    ? await deps.persistAnswering("goal_add", newNode.id, rollBackAdd)
    : await deps.persistAnswering("goal_add", newNode.id);
  if (typeof written !== "boolean") {
    return unprompted ? { ok: false, failed: written.failed } : { ok: true, node: newNode, writeFailed: written.failed };
  }
  const writeOk = written;
  if (writeOk && unprompted) {
    const recordText = unpromptedPlanRecordText(awaitingYes, deps.session.persona, newNode.id, newNode.title, planPath);
    let sent: { id: string; writer: string; seq: number };
    try {
      sent = await sendPluginRecord(deps.store, coordinatorPersona, deps.session.mySessionId, recordText);
    } catch (err) {
      const cause = `the write to '${coordinatorPersona}' failed: ${err instanceof Error ? err.message : String(err)}`;
      rollBackAdd();
      let undone = false;
      try { undone = await deps.persist(); } catch { /* read below as not undone */ }
      if (!undone) return { ok: false, deny: unpromptedPlanNotUndoneText(cause, newNode.id) };
      return { ok: false, deny: unpromptedPlanRefusedText(cause) };
    }
    deps.session.state.decisions.push({
      timestamp: now,
      loop: "goal",
      action: awaitingYes ? "plan_awaiting_yes" : "plan_started_unprompted",
      detail: `${newNode.id}: record ${sent.id} to '${coordinatorPersona}'`,
    });
    // The record is ledgered so a quiet tick can send it again where the
    // coordinator persona's inbox skips it; see the plan record settle step.
    deps.session.state.monitor.planRecords.push({ nodeId: newNode.id, awaitingYes, text: recordText, writer: sent.writer, seq: sent.seq, resends: 0 });
    // The entry and the record have both landed, so only this line and the
    // ledger entry are lost on a failed save.
    try { await deps.persist(); } catch { /* the add's success stands */ }
  }
  if (!writeOk) {
    return { ok: false, deny: `persona '${deps.session.persona}' is held by a live session; this write was not saved.` };
  }
  return { ok: true, node: newNode };
}

/**
 * Route one of the promotion routes: a turn record whose own turn wrote a plan
 * document becomes a plan entry in the goal tree, through the autonomy dial.
 * Called from turn.complete under the same true-boundary guard as the record
 * close, and ahead of it, because the close can set the open record `delivered`
 * on a live verdict and a plan-touching record is promoted rather than
 * delivered.
 *
 * Only a bare record takes this route. A record carrying a goalId is already a
 * step of an entry the tree holds, so there is nothing to promote it into, and
 * the architect persona the settings name never takes it at all: that seat
 * authors plan documents for other workers by charter, so every one of its turns
 * would otherwise queue an entry for somebody else's plan. An unset architect
 * seat, which is what the plugin holds where the setting is absent, blank,
 * "default" or the coordinator's own name, excludes nobody.
 *
 * The path is the first of this turn's own plan edits this match accepts, and
 * otherwise the path the record already carries, which is what makes a refused
 * promotion retry at the next boundary. An edit is read through
 * PLAN_PATH_PATTERN after the working directory's prefix comes off, so a plan
 * document in another checkout, in a subdirectory, or under a working directory
 * the host will not name yields no path and the record keeps whatever it had:
 * the entry's planPath is joined back onto this working directory by every later
 * reader, so a path that is not this directory's names a file none of them will
 * find.
 *
 * A path the record carried is re-tested against that same pattern before
 * anything is built on it, which the store's own comment puts at the reader:
 * goal_add enforces the shape on what it writes, and a hand-edited or
 * foreign-written store is the second producer no validation saw. A path that
 * fails that re-test is dropped from the record rather than written back,
 * because nothing between two boundaries can change the shape of a string: the
 * next boundary would re-test the same value, fail it again and log the same
 * line, for as long as the record stayed open.
 *
 * Then the autonomy dial decides, and two readings stop before it. A tree the
 * operator has not opened takes no entry, since only the operator opens one, and
 * a path a plan entry of the tree already carries takes no second entry, since
 * the tree would otherwise gain one entry per turn that touched the document.
 * That second reading is the tree's and not the record log's, because the tree is
 * where the entry lives: a record promoted through route two carries the path
 * only because the promotion copies it, a paused entry outlives the twenty closed
 * records the log keeps, and either way the log can stop naming a document the
 * tree still holds an entry for. An entry of any status counts, a finished one
 * included, since a second entry for a document the tree has already worked is
 * the same flood by another route. Both readings leave the record open with its
 * planPath and log one turn_record_plan_noted naming which of them held. At
 * `propose` the same line is logged and nothing else happens, which is the
 * level's own rule: the standing block already tells a persona how to propose,
 * and an entry here would propose the plan to the steward on the author's
 * behalf. At `plan-and-ask` and `plan-and-start` the entry is added through
 * addGoalEntry, so the paused-awaiting-yes shape and the [PROPOSAL] or [STARTED]
 * record are the dial's own, and the record is marked promoted by that same path.
 * A refused add logs one turn_record_promotion_refused naming the cause and
 * leaves the record open with its planPath, so the next boundary tries again.
 *
 * Either line is logged only where its own text moved for that record since the
 * last boundary, which is what holds the log to one line per reading rather than
 * one per turn end: this runs at every own-turn end while the record stays open,
 * and under the shipped fallback an open record continues across messages until
 * the timeout reaps it. The text carries the record, the rule and the path, so a
 * path this turn moved and a rule that now refuses for another reason are both
 * logged, and only an unchanged reading is silent. The comparison is one reading
 * held on the session object as lastPlanRouteLine, which is never persisted, so
 * a relaunched session logs its record's current reading once more.
 *
 * The record's own text is the entry's title. It arrives cut to the record
 * field's bound and with its brackets already neutralized, by the one clamp
 * every producer of that field and the load call, so no guard is repeated here.
 *
 * Nothing here throws to the caller: the working-directory read is caught, and
 * addGoalEntry answers a refusal or a failed write rather than raising it.
 *
 * It returns true only where the add's store write threw, which means the record
 * must stay open past this turn end's close: the close would otherwise set it
 * delivered on a live verdict and no later boundary could promote it. Every
 * other path returns false.
 */
export async function promotePlanTouchingRecord(
  deps: RecordsDeps,
  editedPaths: readonly string[],
  coordinatorPersona: string,
  architectPersona: string,
  newerTurnStarted: () => boolean,
): Promise<boolean> {
  const open = openTurnRecord(deps.session.state);
  if (open === null || open.goalId !== undefined) return false;
  if (architectPersona !== "" && deps.session.persona === architectPersona) return false;

  // The working directory is read only where this turn edited something that
  // named a plan document, so a turn that touched none costs no host call on
  // the turn-end path. A read that fails or answers no directory leaves every
  // edit unresolved, which reads the same way as an edit outside this
  // directory: no path, and the record keeps what it had. The turn's edits are
  // read in call order and the first this match accepts is the path, so a turn
  // that touched another checkout's spec before its own document is promoted on
  // its own document.
  let edited: string | null = null;
  if (editedPaths.length > 0) {
    let cwd: string | null = null;
    try {
      const answered = await deps.cwd();
      if (typeof answered === "string" && answered.length > 0) cwd = answered;
    } catch { /* read as unresolvable edits below */ }
    if (cwd !== null) {
      for (const candidate of editedPaths) {
        edited = planPathUnderCwd(candidate, cwd);
        if (edited !== null) break;
      }
    }
  }
  // After the one await above, two facts are read again before anything is
  // written, the way the record close beside this reads them. A newer turn
  // started during the read means this completion no longer owns the turn, and
  // a completion that does not own the turn writes nothing. And the open record
  // is read again, since a store write in between can have expired it.
  if (newerTurnStarted()) return false;
  const record = openTurnRecord(deps.session.state);
  if (record === null || record.id !== open.id) return false;

  // One line per reading rather than one per boundary: a line whose action,
  // record and text are the ones last logged from here says nothing new, and
  // this runs at every own-turn end the record stays open for. The reading is
  // compared before the 300-character cut, so two causes that part company past
  // that cut are still two readings.
  const logOnce = (action: string, detail: string): void => {
    if (deps.session.lastPlanRouteLine !== null && deps.session.lastPlanRouteLine.recordId === record.id
      && deps.session.lastPlanRouteLine.action === action && deps.session.lastPlanRouteLine.detail === detail) return;
    deps.session.lastPlanRouteLine = { recordId: record.id, action, detail };
    deps.session.state.decisions.push({
      timestamp: Date.now(),
      loop: "monitor",
      action,
      detail: detail.slice(0, 300),
    });
  };
  const noted = (rule: string): void => {
    logOnce("turn_record_plan_noted", `record ${record.id} holds ${record.planPath}, no entry added: ${rule}`);
  };
  const refused = (cause: string): void => {
    logOnce("turn_record_promotion_refused", `record ${record.id} keeps ${record.planPath} for the next boundary: ${cause}`);
  };

  const path = edited ?? record.planPath;
  if (path === undefined) return false;
  if (!PLAN_PATH_PATTERN.test(path)) {
    // The shape of a stored string cannot change between boundaries, so the path
    // is dropped rather than written back: keeping it would buy a re-test and a
    // line at every later boundary and no promotion ever.
    delete record.planPath;
    logOnce(
      "turn_record_promotion_refused",
      `record ${record.id} drops the plan path ${path}: it fails the shape the store's own pattern names`,
    );
    return false;
  }
  record.planPath = path;

  const root = deps.session.state.goals.find((g) => g.parentId === null);
  if (root === undefined) {
    noted("no goal tree exists, and only the operator opens one");
    return false;
  }
  if (deps.session.state.goals.some((g) => g.kind === "plan" && g.planPath === path)) {
    noted("the tree already holds a plan entry for that plan document");
    return false;
  }
  const autonomy = deps.session.state.autonomy;
  if (autonomy === "propose") {
    noted("the autonomy level is propose, which proposes through the standing block rather than the tree");
    return false;
  }

  const added = await addGoalEntry(deps, {
    kind: "plan",
    title: record.text,
    objective: `Work the plan document ${path} to completion; its own sections say what done looks like.`,
    parentId: root.id,
    root,
    // The round budget goal_add gives an add that names none.
    maxRounds: 10,
    planPath: path,
    // The plugin's own act, so it announces itself to the coordinator persona
    // at either level, as an add the dial admitted outside the operator's turn
    // does.
    unprompted: true,
    awaitingYes: autonomy === "plan-and-ask",
    dropTaskId: undefined,
    coordinatorPersona,
    architectPersona,
  });
  if (added.ok) return false;
  if (added.failed !== undefined) {
    refused(`the store write failed with ${added.failed}; the plan entry was taken back out of the tree`);
    return true;
  }
  refused(added.deny);
  return false;
}
