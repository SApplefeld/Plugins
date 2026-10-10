// after-hooks.ts: the three after-call hooks the tool.call handler runs on a
// call's result through runner.ts: the C# formatter, the memory read stamp
// and the memory-recognition nudge. Each attaches what it has to say as
// context and nothing else, and each swallows its own failure, so a
// formatter that will not start, a stamp that is not taken or a nudge that
// cannot read the store attaches nothing and raises no GuardError.
//
// Nothing here reads `$` (runner.ts says why). Each hook reaches what it
// needs through deps hooks/index.ts builds over `$` and hands in: the
// formatter the session's working directory, a host to spawn through and
// the resolver for its launchers, the stamp and the nudge the session's memq
// and its recognition index. None reads the shared GuardContext, so none
// fails where that context cannot be built. The formatter and the stamp pass
// over a call whose result is an error, as the PostToolUse hooks they
// replace fired on a call that succeeded alone.

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

// What the read stamp reaches through hooks/index.ts: `stamp` decides
// whether the path names a memory file in one of the store's tiers and, where
// it does, spawns memq's stamp verb for it once, bounded.
export type ReadStampDeps = { stamp(filePath: string): Promise<void> };

/**
 * Stamps a Read of a memory file as read in the memory database. Every Read
 * naming a file whose result is not an error matches, and `stamp` spawns
 * nothing for a file outside the store's tiers. Attaches nothing.
 */
export function readStampHook(deps: ReadStampDeps): AfterHook {
  return {
    name: "read-stamp",
    readsContext: false,
    matches: (e: GuardCall, r: GuardResult) => r.isError !== true && e.tool === "Read" && filePathOf(e) !== "",
    apply: async (e: GuardCall) => {
      try {
        await deps.stamp(filePathOf(e));
      } catch {
        // a stamp is never worth disturbing the call that read the file
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
