// Shared plan-doc readers and session helpers for the kit's hooks and scripts.
//
// What lives here is what several surfaces of the kit take from one place, so
// no two of them can come to answer one question two ways: the plan-path
// normalizer and the plan-doc kind rule every reader of a plan path answers
// to, the Status-row readings of a plan doc's head, the session-id shape
// test, the transcript-age phrase, the stored-path
// clamp, the stat errno classification, and the authorization-sentence screen.
//
// This file requires Node core modules alone, and no kit library. That is what lets kit-read-lib.js
// and kit-compact-lib.js each destructure it at their own load:
// a require back from here into either of them would be a cycle, and a cycle
// resolved at load time hands one of its members a half-built exports object.
//
// Node core modules only, CommonJS, zero third-party dependencies. Every
// exported function that touches the filesystem degrades a failure to a null,
// false or default result rather than throwing.

'use strict';

const fs = require('fs');
const path = require('path');

// The cap on a stored transcript path. Long enough for a real harness
// transcript path, short enough that no caller can pad the state file.
const TRANSCRIPT_MAX = 512;

// The clamp every stored path field routes through: a non-empty string within
// the caller's cap, free of control characters, and not network-shaped (two
// leading separators: a UNC path, a //server form, or the \\?\ device
// namespace, whose root spells the same way). The channel is a path arriving
// from data rather than from the session: a transcript's own recorded working
// directory, a plan path read out of a file, and the worktree list git's own
// administrative data supplies, so these rules belong to
// the channel rather than to whichever producer first needed them. Every such
// path routes through this one spelling, so a hardening applied here reaches
// them all at once where a hand copy would drift.
//
// requireAbsolute is the one leg not every caller takes. Where it is on, the
// value must name a place independent of the reader. On win32 that means a
// drive-qualified root (letter, colon, separator), because path.isAbsolute
// also admits a drive-relative rooted form (a single leading separator),
// which resolves against whichever drive the reading process happens to be
// on, the very ambiguity the leg exists to exclude; the network-shape leg
// above already refuses the UNC and device roots that are also absolute. Off
// win32, path.isAbsolute is the whole question.
function storablePathValue(value, cap, requireAbsolute) {
    if (typeof value !== 'string' || value === '' || value.length > cap) return false;
    if (/[\x00-\x1F]/.test(value) || /^[\\/]{2}/.test(value)) return false;
    if (!requireAbsolute) return true;
    return process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) : path.isAbsolute(value);
}

// Whether a value is a storable transcript path: storablePathValue at the
// transcript cap, absoluteness not required. The path is machine-local and
// is only ever fs.stat'ed, never executed, and
// never surfaced raw. The control-character leg is a sanitize-before-store
// guard (a newline would smuggle text into a file the hooks surface into the
// model's context). The network-path leg narrows the hang surface of the
// stat, which runs synchronously at every SessionStart and blocks for the SMB
// timeout on an unreachable share: it rejects the doubled-separator forms,
// and only those. A path on a mapped network drive letter is
// indistinguishable from a local disk without a syscall, so it passes this
// check and can still hang the stat; that residual takes a hand-edited state
// file to reach, since the harness produces transcript paths under the local
// user profile.
function validTranscript(value) {
    return storablePathValue(value, TRANSCRIPT_MAX, false);
}

// The shape a harness session id has: a lowercase-or-uppercase UUID. It is
// only a shape: it cannot authenticate an id, since any 36-character UUID
// passes it. The evidence that an id belongs to a real local session is a
// transcript file on this machine that the id names; this test is the cheap
// screen in front of a lookup of that file, so a junk id never pays for a
// directory scan.
//
// A value passing this gate is 36 printable ASCII characters, so it satisfies
// every session-id storage rule in the kit (a string, within a 128-character
// cap, no control characters) by construction, and carries no path separator.
const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whether a value has the shape of a harness session id. Exported so a caller
// can test the shape before doing any filesystem work on the value, without a
// second copy of the grammar: one definition decides what the transcript
// lookup here and memq's own session scan answer to.
function isSessionIdShaped(value) {
    return typeof value === 'string' && SESSION_ID_SHAPE.test(value);
}

// What an errno from a stat of a path settles, for every caller that has to turn
// a failed stat into a verdict or a wording:
//
//   'absent'       ENOENT: nothing is at the path
//   'determinate'  ENOTDIR (a regular file standing where a parent directory
//                  belongs), ELOOP (a link cycle above the final component) and
//                  ENAMETOOLONG (a path no filesystem call accepts, and
//                  normalizePlanArg imposes no length bound of its own). No lock
//                  produces any of these and waiting resolves none of them
//   'transient'    every other code, EACCES, EPERM and EBUSY above all: a
//                  permission, a lock, a scanner or an indexer holding the path.
//                  The answer is unknown rather than settled, and it may lift on
//                  its own
//
// One classification, and the callers are wherever that question is asked: in
// this library a link is resolved or refused (resolvePlanLink), and in
// kit-compact-lib.js a file is removed or left alone (clearMarkerFile). The rule is what is shared rather than the list: spelled per
// site instead, two callers of one rule routed ENOTDIR to opposite answers.
function pathErrnoClass(code) {
    if (code === 'ENOENT') return 'absent';
    if (code === 'ENOTDIR' || code === 'ELOOP' || code === 'ENAMETOOLONG') return 'determinate';
    return 'transient';
}

// The size of the plan doc at a repo-relative plan path: 0 when nothing is
// there, and null when nothing at that path can be read as a plan doc. This is
// the one kind rule every reader of a plan path takes.
//
// A regular file answers its size and an absent path 0. Beyond a regular file
// there is one non-regular kind that is genuinely readable: a link
// whose target resolves, still inside the repo, to a regular file is a plan doc.
// Refusing it would leave a checkout that links a plan doc with no reader able
// to open it, over a file the operator can open by hand.
//
// The link is resolved with realpathSync and the result held to
// normalizePlanArg's own containment rule, so a link out of the repo is refused
// exactly as a plan argument naming that path would be. The repo root is
// resolved too, so a checkout reached through a link of its own is not judged
// foreign to itself. The resolved path is then stat'ed rather than lstat'ed, so
// a chain ending anywhere but a regular file is refused. A dangling link, a link
// cycle, and a resolution that fails for any other reason all keep the refusal.
//
// A directory, a junction, a FIFO or a device at the plan path stays refused
// too: none can ever be opened as a plan doc, and a FIFO would block the open
// on a hook path where blocking is not recoverable.
//
// The size is returned rather than judged here because a caller may hold a
// bound of its own: planHeadText reads a fixed 2 KB head and needs none.
//
// The lstat is spelled here because this function needs a distinction a
// single null answer would erase: a kind that is not a regular file and an
// lstat that failed. Only the first of those may be resolved through, since a failed
// lstat has told us nothing about the path and following it would hand back
// the very open the check exists to withhold.
function planFileSize(cwd, planRel) {
    const full = path.join(cwd, planRel);
    let st;
    try {
        st = fs.lstatSync(full);
    } catch (err) {
        return (err && err.code === 'ENOENT') ? 0 : null;
    }
    if (st.isFile()) return st.size;
    return resolvePlanLink(cwd, full).size;
}

// The link-resolution half of planFileSize's rule, spelled once so the two
// questions asked of it cannot answer differently: the size when the link
// resolves, inside the repo, to a regular file, and otherwise how the refusal
// was reached. planFileSize takes the size and discards the rest; a caller
// reporting the path's state to an operator needs the rest, because a refusal
// that never clears and one that may clear on its own look identical from a
// bare null.
//
// A dangling link raises ENOENT from realpathSync, which pathErrnoClass calls
// 'absent'. That is the wrong word here and is mapped to a determinate refusal
// instead: something IS at the plan path, it simply cannot be opened as a plan
// doc, and it will not start being openable without a hand fixing it.
function resolvePlanLink(cwd, full) {
    try {
        const real = fs.realpathSync(full);
        if (normalizePlanArg(fs.realpathSync(cwd), real) === null) return { size: null, cls: 'determinate' };
        const st = fs.statSync(real);
        return st.isFile() ? { size: st.size, cls: null } : { size: null, cls: 'determinate' };
    } catch (err) {
        const cls = pathErrnoClass(err && err.code);
        return { size: null, cls: cls === 'transient' ? 'transient' : 'determinate' };
    }
}

// Both readings of a plan doc's Status row, from one head read:
//
//   { exists, status, terminal }
//
// status is classifyPlanStatus's loose reading, the one the recovery surfaces
// act on, and terminal is planReadsTerminal's strict frozen-contract reading,
// the one a filesystem-only judgment acts on. The two answer different
// questions and are allowed to disagree ('Complete (archived)' is complete and
// not terminal), which is exactly why a surface rendering both must take them
// from one call over one set of bytes: read separately, a screen can print a
// verdict taken under one rule beside a token classified under the other, with
// no way for its reader to tell which sentence used which. Never throws.
function planStatusReadings(cwd, planRel) {
    const head = planHeadText(cwd, planRel);
    if (!head.exists || head.text === null) {
        return { exists: head.exists, status: 'unknown', terminal: false };
    }
    return { exists: true, status: classifyPlanStatus(head.text), terminal: planReadsTerminal(head.text) };
}

// How much of a plan doc any header question here reads. A plan's header rows
// sit at the top by the machine contract the curating-docs skill freezes, so a
// fixed head answers every one of them, and the bound is what keeps a plan doc
// from ever being pulled into memory whole on a hook path that reads every
// plan in a directory at a session start or a turn end.
const PLAN_HEAD_MAX_BYTES = 2048;

// The head bytes of a plan doc at a repo-relative path, decoded and with a
// leading UTF-8 BOM stripped (PowerShell Set-Content writes one, and every
// header anchor below is line-start anchored, so an unstripped BOM would hide
// the first row). One read site for every question asked of a plan doc's Status
// row, so two readings of that row cannot disagree about which bytes they were
// asked of.
//
// { exists, text }, and the pair carries three outcomes rather than two, which
// is the distinction callers act on: exists false is a path that is not a
// readable plan doc at all (planFileSize's kind rule, or an open that failed),
// while exists true with a null text is a plan doc whose read failed after the
// open, which says nothing about the plan and must not read as an answer about
// its header. Never throws.
function planHeadText(cwd, planRel) {
    const full = path.join(cwd, planRel);
    // The path must read as a plan doc before it is opened, judged by
    // planFileSize's kind rule, because the plan path is re-validated as a
    // path and never as a kind: a FIFO at a well-formed in-repo plan path
    // passes every other check and would block a POSIX open until a writer
    // appears.
    if (planFileSize(cwd, planRel) === null) {
        return { exists: false, text: null };
    }
    let fd;
    try {
        fd = fs.openSync(full, 'r');
    } catch {
        return { exists: false, text: null };
    }
    try {
        const buf = Buffer.alloc(PLAN_HEAD_MAX_BYTES);
        const bytes = fs.readSync(fd, buf, 0, PLAN_HEAD_MAX_BYTES, 0);
        let head = buf.toString('utf8', 0, bytes);
        if (head.charCodeAt(0) === 0xFEFF) head = head.slice(1);
        return { exists: true, text: head };
    } catch {
        return { exists: true, text: null };
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed or invalid */ }
    }
}

// The loose reading of a plan doc's Status header: 'complete', 'in progress',
// 'ready', or 'unknown'. Deliberately looser than the frozen machine contract
// planReadsTerminal below answers to, and the two are separate because they
// decide different things. This one decides what a recovery surface reports
// and whether the documentation check nags, where a header carrying trailing
// text after Complete ("Complete (archived)") is a plan whose author called it
// finished, and nagging a finished plan over the parenthetical is the more
// expensive error. planReadsTerminal decides whether a plan may be counted as
// finished on the filesystem's evidence alone, with no author in the loop, so
// it takes the strict contract.
//
// The consequence of the two rules meeting on one plan is worth naming, because
// it is a state an operator will see: a plan whose header reads
// 'Status: Complete (archived)' is finished to this reading and unfinished to
// the strict one.
function classifyPlanStatus(head) {
    // A non-string head has no header to classify, the same guard the strict
    // twin below takes. Every caller today reads through planHeadText and
    // checks for text first, so this is the shape of the contract rather than
    // a live path.
    if (typeof head !== 'string') return 'unknown';
    // Classify from the Status header only: anchored to a line start (m flag)
    // so body prose cannot match, and the value must sit on the same line as
    // the header ([^\S\r\n]* is horizontal whitespace only, never a newline),
    // so a bare "Status:" line above a line beginning "Complete" or "in
    // progress" does not misclassify the plan. A leading UTF-8 BOM (PowerShell
    // Set-Content writes one) is stripped by the reader so the anchor sees the
    // header. The Status header sits on its own line near the top by convention.
    //
    // Ready is the value of a plan that is authored and deliberately parked
    // before any run starts. It is a value of its own rather than an
    // unrecognized one so a reporting surface can list such a plan as parked
    // instead of not listing it at all, which is what hides finished, ready
    // work from every recovery surface. It ranks below the two started
    // readings: a doc carrying Ready alongside In Progress or Complete is one
    // somebody began, and reporting a run in flight as parked is the more
    // expensive error.
    //
    // Ready is the one leg that does not take its siblings' bare prefix match.
    // It must be the whole value, optionally followed by a parenthetical
    // ("Ready (parked pending the design round)"), because unlike Complete and
    // In Progress this word has ordinary English continuations that reverse
    // what it claims: "Ready for review", "Ready to merge" and "Ready to
    // archive" all name work somebody already did, and classifying them as
    // parked would have every reporting surface assert of them that the plan
    // is written and not started. Those fall through to 'unknown', the same
    // answer any other unrecognized value gets.
    const inProgress = /^status:[^\S\r\n]*in[^\S\r\n]*progress/im.test(head);
    const complete = /^status:[^\S\r\n]*complete/im.test(head) && !inProgress;
    const ready = /^status:[^\S\r\n]*ready[^\S\r\n]*(?:\([^)\r\n]*\)[^\S\r\n]*)?\r?$/im.test(head);
    if (complete) return 'complete';
    if (inProgress) return 'in progress';
    if (ready) return 'ready';
    return 'unknown';
}

// Whether a plan doc's head reads terminal under the machine contract the
// curating-docs skill freezes: the first Status row above the first '##'
// heading is the one read, and its value must be exactly Complete as a whole
// string, case-insensitively. 'Complete (archived)' does not terminate, in the
// contract's own words, because trailing text makes a different claim (where
// the doc has been filed) from the one being read here (that the work is
// finished).
//
// Three legs sit beyond the value compare, each closing a way this could
// answer yes on something that is not the header. Only the text above the
// first '##' heading is searched, so a Status row quoted inside a Chapter
// cannot answer for the document. The FIRST such row wins, so a later one
// cannot override the header. And the row must be terminated by a newline
// inside the head window, so a header pushed to the window's own bound never
// reads terminal on a value the window cut in half.
function planReadsTerminal(head) {
    if (typeof head !== 'string') return false;
    const heading = /^##/m.exec(head);
    const front = heading ? head.slice(0, heading.index) : head;
    const row = /^status:([^\r\n]*)\r?\n/im.exec(front);
    return row !== null && row[1].trim().toLowerCase() === 'complete';
}

// Normalize a plan argument (relative or absolute) to a repo-relative,
// forward-slash path. Returns null if the argument carries control characters
// or the resolved path escapes cwd.
function normalizePlanArg(cwd, planArg) {
    // Reject any control character up front: a plan path is surfaced back into
    // the model's context by the hooks that read one, so a path carrying
    // newlines or control bytes could smuggle instructions into a trusted
    // channel. Windows filenames cannot hold these; this closes the POSIX case
    // and matches the sibling hooks' sanitize-before-trust rule.
    if (typeof planArg !== 'string' || /[\x00-\x1F]/.test(planArg)) {
        return null;
    }
    const abs = path.resolve(cwd, planArg);
    const rel = path.relative(cwd, abs);
    // Reject a path that resolves to cwd itself, escapes it via a real `..` path
    // segment (not merely a name beginning with two dots, e.g. `..notes.md`), or
    // lands on another drive (path.relative yields an absolute path when no
    // relative route exists).
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        return null;
    }
    return rel.split(path.sep).join('/');
}

// The room an authorization sentence gets, which is deliberately wider than
// the 120-character cap the kit's error lines take. That cap is sized for a
// path named inside an error line, where 120 characters is generous; an
// authorization sentence is prose written to be read, and the sentences plans
// actually carry run past 120 (the first plan to carry one records 268
// characters, quoting the operator's own words). A sentence cut mid-clause is
// worse than none, because it reads as whole: the value's entire job is to let
// a reader judge a claim about who authorized the work, and half a claim
// cannot be judged. 320 leaves headroom above the observed length without
// inviting a paragraph.
//
// Nothing else changes: the printable-ASCII rule is the same one, and this is
// still the stricter of the kit's two screens, since the status line's terminal
// sanitizer admits ordinary non-ASCII where a quoted sentence entering a
// model's context does not. The cap is what differs, because the two values
// differ.
const AUTHORIZATION_MAX_CHARS = 320;

// What a value cut by the cap ends in, so a reader sees the cut. A sentence
// stopped at the cap and stored bare reads as the whole claim, which is the
// failure the cap's own derivation names one line up: a claim that is judged
// whole and is not is worse than none at all.
//
// The mark is written INSIDE the cap, replacing the last of the content rather
// than being added past it, so a marked value measures exactly
// AUTHORIZATION_MAX_CHARS. That is what keeps the screen idempotent, which it
// has to be: a reader re-applying it to a stored value it already screened
// must get that value back, and a mark the second screen cut off would turn a
// marked truncation back into a silent one.
const AUTHORIZATION_TRUNCATION_MARK = ' ...[truncated]';

function safeForAuthorization(value) {
    const printable = String(value).replace(/[^\x20-\x7E]/g, '');
    if (printable.length <= AUTHORIZATION_MAX_CHARS) return printable;
    return printable.slice(0, AUTHORIZATION_MAX_CHARS - AUTHORIZATION_TRUNCATION_MARK.length)
        + AUTHORIZATION_TRUNCATION_MARK;
}

// How long ago a transcript file was last written, as a coarse phrase
// ('less than a minute ago', 'about N minutes ago', 'about N hours ago'), or
// null when the path is absent, invalid per validTranscript, or unreadable.
// SessionStart's shared-checkout advisory renders it for the newest other
// session of the checkout. Only a number and a unit ever leave this function:
// the transcript path is machine-local (it typically embeds an OS username)
// and is never surfaced. Math.floor and the 60-minute crossover make the
// phrase err toward reading recent, so a session that may still be live is
// never reported older than it is.
function lastActivePhrase(transcriptPath) {
    if (!validTranscript(transcriptPath)) return null;
    let mtimeMs;
    try {
        mtimeMs = fs.statSync(transcriptPath).mtimeMs;
    } catch {
        return null;
    }
    if (!Number.isFinite(mtimeMs)) return null;
    const minutes = Math.max(0, Math.floor((Date.now() - mtimeMs) / 60000));
    if (minutes < 1) return 'less than a minute ago';
    if (minutes < 60) return 'about ' + minutes + ' minute' + (minutes === 1 ? '' : 's') + ' ago';
    const hours = Math.floor(minutes / 60);
    return 'about ' + hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
}

// classifyPlanStatus and planStatusReadings are exported for a single-rule
// reason. Two surfaces ask the loose Status question and neither spells it.
// The SessionStart hook's plan inventory asks it of docs/plans/ entries, and
// the plan judge asks both questions of one plan and must show which reading
// each of its lines used. A value the classifier learns reaches both at once,
// which is the whole point of naming them here: a surface spelling its own
// regex is the drift this export exists to prevent. The personas plugin's
// documentation check asks the same question at every turn end from inside
// the persona engine, which cannot import this file, so it carries a copy in
// plugins/personas/hooks/follow-ups.ts, and a change here is made there too.
// The path screen is exported for the same single-source reason: a path
// screen is a property of the boundary a value crosses rather than of the
// caller that first needed it. A path arriving from data, such as the
// transcript path a hook payload names, is the untrusted-path channel
// storablePathValue guards. A hand copy in a caller would match this file's
// screen the day it was written and drift from it silently after.
module.exports = { normalizePlanArg, pathErrnoClass, resolvePlanLink, planHeadText, planStatusReadings, classifyPlanStatus, isSessionIdShaped, lastActivePhrase, storablePathValue, safeForAuthorization };
