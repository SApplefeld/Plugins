// self-review.ts: pure decision logic for the self-review loop (S13).
// No `import $`, no side effects. Takes data only.
// Covered by check-loader-rule.mjs (scans every hooks/*.ts).

import type { MemoryEntry, MonitorState } from "./agent-state.ts";

export interface SelfReviewOptions {
  selfReviewStreak: number;
  selfReviewEveryTurns: number;
  selfReviewDebounceTurns: number;
  selfReviewMaxPerHour: number;
}

export interface SelfReviewState {
  monitor: MonitorState;
  decisions: Array<{ timestamp: number; loop: string; action: string; detail: string }>;
  memory: MemoryEntry[];
  goals?: Array<{ id: string; title: string; status: string; kind: string }>;
  activeGoalId?: string | null;
}

// --- shouldSelfReview ---
// Returns eligibility + reason. Does NOT mutate state.
export function shouldSelfReview(
  state: SelfReviewState,
  opts: SelfReviewOptions,
  now: number,
  phase: "reactive" | "periodic",
): { eligible: boolean; reason: string } {
  const sr = state.monitor.selfReview;
  if (!sr) return { eligible: false, reason: "no selfReview state" };

  // Cap check (S10): reset count when the hourly window has expired.
  let effectiveCount = sr.count;
  if (now - sr.windowStart >= 3600000) {
    effectiveCount = 0;
  }
  if (effectiveCount >= opts.selfReviewMaxPerHour) {
    return { eligible: false, reason: "cap reached" };
  }

  // Debounce (S12): lastAt === 0 means fresh, pass immediately.
  if (sr.lastAt > 0 && sr.turnsSince < opts.selfReviewDebounceTurns) {
    return { eligible: false, reason: "debounce" };
  }

  // Trigger (S9): reactive needs streak, periodic needs pendingPeriodic or turnsSince >= everyTurns.
  if (phase === "reactive") {
    const streak = state.monitor.env?.errors?.consecutiveErrorTurns ?? 0;
    if (streak >= opts.selfReviewStreak) {
      return { eligible: true, reason: "reactive: streak " + streak };
    }
    return { eligible: false, reason: "reactive: streak " + streak + " < " + opts.selfReviewStreak };
  }

  // Periodic
  if (sr.pendingPeriodic) {
    return { eligible: true, reason: "periodic: pendingPeriodic (goal_done)" };
  }
  if (sr.turnsSince >= opts.selfReviewEveryTurns) {
    return { eligible: true, reason: "periodic: turnsSince " + sr.turnsSince + " >= " + opts.selfReviewEveryTurns };
  }
  return { eligible: false, reason: "periodic: no trigger (pendingPeriodic=false, turnsSince " + sr.turnsSince + " < " + opts.selfReviewEveryTurns + ")" };
}

// --- buildSelfReviewInput ---
// Filters the decision log to worker-facing actions (S5), builds the model prompt.
// Returns { prompt, decisionTimestamps, streak } for provenance.
export function buildSelfReviewInput(
  state: SelfReviewState,
  now: number,
): {
  prompt: string;
  decisionTimestamps: number[];
  streak: number;
} {
  // Noise actions: internal bookkeeping with no worker-facing signal (T5).
  // Kept OUT of the window: deny, block, score, error_streak, done, activated.
  // The nudge actuator's routine records are here: each one is the controller
  // reporting on its own bookkeeping, and a lesson drawn from the worker's
  // behaviour has nothing to take from any of them. Two stay in the window.
  // nudge_cap_reached, because being capped is something that happened to the
  // worker. And nudge_failed, because a refused submit is the moment every
  // automated path into the session goes dead, and that record is the only
  // surface that says so.
  // The inbox lifecycle's records stay in the window too. operator_resolved,
  // because finishing or declining a steer is something that happened to the
  // worker. operator_stamp_withheld (a turn the plugin did not open ran
  // ahead of a queued delivery, whose own turn still stamps it later) and
  // operator_turn_unanswered, because each names a delivery a turn passed
  // over or left unanswered, which a self-review should see.
  // sweep_expired_records_failed, because a refused log write is a dead
  // surface, the same way nudge_failed is. operator_delivery_failed for the
  // same reason: a refused submit is the moment an automated path into the
  // session went dead.
  const NOISE_ACTIONS = new Set([
    "controller_tick", "env_inject", "heartbeat", "self-review",
    "turn_start", "turn_complete", "planning_fired",
    "planning_created", "nudge_sent", "nudge_skipped_turn_in_flight",
    "nudge_skipped_floor", "nudge", "allow",
  ]);

  const workerDecisions = state.decisions.filter(
    (d) => !NOISE_ACTIONS.has(d.action),
  );

  // Build the decision window (most recent 20 worker-facing actions)
  const recent = workerDecisions.slice(-20);
  const window = recent
    .map((d) => new Date(d.timestamp).toISOString().slice(11, 19) + " " + d.loop + " | " + d.action + " | " + d.detail)
    .join("\n");

  // Known lessons (S5: pass as "do not repeat")
  const lessons = state.memory.filter((m) => m.kind === "lesson").slice(-5);
  const lessonBlock = lessons.length > 0
    ? "Known lessons (do not repeat):\n" + lessons.map((m) => " - " + m.text).join("\n")
    : "No prior lessons.";

  const activeGoal = state.goals?.find((g) => g.id === state.activeGoalId);
  const goalContext = activeGoal
    ? "Active goal: " + activeGoal.title + " (status: " + activeGoal.status + ")"
    : "No active goal.";

  const streak = state.monitor.env?.errors?.consecutiveErrorTurns ?? 0;

  const prompt = [
    "Review the following worker activity. If there is a clear, actionable lesson (a mistake worth avoiding or a pattern worth reinforcing), respond with the lesson text only (<=200 chars). If the worker is doing fine and there is nothing worth distilling, respond with exactly: NONE.",
    "",
    goalContext,
    "",
    "Consecutive error turns: " + streak,
    "",
    "Decision window (most recent " + recent.length + " worker-facing actions):",
    window,
    "",
    lessonBlock,
    "",
    "Respond with the lesson text only.",
  ].join("\n");

  return {
    prompt,
    decisionTimestamps: recent.map((d) => d.timestamp),
    streak,
  };
}

// --- dedupeSelfReview ---
// Dedupe on meaning: a paraphrase that leads with the same six normalized
// words as a stored lesson is refused, the same comparison collectEvents
// uses to count the pair under memory_quality after the fact. Case-insensitive exact match is kept as the
// narrower case the lead comparison already subsumes for same-length text.
export function dedupeSelfReview(memory: MemoryEntry[], text: string): boolean {
  const lower = text.toLowerCase().trim();
  const lead = normalizedLead(text);
  return memory.some((m) => {
    if (m.source !== "self-review" || m.kind !== "lesson") return false;
    if (m.text.toLowerCase().trim() === lower) return true;
    return lead.length > 0 && normalizedLead(m.text) === lead;
  });
}

// --- isSelfScoringLesson ---
// Item 8.2 (plan bullet "Asks come from real forks", memory half): a memory
// entry comes from a proof passing or an operator correction, never from
// the classifier scoring its own confusion. The self-review loop's raw
// output is exactly that class by default - a lesson about the worker's own
// decision-making pattern, with nothing to check it against - unless the
// text itself grounds the lesson in something external (a test result, a
// proof, an operator's own correction). Refuse the former, keep the latter.
export function isSelfScoringLesson(text: string): boolean {
  const lower = text.toLowerCase();
  const selfReferential =
    /\b(the worker|the classifier|this session|the controller)\b/.test(lower) &&
    /\b(confus|unclear|unsure|scored?|scoring|struggl|repeated(?:ly)? (?:ask|nudg))/.test(lower);
  const externallyGrounded =
    /\b(test passed|tests? pass|proof|operator (?:said|corrected|confirmed|reported)|fixed|verified|confirmed by)\b/.test(lower);
  return selfReferential && !externallyGrounded;
}

// --- reviewOwnRecord ---
// Plan item 8.4: the loop reads the worker's own record and turns a repeated
// weakness into a finding instead of a memory lesson about itself. The tick
// sends each finding to the coordinator persona as a [FINDING] inbox record,
// so a finding never becomes a node in the finder's own tree. Four signals,
// each counted as discrete events from data the worker already keeps:
//   asks_unresolved  an ask that ran out its wait (ask_timeout) or had to be
//                    re-raised into the thread (ask_reraised)
//   memory_quality   a self-review lesson whose first six normalized words
//                    match another's (a paraphrase the exact-match dedupe let
//                    through), plus a lesson the self-scoring gate refused
//   message_wait     an inbox record delivered KAIZEN_MESSAGE_WAIT_MS or more
//                    after it was sent
//   long_turns       a turn that ran KAIZEN_LONG_TURN_MS or longer
//                    (turn_over_hour, recorded at turn.complete)
// A weakness is repeated when one signal has at least KAIZEN_REPEAT_MIN
// events newer than the latest time a finding for that signal was sent (all
// events when none was). A signal sent within FINDING_COOLOFF_MS of `now`
// yields nothing: the finder cannot see when a finding is acted on, since the
// record may be swept first, so a fixed window is the rule that needs no
// answer to come back.
// long_turns carries a configuration change: a cadence counted in turns
// reviews too rarely when turns run for hours, so the finding carries a
// configFix (halve selfReviewEveryTurns, floored at the debounce). Once the
// cadence is at the floor it yields no finding, and the review falls through
// to the model lesson.

export const KAIZEN_REPEAT_MIN = 2;
export const KAIZEN_MESSAGE_WAIT_MS = 10 * 60_000;
export const KAIZEN_LONG_TURN_MS = 60 * 60_000;
// How long a sent signal stays quiet, counted from the send.
export const FINDING_COOLOFF_MS = 7 * 24 * 60 * 60_000;
// How long a sent finding's record may stay pending before the finder reads
// it as having no coordinator persona to take it and announces it itself.
export const FINDING_UNROUTABLE_AFTER_MS = 24 * 60 * 60_000;

export type KaizenSignal = "asks_unresolved" | "memory_quality" | "message_wait" | "long_turns";

export interface OwnRecordInput {
  decisions: Array<{ timestamp: number; loop: string; action: string; detail: string }>;
  memory: MemoryEntry[];
  inbox: Array<{ at: number; deliveredAt?: number }>;
  // One entry per finding sent, from the finder's own ledger.
  sent: Array<{ signal: string; sentAt: number }>;
}

export interface OwnRecordFinding {
  signal: KaizenSignal;
  count: number;
  title: string;
  objective: string; // carries the "Proof:" line on the three goal-raising signals
  rationale: string; // one line for the operator's thread
  configFix?: { knob: "selfReviewEveryTurns"; from: number; to: number };
}

interface KaizenEvent { at: number; note: string }

function normalizedLead(text: string, words = 6): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, words).join(" ");
}

function collectEvents(input: OwnRecordInput): Record<KaizenSignal, KaizenEvent[]> {
  const out: Record<KaizenSignal, KaizenEvent[]> = {
    asks_unresolved: [], memory_quality: [], message_wait: [], long_turns: [],
  };
  const decisions = [...input.decisions].sort((a, b) => a.timestamp - b.timestamp);
  for (const d of decisions) {
    if (d.action === "ask_timeout" || d.action === "ask_reraised") {
      out.asks_unresolved.push({ at: d.timestamp, note: d.detail.slice(0, 80) });
    } else if (d.action === "turn_over_hour") {
      out.long_turns.push({ at: d.timestamp, note: d.detail.slice(0, 80) });
    } else if (d.action === "memory_lesson_refused") {
      out.memory_quality.push({ at: d.timestamp, note: d.detail.slice(0, 80) });
    }
  }
  const lessons = input.memory.filter((m) => m.source === "self-review" && m.kind === "lesson");
  const byLead = new Map<string, MemoryEntry[]>();
  for (const m of lessons) {
    const lead = normalizedLead(m.text);
    if (!lead) continue;
    byLead.set(lead, [...(byLead.get(lead) ?? []), m]);
  }
  for (const group of byLead.values()) {
    if (group.length < 2) continue;
    for (const m of group) out.memory_quality.push({ at: m.createdAt, note: "duplicate lesson: " + m.text.slice(0, 60) });
  }
  for (const r of input.inbox) {
    if (typeof r.deliveredAt === "number" && r.deliveredAt - r.at >= KAIZEN_MESSAGE_WAIT_MS) {
      out.message_wait.push({ at: r.deliveredAt, note: "waited " + Math.round((r.deliveredAt - r.at) / 60_000) + " min" });
    }
  }
  return out;
}

function describe(signal: KaizenSignal, count: number, events: KaizenEvent[]): { title: string; objective: string; rationale: string } {
  const sample = events.slice(-2).map((e) => e.note).join("; ");
  switch (signal) {
    case "asks_unresolved":
      return {
        title: "Kaizen: asks run out the clock",
        objective: `${count} asks timed out or had to be re-raised before an answer came (${sample}). Find why the asks the worker opens wait unanswered (wrong channel, too generic, opened on a node the operator already parked) and change how they are opened. Proof: a harness case where the same ask shape resolves without a re-raise, and one day's decision log with no ask_timeout.`,
        rationale: `${count} asks timed out or were re-raised unanswered; the finding asks for a change to how asks are opened.`,
      };
    case "memory_quality":
      return {
        title: "Kaizen: self-review lessons repeat or self-score",
        objective: `${count} self-review lessons were paraphrases of one another or were refused as self-scoring (${sample}). Dedupe lessons on meaning rather than exact text and ground each in a proof or an operator correction. Proof: a harness case where a paraphrased lesson is refused as a duplicate and a distinct proof-backed one is kept, and a memory store with no two lessons sharing a lead.`,
        rationale: `${count} stored self-review lessons duplicate or self-score; the finding asks for lessons to be deduped on meaning.`,
      };
    case "message_wait":
      return {
        title: "Kaizen: messages wait too long",
        objective: `${count} inbox records waited ${Math.round(KAIZEN_MESSAGE_WAIT_MS / 60_000)} minutes or more before delivery (${sample}). Find what held them (a long turn, a quiet tick, a claim gap) and shorten the path. Proof: a harness case where a record sent mid-turn is delivered inside the wait bound, and one day's inbox with no record over the bound.`,
        rationale: `${count} messages waited ${Math.round(KAIZEN_MESSAGE_WAIT_MS / 60_000)}+ minutes for delivery; the finding asks for the delivery path to be shortened.`,
      };
    case "long_turns":
      return {
        title: "Kaizen: turns run past an hour",
        objective: `${count} turns ran ${Math.round(KAIZEN_LONG_TURN_MS / 60_000)} minutes or longer (${sample}). A review cadence counted in turns runs too rarely when turns run this long.`,
        // reviewOwnRecord replaces this with the configFix rationale on every
        // long_turns finding it emits.
        rationale: `${count} turns ran past an hour.`,
      };
  }
}

export function reviewOwnRecord(
  input: OwnRecordInput,
  opts: { selfReviewEveryTurns: number; selfReviewDebounceTurns: number; now: number },
): OwnRecordFinding[] {
  const events = collectEvents(input);
  const findings: OwnRecordFinding[] = [];
  for (const signal of Object.keys(events) as KaizenSignal[]) {
    const since = input.sent
      .filter((e) => e.signal === signal)
      .reduce((max, e) => Math.max(max, e.sentAt), -Infinity);
    if (opts.now - since < FINDING_COOLOFF_MS) continue;
    const fresh = events[signal].filter((e) => e.at > since).sort((a, b) => a.at - b.at);
    if (fresh.length < KAIZEN_REPEAT_MIN) continue;
    const text = describe(signal, fresh.length, fresh);
    const finding: OwnRecordFinding = { signal, count: fresh.length, ...text };
    if (signal === "long_turns") {
      const to = Math.max(opts.selfReviewDebounceTurns, Math.floor(opts.selfReviewEveryTurns / 2));
      if (to >= opts.selfReviewEveryTurns) continue;
      finding.configFix = { knob: "selfReviewEveryTurns", from: opts.selfReviewEveryTurns, to };
      finding.rationale = `${fresh.length} turns ran past an hour, so a review cadence counted in turns ran too rarely; selfReviewEveryTurns ${opts.selfReviewEveryTurns} -> ${to}, changed and in effect.`;
    }
    findings.push(finding);
  }
  return findings;
}

// --- evictSelfReview ---
// Keep at most 5 self-review lessons (newest by createdAt).
// Never touches pinned entries (S8). Mutates `memory` in place.
export function evictSelfReview(memory: MemoryEntry[], max = 5): void {
  const selfReview = memory
    .filter((m) => m.source === "self-review" && m.kind === "lesson")
    .sort((a, b) => b.createdAt - a.createdAt); // newest first

  if (selfReview.length <= max) return;

  const toEvict = new Set(selfReview.slice(max).map((m) => m.id));
  for (let i = memory.length - 1; i >= 0; i--) {
    if (toEvict.has(memory[i].id)) {
      memory.splice(i, 1);
    }
  }
}
