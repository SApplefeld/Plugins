// plan-route.ts: the plan route: how a path under the session directory is read as a plan
// document, the one-line texts a plan document is quoted by, and the bounds the
// plan walk and plan health request carry.
//
// No import of the engine handle and no state of its own: every function takes what it
// reads as arguments, so the tick harness, which loads a fresh hooks/index.ts per
// case, shares nothing through it.

import { type AgentState, bracketSafeText, type GoalNode, oneLine, PLAN_PATH_PATTERN, resolvePlanPath } from "./agent-state";

// The plan health request: block-owner, asked at a plan entry's turn end.
// The journal site its call line carries.
export const PLAN_HEALTH_SITE = "plan-health";

// How many of an entry's closing texts the request's state carries, and the
// most characters any closing text carries in that state: the one cut bounds
// the request's closingText, each entry of its recent list, and so the
// journal's state column, which is exempt from the field clamp.
export const PLAN_HEALTH_RECENT_MAX = 5;

export const PLAN_HEALTH_TEXT_MAX = 1000;

// Section 6 (goal-every-turn): the plan documents this turn wrote or edited, as
// the model wrote them, in call order. It sits beside TurnToolFlags (hooks/turn-state-text.ts) rather
// than inside them because route one of the promotion routes needs the path
// itself and a boolean cannot carry one: the record it promotes stores that
// path, and the entry it adds is judged against the document the path names.
// Held as turnPlanEditedPaths in hooks/index.ts, reset and written where the
// flags are, so it is the same turn's reading.
//
// The turn's edits are kept rather than one value, because the one route one
// wants is the first that its own match accepts and this path cannot run that
// match: the working directory the match needs is a host call, and the
// per-tool-call path makes none. A turn whose first plan edit is another
// checkout's spec and whose second is this directory's own would otherwise
// promote nothing. Route one takes the first of these it accepts, so a turn that
// writes its own plan document and then touches a second one (an archive move,
// another worker's spec) is still promoted on the first.
//
// The list is bounded the way TURN_TOOL_RING_MAX (hooks/turn-state-text.ts) bounds the ring, and the bound drops the
// latest edits rather than the earliest, since the earliest that matches is the
// one route one wants.
// It is exported so the leg that drives a turn past the bound counts to the
// bound the code holds rather than to a literal of its own.
export const TURN_PLAN_EDITS_MAX = 8;

// Whether a tool argument names a plan document: a file directly under a
// docs/plans/ directory, at any depth and with either separator, whose
// docs/plans/ suffix is a name PLAN_PATH_PATTERN accepts once the separators
// read as forward slashes. The path is read as the model wrote it, absolute
// or relative, since this flag is a reading of what the turn touched rather
// than the promotion route's own match, which is section 6's and resolves
// the path against the working directory first.
export function namesPlanDocument(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const suffix = /(^|[\\/])(docs[\\/]plans[\\/][^\\/]+)$/.exec(value);
  return suffix !== null && PLAN_PATH_PATTERN.test(suffix[2].replace(/\\/g, "/"));
}

// Section 6 (goal-every-turn): the project-relative plan path a tool argument
// names under `cwd`, or null where it names none. This is route one's own
// match, stricter than namesPlanDocument above in the one way that matters:
// the document has to be this working directory's, since the path becomes a
// plan entry's planPath and every later reader joins that value back onto the
// working directory to read the file.
//
// Both sides are read as text and nothing is resolved against the filesystem,
// which the plugin loader offers no path API for. Separators are folded to "/"
// on both sides, since this host's own paths carry "\" and the store's pattern
// admits neither separator inside a name. A path already relative is relative
// to cwd by definition and is tested as it stands, past any leading
// current-directory segment. An absolute one keeps only what follows the
// directory's own prefix, the trailing-separator-plus-"/" rule the plan reader's
// join uses, so the strip and that join are inverses.
//
// PLAN_PATH_PATTERN on the remainder is what makes the strip safe, and it is
// the only guard here: it is anchored at both ends and admits no separator and
// no "." segment inside the name, so every path that escapes the directory
// fails it rather than being admitted. "D:/root/../other/docs/plans/a.md"
// leaves "../other/docs/plans/a.md", "D:/root/x/../docs/plans/a.md" leaves
// "x/../docs/plans/a.md", and a path under another checkout keeps its whole
// absolute self; none of the three matches.
//
// The whole prefix comparison folds case where both sides are drive-rooted,
// because a Windows path names one file whichever case any of its segments
// carries and the model writes the directory either way. Where the path starts
// with "/" the comparison stays case-sensitive, since on a case-sensitive host
// "/home/Root" and "/home/root" are two directories. The remainder is sliced
// out of the path as the model wrote it and still read by PLAN_PATH_PATTERN
// case-sensitively, so the fold reaches the directory's own prefix and never
// admits "DOCS/PLANS/a.md" as the name of a plan document.
//
// It is exported for the unit pins over these shapes: the function is two
// strings in and one out, and the hook path that feeds it is pinned by legs of
// its own.
export function planPathUnderCwd(filePath: string, cwd: string): string | null {
  const slashed = filePath.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  const rooted = /^([A-Za-z]:|\/)/.test(slashed);
  let candidate: string;
  if (!rooted) {
    // A relative path the model wrote as "./docs/plans/x.md", or with this host's
    // separators as ".\docs\plans\x.md", names the file the bare form names, so
    // the leading current-directory segments come off before the pattern reads
    // it. Only "./" comes off: a "../" segment leaves this directory, and the
    // pattern below refuses what is left of it as it refuses every other escape.
    candidate = slashed.replace(/^(?:\.\/)+/, "");
  } else if (slashed.startsWith(root)) {
    candidate = slashed.slice(root.length);
  } else if (driveRooted(slashed) && driveRooted(root)
    && slashed.toLowerCase().startsWith(root.toLowerCase())) {
    candidate = slashed.slice(root.length);
  } else {
    return null;
  }
  return PLAN_PATH_PATTERN.test(candidate) ? candidate : null;
}

// Whether a path leads with a drive letter, which is what makes its comparison
// above a case-folding one. A path leading with "/" does not.
function driveRooted(path: string): boolean {
  return /^[A-Za-z]:/.test(path);
}

// The entry an answered ask named, at the ask's close. An ask leaves its
// entry active, so the close moves no status, demotes no other entry and
// points activeGoalId nowhere: the open blocking ask was the hold, and its
// close or lift ends it. What it does clear is a blockedReason left on an active
// entry, which only a store written by a controller that paused on an ask
// carries, since an active entry has no reason to be blocked. A paused
// entry keeps its reason, which the operator or a plan switch wrote and
// goal_resume reads back.
export const reactivateAskedEntry = (askedNode: GoalNode): void => {
  if (askedNode.status === "active" && askedNode.blockedReason !== undefined) {
    askedNode.blockedReason = undefined;
    askedNode.updatedAt = Date.now();
  }
};

// Section 2 (plan-health-from-the-record): a plan entry is an entry that has
// a plan by resolvePlanPath's ancestor rule, whatever its kind, so a task a
// worker adds under its plan node is one too. A plan entry is judged from its
// plan document rather than from a count of turns: its completedRounds is
// never incremented, the round-budget block never applies to it, and its
// maxRounds is neither read nor changed.
export const isPlanEntry = (state: AgentState, g: GoalNode): boolean =>
  resolvePlanPath(state, g) !== undefined;

// The round text the controller's idle summary and its skip-hash subset
// carry for an entry. A task entry reads its budget; a plan entry has none.
export const roundSummaryText = (state: AgentState, g: GoalNode): string =>
  isPlanEntry(state, g) ? "plan entry, no round budget" : `round ${g.completedRounds}/${g.maxRounds}`;

// How long the git read under a plan document's directory may run before
// $.process.run kills it and rejects. git status on one checkout answers well
// inside this, and the bound keeps a hung git from holding the turn end.
export const PLAN_CHECKOUT_TIMEOUT_MS = 5_000;

// The objective a plan's closing leaf carries, exactly, with the plan's own
// planPath. The walk up adds one such leaf under a plan it holds open, so the
// plan keeps an entry the controller can activate and nudge on, and this text
// alone tells the leaf apart from any other child.
export function closingLeafObjective(planPath: string): string {
  return `Set ${planPath} Status to Complete`;
}

// A plan document's Status value as the walk up and goal_done quote it: one
// line, its brackets neutralized, cut to 80 characters, since the value is
// text a repository supplies and reaches the model.
export function planStatusText(status: string): string {
  return bracketSafeText(oneLine(status)).slice(0, 80);
}

// The finish-the-document sentence goal_done's answer carries for a plan held
// open, both where the walk up holds it and where goal_done refuses the plan's
// closing leaf.
export function planLeftOpenText(plan: GoalNode, status: string): string {
  return ` ${plan.id} "${plan.title}" stays open: its plan document reads Status: ${status}, and it completes once the document reads Complete.`;
}
