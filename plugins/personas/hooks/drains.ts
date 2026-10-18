// drains.ts: the owed work the controller tick and the heartbeat drain one
// item at a time, each behind a fork watch, and the supervisor mailbox pass.
// It holds the memory drain, which writes a turn's owed record, with
// writeMemoryRecord, the one memq put of a persona's record, and the
// decisions its writes log; the ask brief drain, which drafts a worker ask's
// decision brief and posts it; the pair drain, which drafts the [PAIR
// DRAFTS] block a decay scan owes; and the pass over the supervisor's
// mailbox. hooks/index.ts holds the wiring: the deps each call takes, the
// session object these functions read and write, the fork watches among its
// fields, the fork and completion model requests, whose scrub
// test-personas/redactor-module-test.mjs reads from that file, and the [ASK
// BRIEF] and [SUPERVISOR] submits, whose frames
// test-personas/injection-ledger.mjs reads from that file.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts, so each function here takes
// a DrainsDeps, or the slice of it a decision note reads, that hooks/index.ts
// builds at each call. The session crosses as the object itself, so each
// field, a fork watch's generation included, is read at the moment the code
// reads it. The module holds no state of its own, since the tick harness
// evaluates it once per process while it loads a fresh hooks/index.ts per
// case.

import { bracketSafeText, LINE_TERMINATOR, oneLine } from "./agent-state";
import { askBriefPrompt, parseAskBrief, renderAskBrief, takeAskBriefOwed } from "./ask-brief";
import { meterSessionKnown } from "./beat";
import { cacheReading, type CacheClockState } from "./cache-clock";
import type { ExpectedTurn, SubmitOutcome } from "./channel-text";
import type { CommonsStore } from "./commons";
import { fnv1aHash } from "./cost-ledger";
import { enqueueFollowUps, readFollowUps, TURN_END_SOURCE, writeFollowUps, type FollowUpDecide } from "./follow-ups";
import { beginFork, forkExpiredDetail, forkHeld, forkLateDetail, forkLost, forkOverdue, forkReleased, forkStale, forkTimed, FORK_IDLE, type ForkWatch } from "./fork-watch";
import type { PluginHost } from "./host";
import { addForkUsage, forkUsageOf, memoryFallbackPrompt, memoryTurnHead, memoryWriterFollowUps, memoryWriterPrompt, MEMORY_OWED_LIFE_MS, parseMemoryWriterReply, takeMemoryOwed, WRITER_TAG_FORK, WRITER_TAG_HAIKU, type MemoryOwed, type MemoryWriterReply } from "./memory-writer";
import type { KitMemqOptions, KitMemqResult } from "./memq-boundary";
import { updateAskRecordBrief } from "./operator";
import { pairDrafterPrompt, pairDraftsBlock, pairTierFlag, parsePairDrafterReply, type ScanPair } from "./pair-drafter";
import { fetchedRecordOf, memqKindOf, MEMQ_READ_TIMEOUT_MS, MEMQ_WRITE_TIMEOUT_MS, type MemoryWriteOutcome } from "./recall-text";
import { BLOCK_WITHHELD, scrubText } from "./redactor";
import type { SessionState } from "./session-state";
import { parseSupervisorMailboxLine, personaStoreId, supervisorAckPathOf } from "./store-files";
import { noteStretchWritten } from "./stretch-distillation";
import { boundedText, safeErrorText } from "./text";

// The session fields the drains read and write, which the session object in
// hooks/index.ts satisfies.
export type DrainsSession = Pick<SessionState, "persona" | "mySessionId" | "isOwner" | "state" | "memqWrittenThisSession" | "memoryFork" | "askBriefFork" | "pairFork" | "pairDraftOwed" | "pairDrafts">;

// What hooks/index.ts hands the drains: the session; the host, the commons
// store and the prompt-cache clock; the persist with its rollback for a
// write that gives the persona up; the memq run; the scrubbed transcript
// fork and the memory fallback's scrubbed Haiku completion, with the
// completion reader and the no-text note; the follow-up queue's decision
// writer; the reply tool call; the [ASK BRIEF] and [SUPERVISOR] submits; and
// the JSONL append the ack file takes.
export interface DrainsDeps {
  session: DrainsSession;
  host: PluginHost;
  store: CommonsStore;
  cacheClock: CacheClockState;
  persist: (rollBackOnYield?: () => void) => Promise<boolean>;
  kitMemq: (argv: string[], opts: KitMemqOptions) => Promise<KitMemqResult | null>;
  fork: (prompt: string) => Promise<unknown>;
  completeMemoryFallback: (prompt: string) => Promise<unknown>;
  completionText: (value: unknown) => string | null;
  noteCompletionShape: (site: string, value: unknown) => void;
  pushFollowUpDecision: FollowUpDecide;
  callTool: (call: { tool: string; message: string }) => Promise<unknown>;
  submitAskBriefReprompt: (expectedTurns: ExpectedTurn[], brief: string) => Promise<SubmitOutcome>;
  appendLines: (path: string, lines: string[]) => Promise<void>;
  submitSupervisorShutdown: (expectedTurns: ExpectedTurn[], rec: { id: string; text: string }) => Promise<SubmitOutcome>;
}

// The slice of DrainsDeps a decision note reads, which a caller holding no
// `$` builds.
export type DrainNoteDeps = Pick<DrainsDeps, "session">;

// Writes `text` as one record in the kit's memory store through memq put,
// tagged with its source, its kind and this persona's store id, with the
// author persona-<id>, since memq's author grammar is the record-name charset
// and refuses a colon. The name is the kind, the persona's store id and the
// base-36 fnv1a hash of the text lowercased and trimmed, the persona in it
// because memq refuses a name its project tier already holds whatever the
// tags, so two personas in one launch directory writing the same text write
// two records.
// The description is the text's first line with each control character a
// space, since memq refuses one there, then each double quote a single quote
// and each backslash a slash, since memq has no quoted form for a
// description holding a single quote beside either, cut to 120 code points
// so a surrogate pair is never split. It is passed behind one leading space,
// which memq trims. The body is one provenance line naming the persona, the
// source, this session and the UTC date of `createdAt`, a blank line, then
// the text. So neither opens with `--`, which memq reads as an option
// whatever the text. Logs nothing itself: kitMemq logs a spawn that failed,
// and each caller logs the outcome its own way.
// `writerTag`, where set, is one more tag naming which writer drafted the
// text, the fork or the Haiku fallback; it changes nothing else about the
// record, so the same text from either writer derives one name.
export async function writeMemoryRecord(
  deps: DrainsDeps,
  text: string,
  { kind, source, createdAt, writerTag }: { kind: unknown; source: "distilled" | "worker" | "user"; createdAt: number; writerTag?: string },
): Promise<MemoryWriteOutcome> {
  // The shared store is a store surface: every writer's text, a legacy
  // entry from before the redactor among them, reaches it scrubbed. A failed
  // scan writes nothing, so a legacy entry stays for the next start.
  text = scrubText(text).text;
  const heldKind = memqKindOf(kind);
  const storeId = personaStoreId(deps.session.persona);
  if (text === BLOCK_WITHHELD) return { outcome: "failed", name: `${heldKind}-${storeId}`, reason: "the redactor's scan failed", ran: true };
  const name = `${heldKind}-${storeId}-${fnv1aHash(text.toLowerCase().trim()).toString(36)}`;
  const firstLine = text.split(LINE_TERMINATOR)[0]
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ")
    .replace(/"/g, "'")
    .replace(/\\/g, "/");
  const description = " " + Array.from(firstLine).slice(0, 120).join("");
  const date = new Date(Number.isFinite(createdAt) ? createdAt : Date.now()).toISOString().slice(0, 10);
  const body = `Written by persona ${deps.session.persona} from source ${source} in session ${deps.session.mySessionId} on ${date}.\n\n${text}`;
  const res = await deps.kitMemq([
    "put", name, description,
    "--body", body,
    "--tag", source,
    "--tag", heldKind,
    "--tag", "persona-" + storeId,
    ...(writerTag !== undefined ? ["--tag", writerTag] : []),
    "--author", "persona-" + storeId,
  ], { timeoutMs: MEMQ_WRITE_TIMEOUT_MS });
  if (res === null) return { outcome: "failed", name, reason: "memq did not run to an exit", ran: false };
  if (res.exitCode === 0) return { outcome: "written", name };
  const lines = res.stderr.split(LINE_TERMINATOR);
  const refusal = res.exitCode === 1 ? lines.find((line: string) => line.startsWith(`memq: '${name}' already exists`)) : undefined;
  if (refusal !== undefined) {
    return { outcome: "duplicate", name, retired: refusal.includes("retired under archive/") };
  }
  const reasonLine = (lines.find((line: string) => line.trim() !== "") ?? "").trim().slice(0, 150);
  return { outcome: "failed", name, reason: reasonLine || `memq exited ${res.exitCode === null ? "unknown" : res.exitCode}`, ran: true };
}

// Logs what the distiller's or memory_add's write came to, and counts a
// written record for the tick summary: remember names the record and the
// text's opening, memory_duplicate names the record the store already held,
// and memory_write_failed names the reason. A failed fact is dropped rather
// than queued, since the next turn distills again.
export function noteMemoryWrite(deps: DrainNoteDeps, written: MemoryWriteOutcome, text: string): void {
  if (written.outcome === "written") {
    deps.session.memqWrittenThisSession += 1;
    // The stretch fork's banked list.
    deps.session.state.stretchWritten = noteStretchWritten(deps.session.state.stretchWritten, written.name, text);
  }
  deps.session.state.decisions.push({
    timestamp: Date.now(),
    loop: "memory",
    action: written.outcome === "written" ? "remember" : written.outcome === "duplicate" ? "memory_duplicate" : "memory_write_failed",
    detail: written.outcome === "failed" ? `${written.name}: ${bracketSafeText(written.reason)}` :`${written.name}: ${text.slice(0, 80)}`,
  });
}

// One memory_owed_dropped decision for an owed item the queue or the drain let
// go, naming the item's turn and why.
export function noteMemoryOwedDropped(deps: DrainNoteDeps, item: MemoryOwed, reason: string): void {
  deps.session.state.decisions.push({
    timestamp: Date.now(),
    loop: "memory",
    action: "memory_owed_dropped",
    detail: `turn ${item.turnId}: ${reason}`,
  });
}

// One fork watch line on the memory loop, naming the drain's turn.
function noteMemoryFork(deps: DrainNoteDeps, action: string, turnId: string, detail: string): void {
  deps.session.state.decisions.push({ timestamp: Date.now(), loop: "memory", action, detail: `turn ${turnId}: ${detail}` });
}

// A drain's entry: an overdue watch is released under one `${name}_expired`.
function forkEntry(deps: DrainNoteDeps, w: ForkWatch, name: string, note: typeof noteMemoryFork): ForkWatch {
  if (!forkOverdue(w, Date.now())) return w;
  note(deps, `${name}_expired`, w.subject, forkExpiredDetail(w, Date.now()));
  return forkReleased(w);
}

// A fork that settled or rejected after its release: any usage reaches the
// ledger, one `${name}_late` line rides one persist, and nothing else is written.
async function forkLate(deps: DrainsDeps, forked: any, name: string, note: typeof noteMemoryFork, mine: ForkWatch): Promise<void> {
  const counts = forked?.usage !== null && typeof forked?.usage === "object" ? forkUsageOf(forked.usage) : null;
  if (counts !== null) deps.session.state.monitor.cost.forkUsage = addForkUsage(deps.session.state.monitor.cost.forkUsage, counts);
  note(deps, `${name}_late`, mine.subject, forkLateDetail(counts, mine, Date.now()));
  try { await deps.persist(); } catch { /* the store refused; the line waits */ }
}

// The controller tick's memory drain: writes the record for the oldest owed
// item, one per tick, for the owner alone (the tick's owner check runs
// first). The item leaves the queue, and the store, before any model call is
// awaited, so a crash or an overlapping tick never writes it twice. An item
// older than MEMORY_OWED_LIFE_MS is dropped under memory_owed_dropped and the
// next live one is taken on the same tick. Where the cache clock reads warm
// the writer is a fork of the session's own transcript, served from the main
// thread's prompt cache, and lastForkAt is stamped only where the fork
// answered, since a nothing-to-fork or api-error result reached no cache. The
// clock alone picks the writer; the item's age plays no part. Where the clock
// reads cold, the fork does not answer, or its text is not the one JSON
// object the reader takes, the Haiku completion over the item's two heads
// runs as the distiller always has, awaited whole: a timer has no hook
// budget and the call bounds itself. One memory_fork_fallback decision names
// why the fork fell through, and a fork is never called twice for one item.
// Every fork result carrying a `usage` object adds its counts to the ledger
// and pushes one memory_fork decision naming the three, answered or not, a
// missing count reading zero; a result carrying none, as nothing-to-fork
// does, made no request and adds and decides nothing. A fork's record whose
// `existing` names a record the prompt-time read showed this session, under
// any goal, is a memory_duplicate and writes nothing; a name off that list is
// ignored. Wherever the reply parsed, a duplicate and a null record included,
// its follow-ups, cut by memoryWriterFollowUps, join the session's follow-up
// queue under source turn-end and the item's turn id, read and written once
// just before the last persist and behind a catch of its own, as
// followUpsAtTurnEnd in hooks/index.ts does; the fallback adds none. Never
// throws: a failed drain ends with the item gone and the tick goes on.
export async function drainMemoryOwed(deps: DrainsDeps): Promise<void> {
  deps.session.memoryFork = forkEntry(deps, deps.session.memoryFork, "memory_fork", noteMemoryFork);
  if (deps.session.memoryFork.since !== null || deps.session.state.memoryOwed.length === 0) return;
  let mine = FORK_IDLE;
  try {
    const now = Date.now();
    const { item, dropped } = takeMemoryOwed(deps.session.state.memoryOwed, now);
    mine = deps.session.memoryFork = beginFork(deps.session.memoryFork, now, item?.turnId ?? "");
    for (const old of dropped) noteMemoryOwedDropped(deps, old, `older than ${MEMORY_OWED_LIFE_MS / 60_000} minutes at the drain`);
    // The removal reaches the store before the model is asked, and the
    // decisions below ride the write at the end; a refused write leaves both
    // in memory for the next write that is not refused. A write that gives
    // the persona up puts the item back at the queue's head first, so the
    // store the yield leaves still owes it to the next owner, and the drain
    // ends there: a session that is no longer the owner forks and writes
    // nothing.
    let kept = true;
    try {
      kept = await deps.persist(() => { if (item !== null) deps.session.state.memoryOwed.unshift(item); });
    } catch { /* the store refused; the removal stands in memory */ }
    if (!kept || item === null) return;
    let reply: MemoryWriterReply | null = null;
    let fallback: string | null = null;
    if (cacheReading(now, deps.cacheClock, false).warm) {
      // The turn head, or the prompt head where the item holds none, is
      // folded to one line with its brackets turned, as every other message the plugin composes in
      // its own voice is, so the head cannot close the plugin's line or open
      // a bracketed label of its own. The fallback's prompt below carries the
      // raw head: its request is the distiller's own, unchanged.
      // The fork's instant is the one before the request leaves, since that
      // is when the cache was read; the stamp below takes it where the fork
      // answered.
      const forkAt = Date.now();
      mine = deps.session.memoryFork = forkTimed(deps.session.memoryFork, forkAt);
      const forked = await deps.fork(memoryWriterPrompt({ ...item, turnHead: bracketSafeText(oneLine(memoryTurnHead(item))) }));
      if (forkStale(deps.session.memoryFork, mine.generation)) return await forkLate(deps, forked, "memory_fork", noteMemoryFork, mine);
      deps.session.memoryFork = forkHeld(deps.session.memoryFork);
      const rawUsage = forked !== null && typeof forked === "object" ? (forked as { usage?: unknown }).usage : undefined;
      // A result with no usage object made no request, as nothing-to-fork
      // does, so there is nothing to sum or to decide on.
      if (rawUsage !== null && typeof rawUsage === "object") {
        const usage = forkUsageOf(rawUsage);
        deps.session.state.monitor.cost.forkUsage = addForkUsage(deps.session.state.monitor.cost.forkUsage, usage);
        deps.session.state.decisions.push({
          timestamp: Date.now(),
          loop: "memory",
          action: "memory_fork",
          detail: `turn ${item.turnId}: inputTokens ${usage.inputTokens}, outputTokens ${usage.outputTokens}, cacheReadInputTokens ${usage.cacheReadInputTokens}`,
        });
      }
      if (forked !== null && typeof forked === "object" && (forked as { isAnswered?: unknown }).isAnswered === true) {
        deps.cacheClock.lastForkAt = forkAt;
        const text = (forked as { text?: unknown }).text;
        reply = parseMemoryWriterReply(typeof text === "string" ? text : "", item.kind);
        if (reply === null) fallback = "unparsed";
      } else {
        // The result's own reason word, one of nothing-to-fork, api-error,
        // empty-reply and aborted; a result carrying none reads as a reply
        // with no text.
        const reason = forked !== null && typeof forked === "object" ? (forked as { reason?: unknown }).reason : undefined;
        fallback = typeof reason === "string" ? bracketSafeText(oneLine(reason)).slice(0, 40) : "empty-reply";
      }
    } else {
      fallback = "cold";
    }
    if (fallback !== null) {
      deps.session.state.decisions.push({
        timestamp: Date.now(),
        loop: "memory",
        action: "memory_fork_fallback",
        detail: `${fallback}, turn ${item.turnId}`,
      });
      const rawDistilled = await deps.completeMemoryFallback(memoryFallbackPrompt(item.promptHead, item.answerHead));
      // A result with no text distills nothing, as an empty reply does,
      // after one line naming the shape the engine handed back.
      const distilledText = deps.completionText(rawDistilled);
      if (distilledText === null) deps.noteCompletionShape("memory-distill", rawDistilled);
      const distilled = (distilledText ?? "").trim();
      // The owner reading is taken again at the write: the model call above
      // is a wait across which another session can take the persona.
      if (distilled.length > 0 && distilled.toUpperCase() !== "NONE" && deps.session.isOwner) {
        const written = await writeMemoryRecord(deps, distilled, { kind: item.kind, source: "distilled", createdAt: Date.now(), writerTag: WRITER_TAG_HAIKU });
        noteMemoryWrite(deps, written, distilled);
      }
    } else if (reply !== null) {
      const shown = reply.existing !== null ? deps.session.state.shownMemories.find((m) => m.name === reply.existing) : undefined;
      if (shown !== undefined) {
        deps.session.state.decisions.push({
          timestamp: Date.now(),
          loop: "memory",
          action: "memory_duplicate",
          detail: `${bracketSafeText(oneLine(shown.name))}: the fork named it as already holding the fact`,
        });
      } else if (reply.record !== null && deps.session.isOwner) {
        const written = await writeMemoryRecord(deps, reply.record.text, { kind: reply.record.kind, source: "distilled", createdAt: Date.now(), writerTag: WRITER_TAG_FORK });
        noteMemoryWrite(deps, written, reply.record.text);
      }
    }
    // A throw in the follow-ups costs them alone, never the persist below.
    try {
      const followUps = reply === null ? [] : memoryWriterFollowUps(reply.followups).map((f) => ({ source: TURN_END_SOURCE, ...f }));
      if (followUps.length > 0 && meterSessionKnown(deps.session.mySessionId)) {
        const store = deps.store;
        const queue = await readFollowUps(store, deps.session.mySessionId);
        if (queue !== null) await writeFollowUps(store, deps.session.mySessionId, enqueueFollowUps(queue, followUps, Date.now(), item.turnId, deps.pushFollowUpDecision));
      }
    } catch { /* the follow-ups are lost; the record and the decisions above still persist */ }
    try { await deps.persist(); } catch { /* the store refused; the lines above wait for one that parses */ }
  } catch {
    // The drain failed; the item is gone and the tick goes on.
    if (forkLost(deps.session.memoryFork, mine)) await forkLate(deps, null, "memory_fork", noteMemoryFork, mine);
  } finally {
    if (!forkStale(deps.session.memoryFork, mine.generation)) deps.session.memoryFork = forkReleased(deps.session.memoryFork);
  }
}

// One decision line of the ask brief drain, on the monitor loop, where the
// ask_opened line it follows sits.
function noteAskBrief(deps: DrainNoteDeps, action: string, askId: string, detail: string): void {
  deps.session.state.decisions.push({ timestamp: Date.now(), loop: "monitor", action, detail: `ask ${askId}: ${detail}` });
}

// The controller tick's ask brief drain: drafts the decision brief for the
// oldest owed worker ask, one per tick, for the owner alone. The item leaves
// the queue, and the store, before the fork is awaited, so an overlapping
// tick never forks it twice; dead items (takeAskBriefOwed names the rules)
// drop under ask_brief_dropped and the next live one is taken on the same
// tick. A cold cache clock drops the item under ask_brief_fallback cold with
// no model call: a brief drafted from less than the transcript is the
// worker's bare ask in more words. Otherwise a fork of the transcript is
// asked for the brief's parts as JSON, lastForkAt is stamped where it
// answered, and a result carrying usage adds its counts to the fork ledger.
// A fork that did not answer, a reply the reader or the renderer refuses,
// and a failed scrub each drop the item under one ask_brief_fallback naming
// why. The renderer returns the brief as posts in order, the framing post
// first and then the option posts, and each post is scrubbed alone: a scrub
// that fails on any one drops the whole brief under scrub-failed. The scrubbed
// posts joined by a blank line are the brief the entry carries, persisted
// first, the commons record carries where that still reads open, and the
// [ASK BRIEF] prompt quotes. The posts go to the persona's thread through the
// relay's reply tool, one call each in order. A thrown post is logged
// ask_brief_unposted naming its number and the count, no later post is sent,
// and the whole joined brief goes once more as one [ASK BRIEF] plugin prompt
// through the submit path the [STILL WAITING] re-raise takes, which a blocking
// hold does not stop. Never throws: a failed drain ends with the item gone.
export async function drainAskBriefOwed(deps: DrainsDeps, cfg: Record<string, unknown>, expectedTurns: ExpectedTurn[]): Promise<void> {
  deps.session.askBriefFork = forkEntry(deps, deps.session.askBriefFork, "ask_brief_fork", noteAskBrief);
  if (deps.session.askBriefFork.since !== null || deps.session.state.askBriefOwed.length === 0) return;
  let mine = FORK_IDLE;
  try {
    const now = Date.now();
    const { item, entry, dropped } = takeAskBriefOwed(deps.session.state.askBriefOwed, deps.session.state.asks, now);
    mine = deps.session.askBriefFork = beginFork(deps.session.askBriefFork, now, item?.askId ?? "");
    for (const old of dropped) noteAskBrief(deps, "ask_brief_dropped", old.item.askId, old.reason);
    // The removal reaches the store before the model is asked, as the memory
    // drain's does; a write that gives the persona up puts the item back
    // first and ends the drain.
    let kept = true;
    try {
      kept = await deps.persist(() => { if (item !== null) deps.session.state.askBriefOwed.unshift(item); });
    } catch { /* the store refused; the removal stands in memory */ }
    if (!kept || item === null || entry === null) return;
    let fallback: string | null = null;
    let brief: string | null = null;
    let posts: string[] = [];
    let usage: ReturnType<typeof forkUsageOf> | null = null;
    const warm = cacheReading(now, deps.cacheClock, false).warm;
    if (!warm) {
      fallback = "cold";
    } else {
      // The fork's instant is the one before the request leaves, since that
      // is when the cache was read.
      const forkAt = Date.now();
      mine = deps.session.askBriefFork = forkTimed(deps.session.askBriefFork, forkAt);
      // The prompt's ledger fields are folded and bracket-turned inside askBriefPrompt.
      const forked = await deps.fork(askBriefPrompt(entry));
      if (forkStale(deps.session.askBriefFork, mine.generation)) return await forkLate(deps, forked, "ask_brief_fork", noteAskBrief, mine);
      deps.session.askBriefFork = forkHeld(deps.session.askBriefFork);
      type ForkResult = { isAnswered?: unknown; text?: unknown; reason?: unknown; usage?: unknown };
      const result: ForkResult = forked !== null && typeof forked === "object" ? forked as ForkResult : {};
      // A result with no usage object made no request, as nothing-to-fork does.
      if (result.usage !== null && typeof result.usage === "object") {
        usage = forkUsageOf(result.usage);
        deps.session.state.monitor.cost.forkUsage = addForkUsage(deps.session.state.monitor.cost.forkUsage, usage);
      }
      if (result.isAnswered === true) {
        deps.cacheClock.lastForkAt = forkAt;
        // The hold's own reading of the wait (tickOpenAsk in
        // hooks/ask-layer.ts), a wait of 0
        // being no timeout.
        const waitMs = typeof cfg.askOperatorWaitMs === "number" ? (cfg.askOperatorWaitMs as number) : 3_600_000;
        const parsed = parseAskBrief(typeof result.text === "string" ? result.text : "");
        let rendered: string[] | null = null;
        try { rendered = parsed === null ? null : renderAskBrief(entry, parsed, waitMs); } catch { rendered = null; }
        if (rendered === null) {
          fallback = "unparsed";
        } else {
          // Each post is scrubbed alone, and one withheld post withholds the
          // brief, so the ledger never holds half of it.
          const scrubbed = rendered.map((post) => scrubText(post).text);
          if (scrubbed.includes(BLOCK_WITHHELD)) {
            fallback = "scrub-failed";
          } else {
            posts = scrubbed;
            brief = scrubbed.join("\n\n");
          }
        }
      } else {
        // The result's own reason word, one of nothing-to-fork, api-error,
        // empty-reply and aborted; a result carrying none reads as a reply
        // with no text.
        fallback = typeof result.reason === "string" ? bracketSafeText(oneLine(result.reason)).slice(0, 40) : "empty-reply";
      }
    }
    // The owner reading and the entry are taken again after the fork, a wait
    // across which another session can take the persona, a persona switch
    // can replace the session's state, and the answer drain can close the
    // ask. So the entry is found by id in the live state, not through the
    // old reference.
    if (!deps.session.isOwner) return;
    const counts = usage === null ? "" : `, inputTokens ${usage.inputTokens}, outputTokens ${usage.outputTokens}, cacheReadInputTokens ${usage.cacheReadInputTokens}`;
    const live = deps.session.state.asks.find((a) => a.id === item.askId);
    if (fallback !== null || brief === null) {
      // The counts ride the fallback wherever the fork returned usage, so
      // each count in the ledger has a line to audit.
      noteAskBrief(deps, "ask_brief_fallback", item.askId, `${fallback ?? "unparsed"}${counts}`);
    } else if (live === undefined) {
      noteAskBrief(deps, "ask_brief_dropped", item.askId, "the ask left the ledger while the fork ran");
    } else if (live.status !== "open") {
      noteAskBrief(deps, "ask_brief_dropped", item.askId, "the ask closed while the fork ran");
    } else {
      live.brief = brief;
      // The brief is durable before the mirror and the post; a write that
      // gives the persona up ends the drain here, and one across which the
      // ask closed mirrors and posts nothing.
      if (!(await deps.persist())) return;
      if (live.status !== "open") {
        noteAskBrief(deps, "ask_brief_dropped", item.askId, "the ask closed while the brief was written");
      } else {
        // The drain has re-checked the entry above, and updateAskRecordBrief
        // reads the record and writes only one that reads open. The window
        // that remains is the store round trip between that read and its
        // write, since the store has no compare-and-set: a close landing
        // inside it is written back to open. A thrown mirror is named on its
        // own line, and the post still goes.
        try {
          await updateAskRecordBrief(deps.store, deps.session.persona, item.askId, brief);
        } catch (err) {
          noteAskBrief(deps, "ask_brief_unmirrored", item.askId, `the commons write threw: ${boundedText(safeErrorText(err))}`);
        }
        let posted = true;
        // The posts go in order, and the first that throws ends the sending:
        // a later post never goes ahead of one the thread lacks.
        for (let i = 0; i < posts.length && posted; i++) {
          try {
            await deps.callTool({ tool: "mcp__plugin_relay_channel-relay__reply", message: posts[i] });
          } catch (err) {
            posted = false;
            noteAskBrief(deps, "ask_brief_unposted", item.askId, `part ${i + 1} of ${posts.length}: the reply tool threw: ${boundedText(safeErrorText(err))}`);
          }
        }
        if (!posted) {
          // One [ASK BRIEF] submit per brief, through submitAskBriefReprompt in
          // hooks/index.ts, never retried; a refused submit is named on its own
          // line, as the reply backstop names its own.
          const outcome = await deps.submitAskBriefReprompt(expectedTurns, brief);
          if (!outcome.ok) noteAskBrief(deps, "ask_brief_reprompt_refused", item.askId, `the re-prompt ${outcome.how}: ${boundedText(safeErrorText(outcome.reason))}`);
        }
        noteAskBrief(deps, "ask_brief", item.askId, `inputTokens ${usage?.inputTokens ?? 0}, outputTokens ${usage?.outputTokens ?? 0}, cacheReadInputTokens ${usage?.cacheReadInputTokens ?? 0}, posted ${posted}`);
      }
    }
    try { await deps.persist(); } catch { /* the store refused; the lines above wait for one that parses */ }
  } catch {
    // The drain failed; the item is gone and the tick goes on.
    if (forkLost(deps.session.askBriefFork, mine)) await forkLate(deps, null, "ask_brief_fork", noteAskBrief, mine);
  } finally {
    if (!forkStale(deps.session.askBriefFork, mine.generation)) deps.session.askBriefFork = forkReleased(deps.session.askBriefFork);
  }
}

// One pair_drafts_dropped decision for an owed item or a held block the
// session let go: replaced by a later scan in the same turn, or dropped with
// the turn that ends, since a draft on a later turn restates bodies that may
// have changed.
export function notePairDraftsDropped(deps: DrainNoteDeps, turnId: string, reason: string): void {
  deps.session.state.decisions.push({
    timestamp: Date.now(),
    loop: "memory",
    action: "pair_drafts_dropped",
    detail: `turn ${turnId}: ${reason}`,
  });
}

// The pair drain, started by the owe in tool.call and by the heartbeat tick
// for an item the owe left owed: takes the owed item before any await, and
// where the cache clock's stamps read warm fetches each pair's two record
// bodies through memq get --no-stamp under the pair's tier flag, one read at
// a time, then asks one fork of the session's own transcript for a
// disposition per pair and holds the block the reply renders to for the
// turn's next main-loop tool result. The clock is read from its stamps, as
// the memory drain reads it, rather than from the open turn: a plugin
// reloaded mid-turn holds no stamp, and a fork over a cold cache pays the
// whole transcript, which is the cost the draft exists to avoid. A read that
// did not run or exited non-zero leaves that body null, which the prompt
// shows as (not read), and never ends the drain. Every fork result carrying
// a `usage` object adds its counts to the ledger and pushes one
// pair_drafts_fork decision naming the pair count and the three, as the
// memory drain does; an answered fork stamps the clock. A cold reading, a
// fork that did not answer or a reply that is not the one object the reader
// takes logs one pair_drafts_fallback decision with its reason and holds
// nothing, and the session judges the pairs by hand as it does today: no
// second fork and no Haiku completion ever runs for one scan. The turn can
// end while the reads or the fork run, when turn.complete finds nothing to
// drop, so the drain checks the turn itself: after the reads it forks nothing
// for a closed turn, and after the fork it holds nothing for one, each under
// a pair_drafts_dropped reading turn ended; the fork's cost is ledgered
// either way, since it was paid. A later scan in the same turn owed while
// the fork ran supersedes this result, which is dropped as replaced by a
// later scan, as is a block still held for the turn when a newer one lands.
// The decisions ride one persist at the end, and a refused persist leaves
// them in memory for the next write that is not refused. Never throws: a
// drain that throws ends with the item gone and one pair_drafts_fallback
// reading drain-failed, or its late line alone once released, and the tick
// goes on.
export async function drainPairDraftOwed(deps: DrainsDeps, turnOpen: (turnId: string) => boolean): Promise<void> {
  deps.session.pairFork = forkEntry(deps, deps.session.pairFork, "pair_drafts_fork", noteMemoryFork);
  if (deps.session.pairFork.since !== null || deps.session.pairDraftOwed === null) return;
  const owed = deps.session.pairDraftOwed;
  deps.session.pairDraftOwed = null;
  let mine = deps.session.pairFork = beginFork(deps.session.pairFork, Date.now(), owed.turnId);
  try {
    // A closure, so the check reads the field a later scan may have set
    // across the awaits below rather than the null assigned above.
    const replaced = (): boolean => deps.session.pairDraftOwed !== null && deps.session.pairDraftOwed.turnId === owed.turnId;
    let fallback: string | null = null;
    let block: string | null = null;
    if (cacheReading(Date.now(), deps.cacheClock, false).warm) {
      const read = async (name: string, p: ScanPair): Promise<string | null> =>
        fetchedRecordOf(await deps.kitMemq(["get", name, "--no-stamp", ...pairTierFlag(p)], { timeoutMs: MEMQ_READ_TIMEOUT_MS }))?.body ?? null;
      const withBodies: Array<ScanPair & { bodyA: string | null; bodyB: string | null }> = [];
      for (const p of owed.pairs) withBodies.push({ ...p, bodyA: await read(p.a, p), bodyB: await read(p.b, p) });
      if (!turnOpen(owed.turnId)) {
        notePairDraftsDropped(deps, owed.turnId, "turn ended");
      } else if (replaced()) {
        notePairDraftsDropped(deps, owed.turnId, "replaced by a later scan");
      } else {
        const forkAt = Date.now();
        mine = deps.session.pairFork = forkTimed(deps.session.pairFork, forkAt);
        const forked = await deps.fork(pairDrafterPrompt(withBodies));
        if (forkStale(deps.session.pairFork, mine.generation)) return await forkLate(deps, forked, "pair_drafts_fork", noteMemoryFork, mine);
        deps.session.pairFork = forkHeld(deps.session.pairFork);
        const rawUsage = forked !== null && typeof forked === "object" ? (forked as { usage?: unknown }).usage : undefined;
        if (rawUsage !== null && typeof rawUsage === "object") {
          const usage = forkUsageOf(rawUsage);
          deps.session.state.monitor.cost.forkUsage = addForkUsage(deps.session.state.monitor.cost.forkUsage, usage);
          deps.session.state.decisions.push({
            timestamp: Date.now(),
            loop: "memory",
            action: "pair_drafts_fork",
            detail: `turn ${owed.turnId}: pairs ${owed.pairs.length}, inputTokens ${usage.inputTokens}, outputTokens ${usage.outputTokens}, cacheReadInputTokens ${usage.cacheReadInputTokens}`,
          });
        }
        const answered = forked !== null && typeof forked === "object" && (forked as { isAnswered?: unknown }).isAnswered === true;
        if (answered) deps.cacheClock.lastForkAt = forkAt;
        if (!turnOpen(owed.turnId)) {
          notePairDraftsDropped(deps, owed.turnId, "turn ended");
        } else if (replaced()) {
          notePairDraftsDropped(deps, owed.turnId, "replaced by a later scan");
        } else if (answered) {
          const text = (forked as { text?: unknown }).text;
          const drafts = parsePairDrafterReply(typeof text === "string" ? text : "", owed.pairs);
          if (drafts === null) fallback = "unparsed";
          else block = pairDraftsBlock(drafts, owed.pairs, owed.notDrafted);
        } else {
          const reason = forked !== null && typeof forked === "object" ? (forked as { reason?: unknown }).reason : undefined;
          fallback = typeof reason === "string" ? bracketSafeText(oneLine(reason)).slice(0, 40) : "empty-reply";
        }
      }
    } else {
      fallback = "cold";
    }
    if (fallback !== null) {
      deps.session.state.decisions.push({
        timestamp: Date.now(),
        loop: "memory",
        action: "pair_drafts_fallback",
        detail: `${fallback}, turn ${owed.turnId}`,
      });
    } else if (block !== null) {
      if (deps.session.pairDrafts !== null && deps.session.pairDrafts.turnId === owed.turnId) notePairDraftsDropped(deps, owed.turnId, "replaced by a later scan");
      deps.session.pairDrafts = { turnId: owed.turnId, block };
    }
    try { await deps.persist(); } catch { /* the store refused; the lines above wait for one that parses */ }
  } catch {
    // The drain threw: the item is gone, one fallback names the failure, and
    // the tick goes on.
    if (forkLost(deps.session.pairFork, mine)) return await forkLate(deps, null, "pair_drafts_fork", noteMemoryFork, mine);
    deps.session.state.decisions.push({
      timestamp: Date.now(),
      loop: "memory",
      action: "pair_drafts_fallback",
      detail: `drain-failed, turn ${owed.turnId}`,
    });
    try { await deps.persist(); } catch { /* the store refused; the line above waits for one that parses */ }
  } finally {
    if (!forkStale(deps.session.pairFork, mine.generation)) deps.session.pairFork = forkReleased(deps.session.pairFork);
  }
}

// --- The supervisor mailbox ---
//
// bin/supervise.sh names one mailbox per run directory, <rundir>/mailbox.jsonl,
// and the ack file beside it, <rundir>/mailbox.ack.jsonl, and hands the first
// to this plugin as the supervisorMailbox option. The supervisor is the
// mailbox's only writer and this plugin the ack file's. Each mailbox line is
// one JSON object { id, kind, at, text } with kind probe or shutdown.

// One controller tick's pass over the mailbox. A line whose id is already in
// the ack file is passed over, so no record is acted on twice. A probe gets an
// ack line and spends no turn, during a long turn as between turns. The first
// shutdown gets a delivered line, and then one turn opening
// [SUPERVISOR id=<id>] followed by the record's text, submitted through the
// expected-turn path; the pass ends there, so one tick delivers at most one
// shutdown. A shutdown read while a turn is open, by `turnOpen` at the
// moment the line is reached, is passed over with the line neither
// acknowledged nor delivered, and the pass goes on to the probes after it: a
// turn submitted into an open turn is queued rather than answered, so the
// record stays in the mailbox for the first idle tick's pass, and no state
// is kept between the two. The ack line is
// written before the submit, and a pass that cannot read or write the ack
// file acts on nothing, so a record can never be delivered without the line
// that keeps it from being delivered again; a submit that opens no turn adds
// a failed line beside it. A line that is not a record is never acknowledged,
// and is logged once per session under the key `skipped` holds. A missing,
// empty or unreadable mailbox is a pass that does nothing. Nothing here
// throws. The [SUPERVISOR] turn's text and its submit are
// submitSupervisorShutdown's, in hooks/index.ts.
export async function drainSupervisorMailbox(
  deps: DrainsDeps,
  mailboxPath: string,
  expectedTurns: ExpectedTurn[],
  skipped: Set<string>,
  turnOpen: () => boolean,
): Promise<{ delivered: boolean; logged: boolean }> {
  const outcome = { delivered: false, logged: false };
  let mailboxText: string;
  let ackText = "";
  const ackPath = supervisorAckPathOf(mailboxPath);
  try {
    if (!(await deps.host.fileExists(mailboxPath))) return outcome;
    mailboxText = String(await deps.host.readFile(mailboxPath));
    // An empty mailbox is the healthy steady state, and needs no ack read.
    if (mailboxText.trim() === "") return outcome;
    if (await deps.host.fileExists(ackPath)) ackText = String(await deps.host.readFile(ackPath));
  } catch {
    return outcome;
  }
  const handled = new Set<string>();
  for (const ackLine of ackText.split("\n")) {
    if (ackLine.trim() === "") continue;
    try {
      const a: unknown = JSON.parse(ackLine);
      if (a !== null && typeof a === "object" && typeof (a as { id?: unknown }).id === "string") handled.add((a as { id: string }).id);
    } catch { /* a line this plugin did not write whole acknowledges nothing */ }
  }
  // New ack lines are appended through appendLines in hooks/index.ts, the one
  // JSONL append rule the plugin's logs share, which reads the file again
  // immediately before its write, so a line already in the file is kept
  // however stale this pass's own reading is. The engine's file API has no
  // append of its own, so the write is still the whole file.
  const newAcks: string[] = [];
  const writeAcks = async (): Promise<boolean> => {
    if (newAcks.length === 0) return true;
    try {
      await deps.appendLines(ackPath, newAcks.splice(0));
      return true;
    } catch {
      return false;
    }
  };
  // The supervisor appends each record whole with its newline, so a mailbox
  // that does not end in one has its last line still being written. That line
  // is left for the next pass, which reads it whole, rather than read here as
  // a malformed record.
  const lines = mailboxText.split("\n");
  if (!mailboxText.endsWith("\n")) lines.pop();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const rec = parseSupervisorMailboxLine(line);
    if ("problem" in rec) {
      const key = `${index}:${line}`;
      if (!skipped.has(key)) {
        skipped.add(key);
        deps.session.state.decisions.push({
          timestamp: Date.now(),
          loop: "monitor",
          action: "supervisor_mailbox_line_skipped",
          detail: `mailbox line ${index + 1} ${rec.problem}; skipped and not acknowledged`.slice(0, 200),
        });
        outcome.logged = true;
      }
      continue;
    }
    if (handled.has(rec.id)) continue;
    handled.add(rec.id);
    if (rec.kind === "probe") {
      newAcks.push(JSON.stringify({ id: rec.id, at: Date.now(), action: "ack" }));
      continue;
    }
    // A shutdown with a turn open is left for the next idle pass, neither
    // acknowledged nor delivered; the probes around it, before and after,
    // are acknowledged all the same.
    if (turnOpen()) continue;
    newAcks.push(JSON.stringify({ id: rec.id, at: Date.now(), action: "delivered" }));
    if (!(await writeAcks())) return outcome;
    const shutdownOutcome = await deps.submitSupervisorShutdown(expectedTurns, rec);
    // A submit that opened no turn keeps its delivered line, which is what
    // keeps the record from being submitted again, and gains a failed line
    // beside it, so the ack file does not claim a delivery that never reached
    // the session. The supervisor's probe reading counts only ack lines.
    if (!shutdownOutcome.ok) {
      newAcks.push(JSON.stringify({ id: rec.id, at: Date.now(), action: "failed", reason: `${shutdownOutcome.how}: ${shutdownOutcome.reason}`.slice(0, 200) }));
      await writeAcks();
    }
    deps.session.state.decisions.push(shutdownOutcome.ok
      ? {
        timestamp: Date.now(),
        loop: "monitor",
        action: "supervisor_shutdown_delivered",
        detail: `mailbox record ${rec.id} submitted as [SUPERVISOR id=${rec.id}]`,
      }
      : {
        timestamp: Date.now(),
        loop: "monitor",
        action: "supervisor_shutdown_failed",
        detail: `mailbox record ${rec.id} submit ${shutdownOutcome.how}; left delivered: ${shutdownOutcome.reason}`.slice(0, 200),
      });
    outcome.delivered = true;
    outcome.logged = true;
    return outcome;
  }
  await writeAcks();
  return outcome;
}
