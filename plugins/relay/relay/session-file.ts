// The readers of the session the relay serves, from one of two sources. A starter that is not
// Claude Code names the session in the relay's environment, as `CHANNEL_SESSION_ID` and
// `CHANNEL_SESSION_CWD` beside the process token. Where `CHANNEL_SESSION_ID` is absent, the relay
// reads Claude Code's per-process session file instead.
//
// Claude Code writes one file for each running `claude` process, `<pid>.json` in the `sessions`
// folder under `.claude` in the home directory. It is undocumented, and any program running as the
// same account can write it, the model's own file tools among them. So the read is bounded and
// judges shape alone: whether the session id is well formed and whether the folder may bound a
// reply's file are the broker's to decide. The variables are judged by the same bounds. Nothing
// here names any other file in that folder, and nothing is kept between reads.
import fs from "node:fs";
import path from "node:path";

/** The largest session file that is read. A larger one is refused on its size, before any content. */
export const MAX_SESSION_FILE_BYTES = 65_536;

/** The longest session id and the longest folder carried, in JavaScript's string length. */
const MAX_SESSION_ID_LENGTH = 200;
const MAX_FOLDER_LENGTH = 1024;

/** A control character: C0, DEL and C1. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/** The shape `CHANNEL_CLAUDE_PID` must have to be used: one to ten digits with no leading zero. */
const PROCESS_ID = /^[1-9][0-9]{0,9}$/;

/**
 * Why a read returned no session, a closed list. The first five are the session file's and the last
 * is the variables'. Each is safe to log: none holds any of the file or the variable.
 */
export type SessionFileRefusal =
  | "no file"
  | "file too large"
  | "not a JSON object"
  | "pid mismatch"
  | "no session id"
  | "unusable session id variable";

/**
 * What one read came to: the session id, with the folder the session was launched in where the
 * source read, the session file or the starter's variables, holds a usable one, or the reason no
 * session was read.
 */
export type SessionFileRead = { sessionId: string; cwd?: string } | { reason: SessionFileRefusal };

/**
 * The process id whose session file the relay reads. The plugin's launcher passes the claude
 * process's id in `CHANNEL_CLAUDE_PID`, since the launcher stands between that process and the
 * relay. A relay registered directly is the claude process's own child, and so is one whose
 * variable is absent or not a process id, which takes its parent's id.
 */
export function claudeProcessId(value: string | undefined, parentProcessId: number): number {
  return value !== undefined && PROCESS_ID.test(value) ? Number(value) : parentProcessId;
}

/** Whether a field is a string of 1 to `maxLength` characters holding no control character. */
function isPlainText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength && !CONTROL_CHARACTER.test(value);
}

/**
 * The file's bytes, or the reason there are none to judge. The size is read from the open file
 * before any content, and no more than that size is read, so a file that grows behind the
 * measurement is still read no further than the bound.
 */
function boundedContent(file: string): Buffer | { reason: "no file" | "file too large" } {
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, "r");
  } catch {
    return { reason: "no file" };
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) return { reason: "no file" };
    if (stat.size > MAX_SESSION_FILE_BYTES) return { reason: "file too large" };
    const content = Buffer.alloc(stat.size);
    let filled = 0;
    while (filled < content.length) {
      const count = fs.readSync(descriptor, content, filled, content.length - filled, filled);
      if (count === 0) break;
      filled += count;
    }
    return content.subarray(0, filled);
  } catch {
    return { reason: "no file" };
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch {
      // A descriptor that will not close changes nothing about what was read.
    }
  }
}

/**
 * Reads the session file of the process `processId` in `sessionsFolder`. The rules run in order and
 * the first that fails ends the read: the file exists and is within the size bound, it holds a JSON
 * object, its `pid` is the process id asked for, and its `sessionId` is plain text within its
 * length. An unusable `cwd` fails nothing and is left out.
 */
export function readSessionFile(processId: number, sessionsFolder: string): SessionFileRead {
  const content = boundedContent(path.join(sessionsFolder, `${String(processId)}.json`));
  if (!Buffer.isBuffer(content)) return content;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    return { reason: "not a JSON object" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { reason: "not a JSON object" };
  const fields = parsed as Record<string, unknown>;

  // The file's own `pid` must agree with the name it was found under, so a file written under
  // another process's number is not taken for that process's.
  if (typeof fields.pid !== "number" || fields.pid !== processId) return { reason: "pid mismatch" };
  if (!isPlainText(fields.sessionId, MAX_SESSION_ID_LENGTH)) return { reason: "no session id" };
  if (!isPlainText(fields.cwd, MAX_FOLDER_LENGTH)) return { sessionId: fields.sessionId };
  return { sessionId: fields.sessionId, cwd: fields.cwd };
}

/**
 * Reads the session a starter named in `env`. `CHANNEL_SESSION_ID`, with the blanks at its ends
 * removed, must be plain text within a file's session id bound, or the read is refused, an empty or
 * blank value included. `CHANNEL_SESSION_CWD` is held to a file's folder bound as it stands, and an
 * absent or unusable one fails nothing and is left out.
 */
export function readSessionVariables(env: NodeJS.ProcessEnv): SessionFileRead {
  const sessionId = env.CHANNEL_SESSION_ID?.trim();
  if (!isPlainText(sessionId, MAX_SESSION_ID_LENGTH)) return { reason: "unusable session id variable" };
  const cwd = env.CHANNEL_SESSION_CWD;
  if (!isPlainText(cwd, MAX_FOLDER_LENGTH)) return { sessionId };
  return { sessionId, cwd };
}

/**
 * Reads the session the relay announces. Where `env` holds `CHANNEL_SESSION_ID`, usable or not, the
 * answer is the variables' and no file is opened, so a starter's mistake is a refusal and never
 * another session's id from a file left under a reused process number. Otherwise the session file of
 * `processId` is read from the folder `sessionsFolder` names, resolved only then. A folder that
 * cannot be resolved, as for an account with no home folder, reads as no file.
 */
export function readAnnouncement(env: NodeJS.ProcessEnv, processId: number, sessionsFolder: () => string): SessionFileRead {
  if ("CHANNEL_SESSION_ID" in env) return readSessionVariables(env);
  let folder: string;
  try {
    folder = sessionsFolder();
  } catch {
    return { reason: "no file" };
  }
  return readSessionFile(processId, folder);
}
