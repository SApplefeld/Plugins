# SessionStart command hook. Reads the hook payload from stdin, adds the same three identity
# headers described in broker/intake.ts, and posts it to the broker.
#
# Exits zero and silently no matter what: a broker that is down, refuses the connection, times out,
# or answers a non-2xx status must never block session startup. A broker that never answers delays it
# by the two request timeouts below, and Claude Code's own time limit on the hook is the outer bound.
# An `http` hook is non-blocking by design (documented as such); this script is what gives the
# `command` hook the same property, because SessionStart cannot be an `http` hook (it does not
# deliver over that transport, per the broker's SessionStart/http probe). session-start.test.ts
# holds both halves of that property.
#
# A request that times out is tried once more, and only a timeout is. A timeout means a broker that
# is up but slow, often because many sessions start at once, and a repeated announcement is a
# refresh, so a second attempt is safe and usually lands. A refused connection means no broker is
# listening, a non-2xx status means the broker heard and said no, and either would fail the same way
# again, so retrying them would only charge every start for nothing. The two timeouts below add up
# to six seconds, which with PowerShell startup stays inside the test ceiling.
# The first is three seconds because a refused loopback connect on Windows surfaces at about two
# seconds (measured 2.0 to 2.1 seconds, since the OS retries the connect). A two-second first timeout
# would race that and read a dead broker as a timeout, then retry it. If a host shows a refusal past
# three seconds, the first timeout and the retry timeout move together, keeping their sum at six.
#
# Each failed attempt, and a success that followed one, appends a line to session-start.log in the
# broker's state folder (%LOCALAPPDATA%\sapplefeld-channels): the time, the session name or `none`,
# the attempt number and the failure class. A line never carries the process token or any byte of the
# request body. The append is best effort and cannot change the announcement or the exit code.
#
# An announcement no attempt delivered is spooled: written to announce\<hash>.announce under the same
# state folder, where <hash> is the SHA-256 hex of the process token, so neither the name nor the
# content carries the token. The broker takes the file in when this session's relay pipe attaches
# under the token (broker/announce-spool.ts), through the same parse and refusals a posted
# SessionStart takes, so a session that started while the broker was down is registered, lineage
# intact, once the broker is back. A `startup` announcement never replaces a file already under
# its token, since a second startup under one token is a subprocess the broker would decline; any
# other source replaces it. The spool is best effort on the same terms as the log line.
#
# CHANNEL_PROCESS_TOKEN and CHANNEL_SESSION come from this process's own environment, inherited from
# the launch wrapper (wrapper/Enter-ClaudeSession.ps1), not from the hook payload.
#
# hooks/settings-fragment.json belongs in the user-level settings file, so this hook runs for every
# Claude Code session on the machine, including ones started without the wrapper. Those have no
# process token, are not being watched, and exit below without opening a socket.

$ProgressPreference = 'SilentlyContinue'

# The port is a literal rather than an environment override on purpose. Every `http` hook in
# hooks/settings-fragment.json carries its port inside a URL that no environment variable can move,
# so an override honored here and nowhere else produces the worst reachable state: the session
# announces itself, then never sends another event, and the broker's sweep marks a working session
# stale. One literal, pinned against broker/config.ts's DEFAULT_PORT and every http hook URL in the
# fragment by settings-fragment.test.ts, means all three move together or the gate fails.
$brokerPort = 8787

# Request timeouts in seconds for the first attempt and for the one retry after a timeout. Their sum
# is the hook's whole request budget, and session-start.test.ts reads both from this file.
$firstAttemptTimeoutSec = 3
$retryAttemptTimeoutSec = 3

# Appends one line to session-start.log. Its own try with an empty catch: a missing state folder or a
# failed write must change nothing about the announcement or the exit. Nothing here writes to stdout.
#
# The lines matter most when many sessions start at once and several hooks fail in the same moment,
# so the file is opened for shared writing rather than through Add-Content, which shuts out a second
# writer and makes it throw. The stream asks for the AppendData right alone, so Windows places every
# write at the current end of the file, and two hooks appending together cannot overwrite each
# other. Plain write access would not do that: an Append open seeks to the end once, when it opens,
# so two hooks that opened before either wrote would both write at that one offset. A line under
# the stream's 4,096-byte buffer leaves in one write, so it is never split, and the session label is
# cut to 64 characters below so every line stays far under it. This FileStream overload is .NET
# Framework's, which is what Windows PowerShell 5.1 runs on, and hooks/settings-fragment.json
# launches the hook with `powershell`, which is 5.1.
function Write-AnnounceLog([string]$sessionLabel, [string]$detail) {
    try {
        $line = '{0} {1} {2}' -f [DateTime]::UtcNow.ToString('o'), $sessionLabel, $detail
        $logPath = Join-Path (Join-Path $env:LOCALAPPDATA 'sapplefeld-channels') 'session-start.log'
        $stream = $null
        $writer = $null
        try {
            $stream = New-Object System.IO.FileStream(
                $logPath,
                [System.IO.FileMode]::Append,
                [System.Security.AccessControl.FileSystemRights]::AppendData,
                [System.IO.FileShare]::ReadWrite,
                4096,
                [System.IO.FileOptions]::None)
            $writer = New-Object System.IO.StreamWriter($stream, [System.Text.Encoding]::ASCII)
            $writer.WriteLine($line)
        } finally {
            if ($writer) { $writer.Dispose() } elseif ($stream) { $stream.Dispose() }
        }
    } catch { }
}

# The `source` the hook payload carries, or $null where the body is not a JSON object holding a
# string under that exact key. The bytes are decoded only to read this one field; the announcement
# is still the bytes themselves. ConvertFrom-Json under Windows PowerShell 5.1 throws on a body
# that is not JSON and returns an array or a scalar for a body that is not an object, so the parse
# sits in its own try and the result is type-checked before a property is read. The key is matched
# case-sensitively, as the broker reads it.
function Get-AnnounceSource([byte[]]$body) {
    try {
        $parsed = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
        if (-not ($parsed -is [System.Management.Automation.PSCustomObject])) { return $null }
        foreach ($property in $parsed.PSObject.Properties) {
            if ($property.Name -ceq 'source' -and $property.Value -is [string]) { return $property.Value }
        }
        return $null
    } catch {
        return $null
    }
}

# Writes the announcement the loop below could not deliver, for the broker to take in at the relay
# pipe's attach. The file holds the identity headers the broker reads from a SessionStart, minus
# the process token, each line ending in a line feed, then one empty line, then the stdin bytes
# verbatim; the content-type header is transport and is not written. The write lands in <hash>.tmp
# and is renamed over <hash>.announce, so a reader never sees a partial file. The folder is created
# only under a state root that already exists, inheriting the root's hardened ACL, so this never
# creates a root the installer has not hardened.
#
# An existing <hash>.announce is kept, and nothing is written, when this announcement's `source` is
# `startup`. The token is minted per launch, so a second startup under one token is a `claude`
# subprocess that inherited it, and the broker's live route declines such a start so the parent
# stays registered (subprocessStart in broker/registry.ts); the spool keeps the parent's file the
# same way, since the broker takes in one file per token. Any other source, such as a resume, and a
# body whose source cannot be read, replace the file, as a non-startup announcement supersedes the
# record on the live route. The decision is made before the temporary file is written, so a kept
# file leaves no .tmp beside it.
#
# Returns 'spooled' when this announcement is in place, 'kept' when an earlier startup's file was
# left in place, and $null, with nothing written, on any other path. Its own try with an empty
# catch, on the log line's terms: a missing root, a locked file or a full disk changes nothing about
# the exit code or stdout.
function Write-AnnounceSpool([hashtable]$headers, [byte[]]$body) {
    try {
        $stateRoot = Join-Path $env:LOCALAPPDATA 'sapplefeld-channels'
        if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) { return $null }
        $folder = Join-Path $stateRoot 'announce'
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
            New-Item -ItemType Directory -Path $folder | Out-Null
        }
        # The hash is over the token's UTF-8 bytes, lowercase hex, which is how the broker derives
        # the name it reads (crypto.createHash("sha256") over the same string).
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($env:CHANNEL_PROCESS_TOKEN))
        } finally {
            $sha.Dispose()
        }
        $hash = [System.BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()
        $announce = Join-Path $folder "$hash.announce"
        if ((Get-AnnounceSource $body) -eq 'startup' -and (Test-Path -LiteralPath $announce -PathType Leaf)) {
            return 'kept'
        }
        # The header block, in a fixed order and ASCII, since every value passed the ASCII gate.
        $block = "X-Channel-Hook-Event: $($headers['X-Channel-Hook-Event'])`n"
        if ($headers.ContainsKey('X-Channel-Session-Name')) {
            $block += "X-Channel-Session-Name: $($headers['X-Channel-Session-Name'])`n"
        }
        if ($headers.ContainsKey('X-Channel-Lineage')) {
            $block += "X-Channel-Lineage: $($headers['X-Channel-Lineage'])`n"
        }
        $block += "`n"
        $head = [System.Text.Encoding]::ASCII.GetBytes($block)
        $bytes = New-Object byte[] ($head.Length + $body.Length)
        [Array]::Copy($head, 0, $bytes, 0, $head.Length)
        [Array]::Copy($body, 0, $bytes, $head.Length, $body.Length)
        $temporary = Join-Path $folder "$hash.tmp"
        [System.IO.File]::WriteAllBytes($temporary, $bytes)
        Move-Item -LiteralPath $temporary -Destination $announce -Force
        return 'spooled'
    } catch {
        return $null
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($env:CHANNEL_PROCESS_TOKEN)) { exit 0 }

    # Read stdin as bytes and post them unchanged. Windows PowerShell 5.1 decodes redirected stdin
    # with the console codepage (IBM437 on this fleet) and re-encodes a string body as Latin-1, so
    # round-tripping the payload through a [string] corrupts every non-ASCII byte in it. The payload
    # carries `cwd` and `transcript_path`, which can hold non-ASCII, so this is the difference
    # between forwarding the hook payload and forwarding a mangled copy of it.
    $buffer = New-Object System.IO.MemoryStream
    ([Console]::OpenStandardInput()).CopyTo($buffer)
    $body = $buffer.ToArray()
    if ($body.Length -eq 0) { exit 0 }

    $headers = @{
        'X-Channel-Hook-Event'    = 'SessionStart'
        'X-Channel-Process-Token' = $env:CHANNEL_PROCESS_TOKEN
    }
    # Only ASCII reaches a header value. Invoke-RestMethod rejects a non-ASCII one client-side,
    # before opening the socket, and that throw would land in the catch below and take the whole
    # announcement with it: the session would never reach the registry and nothing would say so.
    # The wrapper validates -Name to keep this unreachable; this is the second line, and it drops
    # only the name rather than the announcement.
    # \z, not $: in .NET a $ also matches before a final newline, which would let a name ending in
    # one through to the log line and split it there.
    $sessionLabel = 'none'
    if ($env:CHANNEL_SESSION -match '^[\x20-\x7E]+\z') {
        $headers['X-Channel-Session-Name'] = $env:CHANNEL_SESSION
        # The log line takes the label cut to 64 characters, so no launcher's name can make a line
        # long enough to leave the stream in two writes. The header keeps the whole name.
        $sessionLabel = $env:CHANNEL_SESSION
        if ($sessionLabel.Length -gt 64) { $sessionLabel = $sessionLabel.Substring(0, 64) }
    }
    # CHANNEL_LINEAGE, same ASCII gate as CHANNEL_SESSION above and absent from every launch that
    # does not opt in (the wrapper never sets it; agent_persona's supervisor is the one launcher
    # that does, once per supervisor lifetime, not per child). Carries a session's restart identity
    # across a brand-new session ID, which is the one thing CHANNEL_SESSION and CHANNEL_PROCESS_TOKEN
    # (a fresh GUID every launch) cannot do.
    if ($env:CHANNEL_LINEAGE -match '^[\x20-\x7E]+\z') {
        $headers['X-Channel-Lineage'] = $env:CHANNEL_LINEAGE
    }

    $announced = $false
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $timeoutSec = if ($attempt -eq 1) { $firstAttemptTimeoutSec } else { $retryAttemptTimeoutSec }
        try {
            Invoke-RestMethod `
                -Uri "http://127.0.0.1:$brokerPort/hook" `
                -Method Post `
                -Headers $headers `
                -ContentType 'application/json; charset=utf-8' `
                -Body $body `
                -TimeoutSec $timeoutSec | Out-Null
            $announced = $true
            if ($attempt -gt 1) { Write-AnnounceLog $sessionLabel "announced on attempt $attempt" }
            break
        } catch {
            $failure = $_.Exception
            $class = 'error'
            if ($failure -is [System.Net.WebException]) {
                if ($failure.Status -eq [System.Net.WebExceptionStatus]::Timeout) {
                    $class = 'timeout'
                } elseif ($failure.Status -eq [System.Net.WebExceptionStatus]::ConnectFailure) {
                    $class = 'refused'
                } elseif ($failure.Status -eq [System.Net.WebExceptionStatus]::ProtocolError -and $failure.Response) {
                    $class = 'status ' + [int]$failure.Response.StatusCode
                }
            }
            Write-AnnounceLog $sessionLabel "attempt $attempt $class"
            if ($class -ne 'timeout') { break }
        }
    }
    # Every class but a timeout ends the loop after one attempt, and a timeout ends it after two,
    # so the loop ending with nothing announced is exactly the refused, non-2xx, errored and
    # twice-timed-out cases: the ones the broker never heard. The spool is the one place that
    # announcement survives, and the log line says it is there, or that an earlier startup's
    # announcement under this token was kept instead, so this run was a subprocess.
    if (-not $announced) {
        $spooled = Write-AnnounceSpool $headers $body
        if ($spooled -eq 'spooled') {
            Write-AnnounceLog $sessionLabel 'announcement spooled'
        } elseif ($spooled -eq 'kept') {
            Write-AnnounceLog $sessionLabel 'earlier announcement kept'
        }
    }
} catch {
    # Malformed stdin or any other throw outside the request lands here and is swallowed. Silent and
    # non-blocking is the entire point of this hook. Nothing is written to stdout in any path,
    # because a SessionStart hook's stdout is injected into the session's context, so a diagnostic
    # here would become model input on every launch.
}

exit 0
