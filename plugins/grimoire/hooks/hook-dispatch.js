#!/usr/bin/env node
// hook-dispatch.js - one process per tool-call event.
//
// hooks.json wires this file alone on PreToolUse and PostToolUse, as
//     node "${CLAUDE_PLUGIN_ROOT}/hooks/hook-dispatch.js" <event>
// and dispatch-table.json, in hooks.json's own shape, names the hooks each
// event routes to and the matcher each is scoped by. The dispatcher reads the
// payload once, selects the hooks the table matches to the payload's tool, runs
// each unmodified hook file in its own worker thread, and answers the harness
// once with the merged result.
//
// Why threads around unmodified files: a hook launched by the harness costs a
// shell, a second shell, a node process and a console host, and a Bash call
// matches eight of them. A hook's own logic is a few milliseconds; the launch is
// the cost. A worker thread gives a hook its own process.exit, its own
// uncaught-exception boundary and its own module cache, so no guard's file
// changes. What the routed hooks do share is one process: its lifetime, its
// working directory and its descriptor table. The lifetime is the one that
// costs something. Node joins its threads on exit, so a thread blocked inside a
// synchronous call holds the process, and every other hook's verdict, until
// the call returns. The bootstrap bounds the synchronous child calls, which are
// the blocking calls the routed hooks make. A thread blocked in anything else,
// a file call on a dead network path for one, is not bounded by anything here.
//
// Exit codes, which are the harness's own:
//   2  at least one hook blocked. stderr carries the blocking hooks' stderr.
//   0  no hook blocked. stdout carries the merged answer, when there is one.
//   1  a hook failed without blocking and nothing else had anything to say.
//
// A thread that cannot start, or that ends without having written an answer,
// sends its hook through a child process, which is the launch this file
// replaced. KIT_HOOK_DISPATCH=legacy forces that path for every hook. A fault
// in the merge keeps any block the hooks returned and runs nothing twice. A routing table
// that cannot be read falls back to the copy of it held below, so an unusable
// file costs no guard its call. What none of that covers is a native abort,
// which ends the process and every hook in it with a code that does not block.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOOKS_DIR = __dirname;
const TABLE_PATH = path.join(HOOKS_DIR, 'dispatch-table.json');
const BOOT_PATH = path.join(HOOKS_DIR, 'hook-dispatch-boot.js');

// The shared buffer's layout: four Int32 words of header, then the result
// bytes. The bootstrap reads the header's length from workerData rather than
// declaring one of its own, so the two files cannot drift apart.
const HEADER_BYTES = 16;
const RESULT_BYTES = 1024 * 1024;

// Under the harness's own sixty seconds. Threads and fallback children both
// run concurrently, so this one figure bounds the whole dispatch.
const HOOK_DEADLINE_MS = 50000;

const DECISION_RANK = { deny: 3, ask: 2, allow: 1 };

// The routing dispatch-table.json holds, as [matcher, hook, ...] per event.
// The file is what the canary, the build manifest and the tests read, and it
// is re-read on every call where hooks.json is read once per session, so it is
// the one piece of wiring that can break under a running session. This copy is
// what routes when it does. test/hook-dispatch.test.js pins the two equal.
const FALLBACK_TABLE = {
    PreToolUse: [
        ['Write|Edit|MultiEdit|Bash|PowerShell', 'docs-write-guard.js'],
        ['Write|Edit|MultiEdit', 'memory-frontmatter-guard.js'],
        ['Bash|PowerShell', 'pr-docs-guard.js'],
        ['Bash|PowerShell', 'merged-pr-push-guard.js'],
        ['Bash|PowerShell', 'readonly-agent-guard.js'],
        ['Bash', 'memq-grant.js'],
        ['*', 'memory-recognition-nudge.js']
    ],
    PostToolUse: [
        ['Edit|MultiEdit|Write', 'format-on-edit.js'],
        ['Read', 'memory-usage-stamp.js'],
        ['*', 'memory-recognition-nudge.js']
    ]
};

function fallbackEntries(event) {
    return (FALLBACK_TABLE[event] || []).map(([matcher, ...names]) => ({ matcher, names }));
}

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function matchesAll(matcher) {
    return matcher === undefined || matcher === null || matcher === '' || matcher === '*' || matcher === '.*';
}

// A matcher made of tool names and bars, which is every matcher the table
// holds and which the test pins it to: the tool must be one of the names.
const SIMPLE_MATCHER = /^[A-Za-z0-9_|]+$/;

function matches(matcher, toolName) {
    if (matchesAll(matcher)) return true;
    if (typeof toolName !== 'string' || typeof matcher !== 'string') return false;
    if (SIMPLE_MATCHER.test(matcher)) return matcher.split('|').includes(toolName);
    try {
        return new RegExp('^(?:' + matcher + ')$').test(toolName);
    } catch {
        return false;
    }
}

// The table's entries for one event, as [{ matcher, names }], in table order.
// Throws on a table that is absent, unparseable, not in the documented shape,
// or holding a matcher that does not compile, so the caller routes on the
// fallback rather than on part of a table.
function readTable(tablePath, event) {
    const parsed = JSON.parse(fs.readFileSync(tablePath, 'utf8').replace(/^﻿/, ''));
    if (!isObject(parsed) || !isObject(parsed.hooks)) throw new Error('no hooks object');
    const entries = parsed.hooks[event];
    if (entries === undefined) return [];
    if (!Array.isArray(entries)) throw new Error('event ' + event + ' is not an array');
    return entries.map((entry) => {
        if (!isObject(entry) || !Array.isArray(entry.hooks)) throw new Error('malformed entry under ' + event);
        if (!matchesAll(entry.matcher)) {
            if (typeof entry.matcher !== 'string') throw new Error('a matcher under ' + event + ' is not a string');
            new RegExp('^(?:' + entry.matcher + ')$');
        }
        const names = [];
        for (const h of entry.hooks) {
            const m = /hooks[\\/]([\w.-]+\.js)/.exec(String((h && h.command) || ''));
            if (!m) throw new Error('a command under ' + event + ' names no hook file');
            names.push(m[1]);
        }
        return { matcher: entry.matcher, names };
    });
}

// The hook filenames to run, in table order, each once. toolName undefined
// means the payload could not be read, and then every hook for the event runs:
// each one already fails open on a payload it cannot parse, and running too
// many is the safe direction for a set of guards.
function selectHooks(entries, toolName) {
    const selected = [];
    for (const entry of entries) {
        if (toolName !== undefined && !matches(entry.matcher, toolName)) continue;
        for (const name of entry.names) {
            if (!selected.includes(name)) selected.push(name);
        }
    }
    return selected;
}

// The launch this file replaced, kept as the fallback and the rollback. It is
// asynchronous so that fallback children run beside each other and beside the
// threads, as the harness ran them, and so the main thread stays free to hear
// worker exits and fire deadlines while one runs.
function runChild(hookPath, payloadText, deadlineMs) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(process.execPath, [hookPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (x) {
            resolve({ code: 1, stdout: '', stderr: String((x && x.message) || x) + '\n' });
            return;
        }
        const out = [];
        const err = [];
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* already gone */ }
            settle({
                code: 1,
                stdout: '',
                stderr: Buffer.concat(err).toString('utf8') + path.basename(hookPath) + ': no answer within ' + deadlineMs + ' ms\n'
            });
        }, deadlineMs);
        child.stdout.on('data', (chunk) => out.push(chunk));
        child.stderr.on('data', (chunk) => err.push(chunk));
        child.on('error', (x) => settle({
            code: 1, stdout: '', stderr: Buffer.concat(err).toString('utf8') + String((x && x.message) || x) + '\n'
        }));
        child.on('close', (code) => settle({
            code: code === null ? 1 : code,
            stdout: Buffer.concat(out).toString('utf8'),
            stderr: Buffer.concat(err).toString('utf8')
        }));
        child.stdin.on('error', () => {});
        child.stdin.end(payloadText);
    });
}

// Resolves to the hook's answer, or to null when the thread never ran the hook
// to an answer and the caller should fall back to a child process. An answer
// too large for the buffer is not that case: the hook ran, its side effects
// landed, and running it again would land them twice, so its exit code is kept
// and its output is dropped.
function runThreaded(hookPath, payloadText, deadlineMs) {
    return new Promise((resolve) => {
        let sab;
        let worker;
        try {
            const { Worker, SHARE_ENV } = require('worker_threads');
            sab = new SharedArrayBuffer(HEADER_BYTES + RESULT_BYTES);
            worker = new Worker(BOOT_PATH, {
                workerData: { sab, payload: payloadText, hookPath, deadlineMs, headerBytes: HEADER_BYTES },
                // A thread's default environment is a plain copy, and a plain
                // copy is case-sensitive where the process's own is not on
                // Windows: the variable is spelled Path there, so a hook that
                // reads PATH would find nothing. The grant hook reads it to
                // identify the interpreter and would refuse every call. The
                // real object is shared instead, which is sound while no
                // routed hook writes to it, and the test pins that none does.
                env: SHARE_ENV,
                stdout: true,
                stderr: true
            });
        } catch {
            resolve(null);
            return;
        }
        let settled = false;
        const settle = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => {
            worker.terminate().catch(() => {});
            settle({ code: 1, stdout: '', stderr: path.basename(hookPath) + ': no answer within ' + deadlineMs + ' ms\n' });
        }, deadlineMs);
        // An uncaught throw from a callback still runs the thread's exit handler
        // and still ends it with code 1, as it would a process. What differs is
        // where the stack goes: node prints it for a process and hands it to
        // this event for a thread, so it is put back on stderr below.
        let uncaught = '';
        worker.on('error', (x) => { uncaught = String((x && x.stack) || x) + '\n'; });
        worker.on('exit', () => {
            const head = new Int32Array(sab, 0, 4);
            const state = Atomics.load(head, 0);
            if (state !== 1 && state !== 2) {
                settle(null);
                return;
            }
            const outLen = Atomics.load(head, 2);
            const errLen = Atomics.load(head, 3);
            const body = Buffer.from(sab, HEADER_BYTES);
            const code = Atomics.load(head, 1);
            const stderr = body.subarray(outLen, outLen + errLen).toString('utf8') + uncaught;
            if (state === 2) {
                settle({
                    code: code === 0 ? 1 : code,
                    stdout: '',
                    stderr: stderr + path.basename(hookPath) + ': its answer was larger than ' + RESULT_BYTES + ' bytes and was dropped\n'
                });
                return;
            }
            settle({ code, stdout: body.subarray(0, outLen).toString('utf8'), stderr });
        });
    });
}

function joinText(existing, added) {
    if (typeof added !== 'string' || added === '') return existing;
    return typeof existing === 'string' && existing !== '' ? existing + '\n' + added : added;
}

// results: [{ name, code, stdout, stderr }] in table order.
// Returns { exitCode, stdout, stderr }.
function merge(event, results) {
    const blockers = results.filter((r) => r.code === 2);
    if (blockers.length > 0) {
        return { exitCode: 2, stdout: '', stderr: blockers.map((r) => r.stderr).join('') };
    }

    const failures = results.filter((r) => r.code !== 0);
    // Every hook's stderr in table order, an exit-0 hook's included: the
    // harness shows a hook's stderr in its own log whatever the exit code, and
    // nothing here is the place to lose a line a hook chose to write.
    const stderr = results.map((r) => r.stderr).join('');
    const failureNote = failures.length === 0 ? '' : 'kit hook failure, not blocking: '
        + failures.map((r) => r.name + ' (exit ' + r.code + ')').join(', ');
    const spoke = results.filter((r) => r.code === 0 && r.stdout.trim() !== '');

    if (spoke.length === 0) {
        return { exitCode: failures.length > 0 ? 1 : 0, stdout: '', stderr };
    }
    // One hook with something to say and nothing else to report: its bytes
    // are the answer, exactly as the harness would have read them.
    if (spoke.length === 1 && failures.length === 0) {
        return { exitCode: 0, stdout: spoke[0].stdout, stderr };
    }

    const objects = [];
    for (const r of spoke) {
        let parsed;
        try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
        if (isObject(parsed)) objects.push(parsed);
    }
    if (objects.length === 0) {
        // Plain text reaches nobody the failure note would not, and the note
        // is what an exit 0 would otherwise hide.
        return failureNote
            ? { exitCode: 0, stdout: JSON.stringify({ systemMessage: failureNote }), stderr }
            : { exitCode: 0, stdout: spoke[0].stdout, stderr };
    }

    const merged = {};
    const specific = {};
    const contexts = [];
    let sawSpecific = false;
    let decision;
    let reasons = [];
    for (const obj of objects) {
        for (const key of Object.keys(obj)) {
            if (key === 'hookSpecificOutput') continue;
            if (key === 'systemMessage' || key === 'reason' || key === 'stopReason') {
                merged[key] = joinText(merged[key], obj[key]);
            } else if (key === 'decision') {
                // The top-level decision the Stop-shaped answers carry ranks
                // as permissionDecision does: a block from any hook is the
                // answer, whatever another hook said and wherever it sat.
                if (obj[key] === 'block' || !('decision' in merged)) merged.decision = obj[key];
            } else if (!(key in merged)) {
                merged[key] = obj[key];
            }
        }
        const hso = obj.hookSpecificOutput;
        if (!isObject(hso)) continue;
        sawSpecific = true;
        for (const key of Object.keys(hso)) {
            if (key === 'hookEventName' || key === 'additionalContext'
                || key === 'permissionDecision' || key === 'permissionDecisionReason') continue;
            if (!(key in specific)) specific[key] = hso[key];
        }
        if (typeof hso.additionalContext === 'string' && hso.additionalContext !== '') {
            contexts.push(hso.additionalContext);
        }
        const rank = DECISION_RANK[hso.permissionDecision];
        if (rank === undefined) continue;
        const reason = typeof hso.permissionDecisionReason === 'string' ? hso.permissionDecisionReason : '';
        if (decision === undefined || rank > DECISION_RANK[decision]) {
            decision = hso.permissionDecision;
            reasons = reason ? [reason] : [];
        } else if (rank === DECISION_RANK[decision] && reason) {
            reasons.push(reason);
        }
    }
    if (sawSpecific) {
        const ordered = { hookEventName: event };
        Object.assign(ordered, specific);
        if (decision !== undefined) {
            ordered.permissionDecision = decision;
            if (reasons.length > 0) ordered.permissionDecisionReason = reasons.join('\n\n');
        }
        if (contexts.length > 0) ordered.additionalContext = contexts.join('\n\n');
        merged.hookSpecificOutput = ordered;
    }
    if (failureNote) merged.systemMessage = joinText(merged.systemMessage, failureNote);
    return { exitCode: 0, stdout: JSON.stringify(merged), stderr };
}

// Runs the named hooks and merges them. opts exists for the tests: hooksDir
// points at stand-in hooks, legacy forces the child-process path, deadlineMs
// shortens the wait. The command line passes legacy alone.
async function dispatch(event, names, payloadText, opts) {
    const o = opts || {};
    const dir = o.hooksDir || HOOKS_DIR;
    const legacy = o.legacy === true;
    const deadlineMs = o.deadlineMs || HOOK_DEADLINE_MS;
    const startedAt = Date.now();
    const results = await Promise.all(names.map(async (name) => {
        const hookPath = path.join(dir, name);
        let result = legacy ? null : await runThreaded(hookPath, payloadText, deadlineMs);
        if (result === null) {
            // The deadline bounds the whole dispatch, so a child that runs
            // because the thread ended late without an answer gets what the
            // thread left of it, never a fresh one of its own.
            result = await runChild(hookPath, payloadText, Math.max(1, deadlineMs - (Date.now() - startedAt)));
        }
        return { name, code: result.code, stdout: result.stdout, stderr: result.stderr };
    }));
    try {
        return merge(event, results);
    } catch (x) {
        // The hooks have run and their side effects have landed, so they are
        // not run again. What survives a fault in the merge is the verdict.
        const blockers = results.filter((r) => r.code === 2);
        const note = 'hook-dispatch: the merge failed (' + String((x && x.message) || x) + ')\n';
        return blockers.length > 0
            ? { exitCode: 2, stdout: '', stderr: blockers.map((r) => r.stderr).join('') }
            : { exitCode: 1, stdout: '', stderr: results.map((r) => r.stderr).join('') + note };
    }
}

function writeAll(fd, text) {
    const bytes = Buffer.from(text, 'utf8');
    let offset = 0;
    let stalls = 0;
    while (offset < bytes.length) {
        try {
            offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
            stalls = 0;
        } catch (x) {
            // A full non-blocking pipe says try again; anything else, or a pipe
            // that stays full, is a reader that has gone.
            if (!x || x.code !== 'EAGAIN' || ++stalls > 2000) return;
        }
    }
}

// Writes the answer and ends the process. The exit code is set before either
// write so that a write which fails still leaves the verdict. Ending the
// process here does not by itself get past a blocked thread: node joins its
// threads on exit, and a thread inside a synchronous call cannot be joined
// until the call returns. What keeps the exit on time is the bootstrap holding
// every synchronous child call to the dispatch deadline.
function answer(result) {
    process.exitCode = result.exitCode;
    if (result.stderr) writeAll(2, result.stderr);
    if (result.stdout) writeAll(1, result.stdout);
    process.exit(result.exitCode);
}

async function main() {
    const event = process.argv[2];
    let payloadText = '';
    try { payloadText = fs.readFileSync(0, 'utf8'); } catch { payloadText = ''; }

    let entries;
    let tableNote = '';
    try {
        entries = readTable(TABLE_PATH, event);
    } catch (x) {
        entries = fallbackEntries(event);
        tableNote = 'hook-dispatch: the routing table at ' + TABLE_PATH + ' is unusable ('
            + String((x && x.message) || x) + '), so this call was routed on the dispatcher\'s own copy\n';
    }

    let toolName;
    try {
        const payload = JSON.parse(payloadText.replace(/^﻿/, ''));
        if (isObject(payload) && typeof payload.tool_name === 'string') toolName = payload.tool_name;
    } catch {
        toolName = undefined;
    }

    const names = selectHooks(entries, toolName);
    if (names.length === 0) {
        answer({ exitCode: 0, stdout: '', stderr: tableNote });
        return;
    }

    const legacy = process.env.KIT_HOOK_DISPATCH === 'legacy';
    const result = await dispatch(event, names, payloadText, { legacy });
    result.stderr = tableNote + result.stderr;
    answer(result);
}

if (require.main === module) {
    main().catch((x) => {
        process.exitCode = 1;
        writeAll(2, 'hook-dispatch: ' + String((x && x.stack) || x) + '\n');
        process.exit(1);
    });
}

module.exports = {
    matches, matchesAll, readTable, selectHooks, fallbackEntries, merge, dispatch, runChild, runThreaded, answer,
    TABLE_PATH, HOOKS_DIR, SIMPLE_MATCHER, HEADER_BYTES
};
