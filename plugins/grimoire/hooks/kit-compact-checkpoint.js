#!/usr/bin/env node
// CLI entry for the compaction release markers.
//
// Subcommands:
//   kit-compact-checkpoint.js boundary [--cancel]
//                                       open the role-boundary marker for the
//                                       calling session, or retract the one it
//                                       opened
//   kit-compact-checkpoint.js consent [--session <id>] [--project <path>]
//                                       record the operator's release for the
//                                       caller's session, or the named one, in
//                                       the caller's directory or a named one
//
// The persona module's session.compact handler reads both markers: where it
// loads, it holds an automatic compaction until the session declares a
// boundary, holds consent, or passes its percentage valve.
//
// `boundary` opens the role-boundary marker for a session (coordinator,
// expert, admin, or any hands-on seat) at its own banked-and-empty moment,
// scoped by session. The ordinary writer of that marker is the seat-stop.js
// Stop hook, which opens it at a turn end off the seat's own registry status
// push; this subcommand writes the same file the hook does, and it serves the
// two seats the hook cannot: one the machine's session registry does not
// carry, and a registered one whose project tree holds work it does not own,
// which the hook's clean-tree test refuses. Where the caller does have a
// registry entry, the run stamps that entry's `Banked:` line, a record of the
// declaration rather than a precondition for it: an absent directory or entry
// is a silent no-op and the marker opens either way. What this verb writes is
// stamped as a declaration, and that field is what puts it under the module's
// moment rule, where the hook's turn-end marker stands on its age bound alone.
// The marker is keyed by session under the machine-local root
// ~/.kit/role-boundary (roleBoundaryPath in kit-compact-lib.js), so the verb
// runs from whatever directory the session works in, a linked worktree
// included: the working directory does not name the marker.
// `boundary --cancel` retracts this session's own marker; nothing depends on it
// being run, since the module stops honoring a declared marker once a new turn
// begins in the session it names.
//
// The verb refuses a caller whose own session id cannot be resolved, the id
// being what scopes the marker it writes: an unscoped marker whichever
// session's offer arrived first would consume is the one shape the design
// forbids. The id is self-reported environment and nothing about the marker
// is secret, so this is no boundary against a determined writer, and the
// design does not claim one: the granularity is the harness session, so a
// subagent dispatched by a seat reports that session's id and passes as it.
// What the check prevents is the accident it was built for, a seat following
// its own instructions writing into another seat's compaction timing.
//
// `consent`
// writes the operator-release marker; the rule for WHEN it may be run (only
// on the operator's explicit word over a warranted channel, never on the
// session's own judgment) is the role skills' prose, while this CLI bounds
// only what one run of it can do: one session, one release, one age window.
// Its `--project` names the directory the marker is written at, for the
// ordinary case of an operator releasing a session that is not the one their
// shell stands in; a named project the session left no transcript under is
// refused, since a marker written there would be read by nobody.
// The module consumes either marker on the compaction it releases, single-shot.
//
// All filesystem work is delegated to kit-compact-lib.js; this file is only
// argument parsing and output formatting.

'use strict';

// The kit library this CLI is written against, bound here and LOADED inside
// the guarded region at the foot of this file rather than required at module
// scope. A require that throws (a damaged or partially written plugin cache)
// throws before any guard this file installs, and what Node prints for it is its
// own trace, whose `Require stack:` lines carry the absolute module path of
// every file on that stack, home-anchored on an installed plugin. Loading it
// inside the try is what puts that failure back on this file's own channel.
//
// The shared output renderer, bound under this file's own names: `sanitize` for
// one repo-controlled value, displayPath for a value known to be a path, scrub
// for a whole composed line, and homeElisionsKnown for the floor note below.
let sanitize, displayPath, scrub, homeElisionsKnown;
let readRoleBoundaryResult,
    writeRoleBoundary, writeConsent, clearRoleBoundary, sameSessionId,
    stampRegistryBanked,
    projectHoldsSessionTranscript, usableSessionId, ensureProjectScratchDir,
    ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS;

// The age bounds as an operator reads them, derived from the constants rather
// than written out so a sentence here cannot drift from the rule it describes.
// The rounding is exact only while the constants stay whole hours: a 90-minute
// bound would print as "2 hours" against a rule enforcing one and a half, so a
// change to either constant that leaves whole units is what keeps these
// honest. They are derived with the library loaded rather than at module
// scope, the constants arriving with it.
let BOUNDARY_HOURS, CONSENT_HOURS;

function loadKitLibraries() {
    ({
        readRoleBoundaryResult,
        writeRoleBoundary, writeConsent, clearRoleBoundary, sameSessionId,
        stampRegistryBanked,
        projectHoldsSessionTranscript, usableSessionId, ensureProjectScratchDir,
        ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS,
        sanitizeForOutput: sanitize, displayPath, scrub, homeElisionsKnown
    } = require('./kit-compact-lib.js'));
    BOUNDARY_HOURS = Math.round(ROLE_BOUNDARY_MAX_AGE_MS / (60 * 60 * 1000));
    CONSENT_HOURS = Math.round(CONSENT_MAX_AGE_MS / (60 * 60 * 1000));
}

// Whether this run has already said that its floor is not standing, so the
// sentence is spent once rather than on every line.
let floorStated = false;

// The one-time note that no home directory is knowable here, or the empty string
// where one is. An empty elision list on its own answers two facts, and only one
// of them is news: nothing to elide is ordinary, while no knowable home
// directory means every path on the lines that follow carries whatever the OS
// account name is, with nothing else on this channel saying so. So the uncertain
// reading speaks rather than passing values through unmarked, which is the
// direction a floor has to fail in. It rides whichever descriptor is written to
// first, since both are read by the same reader and the fact is about neither
// one in particular. An unbound reading is neither of those two: the only line
// reachable before the libraries are bound is the guarded region's own failure
// sentence, which carries no path, so there is nothing there for a floor to
// stand under.
function floorNote() {
    if (floorStated || homeElisionsKnown === undefined || homeElisionsKnown()) return '';
    floorStated = true;
    return 'kit-compact-checkpoint: no home directory is knowable in this shell, so nothing'
        + ' below is elided and any path on these lines carries the OS account name as it stands\n';
}

// The shared library's whole-line elision, or the text unchanged where the
// libraries have not been bound. That second reading is reachable on one line
// only, the guarded region's failure sentence for a require that threw, and that
// sentence is composed without a path for exactly this reason.
function elided(text) {
    return scrub === undefined ? String(text) : scrub(text);
}

// The two writes this CLI makes to its output descriptors. Each routes its
// argument through the shared elision, so a line composed anywhere in this file
// carries the guard by reaching the channel here rather than by its author
// having remembered it. What keeps a print site from reaching a descriptor
// directly is the source-side pin in test/kit-compact-lib.test.js, which reads
// this file's own text; a sentence here could not.
function emitOut(text) {
    process.stdout.write(floorNote() + elided(text));
}

function emitErr(text) {
    process.stderr.write(floorNote() + elided(text));
}

function usage() {
    emitErr('usage: kit-compact-checkpoint.js boundary [--cancel]'
        + ' | consent [--session <id>] [--project <path>]\n');
    process.exitCode = 1;
}

// The calling session's own id, from the environment the harness sets for a
// session's tool shell, or null when nothing usable is there. The variable is
// an undocumented harness detail that can change or vanish upstream. A
// dispatched subagent's shell carries the dispatching session's id rather than
// one of its own, so a subagent running a scoped verb acts as the seat that
// dispatched it, which is the granularity the file header states this guard has.
// The refusal at the call sites is the designed degradation for the variable
// vanishing: where no id is derivable, this CLI refuses to write a scoped marker
// rather than writing an unscoped one.
function callerSessionId() {
    return usableSessionId(process.env.CLAUDE_CODE_SESSION_ID);
}

// Open the role-boundary marker for the calling session. The marker is scoped
// by session, and the refusal of a caller with no resolvable id is loud and
// names the variable, because the alternative, an unscoped marker whichever
// session's offer arrived first would consume, is the one shape the design
// forbids.
//
// The scope is the file itself: the marker's name carries the session id, so
// several seats held in one checkout each declare into their own file and this
// write can replace nothing but this session's own previous declaration.
function cmdBoundary(rest) {
    // The parse is strict for the same reason cmdConsent's is: `boundary
    // --session <id>` is the natural misreading of the consent form, and a
    // parser that ignored the tail would do two wrong things at once, denying
    // the named session its release and handing the ambient session one it
    // never asked for. Exactly one argument form is accepted, --cancel, and
    // it takes no value: the boundary marker is the calling session's own
    // declaration, whether it is being made or retracted.
    const cancel = rest.length === 1 && rest[0] === '--cancel';
    if (rest.length !== 0 && !cancel) {
        emitErr('usage: kit-compact-checkpoint.js boundary [--cancel] (no other arguments:'
            + ' the marker is scoped to the calling session; consent is the mode that takes'
            + ' --session)\n');
        process.exitCode = 1;
        return;
    }
    const session = callerSessionId();
    if (session === null) {
        emitErr('kit-compact-checkpoint: no usable session id in this shell'
            + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped), so a session-scoped'
            + ' marker cannot be ' + (cancel ? 'retracted' : 'written') + '; nothing written\n');
        process.exitCode = 1;
        return;
    }
    if (cancel) {
        cancelBoundary(session);
        return;
    }
    // Written as a declaration, which is the field the module's moment rule is
    // scoped by: this verb is a seat's deliberate word about one instant, where
    // the seat-stop hook's turn-end marker is a standing window it rewrites
    // every turn. The tool writes the field; nothing asks a model to. The
    // marker is keyed by the session alone, so no directory is passed: the
    // verb declares the same file from wherever the session's shell stands.
    const result = writeRoleBoundary(session, true);
    if (result.ok) {
        // The project's own scratch directory, ensured after the marker and
        // best-effort, as the seat-stop hook's bank does: the shell's .kit/,
        // created with its self-ignore file. The marker lives under the home,
        // so writing it does not create this directory.
        ensureProjectScratchDir(process.cwd());
        // The registry record of the declaration, best-effort and after the
        // marker: a seat the registry does not carry declares exactly as well
        // as one it does, so an absent directory or entry is a silent no-op
        // and nothing about the marker turns on it.
        //
        // One refusal is not silent. An entry that exists at this session's own
        // path while naming a different session is a state nobody should meet
        // by accident: either the id this shell carries is not this session's,
        // or a peer's entry is sitting at it, and both are worth a word to the
        // operator. The declaration still stands, so this is a note on stderr
        // rather than a failure, and it names neither the entry's session nor
        // its path, since the point is that neither is this caller's.
        const stamp = stampRegistryBanked(session);
        if (!stamp.stamped && stamp.reason === 'the entry at that path names a different session') {
            emitErr('kit-compact-checkpoint: the registry entry for this session id names a'
                + ' different session, so it is not this session\'s to stamp and was left untouched;'
                + ' the boundary itself is declared\n');
        }
        // Environment-derived values print indented and sanitized, keeping
        // untrusted data visually subordinate in a channel a model reads; the
        // duration comes from the constant, so the sentence cannot promise
        // what the rule does not do.
        // The moment clause is stated beside the age bound because the two
        // bound the marker together, and the shorter one is the one a seat
        // will meet: the module stops honoring this marker once a new turn
        // begins in this session.
        emitOut('  role-boundary marker open for session ' + sanitize(session)
            + ' (releases that session\'s next held auto-compaction,'
            + ' until a new turn begins there; it ages out in ' + BOUNDARY_HOURS + ' hours)\n');
        process.exitCode = 0;
    } else {
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason) + '\n');
        process.exitCode = 1;
    }
}

// Retract this session's own declaration, at this session's own file: a peer's
// declaration lives at a name this verb never composes, so nothing here can
// reach one. What the file at this session's name holds is still read before
// anything is removed, since the name is composed from an environment variable
// nothing authenticates and whatever sits there may be a peer's: a record naming
// another session is left standing, exactly as the module's match rule leaves
// one it does not match. Nothing in the design depends on this being run, the
// module's moment rule retiring a marker that outlived its lull with no act
// from anyone; this is the
// explicit retraction, for an operator at a shell and for a session withdrawing
// a declaration it has just made.
//
// A marker whose owner cannot be read is not removed either, and it is the
// leg worth stating: an illegible or oversized file reads as no marker at all,
// so a clear that ran on it would delete whatever was written there and
// report it as this session's own retraction. The scope guard can only protect
// a scope it can see, so where it cannot see one the answer is to leave the
// file alone and say what is there.
function cancelBoundary(session) {
    const read = readRoleBoundaryResult(session);
    const marker = read.marker;
    if (read.reason === 'no-session') {
        // No file name composes from this id, so nothing was read and no file is
        // being asserted to exist: the refusal names the id rather than a marker
        // that cannot be read, which is the opposite fact. The caller charset-
        // gates before it reaches here, so this is the floor rather than the
        // path an operator meets.
        emitErr('kit-compact-checkpoint: this session id is not one a marker file name'
            + ' composes from, so no declaration of its own can be open here'
            + ' (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    if (read.reason === 'no-root') {
        // The root, not the id, is what could not be opened: a home directory
        // that is unknown or spelled as a network share composes no marker path,
        // so nothing was read and nothing is asserted about any file.
        emitErr('kit-compact-checkpoint: the home directory is unknown or names a network share,'
            + ' so no role-boundary marker root can be opened and no declaration can be read there'
            + ' (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    if (marker === null && read.reason !== 'absent') {
        emitErr('kit-compact-checkpoint: a role-boundary marker file is present here that'
            + ' cannot be read (' + sanitize(read.reason) + '), so whose declaration it is cannot be'
            + ' established and it is left in place; move it aside by hand (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    if (marker !== null && typeof marker.session !== 'string') {
        emitErr('kit-compact-checkpoint: the role-boundary marker file here names no session,'
            + ' so whose declaration it is cannot be established and it is left in place; the next'
            + ' boundary write replaces it (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    if (marker && typeof marker.session === 'string' && !sameSessionId(marker.session, session)) {
        emitOut('  a role-boundary marker for session ' + sanitize(marker.session)
            + ' is open here and is left in place: this session declared no boundary to retract\n');
        process.exitCode = 0;
        return;
    }
    const result = clearRoleBoundary(session);
    if (!result.ok) {
        // Nothing was removed, so this must not read as a successful retraction,
        // and what is left behind is not asserted: a failed unlink leaves the
        // file's state unproven either way.
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason)
            + ' (nothing was retracted)\n');
        process.exitCode = 1;
        return;
    }
    emitOut((result.cleared
        ? 'role-boundary marker retracted'
        : 'no role-boundary marker was open') + '\n');
    process.exitCode = 0;
}

// Record the operator's release for the caller's session, or an explicitly
// named one. The rule for WHEN this may be run is the role skills' prose (the
// operator's explicit word over a warranted channel, never the session's own
// judgment); what this parser owns is the strictness of the write: --session
// demands exactly one value, and a value is never taken from anything
// dash-led (usableSessionId's leading-character rule), so a missing value
// cannot swallow the next flag and be recorded as a session name.
function cmdConsent(rest) {
    const flags = { '--session': null, '--project': null };
    for (let i = 0; i < rest.length; i += 2) {
        if (!Object.prototype.hasOwnProperty.call(flags, rest[i])
            || flags[rest[i]] !== null || i + 1 >= rest.length) {
            emitErr('usage: kit-compact-checkpoint.js consent'
                + ' [--session <id>] [--project <path>]'
                + ' (each flag at most once, each with one value)\n');
            process.exitCode = 1;
            return;
        }
        flags[rest[i]] = rest[i + 1];
    }

    let session;
    if (flags['--session'] === null) {
        session = callerSessionId();
        if (session === null) {
            emitErr('kit-compact-checkpoint: no usable session id in this shell'
                + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped); name one with'
                + ' --session <id>; nothing written\n');
            process.exitCode = 1;
            return;
        }
    } else {
        session = usableSessionId(flags['--session']);
        if (session === null) {
            emitErr('kit-compact-checkpoint: --session needs one value that starts'
                + ' with a letter or digit and uses only letters, digits, dot, underscore or'
                + ' hyphen; nothing written\n');
            process.exitCode = 1;
            return;
        }
    }

    // Without --project the marker lands where the caller stands, which is the
    // operator's own session's project and needs no corroboration. With it the
    // target directory is a value the caller supplied, so it is corroborated
    // before anything is written: the named session must have a transcript
    // filed under that project. A marker written anywhere else is inert and
    // says nothing about it, which is the failure this flag exists to end, so
    // the miss is an error here rather than a successful-looking write.
    const target = flags['--project'] === null ? process.cwd() : flags['--project'];
    if (flags['--project'] !== null && !projectHoldsSessionTranscript(target, session)) {
        emitErr('kit-compact-checkpoint: no transcript for session '
            + sanitize(session) + ' under the project at ' + displayPath(target)
            + ', so a marker written there would never be read; check the path and the'
            + ' session id; nothing written\n');
        process.exitCode = 1;
        return;
    }
    const result = writeConsent(target, session);
    if (result.ok) {
        emitOut('  operator-consent marker recorded for session ' + sanitize(session)
            + ' (releases that session\'s next held auto-compaction once, within '
            + CONSENT_HOURS + ' hours)\n');
        process.exitCode = 0;
    } else {
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason) + '\n');
        process.exitCode = 1;
    }
}

function main() {
    const [cmd] = process.argv.slice(2);
    if (cmd === 'boundary') cmdBoundary(process.argv.slice(3));
    else if (cmd === 'consent') cmdConsent(process.argv.slice(3));
    else usage();
}

// Wrapped so an unexpected defect prints one elided line and a nonzero exit
// instead of a stack trace, and for a reason that is stronger here than for a
// CLI an operator alone reads: this CLI's output is echoed into a
// session's context, and an uncaught throw writes Node's own trace to stderr
// carrying the full module path of every file on the require stack, which is
// home-anchored on an installed plugin. That write is the runtime's rather than
// this file's, so it is a leg both the emitters' floor and the source-side pin
// are blind to; catching here is what puts it back on the channel.
//
// The kit-library loading is INSIDE the region for that reason: a require is the
// throw most likely to produce that trace, a damaged plugin cache being its
// ordinary cause. What remains outside is this file's own module-scope
// evaluation, which carries no plugin path and reads nothing off disk.
try {
    loadKitLibraries();
    main();
} catch (err) {
    // A throw during the library load leaves the renderer unbound, and it stays
    // unbound whichever kit library refused: the renderer lives in
    // kit-compact-lib.js, which requires kit-plan-lib.js itself, so a load
    // that failed at either cannot be recovered by requiring the renderer
    // alone.
    // Nothing here can then take the OS account name out of the error text,
    // whose module path and `Require stack:` lines are home-anchored on an
    // installed plugin, so that reading names the failure and withholds the
    // text: withholding is the direction this channel's floor fails in, and it
    // is the same direction the guarded region itself takes. The error's CODE
    // still rides, since a Node error code is an upper-case identifier
    // (MODULE_NOT_FOUND, ERR_DLOPEN_FAILED) that names the failure's kind and
    // can carry no path; anything else in that field is dropped. It rides the
    // withheld leg alone, since a message that survived sanitize already opens
    // with its own code where it has one (ENOENT: no such file ...).
    const code = err && typeof err.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(err.code)
        ? ' (' + err.code + ')' : '';
    emitErr('kit-compact-checkpoint: ' + (sanitize === undefined
        ? 'a kit library could not be loaded' + code + ', and the renderer that takes the OS'
            + ' account name out of an error is in it, so the message itself is withheld'
        : sanitize(err && err.message ? err.message : String(err))) + '\n');
    process.exitCode = 1;
}
