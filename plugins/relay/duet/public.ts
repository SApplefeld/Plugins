// The public listener, the one route into the host from off the tailnet. It binds loopback and
// nothing else: Tailscale Funnel terminates HTTPS at this node and forwards to the port with the
// caller's address in `X-Forwarded-For`. The gate runs ahead of everything on the paths a machine
// calls, `/mcp`, `/token` and `/register`: the first forwarded address must be an IPv4 inside the
// configured ranges, Anthropic's egress by default, else the request learns an empty 403 and
// nothing of it past the request line and headers is read. The metadata documents and the
// authorization pages are open, since the operator's browser reaches them from anywhere. Past the
// gate the OAuth paths are the authorization server's, `/mcp` requires a live bearer the store
// holds and answers the 401 challenge pointing at the protected-resource metadata without one, and
// an admitted message goes to the SDK's web standard transport through the adapter. Until the tools
// can read the broker, an admitted message answers an empty 503 with `Retry-After`, so the listener
// holds its port from process start while the tailnet address is still awaited. Every other path is
// a 404.
//
// One transport and one server are built per `/mcp` request and closed with its response. The SDK's
// stateless transport is one request's by design, and a single stateful one would refuse the second
// `initialize` a reconnecting client sends, so no session is kept and no session id is issued. A GET
// on `/mcp`, the standalone notification stream, and a DELETE, a session's end, answer 405, which the
// client reads as a server offering neither. A refusal is logged once per address per five minutes,
// as the web listener logs its own, and nothing a header carried reaches the log unless it parsed
// as an address.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { WEB_BIND_RETRY_MS } from "../broker/config.ts";
import type { Logger } from "../broker/log.ts";
import { inRanges, MCP_PATH, parseIPv4 } from "./config.ts";
import type { DuetConfig } from "./config.ts";
import { PROTECTED_RESOURCE_PATH, REGISTER_PATH, TOKEN_PATH } from "./oauth.ts";
import type { OauthHandlers } from "./oauth.ts";
import { createMcpServer } from "./server.ts";
import type { RegisterTools } from "./server.ts";
import type { DuetStore } from "./store.ts";
import { sendWebResponse, toWebRequest } from "./web-adapter.ts";

/** The one address the listener binds; Funnel forwards here and nothing else reaches it from outside. */
export const LOOPBACK = "127.0.0.1";
/** An MCP message is a JSON document of a few kilobytes at most; past this it is not one. */
export const MAX_MCP_BODY_BYTES = 64 * 1024;
/** One refusal line per address per this long; a repeat inside the window is counted, not written. */
export const REFUSAL_WINDOW_MS = 5 * 60_000;
/** The paths a machine calls, which the source range gates; every other path is open to the gate. */
export const GATED_PATHS: readonly string[] = [MCP_PATH, TOKEN_PATH, REGISTER_PATH];
/**
 * The `Retry-After` an admitted message learns while the tools wait: the address wait's own interval
 * in whole seconds, rounded up, since the header takes no fraction.
 */
const NOT_READY_RETRY_AFTER = String(Math.ceil(WEB_BIND_RETRY_MS / 1000));
/** The scope the challenge asks for, the one read scope the authorization server grants by default. */
const READ_SCOPE = "fleet:read";
/** `Bearer <token>`: the scheme in any case, one run of whitespace, the token with no whitespace in it. */
const BEARER = /^Bearer[ \t]+(\S+)$/i;

type RefusalLog = { warn: (reason: string, address: string) => void };

/**
 * Rate-limits refusal logging by address, as the web listener's does: the first refusal from an
 * address is logged at once, a repeat within the window is counted, and the count rides the next
 * line that address earns after its window. No timer, so nothing to clear on shutdown.
 */
function createRefusalLog(log: Logger | undefined, now: () => number): RefusalLog {
  const state = new Map<string, { windowStart: number; suppressed: number }>();
  return {
    warn(reason, address) {
      if (!log) return;
      const at = now();
      const entry = state.get(address);
      if (entry !== undefined && at - entry.windowStart < REFUSAL_WINDOW_MS) {
        entry.suppressed += 1;
        return;
      }
      const earlier =
        entry !== undefined && entry.suppressed > 0
          ? `, refused ${String(entry.suppressed)} more time(s) in the ${String(REFUSAL_WINDOW_MS)}ms before`
          : "";
      log.warn(`duet public refused: ${reason} (remote=${address}${earlier})`);
      state.delete(address);
      state.set(address, { windowStart: at, suppressed: 0 });
      if (state.size > 1_024) {
        const oldest = state.keys().next().value;
        if (oldest !== undefined) state.delete(oldest);
      }
    },
  };
}

/**
 * A status and nothing else: a refused request learns the number and no reason. The answer closes
 * the connection, so Node ends the socket with the response instead of draining an unread body.
 */
function empty(response: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-length": 0, connection: "close", ...headers });
  response.end();
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The caller's address as Funnel reports it: the first entry of `X-Forwarded-For`, trimmed. Null
 * for no header, an empty one or an empty first entry. Nothing is parsed here; the range check is
 * the configuration's `inRanges`, which admits only a dotted-quad IPv4 inside a range.
 */
function forwardedFor(request: IncomingMessage): string | null {
  const value = header(request, "x-forwarded-for");
  if (value === null) return null;
  const first = value.split(",")[0].trim();
  return first === "" ? null : first;
}

export type PublicHandlerOptions = {
  config: Pick<DuetConfig, "port" | "publicUrl" | "mcpUrl" | "clientRanges">;
  /** The authorization server's paths. */
  oauth: Pick<OauthHandlers, "handle">;
  /** Where a bearer is looked up. */
  store: Pick<DuetStore, "bearer">;
  /** Puts the tools on each request's server. */
  register: RegisterTools;
  /**
   * Whether the tools can read the broker yet; until it holds, an admitted `/mcp` message answers
   * 503. Absent, the tools are ready from the start.
   */
  ready?: () => boolean;
  /** Where a refusal becomes visible. Optional, as the web listener's is. */
  log?: Logger;
  /** Drives the refusal log's window. Injected so a test moves it without sleeping. */
  now?: () => number;
};

export type PublicHandler = {
  handle: (request: IncomingMessage, response: ServerResponse) => void;
};

/** The gate and the routes, apart from the socket so a test drives them on any listener. */
export function createPublicHandler(options: PublicHandlerOptions): PublicHandler {
  const { config, oauth, store, register } = options;
  const ready = options.ready ?? ((): boolean => true);
  const now = options.now ?? Date.now;
  const refusals = createRefusalLog(options.log, now);
  const challenge = `Bearer resource_metadata="${config.publicUrl}${PROTECTED_RESOURCE_PATH}", scope="${READ_SCOPE}"`;

  /**
   * The source range gate: true where the first forwarded address is inside a configured range.
   * A refusal is logged under the forwarded address where it parsed as one, since every socket
   * peer is Funnel on loopback, and under the socket's peer otherwise, so no unparsed header text
   * reaches the log.
   */
  function admitted(request: IncomingMessage): boolean {
    const address = forwardedFor(request);
    if (address !== null && inRanges(address, config.clientRanges)) return true;
    const logged = address !== null && parseIPv4(address) !== null ? address : (request.socket.remoteAddress ?? "none");
    refusals.warn(address === null ? "no forwarded address" : "forwarded address is outside the client ranges", logged);
    return false;
  }

  /** The live bearer's claims, or null for no `Authorization`, another scheme, or a token the store does not hold. */
  function bearer(request: IncomingMessage): { clientId: string; scope: string } | null {
    const value = header(request, "authorization");
    if (value === null) return null;
    const match = BEARER.exec(value);
    if (match === null) return null;
    return store.bearer(match[1]);
  }

  /**
   * One MCP message: a fresh stateless transport and server for the request alone, the answer
   * streamed to the socket, and both closed once the response has ended whichever way it did.
   */
  async function mcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      request.resume();
      empty(response, 405, { allow: "POST" });
      return;
    }
    const web = await toWebRequest(request, { url: config.mcpUrl, ceiling: MAX_MCP_BODY_BYTES });
    if (web === null) {
      // A client gone, or a socket the body ceiling destroyed, has no one to read the 413.
      if (!request.destroyed && response.writable) empty(response, 413);
      return;
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      maxRequestBodySize: MAX_MCP_BODY_BYTES,
    });
    const server = createMcpServer(register);
    try {
      await server.connect(transport);
      const answer = await transport.handleRequest(web);
      await sendWebResponse(response, answer);
    } finally {
      // Closing the server closes its transport, and with it any stream still open.
      await server.close().catch(() => {});
    }
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = (request.url ?? "/").split("?")[0];
    // The gate first, before anything else of the request is read, on the paths a machine calls.
    if (GATED_PATHS.includes(pathname) && !admitted(request)) {
      request.resume();
      empty(response, 403);
      return;
    }
    if (pathname === MCP_PATH) {
      if (bearer(request) === null) {
        request.resume();
        empty(response, 401, { "www-authenticate": challenge });
        return;
      }
      if (!ready()) {
        request.resume();
        empty(response, 503, { "retry-after": NOT_READY_RETRY_AFTER });
        return;
      }
      await mcp(request, response);
      return;
    }
    if (await oauth.handle(request, response)) return;
    request.resume();
    empty(response, 404);
  }

  return {
    handle(request, response) {
      void route(request, response).catch(() => {
        // The error is discarded, not stringified: a thrown error can quote what it was reading.
        options.log?.warn(`duet public request failed (remote=${request.socket.remoteAddress ?? "none"})`);
        if (!response.headersSent) empty(response, 500);
        else response.end();
      });
    },
  };
}

export type PublicServer = {
  server: Server;
  /** Binds `127.0.0.1:<port>` and resolves with the port bound; rejects as the socket does. */
  listen: () => Promise<number>;
  /** Closes the listener; a server that never listened closes the same way, without a throw. */
  close: () => Promise<void>;
};

/** The handler on its own `http.Server`, bound to loopback on the configured port and nowhere else. */
export function createPublicServer(options: PublicHandlerOptions): PublicServer {
  const handler = createPublicHandler(options);
  const server = createServer(handler.handle);
  let binding = false;
  server.on("error", (error) => {
    if (!binding) options.log?.error(`duet: public server error: ${String(error)}`);
  });
  return {
    server,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        const failedToBind = (error: Error): void => {
          binding = false;
          server.removeListener("listening", boundHere);
          reject(error);
        };
        const boundHere = (): void => {
          binding = false;
          server.removeListener("error", failedToBind);
          const address = server.address();
          resolve(typeof address === "object" && address !== null ? address.port : options.config.port);
        };
        binding = true;
        server.once("error", failedToBind);
        server.once("listening", boundHere);
        server.listen(options.config.port, LOOPBACK);
      }),
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
