// The spoken form of a line: the words a voice can say for text written to be read. Setting names,
// file paths, symbols, code and markup are turned into plain words by fixed rules, so the voice
// says "channel voice max spoken words equals 300" where the thread reads
// `CHANNEL_VOICE_MAX_SPOKEN_WORDS=300`. Only the copy sent to the speech service is rewritten, so
// a session's reply keeps the text as written in the thread, the ring and the hand-off to the
// session.
//
// The rules run in a fixed order, one pass each: fenced code, then markdown marks, then
// identifiers, then symbols read as words, then every other symbol dropped and the whitespace
// collapsed. A one-line sentence of lowercase or initial-capital words with no symbol, with single
// spaces and no leading or trailing whitespace, reads back unchanged. Numbers stay as digits. The
// function is pure and takes any string without throwing.

/** What a fenced code block is spoken as. */
const CODE_BLOCK = "code in the thread";

/**
 * Rule 1. A line opening with three backticks, through the next such line or the end of the text,
 * is one fenced block. The line breaks around it stay, so it is spoken as a sentence of its own.
 */
const FENCED = /^[ \t]*```[^\r\n]*(?:\r?\n[\s\S]*?^[ \t]*```[^\r\n]*$|[\s\S]*)/gm;

/**
 * Rule 2's marks at a line's start: block quotes, then a heading's `#` marks, then a list marker.
 * A numbered marker has one or two digits, so a year ending a sentence at a line's start stays.
 */
const QUOTE_MARKS = /^([ \t]*)(?:>[ \t]?)+/gm;
const HEADING_MARKS = /^([ \t]*)#{1,6}[ \t]+/gm;
const LIST_MARKER = /^([ \t]*)(?:[-*+]|\d{1,2}\.)[ \t]+/gm;
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

/** Rule 1: each fenced block becomes the words that say where the code is. */
function dropFencedCode(text: string): string {
  return text.replace(FENCED, CODE_BLOCK);
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
export function spokenForm(text: string): string {
  return dropSymbols(readSymbols(splitIdentifiers(dropMarkdown(dropFencedCode(text)))));
}
