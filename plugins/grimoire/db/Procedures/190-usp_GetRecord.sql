-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_GetRecord', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_GetRecord AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_GetRecord
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Tier			VARCHAR(20)		= NULL
	,@p_ProjectKey		NVARCHAR(400)	= NULL
	,@p_TypeName		NVARCHAR(400)	= NULL
	,@p_Name			NVARCHAR(200)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_GetRecord
		AUTHOR:		Scott Applefeld
		DATE:		October 3rd, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/03/2026 - SCOTT APPLEFELD
							One record with its body, named by its tier, its store's key and
							its name: a project record by @p_ProjectKey, a type record by
							@p_TypeName, an operator record by neither. The row comes from
							mem.udf_VisibleRecords for the sandbox mem.CallerSandbox()
							resolves, so an unmapped login is answered with no row, and so is
							a name the store holds no undeleted row of. A name resolves to
							the newest undeleted row of it in the store, archived or not, as
							it does in every procedure that resolves a record by name, and
							that row is answered with its archived flag, so an archived
							record is still read by name. The machine an operator record is
							scoped to is read from mem.Record for the row the visible set
							chose, since the visible set carries no machine.

							Returns no row, or one row, one column [Json], holding {recordId,
							tier, projectKey, typeName, name, description, body, tags,
							triggers, anchors, space, machine, pinned, supersedes, author,
							created, origin, archived, visibility, writtenBy, updated}, the
							three arrays as JSON and writtenBy the writing sandbox's name.
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
	;DECLARE @SandboxId			INT				= NULL
			,@RecordId			BIGINT			= NULL
			,@Tier				VARCHAR(20)		= LOWER(LTRIM(RTRIM(@p_Tier)))
			,@Name				NVARCHAR(200)	= NULLIF(LTRIM(RTRIM(@p_Name)), '')
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')
			,@TypeName			NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_TypeName)), '')

	/********************************************************************************************
		RESOLVE THE CALLER AND THE ROW, AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( @Name IS NULL OR @Tier IS NULL OR @Tier NOT IN ('project', 'type', 'operator') )
			THROW 50000, 'mem.usp_GetRecord: @p_Name and a @p_Tier of project, type or operator are required.', 1

		/* Resolve the Caller Once; an Unmapped Login Finds Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/* The Newest Undeleted Row of That Name in the Named Store, Archived or Not. */
		;SELECT	TOP ( 1 )
				@RecordId = V.[RecordId]
		FROM	mem.udf_VisibleRecords(@SandboxId) V
		WHERE	V.[Tier] = @Tier
				AND V.[StoreSandboxId] IS NULL
				AND EXISTS (	SELECT V.[ProjectKey], CASE WHEN V.[Tier] = 'type' THEN V.[Segment] END
								INTERSECT
								SELECT @ProjectKey, @TypeName	)
				AND V.[Name] = @Name
		ORDER BY V.[RecordId] DESC

		/****************************************************************************************
			DATASET 1: THE RECORD.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [recordId]		= V.[RecordId]
									,[tier]			= V.[Tier]
									,[projectKey]	= V.[ProjectKey]
									,[typeName]		= CASE WHEN V.[Tier] = 'type' THEN V.[Segment] END
									,[name]			= V.[Name]
									,[description]	= V.[Description]
									,[body]			= V.[Body]
									,[tags]			= JSON_QUERY(V.[Tags])
									,[triggers]		= JSON_QUERY(V.[Triggers])
									,[anchors]		= JSON_QUERY(V.[Anchors])
									,[space]		= V.[Space]
									,[machine]		= R.[Machine]
									,[pinned]		= V.[IsPinned]
									,[supersedes]	= V.[SupersedesName]
									,[author]		= V.[Author]
									,[created]		= V.[CreatedOn]
									,[origin]		= V.[Origin]
									,[archived]		= V.[IsArchived]
									,[visibility]	= V.[Visibility]
									,[writtenBy]	= WS.[Name]
									,[updated]		= V.[UpdatedDt]
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
		FROM	mem.udf_VisibleRecords(@SandboxId) V
				INNER JOIN mem.Record R
					ON R.[RecordId] = V.[RecordId]
				LEFT JOIN mem.Sandbox WS
					ON WS.[SandboxId] = V.[WrittenBySandboxId]
		WHERE	V.[RecordId] = @RecordId
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
