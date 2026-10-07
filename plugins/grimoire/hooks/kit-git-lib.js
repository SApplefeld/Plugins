// Shared git runner for the kit's hooks. Every git invocation a hook makes runs
// through here, so the two properties that make a naive spawn unsafe are closed
// in one place instead of at each call site.
//
// The spawn's working directory is this file's own directory, never the
// repository being asked about. On Windows a bare command name is resolved
// against the spawn's working directory BEFORE the system PATH, unless the
// spawning process carries NoDefaultCurrentDirectoryInExePath, which a session
// launched from a shortcut, from PowerShell, or from Windows Terminal does not.
// An MSYS2 shell such as Git Bash does set it, which is why a probe run from one
// comes back clean and the clean reading is the shell rather than the code. A
// repository
// carrying a file named git.exe therefore runs its own binary the moment a hook
// asks that directory a question, and the kit's SessionStart hooks fire
// unattended on startup, resume and compaction in whatever directory the
// session opened, including a clone of a repository nobody has read. The
// hooks directory closes that route without inventing a new trust assumption:
// anyone able to write there already controls the code being run. An unset
// working directory does not close it, because a hook process's own working
// directory is the project directory.
//
// The child environment carries no GIT_* variable. GIT_DIR, GIT_WORK_TREE and
// GIT_COMMON_DIR make git answer about a repository other than the one named,
// and GIT_CONFIG_GLOBAL and its siblings make it read an attacker-supplied
// config, so an ambient environment (a session started from a repo-carried
// terminal profile) would otherwise decide what a hook reports. The strip is
// wholesale and case-insensitive, since Windows environment keys are not the
// casing a plain-object copy is indexed by, and GIT_TERMINAL_PROMPT is set
// after it so no invocation can block a session on a credential prompt. The
// only GIT_* names the child carries are the guard's own: the prompt refusal
// and the environment-config pins that hold core.fsmonitor and core.hooksPath
// inert. Those two pins close two named routes by which a repository nobody
// has vetted runs its own code on a read; the class is wider than the two,
// and gitChildEnv's comment names what stays open.
//
// The boundary is shared rather than per-caller because an unexported one is
// the fix the next author reimplements by not implementing it: both properties
// belong to the channel every hook's git calls run through, not to the one
// caller that first needed them.
//
// Node core modules only, CommonJS, zero dependencies. Nothing here throws: git
// absent, a spawn error, a nonzero exit, or a run past the timeout all degrade
// to a null or to a status the caller reads, matching kit-plan-lib.js.

'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

// Bound on one git call when the caller names none. Every caller here blocks
// something a session is waiting on, so a wedged git is a bounded cost rather
// than a hang.
const DEFAULT_TIMEOUT_MS = 4000;

// Ceiling on what one call may return, which is Node's own spawnSync default
// stated rather than inherited: output past it kills the child and the call
// reads as a failure, so no repository can make a hook hold an unbounded
// buffer.
const MAX_OUTPUT_BYTES = 1024 * 1024;

// The environment a git child runs under: this process's environment with every
// GIT_* key removed case-insensitively, plus the terminal-prompt refusal and
// the two config pins below. None of the stripped variables is needed, since
// every call below passes `-C <repoDir>` to name the repository it means.
//
// core.fsmonitor and core.hooksPath are ordinary repo-local keys git honours,
// so a status against a wrong or planted repository runs its fsmonitor
// program and a commit runs its hooks, and the hooks here ask exactly those
// questions of whatever directory a session opened in. Both are pinned inert
// through git's environment-config channel, which beats repo-local config. The
// pins are additive rather than a suppression of the config files: pointing
// GIT_CONFIG_GLOBAL at an empty file would also drop safe.directory, whose
// absence surfaces as a dubious-ownership refusal that reads like a permissions
// bug. fsmonitor takes git's own disable value rather than an empty string,
// because a Windows process environment cannot hold an empty value and a
// GIT_CONFIG_VALUE_<i> absent while GIT_CONFIG_COUNT names it is a fatal parse
// error on every call. hooksPath names a fresh path under the temp directory
// that nothing creates, so git finds no hooks to run. Both are set after the
// strip, so an ambient GIT_CONFIG_COUNT cannot displace them. The channel
// exists in git 2.31 and later; an older git ignores it silently and this
// guard degrades to the strip alone, with nothing here to say so.
//
// Two keys are pinned by name, and the class they belong to is not closed:
// any key git documents as a command or program, and any remote URL scheme or
// helper a remote's config selects, also makes git run a command on the verbs
// the hooks use. The one write-shaped verb here is branch-reaper-nudge's
// fetch against whatever repository a session opened, where a repo-local
// core.sshCommand, credential.helper or upload-pack setting runs under these
// pins exactly as before them. So the coverage is the two named members
// rather than the class. The hooksPath pin also reaches an operator's global
// hooks, since the environment channel cannot tell a repo-local hooksPath
// from a global one; on the read verbs here that costs nothing. HOME and
// XDG_CONFIG_HOME are not stripped, since git needs HOME for its legitimate
// config, so they still select the global config every guarded call reads;
// docs/security-model.md carries that residual.
//
// The same two pins are spelled again in Invoke-MemorySyncGit
// (doctor/install-memory-sync.ps1), which guards the sync script's own git
// calls. Neither language can call the other's, so the protections are
// restated there rather than shared.
function gitChildEnv() {
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
        if (/^GIT_/i.test(k)) delete env[k];
    }
    env.GIT_TERMINAL_PROMPT = '0';
    // Defence in depth for anything git itself spawns through a shell (an
    // alias, a credential helper): cmd.exe reads this variable from its own
    // environment and then resolves a bare command name against PATH alone.
    // The spawn working directory above is what closes the route for the git
    // call itself; this closes it one level down.
    env.NoDefaultCurrentDirectoryInExePath = '1';
    env.GIT_CONFIG_COUNT = '2';
    env.GIT_CONFIG_KEY_0 = 'core.fsmonitor';
    env.GIT_CONFIG_VALUE_0 = 'false';
    env.GIT_CONFIG_KEY_1 = 'core.hooksPath';
    env.GIT_CONFIG_VALUE_1 = path.join(os.tmpdir(), 'kit-git-no-hooks-' + crypto.randomUUID());
    return env;
}

// Run git against repoDir and return { status, stdout } for a process that ran
// to completion, whatever its exit code, or null when it did not run at all:
// git absent, a spawn error, a kill past the timeout, or arguments that are not
// a string array. The exit code is part of the result because a git exit code
// is an answer to some callers (`merge-base --is-ancestor` spells three
// distinct outcomes as 0, 1 and anything else), and collapsing it would make
// those callers reimplement the spawn to get it back.
//
// args is an array and never a command string: nothing here runs a shell, so no
// value a repository supplies can be read as a command.
function gitRun(repoDir, args, options) {
    if (typeof repoDir !== 'string' || repoDir === '') return null;
    if (!Array.isArray(args)) return null;
    for (const a of args) {
        if (typeof a !== 'string') return null;
    }
    const opts = options || {};
    const timeout = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    let res;
    try {
        res = spawnSync('git', ['-C', repoDir].concat(args), {
            cwd: __dirname,
            encoding: 'utf8',
            timeout,
            maxBuffer: MAX_OUTPUT_BYTES,
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
            env: gitChildEnv()
        });
    } catch {
        return null;
    }
    if (!res || res.error || res.signal) return null;
    if (typeof res.status !== 'number' || typeof res.stdout !== 'string') return null;
    return { status: res.status, stdout: res.stdout };
}

// The stdout of a git call that succeeded, or null on any failure, which is the
// shape a caller wants when a question git could not answer is simply silence.
function gitOutput(repoDir, args, options) {
    const res = gitRun(repoDir, args, options);
    return res && res.status === 0 ? res.stdout : null;
}

module.exports = { gitRun, gitOutput, gitChildEnv, DEFAULT_TIMEOUT_MS, MAX_OUTPUT_BYTES };
