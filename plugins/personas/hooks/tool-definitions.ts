// tool-definitions.ts: the name, description and input schema of every
// persona tool, and the session's hold that registers it, in registration
// order. hooks/index.ts registers each with the engine. Pure data: no engine
// handle, no engine call, no import.

// "reader" registers under both holds; "owner" under the owner hold alone. A
// session whose arming is off registers no tool.
export type ToolHold = "reader" | "owner";

export type ToolDefinition = {
  name: string;
  hold: ToolHold;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "agentic_identity",
    hold: "reader",
    description:
      "Switch this session to a persona's store. It never evicts a live session: where another " +
      "session holds this persona and its heartbeat is current, this session joins as a passive " +
      "reader with agentic_say and agentic_inbox and no write access. Ownership is taken only " +
      "where no live holder exists or the holder's heartbeat has gone stale. Called with no " +
      "persona, it reports the persona this session holds and switches nothing.",
    inputSchema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description:
            'The persona name to switch to (e.g. "default", "refactorer"). If omitted, the call reports ' +
            "the persona this session holds and switches nothing.",
        },
      },
    },
  },
  // The goal-tree tools and the persona's own lists hold "owner": a reader
  // session steers through agentic_say and agentic_inbox only, and owns no
  // persona whose tree it could create or edit.
  {
    name: "goal_create",
    hold: "owner",
    description:
      "Create a new goal tree for this persona. The root carries the objective; the planner " +
      "creates the plans under it at the next controller tick. A tree whose root is unfinished " +
      "is replaced only with replace: true. A call in a turn none of the operator, the coordinator persona, the architect persona's [QUEUE] record or, for the architect persona, a worker's record started is refused. " +
      "A delivered [FINDING], [PROPOSAL] or [STARTED] record never counts as such a turn, except in the architect persona's own session, where a worker's [FINDING] or [PROPOSAL] record counts and a [STARTED] record does not, and there only while the store holds no goal at all and no ask is open; over a tree, add the plan with goal_add of kind plan instead.",
    inputSchema: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "What the worker should accomplish across multiple turns.",
        },
        maxRounds: {
          type: "number",
          description: "maxRounds caps the goal rounds before auto-blocking. Default 10.",
        },
        roadmapPath: {
          type: "string",
          description: "roadmapPath is an optional project-relative path to a roadmap file. The planner reads it at every planning event.",
        },
        replace: {
          type: "boolean",
          description: "replace: true replaces an unfinished tree. A replaced tree with entries is kept in .agentic-goal-history.jsonl.",
        },
      },
      required: ["objective"],
    },
  },
  {
    name: "goal_add",
    hold: "owner",
    description:
      "Add a node to the goal tree under parentId. With parentId omitted the parent is the " +
      "active leaf where that leaf is a plan, and the active task's parent otherwise. " +
      "In a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started, and at propose in a turn that, for the architect persona, a worker's record started, kind \"plan\" is added as any node is. " +
      "A [FINDING], [PROPOSAL] or [STARTED] record never starts such a turn, except in the architect persona's own session, where a worker's [FINDING] or [PROPOSAL] record does and a [STARTED] record does not. " +
      'Outside one, the autonomy level decides kind "plan": at propose the add is refused, the architect persona\'s worker-record turn being admitted above rather than by the level; at plan-and-ask it is added paused, awaiting the operator\'s yes, and a [PROPOSAL] record naming it goes to the coordinator persona; ' +
      "at plan-and-start it is added to start, and a [STARTED] record naming it goes to the coordinator persona. Where that record cannot be written, the add is refused.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "One-line title for the node.",
        },
        objective: {
          type: "string",
          description: "objective is what done looks like.",
        },
        parentId: {
          type: "string",
          description: "Optional. The id of the parent node.",
        },
        kind: {
          type: "string",
          description:
            'kind is "task" (default) or "plan". "plan" is only allowed under the root, ' +
            "requires planPath and takes no maxRounds.",
        },
        maxRounds: {
          type: "number",
          description: 'maxRounds is the round budget of kind "task". Default 10. It is refused on kind "plan", which has no round budget.',
        },
        planPath: {
          type: "string",
          description:
            'planPath is required on kind "plan" and only allowed there. Its plan document\'s path: ' +
            '"docs/plans/<name>.md", project-relative, no subdirectories.',
        },
        taskId: {
          type: "string",
          description:
            "taskId names a task of the working list this node is made from. That task's text is " +
            "the title where none is given, and the task leaves the list. An unknown id is refused.",
        },
      },
      required: ["objective"],
    },
  },
  {
    name: "goal_done",
    hold: "owner",
    description:
      "Mark the active goal leaf as complete, with an optional one-line note. The controller then activates the next pending plan. Once every entry under the top goal is complete or abandoned, with at least one complete, the top goal completes by itself, unless every entry under it is the planner's own, in which case the planner is asked for more. " +
      "A plan left only with a check someone else runs later, such as a validation after release, is complete: finish it with goal_done, name the check in the note, and hand it off, never holding the plan open for it. " +
      "The result names the goal that became active where there is one, and that goal is the one to carry on with, except where the plan this turn started on finishes and hands over to another plan: then report and end the turn, with no WAITING: or BLOCKED: line, and the next turn starts that plan. " +
      "nodeId completes a named entry instead, once every child it has is complete or abandoned, and leaves any other active entry active. " +
      "The root's own nodeId completes the root once every entry under it is complete or abandoned with at least one complete, in a turn the operator, the coordinator persona or the architect persona's [QUEUE] record opened; that is how a root whose entries are all the planner's own is closed. " +
      "Finished work on an entry that is not active is recorded with goal_done and its nodeId, never with a drop. " +
      "nodeId naming an entry awaiting the operator's yes, or a node under one, is refused outside a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started.",
    inputSchema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "One-line note about why this is done.",
        },
        nodeId: {
          type: "string",
          description: "nodeId names the entry to complete, as goal_status lists it.",
        },
      },
    },
  },
  {
    name: "ask_open",
    hold: "owner",
    description:
      "File one question to the operator on your ask ledger, where the operator sees it and answers it. " +
      "File only a decision that is the operator's to make: a fork the plan does not settle and that is not yours to settle. " +
      "The ask rises from the entry this turn started on. " +
      "A call with no title, or with a title longer than 60 characters, is refused. " +
      "One turn opens at most 4 asks, and at most 16 stand open at once. A question still carrying an angle-bracket placeholder, a question already open on the entry, or one closed on the entry recently is refused. " +
      "After the turn ends, a brief drafted from the transcript reaches the operator on the fleet decisions card, so write the question and the recommendation and keep your reasoning in the turn. " +
      "The result is JSON: the new ask's id, whether it blocks, and the ids of every ask still open. Close it with ask_close by that id. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "title is the decision in a few words, in Title Case, with no closing period and no prefix. " +
            "It is at most 60 characters on one line. " +
            "The operator's page shows it as the ask's heading, so it must tell this ask from the others without the question.",
        },
        question: {
          type: "string",
          description: "question is the question whole, ending in a question mark.",
        },
        recommend: {
          type: "string",
          description: "recommend is the choice the work proceeds on while the question stands, which the [GOAL TREE] block shows beside an open ask that does not block.",
        },
        blocking: {
          type: "boolean",
          description:
            "blocking is optional and false by default, for a question the work proceeds past on recommend. " +
            "Set it true only where the next step is irreversible without the answer or a plan waits on it: a blocking ask stops the controller's nudges until the operator answers or the wait runs out. " +
            "A blocking ask is paired with a closing text that opens with a BLOCKED: line in the same turn, so the thread shows the stop.",
        },
      },
      required: ["title", "question", "recommend"],
    },
  },
  {
    name: "ask_close",
    hold: "owner",
    description:
      "Close one of your open asks to the operator by its id, as the Open asks: part of the [GOAL TREE] block or the [ASKS] block lists it. " +
      "Close an ask once the operator's word answers it, once the choice you proceeded on held and the question no longer matters, or once you no longer need the answer. " +
      "An operator's reply closes no ask by itself: it lifts the hold on blocking asks, and the ask it answered is yours to close here. " +
      "The result lists the ids still open and a released list of the paused entries tied to the ask. An answered close here or by a coordinator's answer returns each to pending unless the operator's own hold, their [PAUSE] line or an awaited yes, keeps it. Owner only. An id that is not open is refused.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "id is the ask's id, ask-<nodeId>-<ms>.",
        },
        outcome: {
          type: "string",
          description: 'outcome is "answered" (the operator answered), "stood" (the choice you proceeded on held) or "withdrawn" (the question no longer needs an answer).',
        },
        note: {
          type: "string",
          description: "note is optional: the answer or why the ask closed, kept up to 300 characters.",
        },
      },
      required: ["id", "outcome"],
    },
  },
  {
    name: "goal_status",
    hold: "owner",
    description:
      "Show the current goal tree as formatted text. Read-only; works for passive readers. " +
      "The default print is the open entries with their ancestors, and under each printed entry with a child left out a count of the complete and abandoned children left out. " +
      "settled: true prints the whole tree, every settled entry included.",
    inputSchema: {
      type: "object",
      properties: {
        settled: {
          type: "boolean",
          description: "settled is optional: true prints every entry of the tree, the complete and abandoned ones included.",
        },
      },
    },
  },
  {
    name: "goal_resume",
    hold: "owner",
    description:
      "Resume a paused goal leaf and reset its nudge budget. A nodeId naming a leaf blocked with \"Max rounds reached\" releases it and restarts its round count. A different active entry returns to pending, " +
      "and the controller starts it again in queue order once the resumed one completes or is paused and nothing above it is held. Owner only. An entry awaiting the operator's yes, or a node under one, is refused outside a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started, " +
      "and a call with nodeId omitted passes over them there. A resume allowed in such a turn clears the entry's wait.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: {
          type: "string",
          description: "nodeId names the paused node to resume, or the node blocked on its round budget to release. Optional, defaulting to the most recently paused node.",
        },
      },
    },
  },
  {
    name: "supervisor_shutdown",
    hold: "owner",
    description:
      "Stop the supervisor itself, not just the current goal: the child exits by the graceful " +
      "EOF path once this turn ends. A plain call is made on the operator's explicit ask or in answer to " +
      "the launcher's own request to end the session, and while that request is open the supervisor reads " +
      "either call as the stop. park: true is for an update window the operator asked for: the persona stops and the keeper " +
      "brings it back at the next boot or a start after the operator's -Release. While the launcher's request is open, a park is the stop " +
      "and the launcher decides whether the persona comes back. A finished goal needs no call here: the session stays up and waits for the " +
      "next ask. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "reason is optional: why the operator asked to shut down.",
        },
        park: {
          type: "boolean",
          description: "park: true stops the supervisor on the park code and the keeper brings the persona back at the next boot or a start after the operator's -Release. While the launcher's request is open, a park is the stop and the launcher decides whether the persona comes back.",
        },
      },
    },
  },
  {
    name: "supervisor_restart",
    hold: "owner",
    description:
      "Restart this persona: this child exits by the graceful EOF path and a fresh one starts with the " +
      "goal tree intact and resumes the active plan. Under a keeper that can hand the persona to the fleet " +
      "supervisor, the supervisor and the keeper end too, and the fleet supervisor starts the persona again " +
      "on the installed plugin build. Otherwise, and in a run with no keeper, the child is relaunched alone. " +
      "Call it on the operator's ask for a restart, or to " +
      "pick up an updated runtime such as a plugin update. A finished goal needs no call here either. " +
      "Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "reason is optional: why the operator asked for a restart.",
        },
      },
    },
  },
  {
    name: "handover_write",
    hold: "owner",
    description:
      "Leave a note for the next session of this persona, for a restart at a checkpoint. The note replaces " +
      "any earlier one, and the next session reads it once, on its priming turn. Call it when a [CHECKPOINT NOTE] " +
      "line asks for it, at the end of the turn. Refused unless this persona's checkpointRestart switch reads live, " +
      "and refused for a session that does not hold its persona. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "note is your own account, in plain text, of what you were doing, what is on disk and where, and what comes next. At most 4,000 characters, counted after the transcript redactor hides any secret in it, and never empty.",
        },
        running: {
          type: "string",
          description: "running names each process this session started that is still executing, such as a background command, a dispatched agent or a test run, or the one word none. Leave out another session's process, a finished run whose result is unread, and a wait with no process behind it, such as an open ask or a scheduled wake. Never empty.",
        },
      },
      required: ["note", "running"],
    },
  },
  {
    name: "goal_edit",
    hold: "owner",
    description:
      "Change one node of the goal tree. drop marks a pending, paused or blocked node abandoned, so it is " +
      "never activated, and refuses any other status; a drop is for work that will not be done, and it does not reach the node's children. pause holds an active or pending node with a reason and a releasedBy naming who releases it, and is refused without one, and goal_resume " +
      "continues it; a pause is for stuck work that waits on someone, and queued work stays pending. A pause whose reason names exactly one open ask's id is tied to that ask, and its answered close by your own ask_close or a coordinator's answer returns the node to pending unless the operator's [PAUSE] line or an awaited yes holds it. repend returns a paused node to pending in place, starting nothing, and is refused on a node that is not paused, while the turn budget blocks the root, and where an entry awaiting the operator's yes sits at or above the node in a turn that may not resume it. reprioritize moves a pending node ahead of its siblings. Owner only. " +
      "A drop of an entry awaiting the operator's yes is refused outside a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started, and a drop of a plan entry is refused in a turn that could not add the plan again.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: {
          type: "string",
          description: "nodeId is the node to change, as goal_status lists it.",
        },
        action: {
          type: "string",
          description: 'action is "drop", "pause", "repend" or "reprioritize".',
        },
        reason: {
          type: "string",
          description: "Why (recorded as the node's blockedReason for pause/drop).",
        },
        releasedBy: {
          type: "string",
          description: "releasedBy is required for pause: the party whose act lets the entry move again, as operator, coordinator or a persona's name. A phrase, a number or a condition is refused.",
        },
      },
      required: ["nodeId", "action"],
    },
  },
  {
    name: "goal_longterm",
    hold: "owner",
    description:
      "Hold or let go of a long-term goal: the idea this persona is working towards, kept beside the goal tree and " +
      "listed by goal_status. A long-term goal is never the active work and never starts by itself. " +
      "add holds a new one and returns its id; at most 5 are held, and an add past that is refused. " +
      "drop lets one go by its id and records the reason. An edit is a drop and an add. " +
      "Refused outside a turn the operator, the coordinator persona or the architect persona's [QUEUE] record started, where a [FINDING], [PROPOSAL] or [STARTED] record does not count. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: 'action is "add" or "drop".',
        },
        title: {
          type: "string",
          description: "title is the goal in one line. Required for add.",
        },
        objective: {
          type: "string",
          description: "objective is what the persona is working towards. Required for add.",
        },
        id: {
          type: "string",
          description: "id names the long-term goal to drop, as goal_status lists it. Required for drop.",
        },
        reason: {
          type: "string",
          description: "reason says why it is dropped, and is recorded. Required for drop.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "goal_autonomy",
    hold: "owner",
    description:
      "Set this persona's autonomy level, which says what it may do with work it found on its own. " +
      'level "propose": it may only propose work, by sending a [PROPOSAL] record to the coordinator persona. ' +
      'level "plan-and-ask": it may write a plan document and queue it with goal_add, and the entry waits paused for the operator\'s yes. ' +
      'level "plan-and-start": it may write a plan document, queue it and start it, and the plugin tells the coordinator persona. ' +
      "Only the operator's own turn on this persona's thread may call this; every other turn is refused, a coordinator delivery included. " +
      'The level governs goal_add with kind "plan" and nothing else. goal_status shows the level. Owner only.',
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          description: 'level is "propose", "plan-and-ask" or "plan-and-start".',
        },
      },
      required: ["level"],
    },
  },
  // The per-goal working list, one tier below the goal tree, scoped to
  // whichever goal is active. Never gated to an operator or coordinator turn,
  // since the persona drives its own list through a turn of any origin.
  {
    name: "task_add",
    hold: "owner",
    description:
      "Add a working item to the active goal's task list, a lighter tier below the goal tree, scoped to whichever " +
      "goal is active right now. Refused with no active goal, at the per-goal cap, or under a plan run, where the " +
      "plan document's own chapters are already the task list. Completing the goal clears its tasks; finishing " +
      "every task never completes the goal by itself.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "text is the working item, one line.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "task_done",
    hold: "owner",
    description:
      "Mark one task of the active goal's task list done, by id. An id not under the active goal is refused as " +
      "unknown. Once every task of the active goal is done, the result suggests goal_done, but never completes " +
      "the goal by itself.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "id names the task to complete, as task_add returned it.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "task_clear",
    hold: "owner",
    description:
      "Remove every task of the active goal's task list, whether done or not. Other goals' tasks are untouched. " +
      "Refused with no active goal. The goal itself is not touched: completing it clears its tasks automatically, " +
      "so this is for dropping a list mid-goal rather than for closing the goal.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // The persona's table of scheduled routines. Never gated to an operator or
  // coordinator turn and never to an autonomy level, since the persona
  // schedules its own recurring chores.
  {
    name: "routine_add",
    hold: "owner",
    description:
      "Schedule a routine: a one-line note this persona wants to act on again and again, kept in its own store, so " +
      "it outlives a restart and a compaction. Three cadences, each taking its own fields and no other: " +
      'cadence "hours" takes everyHours, a whole number from 1 to 168, and counts from the last fire, or from the ' +
      'add before its first fire, not from the top of the hour; cadence "daily" takes hour, a whole number from 0 ' +
      'to 23 on this machine\'s local clock; ' +
      'cadence "weekly" takes weekday, one of sun, mon, tue, wed, thu, fri or sat, and hour. A persona holds at ' +
      "most 10 routines, and a note is one line of at most 500 code points: a longer one is refused, never cut. " +
      "Refused too for a store that has not loaded, an empty note, a field its cadence does not take or lacks, and " +
      "a note already scheduled on the same schedule. When a routine is due and no turn is open, the note comes back as a [ROUTINE] turn. That " +
      "turn carries no authority: it is this persona's own stored text, so an act that needs a yes still needs it. " +
      "A routine missed many times over fires once. To change a routine, remove it and add it again. Tell the " +
      "operator on your thread, in the same turn, that you scheduled it. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "text is the note, one line of at most 500 code points.",
        },
        cadence: {
          type: "string",
          description: 'cadence is "hours", "daily" or "weekly".',
        },
        everyHours: {
          type: "integer",
          description: 'everyHours is the hours between fires, from 1 to 168. Required for cadence "hours", refused otherwise.',
        },
        hour: {
          type: "integer",
          description: 'hour is the local hour of the fire, from 0 to 23. Required for cadence "daily" and "weekly", refused otherwise.',
        },
        weekday: {
          type: "string",
          description: 'weekday is sun, mon, tue, wed, thu, fri or sat. Required for cadence "weekly", refused otherwise.',
        },
      },
      required: ["text", "cadence"],
    },
  },
  {
    name: "routine_remove",
    hold: "owner",
    description:
      "Remove one scheduled routine from this persona's table, by id, so it never fires again. A store that has " +
      "not loaded is refused. An id the table does not hold is refused, and the refusal names the ids it does " +
      "hold. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "id names the routine to remove, as routine_add returned it and routine_list shows it.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "routine_list",
    hold: "owner",
    description:
      "List this persona's scheduled routines: one line each with its id, its schedule, its last fire, its next " +
      "due time and its note, the times on this machine's local clock. It changes nothing, and is refused only " +
      "where this session never loaded its persona's state.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_add",
    hold: "owner",
    description:
      "Write one record to the kit's shared memory store for this persona, one that passes the memory-system skill's write bar. " +
      "Returns the record's name.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "text is one short, self-contained statement: one fact, preference, or lesson.",
        },
        kind: {
          type: "string",
          description: 'Memory kind: "fact", "preference", or "lesson".',
        },
      },
      required: ["text"],
    },
  },
  // The inbox tools hold "reader": a reader session sends to and reads the
  // owner it reads through them.
  {
    name: "agentic_say",
    hold: "reader",
    description:
      "Send a message to the owner session of a persona. Without persona, the target is this session's own persona: a reader session " +
      "calls this to send text to the owner it reads. With persona, the target is that persona's inbox, reached with no identity switch: " +
      "the session holding the coordinator persona may address any persona, and a session owning a named persona may address any persona it does not own, " +
      "the default persona, the coordinator persona and the architect persona among them. " +
      "The architect's answer: where the session owning the architect persona addresses a persona whose owner sent the architect a record " +
      "that is delivered or answered and not quiet, the record is stamped as the answer to it, and is delivered as the architect's even if the architect resolves that record with agentic_resolve after sending it. A quiet send is delivered as the architect's and carries no such stamp. " +
      "A target this session owns is refused, because an owner does not message itself. " +
      "A target whose name differs only in case from a persona a live session owns, where no live session owns the name as given, " +
      "is refused naming that persona, and nothing is written: send to it under its exact name. " +
      "A target no live session owns is still written, and the result reads Message written to rather than Message sent to owner of: " +
      "it says no live session owns the persona and the record waits pending until a session owning that persona drains it. " +
      "The owner sees the message on its next quiet tick, or as its running turn ends, and each further waiting message follows as the " +
      "previous delivery turn ends. urgent: true breaks into a running turn instead and takes that turn's own " +
      "answer as the reply. quiet: true marks a record that asks its receiver for nothing, such as an acknowledgment or a status line: " +
      "it opens no turn, the owner's model reads it as a line on a tool result, inside the owner's running turn where one is open and otherwise in the next turn something else opens, and it is never replied to. " +
      "quiet is refused with answers, with urgent: true, and on a text opening [QUEUE], [FINDING], [PROPOSAL] or [STARTED]. " +
      "What a sent record does between those two moments, and what the sender reads back afterwards, is stated in " +
      "agentic_inbox's description.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The message to send to the owner.",
        },
        answers: {
          type: "string",
          description: "Optional: the ask id (from agentic_inbox) to answer. Answer an open ask with agentic_say(text, answers: <id>).",
        },
        urgent: {
          type: "boolean",
          description: "Optional. Deliver inside the owner's current turn (as context on its next tool result) immediately, without the wait. Not for answering an ask.",
        },
        quiet: {
          type: "boolean",
          description: "Optional. Set it on a record that asks its receiver for nothing, such as an acknowledgment or a status line. The record opens no turn and is not replied to. Not with answers or urgent, and not on a text opening [QUEUE], [FINDING], [PROPOSAL] or [STARTED].",
        },
        persona: {
          type: "string",
          description: "Optional. The persona whose owner receives the message. Defaults to this session's own persona. Not a persona this session owns.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "agentic_inbox",
    hold: "reader",
    description:
      "Read replies from the owner session of a persona. Without persona, the target is this session's own persona: a reader session " +
      "calls this to poll for replies to its messages. With persona, the target is that persona, under the rule agentic_say uses at send: " +
      "the session holding the coordinator persona may read any persona, a session holding a reader claim on a persona may read it, " +
      "a session owning a named persona may read any other persona, and a persona this session owns is refused. " +
      "Returns {inbox: [{id, from, at, text, kind, status, reply?, deferred?, turnRunningMs?, outcome?, note?, resolvedAt?, answersRecord?, answerRecords?: [{id, at, status, text}]}], asks: [{id, at, nodeId, question, status}], workdir?}: workdir is the target persona's live owner's launch directory, where its own store file sits. " +
      "A pending record carries deferred: true and turnRunningMs while the owner is inside a turn: one not quiet waits for that turn to end, or breaks into it once it has waited past the break-in bound, which a record labelled COORDINATOR, or WORKER under the architect persona, at delivery never does, and a quiet one is carried into that turn as a line on a tool result. " +
      "A record delivered on its wait alone is never replied to: it stays delivered until the owner resolves it. " +
      "A quiet record reads delivered once the owner's plugin holds it, which can be before the owner's model has read it, and is never replied to. " +
      "A resolved record carries outcome (done or declined), note and resolvedAt. " +
      "A skipped record carries note, naming why delivery refused it. " +
      "Where this session owns a named persona other than default, answerRecords lists, ordered by at, every record in the inbox of the alphabetically first such persona stamped as the answer to the returned record, " +
      "which is how the architect's answer reads at once rather than at the turn boundary that delivers it; it is absent where none answers. " +
      "Answer an open ask with agentic_say(text, answers: <ask id>).",
    inputSchema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "Optional. persona names the inbox to read, defaulting to this session's own.",
        },
      },
      required: [],
    },
  },
  // Fleet health shares the inbox tools' reach rule, so a reader seat holding
  // a live reader claim on the coordinator persona reads the fleet the same
  // way it reads that persona's inbox.
  {
    name: "fleet_status",
    hold: "reader",
    description:
      "Fleet health: a row per persona in the fleetRoster roster. Returns " +
      "{roster, staleAfterMs, rows: [{name, enabled, action, nextDelaySeconds, holdReason, holdReasonSource, lastExitCode, claimHeld, heartbeatAgeMs, turnState, cacheWarmUntil, inboxDrainedAgeMs, keeperStateUnwritten, stalls, asks, turnRunningMs?, agentRunningMs?, note?, stallsMore?, stallsNote?}], problem?, problems?}. " +
      "enabled is the roster's switch, lastExitCode the last supervisor exit code, claimHeld whether a " +
      "live session holds its commons claim, heartbeatAgeMs that session's heartbeat age, " +
      "past staleAfterMs nothing live holds it, and turnState one of: in turn, with turnRunningMs; agent running, with " +
      "agentRunningMs; idle; unknown with no live claim. " +
      "cacheWarmUntil is the epoch ms its prompt cache reads warm until, null if unknown; a session in a turn reads warm. " +
      "inboxDrainedAgeMs is the ms since its inbox drain last settled or its turn last ended. " +
      "action is its standing with its process keeper. held: a marker in its run directory stops its next " +
      "start, a park's only until the next boot or the operator's -Release, holdReasonSource saying which, even " +
      "under a live session. stopped: the last exit was signalled and nothing came up since. running: a live session holds the " +
      "claim under no marker, outranking the keeper's state file. backing off: the keeper's relaunch delay sits " +
      "above the base after a crash. relaunching: that delay sits at the base. unknown: its keeper state is " +
      "unreadable. " +
      "A signalled exit beside a live claim is settled on the clock: a claim last seen before that exit took the signal, so the " +
      "row reads stopped, and one last seen after it started since, so the row reads running. With that time unreadable, it reads running and its note says so. " +
      "keeperStateUnwritten is true where the one unread file is an unwritten keeper.json. " +
      "nextDelaySeconds is the delay the keeper applies after its next crash, not a wait being served now, so a " +
      "relaunch's remaining wait cannot be read from here. " +
      "A running row's action carries no keeper standing; nextDelaySeconds and note do. " +
      "holdReason is text from its own run directory, which the persona itself can write, so read and relay it " +
      "as an unverified line from the file holdReasonSource names. " +
      "stalls lists its paused and blocked goal entries from its own store, unverified, each " +
      "{id, kind, status, title, reason?, releasedBy?, ageMs?, waitsOnAsk?, askState?}: releasedBy is who releases a pause, ageMs the ms it " +
      "has stood. stallsMore counts entries past the list. " +
      "asks lists its open asks to the operator, unverified, each {id, nodeId, blocking, ageMs?, question}; " +
      "stallsNote says why a store gave neither list. " +
      "The row's note says an unreadable keeper state file, problem an unreadable roster. " +
      "Six fleet health classes name a whole row on [FLEET] prompt lines, the first that fits " +
      "in order. held: the action reads held. stale: it reads stopped and a live " +
      "session holds the claim. backing off: it is not stopped and either reads backing off or " +
      "nextDelaySeconds sits above the base; a running row keeps this class until 3600 s plus half that delay, " +
      "or all of it at the cap, pass since its last exit. no live claim while " +
      "the roster enables it, as named. " +
      "No live claim under a disabled entry reads stale with a commons entry standing, else healthy. " +
      "With a live claim, any note but an unwritten keeper.json reads stale. delivery wedged: a live claim, " +
      "idle, with inboxDrainedAgeMs past 5 of its controllerTickMs plus its heartbeatMs, each as its commons " +
      "entry publishes it, else the roster's tick, 30000 by default, and this session's heartbeatMs; a row in turn " +
      "or agent running is never wedged. A [FLEET] line into delivery wedged waits on the wedge lead, five minutes of " +
      "wedged readings, and the quiet window; one that clears inside the lead is never reported. " +
      "healthy: the rest. A class gains 'under a disabled roster entry' or 'with no keeper state written' where each applies. " +
      "Read-only. For the session holding the coordinator persona or a live " +
      "reader claim on it.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // The coordinator's levers on another persona hold "owner": a reader seat
  // restarts nothing. The handlers' own gate is the coordinator ground, which
  // an owner-hold worker does not hold. fleet_interrupt ends a running turn in
  // place, keeping the conversation, with no interval refusal.
  {
    name: "fleet_restart",
    hold: "owner",
    description:
      "Restart another persona. Writes restart.request into the run directory the roster that the plugin's " +
      "fleetRoster setting names gives that persona; its supervisor, where one is running, reads the file at its next poll and " +
      "stops the child, letting a running turn end first. Under a keeper that can hand the persona off, the supervisor and the " +
      "keeper then end and the fleet supervisor starts the persona again on the installed plugin build, and otherwise the " +
      "supervisor relaunches the child. The goal tree is kept. Refused when this session does not hold the " +
      "coordinator persona, when no roster is set or it cannot be read, when persona is not a roster entry whose enabled " +
      "is true, when persona is this session's own (supervisor_restart restarts that one), when the run directory does " +
      "not exist, and when the persona's standing request is less than fifteen minutes old. Writes nothing to the commons " +
      "store or to any persona's store. Available to the session holding the coordinator persona alone.",
    inputSchema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "The roster name of the persona whose child is restarted.",
        },
        reason: {
          type: "string",
          description: "The reason the restart is asked for, written into the request file beside the time and this session's persona. Trimmed and cut at 200 characters.",
        },
      },
      required: ["persona", "reason"],
    },
  },
  {
    name: "fleet_interrupt",
    hold: "owner",
    description:
      "End another persona's running turn without restarting its child, so the persona keeps its conversation. Writes " +
      "interrupt.request into the run directory the roster that the plugin's fleetRoster setting names gives that persona; " +
      "its supervisor, where one is running, reads the file at its next poll and relays it to the child's holder, which " +
      "relays the interrupt to the child at its own next poll. Together that is up to about 12 seconds at the plugin's " +
      "default poll intervals (a ten-second supervisor poll and a two-second holder poll), not an instant stop. Where no " +
      "turn begun at or before this call is running, the supervisor records the request served without relaying it " +
      "instead. A message sent with agentic_say afterwards arrives as that persona's next prompt. " +
      "Refused when this session does not hold the coordinator persona, when no roster is set or it cannot be read, when " +
      "persona is not a roster entry whose enabled is true, when persona is this session's own, and when the run directory " +
      "does not exist. Touches no store, commons or persona's own. Only the session holding the coordinator persona may call it.",
    inputSchema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "The roster name of the persona whose child is interrupted.",
        },
        reason: {
          type: "string",
          description: "The reason the interrupt is asked for, written into the request file beside the time and this session's persona. Trimmed and cut at 200 characters.",
        },
      },
      required: ["persona", "reason"],
    },
  },
  // The coordinator's two roster writers, which write the roster through
  // hooks/roster.ts. fleet_add's schema properties are the fields of
  // ROSTER_FIELDS in that module, in its order, with the three the keeper's
  // invocation builder needs required and enabled absent, since the tool
  // writes it; test-personas/fleet-roster-tools-unit-test.mjs pins the two
  // lists equal.
  {
    name: "fleet_add",
    hold: "owner",
    description:
      "Add a persona to the fleet: writes one entry, with enabled set true, into the roster the plugin's fleetRoster " +
      "setting names. The arguments are the entry's fields, and name, workdir and permissionMode are required. The entry " +
      "is held to the strictest rule any reader of the roster applies and to the launch checks the supervisor runs, and a " +
      "refusal names the first rule it breaks. The roster's current text is written beside it as <roster>.prev before the " +
      "roster itself, so the previous roster can be put back from that file. The result names the roster, the backup and " +
      "the entry as written. Where a fleet supervisor runs it starts the persona within one tick, and where none runs " +
      "nothing starts until one does. Refused when this session does not hold the coordinator persona, when no roster is " +
      "set, when the roster cannot be read or is not an array, when an entry already carries the name in any letter case, " +
      "when the name is this session's own persona, when a field breaks a rule, when an enabled entry already carries the " +
      "same repo, when a repo entry's workdir is a file or a directory that is not empty, and when a repo entry names no " +
      "rundir or a rundir inside its workdir. A refusal writes nothing. Callable only from the session that holds the " +
      "coordinator persona.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The persona name: letters, digits, underscore and hyphen, not starting with a hyphen." },
        workdir: { type: "string", description: "The working directory the persona runs in." },
        permissionMode: { type: "string", description: "The permission mode the persona's session runs under, not blank." },
        rundir: { type: "string", description: "The run directory its keeper and supervisor use, <workdir>/run where omitted. Required beside repo, and then outside workdir." },
        channelName: { type: "string", description: "The channelName, the relay thread name its supervisor attaches under." },
        model: { type: "string", description: "The model name, such as opus or opus[1m]." },
        effort: { type: "string", description: "The effort, one of low, medium, high, xhigh or max." },
        controllerTickMs: { type: "integer", description: "The controllerTickMs setting in milliseconds, at least 1." },
        nudgeFloorMs: { type: "integer", description: "The nudgeFloorMs setting in milliseconds, at least 1." },
        nudgeIdleMs: { type: "integer", description: "The nudgeIdleMs setting in milliseconds, at least 1." },
        memoryGateDiscardPercent: { type: "integer", description: "The memoryGateDiscardPercent setting, the memory gate's discard percent, from 50 to 100." },
        channelLogRetentionDays: { type: "integer", description: "The channelLogRetentionDays setting, days its channel log is kept, at least 1." },
        journalRetentionDays: { type: "integer", description: "The journalRetentionDays setting, days its decision journal is kept, at least 1." },
        coordinatorPersona: { type: "string", description: "The coordinatorPersona, the coordinator seat's persona, coordinator where omitted." },
        architectPersona: { type: "string", description: "The architectPersona, the architect seat's persona, never the coordinator's." },
        liaisonPersona: { type: "string", description: "The liaisonPersona, the liaison seat's persona, which needs architectPersona and differs from both seats." },
        roadmapPersona: { type: "string", description: "The roadmapPersona, the roadmap seat's persona, which differs from the three other seats." },
        fleetRoster: { type: "string", description: "The roster its plugin watches, which must be this same roster." },
        jevMode: { type: "string", description: "The jevMode setting, off or shadow." },
        jevLive: { type: "array", description: "The jevLive ids, from the promotable set: turn-open, turn-disposition, memory-kind, turn-score, controller-decision, step-effort.", items: { type: "string" } },
        checkpointRestart: { type: "string", description: "The checkpointRestart setting, off, shadow or live, off where omitted." },
        args: { type: "array", description: "The args list of extra supervisor flags, --dev and --no-channel only.", items: { type: "string" } },
        repo: { type: "string", description: "A plain repository URL, https://<host>/<path> or git@<host>:<path>, for the repository the persona works in. One enabled entry per repository." },
        goal: { type: "object", description: "A goal persona's goal: objective, a non-blank text; done, an array of the statements that must hold for it to be done, which may be empty; and turns, an optional turn budget of at least 1. No other key." },
        lifetime: { type: "string", description: "The persona's lifetime, standing or goal, standing where omitted." },
      },
      required: ["name", "workdir", "permissionMode"],
      additionalProperties: false,
    },
  },
  {
    name: "fleet_retire",
    hold: "owner",
    description:
      "Retire a persona from the fleet: sets enabled to false on its entry in the roster the plugin's fleetRoster setting " +
      "names, keeping every other field and every other entry. The entry stays in the roster, so fleet_status still " +
      "reports a row for it. The roster's current text goes to <roster>.prev beside it first. Where a fleet supervisor " +
      "runs it takes the persona down within one tick plus the supervisor's patient-stop cap, and the persona's run " +
      "directory, store and goal tree stay. Refused when this session does not hold the coordinator persona, when no " +
      "roster is set, when the roster cannot be read or is not an array, when no entry carries the name, when the entry " +
      "is already disabled, when the persona is this session's own (supervisor_shutdown stops that one), and when another " +
      "enabled entry names the persona as its coordinatorPersona, architectPersona, liaisonPersona or roadmapPersona. " +
      "Nothing is written on a refusal. The one caller it serves is the session holding the coordinator persona.",
    inputSchema: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "The roster name of the persona to retire.",
        },
        reason: {
          type: "string",
          description: "Why the persona is retired, echoed in the result and written nowhere else, since the roster carries no reason. Trimmed and cut at 200 characters.",
        },
      },
      required: ["persona", "reason"],
    },
  },
  // agentic_resolve holds "owner": a reader owns no persona's records to
  // resolve.
  {
    name: "agentic_resolve",
    hold: "owner",
    description:
      "Owner only. Mark an operator record addressed to this persona as resolved. " +
      "A reply says a turn answered; a resolution says the work the record asked for is finished or will not be done. " +
      "A non-empty note is sent as a record to the persona the sender's session owns, where this session can reach that persona, and arrives under the delivery label an agentic_say from this session would carry. " +
      "A note on a quiet record is sent quiet: it opens no turn, carries no authority, and its reader meets it inside its running turn or a later one, so a grant or an ask goes by agentic_say without the quiet mark. " +
      "Any other note opens a turn for its reader, so where this session already answered the record with agentic_say, leave the note empty. " +
      "Where the note cannot be sent, it waits in the resolved record for the sender to read through agentic_inbox. " +
      "The resolve stands whether or not the note was sent, and the result says which. " +
      "Refused for a record still pending (not delivered yet), for a skipped record, and for a record addressed to another persona.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The record id, <persona>-<sender session id>-<seq>, the same id the sender sees in agentic_inbox. Where the delivery label shows a placeholder in the id, pass the id as the label shows it, whole and as written, its placeholder included.",
        },
        outcome: {
          type: "string",
          description: "done when the work finished, declined when it will not be done.",
        },
        note: {
          type: "string",
          description: "Optional short note for the sender: what was done, or why it was declined. At most 2000 characters; a longer note is refused.",
        },
      },
      required: ["id", "outcome"],
    },
  },
];
