// relay-adapter.ts: the Channels relay's hook events, posted by this module
// under the `plugin` hook owner. A watched session's launch wrapper sets
// CHANNEL_PROCESS_TOKEN, CHANNEL_SESSION, CHANNEL_LINEAGE and
// CHANNEL_SESSION_MIRROR, and under the `settings` owner five entries in the
// user settings file post SessionStart, UserPromptSubmit, PostToolUse and
// both Stop entries to the broker on loopback port 8787 (the Channels
// repository's hooks/settings-fragment.json and hooks/session-start.ps1).
// This module posts the same five, in the same shape, where the relayAdapter
// option reads `live` and the token is set, so a host whose installer removed
// those five entries is announced, ticks, mirrors and spools as before. The
// PreToolUse question hold is not taken: the module's fetch gives up at 30
// seconds and the hold needs hours, so it stays a settings hook.
//
// Each post is the event `e` serialized as JSON, its own fields and nothing
// derived, with the entry's method, path and headers: X-Channel-Hook-Event,
// X-Channel-Process-Token and X-Channel-Session-Name on every post,
// X-Channel-Lineage on SessionStart where the variable is set, and
// X-Channel-Mirror on the two mirror posts, empty where the variable is
// unset, which the broker reads as mirroring on. A session name or lineage
// outside printable ASCII is dropped from the headers as the script drops
// it, and the post still goes.
//
// The fetch takes no timeout, so each post is raced against a sleep of the
// entry's figure: 2 seconds for the liveness entries, 9 for the mirror
// entries in place of their settings figure of 10, since a `$.clock` wait
// spends the hook's own 10 second dispatch budget while the fetch does not,
// and 3 seconds per attempt for SessionStart, which retries once on a
// timeout alone, as the script does. The hook serializes `e`, starts the
// posts, and runs next(e) beside them. It then waits out the race, since a
// post the hook abandons before it settles is lost when the process exits,
// and returns next's result in every case. A throw from next comes back out
// after the wait. A race the sleep wins abandons the post, which runs on to
// the engine's own end. Its handlers are attached before the race, so its
// late settlement produces one debug line and no unhandled rejection. A race
// the post wins aborts the sleep, so no timer runs on against the budget.
//
// A SessionStart no attempt delivered is spooled where the broker's state
// folder exists, as the script spools it: to
// %LOCALAPPDATA%\sapplefeld-channels\announce\<sha256 hex of the token>.announce,
// the header block in the script's order, an empty line, then the body
// bytes. The seam offers no rename, so the file is written under its final
// name rather than moved into place. A `startup` announcement never replaces
// a file already under its token, since a second startup under one token is
// a subprocess the broker declines, and any other source replaces it.
//
// The double-post guard reads the user settings once, on the first of the
// adapter's events to fire, and skips for the session each of its five
// entries that a settings hook still posts: an http entry whose
// X-Channel-Hook-Event value and URL path equal the adapter entry's, or for
// SessionStart a command whose text ends session-start.ps1. So a machine on
// the `settings` owner with the option `live` posts nothing twice.
//
// The process token reaches one place, the X-Channel-Process-Token header.
// It is in no debug line, no thrown message and no file name: the debug log
// carries each attempt's class alone, never an error's text or a body byte,
// every failure is caught before the hook returns, and the spool's name is
// the token's hash. No `import $`: this module takes a RelayHost, a Pick of
// the PluginHost hooks/index.ts builds over `$` in its top-level hostOf.

import type { PluginHost } from "./host";
import { nudgeSha256Hex } from "./recognition";

export type RelayHost = Pick<
  PluginHost,
  | "fetch"
  | "sleep"
  | "writeFile"
  | "fileExists"
  | "readUserSettings"
  | "logDebug"
  | "getChannelProcessToken"
  | "getChannelSession"
  | "getChannelLineage"
  | "getChannelSessionMirror"
  | "getLocalAppData"
>;

// The broker's origin, the literal every settings entry carries. The port is
// pinned in the Channels repository against broker/config.ts, and a post into
// a port nothing listens on fails silently, so the fixture suite pins this
// origin against every URL of the fragment's five entries.
export const BROKER_ORIGIN = "http://127.0.0.1:8787";

// The race figures. The liveness figure is the fragment's 2 second timeout.
// The mirror figure is 9 seconds in place of the fragment's 10, since the
// sleep spends the hook's 10 second budget and the hook's own code needs the
// rest. SessionStart takes the script's two attempts of 3 seconds each.
export const LIVENESS_RACE_MS = 2_000;
export const MIRROR_RACE_MS = 9_000;
export const SESSION_START_ATTEMPT_MS = 3_000;
export const SESSION_START_ATTEMPTS = 2;

// The broker's state folder under %LOCALAPPDATA% and the spool folder under
// it, as hooks/session-start.ps1 names them.
export const STATE_FOLDER = "sapplefeld-channels";
export const ANNOUNCE_FOLDER = "announce";

export type RelayEvent = "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "Stop";
export type RelayPath = "/hook" | "/mirror";

export type RelayEntry = {
  // The classic event, the X-Channel-Hook-Event value and the settings key.
  readonly event: RelayEvent;
  readonly path: RelayPath;
  // Whether the post carries X-Channel-Mirror, as the two mirror entries do.
  readonly mirror: boolean;
  // The capture's Content-Type: the script sends the charset form, the http
  // entries the bare one.
  readonly contentType: string;
  readonly raceMs: number;
};

// The five entries, in the fragment's order. Stop has two, the liveness post
// on /hook and the mirror post on /mirror, posted together.
export const RELAY_ENTRIES: readonly RelayEntry[] = [
  { event: "SessionStart", path: "/hook", mirror: false, contentType: "application/json; charset=utf-8", raceMs: SESSION_START_ATTEMPT_MS },
  { event: "PostToolUse", path: "/hook", mirror: false, contentType: "application/json", raceMs: LIVENESS_RACE_MS },
  { event: "UserPromptSubmit", path: "/mirror", mirror: true, contentType: "application/json", raceMs: MIRROR_RACE_MS },
  { event: "Stop", path: "/hook", mirror: false, contentType: "application/json", raceMs: LIVENESS_RACE_MS },
  { event: "Stop", path: "/mirror", mirror: true, contentType: "application/json", raceMs: MIRROR_RACE_MS },
];

// An entry's name in a debug line: the event and the path, which together
// name one of the five.
export function relayEntryLabel(entry: RelayEntry): string {
  return `${entry.event} ${entry.path}`;
}

export type RelayAdapterOption = "off" | "live";

// The option as plugin.json declares it: the exact string `live` is live, and
// any other value is off.
export function relayAdapterOptionOf(value: unknown): RelayAdapterOption {
  return value === "live" ? "live" : "off";
}

export type RelayAdapter = {
  readonly option: RelayAdapterOption;
  // The one hook body, registered on each of the four classic events in
  // hooks/index.ts. Posts the event's entries beside next(e) where the
  // option is live and the token is set, and returns next's result in every
  // case.
  hook<E extends object, R>(host: RelayHost, event: RelayEvent, e: E, next: (e: E) => Promise<R>): Promise<R>;
};

export function relayAdapterOf(value: unknown): RelayAdapter {
  const option = relayAdapterOptionOf(value);
  // The guard's reading, started on the first event to fire and shared by
  // every later one, so the settings are read once per session.
  let skipped: Promise<Set<string>> | null = null;
  // The adapter's own work for one event: the token, the guard and the
  // posts. It never rejects, so waiting it out cannot change next's result.
  const relay = async (host: RelayHost, event: RelayEvent, body: string | null): Promise<void> => {
    try {
      const token = await host.getChannelProcessToken();
      if (typeof token === "string" && token.trim() !== "") {
        if (skipped === null) skipped = settingsSkips(host);
        await postEvent(host, event, body, token, await skipped);
      }
    } catch {
      // A post changes nothing about the session: whatever failed here,
      // the event goes on as it came. The line names the event and not the
      // error, whose text the adapter does not control.
      debug(host, `${event} not relayed, a read it needs failed`);
    }
  };
  // The body is serialized before next runs, so the links beneath cannot
  // change what the post carries. The posts run beside next, and the hook
  // waits out their race before it returns next's result, or re-raises
  // next's throw.
  const hook = async <E extends object, R>(host: RelayHost, event: RelayEvent, e: E, next: (e: E) => Promise<R>): Promise<R> => {
    const posting = option === "live" ? relay(host, event, bodyOf(e)) : null;
    try {
      return await next(e);
    } finally {
      if (posting !== null) await posting;
    }
  };
  return { option, hook };
}

// The event as JSON, or null where it does not serialize.
function bodyOf(e: object): string | null {
  try {
    const body = JSON.stringify(e);
    return typeof body === "string" ? body : null;
  } catch {
    return null;
  }
}

// --- The settings guard ---

// The settings entries' command shape, by its invocation's tail: the
// installer recognizes the entry the same way, by a -File path ending in
// session-start.ps1, inside the quotes the fragment writes.
const SESSION_START_SCRIPT = /session-start\.ps1["']?\s*$/i;

// The labels of the adapter entries a settings hook still posts, each named
// in one debug line. A settings read that fails, or holds no hooks object,
// skips nothing: the option is turned on by hand on a host whose entries were
// removed, and a read failure must not silence the announcement there.
async function settingsSkips(host: RelayHost): Promise<Set<string>> {
  const skips = new Set<string>();
  let settings: unknown;
  try {
    settings = await host.readUserSettings();
  } catch {
    debug(host, "the user settings could not be read, so every entry posts");
    return skips;
  }
  const hooks = isRecord(settings) ? settings.hooks : undefined;
  if (!isRecord(hooks)) return skips;
  for (const entry of RELAY_ENTRIES) {
    if (!settingsPosts(hooks, entry)) continue;
    skips.add(relayEntryLabel(entry));
    debug(host, `${relayEntryLabel(entry)} is posted by a settings hook and is skipped for this session`);
  }
  return skips;
}

// Whether the settings file's `hooks` object holds an entry posting what
// `entry` posts: under the entry's event, an http hook whose
// X-Channel-Hook-Event header equals the event and whose URL path equals the
// entry's path, or for SessionStart a command hook naming the script. A
// header value that matches under a URL whose path differs is another
// route's entry, and the adapter's post goes.
export function settingsPosts(hooks: Record<string, unknown>, entry: RelayEntry): boolean {
  const groups = hooks[entry.event];
  if (!Array.isArray(groups)) return false;
  for (const group of groups) {
    const list = isRecord(group) ? group.hooks : undefined;
    if (!Array.isArray(list)) continue;
    for (const declared of list) {
      if (!isRecord(declared)) continue;
      if (entry.event === "SessionStart" && declared.type === "command" && typeof declared.command === "string" && SESSION_START_SCRIPT.test(declared.command)) {
        return true;
      }
      if (declared.type !== "http" || typeof declared.url !== "string") continue;
      if (urlPathOf(declared.url) !== entry.path) continue;
      if (headerValueOf(declared.headers, "X-Channel-Hook-Event") === entry.event) return true;
    }
  }
  return false;
}

// The path of an absolute http URL, `/` where it names none, and null for a
// value that is no such URL. A pattern rather than the URL class, so the
// read depends on nothing the plugin's runtime might not provide.
function urlPathOf(url: string): string | null {
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/.exec(url);
  if (m === null) return null;
  return m[1] === undefined || m[1] === "" ? "/" : m[1];
}

// A header's value from a settings entry's headers object, by name without
// case, as HTTP reads names; undefined where absent or not a string.
function headerValueOf(headers: unknown, name: string): string | undefined {
  if (!isRecord(headers)) return undefined;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const value = headers[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

// --- The posts ---

// The identity a session's environment gives the headers. The token is read
// by the hook; the name and lineage pass the script's printable-ASCII gate
// or are dropped; the mirror value is sent as set and empty where unset or
// outside that gate, which the broker reads as mirroring on.
type Identity = {
  readonly token: string;
  readonly sessionName: string | null;
  readonly lineage: string | null;
  readonly mirror: string;
};

// The script's gate: every character in 0x20 to 0x7E and at least one, or
// the value is dropped from the headers. `$` here matches only at the end of
// the input, so a value ending in a newline fails as it does under the
// script's \z.
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

export function printableAsciiOrNull(value: unknown): string | null {
  return typeof value === "string" && PRINTABLE_ASCII.test(value) ? value : null;
}

async function identityOf(host: RelayHost, token: string, entries: readonly RelayEntry[]): Promise<Identity> {
  const sessionName = printableAsciiOrNull(await host.getChannelSession());
  const lineage = entries.some((entry) => entry.event === "SessionStart") ? printableAsciiOrNull(await host.getChannelLineage()) : null;
  const mirror = entries.some((entry) => entry.mirror) ? printableAsciiOrNull(await host.getChannelSessionMirror()) ?? "" : "";
  return { token, sessionName, lineage, mirror };
}

// One entry's request headers, the capture's names: the token on every
// post, the name where it passed the gate, the lineage on SessionStart alone
// where it passed, and the mirror switch on the two mirror entries.
export function relayHeadersOf(entry: RelayEntry, identity: Identity): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": entry.contentType,
    "X-Channel-Hook-Event": entry.event,
    "X-Channel-Process-Token": identity.token,
  };
  if (identity.sessionName !== null) headers["X-Channel-Session-Name"] = identity.sessionName;
  if (entry.event === "SessionStart" && identity.lineage !== null) headers["X-Channel-Lineage"] = identity.lineage;
  if (entry.mirror) headers["X-Channel-Mirror"] = identity.mirror;
  return headers;
}

// Posts every entry of the event the guard left standing, the two Stop
// entries together so their races overlap rather than add. The body is `e`
// as JSON and nothing else, serialized as the hook was entered. An event that
// does not serialize posts nothing.
async function postEvent(host: RelayHost, event: RelayEvent, body: string | null, token: string, skips: ReadonlySet<string>): Promise<void> {
  const entries = RELAY_ENTRIES.filter((entry) => entry.event === event && !skips.has(relayEntryLabel(entry)));
  if (entries.length === 0) return;
  if (body === null) return;
  const identity = await identityOf(host, token, entries);
  await Promise.all(entries.map((entry) => (
    entry.event === "SessionStart" ? announce(host, entry, identity, body) : postOnce(host, entry, identity, body)
  )));
}

async function postOnce(host: RelayHost, entry: RelayEntry, identity: Identity, body: string): Promise<void> {
  const label = relayEntryLabel(entry);
  const outcome = await attempt(host, entry, identity, body, entry.raceMs, label);
  if (outcome !== "delivered") debug(host, `${label} ${outcome}`);
}

// SessionStart: the script's loop. A timeout is tried once more, since a
// broker that is up but slow usually answers the second attempt and a
// repeated announcement is a refresh. Any other class ends the loop after one
// attempt, since it would fail the same way again. Nothing announced spools.
async function announce(host: RelayHost, entry: RelayEntry, identity: Identity, body: string): Promise<void> {
  const label = relayEntryLabel(entry);
  for (let n = 1; n <= SESSION_START_ATTEMPTS; n++) {
    const outcome = await attempt(host, entry, identity, body, SESSION_START_ATTEMPT_MS, `${label} attempt ${n}`);
    if (outcome === "delivered") {
      if (n > 1) debug(host, `${label} announced on attempt ${n}`);
      return;
    }
    debug(host, `${label} attempt ${n} ${outcome}`);
    if (outcome !== "timeout") break;
  }
  await spool(host, identity, body);
}

// One attempt's class: delivered, timeout, network, no response, or
// `status <n>`. Each is a word of this module's own, never an error's text,
// so a line built from one can carry no token and no body byte.
type AttemptClass = string;

// One post raced against its sleep. The request's handlers are attached as
// it is made, so a request abandoned by the race can neither reject out of
// anything nor touch the hook's result, and its late settlement produces the
// one debug line below. When the request wins, the sleep is aborted: a
// `$.clock` wait is the one engine call a hook's dispatch budget runs
// through, so a sleep left to run its course would spend that budget for
// nothing. A sleep the host cannot start reads as fired, so no post is ever
// unbounded.
async function attempt(host: RelayHost, entry: RelayEntry, identity: Identity, body: string, raceMs: number, label: string): Promise<AttemptClass> {
  const request: Promise<AttemptClass> = Promise.resolve()
    .then(() => host.fetch(BROKER_ORIGIN + entry.path, { method: "POST", headers: relayHeadersOf(entry, identity), body }))
    .then(responseClass, rejectionClass);
  const stop = new AbortController();
  const timer: Promise<AttemptClass> = Promise.resolve()
    .then(() => host.sleep(raceMs, stop.signal))
    .then(() => "timeout", () => "timeout");
  let outcome: AttemptClass;
  try {
    outcome = await Promise.race([request, timer]);
  } finally {
    stop.abort();
  }
  if (outcome === "timeout") {
    void request.then((late) => debug(host, `${label} settled after its race: ${late}`));
  }
  return outcome;
}

// An integer status in 200 to 299 is delivered, any other integer is its
// status, and a response with no integer status, a non-object among them, is
// no response. Every host call is an op event a co-loaded hook may answer
// with a value of its own, so the members are read under a guard.
function responseClass(res: unknown): AttemptClass {
  try {
    if (!isRecord(res)) return "no response";
    const status = res.status;
    if (typeof status !== "number" || !Number.isInteger(status)) return "no response";
    return status >= 200 && status <= 299 ? "delivered" : `status ${status}`;
  } catch {
    return "no response";
  }
}

// A rejected fetch is a network failure, whatever it threw: the value is not
// read, since a host error can echo the request it was made with.
function rejectionClass(): AttemptClass {
  return "network";
}

// --- The spool ---

// The spool's text: the header block in the script's fixed order, each line
// ending in a line feed, one empty line, then the body verbatim. The token's
// header is not written, and the block is ASCII since each value passed the
// gate, so the UTF-8 the seam writes equals the bytes the broker's
// splitSpool reads, latin1 for the block and UTF-8 for the body.
export function spoolText(identity: { readonly sessionName: string | null; readonly lineage: string | null }, body: string): string {
  let block = "X-Channel-Hook-Event: SessionStart\n";
  if (identity.sessionName !== null) block += `X-Channel-Session-Name: ${identity.sessionName}\n`;
  if (identity.lineage !== null) block += `X-Channel-Lineage: ${identity.lineage}\n`;
  return `${block}\n${body}`;
}

// The spool file's path under the broker's state folder, or null where the
// root is unknown. The name is the token's SHA-256 hex, so neither the name
// nor the content carries the token.
export function spoolPathOf(localAppData: string | undefined, token: string): string | null {
  if (typeof localAppData !== "string" || localAppData === "") return null;
  return `${localAppData}\\${STATE_FOLDER}\\${ANNOUNCE_FOLDER}\\${nudgeSha256Hex(token)}.announce`;
}

// Writes the announcement the loop could not deliver, where the state root
// exists; a root the installer never made means no spool, as in the script.
// A `startup` announcement keeps a file already under its token; any other
// source, and a body whose source cannot be read, replaces it. The source is
// read from the body, the event as the hook was entered. The write lands
// under the final name directly, since the seam has no rename. A failed read
// or write says so in its own line, never the error's text.
async function spool(host: RelayHost, identity: Identity, body: string): Promise<void> {
  let file: string | null;
  try {
    file = await spoolTarget(host, identity, body);
  } catch {
    debug(host, "SessionStart /hook announcement not spooled, a read failed");
    return;
  }
  if (file === null) return;
  try {
    await host.writeFile(file, spoolText(identity, body));
  } catch {
    debug(host, "SessionStart /hook announcement not spooled, the write failed");
    return;
  }
  debug(host, "SessionStart /hook announcement spooled");
}

// The spool file to write, or null where nothing is written, each null
// logged.
async function spoolTarget(host: RelayHost, identity: Identity, body: string): Promise<string | null> {
  const localAppData = await host.getLocalAppData();
  const file = spoolPathOf(localAppData, identity.token);
  if (file === null) {
    debug(host, "SessionStart /hook announcement not spooled, no broker state folder");
    return null;
  }
  if (!(await host.fileExists(`${localAppData}\\${STATE_FOLDER}`))) {
    debug(host, "SessionStart /hook announcement not spooled, no broker state folder");
    return null;
  }
  if (sourceOf(body) === "startup" && (await host.fileExists(file))) {
    debug(host, "SessionStart /hook earlier announcement kept");
    return null;
  }
  return file;
}

// The serialized event's `source` where it is a string, else null.
function sourceOf(body: string): string | null {
  const e: unknown = JSON.parse(body);
  const source = isRecord(e) ? e.source : undefined;
  return typeof source === "string" ? source : null;
}

// --- Helpers ---

// One line to the debug log, never awaited by a post's path and never a
// rejection: a log the host refuses changes nothing.
function debug(host: RelayHost, text: string): void {
  void Promise.resolve()
    .then(() => host.logDebug(`relay adapter: ${text}`))
    .catch(() => undefined);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
