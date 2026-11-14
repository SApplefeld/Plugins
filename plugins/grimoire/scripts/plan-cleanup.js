#!/usr/bin/env node
// plan-cleanup: clears what a finished plan left on this machine's disk, and
// in its idle mode what no finishing pass cleared. It holds every check and
// every delete, so a skill names one command line and never a delete of its
// own.
//
//   node plan-cleanup.js --repo <checkout root> [--worktree <path>]
//                        [--scratch <plan file stem>] [--build-output]
//   node plan-cleanup.js --repo <checkout root> --idle
//
// `--repo` names the checkout that stays, the top level of a work tree. In
// the first form each other flag asks for one clearing, a flag left off asks
// for nothing, and the flags combine in one call. A relative `--worktree` path
// is read against the caller's working directory. `--idle` finds its own paths
// and takes no flag beside `--repo`.
//
// It prints one line per path, then the total:
//
//   removed <path> <bytes>    the path is gone, its bytes measured just before
//   left <path>: <reason>     a path asked for and not removed, or in the idle
//                             mode a quiet path that may hold work at risk
//   kept <path>: <reason>     a build-output candidate that failed a test or
//                             whose ignored or tracked read failed, or in the
//                             idle mode a quiet path that stays with no work
//                             at risk: a caller or a process is inside it or
//                             it failed the hold test another way, a tree
//                             nested under it was kept, it holds a tracked
//                             file or a listed worktree, or the worktree
//                             listing its build pass reads failed
//   freed <bytes>             the last line, the sum of the removed lines
//
// A path inside the repository prints relative to it, the repository itself
// prints as `the repository`, and every path prints through kit-size's
// safePath, the screen for text a close-out quotes, so a name holding a line
// break cannot print a line of its own. A reason is this script's own words
// naming the check that refused, with git's exit code where git refused,
// since gitRun keeps no error text.
//
// `--worktree <path>` removes one linked worktree, by these checks in order:
//
//   place test    the path resolves, links followed, to a folder under
//                 <repo>/.claude/worktrees/ as that folder is spelled, so a
//                 link at the folder itself fails it, and a link at the path
//                 fails it unless it resolves to a folder under there
//   listing test  `git worktree list --porcelain -z` names the resolved path
//                 as a linked worktree of the repository, so a link at the
//                 path that resolves to another registered tree passes both
//                 tests, and that tree is the one checked and removed
//   cwd test      this process's working directory is outside the tree
//   fetch test    `git fetch --all --prune` in the repository exits 0
//   commit test   `git rev-list --max-count=1 HEAD --not --remotes=<name>` in
//                 the tree, with one `--remotes=<name>` option for each remote
//                 the fetch refreshed, exits 0 and prints nothing, so such a
//                 remote holds every commit. `git remote` in the repository
//                 lists the remotes, once for the run. A remote counts where
//                 its name holds none of `*`, `?`, `[` and a backslash, since
//                 the option reads its value as a pattern, and where
//                 `git config --type=bool --get` answers unset or `false` for
//                 both `remote.<name>.skipFetchAll` and
//                 `remote.<name>.skipDefaultUpdate`, the two settings that
//                 take a remote out of the fetch. Where the list fails or no
//                 remote counts, every tree that reaches this test is left
//                 on it
//   status test   `git --no-optional-locks status --porcelain
//                 --untracked-files=all` in the tree exits 0 and prints
//                 nothing, and `git ls-files -v -z` there exits 0 and tags no
//                 file lower-case or `S`, since status cannot see an edit to a
//                 file with the assume-unchanged or skip-worktree bit. The
//                 option keeps status from rewriting the tree's index file,
//                 whose modification time the idle mode's quiet test reads
//
// A path that is not on disk and that git does not list is nothing owed and
// prints nothing. A path git lists whose folder is gone is left, since pruning
// a worktree record is branch-hygiene's. A registered worktree nested under
// the path is taken first, deepest first, by the cwd, commit and status tests,
// and a nested tree that is left leaves every tree above it, on the nested
// test. The removal is `git worktree remove <path>` with no flag. Where git
// exits non-zero the tree is left and nothing more is done to it, whatever
// git's list then reads. Where git exits 0 and a folder still stands, which is
// what git for Windows leaves around a junction in an ignored folder, the
// script confirms git no longer lists the path and that it still resolves
// under .claude/worktrees/, then removes the folder itself. Ignored files are
// not inspected and leave with the tree.
//
// `--scratch <stem>` removes <repo>/.kit/scratch/<stem>/. The stem matches
// ^[A-Za-z0-9_-][A-Za-z0-9._-]*$ or the call is malformed. Three tests guard
// the removal. The link test: the folder is a real directory by lstat and
// never a link. The place test: it resolves, links and short names followed,
// to the path as written under <repo>/.kit/scratch/, compared in any letter
// case on Windows and exactly elsewhere. The tracked test: it holds no file
// git tracks. A folder that is not there is nothing owed.
//
// `--build-output` removes .NET build output in <repo>. A candidate is a real
// directory spelled exactly `bin` or `obj`, reached through no link, in the
// same folder as a tracked *.csproj, *.fsproj, *.vbproj or *.sqlproj. It is
// removed where it passes two tests, and printed `kept` where either fails.
// The ignored test: `git check-ignore --no-index` reads it ignored, by the
// ignore rules alone. The tracked test: `git ls-files` finds no tracked file
// in it. Anything else is no candidate and prints nothing.
//
// `--idle` clears what no finishing pass cleared, in three passes. It removes
// a path only where the path is quiet and passes the hold test.
//
//   quiet       no entry at or under the path was modified in the last
//               IDLE_DAYS days, counted back from the run's start. An entry is
//               a file, a folder or a link, the path itself among them, and
//               ignored entries and a nested worktree's entries count. The
//               walk reads a link and never follows one, and an entry it
//               cannot read counts as modified. A worktree is quiet only where
//               no file or link in the folder `git rev-parse --absolute-git-dir`
//               prints in it was modified, that folder's top-level `logs` and
//               its folders' own times unread, and where no tree nested under
//               it failed this test.
//               No access time, commit date or pull request state is read.
//   hold test   the path is renamed to `<path>.idle-probe` and straight back,
//               and both moves succeed. Windows refuses the first move while a
//               process has the folder or one below it as its working
//               directory, or holds a file under it open. Elsewhere the move
//               succeeds under a live process, and the quiet test is then the
//               whole in-use bound, as it is for a plain file a reader opened
//               sharing delete. A path already standing at the probe name
//               fails the test and nothing moves. The move back is tried five
//               times, 200 ms apart, and a path it could not move back is
//               `left`, the line naming the probe name it stands at.
//
// A path that is not quiet prints nothing and stays. The run reads the
// modification time of the folder holding a path before the hold test, and
// sets it back after the move back and after the removal, so its own moves
// never make a standing tree read as modified.
//
// The worktree pass takes every linked worktree git lists under
// <repo>/.claude/worktrees/, deepest path first. A listed tree there whose
// folder is gone is `left` on the listing test. Each quiet tree takes the cwd
// test, the nested test, the fetch, commit and status tests of `--worktree`,
// the quiet test again and the hold test, in that order, and is then removed
// as `--worktree` removes one. A tree that fails the cwd test or the hold test
// is `kept`. One above a nested tree that was not quiet at either reading
// prints nothing and stays, one above a nested tree that was left is `left`,
// and one above a nested tree that was kept is `kept`. One that fails the
// fetch, commit or status test is `left`. The fetch runs once, and only where
// a quiet tree passed the cwd test, and it starts no gc or maintenance.
//
// The scratch pass takes each folder or plain file directly under
// <repo>/.kit/scratch/, and a link there is no candidate. A quiet entry takes
// the place test and the tracked test of `--scratch`, then the worktree test,
// that it is not at or above a path git lists as a worktree, then the hold
// test. It is `left` on the place test and on a tracked read that failed, and
// `kept` where it holds a tracked file or a listed worktree or fails the hold
// test, since those do not pass with time.
//
// The build-output pass takes the `--build-output` candidates of the
// repository and of each worktree under <repo>/.claude/worktrees/ still
// standing, each from that tree's own tracked project files. A quiet candidate
// takes the ignored and tracked tests in its tree, then the worktree test of
// the scratch pass, then the hold test, and is `kept` where any fails.
//
// Every git call goes through `gitRun` in plugins/grimoire/hooks/kit-git-lib.js:
// an argument array with no shell, each path one element, git spawned from the
// hooks directory with `-C` naming the repository, every `GIT_*` variable
// stripped, and core.fsmonitor and core.hooksPath pinned inert. So a name may
// hold a quote, a space or a dash and stay a name. No removal is ever forced:
// git's remove takes no flag, and Node's remove takes `recursive` alone, so
// each folder is tested for by lstat first. No walk, measure or remove follows
// a link, so a link's target survives the removal of the link.
//
// The script deletes no branch, prunes no worktree record, reads no registry
// and checks no free space. Its fetch's `--prune` does prune remote-tracking
// refs whose remote branch is gone. A second run with the same arguments is
// safe and prints `freed 0` where nothing remains. A folder git left whose own
// removal then failed is an unlisted folder on that second run, and is left.
//
// It needs git 2.36 or later, the first to take `worktree list -z`.
//
// Residuals the checks do not close:
//   The commit test reads every ref under a counted remote's own
//   refs/remotes/<name>/, and the fetch's `--prune` never touches one the
//   remote's fetch refspec does not map, so such a ref may be stale when the
//   test reads it. A remote with no fetch refspec is the plainest case.
//   The commit test reads HEAD alone, so a commit held only by a per-worktree
//   ref or the tree's own reflog is lost with the tree. In the idle mode,
//   moving the checked-out branch by plumbing alone, such as `update-ref`,
//   writes nothing in the admin folder outside `logs`, which the quiet
//   test skips, so a commit that move strands on the reflog has no seven-day
//   grace either.
//   The branch for a tree git lists whose folder is gone has no test.
//
// Exit codes:
//   0  everything asked for was removed, kept or not there
//   1  at least one path printed `left`
//   2  the call was malformed or --repo is not a work tree's top level, with
//      the reason on stderr, and nothing was touched

'use strict';

const fs = require('fs');
const path = require('path');
const { gitRun } = require('../hooks/kit-git-lib.js');
const { safePath, repoRelative } = require('./kit-size.js');

// Bounds on one git call. The shared runner's default is sized for a small
// read, and each call here answers about a whole tree or moves one.
const READ_TIMEOUT_MS = 60000;
const FETCH_TIMEOUT_MS = 120000;
const REMOVE_TIMEOUT_MS = 900000;

const STEM = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const VALUED_FLAGS = new Map([['--repo', 'repo'], ['--worktree', 'worktree'], ['--scratch', 'scratch']]);
const BUILD_FLAG = '--build-output';
const IDLE_FLAG = '--idle';
// The listing reason for a listed tree whose folder is gone, in both modes.
const GONE = 'listing test: git lists the worktree and its folder is gone, and pruning the record is branch-hygiene\'s';
// The idle mode's bounds: how long a path must have gone unwritten, the name
// the hold test renames a path to, and how the move back is retried.
const IDLE_DAYS = 7;
const PROBE_SUFFIX = '.idle-probe';
const MOVE_BACK_TRIES = 5;
const MOVE_BACK_WAIT_MS = 200;
const PROJECT_FILES = ['*.csproj', '*.fsproj', '*.vbproj', '*.sqlproj'];
const OUTPUT_NAMES = ['bin', 'obj'];
const WORKTREES = path.join('.claude', 'worktrees');
const SCRATCH = path.join('.kit', 'scratch');
// The two `remote.<name>.*` settings that take a remote out of `fetch --all`,
// and the characters that make git read a `--remotes=` value as a pattern.
const SKIP_SETTINGS = ['skipFetchAll', 'skipDefaultUpdate'];
const PATTERN_CHARS = /[*?[\\]/;

function parseArgs(argv) {
    const args = { repo: null, worktree: null, scratch: null, buildOutput: false, idle: false };
    const flags = [...VALUED_FLAGS.keys(), BUILD_FLAG, IDLE_FLAG].join(', ');
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === BUILD_FLAG) {
            args.buildOutput = true;
            continue;
        }
        if (flag === IDLE_FLAG) {
            if (args.idle) throw new Error(flag + ' is given twice');
            args.idle = true;
            continue;
        }
        const key = VALUED_FLAGS.get(flag);
        if (key === undefined) throw new Error('unknown argument ' + JSON.stringify(flag) + '; the flags are ' + flags);
        if (args[key] !== null) throw new Error(flag + ' is given twice');
        const value = argv[++i];
        if (value === undefined || value === '') throw new Error(flag + ' needs a value');
        args[key] = value;
    }
    if (args.repo === null) throw new Error('--repo <checkout root> is required');
    if (args.idle && (args.worktree !== null || args.scratch !== null || args.buildOutput)) {
        throw new Error('--idle finds its own paths and takes no flag beside --repo');
    }
    if (args.scratch !== null && !STEM.test(args.scratch)) {
        throw new Error('--scratch ' + JSON.stringify(args.scratch) + ' is not a plan file stem, which matches ' + STEM.source);
    }
    return args;
}

// One git call as { status, out, why }. The status is git's exit code, or null
// for a run that did not finish. `why` words either failure for a reason line.
function git(dir, label, args, timeoutMs) {
    const res = gitRun(dir, args, { timeoutMs });
    if (!res) {
        return { status: null, out: '', why: 'git ' + label + ' did not run to its end, so git is missing, failed to start, timed out or wrote past 1 MB' };
    }
    return { status: res.status, out: res.stdout, why: 'git ' + label + ' exited ' + res.status };
}

// A path's real spelling: links followed and short names expanded for the part
// that is on disk, and the rest appended as written.
function canon(p) {
    let head = path.resolve(p);
    const tail = [];
    for (;;) {
        try {
            return path.join(fs.realpathSync.native(head), ...tail);
        } catch { /* this part is not on disk, so try its parent */ }
        const up = path.dirname(head);
        if (up === head) return path.resolve(p);
        tail.unshift(path.basename(head));
        head = up;
    }
}

// Two real paths naming one place, and a real path strictly below a real
// folder. path.relative folds case on win32, where two casings are one place.
// The folder is taken as spelled and never resolved here, so a folder that is
// itself a link holds nothing: what sits behind it resolves elsewhere.
function same(a, b) {
    return path.relative(a, b) === '';
}
function below(dir, p) {
    const rel = path.relative(dir, p);
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

// What is at a path, read without following a link, or null where nothing is.
// Any other failure throws, so a path that cannot be read is never taken as
// gone, and the clearing that met it prints `left` with the error code.
function lstatOrNull(p) {
    try {
        return fs.lstatSync(p);
    } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
        throw err;
    }
}
function realDir(p) {
    const st = lstatOrNull(p);
    return st !== null && st.isDirectory() && !st.isSymbolicLink();
}

// The bytes under a path, by a walk that reads a link and never follows one.
// An entry that cannot be read counts nothing.
function measure(root) {
    let total = 0;
    const stack = [root];
    while (stack.length > 0) {
        const p = stack.pop();
        let st;
        try {
            st = fs.lstatSync(p);
        } catch {
            continue;
        }
        total += st.size;
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        let names;
        try {
            names = fs.readdirSync(p);
        } catch {
            continue;
        }
        for (const name of names) stack.push(path.join(p, name));
    }
    return total;
}

// Whether a path is quiet: no entry at or under it was modified after the
// cutoff. The walk reads a link and never follows one, stops at the first
// later entry, and counts an entry it cannot read as later.
function quiet(root, cutoffMs) {
    const stack = [root];
    while (stack.length > 0) {
        const p = stack.pop();
        let names;
        try {
            const st = fs.lstatSync(p);
            if (st.mtimeMs > cutoffMs) return false;
            if (!st.isDirectory() || st.isSymbolicLink()) continue;
            names = fs.readdirSync(p);
        } catch {
            return false;
        }
        for (const name of names) stack.push(path.join(p, name));
    }
    return true;
}

// Whether a worktree's git admin folder is quiet: no file or link in it was
// modified after the cutoff. It reads no folder's own time and skips the
// folder's top-level `logs`, since a `git gc` or `git reflog expire` any
// session starts rewrites those in every linked worktree's admin folder even
// where nothing expires. The `HEAD` and `index` a commit or a checkout writes
// are still read. An entry it cannot read counts as later.
function adminQuiet(admin, cutoffMs) {
    const stack = [admin];
    while (stack.length > 0) {
        const p = stack.pop();
        let names;
        try {
            const st = fs.lstatSync(p);
            if (!st.isDirectory() || st.isSymbolicLink()) {
                if (st.mtimeMs > cutoffMs) return false;
                continue;
            }
            names = fs.readdirSync(p);
        } catch {
            return false;
        }
        for (const name of names) if (p !== admin || name !== 'logs') stack.push(path.join(p, name));
    }
    return true;
}

const errorCode = (err) => String((err && (err.code || err.name)) || 'an error');

// The lines one run prints, each written as its path is settled, so a run that
// dies partway has already said what it removed.
function makeRun(repo) {
    // The repository itself prints as a fixed label, so no line carries the
    // absolute checkout path. safePath is lossy: it drops every character
    // outside printable ASCII and cuts a line past 320 characters.
    const shown = (p) => (same(p, repo) ? 'the repository' : safePath(repoRelative(repo, p)));
    const run = { freed: 0, anyLeft: false, shown };
    const print = (line) => process.stdout.write(line + '\n');
    run.removed = (p, bytes) => {
        run.freed += bytes;
        print('removed ' + shown(p) + ' ' + bytes);
    };
    run.left = (p, reason) => {
        run.anyLeft = true;
        print('left ' + shown(p) + ': ' + safePath(reason));
    };
    run.kept = (p, reason) => print('kept ' + shown(p) + ': ' + safePath(reason));
    // Node's recursive remove of a folder or a plain file the caller has tested
    // for. It removes a link and leaves the link's target. A throw partway, a
    // locked file being the likely cause, leaves the path and the run goes on.
    run.remove = (p, bytes) => {
        try {
            fs.rmSync(p, { recursive: true, maxRetries: 5, retryDelay: 100 });
        } catch (err) {
            run.left(p, 'remove test: the path\'s removal stopped on ' + errorCode(err));
            return false;
        }
        run.removed(p, bytes);
        return true;
    };
    return run;
}

// The linked worktrees git lists for the repository, each as its real path, as
// { status, trees, all, why }. The first entry is the main worktree, which
// `all` holds and `trees` drops.
function linkedWorktrees(repo) {
    const res = git(repo, 'worktree list', ['worktree', 'list', '--porcelain', '-z'], READ_TIMEOUT_MS);
    const all = res.out.split('\0').filter((f) => f.startsWith('worktree ')).map((f) => canon(f.slice('worktree '.length)));
    return { status: res.status, trees: all.slice(1), all, why: res.why };
}

// The configured remotes whose refs the fetch refreshed, as { names, why },
// where `why` words a run that has none to count and is null otherwise. A name
// is the repository config's to choose, so it reaches git only inside one
// argument word. One holding a pattern character is never counted, since
// `--remotes=<name>` reads its value as a pattern and would match the refs of
// other remotes. A plain name still reads every ref under its own folder, so
// a counted `a` also reads a nested remote `a/b`'s refs under
// refs/remotes/a/b/, and the fetch prunes those through `a`'s default
// refspec. A remote counts only where each skip setting reads unset, which is
// exit 1 printing nothing, or `false`. Any other answer, a failed read among
// them, leaves it uncounted.
function countedRemotes(repo) {
    const listed = git(repo, 'remote', ['remote'], READ_TIMEOUT_MS);
    if (listed.status !== 0) return { names: [], why: listed.why };
    const off = (name, setting) => {
        const res = git(repo, 'config', ['config', '--type=bool', '--get', 'remote.' + name + '.' + setting], READ_TIMEOUT_MS);
        const out = res.out.trim();
        return (res.status === 1 && out === '') || (res.status === 0 && out === 'false');
    };
    const names = listed.out.split(/\r?\n/).filter((n) => n !== '' && !PATTERN_CHARS.test(n) && SKIP_SETTINGS.every((s) => off(n, s)));
    return { names, why: names.length > 0 ? null : 'no configured remote was refreshed by the fetch, so no ref is read' };
}

// Why one tree's content is not all on a remote the fetch refreshed, or null
// where it is. `remotes` is the run's countedRemotes answer, and each name in
// it reads every ref under refs/remotes/<name>/, a nested remote's among them.
function contentRefusal(tree, remotes) {
    if (!realDir(tree)) return GONE;
    if (remotes.why !== null) return 'commit test: ' + remotes.why;
    const ahead = git(tree, 'rev-list', ['rev-list', '--max-count=1', 'HEAD', '--not'].concat(remotes.names.map((n) => '--remotes=' + n)), READ_TIMEOUT_MS);
    if (ahead.status !== 0) return 'commit test: ' + ahead.why;
    if (ahead.out.trim() !== '') return 'commit test: HEAD holds a commit no ref of a remote the fetch refreshed reaches';
    // Without the option, status rewrites the index file of a tree whose
    // files' times moved, and the quiet test reads that file's time.
    const status = git(tree, 'status', ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], READ_TIMEOUT_MS);
    if (status.status !== 0) return 'status test: ' + status.why;
    if (status.out.trim() !== '') return 'status test: the tree holds a modified or untracked file';
    // Status does not read a file whose assume-unchanged or skip-worktree bit
    // is set, so the bit's presence refuses the tree. `ls-files -v` tags such a
    // file with a lower-case letter or `S`.
    const flags = git(tree, 'ls-files', ['ls-files', '-v', '-z'], READ_TIMEOUT_MS);
    if (flags.status !== 0) return 'status test: ' + flags.why;
    if (flags.out.split('\0').some((e) => /^[a-zS] /.test(e))) {
        return 'status test: a tracked file carries an assume-unchanged or skip-worktree bit, so status cannot see its edits';
    }
    return null;
}

// One checked tree's removal. Returns whether the tree is gone.
function removeTree(run, repo, anchor, tree) {
    const bytes = measure(tree);
    const gone = git(repo, 'worktree remove', ['worktree', 'remove', tree], REMOVE_TIMEOUT_MS);
    if (gone.status !== 0) {
        run.left(tree, 'removal: ' + gone.why);
        return false;
    }
    if (lstatOrNull(tree) === null) {
        run.removed(tree, bytes);
        return true;
    }
    // git reported the tree removed and a folder still stands at its path.
    const after = linkedWorktrees(repo);
    let reason = null;
    if (after.status !== 0) reason = 'listing test: a folder stands after the removal, and ' + after.why;
    else if (after.trees.some((t) => same(t, tree))) reason = 'listing test: a folder stands after the removal, and git still lists the path';
    else if (!realDir(tree) || !below(anchor, canon(tree))) reason = 'place test: the folder standing after the removal does not resolve under .claude/worktrees/ of the repository';
    if (reason !== null) {
        run.left(tree, reason);
        return false;
    }
    return run.remove(tree, bytes);
}

function clearWorktree(run, repo, asked) {
    const anchor = path.join(repo, WORKTREES);
    const target = canon(asked);
    const listed = linkedWorktrees(repo);
    if (listed.status !== 0) return run.left(target, 'listing test: ' + listed.why);
    const isListed = listed.trees.some((t) => same(t, target));
    if (lstatOrNull(path.resolve(asked)) === null) {
        if (isListed) run.left(target, GONE);
        return undefined;
    }
    if (!realDir(target) || !below(anchor, target)) {
        return run.left(target, 'place test: the path does not resolve to a folder under .claude/worktrees/ of the repository');
    }
    if (!isListed) return run.left(target, 'listing test: git worktree list does not name the path as a linked worktree of the repository');

    // A descendant's path is longer than its ancestor's, so the longest first
    // puts every nested tree ahead of each tree above it.
    const trees = listed.trees.filter((t) => below(target, t)).sort((a, b) => b.length - a.length).concat([target]);
    const leftTrees = [];
    const leave = (tree, reason) => {
        run.left(tree, reason);
        leftTrees.push(tree);
    };
    let cwd = null;
    try {
        cwd = canon(process.cwd());
    } catch { /* a working directory that cannot be read is not shown outside */ }
    for (const tree of trees) {
        if (cwd === null || same(tree, cwd) || below(tree, cwd)) leave(tree, 'cwd test: this process\'s working directory is inside the tree, or could not be read');
    }
    const pending = trees.filter((t) => !leftTrees.includes(t));
    if (pending.length === 0) return undefined;
    const fetch = git(repo, 'fetch', ['fetch', '--all', '--prune'], FETCH_TIMEOUT_MS);
    if (fetch.status !== 0) {
        for (const tree of pending) run.left(tree, 'fetch test: ' + fetch.why);
        return undefined;
    }
    const remotes = countedRemotes(repo);
    for (const tree of pending) {
        const reason = leftTrees.some((t) => below(tree, t)) ? 'nested test: a worktree nested under it was left' : contentRefusal(tree, remotes);
        if (reason !== null) leave(tree, reason);
        else if (!removeTree(run, repo, anchor, tree)) leftTrees.push(tree);
    }
    return undefined;
}

// The files git tracks at or under a repo-relative path, the name read as it
// is spelled and in any letter case, as { status, out, why }.
function trackedUnder(repo, rel) {
    return git(repo, 'ls-files', ['ls-files', '-z', '--', ':(icase,literal)' + rel], READ_TIMEOUT_MS);
}

function clearScratch(run, repo, stem) {
    const anchor = path.join(repo, SCRATCH);
    const target = path.join(anchor, stem);
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        if (err && err.code === 'ENOENT') return undefined;
        return run.left(target, 'link test: the scratch folder could not be read, on ' + errorCode(err));
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return run.left(target, 'link test: the scratch folder is a link or is not a directory');
    if (!same(canon(target), target)) return run.left(target, 'place test: the scratch folder does not resolve to its own spelling under .kit/scratch/ of the repository');
    const tracked = trackedUnder(repo, path.posix.join('.kit', 'scratch', stem));
    if (tracked.status !== 0) return run.left(target, 'tracked test: ' + tracked.why);
    if (tracked.out !== '') return run.left(target, 'tracked test: the scratch folder holds a file git tracks');
    run.remove(target, measure(target));
    return undefined;
}

// `repo` is the tree whose project files and rules are read. With a cutoff,
// which the idle mode passes, a candidate that is not quiet is passed over and
// a quiet one that passes both tests takes the hold test before it goes.
function clearBuildOutput(run, repo, cutoffMs, listed) {
    const idle = cutoffMs !== undefined;
    const projects = git(repo, 'ls-files', ['ls-files', '-z', '--'].concat(PROJECT_FILES), READ_TIMEOUT_MS);
    if (projects.status !== 0) return run.left(repo, 'project test: ' + projects.why);
    const folders = [...new Set(projects.out.split('\0').filter(Boolean).map((f) => path.posix.dirname(f)))].sort();
    for (const folder of folders) {
        // The names come from the folder's own listing, so a `Bin` that a
        // case-folding file system would answer to as `bin` is not taken.
        let names;
        try {
            names = fs.readdirSync(path.join(repo, folder));
        } catch {
            continue;
        }
        for (const name of OUTPUT_NAMES.filter((n) => names.includes(n))) {
            const rel = path.posix.join(folder, name);
            const full = path.join(repo, rel);
            if (!realDir(full) || !same(canon(full), full)) continue;
            if (idle && !quiet(full, cutoffMs)) continue;
            // The ignore rules are read without the index, so the two tests
            // are independent: a folder holding a tracked file passes this
            // one on its rule and is kept by the tracked test.
            const ignored = git(repo, 'check-ignore', ['check-ignore', '-q', '--no-index', '--', rel], READ_TIMEOUT_MS);
            const tracked = ignored.status === 0 ? trackedUnder(repo, rel) : null;
            if (ignored.status === 1) run.kept(full, 'ignored test: git does not read it ignored');
            else if (ignored.status !== 0) run.kept(full, 'ignored test: ' + ignored.why);
            else if (tracked.status !== 0) run.kept(full, 'tracked test: ' + tracked.why);
            else if (tracked.out !== '') run.kept(full, 'tracked test: it holds a file git tracks');
            else if (idle && listed.status !== 0) run.kept(full, 'worktree test: ' + listed.why);
            else if (idle && listed.all.some((t) => same(t, full) || below(full, t))) run.kept(full, 'worktree test: it holds a path git lists as a worktree');
            else if (idle) takeUnheld(run, full, () => run.remove(full, measure(full)));
            else run.remove(full, measure(full));
        }
    }
    return undefined;
}

// The last step for one quiet path that passed its pass's other tests: the
// hold test, then `remove`, which prints its own line and returns whether the
// path is gone. Returns `removed`, `kept` or `left`, the line the path printed.
function takeUnheld(run, p, remove) {
    const probe = p + PROBE_SUFFIX;
    let refusal = 'a path already stands at the probe name ' + run.shown(probe);
    try {
        fs.lstatSync(probe);
    } catch (err) {
        refusal = err && err.code === 'ENOENT' ? null : 'the probe name ' + run.shown(probe) + ' could not be read, on ' + errorCode(err);
    }
    // The moves below change the modification time of the folder holding the
    // path, which the quiet test reads where that folder is in a standing
    // tree. So the time is read first and set back after each move. A set-back
    // that fails changes no result.
    const holder = path.dirname(p);
    let before = null;
    try {
        before = fs.statSync(holder);
    } catch { /* a folder that cannot be read has no time to set back */ }
    const setBack = () => {
        try {
            if (before !== null) fs.utimesSync(holder, before.atimeMs / 1000, before.mtimeMs / 1000);
        } catch { /* the folder keeps the time the move gave it */ }
    };
    if (refusal === null) {
        try {
            fs.renameSync(p, probe);
        } catch (err) {
            refusal = 'the rename to the probe name stopped on ' + errorCode(err) + ', so a process may be inside the path or hold a file in it open';
        }
    }
    if (refusal !== null) {
        run.kept(p, 'hold test: ' + refusal);
        return 'kept';
    }
    let stuck = null;
    for (let tries = 1; ; tries++) {
        try {
            fs.renameSync(probe, p);
            stuck = null;
            break;
        } catch (err) {
            stuck = err;
        }
        if (tries === MOVE_BACK_TRIES) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, MOVE_BACK_WAIT_MS);
    }
    setBack();
    if (stuck !== null) {
        run.left(p, 'hold test: ' + run.shown(p) + ' was renamed to ' + run.shown(probe) + ' and every one of ' + MOVE_BACK_TRIES
            + ' moves back failed, the last on ' + errorCode(stuck) + ', so it stands at the probe name');
        return 'left';
    }
    try {
        return remove() ? 'removed' : 'left';
    } finally {
        setBack();
    }
}

// The idle mode's worktree pass. `listed` is the run's one linkedWorktrees
// answer.
function idleWorktrees(run, repo, listed, cutoffMs) {
    if (listed.status !== 0) return run.left(repo, 'listing test: ' + listed.why);
    const anchor = path.join(repo, WORKTREES);
    // How each tree that still stands was settled: `recent` for one that is
    // not quiet, and the word its line opened with for one kept or left.
    const settled = new Map();
    const above = (tree, word) => [...settled].some(([t, w]) => w === word && below(tree, t));
    const settle = (tree, word, reason) => {
        settled.set(tree, word);
        if (word !== 'recent') run[word](tree, reason);
    };
    let cwd = null;
    try {
        cwd = canon(process.cwd());
    } catch { /* a working directory that cannot be read is not shown outside */ }
    // The tree's git admin folder, whose index and HEAD a commit or a checkout
    // writes. One git cannot name reads as modified.
    const treeAdminQuiet = (tree) => {
        const admin = git(tree, 'rev-parse', ['rev-parse', '--absolute-git-dir'], READ_TIMEOUT_MS);
        const dir = admin.out.replace(/\r?\n$/, '');
        return admin.status === 0 && dir !== '' && adminQuiet(path.resolve(dir), cutoffMs);
    };
    // A descendant's path is longer than its ancestor's, so the longest first
    // puts every nested tree ahead of each tree above it.
    const pending = [];
    for (const tree of listed.trees.filter((t) => below(anchor, t)).sort((a, b) => b.length - a.length)) {
        // A folder that cannot be read counts as written later, as the quiet
        // test counts an entry it cannot read.
        let st;
        try {
            st = lstatOrNull(tree);
        } catch {
            settle(tree, 'recent');
            continue;
        }
        if (st === null) {
            settle(tree, 'left', GONE);
            continue;
        }
        // A listed path that is no real folder, a dangling link or a file,
        // prints nothing and holds each tree above it as a recent one does.
        if (!st.isDirectory() || st.isSymbolicLink()) {
            settle(tree, 'recent');
            continue;
        }
        if (above(tree, 'recent') || !quiet(tree, cutoffMs) || !treeAdminQuiet(tree)) {
            settle(tree, 'recent');
        } else if (cwd === null || same(tree, cwd) || below(tree, cwd)) {
            settle(tree, 'kept', 'cwd test: this process\'s working directory is inside the tree, or could not be read');
        } else {
            pending.push(tree);
        }
    }
    if (pending.length === 0) return undefined;
    // The fetch starts no gc or maintenance, so the sweep adds no write of its
    // own to any tree's admin folder.
    const fetch = git(repo, 'fetch', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--all', '--prune'], FETCH_TIMEOUT_MS);
    if (fetch.status !== 0) {
        for (const tree of pending) run.left(tree, 'fetch test: ' + fetch.why);
        return undefined;
    }
    const remotes = countedRemotes(repo);
    for (const tree of pending) {
        // An error no test foresaw leaves this tree, which holds each tree
        // above it, and the pass goes on to the next.
        try {
            let reason = null;
            // A tree nested under it that this loop found recent holds it as
            // the first loop's recent trees do, ahead of every test that prints.
            if (above(tree, 'recent')) settle(tree, 'recent');
            else if (above(tree, 'left')) settle(tree, 'left', 'nested test: a worktree nested under it was left');
            else if (above(tree, 'kept')) settle(tree, 'kept', 'nested test: a worktree nested under it was kept');
            else if ((reason = contentRefusal(tree, remotes)) !== null) settle(tree, 'left', reason);
            // The fetch and the removals before this tree can take minutes, so
            // its quiet reading is taken again just before the hold test.
            else if (!quiet(tree, cutoffMs) || !treeAdminQuiet(tree)) settle(tree, 'recent');
            else {
                const word = takeUnheld(run, tree, () => removeTree(run, repo, anchor, tree));
                if (word !== 'removed') settled.set(tree, word);
            }
        } catch (err) {
            settle(tree, 'left', 'the clearing stopped on ' + errorCode(err));
        }
    }
    return undefined;
}

// The idle mode's scratch pass, over each entry directly under the scratch
// folder.
function idleScratch(run, repo, listed, cutoffMs) {
    const anchor = path.join(repo, SCRATCH);
    let names;
    try {
        names = fs.readdirSync(anchor);
    } catch (err) {
        if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return undefined;
        throw err;
    }
    for (const name of names) {
        const target = path.join(anchor, name);
        let st;
        try {
            st = fs.lstatSync(target);
        } catch {
            continue;
        }
        if (st.isSymbolicLink() || !(st.isDirectory() || st.isFile()) || !quiet(target, cutoffMs)) continue;
        if (!same(canon(target), target)) {
            run.left(target, 'place test: the scratch entry does not resolve to its own spelling under .kit/scratch/ of the repository');
            continue;
        }
        const tracked = trackedUnder(repo, path.posix.join('.kit', 'scratch', name));
        if (tracked.status !== 0) run.left(target, 'tracked test: ' + tracked.why);
        else if (tracked.out !== '') run.kept(target, 'tracked test: the scratch entry is or holds a file git tracks');
        else if (listed.status !== 0) run.left(target, 'worktree test: ' + listed.why);
        else if (listed.all.some((t) => same(t, target) || below(target, t))) run.kept(target, 'worktree test: it holds a path git lists as a worktree');
        else takeUnheld(run, target, () => run.remove(target, measure(target)));
    }
    return undefined;
}

function main(argv) {
    const args = parseArgs(argv);
    let repo;
    try {
        repo = fs.realpathSync.native(path.resolve(args.repo));
    } catch {
        throw new Error('--repo does not name a folder on disk');
    }
    const top = git(repo, 'rev-parse', ['rev-parse', '--show-toplevel'], READ_TIMEOUT_MS);
    if (top.status !== 0) throw new Error('--repo is not a work tree: ' + top.why);
    if (!same(canon(top.out.replace(/\r?\n$/, '')), repo)) throw new Error('--repo is not the top level of its work tree');

    // The screen every line prints through is tried before anything is touched,
    // so a screen that cannot load is a refused call and never a silent removal.
    safePath('');
    const run = makeRun(repo);
    // An error no check foresaw leaves the path it met, and the run goes on.
    const clearing = (asked, fn) => {
        try {
            fn();
        } catch (err) {
            run.left(asked, 'the clearing stopped on ' + errorCode(err));
        }
    };
    if (args.idle) {
        const cutoffMs = Date.now() - IDLE_DAYS * 24 * 60 * 60 * 1000;
        const listed = linkedWorktrees(repo);
        clearing(repo, () => idleWorktrees(run, repo, listed, cutoffMs));
        clearing(path.join(repo, SCRATCH), () => idleScratch(run, repo, listed, cutoffMs));
        const anchor = path.join(repo, WORKTREES);
        for (const tree of [repo].concat(listed.trees.filter((t) => below(anchor, t)))) {
            clearing(tree, () => realDir(tree) && clearBuildOutput(run, tree, cutoffMs, listed));
        }
    }
    if (args.worktree !== null) clearing(path.resolve(args.worktree), () => clearWorktree(run, repo, args.worktree));
    if (args.scratch !== null) clearing(path.join(repo, SCRATCH, args.scratch), () => clearScratch(run, repo, args.scratch));
    if (args.buildOutput) clearing(repo, () => clearBuildOutput(run, repo));
    process.stdout.write('freed ' + run.freed + '\n');
    return run.anyLeft ? 1 : 0;
}

module.exports = { parseArgs };

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (err) {
        const raw = String(err && err.message ? err.message : err);
        // Where the screen itself fails, its libraries unloadable among the
        // causes, the raw message still makes one line and the exit stays 2.
        let msg;
        try { msg = safePath(raw); } catch { msg = raw.replace(/[\r\n]+/g, ' '); }
        process.stderr.write('plan-cleanup: ' + msg + '\n');
        process.exitCode = 2;
    }
}
