// skill-pick.ts: the skill pick's observation. Every prompt of an armed
// persona session is put to Jev, in shadow, as the skill-pick question: which
// one of the installed skills should the session invoke for this prompt, or
// none. The skills the session's main loop then invoked in that turn are
// written against the call as its next_skill outcome, so the journal holds
// Jev's pick beside the session's own choice. Nothing here holds a prompt or
// changes which skill a session invokes.
//
// hooks/index.ts makes four calls into this file. session.start builds the
// catalog through skillPickStart. prompt.submit calls skillPickPrompt, which
// settles a stamp still pending and fires the ask. tool.call hands each
// main-loop call to skillPickTool. turn.complete calls skillPickSettle on a
// completion that is not a subagent loop's. The catalog and the pending stamp
// live in this module, one of each per loaded plugin.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts (hooks/host.ts says why), so
// this file takes the two file calls it needs as an interface hooks/index.ts
// builds over `$`, and takes the shadow ask and the outcome writer as
// functions, since both read the session's own state there. Nothing here
// throws: a root that will not list or a SKILL.md that will not read costs
// the skills it held, and a throw from a function the caller handed in ends
// that call's step alone.

import { bracketSafeText, oneLine } from "./agent-state";
import { SKILL_TOOL } from "./compaction";
import type { QuestionResolver } from "./decision-seam";
import { skillPickResolverOf, skillPickStateText, SKILL_PICK, SKILL_PICK_NONE } from "./question-catalog";

// One entry of a listing as the engine's $.fs.list gives it, as far as the
// catalog reads it.
export type SkillPickEntry = { name: string; kind: string };

// What the catalog reads through: hooks/index.ts builds it over $.fs.list and
// $.fs.read. Both reject on a path that is missing or of the wrong kind.
export type SkillPickFs = {
  list(path: string): Promise<readonly SkillPickEntry[]>;
  read(path: string): Promise<string>;
};

// One installed skill: its folder name, which is its option id, and the
// description its SKILL.md declares, which is the option's criterion.
export type SkillPickSkill = { readonly id: string; readonly description: string };

// Where the kit plugin is installed, or why it could not be resolved, as
// hooks/index.ts's kitInstallPathOf answers.
export type SkillPickKitRoot = { installPath: string } | { skip: string };

// The one decision a session start may log about the catalog.
export type SkillPickDecision = { timestamp: number; loop: "monitor"; action: "skill_pick_catalog"; detail: string };

// Writes one outcome against a call's stamp id. The arguments come in
// hooks/ask-layer.ts's shadowOutcome order, after its host, so the caller hands
// them on as they arrive.
export type SkillPickOutcome = (callStampId: string, kind: "next_skill", value: string) => void;

// Fires the shadow ask and returns the call's stamp id, or null where nothing
// was sent. `site`, `questionSetId`, `optionIds` and `state` come in
// hooks/ask-layer.ts's shadowAsk order, after its host, so the caller hands them
// on as they arrive. The question is read through the resolver `wrap` builds
// over the caller's own.
export type SkillPickAsk = (
  wrap: (base: QuestionResolver) => QuestionResolver,
  site: string,
  questionSetId: string,
  optionIds: readonly string[],
  state: string,
) => string | null;

// How many distinct skill names one turn's outcome carries. A turn invokes
// one or two skills, so the cap binds only on a turn that loops on Skill calls.
export const SKILL_PICK_NAMES_MAX = 8;

// The most characters the skill_pick_catalog decision's detail carries.
const SKILL_PICK_DETAIL_MAX = 50;

// The catalog the last session start built, empty until one has built it and
// whenever jevMode is not shadow.
let catalog: readonly SkillPickSkill[] = Object.freeze([]);

// The stamp of the last prompt's call, with the distinct skill names the main
// loop has invoked since that prompt, or null where no call is waiting for its
// outcome.
let pending: { stampId: string; names: string[] } | null = null;

// The description a SKILL.md declares: the one `description:` line of its
// frontmatter, holding the whole value in double quotes, with each escape
// resolved, or null where the file has no frontmatter, no such line, more
// than one, a value in another shape (single-quoted, folded, or running onto
// a second line), or an empty value. CRLF is read as LF. The shape is the
// one test/skill-description.test.js pins for every shipped skill, read with
// that test's own expressions.
export function skillDescriptionOf(text: string): string | null {
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text.replace(/\r\n/g, "\n"));
  if (front === null) return null;
  const lines = front[1].split("\n").filter((line) => /^description:/.test(line));
  const quoted = lines.length === 1 ? /^description: "((?:[^"\\]|\\.)*)"\s*$/.exec(lines[0]) : null;
  if (quoted === null) return null;
  const value = quoted[1].replace(/\\(.)/g, "$1");
  return value.length > 0 ? value : null;
}

// A Skill call's skill as an option id: everything through the last colon is
// cut, so `grimoire:brainstorming` reads as `brainstorming`. Null where the
// value is not a string or the cut leaves nothing.
export function skillNameOf(skill: unknown): string | null {
  if (typeof skill !== "string") return null;
  const name = skill.slice(skill.lastIndexOf(":") + 1);
  return name.length > 0 ? name : null;
}

// The folder names a root lists, or null where the listing rejected, threw or
// answered with something that is not a list. Only an entry the listing calls
// a directory is a folder; every other entry is left out.
async function folderNamesOf(fs: SkillPickFs, root: string): Promise<string[] | null> {
  let listed: unknown;
  try {
    listed = await fs.list(root);
  } catch {
    return null;
  }
  if (!Array.isArray(listed)) return null;
  return listed
    .filter((e): e is SkillPickEntry => e !== null && typeof e === "object" && e.kind === "dir" && typeof e.name === "string")
    .map((e) => e.name);
}

// The skills under `roots`, in order: each folder directly under a root whose
// SKILL.md declares a description, as skillDescriptionOf reads it. A folder
// whose SKILL.md will not read, is not text, or declares no description is
// passed over and counted. A folder whose name is already in the catalog, or
// is the none option's id, is passed over uncounted, so the first root's
// skill of a name stands. A root that will not list is named in `unlisted`.
// Nothing deeper than one folder under a root is read. The catalog and each
// entry are frozen.
export async function buildSkillCatalog(
  fs: SkillPickFs,
  roots: readonly string[],
): Promise<{ skills: readonly SkillPickSkill[]; passedOver: number; unlisted: string[] }> {
  const skills: SkillPickSkill[] = [];
  const ids = new Set<string>([SKILL_PICK_NONE]);
  const unlisted: string[] = [];
  let passedOver = 0;
  for (const root of roots) {
    const names = await folderNamesOf(fs, root);
    if (names === null) {
      unlisted.push(root);
      continue;
    }
    for (const id of names) {
      if (ids.has(id)) continue;
      let text: unknown;
      try {
        text = await fs.read(`${root}/${id}/SKILL.md`);
      } catch {
        text = null;
      }
      const description = typeof text === "string" ? skillDescriptionOf(text) : null;
      if (description === null) {
        passedOver += 1;
        continue;
      }
      ids.add(id);
      skills.push(Object.freeze({ id, description }));
    }
  }
  return { skills: Object.freeze(skills), passedOver, unlisted };
}

// Builds the catalog at a session start, replacing the last one. Under any
// jevMode but shadow the catalog is emptied and nothing is listed, read or
// resolved, so no prompt is asked. Under shadow the roots are the personas
// plugin's own skills under `personasRoot` and, where `kitRoot` resolves the
// kit plugin's install path, the kit's skills under it. Returns the one
// skill_pick_catalog decision for the caller to log where children were
// passed over, a root would not list or the kit root was skipped, and none
// otherwise. Never rejects.
export async function skillPickStart(
  fs: SkillPickFs,
  mode: string,
  personasRoot: string,
  kitRoot: () => Promise<SkillPickKitRoot>,
): Promise<SkillPickDecision[]> {
  catalog = Object.freeze([]);
  if (mode !== "shadow") return [];
  try {
    const personasSkills = `${personasRoot}/skills`;
    let kit: SkillPickKitRoot;
    try {
      kit = await kitRoot();
    } catch {
      kit = { skip: "install path unresolved" };
    }
    const kitSkills = "installPath" in kit ? `${kit.installPath}/skills` : null;
    const built = await buildSkillCatalog(fs, kitSkills === null ? [personasSkills] : [personasSkills, kitSkills]);
    catalog = built.skills;
    const parts: string[] = [];
    if (built.passedOver > 0) parts.push(`skills passed over: ${built.passedOver}`);
    if (built.unlisted.includes(personasSkills)) parts.push("personas skills did not list");
    if ("skip" in kit) parts.push(`kit: ${kit.skip}`);
    else if (kitSkills !== null && built.unlisted.includes(kitSkills)) parts.push("kit skills did not list");
    if (parts.length === 0) return [];
    const detail = bracketSafeText(oneLine(parts.join("; "))).slice(0, SKILL_PICK_DETAIL_MAX);
    return [{ timestamp: Date.now(), loop: "monitor", action: "skill_pick_catalog", detail }];
  } catch {
    return [];
  }
}

// Writes the pending stamp's outcome, the names joined by commas in the order
// they were invoked or none, and clears it. The stamp is cleared before the
// writer runs, so a writer that throws cannot leave it to be written twice.
// Nothing where no stamp is pending.
export function skillPickSettle(out: SkillPickOutcome): void {
  const held = pending;
  if (held === null) return;
  pending = null;
  try {
    out(held.stampId, "next_skill", held.names.length > 0 ? held.names.join(",") : SKILL_PICK_NONE);
  } catch { /* the writer's own throw; the outcome is lost and the hook goes on */ }
}

// At a prompt: settles a stamp whose turn never completed, then, where the
// catalog holds a skill, asks at site skill-pick over the skill ids plus
// none, the state being the prompt's origin kind and head as
// skillPickStateText writes them, and keeps the returned stamp pending with
// no names. An empty catalog asks nothing, and an ask that returns null or
// throws keeps nothing pending.
export function skillPickPrompt(out: SkillPickOutcome, originKind: string, prompt: string, ask: SkillPickAsk): void {
  skillPickSettle(out);
  const skills = catalog;
  if (skills.length === 0) return;
  try {
    const wrap = (base: QuestionResolver) => skillPickResolverOf(base, skills);
    const stampId = ask(wrap, SKILL_PICK, SKILL_PICK, [...skills.map((s) => s.id), SKILL_PICK_NONE], skillPickStateText(originKind, prompt));
    if (stampId !== null) pending = { stampId, names: [] };
  } catch { /* the ask's own throw; this prompt is not measured */ }
}

// A main-loop tool call: a Skill call's cut name joins the pending list where
// a stamp is pending, the name is new to the list and the list holds fewer
// than SKILL_PICK_NAMES_MAX names. Any other call, and any call while no
// stamp is pending, is not collected. A call is collected as the main loop
// makes it, before it runs, so a Skill call a later guard or the engine
// refuses still counts.
export function skillPickTool(call: { tool?: unknown; skill?: unknown }): void {
  if (pending === null || call.tool !== SKILL_TOOL) return;
  const name = skillNameOf(call.skill);
  if (name === null || pending.names.length >= SKILL_PICK_NAMES_MAX || pending.names.includes(name)) return;
  pending.names.push(name);
}
