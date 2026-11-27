// stream.ts: the stand-in's side of the launcher's two pipes, as pure
// functions. The launcher starts the host where it starts `claude`, writes
// its lines to the host's stdin and reads the host's stdout as a Claude Code
// stream-json stream. This module reads the one and builds the other; it
// imports no value, so it does no I/O and keeps no state of its own.
//
// claudeLineToTurn reads one stdin line. bin/supervise-holder.sh writes two
// shapes, and each line takes one of four results:
// - a user line, {type:"user", role:"user", message:{role:"user",
//   content:[{type:"text", text}, ...]}}, as the holder's priming write and
//   goal_prompt_json build it, is a turn whose text is the text blocks joined
//   by a newline. The top-level role may be left out; every block must be a
//   text block, and the joined text must hold more than space.
// - a control_request line whose request's subtype is interrupt, as the
//   holder's interrupt relay writes it, is an interrupt with its request id.
// - an empty line, or one of space alone, is skipped.
// - anything else is refused with a reason: a line past
//   LAUNCHER_LINE_MAX_CHARS, a line that is not JSON, and every other shape.
// A line is parsed once, inside a try, so no line throws.
//
// recordsFor turns one host event into the records the launcher's readers
// need, and no more, with the next state:
// - ready: one system record of subtype init, carrying the session id, the
//   engine's name and the model, once for the host's life.
// - handed: one user record, as a turn is handed to the adapter. It carries
//   no text: bin/supervise-turnstate.mjs reads the record's type alone.
// - step: while a turn is open, one assistant record per step. A step with
//   text and no tool call holds the text alone. A step that carried tool
//   calls, and a step with no text, which keeps the turn alive, hold a bare
//   {type:"tool_use"} block, after the text block where the step has text.
//   bin/supervise-turnstate.mjs reads a record holding a tool_use block as
//   busy whatever its age, and a text-only record as idle once it is five
//   minutes old, so the block keeps a long tool from reading idle. The block
//   is a busy mark and names no tool: a tool call's name, id, argument and
//   result are never written, and the step event carries only whether the
//   step called a tool.
// - turnEnded: while a turn is open, one assistant record holding the answer,
//   or one space where it is empty, and then one result record. The
//   assistant record is written unless the turn's newest assistant record is
//   already text-only, so it is owed where no step had text and where the
//   newest one held the busy mark. The turn-state reader reads a turn that
//   ends on its user record, or on a record holding a tool_use block, as
//   busy for good, which is why that record is owed. The
//   result's subtype is success for the reasons answer and refusal and error
//   for aborted and error, with is_error to match, and its usage keeps the
//   four counts Claude Code names (input_tokens, output_tokens,
//   cache_read_input_tokens, cache_creation_input_tokens) where the engine
//   gave each as a finite number. A turn end with no turn open writes nothing.
// Every record carries the session id. No record carries a timestamp, a
// rate-limit field, the result's text or any value the engine was handed.

// The longest stdin line read, the persona tools pipe's bound on one line.
// The host checks it after readline has buffered the whole line, so it bounds
// what is parsed, not what the process holds while the line arrives.
export const LAUNCHER_LINE_MAX_CHARS = 4 * 1024 * 1024;

export type LauncherLine =
  | { kind: "turn"; text: string }
  | { kind: "interrupt"; requestId: string }
  | { kind: "skip" }
  | { kind: "refused"; reason: string };

export type StreamEvent =
  | { kind: "ready" }
  | { kind: "handed" }
  // calledTools: whether the step carried tool calls. The calls themselves
  // never reach this module.
  | { kind: "step"; text?: string; calledTools: boolean }
  | { kind: "turnEnded"; answer: string; reason: string; usage?: unknown };

export interface StreamState {
  readonly sessionId: string;
  readonly engine: string;
  readonly model: string;
  // Whether the init record has been written.
  readonly initWritten: boolean;
  // Whether a turn is with the adapter: from handed until its turn end.
  readonly turnOpen: boolean;
  // Whether the open turn's newest assistant record is text-only, the record
  // the turn-state reader ages to idle; false before the turn writes one and
  // after one holding the busy mark.
  readonly saidLast: boolean;
}

export type StreamRecord = Record<string, unknown>;

// The Claude Code names of a turn's usage counts.
const USAGE_FIELDS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"] as const;
// The turn-end reasons a result reports as success.
const SUCCESS_REASONS: readonly string[] = ["answer", "refusal"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function claudeLineToTurn(line: string): LauncherLine {
  if (line.trim() === "") return { kind: "skip" };
  if (line.length > LAUNCHER_LINE_MAX_CHARS) return { kind: "refused", reason: `the line is longer than ${LAUNCHER_LINE_MAX_CHARS} characters` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "refused", reason: "the line is not JSON" };
  }
  if (!isRecord(parsed)) return { kind: "refused", reason: "the line is not a JSON object" };
  if (parsed.type === "control_request") {
    const request = parsed.request;
    if (!isRecord(request) || request.subtype !== "interrupt") return { kind: "refused", reason: "the control request is not an interrupt" };
    if (typeof parsed.request_id !== "string" || parsed.request_id === "") return { kind: "refused", reason: "the interrupt carries no request id" };
    return { kind: "interrupt", requestId: parsed.request_id };
  }
  if (parsed.type !== "user") return { kind: "refused", reason: "the line is neither a user line nor a control request" };
  if (parsed.role !== undefined && parsed.role !== "user") return { kind: "refused", reason: "the user line names another role" };
  const message = parsed.message;
  if (!isRecord(message) || message.role !== "user") return { kind: "refused", reason: "the user line holds no user message" };
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return { kind: "refused", reason: "the user message holds no content blocks" };
  const texts: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return { kind: "refused", reason: "the user message holds a block that is not text" };
    texts.push(block.text);
  }
  const text = texts.join("\n");
  if (text.trim() === "") return { kind: "refused", reason: "the user message holds no text" };
  return { kind: "turn", text };
}

// The state a host starts its stream from.
export function streamStateOf(sessionId: string, engine: string, model: string): StreamState {
  return { sessionId, engine, model, initWritten: false, turnOpen: false, saidLast: false };
}

// One assistant record: a text block where `text` is given, then the bare
// busy mark where `busy` is set.
function assistantRecord(sessionId: string, text: string | null, busy: boolean): StreamRecord {
  const content: Record<string, string>[] = [];
  if (text !== null) content.push({ type: "text", text });
  if (busy) content.push({ type: "tool_use" });
  return { type: "assistant", message: { role: "assistant", content }, session_id: sessionId };
}

// The four counts of `usage` Claude Code names, each a finite number; null
// where none is.
function usageOf(usage: unknown): Record<string, number> | null {
  if (!isRecord(usage)) return null;
  const counts: Record<string, number> = {};
  for (const field of USAGE_FIELDS) {
    const value = usage[field];
    if (typeof value === "number" && Number.isFinite(value)) counts[field] = value;
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

export function recordsFor(event: StreamEvent, state: StreamState): { records: StreamRecord[]; state: StreamState } {
  switch (event.kind) {
    case "ready":
      if (state.initWritten) return { records: [], state };
      return {
        records: [{ type: "system", subtype: "init", session_id: state.sessionId, engine: state.engine, model: state.model }],
        state: { ...state, initWritten: true },
      };
    case "handed":
      return {
        records: [{ type: "user", message: { role: "user", content: [] }, session_id: state.sessionId }],
        state: { ...state, turnOpen: true, saidLast: false },
      };
    case "step": {
      if (!state.turnOpen) return { records: [], state };
      const text = typeof event.text === "string" && event.text !== "" ? event.text : null;
      const busy = event.calledTools === true || text === null;
      return { records: [assistantRecord(state.sessionId, text, busy)], state: { ...state, saidLast: !busy } };
    }
    case "turnEnded": {
      if (!state.turnOpen) return { records: [], state };
      const records: StreamRecord[] = [];
      if (!state.saidLast) records.push(assistantRecord(state.sessionId, event.answer !== "" ? event.answer : " ", false));
      const success = SUCCESS_REASONS.includes(event.reason);
      const usage = usageOf(event.usage);
      records.push({ type: "result", subtype: success ? "success" : "error", is_error: !success, session_id: state.sessionId, ...(usage !== null ? { usage } : {}) });
      return { records, state: { ...state, turnOpen: false, saidLast: false } };
    }
  }
}
