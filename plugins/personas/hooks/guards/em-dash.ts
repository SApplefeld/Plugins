// em-dash.ts: the before-tool guard that keeps the em dash (U+2014) out of
// every file a session writes outside the plan and journal directories.
//
// It binds every session the module loads in, the main loop and every
// subagent alike, and keys on no agent type. It reads the text a Write, Edit
// or MultiEdit call inserts: content for a Write, new_string for an Edit, and
// every edits[].new_string for a MultiEdit. It never reads old_string, so an
// edit that removes an em dash passes. A call inserting the byte is denied
// unless the target path has an ancestor directory pair docs/plans or
// docs/archive, or a directory named .kit: the plan documents, the archive
// and the gitignored scratch are internal records, where the doctrine
// tolerates the byte. The path is read as the tool names it (file_path, or
// path), split on both / and \, and matched on whole consecutive segments
// above the file name without regard to letter case, so docs/plans-old/x.md
// is not exempt and Docs/Plans/x.md is.
//
// Every other file is refused, in a repository or outside one. So the guard
// also refuses a journal file written outside those directories, such as a
// commit or pull request body file, and an edit whose new text keeps an em
// dash the file already held. Such a refusal costs one rewrite with other
// punctuation, and widening the exemption is one list.
//
// The bar is the ordinary act of writing an em dash into an outward-facing
// file. Out of its reach: a shell redirect, tee or script that writes the
// byte (the exotic writes docs-write.ts lists), NotebookEdit and every tool
// the guard does not name, text that reaches a file as the byte's escape
// sequence, a path spelled through a link or through a .. segment after an
// exempt directory, every file of a worktree checked out below a .kit
// directory, and a file renamed or copied into place after it was written.
//
// The guard matches every Write, Edit and MultiEdit, so each one pays the
// runner's context build and one guard_verdict journal line. A call whose text
// holds no byte then costs one indexOf per inserted string, with no path work.
// A guard error is a deny, so a call the guard could not read is never passed
// unread.
//
// Nothing here reads `$` (runner.ts says why), and the source holds the byte
// only as a character code.

import type { BeforeGuard, GuardCall } from "./runner";

// The tools the guard reads.
const EM_DASH_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

// U+2014, built from its code so this file holds no raw byte.
const EM_DASH = String.fromCharCode(0x2014);

// The doctrine bullet the refusal enforces, by its opening words.
const DASH_RULE = "No em dashes on any outward-facing surface";

// What the guard reaches through hooks/index.ts: the fold and bracket guard a
// quoted path takes on its way to the model.
export type EmDashDeps = { quote(text: string): string };

// The strings a call inserts: content, new_string, and each edit's
// new_string. A value that is not a string is not inserted text.
function insertedTexts(e: GuardCall): string[] {
  const out: string[] = [];
  if (typeof e.content === "string") out.push(e.content);
  if (typeof e.new_string === "string") out.push(e.new_string);
  if (Array.isArray(e.edits)) {
    for (const edit of e.edits) {
      const s = edit !== null && typeof edit === "object" ? (edit as { new_string?: unknown }).new_string : undefined;
      if (typeof s === "string") out.push(s);
    }
  }
  return out;
}

// True when a directory above the file name is docs/plans, docs/archive or
// .kit, compared on whole segments and without regard to case.
function inExemptDirectory(target: string): boolean {
  const segments = target.split(/[\\/]/).map((s) => s.toLowerCase());
  const dirs = segments.slice(0, -1);
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] === ".kit") return true;
    if (dirs[i] === "docs" && (dirs[i + 1] === "plans" || dirs[i + 1] === "archive")) return true;
  }
  return false;
}

function refusal(what: string): string {
  return `Blocked: em-dash refuses ${what}. Use a comma, period, colon, parentheses or a spaced hyphen, and write the escape \\u2014 where test data needs the byte (the doctrine's "${DASH_RULE}" rule).\n`;
}

/**
 * Denies a Write, Edit or MultiEdit whose inserted text holds U+2014, unless
 * the target has an ancestor directory docs/plans, docs/archive or .kit, with
 * one line naming the byte and the file as the call named it. Any session's
 * call, keyed on no agent type.
 */
export function emDashGuard(deps: EmDashDeps): BeforeGuard {
  return {
    name: "em-dash",
    matches: (e: GuardCall) => EM_DASH_TOOLS.has(e.tool),
    decide: (e: GuardCall) => {
      try {
        if (!insertedTexts(e).some((text) => text.indexOf(EM_DASH) >= 0)) return {};
        const raw = e.file_path ?? e.path;
        const target = typeof raw === "string" ? raw : "";
        if (target !== "" && inExemptDirectory(target)) return {};
        const named = target === "" ? "a file the call did not name" : deps.quote(target);
        return { deny: refusal(`an em dash (U+2014) written to ${named}`) };
      } catch (err) {
        const failure = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
        return { deny: refusal(`a write it could not finish reading (${deps.quote(failure)}), rather than pass unread text`) };
      }
    },
  };
}
