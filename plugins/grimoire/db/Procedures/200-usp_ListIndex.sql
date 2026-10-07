-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_ListIndex', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_ListIndex AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_ListIndex
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_ProjectKey		NVARCHAR(400)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_ListIndex
		AUTHOR:		Scott Applefeld
		DATE:		October 3rd, 2026
		VERSION:	v1.3
	*********************************************************************************************
		NOTES:		v1.3 - 10/04/2026
							lastRead, lastApplied and appliedDays are the record's
							[LastReadDt], [LastAppliedDt] and [AppliedDays] in
							mem.RecordUsage, and NULL, NULL and 0 for a record with no row
							there.

					v1.2 - 10/04/2026 - SCOTT APPLEFELD
							Each row carries createdAt, the instant its row was created, which
							mem.usp_PutRecord writes from the same instant as the row's update
							time on an insert, so a client can tell a record a verb wrote and
							has not changed since from one changed after it.

							v1.1 - 10/04/2026 - SCOTT APPLEFELD
							Each row carries updated, the record's file modification time where
							the publish recorded one and its row's update time otherwise, so a
							client reading the index alone can place a record in a time window
							and run an idle clock over it, and author, the session or person a
							verb wrote the record under, so a search hit can name it.

							v1.0 - 10/03/2026 - SCOTT APPLEFELD
							The index a session reads its memory from: every live record of
							one project's fleet store, the one @p_ProjectKey names, and of the
							type and operator tiers, never another project's. A live record
							is one carrying neither a deleted mark nor the archived flag. The
							rows come from mem.udf_VisibleRecords for the sandbox
							mem.CallerSandbox() resolves, so an unmapped login is answered
							with no rows. A NULL @p_ProjectKey lists the two shared tiers
							alone. Each row carries the record's three usage values from
							mem.RecordUsage, which every sandbox's stamps fold into: the last
							read stamp, the last applied stamp, and the count of distinct days
							it was stamped applied. The machine an operator record is scoped to is read from
							mem.Record for each row the visible set chose, since the visible
							set carries no machine.

							Returns one row per record, each one column [Json] holding
							{recordId, tier, projectKey, typeName, name, description, tags,
							triggers, anchors, pinned, space, machine, supersedes, created,
							createdAt, author, origin, updated, lastRead, lastApplied,
							appliedDays}, ordered by tier, type name and name.
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
	;DECLARE @False				BIT				= 0
			,@SandboxId			INT				= NULL
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')

	/* The Index, Created Unconditionally so an Outer Scope Cannot Plant One. */
	;CREATE TABLE #Listed (
		 [RecordId]			BIGINT			NOT NULL	PRIMARY KEY
		,[Tier]				VARCHAR(20)		NOT NULL
		,[ProjectKey]		NVARCHAR(400)	NULL
		,[TypeName]			NVARCHAR(400)	NULL
		,[Name]				NVARCHAR(200)	NOT NULL
		,[Description]		NVARCHAR(MAX)	NOT NULL
		,[Tags]				NVARCHAR(MAX)	NULL
		,[Triggers]			NVARCHAR(MAX)	NULL
		,[Anchors]			NVARCHAR(MAX)	NULL
		,[IsPinned]			BIT				NOT NULL
		,[Space]			NVARCHAR(100)	NULL
		,[Machine]			NVARCHAR(100)	NULL
		,[SupersedesName]	NVARCHAR(200)	NULL
		,[Author]			NVARCHAR(200)	NULL
		,[CreatedOn]		DATE			NULL
		,[Origin]			VARCHAR(10)		NOT NULL
		,[Updated]			DATETIMEOFFSET	NULL
		,[CreatedAt]		DATETIMEOFFSET	NOT NULL
	)

	/********************************************************************************************
		RESOLVE THE CALLER, COLLECT THE INDEX AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller Once; an Unmapped Login Fills Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/* Collect the Project's Live Records and the Shared Tiers' Live Records. */
		;INSERT INTO #Listed (
			 [RecordId]
			,[Tier]
			,[ProjectKey]
			,[TypeName]
			,[Name]
			,[Description]
			,[Tags]
			,[Triggers]
			,[Anchors]
			,[IsPinned]
			,[Space]
			,[Machine]
			,[SupersedesName]
			,[Author]
			,[CreatedOn]
			,[Origin]
			,[Updated]
			,[CreatedAt]		)
		SELECT	 [RecordId]			= V.[RecordId]
				,[Tier]				= V.[Tier]
				,[ProjectKey]		= V.[ProjectKey]
				,[TypeName]			= CASE WHEN V.[Tier] = 'type' THEN V.[Segment] END
				,[Name]				= V.[Name]
				,[Description]		= V.[Description]
				,[Tags]				= V.[Tags]
				,[Triggers]			= V.[Triggers]
				,[Anchors]			= V.[Anchors]
				,[IsPinned]			= V.[IsPinned]
				,[Space]			= V.[Space]
				,[Machine]			= R.[Machine]
				,[SupersedesName]	= V.[SupersedesName]
				,[Author]			= V.[Author]
				,[CreatedOn]		= V.[CreatedOn]
				,[Origin]			= V.[Origin]
				,[Updated]			= COALESCE(R.[FileModifiedDt], R.[UpdatedDt])
				,[CreatedAt]		= R.[CreatedDt]
		FROM	mem.udf_VisibleRecords(@SandboxId) V
				INNER JOIN mem.Record R
					ON R.[RecordId] = V.[RecordId]
		WHERE	V.[IsArchived] = @False
				AND (	(	V.[Tier] = 'project'
							AND V.[ProjectKey] = @ProjectKey	)
						OR V.[Tier] IN ('type', 'operator')	)

		/****************************************************************************************
			DATASET 1: ONE ROW PER RECORD, WITH ITS USAGE VALUES.
		****************************************************************************************/
		/* One Row per Record Rather Than One Array; sqlcmd Cuts a Single Value at 8000 Characters. */
		;WITH cteUsage AS (
			SELECT	 [RecordId]		= RU.[RecordId]
					,[LastRead]		= RU.[LastReadDt]
					,[LastApplied]	= RU.[LastAppliedDt]
					,[AppliedDays]	= RU.[AppliedDays]
			FROM	mem.RecordUsage RU
					INNER JOIN #Listed L
						ON L.[RecordId] = RU.[RecordId]
		)
		SELECT	[Json] = (	SELECT	 [recordId]		= L.[RecordId]
									,[tier]			= L.[Tier]
									,[projectKey]	= L.[ProjectKey]
									,[typeName]		= L.[TypeName]
									,[name]			= L.[Name]
									,[description]	= L.[Description]
									,[tags]			= JSON_QUERY(L.[Tags])
									,[triggers]		= JSON_QUERY(L.[Triggers])
									,[anchors]		= JSON_QUERY(L.[Anchors])
									,[pinned]		= L.[IsPinned]
									,[space]		= L.[Space]
									,[machine]		= L.[Machine]
									,[supersedes]	= L.[SupersedesName]
									,[author]		= L.[Author]
									,[created]		= L.[CreatedOn]
									,[createdAt]	= L.[CreatedAt]
									,[origin]		= L.[Origin]
									,[updated]		= L.[Updated]
									,[lastRead]		= U.[LastRead]
									,[lastApplied]	= U.[LastApplied]
									,[appliedDays]	= COALESCE(U.[AppliedDays], 0)
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
		FROM	#Listed L
				LEFT JOIN cteUsage U
					ON U.[RecordId] = L.[RecordId]
		ORDER BY L.[Tier], L.[TypeName], L.[Name]
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
