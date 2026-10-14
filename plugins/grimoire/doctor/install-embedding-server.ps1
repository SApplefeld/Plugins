# The doctor's embedding-server helpers: what state a loopback embedding
# server is in, how llama.cpp's CPU server and the pinned bge-m3 Q8 model are
# installed under the home directory, the scheduled task that starts the
# server at boot, and the write of the client config's embedding block.
#
# Dot-sourced by doctor.ps1, which calls these under its "Embedding server"
# step; the repo test suite dot-sources the same file and runs the same
# functions against a fixture home, which is why the install root, the config
# path and the task name all arrive as parameters instead of being resolved
# from the environment here. Three more parameters are seams whose default is
# the real thing: -Pins (the two downloads and their SHA-256 digests), and
# -TaskReader and -TaskWriter (script blocks wrapping the ScheduledTasks
# cmdlets), so a test hands its own files and its own task readings and
# registers no task on the machine. This file defines functions and constants
# only; dot-sourcing it runs nothing and writes nothing.
#
# Every string this file did not author (an HTTP body or header, an exception
# message off the wire, a config value, a task property, a log line) passes
# through Get-SanitizedLine from sanitize-line.ps1 before it lands in a note
# the doctor prints, so the caller dot-sources that file first.
#
# The state function and everything the doctor runs without -Fix open no
# connection except to the configured URL, and only where its host is in the
# loopback set below. The pins are read by -Fix alone, and the two downloads
# are the one fetch from a public host this step makes.

# The server's port, the model identity it lists, the vector width the client
# expects, how long a cold start may take before /health answers 200, and the
# size past which the launcher empties server.log before it starts.
$script:EmbeddingServerPort = 11435
$script:EmbeddingServerModelId = "BAAI/bge-m3-Q8_0"
$script:EmbeddingServerDimensions = 1024
$script:EmbeddingServerColdStartSeconds = 120
$script:EmbeddingServerLogCapBytes = 10485760

# The client config's timeoutMs rule, memory-database.js's DEFAULT_TIMEOUT_MS,
# MIN_TIMEOUT_MS and MAX_TIMEOUT_MS: outside the range the default stands.
$script:EmbeddingServerDefaultTimeoutMs = 10000
$script:EmbeddingServerMinTimeoutMs = 1000
$script:EmbeddingServerMaxTimeoutMs = 600000

# The most bytes one answer from the loopback server is read to. An embedding
# answer of 1024 floats is about 20 KB, so this bounds a hostile or broken
# server's answer without cutting a real one.
$script:EmbeddingServerAnswerCapBytes = 4194304

# Loopback is this closed set of host strings, compared literally with no name
# resolution. Any other host, 127.0.0.2 and myhost.local among them, is remote.
$script:EmbeddingServerLoopbackHosts = @("127.0.0.1", "localhost", "::1", "[::1]")

# The loopback port the kit's server listens on, the one place the doctor
# reads it from. Its url is http://127.0.0.1: and this port.
function Get-EmbeddingServerPort {
    return $script:EmbeddingServerPort
}

# The two downloads. A later release moves the tag, the size and the digest
# together, as this one block.
function Get-EmbeddingServerPins {
    return @(
        @{
            Name   = "llama-b11457-bin-win-cpu-x64.zip"
            Kind   = "zip"
            Url    = "https://github.com/ggml-org/llama.cpp/releases/download/b11457/llama-b11457-bin-win-cpu-x64.zip"
            Bytes  = 19436652
            Sha256 = "ed20ed40e10c04d0853d8acf8700f0e6c1bb8212f0cc70c3a0da13dcbbc1b802"
        },
        @{
            Name   = "bge-m3-Q8_0.gguf"
            Kind   = "model"
            Url    = "https://huggingface.co/gpustack/bge-m3-GGUF/resolve/main/bge-m3-Q8_0.gguf"
            Bytes  = 634553760
            Sha256 = "950f4a8e5e19477a6d3c26d2f162233c20002c601f75e4b002e3239997821167"
        }
    )
}

# The -Fix consent question, naming each download with its size and host and
# the total, in decimal megabytes. -ConfigRewrite, where given, names the
# config rewrite that a second prompt, one only a person answers, asks for.
function Get-EmbeddingServerConsentQuestion {
    param(
        [Parameter(Mandatory = $true)][object[]]$Pins,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$TaskName,
        [string]$ConfigRewrite = ""
    )
    $rewrite = ""
    if ($ConfigRewrite -ne "") { $rewrite = ", and, behind a second prompt only a person answers, $ConfigRewrite" }
    $parts = @()
    $total = [long]0
    foreach ($pin in $Pins) {
        $total += [long]$pin.Bytes
        $hostName = ""
        try { $hostName = " from " + ([System.Uri][string]$pin.Url).Host } catch { $hostName = "" }
        $parts += ([string]$pin.Name + " (" + [math]::Round([long]$pin.Bytes / 1000000) + " MB" + $hostName + ")")
    }
    return ("Install the kit's embedding server into ${InstallRoot}: download " + ($parts -join " and ") + ", " +
        [math]::Round($total / 1000000) + " MB together, each checked against its pinned SHA-256 and fetched only where missing or different, " +
        "then register and start the scheduled task ${TaskName}${rewrite}?")
}

# The host of an http or https URL, read literally: userinfo dropped, a
# bracketed IPv6 host kept with its brackets, the port dropped. $null for
# anything that is not an http or https URL.
function Get-EmbeddingUrlHost {
    param([string]$Url)
    if ([string]::IsNullOrEmpty($Url)) { return $null }
    if ($Url -notmatch '^(?i)https?://(?<authority>[^/?#]*)') { return $null }
    $authority = $Matches.authority
    $at = $authority.LastIndexOf('@')
    if ($at -ge 0) { $authority = $authority.Substring($at + 1) }
    if ($authority.StartsWith("[")) {
        $close = $authority.IndexOf("]")
        if ($close -lt 0) { return $null }
        return $authority.Substring(0, $close + 1)
    }
    if ($authority -eq "::1") { return "::1" }
    if ($authority -match '^(?<host>[^:]*)(?::\d*)?$') { return $Matches.host }
    return $null
}

function Test-EmbeddingUrlIsLoopback {
    param([string]$Url)
    $hostName = Get-EmbeddingUrlHost -Url $Url
    if ($null -eq $hostName) { return $false }
    foreach ($loopback in $script:EmbeddingServerLoopbackHosts) {
        if ([string]::Equals($hostName, $loopback, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

# The config's text, decoded as UTF-8 explicitly: Windows PowerShell 5.1's
# Get-Content decodes with the ANSI codepage, which would mangle any non-ASCII
# value on its way through a rewrite. HasBom says whether the file opened with
# a UTF-8 byte order mark, so a rewrite keeps it.
function Read-EmbeddingServerConfigText {
    param([Parameter(Mandatory = $true)][string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $offset = 0
    if ($hasBom) { $offset = 3 }
    $text = (New-Object System.Text.UTF8Encoding($false)).GetString($bytes, $offset, $bytes.Length - $offset)
    return @{ Bytes = $bytes; Text = $text; HasBom = $hasBom }
}

# A config value as a number, for the client's timeoutMs rule. It accepts a
# number as itself, a string holding one decimal number (sign, fraction,
# exponent and surrounding blanks allowed) as that number, a blank string as
# 0, and true and false as 1 and 0. Anything else, an infinity among them,
# reads as $null.
function ConvertTo-EmbeddingServerNumber {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [bool]) { if ($Value) { return 1.0 } else { return 0.0 } }
    $number = 0.0
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) { $number = [double]$Value }
    elseif ($Value -is [string]) {
        $trimmed = $Value.Trim()
        if ($trimmed -eq "") { return 0.0 }
        if (-not [double]::TryParse($trimmed, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) { return $null }
    }
    else { return $null }
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $null }
    return $number
}

# What the client config says about embeddings: whether the file exists,
# whether it parses, the url and model of its embedding block, and the
# timeout one check may spend, under the client's own rule
# (memory-database.js): any finite number in range, floored. A parse failure
# is named by a fixed phrase, never by the parser's message, which can quote
# a token of the file such as a password.
function Read-EmbeddingServerConfig {
    param([Parameter(Mandatory = $true)][string]$ConfigPath)
    $result = @{
        Exists    = $false
        Error     = $null
        Url       = ""
        Model     = ""
        HasUrl    = $false
        TimeoutMs = $script:EmbeddingServerDefaultTimeoutMs
    }
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { return $result }
    $result.Exists = $true
    $parsed = $null
    try {
        $parsed = (Read-EmbeddingServerConfigText -Path $ConfigPath).Text | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        $result.Error = "the file does not parse as JSON"
        return $result
    }
    if ($parsed -isnot [System.Management.Automation.PSCustomObject]) {
        $result.Error = "the file does not hold a JSON object"
        return $result
    }
    $block = $parsed.embedding
    if ($block -is [System.Management.Automation.PSCustomObject]) {
        $result.Url = ([string]$block.url).Trim().TrimEnd('/')
        $result.Model = ([string]$block.model).Trim()
    }
    $result.HasUrl = ($result.Url -ne "")
    $configured = ConvertTo-EmbeddingServerNumber -Value $parsed.timeoutMs
    if ($null -ne $configured -and
        $configured -ge $script:EmbeddingServerMinTimeoutMs -and $configured -le $script:EmbeddingServerMaxTimeoutMs) {
        $result.TimeoutMs = [int][math]::Floor($configured)
    }
    return $result
}

# One call to the loopback server. HttpWebRequest rather than Invoke-WebRequest,
# because the doctor runs under Windows PowerShell 5.1, whose Invoke-WebRequest
# cannot read a non-2xx answer as a result. The guards are the host probe's:
# no redirect is followed, so an answer cannot send the call anywhere else, and
# the call has its own clock. No proxy is used, so the call goes to the address
# in the URL and nowhere else. The answer is read to a cap and decoded as
# UTF-8. Ok is $true wherever an HTTP answer came back, whatever its status.
function Invoke-EmbeddingServerRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][int]$TimeoutMs,
        [string]$Body
    )
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $response = $null
    try {
        $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Uri)
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.KeepAlive = $false
        $request.Timeout = $TimeoutMs
        $request.ReadWriteTimeout = $TimeoutMs
        if (-not [string]::IsNullOrEmpty($Body)) {
            $payload = [System.Text.Encoding]::UTF8.GetBytes($Body)
            $request.Method = "POST"
            $request.ContentType = "application/json"
            $request.ContentLength = $payload.Length
            $stream = $request.GetRequestStream()
            try { $stream.Write($payload, 0, $payload.Length) } finally { $stream.Dispose() }
        }
        try { $response = $request.GetResponse() }
        catch {
            # A non-2xx answer arrives as a WebException carrying the response,
            # wrapped by PowerShell's method-call exception.
            $inner = $_.Exception
            while ($null -ne $inner -and -not ($inner -is [System.Net.WebException])) { $inner = $inner.InnerException }
            if ($null -ne $inner -and $null -ne $inner.Response) { $response = $inner.Response } else { throw }
        }
        $buffer = New-Object byte[] 65536
        $memory = New-Object System.IO.MemoryStream
        $reader = $response.GetResponseStream()
        try {
            while ($true) {
                $read = $reader.Read($buffer, 0, $buffer.Length)
                if ($read -le 0) { break }
                $memory.Write($buffer, 0, $read)
                if ($memory.Length -gt $script:EmbeddingServerAnswerCapBytes) {
                    throw ("the answer ran past " + $script:EmbeddingServerAnswerCapBytes + " bytes")
                }
            }
        }
        finally { $reader.Dispose() }
        $watch.Stop()
        return @{
            Ok     = $true
            Status = [int]$response.StatusCode
            Body   = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
            Ms     = [math]::Round($watch.Elapsed.TotalMilliseconds)
            Detail = ""
        }
    }
    catch {
        $watch.Stop()
        return @{ Ok = $false; Status = 0; Body = ""; Ms = [math]::Round($watch.Elapsed.TotalMilliseconds); Detail = $_.Exception.Message }
    }
    finally {
        if ($null -ne $response) { $response.Dispose() }
    }
}

# The host probe's check 4 shape: /v1/models lists the identity, and one
# /v1/embeddings call answers one vector. Complete is $true where both answers
# were whole and well formed, whatever they said; Identity is whether the
# list carries the model, and Width the vector's length. Detail names what was
# incomplete, already sanitized. TimeoutMs is one budget for both calls: the
# second gets what the first left, so a hung server costs one budget, and
# ElapsedMs says how much was spent, for a caller with a third call to make.
function Test-EmbeddingServerAnswers {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Model,
        [Parameter(Mandatory = $true)][int]$TimeoutMs
    )
    $result = @{ Complete = $false; Identity = $false; Ids = @(); Width = $null; CallMs = $null; Detail = ""; ElapsedMs = 0 }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $models = Invoke-EmbeddingServerRequest -Uri ($BaseUrl + "/v1/models") -TimeoutMs $TimeoutMs
    $result.ElapsedMs = [int]$clock.ElapsedMilliseconds
    if (-not $models.Ok) {
        $result.Detail = "GET /v1/models did not answer within " + $TimeoutMs + " ms: " + (Get-SanitizedLine $models.Detail 200)
        return $result
    }
    if ($models.Status -lt 200 -or $models.Status -ge 300) {
        $result.Detail = "GET /v1/models answered HTTP " + $models.Status
        return $result
    }
    $ids = $null
    try {
        $listed = $models.Body | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $listed.data) { $ids = @(@($listed.data) | ForEach-Object { [string]$_.id }) }
    }
    catch { $ids = $null }
    if ($null -eq $ids) {
        $result.Detail = "GET /v1/models answered a body that is not a model list: " + (Get-SanitizedLine $models.Body 120)
        return $result
    }
    $result.Ids = $ids
    if ($ids -notcontains $Model) {
        $result.Complete = $true
        return $result
    }
    $result.Identity = $true
    $left = $TimeoutMs - [int]$clock.ElapsedMilliseconds
    if ($left -lt 1) {
        $result.Detail = "POST /v1/embeddings was not sent: GET /v1/models spent the whole " + $TimeoutMs + " ms"
        return $result
    }
    $payload = @{ model = $Model; input = "a short probe of the embedding server" } | ConvertTo-Json -Compress
    $embed = Invoke-EmbeddingServerRequest -Uri ($BaseUrl + "/v1/embeddings") -TimeoutMs $left -Body $payload
    $result.ElapsedMs = [int]$clock.ElapsedMilliseconds
    if (-not $embed.Ok) {
        $result.Detail = "POST /v1/embeddings did not answer within the " + $left + " ms the check had left: " + (Get-SanitizedLine $embed.Detail 200)
        return $result
    }
    if ($embed.Status -lt 200 -or $embed.Status -ge 300) {
        $result.Detail = "POST /v1/embeddings answered HTTP " + $embed.Status + ": " + (Get-SanitizedLine $embed.Body 120)
        return $result
    }
    $width = $null
    try {
        $answer = $embed.Body | ConvertFrom-Json -ErrorAction Stop
        $data = @($answer.data)
        if ($data.Count -eq 1 -and $null -ne $data[0].embedding) { $width = @($data[0].embedding).Count }
    }
    catch { $width = $null }
    if ($null -eq $width) {
        $result.Detail = "POST /v1/embeddings answered a body that is not one vector: " + (Get-SanitizedLine $embed.Body 120)
        return $result
    }
    $result.Complete = $true
    $result.Width = $width
    $result.CallMs = $embed.Ms
    return $result
}

# The working set, in MB, of the process listening on the port, which is the
# process that answered. $null where it cannot be read.
function Get-EmbeddingServerWorkingSetMB {
    param([Parameter(Mandatory = $true)][int]$Port)
    try {
        $listener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)[0]
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
        return [int][math]::Round($process.WorkingSet64 / 1MB)
    }
    catch { return $null }
}

# The default task reader: the task's registration, running state, last start
# time ($null where it never ran) and canonical fields, read through the
# ScheduledTasks cmdlets. A host with no ScheduledTasks module, or a query
# that fails for any reason but the task's absence, throws.
function Get-EmbeddingServerTaskReader {
    return {
        param([Parameter(Mandatory = $true)][string]$TaskName)
        if ($null -eq (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) {
            throw "the ScheduledTasks module is not available on this host"
        }
        try { $tasks = @(Get-ScheduledTask -TaskName $TaskName -TaskPath "\" -ErrorAction Stop) }
        catch {
            if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound) { return @{ Registered = $false } }
            throw
        }
        if ($tasks.Count -eq 0) { return @{ Registered = $false } }
        $task = $tasks[0]
        $lastStart = $null
        try { $lastStart = (Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath "\" -ErrorAction Stop).LastRunTime } catch { $lastStart = $null }
        # A task that never ran reports a sentinel date in 1999, not an empty one.
        if ($lastStart -is [datetime] -and $lastStart.Year -lt 2000) { $lastStart = $null }
        $action = @($task.Actions)[0]
        return @{
            Registered = $true
            State      = [string]$task.State
            Running    = ([string]$task.State -eq "Running")
            LastStart  = $lastStart
            Execute    = [string]$action.Execute
            Arguments  = [string]$action.Arguments
            UserId     = [string]$task.Principal.UserId
            LogonType  = [string]$task.Principal.LogonType
            RunLevel   = [string]$task.Principal.RunLevel
            Triggers   = @(@($task.Triggers) | ForEach-Object { [string]$_.CimClass.CimClassName })
        }
    }
}

# The default task writer. Verbs: Register, Unregister, Start, Stop. Stop also
# stops a llama-server process running from the install's own llama
# directory and waits up to 10 seconds for it to exit, so neither a restart
# nor a file replacement meets the old server still holding the port or its
# files; no other process is touched.
function Get-EmbeddingServerTaskWriter {
    return {
        param(
            [Parameter(Mandatory = $true)][string]$Verb,
            [Parameter(Mandatory = $true)][string]$TaskName,
            $Definition,
            [string]$InstallRoot
        )
        switch ($Verb) {
            "Register" {
                Register-ScheduledTask -TaskName $TaskName -TaskPath "\" -Action $Definition.Action -Trigger $Definition.Trigger `
                    -Principal $Definition.Principal -Settings $Definition.Settings -ErrorAction Stop | Out-Null
            }
            "Unregister" { Unregister-ScheduledTask -TaskName $TaskName -TaskPath "\" -Confirm:$false -ErrorAction Stop }
            "Start" { Start-ScheduledTask -TaskName $TaskName -TaskPath "\" -ErrorAction Stop }
            "Stop" {
                Stop-ScheduledTask -TaskName $TaskName -TaskPath "\" -ErrorAction Stop
                if (-not [string]::IsNullOrEmpty($InstallRoot)) {
                    $llamaPrefix = (Join-Path $InstallRoot "llama") + [System.IO.Path]::DirectorySeparatorChar
                    $stopped = @()
                    foreach ($server in @(Get-Process -Name "llama-server" -ErrorAction SilentlyContinue)) {
                        $serverPath = [string]$server.Path
                        if ($serverPath -ne "" -and $serverPath.StartsWith($llamaPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                            Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
                            $stopped += $server.Id
                        }
                    }
                    if ($stopped.Count -gt 0) { Wait-Process -Id $stopped -Timeout 10 -ErrorAction SilentlyContinue }
                }
            }
            default { throw "unknown task verb: $Verb" }
        }
    }
}

# The one task the install registers: Windows PowerShell running the launcher
# at system startup, as the installing account under S4U at the Limited run
# level, with the persona tasks' settings (unlimited execution time, restart
# every minute up to 999 times, one instance). S4U because the server reads no
# credential store, so nothing needs the account's DPAPI key and the scheduler
# holds no password.
function Get-EmbeddingServerTaskSpec {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$UserId
    )
    return @{
        Execute   = Join-Path ([Environment]::SystemDirectory) "WindowsPowerShell\v1.0\powershell.exe"
        Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"" + (Join-Path $InstallRoot "run-embedding-server.ps1") + "`""
        UserId    = $UserId
    }
}

function New-EmbeddingServerTaskDefinition {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$UserId
    )
    $spec = Get-EmbeddingServerTaskSpec -InstallRoot $InstallRoot -UserId $UserId
    return @{
        Action    = New-ScheduledTaskAction -Execute $spec.Execute -Argument $spec.Arguments
        Trigger   = New-ScheduledTaskTrigger -AtStartup
        Principal = New-ScheduledTaskPrincipal -UserId $spec.UserId -LogonType S4U -RunLevel Limited
        Settings  = New-ScheduledTaskSettingsSet `
            -RestartCount 999 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -MultipleInstances IgnoreNew `
            -StartWhenAvailable `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries
    }
}

# The registration as one line an operator runs in an elevated PowerShell,
# for where this account may not register the task itself. Every value is a
# single-quoted literal with its quotes doubled, raw rather than sanitized,
# since it names the paths that are there.
function Get-EmbeddingServerRegisterCommand {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$UserId
    )
    $spec = Get-EmbeddingServerTaskSpec -InstallRoot $InstallRoot -UserId $UserId
    $quote = { param($value) "'" + ([string]$value).Replace("'", "''") + "'" }
    return ("Register-ScheduledTask -TaskName " + (& $quote $TaskName) + " -TaskPath '\'" +
        " -Action (New-ScheduledTaskAction -Execute " + (& $quote $spec.Execute) + " -Argument " + (& $quote $spec.Arguments) + ")" +
        " -Trigger (New-ScheduledTaskTrigger -AtStartup)" +
        " -Principal (New-ScheduledTaskPrincipal -UserId " + (& $quote $spec.UserId) + " -LogonType S4U -RunLevel Limited)" +
        " -Settings (New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)" +
        " -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable" +
        " -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)")
}

# The fields of a task reading that differ from the canonical definition, by
# name; empty where the reading matches. The account compares whole or by its
# name after the domain, since the scheduler may report either form, and a
# reading that is a SID is translated to its account name first.
function Get-EmbeddingServerTaskDrift {
    param(
        [Parameter(Mandatory = $true)]$Reading,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$UserId
    )
    $spec = Get-EmbeddingServerTaskSpec -InstallRoot $InstallRoot -UserId $UserId
    $drift = @()
    if (-not [string]::Equals([string]$Reading.Execute, $spec.Execute, [System.StringComparison]::OrdinalIgnoreCase)) { $drift += "action" }
    elseif ([string]$Reading.Arguments -ne $spec.Arguments) { $drift += "action" }
    $triggers = @($Reading.Triggers)
    if ($triggers.Count -ne 1 -or [string]$triggers[0] -ne "MSFT_TaskBootTrigger") { $drift += "trigger" }
    $userLeaf = ($UserId -split '\\')[-1]
    $readUser = [string]$Reading.UserId
    if ($readUser -match '^S-1-[0-9-]+$') {
        try { $readUser = (New-Object System.Security.Principal.SecurityIdentifier($readUser)).Translate([System.Security.Principal.NTAccount]).Value }
        catch { }
    }
    $userMatches = [string]::Equals($readUser, $UserId, [System.StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($readUser, $userLeaf, [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $userMatches -or [string]$Reading.LogonType -ne "S4U" -or [string]$Reading.RunLevel -ne "Limited") { $drift += "principal" }
    return $drift
}

# Whether an error is the scheduler refusing this account the right to
# register, which an elevated run can do instead.
function Test-EmbeddingServerAccessDenied {
    param([Parameter(Mandatory = $true)]$ErrorRecord)
    if ($ErrorRecord.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::PermissionDenied) { return $true }
    $exception = $ErrorRecord.Exception
    while ($null -ne $exception) {
        if ($exception.HResult -eq -2147024891 -or $exception -is [System.UnauthorizedAccessException]) { return $true }
        $exception = $exception.InnerException
    }
    return ([string]$ErrorRecord.Exception.Message -match 'Access is denied')
}

# Registration, start, stop, restart and removal, each through the writer.
function Register-EmbeddingServerTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$UserId,
        [scriptblock]$TaskWriter = (Get-EmbeddingServerTaskWriter)
    )
    try {
        $definition = New-EmbeddingServerTaskDefinition -InstallRoot $InstallRoot -UserId $UserId
        & $TaskWriter "Register" $TaskName $definition $InstallRoot
        return @{ Ok = $true; Unfinished = $false; Notes = @("Registered the scheduled task $TaskName to run the server at system startup.") }
    }
    catch {
        if (Test-EmbeddingServerAccessDenied -ErrorRecord $_) {
            return @{ Ok = $false; Unfinished = $true; Notes = @(
                ("This account may not register the scheduled task ${TaskName}: " + (Get-SanitizedLine $_.Exception.Message 200)),
                "Run this in an elevated PowerShell, then re-run doctor with -Fix to start it:",
                ("  " + (Get-EmbeddingServerRegisterCommand -TaskName $TaskName -InstallRoot $InstallRoot -UserId $UserId))
            ) }
        }
        return @{ Ok = $false; Unfinished = $false; Notes = @("Could not register the scheduled task ${TaskName}: " + (Get-SanitizedLine $_.Exception.Message 200)) }
    }
}

function Start-EmbeddingServerTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [scriptblock]$TaskWriter = (Get-EmbeddingServerTaskWriter)
    )
    try {
        & $TaskWriter "Start" $TaskName $null $InstallRoot
        return @{ Ok = $true; Notes = @("Started the scheduled task $TaskName.") }
    }
    catch { return @{ Ok = $false; Notes = @("Could not start the scheduled task ${TaskName}: " + (Get-SanitizedLine $_.Exception.Message 200)) } }
}

function Stop-EmbeddingServerTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [scriptblock]$TaskWriter = (Get-EmbeddingServerTaskWriter)
    )
    try {
        & $TaskWriter "Stop" $TaskName $null $InstallRoot
        return @{ Ok = $true; Notes = @("Stopped the scheduled task $TaskName, so the files its server holds open can be replaced.") }
    }
    catch { return @{ Ok = $false; Notes = @("Could not stop the scheduled task ${TaskName}: " + (Get-SanitizedLine $_.Exception.Message 200)) } }
}

function Restart-EmbeddingServerTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [scriptblock]$TaskWriter = (Get-EmbeddingServerTaskWriter)
    )
    try {
        & $TaskWriter "Stop" $TaskName $null $InstallRoot
        & $TaskWriter "Start" $TaskName $null $InstallRoot
        return @{ Ok = $true; Notes = @("Restarted the scheduled task $TaskName.") }
    }
    catch { return @{ Ok = $false; Notes = @("Could not restart the scheduled task ${TaskName}: " + (Get-SanitizedLine $_.Exception.Message 200)) } }
}

# Removal stops the task first, where it runs, so no server outlives its
# registration. A stop that fails on a task that was not running is not a
# failure of the removal.
function Remove-EmbeddingServerTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [scriptblock]$TaskWriter = (Get-EmbeddingServerTaskWriter)
    )
    try { & $TaskWriter "Stop" $TaskName $null $InstallRoot } catch { }
    try {
        & $TaskWriter "Unregister" $TaskName $null $InstallRoot
        return @{ Ok = $true; Notes = @("Unregistered the scheduled task $TaskName.") }
    }
    catch { return @{ Ok = $false; Notes = @("Could not unregister the scheduled task ${TaskName}: " + (Get-SanitizedLine $_.Exception.Message 200)) } }
}

# The launcher the task runs. It starts llama-server in embedding mode on
# loopback, with an 8192-token context and a 2048-token batch so an input past
# 2048 tokens is refused rather than truncated, under the model identity the
# config carries, with the /slots endpoint, on by default, turned off. A task
# action redirects nothing by itself, so the launcher appends everything the
# server prints, stdout and stderr, to server.log beside it, emptying the log
# first where it has passed the cap. It reads no credential: the task runs
# under S4U, where the account's credential stores are locked.
# CRLF-terminated, ASCII only.
function Get-EmbeddingServerLauncherText {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ModelFileName
    )
    return (@(
        "# Starts the kit's embedding server, llama.cpp's llama-server in embedding",
        "# mode, and appends everything it prints to server.log beside this file.",
        "# The scheduled task that starts the server at boot runs this file, and a",
        "# task action redirects nothing by itself. The log is emptied first where it",
        "# has passed $($script:EmbeddingServerLogCapBytes) bytes. The grimoire doctor's Embedding server step",
        "# writes this file, and its -Fix rewrites it.",
        "`$ErrorActionPreference = 'Continue'",
        "`$log = Join-Path `$PSScriptRoot 'server.log'",
        "`$logItem = Get-Item -LiteralPath `$log -ErrorAction SilentlyContinue",
        "if (`$null -ne `$logItem -and `$logItem.Length -gt $($script:EmbeddingServerLogCapBytes)) { [System.IO.File]::WriteAllText(`$log, '') }",
        "`$writer = New-Object System.IO.StreamWriter(`$log, `$true, (New-Object System.Text.UTF8Encoding(`$false)))",
        "`$writer.AutoFlush = `$true",
        "`$code = 1",
        "try {",
        "    `$writer.WriteLine('launcher: starting llama-server at ' + (Get-Date).ToString('o'))",
        "    `$serverArgs = @('--embedding', '--host', '127.0.0.1', '--port', '$Port', '-m', (Join-Path `$PSScriptRoot 'models\$ModelFileName'), '-c', '8192', '-b', '2048', '-ub', '2048', '--alias', '$($script:EmbeddingServerModelId)', '--no-slots')",
        "    & (Join-Path `$PSScriptRoot 'llama\llama-server.exe') @serverArgs 2>&1 | ForEach-Object { `$writer.WriteLine([string]`$_) }",
        "    `$code = `$LASTEXITCODE",
        "    `$writer.WriteLine('launcher: llama-server exited ' + `$code)",
        "}",
        "finally { `$writer.Dispose() }",
        "exit `$code",
        "") -join "`r`n")
}

# The last lines of server.log, each sanitized, opened so a server still
# writing it does not block the read and the read does not block the server.
function Get-EmbeddingServerLogTail {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [int]$Lines = 20
    )
    $log = Join-Path $InstallRoot "server.log"
    if (-not (Test-Path -LiteralPath $log -PathType Leaf)) { return @("server.log: not present at $log.") }
    try {
        $stream = New-Object System.IO.FileStream($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $take = [long][math]::Min($stream.Length, 65536)
            [void]$stream.Seek(-$take, [System.IO.SeekOrigin]::End)
            $buffer = New-Object byte[] $take
            $read = 0
            while ($read -lt $take) {
                $count = $stream.Read($buffer, $read, $take - $read)
                if ($count -le 0) { break }
                $read += $count
            }
        }
        finally { $stream.Dispose() }
        $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
        $all = @($text -split "\r?\n" | Where-Object { $_ -ne "" })
        $tail = @($all | Select-Object -Last $Lines)
        return @("Last $($tail.Count) line(s) of server.log:") + @($tail | ForEach-Object { "  " + (Get-SanitizedLine $_ 200) })
    }
    catch { return @("server.log could not be read: " + (Get-SanitizedLine $_.Exception.Message 200)) }
}

# Where a pinned file lives under the install root: the archive under
# downloads\, kept as the anchor its digest is checked against, and the model
# under models\. A pin name is a plain file name or it is refused.
function Get-EmbeddingServerPinPath {
    param(
        [Parameter(Mandatory = $true)]$Pin,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )
    $name = [string]$Pin.Name
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "pin name is not a plain file name: $name" }
    if ($Pin.Kind -eq "zip") { return Join-Path $InstallRoot ("downloads\" + $name) }
    return Join-Path $InstallRoot ("models\" + $name)
}

function Get-EmbeddingServerFileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Whether a pinned file is in place: present with its pinned SHA-256 and, for
# the archive, with the server it unpacks to present too.
function Test-EmbeddingServerFileCurrent {
    param(
        [Parameter(Mandatory = $true)]$Pin,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )
    try { $target = Get-EmbeddingServerPinPath -Pin $Pin -InstallRoot $InstallRoot } catch { return $false }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { return $false }
    if ((Get-EmbeddingServerFileSha256 -Path $target) -ne ([string]$Pin.Sha256).ToLowerInvariant()) { return $false }
    if ($Pin.Kind -eq "zip" -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot "llama\llama-server.exe") -PathType Leaf)) { return $false }
    return $true
}

# One fetch of a pinned URL to a file, stopped once the answer runs past the
# pinned size, since a file larger than its pin cannot match its digest.
# Redirects are followed: both publishers serve the file from a CDN behind a
# redirect, and the digest, not the address, is what is trusted, so a
# redirect to any host, over http or https, is followed and its file still
# checked.
function Invoke-EmbeddingServerDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][long]$MaxBytes
    )
    if ($Url -match '^(?i)https:') {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
    }
    $request = [System.Net.WebRequest]::Create($Url)
    $request.Timeout = 60000
    if ($request -is [System.Net.HttpWebRequest]) {
        $request.ReadWriteTimeout = 60000
        $request.UserAgent = "grimoire-doctor"
    }
    $response = $request.GetResponse()
    try {
        $in = $response.GetResponseStream()
        $out = [System.IO.File]::Create($Destination)
        try {
            $buffer = New-Object byte[] 1048576
            $total = [long]0
            while ($true) {
                $read = $in.Read($buffer, 0, $buffer.Length)
                if ($read -le 0) { break }
                $total += $read
                if ($total -gt $MaxBytes) { throw "the answer ran past the pinned $MaxBytes bytes" }
                $out.Write($buffer, 0, $read)
            }
        }
        finally {
            $out.Dispose()
            $in.Dispose()
        }
    }
    finally { $response.Dispose() }
}

# Unpacks the archive into llama\ under the install root. Each entry's
# destination is resolved and refused unless it lands inside the staging
# directory, so an entry named with .. or a rooted path cannot write outside
# the install. The archive must hold llama-server.exe at its root. Only once
# the whole archive has unpacked does the staging directory replace llama\.
function Expand-EmbeddingServerArchive {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [string]$DisplayName = (Split-Path $ZipPath -Leaf)
    )
    $final = Join-Path $InstallRoot "llama"
    $staging = Join-Path $InstallRoot ("llama.unpack-" + $PID)
    $zip = $null
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        $stagingPrefix = [System.IO.Path]::GetFullPath($staging).TrimEnd('\') + '\'
        $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
        foreach ($entry in $zip.Entries) {
            $destination = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($stagingPrefix, $entry.FullName))
            if (-not $destination.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw ("the archive entry " + (Get-SanitizedLine $entry.FullName 120) + " would land outside the install, so nothing was unpacked")
            }
            if ($entry.Name -eq "") {
                New-Item -ItemType Directory -Force -Path $destination | Out-Null
                continue
            }
            New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
        $zip.Dispose()
        $zip = $null
        if (-not (Test-Path -LiteralPath (Join-Path $staging "llama-server.exe") -PathType Leaf)) {
            throw "the archive holds no llama-server.exe at its root, so nothing was unpacked"
        }
        if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Recurse -Force }
        Move-Item -LiteralPath $staging -Destination $final
        return @{ Ok = $true; Notes = @("Unpacked the server into $final.") }
    }
    catch {
        if ($null -ne $zip) { $zip.Dispose() }
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        return @{ Ok = $false; Notes = @("Could not unpack ${DisplayName}: " + (Get-SanitizedLine $_.Exception.Message 200)) }
    }
}

# One pinned file, present with its digest or fetched and checked. A file
# already present with the pinned digest is kept and not fetched. One present
# with another digest is deleted and fetched again. A fetch lands under a
# temporary name and is moved into place, or unpacked, only where its SHA-256
# matches the pin; otherwise it is deleted and the refusal names both digests.
# Refused is $true only for a digest refusal.
function Install-EmbeddingServerFile {
    param(
        [Parameter(Mandatory = $true)]$Pin,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )
    $notes = @()
    try { $target = Get-EmbeddingServerPinPath -Pin $Pin -InstallRoot $InstallRoot }
    catch { return @{ Ok = $false; Refused = $false; Notes = @((Get-SanitizedLine $_.Exception.Message 200)) } }
    $name = [string]$Pin.Name
    $expected = ([string]$Pin.Sha256).ToLowerInvariant()
    $isZip = ($Pin.Kind -eq "zip")
    $serverExe = Join-Path $InstallRoot "llama\llama-server.exe"

    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $present = Get-EmbeddingServerFileSha256 -Path $target
        if ($present -eq $expected) {
            if (-not $isZip -or (Test-Path -LiteralPath $serverExe -PathType Leaf)) {
                return @{ Ok = $true; Refused = $false; Notes = @("$name is present with its pinned SHA-256, so it was not fetched.") }
            }
            $unpack = Expand-EmbeddingServerArchive -ZipPath $target -InstallRoot $InstallRoot
            return @{ Ok = $unpack.Ok; Refused = $false; Notes = @("$name is present with its pinned SHA-256, so it was not fetched.") + $unpack.Notes }
        }
        try { Remove-Item -LiteralPath $target -Force -ErrorAction Stop }
        catch { return @{ Ok = $false; Refused = $false; Notes = @("$name is present with SHA-256 $present, not the pinned $expected, and could not be deleted: " + (Get-SanitizedLine $_.Exception.Message 200)) } }
        $notes += "$name was present with SHA-256 $present, not the pinned $expected, so it was deleted and fetched again."
    }

    $temp = "$target.download-$PID"
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
        Invoke-EmbeddingServerDownload -Url ([string]$Pin.Url) -Destination $temp -MaxBytes ([long]$Pin.Bytes)
    }
    catch {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        return @{ Ok = $false; Refused = $false; Notes = $notes + @("Could not fetch $name from " + (Get-SanitizedLine ([string]$Pin.Url) 200) + ": " + (Get-SanitizedLine $_.Exception.Message 200)) }
    }
    $actual = Get-EmbeddingServerFileSha256 -Path $temp
    if ($actual -ne $expected) {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        return @{ Ok = $false; Refused = $true; Notes = $notes + @(
            "Refused ${name}: the download's SHA-256 is $actual, and the pin is $expected.",
            "The download was deleted and nothing was installed from it."
        ) }
    }
    $notes += "Fetched $name and matched its pinned SHA-256."
    if ($isZip) {
        # The archive is unpacked from its temporary name and kept under
        # downloads\ only once the unpack succeeded, so a kept archive with the
        # pinned digest always means llama\ came from it.
        $unpack = Expand-EmbeddingServerArchive -ZipPath $temp -InstallRoot $InstallRoot -DisplayName $name
        $notes += $unpack.Notes
        if (-not $unpack.Ok) {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
            return @{ Ok = $false; Refused = $false; Notes = $notes }
        }
    }
    try { Move-Item -LiteralPath $temp -Destination $target -Force -ErrorAction Stop }
    catch {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        if ($isZip) {
            # The server is unpacked; only the archive the next run would check
            # is missing, so that run fetches it again.
            return @{ Ok = $true; Refused = $false; Notes = $notes + @("Could not keep $name under downloads, so the next -Fix fetches it again: " + (Get-SanitizedLine $_.Exception.Message 200)) }
        }
        return @{ Ok = $false; Refused = $false; Notes = $notes + @("Could not move $name into place: " + (Get-SanitizedLine $_.Exception.Message 200)) }
    }
    return @{ Ok = $true; Refused = $false; Notes = $notes }
}

# The end of a JSON string whose opening quote is at $Start, or -1.
function Find-JsonStringEnd {
    param([string]$Text, [int]$Start)
    $j = $Start + 1
    while ($j -lt $Text.Length) {
        $c = $Text[$j]
        if ($c -eq [char]'\') { $j += 2; continue }
        if ($c -eq [char]'"') { return $j }
        $j++
    }
    return -1
}

# The top-level members of a JSON object as spans of its own text: each
# member's name and the start and end of its raw value, and where the
# object's closing brace sits. A rewrite splices one value's span and leaves
# every other byte of the file where it was. $null where the text is not one
# object this scan can read; the caller parses the text first, so that is an
# input ConvertFrom-Json also refused.
function Get-JsonTopLevelMembers {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
    $members = New-Object System.Collections.Generic.List[object]
    $n = $Text.Length
    $i = 0
    while ($i -lt $n -and [char]::IsWhiteSpace($Text[$i])) { $i++ }
    if ($i -ge $n -or $Text[$i] -ne [char]'{') { return $null }
    $i++
    $depth = 1
    $expect = "key"
    $name = $null
    $valueStart = -1
    $lastValueChar = -1
    $closeAt = -1
    while ($i -lt $n) {
        $c = $Text[$i]
        if ([char]::IsWhiteSpace($c)) { $i++; continue }
        if ($depth -eq 1 -and $expect -eq "key") {
            if ($c -eq [char]'}') { $closeAt = $i; break }
            if ($c -ne [char]'"') { return $null }
            $end = Find-JsonStringEnd -Text $Text -Start $i
            if ($end -lt 0) { return $null }
            $raw = $Text.Substring($i + 1, $end - $i - 1)
            $name = $raw
            if ($raw.Contains('\')) { $name = [string](('"' + $raw + '"') | ConvertFrom-Json) }
            $i = $end + 1
            $expect = "colon"
            continue
        }
        if ($depth -eq 1 -and $expect -eq "colon") {
            if ($c -ne [char]':') { return $null }
            $i++
            $expect = "value-start"
            continue
        }
        if ($depth -eq 1 -and $expect -eq "value-start") {
            $valueStart = $i
            $expect = "value"
        }
        if ($c -eq [char]'"') {
            $end = Find-JsonStringEnd -Text $Text -Start $i
            if ($end -lt 0) { return $null }
            $lastValueChar = $end
            $i = $end + 1
            continue
        }
        if ($c -eq [char]'{' -or $c -eq [char]'[') { $depth++; $lastValueChar = $i; $i++; continue }
        if ($c -eq [char]'}' -or $c -eq [char]']') {
            if ($depth -eq 1) {
                $members.Add(@{ Name = $name; Start = $valueStart; End = $lastValueChar + 1 })
                $closeAt = $i
                break
            }
            $depth--
            $lastValueChar = $i
            $i++
            continue
        }
        if ($c -eq [char]',' -and $depth -eq 1) {
            $members.Add(@{ Name = $name; Start = $valueStart; End = $lastValueChar + 1 })
            $expect = "key"
            $i++
            continue
        }
        $lastValueChar = $i
        $i++
    }
    if ($closeAt -lt 0) { return $null }
    return @{ Members = $members; CloseAt = $closeAt }
}

# Writes the embedding block {url, model} into the client config. It adds the
# block where the config has none or has one with no url, rewrites one whose
# url's host is loopback, and leaves one naming any other host untouched,
# saying so. The new block's text is spliced in place of the old block's value,
# or added as the last member, so every other byte of the file is kept; the
# result is parsed and every other member's text is compared before it lands.
# The write goes through a temp file beside the config, swapped in by
# File.Replace so the config keeps its access control list, and is abandoned
# where the file changed on disk meanwhile. -HoldDiffering keeps a loopback
# block whose url or model differs, since replacing a value the operator chose
# waits for a person; the note names both values. Outcome is written,
# rewritten, unchanged, untouched, held or refused.
function Set-EmbeddingServerConfigBlock {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Model,
        [switch]$HoldDiffering
    )
    $temp = "$ConfigPath.tmp-embedding-$PID"
    try {
        $read = Read-EmbeddingServerConfigText -Path $ConfigPath
        $text = $read.Text
        # A fixed phrase, not the parser's message, which can quote the file.
        try { $parsed = $text | ConvertFrom-Json -ErrorAction Stop }
        catch { return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block: $ConfigPath does not parse as JSON.") } }
        if ($parsed -isnot [System.Management.Automation.PSCustomObject]) {
            return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block: $ConfigPath does not hold a JSON object.") }
        }
        $scan = Get-JsonTopLevelMembers -Text $text
        if ($null -eq $scan) {
            return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block: $ConfigPath could not be read member by member.") }
        }
        $blockMembers = @($scan.Members | Where-Object { $_.Name -eq "embedding" })
        if ($blockMembers.Count -gt 1) {
            return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block: $ConfigPath names embedding more than once.") }
        }

        $block = $parsed.embedding
        $existingUrl = ""
        if ($block -is [System.Management.Automation.PSCustomObject]) { $existingUrl = ([string]$block.url).Trim() }
        $outcome = "written"
        if ($existingUrl -ne "") {
            if (-not (Test-EmbeddingUrlIsLoopback -Url $existingUrl)) {
                return @{ Ok = $true; Outcome = "untouched"; Notes = @(
                    "Left the embedding block in $ConfigPath untouched: its url " + (Get-SanitizedLine $existingUrl 200) + " names a host that is not this machine."
                ) }
            }
            if ($existingUrl.TrimEnd('/') -eq $Url -and ([string]$block.model).Trim() -eq $Model) {
                return @{ Ok = $true; Outcome = "unchanged"; Notes = @("The embedding block in $ConfigPath already names $Url and $Model.") }
            }
            if ($HoldDiffering) {
                return @{ Ok = $true; Outcome = "held"; Notes = @(
                    ("Left the embedding block in $ConfigPath as it is: it names url " + (Get-SanitizedLine $existingUrl 200) +
                        " and model " + (Get-SanitizedLine ([string]$block.model) 120) + ", and the kit's server is url $Url and model $Model."),
                    "To replace it, run the doctor with -Fix at a console where a person can answer the second prompt, and answer yes."
                ) }
            }
            $outcome = "rewritten"
        }

        $blockText = '{ "url": ' + (ConvertTo-Json -InputObject $Url) + ', "model": ' + (ConvertTo-Json -InputObject $Model) + ' }'
        if ($blockMembers.Count -eq 1) {
            $span = $blockMembers[0]
            $newText = $text.Substring(0, $span.Start) + $blockText + $text.Substring($span.End)
        }
        else {
            $newline = "`n"
            if ($text.Contains("`r`n")) { $newline = "`r`n" }
            $indent = "  "
            if ($text -match '\n([ \t]+)"') { $indent = $Matches[1] }
            $k = $scan.CloseAt - 1
            while ($k -ge 0 -and [char]::IsWhiteSpace($text[$k])) { $k-- }
            if ($scan.Members.Count -eq 0) {
                $insert = $newline + $indent + '"embedding": ' + $blockText + $newline
            }
            else {
                $insert = "," + $newline + $indent + '"embedding": ' + $blockText
            }
            $newText = $text.Substring(0, $k + 1) + $insert + $text.Substring($k + 1)
        }

        # The candidate must parse, carry the new block, and hold every other
        # member's text exactly as the original held it.
        $candidate = $newText | ConvertFrom-Json -ErrorAction Stop
        if ([string]$candidate.embedding.url -ne $Url -or [string]$candidate.embedding.model -ne $Model) {
            return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block: the rewritten text did not carry it; nothing was changed.") }
        }
        $newScan = Get-JsonTopLevelMembers -Text $newText
        $before = @{}
        foreach ($member in $scan.Members) { if ($member.Name -ne "embedding") { $before[$member.Name] = $text.Substring($member.Start, $member.End - $member.Start) } }
        $after = @{}
        foreach ($member in $newScan.Members) { if ($member.Name -ne "embedding") { $after[$member.Name] = $newText.Substring($member.Start, $member.End - $member.Start) } }
        $damaged = @()
        foreach ($memberName in $before.Keys) {
            if (-not $after.ContainsKey($memberName) -or $after[$memberName] -cne $before[$memberName]) { $damaged += $memberName }
        }
        if ($damaged.Count -gt 0 -or $after.Count -ne $before.Count) {
            return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block: the rewrite would have changed " + (Get-SanitizedLine ($damaged -join ", ") 200) + "; nothing was changed.") }
        }

        $utf8 = New-Object System.Text.UTF8Encoding($read.HasBom)
        [System.IO.File]::WriteAllText($temp, $newText, $utf8)
        $current = [System.IO.File]::ReadAllBytes($ConfigPath)
        if ([Convert]::ToBase64String($current) -ne [Convert]::ToBase64String($read.Bytes)) {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
            return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block: $ConfigPath changed on disk while the write was prepared; re-run the doctor.") }
        }
        # [NullString]::Value, because PowerShell passes a bare $null to a .NET
        # string parameter as "", which Replace rejects as a path.
        [System.IO.File]::Replace($temp, $ConfigPath, [NullString]::Value)
        $verb = "Wrote"
        if ($outcome -eq "rewritten") { $verb = "Rewrote" }
        return @{ Ok = $true; Outcome = $outcome; Notes = @("$verb the embedding block in ${ConfigPath}: url $Url, model $Model.") }
    }
    catch {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        return @{ Ok = $false; Outcome = "refused"; Notes = @("Did not write the embedding block in ${ConfigPath}: " + (Get-SanitizedLine $_.Exception.Message 200)) }
    }
}

# Fills the task fields of a state from the task reader. A reader that throws
# leaves the task unregistered and its message in TaskReadError, so the read
# never fails the caller. TaskDrift is read only with -ReadDrift.
function Read-EmbeddingServerTaskInto {
    param(
        [Parameter(Mandatory = $true)][hashtable]$State,
        [Parameter(Mandatory = $true)][scriptblock]$TaskReader,
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$UserId,
        [switch]$ReadDrift
    )
    try {
        $reading = & $TaskReader $TaskName
        $State.TaskRegistered = [bool]$reading.Registered
        if ($State.TaskRegistered) {
            $State.TaskRunning = [bool]$reading.Running
            $State.TaskLastStart = $reading.LastStart
            $State.TaskState = [string]$reading.State
            if ($ReadDrift) { $State.TaskDrift = @(Get-EmbeddingServerTaskDrift -Reading $reading -InstallRoot $InstallRoot -UserId $UserId) }
        }
    }
    catch {
        $State.TaskRegistered = $false
        $State.TaskReadError = $_.Exception.Message
    }
}

# The server's state as the doctor reads it, one of six:
#   no-config  no client config file.
#   remote     a url whose host is not loopback, or a config that will not
#              parse; no connection is made.
#   ready      /v1/models lists the identity and /v1/embeddings answers one
#              vector of the expected width.
#   starting   the task is running, started under the cold-start bound ago,
#              and /health has not answered 200.
#   silent     no complete, well-formed answer, and not starting.
#   mismatch   a complete answer carrying another identity or another width.
# The identity compared is the config's own embedding.model. A config with no
# url is read against the loopback url and identity -Fix would write, and
# BlockMissing says so. Where the url is loopback the task's registration,
# running state, last start time and the fields that differ from the kit's
# definition (TaskDrift) are read too. In no-config the task is read the same
# way except for TaskDrift, which stays empty since no install root is
# expected there; remote reads no task. The calls share one budget, the
# config's timeoutMs unless -TimeoutMs names another, returned as TimeoutMs.
# /health, asked only where the task started within the cold-start bound, gets
# what is left of it but never less than its own floor, the smaller of 1000 ms
# and the budget, so a hung server costs at most the budget plus that floor.
# Every string field that came from the server, the config or the task is raw
# here; the caller sanitizes what it prints.
function Get-EmbeddingServerState {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$TaskName,
        [int]$TimeoutMs = 0,
        [scriptblock]$TaskReader = (Get-EmbeddingServerTaskReader),
        [string]$UserId = ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name),
        [int]$Port = (Get-EmbeddingServerPort)
    )
    $state = @{
        State          = ""
        Url            = ""
        Model          = ""
        BlockMissing   = $false
        ConfigError    = $null
        TimeoutMs      = $TimeoutMs
        InstallPresent = (Test-Path -LiteralPath $InstallRoot -PathType Container)
        Ids            = @()
        Width          = $null
        WorkingSetMB   = $null
        CallMs         = $null
        TaskRegistered = $null
        TaskRunning    = $null
        TaskLastStart  = $null
        TaskState      = ""
        TaskDrift      = @()
        TaskReadError  = $null
        HealthStatus   = $null
        Detail         = ""
    }
    $config = Read-EmbeddingServerConfig -ConfigPath $ConfigPath
    if ($TimeoutMs -le 0) { $state.TimeoutMs = $config.TimeoutMs }
    if (-not $config.Exists) {
        $state.State = "no-config"
        Read-EmbeddingServerTaskInto -State $state -TaskReader $TaskReader -TaskName $TaskName -InstallRoot $InstallRoot -UserId $UserId
        return $state
    }
    if ($null -ne $config.Error) { $state.State = "remote"; $state.ConfigError = $config.Error; return $state }
    if ($config.HasUrl) {
        $state.Url = $config.Url
        $state.Model = $config.Model
    }
    else {
        $state.Url = "http://127.0.0.1:" + $Port
        $state.Model = $script:EmbeddingServerModelId
        $state.BlockMissing = $true
    }
    if (-not (Test-EmbeddingUrlIsLoopback -Url $state.Url)) { $state.State = "remote"; return $state }

    Read-EmbeddingServerTaskInto -State $state -TaskReader $TaskReader -TaskName $TaskName -InstallRoot $InstallRoot -UserId $UserId -ReadDrift

    $answers = Test-EmbeddingServerAnswers -BaseUrl $state.Url -Model $state.Model -TimeoutMs $state.TimeoutMs
    $state.Ids = $answers.Ids
    if ($answers.Complete) {
        $state.Width = $answers.Width
        if (-not $answers.Identity) { $state.State = "mismatch"; return $state }
        $state.CallMs = $answers.CallMs
        if ($answers.Width -ne $script:EmbeddingServerDimensions) { $state.State = "mismatch"; return $state }
        $state.State = "ready"
        $port = 0
        try { $port = ([System.Uri]$state.Url).Port } catch { $port = 0 }
        if ($port -gt 0) { $state.WorkingSetMB = Get-EmbeddingServerWorkingSetMB -Port $port }
        return $state
    }

    $state.Detail = $answers.Detail
    $recent = $false
    if ($state.TaskRunning -eq $true -and $state.TaskLastStart -is [datetime]) {
        $age = ((Get-Date) - $state.TaskLastStart).TotalSeconds
        $recent = ($age -ge 0 -and $age -lt $script:EmbeddingServerColdStartSeconds)
    }
    if ($recent) {
        # /health gets what the check left of the budget, but never less than
        # its own floor, the smaller of 1000 ms and the timeout, so starting
        # always means /health was asked and did not answer 200.
        $floor = [math]::Min(1000, $state.TimeoutMs)
        $left = [math]::Max($floor, $state.TimeoutMs - $answers.ElapsedMs)
        $health = Invoke-EmbeddingServerRequest -Uri ($state.Url + "/health") -TimeoutMs $left
        if ($health.Ok) { $state.HealthStatus = $health.Status }
        if ($health.Ok -and $health.Status -eq 200) { $state.State = "silent"; return $state }
        $state.State = "starting"
        return $state
    }
    $state.State = "silent"
    return $state
}

# Waits for /health to answer 200, polling once a second up to the cold-start
# bound. The bound is the installer's own, not the config's single-call
# timeout, since a large model loading from a cold disk can outlast one call.
# The deadline is read before each pause, so no pause runs past it.
function Wait-EmbeddingServerHealth {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)
    $deadline = (Get-Date).AddSeconds($script:EmbeddingServerColdStartSeconds)
    $last = $null
    while ($true) {
        $last = Invoke-EmbeddingServerRequest -Uri ($BaseUrl + "/health") -TimeoutMs 2000
        if ($last.Ok -and $last.Status -eq 200) { return @{ Ok = $true; Detail = "" } }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Milliseconds 1000
    }
    $detail = "nothing answered"
    if ($last.Ok) { $detail = "the last answer was HTTP " + $last.Status }
    elseif ($last.Detail -ne "") { $detail = "the last call failed: " + (Get-SanitizedLine $last.Detail 200) }
    return @{ Ok = $false; Detail = $detail }
}

# Whether the config's embedding block names a loopback url or a model other
# than the ones -Fix writes, so writing them replaces a value the operator
# chose. A config with no url, and one naming another host, is $false: the
# first is supplied, the second left untouched.
function Test-EmbeddingServerConfigDiffers {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [int]$Port = (Get-EmbeddingServerPort)
    )
    $config = Read-EmbeddingServerConfig -ConfigPath $ConfigPath
    if (-not $config.Exists -or $null -ne $config.Error -or -not $config.HasUrl) { return $false }
    if (-not (Test-EmbeddingUrlIsLoopback -Url $config.Url)) { return $false }
    return ($config.Url -ne ("http://127.0.0.1:" + $Port) -or $config.Model -ne $script:EmbeddingServerModelId)
}

# Installs or repairs the server and brings it up: each pinned file present
# with its digest or fetched and checked, the launcher written, the task
# registered where it is absent and registered again where its action,
# trigger or principal differs, started where it is stopped and restarted
# where -Restart asks, then /health awaited, the check 4 shape run under the
# config's timeout, the embedding block written, and the working set and the
# probe call's time read. A running task is stopped before any pinned file
# or the launcher is replaced, since the server holds its files open, and is
# started again after. -HoldConfigRewrite keeps a loopback block naming
# another url or model, for a run no person answered. Ok is $true only where
# all of that held; Unfinished is $true where the registration was refused
# for rights, and the notes carry the line to run elevated, or where the
# block was held; Refused is $true where a download's digest was refused.
function Install-EmbeddingServer {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$TaskName,
        [object[]]$Pins = (Get-EmbeddingServerPins),
        [scriptblock]$TaskReader = (Get-EmbeddingServerTaskReader),
        [scriptblock]$TaskWriter = (Get-EmbeddingServerTaskWriter),
        [string]$UserId = ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name),
        [int]$Port = (Get-EmbeddingServerPort),
        [int]$TimeoutMs = $script:EmbeddingServerDefaultTimeoutMs,
        [switch]$Restart,
        [switch]$HoldConfigRewrite
    )
    $result = @{ Ok = $false; Unfinished = $false; Refused = $false; Notes = @(); WorkingSetMB = $null; CallMs = $null; Restarted = $false }
    try { New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null }
    catch {
        $result.Notes += "Could not create ${InstallRoot}: " + (Get-SanitizedLine $_.Exception.Message 200)
        return $result
    }

    $modelFileName = $null
    foreach ($pin in $Pins) { if ($pin.Kind -eq "model") { $modelFileName = [string]$pin.Name } }
    if ($null -eq $modelFileName) {
        $result.Notes += "The pins name no model file, so there is nothing for the server to load."
        return $result
    }

    $reading = $null
    try { $reading = & $TaskReader $TaskName }
    catch {
        $result.Notes += "Could not read the scheduled task ${TaskName}: " + (Get-SanitizedLine $_.Exception.Message 200)
        return $result
    }
    $registered = [bool]$reading.Registered
    $running = $registered -and [bool]$reading.Running

    # What this run replaces on disk, read before anything changes.
    $current = @{}
    foreach ($pin in $Pins) { $current[[string]$pin.Name] = (Test-EmbeddingServerFileCurrent -Pin $pin -InstallRoot $InstallRoot) }
    $launcher = Join-Path $InstallRoot "run-embedding-server.ps1"
    $launcherText = Get-EmbeddingServerLauncherText -Port $Port -ModelFileName $modelFileName
    $launcherPresent = $null
    try { if (Test-Path -LiteralPath $launcher -PathType Leaf) { $launcherPresent = [System.IO.File]::ReadAllText($launcher) } }
    catch { $launcherPresent = $null }
    $launcherChanged = ($launcherPresent -cne $launcherText)
    $replacing = $launcherChanged -or (@($current.Values | Where-Object { -not $_ }).Count -gt 0)

    $stoppedForUpdate = $false
    $tookDown = $false
    if ($running -and $replacing) {
        $stop = Stop-EmbeddingServerTask -TaskName $TaskName -InstallRoot $InstallRoot -TaskWriter $TaskWriter
        $result.Notes += $stop.Notes
        if (-not $stop.Ok) { return $result }
        $running = $false
        $stoppedForUpdate = $true
        $tookDown = $true
    }

    # Every exit from here on, a failure included, starts again a server this
    # run took down, by stopping it or unregistering its running task, on the
    # files it had where they are still there; the normal path starts it
    # itself, so the finally block skips a start already tried. A task this
    # run unregistered is not there to start, so the notes say how it returns.
    $startAttempted = $false
    try {
        foreach ($pin in $Pins) {
            if ($current[[string]$pin.Name]) {
                $result.Notes += ([string]$pin.Name + " is present with its pinned SHA-256, so it was not fetched.")
                continue
            }
            $file = Install-EmbeddingServerFile -Pin $pin -InstallRoot $InstallRoot
            $result.Notes += $file.Notes
            if (-not $file.Ok) {
                $result.Refused = [bool]$file.Refused
                return $result
            }
        }

        if ($launcherChanged) {
            try {
                [System.IO.File]::WriteAllText($launcher, $launcherText, (New-Object System.Text.UTF8Encoding($false)))
                $result.Notes += "Wrote the launcher $launcher."
            }
            catch {
                $result.Notes += "Could not write the launcher ${launcher}: " + (Get-SanitizedLine $_.Exception.Message 200)
                return $result
            }
        }

        if ($registered) {
            $drift = @(Get-EmbeddingServerTaskDrift -Reading $reading -InstallRoot $InstallRoot -UserId $UserId)
            if ($drift.Count -gt 0) {
                if ($running) { $tookDown = $true }
                $removed = Remove-EmbeddingServerTask -TaskName $TaskName -InstallRoot $InstallRoot -TaskWriter $TaskWriter
                $result.Notes += ("The scheduled task $TaskName differs from its definition in its " + ($drift -join ", ") + ", so it is registered again.")
                $result.Notes += $removed.Notes
                if (-not $removed.Ok) { return $result }
                $registered = $false
                $running = $false
            }
        }
        if (-not $registered) {
            $register = Register-EmbeddingServerTask -TaskName $TaskName -InstallRoot $InstallRoot -UserId $UserId -TaskWriter $TaskWriter
            $result.Notes += $register.Notes
            if (-not $register.Ok) {
                $result.Unfinished = [bool]$register.Unfinished
                return $result
            }
        }
        if (-not $running) {
            $startAttempted = $true
            $start = Start-EmbeddingServerTask -TaskName $TaskName -InstallRoot $InstallRoot -TaskWriter $TaskWriter
            $result.Notes += $start.Notes
            if (-not $start.Ok) { return $result }
            if ($stoppedForUpdate) { $result.Restarted = $true }
        }
        elseif ($Restart) {
            $restarted = Restart-EmbeddingServerTask -TaskName $TaskName -InstallRoot $InstallRoot -TaskWriter $TaskWriter
            $result.Notes += $restarted.Notes
            if (-not $restarted.Ok) { return $result }
            $result.Restarted = $true
        }
    }
    finally {
        if ($tookDown -and -not $startAttempted) {
            if ($registered) {
                $result.Notes += (Start-EmbeddingServerTask -TaskName $TaskName -InstallRoot $InstallRoot -TaskWriter $TaskWriter).Notes
            }
            elseif ($result.Unfinished) {
                $result.Notes += "The server this run stopped comes back once that line has run and doctor -Fix has started it."
            }
            else {
                $result.Notes += "The server this run stopped is down: re-run doctor -Fix to register the scheduled task $TaskName and start it."
            }
        }
    }

    $baseUrl = "http://127.0.0.1:" + $Port
    $health = Wait-EmbeddingServerHealth -BaseUrl $baseUrl
    if (-not $health.Ok) {
        $result.Notes += ("$baseUrl/health did not answer 200 within " + $script:EmbeddingServerColdStartSeconds + " seconds: " + $health.Detail + ".")
        $result.Notes += Get-EmbeddingServerLogTail -InstallRoot $InstallRoot
        return $result
    }
    $answers = Test-EmbeddingServerAnswers -BaseUrl $baseUrl -Model $script:EmbeddingServerModelId -TimeoutMs $TimeoutMs
    if (-not $answers.Complete) {
        $result.Notes += ("The server answered /health but not the embedding check: " + $answers.Detail)
        $result.Notes += Get-EmbeddingServerLogTail -InstallRoot $InstallRoot
        return $result
    }
    if (-not $answers.Identity) {
        $result.Notes += ("$baseUrl/v1/models does not list " + $script:EmbeddingServerModelId + "; it lists " + (Get-SanitizedLine ($answers.Ids -join ", ") 200) + ".")
        $result.Notes += Get-EmbeddingServerLogTail -InstallRoot $InstallRoot
        return $result
    }
    if ($answers.Width -ne $script:EmbeddingServerDimensions) {
        $result.Notes += ("$baseUrl/v1/embeddings answered a vector of " + $answers.Width + " floats, expected " + $script:EmbeddingServerDimensions + ".")
        $result.Notes += Get-EmbeddingServerLogTail -InstallRoot $InstallRoot
        return $result
    }
    $configWrite = Set-EmbeddingServerConfigBlock -ConfigPath $ConfigPath -Url $baseUrl -Model $script:EmbeddingServerModelId -HoldDiffering:$HoldConfigRewrite
    $result.Notes += $configWrite.Notes
    if (-not $configWrite.Ok) { return $result }
    $result.CallMs = $answers.CallMs
    $result.WorkingSetMB = Get-EmbeddingServerWorkingSetMB -Port $Port
    if ($result.Restarted) { $result.Notes += Get-EmbeddingServerLogTail -InstallRoot $InstallRoot }
    if ($configWrite.Outcome -eq "held") {
        $result.Unfinished = $true
        return $result
    }
    $result.Ok = $true
    return $result
}
