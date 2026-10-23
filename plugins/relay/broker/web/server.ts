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
//   3. a POST must come from this origin and carry `Content-Type: application/json`, else 403.
//      From this origin means `Sec-Fetch-Site: same-origin`, or, where that header is absent,
//      `Origin` equal to `http://<bind>:<port>`. A browser sends Sec-Fetch-Site only to an HTTPS or
//      localhost origin, and this listener is plain HTTP on a tailnet address, so its own pages
//      arrive with Origin alone. A browser sets both headers itself, a page cannot forge either,
//      and a form post cannot set the JSON type.
//
// A refused request answers with an empty body whatever the reason, so nothing about the lists
// or the resolver leaks to whoever was refused. Nothing from a header reaches the log: a refusal
// line carries the socket's own peer address and a fixed reason.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import type { Logger } from "../log.ts";
import { foldRootName } from "./config.ts";
import type { WebConfig } from "./config.ts";
import type { WebIdentity } from "./identity.ts";
import { summaryView } from "./summary.ts";
import { healthView, planView, repoView, rootName, standupView } from "./views.ts";
import type { Readings } from "./views.ts";
import type { WatermarkStore } from "./watermarks.ts";

/** A `/web/<name>` handler, run after the gate; it owns its own body read and its own response. */
export type WebRouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

/** The shape a route name may take, so the table is a fixed set of words and never a path. */
const ROUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** The pages the fixed routes serve, and the file each comes from. */
const PAGE_ROUTES: Readonly<Record<string, string>> = {
  "/": "index.html",
  "/plan": "plan.html",
  "/health": "health.html",
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
   * Adds `/web/<name>`. The name is a fixed word, checked against `ROUTE_NAME`, and a name
   * registered twice is a programming error rather than a replacement.
   */
  register: (name: string, handler: WebRouteHandler) => void;
};

/** The gate and the route table, apart from the socket so a test drives them on any listener. */
export function createWebHandler(options: WebHandlerOptions): WebHandler {
  const { config, identity } = options;
  const now = options.now ?? Date.now;
  const refusals = createRefusalLog(options.log, now);
  const routes = new Map<string, WebRouteHandler>();
  const expectedHost = `${config.bind}:${String(config.port)}`.toLowerCase();
  const expectedOrigin = `http://${expectedHost}`;
  const staticRoot = path.resolve(config.staticRoot);

  /** The login and node check against the two lists, lower-cased to match the lists' own form. */
  function admitted(login: string, node: string): boolean {
    if (!config.operators.includes(login.toLowerCase())) return false;
    if (config.devices !== null && !config.devices.includes(node.toLowerCase())) return false;
    return true;
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

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = (request.url ?? "/").split("?")[0];

    // The JSON namespace, both methods: a name that is registered runs, and one that is not is a
    // 404 here rather than a fall-through to the static handler, so nothing under `/web/` is ever a
    // file.
    if (pathname.startsWith(ROUTE_PREFIX)) {
      const name = pathname.slice(ROUTE_PREFIX.length);
      const handler = routes.get(name);
      // GET and POST alone, so the gate's POST guard is the whole of the write check and a handler
      // never meets a method it would have to refuse itself.
      if (handler === undefined || (request.method !== "GET" && request.method !== "POST")) {
        request.resume();
        empty(response, 404);
        return;
      }
      await handler(request, response);
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

    if (request.method === "POST") {
      // Sec-Fetch-Site decides where it is sent; Origin is read only where it is absent, so a
      // cross-site POST is refused whatever Origin it names.
      const site = header(request, "sec-fetch-site");
      const origin = header(request, "origin");
      const fromThisOrigin =
        site === null ? origin?.toLowerCase() === expectedOrigin : site.toLowerCase() === "same-origin";
      const type = header(request, "content-type");
      const mediaType = type === null ? null : type.split(";")[0].trim().toLowerCase();
      if (!fromThisOrigin || mediaType !== "application/json") {
        request.resume();
        refusals.warn("POST without the same-origin JSON headers", address);
        empty(response, 403);
        return;
      }
    }

    await route(request, response);
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
    register(name, handler) {
      if (!ROUTE_NAME.test(name)) throw new Error(`web route name ${JSON.stringify(name)} is not a fixed word`);
      if (routes.has(name)) throw new Error(`web route ${name} is already registered`);
      routes.set(name, handler);
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

function sendJson(response: ServerResponse, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

/**
 * Registers `/web/standup`, `/web/repo`, `/web/plan`, `/web/health` and `/web/summary`. Each answers a
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
    });
  };

  get("standup", (_request, response) => sendJson(response, standupView(source())));
  get("health", (_request, response) => sendJson(response, healthView(source())));
  get("summary", (_request, response) => sendJson(response, summaryView(source())));

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
function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MARK_BODY_BYTES) {
        chunks.length = 0;
        if (size > MAX_MARK_BODY_BYTES * MARK_DRAIN_LIMIT_FACTOR) {
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
      if (size > MAX_MARK_BODY_BYTES) return resolve(null);
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
    });
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
