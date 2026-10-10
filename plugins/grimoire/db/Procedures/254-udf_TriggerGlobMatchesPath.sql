-- DROP AND RE-CREATE THE FUNCTION.
;IF OBJECT_ID('mem.udf_TriggerGlobMatchesPath') IS NOT NULL
  EXEC ('DROP FUNCTION mem.udf_TriggerGlobMatchesPath;')
GO

;CREATE FUNCTION mem.udf_TriggerGlobMatchesPath
(
	 @p_Pattern		NVARCHAR(1024)
	,@p_Path		NVARCHAR(1024)
)
RETURNS BIT
AS
BEGIN

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.udf_TriggerGlobMatchesPath
		AUTHOR:		Scott Applefeld
		DATE:		October 6th, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.0 - 10/06/2026 - SCOTT APPLEFELD
							Whether a glob trigger's pattern matches a path, the rule
							globMatchesPath applies in hooks/memory-recognition-nudge.js,
							ported so mem.usp_Recall's trigger pass and the recognition
							hook give one verdict on one pair.

							Both values are folded first, as the hook's foldPath folds
							them: cut to 1024 UTF-16 code units, each backslash read as a
							slash, and lowercased. Each is split on the slash with its empty
							segments dropped, and a pattern or a path with no segment, or
							with more than 64, matches nothing. Within one segment '*'
							stands for any run of characters and '?' for exactly one, the
							hook's matchWithin, and a pattern segment of exactly '**'
							stands for any run of segments, its matchSegments.

							The pattern must match the path through to its end from some
							segment boundary, so a repository-relative pattern fires on
							the absolute path a session names. The hook tries each
							boundary in turn; here one leading '**' does the same, since
							a leading run of any segments is exactly a choice of the
							boundary to start from.

							A segment is matched by LIKE under Latin1_General_BIN2, the
							glob rewritten with LIKE's own wildcards and every other
							character escaped, and a slash appended to both sides, a
							character no segment holds, so a trailing space LIKE would
							otherwise ignore still has to match.

					v1.1 - 10/10/2026 - SCOTT APPLEFELD
							The rule cited above now lives in
							plugins/personas/hooks/recognition.ts, the persona module's port
							of the retired recognition hook.
	*********************************************************************************************
	********************************************************************************************/

	/********************************************************************************************
		DECLARE VARIABLES FOR PROCESSING.
	********************************************************************************************/
	;DECLARE @True				BIT				= 1
			,@False				BIT				= 0
			,@MaxPathLength		INT				= 1024
			,@MaxSegments		INT				= 64
			,@Pattern			NVARCHAR(1024)	= NULL
			,@Path				NVARCHAR(1024)	= NULL
			,@PatternCount		INT				= 0
			,@PathCount			INT				= 0
			,@P					INT				= 0
			,@S					INT				= 1
			,@Star				INT				= -1
			,@Mark				INT				= 0
			,@PatternLike		NVARCHAR(4000)	= NULL
			,@PatternIsGlobstar	BIT				= NULL
			,@PathSegment		NVARCHAR(1024)	= NULL

	/* Pattern Segments, Ordinal 0 the Leading Globstar, Each With the LIKE Form of Its Glob. */
	;DECLARE @PatternSegments TABLE (
		 [Ordinal]		INT				NOT NULL	PRIMARY KEY
		,[LikePattern]	NVARCHAR(4000)	NOT NULL
		,[IsGlobstar]	BIT				NOT NULL
	)

	;DECLARE @PathSegments TABLE (
		 [Ordinal]		INT				NOT NULL	PRIMARY KEY
		,[Segment]		NVARCHAR(1024)	NOT NULL
	)

	/********************************************************************************************
		FOLD AND SPLIT BOTH VALUES.
	********************************************************************************************/
	;SET @Pattern = LOWER(REPLACE(LEFT(@p_Pattern COLLATE Latin1_General_BIN2, @MaxPathLength), N'\', N'/'))
	;SET @Path = LOWER(REPLACE(LEFT(@p_Path COLLATE Latin1_General_BIN2, @MaxPathLength), N'\', N'/'))

	;INSERT INTO @PatternSegments ( [Ordinal], [LikePattern], [IsGlobstar] )
	SELECT	 [Ordinal]		= ROW_NUMBER() OVER ( ORDER BY S.[ordinal] )
			,[LikePattern]	= REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(S.[value] COLLATE Latin1_General_BIN2
									, N'!', N'!!'), N'[', N'!['), N'%', N'!%'), N'_', N'!_'), N'*', N'%'), N'?', N'_')
			,[IsGlobstar]	= CASE	WHEN DATALENGTH(S.[value]) = 4 AND S.[value] COLLATE Latin1_General_BIN2 = N'**'
									THEN @True
									ELSE @False
							  END
	FROM	STRING_SPLIT(@Pattern, N'/', 1) S
	WHERE	DATALENGTH(S.[value]) > 0

	;INSERT INTO @PathSegments ( [Ordinal], [Segment] )
	SELECT	 [Ordinal]	= ROW_NUMBER() OVER ( ORDER BY S.[ordinal] )
			,[Segment]	= S.[value]
	FROM	STRING_SPLIT(@Path, N'/', 1) S
	WHERE	DATALENGTH(S.[value]) > 0

	;SELECT	@PatternCount = COUNT(*) FROM @PatternSegments
	;SELECT	@PathCount = COUNT(*) FROM @PathSegments

	;IF ( @PatternCount = 0 OR @PathCount = 0 OR @PatternCount > @MaxSegments OR @PathCount > @MaxSegments )
		RETURN @False

	;INSERT INTO @PatternSegments ( [Ordinal], [LikePattern], [IsGlobstar] )
	SELECT	 [Ordinal]		= 0
			,[LikePattern]	= N'**'
			,[IsGlobstar]	= @True

	/********************************************************************************************
		WALK THE SEGMENTS, BACKTRACKING TO THE LAST GLOBSTAR ON A MISS.
	********************************************************************************************/
	;WHILE ( @S <= @PathCount )
	BEGIN
		;SELECT	 @PatternLike		= NULL
				,@PatternIsGlobstar	= NULL
		;SELECT	 @PatternLike		= PS.[LikePattern]
				,@PatternIsGlobstar	= PS.[IsGlobstar]
		FROM	@PatternSegments PS
		WHERE	PS.[Ordinal] = @P
		;SELECT	@PathSegment = PH.[Segment]
		FROM	@PathSegments PH
		WHERE	PH.[Ordinal] = @S

		;IF ( @P <= @PatternCount AND @PatternIsGlobstar = @True )
		BEGIN
			;SET @Star = @P
			;SET @P = @P + 1
			;SET @Mark = @S
			CONTINUE
		END

		;IF ( @P <= @PatternCount
				AND CONCAT(@PathSegment COLLATE Latin1_General_BIN2, N'/') LIKE CONCAT(@PatternLike COLLATE Latin1_General_BIN2, N'/') ESCAPE N'!' )
		BEGIN
			;SET @P = @P + 1
			;SET @S = @S + 1
			CONTINUE
		END

		;IF ( @Star >= 0 )
		BEGIN
			;SET @P = @Star + 1
			;SET @Mark = @Mark + 1
			;SET @S = @Mark
			CONTINUE
		END

		RETURN @False
	END

	/* Trailing Globstars Match the Empty Run Left Over. */
	;WHILE ( @P <= @PatternCount
			AND EXISTS (	SELECT	NULL
							FROM	@PatternSegments PS
							WHERE	PS.[Ordinal] = @P
									AND PS.[IsGlobstar] = @True	) )
		SET @P = @P + 1

	RETURN CASE WHEN @P > @PatternCount THEN @True ELSE @False END
END
GO
