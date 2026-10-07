#!/usr/bin/env node
// hook-dispatch-boot.js - the thread side of hook-dispatch.js.
//
// Runs one unmodified hook script as this thread's main module and hands its
// answer back through a SharedArrayBuffer. A hook reads its payload with
// fs.readFileSync(0), writes to stdout or stderr, and ends through
// process.exit or a natural return. Inside a worker thread process.exit ends
// the thread alone, so the hook keeps its own exit-code meaning and its own
// uncaught-exception boundary without its file changing.
//
// The result is written from the thread's 'exit' handler, which runs on
// process.exit and on a natural end alike. The write is synchronous and the
// buffer is shared, so the parent reads a complete answer or none. The state
// word says which: 0 means this thread never reached the handler, and the
// parent runs the hook as a child process instead; 1 means the answer is
// whole; 2 means it did not fit, and then the exit code and as much of stderr
// as fits are written and stdout is dropped, because the hook has run and the
// parent must not run it again.
//
// This handler is registered before the hook loads, so it runs before any exit
// handler the hook registers, and would miss what such a handler wrote. No
// routed hook registers one, and test/hook-dispatch.test.js pins that for every
// file the routing table names, along with the payload read this file serves.
//
// Layout: Int32[0] state, Int32[1] exit code, Int32[2] stdout byte length,
// Int32[3] stderr byte length, then stdout bytes followed by stderr bytes.
// The header's byte length is the dispatcher's, handed over in workerData, so
// this file declares nothing about the layout that could drift from it.

'use strict';

const { workerData, isMainThread } = require('worker_threads');

if (isMainThread) {
    process.stderr.write('hook-dispatch-boot.js runs only as a worker thread of hook-dispatch.js\n');
    process.exit(1);
}

const fs = require('fs');
const Module = require('module');

const THREAD_STARTED_AT = Date.now();
const { sab, payload, hookPath, deadlineMs, headerBytes } = workerData;
const head = new Int32Array(sab, 0, 4);
const body = new Uint8Array(sab, headerBytes);

const out = [];
const err = [];

// File descriptor 0 belongs to the dispatcher, which has already read it. The
// hook is handed the same text under the one spelling every kit hook uses.
const realReadFileSync = fs.readFileSync;
fs.readFileSync = function readFileSync(target, ...rest) {
    if (target === 0) return payload;
    return realReadFileSync.call(this, target, ...rest);
};

function collector(sink) {
    return function write(chunk, encoding, callback) {
        sink.push(Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
        return true;
    };
}
process.stdout.write = collector(out);
process.stderr.write = collector(err);

// Several hooks answer with fs.writeSync(1, ...) or report with
// fs.writeSync(2, ...), which reaches the real descriptor and never touches
// the stream objects above. Descriptors 1 and 2 are the dispatcher's, so a
// write to either is collected here instead. Every other descriptor is the
// hook's own file and passes through.
const realWriteSync = fs.writeSync;
fs.writeSync = function writeSync(fd, data, ...rest) {
    if (fd !== 1 && fd !== 2) return realWriteSync.call(this, fd, data, ...rest);
    let bytes;
    if (typeof data === 'string') {
        // (fd, string, position, encoding)
        bytes = Buffer.from(data, typeof rest[1] === 'string' ? rest[1] : 'utf8');
    } else {
        // (fd, buffer, offset, length, position)
        const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const offset = typeof rest[0] === 'number' ? rest[0] : 0;
        const length = typeof rest[1] === 'number' ? rest[1] : view.length - offset;
        bytes = Buffer.from(view.subarray(offset, offset + length));
    }
    (fd === 1 ? out : err).push(bytes);
    return bytes.length;
};

process.on('exit', (code) => {
    const o = Buffer.concat(out);
    const e = Buffer.concat(err);
    if (o.length + e.length > body.length) {
        const kept = e.subarray(0, Math.min(e.length, body.length));
        body.set(kept, 0);
        Atomics.store(head, 1, code | 0);
        Atomics.store(head, 2, 0);
        Atomics.store(head, 3, kept.length);
        Atomics.store(head, 0, 2);
        return;
    }
    body.set(o, 0);
    body.set(e, o.length);
    Atomics.store(head, 1, code | 0);
    Atomics.store(head, 2, o.length);
    Atomics.store(head, 3, e.length);
    Atomics.store(head, 0, 1);
});

// A thread inside a synchronous child call cannot be interrupted: neither
// worker.terminate() nor process.exit() in the parent returns until the child
// does, so one hung child would hold the whole dispatcher, and every other
// hook's verdict with it, past the harness's own timeout. The three
// synchronous spawns are therefore held to what remains of the dispatch
// deadline at the moment each is made, so two calls in a row cannot add up to
// more than one deadline between them. A hook's own shorter timeout stands;
// only a call that would have outlived the deadline is changed, and the
// harness would have killed the hook before it returned.
const childProcess = require('child_process');

// What is left of this thread's deadline, never less than a millisecond: a
// zero would read as no timeout at all, which is the one value that must not
// reach the call.
function remainingMs() {
    return Math.max(1, deadlineMs - (Date.now() - THREAD_STARTED_AT));
}

function capped(options) {
    const o = Object.assign({}, options);
    const remaining = remainingMs();
    // No timeout, a timeout of 0 and a negative one all mean uncapped, and a
    // cap past what remains would outlive the deadline; each takes the budget.
    if (!(o.timeout > 0) || o.timeout > remaining) {
        o.timeout = remaining;
        o.killSignal = 'SIGKILL';
    }
    return o;
}

for (const name of ['spawnSync', 'execFileSync']) {
    const real = childProcess[name];
    childProcess[name] = function (file, args, options) {
        // Three legal spellings: (file, args, options), (file, options), and
        // (file, undefined, options), where node reads a nullish args as an
        // empty list and the options stand.
        if (Array.isArray(args)) return real.call(this, file, args, capped(options));
        if (args === undefined || args === null) return real.call(this, file, [], capped(options));
        return real.call(this, file, capped(args));
    };
}
const realExecSync = childProcess.execSync;
childProcess.execSync = function execSync(command, options) {
    return realExecSync.call(this, command, capped(options));
};

// A hook spawned as a child process sees its own path at argv[1] and is
// require.main. Both hold here.
process.argv[1] = hookPath;
try {
    Module._load(hookPath, null, true);
} catch (x) {
    // What node itself does with an uncaught throw in a main module: the stack
    // on stderr and exit code 1.
    process.stderr.write(String((x && x.stack) || x) + '\n');
    process.exitCode = 1;
}
