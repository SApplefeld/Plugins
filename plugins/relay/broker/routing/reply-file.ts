// The one path a file a session names on a reply takes to leave the machine: resolved, bounded to
// the session's own working directory, to the kinds and the cap the thread accepts inbound, and
// read whole into memory once, or refused with a cause from a closed list before anything posts.
//
// The path is the model's own argument and nothing about it is trusted: it is read through the
// same absolute-local-path reader the hook intake uses, both it and the directory are resolved with
// links followed, and the resolved file must lie strictly inside the resolved directory. The
// directory is the one the session was launched in, so a session that changed directory afterwards
// can send nothing from where it went, and a session launched inside a worktree cannot reach the
// checkout above it. The checks run in a fixed order and stop at the first refusal.
//
// The bound is a fence against a path named by mistake, not against the session itself: the file
// is opened by name after containment is checked, so an entry swapped for a link between the two
// calls is followed, and the session can already copy any file its account reads into its own
// directory. Neither gives the session more than it holds.
//
// Nothing here logs, so no path or file name can reach the log from this module; the router
// records the session and the cause from what it is returned. No reason sentence names the path
// either, since the relay shows the model the sentence and the model already holds the path.
import path from "node:path";
import { absoluteLocalPath } from "../intake.ts";
import { TEXT_EXTENSIONS, TYPED_EXTENSIONS, reducedName } from "./attachments.ts";
import type { AttachmentMode } from "./attachments.ts";

/**
 * Why a file was not attached. A closed list, in the order the checks run: the relay shows the
 * model the sentence `REPLY_FILE_REASONS` gives each cause, so the model can fix the argument and
 * send once.
 */
export type ReplyFileCause =
  | "no-workdir"
  | "disabled"
  | "not-absolute"
  | "missing"
  | "outside"
  | "not-a-file"
  | "kind"
  | "empty"
  | "size";

/**
 * The one sentence each cause is reported with, which is what the relay prints to the model. The
 * words are shared with the relay's own test, so they stay here as one table rather than being
 * composed where they are used.
 */
export const REPLY_FILE_REASONS: Readonly<Record<ReplyFileCause, string>> = {
  "no-workdir": "this session's working directory is not recorded or no longer exists",
  disabled: "attachments are turned off on this host",
  "not-absolute": "the path is not an absolute local path",
  missing: "the file does not exist",
  outside: "the path is not under this session's working directory",
  "not-a-file": "the path is not an ordinary file",
  kind: "this kind of file is not accepted",
  empty: "the file is empty",
  size: "the file is larger than the host's attachment limit",
};

/** C0 and DEL, the class the absolute-local-path reader strips. Not global, so `test` holds no state. */
const PATH_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** The media type sent for a text kind, whatever its extension: Discord previews by the name. */
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * The file system this module reads through, as the narrowest shape a test fake needs to answer.
 * `node:fs/promises` satisfies the first two directly; `read` returns at most `limit` bytes of the
 * file, so a file that grew past the cap between the `stat` and the read is still bounded.
 */
export type ReplyFileSystem = {
  realpath: (target: string) => Promise<string>;
  stat: (target: string) => Promise<{ isFile: () => boolean; size: number }>;
  read: (target: string, limit: number) => Promise<Uint8Array>;
};

export type ReplyFileInput = {
  /** The session's recorded working directory, or null where none was recorded. */
  workdir: string | null;
  /** The path as the model passed it. */
  path: string;
  /** The most bytes the file may hold, the same cap one inbound file takes. */
  maxBytes: number;
  mode: AttachmentMode;
  /** `process.platform` in production; a parameter so the tests drive both path shapes. */
  platform: NodeJS.Platform;
  fs: ReplyFileSystem;
};

/** What is posted: the reduced name Discord shows, the bytes, and the part's declared type. */
export type ReplyFile = { name: string; bytes: Uint8Array; contentType: string };

/** How a read settled: the file to post, or the cause it was refused for. */
export type ReplyFileResult =
  | { file: ReplyFile; refused: null }
  | { file: null; refused: ReplyFileCause };

/**
 * Whether `file` lies strictly inside `directory`, both already resolved. Pure over the two
 * strings and the platform, so a test drives Windows and POSIX shapes without a disk.
 *
 * `relative` rather than a string prefix: a sibling directory whose name extends the session's,
 * `D:\personas\ARCHITECT2` beside `D:\personas\ARCHITECT`, is outside, which a prefix check would
 * admit. The relative path is outside when it is empty (the directory itself), absolute (another
 * volume on Windows), or climbs out through a `..` segment. Only a whole segment counts, so a file
 * whose own name opens with two dots is still inside. On Windows both paths are lower-cased first,
 * since the volume is case-insensitive and a reply must not escape by case; on POSIX two names
 * differing by case are two directories.
 */
export function insideDirectory(directory: string, file: string, platform: NodeJS.Platform): boolean {
  const api = platform === "win32" ? path.win32 : path.posix;
  const fold = (value: string): string => (platform === "win32" ? value.toLowerCase() : value);
  const relative = api.relative(fold(directory), fold(file));
  if (relative === "" || api.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${api.sep}`);
}

/** The extension of a reduced name, lower-cased, or empty where it has none or is only a dot-name. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** The content type an accepted kind is posted under, or null where the kind is not on the list. */
function contentTypeOf(extension: string): string | null {
  const typed = TYPED_EXTENSIONS.get(extension);
  if (typed !== undefined) return typed;
  return TEXT_EXTENSIONS.has(extension) ? TEXT_CONTENT_TYPE : null;
}

/**
 * Reads the file a reply names, or refuses it. Resolves on every path: a file system call that
 * fails inside a check is that check's refusal, never a throw. A `realpath` of the directory that
 * fails is `no-workdir`, and of the file is `missing`; a `stat` or read that fails after the file
 * resolved is `missing` too, since the entry went away or cannot be opened between two calls and no
 * cause on the list is nearer.
 */
export async function readReplyFile(input: ReplyFileInput): Promise<ReplyFileResult> {
  const refused = (cause: ReplyFileCause): ReplyFileResult => ({ file: null, refused: cause });

  // 1. The directory the broker holds for this session, which is the whole of where a file may
  // come from.
  if (input.workdir === null) return refused("no-workdir");
  // 2. The host's setting, read before the path so a disabled host reads nothing off its disk.
  if (input.mode === "off") return refused("disabled");
  // 3. The same reader the intake applies to the directory itself, so a relative path, a UNC path
  // or an over-long one is refused whole. A control character is refused here first, since that
  // reader strips one and the cleaned path would name a file other than the one the model named.
  if (PATH_CONTROL_CHARACTER.test(input.path)) return refused("not-absolute");
  const named = absoluteLocalPath(input.path);
  if (named === null) return refused("not-absolute");

  // 4. The directory, resolved with links followed. A failure is the directory deleted or renamed
  // since the session started.
  let directory: string;
  try {
    directory = await input.fs.realpath(input.workdir);
  } catch {
    return refused("no-workdir");
  }
  // 5. The file, resolved the same way, so a link is compared by where it points.
  let resolved: string;
  try {
    resolved = await input.fs.realpath(named);
  } catch {
    return refused("missing");
  }
  // 6. Strictly inside the resolved directory.
  if (!insideDirectory(directory, resolved, input.platform)) return refused("outside");

  // 7. An ordinary file, by a stat of the resolved entry.
  let info: { isFile: () => boolean; size: number };
  try {
    info = await input.fs.stat(resolved);
  } catch {
    return refused("missing");
  }
  if (!info.isFile()) return refused("not-a-file");

  // 8. A kind on the inbound list, judged on the reduced name since that is the name posted. The
  // base name is taken with the platform's own separator rules.
  const api = input.platform === "win32" ? path.win32 : path.posix;
  const name = reducedName(api.basename(resolved));
  const contentType = contentTypeOf(extensionOf(name));
  if (contentType === null) return refused("kind");

  // 9. and 10. The size by stat, then the bounded read, which asks for one byte past the cap so a
  // file that grew between the two calls is still refused rather than cut.
  if (info.size === 0) return refused("empty");
  if (info.size > input.maxBytes) return refused("size");
  let bytes: Uint8Array;
  try {
    bytes = await input.fs.read(resolved, input.maxBytes + 1);
  } catch {
    return refused("missing");
  }
  if (bytes.byteLength > input.maxBytes) return refused("size");

  return { file: { name, bytes, contentType }, refused: null };
}
