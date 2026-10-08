// The fleet memory block's judge: the policy that sits between the shared
// memory database's search shortlist and the block session start and `memq
// recall` print. It composes the situation the judge reads, asks TypeSafe's
// Jev one question per candidate through the shared client, selects what the
// block shows, and records what it judged, so that an outcome can be keyed to
// each judged candidate by its recognition id. The block itself (the database
// query, the hit shape and the line rendering) stays in memq.js, which calls
// the pieces here in order.
//
// WHERE THE DATA GOES. One call sends the composed situation as state, and each
// candidate's name, description and status inside its question, to the
// endpoint the shared client reads from `~/.claude/kit-jev.json`. Record bodies
// never ride: a candidate is built from three fields of a search row and
// nothing else, and the question shape is the one the recognition battery
// measured the floors with. The situation is assembled from files and never
// from a model: the in-progress plan's Goal, its Intent where it has one, and
// the full text of the section its latest Chapter's `Next:` line names; on a
// resume or a compaction the operator's last message from the transcript joins
// it; with no plan in progress the branch name and the last three commit
// titles stand in; and a `memq recall` may pass its own one-line situation.
//
// THE POLICY LIVES HERE AND NOT IN THE CLIENT. The fetch limit, the two floors,
// the budget edge and the retry delay are this module's constants. The shared
// client holds no caller's policy, so a promises check that waits thirty
// seconds and this judge that must answer inside a session start share one
// wire and two policies.
//
// EVERY FAILURE IS A STAND-DOWN, NEVER A THROW. A judge that cannot answer
// resolves to a reason and the sentence the block prints beside the vector
// list it shows instead; a judge that is not configured resolves to a reason
// and no sentence, since a machine with no config hears nothing about one.
// No sentence here is built from a runtime error's message, on the client's
// own rule: a thrown call is named as a failed call and nothing more.
//
// THE KEY. This module never reads `TYPESAFE_API_KEY`. The client reads it
// inside the call and returns no object that carries it, so nothing here can
// write it: not the shown file, not a stand-down line, not a thrown error.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const client = require('./jev-client.js');
const planLib = require('../hooks/kit-plan-lib.js');
const gitLib = require('../hooks/kit-git-lib.js');
const readLib = require('../hooks/kit-read-lib.js');
const compact = require('../hooks/kit-compact-lib.js');

// memq loads this module in its fixed sibling block, and this module reaches
// back to memq for one helper, the shared-write lock, so the require is
// deferred to the call that needs it: a top-level require here would run
// while memq is still evaluating and hand this module memq's empty export
// object, the cycle memory-database.js defers its own require for.
function memqLib() {
    return require('./memq.js');
}

// ------------------------------------------------------------- constants --

// How many candidates stage 1 fetches for the judge to read. The block shows
// five or ten; thirty gives the judge headroom past the procedure's own order.
const FETCH_LIMIT = 30;

// The two floors, in probability. The top-scoring candidate shows where its
// score reaches FIRST_FLOOR, and every further candidate where its score
// reaches SECOND_FLOOR. Both are the operator's ruled values for this fleet's
// store.
const FIRST_FLOOR = 0.70;
const SECOND_FLOOR = 0.75;

// The judge's edge inside the block's 2,000 ms budget, measured from the
// block's start. Past it the block falls back to the vector list, leaving the
// render its margin.
const BUDGET_EDGE_MS = 1500;

// One retry on a 429 or 529, this long after the first answer, and only where
// the client can fit it before the deadline.
const RETRY_DELAY_MS = 200;

// How much of a transcript's end is read for the operator's last message. The
// newest human turn sits near the end, and a bounded read keeps a long
// session's transcript from becoming a whole-file read at a session start.
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

// The most a plan doc is read for its Goal, Intent and one section.
const PLAN_READ_BYTES = 1024 * 1024;

// How many plan docs the in-progress scan lists at most.
const PLANS_LISTED_MAX = 200;

// The directory plan docs live in, relative to the project root, and the
// file the judged candidates are recorded in under the project's scratch
// directory.
const PLANS_DIR = path.join('docs', 'plans');
const SHOWN_FILE = 'jev-shown.json';

// The most of the shown file a read takes. The file sits under a project's
// .kit/, which a repository can carry, so a read of it is bounded. A regular
// file past this is reset whole by the next rewrite, its entries uncounted.
const SHOWN_READ_BYTES = 1024 * 1024;

// Each of the two git calls the no-plan situation makes is held to this, since
// both run on the session-start path inside the block's budget.
const GIT_TIMEOUT_MS = 500;

// The question and its two criteria sentences, verbatim from the recognition
// battery (tools/jev-recognition-battery/run.js), whose measured floors
// hold for this wording and no other. The instructions object beside them is
// the battery's shape too: the question, then the record's title, description
// and status under the battery's own keys.
const QUESTION = 'The state describes what an AI coding agent is doing or just observed. '
    + 'Would reading the memory record below, right now, change what the agent does next? '
    + 'Most situations match zero or one records; do not invent relevance.';
const CRITERIA_TRUE = 'Reading this record now would change what the agent does next.';
const CRITERIA_FALSE = 'This record does not bear on the situation.';

// The line where the judge was never asked: the thirty held no fleet-tier
// record, or the host answered none, so there was nothing to read.
const NO_CANDIDATE_LINE = 'No fleet record is near this project\'s recent work, so the judge had nothing to read.';
// The line the block prints where the judge read the shortlist and nothing in
// it clears the first floor. A judged result rather than a stand-down.
const NO_RECORD_LINE = 'No fleet record bears on this project\'s recent work, as the shared'
    + ' memory database\'s judge read its nearest thirty.';

// --------------------------------------------------------------- the judge --

// Whether this machine has a Jev config at all, read through the client so
// the two cannot disagree about where the file is or what absent means. Only
// an absent file is unconfigured, and that machine takes the block as it was
// before the judge existed. A file that is present and cannot be used is
// configured: the judge path runs, the client answers `config unusable`, and
// the block falls back to the vector list with the stand-down line naming it.
function judgeConfigured(deps) {
    const load = deps && typeof deps.loadJevConfig === 'function' ? deps.loadJevConfig : client.loadJevConfig;
    const config = load();
    if (config === null || typeof config !== 'object') return false;
    return config.ok === true || client.configRefusalReason(config) !== 'not configured';
}

// One search hit as the candidate the judge is asked about: the three fields
// the question carries, the hit's position in the thirty as the procedure
// ordered them, and nothing else of the record. Status is `archived` where the
// row's archived key is set, else `live`.
function candidateOf(hit, rank) {
    return {
        rank,
        name: typeof hit.name === 'string' ? hit.name : '',
        description: typeof hit.description === 'string' ? hit.description : '',
        status: hit.archived === true ? 'archived' : 'live'
    };
}

// The question set, one `noul` per candidate keyed `c1` to `cN` in the
// candidates' order, so an answer reads back positionally.
function questionsFor(candidates) {
    const questions = {};
    candidates.forEach((c, i) => {
        questions['c' + (i + 1)] = {
            type: 'noul',
            instructions: {
                question: QUESTION,
                record_title: c.name,
                record_description: c.description,
                record_status: c.status
            },
            criteria: { true: CRITERIA_TRUE, false: CRITERIA_FALSE }
        };
    });
    return questions;
}

// The sentence the block prints beside the vector list when the judge stood
// down, or null for a machine with no config, which hears nothing. The reason
// and detail are the client's own literals, never a runtime error's message.
function standDownLine(reason, detail) {
    if (reason === 'not configured') return null;
    if (reason === 'no key') {
        return 'The fleet judge stood down because TYPESAFE_API_KEY is not set in this process\'s'
            + ' environment, so these are the records nearest by vector rather than the ones it'
            + ' judged.';
    }
    const named = typeof detail === 'string' && detail !== '' ? reason + ': ' + detail : reason;
    return 'The fleet judge was unavailable (' + named + '), so these are the records nearest by'
        + ' vector rather than the ones it judged.';
}

function standDown(reason, detail) {
    return { ok: false, reason, detail, line: standDownLine(reason, detail) };
}

// Ask the judge about every candidate against the state, inside what remains
// of the budget edge measured from `options.startedMs`. Resolves to
// `{ ok: true, scores, inputTokens }` with one score per candidate in order,
// or to a stand-down `{ ok: false, reason, detail, line }`. Never throws and
// never rejects.
//
// `options.deps.askJev` and `options.deps.now` replace the client and the
// clock, which is how the tests drive every stand-down without a network.
async function judge(state, candidates, options) {
    const opts = options || {};
    const deps = opts.deps || {};
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const ask = typeof deps.askJev === 'function' ? deps.askJev : client.askJev;
    const started = Number.isFinite(opts.startedMs) ? opts.startedMs : now();

    const remaining = BUDGET_EDGE_MS - (now() - started);
    if (remaining <= 0) return standDown('timeout', 'the budget edge passed before the judge was asked');

    const questions = questionsFor(candidates);
    let answered = null;
    try {
        answered = await ask(state, questions, remaining, [RETRY_DELAY_MS]);
    } catch {
        return standDown('unreachable', 'the call failed');
    }
    // An answer that arrives past the edge is one the block can no longer
    // spend its render margin on, so it is not read.
    if (now() - started > BUDGET_EDGE_MS) return standDown('timeout', 'the judge answered past the budget edge');
    if (answered === null || typeof answered !== 'object') return standDown('unusable answer', 'no answer object');
    if (answered.ok !== true) {
        const reason = typeof answered.reason === 'string' ? answered.reason : 'unusable answer';
        return standDown(reason, typeof answered.detail === 'string' ? answered.detail : undefined);
    }
    const answers = answered.answers;
    const scores = [];
    for (let i = 0; i < candidates.length; i += 1) {
        const answer = answers !== null && typeof answers === 'object' ? answers['c' + (i + 1)] : undefined;
        const p = answer !== null && typeof answer === 'object' ? answer.noul : undefined;
        if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
            return standDown('unusable answer', 'a candidate has no score from 0 to 1');
        }
        scores.push(p);
    }
    return { ok: true, scores, inputTokens: Number.isInteger(answered.inputTokens) ? answered.inputTokens : 0 };
}

// The candidates the block shows, from scored candidates (each carrying
// `score` and `rank`): ordered by judge score, the top one where it reaches
// the first floor, every further one where it reaches the second, capped at
// `limit`. A tie in score keeps the procedure's order. An empty answer is the
// judged no-record result rather than a stand-down.
function selectShown(scored, limit) {
    const ordered = scored.slice().sort((a, b) => (b.score - a.score) || (a.rank - b.rank));
    if (ordered.length === 0 || ordered[0].score < FIRST_FLOOR) return [];
    const shown = [ordered[0]];
    for (const c of ordered.slice(1)) {
        if (c.score >= SECOND_FLOOR) shown.push(c);
    }
    return shown.slice(0, Math.max(0, Math.floor(limit)));
}

// ----------------------------------------------------------- the composer --

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// The parts of a plan doc the situation is built from: the title, the Goal and
// Intent text, every `### N. Title` section under `## Sections of Work` with
// its full text, and the latest Chapter's `Next:` line. A fence is tracked
// wherever it opens, so a heading inside one is text.
function planParts(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const parts = { title: null, goal: [], intent: [], sections: [], next: null };
    let block = null;
    let fence = null;
    let section = null;
    let chapter = null;
    const push = (line) => {
        if (block === 'goal') parts.goal.push(line);
        else if (block === 'intent') parts.intent.push(line);
        else if (block === 'sections' && section !== null) section.lines.push(line);
    };
    for (const line of lines) {
        const run = FENCE.exec(line);
        if (fence !== null) {
            if (run !== null && run[1][0] === fence.char && run[1].length >= fence.length
                && line.slice(run[0].length).trim() === '') fence = null;
            push(line);
            continue;
        }
        if (run !== null && !(run[1][0] === '`' && line.slice(run[0].length).includes('`'))) {
            fence = { char: run[1][0], length: run[1].length };
            push(line);
            continue;
        }
        if (parts.title === null && /^#\s+\S/.test(line)) {
            parts.title = line.replace(/^#\s+/, '').trim();
            continue;
        }
        const h2 = /^##\s+(.*)$/.exec(line);
        if (h2 !== null) {
            const name = h2[1].trim();
            block = name === 'Goal' ? 'goal' : name === 'Intent' ? 'intent'
                : name === 'Sections of Work' ? 'sections' : name === 'Chapters' ? 'chapters' : null;
            section = null;
            chapter = null;
            continue;
        }
        if (block === 'sections') {
            const heading = /^###\s+(\d+)\.\s+(.*)$/.exec(line);
            if (heading !== null) {
                section = { number: heading[1], title: heading[2].trim(), lines: [line] };
                parts.sections.push(section);
                continue;
            }
            if (/^###\s/.test(line)) {
                section = null;
                continue;
            }
            push(line);
        } else if (block === 'chapters') {
            if (/^###\s+Chapter\s+\d+/.test(line)) {
                chapter = { next: null };
                parts.next = null;
                continue;
            }
            if (chapter !== null && chapter.next === null) {
                const n = /^Next:\s*(.*)$/.exec(line);
                if (n !== null) {
                    chapter.next = n[1].trim();
                    parts.next = chapter.next;
                }
            }
        } else {
            push(line);
        }
    }
    return parts;
}

// The section a Chapter's `Next:` line names: by the number it opens with
// (`2. Title`, `Section 2`, `§2`), else by exact title; null where it names
// none, as `Next: finishing-work` does.
function sectionForNext(next, sections) {
    if (typeof next !== 'string' || next === '') return null;
    const m = /^(?:sections?\s*|§)?(\d{1,4})(?!\d)/i.exec(next);
    if (m !== null) {
        const found = sections.find((s) => s.number === m[1]);
        if (found !== undefined) return found;
    }
    return sections.find((s) => s.title === next.trim()) || null;
}

// The situation text from a plan's parts and the operator's message, whole:
// the Plan, the Goal, the operator's message where the caller passed one, the
// Intent where it has one and the Next section where the latest Chapter names
// one, each riding uncut, so the judge reads the whole of what the session is
// doing. The search that also reads this text takes only its head, at its call
// in memq.js's fleetJudgedBlock, so the message rides ahead of the two parts
// that run longest: what the operator last said reaches the search on a resume
// or compaction however long the plan's Intent and section are.
function assembleState(parts, message) {
    const goal = parts.goal.join('\n').trim();
    const intent = parts.intent.join('\n').trim();
    const named = sectionForNext(parts.next, parts.sections);
    const section = named === null ? '' : named.lines.join('\n').trim();
    return [
        'Plan: ' + parts.title,
        'Goal: ' + goal,
        message === null ? null : 'Operator\'s last message: ' + message,
        intent === '' ? null : 'Intent: ' + intent,
        section === '' ? null : 'Next section: ' + section
    ].filter((p) => p !== null).join('\n\n');
}

// The in-progress plan under the project root as `{ rel, text }`, or null.
// A plan is in progress where its header's Status row reads so under the plan
// library's reading. Where several do, the most recently modified wins.
function inProgressPlan(cwd) {
    const dir = path.join(cwd, PLANS_DIR);
    const listing = readLib.listBoundedNames(dir, PLANS_LISTED_MAX,
        (entry) => entry.isFile() && entry.name.endsWith('.md'));
    const found = [];
    for (const name of listing.names) {
        const rel = 'docs/plans/' + name;
        const readings = planLib.planStatusReadings(cwd, rel);
        if (!readings.exists || readings.status !== 'in progress') continue;
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs; } catch { /* listed a moment ago; ranks last */ }
        found.push({ rel, mtimeMs });
    }
    if (found.length === 0) return null;
    const chosen = found.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
    const read = readLib.readFileBounded(path.join(cwd, chosen.rel), PLAN_READ_BYTES);
    if (read === null) return null;
    return { rel: chosen.rel, text: read.text };
}

// The text of a parsed transcript line where it is a human turn, else null. A
// human turn is a `user` line the harness did not inject (no isMeta,
// isSidechain or isCompactSummary flag), whose
// content is a plain string or an array of text blocks with no tool_result
// among them. The echo of a slash command's stdout is stripped through
// kit-compact-lib's stripLocalCommandOutput, and a turn that holds a command's
// invocation record, or nothing once the echo is gone, is not one: those are
// the harness's writing (a typed `/compact` leaves both), not the operator's.
function humanTurnText(entry) {
    if (entry === null || typeof entry !== 'object') return null;
    if (entry.type !== 'user') return null;
    if (entry.isSidechain || entry.isMeta === true || entry.isCompactSummary === true) return null;
    const content = entry.message && entry.message.content;
    let text = null;
    if (typeof content === 'string') {
        text = content;
    } else if (Array.isArray(content)) {
        const texts = [];
        for (const block of content) {
            if (block === null || typeof block !== 'object') return null;
            if (block.type === 'tool_result') return null;
            if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
        }
        if (texts.length > 0) text = texts.join('\n');
    }
    if (text === null) return null;
    const typed = compact.stripLocalCommandOutput(text);
    if (typed.trim() === '' || /<command-name>/i.test(typed)) return null;
    return typed;
}

// The operator's last message in the transcript's tail, whole, or null where
// the path is absent, unusable or holds no human turn in the tail. The read
// is bounded and from the end, never the whole file, and the
// first line of a tail that does not start at the file's head is skipped
// since the read may have begun inside it. The kind and the size come off the
// open descriptor, so they describe the file being read rather than whatever
// the name stood for before the open. The open takes kit-read-lib's flags:
// non-blocking off win32, so a FIFO at the path returns a descriptor the kind
// check refuses rather than an open that waits for a writer.
function lastOperatorMessage(transcriptPath) {
    if (!planLib.storablePathValue(transcriptPath, 512, false)) return null;
    let fd = null;
    try {
        fd = fs.openSync(transcriptPath, process.platform === 'win32'
            ? fs.constants.O_RDONLY
            : fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
        const st = fs.fstatSync(fd);
        if (!st.isFile()) return null;
        const length = Math.min(st.size, TRANSCRIPT_TAIL_BYTES);
        const start = st.size - length;
        const text = readLib.readFully(fd, start, length);
        const lines = text.split('\n');
        if (start > 0) lines.shift();
        for (let i = lines.length - 1; i >= 0; i -= 1) {
            let entry = null;
            try { entry = JSON.parse(lines[i]); } catch { continue; }
            const found = humanTurnText(entry);
            if (found === null || found.trim() === '') continue;
            return found.trim();
        }
        return null;
    } catch {
        return null;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* already closed */ }
        }
    }
}

// The situation with no plan in progress: the branch name and the last three
// commit titles, through the hooks' guarded git runner. '' where the
// directory is not a repository git will answer about, or git did not answer
// inside GIT_TIMEOUT_MS. The log passes --no-show-signature so a repository's
// own log.showSignature cannot hand its commits to its own gpg.program.
function gitSituation(cwd) {
    const branch = gitLib.gitOutput(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS });
    const titles = gitLib.gitOutput(cwd, ['log', '--no-show-signature', '-3', '--format=%s'], { timeoutMs: GIT_TIMEOUT_MS });
    const parts = [];
    if (branch !== null && branch.trim() !== '') parts.push('Branch: ' + branch.trim());
    const lines = titles === null ? [] : titles.split('\n').map((t) => t.trim()).filter((t) => t !== '');
    if (lines.length > 0) parts.push('Recent commits:\n' + lines.map((t) => '- ' + t).join('\n'));
    return parts.join('\n\n');
}

// The situation text for a project root, from files and with no model call,
// or '' where nothing composes one. `options.source` is the session start's
// trigger, and on `resume` or `compact` the operator's last message from
// `options.transcriptPath` joins the plan's text.
function composeSituation(cwd, options) {
    const opts = options || {};
    const plan = inProgressPlan(cwd);
    if (plan === null) return gitSituation(cwd);
    const parts = planParts(plan.text);
    if (parts.title === null) parts.title = path.basename(plan.rel, '.md');
    const message = (opts.source === 'resume' || opts.source === 'compact')
        ? lastOperatorMessage(opts.transcriptPath) : null;
    return assembleState(parts, message);
}

// ---------------------------------------------------------- the shown file --

// The file the judged candidates are recorded in, under the project's scratch
// directory as kit-compact-lib resolves it. The directory is read off the
// checkpoint path, the one exported reader of that resolver, so a
// store-governed working directory redirects this file exactly as it
// redirects every other kit scratch file.
function shownFilePath(cwd) {
    return path.join(compact.kitScratchDir(cwd), SHOWN_FILE);
}

// One entry per judged candidate, for a session: the record name, a fresh
// recognition id, the judge's score, the stage-1 rank, whether the block
// showed it, the time, and `marked`, the field that records an outcome keyed
// to the entry, which this module always writes as null.
function shownEntries(sessionId, scored, shown, nowMs) {
    const shownSet = new Set(shown);
    const time = new Date(nowMs).toISOString();
    return scored.map((c) => ({
        session: sessionId,
        name: c.name,
        recognitionId: crypto.randomUUID(),
        score: c.score,
        rank: c.rank,
        shown: shownSet.has(c),
        time,
        marked: null
    }));
}

// The shown file's list, as `{ ok: true, list }` or a named omission. An
// absent file is an empty list. The read goes through kit-read-lib's bounded
// reader under SHOWN_READ_BYTES with its link refusal, as a file its own
// writer renames into place under .kit/ takes it: the lstat answers absent and
// link, and the descriptor answers kind and size. A link, a read that ended short, and text
// that does not parse are all `file unreadable`. A regular file the ceiling
// cut is `file past the ceiling`, named apart because the writer resets it
// where it leaves an unreadable file alone.
function readShownList(file) {
    let st;
    try {
        st = fs.lstatSync(file);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, list: [] };
        return { ok: false, reason: 'file unreadable' };
    }
    if (st.isSymbolicLink()) return { ok: false, reason: 'file unreadable' };
    const read = readLib.readFileBounded(file, SHOWN_READ_BYTES, { refuseLink: true });
    if (read === null) return { ok: false, reason: 'file unreadable' };
    if (read.bounded) {
        return { ok: false, reason: read.boundedBy === 'ceiling' ? 'file past the ceiling' : 'file unreadable' };
    }
    let parsed;
    try {
        parsed = JSON.parse(read.text);
    } catch {
        return { ok: false, reason: 'file unreadable' };
    }
    if (!Array.isArray(parsed)) return { ok: false, reason: 'file is not a list' };
    return { ok: true, list: parsed };
}

// The list written as compact JSON to a temporary file beside `file` and
// renamed over it, on kit-compact-lib's writeJsonAtomic shape. The temp name
// is that library's atomicTmpPath shape, the pid plus random bytes: the temp
// is opened exclusive, so an entry already at that name, a planted link above
// all, fails the write rather than being followed, and the random part is
// what keeps a temp stranded by a killed process, or planted by another, from
// occupying the one name every later process with that pid would pick.
// Create and write are separate calls so `created` means the exclusive create
// returned, and the close error is rethrown only once the write has returned,
// since that is where a deferred write error surfaces and dropping it would
// publish a torn file behind a rename. Only a temp this call created is this
// call's to remove, and only where the rename did not happen. Throws on any
// failure.
function writeShownList(file, list) {
    const tmp = file + '.tmp.' + process.pid + '.' + crypto.randomBytes(6).toString('hex');
    let created = false;
    try {
        const fd = fs.openSync(tmp, 'wx');
        created = true;
        let wrote = false;
        try {
            fs.writeFileSync(fd, JSON.stringify(list) + '\n', 'utf8');
            wrote = true;
        } finally {
            try {
                fs.closeSync(fd);
            } catch (closeErr) {
                if (wrote) throw closeErr;
            }
        }
        fs.renameSync(tmp, file);
    } catch (err) {
        if (created) {
            try { fs.unlinkSync(tmp); } catch { /* nothing to remove, or the unwritable path itself */ }
        }
        throw err;
    }
}

// One rewrite of the shown file, under memq's shared-write lock: the whole list
// is read through readShownList, `change` answers the list to write or null to
// leave the file as it is, and the new list replaces the old through
// writeShownList, so a peer session's write landing beside this one truncates
// nothing. An empty answer removes the file, under the same lock. A file past
// the reader's ceiling is a reset: `change` runs over an empty list, an
// answer of null or nothing removes the file and any other answer replaces
// it, and the result carries `reset: true`. The entries the over-size file
// held are dropped uncounted, which is the accepted cost of a scratch file
// that would otherwise never be written again. `{ ok: true, written }` or a
// named omission `{ ok: false, reason }`: a lock held past the short wait, a
// file this reader refuses or that holds something other than a list, or a
// write that failed. A throw out of `change` is a failed write. Never throws.
function rewriteShown(file, change) {
    let lock;
    try {
        lock = memqLib().acquireLock(file + '.lock', { waitMs: 250, staleMs: 5000 });
    } catch {
        return { ok: false, reason: 'lock failed' };
    }
    if (!lock.ok) return { ok: false, reason: 'lock held' };
    try {
        const existing = readShownList(file);
        const reset = !existing.ok && existing.reason === 'file past the ceiling';
        if (!existing.ok && !reset) return existing;
        const next = change(reset ? [] : existing.list);
        if (next === null && !reset) return { ok: true, written: false };
        if (next === null || next.length === 0) {
            fs.rmSync(file, { force: true });
        } else {
            writeShownList(file, next);
        }
        return reset ? { ok: true, written: true, reset: true } : { ok: true, written: true };
    } catch {
        return { ok: false, reason: 'write failed' };
    } finally {
        lock.release();
    }
}

// Append entries to the shown file through rewriteShown. `prune`, where given,
// answers the list the entries join, inside the same lock, which is how memq's
// stale sweep runs on every judged block's write; a throw out of it is a
// failed write that leaves the file as it was. `{ ok: true }`, with
// `reset: true` where the write reset a file past the ceiling, or a named
// omission `{ ok: false, reason }`: no session id of the harness's shape, or
// any of rewriteShown's own. Never throws.
function appendShown(cwd, sessionId, entries, prune) {
    if (!planLib.isSessionIdShaped(sessionId)) return { ok: false, reason: 'no session id' };
    if (!Array.isArray(entries) || entries.length === 0) return { ok: false, reason: 'nothing judged' };
    const file = shownFilePath(cwd);
    try {
        compact.ensureScratchDirIgnored(path.dirname(file));
    } catch {
        return { ok: false, reason: 'lock failed' };
    }
    const written = rewriteShown(file,
        (list) => (typeof prune === 'function' ? prune(list) : list).concat(entries));
    if (!written.ok) return written;
    return written.reset === true ? { ok: true, reset: true } : { ok: true };
}

// Rewrite an existing shown file through rewriteShown, for the two readers
// that key an outcome to its entries, answering rewriteShown's own result,
// its `reset` included. An absent file answers `{ ok: true, written: false }`
// and nothing is created, not even the directory or the lock, since a project
// the block never judged in has no file to key against. Never throws.
function updateShown(cwd, change) {
    const file = shownFilePath(cwd);
    try {
        fs.lstatSync(file);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, written: false };
        return { ok: false, reason: 'file unreadable' };
    }
    return rewriteShown(file, change);
}

// Whether a list member is an entry of the shape shownEntries writes, read
// with the bounds the outcome row's columns hold: a session id of the
// harness's shape, a record name and a recognition id each within the
// journal's own caps and charset, a score from 0 to 1, a positive whole rank
// no wider than the host queue admits as a vector rank (a 32-bit signed
// integer, memory-database.js's VECTOR_RANK_MAX, which a test holds equal to
// this module's RANK_MAX), a boolean shown flag, a time and
// a `marked` that is null or a time. The file sits under a directory a
// repository can carry, so the two readers that key an outcome to an entry
// act only on one that passes.
const RECOGNITION_ID = /^[A-Za-z0-9-]{1,64}$/;
const RECORD_NAME = /^[\w.-]{1,80}$/;
const RANK_MAX = 2147483647;
function isShownEntry(e) {
    return e !== null && typeof e === 'object' && !Array.isArray(e)
        && planLib.isSessionIdShaped(e.session)
        && typeof e.name === 'string' && RECORD_NAME.test(e.name)
        && typeof e.recognitionId === 'string' && RECOGNITION_ID.test(e.recognitionId)
        && typeof e.score === 'number' && e.score >= 0 && e.score <= 1
        && Number.isSafeInteger(e.rank) && e.rank >= 1 && e.rank <= RANK_MAX
        && typeof e.shown === 'boolean'
        && typeof e.time === 'string'
        && (e.marked === null || typeof e.marked === 'string');
}

// The sentence the block adds to its note where appendShown's omission means
// the judged candidates went unrecorded, or null. A write that succeeded, and
// a caller with no session id, whose silence is the designed one, add none.
function shownOmissionNote(result) {
    if (result === null || typeof result !== 'object' || result.ok === true) return null;
    if (result.reason === 'no session id') return null;
    return 'What the judge read was not recorded (' + result.reason + ').';
}

module.exports = {
    FETCH_LIMIT,
    FIRST_FLOOR,
    SECOND_FLOOR,
    BUDGET_EDGE_MS,
    RETRY_DELAY_MS,
    QUESTION,
    CRITERIA_TRUE,
    CRITERIA_FALSE,
    NO_RECORD_LINE,
    NO_CANDIDATE_LINE,
    SHOWN_FILE,
    RANK_MAX,
    judgeConfigured,
    candidateOf,
    questionsFor,
    standDownLine,
    judge,
    selectShown,
    planParts,
    sectionForNext,
    assembleState,
    inProgressPlan,
    lastOperatorMessage,
    gitSituation,
    composeSituation,
    shownFilePath,
    shownEntries,
    readShownList,
    appendShown,
    updateShown,
    isShownEntry,
    shownOmissionNote
};
