// The broker's one git runner: every git child process the web surface starts goes through `runGit`,
// so the environment scrub and the spawn shape below are the guard at that boundary, not a property
// of the caller that first needed them.
//
// The standard is that git runs only in a repository the broker owns: each repository group has one
// bare repository under the broker's state root, where every fetch, read, tag and push runs, and a
// worker's checkout is read by exactly two commands, `remote get-url origin` and `symbolic-ref HEAD`,
// and never written. The reader in `./rollout.ts` holds that line. What this module adds is defense
// in depth over the configuration of a repository the broker owns, under the task account's stored
// credential.
//
// Nothing of the broker's own git environment reaches the child: every variable whose name opens
// `GIT_`, and `SSH_ASKPASS`, is dropped, compared without regard to case because Windows reads
// variable names that way, so a `GIT_DIR` or `GIT_CONFIG_*` in the task's environment cannot point
// git at another repository. No hook runs, since `core.hooksPath` is an empty folder; no signature
// program runs on a log read, since `log.showSignature` is off; and no credential prompt opens on the
// task's desktop, since the terminal prompt, the askpass program and interactive credential helpers
// are all off. A push carries only the ref it names, since `push.followTags` is off. A tag or push
// signing setting in the task account's global config still applies. The command is an argument
// array with no shell, so a branch name or a path reaches git as one argument and nothing in it is
// interpreted.
//
// A repository's own config is read after the system and global config and before the entries this
// module hands over as `GIT_CONFIG_*`, so an entry here wins over the repository's. Every transport
// but https is refused, each by its own name, because git reads a per-transport policy from any
// scope before it falls back to `protocol.allow`. Certificate checking is held on. And the
// credential helper list is reset to empty and then rebuilt from the system and global config, read
// once per process with git run in a folder outside any repository, so only the host's own helpers
// run. The residual is the network, through the task account's own global config, which is the
// operator's file: a `url.*.insteadOf` rewriting the remote to another https host, an `http.proxy`
// or `http.<url>.proxy`, an `http.sslCAInfo`, `http.sslCAPath` or `http.curloptResolve` set there
// can redirect a fetch or a push, and a certificate authority set there can also let the host it
// redirects to read the traffic. Not covered either: `remote.origin.url` set
// straight to another https host in the worker checkout the group's URL is read from, and a
// transport git does not ship whose helper sits on the task's `PATH`.
//
// Nothing git writes to stderr leaves this module: a fetch's stderr can quote the remote URL with a
// credential in it. A failure is an error whose message names only its kind.
import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** How long a call may run and how much stdout it may produce before it is an error. */
export type GitLimits = { timeoutMs: number; maxBytes: number };

/** The bounds of a read of the local repository, which answers from disk. */
export const LOCAL_READ: GitLimits = { timeoutMs: 10_000, maxBytes: 4 * 1024 * 1024 };

/** The bounds of a fetch or a push, which waits on the remote. */
export const REMOTE_CALL: GitLimits = { timeoutMs: 60_000, maxBytes: 1024 * 1024 };

/** The shape of `runGit`, which a reader takes injected so a test can wrap, record or fail it. */
export type GitRunner = (root: string, args: readonly string[], limits: GitLimits) => Promise<string>;

/**
 * What is spawned: the executable and the arguments placed before `-C`. Production always spawns
 * `git` on the task's `PATH`; a test hands in `process.execPath` and a script that stands in for git.
 */
export type GitExecutable = { file: string; leading: readonly string[] };

const GIT: GitExecutable = { file: "git", leading: [] };

/** One config entry the child is handed, as a `GIT_CONFIG_KEY_n` and `GIT_CONFIG_VALUE_n` pair. */
export type GitConfigEntry = { key: string; value: string };

/**
 * The transports git knows besides https, each refused under its own name: git reads
 * `protocol.<name>.allow` from any scope, a checkout's `.git/config` among them, before it falls
 * back to `protocol.allow`, so the catch-all alone would leave a checkout able to switch one on.
 */
const REFUSED_TRANSPORTS = ["file", "git", "ssh", "ext", "fd", "http", "ftp", "ftps"];

/** Every credential helper key, plain or scoped to a URL, as `git config --get-regexp` takes it. */
const HELPER_KEYS = "^credential\\.(.*\\.)?helper$";

let folder: string | null = null;

/**
 * An empty folder, made once per process: `core.hooksPath` points at it so no hook is found, and
 * the host's helper list is read in it so no repository's config is in scope for that read.
 */
function emptyFolder(): string {
  if (folder === null) folder = mkdtempSync(path.join(os.tmpdir(), "channels-git-empty-"));
  return folder;
}

/**
 * The environment a git child runs under: `env` with every `GIT_*` variable and `SSH_ASKPASS`
 * dropped, then the prompt setting above set, and the config entries, which ride as
 * `GIT_CONFIG_COUNT` and its keyed pairs, read after every config file. They turn the file system
 * monitor off, point hooks at the empty folder, refuse interactive credential helpers, keep a log
 * read from running a signature program, keep a push to the ref it names, hold certificate
 * checking on, allow the https transport alone, and reset the helper list to empty before
 * `helpers`, the host's own.
 */
export function gitChildEnv(helpers: readonly GitConfigEntry[], env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (/^GIT_/i.test(name) || /^SSH_ASKPASS$/i.test(name)) continue;
    child[name] = value;
  }
  child.GIT_TERMINAL_PROMPT = "0";
  child.GIT_ASKPASS = "";
  child.NoDefaultCurrentDirectoryInExePath = "1";
  const entries: GitConfigEntry[] = [
    { key: "core.fsmonitor", value: "false" },
    { key: "core.hooksPath", value: emptyFolder() },
    { key: "credential.interactive", value: "false" },
    { key: "log.showSignature", value: "false" },
    { key: "push.followTags", value: "false" },
    { key: "http.sslVerify", value: "true" },
    { key: "protocol.allow", value: "never" },
    { key: "protocol.https.allow", value: "always" },
    ...REFUSED_TRANSPORTS.map((name) => ({ key: `protocol.${name}.allow`, value: "never" })),
    // The empty value clears every helper read before it, the checkout's among them.
    { key: "credential.helper", value: "" },
    ...helpers,
  ];
  child.GIT_CONFIG_COUNT = String(entries.length);
  entries.forEach((entry, i) => {
    child[`GIT_CONFIG_KEY_${String(i)}`] = entry.key;
    child[`GIT_CONFIG_VALUE_${String(i)}`] = entry.value;
  });
  return child;
}

/**
 * The entries of `git config --show-scope -z --get-regexp`, `scope`, then `key`, a newline and
 * `value`, each ended by NUL, kept where the scope is the system or global config.
 */
function hostEntriesOf(output: string): GitConfigEntry[] {
  const fields = output.split("\0");
  const entries: GitConfigEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i];
    const record = fields[i + 1] ?? "";
    if (scope !== "system" && scope !== "global") continue;
    const split = record.indexOf("\n");
    if (split === -1) entries.push({ key: record, value: "" });
    else entries.push({ key: record.slice(0, split), value: record.slice(split + 1) });
  }
  return entries;
}

let hostHelpers: Promise<GitConfigEntry[]> | null = null;

/**
 * The credential helpers the system and global config hold, each under its own key and in config
 * order, so a helper scoped to a URL keeps its scope and an empty entry still clears what came
 * before it. Read once per process, with git run in the empty folder so no repository's config is
 * in scope, under the same environment as any other call and with no helper list of its own. A
 * helper the global config adds only under an `includeIf "gitdir:"` condition is therefore not
 * seen. A read that fails is not kept: the call that needed it fails with the read's kind, and the
 * next call reads again, so a machine with no git on `PATH` fails each call as `spawn ENOENT`.
 */
function hostHelperList(): Promise<GitConfigEntry[]> {
  if (hostHelpers === null) {
    const read = spawnGit(emptyFolder(), ["config", "--show-scope", "-z", "--get-regexp", HELPER_KEYS], LOCAL_READ, GIT, []).then(hostEntriesOf, (error: unknown) => {
      // Exit 1 is git's answer for no entry matching at all.
      if ((error as Error).message === "exit 1") return [];
      if (hostHelpers === read) hostHelpers = null;
      throw error;
    });
    hostHelpers = read;
  }
  return hostHelpers;
}

/**
 * The kind of a call whose stdout or stderr passed the cap. The runner raises it itself, since no
 * Node API bounds a spawned child's output; it is spelled as a `spawn <code>` so it stays inside
 * the closed set of kinds a caller may see.
 */
const OVERFLOW = "spawn ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

/**
 * How long an ended call waits for the child's exit after the kill. A git that outlives this still
 * lets the call settle, so its caller's lock is held no longer than the limit and this grace.
 */
const KILL_GRACE_MS = 2_000;

/** Whether the child is still running, the one state in which its pid is still its own. */
function running(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Ends a child that is still running. A fetch's git starts a remote helper and a credential helper,
 * which on Windows outlive a killed git, so there the whole tree goes by `taskkill /T`, run while git
 * is still alive so its children can be found. Elsewhere the child itself is killed. A child that has
 * exited is left alone, since Windows may already have handed its pid to another process.
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || !running(child)) return;
  if (process.platform === "win32") {
    const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    execFile(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  child.kill("SIGKILL");
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "EINVAL";
}

/**
 * `git -C <root> <args>`, resolving to its stdout where it exits 0, and rejecting with an error whose
 * message is the kind alone otherwise. The root is resolved with `realpathSync` first and refused,
 * as `spawn <code>`, where it cannot be; the resolved path is what `-C` is given. The host's helper
 * list is read first where no call has read it yet, and a failure of that read is the call's.
 *
 * The child is started by `spawn` with no shell and no stdin, its stdout and stderr each a pipe of
 * this process's. A call resolves once git has exited 0 and its stdout has ended, so the last of
 * what git wrote is never cut off. Only git holds that stdout: no hook runs, since hooks point at
 * an empty folder, no transport but https is allowed, and git hands its credential and remote
 * helpers a stdout pipe of their own. Stderr is never awaited, since a helper git started can hold
 * the inherited stderr open long after git is done, and that must neither delay nor fail the call.
 * A non-zero exit rejects as `exit <n>` at once, with whatever stdout came discarded; an exit by
 * signal rejects as `signal <name>`, a spawn that fails as `spawn <code>`.
 *
 * One timer, armed at the spawn for `limits.timeoutMs` and cleared only when the call settles,
 * bounds the whole call, the wait for stdout's end after git's exit included: it is what keeps a
 * stdout that never ends from hanging the call, which then rejects as `timeout` and resolves
 * nothing partial. Each stream has its own byte count against `limits.maxBytes`, and passing it
 * ends the call the same way. Ending pauses both pipes, so nothing more is counted, and then ends a
 * child still running, with its whole process tree on Windows, and rejects once it has exited, or
 * after a short grace where the kill does not end it, so the repository lock its caller holds is
 * not released while git may still hold its own locks. A child that has already exited is ended by
 * no kill: the call rejects at once.
 *
 * However it settles, the call then closes this process's ends of the child's pipes, so a helper
 * still holding one after git is done holds nothing of the broker's. It ends no process to do so.
 */
export function runGit(
  root: string,
  args: readonly string[],
  limits: GitLimits,
  executable: GitExecutable = GIT,
): Promise<string> {
  let real: string;
  try {
    real = realpathSync(root);
  } catch (error) {
    return Promise.reject(new Error(`spawn ${codeOf(error)}`));
  }
  return hostHelperList().then((helpers) => spawnGit(real, args, limits, executable, helpers));
}

/** The spawn `runGit` describes, over a root already resolved and the helper list already read. */
function spawnGit(real: string, args: readonly string[], limits: GitLimits, executable: GitExecutable, helpers: readonly GitConfigEntry[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ending: string | null = null;
    let grace: NodeJS.Timeout | undefined;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let stdoutEnded = false;
    const stdout: Buffer[] = [];
    const settle = (kind: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (kind === null) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(kind));
      child.stdout.off("data", onStdout).off("end", onStdoutEnd);
      child.stderr.off("data", onStderr);
      child.stdout.destroy();
      child.stderr.destroy();
    };
    // Ends a call that has run too long or written too much: the kill first, the settle on exit.
    // Both pipes are paused so nothing more is counted.
    const end = (kind: string): void => {
      if (settled || ending !== null) return;
      ending = kind;
      child.stdout.pause();
      child.stderr.pause();
      if (!running(child)) {
        settle(kind);
        return;
      }
      killTree(child);
      grace = setTimeout(() => settle(kind), KILL_GRACE_MS);
    };
    // Settles a call git has exited from and that is not ending. An exit 0 waits for stdout's end,
    // which only git holds, since hooks point at an empty folder, every transport but https is
    // refused, and git's credential and remote helpers get their own stdout pipe. Where something
    // still holds it all the same, the timer armed at the spawn ends the call as `timeout`.
    const decide = (): void => {
      if (settled || ending !== null || !exited) return;
      if (exitSignal !== null) settle(`signal ${exitSignal}`);
      else if (exitCode !== 0) settle(`exit ${String(exitCode ?? 1)}`);
      else if (stdoutEnded) settle(null);
    };
    const child = spawn(executable.file, [...executable.leading, "-C", real, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: gitChildEnv(helpers),
    });
    const timer = setTimeout(() => end("timeout"), limits.timeoutMs);
    let stdoutBytes = 0;
    let stderrBytes = 0;
    function onStdout(chunk: Buffer): void {
      stdoutBytes += chunk.length;
      if (stdoutBytes > limits.maxBytes) end(OVERFLOW);
      else stdout.push(chunk);
    }
    // Stderr is counted against the cap and never kept, since it can quote the remote URL.
    function onStderr(chunk: Buffer): void {
      stderrBytes += chunk.length;
      if (stderrBytes > limits.maxBytes) end(OVERFLOW);
    }
    function onStdoutEnd(): void {
      stdoutEnded = true;
      decide();
    }
    child.stdout.on("data", onStdout).on("end", onStdoutEnd);
    child.stderr.on("data", onStderr);
    child.on("error", (error) => settle(ending ?? `spawn ${codeOf(error)}`));
    child.on("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      // An ending call's kill has landed, or git exited on its own after the end began.
      if (ending !== null) settle(ending);
      else decide();
    });
  });
}
