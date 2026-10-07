/************************************************************************************************
*************************************************************************************************
	SCRIPT:		Security/010-Roles.sql
	AUTHOR:		Scott Applefeld
	DATE:		September 17th, 2026
	VERSION:	v1.6
*************************************************************************************************
	NOTES:		v1.6 - 10/06/2026 - SCOTT APPLEFELD
						mem_publisher gains EXECUTE on mem.usp_Recall, which ranks the
						caller's visible records for one prompt and returns each with a
						head of its body. mem_curator is denied it, since the curator
						never publishes.

				v1.5 - 10/05/2026 - SCOTT APPLEFELD
						mem_publisher gains EXECUTE on the metering procedures:
						mem.usp_AppendTurnMeter and mem.usp_PutSessionBeat, which write
						the caller's own sandbox's turn and beat rows, and
						mem.usp_ListDailyUsage, which sums every sandbox's token counts
						by day and returns counts and the names they are grouped by.
						mem_curator is denied all three, since the curator never
						publishes. mem_review reads mem.TurnMeter and mem.SessionBeat
						through its SELECT on the schema.

				v1.4 - 10/04/2026 - SCOTT APPLEFELD
						No grant changes. The schema holds no read log, so mem_review's
						SELECT reaches no record of the calls the read procedures serve.

				v1.3 - 10/03/2026 - SCOTT APPLEFELD
						mem_publisher gains EXECUTE on mem.usp_AdoptProjectStore, which moves
						a project's records from its folder-name store into its remote store,
						and mem_curator is denied it, since the curator never publishes.

				v1.2 - 10/03/2026 - SCOTT APPLEFELD
						mem_publisher gains EXECUTE on the record door: mem.usp_PutRecord,
						mem.usp_GetRecord, mem.usp_ListIndex and mem.usp_ArchiveRecord. Each
						resolves the caller's sandbox and refuses or answers nothing for an
						unmapped login. mem_curator is denied all four, since the curator
						never publishes.

				v1.1 - 09/23/2026 - SCOTT APPLEFELD
						mem_publisher gains EXECUTE on mem.usp_JevCalibration, the judged
						fleet pointer counts per score band. It is the one publisher read
						that filters on no sandbox, and it returns counts and no field of
						any record. mem_curator is denied it, as it is every other
						publisher-only procedure.

				v1.0 - 09/17/2026 - SCOTT APPLEFELD
						The three database roles of the shared memory index and what each
						may reach.

						mem_publisher is the sandbox identity: EXECUTE on the publish,
						journal and read procedures and nothing else. SELECT on the mem
						schema is denied outright, so a publisher that reaches a table
						directly is refused even where a later grant slips. Every table read
						the publisher needs runs inside a procedure, where ownership chaining
						(procedure and tables both owned by dbo, no module using EXECUTE AS)
						skips the table check, and every such procedure filters on the
						caller's sandbox before ranking.

						mem_curator is the operator's curation identity: EXECUTE on the
						promote and curation procedures and on the health report, SELECT
						denied the same way. The curator never publishes, so the publish
						and journal procedures are denied to it explicitly.

						mem_review is the audit identity: SELECT on the whole mem schema,
						which reaches every sandbox's private rows by design, and
						EXECUTE on nothing.

						GRANT and DENY are repeatable, so this script applies clean on every
						run; only the role creation is guarded.
*************************************************************************************************
************************************************************************************************/

-- Check for and Create the Roles.
;IF DATABASE_PRINCIPAL_ID('mem_publisher') IS NULL
	CREATE ROLE mem_publisher AUTHORIZATION dbo
GO

;IF DATABASE_PRINCIPAL_ID('mem_curator') IS NULL
	CREATE ROLE mem_curator AUTHORIZATION dbo
GO

;IF DATABASE_PRINCIPAL_ID('mem_review') IS NULL
	CREATE ROLE mem_review AUTHORIZATION dbo
GO

/************************************************************************************************
	MEM_PUBLISHER: EXECUTE ON THE PUBLISH, JOURNAL AND READ PROCEDURES; NO TABLE ACCESS.
************************************************************************************************/
;GRANT EXECUTE ON OBJECT::mem.usp_UpsertRecords		TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_ListRecords		TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_UpsertEmbeddings	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_AppendUsage		TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_AppendOutcomes	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_AppendPublishRun	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_UpsertIndexOrphans	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_Search			TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_Nearest			TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_Health			TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_JevCalibration	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_PutRecord		TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_GetRecord		TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_ListIndex		TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_ArchiveRecord	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_AdoptProjectStore	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_AppendTurnMeter	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_PutSessionBeat	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_ListDailyUsage	TO mem_publisher
;GRANT EXECUTE ON OBJECT::mem.usp_Recall			TO mem_publisher
GO

;DENY SELECT ON SCHEMA::mem TO mem_publisher
;DENY INSERT ON SCHEMA::mem TO mem_publisher
;DENY UPDATE ON SCHEMA::mem TO mem_publisher
;DENY DELETE ON SCHEMA::mem TO mem_publisher
GO

;DENY EXECUTE ON OBJECT::mem.usp_PromoteRecord			TO mem_publisher
;DENY EXECUTE ON OBJECT::mem.usp_CurationUnapplied		TO mem_publisher
;DENY EXECUTE ON OBJECT::mem.usp_CurationSupersededLive	TO mem_publisher
;DENY EXECUTE ON OBJECT::mem.usp_CurationOrphans		TO mem_publisher
GO

/************************************************************************************************
	MEM_CURATOR: EXECUTE ON PROMOTE, CURATION AND HEALTH; NO TABLE ACCESS, NO PUBLISHING.
************************************************************************************************/
;GRANT EXECUTE ON OBJECT::mem.usp_PromoteRecord			TO mem_curator
;GRANT EXECUTE ON OBJECT::mem.usp_CurationUnapplied		TO mem_curator
;GRANT EXECUTE ON OBJECT::mem.usp_CurationSupersededLive	TO mem_curator
;GRANT EXECUTE ON OBJECT::mem.usp_CurationOrphans		TO mem_curator
;GRANT EXECUTE ON OBJECT::mem.usp_Health				TO mem_curator
GO

;DENY SELECT ON SCHEMA::mem TO mem_curator
;DENY INSERT ON SCHEMA::mem TO mem_curator
;DENY UPDATE ON SCHEMA::mem TO mem_curator
;DENY DELETE ON SCHEMA::mem TO mem_curator
GO

;DENY EXECUTE ON OBJECT::mem.usp_UpsertRecords		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_ListRecords		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_UpsertEmbeddings	TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_AppendUsage		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_AppendOutcomes		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_AppendPublishRun	TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_UpsertIndexOrphans	TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_Search				TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_Nearest			TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_JevCalibration	TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_PutRecord		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_GetRecord		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_ListIndex		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_ArchiveRecord	TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_AdoptProjectStore	TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_AppendTurnMeter	TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_PutSessionBeat		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_ListDailyUsage		TO mem_curator
;DENY EXECUTE ON OBJECT::mem.usp_Recall				TO mem_curator
GO

/************************************************************************************************
	MEM_REVIEW: SELECT ON THE WHOLE SCHEMA, EXECUTE ON NOTHING.
************************************************************************************************/
;GRANT SELECT ON SCHEMA::mem TO mem_review
GO

;DENY EXECUTE ON SCHEMA::mem TO mem_review
;DENY INSERT ON SCHEMA::mem TO mem_review
;DENY UPDATE ON SCHEMA::mem TO mem_review
;DENY DELETE ON SCHEMA::mem TO mem_review
GO
