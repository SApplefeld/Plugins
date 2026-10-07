# The one sanitizer every kit PowerShell surface prints foreign text through.
#
# Dot-sourced by doctor.ps1, by the memory database host probe beside the
# installer, and by install-memory-sync.ps1, so every script whose lines the
# doctor prints under its own steps sanitizes them one way. A second copy
# would be one edit away from a cap or a character class the other side does
# not keep.
#
# The cap is the caller's, per channel, because a truncated string is only
# acceptable where nothing compares it: the doctor spends 120 on a line of its
# own report and 200 on a value it quotes, and the probe spends 200 on a check
# line. It is mandatory so a call site states the width it prints at rather
# than inheriting one written for another surface.

function Get-SanitizedLine {
    param(
        [string]$Value,
        [Parameter(Mandatory = $true)][int]$MaxLength
    )
    # Strings this script did not author (a path read from a settings file, a
    # server version string, a model id, an error message off the wire) are
    # stripped to printable ASCII and length-bounded before reaching this trusted
    # output channel, so a hostile file or a hostile answer cannot smuggle escape
    # sequences past a reader's eyes or emit unbounded output. It does not make
    # the text safe to obey: bounded printable ASCII still carries a sentence, so
    # treat what it returns as data. Matches the hooks' own sanitize-before-print
    # convention, with the cap per channel because a truncated string is only
    # acceptable where nothing compares it. Truncation is always visible: a
    # silently cut line would let two values that share a prefix print
    # identically, and a reader comparing what is printed would read them as
    # equal.
    $clean = [string]$Value -replace '[^\x20-\x7E]', ''
    if ($clean.Length -gt $MaxLength) {
        $dropped = $clean.Length - $MaxLength
        $clean = $clean.Substring(0, $MaxLength) + "... [+" + $dropped + " more chars]"
    }
    return $clean
}

function Get-RedactedRemote {
    param(
        [string]$Value
    )
    # A store's remote can carry a credential in the URL itself: a personal
    # access token sits either as the whole userinfo (`https://TOKEN@host/...`)
    # or after a colon in it (`https://user:TOKEN@host/...`), and both forms
    # would otherwise ride straight into the report. This strips the whole
    # userinfo from any `scheme://` URL's authority, whatever scheme it names,
    # before the value ever reaches Get-SanitizedLine, whose character
    # stripping and length cap do not touch URL structure. It redacts the
    # userinfo position only; a credential elsewhere in the URL, such as a
    # query string, is not redacted. An scp-style remote
    # (`git@host:owner/repo.git`) has no `://` and so is never matched as a
    # URL at all; a URL already free of userinfo, a local path and any
    # non-URL value all pass through unchanged because there is nothing at
    # that position to drop.
    if ($Value -match '^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*)://(?<authority>[^/]*)(?<rest>/.*)?$') {
        $authority = $Matches.authority
        $at = $authority.LastIndexOf('@')
        if ($at -ge 0) {
            return $Matches.scheme + "://" + $authority.Substring($at + 1) + $Matches.rest
        }
    }
    return $Value
}
