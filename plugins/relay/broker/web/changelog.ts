// The changelog entries of one repository, read from the bare repository the rollout reader owns for
// it, at the commit its fetched default branch points at.
//
// An entry is a file under `docs/changelog/` at any depth whose path ends in a lower-case `.md`,
// less the one file `docs/changelog/README.md`. Its first line is `# Change: <title>`. Header lines
// follow, `<key>: <value>`, and then the parts, one per line as `**<label>.** <text>`, under the
// part rule a plan brief takes. A listed file that does not open `# Change: ` is kept as a row with
// no entry, so a malformed entry is seen rather than missing.
//
// An entry's landing commit is the oldest commit on the default branch's first-parent history whose
// diff against its first parent adds the file, so an entry that arrives through a merge lands at
// that merge. A repository's rows run in that log's order, newest landing first, and the files one
// commit adds run in ascending path order. Nothing here sorts by a date.
//
// The text is attacker-controlled: any committer to a read repository writes it. So a file over
// `MAX_ENTRY_FILE_BYTES`, a symbolic link and a submodule are never read, every kept value but the
// path is cut to a bound, and every revision handed to git is a full object id git itself printed,
// checked by shape before use. A path is kept as git lists it, bounded only by the local read
// limit on git's output. No ref name and no path is ever joined into a revision, and the one pathspec is
// the literal `docs/changelog/`.
import { bounded } from "../board/plans.ts";
import { MAX_BRIEF_FILE_BYTES, parseParts } from "./brief.ts";
import type { BriefPart } from "./brief.ts";
import { LOCAL_READ } from "./git.ts";
import type { GitRunner } from "./git.ts";

/** The most files of one repository the read keeps, the newest by landing order. */
export const MAX_CHANGELOG_FILES = 200;

/** The most bytes of one entry file read, the brief's own file cap; a file over it is listed with no entry and never read. */
export const MAX_ENTRY_FILE_BYTES = MAX_BRIEF_FILE_BYTES;

/** The most code points of an entry's title; a longer title is cut here. */
export const MAX_ENTRY_TITLE = 200;

/** The most code points of a header value; a longer value is cut here. */
export const MAX_ENTRY_HEADER = 120;

/** The folder the entries live under, the read's one pathspec. */
const CHANGELOG_FOLDER = "docs/changelog/";

/** The one file under the folder that is never an entry. */
const FOLDER_README = `${CHANGELOG_FOLDER}README.md`;

/** What the first line of every entry opens with. */
const ENTRY_FIRST_LINE = "# Change: ";

const KINDS = ["new", "changed", "fixed", "removed", "withdrawn"] as const;

/** A header line: one of the four keys with its exact case, then nothing or blank space and a value. */
const HEADER = /^(Product|Kind|Corrects|Corrected by):(?:[ \t]+([^]*))?$/;

/** A full object id as git prints one, SHA-1 or SHA-256. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** One record of `ls-tree -l`: mode, type, object id, size or `-`, a tab and the path. */
const TREE_RECORD = /^(\d{6}) ([a-z]+) ([0-9a-f]+) +(\S+)\t([^]+)$/;

/** The kind of a read whose git output was not of the shape the read's own command asks for. */
const MALFORMED = "changelog output";

/** What an entry's `Kind:` line may say. */
export type ChangelogKind = (typeof KINDS)[number];

/**
 * One parsed entry: its title, its header values, each null where its line is absent or empty, and
 * its parts in file order, none included. `kind` is null too where the line holds another word.
 */
export type ChangelogEntry = {
  title: string;
  product: string | null;
  kind: ChangelogKind | null;
  corrects: string | null;
  correctedBy: string | null;
  parts: BriefPart[];
};

/**
 * One listed file: its path, the commit it landed at with that commit's committer time as ISO, and
 * its entry, null for a file that is no entry or was not read.
 */
export type ChangelogRow = { path: string; commit: string; at: string; entry: ChangelogEntry | null };

/**
 * One repository's changelog as last read. `tip` is the default branch's commit the rows were read
 * at and `readAt` when, as ISO. `rows` holds the newest `MAX_CHANGELOG_FILES` files in landing
 * order and `older` counts the files past them. `stale` is true where a later read failed, and the
 * rest is then the last good read's. A repository whose first read failed has no rows, a null `tip`
 * and a null `readAt`.
 */
export type ChangelogRecord = {
  repo: string;
  tip: string | null;
  readAt: string | null;
  stale: boolean;
  rows: ChangelogRow[];
  older: number;
};

/** The parse of every blob a record's rows were read from, by blob id; null for a blob that is no entry. */
export type HeldEntries = ReadonlyMap<string, ChangelogEntry | null>;

/**
 * The entry in `text`, or null where its first line, after a byte-order mark is dropped, does not
 * open `# Change: `. Header lines are read between the first line and the first line that is a
 * part: a blank line or a line carrying none of the four keys is skipped, and the first line
 * carrying a key wins over a later one. An entry with no parts is still an entry.
 */
export function parseEntry(text: string): ChangelogEntry | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = lines[0] ?? "";
  if (!first.startsWith(ENTRY_FIRST_LINE)) return null;
  const headers = new Map<string, string>();
  let at = 1;
  for (; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    // The part rule itself decides where the headers end, so a line it drops is still a header line.
    if (parseParts([line]).length > 0) break;
    const match = HEADER.exec(line);
    if (match === null) continue;
    const key = match[1] as string;
    if (!headers.has(key)) headers.set(key, bounded(match[2] ?? "", MAX_ENTRY_HEADER));
  }
  const valueOf = (key: string): string | null => {
    const value = headers.get(key);
    return value === undefined || value === "" ? null : value;
  };
  const kind = valueOf("Kind");
  return {
    title: bounded(first.slice(ENTRY_FIRST_LINE.length), MAX_ENTRY_TITLE),
    product: valueOf("Product"),
    kind: KINDS.find((word) => word === kind) ?? null,
    corrects: valueOf("Corrects"),
    correctedBy: valueOf("Corrected by"),
    parts: parseParts(lines.slice(at)),
  };
}

/** One listed file of the tree: its blob id, and whether it is a regular file inside the size cap. */
type Listed = { path: string; blob: string; readable: boolean };

/**
 * The entry files of the tree at `tip`, from one recursive `ls-tree` with sizes. A regular file is
 * a blob of mode 100644 or 100755; a symbolic link (120000) and a submodule (160000) are listed
 * and never read, as is a file over `MAX_ENTRY_FILE_BYTES`, from the size the listing gives.
 */
async function listedAt(git: GitRunner, bare: string, tip: string): Promise<Listed[]> {
  const output = await git(bare, ["--literal-pathspecs", "ls-tree", "-r", "-l", "-z", tip, "--", CHANGELOG_FOLDER], LOCAL_READ);
  const files: Listed[] = [];
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const match = TREE_RECORD.exec(record);
    if (match === null) throw new Error(MALFORMED);
    const [, mode = "", type = "", blob = "", size = "", path = ""] = match;
    if (!path.startsWith(CHANGELOG_FOLDER) || !path.endsWith(".md") || path === FOLDER_README) continue;
    if (!OBJECT_ID.test(blob)) throw new Error(MALFORMED);
    const regular = type === "blob" && (mode === "100644" || mode === "100755");
    files.push({ path, blob, readable: regular && /^\d+$/.test(size) && Number(size) <= MAX_ENTRY_FILE_BYTES });
  }
  return files;
}

/** Where a file landed: the commit, its committer time as ISO, and the commit's place in the log, 0 the newest. */
type Landing = { commit: string; at: string; order: number };

/**
 * Each path's landing under the folder, from one log of `tip`'s first-parent history that lists,
 * per commit, the files its diff against its first parent adds. `--diff-merges=first-parent` gives
 * a merge commit that diff, where a plain log lists no file for one, and `log.showRoot` gives the
 * root commit its own. `log.follow` is pinned off, since a host's `log.follow=true` acts as
 * `--follow` on a log with exactly one pathspec, as this one is. The log runs newest first, so a
 * path added more than once keeps the oldest commit. With `-z` the output is NUL-separated fields: a commit's `<id> <committer time>`, then
 * its paths, the first after the newline git places there. A field is a path where it opens with
 * the folder, which no commit field can, so no path can pass for a commit.
 */
async function landingsAt(git: GitRunner, bare: string, tip: string): Promise<Map<string, Landing>> {
  const output = await git(
    bare,
    [
      "-c",
      "log.showRoot=true",
      "-c",
      "log.follow=false",
      "--literal-pathspecs",
      "log",
      "--first-parent",
      "--diff-merges=first-parent",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--diff-filter=A",
      "--name-only",
      "-z",
      "--format=%H %cI",
      tip,
      "--",
      CHANGELOG_FOLDER,
    ],
    LOCAL_READ,
  );
  const landings = new Map<string, Landing>();
  let current: Landing | null = null;
  let commits = 0;
  for (const raw of output.split("\0")) {
    const field = raw.replace(/^\n+/, "");
    if (field === "") continue;
    if (field.startsWith(CHANGELOG_FOLDER)) {
      if (current === null) throw new Error(MALFORMED);
      landings.set(field, current);
      continue;
    }
    const [commit = "", time = "", ...rest] = field.split(" ");
    const at = new Date(time);
    if (!OBJECT_ID.test(commit) || rest.length > 0 || Number.isNaN(at.getTime())) throw new Error(MALFORMED);
    current = { commit, at: at.toISOString(), order: commits };
    commits += 1;
  }
  return landings;
}

/**
 * One repository's changelog at `tip`, the commit its default branch points at, in three steps:
 * the tree listing, the landing log, and one `cat-file blob <blob id>` for each kept file whose
 * blob `held` does not hold. The newest `MAX_CHANGELOG_FILES` files by landing order are kept,
 * chosen before any blob is read, so a file that is no entry takes a place among them like any
 * other. Answers the record, stamped `readAt`, and the parses its rows stand on for the next read
 * to hold. A repository with no `docs/changelog/` folder answers a record with no rows.
 *
 * The parses go into `parsed` as the read takes them: first every kept blob `held` holds, then
 * each blob read. So a read that fails partway through the blob reads leaves in `parsed` the
 * parses of every kept blob known by then, at most `MAX_CHANGELOG_FILES` of them, for the next
 * attempt to hold. A read that fails before the blob reads leaves it empty.
 *
 * `tip` must be a full object id, and each blob id comes from the listing: both are checked by
 * shape, so nothing git could read as a ref name, an option or a path reaches it as a revision.
 * Rejects with the runner's kind where a git command failed, and as `changelog output` where a
 * command's output was not of its shape or a listed file has no landing in the log.
 */
export async function readChangelog(
  git: GitRunner,
  bare: string,
  tip: string,
  held: HeldEntries,
  repo: string,
  readAt: string,
  parsed: Map<string, ChangelogEntry | null> = new Map(),
): Promise<{ record: ChangelogRecord; held: HeldEntries }> {
  if (!OBJECT_ID.test(tip)) throw new Error(MALFORMED);
  const listed = await listedAt(git, bare, tip);
  const landings = await landingsAt(git, bare, tip);
  const files = listed.map((file) => {
    const landing = landings.get(file.path);
    if (landing === undefined) throw new Error(MALFORMED);
    return { ...file, landing };
  });
  // The log's own order, then ascending path by plain string comparison within one commit.
  files.sort((left, right) => left.landing.order - right.landing.order || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const kept = files.slice(0, MAX_CHANGELOG_FILES);
  for (const file of kept) {
    const known = held.get(file.blob);
    if (file.readable && known !== undefined) parsed.set(file.blob, known);
  }
  const rows: ChangelogRow[] = [];
  for (const file of kept) {
    let entry: ChangelogEntry | null = null;
    if (file.readable) {
      const known = parsed.get(file.blob);
      entry = known === undefined ? parseEntry(await git(bare, ["cat-file", "blob", file.blob], LOCAL_READ)) : known;
      parsed.set(file.blob, entry);
    }
    rows.push({ path: file.path, commit: file.landing.commit, at: file.landing.at, entry });
  }
  return { record: { repo, tip, readAt, stale: false, rows, older: files.length - kept.length }, held: parsed };
}
