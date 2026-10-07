-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_AdoptProjectStore', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_AdoptProjectStore AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_AdoptProjectStore
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_FromKey			NVARCHAR(4000)	= NULL
	,@p_ToKey			NVARCHAR(4000)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_AdoptProjectStore
		AUTHOR:		Scott Applefeld
		DATE:		October 3rd, 2026
		VERSION:	v1.3
	*********************************************************************************************
		NOTES:		v1.3 - 10/05/2026
							The declared limit of the usage fold below states both ways a
							winner's count can read low. No behavior changes.

					v1.2 - 10/04/2026
							Usage is one mem.RecordUsage row per record, so a dropped
							loser passes its usage to the winning row by a fold rather
							than by moving rows. [LastReadDt] and [LastAppliedDt] take the
							later of the two rows' values, the loser's applied dates enter
							the winner's list under mem.udf_MergeAppliedDates, the rule
							mem.usp_AppendUsage counts by, and [AppliedDays] rises by the
							dates that rule counts new. A winner with no usage row takes
							the loser's as it stands. The loser's usage row is deleted
							before the loser's own row, whose foreign key it would
							otherwise hold. Declared limit: the winner's count can read low
							in two ways. A loser holding more than sixteen applied days
							passes on only the sixteen dates its list holds. And where the
							winner's list already holds sixteen dates, a loser's date
							earlier than all of them is not counted, so the count never
							falls below sixteen where that happens.

					v1.1 - 10/04/2026 - SCOTT APPLEFELD
							A call whose @p_FromKey names no store answers the empty result,
							every count zero and both name lists empty, before it takes the
							fleet publish lock, so a refresh with no folder store to adopt waits
							behind no publish lock.

							v1.0 - 10/03/2026 - SCOTT APPLEFELD
							Moves a project's records from the fleet store keyed by its
							folder name, @p_FromKey, which opens path:, into the fleet store
							keyed by its git remote, @p_ToKey, which opens remote:, creating
							that store where absent. Both prefixes compare case-sensitively.
							Any other pair of keys is refused and nothing is written, and so
							is a key longer than the 400 characters a store's key holds,
							which the parameters take whole so that no longer key is cut
							to name another store. The caller's sandbox comes from
							mem.CallerSandbox() and an unmapped login is refused.

							A row moves by its [StoreId] alone, so its embeddings and its
							mem.RecordUsage row, both keyed by its RecordId, travel with
							it. Where the target store holds a
							row of the same file key, compared under the database's
							collation, the two are one record, and the rules run in order.
							A target row whose name differs from the source row's, in case
							alone included where the target is deleted, or by more where it
							is not, leaves the source row in place, named as skipped. A
							deleted source row over a target row of its name changes
							nothing. A source row of [Origin] memq is never dropped: over a
							live, unarchived file-origin target it wins whatever the file
							times, and over any other target it stays in place, named as
							skipped. Otherwise the target row wins unless it is live,
							neither archived nor deleted, of [Origin] file, and older by
							[FileModifiedDt] than the source row.

							No losing copy is stored in any store: the loser is dropped and
							named in the return. Its mem.RecordUsage row folds into the
							winning row's and its mem.RecordStamp rows join the winning row,
							so the record's read history and its applied write stamps
							survive, and its mem.Embedding rows are
							deleted, so no vector describes a body no store holds. Then its
							row is removed. A winning source row takes the target store's
							slot with its own RecordId, embeddings and usage, and a winning
							target row stays as it is: a dropped row passes it no archive
							and no other field. Two live, unarchived rows that match in
							every published field but the file modification time, text
							compared under a binary collation so a change of case alone
							is a difference, are the same copy: the loser, the source row
							or the target row, is dropped the same way and named under no
							disposition, so no count reports it. So an adoption never
							writes or deletes a memq row, never clears an archived flag or
							a deleted mark, and writes no deleted row: a deleted row in the
							target store is one a database verb deleted, or a source row a
							verb deleted that moved with its mark. An adoption creates no
							store but the target. A second call changes nothing, since what
							stays in the source store is a named row left in place.

							Calls serialize with every publish on the fleet publish lock.
							Returns one row, one column [Json], holding {moved, merged,
							skipped, mergedNames, skippedNames}, a merged name being a
							record one of whose two rows was dropped as the loser, whatever
							body either held, unless the dropped row was the same copy, and
							a skipped name being a source row left in place.
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
			,@Now				DATETIMEOFFSET	= SYSDATETIMEOFFSET()
			,@SandboxId			INT				= NULL
			,@LockResult		INT				= NULL
			,@FromKey			NVARCHAR(4000)	= NULLIF(LTRIM(RTRIM(@p_FromKey)), '')
			,@ToKey				NVARCHAR(4000)	= NULLIF(LTRIM(RTRIM(@p_ToKey)), '')
			,@SourceStoreId		INT				= NULL
			,@TargetStoreId		INT				= NULL
			,@RecordId			BIGINT			= NULL
			,@TargetRecordId	BIGINT			= NULL
			,@Name				NVARCHAR(200)	= NULL
			,@SourceDeletedDt	DATETIMEOFFSET	= NULL
			,@SourceModifiedDt	DATETIMEOFFSET	= NULL
			,@SourceOrigin		VARCHAR(10)		= NULL
			,@TargetName		NVARCHAR(200)	= NULL
			,@TargetDeletedDt	DATETIMEOFFSET	= NULL
			,@TargetIsArchived	BIT				= NULL
			,@TargetOrigin		VARCHAR(10)		= NULL
			,@TargetModifiedDt	DATETIMEOFFSET	= NULL
			,@WinnerRecordId	BIGINT			= NULL
			,@LoserRecordId		BIGINT			= NULL
			,@Action			VARCHAR(10)		= NULL

	/* What the Adoption Did to Each Source Row. */
	;DECLARE @Outcome TABLE (
		 [RecordId]			BIGINT			NOT NULL
		,[Name]				NVARCHAR(200)	NOT NULL
		,[Disposition]		VARCHAR(10)		NOT NULL
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE KEYS, THEN MOVE THE ROWS AS ONE UNIT.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_AdoptProjectStore: the calling login maps to no sandbox.', 1

		/* Only a Folder-Name Key Is Adopted, and Only Into a Remote Key. */
		;IF (	@FromKey IS NULL
				OR @ToKey IS NULL
				OR LEFT(@FromKey, 5) COLLATE Latin1_General_CS_AS <> 'path:'
				OR LEFT(@ToKey, 7) COLLATE Latin1_General_CS_AS <> 'remote:'
				OR LEN(@FromKey) < 6
				OR LEN(@ToKey) < 8	)
			THROW 50000, 'mem.usp_AdoptProjectStore: @p_FromKey must open path: and @p_ToKey must open remote:.', 1

		/* A Key Longer Than a Store Holds Names No Store; Cut to 400 It Would Name Another. */
		;IF ( LEN(@FromKey) > 400 OR LEN(@ToKey) > 400 )
			THROW 50000, 'mem.usp_AdoptProjectStore: a project key holds at most 400 characters.', 1

		/* No Folder-Name Store Means Nothing to Adopt, So the Empty Answer Returns Before the Publish Lock. */
		;SELECT	@SourceStoreId = S.[StoreId]
		FROM	mem.Store S
		WHERE	S.[Tier] = 'project'
				AND S.[ProjectKey] = @FromKey

		;IF ( @SourceStoreId IS NULL )
		BEGIN
			;SELECT	[Json] = (	SELECT	 [moved]			= 0
										,[merged]			= 0
										,[skipped]			= 0
										,[mergedNames]		= JSON_QUERY(N'[]')
										,[skippedNames]		= JSON_QUERY(N'[]')
								FOR JSON PATH, WITHOUT_ARRAY_WRAPPER	)
			;RETURN
		END

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* An Adoption Takes the Fleet Publish Lock, so It Never Interleaves With a Publish of Either Store. */
		;EXEC @LockResult = sp_getapplock @Resource = 'mem.Publish', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000
		;IF ( @LockResult < 0 )
			THROW 50000, 'mem.usp_AdoptProjectStore: the fleet publish lock was not acquired before the wait timed out; another publish is holding it.', 1

		/****************************************************************************************
			RESOLVE THE TWO STORES.
		****************************************************************************************/
		;SELECT	@SourceStoreId = S.[StoreId]
		FROM	mem.Store S
		WHERE	S.[Tier] = 'project'
				AND S.[ProjectKey] = @FromKey

		;SELECT	@TargetStoreId = S.[StoreId]
		FROM	mem.Store S
		WHERE	S.[Tier] = 'project'
				AND S.[ProjectKey] = @ToKey

		;IF ( @SourceStoreId IS NOT NULL AND @TargetStoreId IS NULL )
		BEGIN
			;INSERT INTO mem.Store (
				 [SandboxId]
				,[Tier]
				,[Segment]
				,[ProjectKey]	)
			SELECT	 [SandboxId]	= NULL
					,[Tier]			= 'project'
					,[Segment]		= NULL
					,[ProjectKey]	= @ToKey

			;SET @TargetStoreId = SCOPE_IDENTITY()
		END

		/****************************************************************************************
			MOVE, MERGE OR LEAVE EACH SOURCE ROW.
		****************************************************************************************/
		;SELECT	@RecordId = MIN(R.[RecordId])
		FROM	mem.Record R
		WHERE	R.[StoreId] = @SourceStoreId

		;WHILE ( @RecordId IS NOT NULL )
		BEGIN
			;SELECT	 @Name				= R.[Name]
					,@SourceDeletedDt	= R.[DeletedDt]
					,@SourceModifiedDt	= R.[FileModifiedDt]
					,@SourceOrigin		= R.[Origin]
					,@TargetRecordId	= NULL
					,@TargetName		= NULL
					,@TargetDeletedDt	= NULL
					,@TargetIsArchived	= NULL
					,@TargetOrigin		= NULL
					,@TargetModifiedDt	= NULL
					,@WinnerRecordId	= NULL
					,@LoserRecordId		= NULL
					,@Action			= NULL
			FROM	mem.Record R
			WHERE	R.[RecordId] = @RecordId

			/* The Target Row of the Same File Key, Equal Under the Database's Collation. */
			;SELECT	 @TargetRecordId	= T.[RecordId]
					,@TargetName		= T.[Name]
					,@TargetDeletedDt	= T.[DeletedDt]
					,@TargetIsArchived	= T.[IsArchived]
					,@TargetOrigin		= T.[Origin]
					,@TargetModifiedDt	= T.[FileModifiedDt]
			FROM	mem.Record T
					INNER JOIN mem.Record R
						ON R.[RecordId] = @RecordId
			WHERE	T.[StoreId] = @TargetStoreId
					AND T.[FileKey] = R.[FileKey]

			/************************************************************************************
				DECIDE WHAT THE ROW DOES.
			************************************************************************************/
			;IF ( @TargetRecordId IS NULL )
			BEGIN
				/* No Target Row: the Row Moves, Its Embeddings and Usage With It. */
				;SET @Action = 'move'
			END
			ELSE IF (	( @TargetDeletedDt IS NULL AND @TargetName <> @Name )
						OR ( @TargetDeletedDt IS NOT NULL AND @TargetName COLLATE Latin1_General_CS_AS <> @Name COLLATE Latin1_General_CS_AS )	)
			BEGIN
				/* A Target Row of Another Name Holds the File Key: the Row Stays and is Named. A Deleted One Differing in Case Alone is Another Name. */
				;SET @Action = 'skip'
			END
			ELSE IF ( @SourceDeletedDt IS NOT NULL )
			BEGIN
				/* A Deleted Source Row Over a Target Row of Its Name Changes Nothing. */
				;SET @Action = NULL
			END
			ELSE IF ( @SourceOrigin = 'memq' )
			BEGIN
				/* A memq Source Row is Never Dropped: It Takes a Live, Unarchived File Target's Slot Whatever the Times, and Otherwise Stays and is Named. */
				;IF ( @TargetDeletedDt IS NULL AND @TargetIsArchived = @False AND @TargetOrigin = 'file' )
				BEGIN
					;SELECT	 @Action			= 'win'
							,@WinnerRecordId	= @RecordId
							,@LoserRecordId		= @TargetRecordId
				END ELSE BEGIN
					;SET @Action = 'skip'
				END
			END
			ELSE IF (	@TargetDeletedDt IS NULL
						AND @TargetIsArchived = @False
						AND @TargetOrigin = 'file'
						AND @SourceModifiedDt IS NOT NULL
						AND @TargetModifiedDt IS NOT NULL
						AND @SourceModifiedDt > @TargetModifiedDt	)
			BEGIN
				/* The Source Row Wins and the Target Row Loses. */
				;SELECT	 @Action			= 'win'
						,@WinnerRecordId	= @RecordId
						,@LoserRecordId		= @TargetRecordId
			END
			ELSE
			BEGIN
				/* The Target Row Wins and the Source Row Loses. */
				;SELECT	 @Action			= 'lose'
						,@WinnerRecordId	= @TargetRecordId
						,@LoserRecordId		= @RecordId
			END

			/* Two Live, Unarchived Rows Matching in Every Published Field but the File Time are the Same Copy: the Loser, Either One, is Dropped Unnamed. */
			/* Text Compares Under a Binary Collation, so a Change of Case Alone is a Difference. */
			;IF (	@Action IN ('win', 'lose')
					AND @TargetDeletedDt IS NULL
					AND @TargetIsArchived = @False
					AND EXISTS (	SELECT	 S.[Name] COLLATE Latin1_General_BIN2, S.[Description] COLLATE Latin1_General_BIN2
											,S.[Body] COLLATE Latin1_General_BIN2, S.[BodyHash] COLLATE Latin1_General_BIN2
											,S.[Machine] COLLATE Latin1_General_BIN2, S.[Tags] COLLATE Latin1_General_BIN2
											,S.[SupersedesName] COLLATE Latin1_General_BIN2, S.[IsArchived]
											,S.[Triggers] COLLATE Latin1_General_BIN2, S.[Anchors] COLLATE Latin1_General_BIN2
											,S.[IsPinned], S.[CreatedOn], S.[Author] COLLATE Latin1_General_BIN2
									FROM	mem.Record S
									WHERE	S.[RecordId] = @RecordId
									INTERSECT
									SELECT	 T.[Name] COLLATE Latin1_General_BIN2, T.[Description] COLLATE Latin1_General_BIN2
											,T.[Body] COLLATE Latin1_General_BIN2, T.[BodyHash] COLLATE Latin1_General_BIN2
											,T.[Machine] COLLATE Latin1_General_BIN2, T.[Tags] COLLATE Latin1_General_BIN2
											,T.[SupersedesName] COLLATE Latin1_General_BIN2, T.[IsArchived]
											,T.[Triggers] COLLATE Latin1_General_BIN2, T.[Anchors] COLLATE Latin1_General_BIN2
											,T.[IsPinned], T.[CreatedOn], T.[Author] COLLATE Latin1_General_BIN2
									FROM	mem.Record T
									WHERE	T.[RecordId] = @TargetRecordId	)	)
			BEGIN
				;SET @Action = 'same'
			END

			/************************************************************************************
				APPLY WHAT WAS DECIDED.
			************************************************************************************/
			;IF ( @LoserRecordId IS NOT NULL )
			BEGIN
				/* The Loser's Usage Folds Into the Winning Row's and Its Write Stamps Join the Winning Row, so Its Read History and Applied Stamps Survive It. */
				;UPDATE W
				SET		 [LastReadDt]		= GREATEST(W.[LastReadDt], L.[LastReadDt])
						,[LastAppliedDt]	= GREATEST(W.[LastAppliedDt], L.[LastAppliedDt])
						,[AppliedDays]		= W.[AppliedDays] + M.[NewDays]
						,[AppliedDates]		= M.[AppliedDates]
						,[UpdatedDt]		= @Now
				FROM	mem.RecordUsage W WITH ( UPDLOCK, HOLDLOCK )
						INNER JOIN mem.RecordUsage L WITH ( UPDLOCK, HOLDLOCK )
							ON L.[RecordId] = @LoserRecordId
						CROSS APPLY mem.udf_MergeAppliedDates(W.[AppliedDates], L.[AppliedDates]) M
				WHERE	W.[RecordId] = @WinnerRecordId

				/* A Winner With No Usage Row Takes the Loser's as It Stands. */
				;INSERT INTO mem.RecordUsage (
					 [RecordId]
					,[LastReadDt]
					,[LastAppliedDt]
					,[AppliedDays]
					,[AppliedDates]	)
				SELECT	 [RecordId]			= @WinnerRecordId
						,[LastReadDt]		= L.[LastReadDt]
						,[LastAppliedDt]	= L.[LastAppliedDt]
						,[AppliedDays]		= L.[AppliedDays]
						,[AppliedDates]		= L.[AppliedDates]
				FROM	mem.RecordUsage L WITH ( UPDLOCK, HOLDLOCK )
				WHERE	L.[RecordId] = @LoserRecordId
						AND NOT EXISTS (	SELECT	NULL
											FROM	mem.RecordUsage W WITH ( UPDLOCK, HOLDLOCK )
											WHERE	W.[RecordId] = @WinnerRecordId	)

				/* The Loser's Usage Row Goes Before Its Record, Whose Foreign Key It Holds. */
				;DELETE L
				FROM	mem.RecordUsage L
				WHERE	L.[RecordId] = @LoserRecordId

				;UPDATE RS
				SET		 [RecordId]		= @WinnerRecordId
						,[UpdatedDt]	= @Now
				FROM	mem.RecordStamp RS
				WHERE	RS.[RecordId] = @LoserRecordId

				/* The Loser's Vectors Describe a Body No Store Keeps, so They Go, and Then Its Row. */
				;DELETE E
				FROM	mem.Embedding E
				WHERE	E.[RecordId] = @LoserRecordId

				;DELETE R
				FROM	mem.Record R
				WHERE	R.[RecordId] = @LoserRecordId
			END

			;IF ( @Action = 'move' OR @WinnerRecordId = @RecordId )
			BEGIN
				/* A Moved or Winning Source Row Takes the Target Store's Slot, Its Embeddings and Usage With It. */
				;UPDATE R
				SET		 [StoreId]		= @TargetStoreId
						,[UpdatedDt]	= @Now
				FROM	mem.Record R
				WHERE	R.[RecordId] = @RecordId
			END

			/* A Same-Copy Drop is Named Under No Disposition, so No Count Reports It. */
			;IF ( @Action IS NOT NULL AND @Action <> 'same' )
			BEGIN
				;INSERT INTO @Outcome (
					 [RecordId]
					,[Name]
					,[Disposition]	)
				SELECT	 [RecordId]		= @RecordId
						,[Name]			= @Name
						,[Disposition]	= CASE @Action
											WHEN 'move'	THEN 'moved'
											WHEN 'skip'	THEN 'skipped'
											ELSE 'merged'
										  END
			END

			;SELECT	@RecordId = MIN(R.[RecordId])
			FROM	mem.Record R
			WHERE	R.[StoreId] = @SourceStoreId
					AND R.[RecordId] > @RecordId
		END

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS AND THE NAMES A READER ACTS ON.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [moved]			= (	SELECT COUNT(*) FROM @Outcome O WHERE O.[Disposition] = 'moved' )
									,[merged]			= (	SELECT COUNT(*) FROM @Outcome O WHERE O.[Disposition] = 'merged' )
									,[skipped]			= (	SELECT COUNT(*) FROM @Outcome O WHERE O.[Disposition] = 'skipped' )
									,[mergedNames]		= JSON_QUERY(COALESCE((	SELECT	'[' + STRING_AGG(CAST(N'"' + STRING_ESCAPE(O.[Name], 'json') + N'"' AS NVARCHAR(MAX)), N',')
																							WITHIN GROUP ( ORDER BY O.[RecordId] ) + ']'
																				FROM	@Outcome O
																				WHERE	O.[Disposition] = 'merged'	), N'[]'))
									,[skippedNames]		= JSON_QUERY(COALESCE((	SELECT	'[' + STRING_AGG(CAST(N'"' + STRING_ESCAPE(O.[Name], 'json') + N'"' AS NVARCHAR(MAX)), N',')
																							WITHIN GROUP ( ORDER BY O.[RecordId] ) + ']'
																				FROM	@Outcome O
																				WHERE	O.[Disposition] = 'skipped'	), N'[]'))
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER	)
	END TRY
	BEGIN CATCH
		/* Unwind Only a Transaction This Procedure Opened; a Caller's is the Caller's to Unwind. */
		/* A ROLLBACK Inside an INSERT-EXEC Raises Error 3915 in Place of the Server's Own Error Text. */
		;IF ( XACT_STATE() <> 0 AND @EntryTranCount = 0 )
			ROLLBACK TRANSACTION

		/* Re-Raise so the Caller Never Reads Success From a Failed Write. */
		;THROW
	END CATCH
END
GO
