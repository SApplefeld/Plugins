// cost-ledger.ts: pure decision logic for cost and cadence (item 6), and the
// shapes of the metering spool's lines and file names.
// No `import $`, no side effects. Takes data only.
// Covered by check-loader-rule.mjs (scans every hooks/*.ts).

// --- FNV-1a hash ---
// Small, no crypto dependency.
export function fnv1aHash(str: string): number {
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0; // FNV prime, keep unsigned
  }
  return hash >>> 0;
}

// --- Window arithmetic ---
// Returns the effective count for a fixed 1-hour window.
// If start is 0, no window has started yet, return the stored count (typically 0).
// If the window has expired (now - start >= 3600000), return 0.
export function effectiveWindowCount(
  window: { start: number; count: number },
  now: number,
): number {
  if (window.start === 0) return window.count; // no window started yet
  if (now - window.start >= 3600000) return 0; // expired
  return window.count;
}

// --- Cap check ---
// Returns true if the cap is reached.
export function isCapReached(
  window: { start: number; count: number },
  maxPerHour: number,
  now: number,
): boolean {
  const effectiveCount = effectiveWindowCount(window, now);
  return effectiveCount >= maxPerHour;
}

// --- Backoff factor ---
// factor = min(2 ^ floor(consecutiveSkips / costBackoffAfterTicks), floor(costBackoffMaxMs / controllerTickMs))
export function backoffFactor(
  consecutiveSkips: number,
  costBackoffAfterTicks: number,
  costBackoffMaxMs: number,
  controllerTickMs: number,
): number {
  const exponent = Math.floor(consecutiveSkips / costBackoffAfterTicks);
  const maxFactor = Math.floor(costBackoffMaxMs / controllerTickMs);
  const factor = Math.min(Math.pow(2, exponent), maxFactor);
  return Math.max(1, factor); // at least 1
}

// --- Should run classify? ---
// D4: backoff gate. Returns true if the classify section should run on this tick.
export function shouldRunClassify(
  tickIndex: number,
  consecutiveSkips: number,
  costBackoffAfterTicks: number,
  costBackoffMaxMs: number,
  controllerTickMs: number,
): boolean {
  const factor = backoffFactor(consecutiveSkips, costBackoffAfterTicks, costBackoffMaxMs, controllerTickMs);
  return tickIndex % factor === 0;
}

// --- Estimate for a call ---
// Estimate tokens: prompt chars / 4 + maxTokens
export function estimateTokens(
  promptChars: number,
  maxTokens: number,
): number {
  return Math.floor(promptChars / 4) + maxTokens;
}

// --- Window bump ---
// Rolls the window when now - start >= 3600000, then increments count, returns the new window.
// If start is 0 (no window started), set start to now.
export function bumpWindow(
  window: { start: number; count: number },
  now: number,
): { start: number; count: number } {
  if (window.start === 0) {
    return { start: now, count: 1 };
  }
  if (now - window.start >= 3600000) {
    return { start: now, count: 1 };
  }
  return { start: window.start, count: window.count + 1 };
}

// --- Metering ---
// One line per turn, written once to a meter file of its own in the meter
// folder under the home directory and never appended to, and one beat file
// per session rewritten there. The files' names are built in
// index.ts, through the decision journal's exported segment guard. `memq meter-drain` carries both
// to the memory database, which holds them in mem.TurnMeter and
// mem.SessionBeat. The token counts are recorded and never read back here:
// nothing in this plugin stops or asks on what a turn cost.

// The spool folder, under the home directory.
export const METER_DIR = ".claude/kit-meter";

// The widths mem.TurnMeter and mem.SessionBeat hold each text at. A text is
// cut to its width here, so a line on the spool is bounded and the host keeps
// what the line carries.
export const METER_TEXT_WIDTH = {
  sessionId: 100,
  turnId: 200,
  persona: 200,
  goalId: 100,
  planPath: 400,
  trigger: 40,
  model: 200,
  cwd: 400,
} as const;

// A text cut to `width` code units, or null for anything that is not a
// non-empty string. A cut never leaves half a surrogate pair at its end.
function meterText(value: unknown, width: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let out = value.length <= width ? value : value.slice(0, width);
  if (out.length < value.length && /[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

// A count the line may carry: a non-negative safe integer, else null.
function meterCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function meterTime(at: unknown): string | null {
  return typeof at === "number" && Number.isFinite(at) ? new Date(at).toISOString() : null;
}

export type MeterTurnInput = {
  sessionId: string;
  turnId: string;
  // A subagent loop's id, where the turn was one of its runs.
  agentId?: string | null;
  persona: string;
  goalId: string | null;
  planPath: string | null;
  trigger: string;
  // The turn's `usage` as the engine reported it, or undefined.
  usage: unknown;
  jevCalls: number;
  jevLatencyMs: number;
  startedAt: number | null;
  endedAt: number;
};

// One turn's spool line, terminated. Every field is present, and one that
// does not apply is null: a turn with no usage carries null for the model and
// the four counts. A subagent run's turn id carries its agent id after a
// slash, so it never collides with the turn that spawned it.
export function meterTurnLine(input: MeterTurnInput): string {
  const usage = typeof input.usage === "object" && input.usage !== null ? input.usage as Record<string, unknown> : null;
  const agent = typeof input.agentId === "string" && input.agentId.length > 0 ? input.agentId : null;
  const line = {
    sessionId: meterText(input.sessionId, METER_TEXT_WIDTH.sessionId),
    turnId: meterText(agent === null ? input.turnId : `${input.turnId}/${agent}`, METER_TEXT_WIDTH.turnId),
    persona: meterText(input.persona, METER_TEXT_WIDTH.persona),
    goalId: meterText(input.goalId, METER_TEXT_WIDTH.goalId),
    planPath: meterText(input.planPath, METER_TEXT_WIDTH.planPath),
    trigger: meterText(input.trigger, METER_TEXT_WIDTH.trigger),
    model: usage === null ? null : meterText(usage.model, METER_TEXT_WIDTH.model),
    inputTokens: usage === null ? null : meterCount(usage.input_tokens),
    outputTokens: usage === null ? null : meterCount(usage.output_tokens),
    cacheReadTokens: usage === null ? null : meterCount(usage.cache_read_input_tokens),
    cacheCreationTokens: usage === null ? null : meterCount(usage.cache_creation_input_tokens),
    jevCalls: meterCount(input.jevCalls),
    jevLatencyMs: meterCount(input.jevLatencyMs),
    started: meterTime(input.startedAt),
    ended: meterTime(input.endedAt),
  };
  return JSON.stringify(line) + "\n";
}

export type MeterBeatInput = {
  sessionId: string;
  persona: string;
  cwd: string;
  beatAt: number;
  lastTurnId: string | null;
  turnOpen: boolean;
};

// One session's beat file text: when the session was last alive, the last
// turn it ended and whether a turn was open then.
export function meterBeatText(input: MeterBeatInput): string {
  return JSON.stringify({
    sessionId: meterText(input.sessionId, METER_TEXT_WIDTH.sessionId),
    persona: meterText(input.persona, METER_TEXT_WIDTH.persona),
    cwd: meterText(input.cwd, METER_TEXT_WIDTH.cwd),
    beat: meterTime(input.beatAt),
    lastTurnId: meterText(input.lastTurnId, METER_TEXT_WIDTH.turnId),
    turnOpen: input.turnOpen === true,
  }) + "\n";
}
