/*********************************************************************************
	SCHEMA: mem

	Owned by dbo so ownership chaining covers every table read a mem procedure
	makes. No procedure or function in this schema carries WITH EXECUTE AS; the
	execute-only roles in Security/ reach the tables through chaining alone.
*********************************************************************************/
;IF NOT EXISTS (	SELECT	NULL
					FROM	sys.schemas S
					WHERE	S.[name] = 'mem'  )
	EXEC ('CREATE SCHEMA mem AUTHORIZATION dbo;')
GO
