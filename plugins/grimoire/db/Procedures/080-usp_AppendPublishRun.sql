/*********************************************************************************
	PROCEDURE: mem.usp_AppendPublishRun (dropped)

	The procedure recorded one publisher run in mem.PublishRun for the
	migration publish, which left the kit, so no client calls it and
	Schema/100-PublishRun.sql drops the table it wrote. This script drops the
	procedure where a host still holds it, and Security/010-Roles.sql no longer
	grants or denies it.

	The guard makes the script a no-op on a database that never held the
	procedure, which is every fresh install, and on every run after the first.
	It keeps the number the procedure's creation held, so an installed host and
	a fresh one converge on the same script list.
*********************************************************************************/
;IF OBJECT_ID('mem.usp_AppendPublishRun', 'P') IS NOT NULL
BEGIN
	;DROP PROCEDURE mem.usp_AppendPublishRun
END
GO
