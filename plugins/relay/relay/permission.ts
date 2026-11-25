// The permission half of the channel protocol: the prompt Claude Code pushes at this server, and
// the verdict this server pushes back.
//
// Claude Code routes a permission prompt only at a channel server that declares **both**
// `claude/channel` and `claude/channel/permission`, and it registers the verdict handler on the
// same condition. So the capability and this file arrive together: declaring it without a working
// handler aims prompts at a server that drops them, and a dropped prompt is a session parked on a
// question nobody is being asked.
//
// The prompt is delivered to every connected channel server at once and is answered by whichever
// one replies first. Nothing about the request is a secret, and nothing in it is authorization:
// what makes an answer the operator's is the sender gate the broker applies to the Discord message
// the verdict was typed in.
import { z } from "zod";

export const PERMISSION_CAPABILITY = "claude/channel/permission";

/** The capability that makes this server a channel at all. */
export const CHANNEL_CAPABILITY = "claude/channel";

/**
 * What the relay declares. The permission capability is claimed only by a relay that can reach the
 * broker, because a prompt is fanned out to every server declaring it and answered by whichever
 * one answers: a relay with no process token would be one more server the prompt is aimed at and
 * nobody reads, and the operator would never see it.
 */
export function channelCapabilities(watched: boolean): Record<string, object> {
  return watched
    ? { [CHANNEL_CAPABILITY]: {}, [PERMISSION_CAPABILITY]: {} }
    : { [CHANNEL_CAPABILITY]: {} };
}

/** Claude Code to this server: one tool call is waiting on a yes or a no. */
export const PERMISSION_REQUEST_METHOD = "notifications/claude/channel/permission_request";

/** This server to Claude Code: the answer, naming the request it answers. */
export const PERMISSION_METHOD = "notifications/claude/channel/permission";

/**
 * `request_id` and `tool_name` are always sent. The two descriptive fields are optional here
 * because a prompt missing one is still a prompt the session is parked on: a schema that refused
 * it would turn a cosmetic gap into a hung turn, and the broker renders an absent field as such.
 */
export const PermissionRequestNotificationSchema = z.object({
  method: z.literal(PERMISSION_REQUEST_METHOD),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string().optional(),
    input_preview: z.string().optional(),
  }),
});

export type PermissionVerdict = { requestId: string; behavior: "allow" | "deny" };

export type PermissionNotification = {
  method: typeof PERMISSION_METHOD;
  params: { request_id: string; behavior: "allow" | "deny" };
};

/** The verdict, in the shape Claude Code validates it in. */
export function permissionNotification(verdict: PermissionVerdict): PermissionNotification {
  return {
    method: PERMISSION_METHOD,
    params: { request_id: verdict.requestId, behavior: verdict.behavior },
  };
}

/** One prompt as the relay hands it to the broker, the four fields Claude Code sent. */
export type PermissionPrompt = {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
};

/**
 * What the broker said to one offer. `received` is open in the broker's table, `later` is not taken
 * now and may be taken by a later offer, and `dropped` can never be taken.
 */
export type OfferAnswer = "received" | "later" | "dropped";

/** Sets one timer and clears one, so a test can fire a timer by hand with no real wait. */
export type KeeperTimers = {
  set: (fire: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

/**
 * The timers the relay runs the keeper on. Each is unreferenced, so a prompt waiting for its next
 * offer holds no process open.
 */
export const UNREFERENCED_TIMERS: KeeperTimers = {
  set: (fire, ms) => setTimeout(fire, ms).unref(),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export type PermissionKeeperOptions = {
  /**
   * Offers one prompt to the broker. `again` is true for every offer of the prompt after its first
   * on the current stream connection, so the broker logs only the first refusal on each.
   */
  offer: (prompt: PermissionPrompt, again: boolean) => Promise<OfferAnswer>;
  timers: KeeperTimers;
  /** The clock a prompt's arrival and each answer to an offer are stamped with, in milliseconds. */
  now: () => number;
  /**
   * How long after the answer to its last offer a prompt the broker has not taken is offered
   * again.
   */
  retryMs: number;
  log: (line: string) => void;
};

export type PermissionKeeper = {
  /**
   * Takes one prompt Claude Code sent and offers it to the broker. A prompt whose request id is
   * already held keeps every field it has and is offered again, unless its verdict is being sent.
   */
  hold: (prompt: PermissionPrompt) => void;
  /**
   * The stream to the broker connected: every prompt held is treated as not taken and offered, save
   * one whose verdict is being sent.
   */
  connected: () => void;
  /**
   * Sends the verdict for one request to Claude Code through `send`, and forgets the prompt once
   * the send succeeds. Where it fails the prompt is kept as not taken, so it is offered again and
   * a person answers it again. Never rejects.
   */
  verdict: (requestId: string, send: () => Promise<void>) => Promise<void>;
  /** The session's turn ended at `at`, on the broker's clock: forgets each prompt received before it. */
  turnEnded: (at: number) => void;
};

/** One prompt the keeper holds. */
type Held = {
  prompt: PermissionPrompt;
  receivedAt: number;
  /** Whether the broker's last answer for it was `received`. */
  taken: boolean;
  /**
   * When the answer to its newest offer arrived, which its next offer is timed from. The broker
   * stamps each post that fills a thread's window when the post reaches it, before it answers an
   * offer it refused. With `retryMs` equal to that window, an offer timed from the answer reaches
   * the broker once every such stamp is a full window old. Timed from when the offer left, it
   * could reach the broker while those stamps are a little younger and be refused again by them.
   */
  answeredAt: number;
  /** Whether it has been offered on the current stream connection, which decides `again`. */
  offeredOnConnection: boolean;
  /** Counts its offers, so an answer to any offer but the newest decides nothing. */
  attempt: number;
  /** Whether its newest offer has no answer yet. No timer is set for it while one is awaited. */
  waiting: boolean;
  /**
   * How many verdicts for it are being sent to Claude Code. It is neither offered nor timed while
   * any is, since a sent verdict forgets it and a failed one sets it to be offered again.
   */
  sending: number;
};

/**
 * Keeps each permission prompt Claude Code sent until it is answered or its session's turn ends,
 * and offers it to the broker until the broker takes it.
 *
 * Claude Code keeps an approval dialog open without end, and this process is the one that knows of
 * the prompt and lives through a broker restart. So a prompt the broker answered `later`, or did
 * not answer at all, is offered again `retryMs` after the answer to its last offer arrived, without
 * end, since a thread or an announcement can come at any time. A timeout and a failed post each
 * count as an answer here. No timer is set for a prompt while its offer awaits an answer, and the
 * wait is timed from the answer so the broker's window has fully aged out the posts that filled it.
 * A new stream connection offers every prompt at once, since a broker that restarted holds none of
 * them; the broker answers a second offer of a prompt it holds without posting again. A `dropped`
 * prompt is forgotten, and a prompt whose verdict is being sent is not offered.
 *
 * At most one timer is set, for the prompt due first, and none while no prompt waits for another
 * offer. The map has no ceiling of its own: each entry is one tool call whose dialog is open, and a
 * turn end empties it.
 *
 * No line written here holds a prompt's description or input preview. The one line carrying an
 * error carries the failure of a verdict's send to Claude Code, and a verdict holds neither field.
 */
export function createPermissionKeeper(options: PermissionKeeperOptions): PermissionKeeper {
  const held = new Map<string, Held>();
  let timer: unknown = null;

  /** Sets the one timer for the prompt due first, or none where no prompt waits for an offer. */
  function schedule(): void {
    if (timer !== null) options.timers.clear(timer);
    timer = null;
    let due = Number.POSITIVE_INFINITY;
    for (const entry of held.values()) {
      if (entry.taken || entry.waiting || entry.sending > 0) continue;
      due = Math.min(due, entry.answeredAt + options.retryMs);
    }
    if (due === Number.POSITIVE_INFINITY) return;
    timer = options.timers.set(() => {
      timer = null;
      const now = options.now();
      for (const entry of [...held.values()]) {
        if (entry.taken || entry.waiting || entry.sending > 0) continue;
        if (entry.answeredAt + options.retryMs <= now) offer(entry);
      }
      schedule();
    }, Math.max(0, due - options.now()));
  }

  /** Reads the answer to one offer, or `later` where the call failed. */
  async function answerTo(entry: Held, again: boolean): Promise<OfferAnswer> {
    try {
      return await options.offer(entry.prompt, again);
    } catch {
      options.log("relay: could not hand over a permission prompt, so it is offered again");
      return "later";
    }
  }

  function offer(entry: Held): void {
    const again = entry.offeredOnConnection;
    entry.offeredOnConnection = true;
    entry.attempt += 1;
    entry.waiting = true;
    const attempt = entry.attempt;
    void answerTo(entry, again).then((answer) => {
      // A prompt answered, ended or offered again since this offer left is decided elsewhere.
      if (held.get(entry.prompt.requestId) !== entry || entry.attempt !== attempt) return;
      entry.waiting = false;
      entry.answeredAt = options.now();
      if (answer === "dropped") {
        held.delete(entry.prompt.requestId);
        options.log("relay: the broker dropped a permission prompt it can never take");
      } else {
        entry.taken = answer === "received";
      }
      schedule();
    });
  }

  return {
    hold(prompt) {
      const known = held.get(prompt.requestId);
      if (known !== undefined) {
        if (known.sending === 0) offer(known);
        return;
      }
      const entry: Held = {
        prompt: { ...prompt },
        receivedAt: options.now(),
        taken: false,
        answeredAt: 0,
        offeredOnConnection: false,
        attempt: 0,
        waiting: false,
        sending: 0,
      };
      held.set(prompt.requestId, entry);
      offer(entry);
    },

    connected() {
      for (const entry of [...held.values()]) {
        entry.taken = false;
        entry.offeredOnConnection = false;
        if (entry.sending === 0) offer(entry);
      }
      schedule();
    },

    async verdict(requestId, send) {
      // The entry is kept by reference, so a turn end and a new prompt with the same id while the
      // send is out leave the new prompt alone.
      const marked = held.get(requestId);
      if (marked !== undefined) marked.sending += 1;
      try {
        await send();
      } catch (error: unknown) {
        options.log(`relay: could not deliver a permission verdict, so its prompt is offered again: ${String(error)}`);
        // An offer still awaiting its answer may read `received` from a table the verdict has
        // since cleared, so its answer is set aside and the timer offers the prompt afresh. Setting
        // it aside stands in for its answer, so the wait is timed from now.
        if (marked === undefined || held.get(requestId) !== marked) return;
        marked.sending -= 1;
        marked.taken = false;
        if (marked.waiting) marked.answeredAt = options.now();
        marked.waiting = false;
        marked.attempt += 1;
        // A connection that opened during the send skipped it, so it has had no offer there yet.
        if (marked.sending === 0 && !marked.offeredOnConnection) offer(marked);
        schedule();
        return;
      }
      if (marked !== undefined && held.get(requestId) === marked) held.delete(requestId);
      schedule();
    },

    turnEnded(at) {
      for (const [requestId, entry] of held) {
        if (entry.receivedAt < at) held.delete(requestId);
      }
      schedule();
    },
  };
}
