// host.ts: the one interface through which a module outside hooks/index.ts
// reaches the engine. Types only, no runtime code.
//
// The engine's loader follows `$` only into a function declared at the top
// level of hooks/index.ts and refuses the whole module, silently, where `$`
// is passed across an import. So `$` never leaves hooks/index.ts. Its
// top-level hostOf($) builds this object instead, each member an arrow making
// one full `$.noun.verb(...)` call at its own site, and a module declares
// what it needs as a Pick of this interface. The shape is flat rather than
// nested by noun because the flat shape is the one the loader has accepted.
//
// Built at each call site rather than cached in session state: `$` is
// rebuilt on a plugin reload and a cached closure set would hold the old one.

import type { ApiMessage, CommandRunArgs, CommandRunResult, FsEntry, HttpInit, HttpResponse, SessionMessage, SessionUsage, SessionUsageArgs, Settings, StateRead, StateSetResult, StateValue } from "claude-code";

// The compaction pass's verdict cache, as hooks/personas.d.ts declares it.
type CompactionVerdicts = StateValue<"personas", "compactionVerdicts">;

export interface PluginHost {
  // $.env.get("TYPESAFE_API_KEY"): the Jev bearer key, undefined where unset.
  getApiKey(): Promise<string | undefined>;
  // $.env.get("USERPROFILE"), else $.env.get("HOME"): the directory the
  // question overrides and the decision journal live under.
  getHome(): Promise<string | undefined>;
  // $.fs.read(path): rejects when the file is missing.
  readFile(path: string): Promise<string>;
  // $.fs.write(path, text): creates the file and its directories as needed.
  writeFile(path: string, text: string): Promise<void>;
  // $.fs.exists(path): never rejects.
  fileExists(path: string): Promise<boolean>;
  // $.fs.list(path): one { name, kind, size, isLink } per entry of the
  // directory, by name, each entry as it stands.
  listDir(path: string): Promise<FsEntry[]>;
  // $.http.fetch(url, init): resolves { status, ok, headers, text } once the
  // body is read. Takes no timeout, so a caller races it against sleep.
  fetch(url: string, init?: HttpInit): Promise<HttpResponse>;
  // $.clock.sleep(ms, { signal }): resolves after ms milliseconds, and rejects
  // at once when `signal` aborts. A `$.clock` wait is the one engine call a
  // hook's dispatch budget keeps running through, so a sleep raced beside a
  // call carries a signal its race fires once the call settles first.
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  // $.state.get({ plugin: "personas", key: "compactionVerdicts" }): the
  // verdict cache and its version, the value undefined where never written.
  getCompactionVerdicts(): Promise<StateRead<CompactionVerdicts>>;
  // $.state.set({ plugin: "personas", key: "compactionVerdicts" }, value).
  setCompactionVerdicts(value: CompactionVerdicts): Promise<StateSetResult>;
  // $.store.get(key): the value under key, undefined where unset.
  getStore(key: string): Promise<unknown>;
  // $.store.set(key, value): rejects on a value that is not JSON data.
  setStore(key: string, value: unknown): Promise<void>;
  // $.store.delete(key).
  deleteStore(key: string): Promise<void>;
  // $.session.usage(args): the context window's fill, with
  // context.breakdown where args asks for one.
  sessionUsage(args?: SessionUsageArgs): Promise<SessionUsage>;
  // $.session.messages(args): the main conversation, as rows with no
  // argument and in the Messages API form with { as: "api" }.
  sessionMessages(): Promise<SessionMessage[]>;
  sessionMessages(args: { as: "api" }): Promise<ApiMessage[]>;
  // $.command.run(args): queued until the session is idle, and rejects an
  // unknown name.
  runCommand(args: CommandRunArgs): Promise<CommandRunResult>;
  // The four variables the Channels launch wrapper sets in a watched
  // session's environment, each undefined where unset. The relay adapter
  // (hooks/relay-adapter.ts) reads them for its request headers and nothing
  // else does; the token's value reaches one header and no other surface.
  // $.env.get("CHANNEL_PROCESS_TOKEN").
  getChannelProcessToken(): Promise<string | undefined>;
  // $.env.get("CHANNEL_SESSION").
  getChannelSession(): Promise<string | undefined>;
  // $.env.get("CHANNEL_LINEAGE").
  getChannelLineage(): Promise<string | undefined>;
  // $.env.get("CHANNEL_SESSION_MIRROR").
  getChannelSessionMirror(): Promise<string | undefined>;
  // $.env.get("LOCALAPPDATA"): the root the Channels broker's state folder
  // sits under, undefined where unset.
  getLocalAppData(): Promise<string | undefined>;
  // $.settings.read({ source: "user" }): the user settings file as loaded,
  // its `hooks` object whole, and `{}` where the file is absent.
  readUserSettings(): Promise<Settings>;
  // $.ui.log(text, { to: "debug" }): one line to the debug log alone, never
  // the transcript. The engine declares the call synchronous, so hostOf wraps
  // its return in Promise.resolve for the reason the note below gives: a
  // host call is an op event and resolves whatever its declaration says.
  logDebug(text: string): Promise<void>;
}

// Every member above returns a promise, and that holds for engine calls whose
// published signature is synchronous. A host call is an op event, so
// $.clock.now() resolves to a number rather than returning one, against the
// `now: () => number` its own type declaration carries. No member wrapping a
// synchronous engine call belongs here for that reason: its declared type
// would be a lie tsc cannot catch, and a test fake returning the plain value
// would agree with the declaration and disagree with the engine. Code in this
// plugin reads the wall clock with Date.now() directly, as it does everywhere
// else. logDebug is the one member over a call declared synchronous, and it
// is honest on both sides because hostOf wraps the call's return in
// Promise.resolve: the engine's promise and a fake's undefined both resolve.
