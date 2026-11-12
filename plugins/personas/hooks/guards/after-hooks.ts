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
// the ready mark the call's shell line, the turn's plan holder, a host to
// ask GitHub through, the set of the entry's pull request fields and the kit
// event emit. None reads the shared GuardContext, so none fails where that
// context cannot be built. The formatter and the ready mark pass over a call
// whose result is an error, as the PostToolUse hook the formatter replaces
// fired on a call that succeeded alone.

import type { AfterHook, GuardCall, GuardHost, GuardResult } from "./runner";
import { PUSH_HOST_TIMEOUT_MS, QUERY_ENV } from "./merged-pr-push";

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
 * and then `gh pr ready`, as in `echo "done; gh pr ready 12"`, reads as a
 * ready too, and an echoed or quoted `gh pr ready` with no separator before
 * it inside the quotes does not. The first such
 * command whose words hold no `--undo` is the one read. Returns its words
 * after `ready` and the index of its `gh` in the shell line, or null where
 * no such command stands. The ready mark and the draft-body guard both read
 * a shell line through this, so the two see the same commands.
 */
export function prReadySegmentOf(command: string): { words: string[]; index: number } | null {
  const separator = /&&|\|\|?|;|\r?\n/g;
  let start = 0;
  for (;;) {
    const cut = separator.exec(command);
    const segment = command.slice(start, cut === null ? command.length : cut.index);
    const words = segment.trim().split(/\s+/);
    if (words[0] === "gh" && words[1] === "pr" && words[2] === "ready" && !words.includes("--undo")) {
      return { words: words.slice(3), index: start + segment.length - segment.trimStart().length };
    }
    if (cut === null) return null;
    start = cut.index + cut[0].length;
  }
}

// The repositories a host query may carry: an owner, one slash and a name,
// each of letters, digits, dots, dashes and underscores, the owner opening
// with a letter or digit. The draft-body guard holds a command's repository
// to it and the ready mark the repository in gh's line.
export const REPOSITORY_FORM = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;

/**
 * One host query's run, or null where it did not start or ran past its
 * bound. The query is an argument vector with no shell, run over the host's
 * environment plus QUERY_ENV and bounded at PUSH_HOST_TIMEOUT_MS, in `cwd`
 * where one is given. The bound covers the whole process, so a paged read
 * that outruns it is null. The draft-body guard and the ready mark both
 * query through this.
 */
export async function hostQuery(host: GuardHost, argv: readonly string[], cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string } | null> {
  try {
    return await host.run(argv, { ...(cwd === undefined ? {} : { cwd }), env: { ...QUERY_ENV }, timeoutMs: PUSH_HOST_TIMEOUT_MS });
  } catch {
    return null;
  }
}

// gh's line for a ready, from its start to its end: an optional lead and one
// space, then `Pull request <repository>#<number> is marked as "ready for
// review"`, which gh 2.97.0 prints for a pull request it marked ready, or
// the same with `is already`, which it prints for one ready before the
// command. The lead is `!` alone, or one to three characters that are each
// outside ASCII and no space. That class is there for gh's U+2713 mark,
// whether shown as written or as a one-byte code page shows its three bytes.
// The number is one to nine digits with no leading zero.
const GH_READY_LINE = /^(?:(?:!|[^\x00-\x7f\s]{1,3}) )?Pull request ([^\s#]+)#([1-9][0-9]{0,8}) is (?:marked as|already) "ready for review"$/u;

/**
 * The repository and the pull request number gh's line for a ready names in
 * a bash or powershell call's result, or null where the result holds no such
 * line. The result's standard error is read, then its standard output, the
 * two streams core hands over under `result`, then its `text`, and the first
 * such line in that order is the one read. A line is read with a trailing
 * carriage return dropped and must be GH_READY_LINE whole, so a search hit,
 * which prints a path before the text, a line carrying colour codes and the
 * line gh prints for a closed pull request are each no ready. A line whose
 * repository is off REPOSITORY_FORM, or whose repository name is `.` or
 * `..`, is no ready either: a tool result is text the session's own model
 * can write, and the ready mark puts the repository into the path of a host
 * query, where such a name would be a dot segment.
 */
export function ghReadyLineOf(r: GuardResult): { repo: string; number: number } | null {
  const streams: { stdout?: unknown; stderr?: unknown } = typeof r.result === "object" && r.result !== null ? r.result : {};
  for (const text of [streams.stderr, streams.stdout, r.text]) {
    if (typeof text !== "string") continue;
    for (const line of text.split("\n")) {
      const read = GH_READY_LINE.exec(line.endsWith("\r") ? line.slice(0, -1) : line);
      if (read !== null && REPOSITORY_FORM.test(read[1]) && !/\/\.\.?$/.test(read[1])) return { repo: read[1], number: Number(read[2]) };
    }
  }
  return null;
}

// The paths a pull request's file list may name the plan document at: the
// entry's planPath, with its backslashes turned to forward slashes and a
// leading `./` dropped, and that path's file name under each of
// `archiveDirs`, the folders a finished plan's document sits in. Null where
// the planPath is empty or no relative path, which no host path can be
// compared with.
function planDocumentPlaces(planPath: string, archiveDirs: readonly string[]): string[] | null {
  const cleaned = planPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (cleaned === "" || cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned)) return null;
  const name = cleaned.slice(cleaned.lastIndexOf("/") + 1);
  return [cleaned, ...archiveDirs.map((dir) => `${dir}/${name}`)];
}

/**
 * Whether the pull request gh's line names changes the plan document, which
 * makes it the plan's own, or null where the host could not be asked. One
 * read, `gh api --paginate repos/<repository>/pulls/<number>/files`, lists
 * every changed file a line, up to the 3000 GitHub returns, where `gh pr
 * view --json files` stops at 100. The read goes to gh's default host,
 * github.com, and the places are read as paths from the repository's root.
 * Each line, a trailing carriage return dropped, is compared with `places`,
 * planDocumentPlaces' answer, exactly, case read. False where the list names
 * none of them, and where gh answers HTTP 404, which GitHub gives for a
 * repository or pull request that does not exist or that the login cannot
 * read. Null where there are no places to compare and where the host gave
 * no answer: a query that did not start, ran past its bound or exited
 * non-zero under any other status.
 */
async function changesPlanDocument(host: GuardHost, ready: { repo: string; number: number }, places: readonly string[] | null): Promise<boolean | null> {
  if (places === null) return null;
  const ran = await hostQuery(host, ["gh", "api", "--paginate", `repos/${ready.repo}/pulls/${ready.number}/files?per_page=100`, "--jq", ".[].filename"]);
  if (ran === null) return null;
  if (ran.exitCode !== 0) return /\bHTTP 404\b/.test(ran.stderr) ? false : null;
  return ran.stdout.split("\n").some((path) => places.includes(path.replace(/\r$/, "")));
}

// The link and the head branch of the pull request gh's line names, from one
// read, `gh api repos/<repository>/pulls/<number>`, or null where the query
// did not start, ran past its bound, exited non-zero or printed anything but
// a JSON array of two strings.
async function pullRequestNames(host: GuardHost, ready: { repo: string; number: number }): Promise<{ link: string; branch: string } | null> {
  const ran = await hostQuery(host, ["gh", "api", `repos/${ready.repo}/pulls/${ready.number}`, "--jq", "[.html_url, .head.ref]"]);
  if (ran === null || ran.exitCode !== 0) return null;
  let named: unknown;
  try {
    named = JSON.parse(ran.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(named) || named.length !== 2 || typeof named[0] !== "string" || typeof named[1] !== "string") return null;
  return { link: named[0], branch: named[1] };
}

// The three values a ready hands the session for the plan's entry, each as
// the host gave it: the number in gh's line, and the pull request's link and
// head branch.
export type PrReadyFields = { pullRequest: number; pullRequestUrl: string; branch: string };

// What the ready mark reaches through hooks/index.ts: `command` reads the
// call's shell line as hooks/recognition.ts's shellCommandOf does, `holder`
// is the plan holder of the entry the turn started on, a goal node carrying
// planPath, or undefined where the turn started on none or the session does
// not own the persona, `archiveDirs` is the plan archive folders, the
// PLAN_ARCHIVE_DIRS of hooks/plan-record.ts, `host` runs the two GitHub
// reads, `set` writes the three fields onto the entry of that id, holding
// each to the store's shape and never rejecting, and `emit` writes one
// pr-ready event for that holder's plan, awaited to the stream's bound and
// never rejecting. The holder is read for its id and its plan alone: its
// stored branch and pull request decide nothing, since a queue record's
// words fill them.
export type PrReadyDeps = {
  command(e: GuardCall): string;
  holder(): { id: string; planPath?: string } | undefined;
  archiveDirs: readonly string[];
  host: GuardHost;
  set(entryId: string, fields: PrReadyFields): Promise<void>;
  emit(plan: string, detail?: string): Promise<void>;
};

/**
 * Writes pr-ready where three things hold of a bash or powershell call whose
 * result is not an error. Its command ran `gh pr ready` at a simple-command
 * position, as prReadySegmentOf reads it. Its result holds gh's own line for
 * a ready, as ghReadyLineOf reads it at gh 2.97.0, so a command that only
 * mentions the ready writes nothing; a line the command itself prints, an
 * echo among them, reads as gh's. And the pull request that line names is
 * the plan's own, as changesPlanDocument asks the host, or the host could
 * not be asked. The plan is the plan holder of the entry the turn started
 * on, and a turn with no plan holder writes nothing and asks the host
 * nothing.
 *
 * A real ready so has three outcomes. For the plan's own pull request the
 * mark is written, detail `pr <number>` with the number in gh's line, and
 * the entry takes that number with the link and head branch pullRequestNames
 * reads. For another pull request, or one the host says does not exist,
 * nothing is written. Where the host could not be asked, or the link and
 * branch could not be read, the mark is written and nothing is set. Both
 * reads are built from gh's line alone: no word of the command reaches a
 * host query. Never blocks or edits the command: it reads the finished call.
 * Attaches nothing.
 */
export function prReadyHook(deps: PrReadyDeps): AfterHook {
  return {
    name: "pr-ready",
    readsContext: false,
    matches: (e: GuardCall, r: GuardResult) => r.isError !== true && PR_READY_TOOLS.test(e.tool) && prReadySegmentOf(deps.command(e)) !== null && ghReadyLineOf(r) !== null,
    apply: async (_e: GuardCall, r: GuardResult) => {
      try {
        const ready = ghReadyLineOf(r);
        const holder = deps.holder();
        if (ready === null || holder === undefined || !holder.planPath) return {};
        const own = await changesPlanDocument(deps.host, ready, planDocumentPlaces(holder.planPath, deps.archiveDirs));
        if (own === false) return {};
        await deps.emit(holder.planPath, `pr ${ready.number}`);
        if (own === null) return {};
        const named = await pullRequestNames(deps.host, ready);
        if (named !== null) await deps.set(holder.id, { pullRequest: ready.number, pullRequestUrl: named.link, branch: named.branch });
      } catch {
        // the stream is observability; a failed read, emit or set leaves
        // what was written before it standing
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
