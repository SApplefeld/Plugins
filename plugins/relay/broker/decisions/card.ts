// The `Fleet: Decisions` card: one line per open ask across every roster persona's ledger, oldest
// first, and the messages its thread carries for each ask.
//
// Pure rendering: everything it draws arrives
// as an argument, the clock included, so the same readings compose the same bytes and the thread
// this card lives in is edited only when its text changes.
//
// Every string read from a ledger file is written by a worker and reaches a trusted channel here, so
// each takes `inertField`, the full escape for text a worker wrote, under the same
// expansion allowance. A persona's name comes from the roster file and takes the same escape, as the
// board card gives it. The link is the one string here this module does not compose: `links` is the
// sightings module's `linkFor`, which checks every identifier it interpolates against `SNOWFLAKE`.
import {
  fit,
  heartbeat,
  inertField,
  MAX_CARD_LENGTH,
  MAX_MESSAGE_LENGTH,
  span,
} from "../discord/render.ts";
import { MAX_ROSTER_PERSONA_NAME_LENGTH } from "../board/roster.ts";
import type { AskEntry, LedgerReading } from "./ledger.ts";

/**
 * Where an entry's ask was posted, resolved by the caller on every render: the sightings module's
 * `linkFor`, or null where the persona has no live session, its session no thread, or the guild is
 * not yet known.
 */
export type AskLink = (entry: Pick<AskEntry, "question">, persona: string) => string | null;

/** The card's name where Discord draws a message's first line, inline beside the bot's own name,
 * and again at the largest heading Discord offers, for the two reasons the sibling cards' comments
 * give: that position reads as chrome, and a channel of cards needs a visible top edge. */
const PREVIEW = "🗳️ **Fleet: Decisions**";
const TITLE = "# 🗳️ Fleet: Decisions";

/** What a card with nothing open says, rather than being absent: an absent card and a fleet with
 * nothing outstanding look identical to a reader, and only one of them is good news. */
const EMPTY = "No open asks.";

const SEPARATOR = "·";
const BULLET = "-";
const SUB_BULLET = "  -";

/** The glyph an ask draws for what the worker is doing about it: stopped on it, or proceeding on
 * its own recommendation. An entry whose `blocking` the file left out draws as proceeding, since
 * the plugin writes the flag on every ask and only a stopped worker is worth the stronger mark. */
const BLOCKING_GLYPH = "⛔";
const PROCEEDING_GLYPH = "▶️";

/** What a persona on a plugin that writes no ledger draws, in place of its asks. */
const NO_LEDGER = "no ledger";

/** What a proceeding ask's second sub-bullet opens with, ahead of the worker's recommendation. */
const PROCEEDING_ON = "proceeding on:";

/** What the thread message's recommendation line opens with. */
const RECOMMENDATION = "recommendation:";

/** What a closed ask's message ends with, and what one whose outcome the ledger no longer shows,
 * closed longer ago than the reader's recently-closed window, says alone. */
const CLOSED = "closed";

/** The status a closed entry with none draws. */
const UNKNOWN_STATUS = "unknown";

/** Room for an entry's title on the card: the line a reader scans by, beside the persona's name. */
export const MAX_ENTRY_TITLE_LENGTH = 40;

/** Room for the question on the card's sub-bullet, once cut at its recommendation segment. */
export const MAX_QUESTION_LENGTH = 160;

/** Room for the recommendation a proceeding ask draws on the card. */
export const MAX_RECOMMEND_LENGTH = 80;

/**
 * Room for the question and the recommendation on a thread message, which carries the question
 * whole. The ledger holds each to 1,000 code points and the full escape can double a field, so the
 * two bounds are on the escaped text. They are the most each line takes, not what keeps the message
 * under `MAX_MESSAGE_LENGTH`: the heading, the link and the outcome line take their own room, and
 * `fitMessage` gives the question what is left after them, then the recommendation.
 */
const MAX_MESSAGE_QUESTION_LENGTH = 1_200;
const MAX_MESSAGE_RECOMMEND_LENGTH = 240;

/** The widest `heartbeat` draws: "just now" and "999d ago" are both eight characters. */
const MAX_HEARTBEAT_LENGTH = 8;

/**
 * The widest an outcome line can be, reserved on every posted message so a close can append the
 * line and stay under the ceiling: the closing word, two separators with their spaces, a status
 * escaped at the entry title's width, and the age.
 */
const MAX_OUTCOME_LINE_LENGTH =
  CLOSED.length +
  2 * (SEPARATOR.length + 2) +
  MAX_ENTRY_TITLE_LENGTH * 2 +
  MAX_HEARTBEAT_LENGTH;

/**
 * The widest a posted ask message is, in UTF-16 units: the message ceiling less the outcome line
 * and the newline that joins it on, so the close that appends the line stays under the ceiling.
 * What the ask map's loader bounds a stored body at, since nothing wider was ever posted.
 */
export const MAX_ASK_BODY_LENGTH = MAX_MESSAGE_LENGTH - 1 - MAX_OUTCOME_LINE_LENGTH;

/** The oldest a closed ask's age draws as, which keeps the age inside `MAX_HEARTBEAT_LENGTH`: a
 * stamp is any finite number the file carries, and an absurd one would draw a longer day count. */
const MAX_CLOSED_AGE_MS = 999 * 86_400_000;

/** A ledger file older than this carries a marker on its first line: the persona writing it has
 * not touched its store in as long, so what the card draws for it may be behind. */
export const STALE_LEDGER_MS = 10 * 60 * 1000;

/**
 * How much longer than its input the live-markdown escape can make a field, as a multiple of the
 * input's length in code points, on `../board/card.ts`'s own reasoning: every character the escape
 * touches is ASCII and every astral one it leaves untouched, so a field already held to N code
 * points renders whole under N times this.
 */
const MAX_ESCAPE_EXPANSION = 2;

/**
 * The `? Recommend:` segment of a worker's ask line, read the way the plugin's own matcher reads it
 * (`ASK_MARKER_LINE` in `./ask.ts`): in any case, with any whitespace between the question mark and
 * the word. The ledger's `question` holds the worker's line whole, mark aside, and `recommend` the
 * segment after it, so the card cuts here to draw the two apart.
 */
const RECOMMEND_SEGMENT = /\?\s*Recommend:/i;

/** The question alone: the worker's line cut at its recommendation segment with the question mark
 * kept, or whole where it carries none. */
export function questionOf(question: string): string {
  const match = RECOMMEND_SEGMENT.exec(question);
  return match === null ? question : question.slice(0, match.index + 1);
}

/** An untrusted field already bounded by its own producer: escaped and guarded, never re-cut. */
function field(value: string, cap: number): string {
  return inertField(value, cap * MAX_ESCAPE_EXPANSION);
}

/** An untrusted field this card holds to a cap of its own: cut, then escaped. */
function cutField(value: string, cap: number): string {
  return inertField(fit(value, cap), cap * MAX_ESCAPE_EXPANSION);
}

function glyphFor(entry: Readonly<AskEntry>): string {
  return entry.blocking === true ? BLOCKING_GLYPH : PROCEEDING_GLYPH;
}

/** The persona and the entry in bold, or the persona alone where the entry has no title. */
function heading(persona: string, entry: Readonly<AskEntry>): string {
  const name = field(persona, MAX_ROSTER_PERSONA_NAME_LENGTH);
  const title = entry.entryTitle === null ? "" : cutField(entry.entryTitle, MAX_ENTRY_TITLE_LENGTH);
  const named = title === "" ? name : `${name} ${SEPARATOR} ${title}`;
  return `${glyphFor(entry)} **${named}**`;
}

/** What a card that ran out of room ends with, naming how many asks and how many personas without
 * a ledger it left out rather than cutting silently. */
function overflowTail(asks: number, personas: number): string {
  const parts: string[] = [];
  if (asks > 0) parts.push(`${String(asks)} ask${asks === 1 ? "" : "s"}`);
  if (personas > 0) parts.push(`${String(personas)} persona${personas === 1 ? "" : "s"} without a ledger`);
  return `(+${parts.join(" and ").replace(" ", " more ")} not shown)`;
}

/** What a run of lines costs the card: each line's own text and the newline that joins it on. */
function spent(lines: readonly string[]): number {
  return lines.reduce((sum, line) => sum + 1 + line.length, 0);
}

/** One open ask with the persona it belongs to. */
export type OpenAsk = { persona: string; entry: Readonly<AskEntry> };

/** Every open ask across the readings, oldest opened first, an unstamped one after every stamped
 * one, and the readings' own order between equals. */
export function openAsks(ledgers: readonly LedgerReading[]): OpenAsk[] {
  const all: OpenAsk[] = [];
  for (const ledger of ledgers) {
    for (const entry of ledger.open) all.push({ persona: ledger.name, entry });
  }
  const key = (ask: OpenAsk): number => ask.entry.openedAt ?? Number.POSITIVE_INFINITY;
  return all.sort((left, right) => key(left) - key(right));
}

/**
 * One ask's lines: its heading, its age, its link where one is known and, where this is the first
 * line drawn for a persona whose ledger file is stale, how old that file is; then a sub-bullet with
 * the question, and for a proceeding ask a second with what the worker is proceeding on.
 */
function askLines(ask: OpenAsk, link: string | null, stale: number | null, now: number): string[] {
  const parts = [heading(ask.persona, ask.entry)];
  // Drawn from when the ask opened: the lines draw oldest
  // opened first, and the age beside each is what makes that order legible.
  if (ask.entry.openedAt !== null) parts.push(heartbeat(Math.max(now - ask.entry.openedAt, 0)));
  if (link !== null) parts.push(link);
  if (stale !== null) parts.push(`ledger ${span(stale)} old`);
  const lines = [
    `${BULLET} ${parts.join(` ${SEPARATOR} `)}`,
    `${SUB_BULLET} ${cutField(questionOf(ask.entry.question), MAX_QUESTION_LENGTH)}`,
  ];
  if (ask.entry.blocking !== true && ask.entry.recommend !== null && ask.entry.recommend !== "") {
    lines.push(`${SUB_BULLET} ${PROCEEDING_ON} ${cutField(ask.entry.recommend, MAX_RECOMMEND_LENGTH)}`);
  }
  return lines;
}

/** Whether a reading's file is old enough to carry the marker. */
function staleAge(ledger: LedgerReading): number | null {
  return ledger.fileAge !== null && ledger.fileAge > STALE_LEDGER_MS ? ledger.fileAge : null;
}

/**
 * The card's closing line: how old the information on it is.
 *
 * Anchored to the oldest stale ledger behind a line the card draws rather than to the clock, on the
 * board card's own discipline: this card is edited only when its text changes, and a footer carrying
 * a clock would rewrite even an empty card on every refresh. A card with an ask open is rewritten
 * as its line's age moves anyway. A card every ledger of which is fresh is as of
 * just now, and one drawing an ask off a ledger that has gone stale is as of that ledger, which is
 * what a reader cannot see from the lines. A stale ledger with no open ask draws no line, so it ages
 * nothing the reader is looking at.
 */
function footerLine(ledgers: readonly LedgerReading[]): string {
  const oldest = ledgers.reduce((age, ledger) => {
    const stale = staleAge(ledger);
    return stale === null || ledger.open.length === 0 ? age : Math.max(age, stale);
  }, 0);
  return `card as of ${heartbeat(oldest)}`;
}

/**
 * The whole card: a title heading, one bullet per open ask oldest first across every persona, or the
 * fixed empty line, then one line per persona with no ledger, then the footer, bounded to one
 * message the way every card here is. Composed ask by ask against a running budget rather than
 * assembled whole and cut, so a stop names how many asks it left out instead of dropping the last
 * one silently; the tail's room is reserved against every ask, the last included, on the board
 * card's own reasoning: one rule with no branch to get wrong, at the price of at most one tail's
 * width of unused room on a full card. The no-ledger lines and the footer are reserved before the
 * first ask, so an ask never pushes either off the card.
 *
 * Nothing here reads a clock or anything else the arguments do not carry, so two renders of the
 * same readings compose the same bytes.
 */
export function renderDecisionsCard(
  ledgers: readonly LedgerReading[],
  links: AskLink,
  now: number,
): string {
  const lines: string[] = [PREVIEW, TITLE];
  const asks = openAsks(ledgers);
  const noLedger = ledgers
    .filter((ledger) => !ledger.hasLedger)
    .map((ledger) => `${BULLET} ${field(ledger.name, MAX_ROSTER_PERSONA_NAME_LENGTH)} ${SEPARATOR} ${NO_LEDGER}`);
  const footer = footerLine(ledgers);
  if (asks.length === 0) lines.push(EMPTY);

  // Every line under the heading is one item against one budget, the asks first and the no-ledger
  // lines after them, each paid for together with the tail that would name it and everything
  // after it. The footer is reserved before the first item, so no item pushes it off the card.
  let used = spent(lines) + spent([footer]);
  let shownAsks = 0;
  let shownPersonas = 0;
  const tail = (): string => overflowTail(asks.length - shownAsks, noLedger.length - shownPersonas);
  const fits = (drawn: readonly string[]): boolean => used + spent(drawn) + spent([tail()]) <= MAX_CARD_LENGTH;
  const stop = (): string => {
    lines.push(tail(), footer);
    return lines.join("\n");
  };

  const marked = new Set<string>();
  for (const ask of asks) {
    const ledger = ledgers.find((held) => held.name === ask.persona);
    const stale = ledger !== undefined && !marked.has(ask.persona) ? staleAge(ledger) : null;
    const drawn = askLines(ask, links(ask.entry, ask.persona), stale, now);
    if (!fits(drawn)) return stop();
    marked.add(ask.persona);
    lines.push(...drawn);
    used += spent(drawn);
    shownAsks += 1;
  }
  for (const line of noLedger) {
    if (!fits([line])) return stop();
    lines.push(line);
    used += spent([line]);
    shownPersonas += 1;
  }
  lines.push(footer);
  return lines.join("\n");
}

/**
 * One thread message held to `MAX_MESSAGE_LENGTH` less the widest outcome line: the heading and the
 * link are kept whole, the recommendation takes its own bound, and the question takes what is left,
 * so a message whose every field is at its bound still ends with the link, and the close that later
 * appends the outcome line stays under the ceiling. The question gives up room first because it is
 * the one line the card already draws a cut of.
 */
function fitMessage(persona: string, entry: Readonly<AskEntry>, link: string | null): string {
  const head = heading(persona, entry);
  const recommendation =
    entry.recommend === null || entry.recommend === ""
      ? null
      : `${RECOMMENDATION} ${inertField(entry.recommend, MAX_MESSAGE_RECOMMEND_LENGTH)}`;
  const rest = [recommendation, link].filter((line): line is string => line !== null);
  // `spent` charges each line with the newline that joins it on, and a message of n lines carries
  // n - 1 of them, so the room left is the ceiling less every other line's cost, the question's own
  // newline paid out of that count. The outcome line is charged as if present, newline included.
  const room = MAX_ASK_BODY_LENGTH - spent([head, ...rest]);
  const question = inertField(questionOf(entry.question), Math.min(MAX_MESSAGE_QUESTION_LENGTH, room));
  return [head, question, ...rest].join("\n");
}

/**
 * The message the card's thread carries for one ask: the heading the card draws, the question whole
 * but for its recommendation segment, the recommendation where the worker gave one, and the link to
 * where it was asked where one is known.
 */
export function renderAskMessage(
  persona: string,
  entry: Readonly<AskEntry>,
  link: string | null,
): string {
  return fitMessage(persona, entry, link);
}

/**
 * What an ask's message is edited to once the ledger shows it closed: the body it was posted with,
 * then one line with the outcome, the entry's status and how long ago it closed. An ask whose
 * outcome the ledger no longer shows, closed longer ago than the reader's recently-closed window,
 * keeps the same body and gains the closing word alone, with no status it cannot know. The body
 * was posted with the outcome line's room reserved, so the edit stays under the ceiling.
 */
export function renderClosedMessage(body: string, entry: Readonly<AskEntry> | null, now: number): string {
  if (entry === null) return `${body}\n${CLOSED}`;
  const status =
    entry.status === null || entry.status === "" ? UNKNOWN_STATUS : field(entry.status, MAX_ENTRY_TITLE_LENGTH);
  const age = heartbeat(
    entry.closedAt === null ? 0 : Math.min(Math.max(now - entry.closedAt, 0), MAX_CLOSED_AGE_MS),
  );
  return `${body}\n${CLOSED} ${SEPARATOR} ${status} ${SEPARATOR} ${age}`;
}
