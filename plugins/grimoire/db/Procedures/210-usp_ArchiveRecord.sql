-- CREATE THE PROCEDURE WITH QUOTED_IDENTIFIER ON; PROCEDURES CAPTURE IT AT CREATE TIME.
;SET QUOTED_IDENTIFIER ON
GO

-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('mem.usp_ArchiveRecord', 'P') IS NULL
  EXEC ('CREATE PROCEDURE mem.usp_ArchiveRecord AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE mem.usp_ArchiveRecord
(
	/*********************************************************************************************
	 PARAMETER NAME		DATATYPE		DEFAULT
	*********************************************************************************************/
	 @p_Tier			VARCHAR(20)		= NULL
	,@p_ProjectKey		NVARCHAR(400)	= NULL
	,@p_TypeName		NVARCHAR(400)	= NULL
	,@p_Name			NVARCHAR(200)	= NULL
	,@p_Delete			BIT				= 0
)
AS
BEGIN	-- PROCEDURE

	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.usp_ArchiveRecord
		AUTHOR:		Scott Applefeld
		DATE:		October 3rd, 2026
		VERSION:	v1.0
	*********************************************************************************************
		NOTES:		v1.0 - 10/03/2026 - SCOTT APPLEFELD
							Retires one record for the calling sandbox, named by its tier, its
							store's key and its name: a project record by @p_ProjectKey, a
							type record by @p_TypeName, an operator record by neither. The
							row takes the archived flag, and with @p_Delete also the deleted
							mark, which no read procedure serves. No row is ever removed. A
							name the store holds no undeleted row of answers absent and
							writes nothing, so a resent retirement is not a failure. A name
							resolves to the newest undeleted row of it in the store, archived
							or not, as it does in every procedure that resolves a record by
							name. Where that row is already archived, an archive without
							@p_Delete changes nothing and answers archived, so a resent
							archive without @p_Delete writes nothing. A delete takes its row
							out of that resolution, so a resent delete answers absent, or
							reaches the next undeleted row of the name where the store holds
							one. The caller's sandbox comes from mem.CallerSandbox() and an
							unmapped login is refused.

							Returns one row, one column [Json], holding {status, recordId},
							status archived, deleted or absent.
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
			,@Now				DATETIMEOFFSET	= SYSDATETIMEOFFSET()
			,@SandboxId			INT				= NULL
			,@RecordId			BIGINT			= NULL
			,@IsArchived		BIT				= NULL
			,@Status			VARCHAR(10)		= 'absent'
			,@Tier				VARCHAR(20)		= LOWER(LTRIM(RTRIM(@p_Tier)))
			,@Name				NVARCHAR(200)	= NULLIF(LTRIM(RTRIM(@p_Name)), '')
			,@ProjectKey		NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_ProjectKey)), '')
			,@TypeName			NVARCHAR(400)	= NULLIF(LTRIM(RTRIM(@p_TypeName)), '')

	/********************************************************************************************
		VALIDATE THE CALLER, RESOLVE THE ROW, AND MARK IT.
	********************************************************************************************/
	;BEGIN TRY
		/* Resolve the Caller; an Unmapped Login Writes Nothing. */
		;SELECT	@SandboxId = CS.[SandboxId]
		FROM	mem.CallerSandbox() CS

		;IF ( @SandboxId IS NULL )
			THROW 50000, 'mem.usp_ArchiveRecord: the calling login maps to no sandbox.', 1

		;IF ( @Name IS NULL OR @Tier IS NULL OR @Tier NOT IN ('project', 'type', 'operator') )
			THROW 50000, 'mem.usp_ArchiveRecord: @p_Name and a @p_Tier of project, type or operator are required.', 1

		/* The Newest Undeleted Row of That Name in the Named Store, Archived or Not. */
		;SELECT	TOP ( 1 )
				 @RecordId		= R.[RecordId]
				,@IsArchived	= R.[IsArchived]
		FROM	mem.Record R
				INNER JOIN mem.Store S
					ON S.[StoreId] = R.[StoreId]
		WHERE	S.[Tier] = @Tier
				AND S.[SandboxId] IS NULL
				AND EXISTS (	SELECT S.[ProjectKey], CASE WHEN S.[Tier] = 'type' THEN S.[Segment] END
								INTERSECT
								SELECT @ProjectKey, @TypeName	)
				AND R.[Name] = @Name
				AND R.[DeletedDt] IS NULL
		ORDER BY R.[RecordId] DESC

		/* An Archive of a Row Already Archived Writes Nothing. */
		;IF ( @RecordId IS NOT NULL AND @IsArchived = @True AND COALESCE(@p_Delete, @False) = @False )
		BEGIN
			;SET @Status = 'archived'
		END ELSE IF ( @RecordId IS NOT NULL )
		BEGIN
			;UPDATE R
			SET		 [IsArchived]	= @True
					,[DeletedDt]	= CASE WHEN COALESCE(@p_Delete, @False) = @True THEN @Now ELSE R.[DeletedDt] END
					,[UpdatedDt]	= @Now
			FROM	mem.Record R
			WHERE	R.[RecordId] = @RecordId

			;SET @Status = CASE WHEN COALESCE(@p_Delete, @False) = @True THEN 'deleted' ELSE 'archived' END
		END

		/****************************************************************************************
			DATASET 1: THE ANSWER.
		****************************************************************************************/
		;SELECT	[Json] = (	SELECT	 [status]	= @Status
									,[recordId]	= @RecordId
							FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES	)
	END TRY
	BEGIN CATCH
		/* Re-Raise so the Caller Never Reads Success From a Failed Write. */
		;THROW
	END CATCH
END
GO
