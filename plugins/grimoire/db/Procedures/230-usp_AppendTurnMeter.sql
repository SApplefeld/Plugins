-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_AppendTurnMeter', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_AppendTurnMeter AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_AppendTurnMeter
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Turns			NVARCHAR(MAX)
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_AppendTurnMeter
		AUTHOR:		Scott Applefeld
		DATE:		October 5th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/05/2026 - SCOTT APPLEFELD
							Appends one batch of metered turns for the calling sandbox.
							@p_Turns is a JSON array of objects {sessionId, turnId,
							persona, goalId, planPath, trigger, model, inputTokens,
							outputTokens, cacheReadTokens, cacheCreationTokens,
							jevCalls, jevLatencyMs, started, ended}. The sandbox is
							resolved from the caller's login and is never read from
							the batch.

							Each row is inserted only where mem.TurnMeter holds no row
							for the caller's sandbox, its session id and its turn id,
							so one sandbox's row never takes the place of another's,
							and a batch sent again
							inserts nothing: a drain that dies after the host answered
							sends its file again and adds no row. The check reads
							mem.TurnMeter under UPDLOCK and HOLDLOCK, so two deliveries
							of one turn queue rather than one dying on the unique index.
							Within one batch the first row of a session and turn wins.

							A row missing its session id, its turn id or a readable
							ended time is rejected and counted rather than written, so
							one bad line never refuses the rows beside it. A count or
							time that does not read as its type is stored as NULL, a
							negative count as NULL, and each text is cut to its
							column's width.

							Returns one row, one column [Json], holding {inserted,
							rejected}.
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

	/* Result Counts. */
	;DECLARE @Inserted			INT				= 0
			,@Rejected			INT				= 0

	/* The Batch as Typed Rows, in the Order It Arrived. */
	;DECLARE @Incoming TABLE (
		 [Ordinal]				INT				NOT NULL
		,[SessionId]			NVARCHAR(100)	NULL
		,[TurnId]				NVARCHAR(200)	NULL
		,[Persona]				NVARCHAR(200)	NULL
		,[GoalId]				NVARCHAR(100)	NULL
		,[PlanPath]				NVARCHAR(400)	NULL
		,[Trigger]				VARCHAR(40)		NULL
		,[Model]				NVARCHAR(200)	NULL
		,[InputTokens]			BIGINT			NULL
		,[OutputTokens]			BIGINT			NULL
		,[CacheReadTokens]		BIGINT			NULL
		,[CacheCreationTokens]	BIGINT			NULL
		,[JevCalls]				INT				NULL
		,[JevLatencyMs]			BIGINT			NULL
		,[StartedDt]			DATETIMEOFFSET	NULL
		,[EndedDt]				DATETIMEOFFSET	NULL
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE BATCH, THEN INSERT EACH TURN NOT ALREADY HELD.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_AppendTurnMeter: the calling login maps to no sandbox.', 1

		;IF ( @p_Turns IS NULL OR ISJSON(@p_Turns, ARRAY) <> @True )
			THROW 50000, 'mem.usp_AppendTurnMeter: @p_Turns must be a JSON array.', 1

		/* Parse the Batch; Every Value Arrives as Text and is Read Into Its Type Without a Conversion Error. */
		;INSERT INTO @Incoming (
			 [Ordinal]
			,[SessionId]
			,[TurnId]
			,[Persona]
			,[GoalId]
			,[PlanPath]
			,[Trigger]
			,[Model]
			,[InputTokens]
			,[OutputTokens]
			,[CacheReadTokens]
			,[CacheCreationTokens]
			,[JevCalls]
			,[JevLatencyMs]
			,[StartedDt]
			,[EndedDt]				)
		SELECT	 [Ordinal]				= TRY_CAST(A.[key] AS INT)
				,[SessionId]			= LEFT(NULLIF(LTRIM(RTRIM(J.[SessionId])), ''), 100)
				,[TurnId]				= LEFT(NULLIF(LTRIM(RTRIM(J.[TurnId])), ''), 200)
				,[Persona]				= LEFT(NULLIF(J.[Persona], ''), 200)
				,[GoalId]				= LEFT(NULLIF(J.[GoalId], ''), 100)
				,[PlanPath]				= LEFT(NULLIF(J.[PlanPath], ''), 400)
				,[Trigger]				= LEFT(NULLIF(J.[Trigger], ''), 40)
				,[Model]				= LEFT(NULLIF(J.[Model], ''), 200)
				,[InputTokens]			= CASE WHEN TRY_CAST(J.[InputTokens] AS BIGINT) >= 0 THEN TRY_CAST(J.[InputTokens] AS BIGINT) END
				,[OutputTokens]			= CASE WHEN TRY_CAST(J.[OutputTokens] AS BIGINT) >= 0 THEN TRY_CAST(J.[OutputTokens] AS BIGINT) END
				,[CacheReadTokens]		= CASE WHEN TRY_CAST(J.[CacheReadTokens] AS BIGINT) >= 0 THEN TRY_CAST(J.[CacheReadTokens] AS BIGINT) END
				,[CacheCreationTokens]	= CASE WHEN TRY_CAST(J.[CacheCreationTokens] AS BIGINT) >= 0 THEN TRY_CAST(J.[CacheCreationTokens] AS BIGINT) END
				,[JevCalls]				= CASE WHEN TRY_CAST(J.[JevCalls] AS INT) >= 0 THEN TRY_CAST(J.[JevCalls] AS INT) END
				,[JevLatencyMs]			= CASE WHEN TRY_CAST(J.[JevLatencyMs] AS BIGINT) >= 0 THEN TRY_CAST(J.[JevLatencyMs] AS BIGINT) END
				,[StartedDt]			= TRY_CAST(J.[Started] AS DATETIMEOFFSET)
				,[EndedDt]				= TRY_CAST(J.[Ended] AS DATETIMEOFFSET)
		FROM	OPENJSON(@p_Turns) A
				CROSS APPLY OPENJSON(CASE WHEN A.[type] = 5 THEN A.[value] ELSE N'{}' END)
				WITH (	 [SessionId]			NVARCHAR(MAX)	'$.sessionId'
						,[TurnId]				NVARCHAR(MAX)	'$.turnId'
						,[Persona]				NVARCHAR(MAX)	'$.persona'
						,[GoalId]				NVARCHAR(MAX)	'$.goalId'
						,[PlanPath]				NVARCHAR(MAX)	'$.planPath'
						,[Trigger]				NVARCHAR(MAX)	'$.trigger'
						,[Model]				NVARCHAR(MAX)	'$.model'
						,[InputTokens]			NVARCHAR(100)	'$.inputTokens'
						,[OutputTokens]			NVARCHAR(100)	'$.outputTokens'
						,[CacheReadTokens]		NVARCHAR(100)	'$.cacheReadTokens'
						,[CacheCreationTokens]	NVARCHAR(100)	'$.cacheCreationTokens'
						,[JevCalls]				NVARCHAR(100)	'$.jevCalls'
						,[JevLatencyMs]			NVARCHAR(100)	'$.jevLatencyMs'
						,[Started]				NVARCHAR(100)	'$.started'
						,[Ended]				NVARCHAR(100)	'$.ended'	) J

		/* Count the Rows Missing an Identity or an End, and Drop Them. */
		;SELECT	@Rejected = COUNT(*)
		FROM	@Incoming I
		WHERE	I.[SessionId] IS NULL
				OR I.[TurnId] IS NULL
				OR I.[EndedDt] IS NULL

		;DELETE	I
		FROM	@Incoming I
		WHERE	I.[SessionId] IS NULL
				OR I.[TurnId] IS NULL
				OR I.[EndedDt] IS NULL

		/* Keep the First Row of Each Session and Turn the Batch Carries. */
		;WITH cteRanked AS (
			SELECT	[Rank] = ROW_NUMBER() OVER ( PARTITION BY I.[SessionId], I.[TurnId] ORDER BY I.[Ordinal] )
			FROM	@Incoming I
		)
		DELETE	R
		FROM	cteRanked R
		WHERE	R.[Rank] > 1

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* Insert Each Turn the Table Holds No Row For, Read Under a Range Lock Held to the End of the Transaction. */
		;INSERT INTO mem.TurnMeter (
			 [SandboxId]
			,[SessionId]
			,[TurnId]
			,[Persona]
			,[GoalId]
			,[PlanPath]
			,[Trigger]
			,[Model]
			,[InputTokens]
			,[OutputTokens]
			,[CacheReadTokens]
			,[CacheCreationTokens]
			,[JevCalls]
			,[JevLatencyMs]
			,[StartedDt]
			,[EndedDt]				)
		SELECT	 [SandboxId]			= @SandboxId
				,[SessionId]			= F.[SessionId]
				,[TurnId]				= F.[TurnId]
				,[Persona]				= F.[Persona]
				,[GoalId]				= F.[GoalId]
				,[PlanPath]				= F.[PlanPath]
				,[Trigger]				= F.[Trigger]
				,[Model]				= F.[Model]
				,[InputTokens]			= F.[InputTokens]
				,[OutputTokens]			= F.[OutputTokens]
				,[CacheReadTokens]		= F.[CacheReadTokens]
				,[CacheCreationTokens]	= F.[CacheCreationTokens]
				,[JevCalls]				= F.[JevCalls]
				,[JevLatencyMs]			= F.[JevLatencyMs]
				,[StartedDt]			= F.[StartedDt]
				,[EndedDt]				= F.[EndedDt]
		FROM	@Incoming F
		WHERE	NOT EXISTS (	SELECT	NULL
								FROM	mem.TurnMeter T WITH ( UPDLOCK, HOLDLOCK )
								WHERE	T.[SandboxId] = @SandboxId
										AND T.[SessionId] = F.[SessionId]
										AND T.[TurnId] = F.[TurnId]	)

		;SET @Inserted = @@ROWCOUNT

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [inserted]	= @Inserted
									,[rejected]	= @Rejected
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER	)
	END TRY
	BEGIN CATCH
		/* Unwind Only a Transaction This Procedure Opened; a Caller's is the Caller's to Unwind. */
		;IF ( XACT_STATE() <> 0 AND @EntryTranCount = 0 )
			ROLLBACK TRANSACTION

		/* Re-Raise so the Caller Never Reads Success From a Failed Write. */
		;THROW
	END CATCH
END
GO
