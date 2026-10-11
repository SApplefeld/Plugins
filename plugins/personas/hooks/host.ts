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

import type { FsEntry, HttpInit, HttpResponse } from "claude-code";

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
}

// Every member above returns a promise, and that holds for engine calls whose
// published signature is synchronous. A host call is an op event, so
// $.clock.now() resolves to a number rather than returning one, against the
// `now: () => number` its own type declaration carries. No member wrapping a
// synchronous engine call belongs here for that reason: its declared type
// would be a lie tsc cannot catch, and a test fake returning the plain value
// would agree with the declaration and disagree with the engine. Code in this
// plugin reads the wall clock with Date.now() directly, as it does everywhere
// else.
