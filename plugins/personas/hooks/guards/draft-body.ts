// draft-body.ts: the before-tool guard that refuses `gh pr ready` while the
// pull request's body still opens with the draft line.
//
// The architect seat opens every plan's draft pull request with the draft
// line alone on the body's first line. The host writes the body into the
// trunk's merge commit when the pull request is approved, so a body still
// opening with that line at the ready would put a draft's paragraph in front
// of the approver and then into the trunk. This blocks the ready and tells
// the agent to refresh the body first.
//
// It reads a Bash or PowerShell call's command through prReadySegmentOf, the
// reading the pr-ready after hook also takes: `gh pr ready` at a
// simple-command position, in a segment holding no `--undo`. A command that
// reading does not see matches nothing. The guard names the two tools exactly,
// where the after hook compares tool names without regard to case.
//
// It makes one read, `gh pr view [<selector>] [-R <repository>] --json body
// -q .body`, as an argument vector with no shell, in the directory
// effectiveDir reads from the last directory switch ahead of the ready, which
// is not always where the shell runs it, over QUERY_ENV and bounded at
// PUSH_HOST_TIMEOUT_MS. A selector
// reaches that vector only where it meets BRANCH_ALLOWLIST, and a repository
// only where it reads as an owner, one slash and a name.
//
// It blocks only on a positive read: the query exited 0 and the body it
// printed opens with the draft line. Every failed read allows, among them a
// selector or a repository the guard cannot pass, a word joining an argument
// to a redirection, a directory switch whose target is empty, opens with a
// dash, names no existing directory or cannot be placed, a throw inside the
// directory reading, and a query that does not start, exits non-zero or runs
// past its bound.
//
// Nothing here reads `$` (runner.ts says why). The query goes through the
// context host, which resolves a bare `gh` to an absolute path, and the
// directory test through the LexHost hooks/index.ts builds.

import type { BeforeGuard, GuardCall, GuardContext, GuardHost } from "./runner";
import type { LexHost } from "./readonly-agent";
import { prReadySegmentOf } from "./after-hooks";
import { BRANCH_ALLOWLIST, PUSH_HOST_TIMEOUT_MS, QUERY_ENV } from "./merged-pr-push";
import { effectiveDir } from "./pr-docs";

// The draft line: the first line of the body of every draft pull request the
// architect seat opens, and the line the architect and finishing-work skills
// name.
export const DRAFT_BODY_LINE = "Plan draft.";

// The repositories the query may carry: an owner, one slash and a name, each
// of letters, digits, dots, dashes and underscores, the owner opening with a
// letter or digit.
const REPOSITORY_FORM = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

/**
 * Whether a body opens with the draft line: its first line that is not
 * blank, trimmed at both ends, is DRAFT_BODY_LINE exactly. A blank line is
 * one trim leaves empty, so a line ending of either kind passes. The
 * comparison is case-sensitive and nothing inside the line is trimmed.
 */
function opensWithDraftLine(body: string): boolean {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed === DRAFT_BODY_LINE;
  }
  return false;
}

// A word with one pair of surrounding quotes, single or double, removed.
function unquoted(word: string): string {
  return word.replace(/^(['"])(.*)\1$/, "$2");
}

// A redirection word: `<` or `>` after at most a descriptor, digits or one
// `&` or `*`, as in `>`, `2>&1`, `&>` or `*>`.
const REDIRECTION = /^(?:[0-9]+|[&*])?[<>]/;
// A redirection word ending on an operator character, or the here-document
// operator `<<-`, whose target is the next word: `>`, `2>`, `&>`, `*>`,
// `<<`, `<<-`, `<>` and `>&` end so, while `2>&1` and `>out.txt` carry
// their target.
const OPEN_REDIRECTION = /(?:[<>&]|<<-)$/;

// The words `gh pr view` takes between `view` and `--json` for a ready's
// words after `ready`: the selector where one is passed, then `-R` and the
// repository where one is passed. Reading stops at a word opening with `#`,
// a comment. A word opening with `<` or `>`, after at most a descriptor of
// digits or one `&` or `*`, is a redirection and no argument, so it is
// passed over, with the next word where it ends on `<`, `>`, `&` or is
// `<<-`; any other word holding `<` or `>` joins an argument to a
// redirection, so the guard cannot name the pull request and the result is
// null. The selector is the first other word that does not open with a
// dash and is not the value of a `-R` or `--repo` flag; the repository is
// the value of `-R`, `--repo`, `--repo=` or `-R` with the value attached,
// one `=` between them dropped, the last where several stand. Null where a selector does not meet BRANCH_ALLOWLIST
// or a repository flag's value does not read as REPOSITORY_FORM, since the
// guard cannot then name the pull request the command names.
function viewTarget(words: readonly string[]): string[] | null {
  let selector: string | null = null;
  let repository: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.startsWith("#")) break;
    if (REDIRECTION.test(word)) {
      if (OPEN_REDIRECTION.test(word)) i++;
      continue;
    }
    if (/[<>]/.test(word)) return null;
    let value: string | null = null;
    if (word === "-R" || word === "--repo") value = unquoted(words[++i] ?? "");
    else if (word.startsWith("--repo=")) value = unquoted(word.slice("--repo=".length));
    else if (word.startsWith("-R")) value = unquoted(word.slice("-R".length).replace(/^=/, ""));
    if (value !== null) {
      if (!REPOSITORY_FORM.test(value)) return null;
      repository = value;
      continue;
    }
    if (word.startsWith("-") || selector !== null) continue;
    selector = unquoted(word);
    if (!BRANCH_ALLOWLIST.test(selector)) return null;
  }
  return [...(selector === null ? [] : [selector]), ...(repository === null ? [] : ["-R", repository])];
}

// The query's stdout, or null where it did not start, exited non-zero or ran
// past its bound.
async function query(host: GuardHost, argv: readonly string[], cwd: string): Promise<string | null> {
  try {
    const ran = await host.run(argv, { cwd, env: { ...QUERY_ENV }, timeoutMs: PUSH_HOST_TIMEOUT_MS });
    return ran.exitCode === 0 ? ran.stdout : null;
  } catch {
    return null;
  }
}

// The refusal, fixed text: it names no word of the command.
const DRAFT_BODY_REFUSAL =
  `Blocked: this pull request's body still opens with the draft line, "${DRAFT_BODY_LINE}", so marking it ready would ` +
  `hand the reviewer a draft's words. Refresh the body with \`gh pr edit <branch> --body-file <path>\` as a call of ` +
  `its own, then mark the pull request ready.\n`;

// What the guard reaches through hooks/index.ts: the path host for one call.
export type DraftBodyDeps = { lexHost(): Promise<LexHost> };

/**
 * Denies a Bash or PowerShell `gh pr ready` on a pull request whose body
 * opens with the draft line, with the refusal above as the reason. A command
 * holding no `gh pr ready` prReadySegmentOf reads matches nothing.
 */
export function draftBodyGuard(deps: DraftBodyDeps): BeforeGuard {
  return {
    name: "draft-body",
    matches: (e: GuardCall) => (e.tool === "Bash" || e.tool === "PowerShell") && typeof e.command === "string" && prReadySegmentOf(e.command) !== null,
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const cmd = e.command;
      if (typeof cmd !== "string") return {};
      const ready = prReadySegmentOf(cmd);
      if (ready === null) return {};
      const target = viewTarget(ready.words);
      if (target === null) return {};
      const dir = await effectiveDir(cmd, ready.index, ctx.cwd, await deps.lexHost());
      if (dir === null) return {};
      const body = await query(ctx.host, ["gh", "pr", "view", ...target, "--json", "body", "-q", ".body"], dir);
      if (body === null || !opensWithDraftLine(body)) return {};
      return { deny: DRAFT_BODY_REFUSAL };
    },
  };
}
