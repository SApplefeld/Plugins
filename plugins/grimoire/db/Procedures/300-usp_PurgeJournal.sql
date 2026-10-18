-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_PurgeJournal', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_PurgeJournal AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_PurgeJournal
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_PurgeJournal
		AUTHOR:		Scott Applefeld
		DATE:		October 18th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/18/2026 - SCOTT APPLEFELD
							Deletes the calling sandbox's journal rows older than their
							retention: mem.TurnMeter rows whose turn ended more than
							@TurnMeterDays ago, mem.Outcome rows logged more than
							@OutcomeDays ago, and mem.RecordStamp rows written more than
							@RecordStampDays ago. The sandbox is resolved from the caller's
							login, so a publisher removes only what its own machine wrote,
							and an unmapped login is refused and deletes nothing.

							Each table's delete is its own statement, cut at @BatchSize
							rows, with no transaction over the three: the tables carry no
							cross-table invariant, so a fault after one delete leaves the
							earlier deletes standing and nothing inconsistent. A call
							removes at most @BatchSize rows per table, and a memq
							db-refresh whose drain finished calls it once as its last step
							while run time remains, so a machine returning after a long gap
							catches up over a few runs.

							The retention bounds the replay guards the rows serve: a stamp
							resent after its row is gone is applied again, and an outcome
							resent after its row is gone lands twice. The windows are the
							constants declared below, so a change is one edit here and an
							installer run.

							It is the only procedure that deletes from mem.TurnMeter,
							mem.Outcome or mem.RecordStamp. It runs under ownership
							chaining, procedure and tables both owned by dbo, so DENY
							DELETE ON SCHEMA::mem stays in force for every role, and
							EXECUTE on this procedure is the only grant it needs.

							Returns one row, one column [Json], holding {turnMeter, outcome,
							recordStamp}, the rows deleted from each table.
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
	/* Retention in Days per Table, and the Rows One Call Removes per Table. */
	;DECLARE @TurnMeterDays		INT				= 180
			,@OutcomeDays		INT				= 180
			,@RecordStampDays	INT				= 90
			,@BatchSize			INT				= 5000

	;DECLARE @SandboxId			INT				= NULL
			,@Now				DATETIMEOFFSET	= SYSDATETIMEOFFSET()

	/* Result Counts. */
	;DECLARE @TurnMeter			INT				= 0
			,@Outcome			INT				= 0
			,@RecordStamp		INT				= 0

	/********************************************************************************************
		VALIDATE THE CALLER, THEN DELETE EACH TABLE'S EXPIRED ROWS IN ONE BATCH.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Deletes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_PurgeJournal: the calling login maps to no sandbox.', 1

		/* The Caller's Turns That Ended Before the Retention Window. */
		;DELETE TOP ( @BatchSize ) T
		FROM	mem.TurnMeter T
		WHERE	T.[SandboxId] = @SandboxId
				AND T.[EndedDt] < DATEADD(DAY, -@TurnMeterDays, @Now)

		;SET @TurnMeter = @@ROWCOUNT

		/* The Caller's Outcomes Logged Before the Retention Window. */
		;DELETE TOP ( @BatchSize ) O
		FROM	mem.Outcome O
		WHERE	O.[SandboxId] = @SandboxId
				AND O.[LoggedDt] < DATEADD(DAY, -@OutcomeDays, @Now)

		;SET @Outcome = @@ROWCOUNT

		/* The Caller's Stamps Written Before the Retention Window. */
		;DELETE TOP ( @BatchSize ) S
		FROM	mem.RecordStamp S
		WHERE	S.[WrittenBySandboxId] = @SandboxId
				AND S.[CreatedDt] < DATEADD(DAY, -@RecordStampDays, @Now)

		;SET @RecordStamp = @@ROWCOUNT

		/****************************************************************************************
			DATASET 1: THE COUNTS
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [turnMeter]	= @TurnMeter
									,[outcome]		= @Outcome
									,[recordStamp]	= @RecordStamp
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER	)
	END TRY
	BEGIN CATCH
		/* Re-Raise so the Caller Never Reads Success From a Failed Delete. */
		;THROW
	END CATCH
END
GO
