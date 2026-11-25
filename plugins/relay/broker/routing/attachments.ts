// The one path a file attached to a Discord message takes to reach a session: fetched from
// Discord's CDN, bounded, and either handed back as the words of a pasted message or written
// under the attachments folder for the session to open with its own tools. The files the web
// page and the local door carry take the same folder and the same writer through `createWebFiles`
// at the foot: a file the operator sends from the page or a portal person sends through the door,
// and the copy of a file a reply lands, kept for the page or the door to fetch.
//
// This is the only code that fetches an attachment or writes one to disk, and nothing it reads out
// of the attachment is trusted. The name decides a participant's kind, an operator's file is saved
// as sent, and the name, reduced to a safe alphabet, is the one sender-chosen part of any path
// written here. The declared size is never consulted: the cap is enforced on the bytes as they
// stream, since the declared size is the sender's claim. The URL is fetched only when it names one
// of Discord's two CDN hosts over https with no port and no redirect, since the broker would
// otherwise fetch any address a message object named.
//
// Every per-file problem is a refusal with a cause from a closed list, and one file's failure never
// stops the others: the router posts each refusal to the thread under its file's reduced name, so
// nothing is dropped in silence. Nothing here logs, so no file name, URL or content can reach the
// log from this module; the router records counts and causes from what it is returned.
import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Readable } from "node:stream";
import { withoutInvisible } from "../sanitize.ts";
import type { SenderClass } from "../security/senders.ts";

/** One attachment as the gateway reports it, every field Discord's own and none of them trusted. */
export type InboundAttachment = {
  id: string;
  name: string;
  /** Discord's declared size. Read by nothing here: the cap is enforced on the bytes read. */
  size: number;
  /** Discord's reported content type, or null where it reported none. */
  contentType: string | null;
  url: string;
};

/** Who may attach a file: nobody, the operator alone, or every allowed account. */
export type AttachmentMode = "off" | "operator" | "all";

/**
 * Why an attachment was not delivered. A closed list: the router's notice names each cause in
 * plain words, and a cause it does not know would reach the thread as nothing.
 */
export type RefusalCause = "disabled" | "sender" | "count" | "kind" | "size" | "source" | "fetch";

/** A refusal names its file by the reduced name, which is the only form of the name a notice carries. */
export type AttachmentRefusal = { name: string; cause: RefusalCause };

/** How a file write settled: its absolute path, or the refusal to post in its place. */
export type SaveOutcome =
  | { path: string; refusal: null }
  | { path: null; refusal: AttachmentRefusal };

/**
 * The pasted message Discord turned into `message.txt`, decoded and stripped of the invisible
 * class the typed text is stripped of. Not written to disk unless the caller asks, since the router
 * delivers it inline where it fits the pipe and only knows that once it has measured the event.
 */
export type IntakePaste = {
  text: string;
  /** Writes Discord's original bytes as a file at the paste's own list position. */
  saveAsFile: () => Promise<SaveOutcome>;
};

export type IntakeResult = {
  paste: IntakePaste | null;
  /** Absolute paths of the files written, in the order their attachments were listed. */
  saved: readonly string[];
  refusals: readonly AttachmentRefusal[];
};

/**
 * The one request this module makes, as the narrowest shape a test fake needs to answer. The
 * global `fetch` satisfies it, and the default is that. Redirects are never followed: `manual`
 * hands a 3xx back as a status, and the status is refused as a source that was not Discord's.
 */
export type AttachmentFetch = (
  url: string,
  init: { signal: AbortSignal; redirect: "manual" },
) => Promise<{ status: number; body: ReadableStream<Uint8Array> | null }>;

/** Writes one file whole. Injectable so a test reaches a write that fails without a bad disk. */
export type AttachmentWrite = (file: string, bytes: Uint8Array, signal: AbortSignal) => Promise<void>;

export type AttachmentIntakeOptions = {
  mode: AttachmentMode;
  /** The most bytes one file may stream before it is refused. */
  maxBytes: number;
  /**
   * The absolute folder files are written under, one child folder per session: the folder the
   * broker's start settled, which is `attachmentsRoot` of the state file's folder by default.
   */
  root: string;
  fetch?: AttachmentFetch;
  writeFile?: AttachmentWrite;
  /** The whole of one message's intake, every file's download and write under one timer. Injectable so a test reaches the limit without waiting it out. */
  limitMs?: number;
};

export type AttachmentIntake = {
  /**
   * Takes one message's attachments in. Resolves on every path: a problem with one file is a
   * refusal in the result, never a throw, and the other files are unaffected by it.
   */
  take: (
    attachments: readonly InboundAttachment[],
    senderClass: SenderClass,
    sessionId: string,
    messageId: string,
  ) => Promise<IntakeResult>;
  /** The absolute folder every saved file sits under, one child folder per session. */
  root: string;
};

/**
 * Most attachments one message may carry in. Discord itself allows ten per message, so the cap
 * matches what a client can send; a message past it is refused per file rather than cut.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** How long one message's whole intake may run before every unfinished file is refused. */
export const INTAKE_LIMIT_MS = 60 * 1000;

/** The longest reduced name written, in characters, extension included. */
export const MAX_REDUCED_NAME_LENGTH = 80;

/** The name of the file Discord makes of a message typed past its length limit. */
const PASTE_NAME = "message.txt";

/**
 * Which kinds a participant's file may be, by extension, compared without regard to letter case.
 * The list is closed: a participant's file whose extension is absent from it is refused, whatever
 * content type Discord reported. For a text extension the content type is not consulted, since
 * Discord derives it from the same extension. For an image or a document the reported media type
 * must also be the one named here, so that a file wearing an image's extension over another kind of
 * content is refused. An operator's file is not held to the list.
 *
 * Exported because the reply file reader names the content type of a file it posts from these
 * lists. They bound a participant's file inbound and name content types outbound, and nothing else.
 */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml", ".sql", ".cs", ".js", ".ts",
  ".py", ".ps1", ".sh", ".html", ".css",
]);
export const TYPED_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".pdf", "application/pdf"],
]);

/** The only hosts fetched, exactly as named: Discord's attachment CDN and its media proxy. */
const SOURCE_HOSTS: ReadonlySet<string> = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

/**
 * The stem a name reduces to when nothing of it survives the alphabet: a name written in a script
 * outside ASCII, or one made only of dots. Fixed rather than derived, so the result is a word a
 * notice can carry and never `.` or `..`.
 */
const FALLBACK_STEM = "file";

/**
 * The longest session or message id written into a path. Half the 256 the hook route admits for any
 * field, because this bound answers a different question: it keeps each path component under the
 * 255 characters a file system allows. The ids the broker meets are far shorter, and a write that
 * fails on a long path is refused as `fetch` with a notice, never lost in silence.
 */
export const MAX_PATH_ID_LENGTH = 128;

/**
 * A session or message id as it may appear in a path: one segment, with no separator, never `.`
 * or `..`, never empty, and at most `MAX_PATH_ID_LENGTH` characters. Both ids come from the broker
 * rather than the sender, but a session id is announced by a local process through the hook route
 * and is only cleaned of control characters there, so the guard holds whatever that process named.
 */
const PATH_SEGMENT = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${String(MAX_PATH_ID_LENGTH - 1)}}$`);

/**
 * A sender-chosen file name reduced to what may be written: ASCII letters, digits, dot, dash and
 * underscore, cut to `MAX_REDUCED_NAME_LENGTH` with the extension kept.
 *
 * Every other character is dropped rather than replaced, so a separator, a drive letter's colon
 * or an invisible character leaves no trace. Trailing dots are dropped too, since NTFS strips them
 * from a name on creation and the path returned must be the path written. The extension is kept
 * through the cut so the kind it declares survives: a 300-character `.txt` is still a `.txt`. An
 * extension that would leave no room for a stem is cut with the rest, since no real kind has one
 * that long and the name still reaches a notice. A stem with nothing left, or with dots alone,
 * takes `FALLBACK_STEM`, so a result is never empty and never a bare dot sequence.
 *
 * Exported because a notice names a refused file by this form alone, and the router composes that
 * notice from a name it never fetched.
 */
export function reducedName(name: string): string {
  const kept = name.replace(/[^A-Za-z0-9._-]/g, "").replace(/\.+$/, "");
  const dot = kept.lastIndexOf(".");
  const stem = dot >= 0 ? kept.slice(0, dot) : kept;
  const extension = dot >= 0 ? kept.slice(dot) : "";
  // A stem of nothing, or of dots alone, is a name a notice cannot carry and a path must not take.
  // A name that is only an extension, as a stem written outside ASCII reduces to, is one of these.
  const named = /^\.*$/.test(stem) ? FALLBACK_STEM : stem;
  const whole = `${named}${extension}`;
  if (whole.length <= MAX_REDUCED_NAME_LENGTH) return whole;
  if (extension.length >= MAX_REDUCED_NAME_LENGTH) return whole.slice(0, MAX_REDUCED_NAME_LENGTH);
  return `${named.slice(0, MAX_REDUCED_NAME_LENGTH - extension.length)}${extension}`;
}

/** The extension of a reduced name, lower-cased, or empty where it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** The media type of a reported content type, with any parameter such as a charset dropped. */
function mediaTypeOf(contentType: string | null): string | null {
  if (contentType === null) return null;
  const media = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return media === "" ? null : media;
}

/** Whether the extension and the reported content type together name an accepted kind. */
function acceptedKind(name: string, contentType: string | null): boolean {
  const extension = extensionOf(name);
  if (TEXT_EXTENSIONS.has(extension)) return true;
  const required = TYPED_EXTENSIONS.get(extension);
  return required !== undefined && mediaTypeOf(contentType) === required;
}

/**
 * Whether the URL is one this module will fetch: https alone, one of Discord's two hosts exactly,
 * and no port named. A URL that does not parse is not a source either.
 */
function acceptedSource(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.port === "" && SOURCE_HOSTS.has(parsed.hostname);
}

/** Whether this attachment is the paste: named exactly `message.txt`, reported as plain text or untyped. */
function isPaste(attachment: InboundAttachment): boolean {
  if (attachment.name !== PASTE_NAME) return false;
  const media = mediaTypeOf(attachment.contentType);
  return media === null || media === "text/plain";
}

/**
 * Rejects when the signal aborts, whatever `work` does. The real fetch and its body reader both
 * observe the signal, but the limit is a promise this module makes about the message, so it is
 * held here rather than trusted to every reader down the line.
 */
export function withinLimit<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    // Settled before the aborted check, so a `work` that rejects after the limit has fired still
    // has a handler. An unhandled rejection terminates the broker.
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Reads a body whole, or stops at the first byte past the cap. The cap is the running count of
 * bytes received and never a declared length, and a read past it cancels the stream so no more of
 * the body is pulled.
 */
export async function readBounded(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | "size"> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // The cancellation's own settlement is nothing this reader waits on: the refusal stands
      // whether or not the far side acknowledges it.
      reader.cancel().catch(() => undefined);
      return "size";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The refusal `writeWhole` throws for a session folder that is not the folder its path names. It holds no path. */
const NOT_ITS_OWN_FOLDER = "the folder a saved file goes in is not the folder its path names, or its real path cannot be read";

/**
 * Writes one file whole: to a sibling temp file under a unique name, then renamed over the target,
 * so a write that fails leaves no partial file for a session to open. On a POSIX host the folder is
 * made for the owning user only and the file written the same way, as the registry snapshot is.
 * Windows ignores those modes, and there the attachments folder's own access list is what holds. Throws
 * on failure with no temp file left behind.
 *
 * After the folder is made and before anything is written, the folder must pass `namesItsOwnFolder`:
 * its real path is its parent's real path joined to its name. A session folder that is a link,
 * a junction whose target is written in the volume form among them, fails, and so does one whose
 * real path cannot be resolved; either throws, with no path in the message, and writes no temp file
 * and no target. The check runs for the default folder and a named one alike, and a link above the
 * session folder passes, since the parent is resolved. It narrows the gap between the check and the
 * write and does not close it: a folder swapped for a link after the check is still written through.
 */
export async function writeWhole(file: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  const folder = path.dirname(file);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let own: boolean;
  try {
    own = await namesItsOwnFolder(folder);
  } catch {
    own = false;
  }
  if (!own) throw new Error(NOT_ITS_OWN_FOLDER);
  try {
    await writeFile(temp, bytes, { mode: 0o600, signal });
    // A file whose limit fired before the rename began is not renamed into place. A limit firing
    // during the rename itself can leave a refused file in the store, which retention prunes.
    signal.throwIfAborted();
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** The fatal decoder: it throws on a byte sequence that is not UTF-8 rather than painting a replacement character. */
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** A paste is delivered as words only when every byte of it decodes; otherwise it is saved whole. */
function decodePaste(bytes: Uint8Array): string | null {
  try {
    return withoutInvisible(UTF8.decode(bytes));
  } catch {
    return null;
  }
}

/** What one attachment became: its refusal, its saved path, or the paste it was decoded into. */
type Outcome =
  | { kind: "refused"; refusal: AttachmentRefusal }
  | { kind: "saved"; path: string }
  | { kind: "paste"; paste: IntakePaste };

export function createAttachmentIntake(options: AttachmentIntakeOptions): AttachmentIntake {
  const root = options.root;
  const request: AttachmentFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const write = options.writeFile ?? writeWhole;
  const limitMs = options.limitMs ?? INTAKE_LIMIT_MS;

  /** Who may attach, read once per message: the setting and the sender's class decide it together. */
  function gateCause(senderClass: SenderClass): RefusalCause | null {
    if (options.mode === "off") return "disabled";
    if (options.mode === "operator" && senderClass !== "operator") return "sender";
    return null;
  }

  /**
   * The path one attachment is written to, or null where the ids would not resolve to a single
   * segment each. Checked again after the join: the segment rule above is what makes the resolved
   * path sit under the root, and a path that does not is never written whatever the rule said.
   */
  function targetPath(sessionId: string, messageId: string, position: number, name: string): string | null {
    if (!PATH_SEGMENT.test(messageId)) return null;
    return savedFilePath(root, sessionId, `${messageId}-${String(position)}-${name}`);
  }

  /** Writes the bytes, and reports a write that fails as a file that could not be brought down. */
  async function save(target: string, name: string, bytes: Uint8Array, signal: AbortSignal): Promise<SaveOutcome> {
    try {
      await withinLimit(write(target, bytes, signal), signal);
      return { path: target, refusal: null };
    } catch {
      return { path: null, refusal: { name, cause: "fetch" } };
    }
  }

  /** Fetches one attachment's bytes under the cap, or the cause it was refused for. */
  async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array | RefusalCause> {
    try {
      const response = await withinLimit(request(url, { signal, redirect: "manual" }), signal);
      if (response.status < 200 || response.status >= 300) {
        // A body nobody reads holds its connection until it is collected, so a refused one is let go.
        response.body?.cancel().catch(() => undefined);
        return response.status >= 300 && response.status < 400 ? "source" : "fetch";
      }
      if (response.body === null) return "fetch";
      return await withinLimit(readBounded(response.body, options.maxBytes), signal);
    } catch {
      return "fetch";
    }
  }

  async function takeOne(
    attachment: InboundAttachment,
    position: number,
    paste: boolean,
    gate: RefusalCause | null,
    kindBound: boolean,
    sessionId: string,
    messageId: string,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const name = reducedName(attachment.name);
    const refused = (cause: RefusalCause): Outcome => ({ kind: "refused", refusal: { name, cause } });
    if (gate !== null) return refused(gate);
    if (position > MAX_ATTACHMENTS_PER_MESSAGE) return refused("count");
    if (kindBound && !acceptedKind(name, attachment.contentType)) return refused("kind");
    if (!acceptedSource(attachment.url)) return refused("source");
    // An id that cannot be written under is a broker-side fault and no cause on the list names
    // it. Refused as a file that could not be brought down, before any byte of it is fetched,
    // since the notice is what keeps the drop from being silent.
    const target = targetPath(sessionId, messageId, position, name);
    if (target === null) return refused("fetch");
    const bytes = await fetchBytes(attachment.url, signal);
    if (typeof bytes === "string") return refused(bytes);
    if (paste) {
      const text = decodePaste(bytes);
      if (text !== null) {
        // The caller asks for the file only after it has measured the event, so the write takes a
        // limit of its own rather than whatever is left of the message's.
        const saveAsFile = (): Promise<SaveOutcome> => save(target, name, bytes, AbortSignal.timeout(limitMs));
        return { kind: "paste", paste: { text, saveAsFile } };
      }
    }
    const saved = await save(target, name, bytes, signal);
    return saved.path === null ? { kind: "refused", refusal: saved.refusal } : { kind: "saved", path: saved.path };
  }

  return {
    root,
    async take(attachments, senderClass, sessionId, messageId) {
      const gate = gateCause(senderClass);
      // The kind list bounds a participant's file alone; an operator's file is saved as sent.
      const kindBound = senderClass !== "operator";
      // The first attachment that is the paste, and only that one: a second `message.txt` is an
      // ordinary text file, saved whole like any other.
      const pasteAt = attachments.findIndex(isPaste);
      // One timer for the whole message: every file is fetched together under it, and a file
      // unfinished when it fires is refused as one that could not be brought down.
      const signal = AbortSignal.timeout(limitMs);
      const outcomes = await Promise.all(
        attachments.map((attachment, index) =>
          takeOne(attachment, index + 1, index === pasteAt, gate, kindBound, sessionId, messageId, signal),
        ),
      );
      const saved: string[] = [];
      const refusals: AttachmentRefusal[] = [];
      let paste: IntakePaste | null = null;
      for (const outcome of outcomes) {
        if (outcome.kind === "saved") saved.push(outcome.path);
        else if (outcome.kind === "refused") refusals.push(outcome.refusal);
        else paste = outcome.paste;
      }
      return { paste, saved, refusals };
    },
  };
}

/**
 * The default folder every saved attachment lives under, one folder per session, inside the state
 * directory. A host that names a folder in CHANNEL_ATTACHMENT_DIR uses that one instead.
 */
export function attachmentsRoot(stateDir: string): string {
  return path.resolve(stateDir, "attachments");
}

/** The file `claimAttachmentRoot` writes at the root of a named folder to mark it as this broker's. */
export const ATTACHMENT_MARKER = ".channels-attachments";

/** The marker's whole content, for a person who opens the folder and wonders what the file is. */
const MARKER_TEXT = "The Channels broker saves attachments in this folder and deletes old files from it.\n";

const OTHER_CONTENT =
  "CHANNEL_ATTACHMENT_DIR names a folder that holds other content and no marker of this broker; " +
  "the broker deletes old files in the folder it saves attachments in, so it starts only on a folder " +
  "that is absent, empty or already marked";

const CANNOT_CLAIM =
  "CHANNEL_ATTACHMENT_DIR names a path this broker cannot claim as its attachments folder; " +
  "name a folder that is absent, empty or already marked";

const REAL_PATH_DIFFERS =
  "CHANNEL_ATTACHMENT_DIR names a folder whose real path differs from the path given; " +
  "name the folder by its full real path, not through a link or a short name";

/** Whether two real paths name one entry: without regard to case on Windows, whose names ignore it. */
function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Whether the folder at `root` is the one its path names: its real path is its parent's real path
 * joined to its own name. The parent is resolved too, so a mapped or substituted drive above it
 * passes, and only a link at `root` itself fails. That includes a junction whose target is written
 * in the volume form, which `lstat` reports as a plain directory and `fs.promises.realpath`
 * resolves. Rejects where either path cannot be resolved. A drive root or share root is its own
 * parent, has no name to join and cannot be a link, so it names its own folder.
 */
export async function namesItsOwnFolder(root: string): Promise<boolean> {
  if (path.dirname(root) === root) return true;
  const parent = await realpath(path.dirname(root));
  return samePath(await realpath(root), path.join(parent, path.basename(root)));
}

/** Whether the real path of `entry` is `expected`, and false where it cannot be resolved. */
async function realPathIs(entry: string, expected: string): Promise<boolean> {
  try {
    return samePath(await realpath(entry), expected);
  } catch {
    return false;
  }
}

/** A refusal for a filesystem failure, carrying the failure's code and nothing else, so no path reaches the log. */
function unreadable(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code ?? "unknown";
  return new Error(`CHANNEL_ATTACHMENT_DIR names a folder the broker cannot read or write (${code})`);
}

/** The entry at `file` as `lstat` reads it, which never follows a link, or null where nothing is there. */
async function entryAt(file: string): Promise<Stats | null> {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw unreadable(error);
  }
}

/**
 * Writes the marker into `root` with the mode `writeWhole` gives a saved file. The create is
 * exclusive, so an entry of the marker's name that appeared after the folder was read is neither
 * followed nor replaced, and the claim refuses instead. A write that fails after the create removes
 * the file this call made, so a refusal leaves no marker.
 */
async function writeMarker(root: string): Promise<void> {
  const file = path.join(root, ATTACHMENT_MARKER);
  let handle: FileHandle;
  try {
    handle = await open(file, "wx", 0o600);
  } catch (error) {
    throw unreadable(error);
  }
  try {
    await handle.writeFile(MARKER_TEXT);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    // A failed remove is dropped, since its error holds the path and the write's code is the refusal.
    await rm(file, { force: true }).catch(() => undefined);
    throw unreadable(error);
  }
}

/**
 * Settles that the broker may save attachments in, and prune, the folder CHANNEL_ATTACHMENT_DIR
 * names. The retention pass deletes old files in every subfolder of its root and checks no name, so
 * the broker takes a named folder only where it made the folder or marked it. An absent folder is
 * created with the mode `writeWhole` gives a session folder and marked. An empty folder is marked. A
 * folder holding the marker as a regular file resolves as it is, which is a restart over its own
 * folder. Every entry is read with `lstat`, so a link `lstat` reports at the root or in the marker's
 * place is not taken for a folder or a marker. An existing folder must also pass
 * `namesItsOwnFolder`, which refuses a junction `lstat` reports as a plain directory.
 *
 * Every other case rejects, having deleted nothing and left no marker: the folder is read whole and
 * the decision made before anything is written. No message holds the path, since the start writes
 * the refusal to the log.
 */
export async function claimAttachmentRoot(root: string): Promise<void> {
  await claimOnce(root, true);
}

/**
 * One reading of `root` and the decision on it. An absent folder's parent is made recursively, and
 * the folder itself is made alone, so an entry that appeared after the read fails the create rather
 * than passing as made by this broker. That failure reads the root again once and decides on what is
 * there now, so a link in its place meets the not-a-directory rule or the real-path rule and a
 * filled folder the other-content rule. A folder this call made is its own and is not compared. A
 * parent that is a drive or share root is not made, since it exists and Windows refuses even a
 * recursive create of a drive root.
 */
async function claimOnce(root: string, readAgain: boolean): Promise<void> {
  const info = await entryAt(root);
  if (info === null) {
    const parent = path.dirname(root);
    try {
      if (path.dirname(parent) !== parent) await mkdir(parent, { recursive: true, mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
    } catch (error) {
      if (readAgain && (error as NodeJS.ErrnoException).code === "EEXIST") return claimOnce(root, false);
      throw unreadable(error);
    }
    await writeMarker(root);
    return;
  }
  if (!info.isDirectory()) throw new Error(CANNOT_CLAIM);
  let own: boolean;
  try {
    own = await namesItsOwnFolder(root);
  } catch (error) {
    throw unreadable(error);
  }
  if (!own) throw new Error(REAL_PATH_DIFFERS);
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    throw unreadable(error);
  }
  if (names.length === 0) {
    await writeMarker(root);
    return;
  }
  if (!names.includes(ATTACHMENT_MARKER)) throw new Error(OTHER_CONTENT);
  const marker = await entryAt(path.join(root, ATTACHMENT_MARKER));
  if (marker === null || !marker.isFile()) throw new Error(CANNOT_CLAIM);
}

/**
 * The path a file named `fileName` is written to in the session's folder under `root`, or null where
 * the session id would not resolve to one segment or the joined path would sit anywhere but directly
 * in that folder. The session id is held to `PATH_SEGMENT`, and the file name is one the caller
 * composed from broker-made parts and a name through `reducedName`; the check after the join is what
 * holds whatever either said.
 */
export function savedFilePath(root: string, sessionId: string, fileName: string): string | null {
  if (!PATH_SEGMENT.test(sessionId)) return null;
  const folder = path.resolve(root, sessionId);
  const target = path.resolve(folder, fileName);
  return target.startsWith(rootPrefix(root)) && path.dirname(target) === folder ? target : null;
}

/**
 * The text every path inside the attachments folder `root` starts with: the root and one separator.
 * `path.resolve` keeps the separator after a drive root such as `D:\` and a share root such as
 * `\\files\share\`, so that root already ends in it and gains no second one.
 */
export function rootPrefix(root: string): string {
  return root.endsWith(path.sep) ? root : `${root}${path.sep}`;
}

// ---------------------------------------------------------------------------------------------
// The web page's and the local door's files
// ---------------------------------------------------------------------------------------------

/**
 * One file the web page or the local door can name: a file the operator sent from the page or a
 * portal person sent through the door with the door's key (`upload`), saved for the session to
 * open, or the copy of a file a reply landed (`reply`), kept for the page or the door to fetch.
 * `name` is the reduced name, the only form of the name the page, the door and the thread are shown.
 */
export type WebFile = {
  kind: "upload" | "reply";
  sessionId: string;
  path: string;
  name: string;
  size: number;
  contentType: string;
};

/** A file as a talk line carries it: its name, its size and the page's link to it. */
export type WebFileLink = { name: string; size: number; url: string };

/** The page's link to a file the store holds under `id`. */
export const WEB_FILE_URL_PREFIX = "/web/file/";

/** The shape of a file id the web files store hands out: a random UUID, lower-case as Node writes it. */
export const WEB_FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The body read whole, or `size` at the first byte past `maxBytes`, or null where the request failed
 * or closed before its end. The count is of the bytes received and never a declared length, and the
 * read stops at the cap: the request is paused and nothing more of it is kept, so an oversized
 * upload costs at most the cap in memory. The bytes are kept as received and never decoded, so a
 * file of any kind arrives whole. The operator's page and the local door read an upload through it.
 */
export function readUpload(request: IncomingMessage, maxBytes: number): Promise<Buffer | "size" | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (outcome: Buffer | "size" | null): void => {
      if (settled) return;
      settled = true;
      request.off("data", take);
      resolve(outcome);
    };
    const take = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > maxBytes) {
        chunks.length = 0;
        request.pause();
        settle("size");
        return;
      }
      chunks.push(chunk);
    };
    request.on("data", take);
    request.on("end", () => settle(Buffer.concat(chunks)));
    request.on("error", () => settle(null));
    request.on("close", () => settle(null));
  });
}

/**
 * A refusal of an upload whose body is unread or only part read: a status, no body, and the
 * connection closed after it, so the rest of the body is never read or drained.
 */
export function refuseUpload(response: ServerResponse, status: number): void {
  response.writeHead(status, { "content-length": 0, connection: "close" });
  response.end();
}

/**
 * The content type an uploaded file is kept and posted under. The page's file is the operator's
 * and the door's is the door key's holder's, each saved as sent with no kind list, so nothing about
 * its kind is claimed from its name.
 */
const UPLOAD_CONTENT_TYPE = "application/octet-stream";

export type WebFilesOptions = {
  /**
   * The absolute folder files are written under, one child folder per session: the same folder the
   * attachment intake is given, so the retention pass sweeps both stores' files.
   */
  root: string;
  /** The clock a file's name is stamped with. Injected so a test fixes it. */
  now?: () => number;
  /** Writes one file whole. Injectable so a test reaches a write that fails without a bad disk. */
  writeFile?: AttachmentWrite;
};

export type WebFiles = {
  /**
   * Writes the bytes the page or the door sent as `<root>/<sessionId>/web-<time>-<n>-<reducedName>`,
   * whole and owner-only, and answers the id the page's say post or the door's posted line names it
   * by, or null where the path would not form or the write failed. A failed write leaves no file.
   */
  saveUpload: (sessionId: string, name: string, bytes: Uint8Array) => Promise<string | null>;
  /** The upload held under `id`, or null for an id this store did not hand out for an upload. */
  upload: (id: string) => WebFile | null;
  /**
   * Reserves the id of a copy of a reply's file at `<root>/<sessionId>/out-<time>-<n>-<name>` and
   * answers the link a talk line carries with the write that lands it, or null where the path would
   * not form. Nothing is written until `write` is called. The id serves nothing until the write has
   * landed, and nothing ever where it fails: `write` resolves false then, and the id is forgotten.
   */
  reserveReply: (
    sessionId: string,
    file: { name: string; bytes: Uint8Array; contentType: string },
  ) => { link: WebFileLink; write: () => Promise<boolean> } | null;
  /**
   * The file the page's link names by `id`, of either kind, or null for one this store does not hold
   * or whose write has not landed.
   */
  served: (id: string) => WebFile | null;
  /**
   * The bytes of the file held under `id`, read from where this store wrote it, or null where the id
   * is not served or the file is gone or cannot be read. A file found gone forgets its id.
   */
  bytesOf: (id: string) => Promise<Uint8Array | null>;
  /**
   * The file held under `id` opened for a download: what the store recorded of it, its size on disk
   * as the open file reads it, and a stream of its bytes that closes the file at its end or on error.
   * Null where the id is not served, or the file is gone, is not a regular file or cannot be opened.
   * A file found gone forgets its id.
   */
  open: (id: string) => Promise<{ file: WebFile; size: number; stream: Readable } | null>;
  /** The link to the file this store wrote at `file`, or null for a path it did not write. */
  linkFor: (file: string) => WebFileLink | null;
  /** Forgets every id, as a broker restart does: the files stay on disk for the prune to take. */
  clear: () => void;
};

/**
 * The most ids the web files store holds at once. Past it the oldest id is forgotten, its link
 * answers 404, and its file stays on disk for the retention prune.
 */
export const WEB_FILES_HELD = 1000;

/**
 * The store of the files the web page and the local door carry, one store with one id space for
 * both. The ids are random and held in memory alone, so after a broker restart a line keeps its
 * file's name and size and its link answers 404. At most `WEB_FILES_HELD` ids are held, the oldest
 * forgotten first, and an id whose file is found gone when it is read is forgotten then. Each file
 * is written through `writeWhole`, the writer a Discord attachment takes, under the session's
 * folder that `savedFilePath` forms, so the retention prune sweeps these files with the rest. `n`
 * counts the files this store has named since the broker started, so two files in one millisecond
 * under one name are two files. Nothing here logs.
 */
export function createWebFiles(options: WebFilesOptions): WebFiles {
  const root = options.root;
  const now = options.now ?? Date.now;
  const write = options.writeFile ?? writeWhole;
  const byId = new Map<string, WebFile>();
  const byPath = new Map<string, string>();
  /** Ids reserved for a reply's copy whose write has not landed yet. */
  const pending = new Set<string>();
  let named = 0;

  const linkOf = (id: string, file: WebFile): WebFileLink => ({ name: file.name, size: file.size, url: `${WEB_FILE_URL_PREFIX}${id}` });

  /** The path the next file of `kind` takes in the session's folder, or null where it would not form. */
  function nextPath(kind: WebFile["kind"], sessionId: string, name: string): string | null {
    named += 1;
    const prefix = kind === "upload" ? "web" : "out";
    return savedFilePath(root, sessionId, `${prefix}-${String(now())}-${String(named)}-${name}`);
  }

  function forget(id: string): void {
    const held = byId.get(id);
    byId.delete(id);
    pending.delete(id);
    if (held !== undefined && byPath.get(held.path) === id) byPath.delete(held.path);
  }

  /** Holds `file` under a new id, forgetting the oldest ids past the bound, and answers the id. */
  function hold(file: WebFile): string {
    const id = randomUUID();
    byId.set(id, file);
    byPath.set(file.path, id);
    for (const oldest of byId.keys()) {
      if (byId.size <= WEB_FILES_HELD) break;
      forget(oldest);
    }
    return id;
  }

  /** The id's file where its write has landed, or null. */
  function servedFile(id: string): WebFile | null {
    return pending.has(id) ? null : (byId.get(id) ?? null);
  }

  const isGone = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

  return {
    async saveUpload(sessionId, name, bytes) {
      const reduced = reducedName(name);
      const target = nextPath("upload", sessionId, reduced);
      if (target === null) return null;
      try {
        await write(target, bytes, AbortSignal.timeout(INTAKE_LIMIT_MS));
      } catch {
        return null;
      }
      return hold({ kind: "upload", sessionId, path: target, name: reduced, size: bytes.byteLength, contentType: UPLOAD_CONTENT_TYPE });
    },
    upload(id) {
      const file = servedFile(id);
      return file !== null && file.kind === "upload" ? file : null;
    },
    reserveReply(sessionId, file) {
      // The reply's name is already reduced by the reply file reader; reduced again here so a path
      // this store forms never depends on what a caller did first.
      const name = reducedName(file.name);
      const target = nextPath("reply", sessionId, name);
      if (target === null) return null;
      const held: WebFile = { kind: "reply", sessionId, path: target, name, size: file.bytes.byteLength, contentType: file.contentType };
      const id = hold(held);
      pending.add(id);
      return {
        link: linkOf(id, held),
        async write() {
          try {
            await write(target, file.bytes, AbortSignal.timeout(INTAKE_LIMIT_MS));
          } catch {
            forget(id);
            return false;
          }
          // An id forgotten past the bound while the write ran stays forgotten; its file is the prune's.
          pending.delete(id);
          return true;
        },
      };
    },
    served: (id) => servedFile(id),
    async bytesOf(id) {
      const held = servedFile(id);
      if (held === null) return null;
      try {
        return await readFile(held.path);
      } catch (error) {
        if (isGone(error)) forget(id);
        return null;
      }
    },
    async open(id) {
      const held = servedFile(id);
      if (held === null) return null;
      let handle: FileHandle;
      try {
        handle = await open(held.path, "r");
      } catch (error) {
        if (isGone(error)) forget(id);
        return null;
      }
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) {
          await handle.close();
          return null;
        }
        return { file: held, size: stats.size, stream: handle.createReadStream() };
      } catch {
        await handle.close().catch(() => {});
        return null;
      }
    },
    linkFor(file) {
      const id = byPath.get(file);
      const held = id === undefined ? undefined : byId.get(id);
      return id === undefined || held === undefined ? null : linkOf(id, held);
    },
    clear() {
      byId.clear();
      byPath.clear();
      pending.clear();
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What one retention pass did: files deleted, session folders removed, operations that failed, and
 * session folders skipped whole because their real path sits outside the root.
 */
export type RetentionCounts = { deleted: number; removed: number; failed: number; skipped: number };

/**
 * Deletes every saved file under `<root>/<session>/` whose modified time is more than `retainDays`
 * before `now`, then removes each session folder the pass left empty. It resolves on every path.
 *
 * Each entry is classified with `lstat` before it is acted on: only a regular file is deleted and
 * only a real directory is entered. A session folder is entered only where its real path is the
 * root's real path joined to its name, which skips a junction `lstat` reports as a plain directory,
 * one whose target is written in the volume form; such a folder is neither read nor removed and is
 * counted as skipped. A folder swapped for a link between that check and its listing, or a root
 * that is itself a link, is followed. In the installer's default layout the folder sits in the
 * hardened state root, so only code running as the operator can plant either. A folder is removed
 * with `rmdir`, which refuses one that still holds anything. An entry of any other kind, at the
 * root or inside a session folder, the claim's marker among them, is left alone. One failure is
 * counted and the pass continues, and the counts are all the caller gets, so no name or path can
 * reach a log.
 */
export async function pruneAttachments(root: string, retainDays: number, now: number): Promise<RetentionCounts> {
  const counts: RetentionCounts = { deleted: 0, removed: 0, failed: 0, skipped: 0 };
  const cutoff = now - retainDays * DAY_MS;
  let sessions: string[];
  try {
    sessions = await readdir(root);
  } catch (error) {
    // An absent store is nothing to prune. Any other failure to list the root is one failure.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") counts.failed += 1;
    return counts;
  }
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    // A root the pass cannot resolve is a root it cannot list, so it is one failure too.
    counts.failed += 1;
    return counts;
  }
  for (const session of sessions) {
    const folder = path.join(root, session);
    try {
      if (!(await lstat(folder)).isDirectory()) continue;
    } catch {
      counts.failed += 1;
      continue;
    }
    if (!(await realPathIs(folder, path.join(realRoot, session)))) {
      counts.skipped += 1;
      continue;
    }
    try {
      for (const name of await readdir(folder)) {
        const file = path.join(folder, name);
        try {
          const info = await lstat(file);
          if (!info.isFile() || info.mtimeMs >= cutoff) continue;
          await unlink(file);
          counts.deleted += 1;
        } catch {
          counts.failed += 1;
        }
      }
    } catch {
      counts.failed += 1;
      continue;
    }
    try {
      await rmdir(folder);
      counts.removed += 1;
    } catch (error) {
      // A folder that still holds a file is the expected refusal. Anything else is a failure.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" && code !== "EEXIST") counts.failed += 1;
    }
  }
  return counts;
}
