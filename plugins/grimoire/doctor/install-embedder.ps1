# The doctor's embedder-install and index-health helpers: whether the local
# embedding stack (plugins/grimoire/scripts/memory-index.js's optional
# in-process model) is installed and usable, installing it under -Fix, and
# reading the derived index's health without touching it.
#
# Dot-sourced by doctor.ps1, which calls these under its "Embedder (semantic
# search)" check; the repo test suite dot-sources the same file and calls the
# same functions against a redirected embedder root and store root, which is
# why both arrive as parameters instead of being resolved from the
# environment here. This file defines functions only; dot-sourcing it runs
# nothing and writes nothing.
#
# Every probe and every warm-up spawns its own node process rather than
# sharing one, and that separation is load-bearing, not incidental:
# memory-index.js sets the embedding library's remote-fetch flag off on a
# process-global environment object, so a process that probes the install and
# then tries to warm the model in the same process would silently download
# nothing. Spawning fresh for each step is what keeps a probe from ever
# sharing a process with a warm-up.
#
# The install location and the store root reach the child node process
# through the same two-variable code/data gates memory-index.js and memq.js
# already define: KIT_EMBEDDER_ROOT plus KIT_EMBEDDER_ROOT_ALLOW_CODE=1 for
# which package gets require()'d, KIT_MEMORY_ROOT plus
# KIT_MEMORY_ROOT_ALLOW_DATA=1 for which store gets read. Setting them here
# rather than trusting the real machine's home directory is what lets the
# test suite drive every function below against a sandbox without ever
# touching the operator's real ~\.claude or ~\.claude\kit-embedder.

# The install size: 398 MB, measured as
# Get-ChildItem -Recurse -Force -File | Measure-Object Length -Sum against the
# whole ~\.claude\kit-embedder directory (node_modules and every dependency
# @huggingface/transformers pulls in, onnxruntime-node and onnxruntime-web
# among them) at @huggingface/transformers 4.2.0, this file's pinned dtype
# (MODEL_DTYPE in memory-index.js). It excludes nothing under that root: the
# figure is the whole directory this section creates, not the package alone.
# Stated here so the consent prompt carries a real figure rather than an
# estimate; re-measure whenever the pinned package changes.
$script:EmbedderConsentSizeMB = 398

# The model download is not pinned to a Hugging Face Hub revision, unlike the
# npm package above: transformers.js caches a non-'main' revision under a
# revision-hash subdirectory (.cache/Xenova/all-MiniLM-L6-v2/<sha>/...) rather
# than the plain per-model path it uses for the default branch, and
# memory-index.js's probe checks for the model files at the plain path only.
# Passing a pinned revision to the warm-up therefore downloads correctly but
# leaves the probe unable to find what it downloaded, reporting 'unusable'
# forever. Supporting a pin would mean teaching the probe's file-existence
# check the revision-keyed layout, which is memory-index.js's file and outside
# this round's authorization. Documented limitation, not silently dropped.

# The -e script bodies. Each is spawned as its own node process (see header),
# and each takes the path to memory-index.js as its one positional argument
# (process.argv[1] under node -e, the convention doctor.ps1's own node -e
# probes take). None of them import anything this repo does
# not already ship: the embedding package itself is require()'d only inside
# memory-index.js's own loadEmbedder, from the install location the
# environment variables above select.

# Prints probeEmbedder()'s result as JSON. Read-only: probeEmbedder touches
# only fs.readFileSync and fs.existsSync.
$script:EmbedderProbeScript = @'
const mi = require(process.argv[1]);
process.stdout.write(JSON.stringify(mi.probeEmbedder()));
'@

# Downloads and materializes the model, the one step in this whole kit
# allowed to fetch it. This deliberately does not call memory-index.js's own
# loadEmbedder: that function probes first and returns the typed absence
# immediately when the model files are not already on disk, and it never
# turns remote fetching back on once loaded, because every query-path process
# must only ever read what is already cached. Downloading therefore means
# requiring the installed package directly and driving transformers.pipeline
# with the library's own default (fetch allowed), while still pinning both
# model directories to the exact location memory-index.js's probe checks
# (mi.modelCacheDir()), so what lands on disk here is exactly what a later
# query-path process, with fetching off, will find already there. An embed
# call after the pipeline loads catches a load that "succeeded" but cannot
# actually run inference. Prints {ok:true} or {ok:false, status, detail} as
# JSON on the last line of stdout, so a library warning on an earlier line
# cannot be mistaken for the result.
$script:EmbedderWarmScript = @'
(async () => {
    const mi = require(process.argv[1]);
    let transformers;
    try {
        const entry = require.resolve(mi.packageDirPath());
        transformers = require(entry);
    } catch (err) {
        console.log(JSON.stringify({ ok: false, status: 'absent', detail: 'could not load ' + mi.packageDirPath() + ': ' + String((err && err.message) || err) }));
        process.exitCode = 1;
        return;
    }
    transformers.env.cacheDir = mi.modelCacheDir();
    transformers.env.localModelPath = mi.modelCacheDir();
    try {
        const extractor = await transformers.pipeline('feature-extraction', mi.MODEL_ID, { dtype: mi.MODEL_DTYPE });
        await extractor(['warm'], { pooling: 'mean', normalize: true });
    } catch (err) {
        console.log(JSON.stringify({ ok: false, status: 'warm-failed', detail: String((err && err.message) || err) }));
        process.exitCode = 1;
        return;
    }
    console.log(JSON.stringify({ ok: true }));
})();
'@

# Prints the sidecar's health as JSON: status ('ok' | 'absent' | 'corrupt'),
# a record count, the distinct model identities recorded, and the sidecar
# file's own mtime. Read-only: readIndex only reads the sidecar, and the
# stat below reads the same file a second time rather than writing anything.
$script:EmbedderIndexHealthScript = @'
const mi = require(process.argv[1]);
const fs = require('fs');
const idx = mi.readIndex();
let mtimeMs = null;
let mtimeIso = null;
try {
    const st = fs.statSync(mi.indexPath());
    mtimeMs = st.mtimeMs;
    mtimeIso = st.mtime.toISOString();
} catch { /* no sidecar yet, or it could not be stat'd; mtime stays null */ }
const models = [...new Set(idx.records.map((r) => r.model))];
process.stdout.write(JSON.stringify({
    status: idx.status,
    detail: idx.detail || null,
    count: idx.records.length,
    models,
    indexPath: mi.indexPath(),
    mtimeMs,
    mtimeIso
}));
'@

# Run one of the scripts above in its own node process, with the embedder
# root and (optionally) the store root wired through the environment gates.
# Every variable this function might set is saved and restored, because
# doctor.ps1 calls into this file more than once in a single run (a probe
# before -Fix, an install, a re-probe after) and a leaked override would
# point the memq shim check below at a sandbox no operator asked for.
function Invoke-EmbedderNode {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [Parameter(Mandatory = $true)][string]$MemoryIndexPath,
        [Parameter(Mandatory = $true)][string]$EmbedderRoot,
        [string]$StoreRoot,
        [string]$NodeExe = "node"
    )
    $keys = @("KIT_EMBEDDER_ROOT", "KIT_EMBEDDER_ROOT_ALLOW_CODE", "KIT_MEMORY_ROOT", "KIT_MEMORY_ROOT_ALLOW_DATA")
    $saved = @{}
    foreach ($k in $keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process") }
    try {
        $env:KIT_EMBEDDER_ROOT = $EmbedderRoot
        $env:KIT_EMBEDDER_ROOT_ALLOW_CODE = "1"
        if ($StoreRoot) {
            $env:KIT_MEMORY_ROOT = $StoreRoot
            $env:KIT_MEMORY_ROOT_ALLOW_DATA = "1"
        }
        else {
            Remove-Item Env:\KIT_MEMORY_ROOT -ErrorAction SilentlyContinue
            Remove-Item Env:\KIT_MEMORY_ROOT_ALLOW_DATA -ErrorAction SilentlyContinue
        }
        $output = & $NodeExe -e $Script $MemoryIndexPath 2>&1
        return @{ Code = $LASTEXITCODE; Output = @($output | ForEach-Object { [string]$_ }) }
    }
    finally {
        foreach ($k in $keys) {
            if ($null -eq $saved[$k]) { Remove-Item "Env:\$k" -ErrorAction SilentlyContinue }
            else { Set-Item "Env:\$k" $saved[$k] }
        }
    }
}

# probeEmbedder()'s result, or a typed failure when the child process itself
# could not answer: node missing is checked by the caller before this is ever
# invoked, so a non-zero exit here means the script's own require() failed (an
# incomplete plugin payload, most likely), and a last line that will not parse
# as JSON means the same thing by a different route, since Invoke-EmbedderNode
# merges stderr into the captured output and a warning or a deprecation notice
# landing last at exit 0 is exactly the case a bare ConvertFrom-Json cannot
# tell apart from a real answer.
function Get-EmbedderProbe {
    param(
        [Parameter(Mandatory = $true)][string]$MemoryIndexPath,
        [Parameter(Mandatory = $true)][string]$EmbedderRoot,
        [string]$NodeExe = "node"
    )
    $result = Invoke-EmbedderNode -Script $script:EmbedderProbeScript -MemoryIndexPath $MemoryIndexPath `
        -EmbedderRoot $EmbedderRoot -NodeExe $NodeExe
    $parsed = $null
    if ($result.Code -eq 0 -and $result.Output.Count -gt 0) {
        try { $parsed = $result.Output[-1] | ConvertFrom-Json } catch { $parsed = $null }
    }
    if ($null -eq $parsed) {
        return @{
            status  = 'probe-failed'
            detail  = 'could not run the embedder probe: ' + ($result.Output -join ' ')
            remedy  = $null
            root    = $EmbedderRoot
        }
    }
    return $parsed
}

# The sidecar's health, as data for the caller to report on. Never sweeps,
# never writes: the index is derived data the doctor only reads here, and
# reading it a second way (to report on it) must not be the thing that
# changes it.
function Get-EmbedderIndexHealth {
    param(
        [Parameter(Mandatory = $true)][string]$MemoryIndexPath,
        [Parameter(Mandatory = $true)][string]$EmbedderRoot,
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [string]$NodeExe = "node"
    )
    $result = Invoke-EmbedderNode -Script $script:EmbedderIndexHealthScript -MemoryIndexPath $MemoryIndexPath `
        -EmbedderRoot $EmbedderRoot -StoreRoot $StoreRoot -NodeExe $NodeExe
    $parsed = $null
    if ($result.Code -eq 0 -and $result.Output.Count -gt 0) {
        try { $parsed = $result.Output[-1] | ConvertFrom-Json } catch { $parsed = $null }
    }
    if ($null -eq $parsed) {
        return @{
            status = 'health-failed'
            detail = 'could not read the index: ' + ($result.Output -join ' ')
            count  = 0
            models = @()
        }
    }
    return @{
        status    = $parsed.status
        detail    = $parsed.detail
        count     = $parsed.count
        models    = @($parsed.models)
        indexPath = $parsed.indexPath
        mtimeMs   = $parsed.mtimeMs
        mtimeIso  = $parsed.mtimeIso
    }
}

# Report lines for the index-health block, independent of whatever the
# embedder probe found: an index can exist after the embedder that built it
# was removed, and the embedder can be freshly ready with no index yet, so
# every combination is a real state this prints rather than a gap one state
# happens to hide.
#
# Every line is raw text, unsanitized: this store-derived text (a corrupt
# index's detail string, a model identity) reaches a trusted report the same
# way the memory-sync section's notes do, through the caller's own
# Get-SanitizedLine pass over the whole returned array. That keeps this
# function callable on its own (the test suite dot-sources this file alone,
# without doctor.ps1's helpers defined) while still shipping sanitized in the
# doctor's actual output.
function Get-EmbedderIndexHealthLines {
    param($IndexHealth, $Probe)
    $lines = @()
    switch ($IndexHealth.status) {
        'absent' {
            $lines += "Index: none yet; built lazily at the first semantic query."
        }
        'corrupt' {
            $lines += ("Index: unreadable (" + $IndexHealth.detail + "); rebuilt automatically at the next query, never a repair to make by hand.")
        }
        'ok' {
            $modelText = if ($IndexHealth.models.Count -eq 0) { "(no records)" } else { ($IndexHealth.models -join ', ') }
            $ageText = "unknown age"
            if ($IndexHealth.mtimeIso) {
                try {
                    $span = (Get-Date) - [datetime]$IndexHealth.mtimeIso
                    if ($span.TotalDays -ge 1) { $ageText = ([math]::Floor($span.TotalDays)).ToString() + "d ago" }
                    elseif ($span.TotalHours -ge 1) { $ageText = ([math]::Floor($span.TotalHours)).ToString() + "h ago" }
                    else { $ageText = ([math]::Max(0, [math]::Floor($span.TotalMinutes))).ToString() + "m ago" }
                }
                catch { $ageText = $IndexHealth.mtimeIso }
            }
            $lines += ("Index: " + $IndexHealth.count + " record(s), model " + $modelText + ", last swept " + $ageText + ".")
            # A record built by a model identity other than the one installed now
            # is not corruption and not a failure; it is the ordinary state right
            # after a package upgrade, and the next query pays for a full rebuild
            # rather than mixing incomparable vectors. Naming it here is a fact
            # the operator otherwise has no way to see before that query runs.
            if ($Probe -and $Probe.identity -and $IndexHealth.models.Count -gt 0 -and
                ($IndexHealth.models | Where-Object { $_ -ne $Probe.identity }).Count -gt 0) {
                $lines += "Index holds record(s) built by a different model identity than the one installed now; the next query does a full rebuild."
            }
        }
        default {
            $lines += ("Index: could not be read (" + [string]$IndexHealth.detail + ").")
        }
    }
    return $lines
}

# One npm install into EmbedderRoot's own private prefix, or a failure
# carrying npm's own tail output. Factored out of Install-Embedder because two
# call sites need it: the ordinary first install, and the bounded one-time
# fallback below when a warm-up discovers a package the probe called
# 'unusable' cannot even be require()'d.
function Invoke-EmbedderNpmInstall {
    param([Parameter(Mandatory = $true)][string]$EmbedderRoot)
    # A private prefix, never a global install: --prefix installs into
    # EmbedderRoot's own node_modules and writes a package.json there,
    # touching nothing outside the directory Install-Embedder already created.
    # The version is pinned rather than left to float: an unpinned install
    # picks up whatever a later npm publish put on the tag, unreviewed. Two
    # transitive dependencies (onnxruntime-node, sharp) install a native
    # binary or run a build step in their own postinstall scripts; this
    # package ships the platform binaries onnxruntime-node needs directly in
    # its published tree, so --ignore-scripts skips those scripts without
    # leaving the install unable to load. Re-verify that holds before raising
    # the pin: a future release could move to a script-driven binary fetch.
    $npmOutput = & npm install "@huggingface/transformers@4.2.0" --prefix $EmbedderRoot --ignore-scripts --no-audit --no-fund --loglevel=error 2>&1
    $npmCode = $LASTEXITCODE
    if ($npmCode -ne 0) {
        # Raw text, unsanitized here: the caller (doctor.ps1) sanitizes every
        # note in this array before it reaches a report, the same pass every
        # other installer's notes take. Sanitizing here too would
        # double-truncate and make the cap this function's business instead of
        # the report's.
        $tail = ($npmOutput | Select-Object -Last 8 | ForEach-Object { [string]$_ })
        return @{ Ok = $false; Notes = (@("npm install failed (exit $npmCode); the directory is left in place for diagnosis:") + $tail) }
    }
    return @{ Ok = $true; Notes = @("Ran npm install --prefix $EmbedderRoot @huggingface/transformers@4.2.0.") }
}

# One warm-up attempt, in its own node process (see this file's header for why
# a probe and a warm-up can never safely share one), as {Ok, Status, Reason}.
# Status carries the warm script's own failure shape ('absent' when the
# package could not even be require()'d, 'warm-failed' when it loaded but the
# pipeline or the embed call itself threw, or $null when the process could not
# answer at all), which is what lets the caller tell "the package itself is
# broken" apart from "the model materialized wrong" without re-parsing text.
function Invoke-EmbedderWarmUp {
    param(
        [Parameter(Mandatory = $true)][string]$MemoryIndexPath,
        [Parameter(Mandatory = $true)][string]$EmbedderRoot,
        [string]$NodeExe = "node"
    )
    $warm = Invoke-EmbedderNode -Script $script:EmbedderWarmScript -MemoryIndexPath $MemoryIndexPath `
        -EmbedderRoot $EmbedderRoot -NodeExe $NodeExe
    $warmParsed = $null
    if ($warm.Output.Count -gt 0) {
        try { $warmParsed = $warm.Output[-1] | ConvertFrom-Json } catch { $warmParsed = $null }
    }
    if ($warm.Code -ne 0 -or $null -eq $warmParsed -or -not $warmParsed.ok) {
        $reason = if ($warmParsed -and $warmParsed.detail) { [string]$warmParsed.detail } else { ($warm.Output -join ' ') }
        $status = if ($warmParsed -and $warmParsed.status) { [string]$warmParsed.status } else { $null }
        return @{ Ok = $false; Status = $status; Reason = $reason }
    }
    return @{ Ok = $true; Status = $null; Reason = $null }
}

# Bring the embedder root to a ready state: install the package if it is not
# there, warm the model if the cache is missing or incomplete, then assert
# the result is actually ready before reporting success.
#
# The two steps are independent because the two failure shapes are
# independent: 'absent' (npm never ran, or ran and never finished) needs the
# package; 'unusable' (the package is present but the model cache is missing
# or partial) needs only the warm-up. Re-running npm install over a package
# that is already there is not wrong, but it is a multi-hundred-megabyte
# download this function does not need to repeat every time a machine's
# model cache alone went missing.
#
# A machine can also reach 'unusable' with a package that is present on disk
# but not actually loadable (an npm install that failed partway through,
# leaving a manifest without its dependencies): skipping npm there would
# leave every future -Fix skipping it
# too, warming forever, and reporting the same unreachable remedy. So when the
# warm-up reports it could not even require() the package (Status 'absent'),
# and this call skipped npm on the assumption the package was fine, one npm
# install runs and the warm-up is retried once. The retry is bounded by the
# condition itself, never by a counter: it can only be reached from the
# skipped-npm branch, so a package that still cannot load after a fresh
# install falls through to the ordinary failure below rather than looping.
#
# Every failure path leaves what was made for diagnosis (the doctor never
# deletes) and returns Ok=false with the reason, never a report that claims
# readiness it did not verify.
function Install-Embedder {
    param(
        [Parameter(Mandatory = $true)][string]$PluginRoot,
        [Parameter(Mandatory = $true)][string]$EmbedderRoot,
        [string]$NodeExe = "node"
    )
    if ($null -eq (Get-Command $NodeExe -ErrorAction SilentlyContinue)) {
        return @{ Ok = $false; Notes = @("node is not on PATH, so the embedding stack cannot be installed.") }
    }
    if ($null -eq (Get-Command npm -ErrorAction SilentlyContinue)) {
        return @{ Ok = $false; Notes = @("npm is not on PATH, so the embedding stack cannot be installed. Install Node.js (which ships npm) and re-run.") }
    }
    $miPath = Join-Path $PluginRoot "scripts\memory-index.js"
    if (-not (Test-Path -LiteralPath $miPath)) {
        return @{ Ok = $false; Notes = @("memory-index.js not found at $miPath; this plugin payload is incomplete.") }
    }

    $before = Get-EmbedderProbe -MemoryIndexPath $miPath -EmbedderRoot $EmbedderRoot -NodeExe $NodeExe
    if ($before.status -eq 'ready') {
        return @{ Ok = $true; Notes = @("Already installed and ready; nothing to do.") }
    }

    try { New-Item -ItemType Directory -Force -Path $EmbedderRoot | Out-Null }
    catch { return @{ Ok = $false; Notes = @("Could not create ${EmbedderRoot}: $($_.Exception.Message)") } }

    $notes = @()
    $skippedNpm = $before.status -eq 'unusable'
    if (-not $skippedNpm) {
        $install = Invoke-EmbedderNpmInstall -EmbedderRoot $EmbedderRoot
        if (-not $install.Ok) { return $install }
        $notes += $install.Notes
    }
    else {
        $notes += "Package already installed; the model cache was missing or incomplete, so only the warm-up below repairs it."
    }

    $warm = Invoke-EmbedderWarmUp -MemoryIndexPath $miPath -EmbedderRoot $EmbedderRoot -NodeExe $NodeExe
    if (-not $warm.Ok -and $skippedNpm -and $warm.Status -eq 'absent') {
        # The probe called the package 'unusable' from a missing model cache,
        # but the real problem is that npm was skipped over a package that
        # cannot even load. One install, one retry.
        $notes += "The installed package could not be loaded, not just a missing model (" + $warm.Reason + "); running npm install once to repair it."
        $retry = Invoke-EmbedderNpmInstall -EmbedderRoot $EmbedderRoot
        if (-not $retry.Ok) { return @{ Ok = $false; Notes = ($notes + $retry.Notes) } }
        $notes += $retry.Notes
        $warm = Invoke-EmbedderWarmUp -MemoryIndexPath $miPath -EmbedderRoot $EmbedderRoot -NodeExe $NodeExe
    }
    if (-not $warm.Ok) {
        return @{ Ok = $false; Notes = ($notes + @("Warming the model failed: " + $warm.Reason + ". The install is left in place for diagnosis.")) }
    }

    # The trap this assertion exists for: the expected model-file layout is
    # confirmed against one real install and inferred for a fresh download, so
    # a warm-up that produced a different layout must fail here, loudly,
    # rather than leave the probe reporting 'unusable' forever on a machine
    # that just spent several minutes and hundreds of megabytes on this step.
    $after = Get-EmbedderProbe -MemoryIndexPath $miPath -EmbedderRoot $EmbedderRoot -NodeExe $NodeExe
    if ($after.status -ne 'ready') {
        return @{ Ok = $false; Notes = ($notes + @("The install did not become ready after warming (status: $($after.status)): " + [string]$after.detail)) }
    }

    return @{ Ok = $true; Notes = ($notes + @("Warmed the model; the embedding stack now reports ready.")) }
}
