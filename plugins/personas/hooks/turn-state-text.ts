// turn-state-text.ts: turn state text: the open and disposition state a turn is described by, the
// tool activity that scores it, the step watch and effort rewrite a next step
// carries, and the recap times.
//
// No import of the engine handle and no state of its own: every function takes what it
// reads as arguments, so the tick harness, which loads a fresh hooks/index.ts per
// case, shares nothing through it.

import { kaizenLine, type TurnScoreTools } from "./question-catalog";

// The most characters of the arriving message the turn-open question's state
// carries. The record's own text is cut far shorter than this, by
// clampTurnRecordText, so the two bounds are not the same number.
export const TURN_OPEN_MESSAGE_MAX = 1200;

// The turn-open question's state, as the one text the seam's `ask` entry point
// takes. Its three fields are labelled inside that text rather than sent as a
// structured state, because `ask` types its state a string while the request
// path beneath it takes either; widening that entry point is a change to
// hooks/decision-seam.ts, which this section does not touch. A labeller reads
// the same three field names off the journal's state column either way.
//
// Every value goes through kaizenLine, this file's own guard for text reaching
// a composed channel: it folds the line terminators and runs bracketSafeText,
// whose own comment gives the reason, that the text cannot forge a label. That
// is not cosmetic here. A message carrying its own line break and the text
// "open_record:" would otherwise write a second field into a state the plugin
// is supposed to be the only author of.
export function turnOpenStateText(activeGoal: string, openRecord: string, message: string): string {
  return `active_goal: ${kaizenLine(activeGoal)}\n` +
    `open_record: ${kaizenLine(openRecord)}\n` +
    `message: ${kaizenLine(message)}`;
}

// The most characters of the turn's opening text and of its closing text the
// turn-disposition question's state carries. Both bounds are the state's own,
// so the two texts are cut here rather than by the callers that hold them.
const TURN_DISPOSITION_ASKED_MAX = 1200;

const TURN_DISPOSITION_MESSAGE_MAX = 3000;

// The turn_tool_activity field: the seven yes-or-no flags, the work-tool count
// and the ring, on one line in a fixed labelled shape. A classifier reads it
// and an offline labelling pass reads it back off the journal, so a stable
// name=value form matters more than a compact one. The ring is the tool names
// in call order, comma-joined.
export function turnToolActivityText(flags: TurnToolFlags, ring: readonly string[], workToolCount: number, replyCalled: boolean): string {
  const yn = (held: boolean): string => (held ? "yes" : "no");
  return `plan_read=${yn(flags.planRead)} plan_edited=${yn(flags.planEdited)} commit=${yn(flags.committed)} push=${yn(flags.pushed)} ` +
    `agent_dispatched=${yn(flags.agentDispatched)} goal_done=${yn(flags.goalDoneCalled)} reply=${yn(replyCalled)} ` +
    `work_tools=${workToolCount} tools=${ring.join(",")}`;
}

// The turn's tool activity as the turn-score state reads it: the seven flags
// under the names turnToolActivityText gives them, and a copy of the ring, so
// a call landing after this read cannot change what the scorer is handed.
export function turnScoreToolsOf(flags: TurnToolFlags, ring: readonly string[], replyCalled: boolean): TurnScoreTools {
  return {
    flags: {
      plan_read: flags.planRead, plan_edited: flags.planEdited, commit: flags.committed, push: flags.pushed,
      agent_dispatched: flags.agentDispatched, goal_done: flags.goalDoneCalled, reply: replyCalled,
    },
    calls: [...ring],
  };
}

// The turn-disposition question's state, as the one text the seam's `ask`
// entry point takes, on the shape turnOpenStateText gives the turn-open
// question and for the reason its comment states: `ask` types its state a
// string, and every value goes through kaizenLine so a text carrying its own
// line break and a label cannot write a fifth field into a state the plugin is
// the only author of. The closing text is the model's own, and the opening
// text is an external message, so both are exactly the texts that guard is
// for. The two cuts are applied before the guard, which changes no length.
export function turnDispositionStateText(activeGoal: string, asked: string, finalMessage: string, activity: string): string {
  return `active_goal: ${kaizenLine(activeGoal)}\n` +
    `this_turn_was_asked: ${kaizenLine(asked.slice(0, TURN_DISPOSITION_ASKED_MAX))}\n` +
    `agent_final_message: ${kaizenLine(finalMessage.slice(0, TURN_DISPOSITION_MESSAGE_MAX))}\n` +
    `turn_tool_activity: ${kaizenLine(activity)}`;
}

// How often a standing agent hold writes its idle_hold_agent_held line.
export const AGENT_HOLD_REPORT_MS = 60 * 60_000;

/**
 * Item 2 backstop (Round 28): whether a tool call counts as "did real
 * work" for the turn.complete backstop, which logs an `untracked_work`
 * decision for a turn that did work with no open root. Built-in file/shell
 * tools that change state; any MCP tool that is neither this plugin's own
 * (which would have opened a goal itself, making the backstop moot) nor the
 * channel's reply tool (a priming turn's only call, which must never look
 * like task work - a channel-attached passive child's acknowledgment turn
 * would otherwise log untracked work, which the supervisor reads on a clean
 * exit as a reason to relaunch). Read-only tools (Read, Grep, Glob, ...) do
 * not count: looking at something is not doing the thing the operator
 * asked for.
 */
export function isWorkTool(toolName: string): boolean {
  if (["Write", "Edit", "Bash", "NotebookEdit"].includes(toolName)) return true;
  if (!toolName.startsWith("mcp__")) return false;
  if (toolName.startsWith("mcp__personas__")) return false;
  if (toolName.includes("__reply") || toolName.endsWith("_reply")) return false;
  return true;
}

/**
 * Whether a tool call is work for the nudge count's reset: isWorkTool's set,
 * plus an agent dispatch. A dispatched agent works on the worker's behalf, so
 * a turn that dispatched one is a working turn for the count alone; the
 * untracked-work backstop and the lead clear keep reading isWorkTool.
 */
export function isNudgeCountWork(toolName: string): boolean {
  return isWorkTool(toolName) || toolName === "Agent";
}

// The step watch's reading of one turn, opened at its turn.start under its
// id. `steps` counts the main loop's responses and `toolUses` the tool calls
// they made, both read into the turn end's readings decision.
//
// `effortReading` is the latest step-effort call the watch fired, held until
// the next step writes its outcome: its stamp id, the index of the step its
// answer is for, whether the call has settled and the choice Jev answered,
// null while it is pending or where it failed; null before the turn's first
// reading and between an outcome and the next reading. `effort` counts the
// turn's step-effort readings for the turn end's decision: the calls fired,
// the calls settled, the settled choices by option id, the readings still
// unsettled when the step they were for fired, and the effort rewrites
// applied to a step, by level, and refused for an effort the event's shape
// does not take. Only a live reading rewrites a step, so under shadow the
// three rewrite counts stay zero.
export type StepWatch = {
  turnId: string | null;
  steps: number;
  toolUses: number;
  effortReading: { stampId: string; forIndex: number; settled: boolean; choice: string | null } | null;
  effort: {
    readings: number;
    settled: number;
    choices: Record<string, number>;
    late: number;
    lowered: number;
    raised: number;
    unrewritable: number;
  };
};

export function stepWatchOf(turnId: string | null): StepWatch {
  return {
    turnId, steps: 0, toolUses: 0,
    effortReading: null,
    effort: { readings: 0, settled: 0, choices: {}, late: 0, lowered: 0, raised: 0, unrewritable: 0 },
  };
}

// A step-effort call's next_step_tools value, read off the step after it: the
// names of the tools that step called, in call order and joined with commas,
// or `answer` where it called none, whatever its text. The turn end writes
// `none` itself for a call no step came after.
export function nextStepToolsValue(toolUses: readonly { name: string }[]): string {
  return toolUses.length > 0 ? toolUses.map((use) => String(use.name)).join(",") : "answer";
}

// The step event a settled live step-effort choice sends down, counting the
// rewrite it applies into `counts`. `low` sends the request at low effort.
// `high` sends it at high where the step came at low or medium, and leaves a
// step already at high or above as it came, so a `high` never lowers the
// step's effort. `keep`, and any other choice, sends the
// step as it came. A step whose effort is absent or a number takes no named
// level, so a `low` or `high` choice leaves it as it came and counts it
// unrewritable. A step already at the level the choice names counts nothing.
export function stepEffortRewrite<E extends { effort?: unknown }>(
  e: E,
  choice: string,
  counts: { lowered: number; raised: number; unrewritable: number },
): E {
  if (choice !== "low" && choice !== "high") return e;
  if (typeof e.effort !== "string") {
    counts.unrewritable += 1;
    return e;
  }
  if (choice === "low") {
    if (e.effort === "low") return e;
    counts.lowered += 1;
    return { ...e, effort: "low" };
  }
  if (e.effort !== "low" && e.effort !== "medium") return e;
  counts.raised += 1;
  return { ...e, effort: "high" };
}

// Section 5 (goal-every-turn): the turn's own tool activity, which the
// turn-disposition question's state carries as turn_tool_activity. The flags,
// the ring and the work-tool count are reset at turn.start and written by
// tool.call for the main loop's calls alone, on the ground the nudge count
// takes: a subagent dispatched in an earlier turn can still be running, and
// its calls say nothing about what the persona's own turn did. The reset
// itself carries no agent-id guard and rests on turn.start firing for the
// persona's own turns only, which is what the engine's turn events describe
// and what no test here pins; a reset is idempotent, so a guard on it would
// be a mechanism no reading needs. Each flag is a text read of the call's own
// arguments and never a run: a commit or a push is a Bash command whose
// subcommand is `commit` or `push`, with any option run between `git` and
// the subcommand allowed, and a plan document is a name directly under
// docs/plans/ that the store's own PLAN_PATH_PATTERN accepts. The ring holds
// the last TURN_TOOL_RING_MAX tool names in call order. The work-tool count
// is kept here rather than read from toolCallsThisTurn (a let in hooks/index.ts), which counts
// every loop's work calls for the untracked-work backstop and the lead
// clear, so the four-field state has one subject across all eight readings.
export const TURN_TOOL_RING_MAX = 8;

export type TurnToolFlags = {
  planRead: boolean;
  planEdited: boolean;
  committed: boolean;
  pushed: boolean;
  agentDispatched: boolean;
  goalDoneCalled: boolean;
};

export function freshTurnToolFlags(): TurnToolFlags {
  return { planRead: false, planEdited: false, committed: false, pushed: false, agentDispatched: false, goalDoneCalled: false };
}

// How long bin/restart-recap.mjs may run before $.process.run kills it and
// rejects. The prompt.submit hook has ten seconds in all, and the script reads
// bounded tails of at most two transcripts, so five seconds is its ceiling.
export const RECAP_TIMEOUT_MS = 5_000;

// The automatic recap's gate. The previous session's last record must be at
// most RECAP_RECENT_MS old, and either the store holds an active goal or the
// operator last wrote at most RECAP_OPERATOR_MS ago. A launch after a parked
// night, or after a stretch with no goal and no operator, carries no block.
export const RECAP_RECENT_MS = 24 * 60 * 60_000;

export const RECAP_OPERATOR_MS = 6 * 60 * 60_000;

// A header time as epoch milliseconds, or null where it is absent or does not
// parse, which fails whichever window reads it.
export function recapTimeOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// An age in whole hours, for a decision line.
export function recapAgeText(ms: number | null, now: number): string {
  return ms === null ? "unknown" : `${Math.round((now - ms) / 3_600_000)} hours ago`;
}
