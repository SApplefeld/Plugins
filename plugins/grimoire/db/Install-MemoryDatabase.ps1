#Requires -Version 7.0
# Installs or upgrades the shared memory index on a SQL Server host: the mem
# schema, its full-text catalog and index, every procedure, the three roles,
# the five logins and the sandbox rows. Re-runnable: every script under
# Schema, FullText, Procedures, Security and Version guards its own creation
# or is a repeatable ALTER, GRANT or DENY, so a second run against an
# installed host applies no change and says so on its own output.
#
# The script order is the directory order Schema, FullText, Procedures,
# Security, Version, and inside each directory the ordinal order of the file names,
# whose numeric prefixes are what fix it. Each script runs through sqlcmd
# with -b, so the first failing statement stops the whole run with a
# non-zero exit and the failing file named.
#
# What this installer never does. It never drops a table of its own accord
# and never alters a column type: a schema change of that shape is a new
# script under Schema, written to guard on the catalog, and never an edit to
# this file. A Schema script that drops a table names the table in its
# header and drops it only where a host still holds it. It refuses
# to run when mem.SchemaVersion already holds a version newer than the one it
# carries, because applying older scripts over a newer schema is how a column
# or a grant silently goes backward. And it never prints, logs or passes on a
# command line any password: the installing connection's password under SQL
# authentication is read from the SQLCMDPASSWORD environment variable and
# from nowhere else, and each generated login password reaches its CREATE
# LOGIN as a sqlcmd scripting variable set in the sqlcmd process's
# environment. Every connection asks for encryption (-N), so no password
# crosses the wire in the clear; -TrustServerCertificate adds -C for an
# instance whose certificate the client cannot validate.
#
# The five logins are created only where absent, each with a fresh random
# password. Those passwords are written once to the logins file, created
# exclusively and immediately before Security/020-Logins.sql runs, so a run
# that fails earlier leaves no file holding passwords that reached no server,
# and no login is ever created before its password is on disk. An existing
# file is never overwritten: a run that would need to create a login while
# the file exists stops before touching the server, and its refusal says
# which of the logins that file names are on the server and which are not.
# A login already on the server keeps its password, so a later run leaves
# both the logins and the file alone.
#
# Output is one line per fact, in the order the run reaches them: the server
# and authentication, the sqlcmd resolved, the database created or present,
# the schema version carried and installed, one Applied line per script
# reading changed or no change with the logins file line just before the
# logins script, one Login line per login reading created or present, and a
# Summary line with the two counts. A refusal is one line starting FAIL:
# naming the reason, then exit 1.
#
# The changed / no change reading is a digest of the catalog state this
# installer owns, taken before the run and after each script: the mem schema
# and every object in it; every column with its type, length, precision,
# nullability, collation, identity flag and computed definition; every module
# definition; every index with its key and included columns, ordering and
# filter; every check, default and foreign key definition; every mem_ and
# kit_ principal with its SID, default schema, role memberships and
# permissions; the five server logins with their SIDs, default databases and
# disabled flags; the full-text catalog and index with its columns; and the
# rows of mem.Sandbox and mem.SchemaVersion. Outside it: a login's password,
# which no catalog exposes; the audit timestamps; and the data rows of every
# table but those two. So a run that touched nothing reads as no change, and
# a password change alone reads as no change too.

[CmdletBinding(DefaultParameterSetName = 'WindowsAuth')]
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(ParameterSetName = 'WindowsAuth')][switch]$WindowsAuth,
    # The installing login's password is read from SQLCMDPASSWORD in this
    # process's environment and from nowhere else, so it never rides a command
    # line or a shell history; a run with -Login and no SQLCMDPASSWORD refuses
    # before sqlcmd is spawned rather than letting sqlcmd prompt and hang.
    [Parameter(ParameterSetName = 'SqlAuth', Mandatory = $true)][string]$Login,
    [string]$LoginsPath = (Join-Path $(if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }) ".claude\kit-memory-db-logins.json"),
    # Passes -C to sqlcmd, which accepts the server's certificate without
    # validating it. Needed against a local instance carrying a self-signed
    # certificate; never against the host, whose certificate is trusted.
    [switch]$TrustServerCertificate,
    # Where sqlcmd is. Resolved from the pinned client tools path and then
    # from PATH when absent.
    [string]$SqlcmdPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The schema version this installer carries. Schema/020-SchemaVersion.sql
# creates mem.SchemaVersion and Version/010-RecordSchemaVersion.sql writes the
# row, both reading this number through the KitSchemaVersion scripting
# variable. A host already holding a newer version refuses the run before any
# script is applied.
#
# Version 2 is where mem.Usage and mem.Outcome carry their stamp id column and
# its per-sandbox unique index, and where the two append procedures skip an id
# the caller's own rows already hold. The publisher reads this number back
# through mem.usp_Health and sends no queue row to a host below it, since an
# older host takes the same call and ignores the stamp id in it; the client's
# own REQUIRED_SCHEMA_VERSION in scripts/memory-database.js is the other half of
# that pair.
#
# Version 3 is where mem.usp_Search returns each row's [distance], the quantity
# the client applies its relevance floor to. A version 2 host answers the same
# search with no such field, and so does a version 3 host for a record only its
# full-text lists ranked, so the field's absence cannot tell the two apart: the
# client's own SEARCH_SCHEMA_VERSION reads this number back through
# mem.usp_Health and serves its own index instead below it, rather than printing
# a whole unfloored ranking as the shared one.
#
# Version 4 is where mem.usp_Nearest takes @p_IncludeArchived and projects each
# row's [archived] key, which the write-time neighbours check asks for so that a
# retired near-duplicate is counted rather than unseen. A lower host has no such
# parameter and refuses a call that names it, so the client's own
# NEAREST_ARCHIVED_SCHEMA_VERSION reads this number back through mem.usp_Health
# and stands that one caller down below it. A nearest call that does not ask
# names no such parameter and is served on any version.
#
# Version 5 is where mem.Outcome carries a judged fleet pointer's four columns,
# mem.usp_AppendOutcomes reads them out of its batch, and
# mem.usp_JevCalibration counts them for the publisher role. No client gates
# on it, so this version is installed before any machine runs a client that
# writes pointer rows: a lower host takes a pointer row and drops the four
# fields, since its procedure reads no such keys, and the drain then removes
# the row from the queue. A lower host also refuses `memq jev-calibration` with the
# server's own words naming the procedure it lacks.
#
# Version 6 is where mem.usp_Search takes @p_Segment and @p_Tag, which narrow
# the visible set to one project segment and to one tag before any candidate
# list ranks it, and never widen it. A lower host has no such parameters and
# refuses a call that names them. A search naming neither is served on any
# version that carries the procedure.
#
# Version 7 is where the database holds the record. mem.Store carries
# [ProjectKey] and a project's fleet-wide store; mem.Record carries the
# record fields in columns, [Origin] and the writing sandbox's stamp id;
# mem.udf_VisibleRecords serves every undeleted row to every mapped
# sandbox; mem.usp_Search takes @p_ProjectKey; mem.usp_PromoteRecord moves a
# record into the operator store; and mem.usp_PutRecord, mem.usp_GetRecord,
# mem.usp_ListIndex and mem.usp_ArchiveRecord exist. A version 6 host takes
# it in place: the columns are added, the shape check and one index are
# replaced, and every row stays. A version 6 client's calls keep their
# shape. A client gates its record writes and reads on this number, read
# back through mem.usp_Health, and sends none to a host below it.
#
# Version 8 is where the database keeps no read log and keeps usage as one
# flat row per memory. mem.usp_Search, mem.usp_Nearest, mem.usp_ListRecords
# and mem.usp_JevCalibration write no log row, and
# Schema/120-DropQueryLog.sql drops mem.QueryLog with its rows where a host
# holds it. mem.RecordUsage holds each memory's last read time, last applied
# time and count of distinct applied days, mem.usp_AppendUsage folds each
# batch of stamps into it, and a resent stamp changes nothing there with no
# stamp id stored. Schema/080-RecordUsage.sql seeds those rows from
# mem.Usage and drops it, in one transaction, where a host holds it. A
# version 7 host takes it in place. Every procedure keeps its parameters and
# its result, so no client gates on this number, and a client of either
# version works against a host of either version.
#
# Version 9 is where the database meters the persona module's turns.
# mem.TurnMeter holds one row per turn and mem.SessionBeat one row per
# session, written by mem.usp_AppendTurnMeter and mem.usp_PutSessionBeat and
# summed by day across every sandbox by mem.usp_ListDailyUsage. A version 8
# host takes it in place, creating the two tables and the three procedures
# and changing no other object, so every row stays. The client's
# METER_SCHEMA_VERSION reads this number back through mem.usp_Health, and
# `memq meter-drain` sends nothing to a host below it and leaves its meter folder as it is.
#
# Version 10 is where the database recalls candidate records for a prompt.
# mem.usp_Recall ranks the caller's visible records by a trigger match, full
# text and a vector pass, matching a glob trigger through
# mem.udf_TriggerGlobMatchesPath, and returns each with a head of its body. A
# version 9 host takes it in place, creating the procedure and the function
# and changing no other object, so every row stays.
# Schema/150-DropTriggerMatchesToken.sql drops mem.udf_TriggerMatchesToken
# where a host installed it, since the procedure no longer calls it. The client's
# RECALL_SCHEMA_VERSION reads this number back through mem.usp_Health, and
# `memq recall-candidates` sends no recall to a host below it.
$script:SchemaVersion = 10

# The five logins the Security scripts create, each with the role it joins
# and the sandbox it publishes for. The logins file carries these three
# facts beside each generated password.
$script:Logins = @(
    @{ Login = 'kit_scott_claude'; Role = 'mem_publisher'; Sandbox = 'SCOTT-CLAUDE' },
    @{ Login = 'kit_neo_claude';   Role = 'mem_publisher'; Sandbox = 'NEO-CLAUDE' },
    @{ Login = 'kit_asr_claude';   Role = 'mem_publisher'; Sandbox = 'ASR-CLAUDE' },
    @{ Login = 'kit_curator';      Role = 'mem_curator';   Sandbox = $null },
    @{ Login = 'kit_review';       Role = 'mem_review';    Sandbox = $null }
)

# The directories, in the order their scripts apply. Version is last and holds
# one script, the write of the mem.SchemaVersion row: a client reads that row to
# decide the host carries this version's columns and procedures, so it is true
# only after every other directory has applied.
$script:ScriptDirectories = @('Schema', 'FullText', 'Procedures', 'Security', 'Version')

$script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Which authentication the run uses, read once here because the parameter
# set name belongs to the script's own scope and not to the functions below.
$script:SqlAuth = ($PSCmdlet.ParameterSetName -eq 'SqlAuth')

# Every refusal takes this path: one FAIL: line, exit 1.
function Stop-Install {
    param([Parameter(Mandatory = $true)][string]$Reason)
    Write-Output ("FAIL: " + $Reason)
    exit 1
}

# The pinned client tools path first, then PATH, so a machine with the ODBC
# tools installed uses them even when its PATH does not say so.
function Resolve-Sqlcmd {
    param([string]$Requested)
    if ($Requested) {
        if (Test-Path -LiteralPath $Requested -PathType Leaf) { return $Requested }
        Stop-Install "no sqlcmd at the path given: $Requested"
    }
    $programFiles = $env:ProgramFiles
    if ($programFiles) {
        $pinned = Join-Path $programFiles "Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE"
        if (Test-Path -LiteralPath $pinned -PathType Leaf) { return $pinned }
    }
    $onPath = Get-Command sqlcmd -ErrorAction SilentlyContinue
    if ($null -ne $onPath) { return $onPath.Source }
    Stop-Install "sqlcmd was not found at the pinned client tools path nor on PATH; install the SQL Server command line tools or pass -SqlcmdPath."
}

# One sqlcmd batch against one database, from a file. Returns the exit code
# and every output line.
#
# This is the one place the installer spawns sqlcmd, and the child
# environment is set and restored here. Under SQL authentication the ambient
# SQLCMDPASSWORD is left for sqlcmd to read; under Windows authentication it
# is removed for the spawn, since the child has no use for it and a secret
# that is not needed is not passed on. Each entry of -Variables becomes a
# sqlcmd scripting variable of the same name, which sqlcmd reads from its
# environment and substitutes into $(Name) references in the batch; that is
# how KitSchemaVersion and every KitPassword_<login> reach the scripts
# without a -v argument, which would put the value on the command line. The
# finally block puts the environment back as it was, whatever sqlcmd did.
#
# -N asks for an encrypted connection on every spawn, whichever
# authentication is in use, so the CREATE LOGIN batches never carry a password
# across the wire in the clear; -C rides beside it only with
# -TrustServerCertificate. -b makes the first error the batch's exit code. -I
# turns QUOTED_IDENTIFIER on for the connection, which the full-text index and
# the procedures need. -x is deliberately absent: the scripts carry $(Name)
# references by design.
function Invoke-KitSqlcmd {
    param(
        [Parameter(Mandatory = $true)][string]$InputFile,
        [Parameter(Mandatory = $true)][string]$DatabaseName,
        [hashtable]$Variables
    )
    $arguments = @('-S', $Server, '-d', $DatabaseName, '-b', '-I', '-l', '15', '-N', '-i', $InputFile)
    if ($script:SqlAuth) { $arguments += @('-U', $Login) } else { $arguments += '-E' }
    if ($TrustServerCertificate) { $arguments += '-C' }

    $names = @()
    if ($Variables) { $names += @($Variables.Keys) }
    $saved = @{}
    foreach ($name in ($names + @('SQLCMDPASSWORD'))) {
        $existing = [System.Environment]::GetEnvironmentVariable($name, 'Process')
        if ($null -ne $existing) { $saved[$name] = $existing }
    }
    try {
        if (-not $script:SqlAuth) {
            [System.Environment]::SetEnvironmentVariable('SQLCMDPASSWORD', $null, 'Process')
        }
        foreach ($name in $names) {
            [System.Environment]::SetEnvironmentVariable($name, [string]$Variables[$name], 'Process')
        }
        $output = & $script:Sqlcmd @arguments 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        foreach ($name in ($names + @('SQLCMDPASSWORD'))) {
            [System.Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        foreach ($name in @($saved.Keys)) {
            [System.Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
    return @{ Code = $code; Output = @($output | ForEach-Object { [string]$_ }) }
}

# The same call over a batch held as text. The text is written to a temp file
# the call removes again, so every batch reaches sqlcmd the one way.
function Invoke-KitSqlText {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$DatabaseName
    )
    $file = Join-Path ([System.IO.Path]::GetTempPath()) ("kit-memory-db-" + [guid]::NewGuid().ToString() + ".sql")
    try {
        [System.IO.File]::WriteAllText($file, $Text, (New-Object System.Text.UTF8Encoding($false)))
        return Invoke-KitSqlcmd -InputFile $file -DatabaseName $DatabaseName
    }
    finally {
        Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    }
}

# The values of every output line carrying the tag, in order.
function Get-TaggedValues {
    param(
        [Parameter(Mandatory = $true)][string[]]$Lines,
        [Parameter(Mandatory = $true)][string]$Tag
    )
    $prefix = "kitmem-" + $Tag + "="
    $values = @($Lines | ForEach-Object { $_.Trim() } | Where-Object { $_.StartsWith($prefix) } | ForEach-Object { $_.Substring($prefix.Length) })
    # The leading comma keeps a one-element result an array on return, where
    # PowerShell would otherwise hand the caller the bare string.
    return ,$values
}

# A failed batch, named by what it was doing, with sqlcmd's own lines after
# the refusal so the cause is on the output rather than lost.
function Stop-OnBatchFailure {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Result,
        [Parameter(Mandatory = $true)][string]$What
    )
    if ($Result.Code -eq 0) { return }
    foreach ($line in $Result.Output) { if ($line.Trim() -ne '') { Write-Output ("  " + $line) } }
    Stop-Install ($What + " failed with sqlcmd exit " + $Result.Code + ".")
}

# The digest of everything this installer owns on the host. The reads of
# mem.Sandbox and mem.SchemaVersion go through sp_executesql because a plain
# batch binds every table name at compile time, and on a first run those two
# tables do not exist yet.
$script:DigestBatch = @'
;SET NOCOUNT ON
;DECLARE @D TABLE ( [K] NVARCHAR(1000) NOT NULL, [V] NVARCHAR(MAX) NULL )
;INSERT INTO @D ( [K], [V] )
SELECT	'schema:' + S.[name], CAST(S.[principal_id] AS VARCHAR(10))
FROM	sys.schemas S
WHERE	S.[name] = 'mem'
;INSERT INTO @D ( [K], [V] )
SELECT	'obj:' + S.[name] + '.' + O.[name], O.[type]
FROM	sys.objects O
		INNER JOIN sys.schemas S ON S.[schema_id] = O.[schema_id]
WHERE	S.[name] = 'mem'
;INSERT INTO @D ( [K], [V] )
SELECT	'col:' + OBJECT_SCHEMA_NAME(C.[object_id]) + '.' + OBJECT_NAME(C.[object_id]) + '.' + C.[name]
		,CONCAT(T.[name], ':', C.[max_length], ':', C.[precision], ':', C.[scale], ':', C.[is_nullable], ':', C.[column_id]
			, ':', C.[collation_name], ':', C.[is_identity], ':', C.[is_computed], ':', CC.[definition])
FROM	sys.columns C
		INNER JOIN sys.types T ON T.[user_type_id] = C.[user_type_id]
		LEFT JOIN sys.computed_columns CC ON CC.[object_id] = C.[object_id] AND CC.[column_id] = C.[column_id]
WHERE	OBJECT_SCHEMA_NAME(C.[object_id]) = 'mem'
;INSERT INTO @D ( [K], [V] )
SELECT	'mod:' + OBJECT_SCHEMA_NAME(M.[object_id]) + '.' + OBJECT_NAME(M.[object_id])
		,CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', M.[definition]), 2)
FROM	sys.sql_modules M
WHERE	OBJECT_SCHEMA_NAME(M.[object_id]) = 'mem'
;INSERT INTO @D ( [K], [V] )
SELECT	'idx:' + OBJECT_SCHEMA_NAME(I.[object_id]) + '.' + OBJECT_NAME(I.[object_id]) + '.' + I.[name]
		,CONCAT(I.[type], ':', I.[is_unique], ':', I.[is_primary_key], ':', I.[is_unique_constraint], ':', I.[filter_definition], ':',
			( SELECT STRING_AGG(CONCAT(COL_NAME(IC.[object_id], IC.[column_id]), ':', IC.[key_ordinal], ':', IC.[is_descending_key], ':', IC.[is_included_column]), ',')
					WITHIN GROUP ( ORDER BY IC.[index_column_id] )
			  FROM sys.index_columns IC WHERE IC.[object_id] = I.[object_id] AND IC.[index_id] = I.[index_id] ))
FROM	sys.indexes I
WHERE	OBJECT_SCHEMA_NAME(I.[object_id]) = 'mem' AND I.[name] IS NOT NULL
;INSERT INTO @D ( [K], [V] )
SELECT	'chk:' + OBJECT_SCHEMA_NAME(K.[parent_object_id]) + '.' + OBJECT_NAME(K.[parent_object_id]) + '.' + K.[name]
		,CONCAT(K.[is_disabled], ':', K.[definition])
FROM	sys.check_constraints K
WHERE	OBJECT_SCHEMA_NAME(K.[parent_object_id]) = 'mem'
;INSERT INTO @D ( [K], [V] )
SELECT	'def:' + OBJECT_SCHEMA_NAME(DC.[parent_object_id]) + '.' + OBJECT_NAME(DC.[parent_object_id]) + '.' + COL_NAME(DC.[parent_object_id], DC.[parent_column_id])
		,CONCAT(DC.[name], ':', DC.[definition])
FROM	sys.default_constraints DC
WHERE	OBJECT_SCHEMA_NAME(DC.[parent_object_id]) = 'mem'
;INSERT INTO @D ( [K], [V] )
SELECT	'fk:' + OBJECT_SCHEMA_NAME(FK.[parent_object_id]) + '.' + OBJECT_NAME(FK.[parent_object_id]) + '.' + FK.[name]
		,CONCAT(OBJECT_SCHEMA_NAME(FK.[referenced_object_id]), '.', OBJECT_NAME(FK.[referenced_object_id]), ':', FK.[delete_referential_action], ':', FK.[update_referential_action], ':', FK.[is_disabled], ':',
			( SELECT STRING_AGG(CONCAT(COL_NAME(FC.[parent_object_id], FC.[parent_column_id]), '>', COL_NAME(FC.[referenced_object_id], FC.[referenced_column_id])), ',')
					WITHIN GROUP ( ORDER BY FC.[constraint_column_id] )
			  FROM sys.foreign_key_columns FC WHERE FC.[constraint_object_id] = FK.[object_id] ))
FROM	sys.foreign_keys FK
WHERE	OBJECT_SCHEMA_NAME(FK.[parent_object_id]) = 'mem'
;INSERT INTO @D ( [K], [V] )
SELECT	'prin:' + P.[name], CONCAT(P.[type], ':', CONVERT(VARCHAR(128), P.[sid], 2), ':', P.[default_schema_name])
FROM	sys.database_principals P
WHERE	P.[name] LIKE 'mem[_]%' OR P.[name] LIKE 'kit[_]%'
;INSERT INTO @D ( [K], [V] )
SELECT	'member:' + R.[name] + '>' + M.[name], NULL
FROM	sys.database_role_members RM
		INNER JOIN sys.database_principals R ON R.[principal_id] = RM.[role_principal_id]
		INNER JOIN sys.database_principals M ON M.[principal_id] = RM.[member_principal_id]
WHERE	R.[name] LIKE 'mem[_]%'
;INSERT INTO @D ( [K], [V] )
SELECT	'perm:' + PR.[name] + ':' + P.[class_desc] + ':'
		+ CASE P.[class]
			WHEN 1 THEN OBJECT_SCHEMA_NAME(P.[major_id]) + '.' + OBJECT_NAME(P.[major_id])
			WHEN 3 THEN SCHEMA_NAME(P.[major_id])
			ELSE CAST(P.[major_id] AS VARCHAR(20))
		  END + ':' + P.[permission_name]
		,P.[state]
FROM	sys.database_permissions P
		INNER JOIN sys.database_principals PR ON PR.[principal_id] = P.[grantee_principal_id]
WHERE	PR.[name] LIKE 'mem[_]%' OR PR.[name] LIKE 'kit[_]%'
;INSERT INTO @D ( [K], [V] )
SELECT	'login:' + SP.[name], CONCAT(SP.[is_disabled], ':', CONVERT(VARCHAR(128), SP.[sid], 2), ':', SP.[default_database_name])
FROM	sys.server_principals SP
WHERE	SP.[name] IN ('kit_scott_claude', 'kit_neo_claude', 'kit_asr_claude', 'kit_curator', 'kit_review')
;INSERT INTO @D ( [K], [V] )
SELECT	'sperm:' + SP.[name] + ':' + P.[class_desc] + ':' + P.[permission_name], P.[state]
FROM	sys.server_permissions P
		INNER JOIN sys.server_principals SP ON SP.[principal_id] = P.[grantee_principal_id]
WHERE	SP.[name] IN ('kit_scott_claude', 'kit_neo_claude', 'kit_asr_claude', 'kit_curator', 'kit_review')
;INSERT INTO @D ( [K], [V] )
SELECT	'ftc:' + C.[name], CONCAT(C.[is_default], ':', C.[is_accent_sensitivity_on])
FROM	sys.fulltext_catalogs C
;INSERT INTO @D ( [K], [V] )
SELECT	'fti:' + OBJECT_SCHEMA_NAME(I.[object_id]) + '.' + OBJECT_NAME(I.[object_id]) + '.' + COL_NAME(IC.[object_id], IC.[column_id])
		,CONCAT(I.[change_tracking_state], ':', I.[is_enabled], ':', I.[fulltext_catalog_id], ':', I.[unique_index_id], ':', IC.[language_id])
FROM	sys.fulltext_indexes I
		INNER JOIN sys.fulltext_index_columns IC ON IC.[object_id] = I.[object_id]
WHERE	OBJECT_SCHEMA_NAME(I.[object_id]) = 'mem'
;IF OBJECT_ID('mem.Sandbox') IS NOT NULL
	INSERT INTO @D ( [K], [V] ) EXEC sp_executesql N'SELECT ''sandbox:'' + [Name], [PublisherLogin] FROM mem.Sandbox'
;IF OBJECT_ID('mem.SchemaVersion') IS NOT NULL
	INSERT INTO @D ( [K], [V] ) EXEC sp_executesql N'SELECT ''ver:'' + CAST([Version] AS VARCHAR(20)), [Notes] FROM mem.SchemaVersion'
;SELECT 'kitmem-digest=' + CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', COALESCE((
	SELECT STRING_AGG(CAST(CONCAT(D.[K], '=', D.[V]) AS NVARCHAR(MAX)), '|') WITHIN GROUP ( ORDER BY D.[K], D.[V] )
	FROM @D D ), N'')), 2)
'@

function Get-StateDigest {
    $result = Invoke-KitSqlText -Text $script:DigestBatch -DatabaseName $Database
    Stop-OnBatchFailure -Result $result -What "Reading the state digest"
    $values = Get-TaggedValues -Lines $result.Output -Tag 'digest'
    if ($values.Count -ne 1 -or $values[0].Length -ne 64) {
        Stop-Install "the state digest batch returned no digest line."
    }
    return $values[0]
}

# A 32-character password from the cryptographic generator: at least one of
# each class so CHECK_POLICY accepts it, drawn from an alphabet holding no
# quote, dollar, parenthesis or space, so it survives the T-SQL string it is
# substituted into and the environment it travels through. Each draw rejects
# values above the largest whole multiple of the set size, so no character is
# favoured.
function New-KitPassword {
    $classes = @(
        'ABCDEFGHJKLMNPQRSTUVWXYZ',
        'abcdefghijkmnopqrstuvwxyz',
        '23456789',
        '!#%+-.:=?@^_~'
    )
    $all = -join $classes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $draw = {
        param([string]$set)
        $bytes = New-Object byte[] 4
        $limit = [uint32]([uint32]::MaxValue - ([uint32]::MaxValue % [uint32]$set.Length))
        do {
            $rng.GetBytes($bytes)
            $value = [System.BitConverter]::ToUInt32($bytes, 0)
        } while ($value -ge $limit)
        return $set[[int]($value % [uint32]$set.Length)]
    }
    $chars = New-Object System.Collections.Generic.List[char]
    foreach ($class in $classes) { $chars.Add((& $draw $class)) }
    while ($chars.Count -lt 32) { $chars.Add((& $draw $all)) }
    # Fisher-Yates over the list, so the forced classes sit anywhere.
    for ($i = $chars.Count - 1; $i -gt 0; $i--) {
        $bytes = New-Object byte[] 4
        $rng.GetBytes($bytes)
        $j = [int]([System.BitConverter]::ToUInt32($bytes, 0) % [uint32]($i + 1))
        $swap = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $swap
    }
    $rng.Dispose()
    return -join $chars.ToArray()
}

# The logins file, created exclusively. CreateNew fails when the file exists,
# which is the contract: this installer never overwrites a file that may be
# the only record of a password.
function Write-LoginsFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object[]]$Entries
    )
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $document = [ordered]@{
        server   = $Server
        database = $Database
        created  = [DateTime]::UtcNow.ToString('o')
        logins   = @($Entries | ForEach-Object {
            [ordered]@{ login = $_.Login; password = $_.Password; role = $_.Role; sandbox = $_.Sandbox }
        })
    }
    $json = ($document | ConvertTo-Json -Depth 4)
    $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding($false)))
        try { $writer.Write($json); $writer.Write("`n") }
        finally { $writer.Dispose() }
    }
    finally { $stream.Dispose() }
}

# The database name is the one value this installer interpolates into T-SQL,
# so it is screened to a plain identifier before anything runs.
if ($Database -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    Stop-Install "the database name must be a plain identifier (letters, digits and underscores, not starting with a digit): $Database"
}

# SQL authentication with no password source would leave sqlcmd prompting on
# stdin, which is a hang in any unattended run, so it is refused here.
if ($script:SqlAuth -and -not [System.Environment]::GetEnvironmentVariable('SQLCMDPASSWORD', 'Process')) {
    Stop-Install "SQL authentication as $Login needs the password in the SQLCMDPASSWORD environment variable, which is empty; this installer takes no password on its command line."
}

$script:Sqlcmd = Resolve-Sqlcmd -Requested $SqlcmdPath

$authentication = if ($script:SqlAuth) { "SQL authentication as $Login" } else { "Windows authentication" }
Write-Output ("Server: " + $Server + " (" + $authentication + ")")
Write-Output ("sqlcmd: " + $script:Sqlcmd)

# The host: full-text installed, the engine new enough to hold a VECTOR
# column, and the database created where absent.
$hostBatch = @"
;SET NOCOUNT ON
;SELECT 'kitmem-fulltext=' + CAST(COALESCE(FULLTEXTSERVICEPROPERTY('IsFullTextInstalled'), 0) AS VARCHAR(10))
;SELECT 'kitmem-major=' + CAST(SERVERPROPERTY('ProductMajorVersion') AS VARCHAR(10))
;SELECT 'kitmem-database=' + CASE WHEN DB_ID(N'$Database') IS NULL THEN 'absent' ELSE 'present' END
"@
$hostResult = Invoke-KitSqlText -Text $hostBatch -DatabaseName 'master'
Stop-OnBatchFailure -Result $hostResult -What "Connecting to $Server"
$fullText = Get-TaggedValues -Lines $hostResult.Output -Tag 'fulltext'
$major = Get-TaggedValues -Lines $hostResult.Output -Tag 'major'
$databaseState = Get-TaggedValues -Lines $hostResult.Output -Tag 'database'
if ($fullText.Count -ne 1 -or $major.Count -ne 1 -or $databaseState.Count -ne 1) {
    Stop-Install "the host batch did not answer every question it was asked."
}
if ($fullText[0] -ne '1') {
    Stop-Install "full-text search is not installed on $Server, and mem.Record's full-text index needs it."
}
if ([int]$major[0] -lt 17) {
    Stop-Install "SQL Server major version $($major[0]) on $Server is older than the 17 (SQL Server 2025) the VECTOR column type needs."
}
Write-Output ("Full-text: installed")

if ($databaseState[0] -eq 'absent') {
    $createResult = Invoke-KitSqlText -Text ";CREATE DATABASE [$Database]" -DatabaseName 'master'
    Stop-OnBatchFailure -Result $createResult -What "Creating database $Database"
    Write-Output ("Database " + $Database + ": created")
}
else {
    Write-Output ("Database " + $Database + ": present")
}

# The version gate. A host holding a newer schema than this installer carries
# refuses before any script runs.
$versionBatch = @'
;SET NOCOUNT ON
;IF OBJECT_ID('mem.SchemaVersion') IS NULL
	SELECT 'kitmem-schemaversion=none'
ELSE
	EXEC sp_executesql N'SELECT ''kitmem-schemaversion='' + CAST(COALESCE(MAX([Version]), 0) AS VARCHAR(20)) FROM mem.SchemaVersion'
'@
$versionResult = Invoke-KitSqlText -Text $versionBatch -DatabaseName $Database
Stop-OnBatchFailure -Result $versionResult -What "Reading mem.SchemaVersion"
$installedVersion = Get-TaggedValues -Lines $versionResult.Output -Tag 'schemaversion'
if ($installedVersion.Count -ne 1) { Stop-Install "the schema version batch returned no version line." }
$installedText = $installedVersion[0]
if ($installedText -ne 'none') {
    $installedNumber = 0
    if (-not [int]::TryParse($installedText, [ref]$installedNumber)) {
        Stop-Install "mem.SchemaVersion holds a version this installer cannot read: $installedText"
    }
    if ($installedNumber -gt $script:SchemaVersion) {
        Stop-Install ("mem.SchemaVersion holds version " + $installedNumber + ", newer than the version " + $script:SchemaVersion + " this installer carries; applying older scripts over a newer schema is refused.")
    }
}
Write-Output ("Schema version: carried " + $script:SchemaVersion + ", installed " + $installedText)

# Which of the five logins the host already holds. Missing ones get a fresh
# password each, held in memory until the logins file is written immediately
# before the logins script runs.
$loginNames = @($script:Logins | ForEach-Object { $_.Login })
$loginBatch = ";SET NOCOUNT ON`n;SELECT 'kitmem-login=' + SP.[name] FROM sys.server_principals SP WHERE SP.[name] IN (" +
    (($loginNames | ForEach-Object { "N'" + $_ + "'" }) -join ', ') + ")"
$loginResult = Invoke-KitSqlText -Text $loginBatch -DatabaseName 'master'
Stop-OnBatchFailure -Result $loginResult -What "Reading the server logins"
$presentLogins = Get-TaggedValues -Lines $loginResult.Output -Tag 'login'
$missing = @($script:Logins | Where-Object { $presentLogins -notcontains $_.Login })

$variables = @{ KitSchemaVersion = [string]$script:SchemaVersion }
foreach ($entry in $script:Logins) {
    # A present login's CREATE branch never runs. Its variable carries this
    # placeholder, which Security/020-Logins.sql compares against and refuses
    # to create a login with, so a login dropped between the read above and
    # that script fails the run rather than being created with a public value.
    $variables['KitPassword_' + $entry.Login] = 'unused-login-already-present'
}
$entries = @()
if ($missing.Count -gt 0) {
    if (Test-Path -LiteralPath $LoginsPath) {
        # The refusal says what the existing file's passwords are worth: a
        # login it names that is on the server may hold that password, one
        # that is not never received it.
        $missingNames = (($missing | ForEach-Object { $_.Login }) -join ', ')
        $verb = if ($missing.Count -eq 1) { "is" } else { "are" }
        $fileReport = ''
        try {
            $existing = Get-Content -LiteralPath $LoginsPath -Raw | ConvertFrom-Json
            $named = @($existing.logins | ForEach-Object { [string]$_.login } | Where-Object { $_ })
            if ($named.Count -eq 0) { throw "it names no logins" }
            $onServer = @($named | Where-Object { $presentLogins -contains $_ })
            $offServer = @($named | Where-Object { $presentLogins -notcontains $_ })
            $fileReport = " Of the logins that file names, " +
                $(if ($onServer.Count -gt 0) { ($onServer -join ', ') + " are on the server, so their passwords there may be live" } else { "none is on the server" }) +
                $(if ($offServer.Count -gt 0) { ", and " + ($offServer -join ', ') + " are not, so their passwords there reached no server." } else { "." })
        }
        catch {
            $fileReport = " That file could not be read as a logins file (" + $_.Exception.Message + "), so whether its passwords reached the server is unknown."
        }
        Stop-Install ($missingNames + " " + $verb + " absent from " + $Server + " and the logins file " + $LoginsPath +
            " already exists; this installer never overwrites a logins file." + $fileReport + " Move it aside and run again.")
    }
    foreach ($entry in $missing) {
        $generated = New-KitPassword
        $variables['KitPassword_' + $entry.Login] = $generated
        $entries += @{ Login = $entry.Login; Password = $generated; Role = $entry.Role; Sandbox = $entry.Sandbox }
    }
}

# The scripts, in order, each followed by a digest read. The logins file is
# written just before the logins script, the first script that reads a
# generated password, so an earlier failure leaves no file behind.
$loginsScript = 'Security/020-Logins.sql'
$loginsFileWritten = $false
$applied = 0
$changed = 0
$digest = Get-StateDigest
foreach ($directoryName in $script:ScriptDirectories) {
    $directory = Join-Path $script:Root $directoryName
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        Stop-Install "the script directory $directory is missing."
    }
    $files = @(Get-ChildItem -LiteralPath $directory -File -Filter '*.sql' | ForEach-Object { $_.Name })
    [Array]::Sort($files, [System.StringComparer]::Ordinal)
    foreach ($fileName in $files) {
        $label = $directoryName + "/" + $fileName
        if ($label -eq $loginsScript) {
            if ($entries.Count -gt 0) {
                try { Write-LoginsFile -Path $LoginsPath -Entries $entries }
                catch { Stop-Install ("the logins file could not be written at " + $LoginsPath + ": " + $_.Exception.Message) }
                Write-Output ("Logins file: written " + $LoginsPath + " (" + $entries.Count + " login(s))")
            }
            else {
                Write-Output ("Logins file: not written (every login present)")
            }
            $loginsFileWritten = $true
        }
        $result = Invoke-KitSqlcmd -InputFile (Join-Path $directory $fileName) -DatabaseName $Database -Variables $variables
        Stop-OnBatchFailure -Result $result -What ("Applying " + $label)
        $applied += 1
        $after = Get-StateDigest
        if ($after -ne $digest) {
            $changed += 1
            Write-Output ("Applied " + $label + ": changed")
        }
        else {
            Write-Output ("Applied " + $label + ": no change")
        }
        $digest = $after
    }
}
if (-not $loginsFileWritten) {
    Stop-Install ("the scripts hold no " + $loginsScript + ", so the logins were never created; the tree is incomplete.")
}

# The logins as the host now holds them.
$verifyResult = Invoke-KitSqlText -Text $loginBatch -DatabaseName 'master'
Stop-OnBatchFailure -Result $verifyResult -What "Verifying the server logins"
$nowPresent = Get-TaggedValues -Lines $verifyResult.Output -Tag 'login'
foreach ($entry in $script:Logins) {
    if ($nowPresent -notcontains $entry.Login) {
        Stop-Install ("login " + $entry.Login + " is still absent after Security/020-Logins.sql ran.")
    }
    $state = if ($presentLogins -contains $entry.Login) { "present" } else { "created" }
    Write-Output ("Login " + $entry.Login + ": " + $state)
}

Write-Output ("Summary: " + $applied + " script(s) applied, " + $changed + " changed")
exit 0
