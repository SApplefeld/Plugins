// The spooled announcement: a SessionStart the hook could not deliver, left on disk for the broker
// to take in once the session's relay pipe proves the session alive.
//
// hooks/session-start.ps1 posts a session's identity to /hook at startup and, by design, retries
// nothing but a timeout. While the broker is down every attempt is refused, and nothing re-sends
// the announcement later: the relay never learns its session id, and a session is created from a
// SessionStart alone. So the hook, the one process holding every field of the announcement, writes
// it to `announce\<hash>.announce` under the state root, where <hash> is the SHA-256 hex of the
// process token's UTF-8 bytes. The broker reads that file at the moment the relay hub tells it a
// pipe attached under a token with no current record, which is the moment it learns a live session
// holds that token and the moment a late announcement can still bind the session to its thread.
//
// The file is untrusted input on the surface docs/security-model.md guards most closely, since any
// local process able to write the state root can write it, so it is read as the route reads a
// post: under the route's own byte cap, through the route's own parse (intake.ts, with the token
// supplied from the pipe and never from the file), and applied through registry.apply with the
// route's own refusals. An accepted spool teaches the tailer and the status reader its transcript
// path through the route's own helper. It is not a second route for creating a session; it is the
// same announcement, late. The file is deleted whatever the outcome, and a token already holding a
// record has its spool deleted unread. A delete that fails is logged and leaves the file, which the
// next take-in under the token reads again, or deletes unread once the token holds a record, so a
// session is never registered twice from one file. No byte of the token
// reaches the log on any path. A malformed file is named by its fault class alone. A parsed spool
// logs the route's own lines, carrying the session id and name as the route logs them.
//
// No sweep: the token is a fresh GUID every launch, so a spool whose pipe never attaches is litter
// under a hardened folder and never a replay.
import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { readCappedBytes } from "./capped-read.ts";
import { applyIntake, createRefusalLog, learnTranscript, parseIntakeHeaders } from "./intake.ts";
import type { TranscriptSeams } from "./intake.ts";
import type { Logger } from "./log.ts";
import type { Registry } from "./registry.ts";

/** The folder under the state root, the same name the hook writes to. */
export const ANNOUNCE_FOLDER = "announce";

/**
 * Room the read allows for the header block over the body cap. It matches the most header bytes
 * the route's request can carry (node's default of 16 KiB), so a block past it could not have
 * been posted either.
 */
export const HEADER_BLOCK_BYTES = 16 * 1024;

/** The three header lines the hook writes, the only ones a spool may hold. The token never rides in the file. */
const SPOOL_HEADERS: readonly string[] = ["x-channel-hook-event", "x-channel-session-name", "x-channel-lineage"];

/** The hash the hook names the file by: lowercase hex of SHA-256 over the token's UTF-8 bytes. */
export function spoolName(processToken: string): string {
  return `${createHash("sha256").update(processToken, "utf8").digest("hex")}.announce`;
}

/** Why a spool's bytes were refused before they reached the parse. Each is a static sentence, never content. */
export type SpoolFault =
  | "no empty line ends the header block"
  | "a header line is not one of the three"
  | "a header line is repeated"
  | "the body is over the cap";

/**
 * Splits a spool's bytes into its header lines and its body, on the hook's own shape: header lines
 * ending in a line feed, one empty line, then the body verbatim. A header line is `Name: value`
 * with the name one of the three, each at most once; the token's header is not one of the three,
 * so a token line in the file refuses it. The block is decoded as latin1, which is how node reads
 * header bytes off the wire, and the body as UTF-8, which is how the route reads a body, so the
 * parse downstream sees what the wire would have carried. A body over the cap is refused here, as
 * the route drains one unread.
 */
export function splitSpool(
  bytes: Buffer,
  maxBodyBytes: number,
): { headers: Map<string, string>; body: string } | { fault: SpoolFault } {
  const boundary = bytes.indexOf("\n\n");
  if (boundary === -1) return { fault: "no empty line ends the header block" };
  const headers = new Map<string, string>();
  for (const line of bytes.toString("latin1", 0, boundary).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) return { fault: "a header line is not one of the three" };
    const name = line.slice(0, colon).toLowerCase();
    if (!SPOOL_HEADERS.includes(name)) return { fault: "a header line is not one of the three" };
    if (headers.has(name)) return { fault: "a header line is repeated" };
    headers.set(name, line.slice(colon + 1));
  }
  const body = bytes.subarray(boundary + 2);
  if (body.length > maxBodyBytes) return { fault: "the body is over the cap" };
  return { headers, body: body.toString("utf8") };
}

export type AnnounceSpoolOptions = {
  /** The registry's state file; the folder sits beside it, where the hook writes. */
  stateFile: string;
  registry: Registry;
  /** The body cap the /hook route enforces, so a spool is read under exactly that ceiling. */
  maxBodyBytes: number;
  /** Where the take-in's lines go. Optional on the terms the route's logger is. */
  log?: Logger;
  /** Injected so a test drives the refusal limiter's window without sleeping. */
  now?: () => number;
  /** The tailer's learn seam, wired as the /hook route's is. Optional on the terms the route's is. */
  tail?: TranscriptSeams["tail"];
  /** The status reader's learn seam, wired as the /hook route's is. Optional on the terms the route's is. */
  status?: TranscriptSeams["status"];
};

export type AnnounceSpool = {
  /** The folder read, named in the start log so a state root the hook does not share is visible. */
  folder: string;
  /**
   * Reads, applies and deletes the spool for a token, where the token has no current record. Told
   * from the relay hub's attach, with the token from the pipe. Never throws: the attach it rides on
   * is not this file's to undo.
   */
  takeIn: (processToken: string) => void;
  /** Deletes the spool for a token unread. Told of every SessionStart the route accepts. */
  discard: (processToken: string) => void;
};

export function createAnnounceSpool(options: AnnounceSpoolOptions): AnnounceSpool {
  const folder = path.join(path.dirname(options.stateFile), ANNOUNCE_FOLDER);
  const log = options.log;
  const refusals = createRefusalLog(log, options.now ?? Date.now);

  function fileFor(processToken: string): string {
    return path.join(folder, spoolName(processToken));
  }

  /**
   * Deletes a spool, and says so where the delete failed on a file that exists: a spool that
   * cannot be deleted is one that would be read again at the next attach. The error's own text is
   * withheld, since it carries the path.
   */
  function remove(file: string): void {
    try {
      unlinkSync(file);
    } catch (error) {
      const code = (error as { code?: unknown } | null | undefined)?.code;
      if (code === "ENOENT") return;
      log?.warn(`relay: a spooled announcement could not be deleted (${typeof code === "string" ? code : "unknown"})`);
    }
  }

  function refuse(fault: string): void {
    // Through the logger directly rather than the limiter: one line per file, since one attach
    // reads at most one file and the attaches themselves are bounded by the hub's ceiling.
    log?.warn(`relay: a spooled announcement was refused and deleted: ${fault}`);
  }

  function takeIn(processToken: string): void {
    const file = fileFor(processToken);
    try {
      // A token holding a record has its session already: a spool under it is an earlier
      // announcement the live one superseded, deleted without a read. The record a sweep marked
      // stale is still the token's, so it counts here as the hub's own unannounced check counts it.
      if (options.registry.current(processToken) !== null) {
        remove(file);
        return;
      }
      // No spool is the ordinary attach, the one every announced session's pipe makes, and it
      // writes nothing.
      if (!existsSync(file)) return;
      // One byte past the body cap plus the header room, so a file that reached the limit is
      // refused whole rather than read as the prefix that fit, which is the route's own posture
      // toward an over-cap post. Deleted before anything is made of the bytes, so every outcome
      // below, a throw included, leaves no file to read twice unless the delete itself failed.
      const read = readCappedBytes(file, options.maxBodyBytes + HEADER_BLOCK_BYTES);
      remove(file);
      if ("failed" in read) {
        refuse(read.failed === "oversized" ? "the read reached the size limit" : "the file could not be read");
        return;
      }
      const split = splitSpool(read.bytes, options.maxBodyBytes);
      if ("fault" in split) {
        refuse(split.fault);
        return;
      }
      // The route's own parse, with the token from the pipe. The file's lines answer the other
      // names, and only the three the split admitted are there to answer.
      const parsed = parseIntakeHeaders(
        (name) => (name === "x-channel-process-token" ? processToken : split.headers.get(name)),
        split.body,
      );
      if ("unwatched" in parsed) {
        // Unreachable with the token supplied above; named rather than fallen through, so a
        // change to the parse that drops the token reads as a refusal here and never as a record.
        refuse("the parse found no process token");
        return;
      }
      if ("failure" in parsed) {
        refuse(parsed.failure.message);
        return;
      }
      if (parsed.intake.event !== "SessionStart") {
        refuse("the hook event is not SessionStart");
        return;
      }
      const record = applyIntake(options.registry, parsed.intake, refusals);
      if (record === null) return;
      learnTranscript(options, record.sessionId, parsed.intake.transcriptPath);
      log?.info(
        `relay: session ${record.sessionId} announced from the SessionStart its hook spooled while the broker was down`,
      );
    } catch (error) {
      // The attach this rides on is up whatever happened here. The error's text is withheld: a
      // throw out of a parse can quote the bytes that produced it.
      refuse(`the take-in failed (${(error as { code?: unknown } | null | undefined)?.code ?? "no code"})`);
      remove(file);
    }
  }

  return {
    folder,
    takeIn,
    discard: (processToken) => remove(fileFor(processToken)),
  };
}
