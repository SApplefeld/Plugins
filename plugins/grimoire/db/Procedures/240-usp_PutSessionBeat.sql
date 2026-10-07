-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_PutSessionBeat', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_PutSessionBeat AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_PutSessionBeat
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Beats			NVARCHAR(MAX)
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_PutSessionBeat
		AUTHOR:		Scott Applefeld
		DATE:		October 5th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/05/2026 - SCOTT APPLEFELD
							Upserts one batch of session beats for the calling sandbox.
							@p_Beats is a JSON array of objects {sessionId, persona,
							cwd, beat, lastTurnId, turnOpen}. The sandbox is resolved
							from the caller's login and is never read from the batch.

							A session with no row takes one. A session whose row this
							sandbox holds takes the incoming values only where the
							incoming beat is later than the row's, so a beat that
							arrives after a newer one changes nothing. Rows are keyed
							by sandbox and session id, so one sandbox's row never takes
							the place of another's. Within one
							batch the latest beat of a session is the one applied. The
							rows are read under UPDLOCK and HOLDLOCK, so two deliveries
							for one session queue rather than both reading the row they
							replace.

							A beat missing its session id or a readable beat time is
							rejected and counted rather than written. Each text is cut
							to its column's width.

							Returns one row, one column [Json], holding {stored, kept,
							rejected}: the rows inserted or moved to a later beat, the
							rows left as they were, and the beats refused.
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
	;DECLARE @Received			INT				= 0
			,@Stored			INT				= 0
			,@Rejected			INT				= 0

	/* The Batch as Typed Rows, in the Order It Arrived. */
	;DECLARE @Incoming TABLE (
		 [Ordinal]			INT				NOT NULL
		,[SessionId]		NVARCHAR(100)	NULL
		,[Persona]			NVARCHAR(200)	NULL
		,[Cwd]				NVARCHAR(400)	NULL
		,[BeatDt]			DATETIMEOFFSET	NULL
		,[LastTurnId]		NVARCHAR(200)	NULL
		,[TurnOpen]			BIT				NULL
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE BATCH, THEN UPSERT EACH SESSION'S LATEST BEAT.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_PutSessionBeat: the calling login maps to no sandbox.', 1

		;IF ( @p_Beats IS NULL OR ISJSON(@p_Beats, ARRAY) <> @True )
			THROW 50000, 'mem.usp_PutSessionBeat: @p_Beats must be a JSON array.', 1

		/* Parse the Batch; Every Value Arrives as Text and is Read Into Its Type Without a Conversion Error. */
		;INSERT INTO @Incoming (
			 [Ordinal]
			,[SessionId]
			,[Persona]
			,[Cwd]
			,[BeatDt]
			,[LastTurnId]
			,[TurnOpen]		)
		SELECT	 [Ordinal]		= TRY_CAST(A.[key] AS INT)
				,[SessionId]	= LEFT(NULLIF(LTRIM(RTRIM(J.[SessionId])), ''), 100)
				,[Persona]		= LEFT(NULLIF(J.[Persona], ''), 200)
				,[Cwd]			= LEFT(NULLIF(J.[Cwd], ''), 400)
				,[BeatDt]		= TRY_CAST(J.[Beat] AS DATETIMEOFFSET)
				,[LastTurnId]	= LEFT(NULLIF(J.[LastTurnId], ''), 200)
				,[TurnOpen]		= CASE WHEN J.[TurnOpen] = N'true' THEN @True ELSE @False END
		FROM	OPENJSON(@p_Beats) A
				CROSS APPLY OPENJSON(CASE WHEN A.[type] = 5 THEN A.[value] ELSE N'{}' END)
				WITH (	 [SessionId]	NVARCHAR(MAX)	'$.sessionId'
						,[Persona]		NVARCHAR(MAX)	'$.persona'
						,[Cwd]			NVARCHAR(MAX)	'$.cwd'
						,[Beat]			NVARCHAR(100)	'$.beat'
						,[LastTurnId]	NVARCHAR(MAX)	'$.lastTurnId'
						,[TurnOpen]		NVARCHAR(10)	'$.turnOpen'	) J

		/* Count the Beats Missing a Session or a Time, and Drop Them. */
		;SELECT	@Rejected = COUNT(*)
		FROM	@Incoming I
		WHERE	I.[SessionId] IS NULL
				OR I.[BeatDt] IS NULL

		;DELETE	I
		FROM	@Incoming I
		WHERE	I.[SessionId] IS NULL
				OR I.[BeatDt] IS NULL

		/* Keep the Latest Beat of Each Session the Batch Carries, the Later Row on a Tie. */
		;WITH cteRanked AS (
			SELECT	[Rank] = ROW_NUMBER() OVER ( PARTITION BY I.[SessionId] ORDER BY I.[BeatDt] DESC, I.[Ordinal] DESC )
			FROM	@Incoming I
		)
		DELETE	R
		FROM	cteRanked R
		WHERE	R.[Rank] > 1

		;SELECT	@Received = COUNT(*)
		FROM	@Incoming I

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* Move This Sandbox's Rows to a Later Beat, Read Under a Range Lock Held to the End of the Transaction. */
		;UPDATE	B
		SET		 [Persona]			= I.[Persona]
				,[WorkingDirectory]	= I.[Cwd]
				,[LastBeatDt]		= I.[BeatDt]
				,[LastTurnId]		= I.[LastTurnId]
				,[TurnOpen]			= I.[TurnOpen]
				,[UpdatedDt]		= SYSDATETIMEOFFSET()
		FROM	mem.SessionBeat B WITH ( UPDLOCK, HOLDLOCK )
				INNER JOIN @Incoming I
					ON I.[SessionId] = B.[SessionId]
		WHERE	B.[SandboxId] = @SandboxId
				AND I.[BeatDt] > B.[LastBeatDt]

		;SET @Stored = @@ROWCOUNT

		/* Give a Row to Each Session That Has None, Under the Same Lock. */
		;INSERT INTO mem.SessionBeat (
			 [SessionId]
			,[SandboxId]
			,[Persona]
			,[WorkingDirectory]
			,[LastBeatDt]
			,[LastTurnId]
			,[TurnOpen]			)
		SELECT	 [SessionId]		= I.[SessionId]
				,[SandboxId]		= @SandboxId
				,[Persona]			= I.[Persona]
				,[WorkingDirectory]	= I.[Cwd]
				,[LastBeatDt]		= I.[BeatDt]
				,[LastTurnId]		= I.[LastTurnId]
				,[TurnOpen]			= I.[TurnOpen]
		FROM	@Incoming I
		WHERE	NOT EXISTS (	SELECT	NULL
								FROM	mem.SessionBeat B WITH ( UPDLOCK, HOLDLOCK )
								WHERE	B.[SandboxId] = @SandboxId
										AND B.[SessionId] = I.[SessionId]	)

		;SET @Stored = @Stored + @@ROWCOUNT

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [stored]	= @Stored
									,[kept]		= @Received - @Stored
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
