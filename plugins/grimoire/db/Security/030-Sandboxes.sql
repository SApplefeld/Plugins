/************************************************************************************************
*************************************************************************************************
	SCRIPT:		Security/030-Sandboxes.sql
	AUTHOR:		Scott Applefeld
	DATE:		September 17th, 2026
	VERSION:	v1.0
*************************************************************************************************
	NOTES:		v1.0 - 09/17/2026 - SCOTT APPLEFELD
						The sandbox rows that map each publisher login to the machine it
						publishes for. mem.CallerSandbox() resolves the connected login
						against [PublisherLogin], so a login absent from this table executes
						the read procedures and gets no rows, and executes the write
						procedures and is refused. Each row is inserted only when its name
						is absent; a row already present keeps whatever login it carries.
*************************************************************************************************
************************************************************************************************/

;IF NOT EXISTS ( SELECT NULL FROM mem.Sandbox S WHERE S.[Name] = N'SCOTT-CLAUDE' )
BEGIN
	;INSERT INTO mem.Sandbox ( [Name], [PublisherLogin] )
	SELECT	 [Name]				= N'SCOTT-CLAUDE'
			,[PublisherLogin]	= N'kit_scott_claude'
END
GO

;IF NOT EXISTS ( SELECT NULL FROM mem.Sandbox S WHERE S.[Name] = N'NEO-CLAUDE' )
BEGIN
	;INSERT INTO mem.Sandbox ( [Name], [PublisherLogin] )
	SELECT	 [Name]				= N'NEO-CLAUDE'
			,[PublisherLogin]	= N'kit_neo_claude'
END
GO

;IF NOT EXISTS ( SELECT NULL FROM mem.Sandbox S WHERE S.[Name] = N'ASR-CLAUDE' )
BEGIN
	;INSERT INTO mem.Sandbox ( [Name], [PublisherLogin] )
	SELECT	 [Name]				= N'ASR-CLAUDE'
			,[PublisherLogin]	= N'kit_asr_claude'
END
GO
