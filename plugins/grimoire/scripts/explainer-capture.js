#!/usr/bin/env node
// explainer-capture: drives a page one frame at a time in a headless browser
// and encodes the frames, with the narration's audio, into an MP4. Usage:
//
//   node explainer-capture.js <page.html> <timeline.json> <output.mp4> [--width <n>] [--height <n>] [--fps <n>] [--browser <path>] [--ffmpeg <path>]
//
// Width defaults to 1280 and height to 720, each an even integer from 320 to
// 4096, since the yuv420p picture halves both sides. The rate defaults to 30
// frames a second, an integer from 1 to 60. The timeline is the one
// explainer-voice.js writes, and each scene's audio file is read from the
// timeline's folder. An output that already exists is refused and never
// replaced. The page defines window.renderAt(seconds), which draws that moment
// and may return a promise; the script waits on it before each screenshot.
// Exits:
//
//   0  captured: <output> <frames> frames at <fps> fps, <seconds>s, <width>x<height>   (stdout)
//   1  explainer-capture: <what failed>: the page defines no renderAt function,
//      renderAt threw, the browser or ffmpeg failed, a step timed out, a file
//      appeared at the output during the run, or any other error once the
//      browser started, named. The run's own part-written video is removed,
//      and a file another process wrote at the output is left as it is. A
//      copy to the output that fails partway may leave part of the video
//      there, and the message says so.
//   2  explainer-capture: <a refusal>, one line for each, all of them at once:
//      a refused argument, a page that does not end .html or is absent, an
//      output that does not end .mp4, has no folder or already exists, a
//      timeline that is absent or does not read, an audio file it names that
//      is absent, no browser, or no ffmpeg.
//
// THE PROGRAMS. The browser and ffmpeg are found from closed lists of literal
// paths, or the absolute paths --browser and --ffmpeg name, as explainer-lib.js
// states, and never from PATH. Each runs from its own folder, since the
// Windows loader searches the working directory for libraries.
//
// THE BROWSER. It runs headless on a throwaway profile made under the temp
// directory, with its debugging port picked by the browser itself on the
// loopback address, which the profile's DevToolsActivePort file names. The
// script talks to that port alone. On every path out, a failure and a Ctrl-C
// included, it ends the ffmpeg and the browser it started through their own
// process handles and removes the profile, trying again while the browser's
// helper processes let go of its files. A Ctrl-C during that cleanup ends any
// process still running and the cleanup carries on. It ends no other process.
//
// THE ENCODE. Each frame is a PNG screenshot piped to ffmpeg. Each scene's
// audio is laid at that scene's start, the scenes mixed into one track. The
// video is H.264 in yuv420p with AAC audio, its index moved to the front by
// +faststart so a phone plays it before it has all arrived. ffmpeg writes a
// file this run made fresh beside the output, and the whole video becomes the
// output by a hard link, or by an exclusive copy where the link fails, as on
// a volume with no hard links, each of which fails rather than replace a file
// that appeared there during the run. ffmpeg runs without FFREPORT, so the environment cannot
// direct it to write a log file anywhere.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { locate, ffmpegEnvironment } = require('./explainer-lib.js');
const { neutralize } = require('./kit-endpoint-lib.js');

const DEFAULTS = Object.freeze({ width: 1280, height: 720, fps: 30 });
const MIN_SIDE = 320;
const MAX_SIDE = 4096;
const MAX_FPS = 60;
// The longest the script waits on one step: the port, the page load, one
// command, one renderAt, one frame into ffmpeg.
const STEP_MS = 30000;
// The longest it waits on a process it ended to exit.
const ENDING_MS = 10000;
const POLL_MS = 50;
// The pause between tries at removing a file or folder this run made.
const REMOVE_RETRY_MS = 250;
// The signals a console sends on Ctrl-C, on a stop and on its window closing.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const STDERR_BYTES = 16 * 1024;
const MESSAGE_CUT = 200;
const USAGE = 'usage: node explainer-capture.js <page.html> <timeline.json> <output.mp4> [--width <n>] [--height <n>] [--fps <n>] [--browser <path>] [--ffmpeg <path>]';

// An argument the script refuses, which exits 2 with its message.
class Refusal extends Error {}

// A step that failed once the browser started, which exits 1.
class CaptureFault extends Error {}

function integer(flag, value, min, max, even) {
    const shape = `${flag} takes ${even ? 'an even' : 'an'} integer from ${min} to ${max}`;
    if (value === undefined || !/^\d+$/.test(value)) throw new Refusal(shape);
    const n = Number(value);
    if (n < min || n > max || (even && n % 2 !== 0)) throw new Refusal(`${shape}, not ${value}`);
    return n;
}

function pathValue(flag, value) {
    if (value === undefined || value === '' || value.startsWith('--')) throw new Refusal(`${flag} takes one path`);
    return value;
}

// The options the arguments name, or a thrown Refusal.
function parseArgs(argv) {
    const positional = [];
    const options = { ...DEFAULTS, browser: null, ffmpeg: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--width') options.width = integer(arg, argv[++i], MIN_SIDE, MAX_SIDE, true);
        else if (arg === '--height') options.height = integer(arg, argv[++i], MIN_SIDE, MAX_SIDE, true);
        else if (arg === '--fps') options.fps = integer(arg, argv[++i], 1, MAX_FPS, false);
        else if (arg === '--browser') options.browser = pathValue(arg, argv[++i]);
        else if (arg === '--ffmpeg') options.ffmpeg = pathValue(arg, argv[++i]);
        else if (arg.startsWith('--')) throw new Refusal(`unknown option ${arg}; ${USAGE}`);
        else positional.push(arg);
    }
    if (positional.length !== 3) throw new Refusal(USAGE);
    [options.page, options.timeline, options.output] = positional;
    return options;
}

// The moment each frame shows, in seconds, for a video `seconds` long at `fps`
// frames a second: one frame at every 1/fps from 0, as many as cover the length.
function frameTimes(seconds, fps) {
    const count = Math.max(1, Math.ceil(Math.round(seconds * fps * 1e6) / 1e6));
    return Array.from({ length: count }, (_, i) => Math.round((i / fps) * 1e6) / 1e6);
}

// ffmpeg's arguments: the frames on its standard input at `fps`, then one input
// for each scene's audio, each delayed to its scene's start and mixed into one
// track, written to `file` as H.264 yuv420p with AAC and +faststart. `file` is
// the empty file this run made for ffmpeg alone, so `-y` writes over it.
function ffmpegArgs(scenes, fps, file) {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0'];
    for (const scene of scenes) args.push('-i', scene.audioPath);
    const delayed = scenes.map((scene, i) => `[${i + 1}:a]adelay=delays=${Math.round(scene.start * 1000)}:all=1[a${i}]`);
    const mix = scenes.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${scenes.length}:duration=longest:normalize=0[aout]`;
    args.push('-filter_complex', delayed.concat(mix).join(';'));
    args.push('-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', file);
    return args;
}

function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDirectory(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// The timeline's total and scenes, each scene's audio as an absolute path, or
// null with each fault added to `problems`.
function readTimeline(file, problems) {
    let timeline;
    try {
        timeline = JSON.parse(String(fs.readFileSync(file, 'utf8')).replace(/^\uFEFF/, ''));
    } catch (err) {
        problems.push(err && err.code === 'ENOENT' ? `no timeline at ${file}` : `the timeline does not read as JSON: ${file}`);
        return null;
    }
    const scenes = timeline !== null && typeof timeline === 'object' && Array.isArray(timeline.scenes) ? timeline.scenes : [];
    const shaped = scenes.length > 0 && Number.isFinite(timeline.total) && timeline.total > 0 && scenes.every((s) =>
        s !== null && typeof s === 'object' && Number.isFinite(s.start) && s.start >= 0 && typeof s.audio === 'string' && s.audio !== '');
    if (!shaped) {
        problems.push(`the timeline holds no total and no list of scenes, each with a start and an audio file: ${file}`);
        return null;
    }
    const folder = path.dirname(file);
    const read = scenes.map((s) => ({ start: s.start, audioPath: path.resolve(folder, s.audio) }));
    for (const scene of read) if (!isFile(scene.audioPath)) problems.push(`no audio file at ${neutralize(scene.audioPath)}, which the timeline names`);
    return { total: timeline.total, scenes: read };
}

function delay(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// `promise`, or a thrown CaptureFault saying `what` timed out after `ms`.
function within(promise, ms, what) {
    let timer;
    const clock = new Promise((_, reject) => { timer = setTimeout(() => reject(new CaptureFault(`${what} timed out after ${ms / 1000}s`)), ms); });
    return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

// A started process with its exit as a promise, which also settles where the
// start itself failed. `done` is true once either has happened.
function started(child) {
    const run = { child, done: false, code: null, error: null, stderr: '' };
    run.exited = new Promise((resolve) => {
        child.once('exit', (code, signal) => { run.done = true; run.code = code === null ? signal : code; resolve(); });
        child.once('error', (err) => { run.done = true; run.error = err; resolve(); });
    });
    if (child.stderr) {
        child.stderr.on('data', (part) => { if (run.stderr.length < STDERR_BYTES) run.stderr += String(part); });
        child.stderr.on('error', () => {});
    }
    return run;
}

// Waits on a process's exit for at most ENDING_MS.
async function exitWithin(run) {
    let timer;
    await Promise.race([run.exited, new Promise((resolve) => { timer = setTimeout(resolve, ENDING_MS); })]);
    clearTimeout(timer);
}

// Ends a process this script started, through its own handle, and waits on
// its exit within the bound.
async function end(run) {
    if (run === null || run.done) return;
    try { run.child.kill(); } catch { /* it exited between the check and the kill */ }
    await exitWithin(run);
}

// What a process said on its way out, as one guarded line.
function said(run) {
    const code = run.error ? (run.error.code || 'no error code') : `exit ${run.code}`;
    const text = neutralize(run.stderr).slice(0, MESSAGE_CUT);
    return `(${code})` + (text ? `: ${text}` : '');
}

// The loopback address the browser's debugging port answers on, read from the
// DevToolsActivePort file the browser writes into its profile: the port on the
// first line and the browser's own path on the second.
async function debuggingUrl(profile, browser) {
    const file = path.join(profile, 'DevToolsActivePort');
    const stop = Date.now() + STEP_MS;
    while (Date.now() < stop) {
        if (browser.done) throw new CaptureFault(`the browser exited before it opened its debugging port ${said(browser)}`);
        let lines = [];
        try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* not written yet */ }
        const port = Number(lines[0]);
        if (/^\d{1,5}$/.test(lines[0] || '') && port > 0 && port < 65536 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(lines[1] || '')) {
            return `ws://127.0.0.1:${port}${lines[1]}`;
        }
        await delay(POLL_MS);
    }
    throw new CaptureFault(`the browser opened no debugging port within ${STEP_MS / 1000}s`);
}

// A connection to the browser's debugging port. `send` resolves to a command's
// result, or throws a CaptureFault where the browser refused it, the
// connection closed or the step timed out.
async function connect(url, WebSocketClass) {
    const socket = new WebSocketClass(url);
    const pending = new Map();
    let id = 0;
    let closed = false;
    const fail = (why) => {
        closed = true;
        for (const { reject } of pending.values()) reject(new CaptureFault(why));
        pending.clear();
    };
    socket.addEventListener('message', (event) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message === null || typeof message !== 'object') return;
        if (pending.has(message.id)) {
            const { resolve, reject, method } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new CaptureFault(`the browser refused ${method}: ${neutralize(String(message.error.message || '')).slice(0, MESSAGE_CUT)}`));
            else resolve(message.result || {});
        }
    });
    socket.addEventListener('close', () => fail('the connection to the browser closed'));
    await within(new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new CaptureFault('the connection to the browser failed')), { once: true });
    }), STEP_MS, 'the connection to the browser');
    return {
        send(method, params = {}, sessionId) {
            if (closed) return Promise.reject(new CaptureFault('the connection to the browser closed'));
            id += 1;
            const message = { id, method, params };
            if (sessionId) message.sessionId = sessionId;
            const answer = new Promise((resolve, reject) => { pending.set(id, { resolve, reject, method }); });
            socket.send(JSON.stringify(message));
            return within(answer, STEP_MS, method);
        },
        close() {
            closed = true;
            try { socket.close(); } catch { /* already closed */ }
        }
    };
}

// Writes one frame to ffmpeg, waiting within the step limit where its pipe is
// full, or throws where ffmpeg exited first.
async function writeFrame(ffmpeg, bytes) {
    const written = new Promise((resolve) => {
        if (ffmpeg.child.stdin.write(bytes)) resolve();
        else ffmpeg.child.stdin.once('drain', resolve);
    });
    const first = await within(Promise.race([written.then(() => 'written'), ffmpeg.exited.then(() => 'exited')]), STEP_MS, 'ffmpeg taking a frame');
    if (first === 'exited') throw new CaptureFault(`ffmpeg exited before the last frame ${said(ffmpeg)}`);
}

// Gives the finished video the output's name, never replacing a file that
// appeared there during the run: a hard link fails on a taken name, and so
// does the exclusive copy made where the link fails for any other reason, as
// it does on a volume with no hard links. Each volume names that fault with
// its own code, FAT and exFAT on Windows with EISDIR, so no list of codes is
// kept. A copy that fails partway may leave part of the video at the output.
function place(part, output) {
    try {
        try {
            fs.linkSync(part, output);
        } catch (err) {
            if (err && err.code === 'EEXIST') throw err;
            fs.copyFileSync(part, output, fs.constants.COPYFILE_EXCL);
        }
    } catch (err) {
        throw new CaptureFault(err && err.code === 'EEXIST'
            ? `a file appeared at ${output} during the capture and is left as it is`
            : `the video was not copied whole to ${output} (${(err && err.code) || 'no error code'}), so a part-written file may stand there`);
    }
}

// True in the tab once the page has loaded. The tab opens on about:blank, so a
// file: document is the page this script navigated to and never the blank one.
const PAGE_LOADED = 'location.protocol === "file:" && document.readyState === "complete"';

// Waits, within the step limit, until the page navigated to reads as loaded.
// A probe the browser refuses, as it may while it makes the new document's
// context, is tried again.
async function pageLoaded(on, browser) {
    const stop = Date.now() + STEP_MS;
    let refused = '';
    while (Date.now() < stop) {
        if (browser.done) throw new CaptureFault(`the browser exited before the page loaded ${said(browser)}`);
        try {
            const probe = await on('Runtime.evaluate', { expression: PAGE_LOADED, returnByValue: true });
            if (probe.result && probe.result.value === true) return;
        } catch (err) {
            if (!(err instanceof CaptureFault)) throw err;
            refused = `: ${err.message}`;
        }
        await delay(POLL_MS);
    }
    throw new CaptureFault(`the page did not finish loading within ${STEP_MS / 1000}s${refused}`);
}

const SEAMS = {
    spawn,
    WebSocket: globalThis.WebSocket
};

// Captures options.page over the timeline options.timeline names into
// options.output. Resolves to { code, stdout, stderr }, each stream a list of
// lines. `seams` replaces any of SEAMS: `spawn` takes child_process.spawn's
// arguments and returns its child, and `WebSocket` is the class the browser's
// port is opened with; the test passes its own.
async function capture(options, seams = {}) {
    const io = { ...SEAMS, ...seams };
    const out = { code: 0, stdout: [], stderr: [] };
    const say = (msg) => { out.stderr.push('explainer-capture: ' + msg); };
    const width = options.width === undefined ? DEFAULTS.width : options.width;
    const height = options.height === undefined ? DEFAULTS.height : options.height;
    const fps = options.fps === undefined ? DEFAULTS.fps : options.fps;

    const problems = [];
    const page = path.resolve(options.page);
    if (!/\.html$/i.test(page)) problems.push(`the page must end .html: ${page}`);
    else if (!isFile(page)) problems.push(`no page at ${page}`);
    const output = path.resolve(options.output);
    if (!/\.mp4$/i.test(output)) problems.push(`the output must end .mp4: ${output}`);
    else if (!isDirectory(path.dirname(output))) problems.push(`no folder for the output at ${path.dirname(output)}`);
    else if (fs.existsSync(output)) problems.push(`the output already exists and is not replaced: ${output}`);
    const timeline = readTimeline(path.resolve(options.timeline), problems);
    const named = { browser: options.browser || null, ffmpeg: options.ffmpeg || null };
    const browserPath = locate('browser', named);
    const ffmpegPath = locate('ffmpeg', named);
    for (const found of [browserPath, ffmpegPath]) if (found.problem) problems.push(found.problem);
    if (problems.length) {
        out.code = 2;
        problems.forEach(say);
        return out;
    }

    const times = frameTimes(timeline.total, fps);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-capture-'));
    let browser = null;
    let ffmpeg = null;
    let cdp = null;
    let part = null;
    // A signal to this script ends both processes through their handles, so
    // the step waiting on either fails and the cleanup below still runs. With
    // no listener, the signal would end the script and leave them running.
    let signalled = null;
    const onSignal = (signal) => {
        signalled = signal;
        for (const run of [ffmpeg, browser]) if (run !== null && !run.done) { try { run.child.kill(); } catch { /* exited */ } }
    };
    for (const signal of SIGNALS) process.on(signal, onSignal);
    try {
        browser = started(io.spawn(browserPath.path, [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            '--disable-extensions',
            `--user-data-dir=${profile}`,
            '--remote-debugging-address=127.0.0.1',
            '--remote-debugging-port=0',
            `--window-size=${width},${height}`,
            'about:blank'
        ], { cwd: path.dirname(browserPath.path), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }));

        cdp = await connect(await debuggingUrl(profile, browser), io.WebSocket);
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        const on = (method, params) => cdp.send(method, params, sessionId);
        await on('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        const navigated = await on('Page.navigate', { url: pathToFileURL(page).href });
        if (navigated.errorText) throw new CaptureFault(`the page did not load: ${neutralize(String(navigated.errorText)).slice(0, MESSAGE_CUT)}`);
        await pageLoaded(on, browser);

        const has = await on('Runtime.evaluate', { expression: 'typeof window.renderAt === "function"', returnByValue: true });
        if (!has.result || has.result.value !== true) throw new CaptureFault(`the page defines no renderAt function, so no frame can be drawn: ${page}`);

        // ffmpeg writes a file this run creates exclusively beside the output,
        // so every file the cleanup below removes is this run's own.
        const name = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}.part-${crypto.randomBytes(6).toString('hex')}.mp4`);
        fs.closeSync(fs.openSync(name, 'wx'));
        part = name;
        ffmpeg = started(io.spawn(ffmpegPath.path, ffmpegArgs(timeline.scenes, fps, part), { cwd: path.dirname(ffmpegPath.path), env: ffmpegEnvironment(), stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true }));
        ffmpeg.child.stdin.on('error', () => { /* ffmpeg's exit names the fault */ });

        for (const seconds of times) {
            const drawn = await on('Runtime.evaluate', { expression: `Promise.resolve(window.renderAt(${seconds})).then(() => true)`, awaitPromise: true, returnByValue: true });
            if (drawn.exceptionDetails) {
                const thrown = drawn.exceptionDetails.exception && drawn.exceptionDetails.exception.description;
                throw new CaptureFault(`renderAt(${seconds}) threw: ${neutralize(String(thrown || drawn.exceptionDetails.text || '')).slice(0, MESSAGE_CUT)}`);
            }
            const shot = await on('Page.captureScreenshot', { format: 'png' });
            await writeFrame(ffmpeg, Buffer.from(String(shot.data || ''), 'base64'));
        }
        ffmpeg.child.stdin.end();
        await within(ffmpeg.exited, STEP_MS, 'ffmpeg finishing the video');
        if (ffmpeg.code !== 0) throw new CaptureFault(`ffmpeg failed ${said(ffmpeg)}`);
        place(part, output);
        // The output now holds the whole video, so the part file goes before
        // the cleanup waits on the browser.
        await removeOwn(part, 'the part-written video', say);
        part = null;
        out.stdout.push(`captured: ${output} ${times.length} frames at ${fps} fps, ${timeline.total}s, ${width}x${height}`);
    } catch (err) {
        out.code = 1;
        const why = err instanceof CaptureFault
            ? err.message
            : `the capture failed: ${neutralize(oneLine(err instanceof Error ? `${err.name}: ${err.message}` : String(err)))}`;
        say(signalled ? `stopped by ${signalled}: ${why}` : why);
    } finally {
        // The signal listeners stay until the profile is gone, so a signal
        // during the cleanup ends what still runs and the cleanup finishes.
        await end(ffmpeg);
        await end(browser);
        if (cdp !== null) cdp.close();
        if (part !== null) await removeOwn(part, 'the part-written video', say);
        await removeOwn(profile, 'the browser profile', say);
        for (const signal of SIGNALS) process.removeListener(signal, onSignal);
    }
    return out;
}

// Removes `target`, a file or folder this run made, which `what` names. The
// browser's helper processes can hold the profile's files a while after the
// browser itself exits, and a virus scanner can hold the part file, so a
// failed removal is tried again until the step limit.
async function removeOwn(target, what, say) {
    const stop = Date.now() + STEP_MS;
    for (;;) {
        try {
            fs.rmSync(target, { recursive: true, force: true });
            return;
        } catch {
            if (Date.now() >= stop) {
                say(`${what} was not removed: ${target}`);
                return;
            }
            await delay(REMOVE_RETRY_MS);
        }
    }
}

function oneLine(text) {
    return String(text).replace(/\r\n|\r|\n/g, ' ').trim().slice(0, MESSAGE_CUT);
}

// Every line goes out through the kit's one path renderer, so a path under the
// home directory prints as ~ and the account name stays out of the session.
async function main(argv, scrub) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        process.stderr.write(scrub('explainer-capture: ' + err.message) + '\n');
        return 2;
    }
    const result = await capture(options);
    if (result.stdout.length) process.stdout.write(scrub(result.stdout.join('\n')) + '\n');
    if (result.stderr.length) process.stderr.write(scrub(result.stderr.join('\n')) + '\n');
    return result.code;
}

module.exports = { parseArgs, capture, frameTimes, ffmpegArgs };

if (require.main === module) {
    let scrub;
    try {
        ({ scrub } = require('../hooks/kit-compact-lib.js'));
    } catch {
        process.stderr.write('explainer-capture: the kit path renderer hooks/kit-compact-lib.js did not load, so nothing ran\n');
        process.exitCode = 2;
    }
    if (scrub) {
        main(process.argv.slice(2), scrub).then(
            (code) => { process.exitCode = code; },
            (err) => {
                process.stderr.write(scrub('explainer-capture: ' + oneLine(err && err.message ? err.message : err)) + '\n');
                process.exitCode = 2;
            }
        );
    }
}
