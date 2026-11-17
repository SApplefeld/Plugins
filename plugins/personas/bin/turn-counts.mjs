/**
 * turn-counts.mjs: the turns in one session transcript, and what each did.
 *
 * countTurns takes a transcript's text and returns one object per turn,
 * each holding counts, a model id of the model-id shape, an effort value of
 * the effort shape, a version token and a start time, and nothing else. No
 * prompt text, reply text, thinking text, tool name, tool input or path
 * reaches a turn, since a caller prints what it returns about other
 * sessions. The module reads no file, writes nothing and prints nothing.
 *
 * It also holds the shape checks those values are read by: isModelId,
 * versionToken, LINE_TERMINATOR, LANDING_BUILD_CHARS, isEffortValue and
 * isStartTime, and EFFORT_NONE, the effort a turn carries where no reply in
 * it recorded one. upgrade-check.mjs imports them from here. This module
 * imports nothing of upgrade-check.mjs, so the two make no cycle.
 *
 * The reading rules:
 *
 * - The text is split on line feeds alone, since a record is one LF-ended
 *   line and a JSON string may hold a raw LINE SEPARATOR. A line that is not
 *   JSON, a record that is not an object, and a record with isSidechain true
 *   are passed over.
 * - A turn opens at a user record carrying prompt text and no tool result.
 *   Prompt text is a string message.content of one character or more, or the
 *   text blocks, joined, of an array message.content holding no tool_result
 *   block. A user record with isMeta true opens a turn only where its text
 *   opens with "<channel" after any leading white space.
 * - A user record with isCompactSummary true, or whose text opens with
 *   "[LAUNCH INSTRUCTIONS REPEATED]", is a continuation. It opens a turn only
 *   where none has opened yet. After that it opens none, and the newest turn
 *   is running again.
 * - A queued message, an attachment record of type queued_command, joins the
 *   newest turn where that turn has not ended, and opens a turn otherwise.
 * - A turn has ended once an assistant record in it carries reply text: a
 *   text block holding a character other than white space. It is running
 *   again once a tool_use block or a user record carrying a tool result
 *   follows.
 * - A tool call is counted once by its id across the whole transcript, so a
 *   tool_use block repeating an id already counted, or carrying none, adds
 *   to no count, though it still sets an ended turn running again.
 * - The model and the effort are read only from an assistant record whose
 *   model is of the model-id shape, so a <synthetic> record changes neither.
 * - An assistant record before the first turn is passed over.
 */

// Where one line of text ends, as hooks/operator.ts reads it: CRLF, or any
// one of LF, CR, VT, FF, NEL, LINE SEPARATOR or PARAGRAPH SEPARATOR.
// upgrade-check.mjs folds command output on it before that output reaches a
// table cell or a printed line, since a splitter that knows only LF and CR
// leaves five more characters that start a line the reader will see.
export const LINE_TERMINATOR = /\r\n|[\n\r\v\f\u{85}\u{2028}\u{2029}]/u;

// The longest session build a transcript may report. A longer token reads as
// unknown, so the one free-text value a transcript passes out stays short.
export const LANDING_BUILD_CHARS = 32;

// The model-id shape: 1 to 80 characters, each a lowercase letter, a digit, a
// dot, a hyphen or a square bracket, the first a letter or a digit. A model
// value read from a transcript reaches standard output, a row and the table
// only where it has this shape, so no space, uppercase letter, slash, quote or
// line terminator a transcript holds can ride out under a model's name.
const MODEL_ID_SHAPE = /^[a-z0-9][a-z0-9.[\]-]{0,79}$/;
export function isModelId(value) {
  return typeof value === 'string' && MODEL_ID_SHAPE.test(value);
}

// The effort shape: one to sixteen lowercase letters. An effort value read
// from a transcript leaves it only where it has this shape, so it holds no
// space, no '=' and no square bracket.
const EFFORT_SHAPE = /^[a-z]{1,16}$/;
export function isEffortValue(value) {
  return typeof value === 'string' && EFFORT_SHAPE.test(value);
}

// The version a build reports: the first token of `claude --version`, which
// prints "<version> (Claude Code)". The whole line stays in the evidence.
// The token names the scratch folder, so one carrying anything outside
// letters, digits, '_', '.', '+' and '-' reads as unknown rather than
// reaching a path.
export function versionToken(line) {
  const first = String(line || '').split(LINE_TERMINATOR)[0] || '';
  const token = first.trim().split(/\s+/)[0] || '';
  return /^[\w.+-]+$/.test(token) ? token : 'unknown';
}

// A turn's start time: a timestamp of this form and no other, so a start
// holds only digits, hyphens, colons, a dot, 'T' and 'Z'.
const START_SHAPE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/;
export function isStartTime(value) {
  return typeof value === 'string' && START_SHAPE.test(value);
}
// The effort a turn carries where no reply in it recorded one.
export const EFFORT_NONE = '(none)';
// The name a reply-tool call's tool ends with.
const REPLY_TOOL_SUFFIX = 'channel-relay__reply';
// The tool names that start a subagent.
const AGENT_TOOLS = new Set(['Agent', 'Workflow']);
const LAUNCH_REPEATED = '[LAUNCH INSTRUCTIONS REPEATED]';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasNonSpace = (value) => typeof value === 'string' && /\S/.test(value);

// Whether a user record's content carries a tool result.
function hasToolResult(content) {
  return Array.isArray(content) && content.some((block) => isObject(block) && block.type === 'tool_result');
}

// A user record's prompt text, or '' where it carries none or carries a tool
// result. The text is read here only to decide whether a turn opens, and it
// never reaches a turn.
function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || hasToolResult(content)) return '';
  return content.filter((block) => isObject(block) && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
}

// A new turn's working state. Only what finish() copies out leaves it.
function openTurn(record) {
  return {
    start: isStartTime(record.timestamp) ? record.timestamp : '',
    tools: 0,
    quietText: 0,
    quietUpdate: 0,
    replies: 0,
    agents: 0,
    runText: 0,
    runUpdate: 0,
    ended: false,
    models: new Set(),
    efforts: new Set(),
    version: '',
  };
}

// The turn as returned: counts and values of a closed shape only.
function finish(turn) {
  const build = turn.version ? versionToken(turn.version) : 'unknown';
  return {
    start: turn.start,
    tools: turn.tools,
    quietText: turn.quietText,
    quietUpdate: turn.quietUpdate,
    replies: turn.replies,
    agents: turn.agents,
    model: turn.models.size === 1 ? [...turn.models][0] : '',
    effort: turn.efforts.size === 1 ? [...turn.efforts][0] : turn.efforts.size === 0 ? EFFORT_NONE : '',
    build: build.length > LANDING_BUILD_CHARS ? 'unknown' : build,
  };
}

// One assistant record's content blocks, read into the turn. A tool_use block
// is counted once by its id, and one with no id is not counted.
function readBlocks(turn, content, seen) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === 'text' && hasNonSpace(block.text)) {
      turn.ended = true;
      turn.runText = 0;
      turn.runUpdate = 0;
    } else if (block.type === 'thinking' && hasNonSpace(block.thinking)) {
      turn.runUpdate = 0;
    } else if (block.type === 'tool_use') {
      turn.ended = false;
      if (typeof block.id !== 'string' || !block.id || seen.has(block.id)) continue;
      seen.add(block.id);
      turn.tools += 1;
      turn.runText += 1;
      turn.runUpdate += 1;
      turn.quietText = Math.max(turn.quietText, turn.runText);
      turn.quietUpdate = Math.max(turn.quietUpdate, turn.runUpdate);
      const name = typeof block.name === 'string' ? block.name : '';
      if (name.endsWith(REPLY_TOOL_SUFFIX) && isObject(block.input) && hasNonSpace(block.input.message)) turn.replies += 1;
      if (AGENT_TOOLS.has(name)) turn.agents += 1;
    }
  }
}

/**
 * The turns in one transcript's text, oldest first, by the reading rules in
 * this file's header. It never throws on a string, and returns an empty array
 * where no turn opens.
 * @param {string} text
 * @returns {{start: string, tools: number, quietText: number, quietUpdate: number, replies: number, agents: number, model: string, effort: string, build: string}[]}
 */
export function countTurns(text) {
  const turns = [];
  const seen = new Set();
  let turn = null;
  const open = (record) => {
    turn = openTurn(record);
    turns.push(turn);
  };
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (!isObject(o) || o.isSidechain === true) continue;
    const message = isObject(o.message) ? o.message : null;
    if (o.type === 'user') {
      const content = message ? message.content : undefined;
      if (hasToolResult(content)) {
        if (turn) turn.ended = false;
      } else {
        const prompt = promptText(content);
        if (o.isCompactSummary === true || prompt.startsWith(LAUNCH_REPEATED)) {
          if (turn) turn.ended = false;
          else open(o);
        } else if (o.isMeta === true) {
          if (prompt.trimStart().startsWith('<channel')) open(o);
        } else if (prompt.length > 0) {
          open(o);
        }
      }
    } else if (o.type === 'attachment' && isObject(o.attachment) && o.attachment.type === 'queued_command') {
      if (!turn || turn.ended) open(o);
    } else if (o.type === 'assistant' && turn) {
      // A record whose model is not of the model-id shape, <synthetic> among
      // them, names neither label, so its effort is not read either.
      if (message && isModelId(message.model)) {
        turn.models.add(message.model);
        if (isEffortValue(o.effort)) turn.efforts.add(o.effort);
      }
      if (message) readBlocks(turn, message.content, seen);
    }
    if (turn && typeof o.version === 'string' && o.version) turn.version = o.version;
  }
  return turns.map(finish);
}
