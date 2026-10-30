# The installed-plugin pieces the walker's launcher and its registration script share. Each of the two
# dot-sources this file from its own folder:
#
#   . "$PSScriptRoot\installed-plugin-functions.ps1"
#
# register-walk.ps1 reads it from the folder it runs in, and copies it into the launcher root beside
# Start-InstalledWikiWalk.ps1, which reads it at every task start. It defines a variable and a
# function and runs nothing else.

# The folders a plugin update replaces, written once: a plugins\marketplaces or plugins\cache segment
# pair under either separator, matched in a path that carries a segment after it, so a folder whose
# name merely starts with marketplaces or cache is no match. The registration script tests the
# launcher root a task action would name against it.
$PluginInstallFolderPattern = '(?i)[\\/]plugins[\\/](marketplaces|cache)[\\/]'

<#
.SYNOPSIS
Returns the install path and version installed_plugins.json records for one plugin id, or $null where
the file is absent or holds no record for the id.

.DESCRIPTION
The file maps each plugin id to an array of install records, one per scope. The user-scope record is
taken where there is one, and the first record otherwise. The version becomes a folder name under the
launcher's runtime root, so it must start with a letter, digit, underscore or hyphen, hold only those
and dots after that, and not end in a dot, which Windows drops from a folder name. A reserved device
name (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9), with or without an extension, is refused too.
A file that exists but cannot be read or parsed, a record with no install path and a version that
cannot name a folder are each a throw, which the launcher catches, logs and exits 1 on. An absent
file and a file with no record for the id return $null, which is the launcher's cue to run the walker
beside itself.
#>
function Get-InstalledPluginRecord {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Id)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $parsed = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "installed plugin list '$Path' could not be read: $($_.Exception.Message)"
    }
    $property = $null
    if ($null -ne $parsed -and $null -ne $parsed.plugins) { $property = $parsed.plugins.PSObject.Properties[$Id] }
    if ($null -eq $property) { return $null }
    $records = @($property.Value)
    $record = @($records | Where-Object { $_.scope -eq 'user' }) | Select-Object -First 1
    if ($null -eq $record) { $record = $records | Select-Object -First 1 }
    $installPath = [string]$record.installPath
    $version = [string]$record.version
    if ([string]::IsNullOrWhiteSpace($installPath)) {
        throw "the '$Id' record in '$Path' carries no installPath"
    }
    if ($version -notmatch '\A[A-Za-z0-9_-][A-Za-z0-9._-]*\z' -or $version.EndsWith('.') -or
        $version -match '\A(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?\z') {
        throw "the '$Id' record in '$Path' carries version '$version', which cannot name a folder"
    }
    return @{ InstallPath = $installPath; Version = $version; Scope = [string]$record.scope }
}
