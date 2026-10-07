#!/usr/bin/env node
// PostToolUse hook (Agent|TaskOutput|Bash|PowerShell matcher): the deferral nudge.
//
// The PreCompact gate defers an auto-compaction offer until the session
// declares a boundary, and it announces every deferral on stderr, which reaches
// the operator only and never the model. So a session that never declares one
// is held silently, offer after offer, until the gate's own safety valve fires
// near the context limit and lands the compaction at whatever the session
// happens to be doing. The deny happens at a turn boundary the model sees
// nothing of; the first thing it reads afterwards is a tool result. That is
// where this directive goes.
//
// The tools it rides are the ones whose results follow a wait: a dispatched
// agent, a task's output, a shell command.
//
// It is a detector plus a directive, deliberately not an auto-declare: a
// boundary is the seat's own word about whether everything it holds is on
// disk, and a hook that declared one at a tool return would admit a compaction
// before the seat had judged that. A reminder can misfire at the cost of a
// sentence; an auto-declare cannot.
//
// The output channel is one form and one form only: JSON on stdout at exit 0
// whose hookSpecificOutput object carries hookEventName 'PostToolUse' and
// additionalContext set to the reminder. A TOP-LEVEL additionalContext key is
// inert on this harness (the hooks documentation shows it, but the harness
// parses the payload and discards that field), so this hook never emits one:
// an inert "compatibility" copy would read as working while reaching nothing.
//
// The session this speaks to is held on the gate's interactive deny. Its only
// release is the role-boundary marker the checkpoint CLI's boundary verb
// writes, so it is told to judge whether everything it holds is durable and to
// declare it if so.
//
// The directive carries no value out of state at all: its prose is fixed, and
// the one figure that decides whether it speaks, the denied decision's
// consumed token reading, is compared against the floor and never rendered.
// No session id, no project path, nothing else read from disk: the state file
// is user-writable, and this text lands in the model's context, so it holds
// the same provenance bound the gate's stderr note holds. The one other
// composed value is the kit's own installed directory, module state rather
// than input. It is rendered as a runnable command through two guards, a path
// grammar and a home elision (see kit-compact-lib.js's checkpointCliClause);
// an installed kit sits under the home directory, so the elision is what keeps
// the OS account name out of a text the model reads, on the floor the
// checkpoint CLI holds its own output to. Why that directory is read from
// __dirname rather than from CLAUDE_PLUGIN_ROOT is stated at
// kit-compact-lib.js's CHECKPOINT_CLI.
//
// Guards 1 to 4 decide whether anything is said at all, and the hold path has
// its own three, numbered 5H to 7H in the section after this list. Every guard
// fails toward a silent exit 0:
//   1. The payload parses and tool_name is exactly Agent, TaskOutput, Bash, or
//      PowerShell. The hooks.json matcher already scopes this; the in-code
//      check makes a later matcher edit unable to silently widen the hook.
//   2. KIT_EXTERNAL_ENGINE is not '1'. An external engine's workers are fresh
//      per section, so there is no boundary to remind them of (same marker as
//      the sibling hooks).
//   3. The payload carries no TRUTHY agent-identity key: agent_id, or any of
//      the four agent-type spellings the sibling subagent detectors defend
//      (agent_type, agentType, subagent_type, subagentType, per
//      readonly-agent-guard.js and docs-write-guard.js, whose breadth is the
//      repo's evidence that the spelling varies across harness versions). Any
//      of them marks a subagent's tool call, and the directive belongs to the
//      main session, which is the only one that can declare its boundary.
//      Truthiness rather than key presence, matching those two detectors: a
//      harness version that put a null or empty agent_id on a main-session
//      payload would otherwise stand this hook down on every call and kill the
//      feature outright, with every hand-built test payload still passing.
//      This guard is load-bearing on its own rather than belt-and-braces: a
//      subagent's PostToolUse payload carries the PARENT session's own
//      session_id, so the hold record names it and guard 5H would pass for a
//      subagent's tool call and never stand one down. Every dispatched agent
//      runs Bash constantly, so this is the guard that keeps the nudge out of
//      dozens of contexts that cannot act on it. Its fail direction is noise
//      AND silence together, which is why nothing here is belt-and-braces: on a
//      harness that stops sending these keys, every dispatched agent's Bash
//      return both emits and stamps, and the stamp lands on the parent
//      session's hold while the delivery lands in the agent's own context. The
//      agents consume nearly every interval between them, and the main
//      session's own long returns arrive inside a window one of them just
//      silenced. So the feature would die in the one context that can act on
//      it. No read of the keys can repair that, since the premise is that they
//      are not sent, and this is stated rather than defended.
//   4. cwd is a usable string and does not name a network share (two leading
//      separators, the UNC and //server forms). The project the payload names
//      is the only project this hook reads, since a shell command's own
//      working directory is not this process's. Opening a path on an
//      unreachable share blocks for the SMB timeout, and a stalled tool loop is
//      the one failure this hook must never cause. What this check buys is that
//      one case, for every read that follows; each reader still answers for the
//      path it opens. The same screen runs a second time over the directory
//      kit-compact-lib's scratch resolver answers for that project, which for a
//      project directory under ~/.claude is home-anchored rather than a child of
//      cwd, so the state and stamp reads on both paths below inherit the guard
//      rather than the cwd screen alone standing for them.
//
// The hold path, taken by every session that passes guards 1 to 4. Three
// guards, each the same question asked of a different record:
//   5H. This session's own newest interactive deny is a hold that still stands:
//      it carries the hands-on reason (no boundary of its own and no operator
//      release covered the offer) and is dated inside the four-hour idle bound
//      and future-skew allowance the gate holds a standing hold to
//      (interactiveHoldOpen). The record is read from the gate state's
//      per-session hold list, so the directive is keyed on this session's own
//      hold: on the shared checkout this path exists for, several seats are
//      held at once and every gate process overwrites the single
//      newest-decision slot, so a hold read from there would be refused
//      whenever another seat decided last.
//   6H. The decision's consumed token reading is at or above the floor
//      (compactNudgeFloor in the machine-local signpost, default
//      NUDGE_FLOOR_DEFAULT). Deferral itself is free and the gate keeps doing it
//      at any count; what the floor buys is that the directive arrives only when
//      a compaction is close enough that declaring a boundary is worth a turn's
//      attention. A record whose consumed reading is absent or illegible is
//      below every floor, which is the right direction: the figure is the only
//      evidence this hook has that the hold is near the ceiling, and speaking
//      without it would be guessing.
//   7H. The interval since this session was last spoken to about a hold, read
//      from the stamps beside the gate state (holdNudgedAt) and applied by
//      intervalElapsed, illegible-fires included. It is a separate file for a
//      reason stated at recordHoldNudge: the state file's writers would erase a
//      stamp kept there within minutes.
// They are evaluated 5H, 7H, 6H, which is an evaluation order rather than a
// renumbering: 6H reads the machine-local signpost in the home directory while
// 7H reads a small file in the project this payload already named. What the
// order buys is bounded to one regime and worth stating exactly, because the
// dominant regime is the other one. Above the floor a fired directive leaves a
// stamp, so 7H answers no for the throttle interval and the home read is
// skipped for that half hour. Below the floor no stamp is ever written, so 7H
// answers yes on every covered tool return and both reads happen every time,
// throughout exactly the suppression window the floor exists to create. No
// ordering can change that half: 6H IS the home read, so establishing that a
// hold is below the floor requires it. No guard's answer depends on another's,
// so the order changes what is read and never what is decided.
// On all three the stamp lands first and the directive is emitted only when it
// landed, which is the rate limit: the stamp is the only cross-process carrier
// the interval has, so emitting without it would mean emitting with no rate
// limit at all, after every covered tool return for the life of the hold, into
// a context that is by definition already past the compaction trigger. Silence
// is exactly the pre-hook status quo and that unbounded repeat is worse than
// it, so a stamp that cannot land yields silence.
//
// One bound on the no-goal shape, stated rather than fixed. The whole hold path
// starts at a decision the gate recorded, and the gate records nothing in a
// project that carries no .kit/ directory (gateScratchTarget in
// kit-compact-lib.js refuses to create one). So in a project that has never
// carried a .kit/, no interactive deny is written down, 5H finds no hold, and
// this directive never fires there at all. The refusal is deliberate and is
// not removed for this: lifting it would have the kit create a .kit/ in every
// project a held session happens to stand in, which is the exact cost that
// refusal exists to prevent. What it leaves is that the directive serves a
// project that already carries a .kit/. That is every project a session has
// declared a boundary in or banked one from, since the boundary verb and the
// seat-stop hook each ensure the project's own scratch directory after their
// marker write (ensureProjectScratchDir in kit-compact-lib.js) exactly so the
// record this directive reads has somewhere to land; the marker itself lives
// under the home.
//
// There is deliberately no stand-down on the seat's own release marker, which is
// a decision rather than an omission. The record read at 5H IS the gate's answer
// to whether a release was honored, since the marker legs run before the deny,
// so a deny means no honorable marker stood at that decision. Reading the marker
// file here would add a failure mode rather than remove one: markerMatches
// answers on age and session alone, so a declaration whose moment has lapsed
// still matches for four hours, and a check on it would silence the directive
// for that whole window in exactly the case the seat needs to declare again.
// What that leaves is a repeat whose real ceiling is worth stating plainly,
// because it is wider than one sentence. 5H honors an interactive deny for the
// gate's four-hour idle bound and 7H spaces the directive by 30 minutes, so a
// hold that ENDS without the gate recording anything newer can draw the
// directive about eight times on a premise that is no longer true. Two things
// end a hold that way: a manual /compact, which the auto-only PreCompact
// matcher never sees, and a session that simply stops taking offers. In the
// live case the repeat is far tighter, since during a hold the harness re-offers
// every few tens of seconds, so a declaration is consumed almost immediately
// and the allow that consumes it drops this session's own hold record
// (nextGateState), which 5H then reads as no hold at all.
// There is no guard on the state's own lastAllow to shorten that, and its
// absence is a fact about the state rather than a gap: an allow already ends
// the allower's hold in the list 5H reads, and another session's allow says
// nothing about this session's hold, so a test on that field would decide
// nothing.
//
// What the stamp-first ordering buys is once per interval per TOOL BATCH, not
// per turn. Several covered tool calls returning together each run their own
// process, all read the stamp as it stood before any of them, and all emit;
// the ordering narrows the window to one read-modify-write but does not close
// it. The interval race between siblings in one batch is deliberately left
// open, since no lock is worth taking on a path that runs after every covered
// tool return. So a hold held across a hundred turns costs a handful of
// sentences rather than a hundred.
//
// Fail-open everywhere, matching the gate's posture: the hook never exits
// non-zero, never exits 2 (the tool already ran, and an error-framed reminder
// after every shell command is noise), and any internal error exits 0 silently.
// The kit library requires are deferred into the guard that uses them so a
// damaged or missing lib in an installed plugin cache degrades to the same
// silent exit 0 instead of a require-time crash on every tool call. A missed
// nudge degrades to the pre-hook status quo; a thrown hook would degrade the
// tool loop itself, which is strictly worse.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// The tools whose results follow a wait, which is where a model first reads
// anything after a deferral it never saw.
const COVERED_TOOLS = ['Agent', 'TaskOutput', 'Bash', 'PowerShell'];

// How long a fired nudge silences the next one while the same hold stands.
// The hold this speaks about is measured in turns and can span hours, and the
// directive is the same sentence every time, so a per-turn repeat would be
// noise the model learns to skip; half an hour is long enough that a session
// that ignored the first has had a real chance to reach a clean point.
const NUDGE_INTERVAL_MS = 30 * 60 * 1000;

// The context reading at or above which the hold directive speaks, in tokens,
// when the machine-local signpost names none. The floor is on the VOICE and
// never on the gate's verdict: the gate keeps silently deferring an unmarked
// offer at any count, because deferral is free, so below this figure there is no
// prompt, no declaration and no marker traffic at all. The default is the
// recommended context WINDOW rather than a consumed reading, and it sits about
// one auto-compact reserve above the reading at which offers begin: the doctor
// recommends a 285000 window with a 35000 reserve, which puts the first held
// offer near 250000 consumed (doctor.ps1, $recommendedWindow and
// $autoCompactReserve). So a held seat hears the directive after roughly that
// much holding rather than at its first offer, which is the deliberate
// suppression the design asks for.
//
// The bound this figure has to be read against is the SEAT'S OWN CONTEXT WINDOW
// rather than the gate's safety ceiling. The reading compared against it is a
// hold's `consumed`, which traces to sumUsageFields over one assistant request's
// input, cache-creation and cache-read token counts, so it cannot exceed the
// window that request was made in. On a seat whose window is below this figure
// the directive therefore never fires at all, and the floor is reachable only on
// a seat whose window exceeds it. The default is the recommended window for that
// reason and not by coincidence.
const NUDGE_FLOOR_DEFAULT = 285000;

// The signpost's read cap. It holds a handful of short settings, so anything
// past 64 KB is not the file this reads.
const SIGNPOST_MAX_BYTES = 64 * 1024;

// The hold directive's floor, from the signpost, with the default for every
// reading that is not a usable number. It is the read this hook COMPOSES a path
// for out of the home directory rather than out of the payload, which is what
// makes the home-directory screen below its own: every other read here is
// resolved from the project the payload names, and lands outside it only where
// kitScratchDir sends it there, under ~/.kit/store/ for a project directory
// lying inside the memory store, so a store-backed seat's hold is read from the
// home directory too without any path being built here. The reader is
// deliberately total: an absent HOME, an
// absent or unreadable file, a path that is not a regular file, an oversized
// one, unparseable JSON, JSON that is not an object, a missing key, and a key
// whose value is a string, a null, a NaN or a negative all mean the default.
// This hook runs after every covered tool return, so a reader that could throw
// here is a hook that dies constantly; the value is a threshold, so guessing the
// default is a defensible answer for every one of those readings and there is
// nothing a failure could usefully report to.
//
// Three hostile-boundary guards ride the read rather than being matched by hand.
// The home directory is refused when it names a network share, through the same
// predicate guard 4 applies to the payload's cwd: a roaming profile really can
// put HOME on a UNC path, and an open on an unreachable share blocks for the SMB
// timeout, which is the one failure this hook must never cause. And the bytes
// come through kit-read-lib's shared bounded reader, which settles the kind on
// the OPEN DESCRIPTOR rather than on the name: judging a name with lstat and
// then opening that same name leaves a window a local process can swap the file
// inside, and a swap to a FIFO in that window blocks the open forever, which is
// the same stalled tool loop the share check exists to prevent. That reader
// also bounds the read to the ceiling and reports a result it had to cut short,
// which is refused here rather than parsed: a truncated settings file is not
// the file this reads.
//
// The third is that reader's opt-in link refusal, and what it rests on is what
// the refusal DOES rather than any property of the file's writers. This read is
// scoped to one path under the home directory, and refusing a link at that final
// component is what holds it there: a link planted at the path cannot aim this
// read at a file elsewhere on disk, so the floor is read from ~/.claude/ or not
// at all, and the open cannot be handed a target on a dead network mount, which
// would stall a hook that runs after every covered tool return exactly as the
// share check above exists to prevent. Refusing means the default floor, which
// is this reader's answer for every other unusable reading.
//
// A leading BOM is stripped as defensive cover rather than for a writer that
// emits one: neither installer of this file does (setup.sh writes plain bytes
// and doctor.ps1 writes through a UTF8Encoding constructed with no byte-order
// mark), but the file is hand-editable on a platform whose editors add one, and
// a BOM left in front of the JSON makes the parse throw and silently costs an
// operator the floor they set.
//
// The require is deferred like every other kit library require in this file, so
// a damaged installed cache degrades to the default rather than to a throw on
// every covered tool return.
function nudgeFloor() {
    try {
        const home = os.homedir();
        if (typeof home !== 'string' || home === '') return NUDGE_FLOOR_DEFAULT;
        if (namesNetworkShare(home)) return NUDGE_FLOOR_DEFAULT;
        const signpost = path.join(home, '.claude', 'grimoire.local.json');
        const read = require('./kit-read-lib.js')
            .readFileBounded(signpost, SIGNPOST_MAX_BYTES, { refuseLink: true });
        if (read === null || read.bounded) return NUDGE_FLOOR_DEFAULT;
        const raw = read.text;
        const parsed = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NUDGE_FLOOR_DEFAULT;
        const floor = parsed.compactNudgeFloor;
        if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0) return NUDGE_FLOOR_DEFAULT;
        return floor;
    } catch {
        return NUDGE_FLOOR_DEFAULT;
    }
}

// The hold directive: fixed prose interpolating nothing but the command, which
// is the __dirname value kit-compact-lib.js's checkpointCliClause renders
// through two guards, so a path the grammar refuses and a shell with no
// knowable home each cost the runnable clause and nothing else. The require is
// deferred like every other kit library require in this file, straight into
// this function: by the time it is reached on the live path, main() has
// already required kit-compact-lib.js (`lib`) and would have returned null
// first on a damaged one, so nothing here needs a fallback of its own. Called
// directly, as the test suite calls it, a require failure throws straight out.
//
// It states the hold, names the one release a held session has, puts the
// durability judgment in front of the model as a question it answers rather
// than a step it performs, and says what a no answer means. The judgment is the
// mechanism here: nothing can detect on the seat's behalf whether the worktree
// dirt around it is durable, so the directive asks for the three facts that
// settle it and leaves the call where it belongs. The moment sentence is not
// decoration either, because a declaration is honored only while no new turn has
// begun in the declaring session since it was written, so declaring mid-step
// spends the declaration on whatever the session does next. The test suite pins
// fragments of it, so a reword is a deliberate double-edit.
//
// cliPath is a parameter so both directions of the command clause are testable
// as a unit.
function buildHoldReminder(cliPath) {
    const rendered = require('./kit-compact-lib.js').checkpointCliClause('boundary', cliPath);
    // No directory rides with the boundary verb: its marker is keyed by
    // session under the home and its moment is measured on the transcript the
    // harness filed for the session, so the verb declares from whatever
    // directory the session works in.
    const declare = rendered.runnable
        ? 'run ' + rendered.clause
        : 'declare it by running ' + rendered.clause;
    return 'compact-deferral-nudge: the compaction gate is holding this session\'s auto-compaction '
        + 'offers, and this session has declared no boundary for the gate to land them at. Unheld, '
        + 'they ride to the safety valve near the '
        + 'context limit, which lands the compaction at whatever this session happens to be doing '
        + 'then. At the end of this turn, answer the durability question: are your own worktree '
        + 'edits none or handed to a named owner, is every decision from this stretch on disk, and '
        + 'are the messages you owe sent? If all three are yes, ' + declare + ', and the next offer '
        + 'lands there. If any is no, finish it first and declare at that point: the declaration '
        + 'covers this moment only and lapses the moment new work arrives.';
}

// The payload is read and parsed whole, with no size cap, which is the house
// convention for a hook payload. What differs here is the wiring rather than
// the reader: the sibling hooks ride Edit, Write, MultiEdit and PreToolUse,
// whose payloads are small or carry no tool_response at all, while this one
// rides the four tools whose results are the large case. A cap would truncate
// the JSON, the parse would fail, and the hook would go silent on precisely
// the long calls a deferral is most likely to be standing behind, so none is
// taken. Nothing read here is retained past the guards, and none of it reaches
// the reminder.
function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Guard 3: the subagent marker, read as truthiness the way the sibling
// detectors read theirs, and returning WHICH identity was seen.
//
// The key set lives in hooks/kit-agent-identity-lib.js rather than here, on the
// same reasoning as guard 4's network predicate below: four hooks ask this
// question on a per-tool-call boundary, and a hand-copied set that gains a
// spelling in three places out of four leaks silently, because the site that
// kept the old set simply keeps answering. A cache too damaged to supply the
// module answers "a subagent", which stands the nudge down: a deferral reminder
// spent inside a subagent is spent on a context that cannot act on it, so
// refusing is the cheaper error here exactly as it is for guard 4.
function agentIdentity(payload) {
    try {
        return require('./kit-agent-identity-lib.js').agentIdentity(payload);
    } catch {
        return 'unknown-agent';
    }
}

// Guard 4, the scratch-path screen beside it, and guard 6H: the UNC and
// //server forms, which are what a synchronous open can hang on for the SMB
// timeout. Exported so the suite can pin the predicate
// directly: the spawned end-to-end case can only prove the refusal where an
// SMB stack exists, and on a POSIX runner a doubled-slash path is an ordinary
// missing file that produces the same silence for another reason.
//
// The canonical definition lives in hooks/kit-network-lib.js rather than
// here (Standing Amendment 2): a module of a few lines, required directly by
// this hook and by scripts/memq.js (which re-exports it for
// hooks/memory-session.js's drift pass and hooks/memory-frontmatter-guard.js,
// both of which already hold memq for other reasons). The require is deferred
// to inside this function rather than hoisted to module scope, on the same
// fail-toward-silence reasoning every other kit library require in this file
// carries: a damaged or missing installed cache must not crash a hook that
// runs after every covered tool return.
//
// A require failure answers true, refusing the call, not false: false is the
// checked-and-clean value this predicate exists to gate a synchronous open
// behind, and a damaged cache that cannot even supply this small module is a
// state this predicate cannot make sense of, not evidence the path is safe to
// open. Falling through on a network share can cost the tool call itself, and
// that is the same at both call sites.
//
// What the refusal COSTS differs between the call sites, and it is worth stating
// because only some of those costs are a silence. At guard 4 the subject is the
// payload's cwd and the gated reads are the hold path's, so refusing stands the
// hook down for this tool return: one best-effort nudge. At the scratch-path
// screen the subject is the directory kit-compact-lib's resolver answers for
// this project, which is where the gate state and the hold stamps sit, and the
// cost is the same one nudge. At guard 6H the subject is the HOME directory and
// the gated read is the machine-local signpost, so refusing means the floor
// falls back to NUDGE_FLOOR_DEFAULT rather than to silence, and an operator who
// set a floor LOWER than the default gets a quieter hook while one who set a
// higher floor gets a louder one. That is the same answer this reader gives for
// every other unusable signpost reading, and a threshold is a figure the default
// is a defensible guess at, which is why the fail direction stays refusal at all
// three.
function namesNetworkShare(cwd) {
    try {
        return require('./kit-network-lib.js').namesNetworkShare(cwd);
    } catch {
        return true;
    }
}

// Guard 7H: has the interval elapsed since this stamp was written? An absent,
// unparseable or future-dated stamp reads as not-yet-nudged, per the header.
// The subject is this SESSION's hold stamp out of the per-session stamp file
// (holdNudgedAt). The fail-open direction is self-healing, because the fire's
// own stamp replaces the illegible value.
function intervalElapsed(nudgedAt, nowMs) {
    if (typeof nudgedAt !== 'string') return true;
    const at = Date.parse(nudgedAt);
    if (!Number.isFinite(at)) return true;
    const elapsed = nowMs - at;
    return elapsed < 0 || elapsed >= NUDGE_INTERVAL_MS;
}

// The hold path's three guards (5H to 7H in the header). Stamps the hold's
// clock and returns the directive when the stamp landed; null on every other
// path, and never throws on its own account.
//
// It takes the library rather than requiring one of its own, so the deferred
// require in main() is where a damaged installed cache degrades this hook to
// silence. buildHoldReminder's own require of the same library runs after
// that one has succeeded and reads the module cache.
function holdDirective(lib, cwd, sessionId, toolName, nowMs) {
    // Guard 5H: this session's own newest interactive deny, from the gate
    // state's per-session hold list, still inside the idle bound. That record
    // IS the hold.
    const hold = lib.interactiveHoldOpen(lib.readGateState(cwd), nowMs, sessionId);
    if (!hold) return null;
    // The stamp guards below key on the spelling the records STORE rather than
    // on the raw payload id: every session field in these files goes in through
    // gateText, so a stored spelling and a raw one are what the two sides of a
    // lookup would otherwise be. This is a trap removed rather than a bug fixed,
    // and it is unreachable today from either end, since the guard above matches
    // the two before anything here reads a stamp and the library's own readers
    // apply the same rule to whatever they are handed. What it removes is the
    // asymmetry a later caller could inherit, by making the id this path carries
    // the canonical one from the record itself.
    const held = hold.session;

    // Guard 7H before 6H, which is an ordering rather than a renumbering: 7H
    // reads a small file inside the project this payload already named, while
    // 6H reads the machine-local signpost in the home directory. The saving is
    // real in one regime only. A hold at or above the floor is stamped when the
    // directive fires, so 7H answers no for the throttle interval and the home
    // read is skipped there. Below the floor nothing is ever stamped, so 7H
    // answers yes on every covered tool return and both reads happen, for the
    // whole stretch the floor is keeping this hook quiet; that is inherent
    // rather than an artefact of the order, since 6H is the home read and
    // nothing else can establish that the hold is below the floor. Neither
    // guard's answer depends on the other, so the order changes what is read and
    // never what is decided.
    //
    // Guard 7H: the interval since this session was last spoken to about a hold,
    // with the illegible-fires direction.
    if (!intervalElapsed(lib.holdNudgedAt(cwd, held, nowMs), nowMs)) return null;

    // Guard 6H: the floor is on the voice, not on the verdict. An absent or
    // illegible consumed reading (null, which is what the library's own rebuild
    // leaves for every unusable value) is below every floor.
    if (typeof hold.consumed !== 'number' || hold.consumed < nudgeFloor()) return null;

    // The rate limit before the emission, never after it, for the reason the
    // header gives: this stamp is the only cross-process carrier the hold
    // interval has, so a directive emitted without it is one with no rate
    // limit at all, repeating after every covered tool return into a context
    // already near the ceiling.
    if (!lib.recordHoldNudge(cwd, held, nowMs, toolName)) return null;

    return buildHoldReminder();
}

// Evaluate the four common guards, then the hold path, and return the
// directive when its stamp landed; null on every other path. Never throws on
// its own account; the entry-point wrapper turns any escape into a silent
// exit 0.
function main() {
    // Guard 1: the payload parses and the tool is one this hook covers.
    let payload;
    try { payload = JSON.parse(readStdin() || '{}'); } catch { return null; }
    if (!payload || typeof payload !== 'object') return null;
    if (!COVERED_TOOLS.includes(payload.tool_name)) return null;

    // Guard 2: external-engine workers stand down.
    if (process.env.KIT_EXTERNAL_ENGINE === '1') return null;

    // Guard 3: a subagent's tool call stands down on the agent keys alone; its
    // session_id is the parent's, so guard 5H cannot tell it apart.
    if (agentIdentity(payload)) return null;

    // Guard 4: the project the payload names, and never a network share.
    const cwd = payload.cwd;
    if (typeof cwd !== 'string' || cwd === '') return null;
    if (namesNetworkShare(cwd)) return null;

    // The lib require is deferred to here so a damaged installed cache
    // degrades to silence rather than a crash (see the header).
    let lib;
    try {
        lib = require('./kit-compact-lib.js');
    } catch { return null; }
    // Both spellings, because the gate accepts both: a harness emitting
    // camelCase would otherwise keep recording holds this hook could never
    // speak about.
    const sessionId = payload.session_id || payload.sessionId;

    // Guard 4 again, over the answer the shared scratch-path resolver gives for
    // this project rather than over the payload's cwd. The two are ordinarily
    // the same directory, and for one project they are not: kit-compact-lib's
    // resolver sends a project directory lying under ~/.claude to a home-
    // anchored path outside the store, which is where a coordinator seat's gate
    // state and hold stamps live. A roaming profile really can put HOME on a UNC
    // path, and every read below opens one of those files synchronously after a
    // covered tool return, which is the stall the cwd screen exists to prevent.
    // Screening the resolver's own answer is what gives that guard to every
    // reader here, the state read and the stamp read alike, rather than to the
    // one caller a review happened to open; nudgeFloor's home screen is the
    // same guard on the third of these reads. The directory is the subject
    // rather than any one file, since every file this hook reads through that
    // library sits in it.
    if (namesNetworkShare(path.dirname(lib.gateStatePath(cwd)))) return null;

    // One clock for the whole path, so no guard can answer as of a different
    // moment from another.
    return holdDirective(lib, cwd, sessionId, payload.tool_name, Date.now());
}

// Run as the PostToolUse hook only when invoked directly, so a require() of
// this file (the test suite reads buildHoldReminder through it) can never fire
// the nudge as a side effect. Exit is via process.exitCode rather than
// process.exit(), so stdout can drain before the process ends. Every path,
// success and internal error alike, exits 0.
if (require.main === module) {
    let reminder = null;
    try { reminder = main(); } catch { reminder = null; }
    if (reminder) {
        try {
            process.stdout.write(JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PostToolUse',
                    additionalContext: reminder
                }
            }));
        } catch { /* the nudge is best-effort; the exit code stays 0 */ }
    }
    process.exitCode = 0;
}

module.exports = {
    buildHoldReminder, nudgeFloor,
    NUDGE_INTERVAL_MS, NUDGE_FLOOR_DEFAULT, namesNetworkShare
};
