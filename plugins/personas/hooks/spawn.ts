// spawn.ts: the environment every child process the persona module starts
// carries. Pure: nothing here reads `$`, since the loader follows `$` only
// into a function declared in the file it is reading and refuses the whole
// module where `$` crosses an import. The one `$.process.run` call lives in
// hooks/index.ts's top-level adapter, which builds its env through
// childEnvOf and hands in what it read from `$.env` itself.
//
// The lookup variable in a child's env governs that child's own spawns alone,
// such as git starting ssh or a credential helper through cmd.exe, which
// reads it from its environment and then resolves a bare name against PATH
// instead of its working directory. It does not govern how the host resolves
// the child: the host resolves a bare argv[0] against its own PATH and
// refuses the working directory in its own resolver, so a caller that wants
// an absolute path resolves one through executableOf before calling the
// adapter.

// The variable the seam sets on every spawn, on every platform, since the
// others ignore it. A caller that carries its own copy in its env, as the
// merged-pr-push guard's queries do, is redundant with this and harmless.
export const NO_CWD_EXE_LOOKUP_ENV: Readonly<Record<string, string>> = { NoDefaultCurrentDirectoryInExePath: "1" };

// The directory name under the temp root the git pins point core.hooksPath
// at, completed by a suffix the adapter draws once per session. Nothing
// creates the directory: a hooks path that leads nowhere runs no hook.
export const GIT_NO_HOOKS_PREFIX = "kit-git-no-hooks-";

/**
 * Whether an argv[0] names git: its basename after the last `/` or `\`,
 * lowercased, with one trailing `.exe` or `.com` dropped, is `git`. Those
 * are the two extensions resolveExecutable tries for a bare name on
 * Windows, so `git`, `git.exe`, `GIT.COM` and an absolute path to any of
 * them read as git, and a resolved absolute path keeps the pins the bare
 * name earned. Anything that is not a string reads as no.
 */
export function isGitArgv0(argv0: unknown): boolean {
  if (typeof argv0 !== "string") return false;
  const base = argv0.slice(Math.max(argv0.lastIndexOf("/"), argv0.lastIndexOf("\\")) + 1).toLowerCase();
  return base.replace(/\.(exe|com)$/, "") === "git";
}

/**
 * The never-created hooks path for this session: `tempRoot`, stripped of
 * trailing separators, joined with GIT_NO_HOOKS_PREFIX and `suffix` by `/`,
 * which git accepts on every platform.
 */
export function gitHooksPathOf(tempRoot: string, suffix: string): string {
  return `${tempRoot.replace(/[\\/]+$/, "")}/${GIT_NO_HOOKS_PREFIX}${suffix}`;
}

/**
 * The pins every git the module spawns carries: no terminal prompt, no
 * optional locks, and two environment-config entries that turn
 * core.fsmonitor off and point core.hooksPath at `hooksPath`, so a
 * repository's own config cannot make `git status` run a monitor or a hook
 * of its choosing. GIT_CONFIG_COUNT names exactly these two entries, which
 * overrides any ambient count. The pins match the kit's own git calls in
 * the grimoire plugin's kit-git-lib.js; the strip of every ambient `GIT_*`
 * key that lib performs first is absent here, because the host contract
 * sets a child's env over the host's own and cannot delete a variable. A
 * host that itself passes `-c core.hooksPath` and `-c core.fsmonitor` to any
 * git it runs, as Claude Code's does, outranks GIT_CONFIG_COUNT pairs, so
 * these pins hold where a host does not.
 */
export function gitPinsOf(hooksPath: string): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: hooksPath,
  };
}

/**
 * The env the adapter hands the host for one spawn: the caller's own keys,
 * then the lookup variable, then the git pins where `argv[0]` is git by
 * isGitArgv0. The seam's keys win over a caller's of the same name, since
 * the seam is the guard and a caller that could loosen it would be the hole
 * the seam closes. A caller that passed no env gets the seam's keys alone.
 */
export function childEnvOf(argv: readonly string[], callerEnv: Record<string, string> | undefined, hooksPath: string): Record<string, string> {
  return {
    ...(callerEnv ?? {}),
    ...NO_CWD_EXE_LOOKUP_ENV,
    ...(isGitArgv0(argv[0]) ? gitPinsOf(hooksPath) : {}),
  };
}
