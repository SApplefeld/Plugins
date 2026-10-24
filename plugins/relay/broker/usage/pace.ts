// The pace rule, the weekly roll and the fetch-time guard the Discord fleet card and the web health
// view both read, kept in one module so the seven-day pace marker cannot differ between the two
// surfaces by two copies drifting apart. The projection to the reset is the web view's alone.
import type { UsageAccount, UsageWindow } from "./cache.ts";

/**
 * The pace marker's rule, mirroring claude-swap's own `pace.py` so the card and the console cannot
 * disagree about which window is running hot: a weekly period, elapsed time measured from the
 * reading's fetch time rather than from now, no marker inside the first day of a window, and a flat
 * fifteen-point gap before "ahead" means anything.
 */
export const PACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1_000;
export const PACE_SUPPRESS_AFTER_RESET_MS = 24 * 60 * 60 * 1_000;
export const PACE_AHEAD_THRESHOLD_PCT = 15;

/**
 * The share of a window's length that must have elapsed at the fetch before a projection is drawn,
 * which is the rule's own one-day suppression on a weekly window, because a small elapsed fraction
 * makes almost any spend read as a dry window.
 */
export const PROJECTION_SUPPRESS_FRACTION = 1 / 7;

/**
 * Whether a weekly window has spent more of its budget than the fraction of the week that has gone
 * by, and by enough of a margin to be worth saying.
 *
 * The rule is claude-swap's, constant for constant, because the operator reads both surfaces and a
 * marker on one and not the other reads as a bug in whichever they trust less. Three of its choices
 * carry the weight. Elapsed time is measured from `fetchedAt`, so a reading served stale is judged
 * against the clock it was actually taken at rather than against a week that has moved on without
 * it. The first day after a reset shows nothing, because a small elapsed fraction makes almost any
 * usage read as far ahead. And the gap is a flat fifteen points rather than a ratio, which also
 * means the marker stops firing in the last stretch of the week, where the percentage itself already
 * tells the story.
 *
 * It runs on the rolled window, as upstream's does, so a caller passes the window through
 * `rolledWeekly` first, as both surfaces do. A window carried into a period it did not
 * measure has no current-cycle spend to compare against, and its zero can never be fifteen points
 * ahead of anything, so the roll is what keeps last period's high percentage from being marked
 * against this period's clock.
 *
 * The comparison runs on the raw percentage rather than the drawn one, matching upstream: the drawn
 * value governs the warning glyph, where the operator can see the number the threshold was read off.
 */
export function aheadOfPace(window: UsageWindow, fetchedAt: number | null): boolean {
  if (fetchedAt === null || window.resetsAt === null) return false;
  // Floored rather than the language's own remainder, which takes the sign of its left operand. The
  // gap is negative whenever a reset sits behind the fetch that observed it, and a negative
  // remainder there would place the window's start in the future and read the pace off the wrong
  // cycle.
  const gap = window.resetsAt - fetchedAt;
  const remaining = ((gap % PACE_PERIOD_MS) + PACE_PERIOD_MS) % PACE_PERIOD_MS;
  const elapsed = remaining === 0 ? 0 : PACE_PERIOD_MS - remaining;
  if (elapsed < PACE_SUPPRESS_AFTER_RESET_MS) return false;
  const expected = Math.min(100, (elapsed / PACE_PERIOD_MS) * 100);
  return window.pct - expected >= PACE_AHEAD_THRESHOLD_PCT;
}

/**
 * How far ahead of the current time a fetch time may sit and still be believed. Small clock
 * disagreement between the writer of the cache and the reader of it is ordinary; past this, the
 * timestamp is not describing a past measurement and nothing can be derived from it.
 */
export const MAX_CLOCK_SKEW_MS = 60_000;

/**
 * A weekly window whose reset instant has passed, advanced to the period it is actually in now: the
 * boundary moved forward by whole weeks until it lands in the future, and the percentage at zero.
 *
 * Weekly limits reset on a fixed seven-day cadence, so a reset time in the past is the cache telling
 * this reader that the window it measured no longer exists. Reading that is not manufacturing
 * freshness, it is using a fact the cache itself wrote: the alternative draws last period's spend
 * against a boundary that is gone, which reports an operator out of headroom at the exact moment
 * they have a full week of it. That failure inverts what the card is for, so it decides the shape
 * here. The 5h window is left alone, as it is for pace: its cadence is not this one.
 *
 * A reading whose fetch time is not believable rolls nothing. Without a trustworthy measurement time
 * there is no ground for asserting a fresh period, and the card says the age is unknown rather than
 * drawing a confident zero over a reading it has just declined to date.
 */
export function rolledWeekly(window: UsageWindow, fetchedAt: number | null, now: number): UsageWindow {
  if (fetchedAt === null || window.resetsAt === null || window.resetsAt > now) return window;
  const missed = Math.floor((now - window.resetsAt) / PACE_PERIOD_MS) + 1;
  return { pct: 0, resetsAt: window.resetsAt + missed * PACE_PERIOD_MS };
}

/**
 * When the account's numbers were measured, or null when nothing can be derived from the timestamp
 * the cache carries.
 *
 * A fetch time in the future is the case worth naming: clamping it to zero would draw the staleest
 * possible cache as "as of just now", which is exactly the fresh-looking stale card the age line
 * exists to prevent. Small skew is tolerated, because two clocks agreeing to the second is not
 * something a reader can require of a file another program wrote.
 */
export function measuredAt(account: UsageAccount, now: number): number | null {
  if (account.fetchedAt === null || account.fetchedAt > now + MAX_CLOCK_SKEW_MS) return null;
  return account.fetchedAt;
}

/** Where a window's average rate since its start puts the instant it reaches 100 percent. */
export type Projection = { exhaustionAt: number; lastsToReset: boolean };

/**
 * The instant a window reaches 100 percent at its average rate since its start, and whether that
 * instant falls at or after the reset.
 *
 * The window's start is its reset minus its length, and the rate is read at `fetchedAt`, the instant
 * the percentage was true, so a stale reading is judged against the clock it was taken at. There is
 * no projection for a zero percentage, which has no rate, for a missing reset or fetch time, for a
 * reset at or before the fetch, since the reading then predates the reset, for a reset at or before
 * `now`, since a reset that has passed by the time the page is drawn means the reading predates it
 * too, or for a window less than `PROJECTION_SUPPRESS_FRACTION` of its length old at the fetch. The
 * caller passes the fetch time as `measuredAt` believes it, so a fetch time stamped in the future
 * arrives as null and is declined the way the card declines to date it.
 */
export function projectExhaustion(
  pct: number,
  resetsAt: number | null,
  fetchedAt: number | null,
  length: number,
  now: number,
): Projection | null {
  if (pct <= 0 || resetsAt === null || fetchedAt === null || resetsAt <= fetchedAt || resetsAt <= now) {
    return null;
  }
  const start = resetsAt - length;
  const elapsed = fetchedAt - start;
  if (elapsed < length * PROJECTION_SUPPRESS_FRACTION) return null;
  const exhaustionAt = start + (elapsed * 100) / pct;
  return { exhaustionAt, lastsToReset: exhaustionAt >= resetsAt };
}
