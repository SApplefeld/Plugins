// The memory-recognition index the module matches in process: every `cmd:`
// trigger the memory snapshot's rows declare, in the tiers the kit's
// recognition hook (plugins/grimoire/hooks/memory-recognition-nudge.js) reads
// at a tool call, matched against a Bash or PowerShell command by that hook's
// containment rule. Nothing here reads a file, spawns a process or holds a `$`:
// hooks/index.ts reads the snapshot and runs RECOGNITION_SCOPE_SCRIPT, and
// hands the text and the answer to the functions below.
//
// The index admits the rows and `cmd:` entries the hook's index admits, by
// the hook's name and trigger bars and its per-tier row bound. The hook reads
// a row's name through memq's isMemoryFilename, and its triggers through
// memq's frontmatterTriggers over the frontmatter text its rowText lays the
// row out as, where triggerEntryFault refuses an entry memq's grammar does not
// admit. This module runs in the engine and cannot require memq, so the
// functions below restate the `cmd:` branch of those readers and the hook's
// per-tier row bound, each constant under the name it carries in memq.js or
// the hook. The hook's INDEX_SERIALIZED_CAP, which ends a tier's index once
// its serialized records pass 1 MiB, is not restated, so a tier whose records
// pass it indexes more records here than in the hook.
// test-personas/controller-tick-test.mjs runs the real memq.js and the hook's
// own buildRowIndex over the same rows, every refusal class among them, and
// pins both to one answer, the constants included. The match is shared with
// the hook through test-personas/fixtures/recognition-containment.json, whose
// cases run through this matcher and through the hook's collectHits, as do
// the comparison budget's cases.

// Characters of command text one match runs over, the hook's MATCH_TEXT_CAP.
// A longer command is read as its head and its tail joined by a line break,
// which no trigger pattern can carry, so the join cannot spell a match
// neither end holds.
export const RECOGNITION_TEXT_CAP = 65_536;

// The bounds on a `cmd:` pattern, memq's TRIGGER_PATTERN_MIN and
// TRIGGER_PATTERN_CAP: a shorter or a longer one is refused.
export const RECOGNITION_PATTERN_MIN = 4;
export const RECOGNITION_PATTERN_MAX = 256;

// Entries read from one row's triggers, memq's TRIGGER_ENTRIES_MAX. A refused
// entry counts toward it, and the entries past it are not read.
export const RECOGNITION_ENTRIES_MAX = 32;

// Characters of a row's joined triggers value read, memq's TRIGGER_VALUE_CAP:
// its longest entry and a separator, for each of RECOGNITION_ENTRIES_MAX
// entries. A longer value loses its last piece whole.
export const RECOGNITION_VALUE_MAX = 8_448;

// The patterns memq's bare-token bar refuses for a `cmd:` entry, compared
// without case, memq's TRIGGER_COMMON_TOKENS.
export const RECOGNITION_COMMON_TOKENS: ReadonlySet<string> = new Set([
  "git", "npm", "node", "cd", "ls", "cat", "echo", "sed", "grep", "find", "rm", "cp", "mv",
  "pwsh", "bash", "sh", "dotnet", "python", "curl", "test", "run", "build",
]);

// The characters memq refuses anywhere in a pattern, its ANCHOR_INVISIBLE:
// controls, invisible and direction-changing format characters, variation
// selectors, the tag block, and the double quote.
const PATTERN_INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFE00-\uFE0F\uFEFF"]|\uDB40[\uDC00-\uDC7F\uDD00-\uDDEF]/;

// Characters of a record's name, memq's NAME_CAP, the bound isMemoryFilename
// holds a name to before its `.md`.
export const RECOGNITION_NAME_MAX = 80;

// Characters of the frontmatter text the hook lays a row out as and reads,
// the hook's RECORD_READ_CAP. A row whose text runs past it loses its closing
// fence, and memq reads no triggers from a block that never closes.
export const RECOGNITION_ROW_TEXT_MAX = 65_536;

// Rows one tier's index takes, the hook's INDEX_RECORDS_MAX: the first that
// many rows carrying a string name, in name order, before any is screened.
export const RECOGNITION_ROWS_MAX = 512;

// `cmd:` trigger comparisons one call makes across the whole index, the
// hook's MATCH_OPS_MAX. The hook charges a candidate of every trigger type
// its boundary reads, and this index holds `cmd:` triggers alone, so here the
// budget counts `cmd:` candidates alone.
export const RECOGNITION_OPS_MAX = 2_048;

// How long after a scope run that did not answer the next may start. A scope
// that answered is the session's, whatever it said.
export const RECOGNITION_SCOPE_RETRY_MS = 10 * 60_000;

// Tool calls after a match within which a `memq get` of the record counts as
// the session acting on it.
export const RECOGNITION_ACT_WINDOW = 3;

// The snapshot index version this reads, memory-database.js's
// SNAPSHOT_INDEX_VERSION. A file of any other version gives an empty index.
export const RECOGNITION_SNAPSHOT_VERSION = 1;

// The trigger type matched here and its prefix on a row's `triggers` entry.
const CMD_PREFIX = "cmd:";

// The three tiers in the hook's precedence order.
export type RecognitionTier = "project" | "type" | "operator";

// What one session's index is built for, as the kit's own resolvers answered
// it under the session's launch directory and environment: whether the hook
// would read the snapshot at all, the project key the snapshot's `projects`
// map is keyed by, the type the project declares, and whether memq compares
// a name with the index name without case, as it does on Windows. A null key
// or type leaves that tier out, as the hook leaves a refused tier out.
export type RecognitionScope = { serves: boolean; projectKey: string | null; projectType: string | null; namesFoldCase: boolean };

// One record's `cmd:` triggers, each as the entry the row carries and the
// pattern folded for comparison.
export type RecognitionRecord = {
  tier: RecognitionTier;
  name: string;
  description: string;
  triggers: ReadonlyArray<{ entry: string; folded: string }>;
};

export type RecognitionIndex = readonly RecognitionRecord[];

// One record a command matched: its tier, name and description, and the first
// of its triggers the command carries, as the row spells it.
export type RecognitionMatch = { tier: RecognitionTier; name: string; description: string; trigger: string };

// A command's text folded for matching, the hook's foldText: lowercased, and
// past RECOGNITION_TEXT_CAP its head and tail halves joined by a line break.
export function foldCommandText(text: string): string {
  if (text === "") return "";
  if (text.length <= RECOGNITION_TEXT_CAP) return text.toLowerCase();
  const half = Math.floor(RECOGNITION_TEXT_CAP / 2);
  return (text.slice(0, half) + "\n" + text.slice(text.length - half)).toLowerCase();
}

// The command text a tool call carries for a `cmd:` match, the hook's
// commandText: the `command` of a tool named bash or powershell in any case,
// and "" for every other tool, so a `command` key on a non-shell tool's input
// is never read as a shell line.
export function shellCommandOf(tool: unknown, command: unknown): string {
  if (typeof tool !== "string" || !/^(bash|powershell)$/i.test(tool)) return "";
  return typeof command === "string" ? command : "";
}

// Whether a row's name names a record, memq's isMemoryFilename over the name
// and its `.md`: at most RECOGNITION_NAME_MAX characters of the filename
// charset, not a path token, and not the index name, which memq compares
// without case where `namesFoldCase` holds.
function recordNameAdmitted(name: string, namesFoldCase: boolean): boolean {
  if (name.length === 0 || name.length > RECOGNITION_NAME_MAX) return false;
  if (!/^[\w.-]+$/.test(name)) return false;
  if (name === "." || name === "..") return false;
  return namesFoldCase ? name.toLowerCase() !== "memory" : name !== "MEMORY";
}

// Whether a `cmd:` entry's pattern is one memq's triggerEntryFault admits: its
// isTriggerPattern, then the length floor, then the bare-token bar.
function cmdPatternAdmitted(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > RECOGNITION_PATTERN_MAX) return false;
  if (PATTERN_INVISIBLE.test(pattern)) return false;
  if (/[^\S ]/.test(pattern)) return false;
  if (pattern !== pattern.trim()) return false;
  if (pattern.includes(": ") || pattern.endsWith(":")) return false;
  if (pattern.includes(" #")) return false;
  if (pattern.includes("'") || pattern.includes("[") || pattern.includes("\\") || pattern.includes(",")) return false;
  if (pattern.length < RECOGNITION_PATTERN_MIN) return false;
  return !RECOGNITION_COMMON_TOKENS.has(pattern.toLowerCase());
}

// A row's `cmd:` triggers as the hook's index takes them. The hook lays the
// row's triggers and anchors out as frontmatter lines, each list without an
// entry that is not a string, is empty, holds a line break or holds a comma,
// and reads that text to RECOGNITION_ROW_TEXT_MAX, so a text past it has no
// closing fence and gives no triggers. memq reads the triggers value from its
// first character that is not a space, to RECOGNITION_VALUE_MAX, splits it at
// each comma, trims each piece, skips an empty one, reads at most
// RECOGNITION_ENTRIES_MAX, and keeps each `cmd:` entry whose pattern it
// admits.
function cmdTriggersOf(row: Record<string, unknown>): Array<{ entry: string; folded: string }> {
  const list = (value: unknown): string[] => (Array.isArray(value)
    ? value.filter((e): e is string => typeof e === "string" && e !== "" && !/[\r\n\u2028\u2029]/.test(e) && !e.includes(","))
    : []);
  const triggers = list(row.triggers);
  if (triggers.length === 0) return [];
  const anchors = list(row.anchors);
  const lines = ["---", `triggers: ${triggers.join(", ")}`, ...(anchors.length > 0 ? [`anchors: ${anchors.join(", ")}`] : []), "---", ""];
  if (lines.join("\n").length - 1 > RECOGNITION_ROW_TEXT_MAX) return [];
  const value = triggers.join(", ").replace(/^\s+/, "");
  const pieces = value.slice(0, RECOGNITION_VALUE_MAX).split(",");
  if (value.length > RECOGNITION_VALUE_MAX) pieces.pop();
  const out: Array<{ entry: string; folded: string }> = [];
  let read = 0;
  for (const piece of pieces) {
    const entry = piece.trim();
    if (entry === "") continue;
    if (read >= RECOGNITION_ENTRIES_MAX) break;
    read++;
    if (!entry.startsWith(CMD_PREFIX)) continue;
    const pattern = entry.slice(CMD_PREFIX.length);
    if (cmdPatternAdmitted(pattern)) out.push({ entry, folded: pattern.toLowerCase() });
  }
  return out;
}

// One section's rows as index records, as the hook's buildRowIndex takes
// them: the rows carrying a string name, in name order, the first
// RECOGNITION_ROWS_MAX of them, and of those each whose name names a record
// and which carries at least one admitted `cmd:` trigger.
function sectionRecords(tier: RecognitionTier, rows: unknown, keep: (row: Record<string, unknown>) => boolean, scope: RecognitionScope): RecognitionRecord[] {
  if (!Array.isArray(rows)) return [];
  const named = rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && typeof r.name === "string")
    .filter(keep)
    .sort((a, b) => (a.name as string) < (b.name as string) ? -1 : (a.name as string) > (b.name as string) ? 1 : 0)
    .slice(0, RECOGNITION_ROWS_MAX);
  const out: RecognitionRecord[] = [];
  for (const row of named) {
    const name = row.name as string;
    if (!recordNameAdmitted(name, scope.namesFoldCase)) continue;
    const triggers = cmdTriggersOf(row);
    if (triggers.length === 0) continue;
    out.push({ tier, name, description: typeof row.description === "string" ? row.description : "", triggers });
  }
  return out;
}

// The snapshot's text as the index one session matches, or null where the
// text is not a snapshot index of RECOGNITION_SNAPSHOT_VERSION. The tiers are
// the hook's at a tool call, in its order: the project section under the
// scope's key, the type section's rows of the scope's type, and the operator
// section. A scope that does not serve, or a section the file lacks, gives no
// records. Each tier takes at most RECOGNITION_ROWS_MAX rows and each row at
// most RECOGNITION_ENTRIES_MAX triggers, so the index is bounded whatever the
// file holds.
export function recognitionIndexOf(text: string, scope: RecognitionScope): RecognitionIndex | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const file = parsed as Record<string, unknown>;
  if (file.version !== RECOGNITION_SNAPSHOT_VERSION) return null;
  if (!scope.serves) return [];
  const own = (holder: unknown, key: string): unknown => (holder !== null && typeof holder === "object" && !Array.isArray(holder) && Object.hasOwn(holder, key)
    ? (holder as Record<string, unknown>)[key] : undefined);
  const rowsOf = (section: unknown): unknown => own(section, "rows");
  const index: RecognitionRecord[] = [];
  if (scope.projectKey !== null) {
    index.push(...sectionRecords("project", rowsOf(own(file.projects, scope.projectKey)), () => true, scope));
  }
  if (scope.projectType !== null) {
    const type = scope.projectType;
    index.push(...sectionRecords("type", rowsOf(own(file.tiers, "type")), (row) => row.typeName === type, scope));
  }
  index.push(...sectionRecords("operator", rowsOf(own(file.tiers, "operator")), () => true, scope));
  return index;
}

// The records a tool call's command matches, in index order, each once: a
// record matches where the folded command contains one of its folded
// patterns, the hook's containment rule at a tool call, which every tier
// takes. Every trigger walked is charged against RECOGNITION_OPS_MAX, a
// record's triggers past its first hit included, as the hook charges each
// candidate, and the walk stops once the budget is spent, keeping every match
// found before it, the record it stopped inside included. A tool other than
// Bash or PowerShell matches nothing.
export function recognitionMatches(index: RecognitionIndex, tool: unknown, command: unknown): RecognitionMatch[] {
  const text = foldCommandText(shellCommandOf(tool, command));
  if (text === "") return [];
  const out: RecognitionMatch[] = [];
  const seen = new Set<string>();
  let left = RECOGNITION_OPS_MAX;
  for (const record of index) {
    let hit: { entry: string; folded: string } | null = null;
    for (const trigger of record.triggers) {
      if (left <= 0) break;
      left -= 1;
      if (hit === null && text.indexOf(trigger.folded) !== -1) hit = trigger;
    }
    const key = recognitionKeyOf(record);
    if (hit !== null && !seen.has(key)) {
      seen.add(key);
      out.push({ tier: record.tier, name: record.name, description: record.description, trigger: hit.entry });
    }
    if (left <= 0) break;
  }
  return out;
}

// The key one record is asked under, its tier and its name, the ARCHITECT
// ruling's key, which is the hook's per-call named set (its tier and name
// pair in claimHits) rather than its dedupKey, which adds the recipient, the
// boundary class, the trigger type and the pattern.
export function recognitionKeyOf(record: { tier: RecognitionTier; name: string }): string {
  return `${record.tier}\u0000${record.name}`;
}

// The program hooks/index.ts runs as `node -e` in the session's launch
// directory, with the kit's memq.js and memory-database.js paths as its two
// arguments, to learn the index's scope from the kit's own resolvers under the
// environment the session's memq spawns inherit: storeRootServesDatabase, the
// hook's redirected-root test, read under KIT_MEMORY_ROOT and
// KIT_MEMORY_ROOT_ALLOW_DATA as the hook reads it; the network-share test the
// hook stands down on, asked before the key is resolved since the key's walk
// can hang on a share; then projectKey and projectType, which a
// KIT_MEMORY_PROJECT pin reaches as it reaches the hook; and whether memq's
// isMemoryFilename refuses the index name spelled in lowercase, which is
// whether it compares names without case. It prints one JSON object and exits
// 0, every failure reading as a scope that does not serve. One line, so no
// shell or platform reads a line break in an argument.
export const RECOGNITION_SCOPE_SCRIPT = [
  "\"use strict\";",
  "let out = { serves: false, projectKey: null, projectType: null, namesFoldCase: false };",
  "try {",
  "const [memqPath, dbPath] = process.argv.slice(1);",
  "const memq = require(memqPath);",
  "const db = require(dbPath);",
  "const cwd = process.cwd();",
  "out.namesFoldCase = memq.isMemoryFilename(\"memory.md\") === false;",
  "const pinned = memq.pinnedProjectSegment();",
  "const onShare = (pinned === null && memq.namesNetworkShare(cwd)) || memq.namesNetworkShare(memq.memoryRoot());",
  "if (!onShare) {",
  "out.serves = typeof db.storeRootServesDatabase !== \"function\" || db.storeRootServesDatabase() === true;",
  "try { out.projectKey = memq.projectKey(cwd); } catch (err) { out.projectKey = null; }",
  "try { out.projectType = memq.projectType(cwd); } catch (err) { out.projectType = null; }",
  "}",
  "} catch (err) { out = { serves: false, projectKey: null, projectType: null, namesFoldCase: false }; }",
  "process.stdout.write(JSON.stringify(out));",
].join(" ");

// The scope RECOGNITION_SCOPE_SCRIPT printed, or null for output that is not
// its one JSON object.
export function recognitionScopeOf(stdout: string): RecognitionScope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.serves !== "boolean" || typeof p.namesFoldCase !== "boolean") return null;
  const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return { serves: p.serves, projectKey: text(p.projectKey), projectType: text(p.projectType), namesFoldCase: p.namesFoldCase };
}
