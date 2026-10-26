// Broker configuration, resolved entirely from the environment so an installed service can be
// pointed at a different port or state file without editing source.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comparablePath, defaultEventsPath } from "./board/events.ts";
import { assertTokenFileIsProtected } from "./discord/credentials.ts";

export type BrokerConfig = {
  /** Bound on 127.0.0.1 only. The listener is never exposed off-box. */
  port: number;
  /** Human label for the machine, carried on every session record for the Discord surfaces. */
  host: string;
  /** Absolute path to the persisted registry snapshot. */
  stateFile: string;
  /** A session with no hook traffic and no relay liveness for this long is marked stale. */
  staleAfterMs: number;
  /** How often the staleness sweep runs. */
  sweepIntervalMs: number;
  /**
   * Hard cap on a body posted to the /hook liveness route. That route is nearly content-free: of
   * the payload it is posted, it keeps the session's identity, its tool's name, one bounded
   * preview of that tool's input, and the Stop payload's task table, which the status card
   * renders. Anything larger is drained and dropped with a 202 rather than refused, since a
   * refusal is a visible error inside the session whose hook posted it; nothing over the cap is
   * ever assembled or parsed. The wiring floors the /hook ceiling at `mirrorMaxBytes` below,
   * because both routes receive the same Stop payload and only the /hook copy carries the roster;
   * this knob on its own governs the relay routes.
   */
  maxBodyBytes: number;
  /**
   * How often each attached relay is pinged. It is also the bound on the acceptance criterion that
   * a closed relay marks its session ended: a socket that closes cleanly is noticed at once, and
   * this is the backstop for a pipe that is gone without having said so.
   */
  relayHeartbeatMs: number;
  /** How long an ended or stale record is kept before the sweep prunes it. */
  retainTerminalMs: number;
  /** Ceiling on total records. Terminal records are evicted oldest first to hold it. */
  maxSessions: number;
  /** Absolute path to the rotating log file. Logging falls through to the console when null. */
  logFile: string | null;
  /** Rotate the log file once it reaches this size. */
  logMaxBytes: number;
  /** Total log files kept on disk, the active one plus its rotated predecessors. */
  logMaxFiles: number;
  /**
   * Whether the mirror intake posts console prompts and turn replies to the session's thread. Off,
   * the mirror route still answers 202 and drops everything, because the installed hooks post to it
   * from every session on the machine and a refused post is a visible error inside that session.
   */
  mirror: boolean;
  /**
   * Body ceiling for the mirror route alone. Separate from maxBodyBytes, which keeps governing the
   * /hook liveness route: a mirror body carries a whole turn's reply, and a reply past this
   * ceiling is drained and dropped with a 202 rather than refused, since a 413 surfaces as a visible
   * error inside the session at the end of exactly the longest turns.
   */
  mirrorMaxBytes: number;
  /**
   * Whether the transcript tailer mirrors mid-turn assistant text to a session's thread. Gated
   * by `mirror` as well, at the wiring rather than here: interim mirroring is mirroring, so the
   * host-wide off switch takes both down together.
   */
  interimMirror: boolean;
  /** How often the tailer polls live sessions' transcripts for new mid-turn text. */
  interimPollMs: number;
  /**
   * How long the question desk holds a credited AskUserQuestion hook response open for a thread
   * answer before releasing it to the console picker with a no-decision `{}`.
   */
  questionHoldMs: number;
  /**
   * How a background task's wake prompt reaches a session's thread. When a subagent finishes while
   * its parent session is idle, the harness wakes the session by injecting a prompt that carries
   * the subagent's entire final report, and the mirror would post the whole report into the thread
   * as if the operator had typed it. `brief` compresses that wake-up to a one-line notice, `full`
   * mirrors the whole report exactly as an ordinary prompt, and `off` posts nothing at all.
   */
  taskNotifications: "brief" | "full" | "off";
  /**
   * How much of the peer traffic a session exchanges with other Claude sessions reaches its thread,
   * in both directions. `full` draws each message whole under its own peer attribution; `brief`
   * draws one line per message, the sender's own `summary` where an outbound send wrote one and the
   * body's opening line otherwise; `off` posts none of it.
   *
   * Volume is all this governs, and attribution is not a knob: on every setting a peer message is
   * drawn under the peer attribution rather than the operator's quoted register, and stamps no
   * engagement.
   *
   * What this knob cannot restore is a path that is not running. Two of the three ways a peer
   * message reaches a thread ride the transcript tailer, so with `interimMirror` off only the
   * inbound half delivered to an idle session survives, and the broker says so once at startup.
   */
  peerMessages: "full" | "brief" | "off";
  /**
   * Whether a session's model change posts on the alert tier, with the mention that reaches the
   * operator's phone, rather than on the notice tier. Off by default: a model change is worth
   * reading rather than worth waking someone for, and whether the quiet tier is loud enough on a
   * phone is a question only live use answers, so the louder setting is an env change rather than a
   * code round.
   */
  modelChangeAlert: boolean;
  /**
   * Whether the broker owns a fleet usage card: one thread in the configured channel carrying every
   * account's usage windows and every live session on this host. Off by default, and off is the
   * absence of the machinery rather than a check inside it: no thread is created, no refresh timer
   * runs, and claude-swap's files are never opened.
   */
  usageCard: boolean;
  /** How often the fleet card is re-read and re-rendered. An edit is spent only when it changed. */
  usageCardRefreshMs: number;
  /**
   * claude-swap's backup directory, for an install that does not keep it under the user profile.
   * Null leaves the reader on its own default.
   */
  usageCacheRoot: string | null;
  /**
   * Whether the broker owns a fleet board card: one thread in the configured channel carrying every
   * open plan under the configured project roots. Off by default, and off is the absence of the
   * machinery rather than a check inside it: no thread is created, no refresh timer runs, and no plan
   * doc or event stream is ever opened.
   */
  boardCard: boolean;
  /**
   * The project roots the board card sweeps. The card draws them newest touch first rather than in
   * this order, and this order is what settles every project the touch order leaves unsettled: two
   * roots whose newest plan moved at the same instant, two with no plan the card can date at all,
   * and where a root that is not on this list sits among the ones that are. Configuration and never
   * derived: the card reads `docs/plans` directly under each of these and nothing else, and the
   * folder view never uses a value out of any file it reads as a path. The roster join is the one
   * view that does, under the rule `boardRosterPath` below states. Empty roots leave the folder
   * view off; the card still builds when the roster path names a fleet roster, since either source
   * alone is enough.
   */
  boardProjects: readonly string[];
  /** How often the fleet is re-swept and re-rendered. An edit is spent only when it changed. */
  boardCardRefreshMs: number;
  /** The kit's goal event stream, resolved from `CHANNEL_BOARD_EVENTS_PATH` or from the home
   * directory, and absolute either way. One stream, two readers: the board card's per-plan fold and
   * the session surface's blocked fold both read this path, so redirecting the knob redirects the
   * whole stream rather than splitting the two folds onto two files. Absent on disk is the ordinary
   * case, not an error: the card then draws no blocked markers and no session stands blocked. */
  boardEventsPath: string;
  /**
   * Absolute path to the fleet roster: an operator-maintained JSON file naming the personas the
   * board card draws a queue group for. Empty, the default, means no roster is configured. The
   * roster's own `workdir` field is trusted the way a configured project root is, because the
   * operator writes the file and its location comes from this same setting. A persona's own store,
   * by contrast, contributes a validated file name and never a path: `workdir` is the only path
   * input this reads out of the roster or a persona's files that is ever trusted as configuration.
   */
  boardRosterPath: string;
  /**
   * Absolute path to the machine's direction ledger, the operator's standing word that the web
   * surface's heading card draws. Empty, the default, means none is configured: the machine ledger
   * is not read and the heading card is not drawn. The file need not exist yet.
   */
  directionLedgerPath: string;
  /**
   * The file the Jev key is read from, or null when none is named. The response gate and the
   * voice's ranking share it; null with the gate on refuses the start, and with the voice alone it
   * leaves every spoken turn to the persona's session. The key itself is never a setting: a
   * scheduled task's environment is readable by anything that can read the task definition, and a
   * file can be locked to one account. `CHANNEL_JEV_KEY_FILE` names it; the earlier name
   * `CHANNEL_INBOX_JUDGE_KEY_FILE` names the same file where the new one is unset.
   */
  jevKeyFile: string | null;
  /**
   * Whether the old name `CHANNEL_INBOX_JUDGE_KEY_FILE` is set to anything, whether or not the new
   * name overrides it. The broker warns once at startup so the operator moves the line.
   */
  jevKeyFileOldName: boolean;
  /**
   * Whether the broker keeps the fleet decisions card: one line per open ask across the roster
   * personas' ask ledgers, with each ask's question posted into the card's thread. Off by default,
   * and off is the absence of the machinery rather than a check inside it: no ledger is read, no
   * sighting is kept and no thread is opened. The card also needs `CHANNEL_BOARD_ROSTER`, since the
   * roster names the ledgers it reads; on without a roster builds nothing, with one warning.
   */
  decisionsCard: boolean;
  /** How often the decisions card re-reads the ledgers and is re-rendered. An edit is spent only
   * when it changed. */
  decisionsCardRefreshMs: number;
  /**
   * Whether a thread's messages are held and delivered to its session together. `off` delivers
   * each admitted message at once, which is how a host with one account runs. `shadow`
   * delivers at once as well. `live` holds each thread's messages until one mentions the bot,
   * replies to one of its messages, or the buffer reaches a cap below.
   */
  responseGate: "off" | "shadow" | "live";
  /** A held buffer delivers on reaching this many messages. */
  responseGateMaxMessages: number;
  /** A held buffer delivers once its oldest message is this old, whether or not another arrives. */
  responseGateMaxWaitMs: number;
  /**
   * How long a thread must be quiet since its last message before a held buffer is put to the
   * judge. A new message restarts it, so a person typing several lines is not cut mid-thought.
   */
  responseGateQuietMs: number;
  /**
   * The judge's probability at or above which a held buffer delivers, from 0.4 to 0.95. Chosen
   * from a week of labelled shadow rows through `tools/response-gate-score.ts`.
   */
  responseGateThreshold: number;
  /**
   * Who may attach a file to a message in a session's thread. `off` refuses every attachment,
   * `operator` admits the operator's alone, and `all` admits every allowed account's. The default
   * is the operator alone, and `all` is how the bar is lowered later with no code change.
   */
  attachments: "off" | "operator" | "all";
  /** The most bytes one attachment may stream before it is refused. Never the size Discord declared. */
  attachmentMaxBytes: number;
  /** A saved attachment older than this many days, by its modified time, is deleted by the daily pass. */
  attachmentRetainDays: number;
  /**
   * Whether the broker can join a voice channel on an operator's `voice on`. Off by default, and off
   * is the absence of the machinery: no voice module is loaded and no voice intent is requested.
   */
  voice: boolean;
  /** The bot leaves its voice channel once no operator's audio has arrived for this long. */
  voiceIdleMs: number;
  /**
   * A development knob: with the bot joined, each operator's own audio is played back to the
   * channel two seconds later, which proves the receive and play paths on a real channel.
   */
  voiceLoopback: boolean;
  /**
   * The file the transcription key is read from, or null when none is named. The same Deepgram key
   * also speaks. The key itself is never a setting, for the reason the Jev key's is not. Null with
   * the voice on leaves the channel deaf and mute: the bot joins, no audio goes to Deepgram, and
   * nothing is spoken.
   */
  voiceSttKeyFile: string | null;
  /** Flux's end-of-turn threshold, from 0.5 to 0.9. */
  voiceEotThreshold: number;
  /**
   * Flux's eager end-of-turn threshold, from 0.3 to 0.9, sent only with `voiceEager` on. With it on,
   * a value above `voiceEotThreshold` is refused, since Flux refuses that pair.
   */
  voiceEagerThreshold: number;
  /** Whether Flux's eager end of turn ends a turn early, withdrawn again if the speaker carries on. */
  voiceEager: boolean;
  /** A turn that interrupts the persona with fewer words than this lets it carry on, from 1 to 10. */
  voiceShortTurnWords: number;
  /** The Deepgram Flux voice the persona speaks in, a name starting with `flux-`. */
  speechVoice: string;
  /**
   * How long the speech socket may take to connect, to answer a turn with its first audio, to go
   * quiet between two frames, and to end the turn after its last frame, before the answer is posted
   * to the thread instead, from one to thirty seconds.
   */
  speechTimeoutMs: number;
  /** A turn whose need for the session scores at or above this hands off, from 0.3 to 0.9. */
  voiceHandoffThreshold: number;
  /** Otherwise, a turn whose answerability scores at or above this is answered, from 0.3 to 0.9. */
  voiceAnswerThreshold: number;
  /**
   * The file the fast tier's Anthropic key is read from, or null when none is named. The key itself
   * is never a setting. Null with the voice on hands every turn to the session.
   */
  voiceFastKeyFile: string | null;
  /** The Claude model the fast tier answers with. */
  voiceFastModel: string;
  /** How many spoken lines the fast tier remembers, from 2 to 64. */
  voiceMemoryTurns: number;
  /**
   * How many words of a session's reply are spoken before the rest is left to the thread, from
   * 20 to 600. The whole reply reaches the thread whatever this is.
   */
  voiceMaxSpokenWords: number;
  /**
   * How long an operator's answer to a spoken question is held after an eager end of its turn, in
   * case the operator carries on, before it is handed to the session, from 500 to 5000 ms. A final
   * end hands it off at once.
   */
  voiceEagerSettleMs: number;
  /**
   * Whether a turn's end is held so a thought gathered across a pause reaches the voice as one
   * turn. `off` wires the transcriber bare. `plain` holds every end with words for
   * `voiceTurnHoldMs`, and a turn the operator starts inside the wait joins it. `judged` asks Jev
   * whether the words are a finished thought and releases at once at or above
   * `voiceCompleteThreshold`, waiting out the hold otherwise.
   */
  voiceTurnHold: "off" | "plain" | "judged";
  /** How long a held end waits before it is released, from 500 to 5000 ms. */
  voiceTurnHoldMs: number;
  /** The finished-thought probability at or above which a judged hold releases at once, from 0.3 to 0.9. */
  voiceCompleteThreshold: number;
  /**
   * How long after a hand-off the thinking line waits for the session's reply before it is spoken,
   * from 0 to 10000 ms. Zero speaks it at the hand-off.
   */
  voiceHoldFirstMs: number;
  /**
   * How long after a hand-off the still-looking line waits for the reply, from 1000 to 30000 ms,
   * and greater than `voiceHoldFirstMs`.
   */
  voiceHoldSecondMs: number;
  /**
   * The address the web surface's own listener binds, or null when `CHANNEL_WEB_BIND` is unset,
   * which leaves the surface off: no second server is created and the broker is its loopback
   * listener alone. Read here as written, an IPv4 literal or the word `tailscale`; the tailnet
   * range check and the literal's resolution are `loadWebConfig`'s in broker/web/config.ts, which
   * takes these seven values rather than the environment.
   */
  webBind: string | null;
  /** The web surface's port. */
  webPort: number;
  /** The tailnet logins the web surface admits, split on commas and trimmed, possibly empty here. */
  webOperators: readonly string[];
  /**
   * The tailnet node names the web surface admits, or null when `CHANNEL_WEB_DEVICES` is unset or
   * empty, which leaves the node unchecked.
   */
  webDevices: readonly string[] | null;
  /**
   * The tailnet node names the web surface admits to `GET /web/summary` alone, the sibling
   * sandboxes' nodes, as `CHANNEL_WEB_SUMMARY_PEERS` names them, split on commas and trimmed; empty
   * when unset. A node here is refused every page and every other route unless it is also on
   * `webDevices`. With `webDevices` null the node is not checked, so the list adds nothing.
   */
  webSummaryPeers: readonly string[];
  /** The Tailscale CLI the web surface resolves peers with: a path, or a name found on PATH. */
  webTailscale: string;
  /** Absolute path to the directory the web surface's pages are served from. */
  webStaticRoot: string;
  /**
   * The sibling sandboxes the web surface polls for its rail, as the `Name=address:port` entries
   * of `CHANNEL_WEB_SIBLINGS`, split on commas and trimmed; empty when unset. Each entry's shape
   * is `loadWebConfig`'s to check, since the list means nothing while `CHANNEL_WEB_BIND` is unset.
   */
  webSiblings: readonly string[];
};

/**
 * Exported because it is a shared literal, not a private default: hooks/settings-fragment.json
 * hardcodes this port into every http hook URL and hooks/session-start.ps1 falls back to it, and a
 * hook pointed at a port nothing listens on fails silently. settings-fragment.test.ts pins the
 * fragment against this value so the three cannot drift apart.
 */
export const DEFAULT_PORT = 8787;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 15 * 1000;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
// 256KB. The measured ceiling it must clear is a real turn's final reply, observed whole at ~35K
// characters; the headroom above that is for a reply several times longer, not for arbitrary data.
const DEFAULT_MIRROR_MAX_BYTES = 256 * 1024;
// The floor is the operational hazard: the mirror route answers 202 whether or not the body fit,
// so a ceiling small enough to drop every post is indistinguishable from nobody typing. 64KB keeps
// every ordinarily-sized turn deliverable; the 4MB ceiling bounds what one post can make the
// broker buffer.
const MIN_MIRROR_MAX_BYTES = 64 * 1024;
const MAX_MIRROR_MAX_BYTES = 4 * 1024 * 1024;
// The latency bar for mid-turn narration is tens of seconds: it exists so a long turn is not
// silence, not so the thread streams. Each pass costs a stat and a bounded read per live session.
const DEFAULT_INTERIM_POLL_MS = 20 * 1000;
// The floor keeps a typo like "100" from turning the poll into a near-busy loop over every live
// session's transcript. The ceiling exists because Node clamps a setInterval delay past 2^31-1
// down to 1ms, which would turn an over-large value into exactly that busy loop; five minutes is
// where narration stops answering anything an operator is still asking, and past it
// CHANNEL_INTERIM_MIRROR=off is the honest spelling.
const MIN_INTERIM_POLL_MS = 1_000;
const MAX_INTERIM_POLL_MS = 5 * 60 * 1000;

/**
 * Four hours. Exported because it is a shared contract, not a private default: the installed
 * fragment's PreToolUse `timeout` must exceed every legal hold so the release is always the
 * broker's clean `{}` rather than a CLI-side timeout error, and settings-fragment.test.ts pins the
 * fragment against this value so the two cannot drift apart.
 */
export const DEFAULT_QUESTION_HOLD_MS = 4 * 60 * 60 * 1000;
// A near-zero hold is today's behavior with extra steps; below a second the release would race the
// alert that makes the hold worth keeping.
const MIN_QUESTION_HOLD_MS = 1_000;
// The ceiling is the default on purpose: the fragment pin only holds the default under the
// installed PreToolUse timeout, so an env override may shorten the hold but never push it past the
// margin the pin guarantees. Raising this ceiling means raising the fragment timeout with it.
const MAX_QUESTION_HOLD_MS = DEFAULT_QUESTION_HOLD_MS;

/**
 * How long the relay waits on a silent stream before it presumes the pipe is dead and reconnects.
 *
 * Exported because it lives in the other process: relay/broker.ts is the only reader, and the two
 * cannot see each other's configuration. The heartbeat below is clamped against it here, because a
 * heartbeat slower than this timeout means every quiet relay drops and reconnects forever, and
 * nothing at runtime would report that as anything but a working session.
 */
export const RELAY_READ_TIMEOUT_MS = 60 * 1000;

/**
 * The ceiling on the relay's reconnect delay, which doubles from a second on each failed attempt.
 *
 * Exported because two processes derive from it: relay/broker.ts caps its backoff with it, and the
 * broker's restart window below is sized from it. After a broker outage a healthy relay's next
 * attempt can land up to this long after the broker is answering again.
 */
export const RELAY_MAX_RECONNECT_DELAY_MS = 30 * 1000;

/**
 * How long a session that held a relay before a broker restart is given to reconnect before it is
 * called dead. No pipe survives the broker process, so at startup every such session's pipe is
 * closed, and the window opens when the listener binds.
 *
 * Three reconnect ceilings, which spans two full retry cycles of a relay whose backoff doubled to
 * its ceiling while the broker was down, with margin. A constant rather than an environment
 * setting: a window shorter than the ceiling ends living sessions, and `ended` is terminal.
 */
export const RELAY_RESTART_GRACE_MS = 3 * RELAY_MAX_RECONNECT_DELAY_MS;

/**
 * How long the relay waits with no byte at all on a reply's response before it presumes the broker
 * has stopped answering and reports the reply as failed.
 *
 * Exported for the reason the read timeout above is: the value is read in relay/broker.ts, in the
 * other process, and the two cannot see each other's constants.
 *
 * It measures silence rather than elapsed time, which is what makes one number cover every reply.
 * A reply waits on its thread's ordering chain and nothing bounds what is queued ahead of it, so no
 * arithmetic over one run's own cost can bound the wait; what can be bounded is how long the broker
 * may go without saying anything, and the reply route writes a heartbeat while a run is in flight
 * precisely so this timer measures the broker's liveness.
 */
export const RELAY_REPLY_IDLE_MS = 30 * 1000;

/**
 * How often the reply route writes a heartbeat byte into a response whose run is still going.
 *
 * Derived rather than chosen, because the two numbers live in different processes and nothing at
 * runtime would report them as crossed: a heartbeat slower than the relay's idle window means every
 * reply that outlasts one window is reported failed while its messages are still going up, and what
 * a model does with a bare failure is send the answer again over the top of what landed. A third of
 * the window leaves room for one heartbeat lost to scheduling before the reply pays for it.
 */
export const REPLY_HEARTBEAT_MS = Math.floor(RELAY_REPLY_IDLE_MS / 3);

/** Room for two missed heartbeats inside the relay's read timeout before it gives up on the pipe. */
const MAX_RELAY_HEARTBEAT_MS = Math.floor(RELAY_READ_TIMEOUT_MS / 3);
const MIN_RELAY_HEARTBEAT_MS = 1_000;
const DEFAULT_RELAY_HEARTBEAT_MS = 15 * 1000;
// A minute between reads of two small local files, which is the cadence the card's own contents
// move at: claude-swap polls on its own schedule and a session's age line is drawn in minutes.
const DEFAULT_USAGE_CARD_REFRESH_MS = 60 * 1000;
// The floor keeps a typo from turning the refresh into a stream of Discord edits on a fleet that is
// changing every few seconds. The ceiling is the point past which the card stops being a live
// surface, and it also holds the value inside what setInterval accepts, since Node clamps a delay
// past 2^31-1 down to 1ms, which would turn an over-large value into a busy loop.
const MIN_USAGE_CARD_REFRESH_MS = 5 * 1000;
const MAX_USAGE_CARD_REFRESH_MS = 60 * 60 * 1000;
// A minute, which is the resolution every age the board card draws is rounded to: a faster refresh
// buys nothing the operator can see. Its bounds are the fleet card's, and for the same two reasons:
// the floor keeps a typo from turning the refresh into a stream of Discord edits, and the ceiling
// both holds the card a live surface and keeps the value inside what setInterval accepts, since Node
// clamps a delay past 2^31-1 down to 1ms.
const DEFAULT_BOARD_CARD_REFRESH_MS = 60 * 1000;
const MIN_BOARD_CARD_REFRESH_MS = 5 * 1000;
const MAX_BOARD_CARD_REFRESH_MS = 60 * 60 * 1000;
// The decisions card draws ages in minutes as the board card does, so its refresh takes the board
// card's default and bounds, for the board card's reasons.
const DEFAULT_DECISIONS_CARD_REFRESH_MS = DEFAULT_BOARD_CARD_REFRESH_MS;
const MIN_DECISIONS_CARD_REFRESH_MS = MIN_BOARD_CARD_REFRESH_MS;
const MAX_DECISIONS_CARD_REFRESH_MS = MAX_BOARD_CARD_REFRESH_MS;
// The gate threshold's bounds: the floor keeps a typo from delivering on most verdicts, and the
// ceiling keeps one from delivering on almost none while still reading as on.
const MIN_RESPONSE_GATE_THRESHOLD = 0.4;
const MAX_RESPONSE_GATE_THRESHOLD = 0.95;
// The size cap defaults to the inbound rate ceiling, as many messages as one session may be handed
// in a minute. It counts messages and has no upper bound; what bounds a delivery's size at any
// value is the gate's event budget, which delivers a buffer early rather than grow it past what
// the relay's stream carries. The age cap is how late a held ask can be: ten minutes is a long
// pause in a working conversation and a short wait for someone who stepped away. Both are
// starting values rather than measured ones.
const DEFAULT_RESPONSE_GATE_MAX_MESSAGES = 20;
const DEFAULT_RESPONSE_GATE_MAX_WAIT_MS = 10 * 60 * 1000;
// The age cap is a setTimeout delay, and Node clamps a delay past 2^31-1 down to 1ms, which would
// deliver every buffer the moment it opened. The ceiling is that limit, about 24.8 days.
const MAX_RESPONSE_GATE_MAX_WAIT_MS = 2_147_483_647;
// The quiet window is a typing pause: five seconds is long enough that a second line of the same
// thought lands inside it and short enough that an ask is not held for its own sake. It is a
// setTimeout delay too, so it takes the age cap's ceiling. The quiet window is a starting value
// rather than a measured one. The threshold takes the bounds stated above, and its default is the
// value measured for the gate's question in
// `docs/archive/plans/channels_gate-question-retune_spec_v1.md`.
const DEFAULT_RESPONSE_GATE_QUIET_MS = 5 * 1000;
const DEFAULT_RESPONSE_GATE_THRESHOLD = 0.65;
// One list, one entry per project root. A semicolon rather than a colon or a comma because a Windows
// path carries a drive letter and a colon with it, and a comma is a legal character in a directory
// name.
const PROJECT_SEPARATOR = ";";
// Twenty megabytes a file, Discord's own default limit per uploaded file: room for a short screen
// recording, and a bound on what one message can make the broker hold, since each file is read
// whole into memory under the cap before it is written. A floor and no ceiling, as the hook body cap
// has: the files reach a session the operator steers, and a host whose server's boost tier takes
// larger ones says so.
const DEFAULT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
// Two weeks: long enough that a session resumed after a weekend still finds what it was told to
// open, short enough that the store does not become an archive of every file ever attached.
const DEFAULT_ATTACHMENT_RETAIN_DAYS = 14;
// Ten minutes of no operator audio ends a voice session, so an empty room is not held open. The
// floor keeps a typo from dropping the bot mid-pause, and the two-hour ceiling keeps a forgotten
// session from holding the channel for a day.
const DEFAULT_VOICE_IDLE_MS = 10 * 60 * 1000;
const MIN_VOICE_IDLE_MS = 30 * 1000;
const MAX_VOICE_IDLE_MS = 2 * 60 * 60 * 1000;
// Flux's own default and its accepted ranges: Deepgram takes an end-of-turn threshold from 0.5 and
// an eager one from 0.3, so a value below either floor would pass here and fail at the socket. The
// 0.9 ceilings keep a typo from waiting out nearly every turn on the end-of-turn timeout. Flux also
// refuses an eager threshold above the end-of-turn threshold, so with eager on `loadConfig` refuses
// that pair; with eager off the eager threshold is never sent and the pair is not checked. Source:
// https://developers.deepgram.com/docs/flux/configuration
const DEFAULT_VOICE_EOT_THRESHOLD = 0.7;
const MIN_VOICE_EOT_THRESHOLD = 0.5;
const MAX_VOICE_EOT_THRESHOLD = 0.9;
const DEFAULT_VOICE_EAGER_THRESHOLD = 0.5;
const MIN_VOICE_EAGER_THRESHOLD = 0.3;
const MAX_VOICE_EAGER_THRESHOLD = 0.9;
// Two words: a cough or a "mm-hm" lets the persona carry on, and "wait, stop" does not. The ceiling
// keeps a typo from letting a whole sentence talk under the persona without stopping it.
const DEFAULT_VOICE_SHORT_TURN_WORDS = 2;
const MIN_VOICE_SHORT_TURN_WORDS = 1;
const MAX_VOICE_SHORT_TURN_WORDS = 10;
// Deepgram's Flux voice Cole. The voice name rides the speech socket's URL as its model, so it is
// held to a plain lowercase slug, and `/v2/speak` serves Flux voices alone, so it must start with
// `flux-`: a wrong voice refuses the start naming the rule rather than failing every reply.
const DEFAULT_SPEECH_VOICE = "flux-cole-en";
const SPEECH_VOICE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SPEECH_VOICE_PREFIX = "flux-";
// Eight seconds of silence from Deepgram, and the answer is posted to the thread instead. The floor
// keeps a typo from failing every reply, and the thirty-second ceiling keeps a stalled socket from
// holding a reply for minutes.
const DEFAULT_SPEECH_TIMEOUT_MS = 8 * 1000;
const MIN_SPEECH_TIMEOUT_MS = 1000;
const MAX_SPEECH_TIMEOUT_MS = 30 * 1000;
// The fast tier's two thresholds over Jev's answers. A turn whose need for the session scores at or
// above the hand-off threshold goes to the session; otherwise one whose answerability scores at or
// above the answer threshold is answered by the small model, and anything else goes to the session.
// Both are starting values rather than measured ones. The ranges keep a typo from handing off every
// turn or answering nearly every one.
const DEFAULT_VOICE_HANDOFF_THRESHOLD = 0.6;
const DEFAULT_VOICE_ANSWER_THRESHOLD = 0.7;
const MIN_VOICE_RANK_THRESHOLD = 0.3;
const MAX_VOICE_RANK_THRESHOLD = 0.9;
// The small model that answers a spoken turn. Haiku by default for its speed; `claude-sonnet-5-5`
// is the documented alternative. A model name rides the request body, so it is held to the shape
// of a Claude model id.
const DEFAULT_VOICE_FAST_MODEL = "claude-haiku-4-5-20251001";
const VOICE_FAST_MODEL = /^claude-[a-z0-9.-]{1,64}$/;
// Sixteen spoken lines, eight exchanges, is what the fast tier answers from and what a hand-off
// can carry. The floor keeps one exchange in memory, and the ceiling bounds what each model call
// sends.
const DEFAULT_VOICE_MEMORY_TURNS = 16;
const MIN_VOICE_MEMORY_TURNS = 2;
const MAX_VOICE_MEMORY_TURNS = 64;
// About a minute of speech. The floor keeps a spoken answer worth hearing, and the ceiling keeps a
// reply from holding the channel for many minutes when the thread has it whole anyway.
const DEFAULT_VOICE_MAX_SPOKEN_WORDS = 120;
const MIN_VOICE_MAX_SPOKEN_WORDS = 20;
const MAX_VOICE_MAX_SPOKEN_WORDS = 600;
// A second and a half after an eager end before an answer to a spoken question goes to the session,
// so an answer the operator carries on with arrives whole. The floor keeps a typo from handing off
// before a resume can land, and the ceiling keeps an answer from waiting long after the operator
// has stopped.
const DEFAULT_VOICE_EAGER_SETTLE_MS = 1500;
const MIN_VOICE_EAGER_SETTLE_MS = 500;
const MAX_VOICE_EAGER_SETTLE_MS = 5000;
// Two seconds after a spoken turn's end before the held words go on, so a thought that carries on
// inside the wait joins them. The floor keeps a hold worth having, and the ceiling keeps a finished
// turn from waiting long after the operator has stopped. The threshold is the finished-thought
// probability at or above which a judged hold releases at once, with its own bounds so a change
// to the ranking's bounds leaves the hold's where they are.
const DEFAULT_VOICE_TURN_HOLD_MS = 2000;
const MIN_VOICE_TURN_HOLD_MS = 500;
const MAX_VOICE_TURN_HOLD_MS = 5000;
const DEFAULT_VOICE_COMPLETE_THRESHOLD = 0.8;
const MIN_VOICE_COMPLETE_THRESHOLD = 0.3;
const MAX_VOICE_COMPLETE_THRESHOLD = 0.9;
// Two and a half seconds of silence after a hand-off before the thinking line, so a quick reply is
// heard with no holding line at all, and nine before the still-looking line, so a slow one is not
// met with silence. Zero speaks the thinking line at the hand-off. The ceilings keep a long wait
// from reading as a dropped turn.
const DEFAULT_VOICE_HOLD_FIRST_MS = 2500;
const MIN_VOICE_HOLD_FIRST_MS = 0;
const MAX_VOICE_HOLD_FIRST_MS = 10000;
const DEFAULT_VOICE_HOLD_SECOND_MS = 9000;
const MIN_VOICE_HOLD_SECOND_MS = 1000;
const MAX_VOICE_HOLD_SECOND_MS = 30000;
const DEFAULT_RETAIN_TERMINAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 500;
const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_LOG_MAX_FILES = 5;
// One above the loopback port, so a host reading its own process list tells the two apart at a
// glance. A bare `tailscale` is found on PATH, which is where the installer puts the CLI.
const DEFAULT_WEB_PORT = 8788;
/**
 * How often the web surface tries its bind again while its address is not available yet, as at
 * boot before Tailscale is up. Thirty seconds because it is the relay reconnect ceiling,
 * `RELAY_MAX_RECONNECT_DELAY_MS`, so a session's pipe and the surface come up on the same clock.
 */
export const WEB_BIND_RETRY_MS = RELAY_MAX_RECONNECT_DELAY_MS;
const DEFAULT_WEB_TAILSCALE = "tailscale";
const WEB_LIST_SEPARATOR = ",";

function integerAtLeast(raw: string | undefined, minimum: number, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`expected an integer of at least ${minimum}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Refuses rather than clamps, the same way `integerAtLeast` does. A knob silently moved to a value
 * the operator did not ask for is a knob whose behavior nobody can reason about later.
 */
function bounded(
  raw: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `expected an integer between ${minimum} and ${maximum}, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

/** `bounded` for a knob that is a fraction rather than a count: any finite number in the range. */
function boundedFraction(
  raw: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`expected a number between ${minimum} and ${maximum}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

const FLAG_TRUE: readonly string[] = ["1", "true", "yes", "on"];
/**
 * Exported because broker/intake.ts's per-request `X-Channel-Mirror` header reads the same off
 * vocabulary this config knob does. A second literal would let the two drift: a header spelling
 * accepted here but not there would flip a session's mirror state depending on which of the two
 * paths reads it.
 */
export const FLAG_FALSE: readonly string[] = ["0", "false", "no", "off"];

/**
 * Refuses rather than guesses, holding the same line the numeric knobs hold: a boolean knob read
 * permissively turns a typo like `CHANNEL_MIRROR=fasle` into whichever default the parser leans
 * toward, and a knob silently moved is a knob whose behavior nobody can reason about later.
 *
 * Exported for the same reason `FLAG_FALSE` is: broker/discord/config.ts's own knobs read this one
 * vocabulary rather than a second literal. Two parsers that admit different spellings mean a host
 * writing `on` for one knob gets true and for another gets a silent false, which is a
 * configuration the operator cannot reason about from the file they wrote.
 */
export function strictFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (FLAG_TRUE.includes(value)) return true;
  if (FLAG_FALSE.includes(value)) return false;
  throw new Error(
    `expected one of ${[...FLAG_TRUE, ...FLAG_FALSE].join(", ")}, got ${JSON.stringify(raw)}`,
  );
}

/**
 * One knob whose value is a fixed vocabulary rather than a flag, read the way `strictFlag` reads a
 * boolean one: trimmed, case folded, blank taken as absent, and a value outside the vocabulary
 * refused rather than guessed at. A typo read permissively lands on whichever mode the parser leans
 * toward, and a knob silently moved is a knob whose behavior nobody can reason about later.
 *
 * One implementation for every enum knob here, on the reasoning `strictFlag`'s own comment gives
 * for being shared: two parsers are two admission rules, and a host writing a spelling one accepts
 * and the other refuses gets a configuration it cannot reason about from the file it wrote. The
 * refusal names the vocabulary in the order its caller declared it, so each knob's message reads in
 * its own terms.
 */
function strictEnum<T extends string>(raw: string | undefined, modes: readonly T[], fallback: T): T {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  const mode = modes.find((candidate) => candidate === value);
  if (mode !== undefined) return mode;
  throw new Error(`expected one of ${modes.join(", ")}, got ${JSON.stringify(raw)}`);
}

const TASK_NOTIFICATION_MODES: ReadonlyArray<"brief" | "full" | "off"> = ["brief", "full", "off"];

/**
 * How a background task's wake prompt is drawn, defaulting to the compression: a typo like
 * `CHANNEL_TASK_NOTIFICATION=freif` is refused by the reading above rather than landing silently on
 * whichever mode it resembles.
 */
function taskNotificationMode(raw: string | undefined): "brief" | "full" | "off" {
  return strictEnum(raw, TASK_NOTIFICATION_MODES, "brief");
}

const PEER_MESSAGE_MODES: ReadonlyArray<"full" | "brief" | "off"> = ["full", "brief", "off"];

/**
 * How much of a peer message is drawn, defaulting to the whole of it: a typo like
 * `CHANNEL_PEER_MESSAGES=fully` is refused by the reading above rather than quietly halving what an
 * operator watches an exchange through. The modes are declared loudest first, which is this knob's
 * default and the one difference from the wake-up notice's vocabulary.
 */
function peerMessageMode(raw: string | undefined): "full" | "brief" | "off" {
  return strictEnum(raw, PEER_MESSAGE_MODES, "full");
}

const RESPONSE_GATE_MODES: ReadonlyArray<"off" | "shadow" | "live"> = ["off", "shadow", "live"];

/**
 * Whether the response gate holds messages, defaulting to off: a typo like
 * `CHANNEL_RESPONSE_GATE=lvie` is refused by the reading above rather than landing on a mode that
 * either holds a session's messages back or delivers every one of them, silently, whichever the
 * parser leaned toward.
 */
function responseGateMode(raw: string | undefined): "off" | "shadow" | "live" {
  return strictEnum(raw, RESPONSE_GATE_MODES, "off");
}

const VOICE_TURN_HOLD_MODES: ReadonlyArray<"off" | "plain" | "judged"> = ["off", "plain", "judged"];

/**
 * Whether a spoken turn's end is held, defaulting to the plain hold, which waits out the setting
 * with no Jev call: a typo like `CHANNEL_VOICE_TURN_HOLD=judge` is refused by the reading above
 * rather than landing on a mode that either answers every fragment at once or spends a Jev call
 * on every turn, silently, whichever the parser leaned toward.
 */
function voiceTurnHoldMode(raw: string | undefined): "off" | "plain" | "judged" {
  return strictEnum(raw, VOICE_TURN_HOLD_MODES, "plain");
}

const ATTACHMENT_MODES: ReadonlyArray<"off" | "operator" | "all"> = ["off", "operator", "all"];

/**
 * Who may attach a file, defaulting to the operator alone: a typo like `CHANNEL_ATTACHMENTS=al`
 * is refused by the reading above rather than landing on a mode that either opens the store to
 * every account or closes it to the operator, silently, whichever the parser leaned toward.
 */
function attachmentMode(raw: string | undefined): "off" | "operator" | "all" {
  return strictEnum(raw, ATTACHMENT_MODES, "operator");
}

// A Windows path names the same place from every process only when it leads with a drive letter or a
// UNC root. `path.isAbsolute` takes a leading separator as well, and `\one` resolves against
// whichever drive the broker was launched from, which under a scheduled task is no drive the
// operator chose.
const WINDOWS_ROOT = /^(?:[A-Za-z]:[\\/]|[\\/][\\/])/;

/** True only for a value that names one file or directory whatever the process's launch state was. */
export function namesOneDirectory(root: string): boolean {
  if (!path.isAbsolute(root)) return false;
  return process.platform === "win32" ? WINDOWS_ROOT.test(root) : true;
}

/**
 * A share root: two leading path separators of either spelling, in any combination.
 *
 * The separator class rather than the two homogeneous spellings is the whole point. Windows treats
 * any two leading separator characters as the UNC prefix, so `\\host\share`, `//host/share`,
 * `/\host\share` and `\/host/share` all resolve to the same share and all open the same outbound
 * connection. A pattern naming only the two obvious spellings admits the two mixed ones, which is a
 * refusal that passes its own tests and fails on the input it exists for. `WINDOWS_ROOT` above
 * detects the same prefix the same way, in its second alternative.
 *
 * Exported because a path this broker will open can arrive from more than one source, and each
 * source that re-derives this check by hand re-derives it slightly differently.
 */
export const UNC_ROOT = /^[\\/][\\/]/;

/**
 * `namesOneDirectory` narrowed to a local drive, refusing the UNC root that function accepts by
 * design. That acceptance exists for a value out of the broker's own environment, an
 * access-controlled surface the operator alone can write. A roster `workdir` sits in a lower trust
 * class: the roster is an ordinary JSON file any process running as the operator can rewrite, and
 * the broker's scheduled task runs as the operator's own identity. A UNC `workdir` the broker later
 * opens files under would send outbound SMB to whatever host that entry names, under the operator's
 * own credentials, so a value reaching this from the roster is held to the narrower rule.
 */
export function namesOneLocalDirectory(root: string): boolean {
  return namesOneDirectory(root) && !UNC_ROOT.test(root);
}

/**
 * The board card's project roots, in the order they were written.
 *
 * Refuses an entry that does not name one fixed directory rather than resolving one, holding the line
 * the flag and numeric knobs hold: such a root resolves against whatever directory or drive the
 * broker was launched from, which under a scheduled task is neither of the operator's choosing, and a
 * card silently sweeping the wrong tree is a card nobody can reason about from the file they wrote. A
 * blank entry is not an error, so a list written with a trailing separator means what it looks like.
 *
 * The refusal names the entry's position and never its text: a project root typically embeds the
 * operator's OS username, and this message reaches the log file.
 *
 * Two entries naming one directory collapse to the first spelling of it, compared in the form the
 * board card's event reader compares a root in: separators normalized, a trailing separator dropped,
 * and case folded on Windows. That is the same form on purpose. A duplicate surviving here is drawn
 * as a second project block whose rows never take a blocked marker, because the reader folds the two
 * spellings together and keys its events to the first.
 */
function projectRoots(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const seen = new Set<string>();
  const roots: string[] = [];
  const written = raw.split(PROJECT_SEPARATOR);
  for (const [index, entry] of written.entries()) {
    const root = entry.trim();
    if (root === "") continue;
    if (!namesOneDirectory(root)) {
      throw new Error(
        `expected absolute project roots separated by "${PROJECT_SEPARATOR}", ` +
          `entry ${String(index + 1)} of ${String(written.length)} names no fixed directory`,
      );
    }
    const key = comparablePath(root);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
  }
  return roots;
}

/**
 * The kit's goal event stream: the configured path, or the one under the home directory when nothing
 * names another.
 *
 * A configured path is held to the same rule a project root is, and for the same reason: a relative
 * or drive-relative path resolves against whatever directory or drive the broker was launched from,
 * which under a scheduled task is neither of the operator's choosing, and a card reading the wrong
 * file (or reading nothing and drawing no blocked markers at all) is a card nobody can reason about
 * from the value they wrote. The computed default is absolute already.
 *
 * The refusal never echoes the value: this path typically sits under the operator's own profile, and
 * this message reaches the log file.
 */
function eventsPath(env: NodeJS.ProcessEnv): string {
  const configured = env.CHANNEL_BOARD_EVENTS_PATH?.trim();
  if (configured === undefined || configured === "") return defaultEventsPath(env);
  if (!namesOneDirectory(configured)) {
    throw new Error("expected an absolute path, the value names no fixed file");
  }
  return configured;
}

/**
 * The fleet roster's path, or empty when none is configured.
 *
 * Unlike the events path above, an unconfigured roster has no fallback location: the roster's very
 * existence is the second way the board card turns itself on, so an operator who never set this gets
 * no persona reader rather than a guess at a file that may not exist.
 *
 * A configured value is held to the rule a project root and the events path both are: a relative or
 * drive-relative path resolves against whatever directory or drive the broker was launched from,
 * which under a scheduled task is neither of the operator's choosing.
 *
 * The refusal never echoes the value: a roster path typically embeds the operator's OS username, and
 * this message reaches the log file.
 */
function rosterPath(env: NodeJS.ProcessEnv): string {
  const configured = env.CHANNEL_BOARD_ROSTER?.trim();
  if (configured === undefined || configured === "") return "";
  if (!namesOneDirectory(configured)) {
    throw new Error("CHANNEL_BOARD_ROSTER expects an absolute path, the value names no fixed file");
  }
  return configured;
}

/**
 * The machine direction ledger's path, or empty when none is configured.
 *
 * Held to the rule the roster path is: a relative or drive-relative path resolves against whatever
 * directory or drive the broker was launched from, which under a scheduled task is neither of the
 * operator's choosing.
 *
 * The refusal never echoes the value: the path typically embeds the operator's OS username, and
 * this message reaches the log file.
 */
function directionLedgerPath(env: NodeJS.ProcessEnv): string {
  const configured = env.CHANNEL_DIRECTION_LEDGER?.trim();
  if (configured === undefined || configured === "") return "";
  if (!namesOneDirectory(configured)) {
    throw new Error("CHANNEL_DIRECTION_LEDGER expects an absolute path, the value names no fixed file");
  }
  return configured;
}

/** The Flux voice: a lowercase slug, since it rides the socket URL, starting with `flux-`. */
function speechVoice(raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === "") return DEFAULT_SPEECH_VOICE;
  if (!SPEECH_VOICE.test(value)) {
    throw new Error(
      `CHANNEL_SPEECH_VOICE expects a lowercase name of letters, digits and hyphens, got ${JSON.stringify(raw)}`,
    );
  }
  if (!value.startsWith(SPEECH_VOICE_PREFIX)) {
    throw new Error(
      `CHANNEL_SPEECH_VOICE expects a Deepgram Flux voice, a name starting with ${SPEECH_VOICE_PREFIX}, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

/** The fast tier's model name: the shape of a Claude model id. The refusal never echoes the value. */
function voiceFastModel(raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === "") return DEFAULT_VOICE_FAST_MODEL;
  if (!VOICE_FAST_MODEL.test(value)) {
    throw new Error(
      "CHANNEL_VOICE_FAST_MODEL expects a Claude model id: claude- followed by 1 to 64 lowercase " +
        "letters, digits, dots and hyphens",
    );
  }
  return value;
}

/**
 * The state file lives outside the repository by default: the broker is installed as a service
 * and its runtime state is not source.
 */
function defaultStateFile(env: NodeJS.ProcessEnv): string {
  const base = env.LOCALAPPDATA ?? os.homedir();
  return path.join(base, "sapplefeld-channels", "broker-state.json");
}

/**
 * A comma-separated list as the web surface's three allowlists and sibling list are written: each entry trimmed,
 * empty entries dropped, and null for an unset or empty value, which is how the device list says
 * "unchecked". Whether an empty operator list is an error is `loadWebConfig`'s call, since the
 * lists mean nothing while `CHANNEL_WEB_BIND` is unset.
 */
function webList(raw: string | undefined): readonly string[] | null {
  if (raw === undefined || raw.trim() === "") return null;
  return raw
    .split(WEB_LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * The web surface's pages, beside this module rather than under the working directory: under a
 * scheduled task the working directory is whatever the task was given, and a page served from the
 * wrong tree is a 404 for every route.
 */
function defaultWebStaticRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "web", "static");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const config: BrokerConfig = {
    // Zero is legal only here, where it means "any free port" and is what the tests bind. Every
    // other knob would be degenerate at zero: a zero sweep interval is a busy loop, a zero stale
    // timeout marks every session stale, and a zero body cap refuses every post.
    port: integerAtLeast(env.CHANNEL_BROKER_PORT, 0, DEFAULT_PORT),
    host: env.CHANNEL_HOST_NAME?.trim() || os.hostname(),
    stateFile: env.CHANNEL_BROKER_STATE?.trim() || defaultStateFile(env),
    staleAfterMs: integerAtLeast(env.CHANNEL_STALE_AFTER_MS, 1, DEFAULT_STALE_AFTER_MS),
    sweepIntervalMs: integerAtLeast(env.CHANNEL_SWEEP_INTERVAL_MS, 1, DEFAULT_SWEEP_INTERVAL_MS),
    maxBodyBytes: integerAtLeast(env.CHANNEL_MAX_BODY_BYTES, 1, DEFAULT_MAX_BODY_BYTES),
    relayHeartbeatMs: bounded(
      env.CHANNEL_RELAY_HEARTBEAT_MS,
      MIN_RELAY_HEARTBEAT_MS,
      MAX_RELAY_HEARTBEAT_MS,
      DEFAULT_RELAY_HEARTBEAT_MS,
    ),
    retainTerminalMs: integerAtLeast(env.CHANNEL_RETAIN_TERMINAL_MS, 1, DEFAULT_RETAIN_TERMINAL_MS),
    maxSessions: integerAtLeast(env.CHANNEL_MAX_SESSIONS, 1, DEFAULT_MAX_SESSIONS),
    // Unset by default: a broker run at a terminal (every test, every local debugging session)
    // keeps using the console output it always had. An installed service (S7) sets this to a path
    // outside the repository, the same way the state file above resolves outside it, because under
    // a scheduled task there is no console attached to catch what console.log and console.error
    // write.
    logFile: env.CHANNEL_BROKER_LOG_FILE?.trim() || null,
    logMaxBytes: integerAtLeast(env.CHANNEL_BROKER_LOG_MAX_BYTES, 1024, DEFAULT_LOG_MAX_BYTES),
    logMaxFiles: integerAtLeast(env.CHANNEL_BROKER_LOG_MAX_FILES, 1, DEFAULT_LOG_MAX_FILES),
    mirror: strictFlag(env.CHANNEL_MIRROR, true),
    mirrorMaxBytes: bounded(
      env.CHANNEL_MIRROR_MAX_BYTES,
      MIN_MIRROR_MAX_BYTES,
      MAX_MIRROR_MAX_BYTES,
      DEFAULT_MIRROR_MAX_BYTES,
    ),
    // On by default: the operator reported the mid-turn silence, and a feature that ships off
    // answers nothing. The host-wide CHANNEL_MIRROR gate is applied where the tailer is wired.
    interimMirror: strictFlag(env.CHANNEL_INTERIM_MIRROR, true),
    interimPollMs: bounded(
      env.CHANNEL_INTERIM_POLL_MS,
      MIN_INTERIM_POLL_MS,
      MAX_INTERIM_POLL_MS,
      DEFAULT_INTERIM_POLL_MS,
    ),
    questionHoldMs: bounded(
      env.CHANNEL_QUESTION_HOLD_MS,
      MIN_QUESTION_HOLD_MS,
      MAX_QUESTION_HOLD_MS,
      DEFAULT_QUESTION_HOLD_MS,
    ),
    // Brief by default: the console renders these wake-ups compactly, and a thread louder than
    // the terminal it mirrors is the reported failure. `full` is the escape hatch for an operator
    // who wants the whole report in the thread.
    taskNotifications: taskNotificationMode(env.CHANNEL_TASK_NOTIFICATION),
    // Full by default, where the wake-up notice above compresses: peer traffic is the whole content
    // of an exchange the operator is watching from the thread rather than a wake-up the console
    // already renders compactly, and half of a conversation answers nothing.
    peerMessages: peerMessageMode(env.CHANNEL_PEER_MESSAGES),
    modelChangeAlert: strictFlag(env.CHANNEL_MODEL_CHANGE_ALERT, false),
    // Off by default: the card reads another program's files and opens a thread of its own in the
    // operator's channel, and neither belongs on a host that never asked for it.
    usageCard: strictFlag(env.CHANNEL_USAGE_CARD, false),
    usageCardRefreshMs: bounded(
      env.CHANNEL_USAGE_CARD_REFRESH_MS,
      MIN_USAGE_CARD_REFRESH_MS,
      MAX_USAGE_CARD_REFRESH_MS,
      DEFAULT_USAGE_CARD_REFRESH_MS,
    ),
    usageCacheRoot: env.CHANNEL_USAGE_CACHE_ROOT?.trim() || null,
    // Off by default for the reason the fleet card is: the card reads the plan docs of every
    // configured project and opens a thread of its own in the operator's channel, and neither
    // belongs on a host that never asked for it.
    boardCard: strictFlag(env.CHANNEL_BOARD_CARD, false),
    boardProjects: projectRoots(env.CHANNEL_BOARD_PROJECTS),
    boardCardRefreshMs: bounded(
      env.CHANNEL_BOARD_CARD_REFRESH_MS,
      MIN_BOARD_CARD_REFRESH_MS,
      MAX_BOARD_CARD_REFRESH_MS,
      DEFAULT_BOARD_CARD_REFRESH_MS,
    ),
    // Read here rather than where the file is opened, so the installer's env allowlist pin, which
    // scans this file for the knobs it must carry, sees this one too.
    boardEventsPath: eventsPath(env),
    // Read here for the same reason: the roster is opened in broker/board/roster.ts, and the
    // allowlist pin only sees a knob this file names itself.
    boardRosterPath: rosterPath(env),
    // Read here for the same reason: the ledger is opened in broker/web/direction.ts.
    directionLedgerPath: directionLedgerPath(env),
    // The paths alone. The file is read where the gate or the voice is built, by `readJevKey`, so a
    // broker with both off never opens it. The new name wins where both are set.
    jevKeyFile: env.CHANNEL_JEV_KEY_FILE?.trim() || env.CHANNEL_INBOX_JUDGE_KEY_FILE?.trim() || null,
    jevKeyFileOldName: (env.CHANNEL_INBOX_JUDGE_KEY_FILE?.trim() ?? "") !== "",
    // Off by default: on, the card posts each worker's question into the channel, and that belongs
    // on a host that asked for it.
    decisionsCard: strictFlag(env.CHANNEL_DECISIONS_CARD, false),
    decisionsCardRefreshMs: bounded(
      env.CHANNEL_DECISIONS_CARD_REFRESH_MS,
      MIN_DECISIONS_CARD_REFRESH_MS,
      MAX_DECISIONS_CARD_REFRESH_MS,
      DEFAULT_DECISIONS_CARD_REFRESH_MS,
    ),
    // Off by default: on, the gate holds messages back from a running session, and that belongs
    // on a host that asked for it. The caps are read whatever the mode, so a host turning the gate
    // on later learns of a bad value at the restart that sets it rather than at the one that flips
    // the mode.
    responseGate: responseGateMode(env.CHANNEL_RESPONSE_GATE),
    responseGateMaxMessages: integerAtLeast(
      env.CHANNEL_RESPONSE_GATE_MAX_MESSAGES,
      1,
      DEFAULT_RESPONSE_GATE_MAX_MESSAGES,
    ),
    responseGateMaxWaitMs: bounded(
      env.CHANNEL_RESPONSE_GATE_MAX_WAIT_MS,
      1,
      MAX_RESPONSE_GATE_MAX_WAIT_MS,
      DEFAULT_RESPONSE_GATE_MAX_WAIT_MS,
    ),
    responseGateQuietMs: bounded(
      env.CHANNEL_RESPONSE_GATE_QUIET_MS,
      1,
      MAX_RESPONSE_GATE_MAX_WAIT_MS,
      DEFAULT_RESPONSE_GATE_QUIET_MS,
    ),
    responseGateThreshold: boundedFraction(
      env.CHANNEL_RESPONSE_GATE_THRESHOLD,
      MIN_RESPONSE_GATE_THRESHOLD,
      MAX_RESPONSE_GATE_THRESHOLD,
      DEFAULT_RESPONSE_GATE_THRESHOLD,
    ),
    // The operator alone by default, which is the bar the operator asked to start at and expects to
    // lower. The two numbers are read whatever the mode, so a host turning attachments on later
    // learns of a bad value at the restart that sets it rather than at the one that flips the mode.
    attachments: attachmentMode(env.CHANNEL_ATTACHMENTS),
    attachmentMaxBytes: integerAtLeast(env.CHANNEL_ATTACHMENT_MAX_BYTES, 1, DEFAULT_ATTACHMENT_MAX_BYTES),
    attachmentRetainDays: integerAtLeast(env.CHANNEL_ATTACHMENT_RETAIN_DAYS, 1, DEFAULT_ATTACHMENT_RETAIN_DAYS),
    // Off by default: on, the broker hears the operator's voice, and that belongs on a host that
    // asked for it. The idle window and the loopback are read whatever the flag, so a bad value
    // refuses the restart that writes it rather than the one that turns the voice on.
    voice: strictFlag(env.CHANNEL_VOICE, false),
    voiceIdleMs: bounded(env.CHANNEL_VOICE_IDLE_MS, MIN_VOICE_IDLE_MS, MAX_VOICE_IDLE_MS, DEFAULT_VOICE_IDLE_MS),
    voiceLoopback: strictFlag(env.CHANNEL_VOICE_LOOPBACK, false),
    // The path alone. The file is read where the voice is built, by `readVoiceSttKey`, so a broker
    // with the voice off never opens it.
    voiceSttKeyFile: env.CHANNEL_VOICE_STT_KEY_FILE?.trim() || null,
    voiceEotThreshold: boundedFraction(
      env.CHANNEL_VOICE_EOT_THRESHOLD,
      MIN_VOICE_EOT_THRESHOLD,
      MAX_VOICE_EOT_THRESHOLD,
      DEFAULT_VOICE_EOT_THRESHOLD,
    ),
    voiceEagerThreshold: boundedFraction(
      env.CHANNEL_VOICE_EAGER_THRESHOLD,
      MIN_VOICE_EAGER_THRESHOLD,
      MAX_VOICE_EAGER_THRESHOLD,
      DEFAULT_VOICE_EAGER_THRESHOLD,
    ),
    voiceEager: strictFlag(env.CHANNEL_VOICE_EAGER, false),
    voiceShortTurnWords: bounded(
      env.CHANNEL_VOICE_SHORT_TURN_WORDS,
      MIN_VOICE_SHORT_TURN_WORDS,
      MAX_VOICE_SHORT_TURN_WORDS,
      DEFAULT_VOICE_SHORT_TURN_WORDS,
    ),
    // Read whatever the flag, like the voice's other knobs, so a bad value refuses the restart that
    // writes it.
    speechVoice: speechVoice(env.CHANNEL_SPEECH_VOICE),
    speechTimeoutMs: bounded(
      env.CHANNEL_SPEECH_TIMEOUT_MS,
      MIN_SPEECH_TIMEOUT_MS,
      MAX_SPEECH_TIMEOUT_MS,
      DEFAULT_SPEECH_TIMEOUT_MS,
    ),
    // The fast tier's knobs, read whatever the flag for the same reason. The key file is the path
    // alone: the file is read where the voice is started, by `readVoiceFastKey`, so a broker with
    // the voice off never opens it.
    voiceHandoffThreshold: boundedFraction(
      env.CHANNEL_VOICE_HANDOFF_THRESHOLD,
      MIN_VOICE_RANK_THRESHOLD,
      MAX_VOICE_RANK_THRESHOLD,
      DEFAULT_VOICE_HANDOFF_THRESHOLD,
    ),
    voiceAnswerThreshold: boundedFraction(
      env.CHANNEL_VOICE_ANSWER_THRESHOLD,
      MIN_VOICE_RANK_THRESHOLD,
      MAX_VOICE_RANK_THRESHOLD,
      DEFAULT_VOICE_ANSWER_THRESHOLD,
    ),
    voiceFastKeyFile: env.CHANNEL_VOICE_FAST_KEY_FILE?.trim() || null,
    voiceFastModel: voiceFastModel(env.CHANNEL_VOICE_FAST_MODEL),
    voiceMemoryTurns: bounded(
      env.CHANNEL_VOICE_MEMORY_TURNS,
      MIN_VOICE_MEMORY_TURNS,
      MAX_VOICE_MEMORY_TURNS,
      DEFAULT_VOICE_MEMORY_TURNS,
    ),
    voiceMaxSpokenWords: bounded(
      env.CHANNEL_VOICE_MAX_SPOKEN_WORDS,
      MIN_VOICE_MAX_SPOKEN_WORDS,
      MAX_VOICE_MAX_SPOKEN_WORDS,
      DEFAULT_VOICE_MAX_SPOKEN_WORDS,
    ),
    voiceEagerSettleMs: bounded(
      env.CHANNEL_VOICE_EAGER_SETTLE_MS,
      MIN_VOICE_EAGER_SETTLE_MS,
      MAX_VOICE_EAGER_SETTLE_MS,
      DEFAULT_VOICE_EAGER_SETTLE_MS,
    ),
    // The turn hold's three, read whatever the flag for the same reason as the rest of the voice's.
    voiceTurnHold: voiceTurnHoldMode(env.CHANNEL_VOICE_TURN_HOLD),
    voiceTurnHoldMs: bounded(
      env.CHANNEL_VOICE_TURN_HOLD_MS,
      MIN_VOICE_TURN_HOLD_MS,
      MAX_VOICE_TURN_HOLD_MS,
      DEFAULT_VOICE_TURN_HOLD_MS,
    ),
    voiceCompleteThreshold: boundedFraction(
      env.CHANNEL_VOICE_COMPLETE_THRESHOLD,
      MIN_VOICE_COMPLETE_THRESHOLD,
      MAX_VOICE_COMPLETE_THRESHOLD,
      DEFAULT_VOICE_COMPLETE_THRESHOLD,
    ),
    voiceHoldFirstMs: bounded(
      env.CHANNEL_VOICE_HOLD_FIRST_MS,
      MIN_VOICE_HOLD_FIRST_MS,
      MAX_VOICE_HOLD_FIRST_MS,
      DEFAULT_VOICE_HOLD_FIRST_MS,
    ),
    voiceHoldSecondMs: bounded(
      env.CHANNEL_VOICE_HOLD_SECOND_MS,
      MIN_VOICE_HOLD_SECOND_MS,
      MAX_VOICE_HOLD_SECOND_MS,
      DEFAULT_VOICE_HOLD_SECOND_MS,
    ),
    // The web surface's eight, read here and only here so the installer's env allowlist pin sees
    // them, and validated in broker/web/config.ts, where the surface is: the bind is kept as
    // written because the tailnet range check and the `tailscale` literal belong to that module.
    // Unset by default, and unset is the absence of the machinery: no second listener is created.
    webBind: env.CHANNEL_WEB_BIND?.trim() || null,
    webPort: integerAtLeast(env.CHANNEL_WEB_PORT, 1, DEFAULT_WEB_PORT),
    webOperators: webList(env.CHANNEL_WEB_OPERATORS) ?? [],
    webDevices: webList(env.CHANNEL_WEB_DEVICES),
    webSummaryPeers: webList(env.CHANNEL_WEB_SUMMARY_PEERS) ?? [],
    webTailscale: env.CHANNEL_WEB_TAILSCALE?.trim() || DEFAULT_WEB_TAILSCALE,
    webStaticRoot: env.CHANNEL_WEB_STATIC_ROOT?.trim() || defaultWebStaticRoot(),
    webSiblings: webList(env.CHANNEL_WEB_SIBLINGS) ?? [],
  };
  // Flux refuses an eager threshold above the end-of-turn threshold, so the pair is refused here
  // rather than at the socket. With eager off the eager threshold is never sent, and the pair is
  // not checked.
  if (config.voiceEager && config.voiceEagerThreshold > config.voiceEotThreshold) {
    throw new Error(
      `expected CHANNEL_VOICE_EAGER_THRESHOLD (${String(config.voiceEagerThreshold)}) at or below ` +
        `CHANNEL_VOICE_EOT_THRESHOLD (${String(config.voiceEotThreshold)}) with CHANNEL_VOICE_EAGER on`,
    );
  }
  // The still-looking line follows the thinking line, so a second moment at or before the first
  // would speak it over the thinking line or ahead of it. Checked whatever the voice flag, like the
  // two knobs themselves.
  if (config.voiceHoldSecondMs <= config.voiceHoldFirstMs) {
    throw new Error(
      `expected CHANNEL_VOICE_HOLD_SECOND_MS (${String(config.voiceHoldSecondMs)}) above ` +
        `CHANNEL_VOICE_HOLD_FIRST_MS (${String(config.voiceHoldFirstMs)})`,
    );
  }
  return config;
}

/**
 * The Jev key, read from the file `CHANNEL_JEV_KEY_FILE` names, or null where none is named.
 *
 * Held to the Discord token file's protection check, since the key is a bearer credential of the
 * same kind: readable means anyone on the machine can spend it, and writable means the broker can
 * be handed someone else's. Where the two differ is what a failure costs. A token file that cannot
 * be used stops the broker, because without it nothing reaches Discord at all; this key only adds a
 * judged reading of messages, so a file that is unprotected, missing, unreadable or empty yields
 * null with one warning, and the caller decides whether that stops the start. So does a key
 * carrying anything outside printable ASCII, since it rides an HTTP header and an interior line
 * break would make every request throw. No file named is the ordinary off state and warns nothing.
 *
 * Never throws. A warning names the key file and the cause, never the contents.
 */
export function readJevKey(
  file: string | null,
  warn: (message: string) => void,
  // Injectable so a test reaches each refusal without a spawn or a hardened file; the default is
  // the check the token file is held to.
  protect: (file: string) => void = assertTokenFileIsProtected,
): string | null {
  if (file === null) return null;
  try {
    return readKeyFile(file, protect);
  } catch (error) {
    warn(`broker: the Jev key file ${file} ${(error as Error).message}`);
    return null;
  }
}

/**
 * The transcription key, read from the file `CHANNEL_VOICE_STT_KEY_FILE` names, or null where none
 * is named.
 *
 * The file must sit inside the state root, the directory holding the broker's state file. At the
 * default location that is the directory the installer provisions and hardens. A
 * `CHANNEL_BROKER_STATE` set elsewhere moves the root to a directory the installer never hardened.
 * A path equal to the root or outside it, a `..` escape included, is refused before it is opened.
 * Past that it is held to the Discord token file's protection check and refused the way that file
 * is: a named file that is unprotected, missing, unreadable, empty or holds a character a request
 * header cannot carry throws, and the broker refuses to start, since a named key the voice cannot
 * use is a configuration error rather than an off state. The refusal names the file and the cause,
 * never the contents.
 */
export function readVoiceSttKey(
  file: string | null,
  stateRoot: string,
  // Injectable so a test reaches each refusal without a hardened file; the default is the check
  // the token file is held to.
  protect: (file: string) => void = assertTokenFileIsProtected,
): string | null {
  if (file === null) return null;
  if (!isInside(file, stateRoot)) {
    throw new Error(`the transcription key file ${file} is outside the state root ${stateRoot}`);
  }
  try {
    return readKeyFile(file, protect);
  } catch (error) {
    throw new Error(`the transcription key file ${file} ${(error as Error).message}`);
  }
}

/**
 * The fast tier's Anthropic key, read from the file `CHANNEL_VOICE_FAST_KEY_FILE` names, or null
 * where none is named.
 *
 * The file must sit inside the state root, under the rule `readVoiceSttKey` states, and is refused
 * before it is opened otherwise. Past that it is held to the Discord token file's protection check
 * and refused the way the transcription key is: a named file the voice cannot use throws, and the
 * broker refuses to start. The refusal names the file and the cause, never the contents.
 */
export function readVoiceFastKey(
  file: string | null,
  stateRoot: string,
  // Injectable so a test reaches each refusal without a hardened file; the default is the check
  // the token file is held to.
  protect: (file: string) => void = assertTokenFileIsProtected,
): string | null {
  if (file === null) return null;
  if (!isInside(file, stateRoot)) {
    throw new Error(`the fast tier key file ${file} is outside the state root ${stateRoot}`);
  }
  try {
    return readKeyFile(file, protect);
  } catch (error) {
    throw new Error(`the fast tier key file ${file} ${(error as Error).message}`);
  }
}

/**
 * Whether `file` resolves to a path strictly inside `root`, compared as resolved paths. On Windows
 * `path.relative` compares without regard to case, as the file system does, and a path on another
 * drive comes back absolute.
 */
function isInside(file: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * What a bearer credential read from a file must be made of, and the cause phrase for one that is
 * not. A credential rides an HTTP header, where a byte outside printable ASCII, an interior line
 * break or a UTF-16 file's NULs would make every request throw.
 */
export const VISIBLE_ASCII_CREDENTIAL = /^[\x21-\x7e]+$/;
export const NOT_A_HEADER_VALUE = "holds a character a request header cannot carry";

/**
 * A bearer key from a protected file. Throws with the cause as a phrase that follows the file's
 * name: "cannot be used: ...", "is empty", or "holds a character a request header cannot carry".
 */
function readKeyFile(file: string, protect: (file: string) => void): string {
  let key: string;
  try {
    protect(file);
    key = readFileSync(file, "utf8").trim();
  } catch (error) {
    // The protection check's own message names the path as a token file, which is what it was
    // written for; the caller's prefix is what says whose key file this one is.
    throw new Error(`cannot be used: ${String(error)}`);
  }
  if (key === "") throw new Error("is empty");
  if (!VISIBLE_ASCII_CREDENTIAL.test(key)) throw new Error(NOT_A_HEADER_VALUE);
  return key;
}
