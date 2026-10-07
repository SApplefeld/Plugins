/*********************************************************************************
	TABLE: mem.QueryLog (dropped)

	No read procedure writes a log row, so the database keeps no read log and
	this script drops the table where a host still holds it. The drop takes the
	table's rows, its index and its foreign key to mem.Sandbox with it, and
	nothing the kit ships can restore them.

	The guard makes the script a no-op on a database that never held the
	table, which is every fresh install, and on every run after the first.
	It runs in the Schema directory, before the Procedures directory alters the
	read procedures, so a read landing between the two steps on a host that
	still runs the older procedures fails until the procedure step completes.
*********************************************************************************/
;IF EXISTS(	SELECT	NULL
			FROM	sys.schemas S
					LEFT JOIN sys.tables T
						ON S.[schema_id] = T.[schema_id]
			WHERE	S.[name] = 'mem'
					AND T.[name] = 'QueryLog'  )
BEGIN
	;DROP TABLE mem.QueryLog
END
GO
