// server.ts: the persona tools server's message handling, one JSON-RPC line
// at a time, for an engine that runs its own tools.
//
// createToolServer takes the host's call entry and the served definitions
// and returns a handler of one line. The handler answers with the reply line
// to write, or null where the line wants none: a notification, or a reply
// the client sent. The host owns the pipe the lines come over; this file
// opens nothing.
//
// It answers initialize with the protocol version the client asked for
// where it knows it, and the newest it knows otherwise; accepts
// notifications/initialized; answers ping; answers tools/list with the
// served set; and answers tools/call. Any other method gets -32601, a line
// that does not parse -32700, and a parsed line that is no JSON-RPC request
// -32600; none of them ends the connection. A tools/call naming a tool the
// set does not hold, or with arguments that are not an object, gets -32602,
// as the MCP specification answers an unknown tool.
//
// A call's result is one text content item. A deny, a result the handler
// marks isError, and a throw each come back with isError true, never as a
// JSON-RPC error. Every text, a result's or an error's, passes through
// boundText, so none is longer than RESULT_MAX_CHARS plus its closing line:
// agy saves a longer result to a file under its own home, which a persona
// must not read (docs/engine-portability.md, MCP Server Facts, fact 7). The
// bound holds on every engine, since a bound that differs by engine is a
// rule in the wrong layer.

export interface ServedTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ToolServerOptions {
  // Runs one served tool and resolves to what the module's handler returns.
  call: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  tools: readonly ServedTool[];
  info: { name: string; version: string };
}

// Known protocol versions, newest first.
export const PROTOCOL_VERSIONS: readonly string[] = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);

export const RESULT_MAX_CHARS = 9_000;
// How far back from the cut a line end may fall and still take the cut.
export const LINE_END_WINDOW = 500;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type Id = string | number | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `text` whole where it is RESULT_MAX_CHARS characters or fewer. Otherwise
// its first RESULT_MAX_CHARS characters, cut back to the last line end in
// the final LINE_END_WINDOW of them where one falls there and never between
// the halves of a surrogate pair, then one closing line saying how many
// characters were left out and that a narrower call returns the rest.
// Characters are UTF-16 units, as a JSON string's length counts them.
export function boundText(text: string): string {
  if (text.length <= RESULT_MAX_CHARS) return text;
  let cut = RESULT_MAX_CHARS;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  const lineEnd = text.lastIndexOf("\n", cut - 1);
  if (lineEnd >= cut - LINE_END_WINDOW) cut = lineEnd;
  const left = text.length - cut;
  return `${text.slice(0, cut)}\n[${left} characters were left out of this result; a narrower call returns the rest.]`;
}

function reply(id: Id, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function failure(id: Id, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: boundText(message) } });
}

function textResult(text: string, isError: boolean): Record<string, unknown> {
  return { content: [{ type: "text", text: boundText(text) }], ...(isError ? { isError: true } : {}) };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

// The module's tool.call result, in its three shapes: { deny }, { isError,
// result, text } and { result, context? }. Anything else is no answer.
function toolResult(name: string, outcome: unknown): Record<string, unknown> {
  if (isRecord(outcome)) {
    if (typeof outcome.deny === "string") return textResult(outcome.deny, true);
    if (outcome.isError === true) {
      const body = outcome.result !== undefined ? outcome.result : outcome.text;
      return textResult(asText(body ?? `the persona tools server could not serve ${name}`), true);
    }
    if (Object.hasOwn(outcome, "result")) return textResult(asText(outcome.result), false);
  }
  return textResult(`the persona tools server could not serve ${name}: the tool returned no result`, true);
}

export function createToolServer(options: ToolServerOptions): (line: string) => Promise<string | null> {
  const served = new Map(options.tools.map((tool) => [tool.name, tool]));
  const listed = options.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));

  const callTool = async (id: Id, params: Record<string, unknown>): Promise<string> => {
    const name = params.name;
    if (typeof name !== "string" || !served.has(name)) return failure(id, INVALID_PARAMS, `unknown tool: ${typeof name === "string" ? name : String(name)}`);
    const input = params.arguments ?? {};
    if (!isRecord(input)) return failure(id, INVALID_PARAMS, `the arguments of ${name} are not an object`);
    try {
      return reply(id, toolResult(name, await options.call(name, input)));
    } catch (err) {
      return reply(id, textResult(`the persona tools server could not serve ${name}: ${err instanceof Error ? err.message : String(err)}`, true));
    }
  };

  return async (line: string): Promise<string | null> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return failure(null, PARSE_ERROR, "the line is not JSON");
    }
    if (!isRecord(message) || message.jsonrpc !== "2.0") return failure(null, INVALID_REQUEST, "the line is not a JSON-RPC 2.0 message");
    const hasId = Object.hasOwn(message, "id");
    const id = message.id;
    if (hasId && id !== null && typeof id !== "string" && typeof id !== "number") return failure(null, INVALID_REQUEST, "the request id is neither a string nor a number");
    const method = message.method;
    // A reply the client sent to the server, which asks nothing.
    if (method === undefined && hasId && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) return null;
    if (typeof method !== "string") return failure(hasId ? (id as Id) : null, INVALID_REQUEST, "the message names no method");
    // A notification wants no reply, whatever its method.
    if (!hasId) return null;
    const requestId = id as Id;
    const params = message.params === undefined ? {} : message.params;
    if (!isRecord(params)) return failure(requestId, INVALID_PARAMS, "the params are not an object");
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const protocolVersion = typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return reply(requestId, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: options.info });
      }
      case "ping":
        return reply(requestId, {});
      case "tools/list":
        return reply(requestId, { tools: listed });
      case "tools/call":
        return await callTool(requestId, params);
      default:
        return failure(requestId, METHOD_NOT_FOUND, `the method ${method} is not served`);
    }
  };
}
