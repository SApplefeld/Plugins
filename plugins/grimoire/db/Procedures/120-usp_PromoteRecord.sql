-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_PromoteRecord', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_PromoteRecord AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_PromoteRecord
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_SandboxName		NVARCHAR(100)	= NULL
	,@p_Segment			NVARCHAR(400)	= NULL
	,@p_Name			NVARCHAR(200)	= NULL
	,@p_Tier			VARCHAR(20)		= 'project'
	,@p_ProjectKey		NVARCHAR(400)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_PromoteRecord
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.3
	*********************************************************************************************
		NOTES:		v1.3 - 10/05/2026
							A copy written into a deleted operator row holding the file key
							deletes that row's mem.RecordUsage row with its embeddings, so
							the promoted record starts with no usage under the reused id.
							A live operator row of the name or the file key is still
							refused, so no live row's usage is touched.

							v1.2 - 10/04/2026 - SCOTT APPLEFELD
							The operator copy writes no [Space], since the shared tiers have no
							project for a space to order within.

							v1.1 - 10/03/2026 - SCOTT APPLEFELD
							Moves one live project record into the fleet's operator store.
							The record is named by its project key and its name, or, in the
							version 6 shape, by the sandbox that owns its older store, that
							store's segment and its name. The name resolves to the newest
							undeleted row of it in the store, as in every procedure that
							resolves a record by name, so two rows of one name no longer
							refuse; where that row is archived, nothing is live to move and
							the call is refused. The operator store takes a copy of
							every field and every embedding, as a shared row, and the
							project row is archived, never deleted. A name the operator
							store already holds live is refused rather than
							overwritten; a deleted operator row holding the same file key is
							the row the copy is written into, since the file key is unique
							in a store. The copy and the archive are one transaction, and the
							operator store's lookups take key range locks, so a concurrent
							promotion of the same name queues behind this one.

							Returns one row, one column [Json], holding {recordId, name,
							tier, visibility, archivedRecordId}: the operator row, and the
							project row now archived.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							Only a member of mem_curator, db_owner or sysadmin may promote:
							the role grant is the outer gate and this check inside the body
							is the inner one, so a procedure granted to the wrong role by a
							later script still refuses. A name that matches no live row, or
							more than one, is refused rather than guessed at, and so is a
							tier other than project.
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
			,@SourceStoreId		INT				= NULL
			,@OperatorStoreId	INT				= NULL
			,@RecordId			BIGINT			= NULL
			,@TargetRecordId	BIGINT			= NULL
			,@IsArchived		BIT				= NULL
			,@FileKey			NVARCHAR(400)	= NULL
			,@Name				NVARCHAR(200)	= NULLIF(LTRIM(RTRIM(@p_Name)), '')
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')
			,@Tier				VARCHAR(20)		= LOWER(LTRIM(RTRIM(@p_Tier)))

	/********************************************************************************************
		GATE THE CALLER, RESOLVE THE ROW, AND MOVE IT.
	********************************************************************************************/
	;BEGIN TRY
		/* The Inner Gate: Curator, Database Owner or Server Administrator. */
		;IF (	COALESCE(IS_ROLEMEMBER('mem_curator'), 0) <> 1
				AND COALESCE(IS_MEMBER('db_owner'), 0) <> 1
				AND COALESCE(IS_SRVROLEMEMBER('sysadmin'), 0) <> 1	)
			THROW 50000, 'mem.usp_PromoteRecord: the caller is not a member of mem_curator.', 1

		/* Only a Project Record Moves; the Shared Tiers are the Fleet's Already. */
		;IF ( @Tier IS NULL OR @Tier <> 'project' )
			THROW 50000, 'mem.usp_PromoteRecord: @p_Tier must be project; a type or operator tier record is already the fleet''s and has nothing to promote.', 1

		;IF ( @Name IS NULL )
			THROW 50000, 'mem.usp_PromoteRecord: @p_Name is required.', 1

		/* Resolve the Source Store: the Project Key's Fleet Store, or a Sandbox's Older Store by Segment. */
		;IF ( @ProjectKey IS NOT NULL )
		BEGIN
			;SELECT	@SourceStoreId = S.[StoreId]
			FROM	mem.Store S
			WHERE	S.[Tier] = 'project'
					AND S.[ProjectKey] = @ProjectKey
		END ELSE BEGIN
			;SELECT	@SandboxId = SB.[SandboxId]
			FROM	mem.Sandbox SB
			WHERE	SB.[Name] = @p_SandboxName

			;IF ( @SandboxId IS NULL )
				THROW 50000, 'mem.usp_PromoteRecord: name @p_ProjectKey, or @p_SandboxName naming a sandbox with @p_Segment.', 1

			;SELECT	@SourceStoreId = S.[StoreId]
			FROM	mem.Store S
			WHERE	S.[SandboxId] = @SandboxId
					AND S.[Tier] = 'project'
					AND S.[Segment] = NULLIF(LTRIM(RTRIM(@p_Segment)), '')
		END

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* The Newest Undeleted Row of That Name, Archived or Not, Under a Range Lock so a Concurrent Move of it Queues. */
		;SELECT	TOP ( 1 )
				 @RecordId		= R.[RecordId]
				,@IsArchived	= R.[IsArchived]
		FROM	mem.Record R WITH ( UPDLOCK, HOLDLOCK )
		WHERE	R.[StoreId] = @SourceStoreId
				AND R.[Name] = @Name
				AND R.[DeletedDt] IS NULL
		ORDER BY R.[RecordId] DESC

		;IF ( @RecordId IS NULL OR @IsArchived = @True )
			THROW 50000, 'mem.usp_PromoteRecord: no live project record matches the store and name given.', 1

		;SELECT	@FileKey = R.[FileKey]
		FROM	mem.Record R
		WHERE	R.[RecordId] = @RecordId

		/****************************************************************************************
			RESOLVE THE OPERATOR STORE AND THE ROW THE COPY IS WRITTEN INTO.
		****************************************************************************************/
		/* The Operator Store, Named by Equality on its Key. */
		;SELECT	@OperatorStoreId = S.[StoreId]
		FROM	mem.Store S WITH ( UPDLOCK, HOLDLOCK )
		WHERE	S.[SandboxId] IS NULL
				AND S.[Tier] = 'operator'
				AND S.[Segment] IS NULL
				AND S.[ProjectKey] IS NULL

		;IF ( @OperatorStoreId IS NULL )
		BEGIN
			;INSERT INTO mem.Store (
				 [SandboxId]
				,[Tier]
				,[Segment]	)
			SELECT	 [SandboxId]	= NULL
					,[Tier]			= 'operator'
					,[Segment]		= NULL

			;SET @OperatorStoreId = SCOPE_IDENTITY()
		END

		/* A Live Operator Row of the Same Name, or of the Same File Key, is Refused; a Deleted One Holding the File Key is Reused. */
		;IF EXISTS (	SELECT	NULL
						FROM	mem.Record R WITH ( UPDLOCK, HOLDLOCK )
						WHERE	R.[StoreId] = @OperatorStoreId
								AND R.[Name] = @Name
								AND R.[DeletedDt] IS NULL	)
			THROW 50000, 'mem.usp_PromoteRecord: the operator store already holds a live record of that name; retire or rename it first.', 1

		;IF EXISTS (	SELECT	NULL
						FROM	mem.Record R WITH ( UPDLOCK, HOLDLOCK )
						WHERE	R.[StoreId] = @OperatorStoreId
								AND R.[FileKey] = @FileKey
								AND R.[DeletedDt] IS NULL	)
			THROW 50000, 'mem.usp_PromoteRecord: the operator store already holds a live record of that file key under another name; retire or rename it first.', 1

		;SELECT	@TargetRecordId = R.[RecordId]
		FROM	mem.Record R
		WHERE	R.[StoreId] = @OperatorStoreId
				AND R.[FileKey] = @FileKey

		/****************************************************************************************
			COPY THE RECORD AND ITS EMBEDDINGS, THEN ARCHIVE THE PROJECT ROW.
		****************************************************************************************/
		;IF ( @TargetRecordId IS NULL )
		BEGIN
			;INSERT INTO mem.Record (
				 [StoreId]
				,[Name]
				,[FileKey]
				,[Description]
				,[Body]
				,[BodyHash]
				,[FileModifiedDt]
				,[Machine]
				,[Tags]
				,[SupersedesName]
				,[Author]
				,[IsArchived]
				,[Space]
				,[Triggers]
				,[Anchors]
				,[IsPinned]
				,[CreatedOn]
				,[Origin]
				,[WrittenBySandboxId]
				,[Visibility]
				,[LastPublishedBySandboxId]
				,[LastPublishedDt]
				,[CreatedDt]
				,[UpdatedDt]				)
			SELECT	 [StoreId]					= @OperatorStoreId
					,[Name]						= R.[Name]
					,[FileKey]					= R.[FileKey]
					,[Description]				= R.[Description]
					,[Body]						= R.[Body]
					,[BodyHash]					= R.[BodyHash]
					,[FileModifiedDt]			= R.[FileModifiedDt]
					,[Machine]					= R.[Machine]
					,[Tags]						= R.[Tags]
					,[SupersedesName]			= R.[SupersedesName]
					,[Author]					= R.[Author]
					,[IsArchived]				= @False
					,[Space]					= NULL
					,[Triggers]					= R.[Triggers]
					,[Anchors]					= R.[Anchors]
					,[IsPinned]					= R.[IsPinned]
					,[CreatedOn]				= R.[CreatedOn]
					,[Origin]					= R.[Origin]
					,[WrittenBySandboxId]		= R.[WrittenBySandboxId]
					,[Visibility]				= 'shared'
					,[LastPublishedBySandboxId]	= R.[LastPublishedBySandboxId]
					,[LastPublishedDt]			= R.[LastPublishedDt]
					,[CreatedDt]				= @Now
					,[UpdatedDt]				= @Now
			FROM	mem.Record R
			WHERE	R.[RecordId] = @RecordId

			;SET @TargetRecordId = SCOPE_IDENTITY()
		END ELSE BEGIN
			/* The Deleted Row's Own Vectors Belong to the Text Being Replaced. */
			;DELETE E
			FROM	mem.Embedding E
			WHERE	E.[RecordId] = @TargetRecordId

			/* The Deleted Row's Usage Belongs to the Record That Earned It, so the Copy Starts With None. */
			;DELETE U
			FROM	mem.RecordUsage U
			WHERE	U.[RecordId] = @TargetRecordId

			;UPDATE T
			SET		 [Name]						= R.[Name]
					,[Description]				= R.[Description]
					,[Body]						= R.[Body]
					,[BodyHash]					= R.[BodyHash]
					,[FileModifiedDt]			= R.[FileModifiedDt]
					,[Machine]					= R.[Machine]
					,[Tags]						= R.[Tags]
					,[SupersedesName]			= R.[SupersedesName]
					,[Author]					= R.[Author]
					,[IsArchived]				= @False
					,[Space]					= NULL
					,[Triggers]					= R.[Triggers]
					,[Anchors]					= R.[Anchors]
					,[IsPinned]					= R.[IsPinned]
					,[CreatedOn]				= R.[CreatedOn]
					,[Origin]					= R.[Origin]
					,[WrittenBySandboxId]		= R.[WrittenBySandboxId]
					,[Visibility]				= 'shared'
					,[LastPublishedBySandboxId]	= R.[LastPublishedBySandboxId]
					,[LastPublishedDt]			= R.[LastPublishedDt]
					,[DeletedDt]				= NULL
					,[UpdatedDt]				= @Now
			FROM	mem.Record T
					INNER JOIN mem.Record R
						ON R.[RecordId] = @RecordId
			WHERE	T.[RecordId] = @TargetRecordId
		END

		/* Copy the Vectors, so the Operator Row Ranks on the Same Text at Once. */
		;INSERT INTO mem.Embedding (
			 [RecordId]
			,[ChunkIndex]
			,[ModelIdentity]
			,[ChunkOffset]
			,[ChunkLength]
			,[Vector]
			,[Dimensions]
			,[EmbeddedDt]		)
		SELECT	 [RecordId]			= @TargetRecordId
				,[ChunkIndex]		= E.[ChunkIndex]
				,[ModelIdentity]	= E.[ModelIdentity]
				,[ChunkOffset]		= E.[ChunkOffset]
				,[ChunkLength]		= E.[ChunkLength]
				,[Vector]			= E.[Vector]
				,[Dimensions]		= E.[Dimensions]
				,[EmbeddedDt]		= E.[EmbeddedDt]
		FROM	mem.Embedding E
		WHERE	E.[RecordId] = @RecordId

		/* Archive the Project Row. */
		;UPDATE R
		SET		 [IsArchived]	= @True
				,[UpdatedDt]	= @Now
		FROM	mem.Record R
		WHERE	R.[RecordId] = @RecordId

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE OPERATOR ROW AND THE ARCHIVED PROJECT ROW.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [recordId]			= R.[RecordId]
									,[name]				= R.[Name]
									,[tier]				= 'operator'
									,[visibility]		= R.[Visibility]
									,[archivedRecordId]	= @RecordId
							FROM	mem.Record R
							WHERE	R.[RecordId] = @TargetRecordId
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
