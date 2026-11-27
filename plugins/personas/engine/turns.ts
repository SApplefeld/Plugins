// turns.ts: the stand-in's one turn queue and the life of each turn.
//
// A turn has a text, an origin and, once it starts, an id this file makes.
// Three paths write the queue, and no other does:
//   fromLauncher  a line on the stand-in's stdin, origin `sdk`
//   fromPlugin    the hooks module's own prompt.submit, origin `plugin` under
//                 the plugin's name
//   fromExternal  a host caller's body and sender class, origin `channel`,
//                 with the envelope written here
// The replay after an engine restart is the launcher's own first line put
// back at the head of the queue with the origin it had, and no fourth path.
//
// One turn is in flight at a time, held in one slot with its phase:
//   preparing  taken from the queue; prompt.submit, prompt.context and
//              prompt.attachment fire, unless they fired before a restart
//   starting   turn.start fires
//   handed     the text is with the adapter
//   closing    the turn ends; turn.complete's chain runs
// The next turn is taken when the slot is empty and the adapter is ready.
// A turn's life, in the engine's order:
//   1. Once no persona tools call is in flight, prompt.submit with the
//      origin; a drop ends the turn here.
//   2. prompt.context, and prompt.attachment for each context entry the
//      submit's handlers added, origin `plugin` from `prompt.submit`.
//   3. Once again no persona tools call is in flight, turn.start, then the
//      text handed to the adapter with the added context in front, and
//      step 0 opened at that moment.
//   4. Steps as the adapter reports them (below).
//   5. On the adapter's turn end, classic.Stop, then turn.complete with the
//      answer, durationMs, isAborted, turnId, the reason and the usage where
//      reported, and on a refusal the declaration's `refusal` with a null
//      category and explanation, since the adapter reports neither. An
//      engine that restarts or exits during the turn ends it with
//      turn.complete alone, reason `aborted`.
// A turn closes only once its turn.start chain has returned: an end that
// arrives while turn.start runs waits for it, and the text is then never
// handed. A turn.start that throws ends the turn with reason `error`. The
// adapter's step and turn end act on a handed turn only. The slot empties
// once every turn.complete handler has returned, so a submit awaited inside
// one is queued behind it and resolves at once, and its turn.start fires
// after the chain returns.
//
// An engine restart never discards a turn. A turn past turn.start ends as
// aborted. A plugin's turn still preparing reads, after each event it
// awaits, whether a replay sits at the head of the queue; where one does it
// goes back behind the replay, and its pre-open events fire again when it is
// taken again, which the module's prompt.submit passes through untouched for
// the plugin's own prompt. Any other turn still preparing fires each of its
// pre-open events once, since for such a prompt the module's prompt.submit
// writes (a turn record decision, an operator's [PAUSE] or [RESUME] line, an
// origin reading) and a second run would write again. Where a replay sits at
// the head once they have fired, the turn waits behind the replay with what
// they returned, and goes straight to turn.start when it is taken again. A
// queued turn stays queued behind the replay. No replay is queued while the
// launcher's first line, or a replay, is queued or preparing, since that
// line reaches the restarted engine anyway.
//
// A plugin's submit settles on one fact, whether turn.start fired for it.
// Where it fired, the submit settles with the result the prompt.submit
// chain returned, once that turn.start chain has returned or thrown. Where
// it never fires, the submit settles with a drop, which the module reads as
// a failed submit: its own prompt.submit chain dropped it, an event before
// turn.start threw, or the host began to end first. One submit settles at
// the queue, with the prompt as queued: one made in a turn.complete
// handler's scope while that turn's chain has not returned, so a handler
// awaiting it never waits on itself. A submit from a turn.complete scope
// whose chain has returned, such as one a drain started there makes later,
// waits for its own turn like any other, and so does one made before the
// adapter's first ready.
//
// The host begins to end when its input closes, the engine exits or the
// adapter's start fails. From then on no turn is taken, and every submit
// whose turn.start has not fired settles at once with a drop, queued or
// preparing, as does every submit made later, and fromExternal opens
// nothing. A turn preparing is discarded after the event it awaits. A turn
// past turn.start runs on to its end.
//
// Steps. turn.step's handler is an async generator wrapping one model
// request. A step is opened by firing the event with a stream beneath that
// waits for the adapter, and pulling at once, since the module marks the
// turn as stepped in the generator's body before it delegates. When the
// adapter's step event arrives the stream yields the step's text as a text
// chunk and each tool call as a tool and an input chunk, then a stop chunk,
// and returns `{ turnId, index, answer, toolUses, stopReason, usage }`. The
// step is pulled until done. Step 0 opens at the handover; the first step
// event completes it, and each later step event opens the next step and
// completes it at once. A turn that ends with step 0 still open completes it
// with the turn's answer and no tool call. A turn that ends aborted, or whose
// engine restarts or exits, closes the open step with the generator's
// `return`: the stream beneath yields one engine chunk, the cue on which the
// pull stops and calls `return`, so no generator is left pending.
// `model` is the --model argument, `index` counts from 0 inside the turn and
// no step carries an agentId. `effort` is left out, the declaration's unset
// form; the one module site reading it, the live step-effort rewrite, then
// counts the step as unrewritable. `messageCount` is 0, since no module site
// reads it and the stand-in does not hold the engine's conversation.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { channelSenderOf } from "../hooks/channel-text.ts";
import { fire, fireStream } from "./events.ts";

export type PromptOrigin =
  | { kind: "sdk" }
  | { kind: "plugin"; name: string; asUser?: true }
  | { kind: "channel"; server: string };

export type SenderClass = "operator" | "participant";

// A step the adapter reports: its text and the tool calls it made.
export type StepReport = { text?: string; toolCalls?: readonly { name: string; input: unknown }[] };

export type TurnReason = "answer" | "aborted" | "refusal" | "error";

// The adapter's turn end.
export type TurnEnd = { answer: string; reason: TurnReason; usage?: unknown };

// What the module's prompt.submit resolves to.
export type SubmitResult = { text: string; context?: readonly string[]; origin?: PromptOrigin } | { drop: string };

export interface TurnsDeps {
  model: string;
  sessionId: string;
  cwd: string;
  // Hands a turn's text to the adapter.
  handTurn: (text: string) => Promise<void>;
  // Null where no persona tools call is in flight; otherwise settles once
  // none is.
  callsSettled: () => Promise<void> | null;
  // The persona tools calls in flight now, and every call whose line has
  // arrived since the host started.
  callCounts: () => { inFlight: number; arrived: number };
  // One line to the stand-in's log.
  log: (verb: string, text: string) => void;
}

export interface Turns {
  setReady(ready: boolean): void;
  fromLauncher(text: string): void;
  fromPlugin(text: string, origin: PromptOrigin, attachments?: readonly unknown[]): Promise<SubmitResult>;
  fromExternal(body: string, senderClass: unknown): boolean;
  step(report: StepReport): void;
  ended(end: TurnEnd): Promise<void>;
  restarted(): Promise<void>;
  beginEnd(): void;
  abortOpen(): Promise<void>;
  stepCounts(): { opened: number; done: number };
}

// The server a turn from a host caller names in its origin and envelope.
export const EXTERNAL_TURN_SERVER = "engine-host";

// The type a context entry's prompt.attachment carries. The engine raises a
// plugin's added context as an attachment of origin `plugin`, and the
// declaration does not name that attachment's type, so this name is the
// stand-in's own, chosen to differ from `queued_command`, the one type the
// module reads as a prompt delivered into a running turn.
const PLUGIN_CONTEXT_ATTACHMENT = "plugin_context";

// The stream chunk on which a step's pull stops and closes the generator.
const CLOSE_CHUNK = Object.freeze({ kind: "engine", ref: 0 });
const CLOSE = Symbol("close");

// What a turn's pre-open events returned: the text as entered and the
// context added in front of it.
type Prepared = { entered: Exclude<SubmitResult, { drop: string }>; added: readonly string[] };

type Queued = {
  text: string;
  origin: PromptOrigin;
  attachments?: readonly unknown[];
  // Settles a plugin submit; unset once settled, and for every other item.
  entered?: (result: SubmitResult) => void;
  // Marks the launcher's first line, as it first entered the queue.
  priming?: true;
  // Marks the launcher's first line put back after a restart.
  replay?: true;
  // Set on a turn that waits behind a replay after its pre-open events fired.
  prepared?: Prepared;
};

// The drop a plugin submit whose turn.start never fires settles with once
// the host has begun to end.
const DROPPED_BY_END = "The host ended before this prompt's turn opened, so the turn was not run.";

type OpenStep = { complete: (report: StepReport | typeof CLOSE) => void; pulled: Promise<void> };

// `steps` settles once every step event so far has been pulled to done, so
// one step is open at a time and the turn's end waits for the last.
type OpenTurn = { id: string; startedAt: number; index: number; step: OpenStep | null; steps: Promise<void> };

type Phase = "preparing" | "starting" | "handed" | "closing";

// The turn in flight. `turn` and `started` are set as the phase leaves
// preparing; `started` settles once the turn.start chain has returned or
// thrown, to the error it threw or null, and never rejects.
type Slot = { item: Queued; phase: Phase; turn: OpenTurn | null; started: Promise<unknown> | null };

// The envelope a host caller's turn carries: one class, written here.
export function envelopeOf(body: string, senderClass: SenderClass): string {
  return `<channel source="${EXTERNAL_TURN_SERVER}" sender_class="${senderClass}">\n${body}\n</channel>`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The scope of one turn.complete chain, read by a submit made inside it.
// `returned` is set once the chain has returned, and a scope a handler left
// running past that is then read as no scope.
const completeScope = new AsyncLocalStorage<{ returned: boolean }>();

// Settles a waiting plugin submit, once.
function settle(item: Queued, result: SubmitResult): void {
  const entered = item.entered;
  item.entered = undefined;
  entered?.(result);
}

export function createTurns(deps: TurnsDeps): Turns {
  const queue: Queued[] = [];
  let ready = false;
  let current: Slot | null = null;
  let firstLauncherLine: { text: string; origin: PromptOrigin } | null = null;
  // Set once the host begins to end; no turn is taken after that.
  let ending = false;
  let stepsOpened = 0;
  let stepsDone = 0;

  const take = (): void => {
    if (current !== null || !ready || ending) return;
    const next = queue.shift();
    if (next === undefined) return;
    const slot: Slot = { item: next, phase: "preparing", turn: null, started: null };
    current = slot;
    // Only an event before turn.start can throw out of runTurn: turn.start's
    // own throw is held in `started`, and finish and the handover catch theirs.
    void runTurn(slot).catch((err: unknown) => {
      deps.log("turn", `a turn failed before it started: ${messageOf(err)}`);
      settle(slot.item, { drop: `The prompt's turn failed before it opened: ${messageOf(err)}` });
      release(slot);
    });
  };

  // Empties the slot where `slot` holds it, and takes the next turn.
  const release = (slot: Slot): void => {
    if (current === slot) current = null;
    take();
  };

  const enqueue = (item: Queued): void => {
    queue.push(item);
    take();
  };

  const openStep = (turn: OpenTurn, index: number): OpenStep => {
    let complete!: (report: StepReport | typeof CLOSE) => void;
    const arrived = new Promise<StepReport | typeof CLOSE>((done) => { complete = done; });
    const beneath = (down: { turnId: string; index: number }) => (async function* () {
      const report = await arrived;
      if (report === CLOSE) {
        yield CLOSE_CHUNK;
        return { turnId: down.turnId, index: down.index, answer: "", toolUses: [], stopReason: null, usage: null };
      }
      const text = report.text ?? "";
      const calls = report.toolCalls ?? [];
      let block = 0;
      if (text !== "") yield { kind: "text", index: block++, text };
      for (const call of calls) {
        yield { kind: "tool", index: block, id: `toolu_${randomUUID().replace(/-/g, "")}`, name: call.name };
        yield { kind: "input", index: block, json: JSON.stringify(call.input ?? {}) };
        block++;
      }
      const stopReason = calls.length > 0 ? "tool_use" : "end_turn";
      yield { kind: "stop", stopReason, usage: null };
      return { turnId: down.turnId, index: down.index, answer: text, toolUses: calls.map((call) => ({ name: call.name, input: call.input })), stopReason, usage: null };
    })();
    const stream = fireStream("turn.step", { turnId: turn.id, index, model: deps.model, messageCount: 0 }, beneath);
    stepsOpened++;
    // A step counts as done once its generator reports done, from a pull or
    // from `return`, or throws, which also leaves it finished.
    const pulled = (async () => {
      let item: IteratorResult<unknown, unknown> | null = null;
      let threw = false;
      try {
        item = await stream.next();
        while (!item.done) {
          item = item.value === CLOSE_CHUNK ? await stream.return(undefined) : await stream.next();
        }
      } catch (err) {
        threw = true;
        deps.log("step", `turn ${turn.id} step ${index}: ${messageOf(err)}`);
      } finally {
        if (threw || item?.done === true) stepsDone++;
      }
    })();
    return { complete, pulled };
  };

  // Ends the open step: with the report given, or closed with `return`.
  const endStep = async (turn: OpenTurn, report: StepReport | typeof CLOSE): Promise<void> => {
    const step = turn.step;
    if (step === null) return;
    turn.step = null;
    step.complete(report);
    await step.pulled;
  };

  // Read after each event a preparing turn awaits: whether it goes on. Where
  // the host is ending it is discarded and its submit dropped; where a
  // restart queued a replay, a plugin's turn goes back behind the replay,
  // its submit still waiting.
  const goesOn = (slot: Slot): boolean => {
    if (ending) {
      deps.log("turn", "a turn was discarded before it started, by the host's end");
      settle(slot.item, { drop: DROPPED_BY_END });
      release(slot);
      return false;
    }
    if (slot.item.origin.kind === "plugin" && queue[0]?.replay === true) {
      deps.log("turn", "a turn was put back behind the launcher's first line, by an engine restart");
      queue.splice(1, 0, slot.item);
      release(slot);
      return false;
    }
    return true;
  };

  // Fires a turn's pre-open events and returns what they returned, or null
  // where the turn does not go on.
  const prepare = async (slot: Slot): Promise<Prepared | null> => {
    const item = slot.item;
    const submitted = await fire("prompt.submit", { text: item.text, wait: false, origin: item.origin, ...(item.attachments ? { attachments: item.attachments } : {}) },
      (down: { text: string; context?: readonly string[]; origin?: PromptOrigin }) => ({ text: down.text, context: down.context, origin: down.origin })) as SubmitResult;
    if ("drop" in submitted && submitted.drop !== undefined) {
      deps.log("turn", `a prompt was dropped before its turn: ${submitted.drop}`);
      settle(item, submitted);
      release(slot);
      return null;
    }
    if (!goesOn(slot)) return null;
    const entered = submitted as Exclude<SubmitResult, { drop: string }>;
    const added: string[] = [];
    const context = await fire("prompt.context", { blocks: [], instructionFiles: [] },
      (down: { blocks: readonly { name: string; text: string }[] }) => ({ blocks: down.blocks })) as { blocks?: readonly { text?: unknown }[] };
    if (!goesOn(slot)) return null;
    for (const block of context?.blocks ?? []) {
      if (typeof block.text === "string" && block.text !== "") added.push(block.text);
    }
    for (const entry of entered.context ?? []) {
      const attached = await fire("prompt.attachment", { type: PLUGIN_CONTEXT_ATTACHMENT, text: entry, origin: { kind: "plugin", event: "prompt.submit" } },
        (down: { text: string }) => ({ text: down.text })) as { text?: unknown };
      if (!goesOn(slot)) return null;
      if (typeof attached?.text === "string" && attached.text !== "") added.push(attached.text);
    }
    return { entered, added };
  };

  // Waits until no persona tools call is in flight, a call arriving during
  // the wait included, with one log line as a wait with calls in flight
  // begins and one as it ends, each naming `stage`, the point in the turn
  // where the wait runs. The wait has no bound.
  const callsServed = async (stage: string): Promise<void> => {
    let settling = deps.callsSettled();
    if (settling === null) return;
    const since = Date.now();
    const begun = deps.callCounts();
    deps.log("turn", `waiting for ${begun.inFlight} persona tools call(s) in flight ${stage}`);
    while (settling !== null) {
      await settling;
      settling = deps.callsSettled();
    }
    const served = begun.inFlight + deps.callCounts().arrived - begun.arrived;
    deps.log("turn", `the wait for persona tools calls ${stage} ended: ${served} call(s) served in ${Date.now() - since} ms`);
  };

  // A call is served before the turn that comes after its line's arrival: a
  // call whose line arrived in the turn before, or between turns, runs with
  // no turn open and never under this one. The wait runs before the turn's
  // pre-open events, so a leftover call does not see what this prompt's
  // prompt.submit writes, and again before turn.start. A line that arrives
  // after turn.start's handler began is served under this turn, and so is a
  // call an engine kept through an interrupt makes for the interrupted turn
  // once this turn's last wait has ended.
  const runTurn = async (slot: Slot): Promise<void> => {
    const item = slot.item;
    if (item.prepared === undefined) {
      await callsServed("before its pre-open events");
      if (!goesOn(slot)) return;
    }
    const prepared = item.prepared ?? await prepare(slot);
    if (prepared === null) return;
    await callsServed("before turn.start");
    if (ending) {
      deps.log("turn", "a turn was discarded before it started, by the host's end");
      settle(item, { drop: DROPPED_BY_END });
      release(slot);
      return;
    }
    // A turn whose pre-open events fired while a restart queued a replay
    // waits behind the replay, and fires none of them again.
    if (queue[0]?.replay === true) {
      deps.log("turn", "a turn whose pre-open events fired waits behind the launcher's first line, by an engine restart");
      item.prepared = prepared;
      queue.splice(1, 0, item);
      release(slot);
      return;
    }
    const { entered, added } = prepared;
    const turn: OpenTurn = { id: randomUUID(), startedAt: Date.now(), index: 0, step: null, steps: Promise.resolve() };
    slot.turn = turn;
    slot.phase = "starting";
    // The one site a plugin submit settles as accepted: once turn.start fired
    // for it, as its chain returns or throws.
    slot.started = (async (): Promise<unknown> => {
      try {
        await fire("turn.start", { text: entered.text, turnId: turn.id }, (down: { turnId: string }) => ({ turnId: down.turnId }));
        return null;
      } catch (err) {
        return err;
      } finally {
        settle(item, entered);
      }
    })();
    const failed = await slot.started;
    // An end that arrived while turn.start ran has the turn closing.
    if (slot.phase !== "starting") return;
    if (failed !== null) {
      deps.log("turn", `turn.start failed for turn ${turn.id}: ${messageOf(failed)}`);
      await finish(slot, { answer: "", reason: "error" }, false);
      return;
    }
    slot.phase = "handed";
    turn.step = openStep(turn, 0);
    try {
      await deps.handTurn([...added, entered.text].join("\n\n"));
    } catch (err) {
      deps.log("turn", `the adapter refused turn ${turn.id}: ${messageOf(err)}`);
      await finish(slot, { answer: "", reason: "error" }, false);
    }
  };

  // Ends the turn in `slot` once its turn.start chain has returned: its step,
  // classic.Stop where the adapter ended the turn, then turn.complete, whose
  // whole chain returns before the slot empties. A turn still preparing, or
  // already closing, is left as it is. It never rejects; whatever fails is
  // logged and the slot empties all the same.
  const finish = async (slot: Slot, end: TurnEnd, fromAdapter: boolean): Promise<void> => {
    const turn = slot.turn;
    const started = slot.started;
    if (slot.phase === "closing" || turn === null || started === null) return;
    slot.phase = "closing";
    try {
      await started;
      const aborted = end.reason === "aborted";
      await turn.steps;
      await endStep(turn, aborted ? CLOSE : { text: end.answer });
      if (fromAdapter) {
        await fire("classic.Stop", { hook_event_name: "Stop", session_id: deps.sessionId, cwd: deps.cwd, stop_hook_active: false, last_assistant_message: end.answer }, () => ({}));
      }
      const chain = { returned: false };
      try {
        await completeScope.run(chain, () => fire("turn.complete", {
          answer: end.answer,
          durationMs: Date.now() - turn.startedAt,
          isAborted: aborted,
          turnId: turn.id,
          reason: end.reason,
          ...(end.reason === "refusal" ? { refusal: { category: null, explanation: null } } : {}),
          ...(end.usage !== undefined ? { usage: end.usage } : {}),
        }, (down: { answer: string; usage?: unknown }) => ({ text: down.answer, ...(down.usage !== undefined ? { usage: down.usage } : {}) })));
      } finally {
        chain.returned = true;
      }
    } catch (err) {
      deps.log("turn", `turn ${turn.id} did not close cleanly: ${messageOf(err)}`);
    } finally {
      release(slot);
    }
  };

  // The host is ending: no turn is taken from here, as a later ready does not
  // undo it, and every submit whose turn.start has not fired, queued or
  // preparing, settles at once with a drop, as does every submit made from
  // here. A turn past turn.start runs on to its own end.
  const beginEnd = (): void => {
    if (ending) return;
    ending = true;
    ready = false;
    for (const item of queue) settle(item, { drop: DROPPED_BY_END });
    if (current !== null && current.phase === "preparing") settle(current.item, { drop: DROPPED_BY_END });
  };

  // Whether the launcher's first line is on its way to the adapter already:
  // queued or preparing, as it first came or as a replay.
  const firstLineAhead = (): boolean => {
    const isFirst = (item: Queued) => item.priming === true || item.replay === true;
    return queue.some(isFirst) || (current !== null && current.phase === "preparing" && isFirst(current.item));
  };

  return {
    setReady(value) {
      if (ending) return;
      ready = value;
      take();
    },

    fromLauncher(text) {
      const item: Queued = { text, origin: { kind: "sdk" } };
      if (firstLauncherLine === null) {
        firstLauncherLine = { text, origin: item.origin };
        item.priming = true;
      }
      enqueue(item);
    },

    fromPlugin(text, origin, attachments) {
      return new Promise<SubmitResult>((resolve) => {
        if (ending) {
          resolve({ drop: DROPPED_BY_END });
          return;
        }
        const item: Queued = { text, origin, ...(attachments ? { attachments } : {}) };
        const scope = completeScope.getStore();
        if (scope !== undefined && !scope.returned) {
          queue.push(item);
          resolve({ text, origin });
          return;
        }
        item.entered = resolve;
        enqueue(item);
      });
    },

    fromExternal(body, senderClass) {
      if (ending) {
        deps.log("turn", "an external turn was not opened: the host is ending");
        return false;
      }
      const cls: SenderClass = senderClass === "operator" ? "operator" : "participant";
      const text = envelopeOf(String(body), cls);
      const readBack = channelSenderOf(text).senderClass;
      if (readBack !== cls) {
        deps.log("turn", `an external turn was not opened: its envelope was written as ${cls} and reads back as ${readBack}`);
        return false;
      }
      enqueue({ text, origin: { kind: "channel", server: EXTERNAL_TURN_SERVER } });
      return true;
    },

    step(report) {
      const slot = current;
      const turn = slot?.turn ?? null;
      if (slot === null || slot.phase !== "handed" || turn === null) {
        deps.log("step", "a step arrived with no turn handed to the adapter");
        return;
      }
      turn.steps = turn.steps.then(async () => {
        if (turn.step !== null) {
          await endStep(turn, report);
          return;
        }
        turn.index += 1;
        const step = openStep(turn, turn.index);
        step.complete(report);
        await step.pulled;
      });
    },

    async ended(end) {
      const slot = current;
      if (slot === null || slot.phase !== "handed") {
        deps.log("turn", "a turn end arrived with no turn handed to the adapter");
        return;
      }
      await finish(slot, end, true);
    },

    // Puts the launcher's first line at the head of the queue, unless it is
    // already on its way, and ends a turn past turn.start as aborted. A
    // plugin's turn preparing goes back behind the replay at its next read of
    // the queue, and any other once its pre-open events have fired.
    async restarted() {
      if (firstLauncherLine !== null && !firstLineAhead()) {
        queue.unshift({ text: firstLauncherLine.text, origin: firstLauncherLine.origin, replay: true });
      }
      const slot = current;
      if (slot === null) take();
      else await finish(slot, { answer: "", reason: "aborted" }, false);
    },

    beginEnd,

    // The end begun as beginEnd begins it, where it has not been, and the
    // turn past turn.start ended as aborted.
    async abortOpen() {
      beginEnd();
      const slot = current;
      if (slot !== null) await finish(slot, { answer: "", reason: "aborted" }, false);
    },

    stepCounts() {
      return { opened: stepsOpened, done: stepsDone };
    },
  };
}
