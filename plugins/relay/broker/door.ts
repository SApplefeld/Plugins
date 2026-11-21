// The local door: three loopback routes a program on the broker's own host uses to read the talk
// ring and to hand a session a line a named person wrote. They sit on the loopback listener between
// the relay routes and the hook intake, and exist only while a door key is loaded.
//
//   Every request carries the header X-Channels-Door: the door key file's contents.
//
//   GET /door/lineages
//     -> 200 {"ringStart": "<ISO time>", "lineages": [{"lineage": "...", "live": true, "newestSeq": 12}]}
//        One entry for each distinct lineage a registry record carries, in any state. `live` is
//        whether a session not yet ended carries it, and `newestSeq` the ring's newest sequence
//        number for it, 0 where the ring holds none.
//
//   GET /door/lines?lineage=<l>&since=<n>&limit=<m>
//     -> 200 {"ringStart": "...", "lineage": "...", "newestSeq": 12, "missed": 0, "lines": [...]}
//        The ring's lines whose sequence number is greater than `since`, oldest first, and at most
//        `limit` of them, the oldest kept, so a caller pages forward. `since` is digits and 0 when
//        absent; `limit` is 1 to the ring's capacity and the capacity when absent. `missed` is how
//        many sequence numbers after `since` the ring no longer holds. A line is
//        {"seq", "at", "kind", "author", "senderClass", "text", "door"}, its text whole, and `door`
//        is true for a line this door handed in. No line carries a file.
//     -> 400 on a missing or empty lineage or a malformed since or limit
//     -> 404 on a lineage no registry record carries
//
//   POST /door/line
//     Content-Type: application/json
//     body: {"lineage": "...", "name": "...", "text": "...", "lineId": "..."}, at most 64 KiB
//     -> 200 {"status": "delivered" | "no-session" | "ended" | "no-thread" | "no-channel" | "rate" |
//        "empty", "truncated": false, "duplicate": false}, the status and the cut the inbound router
//        answered. A lineage no registry record carries is a good body and answers no-session, so
//        every delivery outcome is read from one field.
//     -> 400 on a body that is not a JSON object of that shape, 415 on another type
//     -> 413 on a declared Content-Length past 64 KiB, before the body is read, which a caller that
//        keeps its connection open reads; and on any other body past 64 KiB that ends within 256 KiB.
//        Past 256 KiB that body's connection is dropped with no answer.
//
//   On each of the three
//     -> 403 {"error": "loopback only"} where the peer or the Host header is not loopback
//     -> 401 {"error": "door key required"} where the header is missing or is not the key
//     -> 405 with an `allow` header on any other method, OPTIONS included
//
// `ringStart` changes only when the broker process starts again, and every sequence number starts
// over with it. A caller that reads a new value has lost its place; one that reads a `missed` above
// 0 has a gap the ring no longer holds.
//
// A line id is delivered once. A request repeating the id of a line still being delivered waits for
// that outcome, and one repeating a delivered id is answered with that outcome, each with
// `duplicate` true and nothing delivered. An outcome other than `delivered` is forgotten as it
// settles, so the line can be sent again, and a delivered id is forgotten after
// DOOR_LINE_MEMORY_MS. The memory is this process's alone and is never written to disk.
//
// The key is the door's whole defense, and it is a file any session under the broker's account can
// read. So every line handed in here is a participant's, by a literal in the inbound router's
// `deliverDoor`, and nothing a request carries can change that. No answer carries a CORS header,
// and no log line carries the key, the header's value or any part of a body.
//
// Both guards the hook intake applies are applied here too, ahead of the key: the socket peer must
// be loopback and the Host header must name a loopback name, which closes DNS rebinding. They are
// re-checked because these routes are composed in front of the intake's own checks.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAllowedHost, isLoopback, readCappedBody } from "./intake.ts";
import { liveByLineage } from "./registry.ts";
import type { SessionRecord } from "./registry.ts";
import { createRepeatLog } from "./repeat-log.ts";
import type { RepeatLogSurface } from "./repeat-log.ts";
import type { DoorDeliveryStatus } from "./routing/inbound.ts";
import { RING_CAPACITY } from "./web/talk.ts";
import type { HeldLine, TalkRing } from "./web/talk.ts";

/** How long a delivered line id is remembered, so a repeat of it delivers nothing. */
export const DOOR_LINE_MEMORY_MS = 10 * 60 * 1000;

/**
 * The largest line route body read. A body past it is refused unparsed: on its declared length
 * before any read, and otherwise by the read once it passes this.
 */
const MAX_LINE_BODY_BYTES = 64 * 1024;

/** The bounds on a line body's fields, in code points. */
const MAX_LINEAGE_LENGTH = 256;
const MAX_NAME_LENGTH = 100;

/** A line id: 1 to 64 letters, digits and hyphens. */
const LINE_ID = /^[A-Za-z0-9-]{1,64}$/;

/** How long a run of one refusal is counted before its next log line. */
const REFUSAL_WINDOW_MS = 60_000;

/**
 * The door's refusal log. A key is a route and a cause, both from fixed lists, so the key set is
 * closed and a flood of refused requests writes one line a window for each.
 */
const REFUSAL_LOG: RepeatLogSurface<[]> = {
  windowMs: REFUSAL_WINDOW_MS,
  firstLine: (refusal) => `door: refused a request to ${refusal}`,
  countLine: (refusal, suppressed) =>
    `door: refused ${String(suppressed)} more request(s) to ${refusal} in the last ` +
    `${String(REFUSAL_WINDOW_MS / 1000)} seconds`,
};

/** What a delivery answered: the inbound router's status and whether the text was cut. */
type DoorOutcome = { status: DoorDeliveryStatus; truncated: boolean };

export type DoorRoutesOptions = {
  /** The door key, as `readDoorKey` read it. A request must carry exactly this in X-Channels-Door. */
  key: string;
  /** The registry's records in every state, read at each request. */
  records: () => readonly SessionRecord[];
  /** The talk ring the reads answer from. Never written here: a delivered line reaches it by the inbound router's tap. */
  ring: Pick<TalkRing, "since" | "newestSeq" | "startedAt">;
  /** The inbound router's door delivery, or a stand-in answering `no-session` where no router exists. */
  deliverDoor: (lineage: string, name: string, text: string) => Promise<DoorOutcome>;
  log?: (message: string) => void;
  /** The clock the line id memory and the refusal log read, in milliseconds. */
  now?: () => number;
};

type DoorRoute = "/door/lineages" | "/door/lines" | "/door/line";

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    ...headers,
  });
  response.end(text);
}

/** A string of 1 to `max` code points. */
function bounded(value: unknown, max: number): value is string {
  if (typeof value !== "string" || value === "") return false;
  // No string of more UTF-16 units than twice the bound fits it, so the count below is bounded too.
  return value.length <= max * 2 && [...value].length <= max;
}

/** A line as the door shows it: the ring's line without its files, its receipt and its receipt key. */
function shown(line: HeldLine): Record<string, unknown> {
  return {
    seq: line.seq,
    at: line.at,
    kind: line.kind,
    author: line.author,
    senderClass: line.senderClass,
    text: line.text,
    door: line.door === true,
  };
}

/**
 * Returns a handler that reports whether it took the request, so the caller can fall through to the
 * hook intake for everything else. It takes a request whose path before any `?` is exactly one of
 * the three door paths, compared as the raw string with no decoding, and no other.
 */
export function createDoorRoutes(
  options: DoorRoutesOptions,
): (request: IncomingMessage, response: ServerResponse) => boolean {
  const log = options.log ?? ((): void => {});
  const now = options.now ?? Date.now;
  const expected = Buffer.from(options.key, "utf8");
  const refused = createRepeatLog(REFUSAL_LOG, log, now);
  // The outcome of each line id in play: one still being delivered, or one delivered and not yet
  // forgotten. `deliveredAt` is null until the delivery settles as delivered.
  const lineIds = new Map<string, { outcome: Promise<DoorOutcome>; deliveredAt: number | null }>();

  /** Answers a refusal and logs it by its route and cause, which is all the log line carries. */
  function refuse(
    response: ServerResponse,
    route: DoorRoute,
    status: number,
    cause: string,
    headers: Record<string, string> = {},
  ): void {
    refused(`${route}: ${cause}`);
    send(response, status, { error: cause }, headers);
  }

  /**
   * Whether the request's X-Channels-Door equals the key: one header value, equal length and equal
   * bytes, read in constant time so the comparison leaks nothing by its duration.
   */
  function keyMatches(header: string | string[] | undefined): boolean {
    if (typeof header !== "string") return false;
    const given = Buffer.from(header, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  function lineages(response: ServerResponse): void {
    const records = options.records();
    const named = new Set<string>();
    for (const record of records) {
      if (record.lineage !== null) named.add(record.lineage);
    }
    send(response, 200, {
      ringStart: options.ring.startedAt,
      lineages: [...named].map((lineage) => ({
        lineage,
        live: liveByLineage(records, lineage) !== null,
        newestSeq: options.ring.newestSeq(lineage),
      })),
    });
  }

  function lines(response: ServerResponse, query: URLSearchParams): void {
    const lineage = query.get("lineage");
    if (lineage === null || lineage === "") {
      refuse(response, "/door/lines", 400, "lineage is missing");
      return;
    }
    const sinceText = query.get("since");
    if (sinceText !== null && !/^\d+$/.test(sinceText)) {
      refuse(response, "/door/lines", 400, "since is not digits");
      return;
    }
    const since = sinceText === null ? 0 : Number(sinceText);
    const limitText = query.get("limit");
    const limit = limitText === null ? RING_CAPACITY : /^\d+$/.test(limitText) ? Number(limitText) : 0;
    if (limit < 1 || limit > RING_CAPACITY) {
      refuse(response, "/door/lines", 400, `limit is not 1 to ${String(RING_CAPACITY)}`);
      return;
    }
    if (!options.records().some((record) => record.lineage === lineage)) {
      refuse(response, "/door/lines", 404, "no session carries that lineage");
      return;
    }
    const newer = options.ring.since(lineage, since);
    send(response, 200, {
      ringStart: options.ring.startedAt,
      lineage,
      newestSeq: options.ring.newestSeq(lineage),
      // The sequence numbers between `since` and the oldest line still held are the ones dropped.
      missed: newer.length === 0 ? 0 : Math.max(0, newer[0].seq - since - 1),
      lines: newer.slice(0, limit).map(shown),
    });
  }

  async function line(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const type = request.headers["content-type"];
    if (typeof type !== "string" || type.split(";")[0].trim().toLowerCase() !== "application/json") {
      refuse(response, "/door/line", 415, "the body is not application/json");
      return;
    }
    // A declared length past the cap is refused before any read, so the answer goes out while the
    // caller is still sending. Node discards the unread body, and a caller that keeps its connection
    // open reads the 413 however large the body is. One that asked to close the connection is
    // closed on once the answer is sent, and can see a reset in its place.
    const declared = request.headers["content-length"];
    if (declared !== undefined && /^\d+$/.test(declared) && Number(declared) > MAX_LINE_BODY_BYTES) {
      refuse(response, "/door/line", 413, "body too large");
      return;
    }
    // Any other body is read through the hook intake's reader. Past the cap it drains and discards
    // up to its drain limit, so a caller whose body ends inside the limit reads the 413. Past the
    // limit the reader drops the connection, so there is no answer to write and the refusal is
    // only logged.
    const read = await readCappedBody(request, MAX_LINE_BODY_BYTES);
    if (!("body" in read)) {
      if (read.destroyed) refused("/door/line: body too large");
      else refuse(response, "/door/line", 413, "body too large");
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(read.body);
    } catch {
      refuse(response, "/door/line", 400, "body is not valid JSON");
      return;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      refuse(response, "/door/line", 400, "body is not a JSON object");
      return;
    }
    const { lineage, name, text, lineId } = payload as Record<string, unknown>;
    if (!bounded(lineage, MAX_LINEAGE_LENGTH)) {
      refuse(response, "/door/line", 400, `lineage is not 1 to ${String(MAX_LINEAGE_LENGTH)} characters`);
      return;
    }
    if (!bounded(name, MAX_NAME_LENGTH)) {
      refuse(response, "/door/line", 400, `name is not 1 to ${String(MAX_NAME_LENGTH)} characters`);
      return;
    }
    if (typeof text !== "string") {
      refuse(response, "/door/line", 400, "text is not a string");
      return;
    }
    if (typeof lineId !== "string" || !LINE_ID.test(lineId)) {
      refuse(response, "/door/line", 400, "lineId is not 1 to 64 letters, digits and hyphens");
      return;
    }

    // The sweep runs before the lookup, so an id repeated once its memory has run out is a new line.
    const at = now();
    for (const [id, held] of lineIds) {
      if (held.deliveredAt !== null && at - held.deliveredAt >= DOOR_LINE_MEMORY_MS) lineIds.delete(id);
    }
    const held = lineIds.get(lineId);
    if (held !== undefined) {
      // Answered with the first request's outcome, whatever this one's lineage, name and text.
      send(response, 200, { ...(await held.outcome), duplicate: true });
      return;
    }
    const entry: { outcome: Promise<DoorOutcome>; deliveredAt: number | null } = {
      deliveredAt: null,
      outcome: options.deliverDoor(lineage, name, text).then(
        (outcome) => {
          // Settled before any waiting request is answered: a delivered id is held from now, and
          // any other outcome frees the id for the caller to send the line again.
          if (outcome.status === "delivered") entry.deliveredAt = now();
          else lineIds.delete(lineId);
          return { status: outcome.status, truncated: outcome.truncated };
        },
        (error: unknown) => {
          lineIds.delete(lineId);
          throw error;
        },
      ),
    };
    lineIds.set(lineId, entry);
    send(response, 200, { ...(await entry.outcome), duplicate: false });
  }

  return (request, response) => {
    const url = request.url ?? "/";
    const mark = url.indexOf("?");
    const path = mark < 0 ? url : url.slice(0, mark);
    if (path !== "/door/lineages" && path !== "/door/lines" && path !== "/door/line") return false;
    const route: DoorRoute = path;

    if (!isLoopback(request.socket.remoteAddress) || !isAllowedHost(request.headers.host)) {
      refuse(response, route, 403, "loopback only");
      return true;
    }
    if (!keyMatches(request.headers["x-channels-door"])) {
      refuse(response, route, 401, "door key required");
      return true;
    }
    const allow = route === "/door/line" ? "POST" : "GET";
    if (request.method !== allow) {
      refuse(response, route, 405, "method not allowed", { allow });
      return true;
    }

    if (route === "/door/lineages") {
      lineages(response);
      return true;
    }
    if (route === "/door/lines") {
      lines(response, new URLSearchParams(mark < 0 ? "" : url.slice(mark + 1)));
      return true;
    }
    line(request, response).catch((error: unknown) => {
      // A response still open is answered, so a caller is not left waiting on a request that is
      // over. The log line names the error's kind and never its message, which nothing here
      // guarantees is free of the body.
      if (!response.headersSent && !response.destroyed) send(response, 500, { error: "the request failed" });
      log(`door: the /door/line route failed: ${error instanceof Error ? error.name : "a thrown value"}`);
    });
    return true;
  };
}
