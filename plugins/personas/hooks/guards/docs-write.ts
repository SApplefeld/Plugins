// docs-write.ts: the before-tool guard that keeps a non-curator subagent from
// writing into docs/. It is the kit's docs-write-guard.js ported whole.
//
// Only a main session (interactive, or the bare "claude" agent type a
// background job runs as) and the docs-curator agent curate docs/. Reviewers,
// qa and implementers must not write there: their reports and scratch belong
// in .kit/ (gitignored), and the durable record is the plan's Chapter.
//
// Covers Write, Edit and MultiEdit exactly, by the file they name, and shell
// commands by heuristic: a Bash write-redirect or tee into docs/, and a
// PowerShell Out-File, Set-Content, Add-Content or Tee-Object cmdlet aimed
// at docs/. Exotic writes (python, sed -i, Copy-Item, a path passed through a
// variable) are out of its reach.
//
// The tree the guard protects is the session project's own: a target is
// resolved and judged by containment against the git root above the
// session's working directory, so a docs/ segment outside the project is out
// of scope. A target that cannot be resolved before the shell runs is judged
// by its shape alone.
//
// Nothing here reads `$` (runner.ts says why). The .git walk and the path
// arithmetic go through the LexHost hooks/index.ts builds, as the readonly
// guard's do.

import type { BeforeGuard, GuardCall, GuardContext } from "./runner";
import { repoRoot, type LexHost } from "./readonly-agent";

// The tools the guard reads, as the kit's dispatch table routed it.
const DOCS_WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit", "Bash", "PowerShell"]);

// docs-curator is the one subagent allowed to curate docs/, matched by suffix
// so a plugin-namespaced id ("grimoire:docs-curator") still resolves.
function isCurator(t: string): boolean {
  return /(^|[:/])docs-curator$/i.test(t);
}

// A user-launched background session presents as the bare catch-all "claude"
// agent type. It is the main session of its job, so it authors plan docs like
// any main session. Exact match only: namespaced ids and named types stay
// governed, and a deliberately dispatched catch-all "claude" agent shares the
// type and so also passes.
function isBackgroundMain(t: string): boolean {
  return /^claude$/i.test(t);
}

// A filesystem path that points inside a docs/ directory, absolute or
// relative, with Windows or POSIX separators. "mydocs/" does not match.
function targetsDocs(s: unknown): boolean {
  return /(^|[\\/])docs[\\/]/i.test(String(s || ""));
}

// A target resolved against the directory the write runs in, with the
// alternate spellings of an absolute path normalized first: a \\?\
// extended-length prefix on a drive path is stripped, and on a Windows host
// the Git-Bash form /<drive>/<rest> becomes <drive>:/<rest>. Null for a path
// that cannot be resolved before the shell runs (a variable, a home-relative
// path), which the caller judges by shape alone.
function resolveTarget(raw: unknown, base: string, host: LexHost): string | null {
  let s = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!s) return null;
  if (/^\\\\\?\\[A-Za-z]:/.test(s)) s = s.slice(4);
  if (host.path.sep === "\\" && /^\/[A-Za-z]\//.test(s)) s = `${s[1]}:${s.slice(2)}`;
  if (/[$%`]/.test(s) || s.startsWith("~")) return null;
  try {
    return host.path.resolve(base, s);
  } catch {
    return null;
  }
}

// True when a target is a docs/ write in the project tree this guard
// protects. With a cwd to place it against, a path resolving outside the git
// root above that cwd is out of scope whatever segments it contains, and the
// shape test runs on the root-relative remainder. Without a cwd, or for an
// unresolvable target, the shape alone decides.
async function inGuardedDocs(raw: unknown, cwd: string | null, host: LexHost): Promise<boolean> {
  if (!cwd) return targetsDocs(raw);
  const resolved = resolveTarget(raw, cwd, host);
  if (resolved === null) return targetsDocs(raw);
  const rel = host.path.relative(await repoRoot(cwd, host), resolved);
  if (host.path.isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) return false;
  return targetsDocs(rel);
}

// The docs/-shaped targets of a shell command's writers: a >, >>, tee or
// heredoc redirect into docs/, and an Out-File, Set-Content, Add-Content or
// Tee-Object cmdlet in command position with a docs/ path that is positional
// or reached across a short bounded run of parameters, -FilePath, -Path or
// -LiteralPath joined by a space or a colon included. Both require a
// separator before docs. Each hit is returned for the caller's containment
// judgment. A cmdlet name in command position inside a quoted string (a docs
// path named in a commit message) is a residual false hit.
function commandDocsTargets(cmd: unknown): string[] {
  const c = String(cmd || "");
  const out: string[] = [];
  const redirect = /(?:>>?|tee(?:\s+-a)?\s)\s*["']?((?:[^\s"'|;&><]*[\\/])?docs[\\/][^\s"';|&><]*)/gi;
  const cmdlet = /(?:^|[\s;|&(])(?:Out-File|Set-Content|Add-Content|Tee-Object)\b\s+(?:-\w+(?::\S+)?(?:\s+(?!-)[^\s"';|&]+)?\s+){0,4}(?:-(?:FilePath|Path|LiteralPath)[:\s]\s*)?["']?((?:[^\s"']*[\\/])?docs[\\/][^\s"';|&]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = redirect.exec(c)) !== null) out.push(m[1]);
  while ((m = cmdlet.exec(c)) !== null) out.push(m[1]);
  return out;
}

// The fixed words of the hook's refusal after the agent type, which the
// shadow reading looks for in the command hook's error text.
export const DOCS_WRITE_COMMAND_PHRASE = "subagent may not write into docs/. docs/ holds curated content only";

// What the guard reaches through hooks/index.ts: the path host for one call.
export type DocsWriteDeps = { lexHost(): Promise<LexHost> };

/**
 * Denies a subagent's write into the project's docs/, by the file a Write,
 * Edit or MultiEdit names or by a shell command's redirect or cmdlet, with
 * the hook's refusal as the reason. A call from the main loop matches
 * nothing, since the hook allowed every call that carried no agent type; the
 * bare "claude" type and the docs-curator allow.
 */
export function docsWriteGuard(deps: DocsWriteDeps): BeforeGuard {
  return {
    name: "docs-write",
    commandPhrase: DOCS_WRITE_COMMAND_PHRASE,
    matches: (e: GuardCall) => DOCS_WRITE_TOOLS.has(e.tool) && typeof e.agentId === "string" && e.agentId !== "",
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const t = typeof ctx.agentType === "string" ? ctx.agentType.trim() : "";
      if (!t) return {};
      if (isBackgroundMain(t)) return {};
      if (isCurator(t)) return {};
      const fp = e.file_path || e.path;
      const cwd = typeof ctx.cwd === "string" && ctx.cwd.trim() ? ctx.cwd.trim() : null;
      const host = await deps.lexHost();
      let hit = false;
      if (fp) hit = await inGuardedDocs(fp, cwd, host);
      if (!hit && e.command) {
        for (const target of commandDocsTargets(e.command)) {
          if (await inGuardedDocs(target, cwd, host)) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) return {};
      return {
        deny:
          `Blocked: the ${t} subagent may not write into docs/. docs/ holds curated content only ` +
          `(plans and the docs-curator's docs). A report or scratch file goes to .kit/ (gitignored), ` +
          `and the durable record is the plan's Chapter. Write to .kit/ instead, or return the content ` +
          `in your final message.\n`,
      };
    },
  };
}
