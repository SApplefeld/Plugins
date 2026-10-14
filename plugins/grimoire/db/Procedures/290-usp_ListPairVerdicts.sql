-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_ListPairVerdicts', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_ListPairVerdicts AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_ListPairVerdicts
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_ProjectKey		NVARCHAR(400)	= NULL
	,@p_TypeName		NVARCHAR(400)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_ListPairVerdicts
		AUTHOR:		Scott Applefeld
		DATE:		October 12th, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/12/2026 - SCOTT APPLEFELD
							Schema version 12. The two-facts verdicts memq decay-scan
							withholds judged pairs by: every standing verdict of the
							project's fleet store @p_ProjectKey names, of the type
							store @p_TypeName names where it is given, and of the
							operator store.

							A verdict stands while each of its two names resolves to
							the newest undeleted row of it in the verdict's store, that
							row is unarchived, and its [UpdatedDt] is not later than
							the verdict's [JudgedDt]. A rewrite, an archive or a delete
							of either record therefore lapses the verdict, and so does
							a fresh row of a deleted name, since it is written after
							the verdict. The rows come from mem.udf_VisibleRecords for
							the sandbox mem.CallerSandbox() resolves, so an unmapped
							login is answered with an empty array.

							The call writes no row anywhere.

							Returns one row, one column [Json], a JSON array of {tier,
							segment, nameA, nameB}, [segment] being the store's own
							[Segment]: the type name for a type store and null for the
							project and operator stores. Ordered by tier, segment and
							the two names.
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
			,@SandboxId			INT				= NULL
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')
			,@TypeName			NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_TypeName)), '')

	/********************************************************************************************
		RESOLVE THE CALLER AND RETURN THE STANDING VERDICTS.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller Once; an Unmapped Login Reads Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/****************************************************************************************
			DATASET 1: THE STANDING VERDICTS
		****************************************************************************************/
		;SELECT	[Json] = COALESCE((
			SELECT	 [tier]		= S.[Tier]
					,[segment]	= S.[Segment]
					,[nameA]	= PV.[NameA]
					,[nameB]	= PV.[NameB]
			FROM	mem.PairVerdict PV
					INNER JOIN mem.Store S
						ON S.[StoreId] = PV.[StoreId]
					CROSS APPLY (	SELECT	TOP ( 1 )
											 [IsArchived]	= V.[IsArchived]
											,[UpdatedDt]	= V.[UpdatedDt]
									FROM	mem.udf_VisibleRecords(@SandboxId) V
									WHERE	V.[StoreId] = PV.[StoreId]
											AND V.[Name] = PV.[NameA]
									ORDER BY V.[RecordId] DESC	) A
					CROSS APPLY (	SELECT	TOP ( 1 )
											 [IsArchived]	= V.[IsArchived]
											,[UpdatedDt]	= V.[UpdatedDt]
									FROM	mem.udf_VisibleRecords(@SandboxId) V
									WHERE	V.[StoreId] = PV.[StoreId]
											AND V.[Name] = PV.[NameB]
									ORDER BY V.[RecordId] DESC	) B
			WHERE	S.[SandboxId] IS NULL
					AND (	(	S.[Tier] = 'project'
								AND S.[ProjectKey] = @ProjectKey	)
							OR (	S.[Tier] = 'type'
									AND S.[Segment] = @TypeName	)
							OR S.[Tier] = 'operator'	)
					AND A.[IsArchived] = @False
					AND B.[IsArchived] = @False
					AND A.[UpdatedDt] <= PV.[JudgedDt]
					AND B.[UpdatedDt] <= PV.[JudgedDt]
			ORDER BY S.[Tier], S.[Segment], PV.[NameA], PV.[NameB]
			FOR JSON PATH, INCLUDE_NULL_VALUES	), N'[]')
	END TRY
	BEGIN CATCH
		/* Re-Raise so the Caller Never Reads an Empty List From a Failed Read. */
		;THROW
	END CATCH
END
GO
