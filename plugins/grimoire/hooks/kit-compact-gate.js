#!/usr/bin/env node
// PreCompact hook (auto matcher): the interactive compaction deferral.
//
// The autoCompactWindow that makes an early compaction trigger possible is
// machine-global, so a hands-on session with no automation driving it inherits
// the same early trigger and would be compacted mid-discussion, at the point of
// maximum lost state. The only native lever is this hook's power to veto a
// pending compaction (a denied auto attempt is re-tried once per assistant
// turn, indefinitely), so the kit uses the veto as a scheduler: when no native
// automation instrument (/goal or /loop) shows in the transcript, the gate
// holds auto-compaction back until the safety ceiling, or until the session
// declares a boundary of its own, so an interactive session keeps its context
// roughly three times longer and lands its compaction at a point it chose. The
// kit summarizes nothing itself; re-grounding after the compaction is the
// existing SessionStart plan-doc recovery.
//
// The verdict mechanics are exit-code only, a harness fact pinned to a
// version because it can change upstream: on Claude Code 2.1.233 the harness
// honors an exit-code-2 deny (observed live against the real harness: 19
// consecutive auto-compaction attempts denied by this gate, no compaction
// landing, and a release then landing one with the session id preserved
// across it), while the JSON {"decision":"deny"} form is inert for PreCompact
// on that version (the compaction proceeds as if allowed, with no error
// anywhere), so nothing here is built on it. Every allow is a plain exit 0,
// and the allow path emits nothing at all: everything this hook reads (the
// payload, the markers, the transcript) is untrusted data, and the cheapest
// way to keep it out of a model's context is to print none of it. The deny
// path writes one fixed string to stderr, carrying no data from any input (the
// one composed value is this hook's own install directory, see
// CHECKPOINT_CLI).
//
// Every verdict is recorded, after the fact and never affecting it: a state
// file and an append-only log under the project's .kit/, both owned by
// kit-compact-lib.js (recordGateDecision). Without them a deferral leaves no
// trace at all, so a session held for an hour and a valve fire are
// indistinguishable afterwards, and "this keeps happening" cannot be measured.
// The write is the last thing the entry point below does, in its own try and
// returning nothing, so no failure in it can change a verdict or an exit code;
// what keeps it from DELAYING one is that every path it touches is refused
// unless it is a regular file (a blocking read or write is the only way a
// diagnostic could wedge a run, and the entry point below says where that
// guard sits).
//
// The gate is a classifier evaluated per offer, cheapest check first. It
// denies only when ALL of these hold:
//   1. The payload's trigger is 'auto'. The hooks.json matcher already scopes
//      this; the in-code check makes a later matcher edit unable to silently
//      widen the gate. Manual /compact is never gated.
//   2. KIT_EXTERNAL_ENGINE is not '1'. An external engine spawns a fresh
//      worker per section, so there is no mid-work context to protect: stand
//      down (same marker as branch-reaper-nudge.js and hook-canary.js).
//   3. No native automation instrument is driving the session. The transcript
//      at the payload's transcript_path tells a human interacting directly from
//      a session driven by /goal or /loop (transcriptShowsAutomation in
//      kit-compact-lib.js, which owns the evidence shapes and their
//      exclusions). Automation in effect: allow, the native early trigger
//      governs.
//   4. The consumed-token reading from the transcript is legible AND strictly
//      below SAFETY_CEILING_TOKENS. This is the safety valve: a denied auto
//      attempt retries forever, so sustained denial would otherwise climb to
//      the model's hard limit and kill the session with "Prompt is too long".
//      At or above the ceiling the gate allows. The PreCompact payload carries
//      no usage field, so the reading comes from the transcript: the newest
//      main-thread assistant usage row, summed as input_tokens +
//      cache_creation_input_tokens + cache_read_input_tokens (monotonic across
//      a session, so a rising-signal ceiling check is sound). An illegible
//      reading allows rather than denying blind.
//   5. No live role-boundary marker names the offering session. The marker
//      (compact-role-boundary.<session>.json under the machine-local root
//      ~/.kit/role-boundary, one file per session so no seat can rename over a
//      peer's declaration, keyed by session rather than by any project
//      directory so a writer standing in a linked worktree and this reader
//      agree on one file, resolved by roleBoundaryPath in kit-compact-lib.js
//      for writer and reader alike) lands the compaction at the boundary the
//      session declared. Its ordinary writer is the seat-stop.js Stop hook,
//      which opens it at a turn end off the registered seat's own status push
//      over a clean tree; the kit-compact-checkpoint.js boundary subcommand
//      writes the same marker by hand, for a seat the registry does not carry
//      and for a registered one whose project tree holds work it does not own,
//      and stamps that marker as a declaration. A declared marker carries a
//      second condition besides the shared match rule, because it names a
//      moment rather than a window: it is honored only while no new turn has
//      begun in the session it names since it was written, read from that
//      session's transcript by markerMomentHolds in kit-compact-lib.js, which
//      owns the provenance scoping, the inbound shapes and the reading of every
//      unanswerable question as lapsed. The hook's turn-end marker declares no
//      moment and is governed by its age bound alone, so this leg opens no
//      transcript for one.
//   6. No live operator-consent marker names the offering session. The consent
//      marker (compact-consent.json in the project's scratch directory, which
//      kitScratchDir in kit-compact-lib.js resolves, written by
//      kit-compact-checkpoint.js consent, only on the operator's explicit word)
//      releases one deferred compaction for the session it names on the
//      operator's word.
// Both markers are read only where the deny would otherwise fire, so every
// allow above keeps its meaning; the match (session, unconsumed, age-bounded)
// is the shared markerMatches rule in kit-compact-lib.js, and the allow either
// causes consumes its marker, single-shot, best-effort (a failed delete
// degrades to one extra release inside the marker's own age bound, never to a
// wedged run), and journals its own reason (role-boundary, operator-consent).
// A marker naming another session, a consumed one, and a stale one release
// nothing and are left in place under a deny, so a marker-less session takes
// exactly the path it always did. A marker does not outlive its moment by
// another route either: every allow is a compaction landing for the payload's
// session, and the entry wrapper's landing sweep retires that session's
// markers whatever the reason, so a release that missed its offer cannot
// convert a later mid-work deny.
//
// A detection miss in either direction is safe-cheap: a missed instrument
// defers a session that would rather compact early (it still compacts at the
// ceiling), and an unreadable transcript yields no valve reading either, so
// the verdict on it is allow, the early-trigger status quo.
//
// Any other state, any read error, any ambiguity: allow. A forgotten boundary
// degrades to "compaction lands at the ceiling"; an unreadable transcript, an
// unparseable payload, or a filesystem error must never wedge a session
// against the context limit. A bug anywhere allows, so the hook never
// converts a scheduling nicety into a dead run.

'use strict';

const fs = require('fs');
const {
    sameSessionId, transcriptShowsAutomation, recordGateDecision,
    markerMatches, markerMomentHolds,
    readRoleBoundary, readConsent, clearRoleBoundary, clearConsent,
    ROLE_BOUNDARY_MAX_AGE_MS, CONSENT_MAX_AGE_MS
} = require('./kit-compact-lib.js');

// The deferral ceiling, in consumed tokens: the interactive deferral's bound.
//
// ASSUMPTION, named because it is the one direction of this design that is
// not fail-open: this is an absolute token count sized for the roughly
// 1,000,000-token window current models carry. The PreCompact payload
// provides no model field (only SessionStart does), so the window cannot be
// derived at fire time. On a model with a SMALLER window the ceiling sits
// above the hard limit, the valve never fires, and sustained denial kills
// the session outright. The gate applies this ceiling to every hands-on
// session on the machine, on whatever model it happens to run, so that blast
// radius is machine-wide. Two facts bound it: the gate can only deny an offer
// the harness already made, so a model whose window sits below the compaction
// trigger never reaches this path at all; and the hazard therefore needs a
// model whose hard limit falls between the trigger and this ceiling. One
// shared ceiling is the decided design (per-mode ceilings are out of scope).
// Nothing detects the small-window state; the doctor's window check reads
// the configured autoCompactWindow, which says nothing about the running
// model's real window.
//
// Arithmetic. The ceiling has two jobs and the tighter one sets the value.
// Its hard job is preventing a dead run: a denied attempt is re-offered every
// turn and never forced, so without a valve the context climbs to the model's
// limit and the session dies with "Prompt is too long", which was observed
// live. Its softer job is landing the compaction before a run gets bad, and
// quality is observed degrading through the 700,000 to 800,000 band. Sitting
// at the bottom of that band satisfies both with roughly 200,000 tokens of
// headroom under the limit, which absorbs the two mechanics that compound
// against the margin: the reading is one turn STALE (the newest usage row
// reflects the previous turn's request), and a denied attempt is re-evaluated
// only once per turn, so the true margin from a deny decision to the limit is
// two turns of growth rather than one.
const SAFETY_CEILING_TOKENS = 800000;

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Read the transcript's tail with a size cap. The valve only needs the newest
// usage row, which sits within a few lines of the file's end, so this takes
// the tail alone where the automation scan reads the head too. Returns '' on
// any error or a non-regular file (a blocking read on a FIFO would hang,
// which no try/catch can rescue).
function readTranscriptTail(transcriptPath) {
    try {
        const st = fs.statSync(transcriptPath);
        if (!st.isFile()) return '';
        const CAP = 1024 * 1024;
        if (st.size <= CAP) {
            return fs.readFileSync(transcriptPath, 'utf8');
        }
        const fd = fs.openSync(transcriptPath, 'r');
        try {
            const buf = Buffer.alloc(CAP);
            const bytes = fs.readSync(fd, buf, 0, CAP, st.size - CAP);
            return buf.toString('utf8', 0, bytes);
        } finally {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    } catch {
        return '';
    }
}

// Sum one usage-shaped object into a consumed-token figure, or null when it is
// not a legible reading. Consumed = input_tokens + cache_creation_input_tokens
// + cache_read_input_tokens; an absent field counts as zero (a turn with no
// cache activity omits nothing load-bearing), but a present field that is not
// a finite non-negative number makes the whole reading illegible, and an object
// carrying none of the three fields is no reading at all. Illegible returns
// null, which the caller turns into an allow: guessing low here would keep the
// gate denying a session that may already be at the limit.
function sumUsageFields(usage) {
    const fields = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
    let total = 0;
    let sawAny = false;
    for (const f of fields) {
        const v = usage[f];
        if (v === undefined || v === null) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
        total += v;
        sawAny = true;
    }
    return sawAny ? total : null;
}

// The current context size a usage object describes.
//
// A message whose assistant turn took several internal iterations carries a
// usage.iterations array, and the object's TOP-LEVEL cache fields are summed
// across those iterations rather than describing the final request. Observed
// in the wild: a row whose top-level fields sum to 710,223 is three iterations
// of roughly 355,000 each, its top-level cache_read of 708,291 being exactly
// the iterations' 353,812 + 0 + 354,479. Reading the top level there overstates
// the real context by about a factor of two.
//
// So a single iteration is the reading when the array is present and non-empty,
// and the top-level fields are the reading otherwise, which is every
// single-iteration turn. Note the top level is not uniformly a sum
// (input_tokens is not aggregated the way the cache fields are), which is why
// this picks an iteration outright rather than trying to divide the aggregate.
//
// Which iteration: the LARGEST, not the last. The last entry is the final
// request and on every row observed so far it is also the largest, the
// iterations of a turn running within a percent of each other. But that is one
// session's evidence for a rule that has to hold on shapes nobody has seen, and
// the two candidates fail in opposite directions. If a turn ever ends on a
// small internal call, reading the last entry understates the context, the gate
// keeps denying a session that may be at its limit, and the run dies: the one
// outcome this whole design exists to prevent. Reading the largest can only
// overstate by comparison, which trips the valve early and costs a mistimed
// compaction, the pre-gate status quo. Identical on the observed shape, safe on
// the ones that are not.
//
// An unreadable entry makes the whole reading illegible rather than being
// skipped, so a malformed array cannot silently narrow the set being maximized.
// Illegible allows, per sumUsageFields.
//
// The error this corrects was fail-open (overstating consumption makes the
// valve allow earlier, never deny longer), but it tripped the valve at roughly
// half the intended ceiling on the affected rows, which is the same inertness
// the ceiling exists to avoid.
function consumedFromUsage(usage) {
    const iterations = usage.iterations;
    if (Array.isArray(iterations) && iterations.length > 0) {
        let largest = null;
        for (const entry of iterations) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
            const sum = sumUsageFields(entry);
            if (sum === null) return null;
            if (largest === null || sum > largest) largest = sum;
        }
        return largest;
    }
    return sumUsageFields(usage);
}

// The newest main-thread consumed-token reading from the transcript, or null
// when none can be obtained. Scans the tail newest-first for an assistant
// entry carrying a usage object at message.usage; sidechain (sub-agent) rows
// are skipped because their usage measures the sub-agent's own context, not
// this session's. The tail's first line may be a partial entry (cut by the
// cap, or caught mid-append): an unparseable line is simply skipped. The
// NEWEST usage-bearing row decides alone: when it is illegible this returns
// null (allow) rather than falling back to an older row, because the signal
// is monotonic and an older reading can only understate, which is the
// dangerous direction (a deny near the hard limit).
function latestConsumedTokens(transcriptPath) {
    try {
        if (!transcriptPath) return null;
        const text = readTranscriptTail(transcriptPath);
        if (!text) return null;
        const lines = text.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const t = lines[i].trim();
            if (!t) continue;
            let entry;
            try { entry = JSON.parse(t); } catch { continue; }
            if (!entry || entry.type !== 'assistant' || entry.isSidechain) continue;
            const usage = entry.message && entry.message.usage;
            if (!usage || typeof usage !== 'object') continue;
            return consumedFromUsage(usage);
        }
        return null;
    } catch {
        return null;
    }
}

// Decide the verdict, as a decision object: `verdict` is 'allow' or
// 'deny-interactive' (a hands-on session held below the ceiling), `reason`
// names the clause that decided, and `cwd`, `session` and `consumed` carry
// what that clause read. The clauses run cheapest first (see the header for
// why each exists).
//
// The reason and the readings exist for the decision record alone: nothing here
// branches on them, and the entry-point wrapper reads `verdict` and nothing
// else to pick the exit code. Never throws on its own account; that wrapper
// turns any escape, and any return value it does not recognize, into an allow.
function main() {
    let payload;
    try { payload = JSON.parse(readStdin() || '{}'); } catch { return { verdict: 'allow' }; }
    if (!payload || typeof payload !== 'object') return { verdict: 'allow' };

    const cwd = payload.cwd || process.cwd();
    const transcriptPath = payload.transcript_path || payload.transcriptPath;
    const sessionId = payload.session_id || payload.sessionId;
    // The project the decision is RECORDED against is the payload's cwd alone,
    // never the fallback the clauses read from. A payload that does not parse,
    // or that omits its cwd, names no project: recording under process.cwd()
    // would scatter records into whatever directory the harness happened to
    // spawn this hook from. A decision carrying no cwd is simply not recorded,
    // and the clauses below still read the fallback, so no verdict changes.
    const recordCwd = (typeof payload.cwd === 'string' && payload.cwd !== '') ? payload.cwd : null;
    // Every decision below carries the project and the session it was taken
    // for, which is what the record is keyed on; the clause supplies the rest.
    function decide(clause) {
        return {
            reason: null, consumed: null,
            cwd: recordCwd, session: sessionId,
            ...clause
        };
    }

    // Clause 1: only the auto trigger is ever gated.
    if (payload.trigger !== 'auto') return decide({ verdict: 'allow', reason: 'not-auto' });

    // Clause 2: external-engine workers are fresh per section; stand down.
    if (process.env.KIT_EXTERNAL_ENGINE === '1') return decide({ verdict: 'allow', reason: 'external-engine' });

    // Clause 3: the transcript decides whether a native automation instrument
    // is driving the session. Automation in effect: allow, the native early
    // trigger governs. Neither instrument in effect: a hands-on session,
    // deferred to the ceiling, under the illegible-reading allow.
    if (transcriptShowsAutomation(transcriptPath)) return decide({ verdict: 'allow', reason: 'automation' });
    // Clause 4: the safety valve.
    const consumed = latestConsumedTokens(transcriptPath);
    if (consumed === null) return decide({ verdict: 'allow', reason: 'illegible' });
    if (consumed >= SAFETY_CEILING_TOKENS) return decide({ verdict: 'allow', reason: 'valve', consumed });
    // Clauses 5 and 6: the release markers, read only once every allow above
    // has declined so a marker-less session takes exactly the path it always
    // did (see the header). The session's own declared boundary is checked
    // first: a boundary that has been reached should land the compaction and
    // retire its marker, and an operator's consent then stays for the deferral
    // it was given for, until this session's own landing retires it (the
    // landing sweep in the entry wrapper). The consume here is best-effort; a
    // failed delete degrades to one extra release inside the marker's own age
    // bound, never to a wedged run.
    //
    // The typeof guard is the session-id shape check: sameSessionId compares
    // through a String() coercion, so a coercible non-string (an array of one
    // id) would otherwise match and spend a marker. A payload whose session id
    // is not a non-empty string reads neither marker and releases nothing.
    //
    // A role-boundary marker the boundary verb declared carries a second
    // condition the consent marker does not: it names a moment, so it is
    // honored only while no new turn has begun in the session it names since it
    // was written (markerMomentHolds, read against that session's own
    // transcript, which is the one this payload names). A marker that outlived
    // its moment is ignored and left in place, for the status verb to report as
    // lapsed and the age bound to clear; every unreadable answer counts as
    // lapsed, so this leg fails toward deferral like the rest. Which markers
    // the rule governs is markerMomentHolds's own to decide rather than a
    // condition spelled again here: it holds by return for a marker that
    // declared no moment, the seat-stop hook's turn-end bank, and reads no
    // transcript for one.
    if (typeof sessionId === 'string' && sessionId !== '') {
        const now = Date.now();
        const boundary = readRoleBoundary(sessionId);
        if (markerMatches(boundary, sessionId, now, ROLE_BOUNDARY_MAX_AGE_MS).ok
            && markerMomentHolds(boundary, transcriptPath).ok) {
            clearRoleBoundary(sessionId);
            return decide({ verdict: 'allow', reason: 'role-boundary', consumed });
        }
        const consent = readConsent(cwd);
        if (markerMatches(consent, sessionId, now, CONSENT_MAX_AGE_MS).ok) {
            clearConsent(cwd);
            return decide({ verdict: 'allow', reason: 'operator-consent', consumed });
        }
    }
    // The deny: a hands-on session with no release standing, held to the
    // ceiling. The reason names that no boundary of its own or release from
    // the operator covered this offer.
    return decide({ verdict: 'deny-interactive', reason: 'no-goal', consumed });
}

// Run as the PreCompact hook only when invoked directly, so a require() of
// this file can never fire the gate as a side effect. Nothing in the kit
// requires it today: hook-canary's load check covers files wired in
// hooks.json via node --check, which is syntax-only and proves nothing about
// whether the lib requires above resolve; resolution is exercised by this
// hook's own test suite, which spawns the real file. The deny is exit code 2
// via process.exitCode rather than process.exit(), so the stderr note can
// drain before the process ends; the note carries no input data, the one
// composed value being this hook's own installed directory (see CHECKPOINT_CLI
// below), there so the operator watching reads a deferral, not a failure. That
// audience is a dependency on the harness version this kit runs on: PreCompact
// stderr is observed to reach the operator alone and never the model, which
// the harness does not guarantee and can change upstream. The note carries a
// runnable release command, so an erosion of that reading would put a command
// that ends a deferral in front of the model with nothing but the model's own
// judgment between the two; a harness release that changes where this channel
// lands is therefore a review trigger for what the note may say. Any
// exception, and any verdict value that is not the recognized deny, allows:
// fail-open on every axis.
// The gate ships as a plugin and runs in every project, so a repo-relative
// command path in the note below resolves only where the kit is dogfooded in
// its own checkout. The note names a command the operator is meant to run, so
// it is built from this hook's own location instead: __dirname is the module's
// path, never a payload, transcript, or repo value, so the injection posture is
// unchanged. Forward slashes because node accepts them on Windows and a
// backslash path pasted into a shell does not survive every shell. The doctor
// charset-gates the interpolants in its own pasteable command line; this one is
// exempt because the value is module state rather than input, and an actor who
// controls this file's path is already running this file's code.
const CHECKPOINT_CLI = __dirname.split('\\').join('/') + '/kit-compact-checkpoint.js';

const INTERACTIVE_NOTE = 'kit-compact-gate: auto-compaction deferred to the context safety ceiling; '
    + 'this is the kit holding compaction out of an interactive session, not an error. Keep working. '
    + 'To land it sooner, bank the session\'s state at a natural boundary and open the release with '
    + 'node "' + CHECKPOINT_CLI + '" boundary, from whatever directory the session works in; the next '
    + 'offer lands there.';

if (require.main === module) {
    let decision = null;
    try { decision = main(); } catch { /* any escape allows, per the fail-open posture */ }
    if (!decision || typeof decision !== 'object') decision = { verdict: 'allow' };

    if (decision.verdict === 'deny-interactive') {
        try {
            process.stderr.write(INTERACTIVE_NOTE + '\n');
        } catch { /* the note is best-effort; the exit code is the verdict */ }
        process.exitCode = 2;
    } else {
        process.exitCode = 0;
    }

    // The landing sweep: every allow is a compaction landing for the
    // payload's session, whatever clause allowed it, and a marker that missed
    // its moment must not outlive it. A boundary or consent marker left live
    // through a valve or illegible landing would stay honorable for up to its
    // age bound, and if the same session crossed the trigger again mid-work
    // inside that window, the leftover would convert the deny into an allow at
    // exactly the placement the gate exists to prevent. A manual /compact
    // leaves that same leftover and this sweep never reaches it: hooks.json
    // wires PreCompact on the auto matcher alone, so the gate does not run for
    // one at all and the not-auto clause above is defence against a rewiring
    // rather than a live path. There the age bound is the only retirement. So
    // an allow retires any marker naming the landing session; a peer's boundary
    // marker is a file this sweep never opens for it, and the session check
    // kept beside each read answers for the consent file, which is one per
    // project, and for whatever else may stand at a path this session's own id
    // resolved. A marker naming another session is not this landing's to
    // spend, and a deny retires nothing, because nothing landed. Scoping needs
    // both a project and a string session id: the boundary marker is keyed by
    // session alone under the machine-local root, while the consent file and
    // the record below trust the payload's cwd, and a coercible non-string id
    // scopes nothing. The whole pass runs after the exit code is set, inside
    // its own try, so it can change nothing but the marker files; one that
    // survives a failed pass is retired by its age bound or the next landing.
    if (decision.verdict === 'allow'
        && typeof decision.session === 'string' && decision.session !== ''
        && typeof decision.cwd === 'string' && decision.cwd !== '') {
        try {
            const boundary = readRoleBoundary(decision.session);
            if (boundary && sameSessionId(boundary.session, decision.session)) {
                clearRoleBoundary(decision.session);
            }
            const consent = readConsent(decision.cwd);
            if (consent && sameSessionId(consent.session, decision.session)) {
                clearConsent(decision.cwd);
            }
        } catch { /* best-effort on the same terms as the record below */ }
    }

    // The record comes last, once the note has been written and the exit code
    // set, so no failure of it can CHANGE either one; it runs inside its own
    // try for the same reason, and a decision naming no project (an unreadable
    // payload) is not recorded at all.
    //
    // Delaying is the part the ordering alone does not cover, for the note as
    // much as for the exit code. Setting process.exitCode emits nothing (the
    // harness reads the verdict only when this process exits), and the note is
    // queued rather than guaranteed written: Node's stdio is synchronous for
    // pipes on Windows and Linux but asynchronous for pipes on macOS and for
    // TTYs on Windows, so on those it drains at exit alongside the exit code.
    // What rules out a delay to either is that every path the record touches is
    // lstat-refused unless it is a regular file.
    if (typeof decision.cwd === 'string' && decision.cwd !== '') {
        try { recordGateDecision(decision.cwd, decision); } catch { /* diagnostic only */ }
    }
}
