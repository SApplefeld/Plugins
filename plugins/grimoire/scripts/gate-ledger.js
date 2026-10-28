#!/usr/bin/env node
// gate-ledger: the test figures a Chapter's `Gate:` line carries for a
// section's delta. `gate-ledger.js <base> [<head>]`, run inside the
// repository, reads `git diff --numstat <base>..<head>`, head defaulting to
// HEAD, and prints one line:
//
//   tests +<added> -<retired>; test/prod lines <test>/<prod>; slowest: unmeasured; fixtures: unmeasured
//
// Each changed file is a test, production, or excluded. A file is a test where
// the repository's lane map, test/gate-lanes.json, lists it under a row's
// `tests` or `suites`, or where it sits under the folder holding any path a
// row lists under `suites`, test-personas/ in the kit, the folders read from
// the map. Where none of those holds, it is a test where its name carries
// `.test.` or `.spec.` or it sits under a top-level test/ or tests/ folder.
// Ahead of all of these, three kinds the whole-gate bullet of
// skills/test-gates/SKILL.md names as not code are excluded: markdown and
// plain text, by gate-lane's isProse, and test/size-budget.json, the one
// budget file that bullet names. Any other file is production, and a data
// fixture under a test or suite folder counts as a test file. BUDGET_FILES
// and DATA_FORM enumerate the kit's own members, never the whole class the
// skill states.
//
// The line figure is each class's added plus deleted lines, a binary file
// counting zero. A test is counted added or retired by a test-name line, one
// opening `test(` or `it(`, entering or leaving the diff of the test files.
// That is the node runner's form. The figure reads `tests: unmeasured` where
// a changed test file is an exact path the map lists under `suites`, whose
// runner this script does not know whatever the file holds. It reads the same
// where a changed test file is neither a .js, .mjs or .cjs file nor a .json,
// .jsonl, .yaml or .yml file. Either case blanks the count for every node
// file beside it in the same range. A structured-data test file holds no test
// names, so it leaves the count measured, and its lines still count on the
// test side. Any other file in a suite folder takes the same rules as a file
// under test/. The slowest files and the fixture time come from the project's
// runner log and fixture timer, which this script does not read, so both
// always read `unmeasured`.
//
// Every git call goes through `gitRun` in
// plugins/grimoire/hooks/kit-git-lib.js, as gate-lane.js's do: an argument
// array with no shell, every `GIT_*` variable stripped, core.fsmonitor and
// core.hooksPath pinned inert, and output past 1 MB read as a failure. The two
// diffs also pass --no-ext-diff and --no-textconv, so a diff driver the
// repository configures never runs. The script writes nothing.
//
// Exit codes:
//   0  the line printed
//   2  an argument was refused, the lane map could not be read, or a git call
//      failed, with the reason on stderr

'use strict';

const path = require('path');
const { gitRun } = require('../hooks/kit-git-lib.js');
const { readMap, isProse } = require('./gate-lane.js');
const { safePath } = require('./kit-size.js');

const GIT_TIMEOUT_MS = 30000;
// The budget or fixture file the whole-gate bullet names as not code.
const BUDGET_FILES = ['test/size-budget.json'];
// The test files whose test-name form this script knows: node's runner.
const NODE_FORM = /\.(?:js|mjs|cjs)$/i;
// Test files that hold data, never a test name.
const DATA_FORM = /\.(?:json|jsonl|ya?ml)$/i;
const TEST_NAME = /^\s*(?:test|it)\(/;

// Whether a row lists the path under `suites`, whose runner is not node's.
function isSuite(map, relPath) {
    return map.rows.some((row) => row.suites.includes(relPath));
}

// Whether the path sits under the folder holding a `suites` entry.
function inSuiteFolder(map, relPath) {
    return map.rows.some((row) => row.suites.some((s) => s.includes('/') && relPath.startsWith(s.slice(0, s.lastIndexOf('/') + 1))));
}

// One changed path's class: 'excluded', 'test' or 'production'.
function classifyPath(map, relPath) {
    if (isProse(relPath) || BUDGET_FILES.includes(relPath)) return 'excluded';
    if (map.rows.some((row) => row.tests.includes(relPath)) || isSuite(map, relPath) || inSuiteFolder(map, relPath)) return 'test';
    if (/\.(?:test|spec)\./.test(path.posix.basename(relPath)) || /^tests?\//.test(relPath)) return 'test';
    return 'production';
}

// The rows of `git diff --numstat -z`: { added, deleted, paths }, the new path
// last. A rename's row carries an empty path field and the old and new paths
// after it; a binary file's counts read `-` and count zero.
function parseNumstat(text) {
    const tokens = text.split('\0');
    const rows = [];
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === '') continue;
        const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[i]);
        if (!m) throw new Error('git diff --numstat printed a row this script cannot read');
        let paths = [m[3]];
        if (m[3] === '') {
            paths = [tokens[i + 1], tokens[i + 2]];
            i += 2;
            if (!paths[0] || !paths[1]) throw new Error('git diff --numstat printed a rename row with no paths');
        }
        const count = (v) => (v === '-' ? 0 : Number(v));
        rows.push({ added: count(m[1]), deleted: count(m[2]), paths });
    }
    return rows;
}

// The test-name lines added and removed in a -U0 patch, counted inside hunks
// only, so a file header is never read as a line.
function countTestNames(patch) {
    let added = 0;
    let retired = 0;
    let inHunk = false;
    for (const line of patch.split('\n')) {
        if (line.startsWith('diff --git ')) inHunk = false;
        else if (line.startsWith('@@')) inHunk = true;
        else if (inHunk && line[0] === '+' && TEST_NAME.test(line.slice(1))) added++;
        else if (inHunk && line[0] === '-' && TEST_NAME.test(line.slice(1))) retired++;
    }
    return { added, retired };
}

// The printed line, from the numstat rows and the test-name counts, the
// counts null where the runner form is not known.
function render(rows, map, names) {
    let testLines = 0;
    let prodLines = 0;
    for (const row of rows) {
        const kind = classifyPath(map, row.paths[row.paths.length - 1]);
        if (kind === 'test') testLines += row.added + row.deleted;
        else if (kind === 'production') prodLines += row.added + row.deleted;
    }
    const tests = names === null ? 'tests: unmeasured' : 'tests +' + names.added + ' -' + names.retired;
    return [tests, 'test/prod lines ' + testLines + '/' + prodLines, 'slowest: unmeasured', 'fixtures: unmeasured'].join('; ');
}

function parseArgs(argv) {
    if (argv.length < 1 || argv.length > 2) throw new Error('usage: gate-ledger.js <base> [<head>]');
    for (const a of argv) {
        if (a === '' || a.startsWith('-')) throw new Error(JSON.stringify(a) + ' is not a ref');
    }
    return { base: argv[0], head: argv[1] || 'HEAD' };
}

function main(argv) {
    const args = parseArgs(argv);
    // gitRun answers null for a run that did not finish, and { status, stdout }
    // for one that did, whatever its exit code; it keeps no stderr.
    const git = (repo, gitArgs, refusal) => {
        const res = gitRun(repo, gitArgs, { timeoutMs: GIT_TIMEOUT_MS });
        const call = 'git ' + gitArgs.slice(0, 3).join(' ');
        if (!res) throw new Error(call + ' did not run to its end, so git is missing, failed to start, timed out or wrote past 1 MB');
        if (res.status !== 0) throw new Error((refusal || call) + ' exited ' + res.status);
        return res.stdout;
    };
    const repo = path.resolve(git(process.cwd(), ['rev-parse', '--show-toplevel'], 'the working directory is not in a repository: git rev-parse').trim());
    const { map, mapProblem } = readMap(repo);
    if (map === null) throw new Error(mapProblem + ' at test/gate-lanes.json, so no changed file can be classed');
    const commit = (ref) => git(repo, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'],
        ref + ' does not resolve to a commit: git rev-parse --verify').trim();
    const range = commit(args.base) + '..' + commit(args.head);
    const rows = parseNumstat(git(repo, ['diff', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv', range]));

    const testRows = rows.filter((r) => classifyPath(map, r.paths[r.paths.length - 1]) === 'test');
    let names = { added: 0, retired: 0 };
    const paths = testRows.flatMap((r) => r.paths);
    if (paths.some((p) => isSuite(map, p) || !(NODE_FORM.test(p) || DATA_FORM.test(p)))) names = null;
    else if (paths.some((p) => NODE_FORM.test(p))) {
        // Both sides of a rename go to the diff, so -M pairs them.
        const named = testRows.filter((r) => r.paths.some((p) => NODE_FORM.test(p))).flatMap((r) => r.paths);
        names = countTestNames(git(repo, ['--literal-pathspecs', 'diff', '-U0', '--no-color', '-M', '--no-ext-diff', '--no-textconv', range, '--'].concat(named)));
    }
    process.stdout.write(render(rows, map, names) + '\n');
    return 0;
}

module.exports = { classifyPath, parseNumstat, countTestNames, render, parseArgs, BUDGET_FILES };

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (err) {
        const raw = String(err && err.message ? err.message : err);
        let msg;
        try { msg = safePath(raw); } catch { msg = raw.replace(/[\r\n]+/g, ' '); }
        process.stderr.write('gate-ledger: ' + msg + '\n');
        process.exitCode = 2;
    }
}
