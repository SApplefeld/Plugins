-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_PutRecord', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_PutRecord AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_PutRecord
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Tier			VARCHAR(20)		= NULL
	,@p_ProjectKey		NVARCHAR(400)	= NULL
	,@p_TypeName		NVARCHAR(400)	= NULL
	,@p_Name			NVARCHAR(200)	= NULL
	,@p_Space			NVARCHAR(100)	= NULL
	,@p_Machine			NVARCHAR(100)	= NULL
	,@p_Description		NVARCHAR(MAX)	= NULL
	,@p_Body			NVARCHAR(MAX)	= NULL
	,@p_Tags			NVARCHAR(MAX)	= NULL
	,@p_Triggers		NVARCHAR(MAX)	= NULL
	,@p_Anchors			NVARCHAR(MAX)	= NULL
	,@p_IsPinned		BIT				= NULL
	,@p_Supersedes		NVARCHAR(200)	= NULL
	,@p_Author			NVARCHAR(200)	= NULL
	,@p_Replace			BIT				= 0
	,@p_StampId			NVARCHAR(64)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_PutRecord
		AUTHOR:		Scott Applefeld
		DATE:		October 3rd, 2026
		VERSION:	v1.3
	*********************************************************************************************
		NOTES:		v1.3 - 10/05/2026
							An insert into a deleted row holding the file key deletes that
							row's mem.RecordUsage row with its embeddings, so a new record
							taking a deleted record's name starts with no usage. Its
							mem.RecordStamp rows stay, so a resent write of the old record
							still writes nothing.

							v1.2 - 10/04/2026 - SCOTT APPLEFELD
							An overwrite takes @p_Space as [Machine] takes @p_Machine: a NULL
							keeps the column, and any other value is written trimmed, an empty
							or all-blank one writing NULL, so a replace that clears a space
							stores no label rather than an empty one.

							v1.1 - 10/04/2026 - SCOTT APPLEFELD
							An insert writes @p_Space trimmed, and an empty or all-blank value
							writes NULL, so a record born with no space lists as unspaced. An
							overwrite still takes a non-NULL @p_Space as the new value, an empty
							string included, which is how a replace clears a space.

							v1.0 - 10/03/2026 - SCOTT APPLEFELD
							Writes one record for the calling sandbox, the one write door a
							session uses. The store is named by the tier and its key: a
							project record by @p_ProjectKey, landing in that project's fleet
							store, created here where absent; a type record by @p_TypeName;
							an operator record by neither. The caller's sandbox comes from
							mem.CallerSandbox() and an unmapped login is refused.

							The readings, in order. A @p_StampId this sandbox already holds
							in mem.RecordStamp wins over every other reading, however much
							has been written to the record since: nothing is written and the
							answer is stored, so a client resending a write it could not
							confirm never meets its own write as a refusal. Otherwise, where
							a live row of that name is in the store and @p_Replace is 0,
							nothing is written and the answer is refused, carrying the
							existing description. The row is the newest undeleted row of
							the name, archived or not, as in every procedure that resolves a
							record by name, and an archived row counts as there. Where it
							is there and @p_Replace is 1, the row is overwritten field by
							field, and a write carrying a body, the whole record, takes the
							archived flag off, while a write of other fields alone leaves
							it: a NULL parameter keeps the
							column and a non-NULL one, an empty JSON array included, is the
							new value, and the row's embeddings are deleted only where
							@p_Body is non-NULL. Where no live row has the name and @p_Body is
							NULL, whatever @p_Replace reads, nothing is written: no store is
							created, no deleted row is touched, no stamp is recorded, and the
							answer is refused with a NULL description, since a write of some
							fields alone has no record to land on. An empty-string body is a
							body. Where no live row has the name and a body is given, the
							record is inserted, into the store's deleted row holding the same
							file key where there is one, since the file key is unique in a
							store.

							Every row written reads [Origin] memq and [Visibility] shared and
							carries the writing sandbox, and a stored write that carried a
							stamp adds its row to mem.RecordStamp. [Tags], [Triggers]
							and [Anchors] are JSON arrays. @p_Machine, the one machine an
							operator record is scoped to, is written trimmed, and an empty
							or all-blank value writes NULL: on an overwrite a NULL keeps
							the column as every other field does, and a blank clears it.
							Two writes of one store, one name or one stamp queue on the key
							range locks the lookups deciding them take. Returns one row, one
							column [Json], holding {status, recordId, name, description},
							status stored or refused.
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
			,@StoreId			INT				= NULL
			,@RecordId			BIGINT			= NULL
			,@ReuseRecordId		BIGINT			= NULL
			,@Wrote				BIT				= 0
			,@Status			VARCHAR(10)		= NULL
			,@ExistingText		NVARCHAR(MAX)	= NULL
			,@Tier				VARCHAR(20)		= LOWER(LTRIM(RTRIM(@p_Tier)))
			,@Name				NVARCHAR(200)	= NULLIF(LTRIM(RTRIM(@p_Name)), '')
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')
			,@TypeName			NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_TypeName)), '')
			,@StampId			NVARCHAR(64)	= NULLIF(LTRIM(RTRIM(@p_StampId)), '')
			,@Machine			NVARCHAR(100)	= NULLIF(LTRIM(RTRIM(@p_Machine)), '')
			,@Space				NVARCHAR(100)	= NULLIF(LTRIM(RTRIM(@p_Space)), '')
			,@FileKey			NVARCHAR(400)	= NULL

	/********************************************************************************************
		VALIDATE THE CALLER AND THE RECORD, THEN WRITE IT AS ONE UNIT.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_PutRecord: the calling login maps to no sandbox.', 1

		;IF ( @Name IS NULL )
			THROW 50000, 'mem.usp_PutRecord: @p_Name is required.', 1

		;IF ( @Tier IS NULL OR @Tier NOT IN ('project', 'type', 'operator') )
			THROW 50000, 'mem.usp_PutRecord: @p_Tier must be project, type or operator.', 1

		/* Refuse a Store Key the Tier Does Not Take. */
		;IF NOT (	(	@Tier = 'project'
						AND @ProjectKey IS NOT NULL
						AND @TypeName IS NULL	)
					OR (	@Tier = 'type'
							AND @TypeName IS NOT NULL
							AND @ProjectKey IS NULL	)
					OR (	@Tier = 'operator'
							AND @ProjectKey IS NULL
							AND @TypeName IS NULL	)	)
			THROW 50000, 'mem.usp_PutRecord: a project record needs @p_ProjectKey, a type record @p_TypeName, and an operator record neither.', 1

		;IF (	( @p_Tags IS NOT NULL AND ISJSON(@p_Tags, ARRAY) <> 1 )
				OR ( @p_Triggers IS NOT NULL AND ISJSON(@p_Triggers, ARRAY) <> 1 )
				OR ( @p_Anchors IS NOT NULL AND ISJSON(@p_Anchors, ARRAY) <> 1 )	)
			THROW 50000, 'mem.usp_PutRecord: @p_Tags, @p_Triggers and @p_Anchors must each be a JSON array when given.', 1

		;SELECT @FileKey = LOWER(@Name) + N'.md'

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/****************************************************************************************
			A STAMP THIS SANDBOX ALREADY WROTE WINS: NOTHING IS WRITTEN.
		****************************************************************************************/
		;IF ( @StampId IS NOT NULL )
		BEGIN
			;SELECT	 @RecordId		= RS.[RecordId]
					,@Status		= 'stored'
			FROM	mem.RecordStamp RS WITH ( UPDLOCK, HOLDLOCK )
			WHERE	RS.[WrittenBySandboxId] = @SandboxId
					AND RS.[StampId] = @StampId
		END

		;IF ( @Status IS NULL )
		BEGIN
			/************************************************************************************
				RESOLVE THE STORE, CREATING A PROJECT OR TYPE STORE WRITTEN FOR THE FIRST TIME.
			************************************************************************************/
			/* Each Tier's Store is Named by Equality on its Key, Under a Range Lock so a Concurrent First Write Queues. */
			;IF ( @Tier = 'project' ) BEGIN
				;SELECT	@StoreId = S.[StoreId]
				FROM	mem.Store S WITH ( UPDLOCK, HOLDLOCK )
				WHERE	S.[Tier] = 'project'
						AND S.[ProjectKey] = @ProjectKey
						AND S.[ProjectKey] IS NOT NULL
			END ELSE IF ( @Tier = 'type' ) BEGIN
				;SELECT	@StoreId = S.[StoreId]
				FROM	mem.Store S WITH ( UPDLOCK, HOLDLOCK )
				WHERE	S.[SandboxId] IS NULL
						AND S.[Tier] = 'type'
						AND S.[Segment] = @TypeName
						AND S.[ProjectKey] IS NULL
			END ELSE BEGIN
				;SELECT	@StoreId = S.[StoreId]
				FROM	mem.Store S WITH ( UPDLOCK, HOLDLOCK )
				WHERE	S.[SandboxId] IS NULL
						AND S.[Tier] = 'operator'
						AND S.[Segment] IS NULL
						AND S.[ProjectKey] IS NULL
			END

			/* A Write With No Body Creates No Store, Since It Can Only Land on a Row Already There. */
			;IF ( @StoreId IS NULL AND @p_Body IS NOT NULL )
			BEGIN
				;INSERT INTO mem.Store (
					 [SandboxId]
					,[Tier]
					,[Segment]
					,[ProjectKey]	)
				SELECT	 [SandboxId]	= NULL
						,[Tier]			= @Tier
						,[Segment]		= @TypeName
						,[ProjectKey]	= @ProjectKey

				;SET @StoreId = SCOPE_IDENTITY()
			END

			/* The Newest Undeleted Row of That Name, Archived or Not, Read Under a Range Lock so a Concurrent Write of the Name Queues Behind This One. */
			;SELECT	TOP ( 1 )
					 @RecordId		= R.[RecordId]
					,@ExistingText	= R.[Description]
			FROM	mem.Record R WITH ( UPDLOCK, HOLDLOCK )
			WHERE	R.[StoreId] = @StoreId
					AND R.[Name] = @Name
					AND R.[DeletedDt] IS NULL
			ORDER BY R.[RecordId] DESC

			/************************************************************************************
				PRESENT AND NOT TO BE REPLACED: REFUSE.
			************************************************************************************/
			;IF ( @RecordId IS NOT NULL AND COALESCE(@p_Replace, @False) = @False )
			BEGIN
				;SET @Status = 'refused'
			END

			/************************************************************************************
				PRESENT AND TO BE REPLACED: A NULL FIELD KEEPS ITS COLUMN.
			************************************************************************************/
			;IF ( @RecordId IS NOT NULL AND @Status IS NULL )
			BEGIN
				/* A New Body Drops the Vectors Made From the Old One. */
				;IF ( @p_Body IS NOT NULL )
				BEGIN
					;DELETE E
					FROM	mem.Embedding E
					WHERE	E.[RecordId] = @RecordId
				END

				;UPDATE R
				SET		 [Description]			= COALESCE(@p_Description, R.[Description])
						,[Body]					= COALESCE(@p_Body, R.[Body])
						,[BodyHash]				= CASE	WHEN @p_Body IS NULL
														THEN R.[BodyHash]
														ELSE CONVERT(VARCHAR(128), HASHBYTES('SHA2_256', @p_Body), 2)
												  END
						,[Tags]					= COALESCE(@p_Tags, R.[Tags])
						,[SupersedesName]		= COALESCE(@p_Supersedes, R.[SupersedesName])
						,[Author]				= COALESCE(@p_Author, R.[Author])
						,[Space]				= CASE WHEN @p_Space IS NULL THEN R.[Space] ELSE @Space END
						,[Machine]				= CASE WHEN @p_Machine IS NULL THEN R.[Machine] ELSE @Machine END
						,[Triggers]				= COALESCE(@p_Triggers, R.[Triggers])
						,[Anchors]				= COALESCE(@p_Anchors, R.[Anchors])
						,[IsPinned]				= COALESCE(@p_IsPinned, R.[IsPinned])
						,[IsArchived]			= CASE WHEN @p_Body IS NULL THEN R.[IsArchived] ELSE @False END
						,[Origin]				= 'memq'
						,[Visibility]			= 'shared'
						,[WrittenBySandboxId]	= @SandboxId
						,[UpdatedDt]			= @Now
				FROM	mem.Record R
				WHERE	R.[RecordId] = @RecordId

				;SELECT	 @Status		= 'stored'
						,@ExistingText	= NULL
						,@Wrote			= @True
			END

			/************************************************************************************
				ABSENT WITH NO BODY: REFUSE, WRITING NOTHING.
			************************************************************************************/
			;IF ( @RecordId IS NULL AND @p_Body IS NULL )
			BEGIN
				;SET @Status = 'refused'
			END

			/************************************************************************************
				ABSENT: INSERT, INTO THE DELETED ROW HOLDING THE FILE KEY WHERE THERE IS ONE.
			************************************************************************************/
			;IF ( @RecordId IS NULL AND @Status IS NULL )
			BEGIN
				;IF EXISTS (	SELECT	NULL
								FROM	mem.Record R WITH ( UPDLOCK, HOLDLOCK )
								WHERE	R.[StoreId] = @StoreId
										AND R.[FileKey] = @FileKey
										AND R.[DeletedDt] IS NULL	)
					THROW 50000, 'mem.usp_PutRecord: a live record of another name holds this name''s file key in the store.', 1

				;SELECT	@ReuseRecordId = R.[RecordId]
				FROM	mem.Record R WITH ( UPDLOCK, HOLDLOCK )
				WHERE	R.[StoreId] = @StoreId
						AND R.[FileKey] = @FileKey

				;IF ( @ReuseRecordId IS NOT NULL )
				BEGIN
					/* The Deleted Row's Vectors Belong to the Text Being Replaced. */
					;DELETE E
					FROM	mem.Embedding E
					WHERE	E.[RecordId] = @ReuseRecordId

					/* The Deleted Row's Usage Belongs to the Record That Earned It, so the New Record Starts With None. */
					;DELETE U
					FROM	mem.RecordUsage U
					WHERE	U.[RecordId] = @ReuseRecordId

					;UPDATE R
					SET		 [Name]					= @Name
							,[Description]			= COALESCE(@p_Description, N'')
							,[Body]					= COALESCE(@p_Body, N'')
							,[BodyHash]				= CONVERT(VARCHAR(128), HASHBYTES('SHA2_256', COALESCE(@p_Body, N'')), 2)
							,[FileModifiedDt]		= NULL
							,[Machine]				= @Machine
							,[Tags]					= @p_Tags
							,[SupersedesName]		= @p_Supersedes
							,[Author]				= @p_Author
							,[IsArchived]			= @False
							,[Space]				= @Space
							,[Triggers]				= @p_Triggers
							,[Anchors]				= @p_Anchors
							,[IsPinned]				= COALESCE(@p_IsPinned, @False)
							,[CreatedOn]			= CAST(@Now AS DATE)
							,[Origin]				= 'memq'
							,[Visibility]			= 'shared'
							,[WrittenBySandboxId]	= @SandboxId
							,[DeletedDt]			= NULL
							,[UpdatedDt]			= @Now
					FROM	mem.Record R
					WHERE	R.[RecordId] = @ReuseRecordId

					;SET @RecordId = @ReuseRecordId
				END ELSE BEGIN
					;INSERT INTO mem.Record (
						 [StoreId]
						,[Name]
						,[FileKey]
						,[Description]
						,[Body]
						,[BodyHash]
						,[Tags]
						,[SupersedesName]
						,[Author]
						,[Space]
						,[Machine]
						,[Triggers]
						,[Anchors]
						,[IsPinned]
						,[CreatedOn]
						,[Origin]
						,[WrittenBySandboxId]
						,[Visibility]
						,[CreatedDt]
						,[UpdatedDt]			)
					SELECT	 [StoreId]				= @StoreId
							,[Name]					= @Name
							,[FileKey]				= @FileKey
							,[Description]			= COALESCE(@p_Description, N'')
							,[Body]					= COALESCE(@p_Body, N'')
							,[BodyHash]				= CONVERT(VARCHAR(128), HASHBYTES('SHA2_256', COALESCE(@p_Body, N'')), 2)
							,[Tags]					= @p_Tags
							,[SupersedesName]		= @p_Supersedes
							,[Author]				= @p_Author
							,[Space]				= @Space
							,[Machine]				= @Machine
							,[Triggers]				= @p_Triggers
							,[Anchors]				= @p_Anchors
							,[IsPinned]				= COALESCE(@p_IsPinned, @False)
							,[CreatedOn]			= CAST(@Now AS DATE)
							,[Origin]				= 'memq'
							,[WrittenBySandboxId]	= @SandboxId
							,[Visibility]			= 'shared'
							,[CreatedDt]			= @Now
							,[UpdatedDt]			= @Now

					;SET @RecordId = SCOPE_IDENTITY()
				END

				;SELECT	 @Status	= 'stored'
						,@Wrote		= @True
			END
		END

		/* Record the Stamp a Stored Write Carried, so a Resend of It Writes Nothing. */
		;IF ( @Wrote = @True AND @StampId IS NOT NULL )
		BEGIN
			;INSERT INTO mem.RecordStamp (
				 [WrittenBySandboxId]
				,[StampId]
				,[RecordId]		)
			SELECT	 [WrittenBySandboxId]	= @SandboxId
					,[StampId]				= @StampId
					,[RecordId]				= @RecordId
		END

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE ANSWER.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [status]		= @Status
									,[recordId]		= @RecordId
									,[name]			= @Name
									,[description]	= CASE WHEN @Status = 'refused' THEN @ExistingText END
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
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
