#!/usr/bin/env node
// PreToolUse guard: keep the three file-writing tools off the memory tiers.
//
// The memory record lives in the memory database and memq is its one door, so
// a file written into a tier directory is read by nothing and misses every
// refusal memq's own verbs apply. This guard refuses every Write, Edit and
// MultiEdit into a tier directory, the project tier and the two shared tiers
// (memory-types/<type>/, memory-operator/) alike, whoever is writing: the rule
// is "never the write tools", not "not by subagents". The deny line names the
// memq verb that creates the record, the --replace form that corrects one, and
// the two field verbs, so a blocked write knows its route.
//
// One write stays a file. A record written inside an engine run lands under a
// project's memory/pending/<run id>/ for the engine to adjudicate; that
// directory is no tier directory to memq.tierDirFor, so a target there is
// never placed and leaves this guard unjudged and allowed. No field of a record
// is validated here: nothing is read from the target's content, since no file
// in a tier is a record any more.
//
// Every judgment about where a tier sits is memq's own. The tier directories,
// what may be a memory filename and the store's root all come from
// scripts/memq.js through its exports, so this guard and the store cannot come
// to disagree about which directory is a tier. Which named tier a placed
// directory is (tierOf below) is memq's own answer too, memq.tierNameFor,
// rather than a local re-spelling of the three tier shapes.
//
// SAFETY: this hook can BLOCK a tool call, so it fails OPEN. Any parse error,
// unresolvable root, target it cannot place, or payload shape it does not
// recognize exits 0 (allow), and so does any throw, through the catch around
// main(). It exits 2 (deny) for one state alone: a target memq places in a
// tier directory and names as a memory filename.
//
// Three answers, and each travels on the channel its reader is on. A deny
// exits 2 and writes one line to stderr, which is what the harness delivers
// to the model as its reason for blocking the call. A target outside the
// tiers exits 0 and writes nothing on either channel. A target this guard
// placed inside the store and then could not judge, because its tier could
// not be named or the check itself threw, exits 0 like the clean one and says
// so on stdout, as the hookSpecificOutput JSON that is the one exit-0 channel
// the model receives (exit-0 stderr reaches no reader), in a line that states
// plainly that the tier rule was not applied and the write is going ahead, so
// the two allows are never one answer. That line is written only for a target
// already placed inside the store: a target out of scope, unplaceable, or not
// a memory file gets nothing at all, because a hook that spoke on every `.md`
// write on the machine would be noise rather than a signal.
//
// Both channels are fenced at the streams for the life of the process (see
// silenceOthers below), so the deny line is the only text this guard puts
// through stderr and the not-checked object the only text it puts through
// stdout. memq writes a note to stderr of its own when it is asked to honor a
// store-root override that is not gated, which is a fact about the session's
// configuration rather than about this write; and any byte on stdout from
// anything loaded here would leave the not-checked object unparseable to a
// harness that reads that channel as JSON. Both lines this guard does write
// go out through fs.writeSync on the descriptors, under the fence rather than
// over it. The fence covers process.stdout.write and process.stderr.write; a
// dependency writing to a descriptor directly, as those two lines do, would
// pass it, and nothing loaded here does.
//
// Residuals, stated rather than implied:
//   - Scope follows memq's own store resolution, so under a KIT_MEMORY_ROOT
//     override that memq honors, the machine's real tiers are out of scope and
//     the redirected ones are in it. The claim this guard makes is "the tiers
//     of the store this session resolves", not "every tier on the machine".
//   - The run-scoped pending tier (pending/<run id>/ under a project's memory
//     directory) is not a tier directory to memq's own tierDirFor, so a record
//     written there is out of scope and allowed, which is the carve-out above.
//   - MEMORY.md, decay-stamp and the sidecars are out of scope on every tier,
//     because isMemoryFilename is memq's boundary for what a record is and
//     re-deciding it here would be a second grammar; nothing reads them after
//     the record moved to the database.
//   - A shell write (a redirection in Bash or PowerShell) never passes this
//     guard, whose matcher names the three file-writing tools; the skill's
//     CLI-authored rule is what governs a shell's hand on the tiers.
//   - A target is placed lexically, with the extended-length (\\?\) and
//     device (\\.\) prefixes folded off in either separator spelling, an
//     admin-share UNC spelling naming this machine rewritten to its drive
//     form, and every component's win32 spellings folded to the base name (a
//     colon suffix on the basename names an alternate data stream of the
//     base file, and a trailing dot or space comes off every segment, the
//     one spelling under which such a write reaches the tier). The directory's real
//     path is tried as a second candidate only for a target whose lexical
//     path already sits under the store root and is not UNC- or
//     device-rooted, which is what resolves an 8.3 short name or a link in
//     the directory chain inside the store while asking nothing of any other
//     write on the machine: resolving a network path on win32 is an outbound
//     SMB connection made before the user's permission prompt, and a mapped
//     drive letter is that connection behind a spelling no lexical screen
//     catches. A UNC spelling of the store by a non-admin share name is
//     therefore not placed, and neither is a spelling through a mapped or
//     subst drive letter, or a short name of the store root itself.
//   - That last claim is scoped to a store root on a local drive. memq's
//     memoryRoot() is os.homedir() plus .claude absent an honored override, so
//     where the profile is redirected onto a mapped drive letter the store
//     root itself sits on a network-backed volume: underStoreRoot answers
//     true for targets there, memq.namesNetworkShare does not fire on a
//     drive-letter spelling (it answers only the UNC and //server forms), and
//     the resolver runs on that volume. This guard is one of four callers
//     that single-source that predicate in scripts/memq.js; nothing here
//     re-spells the question, and widening it to a drive-letter spelling is
//     not this guard's to decide.
//   - An admin-share UNC host is folded only when it matches one of the five
//     spellings isLocalHost compares against (localhost, 127.0.0.1, ::1, .,
//     and whatever os.hostname() reports). Any other spelling of this same
//     machine is not among them, a fully qualified name and a DNS alias
//     included, so a tier write spelled
//     \\box.corp.example\C$\...\memory-operator\rec.md places nothing and is
//     allowed with no line at all: the cost of an unrecognized local spelling
//     is paid in the clean answer's silence, on a tier where clean is never
//     the right answer. Widening the list would mean resolving a name, which
//     is the outbound connection the paragraph above refuses.
//   - A path component of only dots and spaces (`. `, `...`) folds to nothing,
//     and a target carrying one is not placed. Such a write reaches no tier:
//     measured on win32 with a `. ` component, a plain write to it fails
//     ENOENT, and a write through a recursive create lands a literal `. `
//     directory that fs.realpathSync.native reports back verbatim, with
//     nothing arriving in the sibling tier directory. Placing it as though the
//     component were elided would refuse a write that never touches the store.
//   - A target nested below a tier's own depth (archive/, pending/<x>.md
//     outside a run directory, memory-operator/sub/) is placed by nothing and
//     allowed with no line: memq.tierDirFor names a tier at its exact depth,
//     and no reader opens a file at those depths, so such a write reaches no
//     record and bypasses nothing.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MEMQ = path.join(__dirname, '..', 'scripts', 'memq.js');

// The memq exports whose absence this guard tells apart from an answer, each
// with the typeof its caller here needs. They are the ones newer than
// isMemoryFilename, which is what a plugin cache one version behind can supply
// while lacking these: a symbol older than that cannot be missing from a memq
// this guard was able to require at all. The gate in main() reads this list.
const MEMQ_SYMBOLS = [
    ['tierDirFor', 'function'],
    ['tierNameFor', 'function'],
    ['namesNetworkShare', 'function'],
    ['isTypeName', 'function']
];

// Characters of store text (a name a record points at, a date it declares)
// quoted back on a line, past which it is cut and the cut is marked.
const QUOTE_CAP = 120;

// The tier this call's target was placed in, once memq places it: 'project',
// 'type' or 'operator' from tierOf, or 'memory' for a target placed in a tier
// directory whose tier is not yet (or never) named. It gates the not-checked
// line, including the one the outer catch writes, so nothing is said about a
// file this guard never placed in the store, and the line names the tier.
let placedTier = null;

// The one writer to stderr. Every line this guard emits is a single line, so
// the separators are folded out before the terminator goes on: a deny's text
// carries store-derived names, and a second line under a `Blocked:` prefix
// would read as a second verdict from the harness rather than as file content.
function say(text) {
    try { fs.writeSync(2, String(text).replace(/[\r\n]+/g, ' ') + '\n'); } catch { /* nothing to do */ }
}

// Everything else that writes to either channel is dropped. memq's store-root
// gate notes on stderr when a session sets KIT_MEMORY_ROOT without the data
// signal, and this guard resolves the store on every write of every
// memory-shaped filename, so echoing that note would put it in front of writes
// all over the machine while saying nothing about any of them. stdout is
// fenced for a harder reason: it carries the one structured answer this guard
// gives, and a harness reading that channel as JSON drops the whole object if
// any other byte shares it, so a single line written there by anything loaded
// here would turn the not-checked answer into no answer. Both of this guard's
// own lines go out through fs.writeSync on the descriptors, which is under the
// fence rather than over it.
function silenceOthers() {
    process.stdout.write = () => true;
    process.stderr.write = () => true;
}

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// The spellings of an absolute path folded to the one the store is resolved
// in, or null for one this guard places nothing for. On win32 only: both
// semantics below are that platform's, and applied elsewhere the admin-share
// rewrite would mint a relative c:/rest out of a //host/c$/rest path, which
// the caller then resolves against the payload cwd, judging a file the write
// never touches. Both NT namespace prefixes are folded off, the
// extended-length \\?\ and the device \\.\, each with its UNC variant
// rewritten to the plain \\host form, and in either separator spelling,
// because path.resolve re-spells the forward-slash forms into the backslash
// prefix downstream of this fold. An administrative-share UNC spelling of a
// local volume (\\host\C$\rest, host a spelling of this machine) becomes its
// drive form, which is the spelling that otherwise reaches a tier directory by
// a path no lexical comparison places. A host that is not this machine names
// that host's volume, where the drive form would judge a local file the write
// never touches, and an ordinary network share is left alone with it: each
// names a volume this store's root is not on, and refusing every write to one
// would block work on a network working directory to close nothing.
//
// What sits behind an NT prefix decides whether anything is placed. Only two
// bodies name a path the rest of this file can reason about: a drive-rooted
// one (\\?\C:\rest) and the UNC form (\\?\UNC\host\share\rest). Every other
// body is a volume GUID, GLOBALROOT or a device name (\\?\Volume{...}\rest,
// \\.\PhysicalDrive0), and stripping the prefix off one of those leaves text
// that is not absolute at all: the caller would resolve it against the
// payload's working directory and judge a file the write never touches, in
// both directions at once, which is the hazard this fold exists to prevent.
// So those answer null and nothing is placed for them.
function foldSpelling(raw) {
    if (process.platform !== 'win32') return raw;
    let s = raw;
    const nt = /^[\\/]{2}[?.][\\/](UNC[\\/])?/i.exec(s);
    if (nt) {
        if (nt[1]) s = '\\\\' + s.slice(nt[0].length);
        else if (/^[A-Za-z]:(?:[\\/]|$)/.test(s.slice(nt[0].length))) s = s.slice(nt[0].length);
        else return null;
    }
    const admin = /^[\\/]{2}([^\\/]+)[\\/]([A-Za-z])\$(?=[\\/]|$)/.exec(s);
    if (admin && isLocalHost(admin[1])) s = admin[2] + ':' + s.slice(admin[0].length);
    return s;
}

// Whether a UNC host segment is a spelling of this machine: the fixed local
// names, and the hostname the OS reports, compared caselessly. Any host
// outside this list keeps its UNC spelling, which placeTarget below never
// resolves, so an unrecognized local spelling costs a placement, never a
// connection.
function isLocalHost(host) {
    const name = String(host).toLowerCase();
    return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '.'
        || name === os.hostname().toLowerCase();
}

// The write's target as an absolute path, or null when the payload does not
// place it. A relative path needs the payload's cwd to mean anything, and
// without one there is no file this guard can be about. On win32 every
// component is folded to its base name: a colon suffix on the basename names
// an alternate data stream, whose write creates and touches the base file,
// and a trailing dot or space comes off every segment, because the folded
// spelling is the only name such a write can silently land on inside the
// store: an opener that normalizes win32 names lands it there, and a writer
// that passes the spelling through literally cannot reach the tier at all
// (through Node's own fs it lands a stray directory beside the tier on a
// recursive create, and fails through an existing one). A component that
// folds to nothing places nothing.
//
// The fold is an over-deny and not an exact re-spelling, and the difference
// shows where the two folds meet: \\?\C:\<store>\projects\p\memory.\rec.md
// has its prefix stripped, which is itself what re-enables the Win32
// normalization that takes the trailing dot off, and the judged path is then
// the tier's own memory\rec.md while a writer passing the spelling through
// literally lands in a directory named memory. So a judged write can be one
// that never reaches the judged path. Every such case runs in the refusing
// direction (a record judged that would otherwise be judged by nothing), and
// none of them lets an unjudged write into a tier, which is the property the
// placement needs.
function targetPath(input, cwd) {
    const raw = input.file_path || input.path;
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const s = foldSpelling(raw.trim());
    if (s === null) return null;
    let file;
    try {
        if (path.isAbsolute(s)) file = path.resolve(s);
        else if (cwd !== null) file = path.resolve(cwd, s);
        else return null;
    } catch {
        return null;
    }
    if (process.platform !== 'win32') return file;
    const root = path.parse(file).root;
    const segments = file.slice(root.length).split(path.sep);
    const last = segments.length - 1;
    const stream = segments[last].indexOf(':');
    if (stream !== -1) segments[last] = segments[last].slice(0, stream);
    const folded = [];
    for (const segment of segments) {
        const name = segment.replace(/[. ]+$/, '');
        if (name === '') return null;
        folded.push(name);
    }
    return path.join(root, ...folded);
}

// The tier directory this write lands in, with the file spelling it was placed
// by, or null for a target in no tier. The path as written is tried first, and
// only when it places nothing is the directory's real path tried as a second
// candidate, which is what resolves an 8.3 short name and any link in the
// chain above the file. The real path is unavailable for a directory that
// does not exist yet, which is ordinary for a Write, so its absence is not a
// failure to place anything. It is asked only of a target whose lexical path
// already sits under the store's own root, and never of one that is UNC- or
// device-rooted: on win32 resolving \\host\share is an outbound SMB
// connection that authenticates as the logged-in account, made here before
// the user's permission prompt and stalled for the SMB timeout by an
// unreachable host, which is the hazard memq's own resolveWorktreeMainRoot
// refuses a .git pointer over, and a mapped or subst drive letter is a
// spelling of the same connection no lexical screen catches. Confining the
// resolver to in-store targets keeps it out of every other .md write on the
// machine; a target that reaches the store only through an alias of the root
// itself is placed by its written spelling or not at all. The UNC- and
// device-rooted screen is `memq.namesNetworkShare`, single-sourced in
// scripts/memq.js (Standing Amendment 2), memq's own answer to the same
// question rather than a second regex on the leading separators.
function placeTarget(memq, file) {
    const lexical = memq.tierDirFor(file);
    if (lexical !== null) return { file, dir: lexical };
    if (memq.namesNetworkShare(file) || !underStoreRoot(memq, file)) return null;
    try {
        const dir = path.dirname(file);
        const real = fs.realpathSync.native(dir);
        if (real !== dir) {
            const candidate = path.join(real, path.basename(file));
            const placed = memq.tierDirFor(candidate);
            if (placed !== null) return { file: candidate, dir: placed };
        }
    } catch { /* no real path for a directory that is not there */ }
    return null;
}

// Whether an absolute path sits lexically under the store's root, the screen
// that admits a target to the real-path resolver above. The comparison is
// path.relative's, so the platform's own case rule applies, and a root memq
// cannot answer admits nothing.
function underStoreRoot(memq, file) {
    let root = null;
    try { root = memq.memoryRoot(); } catch { return false; }
    if (typeof root !== 'string' || root === '') return false;
    const rel = path.relative(root, file);
    return rel !== '' && !path.isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel);
}

// Which tier a memory directory is, or null for a directory that is none of
// them. memq.tierDirFor answers only whether a file's directory is a tier
// directory, so naming which tier calls memq.tierNameFor rather than
// re-spelling the three shapes locally (Standing Amendment 2): were memq's
// own shapes to move, a local re-spelling here would still place the file
// while answering null about it, and a shared-tier write would be allowed in
// silence rather than refused, which is the fail-open drift this call closes.
function tierOf(memq, dir) {
    return memq.tierNameFor(dir);
}

// The CLI verb that authors the tier this write was aimed at, named on the
// refusal so the fix is in the line that blocks. What comes back is the verb
// and its positionals, with no flags: the flags are what decide whether the
// command creates a record, rewrites its index description or replaces its
// body, and the refusal builds each of those forms off this one stem, because
// they are different commands to run and they change different things.
//
// The type segment is store text on its way onto that line, so it is named
// only when it is a name memq would accept (a bounded [\w.-] word) and stands
// as a placeholder otherwise: the directory comes out of the payload's own
// path, and a deny's stderr reaches the model as the harness's reason for
// blocking the call.
function sharedTierFix(memq, compact, tier, dir) {
    if (tier === 'operator') return 'memq add-operator <name> "<description>"';
    const segment = path.basename(dir);
    const named = memq.isTypeName(segment) ? quoted(memq, compact, segment) : '<type>';
    return 'memq add-type ' + named + ' <name> "<description>"';
}

// How `memq triggers` names this tier, which is not how the add verbs name it:
// that verb takes a type as --type=<type> where add-type takes it as its first
// positional, so the create form's stem cannot carry the trigger form. The
// unusable segment reads as the same placeholder either way.
function sharedTierTriggerFlag(memq, compact, tier, dir) {
    if (tier === 'operator') return '--operator';
    const segment = path.basename(dir);
    return '--type=' + (memq.isTypeName(segment) ? quoted(memq, compact, segment) : '<type>');
}

// What a rejected value reads as when the library that elides it is not there.
// The deny is the thing that has to survive a damaged cache: this guard is one
// of the enforcement points the hook canary probes, and a renderer that will
// not load must cost the VALUE rather than the verdict, because a throw here
// reaches the catch around main() and that catch allows the write. Printing the
// value unelided is the other direction and the expensive one, since the whole
// point of the elision is that a deny reason is a channel a model reads.
const VALUE_WITHHELD = '[value withheld: the kit library that elides the account name could '
    + 'not be loaded]';

// Whether the channel's renderer is there to be called at all. A cache can
// supply a kit-compact-lib.js that loads and carries none of these exports, so
// presence is asked of the function rather than of the module.
function rendererAvailable(compact) {
    return compact !== null && typeof compact === 'object' && typeof compact.scrub === 'function';
}

// The home directory taken out of text bound for a deny reason, which is a
// channel a model reads, or null where the renderer refused to answer.
//
// kit-compact-lib owns that elision, and which pass it takes depends on whether
// a strip has already deleted characters out of the text: where one has, a home
// spelling can arrive glued to the text beside it and the name boundaries that
// keep a neighbouring directory its own name refuse the site, so the relaxed
// pass drops them. A cached library one version behind carries scrub without
// scrubAfterStrip, and scrub is that same elision with the boundaries kept, so
// it stands in.
//
// A cache can supply exports that are there and throw when called, and a throw
// out of one reaches the catch around main(), which ALLOWS the write: presence
// alone is not the answer, so the call is made behind a catch of its own and a
// renderer that will not answer costs the VALUE. That is the same ruling as the
// missing export's, taken one step later, and null is how each caller reads it.
function elideForChannel(compact, text, stripped) {
    const s = String(text);
    try {
        return stripped && typeof compact.scrubAfterStrip === 'function'
            ? compact.scrubAfterStrip(s, true)
            : compact.scrub(s);
    } catch {
        return null;
    }
}

// Store text on its way onto a line, reduced to what a line can carry with
// every reduction named: the home directory is elided, memq.sanitize keeps
// printable ASCII and drops the double quote, so the characters it removed are
// marked when any were, and a value past the cap is marked as cut, because text
// shown as if it were whole is how a reader comes to act on a name the record
// does not carry. The note vocabulary is the one memq's own anchorRefusalText
// uses, so one wording marks a reduction wherever a line carries one.
//
// The four steps are the shared renderer's own order and hold it for its
// reasons. The values that reach here FAILED the store's grammars, so they are
// free text and a hand- or model-written record can put an absolute
// home-anchored path in one. The elision runs first, over the text as given;
// the strip runs next, so the cut is decided on what is emitted; the elision
// runs again where the strip deleted anything, both because a deletion inside a
// spelling reassembles it for this pass and because a cut taken before the
// elision can halve a spelling into a fragment no whole-spelling pattern
// reaches; and the cap runs last.
function quoted(memq, compact, value) {
    if (!rendererAvailable(compact)) return VALUE_WITHHELD;
    const elided = elideForChannel(compact, value, false);
    if (elided === null) return VALUE_WITHHELD;
    const kept = memq.sanitize(elided, Infinity);
    const removed = kept.length !== elided.length;
    const rendered = elideForChannel(compact, kept, removed);
    if (rendered === null) return VALUE_WITHHELD;
    const cut = rendered.length > QUOTE_CAP;
    const head = cut ? rendered.slice(0, QUOTE_CAP) : rendered;
    const notes = [];
    if (removed) notes.push('characters removed for display');
    if (cut) notes.push('shown to ' + QUOTE_CAP + ' characters');
    return notes.length === 0 ? head : head + ' [' + notes.join('; ') + ']';
}

// The allow that says it checked nothing. It exits 0 like a clean record and
// is never mistaken for one, and it never reads as a refusal: no `Blocked:`,
// and the sentence says the write is going ahead. It travels as stdout JSON
// whose hookSpecificOutput carries additionalContext under this event's name,
// because that is the channel the installed CLI's own PreToolUse dispatch
// delivers an exit-0 hook answer to the model on: the CLI (2.1.246) builds a
// hook_additional_context attachment from a PreToolUse hook's
// additionalContexts, named `PreToolUse:<tool>`, and its PreToolUse output
// schema carries additionalContext as an optional key (exit 2 is what
// delivers stderr, and exit-0 stderr reaches no reader). No
// permissionDecision rides beside the text, so the line informs and decides
// nothing about the call. The write is synchronous, so the process.exit
// below cannot lose it.
function notChecked(cause) {
    const named = placedTier === 'project' || placedTier === 'type' || placedTier === 'operator';
    const record = named ? 'this ' + placedTier + '-tier memory record' : 'this memory-store record';
    const text = 'Not checked: ' + record + ' is allowed without the tier rule being applied, because '
        + cause + '. The write goes ahead; nothing here says the record may be written there, and'
        + ' a file in a memory tier is read by nothing: memq put writes the record.';
    try {
        fs.writeSync(1, JSON.stringify({
            hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text }
        }));
    } catch { /* nothing to do */ }
}

function main() {
    silenceOthers();

    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; }   // parse fail: allow
    if (typeof p !== 'object' || p === null) return;

    // One spelling for the subject, and it is the harness's own: it sends
    // `tool_input`, the key memq-grant.js reads too. Reading a spelling the
    // harness does not send would let a payload put a target in front of this
    // guard that no tool call is about, and every verdict below is about the
    // file that reading names. The tool's name is not read: the matcher in
    // hooks.json names the three write tools, and the verdict is the same for
    // each.
    const input = p.tool_input;
    if (typeof input !== 'object' || input === null) return;
    const cwd = (typeof p.cwd === 'string' && p.cwd.trim()) ? p.cwd.trim() : null;

    const target = targetPath(input, cwd);
    if (target === null) return;                                  // no target to judge: allow

    // Required here, after the payload and path screens that need nothing
    // from it, so a call with no target never parses the module, and required
    // inside main() so a plugin cache that cannot supply the store's rules
    // leaves this guard inert through the catch around main(), which is the
    // allow direction, instead of ending the process on an unhandled throw.
    // Every screen below is memq's own judgment, so none of it can move above
    // this line, memq.namesNetworkShare included.
    const memq = require(MEMQ);
    // The channel's renderer, bound beside memq: the deny line below carries
    // a type segment out of the payload's own path, text a model reads, and
    // the elision that takes the OS account name out of it belongs to that
    // channel. Unlike memq above it is bound behind a catch of its own rather
    // than through the one around main(), because that catch ALLOWS the write:
    // a renderer this guard could not use would otherwise stop it denying at
    // all, which is the one failure a guard must not have. A null here
    // withholds the value and leaves the verdict standing, and so does an
    // export that is missing or throws.
    //
    // What this catch does NOT cover is a library that will not load at all:
    // memq requires the same file at its own module scope and rethrows the
    // failure when it is loaded as a module, so that state has already taken the
    // require above, with no target placed in a tier yet and so nothing for the
    // catch around main() to report. That is where an unloadable memq lands too,
    // and it is the same allow.
    let compact = null;
    try { compact = require('./kit-compact-lib.js'); } catch { compact = null; }

    // tierDirFor, tierNameFor, namesNetworkShare and isTypeName are newer than
    // isMemoryFilename, so a plugin cache carrying an older memq.js can
    // supply an isMemoryFilename that works while lacking any of them.
    // namesNetworkShare belongs in this same gate rather than a separate one:
    // placeTarget below calls it, and placeTarget runs before placedTier is
    // ever set (placedTier = 'memory' is the line right after it), so a throw
    // out of a missing namesNetworkShare reaches the outer catch around main()
    // with placedTier still null, and notChecked never runs there either, the
    // exact silent-allow this gate exists to close, left open for its own
    // sibling symbol. isTypeName is here because the deny line's type segment
    // is named through it on every type-tier record.
    //
    // Checked here, before any of them is called, so an export skew is told
    // apart from a deny that ran and found nothing, the same way
    // memory-session.js's DRIFT_MEMQ_SYMBOLS tells a skewed memq apart from a
    // clean drift answer. The answer names the symbols that are missing
    // rather than the set they came from, so a cache one export behind says
    // which one.
    const missing = MEMQ_SYMBOLS.filter(([name, kind]) => typeof memq[name] !== kind)
        .map(([name]) => name);
    if (missing.length > 0) {
        placedTier = 'memory';
        notChecked('memq\'s ' + missing.join(', ') + (missing.length === 1 ? ' symbol is' : ' symbols are')
            + ' not there, which a version skew between this guard and its cached memq.js can cause');
        return;
    }

    if (!memq.isMemoryFilename(path.basename(target))) return;    // MEMORY.md, decay-stamp, a sidecar
    const site = placeTarget(memq, target);
    if (site === null) return;                                    // outside the store, or under archive/

    // From here the target sits in a directory memq places as a tier, so a
    // check that cannot run is reported rather than passed off as silence,
    // and tierOf refines the name the report carries; a throw out of tierOf
    // itself still speaks, as the tier it could not name, and so does a
    // directory memq placed that none of tierOf's three shapes names, which
    // no directory reaches against today's memq and which would otherwise be
    // the one placed target exiting in the clean answer's silence.
    placedTier = 'memory';
    const tier = tierOf(memq, site.dir);
    if (tier === null) {
        notChecked('the tier its directory belongs to could not be named, so no tier rule was applied');
        return;
    }
    placedTier = tier;

    // Every tier is refused alike, the project tier included: the record lives
    // in the memory database and memq is its one door, so a file written into
    // a tier directory is read by nothing and misses the CLI's refusals. The
    // one write that stays a file is a record written inside an engine run,
    // which lands under memory/pending/<run-id>/ for the engine to adjudicate;
    // that directory is no tier directory to memq.tierDirFor, so a target
    // there is never placed and leaves this guard above, unjudged and allowed.
    //
    // The line names the create form for the tier, since creating is what a
    // blocked write most often wanted, and the --replace form for a
    // correction, which on a shared tier takes the tier's consent flag and is
    // withheld from the grant a fleet worker runs under. The two field verbs
    // are named for the two fields a write often reaches for, and the pending
    // carve-out is stated so a session inside a run knows where its write may
    // still go.
    const fix = tier === 'project' ? 'memq put <name> "<description>"' : sharedTierFix(memq, compact, tier, site.dir);
    const consent = tier === 'project' ? '' : ' --confirm-shared';
    say('Blocked: the ' + tier + ' memory tier is authored by memq, never by the Write, Edit '
        + 'or MultiEdit tools, whoever is writing: the record lives in the memory database, and a '
        + 'file written here is read by nothing. To create a record: ' + fix + ' --body "<text>"' + (tier === 'project' ? '' : ' (or the description alone as the body)')
        + '. To correct an existing record whole: the same command with --replace' + consent
        + ', which states every field of the record. To change only its recognition triggers: memq '
        + 'triggers <name> <type>:<pattern>' + (tier === 'project' ? '' : ' ' + sharedTierTriggerFlag(memq, compact, tier, site.dir))
        + (tier === 'type' ? '' : '. To change only its anchors: memq anchor <name> <path>' + (tier === 'operator' ? ' --operator' : ''))
        + '. A record written inside an engine run (KIT_RUN_ID) lands under memory/pending/<run-id>/ '
        + 'instead, which this guard leaves alone. The memory-system skill carries the rest.');
    process.exit(2);       // deny
}

try {
    main();
} catch {
    // Fail open, and say so where there is a record to say it about: a throw
    // out of a reader is a check that did not happen, and the placed tier is
    // what keeps the line off every other write on the machine.
    if (placedTier !== null) notChecked('the check itself failed');
}
process.exit(0);
