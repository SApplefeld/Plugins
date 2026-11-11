// shared-state.ts: the before-tool guard that keeps a mutating or gate agent
// off machine-shared state it does not own.
//
// The implementer tiers (the mutating class) and the QA verifier (the gate
// class) hold Bash and change the tree, so the read-only guard leaves them
// alone. What they may not do is end a process they did not start, reach past
// their own files on a checkout another session may commit to, or delete a
// scratch tree another party holds. Each of those is a coordinating seat's act,
// so the refusal names the act and sends the agent to its orchestrator under
// BLOCKED, where the ask runs up one hop.
//
// A denylist, not an allowlist: it denies the closed set of command shapes
// below, and a heredoc the shared walk `heredocWalk` refuses on either
// reading, at any depth, and lets everything else through, an unreadable command included. The
// shapes close ordinary mistakes, not adversarial spellings, so a kill or a
// stash reachable only through a rewritten spelling (a verb assembled from a
// variable, a control character forging a mask sentinel, an operand routed
// through a variable) is out of its reach. So is a branch delete through
// update-ref fed by --stdin, by a write of the zero value, or on a symbolic
// ref other than HEAD that points into refs/heads/, or run by GNU parallel,
// which Git for Windows does not ship. A dispatch naming no
// agentType sits under no class and is out of its reach too.
//
// It denies:
//   a kill selecting by image or name: taskkill with /IM, //IM or -IM, or with
//     a /FI, //FI or -FI filter, in any case; Stop-Process (or its aliases
//     spps and kill) with -Name or -ProcessName, any unique prefix of either,
//     or a positional name; pkill and killall; any Get-Process (or gps, ps)
//     piped into Stop-Process, whatever its selector; and a kill or Stop-Process fed by
//     pgrep or pidof, through a pipe into xargs, a command substitution, or a
//     PowerShell subexpression;
//   a git operation reaching past the agent's own files: stash with any or no
//     subcommand but list; reset --hard or --merge; checkout with --, -f
//     alone or in a short-flag cluster or --force, with ., ./ or .\ as an
//     operand, or with two operands (a tree-ish and a path); switch with
//     --discard-changes, -f alone or in a short-flag cluster or --force;
//     restore, unless it carries --staged without --worktree; clean; branch
//     with --delete or any prefix of it from --d, or a short-flag cluster
//     holding d or D; update-ref with -d alone or in a short-flag cluster,
//     unless its first operand is a readable ref under refs/ and no operand
//     opens refs/heads/ in any case, names HEAD, holds a brace or is
//     unreadable, and no xargs sits ahead of it in its segment or anywhere in
//     a command whose nested shell carries it; worktree remove or prune;
//   a recursive delete (rm with r or R in a short-flag cluster or
//     --recursive, Remove-Item and its aliases with -Recurse or a unique
//     prefix of it, or cmd's rd, rmdir, del or erase with /s) whose target is
//     the git root above the session's working directory, resolves under
//     .kit/ at any depth, globs directly under that root in a way that can
//     expand to .kit (*, .k*), or does not resolve under that root; and a
//     recursive delete whose operand is outside the one shape read as a
//     path (readableName), a brace group, a sequence, a subexpression, a
//     provider prefix or a POSIX class among them, which is denied unread
//     rather than emulated.
// It leaves alone a kill by process id, git stash list, a reset with no mode
// or --soft, a checkout or switch of one branch, restore --staged, a
// non-recursive delete under .kit/, and a recursive delete of the tree's own
// build output. A checkout of one operand is a branch switch to the lexer,
// since a single path cannot be told from a branch name.
//
// Bash and PowerShell commands are read through the read-only guard's lexer,
// so a quoted mention of a shape is data, a heredoc body a data sink writes
// away is data, a chain is judged on its worst member, and a nested shell's
// payload (bash -c, pwsh -Command, cmd /c, eval) or a command substitution's
// interior is read one level deeper, to the same depth bound that guard
// scans. Past the bound an unread payload passes, the denylist direction.
//
// Nothing here reads `$` (runner.ts says why). The .git walk and the path
// arithmetic go through the LexHost hooks/index.ts builds, as the read-only
// guard's do.

import type { BeforeGuard, GuardCall, GuardContext } from "./runner";
import {
  CONTINUATION_CAP_REASON, GIT_VALUE_FLAGS, cmdletOperands, cmdletPaths, commandPositions, delimiterFault, effectiveDirs,
  exactReadingDiffers, heredocBodies, heredocExemption, heredocWalk, maskExact, maskQuoted, memoized, nestedPayloads, offendingDelimiter,
  readUnderContinuations, repoRoot, resolveTarget, segment, spliceContinuations, tokens, type LexHost, type VerdictMemo,
} from "./readonly-agent";
import { sharedStateAgentClass } from "./agent-class";

// A half-open range of command indexes, the lexer's own span shape.
type Span = { from: number; to: number };

// The names each rule scans for, matched in command position (so an alias is
// matched as its cmdlet is) and case-insensitively.
const TASKKILL = ["taskkill"];
const STOP_PROCESS = ["Stop-Process", "spps", "kill"];
const GET_PROCESS = ["Get-Process", "gps", "ps"];
const NAME_KILLERS = ["pkill", "killall"];
const RM = ["rm"];
const REMOVE_ITEM = ["Remove-Item", "ri", "rd", "rmdir", "del", "erase"];
const PROCESS_QUERIES = ["pgrep", "pidof"];

// The depth the read-only guard scans nested command text to; past it an
// unread payload passes here.
const DEPTH_BOUND = 2;

// The command name as the agent typed it, read back from the masked copy at
// the position just past it: the name's own characters are unmasked (a name
// inside a quoted span never matched), so the last run of non-boundary
// characters before `at` is the name, with any directory prefix and
// executable suffix the agent spelled.
function typedName(masked: string, at: number): string {
  const m = /[^\s;|&(`\x02\\/]*$/.exec(masked.slice(0, at));
  return m === null ? "" : m[0];
}

// A token the lexer could not resolve to literal text: one carrying a
// substitution sentinel, a variable, or a PowerShell expression character.
function unreadable(tok: string): boolean {
  return /[\x00-\x1f$%`]/.test(tok);
}

// True when `tok` spells PowerShell parameter `name` whole or as a prefix of at
// least two characters, with an optional :value suffix. PowerShell binds any
// unique prefix, and for the cmdlets read here the prefix is unique from the
// second character; the one-letter forms are admitted by each caller.
function psParam(tok: string, name: string): boolean {
  const m = /^-([A-Za-z]{2,})(?::.*)?$/.exec(tok);
  return m !== null && name.startsWith(m[1].toLowerCase());
}

// -Name, -n, -na, -Name:node, and the alias -ProcessName from -pr up
// (-Pr, -Proc, -ProcessName:node). One letter is admitted for -Name, since
// Stop-Process has no other parameter starting with n; the alias needs two,
// since -PassThru shares its p.
function isNameParam(tok: string): boolean {
  if (psParam(tok, "name") || /^-n(?::.*)?$/i.test(tok)) return true;
  const m = /^-(pr[A-Za-z]*)(?::.*)?$/i.exec(tok);
  return m !== null && "processname".startsWith(m[1].toLowerCase());
}

// -Recurse, -r, -rec. One letter is admitted, since Remove-Item has no other
// parameter starting with r.
function isRecurseParam(tok: string): boolean {
  return psParam(tok, "recurse") || /^-r$/i.test(tok);
}

// True for a Stop-Process parameter that takes a value, so the token after it
// is that value and no operand: any parameter name of two letters or more
// (-Id, -ErrorAction, -InputObject) but the four switches (-Force, -PassThru,
// -WhatIf, -Confirm), and kill's own signal flag (-s TERM). A one-letter or
// numeric flag (-9, -l) takes none, so `kill -9 node` still reads its name.
function takesValue(tok: string): boolean {
  if (/^(?:-s|--signal)$/.test(tok)) return true;
  if (!/^-[A-Za-z]{2,}$/.test(tok)) return false;
  return !["force", "passthru", "whatif", "confirm"].some((sw) => psParam(tok, sw));
}

// True when the command text from `from` to `to` is one pipeline: it holds a
// pipe and no statement or chain separator (;, &, &&, ||, a newline). A || is
// a chain that runs its right side only when the left fails, never a pipe, so
// pgrep node || kill 1234 feeds the kill nothing.
function onePipeline(masked: string, from: number, to: number): boolean {
  const between = masked.slice(from, to);
  return between.includes("|") && !/[;&\n]|\|\|/.test(between);
}

// The process query a kill's operand runs to pick its ids (pgrep or pidof),
// or null: upstream in the same pipeline (pgrep node | xargs kill), inside a
// command substitution ($(pgrep node) or backticks), or inside a PowerShell
// subexpression ((pgrep node)). The query's name is what the kill selects by,
// and it is not readable at the kill. A substitution is read from the raw
// command at the span the mask blanked, so a quoted mention stays data; a
// statement separator between the query and the kill bounds the pipeline
// walk.
function fedBy(cmd: string, masked: string, at: number): string | null {
  const query = commandPositions(masked, PROCESS_QUERIES).find((q) => q.at < at && onePipeline(masked, q.at, at));
  if (query !== undefined) return query.name;
  const seg = segment(cmd, masked, at);
  for (let i = 0; i < seg.length; i++) {
    if (seg[i] === "\x02" && seg[i - 1] !== "\x02") {
      const m = /^(?:\$\(|`)\s*(pgrep|pidof)(?=\s|$|\))/i.exec(cmd.slice(at + i));
      if (m !== null) return m[1].toLowerCase();
    }
    if (seg[i] === "(" && (i === 0 || /\s/.test(seg[i - 1]))) {
      const m = /^\(\s*(pgrep|pidof)(?=\s|$|\))/i.exec(cmd.slice(at + i));
      if (m !== null) return m[1].toLowerCase();
    }
  }
  return null;
}

// The act a process kill in the command performs, or null.
function killAct(cmd: string, masked: string): string | null {
  for (const hit of commandPositions(masked, TASKKILL)) {
    const toks = tokens(segment(cmd, masked, hit.at));
    const i = toks.findIndex((t) => /^(?:\/\/?|-)(?:im|fi)$/i.test(t));
    if (i < 0) continue;
    const target = toks[i + 1] !== undefined && !unreadable(toks[i + 1]) ? ` ${toks[i + 1]}` : "";
    const by = /im$/i.test(toks[i]) ? "image name" : "process filter";
    return `a kill by ${by} (${typedName(masked, hit.at)} ${toks[i]}${target})`;
  }
  for (const hit of commandPositions(masked, NAME_KILLERS)) {
    const toks = tokens(segment(cmd, masked, hit.at));
    const operand = toks.find((t) => !t.startsWith("-") && !unreadable(t));
    return `a kill by process name (${typedName(masked, hit.at)}${operand === undefined ? "" : ` ${operand}`})`;
  }
  for (const hit of commandPositions(masked, STOP_PROCESS)) {
    const name = typedName(masked, hit.at);
    // A process query upstream in the same pipeline selects what the stop
    // ends, and the selector is not readable at the stop: a statement
    // separator between the two bounds the stage walk.
    if (masked.lastIndexOf("|", hit.at) >= 0) {
      const query = commandPositions(masked, GET_PROCESS).find((q) => q.at < hit.at && onePipeline(masked, q.at, hit.at));
      if (query !== undefined) {
        return `a kill through a process query piped into a stop (${typedName(masked, query.at)} | ${name})`;
      }
    }
    const fed = fedBy(cmd, masked, hit.at);
    if (fed !== null) return `a kill by process name (${name} fed by ${fed})`;
    const toks = tokens(segment(cmd, masked, hit.at));
    // bash's kill reads -n as a signal number (kill -n 9 1234), so under that
    // name -n followed by digits alone is a signal and the digits are no name.
    // PowerShell's kill is Stop-Process, where -n is -Name, so kill -n node
    // still reads its name.
    const signal = (i: number) => hit.name === "kill" && toks[i] === "-n" && /^\d+$/.test(toks[i + 1] ?? "");
    const named = toks.find((t, i) => isNameParam(t) && !signal(i));
    if (named !== undefined) {
      const value = /:/.test(named) ? "" : (toks[toks.indexOf(named) + 1] ?? "");
      const target = value !== "" && !value.startsWith("-") && !unreadable(value) ? ` ${value}` : "";
      return `a kill by process name (${name} ${named}${target})`;
    }
    // A positional operand that is neither a process id nor a comma list of
    // them is a name. Each value-taking parameter's value is stepped over.
    const positional: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      if (!toks[i].startsWith("-")) positional.push(toks[i]);
      else if (takesValue(toks[i]) && toks[i + 1] !== undefined && !toks[i + 1].startsWith("-")) i++;
    }
    const bare = positional.find((t) => !/^\d+(?:,\d+)*$/.test(t) && !unreadable(t));
    if (bare !== undefined) return `a kill by process name (${name} ${bare})`;
  }
  return null;
}

// The act a git invocation in the command performs on the checkout, or null.
// The global flags between git and its subcommand are stepped over as the
// read-only guard steps over them.
function gitAct(cmd: string, masked: string, fed: boolean): string | null {
  for (const hit of commandPositions(masked, ["git"])) {
    const toks = tokens(segment(cmd, masked, hit.at));
    let i = 0;
    while (i < toks.length && toks[i].startsWith("-")) i += GIT_VALUE_FLAGS.test(toks[i]) ? 2 : 1;
    const sub = (toks[i] ?? "").toLowerCase();
    const rest = toks.slice(i + 1);
    const subverb = (rest.find((a) => !a.startsWith("-")) ?? "").toLowerCase();
    if (sub === "stash" && subverb !== "list") return `a stash on a shared checkout (git stash${subverb === "" ? "" : ` ${subverb}`})`;
    if (sub === "reset") {
      const mode = rest.find((a) => a === "--hard" || a === "--merge");
      if (mode !== undefined) return `a reset that discards (git reset ${mode})`;
    }
    // A short-flag cluster that forces: one dash, then letters or digits, with
    // a lowercase f ahead of the first letter that takes a value. Git reads
    // the rest of a cluster past such a letter as its value, the new branch's
    // name, so -qf and -fb force and -bf names a branch f.
    const forces = (a: string, valued: RegExp) => /^-[A-Za-z0-9]+$/.test(a) && a.split(valued)[0].includes("f");
    if (sub === "checkout") {
      if (rest.includes("--")) return "a checkout that discards (git checkout --)";
      const force = rest.find((a) => forces(a, /[bB]/) || a === "--force");
      if (force !== undefined) return `a checkout that discards (git checkout ${force})`;
      // The operands past the flags, with the branch name -b, -B or --orphan
      // takes stepped over: ., ./ or .\ restores the tree, and two operands are a
      // tree-ish and a path, which restores that path. One operand is a
      // branch to the lexer.
      const operands = rest.filter((a, i) => !a.startsWith("-") && !unreadable(a) && !(i > 0 && /^(?:-b|-B|--orphan)$/.test(rest[i - 1])));
      const tree = operands.find((a) => /^\.[\\/]?$/.test(a));
      if (tree !== undefined) return `a checkout that discards (git checkout ${tree})`;
      if (operands.length >= 2) return `a checkout that discards (git checkout ${operands[0]} ${operands[1]})`;
    }
    if (sub === "switch") {
      const discard = rest.find((a) => a === "--discard-changes" || forces(a, /[cC]/) || a === "--force");
      if (discard !== undefined) return `a switch that discards (git switch ${discard})`;
    }
    if (sub === "restore") {
      const cluster = (a: string, letter: string) => /^-[A-Za-z]+$/.test(a) && a.includes(letter);
      const staged = rest.some((a) => a === "--staged" || cluster(a, "S"));
      const worktree = rest.find((a) => a === "--worktree" || cluster(a, "W"));
      if (!staged || worktree !== undefined) return `a restore that discards (git restore${worktree === undefined ? "" : ` ${worktree}`})`;
    }
    if (sub === "clean") return "a clean of the checkout (git clean)";
    if (sub === "branch") {
      // --delete deletes, and so does each shorter spelling from --d up (--d,
      // --de, --del, --dele, --delet), since git's option parser binds any
      // unique abbreviation of a long option and --delete is the one git
      // branch option opening with d. Nothing longer matches: git refuses
      // --deleted as unknown. A short-flag cluster holding d or D deletes
      // (-d, -D, -df, -Df).
      const del = rest.find((a) => /^--d(?:e(?:l(?:e(?:t(?:e)?)?)?)?)?$/.test(a) || /^-[A-Za-z]*[dD][A-Za-z]*$/.test(a));
      if (del !== undefined) return `a branch delete (git branch ${del})`;
    }
    if (sub === "update-ref") {
      // -d deletes, the compare-and-delete form branch-hygiene teaches (git
      // update-ref -d refs/heads/<name> <sha> --no-deref). update-ref reads its
      // options with git's parse-options, so -d also deletes inside a short-flag
      // cluster, read up to its first d since -m takes the rest of the cluster
      // as its reason (-dm"reap merged"). A delete is let through only where its
      // first operand is a ref the guard can read under refs/ and outside
      // refs/heads/, and no operand is a branch or unreadable: refs/notes/x
      // passes. Every other delete is refused, since its ref is a branch or
      // arrives where the guard cannot see it: refs/heads/ in any case (loose
      // refs on this host's case-insensitive filesystem answer to any spelling),
      // HEAD (git follows it to the checked-out branch, and with --no-deref it is
      // the shared checkout's own HEAD), no operand, a variable, an operand
      // holding a brace, or a delete an xargs runs. An xargs replace string can
      // be any word and sit under a refs/ prefix (xargs -I REF ... -d refs/REF
      // fed heads/<name>), so an update-ref with an xargs ahead of it in its
      // segment is refused whatever its operands read as, and so is one in a
      // nested shell read from a command holding an xargs (`fed`), as in
      // xargs -I REF sh -c "git update-ref -d refs/REF". Every word not opening
      // a dash is read as an operand, a reflog reason included, so -m reap
      // refs/notes/x is refused too, a cluster whose -m reason holds a d
      // (-mdone) is read as a delete, and a notes delete an xargs runs is
      // refused: false denies kept rather than a narrower reading that could
      // open a hole.
      // update-ref with no d in a short-flag cluster is left alone.
      const del = rest.find((a) => /^-[A-Za-z0-9]*d/.test(a));
      const branch = (o: string) => /^refs\/heads\//i.test(o) || /^head$/i.test(o);
      const operands = rest.filter((o) => !o.startsWith("-"));
      const target = operands[0];
      const seen = target !== undefined && /^refs\//i.test(target);
      const viaXargs = fed || commandPositions(masked, ["xargs"]).some((x) => x.at < hit.at && !/[;&|\n]/.test(masked.slice(x.at, hit.at)));
      if (del !== undefined && (viaXargs || !seen || operands.some((o) => branch(o) || unreadable(o) || /[{}]/.test(o)))) return `a branch delete (git update-ref ${del})`;
    }
    if (sub === "worktree" && (subverb === "remove" || subverb === "prune")) return `a worktree removal (git worktree ${subverb})`;
  }
  return null;
}

// True for an rm flag that recurses: a short-flag cluster holding r or R,
// --recursive, or the Recurse parameter PowerShell binds when rm is its
// Remove-Item alias. A cluster is rm's only where every letter is one of its
// short flags (f, i, I, r, R, v, d), so -force, which PowerShell binds as
// Remove-Item's Force and bash's rm rejects, recurses nothing.
function rmRecurses(tok: string): boolean {
  return (/^-[fiIrRvd]+$/.test(tok) && /[rR]/.test(tok)) || tok === "--recursive" || isRecurseParam(tok);
}

// True when one path component names .kit in any case, or, where the shell
// expands it, is a glob pattern that can: * and ? stand for any characters,
// a leading dot included, since PowerShell and some shells match one, and a
// [...] class for its members, with a leading ! or ^ negating it. A component
// holding no glob character is compared literally. So .k*, *, .k?t and [.]kit
// reach .kit, while build*, *.log and a literal .k* do not. A class the
// pattern reader cannot compile, such as a reversed range [z-a], reaches
// .kit, the deny direction, rather than throwing past the refusal. Trailing
// dots and spaces are dropped before the literal compare, since Windows
// drops them from a name, so .kit. and ".kit " name .kit.
function reachesKit(part: string, globs: boolean): boolean {
  const plain = part.replace(/[. ]+$/, "") || part;
  if (!globs || !/[*?[]/.test(part)) return plain.toLowerCase() === ".kit";
  let re = "";
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    const close = c === "[" ? part.indexOf("]", i + 2) : -1;
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (close > 0) {
      const members = part.slice(i + 1, close);
      re += `[${/^[!^]/.test(members) ? `^${members.slice(1)}` : members}]`;
      i = close;
    } else re += c.replace(/[.+^${}()|[\]\\]/, "\\$&");
  }
  try {
    return new RegExp(`^${re}$`, "i").test(".kit");
  } catch {
    return true;
  }
}

// The one shape a delete name may take and still be judged as a path, one
// finite rule in place of any shell expansion: an optional \\?\ or drive
// prefix, then components of letters, digits, space and _ . - + = @ # ~ * ?,
// or a bracket class of letters, digits, . and _ with single-character
// ranges. find's {} placeholder is admitted whole. A name opening with @ (a
// PowerShell splat or array) or with ~ not followed by a separator (~+, ~-,
// ~user) is not. A name outside the shape is denied unread, since whatever a
// brace group, a sequence, a subexpression, a provider prefix or a POSIX
// class rewrites to is not readable here. A \\?\-prefixed name is admitted
// only so its reason names a place: on a Windows host it always denies,
// since its escape reading resolves outside the checkout, and a posix host
// reads it as a relative name holding literal backslashes.
const PLAIN_PART = /^(?:[\p{L}\p{N} _.\-+=@#~*?]|\[[!^]?(?:[\p{L}\p{N}._](?:-[\p{L}\p{N}._])?)+\])*$/u;
function readableName(name: string): boolean {
  if (name === "{}") return true;
  if (/^@|^~(?![\\/]|$)/.test(name)) return false;
  const body = name.replace(/^\\\\\?\\/, "").replace(/^[A-Za-z]:/, "");
  return body.split(/[\\/]/).every((part) => PLAIN_PART.test(part));
}

// The names one delete operand carries: its comma-separated members, since
// PowerShell binds a,b as a two-item array whatever parameter takes it,
// -LiteralPath included. bash's rm reads the same operand as one literal
// name, which the members cover. The lexer has already stripped an operand's
// quotes, so a quoted 'a,b' splits as well, the deny direction.
function commaNames(operand: string): string[] {
  return operand.split(",").filter((n) => n !== "");
}

// Where a resolved delete target sits: the git root itself (deleting it takes
// .kit/ with it), under .kit/ at any depth below the root, outside the root (an
// ancestor of it included, since deleting one takes other trees with it), or
// inside it. The component directly under the root is read as a glob where
// the operand globs, so * or .k* at the root reaches .kit/ as the shell's
// expansion would; a glob below a named directory (build/*) is that
// directory's.
function placeOf(resolved: string, root: string, globs: boolean, host: LexHost): "root" | "kit" | "outside" | "inside" {
  const rel = host.path.relative(root, resolved);
  if (rel === "") return "root";
  if (host.path.isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) return "outside";
  return rel.split(/[\\/]/).some((part, i) => reachesKit(part, globs && i === 0)) ? "kit" : "inside";
}

// The act a recursive delete in the command performs on a tree the agent does
// not own, or null. Each operand resolves against the directory the delete
// runs in, a cd ahead of it included, and against the git root above the
// session's working directory. An operand the lexer cannot read at all (a
// variable, a substitution) passes. Each of its comma members is then held
// to readableName, the one shape judged as a path, and a member outside it
// is denied unread. A member inside it resolves against each base, and
// globs unless the operand is a -LiteralPath value, which PowerShell takes
// as spelled. A member holding a backslash is read twice under either tool,
// as typed and with each backslash dropped as bash's escape (.k\it is .kit
// to bash), since a nested shell can change which shell reads it: a bash -c
// payload under the PowerShell tool is bash's. The cost is a false deny of
// a PowerShell path whose escape-stripped reading lands on .kit (.\kit,
// .\k*) and of find's \; terminator, whose lone backslash is refused as
// unreadable; find -exec ... {} + is the passing form. Every reason
// echoes the operand as the lexer read it, quotes removed and cut at a
// separator or a closing parenthesis. The root is `root`, the call's, walked
// for on the first name in the call that needs a place, so a command holding
// no recursive delete costs no .git walk and one holding several is walked
// once across every reading.
async function deleteAct(cmd: string, masked: string, cwd: string, host: LexHost, root: (cwd: string) => Promise<string>): Promise<string | null> {
  const judge = async (name: string, flag: string, operands: string[], globs: boolean, at: number): Promise<string | null> => {
    for (const operand of operands) {
      if (unreadable(operand)) continue;
      for (const target of commaNames(operand)) {
        if (!readableName(target)) return `a recursive delete whose operand the guard cannot read as a path (${name} ${flag} ${operand})`;
        const readings = target.includes("\\") ? [target, target.replace(/\\(.?)/g, "$1")] : [target];
        // A reading that strips to nothing, a lone backslash's, names no path
        // on any host, so it is refused unread rather than placed.
        if (readings.includes("")) return `a recursive delete whose operand the guard cannot read as a path (${name} ${flag} ${operand})`;
        for (const reading of readings) {
          for (const base of await effectiveDirs(cmd, masked, at, cwd, host)) {
            const resolved = resolveTarget(reading, base, host);
            if (resolved === null) continue;
            const place = placeOf(resolved, await root(cwd), globs, host);
            if (place === "root") return `a recursive delete of the session's whole checkout (${name} ${flag} ${operand})`;
            if (place === "kit") return `a recursive delete under .kit/ (${name} ${flag} ${operand})`;
            if (place === "outside") return `a recursive delete outside the session's checkout (${name} ${flag} ${operand})`;
          }
        }
      }
    }
    return null;
  };
  for (const hit of commandPositions(masked, RM)) {
    const toks = tokens(segment(cmd, masked, hit.at));
    const flag = toks.find(rmRecurses);
    if (flag === undefined) continue;
    const act = await judge(typedName(masked, hit.at), flag, toks.filter((t) => !t.startsWith("-")), true, hit.at);
    if (act !== null) return act;
  }
  for (const hit of commandPositions(masked, REMOVE_ITEM)) {
    const toks = tokens(segment(cmd, masked, hit.at));
    // rd, rmdir, del and erase are also cmd's, where /s recurses (into
    // subdirectories, for del and erase) and /q only silences the prompt, so
    // under those names a token holding /s is the recurse flag, joined
    // spellings such as /s/q included, and no switch token is an operand.
    const cmdSwitch = (t: string) => /^(?:rd|rmdir|del|erase)$/.test(hit.name) && /^(?:\/[sq])+$/i.test(t);
    const flag = toks.find(isRecurseParam) ?? toks.find((t) => cmdSwitch(t) && /\/s/i.test(t));
    if (flag === undefined) continue;
    const { named, positional } = cmdletOperands(toks.filter((t) => !cmdSwitch(t)));
    const { literalpath, ...globbed } = named;
    const name = typedName(masked, hit.at);
    const act = await judge(name, flag, cmdletPaths("remove-item", globbed, positional), true, hit.at)
      ?? (literalpath === undefined ? null : await judge(name, flag, [literalpath], false, hit.at));
    if (act !== null) return act;
  }
  return null;
}

// What one decide call holds fixed across every reading at every depth: the
// cwd, the lexer's host and the quote fold; the memo of nested verdicts; the
// data-sink exemption span, decided once over the top-level text, since every
// top-level reading is handed that same text; and the git root above the cwd,
// walked once at the first reading that asks for it.
type Call = {
  cwd: string | null;
  host: LexHost;
  quote: (text: string) => string;
  memo: VerdictMemo;
  exempt: Span | null;
  root: (cwd: string) => Promise<string>;
};

// The shared-state act the command performs under the reading `exact`
// selects, or null. The preprocessing is the read-only guard's, in its order:
// CRLF normalized once by the guard's decide before the text arrives, at
// every depth, any heredoc fault refused at every depth before any body is
// read, naming the word or the delimiter through the fold and bracket guard,
// the heredoc bodies found, the data-sink exemption the guard's decide
// decided over the whole string, taken at the top level, continuations
// spliced, then the mask the rules read, with an exempt body blanked whole.
// The legacy reading takes its fault from `offendingDelimiter` (a
// `DelimiterFault` kind), its bodies from `heredocBodies` on a body-blind mask
// and its mask from `maskQuoted`. The exact reading takes its fault, its data
// bodies and its live bodies from `heredocWalk`, splices no continuation
// inside a data body, and masks with `maskExact`, which reads a word-start #
// as a comment and a body's quotes as bytes, a live body's text staying
// command text. The rules run, then each substitution interior and nested
// payload is read one level deeper. `join` and `boundary` are the splice's
// reading of this text alone, as `spliceContinuations` takes them, and
// `exact` is the reading the guard's decide chose for this pass, carried
// unchanged to every depth; each nested text is read under
// `readUnderContinuations` on its own text, and its composed verdict is held
// in the call's memo, keyed on the text, its depth, `exact` and whether an
// xargs feeds it (`fed`).
async function sharedStateAct(cmd: string, depth: number, join: boolean, boundary: number, exact: boolean, call: Call, fed = false): Promise<string | null> {
  const { cwd, host, quote } = call;
  const subs: Span[] = [];
  let bodies: Span[];
  let live: readonly Span[] = [];
  if (exact) {
    const walk = heredocWalk(cmd, "", true);
    if (walk.fault !== null) return delimiterFault(walk.fault, quote);
    bodies = walk.data;
    live = walk.live;
  } else {
    const bare = maskQuoted(cmd);
    const delimiter = offendingDelimiter(cmd, bare);
    if (delimiter !== null) return delimiterFault(delimiter, quote);
    bodies = heredocBodies(cmd, bare);
  }
  const exemptBody = depth === 0 ? call.exempt : null;
  // The splice is handed the data bodies alone, where bash splices nothing,
  // and this reading's quote mask of the text as it stands, so a pair inside
  // a single-quoted span stays as typed; a live body's pairs are spliced as
  // any command text's are, since bash removes them as it reads the body. The
  // joined readings shorten the command, so the data spans come back shifted
  // and the live spans and the exemption span found above are read through
  // the splice's map onto its text. Under the two-space reading the map is
  // the identity.
  const joined = spliceContinuations(cmd, bodies, exact ? maskExact(cmd, bodies, live) : maskQuoted(cmd, bodies), join, boundary);
  cmd = joined.cmd;
  const data = joined.bodies;
  const liveJoined = live.map(s => ({ from: joined.at(s.from), to: joined.at(s.to) }));
  let masked = exact ? maskExact(cmd, data, liveJoined, subs) : maskQuoted(cmd, data, subs);
  if (exemptBody) {
    const chars = masked.split("");
    for (let i = joined.at(exemptBody.from); i < joined.at(exemptBody.to); i++) chars[i] = "\x00";
    masked = chars.join("");
  }
  const act = killAct(cmd, masked) || gitAct(cmd, masked, fed) || (cwd ? await deleteAct(cmd, masked, cwd, host, call.root) : null);
  if (act !== null) return act;
  if (depth >= DEPTH_BOUND) return null;
  // A nested payload read from a command holding an xargs is read as fed by
  // it, since the xargs may run the shell that runs the payload; a false
  // deny where it does not is kept over a narrower reading.
  const fedPayload = fed || commandPositions(masked, ["xargs"]).length > 0;
  const nestedAct = (text: string, f: boolean) => memoized(call.memo, `${depth + 1}:${exact ? "exact" : "legacy"}${f ? ":fed" : ""}`, text, () => readUnderContinuations(
    text,
    exact,
    (t, j, b) => sharedStateAct(t, depth + 1, j, b, exact, call, f),
    r => r !== null,
    () => CONTINUATION_CAP_REASON,
  ));
  for (const s of subs) {
    const nested = await nestedAct(cmd.slice(s.from, s.to), fed);
    if (nested !== null) return nested;
  }
  for (const payload of nestedPayloads(cmd, masked)) {
    const nested = await nestedAct(payload, fedPayload);
    if (nested !== null) return `${nested}, inside a nested shell`;
  }
  return null;
}

// The refusal for agent type `t` of class `cls`: the act, the rule, and the
// route up.
function refusalOf(t: string, cls: string, act: string): string {
  return (
    `Blocked: the ${t} subagent may not touch machine-shared state it does not own, and this command is ` +
    `${act}. The ${cls} class acts only on state it can attribute to itself: a process it started, ` +
    `its own files, and its own scratch subfolder. End the attempt and report the need under BLOCKED to ` +
    `your orchestrator, naming the act and the target, so a coordinating seat can run it under its own ` +
    `confirmation or decline it with the reason.\n`
  );
}

// What the guard reaches through hooks/index.ts: the lexer's host for one
// call, and the fold and bracket guard a quoted command word takes on its
// way to the model, which the refused heredoc delimiter word passes through.
export type SharedStateDeps = { lexHost(): Promise<LexHost>; quote(text: string): string };

/**
 * Denies a mutating or gate agent's Bash or PowerShell command that ends a
 * process it did not start, reaches past its own files on the checkout, or
 * recursively deletes a tree it does not own, with the act and the BLOCKED
 * route as the reason. A call from the main loop matches nothing, since it
 * carries no agent id; a subagent's call of a type no class governs, or
 * with no command, allows. The cwd is the session's, trimmed.
 */
export function sharedStateGuard(deps: SharedStateDeps): BeforeGuard {
  return {
    name: "shared-state",
    matches: (e: GuardCall) => (e.tool === "Bash" || e.tool === "PowerShell") && typeof e.agentId === "string" && e.agentId !== "",
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const t = typeof ctx.agentType === "string" ? ctx.agentType.trim() : "";
      if (!t) return {};
      const cls = sharedStateAgentClass(t);
      if (cls === null) return {};
      const cmd = e.command;
      if (typeof cmd !== "string" || !cmd.trim()) return {};
      const cwd = typeof ctx.cwd === "string" && ctx.cwd.trim() ? ctx.cwd.trim() : null;
      const host = await deps.lexHost();
      // The command, its CRLF pairs normalized once here, is read under every
      // reading of its continuations, the two-space reading first so every
      // refusal it gives keeps its reason byte for byte, and a refusal from
      // any reading is the guard's refusal. That family runs under the legacy
      // reading of comments and heredoc bodies first. Where it allows and the
      // exact reading can differ, by `exactReadingDiffers`, it runs again
      // under the exact reading, so a refusal from any pairing of a
      // continuation reading with either stands. What every reading shares is
      // decided once: the data-sink exemption over this text, and the git
      // root above the cwd at the first reading that asks for it.
      const unix = cmd.replace(/\r\n/g, "\n");
      let root: Promise<string> | null = null;
      const call: Call = {
        cwd, host, quote: deps.quote, memo: new Map(),
        exempt: cwd ? await heredocExemption(unix, cwd, false, host) : null,
        root: dir => (root ??= repoRoot(dir, host)),
      };
      const under = (exact: boolean) => readUnderContinuations(
        unix,
        exact,
        (text, join, boundary) => sharedStateAct(text, 0, join, boundary, exact, call),
        r => r !== null,
        () => CONTINUATION_CAP_REASON,
      );
      let act = await under(false);
      if (act === null && exactReadingDiffers(unix)) act = await under(true);
      return act === null ? {} : { deny: refusalOf(t, cls, act) };
    },
  };
}
