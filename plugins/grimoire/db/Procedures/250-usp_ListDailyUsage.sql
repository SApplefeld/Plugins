-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_ListDailyUsage', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_ListDailyUsage AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_ListDailyUsage
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_FromDate		DATE			= NULL
	,@p_ToDate			DATE			= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_ListDailyUsage
		AUTHOR:		Scott Applefeld
		DATE:		October 5th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/05/2026 - SCOTT APPLEFELD
							The fleet's token use by day: the metered turns of every
							sandbox summed by UTC day, sandbox, persona and plan path,
							over the UTC days from @p_FromDate to @p_ToDate inclusive.
							A turn's day is the UTC date of its end. @p_FromDate
							defaults to the current UTC date and @p_ToDate to
							@p_FromDate, so a call naming neither reads today.

							It filters on no sandbox, since the figure exists to pass
							cost on across the fleet, and it returns counts and the
							names they are grouped by, and no other field of any turn.
							A count the engine reported none for adds nothing to its sum.

							Returns one row, one column [Json], a JSON array of {day,
							sandbox, persona, planPath, turns, inputTokens,
							outputTokens, cacheReadTokens, cacheCreationTokens}, in
							day, sandbox, persona and plan path order.
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
	;DECLARE @FromDate			DATE			= COALESCE(@p_FromDate, CAST(SYSUTCDATETIME() AS DATE))
			,@ToDate			DATE			= NULL

	;SET @ToDate = COALESCE(@p_ToDate, @FromDate)

	/********************************************************************************************
		SUM THE RANGE'S TURNS AND RETURN THEM.
	********************************************************************************************/
	;BEGIN TRY
		/****************************************************************************************
			DATASET 1: THE SUMS
		****************************************************************************************/
		;SELECT	[Json] = COALESCE((
			SELECT	 [day]					= CONVERT(CHAR(10), D.[Day], 23)
					,[sandbox]				= SB.[Name]
					,[persona]				= D.[Persona]
					,[planPath]				= D.[PlanPath]
					,[turns]				= COUNT(*)
					,[inputTokens]			= SUM(COALESCE(D.[InputTokens], 0))
					,[outputTokens]			= SUM(COALESCE(D.[OutputTokens], 0))
					,[cacheReadTokens]		= SUM(COALESCE(D.[CacheReadTokens], 0))
					,[cacheCreationTokens]	= SUM(COALESCE(D.[CacheCreationTokens], 0))
			FROM	(	SELECT	 [Day]					= CAST(SWITCHOFFSET(T.[EndedDt], '+00:00') AS DATE)
								,[SandboxId]			= T.[SandboxId]
								,[Persona]				= T.[Persona]
								,[PlanPath]				= T.[PlanPath]
								,[InputTokens]			= T.[InputTokens]
								,[OutputTokens]			= T.[OutputTokens]
								,[CacheReadTokens]		= T.[CacheReadTokens]
								,[CacheCreationTokens]	= T.[CacheCreationTokens]
						FROM	mem.TurnMeter T
						WHERE	T.[EndedDt] >= TODATETIMEOFFSET(CAST(@FromDate AS DATETIME2), '+00:00')
								AND T.[EndedDt] < TODATETIMEOFFSET(DATEADD(DAY, 1, CAST(@ToDate AS DATETIME2)), '+00:00')	) D
					INNER JOIN mem.Sandbox SB
						ON SB.[SandboxId] = D.[SandboxId]
			GROUP BY D.[Day], SB.[Name], D.[Persona], D.[PlanPath]
			ORDER BY D.[Day], SB.[Name], D.[Persona], D.[PlanPath]
			FOR JSON PATH, INCLUDE_NULL_VALUES	), N'[]')
	END TRY
	BEGIN CATCH
		/* Re-Raise so the Caller Never Reads an Empty Day From a Failed Read. */
		;THROW
	END CATCH
END
GO
