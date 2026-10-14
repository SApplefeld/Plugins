// text.ts: the plugin's one bound on a piece of free text, the mark a cut
// piece ends with, and two readers every file read shares: a caught error's
// message as untrusted text, and a file's text with its byte-order mark
// taken off. hooks/index.ts and hooks/fleet.ts both import them from here,
// so no second lane can pick a looser bound or a different reading.
//
// No `import $` and no side effects at load. hooks/decision-journal.ts
// declares a FREE_TEXT_MAX and a TEXT_CUT_MARK of its own for the journal's
// lines, and no module imports both.

import { bracketSafeText } from "./agent-state";

// The bound on one piece of free text this plugin carries between a file or a
// caller and a model: the note agentic_resolve writes into the shared commons
// store, which is refused when it runs longer, and the hold reason and the
// note fleet_status reads out of a run directory, which are cut at it. One
// value, so a second text lane cannot pick a looser bound by accident.
export const FREE_TEXT_MAX = 2000;

// The mark a cut piece of text ends with, so a caller reads a shortened
// reason as shortened rather than as the whole of it.
export const TEXT_CUT_MARK = " [cut at the bound]";

// A caught error's message as untrusted text: the string carries whatever the
// filesystem put in it, including a path a persona chose, so it is neutralized
// where it enters a note rather than where the note is finished.
export function safeErrorText(err: unknown): string {
  return bracketSafeText(err instanceof Error ? err.message : String(err));
}

// Free text held to FREE_TEXT_MAX, for a lane that cuts rather than refuses:
// nothing on the far side of a file read is there to shorten it and try again.
// The cut runs on the finished field, after the neutralization above has run on
// each untrusted piece in it, so the mark's own brackets are not turned round
// along with the text's and a shortened text says that it was shortened. The
// mark reaches a tool's caller as it is written here; the controller tick's
// fleet prompt neutralizes every field it splices, the mark among them, so a
// cut field reads "(cut at the bound)" there.
export function boundedText(text: string): string {
  return text.length <= FREE_TEXT_MAX ? text : text.slice(0, FREE_TEXT_MAX - TEXT_CUT_MARK.length) + TEXT_CUT_MARK;
}

// A byte-order mark leads a UTF-8 file written through PowerShell's own
// cmdlets - Set-Content -Encoding UTF8 under Windows PowerShell 5.1 writes one,
// which is how an operator hand-writes a file this plugin reads - and
// JSON.parse rejects one. The two files parsed as JSON are what need it: a
// marker's first line is trimmed instead, and U+FEFF is whitespace to
// ECMAScript, so trim() takes it off. The keeper's own state writer emits
// none, writing through UTF8Encoding($false) in bin/Start-Persona.ps1. Every
// keeper-side reader of the roster strips it (Get-Content -Encoding UTF8 does),
// so a roster the process keeper is running the fleet from must not read here
// as an unparseable file.
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
