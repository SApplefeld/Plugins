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
// Nothing here reads `$` (runner.ts says why). The queries go through the
// context host, which resolves a bare `git` or `gh` to an absolute path; the
// Azure queries' executables are resolved by azurePrs itself, as its comment
// says.

import type { BeforeGuard, GuardCall, GuardContext, GuardHost } from "./runner";

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

/**
 * The operands of the first `git push` at a command position in a command
 * string, or null when it holds none to guard. A command begins at the start
 * of the string or just after a separator, redirect, subshell opener,
 * backtick or line break, optionally behind NAME=value assignment prefixes,
 * and ends at the next of those. Quoted text is not masked, so prose naming a
 * push after a separator reads as one; a push the shell reaches through a
 * layer this parser does not model (a quoted string run as code, a
 * continuation between `git` and `push`, xargs, an alias) is not seen.
 */
export function pushArgs(cmd: unknown): string | null {
  const c = String(cmd || "");
  const re = /\bgit\s+push\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(c)) !== null) {
    if (!/(?:^|[;|&<>()`\n\x01])[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|[^\s;|&<>()`'"\x01])*[ \t]+)*$/.test(c.slice(0, m.index))) continue;
    const rest = c.slice(m.index + m[0].length);
    const cut = rest.search(/[;|&<>)`\n\x01]/);
    return (cut < 0 ? rest : rest.slice(0, cut)).trim();
  }
  return null;
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
// PATH (.com then .exe on Windows).
export type MergedPrPushDeps = {
  windows(): Promise<boolean>;
  plantedGitVariable(): Promise<string | null>;
  systemRoot(): Promise<string | undefined>;
  pathValue(): Promise<string>;
  isFile(path: string): Promise<boolean>;
  resolve(name: string): Promise<string | null>;
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

// The fixed words of the hook's refusal after the branch, which the shadow
// reading looks for in the command hook's error text.
export const MERGED_PR_PUSH_COMMAND_PHRASE = "has already merged, so this push would strand off the integration branch.";

/**
 * Denies a Bash or PowerShell `git push` to a branch whose pull request the
 * host reports merged, with the hook's refusal as the reason, or whose tip
 * landed on its base by a push, with a refusal naming that base. A command
 * holding no push at a command position matches nothing.
 */
export function mergedPrPushGuard(deps: MergedPrPushDeps): BeforeGuard {
  return {
    name: "merged-pr-push",
    commandPhrase: MERGED_PR_PUSH_COMMAND_PHRASE,
    matches: (e: GuardCall) => (e.tool === "Bash" || e.tool === "PowerShell") && pushArgs(e.command) !== null,
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const after = pushArgs(e.command);
      if (after === null) return {};
      let branch = namedBranch(after);
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
      if (!named) {
        const head = await query(ctx.host, ["git", "rev-parse", "--abbrev-ref", "HEAD"], ctx.cwd, PUSH_GIT_TIMEOUT_MS);
        if (head === null) return {};
        branch = head.trim();
        if (!branch) return {};
      }
      if (INTEGRATION_BRANCH.test(branch)) return {};
      const originHead = await query(ctx.host, ["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], ctx.cwd, PUSH_GIT_TIMEOUT_MS);
      const def = originHead === null ? null : originHead.trim().replace(/^refs\/remotes\/origin\//, "") || null;
      if (def && branch.toLowerCase() === def.toLowerCase()) return {};
      const pr = await prState(ctx.host, deps, branch, ctx.cwd);
      if (pr.state === "MERGED") {
        return {
          deny:
            `Blocked: the PR for branch "${branch}" has already merged, so this push would strand off the ` +
            `integration branch. The branch is frozen (pushed is not merged). Put any post-merge record in a ` +
            `new doc PR against the integration branch instead of pushing here.\n`,
        };
      }
      if (pr.state === "LANDED") {
        return {
          deny:
            `Blocked: the tip of branch "${branch}" already landed on its base "${pr.base}" by a push, so this push would strand off the ` +
            `integration branch. The branch is frozen. Put any later record on a new branch off the integration branch ` +
            `instead of pushing here.\n`,
        };
      }
      return {};
    },
  };
}
