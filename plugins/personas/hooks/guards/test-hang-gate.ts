// test-hang-gate.ts: the before-tool guard that holds the hang-limit rule at
// the call: a test run that can hang carries a limit the test runner itself
// enforces, set before the run starts, since a tool timeout ends the call and
// not the process.
//
// It binds every session the module loads in, the main loop and every
// subagent alike, and keys on no agent type. It reads a Bash or PowerShell
// call's command and finds every runner call in it, the table closed at two
// runners: a dotnet (or dotnet.exe) whose first word is test, and a node (or
// node.exe) whose words hold the exact token --test ahead of the first word
// that is neither a -- flag nor the spaced value of a node option the reader
// lists below, so --test-reporter=tap alone and node script.js --test are not
// runner calls. It finds them at the top level, on each side of &&, ||, ;
// and |, inside a subshell, inside a command substitution, and inside a
// nested shell's payload, to the depth the read-only guard scans, the depth
// git-commit-gate.ts states: two levels of nested text, DEPTH_BOUND below.
// A command running none passes: dotnet
// build, dotnet stryker, npx stryker, node test/x.test.js, pytest and
// Invoke-Pester among them, the mutation tool's own run included. A command
// running any is judged runner call by runner call, in reading order, and
// denied at the first that fails its rule.
// A dotnet test call passes where:
//   it carries --blame-hang-timeout with a value in the vendor's timespan
//     form, a number with an optional unit among h, hour, hours, m, min,
//     minute, minutes, s, sec, second, seconds, ms, mil, millisecond and
//     milliseconds, and --blame-hang-dump-type with the value none or mini,
//     in any letter case;
//   or it carries the Microsoft.Testing.Platform trio: the --hangdump switch,
//     --hangdump-timeout with such a value, and --hangdump-type or
//     --hangdump-type-if-supported with the value none or mini, the two type
//     spellings one condition. The vendor gives the platform's dump type a
//     default of Full and never says the timeout arms a dump on its own, so a
//     call carrying any of the four options takes this route and passes only
//     with all three; the VSTest pair is not read on it;
//   or it carries -t, --list-tests, -h, -? or --help, a listing or help call
//     that runs no test.
//   A value is spelled --flag value, --flag=value or --flag:value, and is one
//   token, a number and its unit unspaced; the guard accepts the three
//   spellings on every governed flag, which is its tolerance and not a claim
//   that each runner parses all three. Where a flag repeats, the last wins,
//   the two platform type spellings sharing one slot. Words after a -- are the runner's own settings and are read for
//   the platform options alone, since the vendor states that in VSTest mode a
//   Microsoft.Testing.Platform option is appended after an extra --. A limit
//   set there as a runsettings property does not pass the call, and neither a
//   listing flag nor the VSTest pair is read there. A bare --timeout is that
//   platform's whole-run flag and means nothing to VSTest, which the guard
//   cannot tell apart, so it earns nothing.
// A node --test call passes where it carries --test-timeout with a numeric
//   value, spelled with = or as the next word, among the -- flags ahead of
//   the first word that is not one, since node stops reading its own options
//   at the script or pattern word. The reader steps over the spaced value of
//   a closed list of node's value-taking options, whose next word is the
//   value where the option is spelled without =: --test-reporter,
//   --test-reporter-destination, --test-name-pattern, --test-skip-pattern,
//   --test-concurrency, --test-shard, --import, --require and -r. The spaced
//   value of any other option reads as the script word.
// Otherwise the call is refused, with one line naming the call, the advice
// for each condition that failed, in this order: the timeout flag to add
// where no timeout is present, or on the platform route the switch and its
// timeout where either is missing; the dump type to add where it is absent
// or full, in the route's own spelling; the node flag to add; and the spelling
// advice for each winning value the call's route reads that the shell may
// rewrite before the runner reads it (a variable, a substitution or a
// PowerShell expression), timeout before dump type, each token neutralized
// through the quote dependency as the em-dash guard neutralizes a path. A
// rewritten value counts as supplied, so the refusal names the spelling alone
// and never asks for a flag the call already carries, except that the
// platform advice names the switch and its timeout as one phrase where either
// is missing. A literal value off the shape counts as absent, so dotnet test
// --blame-hang-timeout 10x takes the timeout advice.
//
// The bar: the guard refuses the ordinary call a cooperative session writes
// without the flag, and fails closed on a command it cannot finish reading. A
// shape only a session evading the guard would spell is a residual, listed
// here as the commit gate lists its own.
//
// Out of its reach: a runner under a name the table does not hold, such as
// vstest.console.exe, dotnet vstest, a test project run as an executable, or
// a dotnet test reached through a script, a Makefile target or an npm script,
// since no single call shows the runner; a limit set only in a runsettings
// file; a runner name the shell rewrites or splits, the read-only guard's own
// miss, since the lexer finds dotnet and node only where the name stands
// unquoted and whole ("dotnet" test, dot''net test, D=dotnet; $D test); a
// subcommand word the shell rewrites (dotnet $sub), which reads as no test
// call; a runner started through Start-Process (Start-Process dotnet
// -ArgumentList test), whose first word after dotnet is not test, or inside a
// pwsh -EncodedCommand payload, which the lexer does not decode; a dotnet
// option ahead of the subcommand (dotnet -d test) and dotnet watch test,
// which pass unread; a -t or -h standing as another option's
// value (dotnet test --filter -t), which passes the call as a listing; the
// platform trio after the -- that reaches a VSTest project, alone or in a
// solution mixing VSTest and platform projects, as RunSettings arguments
// that bound nothing; an unbalanced } outside quotes, which ends the call's
// words wherever it stands, on either shell, so a flag after it goes unread; a node call whose --test stands after the spaced value of
// an option the closed list does not hold (node --loader tsx --test x.js),
// which the first-word rule reads as a script call; a command nested past
// the depth the read-only guard scans, which passes; a runner call inside a
// quoted payload for an interpreter the read-only lexer does not open as a
// shell; and whether the value is large enough, since the guard checks the
// limit's presence and spelling and never a ceiling on its value.
// The residual false hits are the lexer's: an unquoted runner name in an
// operand list on a command line (echo dotnet test) reads as an invocation
// and is judged as one; a heredoc body naming a runner is read as command
// text and refused; a PowerShell backtick-newline continuation splits the
// call, which is refused with its flags on the next line unread; and a
// redirect ahead of the flags (dotnet test > out.log --blame-hang-timeout
// 10m) ends the argument list where the shell does not, a false refusal; and
// a brace word inside an eval, iex or cmd /c payload (eval dotnet test
// ${PROJ} --blame-hang-timeout 10m ...) cuts the payload's words, a false
// refusal kept so that a payload opening a PowerShell script block stays
// read.
//
// The command is read through the read-only guard's lexer, in the order the
// shared-state guard reads it: heredoc bodies found on a body-blind mask,
// continuations spliced, then the quote mask, with each substitution interior
// collected and read one level deeper beside each nested payload. A command
// naming neither dotnet nor node as a whole word is passed by the matcher
// before any lexing, so the common shell call pays one string scan. A failure
// while reading a command denies, naming the failure, so the guard never
// throws to the runner and never passes a command it could not finish
// reading.
//
// Nothing here reads `$` (runner.ts says why), and nothing here resolves a
// path, so the guard takes no LexHost.

import type { BeforeGuard, GuardCall } from "./runner";
import { commandPositions, heredocBodies, maskQuoted, nestedPayloads, segment, spliceContinuations, tokens } from "./readonly-agent";

// A half-open range of command indexes, the lexer's own span shape.
type Span = { from: number; to: number };

// The depth the read-only guard scans nested command text to; past it an
// unread payload passes here, as it does in the commit gate.
const DEPTH_BOUND = 2;

// The doctrine bullet every refusal enforces, by its opening words.
const HANG_RULE = "Make the test earn its green";

// The runner names the table holds, as commandPositions matches them: whole,
// in any letter case, with an optional path prefix and executable suffix.
const RUNNERS = ["dotnet", "node"];

// The pre-scan the matcher and decide share: a command naming neither runner
// as a whole word is passed before any lexing. Every byte commandPositions
// accepts on either side of a runner name is a non-word byte, and every text
// the guard reads deeper is cut from the command at such a byte, so the word
// bound drops no call the lexer would find, dotnet.exe and node.exe among
// them.
function namesRunner(cmd: unknown): cmd is string {
  return typeof cmd === "string" && /\b(?:dotnet|node)\b/i.test(cmd);
}

// The vendor's timespan form: a number, decimal allowed, and an optional unit
// among the spellings dotnet test reads, unspaced.
const TIMESPAN = /^\d+(?:\.\d+)?(?:h|hours?|m|min|minutes?|s|sec|seconds?|ms|mil|milliseconds?)?$/i;

// Node's --test-timeout value: a number of milliseconds.
const MILLISECONDS = /^\d+$/;

// The dotnet test words under which no test runs: the listing flag in both
// spellings and the help flags.
const LISTING_OR_HELP: ReadonlySet<string> = new Set(["-t", "--list-tests", "-h", "-?", "--help"]);

// The hang dump types that pass, compared lowercased: none writes nothing and
// ends the host, mini writes a small dump. A full dump of a runaway host is
// the size of the runaway.
const DUMP_TYPES: ReadonlySet<string> = new Set(["none", "mini"]);

// The node options whose next word is their value where they are spelled
// without =, a closed list: the node reader steps over that word rather than
// read it as the script word.
const NODE_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  "--test-reporter", "--test-reporter-destination", "--test-name-pattern", "--test-skip-pattern",
  "--test-concurrency", "--test-shard", "--import", "--require", "-r",
]);

const DOTNET_CALL = "a dotnet test call";
const NODE_CALL = "a node --test call";

// The Microsoft.Testing.Platform hang dump options: any of them on a call
// puts it on the platform route. The two type spellings are one condition,
// the -if-supported form the portable fallback the vendor makes exclusive
// with the other.
const PLATFORM_OPTIONS: ReadonlySet<string> = new Set(["--hangdump", "--hangdump-timeout", "--hangdump-type", "--hangdump-type-if-supported"]);

const ADD_TIMEOUT = "Add --blame-hang-timeout <timespan>, or --hangdump --hangdump-timeout <timespan> --hangdump-type none under Microsoft.Testing.Platform.";
const ADD_DUMP_TYPE = "Add --blame-hang-dump-type none, since a hang dump of a runaway host is the size of the runaway.";
const ADD_HANGDUMP = "Add --hangdump --hangdump-timeout <timespan> under Microsoft.Testing.Platform.";
const ADD_HANGDUMP_TYPE = "Add --hangdump-type none, since a hang dump of a runaway host is the size of the runaway.";
const ADD_NODE_TIMEOUT = "Add --test-timeout=<milliseconds>.";

// One refusal line: the call, the advice for each failed condition in order,
// and the doctrine bullet the refusal enforces.
function refusal(what: string, advice: readonly string[]): string {
  return `Blocked: test-hang-gate refuses ${what} without a runner-enforced hang limit. ${advice.join(" ")} (the doctrine's "${HANG_RULE}" rule).\n`;
}

// What the guard reaches through hooks/index.ts: the fold and bracket guard a
// quoted token takes on its way to the model.
export type TestHangGateDeps = { quote(text: string): string };

// A word as the lexer read it: its text, and whether the shell hands it to the
// runner as written.
type Word = { text: string; literal: boolean };

// A command word as the spelling advice quotes it: a substitution span rides
// out of the lexer as its sentinel bytes, named as what they stand for in the
// read-only guard's own words, then the quote dependency, since a quoted word
// can carry a line break or a bracket the model would read as a line the
// guard wrote.
function spelling(word: string, quote: (text: string) => string): string {
  return `Spell the value as a literal, since the shell may rewrite ${quote(word.replace(/\x02+/g, "$(unresolved substitution)"))}.`;
}

// A long option word split at its first = or :, the two joined-value
// spellings dotnet test takes: the option name, and the joined value or null
// where the word carries none.
function splitOption(text: string): { name: string; joined: string | null } {
  const at = text.search(/[=:]/);
  return at < 0 ? { name: text, joined: null } : { name: text.slice(0, at), joined: text.slice(at + 1) };
}

// The value of the long option at `k`: its joined value, else the next word
// where that word is not a flag, else the empty literal, a flag with no value,
// which fails every shape. `consumed` is set where the next word was taken.
function valueOf(args: readonly Word[], k: number, joined: string | null): { value: Word; consumed: boolean } {
  if (joined !== null) return { value: { text: joined, literal: args[k].literal }, consumed: false };
  const next = args[k + 1];
  if (next !== undefined && !next.text.startsWith("-")) return { value: next, consumed: true };
  return { value: { text: "", literal: true }, consumed: false };
}

// True where a value counts as supplied: a literal on the shape, or a word the
// shell may rewrite, which the spelling advice names instead.
function supplied(value: Word | null, shape: RegExp): boolean {
  return value !== null && (!value.literal || shape.test(value.text));
}

// True where a dump type fails: absent, or a literal off the passing set. A
// value the shell may rewrite takes the spelling advice instead.
function dumpTypeFails(type: Word | null): boolean {
  return type === null || (type.literal && !DUMP_TYPES.has(type.text.toLowerCase()));
}

// The refusal a dotnet test call's words earn, or null where it passes. The
// governed flags are read off the words, last repeat winning, the two
// platform type spellings sharing one slot. After a -- only the platform
// options are read, which the vendor appends there in VSTest mode. Then the
// route: a call carrying any platform option takes the platform route, which
// reads the --hangdump switch, its timeout and its dump type; any other call
// takes the VSTest route, which reads the timeout and the dump type. Each
// winning value the route reads that the shell may rewrite earns its own
// spelling advice, timeout first.
function dotnetReason(args: readonly Word[], quote: (text: string) => string): string | null {
  let blameTimeout: Word | null = null;
  let dumpType: Word | null = null;
  let hangdump = false;
  let hangdumpTimeout: Word | null = null;
  let hangdumpType: Word | null = null;
  let passthrough = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a.text === "--") { passthrough = true; continue; }
    if (!passthrough && LISTING_OR_HELP.has(a.text)) return null;
    if (!a.text.startsWith("--")) continue;
    const { name, joined } = splitOption(a.text);
    if (!PLATFORM_OPTIONS.has(name) && (passthrough || (name !== "--blame-hang-timeout" && name !== "--blame-hang-dump-type"))) continue;
    if (name === "--hangdump") { hangdump = true; continue; }
    const { value, consumed } = valueOf(args, k, joined);
    if (consumed) k++;
    if (name === "--blame-hang-timeout") blameTimeout = value;
    else if (name === "--blame-hang-dump-type") dumpType = value;
    else if (name === "--hangdump-timeout") hangdumpTimeout = value;
    else hangdumpType = value;
  }
  const advice: string[] = [];
  const read: (Word | null)[] = [];
  if (hangdump || hangdumpTimeout !== null || hangdumpType !== null) {
    if (!hangdump || !supplied(hangdumpTimeout, TIMESPAN)) advice.push(ADD_HANGDUMP);
    if (dumpTypeFails(hangdumpType)) advice.push(ADD_HANGDUMP_TYPE);
    read.push(hangdumpTimeout, hangdumpType);
  } else {
    if (!supplied(blameTimeout, TIMESPAN)) advice.push(ADD_TIMEOUT);
    if (dumpTypeFails(dumpType)) advice.push(ADD_DUMP_TYPE);
    read.push(blameTimeout, dumpType);
  }
  for (const value of read) if (value !== null && !value.literal) advice.push(spelling(value.text, quote));
  return advice.length === 0 ? null : refusal(DOTNET_CALL, advice);
}

// Whether a node call's words run the test runner, and the refusal they earn
// where they do, or null. The words are read in order up to the first that is
// not a -- flag, the script or pattern word where node stops reading its own
// options, stepping over the next word after an option NODE_VALUE_OPTIONS
// holds: --test marks the runner call, and --test-timeout takes its joined
// value or the next word.
function nodeReason(args: readonly Word[], quote: (text: string) => string): { runs: boolean; reason: string | null } {
  let runs = false;
  let timeout: Word | null = null;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (NODE_VALUE_OPTIONS.has(a.text)) { k++; continue; }
    if (!a.text.startsWith("--") || a.text === "--") break;
    if (a.text === "--test") { runs = true; continue; }
    const { name, joined } = splitOption(a.text);
    if (name !== "--test-timeout") continue;
    const { value, consumed } = valueOf(args, k, joined);
    if (consumed) k++;
    timeout = value;
  }
  if (!runs) return { runs, reason: null };
  const advice: string[] = [];
  if (!supplied(timeout, MILLISECONDS)) advice.push(ADD_NODE_TIMEOUT);
  if (timeout !== null && !timeout.literal) advice.push(spelling(timeout.text, quote));
  return { runs, reason: advice.length === 0 ? null : refusal(NODE_CALL, advice) };
}

// A runner call's segment, also ended at the first } outside quotes that
// closes no { the segment opened: the close of a PowerShell script block the
// call stands in, so a later call's flags are never read as this one's. A
// brace pair inside a word (${PROJ}, {A,B}) is balanced and ends nothing.
// The segment holds one character per command index, so its index i is the
// masked copy's index from + i.
function runnerSegment(cmd: string, masked: string, from: number): string {
  const seg = segment(cmd, masked, from);
  let depth = 0;
  for (let i = 0; i < seg.length; i++) {
    const c = masked[from + i];
    if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return seg.slice(0, i);
  }
  return seg;
}

// The refusal the runner call whose words start at `at` earns, or null where
// it is no runner call or passes: the segment's words read as the lexer reads
// them, the runner's first word or flags deciding whether a test runs.
function runnerReasonAt(cmd: string, masked: string, hit: { name: string; at: number }, quote: (text: string) => string): string | null {
  const literal: boolean[] = [];
  const toks = tokens(runnerSegment(cmd, masked, hit.at), literal);
  const words: Word[] = toks.map((text, k) => ({ text, literal: literal[k] }));
  if (hit.name === "dotnet") {
    const sub = words[0];
    if (sub === undefined || !sub.literal || sub.text !== "test") return null;
    return dotnetReason(words.slice(1), quote);
  }
  return nodeReason(words, quote).reason;
}

// A command read the read-only guard's way, in the shared-state guard's
// order: heredoc bodies found on a body-blind mask, continuations spliced,
// then the quote mask, with each substitution interior collected into `subs`.
// A heredoc body stays command text.
function maskOf(cmd: string, subs: Span[]): { cmd: string; masked: string } {
  const bodies = heredocBodies(cmd, maskQuoted(cmd));
  const spliced = spliceContinuations(cmd, bodies);
  return { cmd: spliced, masked: maskQuoted(spliced, bodies, subs) };
}

// The first refusal any runner call in the command earns, or null: the top
// level's calls in reading order, then each substitution interior and nested
// payload read one level deeper, to DEPTH_BOUND, as command text whatever
// shell runs it. The search for runner positions reads each { and } outside
// quotes as a ;, so a runner word opening a PowerShell script block stands in
// command position as PowerShell reads it. Each hit's words are read from the
// unswapped mask, so a brace inside a word (${PROJ}, {A,B}) cuts no argument
// list. Nested payloads are found on the swapped mask, so an iex opening a
// script block stays in reach, at the cost of the payload false refusal the
// header lists.
function gateReason(cmd: string, masked: string, subs: readonly Span[], depth: number, quote: (text: string) => string): string | null {
  const search = masked.replace(/[{}]/g, ";");
  for (const hit of commandPositions(search, RUNNERS)) {
    const reason = runnerReasonAt(cmd, masked, hit, quote);
    if (reason !== null) return reason;
  }
  if (depth >= DEPTH_BOUND) return null;
  const inner = [...subs.map((s) => cmd.slice(s.from, s.to)), ...nestedPayloads(cmd, search)];
  for (const text of inner) {
    const innerSubs: Span[] = [];
    const read = maskOf(text, innerSubs);
    const reason = gateReason(read.cmd, read.masked, innerSubs, depth + 1, quote);
    if (reason !== null) return reason;
  }
  return null;
}

/**
 * Denies a Bash or PowerShell command running a dotnet test with no
 * --blame-hang-timeout and --blame-hang-dump-type none or mini, nor the
 * platform's --hangdump, --hangdump-timeout and --hangdump-type none or mini,
 * or a node --test with no numeric --test-timeout, at any
 * command position to the read-only guard's depth, with one line naming the
 * call, the flag to add and the doctrine bullet. Any session's call, keyed on
 * no agent type. A command naming neither runner matches nothing.
 */
export function testHangGateGuard(deps: TestHangGateDeps): BeforeGuard {
  return {
    name: "test-hang-gate",
    matches: (e: GuardCall) => (e.tool === "Bash" || e.tool === "PowerShell") && namesRunner(e.command),
    decide: (e: GuardCall) => {
      const cmd = e.command;
      // The matcher's scan, repeated so the command narrows to a string here.
      if (!namesRunner(cmd)) return {};
      try {
        const subs: Span[] = [];
        const read = maskOf(cmd.replace(/\r\n/g, "\n"), subs);
        const reason = gateReason(read.cmd, read.masked, subs, 0, deps.quote);
        return reason === null ? {} : { deny: reason };
      } catch (err) {
        const failure = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
        return { deny: refusal(`a command it could not finish reading (${deps.quote(failure)}), rather than pass an unread dotnet test or node --test call`, ["Run the test runner as its own plain call, carrying its hang limit flag."]) };
      }
    },
  };
}
