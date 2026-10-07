-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_CurationSupersededLive', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_CurationSupersededLive AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_CurationSupersededLive
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_CurationSupersededLive
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The curator's contradiction list: every live, unarchived record
							that another live record in the same store names as superseded.
							Each row carries the successor so the curator can archive the
							older one or clear the claim. Curation reads across sandboxes by
							design; the procedure is granted to mem_curator alone.

							Returns one row, one column [Json], a JSON array of {recordId,
							sandbox, tier, segment, name, fileKey, supersededBy: {recordId,
							name, fileKey}}.
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

	/********************************************************************************************
		BUILD THE LIST.
	********************************************************************************************/
	;BEGIN TRY
		/****************************************************************************************
			DATASET 1: THE SUPERSEDED RECORDS STILL LIVE.
		****************************************************************************************/
		;SELECT	[Json] = COALESCE((
			SELECT	 [recordId]				= R.[RecordId]
					,[sandbox]				= COALESCE(SS.[Name], PS.[Name])
					,[tier]					= S.[Tier]
					,[segment]				= S.[Segment]
					,[name]					= R.[Name]
					,[fileKey]				= R.[FileKey]
					,[supersededBy.recordId]	= N.[RecordId]
					,[supersededBy.name]		= N.[Name]
					,[supersededBy.fileKey]		= N.[FileKey]
			FROM	mem.Record R
					INNER JOIN mem.Store S
						ON S.[StoreId] = R.[StoreId]
					INNER JOIN mem.Record N
						ON	N.[StoreId] = R.[StoreId]
						AND N.[SupersedesName] = R.[Name]
						AND N.[RecordId] <> R.[RecordId]
						AND N.[DeletedDt] IS NULL
					LEFT JOIN mem.Sandbox SS
						ON SS.[SandboxId] = S.[SandboxId]
					LEFT JOIN mem.Sandbox PS
						ON PS.[SandboxId] = R.[LastPublishedBySandboxId]
			WHERE	R.[DeletedDt] IS NULL
					AND R.[IsArchived] = @False
			ORDER BY R.[RecordId], N.[RecordId]
			FOR JSON PATH, INCLUDE_NULL_VALUES ), N'[]')
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
