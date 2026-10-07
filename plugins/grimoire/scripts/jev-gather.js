// The gatherer for the promises check: the source files a caller names, read
// as UTF-8 with their comments stripped and concatenated into the one `code`
// string the check sends as its state. It is the only module in the kit that
// reads project files for Jev, so the file screen lives here.
//
// WHAT IS REFUSED BEFORE ANY READ. Every path is screened before any file is
// opened. A path whose base name is on `REFUSED_NAMES`, or a `.json` whose
// parent directory is named `.claude`, is refused as `screened file` with the
// path and nothing else, so a credential or settings file never reaches
// memory here even where it exists and is readable. The match is on the base
// name in lower case, since on Windows `.ENV` is `.env`, and on the
// normalized absolute path, so a dot segment (`.claude/./settings.json`,
// `.claude/x/../settings.json`) does not hide the parent. A file is refused by
// name and never by type: each path is screened as given, then resolved
// through any link and screened again on the name and parent of the file it
// reaches, so a link `util.js -> .env` is refused by `.env` and a link to a
// file with an unlisted name is read as that file would be. Every path is
// screened both ways before any is read. The list is closed: a file not on it
// is read, and the client's own credential screen over the body is the second
// line.
//
// WHAT IS STRIPPED. Comments are removed by extension: `//` and `/* */` for
// .js, .mjs, .cjs, .ts and .cs; `--` and `/* */` for .sql; `#` for .ps1, .sh
// and .py; any other extension is sent as it stands. The scan knows no
// strings, so a comment opener inside a string literal loses the rest of its
// line or block. That is accepted, since the text is a measurement input and
// never runs. The newline a line comment ended on stays, and so does each
// newline inside a block comment, with its carriage return where the file has
// one, so the reader sees the file's line structure.
//
// TWO REASONS, NEVER A THROW. `gatherCode` returns the code or
// `{ ok: false, reason, path }` with `reason` one of:
//
//   screened file    the base name, as given or as resolved, is on the refused
//                    list; the file was not opened
//   unreadable file  the path is missing, a directory, a link that does not
//                    resolve, or could not be read
//
// A refusal carries no file content and no runtime error message.

'use strict';

const fs = require('fs');
const path = require('path');

// The base names no gatherer reads, each pattern matched against the base
// name alone in lower case. The `.claude` parent rule sits in `screenedPath`,
// since it reads the directory above the name.
const REFUSED_NAMES = [
    /^\.env(rc|\..*)?$/,
    /\.(pem|key|pfx|p12|jks|keystore|tfvars|ppk)$/,
    /^id_(rsa|ed25519)/,
    /^\.(npmrc|netrc|pgpass|git-credentials)$/,
    /^credentials/,
    /\.secrets/,
    /^secrets\.json$/,
    /^(kit-jev|kit-endpoint|kit-memory-db|kit-memory-db-logins|grimoire\.local|settings\.local)\.json$/
];

// The line-comment opener per extension that also takes `/* */` blocks, and
// the extensions that take `#` lines alone.
const LINE_AND_BLOCK = { '.js': '//', '.mjs': '//', '.cjs': '//', '.ts': '//', '.cs': '//', '.sql': '--' };
const LINE_ONLY = new Set(['.ps1', '.sh', '.py']);

// Whether the path is refused by name: its base name on the list, or a `.json`
// under a `.claude` directory. The path is normalized first, so the parent
// read is the directory the file sits in and not a dot segment.
function screenedPath(p) {
    const normalized = path.resolve(p);
    const name = path.basename(normalized).toLowerCase();
    if (REFUSED_NAMES.some((shape) => shape.test(name))) return true;
    return name.endsWith('.json') && path.basename(path.dirname(normalized)).toLowerCase() === '.claude';
}

// The file a path reaches through any link, or null where it reaches none: a
// missing file, a dangling link, or a path the file system refuses to walk.
function resolvedPath(p) {
    try {
        return fs.realpathSync(p);
    } catch {
        return null;
    }
}

// One pass over the text. Outside a comment, a line opener drops everything
// up to the next newline, leaving a `\r` before it in place, and a block
// opener drops everything through the block's closer, or to the end of the
// text where it never closes, emitting each newline the block held, with the
// `\r` before it where there was one.
function stripScan(text, lineOpener, block) {
    let out = '';
    let i = 0;
    while (i < text.length) {
        if (text.startsWith(lineOpener, i)) {
            const end = text.indexOf('\n', i);
            if (end === -1) break;
            i = text[end - 1] === '\r' ? end - 1 : end;
            continue;
        }
        if (block !== null && text.startsWith(block[0], i)) {
            const close = text.indexOf(block[1], i + block[0].length);
            const stop = close === -1 ? text.length : close + block[1].length;
            for (let j = i; j < stop; j += 1) if (text[j] === '\n') out += text[j - 1] === '\r' ? '\r\n' : '\n';
            i = stop;
            continue;
        }
        out += text[i];
        i += 1;
    }
    return out;
}

function stripComments(text, ext) {
    const e = ext.toLowerCase();
    if (LINE_ONLY.has(e)) return stripScan(text, '#', null);
    if (Object.hasOwn(LINE_AND_BLOCK, e)) return stripScan(text, LINE_AND_BLOCK[e], ['/*', '*/']);
    return text;
}

// The paths as code: `{ ok: true, code, files }`, with `code` the files in
// argument order, each opened by a line `==== <path as given>` and followed
// by its stripped text, ended with a newline where the text had none so the
// next opener starts a line, and `files` the count. Or the first refusal met.
// Three passes in order, so no refused file is opened: every given path is
// screened, then every path is resolved and screened as the file it reaches,
// then the files are read.
function gatherCode(paths) {
    for (const p of paths) {
        if (screenedPath(p)) return { ok: false, reason: 'screened file', path: p };
    }
    for (const p of paths) {
        const resolved = resolvedPath(p);
        if (resolved === null) return { ok: false, reason: 'unreadable file', path: p };
        if (screenedPath(resolved)) return { ok: false, reason: 'screened file', path: p };
    }
    let code = '';
    let files = 0;
    for (const p of paths) {
        let text = '';
        try {
            text = fs.readFileSync(p, 'utf8');
        } catch {
            return { ok: false, reason: 'unreadable file', path: p };
        }
        const stripped = stripComments(text, path.extname(p));
        code += `==== ${p}\n${stripped}`;
        if (!stripped.endsWith('\n')) code += '\n';
        files += 1;
    }
    return { ok: true, code, files };
}

module.exports = {
    gatherCode
};
