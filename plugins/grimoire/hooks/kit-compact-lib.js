// Shared library for the compaction release markers, the registry stamps,
// and the output-channel renderer the kit's writers share.
//
// The release markers are two small JSON files: the role-boundary marker, one
// per session under the machine-local root roleBoundaryRoot resolves below,
// and the operator-consent marker, one per project in the scratch directory
// kitScratchDir resolves. Each is the signal between two programs that must
// agree on its path and shape: the checkpoint CLI (kit-compact-checkpoint.js)
// and the seat-stop hook write them, and the persona module's session.compact
// handler reads them (plugins/personas/hooks/compaction.ts, which carries its
// own copy of the paths, the match rule and the age bounds) to decide whether
// an automatic compaction may run. Single-sourcing the paths and the
// write/read/clear operations here is what keeps the two writers from
// drifting apart; test/kit-compact-lib.test.js pins the record shape against
// the module's reader.
//
// Node core modules only, CommonJS, zero third-party dependencies. Every exported function
// that touches the filesystem is wrapped so it never throws, save
// ensureScratchDirIgnored, whose recursive create is left to throw into its
// caller's own handling: a filesystem hiccup degrades to a null/refusal result
// instead of trapping the caller, matching kit-plan-lib.js.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathErrnoClass } = require('./kit-plan-lib.js');
// The share screen every home-anchored path the kit opens takes: a home spelled
// as a network share blocks a synchronous open for the SMB timeout, so the
// role-boundary root below refuses one before any read or write reaches it.
const { namesNetworkShare } = require('./kit-network-lib.js');
// The marker directory's listing and sweep take kit-read-lib's
// listBoundedNames, which reads a directory incrementally: readdirSync
// materializes the whole of it before the first entry can be judged, so a cap
// on the loop alone bounds what is kept and nothing about what was read.
const { listBoundedNames } = require('./kit-read-lib.js');

// The directory every project-scoped file in this library lives in, for a
// given project directory; the role-boundary marker is the one file here that
// is not project-scoped, and roleBoundaryRoot resolves it. Two branches, and the second exists because one project
// directory the kit itself creates is inside a replicated tree.
//
// Ordinarily the answer is the project's own `.kit/`, gitignored territory
// beside the work it describes. But the memory store at ~/.claude is a git
// repository the sync pushes to a remote that reaches every machine, and a
// seat whose project directory is the store's coordinator directory would
// otherwise drop its consent marker and its other scratch files into that
// replicated tree. None of these files is meaningful on another machine: they
// name a session id, a local plan path, and a local clock, and a log that
// replicates carries one box's decisions into every other box's copy. So a
// project directory lying inside the store resolves instead to a home-
// anchored directory outside it, which nothing syncs, keeping the store-
// relative shape below it so two store-backed project directories cannot
// collide.
//
// The store root is the home directory's .claude, read at call time so a
// fixture home redirects it. One resolver serves every writer here, and the
// persona module's compaction.ts carries a port of it for its consent read,
// which is what keeps a marker's writer and its reader agreeing on where it
// lives.
function kitScratchDir(cwd) {
    const storeRoot = path.join(os.homedir(), '.claude');
    const rel = path.relative(storeRoot, path.resolve(cwd));
    const underStore = !path.isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel);
    return underStore
        ? path.join(os.homedir(), '.kit', 'store', rel)
        : path.join(cwd, '.kit');
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

// Make sure the project directory CWD's own scratch directory exists: create
// the project's .kit/ (or its store-backed counterpart) with its self-ignore
// file, and never throw. The role-boundary marker lives under the home
// rather than under the project, so writing it does not create the project's
// scratch directory. The two marker writers that stand in a project (the
// boundary verb from its shell's directory, the seat-stop hook from its
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

// Skew allowance for a stored timestamp that sits in the future. A small clock
// adjustment between the write and the read is tolerated, but a far-future
// timestamp is treated as illegible rather than honored, so a clock change can
// never mint an effectively immortal record. kit-registry-stamp.js holds the
// registry's own stamps to it, and the persona module holds a marker's
// writtenAt to its own copy of the same figure.
const CHECKPOINT_FUTURE_SKEW_MS = 2 * 60 * 1000;

// Compare two session ids as opaque, case-insensitive strings (session UUIDs
// are surfaced in mixed case across the harness). One rule for every surface
// that has to agree on session identity, rather than a list of them: the
// checkpoint CLI's marker verbs, the registry entry's own corroboration below,
// and the session-start hook. False when either side is missing, which is
// exactly the treat-as-absent handling a record carrying no session needs.
function sameSessionId(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
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

// Write JSON atomically (tmp file plus rename): a failed rename unlinks its
// tmp so orphans do not accumulate beside the marker. The containing directory
// is a precondition, never created here: the marker writer creates its own
// directory before calling. Throws on failure; every caller catches.
function writeJsonAtomic(target, value) {
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
// ---------------------------------------------------------------------------
// Release markers. Two session-scoped marker kinds release a compaction the
// persona module's veto is holding: the role-boundary marker, which a session
// (a coordinator, expert or admin seat, or any hands-on session) opens at a
// banked-and-empty moment so the next automatic compaction can land there; and
// the operator-consent marker, written only on the operator's explicit word,
// which releases one held compaction for the session it names. The boundary
// marker is one FILE per session, its session id a component of the file's own
// name, because a shared checkout carries several seats at once and each
// declaration is one seat's own word about one moment: two seats scoped only by
// a field inside a single file left the second declaration renaming over the
// first. It lives in one machine-local root keyed by session rather than in any
// project's scratch directory, because its writer and its reader do not share
// a working directory: the verb runs wherever the session's shell stands, a
// linked worktree among the places, while the module reads under the home
// alone. A root that depends on no working directory is what makes the two
// agree by construction. The consent marker is one file per project, the
// operator writing one at a time, and it stays under the project's scratch
// directory.
//
// The trust shape: a session's own banked-and-empty declaration is the best
// boundary signal available, so honoring a self-declared boundary can only move
// a compaction onto a cleaner spot. The consent marker is asserted rather than
// authenticated (a single-principal machine); what bounds its writing is prose
// in the role skills, and what bounds its effect is the module's match rule:
// one session, one release, one age window.
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
// declaration is not written and the verb refuses naming the cause.
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
// The id composes the name as it is given, where the module's match rule
// compares ids case-insensitively, so on a case-sensitive filesystem two
// spellings of one id resolve two files while the rule reads them as one
// session. The cost of that seam is a marker the offer does not find, which
// leaves the compaction held.
//
// A marker left under a project's own scratch directory, where this file kept
// them while the path was resolved from a working directory, is resolved by
// nothing, read by nothing and swept by nothing: it is inert.
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

// A session id a caller may scope a marker to, or null. The test is charset
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
// here that needs it and the hooks that load this library must not pay for
// loading it. Its one consumer is the corroboration below, which asks about a
// NAMED project directory.
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

// How long each marker stays honorable, four hours, one figure for both
// because both answer one question: how long a moment's word still describes
// the same working session. A seat opens the boundary marker at a banked
// moment its runbook defines, and the invariant that moment carries is that
// context holds nothing the disk does not, so a compaction anywhere inside the
// window costs a re-read and never state; what the window has to cover is the
// seat's own quiet gap between banked moments, far longer than one tool call.
// The consent marker covers the same gap from the other side, an operator's
// release preceding the next offer by a while. The persona module holds both
// markers to its own copy of these figures, and the CLI prints them, so the
// two copies are pinned equal in test/kit-compact-lib.test.js.
const ROLE_BOUNDARY_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const CONSENT_MAX_AGE_MS = ROLE_BOUNDARY_MAX_AGE_MS;

// A marker file's read cap. The writer produces a few short fields and never
// grows, so anything past 64 KB is not something this wrote.
const MARKER_MAX_BYTES = 64 * 1024;

// Read and parse a marker file. The path must be a regular file of sane size
// before it is opened (a FIFO planted here would block forever inside
// readFileSync, where no try/catch can rescue it, and being an lstat the check
// judges a link as a link rather than as its target), and the refusal legs are
// told apart because the boundary verb's retraction names a different remedy
// for each and cannot recover them by re-asking with a second syscall. Returns
// { ok, marker, reason }:
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
// age past which the module's match rule refuses one anyway: what the sweep collects is a
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

// Write a marker atomically through writeJsonAtomic (exclusive create, atomic
// rename, failure cleanup gated on the create having returned). Returns
// { ok:true, session } or { ok:false, reason }; never throws.
//
// The session id is held to one storage rule (a string, non-empty, within a
// 128-character cap, no control characters); the CLI additionally
// charset-gates what it accepts before this is reached, so this guard is the
// floor, not the whole test. There is no unscoped form: a marker without a
// session would release whichever session's offer arrived first, which is the
// one shape the design forbids, so a caller with no usable id gets a refusal
// rather than a wildcard. consumed is written as a literal false, the only
// value the module's match rule reads as live. The directory is created here,
// boundary and consent alike, through the same helper for both kinds, so the
// role-boundary root under ~/.kit gains the same ignore marker the
// store-backed scratch directory under ~/.kit/store gains: neither sits in a
// repository, and one create for every marker directory is what keeps the
// symlink screen that helper carries in front of every marker write.
//
// `declared` records provenance: true only for the boundary verb's deliberate
// declaration, absent for every other writer. The persona module scopes its
// moment rule by it, lapsing a declared marker once a new main-loop turn starts
// after its writtenAt, while the seat-stop hook's turn-end marker stands on its
// age bound alone. The field is machine written here and nowhere else; no
// prose ever asks anyone to produce it. A record is therefore session,
// writtenAt and consumed, plus declared on the boundary verb's path.
function writeMarkerFile(target, sessionId, declared) {
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
    // produces carries no declaration and reads as a window-scoped marker.
    if (declared === true) state.declared = true;
    try {
        ensureScratchDirIgnored(path.dirname(target));
        writeJsonAtomic(target, state);
    } catch (err) {
        return { ok: false, reason: 'could not write marker: ' + (err && err.message ? err.message : String(err)) };
    }
    return { ok: true, session: sessionId };
}

// One session's role-boundary marker, written at its own file under the home,
// so the verb declares the same file from whatever directory the session's
// shell stands in, a linked worktree included.
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
    const result = writeMarkerFile(target, sessionId, declared);
    if (result.ok) sweepRoleBoundaryMarkers();
    return result;
}

function writeConsent(cwd, sessionId) {
    return writeMarkerFile(consentPath(cwd), sessionId);
}

// Delete a marker file if present: presence
// judged by the lstat kind check rather than existsSync (a link at the path
// reads as no marker to every reader here, so a clear that followed it would
// report retracting something nothing read as open), a failed lstat routed by
// pathErrnoClass, and a racing ENOENT reported as none-open rather than as a
// failure. Returns { ok:true, cleared:true } when a file was removed,
// { ok:true, cleared:false } when none was open, and
// { ok:false, cleared:false, reason } when a file is there and the delete
// failed or its kind could not be read. The boundary verb's retraction is the
// one caller.
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

// Remove local-command output and caveat blocks from user-slot text. When a user
// runs a slash command the CLI echoes its stdout (and a caveat) back into the
// user turn inside <local-command-stdout>/<local-command-caveat> wrappers; that
// is the CLI's own output, not something the user typed, so it must not read
// as an instrument the user invoked (a catted file or grep hit can echo a
// literal <command-name> or <command-args> string as data). The deliberate
// slash-command invocation record (<command-name>/<command-args>) is NOT
// stripped: it is how a reader such as scripts/jev-judge.js tells a typed
// command from a human turn. A close tag counts only when it names the
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
// opener, which is quadratic). test/kit-compact-lib.test.js pins both the
// semantics (differentially, against the regex form as a reference) and the
// bound.
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

module.exports = {
    kitScratchDir, ensureScratchDirIgnored, ensureProjectScratchDir,
    sameSessionId, CHECKPOINT_FUTURE_SKEW_MS,
    roleBoundaryPath, consentPath, ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS,
    readRoleBoundaryResult,
    sweepRoleBoundaryMarkers, ROLE_BOUNDARY_MAX_NAMES,
    writeRoleBoundary, writeConsent, clearRoleBoundary,
    stampRegistryBanked, stampRegistryEntry, stampRegistryFields, registryEntryPath,
    stepOffWholeSecond,
    coordinatorRoot, coordinatorDir, registryField,
    sanitizeForOutput, displayPath, scrub, scrubAfterStrip, homeElisionsKnown,
    shownText, BARRED_QUOTE,
    readRegistryEntryText, writeRegistryEntryAtomic, REGISTRY_ENTRY_MAX_BYTES,
    projectHoldsSessionTranscript, sessionTranscriptPath, usableSessionId,
    stripLocalCommandOutput
};
