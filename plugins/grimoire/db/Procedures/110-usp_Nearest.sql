-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_Nearest', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_Nearest AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_Nearest
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Vector			VECTOR(1024)
	,@p_Limit			INT				= 10
	,@p_ModelIdentity	VARCHAR(200)	= NULL
	,@p_IncludeArchived	BIT				= 0
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_Nearest
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.3
	*********************************************************************************************
		NOTES:		v1.3 - 10/04/2026 - SCOTT APPLEFELD
							The call writes no log row and computes no digest of the
							vector. It scans and returns, and the database keeps no
							record of who asked for what.

					v1.2 - 10/03/2026 - SCOTT APPLEFELD
							A row from a project's fleet store, which belongs to no sandbox,
							names the sandbox that last wrote it through mem.usp_PutRecord as
							its [sandbox], the label mem.usp_Search gives the same row.

					v1.1 - 09/21/2026 - SCOTT APPLEFELD
							@p_IncludeArchived admits archived records to the scan. At 0,
							the default, only live records are ranked. At 1, archived
							records rank beside live ones on the same best-chunk distance
							and take slots in the same TOP (@Limit). Each row carries
							[archived], the record's archived flag, so a caller can tell
							the two apart; mem.usp_Search projects the same key.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The neighbours shape: the live records nearest to @p_Vector by
							cosine distance, each on its best chunk, over the rows the caller
							may see through mem.udf_VisibleRecords for the sandbox
							mem.CallerSandbox() resolves. An unmapped login sees nothing.
							@p_ModelIdentity, when given, keeps the scan to embeddings that
							model produced.

							Returns one row, one column [Json], a JSON array of {recordId,
							name, fileKey, tier, segment, sandbox, visibility, description,
							distance, chunkIndex} ordered nearest first.
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
			,@MaxLimit			INT				= 50

	/* The Nearest Rows, Created Unconditionally so an Outer Scope Cannot Plant One. */
	;CREATE TABLE #Nearest (
		 [NeighbourRank]	INT				NOT NULL
		,[RecordId]			BIGINT			NOT NULL	PRIMARY KEY
		,[Distance]			FLOAT			NOT NULL
		,[ChunkIndex]		INT				NOT NULL
	)

	/********************************************************************************************
		RESOLVE THE CALLER, SCAN AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( @p_Vector IS NULL )
			THROW 50000, 'mem.usp_Nearest: @p_Vector is required.', 1

		;IF ( @p_Limit IS NULL OR @p_Limit <= 0 )
			THROW 50000, 'mem.usp_Nearest: @p_Limit must be greater than zero.', 1

		/* Serve an Oversized Request at the Ceiling. */
		;SELECT @Limit = CASE WHEN @p_Limit > @MaxLimit THEN @MaxLimit ELSE @p_Limit END

		/* Resolve the Caller Once; an Unmapped Login Fills Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/* Rank the Visible Records by Their Best Chunk's Distance; Archived Ones Only When Asked. */
		;WITH cteBestChunk AS (
			SELECT	 [RecordId]		= E.[RecordId]
					,[ChunkIndex]	= E.[ChunkIndex]
					,[Distance]		= D.[Distance]
					,[ChunkRowNumber]	= ROW_NUMBER() OVER ( PARTITION BY E.[RecordId] ORDER BY D.[Distance], E.[ChunkIndex] )
			FROM	mem.Embedding E
					INNER JOIN mem.udf_VisibleRecords(@SandboxId) V
						ON V.[RecordId] = E.[RecordId]
					CROSS APPLY ( SELECT [Distance] = VECTOR_DISTANCE('cosine', E.[Vector], @p_Vector) ) D
			WHERE	(	V.[IsArchived] = @False
						OR @p_IncludeArchived = @True	)
					AND (	@p_ModelIdentity IS NULL
							OR E.[ModelIdentity] = @p_ModelIdentity	)
		)
		INSERT INTO #Nearest ( [NeighbourRank], [RecordId], [Distance], [ChunkIndex] )
		SELECT	TOP ( @Limit )
				 [NeighbourRank]	= ROW_NUMBER() OVER ( ORDER BY B.[Distance], B.[RecordId] )
				,[RecordId]			= B.[RecordId]
				,[Distance]			= B.[Distance]
				,[ChunkIndex]		= B.[ChunkIndex]
		FROM	cteBestChunk B
		WHERE	B.[ChunkRowNumber] = 1
		ORDER BY B.[Distance], B.[RecordId]

		/****************************************************************************************
			DATASET 1: THE NEIGHBOURS, NEAREST FIRST.
		****************************************************************************************/
		;SELECT	[Json] = COALESCE((
			SELECT	 [recordId]		= N.[RecordId]
					,[name]			= V.[Name]
					,[fileKey]		= V.[FileKey]
					,[tier]			= V.[Tier]
					,[segment]		= V.[Segment]
					,[sandbox]		= COALESCE(SS.[Name], WS.[Name], PS.[Name])
					,[visibility]	= V.[Visibility]
					,[description]	= V.[Description]
					,[archived]		= V.[IsArchived]
					,[distance]		= N.[Distance]
					,[chunkIndex]	= N.[ChunkIndex]
			FROM	#Nearest N
					INNER JOIN mem.udf_VisibleRecords(@SandboxId) V
						ON V.[RecordId] = N.[RecordId]
					LEFT JOIN mem.Sandbox SS
						ON SS.[SandboxId] = V.[StoreSandboxId]
					LEFT JOIN mem.Sandbox WS
						ON WS.[SandboxId] = V.[WrittenBySandboxId]
					LEFT JOIN mem.Sandbox PS
						ON PS.[SandboxId] = V.[LastPublishedBySandboxId]
			ORDER BY N.[NeighbourRank]
			FOR JSON PATH, INCLUDE_NULL_VALUES ), N'[]')
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
