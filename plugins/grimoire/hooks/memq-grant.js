#!/usr/bin/env node
// PreToolUse grant: under the engine's write-gated spawn vector, Bash refuses
// `node <script>` even for the kit's own memq CLI, so a fleet worker on that
// vector loses memory recall and outcome logging. This hook emits an allow
// decision for exactly one command shape and stays silent on everything else.
//
// The grant requires ALL of:
//   - The fleet-store signals: KIT_MEMORY_ROOT set and
//     KIT_MEMORY_ROOT_ALLOW_DATA === '1'. The check is memq's own exported
//     storeSignalsPresent(), required from the scripts/ directory beside this
//     hook, so the hook and the CLI cannot drift apart on what a fleet store
//     is. memq.js dispatches only under require.main, so the load runs no CLI
//     code, and a load failure means no grant (granting an invocation of a
//     script that cannot load serves nobody).
//   - The tool is Bash and the command is one `node` invocation whose first
//     argument is an absolute spelling that resolves, by normalized path
//     equality, to this plugin's own scripts/memq.js. The target is anchored
//     to the hook's on-disk location (__dirname), never to an environment
//     variable, so no inherited setting can point the grant at another tree.
//     Path equality, never a pattern: a lookalike path, a traversal landing
//     elsewhere, a same-named script under another root, and a symlink
//     spelled from another path all fail it. Relative spellings are refused
//     outright: the Bash tool's shell keeps a working directory across calls
//     that nothing pins to the payload cwd, so a relative target cannot be
//     positively resolved. On Windows a target must carry a drive-letter root
//     as written, and no other spelling is converted into one. A rootless
//     slash path resolves against this process's current drive while the
//     child's shell maps it elsewhere, and the /d/... spelling Git-Bash
//     accepts is rewritten by the MSYS runtime at exec, under an environment
//     variable that shell can be carrying from an earlier call and that this
//     hook cannot observe from its own process. Both spellings therefore name
//     one file to this hook and can name another to the child, which is the
//     divergence every rule here exists to prevent.
//   - The arguments past the script path are screened, not passed through.
//     node hands everything after the script to the script, so these are
//     memq's argv and memq validates its own input, but the grant is narrower
//     than the CLI: a prompt-free allow with no operator in the loop does not
//     cover a command that removes a shared record, reads a caller-named path
//     into the store, or loads code out of a directory this hook cannot
//     bound. The verb is judged by allowlist: the word right after the script
//     path, which is the one place memq reads a subcommand from, must be one
//     of the verbs this grant is meant to cover, and every other word there
//     withholds it. Left out of that list are delete-type and delete-operator,
//     which mark a shared-tier record's row deleted so no read serves it;
//     forget, which does the same to a project-tier record; find, withheld pending a decision on
//     granting it, since the in-process embedder load it was withheld for is
//     no longer on its path; anchor, which rewrites a project-tier
//     record in place at a name the command line gives it, and with it the
//     claim every drift surface reads about which files that memory is still
//     true of; and triggers, which rewrites a record of any tier the same way
//     at the record's other half, the line that decides when that memory is
//     put in front of a session. Seven flag shapes are refused wherever in the
//     command they sit, since that is where a flag can appear, and an eighth
//     beside two verb words:
//     --body-file, which reads a caller-named path into the store; --update
//     carrying --body, which replaces a shared record's body whole; --replace
//     on add-operator or add-type, which writes a shared record whole over
//     the one the memory database holds and is the same overwrite under
//     another flag;
//     --supersedes, which demotes and labels a record no pin protects from
//     it; --trigger, which writes that same recognition line at a record's
//     birth and so would reach through a granted verb what the triggers verb
//     is withheld for; --rollup, which folds every expired journal entry's
//     prose into a tally and keeps the text in a single local .bak the sync
//     never carries; --drop-malformed, which deletes the sidecar lines
//     the rollup rewrite preserves; and --type=<type>, the attached spelling
//     alone, which points a granted read or applied stamp at any type tier
//     the store holds rather than at the one the calling project declared,
//     the bare --type spelling keeping its grant for exactly that reason.
//     memq refuses the shared-tier deletes, the body-file, the body-carrying
//     update, the supersedes pointer, the trigger and the named type spelling under the
//     store signals as well, so those seven are a second lock rather than the
//     only one, and it refuses one shape of an eighth, a `triggers --replace`
//     reaching a shared tier or a pinned project store;
//     find, forget, anchor, the rest of triggers and --rollup
//     are withheld here alone, and --drop-malformed's other lock is the
//     CLI's own coupling (an argument error without --rollup) rather than a
//     store-signal refusal, so its screen here is what holds if that
//     coupling is ever loosened. What a withheld grant costs on this vector
//     is the capability itself: no operator is watching a fleet worker's
//     session, so the command does not run rather than waiting for an
//     approval. Each withholding below is chosen against that price, not
//     against a prompt.
//   - The interpreter is positively identified, not accepted by name. The
//     word `node` resolves through PATH in the child's shell, and this hook
//     inherits the same environment that child would get, so it walks that
//     PATH itself and grants only when the first `node` candidate it finds is
//     this very interpreter (realpath equality with process.execPath; on
//     Windows the wrapper spellings node.cmd/.bat/.com/.ps1 and an
//     extensionless `node` are candidates too, and none of them can equal the
//     real binary, so a planted wrapper anywhere ahead of it refuses). The
//     variables that select code for the granted child are refused outright
//     whenever they are set at all: NODE_OPTIONS (carries --require/--import),
//     NODE_PATH (steers module resolution), and NODE_REPL_EXTERNAL_MODULE (a
//     preloaded module). All three are node's own. No variable naming an
//     embedder directory is among them, for the reason PRELOAD_ENV states
//     below: no granted verb loads an embedder package, and the granted verbs
//     that require the index module stand their own check down whenever such
//     a variable is set at all, so the directory question is bounded rather
//     than screened for.
//   - The whole command line is free of shell metacharacters: ; & | < > ` $
//     ( ) are refused anywhere, quoted spans included. The scan deliberately
//     does not parse quoting to be lenient inside it; quote parity is
//     shell-dependent (the memq.cmd %* expansion is the recorded example), so
//     bluntness is the design. Every C0 control byte and DEL is refused
//     anywhere too, tab excepted: bash strips NUL from a command line
//     outright, so a word screened here as delete-type\0 would reach the
//     child as delete-type, and what a shell does with the rest of that class
//     is unspecified rather than agreed. Word separators are space and tab
//     only, and every other whitespace character (NBSP, the Unicode
//     separators, and the controls the class above already takes) is refused
//     anywhere, because bash does not split on them and a splitter that did
//     would judge different words than the shell builds. Refused for the same
//     words-must-match reason: a backslash immediately before a quote, a
//     backslash outside a quoted span (bash consumes it), and an unquoted
//     word starting with # (bash drops the rest of the line as a comment).
//   - No word is one bash would rewrite before the child sees it. A brace,
//     a glob or a bracket in an unquoted span is refused, because brace and
//     pathname expansion happen after this hook has read the line and can
//     turn one word into several ({delete-type,--confirm-shared} is two words
//     to bash and one to any tokenizer that does not expand). A word opening
//     with an unquoted tilde is refused, because tilde expansion substitutes
//     the caller's own HOME into it and every screen here is a content test.
//     Both are span-scoped, since bash performs neither inside quotes, so a
//     description carrying [note] or ~/.claude is ordinary text. A tilde
//     later in a word is literal too, with one admitted exception noted at
//     the splitter: an assignment-shaped word expands after its = and after
//     each : within it, and keeps its non-tilde prefix, so it can become
//     neither a screened token nor the script path.
//
// Threat model: the expensive failure is a silent over-grant, a command this
// hook allows that runs anything other than this plugin's memq.js under this
// plugin's own interpreter. The metacharacter ban removes chaining,
// substitution, and redirection; the path equality removes substitute
// scripts; the interpreter pin removes a PATH-planted node, while node -e,
// npx, node.exe, and interpreters at other paths are refused as spellings
// before the pin is even consulted; the code-selection refusal removes code
// injected into a genuine invocation through the environment; the word rules
// keep the child's word list the same list this hook screened; and the
// argument screen keeps the commands that are not fit for a prompt-free allow
// out of the grant.
//
// The word list is the same list, and the words themselves diverge in one
// admitted way: bash collapses a doubled backslash to one inside a
// double-quoted span, and the splitter below copies a quoted span verbatim,
// so a word carrying \\ reaches the child one character shorter than this
// hook read it. Refusing a backslash inside quotes is not available, since
// the script path is quoted and full of backslashes on Windows, and the
// divergence is harmless against what the screens actually test. Those are a
// whole-word match against tokens that contain no backslash, and a
// path.resolve equality against this hook's own location. The collapse only
// ever removes a backslash, so a word that carries one still carries one
// after it and can never become a screened token, a screened token carries
// none and so passes through the collapse unchanged, and the two spellings of
// the target path resolve to the same file because path.resolve normalizes
// repeated separators.
//
// SAFETY: this hook only GRANTS; it never denies and never exits 2. On any
// input outside the one shape, any parse failure, unreadable payload,
// unresolvable path or interpreter, or exception, it emits no decision and
// exits 0, which falls through to the engine's normal permission flow. For a
// grant hook, silence is the safe failure: the opposite direction from the
// kit's deny guards, whose fail-open is allowing.

'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// The one target this hook can ever grant.
const MEMQ = path.join(__dirname, '..', 'scripts', 'memq.js');

// Banned anywhere in the command line, inside quotes or out: the shell's
// control and substitution characters, one of which turns one command into
// two, or into a command whose text the shell composes. The ban stays blunt
// across quoted spans because $ and ` expand inside double quotes, and
// because quote parity is the thing an attacker manipulates, so a rule that
// asked which span a character sat in would be asking the manipulated
// question. Carriage return and newline are not here: they are control bytes
// and the class below carries them, along with every other character in it.
// The classes overlap by design rather than partitioning the alphabet, since
// a character refused by two of them is refused either way; what the split
// buys is that each rule states one property, so a later change to what
// counts as a metacharacter cannot quietly stop refusing a line break.
const METACHARACTERS = /[;&|<>`$()]/;

// Banned anywhere, tab excepted: a C0 control byte or DEL. Bash strips NUL
// from a command line outright, so a word this hook reads as delete-type\0
// reaches the child as delete-type and every screen here has answered about a
// word the child never saw. The other controls are the same shape of
// divergence in waiting, since what a shell and this splitter each do with
// one is unspecified rather than agreed. Tab is the exception because bash
// splits words on it, which is what the splitter below does with it too.
const CONTROL_BYTE = /[\x00-\x08\x0a-\x1f\x7f]/;

// The characters bash rewrites into a different list of words than it was
// given, banned in unquoted spans only, by words() below. Brace expansion and
// pathname expansion both happen after this hook has read the command line and
// before the child sees its argv, so a word this hook reads as one literal can
// reach memq as several: {delete-type,--confirm-shared} is two words to bash
// and one to any tokenizer that does not expand, and --{update,body} is two
// more. Everything past the script path is screened by name below, so a
// rewrite this hook cannot see is a way around that screen.
//
// Bash performs neither expansion inside quotes, so a quoted span carrying one
// is ordinary free text: a summary reading "node --test test/*.test.js is
// green", a description carrying [note]. Banning those line-wide would
// withhold the grant from ordinary writing, and on the vector this hook serves
// there is no operator present to approve the fall-through.
const EXPANSION = /[{}*?\[\]]/;

// Any whitespace character that is not a plain space or tab, anywhere: bash
// does not split words on these, so the splitter below must never see one.
const ODD_WHITESPACE = /[^\S \t]/;

// A backslash immediately before a quote, anywhere: the shell and the word
// splitter below would read the quote differently.
const ESCAPED_QUOTE = /\\["']/;

// Environment variables that make the granted child load or resolve code the
// command line never names. All three are node's own: NODE_OPTIONS carries
// --require and --import, NODE_PATH steers module resolution, and
// NODE_REPL_EXTERNAL_MODULE names a module node preloads. The child inherits
// this hook's environment, so any of them being set at all refuses the grant.
//
// No variable of the kit's belongs here. No granted memq path loads code out of
// a named directory. The authoring verbs add-type and add-operator, at their
// write-time neighbours check, and decay-scan, at its neighbour-pairs block
// after the drift block, require scripts/memory-index.js for its text composer
// alone (embedText), and neither calls the loader that would require an
// embedder package out of KIT_EMBEDDER_ROOT; find makes no such require, its
// search by meaning being the memory database's. The set is pinned whole,
// callers included, by the closure assertion in test/memq-grant.test.js, which
// is where a new path shows up rather than in this sentence. find is withheld
// by the argument screen below, an open decision now that it makes no such
// load. The authoring verbs and the scan are granted, and both stand their
// check down whenever KIT_MEMORY_ROOT or KIT_EMBEDDER_ROOT is present, one
// stand-down they share, read in the child rather than here.
// The other root this repo gates the same way, KIT_PLUGINS_ROOT, selects which
// memq a shim resolves; it is absent for its own reason, that the grant names
// this script by absolute path and the child loads no shim.
const PRELOAD_ENV = ['NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE'];

// The verbs a prompt-free allow covers, which is memq's own subcommand list
// minus the twelve this grant does not extend to. memq dispatches log, find,
// get, recall, judged, recent, unstamped, touch, anchor, triggers, add-type,
// add-operator, put, forget, delete-type, delete-operator, decay-scan,
// decay-prune, decay-done, db-sync, db-refresh, db-promote, db-curate,
// jev-calibration and meter-drain, and the twelve absent here are the two
// shared-tier deletes, find, anchor, triggers, db-sync, db-refresh,
// db-promote, db-curate, jev-calibration, forget and meter-drain.
//
// anchor is the fourth, and it is withheld on what it authors rather than on
// what it destroys: it rewrites a record of the project tier in place, at a
// name the command line gives it. What the rewritten line buys is a claim
// about which files the memory is about and at which bytes, so a worker could
// re-anchor a record onto whatever the tree holds now and every drift surface
// would then report that memory as verified when nobody read it. The CLI has
// no second refusal for the verb, since it is the operator's own, so this
// screen is the only one.
//
// triggers is the fifth and is withheld on a wider account, at the record's
// other half: it rewrites a record of any tier in place, the type and operator
// tiers included, and the line it writes is what decides when that memory is
// put in front of a session. A worker could aim a record's recognition at
// whatever it liked, or crowd the line to the entry cap so the triggers the
// operator wrote go unread, with nothing on any surface saying the declaration
// changed. Its --replace reaches further than either: it states the line
// whole, so a run naming a single entry takes every other declaration off the
// record and one naming none takes the line away, which is erasure rather than
// aiming and leaves the record with no recognition at all. The tier flags are
// what make the blast radius wider than anchor's: the same rewrite on a
// machine-wide tier aims or erases recognition for every project on the box
// and every machine the store syncs to, rather than for the one project a
// worker was pointed at. The --confirm-shared the CLI asks for that replace is
// no second lock, being a flag rather than a person on this vector. What does
// stand behind this screen, for that one shape alone, is memq's own refusal of
// a replace reaching a shared tier or a pinned project store under the store
// signals; the aiming half of the verb and its unpinned project-tier replace
// have no such refusal, for anchor's reason, so for those this screen is again
// the only one.
//
// db-sync is the sixth, and it is withheld on what it would do here, which is
// nothing. The verb publishes the store to the shared SQL Server index, and it
// refuses to run at all unless the store it walks is the machine's own at the
// home directory, because a publish presents that store's credential whatever
// store the walk read. This grant fires only where the fleet-store signals are
// set, and under exactly those signals memq's store root is the override rather
// than the home directory, so a granted db-sync stands down before it reads a
// record. Granting it would put a line on a permission surface authorizing an
// act that cannot happen on this vector, which is a line a later audit has to
// work out and nothing gains from. The same refusal is why no granted verb
// writes the shared index's queue here: log, get and touch each offer their
// stamp to that queue, and the client declines it under exactly these signals,
// for the same reason and in the same one place.
//
// db-refresh is withheld beside db-sync and on its account: it drains the
// queue and adopts the working directory's folder store into its remote key,
// which is this machine's own maintenance of the memory database and nothing
// a fleet worker's task asks for. A worker's own writes drain the queue ahead
// of themselves, so withholding the verb costs it nothing.
//
// meter-drain is withheld on the same account: it sends this machine's meter
// folder to the memory database, and the persona plugin's own timer runs it
// as a process of its own, never through a worker's shell, so no fleet
// worker's task asks for it.
//
// db-promote and db-curate are the seventh and eighth, and they are withheld
// on whose act they are. Both run under the curator login alone, the one
// principal that reads across every sandbox's rows, and a promote is the one
// act that turns a private project lesson into a row every sandbox reads. That
// is the operator's own judgment about what the fleet should learn, and a
// worker granted it could publish whatever its project store holds to every
// other box with nothing on any surface saying a curator chose it. The host
// refuses both verbs to a publisher login on its own account, but the curator
// pair sits in the same config file the publisher pair does, so on a machine
// that holds one the CLI has no second refusal, and this screen is the only
// one. The curation lists are withheld with the promote because they are the
// same role's reading and are of no use to a worker: a fleet worker curates
// nothing.
//
// jev-calibration is the ninth, and it is withheld on whose reading it is. It
// counts, across every sandbox, how often a pointer the judged fleet block
// showed was read, which is the operator's evidence for the judge's floors and
// something no unattended worker acts on.
//
// forget is the tenth, and it is withheld on what it destroys: it marks a
// project-tier record's row deleted in the memory database, taking it out of
// every read, and nothing in memq takes the mark back off. memq carries no store-signal refusal for it,
// since under those signals a pin names the project store it resolves, so this
// screen is its only lock on this vector.
//
// recall-candidates is granted on judged's and recall's shape: a read through
// a publisher procedure with typed parameters, a path accepted only as match
// text, and no write.
//
// applied is granted on recall-candidates' account: a read through a typed
// procedure that names records by their own names, opens no path, and writes
// nothing.
//
// An allowlist rather than a denylist, because the two fail in opposite
// directions: a verb added to the CLI later is not covered until this list
// learns it, where a denylist would cover it the day it lands and say nothing.
// Of the shapes this grant withholds, find has no second lock in the CLI, so
// a new verb that loads code or reads a caller-named path would arrive with
// no layer refusing it at all. The cost is availability, and it is the right
// direction for a grant surface: the failure of an allowlist is a fleet
// worker losing a verb nobody has listed yet until this list learns it, and
// on an unattended vector a lost capability is recoverable by editing this
// list where an over-grant is not recoverable at all.
const GRANTED_VERBS = new Set(['log', 'get', 'applied', 'recall', 'recall-candidates', 'judged', 'recent', 'unstamped', 'touch',
    'add-type', 'add-operator', 'put', 'decay-scan', 'decay-prune', 'decay-done']);

// Shell words of a metacharacter-clean command: space and tab split, a quoted
// span joins onto the current word the way the shell joins it ("a"b is one
// word ab). Null for the spellings where this splitter and the shell diverge:
// an unterminated quote, a backslash outside a quoted span, an unquoted word
// starting with # (a comment to bash, words to this splitter), an unquoted
// expansion character, and an unquoted tilde opening a word, where bash would
// hand the child either a different list of words than this one or a
// different word.
//
// The tilde is refused here, inside the splitter, because its significance is
// positional and a finished word no longer records where its characters came
// from. Bash expands a tilde only as a word's first character and only
// unquoted, substituting the caller's own HOME before the child is executed,
// and every screen past this point is a content test over the word list:
// HOME=delete-type turns a bare ~ into the delete verb, in a list where each
// of those screens has already passed. A tilde anywhere else in a word is
// literal, and admitting it is what keeps this splitter's word equal to the
// shell's: bash leaves a:~/y, --f=~/x and /a/~/b exactly as they are, so
// refusing one here would withhold the grant over a word nothing rewrites.
// (A Windows 8.3 short path such as C:\\Users\\ACCOUN~1\\... is one such word,
// though it is not one the grant covers: the target is judged by
// path.resolve equality with no realpathSync anywhere, so an 8.3 spelling of
// the script path is refused at the path check like any other spelling that
// is not the resolved one.) A tilde reached through a quoted span
// is literal wherever it sits, which is what "~/.claude is the store root"
// is: a description, not a path.
//
// One word shape is not literal and is admitted anyway: bash also expands a
// tilde after the = of an assignment-shaped word and after each : within
// one, so FOO=~ reaches the child as FOO=/home/you and A=x:~ as
// A=x:/home/you. An assignment-shaped word begins with an identifier
// character, and the expansion keeps everything before the tilde, so such a
// word can become neither the verb word, which is judged whole against the
// allowlist, nor one of the screened flags (--body-file, --update, --body,
// --supersedes, --trigger, --rollup, --drop-malformed, --type=), each matched
// whole or up to an = and so opening with a hyphen where an assignment-shaped
// word opens with an identifier character, nor the script path, which is
// matched by path equality. What it can become is a longer argument of
// memq's own, which memq validates. A screen that ever matched a word's
// interior rather than the whole of it would have to revisit this.
function words(cmd) {
    const out = [];
    let cur = null;
    for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i];
        if (c === '"' || c === "'") {
            const close = cmd.indexOf(c, i + 1);
            if (close < 0) return null;
            cur = (cur === null ? '' : cur) + cmd.slice(i + 1, close);
            i = close;
            continue;
        }
        if (c === '\\') return null;
        if (c === '#' && cur === null) return null;
        if (c === '~' && cur === null) return null;
        if (EXPANSION.test(c)) return null;
        if (c === ' ' || c === '\t') {
            if (cur !== null) { out.push(cur); cur = null; }
            continue;
        }
        cur = (cur === null ? '' : cur) + c;
    }
    if (cur !== null) out.push(cur);
    return out;
}

// Normalized path equality. path.relative applies the platform's own case
// rule, so on Windows a different-case spelling of the same file is equal
// (refusing it would break the grant, not narrow it) while on a
// case-sensitive filesystem it is not.
function samePath(a, b) {
    return path.relative(a, b) === '';
}

// Candidate filenames PATH could offer the child's shell as `node`, in the
// order a wrapper would preempt the binary. None of the wrapper spellings can
// realpath-equal the real binary, so one anywhere ahead of it refuses.
const NODE_CANDIDATES = path.sep === '\\'
    ? ['node', 'node.cmd', 'node.bat', 'node.com', 'node.ps1', 'node.exe']
    : ['node'];

// True when the first `node` candidate on PATH is this very interpreter
// (realpath equality with process.execPath). An empty PATH, a realpath
// failure at the winning candidate, or no candidate at all refuses: an
// interpreter this hook cannot positively identify is not one it grants.
//
// What the pin bounds is the PATH lookup, which is one of the channels a
// shell resolves a command name through and the only one visible from
// outside the shell. A name resolved without that lookup is outside it: the
// Bash tool's shell persists across calls, so a function or an alias named
// node, defined by an earlier approved call, preempts PATH entirely, and
// this process sees the environment rather than the shell's own tables. No
// screen available here closes that, which is why the grant is bounded by
// blast radius as well: the one command it can allow is this plugin's own
// CLI, whose withheld verbs and flags hold whatever runs it.
function interpreterIsSelf() {
    const pathVar = process.env.PATH;
    if (!pathVar) return false;
    for (const dir of pathVar.split(path.delimiter)) {
        if (!dir) continue;
        for (const name of NODE_CANDIDATES) {
            const candidate = path.join(dir, name);
            let isFile = false;
            try { isFile = fs.statSync(candidate).isFile(); } catch { /* not here */ }
            if (!isFile) continue;
            try {
                return samePath(fs.realpathSync(candidate), fs.realpathSync(process.execPath));
            } catch {
                return false;
            }
        }
    }
    return false;
}

// Whether a screened flag is among these words, in either spelling a shell
// can hand the child: the flag as its own word, or the flag with a value
// attached after '='. The '=' is part of the match rather than a bare prefix
// test, so --body screens --body= and never some later --bodyguard, and for
// the same reason --body does not screen --body-file: those two are
// independent screens and each answers for its own spellings.
//
// The attached spelling is a working one in this CLI rather than a
// hypothetical, `get --type=<type>` being how a caller names a tier outright,
// and screensValuedFlag below is the screen written for exactly that shape.
// None of the flags this function is asked about parses an attached value in
// memq today, so covering the spelling here is a widening rather than a live
// hole closed: what it buys is that the reason a caller-named path or a
// body-carrying repair gets no prompt-free allow is this hook's own rule
// rather than the next layer's parser, should one of them gain the spelling.
// The widening can only ever refuse more, which is why it needs no audit of
// what the grant still covers: a word this test matches was already a word the
// grant had no business covering.
function screensFlag(argv, flag) {
    return argv.some((word) => word === flag || word.startsWith(flag + '='));
}

// The attached-value spelling alone, for a flag whose bare word means
// something the grant keeps. `--type` by itself resolves the calling project's
// own declared Project-Type and nothing else, which is a read of the tier that
// project already opted into; `--type=<type>` names any tier in the store. So
// what is withheld is the naming of a foreign tier rather than the flag, and a
// screen matching the word whole would take the granted reading with it.
// `--type=` with nothing after it is matched too: it is a whole word here and
// memq refuses it as a type name of its own accord.
function screensValuedFlag(argv, flag) {
    return argv.some((word) => word.startsWith(flag + '='));
}

function grantable(p) {
    if (p.tool_name !== 'Bash') return false;

    const input = p.tool_input || {};
    const cmd = input.command;
    if (typeof cmd !== 'string' || !cmd.trim()) return false;
    if (METACHARACTERS.test(cmd) || CONTROL_BYTE.test(cmd) || ODD_WHITESPACE.test(cmd)
        || ESCAPED_QUOTE.test(cmd)) return false;

    // Cheap pre-screen before the module load: half the signal pair, so it can
    // only refuse what storeSignalsPresent() would refuse. An attended session
    // (no KIT_MEMORY_ROOT) never pays for loading memq on every Bash call.
    if (!process.env.KIT_MEMORY_ROOT) return false;
    try {
        if (!require(MEMQ).storeSignalsPresent()) return false;
    } catch {
        return false;
    }

    for (const name of PRELOAD_ENV) {
        if (process.env[name] !== undefined) return false;
    }

    const w = words(cmd);
    // Three words at least, because the block below reads the interpreter,
    // the script path and the verb by index. A command shorter than that is
    // not the one shape this hook can grant.
    if (w === null || w.length < 3 || w[0] !== 'node') return false;

    const target = w[1];
    // On Windows only a drive-letter-rooted spelling is positively
    // resolvable, and it is taken as written. The /d/... spelling is not
    // converted into one here: the MSYS runtime rewrites such an argument at
    // exec, so what the child receives depends on MSYS_NO_PATHCONV and
    // MSYS2_ARG_CONV_EXCL in the shell that runs the command. Screening those
    // two variables would not settle it, because the Bash tool's shell keeps
    // state across calls and an earlier allowed call can export one into the
    // shell a later granted command runs in, which this process cannot see.
    // Refusing the spelling settles it, and it is the cheapest of these
    // costs: how the script path is spelled is the spawning engine's own
    // choice, so a drive-letter spelling is a requirement on the caller
    // rather than a capability withheld from it. Elsewhere, absolute or
    // nothing.
    if (path.sep === '\\') {
        if (!/^[A-Za-z]:[\\/]/.test(target)) return false;
    } else if (!path.isAbsolute(target)) {
        return false;
    }
    if (!samePath(path.resolve(target), MEMQ)) return false;

    // The grant covers what a fleet worker needs, which is not everything the
    // CLI can do. Eight of the shapes it withholds are ones memq itself also
    // refuses under the store signals, so for those this screen is a second
    // lock: the two shared-tier delete verbs, which take such a record out of every read;
    // an --update carrying a body, which replaces one whole in the memory
    // database, which keeps no earlier version; --replace on
    // add-operator or add-type, which writes a shared record whole over the
    // one the memory database holds; --body-file
    // anywhere, which reads a caller-named path into the store; --supersedes,
    // which demotes and labels a record no pin protects from it;
    // --trigger, which writes at a record's birth the same recognition line
    // the triggers verb below is withheld for; and --type=<type>, which points
    // a read or an applied stamp at any type tier the store holds rather than
    // at the one the calling project declared, the reach the bare --type
    // spelling is granted for, which cmdGet and cmdTouch refuse under those
    // same signals.
    // Five more are withheld here alone, with no second layer behind them:
    // find, withheld pending a decision on granting it now that it loads no
    // embedder; forget, which marks a project-tier record's row deleted; --rollup, which discards prose no copy survives; anchor,
    // which rewrites a project-tier record in place and with it the claim
    // every drift surface reads about which files that memory is still true
    // of; and triggers, which rewrites a record of any tier in place at the
    // half that decides when the memory is put in front of a session, so a
    // worker could aim recognition on a tier every project on the machine
    // reads. One shape of that fourth does have a second lock, which is why
    // the group is named by verb rather than by capability: memq refuses a
    // --replace reaching a shared tier or a pinned project store under the
    // store signals, that being the shape that takes every declaration off a
    // record rather than aiming one, so what is withheld here alone is the
    // aiming and the unpinned project-tier replace. The
    // fourteenth, --drop-malformed, deletes sidecar lines behind one
    // .bak generation; what stands behind its screen is the CLI's requirement
    // that the flag ride --rollup, a coupling rather than a store-signal
    // refusal, so this screen is what keeps the delete withheld if that
    // coupling is ever loosened for ergonomics. None of the fourteen belongs in
    // a prompt-free allow with no operator in the loop, and the five with no
    // second lock are the ones a later edit here would silently free.
    //
    // This screen is the second lock rather than a move of the first: the CLI
    // evaluates those signals in the child process, this hook evaluates them
    // in its own, and where the two disagree the child both skips its refusal
    // and resolves memoryRoot() to the operator's real store, so a caller-named
    // path would be read into the tier that syncs to a private remote.
    // Withholding a grant is silence, not a deny: the command is not blocked
    // here, it simply gets no prompt-free allow. On the unattended vector
    // this hook serves that is the whole of the outcome, since no operator is
    // there to approve what the grant withholds, so each screen below is
    // chosen knowing it costs a fleet worker the command outright. The flags
    // are matched by screensFlag,
    // which answers for the attached-value spelling as well as the whole
    // word, so what this screen withholds does not depend on how the CLI
    // parses --flag=value.
    //
    // The verb is judged against GRANTED_VERBS, so a word this hook has never
    // heard of withholds rather than passing through. find stays off the list,
    // and this hook is its only lock. The reason it was left off no longer
    // holds: find once loaded code out of a directory named outside the command
    // line, scripts/memory-index.js and through it an embedder package under a
    // root that falls back to one inside the caller's own HOME, and its search
    // by meaning is now the memory database's, with no such load. Whether to
    // grant it is an open decision, so it stays withheld until that decision is
    // made. The require of scripts/memory-index.js remains on two granted
    // paths, for its text composer alone, and neither loads an embedder:
    // add-type and add-operator reach it at their write-time neighbours check,
    // and decay-scan at its neighbour-pairs block after the drift block, each
    // stood down in the child on the presence of KIT_MEMORY_ROOT or
    // KIT_EMBEDDER_ROOT rather than by anything this hook screens. The cost of
    // withholding find is deliberate and worth naming: a fleet worker gets no
    // semantic search at all, not a prompt for one. It is affordable because
    // recall is the retrieval path an effort starts from by the memory skill's
    // own design, and recall, get, log, touch and the write verbs are
    // untouched.
    if (!GRANTED_VERBS.has(w[2])) return false;
    if (screensFlag(w, '--body-file')) return false;
    if (screensFlag(w, '--update') && screensFlag(w, '--body')) return false;
    // --replace on the two shared-tier add verbs is the whole-record overwrite
    // of a shared record, the same act the body-carrying --update above is
    // withheld for and under the same account: a fact every project on the
    // machine reads, written over with nobody in the loop. The flag is judged
    // beside the verb word rather than line-wide, because `put --replace`
    // overwrites a project-tier record this grant already lets a worker
    // create, and `triggers --replace` is withheld at the verb word above
    // whatever flags ride with it. memq refuses the shape under the store
    // signals as well, so this is a second lock rather than the only one, for
    // the reason every second lock here states: the two layers read their
    // environment in separate processes.
    if ((w[2] === 'add-operator' || w[2] === 'add-type') && screensFlag(w, '--replace')) return false;
    // --supersedes is withheld on which records it can reach, not on how much
    // it does to one. A pin is the operator's own exemption, and every other
    // way this grant lets a worker push a record down the store's answers
    // stops at one: archiveTargetsValid refuses a pinned name outright, so
    // the granted archive flags cannot touch an exempted record, and the
    // decay pass the scan feeds is bound by the same pin. This flag is not.
    // Its target is any live record of the tier, pinned or not, and what the
    // pointer then buys is a rank demotion in the memory database's search
    // (usp_Search's superseded multiplier) plus a label on every surface that
    // reads the name. So a worker with no
    // operator in the loop could read the pinned population off decay-scan,
    // which is granted and prints it by name, and demote in one further
    // command exactly the records the operator marked as the ones not to
    // touch. Withholding here is what keeps the pin the boundary it is on
    // every other granted path of the CLI. A worker's own file tools write
    // the field by hand without meeting this screen at all, which is the
    // residual the security model records against the destination block
    // rather than one a command screen can close.
    if (screensFlag(w, '--supersedes')) return false;
    // --trigger is the `triggers` verb's capability arriving through a granted
    // one. Both add verbs take it at creation, and the line it writes is the
    // same `triggers:` line that verb splices in afterwards: what decides when
    // a memory is put in front of a session. The verb is withheld above for
    // exactly that reach, and a record born carrying the line reaches it
    // identically, so leaving the flag unscreened would hand back through
    // add-operator the capability the verb list withholds from `triggers`. The
    // tier is what makes the reach the widest of the ones screened here, the
    // verb's own paragraph above owning the reason: a machine-wide record aims
    // recognition for every project on the box and every machine the store
    // syncs to.
    //
    // What the flag does not reach is the verb's other half. A create writes
    // its own new record's line and can neither re-aim a record the operator
    // wrote nor crowd one to the entry cap, so the half withheld here is the
    // aiming rather than the crowding. memq refuses the flag under the store
    // signals for the same reason, which makes this the second lock rather
    // than the only one, and the second lock is worth its place because the
    // two layers read their environment in separate processes: the divergence
    // case is the one where the CLI's own refusal does not fire and
    // memoryRoot() still resolves to the operator's real synced store. The
    // cost is one attended command, the record still landing from a fleet
    // worker with every other field and stderr naming the verb that declares
    // its triggers later.
    if (screensFlag(w, '--trigger')) return false;
    // --rollup is withheld on how much it destroys, not on where the copy
    // goes: it replaces each expired journal group with one synthetic tally
    // line and drops the prose of every entry in that group, which is the
    // shape the delete verbs are withheld for. The granted writes bounded the
    // same way are bounded far tighter: a description-only --update rewrites
    // one index line and leaves the record it describes untouched, and
    // archiving is demotion, refused against a pinned record, with the record
    // still readable by name afterwards. What bounds it is that pair, the
    // reversibility and the pin, rather than the demotion class alone: a
    // demotion no pin can stop is not bounded by this comparison, which is
    // why --supersedes is screened above rather than read as archiving's
    // lighter cousin. So a bare decay-prune and the archive flags stay
    // granted.
    //
    // The cost is real and deliberate: the kit's own close-out runs
    // decay-prune --rollup, and a fleet worker reaching that step loses the
    // rollup with nothing to prompt and nobody to approve it. What that costs
    // is growth in a journal an attended session compacts later, against a
    // prompt-free allow for the one operation in this CLI that discards prose
    // outright.
    if (screensFlag(w, '--rollup')) return false;
    // --drop-malformed is withheld as the delete it is: it removes lines
    // from a usage sidecar with one .bak generation behind them, on all
    // three tiers of the invocation at once. The CLI couples it to
    // --rollup, which the screen above already withholds, so today no
    // granted command could reach it; this screen is its own lock rather
    // than a restatement of that coupling, because the verb layer here is
    // an allowlist while the flags are a denylist, and a destructive flag
    // whose only bar is an ergonomic coupling in another file is one a
    // later decoupling would silently free with nothing here saying so.
    if (screensFlag(w, '--drop-malformed')) return false;
    // --type=<type> is withheld on which tier it reaches, not on what it does
    // there. `get`, `applied` and `touch` are granted verbs that take it, so
    // a fleet worker runs them
    // with nobody in the loop, and the bare --type spelling they were granted
    // with resolves one tier only: the one the calling project's own index
    // declares, which is that project's own opt-in. The attached spelling
    // names any type tier the store holds. `get --type=<x>` reads an arbitrary
    // type-tier body into an unattended model's context and stamps the read
    // clock of a tier the project never opted into, and
    // `touch --applied --type=<x>` writes an applied stamp there, which the
    // decay pass reads as a sign of life and which no attended session put
    // there. So what this withholds is the naming of a foreign tier rather
    // than the flag: bare --type keeps its grant on both verbs, and the
    // invariant kept is the one the store held before the spelling existed,
    // that a stamp cannot land in a type the project has not opted into. Both
    // verbs refuse the spelling under those same signals, so this screen is a
    // second lock rather than the only one, and it is the half that binds
    // where the hook and the child read their environments differently; the
    // `triggers` verb that shares the spelling is withheld at the verb word
    // above, whichever way its tier is named.
    if (screensValuedFlag(w, '--type')) return false;

    // Last, because it stats the filesystem: only a command that already
    // matches everything else pays for the PATH walk.
    return interpreterIsSelf();
}

function main() {
    let p;
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; } // no decision
    if (!grantable(p)) return;                                     // no decision
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'kit memq CLI: one node invocation of this plugin\'s own '
                + 'scripts/memq.js, metacharacter-free, under the gated fleet memory store'
        }
    }) + '\n');
}

try { main(); } catch { /* any failure: no decision */ }
// Zero without process.exit(): the grant is a single stdout write the engine
// depends on (a truncated write reads as no decision and the worker loses
// memq), and forcing the exit can discard a write still in flight on a pipe.
// Nothing above sets a nonzero code, and main() is wrapped, so the process
// ends at 0 once stdout has drained.
process.exitCode = 0;
