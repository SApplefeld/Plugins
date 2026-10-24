// The web surface's listener: the second http.Server the broker runs, bound to a tailnet address
// and serving the operator's pages and the `/web/*` JSON from one origin. It never registers
// `/hook`, `/mirror`, `/sessions` or `/relay/*`; those are the loopback intake's, which stays
// bound to 127.0.0.1 alone and is not touched by anything here.
//
// Every request runs the same gate, in order, before any route is looked at:
//
//   1. the Host header must be exactly `<bind>:<port>`, else 400. The page uses no cookies and the
//      identity is the network's, so the cross-site risk left is a page on another origin that
//      reaches this listener; the Host check is where that origin's name survives.
//   2. the peer address is resolved through `WebIdentity` and must name a login in the operator
//      list and, where a device list is set, a node on it, else 403.
//   3. a request to the path of a route registered as carrying the operator's word, whatever its
//      method, refuses a peer on the broker host's own tailnet node, whatever the device list says,
//      else 403. The refusal runs ahead of the method and existence checks below, so a GET on such a
//      path from the host's node answers 403 and never 405. The host's node is the identity's
//      answer for the listener's bound address, and where that answer is missing the route is
//      refused too. A process on the host, another account's included, reaches this listener as
//      the host's node under the host's login and can set any header it likes, so the device list
//      and the headers below cannot tell it from the operator's browser; its node can. A read-only
//      route is not checked here, so the page still reads from the host.
//   4. a POST must come from this origin and carry `Content-Type: application/json`, else 403.
//      From this origin means `Sec-Fetch-Site: same-origin`, or, where that header is absent,
//      `Origin` equal to `http://<bind>:<port>`. A browser sends Sec-Fetch-Site only to an HTTPS or
//      localhost origin, and this listener is plain HTTP on a tailnet address, so its own pages
//      arrive with Origin alone. A browser sets both headers itself, a page cannot forge either,
//      and a form post cannot set the JSON type. The one exception is a route registered to take an
//      octet-stream body, the page's file upload: it must come from this origin the same way, else
//      403, and carry `Content-Type: application/octet-stream` and no other, else 415. A form post
//      cannot set that type either, and a cross-origin fetch with it needs a preflight, as JSON does.
//
// A refused request answers with an empty body whatever the reason, so nothing about the lists
// or the resolver leaks to whoever was refused. Nothing from a header reaches the log: a refusal
// line carries the socket's own peer address and a fixed reason.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { MAX_ASKS_PER_LIST, MAX_ASK_FIELD_LENGTH } from "../decisions/ledger.ts";
import type { Logger } from "../log.ts";
import { foldRootName } from "./config.ts";
import type { WebConfig } from "./config.ts";
import type { TailnetPeer, WebIdentity } from "./identity.ts";
import { summaryView } from "./summary.ts";
import { lineageKnown, talkView } from "./talk.ts";
import type { TalkRing, TalkViewInput } from "./talk.ts";
import type { WebFiles } from "../routing/attachments.ts";
import type { WebAnswerStatus, WebDeliveryStatus } from "../routing/inbound.ts";
import { CLIENT_PREFIX } from "./rollout.ts";
import type { RolloutMark, RolloutReader } from "./rollout.ts";
import { liveByLineage } from "../registry.ts";
import type { SessionRecord } from "../registry.ts";
import type { QuestionDesk, QuestionEntryView } from "../question-desk.ts";
import { answerableFromThread } from "../discord/question-message.ts";
import type { Verdict } from "../security/permission.ts";
import { healthView, needsMeView, planView, repoView, rootName, standupView } from "./views.ts";
import type { Readings } from "./views.ts";
import type { WatermarkStore } from "./watermarks.ts";

/**
 * A `/web/<name>` handler, run after the gate; it owns its own body read and its own response. `peer`
 * is the identity the gate admitted for this request, the only login a route may act for: a route
 * that needs the operator's name reads it here and never from a header or the body.
 */
export type WebRouteHandler = (request: IncomingMessage, response: ServerResponse, peer: TailnetPeer) => void | Promise<void>;

/**
 * What a route is registered as. `operatorWord` is stated at every registration, so no route takes
 * the host's node by leaving it out. A route carrying the operator's word, one that hands a line, an
 * answer, a verdict or a file into a session as the operator's, is registered `true` and is refused
 * to the broker host's own node by the gate's step 3 before it runs. A route registered `false` is
 * read-only or writes a mark the host may set, and the gate does not check the node for it.
 *
 * `octetStream` is the route whose POST body is `application/octet-stream` instead of JSON, the one
 * exception the gate's step 4 makes. `subpath` registers the name for `/web/<name>/<rest>` instead
 * of `/web/<name>`, so one route serves a family of paths below a fixed word; the handler reads the
 * rest from the request path. A name may be registered once each way.
 */
export type WebRouteOptions = { operatorWord: boolean; octetStream?: boolean; subpath?: boolean };

type WebRoute = { handler: WebRouteHandler; operatorWord: boolean; octetStream: boolean };

/** The shape a route name may take, so the table is a fixed set of words and never a path. */
const ROUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** The pages the fixed routes serve, and the file each comes from. */
const PAGE_ROUTES: Readonly<Record<string, string>> = {
  "/": "index.html",
  "/plan": "plan.html",
  "/health": "health.html",
  "/talk": "talk.html",
  "/needs-me": "needs-me.html",
};
const REPO_PREFIX = "/repo/";
const REPO_PAGE = "repo.html";
const ROUTE_PREFIX = "/web/";

/** The file kinds the static handler serves, by extension, and what each is sent as. */
const STATIC_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/**
 * Sent with every page and static file. Script, style, connect and image sources are this origin
 * alone, and nothing else is allowed (`default-src 'none'`), so no inline script or style runs, no
 * other origin is fetched from, and a string that slipped into the page as markup could not call out.
 * No page is framed: the pages carry taps that write, and a frame is how a tap is stolen.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'";

/** One refusal line per address per this long; a repeat inside the window is counted, not written. */
export const REFUSAL_WINDOW_MS = 5 * 60_000;

type RefusalLog = { warn: (reason: string, address: string) => void };

/**
 * Rate-limits refusal logging by address, so a refused peer cannot flood the log with its own
 * refused requests. The first refusal from an address is logged at once; a repeat within the
 * window is counted, and the count is flushed as one line when that address next logs after its
 * window has closed. No timer: the flush is lazy, which keeps it free of anything to clear on
 * shutdown and drivable by an injected clock. The shape is the intake's own refusal log, keyed on
 * the address rather than the reason because the section's rule is per address.
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
      // The count of the window just ended rides on this line, so a window's end is one line too.
      const earlier =
        entry !== undefined && entry.suppressed > 0
          ? `, refused ${entry.suppressed} more time(s) in the ${REFUSAL_WINDOW_MS}ms before`
          : "";
      log.warn(`web refused: ${reason} (remote=${address}${earlier})`);
      // Deleted first so the re-set key moves to the end, and the cap evicts the quietest address.
      state.delete(address);
      state.set(address, { windowStart: at, suppressed: 0 });
      // Bounded like the identity cache, for the same reason: the keys are peer addresses.
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

/**
 * The file a request path names under the static root, or null when the path would leave it.
 *
 * The path is percent-decoded first, so `%2e%2e` is `..` by the time it is resolved rather than a
 * literal directory name that happens not to exist, and a decode that fails is a refusal. The
 * leading slash is dropped before `path.resolve`, since a second absolute argument would replace
 * the root outright. What comes back is accepted only when it starts with the root plus the
 * separator: a `..` that climbs out, a backslash Windows reads as a separator, and a drive letter
 * all resolve somewhere that does not, and the root itself is not a file. Exported so the rule is
 * pinned on its own, apart from the handler that calls it.
 */
export function resolveStatic(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = path.resolve(root);
  const resolved = path.resolve(base, decoded.replace(/^\/+/, ""));
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

/** The file one of the fixed page routes serves for a request path, or null for none. */
function pageFor(pathname: string): string | null {
  if (Object.hasOwn(PAGE_ROUTES, pathname)) return PAGE_ROUTES[pathname];
  if (pathname.startsWith(REPO_PREFIX) && pathname.length > REPO_PREFIX.length) return REPO_PAGE;
  return null;
}

export type WebHandlerOptions = {
  config: WebConfig;
  identity: WebIdentity;
  /** Where a refusal becomes visible. Optional, as the intake's is; served the same without it. */
  log?: Logger;
  /** Drives the refusal log's window. Injected so a test moves it without sleeping. */
  now?: () => number;
};

export type WebHandler = {
  handle: (request: IncomingMessage, response: ServerResponse) => void;
  /**
   * Adds `/web/<name>`, or `/web/<name>/<rest>` where registered with `subpath`. The name is a fixed
   * word, checked against `ROUTE_NAME`, and a name registered twice the same way is a programming
   * error rather than a replacement. A route registered with `operatorWord: true` is refused to the
   * host's own node by the gate; one registered `false` is not.
   */
  register: (name: string, handler: WebRouteHandler, options: WebRouteOptions) => void;
};

/** The gate and the route table, apart from the socket so a test drives them on any listener. */
export function createWebHandler(options: WebHandlerOptions): WebHandler {
  const { config, identity } = options;
  const now = options.now ?? Date.now;
  const refusals = createRefusalLog(options.log, now);
  const routes = new Map<string, WebRoute>();
  const subpathRoutes = new Map<string, WebRoute>();
  const expectedHost = `${config.bind}:${String(config.port)}`.toLowerCase();
  const expectedOrigin = `http://${expectedHost}`;
  const staticRoot = path.resolve(config.staticRoot);

  /** The login and node check against the two lists, lower-cased to match the lists' own form. */
  function admitted(login: string, node: string): boolean {
    if (!config.operators.includes(login.toLowerCase())) return false;
    if (config.devices !== null && !config.devices.includes(node.toLowerCase())) return false;
    return true;
  }

  /**
   * The registered route a request path names under `/web/`, or undefined for any other path. An
   * exact name is looked up as it stands; a path with a further segment names the subpath route
   * registered under its first word, if there is one, and nothing else.
   */
  function routeFor(pathname: string): WebRoute | undefined {
    if (!pathname.startsWith(ROUTE_PREFIX)) return undefined;
    const rest = pathname.slice(ROUTE_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash < 0) return routes.get(rest);
    return slash === rest.length - 1 ? undefined : subpathRoutes.get(rest.slice(0, slash));
  }

  /**
   * Whether `peer` is on the broker host's own tailnet node, or that cannot be told. The host's
   * node is the identity's answer for the listener's bound address, which is the host's own
   * tailnet address, and the identity caches that answer as it caches every address's. A resolver
   * that answers nothing or throws leaves the host unknown, and unknown reads as the host's: an
   * operator-word route runs only for a peer shown to be another node.
   */
  async function onHostNode(peer: TailnetPeer): Promise<boolean> {
    let host: TailnetPeer | null = null;
    try {
      host = await identity.peerFor(config.bind);
    } catch {
      host = null;
    }
    return host === null || host.node.toLowerCase() === peer.node.toLowerCase();
  }

  async function serveFile(file: string, response: ServerResponse): Promise<void> {
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      // Missing, a directory, unreadable: all the same 404, and the cause stays out of the answer.
      empty(response, 404);
      return;
    }
    response.writeHead(200, {
      "content-type": STATIC_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.length,
      "x-content-type-options": "nosniff",
      "content-security-policy": CONTENT_SECURITY_POLICY,
      "x-frame-options": "DENY",
    });
    response.end(body);
  }

  async function route(request: IncomingMessage, response: ServerResponse, peer: TailnetPeer): Promise<void> {
    const pathname = (request.url ?? "/").split("?")[0];

    // The JSON namespace, both methods: a name that is registered runs, and one that is not is a
    // 404 here rather than a fall-through to the static handler, so nothing under `/web/` is ever a
    // file.
    if (pathname.startsWith(ROUTE_PREFIX)) {
      const target = routeFor(pathname);
      // GET and POST alone, so the gate's POST guard is the whole of the write check and a handler
      // never meets a method it would have to refuse itself.
      if (target === undefined || (request.method !== "GET" && request.method !== "POST")) {
        request.resume();
        empty(response, 404);
        return;
      }
      await target.handler(request, response, peer);
      return;
    }

    // Everything else is a page or a file, served to a GET alone.
    if (request.method !== "GET") {
      request.resume();
      empty(response, 404);
      return;
    }
    const page = pageFor(pathname);
    if (page !== null) {
      await serveFile(path.join(staticRoot, page), response);
      return;
    }
    if (Object.hasOwn(STATIC_TYPES, path.posix.extname(pathname).toLowerCase())) {
      const file = resolveStatic(staticRoot, pathname);
      if (file === null) {
        empty(response, 404);
        return;
      }
      await serveFile(file, response);
      return;
    }
    empty(response, 404);
  }

  async function gate(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const address = request.socket.remoteAddress ?? "none";

    // Exact, port included: this listener answers to one name, and a page that reached it under
    // any other was not served by it.
    const host = header(request, "host");
    if (host === null || host.toLowerCase() !== expectedHost) {
      request.resume();
      refusals.warn("Host header is not this listener's", address);
      empty(response, 400);
      return;
    }

    // Any failure inside the resolver is a refusal, so a throw out of it is caught here rather
    // than reaching the server's error path: an identity miss that admits and one that crashes are
    // the two outcomes this surface cannot have.
    let peer: Awaited<ReturnType<WebIdentity["peerFor"]>> = null;
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
    if (!admitted(peer.login, peer.node)) {
      // The login and the node are the peer's own identifiers and stay out of the line: the
      // address is enough to find the node in the admin console, and a line the operator reads
      // should not become a list of who tried.
      request.resume();
      refusals.warn("peer is not an admitted operator on an admitted device", address);
      empty(response, 403);
      return;
    }

    // The route is looked up here only for what it was registered as; it runs below or not at all.
    if (routeFor((request.url ?? "/").split("?")[0])?.operatorWord === true && (await onHostNode(peer))) {
      // The address alone, as above: the host's node and login are the operator's own.
      request.resume();
      refusals.warn("operator-word route refused to the broker host's own node, or the host's node is unknown", address);
      empty(response, 403);
      return;
    }

    if (request.method === "POST") {
      // Sec-Fetch-Site decides where it is sent; Origin is read only where it is absent, so a
      // cross-site POST is refused whatever Origin it names.
      const site = header(request, "sec-fetch-site");
      const origin = header(request, "origin");
      const fromThisOrigin =
        site === null ? origin?.toLowerCase() === expectedOrigin : site.toLowerCase() === "same-origin";
      const type = header(request, "content-type");
      const mediaType = type === null ? null : type.split(";")[0].trim().toLowerCase();
      const octetStream = routeFor((request.url ?? "/").split("?")[0])?.octetStream === true;
      if (!fromThisOrigin || (!octetStream && mediaType !== "application/json")) {
        request.resume();
        refusals.warn("POST without the same-origin JSON headers", address);
        empty(response, 403);
        return;
      }
      // The upload route takes its own body type and no other, multipart included; a wrong type
      // there is a 415, so the page is told the body and not the origin was refused.
      if (octetStream && mediaType !== "application/octet-stream") {
        request.resume();
        refusals.warn("POST to the upload route without the octet-stream type", address);
        empty(response, 415);
        return;
      }
    }

    // The peer handed down is the one `admitted` passed above and no other: the route runs for
    // this login or not at all.
    await route(request, response, peer);
  }

  return {
    handle(request, response) {
      void gate(request, response).catch(() => {
        // A handler that threw has its error discarded, not stringified: a thrown error can quote
        // what it was reading. The refusal line records that it happened, with the address alone.
        options.log?.warn(`web request failed (remote=${request.socket.remoteAddress ?? "none"})`);
        if (!response.headersSent) empty(response, 500);
        else response.end();
      });
    },
    register(name, handler, routeOptions) {
      if (!ROUTE_NAME.test(name)) throw new Error(`web route name ${JSON.stringify(name)} is not a fixed word`);
      const table = routeOptions.subpath === true ? subpathRoutes : routes;
      if (table.has(name)) throw new Error(`web route ${name} is already registered`);
      table.set(name, {
        handler,
        operatorWord: routeOptions.operatorWord,
        octetStream: routeOptions.octetStream === true,
      });
    },
  };
}

export type WebServer = {
  server: Server;
  register: WebHandler["register"];
  /** Binds `<bind>:<port>` and resolves with the port bound; rejects as the socket does. */
  listen: () => Promise<number>;
  close: () => Promise<void>;
};

/** The handler on its own `http.Server`, bound where the configuration says and nowhere else. */
export function createWebServer(options: WebHandlerOptions): WebServer {
  const handler = createWebHandler(options);
  const server = createServer(handler.handle);
  return {
    server,
    register: handler.register,
    listen: () =>
      new Promise<number>((resolve, reject) => {
        const failedToBind = (error: Error): void => reject(error);
        server.once("error", failedToBind);
        server.listen(options.config.port, options.config.bind, () => {
          server.removeListener("error", failedToBind);
          server.on("error", (error) => {
            options.log?.error(`broker: web server error: ${String(error)}`);
          });
          const address = server.address();
          resolve(typeof address === "object" && address !== null ? address.port : options.config.port);
        });
      }),
    close: () => {
      // Keep-alive sockets would otherwise hold close() open until they time out.
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The JSON views
// ---------------------------------------------------------------------------------------------

/** The folders a plan path may name, and the file kind it must end in. */
const PLAN_DIRECTORIES = ["docs/plans/", "docs/archive/plans/"];
const PLAN_SUFFIX = ".md";

/** The rule that refused a plan path, so a test can tell which of the rules did it. */
export type PlanPathRule = "decode" | "backslash" | "leading-slash" | "dotdot" | "prefix" | "suffix";

export type PlanPathScreen = { ok: true; path: string } | { ok: false; rule: PlanPathRule };

/**
 * Screens the `path` of `/web/plan`: the raw query value, still percent-encoded, is decoded once and
 * then shaped by `screenPlanShape`. The first rule to refuse is named: the value must decode, then the
 * shape rules run in the order that function states.
 */
export function screenPlanPath(raw: string): PlanPathScreen {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { ok: false, rule: "decode" };
  }
  return screenPlanShape(decoded);
}

/**
 * Screens a plan path already decoded, as a JSON body carries it: it must be a repository-relative
 * path to a markdown file under a plans folder. The rules run in this order and the first to refuse is
 * named: it holds no backslash, which Windows reads as a separator; it has no leading slash; no
 * segment of it is `..`; it starts with a plans folder; it ends in `.md`.
 *
 * What passes is a shape and nothing more. The handler never opens it: the plan is looked up by exact
 * match among the plans the pass swept, so a path no sweep named is a 404 whatever its shape.
 */
export function screenPlanShape(decoded: string): PlanPathScreen {
  if (decoded.includes("\\")) return { ok: false, rule: "backslash" };
  if (decoded.startsWith("/")) return { ok: false, rule: "leading-slash" };
  if (decoded.split("/").includes("..")) return { ok: false, rule: "dotdot" };
  if (!PLAN_DIRECTORIES.some((directory) => decoded.startsWith(directory))) return { ok: false, rule: "prefix" };
  if (!decoded.endsWith(PLAN_SUFFIX)) return { ok: false, rule: "suffix" };
  return { ok: true, path: decoded };
}

/** Whether `root` names a configured root, compared by last folder name without regard to case. */
function rootConfigured(readings: Readings, root: string): boolean {
  return readings.roots.some((configured) => foldRootName(rootName(configured)) === foldRootName(root));
}

/** A query value decoded once, or null where it is not valid percent-encoding. */
function decodeParam(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The values of each key in the query string, a `+` read as a space as a form query does and the
 * percent escapes left for the caller to decode; a key given twice keeps both.
 */
function queryOf(url: string): Map<string, string[]> {
  const query = new Map<string, string[]>();
  const at = url.indexOf("?");
  if (at < 0) return query;
  for (const pair of url.slice(at + 1).split("&")) {
    if (pair === "") continue;
    const split = pair.indexOf("=");
    const key = (split < 0 ? pair : pair.slice(0, split)).replaceAll("+", " ");
    const values = query.get(key) ?? [];
    values.push(split < 0 ? "" : pair.slice(split + 1).replaceAll("+", " "));
    query.set(key, values);
  }
  return query;
}

/** The one raw value a key holds, or null where it is absent or given more than once. */
function single(query: Map<string, string[]>, key: string): string | null {
  const values = query.get(key);
  return values !== undefined && values.length === 1 ? values[0] : null;
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

/**
 * Registers `/web/standup`, `/web/needs-me`, `/web/repo`, `/web/plan`, `/web/health` and `/web/summary`. Each answers a
 * GET from the readings `source` hands back, the pass's latest, and reads no file of its own. A
 * request string reaches no response and no log: it is compared with names the broker holds and dropped.
 *
 * A refused shape answers 400 and a well-shaped request for something the readings do not hold
 * answers 404, both with an empty body. A reader failing is not a failure here: the view says which
 * source is held and serves what the pass last read.
 */
export function registerViewHandlers(register: WebHandler["register"], source: () => Readings): void {
  const get = (name: string, answer: (request: IncomingMessage, response: ServerResponse) => void): void => {
    register(name, (request, response) => {
      request.resume();
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET", "content-length": 0 });
        response.end();
        return;
      }
      answer(request, response);
    }, { operatorWord: false });
  };

  get("standup", (_request, response) => sendJson(response, standupView(source())));
  get("health", (_request, response) => sendJson(response, healthView(source())));
  get("summary", (_request, response) => sendJson(response, summaryView(source())));
  // The view carries the batch cap the Agree route enforces, so the page never holds its own copy.
  get("needs-me", (_request, response) => sendJson(response, { ...needsMeView(source()), maxBatch: MAX_AGREE_BATCH }));

  get("repo", (request, response) => {
    const raw = single(queryOf(request.url ?? ""), "name");
    const name = raw === null ? null : decodeParam(raw);
    if (name === null || name === "") return empty(response, 400);
    const view = repoView(source(), name);
    if (view === null) return empty(response, 404);
    sendJson(response, view);
  });

  get("plan", (request, response) => {
    const query = queryOf(request.url ?? "");
    const rawRoot = single(query, "root");
    const rawPath = single(query, "path");
    const readings = source();
    const root = rawRoot === null ? null : decodeParam(rawRoot);
    if (root === null || !rootConfigured(readings, root)) return empty(response, 400);
    const screened = rawPath === null ? null : screenPlanPath(rawPath);
    if (screened === null || !screened.ok) return empty(response, 400);
    const view = planView(readings, root, screened.path);
    if (view === null) return empty(response, 404);
    sendJson(response, view);
  });
}

// ---------------------------------------------------------------------------------------------
// The talk page's transcript
// ---------------------------------------------------------------------------------------------

export type TalkHandlerOptions = {
  /** The pass's latest readings, for the registry's records and the roster. */
  source: () => Readings;
  /** The thread bound to a session, as the Discord surface holds it. */
  threadFor: (sessionId: string) => string | null;
  /** The configured guild, for the link into a session's thread; null where none is. */
  guildId: () => string | null;
  /** The receipt tracker's stage for a line's thread message; absent, every line reads `receipt: null`. */
  stageOf?: TalkViewInput["stageOf"];
  /** The question desk's held entry for a session; absent, the view's `pending.questions` is empty. */
  questionsFor?: TalkViewInput["questionsFor"];
  /** The permission desk's open requests for a session; absent, the view's `pending.permissions` is empty. */
  permissionsFor?: TalkViewInput["permissionsFor"];
  /** The view's read time. Injected so a test fixes it. */
  now?: () => number;
};

/** A `since` value is a count the ring handed out: digits only, and short enough to stay exact. */
const SINCE_SHAPE = /^[0-9]{1,15}$/;

/**
 * Registers `GET /web/talk?lineage=<name>&since=<seq>`. It answers the lines of that lineage's ring
 * newer than `since`, which omitted reads as the whole ring, with the live session that carries the
 * lineage or null where none does. A missing or repeated `lineage`, one that is not valid percent
 * encoding, a `since` that is not a plain count, and a lineage that no registry record carries and
 * the roster, where one is read, does not name, each answer 400 with an empty body. A request string
 * reaches no response and no log.
 */
export function registerTalkHandlers(register: WebHandler["register"], ring: TalkRing, options: TalkHandlerOptions): void {
  const now = options.now ?? Date.now;
  register("talk", (request, response) => {
    request.resume();
    if (request.method !== "GET") {
      response.writeHead(405, { allow: "GET", "content-length": 0 });
      response.end();
      return;
    }
    const query = queryOf(request.url ?? "");
    const rawLineage = single(query, "lineage");
    const lineage = rawLineage === null ? null : decodeParam(rawLineage);
    if (lineage === null || lineage === "") return empty(response, 400);
    const rawSince = query.has("since") ? single(query, "since") : "0";
    if (rawSince === null || !SINCE_SHAPE.test(rawSince)) return empty(response, 400);
    const readings = options.source();
    if (!lineageKnown(readings.records, readings.roster.value, lineage)) return empty(response, 400);
    sendJson(
      response,
      talkView(ring, {
        lineage,
        since: Number(rawSince),
        records: readings.records,
        threadFor: options.threadFor,
        guildId: options.guildId,
        ...(options.stageOf === undefined ? {} : { stageOf: options.stageOf }),
        ...(options.questionsFor === undefined ? {} : { questionsFor: options.questionsFor }),
        ...(options.permissionsFor === undefined ? {} : { permissionsFor: options.permissionsFor }),
        now: now(),
      }),
    );
  }, { operatorWord: false });
}

// ---------------------------------------------------------------------------------------------
// The composer: a line typed on the talk page
// ---------------------------------------------------------------------------------------------

/**
 * A say post carries one lineage and one line, which the router cuts to 4,000 code points. The
 * ceiling holds that line at JSON's widest encoding with the body around it: a client that escapes
 * a character outside the Basic Multilingual Plane writes its surrogate pair, twelve bytes a code
 * point, so 4,000 such code points are 48,000 bytes. A body past the ceiling was not typed in the
 * composer.
 */
const MAX_SAY_BODY_BYTES = 64 * 1024;

export type SayHandlerOptions = {
  /**
   * The inbound router's web seam: hands the line and the files its ids name to the live session
   * carrying the lineage as the admitted login's word, and answers what became of it.
   */
  deliverWeb: (lineage: string, login: string, text: string, files: readonly string[]) => Promise<WebDeliveryStatus>;
  /**
   * The inbound router's typed-answer seam: answers the question the live session carrying the
   * lineage is held on with the line, as the admitted login's word, and answers what became of it.
   */
  answerWeb: (lineage: string, login: string, text: string) => Promise<WebAnswerStatus>;
  /**
   * Where a typed answer's status goes, one line per answer the router judged. The line names the
   * route and the status and never the text, the login or the request's lineage.
   */
  log?: Logger;
};

/** The most files one say post may name, the count one Discord message may carry. */
export const MAX_SAY_FILES = 10;

/** The shape of a file id the web files store hands out: a random UUID, lower-case as Node writes it. */
export const WEB_FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The file ids of a say body, or null where `files` is not a list of at most `MAX_SAY_FILES`
 * distinct ids of the store's shape. Absent reads as none.
 */
function sayFiles(files: unknown): string[] | null {
  if (files === undefined) return [];
  if (!Array.isArray(files) || files.length > MAX_SAY_FILES) return null;
  if (!files.every((id): id is string => typeof id === "string" && WEB_FILE_ID.test(id))) return null;
  return new Set(files).size === files.length ? files : null;
}

/**
 * Registers `POST /web/say` with `{lineage, text, files, answers}`. The route carries the operator's word, so
 * the gate has already admitted the peer, refused the broker host's own node, required the
 * same-origin JSON headers, and handed the peer here; the login this route acts for is that peer's
 * and nothing in the body names one. `files` lists the ids `POST /web/file` answered, at most ten,
 * and `text` may be empty where it names one. A body that is not the expected object, a `lineage`
 * that is not a non-empty string, a `text` that is not a string or is empty with no file, a `files`
 * that is not a list of at most ten distinct ids, and a text with no visible words and no file each
 * answer 400 with an empty body and deliver nothing. Otherwise the answer is `{status}` with the
 * router's word: `delivered`, `no-session`, `ended`, `no-thread`, `no-channel`, `rate`, or
 * `unknown-file` where an id names no file the store holds for the lineage's live session, as after
 * the session was replaced or the broker restarted, so the page sends its files again.
 *
 * With `answers: true` the line is the answer to the question the session is held on, and goes to
 * the router's typed-answer seam instead: no file may ride it, and an empty or over-long line answers
 * 400. Otherwise the answer is `{status}` with `answered`, `no-question` where the session holds
 * no question a typed answer may take, so nothing was delivered or posted, `no-session`, `ended`
 * or `no-thread`. An `answers` that is not a boolean answers 400. Nothing of the body reaches a log.
 */
export function registerSayHandler(register: WebHandler["register"], options: SayHandlerOptions): void {
  register(
    "say",
    async (request, response, peer) => {
    if (request.method !== "POST") {
      request.resume();
      response.writeHead(405, { allow: "POST", "content-length": 0 });
      response.end();
      return;
    }
    const body = await readJsonObject(request, MAX_SAY_BODY_BYTES);
    if (body === null) return empty(response, 400);
    const { lineage, text, answers } = body;
    const files = sayFiles(body.files);
    if (typeof lineage !== "string" || lineage === "" || typeof text !== "string" || files === null) return empty(response, 400);
    if (answers !== undefined && typeof answers !== "boolean") return empty(response, 400);
    if (answers === true) {
      if (files.length > 0 || text === "") return empty(response, 400);
      const answered = await options.answerWeb(lineage, peer.login, text);
      if (answered === "empty" || answered === "too-long") return empty(response, 400);
      options.log?.info(`web say: typed answer: ${answered}`);
      sendJson(response, { status: answered });
      return;
    }
    if (text === "" && files.length === 0) return empty(response, 400);
    const status = await options.deliverWeb(lineage, peer.login, text, files);
    if (status === "empty") return empty(response, 400);
    sendJson(response, { status });
    },
    { operatorWord: true },
  );
}

// ---------------------------------------------------------------------------------------------
// A held question and an open permission, answered from the talk page
// ---------------------------------------------------------------------------------------------

/** A question or permission post carries a lineage and a handful of ids and positions. */
const MAX_PENDING_BODY_BYTES = 4 * 1024;

/** The shape of an entry id the question desk mints: six random bytes in hex. */
const QUESTION_ENTRY_ID = /^[0-9a-f]{12}$/;

/** The shape of a permission request id, the one the relay's intake admits. */
const PERMISSION_REQUEST_ID = /^[a-km-z]{5}$/;

/** The shape of a permission prompt's nonce: hex, and never empty, so a verdict always names one. */
const PERMISSION_NONCE = /^[0-9a-f]{1,64}$/;

/** The most option positions one select may name; past it the body is not one the page drew. */
const MAX_SELECT_OPTIONS = 64;

/** The live session carrying a lineage, or why there is none, told apart as the say route's router tells them. */
function pendingSession(records: readonly SessionRecord[], lineage: string): SessionRecord | "no-session" | "ended" {
  const record = liveByLineage(records, lineage);
  if (record !== null) return record;
  return records.some((held) => held.lineage === lineage) ? "ended" : "no-session";
}

/** A POST handler for a pending route: 405 for any other method, 400 for a body that is not a JSON object. */
function pendingPost(
  answer: (body: Record<string, unknown>, response: ServerResponse) => void | Promise<void>,
): WebRouteHandler {
  return async (request, response) => {
    if (request.method !== "POST") {
      request.resume();
      response.writeHead(405, { allow: "POST", "content-length": 0 });
      response.end();
      return;
    }
    const body = await readJsonObject(request, MAX_PENDING_BODY_BYTES);
    if (body === null) return empty(response, 400);
    await answer(body, response);
  };
}

export type QuestionHandlerOptions = {
  /** The registry's records, read fresh on every post. */
  records: () => readonly SessionRecord[];
  /** The question desk: the entry a post names, and the three verbs the thread's buttons take. */
  desk: Pick<QuestionDesk, "entry" | "select" | "submit" | "releaseEntry">;
  /**
   * Redraws a held ask's Discord message after a pick from the page, as a pick in the thread does,
   * so the thread's picker shows what the desk now holds. Called only for an entry whose alert has
   * landed, after the page is answered; a throw out of it is logged and changes nothing else.
   */
  refresh?: (entry: QuestionEntryView) => Promise<void>;
  log?: Logger;
};

/**
 * Registers `POST /web/question` with `{lineage, entryId, action, questionIndex, optionIndexes}`.
 * `action` is `select`, `submit` or `console`, mapped to the desk's `select`, `submit` and
 * `releaseEntry`; `questionIndex` and `optionIndexes` are positions in the ask, read for a select
 * alone, and the desk resolves them against its own copy, so this route never builds an answer.
 * The route carries the operator's word, so the gate has already refused the broker host's own node
 * and required the same-origin JSON headers. A body that is not the expected object answers 400.
 * Otherwise `{status}`: `no-session` or `ended` where no live session carries the lineage; `closed`
 * where the entry is not one the desk holds for that session; `unanswerable` for a select or submit
 * on an ask `answerableFromThread` refuses, which the console release alone may end; `selected`;
 * `answered`, or `incomplete` with the `questionNumber` still unanswered, which submits nothing;
 * `released`. Each answer that names a live session is logged as one line naming the route, the
 * session, the action and the status; nothing else of the body reaches a log.
 */
export function registerQuestionHandler(register: WebHandler["register"], options: QuestionHandlerOptions): void {
  register(
    "question",
    pendingPost(async (body, response) => {
      const { lineage, entryId, action, questionIndex, optionIndexes } = body;
      if (typeof lineage !== "string" || lineage === "") return empty(response, 400);
      if (typeof entryId !== "string" || !QUESTION_ENTRY_ID.test(entryId)) return empty(response, 400);
      if (action !== "select" && action !== "submit" && action !== "console") return empty(response, 400);
      let at = 0;
      let picks: number[] = [];
      if (action === "select") {
        if (typeof questionIndex !== "number" || !Number.isSafeInteger(questionIndex) || questionIndex < 0) return empty(response, 400);
        if (!Array.isArray(optionIndexes) || optionIndexes.length > MAX_SELECT_OPTIONS) return empty(response, 400);
        if (!optionIndexes.every((index): index is number => typeof index === "number" && Number.isSafeInteger(index) && index >= 0)) {
          return empty(response, 400);
        }
        at = questionIndex;
        picks = optionIndexes;
      }

      const session = pendingSession(options.records(), lineage);
      if (typeof session === "string") return sendJson(response, { status: session });
      // Every answer from here on names a live session, so each is logged as one line.
      const answer = (reply: { status: string; questionNumber?: number }): void => {
        options.log?.info(`web question: ${action} for session ${session.sessionId}: ${reply.status}`);
        sendJson(response, reply);
      };
      // The entry must be held for the session the page is open on: an id is opaque, but it is still
      // a string that travels, and one held for another session answers as one nothing holds.
      const entry = options.desk.entry(entryId);
      if (entry === null || entry.sessionId !== session.sessionId) return answer({ status: "closed" });

      if (action === "console") {
        return answer({ status: options.desk.releaseEntry(entryId) ? "released" : "closed" });
      }
      // The thread's rule for drawing a picker at all: an ask it cannot answer whole is the console's.
      if (!answerableFromThread(entry.questions, entry.questionsInput)) return answer({ status: "unanswerable" });

      if (action === "submit") {
        const submission = options.desk.submit(entryId);
        if (submission.kind === "incomplete") {
          return answer({ status: "incomplete", questionNumber: submission.questionNumber });
        }
        return answer({ status: submission.kind === "answered" ? "answered" : "closed" });
      }

      const updated = options.desk.select(entryId, at, picks);
      if (updated === null) return answer({ status: "closed" });
      answer({ status: "selected" });
      if (updated.alert !== null && options.refresh !== undefined) {
        try {
          await options.refresh(updated);
        } catch {
          options.log?.warn(`web question: redrawing session ${updated.sessionId}'s question message threw`);
        }
      }
    }),
    { operatorWord: true },
  );
}

export type PermissionHandlerOptions = {
  /** The registry's records, read fresh on every post. */
  records: () => readonly SessionRecord[];
  /** The thread bound to a session, as the Discord surface holds it. */
  threadFor: (sessionId: string) => string | null;
  /**
   * The permission desk's one verb a verdict reaches, with the request's own nonce, the seam a
   * prompt's button takes: it writes nothing unless the nonce is that request's own.
   */
  resolve: (threadId: string, verdict: Verdict, nonce: string | null) => boolean;
  log?: Logger;
};

/**
 * Registers `POST /web/permission` with `{lineage, requestId, behavior, nonce}`. The verdict goes to
 * the desk's `resolve` for the thread of the live session carrying the lineage, with the nonce the
 * view carried, so a verdict answers only the request whose prompt it was drawn from, and the
 * prompt in the thread takes its outcome edit through the desk's own close-out. The route carries
 * the operator's word, so the gate has already refused the broker host's own node. A body that is
 * not the expected object, a `behavior` that is not `allow` or `deny`, and a missing or malformed
 * nonce each answer 400. Otherwise `{status}`: `resolved`; `closed` where the desk holds no such
 * request in that thread under that nonce, and wrote nothing; `no-session`, `ended` or `no-thread`.
 * A verdict that reaches the desk is logged as one line naming the route, the session, the verdict
 * and the status; nothing else of the body reaches a log.
 */
export function registerPermissionHandler(register: WebHandler["register"], options: PermissionHandlerOptions): void {
  register(
    "permission",
    pendingPost((body, response) => {
      const { lineage, requestId, behavior, nonce } = body;
      if (typeof lineage !== "string" || lineage === "") return empty(response, 400);
      if (typeof requestId !== "string" || !PERMISSION_REQUEST_ID.test(requestId)) return empty(response, 400);
      if (behavior !== "allow" && behavior !== "deny") return empty(response, 400);
      // Never null: the desk skips its nonce check for a caller that states it has none, and this
      // route always has the one the view carried.
      if (typeof nonce !== "string" || !PERMISSION_NONCE.test(nonce)) return empty(response, 400);
      const session = pendingSession(options.records(), lineage);
      if (typeof session === "string") return sendJson(response, { status: session });
      const threadId = options.threadFor(session.sessionId);
      if (threadId === null) return sendJson(response, { status: "no-thread" });
      const status = options.resolve(threadId, { requestId, behavior }, nonce) ? "resolved" : "closed";
      options.log?.info(`web permission: ${behavior} for session ${session.sessionId}: ${status}`);
      sendJson(response, { status });
    }),
    { operatorWord: true },
  );
}

// ---------------------------------------------------------------------------------------------
// The Needs-me page's Agree and batch Agree
// ---------------------------------------------------------------------------------------------

/** The most items one batch Agree may carry: the ledger reader's own cap on a persona's open asks. */
export const MAX_AGREE_BATCH = MAX_ASKS_PER_LIST;

/** An ask id is the ledger's own string, cut there to this many code points; a longer one names no ask. */
const MAX_ASK_ID_LENGTH = MAX_ASK_FIELD_LENGTH;

/** A single Agree names an id and a lineage; the batch names up to `MAX_AGREE_BATCH` of them, ids at their widest. */
const MAX_AGREE_BODY_BYTES = 8 * 1024;
const MAX_AGREE_BATCH_BODY_BYTES = 512 * 1024;

/**
 * What an Agree became: the router's word for a line it was handed, or why none was handed. `closed`
 * is an id the ledger does not hold open for the lineage; `already-agreed` an id this broker already
 * sent an Agree for; `no-recommendation` an ask with no recommendation to agree to; `changed` an ask
 * whose recommendation is no longer the text the page drew; `refused: blocking` a blocking ask in a
 * batch.
 */
export type AgreeStatus =
  | WebDeliveryStatus
  | "closed"
  | "already-agreed"
  | "no-recommendation"
  | "changed"
  | "refused: blocking";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * The line an Agree sends: the recommendation quoted, with each control character and line break
 * made a space, runs of space made one and each double quote made a single quote so the quotes stay
 * one pair on one line, then the decision time
 * in the broker host's local time, `YYYY-MM-DD HH:mm`, zero padded. The kit lifts a hold on any
 * operator-class line whatever its words, and the worker reads these as the operator's answer.
 */
export function agreeLine(recommend: string, at: number): string {
  const when = new Date(at);
  const day = `${String(when.getFullYear())}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`;
  const quoted = recommend
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/"/g, "'");
  return `Agree: proceed on your recommendation, "${quoted}". Decided ${day} ${pad2(when.getHours())}:${pad2(when.getMinutes())} from the page.`;
}

export type AgreeHandlerOptions = {
  /** The pass's latest readings: the ledger an Agree finds its ask in. */
  source: () => Readings;
  /** The inbound router's web seam, the one the say route calls. */
  deliverWeb: SayHandlerOptions["deliverWeb"];
  /** The decision time's clock. Injected so a test fixes it. */
  now?: () => number;
  log?: Logger;
};

type AgreeItem = { askId: string; repo: string; recommend: string | null };

/**
 * A body's item: an ask id, bounded in code points, the lineage it is open under, bounded by the
 * body cap, and the recommendation the page drew, null where the body carries none or not a string.
 * A missing recommendation is not a malformed body: it is an Agree to text the broker cannot match,
 * which `agree` answers as `changed`.
 */
function agreeItem(value: unknown): AgreeItem | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { askId, repo, recommend } = value as Record<string, unknown>;
  if (typeof askId !== "string" || askId === "" || [...askId].length > MAX_ASK_ID_LENGTH) return null;
  if (typeof repo !== "string" || repo === "") return null;
  return { askId, repo, recommend: typeof recommend === "string" ? recommend : null };
}

/**
 * Registers `POST /web/agree` with `{askId, repo, recommend}` and `POST /web/agree-batch` with
 * `{items: [{askId, repo, recommend}]}`. Both carry the operator's word, so the gate has already
 * refused the broker host's own node and required the same-origin JSON headers, and the login an
 * Agree acts for is the peer's. The page sends an id, a lineage and the recommendation it drew, and
 * nothing else: the broker finds the open ledger entry for that pair in the readings it holds, and
 * composes the line from the entry's recommendation, so a page cannot name a lineage that holds no
 * such ask nor put words in an Agree. The recommendation the page sends is compared, never used:
 * the operator's tap is an agreement to the text they read, so an entry whose recommendation is no
 * longer that text, byte for byte, delivers nothing and answers `changed`, and the page draws the new
 * text for a second tap. An item with no recommendation field is `changed` too.
 *
 * The answer to `agree` is `{status}`: the router's word for the line, or `closed` where the ledger
 * holds no such open ask, `already-agreed` where this broker already delivered an Agree for the pair
 * since it started, `no-recommendation` where the ask has nothing to agree to, or `changed`; the last
 * four send nothing. The already-agreed key is held while a delivery is out and kept only where the
 * delivery answered `delivered`. The batch agrees each item in order through the same code, each
 * item's recommendation judged on its own, refuses an item whose ask is blocking as `refused:
 * blocking`, and answers `{results: [{askId, repo, status}]}` in request order. A body that is not
 * the expected object, an item that is not an id and a lineage, and a batch that is empty or past
 * `MAX_AGREE_BATCH` answer 400 with an empty body and agree nothing.
 *
 * An Agree for an ask the ledger holds is logged as one line naming the route, the ask, the lineage
 * and the status; the ledger's own strings are written as JSON, and nothing of the body, the login
 * or the recommendation reaches a log.
 */
export function registerAgreeHandlers(register: WebHandler["register"], options: AgreeHandlerOptions): void {
  const now = options.now ?? Date.now;
  const agreed = new Set<string>();

  async function agree(login: string, { askId, repo, recommend }: AgreeItem, inBatch: boolean): Promise<AgreeStatus> {
    const entry = options.source().ledger.value?.find((reading) => reading.name === repo)?.open.find((open) => open.id === askId);
    if (entry === undefined) return "closed";
    const settle = (status: AgreeStatus): AgreeStatus => {
      options.log?.info(`web agree: ask ${JSON.stringify(entry.id)} for ${JSON.stringify(repo)}: ${status}`);
      return status;
    };
    if (inBatch && entry.blocking === true) return settle("refused: blocking");
    const key = JSON.stringify([repo, entry.id]);
    if (agreed.has(key)) return settle("already-agreed");
    if (entry.recommend === null || entry.recommend.trim() === "") return settle("no-recommendation");
    // Byte for byte: a recommendation rewritten since the page's last poll is not what the operator
    // agreed to, and the line it would compose was never on their screen.
    if (recommend !== entry.recommend) return settle("changed");
    // The key is held before the delivery is awaited, so a second Agree for the ask that arrives while
    // the first is out answers `already-agreed`; any answer but `delivered` gives the key back.
    agreed.add(key);
    let status: AgreeStatus = "no-session";
    try {
      status = await options.deliverWeb(repo, login, agreeLine(entry.recommend, now()), []);
    } finally {
      if (status !== "delivered") agreed.delete(key);
    }
    return settle(status);
  }

  register(
    "agree",
    async (request, response, peer) => {
      if (request.method !== "POST") {
        request.resume();
        response.writeHead(405, { allow: "POST", "content-length": 0 });
        response.end();
        return;
      }
      const body = await readJsonObject(request, MAX_AGREE_BODY_BYTES);
      const item = body === null ? null : agreeItem(body);
      if (item === null) return empty(response, 400);
      sendJson(response, { status: await agree(peer.login, item, false) });
    },
    { operatorWord: true },
  );

  register(
    "agree-batch",
    async (request, response, peer) => {
      if (request.method !== "POST") {
        request.resume();
        response.writeHead(405, { allow: "POST", "content-length": 0 });
        response.end();
        return;
      }
      const body = await readJsonObject(request, MAX_AGREE_BATCH_BODY_BYTES);
      const listed = body === null ? null : body.items;
      if (!Array.isArray(listed) || listed.length === 0 || listed.length > MAX_AGREE_BATCH) return empty(response, 400);
      const items = listed.map(agreeItem);
      if (!items.every((item): item is AgreeItem => item !== null)) return empty(response, 400);
      // One at a time and in order, so each item sees the already-agreed set the one before it filled.
      const results: Array<{ askId: string; repo: string; status: AgreeStatus }> = [];
      for (const item of items) {
        results.push({ askId: item.askId, repo: item.repo, status: await agree(peer.login, item, true) });
      }
      sendJson(response, { results });
    },
    { operatorWord: true },
  );
}

// ---------------------------------------------------------------------------------------------
// Mark rolled out
// ---------------------------------------------------------------------------------------------

/** A rollout post carries one repository name and one branch name; past this it is not one. */
const MAX_ROLLOUT_BODY_BYTES = 1024;

export type RolloutHandlerOptions = {
  /** The pass's own rollout reader, so a tap and the timed fetch take one lock per repository. */
  reader: Pick<RolloutReader, "mark">;
  /**
   * Runs after a tag is pushed and before the answer: the pass's own run, whose rollout reading
   * then takes the rows the reader recomputed, so the next view read counts from the new tag.
   */
  afterMark?: () => void;
  /** Where each tap's one line goes: the tag, the sha and the login, an existing tag, a 404, or a failure's kind. */
  log?: Logger;
};

/**
 * Registers `POST /web/rollout` with `{repo, branch}`, Mark rolled out. The route carries the
 * operator's word, so the gate has already refused the broker host's own node and required the
 * same-origin JSON headers, and the login the tag's message names is the peer's. A body that is not
 * the expected object, a `repo` that is not a non-empty string, and a `branch` that is not a string
 * opening `clients/` with a name after it each answer 400 with an empty body and no fetch, and a
 * `repo` the reader has not grouped or a `branch` the repository does not have answers 404, both
 * before anything is tagged. The reader fetches the repository under its lock, so two taps run one
 * after the other and the second finds the first one's tag and answers 409 `{tag}`. Otherwise the
 * tag is made at the branch head and pushed, and the answer is `{tag, sha, undo}`, `undo` the one
 * command that removes the tag from the remote. A fetch, a tag or a push that fails answers 502
 * `{kind}` with the runner's kind, a push's local tag deleted first. Every tap past the 400s logs
 * one line. Nothing of the body reaches a log, and nothing of git's stderr or the remote URL can,
 * since the reader hands back only the tag it computed, the sha and a kind.
 */
export function registerRolloutHandler(register: WebHandler["register"], options: RolloutHandlerOptions): void {
  register(
    "rollout",
    async (request, response, peer) => {
      if (request.method !== "POST") {
        request.resume();
        response.writeHead(405, { allow: "POST", "content-length": 0 });
        response.end();
        return;
      }
      const body = await readJsonObject(request, MAX_ROLLOUT_BODY_BYTES);
      if (body === null) return empty(response, 400);
      const { repo, branch } = body;
      if (typeof repo !== "string" || repo === "" || typeof branch !== "string" || !branch.startsWith(CLIENT_PREFIX) || branch === CLIENT_PREFIX) return empty(response, 400);
      let marked: RolloutMark;
      try {
        marked = await options.reader.mark(repo, branch, peer.login);
      } catch (error) {
        // The fetch or a local git command failed: the runner's kind alone, which never quotes the remote.
        const kind = error instanceof Error ? error.message : "unknown";
        options.log?.warn(`web rollout: failed ${kind} before the push`);
        sendJson(response, { kind }, 502);
        return;
      }
      switch (marked.status) {
        case "unknown-repo":
        case "unknown-branch":
          // Neither name is logged: both are the post's own text.
          options.log?.info("web rollout: refused, unknown repository or branch");
          empty(response, 404);
          return;
        case "exists":
          options.log?.info(`web rollout: ${marked.tag} exists`);
          sendJson(response, { tag: marked.tag }, 409);
          return;
        case "push-failed":
          options.log?.warn(`web rollout: push failed ${marked.kind} for ${marked.tag}`);
          sendJson(response, { kind: marked.kind }, 502);
          return;
        case "pushed":
          options.log?.info(`web rollout: ${marked.tag} at ${marked.sha.slice(0, 7)} by ${peer.login}`);
          sendJson(response, { tag: marked.tag, sha: marked.sha, undo: `git push origin :refs/tags/${marked.tag}` });
          options.afterMark?.();
      }
    },
    { operatorWord: true },
  );
}

// ---------------------------------------------------------------------------------------------
// The page's files: an upload in, and a reply's file out
// ---------------------------------------------------------------------------------------------

export type FileHandlerOptions = {
  /** The web files store: where an upload is saved, and what a link names. */
  files: Pick<WebFiles, "saveUpload" | "open">;
  /** The live session carrying a lineage, as the say route's router finds it, or null where none does. */
  sessionFor: (lineage: string) => string | null;
  /** The most bytes one upload may carry, the cap one Discord attachment takes. */
  maxBytes: number;
  log?: Logger;
};

/**
 * The body read whole, or `size` at the first byte past `maxBytes`, or null where the request failed
 * or closed before its end. The count is of the bytes received and never a declared length, and the
 * read stops at the cap: the request is paused and nothing more of it is kept, so an oversized
 * upload costs at most the cap in memory.
 */
function readUpload(request: IncomingMessage, maxBytes: number): Promise<Buffer | "size" | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (outcome: Buffer | "size" | null): void => {
      if (settled) return;
      settled = true;
      request.off("data", take);
      resolve(outcome);
    };
    const take = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > maxBytes) {
        chunks.length = 0;
        request.pause();
        settle("size");
        return;
      }
      chunks.push(chunk);
    };
    request.on("data", take);
    request.on("end", () => settle(Buffer.concat(chunks)));
    request.on("error", () => settle(null));
    request.on("close", () => settle(null));
  });
}

/**
 * A refusal of an upload whose body is unread or only part read: a status, no body, and the
 * connection closed after it, so the rest of the body is never read or drained.
 */
function refuseUpload(response: ServerResponse, status: number): void {
  response.writeHead(status, { "content-length": 0, connection: "close" });
  response.end();
}

/**
 * The `Content-Disposition` a download is sent with: always an attachment, so a file is saved and
 * never drawn in this listener's origin, its name in both RFC 6266 forms. The name is a reduced
 * one, which holds no character either form must escape; each form escapes anything else all the
 * same, so the header holds whatever name reaches it.
 */
export function attachmentDisposition(name: string): string {
  const plain = name.replace(/[^A-Za-z0-9._-]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

/**
 * The listener's policy with `sandbox` added, for a download: a file opened in a tab anyway gets an
 * opaque origin and runs no script.
 */
export const DOWNLOAD_CONTENT_SECURITY_POLICY = `${CONTENT_SECURITY_POLICY}; sandbox`;

/** Where a download's id starts in its request path. */
const FILE_PATH_PREFIX = `${ROUTE_PREFIX}file/`;

/**
 * Registers `POST /web/file?lineage=<name>` and `GET /web/file/<id>`.
 *
 * The upload carries the operator's word, as a say post does, so the gate has refused the broker
 * host's own node, and it is the one POST taking `application/octet-stream`, which the gate has
 * required along with this origin. The file's name rides in `X-Web-File-Name`, percent-encoded so a
 * name outside Latin-1 can cross a header; the store reduces it before it reaches a path. A missing
 * or repeated `lineage`, a missing name, a name or lineage that is not valid percent encoding, and an
 * empty body answer 400; a lineage no live session carries answers 404; a declared
 * `Content-Length` past `maxBytes` answers 413 before any of the body is read, and a body sent
 * without one answers 413 the moment the bytes received pass the cap; a write that fails answers
 * 500. Each writes nothing.
 * Otherwise the file is saved for the lineage's live session and the answer is `{id}`, the id a say
 * post names it by. The operator's file is saved as sent, with no kind list.
 *
 * The download is a read route, so the host's node reads it as it reads the page. It streams the
 * file the store holds under the id from disk, its length the open file's own, with the content type
 * the store recorded, as an attachment, with the listener's own security headers, a sandboxing
 * policy and a same-origin resource policy. An id of any other shape, one the store does not hold or
 * whose write has not landed, and a file gone from disk answer 404. A read that fails once the
 * headers are sent cuts the response short. Nothing of a body, a name or an id reaches a log.
 */
export function registerFileHandlers(register: WebHandler["register"], options: FileHandlerOptions): void {
  register(
    "file",
    async (request, response) => {
      if (request.method !== "POST") {
        request.resume();
        response.writeHead(405, { allow: "POST", "content-length": 0 });
        response.end();
        return;
      }
      const rawLineage = single(queryOf(request.url ?? ""), "lineage");
      const lineage = rawLineage === null ? null : decodeParam(rawLineage);
      const rawName = header(request, "x-web-file-name");
      const name = rawName === null ? null : decodeParam(rawName);
      if (lineage === null || lineage === "" || name === null || name === "") return refuseUpload(response, 400);
      const sessionId = options.sessionFor(lineage);
      if (sessionId === null) return refuseUpload(response, 404);
      // A length declared past the cap is refused before any of the body is read. A chunked body,
      // or one whose declared length is within the cap, is bounded by the read below.
      const declared = header(request, "content-length");
      if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > options.maxBytes) return refuseUpload(response, 413);
      const body = await readUpload(request, options.maxBytes);
      if (body === "size") return refuseUpload(response, 413);
      if (body === null || body.length === 0) return refuseUpload(response, 400);
      const id = await options.files.saveUpload(sessionId, name, body);
      if (id === null) {
        options.log?.warn("web files: an upload could not be written");
        return empty(response, 500);
      }
      sendJson(response, { id });
    },
    { operatorWord: true, octetStream: true },
  );

  register(
    "file",
    async (request, response) => {
      request.resume();
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET", "content-length": 0 });
        response.end();
        return;
      }
      const id = (request.url ?? "/").split("?")[0].slice(FILE_PATH_PREFIX.length);
      if (!WEB_FILE_ID.test(id)) return empty(response, 404);
      const opened = await options.files.open(id);
      if (opened === null) return empty(response, 404);
      response.writeHead(200, {
        "content-type": opened.file.contentType,
        "content-length": opened.size,
        "content-disposition": attachmentDisposition(opened.file.name),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": DOWNLOAD_CONTENT_SECURITY_POLICY,
        "cross-origin-resource-policy": "same-origin",
        "x-frame-options": "DENY",
      });
      try {
        await pipeline(opened.stream, response);
      } catch {
        // The headers are out, so the only answer left is a response cut short: the pipeline has
        // destroyed both ends, and the open file closes with its stream.
        response.destroy();
      }
    },
    { operatorWord: false, subpath: true },
  );
}

// ---------------------------------------------------------------------------------------------
// The two marks the operator sets
// ---------------------------------------------------------------------------------------------

/** A mark post carries one repo name or one root and path; past this it is not one. */
const MAX_MARK_BODY_BYTES = 4 * 1024;
/** Past this multiple of the ceiling the connection is cut instead of drained, as the intake's is. */
const MARK_DRAIN_LIMIT_FACTOR = 4;

/**
 * The body as a JSON object, or null where it is over the ceiling, unreadable, not JSON or not an
 * object. The read stops keeping bytes at the ceiling and the connection is destroyed at four times
 * it, so an oversized post costs at most the ceiling in memory. Nothing of the body reaches a log.
 */
function readJsonObject(request: IncomingMessage, ceiling = MAX_MARK_BODY_BYTES): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > ceiling) {
        chunks.length = 0;
        if (size > ceiling * MARK_DRAIN_LIMIT_FACTOR) {
          request.destroy();
          resolve(null);
        }
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", () => resolve(null));
    request.on("close", () => resolve(null));
    request.on("end", () => {
      if (size > ceiling) return resolve(null);
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

export type WatermarkHandlerOptions = {
  log?: Logger;
  /** The clock a mark is stamped with. Injected so a test fixes it. */
  now?: () => number;
};

/**
 * Registers `POST /web/caught-up` with `{repo}` and an optional `drawnAt`, and `POST /web/seen` with
 * `{root, path}`, the path as sent and not percent-encoded. A caught-up mark is stamped with the oldest
 * of the clock, the readings and `drawnAt`, so never later than the server's readings, nor than the
 * page's drawn view where the page sends `drawnAt`. A seen mark snapshots the plan as the latest pass
 * holds it, so a pass landing between the plan page's draw and its post records the newer reading.
 * The section 1 gate has already required the JSON content type and the same-origin headers. A
 * request that names a repo the roster does not hold, or a plan no sweep holds, answers 404; a body
 * that is not the expected object, a root no configured root carries, or a path the plan screen
 * refuses answers 400. A refused request writes nothing. A write that fails answers 500 with an
 * empty body and one log line that carries no error text, and changes no mark.
 */
export function registerWatermarkHandlers(
  register: WebHandler["register"],
  source: () => Readings,
  store: WatermarkStore,
  options: WatermarkHandlerOptions = {},
): void {
  const now = options.now ?? Date.now;

  const post = (name: string, answer: (body: Record<string, unknown>, response: ServerResponse) => void): void => {
    register(name, async (request, response) => {
      if (request.method !== "POST") {
        request.resume();
        response.writeHead(405, { allow: "POST", "content-length": 0 });
        response.end();
        return;
      }
      const body = await readJsonObject(request);
      if (body === null) return empty(response, 400);
      answer(body, response);
    }, { operatorWord: false });
  };

  /** Runs the write, and answers with its time; a throw is a 500 and the mark stays as it was. */
  const write = (response: ServerResponse, at: number, change: () => void): void => {
    try {
      change();
    } catch {
      options.log?.warn("web watermarks: a mark could not be written");
      return empty(response, 500);
    }
    sendJson(response, { at: new Date(at).toISOString() });
  };

  /**
   * The time a caught-up mark is stamped with: the oldest of the clock, the plans and ledger readings,
   * and the time the page was drawn from, so a change after what the operator looked at stays unseen.
   * A `drawnAt` that is not a string, or does not read as a time, is left out.
   */
  const caughtUpTime = (readings: Readings, drawnAt: unknown): number => {
    const times = [now(), readings.plans.at, readings.ledger.at, typeof drawnAt === "string" ? Date.parse(drawnAt) : null];
    return Math.min(...times.filter((time): time is number => time !== null && Number.isFinite(time)));
  };

  post("caught-up", (body, response) => {
    const { repo } = body;
    if (typeof repo !== "string") return empty(response, 400);
    const readings = source();
    if (!(readings.roster.value ?? []).some((persona) => persona.name === repo)) return empty(response, 404);
    const at = caughtUpTime(readings, body.drawnAt);
    write(response, at, () => store.caughtUp(repo, at));
  });

  post("seen", (body, response) => {
    const { root, path: rawPath } = body;
    if (typeof root !== "string" || typeof rawPath !== "string") return empty(response, 400);
    const readings = source();
    if (!rootConfigured(readings, root)) return empty(response, 400);
    const screened = screenPlanShape(rawPath);
    if (!screened.ok) return empty(response, 400);
    const view = planView(readings, root, screened.path);
    if (view === null) return empty(response, 404);
    const at = now();
    write(response, at, () => {
      store.seen(view.root, view.path, { status: view.status, chapters: view.chapters.length }, at);
    });
  });
}
