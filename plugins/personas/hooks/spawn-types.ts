// spawn-types.ts: the agent type of each subagent the agent.spawn hook saw
// start, by the id its loop's tool calls carry. Pure: nothing here reads `$`,
// since the loader follows `$` only into a function declared in the file it
// is reading. hooks/index.ts owns the one map per register call, records
// into it from the spawn hook and reads it from the guard context.
//
// The engine's type file says a workflow's agents and the engine's own forks
// carry ids `$.agent.list()` never names, so a guard that typed a loop from
// the list alone saw no type for a Workflow-dispatched agent and allowed its
// call. The spawn result's `agentId` is the id that agent's `tool.call`
// events carry, and the spawn input's `subagentType` is its type, so the
// pair the hook sees at the start is the row the list lacks.
//
// The map relies on the engine resolving a spawn once the subagent has
// started, so the record lands before that agent's first tool call, which
// follows a model turn. Nothing evicts an entry, so the map grows by one entry
// per started subagent for the register call's life. The type recorded is the
// `subagentType` this hook received: a later agent.spawn hook may rewrite it,
// and the spawn result carries no type back. A plugin reload runs `register`
// again with an empty map, so an agent started before it has no recorded type.

import { bracketSafeText, oneLine } from "./agent-state";
import { boundedText } from "./text";

// One register call's map: the started subagent's id to its agent type.
export type SpawnTypes = Map<string, string>;

export function newSpawnTypes(): SpawnTypes {
  return new Map();
}

/**
 * Records a spawn's result against its input's type and answers the id
 * recorded, or null where nothing was. A `{ deny }` result, a withheld spawn
 * and a result with no string `agentId` started no subagent, so none records;
 * a type that is not a non-empty string records nothing either, since a guard
 * reads an empty type as no type.
 */
export function recordSpawnType(types: SpawnTypes, result: unknown, subagentType: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const id = (result as { agentId?: unknown }).agentId;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof subagentType !== "string" || subagentType.length === 0) return null;
  types.set(id, subagentType);
  return id;
}

// The type recorded for `agentId`, or undefined where no spawn recorded one.
export function spawnTypeOf(types: SpawnTypes, agentId: string): string | undefined {
  return types.get(agentId);
}

// The debug-log line for one started subagent. Both values are the engine's,
// so each is folded to one line, neutralized and bounded, as the session
// start's log of a refused setting treats configuration text.
export function spawnLogLine(subagentType: string, agentId: string): string {
  const safe = (text: string) => boundedText(bracketSafeText(oneLine(text)));
  return `Agentic: agent.spawn started ${safe(subagentType)} as ${safe(agentId)}`;
}
