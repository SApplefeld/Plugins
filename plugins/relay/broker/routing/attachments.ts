// The one path a file attached to a Discord message takes to reach a session: fetched from
// Discord's CDN, bounded, and either handed back as the words of a pasted message or written
// under the broker's state directory for the session to open with its own file-reading tool.
//
// This is the only code that fetches an attachment or writes one to disk, and nothing it reads out
// of the attachment is trusted. The name decides the kind and, reduced to a safe alphabet, is the
// one sender-chosen part of any path written here. The declared size is never consulted: the cap
// is enforced on the bytes as they stream, since the declared size is the sender's claim. The URL
// is fetched only when it names one of Discord's two CDN hosts over https with no port and no
// redirect, since the broker would otherwise fetch any address a message object named.
//
// Every per-file problem is a refusal with a cause from a closed list, and one file's failure never
// stops the others: the router posts each refusal to the thread under its file's reduced name, so
// nothing is dropped in silence. Nothing here logs, so no file name, URL or content can reach the
// log from this module; the router records counts and causes from what it is returned.
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
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
  /** The folder holding the broker's state file. Files are written under its `attachments` child. */
  stateDir: string;
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
 * Which kinds are taken in, by extension, compared without regard to letter case. The list is
 * closed: an extension absent from it is refused, whatever content type Discord reported. For a
 * text extension the content type is not consulted, since Discord derives it from the same
 * extension. For an image or a document the reported media type must also be the one named here,
 * so that a file wearing an image's extension over another kind of content is refused.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml", ".sql", ".cs", ".js", ".ts",
  ".py", ".ps1", ".sh", ".html", ".css",
]);
const TYPED_EXTENSIONS: ReadonlyMap<string, string> = new Map([
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
 * extension that would leave no room for a stem is cut with the rest, since no accepted kind has
 * one that long and the name still reaches a notice. A stem with nothing left, or with dots alone,
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
function withinLimit<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
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
async function readBounded(
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

/**
 * Writes one file whole: to a sibling temp file under a unique name, then renamed over the target,
 * so a write that fails leaves no partial file for a session to open. On a POSIX host the folder is
 * made for the owning user only and the file written the same way, as the registry snapshot is.
 * Windows ignores those modes, and there the state folder's own access list is what holds. Throws
 * on failure with no temp file left behind.
 */
async function writeWhole(file: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
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
  const root = attachmentsRoot(options.stateDir);
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
    if (!PATH_SEGMENT.test(sessionId) || !PATH_SEGMENT.test(messageId)) return null;
    const target = path.resolve(root, sessionId, `${messageId}-${String(position)}-${name}`);
    return target.startsWith(root + path.sep) ? target : null;
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
    sessionId: string,
    messageId: string,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const name = reducedName(attachment.name);
    const refused = (cause: RefusalCause): Outcome => ({ kind: "refused", refusal: { name, cause } });
    if (gate !== null) return refused(gate);
    if (position > MAX_ATTACHMENTS_PER_MESSAGE) return refused("count");
    if (!acceptedKind(name, attachment.contentType)) return refused("kind");
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
      // The first attachment that is the paste, and only that one: a second `message.txt` is an
      // ordinary text file, saved whole like any other.
      const pasteAt = attachments.findIndex(isPaste);
      // One timer for the whole message: every file is fetched together under it, and a file
      // unfinished when it fires is refused as one that could not be brought down.
      const signal = AbortSignal.timeout(limitMs);
      const outcomes = await Promise.all(
        attachments.map((attachment, index) =>
          takeOne(attachment, index + 1, index === pasteAt, gate, sessionId, messageId, signal),
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

/** The folder every saved attachment lives under, one folder per session, inside the state directory. */
export function attachmentsRoot(stateDir: string): string {
  return path.resolve(stateDir, "attachments");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one retention pass did: files deleted, session folders removed, and operations that failed. */
export type RetentionCounts = { deleted: number; removed: number; failed: number };

/**
 * Deletes every saved file under `<root>/<session>/` whose modified time is more than `retainDays`
 * before `now`, then removes each session folder the pass left empty. It resolves on every path.
 *
 * Each entry is classified with `lstat` before it is acted on: only a regular file is deleted and
 * only a real directory is entered. A folder swapped for a link between that check and its listing,
 * or a root that is itself a link, is followed. In the default layout the folder sits in the
 * hardened state root, so only code running as the operator can plant either. A folder is removed
 * with `rmdir`, which refuses one that still holds anything. An entry of any other kind, at the
 * root or inside a session folder, is left alone. One failure is counted and the
 * pass continues, and the counts are all the caller gets, so no name or path can reach a log.
 */
export async function pruneAttachments(root: string, retainDays: number, now: number): Promise<RetentionCounts> {
  const counts: RetentionCounts = { deleted: 0, removed: 0, failed: 0 };
  const cutoff = now - retainDays * DAY_MS;
  let sessions: string[];
  try {
    sessions = await readdir(root);
  } catch (error) {
    // An absent store is nothing to prune. Any other failure to list the root is one failure.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") counts.failed += 1;
    return counts;
  }
  for (const session of sessions) {
    const folder = path.join(root, session);
    try {
      if (!(await lstat(folder)).isDirectory()) continue;
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
