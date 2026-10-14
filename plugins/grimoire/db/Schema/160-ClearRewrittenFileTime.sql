/*********************************************************************************
	TABLE: mem.Record ([FileModifiedDt] cleared on rewritten rows)

	mem.usp_ListIndex reads a row's update time as COALESCE([FileModifiedDt],
	[UpdatedDt]). A host whose mem.usp_PutRecord is older than schema version 11
	rewrote a published row in place and kept the file time of its last
	publish, though no file holds the content memq wrote over it. Such a row
	lists that file time as its update time. This script writes NULL to
	[FileModifiedDt] on every such row, so the read falls to [UpdatedDt], the
	rewrite's own instant. Deleted and archived rows are included, since the
	column is as false on them.

	A row qualifies when [Origin] is memq, [FileModifiedDt] is set, and
	[UpdatedDt] is later than [LastPublishedDt]. mem.usp_PutRecord writes
	[UpdatedDt] and never [LastPublishedDt], so a memq rewrite after the last
	publish leaves the first later than the second. A changed row
	mem.usp_UpsertRecords writes in a sandbox's own project store takes the
	file time, [UpdatedDt] and [LastPublishedDt] from one instant and keeps
	its memq origin, so such a row keeps its file time here.

	Two shapes fall the other way. A row that publish stamps unchanged or
	older takes a new [LastPublishedDt] alone, so a stale row it stamped after
	the rewrite keeps its file time. A row mem.usp_AdoptProjectStore moves
	takes a new [UpdatedDt] alone, so a memq row a publish last wrote and an
	adoption then moved loses its file time. Both need a memq row in a
	sandbox's own store, and either costs only the instant the digest lists.

	The predicate makes the script a no-op on every run after the first, since
	a row it clears holds no file time, and on a database that holds no such
	row, which is every fresh install. It runs in the Schema directory, before
	the Procedures directory alters mem.usp_PutRecord, so a rewrite landing
	between the two steps on a host still running the older procedure keeps
	its file time until the next installer run.
*********************************************************************************/
;UPDATE R
SET		 [FileModifiedDt] = NULL
FROM	mem.Record R
WHERE	R.[Origin] = 'memq'
		AND R.[FileModifiedDt] IS NOT NULL
		AND R.[UpdatedDt] > R.[LastPublishedDt]
GO
