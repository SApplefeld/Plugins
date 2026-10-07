// Operator channel: cross-session steering for personas.
// D1: Records (inbox, reply, ask) in the commons store.
// D2: Reader claim and tools (agentic_say, agentic_inbox).
//
// Substrate: $.store (per plugin, global across sessions, async JSON values).
// Key layout: one writer per key.
//
// Records:
// - inbox:<persona>:<writerSessionId>:<seq> = { id, from, at, text, kind, answers?, urgent?, status }
// - reply:<persona>:<msgId> = { at, text }
// - ask:<persona>:<askId> = { at, nodeId, question, status }
//
// Writer: the reader session writes inbox records; the owner advances status.
// Reader: the reader session calls agentic_inbox to read replies.

// --- Types ---

export type InboxKind = "say" | "answer";
// "answered" means a turn replied; "resolved" means the owner finished or
// declined the work the record asked for, set through agentic_resolve.
export type InboxStatus = "pending" | "delivered" | "answered" | "skipped" | "resolved";
export type InboxOutcome = "done" | "declined";

export interface InboxRecord {
  id: string;
  key: string; // full store key (for sweep)
  from: string; // writer sessionId
  at: number; // ms timestamp
  text: string;
  kind: InboxKind;
  answers?: string; // askId if kind === "answer"
  urgent?: boolean; // plan item 8.3: delivered inside the owner's running turn, not at the next quiet tick
  status: InboxStatus;
  deliveredAt?: number; // set by owner on delivery
  turnId?: string; // set by owner on turn.start after delivery
  resolvedAt?: number; // set by the owner's agentic_resolve, with the two below
  outcome?: InboxOutcome;
  note?: string;
  answersRecord?: string; // set by agentic_say on the answer leg alone: the id of the target owner's record to the architect that opened it
}

export interface ReplyRecord {
  at: number;
  text: string;
}

export type AskStatus = "open" | "answered" | "expired" | "resumed";

export interface AskRecord {
  id: string;
  ownerSessionId: string;
  at: number;
  nodeId: string;
  question: string;
  status: AskStatus;
  reraisedAt?: number; // plan item 5 (D5b, bullet 3): set the one time this ask
                        // was re-raised into the thread past the bounded window.
}

// --- Constants ---

const INBOX_PREFIX = "inbox:";
const REPLY_PREFIX = "reply:";
const ASK_PREFIX = "ask:";
const READER_PREFIX = "reader:";
const PERSONA_PREFIX = "persona:";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Store interface ---

import type { CommonsStore, CommonsMeta, UnionedClaim } from "./commons";
import { claimResource, releaseResource, readAllClaims, commonsWinner } from "./commons";
import { LINE_TERMINATOR } from "./agent-state";

// --- Key helpers ---

function inboxKey(persona: string, writerSessionId: string, seq: number): string {
  return `${INBOX_PREFIX}${persona}:${writerSessionId}:${seq}`;
}

function replyKey(persona: string, msgId: string): string {
  return `${REPLY_PREFIX}${persona}:${msgId}`;
}

export function askKey(persona: string, askId: string): string {
  return `${ASK_PREFIX}${persona}:${askId}`;
}

function readerKey(persona: string): string {
  return `${READER_PREFIX}${persona}`;
}

// The commons resource an owner session claims for a persona. index.ts
// builds the same string by hand at its claim and release sites.
function personaKey(persona: string): string {
  return `${PERSONA_PREFIX}${persona}`;
}

// The one rule for a string that is spliced inside a delivery bracket (a
// persona name or a record id): no "[" or "]", which could close the
// bracket early and open a forged one; no ",", which is the bracket's own
// separator before "urgent"; and no whitespace, control or format
// character, which could split or hide a field. Returns the reason, or
// null when the string is safe.
function bracketSafeProblem(s: string): string | null {
  if (s.includes("[") || s.includes("]")) return "cannot contain '[' or ']'";
  if (s.includes(",")) return "cannot contain ','";
  if (/[\s\p{Cc}\p{Cf}]/u.test(s)) return "cannot contain whitespace, a control character or a format character";
  return null;
}

/**
 * The one rule for a persona name that reaches a store key or a delivery
 * bracket: non-empty after trim, no ":", and bracket-safe once trimmed.
 * Records are keyed `inbox:<persona>:<session>:<seq>` and listed by the
 * `inbox:<persona>:` prefix, so a colon in a name would let one persona's
 * listing read another persona's keys; a record id is
 * `<persona>-<session>-<seq>` and the name is spliced into the delivery
 * label, so the bracket rule holds for it too. Returns the reason a name is
 * refused, or null when it is usable. The tools' persona argument,
 * agentic_identity, the configured coordinator name and the persona a
 * session starts under apply this rule rather than their own.
 */
export function personaNameProblem(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return "must be a non-empty string";
  if (name.includes(":")) return "cannot contain ':'";
  return bracketSafeProblem(name.trim());
}

// --- D1: Records ---

/**
 * Write an inbox record. The reader session is the writer.
 * Returns the record id.
 */
export async function writeInboxRecord(
  store: CommonsStore,
  persona: string,
  writerSessionId: string,
  seq: number,
  text: string,
  kind: InboxKind,
  answers?: string,
  urgent?: boolean,
  answersRecord?: string,
): Promise<string> {
  const id = `${persona}-${writerSessionId}-${seq}`;
  const key = inboxKey(persona, writerSessionId, seq);
  const record: InboxRecord = {
    id,
    key,
    from: writerSessionId,
    at: Date.now(),
    text,
    kind,
    answers,
    ...(urgent ? { urgent: true } : {}),
    ...(answersRecord ? { answersRecord } : {}),
    status: "pending",
  };
  await store.set(key, record);
  return id;
}

/**
 * Read a record value out of the commons store as its object form.
 *
 * A value an older build persisted as a JSON string reads back as a string,
 * while every reader here wants the object. The parse belongs at this one
 * boundary rather than at each call site, because a reader that omits it does
 * not fail: it yields an object whose every field is undefined, which a status
 * filter drops in silence. A value that does not parse reads as absent, so a
 * corrupt entry is skipped rather than throwing out of the reader that met it.
 */
export function parseStoreRecord<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

/**
 * Read an inbox record.
 */
export async function readInboxRecord(
  store: CommonsStore,
  persona: string,
  writerSessionId: string,
  seq: number,
): Promise<InboxRecord | null> {
  const key = inboxKey(persona, writerSessionId, seq);
  const raw = await store.get(key);
  return parseStoreRecord<InboxRecord>(raw);
}

/**
 * List all inbox records for a persona.
 */
export async function listInboxRecords(
  store: CommonsStore,
  persona: string,
): Promise<InboxRecord[]> {
  const keys = await store.keys();
  const prefix = `${INBOX_PREFIX}${persona}:`;
  const records: InboxRecord[] = [];
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      const raw = await store.get(key);
      const rec = parseStoreRecord<InboxRecord>(raw);
      if (rec) records.push(rec);
    }
  }
  return records.sort((a, b) => a.at - b.at);
}

/**
 * Write a reply record. The owner session is the writer.
 */
export async function writeReplyRecord(
  store: CommonsStore,
  persona: string,
  msgId: string,
  text: string,
): Promise<void> {
  const record: ReplyRecord = { at: Date.now(), text };
  const key = replyKey(persona, msgId);
  await store.set(key, record);
}

/**
 * Read a reply record.
 */
export async function readReplyRecord(
  store: CommonsStore,
  persona: string,
  msgId: string,
): Promise<ReplyRecord | null> {
  const key = replyKey(persona, msgId);
  const raw = await store.get(key);
  return parseStoreRecord<ReplyRecord>(raw);
}

/**
 * Write an ask record. The owner session is the writer.
 */
export async function writeAskRecord(
  store: CommonsStore,
  persona: string,
  askId: string,
  nodeId: string,
  question: string,
  ownerSessionId: string,
): Promise<void> {
  const record: AskRecord = {
    id: askId,
    ownerSessionId,
    at: Date.now(),
    nodeId,
    question,
    status: "open",
  };
  const key = askKey(persona, askId);
  await store.set(key, record);
}

/**
 * Mark every open ask of a persona as expired (owner restart).
 * Returns the list of expired ask ids.
 */
export async function expireOpenAsks(
  store: CommonsStore,
  persona: string,
): Promise<string[]> {
  const keys = await store.keys();
  const prefix = `${ASK_PREFIX}${persona}:`;
  const ids: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const raw = await store.get(key);
    if (!raw) continue;
    const rec = (typeof raw === "string" ? JSON.parse(raw) : raw) as AskRecord;
    if (rec.status !== "open") continue;
    // BE4: fall back to the key suffix after ask:<persona>: when rec.id is undefined
    const id = rec.id ?? key.slice(prefix.length);
    rec.id = id;
    rec.status = "expired";
    await store.set(askKey(persona, id), rec);
    ids.push(id);
  }
  return ids;
}

/**
 * Read an ask record.
 */
export async function readAskRecord(
  store: CommonsStore,
  persona: string,
  askId: string,
): Promise<AskRecord | null> {
  const key = askKey(persona, askId);
  const raw = await store.get(key);
  return raw ? (raw as AskRecord) : null;
}

/**
 * List all ask records for a persona.
 */
export async function listAskRecords(
  store: CommonsStore,
  persona: string,
): Promise<AskRecord[]> {
  const keys = await store.keys();
  const prefix = `${ASK_PREFIX}${persona}:`;
  const records: AskRecord[] = [];
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      const raw = await store.get(key);
      if (raw) records.push(raw as AskRecord);
    }
  }
  return records.sort((a, b) => a.at - b.at);
}

/**
 * A store delete that failed during `sweepExpiredRecords` after every expired
 * record was appended to the channel log: `removed` of `total` logged records
 * left the store before the failure, and the rest are still in it.
 */
export class SweepDeleteError extends Error {
  readonly removed: number;
  readonly total: number;
  constructor(removed: number, total: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "SweepDeleteError";
    this.removed = removed;
    this.total = total;
  }
}

/**
 * Sweep records older than the TTL.
 * Returns the number of records swept.
 *
 * A `pending` record is never swept, whatever its age: a pending record whose
 * writer has no live claim leaves the queue through the drain's own route
 * (`skipped`), so one that is still pending is live work the owner has not
 * consumed yet. An inbox record's age is the latest of its write, delivery
 * and resolution times, so a record that waited pending past the TTL and was
 * then delivered is not swept on the next cadence. A reply is swept together
 * with its inbox record, expired when that record is, and on its own `at`
 * only when it is an orphan with no inbox record; the sender reads replies
 * by walking inbox records, so a reply outliving its record is unreachable
 * and a record outliving its reply reads as unanswered. Every record the
 * sweep removes (inbox, reply, ask) is appended
 * to the channel log first, one line per record in the shape `enforceChannelWindow`
 * writes with `sweptAt` in place of `rolledAt`, so a reader of the log can tell
 * the two routes apart. Append before delete, and never delete on a failed
 * append: the error propagates with every record still in the store, so the
 * caller records the refusal rather than a count. A delete that fails after
 * the append landed throws a `SweepDeleteError` instead, carrying how many
 * of the logged records were removed before it.
 */
export async function sweepExpiredRecords(
  store: CommonsStore,
  persona: string,
  appendLines: (lines: string[]) => Promise<void>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<number> {
  const cutoff = Date.now() - ttlMs;
  let swept = 0;

  // Collect every record past the TTL (inbox, reply, ask), log them all in
  // one append, then delete.
  const expired: { key: string; kind: "inbox" | "reply" | "ask"; record: unknown }[] = [];
  const inboxRecords = await listInboxRecords(store, persona);
  // Inbox record ids present in the store, and those the sweep removes, so a
  // reply follows its record's fate rather than its own age.
  const inboxIds = new Set<string>();
  const expiredInboxIds = new Set<string>();
  for (const record of inboxRecords) {
    inboxIds.add(record.id);
    const age = Math.max(record.at, record.deliveredAt ?? 0, record.resolvedAt ?? 0);
    if (age < cutoff && record.status !== "pending" && record.key) {
      expired.push({ key: record.key, kind: "inbox", record });
      expiredInboxIds.add(record.id);
    }
  }
  const keys = await store.keys();
  const replyPrefix = `${REPLY_PREFIX}${persona}:`;
  const askPrefix = `${ASK_PREFIX}${persona}:`;
  for (const key of keys) {
    const kind = key.startsWith(replyPrefix) ? "reply" : key.startsWith(askPrefix) ? "ask" : null;
    if (!kind) continue;
    const raw = await store.get(key);
    if (!raw) continue;
    if (kind === "reply") {
      const msgId = key.slice(replyPrefix.length);
      const isExpired = inboxIds.has(msgId) ? expiredInboxIds.has(msgId) : (raw as ReplyRecord).at < cutoff;
      if (isExpired) expired.push({ key, kind, record: raw });
      continue;
    }
    if ((raw as AskRecord).at < cutoff) expired.push({ key, kind, record: raw });
  }
  if (expired.length > 0) {
    const sweptAt = Date.now();
    await appendLines(expired.map((e) => JSON.stringify({ persona, kind: e.kind, key: e.key, sweptAt, record: e.record })));
    try {
      for (const e of expired) {
        await store.delete(e.key);
        swept++;
      }
    } catch (err) {
      throw new SweepDeleteError(swept, expired.length, err);
    }
  }

  return swept;
}

/**
 * Item 5 (Bounded store): the shared commons store keeps only open asks and
 * a short window of recent inbox/reply records per persona - closed records
 * beyond the window roll to an append-only log rather than staying in the
 * one JSON file forever. This never touches `ask:` keys (an open ask has
 * its own lifecycle - answered, expired, or re-raised - and TTL-based
 * `sweepExpiredRecords` above is the only thing that ages one out); it
 * covers `inbox:` records that are `"skipped"` or `"resolved"` and every
 * `reply:` record except one whose inbox record is present as `"delivered"`
 * or `"answered"`, combined and ordered oldest-first, keeping the newest
 * `windowSize` and rolling the rest. A `pending` record is live work the
 * drain has not consumed yet, and a `delivered` or `answered` record is an
 * open steer whose state the sender still reads, so both stay in the store
 * whatever the window, and so does the open steer's reply; the TTL sweep is
 * the bound on those. Every other reply, whether its record is `resolved`,
 * `skipped` or gone, enters the window on its own age, so it can roll on a
 * different cadence from its record.
 * Returns the number of records rolled.
 */
export async function enforceChannelWindow(
  store: CommonsStore,
  persona: string,
  windowSize: number,
  appendLines: (lines: string[]) => Promise<void>,
): Promise<number> {
  const allInbox = await listInboxRecords(store, persona);
  const inbox = allInbox.filter((r) => r.status === "skipped" || r.status === "resolved");
  const openSteerIds = new Set(allInbox.filter((r) => r.status === "delivered" || r.status === "answered").map((r) => r.id));
  const keys = await store.keys();
  const replyPrefix = `${REPLY_PREFIX}${persona}:`;
  const combined: { key: string; at: number; kind: "inbox" | "reply"; record: unknown }[] = inbox.map((r) => ({
    key: r.key,
    at: r.at,
    kind: "inbox" as const,
    record: r,
  }));
  for (const key of keys) {
    if (key.startsWith(replyPrefix)) {
      if (openSteerIds.has(key.slice(replyPrefix.length))) continue;
      const raw = await store.get(key);
      if (raw) combined.push({ key, at: (raw as ReplyRecord).at, kind: "reply", record: raw });
    }
  }
  combined.sort((a, b) => a.at - b.at);

  if (combined.length <= windowSize) return 0;
  const overflow = combined.slice(0, combined.length - windowSize);
  // Round 47 (BG5): the store key rides at the top level of the log line,
  // not only inside `record` - a reply record carries no key field of its
  // own, so a consumer correlating a missing store key back to this log
  // (BG5's own job) needs it named explicitly for every kind, not just inbox.
  const lines = overflow.map((o) => JSON.stringify({ persona, kind: o.kind, key: o.key, rolledAt: Date.now(), record: o.record }));
  // Round 47: append before delete, and never delete on a failed append -
  // a record must have proof it landed in the log before it leaves the
  // store, not the other way around. Round 50 point 3: a failed append used
  // to return 0 here, the same value as "nothing to roll" - the caller could
  // not tell "no overflow this tick" from "overflow existed and the roll was
  // refused". Let the error propagate instead, so the caller records which
  // one happened.
  await appendLines(lines);
  for (const o of overflow) {
    await store.delete(o.key);
  }
  return overflow.length;
}

// --- D2: Reader claim and tools ---

/**
 * Claim the reader role for a persona.
 * The reader session is the writer.
 */
export async function claimReaderRole(
  store: CommonsStore,
  persona: string,
  mySessionId: string,
  now: number = Date.now(),
  meta?: CommonsMeta,
): Promise<void> {
  // Use the commons claim path (same as persona claim)
  await claimResource(store, readerKey(persona), mySessionId, now, meta);
}

/**
 * Release the reader role for a persona.
 */
export async function releaseReaderRole(
  store: CommonsStore,
  persona: string,
  mySessionId: string,
  now: number = Date.now(),
  meta?: CommonsMeta,
): Promise<void> {
  await releaseResource(store, readerKey(persona), mySessionId, now, meta);
}

// The two claim tests over one claims read, so a caller that needs both
// reads the commons store once.
function holdsReaderClaim(claims: UnionedClaim[], persona: string, sessionId: string): boolean {
  const readerResource = readerKey(persona);
  return claims.some((c) => c.resource === readerResource && c.holder === sessionId);
}

// Ownership is the commons winner, the same arbitration readHolderMeta and
// the yield check apply: a second session claims a persona at start and holds
// that claim until its own yield fires, and in that window it is a holder but
// not the owner.
function holdsOwnerClaim(
  claims: UnionedClaim[],
  sessionId: string,
  persona?: string,
  excludePersona?: string,
): boolean {
  if (persona !== undefined) {
    return commonsWinner(claims, personaKey(persona)) === sessionId;
  }
  const excluded = excludePersona === undefined ? null : personaKey(excludePersona);
  return claims.some((c) =>
    c.holder === sessionId
    && c.resource.startsWith(PERSONA_PREFIX)
    && c.resource !== excluded
    && commonsWinner(claims, c.resource) === sessionId);
}

// The personas `sessionId` holds a reader claim on, sorted, so a label that
// must pick one of several picks the same one every time.
function readerPersonasOf(claims: UnionedClaim[], sessionId: string): string[] {
  return claims
    .filter((c) => c.holder === sessionId && c.resource.startsWith(READER_PREFIX))
    .map((c) => c.resource.slice(READER_PREFIX.length))
    .sort();
}

// The named personas `sessionId` owns (commons winner, `default` excluded),
// sorted. Non-empty exactly when holdsOwnerClaim(claims, sessionId,
// undefined, "default") is true.
function ownedNamedPersonasOf(claims: UnionedClaim[], sessionId: string): string[] {
  const excluded = personaKey("default");
  return claims
    .filter((c) =>
      c.holder === sessionId
      && c.resource.startsWith(PERSONA_PREFIX)
      && c.resource !== excluded
      && commonsWinner(claims, c.resource) === sessionId)
    .map((c) => c.resource.slice(PERSONA_PREFIX.length))
    .sort();
}

/**
 * The ground string deliveryGroundIn returns for a writer holding the
 * coordinator persona. Both the value this module produces and every check
 * against it read this constant, so the producer and its readers cannot
 * drift apart.
 */
export const COORDINATOR_GROUND = "COORDINATOR";

/**
 * What the reach rule knows about the architect seat. `persona` is the
 * configured architect name, or "" when the plugin has none, which closes
 * both architect legs. `records` are the inbox records addressed to that
 * persona, as architectLineRecords reads them for the send gate and the
 * inbox read: empty unless the writer owns the architect persona, since only
 * then does the answer leg read them. `stamped` is set only at a delivery
 * site, true when the record being delivered carries `answersRecord`; a
 * delivery site reads no records, so it passes `records` empty.
 */
export interface ArchitectLine {
  persona: string;
  records: readonly InboxRecord[];
  stamped?: boolean;
}

/**
 * The provenance ground a record from `writer` carries when delivered to
 * `target`, read from claims and records already read, or a refusal when the
 * writer may not reach the target at all. Reach holds on any of four legs:
 * the writer holds a reader claim on the target (a reader steering the
 * owner it reads); the writer owns the coordinator persona (the
 * coordinator addressing any persona); the target is the coordinator
 * persona or the architect persona and the writer owns a named persona
 * other than `default` (a worker pushing to either seat); or the answer
 * leg below. Every claim leg is a claim a session issues itself: any
 * plugin-loaded session on this machine can take a reader claim, own a
 * named persona through agentic_identity, or own the coordinator persona
 * while no live session holds it. Excluding `persona:default` keeps out a
 * session that has done none of that, which is every plugin-loaded session
 * at start, and nothing more.
 *
 * The answer leg lets the architect answer a worker that asked it, and it
 * is judged at send. The writer owns the architect persona, the target
 * persona has a live owner, and that owner's session wrote a record to the
 * architect persona whose status is `delivered` or `answered` and which
 * passes deliveryRecordProblem: a record the architect has taken delivery
 * of and not resolved. The ground then carries that record's id as
 * `answersRecord`, which agentic_say stamps on the answer it writes. At
 * delivery the leg holds on that stamp and on the writer still owning the
 * architect persona, with no read of the architect's inbox, so an answer
 * admitted at send is delivered even where the architect resolves the
 * worker's record, or the target changes owner, before it arrives. The
 * stamp's value is never spliced into a label or any other text.
 *
 * The ground names the strongest standing the writer holds, in this order:
 * `COORDINATOR` when the writer owns the coordinator persona;
 * `READER:<target>` when the writer holds a reader claim on the target;
 * on the worker leg to the coordinator, `READER:<persona>` naming the
 * alphabetically first persona the writer reads where it reads any, and
 * otherwise `WORKER:<persona>` naming the alphabetically first named
 * persona it owns; on the worker leg to the architect, that
 * `WORKER:<persona>` whatever else the writer reads, since the architect
 * works a WORKER record as its own and reads a READER record as
 * information; and `WORKER:<architect persona>` on the answer leg, whatever
 * else the writer reads. A reader claim on another persona is not a reach
 * leg by itself. The gate and the label are one rule over one claims array, so a
 * record that is delivered is a record that is labelled.
 *
 * The persona a READER or WORKER ground would name is store data any
 * process can write straight into the claims, so it is held to the bracket
 * rule here as well as at the name rule's entry points: a name that fails
 * it is refused as `bad_name`, with the reason, and the writer does not
 * reach the target at all. `no_claim` is the refusal when no leg holds.
 */
export type DeliveryGround =
  | { ground: string; answersRecord?: string }
  | { refused: "no_claim" }
  | { refused: "bad_name"; persona: string; problem: string };

// The answer leg of deliveryGroundIn: null when it does not hold, and
// otherwise the id of the record that opened it at send, or "" where a
// delivery site admitted the record on its stamp.
function answerLegOpener(claims: UnionedClaim[], target: string, writer: string, architect: ArchitectLine): string | null {
  if (architect.persona === "" || !holdsOwnerClaim(claims, writer, architect.persona)) return null;
  if (architect.stamped === true) return "";
  const targetOwner = commonsWinner(claims, personaKey(target));
  if (targetOwner === null) return null;
  const opener = architect.records.find((r) => r.from === targetOwner
    && (r.status === "delivered" || r.status === "answered")
    && deliveryRecordProblem(r) === null);
  return opener === undefined ? null : opener.id;
}

export function deliveryGroundIn(
  claims: UnionedClaim[],
  target: string,
  writer: string,
  coordinatorPersona: string,
  architect: ArchitectLine,
): DeliveryGround {
  if (holdsOwnerClaim(claims, writer, coordinatorPersona)) return { ground: COORDINATOR_GROUND };
  const seatTarget = target === coordinatorPersona || (architect.persona !== "" && target === architect.persona);
  const workerLeg = seatTarget && holdsOwnerClaim(claims, writer, undefined, "default");
  const readerPersonas = readerPersonasOf(claims, writer);
  const readsTarget = readerPersonas.includes(target);
  // The answer leg is read whenever the worker leg does not hold, so a send
  // it admits is stamped even where a reader claim on the target labels it.
  const opener = workerLeg ? null : answerLegOpener(claims, target, writer, architect);
  let kind: string;
  let persona: string;
  if (readsTarget) {
    kind = "READER";
    persona = target;
  } else if (workerLeg && readerPersonas.length > 0 && target !== architect.persona) {
    kind = "READER";
    persona = readerPersonas[0];
  } else if (workerLeg) {
    kind = "WORKER";
    persona = ownedNamedPersonasOf(claims, writer)[0];
  } else if (opener !== null) {
    kind = "WORKER";
    persona = architect.persona;
  } else {
    return { refused: "no_claim" };
  }
  const problem = bracketSafeProblem(persona);
  if (problem !== null) return { refused: "bad_name", persona, problem };
  return opener ? { ground: `${kind}:${persona}`, answersRecord: opener } : { ground: `${kind}:${persona}` };
}

/**
 * The records the answer leg reads at the send gate and the inbox read for
 * `writer`: every inbox record addressed to the architect persona when
 * `writer` owns that persona under `claims`, and otherwise none, with no
 * store read.
 */
export async function architectLineRecords(
  store: CommonsStore,
  claims: UnionedClaim[],
  writer: string,
  architectPersona: string,
): Promise<InboxRecord[]> {
  if (architectPersona === "" || !holdsOwnerClaim(claims, writer, architectPersona)) return [];
  return listInboxRecords(store, architectPersona);
}

/**
 * The ArchitectLine the three delivery sites pass for `rec`: no records,
 * and `stamped` where the record carries a non-empty `answersRecord`
 * string. The stamp's value is store data and is read here for presence
 * alone, never spliced into text.
 */
export function deliveryArchitectLine(architectPersona: string, rec: { answersRecord?: unknown }): ArchitectLine {
  return { persona: architectPersona, records: [], stamped: typeof rec.answersRecord === "string" && rec.answersRecord !== "" };
}

/**
 * The one rule for the record fields a delivery reads: `id` is a non-empty
 * string that passes the bracket rule above, and `text` is a string. Both
 * are store data any plugin-loaded session wrote: an id carrying "]" could
 * close the bracket early and forge the text after it, and a text that is
 * not a string cannot be quoted line by line. Returns the reason, naming
 * the field, or null when the record is deliverable; the three delivery
 * sites apply this rule and deliver nothing under a refused record.
 */
export function deliveryRecordProblem(rec: { id: unknown; text: unknown }): string | null {
  if (typeof rec.id !== "string" || rec.id.length === 0) return "id must be a non-empty string";
  const idProblem = bracketSafeProblem(rec.id);
  if (idProblem !== null) return `id ${idProblem}`;
  if (typeof rec.text !== "string") return "text must be a string";
  return null;
}

/**
 * The bracket every delivered record opens with: `[<ground> id=<id>]` on a
 * plain delivery, `[<ground> id=<id>, urgent]` where the sender flagged the
 * record, and `[<ground> id=<id>, waited]` where an unflagged record broke
 * into a running turn because it had waited past the bound. The marker says
 * why the record arrived and grants nothing: delegated authority comes only
 * from a coordinator prompt, never from a bracket on a tool result.
 * `ground` is what deliveryGroundIn returned and `id` has passed
 * deliveryRecordProblem. The id rides in-band because agentic_inbox is
 * reader-only, so nothing else tells the owner the id agentic_resolve takes.
 */
export function deliveryPrefix(ground: string, id: string, mark: "plain" | "urgent" | "waited"): string {
  return `[${ground} id=${id}${mark === "plain" ? "" : `, ${mark}`}]`;
}

/**
 * Every line of `body` after the first, quoted with `> `, split on
 * LINE_TERMINATOR and joined with LF. Applied to any store-sourced body that
 * follows a bracket on its first line, so a body carrying a line break and
 * then a bracket cannot read as a second plugin-submitted line.
 */
export function quoteContinuationLines(body: string): string {
  const [first, ...rest] = body.split(LINE_TERMINATOR);
  return [first, ...rest.map((line) => `> ${line}`)].join("\n");
}

/**
 * Every line of `body` quoted with `> `, its first included. Applied where a
 * whole line of a line-structured prompt is text carried out of a file rather
 * than composed by the plugin, so the reader can tell the two apart by the
 * line's own opening: a composed line of such a prompt opens with "- " and a
 * carried one opens with "> ". quoteContinuationLines leaves the first line
 * bare because there the first line is the plugin's own bracket; here there is
 * no such line and the whole body is carried.
 */
export function quoteCarriedLines(body: string): string {
  return `> ${quoteContinuationLines(body)}`;
}

/**
 * The full text a delivery submits: the prefix, then the body, which is
 * `Answer to <question>: ` when the record answers an open ask, then the
 * record's text. The question and the text are both store data, so the
 * whole body passes through quoteContinuationLines: only the bracket line
 * is unquoted. The three delivery sites build their text here and nowhere
 * else.
 */
export function deliveryText(
  ground: string,
  id: string,
  text: string,
  opts: { mark?: "plain" | "urgent" | "waited"; answerTo?: string } = {},
): string {
  const answer = opts.answerTo === undefined ? "" : `Answer to ${opts.answerTo}: `;
  return `${deliveryPrefix(ground, id, opts.mark ?? "plain")} ${quoteContinuationLines(`${answer}${text}`)}`;
}

/**
 * deliveryGroundIn at the send gate, over one fresh read of the commons
 * claims and of the architect's records where the writer owns the architect
 * persona. On the answer leg the ground carries `answersRecord`, which
 * agentic_say stamps on the record it writes.
 */
export async function deliveryGroundAtSend(
  store: CommonsStore,
  target: string,
  writer: string,
  coordinatorPersona: string,
  architectPersona: string,
  staleAfterMs: number = 90_000,
): Promise<DeliveryGround> {
  const claims = await readAllClaims(store, staleAfterMs);
  const records = await architectLineRecords(store, claims, writer, architectPersona);
  return deliveryGroundIn(claims, target, writer, coordinatorPersona, { persona: architectPersona, records });
}

/**
 * Whether deliveryGroundAtSend admits `writer` to `target`: the inbox read's
 * gate, the same rule the send gate applies.
 */
export async function mayReachPersona(
  store: CommonsStore,
  target: string,
  writer: string,
  coordinatorPersona: string,
  architectPersona: string,
  staleAfterMs: number = 90_000,
): Promise<boolean> {
  return "ground" in await deliveryGroundAtSend(store, target, writer, coordinatorPersona, architectPersona, staleAfterMs);
}

/**
 * Get the highest existing inbox seq for a persona and writer session.
 */
export async function getHighestInboxSeq(
  store: CommonsStore,
  persona: string,
  writerSessionId: string,
): Promise<number> {
  const keys = await store.keys();
  const prefix = `${INBOX_PREFIX}${persona}:${writerSessionId}:`;
  let maxSeq = 0;
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      const seqStr = key.slice(prefix.length);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  return maxSeq;
}

/**
 * Write a `say` record the plugin composed, rather than one a tool call
 * carried, to `target`'s inbox from `writerSessionId`, under the next
 * sequence number that writer holds for that persona. Returns the record id,
 * the writer and the sequence number, which is what a caller needs to read
 * the record back with readInboxRecord. The reach rule is the caller's to
 * apply before the call, the way agentic_say applies it before its own write.
 */
export async function sendPluginRecord(
  store: CommonsStore,
  target: string,
  writerSessionId: string,
  text: string,
): Promise<{ id: string; writer: string; seq: number }> {
  const seq = await getHighestInboxSeq(store, target, writerSessionId) + 1;
  const id = await writeInboxRecord(store, target, writerSessionId, seq, text, "say");
  return { id, writer: writerSessionId, seq };
}
