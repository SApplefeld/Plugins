// docs-write.ts: the before-tool guard that keeps a non-curator subagent from
// writing into docs/.
//
// Only a main session (interactive, or the bare "claude" agent type a
// background job runs as) and the docs-curator agent curate docs/. Reviewers,
// qa and implementers must not write there: their reports and scratch belong
// in .kit/ (gitignored), and the durable record is the plan's Chapter.
//
// Covers Write, Edit and MultiEdit exactly, by the file they name. A shell
// command is read deny-by-default: every simple command in it that names a
// docs/ path in the project must be a read, its command word on the closed
// read list DOCS_READ_COMMANDS below with that word's conditions met, and no
// >, >> or >| redirect and no tee may aim at docs/. Any other command word
// naming a docs/ path refuses, so no list of writers is kept. An assignment
// whose own value is a docs/ path or the docs directory (f=docs/x.md, d=docs)
// is a command word off the list naming one, and refuses where it stands.
// A pipeline is read whole: where any command in it names a docs/ path,
// every command in it must be a read, so
// ls docs/*.md | xargs sed -i s/a/b/ and Get-ChildItem docs | Remove-Item
// refuse. A tee naming no docs/ path counts as a read there, so
// grep -n foo docs/x.md | tee .kit/hits.txt runs. A pipeline runs on across
// a line break after a trailing |, before a | opening the next line, and
// across a PowerShell trailing backtick. A quoted heredoc body is data only
// where cat or tee receives it standing alone in its pipeline; any other
// receiver (python3 - <<'EOF', or cat <<'EOF' | bash) names the docs/ paths
// its body names. A command substitution ($(...) or backticks) or an input
// process substitution (<(...)) naming a docs/ path at any depth makes the
// command around it name one, so rm $(ls docs/x.md) refuses while
// echo $(cat docs/x.md) runs.
//
// A line continuation is read as the tool's shell reads it. On Bash a
// backslash-newline is joined as bash joins it, so the next line's words are
// operands of the command before it, except the pair ending a word-start #
// comment, at the top level or inside a $( ) or <( ) substitution, which is a
// line break, since bash ends the comment at the newline and the next line is
// its own command. On PowerShell every backslash-newline is left as typed and
// read as a line break, as PowerShell reads its own line, since it continues a
// line on a trailing backtick alone, so a Windows path ending in a backslash
// never glues the next line's command onto the one naming it. That holds
// inside a PowerShell string handed to bash -c or piped into bash too: the
// pair is left as typed there, though bash reads such a payload byte for byte
// and joins the pair.
//
// Two writes stay out of reach. A path assembled at run time is one: a
// variable or function (echo hi > $TARGET/x.md), a substitution standing as
// a redirect's target (echo hi > $(echo docs/x.md)), a path list xargs reads
// from a file, or a spelling the shell expands into docs/ (do?s/, d{o,}cs/,
// d\ocs/). A script file that writes docs/ when run with no docs/ token in its
// command (bash x.sh, node tool.js) is the other. The read list's residuals
// are writes a read word performs only when spelled on purpose: sed's w and e
// script commands, awk's system(), print | cmd and | getline, gawk's
// --dump-variables, --pretty-print and --profile and their short forms, git's
// -c values, grep -O and --ext-diff, and sort's --compress-program. A control
// character splits or joins commands where the shell and this lexer disagree:
// Bash keeps a \x01 byte inside a word the lexer splits at, and PowerShell
// breaks a line at a lone carriage return the lexer does not. A whole-tree git
// write naming no docs/ path (git checkout -- ., git stash) is not read here;
// shared-state refuses it for an implementer. Two shell forms are residuals
// as well: an output process substitution (echo hi > >(tee docs/x.md)) is
// not read as a command, and a directory switch off DIRECTORY_SWITCHES
// (env -C, make -C, pnpm -C, npm --prefix) leaves its targets judged
// against the session's directory. A session whose working directory is
// inside docs/ is a residual too: only a word shaped like a docs/ path is
// judged, so a bare relative target there (echo hi > y.md) runs unjudged.
// Six false denies are accepted. A line that is wholly a # comment naming a
// docs/ path refuses, though bash runs nothing on it. An option's value ending in a docs
// directory is read as that directory on any command off the read list, so
// node --test --test-name-pattern=docs x.test.js refuses. A clustered short
// option whose leading letters end in docs is read as the docs directory,
// so cp -tmydocs .kit/x.md refuses. An assignment's value naming the docs
// directory refuses whatever the line does with it, so d=docs; ls $d
// refuses. An unquoted heredoc body (cat > .kit/ch.md <<EOF) is read as
// commands, so a body line naming a docs/ path refuses where the quoted
// <<'EOF' spelling runs. And a lone cat's quoted heredoc inside a
// substitution names the docs/ paths its body names to the command around
// it, since that text is what the substitution hands on: node x.js
// "$(cat <<'EOF' ...)" refuses on a body naming docs/, as
// rm $(cat <<'EOF' ...) must.
//
// The tree the guard protects is the session project's own: a target is
// resolved and judged by containment against the git root above the
// session's working directory, so a docs/ segment outside the project is out
// of scope. A target that cannot be resolved before the shell runs is judged
// by its shape alone, and so is every target in a command line that changes
// directory anywhere in it: a cd, pushd, Set-Location or kin standing as any
// word of any command (a subshell, a brace group, after if, builtin or
// command, or in PowerShell's & { }), or a git -C, --git-dir or --work-tree.
//
// Nothing here reads `$` (runner.ts says why). The .git walk and the path
// arithmetic go through the LexHost hooks/index.ts builds, as the readonly
// guard's do.

import type { BeforeGuard, GuardCall, GuardContext } from "./runner";
import {
  CONTINUATION_CAP_ADVICE, GIT_VALUE_FLAGS, IN_WORD_PAIR_CAP, QUOTED_HEREDOC_INTRO, delimiterAdvice, delimiterWhat, exactMasker, exactReadingDiffers,
  excludedPairs, heredocBodies, heredocWalk, maskQuoted, memoized, offendingDelimiter, readUnderContinuations, repoRoot, segment, spliceContinuations,
  tokens, type DelimiterFault, type LexHost, type PairExclusion, type VerdictMemo,
} from "./readonly-agent";

type Span = { from: number; to: number };

// How many levels of command substitution the shell reading walks into, the
// bound the read-only guard's siblings use. Past it a substitution's text is
// judged by its docs/ paths alone, which refuses any it names.
const DEPTH_BOUND = 2;

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
export function targetsDocs(s: unknown): boolean {
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

// Judges whether a target is a docs/ write in the project tree.
type DocsJudge = (raw: unknown) => Promise<boolean>;

// The judge for one call: true when a target is a docs/ write in the project
// tree this guard protects. With a cwd to place it against, a path resolving
// outside the git root above that cwd is out of scope whatever segments it
// contains, and the shape test runs on the root-relative remainder. Without a
// cwd, or for an unresolvable target, the shape alone decides. The git root is
// found once per call, at the first target that needs it.
function guardedDocsJudge(cwd: string | null, host: LexHost): DocsJudge {
  let root: Promise<string> | null = null;
  return async (raw) => {
    if (!cwd) return targetsDocs(raw);
    const resolved = resolveTarget(raw, cwd, host);
    if (resolved === null) return targetsDocs(raw);
    root ??= repoRoot(cwd, host);
    const rel = host.path.relative(await root, resolved);
    if (host.path.isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) return false;
    return targetsDocs(rel);
  };
}

// The judge for every target in a command line that changes directory: the
// directory a target is reached from is not known before the shell runs, so
// the shape alone decides.
const SHAPE_JUDGE: DocsJudge = async (raw) => targetsDocs(raw);

// The command words that change the directory later commands run in, lowercased.
const DIRECTORY_SWITCHES: ReadonlySet<string> = new Set([
  "cd", "pushd", "popd", "chdir", "set-location", "sl", "push-location", "pop-location",
]);

// The command words a governed agent's simple command may carry while it
// names a docs/ path, lowercased, since both shells' command words are
// compared case-insensitively. Each is a read, and nine read only under a
// condition `readsOnly` holds them to: sed without -i or --in-place, less
// without a log-file flag, rg without --pre or --pre-glob, awk with no > in
// its command, no -i, --include, -l or --load and no inplace operand, find
// without a primary that runs a command, deletes or writes a file, sort
// without -o or --output, uniq with at most one operand, file without -C or
// --compile, and git only with a read subcommand and no --output. A long flag
// abbreviated to three characters or more (sed --in-pl) counts as the flag it
// abbreviates. The word is
// compared as written: a directory prefix (/usr/bin/cat) or a leading
// VAR=value assignment makes a word the list does not hold, and refuses.
export const DOCS_READ_COMMANDS: ReadonlySet<string> = new Set([
  "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "rg", "sed", "awk", "ls", "wc", "diff", "cmp",
  "stat", "file", "test", "[", "find", "sort", "uniq", "cut", "tr", "jq", "md5sum", "sha256sum",
  "shasum", "realpath", "readlink", "dirname", "basename", "echo", "printf", "git",
  "get-content", "gc", "select-string", "sls", "get-childitem", "gci", "get-item", "gi", "test-path",
  "resolve-path", "compare-object", "measure-object", "get-filehash",
]);

// The git subcommands that read, the first operand a git command naming a
// docs/ path may carry.
const GIT_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "diff", "show", "log", "status", "ls-files", "ls-tree", "grep", "blame", "cat-file", "rev-parse",
  "rev-list", "merge-base", "shortlog", "describe",
]);

// The find primaries that delete, run a command, or write a file.
const FIND_WRITE_PRIMARIES: ReadonlySet<string> = new Set([
  "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls",
]);

// True when an argument is the long flag `full` or an abbreviation of it of
// three characters or more, with or without an =value.
function longFlag(arg: string, full: string): boolean {
  const name = arg.split("=")[0];
  return name.length >= 3 && name.startsWith("--") && full.startsWith(name);
}

// The xargs options whose next word is their value where the option stands
// apart from it, the read-only guard's own list at its xargs reading.
const XARGS_VALUE_OPTIONS = /^-(?:n|I|P|L|d|E|s|a)$/;

// True when a simple command's words run sed or awk in place, the one
// reading of in-place the docs-write guard and the inplace-rewrite guard
// share: sed with an i anywhere in a short-flag cluster (-i, -i.bak, -ni) or
// any spelling of --in-place, its =suffix and a three-character abbreviation
// (--in-pl) included; awk or gawk with -i, -l, --include or --load, likewise
// abbreviated, or an operand whose last path element is inplace or
// inplace.awk. The verb is the first word, or, where the first word is
// xargs, the first word after xargs's own short options, so xargs sed -i
// reads as sed -i. A long option whose value stands apart (--max-args 1) ends
// the step early and reads false, and a guard that finds the verb's own
// command position, as inplace-rewrite does, catches that call there. Any
// other verb reads false: the > redirect test the docs-write
// guard holds awk to is a redirect check and stays with its caller.
export function inPlaceRewrite(words: readonly string[]): boolean {
  let k = 0;
  if ((words[0] ?? "").toLowerCase() === "xargs") {
    k = 1;
    while (k < words.length && words[k].startsWith("-")) k += XARGS_VALUE_OPTIONS.test(words[k]) ? 2 : 1;
  }
  const verb = (words[k] ?? "").toLowerCase();
  const args = words.slice(k + 1);
  switch (verb) {
    case "sed":
      return args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place") || longFlag(a, "--in-place"));
    case "awk":
    case "gawk":
      return args.some((a) => /^-[il]/.test(a) || a.startsWith("--include") || a.startsWith("--load")
        || longFlag(a, "--include") || longFlag(a, "--load") || /(^|[\\/])inplace(\.awk)?$/.test(a));
    default:
      return false;
  }
}

// The characters a docs/ path cannot run across inside one word, so a path
// standing inside a program text (python -c "open('docs/x.md','w')"), after an
// = (of=docs/x.md) or after a : (-FilePath:docs/x.md, HEAD:docs/x.md) is read
// as a path of its own.
const PATH_BREAK = /[\s"'`(),;=<>|&{}[\]:]+/;

// A path ending at a directory named docs (docs, docs/, other/docs\), which
// names the directory itself rather than a path inside it. Only a whole word,
// an option's value or an assignment's value is read this way: a piece split
// out of a word (the DOCS in a commit title "DOCS: X.") is prose as often as
// a path.
const DOCS_DIR = /(^|[\\/])docs[\\/]*$/i;

// The docs/-shaped paths a word carries: the word whole where it is a path
// inside a docs directory or names the directory itself, and each piece of it
// between PATH_BREAK characters where that piece is a path inside a docs
// directory, its separator after docs included. An option word's value is
// read as a word of its own: the text after its first = or :
// (--target-directory=docs, -Path:docs), and for a single-dash word the text
// after an option letter, since short options cluster (-tdocs, -rtdocs,
// -xCdocs, -odocs/x.md). Such a value starts with docs only as the last four
// letters of the word's leading run of letters, so that one place is read,
// once, and a glued argument (-m"Update docs") is not read as a value. An
// assignment word (d=docs, or PowerShell's $d=docs) has its text after the
// first = read as a value the same way.
function docsPathsIn(word: string): string[] {
  const found = new Set<string>();
  if (targetsDocs(word) || DOCS_DIR.test(word)) found.add(word);
  for (const p of word.split(PATH_BREAK)) if (targetsDocs(p)) found.add(p);
  const assign = word.match(/^\$?[A-Za-z_][A-Za-z0-9_]*=/);
  if (assign) {
    const v = word.slice(assign[0].length);
    if (targetsDocs(v) || DOCS_DIR.test(v)) found.add(v);
  }
  if (word.startsWith("-")) {
    const values: string[] = [];
    const sep = word.search(/[=:]/);
    if (sep >= 0) values.push(word.slice(sep + 1));
    if (word[1] !== "-") {
      const letters = (word.match(/^-[A-Za-z]*/) || ["-"])[0];
      if (letters.length >= 6 && letters.slice(-4).toLowerCase() === "docs") values.push(word.slice(letters.length - 4));
    }
    for (const v of values) if (targetsDocs(v) || DOCS_DIR.test(v)) found.add(v);
  }
  return [...found];
}

// One simple command of a shell line: its words in order, the targets of its
// output redirects, the quoted heredoc bodies it receives, the pipeline it
// stands in, and the span of the line it covers.
type SimpleCommand = { words: string[]; outputs: string[]; bodies: string[]; pipeline: number; from: number; to: number };

// The heredoc introductions the reading took a data body for, each mapped
// from the index of its << to the index of its body in `bodies`. The
// introduction pattern is `heredocBodies`'s own, `QUOTED_HEREDOC_INTRO`, read
// on the same text through `maskAt`, the reading's own mask, and its four
// skips are too, so an introduction the reading passed over owns no body: one
// standing in a quoted span or a substitution, where the mask is NUL or the
// substitution sentinel, one inside a body in `passed`, one with an empty
// delimiter, or one with no line after it. Under the legacy reading, `exact`
// null, `passed` is `bodies` and `maskAt` reads the body-blind mask. Under
// the exact reading `maskAt` is the exact masker's own view, on which a
// comment position reads as NUL, so an introduction inside a comment owns no
// body; `passed` holds the walk's data and live bodies; and the walk's two
// further skips apply, a << inside an arithmetic (( )), the shift bash reads,
// and a << whose first < is escaped by a backslash, with the line after the
// introduction ending at the first newline the mask leaves standing, as the
// walk's body start does. Each skip reads only local text: the introductions
// come in order and `passed` is sorted by start, so one index walks the
// bodies once, and a line break's continuation is judged by the backslashes
// just before it.
type ExactIntroRules = { passed: readonly Span[]; arithOpenAt(i: number): boolean };
function bodyIntros(cmd: string, maskAt: (i: number) => string, bodies: readonly Span[], exact: ExactIntroRules | null): Map<number, number> {
  const owners = new Map<number, number>();
  const intro = new RegExp(QUOTED_HEREDOC_INTRO, "g");
  const passed = exact === null ? bodies : exact.passed;
  let next = 0;
  let inside = 0;
  let m: RegExpExecArray | null;
  while ((m = intro.exec(cmd)) !== null && next < bodies.length) {
    const at = m.index;
    const mk = maskAt(at);
    if (mk === "\x00" || mk === "\x02") continue;
    while (inside < passed.length && passed[inside].to <= at) inside++;
    if (inside < passed.length && at >= passed[inside].from) continue;
    if ((m[2] ?? m[3]) === "") continue;
    if (exact !== null) {
      let bs = 0;
      while (at - bs - 1 >= 0 && cmd[at - bs - 1] === "\\") bs++;
      if (bs % 2 === 1 || exact.arithOpenAt(at)) continue;
    }
    let nl = cmd.indexOf("\n", at + m[0].length);
    while (nl >= 0) {
      let k = nl;
      while (k > 0 && cmd[k - 1] === "\\") k--;
      if ((nl - k) % 2 === 0 && (exact === null || maskAt(nl) === "\n")) break;
      nl = cmd.indexOf("\n", nl + 1);
    }
    if (nl < 0) continue;
    owners.set(at, next++);
  }
  return owners;
}

// The simple commands of a masked command line, walked one `segment` at a
// time. A segment ends at a separator, a pipe, a redirect or a line break; at
// a redirect the command goes on, and the first word after a >, >>, >|, &> or
// >& is an output target while the word after a < or << is read as an
// operand. A single | or |& ends the command and keeps its pipeline, and so
// does a line break whose next non-blank character is such a |; every other
// cut ends both, except that an empty command after a pipe (the blank space
// and line breaks a trailing | continues across) keeps it. A quoted-delimiter
// heredoc body is stepped over as shell text and handed to the command whose
// << `intros` maps to it.
function simpleCommands(cmd: string, masked: string, bodies: readonly Span[], intros: ReadonlyMap<number, number>): SimpleCommand[] {
  const out: SimpleCommand[] = [];
  const n = cmd.length;
  let pipeline = 0;
  const fresh = (at: number): SimpleCommand => ({ words: [], outputs: [], bodies: [], pipeline, from: at, to: at });
  let cur = fresh(0);
  let pending: "out" | "in" | null = null;
  let afterPipe = false;
  const owners: SimpleCommand[] = [];
  const close = (at: number, pipe: boolean) => {
    const empty = !cur.words.length && !cur.outputs.length;
    if (!empty) out.push(cur);
    const keep = pipe || (empty && afterPipe);
    if (!keep) pipeline++;
    afterPipe = keep;
    cur = fresh(at);
    pending = null;
  };
  // The index of the | a line break at `at` continues into, or -1. The blank
  // run last scanned is kept, so a break inside it reads the run's end
  // without walking it again, and a run of blank lines is walked once.
  let blankFrom = -1;
  let blankTo = -1;
  const pipeAfterBreak = (at: number): number => {
    if (b < bodies.length && bodies[b].from === at) return -1;
    if (at < blankFrom || at > blankTo) {
      let k = at;
      while (k < n && /[ \t\n]/.test(masked[k])) k++;
      blankFrom = at;
      blankTo = k;
    }
    const k = blankTo;
    return masked[k] === "|" && masked[k + 1] !== "|" ? k : -1;
  };
  let b = 0;
  let p = 0;
  while (p < n) {
    while (b < bodies.length && bodies[b].to <= p) b++;
    if (b < bodies.length && p >= bodies[b].from) {
      owners[b]?.bodies.push(cmd.slice(bodies[b].from, bodies[b].to));
      p = bodies[b].to;
      close(p, false);
      continue;
    }
    let piece = segment(cmd, masked, p);
    const next = b < bodies.length && bodies[b].from < p + piece.length ? bodies[b] : null;
    if (next) piece = piece.slice(0, next.from - p);
    const end = p + piece.length;
    for (const word of tokens(piece)) {
      if (pending === "out") cur.outputs.push(word);
      else cur.words.push(word);
      pending = null;
    }
    cur.to = end;
    if (next || end >= n) {
      close(end, false);
      p = end;
      continue;
    }
    const c = masked[end];
    let q = end + 1;
    const pipeAt = c === "\n" ? pipeAfterBreak(q) : -1;
    if (c === ">" || (c === "&" && masked[q] === ">")) {
      while (q < n && /[>|&]/.test(masked[q])) q++;
      pending = "out";
    } else if (c === "<") {
      const owned = intros.get(end);
      if (owned !== undefined) owners[owned] = cur;
      while (q < n && /[<-]/.test(masked[q])) q++;
      pending = "in";
    } else if (c === "|" && masked[end - 1] !== "|" && masked[q] !== "|") {
      if (masked[q] === "&") q++;
      close(q, true);
    } else if (pipeAt >= 0) {
      q = pipeAt;
    } else {
      close(q, false);
    }
    p = q;
  }
  close(n, false);
  return out;
}

// True when a simple command naming a docs/ path is a read the list admits:
// its command word is on DOCS_READ_COMMANDS, no tee stands among its words,
// and the word's own condition holds.
function readsOnly(c: SimpleCommand, raw: string): boolean {
  const word = (c.words[0] ?? "").toLowerCase();
  if (!DOCS_READ_COMMANDS.has(word)) return false;
  if (c.words.some((w) => /^(?:tee|tee-object)$/i.test(w))) return false;
  const args = c.words.slice(1);
  switch (word) {
    case "sed":
      return !inPlaceRewrite(c.words);
    case "less":
      return !args.some((a) => /^-[A-Za-z]*[oO]/.test(a) || a.startsWith("--log-file") || a.startsWith("--LOG-FILE")
        || longFlag(a, "--log-file") || longFlag(a, "--LOG-FILE"));
    case "rg":
      return !args.some((a) => a.startsWith("--pre"));
    case "awk":
      return !raw.includes(">") && !inPlaceRewrite(c.words);
    case "find":
      return !args.some((a) => FIND_WRITE_PRIMARIES.has(a));
    case "sort":
      return !args.some((a) => /^-[A-Za-z]*o/.test(a) || a.startsWith("--output") || longFlag(a, "--output"));
    case "file":
      return !args.some((a) => /^-[A-Za-z]*C/.test(a) || a.startsWith("--compile") || longFlag(a, "--compile"));
    case "uniq":
      return args.filter((a) => a === "-" || !a.startsWith("-")).length < 2;
    case "git": {
      if (args.some((a) => a.startsWith("--output"))) return false;
      let k = 0;
      while (k < args.length && args[k].startsWith("-")) k += GIT_VALUE_FLAGS.test(args[k]) ? 2 : 1;
      return k < args.length && GIT_READ_SUBCOMMANDS.has(args[k]);
    }
    default:
      return true;
  }
}

// True when any of `words` carries a docs/ path inside the project tree. A
// path naming a docs directory itself resolves to a root-relative docs with no
// separator after it, so it is judged by a child placed under it: rm -rf docs
// and cd docs name the tree's docs/ as surely as rm docs/x.md does. A piece
// split out of a word reaches here only with its separator after docs, so a
// bare docs inside a word (git commit -m "update docs") names nothing.
async function namesGuardedDocs(words: readonly string[], judge: DocsJudge): Promise<boolean> {
  for (const w of words) {
    for (const p of docsPathsIn(w)) {
      if (await judge(DOCS_DIR.test(p) ? p.replace(/[\\/]*$/, "/_") : p)) return true;
    }
  }
  return false;
}

// The git flags that run git against another directory.
const GIT_DIRECTORY_FLAG = /^(?:-C|--git-dir|--work-tree)(?:=|$)/;

// True when a simple command changes the directory commands run in: a word
// of it, with a leading ( or { stripped, is a DIRECTORY_SWITCHES member
// wherever it stands (if cd x, builtin cd x, (cd x, & { cd x), or it is a
// git command carrying a directory flag (git -C x, --git-dir, --work-tree).
function changesDirectory(c: SimpleCommand): boolean {
  const words = c.words.map((w) => w.replace(/^[({]+/, "").toLowerCase());
  if (words.some((w) => DIRECTORY_SWITCHES.has(w))) return true;
  const git = words.indexOf("git");
  return git >= 0 && c.words.slice(git + 1).some((w) => GIT_DIRECTORY_FLAG.test(w));
}

// What one shell text does to docs/: whether it writes or may write there,
// and whether any command in it, at any depth, names a docs/ path in the
// project in its words, any heredoc body it receives (a lone cat's data
// included, since a substitution hands that text on), or its substitutions.
// `delimiter` is the heredoc fault the shared walk refused, any
// `DelimiterFault` kind, through `offendingDelimiter` on the legacy reading or
// `heredocWalk` directly on the exact one, that stopped the read before any
// body was taken, at any depth, or null. `capped` is true where a text at any
// depth carried more in-word line continuations than `IN_WORD_PAIR_CAP`, so
// it was refused unread.
type ShellReading = { writes: boolean; names: boolean; delimiter: DelimiterFault | null; capped: boolean };

// The reading of a text refused unread for its in-word continuations.
const CAPPED: ShellReading = { writes: true, names: true, delimiter: null, capped: true };

// Whether a reading is a refusal rather than an allow.
const refusedReading = (r: ShellReading): boolean => r.delimiter !== null || r.capped || r.writes;

// The allow composed from the allows of every reading of one text: it names
// a docs/ path where any reading does, so the caller weighing `names` loses
// none.
const allowedReading = (rs: readonly ShellReading[]): ShellReading => ({ writes: false, names: rs.some(r => r.names), delimiter: null, capped: false });

// Reads a shell command for a docs/ write: a simple command whose output
// redirect aims at the project's docs/, or a pipeline in which a command
// names a docs/ path while some command in it is not a read the list admits
// or a tee naming no docs/ path. A command names the docs/ paths in its
// words, in a quoted heredoc body it receives unless it is cat or tee
// standing alone in its pipeline, and in any $(...), backtick or <(...)
// substitution inside it that names one at any depth, so
// rm $(ls docs/x.md) refuses while echo $(cat docs/x.md) reads. Where any
// command in the line changes directory, every target in the line is judged
// by shape alone. The command is read the read-only guard's way, under the
// reading `exact` selects. The legacy reading: heredoc bodies found on a
// body-blind mask through `heredocBodies`, continuations spliced, then the
// quote mask `maskQuoted`. The exact reading: the data and live bodies
// `heredocWalk` finds, continuations spliced outside the data bodies, a live
// body's among them since bash removes them as it reads the body, then the
// exact masker, which reads a word-start # as a comment and a body's quotes
// as bytes, a live body walked as shell text since bash runs its
// substitutions. Under either, the splice reads the reading's own quote mask
// of the text as handed in, so a pair inside a single-quoted span stays as
// typed.
// Under either, each substitution's interior is collected and read one level
// deeper to DEPTH_BOUND, past which its text refuses on any docs/ path it
// names. A nested shell's payload (bash -c "...") is a quoted word of a
// command word off the list, so a docs/ path in it refuses. A heredoc fault
// the reading returns, `offendingDelimiter`'s or the walk's, any
// `DelimiterFault` kind, at any depth, ends the read before any body is taken,
// with the fault as the reading's refusal, since bash and the guard would
// bound that body at different lines.
// `join` and `boundary` are the splice's reading of this text alone, as
// `spliceContinuations` takes them, and `exact` is the reading the guard's
// decide chose for this pass, carried unchanged to every depth, as is
// `exclusion`, the pairs the tool's shell reads as line breaks: under the
// exact reading a comment-ending pair, since bash reads a comment inside
// `$( )` by the same rule, and on PowerShell every pair. The joined
// readings shorten the command, so every span found on the text as handed in,
// the body spans and each introduction's << index among them, is read through
// the splice's map onto its text; under the two-space reading the map is the
// identity. Each substitution interior is read under `readUnderContinuations`
// on its own text, and its composed reading is held in `memo`, the call's,
// keyed on the text, its depth, its judge and `exact`. A call holds two
// judges, the one placed against its cwd and `SHAPE_JUDGE`, so the key names
// which of the two the interior is read under.
async function readShell(command: string, placed: DocsJudge, depth: number, join: boolean, boundary: number, exact: boolean, exclusion: PairExclusion, memo: VerdictMemo): Promise<ShellReading> {
  const WRITES: ShellReading = { writes: true, names: true, delimiter: null, capped: false };
  const subs: Span[] = [];
  let bodies: Span[];
  let cmd: string;
  let masked: string;
  let intros: Map<number, number>;
  if (exact) {
    const walk = heredocWalk(command, "", true);
    if (walk.fault !== null) return { writes: true, names: true, delimiter: walk.fault, capped: false };
    // The splice is handed the data bodies and the exact mask of the text as
    // handed in, whose comment test the exclusion reads, and the data and
    // live spans the masker reads are shifted through its map; the
    // introduction map is built on the joined text, so its << indexes are the
    // joined ones, and the bodies it passes over are every body the walk
    // took, sorted by start.
    const before = exactMasker(command, walk.data, walk.live);
    const joined = spliceContinuations(command, walk.data, before.full(), join, boundary, excludedPairs(exclusion, before.commentAt));
    cmd = joined.cmd;
    bodies = joined.bodies;
    const live = walk.live.map((s) => ({ from: joined.at(s.from), to: joined.at(s.to) }));
    const masker = exactMasker(cmd, bodies, live, subs);
    masked = masker.full();
    const passed = [...bodies, ...live].sort((a, b) => a.from - b.from);
    intros = bodyIntros(cmd, masker.at, bodies, { passed, arithOpenAt: (i) => masker.counter.arithOpenAt(i) });
  } else {
    const bare = maskQuoted(command);
    const delimiter = offendingDelimiter(command, bare);
    if (delimiter !== null) return { writes: true, names: true, delimiter, capped: false };
    // The introduction map is built on the text as handed in, where the
    // body-blind mask reads, and each << index is then read through the
    // splice's map onto the joined text.
    const found = heredocBodies(command, bare);
    const joined = spliceContinuations(command, found, maskQuoted(command, found), join, boundary, excludedPairs(exclusion, null));
    cmd = joined.cmd;
    bodies = joined.bodies;
    intros = new Map([...bodyIntros(command, (i) => bare[i], found, null)].map(([at, body]) => [joined.at(at), body]));
    masked = maskQuoted(cmd, bodies, subs);
  }
  const commands = simpleCommands(cmd, masked, bodies, intros);
  const judge = commands.some(changesDirectory) ? SHAPE_JUDGE : placed;
  const subNames: boolean[] = [];
  for (const s of subs) {
    const text = cmd.slice(s.from, s.to);
    if (depth >= DEPTH_BOUND) {
      if (await namesGuardedDocs([text], judge)) return WRITES;
      subNames.push(false);
      continue;
    }
    const inner = await memoized(memo, `${depth + 1}:${judge === SHAPE_JUDGE ? "shape" : "placed"}:${exact ? "exact" : "legacy"}`, text, () =>
      readUnderContinuations(text, exact, (t, j, b) => readShell(t, judge, depth + 1, j, b, exact, exclusion, memo), refusedReading, () => CAPPED, allowedReading, exclusion));
    if (inner.delimiter !== null || inner.capped) return inner;
    if (inner.writes) return WRITES;
    subNames.push(inner.names);
  }
  const sizes = new Map<number, number>();
  for (const c of commands) sizes.set(c.pipeline, (sizes.get(c.pipeline) ?? 0) + 1);
  const pipelines = new Map<number, { names: boolean; reads: boolean }>();
  let named = false;
  for (const c of commands) {
    if (await namesGuardedDocs(c.outputs, judge)) return WRITES;
    const word = (c.words[0] ?? "").toLowerCase();
    const bodyData = (word === "cat" || word === "tee") && sizes.get(c.pipeline) === 1;
    const inWords = await namesGuardedDocs(c.words, judge);
    const inBodies = await namesGuardedDocs(c.bodies, judge);
    const inSubs = subs.some((s, i) => subNames[i] && s.from >= c.from && s.to <= c.to);
    const names = inWords || (inBodies && !bodyData) || inSubs;
    named ||= inWords || inBodies || inSubs;
    // A tee or Tee-Object that names no docs/ path itself copies the
    // pipeline's text off docs/, so it reads in the pipeline check.
    const reads = readsOnly(c, cmd.slice(c.from, c.to)) || (/^(?:tee|tee-object)$/.test(word) && !names);
    const seen = pipelines.get(c.pipeline) ?? { names: false, reads: true };
    pipelines.set(c.pipeline, { names: seen.names || names, reads: seen.reads && reads });
  }
  for (const { names, reads } of pipelines.values()) if (names && !reads) return WRITES;
  return { writes: false, names: named, delimiter: null, capped: false };
}

// The fixed words of the hook's refusal after the agent type, which the
// shadow reading looks for in the command hook's error text.
export const DOCS_WRITE_COMMAND_PHRASE = "subagent may not write into docs/. docs/ holds curated content only";

// The sentence a shell command's refusal carries after the file refusal's
// text, one space after its closing period and before its trailing newline.
export const DOCS_READ_SENTENCE =
  "A shell command naming a docs/ path runs for a governed agent only as a read (cat, grep, sed -n, git diff and their kin).";

// What the guard reaches through hooks/index.ts: the path host for one call,
// and the fold and bracket guard a quoted command word takes on its way to
// the model, which the refused heredoc delimiter word passes through.
export type DocsWriteDeps = { lexHost(): Promise<LexHost>; quote(text: string): string };

/**
 * Denies a subagent's write into the project's docs/, by the file a Write,
 * Edit or MultiEdit names or by a shell command naming a docs/ path other
 * than as a read, with the hook's refusal as the reason. A call from the main loop matches
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
      const refusal =
        `Blocked: the ${t} subagent may not write into docs/. docs/ holds curated content only ` +
        `(plans and the docs-curator's docs). A report or scratch file goes to .kit/ (gitignored), ` +
        `and the durable record is the plan's Chapter. Write to .kit/ instead, or return the content ` +
        `in your final message.`;
      const judge = guardedDocsJudge(cwd, host);
      if (fp && (await judge(fp))) return { deny: `${refusal}\n` };
      if (typeof e.command !== "string") return {};
      // A PowerShell line ending in a backtick continues onto the next line,
      // the way a bash backslash-newline does, and a backslash-newline there
      // continues nothing, so every such pair is excluded from the splice and
      // the newline stays a line break. On Bash the pair ending a word-start
      // comment is excluded, since bash ends the comment at the newline.
      const unix = e.command.replace(/\r\n/g, "\n");
      const command = e.tool === "PowerShell" ? unix.replace(/`\n/g, "  ") : unix;
      const exclusion: PairExclusion = e.tool === "PowerShell" ? "all" : "comment";
      // The command is read under every reading of its continuations, the
      // two-space reading first so every refusal it gives keeps its reason
      // byte for byte, and a refusal from any reading is the guard's refusal.
      // That family runs under the legacy reading of comments and heredoc
      // bodies first. Where it allows and the exact reading can differ, by
      // `exactReadingDiffers`, it runs again under the exact reading, so a
      // refusal from any pairing of a continuation reading with either
      // stands. The memo holds each nested text's composed reading for this
      // call.
      const memo: VerdictMemo = new Map();
      const under = (exact: boolean) => readUnderContinuations(command, exact, (text, join, boundary) => readShell(text, judge, 0, join, boundary, exact, exclusion, memo), refusedReading, () => CAPPED, allowedReading, exclusion);
      let reading = await under(false);
      if (!refusedReading(reading) && exactReadingDiffers(command)) reading = await under(true);
      // A delimiter fault stops the read before any docs/ path is weighed, so
      // its refusal names the fault and its way around, never a docs/ write.
      // A text past the in-word continuation cap is refused unread the same
      // way.
      if (reading.delimiter !== null) {
        const what = delimiterWhat(reading.delimiter, deps.quote);
        return {
          deny:
            `Blocked: the docs/ write guard cannot tell whether the ${t} subagent's command writes into docs/, ` +
            `because the command is ${what}, refused before its body is read. ${delimiterAdvice(reading.delimiter)}.\n`,
        };
      }
      if (reading.capped) {
        return {
          deny:
            `Blocked: the docs/ write guard cannot tell whether the ${t} subagent's command writes into docs/, ` +
            `because the command carries more than ${IN_WORD_PAIR_CAP} line continuations inside its words, past what the guard reads. ` +
            `${CONTINUATION_CAP_ADVICE}.\n`,
        };
      }
      if (reading.writes) return { deny: `${refusal} ${DOCS_READ_SENTENCE}\n` };
      return {};
    },
  };
}
