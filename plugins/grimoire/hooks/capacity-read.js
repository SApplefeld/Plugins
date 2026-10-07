#!/usr/bin/env node
// The pre-dispatch capacity reading: one line saying whether a fable-tier
// dispatch should go ahead, be downgraded, or be left to finishing-work's
// never-started ladder, read from claude-swap's own cache.
//
// claude-swap (the account rotator) polls the usage endpoint on its own cadence
// and writes what it measured under ~/.claude-swap-backup. This CLI reads
// exactly two files there, sequence.json for the active account number and
// cache/usage.json for that account's measured windows, and nothing else: the
// credentials directory sits beside the cache holding plaintext OAuth material,
// and the cache itself carries account emails and organization identifiers. It
// writes nothing, opens no network connection, and takes no arguments or
// configuration. Both files are re-read on every run and nothing is memoized,
// because the rotator can move the active seat as often as once a minute.
//
// Both reads go through readFileBounded in kit-read-lib.js at a 1 MB ceiling.
// A null from that boundary (an absent path, a path that is not a regular file,
// an unreadable file) is the no-reading `absent file`. A result bounded by the
// ceiling is `over cap`, and one bounded by a short fill is `unparseable`. All
// are decided before any parse, so no partial text is ever parsed.
//
// The verdict takes the worst of three windows, the active account's scoped
// Fable window and its general five-hour and seven-day windows, since a fable
// dispatch spends all three. It downgrades only at a genuine 100 percent: the
// rotator switches seats at 95 percent, so a reading below 100 on the active
// seat means it is still balancing, and a lower floor would strand the last
// percent of every seat. A recent 429 or a backoff below the floor is the
// transient the rotator's autoswitch clears, so it rides on the dispatch line
// as context and never triggers a downgrade.
//
// Output is one line on stdout in exactly one of three shapes:
//
//   fable capacity: scoped N%, 7d N%, 5h N% (account <n>, fetched <age>s ago) -> dispatch
//   fable capacity: scoped N%, 7d N%, 5h N% (account <n>, fetched <age>s ago) -> downgrade
//   fable capacity: no reading (<reason>) -> ladder governs
//
// The dispatch line may carry `; recent 429` and `; in backoff` before its
// arrow. Every field the line prints passes through redactField, which admits
// only a finite number or a member of this file's fixed vocabulary, so no
// email, organization identifier, claim identifier, path or other string from
// either file can reach the output. The exit code is 0 for all three shapes:
// the verdict is the text, and a caller branching on the exit code would fold
// the no-reading case into one of the other two.
//
// Never throws.

'use strict';

const os = require('os');
const path = require('path');
const { readFileBounded } = require('./kit-read-lib.js');
const { namesNetworkShare } = require('./kit-network-lib.js');

// The downgrade floor, in percent of a window consumed.
const FLOOR_PCT = 100;

// The byte ceiling each of the two files is read under.
const READ_CEILING_BYTES = 1024 * 1024;

// Staleness bounds. A reading fetched longer ago than this many of the
// account's own poll intervals is stale; absent a usable interval, the fixed
// fallback applies. fetchedAt, last429At and backoffUntil are epoch seconds,
// as claude-swap writes them from time.time(). A fetchedAt further ahead of
// this clock than the lead tolerance is stale too, since a reading stamped in
// the future would otherwise never age.
const STALE_POLL_INTERVALS = 3;
const STALE_FALLBACK_MS = 30 * 60 * 1000;
const CLOCK_LEAD_MS = 5 * 60 * 1000;

// How long a 429 stays "recent" for the context suffix.
const RECENT_429_MS = 60 * 60 * 1000;

// The no-reading reasons, closed at six. The output prints nothing else in
// that slot.
const NO_READING_REASONS = Object.freeze([
    'absent file', 'over cap', 'unparseable', 'unknown account', 'missing window', 'stale'
]);

// The context suffixes the dispatch line may carry.
const CONTEXT_SUFFIXES = Object.freeze(['recent 429', 'in backoff']);

// One field of the output line, as the only text that field may print: a
// finite number floored to an integer, or a member of the named vocabulary.
// Anything else prints as '?'. Flooring keeps a displayed 100% equivalent to a
// reading at the floor, so a line never shows 100% beside `-> dispatch`.
function redactField(value, kind) {
    if (kind === 'number') {
        return (typeof value === 'number' && Number.isFinite(value)) ? String(Math.floor(value)) : '?';
    }
    if (kind === 'reason') return NO_READING_REASONS.includes(value) ? value : '?';
    if (kind === 'context') return CONTEXT_SUFFIXES.includes(value) ? value : '?';
    return '?';
}

// The output line for a verdict. `field` renders each field and defaults to
// redactField; it is a parameter so the privacy pin's control can render the
// same verdict with the redaction bypassed and watch its own assertion fail.
//
// A verdict is { kind: 'no reading', reason } or { kind: 'dispatch' |
// 'downgrade', scoped, sevenDay, fiveHour, account, ageS, context }, where
// context is a list of CONTEXT_SUFFIXES members and is printed on the dispatch
// line only: a downgrade is caused by the window at the floor, never by a 429.
function formatVerdict(verdict, field) {
    const f = field || redactField;
    if (verdict.kind === 'no reading') {
        return 'fable capacity: no reading (' + f(verdict.reason, 'reason') + ') -> ladder governs';
    }
    const reading = 'fable capacity: scoped ' + f(verdict.scoped, 'number') + '%, 7d '
        + f(verdict.sevenDay, 'number') + '%, 5h ' + f(verdict.fiveHour, 'number') + '% (account '
        + f(verdict.account, 'number') + ', fetched ' + f(verdict.ageS, 'number') + 's ago)';
    if (verdict.kind === 'downgrade') return reading + ' -> downgrade';
    const context = (verdict.context || []).map((c) => '; ' + f(c, 'context')).join('');
    return reading + context + ' -> dispatch';
}

function noReading(reason) {
    return { kind: 'no reading', reason };
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// One of the two files, parsed, or the no-reading reason it answers with.
function readJson(filePath) {
    const read = readFileBounded(filePath, READ_CEILING_BYTES);
    if (read === null) return { reason: 'absent file' };
    // Only the ceiling means the file is oversized; a short fill is a file
    // rewritten under the read, whose partial text is unparseable.
    if (read.bounded) return { reason: read.boundedBy === 'ceiling' ? 'over cap' : 'unparseable' };
    let parsed;
    try {
        parsed = JSON.parse(read.text);
    } catch {
        return { reason: 'unparseable' };
    }
    if (!isObject(parsed)) return { reason: 'unparseable' };
    return { value: parsed };
}

// The window's pct when it is a finite number, else null.
function windowPct(window) {
    return (isObject(window) && finite(window.pct)) ? window.pct : null;
}

// The verdict for the cache under `homeDir` at `nowMs`.
//
// A home directory that is unknown, or that names a network share, reads as
// `absent file`: opening a share makes this machine authenticate outbound and
// blocks for the connection's timeout, which is the rule kit-network-lib.js
// states for every path the kit opens.
function readCapacity(homeDir, nowMs) {
    if (typeof homeDir !== 'string' || homeDir === '' || namesNetworkShare(homeDir)) {
        return noReading('absent file');
    }
    const root = path.join(homeDir, '.claude-swap-backup');

    const sequence = readJson(path.join(root, 'sequence.json'));
    if (sequence.reason) return noReading(sequence.reason);
    const usage = readJson(path.join(root, 'cache', 'usage.json'));
    if (usage.reason) return noReading(usage.reason);

    // usage.json keys its accounts by the account number as text.
    const accountNumber = sequence.value.activeAccountNumber;
    if (!Number.isInteger(accountNumber) || accountNumber < 0) return noReading('unknown account');
    const accounts = usage.value.accounts;
    const account = isObject(accounts) && Object.prototype.hasOwnProperty.call(accounts, String(accountNumber))
        ? accounts[String(accountNumber)] : null;
    if (!isObject(account)) return noReading('unknown account');

    const lastGood = isObject(account.lastGood) ? account.lastGood : {};
    const fiveHour = windowPct(lastGood.five_hour);
    const sevenDay = windowPct(lastGood.seven_day);
    const fableEntry = Array.isArray(lastGood.scoped)
        ? lastGood.scoped.find((s) => isObject(s) && typeof s.name === 'string' && s.name.toLowerCase() === 'fable')
        : undefined;
    const scoped = windowPct(fableEntry);
    if (fiveHour === null || sevenDay === null || scoped === null) return noReading('missing window');

    // The reading's age is the active account's own fetchedAt, epoch seconds
    // as claude-swap writes it on every successful poll. claude-swap keeps
    // polling an exhausted account, so fetchedAt stays fresh exactly when the
    // downgrade matters, and it goes stale on its own when claude-swap stops.
    // sequence.json's lastUpdated is not an age: claude-swap writes it only on
    // a seat switch or an admin operation, so it sits still through every
    // quiet stretch, healthy or exhausted. A fetchedAt that does not read as a
    // number leaves the reading's age unknown, which is stale rather than fresh.
    if (!finite(account.fetchedAt)) return noReading('stale');
    const ageMs = nowMs - account.fetchedAt * 1000;
    const staleAfterMs = (finite(account.pollIntervalS) && account.pollIntervalS > 0)
        ? STALE_POLL_INTERVALS * account.pollIntervalS * 1000 : STALE_FALLBACK_MS;
    if (ageMs > staleAfterMs || ageMs < -CLOCK_LEAD_MS) return noReading('stale');

    const reading = {
        scoped, sevenDay, fiveHour, account: accountNumber, ageS: Math.max(0, ageMs) / 1000
    };
    if (Math.max(scoped, sevenDay, fiveHour) >= FLOOR_PCT) return { kind: 'downgrade', ...reading };
    const context = [];
    if (finite(account.last429At) && nowMs - account.last429At * 1000 <= RECENT_429_MS) context.push('recent 429');
    if (finite(account.backoffUntil) && account.backoffUntil * 1000 > nowMs) context.push('in backoff');
    return { kind: 'dispatch', ...reading, context };
}

function main() {
    // A caller that closes the pipe early must not turn the write into an
    // unhandled error and a non-zero exit.
    process.stdout.on('error', () => {});
    let home;
    try { home = os.homedir(); } catch { home = ''; }
    process.stdout.write(formatVerdict(readCapacity(home, Date.now())) + '\n');
    process.exitCode = 0;
}

if (require.main === module) main();

module.exports = { formatVerdict };
