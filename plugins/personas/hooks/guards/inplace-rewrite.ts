// inplace-rewrite.ts: the before-tool guard that keeps a Bash call on Windows
// from rewriting a file in place with sed or awk. The shell behind the Bash
// tool on Windows is Git Bash, whose sed and awk read a file in text mode and
// write the whole of it back with LF endings, whatever endings it held and
// whatever the script did, and git's normalization hides that rewrite from
// every diff. The routes that keep a file's endings are the Edit tool, perl
// -pi, and a script that writes the file's own endings back.
//
// It binds every session the module loads in, the main loop and every
// subagent alike, and keys on no agent type. It reads a Bash call's command
// alone, since Git's sed is not on PowerShell's path, and allows every call
// outright where the module reads the host as other than Windows, since a
// Linux sed keeps what it reads. On Windows it finds every sed, awk, gawk and
// xargs call in the command, at the top level, on each side of &&, ||, ; and
// |, inside a subshell, inside a command substitution, and inside a nested
// shell's payload, to the depth the read-only guard scans, DEPTH_BOUND below,
// and denies at the first the shared reading, docs-write.ts's inPlaceRewrite,
// reads as in place: sed with an i in a short-flag cluster or any spelling of
// --in-place, abbreviations included; awk or gawk with -i, -l, --include,
// --load or an inplace operand; and xargs whose verb after its own options is
// such a call. A read-only sed (sed -n 's/a/b/p' x.md), an awk that prints,
// and perl -pi pass.
//
// Otherwise the call is refused, with one line naming the call, the verb and
// its segment's text through the quote dependency, and the three keeping
// routes.
//
// The bar: the guard refuses the ordinary call a cooperative session writes
// without thinking of the endings, and fails closed on a command it cannot
// finish reading. A shape only a session evading the guard would spell is a
// residual, listed here as the test-hang gate lists its own.
//
// Out of its reach: a PowerShell call, by design; an interpreter script
// (python, node, perl, pwsh) that rewrites a file whole, since the guard reads
// the shell's own verbs and not a program's text; a verb the shell rewrites,
// quotes or splits, the read-only guard's own miss, since the lexer finds sed
// only where the name stands unquoted and whole ("sed" -i, s''ed -i, S=sed;
// $S -i); a call nested past the depth bound, which passes; a call inside a
// quoted payload for an interpreter the read-only lexer does not open as a
// shell; a group whose brace is glued to the verb ({sed -i x;}), since no
// brace is a word boundary here; a sed or awk that writes a new file the call
// then moves over the old one (sed 's/a/b/' f > t && mv t f), since neither
// call is in place; and an in-place rewrite reached through a script, a
// Makefile target or an npm script, since no single call shows the verb. A failed read of the platform answers not Windows, so every call
// passes while the read fails, as it does for the other guards that take
// guardWindowsOf. The residual false hits are three: an unquoted verb in an
// operand list on a command line (echo sed -i, or a search for the text, as in
// rg sed -i docs/) reads as an invocation and is refused; a heredoc body naming one is read as command text and refused; and
// an awk or gawk call loading any library with -l, --load or --include is
// refused, since the shared reading cannot tell inplace from another library.
//
// The command is read through the read-only guard's lexer, in the order the
// shared-state guard reads it: heredoc bodies found on a body-blind mask,
// continuations spliced, then the quote mask, with each substitution interior
// collected and read one level deeper beside each nested payload. A command
// naming none of sed, awk and gawk as a whole word is passed by the matcher
// before any lexing, so the common shell call pays one string scan. A failure
// while reading a command denies, naming the failure, so the guard never
// throws to the runner and never passes a command it could not finish
// reading.
//
// Nothing here reads `$` (runner.ts says why), and nothing here resolves a
// path, so the guard takes no LexHost.

import type { BeforeGuard, GuardCall } from "./runner";
import { CONTINUATION_CAP_ADVICE, IN_WORD_PAIR_CAP, commandPositions, heredocBodies, maskQuoted, memoized, nestedPayloads, readUnderContinuations, segment, spliceContinuations, tokens, type VerdictMemo } from "./readonly-agent";
import { inPlaceRewrite } from "./docs-write";

// A half-open range of command indexes, the lexer's own span shape.
type Span = { from: number; to: number };

// The depth the read-only guard scans nested command text to; past it an
// unread payload passes here, as it does in the test-hang gate.
const DEPTH_BOUND = 2;

// The verbs the guard reads, as commandPositions matches them: whole, in any
// letter case, with an optional path prefix and executable suffix. xargs is
// among them so a piped rewrite is read as the shared reading reads it.
const VERBS = ["sed", "awk", "gawk", "xargs"];

// The pre-scan the matcher and decide share: a command naming none of the
// three rewriting verbs as a whole word is passed before any lexing. Every
// byte commandPositions accepts on either side of a name is a non-word byte,
// and every text the guard reads deeper is cut from the command at such a
// byte, so the word bound drops no call the lexer would find, sed.exe among
// them. An xargs call rewrites nothing without one of the three.
function namesVerb(cmd: unknown): cmd is string {
  return typeof cmd === "string" && /\b(?:sed|awk|gawk)\b/i.test(cmd);
}

// One refusal line: the call, the reason the rewrite loses the file's
// endings, and the three routes that keep them.
function refusal(what: string): string {
  return `Blocked: inplace-rewrite refuses ${what} under Git Bash, whose sed and awk write the whole file with LF endings. Edit the file with the Edit tool, with perl -pi, or with a script that writes the file's own endings.\n`;
}

// The call named for a command whose text, at any depth, carries more in-word
// line continuations than `IN_WORD_PAIR_CAP`, so the guard refuses it unread.
const CAPPED_CONTINUATIONS =
  `a command carrying more than ${IN_WORD_PAIR_CAP} line continuations inside its words, past what the guard reads, rather than pass an unread sed or awk call (${CONTINUATION_CAP_ADVICE.toLowerCase()})`;

// What the guard reaches through hooks/index.ts: whether the host is
// Windows, and the fold and bracket guard a quoted call takes on its way to
// the model.
export type InplaceRewriteDeps = { windows(): Promise<boolean>; quote(text: string): string };

// A command read the read-only guard's way, in the shared-state guard's
// order: heredoc bodies found on a body-blind mask, continuations spliced,
// then the quote mask, with each substitution interior collected into `subs`.
// A heredoc body stays command text. The splice reads the quote mask of the
// text as handed in, so a pair inside a single-quoted span stays as typed.
// `join` and `boundary` are the splice's reading of this text, as
// `spliceContinuations` takes them.
function maskOf(cmd: string, subs: Span[], join: boolean, boundary: number): { cmd: string; masked: string } {
  const bodies = heredocBodies(cmd, maskQuoted(cmd));
  const joined = spliceContinuations(cmd, bodies, maskQuoted(cmd, bodies), join, boundary);
  return { cmd: joined.cmd, masked: maskQuoted(joined.cmd, joined.bodies, subs) };
}

// The text of the first in-place call in the command, or null: the top
// level's verb positions in reading order, each one's segment read as the
// lexer reads it with the matched verb as its first word, then each
// substitution interior and nested payload read one level deeper, to
// DEPTH_BOUND. The call is named as the verb and its segment, a substitution
// span inside it named as what it stands for in the read-only guard's own
// words, since its sentinel bytes mean nothing to a reader. Each nested text
// is read under `readUnderContinuations` on its own text, a call under any
// reading of it standing, and one past the in-word continuation cap named as
// refused unread. The read of each nested text is held in `memo`, the call's,
// keyed on the text and its depth, so the same text handed down by several
// outer readings reads once.
async function rewriteCall(cmd: string, masked: string, subs: readonly Span[], depth: number, memo: VerdictMemo): Promise<string | null> {
  for (const hit of commandPositions(masked, VERBS)) {
    const seg = segment(cmd, masked, hit.at);
    if (inPlaceRewrite([hit.name, ...tokens(seg)])) return `${hit.name}${seg}`.replace(/\x02+/g, "$(unresolved substitution)").trim();
  }
  if (depth >= DEPTH_BOUND) return null;
  const inner = [...subs.map((s) => cmd.slice(s.from, s.to)), ...nestedPayloads(cmd, masked)];
  for (const text of inner) {
    const call = await memoized(memo, `${depth + 1}`, text, () => readUnderContinuations(
      text,
      false,
      (t, join, boundary) => {
        const innerSubs: Span[] = [];
        const read = maskOf(t, innerSubs, join, boundary);
        return rewriteCall(read.cmd, read.masked, innerSubs, depth + 1, memo);
      },
      (r) => r !== null,
      () => CAPPED_CONTINUATIONS,
    ));
    if (call !== null) return call;
  }
  return null;
}

/**
 * Denies a Bash command running sed or awk in place, at any command position
 * to the read-only guard's depth, where the host is Windows, with one line
 * naming the call and the three routes that keep a file's line endings. Any
 * session's call, keyed on no agent type. A command naming none of sed, awk
 * and gawk matches nothing, and off Windows every command passes.
 */
export function inplaceRewriteGuard(deps: InplaceRewriteDeps): BeforeGuard {
  return {
    name: "inplace-rewrite",
    matches: (e: GuardCall) => e.tool === "Bash" && namesVerb(e.command),
    decide: async (e: GuardCall) => {
      const cmd = e.command;
      // The matcher's scan, repeated so the command narrows to a string here.
      if (!namesVerb(cmd)) return {};
      try {
        if (!(await deps.windows())) return {};
        // The command, its CRLF pairs normalized once here, is read under
        // every reading of its continuations, the two-space reading first so
        // every refusal it gives keeps its reason byte for byte, and a call
        // found under any reading is the guard's refusal. The memo holds each
        // nested text's read for this call.
        const memo: VerdictMemo = new Map();
        const call = await readUnderContinuations(
          cmd.replace(/\r\n/g, "\n"),
          false,
          (text, join, boundary) => {
            const subs: Span[] = [];
            const read = maskOf(text, subs, join, boundary);
            return rewriteCall(read.cmd, read.masked, subs, 0, memo);
          },
          (r) => r !== null,
          () => CAPPED_CONTINUATIONS,
        );
        return call === null ? {} : { deny: refusal(deps.quote(call)) };
      } catch (err) {
        const failure = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
        return { deny: refusal(`a command it could not finish reading (${deps.quote(failure)}), rather than pass an unread sed or awk call`) };
      }
    },
  };
}
