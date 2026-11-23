// The surface a broker with no Discord settings carries a conversation on, in place of a thread.
//
// Two things stand in for Discord. `threadFor` answers a conversation id of the broker's own for a
// session, which every structure on the routing and approval paths takes as an opaque key. The
// messenger answers every post and edit as landed, because on such a host the message has nowhere
// further to go: once the post lands, the outbound router itself writes the reply to the talk ring
// the door reads and hands the text to its other readers. So the messenger keeps no text, file or
// mention, writes nothing to disk and makes no network call. What a session said is held by the
// router's readers, never by a copy here.
//
// Nothing here imports Discord code at run time, only its types, so a host with no Discord loads
// none of it through this module.
import type { RateLimitObservation, ThreadMessenger } from "./discord/transport.ts";

/** The prefix of every local conversation id. A Discord id is digits alone, so it never carries one. */
const LOCAL_PREFIX = "local-";

/**
 * Message ids a surface can answer within one millisecond of its creation time before its ids reach
 * those of a surface made a millisecond later. The ids order a thread's posts only within one
 * process, so the bound is never approached: a surface would have to post a thousand times for every
 * millisecond it has existed.
 *
 * It is a thousand rather than a larger power of ten so that an id stays at 16 digits, below the 17
 * a Discord id needs (`SNOWFLAKE` in `security/senders.ts`), until the clock passes 10^13 ms, in the
 * year 2286. A local id is then refused wherever a Discord id is checked, so it never becomes a link
 * to an unrelated Discord message.
 */
const IDS_PER_MILLISECOND = 1_000n;

/**
 * What every local call reports about its rate-limit bucket: nothing, since there is none. The same
 * value as `NO_RATE_INFO` in `discord/transport.ts`, declared here so the module takes no runtime
 * import from the Discord code.
 */
const NO_RATE_LIMIT: RateLimitObservation = {
  remaining: null,
  resetAfterMs: null,
  retryAfterMs: null,
};

export type LocalSurfaceOptions = {
  /** Read once, when the surface is made. Injected so a test sets the creation time. */
  now: () => number;
};

export type LocalSurface = ThreadMessenger & {
  /** The conversation id for a session: `local-` and the session id, so it is the same after a
   * restart and differs between two sessions. */
  threadFor: (sessionId: string) => string;
};

/** Whether `id` is a conversation id this module answers. No Discord id passes. */
export function isLocalConversationId(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

/**
 * Makes a local surface. Its message ids are its creation time in milliseconds times
 * `IDS_PER_MILLISECOND`, plus a counter, written as digits. Read as a number, which is how the
 * outbound router orders a thread's posts, each id is above every id the same surface answered
 * before and above every id of a surface made at an earlier millisecond, while that earlier surface
 * posted fewer than 1000 times per millisecond of its life. A machine clock set back between two
 * starts breaks the second, which costs nothing: no id outlives its process in a place that
 * compares it.
 */
export function createLocalSurface(options: LocalSurfaceOptions): LocalSurface {
  const base = BigInt(Math.trunc(options.now())) * IDS_PER_MILLISECOND;
  let posted = 0n;

  return {
    threadFor: (sessionId) => `${LOCAL_PREFIX}${sessionId}`,
    postToThread: async () => {
      posted += 1n;
      return { status: "ok", value: { messageId: String(base + posted) }, rate: NO_RATE_LIMIT };
    },
    editInThread: async () => ({ status: "ok", value: null, rate: NO_RATE_LIMIT }),
  };
}
