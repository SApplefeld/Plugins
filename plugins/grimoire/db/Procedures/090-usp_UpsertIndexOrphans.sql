-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_UpsertIndexOrphans', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_UpsertIndexOrphans AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_UpsertIndexOrphans
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Orphans			NVARCHAR(MAX)
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_UpsertIndexOrphans
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.1 - 09/18/2026 - SCOTT APPLEFELD
							A failure unwinds only a transaction this procedure opened and
							re-raises, so a caller's transaction stays the caller's to
							unwind. Under an INSERT-EXEC, which holds a transaction of its
							own, the caller reads the server's own error text rather than
							error 3915.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							Records the tier index lines a publisher walk found with no
							record file behind them. @p_Orphans is a JSON array of objects
							{tier, segment, name, description}. A project tier line lands
							against the caller's own store and a shared tier line against the
							fleet's, each created here when nothing has been published for it
							yet. The upsert key is (store, line name): a new line takes first
							seen and last seen now, a known line moves last seen and the
							sandbox that saw it. A batch that names one line twice in the
							same tier and segment keeps its last entry and drops the
							earlier ones.

							Returns one row, one column [Json], holding {inserted, updated}.
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
			,@Now				DATETIMEOFFSET	= SYSDATETIMEOFFSET()
			,@SandboxId			INT				= NULL
			,@Inserted			INT				= 0
			,@Updated			INT				= 0

	/* The Batch, With the Store Each Line Resolves To. */
	;DECLARE @Incoming TABLE (
		 [Ordinal]			INT				NOT NULL	IDENTITY(1,1)
		,[Tier]				VARCHAR(20)		NULL
		,[Segment]			NVARCHAR(400)	NULL
		,[Name]				NVARCHAR(200)	NULL
		,[Description]		NVARCHAR(MAX)	NULL
		,[StoreSandboxId]	INT				NULL
		,[StoreId]			INT				NULL
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE BATCH, THEN UPSERT THE LINES.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_UpsertIndexOrphans: the calling login maps to no sandbox.', 1

		;IF ( @p_Orphans IS NULL OR ISJSON(@p_Orphans, ARRAY) <> 1 )
			THROW 50000, 'mem.usp_UpsertIndexOrphans: @p_Orphans must be a JSON array.', 1

		/* Parse the Batch Into Typed Rows, Canonicalizing the Tier and Its Segment. */
		;INSERT INTO @Incoming (
			 [Tier]
			,[Segment]
			,[Name]
			,[Description]	)
		SELECT	 [Tier]			= LOWER(LTRIM(RTRIM(J.[Tier])))
				,[Segment]		= CASE	WHEN LOWER(LTRIM(RTRIM(J.[Tier]))) = 'operator'
										THEN NULL
										ELSE NULLIF(LTRIM(RTRIM(J.[Segment])), '')
								  END
				,[Name]			= NULLIF(LTRIM(RTRIM(J.[Name])), '')
				,[Description]	= J.[Description]
		FROM	OPENJSON(@p_Orphans)
				WITH (	 [Tier]			VARCHAR(20)		'$.tier'
						,[Segment]		NVARCHAR(400)	'$.segment'
						,[Name]			NVARCHAR(200)	'$.name'
						,[Description]	NVARCHAR(MAX)	'$.description'	) J

		/* Refuse a Line Whose Shape No Store Can Hold. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	I.[Tier] IS NULL
								OR I.[Tier] NOT IN ('project', 'type', 'operator')
								OR I.[Name] IS NULL
								OR (	I.[Tier] IN ('project', 'type')
										AND I.[Segment] IS NULL	)	)
			THROW 50000, 'mem.usp_UpsertIndexOrphans: every line needs a tier of project, type or operator, a name, and a segment for the project and type tiers.', 1

		/* A Line Named Twice Keeps Its Last Entry; INTERSECT Treats Two NULL Segments as Equal. */
		;DELETE I
		FROM	@Incoming I
		WHERE	EXISTS (	SELECT	NULL
							FROM	@Incoming L
							WHERE	L.[Ordinal] > I.[Ordinal]
									AND L.[Tier] = I.[Tier]
									AND L.[Name] = I.[Name]
									AND EXISTS (	SELECT L.[Segment]
													INTERSECT
													SELECT I.[Segment]	)	)

		;UPDATE I
		SET		[StoreSandboxId] = CASE WHEN I.[Tier] = 'project' THEN @SandboxId ELSE NULL END
		FROM	@Incoming I

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* Create the Stores the Batch Names for the First Time, Then Resolve Every Line's Store. */
		;INSERT INTO mem.Store (
			 [SandboxId]
			,[Tier]
			,[Segment]	)
		SELECT	DISTINCT
				 [SandboxId]	= I.[StoreSandboxId]
				,[Tier]			= I.[Tier]
				,[Segment]		= I.[Segment]
		FROM	@Incoming I
		WHERE	NOT EXISTS (	SELECT	NULL
								FROM	mem.Store S
								WHERE	S.[Tier] = I.[Tier]
										AND EXISTS (	SELECT S.[SandboxId], S.[Segment]
														INTERSECT
														SELECT I.[StoreSandboxId], I.[Segment]	)	)

		;UPDATE I
		SET		[StoreId] = S.[StoreId]
		FROM	@Incoming I
				INNER JOIN mem.Store S
					ON	S.[Tier] = I.[Tier]
					AND EXISTS (	SELECT S.[SandboxId], S.[Segment]
									INTERSECT
									SELECT I.[StoreSandboxId], I.[Segment]	)

		/* Move Last Seen on the Lines Already Held. */
		;UPDATE O
		SET		 [Description]			= I.[Description]
				,[LastSeenDt]			= @Now
				,[LastSeenBySandboxId]	= @SandboxId
				,[UpdatedDt]			= @Now
		FROM	mem.IndexOrphan O
				INNER JOIN @Incoming I
					ON	I.[StoreId] = O.[StoreId]
					AND I.[Name] = O.[IndexLineName]

		;SET @Updated = @@ROWCOUNT

		/* Insert the Rest. */
		;INSERT INTO mem.IndexOrphan (
			 [StoreId]
			,[IndexLineName]
			,[Description]
			,[FirstSeenDt]
			,[LastSeenDt]
			,[LastSeenBySandboxId]	)
		SELECT	DISTINCT
				 [StoreId]				= I.[StoreId]
				,[IndexLineName]		= I.[Name]
				,[Description]			= I.[Description]
				,[FirstSeenDt]			= @Now
				,[LastSeenDt]			= @Now
				,[LastSeenBySandboxId]	= @SandboxId
		FROM	@Incoming I
		WHERE	NOT EXISTS (	SELECT	NULL
								FROM	mem.IndexOrphan O
								WHERE	O.[StoreId] = I.[StoreId]
										AND O.[IndexLineName] = I.[Name]	)

		;SET @Inserted = @@ROWCOUNT

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [inserted]	= @Inserted
									,[updated]	= @Updated
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
