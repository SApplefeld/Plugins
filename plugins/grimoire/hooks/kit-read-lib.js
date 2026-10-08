// Shared bounded reader for the kit's hooks: one file's bytes, and one
// directory's names. Every hook read of a file whose size and kind the caller
// does not control, and every listing of a directory whose length it does not
// control, runs through here, so the properties that make such a read unsafe
// are closed in one place instead of at each call site.
//
// The kind is settled on the descriptor. A FIFO reports size 0, passes any size
// ceiling, and then blocks inside open() until a writer appears, and no try
// around the open can rescue that: the call never returns. The kit's readers run
// inside SessionStart and Stop hooks that block a session, in whatever directory
// the session opened, including a clone of a repository nobody has
// read, so a FIFO named docs/backlog.md would hold every session start in that
// checkout open forever. Two things close it together, the pair every reader here
// carries for a path opened for its contents: off win32 the open
// itself is non-blocking, which is what makes opening a FIFO return rather than
// wait, and the kind verdict is then taken from an fstat on the open
// descriptor. Judging a name and then opening that name leaves the window a
// local process swaps the file inside; a descriptor answers only for the file
// that was actually opened.
//
// The size that bounds the read is the descriptor's for the same reason read
// the other way. A size taken off a name before the open describes whatever
// stood there then, so a file that grew in between comes back short while its
// own flag calls it whole, which is a partial reading reaching a session as a
// total. The ordinary read stats no path before the open, which also means a
// symlink into a dead network mount fails at the open the OS is already timing
// rather than stalling in a stat first. The one exception is stated where it is
// taken: a caller that opts into the link refusal below runs an lstat first on a
// platform with no O_NOFOLLOW, because there the name is the only place that
// question can be asked at all.
//
// The read fills its buffer. A single readSync may legally return fewer bytes
// than asked for, so a caller that treats one call's return as the whole file
// gets a truncation it cannot see: the count it takes off that text reads as a
// total, and the file's own size says the read was complete.
//
// A result that is not the whole file says so, and says WHICH bound stopped it.
// Two things make a read partial, a file larger than the ceiling and a fill loop
// that ended short of what the descriptor promised, and a caller summarizing
// what it read needs the same answer from both, because a summary presented as a
// total is wrong for either reason. A caller whose two directions differ in cost
// needs them apart instead, which is why the flag is answered beside a named
// bound rather than alone: the ceiling binding says the file is larger than this
// caller's cap, which is a fact about the file, while a short fill says the file
// was truncated under the read or a device stopped answering, which any file at
// all can do at any moment. A writer that removes a file on the strength of "not
// mine" may act on the first and must not act on the second.
// When the result is partial the trailing fragment goes with it: a byte
// cut lands mid-line and possibly mid-codepoint, so everything after the last
// newline is discarded and a caller only ever sees whole lines. Left in, a line
// counter counts a fragment as an item and a date scanner reads a severed token
// as no date at all.
//
// A listing says the same thing about a directory: a cap that binds, or a
// directory that will not answer, leaves names unseen, and a caller counting
// what it got needs to know that before it renders the count as a total.
//
// The boundary is shared rather than per-caller because an unexported one is the
// fix the next author reimplements by not implementing it: these properties
// belong to the act of reading what a repository supplies, not to the one caller
// that first needed them. kit-git-lib.js holds the same shape for the spawn
// boundary.
//
// Node core modules, plus one rule borrowed from kit-plan-lib.js rather than
// spelled a second time here: normalizePlanArg's containment test, which
// containedRealPath answers to. CommonJS, no third-party dependencies.
//
// readFileBounded never throws: a missing file, a path that is not a regular
// file, and a read that fails all degrade to a null the caller reads. readFully
// answers to its caller's try instead, handing back a bad descriptor's EBADF
// and an over-large length's RangeError, since the caller owns the descriptor
// and the window and is the only one able to say what a failure of either
// means.

'use strict';

const fs = require('fs');
const { normalizePlanArg } = require('./kit-plan-lib.js');

// How many entries one directory listing may examine. A directory nothing here
// controls can hold any number of them, and a walk that reads every one is
// unbounded work inside a hook that blocks a session. The figure sits far above
// any real shape the kit's callers meet (a transcript store's few hundred, a
// plans directory's few dozen), so it binds only where something arranged for
// it to.
const DIR_SCAN_MAX_ENTRIES = 4096;

// Read `length` bytes from `position` into a fresh buffer, looping until the
// buffer is full or the file ends, and return the buffer beside the number of
// bytes actually in it. The byte count is what tells a caller its read came up
// short, which the decoded string cannot: a string's length is characters, and
// a multi-byte encoding puts no fixed relation between the two.
function fillBuffer(fd, position, length) {
    const buf = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
        const n = fs.readSync(fd, buf, filled, length - filled, position + filled);
        if (n <= 0) break;
        filled += n;
    }
    return { buf, filled };
}

// Read `length` bytes from `position` and decode them as UTF-8, looping until
// the buffer is full or the file ends. The primitive for a caller that has
// already settled the file's kind and its own bound, and that reads a window
// whose edges it handles itself (jev-judge's lastOperatorMessage takes a
// window off a transcript's end and drops the leading fragment itself).
function readFully(fd, position, length) {
    const { buf, filled } = fillBuffer(fd, position, length);
    return buf.toString('utf8', 0, filled);
}

// Read the whole file at `filePath`, up to `ceilingBytes`, and say whether what
// came back is the whole file.
//
// null when nothing at the path can be read as a file at all: absent, a
// directory, a FIFO or any other non-regular kind, an unreadable one, or a
// ceiling that is not a positive number. A caller that opts into the link
// refusal below adds one more to that list, and only for itself: a symlink at
// the FINAL COMPONENT, refused on both platform legs, at the open where
// O_NOFOLLOW exists and at an lstat before it where it does not. It arrives as
// the same null every other refusal answers with, so a caller that needs a link
// told apart from an unreadable file asks that question itself before calling.
// Otherwise
// { text, bounded, bytesRead, boundedBy }:
//
//   text       the decoded content, whole lines only when bounded
//   bounded    true when text is not the whole file, for any reason
//   bytesRead  how many bytes the read consumed, which a caller spending a
//              budget across several files decrements by
//   boundedBy  which bound stopped the read: 'ceiling' when the file is larger
//              than ceilingBytes, 'short-fill' when the fill loop ended short of
//              what the descriptor promised, and null when the result is whole.
//              A read that hits both is 'short-fill', because that is the
//              reading a caller must not treat as a file too large to be its
//              own: the ceiling is a fact about the file, while a short fill
//              says only that this read did not finish.
//
// The open follows a symlink rather than refusing one by default, because the
// question here is what the read would block on: a link to a regular file reads
// exactly like that file, while a link to a FIFO fstats as a FIFO and is refused
// with it. A caller whose subject must not be a link out of its own tree judges
// that itself before calling, through containedRealPath below.
//
// `options.refuseLink` is the other question, asked here rather than by hand at
// each caller that needs it: is the FINAL COMPONENT itself a link? A caller
// whose subject is a file its own writer creates and renames into place wants
// that refusal, because a link planted at the path redirects the read to
// whatever it names and a link into a dead network mount stalls the open. It is
// opt-in and defaults off, so a caller that means to read through a link (a
// checkout reached through one, a settings file an operator has linked into
// place) keeps reading exactly what it read before. Off it costs nothing at all,
// and no caller pays for a property it did not ask for.
//
// Where the platform can express it, the refusal rides the OPEN rather than a
// stat on the name, which is the same descriptor-settled reasoning the kind and
// the size take above: O_NOFOLLOW makes the open itself fail on a link at the
// final component, so there is no window between a verdict about a name and an
// open of that name for a local process to swap the file inside. win32 has no
// O_NOFOLLOW (fs.constants.O_NOFOLLOW is undefined there) and no way to reach
// FILE_FLAG_OPEN_REPARSE_POINT through fs, so that platform takes the siblings'
// rule instead, an lstat that refuses a link before the open, which NARROWS the
// window rather than closing it. The residue is the asking caller's to bound and
// differs with what it reads, so it is stated per caller rather than once for the
// option. The nudge-log
// read (readNudgeLog in memory-recognition-nudge.js) reads a file that hook
// writes and appends to itself through an O_NOFOLLOW open, so the option is what
// makes the reader refuse what the writer already refuses; what rides through
// the window is one hook's own observability window, and a refusal reads there as
// a log that could not be opened.
function readFileBounded(filePath, ceilingBytes, options) {
    if (typeof filePath !== 'string' || filePath === '') return null;
    if (typeof ceilingBytes !== 'number' || !(ceilingBytes > 0)) return null;
    const refuseLink = !!(options && options.refuseLink);
    // The name check only where the open cannot carry the refusal itself. An
    // lstat does not traverse the final component, so it answers for the link
    // and not for its target; any failure of it, an absent path included, is
    // the same null this reader answers for a path it cannot open.
    if (refuseLink && !fs.constants.O_NOFOLLOW) {
        try {
            if (fs.lstatSync(filePath).isSymbolicLink()) return null;
        } catch {
            return null;
        }
    }
    // Off win32 the open is non-blocking, so a FIFO at this path returns a
    // descriptor instead of waiting for a writer that a planted one will never
    // provide; the fstat below is what then refuses it. win32 has no O_NONBLOCK
    // and no path-named FIFO for a repository to plant.
    const flags = (process.platform === 'win32'
        ? fs.constants.O_RDONLY
        : fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0))
        | ((refuseLink && fs.constants.O_NOFOLLOW) || 0);
    let fd;
    try {
        fd = fs.openSync(filePath, flags);
    } catch {
        return null;
    }
    try {
        // Both the kind and the size come off the descriptor: they describe the
        // file this read is about to consume rather than whatever the name
        // stood for a moment ago.
        const st = fs.fstatSync(fd);
        if (!st.isFile()) return null;
        const readLen = Math.min(st.size, Math.floor(ceilingBytes));
        const ceilingBound = st.size > readLen;
        const { buf, filled } = fillBuffer(fd, 0, readLen);
        let text = buf.toString('utf8', 0, filled);
        // A fill loop that ended short of what the descriptor promised is the
        // second way a result is partial: the file was truncated under the read,
        // or a device stopped answering. It reads no differently to a caller
        // asking "was this partial", so it sets the same flag, and it is a
        // different fact from the ceiling binding, so it names a different
        // bound. The short fill is what a read that hit both is named by: it
        // holds whatever the ceiling says about the file, plus the one thing the
        // ceiling never says, that this read did not finish.
        const boundedBy = (filled < readLen) ? 'short-fill' : (ceilingBound ? 'ceiling' : null);
        const bounded = boundedBy !== null;
        if (bounded) {
            // Everything after the last newline is a fragment of a line the read
            // cut in half, and possibly of a character: the decoder leaves a
            // replacement codepoint at a mid-sequence cut. A bounded result with
            // no newline in it at all holds no whole line, so it comes back
            // empty.
            const nl = text.lastIndexOf('\n');
            text = nl === -1 ? '' : text.slice(0, nl + 1);
        }
        return { text, bounded, bytesRead: filled, boundedBy };
    } catch {
        return null;
    } finally {
        try { fs.closeSync(fd); } catch { /* already closed or invalid */ }
    }
}

// The real path of `filePath` when it still lies inside `rootDir` once every
// link on both paths is resolved, and null when it does not or cannot be
// resolved at all.
//
// The containment judgment readFileBounded leaves to its callers, spelled once
// here rather than at each of them. A hook reads what the checkout it opened in
// supplies, and a link is repository data like any other: a docs/backlog.md
// pointing out of the tree would otherwise put a foreign file's item count and
// oldest date into session context, out of a repository nobody has read. The
// root is resolved too, so a checkout reached through a link of its own is not
// judged foreign to itself.
//
// The containment test itself is kit-plan-lib's normalizePlanArg, the same rule
// that decides whether a plan path escapes its repo, so the two cannot
// come to disagree about what inside means. Never throws.
function containedRealPath(rootDir, filePath) {
    try {
        const root = fs.realpathSync(rootDir);
        const real = fs.realpathSync(filePath);
        return normalizePlanArg(root, real) === null ? null : real;
    } catch {
        return null;
    }
}

// The names in a directory matching `matches`, capped at maxNames, beside a
// flag saying whether the listing is partial: { names, bounded }. An absent
// directory is an empty listing and not a bounded one, since nothing there is
// nothing to miss; every other failure (a permission, a lock, a path that is
// not a directory) leaves the listing unknown and sets the flag, so only
// ENOENT reads as an empty answer.
//
// The listing is read incrementally rather than through readdirSync, because
// readdirSync materializes the whole directory before the first entry can be
// judged, so a cap applied to its result bounds what is kept and nothing about
// what was read. Never throws.
function listBoundedNames(dir, maxNames, matches) {
    let handle;
    try {
        handle = fs.opendirSync(dir);
    } catch (err) {
        return { names: [], bounded: !(err && err.code === 'ENOENT') };
    }
    const names = [];
    let bounded = false;
    try {
        let seen = 0;
        for (;;) {
            const entry = handle.readSync();
            if (entry === null) break;
            seen += 1;
            if (seen > DIR_SCAN_MAX_ENTRIES) {
                bounded = true;
                break;
            }
            if (!matches(entry)) continue;
            if (names.length >= maxNames) {
                bounded = true;
                break;
            }
            names.push(entry.name);
        }
    } catch {
        bounded = true;
    } finally {
        try { handle.closeSync(); } catch { /* already closed, or never opened cleanly */ }
    }
    return { names, bounded };
}

module.exports = { readFully, readFileBounded, containedRealPath, listBoundedNames, DIR_SCAN_MAX_ENTRIES };
