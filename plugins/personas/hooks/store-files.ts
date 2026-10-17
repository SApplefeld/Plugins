// store-files.ts: store files: the file names a persona keeps in its working directory, the
// reading of a persona store and a supervisor mailbox line, the store id of a
// persona and the meter drain bounds.
//
// No import of the engine handle and no state of its own: every function takes what it
// reads as arguments, so the tick harness, which loads a fresh hooks/index.ts per
// case, shares nothing through it.

import { fnv1aHash } from "./cost-ledger";
import { deliveryRecordProblem } from "./operator";
import { MEMQ_TAG_CAP } from "./recall-text";
import { MEMQ_NAME_CHARSET } from "./stretch-distillation";

// The store cause sess.stateNotLoaded takes where session.start's store read
// fails, and the one-sentence answer the goal tools build from whichever
// cause stands.
export const STATE_NOT_LOADED_STORE_CAUSE = "the store file could not be read, so this session came up on an empty default state";

export function stateNotLoadedText(cause: string): string {
  return `This session never loaded its persona's state: ${cause}. The stored goal tree is not shown and was not changed.`;
}

// The persona store's text parsed and shape-checked, for the reads that load a
// persona's state from it: session.start's and agentic_identity's two. A parse
// that returns is not a store that read. JSON.parse("null") returns null, and
// an array, a number and a string all parse as cleanly, but none of them holds
// a persona entry to load or an object a claim can be written into: a lookup
// on null throws a TypeError, and a claim written into an array serializes
// back as the array with the entry dropped. So anything but an object throws
// here, the same refusal as a file that would not parse at all.
export function parsePersonaStore(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`the file parsed as ${parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed} rather than as an object of persona entries`);
  }
  return parsed as Record<string, unknown>;
}

// The three files a supervised session keeps beside its working directory, and
// the resolver that anchors them to the directory the session was launched in
// rather than to wherever the working directory has since moved.
//
// bin/supervise.sh resolves these files once, against the absolute WORKDIR it
// was launched with, and never resolves them again: the persona store is
// handed to bin/supervise-poll.mjs, whose readStoreFacts harvests
// shutdown_requested, park_requested and restart_requested out of it, and the
// heartbeat sidecar is what its pre-launch gate reads to tell whether the
// persona is held. A session that resolved the bare names against a working
// directory a tool call had moved would write them where nothing reads them.
//
// The sidecar is the record of who holds a persona. It is not the supervisor's
// liveness signal: every persona launched in one directory rewrites it whole,
// so one session's entry can read stale while it stamps on time. A supervised
// child also stamps a heartbeat file only it writes, named by the
// supervisorHeartbeatPath option, and that file is what the supervisor's
// liveness verdict in bin/supervise-liveness.mjs reads.
//
// The store is the reason these files move together rather than the heartbeat
// alone. Anchoring the heartbeat by itself would leave a displaced session
// holding its persona while its shutdown request, its restart request and its
// goal completion were written somewhere the supervisor never reads.
//
// A supervised child is also handed the sidecar's absolute path as the
// heartbeatPath option, from the same launcher that reads it, so the writer and
// the reader hold one path whatever the session's working directory. Where that
// option is set, heartbeatPathOf returns it; every heartbeat read and write in
// hooks/index.ts goes through heartbeatPathOf. This module holds the file names.
//
// sess.workdir is captured at session.start from the launch cwd, before any
// tool call can move it. For a supervisor-launched child that is the same
// directory the supervisor holds, because supervise.sh:119 cds to the absolute
// WORKDIR it resolved at :107 before launching. For a session started by hand
// it is whatever cwd that launcher had, which anchoring still improves on. The
// bare names are the fallback for the one case that leaves sess.workdir empty,
// a session.start whose cwd could not be read at all.
//
// The join is unconditional "/", as rosterRunDir's own join in hooks/fleet.ts is: Windows
// resolves a forward slash, and every path this can see is either a Windows
// path or a POSIX one.
export const HEARTBEAT_FILENAME = ".agentic-heartbeat.json";

export const PERSONA_STORE_FILENAME = ".agentic-personas.json";

export const YIELD_LOG_FILENAME = ".agentic-yields.log";

// goal_create appends each tree it replaces here, one JSON line per tree,
// beside the store, and the fold appends each node a completed plan sheds, one
// JSON line per node (foldSettledPlans). It is a recovery copy opened by hand.
// The plugin reads it back only for the fold's own lines, so a fold that runs
// again writes no node twice.
export const GOAL_HISTORY_FILENAME = ".agentic-goal-history.jsonl";

// The meter drain's interval: `memq meter-drain` starts at most once this often.
// The meter itself, its writes and their failure latch, is in hooks/index.ts.
export const METER_DRAIN_EVERY_MS = 10 * 60_000;

// How long one drain may run before $.process.run kills it. A killed drain
// leaves every file it had not deleted, and the next drain sends them again.
export const METER_DRAIN_TIMEOUT_MS = 120_000;

// The id a persona carries in the kit's memory store, in its record names,
// its persona-<id> tag and its persona-<id> author. It is the name itself
// where the name holds only memq's name charset and persona-<name> fits the
// tag cap. Otherwise it is the name with every other character removed, cut
// so that persona-<id> still fits, then a dash and the base-36 fnv1a hash of
// the full name, so two names that differ only in removed characters keep
// apart. Two names that differ only in letter case are not kept apart: memq
// compares record names without case on Windows, so the second one's write
// is refused as a duplicate. Reading and stamping a persona's records go by
// the same id.
export function personaStoreId(persona: string): string {
  const prefix = "persona-";
  if (MEMQ_NAME_CHARSET.test(persona) && prefix.length + persona.length <= MEMQ_TAG_CAP) return persona;
  const hash = fnv1aHash(persona).toString(36);
  const kept = persona.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, MEMQ_TAG_CAP - prefix.length - 1 - hash.length);
  return `${kept}-${hash}`;
}

// The ack file beside a mailbox: mailbox.jsonl reads mailbox.ack.jsonl.
export function supervisorAckPathOf(mailboxPath: string): string {
  return `${mailboxPath.replace(/\.jsonl$/, "")}.ack.jsonl`;
}

type SupervisorMailboxRecord = { id: string; kind: "probe" | "shutdown"; at: number; text: string };

// One mailbox line read as a record, or the reason it is not one. The id and
// the text are held to the rule the inbox drain holds a record to
// (deliveryRecordProblem), since the id is spliced into the [SUPERVISOR id=]
// label and the text is submitted as a turn.
export function parseSupervisorMailboxLine(line: string): SupervisorMailboxRecord | { problem: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return { problem: "is not JSON" }; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { problem: "is not a JSON object" };
  const o = parsed as Record<string, unknown>;
  for (const field of ["id", "kind", "at", "text"]) {
    if (!(field in o)) return { problem: `lacks the ${field} field` };
  }
  if (o.kind !== "probe" && o.kind !== "shutdown") return { problem: `has kind ${JSON.stringify(o.kind).slice(0, 40)}, outside probe and shutdown` };
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return { problem: "has an at that is not a number" };
  const recordProblem = deliveryRecordProblem({ id: o.id, text: o.text });
  if (recordProblem !== null) return { problem: recordProblem };
  return { id: o.id as string, kind: o.kind, at: o.at, text: o.text as string };
}
