// handover.ts: the hand-over note a session leaves for the next session of its
// persona, and the test that decides whether a fresh session is handed it.
//
// A session whose context has grown can end at a checkpoint and start fresh.
// The fresh session knows only its launch text and what the plugin puts beside
// it, so the session before it writes a note, in its own words, of what it was
// doing, what is on disk and where, and what comes next. The note lives in one
// file beside the persona's store, .agentic-handover.json, which each write
// replaces whole, so it is never a store and grows with nothing.
//
// The file is delivered once where the session that takes it records its own
// id in it. The next session's priming turn reads it, and it is handed over
// only where it names this persona, another session wrote it, it is less than
// HANDOVER_MAX_AGE_MS old, a restart was requested, no session has taken
// delivery of it, and it is no longer than HANDOVER_NOTE_MAX_CHARS. A note
// that fails one of the first five is a stale or foreign note, and reading it
// as the session's own state would put another session's or an old session's
// work in front of this one.
//
// No engine API and no clock: every fact arrives as an argument, so a second
// engine's adapter can use the same file and the same test.

import { stripBom } from "./text";

// The longest note the tool takes, in code points.
export const HANDOVER_NOTE_MAX_CHARS = 4000;

// A note's length as HANDOVER_NOTE_MAX_CHARS counts it, one per code point,
// a surrogate pair counting once as the string iterator counts it. The
// write's refusal and the delivery test both read it, so the two sides hold a
// note to one limit. It walks the string's code units and builds no array,
// so a note of any size costs no copy, and the count it reports in a refusal
// or a decision stays exact.
export function handoverNoteLength(note: string): number {
  let points = 0;
  for (let i = 0; i < note.length; i++) {
    const unit = note.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < note.length) {
      const next = note.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    points++;
  }
  return points;
}

// How old a note may be and still be handed over.
export const HANDOVER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// The one word `running` takes where nothing this session started still runs.
export const HANDOVER_RUNNING_NONE = "none";

// The file as written and read. `percent` is the fill the writing session last
// read, null where it had read none. `restartRequested` is false at the write,
// and the restart request sets it. `deliveredTo` is null at the write, and the
// session that takes delivery sets it to its own id.
export type HandoverNote = {
  persona: string;
  session: string;
  at: number;
  percent: number | null;
  note: string;
  running: string;
  restartRequested: boolean;
  deliveredTo: string | null;
};

// The refusal of one handover_write call, or null where the call may write.
// The checks run in the order the tool states them, so the first that fails
// names the refusal and nothing is written: under live, a restart request
// this session has saved, then the switch and the persona's claim, the state
// checks; then a scrub whose scan failed, an empty note, a note past the
// limit, and an empty `running`, the content checks. A call without
// `content` runs the state checks alone, so the caller scrubs the note only
// once the session's state lets it write, and then calls again with the
// scrubbed text. `withheld` is whether the scrub gave the redactor's withheld
// line for the note or for `running`, which is short and not the session's
// words, so it would pass every later check. After a saved request
// the session runs on until the supervisor stops it, and a write then would
// replace the note marked for that restart with one reading
// restartRequested false, which the next session would not take. Past the
// prompt hold's bound the mark is cleared and the session has made its one
// request, so no later note is read either, and the refusal stands.
// `restartRequested` is whether this session's restart request was saved or
// is being decided and saved.
export function handoverWriteRefusal(call: { mode: string; restartRequested: boolean; isOwner: boolean; content?: { note: string; running: string; withheld: boolean } }): string | null {
  if (call.mode === "live" && call.restartRequested) {
    return "handover_write refused: a session leaves no note once its checkpoint restart request is saved, and this session's request is saved or being decided.";
  }
  if (call.mode !== "live") {
    return `handover_write refused: this persona's checkpointRestart switch reads ${call.mode}, and a note is taken only under live.`;
  }
  if (!call.isOwner) {
    return "handover_write refused: this session does not hold its persona, so it leaves no note for the next one.";
  }
  const content = call.content;
  if (content === undefined) return null;
  if (content.withheld) {
    return "handover_write refused: the transcript redactor's scan of the note or of running failed, so nothing was written.";
  }
  if (content.note.trim() === "") {
    return "handover_write refused: the note is empty.";
  }
  const chars = handoverNoteLength(content.note);
  if (chars > HANDOVER_NOTE_MAX_CHARS) {
    return `handover_write refused: the note is ${chars} characters after redaction, past the limit of ${HANDOVER_NOTE_MAX_CHARS}.`;
  }
  if (content.running.trim() === "") {
    return `handover_write refused: running is empty. Name each process this session started that still runs, or the one word ${HANDOVER_RUNNING_NONE}.`;
  }
  return null;
}

// Whether a `running` statement says nothing this session started still runs.
// Only the one word passes, so any other text withholds a restart.
export function runningIsNone(running: string): boolean {
  return running.trim() === HANDOVER_RUNNING_NONE;
}

// The file's text for a note: one JSON object and a line break.
export function handoverFileText(note: HandoverNote): string {
  return JSON.stringify(note) + "\n";
}

// The file's text read as a note, or the reason it is not one. A field of the
// wrong type makes the whole file unreadable, so no partial note is handed on.
export function parseHandoverNote(text: string): HandoverNote | { problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch {
    return { problem: "is not JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { problem: "is not a JSON object" };
  const o = parsed as Record<string, unknown>;
  for (const field of ["persona", "session", "note", "running"]) {
    if (typeof o[field] !== "string") return { problem: `has no string ${field}` };
  }
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return { problem: "has no time" };
  if (o.percent !== null && (typeof o.percent !== "number" || !Number.isFinite(o.percent))) return { problem: "has a fill that is neither a number nor null" };
  if (typeof o.restartRequested !== "boolean") return { problem: "has no restartRequested flag" };
  if (o.deliveredTo !== null && typeof o.deliveredTo !== "string") return { problem: "has a deliveredTo that is neither a session id nor null" };
  return {
    persona: o.persona as string,
    session: o.session as string,
    at: o.at,
    percent: o.percent as number | null,
    note: o.note as string,
    running: o.running as string,
    restartRequested: o.restartRequested,
    deliveredTo: o.deliveredTo as string | null,
  };
}

// The note with its restart request recorded, or the reason the file is left
// as it is. A session that requests a checkpoint restart marks the note it
// wrote this turn, and only that note: one naming another persona or written
// by another session is not this session's to mark, and the next session then
// takes the recap's path. This function tests the persona and the session
// alone. The turn part holds because the rule's no-note condition passes only
// on a note written this turn, and only the session that owns the persona
// writes the file. The reason names the first test that failed and none of
// the note's words.
export function handoverRestartMarkOf(read: HandoverNote | { problem: string } | null, persona: string, sessionId: string): { note: HandoverNote } | { reason: string } {
  if (read === null) return { reason: "no file, or the file could not be read" };
  if ("problem" in read) return { reason: `the file ${read.problem}` };
  if (read.persona !== persona) return { reason: "the note names another persona" };
  if (read.session !== sessionId) return { reason: "another session wrote the note" };
  return { note: { ...read, restartRequested: true } };
}

// The note with its restart mark cleared, or the reason the file is left as
// it is: the same tests as handoverRestartMarkOf, with restartRequested set
// false and every other field, deliveredTo among them, as read. A session
// whose restart was not taken within the prompt hold's bound clears the mark
// on the note it wrote, since it works on past that point and the note would
// be a false account of it; a later start then takes the recap.
export function handoverRestartClearOf(read: HandoverNote | { problem: string } | null, persona: string, sessionId: string): { note: HandoverNote } | { reason: string } {
  const mark = handoverRestartMarkOf(read, persona, sessionId);
  return "reason" in mark ? mark : { note: { ...mark.note, restartRequested: false } };
}

export type HandoverDelivery =
  | { deliver: true; note: HandoverNote }
  | { deliver: false; reason: string; note: HandoverNote | null };

// Whether a fresh session is handed the note it read. `read` is the parsed
// file, its problem, or null where the file is absent or could not be read.
// The reason names the first test that failed and none of the note's words.
// A time ahead of `now` is not a time less than a day old, so such a note is
// not handed over either. A note past HANDOVER_NOTE_MAX_CHARS is not handed
// over, as handoverWriteRefusal refuses one, so the block it would fill stays
// bounded whoever wrote the file. The tool measures the note after its
// scrub, so a note it wrote is never past the limit here.
// "pending" is the id hooks/index.ts holds until the engine names the
// session, and keeps where it never does, so it names no session: a note
// whose writer and reader both read it was not shown to come from this
// session, and only a real id matching withholds the note.
export function handoverDeliveryOf(read: HandoverNote | { problem: string } | null, persona: string, sessionId: string, now: number): HandoverDelivery {
  if (read === null) return { deliver: false, reason: "no file, or the file could not be read", note: null };
  if ("problem" in read) return { deliver: false, reason: `the file ${read.problem}`, note: null };
  if (read.persona !== persona) return { deliver: false, reason: "the note names another persona", note: read };
  if (read.session === sessionId && sessionId !== "pending") return { deliver: false, reason: "this session wrote the note", note: read };
  const age = now - read.at;
  if (age < 0 || age >= HANDOVER_MAX_AGE_MS) return { deliver: false, reason: "the note is not from the last 24 hours", note: read };
  if (!read.restartRequested) return { deliver: false, reason: "no restart was requested", note: read };
  if (read.deliveredTo !== null) return { deliver: false, reason: "the note was already delivered", note: read };
  if (handoverNoteLength(read.note) > HANDOVER_NOTE_MAX_CHARS) return { deliver: false, reason: `the note is past the limit of ${HANDOVER_NOTE_MAX_CHARS} characters`, note: read };
  return { deliver: true, note: read };
}
