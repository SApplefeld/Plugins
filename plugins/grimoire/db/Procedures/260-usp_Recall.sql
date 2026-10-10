-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_Recall', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_Recall AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_Recall
(
	/*********************************************************************************************
	 PARAMETER NAME				DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_ProjectKey				NVARCHAR(400)	= NULL
	,@p_Space					NVARCHAR(100)	= NULL
	,@p_Tags					NVARCHAR(MAX)	= NULL
	,@p_Subjects				NVARCHAR(MAX)	= NULL
	,@p_QueryText				NVARCHAR(MAX)	= NULL
	,@p_QueryVector				VECTOR(1024)	= NULL
	,@p_ModelIdentity			VARCHAR(200)	= NULL
	,@p_Limit					INT				= 10
	,@p_MatchTriggers			BIT				= 1
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_Recall
		AUTHOR:		Scott Applefeld
		DATE:		October 6th, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.0 - 10/06/2026 - SCOTT APPLEFELD
							The candidate records for one prompt, by three passes fused
							by Reciprocal Rank Fusion, each returned with a head of its
							body rather than the body.

							The population is the visible set mem.usp_Search ranks, from
							mem.CallerSandbox() and mem.udf_VisibleRecords, cut by
							mem.usp_Search's project-key clause: with @p_ProjectKey named,
							the project rows of that key and every type and operator row;
							with none, every visible row. @p_Space, where named, keeps a
							row only where its [Space] equals it. @p_Tags, a JSON array of
							tags, keeps a row only where its [Tags] array holds every tag
							named, each tag being mem.usp_Search's @p_Tag test; NULL or
							an empty array names none. Every pass ranks inside that
							population, so no pass can admit a row outside it.

							Pass one is the trigger match, the rule
							hooks/memory-recognition-nudge.js applies at a prompt: it reads
							project rows alone, and runs only where @p_MatchTriggers is 1.
							A type or operator row is never matched here and still reaches
							passes two and three. The caller sends @p_MatchTriggers as 0
							under a KIT_MEMORY_PROJECT pin, which turns off the cmd: and
							glob: matches alike. A pin makes one project segment serve every
							checkout the instance works in. So a trigger authored against
							one checkout names a different file, or a different command
							context, in each of the others, and a project row's trigger is
							no longer confined to the checkout it was written for.

							@p_Subjects is a JSON array of the prompt's command words and
							paths. Its first 32 entries are read, a non-string or empty
							entry among them is dropped, and each is cut to 1024
							characters and lowercased. A record is matched
							where an entry of its [Triggers] array, among the first 32, is
							a cmd: entry whose lowercased pattern is contained in a
							subject or in @p_QueryText, cut to 4000 characters and
							lowercased, with no token boundary asked, or a glob: entry
							whose pattern matches a subject as a path,
							mem.udf_TriggerGlobMatchesPath's port of globMatchesPath in
							the hook. A subject is one word or one path, so a cmd: pattern
							holding a space matches from the query text, or from a path
							holding the same space.

							The cmd: rule is containment, read against two surfaces.
							Here it reads prompt text, project rows alone, where
							@p_QueryText is whatever text the caller sends, cut by the
							client's queryHead to its QUERY_TEXT_CAP characters. At a tool
							call the command's text is read instead, a surface this
							procedure never sees.

							memq's trigger grammar, its 4-character floor, its refusal of
							a bare common token and its 256-character cap, is enforced at
							memq's door alone. This procedure matches whatever pattern a
							row holds, up to 1024 characters.

							Pass two is full text over [Description] and [Body] as one
							list, from @p_QueryText made into a safe predicate exactly as
							mem.usp_Search builds its own. Pass three is cosine distance
							over the embeddings of live records, each ranked on its best
							chunk, kept to @p_ModelIdentity's embeddings where it is named.
							A pass runs only where its input is present, so a NULL
							@p_QueryVector runs the other two and answers.

							Passes two and three each contribute 1 / (60 + rank) for the
							50 records they rank first, mem.usp_Search's K and depth. A
							trigger-matched record is a candidate whether or not a list
							ranked it, and gains one reciprocal-rank unit, 1 / (60 + 1),
							the value a first-ranked entry of one list contributes, so it
							ranks above a record of equal fused score that matched no
							trigger. Ties are broken by [RecordId]. @p_Limit must be above
							zero and is served at most 30.

							The call writes no row anywhere: it ranks and returns.

							Returns one row per record, in rank order, one column [Json]
							holding {recordId, rank, name, tier, projectKey, typeName,
							description, tags, triggers, archived, bodyLength, bodyHead,
							score, fusedScore, triggerMatched, textRank, vectorRank}.
							[bodyLength] is the body's length in UTF-16 code units and
							[bodyHead] its first 600 of them, one fewer where the 600th is
							the first half of a surrogate pair. No row carries the whole
							body.

					v1.1 - 10/10/2026 - SCOTT APPLEFELD
							The rule cited above now lives in
							plugins/personas/hooks/recognition.ts, the persona module's port
							of the retired recognition hook.
	*********************************************************************************************
	********************************************************************************************/

	/********************************************************************************************
		SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS.
	********************************************************************************************/
	;SET NOCOUNT ON
	-- READ COMMITTED rather than the read default: a dirty scan can read one row twice
	-- across a page split, and #Visible's key would turn that into a failed call,
	-- which the client reads as the host being down. usp_Search reads the same
	-- population at this level.
	;SET TRANSACTION ISOLATION LEVEL READ COMMITTED

	/********************************************************************************************
		DECLARE VARIABLES FOR PROCESSING.
	********************************************************************************************/
	;DECLARE @True				BIT				= 1
			,@False				BIT				= 0
			,@SandboxId			INT				= NULL
			,@Limit				INT				= NULL
			,@TriggerBonus		FLOAT			= NULL

	/* Ranking Constants. */
	;DECLARE @RrfRankConstant	FLOAT			= 60
			,@CandidateDepth	INT				= 50
			,@MaxLimit			INT				= 30
			,@BodyHeadLength	INT				= 600

	/* Trigger Matching Bounds. */
	;DECLARE @MaxSubjects		INT				= 32
			,@MaxSubjectLength	INT				= 1024
			,@MaxTriggerEntries	INT				= 32
			,@FoldedQueryText	NVARCHAR(4000)	= NULL

	/* Predicate Building. */
	;DECLARE @MaxTokenCount		INT				= 32
			,@MaxTokenLength	INT				= 100
			,@MaxQueryLength	INT				= 4000
			,@NormalizedQueryText	NVARCHAR(MAX)	= NULL
			,@FullTextPredicate	NVARCHAR(4000)	= NULL

	/* Surviving Tokens, Escaped and Ordered, Feed the Predicate. */
	;DECLARE @Tokens TABLE (
		 [Ordinal]		BIGINT			NOT NULL
		,[EscapedToken]	NVARCHAR(4000)	NOT NULL
	)

	/* The Tags Named, Each a Row Must Carry. */
	;DECLARE @Tags TABLE (
		 [Tag]			NVARCHAR(4000)	NOT NULL
	)

	/* The Subjects, Folded for the Trigger Match. */
	;DECLARE @Subjects TABLE (
		 [Ordinal]		INT				NOT NULL	PRIMARY KEY
		,[Subject]		NVARCHAR(1024)	NOT NULL
	)

	/* Working Tables are Created Unconditionally, so an Outer Scope Cannot Plant One and Seed the Winners. */
	;CREATE TABLE #Visible (
		 [RecordId]					BIGINT			NOT NULL	PRIMARY KEY
		,[Tier]						VARCHAR(20)		NOT NULL
		,[ProjectKey]				NVARCHAR(400)	NULL
		,[Segment]					NVARCHAR(400)	NULL
		,[Name]						NVARCHAR(200)	NOT NULL
		,[Triggers]					NVARCHAR(MAX)	NULL
		,[IsArchived]				BIT				NOT NULL
	)

	/* Each List's RRF Contributions: 2 = Full Text, 3 = Vector Live. */
	;CREATE TABLE #Contributions (
		 [RecordId]			BIGINT			NOT NULL
		,[ListId]			TINYINT			NOT NULL
		,[ListRank]			BIGINT			NOT NULL
		,[Contribution]		FLOAT			NOT NULL
	)

	;CREATE TABLE #Triggered (
		 [RecordId]			BIGINT			NOT NULL	PRIMARY KEY
	)

	;CREATE TABLE #Winners (
		 [RecordRank]		INT				NOT NULL
		,[RecordId]			BIGINT			NOT NULL	PRIMARY KEY
		,[FusedScore]		FLOAT			NOT NULL
		,[TriggerMatched]	BIT				NOT NULL
		,[FinalScore]		FLOAT			NOT NULL
	)

	/********************************************************************************************
		RESOLVE THE CALLER, MATCH, RANK, FUSE AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( @p_Limit IS NULL OR @p_Limit <= 0 )
			THROW 50000, 'mem.usp_Recall: @p_Limit must be greater than zero.', 1

		;IF (	( @p_Tags IS NOT NULL AND ISJSON(@p_Tags, ARRAY) <> 1 )
				OR ( @p_Subjects IS NOT NULL AND ISJSON(@p_Subjects, ARRAY) <> 1 )	)
			THROW 50000, 'mem.usp_Recall: @p_Tags and @p_Subjects must each be a JSON array when given.', 1

		/* Serve an Oversized Request at the Ceiling. */
		;SELECT @Limit = CASE WHEN @p_Limit > @MaxLimit THEN @MaxLimit ELSE @p_Limit END

		/* One Reciprocal-Rank Unit: What a First-Ranked Entry of One List Contributes. */
		;SELECT @TriggerBonus = 1.0 / ( @RrfRankConstant + 1 )

		/* Resolve the Caller Once; an Unmapped Login Fills Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/* The Tags, Strings Only. */
		;INSERT INTO @Tags ( [Tag] )
		SELECT	DISTINCT
				[Tag]	= J.[value]
		FROM	OPENJSON(@p_Tags) J
		WHERE	J.[type] = 1

		/* The First 32 Entries by Position, Then the Non-Strings and Empties Among Them Dropped. */
		;INSERT INTO @Subjects ( [Ordinal], [Subject] )
		SELECT	 [Ordinal]	= TRY_CAST(J.[key] AS INT)
				,[Subject]	= LOWER(LEFT(J.[value] COLLATE Latin1_General_BIN2, @MaxSubjectLength))
		FROM	OPENJSON(@p_Subjects) J
		WHERE	TRY_CAST(J.[key] AS INT) < @MaxSubjects
				AND J.[type] = 1
				AND DATALENGTH(J.[value]) > 0

		/* The Query Text, Folded as the Subjects Are, for the cmd: Containment. */
		;SELECT @FoldedQueryText = LOWER(LEFT(@p_QueryText COLLATE Latin1_General_BIN2, @MaxQueryLength))

		/* Fill the Population, Narrowed to the Project Key, the Space and the Tags. */
		/* The CASE Hands OPENJSON Only a [Tags] That ISJSON Read as an Array, Since a Bare AND Fixes No Evaluation Order. */
		;INSERT INTO #Visible (
			 [RecordId]
			,[Tier]
			,[ProjectKey]
			,[Segment]
			,[Name]
			,[Triggers]
			,[IsArchived]	)
		SELECT	 [RecordId]		= V.[RecordId]
				,[Tier]			= V.[Tier]
				,[ProjectKey]	= V.[ProjectKey]
				,[Segment]		= V.[Segment]
				,[Name]			= V.[Name]
				,[Triggers]		= V.[Triggers]
				,[IsArchived]	= V.[IsArchived]
		FROM	mem.udf_VisibleRecords(@SandboxId) V
		WHERE	(	@p_ProjectKey IS NULL
					OR (	V.[Tier] = 'project'
							AND V.[ProjectKey] = @p_ProjectKey	)
					OR V.[Tier] IN ('type', 'operator')	)
				AND (	@p_Space IS NULL
						OR V.[Space] = @p_Space	)
				AND NOT EXISTS (	SELECT	NULL
									FROM	@Tags T
									WHERE	NOT EXISTS (	SELECT	NULL
															FROM	OPENJSON(CASE WHEN ISJSON(V.[Tags], ARRAY) = 1 THEN V.[Tags] END) J
															WHERE	J.[value] = T.[Tag]	)	)

		/****************************************************************************************
			PASS ONE: THE TRIGGER MATCH.
		****************************************************************************************/
		;IF (	@p_MatchTriggers = @True
				AND (	EXISTS ( SELECT NULL FROM @Subjects )
						OR DATALENGTH(@FoldedQueryText) > 0	)	)
		BEGIN
			/* Project Rows Alone: the Hook Confines a Prompt's Trigger Match to One Checkout. */
			;WITH cteEntries AS (
				SELECT	 [RecordId]	= V.[RecordId]
						,[Entry]	= TRIM(CONCAT(N' ', CHAR(9), CHAR(10), CHAR(13)) FROM J.[value])
				FROM	#Visible V
						CROSS APPLY OPENJSON(CASE WHEN ISJSON(V.[Triggers], ARRAY) = 1 THEN V.[Triggers] END) J
				WHERE	V.[Tier] = 'project'
						AND J.[type] = 1
						AND TRY_CAST(J.[key] AS INT) < @MaxTriggerEntries
			)
			/* The Lengths Are Guarded in the Expression, Since a WHERE Fixes No Evaluation Order Ahead of It. */
			,cteTriggers AS (
				SELECT	 [RecordId]	= E.[RecordId]
						,[Kind]		= LEFT(E.[Entry], CASE WHEN C.[Colon] > 1 THEN C.[Colon] - 1 ELSE 0 END)
						,[Pattern]	= LOWER(SUBSTRING(E.[Entry] COLLATE Latin1_General_BIN2, C.[Colon] + 1, @MaxSubjectLength))
				FROM	cteEntries E
						CROSS APPLY ( SELECT [Colon] = CHARINDEX(N':', E.[Entry]) ) C
				WHERE	C.[Colon] > 1
			)
			/* The Subjects and the Query Text as One List; Only a Subject Is Read as a Path. */
			,cteTargets AS (
				SELECT	 [Target]		= CAST(S.[Subject] AS NVARCHAR(4000))
						,[IsSubject]	= @True
				FROM	@Subjects S
				UNION ALL
				SELECT	 [Target]		= @FoldedQueryText
						,[IsSubject]	= @False
				WHERE	DATALENGTH(@FoldedQueryText) > 0
			)
			/* The CASE Hands the Glob Function Only a glob: Pattern and a Subject, Since an OR Fixes No Evaluation Order. */
			INSERT INTO #Triggered ( [RecordId] )
			SELECT	DISTINCT
					[RecordId]	= T.[RecordId]
			FROM	cteTriggers T
					INNER JOIN cteTargets G
						ON CASE	WHEN T.[Kind] COLLATE Latin1_General_BIN2 = N'cmd'
										AND DATALENGTH(T.[Kind]) = 6
									THEN CASE	WHEN CHARINDEX(T.[Pattern] COLLATE Latin1_General_BIN2, G.[Target] COLLATE Latin1_General_BIN2) > 0
													THEN @True
													ELSE @False
										 END
								WHEN T.[Kind] COLLATE Latin1_General_BIN2 = N'glob'
										AND DATALENGTH(T.[Kind]) = 8
										AND G.[IsSubject] = @True
									THEN mem.udf_TriggerGlobMatchesPath(T.[Pattern], G.[Target])
								ELSE @False
						   END = @True
			WHERE	DATALENGTH(T.[Pattern]) > 0
		END

		/****************************************************************************************
			BUILD A SAFE FULL-TEXT PREDICATE FROM THE CALLER'S TEXT.
		****************************************************************************************/
		;SELECT @NormalizedQueryText = TRANSLATE(LEFT(COALESCE(@p_QueryText, N''), @MaxQueryLength), CHAR(9) + CHAR(10) + CHAR(13), N'   ')

		/* Collect the Surviving Tokens: Escape Embedded Quotes, Strip Asterisks, Drop the Unsearchable. */
		/* A Token is Searchable When Something Remains Once Every ASCII Punctuation Character is Blanked. */
		;INSERT INTO @Tokens ( [Ordinal], [EscapedToken] )
		SELECT	TOP ( @MaxTokenCount )
				 [Ordinal]		= S.[ordinal]
				,[EscapedToken]	= E.[EscapedToken]
		FROM	STRING_SPLIT(@NormalizedQueryText, N' ', 1) S
				CROSS APPLY ( SELECT [EscapedToken] = REPLACE(REPLACE(S.[value], '"', '""'), '*', '') ) E
		WHERE	LEN(TRANSLATE(S.[value], N'!"#$%&''()*+,-./:;<=>?@[\]^_`{|}~', REPLICATE(N' ', 32))) > 0
				AND LEN(E.[EscapedToken]) <= @MaxTokenLength
		ORDER BY S.[ordinal]

		/* Quote Every Surviving Token and Join With OR, in Ordinal Order. */
		;SELECT @FullTextPredicate = STRING_AGG('"' + T.[EscapedToken] + '"', ' OR ') WITHIN GROUP ( ORDER BY T.[Ordinal] )
		FROM	@Tokens T

		/****************************************************************************************
			PASS TWO: FULL TEXT OVER DESCRIPTION AND BODY.
		****************************************************************************************/
		;IF ( @FullTextPredicate IS NOT NULL )
		BEGIN
			;WITH cteText AS (
				SELECT	TOP ( @CandidateDepth )
						 [RecordId]	= V.[RecordId]
						,[ListRank]	= ROW_NUMBER() OVER ( ORDER BY FT.[RANK] DESC, V.[RecordId] )
				FROM	CONTAINSTABLE(mem.Record, ([Description], [Body]), @FullTextPredicate) FT
						INNER JOIN #Visible V
							ON V.[RecordId] = FT.[KEY]
				ORDER BY FT.[RANK] DESC, V.[RecordId]
			)
			INSERT INTO #Contributions ( [RecordId], [ListId], [ListRank], [Contribution] )
			SELECT	 [RecordId]		= T.[RecordId]
					,[ListId]		= 2
					,[ListRank]		= T.[ListRank]
					,[Contribution]	= 1.0 / ( @RrfRankConstant + T.[ListRank] )
			FROM	cteText T
		END

		/****************************************************************************************
			PASS THREE: VECTOR OVER LIVE RECORDS, EACH ON ITS BEST CHUNK.
		****************************************************************************************/
		;IF ( @p_QueryVector IS NOT NULL )
		BEGIN
			;WITH cteVectorLive AS (
				SELECT	TOP ( @CandidateDepth )
						 [RecordId]	= D.[RecordId]
						,[ListRank]	= ROW_NUMBER() OVER ( ORDER BY D.[Distance], D.[RecordId] )
				FROM	(	SELECT	 [RecordId]	= E.[RecordId]
									,[Distance]	= MIN(VECTOR_DISTANCE('cosine', E.[Vector], @p_QueryVector))
							FROM	mem.Embedding E
									INNER JOIN #Visible V
										ON V.[RecordId] = E.[RecordId]
							WHERE	V.[IsArchived] = @False
									AND (	@p_ModelIdentity IS NULL
											OR E.[ModelIdentity] = @p_ModelIdentity	)
							GROUP BY E.[RecordId]	) D
				ORDER BY D.[Distance], D.[RecordId]
			)
			INSERT INTO #Contributions ( [RecordId], [ListId], [ListRank], [Contribution] )
			SELECT	 [RecordId]		= L.[RecordId]
					,[ListId]		= 3
					,[ListRank]		= L.[ListRank]
					,[Contribution]	= 1.0 / ( @RrfRankConstant + L.[ListRank] )
			FROM	cteVectorLive L
		END

		/****************************************************************************************
			FUSE THE LISTS, ADD THE TRIGGER BONUS, AND KEEP THE TOP RECORDS.
		****************************************************************************************/
		;WITH cteCandidates AS (
			SELECT	[RecordId] = CN.[RecordId]
			FROM	#Contributions CN
			UNION
			SELECT	[RecordId] = TR.[RecordId]
			FROM	#Triggered TR
		)
		,cteScored AS (
			SELECT	 [RecordId]			= C.[RecordId]
					,[FusedScore]		= COALESCE((	SELECT	SUM(CN.[Contribution])
														FROM	#Contributions CN
														WHERE	CN.[RecordId] = C.[RecordId]	), 0)
					,[TriggerMatched]	= CASE	WHEN EXISTS (	SELECT	NULL
																FROM	#Triggered TR
																WHERE	TR.[RecordId] = C.[RecordId]	)
												THEN @True
												ELSE @False
										  END
			FROM	cteCandidates C
		)
		INSERT INTO #Winners ( [RecordRank], [RecordId], [FusedScore], [TriggerMatched], [FinalScore] )
		SELECT	TOP ( @Limit )
				 [RecordRank]		= ROW_NUMBER() OVER ( ORDER BY F.[FinalScore] DESC, SC.[RecordId] )
				,[RecordId]			= SC.[RecordId]
				,[FusedScore]		= SC.[FusedScore]
				,[TriggerMatched]	= SC.[TriggerMatched]
				,[FinalScore]		= F.[FinalScore]
		FROM	cteScored SC
				CROSS APPLY ( SELECT [FinalScore] = SC.[FusedScore] + CASE WHEN SC.[TriggerMatched] = @True THEN @TriggerBonus ELSE 0 END ) F
		ORDER BY F.[FinalScore] DESC, SC.[RecordId]

		/****************************************************************************************
			DATASET 1: ONE ROW PER RECORD, IN RANK ORDER, WITH A HEAD OF ITS BODY.
		****************************************************************************************/
		;WITH cteListEvidence AS (
			SELECT	 [RecordId]		= CN.[RecordId]
					,[TextRank]		= MIN( CASE WHEN CN.[ListId] = 2 THEN CN.[ListRank] END )
					,[VectorRank]	= MIN( CASE WHEN CN.[ListId] = 3 THEN CN.[ListRank] END )
			FROM	#Contributions CN
					INNER JOIN #Winners W
						ON W.[RecordId] = CN.[RecordId]
			GROUP BY CN.[RecordId]
		)
		SELECT	[Json] = (	SELECT	 [recordId]			= W.[RecordId]
									,[rank]				= W.[RecordRank]
									,[name]				= V.[Name]
									,[tier]				= V.[Tier]
									,[projectKey]		= V.[ProjectKey]
									,[typeName]			= CASE WHEN V.[Tier] = 'type' THEN V.[Segment] END
									,[description]		= R.[Description]
									,[tags]				= JSON_QUERY(R.[Tags])
									,[triggers]			= JSON_QUERY(V.[Triggers])
									,[archived]			= V.[IsArchived]
									,[bodyLength]		= DATALENGTH(R.[Body]) / 2
									,[bodyHead]			= LEFT(R.[Body] COLLATE Latin1_General_BIN2,
																CASE	WHEN UNICODE(SUBSTRING(R.[Body] COLLATE Latin1_General_BIN2, @BodyHeadLength, 1)) BETWEEN 55296 AND 56319
																		THEN @BodyHeadLength - 1
																		ELSE @BodyHeadLength
																END)
									,[score]			= W.[FinalScore]
									,[fusedScore]		= W.[FusedScore]
									,[triggerMatched]	= W.[TriggerMatched]
									,[textRank]			= LE.[TextRank]
									,[vectorRank]		= LE.[VectorRank]
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
		FROM	#Winners W
				INNER JOIN #Visible V
					ON V.[RecordId] = W.[RecordId]
				INNER JOIN mem.Record R
					ON R.[RecordId] = W.[RecordId]
				LEFT JOIN cteListEvidence LE
					ON LE.[RecordId] = W.[RecordId]
		ORDER BY W.[RecordRank]
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
