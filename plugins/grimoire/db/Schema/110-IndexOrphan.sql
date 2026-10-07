/*********************************************************************************
	TABLE: mem.IndexOrphan

	One row per tier index line that names a record file no publisher walk
	found, keyed on the store and the line's record name. First seen is set on
	insert; last seen and the sandbox that saw it move on every report.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'IndexOrphan'  )
BEGIN
	;CREATE TABLE mem.IndexOrphan (
		 [IndexOrphanId]		BIGINT			NOT NULL	IDENTITY(1,1)

		/* Identity Fields */
		,[StoreId]				INT				NOT NULL
		,[IndexLineName]		NVARCHAR(200)	NOT NULL

		/* Content Fields */
		,[Description]			NVARCHAR(MAX)	NULL
		,[FirstSeenDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[LastSeenDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[LastSeenBySandboxId]	INT				NOT NULL

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_IndexOrphan_Store
						FOREIGN KEY	( [StoreId] )
						REFERENCES	mem.Store ( [StoreId] )
		,CONSTRAINT		FK_IndexOrphan_LastSeenBySandbox
						FOREIGN KEY	( [LastSeenBySandboxId] )
						REFERENCES	mem.Sandbox ( [SandboxId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_IndexOrphan
						PRIMARY KEY	CLUSTERED	( [IndexOrphanId] )
	)
END
GO

-- Check for and Create IX_IndexOrphan_StoreId_IndexLineName.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.IndexOrphan')
						AND I.[name] = 'IX_IndexOrphan_StoreId_IndexLineName' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_IndexOrphan_StoreId_IndexLineName
		ON mem.IndexOrphan (	 [StoreId]
								,[IndexLineName]	)
END
GO
