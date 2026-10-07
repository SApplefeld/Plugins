#!/usr/bin/env node
// PreToolUse guard: docs must be committed before the PR.
//
// In Branch-and-PR and Commit-and-Push efforts the documentation work (drift
// curation, plan archival, backlog prune, index refresh) must ship in the same
// PR as the code, not as a follow-up. Where neither author can release their own
// PR, a separate docs PR is a governance dead-end, so this blocks creating the
// PR while docs/ still has uncommitted changes. The finishing-work gate routes;
// this is the teeth.
//
// Fires on Bash. Acts only on a PR-creation command (gh pr create,
// az repos pr create). A chain that runs git commit ahead of the PR create
// (git commit ... && gh pr create) is allowed: the command commits the docs
// itself, so the pre-execution dirty check would false-positive on it.
// Distinct from docs-write-guard.js: that scopes to
// non-curator subagents writing docs/; this applies to anyone opening the PR.
//
// Multi-checkout awareness: the docs check runs where the PR create actually
// runs, not blindly at the payload cwd. A cd/pushd/Set-Location ahead of the
// PR create in the command moves the check to that directory (a target that
// cannot be resolved allows: the effective directory is then unknowable). And
// dirty docs at a checkout parked on the repo's default branch, or on a
// detached HEAD, never deny: no PR can originate from such a checkout (gh
// rejects default-onto-default and detached HEAD has no branch to PR), so the
// dirt there is another checkout's in-flight work, not this PR's docs.
// Residual hole (fail-open posture): a payload cwd that points at the wrong
// checkout which is dirty AND parked on a non-default branch still denies.
//
// SAFETY: fails OPEN. Any error (no cwd, git missing, not a repo, timeout, parse
// failure) exits 0 (allow). It exits 2 (deny) only when it positively confirms a
// PR-creation command with uncommitted docs/ changes attributable to the
// checkout the PR is created from.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Index of the first PR-creation command (gh pr create, az repos pr create) in
// the string, or -1 if none.
function prCreateIndex(cmd) {
    const c = String(cmd || '');
    const matches = [/\bgh\s+pr\s+create\b/i.exec(c), /\baz\s+repos\s+pr\s+create\b/i.exec(c)]
        .filter(Boolean)
        .map(m => m.index);
    return matches.length ? Math.min(...matches) : -1;
}

// True if a git commit appears before position `end` in the command string. A
// chain that commits ahead of the PR create (git commit ... && gh pr create)
// commits the docs itself, so the pre-execution dirty check would be a false
// positive; such chains are allowed. Fail-open tradeoff: a chained commit whose
// pathspec excludes docs/ also passes.
function commitsBefore(cmd, end) {
    const m = /\bgit\s+commit\b/i.exec(String(cmd || ''));
    return m !== null && m.index < end;
}

// The quoted-or-bare target of the last cd/pushd/Set-Location that appears
// before position `end` in the command string, or null when the command never
// switches directory ahead of the PR create. Match-index discipline mirrors
// commitsBefore: a "cd" inside the PR title or body sits after the pr-create
// match and cannot reach here.
function lastPathSwitchBefore(cmd, end) {
    const re = /(?:^|[\s;&|(])(?:cd|pushd|Set-Location)\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/gi;
    const c = String(cmd || '');
    let target = null;
    let m;
    while ((m = re.exec(c)) !== null) {
        if (m.index >= end) break;
        target = m[1];
    }
    return target;
}

// Directory the PR create actually runs in: the last path switch ahead of it,
// resolved against the payload cwd, else the payload cwd itself. Returns null
// when a switch exists but its target is not a resolvable directory (a shell
// variable, a typo) - the effective directory is then unknowable, so the
// caller allows.
function effectiveDir(cmd, prAt, cwd) {
    const target = lastPathSwitchBefore(cmd, prAt);
    if (target === null) return cwd;
    const bare = target.replace(/^["']|["']$/g, '');
    if (!bare || bare.startsWith('-')) return null;
    try {
        const resolved = path.resolve(cwd, bare);
        return fs.statSync(resolved).isDirectory() ? resolved : null;
    } catch {
        return null;
    }
}

function git(cmd, cwd) {
    return execSync(cmd, {
        cwd,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
    });
}

// True if docs/ has uncommitted or untracked changes vs HEAD; null if we cannot
// tell (git failed, not a repo), which the caller treats as allow (fail open).
function docsDirty(cwd) {
    try {
        return git('git status --porcelain -- docs', cwd).trim().length > 0;
    } catch {
        return null;
    }
}

// Branch checked out at cwd; null on detached HEAD or when git cannot tell.
function currentBranch(cwd) {
    try {
        return git('git symbolic-ref --quiet --short HEAD', cwd).trim() || null;
    } catch {
        return null;
    }
}

// The repo's configured default branch (origin/HEAD); null when unconfigured.
function defaultBranch(cwd) {
    try {
        const head = git('git symbolic-ref --quiet refs/remotes/origin/HEAD', cwd).trim();
        return head.replace(/^refs\/remotes\/origin\//, '') || null;
    } catch {
        return null;
    }
}

function main() {
    let p = {};
    try { p = JSON.parse(readStdin() || '{}'); } catch { return; } // parse fail: allow

    const input = p.tool_input || p.toolInput || (p.tool && p.tool.input) || {};
    const cmd = input.command;
    if (!cmd) return;
    const prAt = prCreateIndex(cmd);
    if (prAt < 0) return; // not a PR-creation command: allow
    if (commitsBefore(cmd, prAt)) return; // chain commits before the PR create: allow

    const cwd = p.cwd || process.cwd();
    const dir = effectiveDir(cmd, prAt, cwd);
    if (dir === null) return; // command switches to an unresolvable directory: allow
    const dirty = docsDirty(dir);
    if (dirty !== true) return; // clean, or could not determine: allow

    // Dirty docs at a checkout that cannot originate a PR are another
    // checkout's in-flight work, not this PR's docs. Detached HEAD has no
    // branch to PR; gh rejects a PR of the default branch onto itself.
    const branch = currentBranch(dir);
    if (branch === null) return; // detached HEAD: allow
    const def = defaultBranch(dir);
    if (def !== null && branch === def) return; // parked on the default branch: allow

    process.stderr.write(
        `Blocked: docs/ has uncommitted changes, so this PR would ship without them. The documentation ` +
        `work (curation, plan archival, backlog prune, index refresh) ships in the same PR as the code, ` +
        `never as a follow-up. Commit the docs work into the branch (the finishing-work close-out runs ` +
        `curating-docs), then open the PR.\n`
    );
    process.exit(2); // deny
}

try { main(); } catch { /* fail open */ }
process.exit(0);
