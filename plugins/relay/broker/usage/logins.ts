// The login watch: when each of the host's Claude accounts needs a fresh login, taken from
// claude-swap's own `cswap list --json` and from nothing else.
//
// The expiry instant lives inside each account's saved login, in the folder that holds the login
// secrets, and this broker never opens that folder. claude-swap publishes the instant through its
// list command, so the broker runs that one command and keeps one fact per account: the account
// number and the instant. Every other field the command prints, the address among them, is dropped
// unread and never logged, because the map feeds a Discord message.
//
// Running the command adds no usage request of the broker's own: claude-swap paces every surface
// through its usage store's persisted poll plans, so a `cswap list` every 30 minutes behaves on the
// network as claude-swap's own console does. What claude-swap does inside the command, a token
// refresh among it, is claude-swap's own behavior.
//
// The child process is the boundary this module guards, in four ways. The executable is a fixed
// path under the operator's profile and never a `PATH` lookup, so a planted `cswap` earlier on
// `PATH` is never run. The command is an argument array with no shell. The child's environment is
// built from an allowlist of the names claude-swap and the platform need, so no broker secret, such
// as a Discord token or a door key path, is handed to another program. And the call is bounded in
// time and in output, with stderr never read, since another program's error text can carry
// anything.
//
// A failed run keeps the last good map, as the usage card keeps the last readable reading, and a
// map with no good run in 24 hours reads as empty, so a host that loses claude-swap stops warning on
// a date it can no longer confirm.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { span } from "../discord/render.ts";
import { createRepeatLog } from "../repeat-log.ts";
import type { RepeatLogSurface } from "../repeat-log.ts";
import { MAX_USAGE_ACCOUNTS } from "./cache.ts";

/** How often the watch runs claude-swap's list command. */
export const LOGIN_REFRESH_MS = 30 * 60 * 1000;

/**
 * How close to its expiry a login is before it is named: claude-swap's own `LOGIN_DUE_WITHIN_S`,
 * so the card and claude-swap's console start warning on the same day.
 */
export const LOGIN_DUE_WITHIN_MS = 7 * 86_400_000;

/** How long a map stands without a good run before it reads as empty. */
export const LOGIN_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How long one run may take before it is ended and counted as failed. claude-swap's own lock waits
 * and network limits allow one account about 36 seconds, and a run ended between a token renewal
 * and its save can cost the account its login, so the bound leaves room past that. Runs are 30
 * minutes apart, so a slow run delays nothing.
 */
const RUN_TIMEOUT_MS = 120_000;

/**
 * The most output one run may print. The list prints one object of a few hundred bytes per account,
 * so the cap leaves 16 KiB for each of the 16 accounts read while bounding what another program can
 * make the broker hold.
 */
const RUN_MAX_BYTES = 256 * 1024;

/** The one command the watch runs. */
const LIST_ARGS: readonly string[] = ["list", "--json"];

/**
 * The names the child's environment may hold: the profile and data folders claude-swap's
 * `paths.py` reads to find its files (`CLAUDE_CONFIG_DIR`, `CLAUDE_SECURESTORAGE_CONFIG_DIR` and
 * `XDG_DATA_HOME` among them), and what a Windows or POSIX program needs to start at all.
 */
const CHILD_ENV_NAMES: readonly string[] = [
  "USERPROFILE",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERNAME",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "XDG_DATA_HOME",
];

/**
 * An expiry as claude-swap prints it: ISO-8601 in UTC with the `Z` suffix. Anything else, an offset
 * or a date with no time among them, is not read, since `Date.parse` reads a date-time with no
 * offset as local time.
 */
const EXPIRY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * The `usageStatus` claude-swap prints for an account whose login is dead and which it holds out of
 * rotation until someone logs in again (its `USAGE_RELOGIN_REQUIRED`). Its console shows `re-login
 * needed` for such an account in place of any countdown.
 */
const RELOGIN_REQUIRED = "relogin_required";

/**
 * Why a run yielded no map. Static words, safe to log: `spawn` is a child that could not start, the
 * executable missing among it; `timeout` a child ended at the time bound; `oversized` output past
 * the cap; `exit` a non-zero exit or an exit by signal; `malformed` output that is not JSON; and
 * `shape` JSON without an `accounts` array.
 */
export type LoginFailure = "spawn" | "timeout" | "oversized" | "exit" | "malformed" | "shape";

const RUN_FAILURES: ReadonlySet<string> = new Set(["spawn", "timeout", "oversized", "exit"]);

/**
 * One run of the executable with the given arguments, resolving to its stdout or rejecting with an
 * error whose message is a `LoginFailure` kind. `runCswap` is production's; a test hands in a runner
 * that spawns nothing.
 */
export type LoginRunner = (file: string, args: readonly string[]) => Promise<string>;

/**
 * The environment the child runs under: only the allowlisted names `env` holds, each under the
 * spelling `env` gives it. Windows reads variable names without regard to case, so there the match
 * is case-insensitive and a `Path` or `SystemRoot` is kept; elsewhere it is exact.
 */
export function cswapChildEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const fold = platform === "win32";
  const allowed = new Set(fold ? CHILD_ENV_NAMES.map((name) => name.toUpperCase()) : CHILD_ENV_NAMES);
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && allowed.has(fold ? name.toUpperCase() : name)) child[name] = value;
  }
  return child;
}

/**
 * The kind of a failed `execFile` call. The error's message is never read: Node builds it from the
 * command and the child's stderr.
 */
function runFailure(error: unknown): LoginFailure {
  const failed = error as { code?: unknown; killed?: unknown; signal?: unknown } | null;
  if (failed?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "oversized";
  if (failed?.killed === true) return "timeout";
  if (typeof failed?.code === "string") return "spawn";
  return "exit";
}

/**
 * Runs `file` with `args` and no shell, hidden, under `cswapChildEnv(env)`, bounded at 120 seconds
 * and 256 KiB of output on either stream. Resolves to stdout where the child exits 0, and rejects
 * otherwise with an error whose message is the failure's kind alone. Stderr is buffered by
 * `execFile` against the same cap and discarded unread.
 */
export function runCswap(file: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: RUN_TIMEOUT_MS,
        maxBuffer: RUN_MAX_BYTES,
        env: cswapChildEnv(env),
      },
      (error, stdout) => {
        if (error === null) resolve(stdout);
        else reject(new Error(runFailure(error)));
      },
    );
  });
}

/**
 * Where claude-swap's command is installed as a uv tool: `.local/bin` under the operator's profile,
 * `cswap.exe` on Windows and `cswap` elsewhere. A fixed path rather than a `PATH` lookup, so a
 * planted `cswap` earlier on `PATH` is never run; a host that installs claude-swap elsewhere gets no
 * warning.
 */
export function defaultCswapPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return path.win32.join(env.USERPROFILE ?? os.homedir(), ".local", "bin", "cswap.exe");
  return path.posix.join(env.HOME ?? os.homedir(), ".local", "bin", "cswap");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The expiry instants in one run's output, by account number, or why there are none.
 *
 * Only the first `MAX_USAGE_ACCOUNTS` entries of the `accounts` array are read, in array order. Of
 * each, only `number`, as a positive whole number, `usageStatus`, compared to one exact string, and
 * `loginExpiresAt`, as an `EXPIRY` string with a finite `Date.parse`, are read. An entry whose
 * `usageStatus` is exactly `relogin_required` is an account claude-swap has quarantined because its
 * login is dead, so its instant is the epoch, already past, whatever `loginExpiresAt` holds or
 * whether it holds anything: the card then says `re-login needed`, as claude-swap's console does.
 * Any other entry without a readable instant contributes nothing, and a number seen twice keeps its
 * first instant. The parse error is discarded unread, since V8 embeds an excerpt of the source in
 * its message.
 */
function parseLogins(output: string): Map<number, number> | LoginFailure {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return "malformed";
  }
  if (!isRecord(value) || !Array.isArray(value["accounts"])) return "shape";
  const logins = new Map<number, number>();
  for (const entry of value["accounts"].slice(0, MAX_USAGE_ACCOUNTS)) {
    if (!isRecord(entry)) continue;
    const number = entry["number"];
    const expiry = entry["loginExpiresAt"];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) continue;
    if (logins.has(number)) continue;
    if (entry["usageStatus"] === RELOGIN_REQUIRED) {
      logins.set(number, 0);
      continue;
    }
    if (typeof expiry !== "string" || !EXPIRY.test(expiry)) continue;
    const at = Date.parse(expiry);
    if (!Number.isFinite(at)) continue;
    logins.set(number, at);
  }
  return logins;
}

/**
 * How long one failure kind waits before it is logged again. Wider than the refresh, so a host
 * without claude-swap writes at most two lines every 6 hours, a count and the failure, rather than
 * one every pass.
 */
const REPEAT_WINDOW_MS = 6 * 60 * 60 * 1000;

/** The watch's repeat log, keyed by the failure kind alone; nothing the command printed rides on it. */
export const LOGIN_WATCH_REPEAT_LOG: RepeatLogSurface<[]> = {
  windowMs: REPEAT_WINDOW_MS,
  firstLine: (kind) => `login watch: claude-swap's list command failed (${kind}), the last good expiries stand for up to 24 hours`,
  countLine: (kind, suppressed) =>
    `login watch: claude-swap's list command failed (${kind}) ${String(suppressed)} more time(s) in the last ` +
    `${String(REPEAT_WINDOW_MS / 3_600_000)} hours`,
};

export type LoginWatchOptions = {
  /** The executable. `defaultCswapPath()` when not given. */
  file?: string;
  /** The run. `runCswap` under the broker's own environment when not given. */
  run?: LoginRunner;
  /** How often a pass runs. `LOGIN_REFRESH_MS` when not given. */
  refreshMs?: number;
  /** Injected so a test ages the map without waiting a day. */
  now?: () => number;
  log?: (message: string) => void;
  /** Injected so a test drives the refresh without waiting on a real interval. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

export type LoginWatch = {
  /** Runs one pass at once and begins the refresh. Calling it twice runs one timer, not two. */
  start: () => void;
  /** Clears the refresh timer. A run already started finishes and updates the map. */
  stop: () => void;
  /**
   * One pass now, resolving when it has finished. A call that lands while a pass is running starts
   * none and is answered with the running pass's own promise. Never rejects.
   */
  refresh: () => Promise<void>;
  /**
   * Each account's login expiry in epoch milliseconds, by account number, from the last good pass.
   * Empty before any good pass and once the last good pass is more than 24 hours old.
   */
  current: () => ReadonlyMap<number, number>;
};

const EMPTY: ReadonlyMap<number, number> = new Map();

/** The login watch. Builds nothing on the timer and runs nothing until `start` or `refresh`. */
export function createLoginWatch(options: LoginWatchOptions = {}): LoginWatch {
  const file = options.file ?? defaultCswapPath();
  const run = options.run ?? ((executable: string, args: readonly string[]): Promise<string> => runCswap(executable, args));
  const refreshMs = options.refreshMs ?? LOGIN_REFRESH_MS;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => {});
  const failed = createRepeatLog(LOGIN_WATCH_REPEAT_LOG, log, now);
  const setTimer = options.setTimer ?? setInterval;
  const clearTimer = options.clearTimer ?? clearInterval;

  // Replaced whole at the end of a good pass, never built in place, so `current` never sees half a map.
  let logins: ReadonlyMap<number, number> = EMPTY;
  let lastGoodAt: number | null = null;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;

  async function pass(): Promise<void> {
    let output: string;
    try {
      output = await run(file, LIST_ARGS);
    } catch (error) {
      // Only a known kind is named; anything else a runner rejects with is a child that never ran.
      const kind = error instanceof Error && RUN_FAILURES.has(error.message) ? error.message : "spawn";
      failed(kind);
      return;
    }
    const parsed = parseLogins(output);
    if (typeof parsed === "string") {
      failed(parsed);
      return;
    }
    logins = parsed;
    lastGoodAt = now();
    log(`login watch: read ${String(parsed.size)} login expiries from claude-swap`);
  }

  function refresh(): Promise<void> {
    if (running !== null) return running;
    // A pass never rejects: a timer has no caller to hand a rejection to, and under Node 24 an
    // unhandled one ends the process.
    const started = pass()
      .catch(() => {})
      .finally(() => {
        running = null;
      });
    running = started;
    return started;
  }

  return {
    start: () => {
      if (timer !== null) return;
      timer = setTimer(() => void refresh(), refreshMs);
      void refresh();
    },
    stop: () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    refresh,
    current: () => (lastGoodAt === null || now() - lastGoodAt > LOGIN_STALE_AFTER_MS ? EMPTY : logins),
  };
}

/**
 * The words for a login expiring at `expiresAt`, read at `now`, in claude-swap's own form: nothing
 * while more than 7 days remain or where no instant is known, `re-login in <countdown>` inside the
 * window, and `re-login needed` once the instant has passed. The countdown is `span`, which floors
 * to the same units as claude-swap's `format_countdown`.
 */
export function loginNote(expiresAt: number | null, now: number): string | null {
  if (expiresAt === null) return null;
  const left = expiresAt - now;
  if (left > LOGIN_DUE_WITHIN_MS) return null;
  if (left <= 0) return "re-login needed";
  return `re-login in ${span(left)}`;
}
