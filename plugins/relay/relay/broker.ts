// The relay's client for the broker, over the same loopback listener the hooks post to.
//
// Held apart from the MCP wiring so it can be driven against a real HTTP server in a test: nothing
// here knows what a channel notification is, and nothing in the server wiring knows what the broker
// speaks.
import http from "node:http";
import path from "node:path";
import {
  RELAY_MAX_RECONNECT_DELAY_MS,
  RELAY_READ_TIMEOUT_MS,
  RELAY_REPLY_IDLE_MS,
} from "../broker/config.ts";
import type { PermissionVerdict } from "./permission.ts";

/**
 * Who wrote an inbound message, as the broker names them, how many messages the text gathers when
 * the broker's response gate delivered several as one, and the files the broker saved from those
 * messages, as absolute paths in message order. Each field is absent when the broker's event did
 * not carry it, which is how a broker that predates attribution speaks and how one delivering a
 * single message does, and absent too when the event carried it in a shape the relay does not
 * accept, such as the wrong type, a count below one or a relative path. The class
 * alone differs: it is absent only when the event carried no class at all, and it reads
 * `participant` where the broker sent a value that is not one of the roster's two classes.
 */
export type Attribution = {
  author?: string;
  senderClass?: string;
  buffered?: number;
  attachments?: readonly string[];
};

/**
 * The most paths one event may carry. It matches the broker's own ceiling per event, so a list the
 * broker could have written is never refused here, and a longer one is not something it wrote.
 */
export const MAX_EVENT_ATTACHMENTS = 200;

export type InboundHandler = (text: string, chatId: string, attribution: Attribution) => void;

/** The operator's answer to one tool prompt, as it arrives down the stream. */
export type VerdictHandler = (verdict: PermissionVerdict) => void;

/**
 * What one reply came to. `sent` is the only success.
 *
 * All but `still-posting` are the broker's own words for the outcome, read out of the response
 * body; `file-refused` is a reply whose named file the broker would not attach, so nothing posted,
 * and it carries the broker's reason. `still-posting` is the relay's alone and never arrives on the
 * wire: it is what a reply comes to when the broker was still answering at the ceiling on one
 * reply, so the run may be part-way up the thread and the answer must not be sent again.
 */
export type ReplyStatus = "sent" | "no-session" | "no-thread" | "failed" | "file-refused" | "still-posting";

/**
 * What one reply comes back as. `error` is why a request failed and `reason` is the broker's
 * sentence for a refusal, each present only where one was written. On a sent reply that named
 * people, `unresolved` holds the names the broker matched to nobody on this host's allowlist, as
 * the session sent them, and `quieted` is set where the thread's ping window quieted every ping;
 * both are left off a reply whose names all pinged, and off any reply that named nobody.
 */
export type ReplyOutcome = {
  status: ReplyStatus;
  error?: string;
  reason?: string;
  unresolved?: readonly string[];
  quieted?: true;
};

/**
 * What one noted close came to. `noted` is the only success: the broker marked the messages the
 * turn read and posted nothing. `no-session` and `no-thread` are the broker's own words for a close
 * with nowhere to mark, and `failed` is every way the request did not reach a decision, a broker
 * that predates the field among them, since its route refuses a body with no text.
 */
export type NotedStatus = "noted" | "no-session" | "no-thread" | "failed";

/**
 * What one noted close comes back as. `error` is why a request failed, present only where one was
 * written.
 */
export type NotedOutcome = { status: NotedStatus; error?: string };

/**
 * What one restart request came to. The first two are the broker's own answers, read out of the
 * response body with the reason the broker gave; `failed` is every way the request did not reach a
 * decision, with the relay's or the broker's words for it.
 */
export type RestartOutcome =
  | { status: "restarting" }
  | { status: "refused"; reason: string }
  | { status: "failed"; error: string };

export type BrokerClientOptions = {
  port: number;
  /** Identifies which Claude Code process this pipe belongs to. It authorizes nothing. */
  processToken: string;
  /**
   * The session's human name, as `CHANNEL_SESSION` holds it, and its restart lineage, as
   * `CHANNEL_LINEAGE` does. Each is sent on the stream request alone, and only where it passes
   * `PRINTABLE_ASCII`. The broker uses them to register a session whose SessionStart hook never
   * reached it, and they authorize nothing.
   */
  sessionName?: string;
  lineage?: string;
  onMessage: InboundHandler;
  /** Left unset by a relay that declares no permission capability, which then hears no verdicts. */
  onVerdict?: VerdictHandler;
  log?: (message: string) => void;
  /** How long to wait before reconnecting a dropped stream. Doubles up to the ceiling. */
  reconnectDelayMs?: number;
  /**
   * A stream that has not delivered so much as a heartbeat for this long is presumed dead and
   * reconnected. The default is shared with the broker, which clamps its heartbeat below it: the
   * two run in different processes and cannot otherwise see each other.
   */
  readTimeoutMs?: number;
  /**
   * How long a reply's response may go with no byte on it before the broker is presumed to have
   * stopped answering and the reply is reported as failed. The default is shared with the broker,
   * which writes a heartbeat under it while a run is in flight.
   */
  replyIdleMs?: number;
  /** The ceiling below, overridable so a test does not have to wait out the real one. */
  replyCeilingMs?: number;
};

export type BrokerClient = {
  /**
   * How long this client lets a reply's response stay silent before it reports the reply as
   * failed, as resolved from the option or from the default shared with the broker.
   *
   * Readable because what has to hold is a relation to the broker's heartbeat rather than any
   * number chosen here: the broker feeds a reply's response while its run is in flight, so this
   * fires only on a broker that has genuinely stopped answering, and a client impatient enough to
   * beat the heartbeat would tell the model an answer failed while its messages were still going
   * up.
   */
  replyIdleMs: number;
  /**
   * The longest this client waits for one reply however alive the broker looks.
   *
   * Readable for the same reason the idle window is: it is the reply tool's own latency ceiling. A
   * reply that reaches it is reported as still posting rather than failed, because a broker that
   * was answering the whole way is a broker whose run may be part-way up the thread.
   */
  replyCeilingMs: number;
  /**
   * How long this client waits for the broker to take one permission prompt before it reports the
   * prompt as not taken.
   *
   * Its own wait rather than the reply's, and a far shorter one. The broker's work on this route is
   * a single alert post, and the operator's verdict arrives later down the stream rather than on
   * this response, so nothing here waits on a paced run. A session parked on a prompt is a session
   * waiting on a person, and a broker that has stopped answering is worth reporting in seconds.
   */
  permissionTimeoutMs: number;
  start: () => void;
  stop: () => void;
  /**
   * Posts one reply, with the file at `file` attached where one is named and the people in
   * `mentions` pinged where the broker resolves them. The path and the names are sent as given and
   * the broker decides whether the file may leave and which names match its allowlist; `reason`
   * is the broker's sentence for a refusal, present only where the broker wrote one.
   */
  reply: (text: string, file?: string, mentions?: readonly string[]) => Promise<ReplyOutcome>;
  /**
   * Closes the turn with nothing to say: the broker marks the messages the turn read as noted and
   * posts nothing. It rides the reply's route, token and key, so it needs no route of its own.
   */
  noted: () => Promise<NotedOutcome>;
  /**
   * Hands the broker one permission prompt to put in front of the operator. It resolves when the
   * broker has taken the prompt, not when the operator answers: the answer arrives whenever they
   * give it, down the stream, and holding a socket open for it would outlast the read timeout.
   */
  permissionRequest: (request: {
    requestId: string;
    toolName: string;
    description: string;
    inputPreview: string;
  }) => Promise<boolean>;
  /**
   * Asks the broker to restart onto the code and configuration on disk. The answer is final once
   * received: the broker writes it before it stops, and the stream this client holds drops right
   * after an accepted one, which the ordinary reconnect covers.
   */
  restart: () => Promise<RestartOutcome>;
};

const DEFAULT_RECONNECT_DELAY_MS = 1_000;

/**
 * How long a restart's POST may go unanswered before it is reported as failed.
 *
 * The broker decides a restart at once and writes its answer before anything stops, so what this
 * covers is one loopback round trip; it is the permission prompt's wait for the same reason.
 */
const RESTART_TIMEOUT_MS = 15_000;

/**
 * How long a permission prompt's POST may go unanswered before the prompt is reported as not taken.
 *
 * What it covers is one alert post and a loopback round trip, so it is generous for the work and
 * short enough that a session parked on a prompt hears "dropped" while the operator could still be
 * reached another way.
 */
const PERMISSION_TIMEOUT_MS = 15_000;

/**
 * How long Claude Code lets one MCP tool call sit with no progress notification before it gives up
 * on it, for a server it speaks to over stdio, which is how this relay is connected.
 *
 * Not this repo's value: it is Claude Code's own default for `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`,
 * documented in its MCP reference, and an environment that sets that variable moves it. It is
 * written down here because it is the outermost bound on the reply tool and nothing in either
 * process would report the ceiling below as having crossed it. The separate wall-clock bound,
 * `MCP_TOOL_TIMEOUT`, defaults to about 28 hours and is not what a reply can reach.
 */
export const MCP_TOOL_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The longest one reply is waited on, however alive the broker looks on the socket.
 *
 * Chosen rather than derived, because there is no arithmetic to derive it from: a reply is posted
 * on its thread's ordering chain and several full-length mirror runs can sit ahead of it, so no
 * per-run cost bounds the wait. What this bounds is a chain that is wedged rather than slow.
 *
 * It bounds the model's wait and not the run: a run that outlasts it keeps going and its messages
 * still land in the thread. That is why reaching it is reported as still posting, never as failed.
 * The broker was answering the whole way, so the messages may be going up right now, and sending
 * them again is the double post this whole path exists to avoid.
 *
 * It sits below the idle window above, which is what makes it the bound that fires: a reply is what
 * Claude Code would otherwise time out on, and settling first is what lets the model be told not to
 * resend. Being under that window is also why nothing here emits a progress notification, which is
 * the only thing that would push the window out.
 */
const REPLY_CEILING_MS = 15 * 60 * 1000;

/**
 * Bounded so a broker that never sends a newline cannot grow this without limit. Exported so the
 * broker's inbound routing can pin its worst-case stream line under this cap.
 */
export const MAX_LINE_BYTES = 64 * 1024;

/**
 * Whether a value is a path in the form the broker writes: a string that is absolute, equals its own
 * resolved form, and holds no C0 control character or DEL. A path with a newline would break out of
 * a line of text, and one not in resolved form is not one the broker built. UNC paths pass, since a
 * state directory on a share makes the broker write them.
 */
function isSavedPath(entry: unknown): entry is string {
  return (
    typeof entry === "string" &&
    path.isAbsolute(entry) &&
    path.resolve(entry) === entry &&
    !holdsControlCharacter(entry)
  );
}

/**
 * Whether a path holds a C0 control character or DEL. One test for every path that crosses the
 * pipe, in either direction, since a newline in one would break out of a line of text.
 */
export function holdsControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/**
 * One or more printable ASCII characters and nothing else, the gate hooks/session-start.ps1 holds
 * `CHANNEL_SESSION` and `CHANNEL_LINEAGE` to before it sends either as a header. Node refuses a
 * header value holding a control character when the request is built, and that throw would take the
 * stream with it, so a value outside the gate is left off and the pipe still attaches. With no `m`
 * flag, `$` matches only at the end of the value, never before a final newline.
 */
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/**
 * The stream request's headers: the process token, and the session's name and lineage where each
 * passes the gate above.
 */
function streamHeaders(options: BrokerClientOptions): Record<string, string> {
  const headers: Record<string, string> = { "x-channel-process-token": options.processToken };
  if (options.sessionName !== undefined && PRINTABLE_ASCII.test(options.sessionName)) {
    headers["x-channel-session-name"] = options.sessionName;
  }
  if (options.lineage !== undefined && PRINTABLE_ASCII.test(options.lineage)) {
    headers["x-channel-lineage"] = options.lineage;
  }
  return headers;
}

export function createBrokerClient(options: BrokerClientOptions): BrokerClient {
  const log = options.log ?? ((): void => {});
  const baseDelay = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const readTimeoutMs = options.readTimeoutMs ?? RELAY_READ_TIMEOUT_MS;
  const replyIdleMs = options.replyIdleMs ?? RELAY_REPLY_IDLE_MS;
  const replyCeilingMs = options.replyCeilingMs ?? REPLY_CEILING_MS;
  let stopped = false;
  let delay = baseDelay;
  let request: http.ClientRequest | null = null;
  let retry: NodeJS.Timeout | null = null;
  /**
   * Issued by the broker on the stream this relay holds, and required on every reply. A process
   * token is inherited by every subprocess a session spawns, so it is not standing to write into
   * the operator's thread; holding the pipe is, and this is the proof of that.
   */
  let replyKey: string | null = null;

  function handle(line: string): void {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      // A broker speaking something this does not understand is not a reason to drop the pipe.
      return;
    }
    if (typeof event !== "object" || event === null) return;
    const fields = event as Record<string, unknown>;
    if (fields.type === "hello") {
      if (typeof fields.replyKey === "string") replyKey = fields.replyKey;
      // The backoff resets here and nowhere else. A refused stream is a 200 that ends immediately,
      // so resetting on the status code alone would make a relay that lost the pipe race retry
      // every second for the life of the session, writing a broker log line each time.
      delay = baseDelay;
      return;
    }
    if (fields.type === "refused") {
      // Another pipe already holds this process token. Refusing rather than promoting is what stops
      // a subprocess of this session from taking over the operator's channel, so the honest thing
      // is to stay quiet rather than to keep racing for it.
      log(`relay: the broker refused the stream (${String(fields.reason ?? "no reason given")})`);
      return;
    }
    if (fields.type === "permission") {
      // The verdict rides the stream rather than a response, and the stream is the one thing only
      // the holder of this pipe can read. A subprocess that scraped the process token out of its
      // environment has no way onto it, so it cannot answer a prompt on the operator's behalf.
      if (typeof fields.requestId !== "string") return;
      if (fields.behavior !== "allow" && fields.behavior !== "deny") return;
      options.onVerdict?.({ requestId: fields.requestId, behavior: fields.behavior });
      return;
    }
    if (fields.type !== "message") return;
    if (typeof fields.text !== "string" || typeof fields.chatId !== "string") return;
    // Carried when present and left out when not, so an older broker's event, which names no
    // author, is still delivered rather than refused. A field the broker did not send is absent,
    // and so is a field in a shape the relay does not accept.
    const attribution: Attribution = {};
    if (typeof fields.author === "string") attribution.author = fields.author;
    // The class is the exception, since it alone decides the standing an event reaches the session
    // with, and the session reads an event with no class as the operator's. Only a line with no
    // `senderClass` key is left without one, which after the parse is a value reading `undefined`.
    // Any other value that is not one of the roster's two classes, a null or a number among them,
    // is a class this relay does not know, and the event is marked `participant`. The log line is
    // the trace of that, in fixed words: the value is a peer's text and never enters it.
    if (fields.senderClass === "operator" || fields.senderClass === "participant") {
      attribution.senderClass = fields.senderClass;
    } else if (fields.senderClass !== undefined) {
      attribution.senderClass = "participant";
      log(
        "relay: the broker named a sender class this relay does not know, so the event is " +
          "delivered as a participant's",
      );
    }
    // A count is a whole number of messages, at least one. Anything else is left out the way a
    // non-string author is: the message is still delivered, and the envelope claims no count.
    const buffered = fields.buffered;
    if (typeof buffered === "number" && Number.isInteger(buffered) && buffered >= 1) {
      attribution.buffered = buffered;
    }
    // A list of one to the ceiling entries, each an absolute path already in resolved form and free
    // of control characters. A list that is anything else is left out whole rather than trimmed to
    // its good entries, since the attributes number the paths across the event and a partial list
    // would misnumber them.
    const attachments = fields.attachments;
    if (
      Array.isArray(attachments) &&
      attachments.length >= 1 &&
      attachments.length <= MAX_EVENT_ATTACHMENTS &&
      attachments.every((entry) => isSavedPath(entry))
    ) {
      attribution.attachments = attachments as string[];
    }
    options.onMessage(fields.text, fields.chatId, attribution);
  }

  function reconnect(): void {
    if (stopped || retry !== null) return;
    replyKey = null;
    // The broker is restarted by its scheduled task and can be down for any part of a twelve-hour
    // session. A
    // relay that gave up would leave the session running and permanently unreachable, with its
    // status card still ticking, which is the exact failure the card exists to make visible.
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, delay);
    delay = Math.min(delay * 2, RELAY_MAX_RECONNECT_DELAY_MS);
  }

  function connect(): void {
    if (stopped) return;
    let buffer = "";
    const pending = http.get(
      {
        host: "127.0.0.1",
        port: options.port,
        path: "/relay/stream",
        headers: streamHeaders(options),
      },
      (response) => {
        if (response.statusCode !== 200) {
          // Drained so the socket can be reused, and with a listener attached: an error on a
          // response nobody is listening to is an unhandled 'error' event, which is fatal.
          response.on("error", () => {});
          response.resume();
          log(`relay: the broker refused the stream with HTTP ${String(response.statusCode)}`);
          reconnect();
          return;
        }
        // Any byte from the broker, a heartbeat included, proves the pipe: the timer is reset on
        // data rather than on a parsed message, so a quiet session does not look like a dead one.
        response.setTimeout(readTimeoutMs, () => response.destroy());
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          buffer += chunk;
          let cut = buffer.indexOf("\n");
          while (cut !== -1) {
            handle(buffer.slice(0, cut));
            buffer = buffer.slice(cut + 1);
            cut = buffer.indexOf("\n");
          }
          if (buffer.length > MAX_LINE_BYTES) buffer = "";
        });
        response.on("end", reconnect);
        response.on("close", reconnect);
        response.on("error", reconnect);
      },
    );
    request = pending;
    pending.on("error", () => {
      // The broker is not listening. Silent by design: it is optional, and a relay that logged on
      // every retry would fill a session's stderr for the life of the process.
      reconnect();
    });
  }

  /**
   * One POST to the broker, carrying the pipe's reply key. Every POST route speaks this shape and
   * shares it, so a settle path proved on one is the settle path on the others.
   *
   * The bodies differ only in their fields. Neither carries a chat_id: the broker routes by
   * session, and a field that does not exist on the wire cannot be honored by accident later.
   *
   * The outcome is read out of the body and never off the status line, because the reply route
   * commits its 200 before its run starts and cannot know the outcome yet; a route that refuses the
   * request outright still answers a non-2xx, and its body carries the reason the same way.
   *
   * `idleMs` is silence on the socket rather than elapsed time, and the waits are the caller's:
   * the two routes cost different work on the broker's side, and only a reply, which is answered
   * across a whole paced run, also carries an absolute ceiling.
   */
  function post(
    path: string,
    body: Record<string, unknown>,
    idleMs: number,
    ceilingMs?: number,
  ): Promise<{ status: string; error?: string; reason?: string; unresolved?: string[]; quieted?: true }> {
    if (replyKey === null) {
      // No pipe, so no standing to write. Reported locally rather than attempted, because the
      // broker would refuse it and the model is waiting on the answer either way.
      return Promise.resolve({ status: "failed", error: "this relay holds no channel stream" });
    }
    const key = replyKey;

    return new Promise((resolve) => {
      // Settled at most once. Node reports a peer that dies mid-body through 'aborted', 'error',
      // or 'close' and never through 'end', so a promise resolved only on 'end' would leave the
      // tool call awaiting it forever, and the turn parked with it.
      let settled = false;
      let ceiling: NodeJS.Timeout | null = null;
      const finish = (result: {
        status: string;
        error?: string;
        reason?: string;
        unresolved?: string[];
        quieted?: true;
      }): void => {
        if (settled) return;
        settled = true;
        if (ceiling !== null) clearTimeout(ceiling);
        resolve(result);
      };

      const payload = Buffer.from(JSON.stringify(body), "utf8");
      const pending = http.request(
        {
          host: "127.0.0.1",
          port: options.port,
          path,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": payload.length,
            "x-channel-process-token": options.processToken,
            "x-channel-reply-key": key,
          },
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            raw += chunk;
          });
          response.on("error", (error) => finish({ status: "failed", error: error.message }));
          response.on("aborted", () => finish({ status: "failed", error: "the broker hung up" }));
          response.on("close", () =>
            finish({ status: "failed", error: "the broker closed the connection" }),
          );
          response.on("end", () => {
            try {
              const parsed = JSON.parse(raw) as {
                status?: unknown;
                error?: unknown;
                reason?: unknown;
                unresolved?: unknown;
                quieted?: unknown;
              };
              // `error` is why a request failed and `reason` is why a decided one was refused.
              // The restart route and a reply whose file was refused give a reason, and it is
              // carried as the broker wrote it, since the model reads it as the answer. A sent
              // reply's `unresolved` names and `quieted` flag are carried on the same terms, and
              // only in the shape the broker writes them, a list of strings and a literal true;
              // anything else is read as absent.
              const unresolved = parsed.unresolved;
              finish({
                status: typeof parsed.status === "string" ? parsed.status : "failed",
                error: typeof parsed.error === "string" ? parsed.error : undefined,
                reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
                unresolved:
                  Array.isArray(unresolved) && unresolved.every((name) => typeof name === "string")
                    ? (unresolved as string[])
                    : undefined,
                quieted: parsed.quieted === true ? true : undefined,
              });
            } catch {
              finish({ status: "failed", error: "the broker's answer was not JSON" });
            }
          });
        },
      );
      // Silence on the socket, not elapsed time: the timer is reset by any byte the broker sends,
      // so what it covers is a peer that accepted the connection and then stopped answering
      // without closing it, and a broker still feeding the response keeps its wait.
      pending.setTimeout(idleMs, () => pending.destroy());
      if (ceilingMs !== undefined) {
        // Settled before the socket goes, so the outcome is this ceiling's own rather than the
        // hang-up the destroy produces. A broker that was answering right up to here is a broker
        // whose work may be part-way done, which is a different report from one that went quiet.
        ceiling = setTimeout(() => {
          finish({
            status: "still-posting",
            error: "the broker was still working on this reply when the wait ran out",
          });
          pending.destroy();
        }, ceilingMs);
      }
      pending.on("error", (error) => finish({ status: "failed", error: error.message }));
      pending.on("close", () => finish({ status: "failed", error: "the request was not answered" }));
      pending.end(payload);
    });
  }

  return {
    replyIdleMs,
    replyCeilingMs,
    permissionTimeoutMs: PERMISSION_TIMEOUT_MS,
    start: connect,

    stop() {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      replyKey = null;
      request?.destroy();
      request = null;
    },

    async reply(text, file, mentions) {
      // Each key is left off rather than sent empty when no file is named and when no names are,
      // so a reply without either is the body an older broker's route has always read. An empty
      // list of names is a value the call carried, and it is sent.
      const body: Record<string, unknown> = { text };
      if (file !== undefined) body.file = file;
      if (mentions !== undefined) body.mentions = mentions;
      const answer = await post("/relay/reply", body, replyIdleMs, replyCeilingMs);
      return {
        status: answer.status as ReplyStatus,
        error: answer.error,
        ...(answer.reason === undefined ? {} : { reason: answer.reason }),
        ...(answer.unresolved === undefined ? {} : { unresolved: answer.unresolved }),
        ...(answer.quieted === undefined ? {} : { quieted: answer.quieted }),
      };
    },

    async noted() {
      // `noted` and no other key, since the broker refuses a true noted beside any words key. The
      // broker answers at once and posts nothing, so the reply's idle window bounds the wait and
      // no ceiling is set.
      const answer = await post("/relay/reply", { noted: true }, replyIdleMs);
      // A status outside the four a noted close can come to reads as `failed`, so the type holds
      // only what the broker's answer can be.
      const status: NotedStatus =
        answer.status === "noted" || answer.status === "no-session" || answer.status === "no-thread"
          ? answer.status
          : "failed";
      return { status, error: answer.error };
    },

    async permissionRequest(request) {
      const answer = await post(
        "/relay/permission",
        {
          request_id: request.requestId,
          tool_name: request.toolName,
          description: request.description,
          input_preview: request.inputPreview,
        },
        PERMISSION_TIMEOUT_MS,
      );
      return answer.status === "received";
    },

    async restart() {
      const answer = await post("/relay/restart", {}, RESTART_TIMEOUT_MS);
      if (answer.status === "restarting") return { status: "restarting" };
      if (answer.status === "refused") {
        return { status: "refused", reason: answer.reason ?? "the broker gave no reason" };
      }
      // Anything else is a request the broker never decided: no stream held, no broker listening,
      // a hang-up, a request the route refused before asking the broker, or an answer this client
      // could not read.
      return { status: "failed", error: answer.error ?? "the broker did not answer" };
    },
  };
}
