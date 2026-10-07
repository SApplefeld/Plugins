// memory-database: the kit memory store's client for the shared SQL Server
// index on the host, and the local queue that stands in for it when the host
// is not there.
//
// Five properties shape everything here.
//
// The host is optional and its absence is ordinary. A machine with no client
// config runs exactly as the kit ran before this file existed: nothing is
// spawned, no socket is opened, and no queue row is written. Every entry
// point answers absence with a typed result naming the reason, and nothing
// here throws that condition at a caller.
//
// The markdown store stays the record. This module publishes a derived copy
// and never reads one back into a file: the tiers, the usage sidecars and the
// outcome journal are written exactly as they were, whether the database call
// succeeded or failed. A stamp's database write is additive, so a lost one
// costs a row on the host and never a line in usage.jsonl.
//
// The local queue is a SQLite file, opened through node's own built-in
// binding, and every row on it is a row a writer composed whole. There is no
// torn line to repair and no unreadable piece to keep: SQLite's own locking
// and its busy wait are the whole concurrency story, and the drain removes a
// delivered row by its id, so a row written while a send is in flight is
// untouched by construction.
//
// The transport is sqlcmd over a pipe, not a driver. The kit core ships no
// dependencies, the client tools are on every sandbox, and the calls are few
// and batched. The password reaches the child through SQLCMDPASSWORD and never
// through an argument, because a command line is readable from the process
// list; the batch reaches it on standard input, because a JSON document
// carrying whole private record bodies has no business in a shell word and no
// business at rest in a shared temp directory either.
//
// The connection principal is execute-only. Every call is a procedure call,
// every procedure resolves the caller's sandbox from its own login, and this
// client never states a sandbox, a visibility or a tenancy rule of its own.
//
// Node core modules only, CommonJS, zero dependencies, UTF-8 throughout.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
// Node's own SQLite binding, which the local queue below is the only user of.
// It ships with the runtime and needs no flag on the version the kit runs, so
// the queue costs this dependency-free module no dependency.
const { DatabaseSync } = require('node:sqlite');

const endpoint = require('./kit-endpoint-lib.js');
// The output channel's own renderer, for the composed sentence this client sends
// to the host on a publish run's error column: the home elision, the barred
// character, the strip and the cap, in the order that library states. It loads
// node built-ins and two other hooks/ libraries and loads no memq at module
// load, so it takes no part in the cycle below and is bound outright.
const { shownText } = require('../hooks/kit-compact-lib.js');

// memq and memory-index are resolved at the first call rather than at load,
// because memq loads this module and both of them load memq. A require taken
// while memq is still evaluating answers with the half-built exports object
// memq has filled so far, which is empty: memq assigns module.exports as its
// last statement. Binding that object would leave every call below reading
// undefined. Nothing here runs before the process's first memq call returns, by
// which point memq's exports are whole, so the accessors always answer the
// finished module. kit-endpoint-lib above loads node built-ins and nothing
// else, so it takes no part in the cycle and is bound outright.
let memqModule = null;
let indexModule = null;

function memqLib() {
    if (memqModule === null) memqModule = require('./memq.js');
    return memqModule;
}

function indexLib() {
    if (indexModule === null) indexModule = require('./memory-index.js');
    return indexModule;
}

// The client config, hand-authored per machine beside kit-endpoint.json. It
// carries a password, so it is read from the home directory rather than from
// the store root override: a store redirected for data must not move which
// credentials a publish presents.
const CONFIG_FILE = 'kit-memory-db.json';

// The local queue, a SQLite file at the store root beside the client config.
// The sync repository's allowlist re-includes only paths inside the memory
// tiers and the machine coordinator directory, so it cannot be staged: a queue
// holding this machine's undelivered stamps is per-machine state and syncing it
// would publish one machine's pending journal to every other.
//
// SQLite writes beside it, a write-ahead log and a shared-memory index, carry
// the same name with a suffix and are excluded by the same rule.
const QUEUE_FILE = 'kit-memory-db-queue.sqlite';

// How long a drain waits on a lock another connection holds before the call
// fails. It is the constructor's own busy timeout, so the wait happens inside
// SQLite rather than in any arithmetic here: a connection meeting a held lock
// waits the holder out and then commits, which is what replaces every lock
// file, stale interval and break this module used to spell for itself.
//
// The drain is the only caller on this wait. Every writer takes the shorter one
// below, so no interactive path ever blocks for two seconds.
//
// Two seconds is far past the work any holder here does. A writer's whole hold
// is one INSERT of a few hundred bytes, and no boundary call is ever inside a
// transaction. So a wait that reaches this is a wedged holder rather than a
// busy one, and the drain answers `contended`, the queue file held by another
// writer, rather than waiting longer, reporting the state and leaving every
// row where it is.
const QUEUE_BUSY_TIMEOUT_MS = 2000;

// The wait every writer takes, and the one a depth reading takes on a path that
// has already waited the full timeout out.
//
// A writer cannot afford the wait above. An interactive stamp and the read-stamp
// hook are budgeted at a few hundred milliseconds of a session's time, and their
// row is a derived copy whose sidecar is already written, so a wedged holder
// would otherwise cost every tool call two seconds to lose nothing. A depth
// reading on a path that already waited the full timeout out has learned that
// the holder is not letting go, so waiting it out again buys a number no more
// likely to arrive and delays the report of the held queue file by as long again.
//
// What this wait has to clear is the drain's delete, the only hold in this
// module long enough to matter. That hold is one transaction over one DELETE
// per delivered id, so it grows with the queue's depth and with nothing else:
// about two milliseconds at a thousand rows, nine at five thousand, a tenth of
// a second at twenty thousand, and a quarter of a second at fifty thousand. So
// a writer loses its row to this only on a queue holding tens of thousands of
// undelivered stamps, which is a host that has been unreachable long enough for
// the doctor's last-successful-publish age to have been the loud signal for
// weeks. Raising the depth at which a writer starts losing rows means lowering
// the depth, not lengthening this wait, which would spend a session's budget on
// every stamp to buy one row back at a depth nothing should reach. The queue
// is the only copy of a stamp: no file beside the record holds it, so a row
// this wait loses is a stamp the host never learns of, and the writer says so.
const QUEUE_BUSY_TIMEOUT_QUICK_MS = 250;

// SQLite's own code for a lock it would not wait any longer for, which this
// module tells from every other database error. The two have opposite readings:
// a busy machine resolves itself on the next run, while a disk or a corrupt
// file is a thing to go and look at, and a reader sent to one over the other is
// sent after a fault that is not there.
const SQLITE_BUSY = 5;

// The low byte of a result code, which is the primary code inside it.
//
// SQLite's result codes are extended codes, the primary code in the low byte
// and a reason in the byte above. The codes a lock can carry are 5 itself, 261
// for a lock met during recovery and 517 for one met on a snapshot, all three
// of them SQLITE_BUSY. An equality test against 5 would read the upper two as
// faults, which sends the drain to 'unreadable' or
// 'unclearable', sets the publish's work-failed flag and exits the verb non-zero
// on a machine that is merely busy. Masking is what makes the reading the
// primary code's rather than one code's.
const SQLITE_CODE_MASK = 0xff;

// Where the fleet installs the SQL client tools, tried ahead of PATH for the
// reason the host probe states: resolving by name alone hands the login's
// password to whatever sqlcmd sits earliest in the list, and a user-writable
// directory ahead of the real one is the ordinary way that becomes someone
// else's process.
const PINNED_SQLCMD = path.join('Microsoft SQL Server', 'Client SDK', 'ODBC', '170', 'Tools', 'Binn', 'SQLCMD.EXE');

// The budget one boundary call may spend, and the range a configured
// timeoutMs is accepted in. Outside that range the configured value is ignored
// and the default stands, the host probe's rule: a typo in one optional key is
// no reason to stand a working host down.
const DEFAULT_TIMEOUT_MS = 10000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

// The least a boundary call can cost, the host probe's two constants. sqlcmd
// keeps a login clock and a query clock one after the other and neither goes
// below a whole second, so a spawn's floor is two seconds; one HTTP call's is
// one. They bound how far a call started on the last of a budget overshoots
// it, and they are never a bar on starting one.
const SQLCMD_FLOOR_MS = 2000;
const EMBEDDING_FLOOR_MS = 1000;

// The hard kill one sqlcmd spawn runs under, which is the caller's own clock
// rather than the tool's: the budget the call was given plus the spawn floor,
// which is the overshoot a call started on the last of a budget is allowed.
// runBatch's default kill is this and nothing else, so every place that has to
// know how long a spawn may live reads it from here rather than restating the
// sum.
function spawnKillMs(budgetMs) {
    return budgetMs + SQLCMD_FLOOR_MS;
}

// The longest a spawn may live past the deadline that let it start.
//
// callBudget lifts a call starting on the last millisecond of a budget to the
// spawn floor, and that call then runs under spawnKillMs of that floor, so the
// whole of a last spawn's life past the deadline is two floors rather than one.
// Any bound on how long a live publisher can still be inside a boundary call
// after its deadline is this, and a bound of one floor is short by the other.
const SPAWN_MAX_OVERSHOOT_MS = spawnKillMs(SQLCMD_FLOOR_MS);

// The budget the reachability probe below spends, which is this verb's own and
// not the judged channel's.
//
// That channel's probe is 400 milliseconds because it sits inside an
// interactive search, and it bounds an HTTP call whose clock is expressed in
// milliseconds. A sqlcmd spawn's two clocks are whole seconds, so any budget
// under two of them buys a one-second login clock and a one-second query clock,
// and a healthy host whose TLS handshake and SQL login together run past a
// second is then refused as unreachable on every run, silently where the
// session-start spawn is the caller. Two whole seconds each is the smallest
// spawn the tool can be asked to make, so this is the cheapest boundary call
// this module has and still an order of magnitude inside the timeout a batch
// call takes.
const PROBE_TIMEOUT_MS = SQLCMD_FLOOR_MS * 2;

// The budget a call that takes the fleet publish lock spends, which is those
// calls' own and the longest any single call here takes. Which procedures take
// that lock is stated by the scripts under plugins/grimoire/db/Procedures that
// ask sp_getapplock for the mem.Publish resource, and by nothing here: a name
// written out on this side would be a second copy of a fact the T-SQL owns, and
// one that goes stale silently the first time a procedure joins them.
//
// Each takes it through sp_getapplock at @LockTimeout = 30000, so two sandboxes
// publishing at once queue for up to thirty seconds rather than race. A spawn's
// query clock is floor(budget/2000) whole seconds, so the configured ten-second
// timeout buys a five-second query clock and the queuing publisher is killed by
// its own client six times over before the server would have let it in: the
// lock's whole purpose is lost on the client side. Doubling the sum of the
// server's wait and the spawn floor is what puts the clock past the wait, since
// floor(64000/2000) is 32 seconds, two more than the thirty the server will
// spend. The server's number is the one that moves first, so this is derived
// from it rather than written out.
//
// At the boundary, a run holding less than this on its own deadline spends what
// is left instead and a batch may then be killed mid-wait. Both writes are
// idempotent and neither is ever queued, so what a killed batch costs is the
// work behind it: a record upsert costs the call alone, since the next run
// re-derives every record from the files, while an embedding write costs the
// vectors of the pack it carried, which the next run makes again from the same
// records the inventory still reports unembedded.
const LOCK_WAIT_MS = 30000;
const UPSERT_TIMEOUT_MS = (LOCK_WAIT_MS + SQLCMD_FLOOR_MS) * 2;

// The whole run's budget, over every boundary call a publish makes.
//
// Each call carries its own clock and nothing bounded the chain of them, so a
// host degraded rather than down bought a run of arbitrary length: a walk of
// several hundred records is a few dozen spawns and as many embedding calls,
// every one of them willing to spend the configured timeout. Fifteen minutes is
// past any healthy run of this store (a first publish of several hundred
// records embeds in a few dozen calls) and far short of the interval the
// session-start spawn holds the next run off for, which is DB_SYNC_ATTEMPT_STALE_MS
// in hooks/memory-session.js. That constant is a literal chosen to exceed this
// one plus SPAWN_MAX_OVERSHOOT_MS rather than derived from either, and the
// ordering between the three is held by test/memory-session.test.js, so a
// change to any one of them reds there rather than quietly letting a second
// publish start beside a run still in flight.
const RUN_BUDGET_MS = 15 * 60 * 1000;

// The schema version the queue drain needs on the host before it sends a row.
//
// The drain deletes nothing on any failure and lets the next run send the lot
// again, which is safe only because the host takes a resent row once. For an
// outcome that is mem.Outcome's unique index over the stamp id, which
// mem.usp_AppendOutcomes skips an id against. For a usage stamp it is
// mem.Usage's unique stamp id index on a host at version 2 to 7, and from
// version 8 the fold mem.usp_AppendUsage writes into one mem.RecordUsage row
// per memory, where a resent stamp changes nothing and no stamp id is stored.
// Version 2 is where the indexes land. An older host takes the
// same call and its OPENJSON ... WITH ignores the stampId key it does not name,
// so nothing there tells a resend from a new row and every resend writes a
// second row: exactly the duplicate the index exists to prevent. The version is
// therefore a precondition of sending rather than a thing to discover
// afterwards, and Install-MemoryDatabase.ps1 carries the same number as the
// version it applies.
const REQUIRED_SCHEMA_VERSION = 2;

// A database name this client hands to sqlcmd's -d argument, the probe's own
// pattern. It is the plain-identifier shape, a subset of what SQL Server admits
// as a regular identifier, so a value outside it names no database that could
// exist and the run stands down at the config read rather than on a spawn that
// was never going to connect.
//
// The server and the login ride the same command line under -S and -U and take
// no screen of their own. Their shapes are the operator's to choose, this
// client states none, and there is no shell between this process and the tool
// for either to be read by. Nothing in this module crosses into T-SQL text:
// every parameter is a declared variable filled from an escaped literal.
const DATABASE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

// Records in one usp_UpsertRecords call. A record payload carries a whole
// memory body, where an embedding payload carries a vector, so this is its own
// number rather than the embedder's batch: fifty bodies at this store's sizes
// is a payload of a few hundred kilobytes, which one batch file and one
// OPENJSON pass take comfortably.
const RECORD_BATCH = 50;

// Characters of body per chunk, and the ceiling no chunk may exceed.
//
// The spec states the chunk target in tokens and the kit ships no tokenizer.
// The ratio comes from this exact model's own refusal, which counted a
// 16132-character input as 3926 tokens: 4.11 characters per token. At four
// characters per token the 512 to 1024 token target is 2048 to 4096
// characters, and the ceiling below sits at about 1500 tokens, well short of
// the embedding server's 2048-token batch width. The chunker cannot produce a
// piece past that ceiling, so no chunk of English prose reaches the server's
// own limit.
//
// That ratio is a property of English prose and of this model's vocabulary,
// and it does not hold for text that is mostly CJK or emoji, where a
// multilingual vocabulary spends closer to one token per character. A body
// like that can chunk inside the character ceiling and still be refused by the
// server on its token count, which is why a refused call is retried one record
// at a time: the refusal then names the one body the server would not take
// rather than every record packed beside it.
const CHUNK_TARGET_CHARS = 4096;
const CHUNK_MIN_CHARS = 2048;
const CHUNK_MAX_CHARS = 6144;

// The most texts one embedding call may carry, which is a property of the
// answer rather than of the request: kit-endpoint-lib reads a response body
// under a fixed byte bound, and a vector of this model's width printed as JSON
// is about twenty kilobytes. Sixteen of them, the local sweep's batch width,
// is a third of a megabyte, so every full pack would be refused at the reader
// and only a store whose records pack into fewer chunks would embed at all.
//
// The width is the schema's: mem.Embedding holds VECTOR(1024) and the fleet's
// model is 1024-wide, so a model change moves this number and the column
// together. The bytes per float are generous on purpose, since a JSON float at
// full double precision plus its separator runs to about twenty characters and
// the cost of over-reserving is one more call.
const EMBED_VECTOR_DIMENSIONS = 1024;
const EMBED_FLOAT_BYTES = 24;
const EMBED_RESPONSE_OVERHEAD_BYTES = 4096;

// --------------------------------------------------------------- the config --

function configPath() {
    return path.join(os.homedir(), '.claude', CONFIG_FILE);
}

function queuePath() {
    return path.join(memqLib().memoryRoot(), QUEUE_FILE);
}

// The migration marker: the record a complete `memq db-sync` publish leaves, so
// the publish that copies this machine's files into the database runs once. It
// sits beside the config under the home directory, which is the store the
// publish speaks for, and the store sync admits nothing at that root.
const MIGRATION_MARKER_FILE = 'memory-migrated.json';
function migrationMarkerPath() {
    return path.join(os.homedir(), '.claude', MIGRATION_MARKER_FILE);
}

// The marker's text, or null where there is no marker. A marker that is there
// and cannot be read is still a marker: the answer carries the reason in place
// of the text, so the verb sends nothing and says why.
function readMigrationMarker() {
    try {
        return { text: fs.readFileSync(migrationMarkerPath(), 'utf8') };
    } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        return { text: null, reason: errText(err) };
    }
}

// Write the marker, replacing one a `--again` run found.
function writeMigrationMarker(marker) {
    fs.writeFileSync(migrationMarkerPath(), JSON.stringify(marker, null, 2) + '\n', 'utf8');
}

// The down marker: the file a failed probe or a failed host call leaves beside
// the config, so that every verb in the next minute queues its write, or reads
// its snapshot, without spending a timeout of its own. A burst of calls in an
// outage then costs one timeout rather than one per call. Its age is its mtime,
// and nothing removes it: a marker older than the window is simply not fresh,
// and the next call that reaches the host leaves it to age out.
//
// The embedding endpoint keeps a marker of the same shape beside it, written on
// a transport fault of an embedding call (a timeout or a refused connection,
// never an HTTP answer), so a search verb or the embed pass behind a dead
// embedder skips the call rather than paying its timeout again. The two
// markers share the writer and the reader below, keyed by file name.
const DOWN_MARKER_FILE = 'kit-memory-db.down';
const EMBED_DOWN_MARKER_FILE = 'kit-memory-embed.down';
const DOWN_MARKER_FRESH_MS = 60 * 1000;
function markerPath(file) {
    return path.join(os.homedir(), '.claude', file);
}
function downMarkerPath() {
    return markerPath(DOWN_MARKER_FILE);
}
function embedderDownMarkerPath() {
    return markerPath(EMBED_DOWN_MARKER_FILE);
}

// Leave a marker, or refresh its time. It throws for nothing: a marker that
// could not be written costs the next call a timeout and nothing else.
function markDown(file) {
    try {
        const target = markerPath(file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, new Date().toISOString() + '\n', 'utf8');
    } catch { /* the next call asks the far side itself */ }
}
function markHostDown() {
    markDown(DOWN_MARKER_FILE);
}
function markEmbedderDown() {
    markDown(EMBED_DOWN_MARKER_FILE);
}

// Whether the marker is there and fresh, read at `nowMs`. A marker that cannot
// be read is no marker, and neither is one whose time is ahead of the clock by
// more than the skew below: a clock set back, or a file copied in with a
// future mtime, would otherwise read as fresh for as long as the gap, and
// every write would queue unprobed against a host that may be fine. The skew
// covers a just-written file's mtime, which reads at most a few milliseconds
// ahead of Date.now() on NTFS, so a marker a verb left a moment ago is still
// fresh to the verb behind it.
const DOWN_MARKER_SKEW_MS = 5000;
function markedDown(file, nowMs) {
    try {
        const at = fs.statSync(markerPath(file)).mtimeMs;
        const age = nowMs - at;
        return Number.isFinite(at) && age >= -DOWN_MARKER_SKEW_MS && age < DOWN_MARKER_FRESH_MS;
    } catch {
        return false;
    }
}
function hostMarkedDown(nowMs) {
    return markedDown(DOWN_MARKER_FILE, nowMs);
}
function embedderMarkedDown(nowMs) {
    return markedDown(EMBED_DOWN_MARKER_FILE, nowMs);
}

// The line a verb prints for a call the host marker held back.
function hostDownDetail() {
    return 'the memory database did not answer within the last '
        + Math.round(DOWN_MARKER_FRESH_MS / 1000) + ' seconds, so it was not asked again';
}

// The line a verb prints for a call the embedder marker held back.
function embedderDownDetail() {
    return 'the embedding server did not answer within the last '
        + Math.round(DOWN_MARKER_FRESH_MS / 1000) + ' seconds, so it was not asked again';
}

// Where a refused record row's payload is kept: under the snapshot directory,
// named by the row's stamp id and never by the record's name. The stamp id is
// this client's own UUID, screened at the writer to the charset below, so no
// text a caller typed is ever joined onto this path.
const SNAPSHOT_DIR = 'memory-snapshot';
const REFUSED_DIR = 'refused';
const STAMP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
function refusedRecordPath(stampId) {
    if (!STAMP_ID_RE.test(String(stampId))) return null;
    return path.join(os.homedir(), '.claude', SNAPSHOT_DIR, REFUSED_DIR, stampId + '.json');
}

// ---------------------------------------------------------------- the snapshot --
//
// The read-only copy of the host this machine last took, under the snapshot
// directory beside the refused payloads. memq alone writes it: `db-refresh`
// and every read verb that fetched an index write `index.json` through, and
// `memq get` writes each body it fetched under `records/`. A hook reads it
// through readSnapshotIndex below and never spawns for it.
//
// index.json, version 1:
//
//   {
//     "version": 1,
//     "tiers": {
//       "type":     { "takenAt": "<ISO time>", "rows": [ <usp_ListIndex row>, ... ] },
//       "operator": { "takenAt": "<ISO time>", "rows": [ ... ] }
//     },
//     "projects": {
//       "<project key>": { "takenAt": "<ISO time>", "rows": [ ... ] }
//     }
//   }
//
// Every row is a mem.usp_ListIndex row as the procedure returns it: recordId,
// tier, projectKey, typeName, name, description, tags, triggers, anchors,
// pinned, space, machine, supersedes, author, created, origin, updated,
// lastRead, lastApplied and appliedDays. A section is replaced whole by the refresh that took it
// and keeps its own takenAt, so a shared tier taken an hour ago and a project
// taken just now each say when. The projects map holds every key a refresh
// on this machine has taken, bounded at SNAPSHOT_PROJECT_KEYS_MAX with the
// oldest-taken dropped first, which is what keeps the file a bounded size:
// a row carries no body, so the bound on keys is the bound on the file.
//
// A body sits at records/<tier>/<key-dir>/<name>.json as {takenAt, record},
// the record being the mem.usp_GetRecord row. The key directory is the first
// sixteen hex characters of the project key's SHA-1, the type name for a type
// record, since two types can hold one record name, and `operator` for the
// operator tier. The name reaches the path only through the store's own
// filename gate and a containment check, so no text off the wire or a
// command line can leave the records directory.
const SNAPSHOT_INDEX_FILE = 'index.json';
const SNAPSHOT_RECORDS_DIR = 'records';
const SNAPSHOT_INDEX_VERSION = 1;
const SNAPSHOT_PROJECT_KEYS_MAX = 32;
const SNAPSHOT_KEY_DIR_HEX = 16;

function snapshotDir() {
    return path.join(os.homedir(), '.claude', SNAPSHOT_DIR);
}

function snapshotIndexPath() {
    return path.join(snapshotDir(), SNAPSHOT_INDEX_FILE);
}

// The most rows one section of index.json keeps, the recognition nudge's own
// per-tier take (INDEX_RECORDS_MAX in hooks/memory-recognition-nudge.js). The
// writer keeps a section's rows in name order and cuts it here, so every file
// it writes is one its own reader's ceiling below admits.
const SNAPSHOT_SECTION_ROWS_MAX = 512;

// The characters a row carries in the fields the host's own columns bound and
// the writer does not clamp, at their column widths: projectKey 400, typeName
// 400 (the store segment), author 200, machine 100, space 100, origin 10, tier
// 20, created 10, createdAt, updated, lastRead and lastApplied at 34 each,
// recordId 20, appliedDays 11 and pinned 5, plus 21 keys at 20 characters of
// name, quotes and separators apiece: 1,832 in all.
const SNAPSHOT_ROW_BOUNDED_CHARS = 400 + 400 + 200 + 100 + 100 + 10 + 20 + 10 + 4 * 34 + 20 + 11 + 5 + 21 * 20;

// The largest index.json the reader parses, in bytes, as the arithmetic of the
// largest file the writer can produce. A row's clamped fields are two names at
// NAME_CAP, a description at SUMMARY_CAP, and MAX_TAGS tags, TRIGGER_ENTRIES_MAX
// triggers and ANCHOR_ENTRIES_MAX anchors at their entry caps, each list entry
// three characters of quotes and comma more, with SNAPSHOT_ROW_BOUNDED_CHARS
// beside them: 20,536 characters at memq's caps today. JSON.stringify writes no
// character in more than six bytes (a control character as \u00XX; any other
// in at most three UTF-8 bytes per UTF-16 unit), so a row is at most six times
// its characters, 123,216 bytes. A section is SNAPSHOT_SECTION_ROWS_MAX rows
// and 512 bytes of its own, and the file is SNAPSHOT_PROJECT_KEYS_MAX project
// sections and the two shared tiers plus 1,024 bytes: (32 + 2) x (512 x
// 123,216 + 512) + 1,024 = 2,144,962,560 bytes, about 2.1 GB. Past it the file
// is not one this writer wrote, and it is refused before it is read.
//
// The ceiling guards against a planted file and bounds no reader's cost. A
// reader parses the whole file, and what bounds that parse is the row count
// the writer holds it to: SNAPSHOT_PROJECT_KEYS_MAX project sections and the
// two shared tiers, each of at most SNAPSHOT_SECTION_ROWS_MAX rows.
function snapshotIndexCeiling() {
    const memq = memqLib();
    const rowChars = memq.NAME_CAP * 2 + memq.SUMMARY_CAP
        + memq.MAX_TAGS * (memq.TAG_CAP + 3)
        + memq.TRIGGER_ENTRIES_MAX * (memq.TRIGGER_ENTRY_CAP + 3)
        + memq.ANCHOR_ENTRIES_MAX * (memq.ANCHOR_ENTRY_CAP + 3)
        + SNAPSHOT_ROW_BOUNDED_CHARS;
    return (SNAPSHOT_PROJECT_KEYS_MAX + 2) * (SNAPSHOT_SECTION_ROWS_MAX * rowChars * 6 + 512) + 1024;
}

// One row's text fields held at the write to the caps memq's put holds the
// same fields to: the name and the supersedes pointer at NAME_CAP, the
// description at SUMMARY_CAP, and tags, triggers and anchors at their entry
// counts and entry widths. A row the host holds wider, a description written
// through mem.usp_PutRecord's NVARCHAR(MAX) among them, costs every reader of
// the snapshot no more than a record memq could have written. Every other
// field is held by its column on the host.
function clampedRow(row) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
    const memq = memqLib();
    const cut = (value, cap) => (typeof value === 'string' && value.length > cap ? value.slice(0, cap) : value);
    const list = (value, count, cap) => (Array.isArray(value) ? value.slice(0, count).map((e) => cut(e, cap)) : value);
    const out = { ...row };
    if ('name' in row) out.name = cut(row.name, memq.NAME_CAP);
    if ('supersedes' in row) out.supersedes = cut(row.supersedes, memq.NAME_CAP);
    if ('description' in row) out.description = cut(row.description, memq.SUMMARY_CAP);
    if ('tags' in row) out.tags = list(row.tags, memq.MAX_TAGS, memq.TAG_CAP);
    if ('triggers' in row) out.triggers = list(row.triggers, memq.TRIGGER_ENTRIES_MAX, memq.TRIGGER_ENTRY_CAP);
    if ('anchors' in row) out.anchors = list(row.anchors, memq.ANCHOR_ENTRIES_MAX, memq.ANCHOR_ENTRY_CAP);
    return out;
}

// A section's rows as the writer keeps them: each clamped, in the host's order,
// and where there are more than SNAPSHOT_SECTION_ROWS_MAX of them, the first
// that many in name order, so which rows a large section keeps is the same on
// every refresh.
function keptRows(rows) {
    const byName = (a, b) => {
        const x = a !== null && typeof a === 'object' && typeof a.name === 'string' ? a.name : '';
        const y = b !== null && typeof b === 'object' && typeof b.name === 'string' ? b.name : '';
        return x < y ? -1 : x > y ? 1 : 0;
    };
    const clamped = rows.map(clampedRow);
    return clamped.length > SNAPSHOT_SECTION_ROWS_MAX ? clamped.sort(byName).slice(0, SNAPSHOT_SECTION_ROWS_MAX) : clamped;
}

// The newest ISO time among the sections, or null for an index with none.
function newestTakenAt(index) {
    let newest = null;
    const consider = (section) => {
        if (section === null || typeof section !== 'object' || typeof section.takenAt !== 'string') return;
        const ms = Date.parse(section.takenAt);
        if (!Number.isFinite(ms)) return;
        if (newest === null || ms > newest.ms) newest = { ms, at: section.takenAt };
    };
    for (const tier of ['type', 'operator']) consider(index.tiers[tier]);
    for (const section of Object.values(index.projects)) consider(section);
    return newest;
}

// The parsed index.json with the facts a reader keys a cache on, as
// {ok, index, takenAt, takenAtMs, size, mtimeMs}, or {ok: false, reason} with
// reason `absent` for no file and `unreadable` for a file that is there and is
// not an index this version reads, a file past snapshotIndexCeiling among
// them, which is refused on its size before a byte is read. It spawns nothing
// and throws for nothing: a hook reads it on every turn and an outage here is
// an empty block, never a wait. `takenAt` is the newest section's, null where
// no section carries one. `projects` is a map with no prototype, so a key the
// file names, `__proto__` among them, is a key and nothing else.
function readSnapshotIndex() {
    const file = snapshotIndexPath();
    let stat;
    let text;
    try {
        stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > snapshotIndexCeiling()) return { ok: false, reason: 'unreadable' };
        text = fs.readFileSync(file, 'utf8');
    } catch (err) {
        return { ok: false, reason: err && err.code === 'ENOENT' ? 'absent' : 'unreadable' };
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'unreadable' }; }
    const index = emptyIndex();
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== SNAPSHOT_INDEX_VERSION) {
        return { ok: false, reason: 'unreadable' };
    }
    const section = (value) => (value !== null && typeof value === 'object' && Array.isArray(value.rows)
        ? { takenAt: typeof value.takenAt === 'string' ? value.takenAt : null, rows: value.rows }
        : null);
    for (const tier of ['type', 'operator']) {
        const got = parsed.tiers && section(parsed.tiers[tier]);
        if (got) index.tiers[tier] = got;
    }
    if (parsed.projects !== null && typeof parsed.projects === 'object') {
        for (const [key, value] of Object.entries(parsed.projects)) {
            const got = section(value);
            if (got) index.projects[key] = got;
        }
    }
    const newest = newestTakenAt(index);
    return {
        ok: true,
        index,
        takenAt: newest === null ? null : newest.at,
        takenAtMs: newest === null ? null : newest.ms,
        size: stat.size,
        mtimeMs: stat.mtimeMs
    };
}

function emptyIndex() {
    return { version: SNAPSHOT_INDEX_VERSION, tiers: {}, projects: Object.create(null) };
}

// Write a file whole beside its final name and rename it over, the queue's
// other writers' shape, so a reader never meets a half-written file. The
// temp name carries the pid, so two memq processes writing at once leave
// two whole files and the later rename wins.
function writeAtomically(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp.' + process.pid;
    try {
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, file);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch { /* a leftover temp is inert */ }
        throw err;
    }
}

// The rows of every other section whose key differs from `key` only by letter
// case, less any name the fresh rows already hold, with those sections taken
// out of the index. On Windows the store matches a project folder caselessly,
// so two such keys are one folder refreshed under two spellings, and the
// refresh leaves one section holding both sets of records. A row the host has
// since dropped rides along until the key's next refresh replaces the section
// whole. Only index rows are carried: a fetched body stays under the old key's
// hashed directory, and the next `memq get` of that record fetches it again.
// Elsewhere a path's case is part of its name, and nothing is folded.
function caseTwinRows(index, key, rows) {
    if (process.platform !== 'win32') return [];
    const folded = key.toLowerCase();
    const seen = new Set(rows.map((r) => (r !== null && typeof r === 'object' ? r.name : undefined)));
    const extra = [];
    for (const other of Object.keys(index.projects)) {
        if (other === key || other.toLowerCase() !== folded) continue;
        for (const r of index.projects[other].rows) {
            const name = r !== null && typeof r === 'object' ? r.name : undefined;
            if (seen.has(name)) continue;
            seen.add(name);
            extra.push(r);
        }
        delete index.projects[other];
    }
    return extra;
}

// Merge freshly taken sections into index.json and write it, as {ok, file} or
// {ok: false, detail}. `taken` is {type, operator, projects}, each present
// where it was taken: `type` and `operator` as row arrays and `projects` as a
// map from project key to its rows. A section not in `taken` keeps what the
// file held. Rows are kept as the host returned them, each held to memq's put
// caps (clampedRow), in name order and at most SNAPSHOT_SECTION_ROWS_MAX to a
// section, and an index that would not read is replaced rather than merged
// into, since what it held cannot be trusted either way. It throws for
// nothing: a snapshot that could not be written costs the next outage its
// answer and nothing else, and the caller says so.
//
// The merge reads the file, then writes it whole, under no lock. Two writers
// that overlap each read the file before either writes, so the later rename
// drops the section the earlier one wrote, and that section is missing until
// its key's next refresh writes it again. That is a declared limit: the cost
// is a section's staleness, never a torn file.
function writeSnapshotIndex(taken, options) {
    const opts = options || {};
    const now = (typeof opts.now === 'function') ? opts.now : Date.now;
    const at = new Date(now()).toISOString();
    const existing = readSnapshotIndex();
    const index = existing.ok ? existing.index : emptyIndex();
    for (const tier of ['type', 'operator']) {
        if (Array.isArray(taken[tier])) index.tiers[tier] = { takenAt: at, rows: keptRows(taken[tier]) };
    }
    if (taken.projects !== null && typeof taken.projects === 'object') {
        for (const [key, rows] of Object.entries(taken.projects)) {
            if (!Array.isArray(rows)) continue;
            // Fresh rows take the section's room first, and folded ones only
            // what is left, so a stale row never displaces a live one.
            const fresh = keptRows(rows);
            const room = Math.max(0, SNAPSHOT_SECTION_ROWS_MAX - fresh.length);
            index.projects[key] = { takenAt: at, rows: fresh.concat(caseTwinRows(index, key, rows).slice(0, room).map(clampedRow)) };
        }
    }
    // The bound: the oldest-taken keys go first, the ones just taken never,
    // since their time is this write's.
    const keys = Object.keys(index.projects);
    if (keys.length > SNAPSHOT_PROJECT_KEYS_MAX) {
        const byAge = keys.map((key) => {
            const ms = Date.parse(index.projects[key].takenAt);
            return { key, ms: Number.isFinite(ms) ? ms : -Infinity };
        }).sort((a, b) => a.ms - b.ms);
        for (const entry of byAge.slice(0, keys.length - SNAPSHOT_PROJECT_KEYS_MAX)) {
            delete index.projects[entry.key];
        }
    }
    try {
        writeAtomically(snapshotIndexPath(), JSON.stringify(index) + '\n');
        return { ok: true, file: snapshotIndexPath() };
    } catch (err) {
        return { ok: false, detail: errText(err) };
    }
}

// The directory a tier's bodies sit under, by its key: the hashed project
// key, the type name, or the operator tier's own name. Null where the key is
// not one this writes a path from.
function snapshotKeyDir(tier, key) {
    if (tier === 'project') {
        if (typeof key !== 'string' || key === '') return null;
        return crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, SNAPSHOT_KEY_DIR_HEX);
    }
    if (tier === 'type') return (typeof key === 'string' && memqLib().isTypeName(key)) ? key : null;
    if (tier === 'operator') return 'operator';
    return null;
}

// Where a record's body is kept, or null where the tier, the key or the name
// is not one a path is written from. The name passes the store's own filename
// gate, which closes it to [A-Za-z0-9_.-] and bars the index name, and the
// joined path is then checked to sit under the records directory, the same
// containment the refused filing relies on its stamp id for.
function snapshotRecordPath(tier, key, name) {
    const keyDir = snapshotKeyDir(tier, key);
    if (keyDir === null) return null;
    if (typeof name !== 'string' || !memqLib().isMemoryFilename(name + '.md')) return null;
    const root = path.join(snapshotDir(), SNAPSHOT_RECORDS_DIR);
    const file = path.join(root, tier, keyDir, name + '.json');
    const relative = path.relative(root, file);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return file;
}

// Write one fetched body through, as {ok, file} or {ok: false, detail}. The
// record is the mem.usp_GetRecord row as the host returned it, stamped with
// the time it was fetched. It throws for nothing, for writeSnapshotIndex's
// reason.
function writeSnapshotRecord(tier, key, record, options) {
    const opts = options || {};
    const now = (typeof opts.now === 'function') ? opts.now : Date.now;
    const file = snapshotRecordPath(tier, key, record === null || typeof record !== 'object' ? null : record.name);
    if (file === null) return { ok: false, detail: 'the record names no path this client writes' };
    try {
        writeAtomically(file, JSON.stringify({ takenAt: new Date(now()).toISOString(), record }) + '\n');
        return { ok: true, file };
    } catch (err) {
        return { ok: false, detail: errText(err) };
    }
}

// The body this machine last fetched for a record, as {ok, record, takenAt,
// takenAtMs}, or {ok: false, reason} with `absent` for a record never fetched
// here and `unreadable` for a file that is there and is not one this reads.
function readSnapshotRecord(tier, key, name) {
    const file = snapshotRecordPath(tier, key, name);
    if (file === null) return { ok: false, reason: 'absent' };
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        return { ok: false, reason: err && err.code === 'ENOENT' ? 'absent' : 'unreadable' };
    }
    if (parsed === null || typeof parsed !== 'object' || parsed.record === null || typeof parsed.record !== 'object') {
        return { ok: false, reason: 'unreadable' };
    }
    const ms = Date.parse(parsed.takenAt);
    return { ok: true, record: parsed.record, takenAt: parsed.takenAt, takenAtMs: Number.isFinite(ms) ? ms : null };
}

// Whether any snapshot has been taken on this machine: an index file, or a
// records directory a fetched body was written under. A verb falling back
// with neither says the store is unreachable and exits non-zero, where one
// with a snapshot answers from it.
function snapshotPresent() {
    try {
        if (fs.statSync(snapshotIndexPath()).isFile()) return true;
    } catch { /* no index: a body copy may still be there */ }
    try {
        return fs.statSync(path.join(snapshotDir(), SNAPSHOT_RECORDS_DIR)).isDirectory();
    } catch {
        return false;
    }
}

// A snapshot's age for the line a fallback prints: whole minutes under two
// hours, whole hours under two days, whole days after, and `an unknown time`
// where the time could not be read.
function snapshotAgeText(takenAtMs, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (!Number.isFinite(takenAtMs)) return 'an unknown time';
    const minutes = Math.max(0, Math.floor((now - takenAtMs) / 60000));
    if (minutes < 120) return minutes + ' minute' + (minutes === 1 ? '' : 's');
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + ' hours';
    return Math.floor(hours / 24) + ' days';
}

// Whether the store this process would walk and queue into is the machine's
// own, which is the only store this client speaks for.
//
// The credential comes from the home directory while the walk's root moves with
// KIT_MEMORY_ROOT, so a redirected store presents the default store's login and
// resolves to the same sandbox on the host. Publishing from one would name the
// other's rows removed and the shared index would oscillate between two
// readings of one sandbox; queuing into one would fill a file no publish ever
// drains, since every publish leg refuses the same condition. One spelling of
// the question, read by the verb, the session-start spawn and the stamp writer
// alike.
function isDefaultStoreRoot() {
    try {
        return path.resolve(memqLib().memoryRoot()).toLowerCase()
            === path.resolve(path.join(os.homedir(), '.claude')).toLowerCase();
    } catch {
        return false;
    }
}

// The one predicate the record door stands on: whether this process's store
// root may reach the memory database at all. It answers isDefaultStoreRoot,
// and it is exported so a test fixture can declare its temporary root the
// machine's own; hostConfig reads it through module.exports for that reason.
function storeRootServesDatabase() {
    return isDefaultStoreRoot();
}

// The sentence every surface prints where the record door stands down for a
// redirected store root. `shownRoot`, where given, is the root as the caller
// may print it; the session hook gives none, since a root is environment text
// it does not speak in its own voice.
function redirectedRootText(shownRoot) {
    return 'this process is pointed at a store root'
        + (typeof shownRoot === 'string' && shownRoot !== '' ? ' (' + shownRoot + ')' : '')
        + ' that is not this machine\'s own, so no record is read from or written to a memory database'
        + ' here: a database config, where this machine has one, answers for the machine\'s own store';
}

// The client config a call to the host runs under, or the refusal that stops
// it before any probe, marker, queue row or snapshot write. Every entry point
// a caller reaches the host through resolves its config here: the record
// reads and writes, and the publish, drain, adoption, embed, curator, health
// and calibration calls. So a redirected store root is refused in one place:
// its credential and config come from the home directory, and a call from it
// would read and write the machine's own records under the machine's login.
// The primitives below the entry points (callProcedure, probeHost,
// curatorCall, sendRecordRow, drainQueue, runBatch) take a config their
// caller already resolved here and do not ask again. The stamp writer,
// deliver, reaches no host, and checks isDefaultStoreRoot directly before it
// queues.
function hostConfig(opts) {
    if (!module.exports.storeRootServesDatabase()) {
        let root = '';
        try { root = memqLib().sanitize(memqLib().memoryRoot(), 200); } catch { root = ''; }
        return { ok: false, reason: 'redirected', detail: redirectedRootText(root) };
    }
    return opts.config ? { ok: true, config: opts.config, path: opts.configPath } : loadConfig(opts.configPath);
}

function errText(err) {
    const code = err && typeof err.code === 'string' ? err.code : '';
    if (code !== '') return code;
    return memqLib().sanitize(err && err.message ? String(err.message) : String(err), 200);
}

// The client config, or a described refusal. The refusal reasons are
// kit-endpoint-lib's, because a caller stands down on all of them alike and
// the two config files are read for the same kind of thing:
//
//   absent      no file at that path: no database on this machine
//   unreadable  the file is there and could not be read
//   malformed   not JSON, or JSON that is not an object
//   invalid     an object missing or mis-typing a key a caller needs
//
// PASSWORDS NEVER LEAVE THIS OBJECT. No refusal detail, no log line and no
// error text below quotes the password field, and the only place its value is
// spelled is the child environment of a sqlcmd spawn.
//
// `windowsAuth` and `trustServerCertificate` are optional and both default to
// false. The first is what lets a machine's own local instance answer, since
// every sandbox's local SQL Server runs Windows-only authentication, and it is
// the one shape where login and password are not required. The second is the
// installer's own flag, needed for an instance whose certificate this machine
// does not trust; it is absent from a fleet config, whose whole point is that
// the host's certificate validates.
//
// `curatorLogin` and `curatorPassword` are optional and travel as a pair. They
// are the second principal this client can present, held on the config's
// `curator` key as {login, password} where both are given and as null where
// neither is, so a caller reads one field to learn whether the machine holds a
// curator at all. One without the other is a config defect rather than an
// absent curator: a half-typed pair reported as "no curator configured" would
// send the operator to add what is already there.
function loadConfig(file) {
    const target = (typeof file === 'string' && file !== '') ? file : configPath();
    let raw = '';
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        const code = (err && typeof err.code === 'string') ? err.code : '';
        if (code === 'ENOENT') return { ok: false, reason: 'absent', path: target };
        return { ok: false, reason: 'unreadable', path: target, detail: code || 'read failed' };
    }

    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, reason: 'malformed', path: target, detail: 'not JSON' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: 'malformed', path: target, detail: 'not a JSON object' };
    }

    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    const windowsAuth = parsed.windowsAuth === true;
    const server = text(parsed.server);
    const database = text(parsed.database);
    const login = text(parsed.login);
    const password = typeof parsed.password === 'string' ? parsed.password : '';
    const embedding = (parsed.embedding !== null && typeof parsed.embedding === 'object')
        ? parsed.embedding : {};
    const url = text(embedding.url).replace(/\/+$/, '');
    const model = text(embedding.model);

    const missing = [];
    if (server === '') missing.push('server');
    if (database === '') missing.push('database');
    if (!windowsAuth && login === '') missing.push('login');
    if (!windowsAuth && password === '') missing.push('password');
    if (url === '') missing.push('embedding.url');
    if (model === '') missing.push('embedding.model');
    if (missing.length > 0) {
        return { ok: false, reason: 'invalid', path: target, detail: missing.join(', ') + ' missing or empty' };
    }
    if (!/^https?:\/\/[^\s/]+/.test(url)) {
        return { ok: false, reason: 'invalid', path: target, detail: 'embedding.url must be an http or https address' };
    }
    // The model identity is the one scalar out of the config this client
    // writes into a batch, so it is held to the batch's own screen here rather
    // than at the call. A model string the screen refuses is a config defect,
    // and reported at the call it would read as a host that did not answer,
    // every run. Emptiness was refused above with the other missing keys.
    if (textLiteral('@v1', model) === null) {
        return {
            ok: false,
            reason: 'invalid',
            path: target,
            detail: 'embedding.model is not a value this client writes into a batch, so '
                + memqLib().sanitize(model, 64) + ' is never sent'
        };
    }
    if (!DATABASE_NAME_RE.test(database)) {
        return {
            ok: false,
            reason: 'invalid',
            path: target,
            detail: 'database is not a plain identifier, so ' + memqLib().sanitize(database, 64)
                + ' is never handed to the client tool'
        };
    }

    let timeoutMs = DEFAULT_TIMEOUT_MS;
    const configured = Number(parsed.timeoutMs);
    if (parsed.timeoutMs !== undefined && Number.isFinite(configured)
        && configured >= MIN_TIMEOUT_MS && configured <= MAX_TIMEOUT_MS) {
        timeoutMs = Math.floor(configured);
    }

    const curatorLogin = text(parsed.curatorLogin);
    const curatorPassword = typeof parsed.curatorPassword === 'string' ? parsed.curatorPassword : '';
    if ((curatorLogin === '') !== (curatorPassword === '')) {
        return {
            ok: false,
            reason: 'invalid',
            path: target,
            detail: 'curatorLogin and curatorPassword are given together or not at all, and only '
                + (curatorLogin === '' ? 'curatorPassword' : 'curatorLogin') + ' is set'
        };
    }
    const curator = curatorLogin === '' ? null : { login: curatorLogin, password: curatorPassword };

    return {
        ok: true,
        path: target,
        config: {
            server, database, login, password, timeoutMs, windowsAuth,
            trustServerCertificate: parsed.trustServerCertificate === true,
            embedding: { url, model },
            curator
        }
    };
}

// The model identity every embedding row is written under and every unembedded
// question is asked about. One function, called by both legs of a publish, so
// the string the list was filtered by and the string the vectors are stored
// under cannot be two different strings: a mismatch there would leave every
// record reading as unembedded forever and re-embed the whole store on every
// run.
function modelIdentity(config) {
    return config.embedding.model;
}

// ------------------------------------------------------------ the transport --

// Where sqlcmd is, or null where the pinned client tools are not installed.
//
// One candidate, spelled here as a literal, and no fallback of any kind.
// Resolving by name searches PATH, which hands the login's password to whatever
// sqlcmd sits earliest in that list. Resolving through the environment's own
// ProgramFiles is the same hazard one step removed: a repository-committed
// terminal environment, which is inside this project's threat model, sets that
// variable to a directory it controls, plants this relative path under it, and
// receives the password in the child. So the only base is the one every sandbox
// installs to. A machine that holds its program files elsewhere publishes
// nothing and says so, which is the same answer it gives for an absent config.
const SQLCMD_BASE = 'C:\\Program Files';
function sqlcmdPath() {
    const pinned = path.join(SQLCMD_BASE, PINNED_SQLCMD);
    try {
        if (fs.statSync(pinned).isFile()) return pinned;
    } catch { /* not installed: this client resolves nothing else */ }
    return null;
}

// The child's whole environment: an allowlist, built rather than copied.
//
// sqlcmd reads its own behaviour out of a dozen SQLCMD* variables, one of them
// SQLCMDINI, which names a startup script the tool runs before the batch. A
// copy of this process's environment carries every one of them into a child
// that holds the login's password, and a repository-committed terminal
// environment is inside this project's threat model. So the child gets the
// variables a process needs to run at all plus the one secret it is being
// given, and no SQLCMD* name reaches it except SQLCMDPASSWORD.
//
// The -X flag is deliberately not passed beside this. The tool's own banner
// reads "disable commands, startup script, environment variables", and taking
// the environment variables away takes SQLCMDPASSWORD with them, which makes a
// SQL-authenticated login fail and the tool prompt for a password instead.
// This allowlist answers the same threat at its source: a variable that never
// reaches the child steers nothing. The tool's file and shell directives
// (:r, :!!) are out of reach for a different reason, which is authorship: every
// line of every batch is written by payloadLiteral or the fixed text around it,
// and no line of a payload can begin with a colon because each is prefixed with
// a SET statement.
//
// PATH is not on the list, and the spawn names the child's working directory
// for the same reason. The Windows loader searches the working directory and
// then PATH for a dependent library it has not already found, so both are ways
// a directory somebody else writes gets a say in which code runs inside a
// process holding the login's password. The tool is launched from its own
// directory, where the client libraries it loads sit beside it.
const CHILD_ENV_ALLOWED = [
    'SystemRoot', 'windir', 'PATHEXT', 'COMSPEC', 'ComSpec',
    'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'SystemDrive', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
    'APPDATA', 'LOCALAPPDATA', 'COMPUTERNAME', 'USERDOMAIN', 'USERNAME',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'LANG', 'LC_ALL', 'TZ'
];
function childEnvironment(config) {
    const allowed = new Set(CHILD_ENV_ALLOWED.map((name) => name.toLowerCase()));
    const env = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (allowed.has(name.toLowerCase())) env[name] = value;
    }
    // The password reaches the child here and nowhere else, so the value lives
    // in one object that goes out of scope with the call. Under Windows
    // authentication the child is given none at all: a secret it has no use
    // for is not handed to it.
    if (!config.windowsAuth) env.SQLCMDPASSWORD = config.password;
    return env;
}

// Whole seconds for each of the two clocks a sqlcmd spawn keeps, out of one
// budget, the host probe's arithmetic. The share is divided down rather than
// rounded, since rounding to nearest hands the clocks more time than the
// budget funds, and it is lifted to the tool's own floor where dividing down
// leaves less, which is the one place a call runs past its budget.
function clockSeconds(budgetMs) {
    if (!(budgetMs > 0)) return 0;
    const floorSeconds = Math.floor(SQLCMD_FLOOR_MS / 2000);
    return Math.max(floorSeconds, Math.floor(budgetMs / 2000));
}

// What a boundary call about to start may spend, or null where the run's
// deadline has passed and the call must not start at all.
//
// Two rules in one answer. The run's deadline governs whether a call starts,
// so a call asked for on or after it is refused rather than clamped to nothing.
// The call's own clock governs how long it runs, so what is left of the run's
// budget bounds the clock a caller asked for, and the one call that crosses
// the deadline is the only one that overshoots it.
//
// The lift to the tool's floor is where that overshoot comes from. A clock
// under the floor is one the tool cannot express, sqlcmd's two clocks being
// whole seconds each, so a call starting on the last millisecond of the budget
// gets the floor and finishes within it of the deadline rather than being
// refused for a millisecond. At the boundary values: one millisecond left is a
// call at the floor, no milliseconds left is no call, and a deadline further
// off than the caller's own budget leaves that budget untouched.
function callBudget(deadline, nowMs, wantMs, floorMs) {
    const remaining = deadline - nowMs;
    if (!(remaining > 0)) return null;
    return Math.max(floorMs, Math.min(wantMs, remaining));
}

// A batch's payload as T-SQL that cannot be read as anything but text.
//
// Three hazards, and the encoding answers all three at once. A record body can
// carry a line that is exactly `GO`, which sqlcmd reads as a batch separator
// wherever it appears, string literal or not. It can carry a $(NAME) reference,
// which sqlcmd substitutes (the spawn passes -x, and this is the belt beside
// it: the dollar sign is escaped with the non-ASCII characters, so no $( from
// a payload is in the batch for a spawn without -x to substitute; a scalar
// rides textLiteral instead, the curator verbs screening theirs at the CLI
// and the model identity held to textLiteral's own charset at the config
// read, where -x is its one belt). And it can carry any
// character at all, which makes the batch file's encoding a question. So the
// JSON is escaped to pure ASCII with the dollar sign, its quotes are
// doubled, and it is appended in bounded pieces: an ASCII payload needs no
// encoding negotiation with the tool, a piece of two thousand characters is
// never a line reading as GO, and the server's own JSON parser turns the
// \uXXXX escapes back into the characters they name.
const PAYLOAD_PIECE_CHARS = 2000;
function payloadLiteral(variable, value) {
    const json = JSON.stringify(value).replace(/[^\x20-\x23\x25-\x7E]/g, (ch) => {
        return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    });
    const lines = [';DECLARE ' + variable + ' NVARCHAR(MAX) = N\'\''];
    for (let at = 0; at < json.length; at += PAYLOAD_PIECE_CHARS) {
        lines.push(';SET ' + variable + ' = ' + variable + ' + N\''
            + json.slice(at, at + PAYLOAD_PIECE_CHARS).replace(/'/g, "''") + '\'');
    }
    return lines.join('\n');
}

// The payload one call's own budget funds, in the pieces above. Two hundred
// thousand characters is the size this module already treats as one comfortable
// call, which is what RECORD_BATCH's fifty record bodies come to.
const PAYLOAD_PIECES_PER_BUDGET = 100;
const PAYLOAD_FUNDED_CHARS = PAYLOAD_PIECE_CHARS * PAYLOAD_PIECES_PER_BUDGET;

// What a call carrying a payload of this many characters may spend, which is the
// caller's own want and never more.
//
// THE CONFIGURED TIMEOUT IS THE CEILING ON ONE CALL, WHATEVER IT CARRIES. The
// run's remaining budget divided down across the clocks that run in sequence is
// what a call's clock is, lifted only to the tool's own floor, so a clock
// derived upward from the payload would put one sqlcmd process past the timeout
// the operator configured, on a machine other sessions' suites and builds share
// and with the session-start publish running detached. The size of
// the payload is the operator's question rather than this client's licence.
//
// So the payload does not move the clock, and what the payload does instead is
// get reported. The server rebuilds the whole variable on each of the SET
// statements above, so the work behind a payload grows with the square of its
// piece count while the clock does not grow at all: past PAYLOAD_FUNDED_CHARS
// the call may be killed on that clock every time it is made, and since the
// drain deletes nothing the next run builds the identical call. The drain
// names that condition with the payload's own size and the clock beside it, so
// the state is legible where it would otherwise only show as a queue that never
// empties. Nothing here repairs it: the clock is the operator's to raise and the
// queue is theirs to look at.
//
// MAX_TIMEOUT_MS is the longest clock this module accepts anywhere, which a
// configured timeout is already held inside, and it stands here as the module's
// own ceiling over any want a caller passes.
function payloadCallMs(wantMs) {
    return Math.min(MAX_TIMEOUT_MS, wantMs);
}

// A scalar string parameter as a literal, or null where the value is not one
// this module will write into a batch.
//
// The escape the payload above uses is unavailable here: \uXXXX means
// something to the server's JSON parser and nothing to its string literals, so
// a scalar's own characters are what reach the batch. The screen is therefore
// the guard rather than the escaping, and it is narrow because the scalars any
// call passes are the embedding model's identity out of the config and the
// record identity a curator verb names, every one of them an identifier the
// store's own gates already hold to a charset inside this one. The empty
// string is a literal like any other, N'', and it is what a curator verb sends
// for a segment a tier does not have; the model identity is held non-empty at
// the config read rather than here.
//
// The width is 200 for every call but one: the adoption's two project keys,
// which a store holds at 400, ride at that width, under the same screen.
const TEXT_LITERAL_WIDTH = 200;
const PROJECT_KEY_WIDTH = 400;
function textLiteral(variable, value, width) {
    const cap = width === undefined ? TEXT_LITERAL_WIDTH : width;
    if (typeof value !== 'string' || value.length > cap) return null;
    if (!/^[\x20-\x7E]*$/.test(value) || value.includes("'")) return null;
    return ';DECLARE ' + variable + ' NVARCHAR(' + cap + ') = N\'' + value + '\'';
}

// The tag a result line carries. Every answer is found by its tag rather than
// by its position, the host probe's rule: the captured stream merges stdout and
// stderr, so a server notice ahead of a result set shifts every index by one.
const RESULT_TAG = 'kitdb-json=';

// Whether the tool's output carries a message the server sent back, which is
// what tells a batch the server rejected from a host this client never reached.
//
// The test is structural rather than a match on what the message says. sqlcmd
// prints a message that arrived over an open connection inside the envelope the
// server addressed it with, its number, severity and state, and it prints
// everything that failed before or beneath a connection under its own `Sqlcmd:`
// prefix instead. So the envelope is evidence that a session existed, that a
// batch reached the server and that the server answered it, and no prose match
// is involved: a closed port, a rejected login and a refused certificate all
// exit non-zero and all speak of a refusal in words, and none of them can
// produce this shape.
//
// Two edges, both falling to the safe side. A server whose messages are
// localized prints another word in place of Msg, which reads here as no
// envelope and so as an outage, which is the conservative answer: a queue that
// keeps its rows through a real defect costs a repeat, where a defect reported
// against a host that merely blinked costs a hunt for a bug that is not there.
// And a server message raised by contention rather than by this batch's own
// contract carries the envelope too: failureCause below reads its number and
// tells a deadlock victim or a lock request timeout apart from a refusal.
const SERVER_MESSAGE_RE = /^Msg (\d+), Level \d+, State \d+/m;
function carriesServerMessage(output) {
    return typeof output === 'string' && SERVER_MESSAGE_RE.test(output);
}

// The server message numbers that name contention with another session rather
// than anything the batch carried: 1205, chosen as a deadlock victim, and 1222,
// a lock request timed out. The same batch sent again lands.
const CONTENTION_MESSAGES = new Set(['1205', '1222']);

// Which of the two a failed spawn is, over the two facts the spawn itself
// answers with: the status it exited with and everything it printed.
//
// A status of null is a kill on this process's own clock. It says nothing at
// all about the server, so it is an outage whatever the tool had printed by
// then: a batch the server was still working on when the clock ran out may
// already have printed a message envelope from some earlier statement, and
// reading that as a refusal would open a contract defect against a host that
// was merely slow. Every other non-zero status is read off the envelope, which
// is what carriesServerMessage states, and an envelope is a refusal unless the
// first envelope's number is a deadlock victim or a lock request timeout. That
// is `contention`, for every caller: the host answered, so it is no outage and
// no host-down marker follows from it, and the same batch sent again lands.
// The first envelope is the first error the server raised for the batch, so a
// message that followed from it does not decide the cause.
function failureCause(status, output) {
    if (status === null) return 'outage';
    if (!carriesServerMessage(output)) return 'outage';
    return CONTENTION_MESSAGES.has(SERVER_MESSAGE_RE.exec(output)[1]) ? 'contention' : 'refused';
}

// Whether a failed call's cause is one where the host answered the batch, a
// refusal or contention, rather than one where it was not there. Reads are
// unchanged by contention: a read meeting contention takes the refusal path,
// so it serves locally with its note and never marks the host down. The queue
// drain and the write door read `contention` apart, and nothing else does.
function hostAnswered(cause) {
    return cause === 'refused' || cause === 'contention';
}

// One sqlcmd run over a batch this module wrote, as {ok, rows, detail, cause}.
//
// `cause` rides on every failure and is `refused` where the server answered the
// batch with a message of its own, `contention` where that message names a
// deadlock victim or a lock request timeout, and `outage` everywhere else,
// which is what lets a caller tell a defect in what it sent from a host that
// was not there. Those have different remedies and the queue's drain reports
// them apart.
//
// The spawn is the host probe's, with three differences the payload forces.
// -y 0 replaces -h -1 and -W, because the tool refuses those flags beside it
// and without it a JSON answer past the default display width is cut silently,
// which is an answer that parses and is wrong. The batch goes in on standard
// input rather than through -i, so a document carrying whole record bodies is
// never a file another account can read: sqlcmd reads its batch from the pipe
// when no input file is named, and -b still reports a failed batch as a
// non-zero status from that leg. The batch itself is pure ASCII, so the tool's
// encoding detection has nothing to get wrong. And the caller's own clock
// bounds the spawn on top of sqlcmd's two, because the stamp path's budget is
// shorter than the one second sqlcmd's flags can express.
//
// It never throws. Every failure is {ok: false} with a bounded detail, because
// every caller here answers a failed call by writing the file-side record it
// was going to write anyway.
function runBatch(config, batch, options) {
    const opts = options || {};
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : DEFAULT_TIMEOUT_MS;
    // The hard kill, which is the caller's own clock rather than sqlcmd's. Its
    // default is the budget plus the spawn's floor, the declared overshoot a
    // call started on the last of its budget is allowed; a caller on the
    // interactive path passes its own, shorter, because a stamp's fallback is
    // lossless and a session's wait is not.
    const killMs = Number.isFinite(opts.killMs) ? opts.killMs : spawnKillMs(budgetMs);
    const tool = sqlcmdPath();
    if (tool === null) {
        return {
            ok: false,
            cause: 'outage',
            detail: 'the SQL client tools are not installed at '
                + path.join(SQLCMD_BASE, PINNED_SQLCMD)
                + ', and this client resolves no other path for them'
        };
    }
    const seconds = clockSeconds(budgetMs);
    if (seconds < 1) {
        return { ok: false, cause: 'outage', detail: 'the budget was spent before this spawn, so none was made' };
    }

    const args = ['-S', config.server, '-d', config.database, '-b', '-I', '-N', '-x', '-y', '0',
        '-l', String(seconds), '-t', String(seconds)];
    if (config.windowsAuth) args.push('-E');
    else args.push('-U', config.login);
    if (config.trustServerCertificate) args.push('-C');

    const env = childEnvironment(config);

    let res = null;
    try {
        res = spawnSync(tool, args, {
            encoding: 'utf8',
            env,
            // The tool's own directory, so the Windows loader's working-directory
            // search for a dependent library lands where the client libraries
            // are rather than wherever this process was started.
            cwd: path.dirname(tool),
            input: batch + '\n',
            timeout: killMs,
            windowsHide: true,
            maxBuffer: 64 * 1024 * 1024
        });
    } catch (err) {
        return { ok: false, cause: 'outage', detail: 'could not run sqlcmd: ' + errText(err) };
    }

    const output = (res.stdout || '') + (res.stderr || '');
    if (res.error) return { ok: false, cause: 'outage', detail: 'could not run sqlcmd: ' + errText(res.error) };
    if (res.status !== 0) {
        // sqlcmd's own words are all a reader gets to tell a certificate
        // refusal from a closed port from a procedure that threw, and they
        // come off a channel this process does not author, so they are
        // bounded and stripped before they reach a line anyone reads. What
        // this client acts on is the envelope rather than those words, which
        // failureCause above states over the status and the output together.
        const killed = res.status === null;
        return {
            ok: false,
            cause: failureCause(res.status, output),
            detail: 'sqlcmd exited ' + (killed ? 'on its caller\'s clock' : res.status)
                + ': ' + memqLib().sanitize(output.replace(/\s+/g, ' '), 300)
        };
    }
    const rows = [];
    for (const line of output.split(/\r?\n/)) {
        const text = line.trimEnd();
        if (!text.startsWith(RESULT_TAG)) continue;
        try {
            rows.push(JSON.parse(text.slice(RESULT_TAG.length)));
        } catch {
            // The batch reached the server and the server answered, so this is
            // not a host that was away: it is an answer in a shape this client
            // cannot read, which is the same version skew a refusal is and takes
            // the same loud disposition.
            return {
                ok: false,
                cause: 'refused',
                detail: 'a result line was not JSON, so the answer could not be read'
            };
        }
    }
    return { ok: true, rows };
}

// One procedure call whose parameters are JSON payloads, as {ok, rows, detail,
// cause}, with `cause` on every failure the way the transport under it answers.
//
// Every parameter is a payload literal, so nothing a caller passes is ever
// concatenated into the EXEC line: the argument list names variables and the
// values arrive through the declarations above it. No value from the config
// reaches the batch text at all: the database name rides sqlcmd's own -d
// argument, and it is held to a plain identifier at the config read because it
// names a database on a command line.
function callProcedure(config, procedure, parameters, options) {
    const opts = options || {};
    const deps = opts.deps || {};
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : config.timeoutMs;
    const declarations = [];
    const argumentList = [];
    let index = 0;
    for (const [name, value] of Object.entries(parameters || {})) {
        index += 1;
        const variable = '@v' + index;
        if (typeof value === 'string') {
            const literal = textLiteral(variable, value, opts.textWidth);
            if (literal === null) {
                // A refusal rather than an outage, and no spawn is made at all:
                // the payload this client composed is one it will not write into
                // a batch, which is a defect in what it sends and has the
                // remedy a refusal has. Reported as an outage it would read as a
                // host that was away and wait for a host that is fine.
                return {
                    ok: false,
                    cause: 'refused',
                    detail: name + ' is not a value this client writes into a batch'
                };
            }
            declarations.push(literal);
        } else {
            declarations.push(payloadLiteral(variable, value));
        }
        argumentList.push(name + ' = ' + variable);
    }
    const batch = [
        ';SET NOCOUNT ON',
        ...declarations,
        ';DECLARE @Answer TABLE ( [Json] NVARCHAR(MAX) NULL )',
        ';INSERT INTO @Answer ( [Json] ) EXEC mem.' + procedure
            + (argumentList.length > 0 ? ' ' + argumentList.join(', ') : ''),
        ";SELECT '" + RESULT_TAG + "' + COALESCE([Json], 'null') FROM @Answer"
    ].join('\n');
    const run = deps.runBatch || runBatch;
    return run(config, batch, { budgetMs, killMs: opts.killMs, procedure });
}

// ------------------------------------------------------- the embedding call --

// One batch of texts embedded on the host, as {ok, vectors, detail}.
//
// The request shape, the abort clock, the bounded body read and the failure
// classification are kit-endpoint-lib's, which is the module that owns this
// boundary: the kit speaks one OpenAI dialect to one host, and a second
// hand-rolled client would be a second set of answers to a slow socket, an
// unread body and a hostile error string.
async function embedBatch(config, texts, options) {
    const opts = options || {};
    const deps = opts.deps || {};
    const fetchImpl = (typeof deps.fetchImpl === 'function') ? deps.fetchImpl : fetch;
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); },
        endpoint.abortDelay(Math.max(budgetMs, EMBEDDING_FLOOR_MS)));
    let res = null;
    try {
        res = await fetchImpl(config.embedding.url + '/v1/embeddings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: config.embedding.model, input: texts }),
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timer);
        // A throw before any response is the transport's: a timeout or a
        // connection the endpoint refused. It leaves the embedder marker, and
        // `transport` tells a caller with more calls queued to stop. Below, a
        // 5xx and an abort while the body streams are transport faults too: a
        // failing server and a stalled one. A 4xx and a body that arrived and
        // does not parse are an endpoint that answered, and leave neither.
        markEmbedderDown();
        return { ok: false, detail: endpoint.classifyThrow(err).detail, transport: true };
    }
    try {
        if (!res || typeof res.status !== 'number') return { ok: false, detail: 'no response object' };
        if (res.status < 200 || res.status >= 300) {
            await endpoint.discardBody(res);
            const failing = res.status >= 500;
            if (failing) markEmbedderDown();
            return { ok: false, detail: 'HTTP ' + res.status + ' from the embedding server', transport: failing };
        }
        const read = await endpoint.readBoundedBody(res);
        if (!read.ok) {
            if (read.throwed !== undefined && endpoint.classifyThrow(read.throwed).status === 'timeout') {
                markEmbedderDown();
                return { ok: false, detail: endpoint.classifyThrow(read.throwed).detail, transport: true };
            }
            return { ok: false, detail: read.detail || 'the response body could not be read' };
        }
        const body = read.body;
        const data = (body !== null && typeof body === 'object' && Array.isArray(body.data)) ? body.data : null;
        if (data === null || data.length !== texts.length) {
            return { ok: false, detail: 'the server answered ' + (data === null ? 'no data array' : data.length + ' vectors')
                + ' for ' + texts.length + ' text(s)' };
        }
        const vectors = [];
        for (const entry of data) {
            const vector = (entry !== null && typeof entry === 'object') ? entry.embedding : null;
            if (!Array.isArray(vector) || vector.length === 0 || !vector.every((n) => Number.isFinite(n))) {
                return { ok: false, detail: 'the server answered something that is not a vector' };
            }
            vectors.push(vector);
        }
        return { ok: true, vectors };
    } catch (err) {
        return { ok: false, detail: endpoint.classifyThrow(err).detail };
    } finally {
        clearTimeout(timer);
    }
}

// Texts in one embedding call: the local sweep's batch width, or fewer where a
// response that wide would not fit the bound its reader holds it under.
function embedCallWidth() {
    const room = endpoint.MAX_BODY_BYTES - EMBED_RESPONSE_OVERHEAD_BYTES;
    const perVector = EMBED_VECTOR_DIMENSIONS * EMBED_FLOAT_BYTES;
    return Math.max(1, Math.min(indexLib().EMBED_BATCH, Math.floor(room / perVector)));
}

// ----------------------------------------------------------------- the queries --

// How much of a caller's query text reaches the host. mem.usp_Search normalizes
// and caps its own predicate at four thousand characters, and JSON_VALUE hands
// back at most that many, so a longer text would arrive as a null query text and
// silently disable the two lexical lists. Cut here instead, where the cut is a
// fact this side knows about.
const QUERY_TEXT_CAP = 4000;

// The first QUERY_TEXT_CAP characters of a query text, stepped back off a high
// surrogate a plain slice would leave without its pair. The judged fleet
// block's search embeds this same head, so the cap bounds the embedding input
// too: about a thousand tokens of English text, inside the embedding model's
// 2,048, while text that is mostly CJK or emoji runs near a token a character
// and can still pass it.
function queryHead(text) {
    const head = text.slice(0, QUERY_TEXT_CAP);
    const last = head.charCodeAt(head.length - 1);
    return last >= 0xD800 && last <= 0xDBFF ? head.slice(0, -1) : head;
}

// The most rows either query procedure serves. Both clamp an oversized request
// to fifty of their own accord; asking for more is asking for a number the host
// will not answer with, which reads to a caller as a short result rather than as
// a clamp.
const QUERY_LIMIT_MAX = 50;

// The schema version the hybrid search's answer carries a distance in, and the
// floor the shared search stands down below.
//
// THE VERSION IS NEGOTIATED RATHER THAN INFERRED FROM THE ANSWER, AND NOT
// BECAUSE THE ANSWER CANNOT BE READ. It can: mem.usp_Search projects its rows
// with INCLUDE_NULL_VALUES, so a version 3 host emits an explicit null distance
// for a record only its lexical lists ranked, while a version 2 host emits no
// distance key at all. Those are different bytes and a client could tell them
// apart.
//
// The gate is here for what reading the field would cost, not for an ambiguity
// that is not there. Inferring decides per row, and it decides only once the
// query's text has already been embedded and sent to the host. Negotiating
// decides once, on the probe this path already spends, ahead of the embedding
// call, so a host that cannot answer this query is never sent its text at all.
// What the gate buys is that an old host serves nothing, rather than serving a
// whole ranking with no floor applied to any of it under a note saying the
// shared index answered, which is this channel's expensive failure.
//
// The nearest scan takes no such gate for its distance: mem.usp_Nearest has
// returned one since version 1, and its answer means the same thing on every host
// that has the procedure at all. The one gate it does take is the next constant's,
// and only for a caller asking it for archived rows.
const SEARCH_SCHEMA_VERSION = 3;

// The schema version whose mem.usp_Nearest takes @p_IncludeArchived and labels
// each row with its archived flag, and the floor a nearest scan asking for
// archived rows stands down below.
//
// A lower host has no such parameter, so a batch naming it is refused with an
// argument error. The gate stands ahead of that call for a reason beyond the
// error: the caller asking is the write-time neighbours check, whose whole
// question is whether a near-duplicate exists, live or retired. A live-only
// answer handed back in its place would be exactly the silence the flag exists
// to end, so an old host serves that caller nothing and says why. A nearest
// scan that does not ask names no such parameter, and is served on any host.
const NEAREST_ARCHIVED_SCHEMA_VERSION = 4;

// The schema version whose mem.usp_Search takes @p_Segment and @p_Tag, and the
// floor a search asking for either stands down below.
//
// Both parameters narrow the population the search ranks, so a lower host,
// which has neither and refuses a batch naming one, is never sent a scoped
// call: an answer over every visible row handed back in its place is the
// fleet's records under a caller's own-segment question, which is exactly
// what the cut exists to prevent. A search asking for neither names neither
// parameter and is served on any host at SEARCH_SCHEMA_VERSION or later.
const SCOPED_SEARCH_SCHEMA_VERSION = 6;

// The schema version where the database holds the record, and the floor a
// publish stands down below. A version 7 host lands each project record in its
// key's fleet store and answers with the twins it resolved; a lower host reads
// no key and would file every record in the older per-sandbox stores, so it is
// sent nothing and the sentence names the installer. The queue drain keeps its
// own floor, REQUIRED_SCHEMA_VERSION.
const RECORD_SCHEMA_VERSION = 7;

// The widths mem.usp_Search declares @p_Segment and @p_Tag at. The batch
// declares its variables at the same widths, and a longer value would be cut
// there silently and then match a different segment or tag, so queryHost
// refuses one before anything is sent.
const SEARCH_SEGMENT_CAP = 400;
const SEARCH_TAG_CAP = 200;

// The interval a cosine distance can occupy, which is what a distance crossing
// this boundary is held to. Two vectors' cosine similarity lies in [-1, 1], so
// the distance the server computes lies in [0, 2]. A value outside it is not a
// distance, whatever the field is called, and a similarity derived from one
// clears every floor on this path and prints as a number a reader takes for a
// cosine.
const DISTANCE_MIN = 0;
const DISTANCE_MAX = 2;

// The whole of one query's clock, over the three boundary calls it makes: the
// reachability probe, the embedding call and the procedure call. Each takes its
// own clock inside this deadline, so the chain is bounded once rather than each
// link separately.
//
// THE PROBE'S BUDGET IS THIS CLIENT'S OWN AND NEVER AN INTERACTIVE CHANNEL'S.
// PROBE_TIMEOUT_MS states why: a sqlcmd spawn's two clocks are whole seconds
// each, so a shorter budget refuses a healthy host whose login takes over a
// second and reports it as an outage.
function queryBudgetMs(config) {
    return PROBE_TIMEOUT_MS + config.timeoutMs;
}

// The reachability probe, one spawn at the module's own probe budget, so an
// unreachable host is discovered in about the time one spawn costs rather than
// at the full configured timeout. The publish leg spends the same call for the
// same reason and through the same procedure.
function probeHost(config, options) {
    const opts = options || {};
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : PROBE_TIMEOUT_MS;
    return callProcedure(config, 'usp_Health', {},
        { deps: opts.deps, budgetMs, killMs: budgetMs + SQLCMD_FLOOR_MS });
}

// One query call's batch: the vector and the text as one payload, declared into
// the types the two procedures take, and the procedure invoked on variables.
//
// callProcedure is not the route here, because both procedures take typed
// scalars rather than the JSON documents every publisher procedure takes: a
// VECTOR(1024) and an NVARCHAR the caller's own words arrive in. So the payload
// carries both values and the batch casts them out of it, the cast being the one
// mem.usp_UpsertEmbeddings already writes over the same JSON array text.
//
// NOTHING A CALLER SUPPLIES IS CONCATENATED INTO THIS BATCH. The query text and
// the vector ride payloadLiteral, which escapes the JSON to pure ASCII, doubles
// its quotes and appends it in bounded pieces, so no line of it can read as a
// batch separator or a variable reference. The limit is written out from a digit
// string this function derives rather than from the caller's own number, and the
// archived flag is the literal 1 this function chooses when `includeArchived` is
// exactly true, never a value the caller supplied. The model identity takes
// textLiteral, the screen the config read already held it to. A search's
// segment and tag ride the payload beside the text, since a segment may run to
// SEARCH_SEGMENT_CAP characters of any script and textLiteral takes neither.
//
// The flag is named only where it is asked for. Its default is 0, so leaving it
// out asks the same question, and a host below NEAREST_ARCHIVED_SCHEMA_VERSION
// has no such parameter and refuses a call that names it: a nearest scan that
// does not ask keeps a batch every host with the procedure answers. A search's
// segment and tag follow the same rule: each is in the payload, declared and
// named only where `scope` carries it as a non-empty string, so a search naming
// neither is the batch a host at SEARCH_SCHEMA_VERSION answers.
function queryBatch(procedure, vector, text, limit, model, includeArchived, scope) {
    const modelLiteral = textLiteral('@Model', model);
    if (modelLiteral === null) return null;
    const bounded = Math.max(1, Math.min(QUERY_LIMIT_MAX, Math.floor(limit)));
    const asked = (value) => procedure === 'usp_Search' && typeof value === 'string' && value !== '';
    const segment = scope && asked(scope.segment) ? scope.segment : null;
    const tag = scope && asked(scope.tag) ? scope.tag : null;
    const payload = { vector, text: queryHead(text) };
    if (segment !== null) payload.segment = segment;
    if (tag !== null) payload.tag = tag;
    const argumentList = procedure === 'usp_Nearest'
        ? '@p_Vector = @QueryVector, @p_Limit = @Limit, @p_ModelIdentity = @Model'
            + (includeArchived === true ? ', @p_IncludeArchived = 1' : '')
        : '@p_QueryText = @QueryText, @p_QueryVector = @QueryVector,'
            + ' @p_Limit = @Limit, @p_ModelIdentity = @Model'
            + (segment !== null ? ', @p_Segment = @Segment' : '')
            + (tag !== null ? ', @p_Tag = @Tag' : '');
    const lines = [
        ';SET NOCOUNT ON',
        payloadLiteral('@Query', payload),
        ';DECLARE @QueryVector VECTOR(' + EMBED_VECTOR_DIMENSIONS
            + ') = CAST(JSON_QUERY(@Query, \'$.vector\') AS VECTOR('
            + EMBED_VECTOR_DIMENSIONS + '))',
        ';DECLARE @QueryText NVARCHAR(' + QUERY_TEXT_CAP + ') = JSON_VALUE(@Query, \'$.text\')'
    ];
    if (segment !== null) {
        lines.push(';DECLARE @Segment NVARCHAR(' + SEARCH_SEGMENT_CAP + ') = JSON_VALUE(@Query, \'$.segment\')');
    }
    if (tag !== null) {
        lines.push(';DECLARE @Tag NVARCHAR(' + SEARCH_TAG_CAP + ') = JSON_VALUE(@Query, \'$.tag\')');
    }
    lines.push(
        ';DECLARE @Limit INT = ' + String(bounded),
        modelLiteral,
        ';DECLARE @Answer TABLE ( [Json] NVARCHAR(MAX) NULL )',
        ';INSERT INTO @Answer ( [Json] ) EXEC mem.' + procedure + ' ' + argumentList,
        ';SELECT \'' + RESULT_TAG + '\' + COALESCE([Json], \'null\') FROM @Answer'
    );
    return lines.join('\n');
}

// The rows of a query answer, as the array the procedure's own FOR JSON built.
//
// Each procedure composes its whole answer as one scalar subquery, so one row
// with one column comes back however many records it names; an answer of any
// other shape is a host this client cannot read rather than a host with nothing
// to say, and it reads here as no rows.
function queryRows(run) {
    const first = Array.isArray(run.rows) && run.rows.length > 0 ? run.rows[0] : null;
    return Array.isArray(first) ? first : [];
}

// One answered row as this client hands it on: the fields both procedures
// return, each held to the type it is read as, with a similarity in the place
// each procedure states its ranking in.
//
// ONE QUANTITY CARRIES THE SIMILARITY ON BOTH PATHS, AND IT IS THE DISTANCE.
// Both procedures return the cosine distance of the record's best chunk, and one
// minus it is a similarity on the scale of the host's embedding model. A floor
// means nothing without the model that produced the number beside it, which is
// why memq binds the floor pair to the hit where the hit is built (fleetHit)
// and every reader asks clearsFloor rather than naming a floor. The fused score mem.usp_Search also returns is a sum
// over four ranked lists on no comparable scale at all, so it is not carried
// here and no surface prints it.
//
// A hybrid search row with no distance is a record the two lexical lists found
// and neither vector list ranked, which mem.usp_Search returns by design: the
// full-text lists match on a token the record holds, so the row is an answer and
// its similarity is simply not a number this side has. It is carried with a null
// score and the surfaces that would print one print nothing. The nearest scan is
// the other case: a distance is the whole of what it ranks on, so a row without
// one is malformed and is dropped. A distance present but not a number, or one
// outside the interval a cosine distance occupies, is malformed on either path
// and is dropped with it: every other value crossing this boundary is held to
// its type and its length, and this one is held to its range for the same
// reason. That the host is one this client's own version gate admitted is no
// warrant for the numbers inside its answer.
//
// The two lexical ranks ride along because a floor written for a similarity
// cannot speak to a row that has none, and these are how a reader of this hit
// tells the two cases apart: a row with no distance that a full-text list
// ranked is an answer on evidence of its own, where a row no list ranked at all
// is not there to begin with.
//
// The record id rides along because it is the one field that names a row
// exactly. A fleet project row comes back with no segment, its store being
// keyed by project key alone, so a reader placing a ranked row against the
// index rows it already holds matches on the id. An id that is not a number
// reads as null, which places the row nowhere.
//
// A row missing a field it must have is dropped rather than repaired. Every one
// of these values crosses a machine boundary, so the shape is checked here and
// the display reductions are left to the channel that prints them.
function queryHit(row, procedure) {
    if (row === null || typeof row !== 'object') return null;
    if (typeof row.name !== 'string' || row.name === '') return null;
    if (typeof row.tier !== 'string' || row.tier === '') return null;
    const stated = row.distance !== null && row.distance !== undefined;
    if (stated && !(Number.isFinite(row.distance)
        && row.distance >= DISTANCE_MIN && row.distance <= DISTANCE_MAX)) {
        return null;
    }
    if (!stated && procedure === 'usp_Nearest') return null;
    const score = stated ? 1 - row.distance : null;
    return {
        recordId: Number.isFinite(row.recordId) ? row.recordId : null,
        name: row.name,
        fileKey: typeof row.fileKey === 'string' ? row.fileKey : '',
        tier: row.tier,
        segment: typeof row.segment === 'string' ? row.segment : '',
        sandbox: typeof row.sandbox === 'string' ? row.sandbox : '',
        visibility: typeof row.visibility === 'string' ? row.visibility : '',
        description: typeof row.description === 'string' ? row.description : '',
        archived: row.archived === true || row.archived === 1,
        score,
        descriptionRank: rankOf(row.descriptionRank),
        bodyRank: rankOf(row.bodyRank)
    };
}

// A candidate list's rank position as this client reads it, or null where that
// list did not vote. The procedures answer a rank as a positive integer and
// null otherwise, so anything else is a value this side cannot place and reads
// as no vote, which is the safe direction: a floor applies to a row this client
// could not prove a lexical vote for.
function rankOf(value) {
    return (Number.isFinite(value) && value > 0) ? value : null;
}

// The query side of this client, as {ok, lists} or a stand-down a caller prints
// and then serves its local answer instead.
//
// One text per list, in the order they were passed, so a caller asking about
// several records reads its answers back positionally. `mode` is which procedure
// answers: the hybrid search for a query a person typed, the nearest scan for a
// record whose own text is the query. `includeArchived`, exactly true, asks the
// nearest scan to rank archived records beside live ones; it means nothing to
// the hybrid search, which serves them already. `segment` and `tag`, each a
// non-empty string, ask the hybrid search to rank only that project segment's
// records, or only records carrying that tag; an empty string or any other
// value asks for neither, and the nearest scan takes neither.
//
// EVERY VECTOR THAT REACHES THE HOST IS ONE THE HOST'S OWN EMBEDDER MADE. The
// local index's model is a different model at 384 dimensions, and its vectors
// compare with nothing the fleet holds, so a local vector on this path would
// either be refused by a VECTOR(1024) parameter or, worse, rank against the
// wrong space. The width screen below is that rule made mechanical: a vector of
// any other width stands the query down and nothing is sent.
//
// It never throws and it never falls back. A caller that meets a stand-down
// prints it and runs whatever it would have run without a database at all,
// which is what keeps a host condition from failing a search.
//
// `signal` is how a caller under a clock of its own stops paying for an answer
// nobody is left to read, the shape memq's local ranking takes for the same
// condition: it is read before each of the three boundary calls below, so the
// spawns and the HTTP request after an abort are never made.
async function queryHost(options) {
    const opts = options || {};
    const mode = opts.mode === 'nearest' ? 'nearest' : 'search';
    const procedure = mode === 'nearest' ? 'usp_Nearest' : 'usp_Search';
    const includeArchived = mode === 'nearest' && opts.includeArchived === true;
    const loaded = hostConfig(opts);
    if (!loaded.ok) {
        return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    }
    const config = loaded.config;
    const deps = opts.deps || {};
    const texts = (Array.isArray(opts.texts) ? opts.texts : [])
        .filter((t) => typeof t === 'string' && t.trim() !== '');
    if (texts.length === 0) return { ok: true, lists: [] };
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 10;

    // The scope a search asks for, each part null where it is not asked. A
    // value past the width the procedure declares would be cut in the batch's
    // own declaration and then match a different segment or tag than the one
    // asked for, so it is refused here, before the probe, with nothing sent.
    const scopedValue = (value) => (mode === 'search' && typeof value === 'string' && value !== ''
        ? value : null);
    const scope = { segment: scopedValue(opts.segment), tag: scopedValue(opts.tag) };
    const scoped = scope.segment !== null || scope.tag !== null;
    for (const [what, value, cap] of [['segment', scope.segment, SEARCH_SEGMENT_CAP],
        ['tag', scope.tag, SEARCH_TAG_CAP]]) {
        if (value !== null && value.length > cap) {
            return {
                ok: false,
                standDown: 'refused',
                detail: 'the search ' + what + ' runs to ' + value.length + ' characters where the'
                    + ' shared search reads at most ' + cap + ', so no query was sent'
            };
        }
    }

    // The run's one deadline and the two questions every call below asks of it,
    // publish's own shape: whether the call may start at all, and what clock it
    // gets if it does. A caller with a shorter budget of its own passes it, and
    // the session-start block is the caller that does.
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : queryBudgetMs(config);
    const deadline = now() + budgetMs;
    const budgetFor = (wantMs, floorMs) => callBudget(deadline, now(), wantMs, floorMs);
    const spent = (what) => ({
        ok: false,
        standDown: 'budget',
        detail: 'the ' + budgetMs + ' ms this query may spend was gone before ' + what
    });

    // The caller's own cancellation, read at the same three points the deadline
    // is: before the probe, before each embedding call and before each procedure
    // call. A caller whose signal is aborted has already printed whatever it
    // says instead of this answer, and the calls below are a detached spawn and
    // an HTTP request apiece, so what an abort buys is every call after the one
    // already in flight. It is a stand-down like any other, so a caller that did
    // keep the promise around reads a reason rather than a hole.
    const abandoned = () => ((opts.signal && opts.signal.aborted)
        ? {
            ok: false,
            standDown: 'cancelled',
            detail: 'this query was abandoned before it answered'
        }
        : null);

    // A batch the host answered with a refusal, the probe's or a query's, handed
    // on as a whole sentence, standDownText's contract for that word: what the
    // server said is the remedy, where an outage is a host to wait for.
    const refusedQuery = (detail) => ({
        ok: false,
        standDown: 'refused',
        detail: 'the memory database refused this query: ' + detail
    });

    const beforeProbe = abandoned();
    if (beforeProbe !== null) return beforeProbe;
    // Section 3's down marker, read before the probe and left by a probe the
    // host did not answer, so a host that failed inside the marker's window
    // costs this query no spawn and no embedding call. A refusal is a host
    // that answered, and leaves no marker.
    if (hostMarkedDown(now())) return { ok: false, standDown: 'down', detail: hostDownDetail() };
    const probeMs = budgetFor(PROBE_TIMEOUT_MS, SQLCMD_FLOOR_MS);
    if (probeMs === null) return spent('the reachability probe');
    const probe = probeHost(config, { deps, budgetMs: probeMs });
    if (!probe.ok) {
        if (hostAnswered(probe.cause)) return refusedQuery(probe.detail);
        markHostDown();
        return { ok: false, standDown: 'unreachable', detail: probe.detail };
    }

    // The version gate, on the answer the probe already carries rather than on a
    // second call for a number this query holds, the publish leg's own reading
    // of the same field. It stands ahead of the embedding call, so a host that
    // cannot answer this query is not sent its text either.
    if (mode === 'search') {
        const hostSchema = Number(counted(probe.rows).schemaVersion);
        if (!(Number.isFinite(hostSchema) && hostSchema >= SEARCH_SCHEMA_VERSION)) {
            const found = Number.isFinite(hostSchema)
                ? 'schema version ' + hostSchema : 'no schema version at all';
            return {
                ok: false,
                standDown: 'schema',
                detail: 'the memory database reports ' + found + ' where the shared search needs'
                    + ' version ' + SEARCH_SCHEMA_VERSION + ', whose rows carry the distance this'
                    + ' client ranks on; re-run Install-MemoryDatabase.ps1 against the host'
            };
        }
        if (scoped && hostSchema < SCOPED_SEARCH_SCHEMA_VERSION) {
            return {
                ok: false,
                standDown: 'schema',
                detail: 'the memory database reports schema version ' + hostSchema + ' where the'
                    + ' shared search scoped to a segment or a tag needs version '
                    + SCOPED_SEARCH_SCHEMA_VERSION + ', whose search takes @p_Segment and @p_Tag;'
                    + ' re-run Install-MemoryDatabase.ps1 against the host'
            };
        }
    }
    if (includeArchived) {
        const hostSchema = Number(counted(probe.rows).schemaVersion);
        if (!(Number.isFinite(hostSchema) && hostSchema >= NEAREST_ARCHIVED_SCHEMA_VERSION)) {
            const found = Number.isFinite(hostSchema)
                ? 'schema version ' + hostSchema : 'no schema version at all';
            return {
                ok: false,
                standDown: 'schema',
                detail: 'the memory database reports ' + found + ' where the shared neighbours'
                    + ' scan needs version ' + NEAREST_ARCHIVED_SCHEMA_VERSION + ', whose nearest'
                    + ' scan can rank retired records; re-run Install-MemoryDatabase.ps1 against'
                    + ' the host'
            };
        }
    }

    // Every text embedded on the host, in the batches one response fits, before
    // any procedure call is made. The vectors are what the procedures rank on,
    // so a host that will not embed is a query that cannot be asked at all and
    // the sqlcmd spawns are never spent on it.
    const vectors = [];
    const width = embedCallWidth();
    for (let at = 0; at < texts.length; at += width) {
        const beforeEmbed = abandoned();
        if (beforeEmbed !== null) return beforeEmbed;
        const embedMs = budgetFor(config.timeoutMs, EMBEDDING_FLOOR_MS);
        if (embedMs === null) return spent('the embedding call');
        const answered = await (deps.embedBatch || embedBatch)(config,
            texts.slice(at, at + width), { deps, budgetMs: embedMs });
        if (!answered.ok) {
            return {
                ok: false,
                standDown: 'unreachable',
                detail: 'the embedding server did not answer: ' + answered.detail
            };
        }
        for (const vector of answered.vectors) {
            if (vector.length !== EMBED_VECTOR_DIMENSIONS) {
                return {
                    ok: false,
                    standDown: 'refused',
                    detail: 'the embedding server answered a vector of ' + vector.length
                        + ' dimensions where this database holds ' + EMBED_VECTOR_DIMENSIONS
                        + ', so no vector was sent'
                };
            }
            vectors.push(vector);
        }
    }

    const lists = [];
    for (let at = 0; at < texts.length; at++) {
        const beforeCall = abandoned();
        if (beforeCall !== null) return beforeCall;
        const callMs = budgetFor(config.timeoutMs, SQLCMD_FLOOR_MS);
        if (callMs === null) return spent('a ' + procedure + ' call');
        const batch = queryBatch(procedure, vectors[at], texts[at], limit, modelIdentity(config),
            includeArchived, scope);
        if (batch === null) {
            return {
                ok: false,
                standDown: 'refused',
                detail: 'the embedding model identity is not a value this client writes into a batch'
            };
        }
        const run = (deps.runBatch || runBatch)(config, batch, { budgetMs: callMs, procedure });
        if (!run.ok) {
            return hostAnswered(run.cause)
                ? refusedQuery(run.detail)
                : { ok: false, standDown: 'unreachable', detail: run.detail };
        }
        lists.push(queryRows(run).map((row) => queryHit(row, procedure)).filter((h) => h !== null));
    }
    return { ok: true, lists };
}

// ------------------------------------------------------------- the curator --

// The config as the curator presents it, or the one refusal a curator verb has
// of its own.
//
// The curator is a second login on the same host and database, so the
// connection it makes differs from a publisher's in the credential alone: the
// same server, the same database, the same clocks, the same child environment
// with the password in SQLCMDPASSWORD. It is never Windows authentication,
// because the curator role is a SQL login the installer creates, and a config
// under windowsAuth holds no curator at all. A machine whose config carries no
// pair is an ordinary publisher, and the refusal names the two fields so the
// remedy is the config rather than the host.
function curatorConfig(loaded) {
    if (!loaded.ok) {
        return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    }
    // A config loadConfig read carries the key as null where no pair was given;
    // one a caller handed in whole may not carry it at all, and that is the
    // same absence.
    if (!loaded.config.curator) {
        return {
            ok: false,
            standDown: 'curator',
            detail: 'no curator login is configured in ' + loaded.path
                + ' (curatorLogin and curatorPassword are absent), and this verb runs under'
                + ' the curator role alone'
        };
    }
    return {
        ok: true,
        path: loaded.path,
        config: {
            ...loaded.config,
            login: loaded.config.curator.login,
            password: loaded.config.curator.password,
            windowsAuth: false
        }
    };
}

// One procedure call under the curator, as {ok, rows} or a stand-down, on the
// run's deadline and the call's own clock the query side keeps.
//
// A refusal is handed on as a whole sentence with the server's own words
// inside it, standDownText's contract for that word. Every refusal a curator
// procedure raises is a sentence the procedure composed for a person to read,
// the role check and the identity that matched no row among them, and those
// words are the whole remedy: paraphrased they would name the wrong thing.
function curatorCall(config, procedure, parameters, options) {
    const opts = options || {};
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const callMs = callBudget(opts.deadline, now(), config.timeoutMs, SQLCMD_FLOOR_MS);
    if (callMs === null) {
        return {
            ok: false,
            standDown: 'budget',
            detail: 'the ' + opts.budgetMs + ' ms this verb may spend was gone before a '
                + procedure + ' call'
        };
    }
    const run = callProcedure(config, procedure, parameters, { deps, budgetMs: callMs });
    if (!run.ok) {
        return hostAnswered(run.cause)
            ? {
                ok: false,
                standDown: 'refused',
                // The role rides on the sentence because the host's own refusal
                // names an object rather than a role: a publisher login is denied
                // EXECUTE on the procedure outright (010-Roles.sql), so it never
                // reaches the procedure's own mem_curator check and the server
                // text it gets is Msg 229 naming the object.
                detail: run.cause === 'contention'
                    ? 'the memory database chose this ' + procedure + ' call as a deadlock victim or timed out its '
                        + 'lock request: ' + run.detail + '; another session held the rows it needed, so run the verb again'
                    : 'this verb runs under the mem_curator role, and the memory database refused this '
                        + procedure + ' call: ' + run.detail
            }
            : { ok: false, standDown: 'unreachable', detail: run.detail };
    }
    return { ok: true, rows: run.rows };
}

// The whole of `memq db-promote`: one private record flipped to shared through
// mem.usp_PromoteRecord, as {ok, record} or a stand-down.
//
// The record is named by its identity on the host, which is the sandbox that
// owns it, its tier and segment, and its name, exactly as the procedure takes
// them. Nothing here resolves that identity against a file: the promote is a
// fact about the host's rows, and a record this machine's store no longer
// holds is still the host's to flip.
function promoteRecord(options) {
    const opts = options || {};
    const loaded = curatorConfig(hostConfig(opts));
    if (!loaded.ok) return loaded;
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : config.timeoutMs;
    const deadline = now() + budgetMs;
    const call = curatorCall(config, 'usp_PromoteRecord', {
        '@p_SandboxName': String(opts.sandbox),
        '@p_Segment': String(opts.segment),
        '@p_Name': String(opts.name),
        '@p_Tier': String(opts.tier)
    }, { deps, deadline, budgetMs });
    if (!call.ok) return call;
    const record = counted(call.rows);
    return { ok: true, record: { recordId: record.recordId, name: record.name, visibility: record.visibility } };
}

// The three curation queries, by the flag that asks for each: the procedure
// and the parameters it takes.
const CURATION_QUERIES = {
    unapplied: { procedure: 'usp_CurationUnapplied', parameters: (days) => ({ '@p_Days': days }) },
    superseded: { procedure: 'usp_CurationSupersededLive', parameters: () => ({}) },
    orphans: { procedure: 'usp_CurationOrphans', parameters: () => ({}) }
};

// The whole of `memq db-curate`: each query the caller asked for, run under the
// curator, as {ok, answers} or a stand-down.
//
// `asked` names the queries in the order they run, and `unappliedDays` is the
// window the first one takes. Each answer is the procedure's own JSON value,
// an array for the first two and the two-list object for the third, and it is
// handed back unshaped: the lines a person reads are the CLI's to compose, in
// the store's own line shape, and this module states nothing about how a row
// prints.
//
// The run's deadline funds one configured timeout per query rather than one
// for the run, since the queries are independent calls and a slow first one is
// no reason to starve the third. An outage stops the run where it stands, the
// drain's rule: the next call would spend a whole spawn's clock discovering the
// same silence. A refusal is a fact about one procedure and stops the run too,
// because every one of these procedures refuses on the same ground, the
// caller's role, and a second call would draw the same sentence.
function curate(options) {
    const opts = options || {};
    const loaded = curatorConfig(hostConfig(opts));
    if (!loaded.ok) return loaded;
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const asked = (Array.isArray(opts.asked) ? opts.asked : []).filter((k) => k in CURATION_QUERIES);
    // The unapplied query takes a day count, and a caller asking for it
    // without one is refused here rather than by a literal builder handed
    // undefined. The CLI always sets it; this is the module API's guard.
    if (asked.includes('unapplied') && !Number.isInteger(opts.unappliedDays)) {
        return { ok: false, standDown: 'curator', detail: 'the unapplied query needs a whole day count (unappliedDays), and none was given' };
    }
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : config.timeoutMs * asked.length;
    const deadline = now() + budgetMs;
    const answers = {};
    for (const key of asked) {
        const query = CURATION_QUERIES[key];
        const call = curatorCall(config, query.procedure, query.parameters(opts.unappliedDays),
            { deps, deadline, budgetMs });
        if (!call.ok) return call;
        answers[key] = counted(call.rows);
    }
    return { ok: true, answers };
}

// The doctor's reading of the host: mem.usp_Health under the config's own
// publisher login, plus the local queue's depth, as one object the doctor step
// prints its verdict from.
//
// {ok: true, health, queueDepth, path} where the host answered, and a stand-down
// with the same queueDepth beside it where it did not, since a queue that is
// filling is worth reporting whatever the host is doing. queueDepth is null
// where the queue could not be counted, never zero: a zero there would report a
// full queue as an empty one. A queue file that does not exist is an empty
// queue and is not created to be counted, since the doctor reports on the
// store and writes nothing into it. The queue file is named from the store root
// the caller passes rather than resolved here, because the doctor is the caller
// and the store root is the one path it already knows.
function hostHealth(options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    const queueFile = typeof opts.storeRoot === 'string' && opts.storeRoot !== ''
        ? path.join(opts.storeRoot, QUEUE_FILE) : queuePath();
    const queueDepthValue = fs.existsSync(queueFile) ? queueDepth(queueFile) : 0;
    if (!loaded.ok) {
        return {
            ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path,
            queueDepth: queueDepthValue
        };
    }
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : queryBudgetMs(config);
    const deadline = now() + budgetMs;
    const callMs = callBudget(deadline, now(), config.timeoutMs, SQLCMD_FLOOR_MS);
    const run = callProcedure(config, 'usp_Health', { '@p_ModelIdentity': modelIdentity(config) },
        { deps, budgetMs: callMs });
    if (!run.ok) {
        return {
            ok: false,
            standDown: hostAnswered(run.cause) ? 'refused' : 'unreachable',
            detail: hostAnswered(run.cause)
                ? 'the memory database refused this usp_Health call: ' + run.detail : run.detail,
            path: loaded.path,
            queueDepth: queueDepthValue
        };
    }
    return { ok: true, health: counted(run.rows), queueDepth: queueDepthValue, path: loaded.path };
}

// The judge calibration counts: mem.usp_JevCalibration under the config's own
// publisher login, as {ok: true, bands} or a stand-down. `bands` is the
// procedure's own array, one {band, rows, reads} per score band, handed back
// unshaped: the lines a person reads are the CLI's to compose. `sinceDays`, a
// whole number of days or null, is the window, and a null names no parameter
// so the procedure's own default of every row stands.
function jevCalibration(options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : queryBudgetMs(config);
    const deadline = now() + budgetMs;
    const callMs = callBudget(deadline, now(), config.timeoutMs, SQLCMD_FLOOR_MS);
    const parameters = Number.isInteger(opts.sinceDays) ? { '@p_SinceDays': opts.sinceDays } : {};
    const run = callProcedure(config, 'usp_JevCalibration', parameters, { deps, budgetMs: callMs });
    if (!run.ok) {
        return {
            ok: false,
            standDown: hostAnswered(run.cause) ? 'refused' : 'unreachable',
            detail: hostAnswered(run.cause)
                ? 'the memory database refused this usp_JevCalibration call: ' + run.detail : run.detail,
            path: loaded.path
        };
    }
    const bands = counted(run.rows);
    return { ok: true, bands: Array.isArray(bands) ? bands : [] };
}

// ---------------------------------------------------------------- chunking --

// A body as ordered chunks, each {text, offset, length}, or a refusal.
//
// Paragraphs are the split, because a paragraph is where a memory changes
// subject and a chunk that spans two subjects matches both weakly. Paragraphs
// accumulate until the target is reached; one paragraph longer than the ceiling
// is cut at the target through safeCut, which backs a cut off a surrogate pair
// and prefers the last whitespace in a short window before it, since a body with
// no paragraph break at all is still a body worth finding. Every offset is into
// the body as it stands, so a chunk's own text can be located in the record a
// reader opens.
// Where a hard cut at `to` may actually land. Two properties, in order: the
// cut never falls between the halves of a surrogate pair, and it prefers the
// last whitespace in a short window before the target.
//
// The first is a correctness bar rather than a nicety. A JavaScript string
// index addresses UTF-16 code units, so a cut through an astral character
// (an emoji, most CJK extension characters) leaves a lone surrogate, which
// JSON.stringify writes as an unpaired \uD8xx escape and the embedding
// server's JSON parser rejects. Such a record would then fail to embed on
// every run for as long as it stood. The second keeps a cut off the middle of
// a word where a break is cheaply available. Progress is guaranteed: nothing
// here can return a position at or before `from`.
const CUT_BACKOFF_CHARS = 64;
function safeCut(text, from, to) {
    if (to >= text.length) return text.length;
    let cut = to;
    const floor = from + 1;
    for (let at = cut; at > cut - CUT_BACKOFF_CHARS && at > floor; at -= 1) {
        if (/\s/.test(text[at - 1])) { cut = at; break; }
    }
    // A high surrogate at the end of the piece means its pair opens the next
    // one, so the cut steps back off it.
    while (cut > floor) {
        const code = text.charCodeAt(cut - 1);
        if (code < 0xD800 || code > 0xDBFF) break;
        cut -= 1;
    }
    return cut;
}

function chunkBody(body) {
    const text = typeof body === 'string' ? body : '';
    if (text.trim() === '') return [];
    const chunks = [];
    let start = 0;
    let end = 0;
    const push = (from, to) => {
        const piece = text.slice(from, to);
        if (piece.trim() !== '') chunks.push({ text: piece, offset: from, length: piece.length });
    };
    // The paragraph walk: every separator stays with the paragraph it follows,
    // so the offsets partition the body with nothing dropped between chunks.
    const bounds = [];
    const re = /\n[ \t]*\n/g;
    let match = null;
    let at = 0;
    while ((match = re.exec(text)) !== null) {
        bounds.push({ from: at, to: match.index + match[0].length });
        at = match.index + match[0].length;
    }
    bounds.push({ from: at, to: text.length });

    for (const bound of bounds) {
        if (bound.to <= bound.from) continue;
        const size = bound.to - bound.from;
        if (size > CHUNK_MAX_CHARS) {
            if (end > start) { push(start, end); start = end; }
            let cut = bound.from;
            while (cut < bound.to) {
                const next = safeCut(text, cut, Math.min(cut + CHUNK_TARGET_CHARS, bound.to));
                push(cut, next);
                cut = next;
            }
            start = bound.to;
            end = bound.to;
            continue;
        }
        // Two reasons to close the chunk in hand before this paragraph joins
        // it: it has reached the target and is past the floor, or the join
        // would put it over the ceiling. The second is not the first with a
        // bigger number, and without it a short chunk meeting a long paragraph
        // produces one the embedding server would refuse.
        if (end > start && (((end - start) + size > CHUNK_TARGET_CHARS && (end - start) >= CHUNK_MIN_CHARS)
            || (end - start) + size > CHUNK_MAX_CHARS)) {
            push(start, end);
            start = end;
        }
        end = bound.to;
        if (end - start >= CHUNK_TARGET_CHARS) {
            push(start, end);
            start = end;
        }
    }
    if (end > start) push(start, end);
    return chunks;
}

// ----------------------------------------------------------------- the queue --

// The local queue's one table, and the SQL over it.
//
// A row is one stamp, one outcome, one record write or one record retirement
// the host has not taken yet: `id` is the stamp id its writer generated, which
// is also the value the host dedupes a resend on (a unique index for an
// outcome and, on a host below version 8, for a usage stamp; the
// mem.RecordStamp ledger for a record), `kind` says which
// procedure it is bound for (usage, outcome, record or archive), and `payload`
// is the JSON that procedure reads, exactly as the writer composed it. An
// archive row carries its id for this table alone: mem.usp_ArchiveRecord answers
// archived for a resend of a row it already archived, which the drain treats as
// delivered, so a resend is harmless without a ledger.
//
// A ROW IS WELL FORMED OR IT DOES NOT EXIST, WHICH IS THE WHOLE REASON THIS IS A
// DATABASE. A writer inserts one row inside one statement, so there is no torn
// write to detect, no half-line to keep and nothing to put back: the states a
// file-backed queue spent its code on cannot arise here. What is left is the two
// states SQLite itself answers, a lock another connection holds and a file the
// disk will not take, and each has one answer below.
const QUEUE_TABLE = 'queue';
const QUEUE_SCHEMA = 'CREATE TABLE IF NOT EXISTS ' + QUEUE_TABLE + ' ('
    + 'id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)';

// The queue, opened and created if it is not there. It throws, because every
// caller below has its own answer for a queue it could not open and none of them
// is the same answer.
//
// WAL is what lets a writer and a reader hold the file at once, so an
// interactive stamp is never blocked by a publish that is reading rows, and the
// busy timeout is what a writer meeting a held write lock waits out rather than
// failing on. The two together are this module's whole concurrency story: there
// is no lock file, no staleness arithmetic and no break.
//
// NOTHING THROWS OUT OF HERE STILL HOLDING THE FILE. The connection opens before
// either statement runs, and a file that is not a database at all fails on the
// first of them rather than at the open, so an open left to the garbage collector
// would hold that file for the life of the process. On Windows that is a store
// directory nothing can remove and a path nothing can replace, which turns one
// unreadable queue into a machine that cannot be repaired without a restart.
// The busy wait is the caller's, defaulting to the full one. A caller on a
// budget passes QUEUE_BUSY_TIMEOUT_QUICK_MS instead, which is the whole of the
// difference between the two paths: the connection, the mode and the schema are
// the same on either.
function openQueue(file, options) {
    const opts = options || {};
    const target = (typeof file === 'string' && file !== '') ? file : queuePath();
    const busyMs = Number.isFinite(opts.busyTimeoutMs) ? opts.busyTimeoutMs : QUEUE_BUSY_TIMEOUT_MS;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const handle = new DatabaseSync(target, { timeout: busyMs });
    try {
        handle.exec('PRAGMA journal_mode = WAL');
        handle.exec(QUEUE_SCHEMA);
    } catch (err) {
        closeQueue(handle);
        throw err;
    }
    return handle;
}

// A handle given back, never left to the garbage collector. An open connection
// holds the file and its two sidecars on Windows, so a caller that dropped one
// would leave a store directory nothing could remove and a lock nothing could
// take.
function closeQueue(handle) {
    if (handle === null) return;
    try { handle.close(); } catch { /* a connection that will not close costs this process a handle and the caller nothing */ }
}

// Whether a database error is a lock somebody else holds rather than a fault.
//
// A BUSY MACHINE AND A BROKEN ONE SEND A READER TWO WAYS. The busy one resolves
// itself on the next run, and a reader told to go and look at the disk over one
// is sent after a fault that is not there; the broken one resolves itself never.
// SQLite's own result code is what tells them apart, read off the error object
// rather than matched in its text, since the text is the library's to reword.
//
// The code is masked to its primary byte, for the reason SQLITE_CODE_MASK
// states: every extended busy code carries SQLITE_BUSY in that byte, and the
// two this library reports for a lock met during recovery or on a snapshot
// carry nothing else that changes the answer.
function queueBusy(err) {
    return Boolean(err) && (Number(err.errcode) & SQLITE_CODE_MASK) === SQLITE_BUSY;
}

// How many rows the queue holds, or null where no count could be taken.
//
// It is the reading that says the queue is not emptying, so a file no
// connection can open carries null rather than zero: a zero there would tell a
// reader, and any later step that scrapes the number, that a full queue is
// empty.
function queueDepth(file, options) {
    let handle = null;
    try {
        handle = openQueue(file, options);
        return depthOf(handle);
    } catch {
        return null;
    } finally {
        closeQueue(handle);
    }
}

function depthOf(handle) {
    try {
        return Number(handle.prepare('SELECT COUNT(*) AS depth FROM ' + QUEUE_TABLE).get().depth);
    } catch {
        return null;
    }
}

// Whether a value is text the append procedures read as present, which is what
// their own NULLIF over a trimmed value answers: a blank string reaches them as
// a null.
function filled(value) {
    return typeof value === 'string' && value.trim() !== '';
}

// Why a row cannot be sent, or null where it can.
//
// ONE UNSENDABLE ROW ON THE QUEUE IS A QUEUE THAT NEVER EMPTIES. The drain sends
// every consecutive row of a stamp kind in one call, and both append procedures
// throw over the whole batch on a row missing what they require:
// mem.usp_AppendUsage on a kind that is not read or applied and on an absent or
// unreadable timestamp, mem.usp_AppendOutcomes on a blank segment, a blank
// action key or the same timestamp. So the batch is refused, nothing is deleted,
// and every later drain rebuilds the same batch around the same row for as long
// as it stands. A record or archive row goes alone and mem.usp_PutRecord and
// mem.usp_ArchiveRecord throw over a row naming no tier, no name, or a store key
// the tier does not take, and over a list that is not a JSON array; a record
// row the host throws over is filed under the refused directory, so the screen
// here is what keeps a defective row from costing a file and a spawn every run.
// The screen is at the writer because that is the one place the row can still
// be turned away with its author present: deliver, writeThrough and this are
// exported and take any entry a caller composes.
//
// It names the field rather than quoting its value. A stamp's own text is the
// caller's and reaches a person's screen through the sentence the interactive
// verbs print, and what a reader has to act on is which field the row is missing.
//
// The stamp id is this file's requirement rather than a procedure's. It is the
// row's primary key here, so a row without one is a row this table cannot hold:
// two of them collide on the literal text of the absent value and the second
// insert fails the whole call.
//
// The timestamp screen is the one stamped() states, which is DATETIMEOFFSET's
// own range rather than this runtime's reading of a date.
//
// The vector rank's ceiling is the host column's, a 32-bit signed integer.
// jev-judge.js holds its shown entries' rank to the same number, and a test
// holds the two equal.
const VECTOR_RANK_MAX = 2147483647;
function unsendable(entry) {
    if (entry === null || typeof entry !== 'object') {
        return 'the row is not an object, so no procedure can read it';
    }
    if (!filled(entry.stampId)) {
        return 'the row carries no stamp id, which is its own key on the queue and the identity '
            + 'the host dedupes a resend by';
    }
    if (!stamped(entry.at)) {
        return 'the row\'s `at` is not a timestamp the host\'s DATETIMEOFFSET column takes, and a '
            + 'batch carrying one is refused whole';
    }
    // The two record kinds, each screened for what its procedure throws over.
    // The stamp id's charset is this file's own requirement on top: a refused
    // record row is filed under a path named by that id.
    if (entry.type === 'record' || entry.type === 'archive') {
        if (!STAMP_ID_RE.test(String(entry.stampId))) {
            return 'the row\'s stamp id is not the letters, digits and hyphens a refused row\'s file is named by';
        }
        if (entry.tier !== 'project' && entry.tier !== 'type' && entry.tier !== 'operator') {
            return 'the row names no tier of project, type or operator';
        }
        if (!filled(entry.name)) return 'the row names no record';
        const hasKey = filled(entry.projectKey);
        const hasType = filled(entry.typeName);
        if (entry.tier === 'project' ? (!hasKey || hasType)
            : entry.tier === 'type' ? (hasKey || !hasType) : (hasKey || hasType)) {
            return 'the row\'s store key does not fit its tier: a project record carries a project key, '
                + 'a type record a type name, and an operator record neither';
        }
        if (entry.type === 'archive') {
            if (typeof entry.delete !== 'boolean') return 'the archive row\'s delete flag is not true or false';
            return null;
        }
        for (const field of ['tags', 'triggers', 'anchors']) {
            if (entry[field] !== null && !Array.isArray(entry[field])) {
                return 'the record\'s ' + field + ' is neither null nor a JSON array';
            }
        }
        for (const field of ['description', 'body', 'space', 'machine', 'supersedes', 'author']) {
            if (entry[field] !== null && typeof entry[field] !== 'string') {
                return 'the record\'s ' + field + ' is neither null nor text';
            }
        }
        if (entry.pinned !== null && typeof entry.pinned !== 'boolean') {
            return 'the record\'s pinned flag is neither null nor true or false';
        }
        if (typeof entry.replace !== 'boolean') return 'the record\'s replace flag is not true or false';
        return null;
    }
    // The queue's own column, and the fold every writer's `type` takes on the way
    // into it: anything that is not an outcome or a record kind is bound for the
    // usage procedure.
    if (entry.type === 'outcome') {
        if (!filled(entry.segment)) return 'the outcome names no segment, which is the store it belongs to';
        if (!filled(entry.actionKey)) return 'the outcome names no action key';
        // A judged pointer's four fields, each typed as the column the
        // procedure converts it into, since a value OPENJSON cannot convert
        // refuses the whole batch.
        if (entry.recognitionId !== undefined && entry.recognitionId !== null
            && !(typeof entry.recognitionId === 'string' && entry.recognitionId.length <= 64)) {
            return 'the outcome\'s recognition id is not text of at most 64 characters';
        }
        if (entry.score !== undefined && entry.score !== null
            && !(typeof entry.score === 'number' && entry.score >= 0 && entry.score <= 1)) {
            return 'the outcome\'s score is not a number from 0 to 1';
        }
        if (entry.vectorRank !== undefined && entry.vectorRank !== null
            && !(Number.isInteger(entry.vectorRank) && entry.vectorRank >= 1 && entry.vectorRank <= VECTOR_RANK_MAX)) {
            return 'the outcome\'s vector rank is not a positive whole number';
        }
        if (entry.shown !== undefined && entry.shown !== null && typeof entry.shown !== 'boolean') {
            return 'the outcome\'s shown flag is not true or false';
        }
        return null;
    }
    const kind = filled(entry.kind) ? entry.kind.trim().toLowerCase() : '';
    if (kind !== 'read' && kind !== 'applied') {
        return 'the stamp\'s kind is neither read nor applied';
    }
    return null;
}

// The queue's kind column for a writer's `type`: the two record kinds and the
// outcome kind by name, and everything else bound for the usage procedure.
function queueKind(type) {
    return type === 'outcome' || type === 'record' || type === 'archive' ? type : 'usage';
}

// Put one row on the queue, as {ok} or {ok: false, detail}, with `refused` set
// where the row itself is the defect rather than the file.
//
// A STAMP ROW IS A DERIVED COPY AND A RECORD ROW IS THE SAVE ITSELF. The read
// stamp hook queues a copy of a read that happened whatever this answers, so a
// row that never lands costs the host's copy of one stamp; a record row is the
// only copy of a save the host could not take, which is why the write verbs
// report an unwritable queue as a failure where the hook says nothing. The
// answer is handed back rather than swallowed, and the caller is what says so.
//
// One statement per entry, with every value bound rather than spelled into the
// text. The id is the stamp id the writer generated, so a row resent after an
// ambiguous outcome carries the same identity, which the host's unique index or
// ledger refuses twice. A usage stamp on a version 8 host needs no identity for
// that: the host folds it into one row per memory, where a resend changes
// nothing. A row whose id the queue already holds is the same event still
// waiting, a judged pointer resent under its derived id with either outcome,
// so the insert keeps the held row, the first written, and answers ok rather
// than a refusal. That rests on one invariant: only a pointer row's id is
// derived (pointerStampId, from the recognition id), and every other row takes
// a fresh random id (stampId), so no two different events ever share an id and
// the ignore never drops one.

function queueInsert(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return { ok: true };
    // The screen, ahead of the open, so a refused row never reaches the file and
    // the call costs no connection at all. Nothing is written for any of them: a
    // caller writes one row at a time, and a batch carrying one bad row is a
    // caller to fix rather than a batch to sort.
    for (const entry of entries) {
        const why = unsendable(entry);
        if (why !== null) {
            return {
                ok: false,
                refused: true,
                detail: why + ', so it was not written to the queue: the memory database refuses a '
                    + 'batch carrying it and the queue would then stop emptying'
            };
        }
    }
    let handle = null;
    try {
        // The quick busy wait, for the reason QUEUE_BUSY_TIMEOUT_QUICK_MS states:
        // every caller here is an interactive stamp or the read-stamp hook, whose
        // whole budget is a fraction of the full wait and whose row is a derived
        // copy of a line already on disk.
        handle = openQueue(undefined, { busyTimeoutMs: QUEUE_BUSY_TIMEOUT_QUICK_MS });
        const statement = handle.prepare('INSERT OR IGNORE INTO ' + QUEUE_TABLE
            + ' (id, kind, payload, created_at) VALUES (?, ?, ?, ?)');
        for (const entry of entries) {
            // `type` is how a writer says which procedure the row is bound for,
            // and the column is where that lives from here on, so it is taken
            // off the payload rather than sent to a procedure that does not
            // name it.
            const { type, ...row } = entry;
            statement.run(String(entry.stampId), queueKind(type),
                JSON.stringify(row), new Date().toISOString());
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, detail: errText(err) };
    } finally {
        closeQueue(handle);
    }
}

// The timestamp shape every stamp writer here produces and DATETIMEOFFSET
// reads: an ISO 8601 date and time, with optional fractional seconds and an
// optional zone offset.
//
// Date.parse alone is not that screen. It rolls February 30th into March,
// accepts hour 24 as the next midnight and takes a zone offset of any size at
// all, every one of which DATETIMEOFFSET refuses, so the calendar day, the hour
// and the offset are checked against what the type takes rather than against
// what this runtime will make of them.
//
// The offset the type holds runs from -14:00 to +14:00. That range belongs to
// DATETIMEOFFSET itself, where it is the column type's own documented bound
// rather than anything this client decides or the shape of the text implies:
// fourteen hours either way is taken, one minute past it in either direction is
// not, and at the fourteenth hour the minutes must be zero.
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(?:Z|[+-](\d{2}):(\d{2}))?$/;
const OFFSET_MAX_HOURS = 14;
function stamped(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    const parts = TIMESTAMP_RE.exec(text);
    if (parts === null || !Number.isFinite(Date.parse(text))) return false;
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    if (year < 1 || month < 1 || month > 12 || Number(parts[4]) > 23) return false;
    if (parts[7] !== undefined) {
        const offsetHours = Number(parts[7]);
        const offsetMinutes = Number(parts[8]);
        if (offsetHours > OFFSET_MAX_HOURS || offsetMinutes > 59) return false;
        if (offsetHours === OFFSET_MAX_HOURS && offsetMinutes !== 0) return false;
    }
    // Day zero of the following month is the last day of this one, which is what
    // makes the leap year the calendar's answer rather than this client's.
    return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// A record file's modification time as mem.usp_UpsertRecords reads it, or null
// where this machine's filesystem handed back a time that type will not take.
//
// THE SCREEN IS THE ONE ABOVE, AND WHAT IT CLOSES IS A RUN THAT NEVER PUBLISHES
// AGAIN. The procedure reads this field as a DATETIMEOFFSET and throws over the
// whole batch when it cannot, and the walk re-derives every record from the
// files on every run, so one file whose time renders outside that type's range
// would fail every record batch on every run for as long as that file stood, and
// the publish would stand down with none of its legs reached. A time this
// runtime cannot represent at all is worse still: toISOString throws a
// RangeError, which is nothing this leg catches.
//
// Null is what the column takes for a record whose time is unknown. It is
// nullable, the procedure's own refusal check does not name it, and the
// comparison that skips an older copy requires a time on both sides, so a record
// that arrives with none is upserted and never skipped as older.
function fileModifiedAt(mtimeMs) {
    let rendered = null;
    try {
        rendered = new Date(mtimeMs).toISOString();
    } catch {
        return null;
    }
    return stamped(rendered) ? rendered : null;
}

// The sentence a refusal takes, wherever in this client one is met.
//
// A REFUSAL AND AN OUTAGE SEND A READER TWO WAYS, AND ONE OF THEM IS NEVER
// RESOLVED BY WAITING. The transport tells the two apart on the envelope the
// server's own message arrives in, and every leg that meets a refusal owes the
// same three things: the server's own words, which are the part no reader can
// reconstruct, in front; that this is a defect in what the client sends rather
// than a host to come back to; and what the run left behind. Spelled once, so
// the legs cannot come to describe one state in four voices.
function refusedText(what, procedure, detail, left) {
    return 'the memory database refused ' + what + ' sent to mem.' + procedure + ' and said: '
        + detail + '. That is a defect in what this client sends rather than a host to wait for, and '
        + left;
}

// The sentence for a send the host answered, by the transport's cause. A
// refusal takes refusedText. Contention, a deadlock victim or a lock request
// timeout, is another session's lock on the rows the call needed, so it is
// never called a defect: the server's words come first as for a refusal, then
// what the run left behind, which each caller's `left` states, the next run's
// resend among it.
function answeredText(cause, what, procedure, detail, left) {
    if (cause !== 'contention') return refusedText(what, procedure, detail, left);
    return 'the memory database chose ' + what + ' sent to mem.' + procedure + ' as a deadlock victim or '
        + 'timed out its lock request, and said: ' + detail + '. That is another session holding the rows '
        + 'it needed rather than anything this client sent, and ' + left;
}

// The two record procedures take typed scalars rather than one JSON document,
// so a record or archive row rides a batch of its own shape, the query batch's
// rule: the row goes in as one payload literal, pure ASCII in bounded pieces,
// and the batch reads each parameter out of it with OPENJSON into a variable of
// the procedure's own type. Nothing a caller composed is concatenated into the
// batch text, a list arrives as the JSON array text its column holds, a JSON
// null arrives as NULL, which the procedure reads as "keep" on a replace, and a
// boolean arrives as a BIT. Each entry is the row's key, the variable, its
// declared type, the procedure's parameter and, for a list, the AS JSON mark.
const RECORD_FIELDS = [
    ['tier', '@Tier', 'VARCHAR(20)', '@p_Tier'],
    ['projectKey', '@ProjectKey', 'NVARCHAR(400)', '@p_ProjectKey'],
    ['typeName', '@TypeName', 'NVARCHAR(400)', '@p_TypeName'],
    ['name', '@Name', 'NVARCHAR(200)', '@p_Name'],
    ['space', '@Space', 'NVARCHAR(100)', '@p_Space'],
    ['machine', '@Machine', 'NVARCHAR(100)', '@p_Machine'],
    ['description', '@Description', 'NVARCHAR(MAX)', '@p_Description'],
    ['body', '@Body', 'NVARCHAR(MAX)', '@p_Body'],
    ['tags', '@Tags', 'NVARCHAR(MAX)', '@p_Tags', true],
    ['triggers', '@Triggers', 'NVARCHAR(MAX)', '@p_Triggers', true],
    ['anchors', '@Anchors', 'NVARCHAR(MAX)', '@p_Anchors', true],
    ['pinned', '@IsPinned', 'BIT', '@p_IsPinned'],
    ['supersedes', '@Supersedes', 'NVARCHAR(200)', '@p_Supersedes'],
    ['author', '@Author', 'NVARCHAR(200)', '@p_Author'],
    ['replace', '@Replace', 'BIT', '@p_Replace'],
    ['stampId', '@StampId', 'NVARCHAR(64)', '@p_StampId']
];
const ARCHIVE_FIELDS = [
    ['tier', '@Tier', 'VARCHAR(20)', '@p_Tier'],
    ['projectKey', '@ProjectKey', 'NVARCHAR(400)', '@p_ProjectKey'],
    ['typeName', '@TypeName', 'NVARCHAR(400)', '@p_TypeName'],
    ['name', '@Name', 'NVARCHAR(200)', '@p_Name'],
    ['delete', '@Delete', 'BIT', '@p_Delete']
];
// The read's key, the same four scalars an archive names a record by without
// the delete flag, so a project key rides to mem.usp_GetRecord exactly as it
// rides to the two writers.
const GET_FIELDS = ARCHIVE_FIELDS.filter(([key]) => key !== 'delete');
const RECORD_PROCEDURES = {
    record: ['usp_PutRecord', RECORD_FIELDS],
    archive: ['usp_ArchiveRecord', ARCHIVE_FIELDS],
    get: ['usp_GetRecord', GET_FIELDS]
};
function recordBatch(kind, row) {
    const [procedure, fields] = RECORD_PROCEDURES[kind];
    const declared = fields.map(([, variable, type]) => variable + ' ' + type).join(', ');
    const read = fields.map(([, variable]) => variable + ' = J.' + variable.replace('@', '[') + ']').join(', ');
    const columns = fields.map(([key, variable, type, , isJson]) =>
        variable.replace('@', '[') + '] ' + type + ' \'$.' + key + '\'' + (isJson ? ' AS JSON' : '')).join(', ');
    const argumentList = fields.map(([, variable, , parameter]) => parameter + ' = ' + variable).join(', ');
    return {
        procedure,
        batch: [
            ';SET NOCOUNT ON',
            payloadLiteral('@Row', row),
            ';DECLARE ' + declared,
            ';SELECT ' + read + ' FROM OPENJSON(@Row) WITH ( ' + columns + ' ) J',
            ';DECLARE @Answer TABLE ( [Json] NVARCHAR(MAX) NULL )',
            ';INSERT INTO @Answer ( [Json] ) EXEC mem.' + procedure + ' ' + argumentList,
            ";SELECT '" + RESULT_TAG + "' + COALESCE([Json], 'null') FROM @Answer"
        ].join('\n')
    };
}

// One record or archive row sent to its procedure, as {ok, rows, detail,
// cause}, the transport's own answer. `row` is the queue payload, the writer's
// entry without its `type`.
function sendRecordRow(config, kind, row, options) {
    const opts = options || {};
    const deps = opts.deps || {};
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : config.timeoutMs;
    const made = recordBatch(kind, row);
    const run = deps.runBatch || runBatch;
    return run(config, made.batch, { budgetMs, killMs: opts.killMs, procedure: made.procedure });
}

// The queue's rows as the units the drain sends, in the queue's own order: a
// run of consecutive usage rows is one usp_AppendUsage call, a run of
// consecutive outcome rows one usp_AppendOutcomes call, and a record or archive
// row is one call by itself. The grouping never crosses a row of another kind,
// which is what keeps the order the contract: a stamp naming a record lands
// after the record row ahead of it, and a put lands before the replace behind
// it.
function drainUnits(rows) {
    const units = [];
    for (const row of rows) {
        const kind = queueKind(row.kind);
        const last = units.length > 0 ? units[units.length - 1] : null;
        const batched = kind === 'usage' || kind === 'outcome';
        if (batched && last !== null && last.kind === kind) {
            last.ids.push(row.id);
            last.rows.push(row.payload);
            continue;
        }
        units.push({ kind, ids: [row.id], rows: [row.payload] });
    }
    return units;
}

// File a refused unit's payload under the refused directory, as {ok, file} or
// {ok: false, detail}. The file is named by the unit's first stamp id, never
// by a record's name, and holds the rows as the host read them beside the
// host's own answer, so a person can read what was not saved and why. A record
// or archive unit is one row and files as `row`; a usage or outcome batch files
// its rows as `rows`, every stamp of the batch in one file, since the host
// refused them as one call.
function keepRefusedUnit(unit, answer) {
    const file = refusedRecordPath(unit.ids[0]);
    if (file === null) return { ok: false, detail: 'the unit\'s stamp id is not one a file is named by' };
    const filed = { stampId: unit.ids[0], kind: unit.kind, refusedAt: new Date().toISOString(), answer };
    if (unit.kind === 'record' || unit.kind === 'archive') filed.row = unit.rows[0];
    else filed.rows = unit.rows;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(filed, null, 2) + '\n', 'utf8');
        return { ok: true, file };
    } catch (err) {
        return { ok: false, detail: errText(err) };
    }
}

// How many rows one drain reads. A write verb drains ahead of its own row
// under a deadline of one call, and a queue deepened by a long outage can hold
// far more than that deadline sends, so the read is paged: the drain reads at
// most this many rows in queue order, sends them, and answers with the depth
// still behind them. A write that finds rows behind its page queues its own
// row rather than overtake them; db-refresh and the publish read page after
// page (drainPages) under their own budget until the rows the first page
// found are sent or a page stops short. Two thousand rows is a bounded parse
// for a write, about four hundred kilobytes of stamp payload, and still a page
// a stamp batch past PAYLOAD_FUNDED_CHARS fits inside, so a queue grown past
// what one call funds is reported rather than silently sliced under the bound.
const DRAIN_PAGE_ROWS = 2000;

// Send everything on the queue to the host, in order, and delete each unit as
// the host confirms it.
//
// The drain reads one page of rows, DRAIN_PAGE_ROWS of them, in `created_at,
// rowid` order and sends them in that order, one unit at a time (drainUnits
// above). The rowid breaks the tie between rows written inside one
// millisecond, which share a created_at: the table is a rowid table under its
// text primary key, so the rowid follows insertion, where the stamp id is
// random and would send two such rows in an order nothing chose. There is no
// rotation, no file aside, no put-back and no leftover pass: a unit the host
// confirms comes off the queue at once, and a unit it does not confirm stays
// with every unit behind it. Rows behind the page stay for the next call,
// counted in `remaining`, so a caller that needs the queue empty reads that
// count rather than this call's `ok`.
//
// A ROW WRITTEN WHILE A SEND IS IN FLIGHT SURVIVES BY CONSTRUCTION. The delete
// names the ids the select returned, so a row inserted behind it is addressed by
// nothing this drain does. That is what the whole delete-by-id shape buys, and
// it is why no lock is held across a call to the host: an interactive writer
// waits on nothing here.
//
// WHAT MAKES A RESEND SAFE IS THE SERVER, NOT THIS CODE. Every row carries the
// stamp id its writer generated. mem.Outcome holds a unique index over that
// column and mem.usp_AppendOutcomes inserts only the ids it does not already
// hold. A usage stamp is taken once by mem.Usage's unique stamp id index on a
// host at version 2 to 7, and from version 8 mem.usp_AppendUsage folds it into
// one mem.RecordUsage row per memory, where a resent stamp's date is already
// held and its time is no later than the row's, so it changes nothing.
// mem.usp_PutRecord answers stored and writes nothing for a stamp its ledger
// already holds, and mem.usp_ArchiveRecord answers archived for a row it
// already archived. A row sent twice therefore lands once. So a drain that cannot tell what landed does not have to: it
// deletes nothing it did not confirm, and the next run sends those rows again.
//
// A TRANSPORT FAILURE STOPS THE DRAIN WHERE IT STANDS, and so does a spent
// budget. The failed unit and every unit behind it stay on the queue, since a
// later unit may depend on the one that did not land, and a second call would
// spend a whole spawn's clock discovering the same silence. A refusal and an
// outage are told apart on the `cause` the transport answers with rather than
// on the bare false the two share: a refusal names a defect and asks for a fix,
// while an outage asks for nothing but the next run, and a host that blinks
// once would otherwise open a defect that is not there. Where the two cannot
// be told apart the transport answers outage, because over-reporting the
// defect is the failure this split exists to prevent.
//
// A REFUSAL IS THE ONE HOST ANSWER THAT REMOVES AN UNDELIVERED UNIT. A unit the
// host refuses, a record row answered `refused` for a name that now exists
// with no replace flag or for a field-only write on a name the store does not
// hold, or any unit the host throws over, a record, an archive row or a batch
// of stamps, is one the host will answer the same way on every resend, and
// left on the queue it would hold every save behind it. So its payload is filed
// under ~/.claude/memory-snapshot/refused/<stamp>.json, the unit comes off, the
// refusal is named in the answer with the unit's name and that file, and the
// drain continues. A refused save is kept and never wedges the queue. A thrown
// deadlock victim or lock request timeout is no refusal: the same unit sent
// again lands, so the transport answers it as `contention`, the drain stops
// there with the unit and every unit behind it on the queue, since the queue's
// order is its contract for record rows, and the next drain resends them. A payload
// that could not be filed stops the drain where it stands, as a transport
// failure does: the unit and every unit behind it stay on the queue, nothing
// more is deleted, and the drain fails with cause `refused`, since dropping
// the unit would lose the save and a stamp behind it may name the record it
// holds. The host answered, so the stop is no outage. The refusal with a
// description is the one case that can never land: a thrown call is answered
// by the server's words, which may name a defect a newer client or host fixes,
// and the filed payload is what a person resends then.
//
// AN OUTAGE IS TRACKED APART FROM A REFUSAL. The answer's `outage` is true
// whenever a transport failure stopped the drain, whatever else happened before
// it, so a caller that leaves the down marker on an outage reads that flag
// and never the cause word, which an earlier unfiled refusal would otherwise
// hold. A call killed on its clock is a transport failure and so an outage.
// Contention stops the drain the same way and is no outage: the host answered,
// so `outage` stays false and the cause word reads `contention`.
//
// THE VERSION GATES ARE PER KIND, AND A HELD UNIT STOPS THE DRAIN. Nothing is
// sent at all to a host below REQUIRED_SCHEMA_VERSION, whose append procedures
// ignore the stamp id. A record or archive row needs RECORD_SCHEMA_VERSION, the
// version that holds the record procedures, and below it the drain stops at
// the first such unit: it and every unit behind it stay on the queue, the held
// one counted in `held`, since a stamp behind it may name the record it holds
// and would be rejected and lost if sent ahead of it. The stamp rows ahead of
// the first held unit still drain.
//
// WHAT IS REPORTED DRAINED IS WHAT LEFT THE QUEUE, NEVER WHAT WAS SENT. The two
// part whenever a delete is not reached, which is any outage, any refusal of a
// batch and a queue that would not take the delete: `drained` counts the
// units confirmed and removed before the stop, and `remaining` carries what
// the queue still holds. A drain that counted its sends instead would print
// the same success on every run of a queue that never empties, which is
// exactly the state a reader is watching that number to catch.
//
// `remaining` is null only where no count is knowable: the version gate
// refusing ahead of the read, and a queue no connection could open or count.
// A zero there would report a full queue as an empty one. `refused`, the
// units filed, `held`, the rows a host below their version kept, and
// `outage`, ride out only where they are not empty or false, so a clean
// drain's answer is the three counts and nothing else.
function drainQueue(config, options) {
    const opts = options || {};
    // The version gate, ahead of the open and the read, since a drain that will
    // send nothing has no reason to touch the file. The number is the caller's,
    // read from mem.usp_Health on the run's own probe, and a host answering no
    // version at all is no evidence of a host that has one.
    const hostSchema = Number(opts.schemaVersion);
    if (!(Number.isFinite(hostSchema) && hostSchema >= REQUIRED_SCHEMA_VERSION)) {
        const found = Number.isFinite(hostSchema) ? 'schema version ' + hostSchema : 'no schema version at all';
        return {
            ok: false,
            contended: false,
            cause: 'schema',
            drained: 0,
            remaining: null,
            rejected: 0,
            detail: 'the memory database reports ' + found + ' where this client requires version '
                + REQUIRED_SCHEMA_VERSION + ', the version where a resent row first lands once, by '
                + 'its stamp id index or, from version 8, by the usage fold, so nothing was sent '
                + 'and the queue at ' + queuePath() + ' is left '
                + 'whole. Re-run plugins/grimoire/db/Install-MemoryDatabase.ps1 against the host '
                + 'to apply the newer scripts'
        };
    }
    const recordsHeld = hostSchema < RECORD_SCHEMA_VERSION;
    const live = queuePath();
    let handle = null;
    let rows = null;
    try {
        handle = openQueue(live);
        // The page: the caller's own bound where it passes one under the page
        // size, which is how a paging caller stops at the rows its first page
        // found rather than take rows written behind the read.
        const limit = Number.isInteger(opts.limit) && opts.limit > 0 && opts.limit < DRAIN_PAGE_ROWS
            ? opts.limit : DRAIN_PAGE_ROWS;
        rows = handle.prepare('SELECT id, kind, payload FROM ' + QUEUE_TABLE
            + ' ORDER BY created_at, rowid LIMIT ' + limit).all();
    } catch (err) {
        // A file no connection could open or read. A lock is the busy machine
        // and everything else is the disk, and neither is a host to go and look
        // at: nothing was asked of it.
        closeQueue(handle);
        const busy = queueBusy(err);
        return {
            ok: false,
            contended: busy,
            cause: busy ? 'contended' : 'unreadable',
            drained: 0,
            // A depth taken on the quick wait, since this path has already spent
            // the full one discovering the holder will not let go. A second
            // connection on the full timeout would spend it again and answer
            // null anyway.
            remaining: busy ? queueDepth(live, { busyTimeoutMs: QUEUE_BUSY_TIMEOUT_QUICK_MS }) : null,
            rejected: 0,
            detail: busy
                ? 'the queue at ' + live + ' is locked by another writer, so nothing was sent from it '
                    + 'and every row in it is still there for the next run'
                : 'the queue at ' + live + ' could not be read, so nothing was sent from it and '
                    + 'every row in it is still there: ' + errText(err)
        };
    }
    try {
        // THE PARSE CARRIES ITS OWN CATCH, AND IT IS THE ONLY THING 'unreadable'
        // MAY BE SAID OF. The payload is the JSON one writer composed inside one
        // statement, so a row this throws on is a file somebody other than this
        // module has been writing, and that reading sends a reader to the queue
        // file. A catch wrapped around the send loop as well would say the same
        // thing of a transport fault or a spent budget, sending that reader to a
        // file with nothing wrong in it.
        let parsed;
        try {
            parsed = rows.map((row) => ({ id: row.id, kind: row.kind, payload: JSON.parse(String(row.payload)) }));
        } catch (err) {
            // Nothing is sent and nothing is deleted, so a person can look at the
            // file with every row still on it.
            return {
                ok: false,
                contended: false,
                cause: 'unreadable',
                drained: 0,
                remaining: depthOf(handle),
                rejected: 0,
                detail: 'the queue at ' + live + ' holds a row this client could not read, so nothing '
                    + 'was sent from it and every row in it is still there: ' + errText(err)
            };
        }
        const units = drainUnits(parsed);
        // The queue's depth as the page was read, before any send, which is
        // what a paging caller measures its pages against: a row written
        // behind this read is counted in `remaining` and never here.
        const depthRead = depthOf(handle);

        // What one call may spend. Each takes its clock from what is left of the
        // run's deadline, which is the rule every boundary call in this module
        // follows: a call starts only while the deadline stands. A drain run
        // outside a publish carries no deadline and spends its own budget.
        const deps = opts.deps || {};
        const clock = (typeof deps.now === 'function') ? deps.now : Date.now;
        const wantMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : config.timeoutMs;
        const callClock = () => {
            // The caller's own want, which the payload never lifts: one call's
            // clock is bounded by the configured timeout whatever it carries.
            // The deadline still governs: a run's remaining budget outranks that
            // want, and a call asked for past the deadline is refused.
            const want = payloadCallMs(wantMs);
            return Number.isFinite(opts.deadline)
                ? callBudget(opts.deadline, clock(), want, SQLCMD_FLOOR_MS)
                : want;
        };

        const failures = [];
        const notes = [];
        const refused = [];
        let cause = null;
        let outage = false;
        let rejected = 0;
        let drained = 0;
        let held = 0;
        const whole = 'the queue at ' + live + ' keeps every row not yet delivered, so the next run '
            + 'sends them again and the stamp id on each one is what makes that land once';
        const procedureOf = { usage: 'usp_AppendUsage', outcome: 'usp_AppendOutcomes',
            record: 'usp_PutRecord', archive: 'usp_ArchiveRecord' };

        // A unit the host confirmed comes off the queue now, or the drain stops
        // on a queue that will not take the delete.
        const remove = (unit) => {
            const removed = deleteRows(handle, unit.ids);
            if (removed.ok) {
                drained += unit.ids.length;
                return null;
            }
            // The delete refused, which is reported for its own sake. Rows the
            // host holds and this queue still carries cost a resend the stamp id
            // absorbs; a queue that cannot be written to at all is a machine to
            // look at, and a lock another writer holds is neither.
            return {
                ok: false,
                contended: removed.contended,
                cause: removed.contended ? 'contended' : 'unclearable',
                drained,
                remaining: depthOf(handle),
                rejected,
                detail: ['the memory database took ' + unit.ids.length + ' row(s) that could not be '
                    + 'removed from the queue at ' + live + ', so it still holds them: '
                    + removed.detail].concat(notes).join('; ')
            };
        };

        // A unit the host would not take: filed, removed, named. A record or
        // archive unit is named by its record; a stamp batch by its count and
        // procedure, since its rows name several records. A payload that
        // cannot be filed sets `halted`, and the loop stops at that unit.
        let halted = false;
        const file = (unit, answer, words) => {
            const row = unit.rows[0];
            const single = unit.kind === 'record' || unit.kind === 'archive';
            const shown = single
                ? (unit.kind === 'archive' ? 'the retirement of ' : 'the record ') + '\''
                    + (typeof row.name === 'string' ? memqLib().sanitize(row.name, 120) : 'an unnamed record') + '\''
                : 'the ' + unit.rows.length + ' row(s) bound for mem.' + procedureOf[unit.kind];
            const kept = keepRefusedUnit(unit, answer);
            if (!kept.ok) {
                cause = 'refused';
                halted = true;
                failures.push('the memory database refused ' + shown + ' (' + words
                    + ') and the payload could not be filed under ' + path.dirname(refusedRecordPath('x'))
                    + ' (' + kept.detail + '), so the unit and every unit behind it stay on the queue at ' + live);
                return null;
            }
            const stopped = remove(unit);
            if (stopped !== null) return stopped;
            refused.push({ kind: unit.kind, name: single ? row.name : null, rows: unit.rows.length, file: kept.file, answer });
            notes.push('the memory database refused ' + shown + ' (' + words
                + '); the payload is kept at ' + kept.file + ' and the rows behind it were sent');
            return null;
        };

        for (const unit of units) {
            if ((unit.kind === 'record' || unit.kind === 'archive') && recordsHeld) {
                // The first held unit stops the drain: a stamp behind it may
                // name the record it holds, and sent ahead of it would be
                // rejected and lost. The count is this unit alone, since
                // nothing behind it was examined.
                held += unit.ids.length;
                break;
            }
            const procedure = procedureOf[unit.kind];
            const budgetMs = callClock();
            if (budgetMs === null) {
                cause = cause || 'budget';
                failures.push('the run budget was spent before mem.' + procedure + ' was called, so '
                    + whole);
                break;
            }
            let sent;
            if (unit.kind === 'usage' || unit.kind === 'outcome') {
                const payloadChars = JSON.stringify(unit.rows).length;
                // A payload past what one call's clock funds, named rather than
                // funded. The server rebuilds the batch's variable on every piece
                // of it, so the work grows with the square of the piece count
                // while this clock does not grow at all, and a call killed on
                // that clock is killed again on every later run, since nothing
                // is deleted. What to do about it is the operator's: raise the
                // configured timeout, or look at a queue that has grown past
                // what one call can carry. This client will not lift one call
                // past the timeout it was configured with, so what it owes is
                // the size and the clock in one sentence.
                if (payloadChars > PAYLOAD_FUNDED_CHARS) {
                    notes.push('the ' + unit.rows.length + ' row(s) bound for mem.' + procedure + ' are '
                        + payloadChars + ' characters of payload, past the ' + PAYLOAD_FUNDED_CHARS
                        + ' characters one call funds, while the clock for that call is ' + budgetMs
                        + ' ms and is bounded by the configured timeout. A call that does not finish '
                        + 'inside it is killed on it every run, and the queue at ' + live + ' then '
                        + 'stops emptying');
                }
                sent = callProcedure(config, procedure,
                    { [unit.kind === 'usage' ? '@p_Usage' : '@p_Outcomes']: unit.rows }, { ...opts, budgetMs });
            } else {
                sent = sendRecordRow(config, unit.kind, unit.rows[0], { deps, budgetMs, killMs: opts.killMs });
            }
            if (sent.ok) {
                const answer = counted(sent.rows);
                if (unit.kind === 'usage') rejected += Number(answer.rejected) || 0;
                if (unit.kind === 'record' && answer.status === 'refused') {
                    // A null description is the host's word for a field-only
                    // write on a name the store does not hold; any other is the
                    // existing record's own description.
                    const words = answer.description === null || answer.description === undefined
                        ? 'no record of that name to update'
                        : 'a record of that name exists, described as "'
                            + memqLib().sanitize(String(answer.description), 200)
                            + '", and the row did not ask to replace it';
                    const stopped = file(unit, answer, words);
                    if (stopped !== null) return stopped;
                    if (halted) break;
                    continue;
                }
                const stopped = remove(unit);
                if (stopped !== null) return stopped;
                continue;
            }
            // A cause this client did not set reads as an outage, the
            // conservative side: a defect reported against a host that was
            // merely away is the failure this split exists to prevent.
            //
            // THE SERVER'S OWN WORDS COME FIRST, AND THIS CLIENT'S BOILERPLATE
            // AFTER THEM. Every surface that prints one of these sentences caps
            // it, and a cut takes the tail, so the clause that survives a cut is
            // whichever one is in front. What the server said is the only part
            // no reader can reconstruct; what this client was left holding is
            // the same sentence on every failure and is in the drain's cause
            // word besides.
            if (sent.cause === 'refused') {
                // Every kind files: a thrown call the transport calls refused
                // answers the same way on every resend, so the unit comes off
                // and the drain goes on.
                const stopped = file(unit, { status: 'thrown', detail: sent.detail },
                    'the host said: ' + sent.detail);
                if (stopped !== null) return stopped;
                if (halted) break;
                continue;
            }
            if (sent.cause === 'contention') {
                // The host answered and named another session's lock, so the
                // unit stays for the next drain and no outage is reported.
                cause = 'contention';
                failures.push('the memory database met contention on mem.' + procedure + ', choosing the call as a '
                    + 'deadlock victim or timing out its lock request, and said: ' + sent.detail + '. So ' + whole);
                break;
            }
            cause = 'outage';
            outage = true;
            failures.push('the memory database did not answer mem.' + procedure
                + ' and the transport said: ' + sent.detail + '. So ' + whole);
            break;
        }
        if (held > 0) {
            notes.push('a record row waits on the queue at ' + live + ' for a memory database at '
                + 'schema version ' + RECORD_SCHEMA_VERSION + ' or above, where this host reports '
                + hostSchema + ', and every row behind it waits with it; re-run '
                + 'plugins/grimoire/db/Install-MemoryDatabase.ps1 against the host');
        }

        const result = { ok: failures.length === 0, drained, remaining: depthOf(handle), rejected };
        // The depth as read rides out to a paging caller alone, the one that
        // passed a page bound, so a single-page answer keeps its three counts.
        if (Number.isInteger(opts.limit)) result.depthRead = depthRead;
        if (!result.ok) {
            result.contended = false;
            result.cause = cause;
            result.detail = failures.concat(notes).join('; ');
        } else if (notes.length > 0) {
            // A run that delivered everything it set out to with something
            // still worth a word: a payload past what a call's clock funds, a
            // refused unit filed, or rows held for a newer host.
            result.cause = refused.length > 0 ? 'refused-records' : held > 0 ? 'held' : 'oversized';
            result.detail = notes.join('; ');
        }
        if (refused.length > 0) result.refused = refused;
        if (held > 0) result.held = held;
        if (outage) result.outage = true;
        return result;
    } catch (err) {
        // The backstop over the send path, which the parse above is deliberately
        // outside of. Everything left in here is a call to the host or the work
        // around one, so what a throw here says is that the host was not reached,
        // and it takes the disposition every other unreached host takes: wait for
        // the next run. Nothing past the last confirmed unit is deleted, so those
        // rows are all still there.
        return {
            ok: false,
            contended: false,
            cause: 'outage',
            outage: true,
            drained: 0,
            remaining: depthOf(handle),
            rejected: 0,
            detail: 'the memory database could not be sent the queue at ' + live + ' and the transport '
                + 'said: ' + errText(err) + '. So every row not yet delivered is still there for the next run'
        };
    } finally {
        closeQueue(handle);
    }
}

// Take the delivered ids off the queue, as {ok} or {ok: false, contended,
// detail}.
//
// ONE TRANSACTION, SO THE DELETE IS ALL OF THEM OR NONE. A delete cut short
// halfway would leave a queue holding some of what the host took and no record
// of which, and the next run would send the remainder again for no reason. The
// stamp id makes that resend harmless, so what the transaction buys is a count a
// reader can believe rather than a row that cannot be lost.
//
// BEGIN IMMEDIATE takes the write lock up front rather than on the first delete,
// which is what makes the busy timeout the whole of the waiting: a transaction
// that discovered the lock partway through would have to be given back and
// retried, which is the arithmetic this design exists to be rid of.
// An empty id set takes no lock at all. A drain of an empty queue has nothing to
// remove, and a transaction opened to remove nothing would wait the whole busy
// timeout out against a held write lock and then answer that the rows it took
// could not be removed, which of no rows at all is not true.
function deleteRows(handle, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { ok: true };
    try {
        handle.exec('BEGIN IMMEDIATE');
    } catch (err) {
        return { ok: false, contended: queueBusy(err), detail: errText(err) };
    }
    try {
        const statement = handle.prepare('DELETE FROM ' + QUEUE_TABLE + ' WHERE id = ?');
        for (const id of ids) statement.run(id);
        handle.exec('COMMIT');
        return { ok: true };
    } catch (err) {
        try { handle.exec('ROLLBACK'); } catch { /* a transaction the connection closes rolls back anyway */ }
        return { ok: false, contended: queueBusy(err), detail: errText(err) };
    }
}

// ------------------------------------------------------- the stamp writers --

// Take one usage stamp or outcome for the shared index, which on the
// interactive path means writing one row to the local queue.
//
// The answer is {delivered, queued, reason}, and on a queue write that failed it
// carries `detail` besides. `reason` is the state: `queued` where the row
// landed, `refused` where the row is one the host's append procedures would
// refuse a whole batch over, `unwritable` where the file would not take it, and
// the config's own refusal word or `redirected` where nothing was attempted.
//
// THE QUEUE IS THE ONLY COPY OF THE STAMP. No usage.jsonl or outcomes.jsonl
// line is written beside the record, so a queue write that fails loses the
// stamp outright, and the caller prints a sentence saying so and carries on
// rather than failing: a stamp is worth a line of a session's attention and
// never the verb that produced it.
//
// With no config there is no host on this machine: nothing is written, since a
// queue that filled on a machine with no database would grow without bound and
// drain nowhere.
//
// NO DATABASE CALL IS MADE HERE, AND THAT IS THE POINT. A stamp is worth a few
// hundred milliseconds of a session's time and no more, and a few hundred
// milliseconds does not fund a cold sqlcmd start plus a TLS negotiation plus a
// login: on a healthy host that attempt is killed on nearly every stamp and the
// row goes to the queue regardless, having first spent the session's time. So
// every interactive stamp is queued and `memq db-sync` delivers it in one
// batched call, which is the same journey with the latency removed. A stamp's
// whole worth here is that it is not lost, and the queue is what makes it not
// lost.
//
// A redirected store writes nothing either, for the reason isDefaultStoreRoot
// states: every publish leg refuses a non-default root, so a queue filling
// under one grows without bound and drains nowhere, which is the same shape as
// a machine with no database at all.
function deliver(entry, options) {
    const opts = options || {};
    const loaded = opts.config ? { ok: true, config: opts.config } : loadConfig(opts.configPath);
    if (!loaded.ok) return { delivered: false, queued: false, reason: loaded.reason };
    if (!isDefaultStoreRoot()) return { delivered: false, queued: false, reason: 'redirected' };
    const written = queueInsert([entry]);
    if (written.ok) return { delivered: false, queued: true, reason: 'queued' };
    // A row the append procedures would refuse is a defect in what this client
    // composed, which is the module's own `refused` rather than a file that would
    // not take a write. Both are reported the same way and neither fails the
    // verb; what parts them is where a reader goes to fix it.
    if (written.refused) return { delivered: false, queued: false, reason: 'refused', detail: written.detail };
    return { delivered: false, queued: false, reason: 'unwritable', detail: written.detail };
}

// The identity a queue row carries so the server can tell a resend from a new
// row. mem.usp_AppendOutcomes, and mem.usp_AppendUsage on a host below version
// 8, insert only the ids their table does not already hold, by a unique index
// over this value, which is what makes a row sent twice insert once. A version
// 8 host folds a usage stamp into one row per memory instead, where a resend
// changes nothing, and ignores the id. Either way a drain can delete nothing
// rather than having to be right about what landed. It is generated where the row is written, so the
// same stamp resent from the same row carries the same id forever.
function stampId() {
    return crypto.randomUUID();
}

// The stamp id of a judged pointer row, derived from the pointer it records:
// its recognition id alone. One shown pointer is one event, and a row for it is
// resent whenever its shown entries stay in place after it was queued, a later
// row of its batch refused or the rewrite failing behind it. A resend of either
// outcome is the same event, and the first written wins: the queue and the
// host's stamp index each keep the row they hold and absorb the later one, so a
// `get` that queued `pass` and failed its rewrite, followed by a session end
// queuing `fail` for the same recognition id, counts once as `pass`. A fresh id
// would count the pointer twice in the calibration. The SHA-256 of the id, cut
// to 32 hex digits in the 8-4-4-4-12 grouping a random id takes, so it fits
// every column and screen a stamp id meets.
function pointerStampId(recognitionId) {
    const hex = crypto.createHash('sha256')
        .update('kit.jev.pointer\n' + String(recognitionId)).digest('hex');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-'
        + hex.slice(16, 20) + '-' + hex.slice(20, 32);
}

// The identity a usage stamp names its record by: the store's own tier, the
// segment that tier is keyed by, and the file key the sidecar records. It is
// the identity form mem.usp_AppendUsage accepts beside a record id, and the
// procedure resolves it against the records the caller may see, rejecting and
// counting a stamp that resolves to none rather than writing it. That is why a
// publish drains the queue behind its record upsert: by then the record this
// names has been published, and a stamp still resolving to nothing names a
// record the host does not hold at all.
function usageEntry(tier, segment, name, fileKey, kind, projectKey) {
    const entry = {
        type: 'usage',
        tier,
        segment: segment === undefined ? null : segment,
        name,
        fileKey,
        kind,
        at: new Date().toISOString(),
        sessionId: null,
        // Random: the queue ignores a held id, so a shared one would drop a write.
        stampId: stampId()
    };
    // The fleet store's key, where the writer holds one: a project stamp
    // carrying it resolves against the project's fleet-wide store first, and
    // against the caller's older store by segment where no fleet row matches.
    if (typeof projectKey === 'string' && projectKey !== '') entry.projectKey = projectKey;
    return entry;
}

// One journal entry as the row mem.usp_AppendOutcomes reads. The journal is
// project-tier only, so the store is named by its segment alone and no tier
// word rides along. The entry's own fields are passed through as memq built
// them, already bounded by its write-time caps; the host holds the journal, and
// no file copy of a new entry is written.
//
// A judged pointer's row adds its four fields under the names the procedure
// reads: the recognition id, the judge's score, the stage-1 rank as
// `vectorRank`, and the shown flag, and its stamp id is the one pointerStampId
// derives from the recognition id. A row logged by `memq log` carries none of
// them and takes a fresh stamp id.
function outcomeEntry(segment, entry) {
    const row = {
        type: 'outcome',
        segment,
        actionKey: entry.key,
        result: entry.outcome,
        summary: entry.summary,
        detail: entry.detail === undefined ? null : entry.detail,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        at: entry.ts,
        // Random for a logged outcome: the queue ignores a held id, so a
        // shared one would drop a log.
        stampId: entry.recognitionId === undefined ? stampId() : pointerStampId(entry.recognitionId)
    };
    if (entry.recognitionId !== undefined) {
        row.recognitionId = entry.recognitionId;
        row.score = entry.score === undefined ? null : entry.score;
        row.vectorRank = entry.rank === undefined ? null : entry.rank;
        row.shown = entry.shown === undefined ? null : entry.shown;
    }
    return row;
}

// One record write as the row mem.usp_PutRecord reads, bound for the queue or
// for the host directly. The store is named by the tier and its key, a project
// key, a type name, or neither for the operator tier. Every field a caller does
// not give is null, which the procedure reads as "keep" on a replace and as the
// column's absence on an insert; a list is an array, an empty one clearing the
// column, and never an empty string. Two scalars an empty string clears, so a
// write that states the record whole sends '' for either where it has none:
// the machine scope and the space, each of which the procedure trims to NULL. `replace` is the
// flag that lets the write land on a name the store already holds. The stamp
// id is the identity mem.RecordStamp recognises a resend by, so a queued row
// sent twice stores once and never meets its own write as a refusal.
function recordEntry(fields) {
    const given = (name) => (fields[name] === undefined ? null : fields[name]);
    return {
        type: 'record',
        tier: fields.tier,
        projectKey: given('projectKey'),
        typeName: given('typeName'),
        name: fields.name,
        space: given('space'),
        machine: given('machine'),
        description: given('description'),
        body: given('body'),
        tags: given('tags'),
        triggers: given('triggers'),
        anchors: given('anchors'),
        pinned: given('pinned'),
        supersedes: given('supersedes'),
        author: given('author'),
        replace: fields.replace === true,
        at: new Date().toISOString(),
        // Random: the queue ignores a held id, so a shared one would drop a write.
        stampId: stampId()
    };
}

// One record retirement as the row mem.usp_ArchiveRecord reads: the record by
// its tier, its store's key and its name, and whether it takes the deleted
// mark beside the archived flag. The deleted mark is a soft delete no read
// procedure serves; nothing this client sends removes a row.
function archiveEntry(fields) {
    return {
        type: 'archive',
        tier: fields.tier,
        projectKey: fields.projectKey === undefined ? null : fields.projectKey,
        typeName: fields.typeName === undefined ? null : fields.typeName,
        name: fields.name,
        delete: fields.delete === true,
        at: new Date().toISOString(),
        // Random: the queue ignores a held id, so a shared one would drop a write.
        stampId: stampId()
    };
}

// The write door's one sentence for contention, naming what met it: `chosen`
// is 'this write' for the row's own send and 'this write\'s health probe' for
// the probe ahead of it.
function writeContentionText(chosen, detail) {
    return 'the memory database chose ' + chosen + ' as a deadlock victim or timed out its lock request ('
        + detail + ')';
}

// Write one row through to the host, with the queue ahead of it, as the write
// verbs do. The answer's `state` is one of:
//
//   standDown   nothing was attempted: no config, a store root that is not
//               the machine's own, or a row the host would refuse, with
//               `standDown` and `detail` as standDownText reads
//   queued      the host did not take it now and the row is on the queue, with
//               `reason` (down, unreachable, schema, drain, budget or
//               contention) and `detail`
//   unwritable  the host did not take it and the queue would not either, which
//               for a record row is a save that did not land anywhere
//   delivered   the host answered, with `answer` as the procedure's one row
//   refused     the host threw over the row, which is a defect in what this
//               client composed rather than a host to wait for; nothing is queued
//   unreachable the host did not take it and the caller asked for no queue
//               (`queue: false`), with `reason` and `detail` as a queued
//               answer carries them, less where the row waits; the row is
//               nowhere, which is what such a caller wants for a row composed
//               from a read the host may no longer stand behind. The reasons
//               drain and budget mean the host answered and the queue ahead of
//               the row did not finish draining, and contention that the host
//               answered and named another session's lock, on the row's own
//               send or on the probe ahead of it
//
// The order is the contract. A fresh down marker queues at once with no spawn,
// so a burst of writes in an outage costs one timeout. Otherwise the probe
// runs at its own budget, and a host that does not answer it leaves the marker
// and the row goes to the queue. A host below the version the row needs keeps
// it on the queue too: a record row needs RECORD_SCHEMA_VERSION, a stamp row
// REQUIRED_SCHEMA_VERSION. Then the queue drains, so a row queued in an outage
// lands before the write made once the host came back, and a put lands before
// a later replace of the same name; a drain that does not finish, on a
// transport fault, a spent budget, a held lock, a refusal that could not be
// filed, a held record row, a contention stop or a page with rows still behind
// it, queues this row behind what remains rather than sending it ahead of
// them. A contention stop is the host's own lock on a unit, a deadlock victim
// or a lock request timeout; `contended`, a different word, is this machine's
// queue file held by another writer. A refusal the
// drain filed is no such stop: the refused unit is off the queue, and this row
// goes on. Only then is the row itself sent, and an outage on that call leaves
// the marker and queues it.
//
// THE WRITE SPENDS THE PROBE PLUS ONE CALL'S CLOCK. The drain and the row's own
// send share one deadline of `config.timeoutMs` from the moment the probe
// answered: each drain call takes its clock from what is left of it, and the
// row's send takes the rest, so a verb that drains and sends is bounded by
// PROBE_TIMEOUT_MS plus `config.timeoutMs` whatever the queue holds, and a
// deadline the drain spent whole queues the row with reason `budget`. A caller
// that already probed this host on this call passes the version it read as
// `probed`, and no second probe is spawned; the deadline then starts here.
//
// `drain` rides out on every answer past the probe, since a drain that filed a
// refused unit is something the verb prints a line about whatever became of
// its own row.
function writeThrough(entry, options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { state: 'standDown', standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    const why = unsendable(entry);
    if (why !== null) {
        return {
            state: 'standDown',
            standDown: 'refused',
            detail: 'the row this client composed is not one the memory database takes: ' + why
                + ', so nothing was sent or queued'
        };
    }
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const { type, ...row } = entry;
    const kind = queueKind(type);
    // `waits` is the clause saying where a queued row waits, which a caller
    // that asked for no queue never reads: that caller says the row was not
    // queued in its own sentence.
    const queued = (reason, detail, drain, waits) => {
        let answer;
        if (opts.queue === false) {
            answer = { state: 'unreachable', reason, detail };
        } else {
            const written = queueInsert([entry]);
            answer = written.ok
                ? { state: 'queued', reason, detail: detail + (waits || '') }
                : { state: 'unwritable', reason, detail: written.detail };
        }
        if (drain !== undefined) answer.drain = drain;
        return answer;
    };
    let schema;
    if (Number.isFinite(opts.probed)) {
        schema = Number(opts.probed);
    } else {
        if (hostMarkedDown(now())) {
            return queued('down', hostDownDetail());
        }
        const probe = callProcedure(config, 'usp_Health', {},
            { deps, budgetMs: PROBE_TIMEOUT_MS, killMs: PROBE_TIMEOUT_MS + SQLCMD_FLOOR_MS });
        if (!probe.ok) {
            // Contention is the host answering, so it marks no host down.
            if (probe.cause === 'contention') return queued('contention', writeContentionText('this write\'s health probe', probe.detail));
            markHostDown();
            return queued('unreachable', probe.detail);
        }
        schema = Number(counted(probe.rows).schemaVersion);
    }
    const floor = (kind === 'record' || kind === 'archive') ? RECORD_SCHEMA_VERSION : REQUIRED_SCHEMA_VERSION;
    if (!(Number.isFinite(schema) && schema >= floor)) {
        const found = Number.isFinite(schema) ? 'schema version ' + schema : 'no schema version at all';
        return queued('schema', 'the memory database reports ' + found + ' where this write needs version '
            + floor + '; re-run plugins/grimoire/db/Install-MemoryDatabase.ps1 against the host', undefined,
        ', and the row lands at the first write or db-refresh after it');
    }
    const deadline = now() + config.timeoutMs;
    const drain = drainQueue(config, { deps, budgetMs: config.timeoutMs, deadline, schemaVersion: schema });
    if (drain.outage === true) markHostDown();
    if (!drain.ok) {
        return queued('drain', 'the queue ahead of this write did not finish draining ('
            + ((drain.cause === 'refused' || drain.cause === 'contention') && drain.detail
                ? drain.detail : (drain.cause || 'unclear')) + ')', drain,
            ', so the row waits behind it');
    }
    if (Number.isFinite(drain.remaining) && drain.remaining > 0) {
        return queued('drain', 'the queue ahead of this write still holds ' + drain.remaining + ' row(s) '
            + (drain.held > 0 ? 'waiting for a newer memory database' : 'behind the page this write drained'),
        drain, ', so the row waits behind them and lands at the next write or db-refresh');
    }
    const budgetMs = callBudget(deadline, now(), config.timeoutMs, SQLCMD_FLOOR_MS);
    if (budgetMs === null) {
        return queued('budget', 'the drain ahead of this write spent the write\'s whole clock', drain,
            ', so the row waits on the queue and lands at the next write or db-refresh');
    }
    let sent;
    if (kind === 'usage') {
        sent = callProcedure(config, 'usp_AppendUsage', { '@p_Usage': [row] }, { deps, budgetMs });
    } else if (kind === 'outcome') {
        sent = callProcedure(config, 'usp_AppendOutcomes', { '@p_Outcomes': [row] }, { deps, budgetMs });
    } else {
        sent = sendRecordRow(config, kind, row, { deps, budgetMs });
    }
    if (sent.ok) return { state: 'delivered', answer: counted(sent.rows), drain };
    if (sent.cause === 'refused') return { state: 'refused', detail: sent.detail, drain };
    // Contention is the host answering with another session's lock: the row
    // waits on the queue for the next drain, and the host is not marked down.
    if (sent.cause === 'contention') {
        return queued('contention', writeContentionText('this write', sent.detail), drain);
    }
    markHostDown();
    return queued('unreachable', sent.detail, drain);
}

// The tier and segment of a tier directory, or null where the path is not one
// of the store's three tiers. memq owns both answers, so a stamp writer states
// neither: tierNameFor decides the tier and the directory's own name is the
// segment the store keys that tier by.
function tierIdentity(tierDir) {
    const tier = memqLib().tierNameFor(tierDir);
    if (tier === null) return null;
    if (tier === 'operator') return { tier, segment: null };
    if (tier === 'type') return { tier, segment: path.basename(tierDir) };
    return { tier, segment: path.basename(path.dirname(tierDir)) };
}

// ---------------------------------------------------------------- the walk --

// Every record the walk found, as the rows mem.usp_UpsertRecords reads.
//
// The walk, the tier tokens and the body hash are memory-index's, the same
// three the local semantic sweep uses, so the two derived copies of this store
// are built from one reading of it. The fields beyond the body come from the
// record's own frontmatter through memq's readers, so what counts as a tag, a
// machine or a supersedes pointer is the store's answer rather than this
// file's.
// A live record and its archived namesake key alike: both carry one tier word
// once the archive token is stripped, one segment and one file key, which is
// the store row's own unique key. The store permits both files to exist, so
// the collision is reachable, and sending both would make the row's archived
// flag and its body flip on every run and drop its embeddings each time. The
// pair is therefore reported and neither half is sent, since neither is more
// the record than the other and picking one silently would hide a state the
// operator has to resolve in the store itself.
//
// It is reported on `duplicates` rather than on `failed`, which carries only
// what the walk could not read. A publish reads `failed` as evidence that its
// reading of the store is incomplete and holds every removal back on it, and a
// twin is the opposite of that: both of its files were read, and the key they
// share is known to be backed by files on this machine.
function collectRecords() {
    describedDirectories.clear();
    const walk = indexLib().walkStore();
    const failed = walk.failed.slice();
    const records = [];
    const duplicateKeys = new Set();
    for (const entry of walk.records) {
        const archived = indexLib().isArchivedTier(entry.tier);
        const tier = archived ? entry.tier.replace('-archive', '') : entry.tier;
        const segment = tier === 'operator' ? null : entry.store;
        const file = entry.file;
        let body = '';
        let mtime = null;
        try {
            mtime = fs.statSync(file).mtimeMs;
            body = fs.readFileSync(file, 'utf8');
        } catch (err) {
            failed.push({ store: entry.store, tier: entry.tier, name: entry.name, reason: errText(err) });
            continue;
        }
        const fileKey = memqLib().memoryFileKey(entry.name + '.md');
        const descriptions = describeDirectory(path.dirname(file));
        const fields = memqLib().publishedFields(body);
        records.push({
            tier,
            segment,
            // A project folder's key is its folder name. The folder a store
            // segment was flattened from cannot be read back from the segment,
            // and a synced folder may name no directory on this machine at all,
            // so the walk keys every folder alike; `db-sync` adopts the folder's
            // records into the remote key of the checkout it runs from.
            ...(tier === 'project' ? { projectKey: 'path:' + segment } : {}),
            name: entry.name,
            fileKey,
            // The index line wins where it holds text; an empty index line
            // counts the same as no line, and only then does the record's
            // own frontmatter speak for it, through the one fallback helper
            // memq.js exports, so this walk and listMemories share one parse
            // rule for the field even though this walk reads the whole file
            // and listMemories reads a bounded head.
            description: descriptions.get(entry.name + '.md') || memqLib().frontmatterDescription(body) || '',
            // The record's prose alone, the fields riding in their own columns.
            // The hash is of what is sent, so the embedding leg, which embeds
            // this same text, and the host agree about which text a vector is of.
            body: fields.body,
            bodyHash: indexLib().hashOf(fields.body),
            fileModified: fileModifiedAt(mtime),
            machine: memqLib().machineIdentityOrNull(memqLib().frontmatterValue(body, 'machine')),
            tags: memqLib().frontmatterTags(memqLib().frontmatterValue(body, 'tags')),
            supersedes: memqLib().supersedesName(memqLib().frontmatterValue(body, 'supersedes')),
            triggers: fields.triggers,
            anchors: fields.anchors,
            pinned: fields.pinned,
            // A day the procedure's DATE column refuses, February 30th or year
            // zero among them, would fail the whole batch it rides in, so it is
            // sent as no day, under the screen the file time takes.
            created: fields.created !== null && stamped(fields.created + 'T00:00:00Z') ? fields.created : null,
            author: fields.author,
            archived
        });
    }

    // The collision pass, run after the walk so the second file of a pair is
    // not treated as the change the first one made. A duplicated key is
    // reported once and both of its records are withheld, and the key is
    // handed back so the removal leg knows the host's row for it is still
    // backed by files on this machine.
    const byKey = new Map();
    for (const record of records) {
        const key = recordKey(record.tier, record.segment, record.fileKey);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(record);
    }
    const duplicates = [];
    for (const [key, group] of byKey) {
        if (group.length === 1) continue;
        duplicateKeys.add(key);
        duplicates.push({
            store: group[0].segment,
            tier: group[0].tier,
            name: group[0].name,
            reason: memqLib().sanitize(group[0].name, 80) + ' exists in the ' + group[0].tier
                + ' tier both live and archived, which is one record on the host, so neither copy '
                + 'was published; delete or rename one of them'
        });
    }
    const kept = records.filter((record) =>
        !duplicateKeys.has(recordKey(record.tier, record.segment, record.fileKey)));
    return { records: kept, failed, duplicates, unscanned: walk.unscanned, duplicateKeys };
}

function recordKey(tier, segment, fileKey) {
    return tier + '\u0000' + (segment === null ? '' : segment) + '\u0000' + fileKey;
}

// One directory's index descriptions, read once per directory per run. A tier
// holds one index line per record, and a walk of several hundred records
// otherwise reads each tier's index once per record in it.
const describedDirectories = new Map();
function describeDirectory(dir) {
    if (!describedDirectories.has(dir)) describedDirectories.set(dir, memqLib().readIndexDescriptions(dir));
    return describedDirectories.get(dir);
}

// The live tier directories on this machine, as {tier, segment, dir}. The
// index-orphan pass reads each one's index lines, so it enumerates the tiers
// themselves rather than the records the walk found: a tier whose every record
// file is gone has index lines and no records, which is exactly the state the
// pass exists to report.
function tierDirectories() {
    const out = [{ tier: 'operator', segment: null, dir: memqLib().operatorDirPath() }];
    const segments = memqLib().projectSegments();
    if (segments !== null) {
        for (const segment of segments) {
            out.push({ tier: 'project', segment, dir: memqLib().projectMemoryDirFor(segment) });
        }
    }
    let types = [];
    try { types = fs.readdirSync(memqLib().typesRootPath()); } catch { types = []; }
    for (const type of types) {
        if (!memqLib().isTypeName(type)) continue;
        const dir = path.join(memqLib().typesRootPath(), type);
        try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
        out.push({ tier: 'type', segment: type, dir });
    }
    return out;
}

// The index lines naming a file the tier does not hold, as the rows
// mem.usp_UpsertIndexOrphans reads.
function collectOrphans() {
    const orphans = [];
    for (const tier of tierDirectories()) {
        for (const [file, description] of describeDirectory(tier.dir)) {
            if (!memqLib().isMemoryFilename(file)) continue;
            try {
                if (fs.statSync(path.join(tier.dir, file)).isFile()) continue;
            } catch { /* no file behind the line: that is the orphan */ }
            orphans.push({
                tier: tier.tier,
                segment: tier.segment,
                name: file.slice(0, -3),
                description
            });
        }
    }
    return orphans;
}

// --------------------------------------------------------------- the publish --

function counted(rows) {
    const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    return (first !== null && typeof first === 'object') ? first : {};
}

// One sentence of a publish run's error column, rendered for a channel that
// leaves this machine.
//
// THIS IS THE SAME RENDER THE PRINTED COPY TAKES, AND IT IS THE CHANNEL'S OWN
// RATHER THAN THIS CLIENT'S. The sentences on that column are composed around an
// absolute queue path, SQL Server's own message and an
// operating system's error text, the store sits under the home directory by
// default, and this value lands on a host every sandbox in the fleet reads. The
// same sentence goes to the screen through memq's db-sync failure line, so the
// two are one sentence rendered twice, once to a screen and once to the host. A
// render spelled separately in each module would be one edit away from a column
// that cut at some other point or kept a character the screen removes, storing
// text under a run that nobody ever read. So both callers take the one helper in
// kit-compact-lib, which states the four passes and why they are four.
//
// The cap stays here, because it is this channel's width and it sits beside the
// other widths this module spends. It is the same number memq gives one of these
// sentences, and the pin that compares the two renderings of one value byte for
// byte is what holds the pair together.
//
// The column's type is NVARCHAR(MAX), so nothing on the host bounds this value
// and the five-sentence slice plus this cap are the whole bound.
const COLUMN_TEXT_CAP = 1200;
function columnText(value) {
    return shownText(value, COLUMN_TEXT_CAP);
}

// The whole of `memq db-sync`: drain, publish, list, remove, embed, record.
//
// The order is what makes the run self-healing. The list in step three is a
// live reading of the host rather than a memory of what this machine published,
// so a run whose embedding leg died leaves records the next run sees as
// unembedded and finishes. There is no local copy of database state anywhere in
// this module, so there is nothing to drift.
//
// Every record the walk found is sent, whether its body changed or not. The
// server's `unchanged` disposition stamps the record's last-published time,
// which the thirty-day orphan rule reads, so a client that skipped hash-equal
// records would starve that stamp and every untouched shared record would list
// to the curator as an orphan.
//
// A walk that could not read some tier names nothing as removed. A removal is
// soft and lifts when the file is published again, but only if it is never
// emitted from a partial reading of the store: a tier that failed to enumerate
// is no evidence its records are gone, which is the judgment the local sweep
// takes about the same condition. A store the walk found no record at all in is
// held to the same bar, whatever the walk reported: an empty reading of a store
// the host holds rows for is the shape a mis-resolved root takes, and it is
// indistinguishable from a store whose last record was deleted, so the rows
// stay and the summary says how many were held back.
async function publish(options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    const config = loaded.config;
    const deps = opts.deps || {};
    const started = new Date().toISOString();
    const summary = {
        added: 0, changed: 0, unchanged: 0, skippedOlder: 0, removed: 0, heldBack: 0,
        held: 0, twins: [],
        embedded: 0, embedRejected: 0, drained: 0, queueRemaining: 0, rejected: 0,
        orphans: 0, failed: [], workFailed: false, partial: false,
        outOfBudget: false
    };

    // The two answers a run owes, and they are not the same question. `failed`
    // is everything a person should read, warnings included, and it is the one
    // list: the verb prints all of it, and the only other place any of it goes
    // is the publish run's error column, which carries the failing part of this
    // same list and composes no sentence of its own.
    // `workFailed` is whether something this run set out to do did not happen,
    // which is what the verb's exit code is. They part on a queue that grew past
    // what one call funds and on a queue another writer holds a lock on,
    // both of which are delivered work with something to say. A code taken from
    // the list's emptiness would report failure on either, and a verb that fails
    // on an ordinary busy run teaches its reader to ignore the code.
    //
    // `workFailures` is not a second surface and holds no sentence of its own:
    // every sentence in it is on the list above, and it is the part of that list
    // the run failed at, which is what the publish run's error column carries.
    // The column answers the exit code's question rather than the list's, since
    // a host-side reader treating a null error as a clean run would otherwise
    // read a failure on every busy or oversized publish, and a warning ahead of
    // a real failure in the list's order would otherwise push that failure past
    // the five sentences the column takes. The column's own type is
    // NVARCHAR(MAX), so that slice and this client's own cap on each sentence
    // are the only bound on it.
    const workFailures = [];
    const failure = (reason) => {
        summary.workFailed = true;
        summary.failed.push(reason);
        workFailures.push(reason);
    };

    // The run's one deadline, and the two things every boundary call below asks
    // of it: whether it may start at all, and what clock it gets if it does.
    //
    // The clock is the caller's own budget or what is left of the run's,
    // whichever is smaller, so the budget bounds the chain rather than each link
    // separately. A call refused for want of budget ends the run where it stands
    // and the summary reports what the run did: the records already published
    // are published, every leg of this publish is re-derived from the files on
    // the next run, and nothing here is queued, so stopping early costs a
    // repeat and never a row. A caller running the publish as one step of a
    // longer run passes that run's `deadline`, so the steps share one budget.
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const deadline = Number.isFinite(opts.deadline) ? opts.deadline : now() + RUN_BUDGET_MS;
    const budgetFor = (wantMs, floorMs) =>
        callBudget(deadline, now(), wantMs, floorMs === undefined ? SQLCMD_FLOOR_MS : floorMs);
    const stopped = (what) => {
        summary.outOfBudget = true;
        failure('the run budget of ' + RUN_BUDGET_MS
            + ' ms was spent before ' + what + ', so that call and everything after it was not made');
        return { ok: true, summary };
    };

    // The run's own row on the host, written once from wherever the run ends.
    //
    // EVERY LEG THAT STANDS THE RUN DOWN ON A REFUSAL REACHES IT TOO. A refusal
    // is a permanent defect in what this client built, met on a host that
    // answered the probe one call earlier and will answer the next one, so the
    // run row is both writable and the only trace the fleet gets: a leg that
    // returned without it left the defect recorded on the host nowhere, and a
    // host-side reader watching the error column would see the run simply not
    // happen. It is the same write the ordinary end of the run makes rather than
    // a second one composed beside it, so the two rows cannot come apart.
    //
    // The column carries the part of the printed failure list this run actually
    // failed at, the first five of them in the run's own order, so a run that
    // delivered everything it read and had something to say about the next one
    // records no error and a reader watching this column for trouble is not
    // taught to ignore it.
    //
    // A run that stands down on a refusal prints one sentence, the refusal, and
    // none of the list it had gathered before it, so that sentence is the whole
    // of what its column carries. Anything more would be a sentence on the host
    // that no reader of the run ever saw, and the refusal is what the run
    // stopped on besides.
    //
    // Each sentence is rendered on its own and then joined, which is how the
    // printed copy renders them: one sentence is one value on both channels, so
    // the text under a cut is the same text in both places. columnText above
    // states what that render is and why it is four passes rather than one.
    //
    // A null answer is a run with no budget left for the write. The ordinary end
    // of the run reports that as the stop it is; a leg standing down on a
    // refusal has its own sentence to print and takes the missing row as the
    // lesser loss.
    const recordRun = (endedOn) => {
        const sentences = endedOn ? [endedOn] : workFailures;
        const budgetMs = budgetFor(config.timeoutMs);
        if (budgetMs === null) return null;
        return callProcedure(config, 'usp_AppendPublishRun', {
            '@p_Run': {
                started,
                finished: new Date().toISOString(),
                added: summary.added,
                changed: summary.changed,
                removed: summary.removed,
                embedded: summary.embedded,
                // The key mem.usp_AppendPublishRun reads this count under, in
                // its own OPENJSON ... WITH list. The host's column and this key
                // still carry the local queue's former name, and the name on the
                // wire is the procedure's to change: a client that renamed one
                // side alone would send a key the procedure does not name, which
                // it would read as null and record as zero on every run.
                spoolDrained: summary.drained,
                twins: summary.twins,
                error: sentences.length > 0
                    ? sentences.slice(0, 5).map(columnText).join('; ') : null
            }
        }, { deps, budgetMs });
    };

    // The reachability probe, spent before anything else so an unreachable host
    // is discovered in about the time one spawn costs rather than after a first
    // record batch at the full configured timeout. The hard kill is the module's
    // declared overshoot rather than the probe budget itself, since a kill
    // inside the tool's own floor would refuse every host alive or dead.
    const probe = callProcedure(config, 'usp_Health', {},
        { deps, budgetMs: PROBE_TIMEOUT_MS, killMs: PROBE_TIMEOUT_MS + SQLCMD_FLOOR_MS });
    if (!probe.ok) return { ok: false, standDown: 'unreachable', detail: probe.detail };

    // The record gate, on the version the probe already carries. It stands
    // ahead of the walk, the drain and every write, so a host below it is sent
    // nothing at all.
    const hostSchema = Number(counted(probe.rows).schemaVersion);
    if (!(Number.isFinite(hostSchema) && hostSchema >= RECORD_SCHEMA_VERSION)) {
        const found = Number.isFinite(hostSchema) ? 'schema version ' + hostSchema : 'no schema version at all';
        return {
            ok: false,
            standDown: 'schema',
            detail: 'the memory database reports ' + found + ' where a publish needs version '
                + RECORD_SCHEMA_VERSION + ', which files each project record under its project key, '
                + 'so nothing was sent. Re-run plugins/grimoire/db/Install-MemoryDatabase.ps1 against '
                + 'the host to apply the newer scripts'
        };
    }

    const walk = collectRecords();
    // `partial` is the walk's own completeness and nothing else, because every
    // removal in this run is held back on it. A twinned record is reported
    // beside the rest and leaves it alone: its key is known to be backed by
    // files here, which the removal leg reads from duplicateKeys.
    summary.partial = walk.failed.length > 0 || walk.unscanned.length > 0;
    // A tier that would not read and a key two files claim are both records this
    // run set out to publish and did not, so each moves the exit code as well as
    // printing.
    for (const entry of walk.failed) failure(entry.reason);
    for (const entry of walk.duplicates) failure(entry.reason);

    // The keys of shared records this machine may hold an older copy of than
    // the host does. The procedure answers with counts rather than identities,
    // so what is known is that some record in the batch was skipped as older,
    // and every shared record of that batch is withheld from the embedding leg
    // below.
    //
    // Embedding is the one leg that would write this machine's text against the
    // host's record: the host keeps its newer body, the reader still reports
    // the row unembedded, and vectors made here would be the older text stored
    // against the newer record, which then reads as embedded forever with text
    // no file holds. A withheld record is embedded by the sandbox whose copy is
    // the newer one, and it stays withheld here for as long as this machine's
    // file is behind, which the git sync does not resolve: the sync carries no
    // modification times, so a shared record another machine published reads as
    // older on every later run from this one.
    //
    // Only a shared record is withheld. A project record can be answered older
    // too, a version 7 copy that lost a twin, but the fleet row it lost to is
    // not in the inventory the embedding leg reads, which holds this sandbox's
    // own older project rows and the shared tiers alone, so no project record
    // reaches that leg against another copy's text and none needs withholding.
    // A project record of a version 6 batch keeps its place in the embedding
    // leg beside a withheld shared one, and since a batch is a slice of the
    // walk's order, any store of fewer than a batch's records mixes the two
    // tiers in one call.
    const withheld = new Set();
    for (let at = 0; at < walk.records.length; at += RECORD_BATCH) {
        const batch = walk.records.slice(at, at + RECORD_BATCH);
        const budgetMs = budgetFor(UPSERT_TIMEOUT_MS);
        if (budgetMs === null) return stopped('a record batch');
        const sent = callProcedure(config, 'usp_UpsertRecords', { '@p_Records': batch }, { deps, budgetMs });
        // A REFUSAL IS NOT A HOST THAT DID NOT ANSWER, AND ON THIS LEG IT IS
        // PERMANENT. The host answered the probe one call ago, so what a refusal
        // here names is a defect in the batch this client built, which every
        // later run rebuilds from the same files. Reported as an unreachable
        // host it would send a reader to the network on every run forever while
        // the fault sat in the data, which is the same split the drain already
        // makes on the cause the transport answers with.
        if (!sent.ok) {
            if (!hostAnswered(sent.cause)) return { ok: false, standDown: 'unreachable', detail: sent.detail };
            const refusal = answeredText(sent.cause, 'the ' + batch.length + ' record(s)', 'usp_UpsertRecords',
                sent.detail, 'the run stopped there, so nothing later in it was done and the '
                + 'next run sends every record again from the files on this machine, which '
                + 'still hold every one of them');
            // The row goes down with the run's own account of what it ended on.
            // Its answer is not read: the caller is already being told the run
            // stood down and why, and a second sentence about the bookkeeping
            // would sit in front of the one a reader has to act on.
            recordRun(refusal);
            return { ok: false, standDown: 'refused', detail: refusal };
        }
        const counts = counted(sent.rows);
        summary.added += Number(counts.added) || 0;
        summary.changed += Number(counts.changed) || 0;
        summary.unchanged += Number(counts.unchanged) || 0;
        const older = Number(counts.skippedOlder) || 0;
        summary.skippedOlder += older;
        summary.held += Number(counts.held) || 0;
        // The twins the host resolved, as it named them. Each rides out to the
        // publish run row and to the verb's own line, so the names reach a
        // person and the host both.
        if (Array.isArray(counts.twins)) {
            for (const twin of counts.twins) {
                if (twin !== null && typeof twin === 'object') {
                    summary.twins.push({ name: twin.name, winner: twin.winner, loser: twin.loser });
                }
            }
        }
        if (older > 0) {
            for (const record of batch) {
                if (record.tier === 'project') continue;
                withheld.add(recordKey(record.tier, record.segment, record.fileKey));
            }
        }
    }

    // THE DRAIN RUNS HERE, BEHIND THE RECORDS AND AHEAD OF THE EMBEDDING, AND
    // THE POSITION IS THE CONTRACT. A usage stamp names a record, and
    // mem.usp_AppendUsage resolves that name against the records the host holds,
    // rejecting and counting a stamp that resolves to none rather than writing
    // it. A drain ahead of the upsert above therefore loses every stamp for a
    // record the host has not been told about yet, which is the ordinary case
    // twice over: a record created and stamped between two runs, and a first
    // publish from a machine that has never published, where every queued stamp
    // resolves to nothing. The drain deletes the rows it sent, so those stamps
    // are gone from the host with the summary reporting them delivered, which is
    // the silent loss between queue and database this whole mechanism exists to
    // prevent.
    //
    // It is not later than this either. The embedding leg below is the long one
    // and the run's deadline stops a call rather than queuing it, so a drain
    // behind the embedding is a drain a busy run never reaches, which trades one
    // loss for another. Between the two legs the records exist and the budget is
    // barely spent. It also sits ahead of the removal marking, so a stamp naming
    // a record this very run removes still resolves and lands.
    //
    // The probe above takes no gate: it is the run's first act and the deadline
    // was read one statement earlier, so it starts inside the budget by
    // construction and a gate there could never answer anything but yes. The
    // record batches above carry the run's first gate, and this is the second.
    const drainBudgetMs = budgetFor(config.timeoutMs);
    if (drainBudgetMs === null) return stopped('the queue drain');
    // The probe's own answer carries the host's schema version, which the drain
    // will not send without. It is read from that answer rather than asked for
    // again, because a second call to the same procedure spends a whole spawn on
    // a number this run already holds.
    const drain = drainPages(config, {
        deps,
        budgetMs: config.timeoutMs,
        deadline,
        schemaVersion: counted(probe.rows).schemaVersion
    });
    // What left the queue and what is still on it, which part whenever the delete
    // was never reached or a row arrived behind the read. Both ride out to the
    // summary line, so a queue that keeps reporting the same rows is visible on
    // the surface a person reads rather than only in the file.
    //
    // A count the drain never took is carried as null rather than as zero. A
    // drain refused by the version gate, or stopped by a file no connection could
    // open, knows nothing about how many rows the queue holds, and printing zero
    // would tell a reader, and any later step that scrapes this field, that a
    // full queue is empty. The summary line omits the clause instead, and the
    // cause's own sentence on the failure list is what says nothing was deleted.
    summary.drained = drain.drained;
    summary.queueRemaining = Number.isFinite(drain.remaining) ? drain.remaining : null;
    summary.rejected = drain.rejected || 0;
    // A stamp the host would not record, which after this leg's position is a
    // genuine surprise rather than the ordinary first-publish case: the records
    // were upserted one call earlier, so a stamp still resolving to nothing
    // names a record the host does not hold at all. The count is the only thing
    // that says so, since the procedure answers in counts rather than
    // identities, and the row it names is off the queue once the delete runs. So
    // it goes on the failure list, where the verb prints it and the publish run
    // records it.
    if (summary.rejected > 0) {
        failure('the queue (rejected): the memory database would not record '
            + summary.rejected + ' queue row(s), each of which resolved to no record it holds, so '
            + 'no row was written for them. The local usage journal on this machine still holds '
            + 'every one');
    }
    // Whatever the drain answers is a fact about the queue and never a reason to
    // abandon the run. The probe above has already had the host's answer and the
    // records are already published, so a refusal here is evidence about the
    // queue's own rows, a file that could not be read or a lock another writer
    // holds, and the legs that follow neither read the queue nor write to it. A
    // host that has since gone away is caught by the inventory read below, which
    // does stand the run down.
    //
    // The drain's cause rides out in front of its own words, because the states
    // it reports have different remedies and the sentence that follows is the
    // host's or the disk's rather than this client's: a reader who sees
    // `refused` knows to fix what is sent, `outage` to wait for the host,
    // `contended` to expect the other writer of this machine's queue file to
    // finish, `contention` to expect the next run to resend a unit the host
    // chose as a deadlock victim or timed out a lock for, `budget` to expect the
    // next run to take it, `schema` to re-run the installer against the host,
    // `oversized` to look at a queue grown past what one call carries,
    // `unreadable` to look at the queue file itself, and `unclearable` to look at
    // the disk. Without it the word the drain reached is known to this module and
    // to nobody the summary reaches.
    //
    // ONE LIST, AND EVERY DRAIN SENTENCE ON IT. The failure list is the publish's
    // one surface for what a run left a person to read: the verb prints it on
    // standard error beside the summary line. The cause word distinguishes the
    // states for the reader and branches nowhere, so no sentence is routed
    // anywhere a person does not read. The count of what the queue still holds
    // goes out on the summary line as well.
    //
    // The exit code is the drain's own `ok` rather than a reading of that list,
    // because a warning and a delivered-but-undeleted row both belong in front of
    // a person and neither is work this run failed to do.
    //
    // A QUEUE FILE HELD IS NOT A FAILURE, AND IT IS THE ORDINARY CASE. Another writer
    // holding the queue's write lock past the busy timeout is a busy machine, and
    // no row is lost in it: either nothing was sent and every row is still there,
    // or the host took the rows and the delete did not run, which the host takes
    // once when the next run sends them again: by the stamp id's unique index,
    // or for a usage stamp on a version 8 host by the usage fold. Two
    // sessions starting inside one drain's window and a session-start publish
    // beside a doctor run reach it, so a verb that exited non-zero there would be
    // exiting non-zero on a healthy machine. The sentence still prints, because
    // the drained count of zero on the summary line is otherwise unexplained.
    // That is `contended`, the queue file's lock. The host's own lock,
    // `contention`, stops the drain with work it set out to do left on the
    // queue, so it counts as work failed, as an outage does.
    const drainFailed = !drain.ok && !drain.contended;
    if (drainFailed) summary.workFailed = true;
    if (drain.detail) summary.failed.push('the queue (' + (drain.cause || 'unclear') + '): ' + drain.detail);
    // The same sentence, taken off the list it was just put on rather than
    // composed a second time, so the host's copy and the printed one cannot
    // come apart.
    if (drainFailed && drain.detail) workFailures.push(summary.failed[summary.failed.length - 1]);

    const identity = modelIdentity(config);
    const listBudgetMs = budgetFor(config.timeoutMs);
    if (listBudgetMs === null) return stopped('the inventory read');
    const listed = callProcedure(config, 'usp_ListRecords', { '@p_ModelIdentity': identity },
        { deps, budgetMs: listBudgetMs });
    // The same split the record batches take: a refusal here is a defect in what
    // this client asks for, and every run asks for the same thing.
    if (!listed.ok) {
        if (!hostAnswered(listed.cause)) return { ok: false, standDown: 'unreachable', detail: listed.detail };
        const refusal = answeredText(listed.cause, 'this sandbox\'s own inventory read', 'usp_ListRecords',
            listed.detail, 'the run stopped there, so nothing was marked removed and nothing '
            + 'was embedded on it; the records this run published are published, and the next '
            + 'run reads the inventory again');
        recordRun(refusal);
        return { ok: false, standDown: 'refused', detail: refusal };
    }

    // The removed set: rows the host holds in this sandbox's own project
    // stores that the walk no longer found. A shared row is never named here,
    // and the procedure ignores one that is, so neither side alone decides it.
    const removed = [];
    const toEmbed = [];
    const byKey = new Map();
    // The stores the walk actually found records in. A listed row whose own
    // store is not among them is left alone: the walk read that store empty,
    // and an empty reading is what a mis-resolved root, a store moved on disk
    // or a permission change all look like from here.
    const storesWalked = new Set();
    for (const record of walk.records) {
        byKey.set(recordKey(record.tier, record.segment, record.fileKey), record);
        storesWalked.add(recordKey(record.tier, record.segment, ''));
    }
    for (const row of listed.rows) {
        if (row === null || typeof row !== 'object') continue;
        const segment = row.segment === undefined ? null : row.segment;
        const key = recordKey(row.tier, segment, row.fileKey);
        const walked = byKey.get(key);
        if (walked === undefined) {
            if (row.tier !== 'project') continue;
            // A key the walk found twice is backed by files on this machine,
            // whichever of them the host holds, so it is not a removal.
            if (walk.duplicateKeys.has(key)) continue;
            if (summary.partial || !storesWalked.has(recordKey(row.tier, segment, ''))) {
                summary.heldBack += 1;
                continue;
            }
            removed.push({ segment: row.segment, fileKey: row.fileKey });
            continue;
        }
        if (!row.embedded && !withheld.has(key)) toEmbed.push({ recordId: row.recordId, record: walked });
    }

    if (removed.length > 0) {
        const budgetMs = budgetFor(UPSERT_TIMEOUT_MS);
        if (budgetMs === null) return stopped('the removal marking');
        const marked = callProcedure(config, 'usp_UpsertRecords',
            { '@p_Records': [], '@p_Removed': removed }, { deps, budgetMs });
        if (!marked.ok) {
            if (!hostAnswered(marked.cause)) return { ok: false, standDown: 'unreachable', detail: marked.detail };
            const refusal = answeredText(marked.cause, 'the ' + removed.length + ' file key(s) this run names as '
                + 'removed', 'usp_UpsertRecords', marked.detail, 'the run stopped there, so '
                + 'no row was marked removed and nothing was embedded on it; the next run '
                + 'names the same keys again');
            recordRun(refusal);
            return { ok: false, standDown: 'refused', detail: refusal };
        }
        summary.removed = Number(counted(marked.rows).removed) || 0;
    }

    const embedded = await embedRecords(config, toEmbed, { deps, deadline });
    summary.embedded = embedded.embedded;
    // A vector row the host would not store, which names a record it does not
    // hold or may not show this sandbox. The records those rows belong to stay
    // unsearchable until some run stores them whole, and nothing on this machine
    // notices that by itself, so the count goes where a person reads it.
    summary.embedRejected = embedded.rejected;
    for (const reason of embedded.failed) failure(reason);
    if (embedded.outOfBudget !== null) return stopped(embedded.outOfBudget);

    const orphans = collectOrphans();
    summary.orphans = orphans.length;
    if (orphans.length > 0) {
        const budgetMs = budgetFor(config.timeoutMs);
        if (budgetMs === null) return stopped('the index orphans');
        const sent = callProcedure(config, 'usp_UpsertIndexOrphans', { '@p_Orphans': orphans },
            { deps, budgetMs });
        if (!sent.ok) failure('the index orphans were not recorded: ' + sent.detail);
    }

    const run = recordRun(null);
    if (run === null) return stopped('the publish run record');
    if (!run.ok) failure('the publish run was not recorded: ' + run.detail);

    return { ok: true, summary };
}

// The queue drain alone, for `db-sync` under the migration marker, which sends
// no record: the probe, then drainQueue under its own version gate, as
// {ok, drain, schemaVersion} or a stand-down. `ok` is whether the drain ran to
// its end. A write lock another connection holds on the queue file is
// `contended`, which the publish counts as no failure either: the host took
// the rows and takes the next run's resend once. The host's schema version rides out beside the
// drain, since db-refresh gates its adoption call on it. A probe the host does
// not answer leaves the down marker, so the verbs behind it queue without a
// probe of their own for the marker's window.
//
// The drain reads a page at a time, so this runs page after page under the
// run budget (drainPages) until the rows the first page found are sent, a
// page stops short of its end, a page removes nothing, or a page holds a
// record row for a newer host. A caller running the drain as one step of a
// longer run passes that run's `deadline`, and the drain takes what is left
// of it rather than a budget of its own.
function drainOnly(options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    const config = loaded.config;
    const deps = opts.deps || {};
    const probe = callProcedure(config, 'usp_Health', {},
        { deps, budgetMs: PROBE_TIMEOUT_MS, killMs: PROBE_TIMEOUT_MS + SQLCMD_FLOOR_MS });
    if (!probe.ok) {
        // A contention answer writes no host-down marker. The probe's reported
        // wording stays as it was, unreachable, since usp_Health runs READ
        // UNCOMMITTED and contention there is all but unreachable itself.
        if (probe.cause !== 'contention') markHostDown();
        return { ok: false, standDown: 'unreachable', detail: probe.detail };
    }
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const schemaVersion = counted(probe.rows).schemaVersion;
    const deadline = Number.isFinite(opts.deadline) ? opts.deadline : now() + RUN_BUDGET_MS;
    const drain = drainPages(config, { deps, budgetMs: config.timeoutMs, deadline, schemaVersion });
    if (drain.outage === true) markHostDown();
    return { ok: drain.ok || Boolean(drain.contended), drain, schemaVersion };
}

// The queue drained page after page, as one drain answer. The first page's
// depth as read is the run's target: later pages are bounded to what is left
// of it, so a row written behind the first read stays for the next run, which
// is the property one page already has (a row inserted while a send is in
// flight survives it) carried across the pages. The loop stops at the target,
// at a page that stopped short of its end, at a page that removed nothing,
// and at a page that held a record row, since every later page would start
// at that same row and name it again. The answer is the pages summed
// (summedDrains).
function drainPages(config, options) {
    const opts = options || {};
    let target = null;
    let sum = null;
    for (;;) {
        const left = target === null ? DRAIN_PAGE_ROWS : Math.min(DRAIN_PAGE_ROWS, target - sum.drained);
        if (left <= 0) break;
        const page = drainQueue(config, { ...opts, limit: left });
        if (target === null) target = Number.isFinite(page.depthRead) ? page.depthRead : 0;
        sum = sum === null ? page : summedDrains(sum, page);
        const more = page.ok && page.drained > 0 && !(page.held > 0)
            && Number.isFinite(page.remaining) && page.remaining > 0;
        if (!more) break;
    }
    return sum;
}

// Two consecutive drain pages as one answer: the counts summed, the later
// page's `ok`, cause, contention, outage and remaining depth, and the details,
// refusals and held count joined, so a caller reads the run as it would read
// one drain.
function summedDrains(first, second) {
    const sum = {
        ...second,
        drained: first.drained + second.drained,
        rejected: first.rejected + second.rejected
    };
    const details = [first.detail, second.detail].filter((d) => typeof d === 'string' && d !== '');
    if (details.length > 0) sum.detail = details.join('; ');
    else delete sum.detail;
    if (sum.ok && sum.cause === undefined && first.cause !== undefined) sum.cause = first.cause;
    const refused = (first.refused || []).concat(second.refused || []);
    if (refused.length > 0) sum.refused = refused;
    const held = (first.held || 0) + (second.held || 0);
    if (held > 0) sum.held = held;
    if (first.outage === true || second.outage === true) sum.outage = true;
    return sum;
}

// Move the records a project folder's key holds into the remote key of the
// checkout `db-sync` runs from, through mem.usp_AdoptProjectStore, as
// {ok, adopted} with the procedure's own counts and names, or a stand-down.
//
// The publish keys every project folder by its folder name, since the walk
// cannot tell which directory a flattened folder name came from. The working
// directory is the one folder whose checkout this machine can read, so its
// records are the ones carried into the key the same repository takes on
// every machine. The procedure refuses any pair but path: into remote:, and a
// second call changes nothing, so a resend is safe. A caller running it as one
// step of a longer run passes that run's `deadline`, and the call takes what
// is left of it, refused before its spawn once none is.
function adoptProjectStore(options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const budgetMs = Number.isFinite(opts.deadline)
        ? callBudget(opts.deadline, now(), UPSERT_TIMEOUT_MS, SQLCMD_FLOOR_MS) : UPSERT_TIMEOUT_MS;
    if (budgetMs === null) {
        return { ok: false, standDown: 'budget',
            detail: 'the run budget of ' + RUN_BUDGET_MS + ' ms was spent before the adoption call' };
    }
    const sent = callProcedure(loaded.config, 'usp_AdoptProjectStore',
        { '@p_FromKey': String(opts.fromKey), '@p_ToKey': String(opts.toKey) },
        { deps: opts.deps, budgetMs, textWidth: PROJECT_KEY_WIDTH });
    if (!sent.ok) {
        if (!hostAnswered(sent.cause)) return { ok: false, standDown: 'unreachable', detail: sent.detail };
        return {
            ok: false,
            standDown: 'refused',
            detail: answeredText(sent.cause, 'the adoption of ' + opts.fromKey + ' into ' + opts.toKey, 'usp_AdoptProjectStore',
                sent.detail, 'nothing was moved, so the folder\'s records stay under its folder-name key '
                + 'and the next run asks for the adoption again')
        };
    }
    const adopted = counted(sent.rows);
    return {
        ok: true,
        adopted: {
            moved: Number(adopted.moved) || 0,
            merged: Number(adopted.merged) || 0,
            skipped: Number(adopted.skipped) || 0,
            mergedNames: Array.isArray(adopted.mergedNames) ? adopted.mergedNames : [],
            skippedNames: Array.isArray(adopted.skippedNames) ? adopted.skippedNames : []
        }
    };
}

// One record read from the host through mem.usp_GetRecord, for a verb that
// merges into a field before it writes it or checks a pointer's target before
// it writes: {ok, record, schemaVersion} with the procedure's row, or null
// where the store holds no live record of the name, which is the procedure's
// no-row answer; {ok: false, cause, detail} where the host could not be asked,
// the cause one of standDown (no config, or a
// redirected store root), down (a fresh marker), unreachable
// (a transport fault), schema (a host below RECORD_SCHEMA_VERSION, which has
// no record procedures, with the version the probe read as `schemaVersion`
// where it read one) or refused (the host threw over the call).
//
// The read honors the down marker as the write door does, and it probes first
// at PROBE_TIMEOUT_MS, so an unreachable host costs the probe's clock and not
// a read's, and the version the probe answers rides out as `schemaVersion` for
// the write that follows to take as `probed`: a verb that reads and then
// writes probes once. A failed probe or read leaves the marker, so a burst of
// calls in an outage costs one timeout; a probe answered with contention leaves
// none. Nothing is queued here: a read has no
// row to keep, and a verb that merges into what it read has nothing true to
// queue without it.
//
// The key rides as one payload literal read with OPENJSON, the record batch's
// own shape, so a project key carrying an apostrophe or a character outside
// ASCII reaches the procedure exactly as the write path sends it.
function readRecord(fields, options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) {
        return { ok: false, cause: 'standDown', standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    }
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    if (hostMarkedDown(now())) {
        return {
            ok: false,
            cause: 'down',
            detail: hostDownDetail()
        };
    }
    const probe = callProcedure(config, 'usp_Health', {},
        { deps, budgetMs: PROBE_TIMEOUT_MS, killMs: PROBE_TIMEOUT_MS + SQLCMD_FLOOR_MS });
    if (!probe.ok) {
        // A contention answer writes no host-down marker; the wording stays
        // unreachable, as drainOnly's probe states.
        if (probe.cause !== 'contention') markHostDown();
        return { ok: false, cause: 'unreachable', detail: probe.detail };
    }
    const schemaVersion = Number(counted(probe.rows).schemaVersion);
    if (!(Number.isFinite(schemaVersion) && schemaVersion >= RECORD_SCHEMA_VERSION)) {
        const found = Number.isFinite(schemaVersion) ? 'schema version ' + schemaVersion : 'no schema version at all';
        const below = {
            ok: false,
            cause: 'schema',
            detail: 'the memory database reports ' + found + ' where a record read needs version '
                + RECORD_SCHEMA_VERSION + '; re-run plugins/grimoire/db/Install-MemoryDatabase.ps1 against the host'
        };
        if (Number.isFinite(schemaVersion)) below.schemaVersion = schemaVersion;
        return below;
    }
    const row = {
        tier: String(fields.tier),
        projectKey: filled(fields.projectKey) ? String(fields.projectKey) : null,
        typeName: filled(fields.typeName) ? String(fields.typeName) : null,
        name: String(fields.name)
    };
    const sent = sendRecordRow(config, 'get', row, { deps, budgetMs: config.timeoutMs });
    if (!sent.ok) {
        if (hostAnswered(sent.cause)) return { ok: false, cause: 'refused', detail: sent.detail };
        markHostDown();
        return { ok: false, cause: 'unreachable', detail: sent.detail };
    }
    const found = Array.isArray(sent.rows) && sent.rows.length > 0 ? sent.rows[0] : null;
    return { ok: true, record: (found !== null && typeof found === 'object') ? found : null, schemaVersion };
}

// ------------------------------------------------------ the one-spawn reads --
//
// A read verb asks the host in one sqlcmd spawn: the batch runs mem.usp_Health
// first and emits its row, then runs the read procedure only where the version
// that row carries meets the gate, and emits the answer rows after it. The
// client reads the gate from the first row and the answer from the rest, so a
// host below the gate answers with its version alone and nothing is sent to
// a procedure it does not have. It is the probe-then-query every other path
// here spends two spawns on, made one call.
//
// Each read kind names its procedure and the key fields a row of its payload
// carries, the record batch's own shape: the keys ride as one JSON array
// payload, pure ASCII in bounded pieces, and the batch reads each row's fields
// out of it with OPENJSON into variables of the procedure's own types, so a
// project key carrying an apostrophe or a character outside ASCII arrives
// whole. Several rows unroll into several calls inside the one spawn, which is
// how `memq get` asks three tiers for one name at one spawn's cost; the
// answer rows carry their tier, so a caller matches them back by tier rather
// than by position, since a name a tier does not hold yields no row.
const INDEX_FIELDS = [
    ['projectKey', '@ProjectKey', 'NVARCHAR(400)', '@p_ProjectKey']
];
const READ_PROCEDURES = {
    index: ['usp_ListIndex', INDEX_FIELDS],
    get: ['usp_GetRecord', GET_FIELDS]
};
function versionedBatch(kind, rows, gate, search) {
    const [procedure, fields] = READ_PROCEDURES[kind];
    const declared = fields.map(([, variable, type]) => variable + ' ' + type).join(', ');
    const read = fields.map(([, variable]) => variable + ' = J.' + variable.replace('@', '[') + ']').join(', ');
    const columns = fields.map(([key, variable, type]) =>
        variable.replace('@', '[') + '] ' + type + ' \'$.' + key + '\'').join(', ');
    const argumentList = fields.map(([, variable, , parameter]) => parameter + ' = ' + variable).join(', ');
    const lines = [
        ';SET NOCOUNT ON',
        payloadLiteral('@Rows', rows),
        ';DECLARE @Health TABLE ( [Json] NVARCHAR(MAX) NULL )',
        ';INSERT INTO @Health ( [Json] ) EXEC mem.usp_Health',
        ";SELECT '" + RESULT_TAG + "' + COALESCE([Json], 'null') FROM @Health",
        ';DECLARE @Gate INT = ' + String(gate),
        ';DECLARE @Version INT = ( SELECT TOP ( 1 ) TRY_CAST(JSON_VALUE([Json], \'$.schemaVersion\') AS INT) FROM @Health )',
        ';DECLARE @Answer TABLE ( [Json] NVARCHAR(MAX) NULL )',
        ';DECLARE ' + declared,
        ';IF @Version >= @Gate',
        'BEGIN'
    ];
    for (let at = 0; at < rows.length; at++) {
        lines.push(';SELECT ' + read + ' FROM OPENJSON(@Rows) R CROSS APPLY OPENJSON(R.[value]) WITH ( '
            + columns + ' ) J WHERE R.[key] = \'' + String(at) + '\'');
        lines.push(';INSERT INTO @Answer ( [Json] ) EXEC mem.' + procedure + ' ' + argumentList);
    }
    lines.push(";SELECT '" + RESULT_TAG + "' + COALESCE([Json], 'null') FROM @Answer");
    // The search leg, inside the same gate: the query text and the vector the
    // caller embedded ride one payload the batch casts into the procedure's
    // types, the query batch's own shape, and the key the index call read is
    // the key the search is scoped to. Its answer is one row holding an
    // array, where every index row is an object, which is how a reader tells
    // the two apart in one result stream.
    //
    // The nearest leg is the same shape over several vectors: one
    // mem.usp_Nearest call per vector, live records only, each answering one
    // array row in the order the vectors were given. A call that answers no
    // row still emits one, an empty array, so the arrays line up with the
    // vectors whatever the host returns.
    if (search !== undefined && search !== null && search.mode === 'nearest') {
        const modelLiteral = textLiteral('@Model', search.model);
        if (modelLiteral === null) return null;
        const bounded = Math.max(1, Math.min(QUERY_LIMIT_MAX, Math.floor(search.limit)));
        lines.push(
            payloadLiteral('@Query', { vectors: search.vectors }),
            ';DECLARE @QueryVector VECTOR(' + EMBED_VECTOR_DIMENSIONS + ')',
            ';DECLARE @Limit INT = ' + String(bounded),
            modelLiteral,
            ';DECLARE @Nearest TABLE ( [Json] NVARCHAR(MAX) NULL )'
        );
        for (let at = 0; at < search.vectors.length; at++) {
            lines.push(
                ';SET @QueryVector = CAST(JSON_QUERY(@Query, \'$.vectors[' + String(at) + ']\') AS VECTOR('
                    + EMBED_VECTOR_DIMENSIONS + '))',
                ';DELETE FROM @Nearest',
                ';INSERT INTO @Nearest ( [Json] ) EXEC mem.usp_Nearest @p_Vector = @QueryVector, @p_Limit = @Limit,'
                    + ' @p_ModelIdentity = @Model',
                ";SELECT '" + RESULT_TAG + "' + COALESCE(( SELECT TOP ( 1 ) [Json] FROM @Nearest ), '[]')"
            );
        }
    } else if (search !== undefined && search !== null) {
        const modelLiteral = textLiteral('@Model', search.model);
        if (modelLiteral === null) return null;
        const bounded = Math.max(1, Math.min(QUERY_LIMIT_MAX, Math.floor(search.limit)));
        const tag = typeof search.tag === 'string' && search.tag !== '' ? search.tag : null;
        const payload = { vector: search.vector, text: queryHead(search.text) };
        if (tag !== null) payload.tag = tag;
        lines.push(
            payloadLiteral('@Query', payload),
            ';DECLARE @QueryVector VECTOR(' + EMBED_VECTOR_DIMENSIONS
                + ') = CAST(JSON_QUERY(@Query, \'$.vector\') AS VECTOR(' + EMBED_VECTOR_DIMENSIONS + '))',
            ';DECLARE @QueryText NVARCHAR(' + QUERY_TEXT_CAP + ') = JSON_VALUE(@Query, \'$.text\')',
            ';DECLARE @Limit INT = ' + String(bounded),
            modelLiteral,
            ';DECLARE @Search TABLE ( [Json] NVARCHAR(MAX) NULL )'
        );
        if (tag !== null) lines.push(';DECLARE @Tag NVARCHAR(' + SEARCH_TAG_CAP + ') = JSON_VALUE(@Query, \'$.tag\')');
        lines.push(';INSERT INTO @Search ( [Json] ) EXEC mem.usp_Search @p_QueryText = @QueryText, @p_QueryVector = @QueryVector,'
            + ' @p_Limit = @Limit, @p_ModelIdentity = @Model, @p_ProjectKey = @ProjectKey'
            + (tag !== null ? ', @p_Tag = @Tag' : ''));
        lines.push(";SELECT '" + RESULT_TAG + "' + COALESCE([Json], 'null') FROM @Search");
    }
    lines.push('END');
    return { procedure, batch: lines.join('\n') };
}

// One read in one spawn, as {ok, schemaVersion, rows, server} or {ok: false,
// cause, detail, server}, the cause one of standDown (no config, or a redirected
// store root), down (a
// fresh marker, no spawn), unreachable (a transport fault, which leaves the
// marker), refused (the host threw over the batch) or schema (a host below
// RECORD_SCHEMA_VERSION, whose version rides out as `schemaVersion`). `server`
// is the host as the config names it, carried on every answer past the config
// read so a caller falling back to the snapshot can name the host it could
// not reach. Section 3's down marker is the one marker: a failed spawn here
// leaves it and every verb within its window reads the snapshot unasked. A
// caller that reached the host on this same run passes `probed: true`, and
// the marker an earlier outage left is not read: the host just answered. A
// caller with a run's `deadline` gets a clock clipped to what is left of it,
// and a cause of budget with no spawn once none is.
function hostRead(kind, rows, options, search) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) {
        return { ok: false, cause: 'standDown', standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    }
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    if (opts.probed !== true && hostMarkedDown(now())) {
        return {
            ok: false,
            cause: 'down',
            server: config.server,
            detail: hostDownDetail()
        };
    }
    const made = versionedBatch(kind, rows, RECORD_SCHEMA_VERSION, search);
    if (made === null) {
        return {
            ok: false,
            cause: 'refused',
            server: config.server,
            detail: 'the embedding model identity is not a value this client writes into a batch'
        };
    }
    const wantMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : config.timeoutMs;
    const budgetMs = Number.isFinite(opts.deadline)
        ? callBudget(opts.deadline, now(), wantMs, SQLCMD_FLOOR_MS) : wantMs;
    if (budgetMs === null) {
        return { ok: false, cause: 'budget', server: config.server,
            detail: 'the run budget was spent before the ' + made.procedure + ' read' };
    }
    const run = (deps.runBatch || runBatch)(config, made.batch,
        { budgetMs, procedure: made.procedure });
    if (!run.ok) {
        if (hostAnswered(run.cause)) return { ok: false, cause: 'refused', server: config.server, detail: run.detail };
        markHostDown();
        return { ok: false, cause: 'unreachable', server: config.server, detail: run.detail };
    }
    const health = Array.isArray(run.rows) && run.rows.length > 0 && run.rows[0] !== null
        && typeof run.rows[0] === 'object' ? run.rows[0] : {};
    const schemaVersion = Number(health.schemaVersion);
    if (!(Number.isFinite(schemaVersion) && schemaVersion >= RECORD_SCHEMA_VERSION)) {
        const found = Number.isFinite(schemaVersion) ? 'schema version ' + schemaVersion : 'no schema version at all';
        const below = {
            ok: false,
            cause: 'schema',
            server: config.server,
            detail: 'the memory database reports ' + found + ' where a record read needs version '
                + RECORD_SCHEMA_VERSION + ', so its answer was not read; re-run '
                + 'plugins/grimoire/db/Install-MemoryDatabase.ps1 against the host'
        };
        if (Number.isFinite(schemaVersion)) below.schemaVersion = schemaVersion;
        return below;
    }
    const after = run.rows.slice(1);
    const arrays = after.filter((row) => Array.isArray(row));
    const nearest = search !== undefined && search !== null && search.mode === 'nearest';
    const hits = (rows, procedure) => rows.map((row) => queryHit(row, procedure)).filter((hit) => hit !== null);
    return {
        ok: true,
        schemaVersion,
        server: config.server,
        rows: after.filter((row) => row !== null && typeof row === 'object' && !Array.isArray(row)),
        search: nearest || arrays.length === 0 ? null : hits(arrays[0], 'usp_Search'),
        lists: nearest ? arrays.map((rows) => hits(rows, 'usp_Nearest')) : null
    };
}

// Questions put to the host by meaning, each text embedded through the
// configured endpoint and then asked in version-gated batches through
// hostRead, as {ok, lists} with one list of queryHit shapes per text, or
// {ok: false, standDown, detail} in the shapes standDownText spells. `mode`
// 'search' asks mem.usp_Search for the first text, in one spawn, scoped to
// `projectKey` through the same index row readIndex binds it with; 'nearest'
// asks mem.usp_Nearest for every text, live records only, in as few spawns
// as the payloads allow, each batch holding the vectors PAYLOAD_FUNDED_CHARS
// funds and at least one.
//
// Both markers are read first, so a host or an embedder that failed inside
// the marker's window costs this call nothing: no spawn and no embedding
// call. A batch the host does not answer leaves the host marker through
// hostRead, and an embedding call that fails in transport leaves the embedder
// marker through embedBatch. Every call takes what is left of one deadline,
// `budgetMs` from the start or the client's query budget, so a caller with a
// clock of its own is never held past it.
async function vectorRead(mode, texts, options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : queryBudgetMs(config);
    const deadline = now() + budgetMs;
    const spent = (what) => ({ ok: false, standDown: 'budget',
        detail: 'the ' + budgetMs + ' ms this query may spend was gone before ' + what });
    const asked = (Array.isArray(texts) ? texts : []).filter((t) => typeof t === 'string' && t.trim() !== '');
    if (asked.length === 0) return { ok: true, lists: [] };
    if (hostMarkedDown(now())) {
        return { ok: false, standDown: 'down', detail: hostDownDetail() };
    }
    if (embedderMarkedDown(now())) return { ok: false, standDown: 'embedder', detail: embedderDownDetail() };
    const questions = mode === 'nearest' ? asked : [queryHead(asked[0])];
    const vectors = [];
    const width = embedCallWidth();
    for (let at = 0; at < questions.length; at += width) {
        const embedMs = callBudget(deadline, now(), config.timeoutMs, EMBEDDING_FLOOR_MS);
        if (embedMs === null) return spent('the embedding call');
        const answered = await (deps.embedBatch || embedBatch)(config, questions.slice(at, at + width),
            { deps, budgetMs: embedMs });
        if (!answered.ok) {
            return { ok: false, standDown: 'embedder', detail: 'the embedding server did not answer: ' + answered.detail };
        }
        for (const vector of answered.vectors) {
            if (vector.length !== EMBED_VECTOR_DIMENSIONS) {
                return { ok: false, standDown: 'refused', detail: 'the embedding server answered a vector of '
                    + vector.length + ' dimensions where this database holds ' + EMBED_VECTOR_DIMENSIONS
                    + ', so no vector was sent' };
            }
            vectors.push(vector);
        }
    }
    const legs = [];
    if (mode === 'nearest') {
        let leg = [];
        let chars = 0;
        for (const vector of vectors) {
            const size = JSON.stringify(vector).length;
            if (leg.length > 0 && chars + size > PAYLOAD_FUNDED_CHARS) { legs.push(leg); leg = []; chars = 0; }
            leg.push(vector);
            chars += size;
        }
        if (leg.length > 0) legs.push(leg);
    } else {
        legs.push(vectors);
    }
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : QUERY_LIMIT_MAX;
    const lists = [];
    for (const leg of legs) {
        const callMs = callBudget(deadline, now(), config.timeoutMs, SQLCMD_FLOOR_MS);
        if (callMs === null) return spent('a call to the memory database');
        const search = mode === 'nearest'
            ? { mode: 'nearest', vectors: leg, limit, model: modelIdentity(config) }
            : { vector: leg[0], text: questions[0], limit, tag: opts.tag, model: modelIdentity(config) };
        const keyRows = mode === 'nearest' ? [] : indexKeyRows(opts.projectKey);
        const read = hostRead('index', keyRows, { config, deps, probed: true, budgetMs: callMs }, search);
        if (!read.ok) {
            if (read.cause === 'schema') return { ok: false, standDown: 'schema', detail: read.detail };
            if (read.cause === 'refused') return { ok: false, standDown: 'refused', detail: read.detail };
            return { ok: false, standDown: 'unreachable', detail: read.detail };
        }
        if (mode === 'nearest') {
            if (!Array.isArray(read.lists) || read.lists.length !== leg.length) {
                return { ok: false, standDown: 'refused', detail: 'the memory database answered '
                    + (Array.isArray(read.lists) ? read.lists.length : 0) + ' neighbour list(s) for '
                    + leg.length + ' record(s)' };
            }
            for (const list of read.lists) lists.push(list);
        } else {
            lists.push(read.search === null ? [] : read.search);
        }
    }
    return { ok: true, lists };
}

// The one index row a read binds its project key through. The batch sets
// @ProjectKey from it, and a search leg in the same batch is scoped to that
// key. A null key lists the shared tiers alone and scopes a search to none.
function indexKeyRows(projectKey) {
    return [{ projectKey: filled(projectKey) ? String(projectKey) : null }];
}

// The index for one project key and the two shared tiers, mem.usp_ListIndex's
// rows, in one spawn. A null key lists the shared tiers alone.
function listIndex(projectKey, options) {
    return hostRead('index', indexKeyRows(projectKey), options);
}

// The most record names one `memq applied` call asks about.
const APPLIED_NAMES_MAX = 64;

// Whether each named record is live in one tier, and when it was last stamped
// applied, read from listIndex's rows in its one spawn and written nowhere.
// `where` is {tier: 'project', projectKey}, {tier: 'type', typeName} or
// {tier: 'operator'}; a shared tier is listed under a null key, since the
// index lists both shared tiers with every key. A name matches a row of the
// asked tier, and for the type tier of the asked type, by exact spelling.
// The answer is {ok, server, tierRows, answers}: tierRows the count of rows
// the asked tier listed, 0 where it listed none at all, and one {name,
// present, lastApplied} per name in the order asked, lastApplied an ISO-8601
// UTC time or null where the record was never stamped applied, and a name the
// tier does not hold is not present. A lastApplied that does not parse as
// a time is a refusal rather than a never, since a never would read as an
// answer. A failed read is
// listIndex's own, so a caller tells a store that did not answer from one
// that answered with no row.
function readApplied(names, where, options) {
    const read = listIndex(where.tier === 'project' ? where.projectKey : null, options);
    if (!read.ok) return read;
    const held = new Map();
    for (const row of read.rows) {
        if (row.tier !== where.tier || typeof row.name !== 'string') continue;
        if (where.tier === 'type' && row.typeName !== where.typeName) continue;
        held.set(row.name, row.lastApplied === undefined ? null : row.lastApplied);
    }
    const answers = [];
    for (const name of names) {
        if (!held.has(name)) {
            answers.push({ name, present: false, lastApplied: null });
            continue;
        }
        const raw = held.get(name);
        if (raw === null) {
            answers.push({ name, present: true, lastApplied: null });
            continue;
        }
        const ms = typeof raw === 'string' ? Date.parse(raw) : NaN;
        if (!Number.isFinite(ms)) {
            return { ok: false, cause: 'refused', server: read.server,
                detail: 'the memory database answered a lastApplied that is not a time for one of the names asked' };
        }
        answers.push({ name, present: true, lastApplied: new Date(ms).toISOString() });
    }
    return { ok: true, server: read.server, tierRows: held.size, answers };
}

// The index and a search over the same key in one spawn, for find, recall and
// judged: the query text is embedded first through the configured endpoint,
// under the configured clock, and the batch carries the search only where the
// endpoint answered a vector of the width the database holds. The answer is
// listIndex's with `search` beside it: the ranked hits as queryHit shapes
// where the search ran, or null, with `searchDetail` naming why it did not,
// so a verb can say that search by meaning was not available. A host below
// the gate pays the embedding call before the batch reports the gate, a
// declared limit of the one-spawn shape. `query` is {text, limit, tag}; a
// null query is listIndex alone.
async function readIndex(projectKey, query, options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) {
        return { ok: false, cause: 'standDown', standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    }
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const passed = { ...opts, config };
    if (query === null || query === undefined || typeof query.text !== 'string' || query.text.trim() === '') {
        return listIndex(projectKey, passed);
    }
    // Under a fresh marker nothing is embedded either: the verb reads the
    // snapshot, which holds no vector to search.
    if (hostMarkedDown(now())) return listIndex(projectKey, passed);
    // Under a fresh embedder marker the call is not made: the index is read
    // alone, with the reason the verb prints for search by meaning.
    if (embedderMarkedDown(now())) {
        const alone = listIndex(projectKey, passed);
        if (alone.ok) alone.searchDetail = embedderDownDetail();
        return alone;
    }
    const embedded = await (deps.embedBatch || embedBatch)(config, [queryHead(query.text)],
        { deps, budgetMs: config.timeoutMs });
    let search = null;
    let searchDetail = null;
    if (!embedded.ok) {
        searchDetail = 'the embedding server did not answer: ' + embedded.detail;
    } else if (embedded.vectors[0].length !== EMBED_VECTOR_DIMENSIONS) {
        searchDetail = 'the embedding server answered a vector of ' + embedded.vectors[0].length
            + ' dimensions where this database holds ' + EMBED_VECTOR_DIMENSIONS;
    } else {
        search = {
            vector: embedded.vectors[0],
            text: query.text,
            limit: Number.isInteger(query.limit) && query.limit > 0 ? query.limit : QUERY_LIMIT_MAX,
            tag: query.tag,
            model: modelIdentity(config)
        };
    }
    const read = hostRead('index', indexKeyRows(projectKey), passed, search);
    if (read.ok && read.search === null && search !== null) {
        searchDetail = 'the memory database answered the index and no search rows';
    }
    read.searchDetail = searchDetail;
    return read;
}

// The records the given keys name, in one spawn, each key {tier, projectKey,
// typeName, name}. The answer holds a row per key the host holds a live or
// archived record for, each carrying its tier.
function getRecords(keys, options) {
    return hostRead('get', keys.map((key) => ({
        tier: String(key.tier),
        projectKey: filled(key.projectKey) ? String(key.projectKey) : null,
        typeName: filled(key.typeName) ? String(key.typeName) : null,
        name: String(key.name)
    })), options);
}

// ------------------------------------------------------------- the recall read --
//
// mem.usp_Recall's candidates for one prompt in one spawn, the one-spawn
// read's shape under the recall's own gate: the batch runs mem.usp_Health and
// emits its row, then calls the procedure only where that row's version meets
// RECALL_SCHEMA_VERSION, so a lower host answers with its version alone and is
// sent nothing it lacks.

// The schema version that carries mem.usp_Recall, and the floor a recall
// stands down below.
const RECALL_SCHEMA_VERSION = 10;

// The most rows mem.usp_Recall serves. It clamps a larger request itself, so
// asking for more reads to a caller as a short answer rather than a clamp.
const RECALL_LIMIT_MAX = 30;

// The subjects mem.usp_Recall reads and the characters of each it matches. A
// list past either bound is refused here, before anything is sent, since the
// procedure would drop the excess and the caller would never learn which
// subjects went unasked.
const RECALL_SUBJECTS_MAX = 32;
const RECALL_SUBJECT_CAP = 1024;

// The width mem.usp_Recall declares @p_Space at, and the characters of body
// head each of its rows carries.
const RECALL_SPACE_CAP = 100;
const RECALL_BODY_HEAD_CAP = 600;

// The most record names a recall reads beside the procedure's candidates,
// and the name grammar each takes: memq's record-name charset at memq's
// name cap, so a name memq would refuse at a write is refused here before
// anything is sent.
const RECALL_NAMES_MAX = 10;
const RECALL_NAME_CAP = 80;
const RECALL_NAME_PATTERN = /^[\w.-]+$/;

// One named record as a recall row: the fields the procedure's rows carry,
// read off a mem.usp_GetRecord row, with no rank, no score and no pass
// position, the body cut to the procedure's head and measured whole, and
// `named` true where a recalled row carries false. Null for a row without a
// name, recallRow's rule.
function namedRecallRow(row) {
    if (row === null || typeof row !== 'object' || typeof row.name !== 'string' || row.name === '') return null;
    const strings = (value) => (Array.isArray(value) ? value.filter((e) => typeof e === 'string') : []);
    const body = typeof row.body === 'string' ? row.body : '';
    return {
        recordId: Number.isFinite(row.recordId) ? row.recordId : null,
        rank: null,
        name: row.name,
        tier: typeof row.tier === 'string' ? row.tier : 'project',
        projectKey: typeof row.projectKey === 'string' ? row.projectKey : null,
        typeName: typeof row.typeName === 'string' ? row.typeName : null,
        description: typeof row.description === 'string' ? row.description : '',
        tags: strings(row.tags),
        triggers: strings(row.triggers),
        archived: row.archived === true,
        bodyLength: body.length,
        bodyHead: body.slice(0, RECALL_BODY_HEAD_CAP),
        score: null,
        fusedScore: null,
        triggerMatched: false,
        textRank: null,
        vectorRank: null,
        named: true
    };
}

// The batch: every value the caller supplies rides one payload literal, read
// out of it with JSON_VALUE and JSON_QUERY into variables of the procedure's
// own types, and the EXEC line names only those variables. The model identity
// takes textLiteral, the screen the config read already held it to, and the
// limit and the trigger switch are digit strings this function derives. Null
// where the model identity is not a value this client writes into a batch.
function recallBatch(query, model) {
    const modelLiteral = textLiteral('@Model', model);
    if (modelLiteral === null) return null;
    const bounded = Math.max(1, Math.min(RECALL_LIMIT_MAX, Math.floor(query.limit)));
    const matchTriggers = query.matchTriggers === false ? '0' : '1';
    const payload = { projectKey: query.projectKey, space: query.space, tags: query.tags,
        subjects: query.subjects, text: query.text };
    if (query.vector !== null) payload.vector = query.vector;
    return [
        ';SET NOCOUNT ON',
        payloadLiteral('@Recall', payload),
        ';DECLARE @Health TABLE ( [Json] NVARCHAR(MAX) NULL )',
        ';INSERT INTO @Health ( [Json] ) EXEC mem.usp_Health',
        ";SELECT '" + RESULT_TAG + "' + COALESCE([Json], 'null') FROM @Health",
        ';DECLARE @Gate INT = ' + String(RECALL_SCHEMA_VERSION),
        ';DECLARE @Version INT = ( SELECT TOP ( 1 ) TRY_CAST(JSON_VALUE([Json], \'$.schemaVersion\') AS INT) FROM @Health )',
        ';DECLARE @Answer TABLE ( [Json] NVARCHAR(MAX) NULL )',
        ';IF @Version >= @Gate',
        'BEGIN',
        ';DECLARE @ProjectKey NVARCHAR(' + PROJECT_KEY_WIDTH + ') = JSON_VALUE(@Recall, \'$.projectKey\')',
        ';DECLARE @Space NVARCHAR(' + RECALL_SPACE_CAP + ') = JSON_VALUE(@Recall, \'$.space\')',
        ';DECLARE @Tags NVARCHAR(MAX) = JSON_QUERY(@Recall, \'$.tags\')',
        ';DECLARE @Subjects NVARCHAR(MAX) = JSON_QUERY(@Recall, \'$.subjects\')',
        ';DECLARE @QueryText NVARCHAR(' + QUERY_TEXT_CAP + ') = JSON_VALUE(@Recall, \'$.text\')',
        ';DECLARE @QueryVector VECTOR(' + EMBED_VECTOR_DIMENSIONS + ') = CAST(JSON_QUERY(@Recall, \'$.vector\') AS VECTOR('
            + EMBED_VECTOR_DIMENSIONS + '))',
        ';DECLARE @Limit INT = ' + String(bounded),
        ';DECLARE @MatchTriggers BIT = ' + matchTriggers,
        modelLiteral,
        ';INSERT INTO @Answer ( [Json] ) EXEC mem.usp_Recall @p_ProjectKey = @ProjectKey, @p_Space = @Space,'
            + ' @p_Tags = @Tags, @p_Subjects = @Subjects, @p_QueryText = @QueryText, @p_QueryVector = @QueryVector,'
            + ' @p_ModelIdentity = @Model, @p_Limit = @Limit, @p_MatchTriggers = @MatchTriggers',
        ";SELECT '" + RESULT_TAG + "' + COALESCE([Json], 'null') FROM @Answer",
        'END'
    ].join('\n');
}

// One recall row as this client hands it on, each field held to the type it
// is read as, or null for a row missing a field it must have: a name, a tier,
// a rank, a body length and a body head no longer than the procedure cuts it
// to. A row that fails is dropped rather than repaired, queryHit's rule for a
// value crossing this boundary.
function recallRow(row) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    if (typeof row.name !== 'string' || row.name === '') return null;
    if (typeof row.tier !== 'string' || row.tier === '') return null;
    if (!Number.isSafeInteger(row.rank) || row.rank < 1) return null;
    if (!Number.isSafeInteger(row.bodyLength) || row.bodyLength < 0) return null;
    if (typeof row.bodyHead !== 'string' || row.bodyHead.length > RECALL_BODY_HEAD_CAP) return null;
    const strings = (value) => (Array.isArray(value) ? value.filter((e) => typeof e === 'string') : []);
    return {
        recordId: Number.isFinite(row.recordId) ? row.recordId : null,
        rank: row.rank,
        name: row.name,
        tier: row.tier,
        projectKey: typeof row.projectKey === 'string' ? row.projectKey : null,
        typeName: typeof row.typeName === 'string' ? row.typeName : null,
        description: typeof row.description === 'string' ? row.description : '',
        tags: strings(row.tags),
        triggers: strings(row.triggers),
        archived: row.archived === true,
        bodyLength: row.bodyLength,
        bodyHead: row.bodyHead,
        score: Number.isFinite(row.score) ? row.score : null,
        fusedScore: Number.isFinite(row.fusedScore) ? row.fusedScore : null,
        triggerMatched: row.triggerMatched === true,
        textRank: rankOf(row.textRank),
        vectorRank: rankOf(row.vectorRank),
        named: false
    };
}

// The candidates mem.usp_Recall ranks for one prompt, as {ok: true,
// schemaVersion, server, rows, vectorDetail} or {ok: false, cause, detail,
// server}. `query` is {projectKey, space, tags, subjects, text, limit,
// names}: tags, subjects and names arrays of strings, the rest a string or
// null, and the limit at most RECALL_LIMIT_MAX. `options.matchTriggers`
// false sends the procedure's trigger pass off, cmd: and glob: alike, which
// memq does under a KIT_MEMORY_PROJECT pin; any other value leaves it on.
//
// `names`, at most RECALL_NAMES_MAX, are records read beside the recall from
// the project tier under the same key through getRecords, mem.usp_GetRecord's
// typed read under its own marker, gate and budget, in a second batch of the
// same spawn's clock. Each rides after the recalled rows as a recall row
// marked `named` true, with the same body head; a name the store does not
// hold yields no row, and a name the procedure also recalled rides once, as
// the recalled row. A read of the names that fails, or that the recall left
// no clock for, leaves the recalled rows as they are and names its failure
// as `namedFailed`, null where it did not fail, so a caller tells the
// procedure's answer from the names' absence.
//
// The text is embedded first through the configured endpoint, readIndex's
// call, and the vector rides the batch only where the endpoint answered one
// of the width the database holds. Where it did not, or a fresh embedder
// marker withholds the call, or there is no text, the recall is still sent
// with no vector and `vectorDetail` names why, so a machine with no embedding
// endpoint recalls by its triggers and its words. A host below the gate pays
// the embedding call before the batch reports the gate, readIndex's declared
// limit.
//
// The causes are hostRead's: standDown (no config, or a redirected store
// root), down (a fresh host marker, no spawn), unreachable (a transport fault,
// which leaves the marker), refused (a query this client will not send, or a
// host that threw over the batch), schema (a host below
// RECALL_SCHEMA_VERSION, whose version rides out as `schemaVersion`) and
// budget (the recall's one deadline gone before the spawn could start). So a
// caller tells an absent recall from an empty one: an empty answer is ok with
// no rows. The rows come back in the procedure's rank order.
async function recallCandidates(query, options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) {
        return { ok: false, cause: 'standDown', standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    }
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const q = query || {};
    const refused = (detail) => ({ ok: false, cause: 'refused', server: config.server, detail });
    const listOf = (value) => (value === undefined || value === null ? [] : value);
    const subjects = listOf(q.subjects);
    if (!Array.isArray(subjects) || subjects.length > RECALL_SUBJECTS_MAX
        || !subjects.every((s) => typeof s === 'string' && s !== '' && s.length <= RECALL_SUBJECT_CAP)) {
        return refused('the recall takes at most ' + RECALL_SUBJECTS_MAX + ' subjects, each a non-empty text of at most '
            + RECALL_SUBJECT_CAP + ' characters, so no recall was sent');
    }
    const tags = listOf(q.tags);
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string' && t !== '' && t.length <= SEARCH_TAG_CAP)) {
        return refused('each recall tag is a non-empty text of at most ' + SEARCH_TAG_CAP + ' characters, so no recall was sent');
    }
    const names = listOf(q.names);
    if (!Array.isArray(names) || names.length > RECALL_NAMES_MAX
        || !names.every((n) => typeof n === 'string' && n.length <= RECALL_NAME_CAP && RECALL_NAME_PATTERN.test(n))) {
        return refused('the recall takes at most ' + RECALL_NAMES_MAX + ' names, each a record name of at most '
            + RECALL_NAME_CAP + ' characters from [A-Za-z0-9_.-], so no recall was sent');
    }
    for (const [what, value, cap] of [['project key', q.projectKey, PROJECT_KEY_WIDTH], ['space', q.space, RECALL_SPACE_CAP]]) {
        if (value !== undefined && value !== null && !(typeof value === 'string' && value.length <= cap)) {
            return refused('the recall ' + what + ' is not a text of at most ' + cap + ' characters, so no recall was sent');
        }
    }
    if (hostMarkedDown(now())) return { ok: false, cause: 'down', server: config.server, detail: hostDownDetail() };

    // The recall's one deadline, queryHost's: the embedding leg and the sqlcmd
    // leg each take their clock from what is left of it, so the two in
    // sequence are bounded once rather than each at a whole clock.
    const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : queryBudgetMs(config);
    const deadline = now() + budgetMs;
    const budgetFor = (wantMs, floorMs) => callBudget(deadline, now(), wantMs, floorMs);
    const spentBefore = (what) => 'the ' + budgetMs + ' ms this recall may spend was gone before ' + what;

    // The embedding leg's clock stops SQLCMD_FLOOR_MS short of the deadline, so
    // a slow embedder still leaves the usp_Recall call its floor and the recall
    // answers without a vector rather than not at all. A window shorter than
    // the embedding floor is no embedding call, since callBudget would lift it
    // to that floor and into the sqlcmd leg's reserve.
    const text = typeof q.text === 'string' ? queryHead(q.text) : '';
    let vector = null;
    let vectorDetail = null;
    const embedRoomMs = deadline - SQLCMD_FLOOR_MS - now();
    const embedMs = embedRoomMs >= EMBEDDING_FLOOR_MS
        ? Math.max(EMBEDDING_FLOOR_MS, Math.min(config.timeoutMs, embedRoomMs)) : null;
    if (text.trim() === '') {
        vectorDetail = 'no query text was given, so nothing was embedded';
    } else if (embedderMarkedDown(now())) {
        vectorDetail = embedderDownDetail();
    } else if (embedMs === null) {
        vectorDetail = 'the ' + budgetMs + ' ms this recall may spend left too little for the embedding call'
            + ' once the usp_Recall call\'s floor was held back';
    } else {
        const embedded = await (deps.embedBatch || embedBatch)(config, [text], { deps, budgetMs: embedMs });
        if (!embedded.ok) {
            vectorDetail = 'the embedding server did not answer: ' + embedded.detail;
        } else if (embedded.vectors[0].length !== EMBED_VECTOR_DIMENSIONS) {
            vectorDetail = 'the embedding server answered a vector of ' + embedded.vectors[0].length
                + ' dimensions where this database holds ' + EMBED_VECTOR_DIMENSIONS;
        } else {
            vector = embedded.vectors[0];
        }
    }

    const limit = Number.isInteger(q.limit) && q.limit > 0 ? q.limit : 10;
    const batch = recallBatch({
        projectKey: filled(q.projectKey) ? q.projectKey : null,
        space: filled(q.space) ? q.space : null,
        tags, subjects, text, vector, limit, matchTriggers: opts.matchTriggers !== false
    }, modelIdentity(config));
    if (batch === null) return refused('the embedding model identity is not a value this client writes into a batch');
    const callMs = budgetFor(config.timeoutMs, SQLCMD_FLOOR_MS);
    if (callMs === null) return { ok: false, cause: 'budget', server: config.server, detail: spentBefore('the usp_Recall call') };
    const run = (deps.runBatch || runBatch)(config, batch, { budgetMs: callMs, procedure: 'usp_Recall' });
    if (!run.ok) {
        if (hostAnswered(run.cause)) return refused(run.detail);
        markHostDown();
        return { ok: false, cause: 'unreachable', server: config.server, detail: run.detail };
    }
    const schemaVersion = Number(counted(run.rows).schemaVersion);
    if (!(Number.isFinite(schemaVersion) && schemaVersion >= RECALL_SCHEMA_VERSION)) {
        const found = Number.isFinite(schemaVersion) ? 'schema version ' + schemaVersion : 'no schema version at all';
        const below = {
            ok: false,
            cause: 'schema',
            server: config.server,
            detail: 'the memory database reports ' + found + ' where a recall needs version '
                + RECALL_SCHEMA_VERSION + ', so the host ran no recall; re-run '
                + 'plugins/grimoire/db/Install-MemoryDatabase.ps1 against the host'
        };
        if (Number.isFinite(schemaVersion)) below.schemaVersion = schemaVersion;
        return below;
    }
    const rows = run.rows.slice(1).map(recallRow).filter((row) => row !== null)
        .sort((a, b) => a.rank - b.rank);
    if (names.length > 0) {
        const recalled = new Set(rows.map((row) => row.name));
        const wanted = names.filter((name) => !recalled.has(name));
        if (wanted.length > 0) {
            const namedMs = budgetFor(config.timeoutMs, SQLCMD_FLOOR_MS);
            if (namedMs === null) {
                return { ok: true, schemaVersion, server: config.server, rows, vectorDetail,
                    namedFailed: spentBefore('the named records\' read') };
            }
            const read = getRecords(wanted.map((name) => ({ tier: 'project', projectKey: filled(q.projectKey) ? q.projectKey : null,
                typeName: null, name })), { config, deps, probed: true, budgetMs: namedMs });
            if (!read.ok) {
                return { ok: true, schemaVersion, server: config.server, rows, vectorDetail,
                    namedFailed: typeof read.detail === 'string' && read.detail !== '' ? read.detail : read.cause };
            }
            for (const row of read.rows) {
                const named = namedRecallRow(row);
                if (named !== null && !recalled.has(named.name)) {
                    rows.push(named);
                    recalled.add(named.name);
                }
            }
        }
    }
    return { ok: true, schemaVersion, server: config.server, rows, vectorDetail, namedFailed: null };
}

// Whether any tier directory on this machine still holds a record file, which
// with no migration marker is what makes `db-refresh` run the publish once:
// a machine whose tiers hold no file has nothing to migrate.
function oldTiersHoldFiles() {
    for (const tier of tierDirectories()) {
        let names = [];
        try { names = fs.readdirSync(tier.dir); } catch { continue; }
        if (names.some((name) => memqLib().isMemoryFilename(name))) return true;
    }
    return false;
}

// Embed one record the host just stored, from the body the writer sent, as
// {ok} or {ok: false, detail}: the embedding call through the configured
// endpoint and one usp_UpsertEmbeddings call, embedRecords' own leg over one
// record. It is bounded by two of the configured clock, since a save that
// waits on an embedder is the verb's own wait. An endpoint that is absent or
// fails is a detail for the caller's one line and never the save's failure:
// the record is stored and `db-refresh` embeds it from the host's inventory.
async function embedStoredRecord(fields, options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, detail: standDownText({ ...loaded, standDown: loaded.reason }) };
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const out = await embedRecords(config,
        [{ recordId: fields.recordId, record: { name: fields.name, body: fields.body } }],
        { deps, deadline: now() + config.timeoutMs * 2 });
    if (out.embedded === 1) return { ok: true };
    if (out.failed.length > 0) return { ok: false, detail: out.failed[0] };
    if (out.outOfBudget !== null) return { ok: false, detail: 'the clock ran out before ' + out.outOfBudget };
    return { ok: false, detail: 'the body holds no text to embed' };
}

// The embed pass `db-refresh` runs: every row mem.usp_ListRecords lists
// without a vector, the fleet stores included, embedded from the body the host
// holds, as {ok, embedded, failed, skipped, outOfBudget, unembedded, unstored,
// unread} or {ok: false, detail} where the inventory could not be read. A body
// is read through mem.usp_GetRecord by tier, key and name, never from a file
// on this machine: a fleet row may hold a twin's newer body from another
// machine, and vectors made from other text would mark it embedded for good.
// A row of this sandbox's older project store carries no key and the record
// procedures do not serve it, so it is skipped and counted: its body is a file
// on this machine, which the publish embeds. A version 6 body still carries
// its frontmatter, which is stripped before chunking so the vectors are made
// from the prose alone.
//
// The bodies ride GET_BATCH keys per spawn, and each batch is embedded before
// the next is read, so an embedder that has gone away costs one batch of
// bodies. The embedder marker is read before every batch, and a fresh one
// stops the pass before a body is fetched. The pass also stops at the first
// transport failure from either side: a body read the host did not answer, or
// an embedding call that timed out or was refused. Every row not reached is
// counted, `unembedded` for the embedder's side and `unread` for the host's,
// and named in one line. A caller running the pass as one step of a longer
// run passes that run's `deadline`.
const GET_BATCH = 20;
async function embedUnembedded(options) {
    const opts = options || {};
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, detail: standDownText({ ...loaded, standDown: loaded.reason }) };
    const config = loaded.config;
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const deadline = Number.isFinite(opts.deadline) ? opts.deadline : now() + RUN_BUDGET_MS;
    const listed = callProcedure(config, 'usp_ListRecords',
        { '@p_ModelIdentity': modelIdentity(config), '@p_IncludeFleet': 1 }, { deps, budgetMs: config.timeoutMs });
    if (!listed.ok) {
        if (!hostAnswered(listed.cause)) markHostDown();
        return { ok: false, detail: 'the inventory was not read: ' + listed.detail };
    }
    const out = {
        ok: true, embedded: 0, failed: [], skipped: 0, outOfBudget: null, unembedded: 0, unstored: 0, unread: 0
    };
    const wanted = [];
    for (const row of listed.rows) {
        if (row === null || typeof row !== 'object' || row.embedded === true) continue;
        if (row.tier === 'project') {
            if (!filled(row.projectKey)) { out.skipped += 1; continue; }
            wanted.push({ key: { tier: 'project', projectKey: row.projectKey, name: row.name }, recordId: row.recordId });
        } else if (row.tier === 'type') {
            wanted.push({ key: { tier: 'type', typeName: row.segment, name: row.name }, recordId: row.recordId });
        } else if (row.tier === 'operator') {
            wanted.push({ key: { tier: 'operator', name: row.name }, recordId: row.recordId });
        }
    }
    for (let at = 0; at < wanted.length; at += GET_BATCH) {
        const slice = wanted.slice(at, at + GET_BATCH);
        const left = wanted.length - at;
        if (embedderMarkedDown(now())) {
            out.unembedded += left;
            out.failed.push(left + ' record(s) were not embedded: ' + embedderDownDetail());
            break;
        }
        if (callBudget(deadline, now(), config.timeoutMs, SQLCMD_FLOOR_MS) === null) {
            out.outOfBudget = 'a body read';
            break;
        }
        const read = getRecords(slice.map((w) => w.key), { config, deps, probed: true });
        if (!read.ok) {
            if (read.cause === 'unreachable') {
                out.unread += left;
                out.failed.push(left + ' record(s) were not embedded: their bodies were not read, and the '
                    + 'memory database did not answer (' + read.detail + '), so no further body was asked for');
                break;
            }
            for (const w of slice) out.failed.push(memqLib().sanitize(String(w.key.name), 80) + ' was not embedded: its body was not read (' + read.detail + ')');
            out.unread += slice.length;
            continue;
        }
        const pending = [];
        for (const w of slice) {
            const row = read.rows.find((r) => r.recordId === w.recordId)
                || read.rows.find((r) => r.tier === w.key.tier && r.name === w.key.name);
            if (row === undefined || typeof row.body !== 'string') {
                out.failed.push(memqLib().sanitize(String(w.key.name), 80) + ' was not embedded: the memory database returned no body for it');
                out.unread += 1;
                continue;
            }
            const body = /^﻿?---\r?\n/.test(row.body) ? memqLib().frontmatterBody(row.body) : row.body;
            pending.push({ recordId: w.recordId, record: { name: row.name, body } });
        }
        if (pending.length === 0) continue;
        const made = await embedRecords(config, pending, { deps, deadline });
        out.embedded += made.embedded;
        out.failed = out.failed.concat(made.failed);
        out.unembedded += made.unembedded;
        out.unstored += made.unstored;
        if (made.outOfBudget !== null) {
            out.outOfBudget = made.outOfBudget;
            break;
        }
        if (made.stopped !== null) {
            const after = wanted.length - (at + slice.length);
            if (after > 0) {
                out.unembedded += after;
                out.failed.push(after + ' more record(s) were not embedded, their bodies left unread behind '
                    + 'the embedding server that did not answer');
            }
            break;
        }
    }
    return out;
}

// Embed and store the records the host reported unembedded.
//
// A RECORD'S CHUNKS NEVER SPLIT ACROSS TWO DATABASE CALLS. The host answers
// "embedded" by the existence of a row for the record and the model, so a
// record whose chunks landed in two calls and whose second call failed would
// read as embedded forever with half its text unsearchable.
//
// That invariant forbids splitting one record and says nothing about packing
// several. So the records are gathered into packs of whole records, a pack
// holding as many as fit inside one call's width, and a pack is one or more
// embedding calls and exactly one database call. Most records in this store are
// a single chunk, so a first publish over a store of several hundred goes from
// several hundred process starts with a TLS login each to a few dozen. A record
// whose own chunk count is at or past that width is a pack by itself and takes
// as many embedding calls as it needs, still landing in one database call.
//
// A pack the server refuses is sent again a record at a time, so the record the
// server would not take is the only one reported. Batching otherwise makes one
// unembeddable body cost every record packed beside it, and the bodies that
// reach that condition are the ones the four-characters-per-token estimate
// behind the chunk ceilings does not fit, which is a standing property of a
// record rather than a passing one: without the retry those packmates would be
// held back on every run for as long as that record stood.
async function embedRecords(config, pending, options) {
    const opts = options || {};
    const deps = opts.deps || {};
    const embed = (typeof deps.embedBatch === 'function') ? deps.embedBatch : embedBatch;
    const identity = modelIdentity(config);
    const callWidth = embedCallWidth();
    // `unembedded` counts the records the embedding server would not answer
    // for, and `unstored` the records whose vectors the host would not take,
    // so a caller can tell an absent endpoint from a host that refused.
    const out = { embedded: 0, rejected: 0, failed: [], outOfBudget: null, unembedded: 0, unstored: 0, stopped: null };

    // The run's deadline, carried in from the publish so this leg's many calls
    // are bounded by the same clock as the few before them, and defaulted to a
    // whole budget of its own for a caller that embeds without one. `outOfBudget`
    // names the call that was refused rather than flagging that one was, since
    // the caller reports it and an embedding call and the write that stores its
    // vectors stop the run at different costs: what was embedded and not stored
    // is re-embedded by the next run, which reads the same records unembedded.
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const deadline = Number.isFinite(opts.deadline) ? opts.deadline : now() + RUN_BUDGET_MS;

    const queue = [];
    for (const item of pending) {
        const chunks = chunkBody(item.record.body);
        if (chunks.length === 0) continue;
        queue.push({ recordId: item.recordId, name: item.record.name, chunks });
    }

    // The packs: whole records accumulated while their chunks fit one call's
    // width, and any record at or past that width standing alone.
    const packs = [];
    let pack = [];
    let width = 0;
    for (const item of queue) {
        if (item.chunks.length >= callWidth) {
            if (pack.length > 0) { packs.push(pack); pack = []; width = 0; }
            packs.push([item]);
            continue;
        }
        if (width + item.chunks.length > callWidth) { packs.push(pack); pack = []; width = 0; }
        pack.push(item);
        width += item.chunks.length;
    }
    if (pack.length > 0) packs.push(pack);

    // One group's chunks embedded, as {ok, rows} or {ok: false, detail}. Every
    // row's vector is the one made from its own text, since the answers come
    // back in the order the texts were sent. The embedded text is composed the
    // way the corpus is composed, through memory-index's own function: the
    // record's name, then the text. A second spelling of that composition is a
    // silent ranking defect.
    const embedGroup = async (group) => {
        const flat = [];
        for (const item of group) {
            item.chunks.forEach((chunk, index) => {
                flat.push({ item, chunk, index, text: indexLib().embedText(item.name, chunk.text) });
            });
        }
        const rows = [];
        for (let at = 0; at < flat.length; at += callWidth) {
            const slice = flat.slice(at, at + callWidth);
            const budgetMs = callBudget(deadline, now(), config.timeoutMs, EMBEDDING_FLOOR_MS);
            if (budgetMs === null) return { ok: false, outOfBudget: 'an embedding call' };
            const answered = await embed(config, slice.map((entry) => entry.text), { deps, budgetMs });
            if (!answered.ok) return { ok: false, detail: answered.detail, transport: answered.transport === true };
            slice.forEach((entry, position) => {
                rows.push({
                    recordId: entry.item.recordId,
                    chunkIndex: entry.index,
                    chunkOffset: entry.chunk.offset,
                    chunkLength: entry.chunk.length,
                    vector: answered.vectors[position],
                    model: identity,
                    dimensions: answered.vectors[position].length
                });
            });
        }
        return { ok: true, rows };
    };

    // An embedding call that failed in transport, a timeout or a refused
    // connection, ends the leg where it stands: every later call would pay the
    // same timeout, and the one-at-a-time retry below would pay it once per
    // record in the pack. The pack it was in and every pack after it are
    // counted unembedded under one line, and `stopped` carries the detail. What
    // the pack had already embedded is dropped, and the next run embeds it.
    // `named` is how many of the pack's records the retry already reported.
    const stopAt = (packIndex, detail, named) => {
        let left = -(named || 0);
        for (let p = packIndex; p < packs.length; p++) left += packs[p].length;
        out.unembedded += left;
        out.stopped = detail;
        out.failed.push(left === 1 && packs[packIndex].length === 1 && packIndex === packs.length - 1
            ? memqLib().sanitize(packs[packIndex][0].name, 80) + ' was not embedded: ' + detail
            : left + ' record(s) were not embedded: the embedding server did not answer (' + detail
                + '), so no further embedding call was made');
        return out;
    };

    for (let packIndex = 0; packIndex < packs.length; packIndex++) {
        const group = packs[packIndex];
        let taken = group;
        let rows = [];
        const answered = await embedGroup(group);
        // A refusal for want of budget ends this leg where it stands rather
        // than falling into the one-at-a-time retry below, which would ask for
        // the same refused call once per record in the pack.
        if (answered.outOfBudget !== undefined && answered.outOfBudget !== null) {
            out.outOfBudget = answered.outOfBudget;
            return out;
        }
        if (!answered.ok && answered.transport === true) return stopAt(packIndex, answered.detail);
        if (answered.ok) {
            rows = answered.rows;
        } else if (group.length === 1) {
            out.failed.push(memqLib().sanitize(group[0].name, 80) + ' was not embedded: ' + answered.detail);
            out.unembedded += 1;
            continue;
        } else {
            taken = [];
            let named = 0;
            for (const item of group) {
                const alone = await embedGroup([item]);
                // The budget running out inside the retry stops the leg on the
                // spot. What this pack has already embedded is dropped rather
                // than stored, which costs the calls that made it and nothing
                // more: those records read unembedded to the next run's
                // inventory and are embedded there.
                if (alone.outOfBudget !== undefined && alone.outOfBudget !== null) {
                    out.outOfBudget = alone.outOfBudget;
                    return out;
                }
                if (!alone.ok && alone.transport === true) return stopAt(packIndex, alone.detail, named);
                if (alone.ok) { taken.push(item); rows = rows.concat(alone.rows); }
                else {
                    out.failed.push(memqLib().sanitize(item.name, 80) + ' was not embedded: ' + alone.detail);
                    out.unembedded += 1;
                    named += 1;
                }
            }
            if (taken.length === 0) continue;
        }
        // The lock budget rather than the configured timeout: this write takes
        // the same fleet publish lock the record upsert takes, at the same
        // thirty-second wait, so a client clock shorter than that wait kills a
        // queuing publisher with its own tool. Here that costs the vectors as
        // well as the call, since the pack is reported embedded and not stored
        // and the next run embeds the same records into the same wall.
        const storeBudgetMs = callBudget(deadline, now(), UPSERT_TIMEOUT_MS, SQLCMD_FLOOR_MS);
        if (storeBudgetMs === null) {
            out.outOfBudget = 'the write that stores a pack\'s vectors';
            return out;
        }
        const sent = callProcedure(config, 'usp_UpsertEmbeddings', { '@p_Embeddings': rows },
            { deps, budgetMs: storeBudgetMs });
        if (!sent.ok) {
            for (const item of taken) {
                out.failed.push(memqLib().sanitize(item.name, 80) + ' was embedded and not stored: ' + sent.detail);
            }
            out.unstored += taken.length;
            continue;
        }
        // The count is the host's own. The procedure answers how many vector
        // rows it wrote and how many it rejected for naming a record the caller
        // cannot see, so a call that came back ok still says nothing about a
        // store having happened until those numbers are read. Every row of the
        // pack landing is what says every record in it is stored, since a record
        // is searchable only with all of its chunks on the host and the answer
        // carries counts rather than identities: which records lost a row is not
        // in it, so a pack stored short credits none of them and is named on the
        // failure list instead. The next run reads those records unembedded from
        // the host's own inventory and embeds them again.
        const stored = counted(sent.rows);
        const wrote = (Number(stored.inserted) || 0) + (Number(stored.updated) || 0);
        const refused = Number(stored.rejected) || 0;
        out.rejected += refused;
        if (wrote === rows.length && refused === 0) {
            out.embedded += taken.length;
            continue;
        }
        out.unstored += taken.length;
        out.failed.push('a pack of ' + taken.length + ' record(s) sent ' + rows.length
            + ' vector row(s) and the memory database stored ' + wrote + ' of them'
            + (refused > 0 ? ', rejecting ' + refused + ' that named a record it does not hold' : '')
            + ', so the pack was not stored whole and no record in it is counted embedded. '
            + 'The next run reads them unembedded and embeds them again');
    }
    return out;
}

// ---------------------------------------------------------- the meter drain --
//
// The persona module meters each turn by creating one turn file under
// ~/.claude/kit-meter/ holding that turn's one JSON line, written once and
// never read back or rewritten, and rewrites one beat file per session there,
// all in process and off the database. `memq meter-drain` carries that meter
// folder to the host. The module runs it at most once every ten minutes, and
// a person may run it by hand.
//
// The meter folder's protocol, in the drain's order. A lock file in the
// meter folder is taken exclusively, and a drain that finds it held does
// nothing. Each turn file's size and modified time are read, then its text.
// A file gone by then is skipped, and one that cannot be read for any other
// reason is kept with that reason. A turn file that is empty, or whose text
// does not end in a newline, is not ready: the module's write may still be
// landing in it, so it is left where it is, is not kept and is no failure.
// One that has stayed that way for over METER_ABANDON_MS is a write that
// never finished, and it is deleted and counted as one unreadable line.
//
// A ready file's lines are read as JSON objects. A line that is not one is
// counted as unreadable and never sent, since every resend would read the
// same line, and a file with no readable row is deleted at once. The rows go
// out in batches through mem.usp_AppendTurnMeter, each batch filled with
// whole files up to METER_BATCH_ROWS rows, and a file holding more rows than
// that is a batch of its own sent over several calls. Once every call of a
// batch answers without an error, each of its files whose size and modified
// time are what they were before the read is deleted. One that moved is
// counted as a resend and stays for the next drain. A count of 0 inserted is
// such an answer: a replayed batch inserts nothing, since
// mem.usp_AppendTurnMeter skips a turn the caller's sandbox already holds
// under that session and turn id. A file the drain did not read, such as one
// written while it sends, is never touched. Where a call fails, every file of
// its batch is kept with the failure's detail: a transport failure, which
// stops the drain, contention, a deadlock victim or a lock request timeout,
// or a refusal, since a host that refuses a whole batch has a condition
// someone can fix, such as an unmapped login or a missing grant. A file that
// cannot be deleted is kept with that reason.
//
// Every beat file is sent on every drain, and one whose beat is over an hour
// old is removed once sent, unless the module rewrote it in the meantime.
//
// The drain sends nothing to a host below METER_SCHEMA_VERSION and touches no
// file there, so a newer client against an older host keeps its meter files
// whole. The sandbox is never sent: both procedures resolve it from the
// login.

const METER_DIR = 'kit-meter';

// The schema version that carries mem.TurnMeter, mem.SessionBeat and their
// procedures, and the floor the meter drain stands down below.
const METER_SCHEMA_VERSION = 9;

// The lock file, and the age past which a lock is taken over as one a drain
// that died left behind. A drain the module starts is killed after 120
// seconds, so a lock older than this is no live drain's.
const METER_LOCK_FILE = 'drain.lock';
const METER_LOCK_STALE_MS = 5 * 60 * 1000;

// How long a turn file may stay not ready, empty or without its closing
// newline, before the drain treats its write as one that never finished and
// deletes it. The module's write is bounded at seconds, so an hour is far past
// any write still landing.
const METER_ABANDON_MS = 60 * 60 * 1000;

// The rows one procedure call carries. A metered turn is a few hundred
// characters, so this batch sits well inside PAYLOAD_FUNDED_CHARS.
const METER_BATCH_ROWS = 200;

// How old a sent beat may be before its file is removed.
const METER_BEAT_KEEP_MS = 60 * 60 * 1000;

// The meter folder's file names: a turn file the module writes, and a
// session's beat file.
const METER_TURN_FILE_RE = /^turns-[A-Za-z0-9_-]{1,120}\.jsonl$/;
const METER_BEAT_FILE_RE = /^beat-[A-Za-z0-9_-]{1,120}\.json$/;

function meterDir() {
    return path.join(os.homedir(), '.claude', METER_DIR);
}

// The lock, taken by creating its file exclusively, as {ok: true, file},
// {ok: false, held: true} where another drain holds it, or {ok: false,
// detail} where the file could not be made at all. A lock past
// METER_LOCK_STALE_MS is removed and taken once.
function takeMeterLock(dir, nowMs) {
    const file = path.join(dir, METER_LOCK_FILE);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const fd = fs.openSync(file, 'wx');
            try {
                fs.writeSync(fd, process.pid + ' ' + new Date(nowMs).toISOString() + '\n');
            } finally {
                fs.closeSync(fd);
            }
            return { ok: true, file };
        } catch (err) {
            if (!err || err.code !== 'EEXIST') return { ok: false, detail: 'the meter folder lock could not be taken: ' + errText(err) };
            let stale = false;
            try {
                stale = nowMs - fs.statSync(file).mtimeMs > METER_LOCK_STALE_MS;
            } catch {
                stale = false;
            }
            if (!stale || attempt > 0) return { ok: false, held: true };
            try { fs.unlinkSync(file); } catch { /* another drain took it over first */ }
        }
    }
    return { ok: false, held: true };
}

function releaseMeterLock(lock) {
    try { fs.unlinkSync(lock.file); } catch { /* a lock left behind is taken over once stale */ }
}

// The meter folder's file names, sorted, or null where it cannot be listed.
function meterNames(dir) {
    try {
        return fs.readdirSync(dir).sort();
    } catch {
        return null;
    }
}

// One JSON object per non-empty line, as {rows, unreadable}. A line that is
// not a JSON object is counted and not sent.
function meterRows(text) {
    const rows = [];
    let unreadable = 0;
    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '') continue;
        let value = null;
        try {
            value = JSON.parse(line);
        } catch {
            value = null;
        }
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) rows.push(value);
        else unreadable += 1;
    }
    return { rows, unreadable };
}

// The size and modified time a file stands at, or null where it cannot be read.
function meterStamp(file) {
    try {
        const stat = fs.statSync(file);
        return stat.size + ':' + stat.mtimeMs;
    } catch {
        return null;
    }
}

// Deletes a turn file, answering null where it is gone, or the reason it could
// not be deleted.
function removeMeterFile(file) {
    try {
        fs.unlinkSync(file);
        return null;
    } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        return 'it could not be removed: ' + errText(err);
    }
}

// One turn file read for sending: {gone: true} where it no longer exists,
// {failed: detail} where it could not be read, {ready: false, modifiedMs}
// where it is empty or does not end in a newline, or {ready: true, stamp,
// rows, unreadable}. The stamp is the size and modified time read before the
// text.
function readMeterFile(file) {
    let stat = null;
    let text = '';
    try {
        stat = fs.statSync(file);
        text = fs.readFileSync(file, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { gone: true };
        return { failed: 'it could not be read: ' + errText(err) };
    }
    if (text === '' || !text.endsWith('\n')) return { ready: false, modifiedMs: stat.mtimeMs };
    const { rows, unreadable } = meterRows(text);
    return { ready: true, stamp: stat.size + ':' + stat.mtimeMs, rows, unreadable };
}

// The ready turn files in batches for mem.usp_AppendTurnMeter: whole files up
// to METER_BATCH_ROWS rows a batch, and a file holding more than that as a
// batch of its own.
function meterBatches(files) {
    const batches = [];
    let open = null;
    for (const file of files) {
        if (file.rows.length > METER_BATCH_ROWS) {
            batches.push({ files: [file], rows: file.rows });
            continue;
        }
        if (open === null || open.rows.length + file.rows.length > METER_BATCH_ROWS) {
            open = { files: [], rows: [] };
            batches.push(open);
        }
        open.files.push(file);
        open.rows = open.rows.concat(file.rows);
    }
    return batches;
}

// The meter folder sent to the host: {ok: true, locked: true} where another drain
// holds the lock, {ok, summary, kept, outage} for a drain that ran, or a
// stand-down where none could (no config, a redirected store root, a fresh
// host-down marker, a host that did not answer the probe, a host below
// METER_SCHEMA_VERSION, a lock that could not be made). `kept` names each
// file left for the next drain, with `detail` the reason. A turn file is kept
// where it could not be read, where a call of its batch failed, with the
// call's failure detail, whether a transport failure, a contention answer or
// a refusal, and where it was sent and could not be deleted. Each beat file
// of a beat batch is kept on that batch's failed call. A turn file that is
// not ready yet, or that moved while it was sent, is in none of these: it
// stays where it is for a later drain. `meterDir`, where given, is the meter
// folder a test points at.
function meterDrain(options) {
    const opts = options || {};
    const deps = opts.deps || {};
    const now = (typeof deps.now === 'function') ? deps.now : Date.now;
    const loaded = hostConfig(opts);
    if (!loaded.ok) return { ok: false, standDown: loaded.reason, detail: loaded.detail, path: loaded.path };
    const config = loaded.config;
    const dir = typeof opts.meterDir === 'string' && opts.meterDir !== '' ? opts.meterDir : meterDir();
    const summary = { files: 0, rows: 0, inserted: 0, rejected: 0, unreadable: 0, resend: 0, beats: 0, beatsRemoved: 0 };
    if (meterNames(dir) === null) return { ok: true, summary, kept: [], outage: false };
    // A fresh host-down marker stands the drain down unprobed, as the queue's
    // other doors do, so a burst of drains in an outage costs one timeout.
    if (hostMarkedDown(now())) return { ok: false, standDown: 'down', detail: hostDownDetail() };
    const lock = takeMeterLock(dir, now());
    if (!lock.ok) return lock.held ? { ok: true, locked: true } : { ok: false, standDown: 'meter', detail: lock.detail };
    try {
        const probe = callProcedure(config, 'usp_Health', {},
            { deps, budgetMs: PROBE_TIMEOUT_MS, killMs: PROBE_TIMEOUT_MS + SQLCMD_FLOOR_MS });
        if (!probe.ok) {
            // A contention answer writes no host-down marker, drainOnly's rule.
            if (probe.cause !== 'contention') markHostDown();
            return { ok: false, standDown: 'unreachable', detail: probe.detail };
        }
        const schemaVersion = Number(counted(probe.rows).schemaVersion);
        if (!(Number.isFinite(schemaVersion) && schemaVersion >= METER_SCHEMA_VERSION)) {
            const found = Number.isFinite(schemaVersion) ? 'schema version ' + schemaVersion : 'no schema version at all';
            return {
                ok: false,
                standDown: 'schema',
                detail: 'the memory database reports ' + found + ' where the meter drain needs version '
                    + METER_SCHEMA_VERSION + ', so nothing was sent and the meter folder is left as it is; re-run '
                    + 'plugins/grimoire/db/Install-MemoryDatabase.ps1 against the host'
            };
        }
        const kept = [];
        let outage = false;

        // Each turn file read once. A file not ready waits, past
        // METER_ABANDON_MS it is deleted as one unreadable line, and a file
        // with no readable row is deleted at once.
        const ready = [];
        for (const name of (meterNames(dir) || []).filter((n) => METER_TURN_FILE_RE.test(n))) {
            const file = path.join(dir, name);
            const read = readMeterFile(file);
            if (read.gone) continue;
            if (read.failed) {
                kept.push({ name, detail: read.failed });
                continue;
            }
            if (!read.ready) {
                if (!(now() - read.modifiedMs > METER_ABANDON_MS)) continue;
                const failed = removeMeterFile(file);
                if (failed !== null) kept.push({ name, detail: failed });
                else summary.unreadable += 1;
                continue;
            }
            summary.unreadable += read.unreadable;
            if (read.rows.length === 0) {
                const failed = removeMeterFile(file);
                if (failed !== null) kept.push({ name, detail: failed });
                continue;
            }
            ready.push({ name, file, stamp: read.stamp, rows: read.rows });
        }

        // Each batch sent whole, and its files deleted only once every call
        // of it answered without an error and only where they did not move.
        for (const batch of meterBatches(ready)) {
            if (outage) break;
            let failure = null;
            let inserted = 0;
            let rejected = 0;
            for (let at = 0; at < batch.rows.length; at += METER_BATCH_ROWS) {
                const run = callProcedure(config, 'usp_AppendTurnMeter', { '@p_Turns': batch.rows.slice(at, at + METER_BATCH_ROWS) },
                    { deps, budgetMs: config.timeoutMs });
                if (!run.ok) {
                    failure = run;
                    break;
                }
                const answer = counted(run.rows);
                if (Number.isSafeInteger(answer.inserted) && answer.inserted > 0) inserted += answer.inserted;
                if (Number.isSafeInteger(answer.rejected) && answer.rejected > 0) rejected += answer.rejected;
            }
            // The calls that answered before a failed one inserted their rows
            // all the same, so their counts stand, and the files stay kept.
            summary.inserted += inserted;
            summary.rejected += rejected;
            if (failure !== null) {
                for (const f of batch.files) kept.push({ name: f.name, detail: failure.detail });
                if (failure.cause === 'outage') outage = true;
                continue;
            }
            summary.rows += batch.rows.length;
            for (const f of batch.files) {
                summary.files += 1;
                const after = meterStamp(f.file);
                if (after === null) continue;
                if (after !== f.stamp) {
                    summary.resend += 1;
                    continue;
                }
                const failed = removeMeterFile(f.file);
                if (failed !== null) kept.push({ name: f.name, detail: 'the host took it, and ' + failed });
            }
        }

        // Every beat file, in batches, and the old ones removed once sent.
        const beats = [];
        for (const name of (outage ? [] : (meterNames(dir) || [])).filter((n) => METER_BEAT_FILE_RE.test(n))) {
            let text = '';
            let row = null;
            try {
                text = fs.readFileSync(path.join(dir, name), 'utf8');
                row = JSON.parse(text);
            } catch {
                row = null;
            }
            if (row !== null && typeof row === 'object' && !Array.isArray(row)) beats.push({ name, text, row });
        }
        for (let at = 0; at < beats.length && !outage; at += METER_BATCH_ROWS) {
            const batch = beats.slice(at, at + METER_BATCH_ROWS);
            const run = callProcedure(config, 'usp_PutSessionBeat', { '@p_Beats': batch.map((b) => b.row) },
                { deps, budgetMs: config.timeoutMs });
            if (!run.ok) {
                for (const b of batch) kept.push({ name: b.name, detail: run.detail });
                if (run.cause === 'outage') outage = true;
                continue;
            }
            summary.beats += batch.length;
            for (const b of batch) {
                const beatMs = Date.parse(String(b.row.beat));
                if (!(Number.isFinite(beatMs) && now() - beatMs > METER_BEAT_KEEP_MS)) continue;
                try {
                    const file = path.join(dir, b.name);
                    if (fs.readFileSync(file, 'utf8') !== b.text) continue;
                    fs.unlinkSync(file);
                    summary.beatsRemoved += 1;
                } catch { /* a beat file that moved since it was read is the next drain's */ }
            }
        }
        if (outage) markHostDown();
        return { ok: kept.length === 0, summary, kept, outage };
    } finally {
        releaseMeterLock(lock);
    }
}

// The run's one line, in the shape the local sweep's counters take: integers
// this module counted itself, no text off the wire.
function summaryLine(summary) {
    const published = summary.added + summary.changed + summary.unchanged + summary.skippedOlder;
    return 'db-sync: ' + published + ' record(s) published (added ' + summary.added
        + ', changed ' + summary.changed + ', unchanged ' + summary.unchanged
        + ', older ' + summary.skippedOlder + '), ' + summary.embedded + ' embedded, '
        + summary.removed + ' removed, ' + summary.drained + ' queue row(s) drained, '
        + summary.orphans + ' index orphan(s)'
        + (summary.queueRemaining > 0 ? ', ' + summary.queueRemaining
            + ' queue row(s) still on the queue' : '')
        + (summary.rejected > 0 ? ', ' + summary.rejected
            + ' queue row(s) the host would not record, so no row on the host holds them' : '')
        + (summary.embedRejected > 0 ? ', ' + summary.embedRejected
            + ' vector row(s) the host would not store, so the records they belong to are not searchable' : '')
        + (summary.heldBack > 0 ? ', ' + summary.heldBack
            + ' removal(s) held back where the store read empty' : '')
        + (summary.held > 0 ? ', ' + summary.held
            + ' record(s) left as the database holds them, written through memq or already retired in the database' : '')
        + (summary.partial ? ', walk incomplete so nothing was marked removed' : '')
        + (summary.outOfBudget ? ', the run budget was spent so it stopped there' : '');
}

// Why a run stood down, in one sentence per reason. A stand-down is loud: the
// caller prints this and does nothing else.
function standDownText(result) {
    if (result.standDown === 'absent') {
        return 'no memory database is configured on this machine (' + result.path + ' does not exist)';
    }
    if (result.standDown === 'unreachable') {
        return 'the memory database did not answer: ' + result.detail;
    }
    // A refusal arrives as a whole sentence, composed by refusedText where the
    // call was made: the server's own words first, then what the run left. It is
    // handed on as it is rather than wrapped in a second clause, since a reader
    // sent to the network over a defect in the data reads the wrong half first.
    if (result.standDown === 'refused') return result.detail;
    // A caller's own clock ran out before a call could start, which is neither a
    // host that was away nor a defect in what was sent: the work is exactly as
    // available on the next run, and the sentence says so rather than sending a
    // reader after a host that is fine.
    if (result.standDown === 'budget') return result.detail;
    // A caller that walked away before the answer arrived, which is neither a
    // host condition nor a defect in what was sent: the sentence says the work
    // was dropped rather than sending a reader after a host that is fine.
    if (result.standDown === 'cancelled') return result.detail;
    // A host up and answering, at a version whose answers this client cannot
    // rank. It carries its own whole sentence, the refusal's shape and for the
    // refusal's reason: waiting resolves nothing here and the remedy is the
    // installer, so the sentence names it rather than sending a reader to the
    // network.
    if (result.standDown === 'schema') return result.detail;
    // A curator verb on a config that names no curator. The sentence names the
    // two fields, since the remedy is the config rather than the host.
    if (result.standDown === 'curator') return result.detail;
    // A fresh down marker, or an embedding server that did not answer: each
    // detail is its own whole sentence.
    if (result.standDown === 'down' || result.standDown === 'embedder') return result.detail;
    // A store root that is not the machine's own: hostConfig's sentence,
    // redirectedRootText, whole.
    if (result.standDown === 'redirected') return result.detail;
    // A meter folder lock that could not be made: its own whole sentence.
    if (result.standDown === 'meter') return result.detail;
    return 'the memory database config at ' + result.path + ' is ' + result.standDown
        + (result.detail ? ' (' + result.detail + ')' : '');
}

module.exports = {
    CONFIG_FILE,
    QUEUE_FILE,
    DOWN_MARKER_FILE,
    EMBED_DOWN_MARKER_FILE,
    DOWN_MARKER_FRESH_MS,
    downMarkerPath,
    embedderDownMarkerPath,
    markHostDown,
    hostMarkedDown,
    markEmbedderDown,
    embedderMarkedDown,
    vectorRead,
    refusedRecordPath,
    recordEntry,
    archiveEntry,
    writeThrough,
    sendRecordRow,
    recordBatch,
    QUEUE_BUSY_TIMEOUT_MS,
    QUEUE_BUSY_TIMEOUT_QUICK_MS,
    RECORD_BATCH,
    CHUNK_TARGET_CHARS,
    CHUNK_MIN_CHARS,
    CHUNK_MAX_CHARS,
    PROBE_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    REQUIRED_SCHEMA_VERSION,
    SEARCH_SCHEMA_VERSION,
    NEAREST_ARCHIVED_SCHEMA_VERSION,
    SCOPED_SEARCH_SCHEMA_VERSION,
    RECORD_SCHEMA_VERSION,
    METER_SCHEMA_VERSION,
    RECALL_SCHEMA_VERSION,
    RECALL_LIMIT_MAX,
    RECALL_SUBJECTS_MAX,
    RECALL_SUBJECT_CAP,
    RECALL_BODY_HEAD_CAP,
    RECALL_NAMES_MAX,
    RECALL_NAME_CAP,
    recallCandidates,
    METER_LOCK_FILE,
    METER_LOCK_STALE_MS,
    METER_ABANDON_MS,
    METER_BEAT_KEEP_MS,
    METER_TURN_FILE_RE,
    METER_BATCH_ROWS,
    meterDir,
    meterDrain,
    DRAIN_PAGE_ROWS,
    SEARCH_SEGMENT_CAP,
    SEARCH_TAG_CAP,
    PAYLOAD_PIECE_CHARS,
    PAYLOAD_PIECES_PER_BUDGET,
    PAYLOAD_FUNDED_CHARS,
    VECTOR_RANK_MAX,
    LOCK_WAIT_MS,
    UPSERT_TIMEOUT_MS,
    RUN_BUDGET_MS,
    PROJECT_KEY_WIDTH,
    SQLCMD_FLOOR_MS,
    SPAWN_MAX_OVERSHOOT_MS,
    COLUMN_TEXT_CAP,
    columnText,
    spawnKillMs,
    failureCause,
    configPath,
    queuePath,
    MIGRATION_MARKER_FILE,
    migrationMarkerPath,
    readMigrationMarker,
    writeMigrationMarker,
    isDefaultStoreRoot,
    storeRootServesDatabase,
    redirectedRootText,
    loadConfig,
    modelIdentity,
    sqlcmdPath,
    childEnvironment,
    clockSeconds,
    callBudget,
    embedCallWidth,
    payloadLiteral,
    payloadCallMs,
    carriesServerMessage,
    runBatch,
    callProcedure,
    embedBatch,
    QUERY_TEXT_CAP,
    queryHead,
    QUERY_LIMIT_MAX,
    queryBudgetMs,
    probeHost,
    queryBatch,
    queryHit,
    queryHost,
    curatorConfig,
    promoteRecord,
    curate,
    hostHealth,
    jevCalibration,
    chunkBody,
    openQueue,
    queueBusy,
    queueInsert,
    queueDepth,
    drainQueue,
    stampId,
    deliver,
    usageEntry,
    outcomeEntry,
    tierIdentity,
    collectRecords,
    collectOrphans,
    publish,
    adoptProjectStore,
    readRecord,
    drainOnly,
    summaryLine,
    standDownText,
    SNAPSHOT_INDEX_FILE,
    SNAPSHOT_INDEX_VERSION,
    SNAPSHOT_PROJECT_KEYS_MAX,
    SNAPSHOT_SECTION_ROWS_MAX,
    snapshotIndexCeiling,
    snapshotDir,
    snapshotIndexPath,
    readSnapshotIndex,
    writeSnapshotIndex,
    snapshotRecordPath,
    writeSnapshotRecord,
    readSnapshotRecord,
    snapshotPresent,
    snapshotAgeText,
    versionedBatch,
    hostRead,
    listIndex,
    readApplied,
    APPLIED_NAMES_MAX,
    readIndex,
    getRecords,
    oldTiersHoldFiles,
    embedStoredRecord,
    embedUnembedded
};
