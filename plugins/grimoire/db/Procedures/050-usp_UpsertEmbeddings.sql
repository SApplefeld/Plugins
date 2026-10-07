-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_UpsertEmbeddings', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_UpsertEmbeddings AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_UpsertEmbeddings
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Embeddings		NVARCHAR(MAX)
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_UpsertEmbeddings
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.3
	*********************************************************************************************
		NOTES:		v1.3 - 10/03/2026 - SCOTT APPLEFELD
							A row of a project's fleet store, which belongs to no sandbox, is
							every mapped sandbox's to embed, as a type or operator row is.
							Another sandbox's older project store stays that sandbox's alone.

					v1.2 - 09/18/2026 - SCOTT APPLEFELD
							A row is written only where mem.udf_VisibleRecords hands its
							record to the caller and that record is not another sandbox's
							project row. A promoted project record is shared, so the
							visibility function hands it to every sandbox, and both
							mem.usp_Search and mem.usp_Nearest hand its id out; it is
							still the owning sandbox's alone to embed. Such a row is
							rejected and counted, on the predicate mem.usp_ListRecords
							keeps it out of a publisher's inventory with.

					v1.1 - 09/18/2026 - SCOTT APPLEFELD
							A failure unwinds only a transaction this procedure opened and
							re-raises, so a caller's transaction stays the caller's to
							unwind. Under an INSERT-EXEC, which holds a transaction of its
							own, the caller reads the server's own error text rather than
							error 3915.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							Upserts one batch of chunk embeddings. @p_Embeddings is a JSON
							array of objects {recordId, chunkIndex, chunkOffset, chunkLength,
							vector, model, dimensions}, the vector as a JSON array of floats
							the procedure casts to VECTOR(1024). The upsert key is (record,
							chunk index, model identity). A row whose record the caller may
							not see, resolved through mem.udf_VisibleRecords for the caller's
							sandbox, is rejected and counted rather than written, so a
							publisher cannot attach a vector to another sandbox's private
							record by guessing its id. A batch that names one key twice
							keeps its last entry and drops the earlier ones.

							Returns one row, one column [Json], holding {inserted, updated,
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
			,@Now				DATETIMEOFFSET	= SYSDATETIMEOFFSET()
			,@SandboxId			INT				= NULL
			,@LockResult		INT				= NULL

	/* Result Counts. */
	;DECLARE @Inserted			INT				= 0
			,@Updated			INT				= 0
			,@Rejected			INT				= 0

	/* The Batch, With Each Row's Visibility to the Caller. */
	;DECLARE @Incoming TABLE (
		 [Ordinal]			INT				NOT NULL	IDENTITY(1,1)
		,[RecordId]			BIGINT			NULL
		,[ChunkIndex]		INT				NULL
		,[ChunkOffset]		INT				NULL
		,[ChunkLength]		INT				NULL
		,[VectorText]		NVARCHAR(MAX)	NULL
		,[ModelIdentity]	VARCHAR(200)	NULL
		,[Dimensions]		SMALLINT		NULL
		,[IsVisible]		BIT				NOT NULL	DEFAULT(0)
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE BATCH, THEN UPSERT THE VISIBLE ROWS.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_UpsertEmbeddings: the calling login maps to no sandbox.', 1

		;IF ( @p_Embeddings IS NULL OR ISJSON(@p_Embeddings, ARRAY) <> 1 )
			THROW 50000, 'mem.usp_UpsertEmbeddings: @p_Embeddings must be a JSON array.', 1

		/* Parse the Batch Into Typed Rows. */
		;INSERT INTO @Incoming (
			 [RecordId]
			,[ChunkIndex]
			,[ChunkOffset]
			,[ChunkLength]
			,[VectorText]
			,[ModelIdentity]
			,[Dimensions]	)
		SELECT	 [RecordId]			= J.[RecordId]
				,[ChunkIndex]		= J.[ChunkIndex]
				,[ChunkOffset]		= COALESCE(J.[ChunkOffset], 0)
				,[ChunkLength]		= COALESCE(J.[ChunkLength], 0)
				,[VectorText]		= J.[VectorText]
				,[ModelIdentity]	= NULLIF(LTRIM(RTRIM(J.[ModelIdentity])), '')
				,[Dimensions]		= J.[Dimensions]
		FROM	OPENJSON(@p_Embeddings)
				WITH (	 [RecordId]			BIGINT			'$.recordId'
						,[ChunkIndex]		INT				'$.chunkIndex'
						,[ChunkOffset]		INT				'$.chunkOffset'
						,[ChunkLength]		INT				'$.chunkLength'
						,[VectorText]		NVARCHAR(MAX)	'$.vector' AS JSON
						,[ModelIdentity]	VARCHAR(200)	'$.model'
						,[Dimensions]		SMALLINT		'$.dimensions'	) J

		/* Refuse a Row Missing Its Key or Its Vector. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	I.[RecordId] IS NULL
								OR I.[ChunkIndex] IS NULL
								OR I.[ChunkIndex] < 0
								OR I.[VectorText] IS NULL
								OR I.[ModelIdentity] IS NULL	)
			THROW 50000, 'mem.usp_UpsertEmbeddings: every embedding needs a recordId, a chunkIndex of zero or more, a vector, and a model.', 1

		/* A Key Named Twice Keeps Its Last Entry. */
		;DELETE I
		FROM	@Incoming I
		WHERE	EXISTS (	SELECT	NULL
							FROM	@Incoming L
							WHERE	L.[Ordinal] > I.[Ordinal]
									AND L.[RecordId] = I.[RecordId]
									AND L.[ChunkIndex] = I.[ChunkIndex]
									AND L.[ModelIdentity] = I.[ModelIdentity]	)

		/* Mark the Rows This Publisher May Embed; the Rest are Rejected Below. */
		;UPDATE I
		SET		[IsVisible] = @True
		FROM	@Incoming I
		WHERE	EXISTS (	SELECT	NULL
							FROM	mem.udf_VisibleRecords(@SandboxId) V
							WHERE	V.[RecordId] = I.[RecordId]
									AND (	V.[Tier] <> 'project'
											OR V.[StoreSandboxId] = @SandboxId
											OR V.[StoreSandboxId] IS NULL	)	)

		;SELECT	@Rejected = COUNT(*)
		FROM	@Incoming I
		WHERE	I.[IsVisible] = @False

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* Publishes Serialize on One Fleet-Wide Application Lock, Held to the End of the Transaction. */
		/* Two Sandboxes First-Embedding One Shared Record Therefore Queue Instead of Racing the Unique Index. */
		;EXEC @LockResult = sp_getapplock @Resource = 'mem.Publish', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000
		;IF ( @LockResult < 0 )
			THROW 50000, 'mem.usp_UpsertEmbeddings: the fleet publish lock was not acquired before the wait timed out; another publish is holding it.', 1

		/* Update the Rows Already Held for the Same Record, Chunk and Model. */
		;UPDATE E
		SET		 [ChunkOffset]	= I.[ChunkOffset]
				,[ChunkLength]	= I.[ChunkLength]
				,[Vector]		= CAST(I.[VectorText] AS VECTOR(1024))
				,[Dimensions]	= COALESCE(I.[Dimensions], 1024)
				,[EmbeddedDt]	= @Now
				,[UpdatedDt]	= @Now
		FROM	mem.Embedding E
				INNER JOIN @Incoming I
					ON	I.[RecordId] = E.[RecordId]
					AND I.[ChunkIndex] = E.[ChunkIndex]
					AND I.[ModelIdentity] = E.[ModelIdentity]
		WHERE	I.[IsVisible] = @True

		;SET @Updated = @@ROWCOUNT

		/* Insert the Rest. */
		;INSERT INTO mem.Embedding (
			 [RecordId]
			,[ChunkIndex]
			,[ModelIdentity]
			,[ChunkOffset]
			,[ChunkLength]
			,[Vector]
			,[Dimensions]
			,[EmbeddedDt]	)
		SELECT	 [RecordId]			= I.[RecordId]
				,[ChunkIndex]		= I.[ChunkIndex]
				,[ModelIdentity]	= I.[ModelIdentity]
				,[ChunkOffset]		= I.[ChunkOffset]
				,[ChunkLength]		= I.[ChunkLength]
				,[Vector]			= CAST(I.[VectorText] AS VECTOR(1024))
				,[Dimensions]		= COALESCE(I.[Dimensions], 1024)
				,[EmbeddedDt]		= @Now
		FROM	@Incoming I
		WHERE	I.[IsVisible] = @True
				AND NOT EXISTS (	SELECT	NULL
									FROM	mem.Embedding E
									WHERE	E.[RecordId] = I.[RecordId]
											AND E.[ChunkIndex] = I.[ChunkIndex]
											AND E.[ModelIdentity] = I.[ModelIdentity]	)

		;SET @Inserted = @@ROWCOUNT

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [inserted]	= @Inserted
									,[updated]	= @Updated
									,[rejected]	= @Rejected
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
