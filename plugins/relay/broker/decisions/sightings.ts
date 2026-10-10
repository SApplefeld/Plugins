// Where each of a persona's asks was posted: the `ASK:` lines seen in every session's replies, each
// with the Discord message it landed in, and the link a ledger entry resolves to from them.
//
// The persona plugin keeps an ask's `question` but not the message it was asked in, so the link is
// a join. The outbound router shows this module every reply once its text is on the session's
// thread, and each question in it, read by the plugin's own rule, is kept as a sighting with the
// reply's message. A sighting holds its question as the ledger holds it, cut to the same length,
// then whitespace-folded. A ledger entry links to the message of the newest sighting equal to its
// `question` once that is folded too, and to its session's thread where none is. The sightings live
// in memory alone, so after a restart an older ask links to its thread until the worker posts the
// line again.
//
// A persona reaches its session by lineage: the persona supervisor launches each persona with its
// name as `CHANNEL_LINEAGE`, so the session carrying that lineage is the one whose thread its asks
// are posted in. The session and the guild are read through seams on every call, since both change
// as sessions restart and the gateway caches its channel.
import { askQuestions } from "./ask.ts";
import { MAX_ASK_FIELD_LENGTH, cut } from "./ledger.ts";
import type { AskEntry } from "./ledger.ts";
import { jumpLink } from "../discord/links.ts";
import type { OutboundAskTap } from "../routing/outbound.ts";

/** How many sightings one session keeps, newest kept and oldest dropped first. */
export const MAX_SIGHTINGS = 16;

/**
 * A template placeholder such as `<option>`, the test the personas plugin's `hooks/index.ts` runs
 * on a trimmed question before it refuses the line under `ask_marker_placeholder_refused`, copied
 * verbatim. No `g` flag, so a test keeps no state between calls.
 */
const TEMPLATE_PLACEHOLDER = /<[^<>]+>/;

/** One marked line as it was seen: what it asks, the message it landed in, and when. */
export type Sighting = {
  /** The question, cut to the ledger's field length and whitespace-folded. */
  capture: string;
  /** The reply's last message, which holds or follows the line. */
  messageId: string;
};

/** The session a persona's asks are posted in, as the caller resolves it on each call. */
export type SightingSession = {
  sessionId: string;
  /** The thread the session's replies land in, or null before it has one. */
  threadId: string | null;
};

export type SightingsOptions = {
  /** The live session carrying a lineage, or undefined where none does. */
  session: (lineage: string) => SightingSession | undefined;
  /** The guild the host's channel sits in, or null until the gateway has cached it. */
  guildId: () => string | null;
};

export type Sightings = OutboundAskTap & {
  /**
   * Where a persona's ledger entry points: the message link where a sighting in the persona's live
   * session matches the entry's `question`, the thread link where none does, and null where the
   * persona has no live session, its session no thread, or the guild is not yet known.
   */
  linkFor: (entry: Pick<AskEntry, "question">, persona: string) => string | null;
  /** Drops the sightings of every session not in the set, so a pruned session's ring goes. */
  reconcile: (liveSessionIds: ReadonlySet<string>) => void;
};

export function createSightings(options: SightingsOptions): Sightings {
  const seen = new Map<string, Sighting[]>();

  function reply(sessionId: string, text: string, _postedAt: number, messageId: string | null): void {
    // A question with no message has nowhere to link to, so it is not kept.
    if (messageId === null) return;
    // The questions are read as the personas plugin's `hooks/index.ts` reads them before its
    // per-turn count: a question still carrying a template placeholder is dropped, as the plugin
    // refuses it under `ask_marker_placeholder_refused`, and a question an earlier line of this
    // reply already asked is kept once, as the plugin skips an open question under
    // `ask_reask_suppressed`. The plugin also skips, under that same action, a question closed on
    // its node within its suppress window and one still open from an earlier turn; both need the
    // plugin's own state, which is not visible here, so those lines still take a place. The slice
    // then bounds what one reply can push into the ring, so sixteen lines the plugin skipped for
    // those two reasons ahead of a new one still leave the new one out.
    const keys = new Set<string>();
    for (const question of askQuestions(text)) {
      if (TEMPLATE_PLACEHOLDER.test(question)) continue;
      keys.add(fold(cut(question, MAX_ASK_FIELD_LENGTH)));
    }
    if (keys.size === 0) return;
    const ring = seen.get(sessionId) ?? [];
    for (const capture of [...keys].slice(0, MAX_SIGHTINGS)) {
      ring.push({ capture, messageId });
    }
    if (ring.length > MAX_SIGHTINGS) ring.splice(0, ring.length - MAX_SIGHTINGS);
    seen.set(sessionId, ring);
  }

  function linkFor(entry: Pick<AskEntry, "question">, persona: string): string | null {
    const session = options.session(persona);
    if (session === undefined) return null;
    const question = fold(entry.question);
    const ring = seen.get(session.sessionId) ?? [];
    let messageId: string | null = null;
    for (let index = ring.length - 1; index >= 0; index -= 1) {
      const sighting = ring[index];
      if (sighting !== undefined && sighting.capture === question) {
        messageId = sighting.messageId;
        break;
      }
    }
    return jumpLink(options.guildId(), session.threadId, messageId);
  }

  function reconcile(liveSessionIds: ReadonlySet<string>): void {
    for (const sessionId of [...seen.keys()]) {
      if (!liveSessionIds.has(sessionId)) seen.delete(sessionId);
    }
  }

  return { reply, linkFor, reconcile };
}

/** A text with every run of whitespace collapsed to one space and the ends trimmed. */
function fold(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
