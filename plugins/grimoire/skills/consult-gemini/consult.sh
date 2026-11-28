#!/usr/bin/env bash
# Sends one question to Gemini 4 Neon through agy and checks the result.
# Usage: consult.sh <low|medium|high> [--tree <repository>@<commit> ...] [file-to-attach ...] < question
#        consult.sh --check
# Attached files are copied into an empty work folder; refer to each in the question as @basename.
# Each --tree exports that commit's tracked files into the work folder, under a folder named after the repository's folder,
# and lists them in <folder>.files.txt beside it.
# --check sends nothing: it prints `agy: found` or `agy: missing`, then `sign-in: listed`, `sign-in: not listed` or
# `sign-in: unknown`. A listed sign-in is a hint and not proof that agy can use it; only a run's own verdict shows that.
# Exit codes: 0 answered, or --check found agy; 1 agy failed, gave no answer within the tier's time or returned no usable answer;
# 2 bad arguments or a tree that is refused; 3 unavailable: the system is not Git Bash on Windows, agy is not installed,
# or agy asked for a Google sign-in. Each exit 3 of a run prints one line that opens `verdict: UNAVAILABLE - `; a check shows a
# missing agy by its `agy: missing` line.
set -u

usage() { echo "usage: consult.sh <low|medium|high> [--tree <repository>@<commit> ...] [file ...] < question, or consult.sh --check" >&2; }

machine=${COMPUTERNAME:-this machine}

# The script leans on cygpath, cmdkey and taskkill, so it runs under Git Bash on Windows alone.
case $(uname -s 2>/dev/null) in
	MINGW*|MSYS*) ;;
	*) echo "verdict: UNAVAILABLE - the Gemini consult runs under Git Bash on Windows"; exit 3 ;;
esac

# A session started before agy was installed has no agy on its PATH, so its install folder is searched too.
find_agy() {
	if ! command -v agy >/dev/null 2>&1 && [[ -n ${LOCALAPPDATA:-} ]]; then
		PATH="$(cygpath -u "$LOCALAPPDATA")/agy/bin:$PATH"
	fi
	command -v agy >/dev/null 2>&1
}

# Whether Windows lists agy's saved sign-in, read from the presence of the one target alone; the output is never kept.
# MSYS_NO_PATHCONV stops Git Bash from rewriting /list into a path, which makes cmdkey print its help and read as a false no.
credential_listed() {
	command -v cmdkey >/dev/null 2>&1 || { echo unknown; return; }
	local out rc
	out=$(MSYS_NO_PATHCONV=1 cmdkey /list:gemini:antigravity 2>&1); rc=$?
	if ((rc != 0)); then echo unknown
	elif grep -qiE 'Target: *(LegacyGeneric:target=)?gemini:antigravity' <<<"$out"; then echo yes
	elif grep -qiE '\* *NONE *\*' <<<"$out"; then echo no
	else echo unknown
	fi
}

here=$(dirname -- "$(readlink -f -- "$0")")

# Every git call runs under the guard of the kit's hooks' library, hooks/kit-git-lib.js beside this skill's folder:
# git starts from the library's own folder, never a repository's, under gitChildEnv's environment, which carries no
# ambient GIT_* variable, refuses a fetch on demand and pins core.fsmonitor and core.hooksPath inert.
git_lib=$(cygpath -w -- "$here/../../hooks/kit-git-lib.js" 2>/dev/null)
kit_git() {
	node -e '
const lib = process.argv[1];
const r = require("child_process").spawnSync("git", process.argv.slice(2),
	{ cwd: require("path").dirname(lib), env: require(lib).gitChildEnv(), stdio: "inherit", windowsHide: true });
process.exit(typeof r.status === "number" ? r.status : 1);' "$git_lib" "$@"
}

# Ends agy's process tree. Git Bash children do not always show their parent to Windows, so they are found from ps
# and ended first.
stop_agy() {
	local msys_tree=$agy_pid more winpid tree try id
	while :; do
		more=$(ps -ef | awk -v have=" $msys_tree " 'NR > 1 && index(have, " " $3 " ") && !index(have, " " $2 " ") { printf " %s", $2 }')
		[[ -z $more ]] && break
		msys_tree+=$more
	done
	# A plain kill of the Git Bash process id can leave the Windows process running, so the tree is also ended by its Windows id.
	winpid=$(cat "/proc/$agy_pid/winpid" 2>/dev/null)
	tree=$winpid
	if [[ -n $winpid ]]; then
		tree=$(ROOT=$winpid powershell -NoProfile -Command '$all = Get-CimInstance Win32_Process; $ids = @([int]$env:ROOT); $i = 0; while ($i -lt $ids.Count) { $all | Where-Object { $_.ParentProcessId -eq $ids[$i] } | ForEach-Object { $ids += [int]$_.ProcessId }; $i++ }; $ids -join " "' 2>/dev/null | tr -d '\r')
		taskkill //PID "$winpid" //T //F >/dev/null 2>&1
	fi
	kill $msys_tree 2>/dev/null
	wait "$agy_pid" 2>/dev/null
	# A process takes a moment to exit after it is ended, so the check looks again for up to three seconds.
	for try in 1 2 3 4; do
		left=''
		for id in $msys_tree; do
			if kill -0 "$id" 2>/dev/null; then left+=" bash:$id"; fi
		done
		for id in ${tree:-}; do
			if tasklist //FI "PID eq $id" //NH 2>/dev/null | grep -qw "$id"; then left+=" windows:$id"; fi
		done
		[[ -z $left ]] && break
		sleep 1
	done
	if [[ -n $left ]]; then echo "consult.sh: processes of the stopped agy run are still running:$left" >&2; fi
}

# A log that holds 1,000 lines or more is renamed with the suffix .1, replacing an earlier .1, before a line is added.
# No use of a line can be recorded, so the turn-over is by count alone, and the .1 file is the undo.
turn_over() {
	if [[ -f $1 ]] && (($(wc -l < "$1") >= 1000)); then mv -f -- "$1" "$1.1"; fi
}

# The check reads the system, PATH and the credential list, and starts nothing, makes no folder and writes no log.
if [[ ${1:-} == --check ]]; then
	if find_agy; then echo "agy: found"; found=yes; else echo "agy: missing"; found=no; fi
	case $(credential_listed) in
		yes) echo "sign-in: listed" ;;
		no) echo "sign-in: not listed" ;;
		*) echo "sign-in: unknown" ;;
	esac
	[[ $found == yes ]] && exit 0
	exit 3
fi

tier=${1:-}
case $tier in
	low|medium|high) shift ;;
	*) usage; exit 2 ;;
esac

# A tree is read from git's committed objects alone, so no file of a working folder and no .git folder is exported.
# It is checked here, before the question is read and before any folder is made.
tree_names=(); tree_repos=(); tree_shas=()
while [[ ${1:-} == --tree ]]; do
	if [[ -z $git_lib ]]; then
		echo "consult.sh: cygpath could not resolve the kit's git library at $here/../../hooks/kit-git-lib.js, so no tree can be read" >&2
		exit 2
	fi
	spec=${2:-}
	if [[ $spec != ?*@?* ]]; then usage; exit 2; fi
	repo=${spec%@*}; rev=${spec##*@}
	# git would read a revision that opens with a dash as an option.
	if [[ $rev == -* ]]; then
		echo "consult.sh: the revision $rev opens with a dash, so it is refused" >&2
		exit 2
	fi
	name=$(basename -- "$repo")
	if [[ ! $name =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*$ ]]; then
		echo "consult.sh: the repository folder name $name cannot name a folder in the work folder" >&2
		exit 2
	fi
	for seen in ${tree_names[@]+"${tree_names[@]}"}; do
		if [[ ${seen,,} == "${name,,}" ]]; then
			echo "consult.sh: two trees share the folder name $name" >&2
			exit 2
		fi
	done
	# git runs from the library's folder, so the repository is named by its absolute path.
	repo=$(cygpath -w -a -- "$repo")
	if ! sha=$(kit_git -C "$repo" rev-parse --verify --quiet "$rev^{commit}"); then
		echo "consult.sh: $rev names no commit in $repo" >&2
		exit 2
	fi
	if ! listing=$(kit_git -C "$repo" -c core.quotePath=false ls-tree -r "$sha"); then
		echo "consult.sh: could not list the files of $sha in $repo" >&2
		exit 2
	fi
	# A symlink in the work folder can point outside it, and the gate checks a path's text, not where it leads.
	if grep -q '^120000 ' <<<"$listing"; then
		echo "consult.sh: $name at $rev holds a symlink entry, so the tree is refused" >&2
		exit 2
	fi
	# agy reads its hooks from a folder named .agents, so a tree never brings one in.
	if grep -qiE $'\t(.*/)?\\.agents(/|$)' <<<"$listing"; then
		echo "consult.sh: $name at $rev holds a path under a folder named .agents, so the tree is refused" >&2
		exit 2
	fi
	tree_names+=("$name"); tree_repos+=("$repo"); tree_shas+=("$sha")
	shift 2
done

if ! find_agy; then
	echo "verdict: UNAVAILABLE - agy is not installed on $machine"
	exit 3
fi
caller=$(pwd -W 2>/dev/null || pwd)
sent_bytes=0
if (($#)); then sent_bytes=$(cat -- "$@" 2>/dev/null | wc -c); fi

question=$(cat)
if [[ -z ${question//[[:space:]]/} ]]; then
	echo "consult.sh: the question on stdin is empty" >&2
	exit 2
fi
# agy reads a leading slash as one of its own slash commands.
if [[ $question == /* ]]; then
	question="Question: $question"
fi

# agy writes files anywhere without asking, even under --sandbox, so a workspace hook gates every tool call:
# gate.js allows only read-only tools on paths inside this work folder.
# agy runs the hook from .agents through cmd /c, so the gate is copied there and called by bare name.
work=$(mktemp -d -t consult-gemini.XXXXXX)
mkdir "$work/.agents"
cp -- "$here/gate.js" "$work/.agents/gate.js" || exit 1
printf '%s\n' '{"consult-gate":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"node gate.js","timeout":10}]}]}}' > "$work/.agents/hooks.json"
for f in "$@"; do
	name=$(basename -- "$f")
	if [[ -e $work/$name ]]; then
		echo "consult.sh: two attached files share the name $name" >&2
		exit 2
	fi
	cp -- "$f" "$work/$name" || exit 2
done
for i in "${!tree_names[@]}"; do
	name=${tree_names[$i]}
	if [[ -e $work/$name ]]; then
		echo "consult.sh: an attached file and a tree share the name $name" >&2
		exit 2
	fi
	mkdir "$work/$name"
	# Each blob is read from git's object store as committed, so no filter, attribute or driver the repository
	# configures runs and none changes a byte. A submodule entry holds no blob here and is left out.
	if ! KIT_GIT_LIB=$git_lib REPO=${tree_repos[$i]} SHA=${tree_shas[$i]} DEST=$(cygpath -w -- "$work/$name") node - <<'JS'
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = process.env.KIT_GIT_LIB;
// The same guard as kit_git's: git starts from the library's folder under the library's environment.
function git(args, input) {
	const r = spawnSync('git', ['-C', process.env.REPO].concat(args),
		{ cwd: path.dirname(lib), env: require(lib).gitChildEnv(), input, maxBuffer: Infinity, windowsHide: true });
	if (r.status !== 0) throw new Error('git ' + args[0] + ' exited ' + r.status);
	return r.stdout;
}
const blobs = [];
for (const entry of git(['ls-tree', '-r', '-z', process.env.SHA]).toString('utf8').split('\0')) {
	const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/s.exec(entry);
	if (!m || m[2] !== 'blob') continue;
	// A path is written only where each part names a plain name inside the export folder.
	if (m[4].split('/').some(part => part === '' || part === '.' || part === '..' || /[\\:]/.test(part))) {
		throw new Error('the tree holds a path that cannot be written inside the export folder');
	}
	blobs.push({ sha: m[3], file: path.join(process.env.DEST, ...m[4].split('/')) });
}
const out = git(['cat-file', '--batch'], blobs.map(b => b.sha + '\n').join(''));
let at = 0;
for (const b of blobs) {
	const end = out.indexOf(10, at);
	const head = out.toString('latin1', at, end).split(' ');
	if (end < 0 || head[0] !== b.sha || head[1] !== 'blob') throw new Error('git cat-file did not return blob ' + b.sha);
	const start = end + 1, size = Number(head[2]);
	fs.mkdirSync(path.dirname(b.file), { recursive: true });
	fs.writeFileSync(b.file, out.subarray(start, start + size));
	at = start + size + 1;
}
JS
	then
		echo "consult.sh: could not export $name at ${tree_shas[$i]}" >&2
		exit 1
	fi
done

cd "$work" || exit 1

# A tree file that could hold a credential, or that is not text, is removed before agy starts.
# The name and shape lists are a net over common forms, never proof that a tree holds no secret.
if ((${#tree_names[@]})); then
	TREES=$(printf '%s\n' "${tree_names[@]}") SHAS=$(printf '%s\n' "${tree_shas[@]}") node - <<'JS' || exit 1
const fs = require('fs');
const NAME = /(^|\/)(\.env(\.[^\/]*)?|id_(rsa|dsa|ecdsa|ed25519)|[^\/]*\.(pem|pfx|p12|key|jks|keystore|kdbx))$/i;
const SHAPES = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\bgh[pousr]_[A-Za-z0-9]{36,}/,
	/\bgithub_pat_[A-Za-z0-9_]{50,}/,
	/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{40,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bxox[abprs]-[A-Za-z0-9-]{20,}/,
	/\bAIza[0-9A-Za-z_-]{35}\b/,
	/\b[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/,
	/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
	/\b(server|data source|host)\s*=[^\n]{0,200}\b(password|pwd)\s*=\s*[^;\s"'<>{}$%]{6,}/i,
];
const withheld = [];
function walk(dir, count) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const file = dir + '/' + entry.name;
		if (entry.isDirectory()) { walk(file, count); continue; }
		let why = '';
		if (!entry.isFile()) why = 'not a regular file';
		else if (NAME.test(file)) why = 'key or settings file name';
		else {
			const bytes = fs.readFileSync(file);
			const text = bytes.toString('latin1');
			if (bytes.subarray(0, 8000).includes(0)) why = 'not text';
			else if (SHAPES.some(shape => shape.test(text))) why = 'credential shape';
			else { count.kept++; count.bytes += bytes.length; count.files.push(file); }
		}
		if (why) { fs.rmSync(file, { force: true }); withheld.push(file + '\t' + why); count.withheld++; }
	}
}
const shas = process.env.SHAS.split('\n');
process.env.TREES.split('\n').forEach((tree, i) => {
	const count = { kept: 0, bytes: 0, withheld: 0, files: [] };
	walk(tree, count);
	// The model has no shell here, so the list of exported files is its map of the tree.
	if (fs.existsSync(tree + '.files.txt')) throw new Error('an attached file is named ' + tree + '.files.txt');
	fs.writeFileSync(tree + '.files.txt', count.files.sort().join('\n') + '\n');
	console.log('tree:    ' + tree + ' at ' + shas[i].slice(0, 12) + ', ' + count.kept + ' files (' + count.bytes + ' bytes) exported, ' + count.withheld + ' withheld');
});
if (withheld.length) fs.writeFileSync('withheld.txt', withheld.join('\n') + '\n');
JS
fi

printf '%s' "$question" > question.txt
# ${#question} counts characters under the session's locale; under the C locale it counts the bytes sent.
byte_length() { local LC_ALL=C; question_bytes=${#question}; }
byte_length

listed_before=$(credential_listed)

# agy runs in the background so a sign-in prompt is caught at once rather than after its 60-second wait.
# Only a failed sign-in writes these texts to stderr; a healthy run writes nothing there.
agy --model "gemini-4-neon-$tier" --sandbox --output-format stream-json -p "$question" > events.ndjson 2> stderr.txt &
agy_pid=$!
sign_in_text='authentication required|not authenticated'
# The wait on agy ends before the caller's Bash call times out: 120 s, the Bash tool's default, for low and medium,
# and the 600 s SKILL.md gives a high-tier call. The time limit counts from agy's start, so the tree export before it
# falls outside the limit and shares the 30 s or 60 s left with the stop and the summary after it.
# CONSULT_GEMINI_TEST_DEADLINE_SECONDS is a test hook alone, which can only shorten the wait so a test can reach its end:
# it is used only when it is a whole number of at least 1 and below the tier's deadline, which stands otherwise.
case $tier in high) deadline=540 ;; *) deadline=90 ;; esac
test_deadline=${CONSULT_GEMINI_TEST_DEADLINE_SECONDS:-}
if [[ $test_deadline =~ ^[1-9][0-9]{0,2}$ ]] && ((test_deadline < deadline)); then deadline=$test_deadline; fi
agy_started=$SECONDS
# The trace's sign-in column, set from the summary's exit code below.
sign_in_asked=no
# The poll only stops agy, at the first sign-in text or at the deadline; it decides no verdict.
stop=no
while kill -0 "$agy_pid" 2>/dev/null; do
	if { [[ -s stderr.txt ]] && grep -qiE "$sign_in_text" stderr.txt 2>/dev/null; } || ((SECONDS - agy_started >= deadline)); then
		stop=yes
		break
	fi
	sleep 1
done
if [[ $stop == yes ]]; then stop_agy; agy_exit=stopped; else wait "$agy_pid"; agy_exit=$?; fi
# stderr is read once, after agy has exited or the stop has run, for every way a run ends, so the verdict never turns
# on when a look of the poll fell. A process the stop could not end may still be writing to it. The summary below reads the text as a sign-in request only where the run gave no result event.
sign_in_text_seen=no
if grep -qiE "$sign_in_text" stderr.txt 2>/dev/null; then sign_in_text_seen=yes; fi
listed_after=$(credential_listed)

# Node runs from inside the work folder with relative paths, so no Git Bash path reaches it.
AGY_EXIT=$agy_exit SIGN_IN_TEXT=$sign_in_text_seen DEADLINE=$deadline MACHINE=$machine WORK=$(pwd -W 2>/dev/null || pwd) TIER=$tier CALLER=$caller SENT_BYTES=$((sent_bytes + question_bytes)) \
TREES=$(printf '%s\n' ${tree_names[@]+"${tree_names[@]}"}) \
USAGE_LOG=$(cygpath -w "$HOME/.claude/consult-gemini-usage.tsv" 2>/dev/null || echo "$HOME/.claude/consult-gemini-usage.tsv") node - <<'JS'
const fs = require('fs');
const path = require('path');
const lines = fs.readFileSync('events.ndjson', 'utf8').split('\n').filter(l => l.trim());
const trees = process.env.TREES.split('\n').filter(Boolean).map(t => path.resolve(t).toLowerCase() + path.sep);
const opened = new Map();
let model = '(none reported)', result = null;
for (const line of lines) {
	let e;
	try { e = JSON.parse(line); } catch { continue; }
	// The stream is agy's, so a line that parses to anything but a plain object is skipped.
	if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
	if (e.event === 'init' && e.init) model = e.init.model;
	if (e.event === 'result' && e.result) result = e.result;
	// A tree file the model opened is counted once, as the measure of how much of the tree it read.
	const info = e.event === 'step_update' && e.step_update && e.step_update.tool_info;
	if (!info || !info.parameters || !trees.length) continue;
	for (const value of Object.values(info.parameters)) {
		if (typeof value !== 'string') continue;
		const file = path.resolve(value);
		if (!trees.some(t => file.toLowerCase().startsWith(t))) continue;
		try { const stat = fs.statSync(file); if (stat.isFile()) opened.set(file.toLowerCase(), stat.size); } catch {}
	}
}
const openedBytes = [...opened.values()].reduce((a, b) => a + b, 0);
if (trees.length) fs.writeFileSync('tree-read.txt', [...opened.keys()].sort().join('\n') + (opened.size ? '\n' : ''));
// A sign-in address holds a one-use challenge value, and a session's output is kept in transcripts.
const stderr = fs.readFileSync('stderr.txt', 'utf8').trim().replace(/http\S*/gi, '[address withheld]');
// The verdict is decided here alone, from the final stderr, the result event and how the run ended. A stopped run
// with no result and no sign-in text can only have reached the deadline.
const stopped = process.env.AGY_EXIT === 'stopped';
const signIn = process.env.SIGN_IN_TEXT === 'yes' && !result;
const timedOut = stopped && !result && !signIn;
const response = result && result.response ? result.response : '';
const denied = result && result.denied_actions ? result.denied_actions.map(d => d.display_name || d.action) : [];
// The gate's refusals never reach denied_actions; they surface only as tool errors in the event log.
const gated = (lines.join('\n').match(/tool call denied by pre-tool hook/g) || []).length;
if (gated) denied.push(gated + ' refused by consult gate');
fs.writeFileSync('answer.md', response);

const problems = [];
// A stop by the script is no fault of agy's; a stopped run with a result is read by the result alone.
if (!stopped && process.env.AGY_EXIT !== '0') problems.push('agy exited ' + process.env.AGY_EXIT);
if (!result) problems.push('no result event');
// A gate refusal ends the run with status ERROR even when the answer finished, so that status alone is a warning.
else if (result.status !== 'SUCCESS' && !(gated && response.trim())) problems.push('status ' + result.status);
if (!response.trim()) problems.push('empty answer');
const warning = denied.length && !problems.length ? 'WARNING - answered after blocked actions, may be incomplete' : '';

// One line per run, so the operator can weigh runs against the account's weekly usage.
// Its sent bytes are the question, the attached files and the tree files the model opened; a search's matches are not counted.
const verdictWord = signIn ? 'UNAVAILABLE' : timedOut || problems.length ? 'FAILED' : warning ? 'WARNING' : 'OK';
const log = process.env.USAGE_LOG;
try {
	// The same turn-over as the trace's: at 1,000 lines the log becomes <log>.1, replacing an earlier one.
	if (fs.existsSync(log) && (fs.readFileSync(log, 'utf8').match(/\n/g) || []).length >= 1000) fs.renameSync(log, log + '.1');
	if (!fs.existsSync(log)) fs.writeFileSync(log, 'started\ttier\tseconds\tverdict\tsent_bytes\tanswer_chars\tcaller\twork\n');
	// A result event with no usable duration_seconds counts as 0 seconds, so the start time is still a date.
	const seconds = result && Number.isFinite(Number(result.duration_seconds)) ? Number(result.duration_seconds) : 0;
	const started = new Date(Date.now() - 1000 * seconds).toISOString();
	fs.appendFileSync(log, [started, process.env.TIER, result ? Math.round(result.duration_seconds) : '', verdictWord,
		Number(process.env.SENT_BYTES) + openedBytes, response.length, process.env.CALLER, process.env.WORK].join('\t') + '\n');
} catch (e) {
	console.error('usage log not written: ' + (e.code || e.name));
}

console.log('model:   ' + model);
console.log('status:  ' + (result ? result.status : '(none)'));
console.log('agy exit: ' + process.env.AGY_EXIT);
console.log('blocked: ' + (denied.length ? denied.join(', ') : 'none'));
if (trees.length) console.log('read:    ' + opened.size + ' tree files opened (' + openedBytes + ' bytes), listed in tree-read.txt');
console.log('seconds: ' + (result ? Math.round(result.duration_seconds) : '?'));
console.log('answer:  ' + process.env.WORK + '/answer.md (' + response.length + ' chars)');
if (signIn) {
	console.log('verdict: UNAVAILABLE - agy needs a Google sign-in on ' + process.env.MACHINE);
	process.exit(3);
}
if (stderr) console.log('stderr:  ' + stderr.slice(0, 500));
if (timedOut) {
	console.log('verdict: FAILED - no answer within ' + process.env.DEADLINE + ' s');
	process.exit(1);
}
console.log('verdict: ' + (problems.length ? 'FAILED - ' + problems.join('; ') : warning || 'OK'));
process.exit(problems.length ? 1 : 0);
JS
summary_exit=$?
# The summary exits 3 only for a sign-in request, so the trace reads the request from there.
((summary_exit == 3)) && sign_in_asked=yes

# One line per run on whether the saved sign-in was listed before and after it; no credential name or value is written.
trace=$HOME/.claude/consult-gemini-credential.tsv
turn_over "$trace"
[[ -f $trace ]] || printf 'started\twork\tlisted_before\tlisted_after\tsign_in_asked\tagy_exit\n' > "$trace"
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pwd -W 2>/dev/null || pwd)" \
	"$listed_before" "$listed_after" "$sign_in_asked" "$agy_exit" >> "$trace"
exit "$summary_exit"
