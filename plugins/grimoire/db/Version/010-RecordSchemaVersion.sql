/*********************************************************************************
	ROW: mem.SchemaVersion

	The version these scripts carry, written once and last. This is the final
	script of the final directory the installer applies, and the position is the
	contract: mem.SchemaVersion is what a client reads to decide the host holds
	this version's columns and procedures, so the row is true only once every
	one of them is on the host.

	A run that dies partway through therefore leaves the host at the version it
	held before, which is what a client's own version gate then reads, and the
	next installer run applies the rest and writes the row. Written with the
	table instead, the row would answer this version from the moment the schema
	directory ran: a client reading it would send what the new procedures take
	to the procedures of the old version, which take neither the columns nor the
	stamp ids that make a resent line insert once.

	The version arrives as the sqlcmd scripting variable KitSchemaVersion, which
	Install-MemoryDatabase.ps1 sets from its own constant, so the two surfaces
	cannot disagree.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	mem.SchemaVersion V
				WHERE	V.[Version] = $(KitSchemaVersion)  )
BEGIN
	;INSERT INTO mem.SchemaVersion (
		 [Version]
		,[Notes]		)
	SELECT	 [Version]	= $(KitSchemaVersion)
			,[Notes]	= N'A search or nearest row carries the record''s own machine scope: mem.udf_VisibleRecords projects mem.Record''s [Machine], and mem.usp_Search and mem.usp_Nearest return it as the row''s machine key beside the sandbox key, which names the sandbox that published the row, so memq labels a shared hit with the machine the record is scoped to rather than its publisher.'
END
GO
