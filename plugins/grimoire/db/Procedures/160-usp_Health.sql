-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_Health', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_Health AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_Health
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_ModelIdentity	VARCHAR(200)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_Health
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.2
	*********************************************************************************************
		NOTES:		v1.2 - 10/03/2026 - SCOTT APPLEFELD
							The report adds fleetRecords and fleetEmbeddings: the undeleted
							records of every project's fleet store, which belongs to no
							sandbox and so is counted in no sandbox's line, and their
							embeddings, for the model @p_ModelIdentity names when given.
							sharedRecords and sharedEmbeddings leave those rows out, so they
							count the operator and type tiers and any older sandbox-store
							row still marked shared, and the two pairs are disjoint.

							Returns one row, one column [Json], a JSON object
							{schemaVersion, sharedRecords, sharedEmbeddings, fleetRecords,
							fleetEmbeddings, sandboxes: [{sandbox, records, embeddings,
							lastPublish, oldestUnembedded}]}.

					v1.1 - 09/21/2026 - SCOTT APPLEFELD
							lastPublish is the start of the sandbox's last publish run that
							carried no error text, so a run that reached the host and ended
							on a refusal no longer reads as a publish. A sandbox with failed
							runs only reads null.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The doctor's view of the shared index. The fleet-wide counts are
							the same for every caller; the per-sandbox block is scoped by who
							asks. A curator, database owner or server administrator sees every
							sandbox, a publisher sees its own, and a login mapped to no
							sandbox sees an empty list. oldestUnembedded is the earliest
							publish time among a sandbox's live records that carry no
							embedding, for the model @p_ModelIdentity names when given and
							for any model otherwise.

							Returns one row, one column [Json], a JSON object
							{schemaVersion, sharedRecords, sharedEmbeddings, sandboxes:
							[{sandbox, records, embeddings, lastPublish, oldestUnembedded}]}.
	*********************************************************************************************
	********************************************************************************************/

	/********************************************************************************************
		SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS.
	********************************************************************************************/
	;SET NOCOUNT ON
	;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED

	/********************************************************************************************
		DECLARE VARIABLES FOR PROCESSING.
	********************************************************************************************/
	;DECLARE @True				BIT				= 1
			,@False				BIT				= 0
			,@IsCurator			BIT				= 0
			,@SandboxId			INT				= NULL
			,@SchemaVersion		INT				= NULL
			,@SharedRecords		INT				= 0
			,@SharedEmbeddings	INT				= 0
			,@FleetRecords		INT				= 0
			,@FleetEmbeddings	INT				= 0
			,@Sandboxes			NVARCHAR(MAX)	= NULL

	/********************************************************************************************
		RESOLVE THE CALLER'S REACH, COUNT, AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		;IF (	COALESCE(IS_ROLEMEMBER('mem_curator'), 0) = 1
				OR COALESCE(IS_MEMBER('db_owner'), 0) = 1
				OR COALESCE(IS_SRVROLEMEMBER('sysadmin'), 0) = 1	)
			SET @IsCurator = @True

		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;SELECT	@SchemaVersion = MAX(V.[Version])
		FROM	mem.SchemaVersion V

		/* The Fleet-Wide Counts. */
		/* Shared Rows Outside the Fleet Project Stores, Which the Fleet Counts Below Carry. */
		;SELECT	@SharedRecords = COUNT(*)
		FROM	mem.Record R
				INNER JOIN mem.Store S
					ON S.[StoreId] = R.[StoreId]
		WHERE	R.[DeletedDt] IS NULL
				AND R.[Visibility] = 'shared'
				AND NOT (	S.[Tier] = 'project'
							AND S.[SandboxId] IS NULL	)

		;SELECT	@SharedEmbeddings = COUNT(*)
		FROM	mem.Embedding E
				INNER JOIN mem.Record R
					ON R.[RecordId] = E.[RecordId]
				INNER JOIN mem.Store S
					ON S.[StoreId] = R.[StoreId]
		WHERE	R.[DeletedDt] IS NULL
				AND R.[Visibility] = 'shared'
				AND NOT (	S.[Tier] = 'project'
							AND S.[SandboxId] IS NULL	)
				AND (	@p_ModelIdentity IS NULL
						OR E.[ModelIdentity] = @p_ModelIdentity	)

		/* The Fleet Project Stores' Counts, Which No Sandbox's Line Carries. */
		;SELECT	@FleetRecords = COUNT(*)
		FROM	mem.Record R
				INNER JOIN mem.Store S
					ON S.[StoreId] = R.[StoreId]
		WHERE	S.[Tier] = 'project'
				AND S.[SandboxId] IS NULL
				AND R.[DeletedDt] IS NULL

		;SELECT	@FleetEmbeddings = COUNT(*)
		FROM	mem.Embedding E
				INNER JOIN mem.Record R
					ON R.[RecordId] = E.[RecordId]
				INNER JOIN mem.Store S
					ON S.[StoreId] = R.[StoreId]
		WHERE	S.[Tier] = 'project'
				AND S.[SandboxId] IS NULL
				AND R.[DeletedDt] IS NULL
				AND (	@p_ModelIdentity IS NULL
						OR E.[ModelIdentity] = @p_ModelIdentity	)

		/* The Per-Sandbox Block, Scoped to the Caller's Reach. */
		;SELECT @Sandboxes = COALESCE((
			SELECT	 [sandbox]			= SB.[Name]
					,[records]			= (	SELECT	COUNT(*)
											FROM	mem.Record R
													INNER JOIN mem.Store S
														ON S.[StoreId] = R.[StoreId]
											WHERE	S.[SandboxId] = SB.[SandboxId]
													AND R.[DeletedDt] IS NULL	)
					,[embeddings]		= (	SELECT	COUNT(*)
											FROM	mem.Embedding E
													INNER JOIN mem.Record R
														ON R.[RecordId] = E.[RecordId]
													INNER JOIN mem.Store S
														ON S.[StoreId] = R.[StoreId]
											WHERE	S.[SandboxId] = SB.[SandboxId]
													AND R.[DeletedDt] IS NULL
													AND (	@p_ModelIdentity IS NULL
															OR E.[ModelIdentity] = @p_ModelIdentity	)	)
					,[lastPublish]		= (	SELECT	MAX(PR.[StartedDt])
											FROM	mem.PublishRun PR
											WHERE	PR.[SandboxId] = SB.[SandboxId]
													AND PR.[ErrorText] IS NULL	)
					,[oldestUnembedded]	= (	SELECT	MIN(R.[LastPublishedDt])
											FROM	mem.Record R
													INNER JOIN mem.Store S
														ON S.[StoreId] = R.[StoreId]
											WHERE	S.[SandboxId] = SB.[SandboxId]
													AND R.[DeletedDt] IS NULL
													AND NOT EXISTS (	SELECT	NULL
																		FROM	mem.Embedding E
																		WHERE	E.[RecordId] = R.[RecordId]
																				AND (	@p_ModelIdentity IS NULL
																						OR E.[ModelIdentity] = @p_ModelIdentity	)	)	)
			FROM	mem.Sandbox SB
			WHERE	@IsCurator = @True
					OR SB.[SandboxId] = @SandboxId
			ORDER BY SB.[Name]
			FOR JSON PATH, INCLUDE_NULL_VALUES ), N'[]')

		/****************************************************************************************
			DATASET 1: THE HEALTH REPORT.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [schemaVersion]	= @SchemaVersion
									,[sharedRecords]	= @SharedRecords
									,[sharedEmbeddings]	= @SharedEmbeddings
									,[fleetRecords]		= @FleetRecords
									,[fleetEmbeddings]	= @FleetEmbeddings
									,[sandboxes]		= JSON_QUERY(@Sandboxes)
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
