-- DROP AND RE-CREATE THE FUNCTION.
;IF OBJECT_ID('mem.udf_MergeAppliedDates') IS NOT NULL
  EXEC ('DROP FUNCTION mem.udf_MergeAppliedDates;')
GO

;CREATE FUNCTION mem.udf_MergeAppliedDates
(
	 @p_HeldDates	NVARCHAR(400)
	,@p_NewDates	NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
(
	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.udf_MergeAppliedDates
		AUTHOR:		grimoire kit
		DATE:		October 4th, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.1 - 10/05/2026
							The body sits inside RETURN ( ... ), the inline function
							layout. No behavior changes.

					v1.0 - 10/04/2026
							The one rule by which a memory's applied dates take new ones, used
							by mem.usp_AppendUsage for a batch of stamps and by
							mem.usp_UpsertRecords and mem.usp_AdoptProjectStore when a losing
							row's usage folds into the winning row's. @p_HeldDates is the
							row's [AppliedDates], a JSON array of yyyy-mm-dd strings or NULL,
							and @p_NewDates the offered dates in the same shape.

							An offered date is new where the held list does not hold it,
							unless the held list already holds sixteen dates and the offered
							one is earlier than all of them. [NewDays] is how many offered
							dates are new, which the caller adds to [AppliedDays], and
							[AppliedDates] is the newest sixteen of the held and new dates,
							oldest first, or NULL where there are none. A resent date is
							already held, or older than a full list, so it counts nothing,
							and a date one machine delivers late still counts where the list
							has room for it.

							Sixteen sits above every cap a reader applies to the count:
							mem.usp_Search's @p_AppliedDaysCap default of 10, and the thirteen
							days at which memq's decay extension reaches its ceiling. So a day
							this rule cannot count leaves the count at sixteen or more, and
							no ranking or decay decision changes.
	*********************************************************************************************
	********************************************************************************************/
	WITH cteKeep AS (
		SELECT	[Keep] = 16
	)
	,cteHeld AS (
		SELECT	DISTINCT [AppliedOn] = CONVERT(DATE, J.[value], 23)
		FROM	OPENJSON(COALESCE(@p_HeldDates, N'[]')) J
	)
	,cteHeldShape AS (
		SELECT	 [HeldCount]	= COUNT(*)
				,[Earliest]		= MIN(H.[AppliedOn])
		FROM	cteHeld H
	)
	,cteOffered AS (
		SELECT	DISTINCT [AppliedOn] = CONVERT(DATE, J.[value], 23)
		FROM	OPENJSON(COALESCE(@p_NewDates, N'[]')) J
	)
	,cteCounted AS (
		SELECT	[AppliedOn] = O.[AppliedOn]
		FROM	cteOffered O
				CROSS JOIN cteHeldShape HS
				CROSS JOIN cteKeep K
		WHERE	NOT EXISTS (	SELECT	NULL
								FROM	cteHeld H
								WHERE	H.[AppliedOn] = O.[AppliedOn]	)
				AND (	HS.[HeldCount] < K.[Keep]
						OR O.[AppliedOn] > HS.[Earliest]	)
	)
	,cteNewest AS (
		SELECT	 [AppliedOn]	= D.[AppliedOn]
				,[Place]		= ROW_NUMBER() OVER ( ORDER BY D.[AppliedOn] DESC )
		FROM	(	SELECT	H.[AppliedOn]
					FROM	cteHeld H
					UNION
					SELECT	C.[AppliedOn]
					FROM	cteCounted C	) D
	)
	SELECT	 [NewDays]		= (	SELECT	COUNT(*)
								FROM	cteCounted	)
			,[AppliedDates]	= (	SELECT	N'[' + STRING_AGG(CAST(N'"' + CONVERT(NCHAR(10), N.[AppliedOn], 23) + N'"' AS NVARCHAR(MAX)), N',')
										WITHIN GROUP ( ORDER BY N.[AppliedOn] ) + N']'
								FROM	cteNewest N
										CROSS JOIN cteKeep K
								WHERE	N.[Place] <= K.[Keep]	)
)
GO
