// Persistence for the decisions card: its own thread, so a broker restart edits the card it already
// owns instead of opening a second "Fleet: Decisions" thread beside the first one, and the map from
// each ask to the messages this card posted for it in that thread, its own and one per part of its
// decision brief, so a restart neither posts an ask or a part a second time nor loses the message a
// close has to edit.
//
// The thread binding is a thin caller over the shared binding module (`broker/card-binding.ts`),
// which owns that snapshot's format, write and failure handling; this file supplies only the card's
// label and the names its importers expect. The ask map is this file's own: no other card keeps one,
// so its schema lives here, in a second file beside the binding, written the same way (a versioned
// snapshot to a sibling temp file, renamed over the target) and degrading the same way (a file that
// is unreadable, oversized or the wrong shape starts with none). The failure that costs is a repost
// of each open ask into the thread, bounded per pass, not a dead broker.
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  loadCardBinding,
  saveCardBinding,
  type CardBinding,
  type LoadCardBindingOptions,
} from "../card-binding.ts";
import { readCappedFile } from "../capped-read.ts";
import { clean, isWellFormed } from "../sanitize.ts";
import { SNOWFLAKE } from "../security/senders.ts";
import { MAX_ASK_BODY_LENGTH, MAX_BRIEF_PARTS } from "./card.ts";
import { MAX_ASK_FIELD_LENGTH, cut } from "./ledger.ts";

export type DecisionsCardBinding = CardBinding;
export type LoadDecisionsBindingOptions = LoadCardBindingOptions;

/** The thread this broker already owns, or null when there is none to rebind to. */
export function loadDecisionsBinding(
  file: string,
  options: LoadDecisionsBindingOptions = {},
): DecisionsCardBinding | null {
  return loadCardBinding(file, "decisions", options);
}

export function saveDecisionsBinding(file: string, binding: DecisionsCardBinding): void {
  saveCardBinding(file, binding);
}

/** How many asks the map holds. Past it the oldest closed go first, then a departed persona's. */
export const MAX_ASK_RECORDS = 256;

/**
 * The most bytes the ask file is read at. The widest record this card writes is a body of
 * `MAX_ASK_BODY_LENGTH` (1,799) UTF-16 units, an id of 1,000 code points and a persona of 100. A
 * unit of body or persona costs at most three bytes of UTF-8, since both went through the escape
 * that strips control characters (an astral character costs four for two units, and a markdown
 * escape's backslash two for one). The ledger strips nothing from an id, and JSON writes a control
 * character as a six-byte escape, so an id costs up to 6,000 bytes. That is 5,397 + 6,000 + 300
 * bytes of text, with the snowflake, the two stamps, the brief flag, the keys and the pretty print's
 * indentation under 250 more. The tail adds at most `MAX_BRIEF_PARTS` snowflakes of 20 digits, each
 * with its quotes, its comma and its line's indentation, and the key, under 150 bytes: one record
 * under 12,100 bytes, and the cap's worth of them under 3.1 MB. A file past this cap is one
 * something else wrote.
 */
export const MAX_ASKS_FILE_BYTES = 4 * 1024 * 1024;

/**
 * The snapshot's format. Version 1 carried no body on a record, so a file in that shape reads as a
 * format change and starts with none, rather than as corruption.
 */
export const ASKS_FORMAT_VERSION = 2;

/** One ask this card has posted into its thread. */
export type AskRecord = {
  /** The roster persona whose ledger the ask is read from. With `id`, what names an ask. */
  persona: string;
  /** The ledger entry's own id, unique inside one persona's ledger and not across personas. */
  id: string;
  /**
   * The message posted for it, or null where Discord accepted the post but returned no readable id,
   * or refused the ask's own message for its content. A null is kept so the ask is not posted again,
   * and its close is marked with no edit to make when no part follows.
   */
  messageId: string | null;
  /**
   * The text of the message a close edits, which the close edits back to with the outcome line under
   * it: the last part's message once one is posted, and the ask's own message until then. Kept here
   * because the ledger stops showing an ask's entry a day after it closes, and the text the message
   * exists to carry must outlive that. Held to `MAX_ASK_BODY_LENGTH`, so the close stays under the
   * message ceiling whichever message it edits.
   */
  body: string;
  /**
   * True once no more part of the entry's decision brief is owed: every part is posted, or the parts
   * are settled short with no more to post. False while a part is owed or no brief has shown. A file
   * written before the flag reads false. A record written before the tail with the flag true carries
   * the brief cut into its own message, and gets no parts.
   */
  briefed: boolean;
  /**
   * The ids of the messages posted for the brief's parts, in order, after the ask's own message, at
   * most `MAX_BRIEF_PARTS` of them, and empty for an ask with no part posted. The next part owed is
   * the one at the tail's length. A file written before the tail reads empty.
   */
  tailIds: string[];
  /** The entry's `openedAt`, which orders a departed persona's records when the cap drops one. */
  openedAt: number | null;
  /** When this card saw the ask closed and edited its message, or null while it is open. */
  closedAt: number | null;
};

/** What names an ask across the map: its persona and its id, keyed as the ledger reader keys its
 * slots, since two personas' ledgers can carry the same id for two different asks. */
export function askKey(persona: string, id: string): string {
  return `${persona}\u0000${id}`;
}

type AsksSnapshot = {
  version: number;
  asks: AskRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stampOf(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A message id out of the file, normalized and checked as the thread binding's identifiers are, or
 * null where it is not one. */
function snowflakeOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = clean(value);
  return SNOWFLAKE.test(id) ? id : null;
}

/** The tail out of the file: empty where the field is absent, and undefined where it is anything but
 * an array of at most `MAX_BRIEF_PARTS` message ids. */
function tailOf(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_BRIEF_PARTS) return undefined;
  const ids: string[] = [];
  for (const held of value) {
    const id = snowflakeOf(held);
    if (id === null) return undefined;
    ids.push(id);
  }
  return ids;
}

/**
 * One record out of the file, or null where it is not one. The message id and each tail id are
 * interpolated into a token-bearing request path on the edit that closes the ask, so each is
 * normalized and checked as the thread binding's identifiers are, and a record naming something
 * else is refused rather than carried. A record with no persona names no reading that could ever
 * close it, and one with no body has nothing for a close to edit the message back to, so each is
 * refused too. The id is held to the ledger's own field width and the body to the message ceiling,
 * which are the widest this card wrote.
 */
function recordOf(value: unknown): AskRecord | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  if (typeof value.persona !== "string" || value.persona === "") return null;
  if (typeof value.body !== "string" || value.body.length > MAX_ASK_BODY_LENGTH) return null;
  // A lone surrogate cannot ride the request body of the edit that closes the ask, and the card
  // never posts one, so a body carrying one was not written here.
  if (!isWellFormed(value.body)) return null;
  const openedAt = stampOf(value.openedAt);
  const closedAt = stampOf(value.closedAt);
  if (openedAt === undefined || closedAt === undefined) return null;
  const persona = value.persona;
  const body = value.body;
  const id = cut(value.id, MAX_ASK_FIELD_LENGTH);
  // A flag that is absent or not a boolean reads false: at worst a message that already carries its
  // brief gains the brief's parts after it, while a record refused here would be posted a second time.
  const briefed = value.briefed === true;
  const tailIds = tailOf(value.tailIds);
  if (tailIds === undefined) return null;
  if (value.messageId === null) {
    return { persona, id, messageId: null, body, briefed, tailIds, openedAt, closedAt };
  }
  const messageId = snowflakeOf(value.messageId);
  if (messageId === null) return null;
  return { persona, id, messageId, body, briefed, tailIds, openedAt, closedAt };
}

export type LoadAskRecordsOptions = {
  log?: (message: string) => void;
};

/**
 * The asks this card had posted before the last shutdown, or none where no file exists yet. Read
 * through the capped read every other store file takes, so a file past `MAX_ASKS_FILE_BYTES` starts
 * with none rather than parsing a cut copy. A record that is not one is dropped alone, the first
 * record per persona and id kept, and no more than `MAX_ASK_RECORDS` kept in the file's order; one
 * line names how many went, so the operator can find the file.
 */
export function loadAskRecords(file: string, options: LoadAskRecordsOptions = {}): AskRecord[] {
  const log = options.log ?? ((message: string) => console.warn(message));

  // No file is the normal first boot, and is not worth a word. Checked before the read, since the
  // capped read reports every failure as one word and discards the error that would say which.
  if (!existsSync(file)) return [];
  const read = readCappedFile(file, MAX_ASKS_FILE_BYTES);
  if ("failed" in read) {
    log(`broker: the decisions card asks at ${file} are ${read.failed}, starting with none`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch (error) {
    log(
      `broker: the decisions card asks at ${file} are not valid JSON, starting with none`,
    );
    return [];
  }

  if (!isRecord(parsed) || parsed.version !== ASKS_FORMAT_VERSION || !Array.isArray(parsed.asks)) {
    log(
      `broker: the decisions card asks at ${file} are not a snapshot of this format, ` +
        `starting with none`,
    );
    return [];
  }

  const seen = new Set<string>();
  const records: AskRecord[] = [];
  let dropped = 0;
  for (const held of parsed.asks) {
    const record = recordOf(held);
    if (record === null || seen.has(askKey(record.persona, record.id))) {
      dropped += 1;
      continue;
    }
    if (records.length >= MAX_ASK_RECORDS) {
      dropped += 1;
      continue;
    }
    seen.add(askKey(record.persona, record.id));
    records.push(record);
  }
  if (dropped > 0) {
    log(
      `broker: the decisions card asks at ${file} carried ${String(dropped)} malformed, repeated or ` +
        `surplus record(s), which are dropped`,
    );
  }
  return records;
}

export function saveAskRecords(file: string, records: readonly AskRecord[]): void {
  const snapshot: AsksSnapshot = { version: ASKS_FORMAT_VERSION, asks: [...records] };
  const temp = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temp, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    // A temp file left behind would never be cleaned up by anything else.
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * The records held to the cap, given which personas the roster names now. The closed ones go
 * first, the one closed longest ago first. Then the open records of a persona off the roster, the
 * one opened longest ago first with an unstamped one ahead of every stamped one: no reading can
 * close them while the persona is away, and the ask each names is reposted only if the persona
 * returns before a close. An open record of a persona on the roster is never dropped, since its ask
 * would be posted again on the very next pass; the thread module keeps those under the cap by
 * posting nothing while the map is full of them.
 */
export function capAskRecords(records: readonly AskRecord[], roster: ReadonlySet<string>): AskRecord[] {
  if (records.length <= MAX_ASK_RECORDS) return [...records];
  const drop = new Set<string>();
  const excess = (): number => records.length - drop.size - MAX_ASK_RECORDS;
  const oldestFirst = (stamp: (record: AskRecord) => number | null) => (a: AskRecord, b: AskRecord) =>
    (stamp(a) ?? Number.NEGATIVE_INFINITY) - (stamp(b) ?? Number.NEGATIVE_INFINITY);
  const closed = records
    .filter((record) => record.closedAt !== null)
    .sort(oldestFirst((record) => record.closedAt));
  for (const record of closed) {
    if (excess() <= 0) break;
    drop.add(askKey(record.persona, record.id));
  }
  const departed = records
    .filter((record) => record.closedAt === null && !roster.has(record.persona))
    .sort(oldestFirst((record) => record.openedAt));
  for (const record of departed) {
    if (excess() <= 0) break;
    drop.add(askKey(record.persona, record.id));
  }
  return records.filter((record) => !drop.has(askKey(record.persona, record.id)));
}
