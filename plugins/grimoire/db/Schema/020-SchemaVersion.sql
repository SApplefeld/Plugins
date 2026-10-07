/*********************************************************************************
	TABLE: mem.SchemaVersion

	One row per schema version the installer has applied. The installer reads
	MAX([Version]) before it applies anything and refuses to run when the
	database carries a version newer than the scripts it holds.

	The table is created here and the row is written by Version/010-RecordSchemaVersion.sql,
	which is the last script of the last directory the installer applies. The
	row is what every client reads to decide the host carries this version's
	procedures, so writing it here would answer that question true from the
	moment this script ran, with the columns and the procedures of the version
	still unapplied behind it.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'SchemaVersion'  )
BEGIN
	;CREATE TABLE mem.SchemaVersion (
		 [Version]				INT				NOT NULL

		/* Description Fields */
		,[Notes]				NVARCHAR(400)	NOT NULL	DEFAULT('')

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- PRIMARY KEY.
		,CONSTRAINT		PK_SchemaVersion
						PRIMARY KEY	CLUSTERED	( [Version] )
	)
END
GO
