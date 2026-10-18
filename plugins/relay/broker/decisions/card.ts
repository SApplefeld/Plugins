// The `Fleet: Decisions` card: one count line per persona that filed an ask in the last seven days,
// then one line per open ask across every roster persona's ledger, oldest first, and the messages
// its thread carries for each ask, which draw the kit's decision brief where the entry carries one.
//
// Pure rendering: everything it draws arrives
// as an argument, the clock included, so the same readings compose the same bytes and the thread
// this card lives in is edited only when its text changes.
//
// Every string read from a ledger file is written by a worker and reaches a trusted channel here, so
// each takes `inertField`, the full escape for text a worker wrote, under the same expansion
// allowance. A brief's line keeps the kit's bold or small-text markers where the line carries them
// unescaped, and everything else on it takes the same escape once. A persona's name comes from the
// roster file and takes the same escape, as the board card gives it. The link is the one string here
// this module does not compose: `links` is the sightings module's `linkFor`, which checks every
// identifier it interpolates against `SNOWFLAKE`.
import {
  fit,
  heartbeat,
  inertField,
  inertText,
  MAX_CARD_LENGTH,
  MAX_MESSAGE_LENGTH,
  span,
} from "../discord/render.ts";
import { MAX_ROSTER_PERSONA_NAME_LENGTH } from "../board/roster.ts";
import { visible } from "../sanitize.ts";
import { ASK_COUNT_WINDOW_MS } from "./ledger.ts";
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

/**
 * Room for one line of a decision brief on a thread message, a bound on the escaped text as the
 * question's is, and how many of the brief's non-blank lines are drawn. Neither keeps the message
 * under `MAX_MESSAGE_LENGTH`: the joined lines are then held to what the heading and the link leave.
 */
const MAX_MESSAGE_BRIEF_LINE_LENGTH = 600;
const MAX_MESSAGE_BRIEF_LINES = 24;

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

/** Whether an entry carries a decision brief the thread message draws: a string with at least one
 * line left once escaped, so a brief the escape strips to nothing keeps the question.
 * The one test of it, so the message and the thread's one edit cannot disagree. */
export function hasBrief<T extends Pick<AskEntry, "brief">>(entry: T): entry is T & { brief: string } {
  return typeof entry.brief === "string" && briefLines(entry.brief) !== "";
}

/**
 * The kit's own escape layer: a backslash before one of the characters the kit's `escapeMarkdown`
 * escapes (`plugins/personas/hooks/ask-brief.ts` in the Grimoire repository). Those are the
 * backslash, the asterisk, the underscore, the tilde, the backtick, the pipe, the hash, the square
 * brackets, and the three of a line-opening list marker: the hyphen, the plus and the full stop of
 * `1.`. A backslash before any other character is not the kit's and is kept. The three list-marker
 * escapes are stripped anywhere on the line, though the kit writes them only at a field's opening,
 * so only a direct ledger writer's mid-line one draws without its backslash.
 */
const KIT_ESCAPE = /\\([\\*_~`|#[\]+.-])/gu;

/** Text with the kit's escape layer removed, so the full escape after it puts each character behind
 * one backslash at most. */
function unescapeKit(text: string): string {
  return text.replace(KIT_ESCAPE, "$1");
}

/** The two markers of the line shapes the kit writes a brief's structure in. */
const BOLD = "**";
const SMALL = "-# ";

/**
 * One line of a decision brief as a message line. The line takes `visible` first, so a planted
 * invisible character cannot defeat the shape read, and its shape is read on that line before
 * anything else, so only markers the kit wrote bare qualify: the kit escapes every marker in a
 * worker's words, which therefore never open a shape. A line opening and closing with two asterisks
 * around at least one character draws bold, and one opening with a hyphen, a hash and a space draws
 * as small text. Either keeps its markers; what is between them loses the kit's escape layer and
 * then takes the full escape, so each character draws behind one backslash at most and a mention,
 * a link, a heading or a fence inside the shape still draws as text. That is cut to the line's
 * bound less the markers' room. Every other line, and a shape with nothing left once escaped,
 * loses the kit's escape layer and takes the full escape whole.
 */
function briefLine(raw: string): string {
  const line = visible(raw);
  if (line.length > 2 * BOLD.length && line.startsWith(BOLD) && line.endsWith(BOLD)) {
    const inner = inertText(unescapeKit(line.slice(BOLD.length, -BOLD.length)));
    if (inner !== "") return `${BOLD}${fit(inner, MAX_MESSAGE_BRIEF_LINE_LENGTH - 2 * BOLD.length)}${BOLD}`;
  } else if (line.startsWith(SMALL)) {
    const rest = inertText(unescapeKit(line.slice(SMALL.length)));
    if (rest !== "") return `${SMALL}${fit(rest, MAX_MESSAGE_BRIEF_LINE_LENGTH - SMALL.length)}`;
  }
  return inertField(unescapeKit(line), MAX_MESSAGE_BRIEF_LINE_LENGTH);
}

/**
 * A decision brief as message lines: each of its lines drawn on its own by `briefLine`, since the
 * escape folds a text onto one line; a line left blank dropped; and the first
 * `MAX_MESSAGE_BRIEF_LINES` of the rest rejoined. Each line is trimmed and its runs of whitespace
 * folded to one space, so an indented line draws flush left. A line opening with a hyphen still
 * draws as a bullet, since the hyphen is not in the escape class.
 */
function briefLines(brief: string): string {
  return brief
    .split("\n")
    .map(briefLine)
    .filter((line) => line !== "")
    .slice(0, MAX_MESSAGE_BRIEF_LINES)
    .join("\n");
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

/** What a card that ran out of room ends with, naming how many count lines, asks and personas
 * without a ledger it left out rather than cutting silently. */
function overflowTail(counts: number, asks: number, personas: number): string {
  const parts: string[] = [];
  if (counts > 0) parts.push(`${String(counts)} count line${counts === 1 ? "" : "s"}`);
  if (asks > 0) parts.push(`${String(asks)} ask${asks === 1 ? "" : "s"}`);
  if (personas > 0) parts.push(`${String(personas)} persona${personas === 1 ? "" : "s"} without a ledger`);
  return `(+${parts.join(" and ").replace(" ", " more ")} not shown)`;
}

/** The window every count line is drawn over, named in the line. */
const COUNT_WINDOW = `${String(ASK_COUNT_WINDOW_MS / 86_400_000)}d`;

/** One persona's count line: how many asks it filed in the window and how many of them are open. */
function countLine(ledger: LedgerReading): string {
  const filed = `${String(ledger.filedInWindow)} ask${ledger.filedInWindow === 1 ? "" : "s"} in ${COUNT_WINDOW}`;
  const open = ledger.openInWindow > 0 ? ` ${SEPARATOR} ${String(ledger.openInWindow)} open` : "";
  return `${BULLET} ${field(ledger.name, MAX_ROSTER_PERSONA_NAME_LENGTH)} ${SEPARATOR} ${filed}${open}`;
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
 * what a reader cannot see from the lines. A stale ledger with no open ask draws no ask line, so it
 * ages nothing. Its count line, where it draws one, is left out of the footer too: that line changes
 * only when the persona files, an ask closes or an entry leaves the window, and the reader counts
 * the window against the clock on every pass, so a quiet ledger's counts are current.
 */
function footerLine(ledgers: readonly LedgerReading[]): string {
  const oldest = ledgers.reduce((age, ledger) => {
    const stale = staleAge(ledger);
    return stale === null || ledger.open.length === 0 ? age : Math.max(age, stale);
  }, 0);
  return `card as of ${heartbeat(oldest)}`;
}

/**
 * The whole card: a title heading, one count line per persona that filed an ask in the window, most
 * filed first, then one bullet per open ask oldest first across every persona, or the fixed empty
 * line, then one line per persona with no ledger, then the footer, bounded to one message the way
 * every card here is. Composed line by line against a running budget rather than assembled whole
 * and cut, so a stop names how many count lines and asks it left out instead of dropping the last
 * one silently; the tail's room is reserved against every item, the last included, on the board
 * card's own reasoning: one rule with no branch to get wrong, at the price of at most one tail's
 * width of unused room on a full card. The fixed empty line and the footer are reserved before
 * the first count line, so no item pushes either off the card.
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
  const empty = asks.length === 0 ? [EMPTY] : [];
  const counts = ledgers
    .filter((ledger) => ledger.filedInWindow > 0)
    .sort((left, right) =>
      left.filedInWindow !== right.filedInWindow
        ? right.filedInWindow - left.filedInWindow
        : left.name < right.name
          ? -1
          : left.name > right.name
            ? 1
            : 0,
    )
    .map(countLine);

  // Every line under the heading is one item against one budget, the count lines first, then the
  // asks and the no-ledger lines after them, each paid for together with the tail that would name
  // it and everything after it. The footer and the empty line are reserved before the first item,
  // so no item pushes either off the card. The empty line is drawn after the count lines.
  let used = spent(lines) + spent(empty) + spent([footer]);
  let shownCounts = 0;
  let shownAsks = 0;
  let shownPersonas = 0;
  const tail = (): string =>
    overflowTail(counts.length - shownCounts, asks.length - shownAsks, noLedger.length - shownPersonas);
  const fits = (drawn: readonly string[]): boolean => used + spent(drawn) + spent([tail()]) <= MAX_CARD_LENGTH;
  const stop = (pending: readonly string[] = []): string => {
    lines.push(...pending, tail(), footer);
    return lines.join("\n");
  };

  for (const line of counts) {
    if (!fits([line])) return stop(empty);
    lines.push(line);
    used += spent([line]);
    shownCounts += 1;
  }
  lines.push(...empty);

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
 *
 * An entry carrying a decision brief draws the brief's lines in place of the question and the
 * recommendation, since the brief carries both in its own words. The lines take what the heading
 * and the link leave, and a brief past that room is cut at its end with the ellipsis mark, so the
 * message still ends with the link and keeps the outcome line's room.
 */
function fitMessage(persona: string, entry: Readonly<AskEntry>, link: string | null): string {
  const head = heading(persona, entry);
  if (hasBrief(entry)) {
    const tail = link === null ? [] : [link];
    // Charged as the question's room is below: every other line with the newline joining it on.
    const brief = fit(briefLines(entry.brief), MAX_ASK_BODY_LENGTH - spent([head, ...tail]));
    return [head, brief, ...tail].filter((line) => line !== "").join("\n");
  }
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
 * where it was asked where one is known. Where the entry carries a decision brief, the brief's lines
 * stand in place of the question and the recommendation.
 */
export function renderAskMessage(
  persona: string,
  entry: Readonly<AskEntry>,
  link: string | null,
): string {
  return fitMessage(persona, entry, link);
}

/**
 * What an ask's message is edited to once the ledger shows it closed: the body the message holds,
 * as posted or as edited to its brief, then one line with the outcome, the entry's status and how
 * long ago it closed. An ask whose outcome the ledger no longer shows, closed longer ago than the
 * reader's recently-closed window, keeps the same body and gains the closing word alone, with no
 * status it cannot know. The body was posted with the outcome line's room reserved, so the edit
 * stays under the ceiling.
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
