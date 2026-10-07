/*********************************************************************************
	TABLE: mem.Embedding

	One row per embedded chunk of a record, separate from the record so a
	re-embed pass touches this table alone. A record embedded whole holds one
	row at chunk zero. Every row records the model identity and dimension it
	was made with, so a model change is a re-embed pass and never a schema
	change. mem.usp_UpsertRecords deletes a record's rows when its body hash or
	name changes, which is what marks it for re-embedding.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'Embedding'  )
BEGIN
	;CREATE TABLE mem.Embedding (
		 [EmbeddingId]			BIGINT			NOT NULL	IDENTITY(1,1)

		/* Identity Fields */
		,[RecordId]				BIGINT			NOT NULL
		,[ChunkIndex]			INT				NOT NULL
		,[ModelIdentity]		VARCHAR(200)	NOT NULL

		/* Content Fields */
		,[ChunkOffset]			INT				NOT NULL	DEFAULT(0)
		,[ChunkLength]			INT				NOT NULL	DEFAULT(0)
		,[Vector]				VECTOR(1024)	NOT NULL
		,[Dimensions]			SMALLINT		NOT NULL
		,[EmbeddedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- CHECK CONSTRAINTS.
		,CONSTRAINT		CK_Embedding_ChunkIndex
						CHECK ( [ChunkIndex] >= 0 )

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_Embedding_Record
						FOREIGN KEY	( [RecordId] )
						REFERENCES	mem.Record ( [RecordId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_Embedding
						PRIMARY KEY	CLUSTERED	( [EmbeddingId] )
	)
END
GO

-- Check for and Create IX_Embedding_RecordId_ChunkIndex_ModelIdentity.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.Embedding')
						AND I.[name] = 'IX_Embedding_RecordId_ChunkIndex_ModelIdentity' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_Embedding_RecordId_ChunkIndex_ModelIdentity
		ON mem.Embedding (	 [RecordId]
							,[ChunkIndex]
							,[ModelIdentity]	)
END
GO
