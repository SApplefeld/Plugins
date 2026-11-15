#!/usr/bin/env node
// explainer-voice: makes one WAV file for each scene of a narration with the
// voice service the Channels broker speaks through, has the same service's
// recognizer read each file back, and writes the timeline a page and the
// capture script read. Usage:
//
//   node explainer-voice.js <narration.json> <output folder> [--settings <path>] [--pause <seconds>] [--remake]
//
// The narration file is a JSON list of scenes, each { "id", "text", "spoken" }.
// `text` is the words shown as captions. `spoken`, where a scene has it, is
// what is sent to the voice in place of `text`, for a name that needs another
// spelling. An id is letters, digits, - and _, since it names the audio file.
//
// timeline.json (and timeline.js, which sets window.EXPLAINER_TIMELINE to the
// same object) holds { voiceId, total, scenes }. `total` is the video's length
// in seconds. Each scene is { id, start, length, audio, audioSeconds, text,
// sent, heard, words }: `start` and `length` in seconds of the video, the
// scene's audio file and its own length, the caption text, the words sent to
// the voice, the recognizer's text (`not checked`, with no words, where no
// read-back ran or it failed), and each heard word as { word, start, end },
// counted in seconds from the start of that scene's own audio, not of the video.
// Exits:
//
//   0  made and read back. One line for each scene (stdout):
//        scene <id>: <seconds>s; <n> characters sent; missed: <words>; added: <words>
//      `missed` lists each word of `text` the recognizer did not hear and
//      `added` each heard word `text` does not hold, compared without case or
//      punctuation. A difference changes no exit code, since a recognizer also
//      mishears a word said correctly. A scene whose audio was kept reads
//      `characters kept`. Then one closing line:
//        sent <n> characters in <n> calls to <voice address>, and made <n> calls to <recognizer address>
//   1  explainer-voice: scene <id>: the voice call failed (<status or cause>): <service message>
//      or, for a file step that failed once the run began:
//        explainer-voice: <what> failed (<error code>): <file>
//      After a failed voice call both timeline files are gone, so the next run
//      makes every scene again. After a failed file step, timeline.js is left
//      only where the step came before any change, and both timeline files
//      are then as the run found them. Otherwise it is gone, so none is left
//      that differs from timeline.json. timeline.json is removed before the
//      first voice call and written again when every scene is made, so one
//      left on disk matches the audio and the next run keeps each unchanged
//      scene it records. A timeline file whose own write failed may be cut
//      short, and reads as none. The closing line still gives the characters
//      sent, 0 where no voice call was made.
//   2  explainer-voice: <a refusal>, one line for each piece that is missing
//      or refused, all of them at once. No call was made, and no file was
//      written or removed.
//   3  explainer-voice: scene <id>: the read-back failed (<status or cause>): <service message>
//      The audio and the timeline are kept, and the scene's heard text reads
//      `not checked`, which sends it to the recognizer again on the next run.
//
// WHAT LEAVES THE MACHINE. Each scene's transcript goes to the voice address
// and each scene's audio to the recognizer address, both in SERVICE below and
// nowhere else. A narration holding a path, a web address or an email address
// is refused before any call, by scene id and never by its text.
//
// THE SETTINGS. Two lines of the Channels broker's settings file are read and
// no other: CHANNEL_SPEECH_KEY_FILE and CHANNEL_SPEECH_VOICE. The default file
// is broker.env in the folder sapplefeld-channels under the account's local
// application data, a Windows place, so any other system takes --settings. A
// key file named by a relative path is read from the settings file's folder,
// and a key file outside that folder is refused before it is opened, the rule
// the broker holds the same file to.
//
// THE KEY. It is read inside the run, lives in locals, and goes into the
// authorization header alone. No line and no file carries it: a failed call
// prints the status and at most 200 characters of the service's own message
// with the key replaced, and a call that threw prints a cause from the kit's
// own classifier, never the runtime's message, which can spell a header back.
//
// A RE-RUN. A scene's audio is kept where its file exists and timeline.json
// records the same sent transcript and the same voice id, and no voice call is
// made for it. --remake makes every scene again. A changed --pause alone makes
// no call and rewrites the timeline.

'use strict';

const fs = require('fs');
const path = require('path');
const endpointLib = require('./kit-endpoint-lib.js');
const { defaultSettingsPath, isInside, settingValue } = require('./explainer-lib.js');

// The voice service as its public reference states it: the two addresses, the
// version header, the model names and the field values. Nothing else in this
// file names any of them.
const SERVICE = Object.freeze({
    versionHeader: 'Cartesia-Version',
    version: '2026-08-14',
    voice: Object.freeze({
        url: 'https://api.cartesia.ai/tts/bytes',
        model: 'sonic-3.6',
        format: Object.freeze({ container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 })
    }),
    recognizer: Object.freeze({
        url: 'https://api.cartesia.ai/stt',
        model: 'ink-whisper',
        language: 'en',
        granularity: 'word'
    })
});

// The voice call's body: these four fields and no other.
function voiceBody(transcript, voiceId) {
    return JSON.stringify({
        model_id: SERVICE.voice.model,
        transcript,
        voice: { id: voiceId },
        output_format: SERVICE.voice.format
    });
}

// The recognizer call's form: the audio and three fields.
function recognizerForm(bytes, name) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), name);
    form.append('model', SERVICE.recognizer.model);
    form.append('language', SERVICE.recognizer.language);
    form.append('timestamp_granularities[]', SERVICE.recognizer.granularity);
    return form;
}

const KEY_FILE_LINE = 'CHANNEL_SPEECH_KEY_FILE';
const VOICE_LINE = 'CHANNEL_SPEECH_VOICE';
const DEFAULT_PAUSE = 0.5;
const NOT_CHECKED = 'not checked';
const KEY_MARK = '[key]';
const MESSAGE_CUT = 200;
const TIMEOUT_MS = 120000;
// The most of a failed call's body that is read to find its message.
const ERROR_BYTES = 8 * 1024;
// The most audio one scene may be, about twelve minutes at the format above.
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const SCENE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// What a bearer key must be made of to ride a request header.
const HEADER_VALUE = /^[\x21-\x7e]+$/;
const USAGE = 'usage: node explainer-voice.js <narration.json> <output folder> [--settings <path>] [--pause <seconds>] [--remake]';

// An argument the script refuses, which exits 2 with its message.
class Refusal extends Error {}

// The file-system error's code alone, never its message.
function codeOf(err) {
    return err && typeof err.code === 'string' && err.code !== '' ? err.code : 'no error code';
}

// A file step that failed once the run began, which exits 1.
class FileFault extends Error {
    constructor(what, file, err) {
        super(what);
        this.what = what;
        this.file = file;
        this.code = codeOf(err);
    }
}

// What `act` returns, or a thrown FileFault naming `what` and `file`.
function onFile(what, file, act) {
    try {
        return act();
    } catch (err) {
        throw new FileFault(what, file, err);
    }
}

// The options the arguments name, or a thrown Refusal.
function parseArgs(argv) {
    const positional = [];
    const options = { settings: null, pause: DEFAULT_PAUSE, remake: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--remake') options.remake = true;
        else if (arg === '--settings') {
            const value = argv[++i];
            if (value === undefined || value === '' || value.startsWith('--')) throw new Refusal('--settings takes one file path');
            options.settings = value;
        } else if (arg === '--pause') {
            const value = argv[++i];
            if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) throw new Refusal('--pause takes a number of seconds, zero or more');
            options.pause = Number(value);
        } else if (arg.startsWith('--')) throw new Refusal(`unknown option ${arg}; ${USAGE}`);
        else positional.push(arg);
    }
    if (positional.length !== 2) throw new Refusal(USAGE);
    options.narration = positional[0];
    options.out = positional[1];
    return options;
}

// The classes of thing a narration may not carry that this text holds. A path
// is a drive letter with a colon and a slash, a backslash between two word
// characters, or a word that opens with a slash or with ~/ and holds a second
// slash. A web address is a word holding ://. An email address is a word
// holding @ with a dot after it. A slash inside a plain word and a bare file
// name are none of these.
function screened(text) {
    const words = text.split(/\s+/);
    const found = [];
    if (/(?<![A-Za-z])[A-Za-z]:[\\/]/.test(text) || /\w\\\w/.test(text) || words.some((w) => /^[^\w/~]*~?\/.*\//.test(w))) found.push('a path');
    if (words.some((w) => w.includes('://'))) found.push('a web address');
    if (words.some((w) => /@.*\./.test(w))) found.push('an email address');
    return found;
}

// The narration's scenes, or null with each fault added to `problems`.
function readNarration(file, io, problems) {
    let scenes;
    try {
        scenes = JSON.parse(String(io.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    } catch {
        problems.push(`no narration file that reads as JSON at ${file}`);
        return null;
    }
    if (!Array.isArray(scenes) || scenes.length === 0) {
        problems.push(`the narration file holds no list of scenes: ${file}`);
        return null;
    }
    const before = problems.length;
    const seen = new Set();
    scenes.forEach((scene, index) => {
        if (scene === null || typeof scene !== 'object' || typeof scene.id !== 'string' || !SCENE_ID.test(scene.id)) {
            problems.push(`scene ${index + 1} has no id of letters, digits, - and _, 64 at most`);
            return;
        }
        // Two ids that differ only in case name one audio file on Windows.
        if (seen.has(scene.id.toLowerCase())) problems.push(`scene ${scene.id} shares its id with an earlier scene`);
        seen.add(scene.id.toLowerCase());
        if (typeof scene.text !== 'string' || scene.text.trim() === '') problems.push(`scene ${scene.id} has no text`);
        if (scene.spoken !== undefined && (typeof scene.spoken !== 'string' || scene.spoken.trim() === '')) {
            problems.push(`scene ${scene.id} has a spoken that is not text`);
        }
        const held = new Set();
        for (const field of [scene.text, scene.spoken]) {
            if (typeof field === 'string') for (const kind of screened(field)) held.add(kind);
        }
        if (held.size) problems.push(`scene ${scene.id} holds ${[...held].join(' and ')}, which no narration may carry`);
    });
    return problems.length === before ? scenes : null;
}

// The key the named file holds, or null with the fault added to `problems`.
// The file is held inside the settings file's folder twice, as written and as
// the file system resolves it, and is opened only after both.
function readKey(named, folder, io, problems) {
    const file = path.resolve(folder, named);
    const outside = () => {
        problems.push(`the key file ${file} is outside the settings folder ${folder}, so it was not opened`);
        return null;
    };
    if (!isInside(file, folder)) return outside();
    let real;
    let realFolder;
    try {
        real = io.realpath(file);
        realFolder = io.realpath(folder);
    } catch {
        problems.push(`no key file at ${file}`);
        return null;
    }
    if (!isInside(real, realFolder)) return outside();
    let key;
    try {
        key = String(io.readFile(real, 'utf8')).trim();
    } catch {
        problems.push(`the key file ${file} cannot be read`);
        return null;
    }
    if (key === '') {
        problems.push(`the key file ${file} is empty`);
        return null;
    }
    // A key a header cannot carry makes every call throw, so it is a missing
    // piece named here and not a failed voice call.
    if (!HEADER_VALUE.test(key)) {
        problems.push(`the key file ${file} holds a character a request header cannot carry`);
        return null;
    }
    return key;
}

// The key and the voice id the settings file names, or null with each missing
// piece added to `problems`.
function readSettings(options, io, problems) {
    let file = options.settings ? path.resolve(options.settings) : null;
    if (file === null) {
        if (io.platform !== 'win32') {
            problems.push('this system has no default settings file; --settings <path> names one');
            return null;
        }
        file = defaultSettingsPath(io.env);
    }
    let text;
    try {
        text = String(io.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    } catch {
        problems.push(`no settings file that can be read at ${file}`);
        return null;
    }
    const keyFile = settingValue(text, KEY_FILE_LINE);
    const voiceId = settingValue(text, VOICE_LINE);
    if (keyFile === null) problems.push(`the settings file ${file} has no ${KEY_FILE_LINE} line`);
    if (voiceId === null) problems.push(`the settings file ${file} has no ${VOICE_LINE} line`);
    const key = keyFile === null ? null : readKey(keyFile, path.dirname(file), io, problems);
    return key === null || voiceId === null ? null : { key, voiceId };
}

// A WAV's length in seconds, read from its header: the data chunk's size over
// the format chunk's byte rate. Null where the bytes are no WAV. A data chunk
// that declares no size, or more than the file holds, as a stream written
// before its length was known does, is as long as the bytes that follow it.
function wavSeconds(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
    let byteRate = 0;
    for (let at = 12; at + 8 <= buffer.length;) {
        const id = buffer.toString('ascii', at, at + 4);
        const size = buffer.readUInt32LE(at + 4);
        const start = at + 8;
        if (id === 'fmt ' && start + 16 <= buffer.length) byteRate = buffer.readUInt32LE(start + 8);
        if (id === 'data') {
            if (byteRate === 0) return null;
            const held = buffer.length - start;
            return (size === 0 || size > held ? held : size) / byteRate;
        }
        at = start + size + (size % 2);
    }
    return null;
}

// Text the service sent, as it may be printed or written: the kit's channel
// guard over it, then the key replaced wherever the service echoed it.
function serviceText(text, key) {
    return endpointLib.neutralize(text).split(key).join(KEY_MARK);
}

// A response body's bytes, read in chunks up to `cap`. `over` says the body
// ran past it, and the read stops there.
async function readBytes(res, cap) {
    const parts = [];
    let size = 0;
    if (!res.body || typeof res.body.getReader !== 'function') return { bytes: Buffer.alloc(0), over: false };
    const reader = res.body.getReader();
    for (;;) {
        const step = await reader.read();
        if (step.done) return { bytes: Buffer.concat(parts), over: false };
        const part = Buffer.from(step.value);
        if (size + part.length > cap) {
            parts.push(part.subarray(0, cap - size));
            try { await reader.cancel(); } catch { /* the bound is what mattered */ }
            return { bytes: Buffer.concat(parts), over: true };
        }
        size += part.length;
        parts.push(part);
    }
}

// A call or a body read that threw, as the kit's own classifier names it and
// never by the runtime's message, which can spell a header back.
function thrownSaid(err) {
    const thrown = endpointLib.classifyThrow(err);
    return `(${thrown.status}: ${thrown.detail})`;
}

// One POST to the service under its clock, with the version and the key in
// its headers. Resolves to what `read` makes of a 2xx answer, or to
// { ok: false, said }, and never throws. The request follows no redirect, so
// the key goes to the address named and to no other.
async function post(io, key, url, headers, body, read) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, TIMEOUT_MS);
    try {
        const res = await io.fetch(url, {
            method: 'POST',
            headers: { ...headers, [SERVICE.versionHeader]: SERVICE.version, Authorization: `Bearer ${key}` },
            body,
            signal: controller.signal,
            redirect: 'manual'
        });
        if (res.status < 200 || res.status >= 300) {
            const said = serviceText((await readBytes(res, ERROR_BYTES)).bytes.toString('utf8'), key).slice(0, MESSAGE_CUT);
            return { ok: false, said: `(status ${res.status})` + (said ? `: ${said}` : '') };
        }
        return await read(res);
    } catch (err) {
        return { ok: false, said: thrownSaid(err) };
    } finally {
        clearTimeout(timer);
    }
}

function callVoice(io, key, transcript, voiceId) {
    return post(io, key, SERVICE.voice.url, { 'Content-Type': 'application/json' }, voiceBody(transcript, voiceId), async (res) => {
        const read = await readBytes(res, MAX_AUDIO_BYTES);
        if (read.over) return { ok: false, said: `(audio past ${MAX_AUDIO_BYTES} bytes)` };
        const seconds = wavSeconds(read.bytes);
        if (seconds === null || seconds <= 0) return { ok: false, said: '(the answer holds no WAV audio)' };
        return { ok: true, bytes: read.bytes, seconds };
    });
}

// The heard words that carry a word, a start and an end, and nothing else of
// what the list held.
function heardWords(list, key) {
    if (!Array.isArray(list)) return [];
    return list
        .filter((w) => w !== null && typeof w === 'object' && typeof w.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end))
        .map((w) => ({ word: serviceText(w.word, key), start: w.start, end: w.end }));
}

function callRecognizer(io, key, bytes, name) {
    return post(io, key, SERVICE.recognizer.url, {}, recognizerForm(bytes, name), async (res) => {
        const read = await endpointLib.readBoundedBody(res);
        // A body read that threw, a timeout among them, names its cause.
        if (!read.ok && read.detail === undefined && read.throwed !== undefined) return { ok: false, said: thrownSaid(read.throwed) };
        if (!read.ok || read.body === null || typeof read.body !== 'object' || typeof read.body.text !== 'string') {
            return { ok: false, said: '(the answer holds no transcript)' };
        }
        return { ok: true, heard: serviceText(read.body.text, key), words: heardWords(read.body.words, key) };
    });
}

// A text's words without case or punctuation.
function plainWords(text) {
    return text.toLowerCase().replace(/['\u2019]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// The words of `from` that `other` does not hold, counting repeats.
function wordsMissing(from, other) {
    const left = new Map();
    for (const word of other) left.set(word, (left.get(word) || 0) + 1);
    const missing = [];
    for (const word of from) {
        if (left.get(word) > 0) left.set(word, left.get(word) - 1);
        else missing.push(word);
    }
    return missing;
}

function round(seconds) {
    return Math.round(seconds * 1000) / 1000;
}

function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

// The timeline an earlier run wrote, or null where none reads.
function readPrior(file, io) {
    try {
        const prior = JSON.parse(String(io.readFile(file, 'utf8')));
        if (prior !== null && typeof prior === 'object' && Array.isArray(prior.scenes)) return prior;
    } catch { /* none: every scene is made */ }
    return null;
}

const SEAMS = {
    fetch: (url, init) => fetch(url, init),
    readFile: fs.readFileSync,
    writeFile: fs.writeFileSync,
    realpath: fs.realpathSync,
    platform: process.platform,
    env: process.env
};

// Makes and reads back the narration options.narration names into the folder
// options.out. Returns { code, stdout, stderr }, each stream a list of lines.
// `seams` replaces any of SEAMS: `fetch` takes the global fetch's arguments
// and returns its response, and `readFile`, `writeFile` and `realpath` take
// the fs module's; the test passes its own.
async function narrate(options, seams = {}) {
    const io = { ...SEAMS, ...seams };
    const out = { code: 0, stdout: [], stderr: [] };
    const say = (msg) => { out.stderr.push('explainer-voice: ' + msg); };

    const problems = [];
    const scenes = readNarration(path.resolve(options.narration), io, problems);
    const settings = readSettings(options, io, problems);
    const folder = path.resolve(options.out);
    if (isFile(folder)) problems.push(`the output folder is a file: ${folder}`);
    if (problems.length) {
        out.code = 2;
        problems.forEach(say);
        return out;
    }

    const { key, voiceId } = settings;
    const pause = options.pause === undefined ? DEFAULT_PAUSE : options.pause;
    const jsonFile = path.join(folder, 'timeline.json');
    const jsFile = path.join(folder, 'timeline.js');
    try {
        fs.mkdirSync(folder, { recursive: true });
    } catch (err) {
        out.code = 2;
        say(`the output folder cannot be made: ${folder} (${codeOf(err)})`);
        return out;
    }
    const prior = options.remake ? null : readPrior(jsonFile, io);

    // A scene is kept where the earlier timeline records its transcript under
    // this voice id and its file still reads as audio.
    const rows = scenes.map((scene) => {
        const sent = scene.spoken === undefined ? scene.text : scene.spoken;
        const row = { id: scene.id, text: scene.text, sent, audio: `scene-${scene.id}.wav`, seconds: null, made: false, heard: NOT_CHECKED, words: [] };
        const was = prior !== null && prior.voiceId === voiceId
            ? prior.scenes.find((s) => s !== null && typeof s === 'object' && s.id === scene.id && s.sent === sent)
            : undefined;
        if (was === undefined) return row;
        try { row.seconds = wavSeconds(io.readFile(path.join(folder, row.audio))); } catch { /* no file: made again */ }
        if (row.seconds === null || row.seconds <= 0) {
            row.seconds = null;
            return row;
        }
        if (typeof was.heard === 'string') {
            row.heard = serviceText(was.heard, key);
            row.words = heardWords(was.words, key);
        }
        return row;
    });

    const calls = { voice: 0, recognizer: 0, characters: 0 };
    const closing = () => `sent ${calls.characters} characters in ${calls.voice} calls to ${SERVICE.voice.url}, and made ${calls.recognizer} calls to ${SERVICE.recognizer.url}`;

    // Every file step from here on throws a FileFault, which exits 1, and the
    // fault removes nothing more. Where any scene needs a voice call, both
    // timeline files go before the first call, timeline.js first, so no
    // timeline outlives a change to the audio. At the end of every run
    // timeline.js goes, timeline.json is written, and then timeline.js, so a
    // timeline.js on disk never differs from the timeline.json beside it.
    const removeTimeline = (file) => onFile('removing the timeline', file, () => fs.rmSync(file, { force: true }));
    try {
        if (rows.some((row) => row.seconds === null)) {
            removeTimeline(jsFile);
            removeTimeline(jsonFile);
        }
        for (const row of rows) {
            if (row.seconds !== null) continue;
            calls.voice += 1;
            calls.characters += row.sent.length;
            const made = await callVoice(io, key, row.sent, voiceId);
            if (!made.ok) {
                say(`scene ${row.id}: the voice call failed ${made.said}`);
                out.code = 1;
                out.stdout.push(closing());
                return out;
            }
            const file = path.join(folder, row.audio);
            onFile(`scene ${row.id}: writing the audio`, file, () => io.writeFile(file, made.bytes));
            row.seconds = made.seconds;
            row.made = true;
        }

        for (const row of rows) {
            if (row.heard !== NOT_CHECKED) continue;
            const file = path.join(folder, row.audio);
            const bytes = onFile(`scene ${row.id}: reading the audio back`, file, () => io.readFile(file));
            calls.recognizer += 1;
            const read = await callRecognizer(io, key, bytes, row.audio);
            if (!read.ok) {
                say(`scene ${row.id}: the read-back failed ${read.said}`);
                out.code = 3;
                continue;
            }
            row.heard = read.heard;
            row.words = read.words;
        }

        let start = 0;
        const timeline = { voiceId, total: 0, scenes: [] };
        for (const row of rows) {
            const audioSeconds = round(row.seconds);
            const length = round(audioSeconds + pause);
            timeline.scenes.push({ id: row.id, start, length, audio: row.audio, audioSeconds, text: row.text, sent: row.sent, heard: row.heard, words: row.words });
            start = round(start + length);
        }
        timeline.total = start;
        const json = JSON.stringify(timeline, null, 2);
        removeTimeline(jsFile);
        onFile('writing the timeline', jsonFile, () => io.writeFile(jsonFile, json + '\n'));
        onFile('writing the timeline', jsFile, () => io.writeFile(jsFile, `window.EXPLAINER_TIMELINE = ${json};\n`));
    } catch (err) {
        if (!(err instanceof FileFault)) throw err;
        say(`${err.what} failed (${err.code}): ${err.file}`);
        out.code = 1;
        out.stdout.push(closing());
        return out;
    }

    const list = (words) => (words.length ? words.join(', ') : 'none');
    for (const row of rows) {
        const written = plainWords(row.text);
        const heard = plainWords(row.heard);
        const readBack = row.heard === NOT_CHECKED
            ? 'read-back not checked'
            : `missed: ${list(wordsMissing(written, heard))}; added: ${list(wordsMissing(heard, written))}`;
        out.stdout.push(`scene ${row.id}: ${round(row.seconds)}s; ${row.sent.length} characters ${row.made ? 'sent' : 'kept'}; ${readBack}`);
    }
    out.stdout.push(closing());
    return out;
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
        process.stderr.write(scrub('explainer-voice: ' + err.message) + '\n');
        return 2;
    }
    const result = await narrate(options);
    if (result.stdout.length) process.stdout.write(scrub(result.stdout.join('\n')) + '\n');
    if (result.stderr.length) process.stderr.write(scrub(result.stderr.join('\n')) + '\n');
    return result.code;
}

module.exports = { parseArgs, narrate, wavSeconds, SERVICE };

if (require.main === module) {
    let scrub;
    try {
        ({ scrub } = require('../hooks/kit-compact-lib.js'));
    } catch {
        process.stderr.write('explainer-voice: the kit path renderer hooks/kit-compact-lib.js did not load, so nothing ran\n');
        process.exitCode = 2;
    }
    if (scrub) {
        main(process.argv.slice(2), scrub).then(
            (code) => { process.exitCode = code; },
            (err) => {
                process.stderr.write(scrub('explainer-voice: ' + oneLine(err && err.message ? err.message : err)) + '\n');
                process.exitCode = 2;
            }
        );
    }
}
