/************************************************************************************************
*************************************************************************************************
	SCRIPT:		Local/010-LocalSandbox.sql
	AUTHOR:		Scott Applefeld
	DATE:		November 23rd, 2026
	VERSION:	v1.0
*************************************************************************************************
	NOTES:		v1.0 - 11/23/2026 - SCOTT APPLEFELD
						The one sandbox of a database that serves one machine. The
						installer's local mode applies this script in place of
						Security/020-Logins.sql and Security/030-Sandboxes.sql, so the
						database holds one Windows account's login, its user kit_local
						in mem_publisher and one mem.Sandbox row, and no login, password
						or sandbox row of the provider's fleet.

						Two sqlcmd scripting variables arrive in the sqlcmd process's
						environment: KitLocalAccount, the Windows account in the form
						<computer or authority>\<name>, and KitLocalSandbox, the sandbox
						name. The installer screens both before any connection, so
						neither holds a quote or a bracket.

						The script is one batch. Its two guards run first and raise an
						error, before any write. The first refuses where mem.Sandbox
						holds a row with any other name or any other publisher login,
						compared under the database's collation, which the installer
						requires to be caseless. The second refuses where a database
						user named kit_local exists for any SID but the account's. So
						the mode never joins a database that already serves another
						sandbox or another publisher.

						The account must be a single Windows user. A Windows group's
						login would admit every member of the group as kit_local, so
						where the account's server principal is not of type U the
						script refuses, after dropping the login only where this run
						created it. A login that already existed is never dropped.

						Each step after the guards runs only where its object is
						absent, so a second run changes nothing. The database user is
						created for the login's name as sys.server_principals holds
						it, quoted through QUOTENAME, and the sandbox row's
						[PublisherLogin] is that same name, the form ORIGINAL_LOGIN()
						returns and mem.CallerSandbox() matches.
*************************************************************************************************
************************************************************************************************/

/************************************************************************************************
	SET PROCESSING VARIABLES TO SUPPRESS OUTPUT.
************************************************************************************************/
;SET NOCOUNT ON
;SET TRANSACTION ISOLATION LEVEL READ COMMITTED

/************************************************************************************************
	DECLARE VARIABLES FOR PROCESSING.
************************************************************************************************/
;DECLARE @Account			SYSNAME			= N'$(KitLocalAccount)'
		,@SandboxName		NVARCHAR(100)	= N'$(KitLocalSandbox)'
		,@AccountSid		VARBINARY(85)	= NULL
		,@LoginName			SYSNAME			= NULL
		,@LoginType			CHAR(1)			= NULL
		,@LoginCreated		BIT				= 0
		,@Sql				NVARCHAR(MAX)	= NULL

/* Take the account's SID, and the login's own name where the server holds one and the account as given where it does not. */
;SELECT	@AccountSid = SUSER_SID(@Account)

;SELECT	@LoginName = P.[name]
FROM	sys.server_principals P
WHERE	P.[sid] = @AccountSid

;SELECT	@LoginName = COALESCE(@LoginName, @Account)

/************************************************************************************************
	GUARDS: THIS DATABASE SERVES NO OTHER SANDBOX AND NO OTHER PUBLISHER.
************************************************************************************************/
;IF EXISTS ( SELECT NULL FROM mem.Sandbox S WHERE S.[Name] <> @SandboxName OR S.[PublisherLogin] <> @LoginName )
	THROW 50000, 'Local/010-LocalSandbox.sql: mem.Sandbox holds a row for another sandbox or another publisher login, so this database already serves another sandbox; nothing was changed.', 1

;IF EXISTS ( SELECT NULL FROM sys.database_principals D WHERE D.[name] = N'kit_local' AND ( D.[sid] IS NULL OR @AccountSid IS NULL OR D.[sid] <> @AccountSid ) )
	THROW 50000, 'Local/010-LocalSandbox.sql: the database user kit_local exists for a login other than the account, so this database already serves another publisher; nothing was changed.', 1

/************************************************************************************************
	SERVER LOGIN, MATCHED BY THE ACCOUNT'S SID.
************************************************************************************************/
;IF NOT EXISTS ( SELECT NULL FROM sys.server_principals P WHERE P.[sid] = @AccountSid )
BEGIN
	;CREATE LOGIN [$(KitLocalAccount)] FROM WINDOWS WITH DEFAULT_DATABASE = [master]
	;SELECT	@LoginCreated = 1
END

/* Read the login's name and type back as the server holds them. */
;SELECT	 @LoginName = P.[name]
		,@LoginType = P.[type]
FROM	sys.server_principals P
WHERE	P.[sid] = @AccountSid

/* A group's login admits every member of the group, so only a single Windows user publishes. */
;IF ( COALESCE(@LoginType, '') <> 'U' )
BEGIN
	;IF ( @LoginCreated = 1 AND @LoginType IS NOT NULL )
	BEGIN
		/* The name is the server's own, quoted, so the dynamic statement carries no other text. */
		;SELECT	@Sql = CONCAT(N'DROP LOGIN ', QUOTENAME(@LoginName))
		;EXECUTE sys.sp_executesql @Sql
	END

	;THROW 50000, 'Local/010-LocalSandbox.sql: the account''s server principal is not a single Windows user (type U), and a Windows group''s login would let every member of the group publish; no login of this run was kept and nothing else was changed.', 1
END

/************************************************************************************************
	DATABASE USER AND ROLE MEMBERSHIP.
************************************************************************************************/
;IF DATABASE_PRINCIPAL_ID('kit_local') IS NULL
BEGIN
	/* The login is named as the server holds it, quoted, so the dynamic statement carries no other text. */
	;SELECT	@Sql = CONCAT(N'CREATE USER [kit_local] FOR LOGIN ', QUOTENAME(@LoginName), N' WITH DEFAULT_SCHEMA = [mem]')
	;EXECUTE sys.sp_executesql @Sql
END

;IF COALESCE(IS_ROLEMEMBER('mem_publisher', 'kit_local'), 0) <> 1
	ALTER ROLE mem_publisher ADD MEMBER [kit_local]

/************************************************************************************************
	THE SANDBOX ROW.
************************************************************************************************/
;IF NOT EXISTS ( SELECT NULL FROM mem.Sandbox S WHERE S.[Name] = @SandboxName )
BEGIN
	;INSERT INTO mem.Sandbox ( [Name], [PublisherLogin] )
	SELECT	 [Name]				= @SandboxName
			,[PublisherLogin]	= @LoginName
END
GO
