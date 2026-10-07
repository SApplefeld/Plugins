/*********************************************************************************
	TABLE: mem.RecordUsage

	One row per memory that has been shown to a session or marked applied, and no
	row for one that has not, so the table grows with the number of memories and
	not with the number of reads. A reader takes NULL, NULL and 0 for a memory
	with no row.

		[LastReadDt]		The newest read stamp the memory has taken.
		[LastAppliedDt]		The newest applied stamp the memory has taken.
		[AppliedDays]		The number of distinct calendar dates it was marked
							applied on, the date of a stamp being
							CAST([StampedDt] AS DATE).
		[AppliedDates]		The newest sixteen of those dates, a JSON array of
							yyyy-mm-dd strings, oldest first.

	mem.usp_AppendUsage folds each batch of stamps into these rows, and
	mem.usp_UpsertRecords and mem.usp_AdoptProjectStore fold a losing row's
	usage into the winning row's. mem.udf_MergeAppliedDates holds the rule all
	three count a new applied date by. No stamp identifier is stored: a resent
	stamp's date is already in [AppliedDates], or is older than a full list,
	and its time is never later than the row's, so it changes nothing.

	TABLE: mem.Usage (seeded from, then dropped)

	Version 7 and earlier kept one mem.Usage row per stamp, which nothing
	trimmed. Where a host still holds that table, the second batch below seeds
	this table from it, per record: the newest read stamp, the newest applied
	stamp, the count of distinct applied dates and the newest sixteen of them.
	It then drops mem.Usage with its rows, indexes and foreign keys, and nothing
	the kit ships can restore them. The seed and the drop run inside one
	explicit transaction inside a TRY block, and the CATCH rolls back any
	transaction still open and re-raises the error, so an error in either rolls
	both back and fails the run, and an interrupted upgrade leaves the old table
	whole or the new rows complete, never both half done.

	The guard makes the seed and the drop a no-op on a database that never held
	mem.Usage, which is every fresh install, and on every run after the first.
	The script runs in the Schema directory, before the Procedures directory
	alters the procedures that read and write usage, so a call landing between
	the two steps on a host still running the older procedures fails until the
	procedure step completes.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'RecordUsage'  )
BEGIN
	;CREATE TABLE mem.RecordUsage (
		 [RecordId]				BIGINT			NOT NULL

		/* Usage Fields */
		,[LastReadDt]			DATETIMEOFFSET	NULL
		,[LastAppliedDt]		DATETIMEOFFSET	NULL
		,[AppliedDays]			INT				NOT NULL	DEFAULT(0)
		,[AppliedDates]			NVARCHAR(400)	NULL

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_RecordUsage_Record
						FOREIGN KEY	( [RecordId] )
						REFERENCES	mem.Record ( [RecordId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_RecordUsage
						PRIMARY KEY	CLUSTERED	( [RecordId] )
	)
END
GO

-- Seed the Flat Rows From mem.Usage and Drop It, as One Transaction, Where a Host Still Holds It.
;IF EXISTS(	SELECT	NULL
			FROM	sys.schemas S
					LEFT JOIN sys.tables T
						ON S.[schema_id] = T.[schema_id]
			WHERE	S.[name] = 'mem'
					AND T.[name] = 'Usage'  )
BEGIN
	;BEGIN TRY
		;BEGIN TRANSACTION

		/* One Row per Record: the Newest Read, the Newest Applied, the Distinct Applied Dates and the Newest Sixteen of Them. */
		;INSERT INTO mem.RecordUsage (
			 [RecordId]
			,[LastReadDt]
			,[LastAppliedDt]
			,[AppliedDays]
			,[AppliedDates]	)
		SELECT	 [RecordId]			= U.[RecordId]
				,[LastReadDt]		= MAX(CASE WHEN U.[Kind] = 'read' THEN U.[StampedDt] END)
				,[LastAppliedDt]	= MAX(CASE WHEN U.[Kind] = 'applied' THEN U.[StampedDt] END)
				,[AppliedDays]		= COUNT(DISTINCT CASE WHEN U.[Kind] = 'applied' THEN CAST(U.[StampedDt] AS DATE) END)
				,[AppliedDates]		= (	SELECT	N'[' + STRING_AGG(CAST(N'"' + CONVERT(NCHAR(10), D.[AppliedOn], 23) + N'"' AS NVARCHAR(MAX)), N',')
												WITHIN GROUP ( ORDER BY D.[AppliedOn] ) + N']'
										FROM	(	SELECT	DISTINCT TOP ( 16 )
															[AppliedOn] = CAST(A.[StampedDt] AS DATE)
													FROM	mem.Usage A
													WHERE	A.[RecordId] = U.[RecordId]
															AND A.[Kind] = 'applied'
													ORDER BY [AppliedOn] DESC	) D	)
		FROM	mem.Usage U
		GROUP BY U.[RecordId]

		;DROP TABLE mem.Usage

		;COMMIT TRANSACTION
	END TRY
	BEGIN CATCH
		/* Unwind the Seed and the Drop Together. */
		;IF ( @@TRANCOUNT > 0 )
			ROLLBACK TRANSACTION

		/* Re-Raise so the Installer Stops on the Failed Script. */
		;THROW
	END CATCH
END
GO
