#!/usr/bin/env node
// kit-size: the size reading behind the kit's size ratchet. Its scope is the
// six roots in ROOTS below: the skills, agents and output-styles directories
// under plugins/grimoire/, the markdown files directly under home/,
// test/probes/, and test/. Each file it measures there is compared against a
// committed cap in test/size-budget.json, and what changed is reported. A
// tracked file outside those six roots is unmeasured, plugins/grimoire/hooks/,
// this script's own directory plugins/grimoire/scripts/,
// plugins/grimoire/doctor/ and every tracked file at the repository top level
// among them.
// test/size-ratchet.test.js is the gate that consumes it; this file is also the
// CLI a session runs by hand to read a section's size delta.
//
// Sizes are read from worktree content rather than from HEAD, so an uncommitted
// edit anywhere in the corpus moves the reading for every session sharing the
// checkout, and an over-cap failure therefore says the size came from the
// worktree and says whether that path currently differs from HEAD.
//
// The metric is per root, because the two corpora fail differently. Curated
// prose is measured in words, since prose grows by sentence and a line count of
// hard-wrapped markdown says more about the wrap than about the content. Test
// code is measured in lines, with a test-count reading beside it that is
// reported and never capped: the retire rule in the testing-discipline skill
// exists to make the test count go down, so a cap on it would fight the rule.
//
// A word is a whitespace-separated token after the YAML frontmatter is
// stripped, code fences included. Frontmatter is excluded because it is
// machine-read metadata rather than prose, and a fence is included because a
// worked example is content a reader pays for like any other.
//
// The file list comes from `git ls-files` rather than from a directory walk, so
// the caps and the totals are taken from tracked files alone. What that buys is
// a corpus no session's scratch can move: an in-flight file under a measured
// root would otherwise enter the totals, and the caps would drift with whoever
// happened to have a file on disk. Two readings reach past that listing without
// entering those totals, and both are narrow. A committed cap is held against
// its file from worktree content even where git reports that file as untracked,
// since a cap written in the changeset that adds the file is meant to bind it.
// And `report` names every untracked file a measured shape reaches beside its
// totals rather than omitting it silently. The gitignored built copy of the
// doctrine under
// plugins/grimoire/ stays out on a different mechanism, the root list, which
// holds no root above it; a directory walk would not have reached it either.
//
// The coverage control is the part that earns trust. A ratchet that greens on a
// file it never classified is the expensive failure here, so every tracked file
// under a root is either classified, or named on the short exclusion list
// below, or a failure. The shapes are narrower than the roots on purpose: a new
// kind of file appearing under a root (a reference nested one level deeper, a
// helper beside the tests) reds the ratchet rather than slipping past it
// unmeasured. The mirror holds too: a cap with no measured file behind it is a
// failure, so a deleted file cannot leave its cap rotting in the budget. The one
// state between the two is a cap whose file git reports as untracked and present
// under a measured root, which is how a file and its cap ride in one changeset;
// that state is reported rather than failed for being untracked, and the file is
// measured from the worktree and held to its cap like any other, since the whole
// point of writing the cap in the same changeset is that it binds the file it
// names. What the pending state suppresses is the stale-entry mirror for that one
// key and nothing else.
//
// Two things the control does not reach. A root nobody added to ROOTS: a path
// under no root is not this tool's subject at all, so a whole new curated
// directory ships unmeasured with the ratchet green, and only an edit to that list
// brings it in. And an untracked file a measured shape reaches that no cap names:
// it is in neither the measured set, which is tracked files, nor the pending set,
// which is budget keys, so `check` greens on it and only `report` names it. That is
// deliberate, because a cap for content nobody has committed is a figure with no
// subject, and failing on one would red the gate on another session's untracked
// file in a shared checkout.
//
// A root prefix differing from a listed root in case alone takes a second
// mechanism, because the first one cannot see it. rootHolds compares
// case-insensitively while the shapes stay case-sensitive, so a path spelled
// that way lands unclassified once the classifier sees it, and the classifier
// never sees it: the tracked-path listing filters with git pathspecs, whose
// matching is case-sensitive, so `ls-files -- test/` does not return
// `TEST/one.test.js`. What reaches it is the pathspec cross-check below, an
// unfiltered `git ls-files` filtered by the same case-folding root test: a path
// the unfiltered listing holds and the filtered one does not is a pathspec-blind
// failure. That reading is also the one that would catch a pathspec this file
// gets wrong in any other way, a root whose trailing slash or spelling stops
// matching what git records.
//
// Git runs through hooks/kit-git-lib.js, the shared runner, rather than through
// a spawn written here: it fixes the child's working directory away from the
// repository being asked about, strips every GIT_* variable from the child
// environment, and passes arguments as an array. Its output ceiling is
// MAX_OUTPUT_BYTES, one mebibyte, which the largest test file exceeds, so the
// `report` verb reads a HEAD blob only for a file git reports as changed and
// names any file whose HEAD blob comes back unreadable instead of leaving it
// out. An omitted file would read exactly like a file that did not change, and a
// git call that did not run at all is its own row state rather than a file
// reported as new, since a transient git failure would otherwise print a
// long-standing file's whole size as this section's growth.
//
// Worktree content runs through hooks/kit-read-lib.js, the shared bounded
// reader, for the same reason: the kind verdict comes off the open descriptor,
// so a FIFO at a measured path is refused instead of blocking the read forever,
// a byte ceiling bounds one file, and a partial read never becomes a size, since
// an undercount passes every cap. Containment is checked beside it, so a tracked
// symlink under a measured root pointing out of the checkout is not measured as
// if it were inside it.
//
// The budget read is the same channel and takes the same boundary: the caps
// decide every verdict this tool reaches, so a budget the reviewed checkout does
// not hold is a gate greening against caps that appeared in no diff. Containment
// is required of the default path, which is inside the repository under
// measurement; under the reading verbs a path named on --budget is an operator's
// own subject and is allowed to sit anywhere, since naming a budget elsewhere is
// a legitimate reading, while the two write verbs bind it to the repository, as
// their own comments say. Every path this tool prints, to stdout or to stderr, is rendered
// through the plan library's printable-ASCII screen first: a budget key and a
// tracked path are repository-supplied text, and the `report` output is quoted
// into plan-doc Chapters, where a newline inside a path would forge a row. One
// message is outside that channel by construction, the refusal printed when a
// library itself did not load, and it carries the printable-ASCII screen, the
// backtick strip and the leading-hash strip applied inline, since the library that
// owns them is the thing missing. The length cap is the one rule it cannot reuse.
// Every path printed after the repository is resolved takes two more screens at
// the write. The first spells it relative to the repository under measurement
// (repoRelativeText below); the second is the shared channel renderer, which
// takes the OS account name out of whatever the first left absolute, since the
// repository's own top level and a path outside it have no relative spelling
// that means anything and this output is read by a model.
//
// Node core modules only, CommonJS, zero dependencies, UTF-8 throughout.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The four shared libraries every hostile boundary here runs through: the git
// runner, the bounded file reader with its containment helper, the
// printable-ASCII screen, and the channel renderer this tool's every printed
// line goes out through. The require is guarded because a payload carrying
// scripts/ without hooks/ is a real state: an unguarded MODULE_NOT_FOUND at
// load exits 1, and 1 is the code this tool reserves for a ratchet failure, so
// a partial payload would read as a corpus over its caps. This tool cannot
// measure anything without them, so a library the require did not return is a
// run that could not produce
// a reading, which is exit 2, and the refusal carries the loader's own message so
// the module is named. The message is worded around what the loader said rather
// than around absence, because two states arrive here: a payload with no hooks
// directory at all, and a library that is present and would not load, a syntax
// error inside it being the ordinary case. Reported as an absent payload the
// second sends its reader looking for files that are sitting right there.
//
// `libs` is null in exactly that state. main refuses before any call site is
// reached, and mustHaveLibs below is the same refusal for the module surface,
// since the gate that consumes this file requires it and calls its exports
// directly: without that guard a hooks-less payload fails the gate with
// TypeErrors from a null dereference rather than with the reading it could not
// take.
let libs = null;
let libsDetail = null;
// Each require is named as it is issued, because a message is the whole point of
// this block and only one of the two loader failures names a module by itself: a
// MODULE_NOT_FOUND message spells the specifier, while a SyntaxError inside a
// library that is present says 'Unexpected end of input' and nothing more. The
// specifier is what the refusal carries, rather than the stack's own first line,
// which is an absolute payload path.
let loading = null;
// The channel's renderer, bound ahead of the block below and separately from
// it, because it is what the block's own refusal has to go out through: a
// loader's message names the module path it was refused on, which is
// home-anchored on an installed plugin, and this refusal reaches a model. Bound
// on its own it survives any of the four requires below failing, and the one
// state it cannot survive is its own library being the one that will not load,
// which is what the withheld leg in the catch is for. It is loaded a second time
// in the block below so that its absence is a run that could not take a reading
// like any other missing library, rather than a silent loss of the elision.
let scrubLine = null;
try {
    ({ scrub: scrubLine } = require('../hooks/kit-compact-lib.js'));
} catch {
    scrubLine = null;
}
try {
    loading = '../hooks/kit-git-lib.js';
    const git = require(loading);
    loading = '../hooks/kit-read-lib.js';
    const read = require(loading);
    loading = '../hooks/kit-plan-lib.js';
    const plan = require(loading);
    loading = '../hooks/kit-compact-lib.js';
    const channel = require(loading);
    libs = {
        gitOutput: git.gitOutput,
        gitRun: git.gitRun,
        readFileBounded: read.readFileBounded,
        containedRealPath: read.containedRealPath,
        safeForAuthorization: plan.safeForAuthorization,
        normalizePlanArg: plan.normalizePlanArg,
        scrub: channel.scrub
    };
} catch (err) {
    // The loader's own words say which of the two states this is, a module that
    // is present and will not parse or a payload that carries none, so they ride
    // in the refusal through the channel's renderer: a MODULE_NOT_FOUND message
    // carries a `Require stack:` naming the absolute path of this file, which is
    // home-anchored on an installed plugin and would otherwise put the OS account
    // name into a line a model reads. Where the renderer is itself what would not
    // load there is nothing to elide with, and the message is WITHHELD; the
    // error's code still rides there, an anchored upper-case identifier being
    // what a Node error code is and what can carry no path, and the specifier
    // this file named as it issued the require names the module either way.
    //
    // The three rules safePath applies, applied inline, because the library that
    // owns them is the thing that would not load: the printable-ASCII screen, the
    // backtick strip and the leading-hash strip. All three are the destination's
    // rules rather than a terminal's, and this refusal reaches the same
    // destination as every other line here, a fenced block inside a plan-doc
    // Chapter, where a loader message carrying a backtick closes the fence early.
    // What cannot be reused is the length cap, which lives with the screen.
    const code = err && typeof err.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(err.code)
        ? ' (' + err.code + ')' : '';
    const said = scrubLine === null
        ? '; the loader\'s message is withheld, since the renderer that takes the OS account name out of a path is the library that would not load'
        : ': ' + scrubLine(String((err && err.message) || err));
    libsDetail = ('the require of ' + loading + ', one of the hooks libraries this tool reads git, files and its own output through, did not return one' + code
        + ', so no reading can be taken' + said)
        .replace(/[^\x20-\x7E]/g, ' ').replace(/`/g, '').replace(/^#+/, '');
}

// The refusal every function that dereferences `libs` opens with. It throws
// rather than returning a status because these are the functions a caller reads
// a number out of, and a status in that position would have to be told apart
// from a reading by every one of them; the CLI's own catch turns it into the
// exit 2 main would have produced, and the gate sees an error naming the module
// instead of a TypeError.
function mustHaveLibs() {
    if (libs === null) throw new Error(libsDetail);
}

// Git reads here answer about a whole repository rather than about one file, so
// they take longer than a hook's question and get a wider bound than the shared
// runner's 4 s default.
const GIT_TIMEOUT_MS = 20000;

// Ceiling on one measured file. It sits well above the largest file in the
// corpus, whose test file is under two mebibytes, so it binds only on something
// nobody meant to measure; a file past it is reported unreadable rather than
// measured short.
const MAX_FILE_BYTES = 8 * 1024 * 1024;

// Ceiling on the budget file. One entry costs about eighty bytes, so this holds
// caps for something over ten thousand curated files, far past any corpus this
// tool measures; a budget past it is refused rather than parsed short, since a
// truncated budget parses as invalid JSON at best and as a shorter set of caps at
// worst.
const MAX_BUDGET_BYTES = 1024 * 1024;

// Ceiling on the changed paths the `report` verb reads a row for. Every changed
// row costs up to two git spawns, and this verb now runs on every section
// close over whatever that section touched, so the cost has to be bounded by
// something other than the operator's patience. It sits far above any changeset a
// section produces and binds only an audit-scale sweep; past it the remaining
// changed paths are counted and the reading says it was bounded.
const MAX_REPORT_ROWS = 200;

// The measured corpus, one entry per root. `root` is what decides whether a
// tracked path is this tool's subject at all, and `shapes` is what decides
// whether it is classified. A path under a root matching no shape is the
// coverage failure this file exists to catch, so the two are deliberately not
// the same pattern.
const ROOTS = [
    {
        root: 'plugins/grimoire/skills/',
        metric: 'words',
        shapes: [
            /^plugins\/grimoire\/skills\/[^/]+\/SKILL\.md$/,
            /^plugins\/grimoire\/skills\/[^/]+\/references\/[^/]+\.md$/
        ]
    },
    {
        root: 'plugins/grimoire/agents/',
        metric: 'words',
        shapes: [/^plugins\/grimoire\/agents\/[^/]+\.md$/]
    },
    {
        root: 'plugins/grimoire/output-styles/',
        metric: 'words',
        shapes: [/^plugins\/grimoire\/output-styles\/[^/]+\.md$/]
    },
    {
        // The root is the directory rather than the doctrine copy alone, because a
        // root naming one file is a root whose shape is the file: a sibling added
        // beside it would sit under no root, and the coverage control is inert for
        // a directory it does not hold. home/ carries the files that land in the
        // user's home directory, all of them curated prose,
        // so the shape is a markdown file directly under it and anything else
        // there reds.
        root: 'home/',
        metric: 'words',
        shapes: [/^home\/[^/]+\.md$/]
    },
    {
        // Ahead of test/ below because classify takes the first root that holds a
        // path, and test/probes/ sits under test/ on disk. The probe set is
        // curated prose, the frozen scenarios and rulings the cold-probe runner
        // reads, so it is measured in words like the other curated roots rather
        // than in lines like the test code beneath it.
        root: 'test/probes/',
        metric: 'words',
        shapes: [/^test\/probes\/[^/]+\.md$/]
    },
    {
        root: 'test/',
        metric: 'lines',
        shapes: [/^test\/[^/]+\.test\.js$/]
    }
];

// Tracked files under a root that are not measured content. Every entry is a
// hole in the coverage control, so the list holds exactly the files that exist
// and carries no speculative entry: the budget itself is data about the
// corpus rather than a member of it.
const EXCLUSIONS = ['test/size-budget.json'];

// Where the caps live, relative to the repository root. The budget sits beside
// the test that reads it rather than beside this script, because it is the
// gate's data and a reviewer reads it with the test.
const BUDGET_PATH = 'test/size-budget.json';

// The corpus-wide cap's key in the budget. It names no file, so it is never a
// row this tool measures and never a per-file cap in the totals; it is a second
// number the same budget carries, over the sum of a different set of rows. The
// key is not a legal tracked path (no root holds a bare name with no slash), so
// nothing here mistakes it for a stale entry by accident; the exemption below is
// what makes that true on purpose.
const CORPUS_CAP_KEY = 'corpus-cap';

// A rationale ledger, the one prose class the corpus cap excludes by name. The
// corpus itself is every other budget key that answers to neither this shape nor
// a path under test/, read straight from the budget rather than from a count
// carried here, so a document a later section adds to a measured root joins the
// corpus the moment its cap does.
const RATIONALE_LEDGER = /\/references\/rationale-ledger\.md$/;

function isCorpusPath(relPath) {
    return relPath !== CORPUS_CAP_KEY && !relPath.startsWith('test/') && !RATIONALE_LEDGER.test(relPath);
}

// Why a file fails the ratchet. Each reason is distinct because a gate that can
// only say "something failed" cannot tell an over-cap file from a file the
// classifier never reached, and those two want opposite responses: one is a
// budget edit, the other is a classifier that has gone blind.
const REASONS = {
    OVER_CAP: 'over-cap',
    CORPUS_OVER_CAP: 'corpus-over-cap',
    MISSING_ENTRY: 'missing-entry',
    UNCLASSIFIED: 'unclassified',
    STALE_ENTRY: 'stale-entry',
    INVALID_CAP: 'invalid-cap',
    UNREADABLE: 'unreadable',
    PATHSPEC_BLIND: 'pathspec-blind'
};

// The corpus's current word sum, read from worktree content through
// `measuredByPath` (a path to its measured entry, from `collected.measured` or
// `pendingMeasured`) rather than from any cap: the reading this cap gates is the
// same worktree size every other row here is held to. A corpus path with no
// entry in the map (unreadable, or not yet measured) contributes nothing, since
// evaluate's own failures already say why that path carries no size.
//
// `extraKeys` widens the set summed past the budget's own keys, to a path
// named in the same sync as `corpus-cap` that the budget does not carry yet:
// without it, a new corpus file's first cap and the corpus cap moved beside it
// in one command would sum over the budget as it stood before either write,
// leaving the new file's words out of the very sum meant to cover it.
function corpusSum(budget, measuredByPath, extraKeys) {
    let sum = 0;
    const seen = new Set();
    for (const key of Object.keys(budget)) {
        if (!isCorpusPath(key)) continue;
        seen.add(key);
        const m = measuredByPath.get(key);
        if (m && m.size !== null) sum += m.size;
    }
    if (extraKeys) {
        for (const key of extraKeys) {
            if (seen.has(key) || !isCorpusPath(key)) continue;
            const m = measuredByPath.get(key);
            if (m && m.size !== null) sum += m.size;
        }
    }
    return sum;
}

// The corpus cap's own failure, or null where the budget carries no such key or
// the sum sits at or under it. It is read exactly like a per-file cap failure
// (a reason, a size, a cap, a detail naming both and their difference), on its
// own reason so a caller telling reasons apart never mistakes it for one.
function corpusCapFailure(budget, measuredByPath) {
    if (!Object.prototype.hasOwnProperty.call(budget, CORPUS_CAP_KEY)) return null;
    const cap = budget[CORPUS_CAP_KEY];
    if (typeof cap !== 'number' || !Number.isFinite(cap)) {
        return { path: CORPUS_CAP_KEY, reason: REASONS.INVALID_CAP, detail: 'the cap is not a finite number' };
    }
    const sum = corpusSum(budget, measuredByPath);
    if (sum <= cap) return null;
    return {
        path: CORPUS_CAP_KEY,
        reason: REASONS.CORPUS_OVER_CAP,
        size: sum,
        cap,
        detail: sum + ' words against a cap of ' + cap + ', ' + (sum - cap) + ' over; a raise is an operator ruling, per the corpus cap item in docs/backlog.md'
    };
}

// Any repository-supplied text on its way to stdout or stderr: a tracked path, a
// budget key, a directory this tool was pointed at. The screen is the plan
// library's, so the kit has one printable-ASCII rule rather than two, and what it
// buys here is that a path holding a newline cannot forge a second result row in
// output a Chapter quotes.
//
// The screen is a sentence screen rather than a path encoder, so it is lossy on
// a path: it drops every byte outside printable ASCII and cuts at 320
// characters, which can render two distinct paths identically. That is the
// accepted cost, because the screen's purpose is output safety and never path
// identity. Nothing here compares or keys on a screened value: every lookup, set
// membership and budget key uses the raw path git printed, and safePath is
// applied at the write to stdout or stderr and nowhere else.
//
// Two more characters go, both for the destination rather than for the terminal.
// The `report` output is pasted into a fenced block in a plan-doc Chapter, so a
// backtick run in a path closes that fence early and drops the rest of the row
// into the document as prose. And a leading hash run reaches the status line's
// plan parser, which walks a plan doc line by line and keys on two line-opening
// shapes: a line opening with `##` followed by whitespace ends the Chapters block
// it is reading, dropping every Chapter below that point from the section count,
// and a line matching `### Chapter <n>` opens a chapter of its own. Dropping the
// run covers both. Both characters go rather than being escaped, on the same
// lossiness the paragraph above accepts.
function safePath(value) {
    mustHaveLibs();
    return libs.safeForAuthorization(value).replace(/`/g, '').replace(/^#+/, '');
}

// A path spelled relative to the repository under measurement where it resolves
// inside it, and left as it stands where it does not. Every path this tool prints
// takes this, because the printed output is quoted into a tracked plan doc: an
// absolute checkout path embeds the operator's user name on the default layout,
// which docs/security-model.md puts on the placeholder side of its
// accepted-disclosure boundary. A path outside the repository, a budget an
// operator named elsewhere being the reachable one, has no relative spelling that
// means anything, so it stays as it was given and the sentence around it is still
// true about the file it read. The repository's own top level is that case too: it
// is the reading's subject rather than a path inside it, and main prints it as
// such.
//
// The refusal is spelled as the sibling containment rule in hooks/kit-read-lib.js
// spells it rather than as a bare two-dot prefix, because a path whose first
// segment merely opens with two dots ('..hidden/x.md') resolves inside the
// repository and has an honest relative spelling.
function repoRelative(repoDir, target) {
    if (!repoDir || !target) return target;
    const rel = path.relative(repoDir, target);
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return target;
    return rel.split(path.sep).join('/');
}

// One printed line with every path inside the repository under measurement
// respelled relative to it. This is the boundary the screen belongs at: the
// sentences main writes are assembled all over this file, in every loadBudget
// refusal, in every git-failure detail and in every row, and a screen bound to one
// of them protects that one while its siblings on the same channel carry the
// operator's user name into a plan doc. main runs everything it writes through
// here, so the property holds for a sentence nobody thought about.
//
// Both spellings of the root are matched because both are printed: git reports
// forward slashes while path.resolve reports the platform separator, and one
// sentence can hold each. The run taken with the prefix ends at whitespace and at
// the quoting characters an error sentence puts around a path, which is what keeps
// the prose after a path out of the respelling; a repository path holding a space
// keeps the remainder past that space as it stands, since the operator's user name
// sits in the prefix that goes rather than in the tail that stays.
//
// Nothing here compares or keys on the result: this runs at the write, on text
// every path in which has already been through safePath, and repoRelative decides
// each match.
function repoRelativeText(repoDir, text) {
    if (!repoDir || typeof text !== 'string' || text === '') return text;
    const forms = Array.from(new Set([repoDir, repoDir.split(path.sep).join('/')]));
    let out = text;
    for (const form of forms) {
        const re = new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\s\'",;]*', 'g');
        out = out.replace(re, (match) => repoRelative(repoDir, match));
    }
    return out;
}

// The repository this tool measures when no --repo is given: the checkout this
// file sits in, three levels up from plugins/grimoire/scripts.
function defaultRepoDir() {
    return path.resolve(__dirname, '..', '..', '..');
}

// A root holds a path when the path sits anywhere beneath it. Every measured
// root is a directory root, and its trailing slash is what makes the prefix test
// exact rather than a name-prefix match; a root spelled as a single file would
// hold nothing here and its file would leave the classified set, which the
// coverage diff reds on. The comparison folds case so a path spelled with a
// differently-cased root prefix is still this tool's subject: the shapes below
// stay case-sensitive, so such a path lands unclassified and reds instead of
// being skipped as though it sat under no root at all.
function rootHolds(root, relPath) {
    return relPath.toLowerCase().startsWith(root.toLowerCase());
}

// Split a tracked path list into what is measured, what is excluded by name,
// and what sits under a root with no shape to measure it by. The path list is a
// parameter rather than a git call so a caller can drive the classifier with a
// list git would never produce, which is how the coverage control is tested at
// all: a real unclassified file cannot be planted in a shared checkout.
function classify(relPaths) {
    const entries = [];
    const unclassified = [];
    const excluded = [];
    for (const relPath of relPaths) {
        const spec = ROOTS.find((r) => rootHolds(r.root, relPath));
        if (!spec) continue;
        if (EXCLUSIONS.includes(relPath)) {
            excluded.push(relPath);
            continue;
        }
        if (spec.shapes.some((s) => s.test(relPath))) entries.push({ path: relPath, metric: spec.metric });
        else unclassified.push(relPath);
    }
    return { entries, unclassified, excluded };
}

// The body of a markdown file with its YAML frontmatter removed. An opening
// fence must be the file's first line, which is where the format puts it, so a
// `---` used as a horizontal rule further down closes nothing. The block also
// has to open like YAML: its FIRST line is a `key:` line or the block is not
// frontmatter. A file opening with a horizontal rule and carrying a second one
// later would otherwise lose everything between them, and on a size gate a silent
// under-count is the dangerous direction. The test is on the first line rather
// than on any line in the block, because ordinary prose satisfies "any line"
// (a paragraph holding one `Note:` is enough) while the format puts a mapping key
// at the top of a frontmatter block and nowhere else. It is on the first line
// rather than on every line because YAML admits list items and folded values
// below the first key, which are frontmatter this tool must still strip.
//
// The block's close is the first line under the opener that starts with three
// hyphens, and it counts as a close only when it is exactly `---`: no line
// between the two may start with three hyphens at all. That closes the mirror of
// the shape above. A key-shaped block whose close is mangled (a fourth hyphen, a
// stray character) has no close in the format's terms, and a scan that skipped
// past it to the next bare horizontal rule would take every word between them out
// of the reading, which is the same silent under-count from the other direction.
// Refusing the whole match instead leaves the file measured whole, and an
// over-count fails a cap loudly rather than passing one quietly.
const FRONTMATTER = /^---\r?\n((?:(?!---)[^\r\n]*\r?\n)*)---[ \t]*(?:\r?\n|$)/;

function stripFrontmatter(text) {
    if (!/^---\r?\n/.test(text)) return text;
    const m = FRONTMATTER.exec(text);
    if (!m) return text;
    if (!/^[ \t]*[^\s:#]+[ \t]*:/.test(m[1])) return text;
    return text.slice(m[0].length);
}

function wordCount(text) {
    const body = stripFrontmatter(text).trim();
    return body === '' ? 0 : body.split(/\s+/).length;
}

// Lines the way a line-counting tool reads them: one per newline, plus a final
// unterminated line where the file has one.
function lineCount(text) {
    if (text === '') return 0;
    const newlines = (text.match(/\n/g) || []).length;
    return text.endsWith('\n') ? newlines : newlines + 1;
}

// Test call sites: a `test(` or `it(` opening a line after nothing but spaces
// and tabs, so a nested case inside a describe block counts and a call in the
// middle of an expression does not. The leading class is spaces and tabs rather
// than \s, which in multiline mode spans newlines and would let one match
// swallow the blank lines above it.
function testCount(text) {
    const m = text.match(/^[ \t]*(?:test|it)\(/gm);
    return m ? m.length : 0;
}

// The size of one classified entry, given its content: the metric's number,
// plus a test count for the line-measured corpus. Content of null is a file git
// tracks whose bytes the bounded reader would not hand over (absent from the
// worktree, not a regular file, past the read ceiling, or resolving outside the
// repository), which is reported as unreadable rather than collapsed into a zero
// that would read as a file that shrank.
function measure(entry, content) {
    if (content === null) return { path: entry.path, metric: entry.metric, size: null, tests: null };
    if (entry.metric === 'words') {
        return { path: entry.path, metric: 'words', size: wordCount(content), tests: null };
    }
    return { path: entry.path, metric: 'lines', size: lineCount(content), tests: testCount(content) };
}

// Every failure the ratchet has, over an already-measured corpus. Sizes and the
// budget are parameters so the caller decides where both came from: the gate
// hands it the real tree, a test hands it a fixture, and neither path is a
// special case of the other.
//
// Every parameter past the budget degrades where a caller omits it, `unclassified`
// with the rest: a caller holding no classifier reading passes nothing and gets
// the cap failures it can have rather than a throw from an iteration over
// undefined.
//
// `pending` names the budget keys git reports as untracked and present under a
// measured root, which the caller resolves because this function neither reads
// disk nor runs git. A cap written beside a file not yet added is the intended
// way to add a file: the budget edit and the file ride in one changeset. So a
// pending key is not a stale entry, while a cap no measured file and no untracked
// file answers to is the stale entry a deleted file leaves behind.
//
// A pending cap still binds its file. `options.pendingMeasured` carries those
// files measured from the worktree, and every cap failure below runs over them
// exactly as over a tracked file: the untracked state is why the stale-entry
// mirror is suppressed for the key, and it is no reason to leave the file's size
// uncompared, since a cap written in the same changeset as the file is a cap
// meant to hold that file. Left uncompared, a section's newest file, which is
// untracked at exactly the moment its Chapter's reading is taken, could exceed
// its own cap by any amount at exit 0.
//
// `options.budgetPath` is the resolved budget file, named in the missing-entry
// sentence so a reader is sent to the file the caller actually read rather than to
// the default path. Absent, the sentence names no path at all. It is spelled
// relative to `options.repoDir` where it resolves inside that repository, since
// this sentence is quoted into a tracked plan doc and an absolute checkout path
// carries the operator's user name into it; repoRelative states that in full.
//
// `differsFromHead` is the set of paths git reports as differing from HEAD, and
// it makes an over-cap failure legible: the size came from worktree content, so a
// red can belong to an uncommitted edit rather than to anything committed, and
// the failure says which. Absent, the failure says no HEAD comparison was taken
// rather than implying one.
//
// That comparison is a field on the failure as well as a clause in its sentence,
// one of four values: 'differs', 'matches', 'not-taken', or 'untracked' for a
// pending file, which no HEAD diff lists and which 'matches' would otherwise
// claim agrees with a blob HEAD does not hold. The field is what a caller reads,
// the sentence what a person reads, and the field is there so the sentence stays
// free to improve without a caller pinning its words.
function evaluate(measured, budget, unclassified, pending, differsFromHead, options) {
    const failures = [];
    const opts = options || {};
    const pendingPaths = new Set(pending || []);
    const measuredPaths = new Set(measured.map((m) => m.path));
    const budgetLabel = opts.budgetPath
        ? 'no cap in ' + safePath(repoRelative(opts.repoDir, opts.budgetPath))
        : 'no cap in the size budget';
    const headComparison = (relPath) => {
        if (!differsFromHead) return 'not-taken';
        return differsFromHead.has(relPath) ? 'differs' : 'matches';
    };
    const headNote = (comparison) => {
        if (comparison === 'not-taken') return ', with no HEAD comparison in this reading';
        if (comparison === 'untracked') return ', and git reports this path as untracked, so HEAD holds no blob for it';
        return comparison === 'differs'
            ? ', and this path currently differs from HEAD'
            : ', and this path currently matches HEAD';
    };
    // Tracked files and the files behind pending caps take the same cap
    // comparison. What separates them is one sentence: a tracked file the reader
    // would not hand over is unreadable, while a pending one git listed as present
    // and the reader would not hand over is the same fault about an untracked
    // file, and neither may become a size.
    const rows = measured.concat(opts.pendingMeasured || []);
    const pendingRow = new Set((opts.pendingMeasured || []).map((m) => m.path));
    for (const m of rows) {
        if (m.size === null) {
            failures.push({
                path: m.path,
                reason: REASONS.UNREADABLE,
                detail: pendingRow.has(m.path)
                    ? 'git reports this file as untracked and present, and the bounded reader could not produce its content'
                    : 'git tracks this file and the bounded reader could not produce its content'
            });
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(budget, m.path)) {
            failures.push({ path: m.path, reason: REASONS.MISSING_ENTRY, size: m.size, detail: budgetLabel + ', so adding this file is a budget edit' });
            continue;
        }
        const cap = budget[m.path];
        if (typeof cap !== 'number' || !Number.isFinite(cap)) {
            failures.push({ path: m.path, reason: REASONS.INVALID_CAP, detail: 'the cap is not a finite number' });
            continue;
        }
        if (m.size > cap) {
            const comparison = pendingRow.has(m.path) ? 'untracked' : headComparison(m.path);
            failures.push({
                path: m.path,
                reason: REASONS.OVER_CAP,
                size: m.size,
                cap,
                headComparison: comparison,
                detail: m.size + ' ' + m.metric + ' against a cap of ' + cap
                    + ', read from worktree content' + headNote(comparison)
            });
        }
    }
    for (const relPath of unclassified || []) {
        failures.push({ path: relPath, reason: REASONS.UNCLASSIFIED, detail: 'tracked under a measured root and matched by no shape, so nothing measures it' });
    }
    for (const relPath of Object.keys(budget)) {
        // The corpus cap names no file, so it is never a stale entry; check()
        // evaluates it on its own reason, over its own sum.
        if (relPath === CORPUS_CAP_KEY) continue;
        if (!measuredPaths.has(relPath) && !pendingPaths.has(relPath)) {
            failures.push({ path: relPath, reason: REASONS.STALE_ENTRY, detail: 'a cap for a file the classifier no longer reaches and git does not report as untracked under a measured root' });
        }
    }
    return failures;
}

// The top-level keys the budget text spells, in the order it spells them,
// duplicates included. JSON.parse collapses a repeated key to its last value
// silently, and the ratchet's whole change-management story is that a raised cap
// rides in the diff for a reviewer to see: a second entry for a path already
// listed defeats a reviewer reading the file while the file still parses and the
// gate still greens. So the keys are read from the text.
//
// The scan holds because the budget is a flat object of path to number: every
// string literal in it that is followed by a colon is a key, since no value is a
// string. A budget shaped otherwise is refused by loadBudget's own object check
// or reds per entry as an invalid cap.
function budgetKeysInText(raw) {
    const keys = [];
    const re = /"((?:[^"\\]|\\.)*)"[ \t\r\n]*:/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        try {
            keys.push(JSON.parse('"' + m[1] + '"'));
        } catch {
            keys.push(m[1]);
        }
    }
    return keys;
}

// The caps. Absence throws rather than degrading to an empty budget: with no
// caps at all every measured file reds on its own missing entry, which names a
// hundred files where the one fault is the budget, and a reading that could not
// be taken is what the tool's exit 2 is for. A budget that parses to no caps
// takes that same refusal below, since the state it produces is the same one.
//
// Absence is decided before containment, and each says its own thing: no budget
// at the path is a missing file, while a budget that does not resolve inside the
// checkout is a file whose caps are somebody else's. Ordered the other way, the
// commonest state (a project with no budget yet) would report as a containment
// failure and send its reader looking for a symlink nobody planted.
//
// The read is the same repository-supplied-file channel the worktree read uses,
// so it takes the same boundary: the descriptor-settled kind check, which refuses
// a FIFO at the path instead of blocking on it forever, and a byte ceiling. Where
// `containRoot` is given, the path must also resolve inside it, which is what the
// default path takes: a symlink there would otherwise source every cap in the
// gate from a file outside the reviewed checkout. A path an operator named on
// --budget is passed no root and may sit anywhere.
function loadBudget(budgetFile, containRoot) {
    mustHaveLibs();
    if (!fs.existsSync(budgetFile)) {
        throw new Error('no size budget exists at ' + safePath(budgetFile));
    }
    // The read is issued on the value containment resolved rather than on the raw
    // path, so the bytes measured are the bytes checked. Checking one path and
    // reading another leaves a window in which a link planted between the two
    // sources every cap in the gate from outside the checkout, which is exactly
    // what the check exists to stop. readWorktree reads the resolved path for the
    // same reason.
    let target = budgetFile;
    if (containRoot) {
        const real = libs.containedRealPath(containRoot, budgetFile);
        if (real === null) {
            throw new Error('the size budget at ' + safePath(budgetFile)
                + ' does not resolve inside ' + safePath(containRoot)
                + ', so its caps are not the reviewed checkout\'s');
        }
        target = real;
    }
    const res = libs.readFileBounded(target, MAX_BUDGET_BYTES);
    if (res === null) {
        throw new Error('the size budget is unreadable at ' + safePath(budgetFile));
    }
    // Two bounds stop a read short and they want different fixes, so the sentence
    // says which one fired: the byte ceiling is a budget bigger than this tool
    // reads, while a short fill is a read that ended before the file did, and a
    // reader sent after a file size for the second one is sent after the wrong
    // thing.
    if (res.bounded) {
        throw new Error(res.boundedBy === 'ceiling'
            ? 'the size budget at ' + safePath(budgetFile) + ' is past the '
                + MAX_BUDGET_BYTES + '-byte ceiling, so its caps would be read short'
            : 'the size budget at ' + safePath(budgetFile) + ' read short of its end at '
                + res.bytesRead + ' bytes, so its caps would be read short');
    }
    let parsed;
    try {
        parsed = JSON.parse(res.text);
    } catch {
        throw new Error('the size budget at ' + safePath(budgetFile) + ' is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('the size budget at ' + safePath(budgetFile) + ' is not an object of path to cap');
    }
    // A budget that parses to no caps at all takes the same refusal absence
    // takes, and for the same reason: with no cap over any file every measured
    // file reds on its own missing entry, which names a hundred files where the
    // one fault is the data. Reached without this it is exit 1, the code reserved
    // for a ratchet failure, on a reading that tested nothing.
    if (Object.keys(parsed).length === 0) {
        throw new Error('the size budget at ' + safePath(budgetFile)
            + ' holds no cap at all, so every measured file would red on its own missing entry where the one fault is the budget');
    }
    const seen = new Set();
    const repeated = [];
    for (const key of budgetKeysInText(res.text)) {
        if (seen.has(key)) repeated.push(key);
        else seen.add(key);
    }
    if (repeated.length > 0) {
        throw new Error('the size budget at ' + safePath(budgetFile)
            + ' lists a path more than once, so a reviewer reading the file sees a cap the gate does not use: '
            + repeated.map(safePath).join(', '));
    }
    return parsed;
}

// The tracked paths under every root, or null when git could not answer. NUL
// separation keeps git from quoting a path with an unusual character, which
// would otherwise arrive as a name no file has. repoDir is the repository's top
// level, since git resolves both these relative pathspecs and its own output
// paths against the directory it was pointed at.
// The list is deduplicated because `git ls-files` prints a conflicted path once
// per stage: an unresolved merge would otherwise measure one file two or three
// times, double its lines into the totals, and emit a duplicate failure for it,
// and a merge is exactly when a whole-gate reading gets taken.
function trackedPaths(repoDir) {
    mustHaveLibs();
    const out = libs.gitOutput(repoDir, ['ls-files', '-z', '--'].concat(ROOTS.map((r) => r.root)), { timeoutMs: GIT_TIMEOUT_MS });
    if (out === null) return null;
    return Array.from(new Set(out.split('\0').filter((s) => s !== '')));
}

// Every tracked path in the repository, with no pathspec at all, or null when git
// could not answer. This is the reading the pathspec cross-check needs: git's
// pathspec matching is case-sensitive, so a path recorded under a differently
// cased root prefix is absent from trackedPaths above and the classifier never
// sees it. Deduplicated for the same merge-stage reason.
//
// This listing is the whole tracked tree rather than the measured roots, so it is
// the largest output any call here asks git for, and it rides the shared runner's
// MAX_OUTPUT_BYTES ceiling of one mebibyte like every other call. A tree whose
// tracked path list passes that ceiling reads as a git failure rather than as a
// short list, which is the safe direction: the cross-check refuses to run rather
// than reporting a blind set it read half of. The ceiling is not settable through
// the runner's exported API, and docs/backlog.md carries that limitation as the
// runner's own contract to fix.
function allTrackedPaths(repoDir) {
    mustHaveLibs();
    const out = libs.gitOutput(repoDir, ['ls-files', '-z'], { timeoutMs: GIT_TIMEOUT_MS });
    if (out === null) return null;
    return Array.from(new Set(out.split('\0').filter((s) => s !== '')));
}

// The repository top level git reports for a directory, or null when git could
// not answer at all, which covers a directory that is no repository. This is what
// settles whether a --repo names the level every relative pathspec and every
// output path here is resolved against.
function repoTopLevel(repoDir) {
    mustHaveLibs();
    const out = libs.gitOutput(repoDir, ['rev-parse', '--show-toplevel'], { timeoutMs: GIT_TIMEOUT_MS });
    if (out === null) return null;
    const top = out.split(/\r?\n/)[0].trim();
    return top === '' ? null : top;
}

// Whether two path strings name one directory. Real paths where the filesystem
// will resolve them, since a link or a short name spells one directory two ways,
// separators normalized because git prints forward slashes on win32 while
// path.resolve prints backslashes, and case folded on win32, where two casings are
// one directory.
function samePath(a, b) {
    const norm = (p) => {
        let resolved;
        try {
            resolved = fs.realpathSync(p);
        } catch {
            resolved = p;
        }
        const abs = path.resolve(resolved).replace(/[\\/]+$/, '');
        return process.platform === 'win32' ? abs.toLowerCase() : abs;
    };
    return norm(a) === norm(b);
}

// The tracked paths a root holds by rootHolds' case-folding test that the
// pathspec-filtered listing did not return. Every one of them is a file this tool
// claims as its subject and never measured, which is the coverage failure in its
// most invisible form: nothing in the filtered reading says the path exists.
function pathspecBlind(filtered, all) {
    const seen = new Set(filtered);
    return all.filter((p) => !seen.has(p) && ROOTS.some((r) => rootHolds(r.root, p)));
}

// The paths under every root that git reports as untracked and not ignored, or
// null when git could not answer. This is what a pending cap has to be backed
// by: git's own view of an untracked file, rather than anything the filesystem
// happens to answer to a name out of the budget.
function untrackedPaths(repoDir) {
    mustHaveLibs();
    const out = libs.gitOutput(repoDir, ['ls-files', '-z', '--others', '--exclude-standard', '--'].concat(ROOTS.map((r) => r.root)), { timeoutMs: GIT_TIMEOUT_MS });
    if (out === null) return null;
    return Array.from(new Set(out.split('\0').filter((s) => s !== '')));
}

// One file's worktree content, through the shared bounded reader, or null when
// this tool must not turn what is there into a size. Containment comes first
// because the reader follows a symlink by design, and a tracked link under a
// measured root pointing out of the checkout would otherwise be measured as
// though it sat inside it. A bounded result is refused as well: a truncated read
// is an under-count, and an under-count passes every cap.
function readWorktree(repoDir, relPath) {
    mustHaveLibs();
    const full = path.join(repoDir, relPath);
    const real = libs.containedRealPath(repoDir, full);
    if (real === null) return null;
    const res = libs.readFileBounded(real, MAX_FILE_BYTES);
    if (res === null || res.bounded) return null;
    return res.text;
}

// The whole reading for a repository: classify its tracked files, then measure
// each from the worktree. A git failure is its own status rather than an empty
// corpus, since an empty corpus is a green ratchet.
//
// `blind` carries the pathspec cross-check's result, so both listings are taken
// in the one place that already asks git for a file list and every caller reads
// the same corpus.
function collect(repoDir) {
    const relPaths = trackedPaths(repoDir);
    if (relPaths === null) return { status: 'git-failed', detail: 'git ls-files returned nothing usable for ' + safePath(repoDir) };
    const allPaths = allTrackedPaths(repoDir);
    if (allPaths === null) return { status: 'git-failed', detail: 'git ls-files with no pathspec returned nothing usable for ' + safePath(repoDir) };
    const { entries, unclassified, excluded } = classify(relPaths);
    const measured = entries.map((e) => measure(e, readWorktree(repoDir, e.path)));
    return { status: 'ok', measured, unclassified, excluded, blind: pathspecBlind(relPaths, allPaths) };
}

// Sums per metric class, each against the sum of its caps, plus the corpus-wide
// test count. A file with no cap contributes nothing to the cap total, which is
// honest rather than convenient: the missing entry is already a failure.
//
// `unreadable` counts the files in each class whose content this tool would not
// turn into a size. Their caps still stand in the cap total, so the sum they
// leave out reads as a cut of exactly their caps unless the count travels beside
// it, which is why the renderer marks the totals line whenever it is non-zero.
function totals(measured, budget) {
    const out = {
        words: { size: 0, cap: 0, files: 0, unreadable: 0 },
        lines: { size: 0, cap: 0, files: 0, unreadable: 0 },
        tests: 0
    };
    for (const m of measured) {
        const bucket = m.metric === 'words' ? out.words : out.lines;
        bucket.files += 1;
        if (m.size !== null) bucket.size += m.size;
        else bucket.unreadable += 1;
        const cap = budget[m.path];
        if (typeof cap === 'number' && Number.isFinite(cap)) bucket.cap += cap;
        if (m.tests !== null) out.tests += m.tests;
    }
    return out;
}

// Budget keys with no measured file behind them that git nonetheless reports as
// untracked under a measured root, and that the classifier would measure once
// added: a cap written in the changeset that adds the file, before the add.
//
// Both halves are load-bearing, because a pending key is suppressed from the
// stale-entry mirror: the mirror is the only thing that would otherwise red on a
// key naming nothing the classifier reaches. The file itself is measured and held
// to its cap, so what a wrong pending verdict costs is the mirror rather than the
// cap comparison. Git's own untracked list is what makes the key a real file: a
// key naming a directory, a
// key reaching out of the repository with `..`, and a key spelled with
// backslashes all satisfy a bare existence test on some platform while matching
// no path git ever prints, and each would then sit unmeasured and unreported
// forever. The classifier is what makes it a measurable file: an untracked path
// under a root that no shape reaches would be an unclassified failure once
// tracked, so a cap for it is stale now rather than pending.
function pendingEntries(budget, measured, untracked) {
    const measuredPaths = new Set(measured.map((m) => m.path));
    const untrackedPresent = new Set(untracked || []);
    return Object.keys(budget).filter((p) => !measuredPaths.has(p)
        && untrackedPresent.has(p)
        && classify([p]).entries.length === 1);
}

// A pending key's own worktree measurement, read the same way check() has
// always read it: classified alone and read from disk, since a pending file
// carries no entry in `collected.measured` for collect() to have found.
function pendingMeasuredFrom(repoDir, pending) {
    return pending.map((p) => measure(classify([p]).entries[0], readWorktree(repoDir, p)));
}

// The one path-to-measurement lookup every reader of a per-file or corpus cap
// takes: tracked content plus a pending file's worktree reading, so a capped
// file that is untracked and pending is in the set check() holds it to and in
// the set report()'s corpus line sums, rather than one reading the file and
// the other silently treating it as absent.
function measuredByPathWithPending(measured, pendingMeasured) {
    return new Map(measured.concat(pendingMeasured).filter((m) => m.size !== null).map((m) => [m.path, m]));
}

// The refusal a reading with no corpus takes, or null where there is one. Two
// faults produce an empty measured set and each gets its own reason, the blind one
// first: a tree whose root-held paths were all absent from the pathspec-filtered
// listing is a corpus hidden from the classifier rather than a tree with nothing
// in it, and reported as empty it sends its reader looking for files that are
// sitting in the index. The empty refusal states the blind count too, at zero, so
// a reader tells an empty tree from a hidden one off one line. `tail` is the
// calling verb's own clause, since a gate that tested no cap and a report with
// nothing to print are different statements about the same corpus.
//
// `untrackedMeasured` is the untracked, non-ignored paths a measured shape
// reaches, and it counts toward the corpus: a project whose measured files are
// all untracked, a first commit not yet made or the first file under a newly
// added root, has a corpus this tool reads. `report` would name every one of
// those files and a cap beside one of them would be compared, so refused as an
// empty corpus the reading claims an emptiness the tree does not have. Where a
// caller measures tracked files alone, `init` being the one, it passes nothing
// and the refusal is about the tracked corpus it is going to write caps from.
function unmeasuredRefusal(collected, tail, untrackedMeasured) {
    if (collected.measured.length > 0) return null;
    const blind = collected.blind || [];
    if (blind.length > 0) {
        // The named list takes the same bound every rendered list takes, and for the
        // same reason: nothing bounds how many paths a hidden corpus holds, and a list
        // cut short and left silent reads as the whole list. The count above is the
        // whole count either way, so the reading never understates the fault itself.
        const named = boundList(blind);
        return {
            status: 'unmeasured',
            detail: 'measured no file at all under the measured roots, and ' + blind.length + ' tracked '
                + (blind.length === 1 ? 'path a root holds was' : 'paths a root holds were')
                + ' absent from the pathspec-filtered listing, so the corpus is hidden from the classifier rather than empty: '
                + named.shown.map(safePath).join(', ')
                + (named.omitted ? '; ' + boundNotice('pathspec-blind path', named.omitted) : '')
        };
    }
    if ((untrackedMeasured || []).length > 0) return null;
    return {
        status: 'unmeasured',
        detail: 'measured no file at all under the measured roots, no tracked path a root holds was absent from the pathspec-filtered listing, and no untracked file a measured shape reaches was found either, so the corpus is empty rather than hidden and ' + tail
    };
}

// The untracked, non-ignored paths a measured shape reaches, out of git's own
// untracked listing. This is what the corpus refusal counts beside the tracked
// corpus and what the report measures beside its totals, so the two readings
// agree about which untracked paths are this tool's subject.
function untrackedMeasuredPaths(untracked) {
    return (untracked || []).filter((p) => classify([p]).entries.length === 1);
}

// The full ratchet reading for a repository, which the gate consumes and the
// `check` verb prints.
//
// Two readings are a failure to measure rather than a clean result: a corpus with
// nothing in it (an empty `git ls-files` answer is a status of ok, not a git
// failure), which the refusal above parts from a hidden one, and a reading whose
// pending set covers every key in the budget, which suppresses the stale-entry
// mirror over the whole budget, so no cap left behind by a deletion could red and
// the refusal returns before any cap is compared. A gate whose job is to hold
// growth has to say so rather than exit clean, so each names itself.
//
// The pathspec cross-check's findings are failures here beside the rest, on their
// own reason, because a path the filtered listing never returned wants a different
// response from a path the classifier reached and could not place: one says a
// pathspec has gone blind, the other says a shape is missing.
//
// A pending cap's file is measured here and evaluated with the tracked corpus, so
// a file riding in one changeset with its own cap is held to it: the untracked
// state suppresses the stale-entry mirror for the key and nothing more. The
// classifier lookup is safe because pendingEntries admits a key only where exactly
// one entry classifies it.
function check(repoDir, budgetFile, containRoot) {
    const collected = collect(repoDir);
    if (collected.status !== 'ok') return collected;
    // The untracked listing is read before the corpus refusal rather than after,
    // because the refusal counts the untracked measured files: a tree whose only
    // measured files are untracked has a corpus, and a cap beside one of them is
    // compared like any other.
    const untracked = untrackedPaths(repoDir);
    if (untracked === null) return { status: 'git-failed', detail: 'git ls-files --others returned nothing usable for ' + safePath(repoDir) };
    const refusal = unmeasuredRefusal(collected, 'no cap was tested', untrackedMeasuredPaths(untracked));
    if (refusal !== null) return refusal;
    const budget = loadBudget(budgetFile, containRoot);
    const pending = pendingEntries(budget, collected.measured, untracked);
    const budgetKeys = Object.keys(budget);
    // Every cap pending is a refusal, and it returns here, before the pending
    // files are measured below: the stale-entry mirror is wholly suppressed over
    // the whole budget, so no cap left behind by a deletion could red, and this
    // reading compares no cap at all rather than comparing the pending ones. A
    // budget with no key at all cannot reach this, loadBudget having refused it,
    // so the equality is never vacuous.
    if (pending.length === budgetKeys.length) {
        return { status: 'unmeasured', detail: 'every cap in the budget is pending, so the stale-entry mirror is wholly suppressed, no cap over a deleted file could red, and this reading compares no cap at all' };
    }
    const pendingMeasured = pendingMeasuredFrom(repoDir, pending);
    const changed = changedPaths(repoDir);
    const blindFailures = collected.blind.map((relPath) => ({
        path: relPath,
        reason: REASONS.PATHSPEC_BLIND,
        detail: 'a root holds this tracked path and the pathspec listing did not return it, so nothing classified or measured it'
    }));
    const measuredByPath = measuredByPathWithPending(collected.measured, pendingMeasured);
    const corpusFailure = corpusCapFailure(budget, measuredByPath);
    const failures = blindFailures.concat(evaluate(collected.measured, budget, collected.unclassified, pending,
        changed === null ? null : new Set(changed), { budgetPath: budgetFile, repoDir, pendingMeasured }))
        .concat(corpusFailure ? [corpusFailure] : []);
    return {
        status: failures.length === 0 ? 'ok' : 'failed',
        failures,
        pending,
        pendingMeasured,
        budget,
        untracked,
        measured: collected.measured,
        unclassified: collected.unclassified,
        excluded: collected.excluded,
        blind: collected.blind,
        totals: totals(collected.measured, budget)
    };
}

// The paths git reports as differing from HEAD under the measured roots. A path
// git reports as untracked is not in this listing, which is why no HEAD
// comparison is taken for one: what names the untracked files is untrackedPaths,
// and the report measures them from the worktree beside its totals.
// Deduplicated like its sibling listings: a diff listing can name one path more
// than once, an unresolved merge being the state that produces it, and a repeat
// here would emit one file's row twice into output a Chapter quotes.
//
// `--no-renames` is what makes a rename two entries. Rename detection is on by
// default, so `git mv` of a measured file prints the destination alone: the source
// is in neither this listing nor `git ls-files`, so it reaches no row at all while
// the destination renders as new since HEAD carrying the file's whole size. That
// is a +N with no -N beside it, at exit 0, in output a Chapter quotes as its
// section's delta. Two entries make the pair a growth row and a deletion row, and
// the arithmetic comes out where the rename's own delta belongs.
function changedPaths(repoDir) {
    mustHaveLibs();
    const out = libs.gitOutput(repoDir, ['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'].concat(ROOTS.map((r) => r.root)), { timeoutMs: GIT_TIMEOUT_MS });
    if (out === null) return null;
    return Array.from(new Set(out.split('\0').filter((s) => s !== '')));
}

// What the changeset touches that no row above can name, as
// { changed, untracked, excluded }, or null when git could not answer either
// question. The filtered listings above answer what the roots hold; this reading is
// what makes the report's silence about everything else legible, since a changeset
// touching only the hooks, the scripts directory or the repository top level
// otherwise renders exactly like a clean tree. The two counts are of paths no root
// holds, taken after the same case-folding root test the classifier's subject uses,
// so a path a root holds is never counted among them.
//
// `excluded` is the other silence, and it is a list rather than a count because it
// is short and its members are the point: a path on the named exclusion list is
// held by a root and measured by no shape, so it is in no row, in no total, and in
// neither count here. The budget file itself is that path, and a changeset editing
// it is exactly what a cap-raising audit is, so the term exists to keep the scope
// line's own claim true about the commonest changeset this tool reads.
//
// Three git semantics shape the arguments. `--no-renames` makes a rename two
// entries, for the reason changedPaths states. The `--` separator ends the option
// list, so a repository holding a path named `HEAD` cannot make the argument
// ambiguous and degrade the whole verb, which is the separator its sibling above
// already carries. And the untracked set is subtracted from the changed set,
// because one path can be in both: a path removed from the index and left on disk
// is reported as deleted by the diff and as untracked by the listing, and counted
// in each it counts as two paths.
function outsideRootCounts(repoDir) {
    mustHaveLibs();
    const changedOut = libs.gitOutput(repoDir, ['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'], { timeoutMs: GIT_TIMEOUT_MS });
    if (changedOut === null) return null;
    const untrackedOut = libs.gitOutput(repoDir, ['ls-files', '-z', '--others', '--exclude-standard', '--'], { timeoutMs: GIT_TIMEOUT_MS });
    if (untrackedOut === null) return null;
    const paths = (out) => Array.from(new Set(out.split('\0').filter((s) => s !== '')));
    const untracked = paths(untrackedOut);
    const untrackedSet = new Set(untracked);
    const changed = paths(changedOut).filter((p) => !untrackedSet.has(p));
    const outside = (list) => list.filter((p) => !ROOTS.some((r) => rootHolds(r.root, p))).length;
    const excluded = Array.from(new Set(changed.concat(untracked).filter((p) => EXCLUSIONS.includes(p)))).sort();
    return { changed: outside(changed), untracked: outside(untracked), excluded };
}

// One file's size at HEAD, as a row state plus a number where there is one.
// Three states are distinguished, and the distinction that matters is whether git
// ran: 'head-unknown' is git not running at all (a spawn error, a kill past the
// timeout, output past the runner's ceiling), 'head-unreadable' is a blob that
// exists and would not come back (that same ceiling, which the largest test file
// sits above), and 'changed' is a size that read. 'new' is the fourth row state
// and is narrower than its name: it is git answering non-zero to the
// object-existence question, which covers HEAD holding no blob at that path and
// also covers a repository git could not read, since `cat-file -e` exits 128 for
// both and its exit code carries no signal between them. What is kept apart
// deliberately is 'head-unknown' from the rest: a spawn failure collapsed into
// 'new' would print a long-standing file's whole size as this section's growth,
// at exit 0, into a Chapter that quotes this output as a durable record.
function headSize(repoDir, entry) {
    mustHaveLibs();
    const spec = 'HEAD:' + entry.path;
    const exists = libs.gitRun(repoDir, ['cat-file', '-e', spec], { timeoutMs: GIT_TIMEOUT_MS });
    if (exists === null) return { state: 'head-unknown', size: null, tests: null };
    if (exists.status !== 0) return { state: 'new', size: null, tests: null };
    const content = libs.gitOutput(repoDir, ['show', spec], { timeoutMs: GIT_TIMEOUT_MS });
    if (content === null) return { state: 'head-unreadable', size: null, tests: null };
    const m = measure(entry, content);
    return { state: 'changed', size: m.size, tests: m.tests };
}

// The rows the report prints for tracked files: one per changed file whose
// measured size or test count moved, plus every changed file whose HEAD size
// could not be read or whose HEAD state git could not answer for, which are
// named rather than dropped.
//
// Four further states get a row rather than a drop, all for the same reason: a
// changed file left out of the report reads exactly like a file that did not
// change. A changed file whose worktree content this tool would not measure is a
// row in the 'worktree-unreadable' state, a changed file the classifier reached
// and could not place is a row in the 'unmeasured' state, a changed file the
// tracked listing no longer holds is a row in the 'deleted' state, and one the
// index has dropped while the worktree still holds it is a row in the
// 'index-removed' state. The named exclusions are the one silent drop, since the
// budget is data about the corpus rather than a member of it and its own diff is
// the reviewer's subject anyway; the scope line under the totals is what names
// them, so the drop is legible rather than silent about its own existence. The
// exclusion test is on the list itself rather than on the `excluded` set the
// classifier produced, because a deleted excluded path is in no tracked listing
// and so in no such set, and it would otherwise wear the sentence for a path no
// shape reaches.
//
// The index-removed state is what parts a deletion from a file that is still
// there. `git rm --cached` leaves the path on disk, and git then reports it in the
// HEAD diff as deleted AND in the untracked listing as present, so given the
// deleted row it would carry HEAD's whole size as a negative delta: a cut that did
// not happen, which is the one direction a size reading here must never fabricate.
// The row says the file is still present and untracked and carries no delta, and
// the untracked rows below print its live size.
//
// The deleted state is what keeps the unmeasured sentence true. git reports a
// path the index has deleted as differing from HEAD while `git ls-files` no
// longer prints it, so such a path is in `changed` and in no measured entry, and
// reported as unmeasured it would claim the classifier reached a file that is
// not there. `unclassified` is what separates the two: a path on that list is
// tracked and unplaced, and a changed path on neither list has left the corpus.
// HEAD still holds its blob, so its row carries the HEAD size and the negative
// delta, which is the whole reading a deletion has.
//
// Where that HEAD read produces no number the row carries the state it came back
// in, on `headBlobState`, because the states headSize keeps apart mean different
// things about a deletion and the audits this reading serves are deletion efforts:
// a blob past the runner's output ceiling is a real deletion whose size cannot be
// printed, a git call that did not run at all is a reading nobody took, HEAD
// holding no blob is a file added and deleted inside the same changeset, and a
// classifier that could not place the path never asked git anything. One sentence
// over all four would read as the first.
//
// The row list is bounded, and the bound is on the changed paths read rather than
// on the rows produced, because the cost is the reading: every changed row costs up
// to two git spawns, each bounded at GIT_TIMEOUT_MS, and nothing bounds how many
// paths a changeset holds. That was self-limiting while this tool measured one
// known repository by hand; it is not, now that a Chapter's `Delta:` field has every
// plan run invoke `report` over whatever the section touched. Past the bound the
// remaining changed paths are counted and the count is printed, on the same shape
// the output ceiling uses: a reading that says it was bounded, never a short one
// that reads as a complete list. The bound sits far above any changeset a section
// produces, so what it binds is an audit-scale sweep, whose per-file rows are not
// the reading anyone reads anyway.
function reportRows(repoDir, measured, excluded, unclassified, untracked) {
    const changed = changedPaths(repoDir);
    if (changed === null) return null;
    const byPath = new Map(measured.map((m) => [m.path, m]));
    const excludedPaths = new Set(excluded || []);
    const unclassifiedPaths = new Set(unclassified || []);
    const untrackedPresent = new Set(untracked || []);
    const rows = [];
    const read = boundList(changed).shown;
    for (const relPath of read) {
        const m = byPath.get(relPath);
        if (!m) {
            if (EXCLUSIONS.includes(relPath) || excludedPaths.has(relPath)) continue;
            if (untrackedPresent.has(relPath)) {
                rows.push({ path: relPath, metric: null, size: null, tests: null, headState: 'index-removed', headSize: null, headTests: null });
                continue;
            }
            if (!unclassifiedPaths.has(relPath)) {
                const entry = classify([relPath]).entries[0] || null;
                const head = entry ? headSize(repoDir, entry) : { state: 'absent', size: null, tests: null };
                rows.push({
                    path: relPath,
                    metric: entry === null ? null : entry.metric,
                    size: null,
                    tests: null,
                    headState: 'deleted',
                    headBlobState: head.state,
                    headSize: head.size,
                    headTests: head.tests
                });
                continue;
            }
            rows.push({ path: relPath, metric: null, size: null, tests: null, headState: 'unmeasured', headSize: null, headTests: null });
            continue;
        }
        if (m.size === null) {
            rows.push({ path: relPath, metric: m.metric, size: null, tests: null, headState: 'worktree-unreadable', headSize: null, headTests: null });
            continue;
        }
        const head = headSize(repoDir, { path: relPath, metric: m.metric });
        if (head.state === 'changed' && head.size === m.size && head.tests === m.tests) continue;
        rows.push({
            path: relPath,
            metric: m.metric,
            size: m.size,
            tests: m.tests,
            headState: head.state,
            headSize: head.size,
            headTests: head.tests
        });
    }
    return { rows, omitted: changed.length - read.length };
}

// The bound every list this output renders takes, and the notice a list that was
// cut prints. MAX_REPORT_ROWS is the changed-path bound, and the reason it carries
// reaches every list printed beside it: nothing bounds how many paths a changeset
// holds, how many untracked files sit under a measured root, or how many tracked
// paths a pathspec listing missed, and this output is quoted whole into a plan-doc
// Chapter. So the bound is applied here, where the rendered lists are assembled,
// rather than once per list at three more sites. The notice is the same sentence
// for each, on the same shape the output ceiling uses: a reading that says it was
// bounded, never a short one that reads as a complete list.
function boundList(list) {
    const all = list || [];
    return { shown: all.slice(0, MAX_REPORT_ROWS), omitted: Math.max(all.length - MAX_REPORT_ROWS, 0) };
}

function boundNotice(subject, omitted) {
    return 'the ' + subject + ' list is bounded at ' + MAX_REPORT_ROWS + ' entries, and '
        + omitted + ' further ' + (omitted === 1 ? 'entry is' : 'entries are') + ' not named';
}

// A delta, always signed, zero included. A bare `0` in a row that also carries a
// moved test count reads as no field at all beside its neighbours, and a deleted
// empty file's row would print 'HEAD held 0 lines, 0'; both are reachable rows,
// and a reader of the audits' own reading tells an unchanged number from an absent
// one by the sign being there.
function signed(n) {
    return n >= 0 ? '+' + n : String(n);
}

// Why a deleted row carries no HEAD size, per the state the HEAD read came back
// in. Four states, four sentences, because a deletion whose size sits past the
// runner's output ceiling, a git call that never ran, a path HEAD never held, and
// a path no shape classifies are four different findings, and a reader of the
// audits' own reading acts differently on each.
function deletedHeadNote(headBlobState) {
    if (headBlobState === 'head-unreadable') return 'its HEAD blob is past the git runner output ceiling, so its size at HEAD is unread';
    if (headBlobState === 'head-unknown') return 'git did not answer for its HEAD state, so its size at HEAD is unread';
    if (headBlobState === 'new') return 'HEAD holds no blob at this path, so it was added and deleted inside this changeset';
    if (headBlobState === 'absent') return 'no measured shape reaches this path, so no HEAD size was asked for';
    return 'no HEAD size read for it';
}

// The totals block, in one place, because both reading verbs print it and a reader
// compares the two. Two copies of it drifted apart once already, in the sentence
// about unreadable files.
//
// `outsideRoots`, where the caller took the reading, is the scope line: what the
// changeset touches that no row above names, as { changed, untracked, excluded }.
// Without it a section whose whole delta sits outside the measured roots (the hooks,
// this script's own directory, the doctor, the repository top level) renders as a
// subject line and a totals block with no row between them, which is what a clean
// tree renders too, and reads in a Chapter field named for the delta as a section
// that grew nothing. Both counts
// are taken because a new file is untracked at exactly the moment a Chapter's
// reading is taken and a HEAD diff never lists one, so the diff alone would leave
// a whole new file outside the roots reported as nothing at all. The counts are not
// a measurement and no row here names those paths: this tool's subject is the
// roots, and what the line buys is that the silence about everything else is
// legible.
//
// The excluded term is the second silence and it carries the same duty. A changed
// path on the named exclusion list is dropped from the rows deliberately, and it is
// in neither count, because a root does hold it: the budget file is that path, and
// a cap-raising audit is exactly a changeset that edits it.
//
// `unmeasuredRows` is the third silence, and it is the rows' own rather than the
// scope reading's, which is why the caller decides it: a rendered row that names no
// size is a path in this changeset that nothing above measured. Four reach it, all
// ordinary. A changed tracked path a root holds and no shape reaches, a changed
// measured file whose worktree content the reader would not hand over, a deletion
// whose HEAD size never read, and a path removed from the index that no shape
// reaches, so no untracked row below names its size. A bounded list is the same
// silence from the other direction, since the paths it did not name are measured
// nowhere in the output either.
//
// So the closing clause is earned rather than asserted: it prints only where both
// terms here are empty and no such row or bound sits above it.
//
// A scope reading git could not take degrades this one line rather than the verb.
// The counts are an addition to a reading whose rows and totals are complete
// without them, and a reader told the scope is unavailable and why knows exactly
// what the reading does not cover, which is what a refused verb would not have told
// them at all.
function renderTotals(sums, outsideRoots, unmeasuredRows) {
    const unreadableNote = (bucket) => (bucket.unreadable ? ', ' + bucket.unreadable + ' of them unreadable and so outside the size sum while their caps stand in the cap sum' : '');
    const lines = [
        'words: ' + sums.words.size + ' of cap ' + sums.words.cap + ' across ' + sums.words.files + ' curated files' + unreadableNote(sums.words),
        'test lines: ' + sums.lines.size + ' of cap ' + sums.lines.cap + ' across ' + sums.lines.files + ' test files' + unreadableNote(sums.lines),
        'tests: ' + sums.tests
    ];
    if (outsideRoots && outsideRoots.unavailable) {
        lines.push('changed paths under no measured root: unavailable, ' + outsideRoots.unavailable
            + ', so this reading says nothing about what this changeset touches outside the measured roots');
    } else if (outsideRoots && typeof outsideRoots.changed === 'number' && typeof outsideRoots.untracked === 'number') {
        const total = outsideRoots.changed + outsideRoots.untracked;
        const excluded = outsideRoots.excluded || [];
        const outsideTerm = total === 0
            ? 'changed paths under no measured root: none'
            : 'changed paths under no measured root: ' + total + ' (' + outsideRoots.changed
                + ' differing from HEAD, ' + outsideRoots.untracked
                + ' untracked), which this tool does not measure and which no row above names';
        const excludedTerm = excluded.length === 0
            ? 'named-exclusion paths in the changeset: none'
            : 'named-exclusion paths in the changeset: ' + excluded.map(safePath).join(', ')
                + ', which a root holds and no shape measures, so no row above names them';
        lines.push(outsideTerm + '; ' + excludedTerm
            + (total === 0 && excluded.length === 0 && !unmeasuredRows ? ', so every path this changeset touches is measured above' : ''));
    }
    return lines;
}

// The report's text, built from rows and totals alone so its shape is settled
// without a repository: a clean tree yields no rows, so this function's text is the
// totals block by itself. The reading a verb prints carries the subject line above
// it, which is main's rather than this function's.
//
// A row with no size is its own line rather than a number, because the delta
// arithmetic below would coerce a missing size to zero and print a whole file's
// cap as a cut. That is the same invariant `measure` states and `evaluate`
// honors: an unreadable file is reported unreadable, never collapsed into a zero
// that reads as a file that shrank. The totals line carries the count with it,
// since an unreadable file's cap still stands in the cap total while its size does
// not stand in the size total.
//
// `untrackedRows` are the files git reports as untracked and not ignored under a
// measured root, capped or not. They print beside the tracked rows and are named
// again under the totals, because the totals are built from the classified corpus
// and an untracked file is not in it: a section that adds a file would otherwise
// be reported a whole file short, silently, by the verb a Chapter quotes, and the
// timing is what makes that bite, since a file a section adds is untracked at
// exactly the moment the Chapter's reading is taken.
//
// `blindPaths` are the pathspec cross-check's findings, printed here as well as
// failed by `check`, because a path this tool claims as its subject and never
// measured is invisible in every other line of this output: it is in no row, in
// no total, and in the untracked list only if it is untracked. A reading a
// Chapter quotes says so rather than leaving it to a verb nobody quoted.
//
// `omittedRows` is how many changed paths the row bound left unread, printed rather
// than dropped for the reason every other bound here is printed: a list cut short
// and left silent reads as the whole list. The untracked rows and the blind paths
// take the same bound here, through boundList, since nothing bounds either of them
// either and both print into the same quoted block.
function renderReport(rows, sums, budget, untrackedRows, blindPaths, outsideRoots, omittedRows) {
    const lines = [];
    const capOf = (relPath) => (budget && typeof budget[relPath] === 'number' ? 'cap ' + budget[relPath] : 'no cap');
    const untracked = boundList(untrackedRows);
    const blind = boundList(blindPaths);
    // The untracked rows this reading actually prints a size for. Two lines lean on
    // it: the index-removed row, whose promise that the worktree size is named below
    // is only true where a shape reaches the path and the untracked list still holds
    // it, and the scope line's closing clause, which cannot claim every touched path
    // was measured while such a row names none.
    const sizedBelow = new Set(untracked.shown.filter((r) => r.metric !== null).map((r) => r.path));
    let unmeasuredRows = omittedRows > 0 || untracked.omitted > 0 || blind.omitted > 0
        || (blindPaths || []).length > 0 || untracked.shown.some((r) => r.metric === null);
    for (const row of rows) {
        const shown = safePath(row.path);
        const capText = capOf(row.path);
        if (row.headState === 'unmeasured') {
            lines.push(shown + ': changed, tracked under a measured root and matched by no measured shape, so nothing measures it');
            unmeasuredRows = true;
            continue;
        }
        if (row.headState === 'index-removed') {
            lines.push(shown + ': removed from the index and still present in the worktree, untracked, ' + capText
                + (sizedBelow.has(row.path)
                    ? ', so no delta; its worktree size is named among the untracked files below'
                    : ', so no delta; no measured shape reaches it, so nothing names its worktree size'));
            if (!sizedBelow.has(row.path)) unmeasuredRows = true;
            continue;
        }
        if (row.headState === 'deleted') {
            if (row.headSize === null) {
                lines.push(shown + ': deleted, ' + capText + ', ' + deletedHeadNote(row.headBlobState) + ', so no delta');
                unmeasuredRows = true;
                continue;
            }
            let gone = shown + ': deleted, ' + capText + ', HEAD held ' + row.headSize + ' ' + row.metric + ', ' + signed(-row.headSize);
            if (row.headTests !== null) gone += '; tests at HEAD ' + row.headTests + ', ' + signed(-row.headTests);
            lines.push(gone);
            continue;
        }
        if (row.size === null) {
            lines.push(shown + ': worktree content unreadable, ' + capText + ', so no size and no delta');
            unmeasuredRows = true;
            continue;
        }
        if (row.headState === 'head-unreadable') {
            lines.push(shown + ': ' + row.size + ' ' + row.metric + ', ' + capText + ', HEAD size unreadable (its blob is past the git runner output ceiling), so no delta');
            continue;
        }
        if (row.headState === 'head-unknown') {
            lines.push(shown + ': ' + row.size + ' ' + row.metric + ', ' + capText + ', HEAD state unknown (git did not answer), so no delta');
            continue;
        }
        if (row.headState === 'new') {
            lines.push(shown + ': ' + row.size + ' ' + row.metric + ', ' + capText + ', new since HEAD');
            continue;
        }
        let line = shown + ': ' + row.size + ' ' + row.metric + ', ' + capText + ', ' + signed(row.size - row.headSize);
        if (row.tests !== null && row.headTests !== null) line += '; tests ' + row.tests + ', ' + signed(row.tests - row.headTests);
        lines.push(line);
    }
    if (omittedRows) lines.push(boundNotice('changed-path', omittedRows));
    for (const row of untracked.shown) {
        const shown = safePath(row.path);
        if (row.metric === null) {
            lines.push(shown + ': untracked under a measured root and matched by no measured shape, so nothing measures it; the totals below exclude it');
            continue;
        }
        let line = shown + ': ' + (row.size === null ? 'worktree content unreadable' : row.size + ' ' + row.metric) + ', ' + capOf(row.path) + ', untracked so HEAD holds no blob and the totals below exclude it';
        if (row.tests !== null) line += '; tests ' + row.tests;
        lines.push(line);
    }
    if (untracked.omitted) lines.push(boundNotice('untracked-path', untracked.omitted));
    for (const relPath of blind.shown) {
        lines.push(safePath(relPath) + ': a root holds this tracked path and the pathspec listing did not return it, so nothing classified or measured it and the totals below exclude it');
    }
    if (blind.omitted) lines.push(boundNotice('pathspec-blind path', blind.omitted));
    for (const line of renderTotals(sums, outsideRoots, unmeasuredRows)) lines.push(line);
    if (untracked.shown.length > 0) {
        lines.push('excluded from those totals, untracked under a measured root: ' + untracked.shown.map((r) => safePath(r.path)).join(', '));
    }
    return lines;
}

// Every untracked, non-ignored path under a measured root, measured from the
// worktree where a shape reaches it, so the report can name what its totals leave
// out. A cap is not the condition: a file with a cap and a file without one are
// both absent from the totals and both absent from the HEAD diff, so a report
// naming only the capped ones leaves a section's newest file invisible in exactly
// the state a section's file is normally in when the Chapter is written. A path no
// shape reaches carries a null metric and is named without a size, since nothing
// measures it. The named exclusions are left out: the budget is data about the
// corpus rather than a member of it.
function untrackedRows(repoDir, untracked) {
    const rows = [];
    for (const relPath of untracked || []) {
        if (EXCLUSIONS.includes(relPath)) continue;
        if (!ROOTS.some((r) => rootHolds(r.root, relPath))) continue;
        const entry = classify([relPath]).entries[0];
        if (!entry) {
            rows.push({ path: relPath, metric: null, size: null, tests: null });
            continue;
        }
        rows.push(measure(entry, readWorktree(repoDir, relPath)));
    }
    return rows;
}

// The report reading. The no-corpus refusals are `check`'s applied to this verb: a
// reading that measured no file at all tested nothing, and its all-zero totals read
// as a section that grew nothing rather than as a reading that never happened,
// which is the worse failure of the two here because a Chapter quotes this output
// as its record. A corpus hidden from the classifier takes its own refusal ahead of
// the empty one, since the two want opposite responses.
//
// One reading here degrades rather than refusing: the scope counts under the totals
// are an addition to a report whose rows and totals stand without them, so a git
// failure there costs that one line and says so, where refusing would cost the whole
// reading a Chapter is about to record.
function report(repoDir, budgetFile, containRoot) {
    const collected = collect(repoDir);
    if (collected.status !== 'ok') return collected;
    const untracked = untrackedPaths(repoDir);
    if (untracked === null) return { status: 'git-failed', detail: 'git ls-files --others returned nothing usable for ' + safePath(repoDir) };
    const refusal = unmeasuredRefusal(collected, 'there is no reading to report', untrackedMeasuredPaths(untracked));
    if (refusal !== null) return refusal;
    const budget = loadBudget(budgetFile, containRoot);
    const read = reportRows(repoDir, collected.measured, collected.excluded, collected.unclassified, untracked);
    if (read === null) return { status: 'git-failed', detail: 'git diff --name-only returned nothing usable for ' + safePath(repoDir) };
    const counted = outsideRootCounts(repoDir);
    const outside = counted === null
        ? { unavailable: 'the unfiltered git listings returned nothing usable' }
        : counted;
    const untrackeds = untrackedRows(repoDir, untracked);
    const lines = renderReport(read.rows, totals(collected.measured, budget), budget, untrackeds, collected.blind, outside, read.omitted);
    if (Object.prototype.hasOwnProperty.call(budget, CORPUS_CAP_KEY)) {
        // The same measured-plus-pending lookup check() holds every cap to, so a
        // capped file that is untracked and pending sums here exactly as check()
        // reads it, rather than reading as absent because this verb never asked
        // pendingEntries about it.
        const pending = pendingEntries(budget, collected.measured, untracked);
        const pendingMeasured = pendingMeasuredFrom(repoDir, pending);
        const measuredByPath = measuredByPathWithPending(collected.measured, pendingMeasured);
        // The cap is repository-supplied, so it prints only where it is the finite
        // number check() holds the sum to; any other value prints as that fact.
        const cap = budget[CORPUS_CAP_KEY];
        const capText = typeof cap === 'number' && Number.isFinite(cap) ? String(cap) : 'not a finite number';
        lines.push('corpus: ' + corpusSum(budget, measuredByPath) + ' words of cap ' + capText);
    }
    return {
        status: 'ok',
        lines,
        outsideRoots: outside,
        rows: read.rows,
        omitted: read.omitted,
        untracked: untrackeds,
        blind: collected.blind
    };
}

// The budget's initial content: current sizes, one entry per classified file,
// key-sorted so a later diff of the file reads as the edit it is.
function budgetFrom(measured) {
    const out = {};
    for (const m of measured.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
        if (m.size !== null) out[m.path] = m.size;
    }
    return out;
}

// The budget's bytes. init writes CRLF with a four-space indent, since every
// other file in this checkout is CRLF and no .gitattributes normalizes anything:
// JSON.parse is indifferent to the ending, and a lone-LF file among CRLF siblings
// is not. sync passes the ending and indent it read from the file it replaces.
// The map is flat, so it is written line by line rather than through
// JSON.stringify's space argument, which cuts an indent to ten characters.
function serializeBudget(budget, eol, indent) {
    const ending = eol || '\r\n';
    const pad = indent === undefined ? '    ' : typeof indent === 'number' ? ' '.repeat(indent) : indent;
    const keys = Object.keys(budget);
    if (keys.length === 0) return '{}' + ending;
    return '{' + ending + keys.map((k) => pad + JSON.stringify(k) + ': ' + JSON.stringify(budget[k])).join(',' + ending) + ending + '}' + ending;
}

// Write the budget from current sizes, refusing an existing file. Moving a cap
// is the sync verb's, so nothing here overwrites a committed budget: a re-init would silently raise every cap to whatever the
// tree happens to hold. The write itself carries the refusal through the
// exclusive-create flag, since the check below and the write are two moments and
// a budget appearing between them is exactly what the refusal exists to protect.
//
// A tree holding an uncommitted edit to a measured file is refused too. Caps come
// from worktree content, so initializing over someone's in-flight edit bakes that
// edit into a committed cap, and where the edit is a net deletion the cap lands
// below HEAD and the gate then reds on a clean checkout.
//
// Containment binds this write whatever --budget says, which is where the write
// parts from the read. The read side's exemption is about a reading: an operator
// naming a budget elsewhere is choosing a subject to read, and a wrong choice
// yields a figure they asked for. A write is not a reading, so an unbounded one
// creates a file anywhere on disk from a flag, and the caps it holds are then read
// back from outside the reviewed checkout one call later. It is checked on the
// directory the file would land in, since the file does not exist yet and a path
// that does not exist resolves to nothing: a linked `test/` would otherwise write
// the reviewed checkout's caps outside it.
//
// A missing directory and a directory linked out of the checkout are parted
// before that check, in the order the read side already documents: a target
// repository with no test/ directory yet is the commonest state, and reported as a
// containment failure it sends its reader after a symlink nobody planted. The
// write itself goes to the resolved directory rather than to the raw path, so the
// bytes land where containment was checked.
function initBudget(repoDir, budgetFile, containRoot) {
    mustHaveLibs();
    let target = budgetFile;
    if (containRoot) {
        const dir = path.dirname(budgetFile);
        if (!fs.existsSync(dir)) {
            return { status: 'refused', detail: 'the budget path ' + safePath(budgetFile)
                + ' names a directory that does not exist, so there is nowhere to write it' };
        }
        // The containment root itself is admitted before the helper sees it, because
        // the helper admits a path strictly inside its root and not the root: a budget
        // named directly at the top level of the repository under measurement is
        // inside that repository by definition, and refused there the message is
        // false about the path it names. samePath is the same realpath-and-case
        // comparison the --repo check runs, so a link or a casing spelling one
        // directory two ways is one directory here too.
        const realDir = samePath(dir, containRoot) ? dir : libs.containedRealPath(containRoot, dir);
        if (realDir === null) {
            return { status: 'refused', detail: 'the budget path ' + safePath(budgetFile)
                + ' does not resolve inside ' + safePath(containRoot)
                + ', so its caps would not be the reviewed checkout\'s' };
        }
        target = path.join(realDir, path.basename(budgetFile));
    }
    if (fs.existsSync(target)) {
        return { status: 'refused', detail: 'a budget already exists at ' + safePath(budgetFile) + '; a cap moves through the sync verb' };
    }
    const collected = collect(repoDir);
    if (collected.status !== 'ok') return collected;
    // The same no-corpus refusal both reading verbs take, and the caller here needs
    // it most: with nothing under the roots the budget written is an empty object,
    // which is a file no later run can use, reported as a success. The untracked
    // measured set is not counted, because this verb writes caps from tracked
    // content alone and an untracked file gets no cap here.
    const refusal = unmeasuredRefusal(collected, 'there would be no cap to write');
    if (refusal !== null) return refusal;
    const changed = changedPaths(repoDir);
    if (changed === null) return { status: 'git-failed', detail: 'git diff --name-only returned nothing usable for ' + safePath(repoDir) };
    const measuredPaths = new Set(collected.measured.map((m) => m.path));
    const dirty = changed.filter((p) => measuredPaths.has(p));
    if (dirty.length > 0) {
        return { status: 'refused', detail: 'measured files differ from HEAD, so a cap taken now would bake uncommitted content in: ' + dirty.map(safePath).join(', ') };
    }
    const unreadable = collected.measured.filter((m) => m.size === null).map((m) => m.path);
    if (unreadable.length > 0) {
        // Four states produce a size of null and this refusal cannot tell them apart,
        // so it names all four rather than the commonest one: a caller sent after a
        // file the worktree does not hold looks for a deletion where the fault is a
        // read ceiling, a FIFO, or a link out of the checkout.
        return { status: 'refused', detail: 'git tracks files whose bytes the bounded reader would not hand over, absent from the worktree or not a regular file or past the read ceiling or resolving outside the repository, so their size is unknown: '
            + unreadable.map(safePath).join(', ') };
    }
    if (collected.unclassified.length > 0) {
        return { status: 'refused', detail: 'tracked files under a measured root that nothing classifies: ' + collected.unclassified.map(safePath).join(', ') };
    }
    if (collected.blind.length > 0) {
        return { status: 'refused', detail: 'tracked files a root holds that the pathspec listing does not return, so no cap would cover them: ' + collected.blind.map(safePath).join(', ') };
    }
    const budget = budgetFrom(collected.measured);
    try {
        fs.writeFileSync(target, serializeBudget(budget), { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
        if (err && err.code === 'EEXIST') {
            return { status: 'refused', detail: 'a budget already exists at ' + safePath(budgetFile) + '; a cap moves through the sync verb' };
        }
        throw err;
    }
    return { status: 'ok', budget, count: Object.keys(budget).length };
}

// Moves the caps the budget already holds to their files' current sizes, in
// both directions. With no path named after the verb it moves every cap and is
// an audit's form over a clean tree: where a cap it would move belongs to a file
// differing from HEAD or not yet added to git, or where the budget file it would
// overwrite itself differs from HEAD, it refuses before writing, since on a shared
// checkout a peer's uncommitted growth would otherwise land as a raised cap in
// this session's change, or a peer's uncommitted cap edit would be written over,
// and neither would ride in a diff as what it is. With
// paths named it moves those alone, leaves every other entry as it stands and
// says how many it left, and adds a first cap for a named path the budget lacks,
// tracked or not yet added, since init refuses an existing budget and a new
// curated file would otherwise have no command that caps it. A named path is
// resolved against the repository before it is matched, so any spelling the
// shell hands over names the key, and one resolving outside the repository is
// refused as outside, through the same normalizer every plan-path reader screens
// a plan path with. An unnamed path the budget lacks is named and never added, and an
// unnamed entry still over its cap is named and left where it is; in either case
// the run exits 1 after the write, because check still reds on it.
//
// The refusal path is check's own, called rather than copied: this reuses
// check() itself for the no-corpus refusals and the budget load, so a
// tightened refusal there tightens here with no second copy to miss. Where
// check() comes back with a refusal status, that result is returned as-is,
// unread past its status. A throw out of loadBudget (a missing, unreadable, or
// malformed budget, or one outside the checkout) is not caught here either: it
// reaches main's own catch exactly as it does when check() throws it, and gets
// the same exit code.
//
// Every failure check() reports other than an over-cap file (the state a move
// answers) and a file with no cap (the state `unlisted` names) refuses the
// write: a stale entry, an unreadable file, an invalid cap, an unclassified
// file or a pathspec-blind path is a reading the ratchet reds on and a cap
// move cannot answer, and a rewrite that proceeded past one would print a
// clean move list over a budget the next check still refuses. That refusal is
// also what makes the loop below total: every key left in the budget then has
// a measurement, tracked or pending, so an entry is moved, unchanged, or
// outside the named set, and the three counts sum to the budget.
//
// Containment binds this write whatever --budget says, which is initBudget's
// rule and its reasoning: a write is not a reading. main passes the repository
// as the root for both write verbs, and the write goes to the path containment
// resolved rather than to the raw one, so the bytes land where the check ran.
// The file is read once here, for its bytes and its shape together, and that
// reading is compared with the budget check() validated, under the same
// duplicate-key scan the loader runs: a difference means the file changed
// between the check and this read, and the write is refused rather than written
// over that edit. Two runs racing between this read and the rename are not
// refused: the second rename wins. A discarded raise or add is loud, since the
// next check reds on the file; a discarded lowering is silent to the gate,
// leaving headroom the next report shows and the next bare sync retakes; every
// move either run made is on its own stdout. The rewrite keeps the file's own
// line endings, indent and key order (a file with no newline at all takes the
// CRLF init writes; one whose keys sit at column 0 or on a single line keeps its
// endings and takes init's four-space indent, since there is no indent to keep), places an added key before the first existing key that
// sorts after it, which on the sorted budget init writes is sorted order, and
// lands by rename from a sibling temporary file, so an interrupted run leaves
// the committed budget whole. A refused exclusive create is a refusal, that
// file being another run's and not this one's to delete; a failed rename unlinks
// the file this run wrote.
function sync(repoDir, budgetFile, containRoot, onlyPaths) {
    mustHaveLibs();
    const checked = check(repoDir, budgetFile, containRoot);
    if (checked.status === 'git-failed' || checked.status === 'unmeasured') {
        return checked;
    }
    const blocking = checked.failures.filter((f) => f.reason !== REASONS.OVER_CAP && f.reason !== REASONS.MISSING_ENTRY
        && f.reason !== REASONS.CORPUS_OVER_CAP);
    if (blocking.length > 0) {
        const shown = boundList(blocking.map((f) => f.reason + ' ' + safePath(f.path)));
        return { status: 'refused', detail: 'check reports failures a cap move cannot answer, so the budget is left as it stands: '
            + shown.shown.join(', ') + (shown.omitted ? '; ' + boundNotice('blocking failure', shown.omitted) : '') };
    }
    const target = containRoot ? libs.containedRealPath(containRoot, budgetFile) : budgetFile;
    if (target === null) {
        // check() loaded this budget through the same containment a moment ago, so
        // only a filesystem change between the two calls reaches this.
        throw new Error('the size budget at ' + safePath(budgetFile) + ' stopped resolving inside ' + safePath(containRoot) + ' between the check and the write, so nothing was written');
    }
    const res = libs.readFileBounded(target, MAX_BUDGET_BYTES);
    if (res === null || res.bounded) {
        throw new Error('the size budget at ' + safePath(budgetFile) + ' could not be re-read whole, so nothing was written');
    }
    let budget;
    try {
        budget = JSON.parse(res.text);
    } catch {
        return { status: 'refused', detail: 'the size budget at ' + safePath(budgetFile) + ' stopped parsing between the check and the write, so it is left as it stands' };
    }
    const seenKeys = new Set();
    for (const key of budgetKeysInText(res.text)) {
        if (seenKeys.has(key)) {
            return { status: 'refused', detail: 'the size budget at ' + safePath(budgetFile) + ' came to list a path more than once between the check and the write, so it is left as it stands' };
        }
        seenKeys.add(key);
    }
    if (!sameBudget(budget, checked.budget)) {
        return { status: 'refused', detail: 'the size budget at ' + safePath(budgetFile) + ' changed between the check and the write, so it is left as it stands' };
    }
    const measuredByPath = new Map(checked.measured.concat(checked.pendingMeasured)
        .filter((m) => m.size !== null).map((m) => [m.path, m]));
    let named = null;
    if (onlyPaths && onlyPaths.length > 0) {
        const untrackedMeasured = new Set(untrackedMeasuredPaths(checked.untracked));
        named = new Set();
        // Set once the corpus cap itself is named, and read after the loop below
        // rather than inline: a new corpus file's first cap is added to
        // measuredByPath by this same loop, in whatever order the command line
        // gave the two paths, so the sum has to wait for every named path to be
        // known before it is taken.
        let corpusCapNamed = false;
        for (const raw of onlyPaths) {
            if (raw === '') {
                return { status: 'refused', detail: 'an empty path names nothing to cap' };
            }
            // The corpus cap is a key rather than a path, so it takes no path
            // resolution: naming it moves it to the corpus's current sum, whether the
            // budget already carries the key or gains it here as a first cap, exactly
            // as an unnamed file's first cap arrives below.
            if (raw === CORPUS_CAP_KEY) {
                corpusCapNamed = true;
                named.add(CORPUS_CAP_KEY);
                continue;
            }
            if (/[\x00-\x1F]/.test(raw)) {
                return { status: 'refused', detail: safePath(raw) + ' carries a control character, so it names no file here' };
            }
            // The given spelling first, then the canonical one.
            let rel = libs.normalizePlanArg(repoDir, raw);
            if (rel === null) rel = libs.normalizePlanArg(realPathOr(repoDir), raw);
            if (rel === null) {
                return { status: 'refused', detail: safePath(raw) + ' resolves outside the repository under measurement, so it has no cap here to move' };
            }
            if (!measuredByPath.has(rel)) {
                if (EXCLUSIONS.includes(rel)) {
                    return { status: 'refused', detail: safePath(rel) + ' is on the exclusion list, which no shape measures, so it has no cap of its own' };
                }
                if (!untrackedMeasured.has(rel)) {
                    return { status: 'refused', detail: safePath(rel) + ' is not a measured file under a root in this checkout, so there is no size to move a cap to' };
                }
                const m = measure(classify([rel]).entries[0], readWorktree(repoDir, rel));
                if (m.size === null) {
                    return { status: 'refused', detail: safePath(rel) + ' is under a measured root and its worktree content is unreadable, so there is no size to cap it at' };
                }
                measuredByPath.set(rel, m);
            }
            named.add(rel);
        }
        if (corpusCapNamed) {
            measuredByPath.set(CORPUS_CAP_KEY, { path: CORPUS_CAP_KEY, metric: 'words', size: corpusSum(budget, measuredByPath, named) });
        }
    }
    const next = Object.create(null);
    const moved = [];
    const added = [];
    let unchanged = 0;
    let outside = 0;
    for (const key of Object.keys(budget)) {
        const cap = budget[key];
        // The corpus cap moves only where it is named on the command line: a bare
        // sync leaves it exactly as it stands, uncounted, since a whole-corpus
        // figure is not a file's own size to move by default and a bare sync
        // prints no outside count to hold it to. A named sync that does not name
        // it falls to the ordinary outside branch below, so it is counted there
        // like any other cap the run left alone.
        if (key === CORPUS_CAP_KEY && named === null) {
            next[key] = cap;
            continue;
        }
        if (named !== null && !named.has(key)) {
            next[key] = cap;
            outside += 1;
            continue;
        }
        const m = measuredByPath.get(key);
        if (!m) {
            return { status: 'refused', detail: safePath(key) + ' holds a cap and no measurement reached the move, a check outcome this verb does not classify, so nothing is written' };
        }
        if (m.size === cap) {
            next[key] = cap;
            unchanged += 1;
            continue;
        }
        next[key] = m.size;
        moved.push({ path: key, from: cap, to: m.size, direction: m.size > cap ? 'raised' : 'lowered' });
    }
    if (named === null && moved.length > 0) {
        const changed = changedPaths(repoDir);
        if (changed === null) return { status: 'git-failed', detail: 'git diff --name-only returned nothing usable for ' + safePath(repoDir) };
        // The budget file is asked about on its own, through git status rather than
        // the root-scoped diff listing: that listing never names an untracked path
        // and never reaches a --budget outside the measured roots; --ignored so a
        // budget git ignores refuses as one not yet added, since git status is
        // silent on an ignored path without it; and the repository is
        // canonicalized first because target is a real path while repoDir may be
        // the spelling the flag arrived in.
        const budgetRel = path.relative(realPathOr(repoDir), target).split(path.sep).join('/');
        const budgetState = libs.gitOutput(repoDir, ['status', '--porcelain', '--untracked-files=all', '--ignored', '-z', '--', budgetRel], { timeoutMs: GIT_TIMEOUT_MS });
        if (budgetState === null) return { status: 'git-failed', detail: 'git status returned nothing usable for ' + safePath(budgetRel) + ' (a wide ignored tree under a --budget near the repository root is one cause, since the ignored listing walks it)' };
        if (budgetState.length > 0) {
            return { status: 'refused', detail: 'the bare form moves every cap and takes a clean tree, and the budget file itself differs from HEAD or is not yet added to git, so a rewrite now would write over an uncommitted edit; commit or revert ' + safePath(budgetRel) + ' first, or name the files this change touched after the verb' };
        }
        const dirty = new Set(changed.concat(checked.pending));
        const uncommitted = moved.filter((m) => dirty.has(m.path)).map((m) => safePath(m.path));
        if (uncommitted.length > 0) {
            const shown = boundList(uncommitted);
            return { status: 'refused', detail: 'the bare form moves every cap and takes a clean tree, and files whose caps would move differ from HEAD or are not yet added to git, so a cap taken now would bake uncommitted content in; name the files this change touched after the verb instead: '
                + shown.shown.join(', ') + (shown.omitted ? '; ' + boundNotice('uncommitted file', shown.omitted) : '') };
        }
    }
    if (named !== null) {
        for (const rel of Array.from(named).sort()) {
            if (!Object.prototype.hasOwnProperty.call(budget, rel)) {
                next[rel] = measuredByPath.get(rel).size;
                added.push({ path: rel, to: next[rel] });
            }
        }
    }
    const unlisted = checked.measured
        .filter((m) => m.size !== null && !Object.prototype.hasOwnProperty.call(budget, m.path) && (named === null || !named.has(m.path)))
        .map((m) => m.path)
        .sort();
    // A file's own over-cap answers to the named set the ordinary way: it is
    // still over only where it was left out of a named move. The corpus cap's
    // is over wherever it was left alone, bare sync included, since a bare sync
    // never moves it and a corpus over its cap must still say so.
    const stillOver = checked.failures
        .filter((f) => (f.reason === REASONS.OVER_CAP && named !== null && !named.has(f.path))
            || (f.reason === REASONS.CORPUS_OVER_CAP && (named === null || !named.has(f.path))))
        .map((f) => ({ path: f.path, size: f.size, cap: f.cap }));
    if (moved.length > 0 || added.length > 0) {
        let ordered = next;
        if (added.length > 0) {
            // The existing keys keep the file's order; each added key goes before the
            // first existing key that sorts after it, so a sorted file stays sorted
            // and any other order is left as its author kept it.
            const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
            const pending = added.map((a) => a.path).sort(cmp);
            const addedSet = new Set(pending);
            ordered = Object.create(null);
            for (const key of Object.keys(next)) {
                if (addedSet.has(key)) continue;
                while (pending.length > 0 && cmp(pending[0], key) < 0) {
                    const k = pending.shift();
                    ordered[k] = next[k];
                }
                ordered[key] = next[key];
            }
            for (const k of pending) ordered[k] = next[k];
        }
        const eol = res.text.includes('\r\n') ? '\r\n' : res.text.includes('\n') ? '\n' : '\r\n';
        const indentMatch = res.text.match(/\n([ \t]+)"/);
        const data = serializeBudget(ordered, eol, indentMatch ? indentMatch[1] : 4);
        const tmp = target + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
        try {
            fs.writeFileSync(tmp, data, { encoding: 'utf8', flag: 'wx' });
        } catch (err) {
            if (err && err.code === 'EEXIST') {
                return { status: 'refused', detail: 'a temporary file already sits at ' + safePath(tmp) + ', left by another run or a dead one and not this run\'s to delete; remove it and run again' };
            }
            throw err;
        }
        try {
            fs.renameSync(tmp, target);
        } catch (err) {
            try { fs.unlinkSync(tmp); } catch { /* the rename may already have consumed it */ }
            throw err;
        }
    }
    return { status: 'ok', moved, added, unchanged, outside, named: named !== null, unlisted, stillOver };
}

// A directory's real path, or the spelling given where the filesystem will not
// resolve it, for a relative spelling taken against a path that is already real.
function realPathOr(dir) {
    try {
        return fs.realpathSync(dir);
    } catch {
        return dir;
    }
}

// The budget as check() validated it against the budget as this run read it:
// the same keys carrying the same caps, in any order.
function sameBudget(a, b) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && b[key] === a[key]);
}

const USAGE = [
    'usage: node kit-size.js <check|report|init|sync> [--repo <dir>] [--budget <file>] [<path>|corpus-cap ...]',
    '  check   every classified file against its cap, plus the coverage control (exit 1 on any failure)',
    '  report  one line per file whose size moved since HEAD, plus every untracked file under a measured root and every tracked path the pathspec listing missed, then totals',
    '  init    write the budget from current sizes, refusing an existing one',
    '  sync    move every existing cap to its file\'s current size, in both directions, over a clean tree, or only the caps of the paths named after it, adding a first cap for a named path the budget lacks, tracked or not yet added; an unnamed measured path the budget lacks is named, never added, and the run exits 1'
].join('\n');

// Nothing past the verb is ignored. A flag whose value is missing or is itself
// another flag, a token that looks like a flag and is not one of the two, and a
// second bare argument under any verb but sync, which takes paths after it, are
// all refusals rather than a fall-back to the default
// subject: a reading silently taken against this checkout while the operator
// believes they named another repository is a wrong-subject figure with no signal,
// and this output gets quoted into durable records. The unknown-flag refusal is
// what covers `--repo=<dir>`, the likely spelling, and a flag a newer caller
// passes to an older copy of this script: both would otherwise measure the default
// repository with nothing in the output naming the subject.
//
// A repeated `--repo` or `--budget` is refused too, on the same ground: with the
// last value silently winning, a call naming two repositories reads one of them
// and says nothing about the other, which is the wrong-subject figure the three
// refusals above exist to stop, arriving through a token the parser did
// understand.
//
// `invalid` names the offending token and `invalidReason` says which refusal
// fired, so the message a reader gets is about their actual mistake.
function parseArgs(argv) {
    const args = { verb: null, repo: null, budget: null, paths: [], invalid: null, invalidReason: null };
    const refuse = (token, reason) => {
        args.invalid = token;
        args.invalidReason = reason;
        return args;
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--repo' || a === '--budget') {
            const value = argv[i + 1];
            if (value === undefined || value === '' || value.startsWith('-')) {
                return refuse(a, 'no-value');
            }
            if (a === '--repo' ? args.repo !== null : args.budget !== null) {
                return refuse(a, 'repeated-flag');
            }
            if (a === '--repo') args.repo = value;
            else args.budget = value;
            i += 1;
            continue;
        }
        if (a.startsWith('-')) return refuse(a, 'unknown-flag');
        if (args.verb === null) args.verb = a;
        else if (args.verb === 'sync') args.paths.push(a);
        else return refuse(a, 'extra-argument');
    }
    return args;
}

// The refusal a reader sees for each of parseArgs' four reasons.
function invalidMessage(args) {
    if (args.invalidReason === 'repeated-flag') {
        return safePath(args.invalid) + ' is given more than once, and this tool takes one value for it: a second one would silently win and the reading would be about a subject the call also named and did not read';
    }
    if (args.invalidReason === 'unknown-flag') {
        return safePath(args.invalid) + ' is not a flag this tool takes; only --repo and --budget are, each with a separate value';
    }
    if (args.invalidReason === 'extra-argument') {
        return safePath(args.invalid) + ' is a second bare argument, and this tool takes one verb; only sync takes paths after it';
    }
    return safePath(args.invalid) + ' needs a value';
}

// Exit codes: 0 for a reading that came back clean, 1 for a ratchet failure,
// and 2 for a run that could not produce a reading at all (the hooks library the
// require did not return, git silent, the budget missing or outside the checkout or
// listing a path twice or holding no cap at all, a corpus with nothing in it under
// either reading verb or under init or sync, no verb, an unknown verb, a flag with no value, a flag
// given twice, an unknown flag, a second bare argument, a --repo that is not a
// repository top level, a reading that measured nothing, an init that refused). A
// git failure never becomes a zero-size reading, because a zero passes every cap,
// and neither does an empty corpus, under either reading verb. Exit 1 is the
// ratchet's own, and sync returns it where the budget it leaves still fails
// check: a measured tracked path with no cap, or an entry outside the named set
// still over its cap, so the code never says a red budget is green; any other
// failure check reports under sync is a refusal at exit 2 rather than a rewrite.
function main() {
    if (libs === null) {
        process.stderr.write('kit-size: ' + libsDetail + '\n');
        process.exitCode = 2;
        return;
    }
    // The refusals an argument earns, through the channel's own renderer. They
    // are composed before the repository is resolved, so the rule that spells a
    // path relative to it has nothing to answer against yet, and a token a
    // caller passed can be an absolute path under the home directory: an
    // unknown flag and a mistyped verb are printed back as they were written,
    // and this output is read by a model. `libs` is bound wherever this runs,
    // the one refusal composed without it having returned above.
    const refuseArg = (text) => process.stderr.write('kit-size: ' + libs.scrub(text) + '\n');
    const args = parseArgs(process.argv.slice(2));
    if (args.invalid !== null) {
        refuseArg(invalidMessage(args) + '\n' + USAGE);
        process.exitCode = 2;
        return;
    }
    // The verb is named in its refusal, like every argument refusal above: a bare
    // usage block tells a reader what the tool takes and not which of their tokens
    // it would not take, and a typo and a forgotten verb are different mistakes.
    if (args.verb === null) {
        refuseArg('no verb was given, and this tool takes one of check, report, init or sync\n' + USAGE);
        process.exitCode = 2;
        return;
    }
    if (args.verb !== 'check' && args.verb !== 'report' && args.verb !== 'init' && args.verb !== 'sync') {
        refuseArg(safePath(args.verb) + ' is not a verb this tool takes; only check, report, init and sync are\n' + USAGE);
        process.exitCode = 2;
        return;
    }
    const repoDir = args.repo ? path.resolve(args.repo) : defaultRepoDir();
    const budgetFile = args.budget ? path.resolve(args.budget) : path.join(repoDir, BUDGET_PATH);
    // Every line written from here down goes through one screen, so a path inside the
    // repository is spelled relative to it wherever it was assembled: the refusals and
    // details below are built in a dozen places and each of them would otherwise have
    // to remember the rule for itself. The repository's own top level has no relative
    // spelling and comes through as it stands, which is what the subject line and the
    // git-failure details print.
    // And through the channel's own renderer after it, which takes the OS
    // account name out of whatever is left absolute: the repository's own top
    // level has no relative spelling, and a path outside the repository has none
    // that means anything, so those two reach this line home-anchored on the
    // ordinary layout and this output is read by a model. `libs` is bound
    // wherever these run, the one refusal composed without it returning above.
    const shown = (text) => libs.scrub(repoRelativeText(repoDir, text));
    const out = (text) => process.stdout.write(shown(text) + '\n');
    const refuse = (text) => process.stderr.write('kit-size: ' + shown(text) + '\n');
    // A --repo naming anything but a repository's top level is refused. Git
    // resolves this tool's relative pathspecs and its own output paths against the
    // directory it is pointed at, so a subdirectory yields a reading whose corpus
    // is silently a subset and whose paths do not match a single budget key, with
    // nothing in the output saying so. The refusal fires only where git answered
    // the question: where it could not, the collector's own git failure is the
    // honest reason, since a directory that is no repository at all is not a
    // wrong-level one.
    if (args.repo !== null) {
        const top = repoTopLevel(repoDir);
        if (top !== null && !samePath(top, repoDir)) {
            refuse('--repo ' + safePath(repoDir)
                + ' is not a repository top level; git reports the top level as ' + safePath(top)
                + ', and a reading taken below it measures a subset of the corpus against keys that do not match it');
            process.exitCode = 2;
            return;
        }
    }
    // Containment binds the default budget path, which sits inside the repository
    // under measurement, and not one the operator named for a reading: a budget
    // elsewhere is a subject they chose, while a symlink at the default path would
    // silently source every cap from outside the reviewed checkout. The two write
    // verbs take containment against the repository whatever --budget says, because
    // a write is not a reading: initBudget's own comment carries that reasoning, and
    // sync follows it.
    const writes = args.verb === 'init' || args.verb === 'sync';
    const containRoot = args.budget && !writes ? null : repoDir;
    let result;
    try {
        if (args.verb === 'check') result = check(repoDir, budgetFile, containRoot);
        else if (args.verb === 'report') result = report(repoDir, budgetFile, containRoot);
        else if (args.verb === 'sync') result = sync(repoDir, budgetFile, containRoot, args.paths);
        else result = initBudget(repoDir, budgetFile, containRoot);
    } catch (err) {
        // Screened like every other path this tool prints, and this channel needs it:
        // a write error's own text embeds the absolute target path the OS reported,
        // and initBudget rethrows one. The screen runs per whitespace-separated token
        // rather than over the sentence, because its length cap would otherwise fall
        // on the sentence and cut a refusal's list of paths off mid-way: the
        // duplicate-key refusal is a list of repeated keys, and truncated it names
        // some of the repeats and hides the rest.
        refuse(String((err && err.message) || err).split(' ').map(safePath).join(' '));
        process.exitCode = 2;
        return;
    }
    if (result.status === 'git-failed' || result.status === 'refused' || result.status === 'unmeasured') {
        refuse(result.detail);
        process.exitCode = 2;
        return;
    }
    if (args.verb === 'init') {
        out('wrote ' + result.count + ' caps to ' + safePath(budgetFile));
        return;
    }
    // The subject line, which the reading verbs and sync print first. Without it a reading
    // says what it measured and never which repository it measured, and the default
    // subject is derived from where this script sits: under a marketplace install
    // that is the marketplace's own clone of this repository, so a call with no
    // --repo there finds a budget and a corpus and prints a plausible green reading
    // about a tree nobody asked about. The four argument refusals above exist for
    // that same wrong-subject failure, and they cannot see this one.
    //
    // What it names is the top level's own directory name rather than its path,
    // because this line goes where every other line of this reading goes: a fenced
    // block inside a tracked plan doc. A path there carries the layout it was read
    // from, and the operator's account name sits in that layout on the default one,
    // so the rule for this channel is that no line of a reading carries a path
    // rooted outside the repository. A directory name identifies the subject, which
    // is all the line is for. A repository sitting at a filesystem root has no
    // directory name and is named by the root itself, which carries no account name
    // either.
    out('repository: ' + safePath(path.basename(repoDir) || repoDir));
    if (args.verb === 'report') {
        out(result.lines.join('\n'));
        return;
    }
    if (args.verb === 'sync') {
        const movedShown = boundList(result.moved);
        for (const m of movedShown.shown) {
            out(m.direction + ': ' + safePath(m.path) + ': ' + safePath(String(m.from)) + ' to ' + m.to);
        }
        if (movedShown.omitted) out(boundNotice('moved cap', movedShown.omitted));
        const addedShown = boundList(result.added);
        for (const a of addedShown.shown) {
            out('added: ' + safePath(a.path) + ': a first cap of ' + a.to + ', for a path named on the command line that the budget lacked');
        }
        if (addedShown.omitted) out(boundNotice('added cap', addedShown.omitted));
        out('unchanged: ' + result.unchanged + ' entries left at their current size');
        if (result.named) {
            out('outside the named paths: ' + result.outside + ' entries left as they stand');
        }
        const unlistedShown = boundList(result.unlisted);
        for (const p of unlistedShown.shown) {
            out('unlisted: ' + safePath(p) + ': tracked and measured, and the budget holds no cap for it');
        }
        if (unlistedShown.omitted) out(boundNotice('unlisted path', unlistedShown.omitted));
        const overShown = boundList(result.stillOver);
        for (const o of overShown.shown) {
            out('still over cap: ' + safePath(o.path) + ': ' + o.size + ' against a cap of ' + o.cap);
        }
        if (overShown.omitted) out(boundNotice('still-over-cap entry', overShown.omitted));
        // Where the ratchet still reds on the budget as left, the code says so: a
        // caller reading the exit code as the verdict must not take it for green.
        if (result.unlisted.length > 0) {
            out(result.unlisted.length + ' measured path' + (result.unlisted.length === 1 ? ' has' : 's have') + ' no cap, so the budget as written still fails check');
            process.exitCode = 1;
        }
        if (result.stillOver.length > 0) {
            out(result.stillOver.length + (result.stillOver.length === 1 ? ' entry is' : ' entries are') + ' still over ' + (result.stillOver.length === 1 ? 'its' : 'their') + ' cap, so the budget as written still fails check');
            process.exitCode = 1;
        }
        return;
    }
    for (const f of result.failures) {
        out(f.reason + ': ' + safePath(f.path) + ': ' + f.detail);
    }
    const pendingSize = new Map((result.pendingMeasured || []).map((m) => [m.path, m]));
    for (const p of result.pending) {
        const m = pendingSize.get(p);
        const size = !m || m.size === null ? 'its worktree content is unreadable' : m.size + ' ' + m.metric;
        out('pending: ' + safePath(p) + ': a cap whose file git reports as untracked under a measured root, held to its cap from worktree content: ' + size);
    }
    out(renderTotals(result.totals).join('\n'));
    if (result.status !== 'ok') process.exitCode = 1;
}

module.exports = {
    ROOTS,
    EXCLUSIONS,
    BUDGET_PATH,
    CORPUS_CAP_KEY,
    isCorpusPath,
    corpusSum,
    corpusCapFailure,
    MAX_FILE_BYTES,
    MAX_BUDGET_BYTES,
    MAX_REPORT_ROWS,
    REASONS,
    safePath,
    repoRelative,
    repoRelativeText,
    boundList,
    boundNotice,
    defaultRepoDir,
    rootHolds,
    classify,
    repoTopLevel,
    samePath,
    stripFrontmatter,
    wordCount,
    lineCount,
    testCount,
    measure,
    evaluate,
    unmeasuredRefusal,
    untrackedMeasuredPaths,
    loadBudget,
    budgetKeysInText,
    trackedPaths,
    allTrackedPaths,
    pathspecBlind,
    untrackedPaths,
    readWorktree,
    collect,
    totals,
    pendingEntries,
    check,
    changedPaths,
    outsideRootCounts,
    headSize,
    reportRows,
    deletedHeadNote,
    renderTotals,
    renderReport,
    untrackedRows,
    report,
    parseArgs,
    invalidMessage,
    budgetFrom,
    serializeBudget,
    sameBudget,
    initBudget,
    sync
};

if (require.main === module) main();
