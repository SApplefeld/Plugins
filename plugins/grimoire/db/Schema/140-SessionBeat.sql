/*********************************************************************************
	TABLE: mem.SessionBeat

	One row per session, saying when the session was last alive: its persona,
	its working directory, the time of its last beat, the last turn it ended
	and whether a turn was open at that beat. It is a copy for reading across
	machines. Each machine's supervisor keeps reading its own heartbeat file
	for liveness, and nothing here takes that file's place.

	mem.usp_PutSessionBeat is the only writer. It upserts by sandbox and
	session id and keeps the later beat, so a beat that arrives after a newer
	one changes nothing. The sandbox is the caller's, resolved from its login,
	so one sandbox's row never takes the place of another's.
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = 'mem'
						AND T.[name] = 'SessionBeat'  )
BEGIN
	;CREATE TABLE mem.SessionBeat (
		/* Identity Fields */
		 [SandboxId]			INT				NOT NULL
		,[SessionId]			NVARCHAR(100)	NOT NULL
		,[Persona]				NVARCHAR(200)	NULL
		,[WorkingDirectory]		NVARCHAR(400)	NULL

		/* Beat Fields */
		,[LastBeatDt]			DATETIMEOFFSET	NOT NULL
		,[LastTurnId]			NVARCHAR(200)	NULL
		,[TurnOpen]				BIT				NOT NULL	DEFAULT(0)

		/* Audit Fields */
		,[CreatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]			DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- FOREIGN KEYS.
		,CONSTRAINT		FK_SessionBeat_Sandbox
						FOREIGN KEY	( [SandboxId] )
						REFERENCES	mem.Sandbox ( [SandboxId] )

		-- PRIMARY KEY.
		,CONSTRAINT		PK_SessionBeat
						PRIMARY KEY	CLUSTERED	( [SandboxId], [SessionId] )
	)
END
GO
