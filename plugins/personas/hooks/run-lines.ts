// run-lines.ts: which run line a moment of a plan run owes, and what it says.
//
// A run line is one message the plugin sends through the reply tool to the
// session's own thread at a moment of a plan run, where the worker's own turn
// sent nothing. The kinds are a closed list of four: start, section, close
// and hour. "Status line" keeps its other meaning in the plugin, the
// WORKING:, WAITING: or BLOCKED: lead of a turn's closing text.
//
// This module holds the decision and the texts as functions of plain values,
// and the hour line's send and settle, which its two sites share. The
// turn-end handler in hooks/turn-complete.ts holds the read of those values,
// the start, section and close send and the state write, and the
// controller's tick in hooks/controller-tick.ts holds the read and the state
// write for the hour line's other site. A
// run line carries only values the plugin read from the plan document, the
// title, the Chapter and section counts and the Next: line, the file name of
// the holder's planPath where the document carries no title, and a count of
// minutes the plugin measured. It carries none of the turn's answer text.

import { headPoints, planHolderOf, type AgentState, type GoalNode, type RunLines } from "./agent-state";
import { scrubText } from "./redactor";
import { safeErrorText } from "./text";

export type RunLineKind = "start" | "section" | "close" | "hour";

// The tool every run line is sent through, the relay's reply to the
// session's own thread.
export const RUN_LINE_TOOL = "mcp__plugin_relay_channel-relay__reply";

// What every run line opens with, so the operator can tell a line the plugin
// wrote from the worker's own.
export const RUN_LINE_LEAD = "[plugin] ";

// The most of a failed send's error message a run_line decision carries.
export const RUN_LINE_ERROR_MAX_CHARS = 80;

// Whether the session is a worker's: its persona is neither the coordinator
// nor the architect, and its tree's root was not seeded from the roster, the
// mark of a goal persona's tree. Those three seats hold plan entries they do
// not run, so no run opens for them. An empty architectPersona matches no
// persona.
export function isWorkerSession(
  persona: string,
  coordinatorPersona: string,
  architectPersona: string,
  rootSource: GoalNode["source"] | undefined,
): boolean {
  if (persona === coordinatorPersona) return false;
  if (architectPersona !== "" && persona === architectPersona) return false;
  return rootSource !== "roster";
}

// The plan holder of the tree's active leaf, the entry activeGoalId names
// where its own status is active, or undefined where the tree has no active
// leaf or the leaf sits under no plan. A holder whose task is the active
// leaf is that leaf's plan holder whatever the holder's own status reads, so
// the open and the hour line both key on this and never on the holder's
// status. A paused tree has no active leaf, since a pause pauses the leaf.
export function activeLeafHolderOf(state: Pick<AgentState, "goals" | "activeGoalId">): GoalNode | undefined {
  const leaf = state.activeGoalId ? state.goals.find((g) => g.id === state.activeGoalId) : undefined;
  if (leaf === undefined || leaf.status !== "active") return undefined;
  return planHolderOf(state, leaf);
}

// Whether a run opens for the turn's plan holder: it is the active leaf's
// plan holder, its document read as a document that is not complete, and it
// carries no run yet. The open keys on the tree the plugin keeps, and never
// on the document's Status: header, which the worker writes.
export function runOpens(
  holdsActiveLeaf: boolean,
  documentReadAndOpen: boolean,
  hasRunLines: boolean,
): boolean {
  return holdsActiveLeaf && documentReadAndOpen && !hasRunLines;
}

// The state a run opens with, at `now`, with no Chapter told to the thread.
export function newRunLines(now: number): RunLines {
  return { startedAt: now, chapters: 0, byTurn: 0, byPlugin: 0, hours: 0, unsent: 0, replies: 0 };
}

// The one moment an open run owes at a persona's own turn end, or
// "abandoned" where the holder was abandoned and the run closes with no line
// and no count, or null where it owes none. Where more than one moment is
// owed the order is close, then section, then start, and the one line
// settles them all. `opened` is whether the run opened at this turn end,
// `storedChapters` the holder's Chapter count as the document read stored
// it, and `toldChapters` the count the thread has been told of. A run first
// seen with Chapters written owes one section line and no start line.
export function runLineMomentOf(
  status: GoalNode["status"],
  opened: boolean,
  storedChapters: number,
  toldChapters: number,
): Exclude<RunLineKind, "hour"> | "abandoned" | null {
  if (status === "abandoned") return "abandoned";
  if (status === "complete") return "close";
  if (storedChapters > toldChapters) return "section";
  if (opened) return "start";
  return null;
}

// The name a run line gives the plan: the document's title, or the file name
// of its planPath where the reader found none.
export function runLineTitleOf(title: string | undefined, planPath: string): string {
  if (title !== undefined && title !== "") return title;
  return planPath.slice(planPath.lastIndexOf("/") + 1);
}

// A start, section or close line's text. `chapters` and `sections` are the
// holder's stored counts and `next` its stored Next: line, already cut by
// the plan document reader. Where the section count is 0 the start and close
// lines carry no count, and where there is no Next: line the section line
// ends after the title's period.
export function runLineText(
  kind: Exclude<RunLineKind, "hour">,
  title: string,
  chapters: number,
  sections: number,
  next: string | undefined,
): string {
  if (kind === "start") {
    return sections > 0
      ? `${RUN_LINE_LEAD}Started: ${title}. ${sections} sections.`
      : `${RUN_LINE_LEAD}Started: ${title}.`;
  }
  if (kind === "section") {
    const head = `${RUN_LINE_LEAD}Section ${chapters} of ${sections} closed: ${title}.`;
    return next !== undefined && next !== "" ? `${head} Next: ${next}` : head;
  }
  return sections > 0
    ? `${RUN_LINE_LEAD}Complete: ${title}. ${chapters} of ${sections} sections closed.`
    : `${RUN_LINE_LEAD}Complete: ${title}.`;
}

// How long a run goes with no line recorded before it owes an hour line, and
// how long each of the hour line's two sites holds after its own try.
export const RUN_LINE_HOUR_MS = 60 * 60_000;

// How long a turn must have been open before the controller's tick counts it
// as the session showing work, so a turn the operator's message opened after
// a long wait is not met with a line saying the session was running.
export const RUN_LINE_TURN_GRACE_MS = 10 * 60_000;

// How old a site's in-flight mark may grow before another site treats it as
// absent, so a send that never settles cannot stop the hour line for good.
export const RUN_LINE_MARK_STALE_MS = 5 * 60_000;

// The time an hour line counts from: the latest of the run's start, the last
// line recorded reaching the thread in the run, and the session's last
// reply-tool call, which is null where the session has seen none.
export function hourLineSince(run: RunLines, lastReplyAt: number | null): number {
  return Math.max(run.startedAt, run.threadAt ?? 0, lastReplyAt ?? 0);
}

// Whether a holder owes an hour line at `now`: it is the active leaf's plan
// holder, its run is open, and RUN_LINE_HOUR_MS has passed since the time the
// line counts from. Each site adds its own test that the session shows work
// and its own hold.
export function hourLineOwed(holdsActiveLeaf: boolean, run: RunLines, lastReplyAt: number | null, now: number): boolean {
  return holdsActiveLeaf && run.closedAt === undefined && now - hourLineSince(run, lastReplyAt) >= RUN_LINE_HOUR_MS;
}

// Whether the turn open since `turnStartedAt`, null where none is open,
// shows work at the controller's tick at `now`: it has been open for
// RUN_LINE_TURN_GRACE_MS.
export function hourLineTurnShowsWork(turnStartedAt: number | null, now: number): boolean {
  return turnStartedAt !== null && now - turnStartedAt >= RUN_LINE_TURN_GRACE_MS;
}

// Takes the in-flight mark the two hour sites share for `holderId` at `now`,
// returning its set time for releaseHourLineMark, or null where another
// site's mark set inside RUN_LINE_MARK_STALE_MS stands and the caller sends
// nothing. A mark older than that is treated as absent: unsent rises once
// and one run_line decision of kind hour is pushed onto `decisions`, before
// this site's own mark replaces it. `chapters` and `sections` are the
// holder's stored counts.
export function takeHourLineMark(
  inFlight: Map<string, number>,
  run: RunLines,
  holderId: string,
  chapters: number,
  sections: number,
  now: number,
  decisions: AgentState["decisions"],
): number | null {
  const setAt = inFlight.get(holderId);
  if (setAt !== undefined) {
    if (now - setAt < RUN_LINE_MARK_STALE_MS) return null;
    run.unsent += 1;
    const outcome = runLineUnsentOf(`no result in ${RUN_LINE_MARK_STALE_MS / 60_000} minutes`);
    decisions.push({ timestamp: now, loop: "goal", action: "run_line", detail: runLineDetailOf(holderId, "hour", chapters, sections, outcome) });
  }
  inFlight.set(holderId, now);
  return now;
}

// Clears the mark a site set at `setAt`, and only that mark, so a send that
// settles after another site replaced its stale mark leaves the newer one.
export function releaseHourLineMark(inFlight: Map<string, number>, holderId: string, setAt: number): void {
  if (inFlight.get(holderId) === setAt) inFlight.delete(holderId);
}

// Whether a site that last tried an hour line at `triedAt` still holds at
// `now`. A site that has not tried holds nothing.
export function hourLineHeld(triedAt: number | undefined, now: number): boolean {
  return triedAt !== undefined && now - triedAt < RUN_LINE_HOUR_MS;
}

// An hour line's text. `chapters` and `sections` are the holder's stored
// counts, and `since` the time hourLineSince read, so the minutes are whole
// minutes with no line recorded. The line names the section after the last
// Chapter, reads "finishing" once every section has its Chapter, and carries
// no count where the section count is 0. It states what the plugin recorded
// and never that the run is healthy.
export function hourLineText(title: string, chapters: number, sections: number, since: number, now: number): string {
  const tail = `No line recorded here for ${Math.floor((now - since) / 60_000)} minutes.`;
  if (sections <= 0) return `${RUN_LINE_LEAD}Still running: ${title}. ${tail}`;
  const middle = chapters >= sections ? `all ${sections} sections closed, finishing` : `section ${chapters + 1} of ${sections}`;
  return `${RUN_LINE_LEAD}Still running: ${title}, ${middle}. ${tail}`;
}

// A run_line decision's detail: the holder, the kind, the stored Chapter and
// section counts at the moment, and how the moment settled.
export function runLineDetailOf(holderId: string, kind: RunLineKind, chapters: number, sections: number, outcome: string): string {
  return `${holderId}: ${kind} ${chapters} of ${sections}: ${outcome}`;
}

// The three ways a moment settles, as a run_line decision names them. An
// hour line settles the second or the third way.
export const RUN_LINE_BY_TURN = "the turn sent its own";
export const RUN_LINE_BY_PLUGIN = "sent by the plugin";
export function runLineUnsentOf(errorText: string): string {
  return `unsent: ${errorText}`;
}

// Why a send whose call returned was not taken by the thread, or null where
// it was. $.tool.call reports a refusal as `{ deny }` and a tool's own error
// as a result carrying `isError: true`, and throws for neither, so a returned
// value is a sent line only where it carries neither. The reason is the
// deny's text, else "denied", or the error result's text, else "tool error".
export function runLineRefusalOf(returned: unknown): string | null {
  if (typeof returned !== "object" || returned === null) return null;
  const r = returned as { deny?: unknown; isError?: unknown; text?: unknown };
  if (typeof r.deny === "string") return r.deny !== "" ? r.deny : "denied";
  if (r.isError === true) return typeof r.text === "string" && r.text !== "" ? r.text : "tool error";
  return null;
}

// Sends an hour line through `send`, the engine's tool call, and settles it
// on `run`, for either of the hour line's two sites. The text passes the
// redactor's scrubText before the send, as every run line's does. A send
// taken raises hours and sets threadAt to `clock()`. A send that threw, or
// returned a deny or a tool error, raises unsent, leaves threadAt and calls
// `onUnsent`, where a site sets its own hold. Never throws for the send.
// Returns the run_line decision, `chapters` and `sections` being the
// holder's stored counts, for the caller to push.
export async function sendHourLine(
  send: (args: { tool: string; message: string }) => Promise<unknown>,
  run: RunLines,
  holderId: string,
  text: string,
  chapters: number,
  sections: number,
  clock: () => number,
  onUnsent: () => void,
): Promise<AgentState["decisions"][number]> {
  let outcome: string;
  try {
    const refusal = runLineRefusalOf(await send({ tool: RUN_LINE_TOOL, message: scrubText(text).text }));
    if (refusal === null) {
      run.hours += 1;
      run.threadAt = clock();
      outcome = RUN_LINE_BY_PLUGIN;
    } else {
      run.unsent += 1;
      onUnsent();
      outcome = runLineUnsentOf(headPoints(safeErrorText(refusal), RUN_LINE_ERROR_MAX_CHARS));
    }
  } catch (err) {
    run.unsent += 1;
    onUnsent();
    outcome = runLineUnsentOf(headPoints(safeErrorText(err), RUN_LINE_ERROR_MAX_CHARS));
  }
  return { timestamp: clock(), loop: "goal", action: "run_line", detail: runLineDetailOf(holderId, "hour", chapters, sections, outcome) };
}
