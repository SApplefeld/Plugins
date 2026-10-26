// The plan brief the web surface's plan page draws in place of the Goal card: the plain-language
// account the kit writes beside a plan, at `docs/briefs/<plan stem>.md` for a live plan and
// `docs/archive/briefs/<plan stem>.md` once the plan is archived.
//
// A brief opens with the line `# Brief: <plan title>` and holds its parts one per line as
// `**<label>.** <text>`. The parse is generic over label and text, so a change to the kit's list of
// parts is a page change and not a broker change.
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
export const MAX_BRIEF_TEXT = 1_000;

/** What the first line of every brief opens with. */
const BRIEF_FIRST_LINE = "# Brief: ";

// The label is a run with no asterisk, so it ends at the first `.**` and nothing here backtracks on
// a whitespace run: the label's run is bounded by the next asterisk, and the text is whatever follows,
// a line separator or a lone carriage return included.
const PART = /^\*\*([^*]+)\.\*\*[ \t]+([^]*)$/;

/** One part of a brief: its label without the closing period, and its text. */
export type BriefPart = { label: string; text: string };

/** A brief: its parts in file order, at least one. */
export type Brief = { parts: BriefPart[] };

/** The brief in `text`, or null where the text does not open as a brief or holds no part. */
export function parseBrief(text: string): Brief | null {
  // A byte-order mark ahead of the first line would otherwise defeat the first-line comparison, as
  // it would defeat a line-start anchor in `parsePlan`.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!(lines[0] ?? "").startsWith(BRIEF_FIRST_LINE)) return null;
  const parts: BriefPart[] = [];
  for (const line of lines.slice(1)) {
    if (parts.length === MAX_BRIEF_PARTS) break;
    const match = PART.exec(line);
    if (match === null) continue;
    const label = (match[1] as string).trim();
    // The length is counted in code points, as every other bound on this surface is.
    if (label === "" || [...label].length > MAX_BRIEF_LABEL) continue;
    const words = bounded(match[2] as string, MAX_BRIEF_TEXT);
    if (words === "") continue;
    parts.push({ label, text: words });
  }
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
