// pr-docs.ts: the before-tool guard that holds a pull request until docs/ is
// committed. It is the kit's pr-docs-guard.js ported whole.
//
// The documentation work (drift curation, plan archival, backlog prune, index
// refresh) ships in the same pull request as the code, not as a follow-up, so
// a PR-creation command (gh pr create, az repos pr create) is refused while
// docs/ has uncommitted changes. A chain that runs git commit ahead of the PR
// create commits the docs itself and is allowed. This applies to any caller,
// the main session included.
//
// The docs check runs where the PR create runs: a cd, pushd or Set-Location
// ahead of it moves the check to that directory, and a target that does not
// resolve to a directory allows, since the directory is then unknowable.
// Dirty docs at a checkout on the repo's default branch, or on a detached
// HEAD, never deny: no PR can originate there, so the dirt is another
// checkout's work. A session cwd at the wrong checkout that is dirty and on a
// non-default branch still denies.
//
// Every git query that fails (git missing, not a repo, a non-zero exit, the
// 5 second bound) allows, as the hook's own catches did. Nothing here reads
// `$` (runner.ts says why); the queries go through the context host, which
// resolves `git` to an absolute path, and the directory test through the
// LexHost hooks/index.ts builds.

import type { BeforeGuard, GuardCall, GuardContext, GuardHost } from "./runner";
import type { LexHost } from "./readonly-agent";

// How long one git query may run, the hook's own bound.
export const PR_DOCS_GIT_TIMEOUT_MS = 5000;

// Index of the first PR-creation command (gh pr create, az repos pr create)
// in the string, or -1 if none.
function prCreateIndex(cmd: unknown): number {
  const c = String(cmd || "");
  const matches = [/\bgh\s+pr\s+create\b/i.exec(c), /\baz\s+repos\s+pr\s+create\b/i.exec(c)]
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m.index);
  return matches.length ? Math.min(...matches) : -1;
}

// True if a git commit appears before position `end` in the command string,
// so the chain commits the docs itself. A chained commit whose pathspec
// excludes docs/ also passes.
function commitsBefore(cmd: unknown, end: number): boolean {
  const m = /\bgit\s+commit\b/i.exec(String(cmd || ""));
  return m !== null && m.index < end;
}

// The quoted-or-bare target of the last cd, pushd or Set-Location before
// position `end`, or null when the command switches no directory ahead of
// the PR create. A "cd" inside the PR title or body sits after the match and
// cannot reach here.
function lastPathSwitchBefore(cmd: unknown, end: number): string | null {
  const re = /(?:^|[\s;&|(])(?:cd|pushd|Set-Location)\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/gi;
  const c = String(cmd || "");
  let target: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(c)) !== null) {
    if (m.index >= end) break;
    target = m[1];
  }
  return target;
}

// The directory the PR create runs in: the last path switch ahead of it,
// resolved against the cwd, else the cwd. Null where a switch names no
// existing directory.
async function effectiveDir(cmd: unknown, prAt: number, cwd: string, lex: LexHost): Promise<string | null> {
  const target = lastPathSwitchBefore(cmd, prAt);
  if (target === null) return cwd;
  const bare = target.replace(/^["']|["']$/g, "");
  if (!bare || bare.startsWith("-")) return null;
  try {
    const resolved = lex.path.resolve(cwd, bare);
    return (await lex.isDirectory(resolved)) ? resolved : null;
  } catch {
    return null;
  }
}

// One git query's stdout, or null where it did not run, exited non-zero or
// ran past its bound, the cases where the hook's execSync threw.
async function git(host: GuardHost, args: readonly string[], cwd: string): Promise<string | null> {
  try {
    const ran = await host.run(["git", ...args], { cwd, timeoutMs: PR_DOCS_GIT_TIMEOUT_MS });
    return ran.exitCode === 0 ? ran.stdout : null;
  } catch {
    return null;
  }
}

// The fixed words the hook's refusal opens with, which the shadow reading
// looks for in the command hook's error text.
export const PR_DOCS_COMMAND_PHRASE = "Blocked: docs/ has uncommitted changes, so this PR would ship without them.";

// The hook's stderr line, byte for byte.
const PR_DOCS_REFUSAL =
  `Blocked: docs/ has uncommitted changes, so this PR would ship without them. The documentation ` +
  `work (curation, plan archival, backlog prune, index refresh) ships in the same PR as the code, ` +
  `never as a follow-up. Commit the docs work into the branch (the finishing-work close-out runs ` +
  `curating-docs), then open the PR.\n`;

// What the guard reaches through hooks/index.ts: the path host for one call.
export type PrDocsDeps = { lexHost(): Promise<LexHost> };

/**
 * Denies a Bash or PowerShell PR-creation command while docs/ has
 * uncommitted changes at the checkout the PR is created from, with the
 * hook's refusal as the reason. A command that creates no PR, or commits
 * ahead of the create, matches nothing.
 */
export function prDocsGuard(deps: PrDocsDeps): BeforeGuard {
  return {
    name: "pr-docs",
    commandPhrase: PR_DOCS_COMMAND_PHRASE,
    matches: (e: GuardCall) => {
      if ((e.tool !== "Bash" && e.tool !== "PowerShell") || !e.command) return false;
      const prAt = prCreateIndex(e.command);
      return prAt >= 0 && !commitsBefore(e.command, prAt);
    },
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const cmd = e.command;
      if (!cmd) return {};
      const prAt = prCreateIndex(cmd);
      if (prAt < 0) return {};
      if (commitsBefore(cmd, prAt)) return {};
      const dir = await effectiveDir(cmd, prAt, ctx.cwd, await deps.lexHost());
      if (dir === null) return {};
      const status = await git(ctx.host, ["status", "--porcelain", "--", "docs"], dir);
      if (status === null || status.trim().length === 0) return {};
      const branch = (await git(ctx.host, ["symbolic-ref", "--quiet", "--short", "HEAD"], dir))?.trim() || null;
      if (branch === null) return {};
      const head = await git(ctx.host, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], dir);
      const def = head === null ? null : head.trim().replace(/^refs\/remotes\/origin\//, "") || null;
      if (def !== null && branch === def) return {};
      return { deny: PR_DOCS_REFUSAL };
    },
  };
}
