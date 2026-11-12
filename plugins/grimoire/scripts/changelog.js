#!/usr/bin/env node
// changelog: the presence check a finishing pass runs before a pull request is
// marked ready, and the listing of a branch's changelog entries in the order
// they landed. An entry is one file under docs/changelog/ in the form the
// prose-register skill states: a first line `# Change: <title>`, then header
// lines, `Product:`, `Kind:` and `Plan:` among them.
//
//   node changelog.js check <plan path> [--repo <root>]
//   node changelog.js list [--repo <root>] [--branch <ref>]
//                          [--since <ref or YYYY-MM-DD>]
//
// `--repo` names a directory inside the repository, the working directory
// where it is left off. Both verbs work against the top level git names for
// it.
//
// `check` reads the plan document's last Chapter: the last `### Chapter N`
// heading inside the `## Chapters` block, down to the next `##` or `###`
// heading. It reads that Chapter's first line opening `Changelog:` and passes
// where the line's value is one of two things:
//
//   none, because <why>    with a reason that is not blank
//   <entry path>           a file under docs/changelog/ in the working tree
//                          that opens `# Change: ` and whose first `Plan:`
//                          line equals the plan path the check was handed
//
// A Chapter above the last one never counts. The plan path, the entry path and
// the `Plan:` value are each compared repo-relative with forward slashes: a
// backslash becomes a forward slash, and an absolute path under the repository
// becomes relative to it, by kit-plan-lib's normalizePlanArg. A relative plan
// path is read against the repository's top level. Both files are read through
// kit-read-lib: each must resolve, links followed, inside the repository's real
// top level, and the entry under that top level's own docs/changelog/, so
// neither `..` nor a link, the folder's own included, takes a read outside
// them. Each file read is a regular file under a size ceiling. A plan that
// fails this exits 2, and an entry that fails it is a fault the check prints.
// The check tells whether an entry or a reason is on record. It cannot tell
// whether the plan's change is visible.
//
// It prints one line, `changelog check: <what it found>`: what passed, or the
// fault.
//
// `list` prints one line per entry of a branch, newest first, by when each
// entry reached the branch. `--branch` names the branch, the checked-out HEAD
// where it is left off. The entries are the `.md` files in that commit's tree
// under docs/changelog/ at any depth, less docs/changelog/README.md, so a file
// not yet committed is not listed and a file of another type is ignored. An
// entry's landing commit is the oldest commit on the branch's first-parent
// history whose diff against its first parent adds the file, a merge that
// brought it in among them. So the order and the day come from git, never
// from a file's name or its `Date:` line, and a file removed and added again
// keeps its first landing. The landing day is that commit's committer date, as
// YYYY-MM-DD in the commit's own time zone. Entries landing in one commit list
// by path.
//
// A line holds five fields separated by tabs, or three for a walked file whose
// first line does not open `# Change: `:
//
//   <landing day> <kind> <product> <title> <path>
//   <landing day> unreadable <path>
//
// The kind and the product are the values of the file's first `Kind:` and
// `Product:` lines, empty where it has none. `--since <YYYY-MM-DD>` keeps the
// entries whose landing day is that day or later. `--since <ref>` keeps the
// entries whose landing commit the ref does not hold, which is the difference
// between two builds, less any entry whose path the ref's own tree holds. So
// an entry the branch took from the ref by a merge, whose landing commit is
// that merge, does not print.
//
// Every printed line goes through kit-size's safePath, the screen for text a
// close-out quotes. It drops every character outside printable ASCII, a tab
// among them, so no value can add a field or a line, and it cuts a value past
// 320 characters.
//
// Every git call goes through `gitRun` in plugins/grimoire/hooks/kit-git-lib.js,
// as gate-ledger.js's do: an argument array with no shell, every `GIT_*`
// variable stripped, core.fsmonitor and core.hooksPath pinned inert, and
// output past 1 MB read as a failure. The landing read is one `git log` over
// the branch's whole first-parent history, about 130 bytes an entry, so a
// branch holding several thousand entries passes that bound and `list` then
// exits 2 saying so. The log passes --no-show-signature, so a repository's
// log.showSignature cannot run its gpg.program or put a signature among the
// lines the script reads. `--since <ref>` adds one more `git log`, over the
// commits the ref does not hold, and one more `git ls-tree`, of the ref's
// commit. The read of the files' own lines goes 100 files a call. A ref is
// resolved to a commit id before any other call takes it, and one opening
// with a dash is refused. The script writes nothing.
//
// Exit codes:
//   0  `check` passed, or `list` printed its lines, none where the branch
//      holds no docs/changelog/
//   1  `check` found neither an entry nor a reason, with the fault on stdout
//   2  the verb could not run, with the reason on stderr: an unknown verb, a
//      missing or refused argument, a plan file that cannot be read, a
//      directory in no git repository, or a git call that failed

'use strict';

const fs = require('fs');
const path = require('path');
const { gitRun } = require('../hooks/kit-git-lib.js');
const { normalizePlanArg } = require('../hooks/kit-plan-lib.js');
const { CHAPTERS_HEADING, CHAPTER_HEADING, BLOCK_HEADING } = require('./plan-contract.js');
const { safePath } = require('./kit-size.js');
const { readFileBounded, containedRealPath } = require('../hooks/kit-read-lib.js');

const GIT_TIMEOUT_MS = 60000;
// The label of the Chapter line that names a plan's entry or its reason.
const CHANGELOG_LABEL = 'Changelog:';
const NO_ENTRY = 'none, because ';
const FOLDER = 'docs/changelog/';
const FOLDER_README = FOLDER + 'README.md';
const TITLE = '# Change: ';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// How many files one read of the entries' own lines names.
const READ_BATCH = 100;
// The largest plan document and entry `check` reads.
const PLAN_CEILING_BYTES = 8 * 1024 * 1024;
const ENTRY_CEILING_BYTES = 256 * 1024;
const USAGE = 'usage: changelog.js check <plan path> [--repo <root>], or changelog.js list [--repo <root>] [--branch <ref>] [--since <ref or YYYY-MM-DD>]';
const FLAGS = {
    check: new Map([['--repo', 'repo']]),
    list: new Map([['--repo', 'repo'], ['--branch', 'branch'], ['--since', 'since']])
};

function parseArgs(argv) {
    const verb = argv[0];
    if (verb === undefined) throw new Error('no verb given; ' + USAGE);
    if (!Object.prototype.hasOwnProperty.call(FLAGS, verb)) throw new Error('unknown verb ' + JSON.stringify(verb) + '; ' + USAGE);
    const args = { verb, plan: null, repo: null, branch: null, since: null };
    for (let i = 1; i < argv.length; i++) {
        const key = FLAGS[verb].get(argv[i]);
        if (key === undefined) {
            if (verb !== 'check' || args.plan !== null || argv[i] === '' || argv[i].startsWith('-')) {
                throw new Error('unknown argument ' + JSON.stringify(argv[i]) + ' for ' + verb + '; ' + USAGE);
            }
            args.plan = argv[i];
            continue;
        }
        if (args[key] !== null) throw new Error(argv[i] + ' is given twice');
        const value = argv[++i];
        if (value === undefined || value === '') throw new Error(argv[i - 1] + ' needs a value');
        args[key] = value;
    }
    if (verb === 'check' && args.plan === null) throw new Error('check needs a plan path; ' + USAGE);
    for (const key of ['branch', 'since']) {
        if (args[key] !== null && args[key].startsWith('-')) throw new Error(JSON.stringify(args[key]) + ' is not a ref');
    }
    return args;
}

// One git call's stdout. gitRun answers null for a run that did not finish,
// and { status, stdout } for one that did, whatever its exit code; it keeps no
// stderr. An exit code outside `allowed` throws.
function git(repo, gitArgs, refusal, allowed) {
    const res = gitRun(repo, gitArgs, { timeoutMs: GIT_TIMEOUT_MS });
    const call = 'git ' + gitArgs.find((a) => !a.startsWith('-') && !a.includes('='));
    if (!res) throw new Error(call + ' did not run to its end, so git is missing, failed to start, timed out or wrote past 1 MB');
    if (!(allowed || [0]).includes(res.status)) throw new Error((refusal || call) + ' exited ' + res.status);
    return res.stdout;
}

const errorCode = (err) => String((err && (err.code || err.name)) || 'an error');

// A real path strictly below a real folder. path.relative folds case on win32,
// where two casings are one place.
function below(dir, p) {
    const rel = path.relative(dir, p);
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

// The plan's last Chapter as { number, lines }, or null where the Chapters
// block holds none. The blocks are walked as plan-contract.js walks them: the
// first line reading `## Chapters` alone opens the block, and the next `##`
// heading closes it.
function lastChapter(text) {
    const lines = text.split(/\r?\n/);
    let inChapters = false;
    let opened = false;
    let last = null;
    for (let i = 0; i < lines.length; i++) {
        if (BLOCK_HEADING.test(lines[i])) {
            inChapters = !opened && CHAPTERS_HEADING.test(lines[i]);
            if (inChapters) opened = true;
            continue;
        }
        const heading = inChapters ? CHAPTER_HEADING.exec(lines[i]) : null;
        if (heading) last = { number: heading[1], at: i };
    }
    if (last === null) return null;
    let end = last.at + 1;
    while (end < lines.length && !BLOCK_HEADING.test(lines[end]) && !/^###(?!#)/.test(lines[end])) end++;
    return { number: last.number, lines: lines.slice(last.at + 1, end) };
}

// The text of the repository-relative file `rel` as { text }, or { fault }
// naming why it was not read: absent, resolving outside the repository's real
// top level or, where `under` is given, outside that folder of it, not a
// regular file, past `ceiling` bytes, or changed while it was read.
function readInside(repo, rel, ceiling, under) {
    const full = path.join(repo, rel);
    try {
        fs.lstatSync(full);
    } catch (err) {
        return { fault: 'is not a readable file, on ' + errorCode(err) };
    }
    const real = containedRealPath(repo, full);
    let top = null;
    try { top = fs.realpathSync(repo); } catch { /* judged below */ }
    if (real === null || top === null) return { fault: 'does not resolve inside the repository' };
    if (under !== undefined && !below(path.join(top, under), real)) return { fault: 'resolves outside ' + under };
    const res = readFileBounded(real, ceiling);
    if (res === null) return { fault: 'is not a readable file' };
    if (res.boundedBy === 'ceiling') return { fault: 'is larger than ' + ceiling + ' bytes' };
    if (res.bounded) return { fault: 'changed while it was read' };
    return { text: res.text };
}

// What `check` found, as { pass, found }: the passing reading or the fault.
function checkPlan(repo, plan, text) {
    const repoRel = (p) => normalizePlanArg(repo, p.replace(/\\/g, '/'));
    const fault = (found) => ({ pass: false, found });
    const chapter = lastChapter(text);
    if (chapter === null) return fault('the plan holds no Chapter, so no ' + CHANGELOG_LABEL + ' line is on record');
    const line = chapter.lines.find((l) => l.startsWith(CHANGELOG_LABEL));
    const where = 'the last Chapter, Chapter ' + chapter.number + ', ';
    if (line === undefined) return fault(where + 'holds no ' + CHANGELOG_LABEL + ' line');
    const value = line.slice(CHANGELOG_LABEL.length).trim();
    if (value.startsWith(NO_ENTRY)) return { pass: true, found: where + 'records none, with a reason' };
    if (value === '' || /^none\b/.test(value)) {
        return fault(where + 'reads ' + CHANGELOG_LABEL + ' ' + value + ', which gives no reason; the line names an entry or reads "none, because <why>"');
    }
    const entry = repoRel(value);
    if (entry === null || !entry.startsWith(FOLDER)) return fault(where + 'names ' + value + ', which is not a repository path under ' + FOLDER);
    const read = readInside(repo, entry, ENTRY_CEILING_BYTES, FOLDER);
    if (read.fault !== undefined) return fault('the entry ' + entry + ' ' + read.fault);
    const body = read.text;
    if (!body.startsWith(TITLE)) return fault('the entry ' + entry + ' does not open "' + TITLE + '"');
    const planLine = /^Plan:(.*)$/m.exec(body);
    if (planLine === null) return fault('the entry ' + entry + ' carries no Plan: line');
    if (repoRel(planLine[1].trim()) !== plan) return fault('the entry ' + entry + ' carries Plan: ' + planLine[1].trim() + ', not ' + plan);
    return { pass: true, found: where + 'names the entry ' + entry };
}

function check(repo, args) {
    const plan = normalizePlanArg(repo, args.plan.replace(/\\/g, '/'));
    if (plan === null) throw new Error('the plan path does not name a file under the repository');
    const read = readInside(repo, plan, PLAN_CEILING_BYTES);
    if (read.fault !== undefined) throw new Error('the plan file ' + plan + ' ' + read.fault);
    const result = checkPlan(repo, plan, read.text);
    process.stdout.write(safePath('changelog check: ' + result.found) + '\n');
    return result.pass ? 0 : 1;
}

// Each added file's landing as { commit, order, day }, keyed by path, from the
// first-parent log of the tip, less the commits `held` holds where it is a
// commit. The log runs newest first, so a path's last sighting is its oldest
// add, and `order` counts the adding commits from the tip. A commit's record
// opens with the 0x01 byte the format puts there, and each path it added
// follows as its own NUL-ended token.
function landings(repo, tip, held) {
    const out = git(repo, ['-c', 'log.showRoot=true', '--literal-pathspecs', 'log', '--no-show-signature', '--first-parent', '--diff-merges=first-parent',
        '--no-renames', '--no-ext-diff', '--no-textconv', '--diff-filter=A', '--name-only', '-z', '--format=%x01%H%x09%cs', tip]
        .concat(held === null ? [] : ['--not', held], ['--', FOLDER]));
    const landed = new Map();
    let landing = null;
    let order = -1;
    for (const raw of out.split('\0')) {
        const token = raw.replace(/^\n+/, '');
        if (token.startsWith('\x01')) {
            const [commit, day] = token.slice(1).split('\t');
            if (!DAY.test(day)) throw new Error('git log printed a commit row this script cannot read');
            landing = { commit, order: ++order, day };
        } else if (token !== '') {
            if (landing === null) throw new Error('git log printed a path ahead of any commit row');
            landed.set(token, landing);
        }
    }
    return landed;
}

// The title, kind and product of each named file in the commit's tree, keyed
// by path. A file whose first line does not open `# Change: ` has no title.
// git grep prints `<commit>:<path>`, the line number and the line, the first
// two NUL-ended, and exits 1 where no line matched.
function entryHeads(repo, tip, paths) {
    const heads = new Map();
    for (let i = 0; i < paths.length; i += READ_BATCH) {
        const out = git(repo, ['--literal-pathspecs', 'grep', '-n', '-z', '--no-color', '--no-column', '--no-textconv', '-I', '-E',
            '-e', '^' + TITLE, '-e', '^Kind:', '-e', '^Product:', tip, '--'].concat(paths.slice(i, i + READ_BATCH)), null, [0, 1]);
        for (const row of out.split('\n')) {
            if (row === '') continue;
            const parts = row.split('\0');
            if (parts.length < 3 || !parts[0].startsWith(tip + ':')) throw new Error('git grep printed a row this script cannot read');
            const file = parts[0].slice(tip.length + 1);
            const text = parts.slice(2).join('\0').replace(/\r$/, '');
            const head = heads.get(file) || {};
            heads.set(file, head);
            if (text.startsWith(TITLE)) {
                if (parts[1] === '1') head.title = text.slice(TITLE.length).trim();
            } else {
                const key = text.startsWith('Kind:') ? 'kind' : 'product';
                if (head[key] === undefined) head[key] = text.slice(text.indexOf(':') + 1).trim();
            }
        }
    }
    return heads;
}

function list(repo, args) {
    const commit = (ref) => git(repo, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'],
        ref + ' does not resolve to a commit: git rev-parse --verify').trim();
    const tip = commit(args.branch === null ? 'HEAD' : args.branch);
    const sinceDay = args.since !== null && DAY.test(args.since) ? args.since : null;
    const sinceRef = args.since !== null && sinceDay === null ? commit(args.since) : null;
    const tree = (commitId) => git(repo, ['ls-tree', '-r', '-z', '--name-only', commitId, '--', FOLDER]).split('\0');
    const walked = tree(tip).filter((p) => p.endsWith('.md') && p !== FOLDER_README);
    if (walked.length === 0) return 0;
    const landed = landings(repo, tip, null);
    // Where a ref bounds the list: the adding commits the ref does not hold,
    // and the paths the ref's own tree holds.
    const fresh = sinceRef === null ? null : new Set([...landings(repo, tip, sinceRef).values()].map((l) => l.commit));
    const held = sinceRef === null ? null : new Set(tree(sinceRef));
    const kept = [];
    for (const file of walked) {
        const landing = landed.get(file);
        if (landing === undefined) throw new Error('git log names no commit on the branch that added ' + file);
        if (fresh !== null && (!fresh.has(landing.commit) || held.has(file))) continue;
        if (sinceDay === null || landing.day >= sinceDay) kept.push({ file, order: landing.order, day: landing.day });
    }
    kept.sort((a, b) => a.order - b.order || (a.file < b.file ? -1 : 1));
    const heads = entryHeads(repo, tip, kept.map((e) => e.file));
    for (const entry of kept) {
        const head = heads.get(entry.file) || {};
        const fields = head.title === undefined
            ? [entry.day, 'unreadable', entry.file]
            : [entry.day, head.kind || '', head.product || '', head.title, entry.file];
        process.stdout.write(fields.map(safePath).join('\t') + '\n');
    }
    return 0;
}

function main(argv) {
    const args = parseArgs(argv);
    const from = args.repo === null ? process.cwd() : path.resolve(args.repo);
    const repo = path.resolve(git(from, ['rev-parse', '--show-toplevel'],
        (args.repo === null ? 'the working directory' : '--repo') + ' is not in a git repository: git rev-parse').replace(/\r?\n$/, ''));
    // The screen every line prints through is tried before anything is read,
    // so a screen that cannot load is a refused call.
    safePath('');
    return args.verb === 'check' ? check(repo, args) : list(repo, args);
}

module.exports = { parseArgs, CHANGELOG_LABEL };

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (err) {
        const raw = String(err && err.message ? err.message : err);
        let msg;
        try { msg = safePath(raw); } catch { msg = raw.replace(/[\r\n]+/g, ' '); }
        process.stderr.write('changelog: ' + msg + '\n');
        process.exitCode = 2;
    }
}
