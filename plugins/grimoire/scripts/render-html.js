#!/usr/bin/env node
// render-html: renders a self-contained HTML file to a PNG with the browser
// already on the machine, running headless, so a session can read the image
// before it attaches it. Usage:
//
//   node render-html.js <html path> <png path> [--width <n>] [--height <n>] [--browser <path>]
//
// Width defaults to 1080 and height to 960, each an integer from 320 to 4096.
// The HTML path ends .html or .htm and names a file, and the PNG path ends .png
// in a directory that exists, so a swapped pair deletes nothing. Exits:
//
//   0  rendered: <png path> <width>x<height> <bytes> bytes   (stdout), the size
//      and bytes read from the file
//   1  render-html: the browser wrote no image (exit <status>): <spawn error>
//      <browser stderr>, the spawn error naming a timeout where there was one
//   2  render-html: <a refused argument, or no browser, naming every path tried>
//
// The browser is the first existing path of BROWSERS, a closed list of
// literals, as memory-database.js finds sqlcmd: no PATH search and no
// environment variable, since either lets whoever controls that state choose
// the executable. `--browser` names one absolute file path in place of the
// list, which is how a machine with its browser elsewhere is served. The
// browser runs from its own directory, since the Windows loader searches the
// working directory for libraries, and inherits the environment, since it
// needs its own variables to start. It writes into a throwaway profile
// directory created under the OS temp directory and removed after the run, so
// a render never touches the operator's own profile.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

// Edge leads on each platform, since every Windows 11 machine holds it.
const BROWSERS = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 960;
const MIN_SIDE = 320;
const MAX_SIDE = 4096;
const TIMEOUT_MS = 30000;
const STDERR_CUT = 200;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const USAGE = 'usage: node render-html.js <html path> <png path> [--width <n>] [--height <n>] [--browser <path>]';

// An argument the script refuses, which exits 2 with its message.
class Refusal extends Error {}

function side(name, value) {
    if (value === undefined || !/^\d+$/.test(value)) throw new Refusal(`--${name} takes an integer from ${MIN_SIDE} to ${MAX_SIDE}`);
    const n = Number(value);
    if (n < MIN_SIDE || n > MAX_SIDE) throw new Refusal(`--${name} ${value} is outside ${MIN_SIDE} to ${MAX_SIDE}`);
    return n;
}

// The options the arguments name, or a thrown Refusal.
function parseArgs(argv) {
    const positional = [];
    const options = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, browser: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--width') options.width = side('width', argv[++i]);
        else if (arg === '--height') options.height = side('height', argv[++i]);
        else if (arg === '--browser') {
            const value = argv[++i];
            if (value === undefined || value === '' || value.startsWith('--')) throw new Refusal('--browser takes one file path');
            options.browser = value;
        } else if (arg.startsWith('--')) throw new Refusal(`unknown option ${arg}; ${USAGE}`);
        else positional.push(arg);
    }
    if (positional.length !== 2) throw new Refusal(USAGE);
    options.html = positional[0];
    options.png = positional[1];
    return options;
}

// The first path of the list naming a file, or null where none does.
function findBrowser(candidates) {
    for (const candidate of candidates) {
        try {
            if (fs.statSync(candidate).isFile()) return candidate;
        } catch { /* absent: try the next */ }
    }
    return null;
}

function isDirectory(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
}

function oneLine(text) {
    return String(text).replace(/\r\n|\r|\n/g, ' ').trim().slice(0, STDERR_CUT);
}

// Renders options.html to options.png. Returns { code, stdout, stderr }, each
// stream a list of lines. `spawn` takes spawnSync's arguments and returns its
// result shape; the test passes its own.
function render(options, spawn = spawnSync) {
    const out = { code: 0, stdout: [], stderr: [] };
    const refuse = (msg) => { out.code = 2; out.stderr.push('render-html: ' + msg); return out; };

    const html = path.resolve(options.html);
    const png = path.resolve(options.png);
    const width = options.width === undefined ? DEFAULT_WIDTH : options.width;
    const height = options.height === undefined ? DEFAULT_HEIGHT : options.height;
    if (!/\.html?$/i.test(html)) return refuse(`the HTML path must end .html or .htm: ${html}`);
    if (!/\.png$/i.test(png)) return refuse(`the image path must end .png: ${png}`);
    if (!isFile(html)) return refuse(`no HTML file at ${html}`);
    if (!isDirectory(path.dirname(png))) return refuse(`no directory for the image at ${path.dirname(png)}`);
    if (isDirectory(png)) return refuse(`the image path is a directory: ${png}`);
    if (options.browser && !path.isAbsolute(options.browser)) return refuse(`--browser takes an absolute path: ${options.browser}`);

    const candidates = options.browser ? [options.browser] : BROWSERS;
    const browser = findBrowser(candidates);
    if (browser === null) {
        return options.browser
            ? refuse(`no browser at ${candidates[0]}`)
            : refuse(`no browser on this machine; tried ${candidates.join(', ')}`);
    }

    fs.rmSync(png, { force: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'render-html-'));
    let res;
    try {
        res = spawn(browser, [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            '--disable-extensions',
            `--user-data-dir=${profile}`,
            `--window-size=${width},${height}`,
            `--screenshot=${png}`,
            pathToFileURL(html).href
        ], { cwd: path.dirname(browser), encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true });
    } finally {
        try {
            fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
            out.stderr.push('render-html: profile directory not removed: ' + profile);
        }
    }

    const r = res || {};
    let image = null;
    try { image = fs.readFileSync(png); } catch { /* no image: exit 1 below */ }
    // A PNG opens with its signature and then the IHDR chunk, whose first eight
    // data bytes are the width and height the file actually holds.
    if (image && image.length >= 24 && image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        && image.toString('ascii', 12, 16) === 'IHDR') {
        out.stdout.push(`rendered: ${png} ${image.readUInt32BE(16)}x${image.readUInt32BE(20)} ${image.length} bytes`);
        return out;
    }

    const status = r.status !== null && r.status !== undefined ? r.status : (r.signal || 'none');
    // The cut applies to the browser's stderr alone, so a long spawn error
    // never crowds out what the browser said.
    const spawnError = r.error ? String(r.error.message || r.error).replace(/\s+/g, ' ').trim() : '';
    const said = [spawnError, r.stderr ? oneLine(r.stderr) : ''].filter(Boolean).join(' ');
    out.code = 1;
    out.stderr.push(`render-html: the browser wrote no image (exit ${status})` + (said ? `: ${said}` : ''));
    return out;
}

// Every line goes out through the kit's one path renderer, so a path under the
// home directory prints as ~ and the account name stays out of the session.
function main(argv, scrub) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        process.stderr.write(scrub('render-html: ' + err.message) + '\n');
        return 2;
    }
    const result = render(options);
    if (result.stdout.length) process.stdout.write(scrub(result.stdout.join('\n')) + '\n');
    if (result.stderr.length) process.stderr.write(scrub(result.stderr.join('\n')) + '\n');
    return result.code;
}

module.exports = { parseArgs, findBrowser, render, BROWSERS };

if (require.main === module) {
    let scrub;
    try {
        ({ scrub } = require('../hooks/kit-compact-lib.js'));
    } catch {
        process.stderr.write('render-html: the kit path renderer hooks/kit-compact-lib.js did not load, so nothing ran\n');
        process.exitCode = 2;
    }
    if (scrub) {
        try {
            process.exitCode = main(process.argv.slice(2), scrub);
        } catch (err) {
            process.stderr.write(scrub('render-html: ' + oneLine(err && err.message ? err.message : err)) + '\n');
            process.exitCode = 2;
        }
    }
}
