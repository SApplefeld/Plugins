// The kit's client for TypeSafe's Jev model: the config read, the key read,
// one POST to the evaluation endpoint, and the classification of what came
// back. Every Jev use in the kit goes through this module, so there is one
// place that holds a secret and one guarantee about where it does not go.
//
// WHERE THE DATA GOES. A call POSTs its `state` and `questions`, with the model
// name from the config, to the endpoint named in `~/.claude/kit-jev.json`.
// That endpoint is the vendor's, off this LAN, reached over TLS, or a loopback
// stand-in. The config file's presence is the machine's only switch. Nothing
// here gathers content: a caller builds the state and the questions and owns
// what they contain.
//
// THE SCREEN. Every body is matched against the closed list of credential
// shapes in `CREDENTIAL_SHAPES` before the key is read, and a body carrying
// any of them is refused as `screened`, with a detail naming the shape's class
// and never the match or where it sat. The screen is the one thing this module
// reads in a body. It lives here rather than in a caller because this client
// is the channel every Jev caller shares, so a screen in one caller would be
// missing from the next.
//
// THE KEY. `TYPESAFE_API_KEY` is read from the environment inside the call,
// after the config read has succeeded, and lives in a local of that call. It
// is held in no module-level variable, and it reaches no returned object,
// thrown error or written line. No refusal here is built from a runtime
// error's own message, because a malformed endpoint makes the runtime's URL
// and request constructors throw a TypeError whose message spells the request
// back out, headers included. Each refusal's `detail` is one of this module's
// own literals.
//
// THE KEY TRAVELS ONLY OVER TLS. The config read refuses an endpoint that is
// not `https`, with one exception: a loopback host, which is what the tests'
// stand-in server and a local Jev-shaped server are. Loopback is `localhost`,
// `127.0.0.0/8` and `::1`, and nothing else. A private-range address is another
// machine on the network and is refused in cleartext. The test is
// kit-endpoint-lib.js's `hostIsLocal` narrowed to loopback, so the two share
// one octet parse and one leading-zero refusal. It is applied to the host the
// URL parser hands `fetch`, which is the host the request dials.
//
// NINE REASONS, NEVER A THROW. A call resolves to the answers or to one reason
// from a closed set, so a caller reports a call that could not be made as not
// checked rather than as clean:
//
//   not configured   no config file on this machine
//   config unusable  the config file is there and cannot be used
//   screened         the body carries a credential shape, so it was not sent
//   no key           the config is usable and the environment holds no key
//   timeout          the caller's deadline passed with a request in flight
//   unreachable      the connection, the name lookup or TLS failed
//   refused          the endpoint answered with a status outside the 200s
//                    that earns no retry, a redirect among them
//   busy             the endpoint answered 429 or 529 and the caller's retry
//                    policy is spent or cannot fit before the deadline
//   unusable answer  the endpoint answered 2xx with a body that is not the
//                    answer the caller asked for
//
// The one synchronous throw is a missing, non-numeric or out-of-range time
// limit, a programming error in the caller rather than a state of the machine
// or the endpoint. A state or question set that JSON cannot serialize, a
// circular object or a BigInt among them, is a caller programming error too:
// it rejects the returned promise rather than resolving to a reason.
//
// THE LINE BETWEEN THIS MODULE AND ITS CALLERS. The time limit, the retry
// policy and any meaning read into a score are the caller's. This module holds
// no default time limit, no fetch limit and no score floor, so one client
// serves a judge that needs an answer inside 1,500 milliseconds and a promises
// check that can wait thirty seconds.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const endpointLib = require('./kit-endpoint-lib.js');

// The vendor's evaluation path, appended to the configured endpoint.
const SYSTEMONE_PATH = '/v1/systemone';

// The statuses the vendor documents as transient, and the only two a retry
// policy is spent on.
const RETRY_STATUSES = new Set([429, 529]);

// ----------------------------------------------------------------- config --

function configPath() {
    return path.join(os.homedir(), '.claude', 'kit-jev.json');
}

// The host roughly as the operator wrote it in the endpoint, brackets and
// all, or an empty string where the text carries no authority. The URL parser
// rewrites an IPv4 address with a leading-zero octet to its octal reading
// before it reaches `hostname` (`127.01.0.1` parses as `127.1.0.1`), so the
// config read also refuses a written host that is not loopback. This reading
// only ever narrows: the parsed host must pass on its own, so a text the
// pattern misreads can refuse an endpoint and can never admit one.
function writtenHost(endpoint) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(endpoint);
    return m === null ? '' : m[1];
}

// Whether a host is this machine and nothing else: `localhost`, an address in
// 127.0.0.0/8, or `::1` in either spelling. `hostIsLocal` decides first, so an
// IPv4 octet carrying a leading zero is refused for the reason it states, and
// its private ranges are then dropped: a private-range address is another
// machine, and a key sent to it in cleartext crosses the network.
function hostIsLoopback(host) {
    const name = (typeof host === 'string' ? host : '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!endpointLib.hostIsLocal(name)) return false;
    return name === 'localhost' || name === '::1' || name === '0:0:0:0:0:0:0:1' || name.startsWith('127.');
}

// The Jev config, or a described refusal. Refusal reasons, all of which the
// caller reports and stands down on:
//
//   absent      no file at that path: no Jev on this machine
//   unreadable  the file is there and could not be read (permissions, a
//               directory in its place)
//   malformed   not JSON, or JSON that is not an object
//   invalid     an object missing or mis-typing `endpoint` or `model`, or an
//               endpoint that is neither https nor on a loopback host
//
// The path is fixed under `os.homedir()`, read at each call. No parameter,
// flag or kit variable relocates it, since a relocatable config is a way for
// a repository's own environment to name the host the key is sent to. `HOME`
// and `USERPROFILE` do relocate it, as they relocate every path under the
// home directory, under the ungated residual `docs/security-model.md`
// states. The file never holds the key.
function loadJevConfig() {
    const target = configPath();
    let raw = '';
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        const code = (err && typeof err.code === 'string') ? err.code : '';
        if (code === 'ENOENT') return { ok: false, reason: 'absent', path: target };
        return { ok: false, reason: 'unreadable', path: target, detail: 'read failed' };
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

    // Trailing slashes are stripped so the evaluation path appended to the
    // endpoint never doubles one.
    const endpoint = typeof parsed.endpoint === 'string' ? parsed.endpoint.trim().replace(/\/+$/, '') : '';
    if (endpoint === '') {
        return { ok: false, reason: 'invalid', path: target, detail: 'endpoint must be a non-empty string' };
    }
    let url = null;
    try {
        url = new URL(endpoint);
    } catch {
        return { ok: false, reason: 'invalid', path: target, detail: 'endpoint does not parse as a URL' };
    }
    const loopback = hostIsLoopback(url.hostname) && hostIsLoopback(writtenHost(endpoint));
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
        return { ok: false, reason: 'invalid', path: target, detail: 'endpoint must be https unless its host is loopback' };
    }
    const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    if (model === '') {
        return { ok: false, reason: 'invalid', path: target, detail: 'model must be a non-empty string' };
    }

    return { ok: true, path: target, endpoint, model };
}

// ----------------------------------------------------------------- screen --

// The credential shapes no body may carry, each with the label its refusal
// names. The match runs over the serialized body, so a shape in the state, in
// a question or in the model name is caught alike, and a double quote inside
// the state reaches the pattern as `\"`, which the assignment shape allows
// for. The list is closed: a shape not here is not screened, and a caller
// that gathers content owns what else it keeps out. A label is this module's
// own literal, never built from the match, since a detail that quoted the
// match would print the secret the screen exists to keep.

// The assignment of a quoted literal of eight or more units, as it follows a
// credential name in the serialized body: an optional closing quote on the
// name, `=` or `:`, and the literal, opened and closed by a double quote, a
// single quote or a backtick. The literal runs to the quote that opened it,
// so an apostrophe inside a double-quoted literal is a character of it, and
// an escaped pair such as the serialized tab `\t` counts as one unit rather
// than ending the literal. An escaped quote of the opening kind is the one
// pair that ends it, so a literal carrying one inside its first eight units
// ends early and is not screened. Both credential-assignment rows end in it.
// The backslash before the backtick keeps it out of the template's own
// syntax; the regex reads it as the plain character.
const QUOTED_LITERAL = String.raw`\\?["']?\s*[:=]\s*\\?(["'\`])(?:(?!\\?\1)(?:[^\\]|\\.)){8,}\\?\1`;

const CREDENTIAL_SHAPES = [
    // The key's own variable assigned a value of eight or more characters,
    // with `=` or `:` and optional quotes between. The bare name is not the
    // shape, since the kit's own Jev scripts name the variable in their text,
    // and a value starting with `=` is a comparison rather than an assignment.
    ['the key variable assigned', /TYPESAFE_API_KEY\\?["']?\s*[:=]\s*\\?["']?(?!=)[^\s"'\\]{8,}/],
    ['bearer token', /Bearer [A-Za-z0-9_.~+/=-]{16,}/],
    // No letter or digit directly before `sk-`, so a longer word such as
    // `risk-assessment-report-2026` is not the shape.
    ['sk- prefixed key', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/],
    // A prefix and twenty or more token characters. The prefix alone is not
    // the shape, since this module's own text spells the prefixes out.
    ['GitHub token', /(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/],
    ['Slack token', /xox[baprs]-/],
    ['AWS access key id', /AKIA[A-Z0-9]{16}/],
    ['private key block', /-----BEGIN[A-Z ]*PRIVATE KEY-----/],
    // A credential name assigned a quoted literal of eight or more units: in
    // source (`password = "..."`), in YAML (`token: '...'`) or as a JSON
    // member (`"secret": "..."`). Two rows share the label. The first takes
    // the name in any case with no letter or digit directly before it, so
    // `db_password`, `db-password` and `"password"` are the shape. The second
    // takes the name capitalized directly after a lower-case letter, as
    // camelCase writes it, so `clientSecret`, `accessToken` and `dbPassword`
    // are the shape too. A continuation of the name, such as `tokens` or
    // `passwordHash`, is neither.
    ['credential assignment', new RegExp(String.raw`(?<![A-Za-z0-9])(?:password|passwd|secret_key|secretkey|secret|api_key|apikey|token)` + QUOTED_LITERAL, 'i')],
    ['credential assignment', new RegExp(String.raw`(?<=[a-z])(?:Password|Passwd|SecretKey|Secret|ApiKey|Token)` + QUOTED_LITERAL)],
    // A connection string's password field: the name `Password`, then `=`,
    // then a value of eight or more characters with no `;`, whitespace, quote
    // or backslash, in any case and behind the same left boundary. Any other
    // YAML or dotenv value assigned without quotes is not a shape here: a
    // `.env` file is refused by name in the gatherer instead.
    ['connection-string password', /(?<![A-Za-z0-9])password=[^;\s"'\\]{8,}/i]
];

// The label of the first shape the body carries, or null for a clean body.
function screenedShape(body) {
    for (const [label, shape] of CREDENTIAL_SHAPES) {
        if (shape.test(body)) return label;
    }
    return null;
}

// -------------------------------------------------------------- transport --

function refusal(reason, detail) {
    return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

// A thrown fetch failure as one of the reasons. The sibling's classifier
// already separates the caller's own clock from a connection that never
// carried the request, and everything it does not name is a connection
// failure however the runtime spelled it. Only its status is read: its detail
// can carry a runtime error code, and this module's refusals carry their own
// literals alone.
function reasonForThrow(err) {
    return endpointLib.classifyThrow(err).status === 'timeout' ? 'timeout' : 'unreachable';
}

// Whether the caller asked anything: a question set that is a plain object,
// not an array, with at least one id. `run` decides this before the key is
// read, so a call with nothing to ask opens no socket and never resolves as an
// empty answer set.
function asksSomething(questions) {
    return questions !== null && typeof questions === 'object' && !Array.isArray(questions) && Object.keys(questions).length > 0;
}

// The client's reason for a config read that failed: `absent` is
// `not configured`, and the other three reasons are `config unusable`. The
// promises check reads the config once for its header and names the same
// refusal, so the mapping is exported rather than copied.
function configRefusalReason(config) {
    return config.reason === 'absent' ? 'not configured' : 'config unusable';
}

// The response body as the answers the caller asked for, read field by field.
// A body that is not an object, an `answers` that is not an object, an asked
// id with no answer object, or a `noul` question whose answer carries no
// number from 0 to 1 is `unusable answer`, so a caller never averages a value
// that is not a score. A `noul` answer is returned as `{ noul }` built from the
// validated number, so nothing else the vendor put on the answer object rides
// through. `usage.input_tokens` is read as `inputTokens` where it is a
// non-negative integer, and 0 otherwise.
function readAnswers(body, questions) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return refusal('unusable answer', 'response is not a JSON object');
    }
    const answers = body.answers;
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
        return refusal('unusable answer', 'response carries no answers object');
    }
    const out = {};
    for (const id of Object.keys(questions)) {
        const answer = Object.hasOwn(answers, id) ? answers[id] : undefined;
        if (answer === null || typeof answer !== 'object') {
            return refusal('unusable answer', 'an asked question has no answer');
        }
        const question = questions[id];
        if (question !== null && typeof question === 'object' && question.type === 'noul') {
            const p = answer.noul;
            if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
                return refusal('unusable answer', 'a noul answer is not a number from 0 to 1');
            }
            out[id] = { noul: p };
        } else {
            out[id] = answer;
        }
    }
    const usage = body.usage;
    const count = (usage !== null && typeof usage === 'object') ? usage.input_tokens : undefined;
    const inputTokens = (Number.isInteger(count) && count >= 0) ? count : 0;
    return { ok: true, answers: out, inputTokens };
}

// One request under the remaining time. Resolves to `{ retry: true }` for a
// status the caller's policy may retry, and to `{ result }` for everything
// else. Never throws.
//
// The request follows no redirect, so a 3xx is a refusal rather than a second
// request to a host the config never named. A non-2xx body is discarded
// unread, since a fetch response holds its socket until the body is consumed
// or cancelled. A 2xx body is read under the sibling's byte bound. A body read
// that throws takes the classification a thrown fetch takes: an abort is the
// caller's own clock, and a connection that dropped mid-body is `unreachable`,
// since the endpoint's answer never arrived rather than arriving unusable.
// A body that arrived whole and is not JSON, an empty one included, is the
// unusable one.
async function sendOnce(config, key, body, questions, remainingMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, Math.max(0, remainingMs));

    let res = null;
    try {
        res = await fetch(`${config.endpoint}${SYSTEMONE_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body,
            signal: controller.signal,
            redirect: 'manual'
        });
    } catch (err) {
        clearTimeout(timer);
        return { result: refusal(reasonForThrow(err)) };
    }

    try {
        if (RETRY_STATUSES.has(res.status)) {
            await endpointLib.discardBody(res);
            return { retry: true };
        }
        if (res.status < 200 || res.status >= 300) {
            await endpointLib.discardBody(res);
            return { result: refusal('refused', `HTTP ${res.status}`) };
        }
        const read = await endpointLib.readBoundedBody(res);
        if (!read.ok) {
            // The sibling describes a body it read and could not use in
            // `detail`, and a read that failed partway with `throwed` alone.
            if (read.detail === undefined) return { result: refusal(reasonForThrow(read.throwed)) };
            return { result: refusal('unusable answer', 'response body is not JSON under the size cap') };
        }
        return { result: readAnswers(read.body, questions) };
    } catch (err) {
        return { result: refusal(reasonForThrow(err)) };
    } finally {
        clearTimeout(timer);
    }
}

function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function run(state, questions, timeoutMs, retryDelaysMs) {
    const config = loadJevConfig();
    if (!config.ok) {
        const reason = configRefusalReason(config);
        return reason === 'not configured' ? refusal(reason) : refusal(reason, `config ${config.reason}`);
    }

    // A call with nothing to ask is refused before the key is read, so it
    // opens no socket and is never an empty success.
    if (!asksSomething(questions)) return refusal('unusable answer', 'no question was asked');

    // The body is serialized and screened ahead of the key read, so a body
    // carrying a credential shape opens no socket and never reads the key.
    const body = JSON.stringify({ state, model: config.model, questions });
    const shape = screenedShape(body);
    if (shape !== null) return refusal('screened', shape);

    // The key is read here, after the config read, so a machine with neither
    // reads `not configured`. It lives in this local and nowhere else.
    const key = (typeof process.env.TYPESAFE_API_KEY === 'string') ? process.env.TYPESAFE_API_KEY.trim() : '';
    if (key === '') return refusal('no key');

    const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs : [];
    const deadline = Date.now() + timeoutMs;

    // One deadline over the whole call. Each request is armed with what
    // remains of it, and a retry whose delay would pass it is not started.
    let sent = await sendOnce(config, key, body, questions, deadline - Date.now());
    for (let attempt = 0; sent.retry === true; attempt += 1) {
        if (attempt >= delays.length) return refusal('busy', 'retry policy spent');
        const delay = (Number.isFinite(delays[attempt]) && delays[attempt] > 0) ? delays[attempt] : 0;
        if (Date.now() + delay >= deadline) return refusal('busy', 'retry would pass the deadline');
        await sleep(delay);
        const remaining = deadline - Date.now();
        if (remaining <= 0) return refusal('busy', 'retry would pass the deadline');
        sent = await sendOnce(config, key, body, questions, remaining);
    }
    return sent.result;
}

// Ask Jev the questions about the state. Resolves to
// `{ ok: true, answers, inputTokens }` or `{ ok: false, reason, detail? }`
// with `reason` one of the nine above. `timeoutMs` is the one deadline over the whole
// call, retries and their delays included. `retryDelaysMs` is a list of
// delays whose length is the retry count; omitted or empty means no retry, and
// only a 429 or 529 is retried.
//
// The time limit is checked synchronously, so a caller that forgot it fails at
// the call site rather than as a rejection somewhere down an await chain.
function askJev(state, questions, timeoutMs, retryDelaysMs) {
    // Past 2147483647 a timer fires at once, so a larger limit would read as an
    // instant `timeout` rather than as the caller's error.
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
        throw new TypeError('askJev: timeoutMs must be a positive number of milliseconds up to 2147483647');
    }
    return run(state, questions, timeoutMs, retryDelaysMs);
}

module.exports = {
    loadJevConfig,
    configRefusalReason,
    askJev
};
