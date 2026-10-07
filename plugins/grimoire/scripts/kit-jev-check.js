#!/usr/bin/env node
// kit-jev-check: the command a session runs to ask TypeSafe's Jev model how
// much doubt there is that its code keeps each promise its plan section
// makes. Its one verb is `promises <questions.json> <file>...`, which reads a
// prepared questions file and the named source files and prints the promises
// ranked by doubt, most doubted first. The reading is advice: it holds no
// threshold, no pass and no fail. Doubt is a pointer to re-read the promise
// against the code, never a finding.
//
// WHAT ONE REQUEST CARRIES. One request per run, through jev-client.js, which
// owns the wire, the config read, the key and the credential screen. The
// state is exactly `{ code }`, the string jev-gather.js builds: every source
// file in argument order, each opened by a line `==== <path as given>` and
// followed by its text with comments stripped by extension. The questions
// file is a JSON array of `{ id, promise }`. An id holds only ASCII letters,
// digits, `_`, `.` and `-`, since it opens a report line and must not forge
// the closing line. Each entry becomes one `noul` question keyed `p_<id>`,
// asking whether the code fails to keep the promise, so the answer is the
// doubt. Nothing else rides: not the questions file's path, not a record,
// not any environment value.
//
// THE SCREENS. The gatherer refuses a credential or settings file by name
// before reading it, and the run stops at `not checked (screened file)` with
// the path on stderr and never its content. The client refuses a body
// carrying a credential shape as `not checked (screened)`. This tool screens
// nothing itself.
//
// ALL OR NOTHING. The arguments, the questions file, any `--against` record
// and the source files are read before the config, and a screened or
// unreadable source stops the run there. The config is read before the length
// check, so a machine with no config reads `not configured` whatever the
// readable files hold. The code is checked before the send, and code past
// 120,000 UTF-16 code units, counted as JavaScript's String.length, is not
// sent. Output is printed only once the answers are in.
//
// THREE CLOSING LINES, THREE EXIT CODES.
//
//   jev promises: <n> promises, most doubted <id> at <p>   exit 0
//   jev promises: not checked (<reason>)                   exit 2
//   jev promises: not configured                           exit 2
//
// The report above the closing line opens with `model <m>, input tokens <n>,
// files <k>`, then one line per promise, `<id>: doubt <p>  <promise cut to 80
// characters>`, ranked on the value as printed to two decimals, ties in
// questions-file order. The closing line is the only stdout line that opens
// with `jev promises:`. The not-checked reason is the client's, or this
// tool's own `code too long` or `screened file`. A usage refusal (a missing
// verb or path, an unknown flag, a questions file or record that cannot be
// used, a source file that cannot be read) is one line on stderr naming the
// usage, exit 1, and sends nothing.
//
// THE RECORD AND THE DELTA. `--record <path>` writes `{ model, at, answers }`
// after a checked run and only then, `answers` mapping each id to its raw
// doubt, creating the parent directory. A failed write is one stderr line,
// and the exit stays 0 since the reading printed. `--against <path>` reads
// such a record before the send and appends `(was <q>, <+/-d>)` to each line
// whose id it holds and `(new)` to each it lacks, ignoring a recorded id the
// questions file lacks. The delta is taken from the printed values, so each
// line's arithmetic reads true. Where any rise is positive, the closing line
// ends `, largest rise <id> by <d>`, ties in questions-file order. Both flags
// may name one path: it is read before the send and written after.

'use strict';

const fs = require('fs');
const path = require('path');

const { askJev, loadJevConfig, configRefusalReason } = require('./jev-client.js');
const { gatherCode } = require('./jev-gather.js');

// The caller's policy for the client: one deadline over the call, retries
// included, and two retries at these delays.
const TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [1000, 4000];

// Code longer than this many UTF-16 code units (String.length) is not sent.
const MAX_CODE_CHARS = 120000;

// A promise's text on its report line is cut to this many characters.
const PROMISE_LINE_CHARS = 80;

const USAGE = 'usage: node kit-jev-check.js promises <questions.json> <file>... [--record <path>] [--against <path>]';

const CLOSING_SENTENCE = 'Doubt is a pointer to re-read the promise against the code, never a finding.';

// --------------------------------------------------------------- arguments --

const FLAGS = new Set(['--record', '--against']);

// The arguments after the verb as `{ questionsPath, sources, record, against }`
// or a described refusal. A flag takes the next argument as its path, and an
// argument opening with `--` is never a path.
function parseArgs(args) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        if (!FLAGS.has(arg)) return { ok: false, detail: `unknown flag ${arg}` };
        if (Object.hasOwn(flags, arg)) return { ok: false, detail: `${arg} is given twice` };
        const value = args[i + 1];
        if (value === undefined || value.startsWith('--')) return { ok: false, detail: `${arg} takes a path` };
        flags[arg] = value;
        i += 1;
    }
    if (positional.length === 0) return { ok: false, detail: 'no questions file was given' };
    if (positional.length === 1) return { ok: false, detail: 'no source file was given' };
    return {
        ok: true,
        questionsPath: positional[0],
        sources: positional.slice(1),
        record: flags['--record'],
        against: flags['--against']
    };
}

// ---------------------------------------------------------------- questions --

// A control character, U+0000 to U+001F or U+007F. A promise is printed as it
// stands on a report line, so a line break in it would forge a second line, a
// closing line among them.
const CONTROL = /[\u0000-\u001f\u007f]/;

// The characters an id may hold. An id opens its report line, so an id such as
// `jev promises: not configured` would forge the closing line, and a line
// break would forge a line of its own. Neither a colon, a space nor a control
// character is on this list.
const ID_SHAPE = /^[A-Za-z0-9_.-]+$/;

// The questions file, read entry by entry, or a described refusal. Every
// entry must carry a non-empty `id` of `ID_SHAPE` no other entry carries and a
// non-empty `promise` holding no control character. A repeated id would key
// two questions to one answer.
function readQuestions(file) {
    let raw = '';
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch {
        return { ok: false, detail: 'the questions file could not be read' };
    }
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, detail: 'the questions file is not JSON' };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        return { ok: false, detail: 'the questions file is not a non-empty array' };
    }
    const entries = [];
    const seen = new Set();
    for (const entry of parsed) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            return { ok: false, detail: 'a question is not an object' };
        }
        if (typeof entry.id !== 'string' || entry.id === '') {
            return { ok: false, detail: 'a question has no id' };
        }
        if (!ID_SHAPE.test(entry.id)) {
            return { ok: false, detail: 'a question id holds a character outside A-Z, a-z, 0-9, `_`, `.` and `-`' };
        }
        if (seen.has(entry.id)) {
            return { ok: false, detail: 'a question id is repeated' };
        }
        seen.add(entry.id);
        if (typeof entry.promise !== 'string' || entry.promise === '') {
            return { ok: false, detail: 'a question has no promise' };
        }
        if (CONTROL.test(entry.promise)) {
            return { ok: false, detail: 'a question promise holds a control character' };
        }
        entries.push({ id: entry.id, promise: entry.promise });
    }
    return { ok: true, entries };
}

// One `noul` question per promise, keyed by its id, whose answer is the doubt
// that the code keeps it.
function questionsFor(entries) {
    const questions = {};
    for (const entry of entries) {
        questions[`p_${entry.id}`] = {
            type: 'noul',
            instructions: `Does the code in \`code\` fail to keep this promise? The promise: ${entry.promise}`,
            criteria: {
                true: 'The code does not do this, or does it only in part.',
                false: 'The code does this as stated.'
            }
        };
    }
    return questions;
}

// ------------------------------------------------------------------- record --

// A record written by `--record`, or a described refusal. Its `answers` must
// be an object whose every value is a number from 0 to 1, as a doubt is.
function readRecord(file) {
    let raw = '';
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch {
        return { ok: false, detail: 'the record could not be read' };
    }
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, detail: 'the record is not JSON' };
    }
    const answers = parsed !== null && typeof parsed === 'object' ? parsed.answers : undefined;
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
        return { ok: false, detail: 'the record carries no answers object' };
    }
    if (!Object.values(answers).every((v) => typeof v === 'number' && v >= 0 && v <= 1)) {
        return { ok: false, detail: 'the record answers are not all numbers from 0 to 1' };
    }
    return { ok: true, answers };
}

function writeRecord(file, model, doubts) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ model, at: new Date().toISOString(), answers: doubts }, null, 2) + '\n');
    } catch {
        process.stderr.write('kit-jev-check: the record could not be written; the reading above stands\n');
    }
}

// ----------------------------------------------------------------- reading --

function fixed(value) {
    return value.toFixed(2);
}

// A value as printed, in whole hundredths, so the ranking and the delta read
// the number the reader sees.
function hundredths(value) {
    return Math.round(Number(fixed(value)) * 100);
}

function signed(h) {
    return `${h < 0 ? '-' : '+'}${fixed(Math.abs(h) / 100)}`;
}

// The whole report as lines, most doubted first, ties in questions-file
// order on the value as printed. `against` is a record's answers or null.
function renderReport(model, inputTokens, files, entries, doubts, against) {
    const rows = entries.map((entry) => ({ ...entry, doubt: doubts[entry.id] }));
    const ranked = rows.slice().sort((a, b) => hundredths(b.doubt) - hundredths(a.doubt));
    const lines = [`model ${model}, input tokens ${inputTokens}, files ${files}`];
    for (const row of ranked) {
        let line = `${row.id}: doubt ${fixed(row.doubt)}  ${row.promise.slice(0, PROMISE_LINE_CHARS)}`;
        if (against !== null) {
            if (Object.hasOwn(against, row.id)) {
                line += ` (was ${fixed(against[row.id])}, ${signed(hundredths(row.doubt) - hundredths(against[row.id]))})`;
            } else {
                line += ' (new)';
            }
        }
        lines.push(line);
    }

    // The largest positive rise, the first in questions-file order on a tie.
    let rise = null;
    if (against !== null) {
        for (const row of rows) {
            if (!Object.hasOwn(against, row.id)) continue;
            const d = hundredths(row.doubt) - hundredths(against[row.id]);
            if (d > 0 && (rise === null || d > rise.d)) rise = { id: row.id, d };
        }
    }
    const top = ranked[0];
    const tail = rise === null ? '' : `, largest rise ${rise.id} by ${signed(rise.d)}`;
    lines.push(`jev promises: ${rows.length} promises, most doubted ${top.id} at ${fixed(top.doubt)}${tail}`);
    lines.push(CLOSING_SENTENCE);
    return lines;
}

// --------------------------------------------------------------------- cli --

function refuseUsage(detail) {
    process.stderr.write(`kit-jev-check: ${detail}; ${USAGE}\n`);
    process.exitCode = 1;
}

function notChecked(reason) {
    process.stdout.write(reason === 'not configured' ? 'jev promises: not configured\n' : `jev promises: not checked (${reason})\n`);
    process.exitCode = 2;
}

async function promises(args) {
    const parsed = parseArgs(args);
    if (!parsed.ok) return refuseUsage(parsed.detail);
    const questions = readQuestions(parsed.questionsPath);
    if (!questions.ok) return refuseUsage(questions.detail);

    // The record is read before the send, so one path can serve `--against`
    // and `--record` in the same run.
    let against = null;
    if (parsed.against !== undefined) {
        const record = readRecord(parsed.against);
        if (!record.ok) return refuseUsage(record.detail);
        against = record.answers;
    }

    const gathered = gatherCode(parsed.sources);
    if (!gathered.ok) {
        if (gathered.reason !== 'screened file') return refuseUsage(`the source file could not be read: ${gathered.path}`);
        process.stderr.write(`kit-jev-check: screened file ${gathered.path}\n`);
        return notChecked('screened file');
    }

    // The config is read once here, for the header's model name, and a config
    // this read cannot use stops the run on the reason the client would give
    // the same config. It is read before the length, so a machine with no
    // config reads not configured whatever the code holds. The send still goes
    // through the client, which reads the config on its own.
    const config = loadJevConfig();
    if (!config.ok) return notChecked(configRefusalReason(config));

    if (gathered.code.length > MAX_CODE_CHARS) return notChecked('code too long');

    const answer = await askJev({ code: gathered.code }, questionsFor(questions.entries), TIMEOUT_MS, RETRY_DELAYS_MS);
    if (!answer.ok) return notChecked(answer.reason);

    // No prototype, so an id such as `__proto__` is a key like any other.
    const doubts = Object.create(null);
    for (const entry of questions.entries) doubts[entry.id] = answer.answers[`p_${entry.id}`].noul;
    process.stdout.write(renderReport(config.model, answer.inputTokens, gathered.files, questions.entries, doubts, against).join('\n') + '\n');
    process.exitCode = 0;
    if (parsed.record !== undefined) writeRecord(parsed.record, config.model, doubts);
}

async function main(argv) {
    const [verb, ...rest] = argv;
    if (verb === undefined) return refuseUsage('no verb was given');
    if (verb !== 'promises') return refuseUsage('the only verb is promises');
    return promises(rest);
}

if (require.main === module) main(process.argv.slice(2));
