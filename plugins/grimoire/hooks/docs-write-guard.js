#!/usr/bin/env node
// PreToolUse guard: keep non-curator subagents from writing into docs/.
//
// The kit's access model: only a main session (interactive, or the bare
// "claude" agent type a background job runs as) and the docs-curator agent
// curate docs/. Reviewers, qa, and implementers must not write there; their
// reports and scratch belong in .kit/ (gitignored), and the durable record is
// the plan's Chapter. This enforces that invariant mechanically, as the teeth
// under the executing-work routing wording.
//
// Plugin PreToolUse hooks fire for tool calls made inside subagents, and the
// payload carries the subagent identity, so the guard keys on the writer's role
// rather than on report filenames (the orchestrator improvised several docs/
// paths; a role rule does not chase them).
//
// Covers Write/Edit/MultiEdit (exact, by file_path) and shell commands
// (heuristic): a Bash write-redirect/tee into docs/, and a PowerShell Out-File /
// Set-Content / Add-Content / Tee-Object cmdlet targeting docs/. Exotic writes
// (python, sed -i, Copy-Item, a path passed through a variable) are out of reach
// here. Where the personas plugin runs, its documentation check names a review
// scratch file under docs/ in the next turn's context; nothing else backstops.
//
// The tree the guard protects is the session project's own: when the payload
// carries a cwd, a target is resolved and judged by containment against the git
// root above that cwd, so a docs/ segment outside the project (a session
// scratchpad, a fixture repo, a sibling checkout) is structurally out of scope
// rather than incidentally matching. Without a cwd, or for a target that cannot
// be resolved before the shell runs, the shape-only judgment stands.
//
// SAFETY: this hook can BLOCK a tool call, so it fails OPEN. Any parse error,
// unrecognized payload, or inability to positively identify a non-curator
// subagent exits 0 (allow). It exits 2 (deny) only when certain. A guard bug
// must never trap legitimate work.

'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// The shared agent-identity module's exports this guard calls, named so a
// reading added here is screened by being listed rather than by a second
// branch, the same shape readonly-agent-guard.js uses for its own call into
// this library.
const AGENT_LIB_SYMBOLS = [['agentTypeOf', 'function']];

// docs-curator is the one subagent allowed to curate docs/. Match by suffix so a
// plugin-namespaced id (e.g. "grimoire:docs-curator") still resolves.
function isCurator(t) {
    return /(^|[:/])docs-curator$/i.test(t);
}

// A user-launched background session presents as the bare catch-all "claude"
// agent type. It is the main session of its job, not a dispatched subagent, so
// it authors plan docs like any main session. Exact match only: namespaced ids
// ("grimoire:adversarial-reviewer") and named types stay governed. Tradeoff,
// accepted: a deliberately dispatched catch-all "claude" agent shares the type
// and therefore also passes.
function isBackgroundMain(t) {
    return /^claude$/i.test(t);
}

// A filesystem path that points inside a docs/ directory. Absolute or relative,
// Windows or POSIX separators. "mydocs/" does not match (separator required).
function targetsDocs(s) {
    return /(^|[\\/])docs[\\/]/i.test(String(s || ''));
}

// The git root at or above `dir`: the nearest ancestor holding a .git entry, or
// `dir` itself when there is none. Containment is judged against this rather
// than against the payload cwd, so a subagent working from a subdirectory is
// still judged against the whole project tree.
function repoRoot(dir) {
    let cur = dir;
    for (let i = 0; i < 64; i++) {
        try { if (fs.existsSync(path.join(cur, '.git'))) return cur; } catch { return dir; }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }
    return dir;
}

// A target resolved against the directory the write runs in, with the alternate
// spellings of an absolute path normalized first: a \\?\ extended-length prefix
// on a drive path is stripped, and on a Windows host the Git-Bash form
// /<drive>/<rest> becomes <drive>:/<rest>. Null for a path that cannot be
// resolved before the shell runs (a variable, a home-relative path), which the
// caller judges by shape alone.
function resolveTarget(raw, base) {
    let s = String(raw || '').trim().replace(/^["']|["']$/g, '');
    if (!s) return null;
    if (/^\\\\\?\\[A-Za-z]:/.test(s)) s = s.slice(4);
    if (path.sep === '\\' && /^\/[A-Za-z]\//.test(s)) s = `${s[1]}:${s.slice(2)}`;
    if (/[$%`]/.test(s) || s.startsWith('~')) return null;
    try { return path.resolve(base, s); } catch { return null; }
}

// True when a target is a docs/ write in the project tree this guard protects.
// Containment first: with a cwd to place it against, a path resolving outside
// the git root above that cwd is out of scope whatever segments it contains,
// and the shape test runs on the root-relative remainder. Without a cwd, or for
// an unresolvable target, the shape-only judgment is the only evidence
// available, and it stands.
function inGuardedDocs(raw, cwd) {
    if (!cwd) return targetsDocs(raw);
    const resolved = resolveTarget(raw, cwd);
    if (resolved === null) return targetsDocs(raw);
    const rel = path.relative(repoRoot(cwd), resolved);
    if (path.isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) return false;
    return targetsDocs(rel);
}

// The docs/-shaped targets of a shell command's writers. Two heuristics:
//   Bash: a >, >>, tee, or heredoc redirect into docs/ (cat > docs/x <<EOF).
//   PowerShell: an Out-File / Set-Content / Add-Content / Tee-Object cmdlet, in
//   command position, with a docs/ path that is positional or reached across a
//   short bounded run of parameters, including -FilePath / -Path / -LiteralPath
//   joined by a space or a colon (-Path docs/x or -FilePath:docs/x).
// Both require a separator before docs (so "mydocs/" does not match). Each hit
// is returned for the caller's containment judgment rather than being a verdict
// itself. Known misses, backstopped only by the personas plugin's documentation
// check where it runs: non-redirect writers
// (python, sed -i, Copy-Item, a path passed through a variable), and, in the
// other direction, a residual false hit on a cmdlet name sitting in command
// position inside a quoted string (a docs path merely named in prose, e.g. a
// commit message). The command-position anchor keeps an embedded name
// (Reset-Content) from matching.
function commandDocsTargets(cmd) {
    const c = String(cmd || '');
    const out = [];
    const redirect = /(?:>>?|tee(?:\s+-a)?\s)\s*["']?((?:[^\s"'|;&><]*[\\/])?docs[\\/][^\s"';|&><]*)/gi;
    const cmdlet = /(?:^|[\s;|&(])(?:Out-File|Set-Content|Add-Content|Tee-Object)\b\s+(?:-\w+(?::\S+)?(?:\s+(?!-)[^\s"';|&]+)?\s+){0,4}(?:-(?:FilePath|Path|LiteralPath)[:\s]\s*)?["']?((?:[^\s"']*[\\/])?docs[\\/][^\s"';|&]*)/gi;
    let m;
    while ((m = redirect.exec(c)) !== null) out.push(m[1]);
    while ((m = cmdlet.exec(c)) !== null) out.push(m[1]);
    return out;
}

function main() {
    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; } // parse fail: allow

    // The type is read through the shared module rather than a local chain, so
    // a spelling the module gains later reaches this guard too. The require
    // sits inside main under the guard's own fail-open posture: a plugin cache
    // too damaged to supply the module leaves the write allowed rather than
    // ending this process on a require that runs in front of every write.
    //
    // The export is screened before it is called, in the kit's own name-and-kind
    // form, because a cache one version behind or rolled back mid-update can
    // supply a module that requires cleanly while lacking this reading. The
    // screen changes no verdict, since the failure still allows; what it changes
    // is the SILENCE, since calling through an undefined export throws into the
    // file-level catch and every non-curator subagent's docs/ write is then
    // allowed with nothing on either channel to say the guard has stopped
    // judging.
    let lib;
    try {
        lib = require('./kit-agent-identity-lib.js');
    } catch { return; }                // the classifier is unreadable: allow
    const missing = AGENT_LIB_SYMBOLS.filter(([name, kind]) => typeof lib[name] !== kind)
        .map(([name]) => name);
    if (missing.length) {
        process.stderr.write('docs-write-guard: kit-agent-identity-lib.js exports no '
            + missing.join(', ') + ', so this guard cannot classify the agent type and is allowing '
            + 'every write it would otherwise judge; the installed kit is skewed, so reinstall or '
            + 'update it.\n');
        return;                        // the classifier is skewed: allow, out loud
    }

    const t = lib.agentTypeOf(p);
    if (!t) return;                    // main session or undetermined: allow
    if (isBackgroundMain(t)) return;   // background job's main session: allow
    if (isCurator(t)) return;          // docs-curator curates docs/: allow

    const input = p.tool_input || p.toolInput || (p.tool && p.tool.input) || {};
    const fp = input.file_path || input.path;
    const cwd = (typeof p.cwd === 'string' && p.cwd.trim()) ? p.cwd.trim() : null;

    let hit = false;
    if (fp) hit = inGuardedDocs(fp, cwd);
    if (!hit && input.command) {
        hit = commandDocsTargets(input.command).some((t) => inGuardedDocs(t, cwd));
    }
    if (!hit) return;          // not a docs/ write in this project: allow

    process.stderr.write(
        `Blocked: the ${t} subagent may not write into docs/. docs/ holds curated content only ` +
        `(plans and the docs-curator's docs). A report or scratch file goes to .kit/ (gitignored), ` +
        `and the durable record is the plan's Chapter. Write to .kit/ instead, or return the content ` +
        `in your final message.\n`
    );
    process.exit(2);           // deny
}

try { main(); } catch { /* fail open */ }
process.exit(0);
