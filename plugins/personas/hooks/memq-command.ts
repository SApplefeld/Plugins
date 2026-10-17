// memq-command.ts: how a shell command's `memq <verb>` runs are read for
// hooks/index.ts, which imports these by name: the argument words of each
// run, and the record name and tier flags among them. Pure text parsing.

import { isMemqWord } from "./redactor";

// The argument words of each `memq <verb>` a shell command runs. The command
// is cut into segments at the shell operators `;`, `&`, `|` and a line break
// outside single or double quotes, and a segment runs the verb only where its
// own command is a memq word, or node running one, followed by the verb's
// word. The memq word is read by the redactor's recognizer, isMemqWord, so
// both readers agree on the set of words that are memq. Where that word sits
// in the command (first, or second after node, unquoted) is this reader's own
// rule. A `memq <verb>` inside a quoted string, an echo or a grep pattern is
// text, not a run.
export function memqVerbArgsOf(command: string, verb: string): string[][] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of command) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (ch === ";" || ch === "&" || ch === "|" || ch === "\n" || ch === "\r") {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);
  const out: string[][] = [];
  for (const segment of segments) {
    const words = segment.trim().split(/\s+/).filter((w) => w !== "");
    let at = -1;
    if (words.length > 0 && isMemqWord(words[0])) at = 1;
    else if (words.length > 1 && words[0] === "node" && isMemqWord(words[1])) at = 2;
    if (at < 0 || words[at] !== verb) continue;
    out.push(words.slice(at + 1));
  }
  return out;
}

// The record name and tier flags among one get's or touch's argument words,
// read as memq's get and touch verbs read them: the name is the first bare
// word, with its quotes removed, and null where there is none; `--operator`
// names the operator tier; bare `--type` the declared type's tier and
// `--type=<type>` the type named; neither flag is `unflagged`, for the verb
// to read as its own default; and the verb refuses, for both tier flags,
// `--type` given twice, an option outside `known` and the tier flags, or a
// second bare word after the name. A redirection such as `2>/dev/null` is the
// shell's and never a bare word.
export type MemqNameAndTier =
  | { name: string; tier: "unflagged" }
  | { name: string; tier: "operator" }
  | { name: string; tier: "refused" }
  | { name: string; tier: "type"; namedType: string | null };
export function memqNameAndTierOf(rest: string[], known: ReadonlyArray<string>): MemqNameAndTier | null {
  const bare = rest.filter((w) => !w.startsWith("-") && !/^\d*[<>]/.test(w));
  const name = bare[0];
  if (name === undefined) return null;
  const types = rest.filter((w) => w === "--type" || w.startsWith("--type="));
  const operator = rest.includes("--operator");
  const unknown = rest.some((w) => w.startsWith("--") && w !== "--operator" && w !== "--type" && !w.startsWith("--type=") && !known.includes(w));
  const tier = unknown || bare.length > 1 || types.length > 1 || (types.length === 1 && operator) ? { tier: "refused" as const }
    : operator ? { tier: "operator" as const }
    : types.length === 1 ? { tier: "type" as const, namedType: types[0] === "--type" ? null : types[0].slice("--type=".length) }
    : { tier: "unflagged" as const };
  return { name: name.replace(/^["']|["']$/g, ""), ...tier };
}
