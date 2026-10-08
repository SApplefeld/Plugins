// AgentState: the on-disk persistence layer shared by all five loops.
// Access via $.fs.* (read, write, exists).
// One JSON file per project, one owner at a time (the Monitor loop).

/**
 * One piece of untrusted text with the delivery brackets neutralized, under
 * the same rule bracketSafeProblem refuses on and for the same reason: a '['
 * in text the plugin did not compose lets that text forge a delivery label
 * such as [COORDINATOR id=7]. The two are one rule read two ways. A caller
 * who supplies a persona name can be told to pick another, so that path
 * refuses; a file read has nobody to ask, so this path rewrites. Text
 * carrying no bracket comes through byte for byte.
 * The guard belongs to the channel the text leaves by rather than to the
 * field that first needed it, so every site that puts text out of a
 * persona's own tree in front of a model calls this one helper: the fleet
 * report's fields as each is read, the fleet prompt the controller tick
 * submits, over every field it carries, and the turn record's own text, at
 * the clamp below that every writer of that field and the load both call. The
 * prompt takes the wider sweep because a tool result is framed as JSON and a
 * submitted turn is not, so a path the plugin composed loses its own brackets
 * there.
 * It lives in this module, which imports nothing, because the store layer is
 * one of its callers: a module this one imported would be linked eagerly by
 * every suite that reads the store.
 */
export function bracketSafeText(text: string): string {
  return text.replace(/\[/g, "(").replace(/\]/g, ")");
}

/**
 * Where one line of text ends: CRLF, or any one of LF, CR, VT, FF, NEL
 * (U+0085), LINE SEPARATOR (U+2028) or PARAGRAPH SEPARATOR (U+2029). These
 * are the terminators the bracket rule refuses as field splitters, and every
 * site that splits store-sourced or file-sourced text into lines reads the
 * set from here: a splitter that knows only LF and CR leaves a persona four
 * more characters that start a line the reader of that text will see.
 * It sits in this module for the reason bracketSafeText does. The two are one
 * guard on one channel, text the plugin did not compose reaching a model, and
 * the store layer is a caller of both.
 */
export const LINE_TERMINATOR = /\r\n|[\n\r\v\f\u{85}\u{2028}\u{2029}]/u;

/**
 * One line of text, whatever terminators it arrived carrying, each replaced by
 * a single space. This is the fold every context block owes the text it prints,
 * and it belongs to the block rather than to whichever field first needed it:
 * a block the plugin composes whole states the persona's own situation, so a
 * line inside it that the plugin did not write reads as one the plugin did. A
 * forged `WORKING`, `BLOCKED` or `WAITING` lead is the case that costs
 * something, and a status line needs no bracket, so the bracket rule above does
 * not reach it.
 * It sits here with the terminator set and the bracket rule because the three
 * are one guard on one channel. A print that folds with its own copy of this is
 * a second place the set can drift, which is the defect this module exists to
 * make impossible.
 */
export function oneLine(text: string): string {
  return text.split(LINE_TERMINATOR).join(" ");
}

export interface MemoryEntry {
  id: string;
  kind: "fact" | "preference" | "lesson" | "goal" | "eval";
  text: string;
  confidence: number; // 0..1
  source: "worker" | "user" | "distilled" | "self-review";
  createdAt: number; // ms
  lastAccessed: number;
  accessCount: number;
  pinned: boolean; // pinned entries survive decay
  provenance?: {
    decisionTimestamps: number[];
    windowRange?: [number, number];
    streak: number;
    trigger: string;
  };
}

// v2 goal shape (retained for migration only).
export interface GoalState {
  id: string;
  objective: string;
  maxRounds: number;
  completedRounds: number;
  status: "active" | "paused" | "complete" | "blocked";
  blockedReason?: string;
  createdAt: number;
  updatedAt: number;
  scores: Array<{
    round: number;
    result: string;
  }>;
}

// v3 goal-tree node.
export interface GoalNode {
  id: string;
  parentId: string | null; // null for the root
  kind: "root" | "plan" | "task";
  title: string;
  objective: string;
  status: "pending" | "active" | "paused" | "complete" | "abandoned" | "blocked";
  source: "operator" | "controller" | "worker";
  maxRounds: number; // 0 for the root
  completedRounds: number;
  scores: Array<{ round: number; result: string }>;
  notes: string[];
  roadmapPath?: string; // root only: the roadmap file path
  askedBy?: string; // root only: the author the channel envelope named on the
                    // turn goal_create ran in. Absent where the root came from
                    // any other turn or the envelope named no author. The
                    // value is sender-written text, cut at write to
                    // ASKED_BY_MAX_CHARS in hooks/index.ts and
                    // unfolded, so any reader that puts it into a model's
                    // context folds it through bracketSafeText first.
  planningRounds: number; // root only: number of planning events
  consecutiveBlockedPlannings: number; // root only: consecutive all-blocked plannings
  consecutivePlanningFailures: number; // root only (M13): consecutive planner call/parse failures
  planningRound: number; // plan only (M15): which planning round created this node
  createdAt: number;
  updatedAt: number;
  blockedReason?: string;
  sortKey?: number; // plan item 3: activation order key; defaults to createdAt when absent,
                     // so goal_edit's reprioritize can move a pending plan without lying
                     // about when it was actually created.
  lastAskQuestion?: string; // plan item 5 (D5b): the question text of the most
                             // recently closed ask on this node, so the classifier
                             // does not reopen the identical question right away.
  lastAskClosedAt?: number; // when that ask closed (answered, by-reply, or timed out).
  kaizenSignal?: string; // plan item 8.4: set on a plan an earlier self-review loop
                         // raised from the worker's own record, naming the weakness
                         // signal. The loop writes no such node; the tick sends
                         // an open one to the coordinator persona as a finding and
                         // abandons it.
  planPath?: string; // Section 1 (plan-health-from-the-record): the plan document's
                      // path, relative to the persona's working directory, in the
                      // form docs/plans/<name>.md. Set on a plan node only, by
                      // goal_add or filled from the node's own text on load. The
                      // v2/v3 migration itself writes no value; the load-time
                      // fill runs on every migration exit and may fill one.
  lead?: { state: "blocked" | "waiting"; reason: string; at: number } | null; // Section 3:
                      // the worker's own BLOCKED/WAITING first line for a plan entry.
                      // Set and cleared at turn end from the first line of a plan
                      // entry's closing text; a blocked lead is also lifted by
                      // goal_resume and by the idle tick once an ask on the entry
                      // closes after it, and completion by the plan document
                      // clears it. Unset by the v2-v4 migration. holdOf reads it
                      // as the controller's hold; the status is never written for it.
  chapterCount?: number; // Section 2: the number of "### Chapter N" headings the
                      // plan document held at the last read. Written by the
                      // document read at turn end. Unset by the v2-v4 migration.
  sectionCount?: number; // plan-record-sections Section 1: the number of "### N."
                      // headings in the plan document's "## Sections of Work"
                      // block at the last read. Written by the document read
                      // at turn end where it differs, with no updatedAt touch
                      // and no decision. Unset by the v2-v4 migration.
  nextSection?: string; // plan-record-sections Section 1: the first "Next:" line
                      // under the plan document's highest-numbered Chapter at
                      // the last read, folded through oneLine, its whitespace
                      // collapsed and cut to NEXT_LINE_MAX_CHARS in
                      // hooks/plan-record.ts. Written by the document read at
                      // turn end where it differs and removed where the
                      // document has no such line or the line is empty, with
                      // no updatedAt touch and no decision. Unset by the v2-v4
                      // migration. The value keeps its brackets as written, so
                      // any reader that puts it into a model's context folds
                      // it through bracketSafeText first.
  awaitingYes?: boolean; // Set on a plan goal_add queued at the plan-and-ask
                      // autonomy level outside an operator or coordinator turn:
                      // the entry waits paused for the operator's yes, and
                      // goal_resume refuses it outside those turns. Cleared by
                      // an allowed goal_resume, by goal_edit drop, by an
                      // allowed goal_done by name on the entry or a node under
                      // it, and by completion (clearSettledAwaiting).
  foldedChildren?: number; // A complete plan node's count of direct children
                      // whose nodes moved to the goal history file when it
                      // folded (foldablePlans, applyFold). Absent on a node
                      // that never folded. Load drops a value that is not a
                      // positive integer.
}

export interface EnvErrors {
  consecutiveErrorTurns: number;
  toolErrorsLastTurn: number;
  lastErrorAt?: number;
  handledAt?: number;
}

export interface EnvGit {
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  lastCommitAt: number;
  sampledAt: number;
}

export interface EnvHealth {
  command: string[];
  exitCode: number;
  tail: string;
  ranAt: number;
  forNodeId: string | null;
}

export interface EnvState {
  git: EnvGit | null;
  health: EnvHealth | null;
  errors: EnvErrors;
}

// G4: envNotable per plan section 4: dirty > 0 AND last commit older than 30 min;
// health exit non-zero; error streak at least 3 (I2: aligned with controller escalation threshold).
export function envNotable(env: EnvState, now: number): string[] {
  const facts: string[] = [];
  if (env.git && env.git.dirty > 0 && now - env.git.lastCommitAt > 30 * 60_000) {
    facts.push(`git: ${env.git.branch} dirty ${env.git.dirty} ahead ${env.git.ahead} behind ${env.git.behind}`);
  }
  if (env.health && env.health.exitCode !== 0) {
    facts.push(`health: exit ${env.health.exitCode} for ${env.health.forNodeId || "no-node"}`);
  }
  if (env.errors.consecutiveErrorTurns >= 3) {
    facts.push(`errors: streak ${env.errors.consecutiveErrorTurns}`);
  }
  return facts;
}

export interface SentFinding {
  signal: string;
  text: string;
  sentAt: number;
  writer: string;
  seq: number;
  delivered: boolean;
}

// The proposal an idle persona sent the coordinator persona inside a proposal
// turn. `writer` and `seq` key the record in the coordinator persona's inbox,
// and the entry settles as a finding's does: a record read back as delivered,
// answered, resolved or absent sets `delivered`, and one read back as skipped
// is sent again with the same text under a new writer and seq.
export interface SentProposal {
  text: string;
  writer: string;
  seq: number;
  delivered: boolean;
}

// A [PROPOSAL] or [STARTED] record the shared add sent the coordinator persona
// for a plan the autonomy level admitted, whether the model's own goal_add made
// that add or the promotion route did at a turn's end for a record whose turn
// wrote a plan document. `awaitingYes` is true for a [PROPOSAL], whose entry
// waits for the operator's yes, and false for a [STARTED].
// `writer` and `seq` key the record in the coordinator persona's inbox. The
// entry leaves the list once its record reads delivered, answered, resolved
// or absent, once its goal entry no longer needs it, or once a resend has no
// road. A record read back as skipped is sent again under the live session,
// and `resends` counts those sends. Once it reaches PLAN_RECORD_MAX_RESENDS
// in hooks/index.ts, a record read back as skipped is not sent again: the
// entry leaves the list and its text is announced on the persona's own thread.
export interface SentPlanRecord {
  nodeId: string;
  awaitingYes: boolean;
  text: string;
  writer: string;
  seq: number;
  resends: number;
}

// A long-term goal: the idea a persona is working towards. It is held in a
// list beside the goal tree, not as a node in it, and no tree walker reads
// that list, so a long-term goal is never activated and never holds a root
// open. goal_longterm adds and drops entries, and goal_create leaves the list
// as it is.
export interface LongTermGoal {
  id: string;
  title: string;
  objective: string;
  createdAt: number;
}

// The most long-term goals a persona holds at once. The list is shown in a
// prompt, so it is kept short, and goal_longterm refuses an add past it.
export const LONG_TERM_GOAL_CAP = 5;

// The persona's autonomy level: what it may do with work it found on its own.
// The list is closed at these three, in order of widening, and the operator
// alone sets the level, through goal_autonomy. A store with no level, or with
// a value outside the list, reads as "propose".
export const AUTONOMY_LEVELS = ["propose", "plan-and-ask", "plan-and-start"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

// Whether a stored or supplied value is one of the three levels.
export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(value);
}

// One working item on a goal's task list. The list sits beside the goal tree,
// never in it: a task names the goal it belongs to by goalId and lives only as
// long as that goal is open, since reapCompletedGoalTasks drops it once the
// goal is complete or abandoned, or no longer in the tree. A goal_create that
// replaces the tree therefore drops every task the old tree's goals held.
export interface TaskItem {
  id: string;
  goalId: string;
  text: string;
  done: boolean;
  addedAt: number;
  doneAt?: number;
}

// The most tasks one goal holds at once.
export const MAX_TASKS_PER_GOAL = 20;

// The most task lines the injected task list shows before it names the rest
// by count.
export const TASK_LIST_MAX_LINES = 12;

// A task id, minted in the goal nodes' shape: a prefix, the clock in base 36,
// and a random tail. The "tk-" prefix is one no goal node or long-term goal
// carries, so a task id never reads as a goal id.
export function newTaskId(now: number): string {
  return `tk-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// What a turn record can be. The set is closed at these five. "open" is the
// live intention a message arrived with; the other four are closed states a
// record never leaves. "delivered" is the turn that answered it, "superseded"
// a later message that replaced it, "expired" the timeout below, and
// "promoted" a record that became a goal entry or a task.
export const TURN_RECORD_STATUSES = ["open", "delivered", "superseded", "expired", "promoted"] as const;
export type TurnRecordStatus = (typeof TURN_RECORD_STATUSES)[number];

// Whether a stored or supplied value is one of the five statuses.
function isTurnRecordStatus(value: unknown): value is TurnRecordStatus {
  return typeof value === "string" && (TURN_RECORD_STATUSES as readonly string[]).includes(value);
}

// One message held as an intention. A record sits beside the goal tree and
// never in it: nothing that reads `goals`, the idle branch and the nudge among
// them, sees a record, so a record is never scored, budgeted or nudged. At most
// one record is open at a time, which enforceInvariants repairs on load, and a
// record that is not open is closed for good. goalId names the entry the record
// is a step of, where the message stepped one. planPath names the plan document
// the turn wrote, and taskId the task the record became. turnId is absent at the
// open, since the record opens before the turn it belongs to has an id.
//
// pendingStamps carries the record's own unsettled journal outcomes rather than
// anything about the intention. One entry per turn-open call that opened or
// continued this record, each present exactly while that call's
// record_delivered_within outcome is still unwritten: the writer drops an entry
// as it writes its line, which is what holds one call to one outcome line. The
// list is what a continuation needs, because a record carried across several
// messages was opened by one call and continued by others, and each of those
// calls owes an outcome of its own. `turns` counts the persona's own turn
// completions since that entry's own call, which is what the outcome's "within
// three turns" is measured over, so a call that joined a record already three
// messages old is still measured from where it joined.
export interface TurnRecordStamp {
  stampId: string;
  turns: number;
}

// dispositionStamps is the second list of unsettled journal outcomes, for the
// turn-disposition question, and it is a list of its own rather than more
// entries in pendingStamps. The two outcomes settle on different events and
// carry different values: a turn-open call's record_delivered_within settles at
// a delivery or after a counted number of the persona's own turns, while a
// turn-disposition call's next_prompt_kind settles at the next external
// message, to that message's turn-open verdict where one was read and to
// `fallback` where none was, or as `none` once the record has expired, and so
// needs no turn count. The record_delivered_within writer settles and drops
// every entry of pendingStamps by name, so a disposition stamp parked there
// would be answered with the wrong outcome kind and dropped before its own
// writer ran. One entry per turn-disposition call asked over this record, each
// present exactly while its outcome is unwritten; a record open across several
// turn ends holds several.
export interface TurnRecord {
  id: string;
  text: string;
  openedAt: number;
  status: TurnRecordStatus;
  turnId?: string;
  goalId?: string;
  planPath?: string;
  taskId?: string;
  closedAt?: number;
  pendingStamps?: TurnRecordStamp[];
  dispositionStamps?: string[];
}

// Whether a stored or supplied value is one pending stamp. A stamp id that is
// not a string names no call line, and a count the plugin cannot compare against
// the threshold leaves an outcome that is never written, so both are read as
// strictly as closedAt is.
function isTurnRecordStamp(value: unknown): value is TurnRecordStamp {
  const stamp = value as Partial<TurnRecordStamp> | null;
  return !!stamp && typeof stamp === "object"
    && typeof stamp.stampId === "string" && Number.isFinite(stamp.turns);
}

// The most records the store holds at once, counting only the closed ones: the
// cap never drops an open record.
export const TURN_RECORDS_MAX = 20;

// How long an open record stands before the reap expires it. A day, because an
// idle open record costs nothing while it stands (it is never nudged, and it is
// a durable compaction boundary) and holds a stale intention against every
// later message once its turn is long past.
export const TURN_RECORD_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// The most characters a record's text carries. The text is an excerpt of the
// message or one line naming what it asked, so it is cut rather than refused.
export const TURN_RECORD_TEXT_MAX = 80;

// Cuts a record's text to the maximum above and neutralizes its brackets. Both
// belong to the record field rather than to whichever caller first needed them,
// so every producer of a record's text calls this: the load, which reads a store
// the plugin did not write, and the sites that open a record from a message or
// from a worded line. A producer that cuts the text by hand instead reproduces
// the length it can see and drops whatever this rule gains later.
//
// The text is an external message, and goal_status prints it into a tool result
// the model reads, one line above the tree, beside lines whose own text is
// guarded there. So a '[' in it could forge a delivery or authority label such
// as [SUPERVISOR-ASK id=1] or [COORDINATOR id=7], which bracketSafeText is the
// one rule for. The guard runs here rather than at that print, so every reader
// of the field inherits it and no future one has to remember.
//
// The line terminators are folded for the same reason and at the same place.
// The record's text is also a goal entry's title once the promotion route
// stores it there, and the prompt hook writes a title into the goal-tree block
// unfolded, on a line of its own. So a terminator inside the text starts a line
// in that block, where a forged WORKING, BLOCKED or WAITING lead would read as
// the plugin's own. Brackets cannot be forged past the rule above, and a status
// line needs no bracket. The order is the one every other guarded field takes:
// cut to length, fold to one line, then neutralize the brackets.
export function clampTurnRecordText(text: string): string {
  const cut = text.length > TURN_RECORD_TEXT_MAX ? text.slice(0, TURN_RECORD_TEXT_MAX) : text;
  return bracketSafeText(oneLine(cut));
}

// A record id, minted in the goal nodes' shape: a prefix, the clock in base 36,
// and a random tail. The "tr-" prefix is one no goal node, long-term goal or
// task carries, so a record id never reads as a goal id or a task id.
export function newTurnRecordId(now: number): string {
  return `tr-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface MonitorState {
  sessionStart: number;
  turnCount: number;
  lastTurnId?: string;
  lastTurnComplete?: number;
  totalToolCalls: number;
  errors: number;
  env: EnvState;
  selfReview: {
    count: number;          // reviews in the current hourly window
    lastAt: number;         // 0 = never
    turnsSince: number;     // turns since last review (0 = fresh / just reviewed)
    windowStart: number;    // ms; reset count when now - windowStart >= 3600000
    pendingPeriodic: boolean; // set by goal_done, consumed by tick (S9)
    lastInjectAt: number;   // 0 = never; gates lesson_inject (S11)
    // The finder's ledger of the self-review findings it sent. The inbox
    // record is only the carrier: a record can be skipped, and a delivered
    // one is swept, so this list is what the settle step reads back and what
    // the cool-off counts from. `writer` and `seq` key the record in the
    // coordinator persona's inbox; an entry announced on the persona's own
    // thread instead carries an empty writer and a seq of 0.
    sent: SentFinding[];
  };
  // The idle proposal. `askedAt` is the clock at the last [PROPOSE] turn, 0
  // before the first, and the next ask waits PROPOSAL_EVERY_MS from it.
  // `sent` is the proposal the persona sent in answer, null where it sent
  // none; each ask clears it.
  proposal: {
    askedAt: number;
    sent: SentProposal | null;
  };
  // The records goal_add sent for plans the autonomy level admitted, which a
  // quiet tick reads back while their entries still need them.
  planRecords: SentPlanRecord[];
  cost: {
    classify: { count: number; estTokens: number };
    reason: { count: number; estTokens: number };
    selfReview: { count: number; estTokens: number };
    planner: { count: number; estTokens: number };
    nudge: { count: number };
    forkUsage: null | { inputTokens: number; outputTokens: number };
    consecutiveSkips: number;
    nudgeWindow: { start: number; count: number };
    callWindow: { start: number; count: number };
    lastSummaryHash: number; // FNV-1a hash of the stable summary subset for D2
    capNoticeWindowStart: number; // AK2: latches cost_cap_reached to one emission per window
  };
}

export interface NudgeBudget {
  lastNudgeAt: number;
  consecutiveNudgesWithoutOnGoal: number;
}

/**
 * The five health classes the steward reports on. Each is one word for a whole
 * fleet row. The fourth is not a variant of the third: an enabled persona that
 * has never come up has no commons entry at all, so it reports a null
 * heartbeat age and satisfies none of the other four.
 *
 * They live here beside the memo the watcher's reading is made of, which is
 * written in these words.
 */
export const FLEET_HEALTH = {
  held: "held",
  backingOff: "backing off",
  stale: "stale",
  noClaim: "no live claim while the roster enables it",
  healthy: "healthy",
} as const;
export type FleetHealth = (typeof FLEET_HEALTH)[keyof typeof FLEET_HEALTH];

/**
 * What a class value carries when the roster's own entry for that persona is
 * disabled. The roster flag is part of the value the watcher compares rather
 * than a field beside it, so flipping an entry to disabled is itself a change
 * with a line of its own. Without that the flip is invisible: a running
 * persona reads the same class either way, and once it exits its commons entry
 * ages out and the disabled branch reads healthy again, so a persona can write
 * `"enabled": false` into its own roster entry, exit, and leave the fleet with
 * nothing reported before, during or after.
 */
export const FLEET_DISABLED_TAIL = " under a disabled roster entry";

/**
 * What a class value carries when the process keeper has written no state file
 * for that persona. An absent keeper.json is the one unread thing the health
 * reduction passes over, because a persona on its first-ever launch has none
 * for the whole of that run, and that reading is borrowable: the file sits in
 * the persona's own run directory, so a persona whose class the watcher is
 * reporting can delete it and fall back to healthy, which the quiet window
 * then holds back. The file's presence is part of the value compared for that
 * reason, so gaining or losing it is a change with a line of its own whatever
 * the class does.
 */
export const FLEET_KEEPER_UNWRITTEN_TAIL = " with no keeper state written";

/**
 * The value the watcher compares and stores for one persona: its health class,
 * whether the roster enables it, and whether the process keeper has written
 * any state for it. The two qualifiers are independent, so a value can carry
 * both, and they are appended in a fixed order because this text is compared
 * as text.
 */
export function fleetClassValue(health: FleetHealth, enabled: boolean, keeperStateUnwritten: boolean): string {
  const disabled = enabled ? "" : FLEET_DISABLED_TAIL;
  return `${health}${disabled}${keeperStateUnwritten ? FLEET_KEEPER_UNWRITTEN_TAIL : ""}`;
}

/**
 * Two of the three entries the watcher's reading holds that are not personas:
 * how the roster file itself read, and what its entries could not be turned
 * into. The third, how the last controller tick ended, belongs to the tick and
 * is named there. All three keys carry spaces, which the persona-name rule
 * refuses, so no roster persona can take any of them.
 */
export const FLEET_ROSTER_STATE_KEY = "the roster reading itself";
export const FLEET_ENTRY_PROBLEMS_KEY = "the roster entries that carry a problem";

/**
 * What the controller tick's fleet watcher remembers about one key of its
 * reading between ticks.
 *
 * `class` is the class the last reading produced, which is what a further
 * reading is compared against. `reported` is the class the last line the
 * watcher submitted actually named, which is what the operator was last told,
 * and it is the empty string while no line has been submitted at all. The two
 * differ whenever a change was counted rather than reported, and every line
 * the watcher composes reads its `from` out of `reported`, so a line never
 * names a class nobody was told.
 *
 * `reportedAt` is the clock at that line, 0 when there has been none, and it
 * is what the quiet window runs from: one line per key per window, whatever
 * the class does in between. `suppressed` is how many class changes have
 * happened since that line with no line of their own, and it rides the next
 * line about the key.
 *
 * `departed` is true between the line reporting that a cleanly read roster has
 * stopped naming this persona and the reading that names it again. It is what
 * makes that departure one line rather than one per tick, and the memo stands
 * throughout, so a name that comes back is compared against the class the
 * operator was last told rather than read as a persona nothing is known about.
 *
 * `class` and `reported` are typed as plain strings because the reading holds
 * three keys that are not personas, and those three take their value from text
 * the roster file and the tick supplied rather than from the class list.
 *
 * The reading these memos make up is held in the session's own memory for the
 * life of that session and is written to no file, so every memo the watcher
 * compares against is one the watcher itself produced on an earlier tick of
 * this same session.
 */
export interface FleetHealthMemo {
  class: string;
  reported: string;
  reportedAt: number;
  suppressed: number;
  departed: boolean;
}

// One record the per-prompt read showed the worker, from the kit's memory
// store. name is the record's name there, goalId the goal entry active when it
// was shown or null where none was, and shownAt the clock it was last shown
// at. The list holds one entry per name per goal, newest last.
export interface ShownMemory {
  name: string;
  goalId: string | null;
  shownAt: number;
}

// The most shown records the store holds at once. The oldest goes first.
export const SHOWN_MEMORIES_MAX = 50;

// Records that the read showed `name` under `goalId` at `now`. An entry
// already held for the same name under the same goal is removed first, so a
// record shown on several prompts of one goal is one entry, newest last, and
// the goal's close asks about it once. The list is then cut to
// SHOWN_MEMORIES_MAX from the front.
export function recordShownMemory(state: AgentState, name: string, goalId: string | null, now: number): void {
  const kept = state.shownMemories.filter((m) => !(m.name === name && m.goalId === goalId));
  kept.push({ name, goalId, shownAt: now });
  state.shownMemories = kept.slice(-SHOWN_MEMORIES_MAX);
}

// Whether a stored entry is a shown record: a non-empty name, a goalId that is
// a string or null, and a finite shownAt.
function isShownMemory(value: unknown): value is ShownMemory {
  const entry = value as Partial<ShownMemory> | null;
  return !!entry && typeof entry === "object"
    && typeof entry.name === "string" && entry.name !== ""
    && (typeof entry.goalId === "string" || entry.goalId === null)
    && Number.isFinite(entry.shownAt);
}

// Who opened an ask: the worker's own ASK: line, or one of the three asks the
// controller opens when the work cannot go on as it stands.
export const ASK_OPENERS = ["worker", "error-streak", "nudge-cap", "cost-cap"] as const;
export type AskOpener = (typeof ASK_OPENERS)[number];

// How a ledger entry stands. "open" is the one live status. "answered",
// "stood" (the assumption held and the question no longer matters),
// "withdrawn" and "superseded" (the tree it rose from was replaced) are the
// closes a close route writes. "expired" is written by the owner start alone,
// for a seeded entry whose commons record is not open.
export const ASK_ENTRY_STATUSES = ["open", "answered", "stood", "withdrawn", "superseded", "expired"] as const;
export type AskEntryStatus = (typeof ASK_ENTRY_STATUSES)[number];
export type AskClosedStatus = Exclude<AskEntryStatus, "open">;

// The route that closed an entry: the ask_close tool, a reader's answer
// record named by id, goal_done, goal_create, or the owner start's reconcile.
export type AskClosedBy = "ask_close" | `record ${string}` | "goal_done" | "goal_create" | "owner_start";

// One question to the operator, on the ledger the persona keeps in its state.
// The ledger is the owner's truth about its asks; the commons record of the
// same id is a mirror a reader session answers through. Every field is
// present on every entry, null where it has no value yet, because the Discord
// relay reads this file whole and lists an open entry's fields. `question` is
// the worker's line whole, "Recommend:" included, stored as given, since the
// relay renders it. `recommend` is the text after "Recommend:", which is the
// assumption the work proceeds on. `blocking` is whether the work is stopped
// on the answer; it is cleared by a lift and never set again. `answer` is a
// note of at most ASK_ANSWER_MAX characters taken at close.
export interface AskEntry {
  id: string; // ask-<nodeId>-<ms>
  nodeId: string;
  planPath: string | null; // the node's, where it has one
  entryTitle: string;
  question: string;
  recommend: string;
  opener: AskOpener;
  blocking: boolean;
  openedAt: number;
  reraisedAt: number | null;
  status: AskEntryStatus;
  closedAt: number | null;
  closedBy: AskClosedBy | null;
  answer: string | null;
}

// The most open entries the ledger holds at once; an open past it is refused.
export const ASKS_OPEN_MAX = 16;
// The most entries the ledger holds in all, open and closed; the persist prune
// drops the oldest closed to meet it, and never an open one.
export const ASKS_MAX = 64;
// How long a closed entry stays on the ledger, so a card can show "answered"
// for a while, before the persist prune drops it.
export const ASK_CLOSED_KEEP_MS = 7 * 24 * 60 * 60_000;
// The longest a close note runs.
export const ASK_ANSWER_MAX = 300;

// The question a seeded entry carries. The version 8 store held one ask id and
// no question, since the question lived in the commons record alone, so the
// migration seeds the entry with this text and the owner start's reconcile
// fills the record's question in or closes the entry. The reconcile knows a
// seeded entry by this text, so no opener may write it as a question.
export const ASK_SEED_QUESTION = "(question held in the commons record)";

// The fields an open takes. The caller builds the id, in the form the ledger
// stores, so the sites that open an ask keep the id form they write today.
export interface AskOpening {
  id: string;
  nodeId: string;
  planPath: string | null;
  entryTitle: string;
  question: string;
  recommend: string;
  opener: AskOpener;
  blocking: boolean;
}

// The open entries, oldest first, as the ledger holds them.
export function openAskEntries(state: AgentState): AskEntry[] {
  return state.asks.filter((entry) => entry.status === "open");
}

// The open entries the work is stopped on. This is the predicate the hold and
// every reader that decides a hold take: an open entry that is not blocking is
// a question the operator still owns, and no reason to stop.
export function openBlockingAsks(state: AgentState): AskEntry[] {
  return state.asks.filter((entry) => entry.status === "open" && entry.blocking);
}

function openAskEntry(state: AgentState, id: string): AskEntry | undefined {
  return state.asks.find((entry) => entry.id === id && entry.status === "open");
}

// Why openAsk refused an opening: "cap" where ASKS_OPEN_MAX entries are
// already open, "duplicate" where an entry of the same id already stands on
// the ledger, open or closed, since a close finds its entry by id, and "seed"
// where the question is ASK_SEED_QUESTION, which only the migration writes, so
// no live ask can pass for a seeded one at the owner start.
export type AskOpenRefusal = "cap" | "duplicate" | "seed";

// Opens one entry at `now` and returns it, or returns the refusal and writes
// nothing. The caller logs a "cap" refusal as ask_cap_refused and writes no
// commons record for any refusal.
export function openAsk(state: AgentState, opening: AskOpening, now: number): AskEntry | AskOpenRefusal {
  if (openAskEntries(state).length >= ASKS_OPEN_MAX) return "cap";
  if (state.asks.some((entry) => entry.id === opening.id)) return "duplicate";
  if (opening.question === ASK_SEED_QUESTION) return "seed";
  const entry: AskEntry = {
    id: opening.id,
    nodeId: opening.nodeId,
    planPath: opening.planPath,
    entryTitle: opening.entryTitle,
    question: opening.question,
    recommend: opening.recommend,
    opener: opening.opener,
    blocking: opening.blocking,
    openedAt: now,
    reraisedAt: null,
    status: "open",
    closedAt: null,
    closedBy: null,
    answer: null,
  };
  state.asks.push(entry);
  return entry;
}

// Closes the open entry `id` names with `status`, the route that closed it and
// a note cut to ASK_ANSWER_MAX, and returns it. Returns null and changes
// nothing where no open entry carries that id, so a closed or unknown id is
// never closed twice. The caller writes the same status onto the commons
// record in the same step.
export function closeAsk(state: AgentState, id: string, status: AskClosedStatus, closedBy: AskClosedBy, answer: string | null, now: number): AskEntry | null {
  const entry = openAskEntry(state, id);
  if (!entry) return null;
  entry.status = status;
  entry.closedAt = now;
  entry.closedBy = closedBy;
  entry.answer = answer === null ? null : answer.slice(0, ASK_ANSWER_MAX);
  return entry;
}

// Clears `blocking` on the open entry `id` names and returns it, or null where
// no open entry carries that id. The entry stays open: the question is still
// the operator's to answer, and only the hold on the work is lifted.
export function liftAsk(state: AgentState, id: string): AskEntry | null {
  const entry = openAskEntry(state, id);
  if (!entry) return null;
  entry.blocking = false;
  return entry;
}

// The ledger's bounds, run at every store write. A closed entry whose close
// is ASK_CLOSED_KEEP_MS or more behind `now` drops. Then, while the list runs
// past ASKS_MAX, the closed entry with the oldest close drops. An open entry
// never drops here, whatever the count: the open cap is openAsk's refusal.
export function pruneAsks(state: AgentState, now: number): void {
  const closeOf = (entry: AskEntry): number => entry.closedAt ?? entry.openedAt;
  let kept = state.asks.filter((entry) => entry.status === "open" || now - closeOf(entry) < ASK_CLOSED_KEEP_MS);
  while (kept.length > ASKS_MAX) {
    let oldest: AskEntry | undefined;
    for (const entry of kept) {
      if (entry.status === "open") continue;
      if (!oldest || closeOf(entry) < closeOf(oldest)) oldest = entry;
    }
    if (!oldest) break;
    kept = kept.filter((entry) => entry !== oldest);
  }
  state.asks = kept;
}

// Whether a value is a close route: one of the four named routes, or a
// reader's answer record named as "record <id>".
function isAskClosedBy(value: unknown): value is AskClosedBy {
  return value === "ask_close" || value === "goal_done" || value === "goal_create" || value === "owner_start"
    || (typeof value === "string" && value.startsWith("record ") && value.length > "record ".length);
}

// Whether a stored value is a ledger entry. Every field must hold a value of
// its type, null where the field is nullable, and the close fields must agree
// with the status: an open entry carries no close clock and no route, and a
// closed one carries both, the route in one of the forms isAskClosedBy names.
// An entry missing a field, carrying another type or disagreeing with itself
// is not an entry and the load drops it.
function isAskEntry(value: unknown): value is AskEntry {
  const entry = value as Partial<Record<keyof AskEntry, unknown>> | null;
  if (!entry || typeof entry !== "object") return false;
  const stringOrNull = (v: unknown): boolean => typeof v === "string" || v === null;
  const finiteOrNull = (v: unknown): boolean => Number.isFinite(v) || v === null;
  const closeFieldsAgree = entry.status === "open"
    ? entry.closedAt === null && entry.closedBy === null
    : Number.isFinite(entry.closedAt) && isAskClosedBy(entry.closedBy);
  return typeof entry.id === "string" && entry.id !== ""
    && typeof entry.nodeId === "string"
    && stringOrNull(entry.planPath)
    && typeof entry.entryTitle === "string"
    && typeof entry.question === "string"
    && typeof entry.recommend === "string"
    && (ASK_OPENERS as readonly string[]).includes(entry.opener as string)
    && typeof entry.blocking === "boolean"
    && Number.isFinite(entry.openedAt)
    && finiteOrNull(entry.reraisedAt)
    && (ASK_ENTRY_STATUSES as readonly string[]).includes(entry.status as string)
    && finiteOrNull(entry.closedAt)
    && stringOrNull(entry.closedBy)
    && closeFieldsAgree
    && stringOrNull(entry.answer);
}

// The ledger as a load fills it. A stored list keeps every value that is an
// entry and drops the rest, and a stored value that is not a list reads as an
// empty one, as the shown records do. A store with no asks key at all is a
// version 8 store, which held one ask as an id in pendingAskId and its
// question in the commons record alone: a non-empty id seeds one open blocking
// entry of opener "worker" with ASK_SEED_QUESTION as its question, and an
// empty slot seeds an empty list. The seed reads the slot off the stored
// object, since AgentState carries no such field, and then drops it from the
// object, so no store write carries a slot nothing reads. The owner start's
// reconcile fills the seeded question from the record or closes the entry as
// expired. A second load finds the key and seeds nothing, whatever the slot
// holds.
function fillAsks(state: AgentState, now: number): void {
  const stored = (state as { asks?: unknown }).asks;
  const slot = (state as { pendingAskId?: unknown }).pendingAskId;
  delete (state as { pendingAskId?: unknown }).pendingAskId;
  if (stored !== undefined) {
    state.asks = Array.isArray(stored) ? stored.filter(isAskEntry) : [];
    return;
  }
  if (typeof slot !== "string" || slot === "") {
    state.asks = [];
    return;
  }
  // The id form is ask-<nodeId>-<ms>, and a node id can itself carry hyphens,
  // so the node is what stands between the prefix and the last run of digits.
  const parts = /^ask-(.+)-(\d+)$/.exec(slot);
  const nodeId = parts ? parts[1] : "unknown";
  const openedAt = parts ? Number(parts[2]) : now;
  const node = state.goals.find((g) => g.id === nodeId);
  state.asks = [{
    id: slot,
    nodeId,
    planPath: node?.planPath ?? null,
    entryTitle: node?.title ?? "",
    question: ASK_SEED_QUESTION,
    recommend: "",
    opener: "worker",
    blocking: true,
    openedAt: Number.isFinite(openedAt) ? openedAt : now,
    reraisedAt: null,
    status: "open",
    closedAt: null,
    closedBy: null,
    answer: null,
  }];
}

export interface AgentState {
  version: 9;
  persona: string;
  activeSessionId: string;
  epoch: number;
  previousSessionIds: string[]; // the sessions that held the persona before, newest first; see recordPreviousSession
  memory: MemoryEntry[];
  goals: GoalNode[];
  tasks: TaskItem[]; // beside the tree, each keyed to a goal; see TaskItem
  turnRecords: TurnRecord[]; // beside the tree, one message each; see TurnRecord
  shownMemories: ShownMemory[]; // the store's records the read showed; see ShownMemory
  activeGoalId: string | null;
  longTermGoals: LongTermGoal[]; // beside the tree, never in it; see LongTermGoal
  autonomy: AutonomyLevel; // set only by goal_autonomy; see AUTONOMY_LEVELS
  monitor: MonitorState;
  nudge: NudgeBudget;
  asks: AskEntry[]; // the ledger of asks to the operator, open and recently closed; see AskEntry
  decisions: Array<{
    timestamp: number;
    loop: "memory" | "goal" | "monitor" | "worker";
    action: string;
    detail: string;
    askId?: string; // on ask_timeout alone: the ledger entry the timeout lifted
  }>;
  // The clock at the last [RECONCILE] prompt, for the coordinator persona
  // alone. It lives in the persisted state rather than in the session's own
  // memory because the reconciliation cadence is four hours and a steward
  // relaunched more often than that would otherwise restart the wait at every
  // launch and never reconcile at all. It is absent until the watcher's first
  // tick, which stamps it rather than firing the pass.
  //
  // The fleet watcher's reading is not here. It is held in session memory, so
  // nothing a file carries can decide what the watcher says about a persona;
  // the cost of that is a steward restating each currently unhealthy persona
  // once when it comes up.
  lastReconcileAt?: number;
  createdAt: number;
  updatedAt: number;
}

// Decision log cap: keep the most recent N entries.
export const DECISIONS_MAX = 200;

// Item 5 (Bounded store): memory cap, enforced at push time in persist().
// Pinned entries are never evicted regardless of this cap.
export const MEMORY_MAX = 50;

// Section 1 (plan-health-from-the-record): the shape a plan node's planPath
// must hold. Anchored at both ends, so a value like "x/docs/plans/a.md" or
// "docs/plans/a.md/x" is refused rather than admitted by a partial match.
// This guards one producer, goal_add: a value it would refuse (a ".."
// segment, a subdirectory, a drive letter, a non-.md suffix) is never
// written to an entry by that tool. The store is the other producer, and a
// planPath read back out of it is not re-tested here, so a hand-edited or
// foreign-written store can carry any value at all. Section 2 joins a
// planPath onto the persona's working directory and reads the file it
// names. Its reader owes that value a re-test against this pattern before
// the join, since nothing between the store and the join performs one.
export const PLAN_PATH_PATTERN = /^docs\/plans\/[A-Za-z0-9][A-Za-z0-9._-]{0,250}\.md$/;

// The same shape, found inside free text (a node's title or objective), used
// to fill planPath on load for a plan node that lacks one. The lazy body
// stops at the first ".md", and the negative lookahead refuses to end the
// match inside a longer filename; together they leave a path's own trailing
// punctuation (a comma, a full stop) outside the capture, exactly as a
// worker writes it in prose.
//
// The lookbehind guards the LEFT edge the same way the lookahead guards the
// right. Without it the pattern matches inside a longer token: "finish
// ../docs/plans/a_v1.md", a URL such as
// "https://host/repo/docs/plans/a_v1.md", and a Windows path such as
// "D:\other_repo\docs/plans/a_v1.md" each fill planPath with
// "docs/plans/a_v1.md", a different file from the one actually named, with
// no signal that a rewrite happened. The excluded set covers the characters
// a longer path or filename puts immediately before "docs": letters,
// digits, ".", "_" and "-" (filename characters), "/" and "\" (path
// separators, the second being the one this host's own paths carry), and
// ":" (a drive-relative path such as "D:docs/plans/a_v1.md", which names a
// file under that drive's own current directory rather than this repo's).
// It is a set wide enough for the token shapes above rather than a proof
// that no other character can precede a longer token.
//
// A shape guard cannot stand in for this edge. Every rewrite above yields a
// capture that is itself well formed, so re-testing the capture against
// PLAN_PATH_PATTERN passes it. The left edge is the only thing that refuses
// a path belonging to another tree.
//
// The right edge is guarded by a class of its own, narrower than the
// left's, in three parts. A filename character ends the match inside a
// longer name. A "." followed by a letter or digit is a further extension,
// so "docs/plans/a_v1.md.bak" names a different file. A "/" makes the match
// a directory prefix of a longer path, as in "docs/plans/a_v1.md/notes". A
// "." followed by anything else is ordinary sentence punctuation and stays
// outside the capture, which is how a worker's own prose writes the path.
export const PLAN_PATH_TEXT_PATTERN = /(?<![A-Za-z0-9._/:\\-])(docs\/plans\/[A-Za-z0-9][A-Za-z0-9._-]{0,250}?\.md)(?![A-Za-z0-9_-]|\.[A-Za-z0-9]|\/)/;

// The plain-language form of PLAN_PATH_PATTERN, named in every goal_add
// refusal so a worker sees the required shape rather than a regex literal.
export const PLAN_PATH_REQUIRED_FORM =
  'planPath must be a project-relative path of the form "docs/plans/<name>.md": ' +
  "no leading slash, no drive letter, no further path segments, and a name " +
  "starting with a letter or digit and using only letters, digits, \".\", \"_\" or \"-\".";

// How long a waiting lead holds the controller's idle branch, measured from
// the clock the lead was read at. Past it the branch runs as usual with the
// lead left on the entry.
export const LEAD_WAITING_HOLD_MS = 60 * 60_000;

// The one reason the controller's idle branch must not nudge, or null. The
// set is closed at three, read in this order with the first that holds
// returned: an open blocking ask on the ledger, whatever opened it, since the
// nudge cap, the cost cap, the error streak and a worker's ASK: line under a
// BLOCKED: lead each hold by opening one, while an open ask that is not
// blocking holds nothing; a blocked lead on the active entry; and a waiting
// lead on the active entry inside LEAD_WAITING_HOLD_MS of its read. The hold
// is computed here from the ledger and the lead and stored nowhere, so nothing
// can drift from it, and no goal status takes part: an entry the controller
// holds stays active.
//
// The active entry is the one activeGoalId names, the same read the tick
// makes, and its lead is read only where the entry is a plan entry by
// resolvePlanPath's ancestor rule, since only a plan entry's turns write or
// clear a lead and a stale lead on a task entry would otherwise hold forever.
// A blocked lead an ask has since settled is the caller's to clear before
// this read (the tick logs lead_cleared for it).
export type HoldReason = "ask" | "blocked" | "waiting";

export function holdOf(state: AgentState, now: number): HoldReason | null {
  if (openBlockingAsks(state).length > 0) return "ask";
  const active = state.activeGoalId ? state.goals.find((g) => g.id === state.activeGoalId) : undefined;
  if (!active || active.status !== "active" || !active.lead) return null;
  if (resolvePlanPath(state, active) === undefined) return null;
  if (active.lead.state === "blocked") return "blocked";
  if (active.lead.state === "waiting" && now - active.lead.at < LEAD_WAITING_HOLD_MS) return "waiting";
  return null;
}

// How many earlier holders the lineage ring keeps. The restart recap reads the
// newest two by default, and the third keeps the working session in reach when
// the relaunch after it died before its first turn and left an empty transcript.
export const PREVIOUS_SESSIONS_MAX = 3;

// The longest a stored id runs in agentic_identity's answer. A session id is
// 36 characters, so the cut touches only text no session wrote.
export const PREVIOUS_SESSION_ID_TEXT_MAX = 64;

// The lineage write every claim site makes on the state before the write that
// publishes its claim, so that one write carries both. outgoingId is the
// session the claim replaces, as that site knows it. It goes to the front of
// the ring where it is a non-empty string other than this session's own id,
// an earlier copy of it is dropped, and the ring is cut to
// PREVIOUS_SESSIONS_MAX. The own id is dropped from the ring too, so the ring
// never names the session that holds the persona now.
export function recordPreviousSession(state: AgentState, outgoingId: unknown, ownId: string): void {
  const ring = state.previousSessionIds.filter((id) => id !== ownId);
  const next = typeof outgoingId === "string" && outgoingId !== "" && outgoingId !== ownId
    ? [outgoingId, ...ring.filter((id) => id !== outgoingId)]
    : ring;
  state.previousSessionIds = next.slice(0, PREVIOUS_SESSIONS_MAX);
}

// The lineage as agentic_identity reports it, one sentence. The ids come out
// of a store file any local process can write, so each takes the guard every
// site putting store text in front of a model applies, in its order: cut to
// length, fold to one line, then neutralize the brackets.
export function previousSessionsText(state: AgentState): string {
  if (state.previousSessionIds.length === 0) return "Previous sessions: none recorded.";
  return `Previous sessions, newest first: ${state.previousSessionIds.map((id) => bracketSafeText(oneLine(id.slice(0, PREVIOUS_SESSION_ID_TEXT_MAX)))).join(", ")}.`;
}

// Default state (per persona)
export function createDefaultState(persona: string, sessionId: string): AgentState {
  const now = Date.now();
  return {
    version: 9,
    persona,
    activeSessionId: sessionId,
    epoch: 1,
    previousSessionIds: [],
    memory: [],
    goals: [],
    tasks: [],
    turnRecords: [],
    shownMemories: [],
    activeGoalId: null,
    longTermGoals: [],
    autonomy: "propose",
    asks: [],
    monitor: {
      sessionStart: now,
      turnCount: 0,
      totalToolCalls: 0,
      errors: 0,
      env: {
        git: null,
        health: null,
        errors: { consecutiveErrorTurns: 0, toolErrorsLastTurn: 0 },
      },
      selfReview: { count: 0, lastAt: 0, turnsSince: 0, windowStart: 0, pendingPeriodic: false, lastInjectAt: 0, sent: [] },
      proposal: { askedAt: 0, sent: null },
      planRecords: [],
      cost: {
        classify: { count: 0, estTokens: 0 },
        reason: { count: 0, estTokens: 0 },
        selfReview: { count: 0, estTokens: 0 },
        planner: { count: 0, estTokens: 0 },
        nudge: { count: 0 },
        forkUsage: null,
        consecutiveSkips: 0,
        nudgeWindow: { start: 0, count: 0 },
        callWindow: { start: 0, count: 0 },
        lastSummaryHash: 0,
        capNoticeWindowStart: 0,
      },
    },
    nudge: { lastNudgeAt: 0, consecutiveNudgesWithoutOnGoal: 0 },
    decisions: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Serialize/deserialize
export function serializeState(state: AgentState): string {
  return JSON.stringify(state, null, 2);
}

// Section 1 (plan-health-from-the-record): the store-load side of the plan
// path. Runs once per load, on every version's exit, since a plan node can
// come from a v2 store's migration as easily as a v4 one. Idempotent, one
// test per step: the fill skips a node that already carries planPath, and
// the recovery skips an entry that is not the exact frozen shape below, so
// a second load over the same store changes nothing.
//
// Fill: a plan node loaded without planPath gets one from the first capture
// of PLAN_PATH_TEXT_PATTERN in its title, then (only if the title held none)
// its objective. A node naming no plan document in either field gains none.
// Each field is read only when it is a string, since a stored node can lack
// either one or hold a value of another type, and these call sites sit
// outside the try that produces the "store could not be read" fallback: a
// throw here stops the session coming up at all.
//
// Recover: a node frozen by the round budget - status "blocked",
// blockedReason exactly "Max rounds reached" - and which HAS a plan by the
// ancestor rule (Standing Brief Amendment: a plan entry is one that has a
// plan by that rule, never one whose kind is "plan") returns to "pending"
// with the reason cleared (undefined, the same absent value goal_resume's
// own clear leaves behind) and completedRounds reset to 0, since a node left
// at its maxRounds re-blocks on its first scored round. The ancestor rule
// rather than kind is what it keys on: the scorer blocks the active LEAF and
// a plan node with children is never the active leaf, so the frozen entry is
// usually a task under a plan node, and no goal tool reopens a blocked entry.
// resolvePlanPath is the same ancestor walk Section 2's reader uses, so both
// sides of "has a plan" agree.
//
// A node is freed only where the freed entry can be consumed, on two tests.
// The root must be live, because isActivationEligible exempts the root from
// its status test, so otherwise a recovered entry is activatable under a root
// that is complete, abandoned or blocked. That test reuses the exact three
// statuses isPlanningDue already names, and the root is found the way every
// other helper here finds it: state.goals.find(g => g.parentId === null).
// And a freed node is consumed through a leaf. A childless node is that leaf.
// A node WITH children is reached through them, since activateNext's DFS
// filters each level on "pending", tries isActivationEligible on each
// candidate and descends where it fails, so a pending parent yields its
// pending leaf. Such a node is freed only when at least one child is pending
// once this pass has been applied. Where every child is complete, abandoned
// or still blocked, freeing it yields no activatable leaf while isPlanningDue
// reads the pending node as work in hand and holds the planner back, so it
// stays blocked.
//
// The fill and the recovery run as two passes over state.goals, and the
// recovery is computed whole to a fixpoint before any of it is applied. The
// recovery reads an ancestor's planPath through resolvePlanPath and that
// ancestor can sit after the node in the array, and accepting one entry can
// be what makes its parent's child test pass. Sweeping until a sweep accepts
// nothing yields the least set satisfying both tests, independent of the
// array's order, which nothing states or enforces. The bound is the node
// count, since each sweep past the first accepts at least one node.
//
// The ancestors between a frozen entry and the root, excluding the root,
// decide the recovery with it. A plan parent whose blockedReason is exactly
// "Child task blocked" holds that status only from completeLeaf's upward walk
// over a blocked child, so it is the same round budget one hop up and returns
// to "pending" with the entry. An ancestor frozen by the round budget itself
// and carrying a plan is freed on the same ground, its own child test
// satisfied by construction since the entry beneath it becomes pending in the
// same pass. Leaving either blocked would leave the entry pending and
// reachable by nothing: isActivationEligible refuses a node whose ancestor is
// not pending, activateNext's DFS filters each level on "pending" and so
// never descends to it, and isPlanningDue reads the pending descendant as
// work in hand and does not run the planner. An ancestor in any other state
// refuses the whole recovery, and the chain is decided before any of it is
// mutated, so a refusal high in the chain cannot leave the lower half
// cleared.
function blockedAncestorsToFree(state: AgentState, node: GoalNode): GoalNode[] | undefined {
  const toFree: GoalNode[] = [];
  let current = node;
  // The walk is bounded by the node count, the same guard isActivationEligible
  // and resolvePlanPath use against a parentId cycle.
  let steps = state.goals.length;
  while (current.parentId) {
    if (steps-- <= 0) return undefined;
    const parent = state.goals.find((g) => g.id === current.parentId);
    // A missing parent is a chain activateNext's DFS from the root cannot
    // walk down, so the entry would be unreachable freed.
    if (!parent) return undefined;
    if (parent.parentId === null) break; // the root, which the caller's own liveness test owns
    if (parent.status === "blocked" && parent.blockedReason === "Child task blocked") {
      toFree.push(parent);
    } else if (parent.status === "blocked" && parent.blockedReason === "Max rounds reached"
      && resolvePlanPath(state, parent) !== undefined) {
      toFree.push(parent);
    } else if (parent.status !== "pending" && parent.status !== "active") {
      // "active" is accepted because enforceInvariants, which demotes an
      // active node that has children, runs after this.
      return undefined;
    }
    current = parent;
  }
  return toFree;
}

function applyPlanRecordOnLoad(state: AgentState): void {
  for (const node of state.goals) {
    if (node.kind === "plan" && !node.planPath) {
      const fromTitle = typeof node.title === "string" ? node.title.match(PLAN_PATH_TEXT_PATTERN) : null;
      const found = fromTitle
        ? fromTitle[1]
        : typeof node.objective === "string" ? node.objective.match(PLAN_PATH_TEXT_PATTERN)?.[1] : undefined;
      if (found) node.planPath = found;
    }
  }

  const root = state.goals.find((g) => g.parentId === null);
  const rootIsLive = root !== undefined
    && root.status !== "complete" && root.status !== "abandoned" && root.status !== "blocked";
  if (!rootIsLive) return;

  // Any entry with a plan by the ancestor rule, not just one whose kind is
  // "plan". An entry with no plan keeps the round budget as its only signal.
  const frozen = state.goals.filter(
    (g) => g.status === "blocked" && g.blockedReason === "Max rounds reached"
      && resolvePlanPath(state, g) !== undefined,
  );

  const toFree = new Map<string, GoalNode>();
  // What a child's status will be once this pass has been applied.
  const pendingAfterPass = (child: GoalNode): boolean =>
    child.status === "pending" || toFree.has(child.id);

  let sweeps = state.goals.length + 1;
  let accepted = true;
  while (accepted && sweeps-- > 0) {
    accepted = false;
    for (const node of frozen) {
      if (toFree.has(node.id)) continue;
      const children = state.goals.filter((g) => g.parentId === node.id);
      // No child this pass leaves pending, so freeing this node yields no
      // activatable leaf.
      if (children.length > 0 && !children.some(pendingAfterPass)) continue;
      const ancestors = blockedAncestorsToFree(state, node);
      if (!ancestors) continue; // an ancestor in a state this cannot explain: the entry stays blocked
      toFree.set(node.id, node);
      for (const ancestor of ancestors) toFree.set(ancestor.id, ancestor);
      accepted = true;
    }
  }

  for (const node of toFree.values()) {
    node.status = "pending";
    // An entry the round budget froze is reset, since left at its maxRounds
    // it re-blocks on its very first scored round. An ancestor blocked by its
    // own child never spent a round of its own.
    if (node.blockedReason === "Max rounds reached") node.completedRounds = 0;
    node.blockedReason = undefined;
  }
}

// The nudge cap holds by opening an ask and writes no status, so an entry
// paused with `pausedByNudgeCap` true comes only from a store an older
// controller wrote, and nothing lifts it: the field has no reader, the
// entry is out of activateNext's walk, and the cap's ask was never opened.
// This repairs such entries at load. Where no entry is active, the one with
// the latest updatedAt among those the controller could activate becomes
// active and the rest pending, so the controller resumes where the cap
// stopped it; where one is active, or none of them is activatable, all
// become pending, since assignment of the active slot is the tree's. Which
// entries could be activated is isActivationEligible's own rule, the one
// activateNext's walk and goal_add read, asked of the entry as it will be
// once pending: a leaf under an all-pending ancestor chain. An entry under a
// complete, abandoned, blocked or paused plan is out of that walk, and
// making it active would seat the controller on work its tree has closed.
// The cap's reason is cleared with the status, as an active entry carries
// none, and updatedAt moves on the entry made active alone. One decision
// names each entry repaired. The field is then dropped from every entry on
// every load, whatever its value, so the store written back carries no key
// the node shape lacks; a later load finds no paused entry carrying it and
// repairs nothing. GoalNode does not declare the field, so it is read
// through a cast rather than typed.
function repairCapPausedEntriesOnLoad(state: AgentState): void {
  const carried = (g: GoalNode): boolean => (g as { pausedByNudgeCap?: unknown }).pausedByNudgeCap === true;
  const capped = state.goals.filter((g) => g.status === "paused" && carried(g));
  if (capped.length > 0) {
    const anyActive = state.goals.some((g) => g.status === "active");
    const eligible = anyActive
      ? []
      : capped.filter((g) => isActivationEligible(state, { ...g, status: "pending" }));
    const latest = eligible.length === 0
      ? undefined
      : eligible.reduce((best, g) => (g.updatedAt > best.updatedAt ? g : best));
    const now = Date.now();
    for (const g of capped) {
      const status: GoalNode["status"] = g === latest ? "active" : "pending";
      g.status = status;
      g.blockedReason = undefined;
      if (g === latest) g.updatedAt = now;
      state.decisions.push({
        timestamp: now,
        loop: "goal",
        action: "cap_pause_repaired",
        detail: `${g.id}: left paused by the nudge cap, now ${status}`,
      });
    }
  }
  for (const g of state.goals) {
    delete (g as { pausedByNudgeCap?: unknown }).pausedByNudgeCap;
  }
}

// The idle-proposal record, filled at every load site that fills the
// long-term goal list, for a store written before it existed, with no
// version bump. An askedAt that is not a finite number reads as never asked,
// so a NaN cannot hold the interval check false for good. A stored sent entry
// is kept only where its text and writer are strings, its seq a finite number
// and its delivered a boolean; anything else reads as nothing sent.
function fillProposal(state: AgentState): void {
  const p = state.monitor.proposal as Partial<MonitorState["proposal"]> | null | undefined;
  if (!p || typeof p !== "object") {
    state.monitor.proposal = { askedAt: 0, sent: null };
    return;
  }
  if (!Number.isFinite(p.askedAt)) p.askedAt = 0;
  const s = p.sent as Partial<SentProposal> | null | undefined;
  const wellFormed = !!s && typeof s === "object"
    && typeof s.text === "string" && typeof s.writer === "string"
    && Number.isFinite(s.seq) && typeof s.delivered === "boolean";
  if (!wellFormed) p.sent = null;
}

// The plan record ledger, filled at every load site that fills the proposal
// record, with no version bump. A stored value that is not a list reads as an
// empty one. An entry is kept only where its nodeId, text and writer are
// strings, its awaitingYes a boolean and its seq a finite number; anything
// else is dropped. A kept entry whose resends is absent or not a finite
// number reads as 0 resends.
function fillPlanRecords(state: AgentState): void {
  const stored = (state.monitor as { planRecords?: unknown }).planRecords;
  if (!Array.isArray(stored)) {
    state.monitor.planRecords = [];
    return;
  }
  state.monitor.planRecords = stored.filter((r): r is SentPlanRecord => {
    const rec = r as Partial<SentPlanRecord> | null;
    return !!rec && typeof rec === "object"
      && typeof rec.nodeId === "string" && typeof rec.text === "string" && typeof rec.writer === "string"
      && typeof rec.awaitingYes === "boolean" && Number.isFinite(rec.seq);
  }).map((rec) => (Number.isFinite(rec.resends) ? rec : { ...rec, resends: 0 }));
}

// The task list, filled at every load exit. A stored value that is not a list
// reads as an empty one, which is how a store written before the list existed
// loads. A stored entry is kept only where its id, goalId and text are
// strings, its done a boolean, its addedAt a finite number, and its doneAt
// absent or a finite number; anything else is dropped.
function fillTasks(state: AgentState): void {
  const stored = (state as { tasks?: unknown }).tasks;
  if (!Array.isArray(stored)) {
    state.tasks = [];
    return;
  }
  state.tasks = stored.filter((t): t is TaskItem => {
    const task = t as Partial<TaskItem> | null;
    return !!task && typeof task === "object"
      && typeof task.id === "string" && typeof task.goalId === "string" && typeof task.text === "string"
      && typeof task.done === "boolean" && Number.isFinite(task.addedAt)
      && (task.doneAt === undefined || Number.isFinite(task.doneAt));
  });
}

// The turn records, filled at every load exit. A stored value that is not a
// list reads as an empty one, which is how a store written before the records
// existed loads. A stored entry is kept only where its id and text are strings,
// its status one of the five, its openedAt a number, and each of turnId, goalId,
// planPath and taskId absent or a string with closedAt absent or a finite
// number; anything else is dropped. openedAt is read as a number rather than a
// finite one because the reap owns the non-finite case: a record whose clock
// reads as infinity is expired there rather than lost here, so the store the
// plugin cannot make sense of still shows the operator that a message arrived.
// The text is cut to its maximum on the way in, since a store the plugin did
// not write can carry any length.
//
// The pairing of status and closedAt is deliberately unconstrained. A stored
// open record carrying a closedAt is kept, and so is a closed one carrying
// none. Nothing reads closedAt on an open record, and no caller treats its
// absence as evidence a record is open, status being the one field that
// decides that. Refusing the pair here would drop a record whose message and
// clock are both sound over a field nothing consults.
function fillTurnRecords(state: AgentState): void {
  const stored = (state as { turnRecords?: unknown }).turnRecords;
  if (!Array.isArray(stored)) {
    state.turnRecords = [];
    return;
  }
  state.turnRecords = stored.filter((r): r is TurnRecord => {
    const record = r as Partial<TurnRecord> | null;
    return !!record && typeof record === "object"
      && typeof record.id === "string" && typeof record.text === "string"
      && isTurnRecordStatus(record.status) && typeof record.openedAt === "number"
      && (record.turnId === undefined || typeof record.turnId === "string")
      && (record.goalId === undefined || typeof record.goalId === "string")
      && (record.planPath === undefined || typeof record.planPath === "string")
      && (record.taskId === undefined || typeof record.taskId === "string")
      && (record.closedAt === undefined || Number.isFinite(record.closedAt))
      && (record.pendingStamps === undefined
        || (Array.isArray(record.pendingStamps) && record.pendingStamps.every(isTurnRecordStamp)))
      // Read as strictly as pendingStamps, for the same reason: a stamp id that
      // is not a string names no call line for the outcome to join.
      && (record.dispositionStamps === undefined
        || (Array.isArray(record.dispositionStamps) && record.dispositionStamps.every((s) => typeof s === "string")));
  }).map((record) => {
    const cut = clampTurnRecordText(record.text);
    return cut === record.text ? record : { ...record, text: cut };
  });
}

// The lineage ring, filled at every load exit. A stored value that is not a
// list reads as an empty one, which is how a store written before the ring
// existed loads, with no decision line and no version bump. An entry that is
// not a non-empty string is dropped, since it names no session, and the ring
// is cut to PREVIOUS_SESSIONS_MAX, since a claim write never stores more.
function fillPreviousSessionIds(state: AgentState): void {
  const stored = (state as { previousSessionIds?: unknown }).previousSessionIds;
  state.previousSessionIds = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === "string" && id !== "").slice(0, PREVIOUS_SESSIONS_MAX)
    : [];
}

export function parseState(json: string): AgentState {
  const parsed = JSON.parse(json);

  // v2 → v3 migration.
  if (parsed.version === 2) {
    const old = parsed as unknown as {
      persona: string;
      activeSessionId: string;
      epoch: number;
      memory: MemoryEntry[];
      goal: GoalState | null;
      monitor: MonitorState;
      decisions: AgentState["decisions"];
      createdAt: number;
      updatedAt: number;
    };

    const now = Date.now();
    const goals: GoalNode[] = [];
    let activeGoalId: string | null = null;

    if (old.goal) {
      const g = old.goal;
      const rootId = `goal-${g.id.replace(/^goal-?/, "")}`;
      const planId = `plan-${g.id.replace(/^goal-?/, "")}`;

      // L10: v2 active goal maps to a pending root (not an active root).
      // The root is never active in v3; activation is at the leaf level.
      const statusMap: Record<string, GoalNode["status"]> = {
        active: "pending", // L10: root was never active in v3
        paused: "paused",
        complete: "complete",
        blocked: "blocked",
      };
      const rootStatus = statusMap[g.status] ?? "pending";
      const planStatus: GoalNode["status"] =
        g.status === "active" ? "active" : statusMap[g.status] ?? "pending";

      const root: GoalNode = {
        id: rootId,
        parentId: null,
        kind: "root",
        title: g.objective.slice(0, 80),
        objective: g.objective,
        status: rootStatus,
        source: "operator",
        maxRounds: 0,
        completedRounds: 0,
        scores: [],
        notes: [],
        planningRounds: 0,
        consecutiveBlockedPlannings: 0,
        consecutivePlanningFailures: 0,
        planningRound: 0,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        blockedReason: g.blockedReason,
      };

      const plan: GoalNode = {
        id: planId,
        parentId: rootId,
        kind: "plan",
        title: g.objective.slice(0, 80),
        objective: g.objective,
        status: planStatus,
        source: "operator",
        maxRounds: g.maxRounds,
        completedRounds: g.completedRounds,
        scores: g.scores,
        notes: [],
        planningRounds: 0,
        consecutiveBlockedPlannings: 0,
        consecutivePlanningFailures: 0,
        planningRound: 0,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        blockedReason: g.blockedReason,
      };

      goals.push(root, plan);
      if (planStatus === "active") {
        activeGoalId = planId;
      }
    }

    const state: AgentState = {
      version: 9,
      persona: old.persona,
      activeSessionId: old.activeSessionId,
      epoch: old.epoch,
      previousSessionIds: [],
      memory: old.memory ?? [],
      goals,
      tasks: [],
      turnRecords: [],
      shownMemories: [],
      activeGoalId,
      longTermGoals: [],
      autonomy: "propose",
      asks: [],
      monitor: old.monitor ?? {
        sessionStart: now,
        turnCount: 0,
        totalToolCalls: 0,
        errors: 0,
      },
      nudge: { lastNudgeAt: 0, consecutiveNudgesWithoutOnGoal: 0 },
      decisions: old.decisions ?? [],
      createdAt: old.createdAt ?? now,
      updatedAt: now,
    };

    fillProposal(state);
    fillPlanRecords(state);
    // L10: invariant block runs on both v2 and v3 branches.
    // Section 1: fill/recover runs on every branch's exit; see the function.
    applyPlanRecordOnLoad(state);
    enforceInvariants(state);
    return state;
  }

  if (parsed.version === 3) {
    // v3 to v4 migration: add env to monitor. The v4 to v5 step, the task
    // list, is the fillTasks call below, the v5 to v6 step, the turn records,
    // is the fillTurnRecords call beside it, the v6 to v7 step, the shown
    // records, is enforceInvariants, the v7 to v8 step is the fold the
    // first store write runs, as the v7 to v8 step below states, and the v8
    // to v9 step, the ask ledger, is the fillAsks call.
    const state = parsed as unknown as AgentState;
    if (!state.monitor.env) {
      state.monitor.env = {
        git: null,
        health: null,
        errors: { consecutiveErrorTurns: 0, toolErrorsLastTurn: 0 },
      };
    }
    state.version = 9;
    if (!state.nudge) {
      state.nudge = { lastNudgeAt: 0, consecutiveNudgesWithoutOnGoal: 0 };
    }
    if (!Array.isArray(state.longTermGoals)) {
      state.longTermGoals = [];
    }
    if (!isAutonomyLevel(state.autonomy)) {
      state.autonomy = "propose";
    }
    fillTasks(state);
    fillTurnRecords(state);
    fillPreviousSessionIds(state);
    fillProposal(state);
    fillPlanRecords(state);
    fillAsks(state, Date.now());
    applyPlanRecordOnLoad(state);
    enforceInvariants(state);
    return state;
  }

  // v4 to v5 migration: add the task list, which fillTasks below seeds empty
  // on a store that lacks it. Everything else a v4 store holds is already the
  // v5 shape.
  if (parsed.version === 4) {
    parsed.version = 5;
  }

  // v5 to v6 migration: add the turn records, which fillTurnRecords below seeds
  // empty on a store that lacks them. Everything else a v5 store holds is
  // already the v6 shape.
  if (parsed.version === 5) {
    parsed.version = 6;
  }

  // v6 to v7 migration: add the shown records, which enforceInvariants below
  // seeds empty on a store that lacks them. Everything else a v6 store holds
  // is already the v7 shape.
  if (parsed.version === 6) {
    parsed.version = 7;
  }

  // v7 to v8 migration: add foldedChildren on a plan node. Nothing here
  // folds, since a fold writes the moved nodes to the goal history file
  // before it removes them and this function writes no file. The store write
  // folds every complete plan foldablePlans names, through persist in
  // hooks/index.ts, so a v7 store's complete plans fold at the first write
  // after the load, and a load that never writes leaves the tree whole.
  if (parsed.version === 7) {
    parsed.version = 8;
  }

  // v8 to v9 migration: add the ask ledger, which fillAsks below seeds from
  // the one ask slot a version 8 store held, or empty where the slot was.
  // It runs after the v7 to v8 step, so a version 7 store takes both.
  if (parsed.version === 8) {
    parsed.version = 9;
  }

  if (parsed.version !== 9) {
    throw new Error(`Unsupported AgentState version: ${parsed.version}`);
  }

  const state = parsed as AgentState;

  // Migrate: add nudge budget if missing (v3.0 stores predate this field).
  if (!state.nudge) {
    state.nudge = { lastNudgeAt: 0, consecutiveNudgesWithoutOnGoal: 0 };
  }

  // Entries a nudge cap paused, repaired at the E11 site before the
  // invariant pass below reads the active entry; see the function.
  repairCapPausedEntriesOnLoad(state);

  // E11: fill env with defaults whenever it is absent, whatever the version.
  if (!state.monitor.env) {
    state.monitor.env = {
      git: null,
      health: null,
      errors: { consecutiveErrorTurns: 0, toolErrorsLastTurn: 0 },
    };
  }

  // The long-term goal list, filled empty at the E11 site for a store written
  // before it existed, with no version bump.
  if (!Array.isArray(state.longTermGoals)) {
    state.longTermGoals = [];
  }
  // The autonomy level, filled at the same site with no version bump. A
  // store with no level, or with a value outside AUTONOMY_LEVELS, reads as
  // "propose". This function stays silent about it; session.start logs a
  // stored value outside the list, since only it holds the raw store.
  if (!isAutonomyLevel(state.autonomy)) {
    state.autonomy = "propose";
  }
  fillTasks(state);
  fillTurnRecords(state);
  fillPreviousSessionIds(state);
  fillProposal(state);
  fillPlanRecords(state);
  fillAsks(state, Date.now());

  // S12: fill selfReview with defaults at the E11 site, no version bump.
  if (!state.monitor.selfReview) {
    state.monitor.selfReview = {
      count: 0, lastAt: 0, turnsSince: 0, windowStart: 0,
      pendingPeriodic: false, lastInjectAt: 0, sent: [],
    };
  }
  // The findings ledger, filled at the same site for a store written before
  // it existed.
  if (!Array.isArray(state.monitor.selfReview.sent)) {
    state.monitor.selfReview.sent = [];
  }

  // Cost ledger: fill with defaults at the E11 site, no version bump.
  if (!state.monitor.cost) {
    state.monitor.cost = {
      classify: { count: 0, estTokens: 0 },
      reason: { count: 0, estTokens: 0 },
      selfReview: { count: 0, estTokens: 0 },
      planner: { count: 0, estTokens: 0 },
      nudge: { count: 0 },
      forkUsage: null,
      consecutiveSkips: 0,
      nudgeWindow: { start: 0, count: 0 },
      callWindow: { start: 0, count: 0 },
      lastSummaryHash: 0,
      capNoticeWindowStart: 0,
    };
  }
  // D2: ensure lastSummaryHash exists (for states created before this field).
  if (typeof state.monitor.cost.lastSummaryHash !== "number") {
    state.monitor.cost.lastSummaryHash = 0;
  }
  // AK2: ensure capNoticeWindowStart exists (for states created before this field).
  if (typeof state.monitor.cost.capNoticeWindowStart !== "number") {
    state.monitor.cost.capNoticeWindowStart = 0;
  }

  // The fleet watcher's reading is dropped from anything this file carries.
  // The watcher holds its reading in session memory and reads it back from
  // nowhere, so a `fleetHealth` key here is a legacy state a previous version
  // wrote or one a hand-written store seeded, and either way it contributes
  // nothing to what the watcher says. Dropping it keeps it out of the state
  // the session then writes back, so the key does not survive as a value no
  // reader has.
  //
  // Nothing the watcher reads out of a file may decide silence about an
  // unhealthy persona, and that is why the reading is not stored at all. The
  // store sits inside a persona's own working directory, which a roster can
  // give to more than one persona, and every field of a memo that silences a
  // key is a value the watcher itself legitimately produces, so no check on
  // the value can tell a watcher's own memo from a persona's memo about
  // itself.
  const readClock = Date.now();
  delete (state as { fleetHealth?: unknown }).fleetHealth;

  // The reconciliation cadence's stamp, held to a number the clock can have
  // passed. The tick asks for the pass when `reconcileNow - lastReconcileAt`
  // reaches the cadence, and a stamp that is a string, an object or NaN makes
  // that difference NaN, which is never at or past the cadence; the stamp is
  // no longer absent either, so the branch that starts the cadence does not
  // run. The pass would then never be asked for again, with nothing written
  // down saying why. A stamp ahead of the clock silences it the same way for
  // as long as it stands. Dropping it puts the next tick on the branch that
  // starts the cadence, so the pass runs one cadence later at worst.
  if (state.lastReconcileAt !== undefined
    && (typeof state.lastReconcileAt !== "number"
      || !Number.isFinite(state.lastReconcileAt)
      || state.lastReconcileAt > readClock)) {
    delete state.lastReconcileAt;
  }

  // L10: invariant block runs on both v2 and v3 branches.
  // Section 1: fill/recover runs here too, on the v4 and v5 exit.
  applyPlanRecordOnLoad(state);
  enforceInvariants(state);
  return state;
}

// L10: extract invariant enforcement so both v2 and v3 branches run it.
function enforceInvariants(state: AgentState): void {
  // Enforce invariants: exactly one active node, and it must be a leaf.
  const actives = state.goals.filter((g) => g.status === "active");
  if (actives.length > 1) {
    // Keep the first (array order), demote the rest.
    actives.slice(1).forEach((g) => {
      g.status = "pending";
    });
  }
  // If the active node is not a leaf, demote it.
  const active = state.goals.find((g) => g.status === "active");
  if (active) {
    const hasChildren = state.goals.some((g) => g.parentId === active.id);
    if (hasChildren) {
      active.status = "pending";
      state.activeGoalId = null;
    } else {
      state.activeGoalId = active.id;
    }
  } else {
    state.activeGoalId = null;
  }

  // Cap the decision log on read.
  if (state.decisions.length > DECISIONS_MAX) {
    state.decisions = state.decisions.slice(-DECISIONS_MAX);
  }

  // The shown records, filled on every load. A stored value that is not a list
  // reads as an empty one, which is how a store written before the list
  // existed loads. An entry that is not a shown record is dropped, and the list
  // is cut to SHOWN_MEMORIES_MAX from the front, as recordShownMemory cuts it.
  const shown = (state as { shownMemories?: unknown }).shownMemories;
  state.shownMemories = Array.isArray(shown) ? shown.filter(isShownMemory).slice(-SHOWN_MEMORIES_MAX) : [];

  // A fold count, kept on every load only where it is a positive integer,
  // since a count of no child or a value of another type names no fold. A
  // node without one loads as it was stored.
  for (const g of state.goals) {
    const folded = (g as { foldedChildren?: unknown }).foldedChildren;
    if (folded !== undefined && !(Number.isInteger(folded) && (folded as number) > 0)) delete g.foldedChildren;
  }

  // The load-time backstop for the task reap; persist runs the same reap on
  // every store write.
  reapCompletedGoalTasks(state);

  // The load-time backstop for the record reap; persist runs the same reap on
  // every store write. It runs before the one-open repair below so that a
  // record whose clock the plugin cannot read is already closed, and so never
  // competes for the open slot against a record whose clock it can. Ordering
  // it the other way lets an unreadable clock decide the repair, and the
  // repair's own answer is then the one record the timeout can never reach.
  const now = Date.now();
  reapTurnRecords(state, now);

  // The record layer holds at most one open record, so openTurnRecord has one
  // answer at every read. A store carrying two, which a crash between an open
  // and the write that superseded the previous one leaves behind, keeps the
  // newest by openedAt and supersedes the rest, since the newest is the
  // intention the persona is working on. Every record still open here has a
  // readable clock, the reap above having closed the rest, so the comparison
  // is between two real times.
  const openRecords = state.turnRecords.filter((r) => r.status === "open");
  if (openRecords.length > 1) {
    const newest = openRecords.reduce((a, b) => (turnRecordOrder(b) >= turnRecordOrder(a) ? b : a));
    state.turnRecords = state.turnRecords.map((r) => (
      r.status === "open" && r !== newest ? { ...r, status: "superseded" as const, closedAt: now } : r
    ));
    // The repair closes records, so the cap can be over again where a store
    // carried several open ones. This second pass expires nothing new and
    // drops what the cap now covers.
    reapTurnRecords(state, now);
  }
}

// Drops every task whose goal is closed: complete or abandoned, a closed set of
// two, or absent from the tree. A task under a pending, active, paused or
// blocked goal is kept. Only state.tasks changes. Called by persist before each
// store write, so a goal completed mid-session loses its tasks at that write,
// and by enforceInvariants on every load.
export function reapCompletedGoalTasks(state: AgentState): void {
  const open = new Set(
    state.goals.filter((g) => g.status !== "complete" && g.status !== "abandoned").map((g) => g.id),
  );
  state.tasks = state.tasks.filter((t) => open.has(t.goalId));
}

// The one open record, or null where none is open. The record layer holds at
// most one, which enforceInvariants repairs on every load, so the first open
// record is the only one.
export function openTurnRecord(state: AgentState): TurnRecord | null {
  return state.turnRecords.find((r) => r.status === "open") ?? null;
}

// Where a record sorts by age. A record whose openedAt is not a finite number
// sorts as the oldest there is, since a clock the plugin cannot read is no
// evidence of recency: the reap expires such a record and the cap drops it
// first.
function turnRecordOrder(record: TurnRecord): number {
  return Number.isFinite(record.openedAt) ? record.openedAt : 0;
}

// Expires the stale open record and caps the closed ones. An open record is
// stale on any of three readings of its openedAt, which share one reason: none
// of them yields an age the timeout can act on. It is not a finite number. It
// is ahead of `now`, which yields a negative age, so no timeout ever passes and
// the record would stand open for good. Or its age has reached
// TURN_RECORD_TIMEOUT_MS, the boundary sitting on the expiring side, so a
// record exactly a day old expires. A stale record becomes "expired" with its
// closedAt at `now`, so a long-dead intention stops reading as live. Expiry
// never deletes a record; the cap is what deletes, and
// it drops only records that are not open, oldest-opened first, so an open
// record stands however many closed ones sit beside it. Only state.turnRecords
// changes. Called by persist before each store write, so a record that timed
// out mid-session expires at that write, and by enforceInvariants on every load.
export function reapTurnRecords(state: AgentState, now: number): void {
  const aged = state.turnRecords.map((record) => {
    if (record.status !== "open") return record;
    const stale = !Number.isFinite(record.openedAt)
      || record.openedAt > now
      || now - record.openedAt >= TURN_RECORD_TIMEOUT_MS;
    return stale ? { ...record, status: "expired" as const, closedAt: now } : record;
  });
  const closed = aged.filter((r) => r.status !== "open");
  if (closed.length <= TURN_RECORDS_MAX) {
    state.turnRecords = aged;
    return;
  }
  const dropped = new Set(
    [...closed].sort((a, b) => turnRecordOrder(a) - turnRecordOrder(b))
      .slice(0, closed.length - TURN_RECORDS_MAX),
  );
  state.turnRecords = aged.filter((r) => !dropped.has(r));
}

// --- Pure helpers for goal-tree operations (R3) ---
// These are called from four sites: worker goal_done, scorer complete,
// controller complete, and the round-budget block. No duplicate logic.

// Mark a leaf complete, walk up completing plan-parents whose children are all
// complete. A plan with any blocked child becomes blocked (H3).
// The root is never touched here (H3): the controller tick completes it,
// through isRootFinished or the planner, and goal_done with the root's own id
// completes a finished root on the operator's or the coordinator's word.
//
// openPlans names the plan parents whose document was read and whose first
// Status: line holds a value other than Complete, each with that value, as the
// caller read it before this call. The walk leaves such a parent open, at the
// status it holds, logs one plan_parent_left_open decision naming it and the
// value, and goes no higher. A parent absent from the map completes as above,
// so a plan with no document, or one whose document did not read or has no
// Status: line, keeps this rule. The map only ever holds a parent back: a
// blocked child blocks its parent whatever the map says.
export function completeLeaf(state: AgentState, id: string, note: string, openPlans?: ReadonlyMap<string, string>): void {
  const node = state.goals.find((g) => g.id === id);
  if (!node) return;

  node.status = "complete";
  node.updatedAt = Date.now();
  if (note) node.notes.push(note);

  // Walk up: plan-parents only. A plan completes when all children are
  // complete or abandoned. A plan with any blocked child becomes blocked.
  let current = node;
  while (current.parentId) {
    const parent = state.goals.find((g) => g.id === current.parentId);
    if (!parent) break;
    // H3: Root completion belongs to the controller tick, not the cascade.
    if (parent.kind === "root") break;
    const children = state.goals.filter((g) => g.parentId === parent.id);
    const hasBlocked = children.some((c) => c.status === "blocked");
    const allDone = children.every(
      (c) =>
        c.status === "complete" ||
        c.status === "abandoned" ||
        c.status === "blocked"
    );
    if (hasBlocked && parent.status !== "complete") {
      parent.status = "blocked";
      parent.blockedReason = "Child task blocked";
      parent.updatedAt = Date.now();
    } else if (allDone && parent.status !== "complete" && openPlans?.has(parent.id)) {
      state.decisions.push({
        timestamp: Date.now(),
        loop: "goal",
        action: "plan_parent_left_open",
        detail: `${parent.id}: ${(parent.planPath ?? "").slice(0, 150)} reads Status: ${openPlans.get(parent.id)}`,
      });
      break;
    } else if (allDone && parent.status !== "complete") {
      parent.status = "complete";
      parent.updatedAt = Date.now();
    } else {
      break;
    }
    current = parent;
  }

  // H3: Root completion belongs to the controller tick, not the cascade.
  // completeLeaf never touches the root.

  clearSettledAwaiting(state);
}

// A settled child is one the walk up and the fold both read as finished.
const isSettled = (g: GoalNode): boolean => g.status === "complete" || g.status === "abandoned";

// The plans a fold takes now, each with the nodes that leave the tree with it.
// A plan folds when it is a plan node below the root, its status is complete,
// it has at least one child, and every child is complete or abandoned. A
// blocked child, or any other status, holds the fold, so a plan blocked over
// its child never folds. The nodes are the plan's whole subtree below it,
// children first and then their descendants level by level, so nothing left
// in the tree names a parent that left it; `direct` counts the children
// alone. A foldable plan inside another foldable plan's subtree is not a fold
// of its own: only the outermost foldable plan folds, and its nodes already
// carry the inner plan and the inner plan's subtree, so no node is listed
// twice and no count lands on a plan the outer fold removes. A goals entry
// that is not an object is passed over. Pure: it reads the tree and changes
// nothing, so the caller can copy the nodes out before any of them is
// removed.
export function foldablePlans(state: AgentState): Array<{ plan: GoalNode; nodes: GoalNode[]; direct: number }> {
  const goals = state.goals.filter((g) => !!g && typeof g === "object");
  const folds: Array<{ plan: GoalNode; nodes: GoalNode[]; direct: number }> = [];
  for (const plan of goals) {
    if (plan.kind !== "plan" || plan.parentId === null || plan.status !== "complete") continue;
    const children = goals.filter((g) => g.parentId === plan.id);
    if (children.length === 0 || !children.every(isSettled)) continue;
    const nodes = [...children];
    const joined = new Set<GoalNode>(nodes);
    // A node joins once and the plan never joins, so a parentId cycle, which
    // the tree's shape rules do not permit but nothing here re-checks, ends
    // the walk rather than spinning it.
    for (let i = 0; i < nodes.length; i++) {
      for (const g of goals) {
        if (g.parentId === nodes[i].id && g !== plan && !joined.has(g)) {
          joined.add(g);
          nodes.push(g);
        }
      }
    }
    folds.push({ plan, nodes, direct: children.length });
  }
  const inner = new Set<GoalNode>(folds.flatMap((fold) => fold.nodes));
  return folds.filter((fold) => !inner.has(fold.plan));
}

// Applies one fold foldablePlans named: its nodes leave state.goals and the
// plan's foldedChildren grows by its direct count. The caller runs this only
// once the nodes are copied to the goal history file, so a fold whose copy
// failed removes nothing.
export function applyFold(state: AgentState, fold: { plan: GoalNode; nodes: GoalNode[]; direct: number }): void {
  const leaving = new Set(fold.nodes);
  state.goals = state.goals.filter((g) => !leaving.has(g));
  fold.plan.foldedChildren = (fold.plan.foldedChildren ?? 0) + fold.direct;
}

// The blockedReason a plan queued at the plan-and-ask autonomy level carries
// while it waits for the operator's yes.
export const AWAITING_YES_REASON = "Awaiting the operator's yes";

// The entry awaiting the operator's yes at `node` or above it, or undefined
// where neither the node nor any ancestor carries awaitingYes. Every gate on
// such an entry reads this one walk, so a node under the entry is held as the
// entry is. The walk is bounded by the node count, so a parentId cycle ends
// it rather than spinning.
export function awaitingEntryAtOrAbove(state: AgentState, node: GoalNode): GoalNode | undefined {
  let current: GoalNode | undefined = node;
  let steps = state.goals.length;
  while (current) {
    if (current.awaitingYes) return current;
    if (current.parentId === null || steps-- <= 0) return undefined;
    const parentId: string = current.parentId;
    current = state.goals.find((g) => g.id === parentId);
  }
  return undefined;
}

// A complete node no longer waits for the operator's yes, so its flag goes,
// and its reason too where the reason is the awaiting one. completeLeaf runs
// this after every completion, whichever verb or path completed the node.
export function clearSettledAwaiting(state: AgentState): void {
  for (const g of state.goals) {
    if (g.status !== "complete" || !g.awaitingYes) continue;
    g.awaitingYes = undefined;
    if (g.blockedReason === AWAITING_YES_REASON) g.blockedReason = undefined;
  }
}

// Section 10 fix round: whether a single node is eligible to become the
// active leaf. A node is eligible when its own status is "pending", it has
// no children (the leaf invariant), and every ancestor between it and the
// root also has status "pending" - the root itself is exempt, since
// activateNext's own DFS starts there without testing its status. This is
// activateNext's own DFS rule, extracted so a second caller (goal_add) reads
// the same rule rather than reimplementing it by hand.
export function isActivationEligible(state: AgentState, node: GoalNode): boolean {
  if (node.status !== "pending") return false;
  if (state.goals.some((g) => g.parentId === node.id)) return false;
  // The walk is bounded by the node count. A parentId cycle, which the
  // tree's shape rules do not permit but nothing here re-checks, exhausts the
  // bound and reads as not eligible rather than spinning.
  let current = node;
  let steps = state.goals.length;
  while (current.parentId) {
    if (steps-- <= 0) return false;
    const parent = state.goals.find((g) => g.id === current.parentId);
    if (!parent) break;
    if (parent.parentId === null) break; // parent is the root, exempt from the status test
    if (parent.status !== "pending") return false;
    current = parent;
  }
  return true;
}

// Section 1 (plan-health-from-the-record): the plan document a node is
// judged against. A node's plan is its own planPath, or else the planPath
// of its nearest ancestor that has one - so a task a worker adds under a
// plan node is judged against that plan's document too. Returns undefined
// for a task entry, one with no such ancestor. The walk is bounded by the
// node count, the same guard isActivationEligible uses, since a parentId
// cycle the tree's shape rules do not permit would otherwise spin here too.
export function resolvePlanPath(state: AgentState, node: GoalNode): string | undefined {
  return planHolderOf(state, node)?.planPath;
}

// The entry that holds the planPath a node is judged against: the node
// itself, or else its nearest ancestor with one. This is the entry a plan
// document's completion completes, which for a task under a plan node is
// its parent. Returns undefined for a task entry. resolvePlanPath is this
// walk's path; the two never diverge because one derives from the other.
export function planHolderOf(state: AgentState, node: GoalNode): GoalNode | undefined {
  if (node.planPath) return node;
  let current: GoalNode | undefined = node;
  let steps = state.goals.length;
  while (current && current.parentId) {
    if (steps-- <= 0) return undefined;
    const parent: GoalNode | undefined = state.goals.find((g) => g.id === current!.parentId);
    if (!parent) return undefined;
    if (parent.planPath) return parent;
    current = parent;
  }
  return undefined;
}

// Plan item 3 (reprioritize): sortKey overrides createdAt for activation
// order when set; absent sortKey falls back to createdAt, so an untouched
// node's order is unaffected. The controller's walk and the open-entry list
// both order by this one key.
const orderKey = (g: GoalNode): number => g.sortKey ?? g.createdAt;

// The leaf the controller activates when it walks from the root: depth-first,
// each level filtered on "pending" and ordered by orderKey, returning the
// first leaf isActivationEligible accepts. A pending leaf under a paused,
// blocked or complete parent is never reached. Pure: it reads the tree and
// changes nothing. activateNext calls this for its walk, so the controller
// and hasStartableWork share one walk and cannot disagree.
export function nextStartableLeaf(state: AgentState): GoalNode | null {
  const root = state.goals.find((g) => g.parentId === null);
  if (!root) return null;
  const dfs = (parentId: string): GoalNode | null => {
    const candidates = state.goals
      .filter((g) => g.parentId === parentId && g.status === "pending")
      .sort((a, b) => orderKey(a) - orderKey(b));
    for (const c of candidates) {
      // Every candidate here already descends through an all-pending
      // ancestor chain (the level-by-level status filter above), so the
      // eligibility predicate's ancestor test is trivially satisfied and
      // this reduces to the leaf check - reusing it rather than repeating
      // "no children" inline.
      if (isActivationEligible(state, c)) return c;
      // Has children: descend.
      const child = dfs(c.id);
      if (child) return child;
    }
    return null;
  };
  return dfs(root.id);
}

// Every non-root entry still open (pending, active, paused or blocked), in
// one flat orderKey sort across the whole tree rather than the controller's
// level-by-level walk. This is the list the [GOAL QUEUE] block prints.
export function openGoals(state: AgentState): GoalNode[] {
  return state.goals
    .filter(
      (g) =>
        g.parentId !== null &&
        (g.status === "pending" || g.status === "active" || g.status === "paused" || g.status === "blocked")
    )
    .sort((a, b) => orderKey(a) - orderKey(b));
}

// Whether the tree holds work the controller will run on its own: an active
// node, or a leaf its walk from the root would activate. False means every
// open entry is paused, blocked or out of the walk's reach, which is the idle tree.
export function hasStartableWork(state: AgentState): boolean {
  if (state.goals.some((g) => g.status === "active")) return true;
  return nextStartableLeaf(state) !== null;
}

// M6: Activate the next pending leaf (a node with no children).
// Prefers the completed node's siblings, then nextStartableLeaf's walk from
// the root. Only activates nodes that have no children (leaf invariant).
export function activateNext(state: AgentState, completedId?: string): string | null {
  const hasChildren = (id: string): boolean =>
    state.goals.some((g) => g.parentId === id);

  const activate = (g: GoalNode): string => {
    g.status = "active";
    g.updatedAt = Date.now();
    state.activeGoalId = g.id;
    return g.id;
  };

  // 1. Pending leaf siblings of the just-completed node (same parent).
  if (completedId) {
    const completed = state.goals.find((g) => g.id === completedId);
    if (completed && completed.parentId) {
      const siblings = state.goals
        .filter(
          (g) =>
            g.parentId === completed.parentId &&
            g.status === "pending" &&
            !hasChildren(g.id) &&
            // A node under an entry awaiting the operator's yes starts only
            // once that entry is resumed.
            awaitingEntryAtOrAbove(state, g) === undefined
        )
        .sort((a, b) => orderKey(a) - orderKey(b));
      if (siblings.length > 0) {
        return activate(siblings[0]);
      }
    }
  }

  // 2. The walk from the root: first pending leaf in orderKey order.
  const leaf = nextStartableLeaf(state);
  if (leaf) return activate(leaf);

  // Nothing to activate.
  state.activeGoalId = null;
  return null;
}

// Whether the root's work is all done and the root completes with no planner
// call. True when the root is open (not complete, abandoned or blocked), the
// planner has never broken it down (planningRounds is 0), it has at least one
// descendant, at least one descendant is complete, and every descendant is
// complete or abandoned. A root the planner has planned before stays the
// planner's, since the planner returns to it for the next batch of plans. A
// root with no descendants, or whose descendants are all abandoned, or with a
// blocked descendant, is not finished and stays with isPlanningDue.
export function isRootFinished(state: AgentState): boolean {
  const root = state.goals.find((g) => g.parentId === null);
  if (!root) return false;
  if (root.status === "complete" || root.status === "abandoned" || root.status === "blocked") return false;
  if ((root.planningRounds || 0) !== 0) return false;
  const descendants = state.goals.filter((g) => g.parentId !== null);
  if (descendants.length === 0) return false;
  if (!descendants.some((g) => g.status === "complete")) return false;
  return descendants.every((g) => g.status === "complete" || g.status === "abandoned");
}

// Check whether planning is due (R5).
// Due when: root exists, not complete/abandoned, has no
// pending/active/paused descendants, and is not finished by isRootFinished.
// Blocked counts as no work.
export function isPlanningDue(state: AgentState): boolean {
  const root = state.goals.find((g) => g.parentId === null);
  if (!root) return false;
  if (root.status === "complete" || root.status === "abandoned" || root.status === "blocked") return false;
  if (isRootFinished(state)) return false;
  const descendants = state.goals.filter((g) => g.parentId !== null);
  const hasWork = descendants.some(
    (g) => g.status === "pending" || g.status === "active" || g.status === "paused"
  );
  return !hasWork;
}

// M15: the blocked-planning cap must be evaluated over the PREVIOUS planning
// round only, not over every node the root has ever produced. A completed plan
// in an earlier round must not clear a two-consecutive-all-blocked streak, nor
// let an old blocked node linger against a fresh round's plans. The round a
// plan was created in is captured on the plan node (planningRound) at creation
// time. The previous round, at the moment a NEW round is about to start, is
// the one just completed: planningRounds - 1.
//
// planningCapReached returns a block reason, or null when the cap is not
// reached. The cap is: the root has already done 5+ planning rounds, OR two
// consecutive previous rounds were fully blocked. The streak (consecutive
// all-blocked rounds) is tracked by the caller on the root; this helper
// decides whether the most recent completed round counts as all-blocked.
export function previousRoundBlocked(
  root: GoalNode,
  plans: GoalNode[],
): boolean {
  const prevRound = (root.planningRounds || 0) - 1;
  if (prevRound < 0) return false; // no previous round yet
  const prevPlans = plans.filter((g) => g.planningRound === prevRound);
  if (prevPlans.length === 0) return false;
  return prevPlans.every((g) => g.status === "blocked");
}

export function planningCapReached(
  root: GoalNode,
  consecutiveBlockedPlannings: number,
): string | null {
  if ((root.planningRounds || 0) >= 5) {
    return `Planning cap reached (planningRounds=${root.planningRounds})`;
  }
  if (consecutiveBlockedPlannings >= 2) {
    return `Planning cap reached (consecutiveBlockedPlannings=${consecutiveBlockedPlannings})`;
  }
  return null;
}

// --- Pure helpers for the error streak (C3). ---

// A turn is an error turn when the harness ends it with reason "error".
// A tool error or a denied call inside a turn that ends normally is work,
// not failure, so it does not advance the streak; the tool-error count the
// caller passes still lands on toolErrorsLastTurn as a record.
export function applyTurnToErrors(
  prev: EnvErrors,
  turn: { reason: string; toolErrors: number },
): EnvErrors {
  const isErrorTurn = turn.reason === "error";
  if (isErrorTurn) {
    return {
      consecutiveErrorTurns: prev.consecutiveErrorTurns + 1,
      toolErrorsLastTurn: turn.toolErrors,
      lastErrorAt: Date.now(),
      handledAt: prev.handledAt,
    };
  }
  return {
    consecutiveErrorTurns: 0,
    toolErrorsLastTurn: turn.toolErrors,
    lastErrorAt: prev.lastErrorAt,
    handledAt: prev.handledAt,
  };
}

// --- Pure helpers for the guarded-write (yield) path. ---

export function shouldYield(
  onDisk: { activeSessionId: string; epoch: number },
  mySessionId: string,
  myEpoch: number,
): boolean {
  return (
    onDisk.activeSessionId !== mySessionId ||
    onDisk.epoch !== myEpoch
  );
}

export function yieldRecord(
  persona: string,
  mySessionId: string,
  onDiskSessionId: string,
  myEpoch: number,
  onDiskEpoch: number,
): { decision: { timestamp: number; loop: "memory" | "goal" | "monitor" | "worker"; action: string; detail: string }; logLine: string } {
  const ts = Date.now();
  const decision: { timestamp: number; loop: "memory" | "goal" | "monitor" | "worker"; action: string; detail: string } = {
    timestamp: ts,
    loop: "monitor",
    action: "persona_yield",
    detail: `Session ${mySessionId} (epoch ${myEpoch}) yielded to ${onDiskSessionId} (epoch ${onDiskEpoch}) on persona '${persona}'`,
  };
  // JSONL: one JSON object per line, terminated with a newline.
  const logLine = JSON.stringify({
    ts: new Date(ts).toISOString(),
    persona,
    yielded: mySessionId,
    yieldedEpoch: myEpoch,
    winner: onDiskSessionId,
    winnerEpoch: onDiskEpoch,
  }) + "\n";
  return { decision, logLine };
}
