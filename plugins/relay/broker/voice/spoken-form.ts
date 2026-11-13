// The spoken form of a line: the words a voice can say for text written to be read. Setting names,
// file paths, symbols, code and markup are turned into plain words by fixed rules, so the voice
// says "channel voice memory turns equals 32" where the thread reads
// `CHANNEL_VOICE_MEMORY_TURNS=32`. Only the copy the voice speaks is rewritten, so a
// session's reply keeps the text as written in the thread, the ring and the hand-off to the
// session.
//
// The rules run in a fixed order, one pass each: the three block rules, fenced code, then tables,
// then lists, each reading a block inside its limit and naming a larger one by its kind and size;
// then markdown marks, then identifiers, then symbols read as words, then every other symbol
// dropped and the whitespace collapsed. A one-line sentence of lowercase or initial-capital words
// with no symbol, with single spaces and no leading or trailing whitespace, reads back unchanged.
// Numbers stay as digits. The function is pure and takes any string without throwing.
import { SECRET_SCREEN } from "../jev/client.ts";

/**
 * The largest block of each kind that is read aloud. A block over its limit is spoken as one
 * sentence naming its kind and size, and a limit of 0 names every block of that kind.
 */
export type ReadLimits = {
  /** `CHANNEL_VOICE_READ_CODE_LINES`: the most non-blank lines of a fenced code block. */
  codeLines: number;
  /** `CHANNEL_VOICE_READ_TABLE_CELLS`: the most cells of a table, its body lines times its columns. */
  tableCells: number;
  /** `CHANNEL_VOICE_READ_LIST_ITEMS`: the most items of a list. */
  listItems: number;
};

/**
 * Rule 1. A fence opens at the first run of three or more backticks anywhere on a line, so a shape
 * that may be a code block is named rather than read, whatever stands before it. The text before
 * the run is prose and stays on the line, so a list marker or `>` marks there keep their role.
 *
 * Where the text after the opening run holds a run of backticks at least as long, the run and the
 * text up to the first such run are a one-line block, and the text after that run is prose, which
 * the same rule scans for the next opening run. Otherwise the block runs through the next line
 * holding, after any indentation, a run of backticks at least as long as the opener's and nothing
 * else but whitespace, or to the end of the text. It reaches that closing line only where the
 * opening run stands on its own line, with nothing but whitespace before it and at most one word
 * after it; any other opening run makes the pairing unclear, and its block runs to the end of the
 * text and is named whatever its size, so it can only name more, never read a later block as prose. The run is found from a given
 * place, the character before it is no backtick, so the run is whole, and each search starts where
 * the last one ended, so a line is scanned once.
 */
const OPENING_RUN = /(?<!`)`{3,}/g;
/** In the trimmed text after an opening run, what makes it more than one word, its info string. */
const INFO_BREAK = /[\s`]/;
const FENCE_CLOSE = /^[ \t]*(`{3,})[ \t]*$/;
/** A line break: CR LF, a lone CR or a lone LF. */
const LINE_BREAK = /\r\n|\r|\n/;
/** A line's indentation, which a block's size sentence keeps. */
const INDENTATION = /^[ \t]*/;

/**
 * The text as lines, each marked where it is a line of a read code block. The table and list rules
 * pass over a code line, so a read block's `- item` or pipes are never a list or a table.
 */
type BlockLines = { lines: string[]; code: boolean[] };

/** A table's delimiter line: dashes, colons, pipes, spaces and tabs alone. It also holds a dash. */
const TABLE_DELIMITER = /^[-:| \t]+$/;

/**
 * A list marker after any indentation, which the list rule counts as an item and rule 2 drops. A
 * numbered marker has one or two digits, so a year ending a sentence at a line's start stays.
 */
const LIST_MARKER_SHAPE = String.raw`^([ \t]*)(?:[-*+]|\d{1,2}\.)[ \t]+`;
const LIST_ITEM = new RegExp(LIST_MARKER_SHAPE);
/** A list item's continuation line: indented, with words, and no marker of its own. */
const INDENTED = /^[ \t]+\S/;

/** Rule 2's marks at a line's start: block quotes, then a heading's `#` marks, then a list marker. */
const QUOTE_MARKS = /^([ \t]*)(?:>[ \t]?)+/gm;
const HEADING_MARKS = /^([ \t]*)#{1,6}[ \t]+/gm;
const LIST_MARKER = new RegExp(LIST_MARKER_SHAPE, "gm");
/**
 * A link, `[text](url)`: the text stays and the URL goes. The URL holds no `[`, so a search for its
 * closing `)` stops at the next link's start.
 */
const LINK = /\[([^[\]\r\n]*)\]\([^)\s[]*\)/g;
/**
 * `*` or `_` emphasis, one to three marks, opening at a word's start and closing with the same
 * marks at a word's end, so an underscore inside `snake_case` is no emphasis. The emphasised words
 * hold no mark of the same kind, so each search stops at the next one.
 */
const STAR_EMPHASIS = /(?<![\p{L}\p{N}\p{M}*])(\*{1,3})(?![\s*])([^*\r\n]+?)(?<![\s*])\1(?![\p{L}\p{N}\p{M}*])/gu;
const UNDERSCORE_EMPHASIS = /(?<![\p{L}\p{N}\p{M}_])(_{1,3})(?![\s_])([^_\r\n]+?)(?<![\s_])\1(?![\p{L}\p{N}\p{M}_])/gu;

/** Rule 3's word shapes: one holding an underscore, a lowercase-to-uppercase step, a capitals run. */
// Anchored at a word's start, so a long word with no underscore is scanned once, not from every letter.
const UNDERSCORED = /(?<![\p{L}\p{N}\p{M}_])[\p{L}\p{N}\p{M}_]*_[\p{L}\p{N}\p{M}_]*/gu;
const CAMEL_STEP = /(\p{Ll})(\p{Lu})(?=(\p{Ll})?)/gu;
const CAPITALS = /(?<![\p{L}\p{N}\p{M}])\p{Lu}{4,}(?![\p{L}\p{N}\p{M}])/gu;

/**
 * Rule 4: a symbol read as its word. A symbol the table names is read between two non-space
 * characters, or spaced on both sides between two words as a binary operator; a longer form is
 * tried before a shorter one. A comparison, `<`, `>`, `<=`, `>=`, `==`, `!=`, `===` or `!==`, is
 * read only spaced on both sides. Anywhere else it is captured whole, before a lone `=` could read
 * part of it, and handed on for rule 5 to drop, so `List<string>` loses its brackets and `a==b`
 * reads `a b`.
 *
 * A lone dash spaced on both sides between two words is a comma on the word before it, matched
 * with the spaces before it, from the first of them only. Where that word ends in sentence
 * punctuation, closing quotes and brackets included, the punctuation already gives the pause, and
 * where it is an operator read as a word, no comma follows; either way the dash falls to rule 5,
 * except where it is a sign.
 *
 * A sign is a `-` or a Unicode minus read as `minus`, and a `.` straight after it as `point`. It
 * is a sign before a digit, a `.` then a digit, an opening bracket or a currency sign, either at a
 * word's start, after no letter, digit or mark, or after an operator read as a word: one spaced
 * on both sides, with spaces between it and the sign, or `=` between two non-space characters,
 * with the sign straight after it. After an operator, the follower may stand after spaces, and a
 * `.` there before a digit is still read as `point`. Before a letter it is a flag, such as `-v`,
 * and falls to rule 5. A symbol rule 5 drops is no operator, so `List<T> - 5` keeps its comma.
 *
 * `%` after a digit, with or without one space between them, is a percent, and `.` and `:` between
 * digits and `.` between two letters carry their own context. Every form that looks back over a
 * run of spaces first checks the character it stands on, so a long run of spaces is scanned once.
 */
/** The operators read spaced on both sides, the longer form before the shorter. */
const SPACED_OPERATORS = String.raw`->|=>|===|!==|<=|>=|!=|==|[=/\\@&+<>]`;
/** What may follow a sign: a digit, a `.` then a digit, an opening bracket or a currency sign. */
const SIGN_FOLLOWER = String.raw`\p{N}|\.\p{N}|[(\[{]|\p{Sc}`;
/** A sign, and a decimal point straight after it, which is read with it. */
const SIGN = String.raw`[-\u2212](?:\.(?=\p{N})|(?=${SIGN_FOLLOWER}))`;
/** A sign after an operator: its follower, a point included, may stand after spaces. */
const OPERATOR_SIGN = String.raw`[-\u2212](?:[ \t]*\.(?=\p{N})|(?=[ \t]*(?:${SIGN_FOLLOWER})))`;
const READ_AS_WORD = new RegExp(
  [
    String.raw`(?<=\S)(?:->|=>)(?=\S)`,
    String.raw`(?=[=/\\@&+<>!-])(?<=\S[ \t]+)(?:${SPACED_OPERATORS})(?=[ \t]+\S)`,
    String.raw`(===|!==|<=|>=|!=|==|[<>])`,
    String.raw`(?<=\S)[=/\\@&+](?=\S)`,
    // The spaced lone dash read as a comma, from the first space before it: not after sentence
    // punctuation, closers included, and not after an operator read spaced.
    String.raw`(?<=\S)(?=[ \t])(?<![.,!?;:]['"’”)\]}]*)(?<!\S[ \t]+(?:${SPACED_OPERATORS}))[ \t]+-(?=[ \t]+\S)`,
    // A sign after an operator read as a word, with spaces between them, before its follower.
    String.raw`(?=[-\u2212])(?<=\S[ \t]+(?:${SPACED_OPERATORS})[ \t]+)${OPERATOR_SIGN}`,
    // A sign straight after `=` read between two non-space characters, or at a word's start.
    String.raw`(?=[-\u2212])(?<=[^\s=!<>]=)${OPERATOR_SIGN}`,
    String.raw`(?<![\p{L}\p{N}\p{M}])${SIGN}`,
    String.raw`(?<=\p{N}[ \t]?)%`,
    String.raw`(?<=\p{N})[.:](?=\p{N})`,
    String.raw`(?<=\p{L})\.(?=\p{L})`,
  ].join("|"),
  "gu",
);
const SYMBOL_WORDS: Record<string, string> = {
  "->": "to",
  "=>": "to",
  "<=": "less than or equal to",
  ">=": "greater than or equal to",
  "===": "equals",
  "!==": "not equals",
  "!=": "not equals",
  "==": "equals",
  "=": "equals",
  "/": "slash",
  "\\": "slash",
  "@": "at",
  "&": "and",
  "+": "plus",
  "<": "less than",
  ">": "greater than",
};

/** Sentence punctuation, kept at a word's end. */
const SENTENCE_MARKS = ".,!?;:";
/** Apostrophes and quotation marks, kept wherever they stand. */
const QUOTES = "'\"‘’“”";
/** What may follow sentence punctuation before the word's end: more of it, a quote or a closer. */
const TRAILING = `${SENTENCE_MARKS}${QUOTES})]}`;
/** A line that ends a sentence already, so its line break adds no period. */
const PUNCTUATED_LINE = /[.,!?;:]['"’”]*$/u;

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);
const isMark = (char: string | undefined): boolean => char !== undefined && /\p{M}/u.test(char);
const isSpace = (char: string | undefined): boolean => char === undefined || /\s/u.test(char);

/** A count and its noun, the singular for one: `1 line`, `2 lines`. */
const counted = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
/**
 * The speech-only check on a fenced code block small enough to be read, beside the shared secret
 * screen. It names a block holding a credential-named key, which may close with a quote and a
 * bracket, with a value after `:` or `=`; a `PIN` or `OTP` with digits, quoted or bare; a full key
 * word from a closed list, such as `password`, `token` or `authorization`, at a word's start, with
 * any suffix of word characters and dashes, and a value after spaces; a dashed flag naming a
 * credential with a value after a space; a `-u`, `--user` or `--username` flag with a user, a colon
 * and a password, or a user, a `%` and a password; a URL carrying a password with or without a
 * user; or an unbroken run of 20 or more letters, digits, `_` and `-` holding a digit. A plural
 * `tokens` or `keys` with a number alone after it is a count, so `max_tokens=200` is read. A value
 * after a short flag, such as mysql's `-p`, joined or spaced, is not named, since `-p` is common in
 * ordinary commands. It is a list of shapes, so a credential in another shape is read. It is wider
 * than the shared screen on purpose: a miss here sends a credential to the speech vendor, and a
 * false match only names a one-line block in place of reading it. The shared screen stays narrow,
 * since its match also refuses the classifier call and keeps a line out of memory.
 *
 * The runs of name characters around a key word and of a user name are bounded at 64, and a URL's
 * password at 256, since many starts can share one such run. A run of spaces, or of a long token's
 * characters, is reached from a bounded number of starts, so the search stays linear in the text's
 * length.
 */
const SPOKEN_CODE_SCREEN = new RegExp(
  [
    // A key name, `passphrase`, `secrets`, `GITHUB_TOKEN_PROD` and `password-prod` among them, a
    // closing quote and bracket, as in `config['password']`, then `:` or `=` and a value. `pw`,
    // `cred` and `pswd` are short, so each needs no letter before it.
    String.raw`(?:pass[\w-]{0,64}|pwd|secret[\w-]{0,64}|token(?!s(?![\w-]))[\w-]{0,64}|key(?!s(?![\w-]))[\w-]{0,64}|auth[\w-]{0,64}|credential[\w-]{0,64}|(?<![a-z])(?:pw|cred|pswd))["']?\]?\s*[:=]\s*\S`,
    // A plural `tokens` or `keys` with a value that is not a number alone.
    String.raw`(?:token|key)s["']?\]?\s*[:=]\s*(?!\d+\b)\S`,
    // A `PIN` or `OTP`, then a digit, quoted or bare.
    String.raw`(?<![a-z])(?:pin|otp)["']?\s*[:=]\s*["']?\d`,
    // A full key word at a word's start, `SECRET_KEY` and `api-key` among them, then spaces and a
    // value. A plural `tokens` is a count, not a key word.
    String.raw`(?<![a-z0-9])(?:pass(?:word|wd|code|phrase)|pswd|secret|api[_-]?key|token(?!s(?![\w-]))|credentials?|authorization)[\w-]{0,64}[^\S\r\n]+\S`,
    // A flag of one or two dashes whose name holds a key word, then a space and a value.
    String.raw`(?<![\w-])--?[\w-]{0,64}?(?:pass|pwd|pw|secret|token|key|auth|credential|pin)[\w-]{0,64}[^\S\r\n]+\S`,
    // A user flag, `-u` spaced or joined, or `--user` or `--username` after spaces or `=`, then a
    // user of up to 64 characters, a colon and a password, or smbclient's user of up to 64
    // characters, bare, or quoted with the `%` inside the quotes, then `%` and a password. A
    // quoted user holding a space whose quote closes before the `%`, a bare user holding a quote,
    // and a bare user opening with `+` are not named; the last keeps `date -u +%Y` read.
    String.raw`(?<![\w-])(?:-u[^\S\r\n]*|--user(?:name)?(?:[^\S\r\n]+|=))(?:[^\s:]{1,64}:|["'][^"'%\r\n]{1,64}%|["']?[^\s%:'"+][^\s%:'"]{0,63}["']?%)\S`,
    // A URL's password, which may hold a slash, before its `@`.
    String.raw`:\/\/[^\s/@:]*:[^\s@]{1,256}@`,
    String.raw`(?<![A-Za-z0-9_-])(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{20,}`,
  ].join("|"),
  "i",
);

/** What a block over its limit is spoken as: its kind and size, and where it is. */
const named = (kind: string, size: string): string => `a ${kind} of ${size} is in the thread`;

/** Whether `line` closes a fence opened by `length` backticks. */
function closesFence(line: string, length: number): boolean {
  const close = FENCE_CLOSE.exec(line);
  return close !== null && close[1].length >= length;
}

/**
 * The end of the first run of at least `length` backticks in `line` from `from`, and where it
 * starts. Undefined where there is none. Each character is looked at once.
 */
function closingRun(line: string, from: number, length: number): { start: number; end: number } | undefined {
  let at = from;
  while (at < line.length) {
    if (line[at] !== "`") {
      at += 1;
      continue;
    }
    const start = at;
    while (at < line.length && line[at] === "`") at += 1;
    if (at - start >= length) return { start, end: at };
  }
  return undefined;
}

/**
 * A line's spoken text, built from pieces: a space goes between two pieces where a letter or digit
 * would touch another. Each piece is looked at once, so a line of many pieces is built in one pass.
 */
function spokenLine(): { add: (piece: string) => void; blank: () => boolean; text: () => string } {
  const pieces: string[] = [];
  let last: string | undefined;
  let blank = true;
  return {
    add: (piece) => {
      if (piece === "") return;
      if (isWordChar(last) && isWordChar(piece[0])) pieces.push(" ");
      pieces.push(piece);
      last = piece.at(-1);
      if (blank && piece.trim() !== "") blank = false;
    },
    blank: () => blank,
    text: () => pieces.join(""),
  };
}

/**
 * Rule 1, fenced code. A block is read where its lines that are not blank number at most `limit`:
 * the lines between its fences, or a one-line block's text, go on to the later rules as text. A
 * larger block is named by that count in one sentence, after the prose that stood before its
 * opening run, so inside a list it is a continuation line or the item itself. A one-line block's
 * code or sentence stays on its line, between the prose before it and the prose after it, so a
 * list marker before it still makes that line an item. A read multi-line block's lines are marked
 * as code; only a block with nothing but whitespace before its opening run is read. A read
 * one-line block with only indentation before it is marked as code too. A code line is never
 * a list item or a table line. Where a letter or digit of the prose would touch one of the code or
 * the sentence, a space parts them. A block the secret screen or the speech-only check matches is
 * named whatever its size, so none of its text is spoken; a one-line block is checked with the whole
 * of its line. An indented block with no fence is not a code block.
 */
function readFencedCode(text: string, limit: number): BlockLines {
  const lines = text.split(LINE_BREAK);
  const out: BlockLines = { lines: [], code: [] };
  const clean = (block: string): boolean => !SECRET_SCREEN.test(block) && !SPOKEN_CODE_SCREEN.test(block);
  const push = (line: string, code: boolean): void => {
    out.lines.push(line);
    out.code.push(code);
  };
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    at += 1;
    // What the line is spoken as so far, and whether it opened with a read one-line block.
    const head = spokenLine();
    let headCode = false;
    // Whether the whole line passes both checks, found once, at its first one-line block in the limit.
    let lineClean: boolean | undefined;
    let from = 0;
    let done = false;
    while (!done) {
      OPENING_RUN.lastIndex = from;
      const open = OPENING_RUN.exec(line);
      if (open === null) {
        head.add(line.slice(from));
        push(head.text(), headCode);
        break;
      }
      head.add(line.slice(from, open.index));
      const length = open[0].length;
      const close = closingRun(line, open.index + length, length);
      if (close !== undefined) {
        const code = line.slice(open.index + length, close.start);
        const size = code.trim() === "" ? 0 : 1;
        if (size <= limit && limit > 0 && (lineClean ??= clean(line))) {
          if (head.blank()) headCode = true;
          head.add(code);
        } else head.add(named("code block", counted(size, "line")));
        from = close.end;
        continue;
      }
      // A block over lines, through its closing fence or, with none, to the text's end. Where the
      // pairing is unclear it runs to the text's end, so a later real block is named with it and
      // never read as prose. The pairing is clear only for an opening run with nothing but
      // whitespace before it on the line and at most one word after it; a list marker, quote mark,
      // letter, digit or symbol before it, or prose after it, makes it unclear. So does a line
      // inside the block holding a run as long as the opener's but more than a bare fence. A block
      // whose pairing is unclear is named whatever its size, so no text after it is read.
      const info = line.slice(open.index + length).trim();
      let unclear = line.slice(0, open.index).trim() !== "" || INFO_BREAK.test(info);
      let end = unclear ? lines.length : at;
      const run = "`".repeat(length);
      while (end < lines.length && !closesFence(lines[end], length)) {
        if (lines[end].includes(run)) {
          unclear = true;
          end = lines.length;
        } else end += 1;
      }
      const closed = end < lines.length;
      const code = lines.slice(at, end);
      const size = code.filter((codeLine) => codeLine.trim() !== "").length;
      if (!unclear && size <= limit && limit > 0 && clean([line, ...lines.slice(at, closed ? end + 1 : end)].join("\n"))) {
        if (!head.blank()) push(head.text(), headCode);
        for (const codeLine of code) push(codeLine, true);
      } else {
        head.add(named("code block", counted(size, "line")));
        push(head.text(), headCode);
      }
      at = closed ? end + 1 : end;
      done = true;
    }
  }
  return out;
}

/** A table line's cells: its text split on pipes, a leading and a trailing pipe ignored. */
function cells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

/**
 * Rule 1, tables. A table is a header line holding a pipe, a delimiter line under it, and one or
 * more body lines each holding a pipe, ending at the first line with none. Its columns are the
 * header's cells and its size is its body lines times its columns. Within `limit` it is read one
 * body line to a sentence, each cell as its column's header then its value: a cell that is missing
 * or empty is skipped, and one past the header's count is read with no header. A larger table is
 * named by its rows and columns, with the header's indentation. A code line is no part of a table.
 * Each line is looked at a fixed number of times.
 */
function readTables(blocks: BlockLines, limit: number): BlockLines {
  const { lines, code } = blocks;
  const out: BlockLines = { lines: [], code: [] };
  const piped = (index: number): boolean => index < lines.length && !code[index] && lines[index].includes("|");
  let at = 0;
  while (at < lines.length) {
    const delimiter = lines[at + 1];
    const table =
      piped(at) &&
      delimiter !== undefined &&
      !code[at + 1] &&
      delimiter.includes("-") &&
      TABLE_DELIMITER.test(delimiter) &&
      piped(at + 2);
    if (!table) {
      out.lines.push(lines[at]);
      out.code.push(code[at]);
      at += 1;
      continue;
    }
    const header = cells(lines[at]);
    let end = at + 2;
    while (piped(end)) end += 1;
    const rows = end - (at + 2);
    if (rows * header.length <= limit) {
      for (const line of lines.slice(at + 2, end)) {
        const pairs = cells(line)
          .map((cell, column) => (cell === "" ? "" : `${header[column] ?? ""} ${cell}`.trim()))
          .filter((pair) => pair !== "");
        out.lines.push(pairs.join(", "));
        out.code.push(false);
      }
    } else {
      const indentation = INDENTATION.exec(lines[at])?.[0] ?? "";
      out.lines.push(`${indentation}${named("table", `${counted(rows, "row")} and ${counted(header.length, "column")}`)}`);
      out.code.push(false);
    }
    at = end;
  }
  return out;
}

/**
 * Rule 1, lists. An item is a line opening with a list marker after any indentation. A list is a
 * run of items with their continuation lines, and one blank line before an item stays inside the
 * run. Within `limit` items it goes on unchanged, so each item is read as a sentence. A longer list
 * is named by its item count. A code line is never an item, and an indented one is a continuation.
 */
function readLists(blocks: BlockLines, limit: number): string {
  const { lines, code } = blocks;
  const out: string[] = [];
  const item = (index: number): boolean => index < lines.length && !code[index] && LIST_ITEM.test(lines[index]);
  let at = 0;
  while (at < lines.length) {
    if (!item(at)) {
      out.push(lines[at]);
      at += 1;
      continue;
    }
    let items = 0;
    let end = at;
    while (end < lines.length) {
      if (item(end)) items += 1;
      else if (lines[end].trim() === "" && item(end + 1)) {
        // One blank line with an item under it: the run goes on.
      } else if (!INDENTED.test(lines[end])) break;
      end += 1;
    }
    // One push per line, since a run can be longer than a call's argument list may be.
    if (items <= limit) for (let line = at; line < end; line += 1) out.push(lines[line]);
    else out.push(named("list", counted(items, "item")));
    at = end;
  }
  return out.join("\n");
}

/** Rule 2: markdown marks are dropped, and a link keeps its text. */
function dropMarkdown(text: string): string {
  return text
    .replace(QUOTE_MARKS, "$1")
    .replace(HEADING_MARKS, "$1")
    .replace(LIST_MARKER, "$1")
    .replace(LINK, "$1")
    .replaceAll("`", "")
    .replace(STAR_EMPHASIS, "$2")
    .replace(UNDERSCORE_EMPHASIS, "$2");
}

/** Rule 3: identifiers are split into words. */
function splitIdentifiers(text: string): string {
  return text
    .replace(UNDERSCORED, (word) =>
      /[\p{L}\p{N}]/u.test(word)
        ? word
            .split("_")
            .filter((part) => part !== "")
            .map((part) => part.toLowerCase())
            .join(" ")
        : word,
    )
    .replace(CAMEL_STEP, (_step, lower: string, upper: string, next: string | undefined) =>
      // A capital opening a lowercase run is a word's first letter and is lowercased with it; one
      // opening a run of capitals is kept, so the voice spells the run.
      next === undefined ? `${lower} ${upper}` : `${lower} ${upper.toLowerCase()}`,
    )
    .replace(CAPITALS, (word) => word.toLowerCase());
}

/** Rule 4: a symbol with a spoken name is read as it. */
function readSymbols(text: string): string {
  return text.replace(READ_AS_WORD, (symbol, unspaced: string | undefined, offset: number) => {
    // An unspaced comparison goes on as symbols rule 5 drops. Its `!` goes on as `=`, so it is
    // dropped with the pair rather than kept as sentence punctuation.
    if (unspaced !== undefined) return unspaced.replace("!", "=");
    const after = text[offset + symbol.length];
    // Only a space, a quote, a closer or sentence punctuation may stand straight after `percent`.
    if (symbol === "%") {
      const closes =
        after === undefined || /[\s)\]}]/.test(after) || QUOTES.includes(after) || SENTENCE_MARKS.includes(after);
      return closes ? " percent" : " percent ";
    }
    // A sign, and the decimal point read with it.
    if (/^[-\u2212][ \t]*\.?$/u.test(symbol)) return symbol.endsWith(".") ? "minus point " : "minus ";
    // The spaced lone dash, its spaces before it with it, so the comma lands on the word before.
    if (/^[ \t]+-$/.test(symbol)) return ",";
    if (symbol === ":") return " ";
    if (symbol === ".") return /\p{N}/u.test(text[offset - 1]) ? " point " : " dot ";
    // Sentence punctuation after the symbol stays against the word, as it would after any word.
    return SENTENCE_MARKS.includes(after) ? ` ${SYMBOL_WORDS[symbol]}` : ` ${SYMBOL_WORDS[symbol]} `;
  });
}

/**
 * Which characters stay under rule 5: a letter, a digit, whitespace, a quote, a mark on a letter
 * or digit, sentence punctuation at a word's end, or a hyphen between two letters or two digits.
 * Each character is decided once, with its context carried by passes over the text, never a
 * search from each character.
 */
function keptChars(chars: readonly string[]): boolean[] {
  const letters = /\p{L}/u;
  const digits = /\p{N}/u;
  // Every character but sentence punctuation is decided by its neighbours alone, marks left to right.
  const kept: Array<boolean | undefined> = new Array<boolean | undefined>(chars.length);
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const before = chars[index - 1];
    const after = chars[index + 1];
    if (isWordChar(char) || isSpace(char) || QUOTES.includes(char)) kept[index] = true;
    else if (isMark(char)) kept[index] = isWordChar(before) || (isMark(before) && kept[index - 1] === true);
    else if (SENTENCE_MARKS.includes(char)) kept[index] = undefined;
    else if (char === "-") {
      kept[index] =
        before !== undefined &&
        after !== undefined &&
        ((letters.test(before) && letters.test(after)) || (digits.test(before) && digits.test(after)));
    } else kept[index] = false;
  }
  // True where only trailing punctuation and dropped symbols lie between here and whitespace or the
  // text's end, so `done.` keeps its stop when an emoji follows it.
  const atWordEnd: boolean[] = new Array<boolean>(chars.length + 1);
  atWordEnd[chars.length] = true;
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index];
    const passable = TRAILING.includes(char) || kept[index] === false;
    atWordEnd[index] = isSpace(char) || (passable && atWordEnd[index + 1]);
  }
  return kept.map((decided, index) => decided ?? atWordEnd[index + 1]);
}

/**
 * Rule 5: every other symbol is dropped, a line not ending in punctuation with words on a later
 * line is closed with a period, and the whitespace collapses to single spaces. A run of dropped
 * symbols between a non-space character and a letter or digit leaves a space, so `word—word` reads
 * as two words, except a thousands separator: a lone comma after a digit with exactly three digits
 * after it, so `1,000` reads `1000` while `1,2` reads `1 2`.
 */
function dropSymbols(text: string): string {
  const chars = Array.from(text);
  const kept = keptChars(chars);
  const digits = /\p{N}/u;
  let out = "";
  let index = 0;
  while (index < chars.length) {
    if (kept[index]) {
      out += chars[index];
      index += 1;
      continue;
    }
    const start = index;
    while (index < chars.length && !kept[index]) index += 1;
    const before = chars[start - 1];
    const after = chars[index];
    // A thousands separator: one comma after a digit with exactly three digits after it.
    const separator =
      index - start === 1 &&
      chars[start] === "," &&
      before !== undefined &&
      digits.test(before) &&
      [0, 1, 2].every((step) => chars[index + step] !== undefined && digits.test(chars[index + step])) &&
      !(chars[index + 3] !== undefined && digits.test(chars[index + 3]));
    if (!separator && !isSpace(before) && isWordChar(after)) out += " ";
  }
  const lines = out.split(/\r?\n/);
  let lastWithWords = lines.length - 1;
  while (lastWithWords >= 0 && lines[lastWithWords].trim() === "") lastWithWords -= 1;
  return lines
    .map((line, at) => {
      const trimmed = line.trimEnd();
      return at >= lastWithWords || trimmed.trim() === "" || PUNCTUATED_LINE.test(trimmed) ? line : `${trimmed}.`;
    })
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The spoken form of `text`: the rules above, in order, one pass each. */
export function spokenForm(text: string, limits: ReadLimits): string {
  const fenced = readFencedCode(text, limits.codeLines);
  const blocks = readLists(readTables(fenced, limits.tableCells), limits.listItems);
  return dropSymbols(readSymbols(splitIdentifiers(dropMarkdown(blocks))));
}
