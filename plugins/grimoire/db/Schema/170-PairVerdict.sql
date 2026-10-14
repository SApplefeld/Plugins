/*********************************************************************************
	TABLE: mem.PairVerdict

	One row per pair of records a session judged to be two different facts,
	keyed on the store and the two record names, [NameA] the lower of the two
	under the database's collation. [Verdict] holds 'two-facts', the one value
	its check admits. [JudgedDt] is when the pair was last judged and
	[JudgedBySandboxId] the sandbox that judged it.

	mem.usp_PutPairVerdict is the only writer. It writes a pair only where both
	names resolve to live, unarchived rows of the store, and a second verdict on
	the same pair, in either name order, moves the one row's judged time.
	mem.usp_ListPairVerdicts serves a verdict only while both of its records
	stand live, unarchived and undeleted, neither rewritten after [JudgedDt], so
	a rewrite or a retirement of either record lapses the verdict and no row is
	ever removed for it.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'PairVerdict'  )
BEGIN
	;CREATE TABLE mem.PairVerdict (
		/* Identity Fields */
		 [StoreId]				INT				NOT NULL
		,[NameA]				NVARCHAR(200)	NOT NULL
		,[NameB]				NVARCHAR(200)	NOT NULL

		/* Verdict Fields */
		,[Verdict]				VARCHAR(20)		NOT NULL
		,[JudgedDt]				DATETIMEOFFSET	NOT NULL
		,[JudgedBySandboxId]	INT				NOT NULL

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- CHECK CONSTRAINTS.
		,CONSTRAINT		CK_PairVerdict_Verdict
						CHECK ( [Verdict] = 'two-facts' )
		,CONSTRAINT		CK_PairVerdict_NameOrder
						CHECK ( [NameA] < [NameB] )

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_PairVerdict_Store
						FOREIGN KEY	( [StoreId] )
						REFERENCES	mem.Store ( [StoreId] )
		,CONSTRAINT		FK_PairVerdict_Sandbox
						FOREIGN KEY	( [JudgedBySandboxId] )
						REFERENCES	mem.Sandbox ( [SandboxId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_PairVerdict
						PRIMARY KEY	CLUSTERED	( [StoreId], [NameA], [NameB] )
	)
END
GO
