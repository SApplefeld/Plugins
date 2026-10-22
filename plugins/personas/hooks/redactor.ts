// redactor.ts: the persona plugin's transcript redactor, a helper that
// hooks/index.ts imports. It keeps secrets out of the session transcript: a
// value a tool prints, a prompt carries, a context block holds or a subagent
// task quotes is swapped for a stable placeholder before the model reads it,
// and the real value comes back only inside one of six local tools, or an
// MCP tool the redactorRestoreTools setting names, in a call the store list
// does not name. A use line can still write somewhere off that list.
// Everything that decides what a secret is lives in ./redactor-detect.ts, the
// detector ported from the transcript-redactor mod; this file turns it into
// the plain steps index.ts runs inside its own handlers, at the events where
// text enters the conversation and at the tools where a placeholder must
// become real again.
//
// The plugin is one hooks module, so this file registers nothing and never
// sees `$`. Each export takes an event's fields, or the answer a handler's
// `next` returned, and gives back what the handler passes down or returns,
// with the count of values hidden where index.ts owes a notice. index.ts
// places the steps so that its guards and its bookkeeping see a tool call as
// the model wrote it, placeholders included, the tool receives the real value,
// and the handler reads the result once it is scrubbed. The refusal of a
// store surface runs first, before any guard answers.
//
// The shell rule on this engine, for Bash and PowerShell alike. A shell
// command is a restore tool, so a placeholder in its command becomes the
// real value before the shell runs, unless the command writes a store. A
// use line, one that sends the value to a host, such as a curl call with a
// key in its header or a gh secret set, is the use the redactor exists to
// allow: it receives the real value before it runs, and what it prints of
// that value comes back to the model hidden. A store line, one that writes
// text into a store that outlives the session, a memq record, a git commit,
// tag or note, a GitHub issue, draft issue, pull request, release, gist or
// discussion body, or a GitHub Actions variable, gets no restore, so a
// placeholder in it reaches the shell as the placeholder text, and where it
// carries a raw secret, one the vault knows or one the detector would hide,
// it is refused with the fixed sentence refusalFor builds. A use line is
// never refused: the model's call is in the transcript whether or not the
// tool runs, so refusing it keeps nothing out of the transcript and only
// blocks the use.
// A line is a store line when any word in it, read by its file name, is
// memq or memq.ps1, or a memq.js or memq-shim.js path, or when both words of
// a pair in STORE_WRITERS, the closed list exported below, stand somewhere
// in it: git with a verb that takes a message or a patch into history, and
// gh with a verb that takes a body into a host-side record, makes a raw API
// call that can write one, or sets a variable stored as plaintext. Every
// other line is a use line. The line is cut into words at whitespace,
// quotes, the shell operators, `=`, `,`, `:`, `\` and the characters of an
// expansion, a glob or a comment, as LOOSE_WORD_CUT states, and each word is
// read by its basename with a trailing .exe or .cmd removed, without regard
// to case, so git.exe, /usr/bin/git and "C:\Program Files\Git\bin\git.exe"
// are git wherever they stand: as the command, behind a wrapper (sudo
// git), inside quotes, a
// substitution or a comment. No command is parsed, and the pair read costs
// both ways. `git log --grep commit`, `gh pr list` and `gh api -H
// "Authorization: token ..."` are store lines by the word pair, even where
// they only read, and keep their placeholders, which is loud wherever the
// call needs the value to authenticate. A use that only hands the value on
// to be kept, such as `gh secret set X --env release`, holds a pair word and
// stores the placeholder text, which no error shows. `git push
// https://token@host/repo` is a use line and restores, which is the point.
// A line that spells git or commit in pieces the cut never joins, such as
// `gi""t`, is a use line and restores: a command crafted to carry a value
// past the sort is outside the threat model, which is a safety net against
// accidental disclosure into a transcript, a record or a commit, not a
// control against a hijacked session. A store writer the list does not
// name, such as a database client, gh repo or gh label with a description,
// gh workflow run or gh agent-task with an input or task text, or git
// filter-branch or git mktag, is a use line too. The list is closed, and
// nothing joins a split name.
//
// A memq line is a store line named by its own surface, a memq write, since
// the shared memory database is the store it reaches. The Write tool
// restores a placeholder to the real value on disk, so bodyFileRefusal reads
// each file a `--body-file` word names, before a Bash or PowerShell call
// runs, and refuses the call where the file holds a raw secret. The list of
// memq routes it does not screen is open: a body arriving by stdin, as in
// `cat f | memq put n d`; a body built by a shell expansion, `$(cat f)` or
// "$NAME"; a `--body-file` inside a wrapper's quoted string, such as
// `bash -c "memq put n d --body-file f"`, which is one word of the outer
// command; a relative path read from the session's working directory while the
// shell has moved (a `cd` earlier in the line or in an earlier call), where
// memq reads another file; and a file the same command writes before memq
// runs, as in `cp x body.md && memq put n d --body-file body.md`, which is
// scanned as it stood before. No wrapper is unwrapped and no expansion is
// performed. A PowerShell line is split by PowerShell's quoting and a Bash line
// by bash's, and a line ending inside an open quote is refused with a sentence
// naming the cause.
//
// The comment at redactor-detect.ts:61-64 (detect.ts:42-45 in the mod) is the
// mod's own: it says a tool that hands its input to the network gets the
// placeholder as written. That file is ported whole and its comment stays as
// the mod wrote it; for Bash and PowerShell on this engine the rule above
// supersedes it, since each restores every line the store rule does not
// catch, and so does an MCP tool the redactorRestoreTools setting names.
//
// The vault is seeded at session start. index.ts reads the five environment
// names, the three files under the home's .claude directory and each path in
// the credentialFiles setting, and hands the values and texts to seedVault,
// which keeps every value it finds through keepSecret: one of eight characters
// or more is hidden everywhere for the rest of the session, a shorter one only
// in the tool call that restored it. A file that is missing or could not be
// read, a JSON file that does not parse, a home directory that could not be
// read, and a credentialFiles entry that is not an absolute path each seed
// nothing and earn one log line. The logins file is the exception: it is
// read only where it exists, and missing it logs nothing. Every other seed
// stays in force.
//
// The persona module's own egress scrubs here too. Every text index.ts sends
// off the session to a model, a Jev body through decision-seam.ts and every
// prompt it hands to `$.model`, passes scrubText first. So does every copy of
// a prompt that prompt.submit persists, and the answer the memory queue and
// the reply record store; the raw prompt is still read where it stays in
// memory. The answer of a tool index.ts serves itself, and every context it
// adds to a tool's own scrubbed answer, passes scrubServed, and the failure
// text the tool.call `.catch` handler denies with and journals passes
// scrubText. All of them read the one vault, run the detector as well, and
// honour the `redactor` switch index.ts hands to setRedactorOn.
//
// Every step fails closed in index.ts: a step that throws is answered there
// with a refusal where the tool has not run and a withheld result where it
// has, never with the raw text. The withheld answers are built here so each
// caller returns the same one.

import type {
  AgentSpawnInput,
  PromptAttachmentInput,
  PromptAttachmentResult,
  PromptContextResult,
  PromptSubmitInput,
  PromptSubmitResult,
  ToolCallInput,
  ToolCallResult,
} from "claude-code";
import {
  collect,
  escapeLiteralTags,
  keepSecret,
  makeConfig,
  mint,
  restore,
  scrubSecrets,
  walk,
  type Config,
  type WalkState,
} from "./redactor-detect";

// The detector's knobs: the six local tools, the two shells among them,
// plus the MCP tools the redactorRestoreTools setting names through
// setRestoreTools; no allow list, email hiding off, restore on, notices on,
// the entropy floors 3.6 and 3.0, the length floor 24, no extra prefixes.
// restoresInto reads the set, the server set and REFUSED_TOOLS: a tool none
// admits restores nothing, whatever the store rule says of its line.
const RESTORE_TOOLS = "Bash,PowerShell,Write,Edit,MultiEdit,NotebookEdit";
const DETECTOR_OPTIONS: Record<string, unknown> = {
  secrets: true,
  pii: false,
  restoreInToolInputs: true,
  restoreTools: RESTORE_TOOLS,
  notify: true,
  minEntropy: 3.6,
  contextMinEntropy: 3.0,
  minLength: 24,
  allow: "",
  allowEmails: "",
  allowPrefixes: "",
  denyPrefixes: "",
};
// Reassigned by setRestoreTools; every closure below reads it at the call.
let cfg: Config = makeConfig(DETECTOR_OPTIONS);

// The program and verb pairs that write a store that outlives the session.
// A Bash or PowerShell line is a store line when both words of a pair stand
// in it, each read by its file name: it gets no restore and is refused where
// it carries a raw secret. Every other line is a use line, restored and
// never refused, since a use is what the restore exists for. A closed list,
// matched without regard to case, since PowerShell resolves its commands and
// Windows its executables that way. The git verbs are the ones that take a
// message or a patch into history: commit, tag and notes each take a
// message into a commit, a tag or a note; merge and revert each write a
// commit with a message; am takes a patch series into commits; commit-tree
// writes a commit object with its message; and send-email mails a patch
// series to a list's archive. The gh verbs are the named stores: issue,
// pr, release, gist, discussion and project each take a body into a
// host-side record a browser renders, project's being a draft issue on a
// board; api can write any of them, a comment among them; and variable sets
// an Actions variable stored as plaintext.
// git push and gh secret set are not on it: git push sends the value to a
// host, and gh secret set sends it to a store built to hold a secret, so
// each is a use. The pair read costs both ways: `git log --grep commit`,
// `gh pr list` and a gh api call that only reads are store lines by the
// words alone and keep their placeholders, which is loud where the call
// authenticates with the value, and `git push https://token@host/repo`
// restores, which is the point. A line that spells git or commit in pieces
// the cut never joins is a use line: the crafted shape is outside the
// threat model, and nothing joins a split name. A store writer outside the
// list, such as a database client, gh repo, gh label, gh workflow run, gh
// agent-task, git filter-branch or git mktag, restores.
export const STORE_WRITERS: readonly (readonly [string, string])[] = [
  ["git", "commit"],
  ["git", "tag"],
  ["git", "notes"],
  ["git", "merge"],
  ["git", "revert"],
  ["git", "am"],
  ["git", "commit-tree"],
  ["git", "send-email"],
  ["gh", "issue"],
  ["gh", "pr"],
  ["gh", "release"],
  ["gh", "gist"],
  ["gh", "discussion"],
  ["gh", "project"],
  // gh api can write an issue or pull request comment or any other host
  // record, so a gh api line keeps its placeholder even where it only reads,
  // which is the loud cost.
  ["gh", "api"],
  // gh variable set stores an Actions variable as plaintext. gh secret set
  // is a use, since its store is built to hold one.
  ["gh", "variable"],
];

// The tools outside the restore set whose input is refused where it carries
// a raw secret: the persona MCP tools whose free-text fields reach the goal
// store the coordinator and the fleet cards read, the relay's reply tool,
// and the four engine tools that hand their input to another model or the
// network. Every other non-restore tool passes its input as written.
export const REFUSED_TOOLS: ReadonlySet<string> = new Set([
  "mcp__personas__agentic_say",
  "mcp__personas__memory_add",
  "mcp__personas__goal_add",
  "mcp__personas__goal_create",
  "mcp__personas__goal_edit",
  "mcp__personas__goal_done",
  "mcp__personas__goal_longterm",
  "mcp__personas__task_add",
  "mcp__personas__ask_open",
  "mcp__personas__ask_close",
  "mcp__personas__agentic_resolve",
  "mcp__plugin_relay_channel-relay__reply",
  "Agent",
  "SendMessage",
  "WebFetch",
  "WebSearch",
]);

// The MCP servers the redactorRestoreTools setting names, each as the
// `mcp__<server>` prefix: a tool restores where serverOf its name is in this
// set. The tool names the setting names sit in cfg.restoreTools beside the
// six. setRestoreTools replaces both.
let restoreServers: ReadonlySet<string> = new Set();

// The server prefix of an MCP tool name, `mcp__<server>` for
// `mcp__<server>__<tool>`: the text before the second `__`. Null where the
// name is not a string, does not open with `mcp__`, holds no second `__`, or
// has an empty server or tool part, so `mcp__eleos`, `mcp____x` and
// `mcp__a__` each give null and `mcp__a__b__c` gives `mcp__a`. index.ts
// reads it to tell an MCP tool name from any other dropped entry.
export function serverOf(tool: unknown): string | null {
  if (typeof tool !== "string" || !tool.startsWith("mcp__")) return null;
  const cut = tool.indexOf("__", 5);
  return cut > 5 && cut + 2 < tool.length ? tool.slice(0, cut) : null;
}

// Whether an entry is an MCP server name: it opens with `mcp__`, holds no
// second `__`, and its server part is not empty.
function isServerName(entry: string): boolean {
  return entry.startsWith("mcp__") && entry.length > 5 && !entry.includes("__", 5);
}

// Reads plugin.json's `redactorRestoreTools` setting, which index.ts hands
// over at register, and rebuilds the restore set from it: the six fixed
// tools plus each entry that is an MCP tool name, and the server set from
// each entry that is an MCP server name. An entry is trimmed and read
// case-sensitively, since tool names are. Any other entry, and a tool entry
// REFUSED_TOOLS names, is dropped, and the dropped entries come back as the
// bare strings, in order, for index.ts to log. A setting that is not a
// string reads as empty. Each call replaces the last call's set.
export function setRestoreTools(setting: unknown): string[] {
  const tools: string[] = [];
  const servers = new Set<string>();
  const dropped: string[] = [];
  const entries = typeof setting === "string" ? setting.split(",").map((s) => s.trim()).filter((s) => s !== "") : [];
  for (const entry of entries) {
    if (serverOf(entry) !== null && !REFUSED_TOOLS.has(entry)) tools.push(entry);
    else if (isServerName(entry)) servers.add(entry);
    else dropped.push(entry);
  }
  cfg = makeConfig({ ...DETECTOR_OPTIONS, restoreTools: [...RESTORE_TOOLS.split(","), ...tools] });
  restoreServers = servers;
  return dropped;
}

// The surfaces a refused shell line is named by: a memq line by the memq
// write, since the shared memory database is the store it reaches, and any
// other store line by its shell, Bash or PowerShell.
export const MEMQ_SURFACE = "a memq write";
export function storeSurfaceOf(tool: string): string {
  return `a ${tool} command that writes a store`;
}

// The fixed refusal, one shape for every surface, with the surface filled in.
export function refusalFor(surface: string): string {
  return `redactor: this call would store a real secret through ${surface}. Use its placeholder.`;
}

// The scan's pace, taken at 1,000 characters a millisecond, is the charge's
// estimate: the slowest measured whole scrub, 8 MB in 4,834 ms, ran at about
// 1,655 characters a millisecond, so the estimate sits near 60 percent of it
// and a slower machine has room. The clock is the control behind it: the
// budget's tick reads it before each of the detector's whole-text passes and
// withholds once the deadline has passed. The hint probes between two reads,
// the `includes` and gate tests that decide whether a pass runs, are linear
// reads the clock does not time, so a machine slower than the estimate runs
// past the deadline by the pass in flight plus the probes after it. The base
// covers the walk and the vault work around a scan. SCAN_CAP is what the
// full 10 s hook budget scans at that pace: a call whose strings add up to
// more is withheld rather than passed on unscanned, whatever the budget
// reads. Exported so a test derives an oversized text from them.
export const SCAN_CHARS_PER_MS = 1_000;
export const SCAN_BASE_MS = 300;
export const SCAN_CAP = (10_000 - SCAN_BASE_MS) * SCAN_CHARS_PER_MS;

const WITHHELD =
  "redactor could not scan this result in time, so it was withheld. Narrow the output (head, grep, offset) and retry.";
export const REFUSED_BEFORE_RUN =
  "redactor failed before this call ran, so the call was refused. Narrow the command and retry.";
export const BLOCK_WITHHELD = "[redactor withheld this text: the scan failed]";

// The answers index.ts returns where a step threw before the event went down:
// the prompt is dropped, the subagent is not started, the attachment's text is
// held back.
export const PROMPT_WITHHELD: PromptSubmitResult = { drop: "redactor failed to scan this prompt, so it was not sent." };
export const SPAWN_WITHHELD = { deny: "redactor failed to scan this task, so the subagent was not started." };
export const ATTACHMENT_WITHHELD: PromptAttachmentResult = { text: BLOCK_WITHHELD };

// Tools whose answer carries live placeholders, so they are not turned into
// quoted (LITERAL) ones: the subagent tool, whose answer holds placeholders
// the subagent used. The same tool REFUSED_TOOLS names for its input.
export const LIVE_TAG_TOOLS: ReadonlySet<string> = new Set(["Agent"]);

// The throw a scan budget makes, so a refusal can tell it from any other.
class ScanBudgetError extends Error {}

// The clock the scan budget and its tick read: the monotonic clock,
// performance.now, unless a test moves it through setScanClock. Monotonic,
// so a wall-clock jump during a scan never moves a deadline. Wrapped, since
// the unbound method throws in Node on its Performance brand check. One
// value for the whole module, since the hook runs on one clock, and a seam
// only so a test can cross a deadline without waiting for one.
let scanClock: () => number = () => performance.now();
export function setScanClock(now: () => number): void {
  scanClock = now;
}

// One call's scan budget over `remainingMs`, the hook's remaining time read
// once at the call, with the clock read once beside it. `charge` is the
// pre-check: every string the call scans is charged before its scan,
// cumulatively, and it throws where the scans so far plus this one would not
// finish inside the budget at the assumed pace. `scrub` is the control: it
// runs the detector with a tick that reads the clock before every whole-text
// pass and before each blob decode, and throws once the clock has passed the
// deadline, the clock at the call plus `remainingMs` less SCAN_BASE_MS. The
// hint probes between passes are linear reads the tick does not time, so a
// scan slower than the pace assumes ends past the deadline by the pass or
// blob decode in flight plus the probes after it, rather than running its
// remaining passes. `tick` is the same check for a caller that decodes a
// media value itself through `walk`, handed in the walk's state. An
// `Infinity` budget has an infinite deadline and a tick that never throws.
// Either throw is the same ScanBudgetError, and the caller's branch on it
// withholds or refuses.
type Budget = { charge: (text: string) => void; scrub: (text: string) => string; tick: () => void };
function scanBudget(remainingMs: number): Budget {
  let chars = 0;
  const deadline = scanClock() + remainingMs - SCAN_BASE_MS;
  const tick = (): void => {
    if (scanClock() > deadline) throw new ScanBudgetError("redactor: out of time");
  };
  return {
    charge: (text) => {
      chars += text.length;
      if (chars > SCAN_CAP) throw new ScanBudgetError("redactor: text too large to scan");
      if (remainingMs < SCAN_BASE_MS + chars / SCAN_CHARS_PER_MS) throw new ScanBudgetError("redactor: out of time");
    },
    scrub: (text) => scrubSecrets(text, cfg, tick),
    tick,
  };
}

// A word as the store list names it: its basename, a trailing .exe or .cmd
// removed, in lower case.
function commandNameOf(word: string): string {
  return word.replace(/^.*[\\/]/, "").replace(/\.(?:exe|cmd)$/i, "").toLowerCase();
}

// The characters a Bash line is cut into words at: whitespace, quotes, the
// operators, `=`, and the characters of an expansion, a glob, a drive or a
// backslash path, so an assignment's value, an option's value and a name
// inside `${C:-curl}`, `{curl,}`, `/usr/bin/curl*` or `C:\bin\curl.exe`
// are words of their own.
const LOOSE_WORD_CUT = /[\s"'`;&|(){}<>=,:*?[\]\\!#@$]+/;

// A word that is a memq.js or memq-shim.js path, bare or under any
// directory: the CLI itself, and the shim the doctor installs that runs it.
const MEMQ_JS = /(^|[\\/])memq(?:-shim)?\.js$/i;

// Whether a word is memq: a memq.js or memq-shim.js path, or a file name
// that is memq or memq.ps1, the PowerShell wrapper the doctor installs, once
// the name's .exe or .cmd is removed.
export function isMemqWord(word: string): boolean {
  if (MEMQ_JS.test(word)) return true;
  const name = commandNameOf(word);
  return name === "memq" || name === "memq.ps1";
}

// Whether a shell command names memq: any word in it, cut as storesBash cuts
// it, is memq or memq.ps1, or a memq.js or memq-shim.js path. A memq command
// is always a store line.
export function storesMemq(command: string): boolean {
  return command.split(LOOSE_WORD_CUT).some((token) => token !== "" && isMemqWord(token));
}

// Whether a shell command is a store line, a Bash and a PowerShell line read
// alike: any word in it, read by its file name, is memq or memq.ps1, or a
// memq.js or memq-shim.js path, or both words of a STORE_WRITERS pair stand
// somewhere in it. The words anywhere decide, whatever position, quotes or
// operators surround them, since a reading of the shell's grammar errs
// silently, restoring a real value into a line it misread, while this errs
// toward a placeholder in a line that merely names a pair. One pass over
// the line's words, so the time is linear in its length.
export function storesBash(command: string): boolean {
  const names = new Set<string>();
  for (const token of command.split(LOOSE_WORD_CUT)) {
    if (token === "") continue;
    if (isMemqWord(token)) return true;
    names.add(commandNameOf(token));
  }
  return STORE_WRITERS.some(([program, verb]) => names.has(program) && names.has(verb));
}

// The command of a Bash or PowerShell call, or null for any other call.
function shellCommandOf(e: ToolCallInput): string | null {
  const command = (e as { command?: unknown }).command;
  return (e.tool === "Bash" || e.tool === "PowerShell") && typeof command === "string" ? command : null;
}

// Whether this call is a shell store line, read once per call: the refusal
// and the restore both ask, for the same event object.
const storingMemo = new WeakMap<object, boolean>();
function storingShell(e: ToolCallInput): boolean {
  const known = storingMemo.get(e);
  if (known !== undefined) return known;
  const command = shellCommandOf(e);
  const stores = command !== null && storesBash(command);
  storingMemo.set(e, stores);
  return stores;
}

// Whether a tool's arguments carry a raw secret: a value the vault knows, or
// one the detector would hide. The arguments are scanned as the result would
// be and the rewrite is discarded; the envelope's own fields are left out of
// the scan. A placeholder is not a raw secret: the scan leaves it as it
// stands, so the test is whether the scan changed any string. The tags the
// scan collects are not the test, since the detector records a placeholder
// it meets in a credential context even where it rewrites nothing. Each
// string is charged to `budget` before its scan and scrubbed through it, so
// the clock bounds the refusal's scan as it bounds every other. An input the
// walk cannot read whole counts as holding one.
function holdsRawSecret(e: object, budget: Budget): boolean {
  const args: Record<string, unknown> = { ...(e as Record<string, unknown>) };
  delete args.tool;
  delete args.tool_use_id;
  delete args.agentId;
  let changed = false;
  const st: WalkState = { incomplete: false, tick: budget.tick };
  walk(args, (s) => {
    budget.charge(s);
    const out = budget.scrub(s);
    if (out !== s) changed = true;
    return out;
  }, st);
  return changed || st.incomplete;
}

// Counts the values hidden, not the placeholders that stand for quoted text.
function countHidden(tags: Set<string>): number {
  return [...tags].filter((t) => !t.startsWith("[REDACTED-LITERAL-")).length;
}

// ------------------------------------------------------------ tool.call

// The fixed refusal where this call is a store surface, a shell store line
// or a tool in REFUSED_TOOLS, carrying a raw secret; null where the call may
// go on, a use line whatever it carries included. index.ts runs it first,
// before any guard answers, and a non-null answer is the call's deny. An
// input too large to scan inside `remainingMs` is refused the same way:
// unscanned, it may carry a secret.
export function toolCallRefusal(e: ToolCallInput, remainingMs: number): string | null {
  const stores = storingShell(e);
  if (!stores && !REFUSED_TOOLS.has(e.tool)) return null;
  const surface = stores ? (storesMemq((e as { command: string }).command) ? MEMQ_SURFACE : storeSurfaceOf(e.tool)) : e.tool;
  try {
    return holdsRawSecret(e, scanBudget(remainingMs)) ? refusalFor(surface) : null;
  } catch (err) {
    if (err instanceof ScanBudgetError) return refusalFor(surface);
    throw err;
  }
}

// The command of a Bash or PowerShell call that names memq, or null for any
// other call.
function memqShellCommandOf(e: ToolCallInput): string | null {
  const command = shellCommandOf(e);
  return command !== null && storesMemq(command) ? command : null;
}

// A command's words as its shell hands them to the program, by bash's quoting
// or, for `powerShell`, by PowerShell's. In both, a word is cut at whitespace
// and at `;`, `|`, `&`, `(` and `)` outside quotes, single and double quotes
// group a word and are removed, and a `#` opening a word outside quotes starts
// a comment to the end of its line. Under bash `<` and `>` cut a word too, a
// backslash takes the next character literally outside single quotes (inside
// double quotes only before `$`, a backtick, `"` or `\`), and a backslash
// before a newline is a line continuation and is removed. Under PowerShell a
// backslash is literal, a backtick takes the next character literally outside
// single quotes, a quote doubled inside its own quotes stands for one, a word
// that opens with a quote ends at its closing quote, and a `<#` opening a word
// outside quotes starts a block comment that runs to `#>`. Two PowerShell
// readings differ from the shell's, each in the direction of a read too many
// or a refused call: a backtick before a newline cuts the word, which is
// PowerShell's reading only where a space precedes it, and a backtick escape
// letter such as `n is read as the letter. No expansion is performed, so a
// quoted `"$(cat f)"` is one word as written and an unquoted one splits at its
// parentheses, and a `~` path is handed to the read as written. A command
// ending inside an open quote or block comment throws.
function commandWords(command: string, powerShell: boolean): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let opensQuoted = false;
  let quote = "";
  const cut = () => {
    if (started) words.push(word);
    word = "";
    started = opensQuoted = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote !== "") {
      if (c === quote) {
        if (powerShell && next === quote) word += command[++i];
        else {
          quote = "";
          if (powerShell && opensQuoted) cut();
        }
      } else if (quote === '"' && powerShell && c === "`" && next !== undefined) word += command[++i];
      else if (quote === '"' && !powerShell && c === "\\" && next === "\n") i++;
      else if (quote === '"' && !powerShell && c === "\\" && next !== undefined && '$`"\\'.includes(next)) word += command[++i];
      else word += c;
    } else if (!powerShell && c === "\\" && next === "\n") {
      i++;
    } else if (!powerShell && c === "\\" && next !== undefined) {
      word += command[++i];
      started = true;
    } else if (powerShell && c === "`" && (next === "\n" || command.startsWith("\r\n", i + 1))) {
      i += next === "\n" ? 1 : 2;
      cut();
    } else if (powerShell && c === "`" && next !== undefined) {
      word += command[++i];
      started = true;
    } else if (c === "'" || c === '"') {
      if (!started) opensQuoted = true;
      quote = c;
      started = true;
    } else if (powerShell && c === "<" && next === "#" && !started) {
      const end = command.indexOf("#>", i + 2);
      if (end < 0) throw new Error("redactor: the command ends inside a block comment");
      cut();
      i = end + 1;
    } else if (c === "#" && !started) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
    } else if (/\s/.test(c) || ";|&()".includes(c) || (!powerShell && "<>".includes(c))) {
      cut();
    } else {
      word += c;
      started = true;
    }
  }
  if (quote !== "") throw new Error("redactor: the command ends inside an open quote");
  cut();
  return words;
}

// The fixed memq refusal where the file a Bash or PowerShell memq command's
// `--body-file` names holds a raw secret, null where it holds none or the call
// is not a memq command naming one. The file is the one place a memq body the
// model composed from a placeholder holds the real value, since Write restores
// it. A line whose text holds `--body-file` is split by its shell's quoting,
// and every word after a `--body-file` word is a path handed to `fs.read` as
// the split yields it, relative paths included. Every file is read first, then
// each file's text is charged to one scan budget for the call and scanned as a
// command's own text is. Files whose text passes SCAN_CAP in total take the
// memq refusal before the next read. A split that ends inside an open quote or block
// comment, and a file the read rejects, throws or does not hold, are each
// refused with a sentence naming the cause, since the call has not run and a
// file the read cannot return may still be one memq reads. The file sentence quotes the path as the split yielded it, scrubbed
// (the split can join a secret the command scan saw in pieces) and cut to 200
// code points. A `--body-file` inside a wrapper's quoted string,
// `bash -c "memq put n d --body-file f"`, is part of one word and is never
// reached. A budget error on a file's scan is the memq refusal; any other
// error from the split or a scan, a budget error on the path's scrub among
// them, escapes, and the caller refuses the call before it runs.
export async function bodyFileRefusal(e: ToolCallInput, fs: { read: (path: string) => Promise<unknown> }, remainingMs: number): Promise<string | null> {
  const command = memqShellCommandOf(e);
  if (command === null || !command.includes("--body-file")) return null;
  let words: string[];
  try {
    words = commandWords(command, e.tool === "PowerShell");
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const open = message.includes("block comment") ? "an open block comment" : message.includes("open quote") ? "an open quote" : null;
    if (open === null) throw err;
    return `redactor: this command ends inside ${open}, so the call was refused before it ran. Close it, or write the body to a file with the Write tool and name it with --body-file.`;
  }
  const texts: string[] = [];
  let total = 0;
  for (let i = 0; i + 1 < words.length; i++) {
    if (words[i] !== "--body-file") continue;
    let text: string;
    try {
      text = String(await fs.read(words[i + 1]));
    } catch {
      return `redactor: could not read the file this command's --body-file names (${Array.from(scanBudget(remainingMs).scrub(words[i + 1])).slice(0, 200).join("")}), so the call was refused before it ran. Write the file in its own call first, then run memq.`;
    }
    // The charge would refuse these files anyway, so stop reading once they
    // pass SCAN_CAP: a command naming one large file hundreds of times then
    // holds no more than the cap and one read, and the refusal reads no clock.
    total += text.length;
    if (total > SCAN_CAP) return refusalFor(MEMQ_SURFACE);
    texts.push(text);
  }
  // Every file is read before the one budget is made, so its deadline is
  // read from the clock on this side of every wait the engine does not
  // charge, and the files share one bound on characters and time rather
  // than each taking the hook's whole remaining time.
  const budget = scanBudget(remainingMs);
  try {
    for (const text of texts) budget.charge(text);
    for (const text of texts) if (budget.scrub(text) !== text) return refusalFor(MEMQ_SURFACE);
  } catch (err) {
    if (err instanceof ScanBudgetError) return refusalFor(MEMQ_SURFACE);
    throw err;
  }
  return null;
}

// Whether a call restores: its tool is in the restore set, or its server
// prefix is in the server set, and it is not on REFUSED_TOOLS, and it is not
// a shell store line. The refused check runs here, at the call, since a
// server entry can cover a refused tool, and a restore after the refusal
// would carry the real value into the store the refusal protects.
function restoresInto(e: ToolCallInput): boolean {
  if (!cfg.restore || REFUSED_TOOLS.has(e.tool) || storingShell(e)) return false;
  if (cfg.restoreTools.has(e.tool)) return true;
  const server = serverOf(e.tool);
  return server !== null && restoreServers.has(server);
}

// The four reasons a live placeholder went down as written, each the tail
// of the notice unrestoredNotice builds.
export const NOT_RESTORE_TOOL_REASON = "it is not a restore tool; name an MCP tool in redactorRestoreTools, or use Bash, PowerShell, Write or Edit";
export const STORE_LINE_REASON = "a shell line that writes a store keeps its placeholders";
export const REFUSED_TOOL_REASON = "a refused tool never receives a real value";
export const SERVED_TOOL_REASON = "the plugin serves this tool itself and restores nothing into it";

// The depth the live-placeholder search reads to, the detector walk's own
// bound, so a cyclic or very deep input ends the search rather than the stack.
const LIVE_SEARCH_DEPTH = 64;

// Whether any string under `v`, to LIVE_SEARCH_DEPTH, holds a SECRET token
// the vault restores. It reads in place and copies nothing. A placeholder
// cannot sit in base64, whose alphabet holds no `[` or `]`, so no string is
// decoded. The envelope's own fields, the tool name, the call id and the
// loop id, are left out at the top level.
function holdsLivePlaceholder(v: unknown, depth = 0): boolean {
  if (typeof v === "string") {
    if (!v.includes("[REDACTED-SECRET-")) return false;
    for (const t of v.match(/\[REDACTED-SECRET-[0-9a-f]{8}\]/g) ?? []) if (restore(t) !== t) return true;
    return false;
  }
  if (v === null || typeof v !== "object" || depth >= LIVE_SEARCH_DEPTH) return false;
  for (const [k, x] of Object.entries(v)) {
    if (depth === 0 && (k === "tool" || k === "tool_use_id" || k === "agentId")) continue;
    if (holdsLivePlaceholder(x, depth + 1)) return true;
  }
  return false;
}

// The notice index.ts posts under the tool row where a call went down with a
// live placeholder as written, or null where the call restores or holds
// none. `nextRan` says whether the handler's next(e) ran with this call: a
// call the module served itself never reached toolCallDown, so nothing was
// restored into it whatever restoresInto reads. A live placeholder is a
// SECRET token the vault restores, one restore() turns into another string;
// a LITERAL token, or a SECRET token the vault does not know, is not one.
// The reason is the first rule that kept the value out: a shell store line,
// then the refused list, then a call the module served, then the restore
// set. The text names the tool and the reason, never a value. It never
// throws: an input the search cannot read earns no notice.
export function unrestoredNotice(e: ToolCallInput, nextRan: boolean): string | null {
  try {
    if (nextRan && restoresInto(e)) return null;
    if (!holdsLivePlaceholder(e)) return null;
    const reason = storingShell(e) ? STORE_LINE_REASON : REFUSED_TOOLS.has(e.tool) ? REFUSED_TOOL_REASON : !nextRan ? SERVED_TOOL_REASON : NOT_RESTORE_TOOL_REASON;
    return `redactor: ${e.tool} received the placeholder as written: ${reason}`;
  } catch {
    return null;
  }
}

// What the handler's `next` receives: for a tool restoresInto admits, the
// input with its placeholders restored; for a store line and any other
// call, the input as written, placeholders included. Every placeholder
// kind the mod's restore covers is restored, a
// LITERAL one giving back the placeholder text it stands for. `handed` holds
// the real values this call was given, the SECRET restores alone, so whatever
// the tool prints of them comes back hidden, even bare and short, where no
// detector would fire.
export type ToolCallDown = { input: ToolCallInput; handed: Set<string> };
export function toolCallDown(e: ToolCallInput): ToolCallDown {
  const handed = new Set<string>();
  if (!restoresInto(e)) return { input: e, handed };
  const restoreTracked = (s: string): string => {
    const out = restore(s);
    if (out === s) return s;
    for (const t of s.match(/\[REDACTED-SECRET-[0-9a-f]{8}\]/g) ?? []) {
      const v = restore(t);
      if (v !== t) handed.add(v);
    }
    return out;
  };
  return { input: walk({ ...e }, restoreTracked) as ToolCallInput, handed };
}

// The answer the handler reads: the result, the text the model reads, any
// attached context and any deny text from beneath, with secrets replaced by
// placeholders and the values the call was handed re-hidden; the same object
// where nothing was hidden. `hidden` is the count index.ts puts under the tool
// row. A hidden value beside a part of the result the walk cannot rewrite
// withholds the whole result, since that part may hold the same secret.
export function toolCallBack(tool: string, r: ToolCallResult, handed: Set<string>, remainingMs: number): { r: ToolCallResult; hidden: number } {
  const budget = scanBudget(remainingMs);
  const rehideHanded = (text: string): string => {
    let out = text;
    for (const v of [...handed].sort((a, b) => b.length - a.length)) if (v.length >= 4 && out.includes(v)) out = out.split(v).join(mint("SECRET", v));
    return out;
  };
  if (r.deny !== undefined) {
    // A refusal from beneath may quote the input it refused, real values
    // and all, and the model reads it as the tool's answer.
    const d = collect(() => (budget.charge(r.deny), rehideHanded(budget.scrub(escapeLiteralTags(r.deny)))));
    return { r: d.tags.size === 0 ? r : { deny: d.value }, hidden: 0 };
  }
  const escape = !LIVE_TAG_TOOLS.has(tool);
  const st: WalkState = { incomplete: false, tick: budget.tick };
  // The result and the text often hold the same string: scan it once.
  const memo = new Map<string, string>();
  const clean = (s: string): string => {
    const done = memo.get(s);
    if (done !== undefined) return done;
    budget.charge(s);
    const out = rehideHanded(budget.scrub(escape ? escapeLiteralTags(s) : s));
    memo.set(s, out);
    return out;
  };
  const { value, tags } = collect(() => ({
    result: walk(r.result, clean, st),
    text: r.text === undefined ? undefined : clean(r.text),
    context: r.context?.map(clean),
  }));
  if (tags.size === 0) return { r, hidden: 0 };
  if (st.incomplete) return { r: { deny: "redactor: a secret sits in a part of this result it cannot rewrite (too deep, or not plain data). Narrow the call and retry." }, hidden: 0 };
  const hidden = countHidden(tags);
  const context = value.context ? { context: value.context } : {};
  if (r.isError) return { r: { isError: true as const, result: value.result, text: value.text, ...context }, hidden };
  return { r: { result: value.result, ...context } as ToolCallResult, hidden };
}

// The fail-closed answer for a tool call whose redactor step threw: with no
// answer from beneath the call is refused and the sentence says it was refused
// before it ran; with one, the whole answer is withheld in the result-side
// sentence, an error result staying an error.
export function withheldToolResult(r?: ToolCallResult): ToolCallResult {
  if (r === undefined) return { deny: REFUSED_BEFORE_RUN };
  if (r.deny === undefined && r.isError) return { isError: true as const, result: WITHHELD, text: WITHHELD };
  return { deny: WITHHELD };
}

// ------------------------------------------------------------ the prompt hooks

// What the prompt.submit handler passes down: the prompt and the context a
// hook above attached, with secrets replaced by placeholders, or the same
// event where nothing was hidden. `hidden` is the count index.ts toasts.
export function scrubPrompt(e: PromptSubmitInput, remainingMs: number): { e: PromptSubmitInput; hidden: number } {
  const budget = scanBudget(remainingMs);
  const { value, tags } = collect(() => {
    budget.charge(e.text);
    return { text: budget.scrub(e.text), context: e.context?.map((c) => (budget.charge(c), budget.scrub(c))) };
  });
  if (tags.size === 0) return { e, hidden: 0 };
  return { e: { ...e, text: value.text, ...(value.context ? { context: value.context } : {}) }, hidden: countHidden(tags) };
}

// The blocks attached to the first message (CLAUDE.md and friends), each
// scrubbed; the same answer where none changed. The raw files behind a
// rewritten block would carry the key on to the hooks above, so they are left
// out once any block changed.
export function scrubContextBlocks(r: PromptContextResult, remainingMs: number): PromptContextResult {
  const budget = scanBudget(remainingMs);
  const blocks = r.blocks.map((b) => {
    budget.charge(b.text);
    return { ...b, text: budget.scrub(b.text) };
  });
  if (blocks.every((b, i) => b.text === r.blocks[i].text)) return r;
  return { blocks };
}

// The fail-closed answer for prompt.context: the blocks are kept, each with
// its text held back, so the model sees that something was withheld.
export function withheldContextBlocks(r: PromptContextResult): PromptContextResult {
  return { blocks: (r?.blocks ?? []).map((b) => ({ ...b, text: BLOCK_WITHHELD })) };
}

// What the engine injects on its own after the first message: a file named
// with @, a diff of a file that changed on disk, a nested CLAUDE.md, a
// settings hook's context. None of it passes tool.call. A file's text from
// outside the engine's prose has its live placeholders quoted as LITERAL
// ones first. The same answer where nothing changed.
export function scrubAttachment(e: PromptAttachmentInput, r: PromptAttachmentResult, remainingMs: number): PromptAttachmentResult {
  if (r.text == null) return r;
  const text = r.text;
  const budget = scanBudget(remainingMs);
  budget.charge(text);
  const isFile = e.type === "file" || e.type === "edited_text_file";
  const out = isFile ? budget.scrub(escapeLiteralTags(text)) : budget.scrub(text);
  return out === text ? r : { text: out };
}

// A subagent's task with its prompt and description scrubbed, or the same
// event where nothing changed. The model only ever holds placeholders, and the
// Agent tool gets no restore, so this is a second layer: a value that slipped
// into the prompt some other way still reaches the subagent as a placeholder.
export function scrubSpawn(e: AgentSpawnInput, remainingMs: number): AgentSpawnInput {
  const budget = scanBudget(remainingMs);
  budget.charge(e.prompt);
  const prompt = budget.scrub(e.prompt);
  budget.charge(e.description);
  const description = budget.scrub(e.description);
  return prompt === e.prompt && description === e.description ? e : { ...e, prompt, description };
}

// ------------------------------------------------------------ egress

// plugin.json's `redactor` switch, which index.ts sets at register. Off,
// scrubText and scrubServed hand their input back as is.
let redactorOn = true;
export function setRedactorOn(on: boolean): void {
  redactorOn = on;
}

// One text with its secrets replaced by placeholders, the vault's and the
// detector's, and the count of values hidden; the same text, zero hidden,
// where nothing changed or the switch is off. It never throws: a scan that
// fails gives the withheld line in place of the text, so a caller sends or
// keeps that line and never the raw text.
export function scrubText(text: string): { text: string; hidden: number } {
  if (!redactorOn || typeof text !== "string") return { text, hidden: 0 };
  try {
    const budget = scanBudget(Infinity);
    const { value, tags } = collect(() => (budget.charge(text), budget.scrub(text)));
    return value === text ? { text, hidden: 0 } : { text: value, hidden: countHidden(tags) };
  } catch {
    return { text: BLOCK_WITHHELD, hidden: 0 };
  }
}

// The answer of a tool call once index.ts has added to it, scrubbed: where
// the module served the tool itself (`served`, next never called) the whole
// answer, and otherwise each context line, since the rest is the tool's own
// answer and was scrubbed on its way back. The same answer, zero hidden,
// where no text changed. A hidden value beside a part the walk cannot rewrite
// withholds the whole answer, as toolCallBack does. Throws where the scan
// does; index.ts withholds then.
export function scrubServed(r: ToolCallResult, served: boolean, remainingMs: number): { r: ToolCallResult; hidden: number } {
  if (!redactorOn) return { r, hidden: 0 };
  const budget = scanBudget(remainingMs);
  let changed = false;
  const clean = (s: string): string => {
    budget.charge(s);
    const out = budget.scrub(s);
    if (out !== s) changed = true;
    return out;
  };
  const st: WalkState = { incomplete: false, tick: budget.tick };
  const { value, tags } = collect(() => (served ? walk(r, clean, st) : { ...r, context: r.context?.map(clean) }));
  if (!changed) return { r, hidden: 0 };
  if (st.incomplete) return { r: withheldToolResult(r), hidden: 0 };
  return { r: value as ToolCallResult, hidden: countHidden(tags) };
}

// ------------------------------------------------------------ the seed

// How a seed file's text is read: the two kit memory database files by their
// keys ending in `assword`, the engine's credentials file by its keys ending
// in `Token` or `token`, a credentialFiles path ending in .env line by line,
// and any other credentialFiles path whole. An entry with a `skip` line is
// never read and logs that line: a credentialFiles entry that is not an
// absolute path, and the home directory where it could not be read. An
// `optional` file that is missing logs nothing.
export type SeedFile = { path: string; kind: "password" | "token" | "env" | "whole"; optional?: true; skip?: string };

// A path from a drive (`C:\` or `C:/`) or from the root (`/`), never one
// that opens with two separators, a network share.
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/(?![\\/]))/;

// The files session start reads: the three under the home's .claude
// directory where `home` is a non-empty string, the logins file among them
// read where it exists, and otherwise one skipped entry for the home; then
// each path the credentialFiles setting names, a comma-separated list,
// blanks dropped.
export function seedFiles(home: unknown, setting: unknown): SeedFile[] {
  const files: SeedFile[] = [];
  if (typeof home === "string" && home.trim() !== "") {
    const dir = `${home.trim().replace(/[/\\]+$/, "")}/.claude`;
    files.push(
      { path: `${dir}/kit-memory-db.json`, kind: "password" },
      { path: `${dir}/kit-memory-db-logins.json`, kind: "password", optional: true },
      { path: `${dir}/.credentials.json`, kind: "token" },
    );
  } else {
    files.push({ path: "the home directory", kind: "whole", skip: "redactor: the home directory could not be read, so its credential files seed nothing" });
  }
  if (typeof setting === "string") {
    for (const path of setting.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
      const kind = /\.env$/i.test(path) ? "env" : "whole";
      files.push(ABSOLUTE_PATH.test(path) ? { path, kind } : { path, kind, skip: `redactor: the credentialFiles entry ${path} is not an absolute path, so it is not read` });
    }
  }
  return files;
}

// The keys whose values a JSON seed file contributes, by the file's kind.
const SEED_KEYS = { password: /assword$/, token: /[Tt]oken$/ };

// A .env key that names a secret: KEY, TOKEN, SECRET, PASSWORD, PASS or PWD,
// alone or after an underscore, in any case. DB_PASS and API_KEY name one;
// MONKEY_COUNT, DB_USER and PORT do not.
const ENV_SECRET_KEY = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)$/i;

// A .env line: an optional `export `, the key, `=`, the value.
const ENV_LINE = /^\s*(?:export\s+)?([^=]*?)\s*=\s*(.*)$/;

// Every string at or under `v`.
function stringsUnder(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) stringsUnder(x, out);
}

// The strings under each key `key` matches, at any depth.
function keyedStrings(v: unknown, key: RegExp, out: string[]): void {
  if (v === null || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) {
    if (!Array.isArray(v) && key.test(k)) stringsUnder(x, out);
    else keyedStrings(x, key, out);
  }
}

// The value of each line of a .env text whose key names a secret. A quoted
// value is what stands between its quotes, anything after the closing quote
// dropped; an unquoted one ends before a `#` that follows whitespace, and a
// value that opens a quote it never closes loses that one quote. A line
// whose key starts with # is a comment.
function envValues(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = ENV_LINE.exec(line);
    if (m === null || m[1].startsWith("#") || !ENV_SECRET_KEY.test(m[1])) continue;
    const quoted = /^(["'])(.*?)\1/.exec(m[2]);
    out.push(quoted !== null ? quoted[2] : m[2].replace(/^["']/, "").replace(/\s+#.*$/, ""));
  }
  return out;
}

// Seeds the vault: every value the environment reads settled with, and every
// value each file holds by its kind, goes through keepSecret, empty values
// aside. A file's text is undefined where it is missing or was not read and
// null where its read failed. An entry with a `skip` line, a missing file
// that is not optional, a failed read and a JSON file that does not parse
// each seed nothing and add one log line, which names the path and never the
// text, since a parse error quotes the text it stopped on. Returns those
// lines for index.ts to log.
export function seedVault(env: readonly PromiseSettledResult<unknown>[], files: readonly (SeedFile & { text: string | null | undefined })[]): string[] {
  const values: string[] = [];
  const logs: string[] = [];
  for (const r of env) if (r.status === "fulfilled" && typeof r.value === "string") values.push(r.value);
  for (const f of files) {
    if (f.skip !== undefined) {
      logs.push(f.skip);
    } else if (f.text === undefined) {
      if (!f.optional) logs.push(`redactor: ${f.path} is missing, so it seeds nothing`);
    } else if (f.text === null) {
      logs.push(`redactor: ${f.path} could not be read, so it seeds nothing`);
    } else if (f.kind === "env") {
      values.push(...envValues(f.text));
    } else if (f.kind === "whole") {
      values.push(f.text);
    } else {
      const found: string[] = [];
      try {
        keyedStrings(JSON.parse(f.text.replace(/^\uFEFF/, "")), SEED_KEYS[f.kind], found);
      } catch {
        logs.push(`redactor: ${f.path} is not valid JSON, so it seeds nothing`);
        continue;
      }
      values.push(...found);
    }
  }
  for (const v of values) if (v.trim() !== "") keepSecret(v.trim());
  return logs;
}
