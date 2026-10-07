-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_Search', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_Search AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_Search
(
	/*********************************************************************************************
	 PARAMETER NAME				DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_QueryText				NVARCHAR(MAX)	= NULL
	,@p_QueryVector				VECTOR(1024)	= NULL
	,@p_Limit					INT				= 10
	,@p_ModelIdentity			VARCHAR(200)	= NULL
	,@p_AppliedBoostPerDay		FLOAT			= 0.002
	,@p_AppliedDaysCap			INT				= 10
	,@p_ArchivedMultiplier		FLOAT			= 0.5
	,@p_SupersededMultiplier	FLOAT			= 0.5
	,@p_Segment					NVARCHAR(400)	= NULL
	,@p_Tag						NVARCHAR(200)	= NULL
	,@p_ProjectKey				NVARCHAR(400)	= NULL
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_Search
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.5
	*********************************************************************************************
		NOTES:		v1.5 - 10/04/2026
							The applied-day count each candidate's boost multiplies is the
							record's [AppliedDays] in mem.RecordUsage, the number of
							distinct calendar dates it was marked applied on, and 0 for a
							record with no row. The boost, its cap and the ranking are
							unchanged.

					v1.4 - 10/04/2026 - SCOTT APPLEFELD
							The call writes no log row and computes no digest of its
							parameters. It ranks and returns, and the database keeps no
							record of who searched for what.

					v1.3 - 10/03/2026 - SCOTT APPLEFELD
							@p_ProjectKey narrows the visible set to one project's rows,
							those of the fleet store carrying that key, and the rows of the
							type and operator tiers, so a search from a project scope never
							ranks another project's records. @p_Segment stays the version 6
							scope a client not yet updated still sends: it keeps a project
							row whose store names that segment and which is the caller's
							own or shared, which is the answer the same call drew from
							version 6's visible set. A call naming both keeps the rows both
							predicates keep, and that is always none, since
							CK_Store_TierShape gives a store a segment or a project key and
							never both: a client on this version sends @p_ProjectKey alone.
							With neither named, the search ranks every row
							mem.udf_VisibleRecords serves, which is
							every undeleted row. A row a session wrote
							through mem.usp_PutRecord names its writing sandbox as its
							[sandbox].

					v1.2 - 09/25/2026 - SCOTT APPLEFELD
							@p_Segment and @p_Tag narrow the visible set before any
							candidate list reads it, so a scoped call ranks its own
							population rather than filtering a ranking chosen over every
							visible row. @p_Segment keeps a row only where its tier is
							project and its segment equals the value, a promoted row
							included, since promotion leaves a row's tier and segment
							alone. @p_Tag keeps a row only where its [Tags] text is a JSON
							array with that value among its elements, a test that
							applies only when a tag is named; a NULL [Tags], or one
							holding a JSON object, is a row the tag drops rather than an
							error the call raises. Both are AND predicates over
							mem.udf_VisibleRecords's own answer, so neither can admit a
							row outside it, and a call naming neither fills the set
							exactly as a v1.1 call does. Supersession is read over the
							caller's whole visible set rather than the narrowed one, so a
							cut never lifts a record's demotion.

					v1.1 - 09/19/2026 - SCOTT APPLEFELD
							Each row carries [distance], the cosine distance of the record's
							best chunk from the query vector, taken out of the vector
							candidate lists rather than computed again. It is NULL for a
							record no vector list ranked, which is a record a lexical list
							alone found. The client reads it as one minus the distance, which
							is the scale mem.usp_Nearest's callers already rank on, and holds
							it to a floor of its own; no cutoff is applied here.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							Hybrid search over the records the caller may see. The caller's
							sandbox comes from mem.CallerSandbox() and the visible set from
							mem.udf_VisibleRecords: its own private rows plus every shared
							row, never a deleted one, and nothing at all for an unmapped
							login. Every candidate list joins that set before its ranks are
							assigned, so a row outside it can never hold a rank position.

							Four lists fuse by Reciprocal Rank Fusion at K = 60, each entry
							contributing 1 / (60 + rank): full-text over [Description],
							full-text over [Body], cosine distance over the embeddings of
							live records, and cosine distance over the embeddings of archived
							records, a record ranking on its best chunk. A list runs only
							when its input is present: the two lexical lists need a query
							text with a searchable token, the two vector lists need a query
							vector, and @p_ModelIdentity, when given, keeps the vector lists
							to embeddings that model produced. In fused-score space each
							record then gains @p_AppliedBoostPerDay per distinct day it was
							stamped applied, capped at @p_AppliedDaysCap days, and is
							multiplied by @p_ArchivedMultiplier when archived and by
							@p_SupersededMultiplier when another visible record in its store
							names it as superseded.

							@p_QueryText is arbitrary caller text, never a full-text
							predicate. It is capped at 4000 characters and split on
							whitespace; tokens made only of ASCII punctuation are dropped
							(a token in any script survives, and the word breaker decides
							what it matches), tokens over 100 characters are dropped, the
							first 32 survivors have double quotes doubled and asterisks
							removed, and each is quoted and joined with OR, so no keyword,
							wildcard or punctuation arrives as an operator.

							Returns one row, one column [Json], a JSON
							array of {recordId, name, fileKey, tier, segment, sandbox,
							visibility, description, archived, score, fusedScore,
							appliedBoost, descriptionRank, bodyRank, vectorLiveRank,
							vectorArchivedRank, distance}, ranks NULL where a list did
							not vote and distance NULL where neither vector list did.
							(distance is v1.1's; it is named here because this list is
							the file's only enumeration of the returned shape and a
							reader takes it for the contract.)
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
			,@SandboxId			INT				= NULL
			,@Limit				INT				= NULL

	/* Ranking Constants. */
	;DECLARE @RrfRankConstant	FLOAT			= 60
			,@CandidateDepth	INT				= 50
			,@MaxLimit			INT				= 50

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

	/* Working Tables are Created Unconditionally, so an Outer Scope Cannot Plant One and Seed the Winners. */
	;CREATE TABLE #Visible (
		 [RecordId]					BIGINT			NOT NULL	PRIMARY KEY
		,[StoreId]					INT				NOT NULL
		,[Tier]						VARCHAR(20)		NOT NULL
		,[Segment]					NVARCHAR(400)	NULL
		,[StoreSandboxId]			INT				NULL
		,[LastPublishedBySandboxId]	INT				NULL
		,[WrittenBySandboxId]		INT				NULL
		,[Name]						NVARCHAR(200)	NOT NULL
		,[FileKey]					NVARCHAR(400)	NOT NULL
		,[Description]				NVARCHAR(MAX)	NOT NULL
		,[SupersedesName]			NVARCHAR(200)	NULL
		,[IsArchived]				BIT				NOT NULL
		,[Visibility]				VARCHAR(10)		NOT NULL
	)

	/* Each List's RRF Contributions: 1 = Description, 2 = Body, 3 = Vector Live, 4 = Vector Archived. */
	/* [Distance] Rides Along From the Two Vector Lists and is NULL for the Two Lexical Ones. */
	;CREATE TABLE #Contributions (
		 [RecordId]			BIGINT			NOT NULL
		,[ListId]			TINYINT			NOT NULL
		,[ListRank]			BIGINT			NOT NULL
		,[Contribution]		FLOAT			NOT NULL
		,[Distance]			FLOAT			NULL
	)

	;CREATE TABLE #Winners (
		 [RecordRank]		INT				NOT NULL
		,[RecordId]			BIGINT			NOT NULL	PRIMARY KEY
		,[FusedScore]		FLOAT			NOT NULL
		,[AppliedBoost]		FLOAT			NOT NULL
		,[Multiplier]		FLOAT			NOT NULL
		,[FinalScore]		FLOAT			NOT NULL
	)

	/********************************************************************************************
		RESOLVE THE CALLER, RANK, FUSE AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( @p_Limit IS NULL OR @p_Limit <= 0 )
			THROW 50000, 'mem.usp_Search: @p_Limit must be greater than zero.', 1

		/* Serve an Oversized Request at the Ceiling. */
		;SELECT @Limit = CASE WHEN @p_Limit > @MaxLimit THEN @MaxLimit ELSE @p_Limit END

		/* Resolve the Caller Once; an Unmapped Login Fills Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/* Fill the Visible Set, Narrowed to the Named Project Key or Segment and to the Tag Inside It. */
		/* The CASE Hands OPENJSON Only a [Tags] That ISJSON Read as an Array, Since a Bare AND Fixes No Evaluation Order. */
		;INSERT INTO #Visible (
			 [RecordId]
			,[StoreId]
			,[Tier]
			,[Segment]
			,[StoreSandboxId]
			,[LastPublishedBySandboxId]
			,[WrittenBySandboxId]
			,[Name]
			,[FileKey]
			,[Description]
			,[SupersedesName]
			,[IsArchived]
			,[Visibility]	)
		SELECT	 [RecordId]					= V.[RecordId]
				,[StoreId]					= V.[StoreId]
				,[Tier]						= V.[Tier]
				,[Segment]					= V.[Segment]
				,[StoreSandboxId]			= V.[StoreSandboxId]
				,[LastPublishedBySandboxId]	= V.[LastPublishedBySandboxId]
				,[WrittenBySandboxId]		= V.[WrittenBySandboxId]
				,[Name]						= V.[Name]
				,[FileKey]					= V.[FileKey]
				,[Description]				= V.[Description]
				,[SupersedesName]			= V.[SupersedesName]
				,[IsArchived]				= V.[IsArchived]
				,[Visibility]				= V.[Visibility]
		FROM	mem.udf_VisibleRecords(@SandboxId) V
		WHERE	(	@p_Segment IS NULL
					OR (	V.[Tier] = 'project'
							AND V.[Segment] = @p_Segment
							AND (	V.[StoreSandboxId] = @SandboxId
									OR V.[Visibility] = 'shared'	)	)	)
				AND (	@p_ProjectKey IS NULL
						OR (	V.[Tier] = 'project'
								AND V.[ProjectKey] = @p_ProjectKey	)
						OR V.[Tier] IN ('type', 'operator')	)
				AND (	@p_Tag IS NULL
						OR EXISTS (	SELECT	NULL
									FROM	mem.Record R
											CROSS APPLY OPENJSON(CASE WHEN ISJSON(R.[Tags], ARRAY) = 1 THEN R.[Tags] END) J
									WHERE	R.[RecordId] = V.[RecordId]
											AND J.[value] = @p_Tag	)	)

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
			CANDIDATE LIST 1: FULL-TEXT OVER DESCRIPTION.
		****************************************************************************************/
		;IF ( @FullTextPredicate IS NOT NULL )
		BEGIN
			;WITH cteDescription AS (
				SELECT	TOP ( @CandidateDepth )
						 [RecordId]	= V.[RecordId]
						,[ListRank]	= ROW_NUMBER() OVER ( ORDER BY FT.[RANK] DESC, V.[RecordId] )
				FROM	CONTAINSTABLE(mem.Record, [Description], @FullTextPredicate) FT
						INNER JOIN #Visible V
							ON V.[RecordId] = FT.[KEY]
				ORDER BY FT.[RANK] DESC, V.[RecordId]
			)
			INSERT INTO #Contributions ( [RecordId], [ListId], [ListRank], [Contribution] )
			SELECT	 [RecordId]		= D.[RecordId]
					,[ListId]		= 1
					,[ListRank]		= D.[ListRank]
					,[Contribution]	= 1.0 / ( @RrfRankConstant + D.[ListRank] )
			FROM	cteDescription D
		END

		/****************************************************************************************
			CANDIDATE LIST 2: FULL-TEXT OVER BODY.
		****************************************************************************************/
		;IF ( @FullTextPredicate IS NOT NULL )
		BEGIN
			;WITH cteBody AS (
				SELECT	TOP ( @CandidateDepth )
						 [RecordId]	= V.[RecordId]
						,[ListRank]	= ROW_NUMBER() OVER ( ORDER BY FT.[RANK] DESC, V.[RecordId] )
				FROM	CONTAINSTABLE(mem.Record, [Body], @FullTextPredicate) FT
						INNER JOIN #Visible V
							ON V.[RecordId] = FT.[KEY]
				ORDER BY FT.[RANK] DESC, V.[RecordId]
			)
			INSERT INTO #Contributions ( [RecordId], [ListId], [ListRank], [Contribution] )
			SELECT	 [RecordId]		= B.[RecordId]
					,[ListId]		= 2
					,[ListRank]		= B.[ListRank]
					,[Contribution]	= 1.0 / ( @RrfRankConstant + B.[ListRank] )
			FROM	cteBody B
		END

		/****************************************************************************************
			CANDIDATE LIST 3: VECTOR OVER LIVE RECORDS, EACH ON ITS BEST CHUNK.
		****************************************************************************************/
		;IF ( @p_QueryVector IS NOT NULL )
		BEGIN
			;WITH cteVectorLive AS (
				SELECT	TOP ( @CandidateDepth )
						 [RecordId]	= D.[RecordId]
						,[ListRank]	= ROW_NUMBER() OVER ( ORDER BY D.[Distance], D.[RecordId] )
						,[Distance]	= D.[Distance]
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
			INSERT INTO #Contributions ( [RecordId], [ListId], [ListRank], [Contribution], [Distance] )
			SELECT	 [RecordId]		= L.[RecordId]
					,[ListId]		= 3
					,[ListRank]		= L.[ListRank]
					,[Contribution]	= 1.0 / ( @RrfRankConstant + L.[ListRank] )
					,[Distance]		= L.[Distance]
			FROM	cteVectorLive L
		END

		/****************************************************************************************
			CANDIDATE LIST 4: VECTOR OVER ARCHIVED RECORDS, EACH ON ITS BEST CHUNK.
		****************************************************************************************/
		;IF ( @p_QueryVector IS NOT NULL )
		BEGIN
			;WITH cteVectorArchived AS (
				SELECT	TOP ( @CandidateDepth )
						 [RecordId]	= D.[RecordId]
						,[ListRank]	= ROW_NUMBER() OVER ( ORDER BY D.[Distance], D.[RecordId] )
						,[Distance]	= D.[Distance]
				FROM	(	SELECT	 [RecordId]	= E.[RecordId]
									,[Distance]	= MIN(VECTOR_DISTANCE('cosine', E.[Vector], @p_QueryVector))
							FROM	mem.Embedding E
									INNER JOIN #Visible V
										ON V.[RecordId] = E.[RecordId]
							WHERE	V.[IsArchived] = @True
									AND (	@p_ModelIdentity IS NULL
											OR E.[ModelIdentity] = @p_ModelIdentity	)
							GROUP BY E.[RecordId]	) D
				ORDER BY D.[Distance], D.[RecordId]
			)
			INSERT INTO #Contributions ( [RecordId], [ListId], [ListRank], [Contribution], [Distance] )
			SELECT	 [RecordId]		= A.[RecordId]
					,[ListId]		= 4
					,[ListRank]		= A.[ListRank]
					,[Contribution]	= 1.0 / ( @RrfRankConstant + A.[ListRank] )
					,[Distance]		= A.[Distance]
			FROM	cteVectorArchived A
		END

		/****************************************************************************************
			FUSE THE LISTS, APPLY THE BOOST AND THE DEMOTIONS, AND KEEP THE TOP RECORDS.
		****************************************************************************************/
		;WITH cteFused AS (
			SELECT	 [RecordId]		= CN.[RecordId]
					,[FusedScore]	= SUM(CN.[Contribution])
			FROM	#Contributions CN
			GROUP BY CN.[RecordId]
		)
		,cteApplied AS (
			SELECT	 [RecordId]		= RU.[RecordId]
					,[AppliedDays]	= RU.[AppliedDays]
			FROM	mem.RecordUsage RU
					INNER JOIN cteFused F
						ON F.[RecordId] = RU.[RecordId]
		)
		,cteScored AS (
			SELECT	 [RecordId]		= F.[RecordId]
					,[FusedScore]	= F.[FusedScore]
					,[AppliedBoost]	= @p_AppliedBoostPerDay * CASE	WHEN COALESCE(A.[AppliedDays], 0) > @p_AppliedDaysCap
																	THEN @p_AppliedDaysCap
																	ELSE COALESCE(A.[AppliedDays], 0)
															  END
					,[Multiplier]	= ( CASE WHEN V.[IsArchived] = @True THEN @p_ArchivedMultiplier ELSE 1.0 END )
									* ( CASE WHEN EXISTS (	SELECT	NULL
															FROM	mem.udf_VisibleRecords(@SandboxId) V2
															WHERE	V2.[StoreId] = V.[StoreId]
																	AND V2.[RecordId] <> V.[RecordId]
																	AND V2.[SupersedesName] = V.[Name]	)
											 THEN @p_SupersededMultiplier
											 ELSE 1.0
										END )
			FROM	cteFused F
					INNER JOIN #Visible V
						ON V.[RecordId] = F.[RecordId]
					LEFT JOIN cteApplied A
						ON A.[RecordId] = F.[RecordId]
		)
		INSERT INTO #Winners ( [RecordRank], [RecordId], [FusedScore], [AppliedBoost], [Multiplier], [FinalScore] )
		SELECT	TOP ( @Limit )
				 [RecordRank]	= ROW_NUMBER() OVER ( ORDER BY ( SC.[FusedScore] + SC.[AppliedBoost] ) * SC.[Multiplier] DESC, SC.[RecordId] )
				,[RecordId]		= SC.[RecordId]
				,[FusedScore]	= SC.[FusedScore]
				,[AppliedBoost]	= SC.[AppliedBoost]
				,[Multiplier]	= SC.[Multiplier]
				,[FinalScore]	= ( SC.[FusedScore] + SC.[AppliedBoost] ) * SC.[Multiplier]
		FROM	cteScored SC
		ORDER BY ( SC.[FusedScore] + SC.[AppliedBoost] ) * SC.[Multiplier] DESC, SC.[RecordId]

		/****************************************************************************************
			DATASET 1: THE RANKED RECORDS WITH EACH LIST'S VOTE.
		****************************************************************************************/
		;WITH cteListEvidence AS (
			SELECT	 [RecordId]				= CN.[RecordId]
					,[DescriptionRank]		= MIN( CASE WHEN CN.[ListId] = 1 THEN CN.[ListRank] END )
					,[BodyRank]				= MIN( CASE WHEN CN.[ListId] = 2 THEN CN.[ListRank] END )
					,[VectorLiveRank]		= MIN( CASE WHEN CN.[ListId] = 3 THEN CN.[ListRank] END )
					,[VectorArchivedRank]	= MIN( CASE WHEN CN.[ListId] = 4 THEN CN.[ListRank] END )
					,[Distance]				= MIN( CN.[Distance] )
			FROM	#Contributions CN
					INNER JOIN #Winners W
						ON W.[RecordId] = CN.[RecordId]
			GROUP BY CN.[RecordId]
		)
		SELECT	[Json] = COALESCE((
			SELECT	 [recordId]				= W.[RecordId]
					,[name]					= V.[Name]
					,[fileKey]				= V.[FileKey]
					,[tier]					= V.[Tier]
					,[segment]				= V.[Segment]
					,[sandbox]				= COALESCE(SS.[Name], WS.[Name], PS.[Name])
					,[visibility]			= V.[Visibility]
					,[description]			= V.[Description]
					,[archived]				= V.[IsArchived]
					,[distance]				= LE.[Distance]
					,[score]				= W.[FinalScore]
					,[fusedScore]			= W.[FusedScore]
					,[appliedBoost]			= W.[AppliedBoost]
					,[descriptionRank]		= LE.[DescriptionRank]
					,[bodyRank]				= LE.[BodyRank]
					,[vectorLiveRank]		= LE.[VectorLiveRank]
					,[vectorArchivedRank]	= LE.[VectorArchivedRank]
			FROM	#Winners W
					INNER JOIN #Visible V
						ON V.[RecordId] = W.[RecordId]
					LEFT JOIN cteListEvidence LE
						ON LE.[RecordId] = W.[RecordId]
					LEFT JOIN mem.Sandbox SS
						ON SS.[SandboxId] = V.[StoreSandboxId]
					LEFT JOIN mem.Sandbox WS
						ON WS.[SandboxId] = V.[WrittenBySandboxId]
					LEFT JOIN mem.Sandbox PS
						ON PS.[SandboxId] = V.[LastPublishedBySandboxId]
			ORDER BY W.[RecordRank]
			FOR JSON PATH, INCLUDE_NULL_VALUES ), N'[]')
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
