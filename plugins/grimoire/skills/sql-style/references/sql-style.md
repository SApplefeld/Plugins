# SQL Style Reference

This is the T-SQL pattern reference for my style, modeled on a numbered-folder deployment-script library. `<schema>`, `usp_AuditError` and `WITH EXECUTE AS '<schema_owner>'` are one project's names, so substitute the project's own names rather than copying them. Inside such a repo, open a sibling file in that library and follow its layout exactly.

## 1. Folders and File Names

The library uses numeric prefixes to enforce execution order during deployment:

| Folder | Contents |
| --- | --- |
| `0-Client` | Client-specific configuration, customization, and report jobs |
| `3-Tables` | `CREATE TABLE` scripts with primary-key and index DDL |
| `4-Functions` | `udf_*` user-defined functions |
| `5-Procedures` | `usp_*` stored procedures |
| `9-System` | System / TMS-specific procedures |
| `Database` | Bootstrap install scripts (a vendor database, LoadMaster, TL2000) |

Folder gaps (1, 2, 6, 7, 8) are reserved for potential future categories - leave them open.

Files are named `<schema>.<object>.sql`, and table files omit the type prefix: `<schema>.usp_GetBackgroundMessages.sql` beside `<schema>.ApiCalls.sql`. Helper sub-procedures of a parent use `_Data`, `_Sort`, `_Stops`, `_Trips`.

## 2. Procedure Deployment

**Always shell-then-ALTER**, never `CREATE OR ALTER PROCEDURE`, as the §19 template shows.

- Indent the shell `EXEC` line 2 spaces, not a tab.
- `WITH EXECUTE AS '<schema_owner>'` goes before `AS` only where the project uses owner-impersonation. There it goes on every proc and on scalar or multi-statement functions. Drop it where the codebase does not impersonate. It is invalid on inline table-valued functions (`RETURNS TABLE ... AS RETURN`), so never put it there.
- `BEGIN	-- PROCEDURE` takes a tab before its label comment.
- The file ends with `GO` after the `END`.

## 3. Function Deployment

Functions use **drop-and-recreate**, as the §21 template shows. A scalar function puts `RETURN` on its own line before the expression. An inline TVF uses `RETURN ( ... query ... )`.

## 4. Table Deployment

Tables guard with a **defensive existence check on `sys.schemas` joined to `sys.tables`**, not just `OBJECT_ID`, as the §20 template shows.

- Start with the `/* TABLE: <Name> */` banner comment.
- Wrap the semicolon-led `;CREATE TABLE` in `BEGIN` and `END`.
- The first column takes a leading space before `[`, and each later column a leading comma.
- Tab-align name → type → nullability → default.
- Group related columns under `/* Group Name */` comments, such as Request Fields or Audit Fields. Put a blank line between groups.
- **Audit fields** `CreatedDt` and `UpdatedDt` go at the bottom, defaulted to `SYSDATETIMEOFFSET()`, not `GETDATE()`.
- Default constraints are inline `DEFAULT(...)`, never named.
- Computed columns use `AS ( expression ) PERSISTED`.
- The PK comes last as `PK_<TableName>`, its name on its own line and `PRIMARY KEY CLUSTERED ( [Col] )` indented under it.

## 5. Index Deployment

Indexes live in their table's file. Each sits in its own `IF NOT EXISTS` block, as the end of the §20 template shows.

- Check `sys.indexes` with `OBJECT_ID(...)` and `[name] = '...'`.
- Lay out the column list inside `( ... )` per §12.
- Introduce the block with `-- Check for and Create <IndexName>.`

## 6. Procedure Header Banner

Every procedure carries the metadata banner the §19 template shows, inside `BEGIN -- PROCEDURE`, giving its purpose, author, version and history. Never skip it.

- A doubled asterisk row of about 92, counted by eye, opens and closes it, and one row separates VERSION from NOTES.
- DATE is **ordinal English** ("February 16th, 2025", not "2025-02-16").
- Each NOTES entry leads with `vN.N - MM/DD/YYYY - AUTHOR NAME - COMPANY`, its body indented under it.
- AUTHOR is `<Author Name>` or `<Author Name> / <Company>`.
- A version bump **adds** a note line above the last one. Never rewrite history.

## 7. Parameter Declarations

Parameters sit in parentheses after the procedure name, headed by a comment row naming the columns, as the §19 template shows.

- Tab-align name → type → default.
- Default to `= NULL`, with `= 0` for counts and numerics and `= 1` for "on" flags.
- `OUTPUT` parameters are rare and go last.
- Table-valued parameters take `READONLY`: `@p_FormData <schema>.FormFieldType READONLY`.
- The closing `)` and `WITH EXECUTE AS '<schema_owner>'` sit at the signature column.

Older procedures such as `usp_GetBackgroundMessages` omit the parentheses and keep the comment row. Both styles are fine, so **match the surrounding files**.

## 8. SET Statements

Every procedure body opens with a banner section holding two paired, semicolon-led SET statements, as the §19 template shows.

- **`SET NOCOUNT ON`** is mandatory.
- **`SET TRANSACTION ISOLATION LEVEL`** is `READ UNCOMMITTED` for read-heavy procs and the default for `Get*`. It is `READ COMMITTED` for write, transactional and audit procs, and the default for `Save*` and `Process*`.
- The banner names their purpose in its own words, such as "SET PROCESSING VARIABLES TO SUPPRESS OUTPUT."

`SET XACT_ABORT` is **not used**. TRY/CATCH handles errors.

## 9. Variable Declarations

Variables go in `;DECLARE` blocks grouped by purpose, as the §19 template shows.

- One `;DECLARE` opens a block, and later variables continue with a leading comma.
- Tab-align name → type → default.
- A procedure with conditional logic declares `@True BIT = 1` and `@False BIT = 0` at the top and uses them instead of literal 1 and 0.
- Locals are plain `@PascalCase`, with no `@v_` or `@local_` prefix.
- A local never takes `@p_`. That prefix is reserved for parameters.
- Many distinct variable groups take several `;DECLARE` blocks, each with its own banner.

## 10. Section Banners

Every logical phase of the body opens with a section banner. The standard phases, in order:

1. SET PROCESSING VARIABLES…
2. DECLARE VARIABLES FOR PROCESSING.
3. TEMPORARY TABLES (if needed)
4. RETRIEVE/POPULATE BASE DATA
5. VALIDATION / GUARD CHECKS
6. MAIN LOGIC (often subdivided by entity: `MESSAGE FIELDS`, `STOPS`, `TRIPS`, etc.)
7. OUTPUT RESULT SETS / DATASETS (often labeled `DATASET 1: ...`, `DATASET 2: ...`)
8. CLEANUP / FINALIZATION

```sql
    /********************************************************************************************
        DATASET 1: MESSAGE HEADER
    ********************************************************************************************/			
```

The title is uppercase, with a period where it is an imperative sentence and none where it is a label, per §17. The asterisk lines are 92 characters wide. The title sits one space plus a tab inside.

Sub-sections take a single-line `/* Sub-Section Title. */` comment ending in a period, in the §17 comment voice.

## 11. TRY/CATCH and Error Logging

Every non-trivial procedure wraps its main logic in `BEGIN TRY` / `BEGIN CATCH`, as the §19 template shows. The CATCH logs through `usp_AuditError` and does **not** re-throw, so the caller does not fail.

- `;BEGIN TRY`, `END TRY`, `BEGIN CATCH` and `END CATCH` each take their own line.
- Guard the logging call with `IF (OBJECT_ID('<schema>.usp_AuditError') IS NOT NULL)`.
- `END ELSE BEGIN` sits on one line, one space each side of `ELSE`.
- `THROW` is rare, for a nested CATCH whose error must propagate.

## 12. Leading Commas and Tabs

Every list that wraps across lines takes the leading-comma layout below: parameters, variables, SELECT, INSERT and temp-table columns, VALUES rows, UPDATE SET clauses, and ORDER BY, GROUP BY and PARTITION BY.

**The first item takes a leading space, and each later item a leading comma** aligned under the one above.

```sql
;SELECT	 [MessageId]			= M.[MessageId]
        ,[Handle]				= M.[Handle]
        ,[ThreadHandle]			= RTRIM(H.[ThreadHandle])
```

Tabs, never spaces, do the alignment, and one tab is 4 columns.

**Always bracket column names as `[...]`**, even where not needed, for visual consistency.

## 13. SELECT, INSERT and UPDATE

- Output columns always take the left-hand `[Alias] = expression` form.
- Tables in FROM/JOIN take a short alias with no `AS`:
  ```sql
  FROM <schema>.DocumentHistory H
       LEFT JOIN <schema>.DocumentFields F
           ON H.[DocumentId] = F.[DocumentId]
  ```
- Aliases are single letters (`H`, `F`, `D`, `S`), or mnemonics on a collision (`LD` for Loads, `ST` for Stops).
- **Never `SELECT *`** in a production result set returned to callers. It is allowed only in `SELECT * INTO #TempTable FROM <schema>.udf_X(...)`, where the source schema is controlled.

**INSERT:**

```sql
;INSERT INTO <schema>.APICalls ( 
     [RequestMethod]
    ,[RequestUri]
    ,[RequestBody]
    ,[RequestDt]
    ,[CreatedDt]
    ,[UpdatedDt]				)
SELECT	 [RequestMethod]	= COALESCE(@p_RequestMethod, '')
        ,[RequestUri]		= COALESCE(@p_RequestUri, '')
        ,[RequestBody]		= COALESCE(@p_RequestBody, '')
        ,[RequestDt]		= COALESCE(@p_RequestDt, NULL)
        ,[CreatedDt]		= SYSDATETIMEOFFSET()
        ,[UpdatedDt]		= SYSDATETIMEOFFSET()
```

The column list's closing `)` sits right, after a tab. The SELECT feeding it uses the regular `[Alias] = value` form.

**UPDATE:**

```sql
;UPDATE C
SET		 [RequestMethod]	= COALESCE(@p_RequestMethod, C.[RequestMethod])
        ,[RequestUri]		= COALESCE(@p_RequestUri, C.[RequestUri])
        ,[UpdatedDt]		= SYSDATETIMEOFFSET()
FROM	<schema>.APICalls C
WHERE	C.[ApiCallId] = @p_ApiCallId
```

`;UPDATE` leads with a semicolon. `SET` stands alone, with a leading space before the first assignment. `FROM` and `WHERE` align with `SET`.

**Upsert:** `IF (@p_Id > 0) BEGIN /* update */ END ELSE BEGIN /* insert; SCOPE_IDENTITY() */ END`, as in `usp_AuditApiCall`.

## 14. JOINs and CTEs

- Write `LEFT JOIN`, not `LEFT OUTER JOIN`, and `INNER JOIN`, not bare `JOIN`.
- Wrap a multi-condition `ON` in parentheses where it aids clarity, with the `AND`s aligned:
  ```sql
  LEFT JOIN <schema>.HCPEOPLE H
      ON (		H.[Id] = TRY_PARSE(@p_UserName AS INT)
            AND H.[EmployeeStatusCode] = 'A' )
          OR	H.[DriverId] = @p_UserName
  ```
- **OUTER APPLY** is used freely for correlated subqueries, especially in table-valued functions.
- Lead CTEs with `;WITH`.
- Lay each body `( ... )` out as a standard SELECT.
- Chain CTEs with `,` then `cte<Name> AS ( ... )`.
- Recursive CTEs are fine for geographic or hierarchical traversal.

## 15. String, Date, Null Functions

- **CONCAT** over `+`. It is null-safe.
- **COALESCE** over `ISNULL` for defaulting, especially with 3+ fallbacks.
- **`IS NULL`** for existence checks in WHERE.
- **TRY_PARSE / TRY_CONVERT** for safe casts, which return NULL on failure.
- **FORMAT** for user-facing strings, such as `FORMAT(@Date, 'dddd, MMMM d, yyyy, h:mm tt')`.
- **CONVERT** for internal conversions. It outperforms FORMAT.
- **SYSDATETIMEOFFSET()** for audit timestamps, over `GETDATE()`.
- **GETDATE()** only for transient or comparison logic where timezone does not matter.

## 16. Temp Tables

- Check existence first, whatever creates the table: `IF (OBJECT_ID('tempdb..#Name') IS NULL)`.
- Comment the purpose: `/* Make Table to Track the Messages to Resend. */`.
- A temp table shared with nested EXEC calls is declared in the outer procedure, relying on temp-table scoping.
- `SELECT INTO #Name FROM ...` is fine to inherit the schema of a function or query.

## 17. Comment Styles

| Style | Use |
| --- | --- |
| `/********** TITLE **********/` (banner) | Major section dividers inside a procedure |
| `/* Sub-section Title. */` | Single-line block comments for smaller groupings; **end with period** |
| `/* Group Name */` (no period) | Group dividers inside a CREATE TABLE column list |
| `-- Comment.` | Inline comments and labels above blocks; **end with period** |
| `-- TITLE.` | Top-of-file pre-banner comments (e.g. `-- CREATE A SHELL PROCEDURE IF NONE EXISTS.`) |

**A comment that is a sentence ends with a period, and a label or title does not.** So `/* Request Fields */` takes none and `/* Validate Upsert Operation. */` takes one. Banner titles follow the same rule.

Sentence comments, the `/* Sub-Section Title. */` blocks and inline `-- Comment.` lines, are short imperative statements of what the next block does. A WHY comment is rare, and no comment carries history, under the doctrine's "Documents ship the current state" rule.

## 18. Naming Conventions

| Object | Pattern | Example |
| --- | --- | --- |
| Schema | `<schema>` (single schema) | `<schema>.usp_GetLoads` |
| Table | PascalCase, no prefix | `ApiCalls`, `WorkflowReport` |
| Procedure | `usp_<PascalCase>` | `usp_GetBackgroundMessages` |
| Function | `udf_<PascalCase>` | `udf_DocumentFields` |
| Trigger / Job | `JOB.<schema>.<Name>` | `JOB.<schema>.WorkflowReport` |
| Parameter | `@p_<PascalCase>` | `@p_ApiCallId` |
| Primary key | `PK_<TableName>` | `PK_ApiCalls` |
| Index | `IX_<TableName>_<ColList>` | `IX_ApiCalls_RequestUriDate` |
| Type | `<schema>.<PascalCase>` | `<schema>.FormFieldType` |
| Temp table | `#<PascalCase>` | `#Loads`, `#ResendMessages` |
| CTE | `cte<PascalCase>` | `cteStopSequences` |

**Procedure suffix conventions:**
- `_Default` - default variant (e.g. `usp_GetDocumentXML_Default`)
- `_Maintenance`, `_Trailers` - domain-specific variants
- `_TMS` - TMS-specific entry point (lives in `9-System/`)
- `_Debug` - debugging counterpart of a procedure
- `_Custom_<Vendor>` - client/vendor-specific custom processing

## 19. Full Procedure Template

A new procedure in `5-Procedures/` starts from this skeleton:

```sql
-- CREATE A SHELL PROCEDURE IF NONE EXISTS.
;IF OBJECT_ID('<schema>.usp_DoSomething') IS NULL
  EXEC ('CREATE PROCEDURE <schema>.usp_DoSomething AS RETURN 0;')
GO

-- ALTER THE UPDATED PROCEDURE DEFINITION.
;ALTER PROCEDURE <schema>.usp_DoSomething
(
    /*********************************************************************************************
     PARAMETER NAME		DATATYPE			DEFAULT
    *********************************************************************************************/
     @p_OrderNumber		INT					= NULL
    ,@p_DriverCode		VARCHAR(50)			= NULL
)
WITH EXECUTE AS '<schema_owner>'
AS
BEGIN	-- PROCEDURE

    /********************************************************************************************
    *********************************************************************************************
        SCRIPT:		<schema>.usp_DoSomething
        AUTHOR:		<Author Name>
        DATE:		<Month DDth, YYYY>
        VERSION:	v1.0
    *********************************************************************************************
        NOTES:		v1.0 - <MM/DD/YYYY> - <AUTHOR NAME> - <COMPANY>
                            <Description of what this procedure does and why it exists.>
    *********************************************************************************************
    ********************************************************************************************/
    
    /********************************************************************************************
        SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS.
    ********************************************************************************************/
    ;SET NOCOUNT ON
    ;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED
    
    /********************************************************************************************
        DECLARE VARIABLES FOR PROCESSING.
    ********************************************************************************************/
    ;DECLARE @True						BIT				= 1
            ,@False						BIT				= 0

    /********************************************************************************************
        MAIN LOGIC
    ********************************************************************************************/
    ;BEGIN TRY
        /* Describe what this block does. */
        ;SELECT	 [SomeColumn] = T.[SomeColumn]
        FROM	<schema>.SomeTable T
        WHERE	T.[OrderNumber] = @p_OrderNumber

    END TRY
    BEGIN CATCH
        /* Audit and Report Error. */
        ;IF ( OBJECT_ID('<schema>.usp_AuditError') IS NOT NULL )
            EXECUTE <schema>.usp_AuditError @p_ErrorData = @p_OrderNumber
    END CATCH
END
GO
```

## 20. Full Table Template

A new table in `3-Tables/` starts from this skeleton:

```sql
/*********************************************************************************
	TABLE: <schema>.<TableName>
*********************************************************************************/
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.schemas S
						LEFT JOIN sys.tables T
							ON S.[schema_id] = T.[schema_id]
				WHERE	S.[name] = '<schema>'
						AND T.[name] = '<TableName>' )
BEGIN 
	;CREATE TABLE <schema>.<TableName> (
		 [<TableName>Id]			BIGINT			NOT NULL	IDENTITY(1,1)

		/* <Group 1 Name> */
		,[Column1]					VARCHAR(100)	NOT NULL	DEFAULT('')
		,[Column2]					INT				NOT NULL	DEFAULT(0)

		/* <Group 2 Name> */
		,[Column3]					DATETIMEOFFSET	NULL
		,[Column4]					BIT				NOT NULL	DEFAULT(0)

		/* Audit Fields */
		,[CreatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())
		,[UpdatedDt]				DATETIMEOFFSET	NOT NULL	DEFAULT(SYSDATETIMEOFFSET())

		-- PRIMARY KEY.
		,CONSTRAINT		PK_<TableName>
						PRIMARY KEY	CLUSTERED	( [<TableName>Id] )
	) 
END	
GO

-- Check for and Create IX_<TableName>_<ColList>.
;IF NOT EXISTS(	SELECT	NULL
				FROM	sys.indexes I
				WHERE	I.[object_id] = OBJECT_ID('<schema>.<TableName>')
						AND I.[name] = 'IX_<TableName>_<ColList>' )
BEGIN
	;CREATE NONCLUSTERED INDEX IX_<TableName>_<ColList>
		ON <schema>.<TableName> (	[Column1]
								   ,[Column2]	)
END
GO
```

## 21. Full Function Template

A new inline TVF in `4-Functions/` starts from this skeleton:

```sql
;IF OBJECT_ID('<schema>.udf_DoSomething') IS NOT NULL
  EXEC ('DROP FUNCTION <schema>.udf_DoSomething;')
GO

;CREATE FUNCTION <schema>.udf_DoSomething
(
    @p_Param1	INT
)
RETURNS TABLE
AS
RETURN
(
    /********************************************************************************************
    *********************************************************************************************
        SCRIPT:		<schema>.udf_DoSomething
        AUTHOR:		<Author Name>
        DATE:		<Month DDth, YYYY>
        VERSION:	v1.0
    *********************************************************************************************
        NOTES:		v1.0 - <MM/DD/YYYY> - <AUTHOR NAME> - <COMPANY>
                            <Description.>
    *********************************************************************************************
    ********************************************************************************************/
    SELECT	 [Column1] = T.[Column1]
            ,[Column2] = T.[Column2]
    FROM	<schema>.SomeTable T
    WHERE	T.[Param1] = @p_Param1
)
GO
```

For a scalar function, replace `RETURNS TABLE ... RETURN ( SELECT ... )` with:

```sql
RETURNS VARCHAR(MAX)
WITH EXECUTE AS '<schema_owner>'
AS
BEGIN
    DECLARE @Result VARCHAR(MAX) = ''
    -- ...
    RETURN @Result
END
```
