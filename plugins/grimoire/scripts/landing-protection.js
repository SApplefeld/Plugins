#!/usr/bin/env node
// landing-protection: whether the host protects the branch a plan lands on.
// The finishing pass asks it once, at the finish, and ends the plan by the
// word it prints.
//
//   node landing-protection.js --branch <name> [--remote <name>] [--repo <dir>]
//
// `--remote` names the remote whose address is read, `origin` where it is left
// off. `--repo` names the directory every git call runs against, the working
// directory where it is left off.
//
// It prints exactly one line to stdout:
//
//   protected   the host holds a rule on the branch
//   open        the host answered, and holds none
//   unknown     the question could not be answered
//
// and one line to stderr, `landing-protection: <reason>`. All three words exit
// 0. A call with no `--branch` prints its usage to stderr, prints nothing to
// stdout and exits 2.
//
// `open` sends a push to the branch, and that push cannot be taken back, so
// `open` is printed only on a positive answer from the host. That answer is
// that the host lists no blocking rule or policy on the branch, not that a
// push will be accepted: a lock or a denied permission still refuses it, and
// the finishing pass's ready ending then takes over. Every failure is
// `unknown`: a branch, remote or address name outside its allowlist, an
// address on neither host, a host tool that is not installed or not signed
// in, a read that exits non-zero, runs past 20 seconds or prints what this
// script cannot read, a branch the host does not hold, and a remote that
// pushes to another address than the one read, or to several.
//
// The remote's address comes from `git remote get-url`. The landing push goes
// to every address `git remote get-url --push --all` prints, which a push
// address or a push rewrite in git's configuration can point at another
// repository. The host reads cover the first address only, so the word is
// `unknown` unless the second read prints exactly one address and it is the
// first. Two hosts are read.
//
// GitHub, an `https://github.com/<owner>/<repo>` or
// `git@github.com:<owner>/<repo>` address with or without `.git`, takes three
// reads through `gh api`. The first, run in the `--repo` directory, names the
// repository gh resolves there, the one the finishing pass's `gh pr view`
// acts on, and the word is `unknown` unless it is the address's repository,
// compared without regard to case. The check compares owner and name on
// github.com alone, so a repository of the same owner and name on another
// host that gh resolves is not told apart. The three reads are:
//
//   repos/{owner}/{repo} --jq .full_name
//   repos/<owner>/<repo>/branches/<branch> --jq .protected
//   repos/<owner>/<repo>/rules/branches/<branch>
//
// The branch read prints `true` for a branch a classic rule or a ruleset
// protects, and fails for a branch the host does not hold. The rules read lists
// the rules on the branch, and lists none for a branch the host does not hold,
// so it cannot say `open` alone. The word is `protected` where the branch read
// prints `true` or the rules read lists one rule or more, and `open` only where
// the branch read prints `false` and the rules read prints an empty list. Any
// rule counts, a deletion rule among them, which errs toward `protected`.
//
// Azure DevOps takes four address shapes, each name percent-decoded:
//
//   https://[<user>@]dev.azure.com/<org>/<project>/_git/<repo>
//   https://<org>.visualstudio.com/[DefaultCollection/]<project>/_git/<repo>
//   git@ssh.dev.azure.com:v3/<org>/<project>/<repo>
//   <user>@vs-ssh.visualstudio.com:v3/<org>/<project>/<repo>
//
// `git ls-remote --exit-code --heads <remote> refs/heads/<branch>` first
// confirms the remote holds the branch, so an empty list of policies is never
// read as `open` for a branch that does not exist. Then `az repos show` turns
// the repository's name into its id, and the host's list of the policies that
// apply to the branch is read as JSON:
//
//   az devops invoke --organization <url> --area git
//     --resource policyConfigurations --route-parameters project=<project>
//     --query-parameters repositoryId=<id> refName=refs/heads/<branch>
//     --api-version 7.1 -o json
//
// That list holds a policy scoped to a folder of branches or to every
// repository in the project, beside one scoped to the branch alone. The output
// is an object whose `value` is the list and whose `continuation_token` names
// a further page. The word is `protected` where `value` holds one policy or
// more with isEnabled and isBlocking both true, whatever the token reads. It
// is `open` only where `value` is a list with no such policy and the
// `continuation_token` key is present and null, so the list is whole.
//
// Every host call is a read: `git remote get-url`, `git ls-remote`, `gh api`
// with no method flag, `az repos show`, and `az devops invoke` with no
// `--http-method` and no `--in-file`, which keeps it a GET. The script fetches
// nothing and writes no file.
//
// No name reaches a host tool before it has passed its allowlist. The git
// calls go through `gitRun` in plugins/grimoire/hooks/kit-git-lib.js, whose
// header states what that runner closes. `gh` and `az` are resolved to an
// absolute path from the absolute entries of PATH, so no file in a working
// directory runs in their place, and each runs from this script's directory,
// but for the GitHub repository read, which runs in the `--repo` directory, so
// gh runs git there itself and that git reads the repository's config.
// `gh` runs with no shell. `az` on Windows is a `.cmd` shim, which only
// cmd.exe can start, so that one call goes through a shell, as azRunner's
// comment states.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { gitRun } = require('../hooks/kit-git-lib.js');

const USAGE = 'usage: landing-protection.js --branch <name> [--remote <name>] [--repo <dir>]';
// The bound on each git and host read.
const READ_TIMEOUT_MS = 20000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

// The branch names a host read may carry, a copy of the BRANCH_ALLOWLIST
// pattern in plugins/personas/hooks/guards/merged-pr-push.ts. A remote's name
// takes the same one.
const BRANCH_ALLOWLIST = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;
// A GitHub owner or repository name.
const GITHUB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// An Azure DevOps organization, project or repository name, after decoding.
const AZURE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
// The id `az repos show` prints for a repository.
const AZURE_ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
// The characters one word of an az command line may hold. None is an
// operator, an expansion or a quote to cmd.exe, inside double quotes or
// outside them. A space and `=` split the numbered parameters of a batch file
// outside quotes, so azRunner quotes a word holding either.
const AZ_WORD = /^[A-Za-z0-9 ._\/:=-]+$/;
// An az path cmd.exe runs as written between double quotes: cmd.exe expands
// `%` inside quotes, a `"` would end them, and the rest are its operators.
const CMD_RUNNABLE_PATH = /^[^%"&^@<>|\x00-\x1f]+$/;

const GITHUB_ADDRESSES = [
    /^https:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/i,
    /^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/i
];
// Each captures the organization, the project and the repository, in order.
const AZURE_ADDRESSES = [
    /^https:\/\/(?:[^@\/]+@)?dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_git\/([^\/]+)$/i,
    /^https:\/\/([^.\/@]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^\/]+)\/_git\/([^\/]+)$/i,
    /^git@ssh\.dev\.azure\.com:v3\/([^\/]+)\/([^\/]+)\/([^\/]+)$/i,
    /^[^@\/]+@vs-ssh\.visualstudio\.com:v3\/([^\/]+)\/([^\/]+)\/([^\/]+)$/i
];

const WINDOWS = process.platform === 'win32';

const answer = (word, reason) => ({ word, reason });
const unknown = (reason) => answer('unknown', reason);

// The flags' values. `branch` stays undefined where the flag is absent or has
// no value after it, and `stray` is true where any other word could not be
// read as a flag and its value.
function parseArgs(argv) {
    const flags = { '--branch': 'branch', '--remote': 'remote', '--repo': 'repo' };
    const args = { branch: undefined, remote: 'origin', repo: null, stray: false };
    for (let i = 0; i < argv.length; i++) {
        const key = Object.prototype.hasOwnProperty.call(flags, argv[i]) ? flags[argv[i]] : null;
        if (key === null || argv[i + 1] === undefined) args.stray = true;
        else args[key] = argv[++i];
    }
    return args;
}

// The host and names a remote address carries, or null for an address in no
// shape this script reads or with a name outside its allowlist.
function parseAddress(address) {
    for (const shape of GITHUB_ADDRESSES) {
        const m = shape.exec(address);
        if (m) return GITHUB_NAME.test(m[1]) && GITHUB_NAME.test(m[2]) ? { host: 'github', owner: m[1], repo: m[2] } : null;
    }
    for (const shape of AZURE_ADDRESSES) {
        const m = shape.exec(address);
        if (!m) continue;
        let names;
        try {
            names = m.slice(1, 4).map(decodeURIComponent);
        } catch {
            return null;
        }
        return names.every((n) => AZURE_NAME.test(n)) ? { host: 'azure', org: names[0], project: names[1], repo: names[2] } : null;
    }
    return null;
}

// The absolute path of the first file on PATH named `name` plus one of
// `extensions`, or null. Only an absolute PATH entry is searched, so a
// relative one cannot name a file under whatever directory the call runs in.
function resolveOnPath(name, extensions) {
    for (const raw of String(process.env.PATH || '').split(path.delimiter)) {
        const entry = raw.trim().replace(/^"(.*)"$/, '$1');
        const absolute = WINDOWS ? /^[A-Za-z]:[\\/]/.test(entry) || /^[\\/]{2}[^\\/]/.test(entry) : entry.startsWith('/');
        if (!absolute) continue;
        for (const extension of extensions) {
            const candidate = path.join(entry, name + extension);
            try {
                if (!fs.statSync(candidate).isFile()) continue;
                if (!WINDOWS) fs.accessSync(candidate, fs.constants.X_OK);
                return candidate;
            } catch { /* not this one */ }
        }
    }
    return null;
}

// One host read's stdout, or null where it did not start, exited non-zero,
// ran past its bound or wrote past the output ceiling.
function read(file, args, options) {
    let res;
    try {
        res = spawnSync(file, args, {
            cwd: __dirname,
            encoding: 'utf8',
            timeout: READ_TIMEOUT_MS,
            maxBuffer: MAX_OUTPUT_BYTES,
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
            // No host tool prompts, and a child that resolves a command itself
            // does not look in its working directory first.
            env: { ...process.env, GH_PROMPT_DISABLED: '1', NoDefaultCurrentDirectoryInExePath: '1' },
            ...options
        });
    } catch {
        return null;
    }
    if (!res || res.error || res.signal || res.status !== 0 || typeof res.stdout !== 'string') return null;
    return res.stdout;
}

// A function that runs az with the given words and answers its stdout or
// null, or null itself where az cannot be started here.
//
// Off Windows az runs with no shell. On Windows az is a `.cmd` shim, which an
// argument-vector spawn cannot start, so cmd.exe runs it, from SystemRoot's
// System32 and from PATH only where SystemRoot is unset. The command line is
// written here whole and handed over verbatim:
//
//   cmd.exe /d /s /c ""<az path>" <word> "<word with a space>" ..."
//
// Under /s cmd.exe drops the first and the last quote and runs what is
// between them as written, so the az path and a word holding a space or `=`
// each keep their own quotes. The az path must pass CMD_RUNNABLE_PATH. Every word
// must pass AZ_WORD, whoever built it, so no caller can put a character
// cmd.exe acts on into the line.
function azRunner() {
    if (!WINDOWS) {
        const az = resolveOnPath('az', ['']);
        return az === null ? null : (words) => (words.every((w) => AZ_WORD.test(w)) ? read(az, words) : null);
    }
    const root = process.env.SystemRoot;
    const cmd = root ? root.replace(/[\\/]+$/, '') + '\\System32\\cmd.exe' : resolveOnPath('cmd', ['.com', '.exe']);
    const az = resolveOnPath('az', ['.com', '.exe', '.cmd']);
    if (cmd === null || /[\s"]/.test(cmd) || az === null || !CMD_RUNNABLE_PATH.test(az)) return null;
    return (words) => {
        if (!words.every((w) => AZ_WORD.test(w))) return null;
        const line = ['"' + az + '"'].concat(words.map((w) => (/[ =]/.test(w) ? '"' + w + '"' : w))).join(' ');
        return read(cmd, ['/d', '/s', '/c', '"' + line + '"'], { windowsVerbatimArguments: true });
    };
}

// How many entries a JSON list holds that `keep` keeps, or null where the
// text is not a JSON list.
function countIn(text, keep) {
    if (text === null) return null;
    try {
        const list = JSON.parse(text);
        return Array.isArray(list) ? list.filter(keep).length : null;
    } catch {
        return null;
    }
}

function github(at, branch, repoDir) {
    const gh = resolveOnPath('gh', WINDOWS ? ['.com', '.exe'] : ['']);
    if (gh === null) return unknown('gh is not on PATH');
    // The host is named, so no GH_HOST in the environment sends the read to
    // another one.
    const api = (...rest) => read(gh, ['api', '--hostname', 'github.com'].concat(rest));
    // gh fills `{owner}` and `{repo}` from the repository it resolves in its
    // working directory, a `gh repo set-default` choice or GH_REPO among them,
    // the same one `gh pr view` acts on there. So this one read runs in the
    // checkout, and a repository other than the address's reads `unknown`.
    // Its output is only compared, never passed to a tool, so it needs no
    // allowlist.
    const resolvedOut = read(gh, ['api', '--hostname', 'github.com', 'repos/{owner}/{repo}', '--jq', '.full_name'], { cwd: repoDir });
    if (resolvedOut === null) return unknown('the read of the repository gh resolves in ' + repoDir + ' failed');
    const resolved = resolvedOut.trim().toLowerCase();
    if (resolved !== (at.owner + '/' + at.repo).toLowerCase()) {
        return unknown('gh resolves another repository in ' + repoDir + ' than the one the remote\'s address names, so no protection was read');
    }
    const repo = 'repos/' + at.owner + '/' + at.repo;
    const flagOut = api(repo + '/branches/' + branch, '--jq', '.protected');
    const flag = flagOut === null ? null : flagOut.trim();
    if (flag === 'true') return answer('protected', 'GitHub flags ' + branch + ' as protected');
    const rules = countIn(api(repo + '/rules/branches/' + branch), () => true);
    if (rules !== null && rules > 0) return answer('protected', 'GitHub lists ' + rules + ' rule(s) on ' + branch);
    if (flag === 'false' && rules === 0) return answer('open', 'GitHub flags ' + branch + ' as not protected and lists no rule on it');
    if (flag === null) return unknown('the GitHub branch read failed: the host does not hold ' + branch + ', gh is not signed in, or the read ran past its bound');
    return unknown(rules === null ? 'the GitHub rules read failed or printed no list' : 'the GitHub branch read printed neither true nor false');
}

// How many enabled blocking policies an `az devops invoke` policy read lists,
// and whether the list is whole, or null where the text is not an object
// whose `value` is a list. The list is whole only where the
// `continuation_token` key is present and null: a token names a further page
// this script does not read, and an output without the key does not say.
function policiesIn(text) {
    if (text === null) return null;
    let out;
    try {
        out = JSON.parse(text);
    } catch {
        return null;
    }
    if (out === null || typeof out !== 'object' || !Array.isArray(out.value)) return null;
    return {
        blocking: out.value.filter((p) => p !== null && typeof p === 'object' && p.isEnabled === true && p.isBlocking === true).length,
        whole: Object.prototype.hasOwnProperty.call(out, 'continuation_token') && out.continuation_token === null
    };
}

// The Azure DevOps answer. The policy read asks, by the repository's id and
// the branch's full ref name, for every policy that applies to the branch. It
// carries no `--http-method` and no `--in-file`, so it is a GET.
function azure(at, branch, repoDir, remote) {
    const held = gitRun(repoDir, ['ls-remote', '--exit-code', '--heads', remote, 'refs/heads/' + branch], { timeoutMs: READ_TIMEOUT_MS });
    if (held === null) return unknown('git ls-remote did not run to its end');
    if (held.status !== 0 || !held.stdout.split(/\r?\n/).some((row) => row.split('\t')[1] === 'refs/heads/' + branch)) {
        return unknown('the remote does not hold ' + branch + ', or git ls-remote failed');
    }
    const az = azRunner();
    if (az === null) return unknown('az is not on PATH, or cannot be started from it');
    const organization = 'https://dev.azure.com/' + at.org;
    const idOut = az(['repos', 'show', '--organization', organization, '--project', at.project, '--repository', at.repo, '--query', 'id', '-o', 'tsv']);
    const id = idOut === null ? '' : idOut.trim();
    if (!AZURE_ID.test(id)) return unknown('az repos show failed or printed no repository id');
    const policies = policiesIn(az([
        'devops', 'invoke', '--organization', organization, '--area', 'git', '--resource', 'policyConfigurations',
        '--route-parameters', 'project=' + at.project,
        '--query-parameters', 'repositoryId=' + id, 'refName=refs/heads/' + branch,
        '--api-version', '7.1', '-o', 'json'
    ]));
    if (policies === null) return unknown('the Azure DevOps policy read failed or printed no list of policies');
    if (policies.blocking > 0) return answer('protected', 'Azure DevOps lists ' + policies.blocking + ' enabled blocking policy(ies) on ' + branch);
    if (!policies.whole) return unknown('the Azure DevOps policy read did not say its list is whole: its continuation_token is missing or names a further page');
    return answer('open', 'Azure DevOps holds ' + branch + ' and lists no enabled blocking policy on it');
}

function protection(args) {
    if (args.stray) return unknown('an argument could not be read; ' + USAGE);
    const branch = args.branch;
    // A segment of `.` or `..`, or an empty one, would name another path in a
    // host read's address, and no git branch holds one.
    if (!BRANCH_ALLOWLIST.test(branch) || branch.split('/').some((s) => s === '' || s === '.' || s === '..')) {
        return unknown('the branch name is outside the allowlist, so no host tool was started');
    }
    if (!BRANCH_ALLOWLIST.test(args.remote)) return unknown('the remote name is outside the allowlist, so no host tool was started');
    const repoDir = path.resolve(args.repo === null ? process.cwd() : args.repo);
    const address = gitRun(repoDir, ['remote', 'get-url', args.remote], { timeoutMs: READ_TIMEOUT_MS });
    if (address === null || address.status !== 0) return unknown('git remote get-url failed for the remote ' + args.remote);
    const pushed = gitRun(repoDir, ['remote', 'get-url', '--push', '--all', args.remote], { timeoutMs: READ_TIMEOUT_MS });
    if (pushed === null || pushed.status !== 0) return unknown('git remote get-url --push failed for the remote ' + args.remote);
    const pushAddresses = pushed.stdout.split(/\r?\n/).map((row) => row.trim()).filter((row) => row !== '');
    if (pushAddresses.length !== 1 || pushAddresses[0] !== address.stdout.trim()) {
        return unknown('the remote ' + args.remote + ' pushes to another address than the one it fetches from, or to several, so no host was read');
    }
    const at = parseAddress(address.stdout.trim());
    if (at === null) return unknown('the address of the remote ' + args.remote + ' is not a GitHub or Azure DevOps address this script reads, or carries a name outside its allowlist');
    return at.host === 'github' ? github(at, branch, repoDir) : azure(at, branch, repoDir, args.remote);
}

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    if (args.branch === undefined) {
        process.stderr.write('landing-protection: no --branch given; ' + USAGE + '\n');
        process.exitCode = 2;
    } else {
        let result;
        try {
            result = protection(args);
        } catch {
            result = unknown('the read failed on an error of its own');
        }
        process.stderr.write('landing-protection: ' + result.reason + '\n');
        process.stdout.write(result.word + '\n');
    }
}
