#!/usr/bin/env node
// memq shim: the stable entry point for memq. Doctor -Fix copies this file to
// ~/.claude/bin/memq-shim.js beside one wrapper per shell that resolves a
// command differently (memq.ps1 for PowerShell, memq.cmd for cmd, an
// extensionless sh script for Git Bash), so `memq` resolves in every shell
// while the real memq.js stays inside the installed plugin payload.
// install-memq-shim.ps1 beside the doctor owns those wrappers and explains
// why PowerShell gets its own.
//
// The payload's cache path carries the release version
// (~/.claude/plugins/cache/<marketplace>/grimoire/<version>/), so a path
// baked in at install time rots at the next kit update. This shim bakes in
// nothing: every invocation re-resolves the installed payload and runs its
// scripts/memq.js, so a kit update needs no doctor re-run; only a first
// install or a moved ~/.claude does. Changes to memq.js ride the plugin cache
// automatically; changes to this file reach a machine at the next -Fix.
//
// Resolution order, first hit wins:
//   1. installed_plugins.json in the plugins directory: the harness's own
//      record of the active install. Running the payload the harness runs
//      beats running a newer cache entry the harness has not activated.
//   2. The newest cache entry for the kit (by directory mtime), restricted to
//      the marketplace the manifest names when it names one. This is the
//      fallback when the manifest is absent, unparseable, shaped differently
//      by a harness update, or pointing at a path that no longer holds the
//      script.
// An entry counts only when scripts/memq.js actually exists in it, so a
// half-removed cache directory is never chosen. Marketplace is part of a
// payload's identity, not decoration: a second marketplace can carry a
// directory named grimoire, and this resolver decides which JavaScript
// runs, so the manifest's marketplace pins the scan, and a scan with no
// manifest to pin it notes on stderr when more than one marketplace offers a
// candidate. Ordering is total (mtime, then marketplace, then version), so
// two runs against one unchanged store always pick the same entry.
//
// When nothing resolves, the exit is 1 with a note naming the fix; every
// other outcome is memq's own, with its exit code and stdio passed straight
// through.
//
// KIT_PLUGINS_ROOT replaces ~/.claude/plugins as the directory searched, and
// is honored only when KIT_PLUGINS_ROOT_ALLOW_CODE=1 is also set; otherwise
// it is ignored with a stderr note. Two signals rather than one because this
// variable selects executable code: memq resolves from PATH inside whatever
// repository a session is working in, and a single innocuous-looking
// variable is settable from a committed file a repository already has
// (.vscode/settings.json's terminal env, devcontainer.json, .envrc).
// KIT_MEMORY_ROOT in scripts/memq.js carries the same two-signal gate under
// its own second signal (KIT_MEMORY_ROOT_ALLOW_DATA), and the two are not
// one rule restated: this root selects which program runs, that one selects
// which data reaches the model's context, and each power warrants its own
// gate, so neither may be loosened to match a weaker reading of the other.
// The intended use of both pairs is the repo test suite, which sets them
// all. Every one of these variables passes through to the spawned memq
// untouched (the environment is inherited whole); memq reads the memory pair
// and ignores the plugins pair.
//
// Node core modules only, CommonJS, zero dependencies, UTF-8 throughout. That
// last constraint is why the two failure notes below name no path. Both values
// they would otherwise carry are home-anchored (the plugins directory sits
// under ~/.claude, and the payload inside it), and this shim's output is read
// by a model, so taking the OS account name out of them is the shared
// renderer's job. The renderer lives in the kit payload, which is exactly what
// this file has failed to find or to run whenever either note fires, and the
// installed copy of this file sits in ~/.claude/bin/ outside every payload, so
// there is nothing beside it to load either. The paths are withheld and the
// remedy named in their place.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PLUGIN_NAME = 'grimoire';
const MEMQ_REL = path.join('scripts', 'memq.js');

// The default plugin state directory: the manifest and the version-stamped
// cache entries, as the harness maintains them.
function defaultPluginsRoot() {
    return path.join(os.homedir(), '.claude', 'plugins');
}

// The plugin state directory this process searches. The override is honored
// only under its second signal; an override without it is ignored loudly, so
// a misconfigured test fails visibly rather than silently reading the real
// install, and a repository that sets the variable alone changes nothing.
function pluginsRoot() {
    const override = process.env.KIT_PLUGINS_ROOT;
    if (!override) return defaultPluginsRoot();
    if (process.env.KIT_PLUGINS_ROOT_ALLOW_CODE === '1') return override;
    process.stderr.write('memq: ignoring KIT_PLUGINS_ROOT (it selects which code runs, so it '
        + 'is honored only with KIT_PLUGINS_ROOT_ALLOW_CODE=1)\n');
    return defaultPluginsRoot();
}

// The payload's memq.js when the entry actually carries one, else null. This
// is the validity predicate both resolution paths answer to.
function memqIn(entryDir) {
    const p = path.join(entryDir, MEMQ_REL);
    try { return fs.statSync(p).isFile() ? p : null; } catch { return null; }
}

// Resolution path 1: the manifest. Its plugins map keys entries as
// "<plugin>@<marketplace>", so the key both selects this plugin and names the
// marketplace that installed it. Returns {path, marketplace}: path is null
// when no listed entry holds the script, while marketplace survives that
// failure, because a manifest that named a marketplace still answers "whose
// grimoire" for the scan that follows. Every field access is guarded
// because the manifest belongs to the harness and its shape can change under
// us; any surprise reads as "no answer here".
function fromManifest(root) {
    const none = { path: null, marketplace: null };
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(path.join(root, 'installed_plugins.json'), 'utf8'));
    } catch {
        return none;
    }
    const plugins = parsed && typeof parsed === 'object' ? parsed.plugins : null;
    if (!plugins || typeof plugins !== 'object') return none;
    // Keys are visited in sorted order rather than object order, so the answer
    // does not depend on how the harness happened to serialize the file.
    let marketplace = null;
    for (const key of Object.keys(plugins).sort()) {
        if (key !== PLUGIN_NAME && !key.startsWith(PLUGIN_NAME + '@')) continue;
        const mp = key.startsWith(PLUGIN_NAME + '@') ? key.slice(PLUGIN_NAME.length + 1) : null;
        if (marketplace === null && mp !== null && mp !== '') marketplace = mp;
        const entries = Array.isArray(plugins[key]) ? plugins[key] : [];
        for (const entry of entries) {
            if (!entry || typeof entry.installPath !== 'string') continue;
            const p = memqIn(entry.installPath);
            if (p !== null) return { path: p, marketplace: mp === null ? marketplace : mp };
        }
    }
    return { path: null, marketplace };
}

// Resolution path 2: the newest valid cache entry for the kit. A kit update
// creates a fresh entry directory, so newest mtime is the current release
// whenever the manifest cannot say. `marketplace`, when given, restricts the
// scan to that marketplace's directory: the manifest already said whose
// grimoire this machine runs, and a directory of the same name under
// another marketplace is a different publisher's code. With no manifest
// answer every marketplace is a candidate, and a tie of more than one is
// noted on stderr rather than silently resolved, because the choice is which
// publisher's code runs.
function fromCacheScan(root, marketplace) {
    const cacheDir = path.join(root, 'cache');
    let marketplaces;
    if (marketplace !== null && marketplace !== undefined) marketplaces = [marketplace];
    else {
        try { marketplaces = fs.readdirSync(cacheDir).sort(); } catch { return null; }
    }
    let best = null;
    const offering = new Set();
    for (const m of marketplaces) {
        const kitDir = path.join(cacheDir, m, PLUGIN_NAME);
        let entries;
        try { entries = fs.readdirSync(kitDir).sort(); } catch { continue; }
        for (const e of entries) {
            const entryDir = path.join(kitDir, e);
            const p = memqIn(entryDir);
            if (p === null) continue;
            let st;
            try { st = fs.statSync(entryDir); } catch { continue; }
            offering.add(m);
            // Total order: newest mtime, then marketplace, then version, so
            // identical mtimes (a same-second install) still pick one answer.
            const cand = { ms: st.mtimeMs, marketplace: m, version: e, path: p };
            if (best === null || cand.ms > best.ms
                || (cand.ms === best.ms && cand.marketplace < best.marketplace)
                || (cand.ms === best.ms && cand.marketplace === best.marketplace && cand.version < best.version)) {
                best = cand;
            }
        }
    }
    if (best === null) return null;
    if (offering.size > 1) {
        process.stderr.write('memq: ' + offering.size + ' marketplaces offer a ' + PLUGIN_NAME
            + ' payload and no manifest entry names one; running ' + best.marketplace + '\n');
    }
    return best.path;
}

// The installed memq.js to run, or null when no valid payload exists.
function resolveMemq() {
    const root = pluginsRoot();
    const manifest = fromManifest(root);
    return manifest.path || fromCacheScan(root, manifest.marketplace);
}

function main() {
    const memqPath = resolveMemq();
    if (memqPath === null) {
        process.stderr.write('memq: no installed ' + PLUGIN_NAME + ' payload found in the plugins '
            + 'directory this shim searched, whose path is withheld here; install the plugin, or '
            + 're-run the kit doctor with -Fix\n');
        process.exitCode = 1;
        return;
    }
    // stdio and the environment pass through untouched (no copied env object,
    // which on Windows would drop the real Path key), so memq behaves exactly
    // as if invoked directly; its exit code is this process's exit code.
    const child = spawnSync(process.execPath, [memqPath].concat(process.argv.slice(2)),
        { stdio: 'inherit' });
    if (child.error) {
        // The error's CODE rides, since a Node error code is an upper-case
        // identifier (ENOENT, EACCES) that names the failure's kind and can
        // carry no path; anything else in that field is dropped, as is the
        // message, which names the file the spawn was refused on.
        const raw = child.error.code;
        const code = typeof raw === 'string' && /^[A-Z0-9_]{1,40}$/.test(raw) ? ' (' + raw + ')' : '';
        process.stderr.write('memq: could not run the installed ' + PLUGIN_NAME + ' payload'
            + code + '; its path and the error text are withheld here. Re-run the kit doctor '
            + 'with -Fix\n');
        process.exitCode = 1;
        return;
    }
    process.exitCode = child.status === null ? 1 : child.status;
}

// Run as a CLI this dispatches; loaded as a module (the test suite) it only
// exports its internals.
if (require.main === module) main();

module.exports = { pluginsRoot, resolveMemq };
