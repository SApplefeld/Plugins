// handle.ts: the engine handle the stand-in hands the persona hooks module,
// built from the policy table in engine/policy.ts.
//
// Each call row of the table becomes one member, by its answer:
//   refused   a function that rejects with `not served on this engine: <name>`
//   node      a body in this file, under the rules below
//   stand-in  state.* and ui.* have their bodies here; every other stand-in
//             member, and every adapter member, takes its body from
//             `deps.bodies`, and until a body is given rejects with the same
//             sentence; an adapter member whose body rejects with that
//             sentence, where the adapter does not answer, is logged as
//             unfilled too
// A member the table has no row for is absent, so a call to it throws in the
// caller. The handle's log, engine.log in the child's own folder, names each
// refused, unfilled or absent call once, so a refusal the module's own catch
// takes is still seen. A refused tool.call is named once for each tool asked
// for, so an expected call to one tool never uses up the line that would show
// a call to another.
//
// The rules the node members hold:
// - Files. fs.* are node's calls with the engine's result shapes, a relative
//   path read against the working directory. A path spelled with two leading
//   separators, a network share, a `\\?\` or `\\.\` path or a POSIX `//`
//   path, is rejected before any file system call, so a local `\\?\C:\` long
//   path and a `\\.\` device path are rejected too. The check reads only how
//   the path is spelled: a link inside the tree that points at a share, and a
//   drive letter mapped to a share, are not detected.
// - Environment. env.get answers a name on ENV_NAMES from this process's
//   environment, and any other name with undefined, logged once. The log
//   names the variable and never holds a value.
// - Programs. process.run starts the program with the argument list as given,
//   no shell, and this process's environment under the caller's keys. A bare
//   program name resolves from the child's PATH entries alone and never from
//   the working directory. Git runs with repo hooks off.
// - The network. http.fetch answers an address that is a prefix on
//   FETCH_PREFIXES or continues one past a path, query or fragment mark,
//   follows no redirect, gives up after FETCH_TIMEOUT_MS, and rejects any
//   other address before a socket opens.
// - The store. store.* are mcp/file-store.ts on the store file deps names; no
//   default path is computed. A write whose lock directory stays logs one line.
// - State. state.get and state.set keep one JSON file in the child's folder,
//   engine-state.json, keyed by plugin and key, each value with a version
//   that starts at 0 and rises by one on each set, written by a temp file and
//   a rename.
// - The screen. Each ui.* call appends one line to engine.log: the time, the
//   verb and the text cut at 2,000 characters. At the handle's start, and
//   whenever the file passes 5,000,000 bytes, the file is renamed over
//   engine.log.1 and a new one started, so two files at most exist.

import type { CoreEngineInterface, FsBytes, FsEntry, FsReadBytesOptions, FsReadOptions, FsStat, FsStatOptions, HttpInit, HttpResponse, PluginState, ProcessRunInit, ProcessRunResult, StateRead, StateRef, StateSetOptions, StateSetResult, StateValue, Timer } from "claude-code";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { access, constants, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileStoreOf } from "../mcp/file-store.ts";
import { POLICY } from "./policy.ts";

type Core = CoreEngineInterface;

// The members the table names, typed from the engine's own declaration, so a
// member whose signature the engine changes fails the type check.
export type EngineHandle = {
  agent: Pick<Core["agent"], "list">;
  audio: Pick<Core["audio"], "speak">;
  clock: Pick<Core["clock"], "every" | "sleep">;
  command: Pick<Core["command"], "run">;
  env: Pick<Core["env"], "get">;
  fs: Pick<Core["fs"], "exists" | "list" | "read" | "stat" | "write">;
  http: Pick<Core["http"], "fetch">;
  model: Pick<Core["model"], "classify" | "complete" | "fork">;
  plugin: Pick<Core["plugin"], "name" | "root">;
  process: Pick<Core["process"], "run">;
  prompt: Pick<Core["prompt"], "submit">;
  session: Pick<Core["session"], "cwd" | "id" | "messages" | "usage">;
  settings: Pick<Core["settings"], "read">;
  state: Pick<Core["state"], "get" | "set">;
  store: Pick<Core["store"], "delete" | "get" | "keys" | "set">;
  tool: Pick<Core["tool"], "call" | "register">;
  ui: Pick<Core["ui"], "log" | "notice" | "status" | "toast">;
};

type Noun = keyof EngineHandle & string;
// `<noun>.<verb>` for every member above.
export type MemberName = { [N in Noun]: `${N}.${keyof EngineHandle[N] & string}` }[Noun];
type MemberOf<M extends MemberName> = M extends `${infer N}.${infer V}`
  ? N extends Noun ? V extends keyof EngineHandle[N] ? EngineHandle[N][V] : never : never
  : never;
type Members = { [M in MemberName]: MemberOf<M> };

// The members whose bodies a later part of the stand-in supplies.
export type BodyName = "agent.list" | "model.classify" | "model.complete" | "model.fork" | "prompt.submit" | "session.usage" | "tool.register";

export interface HandleDeps {
  // The plugin's directory; plugin.name is read from its manifest.
  pluginRoot: string;
  // The session's working directory.
  cwd: string;
  sessionId: string;
  // The child's own folder, which holds engine.log and engine-state.json.
  childFolder: string;
  // The store file, an absolute path.
  storeFile: string;
  bodies?: Partial<Pick<Members, BodyName>>;
}

const NOT_SERVED = "not served on this engine";

// The variables a running part of the module reads. A name the module reads
// only in a behaviour the stand-in switches off is left out: the relay's four
// CHANNEL_ variables and LOCALAPPDATA are read only by the relay adapter,
// which is off. Each name below is read at a site that still runs:
// TYPESAFE_API_KEY by the decision seam and the redactor seed; USERPROFILE
// and HOME for the home directory; OS, PATH, Path and SystemRoot by the
// executable resolver and the guards; the GIT_ names by the merged pull
// request guard's planted-variable check; the KIT_MEMORY_ and NODE_ names by
// the memory grant; TEMP and TMPDIR by the module's spawn adapter;
// KIT_EXTERNAL_ENGINE by the recognition nudge; the other five keys and
// tokens, and CLAUDE_CODE_SESSION_ID, by the redactor seed, which reads them
// to hide their values from the model. The list governs env.get alone: a
// child process.run starts receives the stand-in's whole environment, as the
// engine's does.
const ENV_NAMES: ReadonlySet<string> = new Set([
  "TYPESAFE_API_KEY", "USERPROFILE", "HOME", "OS", "PATH", "Path", "SystemRoot",
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS",
  "KIT_MEMORY_ROOT", "KIT_MEMORY_ROOT_ALLOW_DATA", "NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE",
  "TEMP", "TMPDIR", "KIT_EXTERNAL_ENGINE",
  "ANTHROPIC_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "DEEPGRAM_API_KEY", "TMW_REPORTING_TOKEN", "CLAUDE_CODE_SESSION_ID",
]);

// The addresses http.fetch answers: the TypeSafe endpoint the decision seam
// calls (hooks/decision-seam.ts). The relay broker's loopback address is the
// relay adapter's, which is off.
const FETCH_PREFIXES: readonly string[] = ["https://api.typesafe.ai/v1/systemone"];
// How long one http.fetch, the body's read included, may take.
const FETCH_TIMEOUT_MS = 60_000;

// A path spelled with two separators at the start: a network share such as
// `\\host\share`, `//host/share` or `\\?\UNC\host\share`, any other `\\?\` or
// `\\.\` path, or a POSIX `//` path. Opening a share makes the machine
// authenticate outbound and wait for the connection's timeout, so the fs.*
// members reject every path so spelled before any node call, a local
// `\\?\C:\` long path and a `\\.\` device path among them. The check reads
// only the spelling: a link inside the tree that points at a share, and a
// drive letter mapped to a share, are not detected. The pattern is
// namesNetworkShare's in hooks/compaction.ts.
const NETWORK_LOCATION = /^[\\/]{2}/;

const LOG_TEXT_CHARS = 2_000;
const LOG_ROTATE_BYTES = 5_000_000;
// The engine's bound on one fs.read and on each stream process.run keeps.
const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_STREAM_BYTES = 4_194_304;
const RUN_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MAX_MS = 600_000;
// The distinct clock.every failure lines logged, and the characters of each
// line's error code kept, so a callback whose code changes on each run cannot
// grow the logged set without bound.
const TIMER_MESSAGES_MAX = 100;
const TIMER_MESSAGE_CHARS = 200;
// The longest delay a node timer holds.
export const TIMER_MAX_MS = 2_147_483_647;
// A rename over the state file that another process's open handle interrupts
// is tried again this many times, this far apart, as mcp/file-store.ts does.
const BUSY_RETRIES = 10;
const BUSY_RETRY_MS = 20;
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

const codeOf = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code;
const sleepMs = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// Every error notServed made, so an adapter member's body that rejects with
// one is logged as unfilled.
const notServedErrors = new WeakSet<Error>();

// The error a member the stand-in does not serve rejects with; host.ts
// refuses a tool it will not take with the same.
export function notServed(what: string): Error {
  const err = new Error(`${NOT_SERVED}: ${what}`);
  notServedErrors.add(err);
  return err;
}

// One line to engine.log, and the renames that keep it to two files.
//
// A log that cannot be written must not throw into the plugin, whose ui calls
// the engine declares never to throw, so each kind of failure is told once on
// the stand-in's own stderr. A line that cannot be appended is lost and the
// next line is tried. A rename that fails at the start leaves the old file in
// place and lines go on into it. A rename that fails once the file has taken
// LOG_ROTATE_BYTES since the start stops the log, so the file stays bounded.
function engineLog(folder: string): (verb: string, text: string) => void {
  const file = join(folder, "engine.log");
  let bytes = 0;
  let stopped = false;
  const told = new Set<string>();
  const tell = (kind: string, sentence: string) => {
    if (told.has(kind)) return;
    told.add(kind);
    process.stderr.write(`engine stand-in: ${sentence}\n`);
  };
  // The code of a rename that failed, or undefined where the file is now
  // engine.log.1 or there was none to rename.
  const rotate = (): string | undefined => {
    try {
      renameSync(file, `${file}.1`);
    } catch (err) {
      if (codeOf(err) !== "ENOENT") return codeOf(err) ?? "error";
    }
    bytes = 0;
    return undefined;
  };
  mkdirSync(folder, { recursive: true });
  const atStart = rotate();
  if (atStart !== undefined) tell("start", `${file} could not be renamed over ${file}.1 at the start (${atStart}); lines go on into it`);
  return (verb, text) => {
    if (stopped) return;
    const line = `${new Date().toISOString()}\t${verb}\t${JSON.stringify(text.slice(0, LOG_TEXT_CHARS))}\n`;
    try {
      appendFileSync(file, line, "utf8");
    } catch (err) {
      tell("append", `a line could not be written to ${file} (${codeOf(err) ?? "error"}); each later line is tried, and a later failure is not told`);
      return;
    }
    bytes += Buffer.byteLength(line, "utf8");
    if (bytes <= LOG_ROTATE_BYTES) return;
    const failed = rotate();
    if (failed === undefined) return;
    stopped = true;
    tell("full", `${file} passed ${LOG_ROTATE_BYTES} bytes and could not be renamed over ${file}.1 (${failed}); later log lines are dropped`);
  };
}

// Whether a PATH entry names a directory absolutely: a drive path or a UNC
// path on Windows, a path from the root elsewhere. A relative entry such as
// `.` would read the working directory, so it is skipped.
function absolutePathEntry(entry: string, windows: boolean): boolean {
  return windows ? /^[A-Za-z]:[\\/]/.test(entry) || /^[\\/]{2}[^\\/]/.test(entry) : entry.startsWith("/");
}

// The program process.run starts for argv[0]. A name with a directory part is
// started as given. A bare name is looked up in the PATH entries alone, in
// order. On Windows `<name>.com` then `<name>.exe` is tried in each, or the
// name alone where it already ends in one of the two: a spawn with no shell
// starts only those, so the other PATHEXT kinds, `.cmd` and `.bat` among them,
// are not looked for. Elsewhere the name alone is tried, and must be an
// executable file. Node's own lookup is never reached for a bare name, since
// on Windows it reads the working directory first.
async function programOf(name: string, pathValue: string): Promise<string> {
  if (/[\\/]/.test(name) || isAbsolute(name)) return name;
  const windows = process.platform === "win32";
  const candidates = !windows ? [name] : /\.(com|exe)$/i.test(name) ? [name] : [`${name}.com`, `${name}.exe`];
  for (const raw of pathValue.split(delimiter)) {
    const entry = windows ? raw.trim().replace(/^"(.*)"$/, "$1") : raw;
    if (entry === "" || !absolutePathEntry(entry, windows)) continue;
    for (const candidate of candidates) {
      const path = join(entry, candidate);
      try {
        if (!(await stat(path)).isFile()) continue;
        if (!windows) await access(path, constants.X_OK);
        return path;
      } catch {
        // not here
      }
    }
  }
  throw Object.assign(new Error(`${name} is not on any PATH entry`), { code: "ENOENT" });
}

// The child's environment: the inherited one, with the caller's variables set
// over it. On Windows a name matches whatever its case, so a caller's `PATH`
// replaces the inherited `Path` rather than standing beside it.
function childEnvOf(inherited: NodeJS.ProcessEnv, callerEnv: Record<string, string> | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...inherited };
  for (const [name, value] of Object.entries(callerEnv ?? {})) {
    if (process.platform === "win32") {
      for (const held of Object.keys(env)) if (held.toUpperCase() === name.toUpperCase()) delete env[held];
    }
    env[name] = value;
  }
  return env;
}

// The value of PATH in a child's environment, read by name whatever its case
// on Windows.
function pathOf(env: Record<string, string | undefined>): string {
  if (process.platform !== "win32") return env.PATH ?? "";
  const name = Object.keys(env).find((held) => held.toUpperCase() === "PATH");
  return name === undefined ? "" : env[name] ?? "";
}

// The arguments git takes before the caller's, so a repository's hooks and
// file system monitor never run: the engine runs git with repo hooks off.
// Any other program takes none. On Windows the base name is matched without
// either extension programOf resolves, `.com` or `.exe`, and whatever its case.
function pinsFor(program: string): string[] {
  const windows = process.platform === "win32";
  const base = windows ? basename(program).toLowerCase().replace(/\.(com|exe)$/, "") : basename(program);
  return base === "git" ? ["-c", `core.hooksPath=${devNull}`, "-c", "core.fsmonitor="] : [];
}

// The first `limit` bytes of a stream as text. A cut inside a character drops
// that character.
function cutText(chunks: Buffer[], limit: number): { text: string; cut: boolean } {
  const all = Buffer.concat(chunks);
  if (all.length <= limit) return { text: all.toString("utf8"), cut: false };
  let end = limit;
  while (end > 0 && (all[end] & 0xc0) === 0x80) end -= 1;
  return { text: all.subarray(0, end).toString("utf8"), cut: true };
}

function runProgram(program: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, stdin: string | undefined, timeoutMs: number): Promise<ProcessRunResult> {
  return new Promise((done, fail) => {
    const child = spawn(program, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      fail(new Error(`${program} was still running after ${timeoutMs} ms and was killed`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (outBytes <= MAX_STREAM_BYTES) out.push(chunk);
      outBytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errBytes <= MAX_STREAM_BYTES) err.push(chunk);
      errBytes += chunk.length;
    });
    // A child that exits without reading its input closes the pipe under the
    // write; that is the child's business and not a failure of the run.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");
    child.on("error", (spawnErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail(spawnErr);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = cutText(out, MAX_STREAM_BYTES);
      const stderr = cutText(err, MAX_STREAM_BYTES);
      done({ exitCode: code ?? 1, stdout: stdout.text, stderr: stderr.text, isStdoutTruncated: stdout.cut, isStderrTruncated: stderr.cut });
    });
  });
}

// The URL itself where it is a listed prefix or continues one past a `/`, `?`
// or `#`, else the host it names
// for the refusal, or a stand-in word where it does not parse.
function fetchTargetOf(url: string): { ok: true; url: string } | { ok: false; host: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, host: "an address that does not parse" };
  }
  const href = parsed.href;
  const listed = FETCH_PREFIXES.some((prefix) => href === prefix || (href.startsWith(prefix) && "/?#".includes(href[prefix.length])));
  if (listed) return { ok: true, url: href };
  return { ok: false, host: parsed.host || parsed.protocol };
}

type StateEntry = { value: unknown; version: number };
type StateFile = Record<string, Record<string, StateEntry>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Sets an own property, so a key such as __proto__ is kept as data.
function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// state.get and state.set over engine-state.json, one operation at a time.
function engineState(folder: string) {
  const file = join(folder, "engine-state.json");
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  const load = async (): Promise<StateFile> => {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      if (codeOf(err) === "ENOENT") return {};
      throw err;
    }
    const data: unknown = JSON.parse(text);
    if (!isRecord(data)) throw new Error(`${file} does not hold a JSON object`);
    return data as StateFile;
  };
  // A stored entry is a record whose version is a whole number from 0 up;
  // any other is a bad file, which rejects rather than read as a version.
  const entryOf = (data: StateFile, plugin: string, key: string): StateEntry | undefined => {
    if (!Object.hasOwn(data, plugin) || !isRecord(data[plugin]) || !Object.hasOwn(data[plugin], key)) return undefined;
    const entry: unknown = data[plugin][key];
    if (!isRecord(entry) || !Number.isSafeInteger(entry.version) || (entry.version as number) < 0) throw new Error(`${file} holds no whole version for ${plugin}.${key}`);
    return entry as StateEntry;
  };
  // A write that fails partway removes its temp file; one that fails because
  // the temp name is taken leaves that file, which is not this write's.
  const save = async (data: StateFile) => {
    const tmp = `${file}.tmp.${randomBytes(4).toString("hex")}`;
    try {
      await writeFile(tmp, JSON.stringify(data), { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if (codeOf(err) !== "EEXIST") await unlink(tmp).catch(() => {});
      throw err;
    }
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await rename(tmp, file);
          return;
        } catch (err) {
          if (!BUSY_CODES.has(codeOf(err) ?? "") || attempt >= BUSY_RETRIES) throw err;
          await sleepMs(BUSY_RETRY_MS);
        }
      }
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  };
  const get: Members["state.get"] = <P extends keyof PluginState & string, K extends keyof PluginState[P] & string>(ref: StateRef<P, K>) => serial(async (): Promise<StateRead<StateValue<P, K>>> => {
    const entry = entryOf(await load(), ref.plugin, ref.key);
    // The file holds JSON the stand-in wrote under this ref; its type is the
    // caller's contract, which no read of the file can prove. The member's own
    // signature is the declaration's, so this cast cannot hide a change to it.
    return entry === undefined ? { value: undefined, version: 0 } : { value: entry.value as StateValue<P, K>, version: entry.version };
  });
  const set: Members["state.set"] = (ref, value, options?: StateSetOptions): Promise<StateSetResult> => serial(async () => {
    const text = value === undefined ? undefined : JSON.stringify(value);
    if (text === undefined) throw new TypeError(`state.set ${ref.plugin}.${ref.key}: the value is not JSON data`);
    const data = await load();
    const version = entryOf(data, ref.plugin, ref.key)?.version ?? 0;
    if (options?.ifVersion !== undefined && options.ifVersion !== version) return { isSet: false, version };
    if (!Object.hasOwn(data, ref.plugin) || !isRecord(data[ref.plugin])) defineOwn(data, ref.plugin, {});
    defineOwn(data[ref.plugin], ref.key, { value: JSON.parse(text), version: version + 1 });
    await save(data);
    return { isSet: true, version: version + 1 };
  });
  return { get, set };
}

// The fs.* members, each reading a relative path against `cwd`. A path
// spelled with two leading separators, as given or once read against `cwd`,
// rejects before any file system call; a link or mapped drive that reaches a
// share is not seen by that check.
function fileMembers(cwd: string) {
  const at = (path: string) => {
    const target = resolve(cwd, path);
    if (NETWORK_LOCATION.test(path) || NETWORK_LOCATION.test(target)) throw new Error(`${path} names a network or device location (two leading separators), which the file members refuse`);
    return target;
  };
  // The declaration's three overloads, so the member is checked against each.
  function read(path: string): Promise<string>;
  function read(path: string, options: FsReadBytesOptions): Promise<FsBytes>;
  function read(path: string, options: FsReadOptions): Promise<string | FsBytes>;
  async function read(path: string, options?: FsReadOptions): Promise<string | FsBytes> {
    const target = at(path);
    const info = await stat(target);
    if (info.size > MAX_READ_BYTES) throw new Error(`${target} is over the ${MAX_READ_BYTES}-byte bound of one read`);
    const bytes = await readFile(target);
    return options?.as === "bytes" ? { base64: bytes.toString("base64") } : bytes.toString("utf8");
  }
  const write = async (path: string, text: string) => {
    const target = at(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
  };
  const list = async (path?: string): Promise<FsEntry[]> => {
    const dir = at(path ?? ".");
    const names = (await readdir(dir)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries: FsEntry[] = [];
    for (const name of names) {
      let info;
      try {
        info = await lstat(join(dir, name));
      } catch (err) {
        // An entry removed since the listing is no longer there.
        if (codeOf(err) === "ENOENT") continue;
        throw err;
      }
      const file = info.isFile();
      entries.push({ name, kind: file ? "file" : info.isDirectory() ? "dir" : "other", size: file ? info.size : 0, mtimeMs: file ? info.mtimeMs : 0, isLink: info.isSymbolicLink() });
    }
    return entries;
  };
  // Answers false for a path that is not there, and rejects only a network
  // location, as the engine's does.
  const exists = async (path: string) => {
    const target = at(path);
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  };
  const statOf = async (path: string, options?: FsStatOptions): Promise<FsStat> => {
    const target = at(path);
    const own = await lstat(target);
    let led = own;
    let leadsNowhere = false;
    if (own.isSymbolicLink()) {
      try {
        led = await stat(target);
      } catch {
        leadsNowhere = true;
      }
    }
    const kind = leadsNowhere ? "other" : led.isFile() ? "file" : led.isDirectory() ? "dir" : "other";
    const result: FsStat = { kind, size: led.size, mtimeMs: led.mtimeMs, isLink: own.isSymbolicLink() };
    if (options?.resolve && !leadsNowhere) {
      try {
        result.realPath = await realpath(target);
      } catch {
        // where it lands could not be read, so realPath stays absent
      }
    }
    return result;
  };
  return { read, write, list, exists, stat: statOf } satisfies Pick<EngineHandle["fs"], "read" | "write" | "list" | "exists" | "stat">;
}

// The name in the plugin's manifest.
function manifestName(pluginRoot: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
  const name = isRecord(manifest) ? manifest.name : undefined;
  if (typeof name !== "string" || name === "") throw new Error(`the manifest under ${pluginRoot} names no plugin`);
  return name;
}

// A handle object whose every read of a property it lacks is logged once.
function logAbsent<T extends object>(target: T, prefix: string, logOnce: (verb: string, subject: string) => void): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      // `then` is read by anything that awaits the object, and is no call.
      if (typeof property === "string" && property !== "then" && !(property in object)) logOnce("absent", prefix === "" ? property : `${prefix}.${property}`);
      return Reflect.get(object, property, receiver);
    },
  });
}

export function createHandle(deps: HandleDeps): EngineHandle {
  const log = engineLog(deps.childFolder);
  const logged = new Set<string>();
  const logOnce = (verb: string, subject: string) => {
    const key = `${verb}\t${subject}`;
    if (logged.has(key)) return;
    logged.add(key);
    log(verb, subject);
  };
  const timerMessages = new Set<string>();
  const store = fileStoreOf(deps.storeFile);
  const state = engineState(deps.childFolder);
  const files = fileMembers(deps.cwd);
  const pluginName = manifestName(deps.pluginRoot);

  // A refused tool.call is named by the tool it was asked for.
  const refusedMember = (name: string) => async (...args: unknown[]): Promise<never> => {
    const tool = name === "tool.call" && isRecord(args[0]) && typeof args[0].tool === "string" ? args[0].tool : undefined;
    logOnce("refused", tool === undefined ? name : `${name} ${tool}`);
    throw notServed(name);
  };
  const unfilledMember = (name: string) => async (): Promise<never> => {
    logOnce("unfilled", name);
    throw notServed(name);
  };
  // An adapter member's body, which rejects with notServed's error where the
  // adapter does not answer: that rejection is logged as unfilled, once.
  const adapterMember = (name: string, body: (...args: never[]) => Promise<unknown>) => async (...args: never[]): Promise<unknown> => {
    try {
      return await body(...args);
    } catch (err) {
      if (err instanceof Error && notServedErrors.has(err)) logOnce("unfilled", name);
      throw err;
    }
  };

  const node: Partial<Members> = {
    "plugin.name": pluginName,
    "plugin.root": deps.pluginRoot,
    "session.cwd": async () => deps.cwd,
    "session.id": async () => deps.sessionId,
    "fs.read": files.read,
    "fs.write": files.write,
    "fs.list": files.list,
    "fs.exists": files.exists,
    "fs.stat": files.stat,
    "clock.sleep": (ms, options) => new Promise<void>((done, fail) => {
      const signal = options?.signal;
      if (signal?.aborted) {
        fail(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        fail(signal?.reason);
      };
      // Held to the longest delay a node timer takes, since a longer one
      // fires at once.
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        done();
      }, Math.min(ms, TIMER_MAX_MS));
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
    // A finite interval runs every `ms` milliseconds, at least 1, as the
    // engine's declaration says. A value that is not a finite number is
    // refused, since node would run it every millisecond. A callback that
    // throws or rejects is the plugin's, and must not end the stand-in, so
    // the interval goes on and each distinct failure is logged once, up to
    // TIMER_MESSAGES_MAX of them. The line names the error's code where it
    // has a string one, and never the error's message, which may quote what
    // the callback read.
    "clock.every": (ms, fn): Timer => {
      if (typeof ms !== "number" || !Number.isFinite(ms)) throw new TypeError("clock.every takes a finite number of milliseconds");
      const failed = (err: unknown) => {
        if (timerMessages.size >= TIMER_MESSAGES_MAX) return;
        const code = codeOf(err);
        const message = typeof code === "string" ? `a clock.every callback failed (${code.slice(0, TIMER_MESSAGE_CHARS)})` : "a clock.every callback failed";
        timerMessages.add(message);
        logOnce("timer", message);
      };
      const interval = setInterval(() => {
        try {
          Promise.resolve(fn() as unknown).catch(failed);
        } catch (err) {
          failed(err);
        }
      }, Math.max(1, ms));
      return { cancel: () => clearInterval(interval) };
    },
    "env.get": async (name: string) => {
      if (ENV_NAMES.has(name)) return process.env[name];
      logOnce("unset", String(name));
      return undefined;
    },
    "process.run": async (argv: readonly string[], init: ProcessRunInit = {}) => {
      if (!Array.isArray(argv) || argv.length === 0 || argv.some((arg) => typeof arg !== "string")) throw new TypeError("process.run takes a non-empty list of strings");
      const env = childEnvOf(process.env, init.env);
      const program = await programOf(argv[0], pathOf(env));
      const requested = init.timeoutMs ?? RUN_TIMEOUT_MS;
      const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, RUN_TIMEOUT_MAX_MS) : RUN_TIMEOUT_MS;
      return runProgram(program, [...pinsFor(program), ...argv.slice(1)], resolve(deps.cwd, init.cwd ?? "."), env, init.stdin, timeoutMs);
    },
    "http.fetch": async (url: string, init: HttpInit = {}): Promise<HttpResponse> => {
      const target = fetchTargetOf(String(url));
      if (!target.ok) {
        logOnce("refused", `http.fetch to ${target.host}`);
        throw notServed(`http.fetch to ${target.host}`);
      }
      // A credential handle and a socket path are the engine's own, and a body
      // that is not text only an engine request carries.
      if (init.auth !== undefined || init.socketPath !== undefined || (init.body !== undefined && typeof init.body !== "string")) {
        logOnce("refused", "http.fetch with auth, socketPath or a body that is not text");
        throw notServed("http.fetch with auth, socketPath or a body that is not text");
      }
      // The time bound covers the body's read too, so a stalled endpoint ends
      // the call rather than holding it open.
      const response = await fetch(target.url, { method: init.method ?? "GET", headers: init.headers, body: init.body, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      return { status: response.status, ok: response.ok, headers, text: await response.text() };
    },
    "store.get": (key) => store.get(key),
    "store.keys": () => store.keys(),
    // A write that landed resolves; one whose lock directory stays is logged,
    // and never tried again, since a second try would write twice.
    "store.set": async (key, value) => {
      const result = await store.set(key, value);
      if (!result.lockReleased) log("store", `store.set ${key}: the write landed and its lock directory stays`);
      if (!result.written) throw new Error(`store.set ${key}: nothing was written`);
    },
    // A delete of an absent key writes nothing and resolves, as the engine's does.
    "store.delete": async (key) => {
      const result = await store.delete(key);
      if (!result.lockReleased) log("store", `store.delete ${key}: ${result.written ? "the delete landed" : "the key was absent and nothing was written"}, and its lock directory stays`);
    },
  };

  const own: Partial<Members> = {
    "state.get": state.get,
    "state.set": state.set,
    "ui.log": (text) => log("log", String(text)),
    "ui.toast": (text) => log("toast", String(text)),
    "ui.status": (text) => log("status", text === undefined ? "" : String(text)),
    "ui.notice": (toolUseId, text) => log("notice", `${toolUseId} ${text ?? ""}`),
  };
  const bodies: Partial<Members> = deps.bodies ?? {};

  const nouns: Record<string, Record<string, unknown>> = {};
  for (const row of POLICY) {
    if (row.kind !== "call") continue;
    const name = row.name as MemberName;
    const dot = name.indexOf(".");
    let member: unknown;
    if (row.answer === "refused") member = refusedMember(name);
    else if (row.answer === "node") member = node[name];
    else if (row.answer === "adapter" && bodies[name] !== undefined) member = adapterMember(name, bodies[name] as (...args: never[]) => Promise<unknown>);
    else member = own[name] ?? bodies[name] ?? unfilledMember(name);
    if (member === undefined) throw new Error(`the policy row ${name} is answered ${row.answer} and the handle has no body for it`);
    (nouns[name.slice(0, dot)] ??= {})[name.slice(dot + 1)] = member;
  }
  const handle: Record<string, unknown> = {};
  for (const [noun, members] of Object.entries(nouns)) handle[noun] = logAbsent(Object.freeze(members), noun, logOnce);
  // The one cast left: the handle's nouns are placed by the policy rows at run
  // time, which the type system cannot follow. Every member placed came from
  // a map typed Partial<Members> or is a refusal that only rejects, so a
  // signature change in the declaration still fails the check at those maps.
  return logAbsent(Object.freeze(handle), "", logOnce) as EngineHandle;
}
