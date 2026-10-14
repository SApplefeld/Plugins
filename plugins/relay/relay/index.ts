// The relay: the MCP channel server that runs as a stdio child of one Claude Code process.
//
// A channel server is never told what session it belongs to. The protocol hands it `content` and a
// `meta` bag it authors itself, and nothing anywhere in it carries a session ID or a name; a
// channel is a child of the *process*, so a `/clear` mints a new session underneath it without its
// knowing. That is the whole reason identity travels over hooks instead, and the reason this
// process joins the broker by the CHANNEL_PROCESS_TOKEN it inherited from the launch wrapper.
//
// Nothing is written to stdout: stdout is the protocol pipe. Diagnostics go to stderr.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_PORT } from "../broker/config.ts";
import { runDirectly } from "../broker/entrypoint.ts";
import { createBrokerClient, holdsControlCharacter } from "./broker.ts";
import type { BrokerClient, ReplyStatus, RestartOutcome } from "./broker.ts";
import {
  PermissionRequestNotificationSchema,
  channelCapabilities,
  permissionNotification,
} from "./permission.ts";
import { INSTRUCTIONS, REPLY_TOOL_NAME, RESTART_TOOL_NAME, TOOLS, channelNotification } from "./protocol.ts";

/** The longest file path a reply may name, the same bound the broker reads a path under. */
const MAX_FILE_PATH_LENGTH = 1024;

/** What the model is told when a reply had nowhere to land. */
const REPLY_FAILURES: Record<string, string> = {
  // Either the SessionStart hook has not announced this process yet, or the session it announced
  // has already ended. Both mean the broker holds no session for this relay to speak for.
  "no-session": "Not sent: the broker holds no live session for this process, so there is no thread.",
  "no-thread": "Not sent: this session's Discord thread has not been opened yet.",
  failed: "Not sent: the broker could not post the message.",
};

/**
 * What the model is told about one reply, from what the reply came to.
 *
 * Held apart from the server wiring so the mapping can be driven on its own: what a status becomes
 * is the whole of this tool's model-facing behavior, and `isError` is the load-bearing half of it.
 * An error is the signal that invites another attempt, so it is set on every outcome that had
 * nowhere to land and withheld from the one that may already be part-way up the thread.
 */
export function replyToolResult(status: ReplyStatus, reason?: string): CallToolResult {
  if (status === "sent") {
    return { content: [{ type: "text", text: "Sent to this session's thread." }] };
  }
  if (status === "still-posting") {
    // The broker was answering right up to the moment the wait ran out, so the messages may be
    // going up in the thread now: sending them again is how the operator reads the whole answer
    // twice. The instruction leads, because it is the part that has to survive being skimmed.
    return {
      content: [
        {
          type: "text",
          text:
            "Do not send this message again. The broker is still posting it, so it may already " +
            "be in this session's thread in whole or in part.",
        },
      ],
    };
  }
  if (status === "file-refused") {
    // The broker's sentence for why, carried as written, since it names what to fix and never the
    // path. Without one the model is still told the file was not attached and nothing posted.
    const text =
      typeof reason === "string"
        ? `Not sent: the file was not attached: ${reason}. Nothing was posted.`
        : "Not sent: the file was not attached. Nothing was posted.";
    return { content: [{ type: "text", text }], isError: true };
  }
  // Own properties only. `status` is a string off the wire, so a plain lookup would resolve
  // `constructor` or `toString` through the prototype chain and carry a function where the model
  // expects one of the sentences above.
  const text = Object.hasOwn(REPLY_FAILURES, status) ? REPLY_FAILURES[status] : REPLY_FAILURES.failed;
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * One call of the reply tool, from its arguments to what the model is told.
 *
 * Held apart from the server wiring, as the result mapping is, so the checks that answer the model
 * without asking the broker can be driven on their own. `watched` is whether this process holds a
 * process token from the launch wrapper.
 */
export async function replyToolCall(
  args: Record<string, unknown> | undefined,
  watched: boolean,
  reply: BrokerClient["reply"],
): Promise<CallToolResult> {
  const message = args?.message;
  if (typeof message !== "string" || message.trim() === "") {
    return { content: [{ type: "text", text: "reply needs a non-empty message." }], isError: true };
  }
  // Absent is no file. Present, only its shape is judged here, since the relay knows no session
  // and no disk: whether the path is absolute, local and inside the session's working directory
  // is the broker's to decide. Judged before the launch wrapper is, since the model can fix an
  // argument and cannot fix how its session was started.
  const file = args?.file;
  if (
    file !== undefined &&
    (typeof file !== "string" || file === "" || file.length > MAX_FILE_PATH_LENGTH || holdsControlCharacter(file))
  ) {
    return { content: [{ type: "text", text: "file must be a path of at most 1,024 characters." }], isError: true };
  }
  if (!watched) {
    // Answered here rather than by opening a socket the broker would have nothing to match: this
    // session was started without the launch wrapper, so no thread exists anywhere for it.
    return {
      content: [
        {
          type: "text",
          text: "Not sent: this session was not started through the launch wrapper, so it has no Discord thread.",
        },
      ],
      isError: true,
    };
  }
  // Whatever chat_id was passed is left where it is. The broker routes by session, which is what
  // lets an unprompted reply, sent with no chat_id at all, still reach the right thread.
  const result = await reply(message, file);
  return replyToolResult(result.status, result.reason);
}

/** What the model is told when the restart tool was called by a session no broker watches. */
const RESTART_UNWATCHED: CallToolResult = {
  content: [
    {
      type: "text",
      text:
        "Not restarted: this session was not started through the launch wrapper, so it holds no " +
        "relay to the broker.",
    },
  ],
  isError: true,
};

/**
 * What the model is told about one restart request, from what it came to.
 *
 * Only the accepted answer is no error: it is the one outcome where the next step is to wait. A
 * refusal carries the broker's reason as written, because the reason names what to do about it,
 * and the broker already keeps message text out of it. A failure carries the relay's or the
 * broker's words for what went wrong, which never come from a message either.
 */
export function restartToolResult(outcome: RestartOutcome): CallToolResult {
  if (outcome.status === "restarting") {
    return {
      content: [
        {
          type: "text",
          text:
            "The broker is restarting onto the code and configuration on disk. This session's " +
            "relay and thread reconnect on their own; wait before sending anything to the thread.",
        },
      ],
    };
  }
  if (outcome.status === "refused") {
    return { content: [{ type: "text", text: `Not restarted: ${outcome.reason}` }], isError: true };
  }
  return {
    content: [{ type: "text", text: `Not restarted: the broker did not decide (${outcome.error}).` }],
    isError: true,
  };
}

/**
 * The most of a notification's method name that is written, in code points, and the most distinct
 * names one relay process names at all.
 *
 * A line's length is never someone else's to choose, which is why the name is cut. The count bound
 * is what keeps the set below from being a map with nothing to remove it: past it the seam goes
 * quiet, having already recorded thirty-two methods nobody expected.
 */
const MAX_METHOD_LENGTH = 120;
const MAX_NAMED_METHODS = 32;

/**
 * Names every notification Claude Code sends that no registered handler claims, once each.
 *
 * What this channel carries is decided by Claude Code, not by this file, so a method arriving here
 * is one this relay does not implement. That makes this the one seam inside a session that can
 * report a capability the broker could be acting on and is not: a permission prompt resolved at the
 * console is invisible to the broker, and whether anything announces it is a question nothing else
 * observes.
 *
 * The method name is the whole record. A notification's params carry conversation content and this
 * line is written to disk, so nothing here reads them.
 *
 * Once per distinct name, because a notification that repeats every turn would otherwise restate
 * what its first line established. The writer is injected so the line can be read back without
 * capturing a process stream.
 */
export function unhandledNotifications(
  write: (line: string) => void,
): (notification: { method: string }) => Promise<void> {
  const named = new Set<string>();
  return (notification) => {
    const method = [...notification.method].slice(0, MAX_METHOD_LENGTH).join("");
    if (named.has(method) || named.size >= MAX_NAMED_METHODS) return Promise.resolve();
    named.add(method);
    write(`relay: unhandled notification ${method}\n`);
    return Promise.resolve();
  };
}

function port(env: NodeJS.ProcessEnv): number {
  const raw = env.CHANNEL_BROKER_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : DEFAULT_PORT;
}

export async function startRelay(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const processToken = env.CHANNEL_PROCESS_TOKEN?.trim();
  if (!processToken) {
    // A session started without the launch wrapper is not being watched. The server still runs, so
    // the reply tool exists and reports honestly rather than the session failing to start.
    process.stderr.write("relay: no CHANNEL_PROCESS_TOKEN, this session is not being watched\n");
  }

  const server = new Server(
    { name: "channel-relay", version: "0.1.0" },
    {
      capabilities: { experimental: channelCapabilities(Boolean(processToken)), tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  const broker = createBrokerClient({
    port: port(env),
    processToken: processToken ?? "",
    onMessage: (text, chatId, attribution) => {
      // Fire and forget: an inbound message is not something the broker waits on, and a failed
      // write must not take the pipe down.
      void server.notification(channelNotification(text, chatId, attribution)).catch((error: unknown) => {
        process.stderr.write(`relay: could not deliver a channel message: ${String(error)}\n`);
      });
    },
    onVerdict: (verdict) => {
      // Fire and forget, for the same reason an inbound message is: the operator's answer is not
      // something the broker waits on, and a failed write must not take the pipe down.
      void server.notification(permissionNotification(verdict)).catch((error: unknown) => {
        process.stderr.write(`relay: could not deliver a permission verdict: ${String(error)}\n`);
      });
    },
    log: (message) => process.stderr.write(`${message}\n`),
  });

  if (processToken) {
    // Registered with the capability above and never without it. The prompt is handed straight to
    // the broker: this process is a child of the session the prompt is about, so it is the last
    // thing that should be deciding whether the tool call is allowed.
    server.setNotificationHandler(PermissionRequestNotificationSchema, (notification) => {
      const params = notification.params;
      void broker
        .permissionRequest({
          requestId: params.request_id,
          toolName: params.tool_name,
          description: params.description ?? "",
          inputPreview: params.input_preview ?? "",
        })
        .then((taken) => {
          if (!taken) {
            process.stderr.write("relay: the broker did not take a permission prompt\n");
          }
        })
        .catch((error: unknown) => {
          process.stderr.write(`relay: could not hand over a permission prompt: ${String(error)}\n`);
        });
    });
  }

  server.fallbackNotificationHandler = unhandledNotifications((line) => process.stderr.write(line));

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...TOOLS] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === RESTART_TOOL_NAME) {
      // Answered here for the same reason a reply is: a session started without the launch wrapper
      // holds no pipe, so the broker would refuse the ask before deciding it.
      if (!processToken) return RESTART_UNWATCHED;
      return restartToolResult(await broker.restart());
    }
    if (request.params.name !== REPLY_TOOL_NAME) {
      return { content: [{ type: "text", text: `Unknown tool ${request.params.name}.` }], isError: true };
    }
    return replyToolCall(request.params.arguments, Boolean(processToken), broker.reply);
  });

  // The stream is opened only once the connection is initialized. Claude Code probes a stdio
  // server's protocol revision by starting it, closing it, and respawning it pinned to the legacy
  // one; the probed process never gets this far, so it never registers a pipe whose closing the
  // broker would read as the session dying.
  server.oninitialized = (): void => {
    if (processToken) broker.start();
  };
  server.onclose = (): void => {
    broker.stop();
  };

  await server.connect(new StdioServerTransport());
}

// Claude Code starts this as a child process. The guard is what lets a test import the module
// without it seizing stdio, which is the MCP pipe.
if (runDirectly(import.meta.url)) {
  await startRelay();
}
