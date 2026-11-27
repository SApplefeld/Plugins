// events.ts: the registry the hooks module's `on` writes to, and the one
// function that fires an event through it as the engine does.
//
// Registrations nest in the order they were made, the first outermost. Each
// handler is called with the handle, the event and a `next` that runs the
// handlers beneath it and then the caller's terminal, the engine's own part.
// `next` carries `budget`, `signal`, `origin` and `event`, as the engine's
// does, and the origin of every dispatch this file fires is the engine's,
// `{ plugin: "engine", tier: "core" }`.
//
// The budget. A handler has HOOK_BUDGET.ms of its own time. The clock stands
// still while a `next` call or a handle call of the handler's is in flight,
// a `clock` member excepted, as the engine's declaration of HookBudget says.
// A handler past its budget has its signal aborted and is left to run on.
//
// A failure. A handler that throws, rejects, returns nothing or overruns its
// budget has failed. The registration's `.catch` handler is then called with
// a `next` carrying `error` (`{ kind, message?, budget }`) and `called`, under
// HOOK_BUDGET.catchMs. That `next` is replay-safe: where the failed handler
// had called its own `next`, it resolves to what that call settled to and
// runs nothing beneath again. The failed handler's own `next`, called after
// it failed, is replay-safe the same way, so the handlers beneath and the
// terminal run at most once per dispatch. What the catch handler returns is the
// handler's result; where it returns nothing, fails or has no catch handler
// at all, the handler is skipped and the dispatch goes on beneath it. So
// nothing a handler throws reaches the caller of `fire`.
//
// A stream. `turn.step`'s handler is an async generator. fireStream hands it
// a `next` whose call returns the stream beneath, and returns the outermost
// handler's stream for the caller to pull. A stream handler's time is not
// metered, since its waits are on the stream beneath. One that throws is
// handled as above: its catch handler's stream where there is one, and
// otherwise the stream beneath, read on from where it stood. A catch
// handler's own throw is not caught here: it reaches the caller's pull,
// which ends the step.
//
// Every `tool.call` handler runs inside a scope that insideToolCall reads,
// so the handle's prompt.submit can refuse a call made from inside one. A
// caller runs more than tool.call inside it through inToolCallScope, as the
// host does for a whole engine tool call, its tool.check included.
//
// One process holds one registry, since the hooks module keeps its own state
// at module scope and is loaded once per process.

import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { POLICY } from "./policy.ts";

// A registered handler, as loose as the module's sixteen registrations are
// various; each event's own shape is the engine declaration's.
export type Handler = (dp: any, e: any, next: any) => any;
// The engine's own part of a dispatch, run beneath every handler.
export type Terminal = (e: any) => unknown;
// The engine's own part of a streamed dispatch.
export type StreamTerminal = (e: any) => AsyncGenerator<unknown, unknown, unknown>;

type Registration = { event: string; handler: Handler; catchHandler: Handler | null };

// The engine declaration's HookBudget.
export const HOOK_BUDGET = Object.freeze({ ms: 10_000, catchMs: 1_000, lingerMs: 5_000 });

const ENGINE_ORIGIN = Object.freeze({ plugin: "engine", tier: "core" });
const UNMETERED = Object.freeze({ ms: 0, remainingMs: Infinity });

const registry = new Map<string, Registration[]>();
let handle: object | null = null;
const toolCallScope = new AsyncLocalStorage<true>();
const timers: { cancel: () => void }[] = [];
let clockStopped = false;
let openDispatches = 0;
let idleWaiters: (() => void)[] = [];
// The events policy.ts has a row for, and each event without one that the
// log has named.
const EVENT_ROWS: ReadonlySet<string> = new Set(POLICY.filter((row) => row.kind === "event").map((row) => row.name));
const unrowedLogged = new Set<string>();

// The engine's `on`. A pattern other than one event's name, and a matcher,
// are not served: the hooks module registers each event by its name. An
// event with no row in policy.ts is registered and never fired, and the
// handle's log names it once, through the handle's ui.log as the host's
// own lines are written. A name counts as named only once that line was
// written, so one registered before the handle is set is named at its first
// registration after.
export function on(event: string, handler: Handler, ...rest: unknown[]): { catch(handler: Handler): void } {
  if (typeof event !== "string" || /[*!]/.test(event) || typeof handler !== "function" || rest.length > 0) {
    throw new TypeError("not served on this engine: on() takes one event's name and one handler");
  }
  if (!EVENT_ROWS.has(event) && !unrowedLogged.has(event) && handle !== null) {
    try {
      (handle as { ui: { log(text: string): void } }).ui.log(`engine events: on: ${event} has no row in policy.ts, so it is registered and never fired`);
      unrowedLogged.add(event);
    } catch {
      // A line the log could not take is lost; the registration goes on.
    }
  }
  const registration: Registration = { event, handler, catchHandler: null };
  const list = registry.get(event) ?? [];
  list.push(registration);
  registry.set(event, list);
  return {
    catch(catchHandler: Handler) {
      registration.catchHandler = catchHandler;
    },
  };
}

// The handle every dispatch hands its handlers.
export function setHandle(value: object): void {
  handle = value;
}

// Whether the code calling is running inside a tool.call handler.
export function insideToolCall(): boolean {
  return toolCallScope.getStore() === true;
}

// Runs `body` inside the tool-call scope insideToolCall reads.
export function inToolCallScope<T>(body: () => T): T {
  return toolCallScope.run(true, body);
}

// Cancels every interval the module set through the handle's clock.every,
// and refuses any it asks for later.
export function stopClock(): void {
  clockStopped = true;
  for (const timer of timers.splice(0)) timer.cancel();
}

// Resolves once no dispatch is in flight: no fired event, no step stream
// pulled and not yet ended, and no run of a clock.every callback. A handler
// left running past its budget is not counted, since its dispatch went on
// without it, and neither is work a handler starts and does not await.
export function dispatchesSettled(): Promise<void> {
  if (openDispatches === 0) return Promise.resolve();
  return new Promise((done) => idleWaiters.push(done));
}

function dispatchStarted(): void {
  openDispatches++;
}

function dispatchEnded(): void {
  openDispatches--;
  if (openDispatches > 0) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const done of waiters) done();
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A handler's own clock: it runs while nothing the handler waits on is in
// flight, and calls `overrun` once the budget is spent.
class Meter {
  private remaining: number;
  private since = performance.now();
  private waits = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  readonly ms: number;
  private readonly overrun: () => void;

  constructor(ms: number, overrun: () => void) {
    this.ms = ms;
    this.overrun = overrun;
    this.remaining = ms;
    this.arm();
  }

  private arm(): void {
    this.timer = setTimeout(() => {
      this.stopped = true;
      this.overrun();
    }, Math.max(0, this.remaining));
  }

  pause(): void {
    if (this.stopped) return;
    if (this.waits++ > 0) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.remaining -= performance.now() - this.since;
  }

  resume(): void {
    if (this.stopped || this.waits === 0) return;
    if (--this.waits > 0) return;
    this.since = performance.now();
    this.arm();
  }

  get remainingMs(): number {
    if (this.stopped) return 0;
    const left = this.waits > 0 ? this.remaining : this.remaining - (performance.now() - this.since);
    return Math.max(0, left);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
  }

  // The budget as `next.budget` reads it, fresh on each access.
  budget(): { readonly ms: number; readonly remainingMs: number } {
    const meter = this;
    return {
      get ms() { return meter.ms; },
      get remainingMs() { return meter.remainingMs; },
    };
  }
}

// The handle as one handler sees it: each call of a member stops the
// handler's clock until it settles, a clock member excepted, and every
// interval clock.every sets is kept so stopClock can cancel it, and each run
// of its callback counts as an open dispatch. The targets
// are fresh objects, since the handle's own are frozen and a proxy of a
// frozen object must return its members unchanged.
function handleFor(meter: Meter | null): unknown {
  const real = handle as Record<string, unknown> | null;
  if (real === null) return null;
  const nounOf = (noun: string, members: Record<string, unknown>) => new Proxy({}, {
    has: (_target, verb) => verb in members,
    get(_target, verb) {
      const member = members[verb as string];
      if (typeof member !== "function") return member;
      if (noun === "clock") {
        if (verb !== "every") return member;
        return (ms: unknown, fn: unknown, ...rest: unknown[]) => {
          if (clockStopped) throw new Error("not served on this engine: clock.every after the clock stopped");
          // Each run of the callback is an open dispatch until it settles, so
          // the host's end waits for a tick that is part way through a write.
          const counted = typeof fn !== "function" ? fn : (...a: unknown[]) => {
            dispatchStarted();
            let out: unknown;
            try {
              out = (fn as (...b: unknown[]) => unknown)(...a);
            } catch (err) {
              dispatchEnded();
              throw err;
            }
            return Promise.resolve(out).finally(dispatchEnded);
          };
          const timer = (member as (...a: unknown[]) => { cancel: () => void })(ms, counted, ...rest);
          timers.push(timer);
          return timer;
        };
      }
      if (meter === null) return member;
      return (...args: unknown[]) => {
        meter.pause();
        let out: unknown;
        try {
          out = (member as (...a: unknown[]) => unknown)(...args);
        } catch (err) {
          meter.resume();
          throw err;
        }
        Promise.resolve(out).then(() => meter.resume(), () => meter.resume());
        return out;
      };
    },
  });
  return new Proxy({}, {
    has: (_target, noun) => noun in real,
    get(_target, noun) {
      const value = real[noun as string];
      if (value === null || typeof value !== "object") return value;
      return nounOf(noun as string, value as Record<string, unknown>);
    },
  });
}

// A `next` function with the members the engine's carries.
function nextOf(event: string, call: (e: unknown) => unknown, members: { budget: object; signal: AbortSignal; error?: object; called?: boolean }) {
  const next = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return Promise.reject(new TypeError(`next() was called with no event in a ${event} handler`));
    return call(args[0]);
  };
  Object.defineProperties(next, {
    budget: { value: members.budget, enumerable: true },
    signal: { value: members.signal, enumerable: true },
    origin: { value: ENGINE_ORIGIN, enumerable: true },
    event: { value: event, enumerable: true },
  });
  if (members.error !== undefined) {
    Object.defineProperties(next, {
      error: { value: members.error, enumerable: true },
      called: { value: members.called === true, enumerable: true },
    });
  }
  return Object.freeze(next);
}

// Runs one handler, under its budget, and its catch handler where it fails.
async function runHandler(registration: Registration, e: unknown, beneath: (e: unknown) => Promise<unknown>): Promise<unknown> {
  const controller = new AbortController();
  let overran!: () => void;
  const overrun = new Promise<"overrun">((done) => { overran = () => done("overrun"); });
  const meter = new Meter(HOOK_BUDGET.ms, () => {
    controller.abort(new Error(`the ${registration.event} handler spent its budget`));
    overran();
  });
  let called = false;
  let last: Promise<unknown> | null = null;
  // Set once the handler has failed. A failed handler may still be running,
  // so its `next` then answers what the dispatch beneath settled to, or
  // starts it once where nothing has, and never runs it a second time.
  let failed = false;
  let replay: Promise<unknown> | null = null;
  const replayed = (down: unknown): Promise<unknown> => {
    if (last !== null) return last;
    replay ??= beneath(down);
    return replay;
  };
  const next = nextOf(registration.event, (down) => {
    if (failed) return replayed(down);
    called = true;
    meter.pause();
    const call = beneath(down);
    last = call;
    call.then(() => meter.resume(), () => meter.resume());
    return call;
  }, { budget: meter.budget(), signal: controller.signal });

  const ran = Promise.resolve().then(() => registration.handler(handleFor(meter), e, next));
  // A handler left to run past its budget settles unseen.
  ran.catch(() => undefined);
  const outcome = await Promise.race([
    ran.then((value) => ({ value }), (err: unknown) => ({ err })),
    overrun,
  ]);
  meter.stop();
  let failure: { kind: "throw" | "timeout"; message?: string };
  if (outcome === "overrun") failure = { kind: "timeout" };
  else if ("err" in outcome) failure = { kind: "throw", message: messageOf(outcome.err) };
  else if (outcome.value === undefined) failure = { kind: "throw", message: `the ${registration.event} handler returned nothing` };
  else return outcome.value;
  failed = true;

  if (registration.catchHandler !== null) {
    const catchController = new AbortController();
    let catchOverran!: () => void;
    const catchOverrun = new Promise<"overrun">((done) => { catchOverran = () => done("overrun"); });
    const catchMeter = new Meter(HOOK_BUDGET.catchMs, () => {
      catchController.abort(new Error(`the ${registration.event} catch handler spent its budget`));
      catchOverran();
    });
    const caughtNext = nextOf(registration.event, (down) => {
      catchMeter.pause();
      const call = replayed(down);
      call.then(() => catchMeter.resume(), () => catchMeter.resume());
      return call;
    }, {
      budget: catchMeter.budget(),
      signal: catchController.signal,
      error: Object.freeze({ ...failure, budget: HOOK_BUDGET.catchMs }),
      called,
    });
    const caught = Promise.resolve().then(() => registration.catchHandler!(handleFor(catchMeter), e, caughtNext));
    caught.catch(() => undefined);
    const answer = await Promise.race([caught.then((value) => ({ value }), () => ({ value: undefined })), catchOverrun]);
    catchMeter.stop();
    if (answer !== "overrun" && answer.value !== undefined) return answer.value;
  }
  return replayed(e);
}

// Fires `event` through its handlers, first registered outermost, with
// `terminal` beneath them all, and resolves to what the outermost returns.
export async function fire(event: string, e: unknown, terminal: Terminal): Promise<unknown> {
  const list = [...(registry.get(event) ?? [])];
  const run = (index: number, down: unknown): Promise<unknown> =>
    index >= list.length ? Promise.resolve().then(() => terminal(down)) : runHandler(list[index], down, (below) => run(index + 1, below));
  dispatchStarted();
  try {
    return await (event === "tool.call" ? toolCallScope.run(true, () => run(0, e)) : run(0, e));
  } finally {
    dispatchEnded();
  }
}

// A stream that keeps what the stream it reads returned.
type Recorded = { stream: AsyncGenerator<unknown, unknown, unknown>; done: boolean; value: unknown };
function recorded(source: AsyncGenerator<unknown, unknown, unknown>): Recorded {
  const record: Recorded = { stream: null as unknown as AsyncGenerator<unknown, unknown, unknown>, done: false, value: undefined };
  record.stream = (async function* () {
    const value = yield* source;
    record.done = true;
    record.value = value;
    return value;
  })();
  return record;
}

async function* runStreamHandler(registration: Registration, e: unknown, beneath: (e: unknown) => AsyncGenerator<unknown, unknown, unknown>): AsyncGenerator<unknown, unknown, unknown> {
  const controller = new AbortController();
  let below: Recorded | null = null;
  // Set once the handler has thrown. A `next` it kept and calls later, or the
  // catch handler's, then reads the one stream beneath, started once.
  let failed = false;
  const replayed = (down: unknown): AsyncGenerator<unknown, unknown, unknown> => {
    below ??= recorded(beneath(down));
    const started = below;
    if (started.done) return (async function* () { return started.value; })();
    return started.stream;
  };
  const next = nextOf(registration.event, (down) => {
    if (failed) return replayed(down);
    below = recorded(beneath(down));
    return below.stream;
  }, { budget: UNMETERED, signal: controller.signal });
  let failure: { kind: "throw"; message: string };
  try {
    return yield* registration.handler(handleFor(null), e, next) as AsyncGenerator<unknown, unknown, unknown>;
  } catch (err) {
    failure = { kind: "throw", message: messageOf(err) };
  }
  failed = true;
  const called = (below as Recorded | null) !== null;
  if (registration.catchHandler !== null) {
    const caughtNext = nextOf(registration.event, (down) => replayed(down), {
      budget: UNMETERED,
      signal: controller.signal,
      error: Object.freeze({ ...failure, budget: HOOK_BUDGET.catchMs }),
      called,
    });
    return yield* registration.catchHandler(handleFor(null), e, caughtNext) as AsyncGenerator<unknown, unknown, unknown>;
  }
  return yield* replayed(e);
}

// Fires a streamed event: the outermost handler's stream, which the caller
// pulls, with `terminal`'s stream beneath them all. The stream is an open
// dispatch from its first pull until it ends, by a return, a throw or the
// caller's `return`.
export function fireStream(event: string, e: unknown, terminal: StreamTerminal): AsyncGenerator<unknown, unknown, unknown> {
  const list = [...(registry.get(event) ?? [])];
  const run = (index: number, down: unknown): AsyncGenerator<unknown, unknown, unknown> =>
    index >= list.length ? terminal(down) : runStreamHandler(list[index], down, (below) => run(index + 1, below));
  return (async function* () {
    dispatchStarted();
    try {
      return yield* run(0, e);
    } finally {
      dispatchEnded();
    }
  })();
}
