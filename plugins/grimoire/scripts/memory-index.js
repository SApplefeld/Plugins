// memory-index: the semantic side of the kit memory store. It embeds every
// memory file on the machine and keeps a derived index of those vectors, so a
// search can answer by meaning where a substring search answers by spelling.
//
// Three properties shape everything here.
//
// The embedding stack is per-machine and optional. The kit core ships zero
// dependencies, so the model and its runtime install outside the plugin
// payload, into a directory this module only ever reads. Absence is therefore
// an ordinary state, not an error: every entry point answers it with a typed
// result naming the remedy, and nothing in this file throws that condition at
// a caller. A search surface degrades to its lexical channel with one loud
// line; it does not fail.
//
// The index is derived data, and the only component here allowed to be wrong.
// It can be deleted, truncated, or written by a different model, and each of
// those is a rebuild rather than an error. That is what lets the store's own
// files stay the single source of truth: nothing is ever recovered from the
// index, so nothing is lost by discarding it.
//
// The store is read-only from here. This module writes exactly one file, its
// own sidecar at the store root, and never unlinks, moves, or rewrites
// anything under a tier directory. A memory file is the operator's; a vector
// is this module's opinion about it.
//
// The sidecar sits at the store root rather than inside a tier, which is both
// where it belongs (it spans every tier and every store on the machine) and
// what keeps it out of the memory-sync repository: that repository's allowlist
// excludes the whole store root with `/*` and re-includes only paths inside
// the memory tiers and the machine coordinator directory, so a root-level
// file cannot be staged. Vectors are valid
// only against the local model that produced them, so syncing them would
// publish stale derived data to every other machine.
//
// Node core modules only, CommonJS, zero dependencies, UTF-8 throughout.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const memq = require('./memq.js');

// The embedding stack, pinned here because the vectors in the sidecar are
// meaningful only against the exact package, model, and quantization that
// produced them. All four values ride in each record's model identity, so
// changing any of them is a full rebuild rather than a silent mix of
// incomparable vectors.
const PACKAGE_NAME = '@huggingface/transformers';
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_DTYPE = 'q8';   // the quantized weights: 23 MB against 90 MB, at retrieval quality this store does not miss
const MODEL_DIM = 384;

// Where the stack lives when the operator has installed it: a directory at the
// store root holding an ordinary node_modules tree, which the doctor's install
// creates and this module only reads. It is deliberately not derived from the
// store root override below, because that override is gated as data and this
// path selects which code gets loaded into the process.
const EMBEDDER_DIR = 'kit-embedder';

// The sidecar's name at the store root. The rename temporary shares the stem
// so it lands under the same exclusion rules the sidecar itself does.
const SIDECAR_FILE = 'memory-index.jsonl';

// Characters of one memory fed to the embedder. The model truncates at its own
// token window well before this, so the cap is not about retrieval quality: it
// bounds the string a pathological file can push through the tokenizer.
const TEXT_CAP = 8192;

// Texts handed to the model in one call. Batching is a real speedup (three
// texts embed in about the time one does), and the batch is bounded because a
// batch pads to its longest member, so an unbounded one turns a single long
// memory into padding across every other text in the store.
const EMBED_BATCH = 16;

// The tier tokens a record can carry. A tier and its archive are separate
// tokens rather than a tier plus a flag, which keeps the record at the seven
// fields the index is defined by and still lets a search demote retired
// records. Consumers ask isArchivedTier rather than matching the spelling
// themselves, so the encoding stays this module's business.
const TIERS = [
    'project', 'project-archive',
    'type', 'type-archive',
    'operator', 'operator-archive'
];
const TIER_SET = new Set(TIERS);

function isArchivedTier(tier) {
    return tier === 'project-archive' || tier === 'type-archive' || tier === 'operator-archive';
}

// The three live tiers, in the store's own precedence order, paired with their
// archive token. Every walk here iterates this rather than naming tiers inline:
// a surface that reads fewer tiers than it claims to is this store's
// best-documented failure, and one list is what makes the miss impossible.
const LIVE_TIERS = ['project', 'type', 'operator'];
const ARCHIVE_TIER_OF = {
    project: 'project-archive',
    type: 'type-archive',
    operator: 'operator-archive'
};

// ---------------------------------------------------------------------------
// The embedder probe
// ---------------------------------------------------------------------------

// The directory the embedding stack is loaded from.
//
// KIT_EMBEDDER_ROOT is honored only when KIT_EMBEDDER_ROOT_ALLOW_CODE=1 rides
// alongside; otherwise it is ignored with a once-per-process stderr note and
// the installed location is used. Two signals rather than one because this
// variable selects executable code: the package it names is required into this
// process, and a single innocuous-looking variable is settable from a committed
// file a repository already has (.vscode/settings.json's terminal env,
// devcontainer.json, an .envrc). The gate is KIT_PLUGINS_ROOT_ALLOW_CODE's in
// memq-shim.js rather than KIT_MEMORY_ROOT_ALLOW_DATA's in memq.js, and the
// distinction is the point: the store root selects which data reaches the
// model, this root selects which program runs, so the data gate may never stand
// in for this one. That is also why the install location is spelled from the
// home directory here instead of from memoryRoot(): a store root redirected for
// data must not move where code is loaded from.
let ungatedEmbedderNoted = false;
function embedderRoot() {
    const override = process.env.KIT_EMBEDDER_ROOT;
    if (override) {
        if (process.env.KIT_EMBEDDER_ROOT_ALLOW_CODE === '1') return override;
        if (!ungatedEmbedderNoted) {
            ungatedEmbedderNoted = true;
            process.stderr.write('memory-index: ignoring KIT_EMBEDDER_ROOT (it selects which code '
                + 'runs, so it is honored only with KIT_EMBEDDER_ROOT_ALLOW_CODE=1)\n');
        }
    }
    return path.join(os.homedir(), '.claude', EMBEDDER_DIR);
}

// The one path the package may be installed at, and the exact path the doctor's
// install writes. The package is located by a direct existence check here
// rather than by require.resolve's paths option, because that resolution walks
// upward through parent node_modules directories: it would load a copy from
// anywhere above the install directory, which turns "is the stack installed"
// into a question about where this process happens to be running.
function packageDirPath() {
    return path.join(embedderRoot(), 'node_modules', '@huggingface', 'transformers');
}

// The remedy line, one place, because the doctor, the session nudge, and find's
// absence line all state the same move. Names the kit-doctor skill rather than
// a bare command: no `kit` launcher exists on a machine with the kit installed,
// only the memq shim in ~/.claude/bin, so the skill's own locate-and-run steps
// are what actually resolves this for a session reading the string back.
const INSTALL_REMEDY = "run the kit-doctor skill's -Fix (installs the local embedding stack)";

function absentResult(detail) {
    return {
        status: 'absent',
        available: false,
        root: embedderRoot(),
        packageDir: packageDirPath(),
        packageName: PACKAGE_NAME,
        model: MODEL_ID,
        dtype: MODEL_DTYPE,
        dim: MODEL_DIM,
        modelCacheDir: modelCacheDir(),
        identity: null,
        remedy: INSTALL_REMEDY,
        detail
    };
}

// Where the model files sit: the package's own cache directory, which this
// module pins explicitly rather than inheriting. The library defaults to this
// same location, and pinning it makes the install contract a stated one, since
// the doctor's install and this module must agree on where a downloaded model
// lands or a warmed install reads as an empty one.
function modelCacheDir() {
    return path.join(packageDirPath(), '.cache');
}

// The model files a load needs, relative to the model's directory in the cache.
// The quantized weights are the only ONNX file required; the full-precision one
// beside them is never loaded at this dtype.
const MODEL_FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    path.join('onnx', 'model_quantized.onnx')
];

// The model files missing from the cache, as relative names.
function missingModelFiles() {
    const base = path.join(modelCacheDir(), MODEL_ID);
    return MODEL_FILES.filter((rel) => !fs.existsSync(path.join(base, rel)));
}

// Whether the embedding stack is installed and usable, answered from the
// filesystem alone and without loading anything. The doctor's embedder check
// and any surface that wants to state installed-or-not cheaply asks this; a caller
// that needs actual vectors asks loadEmbedder below, which answers the same
// shape plus a loaded model.
//
// The result is typed in every direction and this function never throws: the
// absence of an optional component is a state to report, and a probe that threw
// would make every consumer wrap it, which is how one machine's missing
// install turns into a broken command everywhere else.
//
// The model files are checked here, not only the package. An install whose
// model cache is missing or evicted (an interrupted install, a disk cleanup) is
// 'unusable' rather than 'ready', because the alternative is a query path that
// downloads 23 MB from the network, or hangs against a network that is not
// there, with nothing in the result naming the cause. Remote fetching is off at
// load, so a missing model is a fast, diagnosable failure rather than a silent
// one; this probe is what states it before the query path is even entered.
function probeEmbedder() {
    const pkgJson = path.join(packageDirPath(), 'package.json');
    let raw;
    try {
        raw = fs.readFileSync(pkgJson, 'utf8');
    } catch (err) {
        return absentResult(err && err.code === 'ENOENT'
            ? 'no ' + PACKAGE_NAME + ' at ' + packageDirPath()
            : 'cannot read ' + pkgJson + ': ' + errText(err));
    }
    let version = null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.version === 'string') version = parsed.version;
    } catch {
        // An unparseable manifest is an install that cannot be identified, and
        // an unidentified install cannot stamp a model identity onto records,
        // so it counts as absent rather than as a version-less ready.
        return absentResult('unreadable package manifest at ' + pkgJson);
    }
    if (version === null) return absentResult('no version in ' + pkgJson);
    const ready = {
        status: 'ready',
        available: true,
        root: embedderRoot(),
        packageDir: packageDirPath(),
        packageName: PACKAGE_NAME,
        packageVersion: version,
        model: MODEL_ID,
        dtype: MODEL_DTYPE,
        dim: MODEL_DIM,
        modelCacheDir: modelCacheDir(),
        identity: modelIdentity(version),
        remedy: null,
        detail: null
    };
    const missing = missingModelFiles();
    if (missing.length > 0) {
        return {
            ...ready,
            status: 'unusable',
            available: false,
            remedy: INSTALL_REMEDY,
            detail: 'the ' + MODEL_ID + ' model files are missing from '
                + modelCacheDir() + ': ' + missing.join(', ')
        };
    }
    return ready;
}

// The string recorded in every record's model field. The package version is
// part of it because a stack upgrade can change tokenization or kernels, and
// two vectors built by different versions are not safely comparable. A rebuild
// after an upgrade costs one sweep; a silently mixed index costs wrong answers
// with no symptom.
function modelIdentity(version) {
    return PACKAGE_NAME + '@' + version + '/' + MODEL_ID + '/' + MODEL_DTYPE;
}

function errText(err) {
    return err && err.message ? String(err.message) : String(err);
}

// One loaded pipeline per package directory, for the life of the process. The
// warm load is around 150 ms and a query path may sweep and then embed its
// query, so loading twice would double the only slow step in an otherwise
// millisecond operation.
const loaded = new Map();

// The embedding stack, loaded and ready to embed, or the typed absence.
//
// A stack that is installed but fails to load (a partial install, a missing
// model, a native runtime that will not initialize on this machine) reports
// status 'unusable' with the reason. It is a third state rather than folded
// into 'absent', because the remedies differ: absent is an install, unusable is
// a repair, and a caller that reports the wrong one sends the operator to the
// wrong place.
//
// Only a successful load is cached. A repair performed while a long-lived
// process is running is then picked up by that process's next query rather than
// waiting for the next invocation, and re-probing a broken install costs a
// filesystem read.
async function loadEmbedder() {
    const probe = probeEmbedder();
    if (probe.status !== 'ready') return probe;

    const dir = probe.packageDir;
    if (loaded.has(dir)) return loaded.get(dir);

    try {
        // The package publishes a CommonJS entry for node (dist's node.cjs
        // under the require condition), so it loads with require from this
        // CommonJS module without an ESM hop. The entry is resolved from
        // inside the located package directory rather than from this file's
        // own module paths, which cannot see an install outside the payload.
        const entry = require.resolve(dir);
        const transformers = require(entry);

        // Remote model fetching is off, and both model directories are pinned
        // to the location the probe checked. The library's default is to fetch a
        // missing model from the network, which inside a query path is a silent
        // multi-megabyte download on a hit and an unexplained hang where there
        // is no network. Off, a missing model fails in milliseconds with a
        // message naming the directory it looked in, which is a state a caller
        // can report. The model reaches a machine through the doctor's install,
        // which is where a download belongs: consented, once, and visible.
        //
        // Both paths are set because the library reads them for different
        // things: a remote fetch lands under cacheDir, while a local-only lookup
        // reads localModelPath, which defaults to a models/ directory beside the
        // cache and would be empty on an install whose model was downloaded. One
        // location for both is what makes a warmed install loadable offline.
        transformers.env.allowRemoteModels = false;
        transformers.env.allowLocalModels = true;
        transformers.env.cacheDir = modelCacheDir();
        transformers.env.localModelPath = modelCacheDir();

        const extractor = await transformers.pipeline('feature-extraction', MODEL_ID,
            { dtype: MODEL_DTYPE });
        const result = {
            ...probe,
            embed: (texts) => runExtractor(extractor, texts)
        };
        loaded.set(dir, result);
        return result;
    } catch (err) {
        return {
            ...probe,
            status: 'unusable',
            available: false,
            remedy: INSTALL_REMEDY,
            detail: 'the embedding stack at ' + dir + ' failed to load: ' + errText(err)
        };
    }
}

// Embed a batch of texts, returning one plain number array per input.
//
// Mean pooling over the token vectors with L2 normalization is the sentence
// embedding this model is trained to produce; without it the raw token matrix
// is not a comparable vector at all.
async function runExtractor(extractor, texts) {
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    const dim = out.dims[out.dims.length - 1];
    const vectors = [];
    for (let i = 0; i < texts.length; i++) {
        vectors.push(Array.from(out.data.slice(i * dim, (i + 1) * dim)));
    }
    return vectors;
}

// ---------------------------------------------------------------------------
// Walking the store
// ---------------------------------------------------------------------------

// The store's rule for a name that may be joined onto a store path as one
// segment: an identifier from the same closed charset the store's keys, tags,
// and type names use, and not a path token. A project segment is derived from
// a full working directory path, so the bound is a path bound rather than the
// store's short identifier cap.
//
// The sidecar is local derived data, but it is the one file here that is parsed
// and then trusted, and its store field is joined onto a path by recordPath. A
// record carrying '..' would resolve outside the store root in whatever
// consumer opened it, so the rule is enforced where records are read and where
// they are walked, not assumed from where they came.
function isStoreSegment(v) {
    if (typeof v !== 'string' || v === '' || v.length > 260) return false;
    if (!/^[\w.-]+$/.test(v)) return false;
    return v !== '.' && v !== '..';
}

// Where a record's file sits, derived from the record's own three identifying
// fields rather than stored alongside them. A stored path would be a fourth
// spelling of a location the store already defines, and it would be the one
// that rots when a store root moves. A record whose store or tier is not one
// this module writes resolves to null rather than to a path.
//
// The operator tier has no per-store directory segment: it is one directory at
// the store root, so its records carry the fixed OPERATOR_LABEL as their store
// and the field is checked here rather than joined. That keeps the field
// meaningful in every tier, since a record claiming some other store in the
// operator tier is one this module did not write.
function recordPath(store, tier, name) {
    if (!isStoreSegment(store) || !memq.isMemoryFilename(name + '.md')) return null;
    const file = name + '.md';
    if (tier === 'operator' || tier === 'operator-archive') {
        if (store !== memq.OPERATOR_LABEL) return null;
    }
    if (tier === 'project') return path.join(memq.projectMemoryDirFor(store), file);
    if (tier === 'project-archive') {
        return path.join(memq.projectMemoryDirFor(store), memq.ARCHIVE_DIR, file);
    }
    if (tier === 'type') return path.join(memq.typesRootPath(), store, file);
    if (tier === 'type-archive') {
        return path.join(memq.typesRootPath(), store, memq.ARCHIVE_DIR, file);
    }
    if (tier === 'operator') return path.join(memq.operatorDirPath(), file);
    if (tier === 'operator-archive') {
        return path.join(memq.operatorDirPath(), memq.ARCHIVE_DIR, file);
    }
    return null;
}

// The live directory of one tier instance: a project store's memory directory,
// a type tier, or the operator tier. The archive sits one level below it, which
// is the shape every tier in this store shares.
function tierLiveDir(tier, store) {
    if (tier === 'project') return memq.projectMemoryDirFor(store);
    if (tier === 'type') return path.join(memq.typesRootPath(), store);
    return memq.operatorDirPath();
}

// The memory files directly in one directory, by the store's own definition of
// a memory file (memq.isMemoryFilename, which excludes MEMORY.md and every
// non-memory artifact). Enumeration is non-recursive on purpose: each tier's
// archive is walked as its own tier, and nothing else below a tier directory
// is a memory. That also keeps the run-scoped pending tier
// (memory/pending/<run-id>/) out of the index, which is deliberate: those
// files are one external-engine run's unadjudicated writes, scoped to the
// process that set the run id, and indexing them would publish them to every
// search on the machine.
function listMemoryFiles(dir) {
    const listed = listDirNames(dir);
    if (listed.names === null) return { files: null, error: listed.error };
    const out = [];
    for (const name of listed.names) {
        if (!memq.isMemoryFilename(name)) continue;
        const file = path.join(dir, name);
        let st = null;
        // A directory carrying a memory's name is not a memory, the same
        // judgment memq's own listing makes. The stat follows links, so a
        // symlinked memory counts as one.
        try { st = fs.statSync(file); } catch { continue; }
        if (!st.isFile()) continue;
        out.push({ name: name.slice(0, -3), file });
    }
    return { files: out, error: null };
}

// A directory's entries, sorted, distinguishing the two ways there are none.
//
// {names: [...]} is a directory that was read. {names: null, error: null} is a
// directory that does not exist, which is the ordinary state of most tiers on
// most machines and no failure at all. {names: null, error: <text>} is a
// directory that exists and could not be read, which is a part of the store
// this walk did not see. Reporting the last two alike is wrong in both
// directions: as a failure it warns forever on a healthy store, and as an
// absence it lets a permission error read as "no memories here".
function listDirNames(dir) {
    try {
        return { names: fs.readdirSync(dir).sort(), error: null };
    } catch (err) {
        const code = err && err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return { names: null, error: null };
        return { names: null, error: errText(err) };
    }
}

// Every memory on the machine, as {records, failed, unscanned}.
//
// records are {store, tier, name, file} in a deterministic order. The walk
// spans every tier and every store: each project directory under projects/ (not
// only the current process's, since a search answers across the machine), every
// declared type tier, the operator tier, and each of those three tiers'
// archives.
//
// failed names each directory that exists and could not be read, at whatever
// granularity the failure happened: one tier's archive, one project store, or a
// whole root. "No memories found" and "could not look" are answers a search
// surface must not confuse, so neither is ever printed as the other.
//
// unscanned is the same information as {tier, store} pairs, with a null store
// meaning every store of that tier. A sweep carries an unscanned tier's already
// indexed records forward untouched: a directory that could not be read this
// time is no evidence its memories changed or went away, which is the same
// judgment the single-file read failure takes, one level wider.
function walkStore() {
    const out = { records: [], failed: [], unscanned: [] };

    const segments = memq.projectSegments();
    if (segments === null) {
        // The helper answers null for a projects root that does not exist and
        // for one that could not be read, and only the second is a failure. A
        // store with no projects directory at all is ordinary (an operator-only
        // store, a freshly redirected one), and reporting it would put a
        // permanent warning on a healthy store.
        if (fs.existsSync(memq.projectsRootPath())) {
            noteUnscanned(out, 'project', null,
                'could not scan the projects root at ' + memq.projectsRootPath());
            noteUnscanned(out, 'project-archive', null, null);
        }
    } else {
        for (const segment of segments) {
            // A directory under projects/ whose name is not a store path
            // segment was not written by this store's naming rule, and its name
            // could not survive a round trip through the index, so it is not
            // walked at all rather than indexed into records no reader can
            // resolve.
            if (!isStoreSegment(segment)) continue;
            collectTier(out, 'project', segment);
        }
    }

    const types = listDirNames(memq.typesRootPath());
    if (types.error !== null) {
        noteUnscanned(out, 'type', null,
            'could not scan the type root at ' + memq.typesRootPath() + ': ' + types.error);
        noteUnscanned(out, 'type-archive', null, null);
    } else if (types.names !== null) {
        for (const type of types.names) {
            // The type root also holds the tag registry, a file rather than a
            // tier, so entries are admitted by the store's type-name rule and
            // then by actually being a directory.
            if (!memq.isTypeName(type)) continue;
            collectTier(out, 'type', type);
        }
    }

    collectTier(out, 'operator', memq.OPERATOR_LABEL);

    return out;
}

// Record that a tier's records could not be seen this walk, with the reason
// when there is one to state. The second call for a tier's archive passes no
// reason, because one unreadable directory is one failure to report even though
// it puts two tier tokens out of reach.
function noteUnscanned(out, tier, store, reason) {
    out.unscanned.push({ tier, store });
    if (reason !== null) out.failed.push({ store, tier, name: null, reason });
}

// Whether a record sits in a tier this walk could not read.
function unscannedCovers(unscanned, record) {
    for (const u of unscanned) {
        if (u.tier === record.tier && (u.store === null || u.store === record.store)) return true;
    }
    return false;
}

// One tier instance's live and archived memories, appended in tier order. The
// archive sits below the live directory, so a live directory that cannot be
// read puts both out of reach.
function collectTier(out, tier, store) {
    const liveDir = tierLiveDir(tier, store);
    const live = listMemoryFiles(liveDir);
    if (live.error !== null) {
        noteUnscanned(out, tier, store, 'could not scan ' + liveDir + ': ' + live.error);
        noteUnscanned(out, ARCHIVE_TIER_OF[tier], store, null);
        return;
    }
    if (live.files === null) return;
    for (const m of live.files) out.records.push({ store, tier, name: m.name, file: m.file });

    const archiveDir = path.join(liveDir, memq.ARCHIVE_DIR);
    const archived = listMemoryFiles(archiveDir);
    if (archived.error !== null) {
        noteUnscanned(out, ARCHIVE_TIER_OF[tier], store,
            'could not scan ' + archiveDir + ': ' + archived.error);
        return;
    }
    if (archived.files === null) return;
    for (const m of archived.files) {
        out.records.push({ store, tier: ARCHIVE_TIER_OF[tier], name: m.name, file: m.file });
    }
}

// ---------------------------------------------------------------------------
// The sidecar
// ---------------------------------------------------------------------------

function indexPath() {
    return path.join(memq.memoryRoot(), SIDECAR_FILE);
}

// A record's identity in the index: the three fields that place it in the
// store. Names compare the way the platform's filesystem compares them, the
// same rule memq applies to usage keys, so one file cannot occupy two slots.
//
// The separator is a space, and it cannot collide: a store segment and a
// memory name are both closed to [A-Za-z0-9_.-] by the store's own gates, and
// every tier token is a fixed word from the closed set above. A control
// character would separate just as well and would make this source read as
// binary to the tools that scan it, which is how a claim living in a file
// goes unread by every later grep over the tree.
function recordKey(store, tier, name) {
    return store + ' ' + tier + ' ' + memq.memoryFileKey(name);
}

// Whether a parsed line is a record this module wrote. Every field is checked.
// The vector's width and finiteness, because a malformed vector would not fail
// loudly: it would quietly produce NaN similarities that sort somewhere
// arbitrary in every future search. The store, because it is joined onto a path
// by recordPath, and this file is the one input here that is parsed and then
// trusted.
function isRecord(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if (!isStoreSegment(v.store)) return false;
    if (typeof v.tier !== 'string' || !TIER_SET.has(v.tier)) return false;
    if (typeof v.name !== 'string' || !memq.isMemoryFilename(v.name + '.md')) return false;
    if (recordPath(v.store, v.tier, v.name) === null) return false;
    if (typeof v.mtime !== 'number' || !Number.isFinite(v.mtime)) return false;
    if (typeof v.hash !== 'string' || v.hash === '') return false;
    if (typeof v.model !== 'string' || v.model === '') return false;
    if (!Array.isArray(v.vector) || v.vector.length === 0) return false;
    for (const x of v.vector) {
        if (typeof x !== 'number' || !Number.isFinite(x)) return false;
    }
    return true;
}

// The index as it sits on disk.
//
// Three outcomes, and two of them mean the same thing to a sweep: 'ok' with
// records, 'absent' when there is no sidecar yet, and 'corrupt' when any line
// is unparseable or malformed. A corrupt index is discarded whole rather than
// line-by-line, because a truncated write leaves a half-line whose neighbours
// are no more trustworthy than it is, and rebuilding costs one sweep of a store
// small enough to embed in seconds. Nothing here throws: the index is derived
// data, and every way it can be wrong is a rebuild.
function readIndex() {
    let raw;
    try {
        raw = fs.readFileSync(indexPath(), 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { status: 'absent', records: [] };
        return { status: 'corrupt', records: [], detail: 'cannot read the index: ' + errText(err) };
    }
    const records = [];
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === '' || line === '\r') continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        } catch {
            return { status: 'corrupt', records: [], detail: 'unparseable line ' + (i + 1) };
        }
        if (!isRecord(parsed)) {
            return { status: 'corrupt', records: [], detail: 'malformed record on line ' + (i + 1) };
        }
        records.push(parsed);
    }
    return { status: 'ok', records };
}

// Write the sidecar through a temporary and a rename, so an interrupted sweep
// leaves either the previous index or the new one and never a half-written
// file. The temporary shares the sidecar's directory (a rename across
// filesystems is not atomic) and its stem, so it falls under the same sync
// exclusion the sidecar does.
//
// The store root is never created here. This module reads a store it did not
// make; a missing root means there is nothing to index, and minting one would
// write into a directory the operator never asked for.
function writeIndex(records) {
    const target = indexPath();
    const tmp = target + '.tmp.' + process.pid;
    const body = records.map((r) => JSON.stringify({
        store: r.store,
        tier: r.tier,
        name: r.name,
        mtime: r.mtime,
        hash: r.hash,
        model: r.model,
        vector: r.vector
    })).join('\n') + (records.length ? '\n' : '');
    try {
        fs.writeFileSync(tmp, body, 'utf8');
        fs.renameSync(tmp, target);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
        return { written: false, error: 'could not write ' + target + ': ' + errText(err) };
    }
    return { written: true, error: null };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

function hashOf(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// What a memory contributes to its vector: the name, then the body. The name is
// a fact-bearing phrase in this store (memories are named for what they teach,
// not numbered), so it belongs in the embedded text rather than being carried
// only as an identifier.
//
// Exported, because a caller ranking a record that is not in the index yet has to
// compose its query the way the corpus was composed: the authoring verbs' neighbour
// query is the name and description of the record being written, spelled through
// here. A second spelling of this composition is a silent ranking defect, so the
// suites pin the call site against this function on both sides, in
// test/memory-index.test.js and test/memq.test.js.
function embedText(name, body) {
    const text = name.replace(/[-_]+/g, ' ') + '\n\n' + body;
    return text.length > TEXT_CAP ? text.slice(0, TEXT_CAP) : text;
}

// Whether the caller has abandoned the work in flight. The signal is optional,
// so a caller with no clock passes none and every check below reads as running
// to completion.
//
// An abandoned caller is an expected condition here, the judgment an absent
// embedder gets rather than the one a bug gets: a caller under a bound has
// already printed whatever it says in place of a ranking by the time the abort
// lands, so the work stops and answers with a typed status instead of throwing
// at a reader who is no longer there.
function isCancelled(signal) {
    return Boolean(signal && signal.aborted);
}

// The answer to an abort read before the store was walked: the sweep shape with
// nothing in it. Every key a completed sweep carries is present, so a caller
// reading a count or the record list meets a number or an array rather than
// undefined. Every count is zero, the record list is empty and nothing is
// written because this pass read no file and embedded no text: there is no
// account of the store to give and nothing to persist, and the sidecar keeps
// whatever the last completed sweep left. An abort read later, after the
// embedding, returns through the ordinary path instead and carries the counts and
// the records that pass did produce.
function cancelledSweep(embedder) {
    return {
        status: 'cancelled',
        embedder,
        indexPath: indexPath(),
        rebuilt: false,
        added: 0,
        changed: 0,
        removed: 0,
        retimed: 0,
        unchanged: 0,
        carried: 0,
        failed: [],
        records: [],
        written: false,
        writeError: null
    };
}

// Bring the index up to date with the store, and return both it and an account
// of what changed.
//
// Every file is read and hashed on every sweep, and the recorded mtime is
// compared too, because the two catch different failures and neither alone is
// sound. The hash decides whether a record is re-embedded: the vector is a
// function of the bytes, so content that is byte-identical needs no new vector
// however its timestamp moved, which is what keeps a git checkout of the synced
// store from re-embedding the whole machine. The mtime is what the record
// claims about the file it was built from, and it is refreshed whenever it
// moved, so a later reader can tell a record's age without re-reading the
// store. What is deliberately not built is an mtime fast path that skips
// reading unchanged files: a rewrite that lands within a timestamp's resolution
// changes content without moving the mtime, and the whole store reads in
// single-digit milliseconds against a model load two orders of magnitude
// slower, so the saving would buy nothing and cost exactly the silently stale
// index this module exists to avoid.
//
// A recorded model identity that differs from the installed one discards the
// whole index: vectors from two models occupy different spaces, and a mixed
// index ranks by an accident of which model saw which file.
//
// A tier the walk could not read keeps its already indexed records, carried
// forward untouched and counted as carried rather than removed. The reasoning
// is the single-file one at a wider granularity: a directory that could not be
// enumerated is no evidence its memories changed or went away, and pruning them
// would empty a search's answer for a whole tier over a transient permission
// error.
//
// The counters describe what the sweep decided, so added and changed count the
// records queued for embedding rather than the ones that landed: a record whose
// embedding failed is counted in one of them and named in failed, and the index
// holds neither it nor a stale version of it.
//
// options.embedder accepts an already-loaded embedder ({identity, dim, embed}),
// which is how a caller that already loaded one avoids a second load and how
// tests drive the sweep's transitions without the optional stack installed.
//
// options.signal is an AbortSignal owned by a caller under a clock. An abort
// stops this sweep at the next check rather than finishing it for a reader who
// has gone, and it answers status 'cancelled'.
//
// Every point that reads it is a point where nothing is in flight: the
// resumption after the embedder load, which is the slow step a caller's bound is
// drawn around; each embed batch boundary, which is where the cost of a large
// store goes; between the items of the per-item retry a refused batch falls into;
// and once more where the embedding ends, which is the read that decides whether
// this pass answers 'ok' or 'cancelled'. None of them reaches inside the load
// itself, or inside an embed call already handed to the model, which are the
// awaits no check can interrupt: a stack that never resolves the load is not
// stopped here, and the caller's own bound is what ends the wait on that.
//
// What a cancelled pass leaves on disk depends on where the abort was read. The
// abort read after the load, before anything is read or embedded, writes nothing:
// there is no pass to persist and the sidecar stays whatever the last completed
// sweep left. An abort read at or after an embed boundary writes what the pass did
// embed, which is the failed-record rule at a wider granularity: the records the
// abandoned batches never reached are named in failed and absent from the index
// rather than stale in it, so the next sweep sees them as new and finishes the
// job, and a caller reading this pass as partial reads it off the same fields it
// reads a failed embedding off. That is what keeps a store whose load and sweep
// outrun a caller's bound from having no index at all, since every bounded caller
// would otherwise discard the pass that was building one and only an unbounded
// search would ever finish it.
async function sweep(options) {
    const opts = options || {};
    const embedder = opts.embedder || await loadEmbedder();
    if (!embedder.available) {
        return {
            status: embedder.status,
            embedder,
            indexPath: indexPath(),
            rebuilt: false,
            added: 0,
            changed: 0,
            removed: 0,
            retimed: 0,
            unchanged: 0,
            carried: 0,
            failed: [],
            records: [],
            written: false,
            writeError: null
        };
    }

    // The load above is one await this module cannot interrupt, so the abort is
    // read the moment it returns, ahead of the index read, the store walk, the
    // file reads and the embedding below. An absent or unusable stack is
    // reported first: that is a condition the caller can act on, where a
    // cancellation says only that nobody is reading.
    if (isCancelled(opts.signal)) return cancelledSweep(embedder);

    const identity = embedder.identity;
    const prior = readIndex();
    let rebuilt = prior.status !== 'ok';
    const priorByKey = new Map();
    if (!rebuilt) {
        for (const r of prior.records) {
            if (r.model !== identity) { rebuilt = true; break; }
            priorByKey.set(recordKey(r.store, r.tier, r.name), r);
        }
        if (rebuilt) priorByKey.clear();
    }

    const walk = walkStore();
    const failed = walk.failed.slice();
    const kept = [];
    const pending = [];
    let added = 0;
    let changed = 0;
    let retimed = 0;
    let unchanged = 0;

    for (const found of walk.records) {
        const key = recordKey(found.store, found.tier, found.name);
        const before = priorByKey.get(key) || null;
        let body;
        let mtime;
        try {
            // The stat comes first so a write landing between the two calls
            // pairs the new content with an older timestamp rather than the
            // reverse: the next sweep then sees a timestamp that moved against
            // content that did not and re-times the record, where the reverse
            // order would have recorded the old content's vector under the new
            // write's timestamp.
            mtime = fs.statSync(found.file).mtimeMs;
            body = fs.readFileSync(found.file, 'utf8');
        } catch (err) {
            // An unreadable file keeps whatever vector the index already holds
            // for it, since a transient read failure is no evidence the memory
            // changed, and the condition is reported either way.
            failed.push({
                store: found.store,
                tier: found.tier,
                name: found.name,
                reason: 'cannot read the memory file: ' + errText(err)
            });
            if (before) kept.push(before);
            continue;
        }
        const hash = hashOf(body);
        if (before && before.hash === hash) {
            if (before.mtime === mtime) {
                unchanged++;
                kept.push(before);
            } else {
                retimed++;
                kept.push({ ...before, mtime });
            }
            continue;
        }
        if (before) changed++; else added++;
        pending.push({
            store: found.store,
            tier: found.tier,
            name: found.name,
            mtime,
            hash,
            model: identity,
            text: embedText(found.name, body)
        });
    }

    const embedded = await embedAll(embedder, pending, failed, opts.signal);
    // An abort that landed in the batches above changes the status and what is
    // named in failed, and nothing else: the vectors already paid for are
    // written, and the records the abandoned batches would have embedded are
    // absent from the index and named in failed the same way a record whose
    // embedding failed is, so the next sweep sees them as new and finishes the
    // job and a caller reading this pass as partial has the fields to read it off.
    // Discarding the vectors instead would leave a store whose load and sweep
    // outrun a caller's bound with no index at all, since every bounded caller
    // would throw away the pass that was building one.
    const cancelled = isCancelled(opts.signal);
    if (cancelled) noteUnreached(pending, embedded, failed);

    const carried = carryUnscanned(priorByKey, walk);
    const removed = countRemoved(priorByKey, walk.records, carried);
    const records = kept.concat(carried, embedded);
    sortRecords(records);

    const write = writeIndex(records);
    return {
        status: cancelled ? 'cancelled' : 'ok',
        embedder,
        indexPath: indexPath(),
        rebuilt,
        added,
        changed,
        removed,
        retimed,
        unchanged,
        carried: carried.length,
        failed,
        records,
        written: write.written,
        writeError: write.error
    };
}

// The indexed records that sit in a tier this walk could not read. They are
// carried into the new index exactly as they were: their files were not looked
// at, so nothing about them is known to have changed.
function carryUnscanned(priorByKey, walk) {
    if (priorByKey.size === 0 || walk.unscanned.length === 0) return [];
    const seen = new Set(walk.records.map((f) => recordKey(f.store, f.tier, f.name)));
    const carried = [];
    for (const [key, record] of priorByKey) {
        if (seen.has(key)) continue;
        if (unscannedCovers(walk.unscanned, record)) carried.push(record);
    }
    return carried;
}

// How many indexed records the store no longer holds. Counted rather than
// tracked through the loop because the sweep builds the new index from what the
// walk found, so a deleted memory leaves by not being carried forward; this is
// the number that says so out loud. A record from an unreadable tier is not
// among them: it was carried, and counting it as removed would report a
// deletion that never happened.
function countRemoved(priorByKey, found, carried) {
    if (priorByKey.size === 0) return 0;
    const live = new Set(found.map((f) => recordKey(f.store, f.tier, f.name)));
    for (const r of carried) live.add(recordKey(r.store, r.tier, r.name));
    let removed = 0;
    for (const key of priorByKey.keys()) {
        if (!live.has(key)) removed++;
    }
    return removed;
}

// Embed everything the sweep decided needs a vector, in bounded batches.
//
// A batch that throws, or that comes back with a vector this module will not
// write, is retried one text at a time, so a single input the model cannot
// handle costs its own record rather than every record beside it in the batch.
// A record that fails either way is reported and left out of the index, which
// means the next sweep tries it again: it is new again, because nothing
// recorded it.
//
// `signal` is the caller's abort, optional. It is read at a batch boundary and,
// inside the per-item retry, between items, which are the points where nothing
// is in flight: an embed call already handed to the model is the one thing here
// that cannot be taken back, so a check any finer would not stop anything
// sooner. What was embedded before the abort is returned rather than discarded,
// and the sweep persists it: an index missing the records the abandoned batches
// never reached is what the next sweep finishes.
async function embedAll(embedder, pending, failed, signal) {
    const out = [];
    const width = typeof embedder.dim === 'number' ? embedder.dim : null;
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
        if (isCancelled(signal)) return out;
        const batch = pending.slice(i, i + EMBED_BATCH);
        let vectors = null;
        try {
            vectors = await embedder.embed(batch.map((p) => p.text));
        } catch {
            vectors = null;
        }
        if (vectors && vectors.length === batch.length && vectors.every((v) => isVector(v, width))) {
            for (let j = 0; j < batch.length; j++) out.push(finish(batch[j], vectors[j]));
            continue;
        }
        for (const item of batch) {
            if (isCancelled(signal)) return out;
            let one = null;
            let reason = 'the embedder returned no usable vector';
            try {
                const r = await embedder.embed([item.text]);
                if (r && r.length === 1 && isVector(r[0], width)) one = r[0];
            } catch (err) {
                reason = 'the embedder failed on this memory: ' + errText(err);
            }
            if (one) out.push(finish(item, one));
            else failed.push({ store: item.store, tier: item.tier, name: item.name, reason });
        }
    }
    return out;
}

// The pending records a cancelled pass never handed to the model, named in failed
// so the account of the pass is whole. The counters already counted them as added
// or changed, and a caller decides a pass was partial from failed and the carried
// tiers, so leaving them out of both would read as a complete sweep over an index
// that is missing them. Anything already embedded or already failed is left alone,
// which is what makes this sound at either of the two points a batch loop can stop
// at: the boundary before a batch, and between the items of a batch's retry.
function noteUnreached(pending, embedded, failed) {
    const accounted = new Set(embedded.map((r) => recordKey(r.store, r.tier, r.name)));
    for (const f of failed) {
        if (f.name !== null) accounted.add(recordKey(f.store, f.tier, f.name));
    }
    for (const item of pending) {
        const key = recordKey(item.store, item.tier, item.name);
        if (accounted.has(key)) continue;
        accounted.add(key);
        failed.push({
            store: item.store,
            tier: item.tier,
            name: item.name,
            reason: 'the sweep was cancelled before this memory was embedded'
        });
    }
}

// Whether a vector may be written into the index: non-empty, every component a
// finite number, and the embedder's own width when it declares one. A NaN
// survives JSON as null, which the index reader refuses, so a single
// unvalidated vector would make every later sweep read the whole sidecar as
// corrupt and re-embed the entire store, forever.
function isVector(v, width) {
    const list = ArrayBuffer.isView(v) ? Array.from(v) : v;
    if (!Array.isArray(list) || list.length === 0) return false;
    if (width !== null && list.length !== width) return false;
    for (const x of list) {
        if (typeof x !== 'number' || !Number.isFinite(x)) return false;
    }
    return true;
}

function finish(item, vector) {
    return {
        store: item.store,
        tier: item.tier,
        name: item.name,
        mtime: item.mtime,
        hash: item.hash,
        model: item.model,
        vector: Array.from(vector)
    };
}

// A total order over records, so one unchanged store always produces one
// byte-identical index whatever order the filesystem enumerated it in.
function sortRecords(records) {
    const rank = (r) => TIERS.indexOf(r.tier);
    records.sort((a, b) => rank(a) - rank(b)
        || (a.store < b.store ? -1 : a.store > b.store ? 1 : 0)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// Cosine similarity, computed with both norms rather than as a bare dot
// product. The model returns normalized vectors, which would make the dot
// product sufficient, but the index outlives any one embedder and a vector that
// is not unit length would otherwise rank by its magnitude instead of its
// direction. A zero vector scores 0 against everything rather than dividing by
// zero.
//
// Vectors of different widths score 0 rather than being compared over their
// shared prefix. Two widths mean two models, whose dimensions carry unrelated
// meanings, and a prefix comparison would put a number on that non-answer and
// rank by it. The model-identity rebuild is what keeps the index single-width;
// this is the floor under a caller that mixes records anyway.
function cosine(a, b) {
    // Length rather than array-ness, so a caller holding the model's own
    // Float32Array is compared rather than refused.
    if (!a || !b || typeof a.length !== 'number' || a.length !== b.length) return 0;
    const n = a.length;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Nearest neighbors of a query vector, brute force over every record.
//
// No ANN structure, deliberately. This store is thousands of records at the
// outside, where a full pass is a few milliseconds, and an approximate index is
// a second piece of derived state that can be stale or wrong in ways that show
// up as quietly missing results rather than as an error.
//
// Records of equal similarity are ordered by tier and name, so a search over an
// unchanged index is reproducible.
function search(queryVector, records, options) {
    const opts = options || {};
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 10;
    const scored = records.map((r) => ({
        store: r.store,
        tier: r.tier,
        name: r.name,
        archived: isArchivedTier(r.tier),
        score: cosine(queryVector, r.vector)
    }));
    scored.sort((a, b) => b.score - a.score
        || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)
        || (a.store < b.store ? -1 : a.store > b.store ? 1 : 0)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return scored.slice(0, limit);
}

// query's answer to an abort, in the shape every other typed status here takes,
// so a caller reading the hits or the sweep behind them meets the same keys it
// meets on an absent embedder. `swept` is whatever the sweep reported, and null
// where the abort landed before the sweep was entered at all.
function cancelledQuery(embedder, swept) {
    return { status: 'cancelled', embedder, hits: [], sweep: swept };
}

// The whole query path: bring the index up to date, embed the query, rank.
// This is the one call a search surface needs, and it answers absence in the
// same typed shape every other entry point here does, so a caller degrades to
// its lexical channel by reading a status rather than by catching an error.
//
// options.signal reaches the sweep and the embedding behind it as well as the
// three checks here, so a query a caller has abandoned stops at the next check
// with status 'cancelled' rather than ranking for nobody and holding the process
// open while it does.
async function query(text, options) {
    const opts = options || {};
    const embedder = opts.embedder || await loadEmbedder();
    if (!embedder.available) {
        return { status: embedder.status, embedder, hits: [], sweep: null };
    }
    // The load is the await a caller's bound is likeliest to expire across, so
    // the abort is read the moment it returns and before the sweep is entered.
    if (isCancelled(opts.signal)) return cancelledQuery(embedder, null);
    const swept = await sweep({ ...opts, embedder });
    // The sweep reads the same signal out of the same options, so a sweep that
    // stopped is this query stopping too: there is no index to rank against and
    // no reader waiting for a ranking.
    if (swept.status === 'cancelled') return cancelledQuery(embedder, swept);
    let vector = null;
    try {
        const vectors = await embedder.embed([String(text)]);
        if (vectors && vectors.length === 1) vector = vectors[0];
    } catch (err) {
        return {
            status: 'query-failed',
            embedder,
            hits: [],
            sweep: swept,
            detail: 'the embedder failed on the query text: ' + errText(err)
        };
    }
    if (vector === null) {
        return {
            status: 'query-failed',
            embedder,
            hits: [],
            sweep: swept,
            detail: 'the embedder returned no vector for the query text'
        };
    }
    // The last check, ahead of the ranking: the query embed above is another
    // await, and the search below is the whole of this function's remaining
    // cost, a full pass over every record in the index.
    if (isCancelled(opts.signal)) return cancelledQuery(embedder, swept);
    return { status: 'ok', embedder, hits: search(vector, swept.records, opts), sweep: swept };
}

module.exports = {
    PACKAGE_NAME,
    MODEL_ID,
    MODEL_DTYPE,
    MODEL_DIM,
    EMBEDDER_DIR,
    MODEL_FILES,
    SIDECAR_FILE,
    INSTALL_REMEDY,
    TIERS,
    // The batch width and the body hash, exported because the database
    // publisher derives a second copy of this store and has to agree with the
    // local sweep about how wide a batch is and about when a body changed.
    // Two spellings of either would be two derived copies of one store built
    // from two readings of it.
    EMBED_BATCH,
    hashOf,
    isArchivedTier,
    embedderRoot,
    packageDirPath,
    modelCacheDir,
    missingModelFiles,
    probeEmbedder,
    loadEmbedder,
    modelIdentity,
    indexPath,
    readIndex,
    walkStore,
    recordPath,
    embedText,
    sweep,
    cosine,
    search,
    query
};
