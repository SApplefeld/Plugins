// jev-live.ts: the live reading of a controller decision: the answers a call keeps while
// the shadow budget holds, the live filter and its default, and the journal
// values of an answer.
//
// No import of the engine handle and no state of its own: every function takes what it
// reads as arguments, so the tick harness, which loads a fresh hooks/index.ts per
// case, shares nothing through it.

import { type ChoiceAnswer, HOLD_TIMEOUT, type HoldTimeout, type JevAnswer, type SeamFailureReason, SHADOW_TIMEOUT_MS, shadowBoundMs } from "./decision-seam";
import { CONTROLLER_DECISION, MEMORY_KIND, PROMOTABLE_SET_IDS, TURN_DISPOSITION, TURN_SCORE } from "./question-catalog";

// What a hook handler hands down to the calls it makes: a reader of the
// engine's remaining budget for the hook, and whether the handler is still
// running. A handler that hands one down builds it at its start and clears
// `live` in a finally as it returns. The engine meters a hook only from its
// call to its return, so a shadow fired once the handler has returned, from a
// chain that outlived the dispatch, races the flat shadow bound, and only a
// shadow fired while `live` holds takes the share of the budget.
export type HookBudget = { live: boolean; readonly remainingMs: () => number };

// The bound a shadow call fired at this moment races: its share of the hook's
// budget while the handler runs, read now, and the flat SHADOW_TIMEOUT_MS
// where the handler has returned or there is no hook, as on a timer.
export function shadowMsOf(budget: HookBudget | undefined): number {
  return budget !== undefined && budget.live ? shadowBoundMs(budget.remainingMs) : SHADOW_TIMEOUT_MS;
}

/**
 * A held model call's answer, or a throw where the hold gave up on it. Each
 * model call site in a hook already treats a call that rejects as failed,
 * through its own catch, so a hold that ran out takes that same path.
 */
export function answeredOrThrow<T>(held: T | HoldTimeout): T {
  if (held === HOLD_TIMEOUT) throw new Error("the wait rule gave up on the call");
  return held;
}

// What liveAsk returns for a call it put live: the stamp id its journal lines
// carry, with the validated answer or the reason the call failed. `rejected`
// is liveAsk's own reason for a host that broke the seam's never-rejects
// contract, and is kept out of SeamFailureReason, which is the seam's set.
export type LiveAskResult =
  | { stampId: string; answer: ChoiceAnswer }
  | { stampId: string; reason: SeamFailureReason | "rejected" };

/**
 * The answer line's three value columns for one answer, by its shape. A
 * Choice's value is the option id it chose, a Score's its position on the
 * levels, a Noul's the probability of yes; the last carries no distribution
 * and no confidence.
 */
export function journalValuesOf(answer: JevAnswer): { value: string; probabilities: Record<string, number>; confidence: number | null } {
  if (answer.type === "choice") return { value: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence };
  if (answer.type === "score") return { value: String(answer.score), probabilities: answer.probabilities, confidence: answer.confidence };
  return { value: String(answer.noul), probabilities: {}, confidence: null };
}

/**
 * The registration-time jevLive read's own filter, pulled out of register()
 * so a test can drive it directly and see both halves of what it decides:
 * which ids liveAsk may act on, and which the manifest value carried but
 * this dropped. The manifest declares jevLive as a comma-separated string,
 * so a string `raw` is split on commas and a member left blank by a stray
 * comma is skipped. An array is read member by member. Trims each member
 * the way the settings file's own shell producer trims JEV_LIVE, and drops a
 * member that is not a string or is not one of PROMOTABLE_SET_IDS, rather
 * than reaching a branch that would otherwise treat an unpromoted question
 * as safe to act on live. A missing `raw`, or one that is neither a string
 * nor an array, reads as no members, never a thrown error.
 *
 * Exported so the test suite can call it directly; register() still holds
 * the one call this filter feeds, so nothing about the registration read
 * changes. The default an absent value takes is JEV_LIVE_DEFAULT, applied at
 * that read rather than here.
 */
export function filterJevLive(raw: unknown): { kept: readonly string[]; dropped: readonly string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  const members: unknown[] = typeof raw === "string"
    ? raw.split(",").filter((part) => part.trim() !== "")
    : Array.isArray(raw) ? raw : [];
  for (const entry of members) {
    if (typeof entry !== "string") {
      dropped.push(String(entry));
      continue;
    }
    const trimmed = entry.trim();
    if (PROMOTABLE_SET_IDS.includes(trimmed)) {
      kept.push(trimmed);
    } else {
      dropped.push(trimmed);
    }
  }
  return { kept, dropped };
}

// The live list a configuration carrying no jevLive value reads: the four
// promotable questions that act on Jev's answer by default. A configured
// value, the empty string included, replaces it whole, so a roster can still
// name fewer live questions or none.
export const JEV_LIVE_DEFAULT = [CONTROLLER_DECISION, TURN_SCORE, MEMORY_KIND, TURN_DISPOSITION].join(",");
