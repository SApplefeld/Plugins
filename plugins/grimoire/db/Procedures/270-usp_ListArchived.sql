-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_ListArchived', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_ListArchived AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_ListArchived
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_ProjectKey		NVARCHAR(400)	= NULL
	,@p_Days			INT				= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_ListArchived
		AUTHOR:		Scott Applefeld
		DATE:		October 12th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/12/2026 - SCOTT APPLEFELD
							Schema version 11. The archived records memq recent lists
							beside the index: every archived, undeleted record of one
							project's fleet store, the one @p_ProjectKey names, and of the
							type and operator tiers, whose [UpdatedDt] is inside the last
							@p_Days days. The rows come from mem.udf_VisibleRecords for the
							sandbox mem.CallerSandbox() resolves, so an unmapped login is
							answered with no rows. A NULL @p_ProjectKey lists the two shared
							tiers alone.

							[UpdatedDt] stands for the archive instant, since
							mem.usp_ArchiveRecord writes it and the schema holds no archive
							time of its own. A description-only update to a row that stays
							archived moves the same column, so the row lists again. A record
							archived and since written live carries no archived flag and is
							not listed.

							@p_Days is held between 1 and 90: a NULL or a value below 1
							reads one day, and a value above 90 reads 90. The client names
							the cut on its own line, so the 90 here and the client's
							ARCHIVED_DAYS_MAX are one number.

							The call writes no row anywhere.

							Returns one row per record, each one column [Json] holding
							{name, tier, typeName, updated}, ordered by tier, type name and
							name.
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
			,@MaxDays			INT				= 90
			,@SandboxId			INT				= NULL
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')
			,@Days				INT				= NULL
			,@From				DATETIMEOFFSET	= NULL

	/********************************************************************************************
		RESOLVE THE CALLER, BOUND THE WINDOW AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller Once; an Unmapped Login Reads Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/* Hold the Window Between One Day and @MaxDays. */
		;SET @Days = CASE
						WHEN @p_Days IS NULL OR @p_Days < 1 THEN 1
						WHEN @p_Days > @MaxDays THEN @MaxDays
						ELSE @p_Days
					 END
		;SET @From = DATEADD(DAY, -@Days, SYSDATETIMEOFFSET())

		/****************************************************************************************
			DATASET 1: ONE ROW PER ARCHIVED RECORD INSIDE THE WINDOW.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [name]		= V.[Name]
									,[tier]		= V.[Tier]
									,[typeName]	= CASE WHEN V.[Tier] = 'type' THEN V.[Segment] END
									,[updated]	= V.[UpdatedDt]
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
		FROM	mem.udf_VisibleRecords(@SandboxId) V
		WHERE	V.[IsArchived] = @True
				AND V.[UpdatedDt] >= @From
				AND (	(	V.[Tier] = 'project'
							AND V.[ProjectKey] = @ProjectKey	)
						OR V.[Tier] IN ('type', 'operator')	)
		ORDER BY V.[Tier], CASE WHEN V.[Tier] = 'type' THEN V.[Segment] END, V.[Name]
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
