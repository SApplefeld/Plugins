// Shared library for the compaction gate's release markers, its decision
// record, and the transcript reading its consumers share.
//
// The release markers are two small JSON files: the role-boundary marker, one
// per session under the machine-local root roleBoundaryRoot resolves below,
// and the operator-consent marker, one per project in the scratch directory
// kitScratchDir resolves. Each is the signal between two programs that must
// agree on its path and shape: the checkpoint CLI (kit-compact-checkpoint.js)
// and the seat-stop hook write them, and the PreCompact gate
// (kit-compact-gate.js) reads them to decide whether a pending auto-compaction
// may land, consuming (deleting) the one that released it. Single-sourcing the
// paths, the read/write/clear operations, and the match rule (markerMatches,
// with its age constants) here is what keeps the writers, the gate, and the
// status report from drifting apart.
//
// The gate's decision record is three project-local files in that same
// resolved scratch directory (the state compact-gate.json, its append-only
// compact-gate.jsonl log, and the deferral nudge's per-session hold stamps in
// compact-hold-nudge.json), and they are here for the same single-sourcing
// reason: the gate writes, the deferral nudge writes and reads, and the
// checkpoint CLI's status report reads, so the paths and the shapes belong in
// one place. The section header over that record below carries the file-by-file
// account of which writer touches which.
//
// The transcript helpers (readTranscriptCapped, stripLocalCommandOutput, and
// the automation detection) live here because the gate's automation scan and
// the marker moment rule both read transcript text, and both must neutralize
// local-command echoes and harness-injected lines the same way, so two
// near-duplicate copies of those semantics would drift apart.
//
// Node core modules only, CommonJS, zero third-party dependencies. Every exported function
// that touches the filesystem is wrapped so it never throws: a filesystem
// hiccup degrades to a null/refusal result instead of trapping the caller,
// matching kit-plan-lib.js.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathErrnoClass, findTranscript } = require('./kit-plan-lib.js');
// The share screen every home-anchored path the kit opens takes: a home spelled
// as a network share blocks a synchronous open for the SMB timeout, so the
// role-boundary root below refuses one before any read or write reaches it.
const { namesNetworkShare } = require('./kit-network-lib.js');
// Three shared reads from kit-read-lib. The gate-log tail read below takes
// readFully because a single readSync may legally return fewer bytes than asked
// for, and the fill loop that closes it belongs to every hook read rather than
// to this one. The hold-stamp read takes readFileBounded, which settles a
// file's kind and size on the OPEN DESCRIPTOR: judging a name and then opening
// it leaves a window a local process can swap the path inside, and off win32
// the open is non-blocking, so a FIFO planted there is refused rather than
// waiting for a writer that never comes. The marker directory's listing and
// sweep take listBoundedNames, which reads a directory incrementally: readdirSync
// materializes the whole of it before the first entry can be judged, so a cap on
// the loop alone bounds what is kept and nothing about what was read.
const { readFully, readFileBounded, listBoundedNames } = require('./kit-read-lib.js');

// The directory every project-scoped file in this library lives in, for a
// given project directory; the role-boundary marker is the one file here that
// is not project-scoped, and roleBoundaryRoot resolves it. Two branches, and the second exists because one project
// directory the kit itself creates is inside a replicated tree.
//
// Ordinarily the answer is the project's own `.kit/`, gitignored territory
// beside the work it describes. But the memory store at ~/.claude is a git
// repository the sync pushes to a remote that reaches every machine, and a
// seat whose project directory is the store's coordinator directory would
// otherwise drop its gate state, its journal, and its consent marker into that
// replicated tree. None of these files is meaningful on another machine: they
// name a session id, a local plan path, and a local clock, and a journal that
// replicates carries one box's decisions into every other box's copy. So a
// project directory lying inside the store resolves instead to a home-
// anchored directory outside it, which nothing syncs, keeping the store-
// relative shape below it so two store-backed project directories cannot
// collide.
//
// The store root is the home directory's .claude, read at call time so a
// fixture home redirects it. One resolver serves every writer here and the
// gate's own reader, which is what keeps a marker's writer and its reader
// agreeing on where it lives.
function kitScratchDir(cwd) {
    const storeRoot = path.join(os.homedir(), '.claude');
    const rel = path.relative(storeRoot, path.resolve(cwd));
    const underStore = !path.isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel);
    return underStore
        ? path.join(os.homedir(), '.kit', 'store', rel)
        : path.join(cwd, '.kit');
}

// The checkpoint CLI as a command a model-facing text can tell a session to
// run. The deferral nudge's hold directive composes it, and the renderer stays
// here rather than in that hook so a second composer takes the same guards.
// This file ships as a plugin and runs in every project, so a repo-relative
// path would resolve only where the kit is dogfooded in its own checkout;
// __dirname is this module's installed location, never a payload, transcript,
// or repo value. Forward slashes because node accepts them on Windows and a
// backslash path does not survive every shell.
//
// It is read from __dirname rather than from CLAUDE_PLUGIN_ROOT the way the
// version nudge and the doctrine refresh read theirs: those two print a
// diagnostic about the plugin the harness says is loaded, while this value
// hands over a line to execute, and an environment value can name a directory
// this module was never installed in. The grammar below refuses
// metacharacters, not a wrong directory.
//
// Provenance is not the whole answer here, and this is where this note
// departs from the identically built one in kit-compact-gate.js: that one
// reaches the operator's stderr, while this one lands in the model's context
// as a command to run. Double quotes do not neutralize $(...) or backticks,
// both of which are legal in a POSIX directory name, so an install path
// carrying either would compose a line that executes something else when
// run. The repo's own precedent is to gate a composed runnable command rather
// than rest on the sanitizer around it (the doctor's git branch -m remedy,
// docs/security-model.md). So the path is held to a conservative grammar, and
// where it fails, the command clause is dropped and the rest of the text
// still ships: the session is told what to do in prose and can find the CLI
// itself.
//
// The grammar is not the whole of what this value takes on its way out.
// __dirname on an installed kit is home-anchored, so the account name in it is
// elided before the path is rendered, at commandClausePath below, which also
// owns the second reading that drops the clause.
const CHECKPOINT_CLI = __dirname.split('\\').join('/') + '/kit-compact-checkpoint.js';

// The grammar: letters, digits, space, and the punctuation a real install path
// needs (dot, dash, underscore, colon for a drive letter, forward slash, tilde
// for an 8.3 short name, parentheses for "Program Files (x86)", plus). Every
// metacharacter that survives double-quoting is outside it, the dollar sign and
// the backtick above all, and so is every non-ASCII byte; the path renders
// inside double quotes, where the parentheses, tilde and space this admits are
// inert. The length is bounded so no pathological path reaches the context.
//
// Its subject is the part of the rendered command composed out of a VALUE. The
// `$HOME` reference commandClausePath puts in front of a home-anchored install
// path is this file's own fixed text rather than anything read from anywhere, so
// holding it to a grammar that refuses a dollar sign would be refusing the
// guard's own output.
const SAFE_CLI_PATH = /^[A-Za-z0-9 _.:/~()+-]{1,256}$/;

function safeCommandPath(cliPath) {
    return typeof cliPath === 'string' && SAFE_CLI_PATH.test(cliPath);
}

// The installed CLI as the text of a runnable command, or null where no such
// text can be composed and the caller falls back to naming the tool in prose.
//
// The home prefix is elided because an installed kit lives under
// ~/.claude/plugins/cache/, so the composed command carries the OS account name
// into the model's context on every fire otherwise. That is the floor the
// checkpoint CLI this command names holds its own output to, and this is a
// second producer on the same channel: the grammar above is a metacharacter
// screen rather than an elision and admits an account name in full.
//
// The elision is `$HOME` rather than `~` because a rendered clause promises a
// line to RUN. The composed line, run in either the POSIX shell or PowerShell a
// seat has in front of it, reaches the directory os.homedir() names, while a
// tilde inside double quotes is expanded by neither shell and would hand over a
// command that cannot work.
// Containment is decided by path.relative, on components rather than characters
// and case-insensitively on win32, which is how the checkpoint CLI's own display
// guard decides the same question.
//
// The grammar then runs over the TAIL alone, which is the whole of what is
// composed here out of a value. A home directory carrying a metacharacter
// therefore renders a safe command rather than dropping the clause, the elision
// having already taken that text out of the line.
//
// A home directory that cannot be read at all answers null and drops the clause.
// "This path is not under the home directory" and "no home directory is
// knowable" are different facts, and only the first licenses printing an
// absolute path into this channel; the prose fallback costs the reader a lookup
// and costs nobody an account name.
function commandClausePath(cliPath) {
    if (typeof cliPath !== 'string' || cliPath === '') return null;
    let home = '';
    try { home = os.homedir(); } catch { home = ''; }
    if (typeof home !== 'string' || home === '') return null;
    let tail = cliPath;
    let prefix = '';
    if (path.isAbsolute(cliPath)) {
        const rel = path.relative(home, cliPath);
        if (path.isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) {
            // Somewhere else on disk, so the path carries no home prefix and is
            // rendered as itself.
        } else if (rel === '') {
            // The CLI path IS the home directory, which no install produces;
            // there is no tail to render and nothing worth guessing at.
            return null;
        } else {
            prefix = '$HOME/';
            tail = rel.split('\\').join('/');
        }
    }
    return safeCommandPath(tail) ? prefix + tail : null;
}

// The one shared renderer for a checkpoint-CLI command mention. Given VERB
// ('status' or 'boundary') and an optional CLIPATH (defaulting to
// CHECKPOINT_CLI, so a test can inject a fixed path), it renders the runnable
// clause `node "<path>" <verb>` where the path passes commandClausePath's
// screen, or, where it does not, a prose clause naming the file and the verb
// that carries no home-anchored or refused text. Every caller composes its
// own sentence around the returned clause; none of them holds a copy of
// either wording, so a reword of the fallback prose or the runnable shape
// changes every call site at once.
function checkpointCliClause(verb, cliPath) {
    const target = (cliPath === undefined) ? CHECKPOINT_CLI : cliPath;
    const shown = commandClausePath(target);
    if (shown !== null) {
        return { clause: 'node "' + shown + '" ' + verb, runnable: true };
    }
    return {
        clause: "the kit's kit-compact-checkpoint.js with the " + verb + ' argument',
        runnable: false
    };
}

// Create DIR, a scratch directory a caller has already resolved (kitScratchDir's
// own return, or the parent of a file it names), and write DIR/.gitignore
// naming every file under it ignored, attempting the marker on every call so a
// DIR that already exists without one gains it on whichever caller reaches this
// first. A host repository's own .gitignore need not name the directory, and
// the scratch files a caller writes into DIR, a plan path, a session id, a
// nudge log entry, would otherwise ship as tracked content there.
//
// The recursive create is left to throw: every caller wraps this call in the
// error handling its write needs, so a create failure reaches that handling
// exactly as a create made at the call site would.
//
// The directory is re-screened by lstat after the create, because a recursive
// create walks through an existing symlinked parent rather than refusing it: a
// DIR whose final component is a link earns no marker, since the marker would
// then land wherever the link points. A link at an earlier component is not
// screened here, and the caller's own writes follow it the same way.
// Only a real directory earns the write; a symlink, a junction, or anything
// lstat cannot classify returns false with no attempted write, and the caller's
// own write proceeds or refuses on its own screens, whether or not the marker
// lands.
//
// The marker write is an exclusive create and best-effort: an existing file,
// marker or not, is left exactly as it stands. A write that fails after the
// create removes the empty file, so the next call tries again rather than
// finding a marker that ignores nothing.
function ensureScratchDirIgnored(dir) {
    fs.mkdirSync(dir, { recursive: true });
    let st;
    try {
        st = fs.lstatSync(dir);
    } catch {
        return false;
    }
    if (!st.isDirectory()) return false;
    const marker = path.join(dir, '.gitignore');
    let fd;
    try {
        fd = fs.openSync(marker, 'wx');
    } catch {
        return true; /* already there, or the create failed: best-effort */
    }
    try {
        fs.writeSync(fd, '*\n');
        fs.closeSync(fd);
    } catch {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        try { fs.unlinkSync(marker); } catch { /* best-effort */ }
    }
    return true;
}

// Make sure the project directory CWD's own scratch directory exists, marked
// ignored, and never throw. The role-boundary marker lives under the home
// rather than under the project, so its writers no longer create the project's
// scratch directory as a side effect of writing it, and the gate records a
// decision only where that directory already exists
// (gateScratchTarget below). Without this a fresh linked worktree recorded no
// deny-interactive and the deferral nudge's hold directive, which reads that
// record, never fired there. The two marker writers that stand in a project
// (the boundary verb from its shell's directory, the seat-stop hook from its
// payload's cwd) call this after the marker write, so the marker's own
// success never turns on it.
function ensureProjectScratchDir(cwd) {
    try {
        if (typeof cwd !== 'string' || cwd === '' || namesNetworkShare(cwd)) return false;
        return ensureScratchDirIgnored(kitScratchDir(cwd));
    } catch {
        return false;
    }
}

// Skew allowance for a stored timestamp that sits in the future: a marker's
// writtenAt, a hold record's at, a hold stamp's nudgedAt. A small clock
// adjustment between the write and the read is tolerated, but a far-future
// timestamp is treated as illegible rather than honored, so a clock change can
// never mint an effectively immortal record. One constant for every reader
// here and for kit-registry-stamp.js, which holds the registry's own stamps to
// the same allowance.
const CHECKPOINT_FUTURE_SKEW_MS = 2 * 60 * 1000;

// Compare two session ids as opaque, case-insensitive strings (session UUIDs
// are surfaced in mixed case across the harness). One rule for every surface
// that has to agree on session identity, rather than a list of them: the
// marker match rule, the PreCompact gate's landing sweep, the checkpoint CLI's
// marker verbs, and the per-session lookups behind the deferral nudge's hold
// path (interactiveHoldOpen and the hold stamps). False when either side is
// missing, which is exactly the treat-as-absent handling a record carrying no
// session needs.
//
// Every one of those compares a value a WRITER here stored, and each of those
// writers stores it through gateText, so a caller looking a session up in one of
// these files passes the id through gateText first: this rule decides case and
// whitespace, and that one decides the spelling.
function sameSessionId(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// The size of the REGULAR file at this path: 0 when nothing is there, and null
// when the path cannot be safely written through, either because something
// other than a regular file is sitting on it (a symlink or junction, a
// directory, a FIFO) or because its kind could not be determined at all. The
// check is an lstat, so a link is judged as a link rather than as whatever it
// points at.
//
// Only ENOENT reads as "nothing there, go ahead". Every other lstat failure
// (EACCES, EPERM, EBUSY: a permission, a lock, a scanner holding the file) is
// an unknown answer, and answering an unknown with the go-ahead value is the
// mistake readGateStateResult exists to avoid. Every caller decides what an
// unknown means for itself: endsOnLineBoundary turns this null into false, its
// own fail-safe, so a transient failure yields a spare blank line rather than
// the fused record a go-ahead answer would produce.
function regularFileSize(target) {
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        return (err && err.code === 'ENOENT') ? 0 : null;
    }
    return st.isFile() ? st.size : null;
}

// The temporary path an atomic write renames from, shared by every writer in
// this file. The pid keeps two writers off one name; the random suffix keeps
// the name from being predictable, because a link pre-planted at a guessable
// tmp path would be followed by the write that creates it. The exclusive flag
// each caller passes at the open is the actual defense (a pre-planted path
// fails the create outright); the unguessable name is what keeps an attacker
// from winning that race repeatedly.
//
// The unguessable name carries a second property, and it is load-bearing: the
// writers unlink their tmp on failure, so a name an attacker could predict
// would let them aim that unlink at a file of their choosing inside .kit/.
// Each writer therefore gates its cleanup on whether its own exclusive create
// returned, not on the errno of whatever failed: a create refused because the
// path was occupied deletes nothing, while every failure after a create that
// did return removes the file this writer made. Reading an errno instead would
// rest on a platform mapping, and a post-create failure reporting EEXIST would
// leak the temp file. The two defenses are independent: making this name
// predictable again, for testability or anything else, reopens an aimed delete
// that nothing else here would catch.
function atomicTmpPath(target) {
    return target + '.tmp.' + process.pid + '.' + crypto.randomBytes(6).toString('hex');
}

// ---------------------------------------------------------------------------
// The gate's decision record.
//
// The PreCompact gate takes a verdict on every auto-compaction offer and, until
// it writes one down, leaves no trace: a session held for an hour and a
// safety-valve fire are indistinguishable afterwards. Three project-local
// files under .kit/ carry that record. The STATE (compact-gate.json) is the
// newest decision, the newest allow, and the per-session list of interactive
// holds; it is rewritten in place, so it stays one small file. Its readers are
// not one set: the checkpoint CLI's status report reads the decision, while
// the per-session hold list is the deferral nudge's alone, since the question
// it answers is whether ONE session is being held and status asks about the
// project. The LOG (compact-gate.jsonl) is append-only and is what an operator
// reads to answer "how often, and why" across a whole run. The HOLD STAMPS
// (compact-hold-nudge.json) are the deferral nudge's own per-session clock,
// which cannot live in the state because every gate write rebuilds that file
// from a fixed key set (see HOLD_NUDGE_MAX_ENTRIES); the status report reads
// that file too, but only to say when it is refusing the nudge's writer, which
// is a state nothing else surfaces.
//
// The writers are not evenly spread across the three, and the log carries TWO
// record classes. The state has one writer: the gate records a decision
// (recordGateDecision, from the PreCompact hook). The stamp file has one,
// recordHoldNudge, from the tool loop. The log has two, since the nudge
// journals that it spoke through logHoldNudge beside the decision recorder's
// own append. A decision line carries `verdict` and a nudge line carries
// `event`, which is how a reader partitions the log without guessing. A
// consumer folding every line through gateRecord() sees only decisions, since
// that rebuilder returns null for a record with no recognized verdict: that is a
// correct decision-only reading, not a whole-log one.
//
// All three files are written after the verdict, or after the emission decision,
// is already made, and a failure to write cannot change it. recordGateDecision
// swallows every failure and returns nothing a caller branches on, so a full
// disk or a read-only .kit degrades to a gate that decides exactly as it did
// before, silently. The nudge stamp is the exception and it is deliberate: a
// stamp is not diagnostic, it IS the interval, and it is the only cross-process
// carrier that interval has, so recordHoldNudge returns a boolean its caller
// gates the emission on, and a failed stamp yields silence. The journal line
// stays diagnostic on every writer. The ordering matters as much as the
// swallowing: a path that could block (a FIFO planted at any of them) cannot
// delay a verdict that has already been emitted.
//
// The record is written only in a project that is ALREADY kit-governed. An
// existing .kit/ directory is the evidence: the gate runs on every
// auto-compaction offer on the machine, including in repositories that have
// nothing to do with the kit, and creating an untracked directory of session
// ids and token readings in someone's unrelated checkout is a cost the
// diagnostic does not earn. What makes a project kit-governed is a marker
// write: the boundary verb and the seat-stop hook each ensure the project's
// own scratch directory after writing their marker (ensureProjectScratchDir
// above), so a session that has declared or banked a boundary in a project is
// recorded there from then on, and a stranger's checkout gets nothing.
//
// All three files must be regular files, and .kit/ itself must be a real
// directory rather than a link to one. A symlink, junction, or FIFO planted at
// any of those four paths is never followed: appending through a link writes
// into its target on every assistant turn, trimming through one lands a
// megabyte of an arbitrary readable file inside .kit/, and a FIFO blocks a read
// or a write forever where no try/catch can rescue it. Each check is an lstat,
// so a link is judged as a link rather than as whatever it points at.
//
// Three of the four paths REFUSE on that verdict and the hold stamps REMOVE the
// path instead, which is a difference in what a refusal costs rather than in
// what is judged. The gate state, the log and .kit/ itself are written by the
// decision recorder, whose refusal is a diagnostic line not written, and they
// are read by surfaces that report absence honestly. The stamp file IS an
// interval: refusing it silences a held session's directive, and neither a link
// nor an oversized file ever resolves on its own, so a writer that only refused
// would disable that interval permanently. Since neither shape is one that
// writer can produce, neither holds a stamp to preserve, and the path is
// unlinked before the write (recordHoldNudge). The readings that MIGHT sit over
// a real list all refuse there exactly as they do here: a refused read, an lstat
// that could not answer, and a read that ended short of what the descriptor
// promised, which is a fault under the read rather than a shape, and so says
// nothing about whose file it is. The hold stamps are read through the shared
// bounded reader, which settles kind and size on the descriptor and follows a
// link only when a caller does not ask otherwise, and that reader's caller here
// asks BOTH ways: an lstat first, which is what makes a link a distinguishable
// answer rather than one more unreadable file, and the reader's own opt-in
// refusal, which closes the window between that lstat and the open
// (readHoldNudgesResult).
//
// A HARDLINK is the member of that class these checks admit: it is a regular
// file and passes every lstat above. What a planted one then RECEIVES is a
// question about the WRITER rather than about the check, and the four paths do
// not answer it alike. .kit/ itself is not of the class at all, since no
// hardlink to a directory can be created. The state and the hold stamps are
// published by writeJsonAtomic, which writes a temp file and renames it over
// the name: a rename replaces the directory entry, so a hardlink planted at
// either path is orphaned by the first write and goes on holding whatever it
// was linked to. The LOG is the one path a write reaches through an existing
// inode, since the decision recorder and logHoldNudge both append to the
// name in place, so a hardlink there receives every record appended until the
// log next crosses GATE_LOG_MAX_BYTES and trimGateLog renames a rebuilt file
// over it, which orphans the link exactly as the other two writers do. That one
// path is left open on purpose, and the exposure is bounded by what lands
// there: this
// library's own JSONL decision and nudge lines, in a project the actor can
// already write to.
//
// Those checks NARROW the window rather than closing it, the same honest
// account readTranscriptCapped gives of its own isFile() check: the path is
// re-resolved by the open that follows, so a swap landing between the two is
// still possible. Closing it needs a single open plus an fstat on the
// descriptor, a restructure this diagnostic does not earn, and what rides
// through the residual window is well-formed JSON appended to a path the actor
// already controls. The writers that publish through a temporary file, which is
// writeJsonAtomic for the state, the hold stamps and the markers
// and trimGateLog for the rebuilt log, create that temporary exclusively
// (O_EXCL) under an unpredictable name, so the one path an attacker could
// otherwise pre-plant is not guessable and would fail the open anyway. The two
// log APPENDERS go through no temporary file at all, the decision recorder and
// logHoldNudge both reaching the log's name in place: what an attacker can
// pre-plant there is the log path itself, which is the hardlink exposure the
// paragraph above states and accepts rather than one this defence covers. The hold stamps' own read closes the kind half of that window rather
// than narrowing it, since the shared reader it goes through settles kind and
// size on the descriptor it consumes; what its lstat leg answers for is the link
// question alone.
//
// That acceptance now has to cover callers in the TOOL LOOP as well as the
// PreCompact one, since the nudge journals from there and a stalled tool loop
// is the one failure that hook must never cause. It still holds, on a narrower
// argument. Reaching the window needs a hostile writer already inside .kit/ in
// this project, racing a path that opens for a few microseconds per fire; the
// blocking shapes are refused by the lstat legs above; and the harness's own
// hook timeout bounds anything that does slip through, so the worst case is one
// dropped journal line or one timed-out hook process, never a wedged loop.
//
// Every value stored here that came from outside (the harness's session id, and
// a prior state file, which is user-writable
// like every other file under .kit/) is rebuilt field by field on the way in and
// on the way out, so neither a forged state file nor an odd payload can grow the
// file without bound or push control characters into an operator's terminal.
// ---------------------------------------------------------------------------

// Path to the gate's decision state for a given repo root.
function gateStatePath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-gate.json');
}

// Path to the gate's append-only decision log for a given repo root.
function gateLogPath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-gate.jsonl');
}

// The log's bound. Both record classes run a few hundred bytes or less, and
// both writers are rare: the gate fires at most once per assistant turn, and
// the nudge at most once per NUDGE_INTERVAL_MS per tool batch while a hold
// stands. Their sum is still well inside 2 MB for months of dense use; past it
// the writer keeps the newest 1 MB and drops the rest. Trimming to half the cap
// rather than to the cap itself is what keeps the rewrite rare: at a 1-byte
// margin every subsequent append would rewrite the whole file.
const GATE_LOG_MAX_BYTES = 2 * 1024 * 1024;
const GATE_LOG_KEEP_BYTES = 1 * 1024 * 1024;

// How long a session's hold stands without a new denial before a reader
// treats it as finished rather than as the hold currently in force.
//
// A hold's whole claim is about right now: "the gate is holding this
// session's offers" is what makes a nudge act. Nothing on disk marks the end
// of one, because the events that end a hold without an allow reaching this
// file leave no trace to write: a manual /compact (the PreCompact matcher is
// auto-only, so the gate never runs), a session that simply ends, an offer
// that never comes again. So the newest denial's age is the only evidence of
// whether the hold is still real, and past this window the record is history
// rather than state.
//
// The floor is the longest gap there can be between two denials of one genuine
// hold, which is one assistant turn, which is the longest tool call a session
// makes: dispatched implementer and reviewer runs have been measured at 22,
// 27, 67 and 73 minutes. Four hours clears the longest of those by better than
// three times, so no real hold is ever cut short. The ceiling is that a hold
// must not survive a break long enough to make it a different working session:
// four hours does not survive a night, a morning off, or a day spent in
// another project, where a stale hold would draw a directive to declare a
// boundary nobody is waiting on.
//
// Both release markers' windows are defined as this value outright,
// CONSENT_MAX_AGE_MS and ROLE_BOUNDARY_MAX_AGE_MS alike, so tuning this
// constant retunes two windows and not one: how long an operator-consent
// marker stays honorable, and how long a seat's declared role boundary does.
// Those are the windows in the release design bounded by code rather than
// prose; the derivations and their reasoning live at those constants.
const GATE_HOLD_MAX_IDLE_MS = 4 * 60 * 60 * 1000;

// The verdicts a record may carry, and the only values recordGateDecision
// accepts: an unrecognized verdict is not written at all, because a state file
// the CLI and the nudge read has to be legible to both.
const GATE_VERDICTS = ['allow', 'deny-interactive'];

// The reasons a record may carry: the gate clause that decided, and the two
// release reasons a marker-driven allow journals (role-boundary,
// operator-consent), which are how a session's compaction history states
// which release landed it. The vocabulary is closed and this library is the
// only thing that writes it, so a value outside it came from a hand-edited
// state file rather than from the gate. Reason reaches the CLI's status
// report, a channel a model reads, and the charset and length caps alone would
// let arbitrary prose through; checking the value against the list it is drawn
// from costs nothing and bounds it to this file's own words.
//
// gateRecord drops a reason outside the list to null, which would land a deny
// with no clause on it; the list is exported so a pin can read the gate's own
// literals and hold them against this one.
const GATE_REASONS = [
    'not-auto', 'external-engine', 'no-goal',
    'automation', 'valve', 'illegible',
    'role-boundary', 'operator-consent'
];

// A string safe to store and to print back: printable ASCII, length-capped,
// null for anything else (an empty string included, which reads as absent
// everywhere here). Applied to every string field on the way in and again on
// the way out, so a state file hand-edited between the two still cannot carry
// control characters into a terminal or megabytes into the next write.
function gateText(value) {
    if (typeof value !== 'string') return null;
    const clean = value.replace(/[^\x20-\x7E]/g, '').slice(0, 128);
    return clean === '' ? null : clean;
}

// A count safe to store and to print back: a non-negative integer, clamped.
// The clamp is what keeps the "an integer and nothing else" bound the status
// report claims: a planted consumed of 1e308 is a finite number, and
// JavaScript renders it as "1e+308", which is neither an integer nor anything
// an operator can read as a token count. A billion is past every real reading
// (tokens per context, minutes per hold) and still renders in full digits.
const GATE_COUNT_MAX = 1000000000;

function gateCount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return Math.min(Math.floor(value), GATE_COUNT_MAX);
}

// Rebuild a decision record from an arbitrary object, or null when it is not
// one. The shape is the whole contract between the gate (writer) and the CLI
// and nudge (readers): `at` when it was taken, `verdict`, `reason` naming the
// clause that decided, `consumed` the token reading behind it or null, and
// `session` the harness's id for the compacting session. A record written
// before this shape settled may carry other keys; they are dropped on the
// rebuild.
function gateRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!GATE_VERDICTS.includes(value.verdict)) return null;
    const reason = gateText(value.reason);
    return {
        at: gateText(value.at),
        verdict: value.verdict,
        reason: GATE_REASONS.includes(reason) ? reason : null,
        consumed: gateCount(value.consumed),
        session: gateText(value.session)
    };
}

// The reason an interactive deny carries: no boundary of the session's own and
// no operator release covered the offer. The list exists so the hold reader
// below and the gate's own literal are held together by a pin rather than by
// one file's spelling.
const INTERACTIVE_HOLD_REASONS = ['no-goal'];

// The gate state's third key, beside the newest decision and the newest allow:
// one record per session, newest first, of the interactive denies this
// project's gate has taken.
//
// It is a per-session list rather than a reading of the single decision slot,
// and that is forced by the slot's writers. Every gate process in a project
// writes lastDecision for every verdict it takes, so on a checkout carrying
// several sessions the seats' denies alternate in it, and a hold read from
// there is refused whenever another seat decided last. A hold is one session's
// own fact and is stored as one.
//
// The cap is a backstop against an unbounded file, and it is also the only
// bound on what the list HOLDS. The idle ceiling interactiveHoldOpen applies
// bounds the ANSWER instead: it refuses a record it has aged out and leaves
// that record in the list, and nothing rebuilds the list by age, gateHolds
// keeping whatever it reads. That is where this parts from the hold-stamp list,
// whose own reader drops a spent entry outright and whose eviction can
// therefore only ever discard one. So an eviction here can drop a record that
// is still live, wherever more sessions than the cap have taken an interactive
// deny in one project since the oldest kept one; the evicted session is then
// unheld until its own next deny, which past the compaction trigger is its next
// assistant turn: one silence rather than a false hold, which is the direction
// every failure here takes.
const INTERACTIVE_HOLD_MAX_ENTRIES = 8;

// The hold records a state carries, rebuilt: an array, newest first, holding at
// most one record per session, and empty for every unusable shape (an absent
// key, a value that is not an array, entries that are not records, and a record
// with no session to own it).
//
// The walk is bounded BY INDEX at the cap, on readHoldNudgesResult's reasoning: a
// planted array of ten thousand entries is not walked, while a bound on how
// many VALID entries are kept would let every invalid one be examined first. A
// second record for a session already kept is dropped rather than kept behind
// the first, so newest-first order is what decides which record answers for a
// session.
function gateHolds(value) {
    if (!Array.isArray(value)) return [];
    const holds = [];
    const scanned = Math.min(value.length, INTERACTIVE_HOLD_MAX_ENTRIES);
    for (let i = 0; i < scanned; i += 1) {
        const record = gateRecord(value[i]);
        if (!record || !record.session) continue;
        if (holds.some((kept) => sameSessionId(kept.session, record.session))) continue;
        holds.push(record);
    }
    return holds;
}

// The interactive hold this state shows for one session RIGHT NOW, as that
// session's own newest interactive deny, or null. A reader asking "is this
// session being held?" asks the hold list above, and asking it here rather
// than at the reader keeps the deny vocabulary and the two bounds in the file
// that writes them.
//
// Four things must hold. The record must be a deny-interactive carrying the
// hands-on reason, so every allow reads as no hold; the list carries only what
// this file wrote, and those two checks are what a hand-edited state file
// meets. It must name THIS session, which the lookup itself is, since a hold
// is only ever one session's to act on. And its timestamp is held to the
// four-hour idle ceiling and the future-skew allowance: past the trigger the
// harness re-offers every assistant turn, so a decision no newer than that is
// a finished hold rather than a standing one, and a record dated into the
// future has an age no ceiling can exceed.
//
// A state file carrying no hold list rebuilds to an empty one and answers null
// here, so the session is unheld until its own next deny records it, which past
// the trigger is its next assistant turn. Falling back to the decision slot is
// what this predicate exists not to do: that slot's newest record can belong to
// any session that took an offer in the project.
//
// The record carries no count and no start, because a deny-interactive
// aggregates nothing: what it does carry is `consumed`, the token reading
// behind the decision, which is the figure the deferral nudge's floor is read
// against.
//
// The session id is required rather than optional: every caller of this one
// is deciding whether to act, so an unusable id answers null rather than
// matching whatever the list happens to hold.
function interactiveHoldOpen(state, nowMs, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    // Compared as the record stores it: every session field in this file goes in
    // through gateText, so the lookup applies the same rule to the id it is
    // handed rather than comparing a stored spelling against a raw one
    // (holdNudgedAt states the same reasoning for the stamp file).
    const session = gateText(sessionId);
    if (!session) return null;
    const holds = state ? gateHolds(state.interactiveHolds) : [];
    const record = holds.find((entry) => sameSessionId(entry.session, session)) || null;
    if (!record) return null;
    if (record.verdict !== 'deny-interactive') return null;
    if (!INTERACTIVE_HOLD_REASONS.includes(record.reason)) return null;
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    const at = Date.parse(record.at);
    if (!Number.isFinite(at)) return null;
    if (now - at > GATE_HOLD_MAX_IDLE_MS) return null;
    if (at - now > CHECKPOINT_FUTURE_SKEW_MS) return null;
    return record;
}

// Whole minutes between an ISO timestamp and now, or null when it does not
// parse. Negative ages (a clock adjustment, a hand-edited file) floor at zero:
// every surface that reports one states it as an elapsed duration, and a
// negative duration is not a thing an operator can act on.
function wholeMinutesSince(iso, nowMs) {
    const at = typeof iso === 'string' ? Date.parse(iso) : NaN;
    if (!Number.isFinite(at)) return null;
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    return Math.max(0, Math.floor((now - at) / 60000));
}

// The state file's read cap. The writer produces a few hundred bytes and never
// grows: it holds two records and a list of hold records bounded at
// INTERACTIVE_HOLD_MAX_ENTRIES, each rebuilt field by field with capped
// strings. Anything past a quarter megabyte is not something this wrote,
// and reading it whole on a per-offer hook path is cost with nothing to gain.
const GATE_STATE_MAX_BYTES = 256 * 1024;

// Read the gate state, distinguishing a file that is not there from one that
// cannot be read right now. Returns { ok, state, reason }:
//
//   { ok: true,  state }        legible, rebuilt (state is null when the file is
//                               absent, unparseable, or not an object: none of
//                               those carries a hold to lose)
//   { ok: false, state: null }  the answer is unknown, so no caller may act as
//                               though the file were absent
//
// reason names which refusal produced an { ok: false }: 'kind' (something that is
// not a regular file), 'oversized' (past the read cap), 'unreadable' (the read
// itself was refused) or 'lstat' (the path's own kind could not be read). Every
// decision path treats the four alike; the status report does not, because the
// remedy it prints differs by leg and only one of the four is permanent. The
// reason is carried out of here rather than re-derived because it cannot be
// re-derived: an lstat run afterwards succeeds and reports an ordinary regular
// file for the 'unreadable' leg, so a reporter re-asking that way describes a
// scanner's lock as a corrupt file and tells the operator to delete the
// standing hold records.
//
// The distinction is load-bearing on the write path. A file locked by an
// indexer or an antivirus scanner (EBUSY, EPERM) is not an absent file, and
// treating it as one would rewrite every session's live hold as a state
// holding none, destroying exactly the reading this record exists to produce.
//
// The refusal legs come first and cover this file's own hazards: a non-regular
// path (a FIFO here blocks the read forever, with no verdict emitted, since
// every caller of this runs on the gate's critical path) and an oversized one.
function readGateStateResult(cwd) {
    const target = gateStatePath(cwd);
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, state: null };
        return { ok: false, state: null, reason: 'lstat' };
    }
    if (!st.isFile()) return { ok: false, state: null, reason: 'kind' };
    if (st.size > GATE_STATE_MAX_BYTES) return { ok: false, state: null, reason: 'oversized' };
    let raw;
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, state: null };
        return { ok: false, state: null, reason: 'unreadable' };
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { ok: true, state: null }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: true, state: null };
    return {
        ok: true,
        state: {
            lastDecision: gateRecord(parsed.lastDecision),
            lastAllow: gateRecord(parsed.lastAllow),
            interactiveHolds: gateHolds(parsed.interactiveHolds)
        }
    };
}

// The gate state, or null when it is absent, refused, unreadable, or not JSON.
// The reading surfaces take this shape because they act the same way on all
// four: a null state and a state whose fields are null both mean no decision
// recorded and no hold standing, and each of those is a
// silence at the caller that asks it. A caller that must not confuse "not
// there" with "cannot tell" takes readGateStateResult instead.
function readGateState(cwd) {
    return readGateStateResult(cwd).state;
}

// The state that follows a prior state and a new record. Pure: it writes
// nothing.
//
// A hold belongs to the session rather than to the project, so it lives in a
// list holding one record per session (INTERACTIVE_HOLD_MAX_ENTRIES) rather
// than in the single decision slot every gate process in the project writes.
// So:
//
//   deny-interactive  records the decision, and the hold it IS goes to the
//                     head of the per-session hold list, replacing that
//                     session's own prior record, which is where a reader asks
//                     whether one session is being held.
//   allow             records the decision as the newest allow and drops the
//                     allower's own hold record. An allow lands a compaction
//                     in the allower's own context, and says nothing about
//                     the offers a different seat is still being denied, so
//                     another session's hold is untouched.
//
// A decision carrying no session id joins no list: an unownable hold is one no
// session could ever act on, so it never reaches the disk.
//
// What this costs, taken deliberately: a hold has no aggregate. Status reports
// the last decision's recency but no count and no duration. The .jsonl log
// still carries every one of those denials.
//
// This writer has no compare-and-set, so two gate processes in the same
// project inside the same few milliseconds can each carry the list through
// from a read taken before the other's write, and a record written inside that
// gap by another session is dropped. That session is then unheld until its own
// next deny, one assistant turn later, which is a silence rather than a false
// hold, the direction every failure here takes.
function nextGateState(prior, record) {
    const lastAllow = prior ? gateRecord(prior.lastAllow) : null;
    // The whole state is rebuilt from a fixed key set on every write, so a key
    // this does not carry through is erased by the next decision.
    const holds = gateHolds(prior ? prior.interactiveHolds : null);
    if (record.verdict === 'allow') {
        return {
            lastDecision: record,
            lastAllow: record,
            // An allow lands this session's own compaction, which ends whatever
            // hold it was under, so its record leaves the list. Another
            // session's hold is untouched: an allow says nothing about the
            // offers a different seat is still being denied.
            interactiveHolds: holds.filter((h) => !sameSessionId(h.session, record.session))
        };
    }
    // An interactive deny naming a session takes the head of the hold list,
    // replacing that session's own prior record, which is what makes the hold
    // readable per session on a checkout several sessions share.
    const held = (record.verdict === 'deny-interactive' && record.session)
        ? [record, ...holds.filter((h) => !sameSessionId(h.session, record.session))]
            .slice(0, INTERACTIVE_HOLD_MAX_ENTRIES)
        : holds;
    return { lastDecision: record, lastAllow, interactiveHolds: held };
}

// Write JSON atomically (tmp file plus rename): a failed rename unlinks its
// tmp so orphans do not
// accumulate in .kit/. The containing directory is a precondition, never
// created here (see the section header; the marker writer creates its own
// directory before calling). Throws on failure; every caller catches.
//
// verifyBeforeRename is optional and runs in the last moment before the rename,
// with the tmp file already written: returning false abandons the write and
// unlinks the tmp, and this function returns false rather than throwing. It sits
// here rather than in the caller because this is the only point where "still
// true" and "now published" are adjacent; a check the caller ran before calling
// would leave the whole tmp write inside the window it is trying to close.
function writeJsonAtomic(target, value, verifyBeforeRename) {
    const tmp = atomicTmpPath(target);
    let created = false;
    try {
        // Create and write are separate calls so created can mean "the exclusive
        // create returned": spelled as one call, a failure in the write leg
        // leaves the flag false with the file already on disk and the cleanup
        // below skips it.
        const fd = fs.openSync(tmp, 'wx');
        created = true;
        let wrote = false;
        try {
            fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
            wrote = true;
        } finally {
            // Swallowed while the write's own error is in flight, rethrown once
            // the write has returned: at that point the close is where a deferred
            // write error surfaces, and dropping it publishes a torn file behind a
            // success.
            try {
                fs.closeSync(fd);
            } catch (closeErr) {
                if (wrote) throw closeErr;
            }
        }
        if (typeof verifyBeforeRename === 'function' && verifyBeforeRename() !== true) {
            try { fs.unlinkSync(tmp); } catch { /* nothing to remove */ }
            return false;
        }
        fs.renameSync(tmp, target);
        return true;
    } catch (err) {
        // Only what this writer created is this writer's to remove (see
        // atomicTmpPath).
        if (created) {
            try { fs.unlinkSync(tmp); } catch { /* nothing to remove, or it is the unwritable path itself */ }
        }
        throw err;
    }
}

// Rewrite the log to its newest GATE_LOG_KEEP_BYTES. The tail is taken at a
// byte offset, which lands mid-line and possibly mid-character, so everything
// up to and including the first newline is discarded: what survives is whole
// lines only, which is what lets a reader parse every line it finds. The
// rewrite goes through a tmp file and a rename, so a failure leaves the old log
// intact rather than truncated.
//
// A rewrite that would keep NOTHING is refused: the file is left exactly as it
// is. That is the degenerate case of a line longer than the keep bound, which
// nothing here writes but a hand-edited or foreign file can hold, and it
// arrives in two shapes: a tail with no line break in it at all, and one whose
// only break is the terminator at its very end. Both would trade the whole log
// for an empty file, and an oversized log is a far smaller problem than a
// destroyed one. The append that follows still lands.
function trimGateLog(logPath, size) {
    const fd = fs.openSync(logPath, 'r');
    let text;
    try {
        text = readFully(fd, size - GATE_LOG_KEEP_BYTES, GATE_LOG_KEEP_BYTES);
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    const nl = text.indexOf('\n');
    const kept = nl === -1 ? '' : text.slice(nl + 1);
    if (kept === '') return;
    const tmp = atomicTmpPath(logPath);
    let created = false;
    try {
        // Create and write are separate calls so created can mean "the exclusive
        // create returned": spelled as one call, a failure in the write leg
        // leaves the flag false with the file already on disk and the cleanup
        // below skips it, stranding up to a megabyte of trimmed gate journal.
        const outFd = fs.openSync(tmp, 'wx');
        created = true;
        let wrote = false;
        try {
            fs.writeFileSync(outFd, kept, 'utf8');
            wrote = true;
        } finally {
            // Swallowed while the write's own error is in flight, rethrown once
            // the write has returned: at that point the close is where a deferred
            // write error surfaces, and dropping it publishes a torn log behind a
            // success, the same split writeJsonAtomic takes. The descriptor is named
            // apart from the read descriptor above it, since a leaked or
            // mis-closed one is this writer's own failure mode.
            try {
                fs.closeSync(outFd);
            } catch (closeErr) {
                if (wrote) throw closeErr;
            }
        }
        fs.renameSync(tmp, logPath);
    } catch (err) {
        // Only what this writer created is this writer's to remove (see
        // atomicTmpPath).
        if (created) {
            try { fs.unlinkSync(tmp); } catch { /* nothing to remove, or it is the unwritable path itself */ }
        }
        throw err;
    }
}

// Is this path writable, or absent? Absent is fine: the write creates it. Any
// other refusal (a read-only file, a permission, a lock) is not, and is the
// case a caller must be able to see BEFORE it promises anything about a record
// landing.
function writableOrAbsent(target) {
    try {
        fs.accessSync(target, fs.constants.W_OK);
        return true;
    } catch (err) {
        return !!(err && err.code === 'ENOENT');
    }
}

// The directory leg on its own: the scratch directory this project's files live
// in exists, is a real directory rather than a link to one, and is writable.
// Returns { ok:true, kit } or { ok:false }, and never throws.
//
// Split out because it is the whole precondition for a writer whose file is its
// own, while gateStateTarget below is the precondition for writing the gate
// STATE. A writer that takes more than it needs refuses for a condition on
// another file: the hold stamp gated on the state's writability is silenced by a
// read-only compact-gate.json, which disables the interval for a session whose
// own hold was perfectly legible.
//
// What every caller does inherit is that the record is written only in a project
// that is ALREADY kit-governed, the section header's rule: an existing scratch
// directory, and nothing here creates one. An absent one refuses; a marker
// write is what creates it (ensureProjectScratchDir), which for a project
// lying inside the memory store is the store-backed ~/.kit/store/<rel> rather
// than the project's own .kit/.
function gateScratchTarget(cwd) {
    try {
        const kit = kitScratchDir(cwd);
        let dir = fs.lstatSync(kit);
        if (!dir.isDirectory()) return { ok: false };
        // The ignore marker is attempted on every record, so a .kit/ that
        // predates the marker gains it on the gate's next record; the create
        // inside is a no-op on a directory already screened above.
        ensureScratchDirIgnored(kit);
        dir = fs.lstatSync(kit);
        if (!dir.isDirectory() || !writableOrAbsent(kit)) return { ok: false };
        return { ok: true, kit };
    } catch {
        return { ok: false };
    }
}

// Everything that must hold before the gate STATE can be rewritten: the
// directory leg above, plus a state path that is a regular file this process may
// write and a state that is legible as it stands right now.
//
// Returns { ok:true, statePath, prior } or { ok:false }.
//
// It is its own function so the state's legs are spelled once, apart from the
// log legs: the decision recorder appends to the log too, so it takes this
// plus the log legs (gateRecordTargets below). The hold stamp writes neither
// this file nor the log and takes the directory leg alone.
function gateStateTarget(cwd) {
    try {
        if (!gateScratchTarget(cwd).ok) return { ok: false };
        const statePath = gateStatePath(cwd);
        if (regularFileSize(statePath) === null || !writableOrAbsent(statePath)) return { ok: false };
        const prior = readGateStateResult(cwd);
        if (!prior.ok) return { ok: false };
        return { ok: true, statePath, prior: prior.state };
    } catch {
        return { ok: false };
    }
}

// Everything that must hold before a DECISION can be recorded: the state legs
// above plus the log the recorder appends to.
//
// Returns { ok:true, statePath, logPath, logSize, prior } or { ok:false }.
//
// It cannot promise the write will succeed, only that nothing already known
// stops it: a disk that fills between here and the rename still throws, and
// that residual is caught and swallowed like any other. What it does cover is
// every condition that PERSISTS across offers, which is the set that turns one
// wrong sentence into the same wrong sentence forever.
function gateRecordTargets(cwd) {
    try {
        const state = gateStateTarget(cwd);
        if (!state.ok) return { ok: false };
        const logPath = gateLogPath(cwd);
        const logSize = regularFileSize(logPath);
        if (logSize === null || !writableOrAbsent(logPath)) return { ok: false };
        return { ok: true, statePath: state.statePath, logPath, logSize, prior: state.prior };
    } catch {
        return { ok: false };
    }
}

// Record one gate decision: rewrite the state and append one line to the log.
//
// Returns nothing, and that is the design rather than an omission. The gate
// calls this once its verdict is already announced, and a caller able to see
// whether the write landed is a caller able to decide differently because of
// it; the record must never be in a position to move a compaction. Every
// failure is swallowed for the same reason, so an unwritable .kit/ leaves the
// verdict, the exit code, and the stderr note exactly as they would have been.
//
// Every refusal is gateRecordTargets'.
//
// The state is authoritative and the log is the journal. The state is written
// first, and a refusal or a failure there abandons the line too, so the log
// never records a denial the state does not know about. The reverse is NOT
// guarded: once the state has advanced, a throw from the trim or the append
// loses that line, so the log can undercount what the state holds. That
// asymmetry is deliberate, and this is the direction to prefer, because an
// operator reading the log to answer "how often" can survive a missing line,
// while a state that disagrees with its own journal about a standing hold is
// what every consumer decides from.
//
// Concurrency: two gate processes in one project both read the hold list and
// both write its successor, so a hold can be lost from the list as well as a
// line from the log. There is no lock. The failure is a silence, and a
// diagnostic does not earn a lock file. The log has the matching residual: a
// trim keeps the tail ending at a size read moments earlier and renames the
// result over the file, so a line appended in between is dropped. The nudge
// journals through logHoldNudge, which trims on the same rule, so two callers
// can reach that path rather than one. Same conclusion, same reason.
function recordGateDecision(cwd, decision) {
    try {
        const record = gateRecord(decision);
        if (!record) return;
        // The writer stamps the time, never the caller: `at` is what every age
        // in the status report and the hold reader is measured from, so it
        // has to come from one clock rather than from a value passed in.
        record.at = new Date().toISOString();

        const targets = gateRecordTargets(cwd);
        if (!targets.ok) return;
        const { statePath, logPath, logSize, prior } = targets;

        writeJsonAtomic(statePath, nextGateState(prior, record));
        if (logSize > GATE_LOG_MAX_BYTES) trimGateLog(logPath, logSize);
        // One append of one line: a line is written whole or not at all, so a
        // reader never meets a half-written record. A log that does not already
        // end on a line boundary (hand-edited, or truncated by a crash) gets the
        // break first, so the append cannot fuse two records into one line that
        // parses as neither.
        const prefix = endsOnLineBoundary(logPath) ? '' : '\n';
        fs.appendFileSync(logPath, prefix + JSON.stringify(record) + '\n', 'utf8');
    } catch { /* diagnostic only: a decision that cannot be recorded is still taken */ }
}

// One journal line for a hold directive that fired. Never throws and returns
// nothing. It answers for the log file itself, which must be a regular file
// this process can write, and applies the same trim bound and line-boundary
// discipline the decision recorder uses, so a reader still meets whole lines
// only. What it does not re-check is the .kit directory leg (a real directory
// rather than a link to one): its caller establishes it on the same repo
// before it calls, the hold stamp through gateScratchTarget. This is written
// for that caller rather than as a standalone entry point.
//
// The record is distinguishable from a decision by shape rather than by absence:
// it carries `event` where a decision carries `verdict`, so a reader folding the
// log can partition it without guessing. Three fields of provenance and nothing
// else: the time, the session the hold belongs to, and the tool whose return
// triggered it. Each is rebuilt through gateText, so a forged or odd value
// cannot push control characters into an operator's terminal or grow the line.
//
// The event value is a fixed literal, 'nudge-hold', the name the hold
// directive's journal line has always carried, so a reader of an older log
// partitions it the same way. The journal is read by an operator at a
// terminal, and nothing in the kit parses this file.
const HOLD_NUDGE_EVENT = 'nudge-hold';

function logHoldNudge(cwd, sessionId, atIso, toolName) {
    try {
        const logPath = gateLogPath(cwd);
        const logSize = regularFileSize(logPath);
        if (logSize === null || !writableOrAbsent(logPath)) return;
        if (logSize > GATE_LOG_MAX_BYTES) trimGateLog(logPath, logSize);
        const record = {
            at: atIso,
            event: HOLD_NUDGE_EVENT,
            session: gateText(sessionId),
            tool: gateText(toolName)
        };
        const prefix = endsOnLineBoundary(logPath) ? '' : '\n';
        fs.appendFileSync(logPath, prefix + JSON.stringify(record) + '\n', 'utf8');
    } catch { /* the journal is diagnostic: a line that cannot be written is dropped */ }
}

// The deferral nudge's clock for each session's hold, kept in its own small
// file beside the gate state.
//
// It cannot live in the state file, and that is a property of the state's
// writers rather than a preference. nextGateState rebuilds the whole state from
// a fixed key set on every write, its three keys and nothing else, so any field
// added beside them is dropped by the next gate write, and during a
// hold the gate writes on every offer, which past the trigger is every assistant
// turn. A stamp there would be erased minutes after it landed and the interval
// it exists to enforce would never engage.
//
// The file holds a LIST of one entry per session rather than a single stamp,
// because a project can hold several sessions at once, which is the
// ordinary state of a shared checkout. With one slot they would clobber each
// other's stamps and each read would find another session's, which reads as
// never-nudged: the interval would collapse and every one of them would be
// nudged after every covered tool return, the unbounded repeat the nudge's own
// header calls worse than silence.
//
// What keeps the list short is AGE rather than the count cap, and the split
// matters because the two bound different failures. A stamp older than the
// nudge's interval throttles nothing: the next call fires whether it is there or
// not, so dropping it on read costs nothing and is what keeps a project that has
// seen dozens of sessions over a day from carrying a cap's worth of dead
// entries. The count cap is a backstop against an unbounded file and nothing
// more, and it has to be, because eviction by count alone is not a bounded
// degradation: each evicted session is a LIVE one whose next covered tool return
// fires and evicts a third, so past the cap the whole list becomes a round robin
// re-nudging every seat every few fires instead of every interval. With the age
// rule in force an eviction can only ever drop a stamp that was already spent,
// unless more sessions than the cap are held in one project inside a single
// interval, which is the residue this leaves and the only shape the collapse
// still has.
const HOLD_NUDGE_MAX_ENTRIES = 8;

// How long a stamp throttles anything, which is the nudge's own interval
// (NUDGE_INTERVAL_MS in compact-deferral-nudge.js). It is spelled here rather
// than imported because the hook requires this library and the reverse require
// would be a cycle, so the two are held together by a cross-surface pin in
// test/compact-deferral-nudge.test.js instead. The direction that matters is
// one-sided: a value here SHORTER than the nudge's interval would drop stamps
// that are still throttling and hand back the collapse above, while a longer one
// only keeps spent entries around.
const HOLD_NUDGE_TTL_MS = 30 * 60 * 1000;

// The read cap: the writer produces a few short entries and never grows past
// the cap above, so anything larger is not something this wrote, and reading
// it whole inside the tool loop is cost with nothing to gain.
const HOLD_NUDGE_MAX_BYTES = 64 * 1024;

// Path to the hold-nudge stamps for a given repo root.
function holdNudgePath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-hold-nudge.json');
}

// The stamps still throttling something in this project, newest first,
// distinguishing a file that carries nothing to preserve from one that is there
// and could not be read. Returns { ok, holds, reason }, on readGateStateResult's
// shape and for its reason:
//
//   { ok: true,  holds }      the reading stands: holds is what is still
//                             throttling, and an empty one means there is
//                             genuinely nothing here to keep (an absent file, an
//                             empty one, JSON that does not parse or does not
//                             carry a holds array, and entries this reader
//                             dropped)
//   { ok: false, holds: [] }  the file is there and its contents are unknown, so
//                             no caller may act as though it were empty
//
// reason names which refusal produced an { ok: false }: 'lstat' (the path's own
// kind could not be read), 'kind' (a link at the final component), 'unreadable'
// (the open or the read itself was refused), 'oversized' (the file is larger than
// HOLD_NUDGE_MAX_BYTES, so what is past the cut is unknown) or 'short-fill' (the
// read ended short of what the descriptor promised, which is a file truncated
// under the read or a device that stopped answering).
//
// The last two are one flag and two facts at the reader below, which is why they
// are two reasons here. readFileBounded answers `bounded` for both and names the
// bound beside it, and the difference is the whole basis of the write side's
// heal: only 'oversized' says something about the FILE, that it is larger than
// anything this writer produces, while 'short-fill' says only that this READ did
// not finish, which can happen to a file full of live peer stamps.
//
// The distinction is load-bearing at two of this reader's three callers, and it
// is the WRITE side that pays most for it. recordHoldNudge rebuilds this whole
// file from what this returns and renames it into place, so an unknown reading
// taken as an empty one erases every other held session's stamp and collapses
// their intervals, which is the opposite of the preservation that
// read-modify-write exists for; it also reads WHICH refusal, healing the two
// shapes it could not have written and refusing the three that may be a lock or
// a fault over a real list. The checkpoint CLI's status verb takes the reason as
// well, and for the same distinction turned outward: a refusal here is a held
// session that is never spoken to. Its line has two halves and they are two
// different counts, so neither number stands for both. WHAT WAS READ: the five
// reasons reach FOUR leads, 'unreadable' and 'lstat' sharing one deliberately,
// since nothing there can tell a lock over a real list from a shape that never
// lifts. WHAT HAPPENS NEXT: the same five draw THREE remedies, because that half
// is composed off membership in HOLD_NUDGE_HEALABLE rather than off a reason
// name, so 'oversized' and 'kind' take one remedy between them (the next
// directive replaces the file), 'short-fill' takes its own (the stamps stand and
// a read that completes takes them again), and the shared 'unreadable'/'lstat'
// leg takes the third, which promises neither a removal nor an end to the wait.
// The plain read-only caller (holdNudgedAt, through readHoldNudges) keeps the
// empty answer for all of them, because there the two directions cost the same
// one extra nudge.
//
// THE READER AND THE WRITER DISAGREE ABOUT ONE KIND, deliberately and per kind.
// A link is named here because an open follows one and the lstat below is the
// only place that question can be asked. Every OTHER non-regular kind is not:
// a FIFO, a socket or a device node reaches readFileBounded, which refuses it on
// the descriptor and answers the same null as a lock, so this reports it as
// 'unreadable'. holdStampKind, which the WRITER asks, calls all of them 'other'
// and recordHoldNudge removes the path. The asymmetry follows from what each
// side does next. The writer's next act is an unlink of that NAME, which is safe
// whatever kind stands there and opens nothing, so a name-settled verdict costs
// it nothing. This reader's next act is an OPEN of that name, and a kind verdict
// taken off a name it then opens is exactly the swap window the shared reader
// exists to close, so the kind stays the descriptor's here. The cost is
// diagnostic and one-directional: the status verb tells an operator that such a
// path cannot be read and that anything standing there may not clear on its own,
// which is weaker than the truth for a FIFO the next directive does remove, and
// never stronger. It promises no repair that fails to come, and no wait that
// does not end, which are the two ways that surface could mislead.
//
// The file is user-writable, so both fields are rebuilt through gateText exactly
// as the journal's are, and a second entry for a session already kept is dropped
// rather than kept behind the first, on gateHolds' reasoning: newest-first order
// is what decides which stamp answers for a session, and a duplicate left in
// would hold a capped slot against a live one.
//
// The bytes come through kit-read-lib's shared bounded reader rather than
// through a kind check on the name followed by an open of that same name, which
// is the guard the nudge's own signpost read takes and is a property of the
// channel rather than of whichever caller first needed it: the kind and the
// size are settled on the descriptor the read is about to consume, and off
// win32 a planted FIFO is refused instead of blocking a hook that runs after
// every covered tool return. A result the reader had to cut short is refused
// outright rather than parsed, on the same reasoning: a truncated object is not
// the file this reads. One property that reader deliberately does not give is
// taken here instead, in the one line above the open: it follows a link at the
// final component by design, so this refuses a link by name before opening,
// which is the refusal this file's own writer applies to the same path and
// which also keeps a link into a dead network mount from stalling the open.
// That reader offers the same refusal as an opt-in of its own
// (readFileBounded's refuseLink, which the deferral nudge's signpost read takes),
// and BOTH are taken here, each for what the other cannot do. The lstat is what
// makes a link a distinguishable answer: the option refuses with the null it
// answers for every other refusal, and this reader's reasons must stay apart,
// since 'kind' is a shape its writer heals by removing the path while
// 'unreadable' is a lock it must leave alone, and the status verb words the two
// differently. The option is what closes the window between that lstat and the
// open, which the lstat alone only narrows: where the platform has O_NOFOLLOW
// the refusal rides the open itself, so a link swapped in after the lstat is
// refused rather than followed, and where it does not the reader's own lstat is
// a second look at the name, taken later than this one. A swap landing inside
// that window now answers 'unreadable', which is the reading it is: what is at
// the path stopped being what the kind check saw.
//
// Three bounds, and none is another's. The walk is bounded BY INDEX at the
// cap, so a planted array of ten thousand invalid entries is not walked: a
// bound on how many valid entries are kept would let every invalid one be
// examined first, and the byte cap above would then be the only real limit. An
// entry older than HOLD_NUDGE_TTL_MS is dropped rather than returned, which
// is what makes an eviction at the cap safe: a reader of this list either finds
// a stamp that is genuinely holding a session quiet or finds nothing. And an
// entry dated further ahead of the reader's clock than CHECKPOINT_FUTURE_SKEW_MS
// is dropped on the other side of the same rule, the allowance being the one this
// file's other timestamp rules take.
//
// THE ALLOWANCE IS THE WRITER'S DOING rather than the reader's, since for a
// reader alone keeping a future stamp buys nothing: an age is a subtraction, so a
// future stamp's age is negative, and the nudge's own interval rule reads a
// negative elapsed as elapsed (intervalElapsed in compact-deferral-nudge.js) and
// fires anyway. recordHoldNudge rebuilds this whole file from what this returns
// and renames it into place, so an entry this reader drops is not passed over on
// the next write, it is ERASED, and every entry in this file belongs to another
// session, stamped by another process against its own clock. A step backwards on
// this box, an NTP correction or a resumed VM, therefore turns every peer's stamp
// future-dated at once, and the next write takes all of them out: each of those
// seats loses its throttle and is nudged again, over a skew of seconds. The
// allowance is what holds that ordinary case, and a stamp genuinely far ahead is
// still dropped, so a fabricated date cannot sit in one of the capped slots. An
// entry whose time cannot be parsed at all is dropped too, since a caller reads it
// as never-nudged anyway and a slot it occupies would push a live stamp out.
//
// Empty reads as "this session has not been spoken to", which fires. That is the
// same fail-open direction guard 8 of the nudge takes on an illegible nudgedAt,
// and it is self-healing for the same reason: the fire's own stamp is written
// through an atomic rename, so it replaces the illegible file wholesale and the
// interval takes hold from the next tool return onward. That direction belongs
// to the reading callers; the writer takes { ok: false } as a silence instead.
function readHoldNudgesResult(cwd, nowMs) {
    try {
        const target = holdNudgePath(cwd);
        // The one question the descriptor cannot answer, asked of the name and
        // of nothing else: is the final component a link? An open follows one,
        // so without this the read takes whatever the link names, where this
        // file's own writer refuses a link at that path outright, and a link
        // into a dead network mount would stall a hook that runs after every
        // covered tool return. The lstat does not traverse the final component,
        // so asking costs nothing on that path. The KIND and the SIZE stay the
        // descriptor's below: this narrows the name check to the one property an
        // open cannot reject, rather than handing the kind verdict back to the
        // name. An absent file is the one failure here that is an answer: it
        // carries nothing to preserve. Any other lstat failure, and a link, leave
        // the contents unknown.
        let st;
        try {
            st = fs.lstatSync(target);
        } catch (err) {
            if (err && err.code === 'ENOENT') return { ok: true, holds: [] };
            return { ok: false, holds: [], reason: 'lstat' };
        }
        if (st.isSymbolicLink()) return { ok: false, holds: [], reason: 'kind' };
        const read = readFileBounded(target, HOLD_NUDGE_MAX_BYTES, { refuseLink: true });
        // A refused open or read, and either kind of partial read, all leave what
        // the file holds unknown. The two partial readings are told apart because
        // the writer's two directions differ in cost: a file past the ceiling is
        // not this writer's output and is healed, while a read that ended short
        // may be its own file with every peer's stamp in it. Only the bound the
        // reader names as the ceiling takes the healing leg, so a bound it names
        // some other way, or does not name at all, is refused. An empty file is a
        // reading: there is nothing in it to keep.
        if (read === null) return { ok: false, holds: [], reason: 'unreadable' };
        if (read.bounded) {
            return { ok: false, holds: [],
                reason: read.boundedBy === 'ceiling' ? 'oversized' : 'short-fill' };
        }
        if (read.text === '') return { ok: true, holds: [] };
        let parsed;
        // JSON this cannot parse, and JSON carrying no holds array, are read
        // rather than unknown: neither is something this writer produced, so
        // neither holds a stamp to preserve, and the fire's own atomic rename
        // replaces the file wholesale.
        try { parsed = JSON.parse(read.text); } catch { return { ok: true, holds: [] }; }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.holds)) {
            return { ok: true, holds: [] };
        }
        const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
        const holds = [];
        const scanned = Math.min(parsed.holds.length, HOLD_NUDGE_MAX_ENTRIES);
        for (let i = 0; i < scanned; i += 1) {
            const entry = parsed.holds[i];
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const session = gateText(entry.session);
            const nudgedAt = gateText(entry.nudgedAt);
            if (!session || !nudgedAt) continue;
            const at = Date.parse(nudgedAt);
            if (!Number.isFinite(at) || now - at >= HOLD_NUDGE_TTL_MS
                || at - now > CHECKPOINT_FUTURE_SKEW_MS) continue;
            if (holds.some((kept) => sameSessionId(kept.session, session))) continue;
            holds.push({ session, nudgedAt });
        }
        return { ok: true, holds };
    } catch { return { ok: false, holds: [], reason: 'unreadable' }; }
}

// The stamps alone, for a caller whose two directions cost the same: an unknown
// reading answers the empty list here, exactly as an absent file does. Both fire,
// which is the fail-open direction the reader's header states and the one every
// read-only caller of this list takes.
function readHoldNudges(cwd, nowMs) {
    return readHoldNudgesResult(cwd, nowMs).holds;
}

// When the hold nudge last spoke to this session in this project, as the stored
// ISO string, or null when it has not, which is also the answer for a stamp the
// reader above has already aged out or found illegible. The caller still applies
// its own interval to the value it gets: this reader's own bound is what keeps
// the list short, and the nudge's is what decides whether it speaks, and the two
// agreeing is a pin rather than an assumption (HOLD_NUDGE_TTL_MS).
//
// nowMs is the caller's clock where it has one, so a hook that answers several
// questions of one moment does not age this list against a different one.
// The id is canonicalized through gateText before it is compared, which is what
// the WRITERS store: every session field in these files goes in through gateText,
// so an id carrying anything that rule strips is stored in one spelling and would
// be looked up in another, and the lookup would answer never-nudged for a session
// that has a live stamp. No id the harness issues today is changed by that pass,
// so this decides nothing at present; it is the same rule on both sides of the
// comparison rather than a rule on one side and a raw value on the other.
function holdNudgedAt(cwd, sessionId, nowMs) {
    const session = gateText(sessionId);
    if (typeof sessionId !== 'string' || sessionId === '' || !session) return null;
    for (const entry of readHoldNudges(cwd, nowMs)) {
        if (sameSessionId(entry.session, session)) return entry.nudgedAt;
    }
    return null;
}

// What is at the hold stamp path, told apart so a caller can tell a missing
// file from one it cannot read: 'file', 'absent', 'other' (something
// that is not a regular file, a link at the final component included, since an
// lstat judges a link as a link) and 'unknown' (a kind that could not be read at
// all, or a path that can never resolve).
//
// regularFileSize answers null for the last two together, and here they are
// opposite answers. 'other' is a shape this file's writer cannot have produced,
// so removing it costs nothing and is the only thing that ever ends it, while
// 'unknown' is a permission, a lock or an indexer over what may be a real list
// of live stamps, which lifts on its own and must not be removed. The errno
// split is pathErrnoClass's, the rule every caller of this question in the kit
// answers to; only its 'absent' leg is an absence, and a 'determinate' one
// (a file standing where .kit/ belongs, a link cycle above the final component)
// is unknown here rather than removable, since no unlink of this path repairs
// any of them. Never throws.
function holdStampKind(target) {
    try {
        return fs.lstatSync(target).isFile() ? 'file' : 'other';
    } catch (err) {
        return pathErrnoClass(err && err.code) === 'absent' ? 'absent' : 'unknown';
    }
}

// Remove the hold stamp file, and say whether the path is clear afterwards.
//
// The one destructive act on this path, and it is scoped by construction: the
// argument is always holdNudgePath's answer for the project in hand, a single
// file this nudge alone writes, never a directory and never a walk. Every
// failure is silent and answers false, which the caller reads as a refusal to
// write: an unlink that cannot remove what is sitting there (a directory, a
// permission, a lock) leaves the path exactly as it found it, and the stamp is
// then skipped, which is the silence every failure on this path takes.
function unlinkHoldStamp(target) {
    try {
        fs.unlinkSync(target);
        return true;
    } catch (err) {
        return !!(err && err.code === 'ENOENT');
    }
}

// The two refusal reasons readHoldNudgesResult can give that this writer's own
// file cannot be behind: a file past the read ceiling (its own holds at most
// HOLD_NUDGE_MAX_ENTRIES short entries and cannot approach the cap) and a link
// at the final component (it writes a regular file through a temp-and-rename,
// which replaces the name rather than following what stands at it). Both are
// healed by removing the path.
//
// The other three keep refusing, and the third is the one worth naming, since it
// arrives through the same `bounded` flag as the first: 'unreadable' and 'lstat'
// may be a transient lock over a real list, and 'short-fill' is a read that ended
// short, which is a file truncated under the read or a device that stopped
// answering, and says nothing about whose file it is. Healing on that reading
// would unlink a file this writer may well have written, with every other held
// session's live stamp in it.
//
// Exported because it is read on BOTH sides of the same question. This file's
// writer heals the reasons in it, and the checkpoint CLI's status verb promises
// an operator that a refusing file is replaced by the next directive, which is
// true for exactly these reasons and false for the rest. Each side filtering on
// its own copy of the literals is how a reason added here would leave that
// promise withheld from a file the writer now heals, with both suites green;
// test/kit-compact-gate.test.js pins the correspondence.
const HOLD_NUDGE_HEALABLE = ['oversized', 'kind'];

// Stamp the hold nudge's clock for one session, and return whether the stamp is
// on disk. The boolean is the whole point: the stamp is not diagnostic, it IS
// the rate limit and the only cross-process carrier the interval has, so the
// hook emits only when this returns true and every failure here is a silence.
//
// The .kit/ precondition is gateScratchTarget's rather than a second copy: the
// directory must already be there, per the section header, and be a real
// writable directory, so a held session standing in a stranger's checkout
// writes nothing into it. The gate STATE's own
// legs are deliberately not among the preconditions, even though the hold this
// stamp throttles was read out of that file: this writer never touches it, and
// taking its legs would let a read-only or locked compact-gate.json disable the
// interval for a session whose hold record read back perfectly, which is a
// refusal about a different file. The stamp's own path is then held to the same
// kind-and-writable test every other writer here applies to its target, with two
// differences this file alone takes, both following from the same heal: a kind
// that is not a regular file is removed rather than refused, and the writable
// test is asked AFTER the heal rather than before it, since an unlink needs
// permission on the directory and none on the file, so a path judged unwritable
// before the heal is one the heal makes writable.
//
// The write carries no compare-and-set, because there
// is nothing here for a concurrent writer to lose: the file is this nudge's
// alone, no gate path reads or writes it, and the whole cost of a lost entry is
// one extra nudge on the next tool return. What the read-modify-write does do is
// preserve the other sessions' stamps, which is why the entries kept are
// everything except this session's own. They are read as of this write's own
// clock, so the spent ones are already gone by the time the cap is applied and
// the truncation can only drop a stamp that was still throttling where more
// sessions than the cap are held inside one interval.
//
// That preservation is why the read is taken through readHoldNudgesResult rather
// than through the plain list. A rename rebuilt from an empty list is a rename
// that erases the file, so a reading that is empty because the file could not be
// read makes this write destroy exactly the stamps it exists to keep, collapsing
// every other held session's interval at once and re-nudging all of them. Such a
// reading refuses the write here instead: the hold goes unstamped, which is a
// silence, which is the direction every failure on this path takes.
//
// The refusal is split by whether the reading can END, because a refusal that
// cannot is not a silence but a disabled interval. Two of the five readings this
// file can give are ones this writer could not have produced, a file past the
// read ceiling and a link at the path, and nothing about either resolves with
// time: refusing them alone would silence this session's directive for the life
// of the file, with no age-out and no surface saying why. Those two are healed by
// removing the path before the write (HOLD_NUDGE_HEALABLE), which costs nothing,
// since a file this writer did not write holds no peer's stamp to preserve.
//
// The split is on WHOSE FILE IT IS rather than on how partial the reading was,
// which is what keeps the heal off the third permanent-looking leg. A read that
// ended short arrives through the same partial-read flag as the oversized one and
// means something else entirely: the file was truncated under the read or a
// device stopped answering, either of which can happen to this writer's own file
// on the tool return after it wrote it. Unlinking on that reading destroys
// exactly the peer stamps the read-modify-write exists to preserve, which is why
// it refuses with the other two, a read that was refused and an lstat that could
// not answer, the transient lock over a REAL list. The checkpoint CLI's status
// verb is what reports the file that is refusing, and it words the healing legs
// and the refusing ones apart because only the healing ones end by themselves.
//
// What the rebuild preserves is every entry the READER returned, which is not
// every entry the file held: the reader drops what it will not act on, and this
// write then erases it rather than passing over it. Two classes are dropped that
// way, an entry past HOLD_NUDGE_TTL_MS and one dated further ahead of the clock
// than CHECKPOINT_FUTURE_SKEW_MS, and it is that erasure rather than any property
// of the read that the forward allowance exists for: without it a clock stepping
// back by seconds would erase every peer's stamp in one write.
// readHoldNudgesResult's drop rule states the whole trade.
//
// The journal line follows the stamp, best-effort and outside its preconditions,
// on logHoldNudge's own terms: a locked or read-only .jsonl must never be
// able to disable an interval.
function recordHoldNudge(cwd, sessionId, nowMs, toolName) {
    let stampedAt = null;
    try {
        const session = gateText(sessionId);
        if (typeof sessionId !== 'string' || sessionId === '' || !session) return false;
        const at = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
        if (!gateScratchTarget(cwd).ok) return false;
        const target = holdNudgePath(cwd);
        // The kind leg, asked so the two halves of regularFileSize's null are
        // told apart: a shape this writer cannot have produced is removed, while
        // a kind that could not be read at all refuses.
        const kind = holdStampKind(target);
        if (kind === 'unknown') return false;
        if (kind === 'other' && !unlinkHoldStamp(target)) return false;
        const iso = new Date(at).toISOString();
        const prior = readHoldNudgesResult(cwd, at);
        // A reading that identifies the file as one this writer cannot have
        // produced is healed by removing the path; every other reading that left
        // the contents unknown refuses, since the rebuild below would erase peer
        // stamps that may really be there. A read that ended short is on the
        // refusing side for exactly that reason: it names no shape at all, only
        // an unfinished read. The 'kind' leg is still reachable here despite the
        // check above, through a swap landing between the two, and takes the
        // same heal.
        if (!prior.ok
            && !(HOLD_NUDGE_HEALABLE.includes(prior.reason) && unlinkHoldStamp(target))) return false;
        // The writability of the TARGET is judged here rather than above the
        // read, because the heal changes the answer. An unlink takes permission
        // on the containing directory (gateScratchTarget's leg above, which has
        // already passed) and none at all on the file, so a stamp file that is
        // both oversized and unwritable is one the heal removes and the write
        // then creates: asked before the heal, this leg would refuse it forever,
        // which is the permanent silence the healable set exists to prevent and
        // the replacement the status verb promises for that same file. Asked
        // here, it answers for the path the write is actually about to meet, and
        // its original subject is untouched: a legible, unwritable stamp file
        // reads back fine, takes no heal, and refuses exactly as before.
        if (!writableOrAbsent(target)) return false;
        const kept = prior.holds.filter((entry) => !sameSessionId(entry.session, session));
        const holds = [{ session, nudgedAt: iso }, ...kept].slice(0, HOLD_NUDGE_MAX_ENTRIES);
        if (!writeJsonAtomic(target, { holds })) return false;
        stampedAt = iso;
    } catch { /* an unstamped hold is a silent one: the caller emits nothing */ }
    if (stampedAt === null) return false;
    logHoldNudge(cwd, sessionId, stampedAt, toolName);
    return true;
}

// Does this file end on a line boundary? True for an empty or absent file,
// which needs no separator. False when the answer cannot be established: a
// path whose kind or size could not be read (regularFileSize's null) gets the
// fail-safe answer rather than the go-ahead one, since a spare blank line in
// the journal costs nothing while a fused record parses as neither of the two
// records it ran together. Reads the final byte alone: the answer is one byte
// long and the file can be megabytes.
function endsOnLineBoundary(target) {
    const size = regularFileSize(target);
    if (size === null) return false;
    if (size === 0) return true;
    const fd = fs.openSync(target, 'r');
    try {
        const buf = Buffer.alloc(1);
        const read = fs.readSync(fd, buf, 0, 1, size - 1);
        return read !== 1 || buf[0] === 0x0A;
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed */ }
    }
}

// ---------------------------------------------------------------------------
// Release markers. Two session-scoped marker kinds give the gate its release
// paths: the role-boundary marker, which a session (a coordinator, expert or
// admin seat, or any hands-on session) opens at a banked-and-empty moment so
// the deferral can land the next offer there instead of riding to the safety
// ceiling; and the operator-consent marker, written only on the operator's
// explicit word, which releases one deferred compaction for the session it
// names. The boundary marker is one FILE per session, its session id a
// component of the file's own name, because a shared checkout carries several
// seats at once and each declaration is one seat's own word about one moment:
// two seats scoped only by a field inside a single file left the second
// declaration renaming over the first, and the unmade seat deferred at its next
// offer believing it had declared. It lives in one machine-local root keyed by
// session rather than in any project's scratch directory, because its writer
// and its reader do not share a working directory: the verb runs wherever the
// session's shell stands, a linked worktree among the places, while the gate
// reads under the directory its PreCompact payload names. A root that depends
// on neither is what makes the two agree by construction. The consent marker is
// one file per project, the operator writing one at a time, and it stays under
// the project's scratch directory with the gate's record. Both release
// SCHEDULING denials only, the verdict that means "not at this moment": no
// marker touches an allow clause, and the no-marker case leaves every leg
// exactly as it was.
//
// The trust shape: a session's own banked-and-empty
// declaration is the best boundary signal available, and the ceiling
// force-landing is already the worst case, so honoring a self-declared
// boundary can only move a compaction earlier onto a cleaner spot. The
// consent marker is asserted rather than authenticated (a single-principal
// machine); what bounds its writing is prose in the role skills, and what
// bounds its effect is here: one session, one release, one age window.
// ---------------------------------------------------------------------------

// The directory every role-boundary marker on this machine lives in,
// ~/.kit/role-boundary, or null where no such root can be opened. It hangs off
// the home directory rather than off any project directory, so a session's
// marker resolves to one file however many directories that session works in.
// It is under ~/.kit and never ~/.claude: ~/.claude is the memory store's
// git-synced repository, whose .gitignore is an allowlist the doctor manages,
// where ~/.kit already holds kitScratchDir's unsynced per-machine path for a
// store-resident project, so the machine-local root is the existing convention.
//
// The home is read at call time so a fixture home redirects it, and it is
// screened before anything is composed from it: a home that is unknown, empty
// or not absolute composes a relative path that lands wherever the process
// happens to stand, and one spelled as a network share makes this machine authenticate outbound
// and block for the connection's timeout on every read that follows. Both
// answer null, which every reader and writer here takes as "no marker": a
// declaration is not written, the verb refuses naming the cause, and the gate
// reads nothing, which is the deferral direction every leg of this gate fails in.
function roleBoundaryRoot() {
    const home = os.homedir();
    if (typeof home !== 'string' || home === '' || !path.isAbsolute(home) || namesNetworkShare(home)) {
        return null;
    }
    return path.join(home, '.kit', 'role-boundary');
}

// Path to one session's role-boundary marker in that root, or null where the
// session id is not one this file will compose a name from or the root cannot
// be opened. The charset rule usableSessionId carries is the whole of what
// stands between an id and the root: a value carrying a separator, a parent
// segment or a leading dash resolves to nothing rather than to a path somewhere
// else, and every reader and writer here treats that null as "no marker" rather
// than falling back to an unscoped name.
//
// The id composes the name as it is given, where the match rule below compares
// ids case-insensitively, so on a case-sensitive filesystem two spellings of one
// id resolve two files while the rule reads them as one session. The cost of
// that seam is a marker the offer does not find, which is a deferral, the
// direction every leg of this gate fails in.
//
// A marker left under a project's own scratch directory, where this file kept
// them while the path was resolved from a working directory, is resolved by
// nothing, read by nothing and swept by nothing: it is inert. It is not
// migrated, since a declaration's own life is bounded by the age bound and by
// the moment rule either way, and the cost of the move is at most one lapsed
// declaration per seat.
function roleBoundaryPath(sessionId) {
    const id = usableSessionId(sessionId);
    if (id === null) return null;
    const root = roleBoundaryRoot();
    if (root === null) return null;
    return path.join(root, 'compact-role-boundary.' + id + '.json');
}

// Path to the operator-consent marker for a given repo root.
function consentPath(cwd) {
    return path.join(kitScratchDir(cwd), 'compact-consent.json');
}

// A session id a caller may scope a marker to, or null. The gate is charset
// plus a leading-character rule, not charset alone: a value that opens with a
// dash reads as an option to any parser that meets it later, so the first
// character must be alphanumeric however clean the rest is. Session ids as
// the harness mints them are UUID-shaped and pass untouched; anything else
// degrades to the refusal at the call sites, never to an unscoped write. The
// rule also carries the path-safety property every caller that composes a name
// from an id depends on, since a passing value is a single path component: it
// holds no separator, is not a dots-only name, and is inside the storage cap
// the marker writer enforces. One definition serves the checkpoint CLI's marker
// verbs, the seat-stop hook's registry lookup, the transcript and registry
// entry paths below, and the role-boundary marker's own file name, so the value
// one of them refuses is not a value another joins onto a path.
function usableSessionId(value) {
    return (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
        ? value
        : null;
}

// Where the harness files a session's transcript for a project directory, or
// null where nothing resolves. The shape is <session-id>.jsonl under
// <projects root>/<flattened project path>, and both halves are memq's own,
// harnessProjectsRoot for the root and sanitizeProjectPath for the
// flattening, imported rather than restated so no spelling here can disagree
// with the store's. memq is required lazily because this is the only path
// here that needs it and the gate's own hot path must not pay for loading it.
// Its one consumer is the corroboration below, which asks about a NAMED
// project directory. A session's own transcript, wherever the harness filed
// it, is located by id alone through findTranscript instead, which is what the
// declaring writer and the status report's moment read take.
function sessionTranscriptPath(projectDir, sessionId) {
    try {
        if (usableSessionId(sessionId) === null) return null;
        const { sanitizeProjectPath, harnessProjectsRoot } = require(path.join(__dirname, '..', 'scripts', 'memq.js'));
        return path.join(harnessProjectsRoot(),
            sanitizeProjectPath(path.resolve(projectDir)), sessionId + '.jsonl');
    } catch {
        return null;
    }
}

// Whether the harness holds a transcript for this session under this project
// directory, which is the corroboration a marker written at a directory the
// caller named rather than stood in has to pass. A marker landing in a
// project the named session never ran in is inert and silently so, and this
// turns that miss into a refusal.
//
// Anything unresolvable reads as no transcript: the caller's refusal is the
// conservative answer, and a marker not written costs one re-run at the right
// directory while one written at the wrong one costs a release nothing reads.
function projectHoldsSessionTranscript(projectDir, sessionId) {
    try {
        const full = sessionTranscriptPath(projectDir, sessionId);
        return full !== null && fs.statSync(full).isFile();
    } catch {
        return false;
    }
}

// How long each marker stays honorable. Both are the hold's idle
// bound rather than numbers of their own, because all three answer one
// question: how long a moment's word still describes the same working
// session. A seat opens the boundary marker at a banked moment its runbook
// defines, and the invariant that moment carries is that context holds
// nothing the disk does not, so a compaction anywhere inside the window costs
// a re-read and never state; what the window has to cover is the seat's own
// quiet gap between banked moments, which is the same order as the idle bound
// and far longer than one tool call. The consent marker covers the same gap
// from the other side, an operator's release preceding the next offer by a
// while (the offer only recurs while the context sits past the trigger).
// Derived rather than restated so the three cannot drift; evidence that ever
// tunes one apart turns that one's derivation into its own literal.
const ROLE_BOUNDARY_MAX_AGE_MS = GATE_HOLD_MAX_IDLE_MS;
const CONSENT_MAX_AGE_MS = GATE_HOLD_MAX_IDLE_MS;

// The one marker match rule, shared by its two consumers (the gate's release
// legs and the CLI's status report) so they cannot drift. A marker counts only
// for the session it names, only while unconsumed, and only within the age
// bound the caller passes: the two marker kinds differ in nothing but that
// bound. The rule stays pure: it is told the subject session and the clock
// rather than reading any state.
//
// Returns { ok:true, reason:null } on a match, else { ok:false, reason } with
// reason naming the first failed clause in evaluation order:
//   'no-marker'      marker is missing, not an object, or carries no session
//                    string (a hand-made or torn file; the writer always
//                    records one)
//   'consumed'       consumed is anything but a literal false. An absent flag
//                    reads as consumed too: the writer always records false,
//                    so a record without it is not one of ours, and the
//                    conservative reading is the dead one.
//   'wrong-session'  the marker names a different session than the subject,
//                    or the subject itself is unusable (sameSessionId is
//                    false when either side is missing, which is exactly the
//                    treat-as-absent handling a payload without an id needs)
//   'no-timestamp'   writtenAt is missing or does not parse as a date
//   'expired'        writtenAt is older than maxAgeMs, or maxAgeMs itself is
//                    not a finite number: a caller that forgot the bound
//                    narrows the window to nothing rather than widening it
//   'future'         writtenAt is beyond the skew allowance every stored
//                    timestamp here tolerates (one constant, one question)
// Never throws on JSON-derived input: every access is guarded and Date.parse
// returns NaN on garbage. nowMs pins the clock as it does elsewhere here.
function markerMatches(marker, sessionId, nowMs, maxAgeMs) {
    const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
        || typeof marker.session !== 'string') {
        return { ok: false, reason: 'no-marker' };
    }
    if (marker.consumed !== false) return { ok: false, reason: 'consumed' };
    if (!sameSessionId(marker.session, sessionId)) return { ok: false, reason: 'wrong-session' };
    if (typeof marker.writtenAt !== 'string') return { ok: false, reason: 'no-timestamp' };
    const written = Date.parse(marker.writtenAt);
    if (!Number.isFinite(written)) return { ok: false, reason: 'no-timestamp' };
    if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs)) {
        return { ok: false, reason: 'expired' };
    }
    const age = now - written;
    if (age > maxAgeMs) return { ok: false, reason: 'expired' };
    if (age < -CHECKPOINT_FUTURE_SKEW_MS) return { ok: false, reason: 'future' };
    return { ok: true, reason: null };
}

// A marker file's read cap. The writer produces a few short fields and never
// grows, so anything past 64 KB is not something this wrote, and reading it
// whole on a hook path that runs before any verdict is emitted is cost with
// nothing to gain.
const MARKER_MAX_BYTES = 64 * 1024;

// Read and parse a marker file, on readGateStateResult's legs and for the same
// reasons: the gate reads these on its deny path before any verdict is
// emitted, so the path must be a regular file of sane size before it is opened
// (a FIFO planted here would block forever inside readFileSync, where no
// try/catch can rescue it, and being an lstat the check judges a link as a
// link rather than as its target), and the status report needs the refusal
// legs told apart because they name different remedies and cannot be
// recovered by re-asking with a second syscall. Returns { ok, marker, reason }:
//
//   { ok: true,  marker }                     a parsed marker
//   { ok: true,  marker: null, 'absent' }     nothing is at the path
//   { ok: true,  marker: null, 'illegible' }  a regular file that is not JSON
//   { ok: false, marker: null, 'kind' }       something that is not a regular file
//   { ok: false, marker: null, 'oversized' }  a regular file past the read cap
//   { ok: false, marker: null, 'unreadable' } the read itself was refused
//   { ok: false, marker: null, 'lstat' }      the path's own kind could not be read
function readMarkerResult(target) {
    let st;
    try {
        st = fs.lstatSync(target);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, marker: null, reason: 'absent' };
        return { ok: false, marker: null, reason: 'lstat' };
    }
    if (!st.isFile()) return { ok: false, marker: null, reason: 'kind' };
    if (st.size > MARKER_MAX_BYTES) return { ok: false, marker: null, reason: 'oversized' };
    let raw;
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, marker: null, reason: 'absent' };
        return { ok: false, marker: null, reason: 'unreadable' };
    }
    try {
        return { ok: true, marker: JSON.parse(raw), reason: null };
    } catch {
        return { ok: true, marker: null, reason: 'illegible' };
    }
}

// One session's marker, read at its own file. A session id the resolver
// refuses gets its own outcome rather than the absent one: the two facts are
// different, an id nothing can compose a path from being a caller's problem
// where an absent file is an ordinary state, and a reader that answered
// 'absent' for both would hand every caller one value for two questions. A
// root that cannot be opened is a third fact ('no-root'), told apart from the
// id so a caller names the home directory rather than the id it was handed.
function readRoleBoundaryResult(sessionId) {
    if (usableSessionId(sessionId) === null) return { ok: false, marker: null, reason: 'no-session' };
    const target = roleBoundaryPath(sessionId);
    if (target === null) return { ok: false, marker: null, reason: 'no-root' };
    return readMarkerResult(target);
}

// The name shape the sweep below judges an entry by, spelled once: the prefix
// the writer composes and the .json tail, on a regular file.
const ROLE_BOUNDARY_PREFIX = 'compact-role-boundary.';

function isRoleBoundaryEntry(entry) {
    return entry.isFile() && entry.name.startsWith(ROLE_BOUNDARY_PREFIX)
        && entry.name.endsWith('.json');
}

// How many marker names one sweep will consider. The root holds one file per
// session that has banked inside the age bound, a population in the low tens
// on a busy machine, so this is far above it and exists to bound the cost of a
// directory somebody has filled rather than to describe it. The sweep says so
// with its `bounded` flag rather than reporting a cut pass as a complete one.
const ROLE_BOUNDARY_MAX_NAMES = 512;

// Remove every marker file in the root older than the age bound, which is the
// age past which markerMatches refuses one anyway: what the sweep collects is a
// file no reader will ever honor again. One file per session and no writer
// that renames over a peer's is what makes this necessary, since a session that
// declares and then ends leaves a file nothing else will ever replace, and the
// root, which holds every session on the machine, would otherwise grow by one
// file per session forever.
//
// Age is the file's own mtime rather than its recorded writtenAt: the writer
// creates the file at the instant it records, an unparseable or hand-edited
// record still ages out, and no file has to be opened to judge one. The listing
// is bounded and the cap named, so a directory somebody has filled cannot turn a
// turn end into a walk of it. Best-effort throughout: a file that raced away or
// is not ours to remove is left, since nothing here is a precondition for the
// write that drives it, and a root that cannot be opened sweeps nothing.
function sweepRoleBoundaryMarkers() {
    const dir = roleBoundaryRoot();
    if (dir === null) return { removed: 0, bounded: false };
    const cutoff = Date.now() - ROLE_BOUNDARY_MAX_AGE_MS;
    const listing = listBoundedNames(dir, ROLE_BOUNDARY_MAX_NAMES, isRoleBoundaryEntry);
    let removed = 0;
    for (const name of listing.names) {
        const full = path.join(dir, name);
        try {
            const st = fs.lstatSync(full);
            if (!st.isFile() || st.mtimeMs > cutoff) continue;
            fs.unlinkSync(full);
            removed += 1;
        } catch { /* raced away, or not ours to remove */ }
    }
    return { removed, bounded: listing.bounded };
}

function readConsentResult(cwd) {
    return readMarkerResult(consentPath(cwd));
}

// The swallowing forms the gate takes, because every refusal leg means the
// same thing to it: no marker releases anything. Same split as readGateState
// over readGateStateResult.
function readRoleBoundary(sessionId) {
    try {
        return readRoleBoundaryResult(sessionId).marker;
    } catch {
        return null;
    }
}

function readConsent(cwd) {
    try {
        return readConsentResult(cwd).marker;
    } catch {
        return null;
    }
}

// Write a marker atomically through writeJsonAtomic (exclusive create, atomic
// rename, failure cleanup gated on the create having returned). Returns
// { ok:true, session } or { ok:false, reason }; never throws.
//
// The session id is held to one storage rule (a string, non-empty, within a
// 128-character cap, no control characters); the CLI additionally
// charset-gates what it accepts before this is reached, so this guard is the
// floor, not the whole gate. There is no unscoped form: a marker without a
// session would release whichever session's offer arrived first, which is the
// one shape the design forbids, so a caller with no usable id gets a refusal
// rather than a wildcard. consumed is written as a literal false, the only
// value the match rule reads as live. Unlike the gate's own record targets,
// the directory is created here: the marker writers are what make a project
// kit-governed, boundary and consent alike. The create is the same helper for
// both kinds, so the role-boundary root under ~/.kit gains the same ignore marker
// the store-backed scratch directory under ~/.kit/store gains: neither sits in
// a repository, and one create for every marker directory is what keeps the
// symlink screen that helper carries in front of every marker write.
//
// `declared` records provenance, and it is the field the moment rule below is
// scoped by: true only for the boundary verb's deliberate declaration, absent
// for every other writer, so a marker's own record says which rule governs it
// rather than a call site restating the distinction. `position` rides with it,
// where the transcript could be measured: the byte offset the declared moment
// sits at and a fingerprint of what preceded it, which is what the moment rule
// reads forward from. Both fields are machine written here and nowhere else;
// no prose ever asks anyone to produce either.
//
// The pair is written together or not at all. A declaration whose transcript
// could not be measured records no position and the moment rule lapses it,
// which is the conservative end: a marker that cannot be vouched for buys a
// deferral, where one honored on an unread transcript buys a compaction in the
// middle of a turn.
function writeMarkerFile(target, sessionId, declared, position) {
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > 128
        || /[\x00-\x1F]/.test(sessionId)) {
        return { ok: false, reason: 'session id is invalid' };
    }
    const state = {
        session: sessionId,
        writtenAt: new Date().toISOString(),
        consumed: false
    };
    // Written only on the declaring path, so the file the seat-stop hook
    // produces is byte-identical to the one it produced before these fields
    // existed and reads as the window-scoped marker it has always been.
    if (declared === true) {
        state.declared = true;
        if (position !== null && position !== undefined) {
            state.transcriptBytes = position.bytes;
            state.transcriptAnchor = position.anchor;
        }
    }
    try {
        ensureScratchDirIgnored(path.dirname(target));
        writeJsonAtomic(target, state);
    } catch (err) {
        return { ok: false, reason: 'could not write marker: ' + (err && err.message ? err.message : String(err)) };
    }
    return { ok: true, session: sessionId, positioned: declared !== true || (position !== null && position !== undefined) };
}

// The declaring path measures the marked session's own transcript as it writes,
// which is the file the gate later reads forward from: the position is taken
// here rather than by the caller so no call site can declare a moment without
// recording where it fell. `positioned` in the result says whether one was
// taken, for a caller that reports a declaration nothing will be able to vouch
// for.
//
// The transcript is located by the session id alone, through findTranscript,
// which delegates to memq's scan of the harness's projects directory. The
// harness files a transcript under the project key the session started in and
// never refiles it when the session moves, so a session started in a main
// checkout and declaring from a linked worktree is measured on the file it
// actually has rather than on the path the shell's directory would derive,
// which does not exist. An id the scan finds under two project directories is
// an ambiguity the scan answers null for, and the declaration records no
// position; the moment rule then lapses it, the conservative end, and the verb
// says so.
//
// The file is this session's own, so an id the resolver will not compose a name
// from is refused here in the writer's own vocabulary: there is no unscoped
// name left to fall back to, which is the property the per-session file buys. A
// root that cannot be opened is refused naming the home directory, since it is
// the cause and the id is not.
//
// This is also where the marker root is collected. Every write here is one seat
// saying something about its own file and none replaces a peer's, so the
// aged-out files a set of seats leaves behind have no other writer to retire
// them; the sweep runs after the write, on the two events that reach this
// function (a seat's turn end and a boundary declaration), which is the same
// cadence the single shared file was replaced at. It runs after rather than
// before so a failed sweep cannot cost the declaration, and its result is not
// read: nothing about this write turns on what was collected.
function writeRoleBoundary(sessionId, declared) {
    if (usableSessionId(sessionId) === null) return { ok: false, reason: 'session id is invalid' };
    const target = roleBoundaryPath(sessionId);
    if (target === null) {
        return { ok: false, reason: 'the home directory is unknown or names a network share, so no role-boundary marker root can be opened' };
    }
    const position = declared === true
        ? transcriptPosition(findTranscript(sessionId))
        : null;
    const result = writeMarkerFile(target, sessionId, declared, position);
    if (result.ok) sweepRoleBoundaryMarkers();
    return result;
}

function writeConsent(cwd, sessionId) {
    return writeMarkerFile(consentPath(cwd), sessionId);
}

// Delete a marker file if present: presence
// judged by the lstat kind check rather than existsSync (a link at the path
// reads as no marker to every reader here, so a clear that followed it would
// report consuming something nothing read as open), a failed lstat routed by
// pathErrnoClass, and a racing ENOENT reported as none-open rather than as a
// failure. Returns { ok:true, cleared:true } when a file was removed,
// { ok:true, cleared:false } when none was open, and
// { ok:false, cleared:false, reason } when a file is there and the delete
// failed or its kind could not be read. The gate calls these to
// consume a marker on the allow it caused, best-effort: a failed delete
// degrades to the gate standing open, never to a wedged session. The risk
// that choice takes is deliberate: a consume that
// fails to delete releases again on every later offer inside the marker's
// age bound, with no cap here on the count, which costs an extra compaction
// at a declared boundary (or under a standing consent), while the opposite
// choice, refusing the allow when the delete fails, would convert a locked
// file into a session riding to the ceiling,
// the exact failure the release paths exist to end.
function clearMarkerFile(target) {
    try {
        let st;
        try {
            st = fs.lstatSync(target);
        } catch (err) {
            if (pathErrnoClass(err && err.code) !== 'transient') {
                return { ok: true, cleared: false };
            }
            throw err;
        }
        if (!st.isFile()) {
            return { ok: true, cleared: false };
        }
        fs.unlinkSync(target);
        return { ok: true, cleared: true };
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            return { ok: true, cleared: false };
        }
        return {
            ok: false,
            cleared: false,
            reason: 'could not clear marker: ' + (err && err.message ? err.message : String(err))
        };
    }
}

// A session's own marker, removed at its own file. An id the resolver refuses
// names no file to remove, and that is a refusal rather than a clear that found
// nothing: the caller reports the second as a successful retraction, which is
// not what happened. A root that cannot be opened is the same refusal shape
// with the cause named.
function clearRoleBoundary(sessionId) {
    if (usableSessionId(sessionId) === null) {
        return { ok: false, cleared: false, reason: 'could not clear marker: no usable session id to scope it by' };
    }
    const target = roleBoundaryPath(sessionId);
    if (target === null) {
        return { ok: false, cleared: false, reason: 'could not clear marker: the home directory is unknown or names a network share, so no role-boundary marker root can be opened' };
    }
    return clearMarkerFile(target);
}

function clearConsent(cwd) {
    return clearMarkerFile(consentPath(cwd));
}

// ---------------------------------------------------------------------------
// The declared moment. The boundary verb's marker says the seat's context held
// nothing the disk did not at the instant it was written. That is a statement
// about a moment rather than a window: the instant a new turn begins in the
// marked session, the session is working again and the declaration no longer
// describes it, so the gate honors such a marker only while nothing has
// arrived in that session's transcript since the write.
//
// The rule is scoped by provenance, and the scoping is the whole of what keeps
// it from refusing every marker in existence. Its subject is a declaration,
// which is the marker the boundary verb writes and stamps `declared`. The
// seat-stop hook's turn-end bank carries no such field and is outside this
// rule entirely, on its age bound alone: that marker is written at a turn END,
// while a compaction offer only ever arrives inside a LATER turn, which by
// construction began with a newer inbound line, so a moment test over the hook
// path would lapse every marker it ever wrote. An undeclared marker is
// therefore answered here without the transcript being opened at all.
//
// The evidence is the transcript's inbound lines, which are two shapes rather
// than one. A `user` line is a tool result whenever its message content is an
// array carrying a tool_result block, and those are the overwhelming majority
// of user lines in a working session, the boundary command's own result among
// them: a rule reading the last user line alone would mark every marker stale
// the moment it was written. A genuine inbound message is a `user` line that
// is not a tool result, whose content is a string or an array of text blocks;
// a queued peer message additionally arrives as a `queue-operation` line,
// which is not a `user` line at all and is the exact arrival this rule exists
// to catch.
//
// Harness-injected lines are not arrivals and are excluded on the same three
// flags the automation scan excludes them on: a meta record (a skill body,
// a hook's own output replayed back, the session-start surfacing), a
// compaction summary, and a sidechain turn. Without that exclusion a seat that
// declares a boundary and then loads a skill lapses its own declaration, which
// is the harness talking to the model rather than anyone arriving.
//
// What settles "since the write" is POSITION rather than time. A transcript's
// lines are appended in order, so everything past a byte offset was written
// after everything before it; their timestamps are not in that order, and a
// line later in a real transcript routinely carries a stamp minutes older than
// the line before it. So the declaration records where the transcript ended at
// the instant it was made, and this rule reads forward from there. A rule that
// instead inferred the read's coverage from timestamps would honor a marker
// whose arrival sat outside the window it inspected, which is a compaction
// landing mid-turn: the one direction this rule exists to refuse.
//
// Every unanswerable question is stale rather than fresh, so this leg fails
// toward deferral the way the gate's other legs do: a declared marker carrying
// no recorded position, an absent or unreadable transcript, a transcript that
// no longer matches the recorded position, an appended stretch past the read
// bound, and a line in that stretch that will not parse.
// ---------------------------------------------------------------------------

// How much of the appended stretch the moment rule reads. What the cap has to
// cover is not the transcript, which on a held seat runs to tens of megabytes,
// but what was appended since the declaration, which is seconds to tens of
// seconds of one session (an offer recurs every half minute or so while a
// compaction is being held). An arrival inside the cap is answered from what
// was read; a stretch running past it with no arrival inside is answered as
// unknown and lapses, rather than being read as an absence of arrivals.
const MOMENT_APPEND_MAX_BYTES = 512 * 1024;

// How much of the transcript before the recorded position is fingerprinted, so
// a file replaced or rotated under the same path is not read as the one the
// declaration measured. A few kilobytes are several whole records of a shape
// nothing else produces; the offset alone would be satisfied by any file that
// happens to be long enough.
const MOMENT_ANCHOR_MAX_BYTES = 4 * 1024;

// A hex digest of `text`, short enough to sit in a marker file and long enough
// that two different transcripts do not collide on it.
function momentAnchorDigest(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32);
}

// Where a transcript ends right now, as the position a declaration records:
// { bytes, anchor }, or null where nothing can be measured (no path, not a
// readable regular file, or a file whose last line boundary cannot be found).
//
// The position is the end of the last COMPLETE line rather than the file's own
// end, which is what makes reading forward from it parse whole records: a
// record caught mid-append at the declaration is left on the far side of the
// offset, so it is judged when it is whole rather than as a fragment. That is
// also the conservative side, since a record being appended at the instant of
// the declaration is judged as an arrival if it turns out to be one.
function transcriptPosition(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return null;
        if (st.size === 0) return { bytes: 0, anchor: momentAnchorDigest('') };
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const window = Math.min(st.size, MOMENT_ANCHOR_MAX_BYTES);
            const tail = readFully(fd, st.size - window, window);
            const lastBreak = tail.lastIndexOf('\n');
            // No line boundary inside the window: where the window is the whole
            // file the transcript holds no complete line yet, and where it is
            // not, the last record is longer than the window and its start
            // cannot be found from here. Neither can be positioned.
            if (lastBreak === -1) return null;
            // Measured back from the file's end rather than forward from the
            // window's start: the window starts at an arbitrary byte, so its
            // decoded head can open on a replacement character whose length is
            // not the length of the bytes it stands for, while the fragment
            // after the last newline runs to the end of the file.
            const bytes = st.size - Buffer.byteLength(tail.slice(lastBreak + 1), 'utf8');
            const anchorFrom = Math.max(0, bytes - MOMENT_ANCHOR_MAX_BYTES);
            return {
                bytes,
                anchor: momentAnchorDigest(readFully(fd, anchorFrom, bytes - anchorFrom))
            };
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return null;
    }
}

// What the transcript has gained since a recorded position, as
// { text, bounded } for a readable stretch, or { reason } naming why it cannot
// be read:
//
//   'unreadable'  the path is absent, is not a regular file, or the read failed
//   'replaced'    the file is shorter than the recorded position, or the bytes
//                 before that position no longer hash to the recorded anchor:
//                 a truncated, rotated or different file, whose arrivals since
//                 the declaration are unknowable
//
// `bounded` says the stretch runs past the read bound, so an absence of
// arrivals inside the text is not an absence of arrivals: the caller answers a
// found arrival from what it read and answers a bounded read with no arrival in
// it as unknown. The read starts at the recorded position rather than at the
// file's end, so an arrival that landed first is inside the bound however much
// followed it.
//
// The isFile check is the same narrowing readTranscriptCapped applies and for
// the same reason (a FIFO planted here would block inside the read, where no
// try/catch can rescue it).
function readMomentAppend(transcriptPath, from, anchor) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return { reason: 'unreadable' };
        if (st.size < from) return { reason: 'replaced' };
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const anchorFrom = Math.max(0, from - MOMENT_ANCHOR_MAX_BYTES);
            if (momentAnchorDigest(readFully(fd, anchorFrom, from - anchorFrom)) !== anchor) {
                return { reason: 'replaced' };
            }
            const grown = st.size - from;
            const take = Math.min(grown, MOMENT_APPEND_MAX_BYTES);
            return { text: readFully(fd, from, take), bounded: grown > take };
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return { reason: 'unreadable' };
    }
}

// Whether a parsed transcript entry is an inbound message, by the two shapes
// the section header states. A `user` line whose content array carries a
// tool_result block is the harness reporting a tool call back to the model,
// which is not a new turn arriving; nor is anything the harness injects, which
// is the isSidechain / isMeta / isCompactSummary triple the automation scan
// (userTypedText below) screens on, read here on the same three flags and in
// the same order so the two readers of this transcript cannot disagree about
// what the harness wrote to itself.
function entryIsInbound(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.isSidechain || entry.isMeta === true || entry.isCompactSummary === true) return false;
    if (entry.type === 'queue-operation') return true;
    if (entry.type !== 'user') return false;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) return true;
    return !content.some(block => block && typeof block === 'object' && block.type === 'tool_result');
}

// Whether a marker is the boundary verb's declaration, which is the only kind
// the moment rule governs. The provenance decision lives here alone: a call
// site asking whether the moment holds gets the scoping with it, so no reader
// can apply the rule to the seat-stop hook's turn-end bank by forgetting a
// condition.
function markerDeclaresMoment(marker) {
    return !!marker && typeof marker === 'object' && marker.declared === true;
}

// The transcript position a declaration recorded, or null where it carries
// none that can be used. A declared marker without one cannot be positioned
// and so cannot be vouched for, which its caller reads as lapsed: the writer
// records the pair or records neither, so a marker missing it was written by
// something other than this file's writer, or written where no transcript
// could be measured.
function markerMomentPosition(marker) {
    if (!markerDeclaresMoment(marker)) return null;
    const bytes = marker.transcriptBytes;
    const anchor = marker.transcriptAnchor;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return null;
    if (typeof anchor !== 'string' || anchor === '') return null;
    return { bytes, anchor };
}

// Whether the marker still describes the moment it was written in, given the
// marked session's transcript. Returns { ok:true, reason:null } while it does,
// which is also the answer for every marker that declares no moment, else
// { ok:false, reason } naming the clause that refused it:
//   'no-position'  the declaration records no usable transcript position, so
//                  there is nowhere to read from and nothing can be vouched
//   'unreadable'   the transcript is absent, not a regular file, or the read
//                  failed
//   'replaced'     the transcript is shorter than the recorded position, or
//                  what sits before that position no longer matches what was
//                  there: a truncated, rotated or different file
//   'too-long'     nothing arrived inside the stretch the read covers, and
//                  more was appended past it, so the rest is unknown
//   'torn'         a whole line of the appended stretch will not parse, so
//                  what it was cannot be answered
//   'inbound'      a message arrived after the marker was written
//
// An arrival found inside the bounded read is an arrival whatever sits past
// the bound, so 'inbound' is answered before 'too-long' rather than after it.
//
// Only the LAST line of the stretch may be a fragment and only it is passed
// over: the gate runs while the session is live, so the record at the end of
// the file is routinely one caught mid-append, and a bounded read ends on a
// fragment by construction. That is also exactly where an arrival lands, so an
// unparseable line anywhere before it is answered as unknown rather than
// skipped.
//
// No timestamp is read here at all. Position is what orders a transcript's
// lines; their stamps are not ordered, so a rule resting on them can be shown
// an arrival it reads as predating the write.
function markerMomentHolds(marker, transcriptPath) {
    if (!markerDeclaresMoment(marker)) return { ok: true, reason: null };
    const position = markerMomentPosition(marker);
    if (position === null) return { ok: false, reason: 'no-position' };
    const appended = readMomentAppend(transcriptPath, position.bytes, position.anchor);
    if (appended.reason !== undefined) return { ok: false, reason: appended.reason };
    const lines = appended.text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '') continue;
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            if (i === lines.length - 1) continue;
            return { ok: false, reason: 'torn' };
        }
        if (entryIsInbound(entry)) return { ok: false, reason: 'inbound' };
    }
    if (appended.bounded) return { ok: false, reason: 'too-long' };
    return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// The registry record of a declared boundary.
// ---------------------------------------------------------------------------

// The store's coordinator directory, holding one directory per machine. Every
// path into that directory is composed from this, so the location has one
// spelling however many callers reach for it: the stamps here, the seat-stop
// hook's heartbeat, and the stamp audit's default scope and containment screen.
function coordinatorRoot() {
    return path.join(os.homedir(), '.claude', 'coordinator');
}

// This machine's own directory under that root.
function coordinatorDir() {
    return path.join(coordinatorRoot(), os.hostname());
}

// A registered session's entry under the machine's coordinator directory, or
// null. The id is held to the shared marker-scope rule before it is joined to
// anything, so a value carrying a separator or a parent segment never composes
// a path here at all.
function registryEntryPath(sessionId) {
    if (usableSessionId(sessionId) === null) return null;
    return path.join(coordinatorDir(), 'registry', sessionId + '.md');
}

// The value of a `<Field>: <value>` line, or null where the text carries no
// such line. The shape is the role skill's directory contract's, and one
// spelling serves every reader of these files: the seat-stop hook's freshness
// reads and the stamp audit's, which would otherwise be two copies of one
// grammar pinned only by their own tests.
function registryField(text, name) {
    const match = new RegExp('^' + name + ':[^\\S\\r\\n]*(.*)$', 'm').exec(text);
    return match === null ? null : match[1].trim();
}

// The renderer for a channel a model reads, in one place. Every writer into
// such a channel goes through it rather than spelling the elision again: the
// guard belongs to the channel rather than to whichever caller first needed it,
// and two spellings of it drift, with the one a caller reaches for then decided
// by which file it happens to sit beside.
//
// Five exported parts. sanitizeForOutput renders one repo-controlled value;
// displayPath renders a value already known to be a path; scrub takes the home
// directory out of a whole composed line, which is what a caller's own emitter
// hands it; scrubAfterStrip is that same elision for a second pass over text a
// strip has deleted characters from, which is the one place the name boundaries
// are dropped; and homeElisionsKnown answers whether a home directory is
// knowable at all, which is the reading a caller states out loud when its floor
// is off.

// The length a repo-controlled string is printed within absent a caller's own
// cap. One number, so the value and the mark that says it was shortened cannot
// be decided against two.
const PRINT_CAP = 120;

// Repo-controlled strings (a timestamp read back from disk, a session id, a
// verdict word) are sanitized to printable ASCII and length-capped before they
// reach stdout/stderr, matching the sibling hooks' convention for any repo data
// entering a trusted output channel. A value that is a PATH takes displayPath
// below instead.
//
// Both ways of DISCARDING text are marked, because both leave the reader
// looking at something that is not the value. The cap takes the tail off. The
// strip deletes characters from the middle of an accented or CJK name and
// leaves a plausible-looking shorter one, which is the worse of the two on the
// legs that hand the operator a path and tell them to remove that file: a name
// altered without a mark sends them after something that is not on disk. A
// value can take both marks, so the two are decided separately and read
// together. The third alteration, the channel's home elision, shortens a value
// too and carries no mark of its own; scrub below states why it needs none.
//
// Four steps in one order, and the order is what both marks rest on. The
// channel's home elision runs first, over the text as given, which is where a
// spelling standing whole in the argument is taken out under the full boundary
// rule. The strip runs next, so the cut is decided on what is actually EMITTED
// rather than on the string before sanitizing: a value carried past the cap only
// by characters the strip removes is not cut at all, and marking it as cut would
// name a truncation that did not happen. The elision runs again over the stripped
// text, for two reasons that are not cosmetic. A value carried past the cap only
// by a home prefix the channel takes out is not cut either, and eliding after the
// cap is eliding a home spelling the cut may have taken in half, which no pattern
// built from the whole spelling can match, so the account name would reach the
// channel in a fragment on exactly the machines whose home directory is long. And
// the strip DELETES what it removes, so a non-printable character inside a home
// spelling breaks it for the first pass and the deletion puts it back together
// for the second.
//
// That second pass runs through scrubAfterStrip, which drops the leading boundary
// wherever the strip removed anything. The boundary is what keeps a neighbouring
// directory its own name, and a deleted character can glue a home spelling onto
// the word in front of it, which the boundary then refuses: two stripped
// characters, one before a spelling and one inside it, would otherwise carry the
// account name past both passes. Dropping the boundary on stripped text costs an
// over-elision there, a path nowhere on disk, which is the cheap direction; text
// the strip left alone keeps the boundary and so keeps a foreign home path such
// as /mnt/backup/home/<name>/repo its own name.
//
// The cap runs last, over the text the reader will see, and the marks are
// appended after it so a mark is never itself cut. The strip's mark is read
// against the text the strip was handed rather than against the argument, since
// the elision ahead of it shortens a value too and says so for itself.
function printableAscii(s) {
    return String(s).replace(/[^\x20-\x7E]/g, '');
}

function sanitizeForOutput(s, max) {
    const given = scrub(String(s));
    const stripped = printableAscii(given);
    // The strip only ever deletes, so a length change is the whole of whether it
    // removed anything, and it decides both the mark and the second pass's rule.
    const removed = stripped.length !== given.length;
    const elided = scrubAfterStrip(stripped, removed);
    const shown = elided.slice(0, max === undefined ? PRINT_CAP : max);
    const marks = [];
    if (removed) marks.push('characters removed');
    if (shown.length < elided.length) marks.push('cut to fit');
    return shown + (marks.length === 0 ? '' : ' [' + marks.join('; ') + ']');
}

// A filesystem path for the operator's eye. The home prefix is elided to `~`,
// because the OS account name is in it and this output is read by a model.
// Eliding is what keeps a realistic path inside the cap, so the cut mark
// sanitizeForOutput appends is the rare case rather than the ordinary one.
//
// This is the renderer for a value KNOWN to be a path, and it runs beside the
// channel's own floor rather than instead of it: sanitizeForOutput elides every
// value it is handed and a caller's emitter scrubs whatever text was composed,
// path or sentence, and a value elided here passes through both unchanged. The
// two are aimed at different problems. The containment test here is
// boundary-aware and answers on components, so it reaches a spelling the text of
// the home directory does not appear in at all (a path routed through `..`, or
// one differing only in letter case on win32); the elision scrub applies is
// textual, which is what a path embedded in the middle of an error sentence
// allows.
//
// Containment is decided by path.relative rather than by a prefix test on the
// text, because a prefix test is wrong in both directions once the input is not
// home-composed. It over-elides a sibling whose name merely starts with the home
// directory's (home /home/ad, project /home/admin/repo prints as ~min/repo), and
// on win32 it under-elides a path differing from the home directory only in
// letter case, printing the OS account name raw into a channel a model reads.
// path.relative answers on components rather than characters and is
// case-insensitive on win32, which is both directions at once; kitScratchDir
// above decides the same question the same way. A relative result that is
// absolute, or that escapes upward, means the path is somewhere else; the empty
// result means the path IS the home directory and elides to `~` alone, which is
// the one reading where the account name would otherwise be the whole output.
//
// A RELATIVE input is never elided, which is what keeps a repo-relative plan
// path printing as itself. path.relative would otherwise resolve it against the
// process's own cwd first, so `docs/plans/x.md` in a checkout under the home
// directory would come back rewritten as an absolute ~-anchored path: a longer,
// stranger rendering of a value that carried no home prefix to elide.
function displayPath(full) {
    const text = String(full);
    let home = '';
    try { home = os.homedir(); } catch { home = ''; }
    let shown = text;
    if (home !== '' && path.isAbsolute(text)) {
        const rel = path.relative(home, text);
        if (!path.isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel)) {
            shown = rel === '' ? '~' : '~' + path.sep + rel;
        }
    }
    // The marks sanitizeForOutput appends are what say the name on the line is
    // not the name on disk, in both directions: a cut tail and a stripped middle.
    return sanitizeForOutput(shown);
}

// The home directory in the spellings a model-read channel's output can carry
// it in, as the patterns that channel elides it by, beside an explicit reading
// of whether a home directory is knowable at all.
//
// The two are separated because one empty list would otherwise answer both, and
// they are opposite news for a channel whose floor is this elision. Nothing to
// elide is the floor standing. No knowable home directory is the floor OFF, and
// os.homedir() can throw and follows USERPROFILE and HOME, so a stripped
// environment turns the whole guard off silently: homeElisionsKnown below is
// what lets a caller state that case out loud rather than passing values
// through unmarked.
//
// The flattened spelling is what a transcript path carries: a session's
// transcript is filed under a directory named by the whole project path with
// each non-alphanumeric character turned to a dash (sanitizeProjectPath in
// scripts/memq.js), so for a checkout under the home directory the account name
// sits in the MIDDLE of that path, inside one component, where eliding a
// leading prefix cannot reach it.
//
// A match has to end at a boundary rather than mid-name, which is the bug a raw
// substring replace reproduces: home C:\Users\a against C:\Users\admin\repo
// renders as ~dmin\repo, a path that is nowhere on disk, on legs whose purpose
// is naming a file to act on. Both edges of the literal are therefore DENY-lists
// of the characters that would make the text a different name, never allow-lists
// of the characters that may stand beside it. That direction is what the two
// failure costs decide: over-elision prints a path nowhere on disk, while
// under-elision prints the OS account name into a channel a model reads, and an
// allow-list leaks on every neighbour nobody thought to name, an equals sign, a
// comma, a colon, an angle bracket, a parenthesis. So the trailing edge refuses
// an alphanumeric, a dot, an underscore and a dash, which are the characters
// that would make this another name (<home>-sib and <home>X keep their own
// names), and admits everything else, a separator and a quote and a bracket and
// a comma alike; sanitizeForOutput's own marks ride on that, since it appends them as
// ` [cut to fit]` and a home directory at the end of a marked value is followed
// by a space and then a bracket.
//
// The leading edge refuses the same characters and NOT a separator. Without a
// leading edge at all the match floats: POSIX home /home/admin turns
// /mnt/backup/home/admin/repo/.kit/x.json into /mnt/backup~/repo/.kit/x.json,
// and win32 is not immune by design, only by its home spelling starting with a
// drive letter. Refusing an alphanumeric in front is what kills that case, the
// candidate /home/admin there being preceded by the p of backup. A separator in
// front is admitted, because the spellings that carry one introduce the SAME
// directory rather than another name: a win32 long-path prefix (\\?\C:\Users\a),
// a file URL (file:///C:/Users/a) and a doubled separator (//C:/Users/a) all
// name the home directory, and refusing them prints the account name into the
// channel, the expensive direction. What admitting it costs is a
// doubled-separator spelling of some other path eliding to a path nowhere on
// disk, the cheap one, which is the direction every edge here fails in.
//
// Each literal spelling is compiled twice more, once with both of those edges
// and once with neither, which is the pair scrub and scrubAfterStrip read. The
// second table exists because the strip that runs between the two elision passes
// deletes rather than replaces: a character taken out from beside a home
// spelling glues it onto whatever text stood on that side, and an edge that
// refuses an alphanumeric then refuses the site. Neither edge survives that,
// because a deletion after a spelling glues the following word onto it exactly
// as one before it glues the preceding word on: a spelling carrying a stripped
// character inside it, which is what hides it from the first pass, followed by
// one more stripped character and then a word, reassembles into a whole home
// spelling with a name character behind it and would print the account name in
// full. On text a strip has already altered, both edges have lost their premise,
// so the relaxed table matches a spelling wherever it sits and accepts the
// over-elision that comes with it.
//
// In the flattened spelling the separator is a dash and so is the character a
// dash was made from, so a child and a sibling are indistinguishable there and
// any non-alphanumeric character ends the match: where the flattened form cannot
// tell the two apart, eliding is the direction that keeps the account name off
// the channel. It takes no leading boundary at all, deliberately: it rides
// inside one component by construction, which is the whole reason it is elided
// separately from the leading prefix.
//
// Each spelling is built TWICE, from the raw home directory and from its
// printable-ASCII form, because the text this elides has in one of its two
// passes already been stripped: sanitizeForOutput's second pass runs over text
// its strip has deleted characters from, so on a home directory carrying an
// accented or CJK character the raw spelling is one no emitted line can ever
// contain, and C:\Users\Jose with an accent on the e reaches the channel as
// C:\Users\Jos. Building the same patterns from printableAscii(home) covers the
// text as it will actually be emitted. On an all-ASCII home the two are
// identical and the duplicates are dropped. What that costs is a real sibling
// directory spelled like the stripped home being elided too, which is the
// flattened spelling's own trade taken for the same reason: where the strip has
// made two names indistinguishable, eliding keeps the account name off the
// channel.
//
// A home directory AT A FILESYSTEM ROOT yields no patterns at all. C:\ reduces
// to C:, which carries an alphanumeric and would otherwise elide the drive
// prefix of every path on this channel, printing `removing ~\proj\.kit\x.json`
// for a file at C:\proj. A root holds no account name, so there is nothing here
// to take out of it. The same refusal covers a spelling the strip SHORTENED by a
// whole component, which the root test alone does not reach: a home whose final
// component is wholly non-ASCII strips to C:\Users\, and a pattern for C:\Users
// elides every account's paths on this channel, other accounts' included, into
// paths that are nowhere on disk. A spelling that names fewer path components
// than the home directory itself is a different directory, so it is skipped.
//
// The literal's separators match a RUN of either slash, since a path can arrive
// in either spelling and a doubled separator names the same directory it would
// name single (C:\\Users\\name and /home//name are both the home directory), so
// a spelling that doubles one is elided rather than printed with the account
// name in it. win32 matches without regard to letter case, as its filesystem
// does.
function homeElisions() {
    let home = '';
    try { home = os.homedir(); } catch { home = ''; }
    home = String(home);
    if (home === '') return { known: false, elisions: [], relaxed: [] };
    const root = String(path.parse(home).root).replace(/[\\/]+$/, '');
    const escape = (s) => s.replace(/[^A-Za-z0-9]/g, (ch) => '\\' + ch);
    const flags = process.platform === 'win32' ? 'gi' : 'g';
    const lead = '(?<![A-Za-z0-9._-])';
    const trail = '(?![A-Za-z0-9._-])';
    // How many path components a spelling names, which is the measure the guard
    // below compares the stripped spelling against.
    const depth = (s) => s.split(/[\\/]+/).filter((part) => part !== '').length;
    const homeDepth = depth(home.replace(/[\\/]+$/, ''));
    const elisions = [];
    const relaxed = [];
    const seen = new Set();
    const seenRelaxed = new Set();
    for (const spelling of [home, printableAscii(home)]) {
        const named = spelling.replace(/[\\/]+$/, '');
        if (!/[A-Za-z0-9]/.test(named) || named === root) continue;
        // A spelling naming fewer components than the home directory is some
        // ancestor of it rather than it, and eliding an ancestor takes every
        // account's paths off the channel rather than this account's name.
        if (depth(named) < homeDepth) continue;
        const literal = Array.from(named)
            .map((ch) => (ch === '\\' || ch === '/' ? '[\\\\/]+' : escape(ch)))
            .join('');
        // A spelling that STARTS with a separator run is entered at the run's
        // own first character and nowhere else. Without that anchor, every
        // character of a run in the text is a start position, and each one
        // consumes the whole run again before failing, which is quadratic in
        // the run's length: the text reaching this channel is not bounded by
        // anything the writer controls, a stored memory body arriving at its
        // own cap among it, so a run of a few tens of thousands of separators
        // costs seconds. The greedy run inside the anchored form backtracks
        // once per run rather than once per start position, which is linear.
        //
        // The anchor alone would narrow the match set, because the leading
        // boundary refuses the run's first character exactly where the anchor
        // is the only position left: a run behind a name character, as in
        // /mnt/backup//home/name, has its first separator refused by the
        // boundary and every later one by the anchor, and the account name
        // prints. So a spelling starting with a run takes the anchor with the
        // boundary folded INSIDE it as an alternation, and takes no outer
        // boundary of its own. The two branches are the two ways the leading
        // boundary admitted a run: the run's start carries no name character
        // in front of it, or the run is two or more separators long, which is
        // the case the boundary admitted one character in. That is the match
        // set the boundary alone had, entered once. The elision starts at the
        // run's first character rather than its second, since the whole run is
        // one separator's worth of the same directory and belongs to the
        // spelling it introduces.
        const leadingRun = '[\\\\/]+';
        const startsWithRun = literal.startsWith(leadingRun);
        const anchored = startsWithRun ? '(?<![\\\\/])' + literal : literal;
        const bounded = startsWithRun
            ? '(?<![\\\\/])(?:' + lead + leadingRun + '|[\\\\/]{2,})'
                + literal.slice(leadingRun.length) + trail
            : lead + literal + trail;
        const flattened = escape(named.replace(/[^A-Za-z0-9]/g, '-'));
        for (const [source, unbounded, shown] of [
            [bounded, anchored, '~'],
            [flattened + '(?![A-Za-z0-9])', flattened, 'flattened-home']
        ]) {
            if (!seen.has(source)) {
                seen.add(source);
                elisions.push({ pattern: new RegExp(source, flags), shown });
            }
            if (!seenRelaxed.has(unbounded)) {
                seenRelaxed.add(unbounded);
                relaxed.push({ pattern: new RegExp(unbounded, flags), shown });
            }
        }
    }
    return { known: true, elisions, relaxed };
}

// Read once at module load: a process's home directory does not move under it,
// and the patterns are compiled rather than rebuilt per line.
const HOME_ELISIONS = homeElisions();

// Whether a home directory is knowable in this process at all. A caller whose
// output channel rests on the elision reads this to decide whether its floor is
// standing, since an empty elision list on its own answers two facts and only
// one of them is news: nothing to elide is ordinary, while no knowable home
// directory means every path on the lines that follow carries whatever the OS
// account name is, with nothing else on that channel saying so.
function homeElisionsKnown() {
    return HOME_ELISIONS.known;
}

// A text as the channel prints it, with the home directory's name taken out of
// it in every spelling wherever in the text it sits. Two kinds of caller:
// sanitizeForOutput above, which hands it one repo-controlled value before the
// cap is applied, and a writer's own emitter, which hands it a whole composed
// line. The value the second catches that displayPath cannot is a path embedded
// in an error reason: fs errors name the file the syscall was refused on, and a
// caller printing that reason is printing a sentence rather than a path.
//
// The substitution is not marked the way sanitizeForOutput marks its cut and its
// strip, and it needs no mark: both replacements say for themselves that the
// text was altered and what was taken out. `~` is the operator's own shorthand
// for the home directory, and `flattened-home` is not a spelling any component
// on disk carries, so a reader who needs the real path can put their home
// directory back where the mark is. A cut tail and a stripped middle have no
// such self-evident spelling, which is why those two are marked and this is not.
function scrub(text) {
    let shown = String(text);
    for (const elision of HOME_ELISIONS.elisions) shown = shown.replace(elision.pattern, elision.shown);
    return shown;
}

// The same elision for a SECOND pass over text a printable-ASCII strip has
// already been through, which is the one place the name boundaries are dropped.
//
// A caller that strips before it prints runs the elision on both sides of the
// strip, because the strip deletes: a non-printable character inside a home
// spelling hides it from the first pass and is gone by the second. What the
// second pass then meets is text whose neighbouring characters are not the ones
// the writer put there, so a spelling can arrive glued onto the text beside it,
// and the boundaries, which exist to keep a directory whose name merely runs on
// from another its own name, refuse it. Both edges are in that state, not the
// leading one alone: a deletion in front of a spelling glues the preceding word
// on, and a deletion after it glues the following word on. Either of them,
// paired with the stripped character inside the spelling that hid it from the
// first pass, is enough to carry the OS account name through a guard that keeps
// its boundaries on both passes.
//
// So the caller says whether the strip removed anything, and where it did this
// matches with no boundary at either edge. The cost is an over-elision on a value
// that carried a stripped character, a path printed under the home shorthand
// while sitting somewhere else on disk; the cost of the other direction is the
// account name on a channel a model reads. Text the strip left untouched takes
// scrub above and keeps both boundaries, so a foreign home path such as
// /mnt/backup/home/<name>/repo is still printed under its own name.
function scrubAfterStrip(text, strippedSomething) {
    if (!strippedSomething) return scrub(text);
    let shown = String(text);
    for (const elision of HOME_ELISIONS.relaxed) shown = shown.replace(elision.pattern, elision.shown);
    return shown;
}

// The one character this kit bars beyond printable ASCII, spelled once for
// every gate that removes it: the renderer below, which takes it out on the way
// to a channel, and memq's charset rule, which takes it out on the way to disk.
// Two spellings of one character are two answers to the question of what is
// barred, and the gates are meant to give one.
const BARRED_QUOTE = /"/g;

// A composed sentence as a channel prints it, under the caller's own cap: the
// elision, the barred character, the strip, the second elision and the cut.
//
// THIS IS THE OUTPUT CHANNEL'S GUARD AND NOT ANY ONE CALLER'S. Every value that
// takes it is a sentence composed around a path, a lock's reason, a server's own
// message or an operating system's error text, and the callers that compose such
// sentences are several: memq renders them to a terminal, and the memory
// database client renders the same sentences onto a column every sandbox in the
// fleet reads. A caller that spelled this render itself would be one edit away
// from a channel that keeps a character its sibling removes, or cuts at a point
// its sibling does not, and the two texts under one run would then differ with
// nothing to say which is the value.
//
// Four passes rather than one, because the elision matches whole spellings: one
// non-printable character inside a home spelling hides it from the first pass,
// and the strip the renderer runs deletes that character and puts the spelling
// back together. So the elision runs, the barred character goes, and then
// sanitizeForOutput's own strip, second elision and cap finish the job, which is
// the order and the reasoning scrubAfterStrip above states.
//
// The barred character goes ahead of the renderer rather than after it, so the
// cap and the marks the renderer appends are decided on the text the reader
// actually sees. The second elision drops its leading boundary wherever that
// removal took something out, since a deleted quote can glue a home spelling
// onto the word in front of it.
//
// The cap is the caller's, because what one sentence is worth differs by
// channel, and each caller keeps its own constant where that channel's other
// widths live.
function shownText(value, cap) {
    const elided = scrub(String(value));
    const unquoted = elided.replace(BARRED_QUOTE, '');
    return sanitizeForOutput(scrubAfterStrip(unquoted, unquoted.length !== elided.length), cap);
}

// A registry entry is a handful of short lines. Anything past this is not one,
// and is left untouched rather than parsed.
const REGISTRY_ENTRY_MAX_BYTES = 64 * 1024;

// A coordinator file's text, or null with the clause that refused it. Both
// mechanical stampers of registry entries read through this, the boundary
// verb's `Banked:` stamp here and the seat-stop hook's `Heartbeat:` stamp, and
// so does the stamp audit's read of every coordinator file it scans, so the
// screen is a property of these files as a channel rather than of whichever
// writer needed it first.
//
// lstat, not stat: a link planted at the entry path is judged as a link rather
// than as whatever it points at, which is the screen every marker read in this
// file already takes, and the reason is sharper here, since both stampers
// rename over the path they read and following a link would aim an atomic write
// at a file of someone else's choosing. The size cap is the same conservatism:
// a file past it is not the shape the reader expects and is left untouched
// rather than parsed. It defaults to the registry entry's own bound, and a
// caller reading a coordinator file of another shape passes that file's, the
// board running to tens of thousands of bytes where an entry is a handful of
// short lines. Never throws.
function readRegistryEntryText(full, maxBytes) {
    const cap = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : REGISTRY_ENTRY_MAX_BYTES;
    try {
        const st = fs.lstatSync(full);
        if (!st.isFile()) return { text: null, reason: 'not a regular file' };
        if (st.size > cap) {
            return { text: null, reason: 'the file is too large to be the shape this reads' };
        }
        return { text: fs.readFileSync(full, 'utf8'), reason: null };
    } catch {
        return { text: null, reason: 'no readable file at that path' };
    }
}

// Replace a registry entry's whole text atomically, as { ok, reason }. The
// other half of the shared channel: one atomic write serves both stamps, so
// neither can drift from the discipline the other keeps.
//
// The three defences atomicTmpPath's own comment states, taken together because
// each is worthless alone: an unguessable temporary name, an exclusive create
// that refuses a path already occupied, and a cleanup gated on that create
// having returned, so a failure path can only remove the file this writer made.
// The temporary's name is transient-shaped, so the store's sync allowlist
// refuses it and a crash between the write and the rename leaves nothing that
// replicates. Never throws.
function writeRegistryEntryAtomic(full, text) {
    const tmp = atomicTmpPath(full);
    let created = false;
    try {
        // Create and write are separate calls, and the close is split from the
        // write, for writeJsonAtomic's own two reasons: `created` has to mean
        // "the exclusive create returned" for the cleanup below to be safe, and
        // a close error after a returned write is where a deferred write error
        // surfaces, which must not be dropped behind a success.
        const fd = fs.openSync(tmp, 'wx');
        created = true;
        let wrote = false;
        try {
            fs.writeFileSync(fd, text, 'utf8');
            wrote = true;
        } finally {
            try {
                fs.closeSync(fd);
            } catch (closeErr) {
                if (wrote) throw closeErr;
            }
        }
        fs.renameSync(tmp, full);
        return { ok: true, reason: null };
    } catch (err) {
        // Only what this writer created is this writer's to remove (see
        // atomicTmpPath).
        if (created) {
            try { fs.unlinkSync(tmp); } catch { /* nothing left to clean up */ }
        }
        return {
            ok: false,
            reason: 'could not write the registry entry: ' + (err && err.message ? err.message : String(err))
        };
    }
}

// A moment nudged one millisecond past a whole second, and returned as read
// otherwise. isOwnPrecisionStamp below recognizes this file's own clock reads
// by their non-zero millisecond part, and a real read lands on a whole second
// about once in a thousand times; nudging that one case is cheaper than
// widening the recognizer to admit a stamp a hand-typed value could produce
// just as easily.
function stepOffWholeSecond(date) {
    return date.getTime() % 1000 === 0 ? new Date(date.getTime() + 1) : date;
}

// The shared middle of every mechanical stamp of a registry entry: the path,
// the read screen, the entry's own corroboration, the clock read and the atomic
// write, with the caller supplying only the rewrite. The boundary verb's
// `Banked:` stamp and the seat's own `Status-updated:` stamp both go out
// through it, so no screen and no refusal reason exists here in two copies.
//
// The time is read from the clock here at the write rather than passed in: a
// stamp templated from a value a caller has been holding reads as authoritative
// while naming a moment nobody measured.
//
// What the `Session:` comparison is, stated at its real strength rather than
// rounded up, because one of the fields written through here is the one the
// seat-stop hook gates its boundary marker on. The path is composed from a
// session id taken out of the environment, and the entry's own line is then
// compared against that same caller-supplied value, so what the comparison
// establishes is that the file at that path agrees with the id that named it,
// and never that the caller is the session either of them names: it is an
// internal-consistency screen on the file rather than authentication of the
// writer, and a process holding a peer's id passes it exactly as the peer
// would. What it does catch is the ordinary accident, a stale or foreign entry
// sitting at the path this id composes, which would otherwise be rewritten
// under a peer's name; an entry naming a different session, or naming none, is
// refused and left byte-identical.
//
// `rewrite(text, atIso)` answers { text, reason }, a null text refusing the
// stamp with that reason and leaving the entry untouched.
//
// Every failure returns { stamped:false, reason }: a stamp is a record of a
// declaration, never a precondition for it, so an absent coordinator directory,
// an absent entry, a foreign entry and a refused write all leave the caller's
// own work exactly as it was. Never throws.
//
// One residual, named rather than left for a reader to find, and it is
// stampHeartbeat's own: the entry is read whole here and rewritten whole from
// that snapshot, with no lock between the two, so a write by either of the
// entry's other writers landing inside that window is discarded silently. The
// cost is one lost line rewrite on a file whose fields are all restated at the
// next push or the next stamp, and the atomic rename is what keeps the loser a
// stale entry rather than a torn one.
function stampRegistryEntry(sessionId, rewrite) {
    const full = registryEntryPath(sessionId);
    if (full === null) return { stamped: false, reason: 'session id is invalid' };
    const read = readRegistryEntryText(full);
    if (read.text === null) return { stamped: false, reason: read.reason };
    const text = read.text;
    const named = /^Session:[ \t]*(\S+)[ \t]*\r?$/m.exec(text);
    if (named === null) {
        return { stamped: false, reason: 'the entry carries no Session line to vouch for it' };
    }
    if (!sameSessionId(named[1], sessionId)) {
        return { stamped: false, reason: 'the entry at that path names a different session' };
    }
    const at = stepOffWholeSecond(new Date()).toISOString();
    // The rewrite is the caller's own function and composes a pattern from a
    // caller-supplied field name, so the never-throws contract above is kept
    // here rather than assumed of every caller: a throw becomes an ordinary
    // refusal and the entry is left byte-identical, which is what every other
    // failure on this path already does.
    let rewritten;
    try {
        rewritten = rewrite(text, at);
    } catch {
        return { stamped: false, reason: 'the stamp for that entry could not be composed' };
    }
    // The shape check sits beside the catch rather than inside the deref for
    // the same reason the catch exists: a rewrite returning nothing at all
    // would otherwise throw a TypeError out of a function this path documents
    // as never throwing, which is the one failure the caller has no refusal to
    // read.
    if (rewritten === null || typeof rewritten !== 'object') {
        return { stamped: false, reason: 'the stamp for that entry could not be composed' };
    }
    if (rewritten.text === null) return { stamped: false, reason: rewritten.reason };
    const wrote = writeRegistryEntryAtomic(full, rewritten.text);
    if (!wrote.ok) return { stamped: false, reason: wrote.reason };
    return { stamped: true, reason: null, at };
}

// One field's line rewritten with the stamp. The entry's own line ending is
// preserved rather than assumed: the capture carries whatever carriage return
// the matched line ended on, so a stamp into a CRLF entry writes a CRLF line
// and leaves the file's endings uniform.
function rewriteFieldLine(text, name, at) {
    return text.replace(new RegExp('^' + name + ':.*?(\\r?)$', 'm'), name + ': ' + at + '$1');
}

// Whether a field's current value has the shape of this file's own clock read:
// `stampRegistryEntry`'s clock read shape exactly, `toISOString()` over a
// moment stepOffWholeSecond has already moved off the whole second, so a
// non-zero millisecond part, and Date.parse reading it as a finite moment. The
// check is of the shape and never of who wrote it, so any writer that copies a
// clock read in that shape passes it too. A moment of any other shape, a
// whole-second moment (the shape a hand composes when it omits the fraction),
// an absent line and a value Date.parse cannot read are all left for the
// caller to stamp from the clock. The check reads the value alone and never the
// registry file itself, so it carries no dependency on this file's own read or
// write path.
const STAMPER_ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(\d{3})Z$/;

function isOwnPrecisionStamp(value) {
    if (typeof value !== 'string') return false;
    const shaped = STAMPER_ISO_SHAPE.exec(value);
    if (shaped === null || shaped[1] === '000') return false;
    return Number.isFinite(Date.parse(value));
}

// Stamp each named field's existing line with now. A name the entry does not
// carry refuses the whole stamp and leaves the file byte-identical: an entry
// missing a line the contract defines is not the shape this writes into, and
// restructuring an entry is not a stamp's to do. The refusal is over the whole
// set rather than per field, so no caller has to reason about a partial write.
//
// `opts.keepIfOwnPrecision`, a list of names drawn from `names`, leaves such a
// field's line exactly as it stands wherever its current value is already a
// stamp of this file's own precision: a second stamp of a field a takeover
// already wrote once would otherwise erase the moment the first one recorded.
// A field so kept rides on the returned object's `kept` array, so the caller
// can say which fields it left alone; every other field, and every call that
// passes no such option, stamps as it always has. The recognizer runs against
// the trimmed field value `registryField` already reads out, which strips a
// captured line's trailing `\r` along with its surrounding space, so a
// CRLF-terminated entry is read exactly as an LF one is.
function stampRegistryFields(sessionId, names, opts) {
    const keepOwn = new Set((opts && opts.keepIfOwnPrecision) || []);
    const kept = [];
    const result = stampRegistryEntry(sessionId, (text, at) => {
        let out = text;
        for (const name of names) {
            if (!new RegExp('^' + name + ':', 'm').test(out)) {
                return { text: null, reason: 'the entry carries no ' + name + ' line this stamp rewrites' };
            }
            if (keepOwn.has(name) && isOwnPrecisionStamp(registryField(out, name))) {
                kept.push(name);
                continue;
            }
            out = rewriteFieldLine(out, name, at);
        }
        return { text: out, reason: null };
    });
    return Object.assign({}, result, { kept: result.stamped ? kept : [] });
}

// Stamp the entry's `Banked:` line with now. The entry gains exactly one such
// line, an existing one being rewritten in place and a missing one inserted
// directly after `Heartbeat:`, which is where the contract's shape carries it;
// the rest of the file is byte-identical. An entry carrying neither line is not
// the shape the contract defines and is left untouched.
function stampRegistryBanked(sessionId) {
    return stampRegistryEntry(sessionId, (text, at) => {
        if (/^Banked:/m.test(text)) {
            return { text: rewriteFieldLine(text, 'Banked', at), reason: null };
        }
        if (/^Heartbeat:/m.test(text)) {
            return {
                text: text.replace(/^(Heartbeat:.*?)(\r?)$/m, '$1$2\n' + 'Banked: ' + at + '$2'),
                reason: null
            };
        }
        return { text: null, reason: 'the entry carries neither line this stamp writes beside' };
    });
}

// ---------------------------------------------------------------------------
// Shared transcript reading.
// ---------------------------------------------------------------------------

// Read a transcript with a size cap: for a large file, the head plus tail. The
// evidence the automation scan looks for can land near either end of a
// long-running session: a /loop invocation's first user line (head) beside the
// newest goal_status record (tail). It is the automation scan's above-ceiling
// fallback (see readTranscriptForAutomation, which owns why the fallback is
// not that scan's primary read). Returns '' on any error or a non-regular file, whatever the
// size. The isFile check narrows, without closing, the window in which the
// path could be swapped for a FIFO between the stat and the open (a blocking
// read on a FIFO hangs, which no try/catch can rescue): both read branches
// re-resolve the path after the stat. The residual is accepted because
// exploiting it needs write access to the transcript's directory, which
// already implies control of the transcript contents themselves.
function readTranscriptCapped(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return '';
        const HEAD = 384 * 1024;
        const TAIL = 128 * 1024;
        if (st.size <= 512 * 1024) {
            return fs.readFileSync(transcriptPath, 'utf8');
        }
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const head = Buffer.alloc(HEAD);
            const hb = fs.readSync(fd, head, 0, HEAD, 0);
            const tail = Buffer.alloc(TAIL);
            const tb = fs.readSync(fd, tail, 0, TAIL, st.size - TAIL);
            return head.toString('utf8', 0, hb) + '\n' + tail.toString('utf8', 0, tb);
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return '';
    }
}

// Remove local-command output and caveat blocks from user-slot text. When a user
// runs a slash command the CLI echoes its stdout (and a caveat) back into the
// user turn inside <local-command-stdout>/<local-command-caveat> wrappers; that
// is the CLI's own output, not something the user typed, so it must not read
// as an instrument the user invoked (a catted file or grep hit can echo a
// literal <command-name> or <command-args> string as data). The deliberate
// slash-command invocation record (<command-name>/<command-args>) is NOT
// stripped: it is exactly how the automation scan reads a typed /goal or
// /loop. A close tag counts only when it names the
// same wrapper as its opener, so a coincidental mismatched-name closing tag
// inside real output cannot terminate the strip early and leave the rest of that
// output, or content past it, looking like ordinary typed text. The paired strip
// is greedy: it runs to the LAST same-name close tag in the entry, so echoed
// output that embeds a literal same-name close tag followed by a fake
// <command-name>/<command-args> invocation cannot end the strip early and expose
// it. The accepted trade-off is that genuine typed text sitting between two
// same-name blocks in one entry is over-stripped, which errs toward reading
// no instrument (the safe direction). An opener with no matching closer anywhere in the
// (possibly capped) text is a truncated echo (cut by the read cap, or caught
// mid-write); it is stripped to end-of-text rather than left holding whatever it
// happened to contain.
//
// The implementation is a linear scan (one pass recording the last close tag
// per wrapper name, one pass over the openers) rather than a backtracking
// regex: this runs on user-slot text on per-turn hook paths, and a crafted
// entry dense with unmatched openers must cost milliseconds, not seconds (a
// greedy-with-backreference regex restarts an O(n) backtrack at every such
// opener, which is quadratic). The gate test suite pins both the semantics
// (differentially, against the regex form as a reference) and the bound.
function stripLocalCommandOutput(text) {
    // One forward pass records the LAST close tag per wrapper name, so the
    // opener loop below never rescans the text. Tags are matched
    // case-insensitively and pair across case, hence the case-folded map key;
    // the emitted text is always sliced from the original.
    const lastClose = new Map();
    const closeRe = /<\/local-command-([a-z]+)>/gi;
    let c;
    while ((c = closeRe.exec(text))) {
        lastClose.set(c[1].toLowerCase(), { start: c.index, end: c.index + c[0].length });
    }
    const openRe = /<local-command-([a-z]+)>/gi;
    let out = '';
    let pos = 0;
    for (;;) {
        openRe.lastIndex = pos;
        const m = openRe.exec(text);
        if (!m) return out + text.slice(pos);
        out += text.slice(pos, m.index) + ' ';
        const close = lastClose.get(m[1].toLowerCase());
        if (close && close.start >= m.index + m[0].length) {
            // Paired: strip to the LAST same-name close (greedy). Anything
            // between two same-name blocks, openers of other names included,
            // goes with the span, exactly as the greedy pairing implies.
            pos = close.end;
        } else {
            // Unmatched: stripped to end-of-text.
            return out;
        }
    }
}

// Every <command-args>...</command-args> span in the given text, in order:
// each span runs from an opener to the FIRST close after it, and scanning
// resumes past that close, the same non-overlapping enumeration a global lazy
// regex produces, but as linear literal scans (a lazy [\s\S]*? span restarts
// an O(n) walk at every unclosed opener, which is quadratic on crafted text
// and measured in whole seconds at the transcript read cap). Tags match
// case-insensitively. Spans are returned raw: callers own their
// normalization. An unclosed trailing opener contributes no span. The gate's
// automation detection reads the first span only, and the gate test suite
// pins this scanner against the regex form as a reference, so there is
// exactly one scanner for any reader that next needs every span.
function commandArgsSpans(text) {
    const spans = [];
    const openRe = /<command-args>/gi;
    const closeRe = /<\/command-args>/gi;
    let pos = 0;
    for (;;) {
        openRe.lastIndex = pos;
        const o = openRe.exec(text);
        if (!o) return spans;
        closeRe.lastIndex = o.index + o[0].length;
        const c = closeRe.exec(text);
        if (!c) return spans;
        spans.push(text.slice(o.index + o[0].length, c.index));
        pos = c.index + c[0].length;
    }
}
// ---------------------------------------------------------------------------
// Automation detection for the PreCompact gate's interactive-deferral clause.
//
// The gate defers auto-compaction to the safety ceiling only when the session
// is a human interacting directly; a session driven by native /goal or /loop
// keeps the harness's early trigger. The transcript is the detection surface,
// and the shapes read here are undocumented harness output, the same class as
// the gate's other version-pinned facts: real-transcript observations, except
// the /goal clear argument shape, which follows from the invariant command
// markup and fails safe if wrong (an unrecognized clear leaves the newest
// evidence at met:false and the session on the early trigger). Detection
// errs toward "automated" only via absent evidence never arriving (a loop
// that stops being continued classifies automated indefinitely); every read
// or parse defect classifies as no evidence, and the gate turns that into a
// verdict whose failure direction is the early-trigger status quo.
// ---------------------------------------------------------------------------

// The literal command-name tags a typed /goal or /loop invocation writes. The
// FULL tag is load-bearing: a continuing ScheduleWakeup carries the loop's
// prompt verbatim, so a bare '/loop' substring appears in every wakeup and
// would read each one as a fresh invocation.
const GOAL_COMMAND_TAG = '<command-name>/goal</command-name>';
const LOOP_COMMAND_TAG = '<command-name>/loop</command-name>';

// Extract the genuinely user-typed text of a user entry's message: a string
// content, or the concatenated {type:'text'} blocks of an array content.
// Returns null when there is none, and null for an array carrying any
// tool_result block: tool output is the observed source of quoted command
// markup (a file containing the literal tags, read back into the session),
// and the harness's own /loop detector excludes exactly this shape, so the
// whole entry is discarded rather than trusting its text blocks.
function userTypedText(message) {
    if (!message) return null;
    const c = message.content;
    if (typeof c === 'string') return c;
    if (!Array.isArray(c)) return null;
    let text = '';
    for (const b of c) {
        if (b && b.type === 'tool_result') return null;
        if (b && b.type === 'text' && typeof b.text === 'string') text += '\n' + b.text;
    }
    return text;
}

// Scan transcript text for evidence that native /goal or /loop is driving the
// session. Returns true when either is in effect by the NEWEST evidence of
// its kind: transcripts are append-ordered, so a single forward pass letting
// the last match of each kind win reads newest-wins for free (the real
// end-of-loop sequence is /loop lines followed by a terminal stop, after
// which the session continues as ordinary interactive work).
//
// Evidence, per instrument:
//   /goal, surface 1: a goal_status attachment (type 'attachment', its
//     attachment.type 'goal_status'), which the native goal system writes when /goal is invoked
//     and at every stop evaluation. met === false means in effect; met ===
//     true means satisfied and auto-cleared, so not. Only a strict boolean
//     met decides; sentinel and reason are carried but decide nothing (a
//     real record carries met:true beside sentinel:true).
//   /goal, surface 2: a user command line whose <command-name> is exactly
//     /goal. <command-args> trimmed and lowercased equal to 'clear' means
//     not in effect; any other non-empty argument means in effect; a bare
//     /goal (empty args) reads state and decides nothing.
//   /loop: a user command line whose <command-name> is exactly /loop means
//     in effect; an assistant ScheduleWakeup tool_use whose input.stop is
//     strictly true means the loop ended. A continuing wakeup (delaySeconds,
//     prompt, ...) decides nothing: every iteration of a dynamic loop
//     re-writes its own /loop command line, so the positive evidence
//     refreshes without it.
//
// Tag order in a command line is not fixed (/loop writes <command-message>
// before <command-name>, /goal the other way), so each tag is matched by its
// own independent regex, first tag of each kind winning within the entry.
//
// Exclusions, adopted from the harness's own /loop detector, each defeating
// an observed false positive (quoted markup rides in tool output whenever a
// file containing the tags is read into a session):
//   - a raw line containing the quoted JSON form "tool_result" (quotes
//     included, the same discriminator the harness's detector uses) is never
//     a command line; the bare substring would also skip a genuine typed
//     command whose argument text merely mentions tool_result;
//   - a command line must be entry.type 'user', the wakeup entry.type
//     'assistant';
//   - isMeta, isCompactSummary, and sidechain entries are skipped;
//   - array content holding any tool_result block discards the entry
//     (userTypedText above);
//   - local-command output is stripped before the tag scan (a /goal
//     invocation's own stdout is echoed back inside <local-command-stdout>
//     carrying the full goal condition text);
//   - the ScheduleWakeup check is structural, never a substring (the tool
//     listing rides in system-prompt-shaped entries, so the bare name
//     appears in transcripts with no real invocation).
//
// String prefilters run before any JSON.parse so a multi-megabyte scan costs
// milliseconds; an unparseable line is skipped, no evidence.
function automationInEffect(text) {
    let goalInEffect = null;
    let loopInEffect = null;
    const lines = text.split('\n');
    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const rawToolResult = t.includes('"tool_result"');
        const mayGoalStatus = t.includes('"goal_status"');
        const mayGoalLine = !rawToolResult && t.includes(GOAL_COMMAND_TAG);
        const mayLoopLine = !rawToolResult && t.includes(LOOP_COMMAND_TAG);
        const mayWakeup = t.includes('tool_use') && t.includes('ScheduleWakeup');
        if (!mayGoalStatus && !mayGoalLine && !mayLoopLine && !mayWakeup) continue;
        let entry;
        try { entry = JSON.parse(t); } catch { continue; }
        if (!entry || typeof entry !== 'object') continue;
        if (entry.isSidechain || entry.isMeta === true || entry.isCompactSummary === true) continue;

        if (mayGoalStatus && entry.type === 'attachment'
                && entry.attachment && typeof entry.attachment === 'object'
                && entry.attachment.type === 'goal_status') {
            if (entry.attachment.met === false) goalInEffect = true;
            else if (entry.attachment.met === true) goalInEffect = false;
            continue;
        }

        if ((mayGoalLine || mayLoopLine) && entry.type === 'user') {
            const typed = userTypedText(entry.message);
            if (typed === null) continue;
            const stripped = stripLocalCommandOutput(typed);
            const nameMatch = /<command-name>([^<]*)<\/command-name>/i.exec(stripped);
            if (!nameMatch) continue;
            const name = nameMatch[1].trim();
            if (name === '/loop') {
                loopInEffect = true;
            } else if (name === '/goal') {
                // The first <command-args> span decides (first tag wins, the
                // convention every command-line reader here follows); no span
                // at all, an unclosed opener included, decides nothing.
                const spans = commandArgsSpans(stripped);
                const args = spans.length > 0 ? spans[0].trim().toLowerCase() : '';
                if (args === 'clear') goalInEffect = false;
                else if (args !== '') goalInEffect = true;
            }
            continue;
        }

        if (mayWakeup && entry.type === 'assistant') {
            const content = entry.message && entry.message.content;
            if (!Array.isArray(content)) continue;
            for (const b of content) {
                if (b && b.type === 'tool_use' && b.name === 'ScheduleWakeup'
                        && b.input && typeof b.input === 'object'
                        && b.input.stop === true) {
                    loopInEffect = false;
                }
            }
        }
    }
    return goalInEffect === true || loopInEffect === true;
}

// The byte ceiling on reading a transcript whole for the automation scan.
//
// Newest-evidence-wins only holds over bytes actually read, so the scan wants
// the whole file: a head-plus-tail read leaves an unread middle, and a loop
// whose terminating stop lands there shows its opening /loop line and nothing
// that retires it, classifying a session that has been hands-on for hours as
// automation-driven. That is the exact case the deferral exists to serve, and
// it is the common one, because a session keeps working for as long as it
// likes after its loop ends.
//
// 64 MB scans a whole multi-day session (the largest transcripts observed run
// to 57 MB) with headroom, and the cost is linear and bounded: at that size
// the read plus classification is roughly 150 ms and 175 MB of peak resident
// memory in this short-lived hook process, which runs only when the harness
// is already offering a compaction. Past the ceiling the head-plus-tail
// reader takes over, so a runaway or hostile file costs the same 512 KB it
// always did; the unread middle comes back with it, and the misread it can
// produce degrades to the early trigger, never to a wedged session.
const AUTOMATION_READ_MAX_BYTES = 64 * 1024 * 1024;

// Read a transcript for the automation scan: the whole file at or below
// AUTOMATION_READ_MAX_BYTES, the head-plus-tail read above it. Returns '' on
// any error or a non-regular file, which classifies as no evidence. The
// isFile check narrows the same FIFO-swap window readTranscriptCapped
// documents, and on the same accepted residual: a blocking read on a FIFO
// hangs where no try/catch can rescue it, and the path is re-resolved after
// the stat either way.
function readTranscriptForAutomation(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return '';
        if (st.size > AUTOMATION_READ_MAX_BYTES) return readTranscriptCapped(transcriptPath);
        return fs.readFileSync(transcriptPath, 'utf8');
    } catch {
        return '';
    }
}

// Does the transcript at this path show a native automation instrument
// driving the session? A missing path, an unreadable or non-regular file, or
// any escape reads as no evidence (false); the caller's valve leg reads the
// same file, so an unreadable transcript also yields no consumed-token
// reading and the gate's verdict on it is allow.
function transcriptShowsAutomation(transcriptPath) {
    try {
        if (!transcriptPath) return false;
        const text = readTranscriptForAutomation(transcriptPath);
        if (!text) return false;
        return automationInEffect(text);
    } catch {
        return false;
    }
}

module.exports = {
    checkpointCliClause,
    kitScratchDir, ensureScratchDirIgnored, ensureProjectScratchDir,
    sameSessionId, CHECKPOINT_FUTURE_SKEW_MS,
    roleBoundaryPath, consentPath, ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS,
    markerMatches, readRoleBoundary, readConsent, readRoleBoundaryResult, readConsentResult,
    sweepRoleBoundaryMarkers, ROLE_BOUNDARY_MAX_NAMES,
    writeRoleBoundary, writeConsent, clearRoleBoundary, clearConsent,
    markerMomentHolds, markerDeclaresMoment, transcriptPosition,
    stampRegistryBanked, stampRegistryEntry, stampRegistryFields, registryEntryPath,
    stepOffWholeSecond,
    coordinatorRoot, coordinatorDir, registryField,
    sanitizeForOutput, displayPath, scrub, scrubAfterStrip, homeElisionsKnown,
    shownText, BARRED_QUOTE,
    readRegistryEntryText, writeRegistryEntryAtomic, REGISTRY_ENTRY_MAX_BYTES,
    projectHoldsSessionTranscript, sessionTranscriptPath, usableSessionId,
    gateStatePath, gateLogPath, readGateState, readGateStateResult, recordGateDecision, GATE_REASONS,
    interactiveHoldOpen, INTERACTIVE_HOLD_REASONS, INTERACTIVE_HOLD_MAX_ENTRIES,
    holdNudgePath, holdNudgedAt, recordHoldNudge, readHoldNudgesResult, HOLD_NUDGE_TTL_MS,
    HOLD_NUDGE_HEALABLE,
    wholeMinutesSince, gateCount,
    readTranscriptCapped, stripLocalCommandOutput, commandArgsSpans,
    automationInEffect, transcriptShowsAutomation
};
