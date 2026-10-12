// Records why the broker died while its modules were still loading.
//
// install/Start-Broker.ps1 starts the broker as `node --import <this file's URL> broker/index.ts`.
// A failure to load broker/index.ts or anything it imports, such as a package missing from
// node_modules after a plugin update, happens before the broker's own logger exists, and the
// scheduled task has no console, so without this file the failure reaches nothing an operator
// reads. Here it becomes one line in the file CHANNEL_BROKER_LOG_FILE names, broker.log on an
// installed host, which is where install/Repair-Broker.ps1 sends the operator.
//
// The handlers are armed only until broker code runs: broker/index.ts's main block calls the
// disarm function published below as its first statement, and from then on the broker's own
// logging rules decide what reaches broker.log. So this path only ever sees a loading error, whose
// message names a module or a file, and no conversation content can reach the log through it,
// which docs/security-model.md requires of every line the broker log carries.
//
// Plain JavaScript, and nothing outside Node's own builtins: this runs exactly when the broker's
// dependencies may be missing, so it cannot depend on anything installed there.
import { appendFileSync, writeSync } from "node:fs";

/** The key the disarm function is published under, which broker/index.ts reads. */
const DISARM_KEY = Symbol.for("channels.startupCrashLog");

/**
 * The one line a load failure becomes, in broker/log.ts's line shape so it reads like the rest of
 * broker.log. Control characters are replaced with spaces so a message carrying a newline stays one
 * line and cannot forge a second one. The stack is left out: the code and message name what failed
 * to load, and a stack would spread one failure over many lines.
 */
function failureLine(error) {
  let code = "Error";
  let message = "";
  try {
    if (error !== null && typeof error === "object") {
      code = String(error.code ?? error.name ?? "Error");
      message = String(error.message ?? "");
    } else {
      code = typeof error;
      message = String(error);
    }
  } catch {
    // A thrown value whose fields cannot be read still ends the process with a line naming that.
    message = "the thrown value could not be described";
  }
  // The class broker/sanitize.ts's isInvisible strips, plus U+0085, U+2028 and U+2029, which a log
  // reader may take as line breaks. Inlined because this file cannot import TypeScript.
  const clean = `${code} ${message}`.replace(
    /[\u0000-\u001f\u007f\u0085\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}]/gu,
    " ",
  );
  return `${new Date().toISOString()} [error] broker: failed while loading: ${clean}\n`;
}

/** Writes the line to the log file and to stderr, then ends the process with 1. */
function onFailure(error) {
  const line = failureLine(error);
  const file = process.env.CHANNEL_BROKER_LOG_FILE?.trim();
  if (file) {
    try {
      appendFileSync(file, line, "utf8");
    } catch {
      // The line still goes to stderr below. A log that cannot be written changes nothing about
      // the exit.
    }
  }
  try {
    // Synchronous, so the line is out before the exit below. A task with no console may have no
    // usable stderr, which must not stop the exit either.
    writeSync(2, line);
  } catch {
    // Nothing further to report to.
  }
  process.exit(1);
}

process.on("uncaughtException", onFailure);
process.on("unhandledRejection", onFailure);

globalThis[DISARM_KEY] = {
  /** Removes both handlers, so a later failure takes Node's default path and the broker's own logging. */
  disarm() {
    process.off("uncaughtException", onFailure);
    process.off("unhandledRejection", onFailure);
  },
};
