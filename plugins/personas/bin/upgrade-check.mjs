// bin/upgrade-check.mjs - The Claude Code upgrade check, in one process.
//
// A new engine build reaches the fleet only after one canary has run this.
// The function-hooks API is early access and changes between releases without
// notice, so every step here reads the new build itself rather than a claim
// about it. The verdict is computed from the rows, never judged: each step
// writes one row, and the last line printed names the verdict the exit code
// carries.
//
// Two verbs, because half the checks need a session that has already
// restarted onto the new build:
//
//   pre   node bin/upgrade-check.mjs pre --repo <checkout> --results <dir>
//                                        [--scratch <dir>] [--canary <persona>]
//         Steps 1 to 7, run from a scratch folder it creates empty so the
//         plugin finds no persona there and stays passive. Prints
//         "pre: clear to restart the canary onto <version> (run <id>)" where
//         steps 1 to 5 and 7 read pass or warn and step 6 reads pass or gap,
//         else "pre: triage <step list>".
//
//   post  node bin/upgrade-check.mjs post --run <id> --results <dir>
//                                         --rundir <dir> --tools <ok | fail: reason>
//         The mechanical half of step 8, written under the run id the pre
//         verdict printed, so one table holds both halves. The session that
//         runs it is the restarted one, and --tools carries the three tool
//         readings only a model can take.
//
// The steps, and what each catches:
//   1 versions   the build on disk, and the build this session is running.
//   2 types      the declarations the new build writes beside a plugin it loads
//                from a folder, read off a probe plugin made in the scratch
//                folder.
//   3 diff       what changed in that interface, and which changed names the
//                plugin's own hooks read.
//   4 compile    the hooks against the new types, with a control file the
//                types must reject. A clean exit with a compiling control
//                proves nothing, so that case reads fail.
//   5 validate   what the engine would refuse at load.
//   6 engine     the plugin's own tests through the real engine, where any
//                exist. None is a gap, never a pass.
//   7 smoke      one headless prompt, read for hooks the engine skipped,
//                results it refused and context it dropped.
//
// Results. Every row is appended to <results>/upgrade-checks.jsonl, which is
// append-only: a run adds lines and rewrites none, so the file is the record
// of every attempt at every version. <results>/upgrade-checks.md is
// regenerated whole from that file each run, and the regeneration is a pure
// function of the file's content, so a second regeneration over unchanged
// input produces the same bytes. `result` is one of a closed list: pass,
// warn, gap, fail, skipped. The files hold version strings, step names and
// evidence lines cut from command output; the smoke log itself stays in the
// scratch folder.
//
// Exits. 0 clear, 1 triage, 2 could not run, 3 failed. A missing --repo or --results, a
// --repo with no hooks/ directory, and a results directory that cannot be
// written all exit 2 before any step runs, with the reason printed: a run
// that cannot record its rows is not a run. A scratch folder that exists,
// holds files and carries no .upgrade-check-scratch marker also exits 2 and
// is left as it stands, since the scratch folder is emptied at the start of a
// run and only a folder this script made is its to empty. Every child process
// carries STEP_TIMEOUT_MS, and a step whose process outlives it reads fail
// with the evidence "timed out" rather than throwing, so the remaining steps
// still run and the verdict still prints. A child whose output passes the
// 16 MB buffer reads as that, in the same way.
//
// The engine binary is resolved against PATH by this script rather than by
// the platform. A bare command name on Windows resolves against the working
// directory before PATH, and the step's working directory is a scratch folder
// this script is about to write files into, so a file dropped there would run
// in place of the engine. The same resolution is what lets a test put a fake
// claude first on PATH. A .BAT or .CMD shim is passed over: running one needs
// cmd.exe, which substitutes the forwarded arguments into its command line
// before parsing them, and an argument carrying an odd number of quotes ends
// the quoted region and starts a second command.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TRANSCRIPT_SCAN_BYTES, transcriptPathsFor } from './supervise-liveness.mjs';

export const STEP_TIMEOUT_MS = 180000;
// The most output one child may print before it is stopped.
export const OUTPUT_CAP_BYTES = 16 * 1024 * 1024;
// The environment variables that log the engine in without a config folder,
// which step 2's probe run drops so it makes no model call.
export const PROBE_LOGIN_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
// The file a run writes into a scratch folder it made. A later run empties a
// non-empty scratch folder only where this file is in it.
export const SCRATCH_MARKER = '.upgrade-check-scratch';
export const RESULTS = Object.freeze(['pass', 'warn', 'gap', 'fail', 'skipped']);
// The heartbeat interval post waits out where <rundir>/settings.json names
// none, the same default the plugin takes.
export const DEFAULT_HEARTBEAT_MS = 30000;
// The manifest name the debug log writes the plugin under, and the five
// readings in a log line that say the engine did not take the plugin whole.
export const PLUGIN_NAME = 'personas';
export const SMOKE_PATTERNS = Object.freeze(['skipped', 'WARN', 'not attached', 'does not validate', 'refused']);
// Readings that say the engine did not load the plugin at all, which the smoke
// step reads as a fail rather than a warn. The engine logs a refused manifest
// as an ERROR line naming the plugin.
export const SMOKE_FAIL_PATTERNS = Object.freeze(['ERROR', 'Failed to load', 'invalid manifest']);
// The debug log line naming where the engine read the plugin's hooks from.
// The smoke row names that path, so the reader sees which copy of the plugin
// the run exercised: the installed one or a development checkout.
export const HOOKS_READ_PREFIX = 'Read hooks.json for plugin ' + PLUGIN_NAME + ' (enabled=true): ';
// Whether a debug log line is the engine naming the plugin: the word plugin,
// Plugin or module, then the manifest name, or the installed id on its own,
// then no further name character. The name is a plain word, so a folder such
// as D:/personas or prose carrying it is not the engine naming the plugin, and
// neither is a longer plugin name such as personas-extra. Covers "plugin
// personas:", "plugin personas@applefeld", "Plugin personas has", "Read
// hooks.json for plugin personas", "hooks module personas failed to load" and
// a bare "personas@applefeld".
const PLUGIN_NAME_RE = PLUGIN_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLUGIN_NAMED = new RegExp('(?:\\b(?:[Pp]lugin|module) ' + PLUGIN_NAME_RE + '|(?<![\\w@/.\\\\-])' + PLUGIN_NAME_RE + '@applefeld)(?![\\w-])');
export function namesPlugin(line) {
  return PLUGIN_NAMED.test(line);
}
// The lines post reads as a supervisor error since the newest launch, and the
// two a relaunch writes while the old child's heartbeat ages out, which are
// the pre-launch gate working rather than failing.
export const SUPERVISOR_ERROR_PATTERNS = Object.freeze(['ERROR', 'HEARTBEAT_ABSENT', 'RESTART']);
export const SUPERVISOR_GATE_PATTERNS = Object.freeze(['GATE', 'FAIL']);
// The note bin/supervise.sh writes on a healthy launch whose child has not
// yet stamped its heartbeat past the startup grace: the heartbeat then reads
// as not silent, which is the supervisor working. Only this shape is
// expected; a HEARTBEAT_ABSENT line in any other shape stays an error.
export const SUPERVISOR_HEARTBEAT_NOTE = /\bHEARTBEAT_ABSENT child-\d+: .* has not been written past the startup grace, so the heartbeat reads as not silent for this child$/;

// Where one line of text ends, as hooks/operator.ts reads it: CRLF, or any
// one of LF, CR, VT, FF, NEL, LINE SEPARATOR or PARAGRAPH SEPARATOR. Command
// output reaches a table cell and a printed line here, and a splitter that
// knows only LF and CR leaves five more characters that start a line the
// reader of that text will see.
const LINE_TERMINATOR = /\r\n|[\n\r\v\f\u{85}\u{2028}\u{2029}]/u;
const EVIDENCE_CAP = 600;

// One piece of command output as one line of evidence: folded on every line
// terminator, its runs of whitespace closed up, and cut to the cap. What
// makes it safe in the table is applied again at the table (cell), since the
// guard belongs to the channel the text leaves by.
export function evidenceLine(text) {
  return String(text === undefined || text === null ? '' : text)
    .split(LINE_TERMINATOR).join(' ')
    .replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ')
    .trim()
    .slice(0, EVIDENCE_CAP);
}

// One value in a markdown table cell. The cell's own separator is escaped
// and every line terminator folded, so no stored evidence can close its cell
// early and forge the columns after it. A backtick is escaped too, so stored
// text cannot open a code span that swallows the markup after it. The
// backslash goes first, so an escape this adds cannot be cancelled by one
// already in the text.
export function cell(text) {
  return String(text === undefined || text === null ? '' : text)
    .split(LINE_TERMINATOR).join(' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`');
}

// A synchronous wait, which is what a script with no event loop of its own
// has. post waits out one heartbeat interval this way.
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The named arguments of one invocation, as --flag value pairs. A flag with
 * no value, and any positional past the verb, is not this script's shape and
 * is left out rather than guessed at.
 * @param {string[]} argv
 * @returns {{verb: string, flags: Record<string,string>}}
 */
export function parseArgs(argv) {
  const list = Array.isArray(argv) ? argv.map(String) : [];
  const verb = list.length > 0 && !list[0].startsWith('--') ? list[0] : '';
  const flags = {};
  for (let i = verb ? 1 : 0; i < list.length; i += 1) {
    if (!list[i].startsWith('--')) continue;
    const name = list[i].slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) continue;
    flags[name] = next;
    i += 1;
  }
  return { verb, flags };
}

/**
 * Where a command on PATH actually is, and how to launch it. Returns the file
 * to run and the arguments that precede the caller's own, or null where no
 * directory on PATH holds it.
 *
 * Each directory is read whole before the next one, so a name with an
 * extension and one without in the same directory resolve to that directory's
 * answer rather than to the first extension found anywhere. A file whose
 * shebang names node runs through this node, so the launch never depends on
 * the platform's own association for its extension. A file whose shebang
 * names any other interpreter is passed over and the search goes on, since
 * this node would run it as the script it is not. A .BAT or .CMD shim is
 * passed over for the reason the module header gives.
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{file: string, args: string[]}|null}
 */
export function resolveCommand(name, env = process.env) {
  const isWindows = process.platform === 'win32';
  const raw = String(env.PATH || env.Path || '');
  const dirs = raw.split(isWindows ? ';' : ':').filter(Boolean);
  const skipped = new Set(['.BAT', '.CMD']);
  const exts = isWindows
    ? String(env.PATHEXT || '.COM;.EXE').split(';').filter(Boolean).filter((e) => !skipped.has(e.toUpperCase()))
    : [];
  for (const dir of dirs) {
    let base;
    try { base = path.join(dir.replace(/^"|"$/g, ''), name); } catch (e) { continue; }
    for (const candidate of [...exts.map((e) => base + e), base]) {
      let stat;
      try { stat = fs.statSync(candidate); } catch (e) { continue; }
      if (!stat.isFile()) continue;
      const interpreter = shebangOf(candidate);
      if (interpreter === null) return { file: candidate, args: [] };
      if (namesNode(interpreter)) return { file: process.execPath, args: [candidate] };
    }
  }
  return null;
}

const SHEBANG_READ_BYTES = 256;

// What a file's shebang line names, or null where the file opens without one.
// A file that cannot be read is not a script: the launch then fails on its
// own terms rather than on a guess here.
function shebangOf(file) {
  let text;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(SHEBANG_READ_BYTES);
      const n = fs.readSync(fd, buf, 0, SHEBANG_READ_BYTES, 0);
      text = buf.toString('utf8', 0, n);
    } finally { fs.closeSync(fd); }
  } catch (e) {
    return null;
  }
  if (!text.startsWith('#!')) return null;
  return text.slice(2).split(/\r?\n/)[0].trim();
}

// Whether a shebang's interpreter is node: /usr/bin/env node, or a path
// ending in /node or node.exe.
function namesNode(interpreter) {
  const parts = interpreter.split(/\s+/);
  if (parts[0] === '/usr/bin/env') return parts[1] === 'node';
  return /(?:\/node|node\.exe)$/i.test(parts[0]);
}

/**
 * One child process, run to completion under STEP_TIMEOUT_MS. Never throws:
 * a spawn that fails and a process that outlives the timeout both come back
 * as a reading, so one step cannot end the run.
 * @param {string} file
 * @param {string[]} args
 * @param {{cwd?: string, env?: object, timeoutMs?: number}} [opts]
 * @returns {{status: number|null, stdout: string, stderr: string, timedOut: boolean, error: string}}
 */
export function runChild(file, args, opts = {}) {
  const timeoutMs = opts.timeoutMs === undefined ? STEP_TIMEOUT_MS : opts.timeoutMs;
  let r;
  try {
    r = spawnSync(file, args.map(String), {
      cwd: opts.cwd,
      env: opts.env || process.env,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      windowsHide: true,
      maxBuffer: OUTPUT_CAP_BYTES,
    });
  } catch (e) {
    return { status: null, stdout: '', stderr: '', timedOut: false, error: String(e && e.message) };
  }
  // A child that printed past the buffer is killed with the same signal a
  // timeout sends, so the overflow is read first and named as itself.
  const overflowed = !!(r.error && r.error.code === 'ENOBUFS');
  // spawnSync reports a timeout two ways depending on how the kill landed:
  // an ETIMEDOUT error, or a null status with the kill signal named.
  const timedOut = !overflowed && (!!(r.error && r.error.code === 'ETIMEDOUT')
    || (r.status === null && (r.signal === 'SIGKILL' || r.signal === 'SIGTERM')));
  let error = '';
  if (overflowed) error = 'output exceeded ' + (OUTPUT_CAP_BYTES / (1024 * 1024)) + ' MB';
  else if (r.error && !timedOut) error = String(r.error.message);
  return {
    status: typeof r.status === 'number' ? r.status : null,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    timedOut,
    error,
  };
}

// The child environment for a step. Every step but step 2's probe run inherits
// this process's environment unchanged: the plugin loads with no flag from
// Claude Code 2.1.287. Step 2 copies it, sets CLAUDE_CONFIG_DIR and drops the
// login keys.
function childEnv() {
  return { ...process.env };
}

/**
 * One row, built so no caller can put a result outside the closed list into
 * the record: a value that is not one of them is recorded as fail, naming what
 * was handed in, rather than passed through. A reader of the table can then
 * take the five results as the whole set.
 * @returns {{run: string, version: string, from: string, at: string, canary: string, step: string, result: string, evidence: string}}
 */
export function row(run, version, from, canary, step, result, evidence) {
  const clean = RESULTS.includes(result) ? result : 'fail';
  const note = RESULTS.includes(result) ? evidence : 'result "' + evidenceLine(result) + '" is not one of ' + RESULTS.join(', ') + '; ' + evidence;
  return {
    run,
    version,
    from,
    at: new Date().toISOString(),
    canary,
    step,
    result: clean,
    evidence: evidenceLine(note),
  };
}

/**
 * Appends rows to the record, which is never rewritten or truncated. Each row
 * is one JSON object and one newline, so a reader that stops at a partial
 * last line loses only a line another run is still writing.
 * @param {string} resultsDir
 * @param {object[]} rows
 */
export function appendRows(resultsDir, rows) {
  const file = path.join(resultsDir, 'upgrade-checks.jsonl');
  const text = rows.map((r) => JSON.stringify(r) + '\n').join('');
  fs.appendFileSync(file, text);
}

// Every row in the record, in file order. A line that does not parse is
// passed over: the record is append-only and a partial last line is a run
// still writing, not a corrupt file.
function readRows(resultsDir) {
  let text;
  try { text = fs.readFileSync(path.join(resultsDir, 'upgrade-checks.jsonl'), 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of text.split(LINE_TERMINATOR)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o);
  }
  return out;
}

/**
 * The results table as text: one heading per version, one table per run under
 * it, newest first by the newest row in each. A pure function of the rows, so
 * regenerating over unchanged input yields the same bytes. Ties break on file
 * order, which is stable, so two runs sharing a timestamp keep their order
 * across regenerations too.
 * @param {object[]} rows
 * @returns {string}
 */
export function renderTable(rows) {
  const versions = new Map();
  rows.forEach((r, index) => {
    const version = String(r.version === undefined || r.version === null ? '' : r.version) || 'unknown';
    const run = String(r.run === undefined || r.run === null ? '' : r.run) || 'unknown';
    if (!versions.has(version)) versions.set(version, new Map());
    const runs = versions.get(version);
    if (!runs.has(run)) runs.set(run, { run, index, newest: '', rows: [] });
    const entry = runs.get(run);
    const at = String(r.at || '');
    if (at > entry.newest) entry.newest = at;
    entry.rows.push(r);
  });

  // Newest first at both levels, on the newest row each holds.
  const newestOf = (runs) => [...runs.values()].reduce((a, b) => (b.newest > a ? b.newest : a), '');
  const byNewest = (a, b) => (a.newest === b.newest ? a.index - b.index : (a.newest > b.newest ? -1 : 1));
  const ordered = [...versions.entries()]
    .map(([version, runs]) => ({
      version,
      newest: newestOf(runs),
      index: Math.min(...[...runs.values()].map((e) => e.index)),
      runs: [...runs.values()].sort(byNewest),
    }))
    .sort(byNewest);

  const out = ['# Claude Code upgrade checks', ''];
  out.push('One heading per version, one table per run under it, newest first. Regenerated whole from');
  out.push('`upgrade-checks.jsonl` by `bin/upgrade-check.mjs`, which appends to that file and rewrites it never.');
  out.push('');
  for (const version of ordered) {
    out.push('## ' + cell(version.version), '');
    for (const entry of version.runs) {
      const first = entry.rows[0] || {};
      const parts = ['run `' + cell(entry.run) + '`'];
      if (first.from) parts.push('from ' + cell(first.from));
      if (first.canary) parts.push('canary ' + cell(first.canary));
      parts.push(cell(entry.newest));
      out.push('### ' + parts.join(', '), '');
      out.push('| Step | Result | Evidence |', '|---|---|---|');
      for (const r of entry.rows) {
        out.push('| ' + cell(r.step) + ' | ' + cell(r.result) + ' | ' + cell(r.evidence) + ' |');
      }
      out.push('');
    }
  }
  return out.join('\n');
}

/**
 * Regenerates the table from the whole record.
 * @param {string} resultsDir
 * @returns {string} the text written
 */
export function regenerate(resultsDir) {
  const text = renderTable(readRows(resultsDir));
  fs.writeFileSync(path.join(resultsDir, 'upgrade-checks.md'), text);
  return text;
}

// One id per invocation, printed on the verdict line so the goal the canary
// sets before it restarts can carry it into post. The clock orders the runs
// and the suffix, always four hex characters, keeps two runs inside one
// second apart.
export function newRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return stamp + '-' + crypto.randomBytes(2).toString('hex');
}

// A reason the run cannot start at all. Thrown to the entry point, which
// prints it and exits 2 before any row is written, since a run that cannot
// record its rows is not a run.
class CannotRun extends Error {}
function cannotRun(message) {
  throw new CannotRun(message);
}

// The steps whose result decides the verdict, and what each may read. Step 1
// records versions and step 6 may read gap, since the plugin ships no engine
// tests and a missing test is not a passing one.
const PRE_VERDICT = Object.freeze({
  '1. versions': ['pass', 'warn'],
  '2. types': ['pass', 'warn'],
  '3. diff': ['pass', 'warn'],
  '4. compile': ['pass', 'warn'],
  '5. validate': ['pass', 'warn'],
  '6. engine tests': ['pass', 'gap'],
  '7. smoke': ['pass', 'warn'],
});

const POST_VERDICT = Object.freeze({
  '8a. version': ['pass', 'warn'],
  '8b. heartbeat': ['pass', 'warn'],
  '8c. supervisor log': ['pass', 'warn'],
  '8d. tools': ['pass', 'warn'],
});

/**
 * The steps a verdict reads as needing triage, in the order they ran.
 * @param {object[]} rows
 * @param {Record<string,string[]>} allowed
 * @returns {string[]}
 */
export function triageList(rows, allowed) {
  return rows.filter((r) => !(allowed[r.step] || ['pass']).includes(r.result)).map((r) => r.step);
}

// The last scanBytes of a file as text, dropping a first line the cut landed
// inside, or null where the file cannot be read. bin/supervise-liveness.mjs
// reads its transcripts' tails the same way and does not export its reader.
function readTailText(file, scanBytes) {
  let text = '';
  let scanStart = 0;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size > scanBytes) scanStart = size - scanBytes;
      const len = size - scanStart;
      const buf = Buffer.alloc(len);
      let bytesRead = 0;
      while (bytesRead < len) {
        const n = fs.readSync(fd, buf, bytesRead, len - bytesRead, scanStart + bytesRead);
        if (n === 0) break;
        bytesRead += n;
      }
      text = buf.toString('utf8', 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return null;
  }
  if (scanStart > 0) {
    const cut = text.indexOf('\n');
    text = cut >= 0 ? text.slice(cut + 1) : '';
  }
  return text;
}

// The running session's own version, off the newest record in the tail of
// the transcript CLAUDE_CODE_SESSION_ID names. Only the tail is read, the same
// TRANSCRIPT_SCAN_BYTES the liveness verdict reads, since a transcript grows
// for the life of a session and every record carries the version. 'unknown'
// where the shell carries no id, the profile cannot be named, or no record in
// the tail carries a version: the check records what it could read and never
// guesses.
export function runningSessionVersion(env = process.env) {
  const sessionId = String(env.CLAUDE_CODE_SESSION_ID || '');
  const profileRoot = String(env.USERPROFILE || env.HOME || '');
  const workdir = process.cwd();
  if (!sessionId || !profileRoot) return 'unknown';
  const { transcriptPath } = transcriptPathsFor(profileRoot, workdir, sessionId);
  if (!transcriptPath) return 'unknown';
  const text = readTailText(transcriptPath, TRANSCRIPT_SCAN_BYTES);
  if (text === null) return 'unknown';
  let version = '';
  for (const line of text.split(LINE_TERMINATOR)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o && typeof o === 'object' && typeof o.version === 'string' && o.version) version = o.version;
  }
  return version || 'unknown';
}

// The declaration names a types file defines, by the shapes the engine writes
// them in. Used to name what changed in the diff, so the step reports the
// changed names the plugin's hooks read rather than a line count alone.
// Comments are dropped first, since the engine's prose reads like a
// declaration often enough ("the one type root") to name a change that is not.
export function declarationNames(text) {
  const code = String(text || '').split(LINE_TERMINATOR).map((line) => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('/*')) return '';
    const i = line.indexOf('//');
    return i >= 0 ? line.slice(0, i) : line;
  }).join('\n');
  const names = new Set();
  const shapes = [
    /\b(?:export\s+)?(?:declare\s+)?(?:type|interface|class|enum|namespace)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:export\s+)?(?:declare\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const shape of shapes) {
    for (const m of code.matchAll(shape)) names.add(m[1]);
  }
  return names;
}

// A heartbeat's lastSeen, or null where the file holds none. The plugin
// rewrites the file in place, so a read can land between the truncate and the
// write; an unreadable read is taken again a few times before it counts.
const HEARTBEAT_READ_ATTEMPTS = 5;
const HEARTBEAT_READ_PAUSE_MS = 100;
export function readLastSeen(file) {
  for (let attempt = 1; attempt <= HEARTBEAT_READ_ATTEMPTS; attempt += 1) {
    try {
      const hb = JSON.parse(fs.readFileSync(file, 'utf8'));
      const n = hb && typeof hb === 'object' ? Number(hb.lastSeen) : NaN;
      if (Number.isFinite(n)) return n;
    } catch (e) { /* mid-write or absent; read again */ }
    if (attempt < HEARTBEAT_READ_ATTEMPTS) sleepSync(HEARTBEAT_READ_PAUSE_MS);
  }
  return null;
}

// Every .ts file directly under <repo>/hooks, read as one body of text. The
// diff step asks it which changed names the plugin actually reads.
function hooksText(repo) {
  let entries;
  try { entries = fs.readdirSync(path.join(repo, 'hooks'), { withFileTypes: true }); } catch (e) { return ''; }
  const parts = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    try { parts.push(fs.readFileSync(path.join(repo, 'hooks', e.name), 'utf8')); } catch (err) { continue; }
  }
  return parts.join('\n');
}

// Whether the repository holds a test file the engine's own runner would
// pick up. node_modules is left out: a dependency's tests are not the
// plugin's, and finding one there would read as coverage the plugin has not
// got. .claude/worktrees and .kit are left out on the same ground: a sibling
// worktree's copy of the plugin and the kit's scratch are not this checkout's
// tests.
export function findTestFiles(dir, depth = 0) {
  const out = [];
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.kit') continue;
    if (e.name === 'worktrees' && path.basename(dir) === '.claude') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findTestFiles(p, depth + 1));
    else if (/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// Whether a build's CLI does not carry the subcommand at all, read off its
// own error, since a nonzero exit alone is shared with a test that failed.
// A run that exited 0 carries the subcommand, whatever its output says.
function subcommandAbsent(status, output) {
  return status !== 0 && /unknown command|unknown argument|unrecognized|not a known|invalid command/i.test(output);
}

// The heartbeat interval post waits out, read from <rundir>/settings.json as
// the plugin reads it: heartbeatMs under a plugin id's options, since the same
// options are written under both ids. A leading byte-order mark is stripped,
// as bin/agentic-common.sh strips it, and a file that cannot be read or holds
// no number takes the plugin's own default.
export function readHeartbeatMs(rundir) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(rundir, 'settings.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return DEFAULT_HEARTBEAT_MS;
  }
  const configs = settings && typeof settings === 'object' ? settings.pluginConfigs : null;
  if (!configs || typeof configs !== 'object') return DEFAULT_HEARTBEAT_MS;
  for (const entry of Object.values(configs)) {
    const options = entry && typeof entry === 'object' ? entry.options : null;
    const ms = options && typeof options === 'object' ? options.heartbeatMs : undefined;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) return ms;
  }
  return DEFAULT_HEARTBEAT_MS;
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

// The lines a validate run reports under its own headers: a header naming a
// count of errors or warnings, and the lines that follow it until the block
// ends. Read this way rather than by matching the bullet character, so a build
// that changes its bullet still has its findings recorded. The engine writes a
// blank line between the header and its first finding, so a blank closes the
// block only once a finding has been read.
export function validateFindings(output) {
  const found = [];
  let inside = false;
  let started = false;
  for (const line of String(output || '').split(LINE_TERMINATOR)) {
    if (/Found \d+ (error|warning)/i.test(line)) {
      inside = true;
      started = false;
      found.push(line.trim());
      continue;
    }
    if (!inside) continue;
    if (!line.trim()) {
      if (started) inside = false;
      continue;
    }
    started = true;
    found.push(line.trim());
  }
  return found;
}

// The supervisor log since its newest launch line, which is the window a
// restart's own errors sit in. Everything before that line belongs to a child
// this restart replaced.
export function logSinceNewestLaunch(text) {
  const lines = String(text || '').split(LINE_TERMINATOR);
  let start = 0;
  lines.forEach((line, i) => { if (line.includes('LAUNCH child-')) start = i; });
  return lines.slice(start);
}

// The tsconfig each compile run is given, carrying the repository's own
// compiler options so the check compiles the hooks the way the repository
// does. Absolute paths throughout, so neither run turns on the directory it
// was launched from.
function tsconfigText(include, files) {
  const config = {
    compilerOptions: {
      target: 'es2023',
      lib: ['es2023'],
      types: [],
      module: 'esnext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
  };
  if (include) config.include = include;
  if (files) config.files = files;
  return JSON.stringify(config, null, 2);
}

// The control the compile step must be rejected on. It reads a member off a
// type the engine's own declarations export, so a compiler that admits it is
// not reading those declarations and a clean compile beside it proves nothing.
// Register is the type the plugin's own hooks import, so a build that dropped
// it fails the real compile too, and the control's own diagnostic says which
// of the two happened.
const CONTROL_MEMBER = 'memberTheEngineTypesDoNotDeclare';
const CONTROL_TEXT = [
  '// Written by bin/upgrade-check.mjs. The compile step passes only where the',
  '// compiler rejects this file, so a clean compile of the plugin\'s hooks',
  '// beside it is evidence rather than silence.',
  'import type { Register } from \'claude-code\';',
  '',
  'declare const register: Register;',
  '',
  'export const control = register.' + CONTROL_MEMBER + ';',
  '',
].join('\n');

// The first diagnostic a compiler printed, which is what names why it
// refused. A run that printed nothing is reported as that.
function firstDiagnostic(out) {
  const lines = String(out || '').split(LINE_TERMINATOR);
  for (const line of lines) {
    if (/error TS\d+|error:/i.test(line)) return line.trim();
  }
  const first = lines.find((l) => l.trim());
  return first ? first.trim() : 'no output';
}

/**
 * Steps 1 to 7, in order, each as one row.
 * @param {Record<string,string>} flags
 * @returns {{rows: object[], line: string, code: number, runId: string, scratch: string, resultsDir: string}}
 */
export function pre(flags) {
  const repo = flags.repo ? path.resolve(flags.repo) : '';
  const resultsDir = flags.results ? path.resolve(flags.results) : '';
  const canary = flags.canary ? String(flags.canary) : '';
  if (!repo) cannotRun('--repo names the checkout whose hooks and types the check reads, and it was not given');
  if (!resultsDir) cannotRun('--results names the directory the rows are written to, and it was not given');
  let hooksStat = null;
  try { hooksStat = fs.statSync(path.join(repo, 'hooks')); } catch (e) { hooksStat = null; }
  if (!hooksStat || !hooksStat.isDirectory()) cannotRun(repo + ' has no hooks/ directory, so it is not a plugin checkout');
  try {
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.accessSync(resultsDir, fs.constants.W_OK);
  } catch (e) {
    cannotRun(resultsDir + ' cannot be written: ' + (e && e.message));
  }

  const claude = resolveCommand('claude');
  const runId = newRunId();
  const rows = [];
  // Every row carries the same version and the same from, both read by step 1,
  // so the table groups a run under the build it tested.
  const state = { version: 'unknown', from: 'unknown' };
  const record = (step, result, evidence) => {
    rows.push(row(runId, state.version, state.from, canary, step, result, evidence));
  };
  const runClaude = (args, opts = {}) => {
    if (!claude) return { status: null, stdout: '', stderr: '', timedOut: false, error: 'claude could not be resolved on PATH' };
    return runChild(claude.file, [...claude.args, ...args], opts);
  };
  // What a step reports when its own child did not finish: the timeout, or the
  // spawn's own error. An empty string is a child that ran.
  const childProblem = (r) => (r.timedOut ? 'timed out' : r.error ? r.error : '');

  // --- Step 1. Versions. ---
  const versionRun = runClaude(['--version']);
  const versionProblem = childProblem(versionRun);
  state.version = versionRun.status === 0 ? versionToken(versionRun.stdout) : 'unknown';
  state.from = runningSessionVersion();
  record('1. versions', versionRun.status === 0 ? 'pass' : 'fail',
    versionProblem
      ? 'claude --version ' + versionProblem
      : 'claude --version: ' + evidenceLine(versionRun.stdout || versionRun.stderr)
        + '; this session is running ' + state.from);

  // The scratch folder, created empty so the plugin finds no persona there and
  // stays passive. It is emptied where it already exists, since a folder
  // carrying an earlier run's types file would let step 2 read that file as
  // this build's, and so would a stale probe plugin. The refusals below bound
  // that delete: a scratch inside the checkout or the results directory, or
  // one holding either, would take files the check is there to read, and a
  // folder that holds files but no marker was not made by this script, so it
  // is not this script's to empty.
  const scratch = flags.scratch ? path.resolve(flags.scratch) : path.join(os.tmpdir(), 'cc-validate-' + state.version);
  const holds = (parent, child) => {
    const a = path.resolve(parent).toLowerCase();
    const b = path.resolve(child).toLowerCase();
    return a === b || b.startsWith(a + path.sep);
  };
  if (holds(scratch, repo) || holds(repo, scratch)) {
    cannotRun('the scratch folder ' + scratch + ' and the checkout ' + repo + ' hold one another, and the scratch folder is emptied at the start of a run');
  }
  if (holds(scratch, resultsDir) || holds(resultsDir, scratch)) {
    cannotRun('the scratch folder ' + scratch + ' and the results directory ' + resultsDir + ' hold one another, and the scratch folder is emptied at the start of a run');
  }
  if (path.dirname(scratch) === scratch) cannotRun('the scratch folder cannot be a filesystem root');
  let existing = null;
  try { existing = fs.readdirSync(scratch); } catch (e) {
    if (e && e.code !== 'ENOENT') cannotRun('the scratch folder ' + scratch + ' cannot be read: ' + e.message);
  }
  if (existing && existing.length > 0 && !existing.includes(SCRATCH_MARKER)) {
    cannotRun('the scratch folder ' + scratch + ' holds files and no ' + SCRATCH_MARKER + ' marker, so no run of this check made it, and the scratch folder is emptied at the start of a run; delete that folder by hand, or name an empty or absent one');
  }
  try {
    if (existing && existing.length > 0) fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(scratch, SCRATCH_MARKER), '');
  } catch (e) {
    cannotRun('the scratch folder ' + scratch + ' cannot be created: ' + (e && e.message));
  }

  // --- Step 2. Regenerate the types on the new build. ---
  // The engine writes the declarations beside any plugin it loads from a
  // folder. The probe is the smallest plugin it loads: a manifest, a hooks.json
  // naming one module, and a module whose register attaches one hook. A probe
  // the engine does not load writes nothing. The config directory is an empty
  // one inside the scratch folder, so the run finds no stored login and no
  // installed plugin: the engine answers "Not logged in" and exits 1, having
  // already written the files. So once the run spawned and did not time out,
  // the step passes on the two files alone, and the exit code and the run's
  // first output line are evidence. The emptied scratch folder is what keeps
  // an earlier run's files from reading as this build's.
  const probeDir = path.join(scratch, 'types-probe');
  const configDir = path.join(scratch, 'config');
  fs.mkdirSync(path.join(probeDir, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(probeDir, 'hooks'), { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(probeDir, '.claude-plugin', 'plugin.json'), '{"name":"upgrade-check-types-probe"}');
  fs.writeFileSync(path.join(probeDir, 'hooks', 'hooks.json'), '{"modules":["./register.js"]}');
  fs.writeFileSync(path.join(probeDir, 'hooks', 'register.js'), "export function register(on) { on('session.start', async ($, e, next) => next(e)) }\n");
  const probeCommand = 'env ' + PROBE_LOGIN_KEYS.map((key) => '-u ' + key).join(' ') + ' CLAUDE_CONFIG_DIR="' + configDir + '" claude -p "/version" --plugin-dir "' + probeDir + '"';
  // A login carried in the environment would log the run in despite the empty
  // config directory, and a logged-in run sends "/version" to the model, so
  // the probe's environment drops the three Anthropic login keys. The other
  // steps keep theirs. A cloud-provider login, such as Bedrock, Vertex or
  // Foundry, is not dropped, and docs/backlog.md carries that gap.
  const probeEnv = { ...childEnv(), CLAUDE_CONFIG_DIR: configDir };
  for (const key of Object.keys(probeEnv)) {
    if (PROBE_LOGIN_KEYS.includes(key.toUpperCase())) delete probeEnv[key];
  }
  const typesRun = runClaude(['-p', '/version', '--plugin-dir', probeDir], { cwd: scratch, env: probeEnv });
  // The engine writes the declarations as two files: the interface, and the
  // built-in tools' tables that fill its BuiltinToolInputs and
  // BuiltinToolResults. Steps 3 and 4 read the two joined in the committed
  // single-file shape, the tables after the interfaces they fill.
  const engineTypesDir = path.join(probeDir, '.claude-plugin', 'types');
  const indexPath = path.join(engineTypesDir, 'claude-code', 'index.d.ts');
  const toolsPath = path.join(engineTypesDir, 'claude-code-tools', 'index.d.ts');
  const newTypesPath = path.join(scratch, 'claude-code.d.ts');
  const readOrNull = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } };
  const indexText = readOrNull(indexPath);
  const toolsText = readOrNull(toolsPath);
  let newTypes = '';
  if (indexText && toolsText !== null) {
    newTypes = indexText + (indexText.endsWith('\n') ? '' : '\n') + toolsText;
    fs.writeFileSync(newTypesPath, newTypes);
  }
  const newFirstLine = newTypes ? (newTypes.split(LINE_TERMINATOR)[0] || '') : '';
  const typesProblem = childProblem(typesRun);
  const missing = [indexText ? '' : indexPath, toolsText !== null ? '' : toolsPath].filter(Boolean);
  if (typesProblem) {
    record('2. types', 'fail', probeCommand + ' ' + typesProblem);
  } else if (missing.length) {
    record('2. types', 'fail', probeCommand + ' exited ' + typesRun.status + ' and wrote no ' + missing.join(' and no ') + ': ' + evidenceLine(typesRun.stderr || typesRun.stdout));
  } else {
    const firstOutput = (typesRun.stdout || typesRun.stderr || '').split(LINE_TERMINATOR).find((line) => line.trim()) || '';
    // The build's first line leads, so the row's length cap cuts a long
    // scratch path rather than the line naming the build.
    record('2. types', 'pass', 'first line: ' + evidenceLine(newFirstLine) + '; exit ' + typesRun.status + ' (' + evidenceLine(firstOutput).slice(0, 120) + '); joined ' + indexPath + ' and ' + toolsPath + ' into ' + newTypesPath);
  }

  // --- Step 3. Compare the new interface against the committed one. ---
  const committedPath = path.join(repo, '.claude', 'types', 'claude-code.d.ts');
  let committed = '';
  try { committed = fs.readFileSync(committedPath, 'utf8'); } catch (e) { committed = ''; }
  if (!newTypes) {
    record('3. diff', 'fail', 'step 2 wrote no types file, so there was nothing to compare');
  } else if (!committed) {
    record('3. diff', 'fail', 'no committed types at ' + committedPath + ', so there was nothing to compare against');
  } else {
    // The counts are a line multiset difference rather than a diff's own
    // alignment: a line in one file and not the other is added or removed, and
    // a line that only moved counts as neither, which is the reading the step
    // wants from a declaration file.
    const count = (text) => {
      const m = new Map();
      for (const line of text.split(LINE_TERMINATOR)) m.set(line, (m.get(line) || 0) + 1);
      return m;
    };
    const oldCount = count(committed);
    const newCount = count(newTypes);
    const addedLines = [];
    const removedLines = [];
    for (const [line, n] of newCount) {
      for (let i = 0; i < n - (oldCount.get(line) || 0); i += 1) addedLines.push(line);
    }
    for (const [line, n] of oldCount) {
      for (let i = 0; i < n - (newCount.get(line) || 0); i += 1) removedLines.push(line);
    }
    const changed = new Set([...declarationNames(addedLines.join('\n')), ...declarationNames(removedLines.join('\n'))]);
    const hooks = hooksText(repo);
    const used = [...changed].filter((name) => new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b').test(hooks)).sort();
    const counts = '+' + addedLines.length + ' and -' + removedLines.length + ' lines';
    if (used.length === 0) record('3. diff', 'pass', counts + '; no changed declaration name appears in ' + path.join(repo, 'hooks') + '/*.ts');
    else record('3. diff', 'warn', counts + '; changed declarations the hooks read: ' + used.join(', '));
  }

  // --- Step 4. Compile the hooks against the new types, with a control. ---
  const tscPath = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  let tscPresent = false;
  try { tscPresent = fs.statSync(tscPath).isFile(); } catch (e) { tscPresent = false; }
  if (!tscPresent) {
    record('4. compile', 'fail', 'typescript is not installed in ' + repo + '; run npm install there');
  } else if (!newTypes) {
    record('4. compile', 'fail', 'step 2 wrote no types file, so there was nothing to compile against');
  } else {
    // The compile reads the new engine types and the checkout's own tool-list
    // mirror. The mirror the engine writes beside the types under the probe
    // lists the tools of a session whose plugin stayed passive, so it lacks the
    // plugin's own tools and narrows every comparison against them.
    const checkoutMirror = path.join(repo, '.claude', 'types', 'claude-code-mcp.d.ts');
    const typeFiles = fs.existsSync(checkoutMirror) ? [newTypesPath, checkoutMirror] : [newTypesPath];
    const realConfig = path.join(scratch, 'tsconfig.json');
    const controlFile = path.join(scratch, 'upgrade-check-control.ts');
    const controlConfig = path.join(scratch, 'tsconfig.control.json');
    fs.writeFileSync(realConfig, tsconfigText([path.join(repo, 'hooks')], typeFiles));
    fs.writeFileSync(controlFile, CONTROL_TEXT);
    fs.writeFileSync(controlConfig, tsconfigText(null, typeFiles.concat([controlFile])));
    // The compiler's own bin is a node script, so it is launched through this
    // node rather than through the platform's association for its name.
    const real = runChild(process.execPath, [tscPath, '--noEmit', '--project', realConfig], { cwd: scratch });
    const control = runChild(process.execPath, [tscPath, '--noEmit', '--project', controlConfig], { cwd: scratch });
    const realProblem = childProblem(real);
    const controlProblem = childProblem(control);
    const controlNote = 'the control reads ' + CONTROL_MEMBER + ' and the compiler answered: ' + firstDiagnostic(control.stdout + '\n' + control.stderr);
    if (realProblem) record('4. compile', 'fail', 'the compile ' + realProblem);
    else if (controlProblem) record('4. compile', 'fail', 'the control compile ' + controlProblem);
    else if (control.status === 0) record('4. compile', 'fail', 'control did not reject: the control file compiled clean, so exit ' + real.status + ' on the hooks proves nothing. ' + controlNote);
    else if (real.status !== 0) record('4. compile', 'fail', 'the hooks do not compile against the new types: ' + firstDiagnostic(real.stdout + '\n' + real.stderr));
    else record('4. compile', 'pass', 'the hooks compile clean against the new types (exit 0) and the control exits ' + control.status + '. ' + controlNote);
  }

  // --- Step 5. Validate the manifest. ---
  const manifest = path.join(repo, '.claude-plugin', 'plugin.json');
  const validate = runClaude(['plugin', 'validate', manifest]);
  const validateProblem = childProblem(validate);
  const findings = validateFindings(validate.stdout + '\n' + validate.stderr);
  if (validateProblem) record('5. validate', 'fail', 'claude plugin validate ' + validateProblem);
  else if (validate.status === 0) record('5. validate', 'pass', 'exit 0' + (findings.length ? '; ' + findings.join(' ') : ', no findings'));
  else record('5. validate', 'fail', 'exit ' + validate.status + '; ' + (findings.length ? findings.join(' ') : evidenceLine(validate.stderr || validate.stdout)));

  // --- Step 6. The engine's own tests, where any exist. ---
  const tests = findTestFiles(repo);
  if (tests.length === 0) {
    record('6. engine tests', 'gap', 'no *.test.ts or *.test.tsx file outside node_modules in ' + repo + ', so nothing ran');
  } else {
    const test = runClaude(['plugin', 'test', repo], { cwd: scratch });
    const testProblem = childProblem(test);
    const output = test.stdout + '\n' + test.stderr;
    if (testProblem) record('6. engine tests', 'fail', 'claude plugin test ' + testProblem);
    else if (subcommandAbsent(test.status, output)) record('6. engine tests', 'skipped', 'this build carries no plugin test subcommand: ' + evidenceLine(output));
    else record('6. engine tests', test.status === 0 ? 'pass' : 'fail', tests.length + ' test file(s), exit ' + test.status + '; ' + evidenceLine(output));
  }

  // --- Step 7. The headless smoke run. ---
  const smokePath = path.join(scratch, 'smoke.log');
  const smoke = runClaude(['-p', 'Reply with the word ok.', '--model', 'haiku', '--debug-file', smokePath],
    { cwd: scratch, env: childEnv() });
  const smokeProblem = childProblem(smoke);
  let smokeLog = '';
  try { smokeLog = fs.readFileSync(smokePath, 'utf8'); } catch (e) { smokeLog = ''; }
  // The predicate: a log line naming the plugin and carrying one of the five
  // readings that say the engine did not take it whole. The log stays in the
  // scratch folder, and only the matched lines reach the record. How many
  // lines name the plugin at all is recorded beside the reading, since a
  // search that found nothing in a log that never names the plugin says
  // nothing about the plugin.
  const logLines = smokeLog.split(LINE_TERMINATOR);
  const named = logLines.filter(namesPlugin);
  const hits = named.filter((line) => SMOKE_PATTERNS.some((p) => line.includes(p)));
  const refusals = named.filter((line) => SMOKE_FAIL_PATTERNS.some((p) => line.includes(p)));
  // Which copy of the plugin the engine loaded: the path on the last line
  // naming where it read the hooks from. Evidence only; the result stands on
  // the readings above.
  const hooksLine = logLines.filter((line) => line.includes(HOOKS_READ_PREFIX)).pop();
  const hooksNote = hooksLine
    ? 'hooks read from ' + hooksLine.slice(hooksLine.indexOf(HOOKS_READ_PREFIX) + HOOKS_READ_PREFIX.length).trim()
    : 'no "Read hooks.json for plugin ' + PLUGIN_NAME + '" line in the log, so the hooks path is not named';
  const smokeRecord = (result, evidence) => record('7. smoke', result, evidence + '; ' + hooksNote);
  if (smokeProblem) smokeRecord('fail', 'the smoke run ' + smokeProblem);
  else if (smoke.status !== 0) smokeRecord('fail', 'exit ' + smoke.status + '; ' + evidenceLine(smoke.stderr || smoke.stdout));
  else if (!smokeLog) smokeRecord('fail', 'exit 0 but no debug log at ' + smokePath);
  else if (named.length === 0) smokeRecord('fail', 'exit 0 but no line in ' + smokePath + ' names ' + PLUGIN_NAME + ', so the engine never reported on it');
  else if (refusals.length > 0) smokeRecord('fail', refusals.length + ' log line(s) naming ' + PLUGIN_NAME + ' and one of ' + SMOKE_FAIL_PATTERNS.join(', ') + ': ' + refusals.join(' '));
  else if (hits.length > 0) smokeRecord('warn', hits.length + ' log line(s) naming ' + PLUGIN_NAME + ' and one of ' + SMOKE_PATTERNS.join(', ') + ': ' + hits.join(' '));
  else smokeRecord('pass', 'exit 0; ' + named.length + ' of ' + logLines.length + ' line(s) in ' + smokePath + ' name ' + PLUGIN_NAME + ', and none of them carries any of ' + SMOKE_PATTERNS.join(', '));

  const failing = triageList(rows, PRE_VERDICT);
  const line = failing.length > 0
    ? 'pre: triage ' + failing.join(', ') + ' (run ' + runId + ')'
    : 'pre: clear to restart the canary onto ' + state.version + ' (run ' + runId + ')';
  return { rows, line, code: failing.length > 0 ? 1 : 0, runId, scratch, resultsDir };
}

/**
 * The mechanical half of step 8, under the run id the pre verdict printed.
 * @param {Record<string,string>} flags
 * @returns {{rows: object[], line: string, code: number, runId: string, resultsDir: string}}
 */
export function post(flags) {
  const runId = flags.run ? String(flags.run) : '';
  const resultsDir = flags.results ? path.resolve(flags.results) : '';
  const rundir = flags.rundir ? path.resolve(flags.rundir) : '';
  const tools = flags.tools === undefined ? '' : String(flags.tools);
  if (!runId) cannotRun('--run names the run the pre verdict printed, and it was not given');
  if (!resultsDir) cannotRun('--results names the directory the rows are written to, and it was not given');
  if (!rundir) cannotRun('--rundir names the persona run directory, and it was not given');
  if (!tools) cannotRun('--tools carries the session\'s own reading of goal_status, agentic_inbox and the relay reply, as "ok" or "fail: <reason>", and it was not given');
  try {
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.accessSync(resultsDir, fs.constants.W_OK);
  } catch (e) {
    cannotRun(resultsDir + ' cannot be written: ' + (e && e.message));
  }

  const claude = resolveCommand('claude');
  const versionRun = claude
    ? runChild(claude.file, [...claude.args, '--version'])
    : { status: null, stdout: '', stderr: '', timedOut: false, error: 'claude could not be resolved on PATH' };
  const version = versionRun.status === 0 ? versionToken(versionRun.stdout) : 'unknown';
  const from = runningSessionVersion();
  // The canary is carried from the rows the pre half wrote under this run, so
  // one run in the table reads as one run rather than as two halves.
  const canary = readRows(resultsDir)
    .filter((r) => String(r.run) === runId)
    .map((r) => String(r.canary || ''))
    .find((c) => c) || '';
  const rows = [];
  const record = (step, result, evidence) => {
    rows.push(row(runId, version, from, canary, step, result, evidence));
  };

  // --- 8a. The restarted session is running the build on disk. ---
  if (version === 'unknown') {
    record('8a. version', 'fail', 'claude --version could not be read: ' + (versionRun.timedOut ? 'timed out' : evidenceLine(versionRun.error || versionRun.stderr)));
  } else if (from === 'unknown') {
    record('8a. version', 'fail', 'this session\'s own version could not be read from its transcript; the build on disk is ' + version);
  } else if (from === version) {
    record('8a. version', 'pass', 'this session\'s transcript reads ' + from + ', and so does the build on disk');
  } else {
    record('8a. version', 'fail', 'this session\'s transcript reads ' + from + ' and the build on disk is ' + version + ', so the restart did not land on the new build');
  }

  // --- 8b. The heartbeat advances across one interval. ---
  const heartbeatPath = path.join(rundir, 'heartbeat.json');
  const intervalMs = readHeartbeatMs(rundir);
  const before = readLastSeen(heartbeatPath);
  if (before === null) {
    record('8b. heartbeat', 'fail', 'no readable lastSeen in ' + heartbeatPath);
  } else {
    sleepSync(intervalMs + 5000);
    const after = readLastSeen(heartbeatPath);
    if (after === null) record('8b. heartbeat', 'fail', heartbeatPath + ' became unreadable across one ' + intervalMs + 'ms interval');
    else if (after > before) record('8b. heartbeat', 'pass', 'lastSeen advanced from ' + before + ' to ' + after + ' across ' + intervalMs + 'ms plus five seconds');
    else record('8b. heartbeat', 'fail', 'lastSeen stood at ' + before + ' across ' + intervalMs + 'ms plus five seconds');
  }

  // --- 8c. The supervisor log since the newest launch. ---
  const logPath = path.join(rundir, 'supervisor.log');
  let logText = null;
  try { logText = fs.readFileSync(logPath, 'utf8'); } catch (e) { logText = null; }
  if (logText === null) {
    record('8c. supervisor log', 'fail', 'no readable ' + logPath);
  } else {
    const window = logSinceNewestLaunch(logText);
    // The pre-launch gate polls while the old child's heartbeat ages out, so
    // its own lines are the gate working, and the heartbeat-absent note is the
    // supervisor reading a slow first stamp as not silent. Both are counted
    // and reported, never read as errors.
    const gate = window.filter((line) => SUPERVISOR_GATE_PATTERNS.every((p) => line.includes(p)));
    const notes = window.filter((line) => SUPERVISOR_HEARTBEAT_NOTE.test(line));
    const errors = window.filter((line) => SUPERVISOR_ERROR_PATTERNS.some((p) => line.includes(p))
      && !gate.includes(line) && !notes.includes(line));
    const gateNote = gate.length + ' expected pre-launch gate line(s), ' + notes.length + ' expected heartbeat-absent note(s)';
    if (errors.length === 0) {
      record('8c. supervisor log', 'pass', window.length + ' line(s) since the newest LAUNCH child- line carry none of ' + SUPERVISOR_ERROR_PATTERNS.join(', ') + '; ' + gateNote);
    } else {
      record('8c. supervisor log', 'fail', errors.length + ' line(s) since the newest LAUNCH child- line: ' + errors.join(' ') + '; ' + gateNote);
    }
  }

  // --- 8d. The three tool readings the session took itself. ---
  if (tools === 'ok') record('8d. tools', 'pass', 'the session reports goal_status, agentic_inbox and the relay reply all working');
  else if (/^fail:/i.test(tools)) record('8d. tools', 'fail', 'the session reports ' + tools);
  else record('8d. tools', 'fail', '--tools reads "' + tools + '", which is neither "ok" nor "fail: <reason>"');

  const failing = triageList(rows, POST_VERDICT);
  const line = failing.length > 0
    ? 'post: triage ' + failing.join(', ') + ' (run ' + runId + ')'
    : 'post: fleet clear to restart onto ' + version + ' (run ' + runId + ')';
  return { rows, line, code: failing.length > 0 ? 1 : 0, runId, resultsDir };
}

// Whether node was asked to run this file, rather than one that imported it.
// The check errs toward running: it stands down only where the entry point is
// another readable file, which is what an import looks like. A launch spelled
// in another case, through a symlink or in a form this cannot place still runs
// the check, since a verdict nobody printed would read to a caller as no
// triage. The unit test imports this module to drive the table's regeneration
// over unchanged rows, which is the one reading a spawn cannot take.
function launchedDirectly() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  if (!entry) return true;
  const self = fileURLToPath(import.meta.url);
  const real = (p) => { try { return fs.realpathSync(p).toLowerCase(); } catch (e) { return p.toLowerCase(); } };
  if (real(entry) === real(self)) return true;
  try { return !fs.statSync(entry).isFile(); } catch (e) { return true; }
}

// The verbs are a closed pair, and anything else exits 2 with the usage rather
// than running a half-named check.
// The exit code is set rather than exited on, so output still queued for a
// pipe is written before the process ends.
function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.verb !== 'pre' && parsed.verb !== 'post') {
    cannotRun('the verb is "pre" or "post"; usage: upgrade-check.mjs pre --repo <checkout> --results <dir> [--scratch <dir>] [--canary <persona>] | upgrade-check.mjs post --run <id> --results <dir> --rundir <dir> --tools <ok | fail: reason>');
  }
  const outcome = parsed.verb === 'pre' ? pre(parsed.flags) : post(parsed.flags);
  // The step lines print first, so a failed append still leaves each step's
  // reading in the log. The rows are recorded before the verdict prints, so a
  // reader of the table and a reader of the verdict never disagree.
  for (const r of outcome.rows) process.stdout.write(r.step + ': ' + r.result + ' - ' + r.evidence + '\n');
  appendRows(outcome.resultsDir, outcome.rows);
  regenerate(outcome.resultsDir);
  process.stdout.write(outcome.line + '\n');
  return outcome.code;
}

if (launchedDirectly()) {
  try {
    process.exitCode = main();
  } catch (e) {
    // An error other than CannotRun is a crash, not a verdict. It exits 3
    // rather than node's own 1, which a reader would take for triage, and it
    // may land after the rows were appended, so it never claims that nothing
    // was recorded. The stack goes to stderr, and the failed line stays last.
    if (!(e instanceof CannotRun)) {
      process.stderr.write(String((e && e.stack) || e) + '\n');
      process.stdout.write('upgrade-check: failed: ' + evidenceLine((e && e.message) || e) + '\n');
      process.exitCode = 3;
    } else {
      process.stdout.write('upgrade-check: cannot run: ' + e.message + '\n');
      process.exitCode = 2;
    }
  }
}
