-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_CurationOrphans', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_CurationOrphans AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_CurationOrphans
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Days			INT				= 30
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_CurationOrphans
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The curator's orphan list in two halves. indexOrphans is every
							tier index line a publisher walk reported with no record file
							behind it, still on mem.IndexOrphan. unpublishedShared is every
							live shared record no publisher has touched in @p_Days days, read
							off [LastPublishedDt], which the upsert stamps on every run that
							carries the file whether or not it changed. Curation reads across
							sandboxes by design; the procedure is granted to mem_curator
							alone.

							Returns one row, one column [Json], a JSON object {indexOrphans:
							[{storeTier, storeSegment, sandbox, indexLineName, description,
							firstSeen, lastSeen, lastSeenBy}], unpublishedShared:
							[{recordId, sandbox, tier, segment, name, fileKey,
							lastPublished, lastPublishedBy}]}.
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
	;DECLARE @Cutoff			DATETIMEOFFSET	= NULL
			,@IndexOrphans		NVARCHAR(MAX)	= NULL
			,@UnpublishedShared	NVARCHAR(MAX)	= NULL

	/********************************************************************************************
		BUILD BOTH HALVES.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( @p_Days IS NULL OR @p_Days < 0 )
			THROW 50000, 'mem.usp_CurationOrphans: @p_Days must be zero or more.', 1

		;SELECT @Cutoff = DATEADD(DAY, -@p_Days, SYSDATETIMEOFFSET())

		/* Index Lines With no File Behind Them. */
		;SELECT @IndexOrphans = COALESCE((
			SELECT	 [storeTier]		= S.[Tier]
					,[storeSegment]		= S.[Segment]
					,[sandbox]			= SS.[Name]
					,[indexLineName]	= O.[IndexLineName]
					,[description]		= O.[Description]
					,[firstSeen]		= O.[FirstSeenDt]
					,[lastSeen]			= O.[LastSeenDt]
					,[lastSeenBy]		= LS.[Name]
			FROM	mem.IndexOrphan O
					INNER JOIN mem.Store S
						ON S.[StoreId] = O.[StoreId]
					LEFT JOIN mem.Sandbox SS
						ON SS.[SandboxId] = S.[SandboxId]
					LEFT JOIN mem.Sandbox LS
						ON LS.[SandboxId] = O.[LastSeenBySandboxId]
			ORDER BY O.[LastSeenDt] DESC, O.[IndexOrphanId]
			FOR JSON PATH, INCLUDE_NULL_VALUES ), N'[]')

		/* Shared Records no Publisher Has Carried Inside the Window. */
		;SELECT @UnpublishedShared = COALESCE((
			SELECT	 [recordId]			= R.[RecordId]
					,[sandbox]			= COALESCE(SS.[Name], PS.[Name])
					,[tier]				= S.[Tier]
					,[segment]			= S.[Segment]
					,[name]				= R.[Name]
					,[fileKey]			= R.[FileKey]
					,[lastPublished]	= R.[LastPublishedDt]
					,[lastPublishedBy]	= PS.[Name]
			FROM	mem.Record R
					INNER JOIN mem.Store S
						ON S.[StoreId] = R.[StoreId]
					LEFT JOIN mem.Sandbox SS
						ON SS.[SandboxId] = S.[SandboxId]
					LEFT JOIN mem.Sandbox PS
						ON PS.[SandboxId] = R.[LastPublishedBySandboxId]
			WHERE	R.[DeletedDt] IS NULL
					AND R.[Visibility] = 'shared'
					AND R.[LastPublishedDt] < @Cutoff
			ORDER BY R.[LastPublishedDt], R.[RecordId]
			FOR JSON PATH, INCLUDE_NULL_VALUES ), N'[]')

		/****************************************************************************************
			DATASET 1: BOTH HALVES.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [indexOrphans]			= JSON_QUERY(@IndexOrphans)
									,[unpublishedShared]	= JSON_QUERY(@UnpublishedShared)
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER	)
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
