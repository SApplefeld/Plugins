-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_CurationUnapplied', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_CurationUnapplied AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_CurationUnapplied
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Days			INT				= 90
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_CurationUnapplied
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.1 - 10/04/2026
							lastApplied and lastRead are the record's [LastAppliedDt] and
							[LastReadDt] in mem.RecordUsage, the newest applied and read
							stamp it has taken, and a record with no row there is listed
							with both null.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The curator's decay list: every live, unarchived record, across
							every sandbox, with no applied stamp inside the last @p_Days days.
							A record never stamped applied is on the list with a null
							lastApplied. Curation reads across sandboxes by design; the
							procedure is granted to mem_curator alone.

							Returns one row, one column [Json], a JSON array of {recordId,
							sandbox, tier, segment, name, fileKey, visibility, lastApplied,
							lastRead, lastPublished} ordered oldest applied first.
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
	;DECLARE @False				BIT				= 0
			,@Cutoff			DATETIMEOFFSET	= NULL

	/********************************************************************************************
		BUILD THE LIST.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( @p_Days IS NULL OR @p_Days < 0 )
			THROW 50000, 'mem.usp_CurationUnapplied: @p_Days must be zero or more.', 1

		;SELECT @Cutoff = DATEADD(DAY, -@p_Days, SYSDATETIMEOFFSET())

		/****************************************************************************************
			DATASET 1: THE UNAPPLIED RECORDS.
		****************************************************************************************/
		;WITH cteStamps AS (
			SELECT	 [RecordId]		= RU.[RecordId]
					,[LastApplied]	= RU.[LastAppliedDt]
					,[LastRead]		= RU.[LastReadDt]
			FROM	mem.RecordUsage RU
		)
		SELECT	[Json] = COALESCE((
			SELECT	 [recordId]		= R.[RecordId]
					,[sandbox]		= COALESCE(SS.[Name], PS.[Name])
					,[tier]			= S.[Tier]
					,[segment]		= S.[Segment]
					,[name]			= R.[Name]
					,[fileKey]		= R.[FileKey]
					,[visibility]	= R.[Visibility]
					,[lastApplied]	= ST.[LastApplied]
					,[lastRead]		= ST.[LastRead]
					,[lastPublished]	= R.[LastPublishedDt]
			FROM	mem.Record R
					INNER JOIN mem.Store S
						ON S.[StoreId] = R.[StoreId]
					LEFT JOIN cteStamps ST
						ON ST.[RecordId] = R.[RecordId]
					LEFT JOIN mem.Sandbox SS
						ON SS.[SandboxId] = S.[SandboxId]
					LEFT JOIN mem.Sandbox PS
						ON PS.[SandboxId] = R.[LastPublishedBySandboxId]
			WHERE	R.[DeletedDt] IS NULL
					AND R.[IsArchived] = @False
					AND (	ST.[LastApplied] IS NULL
							OR ST.[LastApplied] < @Cutoff	)
			ORDER BY ST.[LastApplied], R.[RecordId]
			FOR JSON PATH, INCLUDE_NULL_VALUES ), N'[]')
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
