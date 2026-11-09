// The authorization server, on Node's `http` and nothing else: the two metadata documents, dynamic
// client registration, the authorization page and its poll, and the token endpoint. The handlers
// are exported apart from any socket, since the public listener owns the socket and the source
// range gate and hands these paths here. Nothing on this surface issues a credential until the
// operator has approved the sign-in on the tailnet page: `/authorize` holds the request and shows a
// six-character code, and the browser's own poll, under a request id only it holds, learns of the
// approval and is sent back with the one authorization code. The pages carry no script, so the
// content security policy admits none, and every value a page draws is escaped at the draw.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DuetConfig } from "./config.ts";
import { MAX_PENDING, PENDING_TTL_MS } from "./store.ts";
import type { DuetStore, PendingView } from "./store.ts";

/** The scopes this server grants, the one read scope and the refresh token's. */
export const SCOPES: readonly string[] = ["fleet:read", "offline_access"];
const DEFAULT_SCOPE = "fleet:read";

export const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const REGISTER_PATH = "/register";
export const AUTHORIZE_PATH = "/authorize";
export const AUTHORIZE_STATUS_PATH = "/authorize/status";
export const TOKEN_PATH = "/token";

/** A registration or a token request is a few hundred bytes; past this it is not one. */
export const MAX_BODY_BYTES = 4 * 1024;
/** Past this multiple of the ceiling the connection is cut instead of drained, as the broker's readers do. */
const DRAIN_LIMIT_FACTOR = 4;
/** How often the page asks whether the operator has approved, in seconds. */
const POLL_SECONDS = 3;

/** A PKCE verifier as RFC 7636 bounds it: 43 to 128 unreserved characters. */
const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** An S256 challenge: the base64url of 32 bytes, 43 characters with no padding. */
const CODE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;
/** A client id as the store mints one: 16 bytes in hex. */
const CLIENT_ID = /^[0-9a-f]{32}$/;
/** A request id as the store mints one: 16 bytes in hex. */
const REQUEST_ID = /^[0-9a-f]{32}$/;
/** The longest `state` carried; a client's state is a short opaque value. */
const MAX_STATE_LENGTH = 512;
/** The longest redirect URI a registration may send; the allowlist's entries are far shorter. */
const MAX_REDIRECT_URI_LENGTH = 2_048;

/**
 * No script, no style but the page's own, nothing fetched, no form posted anywhere and no framing:
 * the two pages are read-only text, and a string that reached the markup unescaped could still do
 * nothing with it.
 */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

/** HTML-escapes a value for text content or a double-quoted attribute. Shared with the approval page. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The whole body up to `ceiling` bytes, or null where it runs over, fails or the request closes
 * first. The read stops keeping bytes at the ceiling and the connection is destroyed at four times
 * it, so an oversized post costs at most the ceiling in memory. Shared with the approval page's POST.
 */
export function readBody(request: IncomingMessage, ceiling: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (value: Buffer | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > ceiling) {
        chunks.length = 0;
        if (size > ceiling * DRAIN_LIMIT_FACTOR) {
          request.destroy();
          settle(null);
        }
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", () => settle(null));
    request.on("close", () => settle(null));
    request.on("end", () => settle(size > ceiling ? null : Buffer.concat(chunks)));
  });
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** The media type of a request body, lower-cased and without parameters, or null for none. */
function mediaType(request: IncomingMessage): string | null {
  const type = header(request, "content-type");
  return type === null ? null : type.split(";")[0].trim().toLowerCase();
}

/** The one value a query or form key holds, or null where it is absent, empty or given more than once. */
function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length !== 1 || values[0] === "") return null;
  return values[0];
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

/** An OAuth error answer, as RFC 6749 shapes it: the code and nothing of what was read. */
function sendError(response: ServerResponse, status: number, error: string): void {
  sendJson(response, status, { error });
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    "content-security-policy": PAGE_CSP,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(html);
}

/** A status and nothing else: a refused request learns the number and no reason. */
function empty(response: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-length": 0, ...headers });
  response.end();
}

const PAGE_STYLE =
  "body{font:16px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:36rem;padding:0 1rem;color:#222}" +
  "code{font:700 2rem/1 ui-monospace,monospace;letter-spacing:.2em;display:inline-block;padding:.5rem .75rem;" +
  "border:1px solid #888;border-radius:.5rem}h1{font-size:1.4rem}";

function page(title: string, body: string, refreshTo: string | null): string {
  const refresh = refreshTo === null ? "" : `<meta http-equiv="refresh" content="${String(POLL_SECONDS)}; url=${escapeHtml(refreshTo)}">`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>${refresh}<style>${PAGE_STYLE}</style></head><body>${body}</body></html>`
  );
}

/**
 * The waiting page: who asks, where the browser goes after, the scopes, the code the operator types,
 * and the instruction to approve it on the fleet's approval page. That page's address is not here,
 * since this page is public and a tailnet address is not for it.
 */
function waitingPage(pending: PendingView, requestId: string): string {
  const client = pending.clientName ?? pending.clientId;
  const minutes = String(PENDING_TTL_MS / 60_000);
  const body =
    `<h1>A sign-in is waiting for the fleet's operator</h1>` +
    `<p><strong>${escapeHtml(client)}</strong> asks to read the fleet. Once approved, this browser is sent ` +
    `back to <strong>${escapeHtml(pending.redirectHost)}</strong>.</p>` +
    `<p>Scopes: ${escapeHtml(pending.scope)}</p>` +
    `<p>Approval code</p><p><code>${escapeHtml(pending.approvalCode)}</code></p>` +
    `<p>Approve this code on the fleet's approval page. This page checks every few seconds and carries ` +
    `on by itself once the code is approved. An unapproved request is gone after ${minutes} minutes.</p>`;
  return page("Approve a sign-in", body, `${AUTHORIZE_STATUS_PATH}?request=${requestId}`);
}

function gonePage(): string {
  const body =
    `<h1>This sign-in is no longer waiting</h1>` +
    `<p>It was completed already, or it was not approved within ${String(PENDING_TTL_MS / 60_000)} minutes and ` +
    `has been dropped. Start the connection again from the client.</p>`;
  return page("Sign-in not waiting", body, null);
}

function refusedPage(): string {
  return page("Request refused", `<h1>This authorization request cannot be served</h1><p>It is missing something the server requires, or names a client or a return address it does not know.</p>`, null);
}

function busyPage(): string {
  return page(
    "Too many sign-ins waiting",
    `<h1>Too many sign-ins are waiting</h1><p>The operator has ${String(MAX_PENDING)} unapproved requests already. Try again in a few minutes.</p>`,
    null,
  );
}

export type OauthOptions = {
  config: Pick<DuetConfig, "publicUrl" | "mcpUrl" | "redirectUris">;
  store: DuetStore;
};

export type OauthHandlers = {
  /**
   * Answers a request on one of this module's paths and resolves true; resolves false, having
   * written nothing, for any other path, which is the listener's to answer.
   */
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  /** The authorization server metadata, as `GET /.well-known/oauth-authorization-server` answers it. */
  authorizationServerMetadata(): Record<string, unknown>;
  /** The protected resource metadata, as `GET /.well-known/oauth-protected-resource` answers it. */
  protectedResourceMetadata(): Record<string, unknown>;
};

export function createOauthHandlers(options: OauthOptions): OauthHandlers {
  const { config, store } = options;
  const allowlist = new Set(config.redirectUris);

  function authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: config.publicUrl,
      authorization_endpoint: `${config.publicUrl}${AUTHORIZE_PATH}`,
      token_endpoint: `${config.publicUrl}${TOKEN_PATH}`,
      registration_endpoint: `${config.publicUrl}${REGISTER_PATH}`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...SCOPES],
    };
  }

  function protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: config.mcpUrl,
      authorization_servers: [config.publicUrl],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ["header"],
    };
  }

  /**
   * Registration: a JSON object whose `redirect_uris` is a non-empty array of strings every one of
   * which the allowlist holds, so a client can only ever be sent back to a callback the operator
   * configured. A client asking for an authentication method other than `none` is refused, since
   * this server issues no client secret. The name is kept for the approval pages, cut and escaped there.
   */
  async function register(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      request.resume();
      empty(response, 405, { allow: "POST" });
      return;
    }
    if (mediaType(request) !== "application/json") {
      request.resume();
      sendError(response, 415, "invalid_client_metadata");
      return;
    }
    const body = await readBody(request, MAX_BODY_BYTES);
    if (body === null) {
      sendError(response, 400, "invalid_client_metadata");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      sendError(response, 400, "invalid_client_metadata");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      sendError(response, 400, "invalid_client_metadata");
      return;
    }
    const fields = parsed as Record<string, unknown>;
    const uris = fields.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0) {
      sendError(response, 400, "invalid_redirect_uri");
      return;
    }
    for (const uri of uris) {
      if (typeof uri !== "string" || uri.length > MAX_REDIRECT_URI_LENGTH || !allowlist.has(uri)) {
        sendError(response, 400, "invalid_redirect_uri");
        return;
      }
    }
    const method = fields.token_endpoint_auth_method;
    if (method !== undefined && method !== "none") {
      sendError(response, 400, "invalid_client_metadata");
      return;
    }
    const name = typeof fields.client_name === "string" && fields.client_name.trim() !== "" ? fields.client_name.trim() : null;
    const client = store.registerClient(uris as string[], name);
    if (client === null) {
      // Every held registration holds a live refresh token, and none is dropped for a newcomer.
      // RFC 7591 names no capacity error, so the metadata error carries a description the client reads.
      sendJson(response, 400, {
        error: "invalid_client_metadata",
        error_description: "the server holds its most registrations, each signed in; none is dropped for a new one",
      });
      return;
    }
    sendJson(response, 201, {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      client_name: client.name ?? undefined,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  }

  /**
   * The scope a request asks for, or null where it names one this server does not grant or leaves
   * out the read scope, since a token without it could read nothing. An absent scope is the read scope.
   */
  function grantedScope(raw: string | null): string | null {
    if (raw === null) return DEFAULT_SCOPE;
    const asked = raw.split(" ").filter((word) => word !== "");
    if (asked.length === 0) return DEFAULT_SCOPE;
    if (asked.some((word) => !SCOPES.includes(word))) return null;
    if (!asked.includes(DEFAULT_SCOPE)) return null;
    return [...new Set(asked)].join(" ");
  }

  /**
   * The authorization request. Every rule refuses with a 400 page and holds nothing, the redirect
   * URI's own validity included: an error sent to a redirect URI is a redirect this server did not
   * verify, and a client that sent a bad request learns so from the page. The client's id and
   * redirect URI are checked before anything else is read, so an unregistered client holds no slot.
   */
  function authorize(request: IncomingMessage, response: ServerResponse): void {
    request.resume();
    if (request.method !== "GET") {
      empty(response, 405, { allow: "GET" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://duet");
    const params = url.searchParams;
    const refuse = (): void => sendHtml(response, 400, refusedPage());

    if (single(params, "response_type") !== "code") return refuse();
    const clientId = single(params, "client_id");
    if (clientId === null || !CLIENT_ID.test(clientId)) return refuse();
    const client = store.client(clientId);
    if (client === null) return refuse();
    const redirectUri = single(params, "redirect_uri");
    if (redirectUri === null || !client.redirectUris.includes(redirectUri) || !allowlist.has(redirectUri)) return refuse();
    const challenge = single(params, "code_challenge");
    if (challenge === null || !CODE_CHALLENGE.test(challenge)) return refuse();
    if (single(params, "code_challenge_method") !== "S256") return refuse();
    const state = single(params, "state");
    if (state === null || state.length > MAX_STATE_LENGTH) return refuse();
    if (single(params, "resource") !== config.mcpUrl) return refuse();
    const scope = grantedScope(single(params, "scope"));
    if (scope === null) return refuse();

    const held = store.addPending({ clientId, redirectUri, codeChallenge: challenge, state, scope });
    if (held === null) {
      sendHtml(response, 429, busyPage());
      return;
    }
    const polled = store.poll(held.requestId);
    if (polled.status !== "waiting") {
      // A request this call just held cannot be anything but waiting; an answer that says
      // otherwise is a defect, and the page is refused rather than drawn from nothing.
      sendHtml(response, 500, refusedPage());
      return;
    }
    sendHtml(response, 200, waitingPage(polled.pending, held.requestId));
  }

  /**
   * The page's poll. While the operator has not approved, the waiting page is drawn again with a
   * refresh to itself; once approved, the browser is sent to the redirect URI with the one code and
   * the state, and the request is gone; a request id the store does not hold is told so.
   */
  function authorizeStatus(request: IncomingMessage, response: ServerResponse): void {
    request.resume();
    if (request.method !== "GET") {
      empty(response, 405, { allow: "GET" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://duet");
    const requestId = single(url.searchParams, "request");
    if (requestId === null || !REQUEST_ID.test(requestId)) {
      sendHtml(response, 400, refusedPage());
      return;
    }
    const polled = store.poll(requestId);
    if (polled.status === "unknown") {
      sendHtml(response, 410, gonePage());
      return;
    }
    if (polled.status === "waiting") {
      sendHtml(response, 200, waitingPage(polled.pending, requestId));
      return;
    }
    const target = new URL(polled.redirectUri);
    target.searchParams.set("code", polled.code);
    target.searchParams.set("state", polled.state);
    response.writeHead(302, {
      location: target.toString(),
      "content-length": 0,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    response.end();
  }

  /**
   * The token endpoint, form-encoded and public-client only. An authorization code is exchanged
   * once against its client, its redirect URI and the PKCE verifier; a refresh token is rotated,
   * the old one dead in the same exchange. Any mismatch, replay or expiry is `invalid_grant`, with
   * nothing said about which. Nothing here calls out, so the answer is as fast as the store.
   */
  async function token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      request.resume();
      empty(response, 405, { allow: "POST" });
      return;
    }
    if (mediaType(request) !== "application/x-www-form-urlencoded") {
      request.resume();
      sendError(response, 415, "invalid_request");
      return;
    }
    const body = await readBody(request, MAX_BODY_BYTES);
    if (body === null) {
      sendError(response, 400, "invalid_request");
      return;
    }
    const form = new URLSearchParams(body.toString("utf8"));
    const clientId = single(form, "client_id");
    if (clientId === null || !CLIENT_ID.test(clientId) || store.client(clientId) === null) {
      sendError(response, 401, "invalid_client");
      return;
    }
    const grant = single(form, "grant_type");
    if (grant === "authorization_code") {
      const code = single(form, "code");
      const redirectUri = single(form, "redirect_uri");
      const verifier = single(form, "code_verifier");
      if (code === null || redirectUri === null || verifier === null) {
        sendError(response, 400, "invalid_request");
        return;
      }
      if (!CODE_VERIFIER.test(verifier)) {
        sendError(response, 400, "invalid_grant");
        return;
      }
      const redeemed = store.redeemCode(code, clientId, redirectUri, verifier);
      if (redeemed === null) {
        sendError(response, 400, "invalid_grant");
        return;
      }
      const issued = store.issueTokens(clientId, redeemed.scope);
      sendJson(response, 200, {
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: issued.scope,
      });
      return;
    }
    if (grant === "refresh_token") {
      const refreshToken = single(form, "refresh_token");
      if (refreshToken === null) {
        sendError(response, 400, "invalid_request");
        return;
      }
      const issued = store.refresh(refreshToken, clientId);
      if (issued === null) {
        sendError(response, 400, "invalid_grant");
        return;
      }
      sendJson(response, 200, {
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        scope: issued.scope,
      });
      return;
    }
    sendError(response, 400, grant === null ? "invalid_request" : "unsupported_grant_type");
  }

  function metadata(request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>): void {
    request.resume();
    if (request.method !== "GET") {
      empty(response, 405, { allow: "GET" });
      return;
    }
    sendJson(response, 200, body);
  }

  return {
    authorizationServerMetadata,
    protectedResourceMetadata,
    async handle(request, response) {
      const pathname = (request.url ?? "/").split("?")[0];
      switch (pathname) {
        case AUTHORIZATION_SERVER_PATH:
          metadata(request, response, authorizationServerMetadata());
          return true;
        case PROTECTED_RESOURCE_PATH:
          metadata(request, response, protectedResourceMetadata());
          return true;
        case REGISTER_PATH:
          await register(request, response);
          return true;
        case AUTHORIZE_PATH:
          authorize(request, response);
          return true;
        case AUTHORIZE_STATUS_PATH:
          authorizeStatus(request, response);
          return true;
        case TOKEN_PATH:
          await token(request, response);
          return true;
        default:
          return false;
      }
    },
  };
}
