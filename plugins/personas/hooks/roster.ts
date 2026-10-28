// roster.ts: the roster validator and writer behind fleet_add and
// fleet_retire. Three readers parse the roster at three strictnesses, so one
// entry the tool writes is held here to the strictest rule each reader owns,
// and to the launch checks the supervisor runs on the values a keeper hands
// it. Each rule below names its owning reader in a comment, and
// test-personas/fleet-roster-tools-unit-test.mjs pins the agreement the other
// way: a fixture this module accepts is parsed by the PowerShell readers in
// the keeper suites, and a fixture it refuses for each strict rule is refused
// by the reader that owns the rule.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts and refuses the whole module
// where `$` crosses an import, so this file takes a RosterHost that
// hooks/index.ts builds over `$` with hostOf, as hooks/fleet.ts does.

import type { PluginHost } from "./host";
import { FREE_TEXT_MAX, safeErrorText } from "./text";

// What the roster tools need from the host: the writes the roster write
// makes, and the two directory reads the add tool's working-directory checks
// make. The host offers no rename, so the write below is a backup write
// followed by a roster write and not an atomic replace.
export type RosterHost = Pick<PluginHost, "writeFile" | "fileExists" | "listDir">;

// --- The closed field list ---

// Every field a roster entry may carry through the tools, in the order the
// entry is written. The list is the roster paragraph of the README's Process
// keeper section plus `repo`. `enabled` is not on it: the add tool writes it
// true and the retire tool writes it false, and an input carrying it is
// refused as an unknown key, so a reader loosened on that field later still
// reds the pin. A plan that gives the roster a new field widens this list.
export const ROSTER_FIELDS = [
  "name",
  "workdir",
  "permissionMode",
  "rundir",
  "channelName",
  "model",
  "effort",
  "controllerTickMs",
  "nudgeFloorMs",
  "nudgeIdleMs",
  "memoryGateDiscardPercent",
  "channelLogRetentionDays",
  "journalRetentionDays",
  "coordinatorPersona",
  "architectPersona",
  "liaisonPersona",
  "fleetRoster",
  "jevMode",
  "jevLive",
  "args",
  "repo",
  "goal",
  "lifetime",
] as const;

export type RosterField = (typeof ROSTER_FIELDS)[number];

// The three fields the keeper's invocation builder throws without:
// bin/keeper-functions.ps1 Build-SupervisorInvocation reads them as the
// supervisor's three positional arguments.
const REQUIRED_FIELDS: readonly RosterField[] = ["name", "workdir", "permissionMode"];

// One roster entry as the add tool writes it: the fields the caller gave, in
// ROSTER_FIELDS order, then `enabled` true.
export type WrittenRosterEntry = {
  name: string;
  workdir: string;
  permissionMode: string;
  rundir?: string;
  channelName?: string;
  model?: string;
  effort?: string;
  controllerTickMs?: number;
  nudgeFloorMs?: number;
  nudgeIdleMs?: number;
  memoryGateDiscardPercent?: number;
  channelLogRetentionDays?: number;
  journalRetentionDays?: number;
  coordinatorPersona?: string;
  architectPersona?: string;
  liaisonPersona?: string;
  fleetRoster?: string;
  jevMode?: string;
  jevLive?: string[];
  args?: string[];
  repo?: string;
  goal?: { objective: string; done: string[]; turns?: number };
  lifetime?: string;
  enabled: true;
};

export type RosterValidation = { ok: true; entry: WrittenRosterEntry } | { ok: false; refusal: string };

// --- The rules, each with its owning reader ---

// The persona name: bin/Register-PersonaTasks.ps1 Read-PersonaRoster, the
// strictest reader, matches `\A[A-Za-z0-9_][A-Za-z0-9_-]*\z`. A JavaScript
// `$` with no `m` flag matches only at the end of the input, never before a
// final line feed, so this regex refuses a name ending in a newline as the
// PowerShell `\z` does.
const PERSONA_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

// A role field: bin/agentic-common.sh valid_persona_name, letters, digits,
// underscore and hyphen, with no rule on the first character.
const ROLE_NAME_RE = /^[A-Za-z0-9_-]+$/;

// The model: bin/supervise.sh plausible_model_name, which the MODEL override
// a keeper hands over is checked against.
const MODEL_RE = /^[a-z0-9][a-z0-9.-]*(\[[a-z0-9.-]+\])?$/;

// The effort: bin/supervise.sh's EFFORT case.
const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

// jevMode: bin/agentic-common.sh emit_settings_json's JEV_MODE case.
const JEV_MODES: readonly string[] = ["off", "shadow"];

// jevLive ids: bin/agentic-common.sh JEV_PROMOTABLE_SET_IDS, which
// jev_live_to_csv refuses any JEV_LIVE id outside.
const JEV_PROMOTABLE_SET_IDS: readonly string[] = [
  "turn-open",
  "turn-disposition",
  "memory-kind",
  "turn-score",
  "controller-decision",
  "step-effort",
];

// args elements: the two flags of bin/supervise.sh's option loop that no
// entry field already carries.
const SUPERVISOR_ARGS: readonly string[] = ["--dev", "--no-channel"];

// A whole number as bin/supervise.sh positive_number takes it: digits only, no
// leading zero, at most nine digits, at least its minimum. A JSON integer in
// that range prints as exactly such digits, so the check here is on the
// number's value; a string of digits, which the readers would pass through,
// is refused as the wrong type because the add tool's schema hands integers.
const POSITIVE_NUMBER_MAX = 999_999_999;

// The numeric fields and the bound bin/supervise.sh checks each against:
// the three cadences and the two retention counts take positive_number's plain
// rule, and memoryGateDiscardPercent is a percent from 50 to 100, the one
// field with an upper bound below nine digits (supervise.sh's memory gate
// check).
const NUMBER_BOUNDS: Readonly<Record<string, { min: number; max: number }>> = {
  controllerTickMs: { min: 1, max: POSITIVE_NUMBER_MAX },
  nudgeFloorMs: { min: 1, max: POSITIVE_NUMBER_MAX },
  nudgeIdleMs: { min: 1, max: POSITIVE_NUMBER_MAX },
  memoryGateDiscardPercent: { min: 50, max: 100 },
  channelLogRetentionDays: { min: 1, max: POSITIVE_NUMBER_MAX },
  journalRetentionDays: { min: 1, max: POSITIVE_NUMBER_MAX },
};

// The string fields whose value reaches a bash launch line or a path compare
// and so takes the glob rule below. `model` is left off because MODEL_RE owns
// its one `[`, and `repo` because its shape check admits none of the three.
const GLOB_CHECKED_FIELDS: readonly string[] = [
  "name",
  "workdir",
  "permissionMode",
  "rundir",
  "channelName",
  "coordinatorPersona",
  "architectPersona",
  "liaisonPersona",
  "fleetRoster",
  "jevLive",
  "args",
];

// The text rule every string field and array element outside the goal block
// takes, since the goal reaches no command line or shell: no control
// character and no double quote, since the keeper's ConvertTo-NativeArgument
// quotes a token with a quote in it for a command line a quote can break out
// of, and the shell halves read each value unescaped. The glob rule is for
// the fields that reach bash unquoted: ConvertTo-NativeArgument passes a token
// with no whitespace or quote verbatim, and MSYS expands `*`, `?` and `[` in
// such a token into file names (docs/backlog.md, the accepted-risk item on
// glob characters), so the tool never writes one.
export function rosterTextProblem(text: string, globChecked: boolean): string | null {
  if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(text)) return "must not hold a control character";
  if (text.includes('"')) return "must not hold a double quote";
  if (globChecked && /[*?[]/.test(text)) return "must not hold '*', '?' or '[', which bash expands in an unquoted argument";
  return null;
}

// --- The repository URL ---

// `repo` is one of two plain shapes and nothing else: `https://<host>/<path>`
// with no userinfo, port, query or fragment, and `git@<host>:<path>`. A host
// is dot-separated labels of letters, digits and hyphens. A path is slash-
// separated segments of letters, digits, underscore, hyphen and dot, each
// starting with something other than a dot, so no segment is `.` or `..`,
// with one trailing slash allowed. The fleet supervisor runs `git clone` on
// the value, so neither shape can start with a hyphen or name a local path.
const HOST_PATTERN = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*";
const SEGMENT_PATTERN = "[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*";
const PATH_PATTERN = `${SEGMENT_PATTERN}(?:/${SEGMENT_PATTERN})*/?`;
const HTTPS_REPO_RE = new RegExp(`^https://(${HOST_PATTERN})/(${PATH_PATTERN})$`);
const SSH_REPO_RE = new RegExp(`^git@(${HOST_PATTERN}):(${PATH_PATTERN})$`);

function repoParts(url: string): { host: string; path: string } | null {
  const m = HTTPS_REPO_RE.exec(url) ?? SSH_REPO_RE.exec(url);
  if (!m) return null;
  return { host: m[1], path: m[2] };
}

// Lowercases a string's ASCII letters and nothing else. The name compare
// mirrors Read-PersonaRoster's OrdinalIgnoreCase set, and a locale-aware
// lowercase would fold letters that set does not.
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

// The form two spellings of one repository compare equal in: the host and the
// path lowercased in ASCII, one trailing slash and then one trailing `.git` stripped, and
// both shapes rendered as `<host>/<path>`. Null for a value outside the two
// shapes, which the validator refuses before this is read.
export function normalizeRepoUrl(url: string): string | null {
  const parts = repoParts(url);
  if (!parts) return null;
  let path = parts.path;
  if (path.endsWith("/")) path = path.slice(0, -1);
  if (path.endsWith(".git")) path = path.slice(0, -".git".length);
  return `${asciiLower(parts.host)}/${asciiLower(path)}`;
}

// --- One entry's own fields ---

// A path compare for `fleetRoster` against the roster being written: both are
// Windows paths on this fleet, so backslashes are read as forward slashes and
// case is folded before the compare.
function samePath(a: string, b: string): boolean {
  return asciiLower(a.replace(/\\/g, "/")) === asciiLower(b.replace(/\\/g, "/"));
}

// Whether `path` is `dir` or lies under it, the compare the add tool's
// run-directory refusal makes: both sides read with backslashes as forward
// slashes, ASCII case folded and trailing slashes stripped, then `path` is
// under `dir` where the two are equal or `path` starts with `dir` and a
// slash. A relative or dot-segment path is compared as written, since no
// reader of the roster resolves or refuses one.
export function rosterPathWithin(path: string, dir: string): boolean {
  const form = (p: string) => asciiLower(p.replace(/\\/g, "/")).replace(/\/+$/, "");
  const p = form(path);
  const d = form(dir);
  return p === d || p.startsWith(`${d}/`);
}

function numberProblem(field: string, value: unknown): string | null {
  const bound = NUMBER_BOUNDS[field];
  if (typeof value !== "number" || !Number.isInteger(value)) return "must be a whole number";
  if (value < bound.min || value > bound.max) {
    return bound.max === POSITIVE_NUMBER_MAX
      ? `must be a whole number of at least ${bound.min} with at most nine digits`
      : `must be a whole number from ${bound.min} to ${bound.max}`;
  }
  return null;
}

function stringProblem(field: string, value: unknown, rosterPath: string): string | null {
  if (typeof value !== "string") return "must be a string";
  if (value.trim() === "") return "must not be blank";
  const text = rosterTextProblem(value, GLOB_CHECKED_FIELDS.includes(field));
  if (text) return text;
  switch (field) {
    case "name":
      // Read-PersonaRoster's name rule.
      if (!PERSONA_NAME_RE.test(value)) return "must start with a letter, digit or underscore and hold only letters, digits, underscore and hyphen after that";
      return null;
    case "model":
      // supervise.sh's plausible_model_name.
      if (!MODEL_RE.test(value)) return "is not a plausible model name: lowercase letters, digits, '.' and '-', starting with a letter or digit, with an optional bracketed suffix such as '[1m]'";
      return null;
    case "effort":
      // supervise.sh's EFFORT case.
      if (!EFFORTS.includes(value)) return `must be one of ${EFFORTS.join(", ")}`;
      return null;
    case "jevMode":
      // agentic-common.sh's JEV_MODE case.
      if (!JEV_MODES.includes(value)) return `must be one of ${JEV_MODES.join(", ")}`;
      return null;
    case "coordinatorPersona":
    case "architectPersona":
    case "liaisonPersona":
      // agentic-common.sh emit_settings_json: valid_persona_name, and never
      // `default`, the persona every unnamed launch carries.
      if (!ROLE_NAME_RE.test(value)) return "may hold only letters, digits, underscore and hyphen";
      if (value === "default") return "must not be 'default'";
      return null;
    case "fleetRoster":
      // The README's Process keeper section: the roster the fleet reading
      // watches and the roster the keeper launched from must be one file.
      if (!samePath(value, rosterPath)) return `must name the roster being written, ${rosterPath}`;
      return null;
    case "repo":
      if (!repoParts(value)) return "must be https://<host>/<path> with no userinfo, port, query or fragment, or git@<host>:<path>";
      return null;
    default:
      // workdir, permissionMode, rundir and channelName: Build-
      // SupervisorInvocation reads each as text and checks nothing further.
      return null;
  }
}

function arrayProblem(field: string, value: unknown): string | null {
  // Build-SupervisorInvocation throws on a jevLive that is not an array and
  // reads args as an array; a non-string element is refused here since the
  // keeper would stringify it into the launch line.
  if (!Array.isArray(value)) return "must be an array of strings";
  for (let i = 0; i < value.length; i++) {
    const element: unknown = value[i];
    if (typeof element !== "string") return `element ${i} must be a string`;
    if (element.trim() === "") return `element ${i} must not be blank`;
    const text = rosterTextProblem(element, true);
    if (text) return `element ${i} ${text}`;
    if (field === "args") {
      // Build-SupervisorInvocation refuses --prompt with PowerShell's
      // case-insensitive -eq: every persona launches passive.
      const folded = asciiLower(element);
      if (folded === "--prompt" || folded.startsWith("--prompt=")) {
        return `must not carry --prompt, which the keeper refuses since every persona launches passive (element ${i})`;
      }
      // supervise.sh's option loop matches case-sensitively and exits on an
      // unknown option. Build-SupervisorInvocation appends args after the
      // entry's own rundir and channelName, so an args --rundir or
      // --channel-name would override those fields; only the two flags remain.
      if (!SUPERVISOR_ARGS.includes(element)) {
        return `element ${i} '${element}' must be --dev or --no-channel, the two supervise.sh options an entry passes in args`;
      }
    }
    if (field === "jevLive" && !JEV_PROMOTABLE_SET_IDS.includes(element)) {
      // agentic-common.sh jev_live_to_csv.
      return `element ${i} '${element}' is not in the promotable set ${JEV_PROMOTABLE_SET_IDS.join(", ")}`;
    }
  }
  return null;
}

// The lifetime values: Build-SupervisorInvocation's lifetime check and
// agentic-common.sh emit_settings_json's LIFETIME case, each compared
// byte-exact, so a value is matched as written and never trimmed or folded.
const LIFETIMES: readonly string[] = ["standing", "goal"];

// The goal block's three keys. The process keeper writes the block to
// goal.json as the roster holds it and checks none of its shape, so this is
// the shape's one check on the tool's write.
const GOAL_KEYS: readonly string[] = ["objective", "done", "turns"];

// The most done statements a goal carries, since every statement is rendered
// into the goal persona's context on every turn.
export const GOAL_DONE_MAX = 20;

// One goal text: a string, not blank, and under FREE_TEXT_MAX, the bound the
// plugin holds every free text it stores to.
function goalTextProblem(value: unknown): string | null {
  if (typeof value !== "string") return "must be a string";
  if (value.trim() === "") return "must not be blank";
  if (value.length >= FREE_TEXT_MAX) return `must be under ${FREE_TEXT_MAX} characters`;
  return null;
}

// The goal block: an object of objective and done, and turns where given, and
// no other key. done may be empty, and holds at most GOAL_DONE_MAX. turns is
// a whole number of at least 1 and at most the largest integer a JSON number
// carries exactly.
export function goalProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "must be an object of objective, done and an optional turns";
  }
  const goal = value as Record<string, unknown>;
  for (const key of Object.keys(goal)) {
    if (!GOAL_KEYS.includes(key)) return `key '${key}' is not one of ${GOAL_KEYS.join(", ")}`;
  }
  if (!("objective" in goal)) return "must carry objective";
  if (!("done" in goal)) return "must carry done";
  const objective = goalTextProblem(goal.objective);
  if (objective) return `objective ${objective}`;
  if (!Array.isArray(goal.done)) return "done must be an array of strings";
  if (goal.done.length > GOAL_DONE_MAX) return `done must hold at most ${GOAL_DONE_MAX} statements`;
  for (let i = 0; i < goal.done.length; i++) {
    const element = goalTextProblem(goal.done[i]);
    if (element) return `done element ${i} ${element}`;
  }
  if ("turns" in goal) {
    const turns = goal.turns;
    if (typeof turns !== "number" || !Number.isSafeInteger(turns) || turns < 1) return "turns must be a whole number of at least 1";
  }
  return null;
}

function fieldProblem(field: RosterField, value: unknown, rosterPath: string): string | null {
  if (field in NUMBER_BOUNDS) return numberProblem(field, value);
  if (field === "jevLive" || field === "args") return arrayProblem(field, value);
  if (field === "goal") return goalProblem(value);
  if (field === "lifetime") {
    if (typeof value !== "string" || !LIFETIMES.includes(value)) return `must be one of ${LIFETIMES.join(", ")}`;
    return null;
  }
  return stringProblem(field, value, rosterPath);
}

// The persona-role rules bin/agentic-common.sh emit_settings_json checks at
// each launch against the names the entry itself carries: the coordinator
// defaults to `coordinator` where the entry names none, the architect cannot
// be the coordinator, and the liaison cannot be either and needs an architect
// beside it. Each field's own charset and `default` rule is the validator's;
// this reads the three names together. Exported on its own so the add tool
// can name the rule it refused on.
export function rosterRoleProblem(entry: { coordinatorPersona?: unknown; architectPersona?: unknown; liaisonPersona?: unknown }): string | null {
  const coordinator = typeof entry.coordinatorPersona === "string" ? entry.coordinatorPersona : "coordinator";
  const architect = typeof entry.architectPersona === "string" ? entry.architectPersona : "";
  const liaison = typeof entry.liaisonPersona === "string" ? entry.liaisonPersona : "";
  if (architect !== "" && architect === coordinator) {
    return `field 'architectPersona' and the coordinator persona are both '${architect}'; one persona cannot hold both seats`;
  }
  if (liaison !== "") {
    if (liaison === coordinator) return `field 'liaisonPersona' and the coordinator persona are both '${liaison}'; one persona cannot hold both seats`;
    if (liaison === architect) return `field 'liaisonPersona' and field 'architectPersona' are both '${liaison}'; one persona cannot hold both seats`;
    if (architect === "") return "field 'liaisonPersona' needs field 'architectPersona', since the liaison sends its briefs to the architect";
  }
  return null;
}

// The liaison names the mode rule binds: the `liaisonPersona` of each enabled
// entry already in the roster, plus the new entry's own, since the add tool
// writes it enabled. An entry that is not an object, is not enabled or
// carries no string `liaisonPersona` is skipped, never refused, since a
// legacy entry a hand edit left loose blocks no add.
function liaisonNames(existing: readonly unknown[], own: unknown): string[] {
  const names: string[] = [];
  for (const entry of existing) {
    if (typeof entry !== "object" || entry === null) continue;
    const { enabled, liaisonPersona } = entry as { enabled?: unknown; liaisonPersona?: unknown };
    if (enabled === true && typeof liaisonPersona === "string") names.push(asciiLower(liaisonPersona));
  }
  if (typeof own === "string") names.push(asciiLower(own));
  return names;
}

// Whether an enabled entry already in the roster carries the name, compared
// ignoring ASCII case, on a mode other than default. An entry that is not an
// object, is not enabled, or carries no string name or no string
// permissionMode is skipped, never refused, since a legacy entry a hand edit
// left loose blocks no add.
function namedEntryOffDefault(existing: readonly unknown[], name: string): boolean {
  const wanted = asciiLower(name);
  for (const entry of existing) {
    if (typeof entry !== "object" || entry === null) continue;
    const { enabled, name: given, permissionMode } = entry as { enabled?: unknown; name?: unknown; permissionMode?: unknown };
    if (enabled !== true || typeof given !== "string" || typeof permissionMode !== "string") continue;
    if (asciiLower(given) === wanted && permissionMode !== "default") return true;
  }
  return false;
}

// Validates one entry's own fields against every rule above and returns the
// entry as the add tool will write it, or the first refusal as a sentence
// naming the field and the rule. The cross-entry rules, name and repository
// uniqueness, are rosterNameTaken and rosterRepoTaken below, and no entry
// already in the roster is re-validated by any of them. rosterPath is the
// roster the entry is written into, which `fleetRoster` must name. existing
// is the roster's entries as read, which the liaison mode rule reads for the
// names enabled entries give their liaison.
export function validateRosterEntry(input: unknown, rosterPath: string, existing: readonly unknown[] = []): RosterValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, refusal: "the entry must be a JSON object" };
  }
  const given = input as Record<string, unknown>;
  for (const key of Object.keys(given)) {
    if (!(ROSTER_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, refusal: `field '${key}' is not a roster field: the roster fields are ${ROSTER_FIELDS.join(", ")}, and enabled is written by the tool` };
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in given)) return { ok: false, refusal: `field '${field}' is required` };
  }
  const out: Record<string, unknown> = {};
  for (const field of ROSTER_FIELDS) {
    if (!(field in given)) continue;
    const problem = fieldProblem(field, given[field], rosterPath);
    if (problem) return { ok: false, refusal: `field '${field}' ${problem}` };
    out[field] = given[field];
  }
  const role = rosterRoleProblem(out);
  if (role) return { ok: false, refusal: role };
  // The liaison seat's mode: docs/persona-security-model.md states that a
  // liaison entry is the one roster seat outside bypassPermissions and runs
  // on the default mode, and no reader of the roster checks it, so this is
  // the rule's one check. It has two halves, so the order two entries are
  // added in cannot seat a liaison off default. The first refuses the new
  // entry where an enabled entry, or the entry itself, names it as the
  // liaison and its own mode is not default. The second refuses the new entry
  // where its liaisonPersona names another enabled entry already in the
  // roster whose mode is not default. Either binds the tool's write alone and
  // refuses only the new entry; no entry already in the roster is
  // re-validated, and a hand edit is the operator's own state. A non-liaison
  // entry on default is left alone.
  const name = out.name as string;
  if (out.permissionMode !== "default" && liaisonNames(existing, out.liaisonPersona).includes(asciiLower(name))) {
    return {
      ok: false,
      refusal: `field 'permissionMode' must be 'default' for '${name}', which an enabled entry or the entry itself names as its liaisonPersona, since docs/persona-security-model.md states that a liaison entry is the one roster seat outside bypassPermissions`,
    };
  }
  const liaison = out.liaisonPersona;
  if (typeof liaison === "string" && asciiLower(liaison) !== asciiLower(name) && namedEntryOffDefault(existing, liaison)) {
    return {
      ok: false,
      refusal: `field 'permissionMode' of the enabled entry '${liaison}', which this entry names as its liaisonPersona, is not 'default', and docs/persona-security-model.md states that a liaison entry is the one roster seat outside bypassPermissions`,
    };
  }
  out.enabled = true;
  return { ok: true, entry: out as WrittenRosterEntry };
}

// --- The cross-entry rules ---

// Whether any entry, enabled or disabled, already carries the name, compared
// as Read-PersonaRoster compares names: ignoring ASCII case. An entry that is
// not an object or carries no string name is skipped, never refused, since a
// legacy entry a hand edit left loose blocks no add.
export function rosterNameTaken(entries: readonly unknown[], name: string): boolean {
  const wanted = asciiLower(name);
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const existing = (entry as { name?: unknown }).name;
    if (typeof existing === "string" && asciiLower(existing) === wanted) return true;
  }
  return false;
}

// Whether an enabled entry already carries the repository, compared after
// normalizeRepoUrl on both sides, since the operator runs one worker per
// repository. A disabled entry's repository does not count: its worker is
// down. An entry whose repo does not normalize is skipped.
export function rosterRepoTaken(entries: readonly unknown[], repo: string): boolean {
  const wanted = normalizeRepoUrl(repo);
  if (wanted === null) return false;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { enabled, repo: existing } = entry as { enabled?: unknown; repo?: unknown };
    if (enabled !== true || typeof existing !== "string") continue;
    if (normalizeRepoUrl(existing) === wanted) return true;
  }
  return false;
}

// --- The write ---

// The roster's text: the array pretty-printed with two-space indentation,
// every line ended with a line feed and the file ended with one, which is
// bin/fleet.example.json's shape as the index holds it.
export function rosterText(entries: readonly unknown[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

export type RosterWrite =
  | { ok: true; backupPath: string; text: string }
  | { ok: false; backupPath: string; backupWritten: boolean; problem: string };

// Writes the roster as one backup write followed by one roster write. The
// caller hands in the roster text it read and checked, which goes to
// `<roster>.prev` first, and the array goes to the roster only once that
// backup is on disk, so a roster write that fails leaves the previous content
// recoverable beside it and a backup that cannot be written leaves the roster
// untouched. Nothing here reads the file, so the backup is the text the
// caller's checks ran over. The host offers no rename, so a
// reader landing between the two writes may parse a truncated file. Read-
// FleetRoster throws on it, and the fleet supervisor logs the fault, leaves
// every live keeper alone and reads again next tick. Read-KeeperRoster throws
// too, which fails the keeper boot that called it. Read-PersonaRoster throws
// in Register-PersonaTasks.ps1, which fails that registration run.
export async function writeRoster(host: RosterHost, rosterPath: string, entries: readonly unknown[], current: string): Promise<RosterWrite> {
  const backupPath = `${rosterPath}.prev`;
  try {
    await host.writeFile(backupPath, current);
  } catch (err) {
    return { ok: false, backupPath, backupWritten: false, problem: `the backup ${backupPath} could not be written, so the roster was left as it was: ${safeErrorText(err)}` };
  }
  const text = rosterText(entries);
  try {
    await host.writeFile(rosterPath, text);
  } catch (err) {
    return { ok: false, backupPath, backupWritten: true, problem: `the roster ${rosterPath} could not be written after its backup ${backupPath} was: ${safeErrorText(err)}` };
  }
  return { ok: true, backupPath, text };
}
