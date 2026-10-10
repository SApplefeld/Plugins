#!/usr/bin/env bash
# bin/supervise.sh - Supervisor loop for days-long persona runs.
#
# Usage: bin/supervise.sh <workdir> <persona> <permission-mode> [--prompt TEXT] [--rundir DIR] [--dev] [--no-channel] [--channel-name NAME]
#
# The priming turn's skill-load instruction (SKILL_LOAD_INSTRUCTION in bin/supervise-holder.sh)
# assumes the kit plugin is installed globally on the host running this
# script, and names the kit's skills by their plugin-qualified names under
# grimoire.
#
# By default the child loads personas as an installed plugin (plan
# item 6: the target runtime, installed from this repo's own marketplace
# manifest). Pass --dev to load it from this checkout instead via
# --plugin-dir, for working on the plugin's own code.
#
# By default the child is also directly reachable from Discord (plan item
# 5: the native channel, no proxy session): --channels loads the relay
# plugin installed as relay@$AGENTIC_MARKETPLACE, and the launch refuses
# where installed_plugins.json lists no such entry. CHANNEL_SESSION names
# the thread (stable across restarts so the whole supervisor lifetime is
# one conversation), and a fresh CHANNEL_PROCESS_TOKEN is minted per
# child. Pass --no-channel to skip this (a scratch/proof run with no
# Discord side effects).
#
# Exit codes:
#   0 = shutdown_requested honored
#   1 = usage, a setting refused at startup, a store migration that did
#       not complete before the gate, or a relay not installed under the
#       public marketplace
#   2 = no commons store for the load mode, or pre-launch gate timeout
#   3 = crash loop
#   4 = restart budget exhausted
#   5 = stopped, but a process from the child is alive or unverifiable
#       despite every retry
#   6 = park_requested honored: the keeper's next start launches the persona
#       again

set -u
set -o pipefail

# --- Parse arguments ---
if [ $# -lt 3 ]; then
  echo "Usage: bin/supervise.sh <workdir> <persona> <permission-mode> [--prompt TEXT] [--rundir DIR] [--dev]" >&2
  exit 1
fi

ORIG_PWD="$(pwd)"

WORKDIR="$1"
PERSONA="$2"
PERMISSION_MODE="$3"
shift 3

# The persona is spliced into the child's settings JSON, so it is held to
# the same shape valid_persona_name enforces in
# bin/agentic-common.sh, checked here before anything touches the disk.
case "$PERSONA" in
  ''|*[!A-Za-z0-9_-]*)
    echo "ERROR: persona '$PERSONA' may hold only letters, digits, underscore and hyphen" >&2
    exit 1
    ;;
esac

PROMPT=""
RUNDIR=""
DEV_MODE=0
NO_CHANNEL=0
CHANNEL_NAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --prompt)
      PROMPT="$2"
      shift 2
      ;;
    --rundir)
      RUNDIR="$2"
      shift 2
      ;;
    --dev)
      DEV_MODE=1
      shift 1
      ;;
    --no-channel)
      NO_CHANNEL=1
      shift 1
      ;;
    --channel-name)
      CHANNEL_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# --- Resolve workdir to an absolute path, then change into it (plan item 1) ---
# The plugin's hooks resolve their store and heartbeat sidecar paths relative
# to the child process's own cwd, while this script's poll loop reads them as
# "$WORKDIR/...". Launching the supervisor from anywhere but WORKDIR used to
# split those two: the child wrote its store next to wherever the caller's
# shell happened to be, and the poll loop kept reading an empty WORKDIR. The
# supervisor now owns that cd itself, so any caller cwd works.
if [ ! -d "$WORKDIR" ]; then
  echo "workdir not found: $WORKDIR" >&2
  exit 1
fi
WORKDIR="$(cd "$WORKDIR" && pwd)"

# A --rundir given as a relative path is relative to the caller's original
# cwd, not to WORKDIR: resolve it before the cd below changes what "relative"
# means. The default rundir (unset here) is computed from WORKDIR after the cd.
if [ -n "$RUNDIR" ]; then
  case "$RUNDIR" in
    /*) : ;;  # already absolute
    *) RUNDIR="$ORIG_PWD/$RUNDIR" ;;
  esac
fi

cd "$WORKDIR"

# Plan item 5: one Discord thread for the supervisor's whole lifetime, not
# one per child. CHANNEL_SESSION is the broker's binding key and must stay
# identical across every child a restart launches; only CHANNEL_PROCESS_TOKEN
# (minted per launch, below) changes. Default derived from the persona so two
# supervisors on one machine don't collide on one thread name.
if [ -z "$CHANNEL_NAME" ]; then
  CHANNEL_NAME="supervisor-$PERSONA"
fi

# The shared check for the numeric settings this script reads itself. The
# plugin values further down are, with one exception, a different set on a
# different rule, the one emit_settings_json applies in bin/agentic-common.sh,
# since those are spliced into JSON rather than used in arithmetic here. The
# exception is staleAfterMs, which this script also reads for itself, so it
# takes this check too, at its own assignment below.
#
# The rule: digits only, no leading zero, at most nine digits, and at least
# the given minimum, which defaults to 1. Each clause stops a distinct way a
# bad value corrupts a run instead of failing loudly. A non-numeric value
# turns every `[ "$a" -lt "$b" ]` comparison into a shell error, which the
# caller reads as "the bound is already passed". A leading zero makes the
# shell read the value as octal, so `$((0500 / 1000))` is 0 and `$((0089))`
# aborts the script with "value too great for base". A digit string longer
# than nine digits is past any plausible bound or count, and a long enough one
# wraps the shell's 64-bit arithmetic to an unrelated value. Zero collapses
# every grace loop and poll interval to no wait at all.
#
# The minimum exists for the millisecond settings whose consumer divides them
# by 1000 before use: anything under 1000 floors to a zero-second wait there,
# which is the same failure a zero produces, reached from a value that looks
# reasonable. Those two callers pass 1000.
#
# Usage: positive_number <value> [minimum]
# Returns 0 when the value passes. Each caller decides what a failure means:
# the PowerShell bound falls back to its default, every other setting ends
# the run with an ERROR line naming the setting.
positive_number() {
  case "${1:-}" in
    ''|*[!0-9]*|0*) return 1 ;;
  esac
  [ "${#1}" -le 9 ] || return 1
  [ "$1" -ge "${2:-1}" ]
}

# --- Defaults (plan section 6) ---
# A fixed sentinel line every PowerShell probe below writes as its own
# last statement: powershell -Command's exit code reflects whether the
# LAST statement it ran succeeded, not an aggregate error count - a
# script whose real work ends on an `if` whose condition is false
# (exactly what "the pid is gone, checked cleanly" looks like) exits 1
# with no error printed anywhere. A trailing Write-Output of this
# sentinel is a statement that always succeeds, so its presence in
# stdout - not PowerShell's own exit code - is what a caller trusts as
# "the script ran to completion", timed-out truncation being the one
# case that can never produce it.
STOP_PS_SENTINEL="___SUPERVISOR_PS_DONE___"

# The bound every PowerShell call uses is one setting rather than a bare
# literal repeated at each call site, sized to this box's own measured
# spawn cost (4-11s per call under this session's own load) rather than
# picked arbitrarily; a slower box overrides it rather than silently
# timing out every call. Collapsing the per-stop PowerShell calls to as
# few as the design allows is handled separately, by removing
# kill_process_snapshot's own retry loop in favor of
# retry_stop_escalation's single wall-clock-bounded loop, not by this
# setting.
SUPERVISOR_PS_BOUND_S="${supervisorPsBoundS:-30}"
# An unusable bound force-kills every PowerShell call the moment it starts,
# because `bound_ms=$(( bound * 1000 ))` either errors or yields a bound the
# first `[ "$waited_ms" -lt "$bound_ms" ]` already fails.
# This is the one numeric setting that falls back instead of ending the run:
# a bad bound costs process-tree verification, not the run itself.
if ! positive_number "$SUPERVISOR_PS_BOUND_S"; then
  SUPERVISOR_PS_BOUND_S=30
fi
# How long each wait inside a bounded PowerShell call sleeps before it checks
# again whether the call has ended, in milliseconds. One second, so every call
# is paid in whole seconds; a suite that drives many calls sets it finer. The
# value reaches `sleep` as a decimal number of seconds and is never divided
# down to a whole number, so it takes the plain numeric rule below rather
# than the 1000 minimum, and no value the rule admits is a zero-length wait.
# It is refused above 1000, since a step longer than a second would outlast
# the whole-second bounds it ticks against.
SUPERVISOR_PS_WAIT_STEP_MS="${supervisorPsWaitStepMs:-1000}"

SUPERVISOR_STOP_GRACE_MS="${supervisorStopGraceMs:-60000}"
# The cap on how long a requested restart (the restart_passive label in
# stop_child) keeps waiting past the grace for a child that is inside a turn,
# measured from the moment its input is closed. Eleven minutes: the harness
# caps one tool call at ten minutes, and the extra minute covers the reply the
# model writes once that call returns. Only that one label reads it.
SUPERVISOR_STOP_BUSY_CAP_MS="${supervisorStopBusyCapMs:-660000}"
SUPERVISOR_MIN_RUN_MS="${supervisorMinRunMs:-120000}"
SUPERVISOR_CRASH_LIMIT="${supervisorCrashLimit:-3}"
SUPERVISOR_MAX_RESTARTS_PER_HOUR="${supervisorMaxRestartsPerHour:-6}"
SUPERVISOR_POLL_MS="${supervisorPollMs:-10000}"
# The liveness verdict's three bounds, read by bin/supervise-liveness.mjs
# through the poll and never written to the plugin's options. The silence
# bound is how long the transcript and the output stream may be silent, and
# the startup grace: fifteen minutes, the harness's ten-minute tool-call cap
# plus a margin. The probe interval is the least time between two probes of a
# child whose heartbeat is stale. The final ask's window is how long a frozen
# child has to move any signal after the one status prompt, the tool-call cap
# plus a minute.
SUPERVISOR_SILENCE_BOUND_MS="${supervisorSilenceBoundMs:-900000}"
SUPERVISOR_PROBE_MS="${supervisorProbeMs:-120000}"
SUPERVISOR_FINAL_ASK_MS="${supervisorFinalAskMs:-660000}"
# How long a shutdown ask waits for the child to bank its state and record
# shutdown_requested before the stop proceeds through the stop phases: twenty
# minutes, run from the moment the ask is written. The plugin delivers the ask
# from a controller tick that finds the session idle, so a child that is idle
# inside the window banks its state and stops itself, and one whose turn
# outlasts the window is stopped through the phases. Read by the decide unit
# through the poll, and never written to the plugin's options.
SUPERVISOR_ASK_GRACE_MS="${supervisorAskGraceMs:-1200000}"
# How long the pre-launch gate waits for the persona to come free, and how long
# it holds on a handle it may not take (one whose writer is running or cannot
# be ruled out), before ending the run at GATE TIMEOUT. Two minutes, the
# gate's standing bound; a suite shortens it.
SUPERVISOR_GATE_WAIT_S="${supervisorGateWaitS:-120}"
# How long a failed tree kill is retried after a stop, in seconds, before the
# stop reports the tree alive or unverifiable. Thirty seconds, a quarter of
# the pre-launch gate's default bound; a suite shortens it.
SUPERVISOR_STOP_RETRY_BUDGET_S="${supervisorStopRetryBudgetS:-30}"
# How many whole days a channel log file in the work directory is kept after
# its last write before the channel log sweep removes it. Two weeks.
CHANNEL_LOG_RETENTION_DAYS="${channelLogRetentionDays:-14}"
# v2 spec Section 0 item 3 Part B (operator decision, DISCUSSION.md Round
# 136 addendum): the worker's own main thread - where PR #17's kill path
# was actually written - defaults to opus at medium effort, not sonnet.
# Per-section implementer tier is unaffected; a dispatched section still
# takes whatever tier the plan doc's own `Model:` line names, under
# executing-work. `MODEL` (below) still overrides this default when a
# caller sets it explicitly - the `.kit/live-*` suites keep doing exactly
# that to pass `haiku` and hold their own cost steady.
SUPERVISOR_MODEL="${supervisorModel:-opus}"
SUPERVISOR_EFFORT="${supervisorEffort:-medium}"
# An unvalidated typo in either setting is an opaque crash loop: the child
# never launches, `claude -p` rejecting an unknown model or effort value, and
# the supervisor retries until it trips the crash-loop limit with nothing in
# the log naming the cause. Both are checked once at startup instead.
#
# The model cannot be validated against a known set - new model names ship
# without this script changing - so the check is on shape: a name of lowercase
# letters, digits, `.` and `-` that starts with a letter or a digit, plus an
# optional bracketed suffix such as the `[1m]` of `opus[1m]`. Requiring the
# brackets to come as a matched pair at the end is what a case glob cannot
# express, so the check is a regex. Starting on a letter or digit keeps a
# value like `--some-flag` from reaching `claude -p --model` as a flag. A
# stray quote or other character is the realistic typo the pattern catches.
plausible_model_name() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9.-]*(\[[a-z0-9.-]+\])?$ ]]
}
if ! plausible_model_name "$SUPERVISOR_MODEL"; then
  echo "ERROR: supervisorModel '$SUPERVISOR_MODEL' is not a plausible model name (lowercase letters, digits, '.' and '-', starting with a letter or digit, with an optional bracketed suffix such as '[1m]')" >&2
  exit 1
fi
case "$SUPERVISOR_EFFORT" in
  low|medium|high|xhigh|max) : ;;
  *)
    echo "ERROR: supervisorEffort '$SUPERVISOR_EFFORT' is not one of low|medium|high|xhigh|max" >&2
    exit 1
    ;;
esac
# The env overrides are what actually reach the launch flags, and they bypass
# both checks above, so they are validated on the same rules. A live suite
# exporting a bad `MODEL` or `EFFORT` would otherwise produce the same silent
# crash loop the settings checks exist to prevent.
if [ -n "${MODEL:-}" ] && ! plausible_model_name "$MODEL"; then
  echo "ERROR: MODEL '$MODEL' is not a plausible model name (lowercase letters, digits, '.' and '-', starting with a letter or digit, with an optional bracketed suffix such as '[1m]')" >&2
  exit 1
fi
if [ -n "${EFFORT:-}" ]; then
  case "$EFFORT" in
    low|medium|high|xhigh|max) : ;;
    *)
      echo "ERROR: EFFORT '$EFFORT' is not one of low|medium|high|xhigh|max" >&2
      exit 1
      ;;
  esac
fi
# The settings that end the run on a bad value, each checked against the one
# rule positive_number states. A bad value here is always a typo in the
# settings file or in an exported override, and the symptom it produces is
# remote from its cause:
# the stop grace sizes both of stop_child's grace loops so a zero-iteration
# loop skips EOF and TERM and goes straight to KILL, the minimum run time
# decides what counts as a crash, the crash limit and the restart budget
# decide when the run gives up, and the poll interval feeds `sleep`.
#
# The stop grace and the poll interval are the two the consumer divides by
# 1000, so they take the 1000 minimum; the minimum run time is compared in
# milliseconds as written and stays on the plain rule. The stop's busy cap
# takes the same 1000 minimum as the grace it extends. The PowerShell wait
# step is in milliseconds too, but it reaches `sleep` as a decimal rather than
# divided, so it stays on the plain rule as well.
if ! positive_number "$SUPERVISOR_STOP_GRACE_MS" 1000; then
  echo "ERROR: supervisorStopGraceMs '$SUPERVISOR_STOP_GRACE_MS' is not a whole number of milliseconds of at least 1000, written with digits only, no leading zero and at most 9 digits. The stop grace is divided by 1000, so anything smaller is a zero-second grace." >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_STOP_BUSY_CAP_MS" 1000; then
  echo "ERROR: supervisorStopBusyCapMs '$SUPERVISOR_STOP_BUSY_CAP_MS' is not a whole number of milliseconds of at least 1000, written with digits only, no leading zero and at most 9 digits. The busy cap is measured against a poll that runs every five seconds, so anything smaller cannot extend a wait." >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_MIN_RUN_MS"; then
  echo "ERROR: supervisorMinRunMs '$SUPERVISOR_MIN_RUN_MS' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_CRASH_LIMIT"; then
  echo "ERROR: supervisorCrashLimit '$SUPERVISOR_CRASH_LIMIT' is not a whole number of crashes greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_MAX_RESTARTS_PER_HOUR"; then
  echo "ERROR: supervisorMaxRestartsPerHour '$SUPERVISOR_MAX_RESTARTS_PER_HOUR' is not a whole number of restarts greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_POLL_MS" 1000; then
  echo "ERROR: supervisorPollMs '$SUPERVISOR_POLL_MS' is not a whole number of milliseconds of at least 1000, written with digits only, no leading zero and at most 9 digits. The poll interval is divided by 1000, so anything smaller polls with no wait at all." >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_SILENCE_BOUND_MS"; then
  echo "ERROR: supervisorSilenceBoundMs '$SUPERVISOR_SILENCE_BOUND_MS' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_PROBE_MS"; then
  echo "ERROR: supervisorProbeMs '$SUPERVISOR_PROBE_MS' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_FINAL_ASK_MS"; then
  echo "ERROR: supervisorFinalAskMs '$SUPERVISOR_FINAL_ASK_MS' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_ASK_GRACE_MS"; then
  echo "ERROR: supervisorAskGraceMs '$SUPERVISOR_ASK_GRACE_MS' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_GATE_WAIT_S"; then
  echo "ERROR: supervisorGateWaitS '$SUPERVISOR_GATE_WAIT_S' is not a whole number of seconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_STOP_RETRY_BUDGET_S"; then
  echo "ERROR: supervisorStopRetryBudgetS '$SUPERVISOR_STOP_RETRY_BUDGET_S' is not a whole number of seconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi
if ! positive_number "$SUPERVISOR_PS_WAIT_STEP_MS" || [ "$SUPERVISOR_PS_WAIT_STEP_MS" -gt 1000 ]; then
  echo "ERROR: supervisorPsWaitStepMs '$SUPERVISOR_PS_WAIT_STEP_MS' is not a whole number of milliseconds from 1 to 1000 (digits only, no leading zero). A step above a second would outlast the bounds it ticks against." >&2
  exit 1
fi
if ! positive_number "$CHANNEL_LOG_RETENTION_DAYS"; then
  echo "ERROR: channelLogRetentionDays '$CHANNEL_LOG_RETENTION_DAYS' is not a whole number of days greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi

# --- Plugin values (single-sourced, emitted to settings JSON) ---
HEARTBEAT_MS="${heartbeatMs:-30000}"
STALE_AFTER_MS="${staleAfterMs:-90000}"
# The memory gate's confidence floor: a percent, checked beside the other
# settings that end the run rather than left to the plugin's own clamp. The
# plugin folds a value outside 50 to 100 to 90 with one setting_clamped
# decision and keeps running, so a roster typo there costs only a line in the
# journal an operator may never read. Checked here instead, a typo stops the
# launch at startup, where it is visible in the supervisor's own log. 50 to
# 100: positive_number's own minimum covers the lower edge, and the upper
# edge is checked here because positive_number has no maximum of its own.
MEMORY_GATE_DISCARD_PERCENT="${memoryGateDiscardPercent:-90}"
if ! positive_number "$MEMORY_GATE_DISCARD_PERCENT" 50; then
  echo "ERROR: memoryGateDiscardPercent '$MEMORY_GATE_DISCARD_PERCENT' is not a whole number in the range 50 to 100, written with digits only, no leading zero and at most 9 digits" >&2
  exit 1
fi
if [ "$MEMORY_GATE_DISCARD_PERCENT" -gt 100 ]; then
  echo "ERROR: memoryGateDiscardPercent '$MEMORY_GATE_DISCARD_PERCENT' is not a whole number in the range 50 to 100" >&2
  exit 1
fi
# The two nudge cadences the roster carries, checked where the roster sets
# them, so a zero, a leading zero or an overlong value stops the launch here
# rather than reaching either settings branch. The defaults below need no
# check. controllerTickMs takes the same rule once the library is sourced.
for cadence in nudgeFloorMs nudgeIdleMs; do
  if [ -n "${!cadence:-}" ] && ! positive_number "${!cadence}"; then
    echo "ERROR: $cadence '${!cadence}' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
    exit 1
  fi
done
# This one is read by the supervisor itself, not only emitted: it is the stale
# bound the pre-launch gate hands wait_persona_free_both, and it reaches the
# decide unit too. So it takes the same check the settings above take, rather
# than only the emitter's rule, which is skipped whenever the rundir already
# holds a settings file. It is compared against an age in milliseconds as
# written, so it stays on the plain rule with no minimum.
if ! positive_number "$STALE_AFTER_MS"; then
  echo "ERROR: staleAfterMs '$STALE_AFTER_MS' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi

# --- Paths ---
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "$RUNDIR" ]; then
  RUNDIR="$WORKDIR/run"
fi
if ! mkdir -p "$RUNDIR"; then
  echo "ERROR: cannot create rundir $RUNDIR" >&2
  exit 1
fi

LOG="$RUNDIR/supervisor.log"
SETTINGS_FILE="$RUNDIR/settings.json"
# The heartbeat file only this run's child writes, and the mailbox pair: the
# supervisor's own records, and the plugin's acknowledgements of them. One of
# each per run directory rather than per child, and both mailbox files are
# truncated at each launch.
CHILD_HEARTBEAT="$RUNDIR/heartbeat.json"
MAILBOX_FILE="$RUNDIR/mailbox.jsonl"
MAILBOX_ACK_FILE="$RUNDIR/mailbox.ack.jsonl"
# The file that stops this persona on purpose. The operator writes it, and a
# keeper that writes it is a follow-on; the poll reads it and asks the child
# to stop, and a launch that finds it
# ends the run without launching. Whatever it contains, a present file is the
# request, and each exit 0 the request leads to removes it.
SHUTDOWN_REQUEST_FILE="$RUNDIR/shutdown.request"
# The three paths the child's plugin is handed in the settings file, exported
# once here so both settings branches below write them: the mailbox it drains,
# the workdir sidecar the pre-launch gate reads, and the heartbeat file only
# the child writes. The child is a Windows process, so each is handed over in
# absolute mixed form (D:/...), which it resolves and which a JSON string
# carries without escaping; the plugin derives the ack file from the mailbox.
export SUPERVISOR_MAILBOX="$(cygpath -m -a "$MAILBOX_FILE" 2>/dev/null || echo "$MAILBOX_FILE")"
export HEARTBEAT_PATH="$(cygpath -m -a "$WORKDIR/.agentic-heartbeat.json" 2>/dev/null || echo "$WORKDIR/.agentic-heartbeat.json")"
export SUPERVISOR_HEARTBEAT_PATH="$(cygpath -m -a "$CHILD_HEARTBEAT" 2>/dev/null || echo "$CHILD_HEARTBEAT")"

# --- Source the shared helper ---
_COMMON="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agentic-common.sh"
# shellcheck source=agentic-common.sh
source "$_COMMON"

# Sourcing agentic-common.sh above assigns these four from its own PROFILE
# case. They are set here, after the source, so this launch's env overrides
# apply instead of being clobbered by the library's defaults.
TICK_MS="${controllerTickMs:-10000}"
NUDGE_IDLE_MS="${nudgeIdleMs:-45000}"
NUDGE_FLOOR_MS="${nudgeFloorMs:-300000}"
GIT_PROBE_MS="${gitProbeMs:-30000}"
# The controller tick is emitted for the plugin and is the probe window's
# fallback below, so it takes the same check the settings the script reads
# for itself take. The emitter's own rule is skipped whenever the rundir
# already holds a settings file.
if ! positive_number "$TICK_MS"; then
  echo "ERROR: controllerTickMs '$TICK_MS' is not a whole number of milliseconds greater than zero (digits only, no leading zero, at most 9 digits)" >&2
  exit 1
fi

# --- Emit settings JSON (only if not already provided) ---
# A provided file keeps its options, and gains whichever plugin id it lacks,
# so a rundir written for one load mode still reaches the plugin in the other.
if [ ! -f "$SETTINGS_FILE" ]; then
  if ! emit_settings_json "$SETTINGS_FILE" 2>>"$LOG"; then
    echo "ERROR: could not write $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
else
  if ! ensure_settings_plugin_ids "$SETTINGS_FILE" 2>>"$LOG"; then
    echo "ERROR: could not complete $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  # A provided settings file with no arming key would otherwise start this
  # launch's child as "off" (no tool, no claim), silently. Every supervisor
  # launch is an owner, so a missing key is completed to owner where absent,
  # and refused where it names another tier.
  if ! ensure_settings_arming "$SETTINGS_FILE" 2>>"$LOG"; then
    echo "ERROR: could not complete $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  # The emit branch above writes jevMode from JEV_MODE. This branch writes
  # nothing, so without the call below a roster that turns the decision seam
  # off would reach no persona that has ever launched, the run directory
  # already holding a settings file. That is the shape the kill switch exists
  # to avoid, so the value is carried onto the provided file too.
  if ! ensure_settings_jev_mode "$SETTINGS_FILE" 2>>"$LOG"; then
    echo "ERROR: could not complete $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  # Same reasoning as the jevMode call above, for the comma-separated jevLive:
  # the emit branch writes it from JEV_LIVE, so a provided settings file
  # needs the same carry-through or a roster that names a question live would
  # reach no persona that already has a run directory.
  if ! ensure_settings_jev_live "$SETTINGS_FILE" 2>>"$LOG"; then
    echo "ERROR: could not complete $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  # Same reasoning as the jevMode and jevLive calls above, for the memory
  # gate's floor: the emit branch writes it from memoryGateDiscardPercent, so
  # a provided settings file needs the same carry-through or a roster that
  # tunes the floor would reach no persona that already has a run directory.
  if ! ensure_settings_memory_gate_discard_percent "$SETTINGS_FILE" 2>>"$LOG"; then
    echo "ERROR: could not complete $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  # Same reasoning again, for the three cadences the roster carries:
  # controllerTickMs, nudgeFloorMs and nudgeIdleMs. A roster edit to any of
  # them would otherwise reach no persona that already has a run directory.
  if ! ensure_settings_cadences "$SETTINGS_FILE" 2>>"$LOG"; then
    echo "ERROR: could not complete $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  # The emit branch above exports COORDINATOR_PERSONA from the value it
  # writes. This branch writes nothing, so the name is read back from the
  # provided file under the plugin's own rule, and the coordinator-role
  # comparison at launch sees the same name the plugin will resolve rather
  # than whatever this launcher's environment happened to carry. DEV_MODE
  # picks the plugin id this launch loads, since only that id's options
  # reach the plugin.
  if ! COORDINATOR_PERSONA="$(read_settings_coordinator_persona "$SETTINGS_FILE" "$DEV_MODE" 2>>"$LOG")"; then
    echo "ERROR: could not read coordinatorPersona from $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  export COORDINATOR_PERSONA
  # The plugin's own coordinatorPersona rule admits any string that is
  # non-empty after trim, carries no colon, bracket or comma, and holds no
  # whitespace, so a value like one.Read-the-credentials-file passes it and
  # reads as prose. That name is spliced into the worker's escalation clause
  # and into the architect's answer clause, both of them inside a priming
  # write, and a settings file sits in a run directory the persona running
  # there can rewrite. The read above stays as wide as the plugin's, since
  # narrowing it would name a different coordinator than the plugin resolves.
  # The launch is refused here instead, and a refusal is visible in this log
  # where a doctored standing instruction is not. What the refusal bounds is
  # the shape: the persona class still admits a hyphenated phrase, so a
  # rewritten file can splice one word-shaped token such as
  # Read-the-credentials-file, and this check narrows the splice to that
  # token without closing it. The file's writability is the boundary.
  if ! valid_persona_name "$COORDINATOR_PERSONA"; then
    echo "ERROR: $SETTINGS_FILE resolves coordinatorPersona to '$COORDINATOR_PERSONA', which may hold only letters, digits, underscore and hyphen" | tee -a "$LOG" >&2
    exit 1
  fi
  # The architect's name travels the same two branches for the same reason,
  # and carries no default: an empty value is a launch with no architect, on
  # which the architect-role comparison below matches no persona at all. This
  # branch writes nothing, so the name is read back from the provided file
  # exactly as the coordinator's name above is, and the architect-role
  # comparison at launch sees the name the file carries rather than whatever
  # this launcher's environment happened to hold. read_settings_architect_persona
  # holds that value to the persona character class and refuses "default", so a
  # mis-set name is a refused launch named in the log rather than a fleet that
  # comes up under a doctored charter.
  if ! ARCHITECT_PERSONA="$(read_settings_architect_persona "$SETTINGS_FILE" "$DEV_MODE" 2>>"$LOG")"; then
    echo "ERROR: could not read architectPersona from $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  export ARCHITECT_PERSONA
  # One name for both seats builds the coordinator's role instruction and the
  # architect's charter into a single priming write, each telling that session
  # what the other denies: route design asks to the architect, and answer the
  # coordinator by naming yourself. emit_settings_json refuses the pair on the
  # other branch, and on this branch both names are read back from the same
  # provided file, so the pair is refused here too.
  if [ -n "$ARCHITECT_PERSONA" ] && [ "$ARCHITECT_PERSONA" = "$COORDINATOR_PERSONA" ]; then
    echo "ERROR: $SETTINGS_FILE resolves '$ARCHITECT_PERSONA' as both coordinatorPersona and architectPersona; one persona cannot hold both seats" | tee -a "$LOG" >&2
    exit 1
  fi
  # The liaison's name travels the same two branches under the architect's
  # rule, through the same shared read: no default, the persona class, and
  # "default" refused, so a mis-set name is a refused launch named in the log.
  # A name another seat holds builds two contradicting charters into one
  # priming write, so either pair is refused here as emit_settings_json refuses
  # it on the other branch.
  if ! LIAISON_PERSONA="$(read_settings_liaison_persona "$SETTINGS_FILE" "$DEV_MODE" 2>>"$LOG")"; then
    echo "ERROR: could not read liaisonPersona from $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
    exit 1
  fi
  export LIAISON_PERSONA
  if [ -n "$LIAISON_PERSONA" ] && [ "$LIAISON_PERSONA" = "$COORDINATOR_PERSONA" ]; then
    echo "ERROR: $SETTINGS_FILE resolves '$LIAISON_PERSONA' as both coordinatorPersona and liaisonPersona; one persona cannot hold both seats" | tee -a "$LOG" >&2
    exit 1
  fi
  if [ -n "$LIAISON_PERSONA" ] && [ "$LIAISON_PERSONA" = "$ARCHITECT_PERSONA" ]; then
    echo "ERROR: $SETTINGS_FILE resolves '$LIAISON_PERSONA' as both architectPersona and liaisonPersona; one persona cannot hold both seats" | tee -a "$LOG" >&2
    exit 1
  fi
  # The liaison's charter sends every brief to the architect by name, so a
  # file naming a liaison and no architect is refused as the emitter refuses it.
  if [ -n "$LIAISON_PERSONA" ] && [ -z "$ARCHITECT_PERSONA" ]; then
    echo "ERROR: $SETTINGS_FILE resolves liaisonPersona to '$LIAISON_PERSONA' while architectPersona is unset; a liaison sends its briefs to the architect, so a file naming one must name the other" | tee -a "$LOG" >&2
    exit 1
  fi
fi

# How long a probe waits for the plugin's ack before it reads silent: an idle
# child's tick acknowledges within one tick, and the second tick and the poll
# interval are the margin for the tick and the poll landing out of step. The
# tick is the one the child runs, read back from the settings file under the
# id this launch loads, since a provided file can carry a tick this launch's
# environment does not name. Where the file carries no whole tick from 1 to
# 999999999 under that id, TICK_MS stands.
if ! FILE_TICK_MS="$(read_settings_controller_tick "$SETTINGS_FILE" "$DEV_MODE" 2>>"$LOG")"; then
  echo "ERROR: could not read controllerTickMs from $SETTINGS_FILE; see $LOG" | tee -a "$LOG" >&2
  exit 1
fi
PROBE_WINDOW_MS=$(( 2 * ${FILE_TICK_MS:-$TICK_MS} + SUPERVISOR_POLL_MS ))

# --- Helper: log a line to supervisor.log ---
# The stamp is the shell's own clock read, so a log line starts no process.
# TZ is set for that one builtin only: the stamp is UTC and the zone every
# other read in this script sees is unchanged.
log() {
  local ts
  TZ=UTC0 printf -v ts '%(%Y-%m-%dT%H:%M:%SZ)T' -1
  echo "$ts $*" >> "$LOG"
  echo "$*"
}

# --- Helper: log a diagnostic line without touching stdout ---
# A helper whose stdout a caller captures via `$(...)`
# (run_bounded_powershell, check_snapshot_survivors) must never call
# plain `log`, which echoes to stdout as well as the log file - its own
# diagnostic line would ride straight into the caller's parsed result,
# read back as a phantom survivor pid. Same log file, same stderr
# visibility in a terminal, just never stdout.
log_diag() {
  local ts
  TZ=UTC0 printf -v ts '%(%Y-%m-%dT%H:%M:%SZ)T' -1
  echo "$ts $*" >> "$LOG"
  echo "$*" >&2
}

# --- Trap: clean up on exit ---
# The launched child's pid, `$!` of the `holder | child &` pipeline, which is
# the child stage. Every read of the child's pid goes through this variable.
# The child's stdin is held by bin/supervise-holder.sh; there is no descriptor
# to close, so the graceful stop kills the holder instead.
CHILD_LAUNCH_PID=""
# The holder that holds this child's stdin pipe: its MSYS and Windows pids and
# start ticks, recorded at launch or read from the handle at adoption, so the
# pipe-close phase kills the holder by an identity-guarded, ticks-matched kill.
HOLDER_LAUNCH_PID=""
HOLDER_WINPID=""
HOLDER_TICKS=""
# 1 while the holder is one this supervisor launched itself, which is the one
# case kill_holder may reach with an MSYS signal when no ticks are recorded.
# Cleared at adoption.
HOLDER_OWN_LAUNCH=""
# 1 once ensure_holder_ticks found this child's own holder gone, so that is
# logged once per child rather than on every poll.
HOLDER_GONE_LOGGED=""
# The current child's handle path, for clear_handle and the cleanup trap's
# detach route. Set per child at launch or adoption.
HANDLE_FILE=""
# 1 while the current child was adopted rather than launched: its exit marker
# is written by a wrapper this supervisor cannot `wait` on, and its walk is
# checked against the Windows pid its handle recorded.
CHILD_ADOPTED=""
# 1 once an adopted child's launch pid was found under another Windows pid, so
# the mismatch is logged once per child rather than on every poll.
CHILD_ROOT_MISMATCH_LOGGED=""
# The last poll's liveness reading, which the cleanup trap routes on. Empty
# until the child's first poll, reset at each launch and at the gate's handle
# read so no child carries an earlier child's reading, and the trap reads
# empty as alive, since a child that answers kill -0 with no reading yet is
# inside the startup grace.
POLL_LIVENESS=""
# The live child's own processes, recorded while it runs by refresh_child_tree:
# the MSYS pids of its process tree, the Windows pids those map to, and a
# "pid,ticks" snapshot of the Windows trees under them. Every read of this has
# to happen while the child is alive - `resolve_windows_pid` and the MSYS
# process table both lose a process the moment it exits - and after the wrapper
# is gone this snapshot is the only thing that can name what outlived it.
#
# CHILD_TREE_WINPIDS is the Windows pid set the standing snapshot was walked
# from, and CHILD_TREE_SEEN_WINPIDS is the newest set seen under a child that
# was still running it at the end of the poll that saw it, recorded whether or
# not its walk completed. The two differ exactly while the snapshot describes
# an older shape of the tree than the one the child has now, which is what
# `sweep_child_tree` refuses to read as a clean result. A closure member that
# exited inside its own walk is in neither set, since the pid it ran as is no
# longer its own and nothing the walk read of that pid is evidence about it.
# CHILD_TREE_WALKED is set once a walk has completed, so "no walk ever ran" is
# distinguishable from "a walk ran and found nothing alive".
#
# CHILD_TREE_READ_FAILED is set by a refresh that could read nothing at all,
# so a child whose tree was never readable is told from one that genuinely ran
# no Windows process. CHILD_TREE_DESCENDANT_SEEN is set once a walk has named
# a process other than the one the launch pid runs as, and
# CHILD_TREE_CONFIRMED_AT is when a poll last found the child running as the
# pid set the record was walked from, which the sweep's own lines report.
# `child_tree_record_state` reads every one of them, and each names a way a
# record falls short: the walked flag tells a record that exists from one no
# walk ever took, the two pid sets tell a record the child's pid set has moved
# past, the descendant flag tells a record naming only the wrapper, and the
# failed-confirm count and the stamp are the two bounds on how far back a
# confirmation can sit. None of those is a record a clean verdict can rest on.
#
# CHILD_TREE_SEEN_PAIRS is the latest poll's closure as "msys:winpid" pairs,
# which `stop_child` walks again when it stops the child. A pair whose MSYS
# process has since exited is walked there too and discarded there, so a stale
# pair costs a walk and never reaches the snapshot.
CHILD_TREE_MSYS_PIDS=""
CHILD_TREE_WINPIDS=""
CHILD_TREE_SEEN_WINPIDS=""
CHILD_TREE_SEEN_PAIRS=""
CHILD_TREE_SNAPSHOT=""
CHILD_TREE_WALKED=""
CHILD_TREE_READ_FAILED=""
CHILD_TREE_DESCENDANT_SEEN=""
CHILD_TREE_CONFIRMED_AT=""
# How many polls in a row have run without confirming the standing record
# against the live process table. This is what `child_tree_record_state` reads
# to call a record stale, since the record falls behind by polls that failed to
# confirm it and not by time: a poll body that takes a minute confirms the
# record just as a poll body that takes a second does.
CHILD_TREE_FAILED_CONFIRMS=0
LAST_STOP_SNAPSHOT=""  # the process-tree snapshot a stop or a sweep acted on, left for the retry and the EXIT trap
STOP_TREE_MOVED=""  # set where stop_child refused because the wrapper moved to a Windows pid no snapshot was walked from; the retry fails on it
STOP_SNAPSHOT_BUILT=""  # the merged snapshot build_stop_snapshot last built, empty where it could not verify one
# Initialized here so it is never unset under `set -u`: the "no child to
# stop" early return's own `log "... ($STOP_PATH)"` would otherwise abort
# the script.
STOP_PATH=""

# --- Helper: run a native command bounded, without inheriting the
# caller's own stdout ---
# A taskkill watchdog written as `( sleep 5; kill -9 "$tk" 2>/dev/null ) &`
# with no redirection inherits whatever fd its parent function's stdout
# currently is - in every production call, that is the caller's own
# `$(...)` capture pipe. The command substitution cannot return until
# every process holding a copy of that pipe's write end closes it,
# watchdog included, so a call that finishes its real work in 4s does not
# hand control back to the caller until 9s - a flat 5-10s tax on every
# expired call, for no reason connected to the actual work. Worse, `$tk`
# is itself a stub for a native `taskkill.exe` (bash exec-optimises the
# subshell), so `kill -9` on it is the same signal-based hang one level
# further removed. So every native command this script spawns and bounds
# goes through this helper, which redirects to `/dev/null` at the exec
# site itself (so nothing it holds can block a caller's pipe) and
# abandons rather than signals a command that outlives its bound (no
# second kill to hang on).
# Usage: run_bounded_native <bound-seconds> <command...>
run_bounded_native() {
  local bound="$1"
  shift
  ( exec "$@" ) > /dev/null 2>&1 &
  local npid=$!
  local nwaited=0
  while kill -0 "$npid" 2>/dev/null && [ "$nwaited" -lt "$bound" ]; do
    sleep 1
    nwaited=$((nwaited + 1))
  done
  if kill -0 "$npid" 2>/dev/null; then
    log_diag "STOP: a native call ($*) did not finish within ${bound}s - abandoning it rather than risking a second signal-based hang"
    return 124
  fi
  wait "$npid" 2>/dev/null
  return $?
}

# --- Helper: is the current child still present ---
# The one liveness reading the poll loop, the trap, the gone sweep and the
# launch-path waits key on. A child this supervisor launched is its own job:
# `kill -0` on its launch pid answers for it. An adopted child's launch pid is
# an MSYS pid this supervisor never held, so its liveness is never keyed on
# `kill -0` of that pid: the child is present while its `.exit` marker is
# absent and the last walk did not complete finding nothing (`none`), which is
# the reading the Approach names for a child read from a handle.
child_present() {
  [ -n "${CHILD_LAUNCH_PID:-}" ] || return 1
  if [ "${CHILD_ADOPTED:-}" = "1" ]; then
    [ -n "${EXIT_MARKER:-}" ] && [ -f "$EXIT_MARKER" ] && return 1
    [ "${CHILD_TREE_POLL_WALK:-failed}" != "none" ]
    return $?
  fi
  kill -0 "$CHILD_LAUNCH_PID" 2>/dev/null
}

cleanup() {
  local exit_code=$?
  # A signal that reaches a live child either detaches from it or stops it. A
  # handled child the instrument does not read gone is detached: the child and
  # its holder are left running for the next supervisor to adopt, which is the
  # operator's decision of 2026-09-17 (a scheduled-task stop leaves the session
  # running; the shutdown request file is the deliberate stop). Today's stop is
  # kept on a child with no readable handle and on one that reads gone.
  if child_present; then
    local cleanup_verdict cleanup_readable cleanup_route
    cleanup_verdict="${POLL_LIVENESS:-}"
    cleanup_verdict="${cleanup_verdict%% *}"
    [ -n "$cleanup_verdict" ] || cleanup_verdict="alive"
    if [ -n "${HANDLE_FILE:-}" ] && [ -f "$HANDLE_FILE" ]; then cleanup_readable=1; else cleanup_readable=0; fi
    cleanup_route=$(handle_trap_route "$cleanup_readable" "$cleanup_verdict")
    if [ "$cleanup_route" = "DETACH" ]; then
      log "DETACH child-$CHILD_INDEX: signaled with a live handled child (verdict $cleanup_verdict); leaving it and its holder running for the next supervisor to adopt"
      exit "$exit_code"
    fi
    log "CLEANUP: stopping child-$CHILD_INDEX (pid $CHILD_LAUNCH_PID)"
    stop_child "cleanup"
    retry_stop_escalation "cleanup" $?
  elif [ -n "$LAST_STOP_SNAPSHOT" ]; then
    # The wrapper pid can be gone (an earlier stop_child call already
    # reaped it) while its own snapshot still shows a live descendant - a
    # dead wrapper with a surviving claude.exe. Keying this trap on the
    # wrapper pid alone would mean that survivor is never revisited on
    # this exit path, so it is keyed on the last known snapshot instead.
    #
    # `kill_process_snapshot` is called unconditionally rather than
    # guarded by a check for survivors: a guard that reads a timed-out
    # probe (empty output, rc 1) the same as "no survivors" is fail-open.
    # `kill_process_snapshot` is ticks-matched and re-verifies its own
    # kill, so it is never a blind kill on a snapshot that might already
    # be dead, and it fails closed on its own unverifiable read rather
    # than this call site guessing first.
    log "CLEANUP: wrapper already gone; re-verifying its last known process tree before exit"
    if kill_process_snapshot "$LAST_STOP_SNAPSHOT"; then
      log "CLEANUP: tree confirmed dead"
    else
      log "CLEANUP: tree could not be confirmed dead (survivor or unverifiable read) - exiting anyway"
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --- AD3: Stop the child via EOF (close write end), then TERM, then KILL ---
# --- Helper: resolve an MSYS pid's current Windows pid ---
# `/proc/<pid>/winpid` is the primary read, and `ps` is the fallback for a
# pid `/proc` has no entry for. Cygwin `ps` prints a state character in
# column 1 for a stopped or an orphaned process, which shifts every column
# right by one: WINPID sits in column 4 on an ordinary row and column 5 on
# a shifted one, while column 4 of a shifted row is the process group id,
# which is digits and so passes every validation a bare column read would
# apply. So the row is tested for the shift and read at the offset that
# row actually uses. The result is validated as pure digits before it is
# trusted - an unvalidated read here is exactly what would let a malformed
# value reach an interpolated PowerShell command string. Must be called
# while the MSYS pid is still alive and tracked - once it exits, both
# reads find nothing.
# Usage: resolve_windows_pid <msys-pid>
resolve_windows_pid() {
  local pid="$1"
  local winpid=""
  # Read with the shell's own `read`, which launches nothing: this runs for
  # every process under the child on every poll.
  if [ -r "/proc/$pid/winpid" ]; then
    { IFS= read -r winpid < "/proc/$pid/winpid"; } 2>/dev/null || true
  fi
  if [ -z "$winpid" ]; then
    winpid=$(ps -p "$pid" 2>/dev/null | tail -n +2 | awk '
      $1 ~ /^[0-9]+$/ { print $4; exit }
      $2 ~ /^[0-9]+$/ { print $5; exit }')
  fi
  case "$winpid" in
    ''|*[!0-9]*) return 0 ;;  # empty or non-numeric: refuse to interpolate it anywhere
    *) echo "$winpid" ;;
  esac
}

# --- Helper: the pid a bounded PowerShell call reported as its first line ---
# Reads the first line of the call's output file with the shell's own `read`,
# so each poll of that file starts no process. Sets PS_SELF_PID to the digits
# after `PSPID:` where the first line, its CRs removed, is that marker and
# nothing else, and to the empty string otherwise. A first line still being
# written is read as far as it goes, which is how a `head -1` of the file
# reads it. The result rides in a global rather than on stdout because a
# `$(...)` capture of it would start the subshell this read exists to avoid.
# The CR is built with `printf -v` from a two-character escape, so the
# function survives a `declare -f` copy re-read through `eval`, where Git
# Bash drops a literal CR even inside quotes.
# Usage: read_ps_self_pid <outfile>
read_ps_self_pid() {
  local first="" cr
  printf -v cr '\r'
  PS_SELF_PID=""
  { IFS= read -r first < "$1"; } 2>/dev/null || true
  first=${first//"$cr"/}
  case "$first" in
    PSPID:*)
      first=${first#PSPID:}
      case "$first" in *[!0-9]*) ;; *) PS_SELF_PID="$first" ;; esac
      ;;
  esac
}

# --- Helper: whether a bounded PowerShell call's output holds a line ---
# An exact whole-line match over the text a capture returned, done with the
# shell's own pattern match, so a sentinel or marker check starts no process.
# Returns 0 where some line is exactly the text asked for, and 1 otherwise.
# Usage: ps_output_has_line <output> <line>
ps_output_has_line() {
  case $'\n'"$1"$'\n' in
    *$'\n'"$2"$'\n'*) return 0 ;;
  esac
  return 1
}

# --- Helper: run a PowerShell -Command script under a real wall-clock bound
# ---
# GNU `timeout` does not terminate native powershell.exe on this box -
# `timeout 3 powershell -NoProfile -Command "Start-Sleep -Seconds 12;
# Write-Output done"` prints `done` and only then returns 124. GNU
# timeout signals the MSYS stub process it forks; powershell.exe itself
# ignores that signal, and bash waits for the real process regardless -
# so wrapping a PowerShell call in `timeout` does not actually bound it,
# and a hung CIM query would still wedge stop_child (and, through the
# EXIT trap, the supervisor's own shutdown). This helper exists instead.
#
# A bare `kill -9` on the tail-exec subshell's own pid does not hold
# under load: run inside `$(...)` (the shape every caller uses), a 3s
# bound around a long sleep can return rc 124 long after the bound with
# the sleep's own late output still in the result, because the native
# process outlives the kill and the caller's `$(...)` blocks on an
# inherited pipe handle until it exits on its own. So the caller supplies
# `<outfile>` directly and reads it itself after this function returns,
# rather than this function writing its own stdout into the caller's
# `$(...)` capture (a pipe a live, possibly-orphaned process can hold
# open indefinitely; a plain read of a file that already exists cannot
# hang the same way); and the Windows pid is resolved right after spawn
# (polled, not only at the deadline, since it is easiest to read while
# the process is fresh) and killed via `taskkill //F //PID` on expiry.
#
# `kill -9` on the stub itself is not a safe fallback signal here - it
# can block for minutes and then return "Permission denied", the same
# shape of hang this whole helper exists to prevent, just moved one line
# down. So the stub is never signaled at all on expiry.
#
# The tail-exec subshell does not always collapse into one process under
# load: it can be three - the MSYS stub this function's own `$!` names,
# an intermediate `bash.exe`, and `powershell.exe` itself. No tree kill
# reaches from the stub to `powershell.exe`: `taskkill //T` re-walks the
# live parent ids at kill time, Windows keeps a dead parent's id in the
# orphans it left and reuses the id, so a walk from the stub can reach a
# process that was never started here. So the launched script's very
# first statement writes its own real Windows pid (`$PID`, PowerShell's
# own automatic variable - always correct, no CIM query needed) as a
# `PSPID:<pid>` line, read from the output file while waiting rather than
# only at the deadline. On expiry, that self-reported pid is killed
# directly, the stub's own Windows pid is killed as a second call, and
# both calls' exit codes are logged rather than discarded. A
# `powershell.exe` that never wrote its `PSPID` line is not killed at all
# and is left running, since nothing names it but a parent-id walk; the
# caller reads the output file and is not blocked by it. Each `taskkill`
# is itself backgrounded and capped at 5s rather than run as an unbounded
# native spawn inside a function that exists to bound exactly that shape
# of call.
# Usage: run_bounded_powershell <bound-seconds> <script> <outfile>
run_bounded_powershell() {
  local bound="$1"
  local script="$2"
  local outfile="$3"
  local start_ts
  # The clock reads here are the shell's own, so the call's timing starts no
  # process. The call's stderr is appended straight onto supervisor.err, the
  # file every other stderr capture in this script appends to, so no scratch
  # file is made, copied or removed around the call. The holder and the child
  # pipeline append to the same file for the child's whole life, so the call's
  # lines interleave with theirs by time, and a call killed at its bound may
  # still append after it returns.
  printf -v start_ts '%(%s)T' -1
  ( exec powershell -NoProfile -Command "Write-Output (\"PSPID:\" + \$PID); $script" >"$outfile" 2>>"$RUNDIR/supervisor.err" ) &
  local ps_pid=$!
  # Each wait below is one step of SUPERVISOR_PS_WAIT_STEP_MS, handed to
  # `sleep` as a decimal number of seconds, while the two bounds stay in whole
  # seconds: five for the pid resolve, and the call's own bound. The step is
  # built with the shell's own printf, so a wait starts no process.
  local step_ms="${SUPERVISOR_PS_WAIT_STEP_MS:-1000}" step_s
  printf -v step_s '%d.%03d' "$(( step_ms / 1000 ))" "$(( step_ms % 1000 ))"
  local ps_winpid="" wpoll_ms=0
  while [ -z "$ps_winpid" ] && [ "$wpoll_ms" -lt 5000 ] && kill -0 "$ps_pid" 2>/dev/null; do
    ps_winpid=$(resolve_windows_pid "$ps_pid")
    [ -z "$ps_winpid" ] && sleep "$step_s"
    wpoll_ms=$((wpoll_ms + step_ms))
  done
  # Self-reported real pid of the launched powershell.exe process itself -
  # read opportunistically from the output file as it becomes available,
  # not just at the deadline, since the file may not have its first line
  # yet this early.
  local ps_real_pid=""
  local waited_ms=0 bound_ms=$(( bound * 1000 ))
  while kill -0 "$ps_pid" 2>/dev/null && [ "$waited_ms" -lt "$bound_ms" ]; do
    if [ -z "$ps_real_pid" ] && [ -s "$outfile" ]; then
      read_ps_self_pid "$outfile"
      ps_real_pid="$PS_SELF_PID"
    fi
    sleep "$step_s"
    waited_ms=$((waited_ms + step_ms))
  done
  local status elapsed now
  if kill -0 "$ps_pid" 2>/dev/null; then
    [ -z "$ps_winpid" ] && ps_winpid=$(resolve_windows_pid "$ps_pid")
    if [ -z "$ps_real_pid" ] && [ -s "$outfile" ]; then
      read_ps_self_pid "$outfile"
      ps_real_pid="$PS_SELF_PID"
    fi
    local rc_real="n/a" rc_stub="n/a"
    if [ -n "$ps_real_pid" ]; then
      run_bounded_native 5 taskkill //F //PID "$ps_real_pid"
      rc_real=$?
    fi
    if [ -n "$ps_winpid" ]; then
      run_bounded_native 5 taskkill //F //PID "$ps_winpid"
      rc_stub=$?
    fi
    log_diag "STOP: taskkill on the real powershell pid ${ps_real_pid:-unresolved} rc=$rc_real; taskkill on stub winpid ${ps_winpid:-unresolved} rc=$rc_stub"
    # Bounded reap, not a blocking `wait`: taskkill is the only
    # termination attempted (see the addendum above). `wait`'s own exit
    # status is never used here (status is already 124, unconditionally,
    # in this branch), so it is skipped entirely once the stub is
    # confirmed gone or the bound below expires - never called
    # unconditionally, which is exactly what could block indefinitely on
    # a stub that will not die.
    local reap_wait=0
    while kill -0 "$ps_pid" 2>/dev/null && [ "$reap_wait" -lt 5 ]; do
      sleep 1
      reap_wait=$((reap_wait + 1))
    done
    if ! kill -0 "$ps_pid" 2>/dev/null; then
      wait "$ps_pid" 2>/dev/null
    else
      log_diag "STOP: the stub pid $ps_pid was still present 5s after taskkill on winpid ${ps_winpid:-unresolved} - leaving it for the OS to reap rather than blocking on it"
    fi
    status=124
    printf -v now '%(%s)T' -1
    elapsed=$(( now - start_ts ))
    log_diag "STOP: a PowerShell call exceeded its ${bound}s bound (elapsed ${elapsed}s) and was force-killed"
  else
    wait "$ps_pid"
    status=$?
    printf -v now '%(%s)T' -1
    elapsed=$(( now - start_ts ))
    log_diag "STOP: a PowerShell call completed in ${elapsed}s (bound ${bound}s)"
  fi
  return "$status"
}

# --- Helper: run_bounded_powershell, but return CR-stripped stdout as text
# ---
# The three callers below each want the same thing: bound the call, get its
# stdout back as a string, and get the same status back. Written once here
# rather than three times so R79's file-not-pipe fix (above) can't drift
# out of sync in one of the three copies.
# Usage: run_bounded_powershell_capture <bound-seconds> <script>
run_bounded_powershell_capture() {
  local bound="$1"
  local script="$2"
  local outfile status line cr
  # One output file per call, named from the calling shell's pid and a counter,
  # under the directory mktemp would use, created empty with a builtin so no
  # mktemp process runs. Every caller runs this in a command substitution, so
  # the counter is discarded with that subshell and the pid alone keeps calls
  # apart, a call inside a trap handler included. The file is removed once it is read: a call that
  # outlived its bound may still hold a file open, and a fresh file per call
  # keeps whatever it writes late out of the next call's read.
  PS_CAPTURE_SEQ=$(( ${PS_CAPTURE_SEQ:-0} + 1 ))
  outfile="${TMPDIR:-/tmp}/supervise-ps.$BASHPID.$PS_CAPTURE_SEQ"
  : > "$outfile"
  run_bounded_powershell "$bound" "$script" "$outfile"
  status=$?
  # The output is read back with the shell's own `read`, each line with its
  # CRs removed, and the self-reported "PSPID:<pid>" line (R92, above) is
  # dropped: it is run_bounded_powershell's own bookkeeping, never part of
  # the script's own output, so no caller's sentinel or pair parsing ever
  # sees it. A last line with no newline is printed with one. The CR is
  # built with `printf -v` for the reason read_ps_self_pid gives.
  printf -v cr '\r'
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line//"$cr"/}
    case "$line" in
      PSPID:*) case "${line#PSPID:}" in *[!0-9]*) printf '%s\n' "$line" ;; esac ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$outfile"
  rm -f "$outfile"
  return "$status"
}

# --- Helper: the PowerShell descendant walk, over a process table it is
# handed ---
# Prints the definition of a PowerShell function, `Select-ProcessTree
# <rows> <rootId>`. `<rows>` is a process table, one object per process
# carrying `ProcessId`, `ParentProcessId` and `CreationDate`, the shape
# `Get-CimInstance Win32_Process` returns. The function returns an object
# whose `Ids` are the root's descendants, root excluded, and whose
# `Unverified` is true where the walk met a candidate it could not judge.
#
# A process is accepted as a child only where its own creation time is not
# earlier than its parent's. Windows keeps a dead parent's id in every
# orphan that parent left and hands the id out again, so a process whose
# ParentProcessId names a tree member but which was created before that
# member is an orphan of an earlier holder of the id. It is no part of this
# tree, and neither is anything under it. Following the parent id alone
# would put it on the kill list every caller of the snapshot acts on.
#
# A candidate whose own creation time, or whose parent's, cannot be read is
# not accepted, since nothing tells it apart from such an orphan. That
# includes every row naming a root that is absent from the table. Leaving
# it out keeps it off the kill list, and `Unverified` reports that the walk
# could not account for it, so a caller reads the tree as unverified rather
# than as complete.
#
# The table is an argument rather than a query inside the function so that
# a test can drive this exact walk against a synthetic table.
# Usage: process_tree_walk_ps
process_tree_walk_ps() {
  cat <<'PS'
    function Select-ProcessTree($rows, $rootId) {
      $created = @{}
      $byParent = @{}
      foreach ($r in @($rows)) {
        $rid = [int64]$r.ProcessId
        $created[$rid] = $r.CreationDate
        $rpp = [int64]$r.ParentProcessId
        if (-not $byParent.ContainsKey($rpp)) { $byParent[$rpp] = New-Object System.Collections.ArrayList }
        [void]$byParent[$rpp].Add($r)
      }
      $accepted = New-Object 'System.Collections.Generic.List[long]'
      $seen = New-Object 'System.Collections.Generic.HashSet[long]'
      $pending = New-Object 'System.Collections.Generic.Queue[long]'
      $unverified = $false
      [void]$seen.Add([int64]$rootId)
      $pending.Enqueue([int64]$rootId)
      while ($pending.Count -gt 0) {
        $parentId = $pending.Dequeue()
        if (-not $byParent.ContainsKey($parentId)) { continue }
        $parentCreated = $created[$parentId]
        foreach ($c in $byParent[$parentId]) {
          $cid = [int64]$c.ProcessId
          if ($cid -eq $parentId) { continue }
          if ($null -eq $parentCreated -or $null -eq $c.CreationDate) {
            $unverified = $true
            continue
          }
          if ($c.CreationDate -lt $parentCreated) { continue }
          if (-not $seen.Add($cid)) { continue }
          $accepted.Add($cid)
          $pending.Enqueue($cid)
        }
      }
      [pscustomobject]@{ Ids = $accepted.ToArray(); Unverified = $unverified }
    }
PS
}

# --- Helper: snapshot a Windows pid's whole descendant tree, without
# killing anything ---
# Walking Win32_Process's ParentProcessId *after* the root pid has
# already been signaled would read a tree that may no longer exist, or
# worse, a *recycled* pid the OS reused for an unrelated process -
# Windows keeps a dead process's ParentProcessId association and reuses
# pids quickly, so a late walk from `$winpid` could find and then
# force-kill something that was never part of this tree at all. This
# function only ever reads; the snapshot it returns is what stop_child
# kills, at whatever point stop_child chooses to kill it - never a live
# re-walk. The walk itself is `process_tree_walk_ps`, which accepts a child
# only where it is not older than its parent and marks a walk that met a
# child it could not judge; this function reads that mark as an unverified
# snapshot. A visited set stops a cycle (a recycled pid pointing back into
# the same tree) from looping forever.
#
# A snapshot of bare pids is not enough - up to two minutes can pass
# between this snapshot and the kill/verify that acts on it (the EOF and
# TERM grace periods), during which a short-lived descendant (a hook's
# own `node`, a `git`) can exit and have its pid reused by an unrelated
# process. Each line is `pid,startticks`, so every later consumer can tell a
# genuinely surviving process from a same-numbered impostor by comparing tick
# values, not just pid presence.
#
# The ticks are tied to the process table the walk judged. A pid is listed
# only where that table holds a row for it, the root included, and only where
# `Get-Process`'s `StartTime` for the pid agrees with that row's
# `CreationDate`. `CreationDate` carries microseconds and `StartTime` carries
# 100-nanosecond ticks, so the two agree where the live ticks, floored to a
# whole microsecond, equal the row's. The line records the live ticks, which
# is the value `check_snapshot_survivors` and `kill_process_snapshot` compare
# against. A pid whose live start time disagrees with its row is held by a
# process the walk never judged, so the whole snapshot reads as unverified. A
# pid with no row is not in the table the walk judged, and is left out.
#
# This call is bounded like the kill and verify calls below it - a hung
# CIM query here wedges stop_child exactly as one in the kill path would.
# GNU `timeout` does not actually hold on this box; the bound is
# `run_bounded_powershell`, not `timeout`.
#
# Output is piped through `tr -d '\r'`: PowerShell emits CRLF even under
# `-NoProfile`, and an unstripped `\r` embedded in a pid produces a
# `Missing expression after unary operator ','` PowerShell parse error at
# the kill call, and a second, quieter failure at the per-pid liveness
# probe (`-ErrorAction` parsed as a second statement). Stripped once,
# here, at the source, so nothing downstream ever sees a `\r` at all.
#
# A process whose `StartTime` is unreadable (access denied, a transient
# race, or a protected process that reads back no start time), or whose row
# carries no `CreationDate`, emits the literal marker `UNREADABLE` in the
# ticks field rather
# than a bare `pid,` with nothing after the comma, so `check_snapshot_
# survivors` below can treat it as an automatic, unconditional survivor
# rather than silently discarding it: kept on the kill list but dropped
# from a digit-validated survivor check would leave it never confirmed
# dead either way.
#
# A caller tells a timeout or PowerShell failure apart from a genuinely
# empty tree by this function's own return code:
# `run_bounded_powershell_capture` returns its bound status directly, so
# no local `pipefail` scoping is needed here to preserve it through a
# pipe.
#
# This is the single place a snapshot is produced, so it is where this
# supervisor's own Windows pid is refused: the walk follows Windows
# ParentProcessId, Windows recycles that id, and a recycled parent id is
# enough to pull a process that is no part of the tree being walked into
# the result a caller will later kill. A self pid appearing anywhere in
# the walk refuses the whole snapshot rather than dropping that one row,
# since every process the walk reached through this one is under it in a
# tree this process is no part of. A self pid this cannot resolve at all
# is refused the same way, since a filter that cannot name what it must
# exclude has nothing to exclude it by, and every caller already reads a
# non-zero return as a tree it may not act on.
#
# The root pid is validated as digits at entry, the way the two functions
# that consume this output validate every pair they are handed: this
# builds a PowerShell command with that value interpolated into it, so a
# value that is not a number has no safe reading here.
# Usage: snapshot_process_tree <windows-pid>
snapshot_process_tree() {
  local winpid="$1"
  if [ -z "$winpid" ]; then
    return 0
  fi
  case "$winpid" in
    *[!0-9]*)
      log_diag "STOP: a walk was asked for from '$winpid', which is not a Windows pid - refusing to build a process walk around it"
      return 1
      ;;
  esac
  local self_winpid
  self_winpid=$(resolve_windows_pid "$$")
  if [ -z "$self_winpid" ]; then
    log_diag "STOP: this supervisor's own Windows pid does not resolve, so a walk under $winpid cannot be filtered of it - reporting the snapshot unverified rather than recording one that may name this process"
    return 1
  fi
  if [ "$winpid" = "$self_winpid" ]; then
    log_diag "STOP: a walk was asked for from this supervisor's own Windows pid $winpid - refusing to snapshot this process's own tree"
    return 1
  fi
  # The process table is read once, in one query, and the walk runs over
  # that table, so every creation time the walk compares comes from the
  # same reading. A failed query sets a flag and the script emits a bare
  # `CIMFAIL` line after the id loop, from the top-level script, so the
  # marker reaches real stdout rather than joining the id list. A walk that
  # met a child it could not judge emits `WALKUNVERIFIED` the same way, and a
  # root that has no row while a live process still holds its id emits
  # `ROOTUNJUDGED`. The id list is filtered with a numeric-string match rather than an
  # `-is [int]` type check, so a stray non-numeric value never reaches
  # `Get-Process -Id`.
  local raw
  raw=$(run_bounded_powershell_capture "$SUPERVISOR_PS_BOUND_S" "
      $(process_tree_walk_ps)
      \$cimFailed = \$false
      \$rows = @()
      try {
        \$rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate -ErrorAction Stop)
      } catch {
        \$cimFailed = \$true
      }
      \$walk = Select-ProcessTree \$rows $winpid
      \$rowCreated = @{}
      foreach (\$r in \$rows) { \$rowCreated[[int64]\$r.ProcessId] = \$r.CreationDate }
      \$ticksMismatch = \$false
      \$rootUnjudged = \$false
      \$ids = @($winpid) + @(\$walk.Ids) | Where-Object { \$_ -match '^[0-9]+\$' }
      foreach (\$thisId in \$ids) {
        if (-not \$rowCreated.ContainsKey([int64]\$thisId)) {
          if ([int64]\$thisId -eq [int64]$winpid) {
            \$rootProc = Get-Process -Id \$thisId -ErrorAction SilentlyContinue
            if (\$rootProc) { \$rootUnjudged = \$true }
          }
          continue
        }
        \$rowWhen = \$rowCreated[[int64]\$thisId]
        \$proc = Get-Process -Id \$thisId -ErrorAction SilentlyContinue
        if (-not \$proc) { continue }
        \$started = \$null
        try { \$started = \$proc.StartTime } catch {}
        if (\$null -eq \$rowWhen -or \$null -eq \$started) {
          Write-Output (\"\$thisId,UNREADABLE\")
          continue
        }
        \$liveTicks = [int64]\$started.Ticks
        \$rowTicks = [int64]\$rowWhen.Ticks
        if (\$liveTicks -ne \$rowTicks -and (\$liveTicks - (\$liveTicks % 10)) -ne \$rowTicks) {
          \$ticksMismatch = \$true
          continue
        }
        Write-Output (\"\$thisId,\" + \$liveTicks)
      }
      if (\$cimFailed) { Write-Output 'CIMFAIL' }
      if (\$walk.Unverified) { Write-Output 'WALKUNVERIFIED' }
      if (\$ticksMismatch) { Write-Output 'TICKSMISMATCH' }
      if (\$rootUnjudged) { Write-Output 'ROOTUNJUDGED' }
      Write-Output '$STOP_PS_SENTINEL'
    ")
  # A CIM query that fails (WMI down, a transient RPC error) under
  # `-ErrorAction SilentlyContinue` would silently yield an empty children
  # list - the walk still finishes, the sentinel still gets written, and a
  # root-only snapshot (missing every real descendant) reports rc 0. A
  # timed-out walk really does yield nothing (the sentinel gates that),
  # but a *failed* walk should not read the same way. `-ErrorAction Stop`
  # inside a `try`/`catch` turns that failure into an explicit `CIMFAIL`
  # marker in the output, checked before trusting the snapshot.
  if ps_output_has_line "$raw" 'CIMFAIL'; then
    log_diag "STOP: snapshot_process_tree's own CIM query failed mid-walk - treating the snapshot as unverified rather than trusting a possibly-incomplete tree"
    return 1
  fi
  # A child left out because its creation time, or its parent's, could not
  # be read is off the kill list, and the tree it may belong to is not
  # accounted for. So the snapshot is unverified, which every caller already
  # reads as a tree it may neither kill from nor call clean.
  if ps_output_has_line "$raw" 'WALKUNVERIFIED'; then
    log_diag "STOP: the walk under $winpid met a process whose creation time, or its parent's, could not be read - treating the snapshot as unverified rather than trusting a tree that leaves it out"
    return 1
  fi
  # A pid whose live start time disagrees with the row the walk judged is held
  # by a different process than the one the walk accepted, so the snapshot
  # cannot say which of the two its line would name.
  if ps_output_has_line "$raw" 'TICKSMISMATCH'; then
    log_diag "STOP: the walk under $winpid names a pid whose live start time disagrees with the process table the walk judged - treating the snapshot as unverified rather than recording a process the walk never judged"
    return 1
  fi
  # The root is this walk's argument rather than a row the walk found, so a
  # root with no row in the table is a pid the walk never judged and is left
  # off the kill list. Whether that is the whole answer depends on the pid: a
  # root that exited between the walk and the table read leaves an honestly
  # empty tree, while a root a live process still holds cannot have been
  # missing from a table read across its own lifetime. That reading is a
  # partial enumeration, so the tree under it is unaccounted for and the whole
  # walk is unverified rather than an empty result a caller would call clean.
  if ps_output_has_line "$raw" 'ROOTUNJUDGED'; then
    log_diag "STOP: the walk under $winpid found no process table row for that root while a live process still holds the id - treating the snapshot as unverified rather than reporting an empty tree under a root the table never named"
    return 1
  fi
  if ps_output_has_line "$raw" "$STOP_PS_SENTINEL"; then
    # A line opening with the self pid and a comma names this process, and
    # the match is the shell's own, so the check starts no process.
    case $'\n'"$raw" in
      *$'\n'"$self_winpid,"*)
        log_diag "STOP: the tree walked under $winpid reaches this supervisor's own Windows pid $self_winpid, so every process in it was reached through this process - reporting the whole walk unverified rather than the part of it that sits outside this tree"
        return 1
        ;;
    esac
    local line
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      [ "$line" = "$STOP_PS_SENTINEL" ] && continue
      printf '%s\n' "$line"
    done <<< "$raw"
    return 0
  fi
  # `powershell -Command`'s own exit code reflects whether its LAST
  # statement succeeded, not an aggregate error count, so a completely
  # normal "the pid is already gone" result cannot be trusted as
  # completion on its own. The sentinel line above is what actually
  # decides completion; its absence here means the call was force-killed
  # on the run_bounded_powershell timeout before reaching it, or
  # genuinely crashed - either way the walk did not finish.
  return 1
}

# --- Helper: which pids in a snapshot are still the SAME live process ---
# Shared by verify_snapshot_dead (does anything need escalating) and
# kill_process_snapshot (did the kill actually work) so the recycled-pid
# comparison and the CR-stripped, timeout-wrapped read live in exactly
# one place. A survivor is a pid that is both alive right now AND whose
# current `StartTime.Ticks` still matches the value recorded in the
# snapshot - a live pid with a different start time is a different,
# unrelated process that happens to share a number.
#
# A pid whose `StartTime` came back `UNREADABLE` from the snapshot is
# reported as a survivor only while a process with that pid still exists
# (checked by a plain existence probe, since its start time cannot be
# compared), never unconditionally: a pid this cannot resolve at all must
# fail closed rather than open, but one that no longer exists is
# genuinely gone. On an unverified call (the sentinel missing), this
# returns nothing and status 1 rather than the full checked-id list,
# since a caller that force-kills a returned list as confirmed survivors
# is killing by bare pid number with no start-time match at all - a mass
# kill of whatever now holds those recycled numbers. A caller escalates
# on silence it cannot trust rather than on nothing.
#
# Every diagnostic here goes through `log_diag` (stderr and the log file
# only), never plain `log`, because this function's own stdout is what a
# caller parses as the survivor list; a `log` call here would ride into
# that parsed result as a phantom entry.
# Usage: check_snapshot_survivors <snapshot, "pid,ticks" per line>
check_snapshot_survivors() {
  local snapshot="$1"
  if [ -z "$snapshot" ]; then
    return 0
  fi
  local pairs="" unreadable="" sid sticks
  while IFS=',' read -r sid sticks; do
    case "$sid" in ''|*[!0-9]*) continue ;; esac
    case "$sticks" in
      ''|*[!0-9]*) unreadable="$unreadable,$sid"; continue ;;
    esac
    pairs="$pairs,@{Id=$sid;Ticks=$sticks}"
  done <<< "$snapshot"
  pairs="${pairs#,}"
  unreadable="${unreadable#,}"
  if [ -z "$pairs" ] && [ -z "$unreadable" ]; then
    # Reaching here means $snapshot was non-empty (the early
    # `-z "$snapshot"` return above already handles a genuinely empty
    # one) but nothing in it parsed as a valid pid entry - that is a
    # parse failure, not "nothing to check", and does not read as a
    # clean, verified result.
    log_diag "STOP: check_snapshot_survivors got a non-empty snapshot with no parseable pid entries - treating as unverified"
    return 1
  fi
  # `StartTime` can throw at read time - a transient race, not just at
  # snapshot time. Under `-Command`, an unguarded throw would abort only
  # that one loop iteration; the loop would continue, the sentinel would
  # still get written, and the whole call would report rc-equivalent
  # success with the live process silently omitted - reported dead, never
  # a survivor, never killed. Guarded the same way the snapshot walk
  # already is.
  local raw
  raw=$(run_bounded_powershell_capture "$SUPERVISOR_PS_BOUND_S" "
      foreach (\$e in @($pairs)) {
        \$proc = Get-Process -Id \$e.Id -ErrorAction SilentlyContinue
        try {
          if (\$proc -and \$proc.StartTime.Ticks -eq \$e.Ticks) { Write-Output \$e.Id }
        } catch { if (\$proc) { Write-Output \$e.Id } }
      }
      foreach (\$u in @($unreadable)) {
        \$proc = Get-Process -Id \$u -ErrorAction SilentlyContinue
        if (\$proc) { Write-Output \$u }
      }
      Write-Output '$STOP_PS_SENTINEL'
    ")
  if ! ps_output_has_line "$raw" "$STOP_PS_SENTINEL"; then
    log_diag "STOP: check_snapshot_survivors's powershell call did not complete - reporting failure, not a survivor list"
    return 1
  fi
  # Every line but the sentinel is the survivor list, printed line by line
  # with builtins so the read starts no process.
  local line
  while IFS= read -r line; do
    [ "$line" = "$STOP_PS_SENTINEL" ] && continue
    printf '%s\n' "$line"
  done <<< "$raw"
  return 0
}

# --- Helper: force-kill every pid in a snapshot, with a bounded wait and
# a verified result ---
# A PowerShell error swallowed unconditionally would report success even
# when a slow or hung CIM query wedges stop_child - which the EXIT trap
# also calls, wedging the supervisor itself on shutdown. So
# `run_bounded_powershell` bounds the PowerShell call; its own exit
# status is captured (not discarded); and every pid in the snapshot is
# re-checked (via check_snapshot_survivors, matching both pid and start
# time) rather than trusted from Stop-Process's own silence. Logs
# `kill_failed` naming exactly which pids survived, if any do, and
# returns non-zero so a caller can tell.
#
# Stripping the start time and running `Stop-Process -Id $p -Force` on a
# bare pid number would turn an unverified probe upstream into a kill of
# whatever now holds those pid numbers, recycled or not. Kills only pairs
# where `Get-Process -Id` still finds the pid AND its `StartTime.Ticks`
# still matches what was recorded in the snapshot - the same match
# `check_snapshot_survivors` uses to decide who's a real survivor in the
# first place.
#
# Force-killing an `UNREADABLE`-ticks pid by bare existence alone would
# kill by number, not by identity, once that pid is recycled during the
# grace window: its start time was unreadable at snapshot time, so
# existence is the only check available for it. `check_snapshot_
# survivors` still reports one as a survivor by existence, but this
# function never kills on that report.
#
# A single check here, rather than an internal retry loop stacked
# underneath `retry_stop_escalation`'s own 6-attempt loop, keeps the
# worst-case stop from taking minutes instead of the ~30s bound this
# comment names. `retry_stop_escalation` is the single place that
# retries over time, on its own wall-clock budget.
#
# Returns 0 when every pid in the snapshot is confirmed gone, and 1 when a
# pid is confirmed alive after the kill or the re-check itself could not be
# completed. Both are the same answer to a caller: nothing in this snapshot
# is confirmed dead.
# Usage: kill_process_snapshot <snapshot, "pid,ticks" per line>
kill_process_snapshot() {
  local snapshot="$1"
  if [ -z "$snapshot" ]; then
    return 0
  fi
  local pairs="" sid sticks
  while IFS=',' read -r sid sticks; do
    case "$sid" in ''|*[!0-9]*) continue ;; esac
    case "$sticks" in ''|*[!0-9]*) continue ;; esac
    pairs="$pairs,@{Id=$sid;Ticks=$sticks}"
  done <<< "$snapshot"
  pairs="${pairs#,}"
  if [ -z "$pairs" ]; then
    log "STOP: kill_process_snapshot has no ticks-matched pairs to act on (any UNREADABLE entries are reported, per R91, never killed)"
  else
    # The same unguarded `StartTime` read here, on the kill side, means a
    # throw makes this loop iteration silently skip a pid that should
    # have been killed - never fatal (the pid just survives to be
    # re-checked), but it should never be read as a ticks mismatch and
    # killed on an unverifiable comparison either. The catch is
    # deliberately empty: this script never claims to report anything on
    # its own here, since the caller's own separate `check_snapshot_
    # survivors` call afterward re-examines the same pid independently.
    local raw
    raw=$(run_bounded_powershell_capture "$SUPERVISOR_PS_BOUND_S" "
      foreach (\$e in @($pairs)) {
        \$proc = Get-Process -Id \$e.Id -ErrorAction SilentlyContinue
        try {
          if (\$proc -and \$proc.StartTime.Ticks -eq \$e.Ticks) {
            try { Stop-Process -Id \$e.Id -Force -ErrorAction SilentlyContinue } catch {}
          }
        } catch {}
      }
      Write-Output '$STOP_PS_SENTINEL'
    ")
    if ! ps_output_has_line "$raw" "$STOP_PS_SENTINEL"; then
      log "STOP: kill_process_snapshot's powershell call did not complete (timeout or error)"
    fi
  fi
  local survivors rc
  survivors=$(check_snapshot_survivors "$snapshot")
  rc=$?
  if [ -z "$survivors" ] && [ "$rc" -eq 0 ]; then
    return 0
  fi
  if [ "$rc" -ne 0 ]; then
    log "STOP: kill_unverified - the re-check after the kill did not complete, so nothing in this snapshot is confirmed alive or dead"
    return 1
  fi
  # The pid list is the survivor lines joined by spaces, with a space after
  # the last one, built in the shell so the log line starts no process.
  log "STOP: kill_failed - these Windows pids still hold a live process after the kill: ${survivors//$'\n'/ } "
  return 1
}

# --- Helper: walk an MSYS process's Windows tree, and keep the walk only while
# the MSYS process still runs as that Windows pid ---
# An MSYS pid is resolved to a Windows pid and walked one PowerShell spawn
# later. Windows hands a dead process's id out again, so where the MSYS
# process exits in between, the walk can read whatever now holds that id, and
# every line it returns names a process the child never started. So after the
# walk returns, the MSYS pid must still be running and must still resolve to
# the Windows pid that was walked. Otherwise the walk's lines are discarded.
#
# The liveness check runs ahead of the walk's own return code, and that order
# is what tells two discards apart. An MSYS process that has exited is no part
# of the tree any more, whatever its walk said: the walk read a Windows pid the
# process no longer holds, so an unverified reading of that pid is no more
# evidence about the child's tree than a clean one would be. An MSYS process
# that is still running and now holds a different Windows pid is the other
# case: the process is part of the tree and this walk says nothing about it.
#
# Prints the walk's "pid,ticks" lines on success.
# Returns 0 for a walk that holds, 3 where the MSYS process exited during the
# walk, 4 where it is still running under a different Windows pid, 1 where the
# walk completed and named nothing at all under a root the MSYS pid still
# holds, and the walk's own non-zero code for a walk that did not complete
# under an MSYS process that is still running as the pid walked.
# Usage: walk_msys_process_tree <msys-pid> <windows-pid>
walk_msys_process_tree() {
  local msys_pid="$1" winpid="$2" walked rc now_winpid
  walked=$(snapshot_process_tree "$winpid")
  rc=$?
  if ! kill -0 "$msys_pid" 2>/dev/null; then
    log_diag "CHILDTREE: MSYS pid $msys_pid exited while Windows pid $winpid was walked - discarding that walk, which may have read a process that reused the id"
    return 3
  fi
  if [ "$rc" -ne 0 ]; then
    return "$rc"
  fi
  now_winpid=$(resolve_windows_pid "$msys_pid")
  if [ "$now_winpid" != "$winpid" ]; then
    log_diag "CHILDTREE: MSYS pid $msys_pid runs as Windows pid ${now_winpid:-none} after its walk of Windows pid $winpid - discarding that walk"
    return 4
  fi
  # A completed walk always names its own root, since the root's line is
  # written from the same table row the walk judged it by. So a walk that named
  # nothing at all, while the MSYS process is alive and still runs as the
  # Windows pid that was walked, read a table that did not cover a process
  # living across its own reading. That is a partial enumeration and the tree
  # under it is unaccounted for, the same answer `snapshot_process_tree` gives
  # a root it could not judge, rather than an empty tree a caller would call
  # clean.
  if [ -z "$walked" ]; then
    log_diag "CHILDTREE: the walk of Windows pid $winpid named no process at all while MSYS pid $msys_pid still runs as that pid - reporting the walk unverified rather than an empty tree under a live root"
    return 1
  fi
  printf '%s\n' "$walked"
  return 0
}

# --- Helper: record the live child's process tree, pids and start ticks ---
# The Windows parent chain does not reach the child. `claude` is launched
# through `env`, and the chain read upward from the live child runs `claude`
# under a live `env.exe` under a process id nothing holds any more, the Cygwin
# fork intermediate above `env` having exited: a Win32 walk from the launch pid's
# own Windows pid finds that pid and nothing else. The MSYS process table is where the link survives,
# since it keeps the launch pid as the parent of the `claude` process and
# carries each one's Windows pid beside it. So the tree is read from there, and
# only while the child is alive: an exited process is in neither table.
#
# The Windows pids are then snapshotted the way every other stop-path consumer
# wants them, "pid,ticks" per line, so `check_snapshot_survivors` and
# `kill_process_snapshot` can match a genuine survivor against a recycled pid
# without any further identity check here.
#
# What a poll costs: one `ps` read, plus one `/proc/<pid>/winpid` read per MSYS
# pid in the closure and one for this supervisor itself. The PowerShell walk
# runs only where the Windows pid set differs from the set the standing
# snapshot was walked from, so a child whose tree has settled pays no walk,
# while a child whose walk keeps failing pays one on every poll until a walk
# completes.
refresh_child_tree() {
  local pid="${CHILD_LAUNCH_PID:-}"
  # What this call's walk found, for the liveness verdict: live where it
  # completed and named a live process, none where it completed and found
  # every process gone, failed where it did not complete. Set to failed first,
  # so every return that is not a completed walk reads as one.
  CHILD_TREE_POLL_WALK="failed"
  if [ -z "$pid" ]; then
    return 0
  fi
  # This poll's closure as "msys:winpid" pairs, cleared of this supervisor's
  # own Windows pid. `stop_child` walks each pair again at the stop. Emptied
  # here first, so a poll that cannot name the closure leaves no pairs from an
  # earlier poll standing in for it.
  CHILD_TREE_SEEN_PAIRS=""
  # Descendants are closed over the MSYS table rather than read one level
  # deep: the chain from the launch pid to `claude` is two MSYS processes on some
  # launch shapes and one on others, and a wrapper script adds another.
  local msys_pids
  msys_pids=$(ps 2>/dev/null | awk -v root="$pid" '
    NR > 1 {
      # Cygwin ps prints a state character ahead of the pid for a stopped or
      # an orphaned process, which shifts every column right by one. A row read
      # at the unshifted offsets yields a parent id that is really a pid, so
      # that pid and every descendant under it fall out of the closure, and an
      # orphaned process is exactly what this closure exists to catch. So the
      # shift is detected and the row re-indexed rather than discarded.
      if ($1 ~ /^[0-9]+$/) { id = $1; pp = $2; wp = $4 }
      else if ($2 ~ /^[0-9]+$/) { id = $2; pp = $3; wp = $5 }
      else { next }
      parent[id] = pp
      if (wp ~ /^[0-9]+$/) winpid[id] = wp
    }
    END {
      # Membership is tested with `in` on both sides. A bare `keep[parent[id]]`
      # would create an entry for the parent as a side effect of looking it
      # up, which is how every pid in the table, this supervisor included,
      # ends up in a set that is about to be killed.
      #
      # The passes run until one adds nothing, so a chain of any depth is
      # closed over rather than cut at a fixed count. Each pass adds at least
      # one entry or ends the loop, and the table is finite, so this
      # terminates; a parent-child cycle settles once both its members are in.
      keep[root] = 1
      do {
        added = 0
        for (id in parent) {
          p = parent[id]
          if ((p in keep) && !(id in keep)) { keep[id] = 1; added = 1 }
        }
      } while (added)
      for (id in keep) { if (keep[id] == 1 && (id in winpid)) print id }
    }' | sort -n | tr '\n' ' ')
  msys_pids="${msys_pids% }"
  local winpids="" root_winpid="" pairs=""
  local one
  for one in $msys_pids; do
    local resolved
    resolved=$(resolve_windows_pid "$one")
    if [ -n "$resolved" ]; then
      winpids="$winpids $resolved"
      pairs="$pairs $one:$resolved"
      [ "$one" = "$pid" ] && root_winpid="$resolved"
    fi
  done
  winpids="${winpids# }"
  # An adopted child's launch pid is trusted only while it runs as the Windows
  # pid its handle recorded. A different pid under it is a process the handle
  # never named: the recorded child is no longer the process under that pid,
  # so the child is routed as gone, accounted through its marker and the
  # recorded tree, and the mismatch is logged once rather than on every poll.
  if [ "${CHILD_ADOPTED:-}" = "1" ] && [ -n "${CHILD_WINPID:-}" ] && [ -n "$root_winpid" ] && [ "$root_winpid" != "$CHILD_WINPID" ]; then
    if [ -z "${CHILD_ROOT_MISMATCH_LOGGED:-}" ]; then
      log "CHILDTREE: child-$CHILD_INDEX's launch pid $pid runs as Windows pid $root_winpid, not the $CHILD_WINPID its handle recorded, so the recorded child is no longer under that pid and reads gone; its exit is read from the marker"
      CHILD_ROOT_MISMATCH_LOGGED=1
    fi
    CHILD_TREE_POLL_WALK="none"
    return 0
  fi
  # This list is what a later sweep kills, so the supervisor's own Windows pid
  # is refused outright rather than trusted to be absent. The closure is rooted
  # at the launch pid, which is this process's child, so a self entry can only come
  # from a misread of the process table, and the cost of acting on one is the
  # supervisor killing itself and every session sharing its tree.
  local self_winpid
  self_winpid=$(resolve_windows_pid "$$")
  if [ -z "$self_winpid" ]; then
    log "CHILDTREE: this supervisor's own Windows pid does not resolve on this poll, so child-$CHILD_INDEX's pid set cannot be cleared of it and nothing is recorded from this poll"
    CHILD_TREE_READ_FAILED=1
    CHILD_TREE_FAILED_CONFIRMS=$(( ${CHILD_TREE_FAILED_CONFIRMS:-0} + 1 ))
    return 0
  fi
  local safe="" safe_pairs=""
  for one in $pairs; do
    if [ "${one#*:}" = "$self_winpid" ]; then
      log "CHILDTREE: refusing this supervisor's own Windows pid ${one#*:} in child-$CHILD_INDEX's tree"
      continue
    fi
    safe="$safe ${one#*:}"
    safe_pairs="$safe_pairs $one"
  done
  winpids="${safe# }"
  pairs="${safe_pairs# }"
  CHILD_TREE_SEEN_PAIRS="$pairs"
  if [ -z "$winpids" ]; then
    # A poll that resolves no Windows pid at all reads as "nothing to add":
    # the standing record is what the child was last seen running as, and a
    # momentary gap in the process table is not evidence the tree changed.
    #
    # Where the closure did name MSYS processes and none of them resolved,
    # the child's own processes are there and this poll could not name any of
    # them in Windows terms. That is a failed read rather than a child with no
    # Windows process, and the two have to stay apart: only the second is a
    # tree there is nothing to sweep.
    #
    # A closure whose every process has stopped running is not a failed read.
    # The process table is read once at the top of this function and each
    # pid's Windows id a moment later, so a child that exits at once can leave
    # a closure naming the launch pid and a short-lived process under it, all
    # gone by the lookup, which then resolves to nothing. With none of them
    # running there is nothing left for this poll to have failed to name, and a
    # child that dies at launch reaches the crash path rather than exit 5.
    #
    # Each member is checked, not only the launch pid. The wrapper dying says
    # nothing about the processes under it, and a live one that did not resolve
    # is a survivor nothing here can name. An MSYS pid reused by an unrelated
    # process reads as running too, which keeps this a failed read.
    #
    # For the liveness verdict, this poll's walk reads none only where every
    # member of the closure and the launch pid itself have exited. A member or
    # a launch pid that still answers makes it failed, a walk that did not
    # complete, so a live child is never read as gone.
    CHILD_TREE_POLL_WALK="none"
    if [ -n "$msys_pids" ]; then
      for one in $msys_pids; do
        if kill -0 "$one" 2>/dev/null; then
          CHILD_TREE_READ_FAILED=1
          CHILD_TREE_POLL_WALK="failed"
          break
        fi
      done
    fi
    if [ "$CHILD_TREE_POLL_WALK" = "none" ] && kill -0 "$pid" 2>/dev/null; then
      CHILD_TREE_POLL_WALK="failed"
    fi
    CHILD_TREE_FAILED_CONFIRMS=$(( ${CHILD_TREE_FAILED_CONFIRMS:-0} + 1 ))
    return 0
  fi
  if [ "$winpids" = "${CHILD_TREE_WINPIDS:-}" ]; then
    # The child is running as the pid set the standing record was walked
    # from, which is this poll confirming that record still describes the
    # tree. The stamp is what `child_tree_record_state` reads to tell a
    # record confirmed a moment ago from one no poll has confirmed in a
    # while.
    CHILD_TREE_SEEN_WINPIDS="$winpids"
    # The shell's own clock rather than `date`: this branch is the one a
    # settled child takes on every poll, and it launches nothing.
    printf -v CHILD_TREE_CONFIRMED_AT '%(%s)T' -1
    CHILD_TREE_FAILED_CONFIRMS=0
    CHILD_TREE_POLL_WALK="live"
    return 0
  fi
  # A closure member that exited inside its own walk is left out of this poll
  # rather than read as a walk this poll could not complete. The child's own
  # short-lived helpers - a `node` the agent spawns, a hook's `git` - come and
  # go inside one poll, and every one of them lands here. Treating each as an
  # unreadable tree would leave the record permanently behind the pid set,
  # which is the state that refuses every later stop and sweep. What the
  # member left behind, if anything, is an orphan no walk can name once its
  # MSYS parent is gone, and the next launch's own persona gate is what meets
  # that, exactly as it meets one under a record that never named a
  # descendant.
  local snapshot="" walked rc live_pairs="" live_winpids="" live_msys=""
  for one in $pairs; do
    walked=$(walk_msys_process_tree "${one%%:*}" "${one#*:}")
    rc=$?
    if [ "$rc" -eq 3 ]; then
      log "CHILDTREE: MSYS pid ${one%%:*} exited inside its own walk, so child-$CHILD_INDEX's pid set for this poll leaves out the Windows pid ${one#*:} it ran as"
      continue
    fi
    if [ "$rc" -ne 0 ]; then
      # A walk that did not complete under a live MSYS process, or one
      # discarded because that process now runs as another Windows pid, would
      # leave a partial record standing in for the whole tree, which is what a
      # later sweep would then call clean. The standing record is kept
      # instead, the next poll tries again, and CHILD_TREE_SEEN_WINPIDS is
      # what tells a sweep that the record is behind the tree.
      CHILD_TREE_SEEN_WINPIDS="$winpids"
      CHILD_TREE_FAILED_CONFIRMS=$(( ${CHILD_TREE_FAILED_CONFIRMS:-0} + 1 ))
      log "CHILDTREE: the walk under Windows pid ${one#*:} did not complete or was discarded (rc=$rc) - the standing tree record is kept and is now older than child-$CHILD_INDEX's Windows pid set"
      return 0
    fi
    live_pairs="$live_pairs ${one}"
    live_winpids="$live_winpids ${one#*:}"
    live_msys="$live_msys ${one%%:*}"
    if [ -n "$walked" ]; then
      snapshot="$snapshot$walked
"
    fi
  done
  live_pairs="${live_pairs# }"
  live_winpids="${live_winpids# }"
  live_msys="${live_msys# }"
  if [ -z "$live_winpids" ]; then
    # Every member of this poll's closure exited inside its own walk, which is
    # the shape a child that dies at launch leaves: there is nothing left for
    # this poll to have read, so it adds nothing and the standing record and
    # the pid set seen under the child both stand as they were.
    log "CHILDTREE: every process in child-$CHILD_INDEX's closure exited inside its own walk on this poll, so this poll records nothing"
    CHILD_TREE_FAILED_CONFIRMS=$(( ${CHILD_TREE_FAILED_CONFIRMS:-0} + 1 ))
    # Every member exited inside its walk. A launch pid that still answers is
    # a closure this poll could not read whole, not a child with nothing live.
    CHILD_TREE_POLL_WALK="none"
    if kill -0 "$pid" 2>/dev/null; then
      CHILD_TREE_POLL_WALK="failed"
    fi
    return 0
  fi
  # `snapshot_process_tree` refuses this supervisor's own Windows pid inside
  # every tree it walks, so what arrives here is already clear of it.
  snapshot=$(printf '%s' "$snapshot" | grep -v '^$' | sort -u)
  # The pid set this poll walked, and so the set the record now describes. A
  # member that exited inside its own walk is out of all four.
  CHILD_TREE_MSYS_PIDS="$live_msys"
  CHILD_TREE_SEEN_PAIRS="$live_pairs"
  CHILD_TREE_SEEN_WINPIDS="$live_winpids"
  CHILD_TREE_WINPIDS="$live_winpids"
  CHILD_TREE_SNAPSHOT="$snapshot"
  CHILD_TREE_WALKED=1
  printf -v CHILD_TREE_CONFIRMED_AT '%(%s)T' -1
  CHILD_TREE_FAILED_CONFIRMS=0
  CHILD_TREE_POLL_WALK="live"
  # Whether any walk has yet named a Windows process other than the one the
  # child's own launch pid runs as. The first refresh runs in the instant
  # after the launch, before the agent process under it exists, so a
  # record taken then names the wrapper and nothing else. A child that dies
  # inside the first poll interval would otherwise be swept against that
  # record and reported clean while the process the sweep exists to catch was
  # never in it.
  if [ -z "${CHILD_TREE_DESCENDANT_SEEN:-}" ]; then
    local snap_line snap_pid
    while IFS= read -r snap_line; do
      snap_pid="${snap_line%%,*}"
      if [ -n "$snap_pid" ] && [ "$snap_pid" != "$root_winpid" ]; then
        CHILD_TREE_DESCENDANT_SEEN=1
        break
      fi
    done <<< "$snapshot"
  fi
  log "CHILDTREE: child-$CHILD_INDEX runs as Windows pid(s) $live_winpids (MSYS $live_msys)"
}

# --- Helper: why the recorded child tree reads stale, if it does ---
# Prints the reason, in the words the sweep's own line carries, and prints
# nothing at all while the record still holds. `child_tree_record_state`'s
# verdict is read off this same call, so the verdict and the line that
# explains it can never name different reasons.
#
# There are two bounds, and they answer different failures.
#
# The first is polls that stopped confirming the record. Three is that bound,
# because the child can die just after a poll and the poll that finds it dead
# runs a full round of its own work first, which leaves two ordinary polls
# between the last confirmation and the sweep.
#
# The second is the age of the confirmation itself. A count alone cannot see a
# box that suspends for hours between the poll that last confirmed the record
# and the child's death: one poll runs on resume, the counter reaches 1, and a
# record walked hours ago reads clean. So a confirmation also expires, at ten
# poll intervals or five minutes, whichever is longer. Ten rather than three,
# because a poll body's own work varies by tens of seconds on a loaded box and
# a three-interval bound fired on a run where every poll confirmed the record.
# Ten intervals and the five-minute floor both sit far outside that variance
# and far inside any suspend.
child_tree_stale_reason() {
  if [ "${CHILD_TREE_FAILED_CONFIRMS:-0}" -ge 3 ]; then
    echo "${CHILD_TREE_FAILED_CONFIRMS} polls in a row ran without confirming child-$CHILD_INDEX's recorded tree against the live process table"
    return 0
  fi
  # A walked record carries the stamp of the poll that walked it. One without a
  # stamp is a record no poll is known to have confirmed at all, which is the
  # same answer as one nothing has confirmed in three polls.
  if [ -z "${CHILD_TREE_CONFIRMED_AT:-}" ]; then
    echo "no poll is known to have confirmed child-$CHILD_INDEX's recorded tree at all"
    return 0
  fi
  local ceiling=$(( (${SUPERVISOR_POLL_MS:-10000} / 1000) * 10 ))
  if [ "$ceiling" -lt 300 ]; then
    ceiling=300
  fi
  if [ "$(( $(date +%s) - CHILD_TREE_CONFIRMED_AT ))" -ge "$ceiling" ]; then
    echo "no poll has confirmed child-$CHILD_INDEX's recorded tree inside the ${ceiling}s ceiling this poll interval sets"
    return 0
  fi
  return 0
}

# --- Helper: what the recorded child tree is worth right now ---
# Every reader of `CHILD_TREE_SNAPSHOT` needs the same three-way answer before
# it acts on that record, so the reading lives here rather than at each call
# site: a record read without it stands in for the whole tree when it covers
# part of one, and a partial record verified clean is how a `claude.exe` that
# the record never named goes unnoticed while it holds the persona claim.
#
# Only `whole` licenses a clean verdict. Everything else names a way the
# record falls short of the tree it claims to describe, and each one is a
# separate state so the sweep's own line says which.
#
# Prints one of:
#   none          - no Windows process was ever seen under this child, and
#                   every reading this child got completed
#   unread        - a reading failed, or a Windows pid set was seen and no
#                   walk of it ever completed
#   no_descendant - a walk completed and named only the process the child's
#                   own launch pid runs as, so nothing under the wrapper has
#                   ever been in the record
#   stale         - the record was walked from the child's pid set and
#                   nothing has confirmed it against the live tree since,
#                   either for three polls in a row or for longer than the
#                   age ceiling, so a process could have appeared under it
#                   unseen
#   behind        - the record was walked from one pid set and the child
#                   moved to another afterwards, so it describes part of the
#                   tree
#   whole         - the record was walked from the pid set the child is
#                   running as, a poll confirmed that recently, and it names
#                   a process under the wrapper
child_tree_record_state() {
  if [ -z "${CHILD_TREE_WALKED:-}" ]; then
    if [ -n "${CHILD_TREE_SEEN_WINPIDS:-}" ] || [ -n "${CHILD_TREE_READ_FAILED:-}" ]; then
      echo "unread"
      return 0
    fi
    echo "none"
    return 0
  fi
  if [ "${CHILD_TREE_SEEN_WINPIDS:-}" != "${CHILD_TREE_WINPIDS:-}" ]; then
    echo "behind"
    return 0
  fi
  if [ -z "${CHILD_TREE_DESCENDANT_SEEN:-}" ]; then
    echo "no_descendant"
    return 0
  fi
  # Both stale bounds live in `child_tree_stale_reason`, which the sweep's own
  # line reads too, so the verdict here and the reason printed there are one
  # reading rather than two that can drift apart.
  if [ -n "$(child_tree_stale_reason)" ]; then
    echo "stale"
    return 0
  fi
  echo "whole"
}

# --- Helper: how long ago a poll last confirmed the recorded child tree ---
# Printed in the sweep's own clean line, since a clean verdict is only worth
# the age of the record it was read off.
child_tree_record_age_s() {
  if [ -z "${CHILD_TREE_CONFIRMED_AT:-}" ]; then
    echo "unknown"
    return 0
  fi
  echo "$(( $(date +%s) - CHILD_TREE_CONFIRMED_AT ))s"
}

# --- Helper: kill whatever outlived the child, from the recorded tree ---
# A `claude.exe` whose wrapper died still holds the persona claim, and the next
# child would spend the whole 120s pre-launch gate waiting on that claim and
# then exit 2. Nothing can name that process once its wrapper is gone, so this
# reads the record taken while the child ran; every entry carries the start
# ticks of the process it named, so a pid Windows has recycled onto something
# else is neither reported as a survivor nor killed.
#
# Where a retry of the same record can still settle the question, the snapshot
# is left in LAST_STOP_SNAPSHOT, so `retry_stop_escalation` retries that tree
# and the EXIT trap re-verifies it. A record that is behind the tree is the one
# failure that is left out of LAST_STOP_SNAPSHOT: retrying it would confirm the
# processes it does name dead and report a clean tree, which is the verdict
# that branch exists to refuse.
#
# Each leg opens with a stable token after the label, so a caller or a test
# reads the outcome from that token rather than from the prose beside it.
#
# Returns 0 when nothing of the child is left alive or every survivor was
# confirmed dead, 2 when there is no tree for anything to have outlived, which
# covers a child no Windows process was ever seen under and a completed walk
# that found nothing under the wrapper, and 1 for every outcome where a process
# is alive or no reading could account for the tree: a survivor the kill did
# not settle, a walk that never completed, a record no poll has confirmed in a
# while, and a record the child's pid set moved past.
# `child_tree_record_state` names those ways one by one and the log line
# carries the one that fired.
# Usage: sweep_child_tree <label>
sweep_child_tree() {
  local label="$1"
  case "$(child_tree_record_state)" in
    none)
      log "SWEEP[$label] no_tree: no Windows process was ever seen under child-$CHILD_INDEX, so there is no tree it could have left behind"
      return 2
      ;;
    unread)
      log "SWEEP[$label] tree_unread: child-$CHILD_INDEX ran as Windows pid(s) ${CHILD_TREE_SEEN_WINPIDS:-none that resolved} and no walk of that tree ever completed, so what it left behind cannot be read"
      return 1
      ;;
    no_descendant)
      # The walk completed and found nothing under the wrapper. A child that
      # exits inside its first poll interval is swept against exactly that
      # record, since the walk taken right after the launch runs before
      # the agent process exists. Nothing named means nothing to sweep, and a
      # process that did appear and outlive the wrapper is met by the next
      # launch's own persona gate, which waits on the claim and ends the run
      # rather than running a second child beside the first.
      log "SWEEP[$label] record_no_descendant: child-$CHILD_INDEX's recorded tree names only the process its own launch pid runs as, so nothing that ran under that wrapper was ever in it"
      return 2
      ;;
    stale)
      log "SWEEP[$label] record_stale: $(child_tree_stale_reason), last confirmed $(child_tree_record_age_s) ago, so a process could have appeared under it unseen and no reading of it is a clean result"
      return 1
      ;;
    behind)
      # The record was walked from one Windows pid set and the child moved to
      # another before any later walk completed, so it describes part of the
      # tree. Reading an empty survivor list off it would call the child clean
      # while a process the record never named holds the persona claim.
      log "SWEEP[$label] record_behind_tree: child-$CHILD_INDEX's recorded tree was walked from Windows pid(s) ${CHILD_TREE_WINPIDS} and its pid set moved to ${CHILD_TREE_SEEN_WINPIDS} after that, so this record covers part of the tree and no reading of it is a clean result"
      if [ -n "${CHILD_TREE_SNAPSHOT:-}" ]; then
        if kill_process_snapshot "$CHILD_TREE_SNAPSHOT"; then
          log "SWEEP[$label] record_behind_tree: every process that partial record names is confirmed dead, and whatever it never named is unaccounted for"
        else
          log "SWEEP[$label] record_behind_tree: a process that partial record names is alive or unverifiable after the kill"
        fi
      fi
      return 1
      ;;
  esac
  local alive rc
  alive=$(check_snapshot_survivors "${CHILD_TREE_SNAPSHOT:-}")
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "SWEEP[$label] record_unverified: child-$CHILD_INDEX's recorded tree could not be verified - not killing on an unverified read"
    LAST_STOP_SNAPSHOT="$CHILD_TREE_SNAPSHOT"
    return 1
  fi
  if [ -z "$alive" ]; then
    # What this line claims is bounded by the record it was read off. A native
    # process a child spawned after the last walk is in no record, so the
    # reading covers the processes the record names and nothing wider.
    log "SWEEP[$label] clean: every process child-$CHILD_INDEX's recorded tree names is dead, read off a tree record a poll confirmed $(child_tree_record_age_s) ago"
    return 0
  fi
  log "SWEEP[$label] survivors: processes from child-$CHILD_INDEX outlived it: $(echo "$alive" | tr '\n' ' ') - killing them before anything else runs"
  LAST_STOP_SNAPSHOT="$CHILD_TREE_SNAPSHOT"
  if kill_process_snapshot "$CHILD_TREE_SNAPSHOT"; then
    log "SWEEP[$label] survivors_dead: the surviving tree is confirmed dead"
    LAST_STOP_SNAPSHOT=""
    return 0
  fi
  log "SWEEP[$label] survivors_alive: a process from child-$CHILD_INDEX is alive or unverifiable after the kill"
  return 1
}

# --- Helper: build the snapshot a stop verifies and kills ---
# A Windows walk from the wrapper does not reach the child. The live launch
# runs `claude.exe` under `env.exe`, whose Windows parent is a Cygwin fork
# intermediate that has already exited, so the wrapper's own walk names the
# wrapper alone. The snapshot is therefore the union of three readings: the
# wrapper's own walk, a walk from the Windows pid of every process in the
# MSYS closure the latest refresh read, and the tree record, which must be
# `whole`. An adopted child's snapshot is the record, the Windows pid and start
# ticks its handle recorded, and the walk from that Windows pid, with no MSYS
# pid resolved or walked. Lines are deduplicated on pid and start ticks together, so a pid
# recorded under two different processes keeps both lines and each is
# matched against its own start time.
#
# Every other record state names a way the record falls short of the tree,
# and a union built on it could verify part of the tree dead while a
# process it never named runs on. So any other state is unverified, the same
# answer a walk that did not complete gives. A walk whose MSYS pid has exited
# is discarded rather than failed, since that process is no part of the tree
# any more and the pid the walk read is not its own. A walk whose MSYS pid is
# still running under a different Windows pid is the other case and fails the
# build: that process is part of the tree, it now holds a Windows pid no walk
# here reached, and the union names only the pid it used to run as. Discarding
# such a walk would report a stop verified while a live member of the closure
# sits outside every line the snapshot carries.
# The union is cleared of this supervisor's own Windows pid the way
# `snapshot_process_tree` clears a single walk: a union naming it, or a self
# pid that cannot be resolved, is unverified as a whole.
#
# `stop_child` and `retry_stop_escalation` both build their snapshot here, each
# after a `refresh_child_tree`, so the retry backstop never kills from a
# narrower tree than the stop itself would.
#
# Sets STOP_SNAPSHOT_BUILT to the snapshot, "pid,ticks" per line, and to empty
# on every unverified result. Returns 0 where the snapshot is verified, which
# includes a verified empty one, and non-zero where it is not.
# Usage: build_stop_snapshot <label>
build_stop_snapshot() {
  local label="$1"
  local pid="${CHILD_LAUNCH_PID:-}"
  STOP_SNAPSHOT_BUILT=""
  STOP_SNAPSHOT_WRAPPER_WINPID=""
  local record_state
  record_state=$(child_tree_record_state)
  if [ "$record_state" != "whole" ]; then
    log "STOP[$label]: tree_record_$record_state: child-$CHILD_INDEX's tree record is not whole, so no snapshot built on it can confirm the tree dead"
    return 1
  fi
  local union="$CHILD_TREE_SNAPSHOT" walk_pairs="" pair walked walk_rc wrapper_winpid="" root_line
  if [ "${CHILD_ADOPTED:-}" = "1" ]; then
    # An adopted child's MSYS pids are numbers this supervisor never held, and
    # a reused one resolves to a foreign process whose tree a walk would add
    # here under that process's own start ticks. So no MSYS pid is resolved or
    # walked for an adopted child. The build is the record, the Windows pid and
    # start ticks the handle recorded, and the walk from that Windows pid,
    # which is kept only while its root still carries the recorded ticks.
    STOP_SNAPSHOT_WRAPPER_WINPID="${CHILD_WINPID:-}"
    if [ -z "${CHILD_WINPID:-}" ] || [ -z "${CHILD_TICKS:-}" ]; then
      log "STOP[$label]: adopted child-$CHILD_INDEX has no recorded Windows pid and start ticks to build its snapshot from"
      return 1
    fi
    union="$union
$CHILD_WINPID,$CHILD_TICKS"
    walked=$(snapshot_process_tree "$CHILD_WINPID")
    walk_rc=$?
    if [ "$walk_rc" -ne 0 ]; then
      log "STOP[$label]: the walk under adopted child-$CHILD_INDEX's recorded Windows pid $CHILD_WINPID did not complete (rc=$walk_rc)"
      return "$walk_rc"
    fi
    # A walk names its own root where a process holds the pid. No root line is
    # a recorded child that has exited, with nothing under it to add. A root
    # under other start ticks is a process that reused the pid, so its tree is
    # no part of the child's. A root whose start time could not be read cannot
    # be told apart from either, so the build is unverified.
    root_line=$(printf '%s\n' "$walked" | grep "^$CHILD_WINPID," | head -1)
    case "$root_line" in
      "") ;;
      "$CHILD_WINPID,$CHILD_TICKS")
        union="$union
$walked"
        ;;
      "$CHILD_WINPID,"*[!0-9]*)
        log "STOP[$label]: the walk under adopted child-$CHILD_INDEX's recorded Windows pid $CHILD_WINPID could not read that root's start time, so it cannot be told from a process that reused the pid"
        return 1
        ;;
      *)
        log "STOP[$label]: adopted child-$CHILD_INDEX's recorded Windows pid $CHILD_WINPID is held by a process under other start ticks, so its walk is no part of the child's tree and is left out"
        ;;
    esac
  else
    if [ -n "$pid" ]; then
      wrapper_winpid=$(resolve_windows_pid "$pid")
    fi
    # The wrapper's Windows pid this build walked from, for a caller that
    # compares a later resolve against the pid its list was walked from.
    STOP_SNAPSHOT_WRAPPER_WINPID="$wrapper_winpid"
    if [ -n "$wrapper_winpid" ]; then
      walk_pairs="$pid:$wrapper_winpid"
    fi
    for pair in ${CHILD_TREE_SEEN_PAIRS:-}; do
      case " $walk_pairs " in *" $pair "*) continue ;; esac
      walk_pairs="$walk_pairs $pair"
    done
  fi
  for pair in $walk_pairs; do
    walked=$(walk_msys_process_tree "${pair%%:*}" "${pair#*:}")
    walk_rc=$?
    # Only an exited MSYS process (rc 3) drops out of the union. Its walk read
    # a Windows pid it no longer holds, and the process itself is gone, so
    # there is nothing left of it for the snapshot to have missed. Every other
    # non-zero code, rc 4 among them, leaves a member of the closure alive and
    # unaccounted for, which is the same answer `refresh_child_tree` gives the
    # two codes.
    if [ "$walk_rc" -eq 3 ]; then
      continue
    fi
    if [ "$walk_rc" -ne 0 ]; then
      log "STOP[$label]: the walk under Windows pid ${pair#*:} (MSYS pid ${pair%%:*}) did not complete or was discarded (rc=$walk_rc)"
      return "$walk_rc"
    fi
    if [ -n "$walked" ]; then
      union="$union
$walked"
    fi
  done
  local snapshot self_winpid
  snapshot=$(printf '%s\n' "$union" | grep -v '^$' | sort -u)
  self_winpid=$(resolve_windows_pid "$$")
  if [ -z "$self_winpid" ]; then
    log "STOP[$label]: this supervisor's own Windows pid does not resolve, so the stop's snapshot cannot be cleared of it"
    return 1
  fi
  if printf '%s\n' "$snapshot" | grep -q "^$self_winpid,"; then
    log "STOP[$label]: the stop's snapshot names this supervisor's own Windows pid $self_winpid, so every process in it may have been reached through this process"
    return 1
  fi
  STOP_SNAPSHOT_BUILT="$snapshot"
  return 0
}

# --- Helper: on a stop_child failure, keep retrying the tree kill on a
# cadence, bounded well under the pre-gate's own ceiling, before the
# caller proceeds ---
# Every stop_child call site reads this return value: a caller that
# discarded it could relaunch a child, or a decide-action path could walk
# into the persona pre-gate, with a confirmed-alive survivor from the
# stopped child's own tree still holding the persona claim.
#
# A single retry here can still let a restart path walk blind into the
# 120s persona pre-gate (`wait_persona_free_both`) on a confirmed-alive
# survivor, spending the whole 120s waiting on a heartbeat staleness
# timeout rather than on the tree actually dying. So the kill is retried
# on a cadence instead of once, and the caller still proceeds either way
# with the outcome logged - this is a backstop, not a substitute for the
# pre-gate itself.
#
# A fixed number of attempts with sleeps between them names only the
# sleep time, not the real bound: each attempt's own
# `kill_process_snapshot` call can itself run up to `$SUPERVISOR_PS_
# BOUND_S` seconds, so a sleep-counted budget understates the real
# worst case. This loop is bounded by actual wall clock against
# `supervisorStopRetryBudgetS` (30 seconds by default, a quarter of the 120s
# pre-gate ceiling), checked before and after each attempt rather than
# assumed from a sleep count.
#
# A caller can reach this backstop with `LAST_STOP_SNAPSHOT` empty, where
# `stop_child` could not verify a snapshot. This backstop re-snapshots once
# rather than give up outright, through the same refresh and merged build
# `stop_child` uses, since a snapshot of the wrapper alone would confirm bash
# dead while the `claude.exe` behind it runs on. A build that still cannot
# verify the tree returns failure.
# Usage: retry_stop_escalation <label> <stop_child's own return code>
retry_stop_escalation() {
  local label="$1"
  local result="$2"
  if [ "$result" -eq 0 ]; then
    return 0
  fi
  # A stop that met its wrapper under a Windows pid no snapshot was walked from
  # has already run the ticks-matched kill over the processes a verified
  # snapshot names. A snapshot built here comes from the same record plus a
  # walk of the new pid, which cannot name what the wrapper started between
  # the two, so no retry can confirm that tree dead and this fails without
  # building one.
  if [ -n "${STOP_TREE_MOVED:-}" ]; then
    log "STOP[$label]: stop_child refused because the wrapper moved to a Windows pid its snapshot was never walked from (STOP_PATH=$STOP_PATH) - no retry can confirm that tree dead, failing without a re-snapshot"
    return 1
  fi
  # A re-snapshot attempt from a dead or zombie `CHILD_LAUNCH_PID`
  # reliably resolves to no winpid at all, so looping and sleeping
  # through the whole budget on a re-resolve that structurally cannot
  # ever succeed just burns the budget for nothing. Try exactly once, up
  # front; if it still yields nothing, there is nothing this loop can do
  # and it fails fast rather than slow.
  if [ -z "$LAST_STOP_SNAPSHOT" ]; then
    log "STOP[$label]: stop_child reported failure (STOP_PATH=$STOP_PATH) with no snapshot to retry against; attempting one re-snapshot"
    local resnap_rc=1
    if [ -n "${CHILD_LAUNCH_PID:-}" ]; then
      refresh_child_tree
      build_stop_snapshot "$label"
      resnap_rc=$?
      LAST_STOP_SNAPSHOT="$STOP_SNAPSHOT_BUILT"
    fi
    # Only a snapshot the merged build verified can end the retry: an
    # unverified build fails fast, since sleeping out the budget cannot make it
    # verifiable, and a verified empty build means nothing of the child is left
    # to retry against.
    #
    # An adopted child's unverified build is the one exception to failing with
    # nothing killed. Its walk runs from the recorded wrapper, which the stop's
    # own rungs may have killed, and a kill ends only the process it names, so
    # the `claude.exe` under that wrapper can still be running with no walk
    # able to reach it. So before failing, the retry kills the list `stop_child`
    # kills in the same case, ticks-matched: whatever the tree record names,
    # whenever it names anything, and the recorded pair. The record's state is
    # not consulted, only whether it has entries: a record that reads stale or
    # behind still names real pid and ticks pairs, and the kill matches each
    # on its ticks, as the sweep's kill of a behind record does. That kill is
    # never read as a verdict, and the retry still fails, since no build it
    # could verify agrees. The line leads with the token
    # `adopted_unverified_kill:` and a `record=` field carrying the record's
    # state and entry count, or `record=empty`, so a reader can tell a list of
    # the pair alone from one that carried the record.
    if [ "$resnap_rc" -ne 0 ]; then
      if [ "${CHILD_ADOPTED:-}" = "1" ] && [ -n "${CHILD_WINPID:-}" ] && [ -n "${CHILD_TICKS:-}" ]; then
        local adopted_list="${CHILD_TREE_SNAPSHOT:-}" adopted_record adopted_held
        if [ -n "$adopted_list" ]; then
          adopted_record="record=$(child_tree_record_state) entries=$(printf '%s\n' "$adopted_list" | grep -c .)"
          adopted_held="its tree record and recorded pair"
        else
          adopted_record="record=empty"
          adopted_held="its recorded pair alone, since its tree record is empty"
        fi
        adopted_list=$(printf '%s\n%s,%s\n' "$adopted_list" "$CHILD_WINPID" "$CHILD_TICKS" | grep -v '^$' | sort -u)
        log "STOP[$label]: adopted_unverified_kill: $adopted_record - re-snapshot of adopted child-$CHILD_INDEX could not be verified, killing $adopted_held, ticks-matched, before failing"
        kill_process_snapshot "$adopted_list" || true
      fi
      log "STOP[$label]: re-snapshot could not verify the child's tree (rc=$resnap_rc; no child pid, a record that is not whole, a walk that did not complete, or a self pid it could not clear) - failing fast rather than sleeping out the budget"
      return 1
    fi
    if [ -z "$LAST_STOP_SNAPSHOT" ]; then
      log "STOP[$label]: re-snapshot was verified and found nothing - nothing left to retry"
      return 0
    fi
  fi
  local RETRY_BUDGET_S="${SUPERVISOR_STOP_RETRY_BUDGET_S:-30}"
  # Every clock read in the budget loop is the shell's own, in whole seconds,
  # so the loop's timing starts no process. The deadline is read once, the
  # loop test reads the clock before each attempt, and the attempt's line
  # reads it again for the seconds left.
  local deadline now
  printf -v now '%(%s)T' -1
  deadline=$(( now + RETRY_BUDGET_S ))
  local attempt=0 kill_rc=1
  printf -v now '%(%s)T' -1
  while [ "$now" -lt "$deadline" ]; do
    attempt=$((attempt + 1))
    printf -v now '%(%s)T' -1
    log "STOP[$label]: retrying the tree kill (attempt $attempt, $(( deadline - now ))s left in budget)"
    kill_process_snapshot "$LAST_STOP_SNAPSHOT"
    kill_rc=$?
    if [ "$kill_rc" -eq 0 ]; then
      log "STOP[$label]: retry succeeded on attempt $attempt, tree confirmed dead"
      LAST_STOP_SNAPSHOT=""
      return 0
    fi
    sleep 2
    printf -v now '%(%s)T' -1
  done
  log "STOP[$label]: every retry FAILED over the ${RETRY_BUDGET_S}s budget - a process from the stopped child is alive or unverifiable and may still hold its persona claim"
  return 1
}

# Whether the child is inside a turn, read off the tail of its own
# stdout.jsonl by bin/supervise-turnstate.mjs. Prints busy or idle. Every
# fault reads idle: an empty path (a caller with no stream to name), a reader
# that fails, and any output but the two words. Idle is the fall-through to
# the stop phases as they run for every other label, so a broken reader
# costs the patient wait and never holds a persona. The call is the poll
# loop's own shape, a plain capture with stderr on supervisor.err, since
# run_bounded_native discards the stdout this verdict rides on.
# Usage: child_turn_state <stdout.jsonl path>
child_turn_state() {
  local stream="$1" verdict
  if [ -z "$stream" ]; then
    echo idle
    return 0
  fi
  verdict=$(node "$PLUGIN_DIR/bin/supervise-turnstate.mjs" "$stream" "$(date +%s%3N)" 2>> "$RUNDIR/supervisor.err")
  verdict="${verdict%$'\r'}"
  case "$verdict" in
    busy|idle) echo "$verdict" ;;
    *) echo idle ;;
  esac
}

# Usage: stop_child <label>
# Sets STOP_PATH to one of nine values: "eof", "term", or "kill" when the
# tree is confirmed dead at that phase, "eof_kill_failed",
# "term_kill_failed", "kill_failed" when a survivor from the snapshot was
# alive or unverifiable after that phase's own escalation, "unverified" when
# nothing was confirmed either way: the snapshot could never be built in the
# first place, because a walk did not complete, the tree record is not whole,
# or the snapshot could not be cleared of this supervisor's own pid, or the
# wrapper reached the force kill running as a Windows pid the snapshot was
# never walked from -
# "gone" when the wrapper had already
# exited and the tree recorded while the child ran leaves nothing alive, or
# "gone_kill_failed" when that record holds a process that is alive or that no
# reading could account for.
# Returns 1 in every failed case; callers should read that
# return rather than trusting STOP_PATH's clean-looking values by name alone.
stop_child() {
  local label="$1"
  STOP_TREE_MOVED=""
  # If CHILD_LAUNCH_PID is empty, there's nothing to stop.
  local pid="${CHILD_LAUNCH_PID:-}"
  if [ -z "$pid" ]; then
    log "STOP[$label]: no child to stop (CHILD_LAUNCH_PID empty)"
    return 0
  fi
  # The record is refreshed before anything reads it, so the stop works from
  # the child's tree as it stands now rather than as the last poll saw it.
  refresh_child_tree
  # Usage: stop_present - whether the child is still present, read the way
  # child_present reads it. A launched child answers `kill -0` on its launch
  # pid. An adopted child's launch pid is an MSYS pid this supervisor never
  # held, so its presence is its marker and a fresh walk: the marker is read
  # first, since the wrapper writes it the instant the child exits, and the
  # walk is refreshed only while the marker is absent.
  stop_present() {
    if [ "${CHILD_ADOPTED:-}" = "1" ]; then
      [ -n "${EXIT_MARKER:-}" ] && [ -f "$EXIT_MARKER" ] && return 1
      refresh_child_tree
    fi
    child_present
  }
  # A wrapper that exits on its own in the window between the poll
  # loop's own presence check and `stop_child` actually running (the
  # decide-unit's own node calls, the `case` dispatch) would otherwise
  # fall all the way through to `unverified`: `resolve_windows_pid` finds
  # nothing for an already-gone pid, so a child that ended cleanly would
  # report as if a survivor were still alive. Checked explicitly here,
  # before any snapshot is even attempted: where the wrapper is already
  # gone and no winpid resolves for it, the only thing that can still name
  # what ran under it is the tree recorded while the child was alive, so
  # that record is what the sweep verifies. `STOP_PATH="gone"` reports a
  # sweep that left nothing of the child running, distinct from
  # `unverified` (which means "cannot tell"), and `retry_stop_escalation`
  # treats it as nothing to retry. An adopted child read absent here takes
  # that sweep at once: nothing resolves its MSYS pid, since that pid is
  # read for nothing on the adopted path.
  if ! child_present; then
    local early_winpid=""
    if [ "${CHILD_ADOPTED:-}" != "1" ]; then
      early_winpid=$(resolve_windows_pid "$pid")
    fi
    if [ -z "$early_winpid" ]; then
      # The wrapper being gone says nothing about what ran under it: a
      # `claude.exe` can be alive and still holding the persona claim. Nothing
      # live can name that process any more, so the tree recorded while the
      # child ran is what gets verified here, rather than reporting a clean
      # stop on a tree nothing looked at.
      log "STOP[$label]: wrapper gone before stop_child ran (pid $pid already exited, no winpid resolves) - verifying the tree recorded while the child ran"
      LAST_STOP_SNAPSHOT=""
      sweep_child_tree "$label"
      local sweep_rc=$?
      # A sweep that found a tree and cleared it, and one that reports no
      # Windows process was ever seen under this child, both leave nothing of
      # the child running, which is what "gone" says. Every other reading
      # leaves a process that is alive or that nothing accounted for, which is
      # the one failure this reports.
      if [ "$sweep_rc" -eq 0 ] || [ "$sweep_rc" -eq 2 ]; then
        STOP_PATH="gone"
        return 0
      fi
      STOP_PATH="gone_kill_failed"
      return 1
    fi
  fi

  # The snapshot is taken HERE, before any signal at all, not after each
  # phase's kill -0 check fails. A bash wrapper TERMed while its real
  # child survives is exactly the shape resolving and walking the tree
  # only in a later phase would miss: `kill -0 $pid` only ever checks the
  # MSYS-tracked wrapper, never whether a real descendant is still alive,
  # so an earlier phase's own "stopped" report would never actually be
  # checked against reality. A snapshot taken after killing risks a
  # recycled pid too (Windows reuses pids quickly and keeps
  # ParentProcessId associations after a process exits) - so this list is
  # fixed before anything is signaled, and is the same list checked and
  # killed at every phase below. The one rebuild is the patient wait's,
  # below, which still sits before the first signal.
  #
  # A Windows walk from the wrapper does not reach the child, so the snapshot
  # is the merged one `build_stop_snapshot` builds from the record the refresh
  # at entry took. An adopted child's wrapper pid is the Windows pid its
  # handle recorded, checked against a live process before the adoption and on
  # every walk since, so that recorded pair joins the snapshot outright, even
  # where the walk did not complete, and no MSYS pid of the child is resolved.
  # Where the walk did not complete, the tree record joins it too whenever it
  # names anything, and its state is not consulted: a kill ends only the
  # process it names, so a list of the wrapper pair alone leaves the
  # `claude.exe` under it running, and a record that reads stale or behind
  # still names real pid and ticks pairs that the kill matches on their ticks.
  # A snapshot the build could not verify is still not left for the retry, so
  # the retry takes its own re-snapshot rather than confirming this list.
  local snapshot_winpid=""
  if [ "${CHILD_ADOPTED:-}" = "1" ]; then
    snapshot_winpid="${CHILD_WINPID:-}"
  else
    snapshot_winpid=$(resolve_windows_pid "$pid")
  fi
  # `snap_attempted` stays 1 once the build has run, and `snap_rc` carries its
  # verdict, so "built and found nothing alive" (verified dead) is not read the
  # same as "the build could not verify the tree" (unverified).
  local snapshot="" snap_rc=0 snap_attempted=1
  build_stop_snapshot "$label"
  snap_rc=$?
  snapshot="$STOP_SNAPSHOT_BUILT"
  if [ "${CHILD_ADOPTED:-}" = "1" ] && [ -n "${CHILD_WINPID:-}" ] && [ -n "${CHILD_TICKS:-}" ]; then
    if [ "$snap_rc" -ne 0 ] && [ -n "${CHILD_TREE_SNAPSHOT:-}" ]; then
      snapshot="$CHILD_TREE_SNAPSHOT"
    fi
    snapshot=$(printf '%s\n%s,%s\n' "$snapshot" "$CHILD_WINPID" "$CHILD_TICKS" | grep -v '^$' | sort -u)
  fi
  # A failed resolve or a non-zero `snap_rc` (the PowerShell walk timed
  # out or errored - errors go only to supervisor.err, never here) does
  # not read as "verified dead" - it means the tree was never actually
  # looked at. Named explicitly so the operator can tell the two apart in
  # the log, rather than a silent, indistinguishable clean report.
  if [ "$snap_attempted" -eq 0 ] || [ "$snap_rc" -ne 0 ]; then
    if [ "${CHILD_ADOPTED:-}" = "1" ] && [ -n "${CHILD_WINPID:-}" ] && [ -n "${CHILD_TICKS:-}" ]; then
      log "STOP[$label]: tree not verified (the walk from adopted child-$CHILD_INDEX's recorded Windows pid did not complete, or its tree record is not whole, rc=$snap_rc) - the stop kills the recorded pair, and the tree record where it names anything, ticks-matched"
    else
      log "STOP[$label]: tree not verified (no snapshot resolved for pid $pid, or the walk did not complete, rc=$snap_rc) - stop relies on the child's own launch pid alone"
    fi
    LAST_STOP_SNAPSHOT=""
  else
    LAST_STOP_SNAPSHOT="$snapshot"
  fi

  # Usage: verify_snapshot_dead - returns 0 if every process in $snapshot
  # is confirmed gone (matched by pid AND start time - a recycled pid
  # alone does not count as a survivor); escalates via kill_process_snapshot
  # only on a CONFIRMED survivor, returning 1 if that escalation itself
  # still leaves one (this return code is read below, not discarded).
  #
  # An unverified check (rc non-zero - the probe timed out or crashed) is
  # never escalated like a confirmed survivor, handing the WHOLE snapshot
  # to `kill_process_snapshot`: `kill_process_snapshot` itself is
  # ticks-matched, so that call is never a blind mass kill by pid, but an
  # unverified read still means nothing was actually confirmed alive, so
  # this logs and returns 1 without calling kill_process_snapshot at all -
  # "cannot tell" is not grounds to act, only grounds to fail closed and
  # let the caller retry.
  #
  # An EMPTY snapshot (the resolve or the walk itself failed, `snap_rc`
  # non-zero above) is the same "cannot tell" case as an unverified
  # check, not "verified dead": returning 0 here on an empty snapshot
  # would be the exact report a slow-spawn regime (the bound this whole
  # function exists for) produces on a tree that was never actually
  # looked at.
  # Usage: kill_stale_entry_list - the one unverified case that still holds
  # a verified list: the patient wait's rebuild failed and `snapshot` is the
  # entry list. That list is killed, ticks-matched, so nothing it names
  # outlives the stop, while the verdict stays unverified because nothing
  # the child started during the wait is on it. An adopted child's unverified
  # list also holds its recorded pair and whatever its tree record names,
  # which are killed here the same way.
  # Every other unverified case holds an empty list and this does nothing.
  kill_stale_entry_list() {
    if [ -n "$snapshot" ]; then
      if kill_process_snapshot "$snapshot"; then
        log "STOP[$label]: every process the entry list names is confirmed dead; what the child started during the wait is unaccounted for"
      else
        log "STOP[$label]: a process the entry list names is alive or unverifiable after the kill"
      fi
    fi
  }
  verify_snapshot_dead() {
    if [ "$snap_attempted" -eq 0 ] || [ "$snap_rc" -ne 0 ]; then
      log "STOP[$label]: no verified snapshot covers this stop (the entry resolve or walk failed, or the post-wait rebuild did) - not confirming dead on an unverified read"
      return 1
    fi
    local alive rc
    alive=$(check_snapshot_survivors "$snapshot")
    rc=$?
    if [ "$rc" -ne 0 ]; then
      log "STOP[$label]: the wrapper is gone but its own snapshot could not be verified - not killing on an unverified read"
      return 1
    fi
    if [ -z "$alive" ]; then
      return 0
    fi
    log "STOP[$label]: the wrapper is gone but its own snapshot shows a confirmed survivor: $(echo "$alive" | tr '\n' ' ') - escalating the tree kill"
    kill_process_snapshot "$snapshot"
    return $?
  }

  # Phase 1: end of input - kill the holder so the child reads end of input.
  # The holder holds the child's stdin pipe; killing it closes the write end,
  # and the child finishes its current turn and exits 0 within a few seconds.
  kill_holder
  # The moment the input closed, which the patient wait below measures its
  # cap from, so the ordinary grace counts toward that cap.
  local eof_closed_ms
  eof_closed_ms=$(date +%s%3N)
  # Logged so the suite can bound the cap from the close on the log's own
  # clock rather than from the wait's arithmetic.
  log "STOP[$label]: input closed (eof_closed)"
  # Poll for up to stopGraceMs for the child to exit on its own.
  local grace=$((SUPERVISOR_STOP_GRACE_MS / 1000))
  local n=0
  while stop_present && [ $n -lt $grace ]; do
    sleep 1
    n=$((n + 1))
  done
  # The patient wait. A requested restart of a live child, and that label
  # alone, keeps waiting past the grace while the child is inside a turn: a
  # closed input ends the child when its turn ends, and a TERM before then
  # kills a session seconds after it wrote a file. Every other label stops on
  # the grace as before, since a shutdown, a crash-loop stop, a budget stop
  # and a hung restart have nothing a turn's end would save, and a hung child
  # read as busy would hold its persona for the whole cap. The wait ends on
  # the first of three: the child exits, the reader answers idle, or
  # SUPERVISOR_STOP_BUSY_CAP_MS has passed since the input closed. On the
  # last two, TERM follows once the tree snapshot is rebuilt, with no further
  # grace, since the ordinary grace has already run. Each exit lands on the
  # same check below the EOF loop reaches, so a child that exits inside the
  # wait is verified dead and reported on the eof path as one that exited
  # inside the grace is.
  if [ "$label" = "restart_passive" ] && stop_present; then
    local turn waited_ms left_ms
    turn=$(child_turn_state "${OUT:-}")
    if [ "$turn" = "busy" ]; then
      log "STOP[$label]: the child is inside a turn, waiting for it to end"
      while :; do
        # Five seconds a poll, cut short to what is left before the cap, so
        # the cap is met when it falls rather than a poll late.
        waited_ms=$(( $(date +%s%3N) - eof_closed_ms ))
        left_ms=$((SUPERVISOR_STOP_BUSY_CAP_MS - waited_ms))
        [ "$left_ms" -gt 5000 ] && left_ms=5000
        if [ "$left_ms" -gt 0 ]; then
          sleep "$((left_ms / 1000)).$(printf '%03d' $((left_ms % 1000)))"
        fi
        if ! stop_present; then
          log "STOP[$label]: the child exited during the patient wait (wait_ended=exit)"
          break
        fi
        waited_ms=$(( $(date +%s%3N) - eof_closed_ms ))
        if [ "$waited_ms" -ge "$SUPERVISOR_STOP_BUSY_CAP_MS" ]; then
          log "STOP[$label]: the busy cap of ${SUPERVISOR_STOP_BUSY_CAP_MS}ms was reached after ${waited_ms}ms, ending the wait (wait_ended=cap)"
          break
        fi
        turn=$(child_turn_state "${OUT:-}")
        if [ "$turn" = "idle" ]; then
          log "STOP[$label]: the reader returned idle after $((waited_ms / 1000))s, ending the wait (wait_ended=idle)"
          break
        fi
      done
      # A wait that ends with the child alive, on idle or on the cap, has let
      # the child run tool calls for up to the cap since the entry snapshot
      # was built, and each of those spawned processes the entry never saw.
      # Nothing has been signaled yet, so the rule above (one list, fixed
      # before any signal) still holds, and the list is rebuilt here, at the
      # last point before the TERM. A wait the child's own exit ended keeps
      # the entry snapshot, as the ordinary EOF exit does, since a walk after
      # an exit reads recycled pids.
      # The rebuilt list is the union of the entry list and the new walk,
      # since a descendant alive at entry whose parent exited during the
      # wait is unreachable from the wrapper's parent chain and would drop
      # out of a fresh walk alone. Every entry is ticks-matched, so a pid the
      # entry list named that has since exited and been reused confirms as
      # gone rather than as a survivor. The wrapper's Windows pid becomes the
      # one the rebuild walked from, so the KILL phase compares against the
      # pid the rebuilt list was walked from.
      if stop_present; then
        refresh_child_tree
        build_stop_snapshot "$label"
        snap_rc=$?
        if [ "$snap_rc" -ne 0 ]; then
          # The entry list stays in `snapshot`, so the phases below still
          # run the ticks-matched kill over what it names, but nothing the
          # child started during the wait is on it, so the stop reports
          # unverified and leaves no list for the retry, which then takes
          # its own re-snapshot.
          LAST_STOP_SNAPSHOT=""
          log "STOP[$label]: tree not verified after the patient wait (the walk did not complete, rc=$snap_rc) - the entry list is still killed, ticks-matched, and the stop reports unverified"
        else
          snapshot=$(printf '%s\n%s\n' "$snapshot" "$STOP_SNAPSHOT_BUILT" | grep -v '^$' | sort -u)
          snapshot_winpid="$STOP_SNAPSHOT_WRAPPER_WINPID"
          log "STOP[$label]: the tree snapshot was rebuilt after the wait, before any signal"
          LAST_STOP_SNAPSHOT="$snapshot"
        fi
      fi
    fi
  fi
  if ! stop_present; then
    if verify_snapshot_dead; then
      STOP_PATH="eof"
      LAST_STOP_SNAPSHOT=""
      return 0
    fi
    if [ "$snap_attempted" -eq 0 ] || [ "$snap_rc" -ne 0 ]; then
      kill_stale_entry_list
      STOP_PATH="unverified"
    else
      log "STOP[$label]: a snapshot survivor could not be killed after the EOF path"
      STOP_PATH="eof_kill_failed"
    fi
    return 1
  fi
  # Phases 2 and 3 for an adopted child. Its launch pid is an MSYS pid this
  # supervisor never held, and Windows hands a dead process's id out again, so
  # no MSYS signal and no bare taskkill ever reaches that number. Both rungs
  # are the ticks-matched kill_process_snapshot over the snapshot this stop
  # holds, which carries the recorded child pair and the walked tree: the
  # first rung kills and waits the grace, and the second kills again and
  # reads the result as the stop's verdict. An unverified snapshot still holds
  # the recorded pair, whatever the tree record names, and the entry list
  # where the patient wait's rebuild failed, so both rungs kill what it names
  # while the stop reports the tree unverified and fails closed for the retry,
  # as the launched path does. Only a snapshot with nothing in it leaves no
  # rung.
  if [ "${CHILD_ADOPTED:-}" = "1" ]; then
    log "STOP[$label]: EOF grace expired for adopted child-$CHILD_INDEX; its launch pid $pid is not signalled, the recorded pair and walked tree under Windows pid ${snapshot_winpid:-none} are killed ticks-matched instead"
    if [ -z "$snapshot" ]; then
      log "STOP[$label]: no verified snapshot covers this stop (the entry resolve or walk failed, or the post-wait rebuild did) - not confirming dead on an unverified read"
      STOP_PATH="unverified"
      return 1
    fi
    kill_process_snapshot "$snapshot" || true
    n=0
    while stop_present && [ $n -lt $grace ]; do
      sleep 1
      n=$((n + 1))
    done
    if ! stop_present; then
      if verify_snapshot_dead; then
        STOP_PATH="term"
        LAST_STOP_SNAPSHOT=""
        return 0
      fi
      if [ "$snap_attempted" -eq 0 ] || [ "$snap_rc" -ne 0 ]; then
        STOP_PATH="unverified"
      else
        log "STOP[$label]: a snapshot survivor could not be killed after the TERM path"
        STOP_PATH="term_kill_failed"
      fi
      return 1
    fi
    log "STOP[$label]: TERM grace expired for adopted child-$CHILD_INDEX, killing its snapshot again, ticks-matched"
    local adopted_kill_rc=0
    kill_process_snapshot "$snapshot" || adopted_kill_rc=$?
    if [ "$snap_attempted" -eq 0 ] || [ "$snap_rc" -ne 0 ]; then
      log "STOP[$label]: no verified snapshot covers this stop (the entry resolve or walk failed, or the post-wait rebuild did) - not confirming dead on an unverified read"
      STOP_PATH="unverified"
      return 1
    fi
    if [ "$adopted_kill_rc" -eq 0 ]; then
      STOP_PATH="kill"
      LAST_STOP_SNAPSHOT=""
      return 0
    fi
    log "STOP[$label]: a snapshot survivor could not be killed after the KILL path - the last escalation this function has"
    STOP_PATH="kill_failed"
    return 1
  fi
  # Phase 2: TERM - send SIGTERM after grace expired. From here down the child
  # is this supervisor's own launch, so `$pid` is a live job of its own and
  # carries no reuse risk.
  log "STOP[$label]: EOF grace expired, sending TERM to pid $pid"
  kill -TERM "$pid" 2>/dev/null
  n=0
  while kill -0 "$pid" 2>/dev/null && [ $n -lt $grace ]; do
    sleep 1
    n=$((n + 1))
  done
  if ! kill -0 "$pid" 2>/dev/null; then
    if verify_snapshot_dead; then
      STOP_PATH="term"
      LAST_STOP_SNAPSHOT=""
      return 0
    fi
    if [ "$snap_attempted" -eq 0 ] || [ "$snap_rc" -ne 0 ]; then
      kill_stale_entry_list
      STOP_PATH="unverified"
    else
      log "STOP[$label]: a snapshot survivor could not be killed after the TERM path"
      STOP_PATH="term_kill_failed"
    fi
    return 1
  fi
  # Phase 3: KILL - send SIGKILL to the wrapper, then force-kill the whole
  # snapshot this stop holds, taken at entry or rebuilt after the patient
  # wait (not a fresh walk from a possibly-dead or -recycled pid).
  log "STOP[$label]: TERM grace expired, sending KILL to pid $pid (winpid $snapshot_winpid) and its process tree"
  # A bare `kill -9` on the wrapper's own MSYS pid is the same class of
  # call that can block on this box with a "Permission denied" - whether
  # `$pid` here is a real bash process or itself a stub for `claude.exe`
  # decides whether it can hang the same way. `taskkill //F` on
  # `$snapshot_winpid` is tried first, and only while the wrapper still runs as
  # that pid; `kill -9` is what a wrapper with no winpid, or one whose winpid
  # moved since the stop began, is signaled with instead.
  # Routed through `run_bounded_native`, like every other native command
  # this script spawns, rather than left as a native spawn with nothing
  # capping how long it can run.
  # `$snapshot_winpid` was resolved two grace windows back, at stop entry or
  # at the patient wait's rebuild, whichever came last. The
  # guard above proves the wrapper lives; it does not prove the wrapper still
  # runs as that Windows pid, and Windows hands a dead process's id out again,
  # so a force kill on the entry value can land on an unrelated process. The
  # pid is resolved again here and the two are compared, the same match
  # `walk_msys_process_tree` makes on both sides of a walk.
  local kill_winpid
  kill_winpid=$(resolve_windows_pid "$pid")
  if [ -n "$snapshot_winpid" ] && [ "$kill_winpid" = "$snapshot_winpid" ]; then
    # The wrapper's own pid alone, with no `//T`. A tree kill re-walks the
    # live parent ids at kill time rather than the snapshot, and Windows
    # keeps a dead parent's id in the orphans it left and reuses the id, so
    # it can reach a process that was never part of this tree. The tree
    # below the wrapper is `kill_process_snapshot`'s, which kills only the
    # processes the snapshot recorded, each matched against its start time.
    run_bounded_native 5 taskkill //F //PID "$snapshot_winpid"
    # A failed or abandoned taskkill leaves nothing else touching `$pid`
    # at all: every caller of `stop_child` then runs an unbounded
    # `wait "$CHILD_LAUNCH_PID"`, which would block forever on a wrapper
    # that was never actually signaled. So the wrapper's own pid is
    # independently confirmed signaled here, falling back to `kill -9` if
    # `taskkill` did not reach it.
    if kill -0 "$pid" 2>/dev/null; then
      log "STOP[$label]: wrapper pid $pid still present after taskkill - falling back to kill -9 on it directly"
      kill -9 "$pid" 2>/dev/null
    fi
  elif [ -n "$snapshot_winpid" ] && [ -n "$kill_winpid" ]; then
    # The wrapper is running as a Windows pid this stop has never walked. The
    # snapshot describes the tree under the pid it held at entry, so anything
    # started under the new one is in no snapshot: a kill from that snapshot
    # confirms the processes it does name dead and says nothing of the rest,
    # so reading its result as the stop's verdict is the same fail-open
    # `build_stop_snapshot` refuses with rc 4 when it meets this condition.
    # So the wrapper's own MSYS pid is signaled, the ticks-matched snapshot
    # kill still runs over the processes a verified snapshot names, and the
    # stop fails closed whatever that kill reports. STOP_TREE_MOVED marks the
    # refusal for `retry_stop_escalation`, which fails on it rather than
    # rebuilding a snapshot from the same record and reporting that partial
    # tree dead as a clean stop.
    log "STOP[$label]: wrapper pid $pid runs as Windows pid $kill_winpid now, not the $snapshot_winpid this stop resolved before signaling - not force-killing that number, signaling the wrapper's own pid instead"
    kill -9 "$pid" 2>/dev/null
    if kill -0 "$pid" 2>/dev/null; then
      log "STOP[$label]: wrapper pid $pid is still present after the kill -9, so a caller's wait on it can block until it ends on its own"
    fi
    if [ "$snap_rc" -eq 0 ]; then
      if kill_process_snapshot "$snapshot"; then
        log "STOP[$label]: every process the snapshot walked from Windows pid $snapshot_winpid names is confirmed dead, and whatever the wrapper started under $kill_winpid is unaccounted for"
      else
        log "STOP[$label]: a process the snapshot walked from Windows pid $snapshot_winpid names is alive or unverifiable after the kill"
      fi
    else
      # A failed post-wait rebuild leaves the verified entry list in
      # `snapshot`, and this arm is where a moved wrapper lands after one.
      # That list is killed here as at every other unverified exit.
      kill_stale_entry_list
    fi
    log "STOP[$label]: the snapshot this stop holds was walked from Windows pid $snapshot_winpid and names nothing the wrapper started under $kill_winpid, so the tree cannot be confirmed dead from it"
    STOP_PATH="unverified"
    STOP_TREE_MOVED=1
    LAST_STOP_SNAPSHOT=""
    return 1
  else
    # No Windows pid could be read for a wrapper that is still running, which
    # is a failed read rather than a move: nothing says the entry value has
    # been handed to another process, and `kill_process_snapshot` matches every
    # process it kills against the start ticks recorded with its pid, so the
    # snapshot kill below is still the right escalation.
    log "STOP[$label]: no Windows pid could be read for wrapper pid $pid at the force kill, so its recorded pid ${snapshot_winpid:-none} is left to the ticks-matched snapshot kill, and the wrapper's own pid is signaled"
    kill -9 "$pid" 2>/dev/null
    if kill -0 "$pid" 2>/dev/null; then
      log "STOP[$label]: wrapper pid $pid is still present after the kill -9, so a caller's wait on it can block until it ends on its own"
    fi
  fi
  # The same fail-open shape as verify_snapshot_dead's empty-snapshot
  # case, one phase down: `kill_process_snapshot` on an empty snapshot
  # trivially returns 0 (nothing to kill), which would read as
  # STOP_PATH="kill", a clean report, on a tree that was never resolved
  # at all. Checked explicitly before trusting that return.
  if [ "$snap_attempted" -eq 0 ] || [ "$snap_rc" -ne 0 ]; then
    kill_stale_entry_list
    log "STOP[$label]: no verified snapshot covers this stop (the entry resolve or walk failed, or the post-wait rebuild did) - not confirming dead on an unverified read"
    STOP_PATH="unverified"
    return 1
  fi
  if kill_process_snapshot "$snapshot"; then
    STOP_PATH="kill"
    LAST_STOP_SNAPSHOT=""
    return 0
  fi
  log "STOP[$label]: a snapshot survivor could not be killed after the KILL path - the last escalation this function has"
  STOP_PATH="kill_failed"
  return 1
}

# find_global_store is defined in bin/agentic-common.sh (sourced above),
# shared with .kit/live-common.sh so both callers filter on dev_mode the
# same way rather than carrying their own copies.

# --- Helper: the final ask as the one stream-json line the child reads ---
# Usage: final_ask_json <id> > "$ASK_REQUEST_FILE"
# The priming turn and the goal are written by bin/supervise-holder.sh, which
# holds the child's stdin pipe. The final ask is written to the child-N
# ask-request file instead, which the holder's poll writes into the pipe and
# removes, so a supervisor that adopted a child it did not launch can still
# reach its input. This user-turn line opens [SUPERVISOR-ASK id=<id>], which
# the plugin reads as neither the operator nor task work, followed by the one
# request the ask makes.
SUPERVISOR_ASK_TEXT="Every liveness signal from this session reads silent to the launcher. Reply with one line saying what you are doing now."
final_ask_json() {
  node -e "
    const id = process.argv[1] || '';
    const text = process.argv[2] || '';
    const json = JSON.stringify({type:'user',role:'user',message:{role:'user',content:[{type:'text',text:
      '[SUPERVISOR-ASK id=' + id + '] ' + text
    }]}});
    process.stdout.write(json + '\n');
  " "$1" "$SUPERVISOR_ASK_TEXT"
}

# --- The shutdown ask's text ---
# The text of the shutdown record the poll writes to the mailbox once a
# shutdown request is present. The child's plugin submits it as a turn opening
# [SUPERVISOR id=<id>], and the priming turn says what such a prompt carries.
# Held here and handed to the poll, so the injection ledger sizes it.
SUPERVISOR_SHUTDOWN_TEXT="The launcher is ending this session. Bank your state now, with the plan doc, the goal tree and any owed message on disk, then call supervisor_shutdown."

# --- Helper: read a fact from .agentic-personas.json ---
# Usage: get_fact <workdir> <persona> <fact>
# Prints the timestamp of the newest matching decision, or empty.
get_fact() {
  local workdir="$1"
  local persona="$2"
  local fact="$3"
  local store="$workdir/.agentic-personas.json"
  node -e "
const fs = require('fs');
let s;
try {
  s = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
} catch (e) {
  process.exit(1);
}
const p = s[process.argv[2]];
if (!p) process.exit(1);
const d = (p.decisions||[]).filter(x => x.action === process.argv[3]);
if (d.length === 0) process.exit(1);
const newest = d[d.length - 1];
console.log(newest.timestamp || 0);
" "$store" "$persona" "$fact" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: read the restart request the coordinator left in the run directory ---
# The coordinator's fleet_restart tool writes <rundir>/restart.request rather
# than a restart_requested decision, since this persona's store has one
# writer. It is the same fact, read through the parser the poll imports
# (bin/supervise-restart-request.mjs), so the two paths cannot disagree on
# what a request is. Prints its timestamp, or nothing where the parser reads
# no request.
get_restart_request() {
  node --input-type=module -e "
import { pathToFileURL } from 'node:url';
const { readRestartRequest } = await import(pathToFileURL(process.argv[1]).href);
const at = readRestartRequest(process.argv[2], Date.now());
if (at !== null) console.log(Math.floor(at));
" "$PLUGIN_DIR/bin/supervise-restart-request.mjs" "$RUNDIR" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: read the interrupt request the coordinator left in the run
# directory ---
# The coordinator's fleet_interrupt tool writes <rundir>/interrupt.request the
# same way fleet_restart writes restart.request: one file in this persona's
# own run directory, read through the parser the poll would import
# (bin/supervise-interrupt-request.mjs), so the two paths cannot disagree on
# what a request is. Prints "<at>\t<by>\t<reason>" on one line where the
# parser reads a request, nothing where it reads none. by and reason are cut
# to 64 and 200 characters here, the same bounds write_interrupt_relay
# applies, so a request the skip path never re-reads through that writer
# still logs a bounded reason; they are then stripped of every C0 control,
# DEL, C1 control and Unicode line/paragraph separator so the caller's own
# log calls, which carry this line's fields as plain bash arguments, can
# never be split into more than one line by either field. Called once per
# poll, on every running
# child, launched or adopted, to decide whether to relay or to skip. The
# existence check ahead of the spawn is the common case, no file at all,
# answered without paying for a node start.
get_interrupt_request() {
  [ -f "$RUNDIR/interrupt.request" ] || return 0
  node --input-type=module -e "
import { pathToFileURL } from 'node:url';
const { readInterruptRequest } = await import(pathToFileURL(process.argv[1]).href);
const req = readInterruptRequest(process.argv[2], Date.now());
if (req === null) process.exit(0);
const by = req.by.slice(0, 64);
const reason = req.reason.slice(0, 200);
const sep = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
const strip = (s) => s.replace(new RegExp('[\\\\x00-\\\\x1f\\\\x7f-\\\\x9f' + sep + ']', 'g'), '');
console.log(Math.floor(req.at) + String.fromCharCode(9) + strip(by) + String.fromCharCode(9) + strip(reason));
" "$PLUGIN_DIR/bin/supervise-interrupt-request.mjs" "$RUNDIR" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: whether the child has a turn running, and when it started ---
# Usage: get_child_turn_started
# Reads $CHILD_HEARTBEAT, the same file the real poll reads (its path is set
# once near the top of this script and handed to bin/supervise-poll.mjs as
# that script's first argument), through readChildHeartbeat
# (bin/supervise-heartbeat.mjs), the same reader and the same read guard the
# liveness verdict itself uses (bin/supervise-poll.mjs imports the same
# function), so this reading and the liveness verdict's own heartbeat read
# can never disagree on whose heartbeat file this is or what counts as
# unreadable. bin/supervise-poll.mjs is never imported itself: its own header
# says so, since it runs its CLI unconditionally on load. Prints
# turnStartedAt where the file parses, names this child's own session (or
# none has been recorded on this poll yet), and carries a numeric
# turnStartedAt; prints nothing and exits 0 for a missing or unreadable file,
# one naming another session, or one with no turn open (turnStartedAt null
# between turns), each of which readChildHeartbeat itself catches and reports
# as null, so the interrupt gate below reads every one of them as no running
# turn. A thrown error this function's own node call does not catch (the
# import failing, for instance) exits non-zero instead, prints nothing the
# same as the no-turn case, and the caller tells the two apart by that exit
# code rather than by the empty output alone. The existence check ahead of
# the spawn is the common case early in a child's life, no heartbeat file
# yet.
get_child_turn_started() {
  [ -f "$CHILD_HEARTBEAT" ] || return 0
  node --input-type=module -e "
import { pathToFileURL } from 'node:url';
const { readChildHeartbeat } = await import(pathToFileURL(process.argv[1]).href);
const hb = readChildHeartbeat(process.argv[2], process.argv[3] || null);
if (hb && hb.turnStartedAt !== null && hb.turnStartedAt !== undefined) console.log(hb.turnStartedAt);
" "$PLUGIN_DIR/bin/supervise-heartbeat.mjs" "$CHILD_HEARTBEAT" "${CHILD_SESSION_ID:-}" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: write the coordinator's interrupt request into the child's own
# interrupt-request file ---
# Usage: write_interrupt_relay <id> <request_at>
# Re-reads <rundir>/interrupt.request through the same parser
# get_interrupt_request reads. request_at is the caller's own reading, from
# the call that decided to relay; this call's own read can still land on a
# different request, where the coordinator writes a new one between the two
# reads, so the re-read's Math.floor(at) must equal request_at exactly, or
# this call exits non-zero and writes nothing rather than relay a request the
# caller never decided on. On a match, writes the re-read object whole, with
# the id this poll minted, to "$INTERRUPT_REQUEST_FILE.tmp" - the caller
# moves it into place so the holder never reads a half-written file. by and
# reason are cut to 64 and 200 characters before the write, the bounds the
# holder's own validator enforces, so an oversized field in the request file
# still passes that validator. Prints "<by>\t<reason>" on success, both cut
# and with every C0 control, DEL, C1 control and Unicode line/paragraph
# separator stripped, the same strip the holder's own relay applies before it
# logs a reason: the caller's own log call carries this printed text as bash
# arguments, so a control character or an embedded separator in either field
# never reaches that one log line as more than plain text. Exits non-zero and
# writes nothing where the reader now finds no request at all, or one whose
# at no longer matches request_at (the request was cleared or overwritten
# between the two reads).
write_interrupt_relay() {
  local id="$1" request_at="$2"
  node --input-type=module -e "
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const { readInterruptRequest } = await import(pathToFileURL(process.argv[1]).href);
const req = readInterruptRequest(process.argv[2], Date.now());
if (req === null) process.exit(1);
if (Math.floor(req.at) !== Number(process.argv[5])) process.exit(1);
const by = req.by.slice(0, 64);
const reason = req.reason.slice(0, 200);
fs.writeFileSync(process.argv[3], JSON.stringify({ id: process.argv[4], at: req.at, by, reason }) + String.fromCharCode(10));
const sep = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
const strip = (s) => s.replace(new RegExp('[\\\\x00-\\\\x1f\\\\x7f-\\\\x9f' + sep + ']', 'g'), '');
process.stdout.write(strip(by) + String.fromCharCode(9) + strip(reason) + String.fromCharCode(10));
" "$PLUGIN_DIR/bin/supervise-interrupt-request.mjs" "$RUNDIR" "$INTERRUPT_REQUEST_FILE.tmp" "$id" "$request_at" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: relay the coordinator's interrupt request to the running child,
# once, only while the turn it named is still the one running ---
# Called on every poll of a running child, launched or adopted, right after
# run_child_poll, as its own step in its own process(es): run_child_poll's
# own "in one process" reading above describes that call alone, not this one.
# A request older than CHILD_START_TS is one this child predates and never
# acts on; a request no newer than "$CHILD_DIR/interrupt.served" is one an
# earlier poll, by this supervisor or by one that adopted this same child,
# already relayed or already skipped, so neither fires twice and a supervisor
# that adopts a running child never re-sends its predecessor's request.
# Past those two, a session-known check: note_child_session_id runs after
# this call in the poll loop, so a relaunched child's first few polls carry
# no CHILD_SESSION_ID yet, while CHILD_HEARTBEAT on disk can still be a
# predecessor's file, since the launch cleanup never removes it. Reading that
# file blind could relay against the predecessor's own stale turn, so while
# the id is unknown this returns without reading the heartbeat and without
# writing interrupt.served, leaving the request standing for the poll that
# has the id.
#
# Past that, the turn gate (option A, the plan's Decisions section): the
# coordinator's fleet_interrupt call and its agentic_say can land in
# either order relative to the relay, so a request whose turn has already
# ended, or whose turn has not started yet, must not end some other turn in
# its place. get_child_turn_started's reading of turnStartedAt is that turn's
# own start; where it is at or before the request's at, this is the turn the
# coordinator meant, and the relay proceeds. Where it is missing (no
# heartbeat, no turn open, or the field unreadable) or later than the
# request, there is no turn to end on the coordinator's own terms, and the
# request is recorded served without relaying, logged once as
# INTERRUPT_SKIPPED, covering both "no running turn" and "a turn that began
# after the request" in the one line. Where the read itself failed (a
# non-zero exit from get_child_turn_started), there is no reading to gate on
# at all, so this returns the same way the session-known check above does,
# without writing interrupt.served, and the next poll re-reads the turn gate
# from scratch rather than treating the failure as "no turn". The residual:
# the published heartbeat is a periodic stamp (hooks/index.ts, the comment
# above sess.turnStartedAt's heartbeat write, near line 9812), so
# turnStartedAt can still name a turn for up to one heartbeat interval after
# that turn itself ended; within that window a request meant for the ended
# turn can still relay against the turn that followed it. Once past the turn
# gate, mints an id shaped like write_final_ask's FINAL_ASK_ID, writes the
# child's own interrupt-request file by write-then-rename so the holder never
# reads a half-written file, records the served time only on a write that
# lands, and logs the relay with its reason and requester.
#
# INTERRUPT_HANDLED_AT is this supervisor's own in-memory record of the
# request_at it already relayed or already skipped for this child, set the
# moment that decision is taken (the relay's mv landing, or the skip itself),
# before either one's own served-marker write is attempted. A later poll that
# finds the served-marker write still missing, because that write itself
# failed, reads request_at against this record rather than against the turn
# gate again: a match means the decision already happened, so this poll
# retries only the served-marker write, checked, and neither relays nor
# skips nor logs a second time. Without this record, a served-marker write
# that keeps failing would look unhandled on every poll, relaying the
# request again each time, which can land on the turn after the one the
# coordinator meant. The residual: a successor supervisor that adopts this
# child before the marker lands carries no such memory (it is process-local,
# never written to disk), and can relay or skip the same request once more.
# A relay or skip whose served-marker write fails is logged INTERRUPT_FAILED
# once for this request_at rather than once per poll, since every later poll
# retries only that write until it finally lands.
relay_interrupt_request() {
  local request_fields request_at by reason served_at turn_started turn_rc fields id
  request_fields=$(get_interrupt_request)
  [ -n "$request_fields" ] || return 0
  request_at="${request_fields%%$'\t'*}"
  request_fields="${request_fields#*$'\t'}"
  by="${request_fields%%$'\t'*}"
  reason="${request_fields#*$'\t'}"
  [ "$request_at" -gt "$CHILD_START_TS" ] || return 0
  served_at=""
  if [ -s "$CHILD_DIR/interrupt.served" ]; then
    served_at=$(cat "$CHILD_DIR/interrupt.served" 2>/dev/null)
    case "$served_at" in ''|*[!0-9]*) served_at="" ;; esac
  fi
  [ -z "$served_at" ] || [ "$request_at" -gt "$served_at" ] || return 0

  # A relaunched child's early polls carry no recorded session id yet
  # (note_child_session_id runs after this call); the heartbeat on disk could
  # still be a predecessor's. Wait for the id rather than read it blind.
  [ -n "${CHILD_SESSION_ID:-}" ] || return 0

  if [ "${INTERRUPT_HANDLED_AT:-}" = "$request_at" ]; then
    # Already relayed or already skipped by an earlier poll on this
    # supervisor; only the served marker failed to land. Retry just that
    # write, checked, with nothing relayed or skipped and nothing re-logged.
    printf '%s' "$request_at" > "$CHILD_DIR/interrupt.served" 2>>"$RUNDIR/supervisor.err"
    return 0
  fi

  turn_started=$(get_child_turn_started)
  turn_rc=$?
  # A non-zero exit is a failed read, not "no turn": leave interrupt.served
  # untouched so the next poll re-reads the turn gate from scratch, rather
  # than recording a transient failure as a served skip.
  [ "$turn_rc" -eq 0 ] || return 0
  if [ -z "$turn_started" ] || [ "$turn_started" -gt "$request_at" ]; then
    INTERRUPT_HANDLED_AT="$request_at"
    if printf '%s' "$request_at" > "$CHILD_DIR/interrupt.served" 2>>"$RUNDIR/supervisor.err"; then
      log "INTERRUPT_SKIPPED: $reason (child-$CHILD_INDEX, by=$by, turn started ${turn_started:-none})"
    elif [ "${INTERRUPT_FAIL_LOGGED_AT:-}" != "$request_at" ]; then
      log "INTERRUPT_FAILED: the request at $request_at for child-$CHILD_INDEX was skipped, but its served marker could not be written; the next poll retries only the marker write"
      INTERRUPT_FAIL_LOGGED_AT="$request_at"
    fi
    return 0
  fi

  INTERRUPT_SEQ=$((INTERRUPT_SEQ + 1))
  id="$SUPERVISOR_START_MS-int-$INTERRUPT_SEQ"
  if fields=$(write_interrupt_relay "$id" "$request_at") \
     && mv -f "$INTERRUPT_REQUEST_FILE.tmp" "$INTERRUPT_REQUEST_FILE" 2>>"$RUNDIR/supervisor.err"; then
    by="${fields%%$'\t'*}"
    reason="${fields#*$'\t'}"
    INTERRUPT_HANDLED_AT="$request_at"
    if printf '%s' "$request_at" > "$CHILD_DIR/interrupt.served" 2>>"$RUNDIR/supervisor.err"; then
      log "INTERRUPT: $reason (child-$CHILD_INDEX, id=$id, by=$by)"
    elif [ "${INTERRUPT_FAIL_LOGGED_AT:-}" != "$request_at" ]; then
      log "INTERRUPT_FAILED: the request at $request_at for child-$CHILD_INDEX (id=$id) relayed, but its served marker could not be written; the next poll retries only the marker write"
      INTERRUPT_FAIL_LOGGED_AT="$request_at"
    fi
  elif [ "${INTERRUPT_FAIL_LOGGED_AT:-}" != "$request_at" ]; then
    log "INTERRUPT_FAILED: the request at $request_at for child-$CHILD_INDEX (id=$id) was not relayed, either because the request was cleared or overwritten between the two reads or because the file could not be written; the next poll retries"
    INTERRUPT_FAIL_LOGGED_AT="$request_at"
  fi
}

# --- Helper: read the newest root_complete decision's timestamp AND
# whether it was backfilled, in one read ---
# v2 Section 0 item 1: a root_complete decision whose own detail text says
# "backfilled" records real tool work with no active goal tree - that is not
# a real goal completion. No root_complete triggers RESTART_PASSIVE; the flag
# picks which NOTE line the natural-exit path logs before a clean exit
# relaunches unaccounted. The hook
# now logs such work as an untracked_work decision and writes no such line,
# so this flag reads the lines a store written before that still carries
# until they roll off its decision log. A sibling to
# get_fact rather than a change to it: get_fact's existing single-token
# output feeds bare numeric comparisons elsewhere (the -gt checks below),
# and a two-word answer there would fail those silently. The timestamp and
# the flag come from the SAME read, not two separate store reads at two
# different moments - a root_complete decision appended between two calls
# would otherwise pair a real timestamp with a stale flag, or the reverse.
# "Newest" here is last-in-array, not max-by-timestamp: holds today
# because decisions[] is append-ordered and capped with
# slice(-DECISIONS_MAX), so a future out-of-order writer would break this
# and get_fact identically.
# Usage: get_root_complete <workdir> <persona>
# Prints "<timestamp> <flag>" where <flag> is "1" (backfilled) or "0", or
# empty when there is no root_complete decision at all.
get_root_complete() {
  local workdir="$1"
  local persona="$2"
  local store="$workdir/.agentic-personas.json"
  node -e "
const fs = require('fs');
let s;
try {
  s = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
} catch (e) {
  process.exit(1);
}
const p = s[process.argv[2]];
if (!p) process.exit(1);
const d = (p.decisions||[]).filter(x => x.action === 'root_complete');
if (d.length === 0) process.exit(1);
const newest = d[d.length - 1];
const BACKFILLED_SUFFIX = ' marked complete - backfilled, work already done';
const detail = typeof newest.detail === 'string' ? newest.detail : '';
const backfilled = (detail.startsWith('Root ') && detail.endsWith(BACKFILLED_SUFFIX) && !/\s/.test(detail.slice(5, detail.length - BACKFILLED_SUFFIX.length))) ? '1' : '0';
console.log((newest.timestamp || 0) + ' ' + backfilled);
" "$store" "$persona" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: how much longer a rate-limited child has to wait ---
# A child that meets a rate limit parks in the engine's own retry backoff. From
# outside it is a live process writing nothing, which reads as WAITING in the
# log for as long as the park runs, so the operator cannot tell an hours-long
# park from an idle child. The stream carries the fact: a `system` record with
# subtype `api_retry` and `error_status` 429, whose `retry_delay_ms` names how
# much of the wait is left. One is written every 30 seconds while the park
# runs, each naming a smaller remaining wait than the last.
#
# Only the newest record in the stream is read. Every other record is the child
# working, so a park ends by itself the moment the child writes one, and no
# separate expiry is needed. The newest record is the last COMPLETE line: the
# child may be mid-write at the end of the file, and a half-written line is not
# a record yet.
#
# Prints "<epoch milliseconds> <ISO 8601>" for the moment the wait ends, or
# "- -" when the newest record is anything else. Only the tail of the stream is
# read, since a long-running child's stdout.jsonl reaches megabytes and this
# runs on every poll.
# Usage: get_rate_limit_reset <stdout.jsonl path>
get_rate_limit_reset() {
  local out_file="$1"
  if [ ! -f "$out_file" ]; then
    echo "- -"
    return 0
  fi
  node -e "
const fs = require('fs');
const SCAN_BYTES = 262144;
const now = Date.now();
let text = '';
let scanStart = 0;
try {
  const fd = fs.openSync(process.argv[1], 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size > SCAN_BYTES) scanStart = size - SCAN_BYTES;
    const len = size - scanStart;
    const buf = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buf, 0, len, scanStart);
    text = buf.toString('utf8');
  } finally { fs.closeSync(fd); }
} catch (e) { console.log('- -'); process.exit(0); }
const lines = text.split('\n');
// The tail can start mid-line, and the file can end mid-line while the child
// is writing. Neither partial is a record.
if (scanStart > 0) lines.shift();
lines.pop();
let newest = null;
for (const line of lines) {
  if (!line.trim()) continue;
  let record;
  try { record = JSON.parse(line); } catch (e) { continue; }
  if (record && typeof record === 'object') newest = record;
}
const isRetry = newest
  && newest.type === 'system'
  && newest.subtype === 'api_retry'
  && Number(newest.error_status) === 429
  && Number.isFinite(Number(newest.retry_delay_ms))
  && Number(newest.retry_delay_ms) > 0;
if (!isRetry) { console.log('- -'); process.exit(0); }
const until = now + Number(newest.retry_delay_ms);
console.log(until + ' ' + new Date(until).toISOString());
" "$out_file" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: read child session id from stream-json init line ---
read_child_session_id() {
  local out_file="$1"
  node -e "
const fs = require('fs');
try {
  const lines = fs.readFileSync(process.argv[1], 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.session_id) {
      console.log(o.session_id);
      process.exit(0);
    }
  }
} catch (e) { /* not found yet */ }
process.exit(1);
" "$out_file" 2>> "$RUNDIR/supervisor.err"
}

# --- Helper: count a relaunch against the rolling-hour restart budget ---
# Each relaunch is stamped, stamps older than an hour are dropped, and
# RESTART_COUNT is what is left. Every relaunch whose trigger sits outside the
# child's own exit counts here as well as the ones that follow a crash, since
# a trigger that keeps firing would otherwise relaunch the child at poll
# cadence with nothing to stop it.
record_restart_in_hour() {
  local now_ms t
  now_ms=$(node -e "console.log(Date.now())")
  RESTART_TIMES+=("$now_ms")
  local pruned=()
  for t in "${RESTART_TIMES[@]}"; do
    if [ $((now_ms - t)) -lt 3600000 ]; then
      pruned+=("$t")
    fi
  done
  RESTART_TIMES=("${pruned[@]}")
  RESTART_COUNT=${#RESTART_TIMES[@]}
}

# --- Helper: sweep a child the liveness verdict read gone, and account it ---
# Every signal is silent and the walk found no live process. The tree the
# child was last recorded as is swept, and the relaunch is accounted exactly
# as a restart is, so the restart budget still bounds a persona that keeps
# dying. A sweep that cannot clear the tree takes the retry backstop the
# restart branch takes, which re-snapshots once where the sweep left no
# record to retry, and a backstop that fails ends the run at exit 5, since a
# relaunch beside a survivor puts two children on one persona claim. Returns
# once the child is accounted and the run goes on; every stop the budget, the
# crash limit or a survivor calls for exits from here.
sweep_gone_child() {
  log "SWEEP_RELAUNCH: $DECIDE_REASON"
  sweep_child_tree "sweep_relaunch"
  SWEEP_RC=$?
  if [ "$SWEEP_RC" -eq 1 ]; then
    retry_stop_escalation "sweep_relaunch" "$SWEEP_RC"
    SWEEP_RC=$?
    if [ "$SWEEP_RC" -ne 0 ]; then
      log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable after every sweep retry"
      exit 5
    fi
  fi
  # The walk read the child gone, but the wrapper can outlive that
  # reading: a walk that raced the wrapper's own exit, or a sweep with
  # nothing to kill. A wait on a live wrapper would block this loop for
  # as long as the child lives, so a wrapper still running takes the
  # ordinary stop phases first, and its failure ends the run at exit 5
  # as it does on the restart branch. An adopted child's presence is read
  # from a fresh walk and the marker, since the walk that read it gone was
  # taken before the sweep.
  if [ "${CHILD_ADOPTED:-}" = "1" ]; then refresh_child_tree; fi
  if child_present; then
    log "SWEEP_RELAUNCH: child-$CHILD_INDEX's wrapper is still running after the sweep, so it is stopped before the relaunch"
    stop_child "sweep_relaunch"
    retry_stop_escalation "sweep_relaunch" $?
    STOP_ESCALATION_RESULT=$?
    if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
      log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
      exit 5
    fi
  fi
  # The holder is killed so it stops holding the pipe: `wait` on the pipeline
  # would otherwise block on the holder as long as it runs.
  kill_holder
  wait "$CHILD_LAUNCH_PID" 2>/dev/null
  CHILD_LAUNCH_PID=""
  EXIT_CODE=$(child_exit_code)
  clear_handle
  log "EXIT child-$CHILD_INDEX code=$EXIT_CODE (sweep_relaunch)"

  CHILD_RUN_MS=""
  if [ -n "${LAUNCHED_AT:-}" ]; then CHILD_RUN_MS=$(( ( $(node -e "console.log(Date.now())") - LAUNCHED_AT ) )); fi
  if [ $EXIT_CODE -ne 0 ] && [ -n "$CHILD_RUN_MS" ] && [ $CHILD_RUN_MS -lt $SUPERVISOR_MIN_RUN_MS ]; then
    CRASH_COUNT=$((CRASH_COUNT + 1))
  else
    CRASH_COUNT=0
  fi
  record_restart_in_hour

  if [ $RESTART_COUNT -ge $SUPERVISOR_MAX_RESTARTS_PER_HOUR ]; then
    log "STOP_BUDGET: $RESTART_COUNT/$SUPERVISOR_MAX_RESTARTS_PER_HOUR restarts in the hour"
    exit 4
  fi
  if [ $CRASH_COUNT -ge $SUPERVISOR_CRASH_LIMIT ]; then
    log "STOP_CRASH_LOOP: $CRASH_COUNT crashes within $SUPERVISOR_MIN_RUN_MS ms"
    exit 3
  fi
}

# --- Helper: carry one poll's liveness state to the next, and log it ---
# The poll process is fresh every poll, so the stream's size and the moment it
# last changed, and the final ask's time, come back from it as the POLL_*
# values and are held here for the next poll to hand in. A cleared ask is
# named, since it is a frozen child a signal showed alive. A heartbeat file
# the child never wrote is named once per child, however many polls read it
# absent, and the liveness reading is named whenever it changes. The caller
# runs this only for a poll that ran: a failed one says nothing about the
# stream or the ask, so the last reading of each stands.
note_liveness_poll() {
  STREAM_SEEN_SIZE="$POLL_STREAM_SIZE"
  STREAM_CHANGED_AT="$POLL_STREAM_CHANGED_AT"
  if [ -n "$FINAL_ASK_AT" ] && [ -z "$POLL_FINAL_ASK_AT" ]; then
    log "FINAL_ASK_CLEARED child-$CHILD_INDEX: a signal moved inside the final ask's window (liveness: $POLL_LIVENESS)"
  fi
  FINAL_ASK_AT="$POLL_FINAL_ASK_AT"
  if [ "$POLL_HEARTBEAT_NOTE" = "HEARTBEAT_ABSENT" ] && [ -z "$HEARTBEAT_ABSENT_LOGGED" ]; then
    log "HEARTBEAT_ABSENT child-$CHILD_INDEX: $CHILD_HEARTBEAT has not been written past the startup grace, so the heartbeat reads as not silent for this child"
    HEARTBEAT_ABSENT_LOGGED=1
  fi
  if [ -n "$POLL_LIVENESS" ] && [ "$POLL_LIVENESS" != "$LIVENESS_LOGGED" ]; then
    log "LIVENESS child-$CHILD_INDEX: $POLL_LIVENESS"
    LIVENESS_LOGGED="$POLL_LIVENESS"
  fi
}

# --- Helper: write the final ask for the frozen reading a poll decided ---
# Run on the one poll that decided final_ask, whether the poll loop's own or
# the gate's poll that adopted a frozen child, so an adopted child is asked
# exactly as a launched one is. That poll has already handed back the ask's
# time, so the window runs from it and the next frozen reading waits inside
# the window rather than deciding final_ask again: this runs once per frozen
# reading, never on a cadence. The ask is one user turn on the child's input
# asking for a line of status. A turn the child answers moves its stream and
# transcript, and a window that closes with every signal still silent
# restarts. The ask is written to the child-N ask-request file, which the
# holder's poll writes into the pipe and removes. Writing it there rather
# than straight to the pipe is what lets a supervisor that adopted this child
# reach its input, since only the holder holds the pipe. The file is written
# to a temporary name and moved into place, so the holder never reads a file
# node is still writing. Where the file cannot be written, the window is a
# wait all the same. Reads DECIDE_REASON from the poll that decided it.
write_final_ask() {
  FINAL_ASK_SEQ=$((FINAL_ASK_SEQ + 1))
  FINAL_ASK_ID="$SUPERVISOR_START_MS-ask-$FINAL_ASK_SEQ"
  if final_ask_json "$FINAL_ASK_ID" > "$ASK_REQUEST_FILE.tmp" 2>>"$RUNDIR/supervisor.err" \
     && mv -f "$ASK_REQUEST_FILE.tmp" "$ASK_REQUEST_FILE" 2>>"$RUNDIR/supervisor.err"; then
    log "FINAL_ASK child-$CHILD_INDEX: $DECIDE_REASON (ask id=$FINAL_ASK_ID written to $ASK_REQUEST_FILE for the holder to relay)"
  else
    log "FINAL_ASK child-$CHILD_INDEX: $DECIDE_REASON (ask id=$FINAL_ASK_ID could not be written to $ASK_REQUEST_FILE, so the window is a wait)"
  fi
}

# --- Helper: carry the shutdown ask from one poll to the next, and log it ---
# The poll writes the ask once, where a shutdown request is present and no ask
# to this child is open, and hands its id and time back as the POLL_SHUTDOWN_*
# values. They are held here for the next poll to hand in, which is what keeps
# a second record from being written while one is open and what the grace is
# measured from. The ask is named on the poll that writes it. The caller runs
# this only for a poll that ran.
note_shutdown_ask() {
  if [ -n "$POLL_SHUTDOWN_ASK_ID" ] && [ "$POLL_SHUTDOWN_ASK_ID" != "$SHUTDOWN_ASK_ID" ]; then
    log "ASK[shutdown] id=$POLL_SHUTDOWN_ASK_ID child-$CHILD_INDEX: $SHUTDOWN_REQUEST_FILE asks this persona to stop, and the child has ${SUPERVISOR_ASK_GRACE_MS}ms to bank its state and call supervisor_shutdown"
  fi
  SHUTDOWN_ASK_ID="$POLL_SHUTDOWN_ASK_ID"
  SHUTDOWN_ASK_AT="$POLL_SHUTDOWN_ASK_AT"
}

# --- Helper: remove the shutdown request once the stop it asked for is done ---
# Run before each exit 0 a shutdown leads to, so the next start in this run
# directory launches rather than reading the request again. A request that
# cannot be removed is named, since that next start will exit 0 on it.
clear_shutdown_request() {
  [ -f "$SHUTDOWN_REQUEST_FILE" ] || return 0
  rm -f "$SHUTDOWN_REQUEST_FILE" 2>/dev/null
  if [ -f "$SHUTDOWN_REQUEST_FILE" ]; then
    log "NOTE: $SHUTDOWN_REQUEST_FILE could not be removed, so the next start in this run directory reads it again and exits 0 without launching"
  fi
}

# --- Helper: stop a child that did not honor the shutdown ask ---
# The grace has passed with no shutdown_requested from the child, so the stop
# proceeds through the stop phases as every decide-path stop does, under a
# label of its own, and the run ends at exit 0, which the keeper reads as the
# shutdown done. A process from the child left alive or unverifiable outranks
# that and ends the run at exit 5, as it does on every other stop, and the
# request stays in place for the next start.
ask_timeout_stop() {
  log "ASK TIMEOUT id=$SHUTDOWN_ASK_ID child-$CHILD_INDEX: $DECIDE_REASON"
  stop_child "ask_timeout"
  retry_stop_escalation "ask_timeout" $?
  STOP_ESCALATION_RESULT=$?
  wait "$CHILD_LAUNCH_PID" 2>/dev/null
  CHILD_LAUNCH_PID=""
  EXIT_CODE=$(child_exit_code)
  clear_handle
  log "EXIT child-$CHILD_INDEX code=$EXIT_CODE ($STOP_PATH)"
  if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
    log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
    exit 5
  fi
  clear_shutdown_request
  exit 0
}

# --- Helper: read the holder's pid from holder.pid ---
# The value reaches kill -0 and kill -TERM, where bash reads a negative
# number as a process group, so a file holding anything but digits reads as
# no holder pid recorded and prints nothing.
# Usage: read_holder_pid <holder-pid-path>
read_holder_pid() {
  local v
  v=$(cat "$1" 2>/dev/null)
  v="${v%$'\r'}"
  case "$v" in
    ''|*[!0-9]*) ;;
    *) echo "$v" ;;
  esac
}

# --- Helper: read the child's exit code from the .exit marker ---
# The launch shape writes the child's own exit code into the marker, so both
# the launching supervisor and one that adopted a child it did not launch read
# how the child ended from the same place rather than from `wait`, which a
# non-parent cannot use. A marker that is absent (the wrapper was force-killed
# before it could write) or holds something that is not an exit code is named
# and accounted as a non-zero exit, so it counts against the crash limit and
# the restart budget rather than reading as a clean exit 0. The note goes
# through log_diag, since this function's stdout is the code a caller captures.
# Usage: read_exit_marker <marker-path>
read_exit_marker() {
  local v
  if [ ! -f "$1" ]; then
    log_diag "EXIT_MARKER: marker absent at $1, so the child's exit code is unknown and is accounted as a non-zero exit"
    echo 1
    return 0
  fi
  v=$(cat "$1" 2>/dev/null)
  v="${v%$'\r'}"
  v="${v//[[:space:]]/}"
  case "$v" in
    ''|*[!0-9]*)
      log_diag "EXIT_MARKER: marker at $1 holds '$v', which is not an exit code, so it is accounted as a non-zero exit"
      echo 1
      ;;
    *) echo "$v" ;;
  esac
}

# --- Helper: the child stage of the launch pipeline ---
# The pipeline's last stage cannot be `claude` itself: a signal to the stage's
# pid must reach the child and the child's own exit code must reach the .exit
# marker, and a plain brace group can do neither. So the stage runs the child
# in the background with its stdin kept (a backgrounded command in a
# non-interactive shell otherwise reads /dev/null), forwards TERM to it,
# waits again after the trap interrupts the first wait, and then writes the
# child's real exit code to the marker. A force kill of this stage's own pid
# skips the marker, which read_exit_marker reads as absent.
# Usage: child_wrapper <exit-marker> <command...>
child_wrapper() {
  local marker="$1"
  shift
  # The trap is installed before the fork and reads `inner` at signal time. A
  # TERM that lands before `inner` is set, before the fork or between the fork
  # and the assignment below, is held in `term_pending` and forwarded the
  # moment the pid is known. The handler never falls back to `$!`: before the
  # fork that expansion names the launching shell's last background job, a
  # process this stage has no business signalling.
  local inner="" term_pending=""
  trap 'if [ -n "$inner" ]; then kill -TERM "$inner" 2>/dev/null; else term_pending=1; fi' TERM
  "$@" <&0 &
  inner=$!
  # A held TERM is forwarded once, now that the pid is known. A child that
  # runs on after it is a stop not honored, and falls to the stop's next rung,
  # the tree kill, as every other unhonored signal does.
  if [ -n "$term_pending" ]; then
    kill -TERM "$inner" 2>/dev/null
  fi
  wait "$inner"
  local rc=$?
  while kill -0 "$inner" 2>/dev/null; do
    wait "$inner"
    rc=$?
  done
  echo "$rc" > "$marker"
  return "$rc"
}

# --- Helper: kill the holder so the child reads end of input ---
# The graceful stop's pipe close, ticks-first for every holder with a recorded
# pair. Where the holder's Windows pid and start ticks are recorded, at launch
# or read from a handle at adoption, the kill is the ticks-matched
# kill_process_snapshot, the same identity-guarded kill the KILL phase uses, so
# a Windows pid recycled onto another process is never signalled and any
# supervisor can do it without an MSYS signal. The MSYS `kill -0` is consulted
# only for a holder this supervisor launched itself, and only as a skip: an
# own holder that no longer answers is already gone, since it leaves on its
# own a poll after the child dies, and nothing is killed. It never licenses a
# signal. The MSYS TERM survives only for an own-launched holder whose ticks
# were never read. Its one guard is the `kill -0` at entry, which proves the
# pid answered a moment before the signal and nothing more: a holder that
# exits and is reaped between that check and the TERM can hand its pid to
# another process inside that window, and the signal then reaches whatever
# holds it. The window is the few lines between the check and the signal, and
# it stays open only while the launch's ticks read, which ensure_holder_ticks
# retries, has not landed. An adopted holder with no recorded ticks is left
# alone and named, never signalled by an unverified pid.
kill_holder() {
  if [ "${HOLDER_OWN_LAUNCH:-}" = "1" ] && [ -n "${HOLDER_LAUNCH_PID:-}" ] && ! kill -0 "$HOLDER_LAUNCH_PID" 2>/dev/null; then
    log "HOLDER: holder pid $HOLDER_LAUNCH_PID is already gone, so nothing is killed"
    return 0
  fi
  if [ -n "${HOLDER_WINPID:-}" ] && [ -n "${HOLDER_TICKS:-}" ]; then
    kill_process_snapshot "$HOLDER_WINPID,$HOLDER_TICKS" || true
    return 0
  fi
  if [ "${HOLDER_OWN_LAUNCH:-}" = "1" ] && [ -n "${HOLDER_LAUNCH_PID:-}" ]; then
    kill -TERM "$HOLDER_LAUNCH_PID" 2>/dev/null || true
    return 0
  fi
  if [ -n "${HOLDER_LAUNCH_PID:-}" ]; then
    log "HOLDER: holder pid $HOLDER_LAUNCH_PID has no recorded Windows pid and start ticks and was not launched by this supervisor, so it is not signalled on an unverified pid"
  fi
  return 0
}

# --- Helper: this supervisor's own Windows pid and start ticks, computed once ---
# Recorded into every handle: the pair an adopting supervisor checks to decide
# whether this supervisor is still running. Cached once a read returns a pair.
# The main loop reads it at its head before any handle is read, so every run
# whose own Windows pid resolves pays one PowerShell read for it, a
# request-at-launch exit and a GATE FAIL included.
# snapshot_process_tree refuses this process's own pid, so
# the ticks are read directly.
SELF_WINPID=""
SELF_TICKS=""
SELF_TICKS_DONE=""
# Whether the last handle write carried the pair, set by write_handle.
HANDLE_HAS_SELF_PAIR=""
ensure_self_ticks() {
  [ -n "$SELF_TICKS_DONE" ] && return 0
  SELF_WINPID="$(resolve_windows_pid "$$")"
  if [ -n "$SELF_WINPID" ]; then
    SELF_TICKS="$(resolve_windows_start_ticks "$SELF_WINPID")"
  fi
  # The read is cached only once it returned a pair. A miss (a bounded
  # PowerShell read that did not complete) leaves it uncached, so the next
  # handle write retries rather than recording a null pair for the whole run,
  # which would read as a running writer forever and make the child
  # unadoptable after a detach.
  if [ -n "$SELF_WINPID" ] && [ -n "$SELF_TICKS" ]; then
    SELF_TICKS_DONE=1
  fi
  return 0
}

# --- Helper: whether a retried PowerShell read is due on this poll ---
# The two reads a launched child's handle can still be missing, the child's
# start ticks and this supervisor's own pair, are each retried on a doubling
# gap of polls (1, 2, 4, ... up to TICKS_RETRY_GAP_MAX) rather than on every
# poll, so a read that keeps missing costs a bounded number of PowerShell
# spawns over the child's run rather than one per poll forever. The state is
# two globals named from the prefix: <prefix>_RETRY_NEXT, the poll the next
# read is due on, and <prefix>_RETRY_GAP, the gap the last miss set. Prints
# nothing; returns 0 where the read is due and advances the gap, 1 otherwise.
# Usage: ticks_retry_due <prefix>
TICKS_RETRY_GAP_MAX=64
ticks_retry_due() {
  local next_var="${1}_RETRY_NEXT" gap_var="${1}_RETRY_GAP" next gap
  next="${!next_var:-0}"
  gap="${!gap_var:-1}"
  [ "${POLL_COUNT:-0}" -ge "$next" ] || return 1
  printf -v "$next_var" '%s' $(( ${POLL_COUNT:-0} + gap ))
  [ "$gap" -lt "$TICKS_RETRY_GAP_MAX" ] && gap=$((gap * 2))
  printf -v "$gap_var" '%s' "$gap"
  return 0
}

# --- Helper: the child's start ticks, retried until they land ---
# The launch reads the wrapper's start ticks once, bounded; a miss would leave
# the child unadoptable for its run, since an adopting supervisor checks that
# pair before it counts the child live. So a launched child whose ticks are
# still empty is retried on the polls ticks_retry_due names, the handle is
# rewritten when the pair lands, and a HANDLE: line names the gap while it
# stays empty. Runs for a launched child only: an adopted child's ticks were
# checked against a live process before it was adopted.
ensure_child_ticks() {
  [ -n "${CHILD_TICKS:-}" ] && return 0
  [ -n "${CHILD_WINPID:-}" ] || return 0
  ticks_retry_due CHILD_TICKS || return 0
  CHILD_TICKS=$(resolve_windows_start_ticks "$CHILD_WINPID")
  if [ -n "$CHILD_TICKS" ]; then
    write_handle "$CHILD_SESSION_ID"
    log "HANDLE: child-$CHILD_INDEX's start ticks landed on a later read ($CHILD_WINPID,$CHILD_TICKS); the handle now records them"
  else
    log "HANDLE: child-$CHILD_INDEX's start ticks are still unread for Windows pid $CHILD_WINPID, so the handle cannot yet be adopted; retrying on poll $CHILD_TICKS_RETRY_NEXT"
  fi
  return 0
}

# --- Helper: the holder's start ticks, retried until they land ---
# The launch reads the holder's start ticks once, bounded; a miss would leave
# the handle's holder pair half recorded for the run, and a supervisor that
# adopted the child could then not close its input pipe, since the holder is
# killed only by its ticks-matched pair. So a launched holder whose ticks are
# still empty is retried on the polls ticks_retry_due names, the handle is
# rewritten when the pair lands, and a HANDLE: line names the gap while it
# stays empty. Runs for a holder this supervisor launched only: an adopted
# holder's pair is what its handle recorded, and ticks read fresh for a
# recorded Windows pid could bind to a process that reused it. The same holds
# for an own holder that has exited, so the read is made only while the
# holder's launch pid still answers `kill -0`, the one MSYS check an own
# launch allows. A gone holder is logged once and never read, and the handle
# keeps its holder ticks null.
ensure_holder_ticks() {
  [ "${HOLDER_OWN_LAUNCH:-}" = "1" ] || return 0
  [ -n "${HOLDER_TICKS:-}" ] && return 0
  [ -n "${HOLDER_WINPID:-}" ] || return 0
  if [ -z "${HOLDER_LAUNCH_PID:-}" ] || ! kill -0 "$HOLDER_LAUNCH_PID" 2>/dev/null; then
    if [ -z "${HOLDER_GONE_LOGGED:-}" ]; then
      log "HANDLE: child-$CHILD_INDEX's holder pid ${HOLDER_LAUNCH_PID:-none} no longer answers, so its start ticks are not read: Windows may have handed pid $HOLDER_WINPID to another process"
      HOLDER_GONE_LOGGED=1
    fi
    return 0
  fi
  ticks_retry_due HOLDER_TICKS || return 0
  HOLDER_TICKS=$(resolve_windows_start_ticks "$HOLDER_WINPID")
  if [ -n "$HOLDER_TICKS" ]; then
    write_handle "$CHILD_SESSION_ID"
    log "HANDLE: child-$CHILD_INDEX's holder start ticks landed on a later read ($HOLDER_WINPID,$HOLDER_TICKS); the handle now records them"
  else
    log "HANDLE: child-$CHILD_INDEX's holder start ticks are still unread for Windows pid $HOLDER_WINPID, so an adopting supervisor could not close its input pipe; retrying on poll $HOLDER_TICKS_RETRY_NEXT"
  fi
  return 0
}

# --- Helper: this supervisor's own pair in the handle, retried until it lands ---
# A handle written with no supervisor pair reads as a running writer forever,
# which makes the child unadoptable after a detach. So a launched child whose
# handle was written without the pair retries ensure_self_ticks on the polls
# ticks_retry_due names, rewrites the handle once the pair lands, and names
# the gap while it stays empty. write_handle records whether its last write
# carried the pair in HANDLE_HAS_SELF_PAIR.
ensure_self_pair_recorded() {
  [ "${HANDLE_HAS_SELF_PAIR:-}" = "1" ] && return 0
  [ -n "${HANDLE_FILE:-}" ] || return 0
  ticks_retry_due SELF_TICKS || return 0
  ensure_self_ticks
  if [ -n "$SELF_TICKS_DONE" ]; then
    write_handle "$CHILD_SESSION_ID"
    log "HANDLE: this supervisor's own pid and start ticks landed on a later read ($SELF_WINPID,$SELF_TICKS); child-$CHILD_INDEX's handle now records them"
  else
    log "HANDLE: this supervisor's own pid and start ticks are still unread, so child-$CHILD_INDEX's handle still reads as a running writer; retrying on poll $SELF_TICKS_RETRY_NEXT"
  fi
  return 0
}

# --- Helper: a Windows pid's process start ticks ---
# The pair check_snapshot_survivors matches against, for a single pid rather
# than a walked tree: snapshot_process_tree refuses this supervisor's own pid,
# so the handle's own supervisor pid cannot be recorded through it. Prints the
# ticks, or nothing where the pid does not resolve or the walk did not complete.
# Usage: resolve_windows_start_ticks <windows-pid>
resolve_windows_start_ticks() {
  local winpid="$1" raw
  case "$winpid" in ''|*[!0-9]*) return 0 ;; esac
  raw=$(run_bounded_powershell_capture "$SUPERVISOR_PS_BOUND_S" "
    \$p = Get-Process -Id $winpid -ErrorAction SilentlyContinue
    if (\$p) { try { Write-Output ([int64]\$p.StartTime.Ticks) } catch {} }
    Write-Output '$STOP_PS_SENTINEL'
  ")
  ps_output_has_line "$raw" "$STOP_PS_SENTINEL" || return 1
  # The first line that is digits and nothing else is the ticks, found with
  # builtins so the read starts no process.
  local line
  while IFS= read -r line; do
    case "$line" in ''|*[!0-9]*) continue ;; esac
    printf '%s\n' "$line"
    return 0
  done <<< "$raw"
  return 1
}

# --- Helper: write <rundir>/child-<n>/handle.json ---
# The record an adopting supervisor reads: the child's session id once the init
# line names it, the holder's and the child's MSYS and Windows pids and start
# ticks, this supervisor's own Windows pid and start ticks (the pair the tree
# walk uses against pid reuse, which an adopting supervisor checks to see
# whether the writer is still running), and the launch timestamp. Rewritten as
# its own once a supervisor adopts the child. The file is written whole: the
# record goes to a temporary name in the same directory and is renamed into
# place, so a reader never meets a truncated or half-written handle. This is
# the one writer of handle.json.
# Usage: write_handle <session-id>
write_handle() {
  local sess="$1"
  ensure_self_ticks
  if [ -z "${SELF_WINPID:-}" ] || [ -z "${SELF_TICKS:-}" ]; then
    HANDLE_HAS_SELF_PAIR=""
    log "HANDLE: writing child-$CHILD_INDEX's handle with no supervisor pid and ticks pair (pid ${SELF_WINPID:-none}, ticks ${SELF_TICKS:-none}); a reader treats that as a running writer until a later write records the pair"
  else
    HANDLE_HAS_SELF_PAIR=1
  fi
  node -e '
const fs = require("fs");
const [file, sessionId, holderPid, holderWinPid, holderTicks, childPid, childWinPid, childTicks, supWinPid, supTicks, launchedAt, childIndex] = process.argv.slice(1);
// A pid or start ticks is recorded as the digit string it arrived as, never
// through Number: start ticks are about 6.4e17, past the 2^53 where Number
// loses low digits, and a pair that lost a digit matches no live process. An
// empty or non-digit argument is an unread value and is recorded as null.
const digits = (v) => (typeof v === "string" && /^[0-9]+$/.test(v)) ? v : null;
// The launch timestamp and the child index are small enough for a number.
const num = (v) => { if (v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const h = {
  sessionId: sessionId || "",
  holderPid: digits(holderPid), holderWinPid: digits(holderWinPid), holderTicks: digits(holderTicks),
  childPid: digits(childPid), childWinPid: digits(childWinPid), childTicks: digits(childTicks),
  supervisorWinPid: digits(supWinPid), supervisorTicks: digits(supTicks),
  launchedAt: num(launchedAt), childIndex: num(childIndex),
};
// Whole-file replace: the temporary name is unique to this process, and the
// rename replaces the previous handle in one step.
const tmp = file + ".tmp." + process.pid;
fs.writeFileSync(tmp, JSON.stringify(h));
fs.renameSync(tmp, file);
' "$HANDLE_FILE" "$sess" "${HOLDER_LAUNCH_PID:-}" "${HOLDER_WINPID:-}" "${HOLDER_TICKS:-}" \
  "${CHILD_LAUNCH_PID:-}" "${CHILD_WINPID:-}" "${CHILD_TICKS:-}" "${SELF_WINPID:-}" "${SELF_TICKS:-}" \
  "${LAUNCHED_AT:-}" "$CHILD_INDEX" 2>>"$RUNDIR/supervisor.err"
}

# --- Helper: remove the current child's handle once it is accounted for ---
# A handle on disk always names a child nobody has yet accounted for, so it is
# removed once the child's exit has been read or its tree swept. Never fails.
clear_handle() {
  [ -n "${HANDLE_FILE:-}" ] && rm -f "$HANDLE_FILE" 2>/dev/null
  return 0
}

# --- Helper: the pre-launch gate's route on a readable handle ---
# Two readings and nothing else: whether the writing supervisor is still
# running, and the instrument's verdict for the session the handle names. A
# handle that cannot be read falls to today's wait. Prints ADOPT, WAIT or
# SWEEP_LAUNCH.
# Usage: handle_gate_route <readable:0|1> <writer_running:0|1> <verdict>
handle_gate_route() {
  local readable="$1" writer="$2" verdict="$3"
  if [ "$readable" != "1" ]; then echo "WAIT"; return 0; fi
  if [ "$writer" = "1" ]; then echo "WAIT"; return 0; fi
  case "$verdict" in
    alive|frozen) echo "ADOPT" ;;
    gone) echo "SWEEP_LAUNCH" ;;
    *) echo "WAIT" ;;
  esac
}

# --- Helper: the cleanup trap's route on a signal to a live child ---
# A signal detaches from a handled child the instrument reads alive or frozen,
# leaving it and its holder running for the next supervisor to adopt; it keeps
# today's stop on a child with no readable handle or one that reads gone.
# Prints DETACH or STOP.
# Usage: handle_trap_route <readable:0|1> <verdict>
handle_trap_route() {
  local readable="$1" verdict="$2"
  if [ "$readable" = "1" ] && { [ "$verdict" = "alive" ] || [ "$verdict" = "frozen" ]; }; then
    echo "DETACH"
  else
    echo "STOP"
  fi
}

# --- Helper: is the supervisor that wrote a handle still running ---
# The handle records that supervisor's Windows pid and start ticks, the pair
# the tree walk uses against pid reuse, so an id Windows recycled onto another
# process does not read as the writer still alive. An unverifiable read (a
# PowerShell hiccup) reads as running, so this supervisor waits and times out
# rather than launching beside a child another session may still hold. The
# pair comes from the caller's one read of the handle, so it is the same
# moment of the handle as every other field the gate routes on.
# Usage: handle_writer_running <supervisorWinPid> <supervisorTicks>
handle_writer_running() {
  local win="$1" tick="$2" out rc
  # A pair that is absent or not numeric cannot be checked, and an uncheckable
  # writer reads as running: the gate then waits and times out rather than
  # adopting a child whose owner it cannot rule out.
  case "$win" in ''|*[!0-9]*) echo 1; return 0 ;; esac
  case "$tick" in ''|*[!0-9]*) echo 1; return 0 ;; esac
  out=$(check_snapshot_survivors "$win,$tick"); rc=$?
  if [ "$rc" -ne 0 ]; then echo 1; return 0; fi
  if [ -n "$out" ]; then echo 1; else echo 0; fi
}

# --- Helper: does the handle's child pid still belong to the recorded process ---
# The MSYS pid a handle names is taken on trust by nothing: before it counts as
# live, the child's recorded Windows pid and start ticks must match a live
# process, the same pair check the tree walk makes against pid reuse. Prints
# live, gone (the pair no longer names a live process), or unverified (no pair
# recorded, or the check did not complete), and the gate adopts only on live.
# Usage: handle_child_identity <windows-pid> <ticks>
handle_child_identity() {
  local out rc
  case "$1" in ''|*[!0-9]*) echo unverified; return 0 ;; esac
  case "$2" in ''|*[!0-9]*) echo unverified; return 0 ;; esac
  out=$(check_snapshot_survivors "$1,$2"); rc=$?
  if [ "$rc" -ne 0 ]; then echo unverified; return 0; fi
  if [ -n "$out" ]; then echo live; else echo gone; fi
}

# --- Helper: the next child index this supervisor may allocate ---
# Starts one past the current index and skips any child directory that holds a
# handle.json at all: every accounted handle is cleared by clear_handle, so a
# handle on disk names a child nobody has accounted for, whose writer may be
# dead while the child still lives. A launch that follows a gate wait therefore
# never reuses, and never touches the files of, such a child. Notes go through
# log_diag, since the index is what a caller captures.
# Usage: next_child_index <rundir> <current index>
next_child_index() {
  local rundir="$1" n
  n=$(( $2 + 1 ))
  while [ -f "$rundir/child-$n/handle.json" ]; do
    log_diag "HANDLE: child-$n still holds a handle nobody has accounted for, so this launch skips that index"
    n=$((n + 1))
  done
  echo "$n"
}

# --- Helper: record the child's session id in its handle, once ---
# The poll reads the session id off the stream's init line; the first poll that
# has it sets CHILD_SESSION_ID and rewrites the handle so an adopting supervisor
# reads the session the handle names. Runs once per child.
note_child_session_id() {
  if [ -z "$CHILD_SESSION_ID" ] && [ -n "${POLL_SESSION_ID:-}" ]; then
    CHILD_SESSION_ID="$POLL_SESSION_ID"
    write_handle "$CHILD_SESSION_ID"
    log "HANDLE: child-$CHILD_INDEX's handle now names session $CHILD_SESSION_ID"
  fi
}

# --- Helper: one poll of the child, into the POLL_* globals ---
# The single place the poll process is called, so the pre-launch gate's
# adoption verdict and the poll loop read the child through the same call. Reads
# every per-child global the loop holds and sets DECIDE_ACTION, DECIDE_REASON,
# DECIDE_ERR and the POLL_* values, each stripped of a trailing CR.
run_child_poll() {
    # An adopted child with no recorded launch timestamp hands the poll an
    # explicit unknown rather than an empty value, which the poll reads as a
    # launch at epoch 0: either way the startup grace is over for it.
    POLL_RESULT=$(node "$PLUGIN_DIR/bin/supervise-poll.mjs" \
      "$CHILD_HEARTBEAT" "$STORE" "$PERSONA" "$OUT" "$PROFILE_ROOT" "${CHILD_SESSION_ID:-}" \
      "$CHILD_START_TS" "${LAUNCHED_AT:-unknown}" "$STALE_AFTER_MS" "$SUPERVISOR_MIN_RUN_MS" \
      "$SUPERVISOR_MAX_RESTARTS_PER_HOUR" "$CRASH_COUNT" "$RESTART_COUNT" "$SUPERVISOR_CRASH_LIMIT" \
      "$RUNDIR" \
      "$WORKDIR_WINDOWS" "${CHILD_TREE_POLL_WALK:-failed}" "$STREAM_SEEN_SIZE" "$STREAM_CHANGED_AT" \
      "$SUPERVISOR_SILENCE_BOUND_MS" "$SUPERVISOR_PROBE_MS" "$PROBE_WINDOW_MS" \
      "$SUPERVISOR_FINAL_ASK_MS" "$FINAL_ASK_AT" "$SUPERVISOR_START_MS" \
      "$MAILBOX_FILE" "$MAILBOX_ACK_FILE" \
      "$SUPERVISOR_ASK_GRACE_MS" "$SHUTDOWN_ASK_ID" "$SHUTDOWN_ASK_AT" "$SUPERVISOR_SHUTDOWN_TEXT" \
      2>> "$RUNDIR/supervisor.err")
    DECIDE_ERR=$?
    DECIDE_ACTION=""; DECIDE_REASON=""; POLL_RATE_LIMIT=""; POLL_SESSION_ID=""
    POLL_LIVENESS=""; POLL_STREAM_SIZE=""; POLL_STREAM_CHANGED_AT=""; POLL_FINAL_ASK_AT=""; POLL_HEARTBEAT_NOTE=""
    POLL_SHUTDOWN_ASK_ID=""; POLL_SHUTDOWN_ASK_AT=""
    {
      IFS= read -r DECIDE_ACTION
      IFS= read -r DECIDE_REASON
      IFS= read -r POLL_RATE_LIMIT
      IFS= read -r POLL_SESSION_ID
      IFS= read -r POLL_LIVENESS
      IFS= read -r POLL_STREAM_SIZE
      IFS= read -r POLL_STREAM_CHANGED_AT
      IFS= read -r POLL_FINAL_ASK_AT
      IFS= read -r POLL_HEARTBEAT_NOTE
      IFS= read -r POLL_SHUTDOWN_ASK_ID
      IFS= read -r POLL_SHUTDOWN_ASK_AT
    } <<< "$POLL_RESULT"
    DECIDE_ACTION="${DECIDE_ACTION%$'\r'}"
    DECIDE_REASON="${DECIDE_REASON%$'\r'}"
    POLL_RATE_LIMIT="${POLL_RATE_LIMIT%$'\r'}"
    POLL_SESSION_ID="${POLL_SESSION_ID%$'\r'}"
    POLL_LIVENESS="${POLL_LIVENESS%$'\r'}"
    POLL_STREAM_SIZE="${POLL_STREAM_SIZE%$'\r'}"
    POLL_STREAM_CHANGED_AT="${POLL_STREAM_CHANGED_AT%$'\r'}"
    POLL_FINAL_ASK_AT="${POLL_FINAL_ASK_AT%$'\r'}"
    POLL_HEARTBEAT_NOTE="${POLL_HEARTBEAT_NOTE%$'\r'}"
    POLL_SHUTDOWN_ASK_ID="${POLL_SHUTDOWN_ASK_ID%$'\r'}"
    POLL_SHUTDOWN_ASK_AT="${POLL_SHUTDOWN_ASK_AT%$'\r'}"
}

# --- Helper: is the handle's claim this supervisor's ---
# The claim is a plain rewrite of the handle, so two supervisors that both read
# the writer dead could both write it. After a claim, and again after the gate
# poll, the supervisor pair is read back and must be this supervisor's own; a
# pair that is not, or an own pair this supervisor could not read, is a claim
# it cannot prove and routes to the running-writer hold.
# Usage: claim_is_ours <handle-file>
claim_is_ours() {
  local key val win="" tick=""
  [ -n "${SELF_WINPID:-}" ] && [ -n "${SELF_TICKS:-}" ] || return 1
  while IFS=$'\t' read -r key val; do
    case "$key" in
      supervisorWinPid) win="$val" ;;
      supervisorTicks) tick="$val" ;;
    esac
  done < <(read_handle_fields "$1")
  [ "$win" = "$SELF_WINPID" ] && [ "$tick" = "$SELF_TICKS" ]
}

# --- Helper: hold on a handle this supervisor may not take ---
# A handle whose writer is running, or one the gate could not settle (an
# unverifiable child pair, an own pair this supervisor could not read, a claim
# it could not prove, a gate poll that failed), is routed here rather than to
# a launch. Inside the gate bound, each pass sleeps at most five seconds and
# then re-runs the gate read, so a writer that dies during the hold, or a
# transient unverified read or failed poll, can still reach ADOPT or
# SWEEP_LAUNCH before the bound; the time each re-read takes counts against
# the bound too. The run ends at GATE TIMEOUT where every pass held, so no
# second child ever launches beside one another supervisor may still hold.
# Returns with GATE_ROUTE set to the first route that is not HOLD, WAIT where
# the handle went away.
# Usage: gate_hold_on_handle <child directory name>
gate_hold_on_handle() {
  local name="$1" waited=0 step started
  while :; do
    step=$(( SUPERVISOR_GATE_WAIT_S - waited ))
    [ "$step" -gt 5 ] && step=5
    sleep "$step"
    waited=$((waited + step))
    if [ ! -f "$RUNDIR/$name/handle.json" ]; then
      log "GATE: $name's handle was accounted for by its holder while this supervisor waited, so the gate goes on"
      GATE_ROUTE="WAIT"
      return 0
    fi
    started=$SECONDS
    gate_read_handle "$name"
    waited=$(( waited + (SECONDS - started) ))
    if [ "$GATE_ROUTE" != "HOLD" ]; then
      log "GATE: $name's handle routes $GATE_ROUTE on a re-read after ${waited}s of hold"
      return 0
    fi
    if [ "$waited" -ge "$SUPERVISOR_GATE_WAIT_S" ]; then
      log "GATE TIMEOUT: $name still holds a handle this supervisor may not take after ${SUPERVISOR_GATE_WAIT_S}s, so no child is launched beside it"
      exit 2
    fi
  done
}

# --- Helper: the child's exit code, for a launched or an adopted child ---
# An adopted child's wrapper writes the marker in the instant after the child
# exits, which can be after the poll that saw the child gone, so the read
# waits briefly for the marker before reading it. A launched child's marker is
# written before `wait` returns, so no wait is needed.
child_exit_code() {
  local i=0
  if [ "${CHILD_ADOPTED:-}" = "1" ]; then
    while [ ! -f "$EXIT_MARKER" ] && [ "$i" -lt 50 ]; do
      sleep 0.1 >/dev/null 2>&1
      i=$((i + 1))
    done
  fi
  read_exit_marker "$EXIT_MARKER"
}

# --- Helper: stage the per-child globals from a handle's fields ---
# The walk and the poll read the child through the same globals the poll loop
# reads, so the gate stages them from the handle before its walk and poll and
# keeps them only on ADOPT; gate_drop_child_globals below is the other half.
# The globals the poll carries from one poll to the next start empty for the
# child, as they do for a launched one.
# Usage: gate_stage_child <name> <index> <handle> <session> <holderPid>
#          <holderWinPid> <holderTicks> <childPid> <childWinPid> <childTicks>
#          <launchedAt>
gate_stage_child() {
  local name="$1"
  CHILD_INDEX="$2"
  CHILD_DIR="$RUNDIR/$name"
  OUT="$CHILD_DIR/stdout.jsonl"
  ERR="$CHILD_DIR/stderr.log"
  DEBUG="$CHILD_DIR/claude-debug.log"
  EXIT_MARKER="$CHILD_DIR/.exit"
  HANDLE_FILE="$3"
  HOLDER_PID_FILE="$CHILD_DIR/holder.pid"
  CHILD_PID_FILE="$CHILD_DIR/child.pid"
  ASK_REQUEST_FILE="$CHILD_DIR/ask.request"
  INTERRUPT_REQUEST_FILE="$CHILD_DIR/interrupt.request"
  CHILD_SESSION_ID="$4"
  HOLDER_LAUNCH_PID="$5"
  HOLDER_WINPID="$6"
  HOLDER_TICKS="$7"
  CHILD_LAUNCH_PID="$8"
  CHILD_WINPID="$9"
  CHILD_TICKS="${10}"
  HOLDER_OWN_LAUNCH=""
  CHILD_ADOPTED=1
  CHILD_ROOT_MISMATCH_LOGGED=""
  # A handle with no launch timestamp leaves LAUNCHED_AT unknown: the
  # minimum-run crash rule is skipped for that child, the poll is handed an
  # explicit unknown and skips the startup grace, and the start the store's
  # facts are compared against is this reading's own moment, so an old request
  # in the store cannot stop the child on the spot.
  LAUNCHED_AT="${11}"
  CHILD_START_TS="${LAUNCHED_AT:-$(node -e "console.log(Date.now())")}"
  LAST_STOP_SNAPSHOT=""; STOP_TREE_MOVED=""
  CHILD_TREE_MSYS_PIDS=""; CHILD_TREE_WINPIDS=""; CHILD_TREE_SEEN_WINPIDS=""
  CHILD_TREE_SEEN_PAIRS=""; CHILD_TREE_SNAPSHOT=""; CHILD_TREE_WALKED=""
  CHILD_TREE_READ_FAILED=""; CHILD_TREE_DESCENDANT_SEEN=""; CHILD_TREE_CONFIRMED_AT=""
  CHILD_TREE_FAILED_CONFIRMS=0
  STREAM_SEEN_SIZE=""; STREAM_CHANGED_AT=""; FINAL_ASK_AT=""
  SHUTDOWN_ASK_ID=""; SHUTDOWN_ASK_AT=""
}

# --- Helper: drop the per-child globals a gate pass staged ---
# Every route but ADOPT leaves no pid from the handle in any global that
# cleanup, stop_child or the launch reads, and the child index goes back to
# the last index this supervisor allocated.
# Usage: gate_drop_child_globals <saved child index>
gate_drop_child_globals() {
  CHILD_INDEX="$1"
  CHILD_LAUNCH_PID=""; CHILD_WINPID=""; CHILD_TICKS=""
  HOLDER_LAUNCH_PID=""; HOLDER_WINPID=""; HOLDER_TICKS=""; HOLDER_OWN_LAUNCH=""
  CHILD_ADOPTED=""; CHILD_SESSION_ID=""
  HANDLE_FILE=""; EXIT_MARKER=""; CHILD_DIR=""; OUT=""; ERR=""; DEBUG=""
  HOLDER_PID_FILE=""; CHILD_PID_FILE=""; ASK_REQUEST_FILE=""; INTERRUPT_REQUEST_FILE=""
  LAUNCHED_AT=""; CHILD_START_TS=""
  LAST_STOP_SNAPSHOT=""; POLL_LIVENESS=""
  CHILD_TREE_MSYS_PIDS=""; CHILD_TREE_WINPIDS=""; CHILD_TREE_SEEN_WINPIDS=""
  CHILD_TREE_SEEN_PAIRS=""; CHILD_TREE_SNAPSHOT=""; CHILD_TREE_WALKED=""
  CHILD_TREE_READ_FAILED=""; CHILD_TREE_DESCENDANT_SEEN=""; CHILD_TREE_CONFIRMED_AT=""
  CHILD_TREE_FAILED_CONFIRMS=0
  CHILD_TREE_POLL_WALK="failed"
}

# --- Helper: one gate pass over a handle, routing the gate ---
# Takes the child directory's name, which newest_handle prints, and builds the
# handle's path in bash: the child index is the number in that name, refused
# unless it is all digits, and every pid and timestamp read from the handle is
# refused the same way. Every field is read in one call. Sets GATE_ROUTE
# (ADOPT, SWEEP_LAUNCH, HOLD or WAIT) and VERDICT, and on SWEEP_LAUNCH the
# "pid,ticks" lines the sweep kills in GATE_SWEEP_PAIRS and the handle it
# clears in GATE_SWEEP_HANDLE. Every route writes, sets and hands on exactly
# what its row below says.
#
# Route                  | Handle write   | Globals               | Caller does
# -----------------------+----------------+-----------------------+---------------------------
# no handle              | none           | none                  | today's gate (WAIT)
#   (newest_handle names nothing; this function is not called)
# name not child-<n>     | none           | none                  | today's gate (WAIT)
# unreadable             | none           | none                  | today's gate (WAIT); the
#   (read prints nothing)|                |                       | index allocation skips it
# writer running         | none           | none                  | HOLD: the hold re-reads
#   (pair absent, non-numeric, unverifiable, or a live process; an own pair
#   from an earlier pass of this supervisor is not a running writer)
# dead writer, no child  | handle removed | none                  | today's gate (WAIT)
#   identity (no MSYS    |                |                       |
#   pid and no Windows   |                |                       |
#   pair)                |                |                       |
# unverified             | none           | none                  | HOLD
# gone (identity)        | none           | GATE_SWEEP_PAIRS,     | SWEEP_LAUNCH: kill the pairs,
#                        |                | GATE_SWEEP_HANDLE,    | clear the handle, today's gate;
#                        |                | CHILD_INDEX raised to | the launch allocates past the
#                        |                | the swept index       | swept directory
# live identity, no MSYS | none           | none                  | HOLD: nothing to poll or adopt
#   pid                  |                |                       | under, and the child is live
# own pair unknown       | none           | none                  | HOLD
# claim read-back        | the claim      | none (dropped)        | HOLD
#   foreign, at once     |                |                       |
# poll failed            | the claim      | none (dropped)        | HOLD
# claim read-back        | the claim      | none (dropped)        | HOLD
#   foreign, after poll  |                |                       |
# alive or frozen        | the claim      | every per-child       | ADOPT: enter the poll loop
#                        |                | global, committed     | with no launch
# gone (verdict)         | the claim      | GATE_SWEEP_PAIRS with | SWEEP_LAUNCH, as above
#                        |                | the walked tree,      |
#                        |                | GATE_SWEEP_HANDLE,    |
#                        |                | CHILD_INDEX raised to |
#                        |                | the swept index; the  |
#                        |                | rest dropped          |
# verdict not recognized | the claim      | none (dropped)        | HOLD
#
# The child's recorded Windows pid and start ticks must match a live process
# before anything else: a pair that cannot be checked holds the gate, and a
# mismatch reads as gone with the sweep that follows killing only
# ticks-matched pids. A handle with no MSYS child pid is routed on that same
# identity, since the pair is what names a process: live holds, gone sweeps
# the recorded pairs, and only a handle with no identity at all is cleared.
# Only a live identity with an MSYS pid to poll under, and an own pair this
# supervisor has read, earn the claim, which is then read back and must be
# this supervisor's own, before the walk and the instrument's verdict; the
# claim is read back once more after the poll. The walk and the poll read the
# child through the poll loop's own globals, so those are staged for the two
# calls and dropped on every route but ADOPT. A reading from an earlier child
# or an earlier pass never routes the trap or a stop for this one, so the last
# liveness reading and the last stop snapshot are cleared at the top of every
# pass. A sweep leaves CHILD_INDEX at the swept index, so the launch that
# follows allocates the next directory rather than truncating a stdout.jsonl a
# survivor the sweep never named may still hold.
# Usage: gate_read_handle <child directory name>
gate_read_handle() {
  local name="$1" idx h key val ident route saved_index f_lines=0
  local f_session="" f_holderPid="" f_holderWinPid="" f_holderTicks="" f_childPid="" f_childWinPid="" f_childTicks="" f_launchedAt="" f_supWinPid="" f_supTicks=""
  GATE_ROUTE="WAIT"
  VERDICT=""
  GATE_SWEEP_PAIRS=""
  GATE_SWEEP_HANDLE=""
  POLL_LIVENESS=""
  LAST_STOP_SNAPSHOT=""
  case "$name" in
    child-*) idx="${name#child-}" ;;
    *) idx="" ;;
  esac
  case "$idx" in
    ''|*[!0-9]*)
      log "HANDLE: '$name' is not a child-<n> directory name, so it is not read"
      return 0
      ;;
  esac
  h="$RUNDIR/$name/handle.json"
  while IFS=$'\t' read -r key val; do
    f_lines=$((f_lines + 1))
    case "$key" in
      sessionId) f_session="$val"; continue ;;
    esac
    case "$val" in ''|*[!0-9]*) val="" ;; esac
    case "$key" in
      holderPid) f_holderPid="$val" ;;
      holderWinPid) f_holderWinPid="$val" ;;
      holderTicks) f_holderTicks="$val" ;;
      childPid) f_childPid="$val" ;;
      childWinPid) f_childWinPid="$val" ;;
      childTicks) f_childTicks="$val" ;;
      launchedAt) f_launchedAt="$val" ;;
      supervisorWinPid) f_supWinPid="$val" ;;
      supervisorTicks) f_supTicks="$val" ;;
    esac
  done < <(read_handle_fields "$h")
  if [ "$f_lines" -eq 0 ]; then
    log "HANDLE: $name's handle cannot be read, so it names no child this supervisor owns; the gate falls to today's wait"
    return 0
  fi
  # A handle carrying this supervisor's own pair is its claim from an earlier
  # pass of this same gate, never another writer, so the writer check is
  # skipped for it; every other pair is checked against a live process.
  if [ -n "${SELF_TICKS_DONE:-}" ] && [ "$f_supWinPid" = "$SELF_WINPID" ] && [ "$f_supTicks" = "$SELF_TICKS" ]; then
    log_diag "HANDLE: $name's handle carries this supervisor's own claim from an earlier pass"
  elif [ "$(handle_writer_running "$f_supWinPid" "$f_supTicks")" = "1" ]; then
    log "HANDLE: $name names a supervisor that is still running (or one that cannot be ruled out), so the gate holds"
    GATE_ROUTE="HOLD"
    return 0
  fi
  if [ -z "$f_childPid" ] && { [ -z "$f_childWinPid" ] || [ -z "$f_childTicks" ]; }; then
    log "HANDLE: $name's handle names a dead writer and no child identity (no MSYS pid and no Windows pid and ticks pair), so it names nothing to adopt or sweep; the handle in $RUNDIR/$name is cleared and the gate falls to today's wait"
    rm -f "$h" 2>/dev/null
    return 0
  fi
  ident=$(handle_child_identity "$f_childWinPid" "$f_childTicks")
  case "$ident" in
    unverified)
      log "HANDLE: $name's recorded Windows pid ${f_childWinPid:-none} and start ticks ${f_childTicks:-none} could not be checked against a live process, so the gate holds rather than launching beside it"
      GATE_ROUTE="HOLD"
      return 0
      ;;
    gone)
      log "HANDLE: $name's recorded Windows pid $f_childWinPid no longer holds the process it named, so the child reads gone; its tree is not walked from that pid, so a native process that outlived the wrapper under it is unswept beyond the recorded pair $f_childWinPid,$f_childTicks"
      VERDICT="gone"
      GATE_SWEEP_PAIRS=$(gate_sweep_pairs "$f_holderWinPid" "$f_holderTicks" "$f_childWinPid" "$f_childTicks" "")
      GATE_SWEEP_HANDLE="$h"
      gate_keep_swept_index "$idx"
      GATE_ROUTE=$(handle_gate_route 1 0 "$VERDICT")
      return 0
      ;;
  esac
  if [ -z "$f_childPid" ]; then
    log "HANDLE: $name's recorded Windows pid $f_childWinPid still holds the process it named, but the handle records no MSYS pid to poll it under, so it can be neither adopted nor swept; the gate holds"
    GATE_ROUTE="HOLD"
    return 0
  fi
  # No claim without a known own pair: a claim written with a null supervisor
  # pair reads as a running writer forever.
  ensure_self_ticks
  if [ -z "${SELF_WINPID:-}" ] || [ -z "${SELF_TICKS:-}" ]; then
    log "HANDLE: this supervisor's own Windows pid and start ticks could not be read (pid ${SELF_WINPID:-none}, ticks ${SELF_TICKS:-none}), so no claim is written on $name's handle and the gate holds"
    GATE_ROUTE="HOLD"
    return 0
  fi
  saved_index="$CHILD_INDEX"
  gate_stage_child "$name" "$idx" "$h" "$f_session" "$f_holderPid" "$f_holderWinPid" "$f_holderTicks" \
    "$f_childPid" "$f_childWinPid" "$f_childTicks" "$f_launchedAt"
  # The claim, once the child is known live, read back at once.
  write_handle "$CHILD_SESSION_ID"
  if ! claim_is_ours "$h"; then
    log "HANDLE: $name's handle does not carry this supervisor's own pid and ticks after the claim, so another supervisor claimed it; the gate holds"
    gate_drop_child_globals "$saved_index"
    GATE_ROUTE="HOLD"
    return 0
  fi
  refresh_child_tree
  run_child_poll
  if [ -z "$DECIDE_ACTION" ] || [ "$DECIDE_ERR" -ne 0 ]; then
    log "HANDLE: the gate's poll of $name failed (rc $DECIDE_ERR), so the gate holds rather than adopting on no reading"
    gate_drop_child_globals "$saved_index"
    GATE_ROUTE="HOLD"
    return 0
  fi
  if ! claim_is_ours "$h"; then
    log "HANDLE: $name's handle was rewritten by another supervisor during the gate's poll, so the gate holds"
    gate_drop_child_globals "$saved_index"
    GATE_ROUTE="HOLD"
    return 0
  fi
  VERDICT="${POLL_LIVENESS%% *}"
  [ -n "$VERDICT" ] || VERDICT="alive"
  route=$(handle_gate_route 1 0 "$VERDICT")
  case "$route" in
    ADOPT)
      if [ -z "$LAUNCHED_AT" ]; then
        log "HANDLE: $name's handle records no launch timestamp, so the startup grace is skipped for it and the minimum-run crash rule does not apply to it"
      fi
      GATE_ROUTE="ADOPT"
      ;;
    SWEEP_LAUNCH)
      GATE_SWEEP_PAIRS=$(gate_sweep_pairs "$f_holderWinPid" "$f_holderTicks" "$f_childWinPid" "$f_childTicks" "${CHILD_TREE_SNAPSHOT:-}")
      GATE_SWEEP_HANDLE="$h"
      gate_drop_child_globals "$saved_index"
      gate_keep_swept_index "$idx"
      GATE_ROUTE="SWEEP_LAUNCH"
      ;;
    *)
      log "HANDLE: the gate's poll of $name read a verdict it does not route on ($VERDICT), so the gate holds"
      gate_drop_child_globals "$saved_index"
      GATE_ROUTE="HOLD"
      ;;
  esac
}

# --- Helper: keep a swept child's index out of the next allocation ---
# A sweep clears the swept child's handle, and next_child_index would then
# hand that directory out again, truncating a stdout.jsonl that a survivor the
# sweep's pairs never named may still hold. So the index this supervisor
# allocates from is raised to the swept index where that is higher, and the
# launch that follows takes the next directory.
# Usage: gate_keep_swept_index <swept index>
gate_keep_swept_index() {
  if [ "$1" -gt "${CHILD_INDEX:-0}" ]; then
    CHILD_INDEX="$1"
  fi
}

# --- Helper: the "pid,ticks" lines a gate sweep kills ---
# The holder's and the child's recorded pairs where both halves were read,
# plus the walked tree where the gate's walk took one, one pair per line in
# the form kill_process_snapshot takes. A pair with a half missing is left
# out, since it could only be killed by bare pid.
# Usage: gate_sweep_pairs <holderWinPid> <holderTicks> <childWinPid> <childTicks> <tree snapshot>
gate_sweep_pairs() {
  local out=""
  if [ -n "$1" ] && [ -n "$2" ]; then out="$1,$2"; fi
  if [ -n "$3" ] && [ -n "$4" ]; then out="${out:+$out
}$3,$4"; fi
  if [ -n "$5" ]; then out="${out:+$out
}$5"; fi
  printf '%s' "$out"
}

# --- Channel log retention ---
# Removes the channel log files in a work directory whose last write is older
# than a number of whole days: the frozen .agentic-channel.jsonl and each
# numbered .agentic-channel.<digits>.jsonl segment whose digit run is four to
# eighteen digits long. The plugin writes four or more digits, and the sweep
# caps the run at eighteen so its value fits bash's integer arithmetic. Only
# the directory's own files at depth one with one of those two names are
# candidates, so no other file is ever touched, and a numbered name of another
# width is neither removed nor counted as a segment. The highest-numbered
# segment is the one the plugin writes now, so every numbered name at the
# highest value is exempt whatever its age, and the frozen log never is; where
# no numbered segment exists, nothing is exempt. Digit runs are compared as
# decimals, so a fifth digit sorts after four, a zero-padded run is never read
# as octal, and 0005 and 00005 share one value.
# One log line names the count where at least one file was removed, and
# nothing is logged where none was. A removal that fails is logged and the
# sweep carries on: it always returns 0, since the launch it precedes is the
# work.
# Usage: sweep_channel_log_segments <workdir> <days>
sweep_channel_log_segments() {
  local dir="$1" days="$2" path name digits highest_num=-1 removed=0
  while IFS= read -r path; do
    name="${path##*/}"
    digits="${name#.agentic-channel.}"
    digits="${digits%.jsonl}"
    if [ $((10#$digits)) -gt "$highest_num" ]; then
      highest_num=$((10#$digits))
    fi
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type f -regextype posix-extended -regex '.*/\.agentic-channel\.[0-9]{4,18}\.jsonl' 2>/dev/null)
  while IFS= read -r path; do
    name="${path##*/}"
    if [ "$name" != ".agentic-channel.jsonl" ]; then
      digits="${name#.agentic-channel.}"
      digits="${digits%.jsonl}"
      [ $((10#$digits)) -eq "$highest_num" ] && continue
    fi
    if rm -f -- "$path"; then
      removed=$((removed + 1))
    else
      log "CHANNEL-LOG SWEEP: could not remove $path"
    fi
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type f -regextype posix-extended -regex '.*/\.agentic-channel(\.[0-9]{4,18})?\.jsonl' -mmin +$((days * 1440)) 2>/dev/null)
  if [ "$removed" -ge 1 ]; then
    log "CHANNEL-LOG SWEEP: removed $removed file(s) older than $days day(s)"
  fi
  return 0
}

# --- Main loop ---
CHILD_INDEX=0
LAST_CHANNEL_SWEEP_S=0  # epoch seconds of the last channel log sweep, 0 before the first
RESTART_COUNT=0
CRASH_COUNT=0
RESTART_TIMES=()  # array of timestamps for rolling-hour budget

# This supervisor's start time, which prefixes every probe id it writes, so
# ids stay unique across supervisors sharing a run directory.
SUPERVISOR_START_MS=$(node -e "console.log(Date.now())")
# How many final asks this supervisor has written, which numbers each ask's id.
FINAL_ASK_SEQ=0
# How many interrupts this supervisor has relayed, which numbers each
# interrupt's id the same way.
INTERRUPT_SEQ=0
# The request_at of the interrupt this child's polls have already relayed or
# already skipped, this supervisor's own in-memory record so a served-marker
# write that keeps failing retries only that write rather than relaying or
# skipping the same request again. Set in relay_interrupt_request as soon as
# that decision is taken, and cleared per child beside INTERRUPT_FAIL_LOGGED_AT.
INTERRUPT_HANDLED_AT=""

# Where the harness keeps its transcripts, and the launch directory that names
# the child's project under it. The poll derives the transcript from these and
# the child's session id. The profile is USERPROFILE, falling back to HOME, and
# both are handed over in Windows form, which is the form the harness's
# project key is taken from. An unknown profile leaves the transcript
# unreadable, which the liveness verdict reads as alive.
PROFILE_ROOT="${USERPROFILE:-${HOME:-}}"
if [ -n "$PROFILE_ROOT" ]; then
  PROFILE_ROOT="$(cygpath -w "$PROFILE_ROOT" 2>/dev/null || echo "$PROFILE_ROOT")"
fi
WORKDIR_WINDOWS="$(cygpath -w "$WORKDIR" 2>/dev/null || echo "$WORKDIR")"

# The persona store the poll reads, one path for the whole run.
STORE="$WORKDIR/.agentic-personas.json"

# Whether the FIRST child got no --prompt at all (passive start, plan item 1).
# Captured before the loop, since PROMPT is cleared after the run's first
# launch or adoption and every restart afterward launches with an empty
# PROMPT anyway.
if [ -z "$PROMPT" ]; then
  log "PASSIVE: no prompt given at start; child will idle with its persona claimed and heartbeating, waiting for a goal delivered by chat"
fi

# How many poll iterations between "still alive" log lines while idle. At the
# default 10s poll this is once a minute, so a ten-minute passive run leaves
# roughly ten WAITING lines proving liveness without flooding the log.
ALIVE_LOG_EVERY_N_POLLS=6

while true; do
  # --- A shutdown recorded while the last child was being stopped ---
  # No poll runs inside a stop, so a shutdown_requested the child records
  # during one, with a restart_passive stop's patient wait as the long case,
  # is first readable here. It is read against the stopped child's start
  # before any handle is read or any child launched, because the next launch
  # takes a start newer than it and no poll would fire on it again. The first
  # pass of the loop has no stopped child and skips this. The exit is the
  # stop_complete exit, 0, which the keeper reads as the shutdown honored,
  # with the request file removed where one is present. On the natural-exit
  # route this repeats that path's own read of the same fact, one extra store
  # read per such relaunch, and honors a shutdown recorded between the two.
  # An adopted child whose handle carried no launchedAt has the gate's reading
  # moment as CHILD_START_TS, so a shutdown recorded before the adoption
  # reads older here, as it does at the natural-exit read.
  if [ -n "${CHILD_START_TS:-}" ]; then
    SHUTDOWN_REQUESTED_TS=$(get_fact "$WORKDIR" "$PERSONA" "shutdown_requested")
    if [ -n "$SHUTDOWN_REQUESTED_TS" ] && [ "$SHUTDOWN_REQUESTED_TS" -gt "$CHILD_START_TS" ]; then
      if [ -n "${SHUTDOWN_ASK_ID:-}" ]; then
        log "STOP_COMPLETE: shutdown_requested at $SHUTDOWN_REQUESTED_TS > child start $CHILD_START_TS, recorded while child-$CHILD_INDEX was being stopped, so the run ends before any launch (the shutdown ask id=$SHUTDOWN_ASK_ID is honored)"
      else
        log "STOP_COMPLETE: shutdown_requested at $SHUTDOWN_REQUESTED_TS > child start $CHILD_START_TS, recorded while child-$CHILD_INDEX was being stopped, so the run ends before any launch"
      fi
      clear_shutdown_request
      exit 0
    fi
  fi

  # --- Pre-launch adoption on the newest handle ---
  # The gate reads the newest handle before its held check and before the
  # request-at-launch check below, so a request beside a detached live child
  # adopts that child and asks it, and only with no handle does the request end
  # the run before any launch. A readable handle routes on two readings and
  # nothing else: whether the supervisor that wrote it is still running, and the
  # instrument's verdict for the session it names. A running writer is a child
  # this supervisor may not take, so the gate falls to today's wait and a double
  # launch still ends in GATE TIMEOUT.
  ADOPTED=0
  GATE_ROUTE="WAIT"
  VERDICT=""
  CHILD_ADOPTED=""
  # This supervisor's own pair is read before any handle is, so a claim it
  # writes can carry and be checked against it without a PowerShell read inside
  # the claim window. The notes file is per process, since supervisors share the
  # run directory.
  ensure_self_ticks
  HANDLE_NOTES="$RUNDIR/.handle-notes.$$"
  HANDLE_NAME=$(newest_handle "$RUNDIR" 2>"$HANDLE_NOTES")
  while IFS= read -r handle_note; do
    case "$handle_note" in
      OLDER\ *) log "HANDLE: passing over an older handle in ${handle_note#OLDER }, which still names a child nobody has accounted for" ;;
    esac
  done < "$HANDLE_NOTES"
  rm -f "$HANDLE_NOTES"
  HANDLE_FOUND=""
  case "$HANDLE_NAME" in
    child-[0-9]*) HANDLE_FOUND="$RUNDIR/$HANDLE_NAME/handle.json" ;;
  esac
  if [ -n "$HANDLE_FOUND" ]; then
    # The mailbox is not truncated here: adoption is not a launch, and an
    # open shutdown ask in it is this child's. A pass that holds re-reads the
    # handle inside the gate bound, and ends the run at GATE TIMEOUT where
    # every pass held; the route it returns with is handled below.
    gate_read_handle "$HANDLE_NAME"
    if [ "$GATE_ROUTE" = "HOLD" ]; then
      gate_hold_on_handle "$HANDLE_NAME"
    fi
  fi

  case "$GATE_ROUTE" in
    ADOPT)
      log "ADOPT child-$CHILD_INDEX: adopting a live handled child of this persona (verdict $VERDICT), entering the poll loop with no launch"
      # An adopted child took its goal from the supervisor that launched it,
      # and nothing here writes to a running session's input but the final
      # ask, so a --prompt given to this run has no launch to ride and is
      # named as dropped rather than cleared in silence below.
      if [ -n "$PROMPT" ]; then
        log "PROMPT_DROPPED child-$CHILD_INDEX: --prompt was given, but this run adopted a live child rather than launching one, so the prompt is not sent to this child or to any later launch in this run"
      fi
      # The gate's own poll is this child's first reading: its stream state,
      # final-ask time and session id carry into the loop rather than resetting.
      LIVENESS_LOGGED=""
      HEARTBEAT_ABSENT_LOGGED=""
      note_liveness_poll
      note_child_session_id
      # A child adopted frozen was read frozen by the gate's poll, which is the
      # poll that decided final_ask and handed back the ask's time. The loop's
      # polls then wait inside that window and never decide final_ask again,
      # so the ask is written here, through the same writer the loop uses, and
      # the adopted child is asked before its window can close on it.
      if [ "$DECIDE_ACTION" = "final_ask" ]; then
        write_final_ask
      fi
      ADOPTED=1
      ;;
    SWEEP_LAUNCH)
      # The gate handed over the "pid,ticks" lines to kill and the handle to
      # clear, and nothing else of that child: the kill is ticks-matched, so a
      # pid recycled onto another process is never signalled, and the held
      # check below still meets whatever the pairs never named.
      log "SWEEP_RELAUNCH: $HANDLE_NAME read gone at the gate; killing the ticks-matched pids its handle records, the holder included, before a fresh launch (pairs: $(printf '%s' "$GATE_SWEEP_PAIRS" | tr '\n' ' '))"
      kill_process_snapshot "$GATE_SWEEP_PAIRS" || true
      rm -f "$GATE_SWEEP_HANDLE" 2>/dev/null
      ;;
    *) : ;;
  esac

  if [ "$ADOPTED" != 1 ]; then
    # A shutdown request found with no child adopted has no child to ask: the
    # run ends at exit 0 with the request removed, before the next child's
    # directory is made, before the gate's wait and before any launch, so a
    # persona still held by another session cannot turn the request into a gate
    # timeout the keeper retries. That covers a run with no handle, one whose
    # handle fell to today's wait, and one whose child the gate just swept. A
    # request beside an adopted child is asked by the poll loop instead, and
    # the ADOPT route never reaches this block.
    if [ -f "$SHUTDOWN_REQUEST_FILE" ]; then
      log "SHUTDOWN_REQUEST: $SHUTDOWN_REQUEST_FILE is present at launch and no child was launched to ask, so the run ends without launching one; a child an earlier stop left running, if any, is not asked"
      clear_shutdown_request
      exit 0
    fi

    # The installed plugin's store file is named after its installed id, so
    # the move to personas@applefeld reads a new file. The copy forward runs
    # here, before the gate reads the store, so the first launch under the
    # new id gates on and the child reads every record the earlier file held.
    # It runs only once installed_plugins.json lists the new id and no
    # longer the old one: the engine loads the earlier-registered plugin
    # named personas, so until the old id is uninstalled the child still
    # runs the old plugin and writes the old store, and a copy taken then
    # would be kept as stale by the marker. Before that the launch goes on
    # unchanged, with one line saying why, and the gate falls back to the
    # old store. A --dev child reads the inline store, which never moves, so
    # dev mode skips both. bin/migrate-store.sh, run at the cutover with the
    # fleet stopped, is the expected path, and this call is the backstop.
    # Every outcome the migration defines returns 0 and is logged; a copy or
    # a read that failed stops the launch, since a child started on a fresh
    # store would strand what the earlier file holds.
    if [ "$DEV_MODE" -eq 0 ]; then
      if installed_id_cutover_done 2>&1 | tee -a "$LOG"; then
        if ! migrate_global_store 2>&1 | tee -a "$LOG"; then
          echo "ERROR: the store migration did not complete; see the store-migration lines in $LOG" | tee -a "$LOG" >&2
          exit 1
        fi
      fi
    fi

    # The launch refuses, and does not warn, where installed_plugins.json
    # lists no relay for this marketplace: a persona with no thread works
    # invisibly, and one that fails to launch is noticed. It runs in dev mode
    # too, since the relay loads as an installed plugin there, and is skipped
    # under --no-channel, where no channel is requested. The script runs under
    # pipefail (set above), so the if reads relay_installed_check's status
    # through the tee and not tee's. An absent or unreadable
    # installed_plugins.json skips the check.
    if [ "$NO_CHANNEL" -ne 1 ]; then
      if ! relay_installed_check "$AGENTIC_MARKETPLACE" 2>&1 | tee -a "$LOG"; then
        echo "ERROR: the relay channel is not installed for this marketplace; fix: claude plugin install relay@$AGENTIC_MARKETPLACE, and see the relay-check line in $LOG for any other relay to uninstall" | tee -a "$LOG" >&2
        exit 1
      fi
    fi

    # --- D3: Pre-launch gate (AD2: check both commons AND heartbeat) ---
    GLOBAL_STORE=$(find_global_store "$DEV_MODE")
    if [ -z "$GLOBAL_STORE" ]; then
      log "GATE FAIL: no global commons store found"
      exit 2
    fi
    if ! wait_persona_free_both "$WORKDIR" "$PERSONA" "$SUPERVISOR_GATE_WAIT_S" "$STALE_AFTER_MS" "$GLOBAL_STORE" 2>&1 | tee -a "$LOG"; then
      log "GATE TIMEOUT: persona not free after ${SUPERVISOR_GATE_WAIT_S}s"
      exit 2
    fi
    log "GATE PASSED: no live persona claims (commons and heartbeat both free)"

    # Every launch and relaunch sweeps the work directory's old channel log
    # files first, and the poll loop's daily sweep counts from here.
    sweep_channel_log_segments "$WORKDIR" "$CHANNEL_LOG_RETENTION_DAYS"
    printf -v LAST_CHANNEL_SWEEP_S '%(%s)T' -1

    # The child index is allocated only now, past the gate, and never on an
    # index whose handle names a running supervisor, so the files removed
    # below are always this supervisor's own allocation and a gate that times
    # out on another supervisor's live child touches nothing of that child.
    CHILD_INDEX=$(next_child_index "$RUNDIR" "$CHILD_INDEX")
    CHILD_DIR="$RUNDIR/child-$CHILD_INDEX"
    mkdir -p "$CHILD_DIR"

    OUT="$CHILD_DIR/stdout.jsonl"
    ERR="$CHILD_DIR/stderr.log"
    DEBUG="$CHILD_DIR/claude-debug.log"
    EXIT_MARKER="$CHILD_DIR/.exit"
    HANDLE_FILE="$CHILD_DIR/handle.json"
    HOLDER_PID_FILE="$CHILD_DIR/holder.pid"
    CHILD_PID_FILE="$CHILD_DIR/child.pid"
    ASK_REQUEST_FILE="$CHILD_DIR/ask.request"
    INTERRUPT_REQUEST_FILE="$CHILD_DIR/interrupt.request"
    rm -f "$EXIT_MARKER" "$HANDLE_FILE" "$HOLDER_PID_FILE" "$CHILD_PID_FILE" "$ASK_REQUEST_FILE" "$ASK_REQUEST_FILE.tmp" "$INTERRUPT_REQUEST_FILE" "$INTERRUPT_REQUEST_FILE.tmp" "$INTERRUPT_REQUEST_FILE.taken"

    # --- Take the child start timestamp BEFORE the launch call (Z6) ---
    CHILD_START_TS=$(node -e "console.log(Date.now())")
    LAUNCHED_AT=$CHILD_START_TS

    # --- Launch the child (the holder holds its stdin pipe) ---
    log "LAUNCH child-$CHILD_INDEX (start_ts=$CHILD_START_TS, prompt=${PROMPT:+set})"

    # AD5: Truncate supervisor.err once at launch; append everywhere after.
    : > "$RUNDIR/supervisor.err"
    # The mailbox pair starts empty for each child, so a probe an earlier child
    # never acknowledged cannot read as this child's silence.
    : > "$MAILBOX_FILE"
    : > "$MAILBOX_ACK_FILE"

    # The operator's --prompt goes to the run's first launch, whatever index
    # the gate's sweep or a handle nobody accounted for left it at. PROMPT is
    # cleared once a child has been launched or adopted, so a value here is
    # the prompt not yet sent. The file is named for the child it is for, and
    # the holder is handed its path below.
    PROMPT_FILE=""
    if [ -n "$PROMPT" ]; then
      PROMPT_FILE="$RUNDIR/child-$CHILD_INDEX.prompt"
      printf '%s' "$PROMPT" > "$PROMPT_FILE"
    fi

    # The child's standard input is a pipe from bin/supervise-holder.sh, which
    # writes the priming turn and the goal and holds the pipe open until it is
    # killed or the child dies. Section 1 measured the form: `holder | child &`
    # with no `disown`, so the child and the holder survive this supervisor's
    # exit, `$!` names the child (the pipeline's last stage) which `wait` reaps,
    # and killing the holder gives the child end of input. The launch shape
    # writes the child's own exit code into the .exit marker, so a supervisor
    # that adopted this child can read how it ended without `wait`.

    # Plan item 6: --plugin-dir is opt-in (--dev), loading this checkout's own
    # code. Without it the child loads personas as an installed plugin
    # (claude plugin install personas@applefeld), the target runtime.
    PLUGIN_DIR_ARGS=()
    if [ "$DEV_MODE" -eq 1 ]; then
      PLUGIN_DIR_ARGS=(--plugin-dir "$(cygpath -w "$PLUGIN_DIR")")
    fi

    # Plan item 5: attach the Discord channel directly to this child (no proxy
    # session, no polling) unless --no-channel was given. --channels loads the
    # relay's installed-plugin entry under the public marketplace.
    # CHANNEL_SESSION is the stable thread key; CHANNEL_PROCESS_TOKEN is minted
    # fresh for this one child. CHANNEL_LINEAGE carries the same stable
    # $CHANNEL_NAME across every child this supervisor launches, restarts
    # included, so the registry rebinds to the one thread.
    CHANNEL_ARGS=()
    CHANNEL_ENV=(CHANNEL_LINEAGE="$CHANNEL_NAME")
    if [ "$NO_CHANNEL" -ne 1 ]; then
      CHANNEL_ARGS=(--name "$CHANNEL_NAME" --channels "plugin:relay@$AGENTIC_MARKETPLACE")
      CHILD_PROCESS_TOKEN=$(node -e "console.log(require('crypto').randomUUID())")
      CHANNEL_ENV+=(CHANNEL_SESSION="$CHANNEL_NAME" CHANNEL_PROCESS_TOKEN="$CHILD_PROCESS_TOKEN" CHANNEL_SESSION_MIRROR=off)
    fi

    HOLDER_LAUNCH_PID=""; HOLDER_WINPID=""; HOLDER_TICKS=""; HOLDER_OWN_LAUNCH=""; HOLDER_GONE_LOGGED=""
    CHILD_WINPID=""; CHILD_TICKS=""; CHILD_ADOPTED=""; CHILD_ROOT_MISMATCH_LOGGED=""
    # The three retried reads start their gaps afresh for each child, each
    # seeded on its own poll. A retry falls due on its seed, then on its seed
    # plus 1, 3, 7, 15, 31, 63 and 127, then every 64 polls; seeds five apart
    # never share a poll, so two PowerShell misses never spawn on one poll.
    CHILD_TICKS_RETRY_NEXT=1; CHILD_TICKS_RETRY_GAP=1; SELF_TICKS_RETRY_NEXT=6; SELF_TICKS_RETRY_GAP=1; HOLDER_TICKS_RETRY_NEXT=11; HOLDER_TICKS_RETRY_GAP=1
    # The child stage is child_wrapper, so a TERM to `$!` reaches `claude` and
    # the marker records the child's real exit code.
    PERSONA="$PERSONA" NO_CHANNEL="$NO_CHANNEL" \
    COORDINATOR_PERSONA="${COORDINATOR_PERSONA:-}" ARCHITECT_PERSONA="${ARCHITECT_PERSONA:-}" \
    LIAISON_PERSONA="${LIAISON_PERSONA:-}" \
    CHILD_INDEX="$CHILD_INDEX" SUPERVISOR_HOLDER_POLL_S="${SUPERVISOR_HOLDER_POLL_S:-2}" \
      bash "$PLUGIN_DIR/bin/supervise-holder.sh" \
        "$HOLDER_PID_FILE" "$OUT" "$CHILD_PID_FILE" "$ASK_REQUEST_FILE" "${PROMPT_FILE:-}" "$INTERRUPT_REQUEST_FILE" \
        2>> "$RUNDIR/supervisor.err" \
      | { child_wrapper "$EXIT_MARKER" env "${CHANNEL_ENV[@]}" claude -p --input-format stream-json --output-format stream-json --verbose \
          "${PLUGIN_DIR_ARGS[@]}" \
          "${CHANNEL_ARGS[@]}" \
          --settings "$(cygpath -w "$SETTINGS_FILE")" \
          --model "${MODEL:-$SUPERVISOR_MODEL}" \
          --effort "${EFFORT:-$SUPERVISOR_EFFORT}" \
          --permission-mode "$PERMISSION_MODE" \
          --debug-file "$DEBUG" \
          > "$OUT" 2> "$ERR"; } &
    CHILD_LAUNCH_PID=$!
    # The child's own MSYS pid, for the holder to watch and exit when it dies.
    echo "$CHILD_LAUNCH_PID" > "$CHILD_PID_FILE"

    # A new child's launch is also the point a stale snapshot from the
    # *previous* child must stop being read. This runs before anything else in
    # the launch block that can end the iteration.
    LAST_STOP_SNAPSHOT=""
    STOP_TREE_MOVED=""
    # The previous child's last liveness reading goes with it. The cleanup trap
    # routes a signal on this reading and reads an empty one as alive, so a
    # signal between this launch and the new child's first poll detaches from
    # the new child rather than stopping it on the gone reading a swept child
    # earned, which is the one reading the trap stops a handled child on.
    POLL_LIVENESS=""
    CHILD_TREE_MSYS_PIDS=""
    CHILD_TREE_WINPIDS=""
    CHILD_TREE_SEEN_WINPIDS=""
    CHILD_TREE_SEEN_PAIRS=""
    CHILD_TREE_SNAPSHOT=""
    CHILD_TREE_WALKED=""
    CHILD_TREE_READ_FAILED=""
    CHILD_TREE_DESCENDANT_SEEN=""
    CHILD_TREE_CONFIRMED_AT=""
    CHILD_TREE_FAILED_CONFIRMS=0
    refresh_child_tree

    # Read the holder's own pid back (the pipeline's $! is the child), resolve
    # both Windows pids and their start ticks, and write the handle. A holder
    # pid that never appears leaves the pipe-close stop to signal the holder if
    # one is known; the poll loop accounts for a child that died at launch.
    HOLDER_LAUNCH_PID=""
    holder_wait_i=0
    while [ "$holder_wait_i" -lt 100 ]; do
      if [ -s "$HOLDER_PID_FILE" ]; then HOLDER_LAUNCH_PID=$(read_holder_pid "$HOLDER_PID_FILE"); break; fi
      kill -0 "$CHILD_LAUNCH_PID" 2>/dev/null || break
      sleep 0.1 >/dev/null 2>&1
      holder_wait_i=$((holder_wait_i + 1))
    done
    if [ -z "$HOLDER_LAUNCH_PID" ]; then
      log "NOTE: child-$CHILD_INDEX holder pid was not recorded; the pipe-close stop falls back to a signal on the holder if one is known"
    fi
    # The wrapper's and the holder's Windows pids are read from /proc, and each
    # one's start ticks with one PowerShell read, so an adopting supervisor can
    # check that the pids it reads from the handle still name these processes
    # before it counts the child live or signals the holder. This holder is
    # this supervisor's own launch.
    CHILD_WINPID=$(resolve_windows_pid "$CHILD_LAUNCH_PID")
    CHILD_TICKS=$(resolve_windows_start_ticks "$CHILD_WINPID")
    if [ -n "$HOLDER_LAUNCH_PID" ]; then
      HOLDER_WINPID=$(resolve_windows_pid "$HOLDER_LAUNCH_PID")
      HOLDER_TICKS=$(resolve_windows_start_ticks "$HOLDER_WINPID")
      HOLDER_OWN_LAUNCH=1
    fi
    # The session id is filled in from the init line once the poll reads it.
    write_handle ""
  fi

  # Sent with the first launch or named dropped at an adoption above, and
  # never handed to a later child.
  PROMPT=""

  # --- Poll loop ---
  STORE="$WORKDIR/.agentic-personas.json"
  # An adopted child keeps the session id, stream state and final-ask time the
  # gate's poll read; a launched child starts each of them empty.
  if [ "$ADOPTED" != 1 ]; then
    CHILD_SESSION_ID=""
    STREAM_SEEN_SIZE=""
    STREAM_CHANGED_AT=""
    FINAL_ASK_AT=""
    LIVENESS_LOGGED=""
    HEARTBEAT_ABSENT_LOGGED=""
  fi
  POLL_COUNT=0
  # The end of the wait this child is parked on, and the value the log last
  # named. Both belong to one child: a fresh child's stream is its own.
  RATE_LIMIT_LOGGED=""
  RATE_LIMIT_RESET=""
  RATE_LIMIT_RESET_ISO=""
  # The request_at of the last interrupt relay failure this child's polls
  # logged, so a failure that keeps recurring for the same standing request
  # is named once rather than on every poll. A fresh child's relay history is
  # its own.
  INTERRUPT_FAIL_LOGGED_AT=""
  # The request_at this child's polls have already relayed or already
  # skipped, so a standing served-marker failure retries only that write
  # rather than relaying or skipping the same request again. A fresh child's
  # relay history is its own.
  INTERRUPT_HANDLED_AT=""
  # The liveness state this child's polls carry from one to the next, since
  # the poll process is fresh every poll: the stream's size as last seen and
  # the moment it last changed, on this supervisor's clock, and the time of
  # the final ask for the current silence. All three start empty for each
  # child, so the first poll ages the stream from the file's own modification
  # time. The liveness reason the log last named, so the line is written when
  # the reason changes rather than on every poll, and whether this child's
  # missing heartbeat file has been named, start empty the same way. All of
  # them are reset above, for a launched child only.
  # The shutdown ask to this child, its id and when it was written, carried
  # poll to poll. Both start empty for each child, since the mailbox was
  # truncated at its launch.
  SHUTDOWN_ASK_ID=""
  SHUTDOWN_ASK_AT=""

  if [ -z "$CHILD_LAUNCH_PID" ]; then
    log "ERROR: CHILD_LAUNCH_PID not set after launch"
    exit 1
  fi

  # A launched child is polled while its launch pid answers; an adopted one
  # while its marker is absent and the walk has not completed finding nothing.
  while child_present; do
    sleep $((SUPERVISOR_POLL_MS / 1000))

    # A child that runs for days has its work directory swept once a day. An
    # adopted child had no launch sweep, so its first poll sweeps. The clock
    # reads are the shell's own, so the daily check starts no process on a
    # poll.
    printf -v poll_now_s '%(%s)T' -1
    if [ $(( poll_now_s - LAST_CHANNEL_SWEEP_S )) -ge 86400 ]; then
      sweep_channel_log_segments "$WORKDIR" "$CHANNEL_LOG_RETENTION_DAYS"
      printf -v LAST_CHANNEL_SWEEP_S '%(%s)T' -1
    fi
    POLL_COUNT=$((POLL_COUNT + 1))

    # The child's own processes, recorded while they can still be read. A
    # `claude.exe` appears under the wrapper a few seconds after the launch,
    # and nothing can name it once its wrapper exits.
    refresh_child_tree

    # Every reading this poll takes, and the decision on them, in one process:
    # the store, the child's own heartbeat file, the stream, the transcript and
    # the mailbox pair, with the walk above handed in. The store is read once,
    # so every fact off it describes the same moment. The same process writes a
    # probe to the mailbox where the heartbeat is stale, and the shutdown ask
    # where a shutdown request is present and no ask to this child is open.
    # run_child_poll is the one place the poll process is called, shared with
    # the pre-launch gate's adoption verdict.
    run_child_poll

    # The coordinator's interrupt request, checked every poll independent of
    # this poll's own reading: an interrupt is orthogonal to liveness, so a
    # poll whose liveness read failed still relays a standing request.
    relay_interrupt_request

    # The liveness state and the shutdown ask carried to the next poll, taken
    # only from a poll that ran: a failed one says nothing about the stream or
    # either ask, so the last reading of each stands.
    if [ -n "$DECIDE_ACTION" ] && [ $DECIDE_ERR -eq 0 ]; then
      note_liveness_poll
      note_shutdown_ask
    fi

    # The child's session id, off the init line of its stream, recorded in the
    # handle on the poll that first reads it; and, for a launched child whose
    # start ticks, whose holder's start ticks or whose supervisor's own pair
    # the launch could not read, each retried until it lands. An adopted
    # child's handle carries all three already: its ticks were checked live
    # before it was adopted, its holder's pair is the record, and the claim is
    # written only with a known own pair.
    note_child_session_id
    if [ "${CHILD_ADOPTED:-}" != "1" ]; then
      ensure_child_ticks
      ensure_holder_ticks
      ensure_self_pair_recorded
    fi

    # How much longer this child is parked on a rate limit, read off the newest
    # record in its stream. A reading with no park prints "-" in the first
    # field, which is cleared here so everything downstream reads an empty
    # value as no park. A poll whose reader failed says nothing about the park
    # either way, so it leaves the last reading standing: clearing it would
    # name the same park in the log a second time on the next poll.
    if [ -n "$DECIDE_ACTION" ] && [ $DECIDE_ERR -eq 0 ]; then
      read -r RATE_LIMIT_RESET RATE_LIMIT_RESET_ISO <<< "$POLL_RATE_LIMIT"
      case "${RATE_LIMIT_RESET:-}" in
        ''|*[!0-9]*) RATE_LIMIT_RESET=""; RATE_LIMIT_RESET_ISO="" ;;
      esac
    fi

    # Named the moment the park is seen, rather than only on the liveness
    # cadence below: a child can sit in a rate limit's backoff for hours, and
    # the log is where the operator tells that from a working child. Named once
    # per park, since the child rewrites the remaining wait every 30 seconds
    # and keying on that value would put a line in the log on every poll.
    if [ -n "${RATE_LIMIT_RESET:-}" ]; then
      if [ -z "$RATE_LIMIT_LOGGED" ]; then
        log "RATE_LIMITED until $RATE_LIMIT_RESET_ISO: child-$CHILD_INDEX is waiting out a rate limit"
        RATE_LIMIT_LOGGED=1
      fi
    else
      RATE_LIMIT_LOGGED=""
    fi

    # Prove liveness on a cadence: idleness and an empty goal tree are not
    # crash, restart, or completion signals (plan item 1), so this line is
    # the only thing that should appear in the log for a run that is simply
    # waiting on the next chat-delivered goal. A rate-limited child says so
    # instead, since "waiting" on its own is what hid an hour-long backoff.
    if [ $((POLL_COUNT % ALIVE_LOG_EVERY_N_POLLS)) -eq 0 ]; then
      if [ -n "${RATE_LIMIT_RESET_ISO:-}" ]; then
        log "RATE_LIMITED until $RATE_LIMIT_RESET_ISO: child-$CHILD_INDEX alive, persona held, waiting out the limit (poll $POLL_COUNT)"
      else
        log "WAITING: child-$CHILD_INDEX alive, persona held, no restart triggers (poll $POLL_COUNT)"
      fi
    fi

    if [ -z "$DECIDE_ACTION" ] || [ $DECIDE_ERR -ne 0 ]; then
      log "DECIDE ERR $DECIDE_ERR (see supervisor.err)"
      continue
    fi

    case "$DECIDE_ACTION" in
      stop_complete)
        # A shutdown the child recorded while the shutdown ask was open is
        # that ask honored, and the log says so.
        if [ -n "$SHUTDOWN_ASK_ID" ]; then
          log "STOP_COMPLETE: $DECIDE_REASON (the shutdown ask id=$SHUTDOWN_ASK_ID is honored)"
        else
          log "STOP_COMPLETE: $DECIDE_REASON"
        fi
        stop_child "stop_complete"
        retry_stop_escalation "stop_complete" $?
        STOP_ESCALATION_RESULT=$?
        wait "$CHILD_LAUNCH_PID" 2>/dev/null
        CHILD_LAUNCH_PID=""
        EXIT_CODE=$(child_exit_code)
        clear_handle
        log "EXIT child-$CHILD_INDEX code=$EXIT_CODE ($STOP_PATH)"
        # Exiting 0 here when a process from the child is alive, or when no
        # reading could account for its tree, would read as a clean shutdown
        # when it is not one. Exit 5 instead, a code distinct from every other
        # exit this script uses, so the operator can tell the two apart.
        if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
          log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
          exit 5
        fi
        clear_shutdown_request
        exit 0
        ;;
      ask_timeout)
        ask_timeout_stop
        ;;
      stop_park)
        log "STOP_PARK: $DECIDE_REASON"
        stop_child "stop_park"
        retry_stop_escalation "stop_park" $?
        STOP_ESCALATION_RESULT=$?
        wait "$CHILD_LAUNCH_PID" 2>/dev/null
        CHILD_LAUNCH_PID=""
        EXIT_CODE=$(child_exit_code)
        clear_handle
        log "EXIT child-$CHILD_INDEX code=$EXIT_CODE ($STOP_PATH)"
        # Exit 6 is what the keeper reads as a park, and it launches the
        # persona again at its next start. A tree that is alive or unverifiable
        # outranks the park, as it outranks every other decide-path stop, and
        # reports as exit 5.
        if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
          log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
          exit 5
        fi
        exit 6
        ;;
      stop_crash_loop)
        log "STOP_CRASH_LOOP: $DECIDE_REASON"
        stop_child "stop_crash_loop"
        retry_stop_escalation "stop_crash_loop" $?
        STOP_ESCALATION_RESULT=$?
        wait "$CHILD_LAUNCH_PID" 2>/dev/null
        CHILD_LAUNCH_PID=""
        EXIT_CODE=$(child_exit_code)
        clear_handle
        log "EXIT child-$CHILD_INDEX code=$EXIT_CODE ($STOP_PATH)"
        # A tree that is alive or unverifiable outranks the crash loop this
        # path reports, since it is the one state the next launch cannot work
        # around.
        if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
          log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
          exit 5
        fi
        exit 3
        ;;
      stop_budget)
        log "STOP_BUDGET: $DECIDE_REASON"
        stop_child "stop_budget"
        retry_stop_escalation "stop_budget" $?
        STOP_ESCALATION_RESULT=$?
        wait "$CHILD_LAUNCH_PID" 2>/dev/null
        CHILD_LAUNCH_PID=""
        EXIT_CODE=$(child_exit_code)
        clear_handle
        log "EXIT child-$CHILD_INDEX code=$EXIT_CODE ($STOP_PATH)"
        # A tree that is alive or unverifiable outranks the restart budget
        # this path reports, for the same reason.
        if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
          log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
          exit 5
        fi
        exit 4
        ;;
      restart_passive)
        # A restart request newer than the child's start, with no shutdown
        # requested: the persona or the coordinator asked for the child to be
        # relaunched with the goal tree kept. Stopped the same graceful way as
        # stop_complete (EOF path), but this is expected, healthy behavior, not
        # a crash: it must never count toward the crash-loop or restart-budget
        # limits meant for actual failures.
        log "RESTART_PASSIVE: $DECIDE_REASON"
        stop_child "restart_passive"
        retry_stop_escalation "restart_passive" $?
        STOP_ESCALATION_RESULT=$?
        wait "$CHILD_LAUNCH_PID" 2>/dev/null
        CHILD_LAUNCH_PID=""
        EXIT_CODE=$(child_exit_code)
        clear_handle
        log "EXIT child-$CHILD_INDEX code=$EXIT_CODE ($STOP_PATH)"
        # Launching the next child beside a process this one left running puts
        # two children on one persona claim, so a tree that is alive or that
        # no reading could account for refuses the relaunch and ends the run
        # at exit 5. The natural-exit path draws the same line.
        if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
          log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
          exit 5
        fi
        log "PASSIVE: restart requested; relaunching the child with the goal tree kept, the new child resumes the active plan"
        continue 2  # break out of the poll loop and go to the next child
        ;;
      restart)
        log "RESTART: $DECIDE_REASON"
        stop_child "restart"
        retry_stop_escalation "restart" $?
        STOP_ESCALATION_RESULT=$?
        wait "$CHILD_LAUNCH_PID" 2>/dev/null
        CHILD_LAUNCH_PID=""
        EXIT_CODE=$(child_exit_code)
        clear_handle
        log "EXIT child-$CHILD_INDEX code=$EXIT_CODE ($STOP_PATH)"
        # A tree from this child that is alive or unverifiable is one terminal
        # state, and it reports as exit 5 here as it does on every other path,
        # ahead of the limit checks below: those end the run for a different
        # reason and would report it under a different code.
        if [ "${STOP_ESCALATION_RESULT:-0}" -ne 0 ]; then
          log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable despite every stop retry (STOP_PATH=$STOP_PATH)"
          exit 5
        fi

        # Update crash counter.
        CHILD_RUN_MS=""
        if [ -n "${LAUNCHED_AT:-}" ]; then CHILD_RUN_MS=$(( ( $(node -e "console.log(Date.now())") - LAUNCHED_AT ) )); fi
        if [ $EXIT_CODE -ne 0 ] && [ -n "$CHILD_RUN_MS" ] && [ $CHILD_RUN_MS -lt $SUPERVISOR_MIN_RUN_MS ]; then
          CRASH_COUNT=$((CRASH_COUNT + 1))
        else
          CRASH_COUNT=0
        fi
        record_restart_in_hour

        # Both limits are read here, before the relaunch, on the same counts
        # the natural-exit path checks and with the same exit codes. A limit
        # read only at the next child's first poll stops the run one launch
        # late, and that launch claims the persona, takes a priming turn and
        # attaches the channel before anything stops it.
        if [ $RESTART_COUNT -ge $SUPERVISOR_MAX_RESTARTS_PER_HOUR ]; then
          log "STOP_BUDGET: $RESTART_COUNT/$SUPERVISOR_MAX_RESTARTS_PER_HOUR restarts in the hour"
          exit 4
        fi
        if [ $CRASH_COUNT -ge $SUPERVISOR_CRASH_LIMIT ]; then
          log "STOP_CRASH_LOOP: $CRASH_COUNT crashes within $SUPERVISOR_MIN_RUN_MS ms"
          exit 3
        fi
        continue 2  # break out of the poll loop and go to the next child
        ;;
      final_ask)
        # Every signal is silent and the child's process is live. The one
        # writer of the ask, shared with the gate's adoption of a frozen
        # child, writes it and opens the window.
        write_final_ask
        ;;
      sweep_relaunch)
        sweep_gone_child
        continue 2  # break out of the poll loop and go to the next child
        ;;
      continue)
        ;;
    esac
  done

  # Child exited on its own (not via decide). The launch shape wrote the child's
  # own exit code into the .exit marker, so `wait` here only reaps the pipeline
  # (and does nothing for a child this supervisor adopted rather than launched),
  # and the exit code is read from the marker. The holder is killed first: it
  # holds the pipe until the child dies, and `wait` on the pipeline would block
  # on the holder as long as it runs.
  kill_holder
  wait "$CHILD_LAUNCH_PID" 2>/dev/null
  CHILD_LAUNCH_PID=""
  EXIT_CODE=$(child_exit_code)
  clear_handle

  log "EXIT child-$CHILD_INDEX code=$EXIT_CODE (natural)"

  # The shutdown the operator asked for is read before anything else this path
  # does. It is the ordinary way a persona goes down: the child records
  # shutdown_requested and exits on its own, and the answer the keeper needs
  # from that is exit 0, which is what writes the hold marker and keeps the
  # persona down. A reading taken after the sweep below could end that run on
  # a code that relaunches instead.
  SHUTDOWN_REQUESTED_TS=$(get_fact "$WORKDIR" "$PERSONA" "shutdown_requested")
  if [ -n "$SHUTDOWN_REQUESTED_TS" ] && [ "$SHUTDOWN_REQUESTED_TS" -gt "$CHILD_START_TS" ]; then
    if [ -n "$SHUTDOWN_ASK_ID" ]; then
      log "STOP_COMPLETE: shutdown_requested at $SHUTDOWN_REQUESTED_TS > child start $CHILD_START_TS (the shutdown ask id=$SHUTDOWN_ASK_ID is honored)"
    else
      log "STOP_COMPLETE: shutdown_requested at $SHUTDOWN_REQUESTED_TS > child start $CHILD_START_TS"
    fi
    # The run ends here whatever the sweep finds, since exit 0 is what the
    # keeper reads as the shutdown being honored and any other code brings the
    # persona back. The sweep still runs, because nothing downstream ever
    # reaches this child's tree again: the keeper writes its hold and stops, so
    # a process left alive here goes on holding the persona claim with nothing
    # left to kill it.
    sweep_child_tree "shutdown"
    SWEEP_RC=$?
    if [ "$SWEEP_RC" -eq 1 ] && [ -n "$LAST_STOP_SNAPSHOT" ]; then
      retry_stop_escalation "shutdown" "$SWEEP_RC"
      SWEEP_RC=$?
    fi
    if [ "$SWEEP_RC" -eq 1 ]; then
      log "NOTE: child-$CHILD_INDEX leaves a process that is alive or a tree that could not be read, and the shutdown the operator asked for is still what this run reports"
    fi
    clear_shutdown_request
    exit 0
  fi

  # A park is read next, the same way, and a shutdown read above outranks it.
  # The child records park_requested and exits on its own, and the answer the
  # keeper needs from that is exit 6, which is what writes the park marker so
  # its next start launches the persona again.
  PARK_REQUESTED_TS=$(get_fact "$WORKDIR" "$PERSONA" "park_requested")
  if [ -n "$PARK_REQUESTED_TS" ] && [ "$PARK_REQUESTED_TS" -gt "$CHILD_START_TS" ]; then
    log "STOP_PARK: park_requested at $PARK_REQUESTED_TS > child start $CHILD_START_TS"
    # Swept here for the same reason the shutdown is: no relaunch follows in
    # this run. Unlike the shutdown, a process left alive or a tree that could
    # not be read ends the run at exit 5, as it does on every stop but the
    # shutdown. The keeper relaunches on that code after its delay, which is
    # what a park asks for anyway, and the next child meets the survivor at the
    # pre-launch gate.
    sweep_child_tree "park"
    SWEEP_RC=$?
    if [ "$SWEEP_RC" -eq 1 ] && [ -n "$LAST_STOP_SNAPSHOT" ]; then
      retry_stop_escalation "park" "$SWEEP_RC"
      SWEEP_RC=$?
    fi
    if [ "$SWEEP_RC" -eq 1 ]; then
      log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable after every sweep retry"
      exit 5
    fi
    exit 6
  fi

  # A child that exits on its own was never stopped, so nothing has looked at
  # what it left running. Anything still alive holds the persona claim, and the
  # next child would spend the whole pre-launch gate waiting on that claim
  # before exiting 2. Swept here, ahead of every branch below, so no relaunch
  # and no exit leaves one behind.
  sweep_child_tree "natural_exit"
  SWEEP_RC=$?
  if [ "$SWEEP_RC" -eq 1 ]; then
    # The retry backstop runs on the record the sweep left standing, which the
    # sweep sets only where retrying that same record can still settle the
    # question. A sweep with nothing to retry against has already said so, and
    # sending it through the backstop would only re-derive that same nothing.
    if [ -n "$LAST_STOP_SNAPSHOT" ]; then
      retry_stop_escalation "natural_exit" "$SWEEP_RC"
      SWEEP_RC=$?
    fi
    # Relaunching beside a survivor is what makes the next child spend the
    # whole pre-launch gate waiting on a persona claim it can never win. Exit 5
    # instead, the same code every other stop path uses for a child whose tree
    # is alive or unverifiable after every retry.
    if [ "$SWEEP_RC" -ne 0 ]; then
      log "EXIT child-$CHILD_INDEX: a process from this child is alive or unverifiable after every sweep retry"
      exit 5
    fi
  fi
  RESTART_REQUESTED_TS=$(get_fact "$WORKDIR" "$PERSONA" "restart_requested")
  # The coordinator's request file is the same fact, and the later of the two
  # is the one compared against this child's start, as the poll compares it.
  RESTART_REQUEST_FILE_TS=$(get_restart_request)
  if [ -n "$RESTART_REQUEST_FILE_TS" ] && { [ -z "$RESTART_REQUESTED_TS" ] || [ "$RESTART_REQUEST_FILE_TS" -gt "$RESTART_REQUESTED_TS" ]; }; then
    RESTART_REQUESTED_TS="$RESTART_REQUEST_FILE_TS"
  fi
  if [ -n "$RESTART_REQUESTED_TS" ] && [ "$RESTART_REQUESTED_TS" -gt "$CHILD_START_TS" ]; then
    log "RESTART_PASSIVE: restart_requested at $RESTART_REQUESTED_TS > child start $CHILD_START_TS (no shutdown requested)"
    log "PASSIVE: restart requested; relaunching the child with the goal tree kept, the new child resumes the active plan"
    continue  # only the outer loop encloses this point; no crash/restart accounting
  fi
  read -r ROOT_COMPLETE_TS ROOT_COMPLETE_BACKFILLED_FLAG <<< "$(get_root_complete "$WORKDIR" "$PERSONA")"
  if [ -n "$ROOT_COMPLETE_TS" ] && [ "$ROOT_COMPLETE_TS" -gt "$CHILD_START_TS" ]; then
    if [ "$ROOT_COMPLETE_BACKFILLED_FLAG" = "1" ] && [ "$EXIT_CODE" -eq 0 ]; then
      # v2 Section 0 item 1: a backfilled root_complete is real tool work
      # with no active goal tree, not a real completion, and falling
      # through to the accounted restart path counts a clean, expected
      # exit against the restart budget; children exit naturally after
      # backfilled turns routinely, so a chatty hour of operator steers
      # would trip stop_budget and kill a healthy supervisor. Relaunch
      # unaccounted instead, the same as restart_requested above and a real
      # root_complete below - but only when the child's own exit was
      # actually clean: the unaccounted path exists to stop counting a
      # healthy exit against the budget, not to exempt every backfilled
      # turn regardless of how the child died. A child that does one
      # backfilled tool turn and then exits non-zero falls through to the
      # accounted path below like any other crash.
      log "NOTE: root_complete at $ROOT_COMPLETE_TS > child start $CHILD_START_TS is backfilled, not a real completion (exit $EXIT_CODE); not taking RESTART_PASSIVE"
      log "PASSIVE: relaunching unaccounted after a backfilled root; the child exited clean, not a failure"
      continue  # only the outer loop encloses this point; no crash/restart accounting
    elif [ "$ROOT_COMPLETE_BACKFILLED_FLAG" != "1" ] && [ "$EXIT_CODE" -eq 0 ]; then
      # A real root_complete newer than this child's start is the resting
      # state of a child that finished a goal and stayed up, so it is not a
      # restart trigger. A clean exit after one is a healthy child, and it
      # relaunches unaccounted, the same as the backfilled branch above. A
      # non-zero exit falls through to the accounted path below like any
      # other crash, so a child that keeps crashing after one finished goal
      # still meets the crash limit and the hourly budget.
      log "NOTE: root_complete at $ROOT_COMPLETE_TS > child start $CHILD_START_TS is a completed goal and the child exited clean (exit $EXIT_CODE); relaunching unaccounted, not a failure"
      continue  # only the outer loop encloses this point; no crash/restart accounting
    fi
  fi
  # A turn that did real tool work with no open goal logs an untracked_work
  # decision, and the hook re-pushes that one line with a fresh clock on each
  # such turn, so a line newer than this child's start means the child did
  # work this life. A clean exit after it is a healthy child between
  # requests, so it relaunches unaccounted, the same as the backfilled branch
  # above: counting it would let a chatty hour of operator steers trip
  # stop_budget and kill a healthy supervisor. A real root_complete newer
  # than the start with a clean exit has already been taken above. A non-zero
  # exit falls through to the accounted path below like any other crash.
  UNTRACKED_WORK_TS=""
  if [ "$EXIT_CODE" -eq 0 ]; then
    UNTRACKED_WORK_TS=$(get_fact "$WORKDIR" "$PERSONA" "untracked_work")
  fi
  if [ "$EXIT_CODE" -eq 0 ] && [ -n "$UNTRACKED_WORK_TS" ] && [ "$UNTRACKED_WORK_TS" -gt "$CHILD_START_TS" ]; then
    log "NOTE: untracked_work at $UNTRACKED_WORK_TS > child start $CHILD_START_TS is untracked work with no open goal, not a completion (exit $EXIT_CODE); not taking RESTART_PASSIVE"
    log "PASSIVE: relaunching unaccounted after untracked work; the child exited clean, not a failure"
    continue  # only the outer loop encloses this point; no crash/restart accounting
  fi

  # Update crash counter.
  CHILD_RUN_MS=""
  if [ -n "${LAUNCHED_AT:-}" ]; then CHILD_RUN_MS=$(( ( $(node -e "console.log(Date.now())") - LAUNCHED_AT ) )); fi
  if [ $EXIT_CODE -ne 0 ] && [ -n "$CHILD_RUN_MS" ] && [ $CHILD_RUN_MS -lt $SUPERVISOR_MIN_RUN_MS ]; then
    CRASH_COUNT=$((CRASH_COUNT + 1))
  else
    CRASH_COUNT=0
  fi
  record_restart_in_hour

  # Check budget.
  if [ $RESTART_COUNT -ge $SUPERVISOR_MAX_RESTARTS_PER_HOUR ]; then
    log "STOP_BUDGET: $RESTART_COUNT/$SUPERVISOR_MAX_RESTARTS_PER_HOUR restarts in the hour"
    exit 4
  fi

  # Check crash loop.
  if [ $CRASH_COUNT -ge $SUPERVISOR_CRASH_LIMIT ]; then
    log "STOP_CRASH_LOOP: $CRASH_COUNT crashes within $SUPERVISOR_MIN_RUN_MS ms"
    exit 3
  fi

done
