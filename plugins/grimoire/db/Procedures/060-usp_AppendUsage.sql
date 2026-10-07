-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_AppendUsage', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_AppendUsage AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_AppendUsage
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Usage			NVARCHAR(MAX)
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_AppendUsage
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.5
	*********************************************************************************************
		NOTES:		v1.5 - 10/05/2026
							The batch table carries an index over its record, kind and
							stamp time, which the three per-record reads of the fold seek
							on, and the @True and @False locals, which nothing read, are
							removed. No behavior changes.

					v1.4 - 10/04/2026
							The batch folds into mem.RecordUsage, one row per record, and
							writes no row per stamp. For each record its stamps resolve
							to, [LastReadDt] and [LastAppliedDt] take the later of the
							row's value and the batch's newest read and applied stamp,
							and the batch's distinct applied dates enter [AppliedDates]
							under mem.udf_MergeAppliedDates, which counts a date new
							where the list does not hold it, unless the list holds
							sixteen dates and the date is earlier than all of them.
							[AppliedDays] rises by the dates it counts new. A record with
							no row takes one. The rows are read under UPDLOCK and
							HOLDLOCK before they are written, so two deliveries for one
							record queue rather than both reading the row they replace.

							A resent stamp changes none of the row's four values, with no
							stamp identifier stored: its date is held, or older than a full
							list, and its time is never later than the row's. The fold
							still sets [UpdatedDt]. So {stampId} is accepted
							and ignored, and so is {sessionId}. [appended] counts the
							stamps that resolved to a record, whether or not they changed
							its row, so a resent batch answers as its first delivery did,
							and [skipped] is 0. The parameter, the stamp validation, the
							resolution and [rejected] are as v1.3 states them.

					v1.3 - 10/03/2026 - SCOTT APPLEFELD
							An element may carry {projectKey}, which names a project's fleet
							store: a project tier stamp carrying one resolves by that key and
							the file key or name against a store that belongs to no sandbox,
							and where no fleet row matches, by its segment against the
							caller's own older store, so a stamp written before the record
							moved still lands. A projectKey on another tier's stamp is
							ignored. A stamp naming its record by recordId reaches a fleet
							row as it reaches any row the caller may see.

					v1.2 - 09/18/2026 - SCOTT APPLEFELD
							A failure unwinds only a transaction this procedure opened and
							re-raises, so a caller's transaction stays the caller's to
							unwind. Under an INSERT-EXEC, which holds a transaction of its
							own, the caller reads the server's own error text rather than
							error 3915.

					v1.1 - 09/18/2026 - SCOTT APPLEFELD
							Each element also carries {stampId}, the identifier its writing
							client generated for it, and a stamp whose id this sandbox's rows
							already hold is skipped and counted rather than written again.
							Delivery is therefore idempotent: a client that cannot tell which
							of its lines the server took resends them all and inserts each
							once. The skip is scoped to the caller's own sandbox, matching
							IX_Usage_SandboxId_StampId, so one sandbox's row never suppresses
							another's write. It reads mem.Usage under UPDLOCK and HOLDLOCK,
							which holds a key range lock over that index to the end of the
							transaction, so two sessions carrying one id queue rather than
							both passing the test and one then dying on the index with a
							batch of unrelated stamps behind it. A stamp carrying no id is
							written without that protection.

							Returns one row, one column [Json], holding
							{appended, rejected, skipped}.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							Appends one batch of read or applied stamps for the calling
							sandbox. @p_Usage is a JSON array of objects {recordId, tier,
							segment, name, fileKey, kind, at, sessionId}. A stamp names its
							record either by recordId, which must be a record the caller may
							see, or by identity: the tier and segment of its store plus the
							file key or, failing that, the name, where a project tier
							identity resolves against the caller's own store only. A stamp
							that resolves to no visible record is rejected and counted rather
							than written.

							Returns one row, one column [Json], holding {appended, rejected}.
	*********************************************************************************************
	********************************************************************************************/

	/********************************************************************************************
		SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS.
	********************************************************************************************/
	;SET NOCOUNT ON
	;SET TRANSACTION ISOLATION LEVEL READ COMMITTED

	/********************************************************************************************
		DECLARE VARIABLES FOR PROCESSING.
	********************************************************************************************/
	;DECLARE @EntryTranCount	INT				= @@TRANCOUNT
			,@SandboxId			INT				= NULL

	/* Result Counts. */
	;DECLARE @Appended			INT				= 0
			,@Rejected			INT				= 0

	/* The Batch, With the Record Each Stamp Resolves To. */
	;DECLARE @Incoming TABLE (
		 [RecordIdIn]		BIGINT			NULL
		,[Tier]				VARCHAR(20)		NULL
		,[Segment]			NVARCHAR(400)	NULL
		,[ProjectKey]		NVARCHAR(400)	NULL
		,[Name]				NVARCHAR(200)	NULL
		,[FileKey]			NVARCHAR(400)	NULL
		,[Kind]				VARCHAR(10)		NULL
		,[StampedDt]		DATETIMEOFFSET	NULL
		,[RecordId]			BIGINT			NULL
		,INDEX IX_Incoming_RecordId_Kind_StampedDt NONCLUSTERED ( [RecordId], [Kind], [StampedDt] )
	)

	/* The Batch Folded to One Row per Record. */
	;DECLARE @Folded TABLE (
		 [RecordId]			BIGINT			NOT NULL	PRIMARY KEY
		,[LastReadDt]		DATETIMEOFFSET	NULL
		,[LastAppliedDt]	DATETIMEOFFSET	NULL
		,[AppliedDates]		NVARCHAR(MAX)	NULL
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE BATCH, THEN FOLD THE RESOLVED STAMPS INTO THEIR RECORDS' ROWS.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_AppendUsage: the calling login maps to no sandbox.', 1

		;IF ( @p_Usage IS NULL OR ISJSON(@p_Usage, ARRAY) <> 1 )
			THROW 50000, 'mem.usp_AppendUsage: @p_Usage must be a JSON array.', 1

		/* Parse the Batch Into Typed Rows, Canonicalizing the Tier and the Kind. */
		;INSERT INTO @Incoming (
			 [RecordIdIn]
			,[Tier]
			,[Segment]
			,[ProjectKey]
			,[Name]
			,[FileKey]
			,[Kind]
			,[StampedDt]	)
		SELECT	 [RecordIdIn]	= J.[RecordId]
				,[Tier]			= LOWER(LTRIM(RTRIM(J.[Tier])))
				,[Segment]		= CASE	WHEN LOWER(LTRIM(RTRIM(J.[Tier]))) = 'operator'
										THEN NULL
										ELSE NULLIF(LTRIM(RTRIM(J.[Segment])), '')
								  END
				,[ProjectKey]	= CASE	WHEN LOWER(LTRIM(RTRIM(J.[Tier]))) = 'project'
										THEN NULLIF(LTRIM(RTRIM(J.[ProjectKey])), '')
										ELSE NULL
								  END
				,[Name]			= NULLIF(LTRIM(RTRIM(J.[Name])), '')
				,[FileKey]		= NULLIF(LTRIM(RTRIM(J.[FileKey])), '')
				,[Kind]			= LOWER(LTRIM(RTRIM(J.[Kind])))
				,[StampedDt]	= J.[StampedDt]
		FROM	OPENJSON(@p_Usage)
				WITH (	 [RecordId]		BIGINT			'$.recordId'
						,[Tier]			VARCHAR(20)		'$.tier'
						,[Segment]		NVARCHAR(400)	'$.segment'
						,[ProjectKey]	NVARCHAR(400)	'$.projectKey'
						,[Name]			NVARCHAR(200)	'$.name'
						,[FileKey]		NVARCHAR(400)	'$.fileKey'
						,[Kind]			VARCHAR(10)		'$.kind'
						,[StampedDt]	DATETIMEOFFSET	'$.at'		) J

		/* Refuse a Stamp Missing Its Kind or Its Time. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	I.[Kind] IS NULL
								OR I.[Kind] NOT IN ('read', 'applied')
								OR I.[StampedDt] IS NULL	)
			THROW 50000, 'mem.usp_AppendUsage: every stamp needs a kind of read or applied and an at timestamp.', 1

		/* Resolve Each Stamp to a Record the Caller May See, by Id First and by Identity Otherwise. */
		/* A Project Key Match Ranks First; With None, the Segment Locator Finds the Caller's Older Store Row. */
		/* Among Rows of One Name, the Newest Undeleted Row is the One Stamped, as in Every Procedure That Resolves a Name. */
		;UPDATE I
		SET		[RecordId] = X.[RecordId]
		FROM	@Incoming I
				CROSS APPLY (	SELECT	TOP ( 1 )
										[RecordId] = V.[RecordId]
								FROM	mem.udf_VisibleRecords(@SandboxId) V
								WHERE	(	I.[RecordIdIn] IS NOT NULL
											AND V.[RecordId] = I.[RecordIdIn]	)
										OR (	I.[RecordIdIn] IS NULL
												AND V.[Tier] = I.[Tier]
												AND (	(	I.[ProjectKey] IS NOT NULL
															AND V.[Tier] = 'project'
															AND V.[ProjectKey] = I.[ProjectKey]	)
														OR (	EXISTS (	SELECT V.[Segment]
																			INTERSECT
																			SELECT I.[Segment]	)
																AND (	V.[Tier] <> 'project'
																		OR V.[StoreSandboxId] = @SandboxId	)	)	)
												AND (	(	I.[FileKey] IS NOT NULL
															AND V.[FileKey] = I.[FileKey]	)
														OR (	I.[FileKey] IS NULL
																AND I.[Name] IS NOT NULL
																AND V.[Name] = I.[Name]	)	)	)
								ORDER BY CASE WHEN V.[ProjectKey] = I.[ProjectKey] THEN 0 ELSE 1 END, V.[RecordId] DESC	) X

		;SELECT	@Rejected = COUNT(*)
		FROM	@Incoming I
		WHERE	I.[RecordId] IS NULL

		;SELECT	@Appended = COUNT(*)
		FROM	@Incoming I
		WHERE	I.[RecordId] IS NOT NULL

		/* Fold the Resolved Stamps to One Row per Record: the Newest Read, the Newest Applied and the Distinct Applied Dates. */
		/* Each Maximum Reads Only Its Own Kind's Rows, so No NULL is Aggregated and No Warning Reaches the Caller. */
		;INSERT INTO @Folded (
			 [RecordId]
			,[LastReadDt]
			,[LastAppliedDt]
			,[AppliedDates]	)
		SELECT	 [RecordId]			= R.[RecordId]
				,[LastReadDt]		= (	SELECT	MAX(A.[StampedDt])
										FROM	@Incoming A
										WHERE	A.[RecordId] = R.[RecordId]
												AND A.[Kind] = 'read'	)
				,[LastAppliedDt]	= (	SELECT	MAX(A.[StampedDt])
										FROM	@Incoming A
										WHERE	A.[RecordId] = R.[RecordId]
												AND A.[Kind] = 'applied'	)
				,[AppliedDates]		= (	SELECT	N'[' + STRING_AGG(CAST(N'"' + CONVERT(NCHAR(10), D.[AppliedOn], 23) + N'"' AS NVARCHAR(MAX)), N',') + N']'
										FROM	(	SELECT	DISTINCT [AppliedOn] = CAST(A.[StampedDt] AS DATE)
													FROM	@Incoming A
													WHERE	A.[RecordId] = R.[RecordId]
															AND A.[Kind] = 'applied'	) D	)
		FROM	(	SELECT	DISTINCT I.[RecordId]
					FROM	@Incoming I
					WHERE	I.[RecordId] IS NOT NULL	) R

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* Fold Into the Rows That Exist, Read Under a Range Lock Held to the End of the Transaction. */
		;UPDATE RU
		SET		 [LastReadDt]		= GREATEST(RU.[LastReadDt], F.[LastReadDt])
				,[LastAppliedDt]	= GREATEST(RU.[LastAppliedDt], F.[LastAppliedDt])
				,[AppliedDays]		= RU.[AppliedDays] + M.[NewDays]
				,[AppliedDates]		= M.[AppliedDates]
				,[UpdatedDt]		= SYSDATETIMEOFFSET()
		FROM	mem.RecordUsage RU WITH ( UPDLOCK, HOLDLOCK )
				INNER JOIN @Folded F
					ON F.[RecordId] = RU.[RecordId]
				CROSS APPLY mem.udf_MergeAppliedDates(RU.[AppliedDates], F.[AppliedDates]) M

		/* Give a Row to Each Record That Has None, Under the Same Lock. */
		;INSERT INTO mem.RecordUsage (
			 [RecordId]
			,[LastReadDt]
			,[LastAppliedDt]
			,[AppliedDays]
			,[AppliedDates]	)
		SELECT	 [RecordId]			= F.[RecordId]
				,[LastReadDt]		= F.[LastReadDt]
				,[LastAppliedDt]	= F.[LastAppliedDt]
				,[AppliedDays]		= M.[NewDays]
				,[AppliedDates]		= M.[AppliedDates]
		FROM	@Folded F
				CROSS APPLY mem.udf_MergeAppliedDates(NULL, F.[AppliedDates]) M
		WHERE	NOT EXISTS (	SELECT	NULL
								FROM	mem.RecordUsage RU WITH ( UPDLOCK, HOLDLOCK )
								WHERE	RU.[RecordId] = F.[RecordId]	)

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [appended]	= @Appended
									,[rejected]	= @Rejected
									,[skipped]	= 0
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER	)
	END TRY
	BEGIN CATCH
		/* Unwind Only a Transaction This Procedure Opened; a Caller's is the Caller's to Unwind. */
		/* A ROLLBACK Inside an INSERT-EXEC Raises Error 3915 in Place of the Server's Own Error Text. */
		;IF ( XACT_STATE() <> 0 AND @EntryTranCount = 0 )
			ROLLBACK TRANSACTION

		/* Restore the Entry Count With Fresh Empty Transactions so Error 266 Cannot Fire; the Guard Above Unwinds Nothing a Caller Opened, so This Loop Stands as a Defensive No-Op. */
		;WHILE ( @@TRANCOUNT < @EntryTranCount )
			BEGIN TRANSACTION

		/* Re-Raise so the Caller Never Reads Success From a Failed Write. */
		;THROW
	END CATCH
END
GO
