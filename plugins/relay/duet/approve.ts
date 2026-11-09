// The approval listener: the one place a sign-in to the Duet server is approved, bound to the
// broker's tailnet address and to no other, and gated as the broker's web surface is gated. The
// four checks are the web listener's own, rewritten here because `broker/web/server.ts` exports no
// gate: an exact `Host`, the peer named by `tailscale whois` through the shared identity, the login
// on the operator list and the node on the device list, and the same-origin headers on a POST. The
// web listener's refusal of its operator-word routes to the host's own node holds here too, on both
// routes. A request that fails any of them learns a status and nothing else. `GET /approve` lists the sign-ins
// waiting, each with its code, and `POST /approve` with a typed code approves one. The page has no
// script, and every value it draws is escaped at the draw.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "../broker/log.ts";
import type { TailnetPeer, WebIdentity } from "../broker/web/identity.ts";
import type { ApproveConfig } from "./config.ts";
import { escapeHtml, readBody } from "./oauth.ts";
import { APPROVAL_CODE_LENGTH, PENDING_TTL_MS } from "./store.ts";
import type { DuetStore, PendingView } from "./store.ts";

export const APPROVE_PATH = "/approve";
/** A typed code is six characters; a form carrying more is not the page's. */
const MAX_APPROVE_BODY_BYTES = 1024;
/** One refusal line per address per this long; a repeat inside the window is counted, not written. */
export const REFUSAL_WINDOW_MS = 5 * 60_000;
/** The shape a typed approval code is held to before the store sees it. */
const APPROVAL_CODE = new RegExp(`^[A-Za-z0-9]{${String(APPROVAL_CODE_LENGTH)}}$`);

/**
 * No script, the page's own style alone, a form posted to this origin alone and no framing: the
 * page carries a tap that approves a sign-in, and a frame is how a tap is stolen.
 */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

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
      log.warn(`duet approve refused: ${reason} (remote=${address}${earlier})`);
      state.delete(address);
      state.set(address, { windowStart: at, suppressed: 0 });
      if (state.size > 1_024) {
        const oldest = state.keys().next().value;
        if (oldest !== undefined) state.delete(oldest);
      }
    },
  };
}

/** A status and nothing else: a refused request learns the number and no reason. */
function empty(response: ServerResponse, status: number): void {
  response.writeHead(status, { "content-length": 0 });
  response.end();
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    "content-security-policy": PAGE_CSP,
    // same-origin, not no-referrer: the page is plain HTTP, so its form POST carries no Sec-Fetch-Site,
    // and under no-referrer a browser sends Origin: null, which the POST rule refuses.
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(html);
}

const PAGE_STYLE =
  "body{font:16px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:36rem;padding:0 1rem;color:#222}" +
  "h1{font-size:1.4rem}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.4rem .5rem;" +
  "border-bottom:1px solid #ccc}code{font:700 1.2rem ui-monospace,monospace;letter-spacing:.15em}" +
  "input{font:inherit;padding:.4rem;min-height:44px}button{font:inherit;padding:.4rem 1rem;min-height:44px}";

function page(title: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`
  );
}

/** An age as the list draws it: whole minutes, or seconds under one. */
function ageLabel(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  return `${String(Math.floor(seconds / 60))}m ago`;
}

function listPage(pending: readonly PendingView[], notice: string | null): string {
  const rows = pending
    .map(
      (row) =>
        `<tr><td><code>${escapeHtml(row.approvalCode)}</code></td><td>${escapeHtml(row.clientName ?? row.clientId)}</td>` +
        `<td>${escapeHtml(row.redirectHost)}</td><td>${escapeHtml(ageLabel(row.ageMs))}</td>` +
        `<td>${row.approved ? "approved" : "waiting"}</td></tr>`,
    )
    .join("");
  const table =
    pending.length === 0
      ? `<p>No sign-in is waiting.</p>`
      : `<table><thead><tr><th>Code</th><th>Client</th><th>Returns to</th><th>Age</th><th>State</th></tr></thead><tbody>${rows}</tbody></table>`;
  const body =
    `<h1>Duet sign-ins waiting for approval</h1>` +
    (notice === null ? "" : `<p><strong>${escapeHtml(notice)}</strong></p>`) +
    table +
    `<p>Type the code the public page shows, and approve only a sign-in you started yourself. An unapproved request is gone after ${String(PENDING_TTL_MS / 60_000)} minutes.</p>` +
    `<form method="post" action="${APPROVE_PATH}"><label>Approval code <input name="code" autocomplete="off" ` +
    `autocapitalize="characters" maxlength="${String(APPROVAL_CODE_LENGTH)}" pattern="[A-Za-z0-9]{${String(APPROVAL_CODE_LENGTH)}}" required></label> ` +
    `<button type="submit">Approve</button></form>`;
  return page("Duet approvals", body);
}

export type ApproveHandlerOptions = {
  config: ApproveConfig;
  identity: WebIdentity;
  store: DuetStore;
  /** Where a refusal becomes visible. Optional, as the web listener's is. */
  log?: Logger;
  /** Drives the refusal log's window. Injected so a test moves it without sleeping. */
  now?: () => number;
};

export type ApproveHandler = {
  handle: (request: IncomingMessage, response: ServerResponse) => void;
  /** Sets the address the listener is bound to, which the Host and Origin checks read from then on. */
  bound: (address: string) => void;
};

/** The gate and the two routes, apart from the socket so a test drives them on any listener. */
export function createApproveHandler(options: ApproveHandlerOptions): ApproveHandler {
  const { config, identity, store } = options;
  const now = options.now ?? Date.now;
  const refusals = createRefusalLog(options.log, now);
  let bind = config.bind;

  /** The login and node against the lists, lower-cased to match the lists' own form. */
  function admitted(peer: TailnetPeer): boolean {
    if (!config.operators.includes(peer.login.toLowerCase())) return false;
    if (config.devices === null) return true;
    return config.devices.includes(peer.node.toLowerCase());
  }

  /**
   * Whether `peer` is on the broker host's own tailnet node, or that cannot be told, as the web
   * listener's check of the same name reads it. The host's node is the identity's answer for the
   * bound address, the host's own tailnet address. A bind not yet resolved, or a resolver that
   * answers nothing or throws, leaves the host unknown, and unknown reads as the host's: both routes
   * here carry the operator's word, so they run only for a peer shown to be another node.
   */
  async function onHostNode(peer: TailnetPeer): Promise<boolean> {
    const address = bind;
    if (address === null) return true;
    let host: TailnetPeer | null = null;
    try {
      host = await identity.peerFor(address);
    } catch {
      host = null;
    }
    return host === null || host.node.toLowerCase() === peer.node.toLowerCase();
  }

  async function approvePost(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request, MAX_APPROVE_BODY_BYTES);
    if (body === null) {
      sendHtml(response, 400, listPage(store.pendingList(), "The form was not read. Try again."));
      return;
    }
    const codes = new URLSearchParams(body.toString("utf8")).getAll("code");
    const code = codes.length === 1 ? codes[0].trim() : "";
    if (!APPROVAL_CODE.test(code)) {
      sendHtml(response, 400, listPage(store.pendingList(), "A code is six letters and digits."));
      return;
    }
    if (!store.approve(code)) {
      sendHtml(response, 404, listPage(store.pendingList(), "No sign-in is waiting under that code."));
      return;
    }
    sendHtml(response, 200, listPage(store.pendingList(), `Approved ${code.toUpperCase()}. The sign-in page carries on by itself.`));
  }

  async function gate(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const address = request.socket.remoteAddress ?? "none";

    // Exact, port included: this listener answers to one name, and a page that reached it under
    // any other was not served by it.
    const expectedHost = bind === null ? null : `${bind}:${String(config.port)}`.toLowerCase();
    const host = header(request, "host");
    if (host === null || expectedHost === null || host.toLowerCase() !== expectedHost) {
      request.resume();
      refusals.warn("Host header is not this listener's", address);
      empty(response, 400);
      return;
    }

    // Any failure inside the resolver is a refusal: an identity miss that admits and one that
    // crashes are the two outcomes this surface cannot have.
    let peer: TailnetPeer | null = null;
    try {
      peer = await identity.peerFor(address);
    } catch {
      peer = null;
    }
    if (peer === null) {
      request.resume();
      refusals.warn("peer address is not a tailnet identity", address);
      empty(response, 403);
      return;
    }
    if (!admitted(peer)) {
      // The address alone: the login and node are the peer's own identifiers and stay out of the line.
      request.resume();
      refusals.warn("peer is not an admitted operator on an admitted device", address);
      empty(response, 403);
      return;
    }

    const pathname = (request.url ?? "/").split("?")[0];
    if (pathname !== APPROVE_PATH) {
      request.resume();
      empty(response, 404);
      return;
    }

    // The list shows every waiting code and the POST approves one, so any process on the host
    // could otherwise approve a sign-in under the operator's login.
    if (await onHostNode(peer)) {
      // The address alone, as above: the host's node and login are the operator's own.
      request.resume();
      refusals.warn("approval route refused to the broker host's own node, or the host's node is unknown", address);
      empty(response, 403);
      return;
    }

    if (request.method === "GET") {
      request.resume();
      sendHtml(response, 200, listPage(store.pendingList(), null));
      return;
    }
    if (request.method !== "POST") {
      request.resume();
      empty(response, 405);
      return;
    }

    // Sec-Fetch-Site decides where it is sent; Origin is read only where it is absent, so a
    // cross-site POST is refused whatever Origin it names. The body is the page's own form, no other type.
    const site = header(request, "sec-fetch-site");
    const origin = header(request, "origin");
    const fromThisOrigin =
      site === null ? origin?.toLowerCase() === `http://${expectedHost}` : site.toLowerCase() === "same-origin";
    const type = header(request, "content-type");
    const media = type === null ? null : type.split(";")[0].trim().toLowerCase();
    if (!fromThisOrigin || media !== "application/x-www-form-urlencoded") {
      request.resume();
      refusals.warn("POST without the same-origin form headers", address);
      empty(response, 403);
      return;
    }
    await approvePost(request, response);
  }

  return {
    handle(request, response) {
      void gate(request, response).catch(() => {
        // The error is discarded, not stringified: a thrown error can quote what it was reading.
        options.log?.warn(`duet approve request failed (remote=${request.socket.remoteAddress ?? "none"})`);
        if (!response.headersSent) empty(response, 500);
        else response.end();
      });
    },
    bound(address) {
      bind = address;
    },
  };
}

export type ApproveServer = {
  server: Server;
  /** Binds `<bind>:<port>` and resolves with the port bound; rejects as the socket does. */
  listen: (bind: string) => Promise<number>;
  /** Closes the listener; a server that never listened closes the same way, without a throw. */
  close: () => Promise<void>;
};

/** The handler on its own `http.Server`, bound where the configuration says and nowhere else. */
export function createApproveServer(options: ApproveHandlerOptions): ApproveServer {
  const handler = createApproveHandler(options);
  const server = createServer(handler.handle);
  let binding = false;
  server.on("error", (error) => {
    if (!binding) options.log?.error(`duet: approve server error: ${String(error)}`);
  });
  return {
    server,
    listen: (bind) =>
      new Promise<number>((resolve, reject) => {
        const failedToBind = (error: Error): void => {
          binding = false;
          server.removeListener("listening", boundHere);
          reject(error);
        };
        const boundHere = (): void => {
          binding = false;
          server.removeListener("error", failedToBind);
          handler.bound(bind);
          const address = server.address();
          resolve(typeof address === "object" && address !== null ? address.port : options.config.port);
        };
        binding = true;
        server.once("error", failedToBind);
        server.once("listening", boundHere);
        server.listen(options.config.port, bind);
      }),
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
