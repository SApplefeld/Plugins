/*********************************************************************************
	TABLE: mem.PublishRun (dropped)

	No procedure writes a publish run, since the migration publish that reported
	one left the kit, so the database keeps no publish-run table and this script
	drops it where a host still holds it. The drop takes the table's rows, its
	index, its check constraint and its foreign key to mem.Sandbox with it, and
	nothing the kit ships can restore them. mem.usp_Health no longer reads it,
	and the procedure that wrote it is dropped by its own script.

	The guard makes the script a no-op on a database that never held the
	table, which is every fresh install, and on every run after the first. It
	keeps the number the table's creation held, so an installed host and a
	fresh one converge on the same script list. It runs in the Schema
	directory, before the Procedures directory alters mem.usp_Health, so a
	health read landing between the two steps on a host that still runs the
	older procedure fails until the procedure step completes.
*********************************************************************************/
;IF OBJECT_ID('mem.PublishRun', 'U') IS NOT NULL
BEGIN
	;DROP TABLE mem.PublishRun
END
GO
