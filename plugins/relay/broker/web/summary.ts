// The summary the web listener serves at `GET /web/summary`: four counts, the capacity verdict's word
// with the number of accounts behind it, the sandbox name and the oldest source time. It names no
// session, repo, plan or person, and no path or ask text, so what it gives a reader is the fleet's
// size and state. The counts and the word come from the standup and health views of the same
// reading, so they agree with the pages a reader opens next.
import { asOf, healthView, standupView } from "./views.ts";
import type { AsOf, Readings, Verdict } from "./views.ts";

/** The longest sandbox name the summary carries; a longer `CHANNEL_HOST_NAME` is cut to this. */
export const SANDBOX_MAX = 32;

export type SummaryView = {
  sandbox: string;
  needsYou: number;
  yourHands: number;
  expected: number | null;
  reporting: number | null;
  /** The health view's verdict word and the accounts it counted, and none of its figures. */
  capacity: { verdict: Verdict["word"]; accounts: number };
  asOf: string | null;
};

export function summaryView(readings: Readings): SummaryView {
  const standup = standupView(readings);
  const health = healthView(readings);
  return {
    sandbox: readings.host.slice(0, SANDBOX_MAX),
    needsYou: standup.needsYou.length,
    yourHands: standup.needsYou.filter((item) => item.kind === "hands").length,
    expected: health.expected,
    reporting: health.reporting,
    capacity: { verdict: health.verdict.word, accounts: health.verdict.accounts },
    asOf: oldestOf(asOf(readings)),
  };
}

/**
 * The oldest of the source times, as the ISO string it holds, or null where no source has one. A
 * source never read has no time and is skipped, so the summary's time reads as fresh as its oldest
 * reading; the pages' `held` and per-source times are where an unread source shows.
 */
function oldestOf(times: AsOf): string | null {
  let oldest: string | null = null;
  for (const time of Object.values(times)) {
    if (time !== null && (oldest === null || Date.parse(time) < Date.parse(oldest))) oldest = time;
  }
  return oldest;
}
