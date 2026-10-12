// Keeps a checkout's installed dependencies matching its lockfile, and reinstalls them when they do
// not.
//
// A plugin update re-clones the folder the broker and the relay run from, and node_modules is not
// part of the clone, so the next start of either dies loading its first package. The broker's start
// script and the relay's launch shim run this file before they start node. It decides whether
// <root>/node_modules matches <root>/package-lock.json, and when it does not, it runs `npm ci` under
// a per-folder lock and records what it installed.
//
// Plain JavaScript, and nothing outside Node's own builtins: this runs exactly when node_modules is
// missing, so it cannot depend on anything installed there.
//
// Usage: node install/ensure-dependencies.mjs --root <dir> [--check] [--log <file>]
//   default  heals when needed. Exit 0 when current or healed, 1 on failure or a root that is not a
//            folder.
//   --check  never installs. Exit 0 when current, 2 when not (the reason on stdout), 3 when not and
//            a live install holds the lock, 1 on bad arguments or a root that is not a folder.
//   --log    also appends the helper's own one-line outcomes, never npm's output, to a file, in the
//            default mode.
// In the default mode nothing reaches stdout: the relay shim's stdout is the MCP pipe, where one
// stray byte corrupts the conversation. The helper's lines and npm's own output go to stderr.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const TOOL = "ensure-dependencies";

/**
 * The stamp recording which lockfile the installed tree came from. It lives inside node_modules, so
 * the next `npm ci`, which deletes node_modules first, deletes it too, and an install that dies
 * partway never carries a stamp.
 */
export const STAMP_NAME = ".channels-lockfile-sha256";

/** The per-folder lock, beside node_modules, because the folder being installed is its scope. */
export const LOCK_NAME = ".channels-dependencies.lock";

/**
 * Install scripts stay off: no installed package declares one, and an unattended install should run
 * no package code. Audit and funding output is noise on a stderr an operator reads for failures.
 */
export const NPM_CI_ARGS = Object.freeze(["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);

/** How often a waiter looks at the lock again. */
export const LOCK_POLL_MS = 500;

/**
 * A lock whose holder is still running is taken over only once the lock file is older than this.
 * It is far longer than any install takes, because taking a live install's lock starts a second
 * `npm ci` that deletes the first one's node_modules. A waiter gives up well before it, so a hung
 * holder fails the starts that wait on it, and the first start after this age takes over.
 */
export const LOCK_STALE_MS = 30 * 60 * 1000;

/** How long a waiter waits for a live holder before giving up. */
export const LOCK_WAIT_MS = 11 * 60 * 1000;

/**
 * How far in the future a lock file's modification time may sit before it reads as planted. Far
 * beyond any step a time sync makes, so a live holder is never taken over for a clock correction.
 */
const FUTURE_SKEW_MS = 10 * 60 * 1000;

/** What a stamp holds when this helper wrote it: a hex SHA-256. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The hex SHA-256 of a file's bytes, which is what the stamp holds for package-lock.json. */
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Whether <root>'s installed dependencies match its lockfile, with the reason either way.
 *
 * Current means node_modules exists and its stamp holds the SHA-256 of package-lock.json. A root
 * with no package-lock.json has nothing to install and is current. A node_modules with no stamp at
 * all, which is every tree installed before this helper existed, is current when npm's own record
 * of it agrees with the lockfile package by package (see unstampedTreeMatches); the result then
 * carries `adopt: true`, and the heal writes the stamp without reinstalling. The two files are never
 * compared whole, because their shapes differ.
 */
export function checkDependencies(root) {
  // A root that is not a folder is a caller's mistake, never "nothing to install": reporting it
  // current would start node into the very failure this helper exists to prevent.
  let isFolder = false;
  try {
    isFolder = statSync(root).isDirectory();
  } catch {
    // Missing or unreadable: not a folder this helper can check.
  }
  if (!isFolder) throw new Error(`'${root}' is not a folder.`);
  const lockfile = path.join(root, "package-lock.json");
  if (!existsSync(lockfile)) {
    return { current: true, reason: `no package-lock.json in '${root}', so there is nothing to install.` };
  }
  const modules = path.join(root, "node_modules");
  if (!existsSync(modules)) {
    return { current: false, reason: `'${modules}' is missing.` };
  }
  const stamp = path.join(modules, STAMP_NAME);
  let recorded;
  try {
    recorded = readFileSync(stamp, "utf8").trim();
  } catch {
    if (unstampedTreeMatches(lockfile, modules)) {
      return {
        current: true,
        adopt: true,
        reason: `'${modules}' has no stamp, and npm's own record of it matches package-lock.json.`,
      };
    }
    return {
      current: false,
      reason: `'${stamp}' is missing, and npm's own record of '${modules}' does not match package-lock.json.`,
    };
  }
  const expected = sha256(lockfile);
  if (recorded !== expected) {
    return {
      current: false,
      reason:
        // The stamp's own text is shown only when it has the shape this helper writes, so a file
        // planted there cannot carry arbitrary text into broker.log.
        `the stamp '${stamp}' does not match package-lock.json (stamp ` +
        `${SHA256_HEX.test(recorded) ? recorded : "not a SHA-256"}, ` +
        `lockfile ${expected}), so the installed dependencies are from another lockfile.`,
    };
  }
  return { current: true, reason: `'${modules}' matches package-lock.json.` };
}

/**
 * Whether an npm `os` or `cpu` list admits a value. npm reads an empty or absent list as any value,
 * a `!name` entry as a refusal, and a plain entry as the only values allowed.
 */
function platformListAdmits(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;
  const allowed = list.filter((item) => typeof item === "string" && !item.startsWith("!"));
  return allowed.length === 0 || allowed.includes(value);
}

/**
 * Whether npm's own record of an unstamped node_modules, node_modules/.package-lock.json, agrees
 * with package-lock.json and with what is on disk. Every package the lockfile lists must be recorded
 * with the same version, the same integrity where both carry one, and its package.json present on
 * disk, since a record can outlive a folder a cleanup or a virus scanner removed. An optional
 * package may be absent when its `os` or `cpu` excludes this machine, or when it names no platform,
 * which is how a platform package's own optional dependencies appear. An optional package built for
 * this machine must be present. The record must list nothing the lockfile does not. Anything
 * unreadable or malformed is no match, which costs one reinstall and nothing else.
 */
function unstampedTreeMatches(lockfile, modules) {
  let wanted;
  let recorded;
  try {
    wanted = JSON.parse(readFileSync(lockfile, "utf8")).packages;
    recorded = JSON.parse(readFileSync(path.join(modules, ".package-lock.json"), "utf8")).packages;
  } catch {
    return false;
  }
  if (!wanted || typeof wanted !== "object" || !recorded || typeof recorded !== "object") return false;
  for (const [name, entry] of Object.entries(wanted)) {
    if (name === "") continue;
    const installed = recorded[name];
    if (!installed) {
      if (!entry || !entry.optional) return false;
      const namesPlatform = Array.isArray(entry.os) || Array.isArray(entry.cpu);
      const forThisMachine =
        platformListAdmits(entry.os, process.platform) && platformListAdmits(entry.cpu, process.arch);
      if (namesPlatform && forThisMachine) return false;
      continue;
    }
    if (!entry || installed.version !== entry.version) return false;
    if (entry.integrity && installed.integrity && installed.integrity !== entry.integrity) return false;
    if (!existsSync(path.join(path.dirname(modules), name, "package.json"))) return false;
  }
  return Object.keys(recorded).every((name) => name in wanted);
}

/** Blocks the thread for a while. Synchronous, because the whole helper is one straight-line run. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Whether a process with this PID exists. Signal 0 sends nothing and only checks. ESRCH means no such
 * process. EPERM means one exists that this user may not signal, which is still a live holder.
 */
function pidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

/**
 * Why the lock content read from disk names a holder that is gone, or null while it is live.
 *
 * Age is read from the file's own modification time, never from its content, and a modification
 * time over ten minutes in the future is itself stale, so no lock can hold off every start forever.
 * The content's `startedAt` is for a person reading the file. A holder writes its content
 * in the same call that creates the file, but another process can read between the two. So content
 * that does not parse counts as stale only once the file is older than one poll interval, which no
 * live holder's write takes.
 */
function staleReason(content, file, now, pollMs, staleMs) {
  let age;
  try {
    age = now - statSync(file).mtimeMs;
  } catch {
    // A file gone since it was read is no lock to take over; the next attempt to create it decides.
    return null;
  }
  let holder;
  try {
    holder = JSON.parse(content);
  } catch {
    holder = null;
  }
  // A modification time further ahead than any clock correction was set on purpose, and would
  // otherwise keep the lock live forever.
  if (age < -FUTURE_SKEW_MS) return "its file is dated in the future";
  if (!holder || !Number.isInteger(holder.pid)) {
    return age > pollMs ? "its content does not name a holder" : null;
  }
  if (!pidRunning(holder.pid)) return `its holder, process ${holder.pid}, is not running`;
  if (age > staleMs) return `its holder has held it for over ${Math.round(staleMs / 60000)} minutes`;
  return null;
}

/**
 * True when <root>'s lock is held by a live install, by the same rule acquireLock uses to decide
 * whether to wait or take over. A lock left by a killed install reads false.
 */
export function installRunning(root) {
  const file = path.join(root, LOCK_NAME);
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return false;
  }
  return staleReason(content, file, Date.now(), LOCK_POLL_MS, LOCK_STALE_MS) === null;
}

/**
 * Takes <root>'s lock, waiting for a live holder and removing a stale one.
 *
 * Returns the lock's handle, which releaseLock takes, or null when the lock was not obtained before
 * waitMs ran out. The timings are parameters so tests can run the wait in milliseconds; callers use
 * the defaults. `notify` hears each event worth an operator's line: a wait starting, a takeover.
 */
export function acquireLock(
  root,
  { pollMs = LOCK_POLL_MS, staleMs = LOCK_STALE_MS, waitMs = LOCK_WAIT_MS, notify = () => {} } = {},
) {
  const file = path.join(root, LOCK_NAME);
  const deadline = Date.now() + waitMs;
  let announced = false;
  for (;;) {
    const content = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
    try {
      writeFileSync(file, content, { flag: "wx" });
      return { file, content };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    let held;
    try {
      held = readFileSync(file, "utf8");
    } catch (error) {
      // Released between the create attempt and this read: try again at once. Any other read
      // failure, such as a directory squatting on the lock's name, would repeat forever, so it ends
      // the run instead.
      if (error.code === "ENOENT") continue;
      throw new Error(`could not read the lock '${file}' (${error.message}).`);
    }
    const reason = staleReason(held, file, Date.now(), pollMs, staleMs);
    if (reason) {
      // Removed only while it still holds what was judged stale, so a lock another waiter has just
      // taken over and re-created is not deleted from under it. A lock gone or replaced is retried
      // at once. One that cannot be removed is waited on like a live one, so the deadline still
      // ends the wait rather than the loop spinning.
      let retry;
      try {
        if (readFileSync(file, "utf8") === held) {
          unlinkSync(file);
          notify(`took over the stale lock '${file}': ${reason}.`);
        }
        retry = true;
      } catch (error) {
        retry = error.code === "ENOENT";
      }
      if (retry) continue;
    }

    if (Date.now() >= deadline) return null;
    if (!announced) {
      notify(`waiting for another install, which holds '${file}'.`);
      announced = true;
    }
    sleepSync(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

/**
 * Releases a lock acquireLock returned. The file is removed only while it still holds this holder's
 * content: a holder that ran past the stale age may have been taken over, and the lock it would
 * remove then belongs to someone else.
 */
export function releaseLock(lock) {
  try {
    if (readFileSync(lock.file, "utf8") === lock.content) unlinkSync(lock.file);
  } catch {
    // Already gone: nothing to release.
  }
}

/**
 * The runner that heals with the npm bundled beside a node executable.
 *
 * npm is taken from beside the node that runs this file rather than from PATH, because the
 * scheduled task's PATH is whatever its logon carried, and the node is already pinned. It runs as a
 * script under that node rather than through npm.cmd, which Node refuses to spawn without a shell.
 * stdin is closed and npm's stdout joins this process's stderr, so nothing it prints reaches stdout.
 *
 * `npmCli` exists for tests, which run a stand-in script through the same spawn; the command line
 * takes no override of which npm runs. Returns npm's exit code, or throws with the reason npm could
 * not run.
 */
export function createNpmRunner(
  nodeExe = process.execPath,
  npmCli = path.join(path.dirname(nodeExe), "node_modules", "npm", "bin", "npm-cli.js"),
) {
  return (args, cwd) => {
    if (!existsSync(npmCli)) {
      throw new Error(
        `npm was not found at '${npmCli}', beside the node running this helper. Install a Node.js ` +
          "that bundles npm, then start the broker again.",
      );
    }
    // No shell, so a checkout path containing a space stays one argument.
    const result = spawnSync(nodeExe, [npmCli, ...args], {
      cwd,
      stdio: ["ignore", 2, 2],
      shell: false,
      windowsHide: true,
    });
    if (result.error) throw new Error(`could not start npm (${result.error.message}).`);
    return result.status === null ? 1 : result.status;
  };
}

/** A PowerShell single-quoted literal, so a pasted command keeps a path's spaces and quotes. */
function psQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Makes <root>'s dependencies current, installing them when they are not.
 *
 * Returns { code, message }: code 0 when current or healed, 1 on failure, and message the one-line
 * outcome. `runNpm(args, cwd)` runs npm and returns its exit code; tests pass a stand-in. The stamp
 * is written only after npm exits 0, and never on any failure path, since a stamp on a failed
 * install would make the next check call it current. node_modules is never deleted here: npm ci
 * deletes it itself.
 */
export function healDependencies(root, { runNpm = createNpmRunner(), notify = () => {}, lockOptions = {} } = {}) {
  const before = checkDependencies(root);
  if (before.current) {
    if (!before.adopt) return { code: 0, message: `dependencies current: ${before.reason}` };
    // Adopting writes the stamp a fresh install would have, so the next check is the plain one.
    try {
      writeFileSync(path.join(root, "node_modules", STAMP_NAME), `${sha256(path.join(root, "package-lock.json"))}\n`, "utf8");
    } catch (error) {
      return { code: 0, message: `dependencies current, but the stamp could not be written (${error.message}): ${before.reason}` };
    }
    return { code: 0, message: `dependencies current, stamp written: ${before.reason}` };
  }

  const lock = acquireLock(root, { ...lockOptions, notify });
  if (!lock) {
    return {
      code: 1,
      message:
        `gave up waiting for the lock '${path.join(root, LOCK_NAME)}'. Another install is still ` +
        "running or hung; let it finish, or remove the lock file once no npm runs in that folder.",
    };
  }
  try {
    // Another holder may have installed while this one waited.
    const after = checkDependencies(root);
    if (after.current) return { code: 0, message: `dependencies current after waiting: ${after.reason}` };

    notify(`installing dependencies in '${root}': ${after.reason}`);
    // Hashed before the install, so a lockfile edited mid-install leaves a stamp that disagrees with
    // it and the next check reinstalls.
    const hash = sha256(path.join(root, "package-lock.json"));
    let status;
    try {
      status = runNpm([...NPM_CI_ARGS], root);
    } catch (error) {
      return { code: 1, message: `dependency install failed in '${root}': ${error.message}` };
    }
    if (status !== 0) {
      return {
        code: 1,
        message:
          `dependency install failed in '${root}': npm ci exited ${status}. Its output went to stderr; ` +
          `run & ${psQuote(process.execPath)} ${psQuote(fileURLToPath(import.meta.url))} --root ${psQuote(root)} ` +
          "in PowerShell to install again and see it.",
      };
    }
    try {
      // A lockfile with no packages leaves npm ci no folder to create.
      mkdirSync(path.join(root, "node_modules"), { recursive: true });
      writeFileSync(path.join(root, "node_modules", STAMP_NAME), `${hash}\n`, "utf8");
    } catch (error) {
      return { code: 1, message: `npm ci succeeded in '${root}' but the stamp could not be written (${error.message}).` };
    }
    return { code: 0, message: `dependencies installed in '${root}' from package-lock.json ${hash}.` };
  } finally {
    releaseLock(lock);
  }
}

/**
 * Appends one outcome line to the log file, in broker.log's own line shape. Control characters are
 * replaced so an error message carrying a newline stays one line. A log that cannot be written never
 * fails the helper: the line has already gone to stderr.
 */
function appendLog(file, level, message) {
  if (!file) return;
  try {
    // The class broker/sanitize.ts's isInvisible strips, plus U+0085, U+2028 and U+2029, which a
    // log reader may take as line breaks. Inlined because this file cannot import TypeScript;
    // broker/startup-crash.mjs carries the same class.
    const clean = message.replace(
      /[\u0000-\u001f\u007f\u0085\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}]/gu,
      " ",
    );
    appendFileSync(file, `${new Date().toISOString()} [${level}] ${TOOL}: ${clean}\n`, "utf8");
  } catch {
    // Dropped, by design.
  }
}

/** True when this module is the program Node was told to run, matching broker/entrypoint.ts's rule. */
function runDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  let real = path.resolve(entry);
  try {
    real = realpathSync.native(real);
  } catch {
    // A path that cannot be resolved cannot be this module either.
  }
  const invoked = pathToFileURL(real).href;
  const self = pathToFileURL(fileURLToPath(import.meta.url)).href;
  return process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self;
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: { root: { type: "string" }, check: { type: "boolean" }, log: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
    if (!values.root) throw new Error("--root <dir> is required.");
  } catch (error) {
    process.stderr.write(
      `${TOOL}: ${error.message}\nusage: node install/ensure-dependencies.mjs --root <dir> [--check] [--log <file>]\n`,
    );
    return 1;
  }
  const root = path.resolve(values.root);
  const log = values.log ? path.resolve(values.log) : null;
  const say = (level, message) => {
    process.stderr.write(`${TOOL}: ${message}\n`);
    appendLog(log, level, message);
  };

  if (values.check) {
    let state;
    try {
      state = checkDependencies(root);
    } catch (error) {
      process.stderr.write(`${TOOL}: dependency check failed in '${root}': ${error.message}\n`);
      return 1;
    }
    if (state.current) return 0;
    process.stdout.write(`${state.reason}\n`);
    return installRunning(root) ? 3 : 2;
  }

  let outcome;
  try {
    outcome = healDependencies(root, { notify: (message) => say("info", message) });
  } catch (error) {
    outcome = { code: 1, message: `dependency check failed in '${root}': ${error.message}` };
  }
  say(outcome.code === 0 ? "info" : "error", outcome.message);
  return outcome.code;
}

if (runDirectly()) process.exitCode = main();
