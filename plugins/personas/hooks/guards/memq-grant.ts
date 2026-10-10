// memq-grant.ts: the permission grant for the kit's own memq CLI, the kit's
// memq-grant.js ported whole and answered on tool.check rather than as a
// PreToolUse hook. Under the engine's write-gated spawn vector Bash refuses
// `node <script>` even for memq, so a fleet worker there loses memory recall
// and outcome logging. The grant answers allow for exactly one command shape
// and is silent on everything else.
//
// The grant requires all of:
//   - The fleet-store signals: KIT_MEMORY_ROOT set and
//     KIT_MEMORY_ROOT_ALLOW_DATA === "1", memq's own storeSignalsPresent()
//     test, and memq.js present as a file at the located kit install, since
//     a grant of a script that is not there serves nobody.
//   - The tool is Bash and the command is one `node` invocation whose first
//     argument is an absolute spelling that resolves, by normalized path
//     equality, to <kit install>/scripts/memq.js, the install hooks/index.ts
//     locates for every memq run. A relative spelling is refused, since the
//     Bash tool's shell keeps a working directory nothing pins. On Windows the
//     target must carry a drive-letter root as written: a rootless slash path
//     and the Git-Bash /d/... spelling can name one file here and another to
//     the child.
//   - The verb, the word right after the script path, is one of
//     GRANTED_VERBS, and no withheld flag shape is anywhere on the line. Each
//     withholding and its reason are stated where it is tested below.
//   - The interpreter is positively identified: the first `node` candidate on
//     PATH, wrapper spellings included on Windows, is the node binary every
//     memq run of this session spawns (executableOf), by realpath equality.
//     NODE_OPTIONS, NODE_PATH and NODE_REPL_EXTERNAL_MODULE refuse the grant
//     whenever any is set, since each selects code for the granted child.
//   - The command line is free of shell metacharacters, control bytes, odd
//     whitespace and escaped quotes anywhere, and of any word bash would
//     rewrite before the child sees it (brace, glob, bracket, leading tilde,
//     unquoted backslash, a word opening with #), so the words screened here
//     are the words the child receives.
//
// Threat model: the expensive failure is a silent over-grant, a command this
// grant allows that runs anything other than the kit's memq.js under the
// session's own node. Silence is the safe failure: a payload outside the one
// shape, an unreadable environment, an unlocatable install or interpreter,
// all answer no grant and leave the engine's own verdict standing.
//
// Nothing here reads `$` (runner.ts says why). The environment, the kit
// install, the PATH walk and the realpath reads reach the grant through the
// deps hooks/index.ts builds.

import { pathOpsOf } from "./readonly-agent";

// Banned anywhere, inside quotes or out: one of these turns one command into
// two, or into one whose text the shell composes. Quote parity is what an
// attacker manipulates, so the ban does not ask which span a character is in.
const METACHARACTERS = /[;&|<>`$()]/;

// Banned anywhere, tab excepted: a C0 control byte or DEL. Bash strips NUL
// from a command line, so a word read here as delete-type\0 reaches the child
// as delete-type.
const CONTROL_BYTE = /[\x00-\x08\x0a-\x1f\x7f]/;

// Banned in unquoted spans only, by words(): brace and pathname expansion
// turn one word read here into several the child sees.
const EXPANSION = /[{}*?\[\]]/;

// Any whitespace but a plain space or tab, anywhere: bash does not split on
// these, so the splitter must never meet one.
const ODD_WHITESPACE = /[^\S \t]/;

// A backslash before a quote, anywhere: the shell and the splitter would read
// the quote differently.
const ESCAPED_QUOTE = /\\["']/;

// node's own variables that load or resolve code the command line never
// names, each refusing the grant when set at all.
export const PRELOAD_ENV = ["NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE"] as const;

// The verbs the grant covers: memq's subcommands less the thirteen withheld.
// Withheld for what they destroy: delete-type and delete-operator (a shared
// record's row out of every read) and forget (a project record's). Withheld
// for what they author: anchor (a record's drift claim) and triggers (when a
// record of any tier is put in front of a session). Withheld because no
// fleet worker's task asks for them: db-sync (stands down under the store
// signals anyway), db-refresh, meter-drain and stamp-read (the module's own
// processes), db-promote and db-curate (the curator's act), and
// jev-calibration (the operator's reading). find is withheld pending a
// decision on granting it. An allowlist, so a verb the CLI gains later is
// withheld until listed here.
const GRANTED_VERBS: ReadonlySet<string> = new Set([
  "log", "get", "applied", "recall", "recall-candidates", "judged", "recent", "unstamped", "touch",
  "add-type", "add-operator", "put", "decay-scan", "decay-prune", "decay-done",
]);

// The reason the allow carries, the kit hook's permissionDecisionReason.
export const MEMQ_GRANT_REASON =
  "kit memq CLI: one node invocation of this plugin's own scripts/memq.js, metacharacter-free, under the gated fleet memory store";

// Shell words of a metacharacter-clean command: space and tab split, a quoted
// span joins onto the current word as the shell joins it. Null for every
// spelling where this splitter and bash diverge: an unterminated quote, a
// backslash outside quotes, an unquoted word opening with # or ~, and an
// unquoted expansion character. A tilde later in a word is literal to bash
// and kept; an assignment-shaped word's tilde expands after its = and keeps
// its prefix, so it can become neither a screened word nor the script path.
function words(cmd: string): string[] | null {
  const out: string[] = [];
  let cur: string | null = null as string | null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '"' || c === "'") {
      const close = cmd.indexOf(c, i + 1);
      if (close < 0) return null;
      cur = (cur === null ? "" : cur) + cmd.slice(i + 1, close);
      i = close;
      continue;
    }
    if (c === "\\") return null;
    if (c === "#" && cur === null) return null;
    if (c === "~" && cur === null) return null;
    if (EXPANSION.test(c)) return null;
    if (c === " " || c === "\t") {
      if (cur !== null) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    cur = (cur === null ? "" : cur) + c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

// A screened flag as its own word or with a value attached after "=". The
// "=" is part of the match, so --body never screens --body-file.
function screensFlag(argv: readonly string[], flag: string): boolean {
  return argv.some((word) => word === flag || word.startsWith(flag + "="));
}

// The attached-value spelling alone, for a flag whose bare word the grant
// keeps: bare --type reads the calling project's own declared tier, while
// --type=<type> names any tier the store holds.
function screensValuedFlag(argv: readonly string[], flag: string): boolean {
  return argv.some((word) => word.startsWith(flag + "="));
}

// The candidate names PATH could offer the child's shell as `node`, in the
// order a wrapper would preempt the binary. No wrapper spelling can
// realpath-equal the binary, so one anywhere ahead of it refuses.
function nodeCandidates(windows: boolean): readonly string[] {
  return windows ? ["node", "node.cmd", "node.bat", "node.com", "node.ps1", "node.exe"] : ["node"];
}

// What the grant reaches through hooks/index.ts. `env` answers the five
// variables the grant reads, unset as undefined. `memqPath` is
// <kit install>/scripts/memq.js, or null where no install is located.
// `isFile` follows links; `realPath` answers where a path lands, or null.
// `interpreter` is the absolute node every memq run of this session spawns,
// or null where PATH holds none.
export type MemqGrantDeps = {
  windows(): Promise<boolean>;
  env(): Promise<{
    KIT_MEMORY_ROOT?: string;
    KIT_MEMORY_ROOT_ALLOW_DATA?: string;
    NODE_OPTIONS?: string;
    NODE_PATH?: string;
    NODE_REPL_EXTERNAL_MODULE?: string;
  }>;
  memqPath(): Promise<string | null>;
  pathValue(): Promise<string>;
  isFile(path: string): Promise<boolean>;
  realPath(path: string): Promise<string | null>;
  interpreter(): Promise<string | null>;
};

// Whether the first `node` candidate on PATH is the session's own
// interpreter, by realpath equality. An empty PATH, no candidate, or a
// realpath that fails at the winning candidate refuses. A shell function or
// alias named node preempts PATH outside anything visible here, which is why
// the grant is also bounded by what memq.js itself can do.
async function interpreterIsSelf(deps: MemqGrantDeps, windows: boolean): Promise<boolean> {
  const pathValue = await deps.pathValue();
  if (!pathValue) return false;
  const path = pathOpsOf(windows);
  const self = await deps.interpreter();
  if (self === null) return false;
  for (const dir of pathValue.split(windows ? ";" : ":")) {
    if (!dir) continue;
    for (const name of nodeCandidates(windows)) {
      const candidate = path.join(dir, name);
      let isFile = false;
      try {
        isFile = await deps.isFile(candidate);
      } catch {
        isFile = false;
      }
      if (!isFile) continue;
      const [a, b] = await Promise.all([deps.realPath(candidate), deps.realPath(self)]);
      return a !== null && b !== null && path.relative(a, b) === "";
    }
  }
  return false;
}

/**
 * Whether a tool.check question is the grant's to judge at all: a Bash call
 * whose first shell word, as the grant splits words, is `node`. Every other
 * call is outside the one shape before anything is read, so it writes no
 * verdict line.
 */
export function memqGrantMatches(tool: string, input: unknown): boolean {
  if (tool !== "Bash") return false;
  const cmd = (input as { command?: unknown } | null)?.command;
  return typeof cmd === "string" && words(cmd)?.[0] === "node";
}

/**
 * Whether the call is the one shape the grant allows: one `node` invocation
 * of the kit install's scripts/memq.js with a granted verb, no withheld flag,
 * under the fleet-store signals and the session's own interpreter, on a
 * metacharacter-free line. False is silence: the engine's own verdict stands.
 */
export async function memqGrantable(tool: string, input: unknown, deps: MemqGrantDeps): Promise<boolean> {
  if (tool !== "Bash") return false;
  const cmd = (input as { command?: unknown } | null)?.command;
  if (typeof cmd !== "string" || !cmd.trim()) return false;
  if (METACHARACTERS.test(cmd) || CONTROL_BYTE.test(cmd) || ODD_WHITESPACE.test(cmd) || ESCAPED_QUOTE.test(cmd)) return false;

  const env = await deps.env();
  if (!env.KIT_MEMORY_ROOT || env.KIT_MEMORY_ROOT_ALLOW_DATA !== "1") return false;
  const memq = await deps.memqPath();
  if (memq === null) return false;
  if (!(await deps.isFile(memq))) return false;
  for (const name of PRELOAD_ENV) {
    if (env[name] !== undefined) return false;
  }

  const w = words(cmd);
  // The interpreter, the script path and the verb are read by index.
  if (w === null || w.length < 3 || w[0] !== "node") return false;

  const windows = await deps.windows();
  const path = pathOpsOf(windows);
  const target = w[1];
  if (windows) {
    if (!/^[A-Za-z]:[\\/]/.test(target)) return false;
  } else if (!path.isAbsolute(target)) {
    return false;
  }
  if (path.relative(path.resolve(target), path.resolve(memq)) !== "") return false;

  // The verb by allowlist, then the flags no prompt-free allow covers:
  // --body-file reads a caller-named path into the store; --update with
  // --body replaces a record whole; --replace on the two shared-tier add
  // verbs writes a shared record whole; --supersedes demotes a record no pin
  // protects; --trigger writes at creation the line the triggers verb is
  // withheld for; --rollup discards journal prose; --drop-malformed deletes
  // sidecar lines; --type=<type> names a tier the project never opted into.
  if (!GRANTED_VERBS.has(w[2])) return false;
  if (screensFlag(w, "--body-file")) return false;
  if (screensFlag(w, "--update") && screensFlag(w, "--body")) return false;
  if ((w[2] === "add-operator" || w[2] === "add-type") && screensFlag(w, "--replace")) return false;
  if (screensFlag(w, "--supersedes")) return false;
  if (screensFlag(w, "--trigger")) return false;
  if (screensFlag(w, "--rollup")) return false;
  if (screensFlag(w, "--drop-malformed")) return false;
  if (screensValuedFlag(w, "--type")) return false;

  // Last, because it walks PATH on the file system.
  return interpreterIsSelf(deps, windows);
}
