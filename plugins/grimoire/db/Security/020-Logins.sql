/************************************************************************************************
*************************************************************************************************
	SCRIPT:		Security/020-Logins.sql
	AUTHOR:		Scott Applefeld
	DATE:		September 17th, 2026
	VERSION:	v1.0
*************************************************************************************************
	NOTES:		v1.0 - 09/17/2026 - SCOTT APPLEFELD
						The five SQL logins of the shared memory index, their database
						users, and their role memberships. One publisher login per sandbox
						(kit_scott_claude, kit_neo_claude, kit_asr_claude), one curator
						(kit_curator) and one reviewer (kit_review).

						Each password arrives as a sqlcmd scripting variable named
						KitPassword_<login>, which the installer sets in the sqlcmd
						process's environment and never on a command line. A login already
						on the server is left exactly as it is: its password is not touched,
						and the variable the installer passes for it is the placeholder
						unused-login-already-present, which the CREATE branch refuses, so
						a login that vanished between the installer's presence read and
						this script is never created with that public value. Nothing here
						ever prints a password.

						CHECK_EXPIRATION is off because no one is at a keyboard to rotate
						a publisher's password when it expires; the installer generates a
						32-character random password and the operator rotates it with
						ALTER LOGIN when they choose to.
*************************************************************************************************
************************************************************************************************/

/************************************************************************************************
	SERVER LOGINS. A LOGIN ABSENT HERE BUT PRESENT WHEN THE INSTALLER READ THE SERVER ARRIVES WITH
	THE PLACEHOLDER VARIABLE AND IS REFUSED RATHER THAN CREATED WITH IT.
************************************************************************************************/
;IF NOT EXISTS ( SELECT NULL FROM sys.server_principals P WHERE P.[name] = N'kit_scott_claude' )
BEGIN
	;IF ( N'$(KitPassword_kit_scott_claude)' = N'unused-login-already-present' )
		THROW 50000, 'Security/020-Logins.sql: kit_scott_claude is absent from the server but the installer generated no password for it; run the installer again.', 1
	;CREATE LOGIN [kit_scott_claude] WITH PASSWORD = N'$(KitPassword_kit_scott_claude)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [master]
END
GO

;IF NOT EXISTS ( SELECT NULL FROM sys.server_principals P WHERE P.[name] = N'kit_neo_claude' )
BEGIN
	;IF ( N'$(KitPassword_kit_neo_claude)' = N'unused-login-already-present' )
		THROW 50000, 'Security/020-Logins.sql: kit_neo_claude is absent from the server but the installer generated no password for it; run the installer again.', 1
	;CREATE LOGIN [kit_neo_claude] WITH PASSWORD = N'$(KitPassword_kit_neo_claude)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [master]
END
GO

;IF NOT EXISTS ( SELECT NULL FROM sys.server_principals P WHERE P.[name] = N'kit_asr_claude' )
BEGIN
	;IF ( N'$(KitPassword_kit_asr_claude)' = N'unused-login-already-present' )
		THROW 50000, 'Security/020-Logins.sql: kit_asr_claude is absent from the server but the installer generated no password for it; run the installer again.', 1
	;CREATE LOGIN [kit_asr_claude] WITH PASSWORD = N'$(KitPassword_kit_asr_claude)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [master]
END
GO

;IF NOT EXISTS ( SELECT NULL FROM sys.server_principals P WHERE P.[name] = N'kit_curator' )
BEGIN
	;IF ( N'$(KitPassword_kit_curator)' = N'unused-login-already-present' )
		THROW 50000, 'Security/020-Logins.sql: kit_curator is absent from the server but the installer generated no password for it; run the installer again.', 1
	;CREATE LOGIN [kit_curator] WITH PASSWORD = N'$(KitPassword_kit_curator)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [master]
END
GO

;IF NOT EXISTS ( SELECT NULL FROM sys.server_principals P WHERE P.[name] = N'kit_review' )
BEGIN
	;IF ( N'$(KitPassword_kit_review)' = N'unused-login-already-present' )
		THROW 50000, 'Security/020-Logins.sql: kit_review is absent from the server but the installer generated no password for it; run the installer again.', 1
	;CREATE LOGIN [kit_review] WITH PASSWORD = N'$(KitPassword_kit_review)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [master]
END
GO

/************************************************************************************************
	DATABASE USERS. A USER WHOSE SID NO LONGER MATCHES ITS LOGIN (THE LOGIN WAS DROPPED AND
	CREATED AGAIN) IS RE-POINTED AT THE LOGIN RATHER THAN LEFT ORPHANED.
************************************************************************************************/
;IF DATABASE_PRINCIPAL_ID('kit_scott_claude') IS NULL
	CREATE USER [kit_scott_claude] FOR LOGIN [kit_scott_claude] WITH DEFAULT_SCHEMA = [mem]
ELSE IF NOT EXISTS ( SELECT NULL FROM sys.database_principals D INNER JOIN sys.server_principals S ON S.[sid] = D.[sid] WHERE D.[name] = N'kit_scott_claude' AND S.[name] = N'kit_scott_claude' )
	ALTER USER [kit_scott_claude] WITH LOGIN = [kit_scott_claude]
GO

;IF DATABASE_PRINCIPAL_ID('kit_neo_claude') IS NULL
	CREATE USER [kit_neo_claude] FOR LOGIN [kit_neo_claude] WITH DEFAULT_SCHEMA = [mem]
ELSE IF NOT EXISTS ( SELECT NULL FROM sys.database_principals D INNER JOIN sys.server_principals S ON S.[sid] = D.[sid] WHERE D.[name] = N'kit_neo_claude' AND S.[name] = N'kit_neo_claude' )
	ALTER USER [kit_neo_claude] WITH LOGIN = [kit_neo_claude]
GO

;IF DATABASE_PRINCIPAL_ID('kit_asr_claude') IS NULL
	CREATE USER [kit_asr_claude] FOR LOGIN [kit_asr_claude] WITH DEFAULT_SCHEMA = [mem]
ELSE IF NOT EXISTS ( SELECT NULL FROM sys.database_principals D INNER JOIN sys.server_principals S ON S.[sid] = D.[sid] WHERE D.[name] = N'kit_asr_claude' AND S.[name] = N'kit_asr_claude' )
	ALTER USER [kit_asr_claude] WITH LOGIN = [kit_asr_claude]
GO

;IF DATABASE_PRINCIPAL_ID('kit_curator') IS NULL
	CREATE USER [kit_curator] FOR LOGIN [kit_curator] WITH DEFAULT_SCHEMA = [mem]
ELSE IF NOT EXISTS ( SELECT NULL FROM sys.database_principals D INNER JOIN sys.server_principals S ON S.[sid] = D.[sid] WHERE D.[name] = N'kit_curator' AND S.[name] = N'kit_curator' )
	ALTER USER [kit_curator] WITH LOGIN = [kit_curator]
GO

;IF DATABASE_PRINCIPAL_ID('kit_review') IS NULL
	CREATE USER [kit_review] FOR LOGIN [kit_review] WITH DEFAULT_SCHEMA = [mem]
ELSE IF NOT EXISTS ( SELECT NULL FROM sys.database_principals D INNER JOIN sys.server_principals S ON S.[sid] = D.[sid] WHERE D.[name] = N'kit_review' AND S.[name] = N'kit_review' )
	ALTER USER [kit_review] WITH LOGIN = [kit_review]
GO

/************************************************************************************************
	ROLE MEMBERSHIPS: EACH USER IN EXACTLY ONE ROLE.
************************************************************************************************/
;IF COALESCE(IS_ROLEMEMBER('mem_publisher', 'kit_scott_claude'), 0) <> 1
	ALTER ROLE mem_publisher ADD MEMBER [kit_scott_claude]
GO

;IF COALESCE(IS_ROLEMEMBER('mem_publisher', 'kit_neo_claude'), 0) <> 1
	ALTER ROLE mem_publisher ADD MEMBER [kit_neo_claude]
GO

;IF COALESCE(IS_ROLEMEMBER('mem_publisher', 'kit_asr_claude'), 0) <> 1
	ALTER ROLE mem_publisher ADD MEMBER [kit_asr_claude]
GO

;IF COALESCE(IS_ROLEMEMBER('mem_curator', 'kit_curator'), 0) <> 1
	ALTER ROLE mem_curator ADD MEMBER [kit_curator]
GO

;IF COALESCE(IS_ROLEMEMBER('mem_review', 'kit_review'), 0) <> 1
	ALTER ROLE mem_review ADD MEMBER [kit_review]
GO
