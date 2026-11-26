// checkpoint-restart.ts: the rule that decides whether a persona's session
// ends at a turn end and starts fresh, in place of a later compaction.
//
// A fresh start pays its launch text and a first turn, while a compaction
// pays a summarizer to read the whole conversation and then rebuilds the
// cache. So a restart is worth taking only where the context has grown past
// a floor, the working state is on disk, and nothing a restart would cut is
// in flight. The rule is closed at eleven conditions, each named, and a restart
// is taken only where none fails:
//
//   1. mode: the switch is not `live`.
//   2. not-durable: the turn end is not durable, by the check
//      hooks/turn-complete.ts makes for the compaction bank.
//   3. percent-unreadable: the context fill could not be read.
//   4. below-floor: the fill is below CHECKPOINT_FLOOR_PERCENT.
//   5. operator-turn: an operator's turn opened this turn, the keyboard and
//      Remote Control among them, or an operator-class channel message did.
//   6. operator-recent: the newest operator message the session has seen, or
//      its start where it has seen none, is less than CHECKPOINT_QUIET_MS
//      old, or an operator message is waiting to be brought back as a turn
//      of its own. An operator message is an operator's turn, an
//      operator-class channel message, or a prompt typed at the keyboard or
//      sent through Remote Control while a turn runs, read from the origin
//      the engine stamps on it. A background task's notification, a peer's
//      message and a schedule are none.
//   7. ask-open: an ask is open on a live goal entry, blocking or not.
//   8. no-gain: the session's fill at its first turn end was at or past the
//      floor, so a fresh start would begin no lower. An unreadable first
//      fill does not fail it.
//   9. background-running: the engine's list for this turn end names a
//      background task or a scheduled wake. A null count, a list the engine
//      did not give, does not fail it, so the list can only withhold.
//  10. no-note: no hand-over note with nothing running was written this
//      turn.
//  11. turn-pending: this turn end has sent a turn of its own, or will send
//      one, so a restart would cut a turn the plugin itself queued. A restart
//      it withholds is tried again at the next turn end.
//
// Under `shadow` the verdict leaves out `mode` and `no-note` and still lists
// them, so the shadow record shows what a live session would have done and
// how often each condition alone withholds a restart.
//
// No engine API and no clock: every fact and the time arrive as arguments, so a second
// engine's adapter can call the same function with its own facts.

// The fill at or past which a restart can pay, in percent of the window. A
// declared figure, which the shadow reading measures.
export const CHECKPOINT_FLOOR_PERCENT = 20;

// How long the operator must have been quiet before a restart, so a
// conversation is never cut.
export const CHECKPOINT_QUIET_MS = 30 * 60 * 1000;

// The switch's three values. Any other value reads `off`.
export type CheckpointMode = "off" | "shadow" | "live";

// The switch as the plugin reads its option: `shadow` and `live` read as
// themselves, and anything else, an absent value included, reads `off`.
export function checkpointModeOf(value: unknown): CheckpointMode {
  return value === "shadow" || value === "live" ? value : "off";
}

// The eleven condition names, in the order the rule lists them.
export const CHECKPOINT_CONDITIONS = [
  "mode",
  "not-durable",
  "percent-unreadable",
  "below-floor",
  "operator-turn",
  "operator-recent",
  "ask-open",
  "no-gain",
  "background-running",
  "no-note",
  "turn-pending",
] as const;

export type CheckpointCondition = (typeof CHECKPOINT_CONDITIONS)[number];

// The facts one turn end hands the rule.
export type CheckpointFacts = {
  // The switch, as configured. Only `live` passes `mode`.
  mode: string;
  // The durable value the turn end computed.
  durable: boolean;
  // The context fill read at this turn end, or null where it could not be.
  percent: number | null;
  // Whether an operator's turn opened this turn, the keyboard and Remote
  // Control among them, or an operator-class channel message did.
  operatorOpenedTurn: boolean;
  // Milliseconds since the newest operator message the session has seen, as
  // rule 6 counts one, or since the session's start where it has seen none.
  operatorQuietMs: number;
  // Whether an operator-class message is waiting to be brought back as a
  // turn of its own.
  operatorWaiting: boolean;
  // How many asks are open on live goal entries.
  openAsks: number;
  // The fill at the session's first turn end, or null where it was unread.
  firstTurnPercent: number | null;
  // The lengths of the engine's background_tasks and session_crons lists
  // for this turn end, each null where the engine gave none.
  backgroundTasks: number | null;
  sessionCrons: number | null;
  // Whether a hand-over note with nothing running was written this turn.
  noteWritten: boolean;
  // Whether this turn end has sent a turn of its own, or will send one.
  turnPending: boolean;
  // Whether the verdict leaves `mode` and `no-note` out.
  shadow: boolean;
};

export type CheckpointDecision = {
  // Every failing condition, in the rule's order.
  failed: CheckpointCondition[];
  // `restart` where nothing the verdict counts failed, `hold` otherwise.
  verdict: "restart" | "hold";
};

// The two conditions shadow leaves out of its verdict.
const SHADOW_SKIPS: readonly CheckpointCondition[] = ["mode", "no-note"];

export function decideCheckpointRestart(facts: CheckpointFacts): CheckpointDecision {
  const fails: Record<CheckpointCondition, boolean> = {
    "mode": facts.mode !== "live",
    "not-durable": !facts.durable,
    "percent-unreadable": facts.percent === null,
    "below-floor": facts.percent !== null && facts.percent < CHECKPOINT_FLOOR_PERCENT,
    "operator-turn": facts.operatorOpenedTurn,
    "operator-recent": facts.operatorQuietMs < CHECKPOINT_QUIET_MS || facts.operatorWaiting,
    "ask-open": facts.openAsks > 0,
    "no-gain": facts.firstTurnPercent !== null && facts.firstTurnPercent >= CHECKPOINT_FLOOR_PERCENT,
    "background-running": (facts.backgroundTasks ?? 0) > 0 || (facts.sessionCrons ?? 0) > 0,
    "no-note": !facts.noteWritten,
    "turn-pending": facts.turnPending,
  };
  const failed = CHECKPOINT_CONDITIONS.filter((name) => fails[name]);
  const counted = facts.shadow ? failed.filter((name) => !SHADOW_SKIPS.includes(name)) : failed;
  return { failed, verdict: counted.length === 0 ? "restart" : "hold" };
}

// How long the plugin holds its prompts after a saved restart request: long
// enough for the supervisor's poll to read the request, its stop grace to
// end the session and its busy cap to wait out a turn still running. A
// declared figure; the plugin reads none of the supervisor's own.
export const CHECKPOINT_HOLD_MS = 12 * 60 * 1000;

// Whether the plugin holds its prompts, at `now`: under live, while the turn
// end is deciding and saving a restart request (restartPending), and for
// CHECKPOINT_HOLD_MS after the save. The hold covers every prompt whose
// source waits in the store for the next session, so no such turn opens in a
// session the supervisor is about to stop. A prompt that carries an
// operator's words held nowhere else, the mid-turn re-prompt and the reply
// backstop's fallback, is sent regardless. Past the
// bound the session runs as it would with no request. Not under shadow,
// which sets restartWritten too but ends no session.
//
// The hold has three accepted gaps, each a turn the supervisor finishes
// before it stops the session: a path that claimed its item before the hold
// rose still submits after the save, a tick prompt submitted during the turn
// end's own awaits before the rule runs still goes, and so does a [KAIZEN]
// thread message the tick submits after its own awaits where the hold rose
// during them, since hooks/controller-tick.ts reads the hold before those
// awaits and not again.
export function checkpointPromptsHeld(memory: Pick<CheckpointMemory, "mode" | "restartPending" | "restartWritten" | "restartSavedAt">, now: number): boolean {
  if (memory.mode !== "live") return false;
  if (memory.restartPending) return true;
  return memory.restartWritten && memory.restartSavedAt !== null && now - memory.restartSavedAt < CHECKPOINT_HOLD_MS;
}

// The restart_untaken decision, once, at the first call at or past
// CHECKPOINT_HOLD_MS after a saved request under live, with the whole minutes
// waited; null at every other call. It marks the memory so no second one is
// made. The caller pushes it into the decision ring and saves it as it saves
// its own decisions. restartWritten stays true, so the rule is not called
// again and no second request is made.
export function checkpointRestartUntaken(memory: CheckpointMemory, now: number): { timestamp: number; loop: "monitor"; action: "restart_untaken"; detail: string } | null {
  if (memory.mode !== "live" || !memory.restartWritten || memory.restartUntaken || memory.restartSavedAt === null) return null;
  const waited = now - memory.restartSavedAt;
  if (waited < CHECKPOINT_HOLD_MS) return null;
  memory.restartUntaken = true;
  const minutes = Math.floor(waited / 60_000);
  return {
    timestamp: now,
    loop: "monitor",
    action: "restart_untaken",
    detail: `no restart came ${minutes} minutes after the checkpoint restart request was saved, so the plugin submits its prompts again`,
  };
}

// How the detail of a restart_requested decision this plan writes opens. A
// supervisor_restart call writes the same action with the caller's own
// reason as its detail.
export const CHECKPOINT_REQUEST_DETAIL_PREFIX = "checkpoint restart at";

// The shape of a decision in the persona's store, as far as the withdrawal
// below reads it.
export type CheckpointStoreDecision = { timestamp: number; action: string; detail: string };

// Takes the restart_requested decision this session's saved request wrote
// back out of `decisions`, at restart_untaken, so a supervisor that reads the
// store after the bound finds no request to act on. The decision is found by
// identity, the object memory.request holds; where the session's state was
// read again since the save, so the object is not in the list, it is found by
// its action, its time and its detail, which opens
// CHECKPOINT_REQUEST_DETAIL_PREFIX. A supervisor_restart decision, which
// carries another time and its caller's reason, is never taken. Clears
// memory.request either way, and returns whether a decision was taken. The
// caller saves the list as it saves its own decisions.
export function withdrawCheckpointRequest<T extends CheckpointStoreDecision>(memory: Pick<CheckpointMemory, "request">, decisions: T[]): boolean {
  const held = memory.request;
  memory.request = null;
  if (held === null) return false;
  let at = decisions.findIndex((d) => d === held);
  if (at === -1) {
    at = decisions.findIndex((d) => d.action === "restart_requested" && d.timestamp === held.timestamp && d.detail === held.detail && d.detail.startsWith(CHECKPOINT_REQUEST_DETAIL_PREFIX));
  }
  if (at === -1) return false;
  decisions.splice(at, 1);
  return true;
}

// The count of one list on the engine's Stop payload: its length where the
// field is an array, and null where it is absent or anything else. Every
// entry counts, whatever its type or status, since the engine lists only
// work still in flight.
export function stopListCountOf(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

// What the rule's caller keeps in the session's memory between turn ends.
// None of it is stored, so a restarted plugin starts it over and the
// persona's stored state carries none of it.
export type CheckpointMemory = {
  // The switch as this session read it at registration.
  mode: CheckpointMode;
  // The session's own start, the operator clock's origin where no
  // operator message has been seen.
  startedAt: number;
  // The time of the newest operator message the session has seen, or null:
  // an operator's turn at its start, the keyboard and Remote Control among
  // them, an operator-class channel message on the prompt path or queued
  // into a running turn, and a prompt typed at the keyboard or sent through
  // Remote Control while a turn runs.
  operatorAt: number | null;
  // Whether an operator's turn opened the running turn, the keyboard and
  // Remote Control among them, or an operator-class channel message; cleared
  // at each main-loop turn end.
  operatorOpenedTurn: boolean;
  // Whether the session's first main-loop turn has ended, and the fill read
  // there, null where it could not be read.
  firstTurnEnded: boolean;
  firstTurnPercent: number | null;
  // The two counts the newest main-session Stop event gave, null where none
  // came since the last main-loop turn end or a list was not an array.
  backgroundTasks: number | null;
  sessionCrons: number | null;
  // Whether a compaction of the main conversation ran since the last
  // compaction_first_turn event, cleared at that event's write.
  compactionRan: boolean;
  // Whether this session has made its one restart: under shadow, written its
  // restart verdict, as a live session would have ended there; under live,
  // saved its restart request. Either way the rule is called no more, and
  // under live the checkpoint note reminder attaches no line and
  // handover_write refuses, past the hold's bound too.
  restartWritten: boolean;
  // Under live, the time the restart request was saved, null before; the
  // hold's bound counts from it.
  restartSavedAt: number | null;
  // Under live, the restart_requested decision the saved request pushed,
  // null before the save and once withdrawCheckpointRequest has run.
  request: CheckpointStoreDecision | null;
  // Under live, the persona whose record the saved request was written to,
  // null before the save. The bound's acts write only while the session
  // still holds that persona.
  requestPersona: string | null;
  // Under live, whether the turn end is between its decision to request a
  // restart and the save's settling: raised in the same synchronous step as
  // that decision and cleared once the save settles, whatever its outcome.
  // checkpointPromptsHeld holds while it stands.
  restartPending: boolean;
  // Whether the restart_untaken decision has been made, so it is made once.
  restartUntaken: boolean;
  // Whether handover_write ran in the running turn with running "none", the
  // fact the no-note condition reads; set by that call and cleared at each
  // main-loop turn start.
  noteWritten: boolean;
};
