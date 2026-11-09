// dispatch-docs.ts: the before-tool guard that keeps a docs/ write from
// reaching an implementer through its dispatch brief.
//
// The docs-write guard refuses every implementer write under docs/, so a
// brief that assigns an implementer a docs/ file sends it to a refusal or to a
// shell route around one. This guard refuses that brief at the Agent call that
// dispatches it, whatever the dispatching session has read. It matches every
// Agent call, the main loop's and a subagent's alike, and acts only where the
// call's subagent_type is an implementer tier, MUTATING_SEAT in agent-class.ts.
//
// It reads one field of the prompt, the brief's Files in scope. The field
// opens on a line beginning with the field's name in any letter case, after
// an optional >, an optional marker (a heading's one to six #, -, *, +, or a
// number and a period or a parenthesis) and an optional ** before the name,
// whatever follows it. So "- Files in scope (new and modified):" and "Files
// in scope for this section:" open the field, and so does a prose sentence
// opening with the words, such as "Files in scope exclude docs/x.md, which I
// hold.", which refuses: a false refusal in the safe direction. The rest of
// that line, after an optional ** and colon, counts. Where it holds no
// path-shaped token, one with a / or \ followed by more text or ending in a
// file extension, blank lines directly after it are skipped, so a label such
// as "(new and modified):" followed by a blank line and then a list, bulleted
// or not, is read.
//
// The block then runs to the first of three ends. One is a brief field line
// at any indent. Another is a heading line, one to six # and a space or the
// line's end after an optional >. The last is a blank line whose next
// non-blank line is not a list item, is a brief field line, or is a heading.
// So a loose list, blank lines between its bullets, stays one block, while a
// blank line followed by prose or by a "## Context" section ends it. A list
// item is a line opening with an optional >, then -, *, + or a number and a
// period or a parenthesis, then whitespace.
//
// A brief field line opens, after an optional >, an optional marker (-, *, +,
// a number and a period or a parenthesis, or one to six #) and an optional
// **, with a name from
// BRIEF_FIELD_NAMES, the Dispatch Brief template's own field list in
// implementing.md, a conditional entry by the words after its bracketed
// condition, plus the common brief labels Verify, Model, Locus, Goal and
// Context, in any letter case. The name must be followed by the line's end,
// whitespace, a colon, a comma, a ( or a *. So "- Tests: ...", "- Acceptance
// criteria (verifiable)", "- Orchestrator-held files, when ..." and "- Spec
// path + section name" end the block, while a path bullet does not:
// "- tests/x.test.js" and "- Tests.md" (a / or a period after the name),
// "- README.md", "- Makefile (the lint target only)" and a verb bullet such
// as "- Create docs/x.md" or "- Update: docs/x.md" (no listed name) all stay
// in it. Any bullet opening with a listed name followed by the line's end, a
// space, a colon, a comma, a ( or a * ends the block, so a docs/ path in it
// or listed after it goes unread: "- tests", "- Tests (all of them)" and
// "- Verify docs/x.md exists" among them.
//
// Each token of the block, split at whitespace and commas, is read with
// backticks, quotes and asterisks stripped, and with leading and trailing
// ( ) [ ] < > @ stripped. A markdown link's text and target are read as
// separate tokens. A token is a hit where it names something under a docs/
// directory: the shape test docs-write.ts holds, with at least one character
// after the docs/ separator. So the template's own words "none under docs/"
// are no hit, and neither is a bare docs/ token. One hit refuses the call.
// The brief's other fields are not read: the spec path under docs/plans, a
// verification row quoted under Verify, and the Orchestrator-held files
// field, which is where a docs/ file beside code is listed, all pass.
//
// A prompt with no Files in scope field allows, so a brief off the Dispatch
// Brief template passes unread. A table-cell form, "| Files in scope |
// docs/x.md |", is not read and allows. An instruction bullet inside the
// block that names a docs/ file the orchestrator holds, such as
// "- Orchestrator holds docs/x.md; return its text.", refuses: the refusal
// names the Orchestrator-held files field, which ends the block. A path named
// under the field and outside the project tree is judged by its shape alone
// and refuses. Out of its reach: a
// Workflow tool agent() dispatch and a SendMessage to an implementer already
// running, since neither is an Agent call, and a brief that assigns a docs/
// file in any field but Files in scope.
//
// Nothing here reads `$` (runner.ts says why). The refusal quotes the agent
// type and the path from the dispatching session's own call, back to that
// session, as docs-write.ts quotes the agent type.

import type { BeforeGuard, GuardCall } from "./runner";
import { MUTATING_SEAT } from "./agent-class";
import { targetsDocs } from "./docs-write";

// The fixed words of the refusal after the agent type and the path. No kit
// command hook ever wrote them, so the guard carries no commandPhrase and a
// shadow reading sets no command verdict beside its own.
export const DISPATCH_DOCS_COMMAND_PHRASE = "under docs/ in its files in scope, and the docs-write guard refuses that agent's writes there";

// What the guard reaches through hooks/index.ts: nothing, since it reads only
// the call's own arguments.
export type DispatchDocsDeps = Record<string, never>;

// The brief field names a line can open with: the Dispatch Brief template's
// field list in executing-work's implementing.md, a conditional entry named by
// the words after its bracketed condition, then the common brief labels
// Verify, Model, Locus, Goal and Context. The guard parity test reads the
// template and fails where one of its field lines opens with no name here.
export const BRIEF_FIELD_NAMES: readonly string[] = [
  "Spec path",
  "Files in scope",
  "Orchestrator-held files",
  "Acceptance criteria",
  "Rich references",
  "Tests",
  "Sibling pattern",
  "Error and delete semantics",
  "The standing hostile-boundary",
  "Pin tests",
  "Lists as computed",
  "Standing Brief Amendments",
  "The standing working-class",
  "Every load-bearing",
  "The standing absence-check",
  "Workaround bar",
  "Promise check",
  "When returning NEEDS_CONTEXT",
  "Style-skill file paths",
  "Build + test commands",
  "The standing box-budget",
  "The two-question grant audit",
  "The instrument that reads",
  "The explicit fable model override",
  "Verify",
  "Model",
  "Locus",
  "Goal",
  "Context",
];

// A line's optional >, marker and ** before a field's name.
const LEAD = String.raw`^[ \t]*(?:>[ \t]*)?(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]*)?(?:\*\*)?`;

// The line that opens the field: the lead, the name, whatever follows it,
// and the rest of the line after an optional ** and colon.
const FIELD_OPEN = new RegExp(LEAD + String.raw`files[ \t]+in[ \t]+scope(?:\*\*)?[ \t]*:?(?:\*\*)?(.*)$`, "i");

// A brief field line: the lead, a listed name, then the line's end,
// whitespace, a colon, a comma, a ( or a *.
const BRIEF_FIELD = new RegExp(
  LEAD + "(?:" + BRIEF_FIELD_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\t]+")).join("|") + ")(?=$|[\\s:,(*])",
  "i",
);

// A list item, a heading, and a blank line.
const LIST_ITEM = /^[ \t]*(?:>[ \t]*)?(?:[-*+]|\d+[.)])[ \t]+\S/;
const HEADING = /^[ \t]*(?:>[ \t]*)?#{1,6}(?:[ \t]|$)/;
const isBlank = (line: string) => !line.trim();

// A path-shaped token: a / or \ with text after it, or a file extension.
const isPathShaped = (token: string) => /[\\/]./.test(token) || /\.[A-Za-z0-9]{1,8}$/.test(token);

// A token naming something under a docs/ directory: the docs-write guard's
// shape test, with at least one character after the docs/ separator.
const NAMES_UNDER_DOCS = /(^|[\\/])docs[\\/]./i;
function namesUnderDocs(token: string): boolean {
  return targetsDocs(token) && NAMES_UNDER_DOCS.test(token);
}

// The tokens of a run of text, in order: split at whitespace and commas, a
// markdown link's text and target split apart, backticks, quotes and
// asterisks stripped, then leading and trailing ( ) [ ] < > @ stripped.
function tokensOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    for (const piece of raw.split("](")) {
      const token = piece.replace(/[`"'*]/g, "").replace(/^[()[\]<>@]+|[()[\]<>@]+$/g, "");
      if (token) out.push(token);
    }
  }
  return out;
}

// True where a non-blank `line` ends the block: a brief field line or a
// heading, at any indent.
function endsBlock(line: string): boolean {
  return BRIEF_FIELD.test(line) || HEADING.test(line);
}

// Walks every Files in scope block in a prompt, handing each token to `visit`
// in prompt order, and returns the first token `visit` answers true for, or
// undefined. The walk resumes at the line that ended a block, so each line is
// read about once.
function walkFilesInScope(prompt: string, visit: (token: string) => boolean): string | undefined {
  const lines = String(prompt || "").split(/\r\n|\r|\n/);
  const take = (text: string): string | undefined => {
    for (const token of tokensOf(text)) {
      if (visit(token)) return token;
    }
    return undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    const open = FIELD_OPEN.exec(lines[i]);
    if (!open) continue;
    const inline = take(open[1]);
    if (inline !== undefined) return inline;
    let j = i + 1;
    if (!tokensOf(open[1]).some(isPathShaped)) {
      while (j < lines.length && isBlank(lines[j])) j++;
    }
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (isBlank(line)) {
        let k = j + 1;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k >= lines.length) break;
        const next = lines[k];
        if (endsBlock(next) || !LIST_ITEM.test(next)) break;
        j = k - 1;
        continue;
      }
      if (endsBlock(line)) break;
      const hit = take(line);
      if (hit !== undefined) return hit;
    }
    i = j - 1;
  }
  return undefined;
}

// The tokens of every Files in scope block in a prompt, read as the guard
// reads them, in prompt order. Empty where the prompt carries no such field.
export function filesInScopeOf(prompt: string): string[] {
  const out: string[] = [];
  walkFilesInScope(prompt, (token) => {
    out.push(token);
    return false;
  });
  return out;
}

/**
 * Denies an Agent call dispatching an implementer tier whose brief lists a
 * path under docs/ in its Files in scope, naming the main-thread route
 * executing-work states. Every other Agent call allows: another agent type, a
 * call naming no type, and a brief with no Files in scope field.
 */
export function dispatchDocsGuard(_deps: DispatchDocsDeps): BeforeGuard {
  return {
    name: "dispatch-docs",
    matches: (e: GuardCall) => e.tool === "Agent",
    decide: (e: GuardCall) => {
      const t = typeof e.subagent_type === "string" ? e.subagent_type.trim() : "";
      if (!t || !MUTATING_SEAT.test(t)) return {};
      if (typeof e.prompt !== "string") return {};
      const hit = walkFilesInScope(e.prompt, namesUnderDocs);
      if (hit === undefined) return {};
      return {
        deny:
          `Blocked: the ${t} dispatch lists ${hit} ${DISPATCH_DOCS_COMMAND_PHRASE}. ` +
          `A section that writes only under docs/ runs in the main thread, Locus: inline under its Model: line, ` +
          `and a docs/ file beside code is listed under the brief's Orchestrator-held files, never under ` +
          `Files in scope (executing-work, implementing.md step 1).\n`,
      };
    },
  };
}
