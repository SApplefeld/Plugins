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
// CHANGED REGIONS AGAINST A BASE. Given a base ref, each file sends only its
// changed regions against that commit, so a file too large to send whole can
// still be checked. Every git call runs through `gitRun` in
// hooks/kit-git-lib.js, an argument vector with no shell, with
// `--no-optional-locks` so no read rewrites the index and `--no-lazy-fetch`
// so a partial clone fetches nothing, and all of them run after both screens
// and before this module opens any file. A ref opening with `-` is refused
// before git sees it, so no ref is read as an option. Each file's repository
// is the one `rev-parse --show-toplevel` names from the file's directory, and
// the ref is resolved to a commit once per repository. A file the commit's
// tree does not list is sent whole under the plain header, since every line
// of it is new. A held file sends the post-image line ranges of `git diff
// --unified=30 <commit> -- <file>`, each hunk header's `+c,d` naming lines c
// to c+d-1: the whole working-tree file is stripped as any file is, which
// keeps every newline, and those lines of the stripped text are sent, hunks
// in order with nothing between them, so a comment crossing a hunk's edge is
// stripped as the file reads. The regions are opened by `==== <path as given>
// (changed regions against <ref>)`. A file with no diff, whose diff holds
// headers alone, as a mode change does, or whose hunks only remove lines,
// sends nothing and is not counted. A held file whose diff holds a line
// opening `Binary files ` stops the run, so no file git diffs as binary is
// sent. A file under a clean filter or a `working-tree-encoding` attribute is
// cut by the line numbers of the text git diffed, from its raw working-tree
// text. A git call that does not run or fails is a refusal, and a diff past
// the runner's 1 MB output cap is refused as a git call that did not run. A hunk naming lines past the stripped file's end is a refusal too.
// None falls back to the whole file, which would send what the base was given
// to withhold.
//
// FOUR REASONS, NEVER A THROW. `gatherCode` returns the code or
// `{ ok: false, reason, path }` with `reason` one of:
//
//   screened file    the base name, as given or as resolved, is on the refused
//                    list; the file was not opened
//   unreadable file  the path is missing, a directory, a link that does not
//                    resolve, or could not be read
//   binary file      a base ref was given and git diffs the held file as
//                    binary; the file was not opened
//   base refused     a base ref was given and its git read failed or named
//                    lines the file lacks; `detail` names the rule with the
//                    ref or the path
//
// A refusal carries no file content and no runtime error message.

'use strict';

const fs = require('fs');
const path = require('path');

const { gitRun } = require('../hooks/kit-git-lib.js');

// Bound on one git call under a base ref, long enough for a diff of a 400 KB
// file.
const GIT_TIMEOUT_MS = 30000;

// One git call under a base ref, through the kit's runner, with the top-level
// options every such call carries.
function git(dir, args) {
    return gitRun(dir, ['--no-optional-locks', '--no-lazy-fetch', ...args], { timeoutMs: GIT_TIMEOUT_MS });
}

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

// The post-image line ranges of a one-file unified diff, each `[first, count]`
// from a hunk header `@@ -a,b +c,d @@`, a count left out reading 1, in diff
// order. A hunk with no post-image line adds no range, and a diff of headers
// alone, such as a mode change, gives none. Null where a line opens `Binary
// files `, which is how git diffs a binary file.
function hunkRanges(diff) {
    if (/^Binary files /m.test(diff)) return null;
    const headers = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)];
    return headers.map((m) => [Number(m[1]), m[2] === undefined ? 1 : Number(m[2])]).filter(([, count]) => count > 0);
}

function baseRefused(detail) {
    return { ok: false, reason: 'base refused', detail };
}

// Each path's part under the base ref, read by git alone: its post-image line
// ranges, none for a file with no diff, or null for a file the commit does
// not hold, which is sent whole. Or the first refusal met. The base name
// comes from the native real path, which on Windows carries the case the file
// system stores, so a path typed in another case still names the file git
// tracks.
function baseParts(paths, base) {
    if (base.startsWith('-')) return { refusal: baseRefused(`the base ref ${base} opens with -`) };
    const places = [];
    const commits = new Map();
    for (const p of paths) {
        let file = '';
        try {
            file = fs.realpathSync.native(p);
        } catch {
            return { refusal: { ok: false, reason: 'unreadable file', path: p } };
        }
        const where = git(path.dirname(file), ['rev-parse', '--show-toplevel', '--show-prefix']);
        if (where === null) return { refusal: baseRefused(`git could not be run for ${p}`) };
        if (where.status !== 0) return { refusal: baseRefused(`the source file is in no git repository: ${p}`) };
        const [top, prefix] = where.stdout.split('\n');
        if (!commits.has(top)) {
            const verified = git(top, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
            if (verified === null) return { refusal: baseRefused(`git could not be run for ${p}`) };
            if (verified.status !== 0) return { refusal: baseRefused(`the base ref ${base} names no commit in the repository of ${p}`) };
            commits.set(top, verified.stdout.trim());
        }
        places.push({ p, top, rel: prefix + path.basename(file), commit: commits.get(top) });
    }
    const parts = [];
    for (const { p, top, rel, commit } of places) {
        // The commit's tree is read and not the file's object, since a partial
        // clone can list a file whose object it lacks, and under
        // --no-lazy-fetch that file must reach the diff's refusal rather than
        // be sent whole as new. --literal-pathspecs keeps a file name from
        // reading as pathspec magic.
        const held = git(top, ['--literal-pathspecs', 'ls-tree', commit, '--', rel]);
        if (held === null || held.status !== 0) return { refusal: baseRefused(`git could not read the changed regions of ${p}`) };
        if (held.stdout === '') {
            parts.push(null);
            continue;
        }
        // --no-ext-diff and --no-textconv keep a repository's config from
        // running a diff or textconv program over the diff. A clean filter or
        // process driver the repository's attributes name for the file still
        // runs, since git applies it to the working-tree file before diffing.
        const diff = git(top, ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=30', commit, '--', rel]);
        if (diff === null || diff.status !== 0) return { refusal: baseRefused(`git could not read the changed regions of ${p}`) };
        const ranges = hunkRanges(diff.stdout);
        if (ranges === null) return { refusal: { ok: false, reason: 'binary file', path: p } };
        parts.push(ranges);
    }
    return { parts };
}

// The paths as code: `{ ok: true, code, files }`, with `code` the files in
// argument order, each opened by a line `==== <path as given>` and followed
// by its stripped text, ended with a newline where the text had none so the
// next opener starts a line, and `files` the count. Or the first refusal met.
// Three passes in order, so no refused file is opened: every given path is
// screened, then every path is resolved and screened as the file it reaches,
// then the files are read. Under `base`, a ref or undefined, the git reads
// run between the second pass and the third, and a held file's changed
// regions, cut from its stripped text, replace that text.
function gatherCode(paths, base) {
    for (const p of paths) {
        if (screenedPath(p)) return { ok: false, reason: 'screened file', path: p };
    }
    for (const p of paths) {
        const resolved = resolvedPath(p);
        if (resolved === null) return { ok: false, reason: 'unreadable file', path: p };
        if (screenedPath(resolved)) return { ok: false, reason: 'screened file', path: p };
    }
    let parts = null;
    if (base !== undefined) {
        const read = baseParts(paths, base);
        if (read.refusal) return read.refusal;
        parts = read.parts;
    }
    let code = '';
    let files = 0;
    for (const [i, p] of paths.entries()) {
        const ranges = parts === null ? null : parts[i];
        if (ranges !== null && ranges.length === 0) continue;
        let text = '';
        try {
            text = fs.readFileSync(p, 'utf8');
        } catch {
            return { ok: false, reason: 'unreadable file', path: p };
        }
        let stripped = stripComments(text, path.extname(p));
        if (ranges !== null) {
            const lines = stripped.split(/(?<=\n)/);
            if (ranges.some(([first, count]) => first + count - 1 > lines.length)) return baseRefused(`the changed regions of ${p} run past the file`);
            stripped = ranges.map(([first, count]) => lines.slice(first - 1, first - 1 + count).join('')).join('');
        }
        code += ranges !== null ? `==== ${p} (changed regions against ${base})\n${stripped}` : `==== ${p}\n${stripped}`;
        if (!stripped.endsWith('\n')) code += '\n';
        files += 1;
    }
    return { ok: true, code, files };
}

module.exports = {
    gatherCode
};
