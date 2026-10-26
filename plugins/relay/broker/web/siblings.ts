// The sibling poll: the broker's second outbound HTTP client, after the attachment intake. Each
// sibling named in `CHANNEL_WEB_SIBLINGS` is asked for its `GET /web/summary` on the web pass's
// cadence, and what came back is served to this host's own pages at `GET /web/siblings`, so the
// rail on every page draws another sandbox's counts without the browser reaching any origin but
// this one.
//
// A sibling's answer is another host's text and is read as hostile: it is taken only under a
// timeout and a byte cap, and only when it matches the summary's shape key by key, with every
// string a bounded sandbox name free of control and format characters, one of the
// four verdict words, or a time rebuilt as an ISO string. Anything else, a refused connection, a
// slow or oversize body, a status off 200 or a body off the shape, reads as the sibling being
// unreachable for that poll, and no byte of the body reaches the log or a page. A poll never
// throws: a failure is a state, held per sibling in memory alone. The timeout and the byte cap are
// the attachment intake's own guards, imported from it.
import { readBounded, withinLimit } from "../routing/attachments.ts";
import { CONTROL_CHAR } from "./config.ts";
import type { Sibling } from "./config.ts";
// The summary's own bound on a sandbox name, so a sibling that cuts its name as this host cuts its
// own is admitted whole and nothing longer is.
import { SANDBOX_MAX } from "./summary.ts";
import type { SummaryView } from "./summary.ts";
import type { Verdict } from "./views.ts";

/** How long one sibling's poll may take, headers and body together. */
export const SIBLING_TIMEOUT_MS = 3_000;
/** The most bytes of a sibling's answer read; a summary is a few hundred. */
export const SIBLING_MAX_BODY_BYTES = 4 * 1024;
/** The most a count may read; a fleet of a million sessions is not a count but a bad body. */
export const MAX_COUNT = 1_000_000;
/**
 * The format characters, bidirectional marks, overrides and isolates and the zero-width ones among
 * them, with the line and paragraph separators: none draws as itself, and the bidi ones reorder the
 * text drawn after them.
 */
const FORMAT_CHAR = /[\p{Cf}\u2028\u2029]/u;
/** The longest `asOf` string read as a time; an ISO time is 24 characters, or 29 with an offset. */
const AS_OF_MAX = 40;
/** The four verdict words, as `Verdict["word"]` in views.ts spells them. */
const VERDICT_WORDS: ReadonlySet<string> = new Set<string>(
  ["underused", "balanced", "overcommitted", "unknown"] satisfies Verdict["word"][],
);
/** The summary's keys at each level, in the order `summaryView` writes them; no other key is admitted. */
const SUMMARY_KEYS = ["sandbox", "needsYou", "yourHands", "expected", "reporting", "capacity", "asOf"] as const;
const CAPACITY_KEYS = ["verdict", "accounts"] as const;

/**
 * Why a body was refused. Each names the rule, so a test of a refusal shows which rule refused it
 * and a log line can carry the kind without the text.
 */
export type SummaryRule =
  | "json"
  | "object"
  | "keys"
  | "sandbox"
  | "count"
  | "nullable-count"
  | "capacity"
  | "verdict"
  | "asOf";

export type SummaryParse = { ok: true; summary: SummaryView } | { ok: false; rule: SummaryRule };

/** A count as the summary writes one: an integer by `Number.isInteger`, from 0 to `MAX_COUNT`. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

/** Whether `value` is a plain object holding exactly `keys`, in any order, and no other. */
function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * The summary out of a sibling's body, or the rule that refused it. The shape is `SummaryView`'s
 * exactly: a key missing or added at either level is a refusal, a count is an integer so a `3.0`
 * reads as 3 and a fraction or an exponent past the bound is refused, `sandbox` holds no control or
 * format character, and `asOf` is null or a string of at most 40 characters that
 * `Date.parse` reads as a finite time, returned as that time's ISO string so no text of the
 * sibling's leaves as a time. The parse admits nothing it does not rebuild, so what it returns
 * holds only the values it checked.
 */
export function parseSummary(text: string): SummaryParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, rule: "json" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, rule: "object" };
  if (!hasExactKeys(body, SUMMARY_KEYS)) return { ok: false, rule: "keys" };
  const sandbox = body["sandbox"];
  if (
    typeof sandbox !== "string" ||
    sandbox.length > SANDBOX_MAX ||
    CONTROL_CHAR.test(sandbox) ||
    FORMAT_CHAR.test(sandbox)
  ) {
    return { ok: false, rule: "sandbox" };
  }
  const needsYou = body["needsYou"];
  const yourHands = body["yourHands"];
  if (!isCount(needsYou) || !isCount(yourHands)) return { ok: false, rule: "count" };
  const expected = body["expected"];
  const reporting = body["reporting"];
  if ((expected !== null && !isCount(expected)) || (reporting !== null && !isCount(reporting))) {
    return { ok: false, rule: "nullable-count" };
  }
  const capacity = body["capacity"];
  if (!hasExactKeys(capacity, CAPACITY_KEYS)) return { ok: false, rule: "capacity" };
  const verdict = capacity["verdict"];
  const accounts = capacity["accounts"];
  if (typeof verdict !== "string" || !VERDICT_WORDS.has(verdict) || !isCount(accounts)) {
    return { ok: false, rule: "verdict" };
  }
  const asOfText = body["asOf"];
  let asOf: string | null = null;
  if (asOfText !== null) {
    if (typeof asOfText !== "string" || asOfText.length > AS_OF_MAX) return { ok: false, rule: "asOf" };
    const ms = Date.parse(asOfText);
    if (!Number.isFinite(ms)) return { ok: false, rule: "asOf" };
    asOf = new Date(ms).toISOString();
  }
  return {
    ok: true,
    summary: {
      sandbox,
      needsYou,
      yourHands,
      expected,
      reporting,
      capacity: { verdict: verdict as Verdict["word"], accounts },
      asOf,
    },
  };
}

/**
 * Why a sibling did not answer this poll. `timeout` is the limit firing anywhere in the request,
 * headers or body; `connection` is the fetch itself rejecting; `status` is any answer off 200, a
 * redirect included, since redirects are never followed; `size` is a body past the cap; `shape` is
 * a body `parseSummary` refused, with its rule.
 */
export type FailureKind = "timeout" | "connection" | "status" | "size" | `shape:${SummaryRule}`;

/** What is served for one sibling: the configured name and origin, and the last poll's outcome. */
export type SiblingState = {
  name: string;
  /** `http://<address>:<port>`, from this host's configuration and never from the sibling. */
  origin: string;
  /** The last admitted summary, or null while the sibling is unreachable or not yet polled. */
  summary: SummaryView | null;
  /** The ISO time of the first failed poll after the last success, or null while reachable. */
  unreachableSince: string | null;
  /** The ISO time of the last poll, or null before the first. */
  checkedAt: string | null;
};

export type SiblingsView = {
  /** This host's own name, cut as the summary cuts it. */
  sandbox: string;
  siblings: readonly SiblingState[];
  /** The ISO time of the last poll pass, or null before the first. */
  asOf: string | null;
};

/**
 * The one request this module makes, as the narrowest shape a test fake needs to answer. The
 * global `fetch` satisfies it, and the default is that. Redirects are never followed: `manual`
 * hands a 3xx back as a status, which reads as unreachable. The `Host` header is the URL's host,
 * `<address>:<port>` as configured, which is the exact value the sibling's listener demands.
 */
export type SiblingFetch = (
  url: string,
  init: { signal: AbortSignal; redirect: "manual" },
) => Promise<{ status: number; body: ReadableStream<Uint8Array> | null }>;

export type SiblingPollerOptions = {
  siblings: readonly Sibling[];
  /** This host's `CHANNEL_HOST_NAME`, cut here as the summary cuts it. */
  host: string;
  /** The pass cadence, `CHANNEL_BOARD_CARD_REFRESH_MS`. */
  refreshMs: number;
  fetch?: SiblingFetch;
  now?: () => number;
  log?: (message: string) => void;
  /** Injected so a test reaches the limit without waiting it out. */
  timeoutMs?: number;
  /** Injected so a test drives the interval without waiting on it. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

export type SiblingPoller = {
  /** One poll of every sibling, now. Resolves on every path; a failure is a state, never a throw. */
  poll: () => Promise<void>;
  /** Runs one poll at once and begins the cadence. Calling it twice runs one timer, not two. */
  start: () => void;
  stop: () => void;
  /** What `GET /web/siblings` serves: every sibling's last outcome, in configured order. */
  view: () => SiblingsView;
};

/**
 * The origin a rail pill links to and the poll asks, built from the configured address and port
 * alone. A sibling on port 80 is never reached: the URL drops the default port, so the request's
 * `Host` carries no port, and the listener's exact `Host` check refuses that.
 */
export function siblingOrigin(sibling: Sibling): string {
  return `http://${sibling.address}:${String(sibling.port)}`;
}

export function createSiblingPoller(options: SiblingPollerOptions): SiblingPoller {
  const request: SiblingFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => {});
  const timeoutMs = options.timeoutMs ?? SIBLING_TIMEOUT_MS;
  const setTimer = options.setTimer ?? setInterval;
  const clearTimer = options.clearTimer ?? clearInterval;
  const sandbox = options.host.slice(0, SANDBOX_MAX);

  type Held = SiblingState & { sibling: Sibling; lastKind: FailureKind | "reachable" | null };
  const held: Held[] = options.siblings.map((sibling) => ({
    sibling,
    name: sibling.name,
    origin: siblingOrigin(sibling),
    summary: null,
    unreachableSince: null,
    checkedAt: null,
    lastKind: null,
  }));
  let asOf: string | null = null;
  let timer: NodeJS.Timeout | null = null;

  /** One sibling's answer under the limit: the admitted summary, or the kind of failure. */
  async function ask(sibling: Sibling): Promise<SummaryView | FailureKind> {
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = (): boolean => signal.aborted;
    let response: Awaited<ReturnType<SiblingFetch>>;
    try {
      response = await withinLimit(request(`${siblingOrigin(sibling)}/web/summary`, { signal, redirect: "manual" }), signal);
    } catch {
      return timedOut() ? "timeout" : "connection";
    }
    if (response.status !== 200) {
      // A body nobody reads holds its connection until it is collected, so a refused one is let go.
      response.body?.cancel().catch(() => undefined);
      return "status";
    }
    // A 200 with no body is an empty text, which the parse refuses as it refuses any non-JSON.
    let bytes: Uint8Array | "size" = new Uint8Array(0);
    if (response.body !== null) {
      try {
        bytes = await withinLimit(readBounded(response.body, SIBLING_MAX_BODY_BYTES), signal);
      } catch {
        return timedOut() ? "timeout" : "connection";
      }
    }
    if (bytes === "size") return "size";
    const parsed = parseSummary(Buffer.from(bytes).toString("utf8"));
    return parsed.ok ? parsed.summary : `shape:${parsed.rule}`;
  }

  /** Records one outcome, and writes one line where the sibling's reachability or failure kind changed. */
  function settle(entry: Held, outcome: SummaryView | FailureKind, at: string): void {
    entry.checkedAt = at;
    if (typeof outcome === "string") {
      entry.summary = null;
      if (entry.unreachableSince === null) entry.unreachableSince = at;
      if (entry.lastKind !== outcome) log(`web siblings: ${entry.name} is unreachable (${outcome})`);
      entry.lastKind = outcome;
      return;
    }
    entry.summary = outcome;
    entry.unreachableSince = null;
    if (entry.lastKind !== "reachable") log(`web siblings: ${entry.name} is reachable`);
    entry.lastKind = "reachable";
  }

  async function poll(): Promise<void> {
    // One time for the pass, so every sibling's `checkedAt` and the view's `asOf` agree.
    const at = new Date(now()).toISOString();
    await Promise.all(
      held.map(async (entry) => {
        let outcome: SummaryView | FailureKind;
        try {
          outcome = await ask(entry.sibling);
        } catch {
          // `ask` answers every path it knows; this is the one it does not, and it is still a state.
          outcome = "connection";
        }
        settle(entry, outcome, at);
      }),
    );
    asOf = at;
  }

  return {
    poll,
    start() {
      if (timer !== null || held.length === 0) return;
      timer = setTimer(() => void poll(), options.refreshMs);
      void poll();
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    view() {
      return {
        sandbox,
        siblings: held.map(({ name, origin, summary, unreachableSince, checkedAt }) => ({
          name,
          origin,
          summary,
          unreachableSince,
          checkedAt,
        })),
        asOf,
      };
    },
  };
}
