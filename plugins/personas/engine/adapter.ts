// adapter.ts: the adapter's shape, as docs/engine-contract.md states it, and
// the registry the host finds an engine's adapter in.
//
// An adapter gives the host five verbs, start, turn, interrupt, stop and an
// optional complete, and reports what the engine does as events. Its factory
// is handed the context below and nothing of the plugin's: no handle, no
// store and no state, so no rule about a goal, a record, a turn's standing or
// a tool can live in an adapter. The host holds every timing rule, so no
// adapter repeats one.
//
// The registry is this module's own map, so whoever registers and the host
// that reads must load this file by one URL. It imports nothing at run time,
// only types, so it loads the same before or after the resolve hook run.mjs
// registers.

import type { ModelCompleteRequest, ModelCompleteResult } from "claude-code";
import type { StepReport, TurnReason } from "./turns.ts";

// What an adapter reports, as docs/engine-contract.md names the events.
export type AdapterEvent =
  | { kind: "ready" }
  | ({ kind: "step" } & StepReport)
  | { kind: "turnEnded"; answer: string; reason: TurnReason; usage?: unknown; contextShare?: number }
  | { kind: "restarted" }
  | { kind: "exited"; code: number };

export interface AdapterContext {
  workdir: string;
  rundir: string;
  childDir: string;
  model: string;
  // The --script file the host was started with, where it was given one.
  script?: string;
  // The persona tools pipe. The pipe lasts the host's life; the token lasts
  // until the adapter's next closePipeConnection call, and `token` always
  // reads the current one. The adapter hands the token to mcp/run.mjs in its
  // environment as PERSONAS_PIPE_TOKEN, never as an argument or in a file
  // under workdir.
  pipe: { readonly name: string; readonly token: string };
  // Closes the connection holding the pipe's place, where one does, and
  // discards what the host has not read from it: bytes held without a line
  // end, and any that arrive later, are never served. It also replaces the
  // pipe token with a new one of 32 random bytes and returns the new token.
  // From then on a connection whose first line is any earlier token is
  // closed and served nothing, whether it opened before the call or after
  // it. Calls already counted still run, under no turn, behind the wait
  // before the next turn.start. The duty is the adapter's: before the
  // adapter ends an engine it will start again, it calls this function, so
  // no line the ended engine wrote is served afterwards. It starts the next
  // engine with the token the call returned. The host never calls it itself.
  closePipeConnection: () => string;
  emit: (event: AdapterEvent) => void;
}

// An adapter keeps its engine's stdout off the host's stdout, which carries
// only the records the launcher reads. An engine child the adapter starts has
// its stdout piped to the adapter or discarded, never inherited.
export interface Adapter {
  // Who runs the tools. The host builds only the `engine` mode and refuses
  // to start an adapter that declares `stand-in`.
  toolRunner: "engine" | "stand-in";
  // Resolves once the engine can take a turn; a rejection says why the
  // engine was refused.
  start(): Promise<void>;
  // Hands the engine one turn's text; the turn's progress arrives as events.
  turn(text: string): Promise<void>;
  // Stops the running turn: a turnEnded event follows, or the adapter ends
  // the engine, starts it again and emits restarted.
  interrupt(): Promise<void>;
  // Ends the engine.
  stop(): Promise<void>;
  // Answers one question outside the conversation, for the plugin's own
  // model calls, in the shape the engine's model.complete resolves. The
  // request's timeoutMs is the host's deadline for it, and the adapter ends
  // its work for that request when `signal` aborts.
  complete?(request: ModelCompleteRequest, signal?: AbortSignal): Promise<ModelCompleteResult>;
}

export type AdapterFactory = (ctx: AdapterContext) => Adapter;

const registry = new Map<string, AdapterFactory>();

// Registers `factory` as the adapter of the engine called `name`. A name
// registered once is never replaced, so a second registration throws.
export function registerAdapter(name: string, factory: AdapterFactory): void {
  if (typeof name !== "string" || name === "") throw new Error("an adapter is registered under a name that is not empty");
  if (typeof factory !== "function") throw new Error(`the adapter ${JSON.stringify(name)} is registered with no factory`);
  if (registry.has(name)) throw new Error(`an adapter is already registered for the engine ${JSON.stringify(name)}`);
  registry.set(name, factory);
}

// The factory registered for `name`, or undefined where none is.
export function adapterFactoryFor(name: string): AdapterFactory | undefined {
  return registry.get(name);
}
