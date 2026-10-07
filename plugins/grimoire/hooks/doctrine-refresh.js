#!/usr/bin/env node
// SessionStart hook: keep the Code-surface operating doctrine current, always-on.
//
// The doctrine is single-sourced as the operating-instructions skill (which rides
// plugin auto-update to every surface). On Claude Code we want it ALWAYS-ON, not
// on-demand, so this hook maintains a stable, kit-owned file that the user's
// ~/.claude/CLAUDE.md imports:
//
//   0. Move the files an install under the plugin's former name wrote (the
//      doctrine file, its stamp and the kaizen signpost) onto the current names,
//      never over a file already under the current name, and swap the first
//      CLAUDE.md line that is exactly the former import token for the current
//      one, whatever else the file holds, saying so in one additionalContext
//      line.
//   1. Read the installed skill's SKILL.md from CLAUDE_PLUGIN_ROOT, strip the YAML
//      frontmatter, and write one header line plus the body to
//      ~/.claude/grimoire-doctrine.md whenever it differs. Reading from
//      CLAUDE_PLUGIN_ROOT each session means the current (auto-updated) plugin is
//      always the source, so the version-stamped cache path never leaks into the
//      import and the import line never goes stale. The header is an HTML comment
//      naming this hook as the writer and the skill as the source of truth, so a
//      hand edit meets its owner; it is never part of the skill body, and the
//      doctor's comparison strips it.
//      A long-lived session can still run on a superseded plugin cache, so every
//      write records grimoire-doctrine.stamp.json beside the file: the writer's
//      payload time (the skill file's mtime, which the install copies from the
//      marketplace clone, so a later version whose skill changed carries a later
//      time), its build hash from .claude-plugin/build-info.json ("unknown" where
//      the root carries none, as a marketplace install does), and its root's
//      directory name, which on a marketplace install is the commit's short hash.
//      A writer whose payload time is older than the
//      stamped one declines to write where the file exists; where it is absent
//      there is no newer text to keep, so the writer writes and stamps. At a
//      session start (startup or resume) a decline says so in one
//      additionalContext line naming both writers' root directories and hashes,
//      and the stamp whose deletion lets the next session write; at clear and
//      compact it declines silently. The order is time alone: two hashes have no
//      order, so the hash rides for the decline line only. A missing or malformed
//      stamp reads as no stamp, and the writer writes and stamps.
//   2. If ~/.claude/CLAUDE.md is absent or its text does not contain the
//      `@grimoire-doctrine.md` import token, OFFER (never silently perform) to
//      add that one-line import. The doctrine file is kit-owned and safe to
//      overwrite silently; the user's personal CLAUDE.md is not, so adding to it
//      stays consent-gated at the agent layer. The one change made to it
//      unprompted is step 0's swap of a line that is exactly the former import
//      token, which is reported after it lands. Where step 0 kept a temp file in
//      place of a missing CLAUDE.md, no offer is made.
//
// SAFETY: fails OPEN and silent. Missing skill, unreadable/unwritable paths, an
// up-to-date file with the import already present, or any error -> exit 0, no
// output. The one error that prints is a step 0 swap that leaves CLAUDE.md
// missing, which names the kept temp file, as the rewritten file where its
// write and close completed and as a partial copy where they did not.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DOCTRINE_FILE = 'grimoire-doctrine.md';     // kit-owned, lives in ~/.claude
const IMPORT_TOKEN = '@grimoire-doctrine.md';      // the line ~/.claude/CLAUDE.md needs
const STAMP_FILE = 'grimoire-doctrine.stamp.json'; // the last writer's payload time, hash and root directory
const HEADER =
    '<!-- Written by the grimoire doctrine-refresh hook from skills/operating-instructions/SKILL.md; ' +
    'edit the skill, not this file. -->';
const SESSION_START_SOURCES = ['startup', 'resume'];
const SIGNPOST_FILE = 'grimoire.local.json';       // the kaizen signpost, which the doctor writes

// These spell the plugin's former name because they read the files earlier
// installs wrote, which the migration step below moves to the names above.
const OLD_DOCTRINE_FILE = 'claude-kit-doctrine.md';
const OLD_IMPORT_TOKEN = '@claude-kit-doctrine.md';
const OLD_STAMP_FILE = 'claude-kit-doctrine.stamp.json';
const OLD_SIGNPOST_FILE = 'claude-kit.local.json';

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Locate the installed operating-instructions skill. Prefer the plugin root the
// host provides; fall back to this file's own location.
function skillPath() {
    const rel = path.join('skills', 'operating-instructions', 'SKILL.md');
    const candidates = [];
    if (process.env.CLAUDE_PLUGIN_ROOT) candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, rel));
    candidates.push(path.join(__dirname, '..', rel));
    for (const f of candidates) {
        try { if (fs.statSync(f).isFile()) return f; } catch { /* try next */ }
    }
    return null;
}

// Drop a leading YAML frontmatter block (--- ... ---) and one blank line after it.
function stripFrontmatter(text) {
    const lines = text.split('\n');
    if ((lines[0] || '').trim() !== '---') return text;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end === -1) return text;                      // no closing fence: leave as-is
    return lines.slice(end + 1).join('\n').replace(/^\r?\n/, '');
}

// The build hash of the plugin root the skill was found under, from the stamp the
// build writes into .claude-plugin/build-info.json. The file is gitignored, so a
// marketplace install and an unbuilt checkout carry none, and an unreadable or
// hashless one reads the same: "unknown".
function buildHash(pluginRoot) {
    try {
        // Strip a leading BOM: a UTF-8-with-BOM stamp would otherwise fail JSON.parse.
        const info = JSON.parse(fs.readFileSync(
            path.join(pluginRoot, '.claude-plugin', 'build-info.json'), 'utf8').replace(/^\uFEFF/, ''));
        if (info && typeof info.hash === 'string' && info.hash) return info.hash;
    } catch { /* absent or unreadable */ }
    return 'unknown';
}

// The stamp the last write left, or null where it is absent, unreadable,
// malformed, or carries no finite payload time: each of those reads as no stamp.
function readStamp(stampPath) {
    try {
        const s = JSON.parse(fs.readFileSync(stampPath, 'utf8').replace(/^\uFEFF/, ''));
        if (s && Number.isFinite(s.payloadMtimeMs)) {
            const named = (v) => (typeof v === 'string' && v ? v : 'unknown');
            return { payloadMtimeMs: s.payloadMtimeMs, hash: named(s.hash), root: named(s.root) };
        }
    } catch { /* absent or malformed */ }
    return null;
}

// Rename from to to inside dir where from exists and to does not, so a file
// already under the new name is never replaced. True where the rename landed.
function renameIfFree(dir, from, to) {
    try {
        if (!fs.existsSync(path.join(dir, from)) || fs.existsSync(path.join(dir, to))) return false;
        fs.renameSync(path.join(dir, from), path.join(dir, to));
        return true;
    } catch { return false; }                         // locked or unwritable: give up quietly
}

// The UTF-8 byte order mark as latin1 text, which a file read as latin1 can
// carry ahead of line 1.
const LATIN1_BOM = '\xEF\xBB\xBF';

// A line of CLAUDE.md split with /(?<=\n)/, less its \r\n or \n terminator.
const lineText = (seg) => seg.replace(/\r?\n$/, '');

// Move a home an earlier install wrote under the plugin's former name onto the
// current names. The doctrine file moves where its new name is absent, and its
// stamp moves only in that same run, since a lone old stamp beside a current
// file describes some other write. The signpost moves on its own. In CLAUDE.md
// the first line that is exactly the old import token, terminator aside and
// case-sensitive, becomes the new token every time: once the doctrine file is
// renamed that line imports nothing, whatever else the file holds, and a second
// import line loads the same file once. The line is matched by its text alone,
// so a line inside a comment or a code block is rewritten too. On line 1 a
// UTF-8 byte order mark is set aside for the comparison and written back. The
// file is read and written as latin1 so every other byte, line endings
// included, is written back as it was read. A CLAUDE.md that is a link, or a
// chain of them, is followed to its final target, which is rewritten and the
// links kept. The rewrite goes to a temp file beside that target, named with
// the pid and a random suffix and opened exclusively so no existing file is
// reused, and is renamed over the target, so a killed process never truncates
// the user's file. Off Windows the temp takes the target's mode before it holds
// any text, so the file keeps its permission bits. Returns { line, kept }: line
// is the session-start line reporting the import swap or naming a kept temp
// file, or null; kept is true where the target is missing and the temp, whole
// or partial, is kept and named in its place.
function migrateFormerName(claudeDir) {
    if (renameIfFree(claudeDir, OLD_DOCTRINE_FILE, DOCTRINE_FILE)) {
        renameIfFree(claudeDir, OLD_STAMP_FILE, STAMP_FILE);
    }
    renameIfFree(claudeDir, OLD_SIGNPOST_FILE, SIGNPOST_FILE);
    const quiet = { line: null, kept: false };
    let target = null;
    let tempPath = null;
    let fd = null;
    let written = false;
    try {
        target = fs.realpathSync(path.join(claudeDir, 'CLAUDE.md'));
        const segments = fs.readFileSync(target, 'latin1').split(/(?<=\n)/);
        const bom = segments[0].startsWith(LATIN1_BOM) ? LATIN1_BOM : '';
        const at = segments.findIndex((seg, i) => lineText(i === 0 ? seg.slice(bom.length) : seg) === OLD_IMPORT_TOKEN);
        if (at < 0) return quiet;
        const lead = at === 0 ? bom : '';
        segments[at] = lead + IMPORT_TOKEN + segments[at].slice(lead.length + OLD_IMPORT_TOKEN.length);
        const candidate = `${target}.tmp-migrate-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        fd = fs.openSync(candidate, 'wx');
        tempPath = candidate;                         // this run created it, so this run owns it
        // On Windows fchmod maps only the read-only bit, which carries no
        // permission information worth copying, so it runs off Windows only,
        // before the temp holds any of the user's text.
        if (process.platform !== 'win32') fs.fchmodSync(fd, fs.statSync(target).mode & 0o7777);
        fs.writeFileSync(fd, Buffer.from(segments.join(''), 'latin1'));
        fs.closeSync(fd);
        fd = null;
        written = true;                               // write and close completed: the temp holds the whole rewrite
        fs.renameSync(tempPath, target);
        return { line: `Kit renamed: ~/.claude/CLAUDE.md had the line "${OLD_IMPORT_TOKEN}", the doctrine file's former ` +
            `name, so that line now reads "${IMPORT_TOKEN}", the file's current name. No other line changed.`, kept: false };
    } catch {
        // Absent or unwritable: give up quietly. A temp file this run created
        // is removed only while the target still exists, so the one complete
        // copy is never the one deleted; where the target is gone, the kept
        // temp is named, as the rewritten file where its write and close
        // completed and as a partial copy where they did not.
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* best effort */ } }
        if (!tempPath || !target) return quiet;
        if (fs.existsSync(target)) {
            try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
            return quiet;
        }
        if (!fs.existsSync(tempPath)) return quiet;
        // Both paths come from disk and enter a channel a model reads, so they
        // take that channel's path renderer.
        try {
            const { displayPath } = require('./kit-compact-lib.js');
            const kept = written
                ? `The rewritten file is kept at ${displayPath(tempPath)}; rename it to ${displayPath(target)}.`
                : `The partial temp file ${displayPath(tempPath)} is kept; its write did not complete, so it is ` +
                    `not a whole copy of the file.`;
            return {
                line: `Kit rename incomplete: the rewrite of ~/.claude/CLAUDE.md's import line could not be put in ` +
                    `place and ${displayPath(target)} is missing. ${kept}`,
                kept: true
            };
        } catch { return quiet; }
    }
}

function main() {
    let payload = {};
    try { payload = JSON.parse(readStdin() || '{}') || {}; } catch { /* malformed: defaults */ }
    const atSessionStart = SESSION_START_SOURCES.includes(payload.source || 'startup');

    const sp = skillPath();
    if (!sp) return;                                  // skill not installed: silent

    let body;
    let payloadMtimeMs;
    try {
        body = stripFrontmatter(fs.readFileSync(sp, 'utf8').replace(/^\uFEFF/, ''));
        payloadMtimeMs = fs.statSync(sp).mtimeMs;
    }
    catch { return; }
    if (!body.trim()) return;                         // empty doctrine: nothing to do

    const claudeDir = path.join(os.homedir(), '.claude');
    const doctrinePath = path.join(claudeDir, DOCTRINE_FILE);
    const stampPath = path.join(claudeDir, STAMP_FILE);
    const lines = [];

    // 0. Move a home the plugin's former name wrote onto the current names, so
    //    the refresh below finds the file and stamp it owns.
    const migrated = migrateFormerName(claudeDir);
    if (migrated.line) lines.push(migrated.line);

    // 1. Refresh the kit-owned doctrine file silently when it drifts, unless a
    //    newer payload wrote it last.
    try {
        const pluginRoot = path.dirname(path.dirname(path.dirname(sp)));
        const hash = buildHash(pluginRoot);
        const root = path.basename(pluginRoot);
        const stamp = readStamp(stampPath);
        if (stamp && payloadMtimeMs < stamp.payloadMtimeMs && fs.existsSync(doctrinePath)) {
            if (atSessionStart) {
                // Both roots' names and hashes are read from disk and enter a
                // channel a model reads, so they take that channel's renderer.
                const { sanitizeForOutput: sanitize } = require('./kit-compact-lib.js');
                lines.push(
                    `Kit doctrine not refreshed: this session's grimoire plugin (${sanitize(root)}, ` +
                    `build ${sanitize(hash)}) is older than the one that last wrote ~/.claude/${DOCTRINE_FILE} ` +
                    `(${sanitize(stamp.root)}, build ${sanitize(stamp.hash)}), so the file was left as that plugin wrote it. Deleting ` +
                    `~/.claude/${STAMP_FILE} lets the next session write it.`);
            }
        } else {
            const eol = body.includes('\r\n') ? '\r\n' : '\n';
            const content = HEADER + eol + body;
            let current = null;
            try { current = fs.readFileSync(doctrinePath, 'utf8'); } catch { /* absent */ }
            if (current !== content) {
                fs.mkdirSync(claudeDir, { recursive: true });
                fs.writeFileSync(doctrinePath, content, 'utf8');
            }
            if (!stamp || stamp.payloadMtimeMs !== payloadMtimeMs || stamp.hash !== hash || stamp.root !== root) {
                fs.mkdirSync(claudeDir, { recursive: true });
                fs.writeFileSync(stampPath, JSON.stringify({ payloadMtimeMs, hash, root }) + '\n', 'utf8');
            }
        }
    } catch { /* unwritable home: give up quietly, never block */ }

    // 2. Offer to wire the import if the user's CLAUDE.md does not have it,
    //    unless step 0 kept a temp file in place of a missing CLAUDE.md, whose
    //    line already names it.
    let userClaudeMd = null;
    try { userClaudeMd = fs.readFileSync(path.join(claudeDir, 'CLAUDE.md'), 'utf8'); } catch { /* absent */ }
    if (!migrated.kept && (userClaudeMd === null || !userClaudeMd.includes(IMPORT_TOKEN))) {
        lines.push(
            `Kit doctrine not wired in: the operating doctrine is installed and auto-refreshed at ` +
            `~/.claude/${DOCTRINE_FILE}, but ~/.claude/CLAUDE.md does not import it, so it is not loading ` +
            `always-on here. Offer to add the single line "${IMPORT_TOKEN}" to ~/.claude/CLAUDE.md ` +
            `(creating the file if absent), and act ONLY on the user's explicit approval - it is their ` +
            `personal config. Once added, the doctrine loads always-on and stays current automatically. ` +
            `If the user declines, do not raise it again this session.`);
    }
    if (!lines.length) return;                        // current, or declined quietly, and wired: silent

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') }
    }));
}

try { main(); } catch { /* never break a session over a hook */ }
// Zero without process.exit(): the wiring offer is a single stdout write the
// session depends on, and forcing the exit can discard a write still in flight
// on a pipe. Nothing above sets a nonzero code, and main() is wrapped, so the
// process ends at 0 once stdout has drained.
process.exitCode = 0;
