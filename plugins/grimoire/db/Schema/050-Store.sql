/*********************************************************************************
	TABLE: mem.Store

	One row per memory store. A project store is the fleet's, keyed by the
	project key alone, so every sandbox reads and writes the same project's
	records; a project store that belongs to one sandbox and names a path
	segment is the older shape, which a version 6 client still publishes into
	and which keeps its rows. A type store belongs to the fleet and names the
	type; the operator store belongs to the fleet and names nothing. A NULL
	[SandboxId] is the fleet, by meaning and not by absence, and the shape
	check below refuses a row whose tier and nullability disagree.

	TIER VALUES (fixed, lowercase):
		project		A project's fleet store: [SandboxId] NULL, [Segment] NULL, [ProjectKey] set.
					Or one sandbox's older store: [SandboxId] set, [Segment] the project
					path, [ProjectKey] NULL.
		type		A shared type store; [SandboxId] NULL, [Segment] the type name.
		operator	The shared operator store; [SandboxId] NULL, [Segment] NULL.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'Store'  )
BEGIN
	;CREATE TABLE mem.Store (
		 [StoreId]				INT				NOT NULL	IDENTITY(1,1)

		/* Identity Fields */
		,[SandboxId]			INT				NULL
		,[Tier]					VARCHAR(20)		NOT NULL
		,[Segment]				NVARCHAR(400)	NULL
		,[ProjectKey]			NVARCHAR(400)	NULL

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- CHECK CONSTRAINTS.
		,CONSTRAINT		CK_Store_Tier
						CHECK ( [Tier] IN ('project', 'type', 'operator') )
		,CONSTRAINT		CK_Store_TierShape
						CHECK (	(	[Tier] = 'project'
									AND [SandboxId] IS NULL
									AND [Segment] IS NULL
									AND [ProjectKey] IS NOT NULL	)
								OR (	[Tier] = 'project'
										AND [SandboxId] IS NOT NULL
										AND [Segment] IS NOT NULL
										AND [ProjectKey] IS NULL	)
								OR (	[Tier] = 'type'
										AND [SandboxId] IS NULL
										AND [Segment] IS NOT NULL
										AND [ProjectKey] IS NULL	)
								OR (	[Tier] = 'operator'
										AND [SandboxId] IS NULL
										AND [Segment] IS NULL
										AND [ProjectKey] IS NULL	)	)

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_Store_Sandbox
						FOREIGN KEY	( [SandboxId] )
						REFERENCES	mem.Sandbox ( [SandboxId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_Store
						PRIMARY KEY	CLUSTERED	( [StoreId] )
	)
END
GO

-- Check for and Add ProjectKey to a Table That Predates It.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.columns C
				WHERE	C.[object_id] = OBJECT_ID('mem.Store')
						AND C.[name] = 'ProjectKey' )
BEGIN
	;ALTER TABLE mem.Store ADD [ProjectKey] NVARCHAR(400) NULL
END
GO

-- Drop the Shape Check Where a Host Still Carries the Shape That Names No Project Key.
;IF EXISTS(	SELECT	NULL
			FROM	sys.check_constraints K
			WHERE	K.[parent_object_id] = OBJECT_ID('mem.Store')
					AND K.[name] = 'CK_Store_TierShape'
					AND K.[definition] NOT LIKE '%ProjectKey%' )
BEGIN
	;ALTER TABLE mem.Store DROP CONSTRAINT CK_Store_TierShape
END
GO

-- Check for and Create CK_Store_TierShape. Every Row a Version 6 Host Holds Passes It, so the Check Runs Over Them.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.check_constraints K
				WHERE	K.[parent_object_id] = OBJECT_ID('mem.Store')
						AND K.[name] = 'CK_Store_TierShape' )
BEGIN
	;ALTER TABLE mem.Store WITH CHECK ADD CONSTRAINT CK_Store_TierShape
		CHECK (	(	[Tier] = 'project'
					AND [SandboxId] IS NULL
					AND [Segment] IS NULL
					AND [ProjectKey] IS NOT NULL	)
				OR (	[Tier] = 'project'
						AND [SandboxId] IS NOT NULL
						AND [Segment] IS NOT NULL
						AND [ProjectKey] IS NULL	)
				OR (	[Tier] = 'type'
						AND [SandboxId] IS NULL
						AND [Segment] IS NOT NULL
						AND [ProjectKey] IS NULL	)
				OR (	[Tier] = 'operator'
						AND [SandboxId] IS NULL
						AND [Segment] IS NULL
						AND [ProjectKey] IS NULL	)	)
END
GO

-- Drop IX_Store_SandboxId_Tier_Segment Where It Still Covers the Fleet's Project Stores.
-- Every Fleet Project Store Reads (NULL, project, NULL) on That Key, so the Index is Filtered to the Rows With No Project Key.
;IF EXISTS(	SELECT	NULL
			FROM	sys.indexes I
			WHERE	I.[object_id] = OBJECT_ID('mem.Store')
					AND I.[name] = 'IX_Store_SandboxId_Tier_Segment'
					AND I.[has_filter] = 0 )
BEGIN
	;DROP INDEX IX_Store_SandboxId_Tier_Segment ON mem.Store
END
GO

-- Check for and Create IX_Store_SandboxId_Tier_Segment. A Unique Index Treats NULL as One
-- Value, so the Fleet Holds One Store per Type and One Operator Store.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.Store')
						AND I.[name] = 'IX_Store_SandboxId_Tier_Segment' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_Store_SandboxId_Tier_Segment
		ON mem.Store (	 [SandboxId]
						,[Tier]
						,[Segment]	)
		WHERE [ProjectKey] IS NULL
END
GO

-- Check for and Create IX_Store_Tier_ProjectKey. The Fleet Holds One Store per Project Key.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.Store')
						AND I.[name] = 'IX_Store_Tier_ProjectKey' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_Store_Tier_ProjectKey
		ON mem.Store (	 [Tier]
						,[ProjectKey]	)
		WHERE [ProjectKey] IS NOT NULL
END
GO
