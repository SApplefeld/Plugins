-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_AppendOutcomes', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_AppendOutcomes AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_AppendOutcomes
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Outcomes		NVARCHAR(MAX)
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_AppendOutcomes
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.3
	*********************************************************************************************
		NOTES:		v1.3 - 09/23/2026 - SCOTT APPLEFELD
							Each element may also carry {recognitionId, score, vectorRank, shown},
							the four fields of a judged fleet pointer's kit.jev.pointer row, which
							land in the columns of those names. An element without them writes
							NULL there.

					v1.2 - 09/18/2026 - SCOTT APPLEFELD
							A failure unwinds only a transaction this procedure opened and
							re-raises, so a caller's transaction stays the caller's to
							unwind. Under an INSERT-EXEC, which holds a transaction of its
							own, the caller reads the server's own error text rather than
							error 3915.

					v1.1 - 09/18/2026 - SCOTT APPLEFELD
							Each element also carries {stampId}, the identifier its writing
							client generated for it, and an entry whose id this sandbox's
							rows already hold is skipped and counted rather than written
							again. Delivery is therefore idempotent: a client that cannot
							tell which of its lines the server took resends them all and
							inserts each once. The skip is scoped to the caller's own
							sandbox, matching IX_Outcome_SandboxId_StampId, so one sandbox's
							row never suppresses another's write. It reads mem.Outcome under
							UPDLOCK and HOLDLOCK, which holds a key range lock over that
							index to the end of the transaction, so two sessions carrying one
							id queue rather than both passing the test and one then dying on
							the index with a batch of unrelated entries behind it. An entry
							carrying no id is written without that protection.

							Returns one row, one column [Json], holding {appended, skipped}.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							Appends one batch of outcome journal rows for the calling
							sandbox's project stores. @p_Outcomes is a JSON array of objects
							{segment, actionKey, result, summary, detail, tags, at}. The
							store is the caller's own project store for the segment, created
							here when the journal is the first thing published for it, so an
							outcome can never land in another sandbox's store.

							Returns one row, one column [Json], holding {appended}.
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
	;DECLARE @True				BIT				= 1
			,@False				BIT				= 0
			,@EntryTranCount	INT				= @@TRANCOUNT
			,@SandboxId			INT				= NULL
			,@Appended			INT				= 0
			,@Received			INT				= 0

	/* The Batch. */
	;DECLARE @Incoming TABLE (
		 [Segment]			NVARCHAR(400)	NULL
		,[ActionKey]		NVARCHAR(200)	NULL
		,[Result]			NVARCHAR(50)	NULL
		,[Summary]			NVARCHAR(MAX)	NULL
		,[Detail]			NVARCHAR(MAX)	NULL
		,[Tags]				NVARCHAR(MAX)	NULL
		,[LoggedDt]			DATETIMEOFFSET	NULL
		,[StampId]			NVARCHAR(64)	NULL
		,[RecognitionId]	NVARCHAR(64)	NULL
		,[Score]			FLOAT			NULL
		,[VectorRank]		INT				NULL
		,[Shown]			BIT				NULL
		,[Repeated]			BIT				NOT NULL	DEFAULT(0)
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE BATCH, THEN APPEND THE ROWS.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_AppendOutcomes: the calling login maps to no sandbox.', 1

		;IF ( @p_Outcomes IS NULL OR ISJSON(@p_Outcomes, ARRAY) <> 1 )
			THROW 50000, 'mem.usp_AppendOutcomes: @p_Outcomes must be a JSON array.', 1

		/* Parse the Batch Into Typed Rows. */
		;INSERT INTO @Incoming (
			 [Segment]
			,[ActionKey]
			,[Result]
			,[Summary]
			,[Detail]
			,[Tags]
			,[LoggedDt]
			,[StampId]
			,[RecognitionId]
			,[Score]
			,[VectorRank]
			,[Shown]	)
		SELECT	 [Segment]		= NULLIF(LTRIM(RTRIM(J.[Segment])), '')
				,[ActionKey]	= NULLIF(LTRIM(RTRIM(J.[ActionKey])), '')
				,[Result]		= COALESCE(J.[Result], N'')
				,[Summary]		= COALESCE(J.[Summary], N'')
				,[Detail]		= J.[Detail]
				,[Tags]			= J.[Tags]
				,[LoggedDt]		= J.[LoggedDt]
				,[StampId]		= NULLIF(LTRIM(RTRIM(J.[StampId])), '')
				,[RecognitionId]	= NULLIF(LTRIM(RTRIM(J.[RecognitionId])), '')
				,[Score]		= J.[Score]
				,[VectorRank]	= J.[VectorRank]
				,[Shown]		= J.[Shown]
		FROM	OPENJSON(@p_Outcomes)
				WITH (	 [Segment]		NVARCHAR(400)	'$.segment'
						,[ActionKey]	NVARCHAR(200)	'$.actionKey'
						,[Result]		NVARCHAR(50)	'$.result'
						,[Summary]		NVARCHAR(MAX)	'$.summary'
						,[Detail]		NVARCHAR(MAX)	'$.detail'
						,[Tags]			NVARCHAR(MAX)	'$.tags' AS JSON
						,[LoggedDt]		DATETIMEOFFSET	'$.at'
						,[StampId]		NVARCHAR(64)	'$.stampId'
						,[RecognitionId]	NVARCHAR(64)	'$.recognitionId'
						,[Score]		FLOAT			'$.score'
						,[VectorRank]	INT				'$.vectorRank'
						,[Shown]		BIT				'$.shown'	) J

		/* Refuse a Row Missing Its Store, Its Key or Its Time. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	I.[Segment] IS NULL
								OR I.[ActionKey] IS NULL
								OR I.[LoggedDt] IS NULL	)
			THROW 50000, 'mem.usp_AppendOutcomes: every outcome needs a segment, an actionKey and an at timestamp.', 1

		/* Mark the Second and Later Copies of One Stamp Id Inside This Batch. */
		;WITH Repeats AS (
			SELECT	 [Repeated]
					,[Place]	= ROW_NUMBER() OVER (	PARTITION BY [StampId]
														ORDER BY ( SELECT NULL )	)
			FROM	@Incoming
			WHERE	[StampId] IS NOT NULL
		)
		UPDATE	Repeats
		SET		[Repeated] = @True
		WHERE	[Place] > 1

		;SELECT	@Received = COUNT(*)
		FROM	@Incoming I

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* Create the Caller's Project Stores the Batch Names for the First Time. */
		;INSERT INTO mem.Store (
			 [SandboxId]
			,[Tier]
			,[Segment]	)
		SELECT	DISTINCT
				 [SandboxId]	= @SandboxId
				,[Tier]			= 'project'
				,[Segment]		= I.[Segment]
		FROM	@Incoming I
		WHERE	NOT EXISTS (	SELECT	NULL
								FROM	mem.Store S
								WHERE	S.[Tier] = 'project'
										AND S.[SandboxId] = @SandboxId
										AND S.[Segment] = I.[Segment]	)

		/* Append the Rows This Sandbox Does Not Already Hold, Against the Caller's Own Stores. */
		;INSERT INTO mem.Outcome (
			 [StoreId]
			,[ActionKey]
			,[SandboxId]
			,[LoggedDt]
			,[Result]
			,[Summary]
			,[Detail]
			,[Tags]
			,[StampId]
			,[RecognitionId]
			,[Score]
			,[VectorRank]
			,[Shown]		)
		SELECT	 [StoreId]		= S.[StoreId]
				,[ActionKey]	= I.[ActionKey]
				,[SandboxId]	= @SandboxId
				,[LoggedDt]		= I.[LoggedDt]
				,[Result]		= I.[Result]
				,[Summary]		= I.[Summary]
				,[Detail]		= I.[Detail]
				,[Tags]			= I.[Tags]
				,[StampId]		= I.[StampId]
				,[RecognitionId]	= I.[RecognitionId]
				,[Score]		= I.[Score]
				,[VectorRank]	= I.[VectorRank]
				,[Shown]		= I.[Shown]
		FROM	@Incoming I
				INNER JOIN mem.Store S
					ON	S.[Tier] = 'project'
					AND S.[SandboxId] = @SandboxId
					AND S.[Segment] = I.[Segment]
		WHERE	I.[Repeated] = @False
				AND NOT EXISTS (	SELECT	NULL
									FROM	mem.Outcome O WITH ( UPDLOCK, HOLDLOCK )
									WHERE	O.[SandboxId] = @SandboxId
											AND O.[StampId] = I.[StampId]
											AND O.[StampId] IS NOT NULL	)

		;SET @Appended = @@ROWCOUNT

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [appended]	= @Appended
									,[skipped]	= @Received - @Appended
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
