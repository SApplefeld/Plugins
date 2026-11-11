// effort-texts.ts: the fixed refusal texts the new-effort gate and the goal
// tools give, and the record text goal_add sends the coordinator persona,
// for hooks/index.ts, which imports these by name. Pure text.

// The one refusal the four acts that start a new effort give outside a turn
// the operator, the coordinator persona or the architect persona's [QUEUE]
// record started, or, for the architect persona's own goal_create and
// goal_add of a plan, a worker's record.
export const EFFORT_REFUSED_TEXT =
  "Refused: a new effort starts only in a turn the operator, the coordinator persona or the architect persona's [QUEUE] record or, for the architect persona, a worker's record started, and this turn is none of them for this act. " +
  "An act the operator, the coordinator persona or the architect persona's [QUEUE] record directed is retried in a turn one of them opens, not proposed. " +
  "An operator-class message from the persona's thread that arrived during this turn is re-prompted by the plugin as a turn of its own, at the first turn end that can take it, so finish this step and take the act up there. " +
  "Send any other idea to the coordinator persona with agentic_say, opening the text with [PROPOSAL].";

// The one refusal goal_autonomy gives outside a turn the operator started.
// A coordinator delivery is refused too, so a level in the store is always
// one the operator set.
export const AUTONOMY_REFUSED_TEXT =
  "Refused: the autonomy level is the operator's to set, in a turn the operator starts on this persona's own thread, " +
  "and this turn is not one. " +
  "An operator-class message from the persona's thread that arrived during this turn is re-prompted by the plugin as a turn of its own, at the first turn end that can take it, and the operator's word on the level is taken up there. " +
  "Any other setting waits for the operator's own word, so ask the operator to set it.";

// The one refusal goal_resume gives on an entry awaiting the operator's yes,
// or a node under one, outside a turn the operator, the coordinator persona
// or the architect persona's [QUEUE] record started.
export const AWAITING_YES_RESUME_REFUSED_TEXT =
  "Refused: this entry waits for the operator's word, or sits under a plan that does, and only a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started may resume it. " +
  "An operator-class message from the persona's thread that arrived during this turn is re-prompted by the plugin as a turn of its own, at the first turn end that can take it, so a yes in it is taken up there. " +
  "It stays as it is until that word reaches you.";

// The refusal goal_add gives a plan the autonomy level admitted when the
// record telling the coordinator persona about it cannot be written. `cause`
// names which of the three roads failed.
export function unpromptedPlanRefusedText(cause: string): string {
  return `Refused: the plan was not added, because the record telling the coordinator persona about it could not be written: ${cause}. ` +
    "Nothing was added to the goal tree.";
}

// The refusal goal_add gives when the record could not be written after the
// entry was saved and the save that takes the entry back out did not land
// either, so the store may still hold the entry.
export function unpromptedPlanNotUndoneText(cause: string, nodeId: string): string {
  return `Refused: the record telling the coordinator persona about the plan could not be written: ${cause}. ` +
    `Taking the entry back out was not saved, so entry ${nodeId} may remain in the store.`;
}

// The one refusal goal_edit drop gives on an entry awaiting the operator's
// yes outside a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started.
export const AWAITING_YES_DROP_REFUSED_TEXT =
  "Refused: this entry waits for the operator's word, and only a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started may drop it. " +
  "An operator-class message from the persona's thread that arrived during this turn is re-prompted by the plugin as a turn of its own, at the first turn end that can take it, so a word to drop it is taken up there. " +
  "It stays paused until that word reaches you.";

// The one refusal goal_edit drop gives on a plan's open closing leaf.
export const CLOSING_LEAF_DROP_REFUSED_TEXT =
  "Refused: this entry closes itself once its plan's document reads Complete. " +
  "Dropping it would leave the plan with no entry the controller can reach. " +
  "To give up the plan, drop the plan entry itself.";

// The one refusal goal_edit pause gives a call with no releasedBy, or with a
// value outside the releaser set.
export const PAUSE_RELEASER_REFUSED_TEXT =
  "Refused: a pause names who releases it, and this call's releasedBy names nobody. " +
  "Pass releasedBy as operator, coordinator or a persona's name, the party whose act lets the entry move again. " +
  "Work that only waits its turn stays pending and is ordered with goal_edit reprioritize. " +
  "Nothing was changed.";

// The one refusal goal_edit drop gives on a plan entry in a turn that could
// not add a plan, so no turn drops an entry it could not put back.
export const PLAN_DROP_REFUSED_TEXT =
  "Refused: a plan entry is not dropped in a turn that could not add it again, and this turn could not. " +
  "A paused entry returns to pending with goal_edit repend, which keeps the entry and its place. " +
  "An amended plan changes no entry, so read the plan at its branch's new tip and leave the entry as it is.";

// The one refusal goal_edit repend gives on an entry that is not paused.
export const REPEND_NOT_PAUSED_REFUSED_TEXT =
  "Refused: repend returns a paused entry to pending, and this entry is not paused. " +
  "Nothing was changed.";

// The refusal goal_edit repend gives while the turn budget blocks the root,
// where goal_resume of the same entry is refused too. The handler names the
// root's id after it.
export const REPEND_TURN_BUDGET_REFUSED_TEXT =
  "Refused: the turn budget blocks the root, so no entry under it returns to pending by repend. " +
  "Release the budget with goal_resume of the root in a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started, which returns the entries the budget paused to pending.";

// The one refusal goal_edit repend gives on an entry awaiting the operator's
// yes, or a node under one, outside a turn the operator, the coordinator
// persona or the architect persona's [QUEUE] record started, where
// goal_resume of the same entry is refused too.
export const AWAITING_YES_REPEND_REFUSED_TEXT =
  "Refused: this entry waits for the operator's word, or sits under a plan that does, and only a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started may return it to pending. " +
  "An operator-class message from the persona's thread that arrived during this turn is re-prompted by the plugin as a turn of its own, at the first turn end that can take it, so a yes in it is taken up there. " +
  "It stays as it is until that word reaches you.";

// The one refusal goal_done by name gives on an entry awaiting the operator's
// yes, or on a node under one, outside a turn the operator, the coordinator
// persona or the architect persona's [QUEUE] record started.
export const AWAITING_YES_DONE_REFUSED_TEXT =
  "Refused: this entry waits for the operator's word, or sits under a plan that does, and only a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started may complete it. " +
  "An operator-class message from the persona's thread that arrived during this turn is re-prompted by the plugin as a turn of its own, at the first turn end that can take it, so a word to complete it is taken up there. " +
  "It stays as it is until that word reaches you.";

// The one sentence a turn carries after the operator's [PAUSE] line paused
// the plan holder and its leaf, and the one after a [RESUME] line resumed
// them. The hook fills {entries} with the ids it changed, in order.
export const OPERATOR_LINE_PAUSED_TEXT = "The [PAUSE] line this turn opens with has paused {entries}; a paused entry starts no step until resumed.";
export const OPERATOR_LINE_RESUMED_TEXT = "The [RESUME] line this turn opens with has resumed {entries}; the leaf is active again and its work continues from where the pause left it.";

// The record goal_add sends the coordinator persona for a plan the autonomy
// level admitted outside the operator's and the coordinator persona's turns:
// a [PROPOSAL] at plan-and-ask, whose entry waits for the operator's yes, and
// a [STARTED] at plan-and-start. The plan document clause is left out where
// the add carried no planPath.
export function unpromptedPlanRecordText(awaitingYes: boolean, persona: string, nodeId: string, title: string, planPath: string | undefined): string {
  const doc = planPath ? `, plan document ${planPath}` : "";
  return awaitingYes
    ? `[PROPOSAL] ${persona} queued plan entry ${nodeId} "${title}"${doc}. It waits paused for the operator's yes. ` +
      `On a yes, tell ${persona} to goal_edit repend ${nodeId}; on a no, tell it to goal_edit drop ${nodeId} with the reason.`
    : `[STARTED] ${persona} queued plan entry ${nodeId} "${title}"${doc} to start on its own, under the plan-and-start autonomy level.`;
}
