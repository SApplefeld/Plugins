/*********************************************************************************
	TABLE: mem.TurnMeter

	One row per model turn a session ran, as the persona module metered it at
	the turn's end: the session and turn it was, the persona, the goal-tree
	entry and plan document the turn worked on, what opened the turn, the model
	that answered and its four token counts, how many judge calls the turn's
	decision journal recorded and their summed latency, and when the turn
	started and ended. A turn the engine reported no usage for carries NULL in
	the model and the four counts.

		[TurnId]			The engine's turn id. A subagent loop's turn takes
							the turn id with its agent id after a slash, so
							a subagent's run never collides with the turn
							that spawned it.
		[Trigger]			What opened the turn, as the module's turn record
							names it: nudge, delivery, plugin, proposal,
							memoryCheck or unaccounted.

	The row is unique on its sandbox, session id and turn id, so a batch sent
	again inserts nothing it already holds, and one sandbox's row never takes
	the place of another's. mem.usp_AppendTurnMeter is the only writer, and the
	sandbox is the caller's, resolved from its login.
	mem.usp_ListDailyUsage sums the token counts by UTC day, sandbox, persona
	and plan path across every sandbox.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'TurnMeter'  )
BEGIN
	;CREATE TABLE mem.TurnMeter (
		 [TurnMeterId]			BIGINT			NOT NULL	IDENTITY(1,1)

		/* Identity Fields */
		,[SandboxId]			INT				NOT NULL
		,[SessionId]			NVARCHAR(100)	NOT NULL
		,[TurnId]				NVARCHAR(200)	NOT NULL

		/* Turn Fields */
		,[Persona]				NVARCHAR(200)	NULL
		,[GoalId]				NVARCHAR(100)	NULL
		,[PlanPath]				NVARCHAR(400)	NULL
		,[Trigger]				VARCHAR(40)		NULL
		,[Model]				NVARCHAR(200)	NULL

		/* Token Fields */
		,[InputTokens]			BIGINT			NULL
		,[OutputTokens]			BIGINT			NULL
		,[CacheReadTokens]		BIGINT			NULL
		,[CacheCreationTokens]	BIGINT			NULL

		/* Judge Fields */
		,[JevCalls]				INT				NULL
		,[JevLatencyMs]			BIGINT			NULL

		/* Time Fields */
		,[StartedDt]			DATETIMEOFFSET	NULL
		,[EndedDt]				DATETIMEOFFSET	NOT NULL

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_TurnMeter_Sandbox
						FOREIGN KEY	( [SandboxId] )
						REFERENCES	mem.Sandbox ( [SandboxId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_TurnMeter
						PRIMARY KEY	CLUSTERED	( [TurnMeterId] )
	)
END
GO

-- Check for and Create IX_TurnMeter_SandboxId_SessionId_TurnId.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.TurnMeter')
						AND I.[name] = 'IX_TurnMeter_SandboxId_SessionId_TurnId' )
BEGIN
	;CREATE UNIQUE NONCLUSTERED INDEX IX_TurnMeter_SandboxId_SessionId_TurnId
		ON mem.TurnMeter (	 [SandboxId]
							,[SessionId]
							,[TurnId]	)
END
GO

-- Check for and Create IX_TurnMeter_EndedDt.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('mem.TurnMeter')
						AND I.[name] = 'IX_TurnMeter_EndedDt' )
BEGIN
	;CREATE NONCLUSTERED INDEX IX_TurnMeter_EndedDt
		ON mem.TurnMeter (	 [EndedDt]	)
		INCLUDE (	 [SandboxId]
					,[Persona]
					,[PlanPath]
					,[InputTokens]
					,[OutputTokens]
					,[CacheReadTokens]
					,[CacheCreationTokens]	)
END
GO
