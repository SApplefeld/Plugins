/*********************************************************************************
	TABLE: mem.RecordStamp

	One row per stamp id a sandbox's mem.usp_PutRecord call carried and stored:
	the writing sandbox, the identifier its client generated for the write,
	and the record the write landed on. A row is written for every stored
	write that carried a stamp and is never rewritten, so a later write to the
	same record, stamped or not, leaves the earlier stamp on file.

	The unique index over the sandbox and the stamp id is what makes a resent
	write land once: a call carrying a stamp its own sandbox already holds here
	writes nothing and answers stored, however long ago the stamp was applied
	and whatever has been written to the record since. The index is per
	sandbox, so one sandbox's stamp never suppresses another's write.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'RecordStamp'  )
BEGIN
	;CREATE TABLE mem.RecordStamp (
		 [RecordStampId]		BIGINT			NOT NULL	IDENTITY(1,1)

		/* Identity Fields */
		,[WrittenBySandboxId]	INT				NOT NULL
		,[StampId]				NVARCHAR(64)	NOT NULL
		,[RecordId]				BIGINT			NOT NULL

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_RecordStamp_Sandbox
						FOREIGN KEY	( [WrittenBySandboxId] )
						REFERENCES	mem.Sandbox ( [SandboxId] )
		,CONSTRAINT		FK_RecordStamp_Record
						FOREIGN KEY	( [RecordId] )
						REFERENCES	mem.Record ( [RecordId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_RecordStamp
						PRIMARY KEY	CLUSTERED	( [RecordStampId] )
	)
END
GO

-- Check for and Create IX_RecordStamp_WrittenBySandboxId_StampId.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.RecordStamp')
						AND I.[name] = 'IX_RecordStamp_WrittenBySandboxId_StampId' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_RecordStamp_WrittenBySandboxId_StampId
		ON mem.RecordStamp (	 [WrittenBySandboxId]
								,[StampId]	)
END
GO
