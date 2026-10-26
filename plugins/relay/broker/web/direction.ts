// The direction ledgers the web surface's heading cards draw: the machine's own, at the path
// `CHANNEL_DIRECTION_LEDGER` names, and one per configured project root, at `docs/direction.md`.
//
// A ledger opens with the line `# Direction` and holds items one per line as
// `- D<n> <YYYY-MM-DD>: <the operator's words>`. The operator hand-edits the file, so the heading is
// the highest-numbered item and not the last line, and any line that is not an item is ignored.
//
// A ledger is operator text on this host's disk. A file that is absent is a ledger with nothing in
// it. A file that cannot be read, runs over its cap or is not a ledger fails the read, which the pass
// records as the source being held; the cause is dropped unread because an error can quote the path
// or the text. The one write is the Steer append to the machine ledger, which every kit session on
// this host reads as the operator's own standing word: it rewrites the file whole with one item
// added, so a half-written line never lands and the text above the item is kept byte for byte.
import { statSync } from "node:fs";
import path from "node:path";
import { bounded } from "../board/plans.ts";
import { readCappedBytes } from "../capped-read.ts";
import { writeSnapshot } from "../persistence.ts";

/** The most bytes of one ledger read; a file over it is refused whole. */
export const MAX_DIRECTION_FILE_BYTES = 64 * 1024;

/** The most code points of the heading's words a view carries. */
export const MAX_HEADING_TEXT = 400;

/**
 * The most code points a Steer text holds once trimmed. At four bytes a code point plus its JSON
 * framing the longest text fits the route's 1,024-byte body ceiling. A hand-written item may be
 * longer, which is why the heading's own bound is 400.
 */
export const MAX_STEER_TEXT = 200;

/** The first line of every ledger, compared after its trailing whitespace is trimmed. */
const LEDGER_FIRST_LINE = "# Direction";

// A control character as the Steer rule counts one: C0 and DEL, C1, and the two Unicode line
// separators, so a tab and every line terminator are refused and an item is always one line.
const STEER_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

// Anchored at the line start, case-sensitive throughout. Each part ends at a literal the next one
// starts with, so nothing here backtracks on a run of whitespace.
const ITEM = /^- D(\d+) (\d{4}-\d{2}-\d{2}): ([\s\S]*)$/;

// The number of any line that opens `- D<n> ` or `~~- D<n> `, whatever follows, so the append
// numbers past an item the parse skips for having no words or no date, and past a struck item, the
// whole line wrapped in `~~`. `ITEM` is anchored at `- D`, so a struck item is never live and never
// the heading, yet its number is never written again.
const ITEM_NUMBER = /^(?:~~)?- D(\d+) /;

// The strict decoder for the append: it throws on bytes that are not UTF-8 rather than painting a
// U+FFFD, and keeps a leading byte-order mark in the text so the rewrite keeps it byte for byte.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** One ledger item: `id` is `D<n>` as written, `number` the value ordering them. */
export type DirectionItem = { id: string; number: number; date: string; text: string };

/** The items of one ledger, in file order. */
export type DirectionLedger = { items: readonly DirectionItem[] };

/**
 * What the direction source reads: `machine` the ledger at the configured path (null where no path
 * is set or the file is absent), and `repos` the ledger under each configured root that has one.
 */
export type DirectionReading = {
  machine: DirectionLedger | null;
  repos: readonly { root: string; ledger: DirectionLedger }[];
};

/** The heading a view carries: the highest item's parts, each null where there is no item. */
export type Heading = { item: string | null; date: string | null; text: string | null; count: number };

/** The ledger in `text`, or null where the text does not open with the ledger's first line. */
export function parseDirection(text: string): DirectionLedger | null {
  // A byte-order mark ahead of the first line would otherwise defeat the first-line comparison, as
  // it would defeat a line-start anchor in `parsePlan`.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if ((lines[0] ?? "").trimEnd() !== LEDGER_FIRST_LINE) return null;
  const items: DirectionItem[] = [];
  for (const line of lines.slice(1)) {
    const match = ITEM.exec(line);
    if (match === null) continue;
    const words = (match[3] as string).trim();
    if (words === "") continue;
    items.push({ id: `D${match[1] as string}`, number: Number(match[1]), date: match[2] as string, text: words });
  }
  return { items };
}

/**
 * The heading of a ledger: its highest-numbered item, the later of two sharing a number. A null
 * ledger and one with no item both give a heading with nothing in it.
 */
export function headingOf(ledger: DirectionLedger | null): Heading {
  const items = ledger?.items ?? [];
  let top: DirectionItem | null = null;
  for (const item of items) {
    if (top === null || item.number >= top.number) top = item;
  }
  if (top === null) return { item: null, date: null, text: null, count: items.length };
  return { item: top.id, date: top.date, text: bounded(top.text, MAX_HEADING_TEXT), count: items.length };
}

/** One ledger file's bytes under the cap, undecoded. */
type BytesRead = { kind: "absent" } | { kind: "unreadable" } | { kind: "bytes"; bytes: Buffer };

type FileRead = { kind: "absent" } | { kind: "unreadable" } | { kind: "ledger"; ledger: DirectionLedger };

/**
 * Absent is told apart from every other failure by the stat ahead of the read, since the capped
 * read reports both the same way. The stat's size is not used: the read's own cap decides oversized.
 */
function readLedgerBytes(file: string): BytesRead {
  try {
    statSync(file);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  const capped = readCappedBytes(file, MAX_DIRECTION_FILE_BYTES);
  if ("failed" in capped) return { kind: "unreadable" };
  return { kind: "bytes", bytes: capped.bytes };
}

/** A view reads the ledger tolerantly: a byte sequence that is not UTF-8 decodes to U+FFFD. */
function readLedgerFile(file: string): FileRead {
  const read = readLedgerBytes(file);
  if (read.kind !== "bytes") return read;
  const ledger = parseDirection(read.bytes.toString("utf8"));
  return ledger === null ? { kind: "unreadable" } : { kind: "ledger", ledger };
}

/** The bytes as UTF-8 text, or null where any of them is not UTF-8. */
function decodeStrict(bytes: Buffer): string | null {
  try {
    return UTF8.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * One above the highest `<n>` on any line that opens `- D<n> ` or `~~- D<n> `, struck items
 * included, or 1 where there is none; null where that successor is past `Number.MAX_SAFE_INTEGER`
 * and could not be written exactly.
 */
function nextNumber(text: string): number | null {
  let next = 1;
  for (const line of text.split(/\r?\n/)) {
    const match = ITEM_NUMBER.exec(line);
    if (match === null) continue;
    const after = Number(match[1]) + 1;
    if (!Number.isSafeInteger(after)) return null;
    next = Math.max(next, after);
  }
  return next;
}

/**
 * One read of every ledger: the machine's where `machinePath` is set, and `<root>/docs/direction.md`
 * under each root. Null where any file that exists could not be used, so the pass holds the source
 * and keeps the reading it had; an absent file is not a failure.
 */
export function readDirection(machinePath: string, roots: readonly string[]): DirectionReading | null {
  let machine: DirectionLedger | null = null;
  if (machinePath !== "") {
    const read = readLedgerFile(machinePath);
    if (read.kind === "unreadable") return null;
    if (read.kind === "ledger") machine = read.ledger;
  }
  const repos: { root: string; ledger: DirectionLedger }[] = [];
  for (const root of roots) {
    const read = readLedgerFile(path.join(root, "docs", "direction.md"));
    if (read.kind === "unreadable") return null;
    if (read.kind === "ledger") repos.push({ root, ledger: read.ledger });
  }
  return { machine, repos };
}

/**
 * The Steer text a post carries, trimmed, or null where the rule refuses it: anything but a string,
 * one empty once trimmed, one over `MAX_STEER_TEXT` code points, or one holding a control character
 * as `STEER_CONTROL` counts them. Code points are counted, not UTF-16 units, so a text of 200
 * non-BMP characters passes.
 */
export function steerText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || Array.from(text).length > MAX_STEER_TEXT || STEER_CONTROL.test(text)) return null;
  return text;
}

/** The calendar date `ms` falls on in the host's own time zone, as `YYYY-MM-DD`. */
export function calendarDate(ms: number): string {
  const at = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** What one append did, or why it wrote nothing. */
export type SteerOutcome =
  | { status: "written"; item: string; date: string; line: string }
  | { status: "not-a-ledger" }
  | { status: "unreadable" };

/**
 * Appends the item `- D<n> <date>: <text>` to the ledger at `file`. An absent file is created as
 * `# Direction` followed by the item. A file that exists is read whole as bytes under the cap and
 * decoded as strict UTF-8, a leading byte-order mark kept in the text.
 *
 * `<n>` is one above the highest `<n>` on any line of the file that opens `- D<n> ` or `~~- D<n> `,
 * struck items included, or 1 where there is none. The struck form is the whole line wrapped in
 * `~~`, and a struck item is never live and never the heading. A line the parse skips, for having no
 * words or no date or for being struck, still holds its number, so no tap writes a number twice.
 *
 * A file whose first line is not `# Direction` is `not-a-ledger`. Every other refusal is
 * `unreadable`: a file that cannot be read or runs over the cap, one holding any byte sequence that
 * is not UTF-8, one whose next number would be past `Number.MAX_SAFE_INTEGER`, and one the rewrite
 * would carry past `MAX_DIRECTION_FILE_BYTES`, since every reader would then refuse the ledger. No
 * refusal writes anything, and none throws.
 *
 * The item takes the file's own line ending, CRLF where the text holds one and LF otherwise, with a
 * line ending inserted ahead of it where the file does not end in one, and it ends in one so the
 * next item needs none inserted. The whole text goes through `write`, `writeSnapshot` by default,
 * so a half-written line never lands and the bytes above the item are kept exactly. A write that
 * fails throws, and the caller decides what that costs.
 */
export function appendDirection(file: string, text: string, date: string, write: (file: string, text: string) => void = writeSnapshot): SteerOutcome {
  const read = readLedgerBytes(file);
  if (read.kind === "unreadable") return { status: "unreadable" };
  let head = `${LEDGER_FIRST_LINE}\n`;
  let next: number | null = 1;
  let ending = "\n";
  if (read.kind === "bytes") {
    const decoded = decodeStrict(read.bytes);
    if (decoded === null) return { status: "unreadable" };
    if (parseDirection(decoded) === null) return { status: "not-a-ledger" };
    next = nextNumber(decoded);
    if (next === null) return { status: "unreadable" };
    ending = decoded.includes("\r\n") ? "\r\n" : "\n";
    head = decoded.endsWith("\n") ? decoded : `${decoded}${ending}`;
  }
  const item = `D${String(next)}`;
  const line = `- ${item} ${date}: ${text}`;
  const whole = `${head}${line}${ending}`;
  if (Buffer.byteLength(whole, "utf8") > MAX_DIRECTION_FILE_BYTES) return { status: "unreadable" };
  write(file, whole);
  return { status: "written", item, date, line };
}
