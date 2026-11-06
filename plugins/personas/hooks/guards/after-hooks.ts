// after-hooks.ts: the three after-call hooks the tool.call handler runs on a
// call's result through runner.ts: the C# formatter, the memory-recognition
// nudge and the pull request ready mark. Each attaches what it has to say as
// context and nothing else, and each swallows its own failure, so a
// formatter that will not start, a nudge that cannot read the store or a
// mark whose emit failed attaches nothing and raises no GuardError.
//
// Nothing here reads `$` (runner.ts says why). Each hook reaches what it
// needs through deps hooks/index.ts builds over `$` and hands in: the
// formatter the session's working directory, a host to spawn through and
// the resolver for its launchers, the nudge the session's recognition index,
// the ready mark the call's shell line, the turn's plan holder and the kit
// event emit. None reads the shared GuardContext, so none fails where that
// context cannot be built. The formatter and the ready mark pass over a call
// whose result is an error, as the PostToolUse hook the formatter replaces
// fired on a call that succeeded alone.

import type { AfterHook, GuardCall, GuardHost, GuardResult } from "./runner";

// Whether a PATH entry names a directory absolutely: a drive path or a UNC
// path on Windows, a path from the root elsewhere.
function absolutePathEntry(entry: string, windows: boolean): boolean {
  return windows ? /^[A-Za-z]:[\\/]/.test(entry) || /^[\\/]{2}[^\\/]/.test(entry) : entry.startsWith("/");
}

/**
 * The absolute path of the executable a bare command name runs, read from
 * `pathValue` alone, or null where no PATH entry holds it. A direct spawn of
 * a bare name on Windows looks in the spawning process's working directory
 * before PATH, and a repository can plant an executable of that name there,
 * so every spawn of a bare name goes through this first and spawns the
 * answer. On Windows the entries are walked in order, `;`-separated, each
 * stripped of surrounding quotes; an entry that is empty or not absolute is
 * skipped, since a relative entry such as `.` reopens the same route; and
 * `<name>.com` then `<name>.exe` is tried in each, Windows' own search order
 * over the two a direct spawn runs. A command installed only as a `.cmd` or
 * `.bat` shim resolves to nothing, since a direct spawn cannot run one, so
 * such a launcher does not run. Elsewhere the entries are `:`-separated, a
 * relative one is skipped, and `<name>` alone is tried. `exists` answers
 * whether a path is a file, and one that throws reads as no.
 */
export async function resolveExecutable(
  name: string,
  pathValue: string,
  windows: boolean,
  exists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  const entries = pathValue.split(windows ? ";" : ":");
  const candidates = windows ? [`${name}.com`, `${name}.exe`] : [name];
  for (const raw of entries) {
    const entry = windows ? raw.trim().replace(/^"(.*)"$/, "$1") : raw;
    if (entry === "" || !absolutePathEntry(entry, windows)) continue;
    const dir = entry.replace(/[\\/]+$/, "");
    for (const candidate of candidates) {
      const path = `${dir}${windows ? "\\" : "/"}${candidate}`;
      let found = false;
      try {
        found = await exists(path);
      } catch {
        found = false;
      }
      if (found) return path;
    }
  }
  return null;
}

// The C# formatter's launchers, tried in this order until one exits 0: the
// global tool and the older global tool name.
export const FORMATTER_LAUNCHERS: ReadonlyArray<readonly string[]> = [
  ["csharpier", "format"],
  ["dotnet-csharpier"],
];

// How long one launcher may run before $.process.run kills it, so a
// formatter that hangs holds the call for at most two of these.
export const FORMATTER_TIMEOUT_MS = 15_000;

// The tools whose file the formatter formats.
const FORMATTER_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "Write"]);

// The file a call names, under the key the file tools spell it with, or "".
function filePathOf(e: GuardCall): string {
  const named = typeof e.file_path === "string" && e.file_path !== "" ? e.file_path : e.filePath;
  return typeof named === "string" ? named : "";
}

// What the formatter reaches through hooks/index.ts: the session's working
// directory, the host it checks the file and spawns through, and `resolve`,
// resolveExecutable over the session's PATH for a launcher's command name.
export type FormatterDeps = { cwd(): Promise<string>; host: GuardHost; resolve(name: string): Promise<string | null> };

/**
 * Formats a C# file an Edit, MultiEdit or Write wrote, where the call's
 * result is not an error: where the file exists, each launcher of
 * FORMATTER_LAUNCHERS runs on it in that order from the session's working
 * directory, its command name resolved to an absolute path first, each
 * bounded at FORMATTER_TIMEOUT_MS, until one exits 0. A launcher whose name
 * resolves to nothing spawns nothing, and one that exits otherwise, does not
 * start or times out, passes to the next. Attaches nothing.
 */
export function formatterHook(deps: FormatterDeps): AfterHook {
  return {
    name: "formatter",
    readsContext: false,
    matches: (e: GuardCall, r: GuardResult) => r.isError !== true && FORMATTER_TOOLS.has(e.tool) && filePathOf(e).toLowerCase().endsWith(".cs"),
    apply: async (e: GuardCall) => {
      const file = filePathOf(e);
      let cwd: string;
      try {
        if (!(await deps.host.fileExists(file))) return {};
        cwd = await deps.cwd();
      } catch {
        return {};
      }
      for (const launcher of FORMATTER_LAUNCHERS) {
        try {
          const executable = await deps.resolve(launcher[0]);
          if (executable === null) continue;
          const ran = await deps.host.run([executable, ...launcher.slice(1), file], { cwd, timeoutMs: FORMATTER_TIMEOUT_MS });
          if (ran.exitCode === 0) break;
        } catch {
          // this launcher did not resolve, did not start or ran past its
          // bound; the next one runs
        }
      }
      return {};
    },
  };
}

// The tools whose call runs a shell line, named in any case, as
// hooks/recognition.ts names them for its `cmd:` match.
const PR_READY_TOOLS = /^(bash|powershell)$/i;

/**
 * The `gh pr ready` command in a shell line, read at a simple-command
 * position alone: the text's start, or after `&&`, `||`, `;`, `|` or a line
 * break. The split reads no quotes, so a quoted string holding a separator
 * and then `gh pr ready`, as in `echo "done; gh pr ready 12"`, is a mark
 * too, and an echoed or quoted `gh pr ready` with no separator before it
 * inside the quotes is no mark. The first such
 * command whose words hold no `--undo` is the one read. Returns the pull
 * request number it names, the first word after `ready` that is one to nine
 * digits, null where it names none; and null where no such command stands.
 */
export function prReadyCommandOf(command: string): { number: number | null } | null {
  for (const segment of command.split(/&&|\|\|?|;|\r?\n/)) {
    const words = segment.trim().split(/\s+/);
    if (words[0] !== "gh" || words[1] !== "pr" || words[2] !== "ready") continue;
    if (words.includes("--undo")) continue;
    const number = words.slice(3).find((word) => /^[0-9]{1,9}$/.test(word));
    return { number: number === undefined ? null : Number(number) };
  }
  return null;
}

// What the ready mark reaches through hooks/index.ts: `command` reads the
// call's shell line as hooks/recognition.ts's shellCommandOf does, `holder`
// is the plan holder of the entry the turn started on, a goal node carrying
// planPath, or undefined where the turn started on none, and `emit` writes
// one pr-ready event for that holder's plan, awaited to the stream's bound
// and never rejecting.
export type PrReadyDeps = {
  command(e: GuardCall): string;
  holder(): { planPath?: string; pullRequest?: number } | undefined;
  emit(plan: string, detail?: string): Promise<void>;
};

/**
 * Writes pr-ready where a bash or powershell call whose result is not an
 * error ran `gh pr ready` at a simple-command position, for the plan holder
 * of the entry the turn started on, detail `pr <number>` from that entry's
 * pullRequest, else from the command's own number, else absent. A turn that
 * started on no plan holder writes nothing. Never blocks or edits the
 * command: it reads the finished call. Attaches nothing.
 */
export function prReadyHook(deps: PrReadyDeps): AfterHook {
  return {
    name: "pr-ready",
    readsContext: false,
    matches: (e: GuardCall, r: GuardResult) => r.isError !== true && PR_READY_TOOLS.test(e.tool) && prReadyCommandOf(deps.command(e)) !== null,
    apply: async (e: GuardCall) => {
      try {
        const ready = prReadyCommandOf(deps.command(e));
        const holder = deps.holder();
        if (ready === null || holder === undefined || !holder.planPath) return {};
        const number = holder.pullRequest ?? ready.number;
        await deps.emit(holder.planPath, number === null ? undefined : `pr ${number}`);
      } catch {
        // the stream is observability; a failed read or emit marks nothing
      }
      return {};
    },
  };
}

// What the nudge reaches through hooks/index.ts: `nudge` reads one main-loop
// call and its result and answers the pointer texts it claims, the
// PreToolUse reading's and the PostToolUse reading's in that order, each
// once, or none.
export type RecognitionDeps = { nudge(e: GuardCall, r: GuardResult): Promise<string[]> };

/**
 * Points a main-loop call at the stored records whose triggers or anchors it
 * matches, as context on its result. A subagent's call matches nothing,
 * since a pointer reaches the loop whose context it lands in and the nudge
 * stands down on a subagent's calls.
 */
export function recognitionHook(deps: RecognitionDeps): AfterHook {
  return {
    name: "recognition-nudge",
    readsContext: false,
    matches: (e: GuardCall) => typeof e.tool === "string" && e.tool !== "" && !(typeof e.agentId === "string" && e.agentId !== ""),
    apply: async (e: GuardCall, r: GuardResult) => {
      try {
        const texts = await deps.nudge(e, r);
        return texts.length > 0 ? { context: texts } : {};
      } catch {
        return {};
      }
    },
  };
}
