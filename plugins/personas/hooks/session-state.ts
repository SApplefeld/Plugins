// session-state.ts: the type of the session object hooks/index.ts holds for the life of one session.
//
// The object and its initial values stay in hooks/index.ts, since they are state; this
// file holds the shape alone and imports nothing from hooks/index.ts.

import type { AgentState, FleetHealthMemo } from "./agent-state";
import type { ForkWatch } from "./fork-watch";
import type { ScanPair } from "./pair-drafter";
import type { MemqTouchTier, RecallTier } from "./recall-text";
import type { NudgeRecord, RecognitionIndex, RecognitionScope, RecognitionTier } from "./recognition";
import type { StepWatch } from "./turn-state-text";

// What one session remembers between hooks, one field per thing a handler reads or writes.
export interface SessionState {
  persona: string;
  mySessionId: string;
  myEpoch: number;
  isOwner: boolean;
  state: AgentState;
  storePath: string;
  yieldLogPath: string;
  lastNudgeAt: number;
  // Nudged turns in a row that closed with no status line and did no work,
  // one count per session. turn.complete moves it; reaching
  // MAX_CONSECUTIVE_NUDGES opens the nudge cap's ask.
  nudgedAnswersWithoutStatus: number;
  // The entry the nudge cap's refused ask was logged for, null where none
  // is. While it names the entry and the count stays at the cap, the cap
  // logs nothing more on later ticks. Cleared wherever the count resets.
  nudgeCapRefusedFor: string | null;
  options: { healthTimeoutMs?: number; gitProbeMs?: number; healthCommand?: string[] };
  controllerTickCount: number; // D4: in-session tick counter for backoff and cost_summary
  staleAfterMs: number; // F9a: single-source the staleness threshold
  turnStartedAt: number | null; // plan item 8.3: this session's clock at turn.start, null between turns
  workdir: string; // the directory this session runs in, "" until session.start reads it
  // The newest transcript record timestamp a mid-turn re-prompt covered, or
  // null where none has been queued; hooks/mid-turn-reprompt.ts takes no
  // record at or before it. In memory only, never persisted.
  repromptCoveredUntil: number | null;
  // The start stamp of the oldest owner turn whose re-prompt window has not
  // been read whole, or null where every window was; the scan's stamp, so a
  // window a refused submit, a failed read or a skipped turn end left open
  // is read again at the next owner turn end. In memory only, never persisted.
  repromptWindowFrom: number | null;
  // Whether the re-prompt's id-pending skip has been logged, once per session.
  repromptIdPendingLogged: boolean;
  // The latest owner turn end's re-prompt, settled or in flight, which the
  // next one's starts after; hooks/mid-turn-reprompt.ts links it. Never
  // rejects. In memory only.
  repromptChain: Promise<void>;
  cacheWarmUntil: number | null; // the clock's warm-until instant, which the beat publishes
  // The controller tick's fleet watcher's last reading, for the coordinator
  // persona alone: one entry per persona a reading of this session's has
  // named, plus the three the watcher keeps about the roster file and the tick
  // itself. A key stays for the life of the session once it is in, so a roster
  // that stops naming a persona leaves that persona's entry standing with the
  // class it was last read in, and the name coming back is compared against
  // that class rather than read as new.
  // It sits here, in the session's own memory, and is written to no file. The
  // persisted state is a file inside a persona's own working directory, which
  // a roster can give to more than one persona, and every field of a memo
  // that silences a key is a value the watcher itself produces, so a stored
  // reading is a value the watched party can write to decide what is said
  // about it. A reading held here is one this session composed.
  fleetHealth: Record<string, FleetHealthMemo> | undefined;
  // Whether this session has made a clean roster reading yet. On the reading
  // that sets it, every persona is remembered and only the personas outside
  // the healthy class are reported, a whole healthy fleet being no news and a
  // persona that crashed while the steward was down being the case the watcher
  // exists for. Past it, a name the reading lacks is a persona the roster has
  // gained and is reported against FLEET_UNSEEN rather than against health it
  // was never observed to have.
  // It advances only on a tick whose roster read cleanly, and it advances with
  // the reading itself: a tick that could not read the roster names no
  // persona, so counting it as the first reading would report a whole healthy
  // fleet as new on the first tick that could read one.
  fleetFirstReadingDone: boolean;
  // The stamp id of this session's latest shadow call on the controller
  // decision, held in two halves so the two outcome joiners clear
  // independently. The turn scorer reads and clears the first, the worker's
  // own ASK marker reads and clears the second, so each writes one outcome per
  // controller call and a second scored turn or a second marker writes none.
  // Null where no controller call is held: before the first tick of the
  // session, after a joiner has taken its half, and on every tick of a session
  // running with the seam's kill switch off, which mints no id at all.
  // Session memory rather than persisted state: a stamp id names a call this
  // process made, and a restart's first tick mints a new one.
  jevScoreOutcomeStampId: string | null;
  jevAskMarkerOutcomeStampId: string | null;
  // The stamp id of the controller call whose nudge was last submitted,
  // held until the turn that nudge opened ends and writes the call's acted
  // outcome, or a later nudge replaces it. Null where no nudge is out.
  // Session memory, as the two halves above are.
  jevActedStampId: string | null;
  // The stamp id of the turn-score call of the turn scored last, held until
  // the next turn.start writes what opened that turn as the call's
  // next_trigger outcome. Null where none is held. Session memory, as above.
  jevNextTriggerStampId: string | null;
  // The step watch's reading of the open turn, replaced at every turn.start.
  stepWatch: StepWatch;
  // The index of the open turn's first step whose answer carried an ASK:
  // marker line, null where no step's has. Reset at every turn.start. A
  // reading only: the ask record still opens from turn.complete's own match.
  askSeenAtStep: number | null;
  // The asks the open turn's ask_open calls opened. turn.complete takes it
  // before its first await as the count the closing text's ASK: lines add
  // to, so ASK_TURN_MAX caps both routes together. Reset at every
  // turn.start.
  asksOpenedThisTurn: number;
  // The plan health request's memory, per plan entry: `closingTexts` is the
  // entry's last few closing texts, oldest first, which the next request's
  // state carries. Session memory rather than persisted state: a restart or
  // the entry completing drops the record.
  jevPlanHealth: Map<string, { closingTexts: string[] }>;
  // The stamp id of the latest plan health call, awaiting the next turn's
  // origin for its next_speaker outcome. Null where none is held.
  jevNextSpeakerStampId: string | null;
  // The worker's most recent answer, raw, and the entry the turn that gave
  // it started on, which the controller's state carries as its Last answer
  // line where that entry is the tick's own node. Moved only by the persona's
  // own turn end with an answer to judge: a subagent's completion carries the
  // subagent's report, which is not the worker's answer, and an aborted or
  // answerless completion leaves the previous answer as the most recent. The
  // entry is the key because the answer belongs to the work it closed: after
  // goal_done, a switch, a resume or a completion moves the active entry,
  // the next tick's node is another entry and its state reads none rather
  // than pairing that entry's objective with the old entry's closing answer.
  // Null where none is held, before the first such turn end in this process.
  // Session memory rather than persisted state: a restart's first tick reads
  // none, since the answer that ended a turn under another process is not
  // what this one saw.
  lastAnswer: { goalId: string | null; text: string } | null;
  // Why this session's persona state is not loaded, or null once it is. It
  // starts as the start-up cause, because a session whose session.start
  // never finished holds the built-in default state (the sess initializer in hooks/index.ts) and nothing else.
  // session.start's store read sets the store cause where the file would not
  // read and clears it where the read parsed, and agentic_identity clears it
  // on a store that parsed as an object. While it stands, the six goal tools
  // answer with it in place of an empty tree or a refusal naming a live
  // holder, neither of which is true of a session that never loaded. Every
  // other tool answers on its own terms: persist reads the store before it
  // writes and gives the persona up to whatever session the stored entry
  // names, so a stored tree is not a session's to destroy by writing over it.
  stateNotLoaded: string | null;
  // The one `untracked_work` decision this session keeps in the log: the
  // timestamp of the line it last pushed, and how many turns that line
  // counts. Both are unset until the turn.complete backstop first fires in
  // this session, so a new session pushes its own line and leaves any line
  // an earlier session wrote where it is. Session memory rather than
  // persisted state, for that reason.
  untrackedWorkAt: number | null;
  untrackedWorkCount: number;
  // The heartbeatPath option: the absolute path of the workdir sidecar the
  // supervisor that launched this session reads, or "" where no such option
  // was set. heartbeatPathOf reads it.
  heartbeatPath: string;
  // The time before which kitMemq's read path spawns nothing, set
  // MEMQ_STAND_DOWN_MS, one minute, ahead by a read that ran past its bound
  // or that memq answered with its store-unavailable line, and 0 until one
  // does.
  // Session memory rather than persisted state: a restart probes the host
  // afresh.
  memqStandDownUntil: number;
  // The UTC day, as YYYY-MM-DD, on which kitMemq last logged a
  // memq_spawn_failed decision for each cause, "" until it has. Session
  // memory, so a restart logs its first failure of the day again.
  memqFailedDay: { start: string; timeout: string; unavailable: string };
  // The UTC day, as YYYY-MM-DD, on which the meter last logged a
  // meter_write_failed decision for each cause, "" until it has: `write` for
  // a spool line or beat file that could not be written, `drain` for a drain
  // that ran and did not exit 0. Session memory, as memqFailedDay is.
  meterFailedDay: { write: string; drain: string };
  // When this session last started the spool drain. 0 until it has, except
  // that session.start sets it to its own time, so the first drain runs ten
  // minutes in.
  meterDrainAt: number;
  // Whether a beat write this session started has not settled yet. Read and
  // written by hooks/beat.ts's stamp, which drops a beat while one is pending.
  meterBeatInFlight: boolean;
  // The id of the persona's own last turn this session metered, "" until one.
  meterLastTurnId: string;
  // The launch directory kitMemq runs memq from and the store, the yield log
  // and the goal history resolve against: the first non-empty
  // directory a session.start captured, "" until one has. A later
  // session.start leaves it, because its cwd is wherever the session stands
  // then. This field is the module's copy. A reload of the plugin's code
  // starts a fresh module with it empty, so session.start also writes it to
  // $.state, which the host keeps across that reload, and a later start
  // copies it back from there.
  memqLaunchDir: string;
  // How many records the distiller and memory_add wrote to the kit's memory
  // store in this session, each a memq put that exited 0. The one-time
  // migration's writes are not counted. It counts this module's session
  // across persona switches, never reset by a later session.start, and a
  // reload of the plugin's code rebuilds it at 0. Read by the tick summary's
  // Memory: line.
  memqWrittenThisSession: number;
  // The recall chain's window between two typed prompts. `recallPromptSeq`
  // counts the typed prompts this session ran the chain for, so a chain
  // still collecting when the next prompt arrives registers nothing.
  // `recallPending` holds the last prompt's candidates, each with the stamp
  // id of its memory-recall call line, until the next prompt writes their
  // recall_acted outcomes, or null where no prompt's chain has registered
  // since. The two sets hold the record names the session's own tool calls
  // fetched through `memq get` without `--no-stamp`, and the names the
  // goal-close check stamped applied through `memq touch --applied`, since
  // the last prompt. `recallTouches` holds the touches the session's own
  // tool calls ran through `memq touch --applied` since the last prompt,
  // each with the tier it stamps, since a stamp counts only for a candidate
  // shown from that tier. Session memory, as memqFailedDay is: a reload of
  // the plugin's code between two prompts leaves the earlier prompt's
  // candidates without an outcome.
  recallPromptSeq: number;
  recallPending: { seq: number; candidates: Array<{ name: string; tier: RecallTier | null; typeName: string | null; stampId: string }> } | null;
  recallGetNames: Set<string>;
  recallAppliedNames: Set<string>;
  recallTouches: Array<{ name: string } & MemqTouchTier>;
  // The prompt whose recall chain is still collecting, or null: one chain
  // runs per session at a time, and a prompt arriving under another's chain
  // journals a skip naming it.
  recallChainBusy: { seq: number } | null;
  // The records the memory block has shown this session, each as its
  // lowercased name, since memq compares record names without case on
  // Windows. A name enters when the chain renders it, before the prompt's
  // submit resolves, so a record on a submit the engine then refused still
  // counts as shown. A record here is still asked and still gets its
  // outcome, and is never rendered again in the session. Emptied at
  // session.start and nowhere else.
  recallShownNames: Set<string>;
  // The recognition ask's index and its source. `index` is the snapshot's
  // `cmd:` triggers in the hook's tiers, empty until a load built one. `stamp`
  // is the size and mtime of the snapshot it was built from, null where the
  // last load built nothing, so the next one reads the file again. `checkedAt`
  // is when the last load started, which a tool call reads to start the next
  // at most once a minute. `scope` is the kit's answer about which tiers this
  // session reads, null until a scope run answers. `scopeRunAt` is when the
  // last scope run started, null before the first, which session.start's
  // load and prompt.submit's retry read to start the next no sooner than
  // RECOGNITION_SCOPE_RETRY_MS after a run that did not answer. `loading` is
  // the load in flight, or null. `nudge` is the memory-recognition nudge's
  // index of every trigger kind and anchor, built from the same read of the
  // snapshot and emptied with `index`. Session memory, as memqFailedDay is.
  recognition: { index: RecognitionIndex; nudge: NudgeRecord[]; stamp: string | null; checkedAt: number; scope: RecognitionScope | null; scopeRunAt: number | null; loading: Promise<void> | null };
  // The records a memory-recognition call asked about, each as its tier and
  // its lowercased name, with the stamp id of its call line and how many of
  // the session's tool calls are left before its nudge_acted outcome is
  // written false. Session memory, as recallPending is.
  recognitionPending: Array<{ tier: RecognitionTier; name: string; stampId: string; left: number }>;
  // The records memory-recognition has been asked about this session, each
  // under recognitionKeyOf's tier and name, so a record is asked once a
  // session however many calls match it. Session memory, as recallPending is.
  recognitionAsked: Set<string>;
  // The memory-recognition asks still out, each under the same key as the
  // record it asks about, set as the ask starts and deleted as it settles. A
  // call matching a record already asked awaits the record's entry here, so
  // it claims no pointer ahead of an answer another call is still holding on.
  recognitionAsking: Map<string, Promise<void>>;
  // The records memory-recognition answered skip, under the same key: each
  // has its `cmd:` pointer withheld from the nudge at every tool-call
  // boundary for the rest of the session, since its record is asked once a
  // session and a later match has no answer of its own. Session memory, as
  // recognitionAsked is: both live as long as sess does.
  recognitionSkipped: Set<string>;
  // The pointers the recognition gate has withheld this session, each under
  // the nudgeDedupKey its pointer would have been claimed under, so a
  // withheld pointer writes its event line once, as a pointer given is
  // claimed once. Session memory, as recognitionSkipped is.
  recognitionWithheld: Set<string>;
  // The last line route one of the promotion routes logged, which is what
  // promotePlanTouchingRecord in hooks/records.ts holds its two no-entry
  // lines to one of per reading by. It carries the record it was logged for,
  // so a new record's first reading is logged whatever the record before it
  // read. Session memory rather than persisted state, so a relaunched session
  // logs its record's current reading once more.
  lastPlanRouteLine: { recordId: string; action: string; detail: string } | null;
  // The fork watches of the three drains in hooks/drains.ts, each its own.
  // Ticks can overlap, and a second drain beside an unresolved fork would
  // fork the next item too, so a tick that finds one running drains nothing,
  // short of its fork's bound in hooks/fork-watch.ts. The pair drain's owe in
  // tool.call and the 30-second heartbeat both start it, and it can run
  // longer, so neither starts a second while one runs: a scan owed then waits
  // for a later tick. Session memory rather than persisted state, as
  // lastPlanRouteLine is.
  memoryFork: ForkWatch;
  askBriefFork: ForkWatch;
  pairFork: ForkWatch;
  // The pairs the running turn's own `memq decay-scan` listed, owed to
  // drainPairDraftOwed in hooks/drains.ts, and the [PAIR DRAFTS] block that
  // drain holds for that turn's next main-loop tool result. Both live in
  // memory alone, never in `state`: a draft is one turn's hygiene step's and
  // is worthless after it, so a reload or a restart loses nothing worth
  // keeping. The owed item names the turn its scan ran in, so the drain forks
  // only while that turn is open, and turn.complete drops both for the turn
  // that ends.
  pairDraftOwed: { turnId: string; pairs: ScanPair[]; notDrafted: number; at: number } | null;
  pairDrafts: { turnId: string; block: string } | null;
}

