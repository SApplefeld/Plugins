# Probes the memory database host: the SQL Server instance the kit's shared
# semantic index lives on, and the embedding server whose vectors fill it.
#
# It measures rather than repairs. Each check prints one line. Check 2 prints a
# second whenever it reached the server, saying whether the configured database
# is there: INFO where the name was read, FAIL where the config's name is one
# this script will not interpolate. So a reader keying on the check number finds
# two lines at check 2 on a run that reached the server and one on a run that
# did not. The script exits non-zero when any check FAILs, which is what makes
# it serve both as a hand-run instrument during setup and as the doctor's
# memory-database step.
#
#   pwsh -File Test-MemoryDatabaseHost.ps1
#   pwsh -File Test-MemoryDatabaseHost.ps1 -ConfigPath C:\path\to\config.json
#   pwsh -File Test-MemoryDatabaseHost.ps1 -Quick
#
# OUTPUT IS A CONTRACT, not a convenience. Every line is
#
#   <STATUS>  <n>. <check name>: <measured value>
#
# with STATUS one of PASS, FAIL or INFO and <n> the check's number. The doctor
# parses these lines, so the shape, the numbers and the names are stable text.
# Check number 0 belongs to the client config itself, which is read before any
# check runs and before anything reaches the network.
#
# Exit code: 0 when nothing FAILs (INFO lines are allowed), 1 otherwise.
#
# ONE DEADLINE FOR THE FOUR REACHABILITY CHECKS. Checks 1 through 4 share a
# single budget, the config's timeout, rather than each taking one: a host that
# drops packets instead of refusing them makes every one of those checks wait,
# and per-check timeouts multiply into a run that outlasts its own bound. Each
# boundary call takes what is left of the budget instead of waiting again, and
# a sqlcmd spawn splits its share between the login clock and the query clock,
# which run one after the other.
#
# THE DEADLINE DECIDES WHETHER A CALL STARTS, ITS OWN CLOCK DECIDES HOW LONG IT
# RUNS. Each check screens the deadline before it calls out, which is what
# turns a spent budget into a named check line; the boundary functions keep the
# same screen as a belt that no caller currently reaches. A call that does
# start runs on a whole-second clock divided down from what remains, lifted
# where what remains is under the floor the tool will not go below: two seconds
# for a sqlcmd spawn, which keeps a login clock and a query clock one after the
# other, and one second for an HTTP call. That lift is the one place this
# script's own arithmetic lets a call outrun the deadline, so checks 1 through 4
# finish less than two seconds past the configured timeout, and no call starts
# after it. The bound rests on each tool honouring the clock it is handed:
# sqlcmd's -l and -t, and Invoke-WebRequest's -TimeoutSec. No kill wraps either
# call, so a child that ignores its own clock is bounded by nothing here, and
# what the run reports is the check it was still waiting on. Checks 5 and 6
# stand outside the budget: check 5 because its duration is the measurement, as
# stated below, and check 6 because it spawns only the local tool and reaches no
# host.
#
# A LINE THAT MEASURED NOTHING IS A FAIL, naming what was not read: a probe
# that reports anything else while never reaching the host is the expensive
# lie, since the doctor step reads this run's exit code as the host's health.
# That covers a check the deadline stopped and a reading the config made
# impossible, which is a database name this script will not interpolate.
#
# INFO IS FOR A READING THAT COST THE RUN NOTHING. There are three: check 2's
# line for a database that is simply not on the server yet, which is the
# ordinary state before the installer runs; check 5's skip under -Quick; and
# check 0's note that an out-of-range timeoutMs was replaced by the default,
# after which every check still measures what it was asked for. Check 5 is
# outside the budget on purpose: it runs only after check 4 has proved the
# server answers, and its duration is the measurement being taken, so its calls
# take the per-call timeout and draw on no shared deadline. There are
# twenty-one of them. The first call that does not answer ends the check, so a
# server that stops answering costs one timeout, while a server answering just
# inside the timeout on every call costs twenty-one of them, which is the
# measurement it was asked for. The doctor's step passes -Quick and makes none
# of these calls.
#
# THE PASSWORD NEVER LEAVES THE ENVIRONMENT BLOCK. The config carries a SQL
# login's password, and it reaches sqlcmd through SQLCMDPASSWORD, which this
# script sets for the length of one spawn and restores afterwards. It is never
# a command-line argument (a command line is readable in the process list),
# never an output line, and never part of an error message.
#
# The checks connect to `master`, never to the configured database, because at
# first run that database does not exist yet. Whether it exists is itself
# reported, as INFO.
#
# Requires PowerShell 7: Invoke-WebRequest's -SkipHttpErrorCheck is how check 5
# reads the embedding server's refusal of an oversized input, which is a
# measured result here rather than an error.

#Requires -Version 7.0

# An unrecognised switch must be a hard error, not a silent extra argument: a
# param block with no [CmdletBinding()] binds one into $args and runs anyway,
# so -Quick misspelled would print a clean report having measured the latency
# it was told to skip.
[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $(if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }) ".claude\kit-memory-db.json"),
    [switch]$Quick
)

$script:failCount = 0

# The timeout the checks run under when the config names none, and the range a
# configured one is accepted in. The range matches kit-endpoint-lib.js's
# MIN_TIMEOUT_MS and MAX_TIMEOUT_MS, and so does the tolerance: a value outside
# it is ignored with a line saying so rather than treated as fatal, because a
# typo in one optional key is no reason to refuse to probe a working host.
$script:DefaultTimeoutMs = 10000
$script:MinTimeoutMs = 1000
$script:MaxTimeoutMs = 600000

# The embedding model's dimension. The database's VECTOR columns are declared
# at this width, so a server answering with another width is a failed check
# rather than a detail.
$script:ExpectedDimensions = 1024

# Check 5's sample count, one for each of the two texts.
$script:LatencySamples = 10

# The median above which the Chapter records the reading as an operator
# decision point on the model choice.
$script:LatencyDecisionMs = 2000

# Where the fleet installs the SQL client tools. Tried before PATH, because
# resolving by name alone hands the login's password to whatever sqlcmd sits
# earliest in the list, and a user-writable directory ahead of the real one is
# the ordinary way that becomes someone else's process.
$script:PinnedSqlcmdRelativePath = "Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE"

# A database name this script will interpolate into a batch. Conservative on
# purpose: the value is the operator's own, but it crosses into T-SQL text, and
# sections 3 and 4 copy this spawn shape for record bodies, which are lower
# trust than a config file.
$script:DatabaseNamePattern = '^[A-Za-z_][A-Za-z0-9_]{0,127}$'

# The run's shared deadline for checks 1 through 4, set once the config's
# timeout is known.
$script:Deadline = $null

# The least a boundary call can cost. Both tools take whole seconds and neither
# goes below one, so a sqlcmd spawn's two clocks cost two seconds together and
# one HTTP call costs one. These are how far a call started just before the
# deadline can overshoot it, never a bar on starting one: a check is attempted
# whenever any budget remains, since refusing a call the host would have
# answered in milliseconds fails a healthy server on arithmetic.
$script:SqlSpawnFloorMs = 2000
$script:EmbeddingCallFloorMs = 1000

function Get-RemainingMs {
    if ($null -eq $script:Deadline) { return 0 }
    $remaining = ($script:Deadline - (Get-Date)).TotalMilliseconds
    if ($remaining -le 0) { return 0 }
    return [int]$remaining
}

# Whole seconds for each of $Clocks clocks that run one after the other, out of
# $BudgetMs. Two rules, and they answer different halves of the problem.
#
# The share is divided down, never rounded: rounding to nearest is banker's
# rounding here, which rounds a half-second share up and hands the clocks more
# time than a budget that funds them holds.
#
# The share is then lifted where dividing down leaves less than the call's own
# floor, $FloorMs spread over the same clocks, which is the only place a call
# runs past the deadline. It is deliberate. The budget bounds how long the run
# waits on a host, and a check reached with a little time left is one a healthy
# host answers in milliseconds, so lifting costs a bounded overshoot while
# refusing would cost a false failure on a working server. The floor arrives as
# a total rather than as seconds so the caller passes the same constant the
# header quotes, and the per-clock value is arithmetic from it.
#
# Zero comes back only for a budget that is gone, which is the caller's signal
# that the deadline has passed and the check is not to be attempted at all.
function Get-ClockSeconds {
    param(
        [Parameter(Mandatory = $true)][int]$BudgetMs,
        [Parameter(Mandatory = $true)][int]$Clocks,
        [Parameter(Mandatory = $true)][int]$FloorMs
    )
    if ($BudgetMs -le 0) { return 0 }
    $floorSeconds = [math]::Floor($FloorMs / (1000.0 * $Clocks))
    return [int][math]::Max($floorSeconds, [math]::Floor($BudgetMs / (1000.0 * $Clocks)))
}

# The sanitizer every foreign string in a check line goes through: the doctor's
# own, dot-sourced from beside the doctor, since the doctor's Memory database
# step prints these lines on its channel and one channel takes one sanitizer.
# A check line spends 200; a value quoted inside one states its own narrower
# cap at the call.
. (Join-Path $PSScriptRoot "..\doctor\sanitize-line.ps1")

function Write-Check {
    param([string]$Status, [int]$Number, [string]$Name, [string]$Value)
    # Write-Host rather than Write-Output, the same choice doctor.ps1's Report
    # makes: a check line written to the success stream is captured by whatever
    # function is being assigned from, so the config reader's own FAIL line
    # would land in the caller's config variable instead of on the console.
    Write-Host ("{0}  {1}. {2}: {3}" -f $Status, $Number, $Name, $Value)
    if ($Status -eq "FAIL") { $script:failCount++ }
}

# ---------------------------------------------------------------------------
# The client config, read before anything reaches the network.
# ---------------------------------------------------------------------------

# Returns the config as a hashtable, or $null after printing why it could not
# be used. A half-configured machine must fail here rather than reach check 1
# and report PASS on the parts that happen to work.
function Read-ClientConfig {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Check "FAIL" 0 "Client config" ("no file at " + (Get-SanitizedLine $Path 200))
        return $null
    }
    $parsed = $null
    try {
        $parsed = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        Write-Check "FAIL" 0 "Client config" ((Get-SanitizedLine $Path 200) + " is not readable JSON; the parser's own message is withheld because it can quote the failing value.")
        return $null
    }
    if ($null -eq $parsed) {
        Write-Check "FAIL" 0 "Client config" ((Get-SanitizedLine $Path 200) + " holds no JSON object")
        return $null
    }

    $missing = @()
    foreach ($key in @("server", "database", "login", "password")) {
        $value = $parsed.$key
        if ($null -eq $value -or ([string]$value).Trim() -eq "") { $missing += $key }
    }
    $embeddingUrl = ""
    $embeddingModel = ""
    if ($null -eq $parsed.embedding) {
        $missing += "embedding.url"
        $missing += "embedding.model"
    }
    else {
        $embeddingUrl = ([string]$parsed.embedding.url).Trim().TrimEnd('/')
        $embeddingModel = ([string]$parsed.embedding.model).Trim()
        if ($embeddingUrl -eq "") { $missing += "embedding.url" }
        if ($embeddingModel -eq "") { $missing += "embedding.model" }
    }
    if ($missing.Count -gt 0) {
        Write-Check "FAIL" 0 "Client config" ((Get-SanitizedLine $Path 200) + " is missing " + ($missing -join ", "))
        return $null
    }
    # A url the checks append paths to must be an http or https address. This
    # is a type check rather than a security one: it catches a bare host name
    # here instead of as a confusing failure inside every embedding call.
    if ($embeddingUrl -notmatch '^https?://[^\s/]+') {
        Write-Check "FAIL" 0 "Client config" "embedding.url must be an http or https address"
        return $null
    }
    # A name that does not match is a name this script will not interpolate, so
    # the run goes ahead without the one reading that needs it. Two decisions
    # here, and they are separate. The read does not abort, because refusing the
    # whole config would take down the connection, the embedder and the
    # client-tools checks over a value only check 2 reads. And the line is a
    # FAIL, because the run was asked whether that database exists and will not
    # find out: a report that exits 0 having measured nothing is the failure
    # this probe exists to prevent.
    $database = ([string]$parsed.database).Trim()
    $databaseUsable = $database -match $script:DatabaseNamePattern
    if (-not $databaseUsable) {
        Write-Check "FAIL" 0 "Client config" ("database is not a plain identifier (letters, digits and underscores, not starting with a digit), so " +
            (Get-SanitizedLine $database 64) + " is never interpolated into a batch and check 2 cannot read whether it exists")
    }

    $timeoutMs = $script:DefaultTimeoutMs
    if ($null -ne $parsed.timeoutMs) {
        $configured = 0
        if ([int]::TryParse([string]$parsed.timeoutMs, [ref]$configured) -and
            $configured -ge $script:MinTimeoutMs -and $configured -le $script:MaxTimeoutMs) {
            $timeoutMs = $configured
        }
        else {
            Write-Check "INFO" 0 "Client config" ("timeoutMs ignored (" + (Get-SanitizedLine ([string]$parsed.timeoutMs) 40) +
                " is outside " + $script:MinTimeoutMs + " to " + $script:MaxTimeoutMs + "); using " + $script:DefaultTimeoutMs + " ms")
        }
    }

    return @{
        Server         = ([string]$parsed.server).Trim()
        Database       = $database
        DatabaseUsable = $databaseUsable
        Login          = ([string]$parsed.login).Trim()
        Password       = [string]$parsed.password
        EmbeddingUrl   = $embeddingUrl
        EmbeddingModel = $embeddingModel
        TimeoutMs      = $timeoutMs
    }
}

# ---------------------------------------------------------------------------
# The sqlcmd boundary.
# ---------------------------------------------------------------------------

# The sqlcmd this run spawns: the fleet's installed location first, then
# whatever PATH resolves. The resolved path is printed at check 6, so which one
# answered is never a guess.
function Resolve-Sqlcmd {
    if ($env:ProgramFiles) {
        $pinned = Join-Path $env:ProgramFiles $script:PinnedSqlcmdRelativePath
        if (Test-Path -LiteralPath $pinned) { return $pinned }
    }
    $found = Get-Command sqlcmd -ErrorAction SilentlyContinue
    if ($null -ne $found) { return [string]$found.Source }
    return ""
}

# One sqlcmd run over a batch, as @{ Code; Lines; Spawned }. Spawned is false
# where the tool was never started, which is what keeps this script's own -1
# from being reported as an exit code sqlcmd returned.
#
# Four things here are load-bearing. The password reaches the child through
# SQLCMDPASSWORD, saved and restored around the spawn so a value the caller's
# environment already held survives this script. The batch goes in a temp file
# rather than on the command line, which keeps a quoting bug from becoming a
# syntax error on the server, written with a byte-order mark so the tool reads
# it as UTF-8.
#
# WHAT -x DOES AND DOES NOT DO, stated exactly, because sections 3 and 4 copy
# this spawn for text that is lower trust than a config file. Per the tool's
# own banner, -x disables variable substitution and nothing else that banner
# names, so a $(VAR) reference in the batch stays literal while the :r and :!!
# directives, which read a file and run a shell command, are still live. The
# banner offers -X as "disable commands, startup script, environment variables"
# without naming which commands it means, and -X is unusable here whichever ones
# it covers: taking the environment variables away takes SQLCMDPASSWORD with
# them, which makes the login fail and the tool prompt for a password instead. What keeps a directive out of the batch is therefore the
# batch's authorship rather than a flag: every line is written by this script,
# and the one value interpolated into one is the database name, screened
# against a plain-identifier pattern at the config read. A caller that puts
# text it did not author into a batch needs its own answer to this and cannot
# inherit one from here.
#
# And the run is captured whole before anything filters it: piping a native
# command through a filter that closes the pipeline early makes PowerShell
# report exit -1 on a healthy run, so $LASTEXITCODE is read off the assignment
# and the lines are picked over afterwards.
function Invoke-SqlBatch {
    param(
        [Parameter(Mandatory = $true)][string]$SqlcmdPath,
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [Parameter(Mandatory = $true)][string]$Batch,
        [Parameter(Mandatory = $true)][int]$BudgetMs
    )
    # The budget is split across the two clocks sqlcmd keeps, because they run
    # one after the other: -l bounds the login and -t bounds the query, so
    # giving each the whole remainder lets one spawn cost twice what it was
    # given. The live screen on a passed deadline is the caller's, which is what
    # turns it into a named check line; the refusal below is a belt that no
    # caller currently reaches, kept so this function is safe to call from one
    # that forgets.
    $seconds = Get-ClockSeconds -BudgetMs $BudgetMs -Clocks 2 -FloorMs $script:SqlSpawnFloorMs
    if ($seconds -lt 1) {
        return @{ Code = -1; Spawned = $false
            Lines = @("the run's budget was spent before this spawn, so none was made")
        }
    }
    $batchFile = Join-Path ([System.IO.Path]::GetTempPath()) ("kit-memory-db-probe-" + [guid]::NewGuid().ToString("n") + ".sql")
    $savedPassword = [Environment]::GetEnvironmentVariable("SQLCMDPASSWORD", "Process")
    try {
        Set-Content -LiteralPath $batchFile -Value $Batch -Encoding utf8BOM -ErrorAction Stop
        $env:SQLCMDPASSWORD = $Config.Password
        # -N encrypts and -C is deliberately absent, so the connection succeeds
        # only where this machine trusts the host's certificate. -b makes a
        # SQL error a non-zero exit, -I quotes identifiers, -h -1 and -W strip
        # the headers and the padding so each answer is one bare line, and -x
        # leaves a $(VAR) reference in the batch literal.
        $output = & $SqlcmdPath -S $Config.Server -d master -U $Config.Login -N -b -I -h -1 -W -x `
            -l $seconds -t $seconds -i $batchFile 2>&1
        $code = $LASTEXITCODE
        $lines = @($output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne "" })
        return @{ Code = $code; Lines = $lines; Spawned = $true }
    }
    catch {
        return @{ Code = -1; Spawned = $false; Lines = @("could not run sqlcmd: " + $_.Exception.Message) }
    }
    finally {
        if ($null -eq $savedPassword) { Remove-Item "Env:\SQLCMDPASSWORD" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:\SQLCMDPASSWORD" $savedPassword }
        Remove-Item -LiteralPath $batchFile -Force -ErrorAction SilentlyContinue
    }
}

# The value a tagged SELECT returned, or $null when the batch printed no such
# line. Every answer carries its own tag and is found by that tag rather than
# by its position, because the captured stream merges stdout and stderr and any
# server notice ahead of a result set shifts every index by one.
function Get-TaggedValue {
    param([string[]]$Lines, [string]$Tag)
    foreach ($line in $Lines) {
        if ($line.StartsWith($Tag)) { return $line.Substring($Tag.Length) }
    }
    return $null
}

# What a failed batch says in a check's value: sqlcmd's own words, joined and
# bounded, behind the exit code it returned. It carries no password, which never
# reaches sqlcmd's output, and it is the one thing that tells a certificate
# refusal from a closed port. Where the tool was never started the exit code is
# this script's own, so it is left off rather than printed as a reading from a
# process that never ran.
function Get-BatchFailureText {
    param([hashtable]$Result)
    $text = ($Result.Lines -join " ")
    if ($text -eq "") { $text = "no output" }
    if (-not $Result.Spawned) { return (Get-SanitizedLine $text 200) }
    return "sqlcmd exit " + $Result.Code + ": " + (Get-SanitizedLine $text 200)
}

# ---------------------------------------------------------------------------
# The embedding boundary.
# ---------------------------------------------------------------------------

# One HTTP call to the embedding server, as
# @{ Ok; Status; Body; Server; Ms; Seconds }. Seconds is the clock the call was
# actually given, which a failure line prints: it is the share cut from what was
# left of the budget, so a reader tells a call that waited out its own clock
# from one handed the whole configured timeout.
#
# Ok means the call completed and the server answered, whatever it answered:
# a non-2xx status is a result here (check 5 depends on one) rather than an
# error, which is what -SkipHttpErrorCheck buys. Only a transport failure, a
# refused connection or a timeout, comes back with Ok false.
#
# Redirects are never followed. Nothing sensitive crosses this link in this
# script, but section 3 sends record bodies over it, and a followed redirect is
# how that content would leave the host the config named.
function Invoke-EmbeddingRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][int]$TimeoutMs,
        [string]$Body
    )
    # Whole seconds again, divided down and lifted to this call's own floor, for
    # the same reasons the sqlcmd spawn's two clocks are. The refusal below is
    # the same belt the spawn keeps: the live screen on a passed deadline is the
    # caller's.
    $seconds = Get-ClockSeconds -BudgetMs $TimeoutMs -Clocks 1 -FloorMs $script:EmbeddingCallFloorMs
    if ($seconds -lt 1) {
        return @{ Ok = $false; Status = 0; Body = ""; Server = ""; Ms = 0; Seconds = 0
            Detail = "the run's budget was spent before this call, so none was made"
        }
    }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        # Emptiness rather than $null decides the method: $Body is typed
        # [string], and PowerShell binds an omitted or $null value to the empty
        # string, so a $null test would send every call as a POST.
        if ([string]::IsNullOrEmpty($Body)) {
            $response = Invoke-WebRequest -Uri $Uri -Method Get -TimeoutSec $seconds `
                -MaximumRedirection 0 -SkipHttpErrorCheck -ErrorAction Stop
        }
        else {
            $response = Invoke-WebRequest -Uri $Uri -Method Post -ContentType "application/json" -Body $Body `
                -TimeoutSec $seconds -MaximumRedirection 0 -SkipHttpErrorCheck -ErrorAction Stop
        }
        $watch.Stop()
        $serverHeader = ""
        if ($response.Headers.ContainsKey("Server")) { $serverHeader = ($response.Headers["Server"] -join ",") }
        # A response whose content type is not text arrives as a byte array,
        # and casting one to string prints its type name rather than its
        # content, so it is decoded here instead.
        $content = $response.Content
        $text = if ($content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($content) } else { [string]$content }
        return @{
            Ok      = $true
            Status  = [int]$response.StatusCode
            Body    = $text
            Server  = $serverHeader
            Ms      = $watch.Elapsed.TotalMilliseconds
            Seconds = $seconds
        }
    }
    catch {
        $watch.Stop()
        return @{ Ok = $false; Status = 0; Body = ""; Server = ""; Seconds = $seconds
            Ms = $watch.Elapsed.TotalMilliseconds; Detail = $_.Exception.Message
        }
    }
}

# English prose of at least the requested length, built from one sentence
# repeated. Generated rather than shipped as a fixture: the two sizes check 5
# needs are a chunk at the publisher's upper bound and a text unambiguously
# past the server's per-input ceiling, and both are a length rather than a
# content.
function New-ProseText {
    param([Parameter(Mandatory = $true)][int]$MinimumChars)
    $sentence = "The memory store keeps one record for each lesson the fleet has learned, and the publisher walks those records in tier order before it embeds them. "
    $builder = [System.Text.StringBuilder]::new()
    while ($builder.Length -lt $MinimumChars) { [void]$builder.Append($sentence) }
    return $builder.ToString()
}

function Get-MedianMs {
    param([double[]]$Values)
    $sorted = @($Values | Sort-Object)
    $count = $sorted.Count
    if ($count -eq 0) { return 0 }
    if ($count % 2 -eq 1) { return $sorted[[int](($count - 1) / 2)] }
    return (($sorted[$count / 2 - 1] + $sorted[$count / 2]) / 2.0)
}

# The measured milliseconds of one embedding call, or $null when the call did
# not produce a usable vector. The caller reports the failure; this returns the
# number or nothing.
function Measure-EmbeddingCall {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Config,
        [Parameter(Mandatory = $true)][string]$Text
    )
    $payload = @{ model = $Config.EmbeddingModel; input = $Text } | ConvertTo-Json -Compress
    $call = Invoke-EmbeddingRequest -Uri ($Config.EmbeddingUrl + "/v1/embeddings") -TimeoutMs $Config.TimeoutMs -Body $payload
    if (-not $call.Ok -or $call.Status -lt 200 -or $call.Status -ge 300) { return $null }
    try {
        $body = $call.Body | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $body.data -or @($body.data).Count -lt 1) { return $null }
    }
    catch { return $null }
    return $call.Ms
}

# Whether a refusal body is the server saying the input is past its per-input
# ceiling, rather than the server having failed on the input.
#
# This distinction is the whole point of check 5's last call: the publisher's
# chunk contract rests on an oversized input being REFUSED, and a crash behind
# the same non-2xx status is not that. The wording matched is the embedding
# server's own ("input (N tokens) is too large to process. increase the
# physical batch size (current batch size: 2048)"), so a server that refuses in
# other words reports FAIL with its body quoted, which is a legible prompt to
# widen this rather than a silent pass.
function Test-CeilingRefusal {
    param([string]$Message)
    return ($Message -match '(?i)too large') -and ($Message -match '(?i)batch size')
}

# ---------------------------------------------------------------------------
# The run.
# ---------------------------------------------------------------------------

$config = Read-ClientConfig -Path $ConfigPath
if ($null -eq $config) { exit 1 }

# One budget from here, spent by checks 1 through 4 between them.
$script:Deadline = (Get-Date).AddMilliseconds($config.TimeoutMs)

# Resolved here rather than at check 6, because checks 1 through 3 spawn it.
# Check 6 still reports on it in its own place, which is where the spec puts
# the reading sections 3 and 4 depend on.
$sqlcmdPath = Resolve-Sqlcmd

# --- 1. The encrypted connection.
# The proof is the driver's own refusal behaviour under the probe's flags. Every
# spawn carries -N and never -C, and under those flags the ODBC driver refuses an
# unencrypted link and an untrusted certificate chain outright rather than
# downgrading, so a batch that answered at all ran over an encrypted link whose
# certificate this machine trusts. The batch reads two values any login can
# read about its own session, so the line carries a measurement rather than a
# bare "connected". No server-side value would do better: CONNECTIONPROPERTY
# reports no encrypt_option for any login, sysadmin included, and the
# sys.dm_exec_connections column is closed to an execute-only login and reads
# TRUE on an unvalidated link besides, which is the half the client proves.
# 'ok', 'failed' or 'starved', which the checks below read. Both of the last
# two are failures and both exit the run non-zero; they differ only in what the
# line says, since a connection that was attempted and refused and a connection
# the budget never funded are different things to the operator reading them.
$connectionState = "failed"
$budget = Get-RemainingMs
if ($sqlcmdPath -eq "") {
    Write-Check "FAIL" 1 "Connection" "sqlcmd resolved neither at the installed client path nor on PATH, so no connection was attempted"
}
elseif ($budget -le 0) {
    $connectionState = "starved"
    Write-Check "FAIL" 1 "Connection" ("not attempted and so not measured: the run's " +
        $config.TimeoutMs + " ms budget was spent before this check")
}
else {
    $batch = @"
;SET NOCOUNT ON
;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED
;SELECT  CONCAT('kitprobe-connected=', SUSER_SNAME(), '|', CONVERT(VARCHAR(20), CONNECTIONPROPERTY('net_transport')))
"@
    $result = Invoke-SqlBatch -SqlcmdPath $sqlcmdPath -Config $config -Batch $batch -BudgetMs $budget
    $connected = Get-TaggedValue -Lines $result.Lines -Tag "kitprobe-connected="
    if ($result.Code -ne 0 -or $null -eq $connected) {
        Write-Check "FAIL" 1 "Connection" (Get-BatchFailureText $result)
    }
    else {
        $connectionState = "ok"
        $parts = $connected.Split("|", 2)
        $login = Get-SanitizedLine $parts[0] 40
        $transport = if ($parts.Length -gt 1) { Get-SanitizedLine $parts[1] 20 } else { "unknown transport" }
        Write-Check "PASS" 1 "Connection" ("encrypted and certificate-validated by the client (-N, no -C), as " + $login + " over " + $transport)
    }
}

# --- 2. The server's version, its full-text feature, and whether the database
# --- is there yet. The database's absence is the ordinary state before the
# --- installer has run, so it is INFO on its own line and never a FAIL.
$budget = Get-RemainingMs
if ($connectionState -eq "starved") {
    Write-Check "FAIL" 2 "Server" ("not read: the run's " + $config.TimeoutMs + " ms budget was spent before check 1 connected")
}
elseif ($connectionState -ne "ok") {
    Write-Check "FAIL" 2 "Server" "not read: the connection in check 1 did not succeed"
}
elseif ($budget -le 0) {
    Write-Check "FAIL" 2 "Server" ("not read: the run's " + $config.TimeoutMs + " ms budget was spent before this check")
}
else {
    # The database name is interpolated only when it passed the identifier
    # screen at the config read. When it did not, the query it feeds is left
    # out of the batch entirely rather than escaped into it.
    $databaseQuery = ""
    if ($config.DatabaseUsable) {
        $databaseQuery = ";SELECT CONCAT('kitprobe-database=', CASE WHEN DB_ID(N'$($config.Database)') IS NULL THEN 'absent' ELSE 'present' END)"
    }
    $batch = @"
;SET NOCOUNT ON
;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED
;SELECT CONCAT('kitprobe-version=', CONVERT(VARCHAR(64), SERVERPROPERTY('ProductVersion')))
;SELECT CONCAT('kitprobe-fulltext=', CONVERT(VARCHAR(8), FULLTEXTSERVICEPROPERTY('IsFullTextInstalled')))
$databaseQuery
"@
    $result = Invoke-SqlBatch -SqlcmdPath $sqlcmdPath -Config $config -Batch $batch -BudgetMs $budget
    $version = Get-TaggedValue -Lines $result.Lines -Tag "kitprobe-version="
    $fullText = Get-TaggedValue -Lines $result.Lines -Tag "kitprobe-fulltext="
    $databaseState = Get-TaggedValue -Lines $result.Lines -Tag "kitprobe-database="
    if ($result.Code -ne 0 -or $null -eq $version -or $null -eq $fullText -or
        ($config.DatabaseUsable -and $null -eq $databaseState)) {
        Write-Check "FAIL" 2 "Server" (Get-BatchFailureText $result)
    }
    else {
        $version = Get-SanitizedLine $version 40
        $fullText = Get-SanitizedLine $fullText 8
        $value = "ProductVersion " + $version + ", IsFullTextInstalled " + $fullText
        if ($version -notmatch '^17\.' -or $fullText -ne "1") {
            Write-Check "FAIL" 2 "Server" ($value + ", expected a 17.x version with IsFullTextInstalled 1")
        }
        else {
            Write-Check "PASS" 2 "Server" $value
        }
        if ($config.DatabaseUsable) {
            Write-Check "INFO" 2 "Database" ((Get-SanitizedLine $config.Database 64) + " is " + (Get-SanitizedLine $databaseState 16) + " on the server")
        }
        else {
            # A failure rather than a note: this reading was asked for and no
            # value was taken, so the run must not exit 0 on the strength of the
            # two readings beside it.
            Write-Check "FAIL" 2 "Database" ((Get-SanitizedLine $config.Database 64) +
                " was not looked up, since it is not a plain identifier and is never interpolated into a batch")
        }
    }
}

# --- 3. The VECTOR type and its distance function.
#
# The probe vector is built before the deadline is read, and only on the path
# that will spawn. A thousand elements of local work between the reading and the
# spawn would hand the spawn clocks cut from a budget that no longer holds them,
# which is the overrun this one deadline exists to rule out.
$vectorJson = ""
if ($connectionState -eq "ok") {
    # A ramp rather than a constant vector: cosine distance is undefined for a
    # zero vector, and a vector of one repeated value would pass a comparison
    # that ignored its elements.
    $components = 1..$script:ExpectedDimensions | ForEach-Object {
        [math]::Round($_ / [double]$script:ExpectedDimensions, 6).ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }
    $vectorJson = "[" + ($components -join ",") + "]"
}
$budget = Get-RemainingMs
if ($connectionState -eq "starved") {
    Write-Check "FAIL" 3 "Vector" ("not read: the run's " + $config.TimeoutMs + " ms budget was spent before check 1 connected")
}
elseif ($connectionState -ne "ok") {
    Write-Check "FAIL" 3 "Vector" "not read: the connection in check 1 did not succeed"
}
elseif ($budget -le 0) {
    Write-Check "FAIL" 3 "Vector" ("not read: the run's " + $config.TimeoutMs + " ms budget was spent before this check")
}
else {
    $batch = @"
;SET NOCOUNT ON
;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED
;DECLARE @ProbeVector VECTOR($($script:ExpectedDimensions)) = CAST(N'$vectorJson' AS VECTOR($($script:ExpectedDimensions)))
;SELECT CONCAT('kitprobe-distance=', CONVERT(VARCHAR(40), VECTOR_DISTANCE('cosine', @ProbeVector, @ProbeVector)))
"@
    $result = Invoke-SqlBatch -SqlcmdPath $sqlcmdPath -Config $config -Batch $batch -BudgetMs $budget
    $distanceText = Get-TaggedValue -Lines $result.Lines -Tag "kitprobe-distance="
    $distance = 0.0
    # Parsed against the invariant culture rather than this machine's: the
    # server writes a decimal point, and a comma-decimal locale would either
    # refuse a healthy answer or read 1.19E-07 as something else entirely.
    $parsed = $false
    if ($null -ne $distanceText) {
        $parsed = [double]::TryParse($distanceText, [System.Globalization.NumberStyles]::Float,
            [System.Globalization.CultureInfo]::InvariantCulture, [ref]$distance)
    }
    if ($result.Code -ne 0 -or $null -eq $distanceText) {
        Write-Check "FAIL" 3 "Vector" (Get-BatchFailureText $result)
    }
    elseif (-not $parsed) {
        Write-Check "FAIL" 3 "Vector" ("VECTOR_DISTANCE returned " + (Get-SanitizedLine $distanceText 40) + ", which is not a number")
    }
    elseif ([math]::Abs($distance) -gt 0.000001) {
        Write-Check "FAIL" 3 "Vector" ("cosine distance of identical VECTOR(" + $script:ExpectedDimensions + ") vectors is " + $distance + ", expected near zero")
    }
    else {
        Write-Check "PASS" 3 "Vector" ("VECTOR_DISTANCE cosine on identical VECTOR(" + $script:ExpectedDimensions + ") vectors = " + $distance)
    }
}

# --- 4. The embedding server's identity and vector width.
$embedderState = "failed"
$budget = Get-RemainingMs
if ($budget -le 0) {
    $embedderState = "starved"
    Write-Check "FAIL" 4 "Embedder" ("not read: the run's " + $config.TimeoutMs +
        " ms budget was spent before this check, by the checks above")
}
else {
    $models = Invoke-EmbeddingRequest -Uri ($config.EmbeddingUrl + "/v1/models") -TimeoutMs $budget
    if (-not $models.Ok) {
        Write-Check "FAIL" 4 "Embedder" ("GET /v1/models did not answer within its " + $models.Seconds +
            " second clock: " + (Get-SanitizedLine $models.Detail 200))
    }
    elseif ($models.Status -lt 200 -or $models.Status -ge 300) {
        Write-Check "FAIL" 4 "Embedder" ("GET /v1/models answered HTTP " + $models.Status)
    }
    else {
        $ids = @()
        try {
            $listed = $models.Body | ConvertFrom-Json -ErrorAction Stop
            $ids = @($listed.data | ForEach-Object { [string]$_.id })
        }
        catch { $ids = @() }
        $budget = Get-RemainingMs
        if ($ids -notcontains $config.EmbeddingModel) {
            Write-Check "FAIL" 4 "Embedder" ("GET /v1/models does not list " + (Get-SanitizedLine $config.EmbeddingModel 64) +
                "; it lists " + (Get-SanitizedLine (($ids -join ", ")) 200))
        }
        elseif ($budget -le 0) {
            $embedderState = "starved"
            Write-Check "FAIL" 4 "Embedder" ("not read: the run's " + $config.TimeoutMs +
                " ms budget was spent before this check, after listing the models")
        }
        else {
            $payload = @{ model = $config.EmbeddingModel; input = "a short probe of the embedding server" } | ConvertTo-Json -Compress
            $embed = Invoke-EmbeddingRequest -Uri ($config.EmbeddingUrl + "/v1/embeddings") -TimeoutMs $budget -Body $payload
            $dimensions = -1
            if ($embed.Ok -and $embed.Status -ge 200 -and $embed.Status -lt 300) {
                try {
                    $body = $embed.Body | ConvertFrom-Json -ErrorAction Stop
                    if (@($body.data).Count -eq 1) { $dimensions = @($body.data[0].embedding).Count }
                }
                catch { $dimensions = -1 }
            }
            $serverHeader = if ($embed.Server -ne "") { (Get-SanitizedLine $embed.Server 64) } else { "none sent" }
            if (-not $embed.Ok) {
                Write-Check "FAIL" 4 "Embedder" ("POST /v1/embeddings did not answer within its " + $embed.Seconds +
                    " second clock: " + (Get-SanitizedLine $embed.Detail 200))
            }
            elseif ($dimensions -ne $script:ExpectedDimensions) {
                Write-Check "FAIL" 4 "Embedder" ("POST /v1/embeddings answered HTTP " + $embed.Status + " with " + $dimensions +
                    " floats, expected one vector of " + $script:ExpectedDimensions)
            }
            else {
                $embedderState = "ok"
                Write-Check "PASS" 4 "Embedder" ("model " + (Get-SanitizedLine $config.EmbeddingModel 64) + " listed, one vector of " +
                    $dimensions + " floats, Server header " + $serverHeader)
            }
        }
    }
}

# --- 5. Latency at the chunk target, at query length, and the server's refusal
# --- of an input past its per-input ceiling. The refusal is what makes the
# --- publisher's chunk contract self-enforcing, so it is measured rather than
# --- assumed, and a non-2xx that is not that refusal is a failure rather than
# --- a pass.
if ($Quick) {
    Write-Check "INFO" 5 "Latency" "skipped under -Quick"
}
elseif ($embedderState -eq "starved") {
    Write-Check "FAIL" 5 "Latency" ("not measured: the run's " + $config.TimeoutMs + " ms budget was spent before check 4 read the server")
}
elseif ($embedderState -ne "ok") {
    Write-Check "FAIL" 5 "Latency" "not measured: the embedding server did not pass check 4"
}
else {
    $longText = New-ProseText -MinimumChars 4000
    $queryText = "which record explains why the publisher chunks a long memory record into parts before it embeds the text at all"
    $longMs = @()
    $queryMs = @()
    $failedAt = ""
    foreach ($i in 1..$script:LatencySamples) {
        $ms = Measure-EmbeddingCall -Config $config -Text $longText
        if ($null -eq $ms) { $failedAt = "the long text on call " + $i; break }
        $longMs += $ms
    }
    if ($failedAt -eq "") {
        foreach ($i in 1..$script:LatencySamples) {
            $ms = Measure-EmbeddingCall -Config $config -Text $queryText
            if ($null -eq $ms) { $failedAt = "the query text on call " + $i; break }
            $queryMs += $ms
        }
    }

    if ($failedAt -ne "") {
        Write-Check "FAIL" 5 "Latency" ("an embedding call failed at " + $failedAt)
    }
    else {
        $oversizeText = New-ProseText -MinimumChars 16000
        $payload = @{ model = $config.EmbeddingModel; input = $oversizeText } | ConvertTo-Json -Compress
        $refusal = Invoke-EmbeddingRequest -Uri ($config.EmbeddingUrl + "/v1/embeddings") -TimeoutMs $config.TimeoutMs -Body $payload
        $refusalMessage = ""
        if ($refusal.Ok) {
            try {
                $refusalBody = $refusal.Body | ConvertFrom-Json -ErrorAction Stop
                $refusalMessage = [string]$refusalBody.error.message
            }
            catch { $refusalMessage = "" }
            if ($refusalMessage -eq "") { $refusalMessage = $refusal.Body }
        }

        $longMedian = [math]::Round((Get-MedianMs $longMs))
        $longMax = [math]::Round((@($longMs | Measure-Object -Maximum).Maximum))
        $queryMedian = [math]::Round((Get-MedianMs $queryMs))
        $queryMax = [math]::Round((@($queryMs | Measure-Object -Maximum).Maximum))
        # A median past the decision point is named in the line rather than
        # failed: whether to keep this model at that cost is the operator's
        # call, and a FAIL here would say the host is broken when it is slow.
        $decisionNote = if ($longMedian -gt $script:LatencyDecisionMs) { " (above the " + $script:LatencyDecisionMs + " ms decision point)" } else { "" }
        $measured = ($longText.Length.ToString() + " chars: median " + $longMedian + " ms" + $decisionNote + ", max " + $longMax + " ms; " +
            "query " + $queryText.Length + " chars: median " + $queryMedian + " ms, max " + $queryMax + " ms; " +
            "oversize " + $oversizeText.Length + " chars ")

        if (-not $refusal.Ok) {
            Write-Check "FAIL" 5 "Latency" ($measured + "got no answer at all: " + (Get-SanitizedLine $refusal.Detail 200))
        }
        elseif ($refusal.Status -ge 200 -and $refusal.Status -lt 300) {
            Write-Check "FAIL" 5 "Latency" ($measured + "was accepted with HTTP " + $refusal.Status +
                ", so the server truncates rather than refusing an oversized input")
        }
        elseif (-not (Test-CeilingRefusal $refusalMessage)) {
            Write-Check "FAIL" 5 "Latency" ($measured + "drew HTTP " + $refusal.Status +
                " whose body does not name a size ceiling, so the server errored rather than refusing: " +
                (Get-SanitizedLine $refusalMessage 160))
        }
        else {
            Write-Check "PASS" 5 "Latency" ($measured + "refused with HTTP " + $refusal.Status + ": " + (Get-SanitizedLine $refusalMessage 160))
        }
    }
}

# --- 6. The local sqlcmd, which sections 3 and 4 spawn.
if ($sqlcmdPath -eq "") {
    Write-Check "FAIL" 6 "sqlcmd" "resolved neither at the installed client path nor on PATH"
}
else {
    # Captured whole and read afterwards: a filter in the live pipeline would
    # close it early and turn a healthy run into exit -1. Two invocations
    # because two tools answer to this name: the ODBC client prints its version
    # in the -? banner, while the Go sqlcmd prints a usage block there and puts
    # its version behind --version.
    $version = ""
    foreach ($versionArg in @("-?", "--version")) {
        $banner = @()
        try { $banner = @(& $sqlcmdPath $versionArg 2>&1 | ForEach-Object { [string]$_ }) } catch { $banner = @() }
        foreach ($line in $banner) {
            if ($line -match 'Version\s+([0-9][0-9.]*)' -or $line -match '^\s*([0-9]+\.[0-9][0-9.]*)\s*$') {
                $version = $matches[1]
                break
            }
        }
        if ($version -ne "") { break }
    }
    if ($version -eq "") {
        Write-Check "FAIL" 6 "sqlcmd" ((Get-SanitizedLine $sqlcmdPath 200) + " reported no version")
    }
    else {
        Write-Check "PASS" 6 "sqlcmd" ((Get-SanitizedLine $sqlcmdPath 200) + ", version " + (Get-SanitizedLine $version 40))
    }
}

if ($script:failCount -gt 0) { exit 1 }
exit 0
