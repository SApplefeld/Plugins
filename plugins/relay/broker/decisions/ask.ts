// The `ASK:` line in a session's reply, read two ways.
//
// `askQuestions` reads a reply as the personas plugin reads a worker's closing text, to the same
// verdict and the same question on every line, so every question it returns is one the plugin can
// have written into its ask ledger, and the decisions card joins a ledger entry to the reply it was
// asked in by that text.
//
// `findAskLine` is the narrower mark rule the voice reads: a line whose first non-space characters
// are exactly `ASK:`, uppercase with the colon, sitting outside a fenced code block. A reply quoting
// code, a log, a transcript or a review of another session's text carries `ASK:` lines that are not
// this session's asks, so a blockquoted `> ASK:` line, a bulleted `- ASK:` line, a lowercase `ask:`
// and an `ASK:` in the middle of a line all mark nothing, and anything inside a fence marks nothing
// either.
//
// Pure and synchronous, and it logs nothing, since what it reads is session-authored text.

const MARK = "ASK:";

/**
 * A fence opener: three or more backticks or three or more tildes, at the start of the line once
 * its leading whitespace is set aside. After a backtick run, CommonMark admits an info string (such
 * as a language name) only where it carries no backtick, so a line like "```x```" is inline code
 * and opens nothing. A tilde run takes any info string.
 */
const FENCE_OPEN = /^(?:(`{3,})[^`]*$|(~{3,}))/;

/**
 * The reply's first marked line, exactly as it stands in the reply with its leading whitespace kept
 * and its line break removed, or null where the reply carries no mark.
 *
 * Fences follow CommonMark's opening and closing shape: a fence closes on a later line whose first
 * non-space characters are the same fence character, at least as many as opened it, followed only by
 * whitespace. A fence that never closes runs to the end of the text, so an `ASK:` line after an
 * unclosed opener is read as quoted rather than as a mark.
 */
export function findAskLine(text: string): string | null {
  let fence: { character: string; length: number } | null = null;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const content = line.trimStart();
    if (fence !== null) {
      if (closesFence(content, fence.character, fence.length)) fence = null;
      continue;
    }
    const opener = FENCE_OPEN.exec(content);
    if (opener !== null) {
      const run = opener[1] ?? opener[2] ?? "";
      fence = { character: run.charAt(0), length: run.length };
      continue;
    }
    if (content.startsWith(MARK)) return line;
  }
  return null;
}

/**
 * The line breaks a reply is cut at before each line is read, copied from `ASK_MARKER_LINE_BREAK`
 * in the personas plugin's `hooks/index.ts`: the four terminators its ask expression, under its `m`
 * flag, reads as line ends, so a line read here is a line the plugin reads.
 */
const ASK_MARKER_LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/u;

/** A line opening with the mark in any case, the start the plugin's expression is anchored to. */
const ASK_MARKER_START = /^ASK:/i;

/** A `?`, optional whitespace, `Recommend:` in any case, and at least one more character. */
const RECOMMEND_AFTER_QUESTION = /\?\s*Recommend:./i;

/**
 * Every question the reply asks as the personas plugin reads it, in the order the lines stand.
 *
 * The plugin reads each line against `ASK_MARKER_LINE` in its `hooks/index.ts`,
 * `/^ASK:\s*(.+?\?\s*Recommend:\s*.+)$/im`, and stores the group trimmed as an ask's `question`.
 * This reads every line to the same verdict and the same question. A line the split cuts carries no
 * terminator, so `.` matches each of its characters, `^` is its start and `$` its end. The
 * expression then matches exactly where the line opens with `ASK:` in any case and the rest after
 * those four characters holds a `?` at its second character or later, followed by `\s*`,
 * `Recommend:` in any case and one more character: the leading `\s*` can take nothing, the lazy
 * group needs one character before the `?`, and the closing `\s*` gives a trailing space back to
 * `.+`. The group runs to the line's end and starts after some part of the rest's leading
 * whitespace, and `\s` is the set `trim` strips, so the group trimmed is the rest trimmed. Both
 * tests here take the `i` flag without `u`, so they fold case as the plugin's expression does.
 *
 * The plugin's expression is quadratic in a whitespace run after the mark, since its `\s*` and its
 * lazy group can split the run every way. This reads each line in linear time: a search position
 * other than a `?` fails on its first character, and the whitespace runs after two `?`s never
 * overlap, since a `?` is not whitespace.
 *
 * Nothing is capped here: the plugin refuses lines past its per-turn cap after matching them, so a
 * count taken on this side could not tell its refused lines from the ones it opened.
 */
export function askQuestions(text: string): string[] {
  const questions: string[] = [];
  for (const line of text.split(ASK_MARKER_LINE_BREAK)) {
    if (!ASK_MARKER_START.test(line)) continue;
    const rest = line.slice(MARK.length);
    if (RECOMMEND_AFTER_QUESTION.test(rest.slice(1))) questions.push(rest.trim());
  }
  return questions;
}

function closesFence(content: string, character: string, length: number): boolean {
  let run = 0;
  while (run < content.length && content.charAt(run) === character) run += 1;
  return run >= length && content.slice(run).trim() === "";
}
