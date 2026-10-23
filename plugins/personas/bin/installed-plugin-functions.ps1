# The installed-plugin pieces both launchers and both registration scripts share. Each of the four
# dot-sources this file from its own folder:
#
#   . "$PSScriptRoot\installed-plugin-functions.ps1"
#
# bin/Register-PersonaTasks.ps1 and bin/Register-OrphanSweepTask.ps1 read it from the plugin's bin
# folder, and with -LauncherRoot each copies it into the launcher root beside its launcher, where
# bin/Start-InstalledPersona.ps1 and bin/Start-InstalledOrphanSweep.ps1 read it at every task start.
# It is written to Windows PowerShell 5.1, since every task action runs the System32 powershell.exe.
# It defines a variable and a function and runs nothing else.

# The folders a plugin update replaces, written once: a plugins\marketplaces or plugins\cache
# segment pair under either separator, matched in a path that carries a segment after it, so a
# folder whose name merely starts with marketplaces or cache is no match. The registration scripts
# test the paths a task action would name against it.
$PluginInstallFolderPattern = '(?i)[\\/]plugins[\\/](marketplaces|cache)[\\/]'

<#
.SYNOPSIS
Returns the install path and version installed_plugins.json records for one plugin id.

.DESCRIPTION
The file maps each plugin id to an array of install records, one per scope. The user-scope record
is taken where there is one, since that is the scope a fleet machine installs the plugin at, and the
first record otherwise. The version becomes a folder name under
the persona launcher's runtime root, so it must start with a letter, digit, underscore or hyphen,
hold only those and dots after that, and not end in a dot, which Windows drops from a folder name. A
reserved device name (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9), with or without an extension,
is refused too. Every refusal is a throw, which each launcher catches, logs and exits 1 on.
#>
function Get-InstalledPluginRecord {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Id)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "installed plugin list '$Path' does not exist"
    }
    try {
        $parsed = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "installed plugin list '$Path' could not be read: $($_.Exception.Message)"
    }
    $property = $null
    if ($null -ne $parsed.plugins) { $property = $parsed.plugins.PSObject.Properties[$Id] }
    if ($null -eq $property) {
        throw "installed plugin list '$Path' has no record for '$Id'"
    }
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
