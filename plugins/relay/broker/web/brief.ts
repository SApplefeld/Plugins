// The plan brief the web surface's plan page draws in place of the Goal card: the plain-language
// account the kit writes beside a plan, at `docs/briefs/<plan stem>.md` for a live plan and
// `docs/archive/briefs/<plan stem>.md` once the plan is archived.
//
// A brief opens with the line `# Brief: <plan title>` and holds its parts under it. The parse is
// generic over label and text, so a change to the kit's list of parts is a page change and not a
// broker change.
//
// The part rule, which a changelog entry takes too:
//
// - A part line in the plain form opens at the line's first character with `**<label>.**`, where the
//   label holds no asterisk and, once trimmed, runs 1 to `MAX_BRIEF_LABEL` code points. After the
//   closing asterisks the line holds nothing, blank space alone, or blank space and then text. In the
//   marked form a part line is `- ` or `* ` at the start of the line and then a plain part line. An
//   indented line is never a part line, and neither is one with text straight after the asterisks.
// - The first part line, in either form, decides the form for every line. A line that is a part line
//   only in the other form is a line of text. So a bulleted list of bold leads under a plain label is
//   that part's text, and a file whose parts are bullets reads each bullet as a part.
// - A part's text is the text on its part line and every line after it, up to the next part line or
//   the end, joined by line feeds. The text on the part line is trimmed at both ends. Each line under
//   it keeps its leading spaces and tabs, which the page's renderer reads as the continuation of a
//   list item. The rest of that line has every run of white space folded to one space and is
//   trimmed at both ends, so white space after the indent that is not a space or a tab, such as a
//   no-break space, is dropped. Blank lines at the start and the end of the text are dropped, and
//   the text is cut at `MAX_BRIEF_TEXT` code points.
// - A part whose text is empty is not kept, and its part line still ends the part above it. A line
//   whose label is empty, holds an asterisk or runs over the bound is a line of text, and every line
//   before the first part line is skipped.
// - At most `MAX_BRIEF_PARTS` parts are kept, and the part line after the last of them ends the read.
//
// A brief is optional and model-written text on this host's disk, read and never written here. A
// file that is absent, cannot be read, runs over its cap or is not a brief is no brief for its plan,
// and none of those fails the plans source: the caller keeps the plan and draws its Goal instead.
import { statPlanFile, bounded } from "../board/plans.ts";
import { readCappedFile } from "../capped-read.ts";

/** The most bytes of one brief read; a file over it is refused whole. */
export const MAX_BRIEF_FILE_BYTES = 16 * 1024;

/** The most parts a brief keeps, in file order. */
export const MAX_BRIEF_PARTS = 12;

/** The most code points of a part's label; a longer label makes its line no part. */
export const MAX_BRIEF_LABEL = 40;

/** The most code points of a part's text; a longer text is cut here. */
export const MAX_BRIEF_TEXT = 4_000;

/** What the first line of every brief opens with. */
const BRIEF_FIRST_LINE = "# Brief: ";

// A plain part line. The label is a run with no asterisk, so it ends at the first `.**`. The pattern
// is anchored at the line's first character, the label's run stops at the next asterisk and the text
// takes everything to the line's end. So a line that is no part line costs one walk back over the
// label's run, and a long run of white space or asterisks is read once. The text is whatever follows
// the blank space, a line separator or a lone carriage return included.
const PART = /^\*\*([^*]+)\.\*\*(?:[ \t]+([^]*))?$/;

/** The two forms of a part line: bare, or behind a bullet marker. */
type PartForm = "plain" | "marked";

/** A part line as read: its form, its trimmed label, and the text after the label. */
type PartLine = { form: PartForm; label: string; text: string };

/**
 * `line` as a part line, or null where it is none in either form. The marker is two fixed characters
 * taken off before the one pattern runs, so the marked form adds no second pattern to bound.
 */
function partLine(line: string): PartLine | null {
  const form: PartForm = line.startsWith("- ") || line.startsWith("* ") ? "marked" : "plain";
  const match = PART.exec(form === "marked" ? line.slice(2) : line);
  if (match === null) return null;
  const label = (match[1] as string).trim();
  // The length is counted in code points, as every other bound on this surface is.
  if (label === "" || [...label].length > MAX_BRIEF_LABEL) return null;
  return { form, label, text: match[2] ?? "" };
}

/** Whether `line` is a part line in either form, which is where the header lines of a changelog entry end. */
export function isPartLine(line: string): boolean {
  return partLine(line) !== null;
}

/**
 * One line of a part's text under its part line: its leading spaces and tabs kept, and the rest
 * folded and trimmed as `bounded` does. A line of white space alone is an empty line. No more of
 * one line than `MAX_BRIEF_TEXT` code points can reach the part's cut text, so the cut `bounded`
 * makes here drops nothing the part would keep.
 */
function textLine(line: string): string {
  let indent = 0;
  while (line[indent] === " " || line[indent] === "\t") indent += 1;
  const rest = bounded(line.slice(indent), MAX_BRIEF_TEXT);
  return rest === "" ? "" : line.slice(0, indent) + rest;
}

/**
 * The text of a part from its lines, the text on the part line first: the lines joined by line
 * feeds with the blank ones at the start and the end dropped, cut at `MAX_BRIEF_TEXT` code points,
 * and the white space the cut leaves at the end trimmed.
 */
function partText(lines: readonly string[]): string {
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from] === "") from += 1;
  while (to > from && lines[to - 1] === "") to -= 1;
  const joined = lines.slice(from, to).join("\n");
  // A code point takes at most two UTF-16 units, so this prefix holds at least the bound of them.
  // Cutting on code points keeps an astral character from being left as half of itself.
  return [...joined.slice(0, MAX_BRIEF_TEXT * 2)].slice(0, MAX_BRIEF_TEXT).join("").trimEnd();
}

/** One part of a brief: its label without the closing period, and its text. */
export type BriefPart = { label: string; text: string };

/** A brief: its parts in file order, at least one. */
export type Brief = { parts: BriefPart[] };

/**
 * The parts among `lines`, in order, at most `MAX_BRIEF_PARTS`, under the part rule at the head of
 * this file: each runs from its part line to the next, in the form the first part line sets, with
 * its text cut at `MAX_BRIEF_TEXT`. A part whose text is empty is not kept. A brief and a changelog
 * entry both take their parts from here, so the two share one rule and its bounds.
 */
export function parseParts(lines: readonly string[]): BriefPart[] {
  const parts: BriefPart[] = [];
  let form: PartForm | null = null;
  // The part being read, with its text lines so far: null above the first part line.
  let label: string | null = null;
  let textLines: string[] = [];
  const keep = (): void => {
    if (label === null) return;
    const text = partText(textLines);
    if (text !== "") parts.push({ label, text });
  };
  for (const line of lines) {
    const found = partLine(line);
    if (found !== null && (form === null || found.form === form)) {
      form = found.form;
      keep();
      // The part line after the last kept part ends the read, so no later line joins that part.
      if (parts.length === MAX_BRIEF_PARTS) return parts;
      label = found.label;
      textLines = [bounded(found.text, MAX_BRIEF_TEXT)];
    } else if (label !== null) {
      textLines.push(textLine(line));
    }
  }
  keep();
  return parts;
}

/** The brief in `text`, or null where the text does not open as a brief or holds no part. */
export function parseBrief(text: string): Brief | null {
  // A byte-order mark ahead of the first line would otherwise defeat the first-line comparison, as
  // it would defeat a line-start anchor in `parsePlan`.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!(lines[0] ?? "").startsWith(BRIEF_FIRST_LINE)) return null;
  const parts = parseParts(lines.slice(1));
  return parts.length === 0 ? null : { parts };
}

/** A brief file as last read: the stat it was read under, and the brief it gave, null where it gave none. */
export type BriefHold = { mtimeMs: number; sizeBytes: number; brief: Brief | null };

/**
 * One brief file, read only when its modification time or size differs from `held`'s. Null where
 * there is nothing to hold: the file is absent, is not a regular file or could not be read. A file
 * over its cap, or one that is no brief, is held with a null brief, so it is not opened again until
 * it changes. The stat is taken before the read, so a write between the two shows as a newer stat on
 * the next pass and is read then.
 */
export function readBriefFile(file: string, held: BriefHold | undefined): BriefHold | null {
  const stat = statPlanFile(file, true);
  if (stat === null) return null;
  if (held !== undefined && held.mtimeMs === stat.mtimeMs && held.sizeBytes === stat.sizeBytes) return held;
  const capped = readCappedFile(file, MAX_BRIEF_FILE_BYTES);
  if ("failed" in capped) return capped.failed === "oversized" ? { ...stat, brief: null } : null;
  return { ...stat, brief: parseBrief(capped.text) };
}
