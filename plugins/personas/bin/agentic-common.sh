#!/usr/bin/env bash
# bin/agentic-common.sh - Shared supervisor/test helpers.
# Sourced by bin/supervise.sh, bin/supervise-holder.sh and .kit/live-common.sh.
# The holder sources it inside the process whose stdout is the child's input
# pipe, so nothing at this file's top level may write to stdout.
# Provides: wait_persona_free, refuse_if_persona_live, emit_settings_json,
#           ensure_settings_plugin_ids, ensure_settings_arming,
#           ensure_settings_jev_mode, ensure_settings_jev_live,
#           ensure_settings_memory_gate_discard_percent,
#           ensure_settings_cadences, read_settings_controller_tick,
#           jev_live_to_csv, settings_path_json,
#           read_settings_coordinator_persona,
#           read_settings_architect_persona,
#           read_settings_liaison_persona,
#           read_settings_fleet_roster,
#           valid_persona_name, set_aside_store,
#           find_global_store, list_installed_stores,
#           plugin_store_file_name, migrate_global_store,
#           installed_id_cutover_done, poll_decisions, poll_heartbeat.
# COORDINATOR_PERSONA, ARCHITECT_PERSONA and LIAISON_PERSONA are exported on
# both settings branches: emit_settings_json exports the names it writes, and
# the three read_settings_*_persona functions print the names a provided file
# resolves to, for the caller to export.
# All functions use W2 read-error semantics: a read error is a transient mid-write
# race, treated as "live" (or "not ready"), never an abort. The timeout is the only
# exit. refuse_if_persona_live is the one exception: it is a start-only check with
# no later poll to recover on, so it fails closed on a read error after its re-reads
# instead of waiting it out. The three gate readers of the commons store,
# refuse_if_persona_live, wait_persona_free_both and wait_persona_free, apply
# one rule to a store that fails to parse: one last
# written longer ago than the stale bound has no live writer, so it is set aside
# under a .corrupt-<time> name beside it and the path reads as free, while one
# written inside the bound is a possible mid-write and keeps the read-error reading.

# --- Plugin ids ---
# The two ids pluginConfigs is keyed by: --plugin-dir load, and installed load.
AGENTIC_PLUGIN_DEV_ID="personas"
AGENTIC_PLUGIN_INSTALLED_ID="personas@applefeld"
# The installed id before the plugin moved into the applefeld marketplace.
# ensure_settings_plugin_ids carries options written under it to the current
# id, and migrate_global_store copies the store file written under it forward.
AGENTIC_PLUGIN_FORMER_INSTALLED_ID="personas@agent-persona"

# --- Contention guards ---
# The bound below which a commons entry counts as live, matching the plugin's
# staleAfterMs default (hooks/index.ts). A fleet launched with heartbeatMs
# above this value is read as stale here while its own arbitration still
# treats it as live.
PERSONA_STALE_MS=90000

# --- Profiles ---
# Selected by PROFILE=full|short (default: short).
# full: TICK_MS=30000, NUDGE_IDLE_MS=120000, GIT_PROBE_MS=120000
# short: TICK_MS=10000, NUDGE_IDLE_MS=45000, GIT_PROBE_MS=30000
PROFILE="${PROFILE:-short}"
case "$PROFILE" in
  full)
    TICK_MS=30000
    NUDGE_IDLE_MS=120000
    GIT_PROBE_MS=120000
    ;;
  short)
    TICK_MS=10000
    NUDGE_IDLE_MS=45000
    GIT_PROBE_MS=30000
    ;;
  *)
    echo "Unknown PROFILE: $PROFILE (use full or short)" >&2
    exit 1
    ;;
esac

# --- settings_path_json ---
# Usage: settings_path_json <variable-name> <path>
# Prints <path> as the body of a JSON string, for emit_settings_json to splice
# between quotes. It holds a filesystem path to what a JSON string can carry:
# a backslash, which a Windows path is written with, is doubled so the parser
# reads back the path that was given; a double quote, which would close the
# string, and a control character, which JSON refuses raw, are refused with an
# ERROR line naming the variable, and the function returns 1. Every path the
# emitter writes goes through here.
settings_path_json() {
  local name="$1" value="$2"
  case "$value" in
    *'"'*)
      echo "ERROR: emit_settings_json: $name '$value' must not hold a double quote" >&2
      return 1
      ;;
    *[[:cntrl:]]*)
      echo "ERROR: emit_settings_json: $name must not hold a control character" >&2
      return 1
      ;;
  esac
  # The pattern and the replacement are held in a variable rather than
  # written as escapes, because bash 5.2 changed how a backslash inside a
  # substitution pattern is read and the literal form matches nothing there.
  local backslash='\'
  printf '%s' "${value//"$backslash"/"$backslash$backslash"}"
}

# --- JEV_PROMOTABLE_SET_IDS ---
# The five question-set ids a JEV_LIVE value may name, typed once here so the
# two callers of jev_live_to_csv below cannot disagree about which ids
# are promotable, and so test-personas/settings-plugin-key-test.sh can pin this
# list against hooks/question-catalog.ts's PROMOTABLE_SET_IDS, the plugin's own
# copy of the same five ids.
JEV_PROMOTABLE_SET_IDS=(turn-open turn-disposition memory-kind turn-score controller-decision)

# --- jev_live_to_csv ---
# Usage: jev_live_to_csv <caller-name> <comma-separated ids>
# Refuses the whole raw value, before any split runs, where it carries a
# control character other than a tab: `read -ra` below stops at the first
# newline regardless of IFS, since that is its record separator and not a
# field one, so a value carrying one would have silently dropped everything
# past it and let the membership check below run on a truncated string
# instead of failing on the character that broke it. That is the reason this
# guard exists at all. A tab is the one control character it excepts, since
# padding a member with one costs nothing and is trimmed away below anyway.
# Every other control character is refused alongside the newline, a carriage
# return, a vertical tab and a form feed among them.
# Trims each comma-separated member of the given value in ASCII whitespace
# only. That is the subset of the plugin's own jevLive-read trim() a POSIX
# shell can strip; the plugin's trim() also strips the Unicode spaces (U+00A0,
# U+FEFF, U+2028 and the rest), so a member hand-edited into a settings file
# can be kept by the plugin where the same padding would have been refused
# here. Drops a member left blank by a stray comma or by whitespace-only
# input, and refuses with an ERROR line naming <caller-name> and returns 1
# where a trimmed member is not one of JEV_PROMOTABLE_SET_IDS. A quote always
# misses that fixed set, so this membership check is also the
# hostile-boundary guard: no member printed by this function can ever be
# anything but one of the literal ids in JEV_PROMOTABLE_SET_IDS, so nothing it prints can break out
# of the JSON string emit_settings_json splices it into. On success prints
# the surviving members joined by commas with no padding and no quotes, the
# shape the manifest declares for jevLive (e.g. turn-open,turn-disposition),
# or prints nothing where every member trimmed away.
jev_live_to_csv() {
  local caller="$1" raw="$2" id trimmed candidate known out="" first=1
  local cntrl_guard="${raw//$'\t'/}"
  case "$cntrl_guard" in
    *[[:cntrl:]]*)
      echo "ERROR: $caller: JEV_LIVE must not hold a control character" >&2
      return 1
      ;;
  esac
  local IFS=','
  local -a parts
  read -ra parts <<< "$raw"
  for id in "${parts[@]}"; do
    trimmed="${id#"${id%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [ -z "$trimmed" ] && continue
    known=0
    for candidate in "${JEV_PROMOTABLE_SET_IDS[@]}"; do
      if [ "$trimmed" = "$candidate" ]; then known=1; break; fi
    done
    if [ "$known" -ne 1 ]; then
      echo "ERROR: $caller: JEV_LIVE id '$trimmed' is not in the promotable set" >&2
      return 1
    fi
    if [ "$first" -eq 1 ]; then out="$trimmed"; first=0; else out="$out,$trimmed"; fi
  done
  printf '%s' "$out"
}

# --- emit_settings_json ---
# Usage: emit_settings_json <output-file>
# Emits the settings.json JSON for the --settings flag.
# Carries: controllerTickMs, nudgeIdleMs, nudgeFloorMs, gitProbeMs, heartbeatMs,
#          staleAfterMs, memoryGateDiscardPercent (default 90),
#          arming (always "owner": every supervisor launch is an owner),
#          coordinatorPersona (from COORDINATOR_PERSONA, default "coordinator")
#          and architectPersona (from ARCHITECT_PERSONA, which has no default:
#          the key is omitted where the variable is unset or empty),
#          and liaisonPersona (from LIAISON_PERSONA, omitted the same way),
#          and fleetRoster (from FLEET_ROSTER, which has no default either
#          and is omitted the same way), and supervisorMailbox, heartbeatPath
#          and supervisorHeartbeatPath (from SUPERVISOR_MAILBOX, HEARTBEAT_PATH
#          and SUPERVISOR_HEARTBEAT_PATH, each omitted the same way), and
#          restartRecap (from RESTART_RECAP, auto or skill, omitted the same
#          way and refused outside that pair); and,
#          outside the plugin options, the harness's own autoContinue, always
#          false.
# Exports COORDINATOR_PERSONA, ARCHITECT_PERSONA and LIAISON_PERSONA to the
# values it wrote, so a caller can compare its own persona against the same
# names without parsing the settings file. This is the emit branch's half of
# those exports; the provided-settings branch reads the same names back through
# read_settings_coordinator_persona, read_settings_architect_persona and
# read_settings_liaison_persona.
emit_settings_json() {
  local out="$1"
  local self_review_opts=""
  if [ -n "${SELF_REVIEW_EVERY_TURNS:-}" ]; then
    self_review_opts=",\"selfReviewEveryTurns\":$SELF_REVIEW_EVERY_TURNS"
  fi
  local cost_opts=""
  if [ -n "${COST_SUMMARY_EVERY_N_TICKS:-}" ]; then
    cost_opts=",\"costSummaryEveryNTicks\":$COST_SUMMARY_EVERY_N_TICKS"
  fi
  if [ -n "${COST_MAX_NUDGES_PER_HOUR:-}" ]; then
    cost_opts="$cost_opts,\"costMaxNudgesPerHour\":$COST_MAX_NUDGES_PER_HOUR"
  fi
  if [ -n "${COST_MAX_PLUGIN_CALLS_PER_HOUR:-}" ]; then
    cost_opts="$cost_opts,\"costMaxPluginCallsPerHour\":$COST_MAX_PLUGIN_CALLS_PER_HOUR"
  fi
  if [ -n "${COST_BACKOFF_AFTER_TICKS:-}" ]; then
    cost_opts="$cost_opts,\"costBackoffAfterTicks\":$COST_BACKOFF_AFTER_TICKS"
  fi
  if [ -n "${COST_BACKOFF_MAX_MS:-}" ]; then
    cost_opts="$cost_opts,\"costBackoffMaxMs\":$COST_BACKOFF_MAX_MS"
  fi
  # jevMode is the decision seam's kill switch: off makes no shadow call and
  # writes no journal line, shadow is the working default. A set JEV_MODE
  # outside that pair is refused the way an invalid COST_* value is, rather
  # than reaching the child where the seam would otherwise fold it to off.
  local jev_opts=""
  if [ -n "${JEV_MODE:-}" ]; then
    case "$JEV_MODE" in
      off|shadow) ;;
      *)
        echo "ERROR: emit_settings_json: JEV_MODE '$JEV_MODE' must be 'off' or 'shadow'" >&2
        return 1
        ;;
    esac
    jev_opts=",\"jevMode\":\"$JEV_MODE\""
  fi
  # restartRecap switches the automatic [RESTART RECAP] block at the priming
  # turn: auto runs the recap script there, skill leaves the recap to the
  # skill alone. An unset or empty RESTART_RECAP omits the key, and the plugin
  # reads a missing key as auto. A set value outside that pair is refused the
  # way JEV_MODE's is, rather than reaching the child where it would read as
  # auto.
  local recap_opts=""
  if [ -n "${RESTART_RECAP:-}" ]; then
    case "$RESTART_RECAP" in
      auto|skill) ;;
      *)
        echo "ERROR: emit_settings_json: RESTART_RECAP '$RESTART_RECAP' must be 'auto' or 'skill'" >&2
        return 1
        ;;
    esac
    recap_opts=",\"restartRecap\":\"$RESTART_RECAP\""
  fi
  # jevLive names, by id, which questions PROMOTABLE_SET_IDS ships
  # may read Jev's live answer; empty by default, so a fresh install promotes
  # nothing. An unset or empty JEV_LIVE omits the key, the same "leave it out"
  # state jevMode's own check above uses, rather than writing an empty string
  # that would still read as "nothing promoted" but would make a byte-for-byte
  # comparison against a hand-edited file fail for no behavioral reason.
  if [ -n "${JEV_LIVE:-}" ]; then
    local jev_live_ids
    jev_live_ids=$(jev_live_to_csv emit_settings_json "$JEV_LIVE") || return 1
    if [ -n "$jev_live_ids" ]; then
      jev_opts="$jev_opts,\"jevLive\":\"$jev_live_ids\""
    fi
  fi
  # Plan item 6: pass the persona the supervisor was given through to the
  # child, so it claims that persona at session.start instead of always
  # falling back to the plugin's hardcoded "default". $PERSONA is supervise.sh's
  # own second positional argument, visible here because this function is
  # sourced into the caller's shell rather than run in a subshell.
  # Every value below is spliced into JSON unescaped, so each is held to a
  # shape that cannot close a string or an object and that JSON accepts:
  # digits with no leading zero for the numbers, letters, digits, underscore
  # and hyphen for the persona and for coordinatorPersona, architectPersona and
  # liaisonPersona (the same valid_persona_name check, since all four are
  # spliced the same way).
  local var
  for var in TICK_MS NUDGE_IDLE_MS GIT_PROBE_MS NUDGE_FLOOR_MS HEARTBEAT_MS STALE_AFTER_MS \
    MEMORY_GATE_DISCARD_PERCENT \
    SELF_REVIEW_EVERY_TURNS COST_SUMMARY_EVERY_N_TICKS \
    COST_MAX_NUDGES_PER_HOUR COST_MAX_PLUGIN_CALLS_PER_HOUR COST_BACKOFF_AFTER_TICKS COST_BACKOFF_MAX_MS; do
    case "${!var:-0}" in
      ''|*[!0-9]*|0[0-9]*)
        echo "ERROR: emit_settings_json: $var '${!var}' is not a non-negative integer without leading zeros" >&2
        return 1
        ;;
    esac
  done
  if ! valid_persona_name "${PERSONA:-default}"; then
    echo "ERROR: emit_settings_json: PERSONA '$PERSONA' may hold only letters, digits, underscore and hyphen" >&2
    return 1
  fi
  local persona_opt=""
  if [ -n "${PERSONA:-}" ]; then
    persona_opt=",\"persona\":\"$PERSONA\""
  fi
  # Section 6: a supervisor launch is always an owner, never a reader or an
  # off session, so this value is fixed rather than read from an env var.
  local coordinator_persona="${COORDINATOR_PERSONA:-coordinator}"
  if ! valid_persona_name "$coordinator_persona"; then
    echo "ERROR: emit_settings_json: COORDINATOR_PERSONA '$coordinator_persona' may hold only letters, digits, underscore and hyphen" >&2
    return 1
  fi
  if [ "$coordinator_persona" = "default" ]; then
    echo "ERROR: emit_settings_json: COORDINATOR_PERSONA must not be 'default'" >&2
    return 1
  fi
  # This export lets a caller compare its own persona against the name this
  # function just wrote into coordinatorPersona, without parsing the
  # settings file itself.
  export COORDINATOR_PERSONA="$coordinator_persona"
  # architectPersona names the persona that receives the architect's standing
  # instruction. It carries no default, unlike coordinatorPersona: an unset or
  # empty variable omits the key, and a launch reading a file without it builds
  # no architect instruction for any persona, so a fleet with no architect
  # carries no architect setting either. The name is held to the same character
  # class as the two values above, since it is spliced into JSON the same way,
  # and "default" is refused because every unnamed launch carries that persona
  # and the charter would reach all of them.
  local architect_persona="${ARCHITECT_PERSONA:-}"
  local architect_opt=""
  if [ -n "$architect_persona" ]; then
    if ! valid_persona_name "$architect_persona"; then
      echo "ERROR: emit_settings_json: ARCHITECT_PERSONA '$architect_persona' may hold only letters, digits, underscore and hyphen" >&2
      return 1
    fi
    if [ "$architect_persona" = "default" ]; then
      echo "ERROR: emit_settings_json: ARCHITECT_PERSONA must not be 'default'" >&2
      return 1
    fi
    # One persona cannot hold both seats. The two names gate two standing
    # instructions that contradict each other in one priming write: route
    # design asks to the architect, and answer the coordinator by naming
    # yourself, with a standing goal held and not held at once.
    if [ "$architect_persona" = "$coordinator_persona" ]; then
      echo "ERROR: emit_settings_json: ARCHITECT_PERSONA and COORDINATOR_PERSONA are both '$architect_persona'; one persona cannot hold both seats" >&2
      return 1
    fi
    architect_opt=",\"architectPersona\":\"$architect_persona\""
  fi
  export ARCHITECT_PERSONA="$architect_persona"
  # liaisonPersona names the persona that receives the liaison's standing
  # instruction, under the architect key's rule: no default, so an unset or
  # empty variable omits the key and no persona receives the charter; the same
  # character class and valid_persona_name check; "default" refused for the
  # same reason; and a name another seat holds refused, since that persona's one
  # priming write would carry two standing instructions that contradict each
  # other. The coordinator's name counts as held even when it is the default,
  # because the launch still resolves it. A liaison also needs an architect
  # named beside it, which the last check below states.
  local liaison_persona="${LIAISON_PERSONA:-}"
  local liaison_opt=""
  if [ -n "$liaison_persona" ]; then
    if ! valid_persona_name "$liaison_persona"; then
      echo "ERROR: emit_settings_json: LIAISON_PERSONA '$liaison_persona' may hold only letters, digits, underscore and hyphen" >&2
      return 1
    fi
    if [ "$liaison_persona" = "default" ]; then
      echo "ERROR: emit_settings_json: LIAISON_PERSONA must not be 'default'" >&2
      return 1
    fi
    if [ "$liaison_persona" = "$coordinator_persona" ]; then
      echo "ERROR: emit_settings_json: LIAISON_PERSONA and COORDINATOR_PERSONA are both '$liaison_persona'; one persona cannot hold both seats" >&2
      return 1
    fi
    if [ "$liaison_persona" = "$architect_persona" ]; then
      echo "ERROR: emit_settings_json: LIAISON_PERSONA and ARCHITECT_PERSONA are both '$liaison_persona'; one persona cannot hold both seats" >&2
      return 1
    fi
    # The seat's one job is to send briefs to the architect, whose name its
    # charter splices, and an absent architect key reads as no architect.
    if [ -z "$architect_persona" ]; then
      echo "ERROR: emit_settings_json: LIAISON_PERSONA '$liaison_persona' names a liaison while ARCHITECT_PERSONA is unset: liaisonPersona needs architectPersona, since the liaison sends its briefs to the architect" >&2
      return 1
    fi
    liaison_opt=",\"liaisonPersona\":\"$liaison_persona\""
  fi
  export LIAISON_PERSONA="$liaison_persona"
  # fleetRoster names the roster file the plugin reads: its fleet_status tool
  # on demand, and its controller tick to watch each roster persona's health.
  # The setting carries no default, as architectPersona does not: an unset or
  # empty variable omits the key, and a launch reading a file without it has no
  # fleet to read, on which the tool reports that it has no roster and the tick
  # watches nothing.
  # The value is a filesystem path rather than a name, so it is held to what a
  # JSON string can carry rather than to the persona character class. Three
  # characters decide that: a backslash, which a Windows path is written with
  # and which is doubled here so the parser reads back the path that was given;
  # a double quote, which would close the string; and a control character,
  # which JSON refuses raw. The last two are refused, neither belonging in a
  # path a fleet runs from.
  local fleet_roster="${FLEET_ROSTER:-}"
  local roster_opt="" path_json
  if [ -n "$fleet_roster" ]; then
    path_json=$(settings_path_json FLEET_ROSTER "$fleet_roster") || return 1
    roster_opt=",\"fleetRoster\":\"$path_json\""
  fi
  # The three paths a supervised child is handed by the supervisor that reads
  # them, each exported by bin/supervise.sh before this runs and each omitted
  # where its variable is unset or empty, so a launch that sets none of them
  # writes the options exactly as before: SUPERVISOR_MAILBOX, the mailbox the
  # controller tick drains; HEARTBEAT_PATH, the workdir sidecar the pre-launch
  # gate reads; SUPERVISOR_HEARTBEAT_PATH, the heartbeat file only the child
  # writes and the liveness verdict reads.
  local supervisor_opts=""
  if [ -n "${SUPERVISOR_MAILBOX:-}" ]; then
    path_json=$(settings_path_json SUPERVISOR_MAILBOX "$SUPERVISOR_MAILBOX") || return 1
    supervisor_opts="$supervisor_opts,\"supervisorMailbox\":\"$path_json\""
  fi
  if [ -n "${HEARTBEAT_PATH:-}" ]; then
    path_json=$(settings_path_json HEARTBEAT_PATH "$HEARTBEAT_PATH") || return 1
    supervisor_opts="$supervisor_opts,\"heartbeatPath\":\"$path_json\""
  fi
  if [ -n "${SUPERVISOR_HEARTBEAT_PATH:-}" ]; then
    path_json=$(settings_path_json SUPERVISOR_HEARTBEAT_PATH "$SUPERVISOR_HEARTBEAT_PATH") || return 1
    supervisor_opts="$supervisor_opts,\"supervisorHeartbeatPath\":\"$path_json\""
  fi
  # pluginConfigs is keyed by plugin id: the manifest name under --plugin-dir,
  # and "<name>@<marketplace>" for the installed copy. The installed form is
  # absent from the engine's type file, and options under the other id are
  # ignored without an error, so the same options are written under both.
  # test-personas/settings-plugin-key-test.sh pins both ids against the two manifests.
  local options="{\"controllerTickMs\":$TICK_MS,\"nudgeIdleMs\":$NUDGE_IDLE_MS,\"nudgeFloorMs\":${NUDGE_FLOOR_MS:-300000},\"gitProbeMs\":$GIT_PROBE_MS,\"heartbeatMs\":${HEARTBEAT_MS:-30000},\"staleAfterMs\":${STALE_AFTER_MS:-90000},\"memoryGateDiscardPercent\":${MEMORY_GATE_DISCARD_PERCENT:-90}$self_review_opts$cost_opts$jev_opts$recap_opts$persona_opt,\"arming\":\"owner\",\"coordinatorPersona\":\"$coordinator_persona\"$architect_opt$liaison_opt$roster_opt$supervisor_opts}"
  # autoContinue is the harness's own setting, at the top level rather than
  # under a plugin id. Off, a child that trips a usage limit ends its turn and
  # sits idle rather than parking until the limit resets, and the supervisor's
  # liveness verdict reads that child alive for as long as the limit is its
  # newest word. Interactive sessions never read this file.
  cat > "$out" <<EOF
{"autoContinue":false,"pluginConfigs":{"$AGENTIC_PLUGIN_DEV_ID":{"options":$options},"$AGENTIC_PLUGIN_INSTALLED_ID":{"options":$options}}}
EOF
}

# --- ensure_settings_plugin_ids ---
# Usage: ensure_settings_plugin_ids <settings-file>
# For a settings file the caller already provided: where options sit under only
# one of the two plugin ids, copies them under the other, leaving every option
# as the caller wrote it. An id whose options object is missing or empty counts
# as absent. The file is replaced by rename, so an interrupted write never leaves
# it truncated. Returns 1 when the file is not valid JSON, when it, its
# pluginConfigs, an id entry or an options value is not a plain object, or when
# the write fails.
#
# The plugin was named agentic-plugin before it was named personas, and its
# installed id was personas@agent-persona before the plugin moved into the
# applefeld marketplace. The engine's rename map rewrites the user, project
# and local settings files but not a --settings file, so a run directory
# written before either change holds its options under the former ids alone.
# Where neither current id carries options, each current id takes the options
# of its former counterpart, every option as written: the --plugin-dir id from
# agentic-plugin, and the installed id from personas@agent-persona, or from
# agentic-plugin@agent-persona where that carries none. A current id whose
# counterpart carries none takes the other side's source. Where the
# --plugin-dir id carries options, the installed id lacks them and
# personas@agent-persona carries them, the installed id takes
# personas@agent-persona's: that key is what the installed child read until
# the move, so a file whose two sides differ keeps each load mode on what it
# read before. The agentic-plugin keys are not read beside a current id,
# since the first launch after that rename carried them forward already. The
# former keys stay in the file, since the engine no longer reads them. A
# former key that holds no usable options object is skipped rather than
# refused.
ensure_settings_plugin_ids() {
  node -e '
const fs = require("fs");
const [file, devId, installedId, formerInstalledId] = process.argv.slice(1);
const formerDevId = "agentic-plugin";
const formerInstalledIds = [formerInstalledId, "agentic-plugin@agent-persona"];
const fail = (msg) => { console.error("ERROR: ensure_settings_plugin_ids: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
if (s.pluginConfigs === undefined) process.exit(0);
const pc = s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
for (const id of [devId, installedId]) {
  if (pc[id] === undefined) continue;
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options !== undefined && !plain(pc[id].options)) fail("has " + id + " options that are not an object");
}
const has = (id) => plain(pc[id]) && plain(pc[id].options) && Object.keys(pc[id].options).length > 0;
const copies = [];
if (has(devId) && !has(installedId)) copies.push([has(formerInstalledId) ? formerInstalledId : devId, installedId]);
else if (has(installedId) && !has(devId)) copies.push([installedId, devId]);
else if (!has(devId) && !has(installedId)) {
  const formerInstalled = formerInstalledIds.find(has) || null;
  const fromDev = has(formerDevId) ? formerDevId : formerInstalled;
  if (fromDev === null) process.exit(0);
  const fromInstalled = formerInstalled !== null ? formerInstalled : fromDev;
  copies.push([fromDev, devId], [fromInstalled, installedId]);
}
else process.exit(0);
for (const [from, to] of copies) pc[to] = Object.assign({}, pc[to], { options: Object.assign({}, pc[from].options) });
const tmp = file + ".tmp-" + process.pid;
try {
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  fail("could not be rewritten: " + e.message);
}
' "$1" "$AGENTIC_PLUGIN_DEV_ID" "$AGENTIC_PLUGIN_INSTALLED_ID" "$AGENTIC_PLUGIN_FORMER_INSTALLED_ID"
}

# --- ensure_settings_arming ---
# Usage: ensure_settings_arming <settings-file>
# For a settings file the caller already provided: under each of the two
# plugin ids, creates pluginConfigs, the id entry and its options object
# where any of them is absent, and sets options.arming to "owner" where an
# id's options omit the key, leaving every other option the caller wrote
# exactly as written. Where an id's options.arming is present and is not
# exactly "owner", the function refuses and exits 1 without writing: a
# supervisor launch always drives a goal tree as an owner, so a settings
# file naming another tier is a mistake to refuse rather than a value to
# honor. The same pass sets the harness's top-level autoContinue to false
# where the file omits it, as emit_settings_json writes it, and refuses any
# other value the same way it refuses another arming tier, since a
# supervised child always runs with the usage-limit pause off. It also writes
# supervisorMailbox, heartbeatPath and supervisorHeartbeatPath under each id
# from SUPERVISOR_MAILBOX, HEARTBEAT_PATH and SUPERVISOR_HEARTBEAT_PATH, where
# each is set, overwriting a differing value rather than completing an absent
# one: the supervisor reads those paths itself, so a value naming anything
# else would have the child write where nothing reads. An unset variable
# leaves its key as the file has it. The file is
# replaced by rename, same as ensure_settings_plugin_ids, so an interrupted
# write never leaves it truncated. Returns 1 on the same conditions that
# function does, with the same error-line shape, plus the arming and
# autoContinue refusals above; exits 0 when nothing needed changing.
ensure_settings_arming() {
  node -e '
const fs = require("fs");
const [file, devId, installedId, mailbox, heartbeatPath, supervisorHeartbeatPath] = process.argv.slice(1);
const paths = [["supervisorMailbox", mailbox || ""], ["heartbeatPath", heartbeatPath || ""], ["supervisorHeartbeatPath", supervisorHeartbeatPath || ""]];
const fail = (msg) => { console.error("ERROR: ensure_settings_arming: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
let changed = false;
if (s.pluginConfigs === undefined) { s.pluginConfigs = {}; changed = true; }
const pc = s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
for (const id of [devId, installedId]) {
  if (pc[id] === undefined) { pc[id] = {}; changed = true; }
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options === undefined) { pc[id].options = {}; changed = true; }
  const opts = pc[id].options;
  if (!plain(opts)) fail("has " + id + " options that are not an object");
  if (opts.arming === undefined) { opts.arming = "owner"; changed = true; }
  else if (opts.arming !== "owner") fail("carries arming '"'"'" + opts.arming + "'"'"' under " + id + "; a supervisor launch is always owner");
  for (const [key, value] of paths) {
    if (value !== "" && opts[key] !== value) { opts[key] = value; changed = true; }
  }
}
if (s.autoContinue === undefined) { s.autoContinue = false; changed = true; }
else if (s.autoContinue !== false) fail("carries autoContinue " + JSON.stringify(s.autoContinue) + "; a supervised child always runs with autoContinue false");
if (!changed) process.exit(0);
const tmp = file + ".tmp-" + process.pid;
try {
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  fail("could not be rewritten: " + e.message);
}
' "$1" "$AGENTIC_PLUGIN_DEV_ID" "$AGENTIC_PLUGIN_INSTALLED_ID" "${SUPERVISOR_MAILBOX:-}" "${HEARTBEAT_PATH:-}" "${SUPERVISOR_HEARTBEAT_PATH:-}"
}

# --- ensure_settings_jev_mode ---
# Usage: ensure_settings_jev_mode <settings-file>
# For a settings file the caller already provided: where JEV_MODE is set in
# the environment, writes it as options.jevMode under each of the two plugin
# ids, creating pluginConfigs, the id entry and its options object where any
# of them is absent, and leaving every other option the caller wrote exactly
# as written. Where JEV_MODE is unset or empty the file is left alone, so a
# hand-edited value survives a launch that says nothing about the mode.
#
# This one overwrites where ensure_settings_arming completes. The two keys
# answer different questions. arming is a property of the launch, always
# owner, so a file naming another tier is a mistake to refuse. jevMode is the
# operator current intent, carried from the roster through the keeper, and a
# kill switch that could not change a value an earlier launch wrote would be
# unable to turn anything off on any machine that has ever run.
#
# An invalid value is refused here on the same rule emit_settings_json uses,
# rather than written or folded, so the two branches cannot disagree about
# what a bad value means. The file is replaced by rename, same as its two
# siblings, so an interrupted write never leaves it truncated.
ensure_settings_jev_mode() {
  if [ -z "${JEV_MODE:-}" ]; then
    return 0
  fi
  case "$JEV_MODE" in
    off|shadow) ;;
    *)
      echo "ERROR: ensure_settings_jev_mode: JEV_MODE $JEV_MODE must be off or shadow" >&2
      return 1
      ;;
  esac
  node -e '
const fs = require("fs");
const [file, devId, installedId, mode] = process.argv.slice(1);
const fail = (msg) => { console.error("ERROR: ensure_settings_jev_mode: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
let changed = false;
if (s.pluginConfigs === undefined) { s.pluginConfigs = {}; changed = true; }
const pc = s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
for (const id of [devId, installedId]) {
  if (pc[id] === undefined) { pc[id] = {}; changed = true; }
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options === undefined) { pc[id].options = {}; changed = true; }
  const opts = pc[id].options;
  if (!plain(opts)) fail("has " + id + " options that are not an object");
  if (opts.jevMode !== mode) { opts.jevMode = mode; changed = true; }
}
if (!changed) process.exit(0);
const tmp = file + ".tmp-" + process.pid;
try {
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  fail("could not be rewritten: " + e.message);
}
' "$1" "$AGENTIC_PLUGIN_DEV_ID" "$AGENTIC_PLUGIN_INSTALLED_ID" "$JEV_MODE"
}

# --- ensure_settings_jev_live ---
# Usage: ensure_settings_jev_live <settings-file>
# Sibling to ensure_settings_jev_mode for the comma-separated jevLive option.
# Where JEV_LIVE is unset or empty, a string value is left alone: unset and
# empty are the same "leave it out" state ensure_settings_jev_mode's own
# JEV_MODE check uses, so a hand-edited value survives a launch that names no
# live question, and the file stays byte-identical rather than being
# rewritten with an equivalent value. A jevLive held as a JSON list is the
# one thing rewritten on every supervisor launch, set or unset, into the comma-separated
# string: Claude Code refuses to load the plugin's hooks where a settings
# value does not fit the type plugin.json declares, so a list left in place
# takes the plugin down. Where JEV_LIVE is set, jev_live_to_csv
# validates every comma-separated member against the promotable set before
# node runs, exactly as JEV_MODE's off|shadow case runs before this
# function's own node -e, so a bad id is refused with no file touched at all
# rather than reaching a node process that could still write something
# before failing. The file is replaced by rename, same as its sibling.
ensure_settings_jev_live() {
  local ids_csv=""
  if [ -n "${JEV_LIVE:-}" ]; then
    ids_csv=$(jev_live_to_csv ensure_settings_jev_live "$JEV_LIVE") || return 1
  fi
  if [ -z "$ids_csv" ]; then
    # Nothing named, whether JEV_LIVE is unset or held only commas and
    # whitespace. Node runs only where the file holds a jevLive list to
    # rewrite, so a launch that names nothing costs no process otherwise.
    tr -d '\r\n' < "$1" 2>/dev/null | grep -q '"jevLive"[[:space:]]*:[[:space:]]*\[' || return 0
  fi
  node -e '
const fs = require("fs");
const [file, devId, installedId, ids] = process.argv.slice(1);
const fail = (msg) => { console.error("ERROR: ensure_settings_jev_live: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
let changed = false;
if (ids === "") {
  // Nothing named: only a list is rewritten, as its trimmed members joined,
  // and no missing entry is created.
  for (const id of [devId, installedId]) {
    const opts = plain(s.pluginConfigs) && plain(s.pluginConfigs[id]) ? s.pluginConfigs[id].options : undefined;
    if (plain(opts) && Array.isArray(opts.jevLive)) {
      opts.jevLive = opts.jevLive.map((m) => String(m).trim()).filter((m) => m !== "").join(",");
      changed = true;
    }
  }
} else {
  if (s.pluginConfigs === undefined) { s.pluginConfigs = {}; changed = true; }
  const pc = s.pluginConfigs;
  if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
  for (const id of [devId, installedId]) {
    if (pc[id] === undefined) { pc[id] = {}; changed = true; }
    if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
    if (pc[id].options === undefined) { pc[id].options = {}; changed = true; }
    const opts = pc[id].options;
    if (!plain(opts)) fail("has " + id + " options that are not an object");
    if (opts.jevLive !== ids) { opts.jevLive = ids; changed = true; }
  }
}
if (!changed) process.exit(0);
const tmp = file + ".tmp-" + process.pid;
try {
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  fail("could not be rewritten: " + e.message);
}
' "$1" "$AGENTIC_PLUGIN_DEV_ID" "$AGENTIC_PLUGIN_INSTALLED_ID" "$ids_csv"
}
# --- ensure_settings_memory_gate_discard_percent ---
# Usage: ensure_settings_memory_gate_discard_percent <settings-file>
# Sibling to ensure_settings_jev_mode for the memory gate's confidence floor.
# Keyed on the raw roster variable, memoryGateDiscardPercent, and not on
# MEMORY_GATE_DISCARD_PERCENT, the defaulted 90 bin/supervise.sh reads for
# itself: that defaulted variable is always set, so keying on it would
# overwrite a value the operator wrote into the file by hand with the default
# on every launch that names none in the roster. Where memoryGateDiscardPercent
# is unset or empty the file is left alone, so a hand-edited floor survives a
# launch that says nothing about it. Where it is set, bin/supervise.sh has
# already checked it is a whole number in 50 to 100 before this runs, but the
# value is still held to digits here, the same defensive posture
# ensure_settings_jev_mode's own off|shadow check takes on JEV_MODE, since it
# is spliced into the file as a JSON number rather than a quoted string. The
# file is replaced by rename, same as its siblings, so an interrupted write
# never leaves it truncated.
ensure_settings_memory_gate_discard_percent() {
  if [ -z "${memoryGateDiscardPercent:-}" ]; then
    return 0
  fi
  case "$memoryGateDiscardPercent" in
    ''|*[!0-9]*)
      echo "ERROR: ensure_settings_memory_gate_discard_percent: memoryGateDiscardPercent '$memoryGateDiscardPercent' must be digits only" >&2
      return 1
      ;;
  esac
  node -e '
const fs = require("fs");
const [file, devId, installedId, value] = process.argv.slice(1);
const fail = (msg) => { console.error("ERROR: ensure_settings_memory_gate_discard_percent: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
let changed = false;
const n = Number(value);
if (s.pluginConfigs === undefined) { s.pluginConfigs = {}; changed = true; }
const pc = s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
for (const id of [devId, installedId]) {
  if (pc[id] === undefined) { pc[id] = {}; changed = true; }
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options === undefined) { pc[id].options = {}; changed = true; }
  const opts = pc[id].options;
  if (!plain(opts)) fail("has " + id + " options that are not an object");
  if (opts.memoryGateDiscardPercent !== n) { opts.memoryGateDiscardPercent = n; changed = true; }
}
if (!changed) process.exit(0);
const tmp = file + ".tmp-" + process.pid;
try {
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  fail("could not be rewritten: " + e.message);
}
' "$1" "$AGENTIC_PLUGIN_DEV_ID" "$AGENTIC_PLUGIN_INSTALLED_ID" "$memoryGateDiscardPercent"
}

# --- ensure_settings_cadences ---
# Usage: ensure_settings_cadences <settings-file>
# Sibling to ensure_settings_memory_gate_discard_percent for the three plugin
# cadences the roster carries: controllerTickMs, nudgeFloorMs and nudgeIdleMs.
# Keyed on those three raw roster variables, and not on TICK_MS, NUDGE_FLOOR_MS
# and NUDGE_IDLE_MS, the defaulted values bin/supervise.sh reads for itself:
# those are always set, so keying on them would overwrite a value the operator
# wrote into the file by hand with a default on every launch whose roster
# names none. Each key whose variable is set and non-empty is written as a
# number under both plugin ids, creating pluginConfigs, the id entry and its
# options object where absent, and every other option is left as written. A
# key whose variable is unset or empty is left as the file holds it, with one
# exception: where the roster names no nudgeFloorMs, an id's options holding
# nudgeFloorMs exactly 5000, the value earlier launchers emitted by default,
# are rewritten to the plugin's 300000 default. Any other floor value, and a
# missing one, is kept, and the correction creates no structure. A rewrite
# that makes the correction prints one line to stderr naming the file, which
# bin/supervise.sh sends to its log. Where nothing changes the file stays
# byte-identical. With none of the three set, a file the correction cannot
# read, or whose pluginConfigs, id entry or options is not an object, is left
# untouched and the call exits 0 without a word, since a correction is no
# reason to fail a launch. A correction whose rewrite fails also exits 0, with
# a WARNING line to stderr, and the file keeps its old value. Every set value
# is held, before node runs, to the shared numeric rule bin/supervise.sh's
# positive_number holds its millisecond settings to: digits only, no leading
# zero, at most 9 digits, at least 1. The rule is written out here because
# this library cannot call a function defined in its caller. bin/supervise.sh
# also checks all three at startup, controllerTickMs always and nudgeFloorMs
# and nudgeIdleMs where the roster sets them, so this check is the library's
# own guard rather than the launch's first. A value outside the rule is
# refused with an ERROR line naming the key and the rule, and no file is
# touched, because a value the plugin cannot run on would otherwise sit in
# the file for every later launch. The file is replaced by rename, same as its
# siblings, so an interrupted write never leaves it truncated.
ensure_settings_cadences() {
  local key
  for key in controllerTickMs nudgeFloorMs nudgeIdleMs; do
    [ -z "${!key:-}" ] && continue
    case "${!key}" in
      *[!0-9]*|0*|??????????*)
        echo "ERROR: ensure_settings_cadences: $key '${!key}' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
        return 1
        ;;
    esac
  done
  node -e '
const fs = require("fs");
const [file, devId, installedId, tick, floor, idle] = process.argv.slice(1);
const values = [["controllerTickMs", tick], ["nudgeFloorMs", floor], ["nudgeIdleMs", idle]].filter(([, v]) => v !== "");
// With no cadence set the only possible change is the floor correction, which
// never creates structure and never fails the launch.
const correctOnly = values.length === 0;
const fail = (msg) => { if (correctOnly) process.exit(0); console.error("ERROR: ensure_settings_cadences: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
let changed = false;
let corrected = false;
if (s.pluginConfigs === undefined) { if (correctOnly) process.exit(0); s.pluginConfigs = {}; changed = true; }
const pc = s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
for (const id of [devId, installedId]) {
  if (pc[id] === undefined) { if (correctOnly) continue; pc[id] = {}; changed = true; }
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options === undefined) { if (correctOnly) continue; pc[id].options = {}; changed = true; }
  const opts = pc[id].options;
  if (!plain(opts)) fail("has " + id + " options that are not an object");
  for (const [key, value] of values) {
    const n = Number(value);
    if (opts[key] !== n) { opts[key] = n; changed = true; }
  }
  if (floor === "" && opts.nudgeFloorMs === 5000) { opts.nudgeFloorMs = 300000; changed = true; corrected = true; }
}
if (!changed) process.exit(0);
const tmp = file + ".tmp-" + process.pid;
try {
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, file);
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  if (correctOnly) {
    console.error("WARNING: ensure_settings_cadences: " + file + " could not be rewritten to correct nudgeFloorMs 5000: " + e.message);
    process.exit(0);
  }
  fail("could not be rewritten: " + e.message);
}
if (corrected) console.error("ensure_settings_cadences: " + file + " nudgeFloorMs 5000 corrected to 300000");
' "$1" "$AGENTIC_PLUGIN_DEV_ID" "$AGENTIC_PLUGIN_INSTALLED_ID" "${controllerTickMs:-}" "${nudgeFloorMs:-}" "${nudgeIdleMs:-}"
}

# --- read_settings_controller_tick ---
# Usage: read_settings_controller_tick <settings-file> [dev_mode: 0|1, default 1]
# Prints the controllerTickMs a settings file carries under the plugin id the
# launch loads, picked by dev_mode exactly as in
# read_settings_coordinator_persona, so bin/supervise.sh sizes its probe window
# from the tick the child runs rather than from its own environment. A value
# is printed only where it is a whole number from 1 to 999999999, the range
# positive_number admits in bin/supervise.sh, so the window is sized from no
# tick the launch's own check would refuse. Anything
# else, a missing key under the loaded id included, prints nothing, and the
# caller keeps its own tick. Returns 1 on the same shapes
# read_settings_coordinator_persona refuses (not JSON, not an object, a
# pluginConfigs, id entry or options value that is not an object), with the
# same error-line shape, and prints nothing then.
read_settings_controller_tick() {
  local dev_mode="${2:-1}"
  local id="$AGENTIC_PLUGIN_INSTALLED_ID"
  if [ "$dev_mode" -eq 1 ]; then
    id="$AGENTIC_PLUGIN_DEV_ID"
  fi
  node -e '
const fs = require("fs");
const [file, id] = process.argv.slice(1);
const fail = (msg) => { console.error("ERROR: read_settings_controller_tick: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
const pc = s.pluginConfigs === undefined ? {} : s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
let value;
if (pc[id] !== undefined) {
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options !== undefined && !plain(pc[id].options)) fail("has " + id + " options that are not an object");
  if (plain(pc[id].options)) value = pc[id].options.controllerTickMs;
}
if (Number.isInteger(value) && value >= 1 && value <= 999999999) console.log(String(value));
' "$1" "$id"
}

# --- read_settings_coordinator_persona ---
# Usage: read_settings_coordinator_persona <settings-file> <dev_mode: 0|1>
# For a settings file the caller already provided: prints the coordinator
# persona name the plugin will resolve from it, so the caller can export
# COORDINATOR_PERSONA on the provided branch to the same value the emit
# branch exports. Only the options under the id the launch loads are read,
# dev_mode 1 being the --plugin-dir id and 0 the installed id, the same flag
# find_global_store takes: the plugin reads its own id's options and nothing
# under the other, and a file naming both ids is left as written by
# ensure_settings_plugin_ids, so the two may carry different values. The
# rule is the plugin's own (hooks/index.ts, the coordinatorPersona read): a
# string that is non-empty after trim, carries no ":" and is bracket-safe
# once trimmed (no "[", "]", ",", whitespace, control or format character),
# and is not "default", is taken trimmed; anything else resolves to
# "coordinator", a key missing under the loaded id included, whatever the
# other id carries. Returns 1 on the same shapes ensure_settings_plugin_ids
# refuses (not JSON, not an object, a pluginConfigs, id entry or options
# value that is not an object), with the same error-line shape, and prints
# nothing then.
read_settings_coordinator_persona() {
  local dev_mode="${2:-1}"
  local id="$AGENTIC_PLUGIN_INSTALLED_ID"
  if [ "$dev_mode" -eq 1 ]; then
    id="$AGENTIC_PLUGIN_DEV_ID"
  fi
  node -e '
const fs = require("fs");
const [file, id] = process.argv.slice(1);
const fail = (msg) => { console.error("ERROR: read_settings_coordinator_persona: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
const pc = s.pluginConfigs === undefined ? {} : s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
let value;
if (pc[id] !== undefined) {
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options !== undefined && !plain(pc[id].options)) fail("has " + id + " options that are not an object");
  if (plain(pc[id].options)) value = pc[id].options.coordinatorPersona;
}
const usable = typeof value === "string" && value.trim() !== "" && !value.includes(":")
  && !/[\[\],]/.test(value.trim()) && !/[\s\p{Cc}\p{Cf}]/u.test(value.trim());
console.log(usable && value.trim() !== "default" ? value.trim() : "coordinator");
' "$1" "$id"
}

# --- read_settings_architect_persona ---
# Usage: read_settings_architect_persona <settings-file> [dev_mode: 0|1, default 1]
# Prints the architectPersona a settings file the caller provided carries, so
# bin/supervise.sh can export ARCHITECT_PERSONA on the provided branch to the
# same value the emit branch exports. This read is not the key's only consumer:
# the plugin under hooks/ reads architectPersona from its own config too. The
# plugin id the launch loads is picked by dev_mode
# exactly as in read_settings_coordinator_persona. The name rule is
# valid_persona_name's own class, the one emit_settings_json holds
# ARCHITECT_PERSONA to: a string that after trim is a non-empty run of letters,
# digits, underscore and hyphen, and is not "default", is taken trimmed. The
# read side and the emit side hold one class because the value is spliced into
# the coordinator persona's standing instruction in bin/supervise.sh, at the
# agentic_say target and at the fleet row it names, and a settings file sits in
# a run directory the persona running there can rewrite. A missing key
# or an empty string prints the empty string, because this setting
# has no default: an empty result is a launch with no architect, on which no
# persona receives the architect's standing instruction. Returns 1 on the same shapes
# read_settings_coordinator_persona refuses, and on a present value outside the
# persona character class or naming "default", the two values emit_settings_json
# refuses, so a mis-set name is a refused launch named in the log rather than a
# fleet that comes up with no architect; the error-line shape is the same, and
# it prints nothing then. The rule itself lives in read_settings_seat_persona,
# which the liaison key's read shares.
read_settings_architect_persona() {
  read_settings_seat_persona read_settings_architect_persona architectPersona "$1" "${2:-1}"
}

# --- read_settings_liaison_persona ---
# Usage: read_settings_liaison_persona <settings-file> [dev_mode: 0|1, default 1]
# Prints the liaisonPersona a settings file the caller provided carries, so
# bin/supervise.sh can export LIAISON_PERSONA on the provided branch to the
# same value the emit branch exports. The plugin reads no liaison setting, so
# this read is the key's only consumer. It takes the architect key's rule
# through the same shared read: the loaded id alone, no default, a name outside
# the persona class or naming "default" refused with the value named, and the
# same refusals of a file that cannot hold options, each naming this function.
read_settings_liaison_persona() {
  read_settings_seat_persona read_settings_liaison_persona liaisonPersona "$1" "${2:-1}"
}

# --- read_settings_seat_persona ---
# Usage: read_settings_seat_persona <caller> <key> <settings-file> <dev_mode>
# The read the two named-seat keys share, architectPersona and liaisonPersona,
# so the rule a name spliced into a standing instruction is held to is written
# once. Reads <key> under the plugin id dev_mode picks, as
# read_settings_coordinator_persona does, prints the name trimmed, and prints
# the empty string for a missing key or an empty value, since neither seat has
# a default. Refuses, with ERROR lines opening "<caller>: <file>", the shapes
# read_settings_coordinator_persona refuses, a present value that is not a
# string, and a name outside valid_persona_name's class or naming "default".
read_settings_seat_persona() {
  local caller="$1" key="$2" dev_mode="${4:-1}"
  local id="$AGENTIC_PLUGIN_INSTALLED_ID"
  if [ "$dev_mode" -eq 1 ]; then
    id="$AGENTIC_PLUGIN_DEV_ID"
  fi
  node -e '
const fs = require("fs");
const [file, id, caller, key] = process.argv.slice(1);
const fail = (msg) => { console.error("ERROR: " + caller + ": " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
const pc = s.pluginConfigs === undefined ? {} : s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
let value;
if (pc[id] !== undefined) {
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options !== undefined && !plain(pc[id].options)) fail("has " + id + " options that are not an object");
  if (plain(pc[id].options)) value = pc[id].options[key];
}
if (value !== undefined && typeof value !== "string") fail("has " + (/^[aeiou]/i.test(key) ? "an " : "a ") + key + " that is not a string");
const name = typeof value === "string" ? value.trim() : "";
if (name !== "" && !/^[A-Za-z0-9_-]+$/.test(name)) fail("resolves " + key + " to \u0027" + name + "\u0027, which may hold only letters, digits, underscore and hyphen");
if (name === "default") fail("resolves " + key + " to \u0027default\u0027, and " + key + " must not be \u0027default\u0027");
console.log(name);
' "$3" "$id" "$caller" "$key"
}

# --- read_settings_fleet_roster ---
# Usage: read_settings_fleet_roster <settings-file> [dev_mode: 0|1, default 1]
# Prints the roster path the plugin will resolve from a settings file the caller
# provided, so the provided branch can read back what the emit branch writes.
# The plugin id the launch loads is picked by dev_mode exactly as in
# read_settings_coordinator_persona. The rule is the plugin's own
# (hooks/index.ts, the fleetRoster read): a string is taken trimmed, and
# anything else, a missing key under the loaded id included, resolves to the
# empty string, which is a launch with no fleet to read. There is no default
# path to fall back to, so an empty result is the whole of that state. Returns 1
# on the same shapes read_settings_coordinator_persona refuses (not JSON, not an
# object, a pluginConfigs, id entry or options value that is not an object),
# with the same error-line shape, and prints nothing then. Nothing in the
# launch calls this: it exists so the shell side can pin the plugin's rule
# under test, the supervisor needing no roster path of its own.
read_settings_fleet_roster() {
  local dev_mode="${2:-1}"
  local id="$AGENTIC_PLUGIN_INSTALLED_ID"
  if [ "$dev_mode" -eq 1 ]; then
    id="$AGENTIC_PLUGIN_DEV_ID"
  fi
  node -e '
const fs = require("fs");
const [file, id] = process.argv.slice(1);
const fail = (msg) => { console.error("ERROR: read_settings_fleet_roster: " + file + " " + msg); process.exit(1); };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let s;
try { s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { fail("is not valid JSON: " + e.message); }
if (!plain(s)) fail("is not a JSON object");
const pc = s.pluginConfigs === undefined ? {} : s.pluginConfigs;
if (!plain(pc)) fail("has a pluginConfigs value that is not an object");
let value;
if (pc[id] !== undefined) {
  if (!plain(pc[id])) fail("has a " + id + " entry that is not an object");
  if (pc[id].options !== undefined && !plain(pc[id].options)) fail("has " + id + " options that are not an object");
  if (plain(pc[id].options)) value = pc[id].options.fleetRoster;
}
console.log(typeof value === "string" ? value.trim() : "");
' "$1" "$id"
}

# --- valid_persona_name ---
# Usage: valid_persona_name <name>; returns 0 for a non-empty name of letters,
# digits, underscore and hyphen, 1 otherwise.
valid_persona_name() {
  case "$1" in
    ''|*[!A-Za-z0-9_-]*) return 1 ;;
  esac
  return 0
}

# --- find_global_store ---
# Plan item 6: the commons store's filename is load-mode-specific -
# "personas_inline-<hash>.json" under --plugin-dir, and
# "personas_<marketplace-name>-<hash>.json" for an installed plugin
# ("personas_applefeld-<hash>.json" for the applefeld marketplace this
# plugin ships in). The engine prefixes both with the manifest name. Once both load modes have ever run on one
# machine, both files can exist at once, and "take the first match"
# silently picks the wrong one for whichever mode this run is in. The
# caller's own dev_mode (whether --dev/--plugin-dir was given) says which
# glob is actually correct, so filter on it rather than guess.
# Single-sourced here for bin/supervise.sh, .kit/live-common.sh (and every
# live-*-test.sh through it), and any future caller - each used to carry
# its own copy, and a live-all.sh run caught the drift live: one caller's
# missing dev_mode filter resolved to the installed store while every
# child in the run used --plugin-dir, so the pre-gate read the wrong
# store's claims and let suites start inside each other's staleness window.
# Default is dev_mode=1: every .kit/*.sh caller runs under --plugin-dir,
# and bin/supervise.sh always passes its own DEV_MODE explicitly.
# The plugin was named agentic-plugin before it was named personas, and its
# installed id was personas@agent-persona before it moved into the applefeld
# marketplace, so a machine can hold a store under each earlier name. Each
# mode also reads those, and the first launch after either change passes the
# gate on the earlier file. A current store always wins once one exists.
# Where no name matches, this prints an empty line and the caller refuses as
# before.
# Usage: find_global_store [dev_mode: 0|1, default 1]
find_global_store() {
  local dev_mode="${1:-1}"
  local f
  if [ -d "$HOME/.claude/plugins/store" ]; then
    if [ "$dev_mode" -eq 1 ]; then
      for f in "$HOME/.claude/plugins/store"/personas_inline-*.json "$HOME/.claude/plugins/store"/agentic-plugin_inline-*.json; do
        if [ -f "$f" ]; then
          echo "$f"
          return 0
        fi
      done
    else
      # Installed mode: the first store list_installed_stores names, so
      # this branch and the runner's refuse-at-start check share one filter.
      f="$(list_installed_stores | head -n 1)"
      if [ -n "$f" ]; then
        echo "$f"
        return 0
      fi
    fi
  fi
  echo ""
  return 0
}

# --- list_installed_stores ---
# Prints every installed-mode commons store, one path per line: the store
# of the current installed id, personas_applefeld-*.json, then every other
# personas_*.json under the plugin store directory that is not an inline
# (dev-tree) store, which is the personas@agent-persona store where one
# remains, then each such agentic-plugin_*.json, the plugin's former name.
# This is the one filter that decides what counts as an installed store.
# find_global_store's installed branch takes the first line, so the current
# store wins once one exists and a supervisor never gates on the old file
# after the cutover, while the first launch before the migration passes the
# gate on the earlier one. .kit/live-all.sh's refuse-at-start check reads
# every line, so a session still running an earlier id is read too, and
# the two cannot drift apart. Prints nothing when the directory is absent
# or holds no such file. Reads $HOME at call time.
# Usage: list_installed_stores
list_installed_stores() {
  local f dir="$HOME/.claude/plugins/store"
  local current="${AGENTIC_PLUGIN_INSTALLED_ID%@*}_${AGENTIC_PLUGIN_INSTALLED_ID#*@}-"
  [ -d "$dir" ] || return 0
  for f in "$dir/$current"*.json; do
    [ -f "$f" ] && echo "$f"
  done
  for f in "$dir"/personas_*.json "$dir"/agentic-plugin_*.json; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in
      "$current"*|personas_inline-*|agentic-plugin_inline-*) continue ;;
    esac
    echo "$f"
  done
  return 0
}

# --- plugin_store_file_name ---
# Usage: plugin_store_file_name <plugin> <marketplace>
# Prints the name the engine gives an installed plugin's store file under
# ~/.claude/plugins/store: "<plugin>_<marketplace>-<hash>.json", where the
# hash is the first 12 hex digits of the SHA-256 of "<plugin>@<marketplace>".
# The source path and the config folder do not enter it. Computed here
# rather than written out, so the name follows the installed id on any
# machine. Returns 1, printing nothing, where node cannot run.
plugin_store_file_name() {
  local hash
  hash=$(node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0, 12))' "$1@$2") || return 1
  printf '%s_%s-%s.json\n' "$1" "$2" "$hash"
}

# --- copy_store_file ---
# Usage: copy_store_file <source> <destination>
# The one way a store file is copied: through a temporary name in the same
# directory, compared whole against the source, then renamed into place. A
# copy cut short, or one a full disk truncated, leaves no file under a store
# name. Prints a store-migration line and returns 1 where any step fails.
copy_store_file() {
  local tmp="$2.tmp-$$"
  if cp "$1" "$tmp" && cmp -s "$1" "$tmp" && mv "$tmp" "$2"; then
    return 0
  fi
  rm -f "$tmp"
  echo "store-migration: could not copy $1 to $2 whole; nothing under that name was written"
  return 1
}

# --- migrate_global_store ---
# Usage: migrate_global_store
# Copies the installed plugin's store file forward from the former installed
# id's name to the current one, so the first launch under personas@applefeld
# reads every inbox record and persona claim the old file holds. Runs from
# bin/supervise.sh before the pre-launch gate in installed mode, and from
# bin/migrate-store.sh at the cutover. Reads $HOME/.claude/plugins/store,
# the directory find_global_store reads. The old file is never written,
# moved or deleted: it is the rollback. An old file is one named
# personas_agent-persona-*.json, and the new one is the name
# plugin_store_file_name computes for the installed id. Prints one
# "store-migration:" line per fact read or file written. Returns 0 on every
# outcome below, and 1 only where a read or a write fails.
# - Several old files: nothing changes, and one line names them all, since
#   only one can be the source.
# - No old file: nothing changes.
# - An old file and no new one: the old file is copied to the new name, and
#   the marker personas-store-migrated.json is written beside it with the
#   time and both names. The marker is written after the copy is whole, so
#   a marker never stands for a copy that was cut short.
# - Both files and the marker: nothing changes.
# - Both files, no marker, and the new one holds no record and no persona
#   claim: the new file is renamed <name>.pre-migration, the old is copied
#   to the new name and the marker is written. This is the machine where
#   the new plugin ran once before the migration. A record is any key under
#   inbox:, ask: or reply:, the three prefixes hooks/operator.ts writes
#   records under (INBOX_PREFIX, ASK_PREFIX, REPLY_PREFIX), and a persona
#   claim is a member of a commons: entry's claims whose resource starts
#   with persona: (hooks/commons.ts, CommonsEntry). A claim counts whether
#   live or stale, since either says a persona ran under the new id.
# - Both files, no marker, and the new one holds a record or a claim:
#   nothing changes, and one line names both files.
# Before any case that writes, the old file is copied to
# personas-store-backup-<UTC date>.json in the same directory, once: a
# backup already there is kept where it equals the old file, and where it
# differs the call changes nothing, names both files and returns 1, since
# a backup that is not the old file is not a rollback. The backup is the
# rollback copy whatever later happens to the old file. A new file that
# cannot be parsed,
# or that is not a JSON object, is left alone and the call returns 1, since
# what it holds cannot be read. A .pre-migration file already in place is
# never overwritten: the call returns 1 and changes nothing.
migrate_global_store() {
  local dir="$HOME/.claude/plugins/store"
  local old_prefix="${AGENTIC_PLUGIN_FORMER_INSTALLED_ID%@*}_${AGENTIC_PLUGIN_FORMER_INSTALLED_ID#*@}-"
  if [ ! -d "$dir" ]; then
    echo "store-migration: no store directory at $dir; nothing changed"
    return 0
  fi
  local f old="" old_count=0 old_names=""
  for f in "$dir/$old_prefix"*.json; do
    [ -f "$f" ] || continue
    old_count=$((old_count + 1))
    old="$f"
    old_names="$old_names $(basename "$f")"
  done
  if [ "$old_count" -eq 0 ]; then
    echo "store-migration: no old store matches $dir/${old_prefix}*.json; nothing changed"
    return 0
  fi
  if [ "$old_count" -gt 1 ]; then
    echo "store-migration: $old_count old stores match ${old_prefix}*.json:${old_names}; nothing changed, since only one can be the source"
    return 0
  fi
  local marker="$dir/personas-store-migrated.json" new_name
  # A migrated machine reaches here on every installed launch. Its marker,
  # written below with the new file's name under "to", answers without the
  # node spawn the new name costs: where the marker names a file under the
  # current id's prefix and that file is present, the store was migrated
  # and nothing changes. Any other marker falls through to the full read.
  if [ -f "$marker" ]; then
    local marked_to
    marked_to=$(sed -n 's/.*"to":"\([^"\/]*\)".*/\1/p' "$marker" 2>/dev/null | head -n 1)
    case "$marked_to" in
      "${AGENTIC_PLUGIN_INSTALLED_ID%@*}_${AGENTIC_PLUGIN_INSTALLED_ID#*@}-"*.json)
        if [ -f "$dir/$marked_to" ]; then
          echo "store-migration: old=$old"
          echo "store-migration: new=$dir/$marked_to"
          echo "store-migration: marker=$marker is present, so the store was migrated; nothing changed"
          return 0
        fi
        ;;
    esac
  fi
  # The new name costs a node spawn, so it is computed only once there is
  # one old file to copy and no marker has answered.
  if ! new_name=$(plugin_store_file_name "${AGENTIC_PLUGIN_INSTALLED_ID%@*}" "${AGENTIC_PLUGIN_INSTALLED_ID#*@}"); then
    echo "store-migration: could not compute the store name for $AGENTIC_PLUGIN_INSTALLED_ID; nothing changed"
    return 1
  fi
  local new="$dir/$new_name"
  local backup="$dir/personas-store-backup-$(date -u +%Y-%m-%d).json"
  echo "store-migration: old=$old"
  echo "store-migration: new=$new"
  local keep_new=0
  if [ -f "$new" ]; then
    if [ -f "$marker" ]; then
      echo "store-migration: marker=$marker is present, so the store was migrated; nothing changed"
      return 0
    fi
    local new_w held
    new_w=$(cygpath -m "$new" 2>/dev/null || echo "$new")
    held=$(node -e '
const fs = require("fs");
let s;
try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8").replace(/^\uFEFF/, "")); } catch (e) { console.log("ERROR " + e.message); process.exit(0); }
if (s === null || typeof s !== "object" || Array.isArray(s)) { console.log("ERROR the file is not a JSON object"); process.exit(0); }
let records = 0, claims = 0;
for (const key of Object.keys(s)) {
  if (key.startsWith("inbox:") || key.startsWith("ask:") || key.startsWith("reply:")) { records++; continue; }
  if (!key.startsWith("commons:")) continue;
  const entry = s[key];
  if (!entry || !Array.isArray(entry.claims)) continue;
  for (const c of entry.claims) if (c && typeof c.resource === "string" && c.resource.startsWith("persona:")) claims++;
}
console.log(records === 0 && claims === 0 ? "EMPTY" : "HELD " + records + " inbox, ask or reply record(s) and " + claims + " persona claim(s)");
' "$new_w")
    case "$held" in
      EMPTY) keep_new=1 ;;
      HELD\ *)
        echo "store-migration: $new holds ${held#HELD }, so the old store was not copied over it; nothing changed. old=$old new=$new"
        return 0
        ;;
      *)
        echo "store-migration: $new could not be read (${held#ERROR }), so what it holds is unknown; nothing changed"
        return 1
        ;;
    esac
    if [ -e "$new.pre-migration" ]; then
      echo "store-migration: $new.pre-migration is already present, so the new store has nowhere to go; nothing changed"
      return 1
    fi
  fi
  if [ -f "$backup" ]; then
    if ! cmp -s "$old" "$backup"; then
      echo "store-migration: $backup is already present and differs from $old, so it is not the rollback; nothing changed"
      return 1
    fi
    echo "store-migration: backup=$backup (already present and equal to the old file, kept)"
  else
    copy_store_file "$old" "$backup" || return 1
    echo "store-migration: backup=$backup"
  fi
  if [ "$keep_new" -eq 1 ]; then
    if ! mv "$new" "$new.pre-migration"; then
      echo "store-migration: could not rename $new to $new.pre-migration; the old store was not copied"
      return 1
    fi
    echo "store-migration: kept the new store, which held no record and no claim, as $new.pre-migration"
  fi
  copy_store_file "$old" "$new" || return 1
  echo "store-migration: copied $old to $new"
  local marker_tmp="$marker.tmp-$$"
  if printf '{"migratedAt":"%s","from":"%s","to":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$old")" "$new_name" > "$marker_tmp" && mv "$marker_tmp" "$marker"; then
    echo "store-migration: marker=$marker"
    return 0
  fi
  rm -f "$marker_tmp"
  echo "store-migration: the store was copied but the marker $marker could not be written; the next run will read the new store as unmigrated"
  return 1
}

# --- installed_id_cutover_done ---
# Usage: installed_id_cutover_done
# Reads $HOME/.claude/plugins/installed_plugins.json, the engine's record of
# the installed plugins, keyed by installed id under its plugins object, and
# prints one store-migration line saying whether the move to the current
# installed id is complete: the file lists AGENTIC_PLUGIN_INSTALLED_ID with
# at least one install record and lists AGENTIC_PLUGIN_FORMER_INSTALLED_ID
# with none. Returns 0 only then. The engine loads the earlier-registered
# plugin named personas and not the later one, so while the former id is
# still installed the plugin that loads is the old one, which keeps writing
# the old store, and a copy taken then would be kept as stale by the marker.
# bin/supervise.sh runs the migration only behind this check. An absent
# file, one that cannot be read or parsed, or one with no plugins object
# returns 1 with the reason on the line, the side on which nothing is
# copied. The readings mirror the module's own read of this file for the
# kit's install path (hooks/index.ts, kitInstallPathOf).
installed_id_cutover_done() {
  local file="$HOME/.claude/plugins/installed_plugins.json" file_w line
  file_w=$(cygpath -m "$file" 2>/dev/null || echo "$file")
  line=$(node -e '
const fs = require("fs");
const [file, currentId, formerId] = process.argv.slice(1);
const no = (why) => { console.log("NO " + why); process.exit(0); };
let text;
try { text = fs.readFileSync(file, "utf8"); } catch (e) { no(e && e.code === "ENOENT" ? "installed_plugins.json is absent" : "installed_plugins.json could not be read: " + String(e && e.message).slice(0, 150)); }
let s;
try { s = JSON.parse(text.replace(/^\uFEFF/, "")); } catch (e) { no("installed_plugins.json is not JSON"); }
const plugins = s !== null && typeof s === "object" && !Array.isArray(s) ? s.plugins : undefined;
if (plugins === null || typeof plugins !== "object" || Array.isArray(plugins)) no("installed_plugins.json has no plugins object");
const listed = (id) => Object.prototype.hasOwnProperty.call(plugins, id) && Array.isArray(plugins[id]) && plugins[id].length > 0;
if (!listed(currentId)) no("installed_plugins.json does not list " + currentId);
if (listed(formerId)) no("installed_plugins.json still lists " + formerId + ", which loads ahead of " + currentId + " until it is uninstalled");
console.log("YES installed_plugins.json lists " + currentId + " and no longer lists " + formerId);
' "$file_w" "$AGENTIC_PLUGIN_INSTALLED_ID" "$AGENTIC_PLUGIN_FORMER_INSTALLED_ID")
  case "$line" in
    YES\ *)
      echo "store-migration: ${line#YES }"
      return 0
      ;;
    NO\ *)
      echo "store-migration: skipped, ${line#NO }"
      return 1
      ;;
    *)
      echo "store-migration: skipped, installed_plugins.json could not be checked ($line)"
      return 1
      ;;
  esac
}
# --- wait_persona_free ---
# T9/V3: pre-gate - wait until no live persona claim exists in the commons store.
# Fails closed on a read error (V3). Prints live=/oldest_age= per poll (V3).
# W2: a read error is a transient mid-write race, not an abort.
# A store that fails to parse is aged by its modification time: past the 90 s
# stale bound it is set aside by set_aside_store and the gate passes, and
# inside the bound it reads as a transient error and polls to the timeout.
# The bound reaches the program as an argument, not as spliced text.
# A store path with no file at it, at the start or at a later poll, reads as
# free with one line naming the path as absent: the live runner's start check
# sets a stale store aside before the first gate, so an absent path means a
# set-aside, not a store that was never there.
# Usage: wait_persona_free <store-path> [timeout-seconds]
wait_persona_free() {
  local store="${1:-.agentic-personas.json}"
  local timeout="${2:-120}"
  local n=0
  local store_w
  store_w=$(cygpath -m "$store" 2>/dev/null || echo "$store")
  echo "pre-gate: waiting for no live persona claim (store: $store, timeout: ${timeout}s)..."
  while true; do
    local line live rc
    if [ ! -e "$store" ]; then
      echo "pre-gate: commons store absent at $store, read as free"
      echo "pre-gate passed (no live claims)"
      return 0
    fi
    line=$(node -e "
const fs = require('fs');
const stale = Number(process.argv[2]);
let text;
try {
  text = fs.readFileSync(process.argv[1], 'utf8');
} catch (e) {
  console.log('ERROR: ' + e.message);
  process.exit(2);
}
let s;
try {
  s = JSON.parse(text);
} catch (e) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(process.argv[1]).mtimeMs;
  } catch (se) {
    console.log('ERROR: ' + se.message);
    process.exit(2);
  }
  const ageMs = Date.now() - mtimeMs;
  if (ageMs > stale) {
    console.log('UNREADABLE-STALE ' + Math.round(ageMs / 1000) + ' ' + Math.round(stale / 1000));
    process.exit(3);
  }
  console.log('UNREADABLE-FRESH ' + Math.round(ageMs / 1000));
  process.exit(2);
}
const keys = Object.keys(s).filter(k => k.startsWith('commons:'));
const now = Date.now();
let live = 0, oldest = 0;
for (const key of keys) {
  const e = s[key];
  if (e.lastSeen && (now - e.lastSeen) < stale && e.claims) {
    for (const c of e.claims) {
      if (c.resource === 'persona:default') { live++; if (oldest === 0 || e.lastSeen < oldest) oldest = e.lastSeen; }
    }
  }
}
console.log('live=' + live + ' oldest_age=' + (oldest ? Math.round((now - oldest) / 1000) : 0) + 's');
" "$store_w" 90000)
    rc=$?
    if [ $rc -eq 3 ]; then
      set_aside_store "$store" "$line" || return 1
      echo "pre-gate passed (no live claims)"
      return 0
    fi
    if [ $rc -ne 0 ] || echo "$line" | grep -q '^ERROR'; then
      # W2: a read error is a transient mid-write race, not an abort.
      # Treat as live=1 for this poll and let the timeout be the only exit.
      echo "pre-gate poll: ERROR (transient read error, retrying): $line"
      n=$((n + 5))
      [ $n -ge $timeout ] && { echo "pre-gate timeout after ${n}s (last: $line)"; return 1; }
      sleep 5
      continue
    fi
    live=$(echo "$line" | sed -n 's/.*live=\([0-9]*\).*/\1/p')
    echo "pre-gate poll: $line"
    if [ "${live:-0}" = "0" ]; then
      echo "pre-gate passed (no live claims)"
      return 0
    fi
    n=$((n + 5))
    [ $n -ge $timeout ] && { echo "pre-gate timeout after ${n}s ($line)"; return 1; }
    sleep 5
  done
}

# --- set_aside_store ---
# The set-aside step the three store readers share. A commons store that fails to
# parse and was last written longer ago than the stale bound has no live
# writer, so it is renamed to <path>.corrupt-<epoch ms> beside itself, never
# deleted, and the caller reads the path as free. Takes the reader's verdict
# line, "UNREADABLE-STALE <age-seconds> <bound-seconds>". Prints one line
# either way. A rename that fails with no file left at the path returns 0,
# and the caller reads the path as free. The usual cause is another reader
# that set the same file aside first. A rename that fails with the file still
# in place returns 1, so the caller fails closed on a file it could not move
# rather than reading it as free.
# Usage: set_aside_store <store-path> <verdict-line>
set_aside_store() {
  local store="$1" verdict="$2" age bound aside err
  age=$(echo "$verdict" | sed -n 's/^UNREADABLE-STALE \([^ ]*\) .*/\1/p')
  bound=$(echo "$verdict" | sed -n 's/^UNREADABLE-STALE [^ ]* \(.*\)/\1/p')
  aside="$store.corrupt-$(date +%s%3N)"
  if err=$(mv -- "$store" "$aside" 2>&1); then
    echo "store set aside: $store -> $aside (unreadable, last written ${age}s ago, past the ${bound}s stale bound)"
    return 0
  fi
  if [ ! -e "$store" ]; then
    echo "store already set aside by another reader: $store"
    return 0
  fi
  echo "store set-aside failed: could not rename $store -> $aside${err:+: $err}"
  return 1
}

# --- refuse_if_persona_live ---
# Start-only refuse-at-start check, beside wait_persona_free's own wait.
# Reads every given store path once, with no polling, and refuses the moment
# any store holds a live persona: claim of any name (a commons: key whose
# lastSeen is within stale_after_ms, holding a claim whose resource starts
# with "persona:"). A store path that does not exist is skipped (installed
# mode may never have run on this machine). A store that fails to parse and
# was last written longer ago than stale_after_ms has no live writer: it is
# set aside under a .corrupt-<time> name beside it, with one line saying so,
# and counts as read and free. A rename that fails with the file still in
# place is a refusal. A store whose read fails, or that fails to parse and was
# written inside the bound, is re-read up to two more times,
# with no sleep between reads, before it counts as a failure: the failure may
# be a mid-write race by a live session, and a start-only check has no later
# poll to recover on, so after three reads it fails closed the same way a
# live claim does. A stale bound that is not a positive
# number is refused immediately, on the first read, with no re-read (a
# malformed bound reads the same way every time). Reading zero stores end
# to end is itself a refusal, since a check that read nothing proved
# nothing clean. The caller decides the exit code; this function only
# returns and prints, it never exits the shell.
# Usage: refuse_if_persona_live <stale_after_ms> <store-path>...
refuse_if_persona_live() {
  local stale_after_ms="$1"
  shift
  local store checked=0
  for store in "$@"; do
    [ -n "$store" ] || continue
    if [ ! -f "$store" ]; then
      echo "refuse-check: store not present, skipping: $store"
      continue
    fi
    local store_w line rc attempt
    store_w=$(cygpath -m "$store" 2>/dev/null || echo "$store")
    for attempt in 1 2 3; do
      line=$(node -e "
const fs = require('fs');
const staleAfterMs = Number(process.argv[2]);
if (!Number.isFinite(staleAfterMs) || !(staleAfterMs > 0)) {
  console.log('ERROR: stale bound is not a positive number: ' + process.argv[2]);
  process.exit(2);
}
let text;
try {
  text = fs.readFileSync(process.argv[1], 'utf8');
} catch (e) {
  console.log('ERROR: ' + e.message);
  process.exit(2);
}
let s;
try {
  s = JSON.parse(text);
} catch (e) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(process.argv[1]).mtimeMs;
  } catch (se) {
    console.log('ERROR: ' + se.message);
    process.exit(2);
  }
  const ageMs = Date.now() - mtimeMs;
  if (ageMs > staleAfterMs) {
    console.log('UNREADABLE-STALE ' + Math.round(ageMs / 1000) + ' ' + Math.round(staleAfterMs / 1000));
    process.exit(3);
  }
  console.log('UNREADABLE-FRESH ' + Math.round(ageMs / 1000));
  process.exit(2);
}
const keys = Object.keys(s).filter(k => k.startsWith('commons:'));
const now = Date.now();
for (const key of keys) {
  const e = s[key];
  if (!e) continue;
  if (e.lastSeen !== undefined && e.lastSeen !== null && (typeof e.lastSeen !== 'number' || !Number.isFinite(e.lastSeen))) {
    console.log('ERROR: lastSeen is not a number under ' + key);
    process.exit(2);
  }
  if (e.lastSeen && (now - e.lastSeen) < staleAfterMs && Array.isArray(e.claims)) {
    for (const c of e.claims) {
      if (c && typeof c.resource === 'string' && c.resource.indexOf('persona:') === 0) {
        console.log('LIVE ' + c.resource + ' ' + Math.round((now - e.lastSeen) / 1000));
        process.exit(0);
      }
    }
  }
}
console.log('CLEAN');
" "$store_w" "$stale_after_ms")
      rc=$?
      if echo "$line" | grep -q '^ERROR: stale bound is not a positive number:'; then
        echo "refuse-check FAIL: ${line#ERROR: }"
        return 1
      fi
      if [ $rc -eq 0 ] && ! echo "$line" | grep -q '^ERROR'; then
        break
      fi
      # A stale unreadable store reads the same way every time, so it takes
      # no re-read.
      [ $rc -eq 3 ] && break
    done
    if [ $rc -eq 3 ]; then
      if set_aside_store "$store" "$line"; then
        checked=$((checked + 1))
        continue
      fi
      echo "refuse-check FAIL: store unreadable and could not be set aside: $store"
      return 1
    fi
    if [ $rc -ne 0 ] || echo "$line" | grep -q '^ERROR'; then
      echo "refuse-check FAIL: store could not be read after 3 attempts (a mid-write race or a corrupt file): $store ($line)"
      return 1
    fi
    case "$line" in
      LIVE\ *)
        local resource age
        resource=$(echo "$line" | sed -n 's/^LIVE \([^ ]*\) .*/\1/p')
        age=$(echo "$line" | sed -n 's/^LIVE [^ ]* \(.*\)/\1/p')
        echo "refuse-check FAIL: live persona claim in $store: $resource (age ${age}s)"
        return 1
        ;;
    esac
    checked=$((checked + 1))
  done
  if [ "$checked" -eq 0 ]; then
    echo "refuse-check FAIL: no store was read (every path was empty or missing)"
    return 1
  fi
  echo "refuse-check passed ($checked store(s) read, no live persona claim)"
  return 0
}

# --- wait_persona_free_both ---
# AD2: Wait for the persona to be free in BOTH the commons store AND the
# per-directory heartbeat. The commons check ensures no machine-global claim;
# the heartbeat check ensures the local holder is stale (lastSeen older than
# staleAfterMs) or absent.
# Usage: wait_persona_free_both <workdir> <persona> <timeout-seconds> <stale_after_ms> <global_store>
wait_persona_free_both() {
  local workdir="$1"
  local persona="${2:-default}"
  local timeout="${3:-120}"
  local stale_after_ms="${4:-90000}"
  local global_store="$5"
  local n=0
  local heartbeat_path="$workdir/.agentic-heartbeat.json"
  local absent_logged=false

  echo "pre-gate: waiting for persona '$persona' free in commons AND heartbeat (timeout: ${timeout}s)..."

  while true; do
    # Check 1: commons store (machine-global)
    local commons_ok=false
    # A non-empty store path with no file at it holds no claim and reads as
    # free, logged on the first poll that finds it so. A set-aside leaves its
    # path that way for the rest of the gate's polls. An empty store argument
    # names no path and stays not free.
    if [ -n "$global_store" ] && [ ! -e "$global_store" ]; then
      commons_ok=true
      if ! $absent_logged; then
        echo "commons store absent at $global_store, read as free"
        absent_logged=true
      fi
    fi
    if [ -n "$global_store" ] && [ -f "$global_store" ]; then
      local line live rc
      # The persona and the stale bound are passed as arguments rather than
      # spliced into the program text, so a value carrying JavaScript is data
      # the program reads instead of code it runs. A bound that is not a
      # number reads as NaN, which the program takes as no bound at all and
      # counts every claim as live, so the gate waits rather than passing on
      # a bad bound. A store that fails to parse is aged by its modification
      # time: past the bound it exits 3 and is set aside, and inside the bound
      # it exits 2 and reads as not free. A store whose read fails exits 2
      # with no aging, since a file being replaced can fail to open while it
      # still carries an old modification time. Under a bound that is not a number
      # the age comparison is false, so an unreadable store reads as not free.
      line=$(node -e "
const fs = require('fs');
const staleAfterMs = Number(process.argv[3]);
let text;
try {
  text = fs.readFileSync(process.argv[1], 'utf8');
} catch (e) {
  console.log('ERROR: ' + e.message);
  process.exit(2);
}
let s;
try {
  s = JSON.parse(text);
} catch (e) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(process.argv[1]).mtimeMs;
  } catch (se) {
    console.log('ERROR: ' + se.message);
    process.exit(2);
  }
  const ageMs = Date.now() - mtimeMs;
  if (ageMs > staleAfterMs) {
    console.log('UNREADABLE-STALE ' + Math.round(ageMs / 1000) + ' ' + Math.round(staleAfterMs / 1000));
    process.exit(3);
  }
  console.log('UNREADABLE-FRESH ' + Math.round(ageMs / 1000));
  process.exit(2);
}
const persona = process.argv[2];
const bounded = !Number.isNaN(staleAfterMs);
const keys = Object.keys(s).filter(k => k.startsWith('commons:'));
const now = Date.now();
let live = 0;
for (const key of keys) {
  const e = s[key];
  if (e.lastSeen && (!bounded || (now - e.lastSeen) < staleAfterMs) && e.claims) {
    for (const c of e.claims) {
      if (c.resource === 'persona:' + persona) { live++; }
    }
  }
}
console.log('live=' + live);
" "$global_store" "$persona" "$stale_after_ms" 2>/dev/null)
      rc=$?
      if [ $rc -eq 3 ]; then
        set_aside_store "$global_store" "$line" && commons_ok=true
      elif [ $rc -eq 0 ] && ! echo "$line" | grep -q '^ERROR'; then
        live=$(echo "$line" | sed -n 's/.*live=\([0-9]*\).*/\1/p')
        if [ "${live:-1}" = "0" ]; then
          commons_ok=true
        fi
      fi
    fi
    
    # Check 2: per-directory heartbeat
    local heartbeat_ok=false
    if [ ! -f "$heartbeat_path" ]; then
      heartbeat_ok=true
    else
      local hb_status
      # The persona and the stale bound are passed as arguments rather than
      # spliced into the program text, so a value carrying JavaScript is data
      # the program reads instead of code it runs. A bound that is not a
      # number reads as NaN, every comparison against it is false, and the
      # holder is treated as live, so the gate waits rather than passing on
      # a bad bound.
      hb_status=$(node -e "
const fs = require('fs');
let hb;
try {
  hb = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
} catch (e) {
  console.log('ERROR: ' + e.message);
  process.exit(2);
}
const staleAfterMs = Number(process.argv[2]);
const entry = hb[process.argv[3]];
if (!entry) {
  console.log('absent');
} else {
  const age = Date.now() - entry.lastSeen;
  console.log(age > staleAfterMs ? 'stale:' + Math.round(age / 1000) + 's' : 'live:' + Math.round(age / 1000) + 's');
}
" "$heartbeat_path" "$stale_after_ms" "$persona" 2>/dev/null)
      if echo "$hb_status" | grep -q '^stale\|^absent'; then
        heartbeat_ok=true
      fi
    fi
    
    # Log which conditions are satisfied
    local commons_msg="FAIL" heartbeat_msg="FAIL"
    $commons_ok && commons_msg="OK"
    $heartbeat_ok && heartbeat_msg="OK"
    echo "pre-gate poll: commons=$commons_msg heartbeat=$heartbeat_msg"
    
    if $commons_ok && $heartbeat_ok; then
      echo "pre-gate passed (commons and heartbeat both free)"
      return 0
    fi
    
    n=$((n + 5))
    [ $n -ge $timeout ] && { echo "pre-gate timeout after ${n}s (commons=$commons_msg heartbeat=$heartbeat_msg)"; return 1; }
    sleep 5
  done
}

# --- newest_handle ---
# The pre-launch gate's handle branch. Prints the name of the child directory
# (child-<n>) holding the newest <rundir>/child-*/handle.json, newest by the
# launchedAt timestamp inside it rather than by file mtime, since child
# directories are reused across supervisor runs. The name and not the path,
# because node on this box prints a joined path with backslashes, which no
# POSIX parameter expansion parses; the caller builds the path in bash. Prints
# nothing where no readable handle exists. Never throws: an unreadable or
# malformed handle is skipped.
# Usage: newest_handle <rundir>
newest_handle() {
  local rundir="$1"
  [ -n "$rundir" ] || return 0
  node -e '
const fs = require("fs");
const path = require("path");
const rundir = process.argv[1];
let best = null;
let bestAt = -Infinity;
const seen = [];
let entries = [];
try { entries = fs.readdirSync(rundir); } catch (e) { process.exit(0); }
for (const name of entries) {
  if (!/^child-\d+$/.test(name)) continue;
  const p = path.join(rundir, name, "handle.json");
  let h;
  try { h = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { continue; }
  const at = Number(h.launchedAt);
  if (!Number.isFinite(at)) continue;
  seen.push({ name, at });
  if (at > bestAt) { bestAt = at; best = name; }
}
// Every older handle passed over is named on stderr, one per line, so the
// caller can log which child directories still hold a handle nobody has
// accounted for.
for (const s of seen) { if (s.name !== best) console.error("OLDER " + s.name); }
if (best) console.log(best);
' "$rundir"
}

# --- read_handle_fields ---
# Every field of a handle.json in one read, printed as `key<TAB>value` lines,
# so a gate that reads a handle reads one moment of it rather than one file
# read per field with room for a rewrite between them. A field that is absent
# or null prints an empty value. Never throws: an unreadable handle prints
# nothing.
# Usage: read_handle_fields <handle-file>
read_handle_fields() {
  [ -f "$1" ] || return 0
  node -e '
const fs = require("fs");
let h;
try { h = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { process.exit(0); }
const keys = ["sessionId", "holderPid", "holderWinPid", "holderTicks", "childPid", "childWinPid", "childTicks", "supervisorWinPid", "supervisorTicks", "launchedAt"];
for (const k of keys) {
  const v = h[k];
  process.stdout.write(k + "\t" + (v === undefined || v === null ? "" : String(v)).replace(/[\r\n\t]/g, " ") + "\n");
}
' "$1" 2>/dev/null
}

# --- handle_field ---
# One top-level field of a handle.json, read through a JSON parser rather than a
# grep so a value carrying JSON is data. Prints the value, or nothing where the
# handle is unreadable or the field is absent or null.
# Usage: handle_field <handle-file> <field>
handle_field() {
  local file="$1" field="$2"
  [ -f "$file" ] || return 0
  node -e '
const fs = require("fs");
try {
  const h = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const v = h[process.argv[2]];
  if (v !== undefined && v !== null) console.log(v);
} catch (e) {}
' "$file" "$field" 2>/dev/null
}

# --- poll_decisions ---
# Read the decision log from .agentic-personas.json for a given persona key.
# W2: a read error returns "ERROR" and no decisions (treat as not-ready).
# Usage: poll_decisions <store-path> [persona-key]
# Prints JSON: {"decisions":[...], "error": null|"msg"}
poll_decisions() {
  local store="${1:-.agentic-personas.json}"
  local persona="${2:-default}"
  local store_w
  store_w=$(cygpath -m "$store" 2>/dev/null || echo "$store")
  node -e "
const fs = require('fs');
let s;
try {
  s = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
} catch (e) {
  console.log(JSON.stringify({decisions: [], error: e.message}));
  process.exit(0);
}
const key = process.argv[2];
const p = s[key];
if (!p) {
  console.log(JSON.stringify({decisions: [], error: 'persona not found'}));
  process.exit(0);
}
console.log(JSON.stringify({decisions: p.decisions || [], error: null}));
" "$store_w" "$persona"
}

# --- poll_heartbeat ---
# Read the heartbeat sidecar (.agentic-heartbeat.json) for a given persona key.
# W2: a read error returns "ERROR" (treat as not-ready).
# Usage: poll_heartbeat <heartbeat-path> [persona-key]
# Prints JSON: {"sessionId": "...", "epoch": N, "lastSeen": N, "error": null|"msg"}
poll_heartbeat() {
  local hb_path="${1:-.agentic-heartbeat.json}"
  local persona="${2:-default}"
  local hb_w
  hb_w=$(cygpath -m "$hb_path" 2>/dev/null || echo "$hb_path")
  node -e "
const fs = require('fs');
let hb;
try {
  hb = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
} catch (e) {
  console.log(JSON.stringify({sessionId: null, epoch: 0, lastSeen: null, error: e.message}));
  process.exit(0);
}
const key = process.argv[2];
const e = hb[key];
if (!e) {
  console.log(JSON.stringify({sessionId: null, epoch: 0, lastSeen: null, error: 'persona not in heartbeat'}));
  process.exit(0);
}
console.log(JSON.stringify({sessionId: e.sessionId, epoch: e.epoch, lastSeen: e.lastSeen, error: null}));
" "$hb_w" "$persona"
}
