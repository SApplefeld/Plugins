#!/usr/bin/env node
// CLI entry for the compaction gate's release markers and its status report.
//
// Subcommands:
//   kit-compact-checkpoint.js status    report the release markers, the gate
//                                       state, and any hold stamps refusing
//                                       the deferral nudge
//   kit-compact-checkpoint.js boundary [--cancel]
//                                       open the role-boundary marker for the
//                                       calling session, or retract the one it
//                                       opened
//   kit-compact-checkpoint.js consent [--session <id>] [--project <path>]
//                                       record the operator's release for the
//                                       caller's session, or the named one, in
//                                       the caller's directory or a named one
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
// stamped as a declaration, and that field is what puts it under the gate's
// moment rule, where the hook's turn-end marker stands on its age bound alone.
// The marker is keyed by session under the machine-local root
// ~/.kit/role-boundary (roleBoundaryPath in kit-compact-lib.js), and the
// declared moment is measured on the transcript the harness filed for this
// session, located by its id alone, so the verb runs from whatever directory
// the session works in, a linked worktree included: the working directory
// names neither the marker nor the transcript. An id the harness's projects
// directory holds under two project directories cannot be positioned, and the
// verb says so. `status` reports the calling session's own marker and no
// other's, since the root holds every session on the machine.
// `boundary --cancel` retracts this session's own marker; nothing depends on it
// being run, since the gate stops honoring a declared marker the moment a new
// turn begins in the session it names.
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
// Both markers are consumed by the gate on the allow they cause, single-shot.
//
// All filesystem work is delegated to kit-compact-lib.js; this file is only
// argument parsing and output formatting.

'use strict';

// The kit libraries this CLI is written against, bound here and LOADED inside
// the guarded region at the foot of this file rather than required at module
// scope. A require that throws (a damaged or partially written plugin cache)
// throws before any guard this file installs, and what Node prints for it is its
// own trace, whose `Require stack:` lines carry the absolute module path of
// every file on that stack, home-anchored on an installed plugin. Loading them
// inside the try is what puts that failure back on this file's own channel. The
// sibling hook compact-deferral-nudge.js defers its kit requires into the guards
// that use them for the same failure mode.
let findTranscript;
// The shared output renderer, bound under this file's own names: `sanitize` for
// one repo-controlled value, displayPath for a value known to be a path, scrub
// for a whole composed line, and homeElisionsKnown for the floor note below.
let sanitize, displayPath, scrub, homeElisionsKnown;
let readGateStateResult, gateStatePath,
    readHoldNudgesResult, holdNudgePath, HOLD_NUDGE_HEALABLE,
    wholeMinutesSince, gateCount,
    readRoleBoundaryResult, readConsentResult,
    writeRoleBoundary, writeConsent, clearRoleBoundary, sameSessionId,
    markerMatches, markerMomentHolds, markerDeclaresMoment, stampRegistryBanked,
    projectHoldsSessionTranscript, usableSessionId, ensureProjectScratchDir,
    ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS;

// The age bounds as an operator reads them, derived from the constants rather
// than written out so a sentence here cannot drift from the rule it describes.
// The rounding is exact only while the constants stay whole hours: a 90-minute
// bound would print as "2 hours" against a rule enforcing one and a half, so a
// change to either constant that leaves whole units is what keeps these
// honest. The two marker bounds both render in hours because both are the same
// quantity: rendering one of them in minutes would print two different-looking
// figures for one window in a single `status` report, which reads as two rules
// rather than one. They are derived with the libraries loaded rather than at
// module scope, the constants arriving with them.
let BOUNDARY_HOURS, CONSENT_HOURS;

function loadKitLibraries() {
    ({ findTranscript } = require('./kit-plan-lib.js'));
    ({
        readGateStateResult, gateStatePath,
        readHoldNudgesResult, holdNudgePath, HOLD_NUDGE_HEALABLE,
        wholeMinutesSince, gateCount,
        readRoleBoundaryResult, readConsentResult,
        writeRoleBoundary, writeConsent, clearRoleBoundary, sameSessionId,
        markerMatches, markerMomentHolds, markerDeclaresMoment, stampRegistryBanked,
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
// directly is the source-side pin in test/kit-compact-gate.test.js, which reads
// this file's own text; a sentence here could not.
function emitOut(text) {
    process.stdout.write(floorNote() + elided(text));
}

function emitErr(text) {
    process.stderr.write(floorNote() + elided(text));
}

function usage() {
    emitErr('usage: kit-compact-checkpoint.js status'
        + ' | boundary [--cancel]'
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
    // Written as a declaration, which is the field the gate's moment rule is
    // scoped by: this verb is a seat's deliberate word about one instant, where
    // the seat-stop hook's turn-end marker is a standing window it rewrites
    // every turn. The tool writes the field; nothing asks a model to. The
    // marker is keyed by the session alone and the moment is measured on the
    // transcript located by that id, so no directory is passed: the verb
    // declares the same file from wherever the session's shell stands.
    const result = writeRoleBoundary(session, true);
    if (result.ok) {
        // The project's own scratch directory, ensured after the marker and
        // best-effort. The marker lives under the home, so writing it no
        // longer creates this directory as a side effect, and the gate records
        // a decision only where the directory already exists:
        // a fresh linked worktree would otherwise record no deny and the
        // deferral nudge's hold directive, which reads that record, would never
        // fire there. The directory is the shell's, which is where a declaring
        // run works and where the gate's payload names its cwd.
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
        // will meet: the gate stops honoring this marker the moment a new turn
        // begins in this session.
        emitOut('  role-boundary marker open for session ' + sanitize(session)
            + ' (that session\'s next deferred auto-compaction lands at this boundary,'
            + ' until a new turn begins there; it ages out in ' + BOUNDARY_HOURS + ' hours)\n');
        // A declaration the gate cannot position is one it will never honor, so
        // it is said here rather than left to look like a marker that works.
        // The transcript is located by the session id alone, so the miss is
        // the lookup's: no project directory under the harness's projects root
        // holds a transcript of this id, or more than one does, which the
        // shared scan answers as no transcript rather than picking one.
        if (result.positioned === false) {
            emitErr('kit-compact-checkpoint: no transcript for this session id could be located'
                + ' (the harness\'s projects directory holds none for it, or holds one under more than'
                + ' one project directory), so the gate has nothing to read the moment against and will'
                + ' treat this marker as lapsed\n');
        }
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
// another session is left standing, exactly as the gate leaves one it does not
// match. Nothing in the design depends on this being run, the moment rule above
// retiring a marker that outlived its lull with no act from anyone; this is the
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
            + ' (releases that session\'s next deferred auto-compaction once, within '
            + CONSENT_HOURS + ' hours)\n');
        process.exitCode = 0;
    } else {
        emitErr('kit-compact-checkpoint: ' + sanitize(result.reason) + '\n');
        process.exitCode = 1;
    }
}

// Why a marker on disk gates nothing, per markerMatches reason code: every
// message states plainly that
// the gate treats the file as absent. The 'no-marker' and 'wrong-session'
// codes have no entry because this report all but never produces them (a
// shapeless file takes the illegible leg below, and the marker is judged
// for the session it itself names). One hand-made shape reaches
// 'wrong-session' anyway: an empty-string session passes the shape guard
// below, being a string, and then compares unequal to itself. That code and
// any unknown future one fall back to the bare treats-as-absent clause
// rather than printing nothing, which is why the fallback is here rather
// than an assertion. 'expired' is built at
// the call site, because it names the bound that applied and the two marker
// kinds carry different bounds.
const MARKER_DEAD_REASONS = {
    'consumed': 'already consumed, so the gate treats it as absent',
    'no-timestamp': 'its written timestamp is missing or unreadable, so the gate treats it as absent',
    'future': 'its written timestamp is in the future, so the gate treats it as absent'
};

// Why a live marker no longer describes the moment it declared, per
// markerMomentHolds reason code. A declaration is about a moment, so a marker
// lapses the instant a new turn begins in the session it names, and every
// question the rule cannot answer lapses it too, which is the direction that
// keeps the gate deferring rather than landing a compaction mid-turn. An
// unknown future code falls back to the bare lapsed clause.
const MARKER_LAPSED_REASONS = {
    'inbound': 'lapsed: a message arrived in that session after it was declared',
    'no-position': 'lapsed: the declaration records no place in that session\'s transcript, so nothing can vouch for the moment',
    'unreadable': 'lapsed: that session\'s transcript cannot be read, so nothing can vouch for the moment',
    'replaced': 'lapsed: that session\'s transcript no longer matches what was there when the boundary was declared',
    'too-long': 'lapsed: that session\'s transcript has grown past what the read covers, so what arrived since is unknown',
    'torn': 'lapsed: a line of that session\'s transcript cannot be read, so what arrived since is unknown'
};

// One marker's line in the status report, on the same legs as the gate-state
// report's: the read refusals are told apart by the reader's own reason (a second
// lstat here could not see the 'unreadable' leg at all), a present marker is
// judged by the same markerMatches rule the gate decides by, and a dead one
// is flagged with why, so the file's presence is never misreported as a live
// release. `verb` is how presence is phrased ("open" for a declared boundary,
// "present" for a recorded consent), and `boundPhrase` names the age bound
// that applies to this kind.
//
// The marker is judged for the session it itself names, deliberately: a shell
// running status is not the offering session, so the wrong-session leg is not
// this report's question to answer. What it answers is whether the marker
// would release the session it names, and it prints that session so the
// operator can judge the scoping half themselves. One call is one marker, so
// the boundary kind takes a call per open declaration in the project and the
// consent kind, one file per project, takes exactly one.
//
// `momentRead` says whether the moment rule is read for this kind: true for the
// marker kind that can carry a declaration (a role-boundary marker) and false
// for the one that cannot (a consent is the operator's word rather than a
// seat's moment). Within that kind the rule still applies only to the boundary
// verb's declared marker, which markerDeclaresMoment decides, and the
// transcript it is read against is the one the harness filed for the marker's
// session, located by that id alone through findTranscript, the same lookup the
// verb measured it on. A marker the moment rule has retired is reported as
// lapsed rather than as live: it is still on disk, the gate ignores it, and the
// next marker write sweeps it once it passes its age bound, which is exactly
// the state an operator has no other way to see.
//
// `named` is the session the marker's own FILE NAME carries, the caller's own
// id for the boundary kind, and null where the report has no name to hold the
// record against. Two things turn on it. It names whose file a refusal is
// about. And it is checked against the record inside, because the gate resolves
// a marker by name and then requires the record to agree: a file at one
// session's name recording another releases neither, and reporting it as live
// for the session it records would describe a marker the gate can never reach.
function reportMarker(read, label, verb, maxAgeMs, boundPhrase, momentRead, named) {
    const marker = read.marker;
    const whose = (typeof named === 'string' && named !== '')
        ? ' for session ' + sanitize(named)
        : '';
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
        || typeof marker.session !== 'string') {
        const reason = marker === null ? read.reason : 'illegible';
        if (reason === 'illegible') {
            emitOut('an illegible ' + label + ' marker file is present' + whose + ' '
                + '(the gate treats it as absent); the next ' + label + ' write replaces it\n');
        } else if (reason === 'oversized') {
            emitOut('a ' + label + ' marker file past the size the reader accepts '
                + 'is present' + whose + ' (the gate treats it as absent); the next ' + label
                + ' write replaces it\n');
        } else if (reason === 'kind') {
            emitOut('something that is not a ' + label + ' marker file is sitting '
                + 'at its path' + whose + ' (the gate treats it as absent); move it aside by hand\n');
        } else if (reason === 'unreadable' || reason === 'lstat') {
            // Scoped to now: a lock lifts, and absence must not be asserted
            // over it.
            emitOut('the ' + label + ' marker path' + whose + ' cannot be read right now, '
                + 'so the gate treats it as absent while that lasts\n');
        } else if (reason === 'no-session') {
            // The resolver composed no path, so no file was read and nothing is
            // being asserted about the directory: its own fact, said as itself
            // rather than folded into either an absence or a bad file.
            emitOut('no ' + label + ' marker file name composes from that session id'
                + whose + ', so none was read\n');
        } else if (reason === 'no-root') {
            // The root rather than the id is what composed no path: the home
            // directory is unknown or a network share, which the marker root
            // refuses before any read, so nothing was read here either.
            emitOut('the home directory is unknown or names a network share, so no ' + label
                + ' marker root can be opened and none was read' + whose + '\n');
        } else {
            // Absent at the path the caller's own id resolves, or at the one
            // consent path: a genuine none-open, named for the session where
            // the report is scoped to one.
            emitOut('no ' + label + ' marker is ' + verb + whose + '\n');
        }
        return;
    }
    if (whose !== '' && !sameSessionId(marker.session, named)) {
        // The gate finds a marker by name and then holds the record to the same
        // session, so this file releases neither: not the session naming it,
        // whose read of this path finds a record for someone else, and not the
        // session recorded, whose own offer resolves a different path entirely.
        emitOut('  a ' + label + ' marker file' + whose + ' records session '
            + sanitize(marker.session) + ', so the gate reaches it for neither session; '
            + 'move it aside by hand\n');
        return;
    }
    // File-derived values print indented, never at column zero, keeping
    // sanitized untrusted data visually subordinate in a channel a model reads.
    let line = '  ' + label + ' marker ' + verb + ' for session ' + sanitize(marker.session);
    line += (typeof marker.writtenAt === 'string')
        ? ' (written ' + sanitize(marker.writtenAt) + ')'
        : ' (no written timestamp recorded)';
    const verdict = markerMatches(marker, marker.session, Date.now(), maxAgeMs);
    // The moment rule governs a declared marker only, so a hook-written one is
    // reported on its age bound alone and no transcript is read for it.
    const declares = markerDeclaresMoment(marker) && momentRead === true;
    // The moment is read only where the match rule has already passed, since a
    // marker the gate treats as absent is not one any transcript can speak for,
    // and the line below reports the read rather than the marker's provenance:
    // one condition governs the call and the report of it, so the report can
    // never assert a read that did not happen.
    const reads = declares && verdict.ok;
    const transcript = reads ? findTranscript(marker.session) : null;
    const moment = reads
        ? markerMomentHolds(marker, transcript)
        : { ok: true, reason: null };
    if (!verdict.ok) {
        line += ' - ' + (verdict.reason === 'expired'
            ? 'expired (past the ' + boundPhrase + ' bound), so the gate treats it as absent'
            : (MARKER_DEAD_REASONS[verdict.reason] || 'the gate treats it as absent'));
    } else if (!moment.ok) {
        line += ' - ' + (MARKER_LAPSED_REASONS[moment.reason] || 'lapsed')
            + ', so the gate treats it as absent; declare again at the next real boundary';
    } else {
        line += ' - the gate honors it once for that session\'s next deferred auto-compaction, '
            + 'within the ' + boundPhrase + ' bound';
    }
    emitOut(line + '\n');
    // Which transcript answered the moment question, named rather than left to
    // be assumed. This report locates the file by the session id, the same
    // lookup the verb measured the declaration on; the gate reads the path its
    // own PreCompact payload carries. The two are one file for a session the
    // harness filed under exactly one project directory, and a miss here is the
    // lookup's own (no transcript of that id, or one under more than one project
    // directory), said as such rather than as a contradiction of the gate.
    if (reads) {
        emitOut('    moment read against ' + (transcript === null
            ? '(no transcript is located by that session id: the harness\'s projects directory holds'
                + ' none for it, or holds one under more than one project directory)'
            : displayPath(transcript))
            + ', the transcript located by that session\'s id\n');
    }
}

// The compaction gate's own record: what it decided last. An operator reads
// this to tell a gate that is working from one that has recorded nothing,
// which is the question the state file exists to answer; the full history is
// the .jsonl log beside it, and the per-session holds the deferral nudge reads
// are not printed, since they carry session ids this report has no reason to
// put on a terminal.
function reportGateState(cwd) {
    const result = readGateStateResult(cwd);
    if (!result.ok) {
        // A state file the reader refuses is not an absent one, and reporting it
        // as absent would describe a project recording nothing as a fresh one.
        // The refusal legs do not all mean the same thing, though, and the
        // message names a remedy: removing the file discards every session's
        // standing hold record, so it is advice worth giving over a file that
        // will never resolve and worth withholding over a scanner's lock that
        // lifts in seconds.
        //
        // Which leg it was comes from the reader's own refusal. Re-asking with
        // an lstat here cannot see the leg where the read was refused: that
        // lstat succeeds and reports an ordinary regular file, so the
        // destructive advice would print over exactly the transient case it is
        // withheld for.
        //
        // Both remedies name the file at the path the reader itself used rather
        // than at a spelling written out here: the scratch directory is
        // resolved (kitScratchDir in kit-compact-lib.js), and a project
        // directory inside the memory store keeps its gate state outside the
        // project, so a hard-coded `.kit/` remedy would send an operator to
        // inspect a file that is not there. It is a value known to be a path, so
        // it takes displayPath, since a project under the operator's home carries
        // the OS account name into a channel a model reads.
        const statePath = displayPath(gateStatePath(cwd));
        if (result.reason === 'oversized') {
            // The file is legible and was refused on size, which is not the
            // same fact as a read that failed, and one refusal answered two
            // ways is what the shared-spelling rule exists to stop.
            emitOut('a compaction gate state file past the size the reader accepts is present, '
                + 'so the gate is recording nothing; removing ' + statePath + ' lets the next '
                + 'decision rebuild it\n');
        } else if (result.reason === 'kind') {
            emitOut('something that is not the gate state file is sitting at '
                + statePath + ', so the gate is recording nothing; move it aside by hand '
                + '(a delete cannot remove it)\n');
        } else {
            emitOut('the compaction gate state file cannot be read right now, so the gate '
                + 'is recording nothing while that lasts; try again once whatever holds it lets go\n');
        }
        return;
    }
    const state = result.state;
    const last = state && state.lastDecision;
    if (!last) {
        emitOut('the compaction gate has recorded no decisions in this project\n');
    } else {
        // File-derived values print indented, never at column zero, keeping
        // sanitized untrusted data visually subordinate in a channel a model
        // reads.
        let line = '  last compaction gate decision: ' + sanitize(last.verdict);
        if (last.reason) line += ' (' + sanitize(last.reason) + ')';
        // Clamped: `at` comes out of a file anyone can write, and an unclamped
        // one renders a twelve-digit minute count on a surface a model reads.
        const age = gateCount(wholeMinutesSince(last.at));
        if (age !== null) line += ', ' + age + (age === 1 ? ' minute ago' : ' minutes ago');
        emitOut(line + '\n');
    }
}

// The deferral nudge's hold stamps, reported only when the file is refusing the
// writer, which is the one thing about it an operator can neither see nor infer
// from anywhere else.
//
// The stamp file is that nudge's clock for each held session,
// and the directive is emitted only when the stamp lands, so a file the writer
// refuses is a session being held and never spoken to. Two of the five refusals
// end by themselves, since the next directive removes a file this writer cannot
// have produced (an oversized one, or a link at the path) and rebuilds it. The
// other three do not: a refused open, an lstat that could not answer, and a read
// that ended short of the file all leave the path exactly as it was, over
// contents that may be a real list of live stamps. They are worded apart on
// the rule every report here takes, that a leg drawing destructive advice or
// promising self-repair must be
// one where that is true, and the promise of a replacement therefore rides
// membership in the library's own healable set rather than a reading's name.
//
// Two of those three are stated as of now rather than as a standing shape, and
// deliberately without a claim either way: a lock or a scanner lifts on its own,
// while something that is not a regular file at the path never does, and this
// report cannot tell them apart, since the reader answers both with the same
// refused open. So the line names the path to look at rather than promising the
// wait ends, which is what keeps it from telling an operator to wait out a
// directory.
//
// A reading that stands prints nothing, which is where this parts from the
// reports above. What they answer is whether a marker is in effect and what
// the gate last decided, which is a state an operator asks about; the stamps answer only when
// each held session was last spoken to, which is the nudge's own bookkeeping and
// carries session ids this report has no reason to put on a terminal.
//
// The reason comes from the reader's own refusal rather than from a second
// syscall here, for the reason reportGateState states: an lstat asked afterwards
// cannot see the leg where the READ was refused, so the two would be reported as
// one. The path is composed rather than written out, since a project inside the
// memory store keeps these files outside the project (kitScratchDir), and it
// rides this file's display guard on the way out; it is the only value
// interpolated, the five reasons being this library's own fixed words with
// nothing file-derived reaching the line.
//
// WHICH readings promise a replacement is not decided here. That authority is
// the library's HOLD_NUDGE_HEALABLE, the same list the writer heals by, so the
// two sides cannot come to disagree about one file: a reason added there gains
// the promise on this surface in the same edit, and one removed loses it.
// Spelling the reason names again here is what would let the writer start
// healing a file this verb still describes as standing.
function reportHoldStamps(cwd) {
    const result = readHoldNudgesResult(cwd, Date.now());
    if (result.ok) return;
    const stampPath = displayPath(holdNudgePath(cwd));

    // What was read, worded per reading, since the legs name different things
    // about the same path. The per-reason wordings below are genuinely
    // per-reason and are spelled by name for that reason. What is NOT decided by
    // name is the healable-versus-refusing split: the fallback that catches a
    // reading with no wording of its own forks on the same HOLD_NUDGE_HEALABLE
    // membership the remedy below rides, so a sixth healable reason added to the
    // library's set cannot land on the refusing wording and print "cannot be
    // read" beside a promise that the next directive replaces it. That
    // self-contradicting pair is exactly what spelling the set's members again
    // on this side would produce.
    let lead;
    if (result.reason === 'oversized') {
        lead = 'the deferral nudge\'s hold stamps at ' + stampPath
            + ' are past the size the reader accepts';
    } else if (result.reason === 'kind') {
        lead = 'something that is not the deferral nudge\'s hold stamp file is sitting at ' + stampPath;
    } else if (result.reason === 'short-fill') {
        // The reading that ended short of the file. Nothing here identifies the
        // file as one the nudge did not write, so nothing removes it.
        lead = 'the read of the deferral nudge\'s hold stamps at ' + stampPath + ' ended short of the file';
    } else if (HOLD_NUDGE_HEALABLE.includes(result.reason)) {
        // A healable reading with no wording of its own: the set says the writer
        // identified this file as one it could not have produced and removes it,
        // so the line says that much and leaves the shape unnamed rather than
        // borrowing the refusing leg's claim that nothing can be told about the
        // path. Nothing reaches this branch today, the set's two members both
        // having their own wording above; it is what a sixth member lands on.
        lead = 'the deferral nudge\'s hold stamp file at ' + stampPath
            + ' is not one that writer produced';
    } else {
        // 'unreadable' and 'lstat' together: both may be a lock over a file
        // holding live stamps, and both may equally be a directory or another
        // shape at the path that never lifts, so this leg claims nothing about
        // what is there. What the operator can act on is the path, which is
        // named.
        //
        // One shape lands here that the writer does in fact remove: a FIFO or a
        // socket, which the reader refuses on the descriptor and cannot tell
        // from a lock, while the writer's own lstat calls it a kind it unlinks.
        // readHoldNudgesResult states why the two sides are asked differently.
        // What that costs is bounded to this line being weaker than the truth
        // for those kinds rather than wrong about them, since it promises
        // neither a repair nor an end to the wait.
        lead = 'the deferral nudge\'s hold stamp file at ' + stampPath + ' cannot be read';
    }

    // What happens next, decided by membership in the healable set rather than
    // by the reason's name. The promise is CONDITIONAL because the repair it
    // names is: the heal is an unlink, which takes permission on the scratch
    // directory itself, so under a read-only .kit/ the next directive refuses
    // and the file stands. An unconditional promise there tells an operator to
    // wait out a replacement that never comes, which is the same failure the
    // refusing legs are worded to avoid.
    const remedy = HOLD_NUDGE_HEALABLE.includes(result.reason)
        ? 'the next hold directive replaces it, so long as the directory holding it is writable'
        : (result.reason === 'short-fill'
            ? 'the stamps are left as they are and a read that completes takes them again'
            : 'a lock or a scanner over it clears on its own, while anything else standing at '
                + 'that path does not');

    emitOut(lead + ', so a held session cannot be stamped and its directive stays '
        + 'silent; ' + remedy + '\n');
}

// The calling session's own role-boundary declaration, one line. The root
// holds one file per session for every session on the machine, so a report
// that listed it would print every session's id into whichever session ran
// it; the question this report answers is therefore what is open for ME,
// scoped by the caller's own id from the environment, and a shell with no
// usable id is told the report cannot be scoped rather than shown everyone's.
//
// The marker is judged against the caller's id as the file name the resolver
// composes from it, which is what lets a file at that name recording a
// different session be reported as one the gate cannot reach rather than as
// that session's live release.
function reportOwnRoleBoundaryMarker() {
    const caller = callerSessionId();
    if (caller === null) {
        emitOut('no usable session id in this shell (CLAUDE_CODE_SESSION_ID is unset or not id-shaped),'
            + ' so the role-boundary marker report cannot be scoped to a session and none is shown:'
            + ' the markers are keyed by session under the home directory, and this report shows only'
            + ' the calling session\'s own\n');
        return;
    }
    reportMarker(readRoleBoundaryResult(caller), 'role-boundary', 'open',
        ROLE_BOUNDARY_MAX_AGE_MS, BOUNDARY_HOURS + '-hour', true, caller);
}

function cmdStatus() {
    const cwd = process.cwd();
    reportOwnRoleBoundaryMarker();
    reportMarker(readConsentResult(cwd), 'operator-consent', 'present',
        CONSENT_MAX_AGE_MS, CONSENT_HOURS + '-hour', false, null);
    reportGateState(cwd);
    reportHoldStamps(cwd);
    process.exitCode = 0;
}

function main() {
    const [cmd] = process.argv.slice(2);
    if (cmd === 'status') cmdStatus();
    else if (cmd === 'boundary') cmdBoundary(process.argv.slice(3));
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
