// explainer-lib: finds the programs the explainer scripts start, for
// explainer-capture.js, explainer-check.js and explainer-preflight.js alike,
// and reads the Channels broker's settings file one way for
// explainer-voice.js and explainer-preflight.js.
//
// Each program is the first existing path of a closed list of literals, or the
// one absolute path a flag names in place of the list. Nothing is looked up on
// PATH or in an environment variable, since either lets whoever controls that
// state choose the executable. The browser list is render-html.js's own.
// ffprobe is looked for where ffmpeg is: the same list with ffprobe in place of
// ffmpeg, or the file beside the ffmpeg that --ffmpeg names.
//
// The settings file's default place is broker.env in the folder
// sapplefeld-channels under the account's local application data, a Windows
// place. A line reads NAME=value, and a key file is held strictly inside the
// settings file's folder, the rule the broker holds the same file to.

'use strict';

const os = require('os');
const path = require('path');
const { findBrowser, BROWSERS } = require('./render-html.js');

const FFMPEGS = Object.freeze([
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg'
]);

// The file named ffprobe, with the ffmpeg's own extension, in the ffmpeg's folder.
function besideFfmpeg(ffmpeg) {
    return path.join(path.dirname(ffmpeg), 'ffprobe' + path.extname(ffmpeg));
}

const FFPROBES = Object.freeze(FFMPEGS.map(besideFfmpeg));

const FLAGS = { browser: '--browser', ffmpeg: '--ffmpeg', ffprobe: '--ffmpeg' };

// Where `kind` (browser, ffmpeg or ffprobe) is on this machine, given the
// paths --browser and --ffmpeg named, each null where none was named. Returns
// { path, problem }: the path found, or null with a sentence naming what was
// tried and the flag that names another place.
function locate(kind, named) {
    const flag = FLAGS[kind];
    const given = kind === 'browser' ? named.browser : named.ffmpeg;
    if (given) {
        if (!path.isAbsolute(given)) return { path: null, problem: `${flag} takes an absolute path: ${given}` };
        const candidate = kind === 'ffprobe' ? besideFfmpeg(given) : given;
        const found = findBrowser([candidate]);
        return found ? { path: found, problem: null } : { path: null, problem: `no ${kind} at ${candidate}` };
    }
    const list = kind === 'browser' ? BROWSERS : kind === 'ffmpeg' ? FFMPEGS : FFPROBES;
    const found = findBrowser(list);
    return found
        ? { path: found, problem: null }
        : { path: null, problem: `no ${kind} on this machine; tried ${list.join(', ')}; ${flag} <absolute path> names one` };
}

// The default settings file on Windows, under the local application data the
// environment names, or under the home directory where it names none.
function defaultSettingsPath(env) {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'sapplefeld-channels', 'broker.env');
}

// Whether `file` resolves to a path strictly inside `root`. A path on another
// drive comes back from path.relative absolute.
function isInside(file, root) {
    const relative = path.relative(root, file);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// The value of the last `NAME=value` line for this name, with the space around
// it and one pair of quotes around it removed, or null where no line gives one.
function settingValue(text, name) {
    let value = null;
    for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith(name + '=')) continue;
        value = line.slice(name.length + 1).trim();
        if (value.length >= 2 && (value[0] === '"' || value[0] === '\'') && value[value.length - 1] === value[0]) value = value.slice(1, -1);
    }
    return value === '' ? null : value;
}

// This process's environment without FFREPORT, which would have ffmpeg and
// ffprobe write a log file wherever its value names. Windows reads the name in
// any case.
function ffmpegEnvironment() {
    return Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'FFREPORT'));
}

module.exports = { locate, ffmpegEnvironment, besideFfmpeg, FFMPEGS, FFPROBES, defaultSettingsPath, isInside, settingValue };
