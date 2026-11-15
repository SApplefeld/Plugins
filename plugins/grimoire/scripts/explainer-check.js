#!/usr/bin/env node
// explainer-check: reads a finished video, whatever made it, and passes or
// fails it on three rules: it has an audio track, it is within a size bound,
// and its picture never holds still for too long. Usage:
//
//   node explainer-check.js <video> [--max-mb <n>] [--still <seconds>] [--sheets <folder>] [--ffmpeg <path>]
//
// --max-mb defaults to 8, a megabyte being 1,048,576 bytes, and --still to 5.
// The facts print first, as ffprobe reads them (stdout):
//
//   bytes: <n>
//   seconds: <n>
//   frame size: <width>x<height>
//   video codec: <name>
//   pixel format: <name>
//   audio track: yes | no
//
// With --sheets, the folder is made where it is absent, and one line follows
// for each contact sheet written, a PNG of six frames taken one every 3
// seconds, named <video name>-sheet-<nn>.png and replaced on a later run:
//
//   sheet: <path>
//
// Exits:
//
//   0  passed: <video>: <bytes> bytes, <seconds>s, <size> <codec> <pixel format>, with audio, no still stretch of <n>s or more
//   1  explainer-check: <a fault>, one line for each, all of them at once: no
//      audio track, no video track, the size over --max-mb, and each still
//      stretch by its start and its length. Also for a program that failed:
//        explainer-check: <program> failed (exit <status>): <its message>
//   2  explainer-check: <a refusal>, one line for each, all of them at once: a
//      refused argument, no video file, no ffmpeg or no ffprobe.
//
// THE STILL RULE. Two frames of an encoded still are not always the same bytes,
// so the check reads ffmpeg's freezedetect filter over the file at its default
// noise tolerance. The filter reports every stretch of a second or more, and a
// stretch of --still seconds or more is a fault. A stretch running to the end
// of the video reaches the video track's own end. The rule catches a frozen
// screen and cannot tell whether motion means anything.
//
// THE PROGRAMS. ffmpeg and ffprobe are found from a closed list of literal
// paths, or beside the ffmpeg that --ffmpeg names, as explainer-lib.js states,
// and never from PATH. Each runs from its own folder, since the Windows loader
// searches the working directory for libraries. Each runs without FFREPORT,
// so the environment cannot direct it to write a log file anywhere.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { locate, ffmpegEnvironment } = require('./explainer-lib.js');
const { neutralize } = require('./kit-endpoint-lib.js');

const DEFAULT_MAX_MB = 8;
const DEFAULT_STILL = 5;
const MB = 1024 * 1024;
// The shortest stretch the filter is asked to report. A shorter --still asks
// for its own length.
const DETECT_SECONDS = 1;
const SHEET_EVERY = 3;
const SHEET_WIDTH = 480;
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BUFFER = 64 * 1024 * 1024;
const MESSAGE_CUT = 200;
const USAGE = 'usage: node explainer-check.js <video> [--max-mb <n>] [--still <seconds>] [--sheets <folder>] [--ffmpeg <path>]';

// An argument the script refuses, which exits 2 with its message.
class Refusal extends Error {}

function positive(flag, value) {
    if (value === undefined || !/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) throw new Refusal(`${flag} takes a number above zero`);
    return Number(value);
}

function pathValue(flag, value) {
    if (value === undefined || value === '' || value.startsWith('--')) throw new Refusal(`${flag} takes one path`);
    return value;
}

// The options the arguments name, or a thrown Refusal.
function parseArgs(argv) {
    const positional = [];
    const options = { maxMb: DEFAULT_MAX_MB, still: DEFAULT_STILL, sheets: null, ffmpeg: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--max-mb') options.maxMb = positive(arg, argv[++i]);
        else if (arg === '--still') options.still = positive(arg, argv[++i]);
        else if (arg === '--sheets') options.sheets = pathValue(arg, argv[++i]);
        else if (arg === '--ffmpeg') options.ffmpeg = pathValue(arg, argv[++i]);
        else if (arg.startsWith('--')) throw new Refusal(`unknown option ${arg}; ${USAGE}`);
        else positional.push(arg);
    }
    if (positional.length !== 1) throw new Refusal(USAGE);
    options.video = positional[0];
    return options;
}

// The facts ffprobe's JSON states, or null where it states no file.
function parseProbe(text) {
    let probe;
    try { probe = JSON.parse(text); } catch { return null; }
    if (probe === null || typeof probe !== 'object' || probe.format === null || typeof probe.format !== 'object') return null;
    const streams = Array.isArray(probe.streams) ? probe.streams.filter((s) => s !== null && typeof s === 'object') : [];
    const video = streams.find((s) => s.codec_type === 'video');
    const number = (value) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : null);
    return {
        bytes: number(probe.format.size),
        seconds: number(probe.format.duration),
        video: video !== undefined,
        width: video ? number(video.width) : null,
        height: video ? number(video.height) : null,
        codec: video && typeof video.codec_name === 'string' ? neutralize(video.codec_name) : 'none',
        pixelFormat: video && typeof video.pix_fmt === 'string' ? neutralize(video.pix_fmt) : 'none',
        videoSeconds: video ? number(video.duration) : null,
        audio: streams.some((s) => s.codec_type === 'audio')
    };
}

// Every stretch freezedetect's log names, as { start, length } in seconds. A
// stretch the log opens and never closes runs to `end`.
function stillStretches(log, end) {
    const stretches = [];
    let open = null;
    for (const line of String(log).split(/\r?\n/)) {
        const hit = /lavfi\.freezedetect\.freeze_(start|end): (-?[\d.]+)/.exec(line);
        if (hit === null) continue;
        const at = Number(hit[2]);
        if (hit[1] === 'start') open = at;
        else if (open !== null) {
            stretches.push({ start: open, length: at - open });
            open = null;
        }
    }
    if (open !== null && Number.isFinite(end)) stretches.push({ start: open, length: end - open });
    return stretches;
}

function round(seconds) {
    return Math.round(seconds * 1000) / 1000;
}

function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

// A program's run that did not exit 0, as one line.
function failed(name, res) {
    const status = res.status !== null && res.status !== undefined ? res.status : (res.signal || 'none');
    const said = neutralize([res.error ? String(res.error.code || res.error.message || res.error) : '', String(res.stderr || '')].join(' ')).slice(0, MESSAGE_CUT);
    return `${name} failed (exit ${status})` + (said ? `: ${said}` : '');
}

const SEAMS = { spawn: spawnSync };

// Checks the video options.video names. Returns { code, stdout, stderr }, each
// stream a list of lines. `seams.spawn` takes spawnSync's arguments and returns
// its result shape; the test passes its own.
function check(options, seams = {}) {
    const io = { ...SEAMS, ...seams };
    const out = { code: 0, stdout: [], stderr: [] };
    const say = (msg) => { out.stderr.push('explainer-check: ' + msg); };
    const maxMb = options.maxMb === undefined ? DEFAULT_MAX_MB : options.maxMb;
    const still = options.still === undefined ? DEFAULT_STILL : options.still;

    const problems = [];
    const video = path.resolve(options.video);
    if (!isFile(video)) problems.push(`no video file at ${video}`);
    const named = { browser: null, ffmpeg: options.ffmpeg || null };
    const ffmpeg = locate('ffmpeg', named);
    const ffprobe = locate('ffprobe', named);
    for (const found of [ffmpeg, ffprobe]) if (found.problem) problems.push(found.problem);
    const sheets = options.sheets ? path.resolve(options.sheets) : null;
    if (sheets !== null && fs.existsSync(sheets) && !fs.statSync(sheets).isDirectory()) problems.push(`the sheets folder is a file: ${sheets}`);
    if (problems.length) {
        out.code = 2;
        problems.forEach(say);
        return out;
    }

    const env = ffmpegEnvironment();
    const run = (program, args) => io.spawn(program, args, { cwd: path.dirname(program), env, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true }) || {};
    const probeRun = run(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,pix_fmt,width,height,duration', '-of', 'json', video]);
    const facts = probeRun.status === 0 ? parseProbe(probeRun.stdout) : null;
    if (facts === null) {
        say(probeRun.status === 0 ? 'ffprobe read no file facts from the video' : failed('ffprobe', probeRun));
        out.code = 1;
        return out;
    }
    const shown = (n) => (n === null ? 'unknown' : String(n));
    out.stdout.push(`bytes: ${shown(facts.bytes)}`);
    out.stdout.push(`seconds: ${facts.seconds === null ? 'unknown' : round(facts.seconds)}`);
    out.stdout.push(`frame size: ${shown(facts.width)}x${shown(facts.height)}`);
    out.stdout.push(`video codec: ${facts.codec}`);
    out.stdout.push(`pixel format: ${facts.pixelFormat}`);
    out.stdout.push(`audio track: ${facts.audio ? 'yes' : 'no'}`);

    const faults = [];
    if (!facts.video) faults.push('no video track');
    if (!facts.audio) faults.push('no audio track');
    if (facts.bytes === null) faults.push('ffprobe read no size for the video');
    else if (facts.bytes > maxMb * MB) faults.push(`${facts.bytes} bytes is over --max-mb ${maxMb}, ${maxMb * MB} bytes`);

    if (facts.video) {
        const freeze = run(ffmpeg.path, ['-hide_banner', '-nostats', '-i', video, '-map', '0:v:0', '-vf', `freezedetect=d=${Math.min(DETECT_SECONDS, still)}`, '-f', 'null', '-']);
        if (freeze.status !== 0) faults.push(failed('ffmpeg freezedetect', freeze));
        else {
            const end = facts.videoSeconds !== null ? facts.videoSeconds : facts.seconds;
            for (const stretch of stillStretches(freeze.stderr, end)) {
                if (stretch.length >= still) faults.push(`the picture holds still from ${round(stretch.start)}s for ${round(stretch.length)}s, at or past --still ${still}`);
            }
        }
    }

    if (sheets !== null && facts.video) {
        const stem = path.basename(video, path.extname(video));
        const isSheet = (name) => name.startsWith(stem + '-sheet-') && /-sheet-\d{2,}\.png$/.test(name);
        try {
            fs.mkdirSync(sheets, { recursive: true });
            const before = new Map(fs.readdirSync(sheets).filter(isSheet).map((n) => [n, fs.statSync(path.join(sheets, n)).mtimeMs]));
            // The image muxer reads % in the whole name as a number pattern, so a
            // % of the folder's or the video's own is doubled.
            const pattern = path.join(sheets, stem + '-sheet-').replace(/%/g, '%%') + '%02d.png';
            const made = run(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-i', video, '-map', '0:v:0', '-vf', `fps=1/${SHEET_EVERY},scale=${SHEET_WIDTH}:-2,tile=3x2`, '-y', pattern]);
            if (made.status !== 0) faults.push(failed('ffmpeg contact sheets', made));
            else {
                // A sheet this run wrote is new or newer than before it ran, and
                // one an earlier, longer video left is neither.
                for (const name of fs.readdirSync(sheets).filter(isSheet).sort()) {
                    const file = path.join(sheets, name);
                    if (!before.has(name) || fs.statSync(file).mtimeMs !== before.get(name)) out.stdout.push(`sheet: ${file}`);
                }
            }
        } catch (err) {
            faults.push(`the contact sheets could not be written (${err && err.code ? err.code : 'no error code'}): ${sheets}`);
        }
    }

    if (faults.length) {
        out.code = 1;
        faults.forEach(say);
        return out;
    }
    out.stdout.push(`passed: ${video}: ${facts.bytes} bytes, ${facts.seconds === null ? 'unknown length' : round(facts.seconds) + 's'}, ${facts.width}x${facts.height} ${facts.codec} ${facts.pixelFormat}, with audio, no still stretch of ${still}s or more`);
    return out;
}

function oneLine(text) {
    return String(text).replace(/\r\n|\r|\n/g, ' ').trim().slice(0, MESSAGE_CUT);
}

// Every line goes out through the kit's one path renderer, so a path under the
// home directory prints as ~ and the account name stays out of the session.
function main(argv, scrub) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        process.stderr.write(scrub('explainer-check: ' + err.message) + '\n');
        return 2;
    }
    const result = check(options);
    if (result.stdout.length) process.stdout.write(scrub(result.stdout.join('\n')) + '\n');
    if (result.stderr.length) process.stderr.write(scrub(result.stderr.join('\n')) + '\n');
    return result.code;
}

module.exports = { parseArgs, check, parseProbe, stillStretches };

if (require.main === module) {
    let scrub;
    try {
        ({ scrub } = require('../hooks/kit-compact-lib.js'));
    } catch {
        process.stderr.write('explainer-check: the kit path renderer hooks/kit-compact-lib.js did not load, so nothing ran\n');
        process.exitCode = 2;
    }
    if (scrub) {
        try {
            process.exitCode = main(process.argv.slice(2), scrub);
        } catch (err) {
            process.stderr.write(scrub('explainer-check: ' + oneLine(err && err.message ? err.message : err)) + '\n');
            process.exitCode = 2;
        }
    }
}
