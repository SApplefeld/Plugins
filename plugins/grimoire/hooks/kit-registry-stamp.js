#!/usr/bin/env node
// The coordinator directory's time fields: the stamps a session's own write
// step reads from the clock, and the audit that reads the stamps already on
// disk against the comparators beside them.
//
// Subcommands:
//   kit-registry-stamp.js push [--takeover]
//                                         stamp this session's registry entry
//                                         `Status-updated:` with now, and
//                                         `Started:` too at a takeover, unless
//                                         it already holds a stamp of the
//                                         stamper's own shape
//   kit-registry-stamp.js now             print one moment read from the clock,
//                                         for a line whose only writer is a
//                                         session (a board line's evidence time)
//   kit-registry-stamp.js audit [--dir <coordinator directory>]
//                                         report the registry entries' and the
//                                         board's stamps against the
//                                         comparators beside them
//
// `push` is the stamping helper the seat's own status push calls. The registry
// entry is single-writer under the role skill's directory contract, the
// registering session plus the two machine-stamped lines the seat-stop hook and
// the compaction checkpoint CLI own, so `Started:` and `Status-updated:` stay
// the session's fields and this verb changes who reads the clock rather than
// who writes the line: the session composes its `Remaining:` and `Status:`
// prose and runs this last, so the moments on the entry are an instrument's.
// Nothing else in the entry is touched.
//
// `now` is the same repair where there is no line to rewrite. A coordinator
// board line carries the time of its evidence inside its own prose, and only
// the coordinator writes that file, so nothing can stamp a field there; what a
// tool can do is supply the moment, which is the half a writer gets wrong.
//
// `audit` is the reading side. Three readings, each resting on a value the
// artifact's own writer did not supply:
//
//   1. A session-written registry stamp falling on a whole second. This is a
//      population reading and never a per-seat verdict. This stamper never
//      writes one, since it moves a whole-second read forward a millisecond,
//      so the stamp came from another writer: a hand-typed moment lands there
//      almost every time, and another tool's honest clock read about once in
//      a thousand, which is the harmless direction to fail. So it says
//      something about a directory of entries and nothing about the seat that
//      wrote any one of them.
//   2. A session-written registry stamp leading that entry's hook-stamped
//      `Heartbeat:` by more than the heartbeat throttle window. The heartbeat
//      is machine written, so the comparison needs no second clock and catches
//      the fabricated-forward stamp the round-second reading cannot see. The
//      window is the throttle itself, since a stop after a push restamps the
//      heartbeat unless the throttle refuses it, so an honest push sits at most
//      one throttle window ahead of the heartbeat once the session has stopped.
//      The hook stamps at a turn end and nowhere else, so a push made inside
//      a turn that has not ended yet legitimately leads the heartbeat from
//      the previous turn's end and reads here exactly as a fabricated stamp
//      does. That false positive is admitted rather than screened out, for
//      the arithmetic reason `stampsLeadingHeartbeat` states at its own
//      definition, which is why this reading produces a report and never a
//      verdict.
//   3. Any stamp, in an entry or in a board line, sitting ahead of the clock
//      past the skew the compaction checkpoint allows for one. The board takes
//      this reading alone: it carries no machine-written comparator for reading
//      2, and its evidence times are legitimately written at minute precision,
//      so reading 1 over it would fire on honest lines. Its stamps are found by
//      their ISO shape inside the prose, the board having no field grammar to
//      read them out of.
//
// The board read is the one the operator-tier location record names for this
// machine through its `board:` key, else the directory contract's `board.md`;
// where neither holds a file the run says the board leg did not run.
//
// Every finding is a report and gates nothing. The audit writes nothing and
// reads entries through the same screen the mechanical stampers read them
// through. What it never does is confuse scanning nothing with finding nothing.
// The only scope it scans is one machine's directory under the coordinator
// root, judged on the real path rather than the spelling; anything else is
// refused and named, the root itself and a directory inside a machine's
// included, since neither holds artifacts of this shape and a clean reading of
// either would say the machine is clean when nothing about it was read. An
// unreadable artifact inside a scanned scope is itself a finding, a listing too
// large to read whole is reported as partial, and every run states what it
// scanned. The exit code carries three states: 0 for a clean scan, 1 for a scan
// that produced findings (an unreadable artifact and a partial listing both
// count as findings), and 2 for a run that never reached a scan: a refused,
// absent or unreadable scope, a kit library that would not load, or an
// unexpected error. A machine directory that exists and holds nothing yet is
// still scanned and exits 0, its coverage line saying what was not there. A
// caller reads the result from the exit code rather than from a grep over the
// text.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// The kit libraries, bound through a guard that splits the two ways this file
// is loaded. Run as a CLI, a require that throws would print Node's own trace,
// and every module path on a `Require stack:` is home-anchored on an installed
// plugin, while this tool's output is read by a model that was told to run it;
// so that leg names the failure, withholds the text and exits nonzero. Required
// as a MODULE, the throw rides on unchanged: the constants this file exports are
// derived from the libraries' at module scope just below, so a module that
// loaded with them unbound would answer undefined where it now fails loudly.
let readRegistryEntryText, stampRegistryFields,
    usableSessionId, CHECKPOINT_FUTURE_SKEW_MS,
    coordinatorRoot, coordinatorDir, field, sanitize, displayPath,
    namesNetworkShare, screenRecordedPath,
    containedRealPath, listBoundedNames, DIR_SCAN_MAX_ENTRIES,
    HEARTBEAT_THROTTLE_MS;
try {
    ({
        readRegistryEntryText, stampRegistryFields,
        usableSessionId, CHECKPOINT_FUTURE_SKEW_MS,
        coordinatorRoot, coordinatorDir,
        registryField: field, sanitizeForOutput: sanitize, displayPath
    } = require('./kit-compact-lib.js'));
    ({ namesNetworkShare, screenRecordedPath } = require('./kit-network-lib.js'));
    ({ containedRealPath, listBoundedNames, DIR_SCAN_MAX_ENTRIES } = require('./kit-read-lib.js'));
    ({ HEARTBEAT_THROTTLE_MS } = require('./seat-stop.js'));
} catch (err) {
    if (require.main !== module) throw err;
    // The error's CODE still rides, since a Node error code is an upper-case
    // identifier (MODULE_NOT_FOUND, ERR_DLOPEN_FAILED) that names the failure's
    // kind and can carry no path; anything else in that field is dropped.
    const code = err && typeof err.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(err.code)
        ? ' (' + err.code + ')' : '';
    // Written to the descriptor rather than through process.stderr: a write to a
    // pipe is asynchronous on win32, and process.exit below does not wait for
    // one, so the single sentence this leg exists to print is the one thing an
    // exit here can drop.
    //
    // The write itself can throw, a reader that closed the pipe being the
    // ordinary way (EPIPE), and a throw here would print the stack trace whose
    // absolute paths this leg exists to keep off the channel. So a descriptor
    // that will not take the sentence loses the sentence and nothing more.
    try {
        fs.writeSync(2, 'kit-registry-stamp: a kit library could not be loaded' + code
            + ', and the renderer that takes the OS account name out of an error is in it, so the'
            + ' message itself is withheld; nothing written\n');
    } catch {
        // The channel is gone; the exit code below is what is left to say it.
    }
    process.exit(failedRunCode());
}

// The entry's session-written time fields, per the role skill's registry shape.
// `Heartbeat:` and `Banked:` are the machine-stamped lines that contract names,
// so they are this audit's comparators rather than its subjects.
const SESSION_TIME_FIELDS = ['Started', 'Status-updated'];

// Every ISO field an entry carries, for the reading that asks only whether a
// stamp sits ahead of the clock. A machine-written stamp is as capable of
// sitting in the future as a composed one where a machine's clock is wrong, and
// a reader that skipped them would be reading half the file.
const ENTRY_TIME_FIELDS = SESSION_TIME_FIELDS.concat(['Heartbeat', 'Banked']);

// How far a session-written stamp may lead the hook-stamped heartbeat before
// the audit reports it. The figure is the heartbeat throttle itself, imported
// from the hook that owns it rather than restated here, so the bound and the
// behaviour it describes cannot drift apart.
const HEARTBEAT_LEAD_MS = HEARTBEAT_THROTTLE_MS;

// How far ahead of the clock a stamp may sit before it is read as ahead of it.
// The figure is the compaction checkpoint's own future-skew allowance, imported
// rather than restated: the machines writing these files run their own clocks,
// a peer can push while a scan is running, and a zero allowance turns either
// into a finding on a healthy directory.
const FUTURE_SKEW_MS = CHECKPOINT_FUTURE_SKEW_MS;

// How much of a board this reads. The shared screen's default bound is the
// registry entry's, a handful of short lines, and a live board runs to tens of
// thousands of bytes, so the board's own bound is passed rather than the entry's
// inherited: the default would refuse a healthy board and the scan would report
// an unreadable file on every run.
const BOARD_MAX_BYTES = 4 * 1024 * 1024;

// How many findings a run prints. The board is prose any local session and any
// machine the store syncs can write, and one finding is produced per stamp in
// it, so the count is bounded by that file rather than by anything here. The
// exit code carries the reading whatever the cap does, and a run that prints
// this many has said what it needed to; the line past the cap says how many
// were withheld, so the coverage is still read from the report.
const FINDING_PRINT_CAP = 200;

// A stamp inside prose, by its ISO shape. The board carries its evidence times
// in sentences rather than in fields, at minute or second precision, so this is
// what stands in for a field read there.
const ISO_IN_PROSE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;

// A field's value as milliseconds, or null where the field is absent, empty or
// unparseable. Nothing here reads an unparseable stamp as anything: the audit
// reports what it cannot read rather than guessing at which side of a bound it
// would have fallen.
function stampMs(text, name) {
    const value = field(text, name);
    if (typeof value !== 'string' || value === '') return null;
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
}

// Whole minutes for a report an operator reads, rounded up rather than to
// nearest. Every caller reports a gap that has already passed a bound stated in
// the same sentence, so rounding down produces a line that contradicts itself,
// a gap of ten and a half minutes reading as ten minutes past a ten-minute
// window. Rounding up keeps the figure and the bound consistent.
function minutes(ms) {
    return Math.ceil(ms / (60 * 1000));
}

// A file-derived value as it appears in a report: the shared output guard at a
// short cap, taken here at the interpolation site rather than at the printer,
// because a value out of a file any local session can write is otherwise long
// enough to push the module's own prose past the printer's cap and out of the
// line. The guard rather than a local filter is what puts the home elision
// ahead of the cut, which is the ordering that guard exists for: a cap applied
// first leaves the account name at the head of whatever survives it.
function shortValue(v) {
    return sanitize(v === null || v === undefined ? '' : v, 40);
}

// Session-written stamps that fall on a whole second. Reading 1 above. The test
// is on the parsed moment rather than on the literal's spelling, so a stamp
// written with an explicit `.000` reads the same as one written without any
// fractional part at all: what the reading is about is the value, and a
// composed moment is round however it is typed.
function roundSecondStamps(text) {
    const out = [];
    for (const name of SESSION_TIME_FIELDS) {
        const at = stampMs(text, name);
        if (at === null || at % 1000 !== 0) continue;
        out.push({
            kind: 'round-second',
            field: name,
            value: field(text, name),
            what: 'the ' + name + ' stamp falls on a whole second (' + shortValue(field(text, name))
                + '), which a clock read almost never does'
        });
    }
    return out;
}

// Session-written stamps leading the hook-stamped heartbeat by more than
// leadMs. Reading 2 above. An entry with no readable heartbeat has no
// comparator, so it yields no finding in either direction: the takeover writes
// `none` there and an install without the stamping hook never advances it, and
// reading either state as a finding would report every such entry forever.
//
// One false positive is admitted rather than screened out, and naming it is
// what keeps the reading honest: the hook stamps at a turn end and nowhere
// else, so a seat that pushed twenty-five minutes into a turn that has not
// ended yet legitimately leads the heartbeat from the previous turn's end and
// reads here exactly as a fabricated stamp does. Nothing in the entry tells the
// two apart once both moments are in the past, which is why this instrument
// produces a report and never a verdict. Screening the case out by requiring a
// recent heartbeat was tried and is wrong in the arithmetic: a finding needs
// the session stamp to lead the heartbeat by more than leadMs, so demanding a
// heartbeat within leadMs of now forces that stamp past now and leaves this
// instrument a worse duplicate of the future-stamp scan, silent on exactly the
// after-the-fact fabrication it exists to catch.
function stampsLeadingHeartbeat(text, leadMs) {
    const heartbeat = stampMs(text, 'Heartbeat');
    if (heartbeat === null) return [];
    const out = [];
    for (const name of SESSION_TIME_FIELDS) {
        const at = stampMs(text, name);
        if (at === null || at - heartbeat <= leadMs) continue;
        out.push({
            kind: 'ahead-of-heartbeat',
            field: name,
            value: field(text, name),
            what: 'the ' + name + ' stamp leads the machine-written Heartbeat by '
                + minutes(at - heartbeat) + ' minutes, past the ' + minutes(leadMs)
                + '-minute window an honest push can lead it by'
        });
    }
    return out;
}

// Every stamp an entry carries that sits ahead of nowMs past the skew. Reading
// 3 above, and the read-protocol self-check a board or ledger read performs.
function futureStamps(text, nowMs, skewMs) {
    const skew = skewMs === undefined ? FUTURE_SKEW_MS : skewMs;
    const out = [];
    for (const name of ENTRY_TIME_FIELDS) {
        const at = stampMs(text, name);
        if (at === null || at - nowMs <= skew) continue;
        out.push({
            kind: 'future',
            field: name,
            value: field(text, name),
            what: 'the ' + name + ' stamp sits ' + minutes(at - nowMs) + ' minutes ahead of the clock'
        });
    }
    return out;
}

// The same reading over prose. A board line's stamp has no field name, so the
// finding names the value itself, which is what a seat searches the board for.
function futureStampsInProse(text, nowMs, skewMs) {
    const skew = skewMs === undefined ? FUTURE_SKEW_MS : skewMs;
    const out = [];
    for (const match of String(text).match(ISO_IN_PROSE) || []) {
        const at = Date.parse(match);
        if (!Number.isFinite(at) || at - nowMs <= skew) continue;
        out.push({
            kind: 'future',
            field: null,
            value: match,
            what: 'a stamp reading ' + shortValue(match) + ' sits ' + minutes(at - nowMs)
                + ' minutes ahead of the clock'
        });
    }
    return out;
}

// Every finding one registry entry carries.
function auditEntry(text, nowMs) {
    return roundSecondStamps(text)
        .concat(stampsLeadingHeartbeat(text, HEARTBEAT_LEAD_MS))
        .concat(futureStamps(text, nowMs));
}

// ---------------------------------------------------------------------------
// The stamp.
// ---------------------------------------------------------------------------

// Rewrite this session's own entry's session-written time fields with now,
// through the shared stamping channel in kit-compact-lib.js: the path, the read
// screen, the entry's own corroboration, the clock read and the atomic write
// all live there, shared with the boundary verb's `Banked:` stamp, so this
// caller supplies the field list and nothing else. What that corroboration
// does and does not establish is stated there rather than restated here.
//
// `Started:` is written exactly once per registration: the field a takeover
// stamps beside `Status-updated:`, and every later push, takeover or not,
// leaves a `Started:` the stamper itself already wrote as written, since
// rewriting it would name the moment of the later push rather than of the
// takeover that first claimed the entry. What the per-field option below
// reads is the value's shape, never its provenance: a `Started:` holding a
// moment of the stamper's own shape is kept whoever wrote it, and any other
// value, `none` and a whole-second moment among them, is stamped from the
// clock on a takeover, whether it is a first or a later one.
function stampRegistryStatus(sessionId, takeover) {
    return stampRegistryFields(sessionId,
        takeover ? ['Started', 'Status-updated'] : ['Status-updated'],
        takeover ? { keepIfOwnPrecision: ['Started'] } : undefined);
}

// ---------------------------------------------------------------------------
// The audit's own reads.
// ---------------------------------------------------------------------------

// A scope's real path where it is one machine's directory under the coordinator
// root, and null otherwise. Two screens, and each catches what the other cannot.
//
// Containment is judged on the real path through the shared link-resolving
// screen rather than on the spelling, because a lexical test reads a link's own
// name and never where it goes, so a link planted under the root would carry
// the scan wherever it points. One residual is left standing rather than
// claimed away: resolving a link is itself a touch, so a junction aimed at an
// unreachable share still costs this the connection's timeout at the resolve.
// What the screen buys is that the scan does not then proceed there, which is
// the reach the lexical test did not have.
//
// Depth is the second screen and it is what stops the audit reporting on a
// scope nobody asked about. The root holds one directory per machine and the
// artifacts sit inside those, so a machine directory is exactly one component
// below the root: the root itself and `<root>/<machine>/registry` both contain
// no `registry/` and no board of their own, and a scan of either
// finds nothing because there is nothing of this shape there, not because the
// machine is clean. Requiring the depth refuses both, while a machine directory
// that genuinely holds nothing yet still scans and still reports honestly.
//
// Absence is kept apart from both screens and answers in its own words. A
// mistyped machine name resolves to a path this would have scanned, and calling
// that out of scope sends the caller hunting the wrong mistake; the two are the
// same silence and different repairs. The order is what makes the extra answer
// safe: the lexical depth screen runs first and touches nothing, so only a path
// already inside the root is ever stat'd, and no value outside it learns from
// this whether it exists.
// One spelling of the containment refusal, because every branch below reaches
// it for the same reason and a caller reading the reason should not be able to
// tell which branch caught the value: the answer is the same either way.
const SCOPE_REFUSAL = '--dir is not one machine\'s directory under the store\'s coordinator directory,'
    + ' which is the only scope this scans';

function machineDirScope(raw) {
    const root = coordinatorRoot();
    const lexRel = path.relative(path.resolve(root), raw);
    if (lexRel === '' || lexRel === '..' || lexRel.startsWith('..' + path.sep)
        || lexRel.includes('/') || lexRel.includes('\\')) {
        return { dir: null, reason: SCOPE_REFUSAL };
    }
    if (presence(raw) === 'absent') {
        return {
            dir: null,
            reason: '--dir names no directory under the store\'s coordinator directory,'
                + ' so there was nothing to scan'
        };
    }
    const real = containedRealPath(root, raw);
    if (real === null) return { dir: null, reason: SCOPE_REFUSAL };
    let realRoot;
    try { realRoot = fs.realpathSync(root); } catch { return { dir: null, reason: SCOPE_REFUSAL }; }
    const rel = path.relative(realRoot, real);
    if (rel === '' || rel === '..') return { dir: null, reason: SCOPE_REFUSAL };
    if (rel.includes('/') || rel.includes('\\')) return { dir: null, reason: SCOPE_REFUSAL };
    return { dir: real, reason: null };
}

// The directory a run scans, as { dir, reason }. A null dir refuses the run
// with that reason rather than scanning something else, because every refusal
// here is a scope the caller did not mean and a scan of it would report a clean
// directory that is not the one asked about.
//
// The network-shaped refusal is the shared guard from kit-network-lib.js rather
// than a second copy of it, and it is applied to the value as given and to the
// resolved path both: the touch is itself the harm, a share path making this
// machine authenticate outbound to a host of the caller's choosing and blocking
// for the connection's own timeout while it does. Containment under the
// coordinator root is the second screen, since this tool exists to read one
// directory's artifacts and a path outside it is a value nothing here vouches
// for.
function resolveScope(raw) {
    if (raw === null) return { dir: coordinatorDir(), reason: null };
    if (typeof raw !== 'string' || raw.trim() === '') {
        return { dir: null, reason: '--dir needs a directory, and an empty value would scan whatever the shell stands in' };
    }
    if (namesNetworkShare(raw)) {
        return { dir: null, reason: '--dir names a network share, which this reads nothing from' };
    }
    const resolved = path.resolve(raw);
    if (namesNetworkShare(resolved)) {
        return { dir: null, reason: '--dir resolves to a network share, which this reads nothing from' };
    }
    return machineDirScope(resolved);
}

// Whether a path is there to be read: 'present', 'absent', or 'unreadable'.
// The three are kept apart everywhere below, because a scan that cannot tell
// them apart reports a directory it never opened as a directory with nothing
// in it, which is the one failure an instrument like this must not have.
function presence(full) {
    try {
        fs.lstatSync(full);
        return 'present';
    } catch (err) {
        return (err && err.code === 'ENOENT') ? 'absent' : 'unreadable';
    }
}

// The `.md` names under a directory, as { names, reason, bounded }. A null
// names refuses the read; an absent directory answers an empty list with
// 'absent', which is an ordinary state for a machine on which no seat has
// registered; `bounded` says the listing was cut, so a partial read is reported
// as partial rather than as the whole directory.
//
// The listing goes through the shared capped lister rather than readdirSync,
// which materializes a whole directory before the first name can be judged: any
// local session and any machine the store syncs can write here, so the number
// of entries is not this reader's to assume.
function mdNames(dir, root) {
    if (presence(dir) === 'absent') return { names: [], reason: 'absent', bounded: false };
    // The containment screen is taken again here and not only at the scope,
    // because the two readings above disagree about links by construction:
    // `presence` is an lstat, so a symlink at this path reads present, while the
    // lister below opens through it. Any local session and any machine the store
    // syncs can write into the directory this path sits in, so a link planted
    // here would otherwise list and read `.md` files at the far end of it, which
    // are exactly the files the scope screen exists to keep out of range.
    if (containedRealPath(root, dir) === null) {
        return { names: null, reason: 'uncontained', bounded: false };
    }
    const listed = listBoundedNames(dir, DIR_SCAN_MAX_ENTRIES,
        (entry) => entry.isFile() && entry.name.endsWith('.md'));
    if (listed.bounded && listed.names.length === 0) {
        return { names: null, reason: 'unreadable', bounded: true };
    }
    return { names: listed.names.slice().sort(), reason: null, bounded: listed.bounded };
}

function findingLine(subject, finding) {
    return '  ' + sanitize(subject) + ': ' + sanitize(finding.what, 300);
}

// The file-name opening of an operator-tier record that says where a machine's
// board lives, when it is not at the directory contract's `board.md`.
const BOARD_RECORD_PREFIX = 'coordinator-board-location';

// Where the operator-tier location record puts this machine's board, as
// { path, record, keyless, refused, unreadable, ambiguous, unread }.
//
// A candidate is a record whose file name opens with the prefix above and
// whose `machine:` names this host, under memq's own machine-equality rule
// (foreignMachine), read from one read of the record's text through the same
// capped reader every artifact in this audit takes. A record that reader
// refuses is not a candidate: its `board:` key is never read, and its name
// rides in `unreadable` with the reader's own reason. Its machine is unknown
// for the same reason, so it is reported whichever machine it describes, and
// it never counts toward ambiguity: a readable keyed record beside it is still
// the location, with the unread record reported as a finding. The path is
// read from the record's `board:` frontmatter key and never out of its prose,
// so a seat and this audit take the location from one keyed value. One candidate
// carrying the key is the location. More than one is `ambiguous`, which names
// each and leaves the leg unscanned rather than choosing. A candidate with no
// key is the same as no record, and its name rides in `keyless` so the report
// can say what the record lacks. A key whose value the recorded-path screen
// refuses rides in `refused` with the rule it met, and is never opened.
//
// The tier is memq's, resolved through memq's own store root, so an honored
// store override moves it exactly as it moves every other store read. memq is
// loaded here rather than at the top of the file, because only this leg needs
// it. A memq that will not load, or a tier path it cannot resolve, is `unread`,
// so the report says the location went unread rather than that there is none,
// and the board leg goes on to the contract path.
function boardLocation() {
    const none = {
        path: null, record: null, keyless: [], refused: [], unreadable: [], ambiguous: null, unread: null
    };
    let memq, tier;
    try {
        memq = require('../scripts/memq.js');
        tier = memq.operatorDirPath();
    } catch {
        return { ...none, unread: 'the operator tier could not be reached' };
    }
    const listed = listBoundedNames(tier, DIR_SCAN_MAX_ENTRIES,
        (entry) => entry.isFile() && entry.name.startsWith(BOARD_RECORD_PREFIX) && entry.name.endsWith('.md'));
    // A tier that exists and would not open reads bounded with no names, the
    // open-failure shape mdNames separates too, and is unread rather than a
    // tier holding no record.
    if (listed.bounded && listed.names.length === 0) {
        return { ...none, unread: 'the operator tier could not be listed' };
    }
    const out = { ...none };
    const keyed = [];
    for (const file of listed.names.slice().sort()) {
        const name = file.slice(0, -3);
        // A record past the cap or otherwise unreadable carries no identity, so
        // it is not a candidate: its `board:` key is never read or followed.
        const read = readRegistryEntryText(path.join(tier, file));
        if (read.text === null) {
            out.unreadable.push({ name, reason: read.reason });
            continue;
        }
        const text = read.text;
        const machine = memq.machineIdentityOrNull(memq.frontmatterValue(text, 'machine'));
        if (machine === null || memq.foreignMachine(machine, os.hostname())) continue;
        const board = memq.frontmatterValue(text, 'board');
        if (typeof board !== 'string' || board.trim() === '') {
            out.keyless.push(name);
            continue;
        }
        const screened = screenRecordedPath(board.trim());
        if (screened.path === null) {
            out.refused.push({ name, reason: screened.reason });
            continue;
        }
        keyed.push({ name, path: screened.path });
    }
    if (keyed.length > 1) {
        out.ambiguous = keyed.map((k) => k.name);
    } else if (keyed.length === 1) {
        out.path = keyed[0].path;
        out.record = keyed[0].name;
    }
    return out;
}

// Whether a scanned directory is this machine's own. The location record
// describes this host's board, so it is asked only for this host's directory;
// a scan of another machine's directory reads that directory's contract path.
function isThisMachineDir(dir) {
    return path.basename(dir).toLowerCase() === os.hostname().toLowerCase();
}

// Every finding under one coordinator directory, as { findings, scanned }.
// `scanned` carries what each artifact was, so a run always says what it read
// rather than leaving a caller to infer coverage from silence.
//
// Entries are read through the shared screen the mechanical stampers read them
// through, the board included: that screen is a property of the channel rather
// than of whichever writer needed it first, and the board is the directory's
// widest-writer form.
function auditDir(dir, nowMs) {
    const findings = [];
    const scanned = { entries: 0, registry: null, board: null };

    const registryDir = path.join(dir, 'registry');
    const listed = mdNames(registryDir, dir);
    if (listed.names === null) {
        scanned.registry = 'unreadable';
        findings.push({
            subject: 'registry/',
            finding: {
                kind: 'unread',
                what: listed.reason === 'uncontained'
                    ? 'the registry directory resolves outside the machine directory that holds it,'
                        + ' so it is refused rather than listed'
                    : 'the registry directory is present and could not be listed'
            }
        });
    } else {
        scanned.registry = listed.reason === 'absent' ? 'absent' : 'read';
        if (listed.bounded) {
            findings.push({
                subject: 'registry/',
                finding: {
                    kind: 'unread',
                    what: 'the registry directory holds more entries than one scan reads, so what'
                        + ' follows covers part of it and the rest is unread'
                }
            });
        }
        for (const name of listed.names) {
            const read = readRegistryEntryText(path.join(registryDir, name));
            if (read.text === null) {
                findings.push({ subject: 'registry/' + name, finding: { kind: 'unread', what: read.reason } });
                continue;
            }
            scanned.entries += 1;
            for (const finding of auditEntry(read.text, nowMs)) {
                findings.push({ subject: 'registry/' + name, finding });
            }
        }
    }

    // The board's location: the operator-tier record's `board:` path where one
    // names a file, else the directory contract's `board.md`. Where neither
    // yields a file the leg did not run, which the coverage line says in those
    // words, since a missing board is a leg unscanned rather than a clean one.
    const location = isThisMachineDir(dir) ? boardLocation() : null;
    if (location !== null) {
        scanned.boardKeyless = location.keyless;
        if (location.unread !== null) {
            findings.push({
                subject: 'board location',
                finding: { kind: 'unread', what: location.unread + ', so no location record was read' }
            });
        }
        for (const { name, reason } of location.refused) {
            findings.push({
                subject: 'operator-tier record ' + name,
                finding: {
                    kind: 'unread',
                    what: 'its board: value ' + reason + ', so the location it records was not used'
                }
            });
        }
        for (const { name, reason } of location.unreadable) {
            findings.push({
                subject: 'operator-tier record ' + name,
                finding: { kind: 'unread', what: reason + ', so its board: key was never read' }
            });
        }
        if (location.ambiguous !== null) {
            scanned.board = 'ambiguous';
            findings.push({
                subject: 'board location',
                finding: {
                    kind: 'unread',
                    what: location.ambiguous.length + ' operator-tier records name a board for this machine ('
                        + location.ambiguous.join(', ') + '), so which is its board is ambiguous and the'
                        + ' board leg was not run'
                }
            });
            return { findings, scanned };
        }
    }
    const tried = [];
    if (location !== null && location.path !== null) {
        tried.push({ full: location.path, subject: location.path, record: location.record });
    }
    tried.push({ full: path.join(dir, 'board.md'), subject: 'board.md', record: null });
    const chosen = tried.find((t) => presence(t.full) !== 'absent') || null;
    if (chosen === null) {
        scanned.board = 'not run';
        scanned.boardTried = tried.map((t) => t.full);
        return { findings, scanned };
    }
    const boardPath = chosen.full;
    const boardSubject = chosen.subject;
    if (chosen.record !== null) {
        scanned.boardAt = chosen.full;
        scanned.boardRecord = chosen.record;
    }
    const boardThere = presence(boardPath);
    scanned.board = boardThere === 'present' ? 'read' : boardThere;
    if (boardThere === 'unreadable') {
        findings.push({
            subject: boardSubject,
            finding: { kind: 'unread', what: 'the board is present and could not be read' }
        });
    } else if (boardThere === 'present') {
        const read = readRegistryEntryText(boardPath, BOARD_MAX_BYTES);
        if (read.text === null) {
            scanned.board = 'unreadable';
            findings.push({ subject: boardSubject, finding: { kind: 'unread', what: read.reason } });
        } else {
            // Coverage on the board is the count of stamps this recognized, not
            // the fact that the file opened. The board has no field grammar, so
            // its stamps are found by their ISO shape, and a board writing its
            // moments in any other spelling yields nothing to read: reporting
            // that as a read board would be the same confusion of scanning
            // nothing with finding nothing that the scope screen exists to stop.
            const boardStamps = (String(read.text).match(ISO_IN_PROSE) || []).length;
            scanned.board = boardStamps + (boardStamps === 1 ? ' stamp read' : ' stamps read');
            for (const finding of futureStampsInProse(read.text, nowMs)) {
                findings.push({ subject: boardSubject, finding });
            }
        }
    }

    return { findings, scanned };
}

// ---------------------------------------------------------------------------
// The CLI.
// ---------------------------------------------------------------------------

function usage() {
    process.stderr.write('usage: kit-registry-stamp.js push [--takeover] | now'
        + ' | audit [--dir <coordinator directory>]\n');
    process.exitCode = 1;
}

// The calling session's own id, from the environment the harness sets for a
// session's tool shell, or null when nothing usable is there. Where no id is
// derivable the stamp refuses rather than writing into a file it cannot place,
// which is the sibling CLI's own degradation.
function callerSessionId() {
    return usableSessionId(process.env.CLAUDE_CODE_SESSION_ID);
}

function cmdPush(rest) {
    const takeover = rest.length === 1 && rest[0] === '--takeover';
    if (rest.length !== 0 && !takeover) {
        process.stderr.write('usage: kit-registry-stamp.js push [--takeover] (no other arguments:'
            + ' the stamp is the calling session\'s own entry)\n');
        process.exitCode = 1;
        return;
    }
    const session = callerSessionId();
    if (session === null) {
        process.stderr.write('kit-registry-stamp: no usable session id in this shell'
            + ' (CLAUDE_CODE_SESSION_ID is unset or not id-shaped), so the entry to stamp cannot be'
            + ' established; nothing written\n');
        process.exitCode = 1;
        return;
    }
    const result = stampRegistryStatus(session, takeover);
    if (!result.stamped) {
        process.stderr.write('kit-registry-stamp: ' + sanitize(result.reason) + '; nothing written\n');
        process.exitCode = 1;
        return;
    }
    // File-derived values print indented, never at column zero, keeping them
    // visually subordinate in a channel a model reads.
    if (takeover && Array.isArray(result.kept) && result.kept.includes('Started')) {
        process.stdout.write('  registry Started kept: it already holds a stamp of the stamper\'s shape;'
            + ' Status-updated stamped ' + sanitize(result.at) + '\n');
    } else {
        process.stdout.write('  registry ' + (takeover ? 'Started and Status-updated' : 'Status-updated')
            + ' stamped ' + sanitize(result.at) + '\n');
    }
    process.exitCode = 0;
}

function cmdNow(rest) {
    if (rest.length !== 0) {
        process.stderr.write('usage: kit-registry-stamp.js now (no arguments)\n');
        process.exitCode = 1;
        return;
    }
    process.stdout.write(new Date().toISOString() + '\n');
    process.exitCode = 0;
}

// What the run covered, printed on every run whatever it found, so coverage is
// read from the report rather than inferred from the absence of findings.
function scannedPhrase(scanned) {
    const parts = [scanned.entries + (scanned.entries === 1 ? ' registry entry' : ' registry entries')];
    if (scanned.registry !== 'read') parts.push('the registry directory ' + scanned.registry);
    // The board reports the count it recognized rather than that it opened, so
    // the two shapes read differently here on purpose. A leg that did not run
    // says so and names every path it looked at, and never reads as a board
    // found empty.
    if (scanned.board === 'not run') {
        parts.push('no board at ' + scanned.boardTried.map((p) => sanitize(displayPath(p))).join(' or ')
            + ', board leg not run');
    } else if (scanned.board === 'ambiguous') {
        parts.push('board leg not run, its location ambiguous');
    } else if (typeof scanned.board === 'string' && /^\d+ stamps? read$/.test(scanned.board)) {
        parts.push('the board with ' + scanned.board + (scanned.boardRecord
            ? ' at ' + sanitize(displayPath(scanned.boardAt)) + ', located by the operator-tier record '
                + sanitize(scanned.boardRecord)
            : ''));
    } else {
        parts.push('the board ' + scanned.board);
    }
    // A record that names no location is the same as no record, and is named
    // only where the leg went unscanned, so the seat that owns it knows what to
    // add.
    if (scanned.board === 'not run') {
        for (const name of scanned.boardKeyless || []) {
            parts.push('the operator-tier record ' + sanitize(name) + ' carries no board: key');
        }
    }
    return parts.join(', ');
}

function cmdAudit(rest) {
    let raw = null;
    if (rest.length === 2 && rest[0] === '--dir') {
        raw = rest[1];
    } else if (rest.length !== 0) {
        process.stderr.write('usage: kit-registry-stamp.js audit [--dir <coordinator directory>]'
            + ' (one flag, with one value)\n');
        process.exitCode = 2;
        return;
    }
    const scope = resolveScope(raw);
    if (scope.dir === null) {
        process.stderr.write('kit-registry-stamp: ' + sanitize(scope.reason) + '; nothing scanned\n');
        process.exitCode = 2;
        return;
    }
    const there = presence(scope.dir);
    if (there !== 'present') {
        process.stderr.write('kit-registry-stamp: the coordinator directory to scan is ' + there
            + ', so nothing was scanned and no reading of it is available\n');
        process.exitCode = 2;
        return;
    }
    let isDir = false;
    try { isDir = fs.statSync(scope.dir).isDirectory(); } catch { isDir = false; }
    if (!isDir) {
        process.stderr.write('kit-registry-stamp: the path to scan is not a directory,'
            + ' so nothing was scanned\n');
        process.exitCode = 2;
        return;
    }

    const { findings, scanned } = auditDir(scope.dir, Date.now());
    process.stdout.write('scanned ' + scannedPhrase(scanned) + '\n');
    if (findings.length === 0) {
        process.stdout.write('no stamp findings in what was scanned\n');
        process.exitCode = 0;
        return;
    }
    process.stdout.write('stamp findings:\n');
    for (const { subject, finding } of findings.slice(0, FINDING_PRINT_CAP)) {
        process.stdout.write(findingLine(subject, finding) + '\n');
    }
    if (findings.length > FINDING_PRINT_CAP) {
        process.stdout.write('and ' + (findings.length - FINDING_PRINT_CAP)
            + ' further findings, not printed\n');
    }
    // The round-second reading is about the population rather than about any
    // one seat, so the report says so where it has produced one: a single such
    // finding among honest stamps is the coincidence the reading prices in.
    if (findings.some((f) => f.finding.kind === 'round-second')) {
        process.stdout.write('a whole-second stamp is a population reading, not a verdict on one entry:'
            + ' an honest clock read lands on one about once in a thousand\n');
    }
    process.exitCode = 1;
}

// The exit code of a run that stops before its verb reports: the audit has
// then scanned nothing, so it takes its refusal code, and the other verbs keep
// their 1. Declared as a function so the library-load leg above, which runs
// before this line, can call it.
function failedRunCode() {
    return process.argv[2] === 'audit' ? 2 : 1;
}

function main() {
    const [cmd] = process.argv.slice(2);
    if (cmd === 'push') cmdPush(process.argv.slice(3));
    else if (cmd === 'now') cmdNow(process.argv.slice(3));
    else if (cmd === 'audit') cmdAudit(process.argv.slice(3));
    else usage();
}

// Run as a CLI only when invoked directly, so a require() of this file answers
// with the exports and performs nothing: test/registry-stamp.test.js reads the
// audit predicates that way.
if (require.main === module) {
    try {
        main();
    } catch (err) {
        // An unguarded throw prints a stack trace, and a stack trace carries
        // absolute paths, which is the account name this module elides from
        // every line it composes deliberately. The catch keeps the one channel
        // that bypasses those lines held to the same guard. It writes to the
        // descriptor for the reason the load-failure leg above does: a write to
        // a pipe is asynchronous on win32 and the exit below does not wait for
        // one, so this line is what an exit here would drop. And it is guarded
        // for that same reason: a descriptor that refuses the write (a reader
        // that closed the pipe, EPIPE) would otherwise throw out of the catch
        // that exists to keep a stack trace off this channel, printing the one
        // thing it was written to prevent.
        try {
            fs.writeSync(2, 'kit-registry-stamp: '
                + sanitize(err && err.message ? err.message : 'the run failed')
                + '; nothing written\n');
        } catch {
            // The channel is gone; the exit code below is what is left to say it.
        }
        process.exit(failedRunCode());
    }
}

module.exports = {
    SESSION_TIME_FIELDS, ENTRY_TIME_FIELDS,
    HEARTBEAT_LEAD_MS, FUTURE_SKEW_MS,
    field, stampMs,
    roundSecondStamps, stampsLeadingHeartbeat, futureStamps, futureStampsInProse,
    auditEntry, auditDir,
    coordinatorRoot, coordinatorDir, machineDirScope, resolveScope, stampRegistryStatus,
    FINDING_PRINT_CAP
};
