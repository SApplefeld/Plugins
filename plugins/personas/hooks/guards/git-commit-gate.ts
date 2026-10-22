// git-commit-gate.ts: the before-tool guard that holds the commit discipline
// at the call: stage, commit and push as separate plain calls, stage by name,
// and title each commit on the house shape.
//
// It binds every session the module loads in, the main loop and every
// subagent alike, and keys on no agent type. It reads a Bash or PowerShell
// call's command and finds every git add, git stage, git commit and git push
// in it, and every git call whose subcommand it cannot know: one with no
// subcommand word after its global flags, one whose subcommand word the shell
// may rewrite or that is off a subcommand name's shape, and one whose -c or
// --config-env defines a git alias. It finds them at the top level, inside a
// command substitution, and inside a nested shell's payload, to the depth the
// read-only guard scans. A command running none of them passes. A command
// running any is judged in this order, and denied at the first rule it meets:
//   a git add and a git commit in one command, and a git commit and a git
//     push in one command, wherever each stands;
//   any other command holding one that is not one lone plain git command,
//     with the advice to run each git step as its own call and to write
//     git -C <dir> for a subdirectory. A lone command is one line whose first
//     word is git, holding no separator, pipe, background &, subshell, brace
//     group, script block, redirect, heredoc or backtick, so the shell runs
//     that one git call and nothing else (isLone states the reading). A
//     substitution on a lone command leaves it lone, its word refused below as
//     one the shell rewrites. A wrapper ahead of git, such as env, xargs or sudo, makes
//     git's word other than the first, so the command is compound;
//   on the lone command, the git-grammar refusals below.
// The git-grammar refusals deny:
//   a blanket git add, git stage being the same command: -A, --all, -u,
//     --update or --no-ignore-removal (git's other name for --all), alone, in
//     a short-flag cluster or as any abbreviation git accepts for the long
//     form; --pathspec-from-file, whose paths the guard cannot read; or an
//     operand that is ., a glob (one holding *, ? or [), pathspec magic (one
//     opening with :, such as :/), or a path that resolves to a directory
//     where the add runs;
//   a git commit carrying -a or --all, alone, in a short-flag cluster or as
//     any abbreviation git accepts for the long form, or a
//     --pathspec-from-file or an operand the blanket add rules refuse;
//   a git commit whose title is off the shape titleFault states, the title
//     being the first non-blank line of its first -m, or of the file its -F
//     names;
//   a git commit whose message the guard cannot read: an -m value holding a
//     variable, -F - (standard input), an -F file that cannot be read or
//     whose name is a Windows device such as CON or COM1, and a commit that
//     names no message outside the closed list below. An -m value
//     built by a substitution, the heredoc inside a substitution among them,
//     takes this rule, and so does -F - fed by a heredoc or a pipe;
//   a lone git add, commit or push holding a word the shell may rewrite before
//     git reads it (a variable, glob, escape or PowerShell expression) after
//     its git word, with the read-only guard's spelling advice, read after the
//     refusals above, so a command the guard does resolve is refused on what
//     it resolves to. A $, as a variable or a substitution spells it, marks
//     its word as one the shell rewrites rather than the command as compound,
//     so git add $f takes this refusal and git commit -m "$msg" the one above;
//   a lone git whose -c or --config-env defines a git alias, since the alias
//     value holds the subcommand git runs;
//   a lone git whose subcommand word the shell may rewrite or is off a
//     subcommand name's shape (git $(echo add) .), or whose -c or
//     --config-env value the shell may rewrite, since that value may define
//     an alias (git -c $a a .), with the spelling advice.
// A lone git with no subcommand word, such as git --version or git -C dir,
// passes where every word after its git word is literal.
// It passes a commit that names no message of its own, and the list is
// closed: --amend with --no-edit, -C, -c, --fixup, --squash and -t, each in
// its short or long spelling. An -m or an -F beside any of them is the
// message git records, so its title is checked. Every long commit option is
// read as the full option it abbreviates, as git reads it, so --mess is
// --message and takes the next word as its value.
//
// A title refusal quotes an -m title, the model's own words, folded to one
// line, cut to TITLE_SHOWN characters and its brackets neutralized. Every
// other command word a refusal quotes takes the same fold and bracket guard.
// A title read from an -F file is never quoted: the refusal names the fault
// and the file as the command spelled it, since the file can hold text the
// model never wrote and the deny text reaches the model and the decision
// journal as written.
//
// The directory a lone add or commit runs in is the session's working
// directory, moved by each git -C before the verb, so a directory operand and
// a relative -F path resolve where git resolves them. It is placed once per
// call. A call with no working directory skips the directory test, and its -F
// file cannot be read.
//
// Every heredoc body is searched as command text, on a PowerShell call too,
// where the lexer reads no <# block comment as a comment. The search
// reads each { and } outside quotes as a ;, so a git word opening a PowerShell
// script block stands in command position.
//
// The lone rule costs false refusals, by design, since a shape the lexer could
// misread fails closed rather than open. Any chain, pipeline, wrapper,
// redirect or heredoc beside a git add, commit or push refuses, cd sub && git
// commit included: run each git step as its own call, and write git -C sub in
// place of the cd. A heredoc writing a document whose prose holds a git add,
// commit or push refuses too, since its body is read as command text: write
// the document with the Write tool, and run the git step on its own with
// git -C where it needs a directory. Where the body names a git add and a git
// commit, or a git commit and a git push, the chain refusal answers first with
// its own advice, and the Write tool is still the way around it. A git with no
// subcommand word inside a compound command refuses as compound too,
// git --version && node -v included, and so does a bare git word standing as
// an operand, as in which git, since the lexer reads it as a git call with no
// subcommand word. Where every git word a compound command holds reads as an
// operand, one with no word after it or a literal word off a subcommand
// name's shape, the refusal says to quote the word git. The word after git
// decides it: grep -rn git docs passes, since the guard reads docs as a
// subcommand it does not govern, while grep -rn git docs/ refuses. A # comment
// after a lone Bash git add or commit is read as words too, so a comment
// holding a character off a literal word's shape refuses: drop the comment.
//
// A ~/ path is read as the home directory only where bash expands it: on a
// Bash call, the ~ unquoted, the word on HOME_WORD's shape. Any other word
// opening with ~, a quoted one or one on a PowerShell call, which hands git the
// ~ as written, is refused as a word the guard cannot resolve, so a title is
// never checked from a file git does not read.
//
// On a PowerShell call a backslash outside quotes is a path separator, since
// PowerShell hands it to git as written, so docs\a.md resolves. Under Bash it
// is an escape the shell drops, and the word is refused as one the guard
// cannot resolve.
//
// The bar: the guard refuses the ordinary mistakes a cooperative session
// makes under load, and fails closed on a word the lexer marks unresolved. A
// shape the lexer mis-settles rather than flags, or one only a session evading
// the guard would spell, is a residual, listed below as the read-only guard
// lists its own.
//
// Out of its reach: a git name the shell rewrites, the split-name shape the
// read-only guard also leaves a miss, since the lexer finds git only where
// its name stands unquoted and whole: a quoted name ("git" add . or
// 'git' add .), a name split by an empty quote or an escape (g''it add . or
// gi\t add .), a name a variable supplies (G=git; $G add .), and on a
// PowerShell call a quoted path after the call operator
// (& "C:\Program Files\Git\cmd\git.exe" add .); a git alias defined outside
// the command line, in a config file or through GIT_CONFIG_PARAMETERS or
// GIT_CONFIG_GLOBAL in the environment, which the call does not show; a
// command git runs from a config value other than an alias, such as
// core.pager, core.sshCommand or diff.external, the read-only guard's own
// declared residual; a command
// nested past the depth the read-only guard scans, which passes; a git verb
// inside a quoted payload for an interpreter the read-only lexer does not
// open as a shell; and a script written in one call and run in a later one,
// since no single call shows both. The rule to read git diff --cached
// --name-only before the commit stays with the doctrine, since no single call
// shows it.
// The residual false hit is the lexer's: an unquoted git word in an operand
// list on a command line (echo git add .) reads as an invocation, and the
// command refuses as compound.
//
// The command is read through the read-only guard's lexer, in the order the
// shared-state guard reads it. A command with no "git" in it is passed by the
// matcher before any lexing, so the common shell call pays one string scan,
// and the lex host is built only where a path must be placed. A failure while
// reading a command denies, naming the failure, so the guard never throws to
// the runner and never passes a command it could not finish reading.
//
// Nothing here reads `$` (runner.ts says why). The path arithmetic and the
// directory test go through the LexHost hooks/index.ts builds, and the -F file
// is read through this guard's own readFile dependency, so LexHost is
// unchanged.

import type { BeforeGuard, GuardCall, GuardContext } from "./runner";
import {
  GIT_VALUE_FLAGS, commandPositions, heredocBodies, maskQuoted, nestedPayloads, resolveTarget, segment,
  spliceContinuations, tokens, type LexHost,
} from "./readonly-agent";

// A half-open range of command indexes, the lexer's own span shape.
type Span = { from: number; to: number };

// The depth the read-only guard scans nested command text to; past it an
// unread payload passes here, as it does in the shared-state guard.
const DEPTH_BOUND = 2;

// The doctrine bullets each refusal enforces, by their opening words.
const WINDOW_RULE = "On a checkout another session may commit to, the index is a window";
const TITLE_RULE = "A commit title is the index line";
const SCOPE_RULE = "Stay in scope";

// One refusal line: what the command does, what to do instead, and the
// doctrine bullet the refusal enforces.
function refusal(what: string, instead: string, rule: string): string {
  return `Blocked: git-commit-gate refuses ${what}. ${instead} (the doctrine's "${rule}" rule).\n`;
}

const ADD_AND_COMMIT = refusal(
  "a git add and a git commit in one command",
  "Stage the files in one call, read git diff --cached --name-only as its own step, then commit in a later call",
  WINDOW_RULE,
);

const COMMIT_AND_PUSH = refusal(
  "a git commit and a git push in one command",
  "Commit in one call, read the landed commit's file list with git show --name-only, then push in a later call",
  WINDOW_RULE,
);

const COMPOUND = refusal(
  "a git add, commit or push inside a compound command",
  "Run each git step as its own plain call, and write git -C <dir> in place of cd <dir> && git",
  WINDOW_RULE,
);

const GIT_OPERAND = refusal(
  "a git word it cannot read as a git step inside a compound command",
  "Quote the word git where it stands as an operand (grep 'git' file), and run each git step as its own plain call",
  WINDOW_RULE,
);

const ALIAS_DEFINED = refusal(
  "a git alias defined on the command line (the subcommand is in the alias value, not on the command line)",
  "Run the git step the alias stands for as its own plain call",
  WINDOW_RULE,
);

const MESSAGE_ADVICE = "Write the message to a file and pass -F with its path";
const STDIN_MESSAGE = refusal("a commit message read from standard input (git commit -F -)", MESSAGE_ADVICE, TITLE_RULE);

// True when a commit's words name standard input as its message file, spelled
// -F -, -F-, --file - or --file=-, each word literal.
function readsStdin(args: readonly Word[]): boolean {
  return args.some((w, k) => w.literal && (w.text === "-F-" || w.text === "--file=-"
    || ((w.text === "-F" || w.text === "--file") && args[k + 1]?.literal === true && args[k + 1].text === "-")));
}

// A path's last element naming a Windows device, in any letter case and with
// any extension, which Windows opens as the device wherever it stands, so a
// read of it can wait on the console rather than return.
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

// A command word as the deny quotes it: a substitution span rides out of the
// lexer as its sentinel bytes, which are named as what they stand for, in the
// read-only guard's own words, and the word then takes the quote dependency,
// the fold and bracket guard, since a quoted word can carry a line break or a
// bracket the model would read as a line the guard wrote.
function shown(word: string, io: GateIo): string {
  return io.quote(word.replace(/\x02+/g, "$(unresolved substitution)"));
}

// The advice every refusal of a path the guard will not stage or commit
// whole carries, in the verb the command spelled.
function nameEachFile(verb: string): string {
  return `Name each file you changed (git ${verb} path/to/file)`;
}

function blanketPath(verb: string, word: string, io: GateIo): string {
  return refusal(
    `a blanket git ${verb} (git ${verb} ${shown(word, io)}), which ${verb === "commit" ? "commits" : "stages"} every change under it, another session's included`,
    nameEachFile(verb),
    SCOPE_RULE,
  );
}

function pathspecMagic(verb: string, word: string, io: GateIo): string {
  return refusal(
    `a git ${verb} pathspec it cannot bound (git ${verb} ${shown(word, io)} is pathspec magic, which can name any file in the tree)`,
    nameEachFile(verb),
    SCOPE_RULE,
  );
}

function pathspecFromFile(verb: string, word: string, io: GateIo): string {
  return refusal(
    `a git ${verb} that reads its paths from a file (git ${verb} ${shown(word, io)}), which it cannot bound`,
    nameEachFile(verb),
    SCOPE_RULE,
  );
}

function commitAll(flag: string, io: GateIo): string {
  return refusal(
    `git commit ${shown(flag, io)}, which stages every tracked change, another session's included`,
    "Stage the files you changed by name, then commit without it",
    SCOPE_RULE,
  );
}

// The read-only guard's spelling advice for a word it cannot resolve, keyed
// to the verb's bullet.
function unresolvedWord(verb: string, word: string, io: GateIo): string {
  return refusal(
    `a git ${verb} it cannot resolve (${shown(word, io)} is a word the shell may rewrite before git reads it: a variable, brace, glob, escape or PowerShell expression)`,
    "Spell each word literally, single-quoted where it carries a special character",
    verb === "commit" ? TITLE_RULE : SCOPE_RULE,
  );
}

// The title shape: an UPPERCASE prefix of letters, digits and hyphens, a colon
// and a space, then a capital letter, digit, backtick or quote, a closing
// period, and at most TITLE_CEILING characters. The fault named is the first
// one in that reading order after the prefix, with the closing period read
// ahead of the opening character and the length last, so each refusal names
// the one part a title missed. No fault quotes the title.
const TITLE_PREFIX = /^[A-Z0-9-]+: /;
const TITLE_OPENING = /^[A-Z0-9-]+: [A-Z0-9`'"]/;
const TITLE_CEILING = 100;

// The most of an -m title a refusal quotes, the cut index.ts gives a stored
// title.
const TITLE_SHOWN = 80;

function titleFault(title: string): string | null {
  if (!TITLE_PREFIX.test(title)) return "it does not open with an UPPERCASE prefix of letters, digits and hyphens, a colon and a space";
  if (!title.endsWith(".")) return "it does not close with a period";
  if (!TITLE_OPENING.test(title)) return "the text after its prefix does not open with a capital letter, digit, backtick or quote";
  const length = [...title].length;
  if (length > TITLE_CEILING) return `it runs ${length} characters, past the ${TITLE_CEILING}-character ceiling`;
  return null;
}

// The title git records from a message under the whitespace cleanup it gives
// -m and -F: the first line that is not blank, trailing whitespace removed.
function titleOf(message: string): string {
  const first = message.replace(/\r\n/g, "\n").split("\n").find((line) => line.trim() !== "");
  return first === undefined ? "" : first.replace(/\s+$/, "");
}

// The refusal for a message's title, or null where it is on the shape. An -m
// title (file null) is cut, then quoted through the quote dependency, the
// fold and bracket guard every model-bound text in the module takes. A title
// read from a file is named by the file alone.
function titleReason(message: string, file: string | null, quote: (text: string) => string): string | null {
  const title = titleOf(message);
  const fault = titleFault(title);
  if (fault === null) return null;
  const subject = file === null
    ? `the commit title "${quote([...title].slice(0, TITLE_SHOWN).join(""))}"`
    : `the commit title in the -F file ${quote(file)}`;
  return refusal(
    `${subject}, since ${fault}`,
    `A title is an UPPERCASE prefix, a colon and a space, then a capital letter, digit, backtick or quote, closing with a period within ${TITLE_CEILING} characters; rewrite it to that shape`,
    TITLE_RULE,
  );
}

// An add short-flag cluster that stages every change: one holding A or u,
// since every short flag git add takes is boolean.
const BLANKET_ADD_SHORT = /^-[A-Za-z]*[Au][A-Za-z]*$/;

// The long add options that stage every change. --no-ignore-removal is git's
// other name for --all.
const BLANKET_ADD_LONG = ["--all", "--update", "--no-ignore-removal"];

const PATHSPEC_FROM_FILE = "--pathspec-from-file";

// True where a word spells a long option as git reads it: the option itself
// or an abbreviation of it, since git takes any unambiguous prefix of a long
// option (--al is --all), with any =value after it. A prefix git would refuse
// as ambiguous matches too, which refuses a command git would not run.
function longSpelling(word: string, option: string): boolean {
  const eq = word.indexOf("=");
  const name = eq < 0 ? word : word.slice(0, eq);
  return name.length >= 3 && name.startsWith("--") && option.startsWith(name);
}

// An operand that names everything under it as written: ., ./ or .\, or a
// glob, which git expands as a pathspec whether or not the shell does.
const BLANKET_OPERAND = /^\.[\\/]?$|[*?[]/;

// The short commit flags that take a value: the rest of the cluster where any
// is left, else the next word. -S and -u take an optional value attached to
// the cluster and so end it.
const COMMIT_SHORT_VALUE = "mFCct";
const COMMIT_SHORT_OPTIONAL = "Su";

// The long options git commit takes, by full name, the set an abbreviation is
// read against. Of the negated forms git also accepts, the list holds
// --no-edit, which the guard reads, and the two git names as options of their
// own. A negation it lacks is read as naming no option.
const COMMIT_LONG = [
  "--ahead-behind", "--all", "--allow-empty", "--allow-empty-message", "--amend", "--author", "--branch", "--cleanup",
  "--date", "--dry-run", "--edit", "--file", "--fixup", "--gpg-sign", "--include", "--interactive", "--long", "--message",
  "--no-edit", "--no-post-rewrite", "--no-verify", "--null", "--only", "--patch", "--pathspec-file-nul",
  "--pathspec-from-file", "--porcelain", "--post-rewrite", "--quiet", "--reedit-message", "--reset-author",
  "--reuse-message", "--short", "--signoff", "--squash", "--status", "--template", "--trailer", "--untracked-files",
  "--verbose", "--verify",
];

// The long commit options that take the next word as their value where no =
// joins one to them.
const COMMIT_LONG_VALUE = new Set([
  "--message", "--file", "--reuse-message", "--reedit-message", "--fixup", "--squash", "--template", "--author", "--date",
  "--cleanup", "--trailer", "--pathspec-from-file",
]);

// The full commit options a long option's name spells: the option it names
// exactly, else every option it abbreviates, since git takes any unambiguous
// prefix of a long option (--mes is --message). A prefix naming more than one
// is read as each of them, as longSpelling reads an add option, and git
// refuses that command as ambiguous, so nothing it commits rides on the
// reading. A name that abbreviates no option names none.
function commitLongOf(name: string): string[] {
  if (COMMIT_LONG.includes(name)) return [name];
  return COMMIT_LONG.filter((o) => longSpelling(name, o));
}

// The options under which a commit names no message of its own, each taking
// its message from a commit or a template, the long ones by full name.
// --amend joins them only with --no-edit.
const NO_OWN_MESSAGE = new Set(["-C", "-c", "--reuse-message", "--reedit-message", "--fixup", "--squash", "-t", "--template"]);

// What a lone git add or commit's own words earn: the refusal and, apart, the
// first word the guard could not resolve.
type Invocation = { verb: string; reason: string | null; unresolved: string | null };

// A word as the lexer read it: its text, and whether the shell hands it to git
// as written.
type Word = { text: string; literal: boolean };

// Where an invocation's paths resolve: the lex host, and the directories the
// verb runs in or the word that stops the guard from placing them.
type Placement = { host: LexHost; bases: string[] | { word: string } };

// The directory a lone git call runs in, as a list of none or one, or the word
// that stops the guard from placing it: the session's working directory,
// moved by the git -C values in order. No working directory answers none.
function basesOf(cwd: string | null, dirs: readonly Word[], host: LexHost): string[] | { word: string } {
  if (cwd === null) return [];
  let base = cwd;
  for (const d of dirs) {
    if (!d.literal) return { word: d.text };
    const r = resolveTarget(d.text, base, host);
    if (r === null) return { word: d.text };
    base = r;
  }
  return [base];
}

// What one pathspec operand of a git add or commit earns: a refusal where it
// names more than one file as written (pathspec magic, ., a glob) or resolves
// to a directory where the verb runs, the refusal for a word the guard cannot
// place, or null.
async function operandOf(verb: string, a: Word, place: () => Promise<Placement>, io: GateIo): Promise<{ reason: string } | { unresolved: string } | null> {
  if (a.text.startsWith(":")) return { reason: pathspecMagic(verb, a.text, io) };
  if (BLANKET_OPERAND.test(a.text)) return { reason: blanketPath(verb, a.text, io) };
  if (!a.literal) return { unresolved: unresolvedWord(verb, a.text, io) };
  const { host, bases } = await place();
  if (!Array.isArray(bases)) return { unresolved: unresolvedWord(verb, bases.word, io) };
  for (const b of bases) {
    const resolved = resolveTarget(a.text, b, host);
    if (resolved === null) return { unresolved: unresolvedWord(verb, a.text, io) };
    if (await host.isDirectory(resolved)) return { reason: blanketPath(verb, a.text, io) };
  }
  return null;
}

// A git add, or git stage under its own name: blanket flags and operands,
// then each remaining operand placed under the directories the add runs in. A
// blanket shape anywhere wins over a word the guard could not resolve.
async function addOf(verb: string, args: readonly Word[], place: () => Promise<Placement>, io: GateIo): Promise<Invocation> {
  let unresolved: string | null = null;
  let operandsOnly = false;
  for (const a of args) {
    if (!operandsOnly && a.literal && a.text === "--") { operandsOnly = true; continue; }
    if (!operandsOnly && a.literal && a.text.startsWith("-")) {
      if (BLANKET_ADD_SHORT.test(a.text) || BLANKET_ADD_LONG.some((o) => longSpelling(a.text, o))) {
        return { verb: "add", reason: blanketPath(verb, a.text, io), unresolved };
      }
      if (longSpelling(a.text, PATHSPEC_FROM_FILE)) return { verb: "add", reason: pathspecFromFile(verb, a.text, io), unresolved };
      continue;
    }
    const r = await operandOf(verb, a, place, io);
    if (r === null) continue;
    if ("reason" in r) return { verb: "add", reason: r.reason, unresolved };
    unresolved ??= r.unresolved;
  }
  return { verb: "add", reason: null, unresolved };
}

// A git commit: its -a, its paths, its message sources and the options that
// name no message of its own, read off its words, then judged in that order.
async function commitOf(args: readonly Word[], place: () => Promise<Placement>, io: GateIo): Promise<Invocation> {
  let unresolved: string | null = null;
  let all: string | null = null;
  let fromFile: string | null = null;
  const operands: Word[] = [];
  const messages: Word[] = [];
  let file: Word | null = null;
  let amend = false;
  let noEdit = false;
  let reuse = false;
  const take = (name: string, value: Word | null) => {
    if (name === "-m" || name === "--message") messages.push(value ?? { text: "", literal: true });
    else if (name === "-F" || name === "--file") file = value;
    else if (NO_OWN_MESSAGE.has(name)) reuse = true;
  };
  let operandsOnly = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (operandsOnly || !a.text.startsWith("-") || a.text === "-") {
      if (!a.literal) unresolved ??= unresolvedWord("commit", a.text, io);
      operands.push(a);
      continue;
    }
    if (a.literal && a.text === "--") { operandsOnly = true; continue; }
    if (a.text.startsWith("--")) {
      const eq = a.text.indexOf("=");
      const name = eq < 0 ? a.text : a.text.slice(0, eq);
      let value: Word | null = eq < 0 ? null : { text: a.text.slice(eq + 1), literal: a.literal };
      if (eq < 0 && !a.literal) { unresolved ??= unresolvedWord("commit", a.text, io); continue; }
      // Each option the name spells, read by its full name, so an
      // abbreviated value option takes its next word as the full one does.
      const options = commitLongOf(name);
      if (eq < 0 && options.some((o) => COMMIT_LONG_VALUE.has(o))) {
        value = args[k + 1] ?? null;
        k++;
      }
      for (const o of options) {
        if (o === PATHSPEC_FROM_FILE) fromFile ??= a.text;
        else if (o === "--all") all = a.text;
        else if (o === "--amend") amend = true;
        else if (o === "--no-edit") noEdit = true;
        else take(o, value);
      }
      continue;
    }
    // A short-flag cluster: boolean letters until one that takes a value.
    let valued = false;
    for (let j = 1; j < a.text.length; j++) {
      const c = a.text[j];
      if (COMMIT_SHORT_VALUE.includes(c)) {
        const rest = a.text.slice(j + 1);
        if (rest !== "") take(`-${c}`, { text: rest, literal: a.literal });
        else { take(`-${c}`, args[k + 1] ?? null); k++; }
        valued = true;
        break;
      }
      if (COMMIT_SHORT_OPTIONAL.includes(c)) { valued = true; break; }
      if (c === "a") all = a.text;
    }
    if (!valued && !a.literal) unresolved ??= unresolvedWord("commit", a.text, io);
  }
  const reasonOf = async (): Promise<string | null> => {
    if (all !== null) return commitAll(all, io);
    if (fromFile !== null) return pathspecFromFile("commit", fromFile, io);
    for (const o of operands) {
      const r = await operandOf("commit", o, place, io);
      if (r === null) continue;
      if ("reason" in r) return r.reason;
      unresolved ??= r.unresolved;
    }
    if (messages.some((m) => !m.literal)) {
      return refusal("a commit message the shell rewrites before git reads it (an -m value holding a variable or a substitution)", MESSAGE_ADVICE, TITLE_RULE);
    }
    const f = file as Word | null;
    if (f !== null && f.literal && f.text === "-") return STDIN_MESSAGE;
    if (messages.length > 0) return titleReason(messages[0].text, null, io.quote);
    if (f === null) {
      if (reuse || (amend && noEdit)) return null;
      return refusal("a git commit that names no message, whose title it cannot check", "Pass -m with a title on the shape, or -F with a file whose first line is on it", TITLE_RULE);
    }
    if (!f.literal) { unresolved ??= unresolvedWord("commit", f.text, io); return null; }
    if (DEVICE_NAME.test(f.text.split(/[\\/]/).pop() ?? "")) {
      return refusal(`a commit message file that names a device (${shown(f.text, io)}), which git reads until the device closes`, "Write the message to a file with an ordinary name, then pass -F with its path", TITLE_RULE);
    }
    const { host, bases } = await place();
    if (!Array.isArray(bases)) { unresolved ??= unresolvedWord("commit", bases.word, io); return null; }
    for (const b of bases) {
      const resolved = resolveTarget(f.text, b, host);
      if (resolved === null) { unresolved ??= unresolvedWord("commit", f.text, io); return null; }
      const text = await io.readFile(resolved);
      if (text !== null) return titleReason(text, f.text, io.quote);
    }
    return refusal(`a commit message file it cannot read (${shown(f.text, io)})`, "Write the file in its own call first, then pass -F with its path", TITLE_RULE);
  };
  const reason = await reasonOf();
  return { verb: "commit", reason, unresolved };
}

// A segment's literal flags as PowerShell reads them. tokens() marks a word
// holding a backslash outside quotes as one the shell may rewrite, which is
// bash's reading, since bash drops a backslash before a letter. PowerShell
// hands it to git as written, so each such backslash is read as the path
// separator it is, by reading the segment again with it spelled as a slash.
// A backslash before a quote is left to tokens(), as is every other
// character, so a $, a backtick or a brace stays one the shell may rewrite.
// `segMasked` is the masked command over the segment's range, where a
// backslash still standing is one outside quotes.
function powershellLiteral(seg: string, segMasked: string): boolean[] {
  const chars = seg.split("");
  for (let k = 0; k < chars.length; k++) {
    if (chars[k] === "\\" && segMasked[k] === "\\" && chars[k + 1] !== '"' && chars[k + 1] !== "'") chars[k] = "/";
  }
  const literal: boolean[] = [];
  tokens(chars.join(""), literal);
  return literal;
}

// The verbs the guard governs. git stage is git add under another name.
const GOVERNED_VERBS = new Set(["add", "stage", "commit", "push"]);

// A word git can read as a subcommand name.
const SUBCOMMAND_SHAPE = /^[A-Za-z][A-Za-z0-9-]*$/;

// A config key defining a git alias, the bound the read-only guard reads: -c
// alias.x=..., --config-env alias.x=... or --config-env=alias.x..., the key
// in any letter case.
const ALIAS_KEY = /^alias\./i;
const ALIAS_JOINED = /^--config-env=alias\./i;

// A word whose one character outside tokens()'s literal set is a leading ~
// before a slash. On a Bash call, where tokens() marked such a word
// rewritten, the ~ standing unquoted, bash expands it to the home directory,
// one fixed value, and resolveTarget expands it the same way, so it is read as
// literal. Every other word opening with ~ is read as one the guard cannot
// resolve: resolveTarget expands a ~ whether or not it was quoted, while bash
// hands git a quoted ~ as written and PowerShell any ~.
const HOME_WORD = /^~\/[A-Za-z0-9_\-./:=,+]*$/;

// Why a git call's verb is unknown to the guard: no verb word is left after
// its global flags (absent); the verb word, or a -c or --config-env value
// ahead of it, is one the shell rewrites, or the verb word is off a subcommand
// name's shape (unread), since a rewritten config value may define an alias;
// or a -c or --config-env ahead of it defines a git alias, whose real verb
// sits in the alias value (alias).
type UnknownVerb = { why: "absent" } | { why: "unread"; word: string; literal: boolean } | { why: "alias" };

// One git call the guard governs: a git add, stage, commit or push, or a call
// whose verb it cannot know. Its verb, lowercased, or "unknown" with why; the
// nesting depth it was found at; the index just past its git word in the
// command it was found in; the -C values ahead of the verb; every word after
// the git word; and the words after the verb.
type GitCall = { verb: string; unknown: UnknownVerb | null; depth: number; at: number; dirs: Word[]; words: Word[]; args: Word[] };

// The git call whose words start at `at`, or null where its verb is a
// literal, well-shaped one the guard does not govern and no alias is defined
// ahead of it: its global flags stepped over as the read-only guard steps
// over them, with each -C value kept and each alias key noted, then its verb.
// `powershell` is true for the words of a PowerShell call's own command line.
function gitCallAt(cmd: string, masked: string, at: number, depth: number, powershell: boolean): GitCall | null {
  const seg = segment(cmd, masked, at);
  let literal: boolean[] = [];
  const toks = tokens(seg, literal);
  if (powershell) {
    const read = powershellLiteral(seg, masked.slice(at, at + seg.length));
    if (read.length === literal.length) literal = read;
  }
  const words: Word[] = toks.map((text, k) => ({ text, literal: text.startsWith("~") ? !powershell && HOME_WORD.test(text) && !literal[k] : literal[k] }));
  const dirs: Word[] = [];
  let alias = false;
  let config: string | null = null;
  let i = 0;
  while (i < words.length && words[i].text.startsWith("-")) {
    const flag = words[i].text;
    if (flag === "-C" && i + 1 < words.length) dirs.push(words[i + 1]);
    if (((flag === "-c" || flag === "--config-env") && ALIAS_KEY.test(words[i + 1]?.text ?? "")) || ALIAS_JOINED.test(flag)) alias = true;
    if ((flag === "-c" || flag === "--config-env") && words[i + 1] !== undefined && !words[i + 1].literal) config ??= words[i + 1].text;
    if (/^--config-env=/i.test(flag) && !words[i].literal) config ??= flag;
    i += GIT_VALUE_FLAGS.test(flag) ? 2 : 1;
  }
  const args = words.slice(i + 1);
  const unknown: UnknownVerb | null = alias ? { why: "alias" }
    : config !== null ? { why: "unread", word: config, literal: false }
      : i >= words.length ? { why: "absent" }
        : !words[i].literal || !SUBCOMMAND_SHAPE.test(words[i].text) ? { why: "unread", word: words[i].text, literal: words[i].literal }
          : null;
  if (unknown !== null) return { verb: "unknown", unknown, depth, at, dirs, words, args };
  const verb = words[i].text.toLowerCase();
  if (!GOVERNED_VERBS.has(verb)) return null;
  return { verb, unknown: null, depth, at, dirs, words, args };
}

// A command read the read-only guard's way, in the shared-state guard's
// order: heredoc bodies found on a body-blind mask, so a quote inside a body
// opens no span that would hide the command text after it, continuations
// spliced, then the quote mask, with each substitution interior collected
// into `subs`. A heredoc body stays command text.
function maskOf(cmd: string, subs: Span[]): { cmd: string; masked: string } {
  const bodies = heredocBodies(cmd, maskQuoted(cmd));
  const spliced = spliceContinuations(cmd, bodies);
  return { cmd: spliced, masked: maskQuoted(spliced, bodies, subs) };
}

// Every git add, stage, commit and push the command runs, and every git call
// of unknown verb: the top level's in reading order, then each substitution
// interior and nested payload read one level deeper, to DEPTH_BOUND, as
// command text whatever shell runs it, so only the top level reads a
// PowerShell call's backslashes as separators.
// The search reads each { and } outside quotes as a ;, so a git word opening
// a PowerShell script block, as in if (...) {git add .} or &{git add .},
// stands in command position as PowerShell reads it.
function gitCallsOf(cmd: string, masked: string, subs: readonly Span[], depth: number, powershell: boolean): GitCall[] {
  const search = masked.replace(/[{}]/g, ";");
  const out: GitCall[] = [];
  for (const hit of commandPositions(search, ["git"])) {
    const call = gitCallAt(cmd, search, hit.at, depth, powershell && depth === 0);
    if (call !== null) out.push(call);
  }
  if (depth >= DEPTH_BOUND) return out;
  const inner = [...subs.map((s) => cmd.slice(s.from, s.to)), ...nestedPayloads(cmd, search)];
  for (const text of inner) {
    const innerSubs: Span[] = [];
    const read = maskOf(text, innerSubs);
    out.push(...gitCallsOf(read.cmd, read.masked, innerSubs, depth + 1, powershell));
  }
  return out;
}

// What makes a command compound, read on the masked command, where every
// quoted character is blanked: a separator, pipe or background &; a subshell,
// brace group or script block; a redirect or heredoc; a backtick; a line
// break. A $ is not among them, nor a substitution's sentinel: as a variable
// or a substitution spells it, it marks its word as one the shell rewrites,
// which commitOf or loneReason refuses, and a git call inside a substitution
// is never the lone top-level call.
const COMPOUND_MARK = /[;|&(){}<>`\r\n]/;

// True where the command is one lone plain git command, so the shell runs the
// git call `first` and nothing else: the masked command, trimmed, holds no
// COMPOUND_MARK, and `first` is a top-level call whose git word is the
// command's first word, in any spelling commandPositions accepts (\git, a path
// prefix, .exe).
function isLone(masked: string, first: GitCall): boolean {
  if (first.depth !== 0 || COMPOUND_MARK.test(masked.trim())) return false;
  const lead = masked.length - masked.trimStart().length;
  return !/\s/.test(masked.slice(lead, first.at));
}

// The refusal a lone git call's own words earn, or null. A call of unknown
// verb is refused for a command-line alias or a verb word it cannot read, and
// one with no verb word, such as git --version, goes on with no grammar of its
// own. Then the add or commit grammar's own refusal, then the first word it
// could not resolve, then any other word after the git word the shell may
// rewrite, since a lone command passes only with literal words. The order
// refuses a command the guard does resolve on what it resolves to.
async function loneReason(call: GitCall, cwd: string | null, host: () => Promise<LexHost>, io: GateIo): Promise<string | null> {
  const unknown = call.unknown;
  if (unknown !== null && unknown.why === "alias") return ALIAS_DEFINED;
  if (unknown !== null && unknown.why === "unread") return unresolvedWord("subcommand", unknown.word, io);
  let placed: Promise<Placement> | null = null;
  const place = () => (placed ??= host().then((h) => ({ host: h, bases: basesOf(cwd, call.dirs, h) })));
  const judged = call.verb === "commit" ? await commitOf(call.args, place, io)
    : call.verb === "push" || call.unknown !== null ? null
      : await addOf(call.verb, call.args, place, io);
  if (judged !== null && judged.reason !== null) return judged.reason;
  if (judged !== null && judged.unresolved !== null) return judged.unresolved;
  const rewritten = call.words.find((w) => !w.literal);
  return rewritten === undefined ? null : unresolvedWord(call.unknown === null ? call.verb : "subcommand", rewritten.text, io);
}

// The refusal for a command, or null. A command running no git add, stage,
// commit or push, and no git call of unknown verb, passes. One running any is
// refused by the two chain rules over every named verb it runs, then as
// compound unless it is one lone plain git command, which then takes its own
// words' refusal. So a git with no verb word passes only as the lone command.
// A compound command whose every git word reads as an operand, with no word
// after it or a literal one off a subcommand name's shape, is refused with
// the advice to quote the word. A compound command whose every git call is a
// commit reading its message from standard input, as a heredoc or a pipe
// feeds it, takes the standard-input refusal, whose advice it can follow.
async function gateReason(cmd: string, cwd: string | null, powershell: boolean, host: () => Promise<LexHost>, io: GateIo): Promise<string | null> {
  const subs: Span[] = [];
  const read = maskOf(cmd.replace(/\r\n/g, "\n"), subs);
  const found = gitCallsOf(read.cmd, read.masked, subs, 0, powershell);
  if (found.length === 0) return null;
  const runs = (...verbs: string[]) => found.some((x) => verbs.includes(x.verb));
  if (runs("add", "stage") && runs("commit")) return ADD_AND_COMMIT;
  if (runs("commit") && runs("push")) return COMMIT_AND_PUSH;
  const operands = found.every((x) => x.unknown !== null && (x.unknown.why === "absent" || (x.unknown.why === "unread" && x.unknown.literal)));
  if (found.every((x) => x.verb === "commit" && readsStdin(x.args))) return STDIN_MESSAGE;
  if (!isLone(read.masked, found[0])) return operands ? GIT_OPERAND : COMPOUND;
  return loneReason(found[0], cwd, host, io);
}

// The no-git test the matcher and decide share: a plain scan, in any letter
// case, since the lexer matches the git name in any case.
function namesGit(cmd: unknown): cmd is string {
  return typeof cmd === "string" && /git/i.test(cmd);
}

// What the guard reaches through hooks/index.ts: the lexer's host for one
// call, the text of a file, or null where it cannot be read, and the fold and
// bracket guard a quoted title takes on its way to the model.
export type GitCommitGateDeps = {
  lexHost(): Promise<LexHost>;
  readFile(path: string): Promise<string | null>;
  quote(text: string): string;
};

type GateIo = Pick<GitCommitGateDeps, "readFile" | "quote">;

/**
 * Denies a Bash or PowerShell command that chains a git add with a git commit
 * or a git commit with a git push, holds a git add, commit or push inside a
 * compound command, stages or commits by blanket, commits with -a, commits a
 * title off the shape or a message the guard cannot read, holds a word the
 * shell may rewrite in a lone git add, commit or push, or runs a git whose
 * subcommand it cannot know, a git with no subcommand passing only alone,
 * with one line naming the shape, what to do instead and the doctrine bullet.
 * Any session's call, keyed on no agent type. A command with no "git" in it
 * matches nothing. The cwd is the session's, trimmed.
 */
export function gitCommitGateGuard(deps: GitCommitGateDeps): BeforeGuard {
  return {
    name: "git-commit-gate",
    matches: (e: GuardCall) => (e.tool === "Bash" || e.tool === "PowerShell") && namesGit(e.command),
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const cmd = e.command;
      if (!namesGit(cmd)) return {};
      const cwd = typeof ctx.cwd === "string" && ctx.cwd.trim() ? ctx.cwd.trim() : null;
      let lexHost: Promise<LexHost> | null = null;
      const host = () => (lexHost ??= deps.lexHost());
      try {
        const reason = await gateReason(cmd, cwd, e.tool === "PowerShell", host, deps);
        return reason === null ? {} : { deny: reason };
      } catch (err) {
        const failure = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
        return { deny: refusal(`a command it could not finish reading (${deps.quote(failure)}), rather than pass an unread git add, commit or push`, "Run each git step as its own plain call", WINDOW_RULE) };
      }
    },
  };
}
