// question-catalog.ts: the wording of every closed question this plugin puts
// to Jev, in two layers. The shipped defaults are the constants below. An
// override layer outside the repository can replace one, so a later plan can
// revise a question without shipping a release.
//
// It is also the single source of the label arrays the three $.model.classify
// sites in hooks/index.ts pass to Haiku. What those two share is the option
// ids and their order, single-sourced here so the ids Haiku is offered and
// the ids Jev is offered cannot drift. Each site's prompt prose names some of
// those ids again in its own sentences, and nothing pins that second copy; a
// drift there lands in the wording rather than in the offered ids, so the
// agreement figure survives it. The
// wording around the ids differs by design, since Haiku reads a prompt and Jev
// reads a description per option. The ids are the part that must not drift: an
// agreement in the decision journal is exact equality of option id between
// Haiku's answer and Jev's, so a drift there would make every agreement figure
// meaningless.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts and refuses the whole module
// where `$` crosses an import, so this file takes a CatalogHost instead: three
// members of the PluginHost that hooks/index.ts builds over `$` in its
// top-level hostOf adapter.
//
// The resolver never rejects. A resolver failure the seam cannot name lands as
// its `no_question` reason, which exists for a resolver it cannot trust; this
// catalog's own contract is to fall back to the shipped default on every
// failure and report why. Nothing here throws into a controller tick.

import type { PluginHost } from "./host";
import { SCORE_MIN_LEVELS, SCORE_MAX_LEVELS, type ChoiceQuestion, type ResolvedQuestion, type QuestionResolver } from "./decision-seam";
import { bracketSafeText, LINE_TERMINATOR } from "./agent-state";

// --- The label arrays the three classify sites pass to Haiku ---
//
// Frozen at their declaration, in the same shape hooks/index.ts and
// hooks/self-review.ts already ship and load as new Set([...]). The freeze is
// load-bearing rather than tidy: each classify site used to build a fresh
// array literal per call and now passes this one shared constant, and
// $.model.classify is an op event that hands its labels to any co-loaded hook.
// A hook mutating the array in place would otherwise corrupt what Haiku is
// offered for the process lifetime rather than for one call, which is the
// drift this module exists to prevent. Its readonly annotation is a compile
// -time thing only and stops nothing at runtime.
//
// Values and order are the shipped Haiku behavior. Changing either changes
// what the classifier is offered and what it answers, so neither is free.
// The scorer pair's second member is the superset: the scorer offers
// `off-goal-by-instruction` only on a turn that was not nudged. The
// controller's superset is CONTROLLER_OPTIONS, and the tick builds the ids
// in force from it per tick. The catalog set holds the superset with a
// description per option, and the caller names the ids in force at request
// time.

// The controller's decision on an idle worker: the four decisions the
// controller acts on, each named for the action it selects, in the order the
// state's option list and the classify call carry them. The superset.
// `complete` is offered only on a task entry, since a plan entry's done is
// read from its plan document, and `switch` only where a pending plan exists.
export const CONTROLLER_OPTIONS: readonly string[] = Object.freeze(["nudge", "idle-gap-nudge", "complete", "switch"]);
// The ids in force for one tick: the superset less the options the entry
// does not offer. A fresh frozen array per call, so a hook mutating what the
// classify op handed it corrupts one tick's array and never a shared one.
export function controllerLabelsOf(taskEntry: boolean, pendingPlan: boolean): readonly string[] {
  return Object.freeze(CONTROLLER_OPTIONS.filter((id) => (id !== "complete" || taskEntry) && (id !== "switch" || pendingPlan)));
}

// The turn scorer on a turn the plugin nudged: a worker answering our own
// nudge cannot be off goal by the operator's instruction.
export const SCORER_LABELS_AFTER_NUDGE: readonly string[] = Object.freeze(["on-goal", "drift", "complete"]);
// The turn scorer on a turn the plugin did not nudge. The superset.
export const SCORER_LABELS: readonly string[] = Object.freeze(["on-goal", "off-goal-by-instruction", "drift", "complete"]);

// The memory-curation gate. One array, no variants.
export const MEMORY_KIND_LABELS: readonly string[] = Object.freeze(["fact", "preference", "lesson", "discard"]);

// --- The four question sets ---
//
// Each id is the join key between this catalog and the decision journal, and
// it is a wire value: the seam sends it as the request's question key and the
// vendor returns the answer under it. So an id is stable once shipped.
export const CONTROLLER_DECISION = "controller-decision";
export const PLAN_SWITCH = "plan-switch";
export const TURN_SCORE = "turn-score";
export const MEMORY_KIND = "memory-kind";

// --- The plan health set ---
//
// Block-owner is asked at the end of every turn on an entry that carries a
// plan document. It has no Haiku counterpart: no classify call asks it, and
// nothing branches on its answer. What it is measured against is the
// next_speaker outcome the plugin observes for itself afterwards, which the
// decision journal records as an outcome line.
export const BLOCK_OWNER = "block-owner";

// --- The retired sets ---
//
// Three retired plan health questions: whether the worker says it cannot
// carry on, where its last few turns sit between closing out and reopening,
// and whether work should continue on its own. Their ids are not in
// QUESTION_SET_IDS or SHIPPED_QUESTIONS, so the resolver answers each with
// UNKNOWN_QUESTION and the seam refuses a request naming one as
// no_question. The journal holds their calls, answers and outcomes, so
// .kit/jev-gold/sample.mjs, the journal's reader, admits these ids to draw
// from that history.
export const WORKER_BLOCKED = "worker-blocked";
export const ROUNDS_CONVERGING = "rounds-converging";
export const WORK_CONTINUES = "work-continues";
export const RETIRED_SET_IDS: readonly string[] = Object.freeze([WORKER_BLOCKED, ROUNDS_CONVERGING, WORK_CONTINUES]);

// The block owner's options, which are this catalog's own. The plugin and the
// replay both offer the shipped entry's option ids; this constant is the
// closed vocabulary a load and the rubric check read, and Test 2e2 pins it
// equal to those ids in order.
export const BLOCK_OWNER_OPTIONS: readonly string[] = Object.freeze(["operator", "coordinator", "another-plan", "self-resolving", "none"]);

// The fields of the plan health state. The state is an object and the
// question reads the field it needs by name (https://docs.typesafe.ai/api.md,
// on structured instructions). `closingText` is the turn's own closing text,
// which block-owner's instructions name, and `recentClosingTexts` the
// entry's last few, oldest first.
export const PLAN_HEALTH_STATE_CLOSING = "closingText";
export const PLAN_HEALTH_STATE_RECENT = "recentClosingTexts";

// The plan switch is the one set whose options are not all the catalog own:
// the rest are the pending plan ids the caller supplies per request. This is
// the option that covers none of them, and the wiring in hooks/index.ts sends
// it as an offered id and records it as Haiku value where no plan matched, so
// the two files are pinned to one spelling rather than two literals.
export const PLAN_SWITCH_NO_MATCH = "no_match";

// --- The two turn record sets ---
//
// Asked about the message that opens a turn and about how the turn ended,
// over the turn record the plugin holds beside the goal tree. Neither has a
// Haiku counterpart. Each goes through liveAsk in hooks/index.ts, the one
// wrapper whose answer a branch may read, and is read only where the live
// list that wrapper is handed names it; otherwise it is asked in shadow and
// its answer reaches nothing. Each is measured against an outcome the plugin
// observes afterwards: record_delivered_within for the open, next_prompt_kind
// for the disposition.
export const TURN_OPEN = "turn-open";
export const TURN_DISPOSITION = "turn-disposition";

// The sets a settings live list may name: a live answer is read into a
// branch by option id, so only a set whose ids are this catalog's own and
// whose promotion bar is stated is here. The constant enforces nothing by
// itself. The read that turns the settings value into the list liveAsk is
// handed is where an id outside this set is dropped, and liveAsk checks
// membership in that list alone. The memory kind is here because the memory
// site reads its live answer as a gate ahead of the Haiku classify, and its
// promotion bar is the shadow journal's count of what that gate would skip.
// The turn score is here because the scoring site reads its live answer as
// the turn's label in place of Haiku's, and its promotion bar is the gold
// pass's agreement with the hand labels. The controller decision is here on
// the same ground: the tick reads its live answer as the decision in place
// of Haiku's, and its promotion bar is the gold pass's agreement on version
// 3 calls. The three memory sets below are
// absent: each is asked in shadow, and its promotion is a ruling on a gold pass.
export const PROMOTABLE_SET_IDS: readonly string[] = Object.freeze([TURN_OPEN, TURN_DISPOSITION, MEMORY_KIND, TURN_SCORE, CONTROLLER_DECISION]);

// Each set's option ids in force, the caller's one constant, journaled as a
// closed vocabulary the way BLOCK_OWNER_OPTIONS is, and here also the ids
// offered to Jev.
export const TURN_OPEN_OPTIONS: readonly string[] = Object.freeze(["new-goal", "step", "continuation"]);
export const TURN_DISPOSITION_OPTIONS: readonly string[] = Object.freeze(["delivered", "mid_work", "blocked_or_waiting"]);

// A live turn-disposition answer reads as delivered where its probability on
// `delivered` is at or above this, and as not delivered below it.
export const TURN_DELIVERED_THRESHOLD = 0.5;
// How many of the persona's own turns a record_delivered_within outcome waits
// for the record to reach delivered before it is written false.
export const RECORD_OUTCOME_TURNS = 3;

// --- The three memory sets ---
//
// Asked about a persona's stored memory, each over a state whose fields the
// caller writes under the constants below. memory-value's state is one text
// with each field on a line of its own, opened by its field name, since it is
// asked through the seam's `ask` entry point, which takes a string. None has a
// Haiku counterpart, and each is asked in shadow. Each is measured against an
// outcome the plugin writes true or false.

// Asked of a memory candidate before it is stored: would a future session act
// differently for having it. Measured against applied_since_call, whether the
// record was stamped applied at or after the call.
export const MEMORY_VALUE = "memory-value";
// Asked of each recall candidate before a prompt reaches the model: does this
// record change what the session should do next. Measured against
// recall_acted, whether the session opened the record or stamped it applied
// before its next prompt.
export const MEMORY_RECALL = "memory-recall";
// Asked of a record whose trigger matched a command: does it bear on that
// command so that a nudge to open it is warranted. Measured against
// nudge_acted, whether the session opened the record within three tool calls.
export const MEMORY_RECOGNITION = "memory-recognition";

// Each memory set's option ids, the caller's one constant, journaled as a
// closed vocabulary the way TURN_OPEN_OPTIONS is.
export const MEMORY_VALUE_OPTIONS: readonly string[] = Object.freeze(["keep", "keep-as-preference", "discard"]);
export const MEMORY_RECALL_OPTIONS: readonly string[] = Object.freeze(["show", "hold"]);
export const MEMORY_RECOGNITION_OPTIONS: readonly string[] = Object.freeze(["nudge", "skip"]);

// The fields of the memory-value state: the candidate's text, which text that
// is, the text that opened the turn, how the turn ended, the active goal's
// title, and the name the record is stored under. The candidate is the fact
// the turn distilled, with the source `distilled`, or the turn's exchange
// where the kind gate or the distill discarded it, with the source
// `exchange`, so a gold pass scores the two populations apart. The name is
// empty wherever no record was stored. The accuracy population is source
// `distilled` with a non-empty record name: a passive reader's turn and a
// failed write are asked on a distilled fact with an empty name, stored no
// record, and fall outside it.
export const MEMORY_VALUE_STATE_CANDIDATE = "candidateText";
export const MEMORY_VALUE_STATE_SOURCE = "candidateSource";
export const MEMORY_VALUE_STATE_TRIGGER = "turnTrigger";
export const MEMORY_VALUE_STATE_OUTCOME = "turnOutcome";
export const MEMORY_VALUE_STATE_GOAL = "activeGoalTitle";
export const MEMORY_VALUE_STATE_RECORD = "recordName";
// The fields of the memory-recall state: the head of the prompt, then the
// candidate record's name, description, tags and the first 600 characters of
// its body, then which list the candidate came from. The source is `judged`
// for a record only today's memq judged read returned, `procedure` for one
// only usp_Recall returned, and `both` for one on both lists, so a gold pass
// scores the two retrievals apart; the question's instructions do not name
// it, since where a record came from says nothing about whether it bears on
// the prompt.
export const MEMORY_RECALL_STATE_PROMPT = "promptHead";
export const MEMORY_RECALL_STATE_RECORD = "recordName";
export const MEMORY_RECALL_STATE_DESCRIPTION = "description";
export const MEMORY_RECALL_STATE_TAGS = "tags";
export const MEMORY_RECALL_STATE_BODY = "bodyHead";
export const MEMORY_RECALL_STATE_SOURCE = "recallSource";
// The fields of the memory-recognition state: the trigger that matched, then
// the matched record's name and description. There is no field for the
// command: no hook sends a tool call's command off the machine, so the state
// carries the trigger, which is the record's own text, and nothing of the
// command it was found in.
export const MEMORY_RECOGNITION_STATE_TRIGGER = "trigger";
export const MEMORY_RECOGNITION_STATE_RECORD = "recordName";
export const MEMORY_RECOGNITION_STATE_DESCRIPTION = "description";

// --- The step watch's set ---
//
// Asked in shadow at every fourth step whose response carried an answer,
// counting only those steps, over the objective of the entry active at that
// step and the head of that answer: is the turn still on the objective
// mid-way. No Haiku counterpart asks it and no branch reads its answer. A
// call that asked about the entry the turn scorer labels is measured against
// the label the scorer gives the whole turn, which hooks/index.ts writes as
// its turn_score_label outcome at the turn's end.
export const STEP_DRIFT = "step-drift";
export const STEP_DRIFT_OPTIONS: readonly string[] = Object.freeze(["on-goal", "drift"]);

// --- The compaction pass's set ---
//
// Asked on the module's timer, never inside a hook, of each tool result older
// than the tail the pass keeps whole, over toolResultStaleStateText's state:
// the tool, the head of its input, the head and size of its result, whether
// it errored, how many messages old it is, and whether a later message names
// a path or identifier from its input. No Haiku counterpart asks it and no
// live list may name it: its verdicts are Jev's alone, cached per result and
// applied by the pass, in shadow until the operator's ruling. A verdict on a
// holdout stamp is journaled and applied as keep.
export const TOOL_RESULT_STALE = "tool-result-stale";
export const TOOL_RESULT_STALE_OPTIONS: readonly string[] = Object.freeze(["keep", "cut", "drop"]);

export const QUESTION_SET_IDS: readonly string[] = Object.freeze([
  CONTROLLER_DECISION, PLAN_SWITCH, TURN_SCORE, MEMORY_KIND,
  BLOCK_OWNER,
  TURN_OPEN, TURN_DISPOSITION,
  MEMORY_VALUE, MEMORY_RECALL, MEMORY_RECOGNITION,
  STEP_DRIFT,
  TOOL_RESULT_STALE,
]);

// The sets asked at a plan entry's turn end, in the order the request
// carries them: block-owner alone.
export const PLAN_HEALTH_SET_IDS: readonly string[] = Object.freeze([BLOCK_OWNER]);

// The version label a shipped default carries into the journal, where its
// entry names no later one. An override carries its own label instead.
export const SHIPPED_VERSION = "v1";

// A Choice takes up to 255 options (https://docs.typesafe.ai/primitives/choice.md).
// The lower bound is this catalog's own judgment rather than the vendor's: a
// question whose options are all the catalog's has no judgment in it with only
// one. It therefore applies to the fixed sets and not to the plan
// switch, whose other options arrive per request. See overrideProblem.
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 255;

// The Choice sets whose options are this catalog's own, so an override that
// changes the set of option ids is refused: the journal's agreement figure
// compares Jev's option id against Haiku's, and Haiku's come from the label
// arrays above. The block owner has no Haiku answer to agree with and is
// here for the other half of the same reason: its ids are the caller's one
// constant, and a load reads that column as a closed vocabulary. The two turn
// record sets are here on that ground and one more: a live answer's choice is
// read into a branch by option id. The three memory sets are here on the
// block owner's ground: each set's ids are its caller's one constant, and a
// load reads that column as a closed vocabulary. The step watch's set is here
// on the same ground, and so is the compaction pass's set, whose verdict the
// pass reads into an apply by option id. The plan switch is absent
// because its option ids are the caller's pending plan ids rather than the
// catalog's.
export const FIXED_OPTION_SETS: readonly string[] = Object.freeze([
  CONTROLLER_DECISION, TURN_SCORE, MEMORY_KIND, BLOCK_OWNER, TURN_OPEN, TURN_DISPOSITION,
  MEMORY_VALUE, MEMORY_RECALL, MEMORY_RECOGNITION,
  STEP_DRIFT, TOOL_RESULT_STALE,
]);

// A Score's levels are positions rather than names, so what an override of
// one must keep is their count: the journal records a level number and a load
// reads it against the levels the question shipped with. An override that
// rewords the levels of a Score listed here is admitted; one that adds or
// drops a level is refused. No shipped question is a Score, so the list is
// empty, and a Score that ships later is listed here with it.
export const FIXED_LEVEL_SETS: readonly string[] = Object.freeze([]);

// The shipped defaults. Instructions are one snap judgment each, which is
// what a System One model is built for, and every option carries a one-line
// description, which is what the vendor's Choice page asks for.
export const SHIPPED_QUESTIONS: Readonly<Record<string, ResolvedQuestion>> = {
  // v3: asked over controllerStateText's state, the controller's own facts,
  // the worker's last answer and the pending plans, with the option list
  // embedded as the last part. Each option is a decision the controller acts
  // on directly, with no rewrite between the answer and the act, and each
  // description carries the nearest cases that are still this option or that
  // belong to a neighbour, since those are where the answer is decided.
  [CONTROLLER_DECISION]: {
    id: CONTROLLER_DECISION,
    version: "v3",
    overrideRefused: null,
    primitive: "choice",
    instructions: "An autonomous worker session has gone idle. Given its goal, its recent scores, how long it has been idle and its last answer, which action should the controller take now?",
    options: {
      "nudge": "Send the plain nudge, which names the idle time and tells the worker to re-read the objective and take the next concrete step. The worker is on the objective and either has a next step or is honestly waiting on work of its own for it: it reported a step done and the plan holds the next one, it ended on an intermediate status, or it waits on an implementer, a reviewer, a test run or a workflow it dispatched for this objective, whether or not the last answer shows that wait ending. A plan entry whose work reads finished still takes this, since on a plan entry complete is not offered. A wait on something that is not coming, or on a person, is idle-gap-nudge, not this.",
      "idle-gap-nudge": "Send the idle-gap nudge, which tells the worker the controller read no real fork, to re-read the plan document, and to state any genuine fork as a line ASK: <question>? Recommend: <choice>; nobody is asked unless the worker writes that line. The worker is stalled: its last answer says it needs a decision or reports a blocker it cannot clear itself, it waits on a person or on another session rather than on work it dispatched, it repeats the same step or the same wait across nudges with no progress, or it is working on something other than the objective the state names. A first wait on the worker's own dispatched work is nudge, not this.",
      "complete": "Mark the goal done now and activate the next one: a task entry whose objective the last answer shows finished in full. Offered only on a task entry, since a plan entry's done is read from its plan document. A step, a section, a review round or a commit landed with the objective still open is nudge, not this.",
      "switch": "Set the current goal aside and activate one of the pending plans the state lists: the current goal cannot move while a pending plan can, the operator has set the current plan aside, or the worker itself says a pending plan is the one to take up. Offered only where the state lists pending plans. A current goal waiting on an approval its own order requires before the next plan is idle-gap-nudge, not this.",
    },
  },
  [PLAN_SWITCH]: {
    id: PLAN_SWITCH,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: "The controller has decided to switch plans. Which of the pending plans listed in the state should the worker take up next?",
    // The only option this catalog owns. The rest are the pending plan ids the
    // caller supplies at request time, which have no catalog description and
    // ride the request with null. So this map is one entry, and an override of
    // this set is floored at one for the same reason rather than at
    // MIN_OPTIONS, which bounds the sets whose options are all the catalog's.
    options: {
      [PLAN_SWITCH_NO_MATCH]: "None of the pending plans fits.",
    },
  },
  // v2: asked over turnScoreStateText's state, the opening prompt, the answer,
  // the objective and the Tools line, with no question sentence in the state.
  // Each description carries the nearest cases that are still this option or
  // that belong to a neighbour, since those are where the answer is decided.
  [TURN_SCORE]: {
    id: TURN_SCORE,
    version: "v2",
    overrideRefused: null,
    primitive: "choice",
    instructions: "Given the goal objective, what did this turn's answer do about it?",
    options: {
      "on-goal": "The answer moved the objective forward or kept it correctly in hand. That includes a step taken, a commit, a dispatch, or a section or review round landed while the objective still has work left. It includes a WAITING or BLOCKED turn whose wait is on the worker's own work for the objective, such as its implementer, reviewers, test run or QA check, even where the turn only checked that this work is still alive, and a hold that names what blocks the objective. A turn opened by a task notification or a channel message is still on-goal when what it did was work on the objective, and a side note or a short reply beside that work does not change it.",
      "off-goal-by-instruction": "The prompt that opened the turn asked for something outside the objective, and the answer spent the turn doing it: answering an operator's question, following a coordinator's or another session's steer about a different plan, or relaying a notice, even where that took commits and pushes. What decides it is what the opening prompt asked for, not who sent it or how much work it took. A turn opened by a channel message or a delivered record is scored only when it answers a nudge, and a nudged turn is never offered this option.",
      "drift": "The answer went elsewhere, or did nothing toward the objective, with no instruction in the opening prompt to do so: it declined or set aside the objective, spent the turn on an unrelated fix or chore, or waited on work that serves a different plan. A nudge restating the objective, and a task notification, are not instructions to go elsewhere, so declining the nudge or following a notification into other work is drift. Waiting on the worker's own work for this objective is not drift.",
      "complete": "The objective itself is finished in this turn, all of what it names, such as the plan reaching Complete and archived where that is the objective. A section landed, a review round passed, a commit pushed or a pull request opened that leaves the objective with steps still to do is on-goal, not complete.",
    },
  },
  [MEMORY_KIND]: {
    id: MEMORY_KIND,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: "What kind of memorable content is in this exchange, if any?",
    options: {
      "fact": "A fact the user stated explicitly.",
      "preference": "A preference the user stated explicitly.",
      "lesson": "A durable lesson about how to work, drawn from what happened this turn.",
      "discard": "Nothing worth keeping, including a description of what happened this turn and an instruction to call a tool.",
    },
  },
  // v2: asked alone over the plan health state, on who acts next rather than
  // who acts before the worker can carry on. Each description carries the
  // nearest cases that are still this option or that belong to a neighbour,
  // since those are where the answer is decided.
  [BLOCK_OWNER]: {
    id: BLOCK_OWNER,
    version: "v2",
    overrideRefused: null,
    primitive: "choice",
    instructions: "`closingText` is how an autonomous worker session ended its last turn. Who has to act next before this worker's work moves?",
    options: {
      "operator": "The human operator: this work's next step needs a question answered, a decision made or an approval given that only the operator can give. That includes a BLOCKED: or ASK: line put to the operator this turn, a pull request waiting on the operator's review before this work can start or ship, and a restart, reboot or plugin update only the operator can run. It includes a WAITING turn whose own work is still running where the operator's pending answer is what this same work needs next. An operator question left open beside the worker's own running work, where nothing in this work waits on it or it belongs to another plan, is self-resolving, not this.",
      "coordinator": "The coordinating session, or another peer session such as the architect: it has to reply, rule, queue, release or reassign something before this work moves. That includes a wait on a peer session's reply to a message or its ruling on a question, an entry finished and handed back with nothing active until the coordinator assigns the next, and a worker holding off a plan another session may already be running. A pull request only the operator can approve is operator, not this, even where the coordinator passed it on.",
      "another-plan": "Other work outside this worker's own has to land first: this entry's start condition waits on another plan finishing or merging, or on another worker's change it depends on, with no one person asked to act. The worker's own implementers, reviewers or other sections of this same plan still in flight are self-resolving, not this, and a merge held only for the operator's review is operator.",
      "self-resolving": "Nobody: something this worker already started will finish on its own and wake it, such as its own implementers, reviewers, consultants, verifiers or curators, a background suite or build, or a timer, including dispatches building other sections of the same plan. That holds where the turn also names an open question to the operator that this work's next step does not wait on, since the running work is what the worker reads next. Where the operator's answer is what this work needs next, it is operator, not this.",
      "none": "Nobody: the worker is not waiting on anything and is carrying on, with its next step in hand and nothing of its own still running. A turn that reports and moves on is this. A wait on the worker's own running work is self-resolving, not this.",
    },
  },
  // The two turn record sets' wording is fixed data: the agreement figure
  // that promotes one to a live list was measured on this exact text, so a
  // rewording is a new version through the override layer, never an edit
  // here.
  [TURN_OPEN]: {
    id: TURN_OPEN,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: "A message has just arrived for an autonomous persona. Given its active goal and its open turn record, what is the message?",
    options: {
      "new-goal": "It asks for something new, not a step of the active goal and not a follow-up to the open record.",
      "step": "It is a step of, or an instruction about, the active goal.",
      "continuation": "It follows up, corrects or adds to the open turn record's own request.",
    },
  },
  [TURN_DISPOSITION]: {
    id: TURN_DISPOSITION,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: "How did this turn end?",
    options: {
      "delivered": "It finished what was asked of it this turn (answered, completed and reported the action, relayed or handed off the result, or acknowledged a message needing no action) and left nothing of its own half-done. Standing by for a new request, or others now acting on something it already handed over, still counts as delivered.",
      "mid_work": "It stopped with its own work unfinished: a next step narrated but not taken, an edit or commit half-done, or an intermediate status.",
      "blocked_or_waiting": "It cannot finish its own current task until something else happens: a person's decision it asked for, another agent's answer, or a background task or subagent of its own still running.",
    },
  },
  // The three memory sets name their state's fields through the field
  // constants, so the instruction and the state a caller builds read one name.
  [MEMORY_VALUE]: {
    id: MEMORY_VALUE,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: `\`${MEMORY_VALUE_STATE_CANDIDATE}\` is a memory candidate from an autonomous persona session's last turn: a fact distilled from that turn where \`${MEMORY_VALUE_STATE_SOURCE}\` reads distilled, or the turn's exchange itself where it reads exchange. The other fields describe that turn and name the record the candidate is stored under, empty where none was stored. Would a future session act differently for having this memory?`,
    options: {
      "keep": "Yes, as a fact or a lesson: it records something about the project, the tools or the work that a later session would otherwise get wrong or have to find out again.",
      "keep-as-preference": "Yes, as a preference: it records how the operator wants something done, a standing choice rather than a fact about the work.",
      "discard": "No: it describes what happened this turn, repeats what the goal or the record name already says, or holds nothing a later step would use.",
    },
  },
  [MEMORY_RECALL]: {
    id: MEMORY_RECALL,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: `\`${MEMORY_RECALL_STATE_PROMPT}\` is the start of a prompt about to reach an autonomous persona session, and the other fields describe one stored memory record. Does this record change what the session should do next?`,
    options: {
      "show": "It does: it holds a fact, a preference or a lesson that bears on what the prompt asks for, so the session would act differently having read it.",
      "hold": "It does not: it is about other work, or it touches the prompt's topic without changing any step the session would take.",
    },
  },
  [MEMORY_RECOGNITION]: {
    id: MEMORY_RECOGNITION,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: `An autonomous persona session has just run a command containing the pattern of \`${MEMORY_RECOGNITION_STATE_TRIGGER}\`, a trigger on the stored memory record the other fields describe. Does this record bear on a command of that kind, so that a nudge to open it is warranted?`,
    options: {
      "nudge": "It does: it holds something the session should know after running a command of that kind, such as a hazard, a required flag or a known failure.",
      "skip": "It does not: the pattern is too common for this record to be about such a command, or the record says nothing that changes how a command of that kind is run or read.",
    },
  },
  // Asked over stepDriftStateText's state, the objective and the head of one
  // step's answer. The two options mirror turn-score's on-goal and drift, read
  // on one response of the turn rather than on its end.
  [STEP_DRIFT]: {
    id: STEP_DRIFT,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: "This is one response from the middle of an autonomous worker's turn. Given the goal objective, is the worker still working on it?",
    options: {
      "on-goal": "The response works on the objective or keeps it correctly in hand: a step taken, a check made, a dispatch or a wait on the worker's own work for the objective, or a short side note beside that work.",
      "drift": "The response has gone elsewhere: it works on something unrelated to the objective, sets the objective aside with no instruction to, or waits on work that serves a different plan.",
    },
  },
  // Asked over toolResultStaleStateText's state, one old tool result's facts.
  // Each option is what the pass does to that result at the next automatic
  // compaction, and each description carries the nearest cases that are
  // still this option or that belong to a neighbour.
  [TOOL_RESULT_STALE]: {
    id: TOOL_RESULT_STALE,
    version: SHIPPED_VERSION,
    overrideRefused: null,
    primitive: "choice",
    instructions: "An autonomous session's conversation is about to be compacted. `Tool` was called `Messages since` messages ago with `Input head`, and the other fields describe its result. Does the session still need this result in its context as it is, only a note that the call happened, or neither?",
    options: {
      "keep": "The result is still load-bearing: the session is likely to read its exact content again or act on it soon, such as a file it is still editing, an answer no later message restates, or an error it has not yet resolved.",
      "cut": "That the call happened still matters but its content does not: a later message already names the same path or restates what it found, so one line naming the tool and its input is enough and the content can go.",
      "drop": "Neither the call nor its result matters any more: a listing, a search, a build or test run, or a read of a file the session has since rewritten or finished with, with nothing later depending on it.",
    },
  },
};

// What the resolver hands back for a question set id it does not know. Its
// empty id is the first thing the seam's questionProblem rejects, so the call
// ends as no_question before any request is sent. Returned rather than thrown
// because the resolver's contract is that it never rejects.
export const UNKNOWN_QUESTION: ChoiceQuestion = {
  id: "",
  version: "",
  overrideRefused: "unknown question set",
  primitive: "choice",
  instructions: "",
  options: {},
};

// --- One line of text inside a composed message ---

// One line of text the plugin splices into a message or a state it composes:
// its line breaks are folded, and it passes through bracketSafeText, which
// turns '[' and ']' into '(' and ')', so the text cannot forge a delivery
// label or write a field of its own into a state the plugin is the only
// author of. hooks/index.ts calls it wherever stored or external text reaches
// such a message, and turnScoreStateText below calls it for every value. It
// lives here rather than in hooks/index.ts because .kit/jev-gold/replay.mjs
// builds the turn-score state offline through this module and cannot load
// hooks/index.ts.
export function kaizenLine(text: string): string {
  return bracketSafeText(text.split(LINE_TERMINATOR).join(" "));
}

// --- The turn-score state ---
//
// The state turn-score v2 is asked over, built by this one function for the
// plugin's scorer and for .kit/jev-gold/replay.mjs alike, so the replay's
// figure is read on the bytes the plugin sends. Haiku and Jev are handed the
// same text. Four parts, a blank line between each, and no question sentence:
// the options are the question.

// The most characters of the turn's opening prompt and of its answer the
// state carries.
export const TURN_SCORE_PROMPT_MAX = 1200;
export const TURN_SCORE_ANSWER_MAX = 3000;

// The flags the Tools line can name, in the order it names them: the seven
// yes-or-no readings of hooks/index.ts's turn_tool_activity line, under that
// line's own names, so the replay reads a sampled record's activity line back
// onto these keys.
export const TURN_SCORE_TOOL_FLAGS = Object.freeze([
  "plan_read", "plan_edited", "commit", "push", "agent_dispatched", "goal_done", "reply",
] as const);
export type TurnScoreToolFlag = (typeof TURN_SCORE_TOOL_FLAGS)[number];

// The turn's tool activity: which of TURN_SCORE_TOOL_FLAGS held, and the names
// of the last eight tools the turn called, in call order, the ring
// hooks/index.ts keeps under TURN_TOOL_RING_MAX.
export type TurnScoreTools = {
  flags: Readonly<Record<TurnScoreToolFlag, boolean>>;
  calls: readonly string[];
};

// The Tools line: the flags that held, by name, then the ring's tool names in
// call order, each list reading `none` where it is empty.
function turnScoreToolsLine(tools: TurnScoreTools): string {
  const held = TURN_SCORE_TOOL_FLAGS.filter((name) => tools.flags[name] === true);
  return `flags: ${held.length > 0 ? held.join(", ") : "none"}; calls: ${tools.calls.length > 0 ? tools.calls.join(", ") : "none"}`;
}

// The line the engine puts ahead of a message a plugin submits, and the
// paragraph it puts after one submitted between turns. Neither is the
// message's own text. The paragraph is matched as the engine writes it, its
// dash written as an escape.
const PLUGIN_MESSAGE_WRAPPER = /^The [\w-]+ plugin sent a message:\s*/;
const HARNESS_TRAILER = "This is how Claude Code surfaces a prompt a plugin submits between turns \u2014 it starts this turn in the user's place. Address the message above.";

// The text a turn opened with, as the message its sender wrote: trimmed, with
// the engine's wrapper line removed from its start and the engine's trailer
// paragraph from its end, where either is present. turnScoreStateText applies
// it to the opening text the plugin holds, and .kit/jev-gold/sample.mjs to
// the opening text it reads from a transcript, so the two meet on one text.
export function turnOpeningText(text: string): string {
  const unwrapped = text.trim().replace(PLUGIN_MESSAGE_WRAPPER, "").trimEnd();
  return unwrapped.endsWith(HARNESS_TRAILER) ? unwrapped.slice(0, -HARNESS_TRAILER.length).trimEnd() : unwrapped;
}

// One value of the state: kaizenLine's fold, then every run of whitespace
// collapsed to one space and the ends trimmed. Two texts that differ only in
// the length or kind of a whitespace run, or in whitespace at their ends,
// give the same value, which is what lets .kit/jev-gold/replay.mjs rebuild
// the plugin's state from a transcript whose reader trims a message. Whitespace
// present in one text and absent in the other is not reconciled: text blocks
// the transcript reader joins with a line break and the hook's answer joined
// with none give two values, one space apart, and replay.mjs refuses such a
// record where the journal lets it see the difference.
function stateValue(text: string): string {
  return kaizenLine(text).replace(/\s+/g, " ").trim();
}

// `prompt` is the text the turn opened with, whole: the engine's wrapper and
// trailer come off it first, so the caller hands it uncut. Each cut is then
// applied to the collapsed value, so each bound counts the text as it is sent.
// Every value goes through stateValue, the prompt and the answer being
// external and model text and the objective stored text, so no value can
// write a fifth part.
export function turnScoreStateText(prompt: string, answer: string, objective: string, tools: TurnScoreTools): string {
  return `Turn opened with: ${stateValue(turnOpeningText(prompt)).slice(0, TURN_SCORE_PROMPT_MAX)}\n\n` +
    `Worker answered: ${stateValue(answer).slice(0, TURN_SCORE_ANSWER_MAX)}\n\n` +
    `Goal objective: ${stateValue(objective)}\n\n` +
    `Tools: ${stateValue(turnScoreToolsLine(tools))}`;
}

// --- The step-drift state ---
//
// The state step-drift is asked over: the objective of the turn's entry,
// then the head of one step's answer, a blank line between, and no question sentence.
// Each value goes through stateValue, the objective being stored text and the
// answer model text, so no value can write a third part. The cut is applied
// to the collapsed answer, so the bound counts the text as it is sent.
export const STEP_DRIFT_ANSWER_MAX = 1200;

export function stepDriftStateText(objective: string, answer: string): string {
  return `Goal objective: ${stateValue(objective)}\n\n` +
    `Step answered: ${stateValue(answer).slice(0, STEP_DRIFT_ANSWER_MAX)}`;
}

// --- The tool-result-stale state ---
//
// The state tool-result-stale is asked over: seven labelled parts, a blank
// line between each, and no question sentence. The tool name, the input head
// and the result head are text the model or a tool wrote, so each goes
// through stateValue and the two heads are cut at their bounds, counted on
// the collapsed value, so no value can write an eighth part or carry a
// result's bulk to the vendor. The counts and the two yes-or-no readings are
// the pass's own.
export const TOOL_RESULT_STALE_INPUT_MAX = 200;
export const TOOL_RESULT_STALE_RESULT_MAX = 400;

// What the pass knows about one old tool result when it asks.
export type ToolResultStaleFacts = {
  tool: string;
  inputHead: string;
  resultHead: string;
  resultChars: number;
  errored: boolean;
  messagesOld: number;
  referencedLater: boolean;
};

export function toolResultStaleStateText(facts: ToolResultStaleFacts): string {
  return `Tool: ${stateValue(facts.tool)}\n\n` +
    `Input head: ${stateValue(facts.inputHead).slice(0, TOOL_RESULT_STALE_INPUT_MAX)}\n\n` +
    `Result head: ${stateValue(facts.resultHead).slice(0, TOOL_RESULT_STALE_RESULT_MAX)}\n\n` +
    `Result size: ${Math.max(0, Math.floor(facts.resultChars))} characters\n\n` +
    `Errored: ${facts.errored ? "yes" : "no"}\n\n` +
    `Messages since: ${Math.max(0, Math.floor(facts.messagesOld))}\n\n` +
    `Named later: ${facts.referencedLater ? "yes" : "no"}`;
}

// --- The controller state ---
//
// The state controller-decision v3 is asked over, built by this one function
// for the plugin's controller tick and for .kit/jev-gold/replay.mjs alike, so
// the replay's figure is read on the bytes the plugin sends. Haiku and Jev are
// handed the same text. Three parts: one line per fact the tick holds, then
// the worker's last answer and the pending plans; a blank line; then the
// option list, one line per option id in force with its shipped description,
// so a record's text names no option Jev was not offered.
//
// The facts are label and value pairs the caller names, rather than fields
// this module names, because the replay copies them off a journaled state
// whose labels have changed across the plugin's versions, and a replay that
// re-derived them would read the v2 figure on facts the plugin never sent.

// The most characters of the worker's last answer the state carries.
export const CONTROLLER_LAST_ANSWER_MAX = 1500;
export const CONTROLLER_LAST_ANSWER_LABEL = "Last answer";
export const CONTROLLER_PENDING_PLANS_LABEL = "Pending plans";
// What the last answer line reads where no answer is held for this node:
// before the persona's first turn end in this process, or where the held
// answer was given on another entry.
export const CONTROLLER_NO_ANSWER = "none";
// The line between the facts and the option list.
export const CONTROLLER_OPTIONS_LEAD = "Choose the best decision:";

export type ControllerStateFact = readonly [label: string, value: string];
// A pending plan as the state names it: its id and title where the caller
// holds both, and its title alone where the id is not known, which is how
// .kit/jev-gold/replay.mjs rebuilds the line from a v1 journal state that
// carried titles only. So a replay of such a record is the plugin's bytes in
// every part but this line, which the replay states rather than hides.
export type ControllerPendingPlan = { id: string | null; title: string };

// The `Last answer:` value as the state carries it: collapsed and cut, or
// none where no answer is held. The controller's skip hash reads this too, so
// an answer that changes only past the cut sends the same bytes and skips.
export function controllerLastAnswerText(lastAnswer: string | null): string {
  return lastAnswer === null ? CONTROLLER_NO_ANSWER : stateValue(lastAnswer).slice(0, CONTROLLER_LAST_ANSWER_MAX);
}

// `lastAnswer` is the worker's most recent answer, raw, or null where none
// is held; its cut is applied to the collapsed value, so the bound counts
// the text as it is sent. `options` is the description per option id of the
// question as the caller resolved it, an admitted override's or the shipped
// entry's, so the list Haiku reads and the criteria Jev is sent carry one
// text; an id with no description writes an empty one. Every label, value,
// title, id and description goes through stateValue, the answer and the
// titles being worker and stored text and the descriptions an override's,
// so no value can write a line of its own into the state.
export function controllerStateText(
  facts: readonly ControllerStateFact[],
  lastAnswer: string | null,
  pendingPlans: readonly ControllerPendingPlan[],
  optionIds: readonly string[],
  options: Readonly<Record<string, string | null>>,
): string {
  const lines = facts.map(([label, value]) => `${stateValue(label)}: ${stateValue(value)}`);
  lines.push(`${CONTROLLER_LAST_ANSWER_LABEL}: ${controllerLastAnswerText(lastAnswer)}`);
  if (pendingPlans.length > 0) {
    const named = pendingPlans.map((p) => (p.id === null ? stateValue(p.title) : `${stateValue(p.id)}: ${stateValue(p.title)}`));
    lines.push(`${CONTROLLER_PENDING_PLANS_LABEL}: ${named.join("; ")}`);
  }
  const optionLines = optionIds.map((id) => `${id}: ${stateValue(options[id] ?? "")}`);
  return `${lines.join("\n")}\n\n${CONTROLLER_OPTIONS_LEAD}\n${optionLines.join("\n")}`;
}

// --- The override layer ---
//
// Layout under the home directory host.getHome() resolves:
//   <home>/.claude/agentic-questions/<questionId>/active.json
//   <home>/.claude/agentic-questions/<questionId>/v<N>.json
//
// active.json names the active version and is the one mutable file:
//   { "version": "v3" }
//
// v<N>.json holds the question itself, its field names mirroring
// ResolvedQuestion's where they overlap. Every field is required:
//   {
//     "primitive": "choice",
//     "instructions": "...",
//     "options": { "<optionId>": "<description>" | null, ... }
//   }
//
// A version file is immutable once written: the journal records the version
// label beside every answer, so a label whose wording changed underneath it
// would make two different questions read as one.
//
// This module only reads these files. Nothing here writes one.
export const OVERRIDE_DIR = ".claude/agentic-questions";
// The one path segment that comes from outside this repository. Held to a
// v<N> label so a version string can carry no separator and no parent
// traversal into the path built from it. No leading zero, so one version
// has one label: v03 and v3 would journal as two versions of one number.
const VERSION_LABEL = /^v[1-9][0-9]{0,8}$/;

// What the catalog needs from the host: the home directory and two reads.
export type CatalogHost = Pick<PluginHost, "getHome" | "readFile" | "fileExists">;

// The join hooks/index.ts uses at workdirPathOf and rosterRunDir: trailing
// separators off the root, then an unconditional forward slash, which Windows
// resolves as readily as POSIX. Kept here because those two are local to
// hooks/index.ts. The ground is not that a helper cannot cross an import,
// which it can: only the injected host object cannot. This is a copy, kept
// because the helper is three lines and this module imports runtime values
// from two siblings only, decision-seam.ts for the Score level bounds and
// agent-state.ts for the text guard, and neither carries it. The cost of the copy is that a path join drifting in one
// of them changes where one module reads and another writes.
function joined(root: string, ...parts: string[]): string {
  return [root.replace(/[/\\]+$/, ""), ...parts].join("/");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The shipped default with a refusal reason written onto it. The default is
// never mutated: a refusal is per call, and the constants are shared. Its
// answer vocabulary is copied rather than shared for the same reason, so a
// consumer that writes into the options map or the levels array of what it
// resolved cannot reach the constant behind it.
function fallback(shipped: ResolvedQuestion, refused: string | null): ResolvedQuestion {
  if (shipped.primitive === "choice") {
    return { ...shipped, options: optionsCopy(shipped.options), overrideRefused: refused };
  }
  if (shipped.primitive === "score") {
    return { ...shipped, levels: [...shipped.levels], overrideRefused: refused };
  }
  return { ...shipped, overrideRefused: refused };
}

// Every options map the resolver returns is prototype-free, on every path.
// The exported SHIPPED_QUESTIONS and UNKNOWN_QUESTION constants are ordinary
// literals and are never returned directly, always through this copy.
// Two shapes under one declared type is the worse defect: a consumer writing
// question.options.hasOwnProperty(id) would work on the fallback path and
// throw on the override path, and the fallback path is the one every test
// exercises. A literal also carries a __proto__ setter, which swallows an
// option of that id and nulls the map's prototype for a null value, so the
// map that resolves would differ from the one that was validated.
function optionsCopy(from: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = Object.create(null);
  for (const [id, description] of Object.entries(from)) out[id] = description;
  return out;
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

// The first way an override file's parsed content fails to be a usable
// question, or null where it is one. Checked field by field rather than cast,
// because the file is written outside this repository by a party this module
// cannot vouch for. Each reason is written for the journal to record: fixed,
// except the two that name the bound they applied, and never quoting the
// file's own content.
function overrideProblem(parsed: unknown, shipped: ResolvedQuestion): string | null {
  if (!isRecord(parsed)) return "the version file is not an object";
  // An override keeps its question's primitive: the shipped primitive is what
  // the caller asks for and what the answer is validated against, so a file
  // naming another one is a different question wearing this one's id.
  if (parsed.primitive !== shipped.primitive) return `the override is not a ${shipped.primitive}`;
  if (typeof parsed.instructions !== "string" || parsed.instructions.trim().length === 0) {
    return "the override has an empty instruction";
  }
  // A Noul's instruction is its whole vocabulary, so there is nothing further
  // to check on one.
  if (shipped.primitive === "noul") return null;
  if (shipped.primitive === "score") {
    if (!Array.isArray(parsed.levels)) return "the override has no levels array";
    for (const level of parsed.levels) {
      if (typeof level !== "string" || level.trim().length === 0) {
        return "the override has a level that is not a non-empty string";
      }
    }
    // The count, not the wording: a level number is what a journal line
    // records, so an override that adds or drops a level renumbers every
    // answer already recorded against this set.
    if (FIXED_LEVEL_SETS.includes(shipped.id) && parsed.levels.length !== shipped.levels.length) {
      return "the override's level count differs from the shipped set";
    }
    // The vendor's level bounds, held by the seam so this validator and the
    // seam's own refuse on one pair of numbers.
    if (parsed.levels.length < SCORE_MIN_LEVELS) return `the override has fewer than ${SCORE_MIN_LEVELS} levels`;
    if (parsed.levels.length > SCORE_MAX_LEVELS) return `the override has more than ${SCORE_MAX_LEVELS} levels`;
    return null;
  }
  if (!isRecord(parsed.options)) return "the override has no options map";
  for (const description of Object.values(parsed.options)) {
    if (description !== null && typeof description !== "string") {
      return "the override has an option description that is not a string or null";
    }
  }
  const ids = Object.keys(parsed.options);
  // The floor is two for a set whose options are all this catalog's own. The
  // plan switch's are not: its shipped map holds no_match alone and the rest
  // are the pending plan ids the caller supplies per request. So a one-option
  // override of that set is the shape mirroring its shipped default rather
  // than a question with no judgment in it, and the floor there is one.
  const floor = FIXED_OPTION_SETS.includes(shipped.id) ? MIN_OPTIONS : 1;
  if (ids.length < floor) return `the override has fewer than ${floor} option${floor === 1 ? "" : "s"}`;
  if (ids.length > MAX_OPTIONS) return `the override has more than ${MAX_OPTIONS} options`;
  // Option order is free. Order carries no meaning to a Choice, which returns
  // a probability per option id, so a reordered override is admitted.
  if (FIXED_OPTION_SETS.includes(shipped.id) && !sameIdSet(ids, Object.keys(shipped.options))) {
    return "the override's option ids differ from the shipped set";
  }
  return null;
}

// Builds the resolver the seam calls, bound to one host. The seam types it as
// QuestionResolver and depends on it resolving for every input: a question set
// it does not know comes back as UNKNOWN_QUESTION rather than a rejection.
//
// One call reads at most two files and holds nothing between calls, so an
// override written while a persona is running takes effect on the next
// question rather than on the next restart.
export function resolverOf(host: CatalogHost): QuestionResolver {
  return async (questionSetId: string): Promise<ResolvedQuestion> => {
    const shipped = Object.hasOwn(SHIPPED_QUESTIONS, questionSetId) ? SHIPPED_QUESTIONS[questionSetId] : null;
    if (shipped === null) return { ...UNKNOWN_QUESTION, options: optionsCopy(UNKNOWN_QUESTION.options) };

    // A home that cannot be read is an override layer that cannot be reached,
    // which is reported rather than passed over: an operator whose override
    // was silently ignored has no other way to see it.
    let home: unknown;
    try {
      home = await host.getHome();
    } catch {
      home = undefined;
    }
    if (typeof home !== "string" || home.trim().length === 0) {
      return fallback(shipped, "no home directory, so no override was read");
    }

    const dir = joined(home.trim(), OVERRIDE_DIR, shipped.id);
    const activePath = joined(dir, "active.json");

    // No active.json is the ordinary case: no override exists, nothing was
    // refused, and the shipped default carries no reason.
    let activeExists: unknown;
    try {
      activeExists = await host.fileExists(activePath);
    } catch {
      return fallback(shipped, "active.json could not be checked");
    }
    if (activeExists !== true) return fallback(shipped, null);

    let activeText: unknown;
    try {
      activeText = await host.readFile(activePath);
    } catch {
      return fallback(shipped, "active.json could not be read");
    }
    if (typeof activeText !== "string") return fallback(shipped, "active.json is not text");
    let active: unknown;
    try {
      active = JSON.parse(activeText);
    } catch {
      return fallback(shipped, "active.json is not JSON");
    }
    if (!isRecord(active) || typeof active.version !== "string") {
      return fallback(shipped, "active.json names no version");
    }
    const version = active.version.trim();
    if (!VERSION_LABEL.test(version)) return fallback(shipped, "active.json names no v<N> version label");
    // An override's label must be above the shipped question's own. At or
    // below it, the override's answers would journal under a label a shipped
    // wording already carries, and a scorer grouping by version would read the
    // two wordings as one question.
    if (Number(version.slice(1)) <= Number(shipped.version.slice(1))) {
      return fallback(shipped, `active.json names a version not above the shipped ${shipped.version}`);
    }

    const versionPath = joined(dir, `${version}.json`);
    let versionExists: unknown;
    try {
      versionExists = await host.fileExists(versionPath);
    } catch {
      return fallback(shipped, "the named version file could not be checked");
    }
    if (versionExists !== true) return fallback(shipped, "the named version file is missing");

    let versionText: unknown;
    try {
      versionText = await host.readFile(versionPath);
    } catch {
      return fallback(shipped, "the version file could not be read");
    }
    if (typeof versionText !== "string") return fallback(shipped, "the version file is not text");
    let parsed: unknown;
    try {
      parsed = JSON.parse(versionText);
    } catch {
      return fallback(shipped, "the version file is not JSON");
    }

    const problem = overrideProblem(parsed, shipped);
    if (problem !== null) return fallback(shipped, problem);

    // Validated field by field above, so only the fields this module checked
    // are copied out. Nothing else the file carried rides along, and the
    // primitive is the shipped question's rather than the file's, the two
    // having been checked equal.
    const source = parsed as { instructions: string; options: Record<string, string | null>; levels: string[] };
    const head = { id: shipped.id, version, overrideRefused: null, instructions: source.instructions };
    if (shipped.primitive === "choice") {
      return { ...head, primitive: "choice", options: optionsCopy(source.options) };
    }
    if (shipped.primitive === "score") {
      return { ...head, primitive: "score", levels: [...source.levels] };
    }
    return { ...head, primitive: "noul" };
  };
}
