/*********************************************************************************
	TABLE: mem.Record

	One row per memory record, keyed on the store and the file key, which for a
	shared tier is (tier, segment, file key) since the store carries no sandbox.
	Deletion is [DeletedDt], a soft mark no read procedure serves, never a row
	removal. [Author] is the author a writing verb names and NULL otherwise.

	[Body] holds the record's prose, and the record's fields live in their own
	columns: [Space], [Triggers] and [Anchors] (JSON arrays), [IsPinned] and
	[CreatedOn], the frontmatter's created date. A row a version 6 client
	published still holds its whole file, frontmatter included, in [Body], and
	the reader strips that block.

	ORIGIN VALUES (fixed, lowercase):
		file		Published from a machine's memory file.
		memq		Written by mem.usp_PutRecord. A republish never overwrites one.

	[WrittenBySandboxId] is the sandbox whose mem.usp_PutRecord call last wrote
	the row. The stamp ids those calls carried are held in mem.RecordStamp,
	one row per stamp, so a later write never erases the record of an earlier
	one.

	VISIBILITY VALUES (fixed, lowercase):
		private		A version 6 project store row, as its publisher wrote it.
		shared		A type or operator store row, a row mem.usp_PutRecord wrote, and a
					promoted row. mem.udf_VisibleRecords serves both values alike.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'Record'  )
BEGIN
	;CREATE TABLE mem.Record (
		 [RecordId]					BIGINT			NOT NULL	IDENTITY(1,1)

		/* Identity Fields */
		,[StoreId]					INT				NOT NULL
		,[Name]						NVARCHAR(200)	NOT NULL
		,[FileKey]					NVARCHAR(400)	NOT NULL

		/* Content Fields */
		,[Description]				NVARCHAR(MAX)	NOT NULL	DEFAULT('')
		,[Body]						NVARCHAR(MAX)	NOT NULL	DEFAULT('')
		,[BodyHash]					VARCHAR(128)	NOT NULL	DEFAULT('')
		,[FileModifiedDt]			DATETIMEOFFSET	NULL
		,[Machine]					NVARCHAR(100)	NULL
		,[Tags]						NVARCHAR(MAX)	NULL
		,[SupersedesName]			NVARCHAR(200)	NULL
		,[Author]					NVARCHAR(200)	NULL
		,[IsArchived]				BIT				NOT NULL	DEFAULT(0)

		/* Record Fields */
		,[Space]					NVARCHAR(100)	NULL
		,[Triggers]					NVARCHAR(MAX)	NULL
		,[Anchors]					NVARCHAR(MAX)	NULL
		,[IsPinned]					BIT				NOT NULL	DEFAULT(0)
		,[CreatedOn]				DATE			NULL
		,[Origin]					VARCHAR(10)		NOT NULL	DEFAULT('file')
		,[WrittenBySandboxId]		INT				NULL

		/* Visibility Fields */
		,[Visibility]				VARCHAR(10)		NOT NULL
		,[LastPublishedBySandboxId]	INT				NULL
		,[LastPublishedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[DeletedDt]				DATETIMEOFFSET	NULL

		/* Audit Fields */
		,[CreatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- CHECK CONSTRAINTS.
		,CONSTRAINT		CK_Record_Visibility
						CHECK ( [Visibility] IN ('private', 'shared') )
		,CONSTRAINT		CK_Record_Tags
						CHECK ( [Tags] IS NULL OR ISJSON([Tags]) = 1 )

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_Record_Store
						FOREIGN KEY	( [StoreId] )
						REFERENCES	mem.Store ( [StoreId] )
		,CONSTRAINT		FK_Record_LastPublishedBySandbox
						FOREIGN KEY	( [LastPublishedBySandboxId] )
						REFERENCES	mem.Sandbox ( [SandboxId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_Record
						PRIMARY KEY	CLUSTERED	( [RecordId] )
	)
END
GO

-- Check for and Add the Record Fields to a Table That Predates Them. Each Row Already There Takes the Default.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Record')
						AND C.[name] = 'Space' )
BEGIN
	;ALTER TABLE mem.Record ADD [Space] NVARCHAR(100) NULL
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Record')
						AND C.[name] = 'Triggers' )
BEGIN
	;ALTER TABLE mem.Record ADD [Triggers] NVARCHAR(MAX) NULL
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Record')
						AND C.[name] = 'Anchors' )
BEGIN
	;ALTER TABLE mem.Record ADD [Anchors] NVARCHAR(MAX) NULL
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Record')
						AND C.[name] = 'IsPinned' )
BEGIN
	;ALTER TABLE mem.Record ADD [IsPinned] BIT NOT NULL DEFAULT(0)
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Record')
						AND C.[name] = 'CreatedOn' )
BEGIN
	;ALTER TABLE mem.Record ADD [CreatedOn] DATE NULL
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Record')
						AND C.[name] = 'Origin' )
BEGIN
	;ALTER TABLE mem.Record ADD [Origin] VARCHAR(10) NOT NULL DEFAULT('file')
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Record')
						AND C.[name] = 'WrittenBySandboxId' )
BEGIN
	;ALTER TABLE mem.Record ADD [WrittenBySandboxId] INT NULL
END
GO

-- Check for and Create the Record Fields' Constraints.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.check_constraints K
				WHERE	K.[parent_object_id] = OBJECT_ID('mem.Record')
						AND K.[name] = 'CK_Record_Triggers' )
BEGIN
	;ALTER TABLE mem.Record WITH CHECK ADD CONSTRAINT CK_Record_Triggers
		CHECK ( [Triggers] IS NULL OR ISJSON([Triggers], ARRAY) = 1 )
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.check_constraints K
				WHERE	K.[parent_object_id] = OBJECT_ID('mem.Record')
						AND K.[name] = 'CK_Record_Anchors' )
BEGIN
	;ALTER TABLE mem.Record WITH CHECK ADD CONSTRAINT CK_Record_Anchors
		CHECK ( [Anchors] IS NULL OR ISJSON([Anchors], ARRAY) = 1 )
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.check_constraints K
				WHERE	K.[parent_object_id] = OBJECT_ID('mem.Record')
						AND K.[name] = 'CK_Record_Origin' )
BEGIN
	;ALTER TABLE mem.Record WITH CHECK ADD CONSTRAINT CK_Record_Origin
		CHECK ( [Origin] IN ('file', 'memq') )
END
GO

;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.foreign_keys FK
				WHERE	FK.[parent_object_id] = OBJECT_ID('mem.Record')
						AND FK.[name] = 'FK_Record_WrittenBySandbox' )
BEGIN
	;ALTER TABLE mem.Record WITH CHECK ADD CONSTRAINT FK_Record_WrittenBySandbox
		FOREIGN KEY ( [WrittenBySandboxId] )
		REFERENCES mem.Sandbox ( [SandboxId] )
END
GO

-- Check for and Create IX_Record_StoreId_FileKey.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.Record')
						AND I.[name] = 'IX_Record_StoreId_FileKey' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_Record_StoreId_FileKey
		ON mem.Record (	 [StoreId]
						,[FileKey]	)
END
GO

-- Check for and Create IX_Record_StoreId_Name.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.Record')
						AND I.[name] = 'IX_Record_StoreId_Name' )
BEGIN
	;CREATE NONCLUSTERED INDEX IX_Record_StoreId_Name
		ON mem.Record (	 [StoreId]
						,[Name]	)
END
GO
