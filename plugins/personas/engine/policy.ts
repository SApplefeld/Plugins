// policy.ts: the engine stand-in's policy table, one row for each engine call
// the persona hooks module makes or reads and one for each event it registers.
//
// The stand-in answers a call only where a row here says how. engine/handle.ts
// builds the handle from these rows: a call with no row is absent from the
// handle, and a row answered `refused` is a function that rejects with
// `not served on this engine: <name>`. The plugin wraps many engine calls in
// catches that carry on, so an empty answer to an unknown call would hide a
// missing capability; the table and the handle's log keep each gap visible
// instead.
//
// A row's `kind` tells a call from an event, since `tool.call` and
// `prompt.submit` name both. Its `answer` is one of four:
//   node      answered from node, such as a file read
//   adapter   answered through the engine's adapter
//   stand-in  answered from the stand-in's own state, such as the turn queue
//   refused   rejected, for a call; never fired, for an event
// A `refused` row, and a row answered with a fixed empty value, carries
// `loses`: what a persona on the stand-in loses by it. docs/engine-contract.md
// lists each of those under What a Persona Loses.
//
// An event is answered `stand-in` where the stand-in's host fires it. Five
// classic events have rows. Four of them, SessionStart, UserPromptSubmit,
// PostToolUse and Stop, are registered by the module only with the relay
// adapter live or the checkpoint restart on, both off on the stand-in, and
// each has a row all the same. The fifth, PostModelSwitch, is registered
// under any arming tier but off.
//
// The calls are the ones the hooks module reaches, by a search of
// plugins/personas/hooks for every member of the engine interface in
// .claude/types/claude-code.d.ts; the events are the module's `on(` lines.
//
// This module imports nothing, so any program may read the table.

export type PolicyAnswer = "node" | "adapter" | "stand-in" | "refused";

export interface PolicyRow {
  readonly kind: "call" | "event";
  // `<noun>.<verb>` for a call, the event's name for an event.
  readonly name: string;
  readonly answer: PolicyAnswer;
  readonly loses?: string;
}

const ROWS: PolicyRow[] = [
  // Calls.
  { kind: "call", name: "agent.list", answer: "stand-in", loses: "The list of the session's agents is always empty, so the plugin sees no subagent running." },
  { kind: "call", name: "audio.speak", answer: "refused", loses: "The goal-complete sound does not play when a root goal completes." },
  { kind: "call", name: "clock.every", answer: "node" },
  { kind: "call", name: "clock.sleep", answer: "node" },
  { kind: "call", name: "command.run", answer: "refused", loses: "The plugin cannot run a slash command inside the session, such as the compaction pass's compact, which is off on this engine." },
  { kind: "call", name: "env.get", answer: "node" },
  { kind: "call", name: "fs.exists", answer: "node" },
  { kind: "call", name: "fs.list", answer: "node" },
  { kind: "call", name: "fs.read", answer: "node" },
  { kind: "call", name: "fs.stat", answer: "node" },
  { kind: "call", name: "fs.write", answer: "node" },
  { kind: "call", name: "http.fetch", answer: "node" },
  { kind: "call", name: "model.classify", answer: "adapter" },
  { kind: "call", name: "model.complete", answer: "adapter" },
  { kind: "call", name: "model.fork", answer: "stand-in", loses: "A fork resolves not answered, reason nothing-to-fork, so no caller gets the fork's reading of the whole conversation: the memory writer distills from the turn's opening and answer text alone, and only where the adapter answers model.complete, so with none nothing is distilled, an open ask gets no brief, the memory decay scan's pairs of like records get no drafted disposition, and the stretch distillation, which runs only at a compaction this engine never reports, does not run." },
  { kind: "call", name: "plugin.name", answer: "node" },
  { kind: "call", name: "plugin.root", answer: "node" },
  { kind: "call", name: "process.run", answer: "node" },
  { kind: "call", name: "prompt.submit", answer: "stand-in" },
  { kind: "call", name: "session.cwd", answer: "node" },
  { kind: "call", name: "session.id", answer: "node" },
  { kind: "call", name: "session.messages", answer: "refused", loses: "The plugin cannot read the conversation, so the compaction pass and the checkpoint restart, which read it or its size, are off." },
  { kind: "call", name: "session.usage", answer: "adapter" },
  { kind: "call", name: "settings.read", answer: "refused", loses: "The relay adapter's settings guard cannot read the user settings file; it is the call's only caller and runs only with the relay adapter live, which is off on this engine." },
  { kind: "call", name: "state.get", answer: "stand-in" },
  { kind: "call", name: "state.set", answer: "stand-in" },
  { kind: "call", name: "store.delete", answer: "node" },
  { kind: "call", name: "store.get", answer: "node" },
  { kind: "call", name: "store.keys", answer: "node" },
  { kind: "call", name: "store.set", answer: "node" },
  { kind: "call", name: "tool.call", answer: "refused", loses: "The run lines at a plan's open, Chapter and close, the hour line, the stall line and the reply backstop cannot post to the operator's thread: each owed line is counted unsent in the persona's decision journal, and the reply backstop falls back to one re-prompt." },
  { kind: "call", name: "tool.register", answer: "stand-in" },
  { kind: "call", name: "ui.log", answer: "stand-in" },
  { kind: "call", name: "ui.notice", answer: "stand-in" },
  { kind: "call", name: "ui.status", answer: "stand-in" },
  { kind: "call", name: "ui.toast", answer: "stand-in" },

  // Events.
  { kind: "event", name: "session.start", answer: "stand-in" },
  { kind: "event", name: "session.compact", answer: "refused", loses: "The stand-in sees no compaction, so nothing puts the launch priming back after an engine compacts on its own." },
  { kind: "event", name: "turn.start", answer: "stand-in" },
  { kind: "event", name: "turn.step", answer: "stand-in" },
  { kind: "event", name: "turn.complete", answer: "stand-in" },
  { kind: "event", name: "tool.check", answer: "stand-in" },
  { kind: "event", name: "tool.call", answer: "stand-in" },
  { kind: "event", name: "prompt.submit", answer: "stand-in" },
  { kind: "event", name: "prompt.context", answer: "stand-in" },
  { kind: "event", name: "prompt.attachment", answer: "stand-in" },
  { kind: "event", name: "agent.spawn", answer: "refused", loses: "No subagent start is reported, so a starting subagent gets no memory-recognition pointer and its type is not recorded." },
  { kind: "event", name: "classic.SessionStart", answer: "stand-in" },
  { kind: "event", name: "classic.UserPromptSubmit", answer: "refused", loses: "The relay adapter's post of a typed prompt to the operator's thread is not made, since the relay is off on this engine." },
  { kind: "event", name: "classic.PostToolUse", answer: "refused", loses: "The relay adapter's post after a tool call to the operator's thread is not made, since the relay is off on this engine." },
  { kind: "event", name: "classic.Stop", answer: "stand-in" },
  { kind: "event", name: "classic.PostModelSwitch", answer: "refused", loses: "No model switch is reported, so a switch that forfeits the prompt cache is not marked cold." },
];

export const POLICY: readonly PolicyRow[] = Object.freeze(ROWS.map((row) => Object.freeze(row)));
