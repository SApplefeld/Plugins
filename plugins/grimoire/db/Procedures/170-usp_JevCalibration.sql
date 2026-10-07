-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_JevCalibration', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_JevCalibration AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_JevCalibration
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_SinceDays		INT				= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_JevCalibration
		AUTHOR:		Scott Applefeld
		DATE:		September 23rd, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.1 - 10/04/2026 - SCOTT APPLEFELD
							The call writes no log row, so it neither resolves the caller's
							sandbox nor digests its window. It counts and returns, and the
							database keeps no record of who read the counts.

					v1.0 - 09/23/2026 - SCOTT APPLEFELD
							The judged fleet pointer's hit rate by score band, across every
							sandbox. Counts the kit.jev.pointer outcome rows whose pointer
							was shown, in ten bands of width 0.1 over the judge's score, a
							score landing in the band whose lower edge it is at or above,
							with how many of each band's rows were read (Result 'pass').
							@p_SinceDays, when given, keeps the rows logged inside that many
							days. Unlike every other read procedure it filters on no
							sandbox: it returns counts and no field of any record.

							Returns one row, one column [Json], a JSON array of {band, rows,
							reads}, band 0 to 9, every band present.
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
	;DECLARE @True				BIT				= 1
			,@False				BIT				= 0
			,@PointerKey		NVARCHAR(200)	= N'kit.jev.pointer'
			,@Since				DATETIMEOFFSET	= NULL

	/* The Ten Bands, Each Returned Whether or Not It Holds a Row. */
	;DECLARE @Bands TABLE (
		 [Band]				INT				NOT NULL	PRIMARY KEY
	)

	/* The Counts per Band. */
	;DECLARE @Counts TABLE (
		 [Band]				INT				NOT NULL	PRIMARY KEY
		,[Rows]				INT				NOT NULL
		,[Reads]			INT				NOT NULL
	)

	/********************************************************************************************
		COUNT AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( @p_SinceDays IS NOT NULL AND @p_SinceDays <= 0 )
			THROW 50000, 'mem.usp_JevCalibration: @p_SinceDays must be greater than zero.', 1

		;IF ( @p_SinceDays IS NOT NULL )
			SET @Since = DATEADD(DAY, -@p_SinceDays, SYSDATETIMEOFFSET())

		;INSERT INTO @Bands (
			 [Band]	)
		SELECT	 [Band]	= V.[Band]
		FROM	( VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9) ) V ( [Band] )

		/* Band Every Shown Pointer Row With a Score From 0 to 1. */
		;WITH cteShown AS (
			SELECT	 [Band]		= CASE	WHEN O.[Score] >= 1 THEN 9
										ELSE CAST(FLOOR(O.[Score] * 10) AS INT)
								  END
					,[IsRead]	= CASE	WHEN O.[Result] = N'pass' THEN 1
										ELSE 0
								  END
			FROM	mem.Outcome O
			WHERE	O.[ActionKey] = @PointerKey
					AND O.[Shown] = @True
					AND O.[Score] >= 0
					AND O.[Score] <= 1
					AND (	@Since IS NULL
							OR O.[LoggedDt] >= @Since	)
		)
		INSERT INTO @Counts (
			 [Band]
			,[Rows]
			,[Reads]	)
		SELECT	 [Band]		= B.[Band]
				,[Rows]		= COUNT(S.[Band])
				,[Reads]	= COALESCE(SUM(S.[IsRead]), 0)
		FROM	@Bands B
				LEFT JOIN cteShown S
					ON S.[Band] = B.[Band]
		GROUP BY B.[Band]

		/****************************************************************************************
			DATASET 1: THE COUNTS PER BAND.
		****************************************************************************************/
		;SELECT	[Json] = COALESCE((
			SELECT	 [band]		= C.[Band]
					,[rows]		= C.[Rows]
					,[reads]	= C.[Reads]
			FROM	@Counts C
			ORDER BY C.[Band]
			FOR JSON PATH ), N'[]')
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
