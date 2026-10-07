-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_UpsertRecords', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_UpsertRecords AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_UpsertRecords
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Records			NVARCHAR(MAX)
	,@p_Removed			NVARCHAR(MAX)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_UpsertRecords
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.4
	*********************************************************************************************
		NOTES:		v1.4 - 10/05/2026
							The declared limit of the usage fold below states both ways a
							landed row's count can read low. No behavior changes.

					v1.3 - 10/04/2026
							Usage is one mem.RecordUsage row per record, so the caller's
							retired older row of a file key passes its usage to the landed
							row by a fold rather than by moving rows. [LastReadDt] and
							[LastAppliedDt] take the later of the two rows' values, the
							older row's applied dates enter the landed row's list under
							mem.udf_MergeAppliedDates, the rule mem.usp_AppendUsage counts
							by, and [AppliedDays] rises by the dates that rule counts new.
							A landed row with no usage row takes the older row's as it
							stands. The older row's usage row is then deleted, while the
							older row itself keeps its deleted mark as before. Declared
							limit: the landed row's count can read low in two ways. An older
							row holding more than sixteen applied days passes on only the
							sixteen dates its list holds. And where the landed row's list
							already holds sixteen dates, an older row's date earlier than
							all of them is not counted, so the count never falls below
							sixteen where that happens.

					v1.2 - 10/03/2026 - SCOTT APPLEFELD
							A record may carry projectKey, triggers, anchors, pinned,
							created and author beside the fields below. A projectKey opens
							path: or remote:, compared case-sensitively, and names
							something after the prefix, or the batch is refused. A project
							record carrying a projectKey lands in that key's fleet store,
							created where absent, as a shared file row; one carrying none,
							the version 6 shape, lands in the caller's own older store as
							before. The segment stays required on a project record, since
							it names the caller's older store for that project.

							Declared limit: the version 6 shape is taken from any sandbox,
							so an old-kit session still running on a machine whose
							database has migrated can publish in it. That can land a
							losing body, or a copy of a record a verb deleted or archived,
							as a live older-store row that every mapped sandbox reads. The
							window closes with the fleet restart that ships the update,
							since plugin updates land across the fleet in one sweep with
							restarts.

							A fleet project record resolves against the fleet store's row
							of its file key and the caller's older store's row of it, both
							compared under the database's collation, so two names differing
							only in case are one record. Where the fleet store holds no row,
							the caller's live older row moves into it, keeping its usage,
							and keeping its embeddings only where its name and body hash
							are unchanged; otherwise a new row is inserted, and a deleted
							older row stays where it is with its deleted mark. Where the
							fleet row is the caller's own, it is updated or left unchanged
							as any row is.
							Where it is another sandbox's copy holding the same body from a
							file no older than the row's, or the row carries no file time,
							it is updated or left unchanged the same way. A copy carrying
							no file time counts as older. From an older file, the copy is
							kept where the row is unarchived and matches it in every
							published field but the file modification time: nothing is
							written to the row, not even the publish stamp, and the record
							answers unchanged. Otherwise that older copy is a twin this
							call loses. Every test of whether two copies match in their
							published fields compares text under a binary collation, so a
							change of case alone is a change. Where it is another
							sandbox's copy with a different body, the copies are twins:
							the newer file modification time wins, and a tie or a missing
							time keeps the fleet row. No losing copy is stored in any
							store. A winning
							copy is written over the fleet row in place, which keeps its
							RecordId and its usage and keeps its embeddings only where its
							name and body hash are unchanged; the previous fleet body is
							dropped. A losing copy writes no row and creates no store; its
							file stays on its machine. A twin is named in the answer, with
							the sandbox whose copy won and the one whose copy lost, by a
							winning call, and by a losing call unless the caller's older
							row of the file key already carries the deleted mark. So a
							later publish of the same losing copy from a sandbox whose
							older row an earlier call retired names nothing, and a sandbox
							holding no older row of the file key is named by each call
							its copy loses.

							The caller's own older row of the file key, left by a version
							6 era publish, is retired in place once the row is landed,
							unless it is the row that moved into the fleet store, and on a
							held row too: its mem.RecordUsage row first folds into the
							landed row's, the fleet row of the file key, and its
							mem.RecordStamp rows join the landed row, so its read history
							and applied stamps survive it; then it takes the
							deleted mark and UpdatedDt
							and nothing else, so it keeps the stale body it held, and no
							field of the incoming or of a losing copy is written to it.
							That row is the caller's own, not a losing copy this call
							writes. After any of these, the caller's older row of the file
							key carries no live record, and the fleet store holds no
							deleted row a publish wrote.

							A publish never undoes a database verb. A row whose [Origin] is
							memq is never written, and neither is a fleet row carrying the
							deleted mark: both answer held. On a row in any store, the
							archived flag is set by a publish and never cleared, so an
							archive made by mem.usp_ArchiveRecord or by
							mem.usp_PromoteRecord, on a fleet row or an older store's row,
							stands, and a file moved out of its archive folder no longer
							takes its row out of the archive. A live older row that moves
							into the fleet store keeps its own archive. An older row's
							archive passes to no other row: a fleet row this call writes,
							keeps or loses against takes no flag from the older row it
							retires. A NULL field among the six new
							ones keeps its column, which is how a version 6 caller leaves
							them alone.

							Returns {added, changed, unchanged, skippedOlder, removed, held,
							twins}, twins an array of {name, winner, loser} sandbox names.
							A losing twin counts as skippedOlder.

					v1.1 - 09/18/2026 - SCOTT APPLEFELD
							A failure unwinds only a transaction this procedure opened and
							re-raises, so a caller's transaction stays the caller's to
							unwind. Under an INSERT-EXEC, which holds a transaction of its
							own, the caller reads the server's own error text rather than
							error 3915.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							Upserts one batch of records for the calling sandbox. @p_Records
							is a JSON array of objects {tier, segment, name, fileKey,
							description, body, bodyHash, fileModified, machine, tags,
							supersedes, archived}; @p_Removed is a JSON array of {segment,
							fileKey} naming files the caller's own project stores no longer
							hold. The caller's sandbox comes from mem.CallerSandbox() and an
							unmapped login is refused.

							A project tier row lands in the caller's own store as private; a
							type or operator tier row lands in the fleet's store as shared,
							one row serving every sandbox. On an existing row the newer file
							modification time wins and the row records the sandbox that
							published it; a row already shared stays shared, and a deleted
							mark lifts when the file is published again. A body hash or name
							change deletes the row's embeddings so the next publish re-embeds
							it. Removal is a soft mark on the caller's own private project
							rows only; a shared row is never marked removed here. A batch
							that names one file key twice in the same tier and segment keeps
							its last entry and drops the earlier ones, so the batch reads as
							the file's final state.

							Returns one row, one column [Json], holding {added, changed,
							unchanged, skippedOlder, removed}.
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

	/* One Fleet Project Row's Readings. */
	;DECLARE @Ordinal			INT				= NULL
			,@ProjectKey		NVARCHAR(400)	= NULL
			,@Segment			NVARCHAR(400)	= NULL
			,@FileKey			NVARCHAR(400)	= NULL
			,@InName			NVARCHAR(200)	= NULL
			,@InBodyHash		VARCHAR(128)	= NULL
			,@InModifiedDt		DATETIMEOFFSET	= NULL
			,@InIsArchived		BIT				= NULL
			,@FleetStoreId		INT				= NULL
			,@OldStoreId		INT				= NULL
			,@FleetRecordId		BIGINT			= NULL
			,@FleetOrigin		VARCHAR(10)		= NULL
			,@FleetDeletedDt	DATETIMEOFFSET	= NULL
			,@FleetIsArchived	BIT				= NULL
			,@FleetBodyHash		VARCHAR(128)	= NULL
			,@FleetModifiedDt	DATETIMEOFFSET	= NULL
			,@FleetPublisherId	INT				= NULL
			,@OldRecordId		BIGINT			= NULL
			,@OldDeletedDt		DATETIMEOFFSET	= NULL
			,@OldIsArchived		BIT				= NULL
			,@WriteRecordId		BIGINT			= NULL
			,@WriteIsArchived	BIT				= NULL
			,@Action			VARCHAR(10)		= NULL

	/* Result Counts. */
	;DECLARE @Added				INT				= 0
			,@Changed			INT				= 0
			,@Unchanged			INT				= 0
			,@SkippedOlder		INT				= 0
			,@Removed			INT				= 0
			,@Held				INT				= 0

	/* The Batch, With the Store and Record Each Row Resolves To and What the Batch Does to It. */
	;DECLARE @Incoming TABLE (
		 [Ordinal]			INT				NOT NULL	IDENTITY(1,1)
		,[Tier]				VARCHAR(20)		NULL
		,[Segment]			NVARCHAR(400)	NULL
		,[Name]				NVARCHAR(200)	NULL
		,[FileKey]			NVARCHAR(400)	NULL
		,[Description]		NVARCHAR(MAX)	NULL
		,[Body]				NVARCHAR(MAX)	NULL
		,[BodyHash]			VARCHAR(128)	NULL
		,[FileModifiedDt]	DATETIMEOFFSET	NULL
		,[Machine]			NVARCHAR(100)	NULL
		,[Tags]				NVARCHAR(MAX)	NULL
		,[SupersedesName]	NVARCHAR(200)	NULL
		,[IsArchived]		BIT				NULL
		,[ProjectKey]		NVARCHAR(MAX)	NULL
		,[Triggers]			NVARCHAR(MAX)	NULL
		,[Anchors]			NVARCHAR(MAX)	NULL
		,[IsPinned]			BIT				NULL
		,[CreatedOn]		DATE			NULL
		,[Author]			NVARCHAR(200)	NULL
		,[IsFleetProject]	BIT				NOT NULL	DEFAULT(0)
		,[StoreSandboxId]	INT				NULL
		,[StoreId]			INT				NULL
		,[RecordId]			BIGINT			NULL
		,[Disposition]		VARCHAR(20)		NULL
	)

	/* The Twins the Batch Resolved, by the Sandbox Whose Copy Won and the One Whose Copy Lost. */
	;DECLARE @Twins TABLE (
		 [Ordinal]			INT				NOT NULL	IDENTITY(1,1)
		,[Name]				NVARCHAR(200)	NOT NULL
		,[WinnerSandboxId]	INT				NULL
		,[LoserSandboxId]	INT				NULL
	)

	/* The File Keys the Batch Names as Removed. */
	;DECLARE @RemovedKeys TABLE (
		 [Segment]			NVARCHAR(400)	NOT NULL
		,[FileKey]			NVARCHAR(400)	NOT NULL
	)

	/********************************************************************************************
		VALIDATE THE CALLER AND THE BATCH, THEN UPSERT AS ONE UNIT.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Publishes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_UpsertRecords: the calling login maps to no sandbox.', 1

		;IF ( @p_Records IS NULL OR ISJSON(@p_Records, ARRAY) <> 1 )
			THROW 50000, 'mem.usp_UpsertRecords: @p_Records must be a JSON array.', 1

		;IF ( @p_Removed IS NOT NULL AND ISJSON(@p_Removed, ARRAY) <> 1 )
			THROW 50000, 'mem.usp_UpsertRecords: @p_Removed must be a JSON array when given.', 1

		/* Parse the Batch Into Typed Rows, Canonicalizing the Tier and Its Segment. */
		;INSERT INTO @Incoming (
			 [Tier]
			,[Segment]
			,[Name]
			,[FileKey]
			,[Description]
			,[Body]
			,[BodyHash]
			,[FileModifiedDt]
			,[Machine]
			,[Tags]
			,[SupersedesName]
			,[IsArchived]
			,[ProjectKey]
			,[Triggers]
			,[Anchors]
			,[IsPinned]
			,[CreatedOn]
			,[Author]			)
		SELECT	 [Tier]				= LOWER(LTRIM(RTRIM(J.[Tier])))
				,[Segment]			= CASE	WHEN LOWER(LTRIM(RTRIM(J.[Tier]))) = 'operator'
											THEN NULL
											ELSE NULLIF(LTRIM(RTRIM(J.[Segment])), '')
									  END
				,[Name]				= NULLIF(LTRIM(RTRIM(J.[Name])), '')
				,[FileKey]			= NULLIF(LTRIM(RTRIM(J.[FileKey])), '')
				,[Description]		= COALESCE(J.[Description], N'')
				,[Body]				= COALESCE(J.[Body], N'')
				,[BodyHash]			= COALESCE(J.[BodyHash], '')
				,[FileModifiedDt]	= J.[FileModifiedDt]
				,[Machine]			= NULLIF(LTRIM(RTRIM(J.[Machine])), '')
				,[Tags]				= J.[Tags]
				,[SupersedesName]	= NULLIF(LTRIM(RTRIM(J.[SupersedesName])), '')
				,[IsArchived]		= COALESCE(J.[IsArchived], @False)
				,[ProjectKey]		= NULLIF(LTRIM(RTRIM(J.[ProjectKey])), '')
				,[Triggers]			= J.[Triggers]
				,[Anchors]			= J.[Anchors]
				,[IsPinned]			= J.[IsPinned]
				,[CreatedOn]		= J.[CreatedOn]
				,[Author]			= NULLIF(LTRIM(RTRIM(J.[Author])), '')
		FROM	OPENJSON(@p_Records)
				WITH (	 [Tier]				VARCHAR(20)		'$.tier'
						,[Segment]			NVARCHAR(400)	'$.segment'
						,[Name]				NVARCHAR(200)	'$.name'
						,[FileKey]			NVARCHAR(400)	'$.fileKey'
						,[Description]		NVARCHAR(MAX)	'$.description'
						,[Body]				NVARCHAR(MAX)	'$.body'
						,[BodyHash]			VARCHAR(128)	'$.bodyHash'
						,[FileModifiedDt]	DATETIMEOFFSET	'$.fileModified'
						,[Machine]			NVARCHAR(100)	'$.machine'
						,[Tags]				NVARCHAR(MAX)	'$.tags' AS JSON
						,[SupersedesName]	NVARCHAR(200)	'$.supersedes'
						,[IsArchived]		BIT				'$.archived'
						,[ProjectKey]		NVARCHAR(MAX)	'$.projectKey'
						,[Triggers]			NVARCHAR(MAX)	'$.triggers' AS JSON
						,[Anchors]			NVARCHAR(MAX)	'$.anchors' AS JSON
						,[IsPinned]			BIT				'$.pinned'
						,[CreatedOn]		DATE			'$.created'
						,[Author]			NVARCHAR(200)	'$.author'		) J

		/* Refuse a Row Whose Shape No Store Can Hold. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	I.[Tier] IS NULL
								OR I.[Tier] NOT IN ('project', 'type', 'operator')
								OR I.[Name] IS NULL
								OR I.[FileKey] IS NULL
								OR (	I.[Tier] IN ('project', 'type')
										AND I.[Segment] IS NULL	)	)
			THROW 50000, 'mem.usp_UpsertRecords: every record needs a tier of project, type or operator, a name, a file key, and a segment for the project and type tiers.', 1

		/* Refuse a Project Key Off the Project Tier or Longer Than a Store Holds, and a List That is Not an Array. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	(	I.[ProjectKey] IS NOT NULL
									AND (	I.[Tier] <> 'project'
											OR LEN(I.[ProjectKey]) > 400	)	)
								OR ( I.[Triggers] IS NOT NULL AND ISJSON(I.[Triggers], ARRAY) <> 1 )
								OR ( I.[Anchors] IS NOT NULL AND ISJSON(I.[Anchors], ARRAY) <> 1 )	)
			THROW 50000, 'mem.usp_UpsertRecords: a projectKey rides on a project record only and holds at most 400 characters, and triggers and anchors are each a JSON array when given.', 1

		/* Refuse a Project Key That Opens Neither Prefix a Key Takes, Compared Case-Sensitively. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	I.[ProjectKey] IS NOT NULL
								AND LEFT(I.[ProjectKey], 5) COLLATE Latin1_General_CS_AS <> 'path:'
								AND LEFT(I.[ProjectKey], 7) COLLATE Latin1_General_CS_AS <> 'remote:'	)
			THROW 50000, 'mem.usp_UpsertRecords: a projectKey opens path: or remote:, in lower case.', 1

		/* Refuse a Project Key That is the Bare Prefix, With Nothing After It. */
		;IF EXISTS (	SELECT	NULL
						FROM	@Incoming I
						WHERE	(	LEFT(I.[ProjectKey], 5) COLLATE Latin1_General_CS_AS = 'path:'
									AND LEN(I.[ProjectKey]) < 6	)
								OR (	LEFT(I.[ProjectKey], 7) COLLATE Latin1_General_CS_AS = 'remote:'
										AND LEN(I.[ProjectKey]) < 8	)	)
			THROW 50000, 'mem.usp_UpsertRecords: a projectKey opens path: or remote: and names something after it.', 1

		/* A Key Named Twice Keeps Its Last Entry; INTERSECT Treats Two NULL Segments as Equal. */
		;DELETE I
		FROM	@Incoming I
		WHERE	EXISTS (	SELECT	NULL
							FROM	@Incoming L
							WHERE	L.[Ordinal] > I.[Ordinal]
									AND L.[Tier] = I.[Tier]
									AND L.[FileKey] = I.[FileKey]
									AND EXISTS (	SELECT L.[Segment]
													INTERSECT
													SELECT I.[Segment]	)	)

		/* An Older-Shape Project Row Belongs to the Caller's Sandbox; a Shared Tier Row Belongs to the Fleet. */
		/* A Project Row Carrying a Project Key is Landed Row by Row Below, so Every Set Statement Passes It By. */
		;UPDATE I
		SET		 [StoreSandboxId]	= CASE WHEN I.[Tier] = 'project' THEN @SandboxId ELSE NULL END
				,[IsFleetProject]	= CASE WHEN I.[Tier] = 'project' AND I.[ProjectKey] IS NOT NULL THEN @True ELSE @False END
		FROM	@Incoming I

		/* Parse the Removed Keys, Dropping Any Entry Missing Either Half. */
		;INSERT INTO @RemovedKeys (
			 [Segment]
			,[FileKey]	)
		SELECT	 [Segment]	= LTRIM(RTRIM(J.[Segment]))
				,[FileKey]	= LTRIM(RTRIM(J.[FileKey]))
		FROM	OPENJSON(COALESCE(@p_Removed, N'[]'))
				WITH (	 [Segment]	NVARCHAR(400)	'$.segment'
						,[FileKey]	NVARCHAR(400)	'$.fileKey'	) J
		WHERE	NULLIF(LTRIM(RTRIM(J.[Segment])), '') IS NOT NULL
				AND NULLIF(LTRIM(RTRIM(J.[FileKey])), '') IS NOT NULL

		/* Open a Transaction Unless the Caller Holds One. */
		;IF ( @EntryTranCount = 0 )
			BEGIN TRANSACTION

		/* Publishes Serialize on One Fleet-Wide Application Lock, Held to the End of the Transaction. */
		/* Two Sandboxes First-Publishing One Shared Store or Record Therefore Queue Instead of Racing the Unique Index. */
		;EXEC @LockResult = sp_getapplock @Resource = 'mem.Publish', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000
		;IF ( @LockResult < 0 )
			THROW 50000, 'mem.usp_UpsertRecords: the fleet publish lock was not acquired before the wait timed out; another publish is holding it.', 1

		/****************************************************************************************
			RESOLVE THE STORES, CREATING THE ONES THE BATCH NAMES FOR THE FIRST TIME.
		****************************************************************************************/
		/* INTERSECT Compares the Nullable Halves of the Key as Equal When Both are NULL. */
		;INSERT INTO mem.Store (
			 [SandboxId]
			,[Tier]
			,[Segment]	)
		SELECT	DISTINCT
				 [SandboxId]	= I.[StoreSandboxId]
				,[Tier]			= I.[Tier]
				,[Segment]		= I.[Segment]
		FROM	@Incoming I
		WHERE	I.[IsFleetProject] = @False
				AND NOT EXISTS (	SELECT	NULL
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
					AND S.[ProjectKey] IS NULL
					AND EXISTS (	SELECT S.[SandboxId], S.[Segment]
									INTERSECT
									SELECT I.[StoreSandboxId], I.[Segment]	)
		WHERE	I.[IsFleetProject] = @False

		/****************************************************************************************
			RESOLVE EACH ROW'S EXISTING RECORD AND DECIDE WHAT THE BATCH DOES TO IT.
		****************************************************************************************/
		/* A Row Keeps an Archive a Database Verb Set, mem.usp_PromoteRecord's on an Older Store's Row Among Them: a Publish Sets the Flag and Never Clears It. */
		;UPDATE I
		SET		[IsArchived] = @True
		FROM	@Incoming I
				INNER JOIN mem.Record R
					ON	R.[StoreId] = I.[StoreId]
					AND R.[FileKey] = I.[FileKey]
		WHERE	I.[IsFleetProject] = @False
				AND R.[IsArchived] = @True

		/* Held Means a Row a Database Verb Wrote or Deleted in a Store With No Sandbox, Which a Publish Never Writes. */
		/* Unchanged Means Every Published Field Matches and the Row Carries no Deleted Mark; a NULL New Field Keeps Its Column. */
		/* Text Compares Under a Binary Collation, so a Change of Case Alone is a Change. */
		/* Older Means a Shared Row Already Holds a Newer File Than the One This Sandbox Has. */
		;UPDATE I
		SET		 [RecordId]		= R.[RecordId]
				,[Disposition]	= CASE
									WHEN R.[RecordId] IS NULL
									THEN 'add'
									WHEN I.[StoreSandboxId] IS NULL
										AND (	R.[Origin] = 'memq'
												OR R.[DeletedDt] IS NOT NULL	)
									THEN 'held'
									WHEN EXISTS (	SELECT	 R.[Name] COLLATE Latin1_General_BIN2, R.[Description] COLLATE Latin1_General_BIN2
															,R.[Body] COLLATE Latin1_General_BIN2, R.[BodyHash] COLLATE Latin1_General_BIN2, R.[FileModifiedDt]
															,R.[Machine] COLLATE Latin1_General_BIN2, R.[Tags] COLLATE Latin1_General_BIN2
															,R.[SupersedesName] COLLATE Latin1_General_BIN2, R.[IsArchived], R.[DeletedDt]
															,R.[Triggers] COLLATE Latin1_General_BIN2, R.[Anchors] COLLATE Latin1_General_BIN2
															,R.[IsPinned], R.[CreatedOn], R.[Author] COLLATE Latin1_General_BIN2
													INTERSECT
													SELECT	 I.[Name] COLLATE Latin1_General_BIN2, I.[Description] COLLATE Latin1_General_BIN2
															,I.[Body] COLLATE Latin1_General_BIN2, I.[BodyHash] COLLATE Latin1_General_BIN2, I.[FileModifiedDt]
															,I.[Machine] COLLATE Latin1_General_BIN2, I.[Tags] COLLATE Latin1_General_BIN2
															,I.[SupersedesName] COLLATE Latin1_General_BIN2, I.[IsArchived], CAST(NULL AS DATETIMEOFFSET)
															,COALESCE(I.[Triggers], R.[Triggers]) COLLATE Latin1_General_BIN2
															,COALESCE(I.[Anchors], R.[Anchors]) COLLATE Latin1_General_BIN2
															,COALESCE(I.[IsPinned], R.[IsPinned]), COALESCE(I.[CreatedOn], R.[CreatedOn])
															,COALESCE(I.[Author], R.[Author]) COLLATE Latin1_General_BIN2	)
									THEN 'unchanged'
									WHEN I.[StoreSandboxId] IS NULL
										AND I.[FileModifiedDt] IS NOT NULL
										AND R.[FileModifiedDt] IS NOT NULL
										AND I.[FileModifiedDt] < R.[FileModifiedDt]
									THEN 'older'
									ELSE 'change'
								  END
		FROM	@Incoming I
				LEFT JOIN mem.Record R
					ON	R.[StoreId] = I.[StoreId]
					AND R.[FileKey] = I.[FileKey]
		WHERE	I.[IsFleetProject] = @False

		/****************************************************************************************
			APPLY THE BATCH.
		****************************************************************************************/
		/* Drop the Embeddings of Every Row Whose Embedded Text Changed, so the Next Publish Re-Embeds It. */
		;DELETE E
		FROM	mem.Embedding E
				INNER JOIN @Incoming I
					ON I.[RecordId] = E.[RecordId]
				INNER JOIN mem.Record R
					ON R.[RecordId] = I.[RecordId]
		WHERE	I.[Disposition] = 'change'
				AND (	R.[BodyHash] <> I.[BodyHash]
						OR R.[Name] <> I.[Name]	)

		/* Update the Changed Rows. Visibility is Kept, so a Promoted Row Stays Shared. */
		;UPDATE R
		SET		 [Name]						= I.[Name]
				,[Description]				= I.[Description]
				,[Body]						= I.[Body]
				,[BodyHash]					= I.[BodyHash]
				,[FileModifiedDt]			= I.[FileModifiedDt]
				,[Machine]					= I.[Machine]
				,[Tags]						= I.[Tags]
				,[SupersedesName]			= I.[SupersedesName]
				,[IsArchived]				= I.[IsArchived]
				,[Triggers]					= COALESCE(I.[Triggers], R.[Triggers])
				,[Anchors]					= COALESCE(I.[Anchors], R.[Anchors])
				,[IsPinned]					= COALESCE(I.[IsPinned], R.[IsPinned])
				,[CreatedOn]				= COALESCE(I.[CreatedOn], R.[CreatedOn])
				,[Author]					= COALESCE(I.[Author], R.[Author])
				,[LastPublishedBySandboxId]	= @SandboxId
				,[LastPublishedDt]			= @Now
				,[DeletedDt]				= NULL
				,[UpdatedDt]				= @Now
		FROM	mem.Record R
				INNER JOIN @Incoming I
					ON I.[RecordId] = R.[RecordId]
		WHERE	I.[Disposition] = 'change'

		/* Stamp the Publish on Every Other Row the Batch Carried; an Older Copy Never Takes the Publisher Credit. */
		;UPDATE R
		SET		 [LastPublishedBySandboxId]	= CASE WHEN I.[Disposition] = 'unchanged' THEN @SandboxId ELSE R.[LastPublishedBySandboxId] END
				,[LastPublishedDt]			= @Now
		FROM	mem.Record R
				INNER JOIN @Incoming I
					ON I.[RecordId] = R.[RecordId]
		WHERE	I.[Disposition] IN ('unchanged', 'older')

		/* Insert the New Rows, Private for a Project Store and Shared for the Fleet's Stores. */
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
			,[IsArchived]
			,[Triggers]
			,[Anchors]
			,[IsPinned]
			,[CreatedOn]
			,[Author]
			,[Visibility]
			,[LastPublishedBySandboxId]
			,[LastPublishedDt]			)
		SELECT	 [StoreId]					= I.[StoreId]
				,[Name]						= I.[Name]
				,[FileKey]					= I.[FileKey]
				,[Description]				= I.[Description]
				,[Body]						= I.[Body]
				,[BodyHash]					= I.[BodyHash]
				,[FileModifiedDt]			= I.[FileModifiedDt]
				,[Machine]					= I.[Machine]
				,[Tags]						= I.[Tags]
				,[SupersedesName]			= I.[SupersedesName]
				,[IsArchived]				= I.[IsArchived]
				,[Triggers]					= I.[Triggers]
				,[Anchors]					= I.[Anchors]
				,[IsPinned]					= COALESCE(I.[IsPinned], @False)
				,[CreatedOn]				= I.[CreatedOn]
				,[Author]					= I.[Author]
				,[Visibility]				= CASE WHEN I.[Tier] = 'project' THEN 'private' ELSE 'shared' END
				,[LastPublishedBySandboxId]	= @SandboxId
				,[LastPublishedDt]			= @Now
		FROM	@Incoming I
		WHERE	I.[Disposition] = 'add'

		/****************************************************************************************
			LAND EACH FLEET PROJECT ROW: MOVE IT, MERGE ITS TWIN, OR HOLD IT.
		****************************************************************************************/
		;SELECT	@Ordinal = MIN(I.[Ordinal])
		FROM	@Incoming I
		WHERE	I.[IsFleetProject] = @True

		;WHILE ( @Ordinal IS NOT NULL )
		BEGIN
			/* The Row's Own Fields. */
			;SELECT	 @ProjectKey		= I.[ProjectKey]
					,@Segment			= I.[Segment]
					,@FileKey			= I.[FileKey]
					,@InName			= I.[Name]
					,@InBodyHash		= I.[BodyHash]
					,@InModifiedDt		= I.[FileModifiedDt]
					,@InIsArchived		= I.[IsArchived]
					,@FleetStoreId		= NULL
					,@OldStoreId		= NULL
					,@FleetRecordId		= NULL
					,@FleetOrigin		= NULL
					,@FleetDeletedDt	= NULL
					,@FleetIsArchived	= NULL
					,@FleetBodyHash		= NULL
					,@FleetModifiedDt	= NULL
					,@FleetPublisherId	= NULL
					,@OldRecordId		= NULL
					,@OldDeletedDt		= NULL
					,@OldIsArchived		= NULL
					,@WriteRecordId		= NULL
					,@WriteIsArchived	= NULL
					,@Action			= NULL
			FROM	@Incoming I
			WHERE	I.[Ordinal] = @Ordinal

			/* The Key's Fleet Store, Created Where Absent. */
			;SELECT	@FleetStoreId = S.[StoreId]
			FROM	mem.Store S
			WHERE	S.[Tier] = 'project'
					AND S.[ProjectKey] = @ProjectKey

			;IF ( @FleetStoreId IS NULL )
			BEGIN
				;INSERT INTO mem.Store (
					 [SandboxId]
					,[Tier]
					,[Segment]
					,[ProjectKey]	)
				SELECT	 [SandboxId]	= NULL
						,[Tier]			= 'project'
						,[Segment]		= NULL
						,[ProjectKey]	= @ProjectKey

				;SET @FleetStoreId = SCOPE_IDENTITY()
			END

			/* The Caller's Older Store for the Segment, Where It Has One. */
			;SELECT	@OldStoreId = S.[StoreId]
			FROM	mem.Store S
			WHERE	S.[SandboxId] = @SandboxId
					AND S.[Tier] = 'project'
					AND S.[Segment] = @Segment
					AND S.[ProjectKey] IS NULL

			/* The Fleet Row and the Older Row of the File Key, Equal Under the Database's Collation. */
			;SELECT	 @FleetRecordId		= R.[RecordId]
					,@FleetOrigin		= R.[Origin]
					,@FleetDeletedDt	= R.[DeletedDt]
					,@FleetIsArchived	= R.[IsArchived]
					,@FleetBodyHash		= R.[BodyHash]
					,@FleetModifiedDt	= R.[FileModifiedDt]
					,@FleetPublisherId	= R.[LastPublishedBySandboxId]
			FROM	mem.Record R
			WHERE	R.[StoreId] = @FleetStoreId
					AND R.[FileKey] = @FileKey

			;SELECT	 @OldRecordId	= R.[RecordId]
					,@OldDeletedDt	= R.[DeletedDt]
					,@OldIsArchived	= R.[IsArchived]
			FROM	mem.Record R
			WHERE	R.[StoreId] = @OldStoreId
					AND R.[FileKey] = @FileKey

			/************************************************************************************
				DECIDE WHAT THE ROW DOES.
			************************************************************************************/
			;IF ( @FleetRecordId IS NULL )
			BEGIN
				/* No Fleet Row: a Live Older Row Moves In, Keeping Its Archive; Otherwise a New Row is Inserted and a Deleted Older Row Stays as It Is. */
				;IF ( @OldRecordId IS NOT NULL AND @OldDeletedDt IS NULL )
				BEGIN
					;SELECT	 @Action			= 'write'
							,@WriteRecordId		= @OldRecordId
							,@WriteIsArchived	= CASE WHEN @OldIsArchived = @True THEN @True ELSE @InIsArchived END
				END ELSE BEGIN
					;SELECT	 @Action			= 'insert'
							,@WriteIsArchived	= @InIsArchived
				END
			END
			ELSE IF ( @FleetOrigin = 'memq' OR @FleetDeletedDt IS NOT NULL )
			BEGIN
				/* A Row a Database Verb Wrote or Deleted is Never Written by a Publish. */
				;SET @Action = 'held'
			END
			ELSE IF (	@FleetBodyHash = @InBodyHash
						AND ( @FleetPublisherId IS NULL OR @FleetPublisherId <> @SandboxId )
						AND (	@InModifiedDt IS NULL
								OR @InModifiedDt < @FleetModifiedDt	)
						AND @FleetIsArchived = @False
						AND EXISTS (	SELECT	 R.[Name] COLLATE Latin1_General_BIN2, R.[Description] COLLATE Latin1_General_BIN2
												,R.[Body] COLLATE Latin1_General_BIN2, R.[BodyHash] COLLATE Latin1_General_BIN2
												,R.[Machine] COLLATE Latin1_General_BIN2, R.[Tags] COLLATE Latin1_General_BIN2
												,R.[SupersedesName] COLLATE Latin1_General_BIN2, R.[IsArchived]
												,R.[Triggers] COLLATE Latin1_General_BIN2, R.[Anchors] COLLATE Latin1_General_BIN2
												,R.[IsPinned], R.[CreatedOn], R.[Author] COLLATE Latin1_General_BIN2
										FROM	mem.Record R
										WHERE	R.[RecordId] = @FleetRecordId
										INTERSECT
										SELECT	 I.[Name] COLLATE Latin1_General_BIN2, I.[Description] COLLATE Latin1_General_BIN2
												,I.[Body] COLLATE Latin1_General_BIN2, I.[BodyHash] COLLATE Latin1_General_BIN2
												,I.[Machine] COLLATE Latin1_General_BIN2, I.[Tags] COLLATE Latin1_General_BIN2
												,I.[SupersedesName] COLLATE Latin1_General_BIN2, I.[IsArchived]
												,COALESCE(I.[Triggers], R.[Triggers]) COLLATE Latin1_General_BIN2
												,COALESCE(I.[Anchors], R.[Anchors]) COLLATE Latin1_General_BIN2
												,COALESCE(I.[IsPinned], R.[IsPinned]), COALESCE(I.[CreatedOn], R.[CreatedOn])
												,COALESCE(I.[Author], R.[Author]) COLLATE Latin1_General_BIN2
										FROM	@Incoming I
												INNER JOIN mem.Record R
													ON R.[RecordId] = @FleetRecordId
										WHERE	I.[Ordinal] = @Ordinal	)	)
			BEGIN
				/* Another's Live, Unarchived Fleet Row From a Newer File, or Over a Copy Carrying No File Time, Matching This Copy in Every Published Field but the File Time: the Older Copy Writes Nothing, Not Even a Stamp. */
				;SET @Action = 'kept'
			END
			ELSE IF (	@FleetPublisherId = @SandboxId
						OR (	@FleetBodyHash = @InBodyHash
								AND @InModifiedDt IS NOT NULL
								AND (	@FleetModifiedDt IS NULL
										OR @InModifiedDt >= @FleetModifiedDt	)	)	)
			BEGIN
				/* The Caller's Own Fleet Row, or Another's Holding the Same Body From a File No Older, a Copy Carrying No File Time Counting as Older: Updated or Left as Any Row Is, Keeping the Fleet Row's Own Archive. */
				;SET @WriteIsArchived = CASE	WHEN @FleetIsArchived = @True
												THEN @True
												ELSE @InIsArchived
										  END

				/* Text Compares Under a Binary Collation, so a Change of Case Alone is Written. */
				;IF EXISTS (	SELECT	 R.[Name] COLLATE Latin1_General_BIN2, R.[Description] COLLATE Latin1_General_BIN2
										,R.[Body] COLLATE Latin1_General_BIN2, R.[BodyHash] COLLATE Latin1_General_BIN2, R.[FileModifiedDt]
										,R.[Machine] COLLATE Latin1_General_BIN2, R.[Tags] COLLATE Latin1_General_BIN2
										,R.[SupersedesName] COLLATE Latin1_General_BIN2, R.[IsArchived]
										,R.[Triggers] COLLATE Latin1_General_BIN2, R.[Anchors] COLLATE Latin1_General_BIN2
										,R.[IsPinned], R.[CreatedOn], R.[Author] COLLATE Latin1_General_BIN2
								FROM	mem.Record R
								WHERE	R.[RecordId] = @FleetRecordId
								INTERSECT
								SELECT	 I.[Name] COLLATE Latin1_General_BIN2, I.[Description] COLLATE Latin1_General_BIN2
										,I.[Body] COLLATE Latin1_General_BIN2, I.[BodyHash] COLLATE Latin1_General_BIN2, I.[FileModifiedDt]
										,I.[Machine] COLLATE Latin1_General_BIN2, I.[Tags] COLLATE Latin1_General_BIN2
										,I.[SupersedesName] COLLATE Latin1_General_BIN2, @WriteIsArchived
										,COALESCE(I.[Triggers], R.[Triggers]) COLLATE Latin1_General_BIN2
										,COALESCE(I.[Anchors], R.[Anchors]) COLLATE Latin1_General_BIN2
										,COALESCE(I.[IsPinned], R.[IsPinned]), COALESCE(I.[CreatedOn], R.[CreatedOn])
										,COALESCE(I.[Author], R.[Author]) COLLATE Latin1_General_BIN2
								FROM	@Incoming I
										INNER JOIN mem.Record R
											ON R.[RecordId] = @FleetRecordId
								WHERE	I.[Ordinal] = @Ordinal	)
				BEGIN
					;SET @Action = 'stamp'
				END ELSE BEGIN
					;SELECT	 @Action		= 'write'
							,@WriteRecordId	= @FleetRecordId
				END
			END
			ELSE IF (	@InModifiedDt IS NOT NULL
						AND @FleetModifiedDt IS NOT NULL
						AND @InModifiedDt > @FleetModifiedDt	)
			BEGIN
				/* A Twin This Copy Wins: It is Written Over the Fleet Row in Place, Which Keeps Its RecordId, Usage and Own Archive, and the Previous Fleet Body is Dropped. */
				;SELECT	 @Action			= 'write'
						,@WriteRecordId		= @FleetRecordId
						,@WriteIsArchived	= CASE WHEN @FleetIsArchived = @True THEN @True ELSE @InIsArchived END

				;INSERT INTO @Twins (
					 [Name]
					,[WinnerSandboxId]
					,[LoserSandboxId]	)
				SELECT	 [Name]				= @InName
						,[WinnerSandboxId]	= @SandboxId
						,[LoserSandboxId]	= @FleetPublisherId
			END
			ELSE
			BEGIN
				/* A Twin This Copy Loses: the Losing Copy is Written Nowhere. */
				;SET @Action = 'lost'

				/* The Twin is Named Where the Caller Holds No Older Row of the File Key or Retires a Live One Below; an Older Row Already Deleted Names Nothing. */
				;IF ( @OldRecordId IS NULL OR @OldDeletedDt IS NULL )
				BEGIN
					;INSERT INTO @Twins (
						 [Name]
						,[WinnerSandboxId]
						,[LoserSandboxId]	)
					SELECT	 [Name]				= @InName
							,[WinnerSandboxId]	= @FleetPublisherId
							,[LoserSandboxId]	= @SandboxId
				END
			END

			/************************************************************************************
				APPLY WHAT WAS DECIDED.
			************************************************************************************/
			;IF ( @Action = 'write' )
			BEGIN
				/* A Changed Body or Name Drops the Vectors Made From the Old Text. */
				;DELETE E
				FROM	mem.Embedding E
						INNER JOIN mem.Record R
							ON R.[RecordId] = E.[RecordId]
				WHERE	E.[RecordId] = @WriteRecordId
						AND (	R.[BodyHash] <> @InBodyHash
								OR R.[Name] <> @InName	)

				;UPDATE R
				SET		 [StoreId]					= @FleetStoreId
						,[Name]						= I.[Name]
						,[Description]				= I.[Description]
						,[Body]						= I.[Body]
						,[BodyHash]					= I.[BodyHash]
						,[FileModifiedDt]			= I.[FileModifiedDt]
						,[Machine]					= I.[Machine]
						,[Tags]						= I.[Tags]
						,[SupersedesName]			= I.[SupersedesName]
						,[IsArchived]				= @WriteIsArchived
						,[Triggers]					= COALESCE(I.[Triggers], R.[Triggers])
						,[Anchors]					= COALESCE(I.[Anchors], R.[Anchors])
						,[IsPinned]					= COALESCE(I.[IsPinned], R.[IsPinned])
						,[CreatedOn]				= COALESCE(I.[CreatedOn], R.[CreatedOn])
						,[Author]					= COALESCE(I.[Author], R.[Author])
						,[Visibility]				= 'shared'
						,[LastPublishedBySandboxId]	= @SandboxId
						,[LastPublishedDt]			= @Now
						,[DeletedDt]				= NULL
						,[UpdatedDt]				= @Now
				FROM	mem.Record R
						INNER JOIN @Incoming I
							ON I.[Ordinal] = @Ordinal
				WHERE	R.[RecordId] = @WriteRecordId
			END
			ELSE IF ( @Action = 'insert' )
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
					,[IsArchived]
					,[Triggers]
					,[Anchors]
					,[IsPinned]
					,[CreatedOn]
					,[Author]
					,[Visibility]
					,[LastPublishedBySandboxId]
					,[LastPublishedDt]			)
				SELECT	 [StoreId]					= @FleetStoreId
						,[Name]						= I.[Name]
						,[FileKey]					= I.[FileKey]
						,[Description]				= I.[Description]
						,[Body]						= I.[Body]
						,[BodyHash]					= I.[BodyHash]
						,[FileModifiedDt]			= I.[FileModifiedDt]
						,[Machine]					= I.[Machine]
						,[Tags]						= I.[Tags]
						,[SupersedesName]			= I.[SupersedesName]
						,[IsArchived]				= @WriteIsArchived
						,[Triggers]					= I.[Triggers]
						,[Anchors]					= I.[Anchors]
						,[IsPinned]					= COALESCE(I.[IsPinned], @False)
						,[CreatedOn]				= I.[CreatedOn]
						,[Author]					= I.[Author]
						,[Visibility]				= 'shared'
						,[LastPublishedBySandboxId]	= @SandboxId
						,[LastPublishedDt]			= @Now
				FROM	@Incoming I
				WHERE	I.[Ordinal] = @Ordinal

				;SET @WriteRecordId = SCOPE_IDENTITY()
			END
			ELSE IF ( @Action = 'stamp' )
			BEGIN
				;UPDATE R
				SET		 [LastPublishedBySandboxId]	= @SandboxId
						,[LastPublishedDt]			= @Now
				FROM	mem.Record R
				WHERE	R.[RecordId] = @FleetRecordId
			END

			/* The Caller's Older Row of the File Key Carries No Live Record Once the Row is Landed; It Takes the Deleted Mark and No Field of Any Copy. */
			;IF ( @OldRecordId IS NOT NULL AND @OldRecordId <> COALESCE(@WriteRecordId, -1) AND @OldDeletedDt IS NULL )
			BEGIN
				/* Its Usage Folds Into the Landed Row's and Its Write Stamps Join the Landed Row First, so Its Read History and Applied Stamps Survive It. */
				;UPDATE W
				SET		 [LastReadDt]		= GREATEST(W.[LastReadDt], L.[LastReadDt])
						,[LastAppliedDt]	= GREATEST(W.[LastAppliedDt], L.[LastAppliedDt])
						,[AppliedDays]		= W.[AppliedDays] + M.[NewDays]
						,[AppliedDates]		= M.[AppliedDates]
						,[UpdatedDt]		= @Now
				FROM	mem.RecordUsage W WITH ( UPDLOCK, HOLDLOCK )
						INNER JOIN mem.RecordUsage L WITH ( UPDLOCK, HOLDLOCK )
							ON L.[RecordId] = @OldRecordId
						CROSS APPLY mem.udf_MergeAppliedDates(W.[AppliedDates], L.[AppliedDates]) M
				WHERE	W.[RecordId] = COALESCE(@WriteRecordId, @FleetRecordId)

				/* A Landed Row With No Usage Row Takes the Older Row's as It Stands. */
				;INSERT INTO mem.RecordUsage (
					 [RecordId]
					,[LastReadDt]
					,[LastAppliedDt]
					,[AppliedDays]
					,[AppliedDates]	)
				SELECT	 [RecordId]			= COALESCE(@WriteRecordId, @FleetRecordId)
						,[LastReadDt]		= L.[LastReadDt]
						,[LastAppliedDt]	= L.[LastAppliedDt]
						,[AppliedDays]		= L.[AppliedDays]
						,[AppliedDates]		= L.[AppliedDates]
				FROM	mem.RecordUsage L WITH ( UPDLOCK, HOLDLOCK )
				WHERE	L.[RecordId] = @OldRecordId
						AND NOT EXISTS (	SELECT	NULL
											FROM	mem.RecordUsage W WITH ( UPDLOCK, HOLDLOCK )
											WHERE	W.[RecordId] = COALESCE(@WriteRecordId, @FleetRecordId)	)

				;DELETE L
				FROM	mem.RecordUsage L
				WHERE	L.[RecordId] = @OldRecordId

				;UPDATE RS
				SET		 [RecordId]		= COALESCE(@WriteRecordId, @FleetRecordId)
						,[UpdatedDt]	= @Now
				FROM	mem.RecordStamp RS
				WHERE	RS.[RecordId] = @OldRecordId

				;UPDATE R
				SET		 [DeletedDt]	= @Now
						,[UpdatedDt]	= @Now
				FROM	mem.Record R
				WHERE	R.[RecordId] = @OldRecordId
						AND R.[StoreId] = @OldStoreId
			END

			;UPDATE I
			SET		 [RecordId]		= COALESCE(@WriteRecordId, @FleetRecordId)
					,[StoreId]		= @FleetStoreId
					,[Disposition]	= CASE @Action
										WHEN 'insert'	THEN 'add'
										WHEN 'write'	THEN 'change'
										WHEN 'stamp'	THEN 'unchanged'
										WHEN 'kept'		THEN 'unchanged'
										WHEN 'lost'		THEN 'older'
										ELSE 'held'
									  END
			FROM	@Incoming I
			WHERE	I.[Ordinal] = @Ordinal

			;SELECT	@Ordinal = MIN(I.[Ordinal])
			FROM	@Incoming I
			WHERE	I.[IsFleetProject] = @True
					AND I.[Ordinal] > @Ordinal
		END

		/* Mark Removed the Caller's Own Private Project Rows the Batch Named. */
		;UPDATE R
		SET		 [DeletedDt]	= @Now
				,[UpdatedDt]	= @Now
		FROM	mem.Record R
				INNER JOIN mem.Store S
					ON S.[StoreId] = R.[StoreId]
				INNER JOIN @RemovedKeys K
					ON	K.[Segment] = S.[Segment]
					AND K.[FileKey] = R.[FileKey]
		WHERE	S.[Tier] = 'project'
				AND S.[SandboxId] = @SandboxId
				AND R.[Visibility] = 'private'
				AND R.[DeletedDt] IS NULL

		;SET @Removed = @@ROWCOUNT

		/* Commit Only a Transaction This Procedure Opened. */
		;IF ( @EntryTranCount = 0 )
			COMMIT TRANSACTION

		/****************************************************************************************
			DATASET 1: THE COUNTS.
		****************************************************************************************/
		;SELECT	 @Added			= SUM(CASE WHEN I.[Disposition] = 'add' THEN 1 ELSE 0 END)
				,@Changed		= SUM(CASE WHEN I.[Disposition] = 'change' THEN 1 ELSE 0 END)
				,@Unchanged		= SUM(CASE WHEN I.[Disposition] = 'unchanged' THEN 1 ELSE 0 END)
				,@SkippedOlder	= SUM(CASE WHEN I.[Disposition] = 'older' THEN 1 ELSE 0 END)
				,@Held			= SUM(CASE WHEN I.[Disposition] = 'held' THEN 1 ELSE 0 END)
		FROM	@Incoming I

		;SELECT	[Json] = (	SELECT	 [added]		= COALESCE(@Added, 0)
									,[changed]		= COALESCE(@Changed, 0)
									,[unchanged]	= COALESCE(@Unchanged, 0)
									,[skippedOlder]	= COALESCE(@SkippedOlder, 0)
									,[removed]		= @Removed
									,[held]			= COALESCE(@Held, 0)
									,[twins]		= JSON_QUERY(COALESCE((	SELECT	 [name]		= T.[Name]
																					,[winner]	= W.[Name]
																					,[loser]	= L.[Name]
																			FROM	@Twins T
																					LEFT JOIN mem.Sandbox W
																						ON W.[SandboxId] = T.[WinnerSandboxId]
																					LEFT JOIN mem.Sandbox L
																						ON L.[SandboxId] = T.[LoserSandboxId]
																			ORDER BY T.[Ordinal]
																			FOR JSON PATH	), N'[]'))
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
