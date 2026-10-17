// fork-watch.ts: the time bound on the persona plugin's fork drains. The
// memory drain, the ask brief drain and the pair drafts drain in
// hooks/drains.ts each await one $.model.fork, through the fork closure
// hooks/index.ts builds, which takes no timeout, and each
// runs one drain at a time under its own watch. A watch that stayed set for as
// long as a fork never settled would stop that drain for the rest of the
// session, so the next entry to the drain is the timer: an entry that finds
// its fork waiting FORK_BOUND_MS or longer releases the watch under one
// `<drain>_fork_expired` decision and drains as if nothing were running. The
// watch is timed only while the fork call is out. From the take until the
// call, and again from a current return until the drain's finally, it holds
// the drain closed and never reads overdue, so only a fork wait past the
// bound releases a drain, and the calls around the fork run unbounded. No
// clock wait is opened, since the engine meters a pending one against the
// hook's budget and the pair drafts drain starts from tool.call as well as
// from the heartbeat. A fork that settles or rejects after its release finds
// its generation stale: it adds any usage to the fork ledger, logs one
// `<drain>_fork_late` decision and writes nothing else. A fork that returns
// before any release leaves a watch no later entry can release, so a
// released drain is always one whose fork never came back to it, and its
// continuation never persists across the drain that replaced it.
// hooks/drains.ts holds the watches and the decisions; this file holds the
// bound and the readings, and imports nothing.

// How long a drain's fork may run before the next entry releases the drain,
// in milliseconds: the tunable knob. A fork replays the session's whole
// transcript, and a long one on a large model takes minutes, so the bound sits
// well past a slow but live fork. The drains are entered on the controller
// tick and the heartbeat, so an expiry lands within one tick of the bound.
// It stays under ASK_BRIEF_LIFE_MS in hooks/ask-brief.ts: an owed brief dies
// at that age, so a bound at or past it would let every brief queued behind a
// held fork die before the release.
export const FORK_BOUND_MS = 300_000;

// One drain's watch. `since` is null while no drain runs. While one runs it
// is when the drain took its item, in Date.now() milliseconds, and once the
// fork call is made it is that call's instant. `timed` is true only while
// the fork call is out, and only a timed watch can read overdue.
// `generation` counts the drains begun and survives a release, so a
// continuation begun under an earlier generation never reads as current,
// even once a later drain has begun. `subject` names the drain's item, the
// turn or the ask, for the expiry line.
export type ForkWatch = { since: number | null; generation: number; subject: string; timed: boolean };

// The watch of a drain that has never run.
export const FORK_IDLE: ForkWatch = Object.freeze({ since: null, generation: 0, subject: "", timed: false });

// The three counts a fork result's usage carries, as the fork ledger names
// them.
export type ForkCounts = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };

// The watch for a drain taking its item on `subject` now, its generation
// advanced. It holds the drain closed and is not yet timed.
export function beginFork(watch: ForkWatch, now: number, subject: string): ForkWatch {
  return { since: now, generation: watch.generation + 1, subject, timed: false };
}

// The watch timed from `now`, the instant the drain makes its fork call.
export function forkTimed(watch: ForkWatch, now: number): ForkWatch {
  return { ...watch, since: now, timed: true };
}

// The watch once its fork has returned to a current continuation: the drain
// stays closed until its finally, and the watch reads overdue no more.
export function forkHeld(watch: ForkWatch): ForkWatch {
  return { ...watch, timed: false };
}

// Whether a timed watch's fork has waited the bound or longer at `now`. A
// watch with no drain running, or one whose drain is not waiting on its
// fork, is never overdue.
export function forkOverdue(watch: ForkWatch, now: number): boolean {
  return watch.timed && watch.since !== null && now - watch.since >= FORK_BOUND_MS;
}

// Whether a continuation begun under `generation` is no longer the watch's:
// the watch was released, or a later drain has begun since.
export function forkStale(watch: ForkWatch, generation: number): boolean {
  return watch.since === null || watch.generation !== generation;
}

// Whether the continuation holding `mine`, the watch forkTimed gave it, lost
// the drain while its fork was out. Since a watch reads overdue only while
// timed, a drain that reaches its catch with this true is one whose fork
// rejected after its release.
export function forkLost(watch: ForkWatch, mine: ForkWatch): boolean {
  return mine.timed && forkStale(watch, mine.generation);
}

// The watch with no drain running, its generation kept.
export function forkReleased(watch: ForkWatch): ForkWatch {
  return { since: null, generation: watch.generation, subject: watch.subject, timed: false };
}

function ageS(since: number | null, now: number): number {
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

// The detail of a `<drain>_fork_expired` decision: the watch's age in whole
// seconds, which for a timed watch is the fork's wait, and its generation.
export function forkExpiredDetail(watch: ForkWatch, now: number): string {
  return `age ${ageS(watch.since, now)}s, generation ${watch.generation}`;
}

// The detail of a `<drain>_fork_late` decision: the three counts the late
// result carried, each zero where it carried no usage or the fork rejected,
// then the age of the fork it settled for and that drain's generation.
// `mine` is the watch forkTimed gave that drain.
export function forkLateDetail(counts: ForkCounts | null, mine: ForkWatch, now: number): string {
  return `inputTokens ${counts?.inputTokens ?? 0}, outputTokens ${counts?.outputTokens ?? 0}, cacheReadInputTokens ${counts?.cacheReadInputTokens ?? 0}, ${forkExpiredDetail(mine, now)}`;
}
