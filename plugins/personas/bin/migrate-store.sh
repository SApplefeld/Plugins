#!/usr/bin/env bash
# bin/migrate-store.sh - Copies the persona plugin's store file forward to the
# installed id personas@applefeld, so the first launch under that id reads
# every inbox record and persona claim the machine holds. The operator runs it
# once per fleet machine at the cutover, with the fleet stopped and the new id
# installed, before `claude plugin uninstall personas@agent-persona`.
#
# The whole of the work is migrate_global_store in bin/agentic-common.sh. This
# command, run at the cutover with the fleet stopped, is the expected path.
# bin/supervise.sh runs the same function before its pre-launch gate in
# installed mode as the backstop, and only once installed_plugins.json lists
# personas@applefeld and no longer lists the old id. It prints the old, new
# and backup store file names, copies and never moves, and leaves the old
# file as the rollback. The exit code is the function's: 0 on every outcome
# it defines, 1 where a read or a write failed. One refusal to know: a
# same-day backup, personas-store-backup-<UTC date>.json, that differs from
# the old file exits 1 and changes nothing, and in the supervisor's path
# that stops installed launches until the operator renames or removes the
# differing backup.
set -u
_COMMON="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agentic-common.sh"
# shellcheck source=agentic-common.sh
source "$_COMMON"
migrate_global_store
