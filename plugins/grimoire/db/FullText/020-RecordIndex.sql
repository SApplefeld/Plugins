/*********************************************************************************
	FULL-TEXT INDEX: mem.Record ([Description], [Body])

	One index over both text columns, keyed on PK_Record, populated by change
	tracking so a published row becomes searchable without a manual population.
*********************************************************************************/

-- Check for and Create the Full-Text Index on mem.Record.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.fulltext_indexes FI
				WHERE	FI.[object_id] = OBJECT_ID('mem.Record')  )
	CREATE FULLTEXT INDEX ON mem.Record (	 [Description]
											,[Body]		)
		KEY INDEX PK_Record
		ON KitMemoryCatalog
		WITH CHANGE_TRACKING AUTO
GO
