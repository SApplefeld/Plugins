// The local door: loopback routes a program on the broker's own host uses to read the talk ring, to
// hand a session a line a named person wrote and, on a host that gives the door operator standing,
// to read what a session waits on and settle it, to read a persona's open asks and answer one, and
// to read a session's status. They sit on the loopback listener between the relay routes and the
// hook intake, and exist only while a door key is loaded. Three are served at either standing and
// five more at operator standing alone, eight in all.
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
//        {"seq", "at", "kind", "author", "senderClass", "text", "door", "mentions"}, its text
//        whole, and `door` is true for a line this door handed in. `mentions` is the list of names a
//        reply asked to mention, in plain text, each once, at most 10 of at most 100 code points,
//        and empty on every other line. The door matches no name to anyone: its reader does. No
//        line carries a file.
//     -> 400 on a missing or empty lineage or a malformed since or limit
//     -> 404 on a lineage no registry record carries
//
//   POST /door/line
//     Content-Type: application/json
//     body: {"lineage": "...", "name": "...", "text": "...", "lineId": "..."}, at most 64 KiB
//     -> 200 {"status": "delivered" | "no-session" | "ended" | "no-thread" | "no-channel" | "rate" |
//        "empty" | "board-act", "truncated": false, "duplicate": false}, the status and the cut the
//        inbound router answered. A lineage no registry record carries is a good body and answers
//        no-session, so every delivery outcome is read from one field. board-act is a line refused
//        on a host whose door runs at operator standing because its text, trimmed, opens with
//        [PAUSE] or [RESUME]: a session reads such an operator's line as a workers-board act, and
//        the door carries none. Nothing was delivered, and the same text is refused again.
//     -> 400 on a body that is not a JSON object of that shape, 415 on another type
//     -> 413 on a declared Content-Length past 64 KiB, before the body is read, which a caller that
//        keeps its connection open reads; and on any other body past 64 KiB that ends within 256 KiB.
//        Past 256 KiB that body's connection is dropped with no answer.
//
//   The five below are served only on a host whose door runs at operator standing. On any other
//   host a request to one is not the door's, and gets the answer any unknown path on the loopback
//   listener gets.
//
//   GET /door/pending?lineage=<l>
//     -> 200 {"lineage": "...", "live": true, "questions": [...], "permissions": [...],
//        "asks": [...]}
//        What the lineage's live session waits on, as the talk page's view carries it, and the open
//        asks of the persona the lineage names. `live` is whether a session not yet ended carries
//        the lineage, and `questions` and `permissions` are empty where none does. A question is
//        {"entryId", "answerable", "alerted", "questions": [{"header", "question", "multiSelect",
//        "options": [{"index", "label", "description", "chosen"}]}]}. A
//        typed answer is taken only once `alerted` is true. `answerable` is the rule for the
//        thread's picker and does not bound a typed answer. A permission is {"requestId",
//        "toolName", "description", "inputPreview", "nonce", "at"}, a tool call waiting on a
//        verdict, and its nonce is the one a verdict must carry. `asks` is the open asks of the
//        roster persona whose name is exactly the lineage, less each one a handled mark hides
//        until its persona raises it again. It is listed with or without a live session, since an
//        ask outlives the session that filed it, and is empty on a host with no roster. An ask is
//        {"id", "title", "question", "recommend", "blocking", "openedAt", "reraisedAt", "brief"}:
//        `question` is the text the operator's page draws for the ask, each time is an ISO 8601
//        string or null, and `title`, `recommend` and `brief` are null where the ask has none.
//     -> 400 on a missing or empty lineage
//     -> 404 on a lineage no registry record carries
//
//   GET /door/status?lineage=<l>
//     -> 200 {"lineage": "...", "live": true, "state": "working", "model": "..." | null,
//        "lastActivityAt": "<ISO time>" | null, "goal": "..." | null}
//        These six keys and no other. `live` is whether a session not yet ended carries the
//        lineage. Where none does, `state` is `exited` and the other three are null. Where one
//        does, `state` is `working`, `needs you`, `blocked`, `idle` or `exited`, derived as the web
//        page derives it, so a live session silent past its thresholds reads `idle` or `exited`.
//        `lastActivityAt` is the time of the session's latest hook event. `model` is the model
//        running now and `goal` the goal the session works on, each in plain text: the invisible
//        class stripped and each line break made one space, then cut with an ellipsis to 64 and
//        300 UTF-16 units. Each is null where the session has none or the screen leaves nothing,
//        and `goal` is null in `idle` and `exited` too, since a goal the session has met would read
//        as current.
//     -> 400 on a missing or empty lineage
//     -> 404 on a lineage no registry record carries
//
//   POST /door/answer
//     Content-Type: application/json
//     body: {"lineage": "...", "name": "...", "text": "...", "entryId": "..."}, at most 64 KiB;
//     entryId is optional and names the entry GET /door/pending showed
//     -> 200 {"status": "answered" | "no-question" | "no-session" | "ended" | "no-thread" | "empty" |
//        "too-long"}. answered is the held question took the text as its typed answer. no-question
//        is no question is held, the held one's alert has not landed, or the held entry is not the
//        one entryId names, and nothing was answered. too-long is a text past the inbound ceiling,
//        which is never an answer, since a cut one would put unfinished words into a session. A
//        second answer naming one entry reads no-question. An answer with no entryId goes to
//        whichever entry is held when it arrives.
//     -> 400, 413 and 415 as POST /door/line answers them
//
//   POST /door/permission
//     Content-Type: application/json
//     body: {"lineage": "...", "name": "...", "requestId": "...", "behavior": "allow" | "deny",
//     "nonce": "..."}, at most 64 KiB
//     -> 200 {"status": "resolved" | "closed" | "no-session" | "ended" | "no-thread"}. resolved is
//        the verdict was applied to the request. closed is the session's thread holds no open
//        request of that id under that nonce, and nothing was applied. A second verdict on one
//        request reads closed.
//     -> 400 on a body that is not a JSON object of that shape: a requestId that is not five letters
//        of a to z without l, a behavior outside allow and deny, and a nonce that is missing or is
//        not 1 to 64 lowercase hex digits. The nonce is never optional.
//     -> 413 and 415 as POST /door/line answers them
//
//   POST /door/ask
//     Content-Type: application/json
//     body: {"lineage": "...", "name": "...", "askId": "...", "action": "agree" | "answer",
//     "question": "...", "openedAt": "..." | null, "reraisedAt": "..." | null,
//     "recommend": "..." | null, "words": "..."}, at most 64 KiB
//     One answer to one open ask of the persona the lineage names: agreement with the ask's
//     recommendation, or an answer in words. `question`, `openedAt`, `reraisedAt` and `recommend`
//     are the ask's fields as GET /door/pending listed them, sent back so the answer is held to
//     the ask its sender read. `words` is read on an `answer` alone.
//     -> 200 {"status": "..."}, the first of these that holds:
//        empty: an answer whose words hold nothing but whitespace and invisible characters, as
//        isBlankText in broker/sanitize.ts reads them.
//        too-long: an answer whose words pass 3,500 code points. A longer line would be cut, and
//        a cut one would put unfinished words into a session.
//        closed: no registry record carries the lineage, or a reading of the ask ledgers taken
//        for this request, never a reused one, holds no open ask of that id for the roster
//        persona the lineage names. Where a persona's ledger file cannot be read then, the last
//        good reading of it is the one judged.
//        already-acted: a line for this version of the ask was delivered, through the door or on
//        the operator's page, or is being delivered now. A delivered line whose handled mark could
//        not be written leaves the ask open to a repeat, as on the page.
//        no-recommendation: an agree to an ask that recommends nothing.
//        changed: the four fields are not the ask's, byte for byte. A missing or mistyped one
//        reads so too, and is no malformed body.
//        delivered | no-session | ended | no-thread | no-channel | rate: what the inbound router
//        answered for the line, as POST /door/line answers it, and any other status of the
//        router's as it is.
//        Only delivered hands the session a line, and only it records the ask as handled, so GET
//        /door/pending and the operator's page stop listing the ask until its persona raises it
//        again. An agreement reads `Agree: proceed on your recommendation on ask "<id>",
//        "<recommendation>". Decided <YYYY-MM-DD HH:mm> from the portal.` and an answer in words
//        `Answer on ask "<id>", "<question>": <words>`.
//     -> 400 on a body that is not a JSON object of that shape: an askId that is not 1 to 1,000
//        code points, an action outside agree and answer, and an answer whose words is no string
//     -> 413 and 415 as POST /door/line answers them
//
//   On each of the eight
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
// DOOR_LINE_MEMORY_MS. The memory is this process's alone and is never written to disk. An answer
// and a verdict carry no id: the desk that takes one holds nothing for a second. An answer to an
// ask carries none either: the ask version is its key, and a repeat reads already-acted.
//
// The key is the door's whole defense, and it is a file any session under the broker's account can
// read. What a holder of the key can do is the standing the host gives the door, its
// CHANNEL_DOOR_STANDING setting, and nothing a request carries can change that. With the setting
// unset or `participant`, every line handed in here is a participant's and the door settles
// nothing. At `operator`, every line is the operator's, and the door answers a held question,
// allows or denies a waiting tool call and answers an open ask in whatever name the caller sends,
// so a session on that host can do each of those, its own tool calls and its own asks included,
// and the control is the boundary around the host. The inbound router decides the class, in one
// function, and refuses an answer and a verdict at any other standing. At either standing the door
// takes no other act: no workers-board act, no broker restart, no voice command, no pick or submit
// of a question's options and no hand-back of a question to its session. Of the page's item acts it
// takes one, at operator standing: an answer to an open ask, which is the page's Agree or its
// Answer. It takes no Dismiss, no Agree to several asks at once, no Steer, no Rollout and no
// Publish. A line, an answer, a verdict and an answer to an ask each leave a copy in the session's
// thread and a line in the talk ring under `<name> (portal)`, which shows that the act came through
// the door and never who took it.
//
// No answer carries a CORS header, and no door log line carries the key, the header's value or any
// part of a body but these: the line for a verdict names `allow` or `deny`, and the line for an
// answer to an ask names `agree` or `answer`. That line also names the ask's id and the persona's
// name, each as the broker's own reading holds it and written as JSON, never a string of the body
// that matched nothing: `door agree: ask <id> for <persona>: <status>`, or `door answer: ...`. It
// is written through the ask checks for a request that found an open ask, and one that found none
// writes no line. The permission desk's own line for a settled verdict names the request id, as it
// does for a verdict from the page. An answer or a verdict that names a live session is logged as
// one line naming the path, the session, the act and the status.
//
// Both guards the hook intake applies are applied here too, ahead of the key: the socket peer must
// be loopback and the Host header must name a loopback name, which closes DNS rebinding. They are
// re-checked because these routes are composed in front of the intake's own checks.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AskEntry } from "./decisions/ledger.ts";
import { MAX_MODEL_NAME_LENGTH, plainLineField } from "./discord/render.ts";
import { deriveSurfaceState, toView } from "./discord/state.ts";
import type { StateThresholds, ViewSignals } from "./discord/state.ts";
import type { DoorAsk } from "./door-asks.ts";
import { isAllowedHost, isLoopback, readCappedBody } from "./intake.ts";
import type { QuestionEntryView } from "./question-desk.ts";
import { liveByLineage } from "./registry.ts";
import type { SessionRecord } from "./registry.ts";
import { createRepeatLog } from "./repeat-log.ts";
import type { RepeatLogSurface } from "./repeat-log.ts";
import type { DoorAnswerStatus, DoorDeliveryStatus, DoorVerdictStatus } from "./routing/inbound.ts";
import { fit, isBlankText } from "./sanitize.ts";
import type { PendingPermission, Verdict } from "./security/permission.ts";
import {
  MAX_ASK_ID_LENGTH,
  MAX_DOOR_ANSWER_WORDS_LENGTH,
  doorAgreeLine,
  doorAnswerLine,
  drawnOf,
  drawnRecommendOf,
} from "./web/ask-act.ts";
import type { AskActs } from "./web/ask-act.ts";
import { RING_CAPACITY, viewPermission, viewQuestion } from "./web/talk.ts";
import type { HeldLine, TalkRing } from "./web/talk.ts";

/** How long a delivered line id is remembered, so a repeat of it delivers nothing. */
export const DOOR_LINE_MEMORY_MS = 10 * 60 * 1000;

/**
 * The largest body a door post reads. A body past it is refused unparsed: on its declared length
 * before any read, and otherwise by the read once it passes this.
 */
const MAX_LINE_BODY_BYTES = 64 * 1024;

/** The bounds on a post body's lineage and name, in code points. */
const MAX_LINEAGE_LENGTH = 256;
const MAX_NAME_LENGTH = 100;

/** The bound on the goal a status read answers, in UTF-16 units, the cut marker included. */
const MAX_STATUS_GOAL_LENGTH = 300;

/** A line id: 1 to 64 letters, digits and hyphens. */
const LINE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * A permission request's id and its prompt's nonce, the two shapes the page's `POST
 * /web/permission` checks a verdict by: five letters of the alphabet Claude Code builds an id from,
 * which has no `l`, and hex that is never empty, so a verdict always names a nonce.
 */
const PERMISSION_REQUEST_ID = /^[a-km-z]{5}$/;
const PERMISSION_NONCE = /^[0-9a-f]{1,64}$/;

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
  /**
   * What a session waits on: the question desk's held entries and the permission desk's open
   * requests for it. Present only on a host whose door runs at operator standing, and
   * `/door/pending` is served only where it is.
   */
  pending?: (sessionId: string) => {
    questions: readonly QuestionEntryView[];
    permissions: readonly PendingPermission[];
  };
  /**
   * The open asks of the roster persona a lineage names, as the door's own reading lists them.
   * Present only on a host whose door runs at operator standing. `/door/pending` answers them
   * under `asks`, and an empty list where this is absent.
   */
  asks?: (lineage: string) => readonly DoorAsk[];
  /**
   * The inbound router's door answer, or a stand-in answering `no-session` where no router exists.
   * Present only on a host whose door runs at operator standing, and `/door/answer` is served only
   * where it is.
   */
  answerDoor?: (lineage: string, name: string, text: string, entryId?: string) => Promise<DoorAnswerStatus>;
  /**
   * The inbound router's door verdict, or a stand-in answering `no-session` where no router exists.
   * Present only on a host whose door runs at operator standing, and `/door/permission` is served
   * only where it is.
   */
  settleDoor?: (lineage: string, name: string, verdict: Verdict, nonce: string) => Promise<DoorVerdictStatus>;
  /**
   * What an answer to an open ask is judged by and handed in through. `openAsk` is the door's own
   * reading: the open ask of that id of the roster persona a lineage names, from a reading taken
   * for the call and never a reused one, or null; where a ledger file cannot be read, its last
   * good reading is the one searched. `askAct` is the one copy of the ask checks, over the acted
   * set and the handled marks the operator's page shares. Present only on a host whose door runs
   * at operator standing, and `/door/ask` is served only where it is.
   */
  askDoor?: {
    openAsk: (lineage: string, askId: string) => Readonly<AskEntry> | null;
    askAct: AskActs["askAct"];
  };
  /**
   * What a live session's state is derived by: the two signals no record carries, and the
   * thresholds of the web pass, both as the web pass reads them for the same record. Present only
   * on a host whose door runs at operator standing, and `/door/status` is served only where it is.
   */
  status?: (record: SessionRecord) => { signals: Required<ViewSignals>; thresholds: StateThresholds };
  log?: (message: string) => void;
  /** The clock the line id memory, the refusal log and the status read's state read, in milliseconds. */
  now?: () => number;
};

type DoorRoute =
  | "/door/lineages"
  | "/door/lines"
  | "/door/line"
  | "/door/pending"
  | "/door/status"
  | "/door/answer"
  | "/door/permission"
  | "/door/ask";

/** The one method each route takes. */
const ROUTE_METHOD: Readonly<Record<DoorRoute, "GET" | "POST">> = {
  "/door/lineages": "GET",
  "/door/lines": "GET",
  "/door/line": "POST",
  "/door/pending": "GET",
  "/door/status": "GET",
  "/door/answer": "POST",
  "/door/permission": "POST",
  "/door/ask": "POST",
};

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

/**
 * A line as the door shows it: the ring's line without its files, its receipt and its receipt key.
 * The names a reply mentions pass as the ring holds them, since the door's reader matches them.
 */
function shown(line: HeldLine): Record<string, unknown> {
  return {
    seq: line.seq,
    at: line.at,
    kind: line.kind,
    author: line.author,
    senderClass: line.senderClass,
    text: line.text,
    door: line.door === true,
    mentions: line.mentions,
  };
}

/**
 * A record's text field as the status read answers it: screened as a plain line field and cut to
 * `limit` UTF-16 units, or null where the record holds none or the screen leaves nothing, as the
 * status card draws no goal that screens to nothing.
 */
function plainOrNull(value: string | null, limit: number): string | null {
  const plain = value === null ? "" : plainLineField(value);
  return plain === "" ? null : fit(plain, limit);
}

/**
 * Returns a handler that reports whether it took the request, so the caller can fall through to the
 * hook intake for everything else. It takes a request whose path before any `?` is exactly one of
 * the door paths it serves, compared as the raw string with no decoding, and no other: the three
 * every door serves, and each of `/door/pending`, `/door/status`, `/door/answer`,
 * `/door/permission` and `/door/ask` whose callback the options hold.
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

  function pending(
    response: ServerResponse,
    query: URLSearchParams,
    waitingOn: NonNullable<DoorRoutesOptions["pending"]>,
  ): void {
    const lineage = query.get("lineage");
    if (lineage === null || lineage === "") {
      refuse(response, "/door/pending", 400, "lineage is missing");
      return;
    }
    const records = options.records();
    if (!records.some((record) => record.lineage === lineage)) {
      refuse(response, "/door/pending", 404, "no session carries that lineage");
      return;
    }
    // The two lists the talk page's view carries for the same session, built by the view's own two
    // functions, so the door and the page cannot show one desk two ways. No desk is read where no
    // session is live.
    const live = liveByLineage(records, lineage);
    const held = live === null ? { questions: [], permissions: [] } : waitingOn(live.sessionId);
    send(response, 200, {
      lineage,
      live: live !== null,
      questions: held.questions.map(viewQuestion),
      permissions: held.permissions.map(viewPermission),
      // Listed with or without a live session, since an ask outlives the session that filed it.
      asks: options.asks === undefined ? [] : options.asks(lineage),
    });
  }

  function status(
    response: ServerResponse,
    query: URLSearchParams,
    statusOf: NonNullable<DoorRoutesOptions["status"]>,
  ): void {
    const lineage = query.get("lineage");
    if (lineage === null || lineage === "") {
      refuse(response, "/door/status", 400, "lineage is missing");
      return;
    }
    const records = options.records();
    if (!records.some((record) => record.lineage === lineage)) {
      refuse(response, "/door/status", 404, "no session carries that lineage");
      return;
    }
    // The six keys are composed here, field by field, so a field added to a session's record does
    // not reach the door unless it is named here.
    const live = liveByLineage(records, lineage);
    if (live === null) {
      send(response, 200, { lineage, live: false, state: "exited", model: null, lastActivityAt: null, goal: null });
      return;
    }
    const { signals, thresholds } = statusOf(live);
    const state = deriveSurfaceState(toView(live, signals), now(), thresholds);
    // The goal is hidden where the session is idle or exited, as the status card hides it: one that
    // has stopped working may have met its goal, which would then read as current.
    const stopped = state === "idle" || state === "exited";
    send(response, 200, {
      lineage,
      live: true,
      state,
      model: plainOrNull(live.model, MAX_MODEL_NAME_LENGTH),
      lastActivityAt: new Date(live.lastHookAt).toISOString(),
      goal: stopped ? null : plainOrNull(live.goal, MAX_STATUS_GOAL_LENGTH),
    });
  }

  /**
   * The JSON object a post's body holds, with the lineage and the name every door post carries, or
   * null where the request was refused, which is answered and logged here. The checks run in one
   * order on every post: the content type, the size, the JSON, the object, the lineage, the name.
   */
  async function posted(
    request: IncomingMessage,
    response: ServerResponse,
    route: DoorRoute,
  ): Promise<{ lineage: string; name: string; fields: Record<string, unknown> } | null> {
    const type = request.headers["content-type"];
    if (typeof type !== "string" || type.split(";")[0].trim().toLowerCase() !== "application/json") {
      refuse(response, route, 415, "the body is not application/json");
      return null;
    }
    // A declared length past the cap is refused before any read, so the answer goes out while the
    // caller is still sending. Node discards the unread body, and a caller that keeps its connection
    // open reads the 413 however large the body is. One that asked to close the connection is
    // closed on once the answer is sent, and can see a reset in its place.
    const declared = request.headers["content-length"];
    if (declared !== undefined && /^\d+$/.test(declared) && Number(declared) > MAX_LINE_BODY_BYTES) {
      refuse(response, route, 413, "body too large");
      return null;
    }
    // Any other body is read through the hook intake's reader. Past the cap it drains and discards
    // up to its drain limit, so a caller whose body ends inside the limit reads the 413. Past the
    // limit the reader drops the connection, so there is no answer to write and the refusal is
    // only logged.
    const read = await readCappedBody(request, MAX_LINE_BODY_BYTES);
    if (!("body" in read)) {
      if (read.destroyed) refused(`${route}: body too large`);
      else refuse(response, route, 413, "body too large");
      return null;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(read.body);
    } catch {
      refuse(response, route, 400, "body is not valid JSON");
      return null;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      refuse(response, route, 400, "body is not a JSON object");
      return null;
    }
    const fields = payload as Record<string, unknown>;
    const { lineage, name } = fields;
    if (!bounded(lineage, MAX_LINEAGE_LENGTH)) {
      refuse(response, route, 400, `lineage is not 1 to ${String(MAX_LINEAGE_LENGTH)} characters`);
      return null;
    }
    if (!bounded(name, MAX_NAME_LENGTH)) {
      refuse(response, route, 400, `name is not 1 to ${String(MAX_NAME_LENGTH)} characters`);
      return null;
    }
    return { lineage, name, fields };
  }

  async function line(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await posted(request, response, "/door/line");
    if (body === null) return;
    const { lineage, name } = body;
    const { text, lineId } = body.fields;
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

  /**
   * The id of the live session a post names, read ahead of the act, or null where the lineage has
   * none. It is what a post's log line names, and a post naming no live session writes no line.
   */
  function liveSession(lineage: string): string | null {
    return liveByLineage(options.records(), lineage)?.sessionId ?? null;
  }

  async function answer(
    request: IncomingMessage,
    response: ServerResponse,
    answerDoor: NonNullable<DoorRoutesOptions["answerDoor"]>,
  ): Promise<void> {
    const body = await posted(request, response, "/door/answer");
    if (body === null) return;
    const { lineage, name } = body;
    const { text, entryId } = body.fields;
    if (typeof text !== "string") {
      refuse(response, "/door/answer", 400, "text is not a string");
      return;
    }
    // Optional. Where present it names the entry the caller read from /door/pending, and an answer
    // whose entry is no longer the one held reads no-question rather than answering a newer one.
    if (entryId !== undefined && (typeof entryId !== "string" || entryId === "")) {
      refuse(response, "/door/answer", 400, "entryId is not a string");
      return;
    }
    const sessionId = liveSession(lineage);
    const status = await answerDoor(lineage, name, text, entryId);
    // The path, the session, the act and the status, and neither the person nor the text.
    if (sessionId !== null) log(`door: /door/answer: answer for session ${sessionId}: ${status}`);
    send(response, 200, { status });
  }

  async function permission(
    request: IncomingMessage,
    response: ServerResponse,
    settleDoor: NonNullable<DoorRoutesOptions["settleDoor"]>,
  ): Promise<void> {
    const body = await posted(request, response, "/door/permission");
    if (body === null) return;
    const { lineage, name } = body;
    const { requestId, behavior, nonce } = body.fields;
    if (typeof requestId !== "string" || !PERMISSION_REQUEST_ID.test(requestId)) {
      refuse(response, "/door/permission", 400, "requestId is not five letters of a request id");
      return;
    }
    if (behavior !== "allow" && behavior !== "deny") {
      refuse(response, "/door/permission", 400, "behavior is not allow or deny");
      return;
    }
    // Never absent and never null: the desk skips its nonce check for a caller that states it has
    // none, and a verdict here always carries the one the pending read gave.
    if (typeof nonce !== "string" || !PERMISSION_NONCE.test(nonce)) {
      refuse(response, "/door/permission", 400, "nonce is not 1 to 64 hex digits");
      return;
    }
    const sessionId = liveSession(lineage);
    const status = await settleDoor(lineage, name, { requestId, behavior }, nonce);
    // The path, the session, the verdict and the status. `allow` or `deny` is the one body value a
    // door log line carries, and the line names neither the person nor the request.
    if (sessionId !== null) log(`door: /door/permission: ${behavior} for session ${sessionId}: ${status}`);
    send(response, 200, { status });
  }

  /**
   * One answer to one open ask. The body's own checks run first, then `empty` and `too-long` on an
   * answer in words, before any file is read. The rest is one call of the ask checks, handed the
   * open ask a new reading holds or none, so `closed`, `already-acted`, `no-recommendation` and
   * `changed` are answered there, in the order the operator's page answers them. A lineage no
   * registry record carries is handed none without a reading, since the pending read lists
   * nothing for it. The checks deliver the line through `deliverDoor`, write the handled mark of
   * a delivered one and log the request by the ask's id and the persona's name as the reading
   * holds them. A delivery that throws rejects here, and is answered as any failed route is.
   */
  async function ask(
    request: IncomingMessage,
    response: ServerResponse,
    askDoor: NonNullable<DoorRoutesOptions["askDoor"]>,
  ): Promise<void> {
    const body = await posted(request, response, "/door/ask");
    if (body === null) return;
    const { lineage, name, fields } = body;
    const { askId, action, words } = fields;
    if (!bounded(askId, MAX_ASK_ID_LENGTH)) {
      refuse(response, "/door/ask", 400, `askId is not 1 to ${String(MAX_ASK_ID_LENGTH)} code points`);
      return;
    }
    if (action !== "agree" && action !== "answer") {
      refuse(response, "/door/ask", 400, "action is not agree or answer");
      return;
    }
    // The words of an answer, and null on an agree, whose `words` is never read.
    let said: string | null = null;
    if (action === "answer") {
      if (typeof words !== "string") {
        refuse(response, "/door/ask", 400, "words is not a string");
        return;
      }
      if (isBlankText(words)) {
        send(response, 200, { status: "empty" });
        return;
      }
      if (!bounded(words, MAX_DOOR_ANSWER_WORDS_LENGTH)) {
        send(response, 200, { status: "too-long" });
        return;
      }
      said = words;
    }
    const known = options.records().some((record) => record.lineage === lineage);
    const shared = {
      // The lineage that matched is the persona's roster name, which the marks are held under.
      repo: lineage,
      entry: known ? askDoor.openAsk(lineage, askId) : null,
      drawn: drawnOf(fields),
      // The cut the router reports is dropped: neither line is long enough to be cut.
      deliver: async (text: string): Promise<DoorDeliveryStatus> => (await options.deliverDoor(lineage, name, text)).status,
      label: (found: AskEntry): string => `door ${action}: ask ${JSON.stringify(found.id)} for ${JSON.stringify(lineage)}`,
    };
    // Held as a constant, so the answer line's composer reads a string and never the null.
    const answered = said;
    const status =
      answered === null
        ? await askDoor.askAct({
            ...shared,
            act: "agree",
            // As the page's Agree reads it: no string is no recommendation drawn, and is `changed`.
            recommend: typeof fields.recommend === "string" ? fields.recommend : null,
            inBatch: false,
            line: (found, recommended, at) => doorAgreeLine(found.id, recommended, at),
            how: "agreed",
          })
        : await askDoor.askAct({
            ...shared,
            act: "answer",
            recommend: drawnRecommendOf(fields),
            line: (found) => doorAnswerLine(found.id, found.question, answered),
            how: "corrected",
          });
    send(response, 200, { status });
  }

  // The three every door serves, and each of the other five whose callback this door holds. A
  // path with no handler here is not the door's, and its request is left for the hook intake to
  // answer as it answers any path it does not know.
  const { pending: waitingOn, status: statusOf, answerDoor, settleDoor, askDoor } = options;
  const handlers: Partial<
    Record<DoorRoute, (request: IncomingMessage, response: ServerResponse, query: URLSearchParams) => void | Promise<void>>
  > = {
    "/door/lineages": (_request, response) => lineages(response),
    "/door/lines": (_request, response, query) => lines(response, query),
    "/door/line": line,
    ...(waitingOn === undefined
      ? {}
      : { "/door/pending": (_request, response, query) => pending(response, query, waitingOn) }),
    ...(statusOf === undefined
      ? {}
      : { "/door/status": (_request, response, query) => status(response, query, statusOf) }),
    ...(answerDoor === undefined
      ? {}
      : { "/door/answer": (request, response) => answer(request, response, answerDoor) }),
    ...(settleDoor === undefined
      ? {}
      : { "/door/permission": (request, response) => permission(request, response, settleDoor) }),
    ...(askDoor === undefined ? {} : { "/door/ask": (request, response) => ask(request, response, askDoor) }),
  };

  return (request, response) => {
    const url = request.url ?? "/";
    const mark = url.indexOf("?");
    const path = mark < 0 ? url : url.slice(0, mark);
    if (!Object.hasOwn(handlers, path)) return false;
    const route = path as DoorRoute;
    const handle = handlers[route];
    if (handle === undefined) return false;

    if (!isLoopback(request.socket.remoteAddress) || !isAllowedHost(request.headers.host)) {
      refuse(response, route, 403, "loopback only");
      return true;
    }
    if (!keyMatches(request.headers["x-channels-door"])) {
      refuse(response, route, 401, "door key required");
      return true;
    }
    const allow = ROUTE_METHOD[route];
    if (request.method !== allow) {
      refuse(response, route, 405, "method not allowed", { allow });
      return true;
    }

    // A response still open is answered, so a caller is not left waiting on a request that is
    // over, whether the handler throws at once or its promise rejects later. The log line names the
    // error's kind and never its message, which nothing here guarantees is free of the body.
    const failed = (error: unknown): void => {
      if (!response.headersSent && !response.destroyed) send(response, 500, { error: "the request failed" });
      log(`door: the ${route} route failed: ${error instanceof Error ? error.name : "a thrown value"}`);
    };
    try {
      handle(request, response, new URLSearchParams(mark < 0 ? "" : url.slice(mark + 1)))?.catch(failed);
    } catch (error) {
      failed(error);
    }
    return true;
  };
}
