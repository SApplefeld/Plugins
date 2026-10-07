// The kit's client for the operator's local model endpoint: the config read,
// the POST transport, and the classification of what came back.
//
// It lives in the shipped plugin tree because shipped code and an unpackaged
// harness both need it. memq calls the whole client: the config read, the
// probe and the generate transport. scripts/memory-database.js and
// scripts/jev-client.js reuse its transport helpers (classifyThrow,
// discardBody, readBoundedBody, abortDelay, MAX_BODY_BYTES, hostIsLocal), and
// scripts/prompts/relevance-v1.js uses neutralize. The Jev battery under
// tools/jev-recognition-battery/ is run from the working clone and is not
// packaged; it reuses the same helpers. A require from memq into tools/ would
// resolve in a working clone and fail in every installed copy of the plugin.
// Extracting rather than duplicating keeps these callers from drifting apart
// on code that is dangerous to hold twice.
//
// WHERE THE DATA GOES. This module is the point at which content leaves this
// machine. Every request POSTs whatever its caller built to the endpoint named
// in `~/.claude/kit-endpoint.json`. That endpoint does not run on this VM: it
// runs on the Hyper-V host, reached across the virtual switch, over plain HTTP
// with no authentication in the fleet's default configuration, and it is shared
// with other tenants of that host including the operator's own agent harness.
// Nothing here redacts. Each caller's own header states what it sends.
//
// TWO WIRE PROTOCOLS, ONE REQUEST SHAPE. Callers build an Ollama-style
// generate request (`system`, `prompt`, `format`, `think`, `options`) and
// read an Ollama-style answer (`response`, `done_reason`). The config's `api`
// key names what the endpoint actually speaks: `ollama` posts that request as
// it stands to `/api/generate`; `openai` translates it to a chat-completions
// request for `/v1/chat/completions` (which llama-server and most other local
// servers serve) and translates the answer back, so no caller knows which
// server it is talking to. The translation is the whole of the difference,
// and it lives here so that no caller can drift from it.
//
// THE ADDRESS IS NOT IN THIS REPOSITORY, which is public. It exists only in
// that config file and in the operator's own memory tier, is read at run time,
// and lands in no comment, log line, record or test. What travels instead is a
// truncated hash of the host, enough to notice that the endpoint changed and
// far too little to be a copy of it.
//
// FOUR TRANSPORT OUTCOMES, NOT TWO. A caller's resilience policy differs by
// outcome, so this module never collapses them:
//
//   ok           the endpoint answered 2xx with a JSON body and no error key
//   timeout      the request outran its own clock; the lane is serial and has a
//                standing second tenant, so this is a queue, not a fault
//   unreachable  the connection itself failed; the runner may be restarting,
//                which is the one outcome that earns a retry
//   refused      the endpoint answered and said no: a non-2xx status, an error
//                body, or a body that could not be read
//
// The fifth outcome a caller acts on, `unusable`, is the caller's: whether an
// answer is a verdict, a list of record names or a ranking is a question about
// the schema that caller asked for, and this module never sees it.
//
// Nothing here throws on a bad config, and no transport failure throws either.
// A missing, unreadable, malformed or incomplete config all return a described
// refusal that the caller reports and stands down on. A stack trace out of a
// process that simply has no endpoint on its machine would be a false alarm
// dressed as a fault.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ------------------------------------------------------------------- text --

// Control characters (C0 and C1, DEL among them), the bidi controls, overrides
// and isolates (the arabic letter mark among them), the zero-width set, the
// invisible operators, the soft hyphen, the mongolian vowel separator, the
// hangul fillers, the variation selectors, the interlinear annotation
// controls, the byte-order mark, and the tag block, which is the invisible
// channel an instruction can be encoded into whole and recovered from intact.
// Everything else is left exactly as it came, because this is a guard on the
// channel and not a transliteration of the content.
//
// The class is built from a string of escapes rather than written as a literal
// character class, so this file stays plain text a line-printing sweep can
// read: a source file holding the raw bytes it screens for drops out of every
// grep the repository's hygiene passes run.
const UNSAFE_PATTERN = [
    '[',
    '\\u0000-\\u0008',
    '\\u000B-\\u000C',
    '\\u000E-\\u001F',
    '\\u007F-\\u009F',
    '\\u00AD',
    '\\u061C',
    '\\u180E',
    '\\u200B-\\u200F',
    '\\u202A-\\u202E',
    '\\u2060-\\u2064',
    '\\u2066-\\u206F',
    '\\u3164',
    '\\uFE00-\\uFE0F',
    '\\uFEFF',
    '\\uFFA0',
    '\\uFFF9-\\uFFFB',
    '\\u{E0000}-\\u{E007F}',
    ']'
].join('');

// The `u` flag is load-bearing, not style: the tag block sits in a
// supplementary plane, and a non-unicode character class cannot express a
// code point past U+FFFF at all, so without the flag the `\u{...}` range
// above would not mean what it says.
const UNSAFE_RE = new RegExp(UNSAFE_PATTERN, 'gu');

// Text safe to print or to record: whitespace collapsed, invisible and
// terminal-controlling characters removed, ends trimmed. A non-string is an
// empty string rather than a coerced one, since the callers pass values that
// arrived as JSON and may be anything at all.
//
// It sits here rather than in whichever consumer needed it first because a
// neutralizing guard is a property of the output channel, and the endpoint's
// own error strings travel that channel to a terminal, a log and a record.
function neutralize(text) {
    if (typeof text !== 'string') return '';
    return text.replace(UNSAFE_RE, '').replace(/\s+/g, ' ').trim();
}

// ----------------------------------------------------------------- config --

// The range a configured timeout is accepted in. Outside it the configured
// value is ignored and the caller's default stands, with a warning the caller
// reports: a typo in one optional key is no reason to stand a working endpoint
// down.
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

// How the config read opens its complaint about an unusable timeoutMs. A
// constant rather than a literal inside the sentence, because a caller that
// sets its own budgets has more to say about that key than this module does,
// and recognising the warning by a spelling copied into the caller is a drift
// the caller cannot see.
const TIMEOUT_WARNING_PREFIX = 'timeoutMs ignored';

// The wire protocols a config may name in its optional `api` key, and the
// generation path each one posts to. `ollama` is the default because every
// config written before the key existed meant it.
const API_FLAVORS = ['ollama', 'openai'];
const DEFAULT_API = 'ollama';
const GENERATE_PATHS = {
    ollama: '/api/generate',
    openai: '/v1/chat/completions'
};

// How the config read opens its complaint about an unusable `api`. Same
// reasoning as the timeout prefix: a caller recognises the warning by this
// constant, not by a spelling copied out of a sentence.
const API_WARNING_PREFIX = 'api ignored';

function generatePath(api) {
    return GENERATE_PATHS[api] || GENERATE_PATHS[DEFAULT_API];
}

// The characters of the host hash kept as the endpoint's fingerprint. Enough to
// tell one endpoint from another across a report line; far too little to be a
// reversible copy of the address.
const FINGERPRINT_CHARS = 8;

// A stable, non-identifying name for the endpoint that answered a call.
//
// What a reader needs is the ability to notice that today's answers came from
// somewhere other than yesterday's, and a truncated hash of the host
// answers exactly that question and no other. It is a change detector, not a
// secret: the space of plausible hosts is small enough to enumerate, so this is
// a fingerprint and never an authentication.
function hostFingerprint(host) {
    const text = typeof host === 'string' ? host : '';
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, FINGERPRINT_CHARS);
}

// Whether a host sits on this machine or on this machine's private network.
//
// Prevention is not on the table: anything running as this user can rewrite the
// config file, and an actor with write access to ~/.claude is already past every
// control here. Detection is, and it is what was missing. A host that is neither
// loopback nor RFC1918 means content is being posted to a public address, so a
// caller says so loudly rather than exporting in silence. Nothing refuses on it:
// the operator may have a private endpoint reached by a name this function
// cannot classify, and a component that refused to run would be worked around
// rather than heeded.
function hostIsLocal(host) {
    const name = (typeof host === 'string' ? host : '').toLowerCase().replace(/^\[|\]$/g, '');
    if (name === 'localhost' || name === '::1' || name === '0:0:0:0:0:0:0:1') return true;
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
    if (v4 === null) return false;
    // An octet carrying a leading zero is refused rather than parsed, because
    // this function and the resolver that dials the address read it
    // differently. `Number` reads decimal; getaddrinfo reads a leading-zero
    // component as octal, so 172.016.0.1 classifies private here and connects
    // to the public 172.14.0.1, and 010.1.2.3 classifies private and connects
    // to the public 8.1.2.3. A screen that disagrees with the dialer about
    // which host was named is worse than no screen, because it answers
    // confidently about an address nothing will contact. Refusing lands such a
    // host on the not-local side, which is the side that discloses.
    const parts = v4.slice(1);
    if (parts.some((p) => p.length > 1 && p[0] === '0')) return false;
    const octets = parts.map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n > 255)) return false;
    if (octets[0] === 127) return true;
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    return false;
}

function defaultConfigPath() {
    return path.join(os.homedir(), '.claude', 'kit-endpoint.json');
}

// The endpoint config, or a described refusal. Refusal reasons, all of which
// the caller reports and stands down on:
//
//   absent      no file at that path: no endpoint on this machine
//   unreadable  the file is there and could not be read (permissions, a
//               directory in its place)
//   malformed   not JSON, or JSON that is not an object
//   invalid     an object missing or mis-typing a key a caller needs
//
// A URL is required to be http or https because callers post to it. The scheme
// check is not security (the fleet's own endpoint is plain HTTP across the
// virtual switch to the Hyper-V host); it is a type check that catches a bare
// host name before it becomes a confusing fetch failure on every call.
//
// `defaultTimeoutMs` is the CALLER'S policy, not this module's, because how
// long a wait is reasonable is a property of what the caller is doing: a batch
// caller behind a serial contended lane waits minutes, and a CLI verb typed at
// a prompt waits a second or two. A caller that has no such policy passes
// nothing and gets `timeoutMs: null`, which says the config named no usable
// timeout rather than inventing one on its behalf.
function loadEndpointConfig(file, defaultTimeoutMs) {
    const target = (typeof file === 'string' && file !== '') ? file : defaultConfigPath();
    let raw = '';
    try {
        raw = fs.readFileSync(target, 'utf8');
    } catch (err) {
        const code = (err && typeof err.code === 'string') ? err.code : '';
        if (code === 'ENOENT') return { ok: false, reason: 'absent', path: target };
        return { ok: false, reason: 'unreadable', path: target, detail: code || 'read failed' };
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

    // Trailing slashes are stripped so the generation path appended to the url
    // never doubles one. A doubled slash is accepted by most servers and by no
    // rule.
    const url = typeof parsed.url === 'string' ? parsed.url.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\/[^\s/]+/.test(url)) {
        return { ok: false, reason: 'invalid', path: target, detail: 'url must be an http or https address' };
    }
    const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    if (model === '') {
        return { ok: false, reason: 'invalid', path: target, detail: 'model must be a non-empty string' };
    }

    const warnings = [];
    const fallback = Number.isFinite(defaultTimeoutMs) ? Math.round(defaultTimeoutMs) : null;
    let timeoutMs = fallback;
    if (parsed.timeoutMs !== undefined) {
        const wanted = typeof parsed.timeoutMs === 'number' ? parsed.timeoutMs : NaN;
        if (!Number.isFinite(wanted) || wanted < MIN_TIMEOUT_MS || wanted > MAX_TIMEOUT_MS) {
            warnings.push(`${TIMEOUT_WARNING_PREFIX}: expected a number between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
        } else {
            timeoutMs = Math.round(wanted);
        }
    }

    // An unknown `api` is ignored with a warning rather than refused, for the
    // reason a bad timeout is: the endpoint is still there, and the default
    // protocol is a better guess than no call at all.
    let api = DEFAULT_API;
    if (parsed.api !== undefined) {
        const wanted = typeof parsed.api === 'string' ? parsed.api.trim().toLowerCase() : '';
        if (API_FLAVORS.includes(wanted)) {
            api = wanted;
        } else {
            warnings.push(`${API_WARNING_PREFIX}: expected one of ${API_FLAVORS.join(', ')}`);
        }
    }

    // The host is parsed off the url rather than taken from a separate key, so
    // the fingerprint and the locality reading are both about the address the
    // caller will actually post to.
    let host = '';
    try {
        host = new URL(url).hostname;
    } catch {
        host = '';
    }

    return {
        ok: true,
        path: target,
        url,
        model,
        api,
        timeoutMs,
        warnings,
        endpointFingerprint: hostFingerprint(host),
        endpointIsLocal: hostIsLocal(host)
    };
}

// The disclosure a producer owes when the configured host is off this network.
//
// It lives here, beside the config read, because it is a property of the egress
// channel and not of whichever producer needed it first. The config file is
// rewritable by anything running as this user, so prevention is already lost
// and detection is the whole of the control: docs/security-model.md rests the
// acceptability of a rewritable endpoint config on this warning reaching a
// surface someone reads. A producer that computed `endpointIsLocal` and never
// read it would leave a redirected endpoint invisible on every surface at once,
// which is exactly what a guard written into one producer buys the next one.
//
// The caller supplies what travels, because that differs by producer and a
// sentence naming the wrong payload understates the export it exists to
// disclose. The address itself is never in the string; the fingerprint is what
// identifies an endpoint.
//
// Answers null for a local host, so a caller can emit unconditionally and a
// loopback endpoint stays quiet.
//
// The test is a positive statement of locality rather than a positive statement
// of remoteness, and the difference is which way the screen fails. Only a
// config that says in so many words that its host is local buys silence; a
// config reaching here without the key, because a caller built one by hand or a
// reader path stopped setting it, carries an unknown locality, and an unknown
// locality discloses. The two errors do not cost the same: a spurious warning
// is noise, and a missing one is this control absent from the one surface the
// security model rests it on.
function remoteEndpointWarning(config, whatTravels) {
    if (!config || config.endpointIsLocal === true) return null;
    return 'WARNING: the configured endpoint host is neither loopback nor a private'
        + ' network address, so ' + whatTravels + ' is being posted off this network'
        + ' in cleartext';
}

// -------------------------------------------------------------- transport --

// The most of a response body this module will hold. The endpoint is off this
// machine and shared with other tenants, so the size of what comes back is not
// a caller's to assume: an answer to a schema-constrained call is a few hundred
// bytes, and anything past this is not one. Reading it in bounded chunks is what
// keeps a wrong or hostile answer from being a memory fault in the process that
// is supposed to be watching for wrong answers.
const MAX_BODY_BYTES = 256 * 1024;

// How much of an endpoint-supplied error string reaches a record or a report.
const MAX_DETAIL_CHARS = 200;

// Sampling is deterministic. Two runs over the same input should differ because
// the input differed, not because the sampler did.
const TEMPERATURE = 0;

// The gap reason recorded for each transport outcome, in the words a report
// prints. One map, so the sentence in a report and the branch in a caller
// cannot drift apart.
//
// The `unusable` reason is deliberately NOT here. It names what the answer
// failed to be, which is a different sentence for a verdict, for a list of
// record names and for a ranking, so each caller states its own beside these
// three.
const GAP_REASONS = {
    timeout: 'lane busy',
    unreachable: 'endpoint down',
    refused: 'endpoint refused the call'
};

// The delay a request's abort timer is armed with.
//
// Every request carries a clock, so a caller that passes a non-finite or
// non-positive one gets this module's own configured floor rather than that
// value. `setTimeout` coerces null and NaN to zero and fires on the next tick,
// which would abort every request before it left, and a caller cannot see the
// difference between that and an endpoint that never answers. The floor is the
// same one a configured timeout is held to, so no number appears here that is
// not already this channel's.
function abortDelay(timeoutMs) {
    return (Number.isFinite(timeoutMs) && timeoutMs > 0) ? timeoutMs : MIN_TIMEOUT_MS;
}

// Error codes that mean the connection never carried a request, as opposed to
// one that was carried and outran its clock.
const CONNECTION_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN',
    'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED',
    'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'
]);

// Error codes from a connection that was made and then ran out of patience.
const SLOW_CODES = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

function errorCode(err) {
    let cursor = err;
    for (let depth = 0; depth < 4 && cursor !== null && typeof cursor === 'object'; depth += 1) {
        if (typeof cursor.code === 'string') return cursor.code;
        cursor = cursor.cause;
    }
    return '';
}

// A thrown fetch failure as one of the outcome names. An abort is the caller's
// own clock firing. Anything else that threw did so before a response existed,
// which is a connection failure however the runtime spelled it, so the default
// is `unreachable` rather than a fifth outcome nobody has a policy for.
//
// THE NO-CODE CASE NEVER USES `err.message`. A malformed `config.url` (a
// credential embedded in it, among other shapes) makes the runtime's own URL
// constructor throw a TypeError whose message spells the request URL back out
// in full, with no `.code` anywhere in its cause chain for the coded branches
// above to catch. `config.url` is loaded from `~/.claude/kit-endpoint.json`,
// and this module's header and docs/security-model.md both state that the
// endpoint address reaches no log line, record or report; this detail string is
// printed on memq's stderr, so a message carrying the address would break that
// promise. A fixed sentence is used instead, which loses only the fact that
// this specific shape of failure happened; the coded branches above still name
// every failure a caller can usefully act on.
function classifyThrow(err) {
    const name = (err && typeof err.name === 'string') ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
        return { status: 'timeout', detail: 'request exceeded its timeout' };
    }
    const code = errorCode(err);
    if (SLOW_CODES.has(code)) return { status: 'timeout', detail: code };
    if (CONNECTION_CODES.has(code)) return { status: 'unreachable', detail: code };
    return { status: 'unreachable', detail: code === '' ? 'connection failed before a response, no error code' : code };
}

// Release a response body nobody is going to read. A fetch response holds its
// socket until the body is consumed or cancelled, so a run of non-2xx answers
// left unread pins one connection each until the pool notices.
async function discardBody(res) {
    const body = res && res.body;
    if (body && typeof body.cancel === 'function') {
        try { await body.cancel(); } catch { /* the socket is what mattered */ }
    }
}

// The response body as an object, read under a byte bound. Returns the parsed
// body or a described refusal; never throws.
//
// The bound is applied on the stream where there is one, which is the path
// production takes: `fetch` gives a web ReadableStream and this reads it in
// chunks, stopping and cancelling the moment the total passes the cap rather
// than buffering whatever the endpoint decided to send. A response object with
// no stream is a test double, and its `json()` is used as it stands.
async function readBoundedBody(res) {
    if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const parts = [];
        let size = 0;
        try {
            for (;;) {
                const step = await reader.read();
                if (step.done) break;
                const part = Buffer.from(step.value);
                size += part.length;
                if (size > MAX_BODY_BYTES) {
                    try { await reader.cancel(); } catch { /* the bound is what mattered */ }
                    return { ok: false, detail: `response body past ${MAX_BODY_BYTES} bytes` };
                }
                parts.push(part);
            }
        } catch (err) {
            return { ok: false, throwed: err };
        }
        try {
            return { ok: true, body: JSON.parse(Buffer.concat(parts).toString('utf8')) };
        } catch {
            return { ok: false, detail: 'response body is not JSON' };
        }
    }
    try {
        return { ok: true, body: await res.json() };
    } catch (err) {
        return { ok: false, detail: 'response body is not JSON', throwed: err };
    }
}

// The caller's generate request as a chat-completions request.
//
// `system` and `prompt` become the two messages the chat template renders,
// which is what an Ollama server does with them internally. `format` as an
// object is a JSON schema and becomes a `json_schema` response format, so the
// answer stays grammar-constrained; the string `json` becomes `json_object`.
// `think` becomes the template's `enable_thinking` switch, sent only when the
// caller stated it, so a server default is left alone otherwise. Streaming is
// always off: this module reads whole bodies.
function toChatCompletionsRequest(request) {
    const src = (request !== null && typeof request === 'object') ? request : {};
    const messages = [];
    if (typeof src.system === 'string' && src.system !== '') {
        messages.push({ role: 'system', content: src.system });
    }
    messages.push({ role: 'user', content: typeof src.prompt === 'string' ? src.prompt : '' });
    const out = { model: src.model, messages, stream: false };
    const options = (src.options !== null && typeof src.options === 'object') ? src.options : {};
    if (Number.isFinite(options.temperature)) out.temperature = options.temperature;
    if (Number.isFinite(options.num_predict) && options.num_predict > 0) {
        out.max_tokens = Math.round(options.num_predict);
    }
    if (src.format !== null && typeof src.format === 'object') {
        out.response_format = { type: 'json_schema', json_schema: { name: 'answer', schema: src.format } };
    } else if (src.format === 'json') {
        out.response_format = { type: 'json_object' };
    }
    if (typeof src.think === 'boolean') out.chat_template_kwargs = { enable_thinking: src.think };
    return out;
}

// A chat-completions answer in the shape the callers read.
//
// The first choice's text is the `response`; a `length` finish reason is the
// one that callers act on (an answer cut off at the caller's own ceiling), so
// it is kept and every other reason reads as `stop`. An OpenAI-style error
// object collapses to the string `error` the transport already classifies. A
// body that is neither is handed back untouched: whether it is usable is the
// caller's question, as it is for any other answer.
function fromChatCompletionsResponse(body) {
    if (body === null || typeof body !== 'object') return body;
    if (body.error !== null && typeof body.error === 'object' && typeof body.error.message === 'string') {
        return { error: body.error.message };
    }
    const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
    if (choice === null || typeof choice !== 'object') return body;
    const message = (choice.message !== null && typeof choice.message === 'object') ? choice.message : {};
    return {
        model: body.model,
        response: typeof message.content === 'string' ? message.content : '',
        done: true,
        done_reason: choice.finish_reason === 'length' ? 'length' : 'stop'
    };
}

// POST one generation request. Exactly one attempt: the retry policy is the
// caller's, because whether a failure earns a retry depends on the run's
// history and not on this call. Never throws.
async function postGenerate(request, config, deps) {
    const fetchImpl = (deps && typeof deps.fetchImpl === 'function') ? deps.fetchImpl : fetch;
    const api = (config && API_FLAVORS.includes(config.api)) ? config.api : DEFAULT_API;
    const wire = api === 'openai' ? toChatCompletionsRequest(request) : request;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, abortDelay(config.timeoutMs));

    let res = null;
    try {
        res = await fetchImpl(`${config.url}${generatePath(api)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(wire),
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timer);
        return { ...classifyThrow(err), latencyMs: Date.now() - started };
    }

    try {
        if (!res || typeof res.status !== 'number') {
            return { status: 'refused', detail: 'no response object', latencyMs: Date.now() - started };
        }
        if (res.status < 200 || res.status >= 300) {
            await discardBody(res);
            // The path and the dialect ride in the detail because the status
            // alone cannot be placed: a 404 from a gateway that serves the
            // other dialect's generation path is a misconfiguration a reader
            // can act on, where the same 404 reported bare reads as an
            // endpoint that is down. A caller that probed first knows that
            // something answers at the address, which is what makes a bare
            // status unplaceable rather than a settled verdict; that is
            // memq's shape rather than every caller's, a caller making no
            // probe.
            //
            // The path is the one the request reached rather than the
            // dialect's own suffix, because a configured url may carry a path
            // of its own: the OpenAI convention is a base url ending in /v1,
            // which posts to /v1/v1/chat/completions, and a detail naming the
            // suffix alone would report that misconfiguration as a path that
            // reads correct, hiding the doubled prefix that is the fault. The
            // pathname alone is taken so the address stays unprinted, which is
            // the same reason the endpoint is fingerprinted elsewhere rather
            // than named. A url this module cannot parse is one the fetch
            // above already accepted, so the suffix fallback is unreachable on
            // any real call and exists for a caller that hands over both a
            // mock transport and an unparseable address.
            //
            // None of the three values takes the neutralizing an error string
            // off the wire does, and they earn that for different reasons: the
            // dialect is one of this module's own literals, the path is built
            // from that literal and the operator's own configured url, and the
            // status is the endpoint's own number held to a number by the
            // guard above that refuses a response whose status is not one.
            let postedPath = generatePath(api);
            try {
                postedPath = new URL(`${config.url}${postedPath}`).pathname;
            } catch {
                // The suffix stands, per the note above.
            }
            return {
                status: 'refused',
                detail: `HTTP ${res.status} from ${postedPath} (${api} dialect)`,
                latencyMs: Date.now() - started
            };
        }
        const read = await readBoundedBody(res);
        if (!read.ok) {
            // An abort while the body was being read is still the caller's own
            // clock, so it stays a timeout rather than becoming a refusal the
            // caller would spend a different policy on.
            if (read.throwed !== undefined) {
                const thrown = classifyThrow(read.throwed);
                if (thrown.status === 'timeout') return { ...thrown, latencyMs: Date.now() - started };
            }
            return { status: 'refused', detail: read.detail || 'response body could not be read', latencyMs: Date.now() - started };
        }
        const body = api === 'openai' ? fromChatCompletionsResponse(read.body) : read.body;
        if (body !== null && typeof body === 'object' && typeof body.error === 'string' && body.error !== '') {
            // The error text comes from an off-machine multi-tenant service and
            // reaches a report line unescaped, so it is neutralized before it
            // is anything but bytes.
            return { status: 'refused', detail: neutralize(body.error).slice(0, MAX_DETAIL_CHARS), latencyMs: Date.now() - started };
        }
        return { status: 'ok', body, latencyMs: Date.now() - started };
    } catch (err) {
        // Reading the body can abort too, and an abort here is still the
        // caller's own clock rather than a fault of the endpoint's.
        return { ...classifyThrow(err), latencyMs: Date.now() - started };
    } finally {
        clearTimeout(timer);
    }
}

// Is anything answering at the endpoint's address, asked under a short clock.
//
// It exists for the caller that cannot afford to find out by waiting for a
// generation: an interactive command whose whole budget is a second or two
// spends nearly all of it on a dead address otherwise, because a connection to
// a host that is up but serving nothing fails fast while one to a host that is
// gone hangs until the clock runs out. A batch caller has no use for it: a
// batch pass behind a serial lane learns the same fact from the generation it
// was going to make anyway.
//
// ANY answer is `ok`, including a non-2xx one. The question here is liveness,
// not correctness: something is listening and speaking HTTP. What the endpoint
// then makes of a real request is the generation call's answer to give, under
// its own classification, so a probe that pre-judged it would degrade a working
// endpoint on the strength of an unrelated status code. The body is discarded
// rather than read, since nothing here reads it and an unread body pins a
// socket.
async function probeEndpoint(config, deps) {
    const fetchImpl = (deps && typeof deps.fetchImpl === 'function') ? deps.fetchImpl : fetch;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, abortDelay(config.timeoutMs));
    try {
        const res = await fetchImpl(config.url, { method: 'GET', signal: controller.signal });
        if (!res || typeof res.status !== 'number') {
            return { status: 'refused', detail: 'no response object', latencyMs: Date.now() - started };
        }
        await discardBody(res);
        return { status: 'ok', httpStatus: res.status, latencyMs: Date.now() - started };
    } catch (err) {
        return { ...classifyThrow(err), latencyMs: Date.now() - started };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    UNSAFE_PATTERN,
    neutralize,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    FINGERPRINT_CHARS,
    hostFingerprint,
    hostIsLocal,
    defaultConfigPath,
    loadEndpointConfig,
    remoteEndpointWarning,
    TIMEOUT_WARNING_PREFIX,
    API_FLAVORS,
    DEFAULT_API,
    API_WARNING_PREFIX,
    generatePath,
    toChatCompletionsRequest,
    fromChatCompletionsResponse,
    MAX_BODY_BYTES,
    MAX_DETAIL_CHARS,
    TEMPERATURE,
    GAP_REASONS,
    CONNECTION_CODES,
    SLOW_CODES,
    abortDelay,
    errorCode,
    classifyThrow,
    discardBody,
    readBoundedBody,
    postGenerate,
    probeEndpoint
};
