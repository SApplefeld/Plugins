#!/usr/bin/env node
// plan-contract: reads plan documents against the plan-doc machine contract,
// the table in skills/curating-docs/SKILL.md's "Plan Doc Machine Contract"
// section. `plan-contract.js <path>...` reads each path as given, with no glob
// expansion of its own, and prints one line per fault:
//
//   <path>:<line>: <fault>
//
// or, where no document holds a fault, one line:
//
//   plan-contract: <n> documents, 0 faults
//
// Each fault names the contract row it breaks. A path that cannot be read is a
// fault at line 0. Lines split on \r?\n, so a CRLF checkout reads as an LF one,
// and a leading byte-order mark is dropped, as the engine drops it.
//
// The header is the lines above the first line opening `##`, where the
// engine's Status read stops, so `##Notes` and `### Aside` end it too. A
// document is a spec where its file name's content type, the token between
// the last `_` and `_v`, reads `spec`, as in `claude-kit_x_spec_v1.md`. The
// header rows bind a spec alone, since the engine parks any other document by
// design. The block rows bind wherever their block's heading appears.
//
// The faults, one per row read in its failing direction:
//   Status header: a spec with no `Status:` line or one with no value, or a
//     value opening with `Complete` that is not exactly `Complete`, trimmed
//     and in any case.
//   Commit Model header: a spec with no `Commit Model:` line, or a value
//     opening with none of `Commit-and-Push`, `Branch-and-PR` and
//     `Review-Only`, in any case.
//   Sections of Work heading: a spec with no line reading exactly
//     `## Sections of Work`, a line opening with it that carries more text,
//     or a block holding no `### N.` heading.
//   Section heading: a `###` heading inside the block that is not
//     `### N. <Title>`, a `### N.` heading outside the block, or numbers that
//     do not run 1, 2, 3 in order with no gap or repeat.
//   Section model line: a section with no `Model:` line before the next `###`
//     or `##` heading, a first `Model:` value that trimmed and case-folded is
//     none of `haiku`, `sonnet`, `opus` and `fable`. Where the section has no
//     such line and its heading line itself carries `Model:`, the fault names
//     the heading-line form.
//   Chapters heading: a line opening `## Chapters` that carries more text.
//   Chapter heading: a `### Chapter N` heading outside the Chapters block.
//   Chapter completed line: a Chapter with no `Completed:` line, or a first
//     value that registers no section: it neither opens with a section's
//     number and a period or a space nor equals a section's title exactly.
//     A value carrying `finishing` in any case, or opening with `none`, is
//     exempt, those being the finishing and the abandoned Chapter's forms.
//
// A block is the engine's: the lines after its heading up to the next line
// opening `##`, whitespace and text, and only the first heading of a block's
// name opens it. The four heading literals are the board card's, the forms
// plugins/personas/hooks/plan-record.ts reads. They are exported with the
// block heading and the header end, so the test pins all six against that
// file. The script reads only: it writes no file,
// spawns nothing and reads no git state.
//
// Exit codes:
//   0  no fault, and the summary line printed
//   1  at least one fault, each on its own line
//   2  no path was given, with the usage on stderr

'use strict';

const fs = require('fs');

const SECTIONS_HEADING = /^##\s+Sections of Work\s*$/;
const CHAPTERS_HEADING = /^##\s+Chapters\s*$/;
const CHAPTER_HEADING = /^###\s+Chapter\s+(\d+)/;
const SECTION_HEADING = /^###\s+(\d+)\.\s+(.*)$/;

// The block heading, the card's /^##\s+.+$/ in plan-record.ts's linear form,
// which accepts the same lines without backtracking over a whitespace run.
const TERMINATORS = '\\r' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
const NON_TERMINATOR = `[^${TERMINATORS}]`;
const BLOCK_HEADING = new RegExp(`^##(?:\\s${NON_TERMINATOR}|\\s*[${TERMINATORS}]${NON_TERMINATOR})${NON_TERMINATOR}*$`);

const HEADER_END = /^##/;
const STATUS_LINE = /^status:(.*)$/i;
const COMMIT_MODELS = ['commit-and-push', 'branch-and-pr', 'review-only'];
const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
// The line that ends a section's search for its Model: line.
const SECTION_END = /^###?\s/;

// The content type in a file name, the token between the last `_` and `_v`.
function contentType(relPath) {
    const name = String(relPath || '').split(/[\\/]/).pop();
    const m = /_([^_]*)_v[^_]*$/.exec(name);
    return m ? m[1] : null;
}

// The faults in one document's text, as { line, fault } in line order.
function checkPlanText(text, relPath) {
    const BOM = String.fromCharCode(0xfeff);
    const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/);
    const faults = [];
    const fault = (index, sentence) => faults.push({ line: index + 1, fault: sentence });

    // The header rows.
    let headerEnd = lines.findIndex((l) => HEADER_END.test(l));
    if (headerEnd < 0) headerEnd = lines.length;
    if (contentType(relPath) === 'spec') {
        const absentAt = headerEnd < lines.length ? headerEnd : 0;
        const header = lines.slice(0, headerEnd);
        // The engine's own Status match, so a line holding a lone carriage
        // return or a Unicode line separator is passed over as the engine
        // passes it over.
        const status = header.findIndex((l) => STATUS_LINE.test(l));
        const noStatus = 'Status header row: the spec has no Status: line above its first ## heading, so it never reads as complete.';
        if (status < 0) {
            fault(absentAt, noStatus);
        } else {
            const value = STATUS_LINE.exec(header[status])[1].trim();
            // The engine reads an empty value as no Status line at all.
            if (value === '') {
                fault(status, noStatus);
            } else if (value.toLowerCase().startsWith('complete') && value.toLowerCase() !== 'complete') {
                fault(status, 'Status header row: the value "' + value + '" opens with Complete but is not exactly Complete, so the plan reads as open. Write Status: Complete with nothing after it.');
            }
        }
        const commit = header.findIndex((l) => l.startsWith('Commit Model:'));
        if (commit < 0) {
            fault(absentAt, 'Commit Model header row: the spec has no Commit Model: line above its first ## heading, so the engine parks the run.');
        } else {
            const value = header[commit].slice('Commit Model:'.length).trim();
            if (!COMMIT_MODELS.some((m) => value.toLowerCase().startsWith(m))) {
                fault(commit, 'Commit Model header row: the value "' + value + '" opens with none of Commit-and-Push, Branch-and-PR and Review-Only, so the engine parks the run.');
            }
        }
        if (!lines.some((l) => SECTIONS_HEADING.test(l))) {
            fault(absentAt, 'Sections of Work heading row: the spec has no line reading exactly ## Sections of Work, so the engine counts no section.');
        }
    }

    // The block rows, walking the blocks as the engine does.
    let inSections = false;
    let inChapters = false;
    let sectionsOpened = false;
    let chaptersOpened = false;
    let sectionsAt = -1;
    let expected = 1;
    const sections = [];
    const chapters = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (BLOCK_HEADING.test(line)) {
            if (inSections && sections.length === 0) {
                fault(sectionsAt, 'Sections of Work heading row: the block holds no ### N. heading, so the engine reads zero sections.');
            }
            inSections = !sectionsOpened && SECTIONS_HEADING.test(line);
            inChapters = !chaptersOpened && CHAPTERS_HEADING.test(line);
            if (inSections) { sectionsOpened = true; sectionsAt = i; }
            if (inChapters) chaptersOpened = true;
            if (/^##\s+Sections of Work/.test(line) && !SECTIONS_HEADING.test(line)) {
                fault(i, 'Sections of Work heading row: text after "Sections of Work" means this line opens no block. Write ## Sections of Work alone.');
            }
            if (/^##\s+Chapters/.test(line) && !CHAPTERS_HEADING.test(line)) {
                fault(i, 'Chapters heading row: text after "Chapters" means this line opens no block, so no Chapter under it registers. Write ## Chapters alone.');
            }
            continue;
        }
        const section = SECTION_HEADING.exec(line);
        if (inSections) {
            if (section) {
                sections.push({ index: i, number: section[1], title: section[2].trim() });
                if (Number(section[1]) !== expected) {
                    fault(i, 'Section heading row: section numbers must run 1, 2, 3 in order, and this heading reads ' + section[1] + ' where ' + expected + ' belongs, so a Chapter\'s Completed: line cannot key on it.');
                }
                expected = Number(section[1]) + 1;
            } else if (/^###(?!#)/.test(line)) {
                fault(i, 'Section heading row: a ### heading inside Sections of Work must read ### N. Title, a number, a period, whitespace and the title, and this one does not, so the engine counts nothing here.');
            }
        } else if (section) {
            fault(i, 'Section heading row: this ### N. heading sits outside the Sections of Work block, so the engine never counts it.');
        }
        if (CHAPTER_HEADING.test(line)) {
            if (inChapters) chapters.push(i);
            else fault(i, 'Chapter heading row: this ### Chapter N heading sits outside the ## Chapters block, so it counts nothing.');
        }
    }
    if (inSections && sections.length === 0) {
        fault(sectionsAt, 'Sections of Work heading row: the block holds no ### N. heading, so the engine reads zero sections.');
    }

    for (const s of sections) {
        let model = -1;
        for (let i = s.index + 1; i < lines.length && !SECTION_END.test(lines[i]); i++) {
            if (lines[i].startsWith('Model:')) { model = i; break; }
        }
        if (model < 0 && /Model:/.test(lines[s.index])) {
            fault(s.index, 'Section model line row: the heading line carries Model:, which the engine never reads. Put the Model: line on its own line under the heading.');
        } else if (model < 0) {
            fault(s.index, 'Section model line row: this section has no Model: line before the next heading, so it dispatches at the engine\'s default model.');
        } else {
            const value = lines[model].slice('Model:'.length).trim();
            if (!MODELS.includes(value.toLowerCase())) {
                fault(model, 'Section model line row: the value "' + value + '" is not exactly haiku, sonnet, opus or fable, so the section dispatches at the engine\'s default model. Move any note to its own line.');
            }
        }
    }

    chapters.forEach((at, k) => {
        const end = k + 1 < chapters.length ? chapters[k + 1] : lines.length;
        let completed = -1;
        for (let i = at + 1; i < end && !BLOCK_HEADING.test(lines[i]); i++) {
            if (lines[i].startsWith('Completed:')) { completed = i; break; }
        }
        if (completed < 0) {
            fault(at, 'Chapter completed line row: this Chapter has no Completed: line, so it closes no section.');
            return;
        }
        const value = lines[completed].slice('Completed:'.length).trim();
        if (/finishing/i.test(value) || /^none/i.test(value)) return;
        const registers = sections.some((s) => value.startsWith(s.number + '.') || value.startsWith(s.number + ' ') || value === s.title);
        if (!registers) {
            fault(completed, 'Chapter completed line row: the value "' + value + '" registers no section. Open it with the section number and a period or a space, or write the section title exactly.');
        }
    });

    return faults.sort((a, b) => a.line - b.line);
}

// The faults in each file, as { path, faults }, a file that cannot be read
// holding one fault at line 0.
function checkPlanFiles(paths) {
    return paths.map((p) => {
        let text;
        try {
            text = fs.readFileSync(p, 'utf8');
        } catch (err) {
            return { path: p, faults: [{ line: 0, fault: 'the file could not be read: ' + ((err && err.code) || 'read failed') + '.' }] };
        }
        return { path: p, faults: checkPlanText(text, p) };
    });
}

function main(argv) {
    if (argv.length === 0) {
        process.stderr.write('usage: plan-contract.js <plan path>...\n');
        return 2;
    }
    const found = checkPlanFiles(argv);
    let count = 0;
    for (const doc of found) {
        for (const f of doc.faults) {
            process.stdout.write(doc.path + ':' + f.line + ': ' + f.fault + '\n');
            count++;
        }
    }
    if (count > 0) return 1;
    process.stdout.write('plan-contract: ' + found.length + ' documents, 0 faults\n');
    return 0;
}

module.exports = { checkPlanText, checkPlanFiles, SECTIONS_HEADING, CHAPTERS_HEADING, CHAPTER_HEADING, SECTION_HEADING, BLOCK_HEADING, HEADER_END };

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}
