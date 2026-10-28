#Requires -Version 7.0
<#
.SYNOPSIS
Creates a knowledge base in one call: copied, committed, trusted, listed, and
pushed only where a remote is given.

.DESCRIPTION
The script the wiki-new skill runs. It runs five steps in order, each a sibling
script of this one run as its own pwsh process, or git:

  1. kb-registry.ps1 Init -Root <root>, where no wiki list exists and -Root is
     given. Where a list exists its root is used and -Root, if given, must name
     the same folder. Where neither a list nor -Root exists the run is refused.
  2. new-kb.ps1 -Name <name> -Path <root>\<name>: the template copied, the
     version mark written, the first commit made.
  3. kb-trust.ps1 -Path <root>\<name>: the folder trusted for Claude Code on
     this account, proven by a second probe.
  4. git remote add origin <url> and git push -u origin main, only with
     -Remote. Without it the knowledge base commits locally and pushes nothing.
  5. kb-registry.ps1 Add: the knowledge base listed; its List line is printed.

Each step's refusal stops the run with that step's own stderr line, and a stop
after the folder exists names the folder so the operator can remove it, as
new-kb.ps1 does. -WhatIf prints the five steps as they would run and runs none
of them; it still reads the list's root to say which, and reads the list for
the name, so a listed name is refused there too. Nothing here registers a
scheduled task. Before step 1 the run refuses a name or description the list
would refuse at step 5, a value starting with a hyphen or a dash, and a name
already listed, so such a run copies, trusts and pushes nothing.

.PARAMETER Name
The knowledge base's name, also its folder name under the root.

.PARAMETER Description
A one-paragraph description for the wiki list. May be empty.

.PARAMETER Root
The folder new knowledge bases are created under, needed only where no wiki
list exists yet.

.PARAMETER Remote
An existing git repository URL to attach as origin and push main to.

.EXAMPLE
pwsh -NoProfile -File ./kb-create.ps1 -Name acme -Description "Acme contracts and correspondence." -Root D:\Wikis

.EXAMPLE
pwsh -NoProfile -File ./kb-create.ps1 -Name acme -Description "Acme contracts." -Remote https://github.com/example/acme-kb.git -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$Name,

    [Parameter(Mandatory)]
    [AllowEmptyString()]
    [string]$Description,

    [string]$Root,

    [string]$Remote
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking $LASTEXITCODE explicitly, so native
# command failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Set once step 2 has created the folder. A failure after that point leaves a
# knowledge base behind that the next run would refuse as a non-empty folder.
# Not $script:WikiPath: names ignore case, so it would be the top-level $wikiPath.
$script:LeftFolder = $null

# Set as step 3 starts, since from then on ~/.claude.json may hold a trust
# entry for the folder. Removing the folder leaves that entry, so a later stop
# says so.
$script:LeftTrust = $false

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal
# is legible to the calling session without a PowerShell stack trace. Once the
# folder exists, the operator is told where it is.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-create: $Reason")
    if ($script:LeftFolder) {
        [Console]::Error.WriteLine("kb-create: this run left a knowledge base at $($script:LeftFolder). Remove it before retrying.")
    }
    if ($script:LeftTrust) {
        [Console]::Error.WriteLine("kb-create: ~/.claude.json may also hold a trust entry for $($script:LeftFolder). It stays after the folder is removed, and a retry at the same path reuses it.")
    }
    exit 1
}

# Full path with no trailing separator, as kb-registry.ps1's ConvertTo-NormalPath
# shapes the root it stores, so the folder printed here is the one the list holds.
function ConvertTo-NormalPath {
    param([string]$Value)
    $full = [System.IO.Path]::GetFullPath($Value)
    $pathRoot = [System.IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $pathRoot.Length) {
        $full = $full.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    }
    return $full
}

# Quotes one argument for a Windows command line so the child receives it unchanged.
function ConvertTo-CommandLineArgument {
    param([string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($c in $Value.ToCharArray()) {
        if ($c -eq [char]'\') { $backslashes++; continue }
        if ($c -eq [char]'"') {
            [void]$builder.Append([char]'\', 2 * $backslashes + 1)
        } elseif ($backslashes -gt 0) {
            [void]$builder.Append([char]'\', $backslashes)
        }
        $backslashes = 0
        [void]$builder.Append($c)
    }
    [void]$builder.Append([char]'\', 2 * $backslashes)
    [void]$builder.Append('"')
    return $builder.ToString()
}

# Runs a sibling script under this same PowerShell host with both streams
# captured, and returns its exit code and text. The child inherits this
# process's environment, so USERPROFILE, LOCALAPPDATA and PATH reach it.
function Invoke-Engine {
    param([string]$ScriptPath, [string[]]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:psExe
    $psi.Arguments = (@(@('-NoProfile', '-File', $ScriptPath) + $Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($psi)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdout, $stderr))
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout.Result; Stderr = $stderr.Result }
    } finally {
        $process.Dispose()
    }
}

# Splits text into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# Re-emits a child's stderr lines, so the step's own refusal reaches the operator.
function Write-ChildErrors {
    param($Result)
    foreach ($line in (Get-Lines $Result.Stderr)) { [Console]::Error.WriteLine($line) }
}

# Runs one step's script and stops the run on its failure, naming the step.
function Invoke-Step {
    param([int]$Number, [string]$What, [string]$ScriptPath, [string[]]$Arguments)
    $result = Invoke-Engine $ScriptPath $Arguments
    Write-ChildErrors $result
    if ($result.ExitCode -ne 0) {
        Stop-WithReason "step $Number ($What) failed with exit $($result.ExitCode)."
    }
    return $result
}

$script:psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$registry = Join-Path $PSScriptRoot 'kb-registry.ps1'
$newKb = Join-Path $PSScriptRoot 'new-kb.ps1'
$trust = Join-Path $PSScriptRoot 'kb-trust.ps1'
foreach ($sibling in @($registry, $newKb, $trust)) {
    if (-not (Test-Path -LiteralPath $sibling -PathType Leaf)) {
        Stop-WithReason "sibling script not found next to this script: $sibling"
    }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-WithReason 'git was not found on PATH.'
}

# The list's name and description rules, checked here so a value step 5 would
# refuse stops the run before anything is copied, trusted or pushed. These
# mirror Get-NameRefusal, $reservedNames and $unsafeText in kb-registry.ps1,
# which stays the rule's owner and checks again at step 5.
if (-not [regex]::IsMatch($Name, '\A[A-Za-z0-9_-](?:[A-Za-z0-9_.-]{0,62}[A-Za-z0-9_-])?\z')) {
    Stop-WithReason "name '$Name' must be 1 to 64 letters, digits, hyphen, underscore or dot, not starting or ending with a dot"
}
$reservedNames = @('CON', 'PRN', 'AUX', 'NUL') + (0..9 | ForEach-Object { "COM$_"; "LPT$_" })
if ($reservedNames -contains $Name.Split('.')[0]) {
    Stop-WithReason "name '$Name' is a reserved device name"
}
$unsafeText = '[\p{Cc}\u200E\u200F\u061C\u2028\u2029\u202A-\u202E\u2066-\u2069]'
if ([regex]::IsMatch($Description, $unsafeText)) {
    Stop-WithReason 'description must not contain control characters, tab, line breaks and text-direction marks included'
}
# A child PowerShell process run with -File reads a value starting with a
# hyphen, en dash, em dash or horizontal bar as a parameter name, so no value
# passed on may start with one.
$dashes = @([char]0x2D, [char]0x2013, [char]0x2014, [char]0x2015)
foreach ($pair in @(@('name', $Name), @('description', $Description), @('remote', $(if ($PSBoundParameters.ContainsKey('Remote')) { $Remote } else { '' })))) {
    if ($pair[1].Length -gt 0 -and $dashes -contains $pair[1][0]) { Stop-WithReason "the $($pair[0]) must not start with a hyphen or a dash: $($pair[1])" }
}
if ($PSBoundParameters.ContainsKey('Remote') -and [string]::IsNullOrWhiteSpace($Remote)) {
    Stop-WithReason '-Remote was given empty; pass a repository URL, or leave -Remote out to commit locally.'
}

# --- Step 1's decision: the list's root, or an Init with -Root.
$rootResult = Invoke-Engine $registry @('Root')
$initNeeded = $false
$rootFolder = $null
if ($rootResult.ExitCode -eq 0) {
    # @() keeps one line an array: a function's single-element return unrolls
    # to a bare string, and [0] would then take its first character.
    $rootFolder = @(Get-Lines $rootResult.Stdout)[0]
    if ($PSBoundParameters.ContainsKey('Root')) {
        try { $givenRoot = ConvertTo-NormalPath $Root } catch { Stop-WithReason "root is not a valid path: $Root" }
        if (-not [string]::Equals($givenRoot, $rootFolder, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-WithReason "the wiki list already has root '$rootFolder'; -Root '$Root' names another folder, so nothing was done."
        }
    }
} elseif ($rootResult.Stderr.Contains('no wiki list', [StringComparison]::Ordinal)) {
    # kb-registry.ps1's no-list refusal; any other refusal is passed through.
    if (-not $PSBoundParameters.ContainsKey('Root')) {
        Stop-WithReason 'no wiki list exists on this account and no -Root was given; pass -Root <folder> once to create the list.'
    }
    if (-not [System.IO.Path]::IsPathFullyQualified($Root)) { Stop-WithReason "root is not absolute: $Root" }
    try { $rootFolder = ConvertTo-NormalPath $Root } catch { Stop-WithReason "root is not a valid path: $Root" }
    $initNeeded = $true
} else {
    Write-ChildErrors $rootResult
    Stop-WithReason "step 1 (reading the wiki list's root) failed with exit $($rootResult.ExitCode)."
}
$wikiPath = Join-Path $rootFolder $Name

# A name already listed is refused here rather than at step 5. Get exits 0
# only for a listed name and refuses an unlisted one by name; any other
# refusal is passed through, as step 1's is.
if (-not $initNeeded) {
    $getResult = Invoke-Engine $registry @('Get', '-Name', $Name)
    if ($getResult.ExitCode -eq 0) {
        Stop-WithReason "name '$Name' is already listed, so nothing was done."
    }
    if (-not $getResult.Stderr.Contains('is not listed', [StringComparison]::Ordinal)) {
        Write-ChildErrors $getResult
        Stop-WithReason "step 1 (reading the wiki list for $Name) failed with exit $($getResult.ExitCode)."
    }
}

$steps = @(
    $(if ($initNeeded) { "1. Create the wiki list with root $rootFolder (kb-registry.ps1 Init)." } else { "1. Use the wiki list's root $rootFolder; no Init needed." })
    "2. Copy the template to $wikiPath and make the first commit (new-kb.ps1)."
    "3. Trust $wikiPath for Claude Code on this account (kb-trust.ps1)."
    $(if ($PSBoundParameters.ContainsKey('Remote')) { "4. Add remote origin $Remote and push main (git)." } else { '4. Attach no remote; the knowledge base commits locally and pushes nothing.' })
    "5. Add $Name to the wiki list (kb-registry.ps1 Add)."
)
if ([bool]$WhatIfPreference) {
    foreach ($step in $steps) { Write-Output "kb-create: $step" }
    exit 0
}

# --- Step 1.
if ($initNeeded) {
    $null = Invoke-Step 1 'kb-registry.ps1 Init' $registry @('Init', '-Root', $rootFolder)
}

# --- Step 2. The folder exists from here on, so a later stop names it.
$null = Invoke-Step 2 'new-kb.ps1' $newKb @('-Name', $Name, '-Path', $wikiPath)
$script:LeftFolder = $wikiPath

# --- Step 3. Set before the step, since kb-trust.ps1 can write the entry and
# then refuse at its second probe.
$script:LeftTrust = $true
$null = Invoke-Step 3 'kb-trust.ps1' $trust @('-Path', $wikiPath)

# --- Step 4. The URL follows -- so git reads it as a URL, never an option.
if ($PSBoundParameters.ContainsKey('Remote')) {
    & git -C $wikiPath remote add -- origin $Remote
    if ($LASTEXITCODE -ne 0) { Stop-WithReason "step 4 (git remote add origin) failed with exit $LASTEXITCODE." }
    # No git or credential-manager prompt: a missing HTTPS credential fails
    # here instead of waiting on an answer. An ssh prompt, or an askpass
    # helper the account has configured, is not covered.
    $savedPrompt = $env:GIT_TERMINAL_PROMPT
    $savedGcm = $env:GCM_INTERACTIVE
    try {
        $env:GIT_TERMINAL_PROMPT = '0'
        $env:GCM_INTERACTIVE = 'never'
        & git -C $wikiPath push -u origin main
        $pushExit = $LASTEXITCODE
    } finally {
        $env:GIT_TERMINAL_PROMPT = $savedPrompt
        $env:GCM_INTERACTIVE = $savedGcm
    }
    if ($pushExit -ne 0) { Stop-WithReason "step 4 (git push -u origin main) failed with exit $pushExit." }
}

# --- Step 5. Add prints the new wiki's List line, which is this run's result.
$added = Invoke-Step 5 'kb-registry.ps1 Add' $registry @('Add', '-Name', $Name, '-Path', $wikiPath, '-Description', $Description)
foreach ($line in (Get-Lines $added.Stdout)) { Write-Output $line }

$script:LeftFolder = $null
$script:LeftTrust = $false
exit 0
