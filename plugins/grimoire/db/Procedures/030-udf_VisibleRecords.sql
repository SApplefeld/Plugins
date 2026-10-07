-- DROP AND RE-CREATE THE FUNCTION.
;IF OBJECT_ID('mem.udf_VisibleRecords') IS NOT NULL
  EXEC ('DROP FUNCTION mem.udf_VisibleRecords;')
GO

;CREATE FUNCTION mem.udf_VisibleRecords
(
	@p_SandboxId	INT
)
RETURNS TABLE
AS
RETURN
(
	/********************************************************************************************
	*********************************************************************************************
		SCRIPT:		mem.udf_VisibleRecords
		AUTHOR:		Scott Applefeld
		DATE:		September 17th, 2026
		VERSION:	v1.1
	*********************************************************************************************
		NOTES:		v1.1 - 10/03/2026 - SCOTT APPLEFELD
							Every undeleted row is served to every mapped sandbox, a private
							row of another sandbox's older project store included, since a
							project's records are the fleet's and not one machine's. A NULL
							@p_SandboxId still returns no rows. The row carries its store's
							[ProjectKey] and the record fields mem.usp_GetRecord and
							mem.usp_ListIndex project. A caller that writes against a record
							id, or lists what it may embed or remove, narrows this answer to
							its own project rows itself.

					v1.0 - 09/17/2026 - SCOTT APPLEFELD
							The one statement of what a publisher may see, never a row
							carrying a deleted mark. A NULL @p_SandboxId returns no rows,
							so an unmapped login is fail-closed inside the predicate itself and
							not by each caller remembering to check. Every publisher read and
							every publisher write that takes a record id filters through this
							function before it ranks or writes.
	*********************************************************************************************
	********************************************************************************************/
	SELECT	 [RecordId]					= R.[RecordId]
			,[StoreId]					= R.[StoreId]
			,[Tier]						= S.[Tier]
			,[Segment]					= S.[Segment]
			,[ProjectKey]				= S.[ProjectKey]
			,[StoreSandboxId]			= S.[SandboxId]
			,[Name]						= R.[Name]
			,[FileKey]					= R.[FileKey]
			,[Description]				= R.[Description]
			,[Body]						= R.[Body]
			,[Tags]						= R.[Tags]
			,[SupersedesName]			= R.[SupersedesName]
			,[Author]					= R.[Author]
			,[IsArchived]				= R.[IsArchived]
			,[Space]					= R.[Space]
			,[Triggers]					= R.[Triggers]
			,[Anchors]					= R.[Anchors]
			,[IsPinned]					= R.[IsPinned]
			,[CreatedOn]				= R.[CreatedOn]
			,[Origin]					= R.[Origin]
			,[Visibility]				= R.[Visibility]
			,[LastPublishedBySandboxId]	= R.[LastPublishedBySandboxId]
			,[WrittenBySandboxId]		= R.[WrittenBySandboxId]
			,[CreatedDt]				= R.[CreatedDt]
			,[UpdatedDt]				= R.[UpdatedDt]
	FROM	mem.Record R
			INNER JOIN mem.Store S
				ON S.[StoreId] = R.[StoreId]
	WHERE	@p_SandboxId IS NOT NULL
			AND R.[DeletedDt] IS NULL
)
GO
