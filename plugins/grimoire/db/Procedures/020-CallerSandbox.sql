-- DROP AND RE-CREATE THE FUNCTION.
;IF OBJECT_ID('mem.CallerSandbox') IS NOT NULL
  EXEC ('DROP FUNCTION mem.CallerSandbox;')
GO

;CREATE FUNCTION mem.CallerSandbox
(
)
RETURNS TABLE
AS
RETURN
(
	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.CallerSandbox
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.1 - 10/04/2026 - SCOTT APPLEFELD
							No read procedure writes a log row, so the database keeps no
							record of the security context a read ran under. Tenancy still
							follows ORIGINAL_LOGIN() alone, which impersonation cannot move.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The one place a caller's sandbox is resolved. Returns the
							mem.Sandbox row whose publisher login is the calling login, and no
							row at all for a login no sandbox names, which every publisher
							procedure treats as "sees nothing" rather than "sees everything".
							The login read is ORIGINAL_LOGIN(): the login that opened the
							connection, which no EXECUTE AS clause, IMPERSONATE grant or
							module declared WITH EXECUTE AS can change. Tenancy therefore
							follows the wire credential alone, so a later grant or a later
							module cannot re-point a publisher's reads at another sandbox's
							private rows.
	*********************************************************************************************
	********************************************************************************************/
	SELECT	 [SandboxId]		= S.[SandboxId]
			,[Name]				= S.[Name]
			,[PublisherLogin]	= S.[PublisherLogin]
	FROM	mem.Sandbox S
	WHERE	S.[PublisherLogin] = ORIGINAL_LOGIN() COLLATE DATABASE_DEFAULT
)
GO
