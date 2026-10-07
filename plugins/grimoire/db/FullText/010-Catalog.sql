/*********************************************************************************
	FULL-TEXT CATALOG: KitMemoryCatalog

	Backs the full-text index on mem.Record.Description and mem.Record.Body.
	Requires the Full-Text Search feature on the instance
	(FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') = 1), which the installer
	checks before it applies anything.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.fulltext_catalogs C
				WHERE	C.[name] = 'KitMemoryCatalog'  )
	CREATE FULLTEXT CATALOG KitMemoryCatalog AS DEFAULT
GO
