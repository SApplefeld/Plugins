#!/usr/bin/env node
// explainer-preflight: names each piece this machine needs to make an
// explainer video, and what to do about each one it lacks. Usage:
//
//   node explainer-preflight.js [--browser <path>] [--ffmpeg <path>] [--settings <path>]
//
// The flags name the same places the capture, check and narration scripts
// take, so a path found here can be handed on to them. One line for each
// piece (stdout), in this order:
//
//   browser: found <path>
//   ffmpeg: found <path>
//   ffprobe: found <path>
//   settings file: found <path>
//   settings line CHANNEL_SPEECH_KEY_FILE: found
//   settings line CHANNEL_SPEECH_VOICE: found
//   key file: found <path>, <n> bytes
//
// A piece the machine lacks reads `<piece>: missing: <why>; <what to do>`.
// Exits 0 where every piece is found, 1 where any is missing, and 2 for a
// refused argument.
//
// WHAT IT READS. The browser and ffmpeg are looked for as explainer-lib.js
// states, from closed lists or the flags, never from PATH. The settings file
// is read for its two lines alone, through the readers explainer-voice.js
// also takes from explainer-lib.js: the default file is broker.env in the
// folder sapplefeld-channels under the account's local application data, a
// Windows place, a relative key file is read from the settings file's folder,
// and a key file outside that folder, as written or as the file system
// resolves it, is missing. The key file's size is read and its content never
// is, and no call leaves the machine. So a key file reads found where it
// exists and is not empty by size, and the narration script makes the final
// call on its content, refusing there a key of whitespace alone or one a
// request header cannot carry.

'use strict';

const fs = require('fs');
const path = require('path');
const { locate, defaultSettingsPath, isInside, settingValue } = require('./explainer-lib.js');

const KEY_FILE_LINE = 'CHANNEL_SPEECH_KEY_FILE';
const VOICE_LINE = 'CHANNEL_SPEECH_VOICE';
const MESSAGE_CUT = 200;
const USAGE = 'usage: node explainer-preflight.js [--browser <path>] [--ffmpeg <path>] [--settings <path>]';

// What to do about each program the machine lacks, after the flag the
// finder's own sentence names.
const INSTALL = {
    browser: 'or install Microsoft Edge or Google Chrome',
    ffmpeg: 'or install ffmpeg',
    ffprobe: 'or install ffmpeg, which ships ffprobe beside it'
};

// An argument the script refuses, which exits 2 with its message.
class Refusal extends Error {}

// The options the arguments name, or a thrown Refusal.
function parseArgs(argv) {
    const options = { browser: null, ffmpeg: null, settings: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const name = { '--browser': 'browser', '--ffmpeg': 'ffmpeg', '--settings': 'settings' }[arg];
        if (name === undefined) throw new Refusal(`unknown argument ${arg}; ${USAGE}`);
        const value = argv[++i];
        if (value === undefined || value === '' || value.startsWith('--')) throw new Refusal(`${arg} takes one path`);
        options[name] = value;
    }
    return options;
}

// The key file's line: its path and size, or why it is missing. The file is
// held inside the settings folder as written and as resolved, and only its
// size is read.
function keyFileLine(named, folder, io) {
    const file = path.resolve(folder, named);
    const outside = `the key file ${file} is outside the settings folder ${folder}, where explainer-voice.js refuses it; move it into that folder`;
    if (!isInside(file, folder)) return { found: false, line: outside };
    let real;
    let realFolder;
    try {
        real = io.realpath(file);
        realFolder = io.realpath(folder);
    } catch {
        return { found: false, line: `no key file at ${file}; write the voice service's key there` };
    }
    if (!isInside(real, realFolder)) return { found: false, line: outside };
    let size;
    try {
        const stat = io.stat(real);
        if (!stat.isFile()) return { found: false, line: `the key file ${file} is not a file; write the voice service's key there` };
        size = stat.size;
    } catch {
        return { found: false, line: `the key file ${file} cannot be read; give this account read access to it` };
    }
    if (size === 0) return { found: false, line: `the key file ${file} is empty; write the voice service's key into it` };
    return { found: true, line: `${file}, ${size} bytes` };
}

const SEAMS = {
    readFile: fs.readFileSync,
    stat: fs.statSync,
    realpath: fs.realpathSync,
    platform: process.platform,
    env: process.env
};

// Names each piece. Returns { code, stdout, stderr }, each stream a list of
// lines. `seams` replaces any of SEAMS: `readFile`, `stat` and `realpath` take
// the fs module's arguments, and the test passes its own. The settings file is
// the one path `readFile` is called on.
function preflight(options, seams = {}) {
    const io = { ...SEAMS, ...seams };
    const out = { code: 0, stdout: [], stderr: [] };
    const report = (piece, found, line) => {
        out.stdout.push(`${piece}: ${found ? 'found' : 'missing:'}${line ? ' ' + line : ''}`);
        if (!found) out.code = 1;
    };

    const named = { browser: options.browser || null, ffmpeg: options.ffmpeg || null };
    for (const kind of ['browser', 'ffmpeg', 'ffprobe']) {
        const found = locate(kind, named);
        report(kind, found.path !== null, found.path !== null ? found.path : `${found.problem}; ${INSTALL[kind]}`);
    }

    let file = options.settings ? path.resolve(options.settings) : null;
    let text = null;
    if (file === null && io.platform !== 'win32') {
        report('settings file', false, 'this system has no default settings file; --settings <path> names the Channels broker\'s broker.env');
    } else {
        if (file === null) file = defaultSettingsPath(io.env);
        try {
            text = String(io.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
            report('settings file', true, file);
        } catch {
            report('settings file', false, `no settings file that can be read at ${file}; set up the Channels broker's voice, or pass --settings <path>`);
        }
    }

    const noFile = 'no settings file to read it from';
    const keyFile = text === null ? null : settingValue(text, KEY_FILE_LINE);
    const voiceId = text === null ? null : settingValue(text, VOICE_LINE);
    report(`settings line ${KEY_FILE_LINE}`, keyFile !== null, text === null ? noFile : keyFile === null ? `add ${KEY_FILE_LINE}=<key file> to ${file}` : '');
    report(`settings line ${VOICE_LINE}`, voiceId !== null, text === null ? noFile : voiceId === null ? `add ${VOICE_LINE}=<voice id> to ${file}` : '');
    if (keyFile === null) report('key file', false, text === null ? noFile : `the settings file names none; add the ${KEY_FILE_LINE} line`);
    else {
        const key = keyFileLine(keyFile, path.dirname(file), io);
        report('key file', key.found, key.line);
    }
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
        process.stderr.write(scrub('explainer-preflight: ' + err.message) + '\n');
        return 2;
    }
    const result = preflight(options);
    if (result.stdout.length) process.stdout.write(scrub(result.stdout.join('\n')) + '\n');
    if (result.stderr.length) process.stderr.write(scrub(result.stderr.join('\n')) + '\n');
    return result.code;
}

module.exports = { parseArgs, preflight };

if (require.main === module) {
    let scrub;
    try {
        ({ scrub } = require('../hooks/kit-compact-lib.js'));
    } catch {
        process.stderr.write('explainer-preflight: the kit path renderer hooks/kit-compact-lib.js did not load, so nothing ran\n');
        process.exitCode = 2;
    }
    if (scrub) {
        try {
            process.exitCode = main(process.argv.slice(2), scrub);
        } catch (err) {
            process.stderr.write(scrub('explainer-preflight: ' + oneLine(err && err.message ? err.message : err)) + '\n');
            process.exitCode = 2;
        }
    }
}
