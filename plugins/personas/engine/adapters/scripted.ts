// scripted.ts: the adapter `scripted`, an engine that costs nothing to run.
// It plays a script file instead of a model, for suites and for a person
// checking a new machine.
//
//   run.mjs --engine scripted --script <file> ...
//
// The script is a JSON list with one entry per turn the adapter is handed,
// in order. An entry is a list of acts, each an object with one key that
// names it:
//   { "say": text }                     a step with that text
//   { "tool": name, "input": object }   a step reporting the tool call, then
//                                       the call to the persona tool `name`
//                                       through the pipe; the reply is kept
//   { "end": answer, "reason": r,       the turn's end; `reason` is answer,
//     "usage": object,                  aborted, refusal or error (answer
//     "contextShare": n }               where left out), `usage` this turn's
//                                       own, `contextShare` from 0 to 1
//   { "silent": true }                  nothing more, and an interrupt is
//                                       left unanswered
//   { "restart": true }                 the engine ends and starts again
//   { "exit": code }                    the engine exits with that code
//   { "complete": text }                the answer to `complete` while this
//                                       entry is the script's place
//   { "completeHangs": true }           `complete` never answers while this
//                                       entry is the script's place
//   { "start": "hang" }                 in the first entry only: `start`
//   { "start": "reject",                never resolves, or rejects with the
//     "sentence": text }                sentence
// A turn's acts run in order until one of end, silent, restart or exit. A
// turn whose entry runs out with none of those, that has no entry, or that
// is handed after an exit act or the adapter's stop, ends with reason error.
// The script's place for `complete` is the open turn's entry, or with no
// turn open the entry of the next turn to be handed; an entry with no
// complete or completeHangs act answers nothing, and `complete` rejects. An
// entry holds at most one of those two acts.
//
// The script is read once, with one JSON.parse, and checked whole before any
// act runs: a file that cannot be read, is not JSON or holds an act of the
// wrong shape rejects `start` with a sentence saying where.
//
// What each act did is appended, one JSON line each, to scripted-record.jsonl
// in the child's own folder, the tool's reply included: SCRIPT_RECORD_FILE.
// So are the start, each turn's text as handed, each complete call and
// whether the script answered it or left it hanging, the abort of a hanging
// complete's signal, each interrupt, the stop, and the process id of each
// connect child started.
//
// The adapter starts one process, mcp/run.mjs --connect on the host's pipe,
// with node's own path and no shell. Its environment holds PATH, SystemRoot
// where set, and the pipe token as PERSONAS_PIPE_TOKEN, nothing else; the
// token is never an argument and never written. A restart calls
// closePipeConnection, stops reading that child, ends it, starts the next
// child with the token the call returned and emits restarted. An interrupt
// that keeps the engine keeps the child and its token.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelCompleteRequest, ModelCompleteResult } from "claude-code";
import { registerAdapter, type Adapter, type AdapterContext } from "../adapter.ts";

export const SCRIPTED_ENGINE = "scripted";
export const SCRIPT_RECORD_FILE = "scripted-record.jsonl";

const CONNECT_PROGRAM = fileURLToPath(new URL("../../mcp/run.mjs", import.meta.url).href);
const REASONS = ["answer", "aborted", "refusal", "error"] as const;
type Reason = (typeof REASONS)[number];

type Act =
  | { say: string }
  | { tool: string; input: Record<string, unknown> }
  | { end: string; reason: Reason; usage?: Record<string, unknown>; contextShare?: number }
  | { silent: true }
  | { restart: true }
  | { exit: number }
  | { complete: string }
  | { completeHangs: true }
  | { start: "hang" }
  | { start: "reject"; sentence: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The keys each act may carry, by the key that names it.
const ACT_KEYS: Readonly<Record<string, readonly string[]>> = {
  say: ["say"],
  tool: ["tool", "input"],
  end: ["end", "reason", "usage", "contextShare"],
  silent: ["silent"],
  restart: ["restart"],
  exit: ["exit"],
  complete: ["complete"],
  completeHangs: ["completeHangs"],
  start: ["start", "sentence"],
};

function actOf(value: unknown, where: string, first: boolean): Act {
  if (!isRecord(value)) throw new Error(`${where} is not an object`);
  const name = Object.keys(ACT_KEYS).find((key) => Object.hasOwn(value, key));
  if (name === undefined) throw new Error(`${where} names no act`);
  const extra = Object.keys(value).filter((key) => !ACT_KEYS[name].includes(key));
  if (extra.length > 0) throw new Error(`${where} carries ${extra.join(", ")}, which the act ${name} does not take`);
  const text = (key: string) => {
    if (typeof value[key] !== "string") throw new Error(`${where}: ${key} is not a string`);
    return value[key] as string;
  };
  switch (name) {
    case "say":
      return { say: text("say") };
    case "tool": {
      const tool = text("tool");
      if (tool === "") throw new Error(`${where}: tool is empty`);
      if (value.input !== undefined && !isRecord(value.input)) throw new Error(`${where}: input is not an object`);
      return { tool, input: isRecord(value.input) ? value.input : {} };
    }
    case "end": {
      const reason = value.reason ?? "answer";
      if (!REASONS.includes(reason as Reason)) throw new Error(`${where}: reason is none of ${REASONS.join(", ")}`);
      if (value.usage !== undefined && !isRecord(value.usage)) throw new Error(`${where}: usage is not an object`);
      const share = value.contextShare;
      if (share !== undefined && (typeof share !== "number" || !Number.isFinite(share) || share < 0 || share > 1)) throw new Error(`${where}: contextShare is not a number from 0 to 1`);
      return {
        end: text("end"),
        reason: reason as Reason,
        ...(isRecord(value.usage) ? { usage: value.usage } : {}),
        ...(typeof share === "number" ? { contextShare: share } : {}),
      };
    }
    case "silent":
    case "restart":
    case "completeHangs":
      if (value[name] !== true) throw new Error(`${where}: ${name} is not true`);
      return name === "silent" ? { silent: true } : name === "restart" ? { restart: true } : { completeHangs: true };
    case "exit": {
      const code = value.exit;
      if (typeof code !== "number" || !Number.isInteger(code) || code < 0 || code > 255) throw new Error(`${where}: exit is not a whole number from 0 to 255`);
      return { exit: code };
    }
    case "complete":
      return { complete: text("complete") };
    default: {
      if (!first) throw new Error(`${where}: start is taken in the first entry only`);
      if (value.start === "hang") {
        if (value.sentence !== undefined) throw new Error(`${where}: a start that hangs takes no sentence`);
        return { start: "hang" };
      }
      if (value.start !== "reject") throw new Error(`${where}: start is neither hang nor reject`);
      const sentence = text("sentence");
      if (sentence.trim() === "") throw new Error(`${where}: sentence is empty`);
      return { start: "reject", sentence };
    }
  }
}

// The script at `file`, read and checked whole.
export function readScript(file: string): Act[][] {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  let parsed: unknown;
  // The parse's own message can quote the file, so the sentence leaves it out.
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`the script ${file} is not JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`the script ${file} is not a JSON list`);
  return parsed.map((entry, at) => {
    if (!Array.isArray(entry)) throw new Error(`the script ${file}: entry ${at} is not a list of acts`);
    const acts = entry.map((act, index) => actOf(act, `the script ${file}: entry ${at}, act ${index}`, at === 0));
    if (acts.filter((act) => "complete" in act || "completeHangs" in act).length > 1) throw new Error(`the script ${file}: entry ${at} holds more than one complete or completeHangs act`);
    if (acts.filter((act) => "start" in act).length > 1) throw new Error(`the script ${file}: entry ${at} holds more than one start act`);
    return acts;
  });
}

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

// One mcp/run.mjs --connect child and the calls waiting on its replies.
interface Connection {
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, (reply: Record<string, unknown>) => void>;
  exited: Promise<void>;
  reading: boolean;
}

export function createScriptedAdapter(ctx: AdapterContext): Adapter {
  const recordFile = join(ctx.childDir, SCRIPT_RECORD_FILE);
  const record = (line: Record<string, unknown>) => {
    try {
      appendFileSync(recordFile, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
    } catch {
      // A record line that cannot be written is lost; the script goes on.
    }
  };
  let entries: Act[][] = [];
  let connection: Connection | null = null;
  let nextId = 1;
  // How many turns have been handed, and the turn running now, which is null
  // once the turn ended, was interrupted or the engine restarted or stopped.
  let handed = 0;
  let running: { index: number; silent: boolean } | null = null;
  let stopped = false;

  // Every waiting call takes `reply` as its answer, and the connection's
  // later lines are not read.
  const settlePending = (conn: Connection, reply: Record<string, unknown>) => {
    const waiting = [...conn.pending.values()];
    conn.pending.clear();
    for (const answer of waiting) answer(reply);
  };

  const connect = (token: string): Connection => {
    const env: Record<string, string> = { PERSONAS_PIPE_TOKEN: token };
    if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
    if (process.env.SystemRoot !== undefined) env.SystemRoot = process.env.SystemRoot;
    const child = spawn(process.execPath, [CONNECT_PROGRAM, "--connect", ctx.pipe.name], { env, stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
    const conn: Connection = { child, pending: new Map(), exited: Promise.resolve(), reading: true };
    record({ act: "connect", pid: child.pid ?? null });
    conn.exited = new Promise<void>((done) => {
      child.once("close", (code) => {
        settlePending(conn, { error: `the connect program ended with code ${code ?? "none"}` });
        done();
      });
    });
    let buffered = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (!conn.reading) return;
      buffered += chunk;
      for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
        const line = buffered.slice(0, at);
        buffered = buffered.slice(at + 1);
        let reply: unknown;
        try {
          reply = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isRecord(reply) || typeof reply.id !== "number") continue;
        const answer = conn.pending.get(reply.id);
        conn.pending.delete(reply.id);
        answer?.(reply);
      }
    });
    child.stderr.on("data", () => {
      // The connect program's sentences are its own; its exit code is kept.
    });
    child.stdin.on("error", () => {
      // A write to a child that ended is lost; its close settles the calls.
    });
    child.on("error", () => {
      // A child that could not start closes, which settles its calls.
    });
    return conn;
  };

  // Stops reading `conn`, settles its waiting calls and ends the child,
  // resolving once it has closed.
  const stopReading = (conn: Connection) => {
    conn.reading = false;
    settlePending(conn, { error: "the connect program was stopped" });
  };
  const endChild = async (conn: Connection) => {
    if (conn.child.exitCode === null && conn.child.signalCode === null) conn.child.kill();
    await conn.exited;
  };

  const callTool = (name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const conn = connection;
    if (conn === null || !conn.reading || conn.child.exitCode !== null) return Promise.resolve({ error: "the connect program is not running" });
    const id = nextId++;
    return new Promise((answer) => {
      conn.pending.set(id, answer);
      conn.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: input } })}\n`);
    });
  };

  const isCurrent = (index: number) => running !== null && running.index === index && !stopped;

  const endTurn = (index: number, answer: string, reason: Reason, extra: { usage?: Record<string, unknown>; contextShare?: number } = {}) => {
    running = null;
    record({ turn: index, act: "end", reason, ...extra });
    ctx.emit({ kind: "turnEnded", answer, reason, ...extra });
  };

  // The restart act, in the order the contract asks: the pipe's connection
  // is closed and its token replaced, the old connect child is no longer
  // read, that child is ended, the next child starts on the token the close
  // returned, and restarted is emitted.
  const restart = async (index: number) => {
    running = null;
    const old = connection;
    connection = null;
    const token = ctx.closePipeConnection();
    if (old !== null) {
      stopReading(old);
      await endChild(old);
    }
    record({ turn: index, act: "restart" });
    if (stopped) return;
    connection = connect(token);
    ctx.emit({ kind: "restarted" });
  };

  const runTurn = async (index: number) => {
    // A turn handed once the engine exited or was stopped ends at once, so
    // the host never waits out its silence bound for it.
    if (stopped) {
      record({ turn: index, act: "not-running" });
      endTurn(index, "", "error");
      return;
    }
    const entry = entries[index];
    if (entry === undefined) {
      record({ turn: index, act: "no-entry" });
      endTurn(index, "", "error");
      return;
    }
    for (const act of entry) {
      if (!isCurrent(index)) return;
      if ("say" in act) {
        record({ turn: index, act: "say" });
        ctx.emit({ kind: "step", text: act.say });
      } else if ("tool" in act) {
        ctx.emit({ kind: "step", toolCalls: [{ name: act.tool, input: act.input }] });
        const reply = await callTool(act.tool, act.input);
        if (!isCurrent(index)) {
          record({ turn: index, act: "tool", name: act.tool, dropped: true });
          return;
        }
        record({ turn: index, act: "tool", name: act.tool, ...(Object.hasOwn(reply, "result") ? { result: reply.result } : { error: reply.error ?? null }) });
      } else if ("end" in act) {
        endTurn(index, act.end, act.reason, { ...(act.usage !== undefined ? { usage: act.usage } : {}), ...(act.contextShare !== undefined ? { contextShare: act.contextShare } : {}) });
        return;
      } else if ("silent" in act) {
        if (running !== null) running.silent = true;
        record({ turn: index, act: "silent" });
        return;
      } else if ("restart" in act) {
        await restart(index);
        return;
      } else if ("exit" in act) {
        running = null;
        stopped = true;
        const conn = connection;
        connection = null;
        if (conn !== null) {
          stopReading(conn);
          await endChild(conn);
        }
        record({ turn: index, act: "exit", code: act.exit });
        ctx.emit({ kind: "exited", code: act.exit });
        return;
      }
      // complete, completeHangs and start acts are no step of the turn.
    }
    if (isCurrent(index)) {
      record({ turn: index, act: "ran-out" });
      endTurn(index, "", "error");
    }
  };

  return {
    toolRunner: "engine",
    async start() {
      if (ctx.script === undefined) throw new Error("the scripted engine is started with no --script file");
      entries = readScript(ctx.script);
      const how = entries[0]?.find((act): act is Extract<Act, { start: string }> => "start" in act);
      record({ act: "start", entries: entries.length, ...(how !== undefined ? { start: how.start } : {}) });
      if (how?.start === "reject") throw new Error(how.sentence);
      if (how?.start === "hang") return await new Promise<void>(() => {});
      connection = connect(ctx.pipe.token);
      ctx.emit({ kind: "ready" });
    },
    async turn(text: string) {
      const index = handed++;
      running = { index, silent: false };
      record({ turn: index, act: "handed", text });
      void runTurn(index);
    },
    async interrupt() {
      const turn = running;
      if (turn === null) {
        record({ act: "interrupt", turn: null });
        return;
      }
      if (turn.silent) {
        record({ act: "interrupt", turn: turn.index, unanswered: true });
        return;
      }
      running = null;
      if (connection !== null) settlePending(connection, { error: "the turn was interrupted" });
      record({ act: "interrupt", turn: turn.index });
      ctx.emit({ kind: "turnEnded", answer: "", reason: "aborted" });
    },
    async stop() {
      stopped = true;
      running = null;
      const conn = connection;
      connection = null;
      if (conn !== null) {
        stopReading(conn);
        await endChild(conn);
      }
      record({ act: "stop" });
    },
    async complete(_request: ModelCompleteRequest, signal?: AbortSignal): Promise<ModelCompleteResult> {
      const place = running !== null ? running.index : handed;
      const answer = entries[place]?.find((act): act is { complete: string } => "complete" in act)?.complete;
      const hangs = entries[place]?.some((act) => "completeHangs" in act) === true;
      record({ act: "complete", entry: place, answered: answer !== undefined, ...(hangs ? { hangs: true } : {}) });
      if (hangs) {
        // A hanging complete still never answers; its abort is recorded.
        signal?.addEventListener("abort", () => record({ act: "complete", entry: place, aborted: true }), { once: true });
        return await new Promise<ModelCompleteResult>(() => {});
      }
      if (answer === undefined) throw new Error(`the script answers no complete at entry ${place}`);
      return { isAnswered: true, text: answer, usage: { ...NO_USAGE } };
    },
  };
}

registerAdapter(SCRIPTED_ENGINE, createScriptedAdapter);
