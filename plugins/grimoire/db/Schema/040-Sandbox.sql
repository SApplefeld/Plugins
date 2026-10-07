/*********************************************************************************
	TABLE: mem.Sandbox

	One row per sandbox VM, keyed to the SQL login its publisher connects as.
	mem.CallerSandbox() resolves the calling login against [PublisherLogin],
	and a login with no row here resolves to no sandbox: every publisher read
	then returns nothing, and every publisher write refuses. The three rows the
	fleet holds are seeded by Security/030-Sandboxes.sql beside the logins they
	name.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'Sandbox'  )
BEGIN
	;CREATE TABLE mem.Sandbox (
		 [SandboxId]			INT				NOT NULL	IDENTITY(1,1)

		/* Identity Fields */
		,[Name]					NVARCHAR(100)	NOT NULL
		,[PublisherLogin]		NVARCHAR(128)	NOT NULL

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- PRIMARY KEY.
		,CONSTRAINT		PK_Sandbox
						PRIMARY KEY	CLUSTERED	( [SandboxId] )
	)
END
GO

-- Check for and Create IX_Sandbox_Name.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.Sandbox')
						AND I.[name] = 'IX_Sandbox_Name' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_Sandbox_Name
		ON mem.Sandbox (  [Name]	)
END
GO

-- Check for and Create IX_Sandbox_PublisherLogin.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.Sandbox')
						AND I.[name] = 'IX_Sandbox_PublisherLogin' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_Sandbox_PublisherLogin
		ON mem.Sandbox (  [PublisherLogin]	)
END
GO
