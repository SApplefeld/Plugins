// Shared predicate: does a working directory name a network share (a UNC
// path, \\host\share, or a //server/share form)? Both are the shapes a
// synchronous open can hang on for the SMB timeout when the host is
// unreachable, rather than failing fast the way a missing local path does.
//
// Beside it sits screenRecordedPath, the path screen the peer-sessions skill
// states for every directory-sourced path, applied to a path a store record
// carries for a tool to open later (a `board:` value). It is built on the
// predicate above rather than restating it, so the two cannot disagree about
// what a share looks like.
//
// This is its own module, holding these two path checks and nothing else, because scripts/memq.js is
// 11,880 lines and a hot hook path cannot afford to pay to load it just to
// answer this one question: the warm require cost of the whole file measures
// 8.7-11.4ms. This module is cheap enough to require on a hook path instead.
//
// scripts/memq.js requires this module and re-exports the predicate under
// its own name, so a caller that already holds memq for other reasons
// (hooks/memory-session.js, hooks/memory-frontmatter-guard.js) keeps calling
// memq.namesNetworkShare unchanged. A caller that does not otherwise need
// memq (hooks/kit-compact-lib.js, hooks/capacity-read.js) requires this
// module directly instead.
//
// Exactly one expression decides the question, here (Standing Amendment 2):
// every caller above reaches this file's answer rather than re-deriving it.
// hooks/kit-plan-lib.js carries its own independent copy of the same
// leading-separator test for a different subject, a stored transcript path
// rather than a working directory, so it is not folded into this module.
//
// A non-string answers true (refuse) rather than false: false is the
// checked-and-clean value this predicate exists to gate a walk behind, and a
// caller that passes something other than the path it means to walk is a
// call this predicate cannot make sense of, not evidence the path is safe.
// Answering false there would be a coercion handing back the
// checked-and-clean value for an input nothing checked, which is the defect
// class this one type guard exists to keep out of every caller.
'use strict';

const path = require('path');

function namesNetworkShare(cwd) {
    if (typeof cwd !== 'string') return true;
    return /^[\\/]{2}/.test(cwd);
}

// A path recorded in a store file, as { path, reason }: the normalized path
// where the value passes, or null and the rule it met, worded to follow
// "which", so a caller can quote the value and say why in one sentence.
//
// The rules, in the order they are asked. A value that is not text, or holds
// none, names nothing. A network-shaped value is refused before anything else
// reads it, since opening one makes this machine authenticate outbound to a
// host the record chose and blocks for the connection's timeout. The value is
// then normalized, and one still carrying a parent-directory segment is
// refused, because such a path places outside whatever it appears to name. A
// path this cannot place is refused last: the processes that read a recorded
// path run from any working directory, so a relative one names a different
// file in each. On win32 a path rooted at a separator with no drive letter is
// the same case, since it opens on the drive of whichever process reads it.
// Normalizing can itself produce a share spelling, so the network rule is
// asked again of the normalized form.
function screenRecordedPath(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return { path: null, reason: 'names no path' };
    }
    if (namesNetworkShare(value)) return { path: null, reason: 'names a network share' };
    const normalized = path.normalize(value);
    if (namesNetworkShare(normalized)) return { path: null, reason: 'names a network share' };
    if (normalized.split(/[\\/]/).includes('..')) {
        return { path: null, reason: 'still carries a parent-directory segment after normalization' };
    }
    if (!path.isAbsolute(normalized)) return { path: null, reason: 'is not an absolute path' };
    if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(normalized)) {
        return { path: null, reason: 'names no drive, so it opens on the drive of whichever process reads it' };
    }
    return { path: normalized, reason: null };
}

module.exports = { namesNetworkShare, screenRecordedPath };
