#!/usr/bin/env node
// PreToolUse guard: never push to a branch whose PR has already merged.
//
// In Branch-and-PR, once the PR merges the feature branch is frozen: further
// pushes strand off the integration branch with no signal, and the kit's own
// rituals keep writing records (Chapters, decisions, the register) late. This
// blocks a push to a branch with a MERGED pull request and tells the agent to
// open a doc PR against the integration branch instead. Pushed is not merged.
//
// SAFETY: fails OPEN. It blocks only when it positively confirms a MERGED PR for
// the target branch via the host CLI. Anything else (not a push, an integration
// branch, no CLI, not authenticated, no PR, query error, timeout, parse failure)
// exits 0 (allow). A guard that cannot tell never blocks.

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Whether KIT_MERGED_PR_GUARD_NO_DEADLINE applies, and why it does not when it
// does not. Pure, and reading the environment it is handed, so the rules below
// are testable without spawning this hook.
//
// The switch exists for tests: a suite spawns this hook and its faked host CLI
// on a box under parallel load, paying spawn costs a developer's machine never
// does, and a query that overruns fails open, which a test then reads as a
// missing block. Turning the deadline off removes that reading entirely rather
// than betting on a larger number, since no margin is wide enough to be a
// guarantee on a box whose load has no ceiling.
//
// SAFETY: removing a deadline can only remove ETIMEDOUT, every failure path in
// this hook is fail-open, so no value of this switch can stand the guard down
// and the switch can only make it more likely to block.
//
// Both variables take the kit's one override predicate, an exact '1', so a
// reviewer checks the same property here as at every other kit override rather
// than re-deriving a per-variable argument. Any other value is not a request:
// NO_DEADLINE=0 asks for nothing and is reported as nothing.
function budgetOverride(env) {
    const e = env || process.env;
    if (e.KIT_MERGED_PR_GUARD_NO_DEADLINE !== '1') return { off: false, reason: 'unset' };
    if (e.KIT_MERGED_PR_GUARD_NO_DEADLINE_ALLOW !== '1') return { off: false, reason: 'unsignalled' };
    return { off: true, reason: 'honored' };
}

// The timeout one query runs under, with the reason the switch gave.
//
// Unhonored that is the caller's own value, or 8000 ms: a guard that cannot
// answer quickly must never hang a push, and a query that overruns fails open
// like any other failure. A guarded push runs up to four queries
// (3000 + 3000 + 3000 + 8000), so its worst case is 17 seconds.
//
// Honored it is 0, which is how Node's child_process spells no deadline: an
// execSync given timeout 0 waits as long as the command takes, byte-identical
// to omitting the option.
//
// The reason is returned rather than latched here, so this function is pure and
// callable from a test without leaving anything behind in the calling process.
// The one caller that runs inside the hook does the latching.
function queryBudgetMs(timeout, env) {
    const o = budgetOverride(env);
    return { ms: o.off ? 0 : (timeout || 8000), reason: o.reason };
}

// Whether an ignored switch is owed a note. The note is written on the allow
// path only (the runner at the foot of this file), never alongside the denial
// reason a PreToolUse exit 2 feeds back to the model, which is a channel for
// the decision and not for this hook's diagnostics.
let ungatedOverrideOwed = false;

// The note for a switch that was set without its signal, written once and only
// where the caller asks for it. Best-effort, like every diagnostic write the
// hooks make: a failed write must not cost the decision it rides beside.
// It goes out through a synchronous write to fd 2 rather than through
// process.stderr, whose write to a pipe is asynchronous and can be dropped by
// the process.exit() on the next line.
function noteUngatedOverride() {
    if (!ungatedOverrideOwed) return;
    ungatedOverrideOwed = false;
    try {
        fs.writeSync(2, 'merged-pr-push-guard: ignoring KIT_MERGED_PR_GUARD_NO_DEADLINE '
            + '(it is honored only with KIT_MERGED_PR_GUARD_NO_DEADLINE_ALLOW=1)\n');
    } catch { /* the note is best-effort; a failed write changes nothing */ }
}

// The environment a query runs under: this process's, with every GIT_*
// variable removed case-insensitively (Windows env keys are not the casing a
// plain-object copy is indexed by), and the prompt suppressed. A wholesale
// strip, not just GIT_DIR/GIT_WORK_TREE, and for the same reason the memory
// store's git calls take one (gitStoreEnv in memory-session.js): a repo-carried
// GIT_COMMON_DIR or GIT_CONFIG_GLOBAL redirects a git read at another
// repository, and every fact this guard's decision rests on (the branch name,
// the origin URL) comes from a git read. Nothing here needs any of them, since
// every call names the repository it means through its own cwd.
//
// That cwd is the repository under inspection, which is what makes the second
// variable below load-bearing rather than belt and braces. These queries run
// through a shell, and cmd.exe resolves a bare command name against its
// working directory before PATH, so a repository carrying a file named
// git.cmd, gh.cmd or az.cmd is what runs. cmd.exe reads the suppressing
// variable from its own environment, unlike libuv, which reads it from the
// spawning process, so setting it here closes the route for all six queries
// while leaving the shell form the az shim needs. hooks/kit-git-lib.js closes
// the same route the other way, by spawning outside the repository, which is
// available to it because it needs no shell.
function queryEnv() {
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) {
        if (/^GIT_/i.test(k)) delete env[k];
    }
    env.GIT_TERMINAL_PROMPT = '0';
    env.NoDefaultCurrentDirectoryInExePath = '1';
    return env;
}

// Run a shell command and capture stdout. The command strings passed here are
// fixed literals; the only variable, the branch, is allowlisted in prState before
// it is interpolated. That discipline is load-bearing: interpolating any raw
// payload field into one of these strings reopens the command-injection class.
// Each query carries its own budget, exactly as production does: nothing here
// is shared across the four, so a slow git query cannot eat the budget of the
// host query the block decision depends on. This is where the switch's reason
// is latched, so the function deciding the budget stays pure.
function sh(cmd, cwd, timeout) {
    const budget = queryBudgetMs(timeout);
    if (budget.reason === 'unsignalled') ungatedOverrideOwed = true;
    return execSync(cmd, {
        cwd,
        timeout: budget.ms,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        env: queryEnv()
    });
}

// The arguments of the `git push` in a command string, or null when it holds
// none to guard. The returned text is that one command's operands and stops
// where the command does.
//
// A command begins at the start of the string or just after a shell separator,
// redirect, subshell opener, backtick, or line break, optionally behind one or
// more NAME=value assignment prefixes (`GIT_SSH_COMMAND="ssh -i k" git push`
// is command position in every POSIX shell), and it ends at the next separator.
// The cut set extends readonly-agent-guard.js's, whose `segment` cuts on
// /[;|&<>)\n\x01]/: that hook masks substitutions to \x01 sentinels before it
// cuts, so a backtick reaches its cut as a sentinel, while this hook does no
// masking and must cut on the literal backtick itself. The set is replicated
// rather than shared: that hook exports nothing, so sharing would mean building
// an export surface on a second deny guard and loading it on every Bash call,
// and what has to agree between the two is this one-line cut set rather than
// the quote and heredoc masking that surrounds it there.
//
// Every shape in the set matters. A newline ends a command as surely as a
// semicolon, and a two-line Bash call is what a model routinely writes, so
// without it the push on line two is not seen at all. `(` opens a command and
// `)` closes one, so a push in a subshell is neither missed nor allowed to
// swallow what follows, and a backtick does both jobs at once. And a command
// that ends at its own separator is what keeps a later flag, in
// `git push origin x && ls -d`, out of the operands read below.
//
// What the parser catches is exactly a textual `git push` at a command position
// as defined above, and both error directions carry residue. Quoted text is not
// masked, so a separator inside a quoted argument still opens a command
// position and prose like `echo "x; git push origin b"` is read as a push:
// over-detection, a needless query and at worst a needless block. The missed
// direction's residue is the class of pushes the shell reaches through a layer
// this parser does not model: a quoted string later executed as code, a
// backslash-newline continuation between `git` and `push`, an interposed runner
// (`echo b | xargs git push origin`), an alias or shell function; and within
// one compound command only the first command-position push is guarded. Each of
// those is a known, deliberately unfixed gap: closing the class means modeling
// the shell, which is readonly-agent-guard.js's job, not this one's.
function pushArgs(cmd) {
    const c = String(cmd || '');
    const re = /\bgit\s+push\b/g;
    let m;
    while ((m = re.exec(c)) !== null) {
        // Everything from the previous boundary to the match must be blank or
        // NAME=value assignment prefixes (values unquoted, single-quoted, or
        // double-quoted), or this `git push` is an operand of some other
        // command rather than a command of its own.
        if (!/(?:^|[;|&<>()`\n\x01])[ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|[^\s;|&<>()`'"\x01])*[ \t]+)*$/.test(c.slice(0, m.index))) continue;
        const rest = c.slice(m.index + m[0].length);
        const cut = rest.search(/[;|&<>)`\n\x01]/);
        return (cut < 0 ? rest : rest.slice(0, cut)).trim();
    }
    return null;
}

// The branch a `git push` targets, or null if this is not a push to guard.
function targetBranch(cmd, cwd) {
    const after = pushArgs(cmd);
    if (after === null) return null;
    // A branch deletion (git push --delete / -d, or a `:branch` / `+:branch` refspec)
    // removes a merged branch: correct cleanup, the inverse of stranding. Never guard it.
    if (/(?:^|\s)(?:--delete|-d)\b/.test(after)) return null;
    const toks = after.split(/\s+/).filter((t) => t && !t.startsWith('-'));
    // toks[0] = remote (if present), toks[1] = refspec (if present).
    let ref = toks.length >= 2 ? toks[1] : null;
    let branch = null;
    if (ref) {
        // Normalize the refspec token before parsing: drop a wrapping quote pair,
        // then a leading + (force-push marker). A quoted or forced ref then reaches
        // the allowlist as its plain name, and +:dst collapses to the :dst deletion
        // form recognized below.
        ref = ref.replace(/^(['"])(.*)\1$/, '$2');
        ref = ref.replace(/^\+/, '');
        if (ref.includes(':')) {
            const parts = ref.split(':');
            if (parts[0] === '' || parts[0] === '+') return null; // :dst or +:dst = deletion
            ref = parts[parts.length - 1]; // src:dst -> dst
        }
        branch = ref;
    }
    if (!branch || branch === 'HEAD') {
        try { branch = sh('git rev-parse --abbrev-ref HEAD', cwd, 3000).trim(); } catch { return null; }
    }
    return branch || null;
}

// The repo's configured default branch (origin/HEAD), or null when unset. This
// joins the integration-branch exemption so a repo whose default carries a
// non-standard name (trunk, release) is treated like develop/main/master.
function defaultBranch(cwd) {
    try {
        const head = sh('git symbolic-ref --quiet refs/remotes/origin/HEAD', cwd, 3000).trim();
        return head.replace(/^refs\/remotes\/origin\//, '') || null;
    } catch { return null; }
}

// MERGED | OPEN | UNKNOWN, by asking the host. UNKNOWN on any failure (fail-open).
function prState(branch, cwd) {
    // The branch is parsed from the model's own push command and interpolated into
    // the host CLI strings below, so it must pass a strict allowlist before any host
    // query: letters, digits, dot, underscore, slash, hyphen, and never a leading
    // hyphen. A branch that fails cannot be told apart from an injection attempt, so
    // it is UNKNOWN (allow). az resolves to a .cmd shim on Windows and Node's
    // execFileSync cannot spawn a .cmd without a shell, so validating the branch,
    // not an arg-array exec, is what closes the injection path here; the host calls
    // keep the execSync string form.
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(branch)) return 'UNKNOWN';

    let host = '';
    try { host = sh('git remote get-url origin', cwd, 3000).trim(); } catch { return 'UNKNOWN'; }
    try {
        if (/github\.com/i.test(host)) {
            const s = sh(`gh pr view ${branch} --json state -q .state`, cwd).trim().toUpperCase();
            if (s === 'MERGED') return 'MERGED';
            return s ? 'OPEN' : 'UNKNOWN';
        }
        if (/dev\.azure\.com|visualstudio\.com/i.test(host)) {
            const out = sh(`az repos pr list --source-branch refs/heads/${branch} --status completed -o tsv`, cwd).trim();
            return out ? 'MERGED' : 'OPEN';
        }
    } catch {
        return 'UNKNOWN';
    }
    return 'UNKNOWN';
}

function main() {
    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; }
    const cwd = p.cwd || process.cwd();
    const input = p.tool_input || p.toolInput || (p.tool && p.tool.input) || {};

    const branch = targetBranch(input.command, cwd);
    if (!branch) return;                                   // not a guarded push
    if (/^(develop|main|master)$/i.test(branch)) return;   // integration branches
    const def = defaultBranch(cwd);
    if (def && branch.toLowerCase() === def.toLowerCase()) return; // configured default branch

    if (prState(branch, cwd) !== 'MERGED') return;         // open / unknown: allow

    process.stderr.write(
        `Blocked: the PR for branch "${branch}" has already merged, so this push would strand off the ` +
        `integration branch. The branch is frozen (pushed is not merged). Put any post-merge record in a ` +
        `new doc PR against the integration branch instead of pushing here.\n`
    );
    process.exit(2);
}

// Run as the PreToolUse hook only when invoked directly, so a require() of this
// file (the test suite reads the budget rules through it) can never guard a
// push, write to stderr, or exit the requiring process as a side effect.
if (require.main === module) {
    try { main(); } catch { /* fail open */ }
    // main() exits the process itself on the block path, so reaching this line
    // is an allow, which is the only place an ignored override is reported.
    noteUngatedOverride();
    process.exit(0);
}

module.exports = { budgetOverride, queryBudgetMs, pushArgs, queryEnv };
