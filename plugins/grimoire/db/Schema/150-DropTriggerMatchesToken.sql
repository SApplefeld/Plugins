/*********************************************************************************
	FUNCTION: mem.udf_TriggerMatchesToken (dropped)

	mem.usp_Recall matches a cmd: trigger by containment and calls no token
	function, so the database keeps none, and this script drops the function
	where a host still holds it. The installer applies what is on disk and
	removes nothing it no longer ships, so a host installed with the function
	keeps it until this script runs.

	The guard makes the script a no-op on a database that never held the
	function, which is every fresh install, and on every run after the first.
	It runs in the Schema directory, before the Procedures directory alters
	mem.usp_Recall, so a recall landing between the two steps on a host that
	still runs the older procedure, which calls the function, fails until the
	procedure step completes.
*********************************************************************************/
;IF OBJECT_ID('mem.udf_TriggerMatchesToken') IS NOT NULL
BEGIN
	;DROP FUNCTION mem.udf_TriggerMatchesToken
END
GO
