// The goal persona's seed: the goal block the process keeper writes to
// goal.json from the roster entry, read at session start and planted as the
// persona's goal-tree root at its first launch, so the persona wakes holding
// its goal with no goal_create call. The module also owns the texts the
// turn budget and the retire record put in front of a model, each one
// template literal in one function, the shape the injection ledger reads.
//
// No `import $` and no side effects at load, the way roster.ts is written:
// readGoalFile takes a GoalHost the caller builds from `$`, so this module
// loads without the engine's loader following `$` across the import.
import { goalProblem } from "./roster";
import { TURN_BUDGET_REASON, bracketSafeText, oneLine, type AgentState, type GoalNode } from "./agent-state";
import { safeErrorText } from "./text";

export type GoalHost = { readFile(path: string): Promise<string> };

// The goal block as the roster validator admits it: the objective, the done
// statements, at most GOAL_DONE_MAX of them as goalProblem holds, and the
// turn budget where the entry carries one.
export interface GoalBlock {
  objective: string;
  done: string[];
  turns?: number;
}

export type GoalFileRead = { block: GoalBlock; problem: null } | { block: null; problem: string };

// The blocked reason a spent turn budget writes on the root, the literal
// goal_resume lifts beside "Max rounds reached". It is defined beside the
// activation rule in agent-state.ts, which refuses every leaf while the root
// carries it.
export { TURN_BUDGET_REASON };

// The paused reason the budget block writes on each entry it pauses, so
// goal_resume on the root returns exactly those entries to pending.
export const TURN_BUDGET_PAUSED_REASON = "Paused: Turn budget reached";

// The source a seeded root carries, which no tool writes.
export const ROSTER_SOURCE = "roster";

// The blocked reason the controller writes on a root with done statements
// where it would otherwise complete the root itself: step 3a's unplanned
// completion and the planner's zero-plan reply. Nothing in the controller
// judges whether the statements hold, so the root waits, blocked, for
// goal_done naming it, the one route that completes it.
export const DONE_HOLD_REASON = "Done statements await goal_done";

// Whether the root carries done statements, which hold it for goal_done.
export function holdsForGoalDone(root: GoalNode): boolean {
  return Array.isArray(root.doneWhen) && root.doneWhen.length > 0;
}

// Reads goal.json to its block, or to the reason it seeds nothing: a file
// the host cannot read, text that is not JSON, or a block goalProblem
// refuses. The check is the roster validator's own, so a hand-edited roster
// whose block the validator would refuse seeds nothing here either.
export async function readGoalFile(host: GoalHost, path: string): Promise<GoalFileRead> {
  let text: string;
  try {
    text = await host.readFile(path);
  } catch (err) {
    return { block: null, problem: `unreadable: ${safeErrorText(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { block: null, problem: `malformed: ${safeErrorText(err)}` };
  }
  const problem = goalProblem(parsed);
  if (problem !== null) return { block: null, problem: `refused: goal ${problem}` };
  const block = parsed as { objective: string; done: string[]; turns?: number };
  return {
    block: { objective: block.objective, done: [...block.done], ...(block.turns !== undefined ? { turns: block.turns } : {}) },
    problem: null,
  };
}

// Free text from the roster rendered into a model's context or a record:
// one line, no square brackets, so a statement cannot close a bracketed
// label or open one of its own.
function safeText(text: string): string {
  return bracketSafeText(oneLine(text));
}

// What a session start does with the file against the store's state.
// `seed`: the first-launch branch, where the store names no state for the
// persona, which is the one moment a fresh root is planted.
// `skip-no-root`: a later start whose stored state holds no root, which
// seeds nothing, whatever left the tree empty: a roster edit onto a
// standing persona with no tree, or a start that could not read the store
// and saved its default state once the store healed.
// `skip-same`: the root's objective is the file's, live or complete, since a
// standing persona restarts after every completion and must not run the same
// goal twice. The two are compared under the fold seedRootFrom stores, so a
// root seeded from the file matches the file's raw text, and so does a root
// stored raw.
// `reseed-complete`: the root is complete or abandoned and the file names
// another goal, which replaces the finished tree as goal_create does.
// `skip-live`: the root is open and the file differs, which the operator
// replaces with goal_create.
export type SeedDecision = "seed" | "reseed-complete" | "skip-live" | "skip-same" | "skip-no-root";

export function seedDecision(state: AgentState, block: GoalBlock, firstLaunch: boolean): SeedDecision {
  if (firstLaunch) return "seed";
  const root = state.goals.find((g) => g.parentId === null);
  if (!root) return "skip-no-root";
  if (safeText(root.objective) === safeText(block.objective)) return "skip-same";
  if (root.status === "complete" || root.status === "abandoned") return "reseed-complete";
  return "skip-live";
}

// The root a block seeds: the shape goal_create builds, with the statements
// on doneWhen, the budget on turnBudget and a count of zero where one rides.
// maxRounds is goal_create's default of 10, the round budget each plan under
// the root inherits. The objective and the title cut from it are stored
// folded to one line and bracket-safe, since every goal print, the planner
// prompt and the tool results splice them as stored.
export function seedRootFrom(block: GoalBlock, now: number): GoalNode {
  const objective = safeText(block.objective);
  const root: GoalNode = {
    id: `root-${now.toString(36)}`,
    parentId: null,
    kind: "root",
    title: objective.slice(0, 80),
    objective,
    status: "pending",
    source: ROSTER_SOURCE,
    maxRounds: 10,
    completedRounds: 0,
    scores: [],
    notes: [],
    planningRounds: 0,
    consecutivePlanningFailures: 0,
    consecutiveBlockedPlannings: 0,
    planningRound: 0,
    createdAt: now,
    updatedAt: now,
    doneWhen: [...block.done],
  };
  if (block.turns !== undefined) {
    root.turnBudget = block.turns;
    root.turnsSpent = 0;
  }
  return root;
}

// The goal lines the context block carries for a root with done statements
// or a budget: each statement on its own line, then the turns spent of the
// budget. Empty for a root with neither, which is every root today. A
// statement longer than DONE_STATEMENT_SHOWN_MAX shows cut to that length,
// its last character an ellipsis, so one long statement cannot crowd the
// block; the stored statement stays whole.
export const DONE_STATEMENT_SHOWN_MAX = 300;

// One done statement as every goal print shows it: safe, and cut to
// DONE_STATEMENT_SHOWN_MAX. The planner prompt reads it too.
// The length and the cut count code points, so a surrogate pair is never
// split.
export function shownDoneStatement(statement: string): string {
  const text = safeText(statement);
  const points = Array.from(text);
  return points.length > DONE_STATEMENT_SHOWN_MAX ? `${points.slice(0, DONE_STATEMENT_SHOWN_MAX - 1).join("")}…` : text;
}

export function goalContextText(root: GoalNode | undefined): string {
  if (!root) return "";
  const statements = Array.isArray(root.doneWhen) ? root.doneWhen : [];
  const lines = statements.map((statement) => `- ${shownDoneStatement(statement)}\n`).join("");
  const doneLines = lines === "" ? "" : `Done when:\n${lines}`;
  const budgetLine = typeof root.turnBudget === "number" ? `Turns: ${root.turnsSpent ?? 0} of ${root.turnBudget}\n` : "";
  return doneLines + budgetLine;
}

// The ask the spent budget opens to the operator, naming the goal and the
// count, the call that releases it and the three openers whose turn may make
// that call. The text carries no square bracket, since a goal block renders
// the ask's question through bracketSafeText, so the architect persona's
// QUEUE record is named without the brackets its label wears.
export function turnBudgetAskText(root: GoalNode): string {
  return `Turn budget reached: ${root.turnsSpent ?? 0} of ${root.turnBudget ?? 0} turns spent on goal "${safeText(root.objective)}". Resume it with goal_resume ${root.id} in a turn the operator, the coordinator persona or the architect persona's QUEUE record started, which grants the same budget again, or leave it blocked.`;
}

// The refusal goal_resume gives on any entry but the root while the turn
// budget blocks the root, the call naming no entry among them, so no work
// starts outside the budget. Lifting the root's block is the one release.
export function turnBudgetResumeRefusedText(rootId: string): string {
  return `Refused: the turn budget blocks root ${rootId}, so no entry under it resumes. Release the budget with goal_resume ${rootId} in a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started, which returns the paused entries to pending.`;
}

// The record the completed root of a goal-lifetime persona sends the
// coordinator persona, whose fleet_retire disables the entry in the roster.
export function retireRecordText(persona: string, root: GoalNode): string {
  return `[RETIRE] Persona '${safeText(persona)}' completed its goal "${safeText(root.objective)}" and its roster entry carries lifetime goal, so retire the entry with fleet_retire. Its store, memory and run directory stay.`;
}
