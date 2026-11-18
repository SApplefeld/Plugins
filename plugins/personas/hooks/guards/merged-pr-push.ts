// merged-pr-push.ts: the before-tool guard that refuses a push to a branch
// whose pull request has already merged, or whose tip landed on its base by
// a push.
//
// Once a pull request merges, its feature branch is frozen: a further push
// strands off the integration branch with no signal. The same holds for a
// branch that landed by a fast-forward push and left its pull request closed
// and not merged. This blocks a `git push` to a branch the host CLI reports
// MERGED and tells the agent to open a doc PR against the integration branch
// instead. It also blocks one whose pull request the host reports closed on
// GitHub, or abandoned on Azure DevOps, where `git merge-base --is-ancestor`
// finds the pull request's head commit on its base in the checkout's
// remote-tracking refs.
//
// A push is the word `git` at a command position, then any of git's own
// options, then `push`. The guard judges it in the folder the push names:
// the session's working directory, moved by each `-C` value ahead of the
// verb, in order, each read as the commit gate's tokens reads it, a Bash
// backslash before a blank read as that blank, and resolved lexically
// against the one before. Every query runs in that folder, and each refusal
// closes by naming it.
//
// It blocks only on a positive MERGED or a positive ancestry answer. Anything
// else allows: not a push, a branch deletion, an integration branch, a
// branch or base name outside the allowlist, no CLI, no PR, a head commit
// that is not 40 hexadecimal characters, a query that fails, exits non-zero
// or runs past its bound (3 seconds for git, 8 for a host query). No switch
// lifts those bounds. The guard fetches nothing, so a remote-tracking ref
// behind the host allows too.
//
// A GIT_DIR or GIT_CONFIG_GLOBAL the session carries would redirect the git
// reads the decision rests on. A child spawned here inherits the host's
// environment and cannot have a name removed from it, so the guard reads the
// closed set GIT_ENV_REDIRECTS names instead and, where one is set, allows
// without querying, its reason and context line naming the variable.
// Otherwise the queries run over the host's environment plus QUERY_ENV.
//
// Two more readings allow without querying, each naming its reason the same
// way. A `--git-dir`, `--work-tree` or `--namespace` ahead of the verb
// redirects git as those variables do. A `-C` value the guard cannot place
// leaves it no folder to read. Such values include one resolveTarget cannot
// resolve before the shell runs (built through a variable, for instance),
// one holding an escaped line break, and, on Windows, a single-slash absolute
// path other than the /<drive>/ form or one that places the push at a
// folder spelled as a network location (two separators at its start). A
// value placing the push in a folder the host cannot read as a directory
// stands down the same way.
//
// Some values place where git would not. A single-quoted `$PWD`, and a
// `%CD%`, which git receives unexpanded, place at the session's folder. On a
// PowerShell call `/d/x` places at D:\x, where git reads a folder under the
// current drive's root. Chained values resolve lexically, so `-C link -C ..`
// through a symbolic link places at the link's lexical parent. A blank
// leading or trailing a value is trimmed, and a quote character opening or
// closing its text is dropped. On Windows a local device path such as
// `\\.\D:` reads as a network location, and so does a relative value under a
// session folder on a share. The network-location and directory stand-downs
// name the last `-C` value, whichever value led there.
//
// Some values hide the push from the reader: a PowerShell backtick-escaped
// blank, an escaped quote inside double quotes, which reads as the closing
// quote, a non-breaking space, which ends a word, and an unquoted `$(...)`,
// which ends at its first blank or `)`.
//
// Nothing here reads `$` (runner.ts says why). The queries go through the
// context host, which resolves a bare `git` or `gh` to an absolute path; the
// Azure queries' executables are resolved by azurePrs itself, as its comment
// says.

import type { BeforeGuard, GuardCall, GuardContext, GuardHost } from "./runner";
import { GIT_VALUE_FLAGS, resolveTarget, tokens, type LexHost } from "./readonly-agent";

// How long one git query and one host query may run, the hook's own bounds.
export const PUSH_GIT_TIMEOUT_MS = 3000;
export const PUSH_HOST_TIMEOUT_MS = 8000;

// The variables that redirect git at another repository or configuration,
// read before any query. GIT_CONFIG_PARAMETERS is the older spelling of the
// GIT_CONFIG_COUNT channel, which git still honours. GIT_EXEC_PATH is left
// out: the guard's four git reads (rev-parse, symbolic-ref, remote get-url,
// merge-base) are builtins, which git resolves inside its own binary, so
// that variable cannot redirect them.
export const GIT_ENV_REDIRECTS: readonly string[] = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
];

// Set over the host's environment for every query: git and the host CLIs
// never prompt, and a child that resolves a command itself (cmd.exe, git
// spawning ssh) does not look in its working directory first.
export const QUERY_ENV: Readonly<Record<string, string>> = { GIT_TERMINAL_PROMPT: "0", NoDefaultCurrentDirectoryInExePath: "1" };

// The branch names a host query or a git read may carry: letters, digits,
// dot, underscore, slash and hyphen, never a leading hyphen. A branch outside
// it cannot be told from an injection attempt, so it reads UNKNOWN and
// allows.
export const BRANCH_ALLOWLIST = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

// The integration branches, never guarded.
const INTEGRATION_BRANCH = /^(develop|main|master)$/i;

// The options ahead of the verb that redirect git at another repository,
// alone or joined to a value by `=`.
const REDIRECT_OPTION = /^(--git-dir|--work-tree|--namespace)(?:=|$)/;

// A `-C` value opening with a token that names the folder the command runs
// in: bash's $PWD and ${PWD}, and cmd.exe's %CD%, kept because resolveTarget
// reads all three as that folder. That folder is the session's whatever `-C`
// came before it.
const SESSION_FOLDER_TOKEN = /^(?:\$\{PWD\}|\$PWD(?!\w)|%[Cc][Dd]%)/;

// A single-slash absolute path other than the /<drive>/ form. On Windows,
// Git Bash maps it through its own mount table (/tmp to the user's temp
// folder, for one), which the guard does not read, so the guard does not
// place it.
const MSYS_ROOTED = /^\/(?![\\/]|[A-Za-z]\/)/;

// A network location, `\\host\share`, `//host/share` or a `\\?\UNC\` or
// `\\.\UNC\` path: two separators at the start. A stat of one makes the
// machine authenticate outbound and wait for the connection's timeout. The
// guard tests for it only where the host's separator is a backslash, since
// on a POSIX host a folder opening with two slashes is a local one. The
// pattern is namesNetworkShare's in hooks/compaction.ts, written here since
// the guards import only from their own folder.
const NETWORK_LOCATION = /^[\\/]{2}/;

// What ends a word between `git` and its verb: white space, or one of the
// separators a command ends at.
const WORD_END = /[\s;|&<>)`\x01]/;

// The index just past the word that starts at `from`. A span in single or
// double quotes counts whole inside the word, with any white space or
// separator it holds, and one left open runs to the end of the string. On a
// Bash call a backslash outside quotes takes the character after it into
// the word. On a PowerShell call a backslash is a literal character, as the
// commit gate reads it there, so `-C D:\repo\ push` ends its value at the
// blank.
//
// The answer from each index the loop stops at outside quotes depends on that
// index alone. `ends` holds that answer plus one for every such index any
// walk of the call has passed, and 0 for the rest, so a walk that reaches a
// recorded index takes its answer and stops. Each index is then walked once
// per call, and each quoted span searched once from its opening quote,
// however many walks start inside another's quotes.
function wordEnd(c: string, from: number, powershell: boolean, ends: Int32Array): number {
  const walked: number[] = [];
  let i = from;
  let end = -1;
  while (end < 0) {
    const ch = c[i];
    if (i >= c.length || WORD_END.test(ch)) end = i;
    else if (ends[i] > 0) end = ends[i] - 1;
    else {
      walked.push(i);
      if (ch === "\\" && !powershell) i = Math.min(i + 2, c.length);
      else if (ch === "'" || ch === '"') {
        const close = c.indexOf(ch, i + 1);
        if (close < 0) end = c.length;
        else i = close + 1;
      } else i++;
    }
  }
  for (const at of walked) ends[at] = end + 1;
  return end;
}

// A Bash `-C` value with each backslash-escaped blank outside quotes written
// as that blank in single quotes, so tokens reads `a\ b` as the one word
// `a b`, as bash hands it to git. Quoted spans and every other escape pass
// as typed, read as wordEnd reads them.
function quoteEscapedBlanks(value: string): string {
  return value.replace(/'[^']*'?|"[^"]*"?|\\[\s\S]?/g, (m) => (m === "\\ " || m === "\\\t" ? `'${m[1]}'` : m));
}

// The index of the first character at or after `from` that is not a space
// or a tab, the blanks that part two words of one command.
function pastBlanks(c: string, from: number): number {
  let i = from;
  while (c[i] === " " || c[i] === "\t") i++;
  return i;
}

// The states a forward scan of the command holds for the command-position
// test, one bit each: at a command's head (its start, or the blanks before or
// after a whole NAME=value prefix), in a prefix's name, in its value outside
// quotes, and in a single- or double-quoted span of that value.
const AT_HEAD = 1;
const IN_NAME = 2;
const IN_VALUE = 4;
const IN_SINGLE = 8;
const IN_DOUBLE = 16;

// The states after `ch`, from the states before it. A separator, redirect,
// subshell bracket, backtick or line break opens a fresh head whatever came
// before it, so a quoted value holding one keeps both readings alive.
function headStep(states: number, ch: string): number {
  let next = /[;|&<>()`\n\x01]/.test(ch) ? AT_HEAD : 0;
  const blank = ch === " " || ch === "\t";
  if (states & AT_HEAD) next |= blank ? AT_HEAD : /[A-Za-z_]/.test(ch) ? IN_NAME : 0;
  if (states & IN_NAME) next |= /\w/.test(ch) ? IN_NAME : ch === "=" ? IN_VALUE : 0;
  if (states & IN_VALUE) next |= ch === "'" ? IN_SINGLE : ch === '"' ? IN_DOUBLE : blank ? AT_HEAD : /[\s;|&<>()`\x01]/.test(ch) ? 0 : IN_VALUE;
  if (states & IN_SINGLE) next |= ch === "'" ? IN_VALUE : IN_SINGLE;
  if (states & IN_DOUBLE) next |= ch === '"' ? IN_VALUE : IN_DOUBLE;
  return next;
}

// A push as the reader finds it: its operands, the `-C` values ahead of the
// verb in order, each as typed with any quotes, and the name of the first
// option ahead of the verb that redirects git at another repository, or null.
export type PushCall = { operands: string; dirs: string[]; redirect: string | null };

// The records the walks of one pushCall share, each kept for the call alone.
type WalkMemo = { seen: Map<number, number>; ends: Int32Array | null };

// The index of the `push` that the option words starting at `from` lead to,
// or -1 where they lead to another word or to none. An option word opens with
// a hyphen, and where GIT_VALUE_FLAGS names it the next word is its value and
// is stepped over with it. Spaces and tabs part the words. `memo.seen` holds
// the answer for each option word a walk has started at: the walk from a
// word onward is the same whichever `git` reached it, so a later walk that
// reaches one takes its answer and stops. `memo.ends` is wordEnd's record,
// made at the call's first option word. With `into`, the walk reads every
// word itself and fills in the `-C` values and the redirecting option.
// `powershell` selects wordEnd's reading of a backslash.
function verbAfterOptions(c: string, from: number, memo: WalkMemo, powershell: boolean, into?: PushCall): number {
  const walked: number[] = [];
  let at = from;
  let verb: number | undefined;
  while (c[at] === "-" && (verb = into ? undefined : memo.seen.get(at)) === undefined) {
    walked.push(at);
    const ends = (memo.ends ??= new Int32Array(c.length));
    const end = wordEnd(c, at, powershell, ends);
    const option = c.slice(at, end);
    if (into) into.redirect ??= REDIRECT_OPTION.exec(option)?.[1] ?? null;
    at = pastBlanks(c, end);
    if (!GIT_VALUE_FLAGS.test(option)) continue;
    const valueEnd = wordEnd(c, at, powershell, ends);
    if (into && option === "-C" && valueEnd > at) into.dirs.push(c.slice(at, valueEnd));
    at = pastBlanks(c, valueEnd);
  }
  verb ??= c.startsWith("push", at) && !/\w/.test(c.charAt(at + 4)) ? at : -1;
  for (const start of walked) memo.seen.set(start, verb);
  return verb;
}

/**
 * The first push at a command position in a command string, or null when it
 * holds none to guard. A push is the word `git`, then zero or more option
 * words as verbAfterOptions reads them, then `push`. A `git` whose first
 * word past its options is not `push` is not a push, and the scan goes on
 * to the next `git`. The walks share one WalkMemo, its `seen` for the option
 * words and its `ends` for the indexes inside them, so each is walked once
 * per call, however the command's `git` words nest or quote each other.
 *
 * A command begins at the start of the string or just after a separator,
 * redirect, subshell bracket, backtick or line break, optionally behind
 * NAME=value assignment prefixes, and ends at the next of those. headStep
 * reads that test forward over the command, each character once, however
 * many `git` words it holds. Quoted text is not masked, so prose naming a
 * push after a separator reads as one; a push the shell reaches through a
 * layer this parser does not model (a quoted string run as code, a
 * continuation between `git` and `push`, xargs, an alias, an option word
 * written inside quotes) is not seen. Nor is one whose `git` is spelled
 * `git.exe`, `Git` or by its path, whose `push` is written in quotes, or
 * whose options ahead of the verb hold a value-taking option GIT_VALUE_FLAGS
 * does not list, such as `--attr-source`, whose value then reads as the
 * verb. The `-C` values are answered as typed, quotes and backslash escapes
 * in them, and the guard takes those off when it places the folder.
 *
 * `powershell` is true for a PowerShell call, where a backslash is a literal
 * character rather than an escape. It defaults to the Bash reading.
 */
export function pushCall(cmd: unknown, powershell = false): PushCall | null {
  const c = String(cmd || "");
  const re = /\bgit\s+/g;
  let m: RegExpExecArray | null;
  let memo: WalkMemo | null = null;
  let scanned = 0;
  let states = AT_HEAD;
  while ((m = re.exec(c)) !== null) {
    const from = m.index + m[0].length;
    memo ??= { seen: new Map(), ends: null };
    const verb = verbAfterOptions(c, from, memo, powershell);
    if (verb < 0) continue;
    for (; scanned < m.index; scanned++) states = headStep(states, c[scanned]);
    if (!(states & AT_HEAD)) continue;
    const rest = c.slice(verb + 4);
    const cut = rest.search(/[;|&<>)`\n\x01]/);
    const call: PushCall = { operands: (cut < 0 ? rest : rest.slice(0, cut)).trim(), dirs: [], redirect: null };
    verbAfterOptions(c, from, memo, powershell, call);
    return call;
  }
  return null;
}

// The operands of the push pushCall finds, or null where it finds none.
export function pushArgs(cmd: unknown): string | null {
  const call = pushCall(cmd);
  return call === null ? null : call.operands;
}

// The branch a push's operands name, "" where they name none (the push takes
// the checked-out branch), or null for a branch deletion (--delete, -d, a
// `:branch` or `+:branch` refspec), which is cleanup and never guarded.
function namedBranch(after: string): string | null {
  if (/(?:^|\s)(?:--delete|-d)\b/.test(after)) return null;
  const toks = after.split(/\s+/).filter((t) => t && !t.startsWith("-"));
  let ref = toks.length >= 2 ? toks[1] : null;
  if (!ref) return "";
  ref = ref.replace(/^(['"])(.*)\1$/, "$2");
  ref = ref.replace(/^\+/, "");
  if (ref.includes(":")) {
    const parts = ref.split(":");
    if (parts[0] === "" || parts[0] === "+") return null;
    ref = parts[parts.length - 1];
  }
  return ref;
}

// What the guard reaches through hooks/index.ts: whether the host is
// Windows, the first GIT_ENV_REDIRECTS name the host's environment sets (or
// null), the host's SystemRoot and PATH, whether a path is a file, and
// `resolve`, the module's resolver of a bare name to an absolute path from
// PATH (.com then .exe on Windows). `lexHost` is the host resolveTarget
// places a `-C` value with, and `quote` is the fold and bracket guard a
// folder takes on its way into a refusal or a context line, since the folder
// is text the command supplied.
export type MergedPrPushDeps = {
  windows(): Promise<boolean>;
  plantedGitVariable(): Promise<string | null>;
  systemRoot(): Promise<string | undefined>;
  pathValue(): Promise<string>;
  isFile(path: string): Promise<boolean>;
  resolve(name: string): Promise<string | null>;
  lexHost(): Promise<LexHost>;
  quote(text: string): string;
};

// One query's stdout, or null where it did not run, exited non-zero or ran
// past its bound, the cases where the hook's execSync threw.
async function query(host: GuardHost, argv: readonly string[], cwd: string, timeoutMs: number): Promise<string | null> {
  try {
    const ran = await host.run(argv, { cwd, env: { ...QUERY_ENV }, timeoutMs });
    return ran.exitCode === 0 ? ran.stdout : null;
  } catch {
    return null;
  }
}

// Whether cmd.exe runs an az path as written as the first word after /c.
// The engine hands cmd.exe `/q /d /c "<az path>" <words>` for this argv,
// quoting the path only where it holds a space. cmd.exe keeps those quotes
// only where nothing between them is one of its special characters, so a
// path holding `&`, `^` or `@` loses them and splits; `<`, `>` and `|`
// cannot appear in a Windows path. cmd.exe expands `%` even inside quotes,
// and a `"` would end them. An unquoted path, one with no space, also splits
// at a parenthesis. Any of those, or a control character, runs no query.
// Spaces, `!`, `,`, `=`, `'` and, in a path holding a space, parentheses
// reach az as written.
function cmdRunnablePath(p: string): boolean {
  if (!/^[^%"&^@<>|\x00-\x1f]+$/.test(p)) return false;
  return /\s/.test(p) || !/[()]/.test(p);
}

/**
 * What Azure DevOps lists of `branch`'s pull requests in one status, in one
 * output form, or null where the query does not run or fails. `branch` has
 * passed BRANCH_ALLOWLIST.
 *
 * `az` on Windows is a `.cmd` shim, which an argument-vector spawn cannot
 * start, so on Windows this is the module's one shell spawn: cmd.exe, from
 * SystemRoot's System32 and from PATH only where SystemRoot is unset, runs
 * `/d /c <az> repos pr list --source-branch refs/heads/<branch> --status
 * <status> -o <output>`, each word its own argv element, which the engine
 * joins into the command line cmdRunnablePath describes. `<az>` is resolved
 * from PATH here, with `.cmd` admitted after `.com` and `.exe` for this call
 * alone, and it must pass cmdRunnablePath or no query runs. Every other
 * word is a constant. Off Windows `az` is resolved by the module's resolver
 * and run with no shell.
 */
async function azurePrs(host: GuardHost, deps: MergedPrPushDeps, branch: string, status: "completed" | "abandoned", output: "tsv" | "json", cwd: string): Promise<string | null> {
  const args = ["repos", "pr", "list", "--source-branch", `refs/heads/${branch}`, "--status", status, "-o", output];
  if (!(await deps.windows())) {
    const az = await deps.resolve("az");
    return az === null ? null : query(host, [az, ...args], cwd, PUSH_HOST_TIMEOUT_MS);
  }
  const systemRoot = await deps.systemRoot();
  const cmd = systemRoot ? `${systemRoot.replace(/[\\/]+$/, "")}\\System32\\cmd.exe` : await deps.resolve("cmd");
  if (cmd === null) return null;
  let az: string | null = null;
  for (const raw of (await deps.pathValue()).split(";")) {
    const entry = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!/^[A-Za-z]:[\\/]/.test(entry) && !/^[\\/]{2}[^\\/]/.test(entry)) continue;
    const dir = entry.replace(/[\\/]+$/, "");
    for (const candidate of ["az.com", "az.exe", "az.cmd"]) {
      let found = false;
      try {
        found = await deps.isFile(`${dir}\\${candidate}`);
      } catch {
        found = false;
      }
      if (found) {
        az = `${dir}\\${candidate}`;
        break;
      }
    }
    if (az !== null) break;
  }
  if (az === null || !cmdRunnablePath(az)) return null;
  return query(host, [cmd, "/d", "/c", az, ...args], cwd, PUSH_HOST_TIMEOUT_MS);
}

/**
 * The tab-separated completed pull requests Azure DevOps lists for
 * `branch`, or null where the query does not run or fails. `branch` has
 * passed BRANCH_ALLOWLIST.
 */
export async function azureCompletedPrs(host: GuardHost, deps: MergedPrPushDeps, branch: string, cwd: string): Promise<string | null> {
  return azurePrs(host, deps, branch, "completed", "tsv", cwd);
}

// The head commit and base of one pull request as its host names them,
// neither yet checked.
type PrEnds = { head: unknown; base: unknown };

// The ends of the abandoned pull request Azure DevOps lists for `branch`
// with the latest creationDate, or null where the query does not run or
// fails, its answer is not a JSON list, the list is empty or a row carries
// no date to order it by. The base is targetRefName less its leading
// `refs/heads/`. `branch` has passed BRANCH_ALLOWLIST.
async function azureAbandonedPr(host: GuardHost, deps: MergedPrPushDeps, branch: string, cwd: string): Promise<PrEnds | null> {
  const out = await azurePrs(host, deps, branch, "abandoned", "json", cwd);
  if (out === null) return null;
  let rows: unknown;
  try {
    rows = JSON.parse(out);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  let latest: Record<string, unknown> | null = null;
  let latestAt = -Infinity;
  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) return null;
    const fields = row as Record<string, unknown>;
    const at = typeof fields.creationDate === "string" ? Date.parse(fields.creationDate) : NaN;
    if (Number.isNaN(at)) return null;
    if (at > latestAt) {
      latestAt = at;
      latest = fields;
    }
  }
  if (latest === null) return null;
  const source = latest.lastMergeSourceCommit;
  const head = typeof source === "object" && source !== null ? (source as Record<string, unknown>).commitId : undefined;
  const target = latest.targetRefName;
  const base = typeof target === "string" && target.startsWith("refs/heads/") ? target.slice("refs/heads/".length) : undefined;
  return { head, base };
}

// The base a closed pull request's head commit already sits on, or null.
// The head must be 40 hexadecimal characters and the base must pass
// BRANCH_ALLOWLIST before either reaches git. The test is the exit code of
// `git merge-base --is-ancestor` over refs/remotes/origin/<base> as the
// checkout holds it, 0 where the head is an ancestor. Nothing is fetched, so
// a ref behind the host reads null, as does every failure.
async function landedBase(host: GuardHost, ends: PrEnds, cwd: string): Promise<string | null> {
  const { head, base } = ends;
  if (typeof head !== "string" || !/^[0-9a-fA-F]{40}$/.test(head)) return null;
  if (typeof base !== "string" || !BRANCH_ALLOWLIST.test(base)) return null;
  const ran = await query(host, ["git", "merge-base", "--is-ancestor", head, `refs/remotes/origin/${base}`], cwd, PUSH_GIT_TIMEOUT_MS);
  return ran === null ? null : base;
}

// What the host its origin names says of `branch`'s pull request. LANDED is
// a pull request closed on GitHub, or the latest abandoned on Azure DevOps,
// whose head commit landedBase finds on `base`. UNKNOWN on every failure.
type PrRead = { state: "MERGED" | "OPEN" | "UNKNOWN" } | { state: "LANDED"; base: string };

// GitHub answers the state, the head commit and the base in one query. Azure
// DevOps is asked for abandoned pull requests only where it lists none
// completed.
async function prState(host: GuardHost, deps: MergedPrPushDeps, branch: string, cwd: string): Promise<PrRead> {
  if (!BRANCH_ALLOWLIST.test(branch)) return { state: "UNKNOWN" };
  const origin = await query(host, ["git", "remote", "get-url", "origin"], cwd, PUSH_GIT_TIMEOUT_MS);
  if (origin === null) return { state: "UNKNOWN" };
  const url = origin.trim();
  if (/github\.com/i.test(url)) {
    const out = await query(host, ["gh", "pr", "view", branch, "--json", "state,headRefOid,baseRefName"], cwd, PUSH_HOST_TIMEOUT_MS);
    if (out === null) return { state: "UNKNOWN" };
    let pr: unknown;
    try {
      pr = JSON.parse(out);
    } catch {
      return { state: "UNKNOWN" };
    }
    if (typeof pr !== "object" || pr === null) return { state: "UNKNOWN" };
    const fields = pr as Record<string, unknown>;
    const s = typeof fields.state === "string" ? fields.state.trim().toUpperCase() : "";
    if (s === "MERGED") return { state: "MERGED" };
    if (s !== "CLOSED") return { state: s ? "OPEN" : "UNKNOWN" };
    const base = await landedBase(host, { head: fields.headRefOid, base: fields.baseRefName }, cwd);
    return base === null ? { state: "OPEN" } : { state: "LANDED", base };
  }
  if (/dev\.azure\.com|visualstudio\.com/i.test(url)) {
    const out = await azureCompletedPrs(host, deps, branch, cwd);
    if (out === null) return { state: "UNKNOWN" };
    if (out.trim()) return { state: "MERGED" };
    const ends = await azureAbandonedPr(host, deps, branch, cwd);
    const base = ends === null ? null : await landedBase(host, ends, cwd);
    return base === null ? { state: "OPEN" } : { state: "LANDED", base };
  }
  return { state: "UNKNOWN" };
}

// The reason a push the guard did not check is allowed with, naming the
// variable that stood it down: the call's journal line carries it, and the
// call's result too where the guard's verdict is the call's.
export function plantedGitVariableNote(name: string): string {
  return `merged-pr-push: this push was not checked for a merged pull request, because ${name} is set in the environment and would redirect the git reads the check rests on.`;
}

// The same reason for a push behind an option that redirects git at another
// repository, naming the option.
export function redirectOptionNote(option: string): string {
  return `merged-pr-push: this push was not checked for a merged pull request, because ${option} ahead of the verb would redirect the git reads the check rests on.`;
}

// The same reason for a push whose `-C` value the guard cannot place, the
// reading the guard file's head lists. `value` is that value as typed,
// already quoted.
export function unplacedFolderNote(value: string): string {
  return `merged-pr-push: this push was not checked for a merged pull request, because the guard could not place the folder ${value} it names with -C.`;
}

// The sentence each refusal closes with, one space after its last sentence.
// `folder` is the folder the queries ran in, already quoted.
export function judgedFolderSentence(folder: string): string {
  return ` The guard judged the folder ${folder}.`;
}

// The fixed words of the hook's refusal after the branch, which the shadow
// reading looks for in the command hook's error text.
export const MERGED_PR_PUSH_COMMAND_PHRASE = "has already merged, so this push would strand off the integration branch.";

/**
 * Denies a Bash or PowerShell `git push` to a branch whose pull request the
 * host reports merged, with the hook's refusal as the reason, or whose tip
 * landed on its base by a push, with a refusal naming that base. Each
 * refusal closes with the folder the guard judged. A command holding no push
 * at a command position matches nothing.
 */
export function mergedPrPushGuard(deps: MergedPrPushDeps): BeforeGuard {
  return {
    name: "merged-pr-push",
    commandPhrase: MERGED_PR_PUSH_COMMAND_PHRASE,
    matches: (e: GuardCall) => (e.tool === "Bash" || e.tool === "PowerShell") && pushCall(e.command, e.tool === "PowerShell") !== null,
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const call = pushCall(e.command, e.tool === "PowerShell");
      if (call === null) return {};
      let branch = namedBranch(call.operands);
      if (branch === null) return {};
      // A named branch that is HEAD, or none, is read from the checkout.
      // A named integration branch allows before any query, as the hook's
      // check ran before its first query on that path.
      const named = branch !== "" && branch !== "HEAD";
      if (named && INTEGRATION_BRANCH.test(branch)) return {};
      const planted = await deps.plantedGitVariable();
      if (planted !== null) {
        const note = plantedGitVariableNote(planted);
        return { reason: note, context: [note] };
      }
      if (call.redirect !== null) {
        const note = redirectOptionNote(call.redirect);
        return { reason: note, context: [note] };
      }
      // The folder the push names, where every query below runs. Each -C
      // value is read as the commit gate's tokens reads it, its quotes and
      // escapes taken off there, and placed against the folder before it. On
      // a Bash call a backslash before a blank first reads as that blank, so
      // `a\ b` is the one folder `a b`; a value still reading as more than
      // one word stands down. A value opening with a SESSION_FOLDER_TOKEN is
      // placed against the session's folder, as resolveTarget reads that
      // token. An empty value moves nothing, as git reads it. On Windows a
      // placed folder spelled as a network location stands down before the
      // directory check, so no stat reaches a folder spelled that way. The
      // test reads the spelling alone: a drive letter, link or subst path
      // that leads to a share is still read by the directory check.
      let folder = ctx.cwd;
      if (call.dirs.length > 0) {
        const lexHost = await deps.lexHost();
        const unplaced = (dir: string) => {
          const note = unplacedFolderNote(deps.quote(dir));
          return { reason: note, context: [note] };
        };
        for (const dir of call.dirs) {
          const words = tokens(e.tool === "PowerShell" ? dir : quoteEscapedBlanks(dir));
          if (words.length !== 1) return unplaced(dir);
          const value = words[0];
          if (value === "") continue;
          if (lexHost.path.sep === "\\" && MSYS_ROOTED.test(value)) return unplaced(dir);
          const placed = resolveTarget(value, SESSION_FOLDER_TOKEN.test(value) ? ctx.cwd : folder, lexHost);
          if (placed === null) return unplaced(dir);
          folder = placed;
        }
        if (lexHost.path.sep === "\\" && NETWORK_LOCATION.test(folder)) return unplaced(call.dirs[call.dirs.length - 1]);
        let directory = false;
        try {
          directory = await lexHost.isDirectory(folder);
        } catch {
          directory = false;
        }
        if (!directory) return unplaced(call.dirs[call.dirs.length - 1]);
      }
      if (!named) {
        const head = await query(ctx.host, ["git", "rev-parse", "--abbrev-ref", "HEAD"], folder, PUSH_GIT_TIMEOUT_MS);
        if (head === null) return {};
        branch = head.trim();
        if (!branch) return {};
      }
      if (INTEGRATION_BRANCH.test(branch)) return {};
      const originHead = await query(ctx.host, ["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], folder, PUSH_GIT_TIMEOUT_MS);
      const def = originHead === null ? null : originHead.trim().replace(/^refs\/remotes\/origin\//, "") || null;
      if (def && branch.toLowerCase() === def.toLowerCase()) return {};
      const pr = await prState(ctx.host, deps, branch, folder);
      if (pr.state === "MERGED") {
        return {
          deny:
            `Blocked: the PR for branch "${branch}" has already merged, so this push would strand off the ` +
            `integration branch. The branch is frozen (pushed is not merged). Put any post-merge record in a ` +
            `new doc PR against the integration branch instead of pushing here.${judgedFolderSentence(deps.quote(folder))}\n`,
        };
      }
      if (pr.state === "LANDED") {
        return {
          deny:
            `Blocked: the tip of branch "${branch}" already landed on its base "${pr.base}" by a push, so this push would strand off the ` +
            `integration branch. The branch is frozen. Put any later record on a new branch off the integration branch ` +
            `instead of pushing here.${judgedFolderSentence(deps.quote(folder))}\n`,
        };
      }
      return {};
    },
  };
}
