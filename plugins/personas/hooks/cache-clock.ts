// cache-clock.ts: the prompt cache's clock. The engine reports cache expiry
// only at a resumed start and a model switch, so the module keeps its own
// clock: the time of the last main-loop request and of the last fork, and a
// pure reading of warm or cold with the milliseconds left. hooks/index.ts holds
// the state and stamps each main-loop turn.step; this file holds the constants
// and the reading, and imports nothing.

// The prompt cache's life on the one-hour tier, and the margin around it, both
// in seconds. The compaction pass adds the margin to the life (a session is
// read as expired only once the life plus the margin has passed, so a cut the
// operator's ruling protects against is never journaled early), and the clock
// below subtracts it (a session is read as warm only until the life minus the
// margin has passed, so a fork is never started on a cache that is about to
// lapse). The two readings keep their own directions.
export const COMPACT_CACHE_LIFE_S = 3600;
export const COMPACT_CACHE_MARGIN_S = 300;

// The clock's state: when the last main-loop request went out and when the
// last fork's did, in Date.now() milliseconds, each null until one has.
export type CacheClockState = { lastMainRequestAt: number | null; lastForkAt: number | null };

// One reading of the clock. `warmUntil` is the instant the cache is read as
// warm until, or null where no request has been stamped; `leftMs` is how long
// the reading has left, 0 where cold.
export type CacheReading = { warm: boolean; leftMs: number; warmUntil: number | null };

function stampOf(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The reading at `now`. An open turn reads warm whatever the stamps, since a
// turn in progress is itself keeping the cache alive: its warmUntil and leftMs
// are the formula's where a stamp exists and null and 0 where none does, so the
// instant a session publishes inside a long turn can already be past.
// Otherwise a session with no main request yet reads cold, and the rest read
// warm until the later of the two stamps plus the life minus the margin.
export function cacheReading(now: number, state: CacheClockState, turnOpen: boolean): CacheReading {
  const main = stampOf(state.lastMainRequestAt);
  const fork = stampOf(state.lastForkAt);
  const latest = main !== null && fork !== null ? Math.max(main, fork) : main ?? fork;
  const warmUntil = latest === null ? null : latest + (COMPACT_CACHE_LIFE_S - COMPACT_CACHE_MARGIN_S) * 1000;
  if (turnOpen) return { warm: true, leftMs: warmUntil === null ? 0 : Math.max(0, warmUntil - now), warmUntil };
  if (main === null || warmUntil === null) return { warm: false, leftMs: 0, warmUntil: null };
  const warm = now < warmUntil;
  return { warm, leftMs: warm ? warmUntil - now : 0, warmUntil };
}

// Whether a reading has been warm since the last cache_cold decision: the
// once-per-idle-stretch flag, false in a process that has never read warm.
export type CacheWatch = { warmSeen: boolean };

// One heartbeat tick's reading. Returns the warm-until instant the beat
// publishes and, on the tick that turns from warm to cold, the detail of the
// one cache_cold decision to push, else null. A second cold tick returns null
// until a warm reading has set the flag again.
export function cacheTick(now: number, state: CacheClockState, watch: CacheWatch, turnOpen: boolean): { warmUntil: number | null; coldDetail: string | null } {
  const reading = cacheReading(now, state, turnOpen);
  // A warm reading with no stamp behind it, an open turn before its first
  // request, arms nothing: no cache was ever written to read cold.
  if (reading.warm && reading.warmUntil !== null) watch.warmSeen = true;
  if (reading.warm || !watch.warmSeen) return { warmUntil: reading.warmUntil, coldDetail: null };
  watch.warmSeen = false;
  const stamps = [stampOf(state.lastMainRequestAt), stampOf(state.lastForkAt)].filter((s): s is number => s !== null);
  const idleS = stamps.length > 0 ? Math.floor((now - Math.max(...stamps)) / 1000) : 0;
  const until = reading.warmUntil === null ? "unknown" : new Date(reading.warmUntil).toISOString();
  return { warmUntil: reading.warmUntil, coldDetail: `The prompt cache read cold: ${idleS}s since the last request, warm until ${until}.` };
}

// A full model switch forfeits the prompt cache, which is held per model, so
// the clock clears both stamps and reads cold until the new model's first main
// request. An effort change keeps the model and resets nothing, and so does a
// switch event naming the same model on both sides or carrying no model id.
// Where the switch ends a reading that had been warm, it returns the detail of
// the one cache_cold decision to push and clears the watch flag, so the next
// cold tick adds no second decision; else the detail is null.
export function cacheModelSwitch(state: CacheClockState, watch: CacheWatch, fromModel: unknown, toModel: unknown): { reset: boolean; coldDetail: string | null } {
  if (typeof fromModel !== "string" || typeof toModel !== "string" || fromModel === toModel) return { reset: false, coldDetail: null };
  state.lastMainRequestAt = null;
  state.lastForkAt = null;
  if (!watch.warmSeen) return { reset: true, coldDetail: null };
  watch.warmSeen = false;
  return { reset: true, coldDetail: "The prompt cache read cold: the session switched to another model." };
}

// A fleet row's cache part, from the instant a persona's session published:
// the whole minutes left, rounded up so a warm reading never prints 0m, cold
// at or past the instant, unknown where none was published. A number and
// fixed words only, so no persona-written text reaches it.
export function cachePartText(warmUntil: number | null, now: number): string {
  if (warmUntil === null) return "cache unknown";
  if (warmUntil <= now) return "cache cold";
  return `cache ${Math.ceil((warmUntil - now) / 60_000)}m left`;
}
