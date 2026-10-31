#!/usr/bin/env node
// gate-lane: the lane a finishing gate runs, read from a repository's committed
// lane map at test/gate-lanes.json. `report --repo <root> [--base <ref>]` lists
// the delta from the merge base with the base ref, `origin/main` by default, to
// the working tree, so staged and unstaged edits count, classifies each changed
// path against the map, and prints:
//
//   lane: targeted                    or  lane: whole (<reason>)
//   <path>: row <entry>               one line per changed path, naming the
//   <path>: whole <entry> (<reason>)  map entry or the reason that placed it
//   <path>: unmapped
//   node --test --test-timeout=1800000 <test files>
//                                     targeted only: the matched rows' tests
//   PERSONAS_SUITE_LIST=<suites> node --test --test-timeout=1800000 test/personas-offline.test.js
//                                     targeted only, where a row names suites,
//                                     each as its path under test-personas/
//
// Where the map holds `layers`, one line per layer follows the verdict line, in
// the map's order, so the verdict stays the first line printed:
//
//   layer <rung>: <name>, <n> tests, clock <seconds>s|cost: unmeasured, pinned <pin>
//
// The map holds `rows`, a list of `{ paths, tests, suites }`; `always`, the
// test files every targeted lane runs, each with a reason; and `whole`, the
// paths whose change takes the whole gate, each with a reason. An optional
// `unread` list names the files other than prose that may sit in a row naming
// no test. An entry ending in a slash is a folder and any other entry is one
// file, so a match is by path segment: `docs/` holds docs/a.md and never docs-old/a.md.
// An optional `layers` list records the repository's tests by what they cost to
// run, each entry `{ name, rung, tests, clock, pinned }`: `rung` one of
// in-process, database, process and end-to-end, `tests` a whole number, `clock`
// seconds or the word unmeasured, and `pinned` the moment-pin that says what
// produced the figures, when, on which machine and under what contention. The
// layers size no lane. A map with none prints as it always did. A layer with a
// field missing or of the wrong kind makes the map unreadable, and a rung
// outside the four does too, the reason then naming the rung.
//
// The lane gate's own inputs, the map, this script and the map's pin test, are
// whole whatever the map says, ahead of its `whole` list, so no edit to the map
// can size the gate that checks it. A path any `whole` entry holds is whole,
// ahead of every row. Otherwise the longest row entry holding it wins, and a
// path no row holds is unmapped. A path placed only by a row naming no test is
// unmapped unless it is prose, an .md or .txt file in any letter case, or
// `unread` names it, so a catch-all for prose never takes code of any kind.
// A deleted path classifies by where it was. A test file or suite the delta
// deletes leaves the printed commands, since there is nothing left to run.
//
// The verdict is whole where the map is absent or unreadable, where a changed
// path is unmapped or held by `whole`, where a test or suite the lane would
// print is not a plain path under test/ or test-personas/, where a named test
// or suite is absent and the delta did not delete it, where a changed path
// that still exists sits in a row whose every test and suite the delta
// deleted, where git cannot read the base or the delta, the reason then
// naming the failed call, and where the repository has no fresh green daily
// trunk gate on record. That record is the newest line of
// .kit/trunk-gate/runs.jsonl, at the parent of the directory
// `git rev-parse --git-common-dir` names, whose
// outcome is green, red or did_not_run. That parent is the main checkout, so a
// linked worktree reads the main checkout's record and a submodule, whose
// common directory lies under its superproject's .git/, reads as no record. It
// must be green and dated today or yesterday in local time, a later skipped
// unmoved line over the same tip renewing the date, because the daily
// gate is what bounds a red the lane missed to one day. A malformed line is
// skipped, and an absent or unreadable file is no record. A date that is not
// YYYY-MM-DD is reported as malformed rather than echoed. The map and the
// record are read through kit-read-lib's bounded reader, each only where its
// real path lies inside its checkout, so a link pointing out of the tree reads
// as unreadable. An unreadable map's reason never quotes the parser. With no
// readable map the script makes no git call, so neither the repository nor
// the base ref is checked.
//
// The delta is read as the persona wrapper reads it: the base ref verified to
// a commit, its merge base with HEAD, `git diff --name-only --no-renames -z`
// against that merge base, plus the untracked files `git ls-files -z
// --full-name --others --exclude-standard` lists. The -z listings keep a path
// git would quote, such as one holding a non-ASCII character, as written.
// Every git call goes through `gitRun` in plugins/grimoire/hooks/kit-git-lib.js,
// which ships beside this script: an argument array with no shell, git spawned
// from the hooks directory with `-C` naming the repository, every `GIT_*`
// variable stripped, the prompt and current-directory settings set, and
// core.fsmonitor and core.hooksPath pinned inert.
//
// Exit codes:
//   0  any verdict, read from the first line printed
//   2  an argument was refused, with the reason on stderr

'use strict';

const fs = require('fs');
const path = require('path');
const { gitRun } = require('../hooks/kit-git-lib.js');
const { readFileBounded, containedRealPath } = require('../hooks/kit-read-lib.js');
const { safePath } = require('./kit-size.js');

const MAP_FILE = path.join('test', 'gate-lanes.json');
const WRAPPER = 'test/personas-offline.test.js';
// The runner with its own hang limit, 30 minutes per test: the smallest of 10,
// 30 and 60 minutes that is at least twice the gate's slowest test. The offline
// runner's suite tests carry their own limit, above the suite's ceiling.
const NODE_TEST = 'node --test --test-timeout=1800000';
const RUNS_FILE = path.join('.kit', 'trunk-gate', 'runs.jsonl');
const GIT_TIMEOUT_MS = 30000;
// The outcomes a daily gate records when it ran or meant to run a whole gate.
// A skipped line renews the newest run's date only where its reason is
// unmoved and its tip is that run's; every other skipped or busy line is
// passed over.
const VERDICT_OUTCOMES = ['green', 'red', 'did_not_run'];
const NO_RECORD = 'no green daily gate on record';
// Ceilings on the two files read. Each sits far above its file's size, so it
// binds only on a file nobody meant to be read, which then reads as unreadable.
const MAX_MAP_BYTES = 4 * 1024 * 1024;
const MAX_RUNS_BYTES = 16 * 1024 * 1024;
// A test or suite the lane prints: a path under its folder in a plain alphabet,
// so a printed command names exactly the file the map named.
const LANE_NAME = { tests: /^test\/[A-Za-z0-9._/-]+$/, suites: /^test-personas\/[A-Za-z0-9._/-]+$/ };
// The four rungs of a layer map, cheapest to dearest, and the clock of a rung
// nobody has timed.
const RUNGS = ['in-process', 'database', 'process', 'end-to-end'];
const UNMEASURED = 'unmeasured';
// The files that decide every lane, held whole ahead of the map they would size.
const SELF = ['test/gate-lanes.json', 'plugins/grimoire/scripts/gate-lane.js', 'test/gate-lanes.test.js'];

// Whether a path is prose, the one kind a row naming no test may take unlisted.
function isProse(relPath) {
    return /\.(md|txt)$/i.test(relPath);
}

function localDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function holds(entry, relPath) {
    return entry.endsWith('/') ? relPath.startsWith(entry) : relPath === entry;
}

// The record rule over the text of runs.jsonl, or null where there is no file.
// Returns null where a fresh green record stands, else the reason it does not.
function recordProblem(text, now) {
    if (text === null) return NO_RECORD + ': no runs.jsonl';
    let newest = null;
    let freshDate = null;
    for (const line of text.split(/\r?\n/)) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (!row || typeof row !== 'object') continue;
        if (VERDICT_OUTCOMES.includes(row.outcome)) {
            newest = row;
            freshDate = row.date;
        } else if (row.outcome === 'skipped' && row.reason === 'unmoved' && newest !== null
            && typeof row.tip === 'string' && row.tip === newest.tip) {
            // The trunk still sits on the tip that run checked, so the run
            // still bounds a missed red to one day.
            freshDate = row.date;
        }
    }
    if (newest === null) return NO_RECORD + ': no green, red or did_not_run line in runs.jsonl';
    if (newest.outcome !== 'green') return NO_RECORD + ': the newest run is ' + newest.outcome;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (freshDate !== localDate(now) && freshDate !== localDate(yesterday)) {
        const date = typeof freshDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(freshDate) ? freshDate : 'malformed';
        return NO_RECORD + ': the newest green run is fresh as of ' + date + ', before yesterday';
    }
    return null;
}

// One changed path against the map: { kind: 'whole' | 'row' | 'unmapped', entry, reason, row, self }.
function placePath(map, relPath) {
    if (SELF.includes(relPath)) return { kind: 'whole', entry: relPath, reason: relPath + ' is the lane gate\'s own input', self: true };
    const whole = map.whole.find((w) => holds(w.path, relPath));
    if (whole) return { kind: 'whole', entry: whole.path, reason: whole.reason };
    let best = null;
    for (const row of map.rows) {
        for (const entry of row.paths) {
            if (holds(entry, relPath) && (best === null || entry.length > best.entry.length)) best = { kind: 'row', entry, row };
        }
    }
    if (best !== null && best.row.tests.length === 0 && best.row.suites.length === 0 && !isProse(relPath)
        && !(map.unread || []).some((u) => u.path === relPath)) {
        return { kind: 'unmapped', entry: best.entry };
    }
    return best || { kind: 'unmapped' };
}

// The lane, as pure data. `map` is the parsed map or null where none was read,
// `mapProblem` the reason one could not be, `changes` the changed paths,
// `recordText` the text of runs.jsonl or null, and `exists` whether a
// repo-relative file is on disk.
function classify({ map, mapProblem, changes, recordText, now, exists }) {
    if (map === null) return { lane: 'whole', reason: mapProblem || 'no map', places: [], tests: [], suites: [] };
    const layerList = map.layers || [];
    const places = changes.map((p) => ({ path: p, place: placePath(map, p) }));
    const reasons = [];
    const record = recordProblem(recordText, now);
    if (record) reasons.push(record);
    for (const { path: p, place } of places) {
        if (place.self) reasons.push(place.reason);
        else if (place.kind === 'whole') reasons.push(p + ' is held by whole entry ' + place.entry);
        else if (place.kind === 'unmapped') reasons.push(p + ' is unmapped');
    }
    const whole = () => {
        const more = reasons.length > 1 ? ', and ' + (reasons.length - 1) + ' more' : '';
        return { lane: 'whole', reason: reasons[0] + more, places, tests: [], suites: [], layers: layerList };
    };
    if (reasons.length > 0) return whole();
    const tests = new Set(map.always.map((a) => a.test));
    const suites = new Set();
    for (const { place } of places) {
        for (const t of place.row.tests) tests.add(t);
        for (const s of place.row.suites) suites.add(s);
    }
    for (const [kind, list] of [['tests', tests], ['suites', suites]]) {
        const under = kind === 'tests' ? 'test/' : 'test-personas/';
        for (const n of list) {
            if (!LANE_NAME[kind].test(n) || n.split('/').includes('..')) reasons.push('map entry ' + n + ' is not a plain path under ' + under);
        }
    }
    if (reasons.length > 0) return whole();
    // A name the delta deletes leaves the commands. Any other absent name is a
    // map naming a file that is not there, so the lane cannot be trusted.
    const changed = new Set(changes);
    const deleted = (f) => changed.has(f) && !exists(f);
    for (const n of [...tests, ...suites]) {
        if (!exists(n) && !changed.has(n)) reasons.push('map entry ' + n + ' is not on disk');
    }
    // A path still on disk whose row's every test and suite the delta deletes
    // would run nothing that reads it.
    for (const { path: p, place } of places) {
        const named = place.row.tests.concat(place.row.suites);
        if (named.length > 0 && exists(p) && named.every(deleted)) reasons.push(p + ' sits in row ' + place.entry + ', whose every test and suite the delta deletes');
    }
    if (reasons.length > 0) return whole();
    const present = (list) => [...list].filter((f) => exists(f)).sort();
    return { lane: 'targeted', places, tests: present(tests), suites: present(suites), layers: layerList };
}

// The printed report, one string per line. Every repository-supplied value
// goes through kit-size's safePath, the screen for text a Chapter quotes,
// except the test and suite paths, which classify has held to LANE_NAME.
function render(result) {
    const lines = [result.lane === 'whole' ? 'lane: whole (' + safePath(result.reason) + ')' : 'lane: targeted'];
    // The layers follow the verdict line, which the finishing pass reads first.
    // The rung and the free text are screened. The count and the clock are held
    // to their shapes by `layers`, so they print as they stand.
    for (const l of result.layers || []) {
        const cost = l.clock === UNMEASURED ? 'cost: ' + UNMEASURED : 'clock ' + l.clock + 's';
        lines.push('layer ' + safePath(l.rung) + ': ' + safePath(l.name) + ', ' + l.tests + ' tests, ' + cost + ', pinned ' + safePath(l.pinned));
    }
    for (const { path: p, place } of result.places) {
        if (place.kind === 'row') lines.push(safePath(p) + ': row ' + safePath(place.entry));
        else if (place.kind === 'whole') lines.push(safePath(p) + ': whole ' + safePath(place.entry) + ' (' + safePath(place.reason) + ')');
        else lines.push(safePath(p) + ': unmapped');
    }
    if (result.lane === 'targeted') {
        if (result.tests.length > 0) lines.push(NODE_TEST + ' ' + result.tests.join(' '));
        if (result.suites.length > 0) {
            lines.push('PERSONAS_SUITE_LIST=' + result.suites.map((s) => path.posix.relative('test-personas', s)).join(',')
                + ' ' + NODE_TEST + ' ' + WRAPPER);
        }
    }
    return lines;
}

function parseArgs(argv) {
    if (argv[0] !== 'report') throw new Error('the one verb is report: gate-lane.js report --repo <root> [--base <ref>]');
    const args = { repo: null, base: 'origin/main' };
    for (let i = 1; i < argv.length; i += 2) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (value === undefined) throw new Error(flag + ' needs a value');
        if (flag === '--repo') args.repo = path.resolve(value);
        else if (flag === '--base') {
            if (value.startsWith('-')) throw new Error('--base ' + JSON.stringify(value) + ' is not a ref');
            args.base = value;
        } else throw new Error('unknown argument ' + JSON.stringify(flag) + '; the flags are --repo and --base');
    }
    if (args.repo === null) throw new Error('--repo <root> is required');
    return args;
}

function splitZ(text) {
    return text.split('\0').filter(Boolean);
}

// The text of <root>/<rel>: ABSENT where nothing is at the path, null where it
// cannot be read whole from inside the root, a link out of it included.
const ABSENT = Symbol('absent');
function readContained(root, rel, ceilingBytes) {
    const full = path.join(root, rel);
    try {
        fs.lstatSync(full);
    } catch (err) {
        return err && err.code === 'ENOENT' ? ABSENT : null;
    }
    const real = containedRealPath(root, full);
    if (real === null) return null;
    const res = readFileBounded(real, ceilingBytes);
    return res === null || res.bounded ? null : res.text;
}

const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const records = (v, keys) => Array.isArray(v)
    && v.every((e) => e !== null && typeof e === 'object' && keys.every((k) => typeof e[k] === 'string'));

// One layer: { name, rung, tests, clock, pinned }, the name, rung and pin
// strings, the count a whole number, the clock seconds or the word unmeasured.
// Whether the rung is one of the four is the next rule's, in readMap.
const layers = (v) => records(v, ['name', 'rung', 'pinned'])
    && v.every((l) => Number.isInteger(l.tests) && l.tests >= 0
        && (l.clock === UNMEASURED || (typeof l.clock === 'number' && Number.isFinite(l.clock) && l.clock >= 0)));

// Whether a parsed map holds every shape classify and placePath read.
function validMap(m) {
    return m !== null && typeof m === 'object'
        && Array.isArray(m.rows)
        && m.rows.every((r) => r !== null && typeof r === 'object' && strings(r.paths) && strings(r.tests) && strings(r.suites))
        && records(m.always, ['test', 'reason'])
        && records(m.whole, ['path', 'reason'])
        && (m.unread === undefined || records(m.unread, ['path', 'reason']))
        && (m.layers === undefined || layers(m.layers));
}

// The map at <repo>/test/gate-lanes.json as { map, mapProblem }, map null where
// none could be read.
function readMap(repo) {
    const text = readContained(repo, MAP_FILE, MAX_MAP_BYTES);
    if (text === ABSENT) return { map: null, mapProblem: 'no map' };
    let parsed = null;
    try { parsed = text === null ? null : JSON.parse(text); } catch { parsed = null; }
    if (!validMap(parsed)) return { map: null, mapProblem: 'map unreadable' };
    // A well-shaped layer on a rung outside the four is refused with the rung
    // named. The reason is screened where it is printed, as every map string is.
    const stray = (parsed.layers || []).find((l) => !RUNGS.includes(l.rung));
    if (stray) return { map: null, mapProblem: 'map unreadable: layer rung ' + JSON.stringify(stray.rung) + ' is not one of ' + RUNGS.join(', ') };
    return { map: parsed, mapProblem: null };
}

function main(argv) {
    const args = parseArgs(argv);
    const { map, mapProblem } = readMap(args.repo);
    if (map === null) {
        process.stdout.write(render(classify({ map, mapProblem })).join('\n') + '\n');
        return 0;
    }
    // gitRun answers null for a run that did not finish, and { status, stdout }
    // for one that did, whatever its exit code; it keeps no stderr.
    const git = (gitArgs, refusal) => {
        const res = gitRun(args.repo, gitArgs, { timeoutMs: GIT_TIMEOUT_MS });
        if (!res) {
            throw new Error('git ' + gitArgs.join(' ') + ' did not run to its end, so git is missing, failed to start, timed out or wrote past 1 MB');
        }
        if (res.status !== 0) throw new Error((refusal || 'git ' + gitArgs.join(' ')) + ' exited ' + res.status);
        return res.stdout;
    };
    // A base or delta git cannot read is a whole gate with its reason, so the
    // finishing pass always has a verdict line to read.
    let changed;
    let runs;
    let stage = 'the delta could not be read';
    try {
        const baseCommit = git(['rev-parse', '--verify', '--quiet', args.base + '^{commit}'],
            args.base + ' does not resolve to a commit: git rev-parse --verify').trim();
        const mergeBase = git(['merge-base', 'HEAD', baseCommit], 'HEAD and ' + args.base + ' have no merge base: git merge-base').trim();
        changed = new Set(splitZ(git(['diff', '--name-only', '--no-renames', '-z', mergeBase, '--'])));
        for (const p of splitZ(git(['ls-files', '-z', '--full-name', '--others', '--exclude-standard', '--']))) changed.add(p);
        stage = 'the daily gate record could not be located';
        const mainCheckout = path.dirname(path.resolve(args.repo, git(['rev-parse', '--git-common-dir']).trim()));
        runs = readContained(mainCheckout, RUNS_FILE, MAX_RUNS_BYTES);
    } catch (err) {
        const reason = stage + ': ' + String(err && err.message ? err.message : err);
        process.stdout.write(render({ lane: 'whole', reason, places: [], tests: [], suites: [], layers: map.layers }).join('\n') + '\n');
        return 0;
    }

    const exists = (rel) => fs.existsSync(path.join(args.repo, rel));
    const result = classify({
        map,
        changes: [...changed].sort(),
        recordText: typeof runs === 'string' ? runs : null,
        now: new Date(),
        exists
    });
    process.stdout.write(render(result).join('\n') + '\n');
    return 0;
}

module.exports = { classify, render, recordProblem, placePath, holds, localDate, parseArgs, readMap, isProse, SELF, NO_RECORD };

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (err) {
        const raw = String(err && err.message ? err.message : err);
        // Where the screen itself fails, its libraries unloadable among the
        // causes, the raw message still makes one line and the exit stays 2.
        let msg;
        try { msg = safePath(raw); } catch { msg = raw.replace(/[\r\n]+/g, ' '); }
        process.stderr.write('gate-lane: ' + msg + '\n');
        process.exitCode = 2;
    }
}
