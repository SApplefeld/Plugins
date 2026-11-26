// store-files.ts: store files: the file names a persona keeps in its launch directory, the
// reading of a persona store and a supervisor mailbox line, the store id of a
// persona and the meter drain bounds.
//
// No import of the engine handle: every function takes what it reads as
// arguments. The tick harness loads a fresh hooks/index.ts per case but not
// this module, so its cases share one thing here: writePersonaStore's chain
// of writes per path. Once a case's writes have settled, the chain carries
// nothing into the next case. A write that never settles does carry over,
// and it holds the next case's writes to the same path.

import { headPoints } from "./agent-state";
import { fnv1aHash } from "./cost-ledger";
import { deliveryRecordProblem } from "./operator";
import { MEMQ_TAG_CAP } from "./recall-text";
import { MEMQ_NAME_CHARSET } from "./stretch-distillation";

// The store cause sess.stateNotLoaded takes where session.start's store read
// fails, and the one-sentence answer the goal tools build from whichever
// cause stands.
export const STATE_NOT_LOADED_STORE_CAUSE = "the store file could not be read, so this session came up on an empty default state";

// The two phrases session.start composes into its start-up store line, one for
// a store that would not read and one for a store that was empty, shared with
// the store_empty_at_start decision line and with the tests that tell the two
// starts apart. The line has two carriers: a note on the first [FLEET] prompt
// for the coordinator persona watching a roster, and a [STORE LOST] turn of
// its own for every other session.
export const STORE_UNREADABLE_AT_START = "could not be read when this session started";
export const STORE_EMPTY_AT_START = "was empty when this session started";

// How long readPersonaStore waits before it reads an empty store file a
// second time. The engine's fs.write truncates the file before it writes the
// text, so a read landing between the two finds the file empty while a
// peer's write is still under way.
export const STORE_EMPTY_REREAD_MS = 50;

export function stateNotLoadedText(cause: string): string {
  return `This session never loaded its persona's state: ${cause}. The stored goal tree is not shown and was not changed.`;
}

// The persona store's text parsed and shape-checked, for readPersonaStore
// below, which every read of the store in hooks/ goes through. A parse
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

// The index one past the leading JSON value's last character, for the
// reader's repair of a store whose text does not parse whole, or -1 where
// the text opens with no object or array, or opens one that never closes.
// The scan walks the text as JSON reads it: a string runs from a quote to
// its closing quote with a backslash escaping the character after it, and
// every bracket outside a string moves the depth, so a quote or a bracket
// inside a string, as a decision's detail may carry, moves nothing. The
// value ends where the depth returns to zero.
function leadingValueEnd(text: string): number {
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== "{" && text[i] !== "[") return -1;
  let depth = 0;
  let inString = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === "\"") inString = false;
    } else if (c === "\"") {
      inString = true;
    } else if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// The persona store file read, for every site that loads a persona's state
// from it or writes into it. An absent file, and a file whose text is empty
// or whitespace alone on two reads, read as a store with no entries. A
// zero-byte file is what a truncating write leaves when the disk refuses the
// text: it holds nothing another persona could lose, and reading it as empty
// is what lets the owner's next write rebuild it. The same truncation shows
// for a moment on every write, since the engine empties the file before it
// writes the text, so a store several personas share reads empty while a
// peer's write is under way. An empty first read is therefore read again
// once, after STORE_EMPTY_REREAD_MS through fs.sleep, and only a second empty
// read, or a file gone by then, reads as empty. A first read holding text is
// never read again. Any text, on either read, goes through parsePersonaStore
// and keeps its refusals, since a file holding text may be another persona's
// tree or a write caught midway. onEmpty is called wherever the second read
// reads as empty, which is how session.start tells a lost store from one
// never written.
//
// Text that parses but not as an object keeps parsePersonaStore's own
// refusal, which names what the file parsed as. Text that does not parse at
// all is what two writes in flight on one file leave behind, the shorter
// text followed by the longer one's tail, so the reader finds the end of the
// leading value with leadingValueEnd above. Where that prefix parses as an
// object and bytes follow it, the read queues the prefix's store for writing
// through repairPersonaStore, calls onRepair once with the UTF-8 byte count
// of the tail dropped, and returns the prefix's store. Where no prefix
// parses as an object, the read throws an error reading `the persona store
// <path> did not parse: <the parse error>`, with JSON.parse's message for the
// whole text as the exact tail, and writes nothing, so what reaches a caller
// reads as the store's refusal and not as a bare syntax error.
//
// The read does not await its repair. The repair takes its place on the
// path's write chain through repairPersonaStore below, which registers the
// place when it is called, so a write called after the read returns takes a
// later place. The repair's clean text comes from the read, and the read
// can return after another flow in this session has queued its own write,
// a claim or a persist carrying newer state, which then lands before the
// repair's turn. So in its turn the repair reads the file again and writes
// the clean text only where the file still holds the text the read saw.
// Where the text has changed, the repair writes nothing, so a newer write's
// text stands and a file an earlier write emptied and then rejected stays
// empty. The chain and the compare reach only this process's writes. An
// engine write that never settles, or one already unsettled ahead of the
// repair on the chain, holds no read, only the repair and the later writes
// to that path. The repair's rejection, its re-read's included, is handled
// where it is queued, so a disk that refuses it raises nothing unhandled
// and costs the caller nothing it asked for. onRepair fires when the repair
// is queued, not when it lands, so every caller's log says the read queued
// the clean store for writing.
//
// A reader in a session of another persona, fleet_status reading that
// persona's store, passes the literal null for write. Its read returns the
// leading object, queues no repair and calls no onRepair, so it writes no
// file, and a session of that persona queues the repair at its own next read.
// write has no default, so a new caller names the engine's write or null.
export type PersonaStoreReadFs = { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; sleep(ms: number): Promise<void> };
export type PersonaStoreFs = PersonaStoreReadFs & (PersonaStoreWriteFs | { write: null });

export async function readPersonaStore(fs: PersonaStoreFs, path: string, onEmpty?: () => void, onRepair?: (droppedBytes: number) => void): Promise<Record<string, unknown>> {
  if (!(await fs.exists(path))) return {};
  let text = await fs.read(path);
  if (text.trim() === "") {
    await fs.sleep(STORE_EMPTY_REREAD_MS);
    text = (await fs.exists(path)) ? await fs.read(path) : "";
    if (text.trim() === "") {
      onEmpty?.();
      return {};
    }
  }
  let parseError: SyntaxError | null = null;
  try {
    return parsePersonaStore(text);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    parseError = err;
  }
  const end = leadingValueEnd(text);
  let store: Record<string, unknown> | null = null;
  if (end !== -1) {
    try { store = parsePersonaStore(text.slice(0, end)); } catch { /* the leading value is not an object of persona entries */ }
  }
  if (store === null) throw new Error(`the persona store ${path} did not parse: ${parseError.message}`);
  if (fs.write === null) return store;
  const droppedBytes = new TextEncoder().encode(text.slice(end)).length;
  repairPersonaStore(fs, path, store, text).catch(() => { /* a repair the disk refuses, or whose re-read fails, is logged as queued and raises nothing here */ });
  onRepair?.(droppedBytes);
  return store;
}

// The persona store file written, for every site in hooks/ that writes it:
// the claim write, the guarded write's two branches and the heartbeat tick's
// deferred promotion. The engine's write empties the file when it is called
// and lands the text after, so two writes in flight on one file leave the
// shorter text followed by the longer one's leftover tail, which is a store
// no reader parses. This helper hands a write to the engine only once the
// previous write to the same path has settled, resolved or rejected, so no
// two writes from one session are in flight on one file at once and writes
// land in the order they were called. The chain is one promise per path,
// held here in module scope, and queueStoreWrite places a task at its end.
// The reader's repair, repairPersonaStore, takes the same chain, so one
// chain per path orders every write this process makes to the file. The
// text is serialised at the call, as every site did in place, so a store
// the caller changes after the call is not what lands. A write that rejects
// rejects the promise its caller awaits, as the engine's own write did, and
// the chain's stored tail swallows that rejection so the next write to the
// path is not blocked by it. An engine write that never settles holds every
// later write to that path for the session, since the chain starts no write
// while an earlier one to the path is unsettled. The engine's write spends
// none of the calling hook's budget, as hooks/index.ts's
// METER_WRITE_TIMEOUT_MS comment states. Waiting behind an earlier write on
// the chain may spend that budget, since the engine stops the hook's clock
// only while one of the hook's own `$` calls is in flight, and a wait on
// another call's write is not one. That cost is not measured on the real
// engine. The chain orders writes, not a site's
// read-change-write. Two sites that read the store before either writes can
// still each write their own copy, and the later write keeps only its own
// changes.
export type PersonaStoreWriteFs = { write(path: string, text: string): Promise<void> };

const storeWriteTails = new Map<string, Promise<void>>();

// The task placed at the end of the path's chain, started once the chain's
// previous task has settled. The place is registered before this returns,
// so two calls take the chain in call order. The promise returned settles
// as the task does, and the tail the chain stores swallows a rejection.
function queueStoreWrite(path: string, task: () => Promise<void>): Promise<void> {
  const previous = storeWriteTails.get(path) ?? Promise.resolve();
  const run = previous.then(task);
  storeWriteTails.set(path, run.then(() => undefined, () => undefined));
  return run;
}

export async function writePersonaStore(fs: PersonaStoreWriteFs, path: string, store: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(store, null, 2);
  await queueStoreWrite(path, () => fs.write(path, text));
}

// The reader's repair of a store whose text held a stray tail: the clean
// store's text written in the repair's turn on the path's chain, only where
// the file read again in that turn still holds tornText, the text the read
// saw. Over a file holding other text by then the repair writes nothing.
// A newer write's text stands, and a file an earlier write emptied and then
// rejected stays empty. The re-read goes through the same read the reader's
// fs carries, and its rejection rejects the promise returned, as the
// write's does.
function repairPersonaStore(fs: PersonaStoreReadFs & PersonaStoreWriteFs, path: string, store: Record<string, unknown>, tornText: string): Promise<void> {
  const text = JSON.stringify(store, null, 2);
  return queueStoreWrite(path, async () => {
    if ((await fs.read(path)) !== tornText) return;
    await fs.write(path, text);
  });
}

// The three files a supervised session keeps in its launch directory, and
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
// The anchor is the launch directory, sess.memqLaunchDir, which the first
// session.start captures from its cwd and $.state holds across a reload of the
// plugin's code. A reload whose $.state read fails has no held value to read
// and anchors to its own cwd, as a first start does. sess.workdir alone is not
// the anchor, because session.start fires again on a reload with whatever cwd
// the session has moved to; it stands in only where no launch directory is
// known. For a supervisor-launched child the launch directory is the one the
// supervisor holds, because supervise.sh cds to the absolute WORKDIR it
// resolves before launching. For a session started by hand it is
// whatever cwd that launcher had, which anchoring still improves on. The bare
// names are the fallback for the one case that leaves both empty, a
// session.start whose cwd could not be read at all.
//
// The join is unconditional "/", as rosterRunDir's own join in hooks/fleet.ts is: Windows
// resolves a forward slash, and every path this can see is either a Windows
// path or a POSIX one.
export const HEARTBEAT_FILENAME = ".agentic-heartbeat.json";

export const PERSONA_STORE_FILENAME = ".agentic-personas.json";

export const YIELD_LOG_FILENAME = ".agentic-yields.log";

// handover_write replaces this file whole with the note a session leaves for
// the next session of its persona, beside the store, and the next session's
// priming turn reads it (hooks/handover.ts). It holds session ids and the
// session's own words, so this repository's .gitignore ignores it and
// build.ps1 keeps it out of the package. A worker repository the persona runs
// in holds it as an untracked file unless that repository's own ignore file
// lists it.
export const HANDOVER_FILENAME = ".agentic-handover.json";

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
  const kept = headPoints(persona.replace(/[^A-Za-z0-9_.-]/g, ""), MEMQ_TAG_CAP - prefix.length - 1 - hash.length);
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
  if (o.kind !== "probe" && o.kind !== "shutdown") return { problem: `has kind ${headPoints(JSON.stringify(o.kind), 40)}, outside probe and shutdown` };
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return { problem: "has an at that is not a number" };
  const recordProblem = deliveryRecordProblem({ id: o.id, text: o.text });
  if (recordProblem !== null) return { problem: recordProblem };
  return { id: o.id as string, kind: o.kind, at: o.at, text: o.text as string };
}
