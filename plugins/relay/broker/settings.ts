// The catalog of every setting `broker.env` may hold: what each key decides, what leaving it unset
// does, which other key's switch it sits behind, and whether its value is the same on every host or
// belongs to one. It carries no values and no defaults: those stay in `config.ts`, where they are
// read, and in the operations guide's Tunables table.
//
// The catalog is held equal to `$script:ChannelBrokerEnvAllowlist` and `$script:ChannelBrokerEnvFileMetadataKeys`
// in `install/Install-Functions.ps1`, and to the keys the broker's runtime files read, by
// `install/Install-Functions.test.ts` and `settings.test.ts`.

/**
 * A broker key is one the broker process reads from its environment, and is on the launcher's
 * allowlist. A launcher key is one `broker.env` carries and the launcher or the installer reads,
 * which never becomes a broker environment variable.
 */
export type SettingKind = "broker" | "launcher";

/**
 * A host-scoped value is true of one machine alone (a path, an address, a name, a binary, an account
 * or peers), so the next host sets its own. A fleet-scoped value is the same on every host, so the
 * next host copies it.
 */
export type SettingScope = "host" | "fleet";

type SettingBase = {
  readonly key: string;
  readonly kind: SettingKind;
  /** What the key decides, in one line. */
  readonly meaning: string;
  readonly scope: SettingScope;
  /**
   * On a gating entry whose feature only another key turns on, the keys that each turn on a feature
   * reading this one. The entry is reported unset only where at least one of them is on.
   */
  readonly switch?: readonly string[];
  /** For a deprecated alias, the key it stands for. */
  readonly aliasOf?: string;
};

/**
 * A gating entry leaves a feature or surface off when unset and names it; a tuning entry applies a
 * default. A reader that is ambiguous is classified as gating.
 */
export type Setting = SettingBase &
  (
    | { readonly unset: "default" }
    | { readonly unset: "off"; readonly stays: string }
  );

export const SETTINGS: readonly Setting[] = [
  // The broker's core.
  { key: "CHANNEL_HOST_NAME", kind: "broker", meaning: "The host label on every card and record", scope: "host", unset: "default" },
  { key: "CHANNEL_BROKER_PORT", kind: "broker", meaning: "The loopback port the broker listens on, which the hooks must match", scope: "host", unset: "default" },
  { key: "CHANNEL_BROKER_STATE", kind: "broker", meaning: "Path of the registry snapshot", scope: "host", unset: "default" },
  { key: "CHANNEL_STALE_AFTER_MS", kind: "broker", meaning: "Silence after which a session is marked stale", scope: "fleet", unset: "default" },
  { key: "CHANNEL_SWEEP_INTERVAL_MS", kind: "broker", meaning: "How often the staleness sweep runs", scope: "fleet", unset: "default" },
  { key: "CHANNEL_MAX_BODY_BYTES", kind: "broker", meaning: "Ceiling on a hook or relay request body", scope: "fleet", unset: "default" },
  { key: "CHANNEL_RELAY_HEARTBEAT_MS", kind: "broker", meaning: "How often each attached relay is pinged", scope: "fleet", unset: "default" },
  { key: "CHANNEL_RETAIN_TERMINAL_MS", kind: "broker", meaning: "How long an ended session is kept before pruning", scope: "fleet", unset: "default" },
  { key: "CHANNEL_MAX_SESSIONS", kind: "broker", meaning: "Ceiling on session records", scope: "fleet", unset: "default" },

  // Logging.
  { key: "CHANNEL_BROKER_LOG_FILE", kind: "broker", meaning: "Path of the rotating log file", scope: "host", unset: "off", stays: "the log file, so the broker logs to the console alone" },
  { key: "CHANNEL_BROKER_LOG_MAX_BYTES", kind: "broker", meaning: "Size at which the log file rotates", scope: "fleet", unset: "default" },
  { key: "CHANNEL_BROKER_LOG_MAX_FILES", kind: "broker", meaning: "Log files kept, the active one plus the rotated ones", scope: "fleet", unset: "default" },

  // The Discord surfaces and the sender gate.
  { key: "CHANNEL_DISCORD_TOKEN_FILE", kind: "broker", meaning: "Path of the bot token file", scope: "host", switch: ["CHANNEL_DISCORD_CHANNEL"], unset: "off", stays: "the Discord surfaces, for want of a bot token, unless CHANNEL_DISCORD_TOKEN is set in the broker's environment" },
  { key: "CHANNEL_DISCORD_CHANNEL", kind: "broker", meaning: "The Discord channel threads are opened in", scope: "host", unset: "off", stays: "the Discord surfaces" },
  { key: "CHANNEL_ALLOWED_USER_ID", kind: "broker", meaning: "One Discord user allowed to steer, as an operator; CHANNEL_SENDERS can name the operator instead, and with neither set the broker refuses to start", scope: "fleet", unset: "default" },
  { key: "CHANNEL_SENDERS", kind: "broker", meaning: "This host's roster of Discord users, each as an operator or a participant; CHANNEL_ALLOWED_USER_ID can name the operator instead, and with neither set the broker refuses to start", scope: "host", unset: "default" },
  { key: "CHANNEL_DISCORD_REFRESH_MS", kind: "broker", meaning: "How often the Discord surfaces are reconciled", scope: "fleet", unset: "default" },
  { key: "CHANNEL_DISCORD_DWELL_MS", kind: "broker", meaning: "How long a state must hold before a thread rename is spent on it", scope: "fleet", unset: "default" },
  { key: "CHANNEL_DISCORD_IDLE_AFTER_MS", kind: "broker", meaning: "Silence after which a thread reads idle rather than working", scope: "fleet", unset: "default" },
  { key: "CHANNEL_DISCORD_EXITED_AFTER_MS", kind: "broker", meaning: "Silence after which a stale session is presumed dead", scope: "fleet", unset: "default" },
  { key: "CHANNEL_DISCORD_ARCHIVE_ON_END", kind: "broker", meaning: "Whether an ended session's thread is archived", scope: "fleet", unset: "default" },

  // What reaches a thread.
  { key: "CHANNEL_MIRROR", kind: "broker", meaning: "Whether console prompts and turn replies are mirrored into the thread", scope: "fleet", unset: "default" },
  { key: "CHANNEL_MIRROR_MAX_BYTES", kind: "broker", meaning: "Largest mirror post accepted", scope: "fleet", unset: "default" },
  { key: "CHANNEL_INTERIM_MIRROR", kind: "broker", meaning: "Whether the transcript is tailed for mid-turn narration and messages", scope: "fleet", unset: "default" },
  { key: "CHANNEL_INTERIM_POLL_MS", kind: "broker", meaning: "How often the transcript tailer polls each live session", scope: "fleet", unset: "default" },
  { key: "CHANNEL_QUESTION_HOLD_MS", kind: "broker", meaning: "How long a session's question stays answerable from the thread", scope: "fleet", unset: "default" },
  { key: "CHANNEL_TASK_NOTIFICATION", kind: "broker", meaning: "How a background task's wake prompt reaches the thread", scope: "fleet", unset: "default" },
  { key: "CHANNEL_PEER_MESSAGES", kind: "broker", meaning: "How much of a peer-session message reaches the thread", scope: "fleet", unset: "default" },
  { key: "CHANNEL_MODEL_CHANGE_ALERT", kind: "broker", meaning: "Whether a mid-session model change posts on the alert tier", scope: "fleet", unset: "off", stays: "the model-change alert, so a change posts on the quiet notice tier" },

  // The cards.
  { key: "CHANNEL_USAGE_CARD", kind: "broker", meaning: "Whether the Fleet: Usage thread and its card exist", scope: "fleet", unset: "off", stays: "the Fleet: Usage thread and card" },
  { key: "CHANNEL_USAGE_CARD_REFRESH_MS", kind: "broker", meaning: "How often the usage card is re-read and re-rendered", scope: "fleet", unset: "default" },
  { key: "CHANNEL_USAGE_CACHE_ROOT", kind: "broker", meaning: "Where the usage cache and account list are read from", scope: "host", unset: "default" },
  { key: "CHANNEL_BOARD_CARD", kind: "broker", meaning: "Whether the Fleet: Board thread and its card exist", scope: "fleet", unset: "off", stays: "the Fleet: Board thread and card" },
  { key: "CHANNEL_BOARD_PROJECTS", kind: "broker", meaning: "Semicolon-separated absolute project roots swept for plan docs", scope: "host", switch: ["CHANNEL_BOARD_CARD"], unset: "off", stays: "the board card's folder view, while the web pages' plan sweep reads the roster personas' working directories" },
  { key: "CHANNEL_BOARD_CARD_REFRESH_MS", kind: "broker", meaning: "How often the board card and the web surface's sources are re-read", scope: "fleet", unset: "default" },
  { key: "CHANNEL_BOARD_EVENTS_PATH", kind: "broker", meaning: "Where the kit's goal event stream is tailed from", scope: "host", unset: "default" },
  { key: "CHANNEL_BOARD_ROSTER", kind: "broker", meaning: "Absolute path of the fleet roster that draws each persona's queue group", scope: "host", switch: ["CHANNEL_BOARD_CARD", "CHANNEL_DECISIONS_CARD", "CHANNEL_WEB_BIND"], unset: "off", stays: "the persona queue groups, the decisions card, and the web surface's repo list" },
  { key: "CHANNEL_DIRECTION_LEDGER", kind: "broker", meaning: "Absolute path of this machine's direction ledger", scope: "host", switch: ["CHANNEL_WEB_BIND"], unset: "off", stays: "the standup page's sandbox heading" },
  { key: "CHANNEL_DECISIONS_CARD", kind: "broker", meaning: "Whether the Fleet: Decisions thread and its card exist", scope: "fleet", unset: "off", stays: "the Fleet: Decisions thread and card" },
  { key: "CHANNEL_DECISIONS_CARD_REFRESH_MS", kind: "broker", meaning: "How often the decisions card is re-read and re-rendered", scope: "fleet", unset: "default" },

  // The Jev key and the response gate.
  { key: "CHANNEL_JEV_KEY_FILE", kind: "broker", meaning: "Path of the file holding the key the response gate, the voice's ranking and the judged turn hold ask Jev under", scope: "host", switch: ["CHANNEL_RESPONSE_GATE", "CHANNEL_VOICE"], unset: "off", stays: "the voice's ranking and the judged turn hold; a response gate in shadow or live refuses to start without it" },
  { key: "CHANNEL_INBOX_JUDGE_KEY_FILE", kind: "broker", meaning: "The earlier name of the Jev key file path, still read for the same file", scope: "host", aliasOf: "CHANNEL_JEV_KEY_FILE", unset: "default" },
  { key: "CHANNEL_RESPONSE_GATE", kind: "broker", meaning: "Whether a thread's messages are held and delivered to its session together", scope: "fleet", unset: "off", stays: "the response gate, so each admitted message is delivered at once" },
  { key: "CHANNEL_RESPONSE_GATE_MAX_MESSAGES", kind: "broker", meaning: "Messages at which a held buffer delivers", scope: "fleet", unset: "default" },
  { key: "CHANNEL_RESPONSE_GATE_MAX_WAIT_MS", kind: "broker", meaning: "Age of a held buffer's oldest message at which it delivers", scope: "fleet", unset: "default" },
  { key: "CHANNEL_RESPONSE_GATE_QUIET_MS", kind: "broker", meaning: "Quiet time after which a held buffer is put to the judge", scope: "fleet", unset: "default" },
  { key: "CHANNEL_RESPONSE_GATE_THRESHOLD", kind: "broker", meaning: "The judge's probability at or above which a held buffer delivers", scope: "fleet", unset: "default" },

  // Attachments.
  { key: "CHANNEL_ATTACHMENTS", kind: "broker", meaning: "Who may attach a file that reaches a session", scope: "fleet", unset: "default" },
  { key: "CHANNEL_ATTACHMENT_MAX_BYTES", kind: "broker", meaning: "The most bytes one attached file may carry", scope: "fleet", unset: "default" },
  { key: "CHANNEL_ATTACHMENT_RETAIN_DAYS", kind: "broker", meaning: "Days a saved file is kept before the broker deletes it", scope: "fleet", unset: "default" },

  // The voice.
  { key: "CHANNEL_VOICE", kind: "broker", meaning: "Whether the broker can join a voice channel", scope: "fleet", unset: "off", stays: "the voice, which loads no voice module" },
  { key: "CHANNEL_VOICE_IDLE_MS", kind: "broker", meaning: "How long the bot stays in a voice channel with no operator audio", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_LOOPBACK", kind: "broker", meaning: "Development check that plays each operator's audio back two seconds late", scope: "fleet", switch: ["CHANNEL_VOICE"], unset: "off", stays: "the voice loopback check" },
  { key: "CHANNEL_VOICE_STT_KEY_FILE", kind: "broker", meaning: "Path of the file holding the key that transcribes and speaks", scope: "host", switch: ["CHANNEL_VOICE"], unset: "off", stays: "the voice's hearing and speech, so the channel is deaf and mute" },
  { key: "CHANNEL_VOICE_EOT_THRESHOLD", kind: "broker", meaning: "How sure the speech model must be that a turn is over", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_EAGER_THRESHOLD", kind: "broker", meaning: "How sure the speech model must be of an early end of turn", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_EAGER", kind: "broker", meaning: "Whether the fast tier acts on the early end-of-turn signal", scope: "fleet", switch: ["CHANNEL_VOICE"], unset: "off", stays: "the early end-of-turn handling" },
  { key: "CHANNEL_VOICE_SHORT_TURN_WORDS", kind: "broker", meaning: "The fewest words a cut-in needs to stop the persona", scope: "fleet", unset: "default" },
  { key: "CHANNEL_SPEECH_VOICE", kind: "broker", meaning: "The speech model's voice the persona speaks in", scope: "fleet", unset: "default" },
  { key: "CHANNEL_SPEECH_TIMEOUT_MS", kind: "broker", meaning: "How long each wait on the speech socket may run", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_HANDOFF_THRESHOLD", kind: "broker", meaning: "The score at or above which a spoken turn goes to the session", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_ANSWER_THRESHOLD", kind: "broker", meaning: "The score at or above which the fast model answers a spoken turn", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_FAST_KEY_FILE", kind: "broker", meaning: "Path of the file holding the key the fast model answers under", scope: "host", switch: ["CHANNEL_VOICE"], unset: "off", stays: "the fast tier, so every turn goes to the session" },
  { key: "CHANNEL_VOICE_FAST_MODEL", kind: "broker", meaning: "The model that answers a spoken turn", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_MEMORY_TURNS", kind: "broker", meaning: "How many spoken lines the persona remembers", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_MAX_SPOKEN_WORDS", kind: "broker", meaning: "The most words of a reply that are spoken aloud", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_EAGER_SETTLE_MS", kind: "broker", meaning: "How long an answer waits after an early end of turn before hand-off", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_HOLD_FIRST_MS", kind: "broker", meaning: "How long a handed-off turn waits before the thinking line", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_HOLD_SECOND_MS", kind: "broker", meaning: "How long after a hand-off the still-looking line is spoken", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_TURN_HOLD", kind: "broker", meaning: "Whether an operator's turn waits before anything acts on it", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_TURN_HOLD_MS", kind: "broker", meaning: "How long a held end of turn waits for the operator to carry on", scope: "fleet", unset: "default" },
  { key: "CHANNEL_VOICE_COMPLETE_THRESHOLD", kind: "broker", meaning: "How sure Jev must be that held words are a finished thought", scope: "fleet", unset: "default" },

  // The web surface.
  { key: "CHANNEL_WEB_BIND", kind: "broker", meaning: "Whether the web surface exists and the tailnet address it listens on", scope: "host", unset: "off", stays: "the web surface, so no second listener is created" },
  { key: "CHANNEL_WEB_PORT", kind: "broker", meaning: "The web surface's port", scope: "host", unset: "default" },
  { key: "CHANNEL_WEB_OPERATORS", kind: "broker", meaning: "Comma-separated tailnet logins admitted to the pages", scope: "fleet", switch: ["CHANNEL_WEB_BIND"], unset: "off", stays: "the whole broker, which refuses to start with the bind set and no admitted login" },
  { key: "CHANNEL_WEB_DEVICES", kind: "broker", meaning: "Comma-separated tailnet node names a peer must be on", scope: "fleet", switch: ["CHANNEL_WEB_BIND"], unset: "off", stays: "the device check, so any node under an admitted login is admitted" },
  { key: "CHANNEL_WEB_SUMMARY_PEERS", kind: "broker", meaning: "Tailnet node names of sibling sandboxes admitted to the summary route alone", scope: "host", switch: ["CHANNEL_WEB_BIND"], unset: "off", stays: "the sibling summary route" },
  { key: "CHANNEL_WEB_TAILSCALE", kind: "broker", meaning: "The Tailscale CLI the surface identifies peers with", scope: "host", unset: "default" },
  { key: "CHANNEL_WEB_STATIC_ROOT", kind: "broker", meaning: "Absolute path of the directory the pages are served from", scope: "host", unset: "default" },
  { key: "CHANNEL_WEB_SIBLINGS", kind: "broker", meaning: "Name=address:port entries for the sibling sandboxes this broker polls", scope: "host", switch: ["CHANNEL_WEB_BIND"], unset: "off", stays: "the sibling poll and the rail on every page" },

  // The four keys the launcher or the installer reads from the file.
  { key: "CHANNEL_NODE_EXE", kind: "launcher", meaning: "Absolute path to node, pinned at install time and read by the launcher", scope: "host", unset: "default" },
  { key: "CHANNEL_TASK_USER", kind: "launcher", meaning: "The account that installed, recorded for comparison with the task's account", scope: "host", unset: "default" },
  { key: "CHANNEL_HOOK_OWNER", kind: "launcher", meaning: "The hook owner the last install applied, read back by the next install", scope: "host", unset: "default" },
  { key: "CHANNEL_PLUGIN_MARKETPLACE", kind: "launcher", meaning: "The marketplace the relay plugin was installed from, read by the launch wrapper and the next install", scope: "host", unset: "default" },
];

/**
 * The spellings `strictFlag` in `config.ts` reads as on, after trimming and folding case. Held here
 * so the flag reader and the switch rule below share one list.
 */
export const FLAG_TRUE: readonly string[] = ["1", "true", "yes", "on"];

const isFlagOn = (value: string): boolean => FLAG_TRUE.includes(value.trim().toLowerCase());
const isPresent = (value: string): boolean => value.trim() !== "";
// The response gate is on in shadow and live and off in its third mode, as `responseGateMode` reads it.
const isGateOn = (value: string): boolean => ["shadow", "live"].includes(value.trim().toLowerCase());

/**
 * How each key that serves as another entry's switch is read as on, following the reader of that key:
 * the flags are `strictFlag`'s, the response gate is its three-mode vocabulary, and the web bind and
 * the Discord channel are on when they hold any value.
 */
export const SWITCH_RULES: Readonly<Record<string, (value: string) => boolean>> = {
  CHANNEL_BOARD_CARD: isFlagOn,
  CHANNEL_DECISIONS_CARD: isFlagOn,
  CHANNEL_VOICE: isFlagOn,
  CHANNEL_RESPONSE_GATE: isGateOn,
  CHANNEL_WEB_BIND: isPresent,
  CHANNEL_DISCORD_CHANNEL: isPresent,
};

/**
 * Keys outside the catalog whose value in the broker's environment stands in for an entry. The
 * Discord reader takes a direct bot token before it reads the token file, so a broker started with
 * one is not missing the file. The launcher refuses these keys in a broker.env, so the repair pass's
 * report, which reads that file, never passes them here.
 */
export const SUPPLIED_BY: Readonly<Record<string, readonly string[]>> = {
  CHANNEL_DISCORD_TOKEN_FILE: ["CHANNEL_DISCORD_TOKEN"],
};

/**
 * The gating keys left unset in `values`, in catalog order, that a feature turned on in `values`
 * reads. A key is unset when it is absent or blank. An entry counts as set where its deprecated alias
 * is set, or a key `SUPPLIED_BY` names for it, since the broker reads that key in its place. An entry
 * with a switch list is named only where at least one key on the list is on; an entry with none is
 * named whenever it is unset.
 *
 * Both the broker's start-up line and the repair pass's report call this, so the rule has one copy.
 */
export function unsetGatingKeys(values: Readonly<Record<string, string | undefined>>): string[] {
  const hasValue = (key: string): boolean => isPresent(values[key] ?? "");
  const isSet = (key: string): boolean =>
    hasValue(key) ||
    SETTINGS.some((other) => other.aliasOf === key && hasValue(other.key)) ||
    (SUPPLIED_BY[key] ?? []).some(hasValue);
  const isOn = (key: string): boolean => (SWITCH_RULES[key] ?? isPresent)(values[key] ?? "");
  return SETTINGS.filter(
    (setting) =>
      setting.unset === "off" &&
      !isSet(setting.key) &&
      (setting.switch === undefined || setting.switch.some(isOn)),
  ).map((setting) => setting.key);
}
