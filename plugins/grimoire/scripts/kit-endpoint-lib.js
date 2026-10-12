// The kit's shared host-classification and bounded-body helpers for the HTTP
// calls its scripts make: text neutralizing, the locality reading, the abort
// clock's floor, the classification of a thrown
// fetch, and the bounded read and release of a response body. It makes no
// request of its own and reads no config.
//
// It lives in the shipped plugin tree because shipped code and an unpackaged
// harness both need it. scripts/memory-database.js takes classifyThrow,
// discardBody, readBoundedBody, abortDelay and MAX_BODY_BYTES, and
// scripts/jev-client.js takes classifyThrow, discardBody, readBoundedBody and
// hostIsLocal. The Jev battery under
// tools/jev-recognition-battery/ is run from the working clone and is not
// packaged; it takes jev-client.js's helpers and neutralize. Extracting rather than
// duplicating keeps these callers from drifting apart on code that is
// dangerous to hold twice.
//
// A THROWN FETCH IS ONE OF TWO OUTCOMES. classifyThrow answers `timeout` when
// the request outran its own clock and `unreachable` when the connection
// itself failed, because a caller's resilience policy differs between them.
// A caller holding a response names its own refusal for a non-2xx status, an
// error body, or a body readBoundedBody could not read. Nothing here throws.

'use strict';

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
// neutralizing guard is a property of the output channel, and an endpoint's
// own error strings travel that channel to a terminal, a log and a record.
function neutralize(text) {
    if (typeof text !== 'string') return '';
    return text.replace(UNSAFE_RE, '').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ hosts --

// Whether a host sits on this machine or on this machine's private network.
//
// This function is a locality predicate and decides nothing: each
// caller chooses what a non-local host means for its own channel. jev-client.js
// and the Jev recognition battery use it to refuse cleartext to anything but
// loopback.
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

// -------------------------------------------------------------- transport --

// The shortest clock a request's abort timer is armed with.
const MIN_TIMEOUT_MS = 1000;

// The most of a response body this module will hold. The answering server is
// not this process's to vouch for, so the size of what comes back is not a
// caller's to assume. Reading it in bounded chunks keeps a wrong or hostile
// answer from being a memory fault in the caller. The largest answer a caller
// legitimately takes is an embedding batch, and memory-database.js sizes its
// packs to fit under this bound.
const MAX_BODY_BYTES = 256 * 1024;

// The delay a request's abort timer is armed with.
//
// Every request carries a clock, so a caller that passes a non-finite or
// non-positive one gets this module's floor rather than that value.
// `setTimeout` coerces null and NaN to zero and fires on the next tick, which
// would abort every request before it left, and a caller cannot see the
// difference between that and an endpoint that never answers.
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
// is `unreachable` rather than a third outcome nobody has a policy for.
//
// THE NO-CODE CASE NEVER USES `err.message`. A malformed request url (a
// credential embedded in it, among other shapes) makes the runtime's own URL
// constructor throw a TypeError whose message spells the request URL back out
// in full, with no `.code` anywhere in its cause chain for the coded branches
// above to catch. The url is a caller's configured address, and this detail
// string reaches the caller's stderr and records, so a message carrying the
// address would print it there. A fixed sentence is used instead, which loses
// only the fact that this specific shape of failure happened; the coded
// branches above still name every failure a caller can usefully act on.
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

module.exports = {
    UNSAFE_PATTERN,
    neutralize,
    MIN_TIMEOUT_MS,
    hostIsLocal,
    MAX_BODY_BYTES,
    CONNECTION_CODES,
    SLOW_CODES,
    abortDelay,
    errorCode,
    classifyThrow,
    discardBody,
    readBoundedBody
};
