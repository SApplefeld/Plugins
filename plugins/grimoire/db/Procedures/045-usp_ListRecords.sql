-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_ListRecords', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_ListRecords AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_ListRecords
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_ModelIdentity	VARCHAR(200)
	,@p_IncludeFleet	BIT				= 0
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_ListRecords
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.4
	*********************************************************************************************
		NOTES:		v1.4 - 10/04/2026 - SCOTT APPLEFELD
							The call writes no log row. It reads and returns, and the
							database keeps no record of who listed what.

					v1.3 - 10/04/2026 - SCOTT APPLEFELD
							Each row carries projectKey, the fleet store's key for a fleet row and
							NULL for every other row, so a caller embedding a fleet row can read
							its body back through mem.usp_GetRecord by tier, key and name; a
							fleet row has no file on the caller's machine to read it from.

							v1.2 - 10/03/2026 - SCOTT APPLEFELD
							@p_IncludeFleet at 1 adds the rows of every project's fleet store,
							which belongs to no sandbox, to the inventory, so a caller can find
							the records any sandbox may embed there. At 0, the default, the
							answer is the v1.1 one: the publish diffs it against this machine's
							files, and a fleet row, which has no file and no segment, would read
							there as a removal held back on every run.

					v1.1 - 09/18/2026 - SCOTT APPLEFELD
							Another sandbox's project rows are left out of the answer. A
							promoted project record is shared but is not this publisher's to
							embed or remove, and its file key can match one of this sandbox's
							own, so a walk that no longer finds that key would name the other
							sandbox's record as removed.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The publisher's inventory of what it may see, which is the one
							thing an execute-only login cannot read for itself. It answers
							three questions in one pass: the record id every embedding write
							needs, which records carry no embedding for @p_ModelIdentity, and
							which file keys the database still holds that a walk no longer
							finds. The rows are mem.udf_VisibleRecords for the sandbox
							mem.CallerSandbox() resolves, so an unmapped login sees nothing and
							no tenancy rule is restated here.

							Returns one row per record, each one column [Json] holding
							{recordId, tier, segment, projectKey, fileKey, name, archived,
							visibility, embedded}, ordered by tier, segment and file key. [embedded] is
							true where an embedding for @p_ModelIdentity exists, so a record
							embedded under another model reads as unembedded and the next
							publish re-embeds it.
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

	/* The Visible Inventory, Created Unconditionally so an Outer Scope Cannot Plant One. */
	;CREATE TABLE #Listed (
		 [RecordId]			BIGINT			NOT NULL	PRIMARY KEY
		,[Tier]				VARCHAR(20)		NOT NULL
		,[Segment]			NVARCHAR(400)	NULL
		,[ProjectKey]		NVARCHAR(400)	NULL
		,[FileKey]			NVARCHAR(400)	NOT NULL
		,[Name]				NVARCHAR(200)	NOT NULL
		,[IsArchived]		BIT				NOT NULL
		,[Visibility]		VARCHAR(20)		NOT NULL
		,[IsEmbedded]		BIT				NOT NULL
	)

	/********************************************************************************************
		RESOLVE THE CALLER, COLLECT THE INVENTORY AND RETURN.
	********************************************************************************************/
	;BEGIN TRY
		;IF ( NULLIF(LTRIM(RTRIM(@p_ModelIdentity)), '') IS NULL )
			THROW 50000, 'mem.usp_ListRecords: @p_ModelIdentity is required, since the embedded flag is answered for one model.', 1

		/* Resolve the Caller Once; an Unmapped Login Fills Nothing Below. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		/* Collect Every Visible Record and Whether This Model Has Embedded It. */
		;INSERT INTO #Listed (
			 [RecordId]
			,[Tier]
			,[Segment]
			,[ProjectKey]
			,[FileKey]
			,[Name]
			,[IsArchived]
			,[Visibility]
			,[IsEmbedded]	)
		SELECT	 [RecordId]		= V.[RecordId]
				,[Tier]			= V.[Tier]
				,[Segment]		= V.[Segment]
				,[ProjectKey]	= CASE WHEN V.[Tier] = 'project' AND V.[StoreSandboxId] IS NULL THEN V.[ProjectKey] END
				,[FileKey]		= V.[FileKey]
				,[Name]			= V.[Name]
				,[IsArchived]	= V.[IsArchived]
				,[Visibility]	= V.[Visibility]
				,[IsEmbedded]	= CASE
									WHEN EXISTS (	SELECT	NULL
													FROM	mem.Embedding E
													WHERE	E.[RecordId] = V.[RecordId]
															AND E.[ModelIdentity] = @p_ModelIdentity	)
									THEN @True
									ELSE @False
								  END
		FROM	mem.udf_VisibleRecords(@SandboxId) V
		WHERE	(	V.[Tier] <> 'project'
					OR V.[StoreSandboxId] = @SandboxId
					OR (	V.[StoreSandboxId] IS NULL
							AND COALESCE(@p_IncludeFleet, 0) = 1	)	)

		/****************************************************************************************
			DATASET 1: ONE ROW PER VISIBLE RECORD.
		****************************************************************************************/
		/* One Row per Record Rather Than One Array; sqlcmd Cuts a Single Value at 8000 Characters. */
		;SELECT	[Json] = (	SELECT	 [recordId]		= L.[RecordId]
									,[tier]			= L.[Tier]
									,[segment]		= L.[Segment]
									,[projectKey]	= L.[ProjectKey]
									,[fileKey]		= L.[FileKey]
									,[name]			= L.[Name]
									,[archived]		= L.[IsArchived]
									,[visibility]	= L.[Visibility]
									,[embedded]		= L.[IsEmbedded]
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
		FROM	#Listed L
		ORDER BY L.[Tier], L.[Segment], L.[FileKey]
	END TRY
	BEGIN CATCH
		;THROW
	END CATCH
END
GO
