-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_PutPairVerdict', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_PutPairVerdict AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_PutPairVerdict
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Tier			VARCHAR(20)		= NULL
	,@p_ProjectKey		NVARCHAR(400)	= NULL
	,@p_TypeName		NVARCHAR(400)	= NULL
	,@p_NameA			NVARCHAR(200)	= NULL
	,@p_NameB			NVARCHAR(200)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_PutPairVerdict
		AUTHOR:		Scott Applefeld
		DATE:		October 12th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/12/2026 - SCOTT APPLEFELD
							Schema version 12. Records that two records of one store
							are two different facts, for the calling sandbox. The store
							is named by its tier and key exactly as mem.usp_ArchiveRecord
							names it: a project store by @p_ProjectKey, a type store by
							@p_TypeName, the operator store by neither. The two names
							are trimmed and ordered under the database's collation, so
							a pair sent in either order is the one row. Two names that
							are one name after the trim are refused.

							Each name resolves to the newest undeleted row of it in the
							store, as it does in every procedure that resolves a record
							by name. A name with no such row answers absent and an
							archived row answers archived, the lower name answered
							first, and either writes nothing. Otherwise the pair's row
							is inserted with the 'two-facts' verdict, or its judged
							time and judging sandbox move to now, under UPDLOCK and
							HOLDLOCK, so two verdicts on one pair queue rather than
							both inserting. The caller's sandbox comes from
							mem.CallerSandbox() and an unmapped login is refused.

							Returns one row, one column [Json], holding {status},
							status stored, absent:<name> or archived:<name>.
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
			,@Now				DATETIMEOFFSET	= SYSDATETIMEOFFSET()
			,@EntryTranCount	INT				= @@TRANCOUNT
			,@SandboxId			INT				= NULL
			,@StoreId			INT				= NULL
			,@Status			NVARCHAR(220)	= NULL
			,@Tier				VARCHAR(20)		= LOWER(LTRIM(RTRIM(@p_Tier)))
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')
			,@TypeName			NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_TypeName)), '')
			,@First				NVARCHAR(200)	= NULLIF(LTRIM(RTRIM(@p_NameA)), '')
			,@Second			NVARCHAR(200)	= NULLIF(LTRIM(RTRIM(@p_NameB)), '')
			,@NameA				NVARCHAR(200)	= NULL
			,@NameB				NVARCHAR(200)	= NULL

	/* The Row Each Name Resolves To. */
	;DECLARE @RecordIdA			BIGINT			= NULL
			,@IsArchivedA		BIT				= NULL
			,@RecordIdB			BIGINT			= NULL
			,@IsArchivedB		BIT				= NULL

	/********************************************************************************************
		VALIDATE THE CALLER, RESOLVE THE PAIR, AND RECORD THE VERDICT.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_PutPairVerdict: the calling login maps to no sandbox.', 1

		;IF ( @First IS NULL OR @Second IS NULL OR @Tier IS NULL OR @Tier NOT IN ('project', 'type', 'operator') )
			THROW 50000, 'mem.usp_PutPairVerdict: @p_NameA, @p_NameB and a @p_Tier of project, type or operator are required.', 1

		;IF ( @First = @Second )
			THROW 50000, 'mem.usp_PutPairVerdict: @p_NameA and @p_NameB must name two different records.', 1

		/* Order the Names as the Table Keys Them. */
		;SET @NameA = CASE WHEN @First < @Second THEN @First ELSE @Second END
		;SET @NameB = CASE WHEN @First < @Second THEN @Second ELSE @First END

		/* The Named Store, Resolved as mem.usp_ArchiveRecord Resolves It. */
		;SELECT	@StoreId = S.[StoreId]
		FROM	mem.Store S
		WHERE	S.[Tier] = @Tier
				AND S.[SandboxId] IS NULL
				AND EXISTS (	SELECT S.[ProjectKey], CASE WHEN S.[Tier] = 'type' THEN S.[Segment] END
								INTERSECT
								SELECT @ProjectKey, @TypeName	)

		/* The Newest Undeleted Row of Each Name in That Store, Archived or Not. */
		;SELECT	TOP ( 1 )
				 @RecordIdA		= R.[RecordId]
				,@IsArchivedA	= R.[IsArchived]
		FROM	mem.Record R
		WHERE	R.[StoreId] = @StoreId
				AND R.[Name] = @NameA
				AND R.[DeletedDt] IS NULL
		ORDER BY R.[RecordId] DESC

		;SELECT	TOP ( 1 )
				 @RecordIdB		= R.[RecordId]
				,@IsArchivedB	= R.[IsArchived]
		FROM	mem.Record R
		WHERE	R.[StoreId] = @StoreId
				AND R.[Name] = @NameB
				AND R.[DeletedDt] IS NULL
		ORDER BY R.[RecordId] DESC

		/* A Name With No Live Row Writes Nothing, the Lower Name Answered First. */
		;SET @Status = CASE
							WHEN @RecordIdA IS NULL THEN CONCAT(N'absent:', @NameA)
							WHEN @IsArchivedA = @True THEN CONCAT(N'archived:', @NameA)
							WHEN @RecordIdB IS NULL THEN CONCAT(N'absent:', @NameB)
							WHEN @IsArchivedB = @True THEN CONCAT(N'archived:', @NameB)
						 END

		;IF ( @Status IS NULL )
		BEGIN
			/* Open a Transaction Unless the Caller Holds One. */
			;IF ( @EntryTranCount = 0 )
				BEGIN TRANSACTION

			/* Move the Pair's Judged Time, Read Under a Range Lock Held to the End of the Transaction. */
			;UPDATE	V
			SET		 [JudgedDt]				= @Now
					,[JudgedBySandboxId]	= @SandboxId
					,[UpdatedDt]			= @Now
			FROM	mem.PairVerdict V WITH ( UPDLOCK, HOLDLOCK )
			WHERE	V.[StoreId] = @StoreId
					AND V.[NameA] = @NameA
					AND V.[NameB] = @NameB

			/* Give the Pair a Row Where It Has None, Under the Same Lock. */
			;INSERT INTO mem.PairVerdict (
				 [StoreId]
				,[NameA]
				,[NameB]
				,[Verdict]
				,[JudgedDt]
				,[JudgedBySandboxId]
				,[CreatedDt]
				,[UpdatedDt]	)
			SELECT	 [StoreId]				= @StoreId
					,[NameA]				= @NameA
					,[NameB]				= @NameB
					,[Verdict]				= 'two-facts'
					,[JudgedDt]				= @Now
					,[JudgedBySandboxId]	= @SandboxId
					,[CreatedDt]			= @Now
					,[UpdatedDt]			= @Now
			WHERE	NOT EXISTS (	SELECT	NULL
									FROM	mem.PairVerdict V WITH ( UPDLOCK, HOLDLOCK )
									WHERE	V.[StoreId] = @StoreId
											AND V.[NameA] = @NameA
											AND V.[NameB] = @NameB	)

			/* Commit Only a Transaction This Procedure Opened. */
			;IF ( @EntryTranCount = 0 )
				COMMIT TRANSACTION

			;SET @Status = N'stored'
		END

		/****************************************************************************************
			DATASET 1: THE ANSWER
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	[status]	= @Status
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
