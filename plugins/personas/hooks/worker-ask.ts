// worker-ask.ts: worker ask text: the ASK marker lines a worker closes a turn with, the status
// line a closing text states, and the checks that decide whether an ask is
// opened, suppressed or left standing.
//
// No import of the engine handle and no state of its own: every function takes what it
// reads as arguments, so the tick harness, which loads a fresh hooks/index.ts per
// case, shares nothing through it.

import { type AgentState, type AskEntry, type AskOpener, type AskOpenRefusal, type GoalNode, openAskEntries } from "./agent-state";

// The worker's ASK: marker, a line reading `ASK: <question>? Recommend:
// <choice>` anywhere in an answer, in any case. turn.complete opens an ask
// record from it, and the step watch notes the first step whose answer
// carries one, so the two read one rule. No `g` flag, so neither `match` nor
// `test` keeps state between calls.
export const ASK_MARKER_LINE = /^ASK:\s*(.+?\?\s*Recommend:\s*.+)$/im;

// The line breaks a closing text is cut at before each line is matched
// against ASK_MARKER_LINE: the four terminators its `m` flag reads as line
// ends, so a line read here is a line the marker's own anchors would see. A
// VT, FF or NEL inside a line stays inside its question, which the prompts
// that carry a question quote as a continuation line.
export const ASK_MARKER_LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/u;

// The most asks one turn opens, its ask_open calls and its closing text's
// ASK: lines together. Lines past it are refused under one ask_cap_refused
// decision naming their count, and a call past it under its own.
export const ASK_TURN_MAX = 4;

// The text after "Recommend:" in a matched ASK: line, trimmed: the choice the
// work proceeds on while the question stands.
export function askRecommendOf(question: string): string {
  const at = /\?\s*Recommend:\s*/i.exec(question);
  return at ? question.slice(at.index + at[0].length).trim() : "";
}

// A fresh id for an entry on `nodeId`, in the form the ledger stores,
// ask-<nodeId>-<ms>. Several lines parsed in one turn share a millisecond,
// so the ms part steps up until no entry on the ledger holds the id.
export function newAskId(state: AgentState, nodeId: string, now: number): string {
  let ms = now;
  while (state.asks.some((entry) => entry.id === `ask-${nodeId}-${ms}`)) ms += 1;
  return `ask-${nodeId}-${ms}`;
}

// The open entry of `opener` on `nodeId`, where one stands.
export function openAskBy(state: AgentState, opener: AskOpener, nodeId: string): AskEntry | undefined {
  return openAskEntries(state).find((entry) => entry.opener === opener && entry.nodeId === nodeId);
}

// Whether an open blocking entry of `opener` stands on `nodeId`. Each
// controller opener asks once per node: a second streak or cap on the same
// node while its own question still holds the work adds nothing the operator
// does not have. An own entry whose hold was lifted does not stand: the
// opener withdraws it and opens a fresh one, through withdrawLiftedAskBy.
export function ownAskStands(state: AgentState, opener: AskOpener, nodeId: string): boolean {
  const own = openAskBy(state, opener, nodeId);
  return own !== undefined && own.blocking;
}

/**
 * D5b: an open ask never silences the worker, part 2. A worker can state
 * the identical ASK: question again right after the
 * operator (or a thread reply) just closed it, which reads as the worker
 * ignoring the answer. Suppress a re-open of the exact same question on the
 * exact same node within the suppress window; the caller falls through to a
 * nudge instead so the plan keeps moving rather than pausing on a loop.
 */
export function shouldSuppressReask(
  node: GoalNode | undefined,
  question: string,
  now: number,
  suppressMs: number,
): boolean {
  if (!node || !node.lastAskQuestion || node.lastAskClosedAt === undefined) return false;
  return node.lastAskQuestion === question && now - node.lastAskClosedAt < suppressMs;
}

// Why openWorkerAsk refused an ask: "placeholder" for a question still
// carrying an angle-bracket template placeholder, "reask" for the question
// this node closed within the suppress window, "already-open" for a question
// open on the node now, "turn-cap" past ASK_TURN_MAX opens this turn, and
// openLedgerAsk's own refusals, "cap" among them for the open cap.
export type WorkerAskRefusal = "placeholder" | "reask" | "already-open" | "turn-cap" | AskOpenRefusal;

/**
 * The questions of the open asks on `node` whose hold timed out and that no
 * nudge on the entry has named since, joined one per line, or null where
 * there is none. An entry's timeout is the ask_timeout decision carrying its
 * id as askId, which tickOpenAsk logs as it clears the entry's blocking; a
 * nudge_sent decision on the entry after that clock means a nudge already
 * named it. The decision ring is capped, so a timeout pushed past
 * DECISIONS_MAX entries before the next nudge is not named, which costs one
 * sentence and nothing else.
 */
export function unnamedExpiredAskQuestion(state: AgentState, node: GoalNode): string | null {
  const unnamed: string[] = [];
  for (const entry of openAskEntries(state)) {
    if (entry.nodeId !== node.id || entry.blocking) continue;
    const timeout = state.decisions.find((d) => d.action === "ask_timeout" && d.askId === entry.id);
    if (!timeout) continue;
    const named = state.decisions.some((d) => d.action === "nudge_sent" && d.timestamp > timeout.timestamp && d.detail.startsWith(`${node.id}: `));
    if (!named) unnamed.push(entry.question);
  }
  return unnamed.length > 0 ? unnamed.join("\n") : null;
}

// The bound on a lead's reason, which is text from the worker's own closing
// line written into the store.
const LEAD_REASON_MAX = 300;

// The status line a closing text states, read from its first non-blank line:
// one of the literal uppercase markers `WORKING:`, `WAITING:` or `BLOCKED:`
// at the start of that line, with the rest of the line as the reason.
// `Working:`, `BLOCKED x`, the marker on a later line and the word inside a
// sentence all read as no status line. Never throws: a text that is not a
// string reads as none. The nudge asks for this line, the nudge count reads
// its presence on a nudged turn, and a `BLOCKED:` or `WAITING:` line on any
// entry is the worker's lead.
export function readStatusLine(text: unknown): { state: "working" | "blocked" | "waiting"; reason: string } | null {
  if (typeof text !== "string") return null;
  const found = text.split(/\r?\n/).find((line) => line.trim() !== "");
  if (found === undefined) return null;
  // One stray carriage return left by a \r\r\n ending is not reason text.
  const firstLine = found.endsWith("\r") ? found.slice(0, -1) : found;
  const m = /^(WORKING|BLOCKED|WAITING):(.*)$/.exec(firstLine);
  if (!m) return null;
  const state = m[1] === "WORKING" ? "working" : m[1] === "BLOCKED" ? "blocked" : "waiting";
  return { state, reason: m[2].trim().slice(0, LEAD_REASON_MAX) };
}
