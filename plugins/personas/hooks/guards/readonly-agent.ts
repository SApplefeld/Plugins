// readonly-agent.ts: the before-tool guard that keeps the state under review
// out of a reviewer's reach. It reads a Bash or PowerShell call through a
// lexer with a depth bound and an explicit deny on unresolvable text.
//
// The access model, by agent class (agent-class.ts):
//   Strict (the read-only judgment seats): the repo tree is read-only. Git
//   state changes, the gh writes ghMutation names, writes into the tree, file
//   mutations (delete, move, copy, create, chmod), package installs and
//   formatters are all denied.
//   Gate (qa-verifier): inside a fixed list of build-output directories (bin,
//   obj, TestResults, node_modules, .vs), matched at any depth, it may write
//   and delete freely. Everywhere else in the repo it may not write, delete,
//   move, rename or overwrite an existing file, and git state, the gh writes,
//   package installs that rewrite a lockfile and formatters are denied to it
//   as well. That directory list is a policy assumption, not a fact the guard
//   checks.
//   Every other agent type, and the main session, is untouched.
// .kit/ (gitignored) is scratch space both classes may write.
//
// Command text is analyzed against a quote-masked copy of itself: every
// position-finding pattern runs against a string whose quoted spans are
// blanked, while operand text is read from the original. A nested executor
// (sh -c, bash -c, pwsh -Command, cmd /c, eval, iex, claude -p, a here-string)
// has its payload analyzed recursively within a depth bound, and a command
// substitution the shell runs is blanked as a span and scanned as its own
// command. Whatever the depth bound leaves unexpanded is denied as
// unresolvable rather than trusted as data. This is a best-effort lexer over
// shell grammar rather than a shell, and no security boundary: every agent
// runs as the one machine principal, so the guard defends the work against a
// well-intentioned but wrong agent, and the tree-state check the orchestrator
// runs around each review round backstops it.
//
// A payload with no cwd skips the cwd-dependent path checks while the
// path-independent heuristics still deny. Operand ambiguity the command's
// author chose takes a per-site judgment: a path built through a variable
// outside the resolvable subset cannot be placed and allows, a cd target the
// guard cannot read falls back to the cwd, and a destructive cmdlet an
// enumerating pipeline feeds denies with its operand unresolved. Command text
// the guard cannot resolve (a substitution or an executor payload nested past
// the depth bound, a name with a substitution spliced into it, a gh command
// with a word the shell may rewrite) denies. The per-function comments below
// state each rule where it is applied.
//
// Nothing here reads `$` (runner.ts says why). The filesystem reads
// (the .git walk, the cd target's directory test and the
// overwrite rule's existence test) are made through LexHost, which
// hooks/index.ts builds over `$`, so the functions that reach them are async.
// The path arithmetic is the PathOps below, Node's win32 and posix
// algorithms over strings, so a path resolves as Node's `path` would on the
// same host.

import type { BeforeGuard, GuardCall, GuardContext } from "./runner";
import { reviewAgentClass } from "./agent-class";

const BACKSLASH = 92;
const SLASH = 47;
const DOT = 46;
const COLON = 58;

function isSep(code: number): boolean {
  return code === SLASH || code === BACKSLASH;
}

function isPosixSep(code: number): boolean {
  return code === SLASH;
}

function isDeviceRoot(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

// Node's normalizeString: resolves `.` and `..` segments in `path`, keeping
// a leading `..` only where `allowAboveRoot`.
function normalizeString(path: string, allowAboveRoot: boolean, separator: string, isPathSeparator: (code: number) => boolean): string {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (isPathSeparator(code)) break;
    else code = SLASH;
    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // an empty segment or a `.`
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== DOT || res.charCodeAt(res.length - 2) !== DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += `${separator}${path.slice(lastSlash + 1, i)}`;
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

/**
 * The path operations the guards take from Node's `path`, for one host:
 * win32's on Windows and posix's elsewhere. Each is Node's algorithm over
 * strings, with one difference: Node resolves a relative result against the
 * process's working directory, which a hooks module has no reading of, so a
 * `resolve` whose every part is relative answers the relative normalized
 * path. Every caller here resolves against an absolute base.
 */
export type PathOps = {
  readonly sep: "\\" | "/";
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  join(...parts: string[]): string;
  isAbsolute(path: string): boolean;
};

// Where a win32 path's root ends, its device (a drive or a UNC share) and
// whether it is absolute, as Node's win32.resolve reads them.
function win32Root(path: string): { device: string; rootEnd: number; isAbsolute: boolean } {
  const len = path.length;
  let rootEnd = 0;
  let device = "";
  let isAbsolute = false;
  const code = path.charCodeAt(0);
  if (len === 1) {
    if (isSep(code)) {
      rootEnd = 1;
      isAbsolute = true;
    }
  } else if (isSep(code)) {
    isAbsolute = true;
    if (isSep(path.charCodeAt(1))) {
      let j = 2;
      let last = j;
      while (j < len && !isSep(path.charCodeAt(j))) j++;
      if (j < len && j !== last) {
        const firstPart = path.slice(last, j);
        last = j;
        while (j < len && isSep(path.charCodeAt(j))) j++;
        if (j < len && j !== last) {
          last = j;
          while (j < len && !isSep(path.charCodeAt(j))) j++;
          if (j === len || j !== last) {
            device = `\\\\${firstPart}\\${path.slice(last, j)}`;
            rootEnd = j;
          }
        }
      }
    } else {
      rootEnd = 1;
    }
  } else if (isDeviceRoot(code) && path.charCodeAt(1) === COLON) {
    device = path.slice(0, 2);
    rootEnd = 2;
    if (len > 2 && isSep(path.charCodeAt(2))) {
      isAbsolute = true;
      rootEnd = 3;
    }
  }
  return { device, rootEnd, isAbsolute };
}

function win32Resolve(...parts: string[]): string {
  let resolvedDevice = "";
  let resolvedTail = "";
  let resolvedAbsolute = false;
  for (let i = parts.length - 1; i >= 0; i--) {
    const path = parts[i];
    if (path.length === 0) continue;
    const { device, rootEnd, isAbsolute } = win32Root(path);
    if (device.length > 0) {
      if (resolvedDevice.length > 0) {
        if (device.toLowerCase() !== resolvedDevice.toLowerCase()) continue;
      } else {
        resolvedDevice = device;
      }
    }
    if (resolvedAbsolute) {
      if (resolvedDevice.length > 0) break;
    } else {
      resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
      resolvedAbsolute = isAbsolute;
      if (isAbsolute && resolvedDevice.length > 0) break;
    }
  }
  resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, "\\", isSep);
  return resolvedAbsolute ? `${resolvedDevice}\\${resolvedTail}` : `${resolvedDevice}${resolvedTail}` || ".";
}

function win32Normalize(path: string): string {
  const len = path.length;
  if (len === 0) return ".";
  let rootEnd = 0;
  let device: string | undefined;
  let isAbsolute = false;
  const code = path.charCodeAt(0);
  if (len === 1) return isPosixSep(code) ? "\\" : path;
  if (isSep(code)) {
    isAbsolute = true;
    if (isSep(path.charCodeAt(1))) {
      let j = 2;
      let last = j;
      while (j < len && !isSep(path.charCodeAt(j))) j++;
      if (j < len && j !== last) {
        const firstPart = path.slice(last, j);
        last = j;
        while (j < len && isSep(path.charCodeAt(j))) j++;
        if (j < len && j !== last) {
          last = j;
          while (j < len && !isSep(path.charCodeAt(j))) j++;
          if (j === len) return `\\\\${firstPart}\\${path.slice(last)}\\`;
          if (j !== last) {
            device = `\\\\${firstPart}\\${path.slice(last, j)}`;
            rootEnd = j;
          }
        }
      }
    } else {
      rootEnd = 1;
    }
  } else if (isDeviceRoot(code) && path.charCodeAt(1) === COLON) {
    device = path.slice(0, 2);
    rootEnd = 2;
    if (len > 2 && isSep(path.charCodeAt(2))) {
      isAbsolute = true;
      rootEnd = 3;
    }
  }
  let tail = rootEnd < len ? normalizeString(path.slice(rootEnd), !isAbsolute, "\\", isSep) : "";
  if (tail.length === 0 && !isAbsolute) tail = ".";
  if (tail.length > 0 && isSep(path.charCodeAt(len - 1))) tail += "\\";
  if (device === undefined) return isAbsolute ? `\\${tail}` : tail;
  return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
}

function win32Join(...parts: string[]): string {
  let joined: string | undefined;
  let firstPart = "";
  for (const arg of parts) {
    if (arg.length > 0) {
      if (joined === undefined) joined = firstPart = arg;
      else joined += `\\${arg}`;
    }
  }
  if (joined === undefined) return ".";
  let needsReplace = true;
  let slashCount = 0;
  if (isSep(firstPart.charCodeAt(0))) {
    ++slashCount;
    const firstLen = firstPart.length;
    if (firstLen > 1 && isSep(firstPart.charCodeAt(1))) {
      ++slashCount;
      if (firstLen > 2) {
        if (isSep(firstPart.charCodeAt(2))) ++slashCount;
        else needsReplace = false;
      }
    }
  }
  if (needsReplace) {
    while (slashCount < joined.length && isSep(joined.charCodeAt(slashCount))) slashCount++;
    if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
  }
  return win32Normalize(joined);
}

function win32Relative(from: string, to: string): string {
  if (from === to) return "";
  const fromOrig = win32Resolve(from);
  const toOrig = win32Resolve(to);
  if (fromOrig === toOrig) return "";
  from = fromOrig.toLowerCase();
  to = toOrig.toLowerCase();
  if (from === to) return "";
  let fromStart = 0;
  while (fromStart < from.length && from.charCodeAt(fromStart) === BACKSLASH) fromStart++;
  let fromEnd = from.length;
  while (fromEnd - 1 > fromStart && from.charCodeAt(fromEnd - 1) === BACKSLASH) fromEnd--;
  const fromLen = fromEnd - fromStart;
  let toStart = 0;
  while (toStart < to.length && to.charCodeAt(toStart) === BACKSLASH) toStart++;
  let toEnd = to.length;
  while (toEnd - 1 > toStart && to.charCodeAt(toEnd - 1) === BACKSLASH) toEnd--;
  const toLen = toEnd - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) break;
    else if (fromCode === BACKSLASH) lastCommonSep = i;
  }
  if (i !== length) {
    if (lastCommonSep === -1) return toOrig;
  } else {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === BACKSLASH) return toOrig.slice(toStart + i + 1);
      if (i === 2) return toOrig.slice(toStart + i);
    }
    if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === BACKSLASH) lastCommonSep = i;
      else if (i === 2) lastCommonSep = 3;
    }
    if (lastCommonSep === -1) lastCommonSep = 0;
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === BACKSLASH) out += out.length === 0 ? ".." : "\\..";
  }
  toStart += lastCommonSep;
  if (out.length > 0) return `${out}${toOrig.slice(toStart, toEnd)}`;
  if (toOrig.charCodeAt(toStart) === BACKSLASH) ++toStart;
  return toOrig.slice(toStart, toEnd);
}

function win32Dirname(path: string): string {
  const len = path.length;
  if (len === 0) return ".";
  let rootEnd = -1;
  let offset = 0;
  const code = path.charCodeAt(0);
  if (len === 1) return isSep(code) ? path : ".";
  if (isSep(code)) {
    rootEnd = offset = 1;
    if (isSep(path.charCodeAt(1))) {
      let j = 2;
      let last = j;
      while (j < len && !isSep(path.charCodeAt(j))) j++;
      if (j < len && j !== last) {
        last = j;
        while (j < len && isSep(path.charCodeAt(j))) j++;
        if (j < len && j !== last) {
          last = j;
          while (j < len && !isSep(path.charCodeAt(j))) j++;
          if (j === len) return path;
          if (j !== last) rootEnd = offset = j + 1;
        }
      }
    }
  } else if (isDeviceRoot(code) && path.charCodeAt(1) === COLON) {
    rootEnd = len > 2 && isSep(path.charCodeAt(2)) ? 3 : 2;
    offset = rootEnd;
  }
  let end = -1;
  let matchedSlash = true;
  for (let i = len - 1; i >= offset; --i) {
    if (isSep(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    if (rootEnd === -1) return ".";
    end = rootEnd;
  }
  return path.slice(0, end);
}

function win32IsAbsolute(path: string): boolean {
  const len = path.length;
  if (len === 0) return false;
  const code = path.charCodeAt(0);
  return isSep(code) || (len > 2 && isDeviceRoot(code) && path.charCodeAt(1) === COLON && isSep(path.charCodeAt(2)));
}

function posixResolve(...parts: string[]): string {
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i = parts.length - 1; i >= 0 && !resolvedAbsolute; i--) {
    const path = parts[i];
    if (path.length === 0) continue;
    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = path.charCodeAt(0) === SLASH;
  }
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixSep);
  if (resolvedAbsolute) return `/${resolvedPath}`;
  return resolvedPath.length > 0 ? resolvedPath : ".";
}

function posixNormalize(path: string): string {
  if (path.length === 0) return ".";
  const isAbsolute = path.charCodeAt(0) === SLASH;
  const trailingSeparator = path.charCodeAt(path.length - 1) === SLASH;
  let out = normalizeString(path, !isAbsolute, "/", isPosixSep);
  if (out.length === 0) {
    if (isAbsolute) return "/";
    return trailingSeparator ? "./" : ".";
  }
  if (trailingSeparator) out += "/";
  return isAbsolute ? `/${out}` : out;
}

function posixJoin(...parts: string[]): string {
  let joined: string | undefined;
  for (const arg of parts) {
    if (arg.length > 0) joined = joined === undefined ? arg : `${joined}/${arg}`;
  }
  return joined === undefined ? "." : posixNormalize(joined);
}

function posixRelative(from: string, to: string): string {
  if (from === to) return "";
  from = posixResolve(from);
  to = posixResolve(to);
  if (from === to) return "";
  const fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  const toStart = 1;
  const toLen = to.length - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) break;
    else if (fromCode === SLASH) lastCommonSep = i;
  }
  if (i === length) {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === SLASH) return to.slice(toStart + i + 1);
      if (i === 0) return to.slice(toStart + i);
    } else if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === SLASH) lastCommonSep = i;
      else if (i === 0) lastCommonSep = 0;
    }
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === SLASH) out += out.length === 0 ? ".." : "/..";
  }
  return `${out}${to.slice(toStart + lastCommonSep)}`;
}

function posixDirname(path: string): string {
  if (path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === SLASH;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === SLASH) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}

const WIN32_PATH: PathOps = { sep: "\\", resolve: win32Resolve, relative: win32Relative, dirname: win32Dirname, join: win32Join, isAbsolute: win32IsAbsolute };
const POSIX_PATH: PathOps = { sep: "/", resolve: posixResolve, relative: posixRelative, dirname: posixDirname, join: posixJoin, isAbsolute: (path: string) => path.startsWith("/") };

/** Node's win32 path operations on Windows and its posix ones elsewhere. */
export function pathOpsOf(windows: boolean): PathOps {
  return windows ? WIN32_PATH : POSIX_PATH;
}

/**
 * What the lexer reaches beyond the command text, built by hooks/index.ts
 * over `$`: the host's path operations, the home directory a `~` resolves
 * to, read once per call, whether a path is an existing directory, and whether anything exists
 * at a path. Each read that rejects answers as the hook's synchronous read
 * did when it threw.
 */
export type LexHost = {
  readonly path: PathOps;
  readonly home: string;
  isDirectory(path: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
};

// A half-open range of command indexes: a heredoc body, or a substitution's
// interior.
type Span = { from: number; to: number };

// One token of a heredoc-introducing line, as parseIntro reads it.
type IntroToken =
  | { type: 'word'; text: string; quoted: boolean }
  | { type: 'heredoc' }
  | { type: 'redir'; fd: string; append: boolean };

// The index just past a command or process substitution opening at `start` (a
// `$(` or `<(`, or a backtick), matching parentheses across nested substitutions
// and stepping over inner quoted spans so a `)` inside a string does not close
// it early. The interior is left untouched: the caller reads it as live command
// text. An unclosed substitution runs to the end of the string.
function substitutionEnd(chars: string[], start: number): number {
  if (chars[start] === '`') {
    let j = start + 1;
    while (j < chars.length && chars[j] !== '`') {
      j += (chars[j] === '\\' && j + 1 < chars.length) ? 2 : 1;
    }
    return j + 1;
  }
  let j = start + 2;
  let depth = 1;
  while (j < chars.length && depth > 0) {
    const c = chars[j];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === "'") { j++; while (j < chars.length && chars[j] !== "'") j++; }
    else if (c === '"') { j++; while (j < chars.length && chars[j] !== '"') { if (chars[j] === '\\') j++; j++; } }
    j++;
  }
  return j;
}

// True only where a `$((` span is confidently arithmetic: the inner `(` that
// opens at at+2 matches the `)` at e-2, so the whole span is exactly one
// parenthesized group ($((1 + 2)), $(( (a) * b ))). Where that inner `(` closes
// earlier, the span holds more than one thing inside the outer $(...) ($((cmd);
// (cmd)), $((cmd) )), and bash reparses it as a command substitution wrapping a
// subshell list, which it runs. That ambiguous shape is not confidently
// arithmetic, so it is treated as a command substitution to be collected and
// scanned, per the fail-closed rule that shell text the guard cannot resolve
// denies rather than disappearing. Parens inside a quoted span are stepped over,
// so a `)` inside a string cannot make an early close read as the arithmetic one.
// A backtick span is never arithmetic.
//
// The verdict decides HOW a span's interior is scanned, never whether: an
// ambiguous span is collected whole as command text, an arithmetic one has the
// substitutions standing inside it collected one by one. Collecting the arithmetic
// interior whole instead would deny ordinary arithmetic, whose operators are not
// shell syntax: the `>` in $((1 > 2)) is a comparison, which a redirect scan reads
// as a write to a file named 2.
function arithmeticSpan(chars: string[], at: number, e: number): boolean {
  if (chars[at] !== '$' || chars[at + 1] !== '(' || chars[at + 2] !== '(') return false;
  if (chars[e - 1] !== ')' || chars[e - 2] !== ')') return false;
  let depth = 0;
  for (let k = at + 2; k < e; k++) {
    const c = chars[k];
    if (c === "'") { k++; while (k < e && chars[k] !== "'") k++; continue; }
    if (c === '"') { k++; while (k < e && chars[k] !== '"') { if (chars[k] === '\\') k++; k++; } continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return k === e - 2; }
  }
  return false;
}

// A copy of the command with every character inside a single- or double-quoted
// span replaced by NUL, preserving length so indexes stay usable against the
// original. Backslash escapes follow bash's two context rules, which differ: at
// the top level a backslash escapes ANY following character, so \" and \' are
// literal quotes that neither open nor close a span (a rule that must include
// the single quote, or echo \' opens a phantom span that blanks the rest of the
// command while bash runs it); inside a double-quoted span a backslash escapes
// only " \ $ or `, so a Windows separator ("src\file") stays a literal
// backslash rather than swallowing the next character. The double-quote rule is
// the reason sh -c "sh -c \"...\"" is read as one span rather than flipping
// quote parity for the rest of the line. Single-quoted spans are literal. An
// unterminated quote masks to the end of the string. Quoted text matches no
// pattern, which is what makes a governed verb or a redirect operator inside an
// argument invisible.
//
// A command substitution ($(...) or backticks) is the exception to both rules:
// the shell runs it wherever quoting does not suppress it, so it is live command
// text rather than data, at the top level and inside a double-quoted span alike.
// Every such span is blanked whole with the SUB_SPAN sentinel, which keeps
// operand boundaries byte-identical to what the shell reads: a `)` or a closing
// tick standing in an operand ($(pwd), `true`) never truncates the operand list
// the way an exposed one would. The interior is instead collected into the `subs`
// out-parameter (when the caller passes one), for the caller to scan on its own
// as live command text, which is why echo "$(git commit -m x)" and
// rm $(true) README.md both deny. A $(( opener is confidently arithmetic only
// where the span is exactly one parenthesized group, its inner ( matching the )
// before the outer close (echo "$((1 > 2))" runs no command); every other $((
// shape is treated as a command substitution wrapping a subshell that bash runs
// (echo "$((git push) )", whose inner and outer ) are split by a space, and
// $((git push);(true)), which holds two groups, both run git push), so its
// interior is collected like any other. An arithmetic span is blanked too, but
// never without a scan: bash expands a command substitution standing in an
// arithmetic operand whatever quoting surrounds it ($(( '$(cmd)' )) runs cmd, and
// the arithmetic error that follows comes after the run), so every $( and backtick
// inside one is collected as a span of its own. The arithmetic text around them is
// not read as a command, because its operators are not shell syntax: the > in
// $((1 > 2)) is a comparison rather than a redirect. A process substitution is not
// performed on an arithmetic operand, so a <( inside one opens nothing. A
// process substitution (<(...)) is live at the top level and masked the same way
// there, but inside double quotes bash performs none, so there it masks as
// ordinary quoted text. A >( span is left as it stands: the redirect scan reads
// its > as a redirect whose (...) target classifies in-tree, a deny-leaning
// over-read that keeps rm >(x) README.md refused, so masking the span would
// trade a deny away rather than add one. Single quotes suppress
// substitution, so a span inside them stays literal, and a substitution opener
// inside a quoted-delimiter heredoc body is data the sink copies, so a body
// range opens nothing.
//
// The `bodies` argument names the ranges of quoted-delimiter heredoc bodies. A
// heredoc body is literal data, so a quote character in it is a byte rather than
// a shell quote: read as a quote it would open a span that blanks the live
// command text after the body (one stray apostrophe hides an entire mutation
// standing after the terminator). Quotes inside a body range are therefore left
// as literal characters, and a span opened outside a body ends where a body
// begins.
// The sentinel a substitution span masks to. It differs from the NUL quoted spans
// use because the two need different treatment when a segment is tokenized: quoted
// text keeps its original characters (git "commit" runs commit, so the token must
// still read commit), while a substitution expands to text the guard cannot know,
// so its span must ride as one opaque word rather than as raw $( text a whitespace
// split would break apart. The input cannot spell it: a raw control character is
// refused at the boundary before any mask is built.
const SUB_SPAN = '\x02';

// A token that is entirely a masked substitution span. Its expansion is text
// the guard cannot know, so every positional-subcommand scan steps over it to
// the next real token: git $(true) push is judged on push, whatever the
// substitution prints, since reading the opaque span as the subcommand would
// match nothing and fall through to allow. Standing as a destructive command's
// operand the span is placed like any other relative path, at the base the
// command runs in, which is deny-leaning: rm $(mktemp) denies, with the span
// named in the reason as an unresolved substitution rather than shipped as its
// sentinel bytes.
const SUB_TOKEN = new RegExp(`^${SUB_SPAN}+$`);

// A token with a substitution span spliced into literal text (git $(true)push
// leaves the subcommand token "\x02...push"). The span's expansion is unknowable
// and the shell concatenates it with the literal bytes, so the guard cannot
// resolve what this token is: it may be push, or pushfoo, or anything the
// substitution prints. This is distinct from SUB_TOKEN, a token that is ENTIRELY
// a span, which the positional scans step over to the next real token. Where a
// spliced token stands in a position the guard reads as a NAME (a
// subcommand, a verb, a script name, a flag), the unresolvable value denies rather
// than falling through to allow, per the fail-closed rule. `unresolvableSplice`
// applies that rule across every governed invocation; the readers that go deeper
// into their own grammar than it does test their own position with this.
function spliced(tok: string): boolean {
  return tok.includes(SUB_SPAN) && !SUB_TOKEN.test(tok);
}

// A deny reason quotes the offending target, and a target read out of a masked
// segment can carry a substitution span as its sentinel bytes. Those are
// control characters no message should ship to the agent reading the denial,
// so each sentinel run is named as what it stands for: an unresolved
// substitution.
function describeTarget(t: string): string {
  return String(t).replace(new RegExp(`${SUB_SPAN}+`, 'g'), '$(unresolved substitution)');
}

// This is the legacy reading of the command's quotes, kept byte for byte as the
// trunk leaves it: it has no comment rule, so a `#` is an ordinary character and
// a quote in a comment opens a span, and it blanks only the quoted-delimiter
// heredoc bodies named in `bodies`. `maskExact` below is the exact reading,
// added beside this one, which reads a word-start `#` to its line end as a
// comment and takes every heredoc body `heredocWalk` finds, by the rules each
// states. Each guard computes a verdict under this reading first; the exact
// reading runs only where this one allowed, so this reading keeps every refusal
// the trunk gives.
export function maskQuoted(cmd: string, bodies?: readonly Span[], subs?: Span[]): string {
  const inBody = (i: number) => bodies !== undefined && bodies.some(b => i >= b.from && i < b.to);
  const chars = cmd.split('');
  const dqEscapes = /["\\$`]/;
  // The substitutions bash performs on an arithmetic operand, each collected as
  // its own span. Quoting is not honoured here because arithmetic evaluation does
  // not honour it either, and a <( is not a process substitution there, so only
  // $( and a backtick open anything.
  const collectArithmetic = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (chars[k] === '`' || (chars[k] === '$' && chars[k + 1] === '(')) k = maskSub(k) - 1;
    }
  };
  // Blank one substitution span opening at `at` and collect what the shell runs
  // inside it, per the arithmetic and collection rules the comment above states:
  // the whole interior of a span the shell reads as a command substitution, and
  // the nested substitutions alone of one it reads as arithmetic. Returns the
  // index just past the span.
  const maskSub = (at: number): number => {
    const e = substitutionEnd(chars, at);
    const interiorFrom = chars[at] === '`' ? at + 1 : at + 2;
    if (subs !== undefined) {
      if (arithmeticSpan(chars, at, e)) collectArithmetic(interiorFrom, e - 1);
      else subs.push({ from: interiorFrom, to: e - 1 });
    }
    for (let k = at; k < e && k < chars.length; k++) chars[k] = SUB_SPAN;
    return e;
  };
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\\' && i + 1 < chars.length) { i++; continue; }
    // A top-level substitution: $(, a backtick, or <( where the preceding
    // character is not another < (a << is a heredoc, not a process
    // substitution). Openers inside a single-quoted span never reach this
    // test, because the quote handler below consumes the span whole.
    if (!inBody(i) && (chars[i] === '`'
      || (chars[i] === '$' && chars[i + 1] === '(')
      || (chars[i] === '<' && chars[i + 1] === '(' && chars[i - 1] !== '<'))) {
      i = maskSub(i) - 1;
      continue;
    }
    const q = chars[i];
    if (q !== '"' && q !== "'") continue;
    if (inBody(i)) continue;
    let j = i + 1;
    while (j < chars.length && chars[j] !== q) {
      if (inBody(j)) break;
      if (q === '"' && ((chars[j] === '$' && chars[j + 1] === '(') || chars[j] === '`')) {
        j = maskSub(j);
        continue;
      }
      if (q === '"' && chars[j] === '\\' && j + 1 < chars.length && dqEscapes.test(chars[j + 1])) {
        chars[j] = '\x00';
        j++;
      }
      chars[j] = '\x00';
      j++;
    }
    i = j;
  }
  return chars.join('');
}

// The exact reading of the command's quotes, beside the legacy reading
// `maskQuoted` above, which is its floor. It differs from the legacy reading
// in three ways. A word-start `#` at the top level, outside a quoted span, a
// substitution span, an open `${`, `$[` or `(( ))` construct and every body
// range, opens a comment that runs to the end of its line: inside it a `'`, a
// `"`, a backtick, a `$(`, a `<(` and a `<<` are literal bytes, no span opens
// and no substitution is collected. A `#` starts a word where the character
// before it is the start of the text, a space, a tab, a newline or one of
// `| & ; ( ) < >`, and that character is not itself escaped by a backslash.
// Inside an open `${`, `$[` or `(( ))` no
// comment opens, since bash reads the `#` there as part of the word or the
// expression; the constructs are read by the `constructCounter` the masker
// owns, which reads this mask as it is built. The comment's text is not
// blanked; it stays as the characters it is, so a pattern scan reads it as it
// reads a comment holding no quote. To `at` alone a comment position reads as
// NUL, so the walk and the counter, which read the mask through `at`, read a
// `<<` or a quote inside a comment as the byte bash reads and never as an
// introduction or a span. A `data` range is a quoted-delimiter body, read
// exactly as `maskQuoted`'s `bodies` are: quotes are bytes and nothing opens.
// A `live` range is an unquoted, empty or backslashed body: quotes are bytes
// and no comment opens, but every substitution is still collected, so its
// text stays command text every scan reads. Bash runs a substitution only in
// the unquoted body. In the empty and backslashed bodies the collection is
// conservative and can refuse a call bash would allow, never allow one it
// would refuse. An opener `$(` or `<(` split across a backslash-newline on an
// introducing line is read joined, as bash joins it, so its span masks the
// lines it spans, and the counter reads a split `${`, `$[` or `>(` joined the
// same way. `parenEnd` reads a word-start `#` comment to the end of its
// line while matching parentheses, outside any `${` expansion opened in the
// span, so a `)`, a backtick or a nested opener inside that comment is a byte
// to the match. Its reading is narrower than bash's in an open set of ways,
// two of them these: a backslash before a quote character outside quotes is
// not read as an escape, so the quote still opens a span, and a heredoc body
// inside the substitution is read as command text, so a `)` in it counts. A
// `)` in a `case` pattern or inside a `${` expansion counts as a closer too.
// Each can put the span's end where bash does not. The interior is then scanned on its own as command text,
// where the comment rule applies afresh.
// The resumable form of the exact mask. `at(i)` and `full()` drive one forward
// scan that never revisits a character, so the walk reads its mask as it goes
// and a long run of heredocs costs one pass, not a mask per body. `data` and
// `live` are read live: the walk pushes a body before the scan reaches it, so
// the body is honored with no rebuild. Membership is read through a forward
// pointer since the scan queries only non-decreasing indices, and a body opens
// no span, so the scan's state at a body's end is the top-level state the
// current rebuild restarts to there. The scan skips the counter past each body
// it enters, as the walk does for its own reading, so the counter's quote and
// construct state restarts at the body's end for the one-shot `maskExact`
// below as it does for the walk. `counter` is that counter, shared with the
// walk so the two read one construct state. `maskExact` is the whole-command
// one-shot, the same scan run to the end.
type ExactMasker = { at(i: number): string; full(): string; counter: ConstructCounter };
export function exactMasker(cmd: string, data: readonly Span[], live: readonly Span[], subs?: Span[]): ExactMasker {
  const chars = cmd.split('');
  const comment = new Uint8Array(cmd.length);
  let dIdx = 0;
  let lIdx = 0;
  const inData = (i: number): boolean => { while (dIdx < data.length && data[dIdx].to <= i) dIdx++; return dIdx < data.length && i >= data[dIdx].from && i < data[dIdx].to; };
  const inLive = (i: number): boolean => { while (lIdx < live.length && live[lIdx].to <= i) lIdx++; return lIdx < live.length && i >= live[lIdx].from && i < live[lIdx].to; };
  const dqEscapes = /["\\$`]/;
  const metaBefore = ' \t\n|&;()<>';
  // The counter reads positions the scan has finished, so a query at the scan
  // position extends nothing and the two never recurse into each other.
  const at = (k: number): string => { if (k >= i) extendTo(k + 1); return comment[k] === 1 ? '\x00' : chars[k]; };
  const counter = constructCounter(cmd, at, true);
  // Whether a `#` at index `i` starts a word, so it opens a comment. The
  // character before it must be the text start or one of bash's word-separating
  // metacharacters, and must not itself be escaped by a backslash (an escaped
  // space before the `#`, as in `echo a\ #x`, leaves the `#` mid-word, where
  // bash runs any substitution after it). A newline escaped by a backslash is
  // a continuation bash removes before it reads the line, so the character
  // before that pair decides instead: `echo a \` then `#x` joins to
  // `echo a #x`, a comment, while `echo a\` then `#x` joins to `echo a#x`,
  // which is not. That holds on the walk's unspliced text. The final mask is
  // built on text whose continuations are already spliced to two spaces, so
  // there the second shape opens a comment bash does not. The legacy reading
  // has run first on every call and its refusal stands, so the extra comment
  // never turns a refusal into an allow.
  const isCommentStart = (i: number): boolean => {
    let p = i;
    for (;;) {
      if (p === 0) return true;
      let k = p - 1, bs = 0;
      while (k > 0 && cmd[k - 1] === '\\') { bs++; k--; }
      if (cmd[p - 1] === '\n' && bs % 2 === 1) { p = k; continue; }
      return metaBefore.indexOf(cmd[p - 1]) >= 0 && bs % 2 === 0;
    }
  };
  // The index of the `(` an opener at `at` reaches, a backslash-newline allowed
  // between the leading `$` or `<` and its `(` as bash allows, or -1 where `at`
  // opens no `$(` or `<(` substitution. A backtick is its own opener.
  const openerParen = (at: number): number => {
    if (chars[at] === '`') return at;
    if (chars[at] !== '$' && chars[at] !== '<') return -1;
    let j = at + 1;
    while (chars[j] === '\\' && chars[j + 1] === '\n') j += 2;
    return chars[j] === '(' ? j : -1;
  };
  // Whether the `{` at `j` opens a `${` expansion as bash reads it: the run of
  // `$` before it, less a first `$` escaped by an odd run of backslashes, must
  // be odd, since `$$` pairs into the PID parameter and opens nothing.
  const opensExpansion = (j: number): boolean => {
    let k = j, run = 0;
    while (chars[k - 1] === '$') { run++; k--; }
    if (run === 0) return false;
    let bs = 0;
    while (chars[k - 1 - bs] === '\\') bs++;
    if (bs % 2 === 1) run--;
    return run % 2 === 1;
  };
  // The index just past a `(...)` substitution whose `(` stands at `p`, matching
  // parentheses and stepping over inner quoted spans, as `substitutionEnd` does
  // from a `$(`; written to start at the `(` itself so a split opener's `(`,
  // which does not sit at the `$`+1 `substitutionEnd` assumes, is matched too.
  // `braces` is the depth of `${` expansions opened inside the span, a nested
  // `${` counted within one and a bare `{` not, as bash reads them, since bash
  // closes the expansion at its first `}`; inside an expansion a `#` is part
  // of the word, so no comment is skipped there.
  const parenEnd = (p: number): number => {
    let j = p + 1;
    let depth = 1;
    let braces = 0;
    while (j < chars.length && depth > 0) {
      const c = chars[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === '{' && opensExpansion(j)) braces++;
      else if (c === '}' && braces > 0) braces--;
      else if (c === "'") { j++; while (j < chars.length && chars[j] !== "'") j++; }
      else if (c === '"') { j++; while (j < chars.length && chars[j] !== '"') { if (chars[j] === '\\') j++; j++; } }
      else if (c === '#' && braces === 0 && isCommentStart(j)) { while (j < chars.length && chars[j] !== '\n') j++; continue; }
      j++;
    }
    return j;
  };
  const collectArithmetic = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (chars[k] === '`' || (chars[k] === '$' && chars[k + 1] === '(')) k = maskSub(k) - 1;
    }
  };
  const maskSub = (at: number): number => {
    let e: number;
    let interiorFrom: number;
    if (chars[at] === '`') { e = substitutionEnd(chars, at); interiorFrom = at + 1; }
    else { const p = openerParen(at); e = parenEnd(p); interiorFrom = p + 1; }
    if (subs !== undefined) {
      if (chars[at] === '$' && chars[at + 1] === '(' && arithmeticSpan(chars, at, e)) collectArithmetic(interiorFrom, e - 1);
      else subs.push({ from: interiorFrom, to: e - 1 });
    }
    for (let k = at; k < e && k < chars.length; k++) chars[k] = SUB_SPAN;
    return e;
  };
  // The scan position, kept across `at` calls so the mask is built once from
  // left to right. One iteration completes a comment, a substitution or a
  // quoted span whole, so the scan stops only at a top-level boundary and a
  // later `at` resumes cleanly. `skipped` is the end of the last body the
  // counter was skipped past, so each body skips it once.
  let i = 0;
  let skipped = -1;
  const extendTo = (limit: number): void => {
    while (i < chars.length && i < limit) {
      const data_ = inData(i);
      const range = data_ ? data[dIdx] : inLive(i) ? live[lIdx] : null;
      if (range !== null && range.to !== skipped) {
        counter.openAt(range.from);
        counter.skipTo(range.to);
        skipped = range.to;
      }
      if (chars[i] === '\\' && i + 1 < chars.length) { i += 2; continue; }
      if (range === null && chars[i] === '#' && isCommentStart(i) && !counter.openAt(i) && !counter.arithOpenAt(i)) {
        while (i < chars.length && chars[i] !== '\n') comment[i++] = 1;
        continue;
      }
      // A substitution runs at the top level and inside a live body, never
      // inside a data body, where it is literal copy.
      if (!data_ && (chars[i] === '`'
        || (chars[i] === '$' && openerParen(i) >= 0)
        || (chars[i] === '<' && chars[i - 1] !== '<' && openerParen(i) >= 0))) {
        i = maskSub(i);
        continue;
      }
      const q = chars[i];
      if (q !== '"' && q !== "'") { i++; continue; }
      if (inData(i) || inLive(i)) { i++; continue; }
      let j = i + 1;
      while (j < chars.length && chars[j] !== q) {
        if (inData(j) || inLive(j)) break;
        if (q === '"' && ((chars[j] === '$' && openerParen(j) >= 0) || chars[j] === '`')) {
          j = maskSub(j);
          continue;
        }
        if (q === '"' && chars[j] === '\\' && j + 1 < chars.length && dqEscapes.test(chars[j + 1])) {
          chars[j] = '\x00';
          j++;
        }
        chars[j] = '\x00';
        j++;
      }
      i = j + 1;
    }
  };
  return {
    at,
    full(): string { extendTo(chars.length); return chars.join(''); },
    counter,
  };
}

export function maskExact(cmd: string, data: readonly Span[], live: readonly Span[], subs?: Span[]): string {
  return exactMasker(cmd, data, live, subs).full();
}

// Whether the exact reading of `text` can differ from the legacy one, so a
// guard that allowed `text` under the legacy reading reads it again under the
// exact one. The two differ only at a comment, which `#` spells, and at a
// heredoc introduction, which `<<` spells. The test is a lone `<`, not `<<`,
// because the `<<` a nested shell reads can form only after the text in hand
// is changed: a continuation can split the operator, and a quote strip can
// join a `<` closing one quoted segment to a `<` opening the next. Neither a
// splice nor a quote strip makes a `<` or a `#` the text lacks, so the test is
// sound at every depth.
export function exactReadingDiffers(text: string): boolean {
  return text.includes('#') || text.includes('<');
}

// The quoted heredoc introduction both body finders read: `heredocBodies` and
// docs-write's `bodyIntros`, which maps each introduction to its body and
// must read exactly the introductions `heredocBodies` takes. Groups: the
// dash, then the single-quoted and the double-quoted delimiter.
export const QUOTED_HEREDOC_INTRO = String.raw`(?<!<)<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)")(?=[ \t\r\n;|&()<>]|$)`;

// The ranges of quoted-delimiter heredoc bodies in the command. A heredoc body
// is data the receiving command reads on stdin rather than shell syntax, so its
// content is literal: `maskQuoted` reads these ranges to keep a body quote from
// opening a masking span, and the redirect blanking below reads them to blank a
// body's > operators. Only the quoted spellings (<<'EOF', <<"EOF") qualify: both
// disable parameter expansion and command substitution, so their bodies are
// literal; an unquoted <<EOF still runs $(...) in its body and is left alone.
//
// The intro is located in the passed masked copy so a << inside a quoted
// argument or inside a substitution span is not read as one: the first is data,
// and the second is scanned as its own command, where its heredoc is parsed
// afresh. Three bounds keep a range on the body. A << after
// another < is a here-string operand, not an introduction. The delimiter must be
// a whole quoted word ending where `offendingDelimiter` ends the raw word, at a
// blank, a newline or one of bash's metacharacters |, &, ;, (, ), < and >, so
// <<'EOF'>out.txt forms a body here as it does for bash and for the reader.
// A quoted word bash reads differently (<<'EOF'X, <<'E'OF, <<"E'OF") is
// refused by `offendingDelimiter` before any guard calls this, so the word
// bound here restates that rule rather than deciding it. And the body starts
// after the introducing line, walking a backslash continuation forward first,
// so a redirect on that line, glued to the word or not, stays outside the
// range as command text every guard reads. A body already found is data, so
// an introduction inside one opens nothing: an introduction falling in a range
// is skipped, which keeps a range from running past the terminator the shell
// reads.
//
// This reads the one body-blind mask the caller built, never rebuilt as a
// body is found, while `offendingDelimiter` rebuilds its mask per passed
// body. So a quote inside a body found here still stands as a span on this
// mask over the lines after the body, and can pair with a later quote, such
// as one in a later introduction's delimiter. A pairing like that can hide a
// later introduction from this function, and can leave a << inside a later
// body unmasked, read here as an introduction the reader never reads, since
// the reader passed that body. After a body holding a quote, the two readers
// can therefore disagree on which introductions exist and where their bodies
// run.
//
// This finds the bodies of the legacy reading, kept byte for byte, and serves
// the legacy pass alone. The exact reading's bodies come from `heredocWalk`
// below, which reads one forward mask that honors each body as the walk
// passes it, so the two readers it replaces cannot disagree, and which reads a
// word-start `#` as a comment and an unquoted body as a live range.
export function heredocBodies(cmd: string, masked: string): Span[] {
  const bodies: Span[] = [];
  const memo = new Map<string, BodyEnd>();
  const intro = new RegExp(QUOTED_HEREDOC_INTRO, 'g');
  let m: RegExpExecArray | null;
  while ((m = intro.exec(cmd)) !== null) {
    const at = m.index;
    if (masked[at] === '\x00' || masked[at] === SUB_SPAN) continue;
    if (bodies.some(b => at >= b.from && at < b.to)) continue;
    const delim = m[2] !== undefined ? m[2] : m[3];
    if (delim === '') continue;
    const end = bodyAfter(cmd, m.index + m[0].length, delim, m[1] === '-', memo);
    if (end !== null) bodies.push(end.body);
  }
  return bodies;
}

// Where a heredoc introduction ending at `introEnd` ends the body it opens
// for the delimiter `delim`, or null where no line follows the introducing
// line. The body starts after that line, a backslash continuation walked
// forward first, and ends at the first line equal to the delimiter by bash's
// own test: the text after the introducing line split on \n alone, each line
// compared whole under <<, and with its leading tabs stripped and nothing
// else under <<- (`dash`). No other blank is stripped, so ` EOF`, `EOF ` and
// a space-indented <<- line are body lines here as they are for bash. A body
// with no terminator runs to the end of the text. `heredocBodies` and
// `offendingDelimiter` read this one test and end a quoted word at the same
// place, so a plain body the reader passes over is the body `heredocBodies`
// takes wherever both read the introduction. `heredocExemption` keeps its
// own line loop under the same equality rule, and refuses where no line
// ends the body rather than running it to the end of the text.
//
// A line equal to the delimiter only once its trailing carriage returns are
// removed ends the range too and is returned as `carriageReturn`, since one
// bash ends the body there and another reads on: `offendingDelimiter`
// refuses the command on it before any guard reads the range.
//
// Introductions on one line share the line their bodies start after, so a
// caller passes one `memo` per command and each distinct body start,
// delimiter and dash is walked once rather than once per introduction.
type BodyEnd = { body: Span; carriageReturn: boolean; next?: number };
function bodyAfter(cmd: string, introEnd: number, delim: string, dash: boolean, memo?: Map<string, BodyEnd>): BodyEnd | null {
  let nl = cmd.indexOf('\n', introEnd);
  while (nl >= 0) {
    let k = nl;
    while (k > 0 && cmd[k - 1] === '\\') k--;
    if ((nl - k) % 2 === 0) break;
    nl = cmd.indexOf('\n', nl + 1);
  }
  if (nl < 0) return null;
  const key = `${nl}\n${dash ? 1 : 0}\n${delim}`;
  const known = memo?.get(key);
  if (known !== undefined) return known;
  const found = bodyEndFrom(cmd, nl + 1, delim, dash);
  memo?.set(key, found);
  return found;
}

function bodyEndFrom(cmd: string, from: number, delim: string, dash: boolean): BodyEnd {
  let pos = from;
  while (pos <= cmd.length) {
    let end = cmd.indexOf('\n', pos);
    if (end < 0) end = cmd.length;
    const line = cmd.slice(pos, end);
    const stripped = dash ? line.replace(/^\t+/, '') : line;
    if (stripped === delim) return { body: { from, to: pos }, carriageReturn: false };
    if (stripped.endsWith('\r') && stripped.replace(/\r+$/, '') === delim) return { body: { from, to: pos }, carriageReturn: true };
    if (end >= cmd.length) break;
    pos = end + 1;
  }
  return { body: { from, to: cmd.length }, carriageReturn: false };
}

// The exact reading's body end for a heredoc whose delimiter word is unquoted
// (`<<EOF`). Bash reads such a body's lines with every backslash-newline
// removed before it tests a line against the delimiter (parse.y,
// read_secondary_line with remove_quoted_newline), so a line ending in an odd
// run of backslashes joins the next line first: `foo\` then `EOF` is one line
// reading `fooEOF`, not a terminator, and `EO\` then `F` is the terminator
// `EOF`. An even run leaves the newline standing, since each backslash in it
// escapes the one after. The joined line is then compared character for
// character as `bodyEndFrom` compares a physical one. `next` is the index
// just past the terminator's last physical line, where command text resumes.
// A quoted, empty-quoted or backslashed delimiter word quotes the body, where
// bash removes nothing, so those bodies keep `bodyEndFrom`'s line-by-line
// test, and the legacy reading never reads this.
function liveBodyEndFrom(cmd: string, from: number, delim: string, dash: boolean): BodyEnd {
  let pos = from;
  while (pos <= cmd.length) {
    let end = cmd.indexOf('\n', pos);
    if (end < 0) end = cmd.length;
    let line = cmd.slice(pos, end);
    while (end < cmd.length && /(?<!\\)(?:\\\\)*\\$/.test(line)) {
      let nextEnd = cmd.indexOf('\n', end + 1);
      if (nextEnd < 0) nextEnd = cmd.length;
      line = line.slice(0, -1) + cmd.slice(end + 1, nextEnd);
      end = nextEnd;
    }
    const stripped = dash ? line.replace(/^\t+/, '') : line;
    const next = end >= cmd.length ? cmd.length : end + 1;
    if (stripped === delim) return { body: { from, to: pos }, carriageReturn: false, next };
    if (stripped.endsWith('\r') && stripped.replace(/\r+$/, '') === delim) return { body: { from, to: pos }, carriageReturn: true, next };
    if (end >= cmd.length) break;
    pos = end + 1;
  }
  return { body: { from, to: cmd.length }, carriageReturn: false, next: cmd.length };
}

// The character class a heredoc delimiter word holding a quote or a backslash
// must match whole, inside one pair of matching outer quotes or after one
// leading backslash, for every guard that reads heredoc bodies to read the
// command at all. Bash removes the quotes and the backslash escapes from a
// delimiter word before comparing body lines against it, and joins a quoted
// part to the unquoted text beside it, where each guard compares lines
// against the raw token, so the two end a body at the same line only where
// that removal changes nothing: one word of these characters, bare or inside
// one pair of quotes, or one leading backslash on such a word. Any other word
// holding a quote or a backslash puts live commands on the wrong side of the
// terminator for one reader or the other. With `<<"E\\OF"` bash ends the body
// at a line reading E\OF while a raw comparison reads on to E\\OF, so the
// commands between sit inside a guard's body. With `<<"E'OF"`, `<<"E'OF"x`,
// `<<E"'"OF` or `<<E\'OF` bash's terminator line carries an apostrophe that
// opens a quote span in `maskQuoted` over every command after it. No reading
// of such a word is safe short of a second shell lexer, so every guard
// refuses it ahead of its body scan, through `offendingDelimiter`.
export const PLAIN_DELIMITER_CLASS = '[A-Za-z0-9_.-]+';
const QUOTED_PLAIN_DELIMITER = new RegExp(`^(['"])(${PLAIN_DELIMITER_CLASS})\\1$`);
const ESCAPED_PLAIN_DELIMITER = new RegExp(`^\\\\${PLAIN_DELIMITER_CLASS}$`);
// The live heredoc delimiter words the exact walk reads: a bare word of
// PLAIN_DELIMITER_CLASS, the same word behind one leading backslash, or an
// empty pair of quotes, each introducing a body whose quotes bash reads as
// bytes. Bash runs the substitutions of the bare word's body alone, and the
// walk reads all three bodies' substitutions as command text, which errs only
// toward refusal. Exported beside
// QUOTED_HEREDOC_INTRO so the walk reads the live forms through one spelling and
// the quoted form through the module's existing one, with no third delimiter
// pattern. A bare word outside this class (`<<$X`, `<<E*F`) is a fault the walk
// names, since bash expands or matches it to a delimiter the walk cannot model.
export const PLAIN_HEREDOC_DELIMITER = new RegExp(`^${PLAIN_DELIMITER_CLASS}$`);

// What `offendingDelimiter` returns on a command it refuses: a delimiter
// word holding a quote or a backslash outside the admitted forms, as the
// command spells it; a terminator line equal to a plain delimiter only
// once its trailing carriage returns are removed, named by that delimiter;
// an introduction inside an open construct, or one whose introducing line
// ends inside an open quote, substitution or construct, named by its plain
// delimiter; the same open-span fault where a substitution follows the
// introduction on its line, named the same way; or an introduction split by
// a backslash-newline, named by its text from the first < through the
// delimiter word read after the split. The exact reading adds two: an
// unquoted delimiter word outside the plain class, which bash expands or
// matches, named by that word; and an introducing line that leaves an
// arithmetic `((` open, named by its delimiter.
export type DelimiterFault = { kind: 'word' | 'carriage-return' | 'open-span' | 'open-span-substitution' | 'split' | 'bare' | 'open-arith'; text: string };

// Whether a `${`, `$[` or `>(` construct is open before a given index of
// `cmd`, counted left to right from the command's start on the masks
// `offendingDelimiter` holds, each read from its `from` onward. `maskQuoted`
// masks none of the three (`>(` is left standing on purpose, see its
// comment), so a quote or `$(` span is not the only way an introducing line
// can end with bash still reading one word. Each opener pushes its closer:
// `}`, `]` or `)`. Inside an open `$[` a bare `[` nests, and inside an open
// `>(` a bare `(` nests, as bash parses both; a bare `{` inside `${` does not
// nest, which bash bears out, since `${x:-{a}` closes at its first `}`. A
// closer pops only the closer on top, so a `}` closes no `$[`. A backslash
// pair is stepped over, so `\}` closes nothing. A single-quoted span and a
// masked substitution are not counted, so the `}` of `${x:-'}'}` closes
// nothing. A double-quoted span is read on its raw text, since bash expands
// `${` and `$[` there: an opener inside it pushes, a closer pops only an
// opener pushed inside the same span, an apostrophe inside a construct
// opened there quotes up to the next apostrophe, and an opener left open at
// the span's closing quote stays open past it, as `"${x:-"` leaves bash
// reading. A passed body is skipped whole, by `skipTo`, which restarts the
// quote state there, since bash reads the text after a body at the top level.
// The mask is read through `maskAt`, the walk's own mask reader, so the count
// and the walk see one mask: the legacy walk's static segments, the exact
// masker's one forward pass, on which a comment position reads as NUL and so
// counts as nothing. What the count reads at each index it passes is kept, so
// an index already passed, such as the second introduction on one line, reads
// its own state.
type ConstructCounter = { openAt(i: number): boolean; arithOpenAt(i: number): boolean; skipTo(i: number): void };
function constructCounter(cmd: string, maskAt: (i: number) => string, exact = false): ConstructCounter {
  const open = new Uint8Array(cmd.length + 1);
  // Arithmetic `(( ))` tracking, on only when `exact` is set, so the exact
  // reading can read a `<<` inside `(( ))` as the shift bash reads it, open no
  // comment there, and refuse a `((` left open on an introducing line. A `((`
  // is decided by bash's own rule (parse.y, parse_dparen and parse_arith_cmd):
  // `arithmeticEnd` reads from the inner `(` to its matching `)`, nesting
  // parens and stepping over quoted spans and backslash pairs, and the pair is
  // arithmetic only where the very next character is `)`. So `(( (1+(2)) ))`
  // and `(((1+2)))` are arithmetic, while `((a) )` and `((a) || (b) )` are two
  // subshell parens, which bash runs as commands, and are read here as
  // ordinary parens. Each `(` is matched once per counter and the match kept
  // in `parenMatch`, so a run of `((` that never forms arithmetic costs one
  // scan of the text rather than one per `((`. An arithmetic region is marked whole, from its `((` to
  // just past its `))`, in one step, so no quote or construct inside it can
  // end it early: bash reads the whole region as one expression. Where no
  // inner close exists before the end of the text, bash reports a syntax
  // error and runs nothing, and the region is read as open to the end. The
  // legacy caller leaves `exact` off, so `open` is counted byte for byte as it
  // was before this query existed.
  const arithOpen = new Uint8Array(cmd.length + 1);
  // `parenMatch[q]` is the index of the `)` closing the `(` at `q`, `cmd.length`
  // where nothing closes it, and 0 where it is not yet read, since no closer
  // stands at index 0. The scan from a `(` is context-free, so the match of a
  // nested `(` is the same whichever scan reaches it, and a scan steps over a
  // nested `(` already read. Open indices sit on an explicit stack, never on
  // the call stack, since a command can nest tens of thousands deep. The
  // legacy counter never reads it, so it takes no table.
  const parenMatch = new Int32Array(exact ? cmd.length + 1 : 0);
  const matchOf = (q: number): number => {
    if (parenMatch[q] !== 0) return parenMatch[q];
    const opens = [q];
    for (let k = q + 1; k < cmd.length; k++) {
      const ch = cmd[k];
      if (ch === '\\') { k++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') {
        k++;
        while (k < cmd.length && cmd[k] !== ch) { if (ch !== "'" && cmd[k] === '\\') k++; k++; }
        continue;
      }
      if (ch === '(') {
        const known = parenMatch[k];
        if (known === 0) opens.push(k);
        else if (known === cmd.length) break;
        else k = known;
      } else if (ch === ')') {
        parenMatch[opens.pop() as number] = k;
        if (opens.length === 0) return k;
      }
    }
    for (const o of opens) parenMatch[o] = cmd.length;
    return cmd.length;
  };
  const arithmeticEnd = (p: number): number => {
    const m = matchOf(p + 1);
    if (m === cmd.length) return cmd.length;
    return cmd[m + 1] === ')' ? m + 2 : -1;
  };
  // The index of an opener's second character, a `{`, `[` or `(`, after the
  // leading `$` or `>` at `p`. In the exact reading it is read past any
  // backslash-newline pairs between the two, as bash removes the pairs before
  // it reads the word, and as `openerParen` in the exact masker reads a `$(`
  // or `<(`, so `$\` then `{` on the next line opens the `${` bash opens. The
  // legacy reading reads the two characters side by side only, as it always
  // has.
  const openerEnd = (p: number): number => {
    let j = p + 1;
    if (exact) while (cmd[j] === '\\' && cmd[j + 1] === '\n') j += 2;
    return j;
  };
  const stack: string[] = [];
  let pos = 0;
  let quote = '';
  let local = 0;
  let single = false;
  const restart = () => { quote = ''; local = 0; single = false; };
  const closerOf = (c: string) => (c === '{' ? '}' : c === '[' ? ']' : ')');
  // Push the closer an opener at `pos` wants, whose second character stands at
  // `end`, and mark every index through `end` as inside the construct.
  const pushOpener = (end: number) => {
    stack.push(closerOf(cmd[end]));
    for (let k = pos + 1; k <= end; k++) { open[k] = 1; arithOpen[k] = arithOpen[pos]; }
    pos = end;
  };
  const advance = (to: number) => {
    for (; pos < to; pos++) {
      open[pos] = stack.length > 0 ? 1 : 0;
      arithOpen[pos] = 0;
      const mk = maskAt(pos);
      const c = cmd[pos];
      const next = cmd[pos + 1];
      const top = stack[stack.length - 1];
      if (quote === '') {
        if (mk !== c) continue;
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '\\') { pos++; open[pos] = open[pos - 1]; arithOpen[pos] = arithOpen[pos - 1]; continue; }
        if (exact && stack.length === 0 && c === '(' && next === '(') {
          const end = arithmeticEnd(pos);
          if (end >= 0) {
            for (let k = pos; k < end; k++) { open[k] = 0; arithOpen[k] = 1; }
            pos = end - 1;
            continue;
          }
        }
        if (c === '$' || c === '>') {
          const end = openerEnd(pos);
          const nx = cmd[end];
          if ((c === '$' && (nx === '{' || nx === '[')) || (c === '>' && nx === '(')) { pushOpener(end); continue; }
        }
        if ((c === '(' && top === ')') || (c === '[' && top === ']')) stack.push(top);
        else if (c === top) stack.pop();
        continue;
      }
      if (mk === quote) { restart(); continue; }
      if (quote === "'" || mk !== '\x00') continue;
      if (single) { if (c === "'") single = false; continue; }
      if (c === '\\') { pos++; open[pos] = open[pos - 1]; arithOpen[pos] = arithOpen[pos - 1]; continue; }
      if (c === '$') {
        const end = openerEnd(pos);
        const nx = cmd[end];
        if (nx === '{' || nx === '[') { pushOpener(end); local++; continue; }
      }
      if (local === 0) continue;
      if (c === "'") single = true;
      else if (c === '[' && top === ']') { stack.push(top); local++; }
      else if (c === top) { stack.pop(); local--; }
    }
    open[pos] = stack.length > 0 ? 1 : 0;
    arithOpen[pos] = 0;
  };
  return {
    openAt(i: number): boolean { advance(i); return open[i] === 1; },
    arithOpenAt(i: number): boolean { advance(i); return arithOpen[i] === 1; },
    skipTo(i: number): void { if (i > pos) { pos = i; restart(); } },
  };
}

// The first fault of the command's heredoc delimiters, or null where there is
// none. Every guard that reads heredoc bodies consults this on the same text
// and body-blind mask it hands `heredocBodies`, before any body range,
// exemption or quote mask is built on the command, and refuses on a non-null
// return, so the fault's channel is this value and nothing throws.
//
// An introduction is a << or <<- outside a quoted span and a substitution
// span on the current mask, neither preceded nor followed by another <, so a
// here-string's <<< is none, and not inside a body the walk has passed. The
// walk reads every run of < characters, a backslash-newline allowed between
// them, so a << that bash joins across a backslash-newline is found as one
// run. A run holding a backslash-newline is the fourth fault, since bash
// removes the pair before it reads the operator and every reader runs on the
// raw text: <\ then <"E'OF" on the next line is <<"E'OF" to bash. The fault
// is returned rather than the text spliced, and names the text from the first
// < through the word read after the split, read on past any unquoted
// backslash-newline that ends that word. A backslash-newline inside the word
// itself, as in <<\ then 'EOF' or <<'EO'\ then 'F', which bash joins into the
// delimiter EOF, leaves a backslash in the raw word, so the word rule below
// refuses it.
//
// The word is read raw, with no quote awareness: the characters after the
// optional blanks up to the first space, tab or newline or the first of
// bash's metacharacters |, &, ;, (, ), < and >, so <<'EOF'>out.txt reads the
// word 'EOF'. A word holding no quote and no backslash is never an offence,
// whatever bash makes of it, since its terminator carries no quote. A word
// holding either is admitted in three forms only: one pair of matching outer
// quotes around PLAIN_DELIMITER_CLASS content, exactly '' or "", or one
// leading backslash before such content. Any other such word offends, an
// unclosed quote (<<"EOF), a suffix (<<"E'OF"x), a mid-word quote (<<E"'"OF)
// and an escaped quote (<<E\'OF) among them. Of the admitted forms only the
// quoted plain word forms a body, found by the exact terminator test in
// `bodyAfter`; a terminator line that is the delimiter only once its
// trailing carriage returns are removed is the second fault, since one bash
// ends the body there and another reads on.
//
// The third fault is an introducing line that ends inside an open quote or
// substitution: the newline `bodyAfter` starts the body after, the first past
// any backslash continuation, is masked on the current mask. Bash starts the
// body after the newline token that ends the command, which is past where
// that span closes, so a `"` or `$(` left open on the introducing line puts
// bash's body lines, its terminator and the commands after it inside the
// body the guard would read. A continuation's own newline is never masked,
// since the mask steps over a backslash pair, so a line ending in a
// backslash does not trip this. The same fault is returned where a `${`, `$[`
// or `>(` construct, which no mask blanks, is open at the introduction's <<
// or at that newline, by `constructCounter`: bash reads an introduction
// inside one as part of a word and forms no heredoc, as with
// `echo ${x:- <<'EOF'`, and reads on past a newline inside one, as with
// `cat <<'EOF' ${x:-`, so either way the lines the guard would take as body
// are not bash's body. The counter reads the construct openers from the
// command's start, outside single-quoted spans, masked substitutions and the
// bodies the walk has passed, and reads a double-quoted span's raw text too.
// The same fault, in its substitution form, is returned where the raw text
// from the end of the delimiter word to that newline holds a `$(`, `<(` or
// `>(`, closed or not, quoted or not: a `)` bash does not read as a closer,
// such as a `case` pattern's, one after a `#` comment or one inside a `${`,
// ends the span early for the mask and the count while bash reads on, and
// the list of such `)` is open, so the position is refused rather than a
// word. A substitution opening before the << and enclosing it is not in that
// text, so `git commit -m "$(cat <<'EOF'` keeps its reading, and a backtick
// is not counted. The counter and the substitution test both read an opener
// only where its two characters stand side by side, so an opener spelled
// across a line continuation, such as $\ then { on the next line, is not
// read as one.
//
// The walk adds each passed body to the passed list and rebuilds the mask
// with those bodies honored before reading on, so a quote inside a passed
// body opens no span that would hide a later introduction, and a line of a
// passed body that quotes <<"E'OF" as text is not read as one. The empty and
// the backslash forms open no body here, as they open none in
// `heredocBodies`, so their lines are read as command text and any
// introduction in them is read.
//
// The rebuilt mask is the mask of the text after the passed body, read from
// a clean state, kept beside the earlier masks as a segment the walk looks
// up by position. It equals the mask of the whole command with the passed
// bodies honored at every position after the body, since `maskQuoted` ends
// any quote span at a body it honors and skips the body's characters, so the
// scan is at top level where the body ends. The rebuild is skipped where the
// body holds no quote, backtick, $, backslash or <, since then the body opens
// no span and the current mask already agrees with the honoring one past the
// body; a span open on entry to the body, such as a # comment's apostrophe on
// the introducing line, is the third fault above, so none reaches the
// rebuild. A body ending at or before the newest segment's start takes no
// segment either, as the second heredoc introduced on one line does when its
// body, read from the same line as the first's, ends inside the first's: the
// newest segment already starts past it, and the segments stay in increasing
// order for the lookup by position. Each rebuild costs the tail's length, so
// a long run of plain heredocs walks in one pass where no body is masked and
// none holds a trigger character, and in a pass per body otherwise.
export function offendingDelimiter(cmd: string, masked: string): DelimiterFault | null {
  return heredocWalk(cmd, masked, false).fault;
}

// The data ranges, the live ranges and the first fault of a command's heredocs.
// The legacy reading (`exact` false) takes only the quoted-delimiter bodies as
// data and raises exactly the faults the comment above `offendingDelimiter`
// names, byte for byte, serving `offendingDelimiter` and every guard that reads
// it unchanged. The exact reading (`exact` true) additionally takes the
// unquoted, empty and backslashed bodies as live ranges, reads a `<<` inside a
// `(( ))` as the shift bash reads it, splices a split opener on the introducing
// line as bash joins it, and raises two faults the legacy reading does not: a
// bare delimiter word outside PLAIN_DELIMITER_CLASS, which bash would expand or
// match to a word the walk cannot know, and an arithmetic `((` left open on the
// introducing line, which starts the body past the line the walk reads. In the
// exact reading a body starts after the first newline the exact mask leaves
// standing, so a quote or substitution that spans the introducing line is read
// as bash reads it rather than desyncing the body. One quote in a passed body
// cannot hide a later introduction, which is where `heredocBodies` and
// `offendingDelimiter` could disagree; here they are one function. The legacy
// reading rebuilds its body-blind mask after each body to get that; the exact
// reading reads one forward pass that honors each body as the walk passes it,
// so a long run of heredocs costs one pass, not a mask per body.
type HeredocRanges = { data: Span[]; live: Span[]; fault: DelimiterFault | null };
export function heredocWalk(cmd: string, masked: string, exact: boolean): HeredocRanges {
  const passed: Span[] = [];
  const data: Span[] = [];
  const live: Span[] = [];
  const memo = new Map<string, BodyEnd>();
  // The exact reading reads one forward pass that honors `data` and `live` as
  // the walk pushes to them, and never reads `masked`. The legacy reading keeps
  // the body-blind mask it was handed and rebuilds the tail with `maskQuoted`
  // after each body, looked up by segment. Both expose the same `maskAt` to the
  // walk and the construct counter, which in the exact reading is the masker's
  // own, so the comment rule and the walk read one construct state.
  const exactMask = exact ? exactMasker(cmd, data, live) : null;
  const masks: { from: number; masked: string }[] = [{ from: 0, masked }];
  const segmentOf = (i: number): { from: number; masked: string } => {
    for (let k = masks.length - 1; k > 0; k--) if (i >= masks[k].from) return masks[k];
    return masks[0];
  };
  const maskAt = exact
    ? (i: number): string => exactMask!.at(i)
    : (i: number): string => { const s = segmentOf(i); return s.masked[i - s.from]; };
  const counter = exact ? exactMask!.counter : constructCounter(cmd, maskAt, false);
  // Whether `at` lies in a body the walk has passed. The exact reading's
  // bodies are taken in increasing order and the operator loop queries
  // non-decreasing indices, so a forward pointer reads membership in one pass.
  // The legacy reading's bodies can overlap, as two introductions on one line
  // read from the same body start do, so it scans the list as it always has.
  let pIdx = 0;
  const inPassed = (at: number): boolean => {
    if (!exact) return passed.some(b => at >= b.from && at < b.to);
    while (pIdx < passed.length && passed[pIdx].to <= at) pIdx++;
    return pIdx < passed.length && at >= passed[pIdx].from;
  };
  const operator = /<(?:(?:\\\n)*<)+/g;
  const lead = /-?[ \t]*/y;
  const rawWord = /[^ \t\n|&;()<>]*/y;
  const wordAt = (i: number): { start: number; word: string } => {
    lead.lastIndex = i;
    lead.exec(cmd);
    rawWord.lastIndex = lead.lastIndex;
    return { start: lead.lastIndex, word: rawWord.exec(cmd)![0] };
  };
  // True where the word ends in an unquoted backslash-newline: an odd run
  // of backslashes before a newline, its last backslash unmasked.
  const splitAfter = (start: number, word: string): boolean => {
    const end = start + word.length;
    if (cmd[end] !== '\n') return false;
    let k = end;
    while (k > start && cmd[k - 1] === '\\') k--;
    const last = maskAt(end - 1);
    return (end - k) % 2 === 1 && last !== '\x00' && last !== SUB_SPAN;
  };
  const splitFault = (at: number, from: number): DelimiterFault => {
    let { start, word } = wordAt(from);
    while (splitAfter(start, word)) ({ start, word } = wordAt(start + word.length + 1));
    return { kind: 'split', text: cmd.slice(at, start + word.length) };
  };
  // The first newline after `from` that the exact mask leaves standing: not
  // inside a quoted or substitution span and not a backslash continuation, so
  // bash and the walk start the body on the same line even where a quote or a
  // substitution spans the introducing line. Returns -1 where no line follows.
  // The last answer is kept: a `from` between the last query's `from` and its
  // newline has that same newline as its first standing one, so a line holding
  // many introductions searches the line once rather than once per `<<`.
  let nlFrom = -1;
  let nlFound = -1;
  const exactBodyStartNL = (from: number): number => {
    if (nlFrom >= 0 && from >= nlFrom && (nlFound < 0 || from <= nlFound)) return nlFound;
    let nl = cmd.indexOf('\n', from);
    while (nl >= 0) {
      if (maskAt(nl) === '\n') {
        let k = nl;
        while (k > 0 && cmd[k - 1] === '\\') k--;
        if ((nl - k) % 2 === 0) break;
      }
      nl = cmd.indexOf('\n', nl + 1);
    }
    nlFrom = from;
    nlFound = nl;
    return nl;
  };
  // Record a body the walk has read and honor it against later introductions.
  // The exact forward mask reads `data` and `live` directly, so pushing the body
  // there is enough; the counter skips over it, which restarts its quote state
  // at the body's end. The legacy reading rebuilds the body-blind tail mask with
  // `maskQuoted` only where the body itself holds one of the trunk's trigger
  // characters, so a quote inside the body opens no span over what follows and
  // a run of trigger-free bodies costs no rebuild at all.
  const take = (body: Span, kind: 'data' | 'live'): void => {
    passed.push(body);
    (kind === 'data' ? data : live).push(body);
    counter.skipTo(body.to);
    if (exact) return;
    if (body.to <= masks[masks.length - 1].from) return;
    if (/['"`$\\<]/.test(cmd.slice(body.from, body.to))) {
      masks.push({ from: body.to, masked: maskQuoted(cmd.slice(body.to)) });
    }
  };
  // The exact reading's handling of one introduction past its delimiter word: a
  // live body for `kind` 'live' and a data body for 'data'. Returns a fault, or
  // null once the body is taken. A `((` open at the body-start newline, or a
  // quote, substitution or `${`/`$[`/`>(` construct open at the introduction or
  // that newline, starts the body past the line the walk reads, so each refuses.
  // Two introductions on one line take their bodies in order, each starting on
  // the line after the previous one's terminator. `sameLineNL` is the standing
  // newline that ended the last introducing line and `sameLineNext` the line
  // after the last body's terminator, so a second `<<` sharing that line reads
  // its body past the first. `join` is set for an unquoted delimiter word
  // alone, whose body bash reads with backslash-newlines removed before the
  // terminator test, so that body ends by `liveBodyEndFrom`; every other word
  // quotes the body and it ends by `bodyEndFrom`'s line-by-line test.
  let sameLineNL = -1;
  let sameLineNext = -1;
  const exactBody = (at: number, afterWord: number, delim: string, kind: 'data' | 'live', join = false): DelimiterFault | null => {
    const nl = exactBodyStartNL(afterWord);
    if (nl < 0) return null;
    if (counter.openAt(at) || counter.openAt(nl)) return { kind: 'open-span', text: delim };
    if (counter.arithOpenAt(nl)) return { kind: 'open-arith', text: delim };
    const from = (nl === sameLineNL && sameLineNext >= 0) ? sameLineNext : nl + 1;
    const dash = cmd[at + 2] === '-';
    const end = join ? liveBodyEndFrom(cmd, from, delim, dash) : bodyEndFrom(cmd, from, delim, dash);
    if (end.carriageReturn) return { kind: 'carriage-return', text: delim };
    take(end.body, kind);
    sameLineNL = nl;
    if (end.next !== undefined) { sameLineNext = end.next; return null; }
    const termNL = cmd.indexOf('\n', end.body.to);
    sameLineNext = termNL < 0 ? cmd.length : termNL + 1;
    return null;
  };
  let m: RegExpExecArray | null;
  while ((m = operator.exec(cmd)) !== null) {
    const at = m.index;
    const mk = maskAt(at);
    // A `<<` inside a quoted span, a substitution span or, in the exact
    // reading, a comment, whose positions the exact mask reads as NUL, is bytes.
    if (mk === '\x00' || mk === SUB_SPAN) continue;
    if (inPassed(at)) continue;
    // In the exact reading a `<<` inside an open `(( ))` is a shift, so it
    // introduces no body.
    if (exact && counter.arithOpenAt(at)) continue;
    // In the exact reading a `<<` whose first `<` carries an odd run of
    // backslashes is escaped, so `\<<` introduces nothing: the shell reads the
    // surviving single `<` as an input redirect, not a heredoc.
    if (exact) {
      let bs = 0;
      while (at - bs - 1 >= 0 && cmd[at - bs - 1] === '\\') bs++;
      if (bs % 2 === 1) continue;
    }
    if (m[0].length > 2) {
      if (m[0].includes('\n')) return { data, live, fault: splitFault(at, at + m[0].length) };
      continue;
    }
    const { start, word } = wordAt(at + 2);
    if (!/['"\\]/.test(word)) {
      if (!exact) continue;
      if (!PLAIN_HEREDOC_DELIMITER.test(word)) return { data, live, fault: { kind: 'bare', text: word } };
      const f = exactBody(at, start + word.length, word, 'live', true);
      if (f !== null) return { data, live, fault: f };
      continue;
    }
    const quoted = QUOTED_PLAIN_DELIMITER.exec(word);
    if (quoted === null) {
      if (word === "''" || word === '""' || ESCAPED_PLAIN_DELIMITER.test(word)) {
        if (!exact) continue;
        const delim = word.charAt(0) === '\\' ? word.slice(1) : '';
        const f = exactBody(at, start + word.length, delim, 'live');
        if (f !== null) return { data, live, fault: f };
        continue;
      }
      return { data, live, fault: { kind: 'word', text: word } };
    }
    if (exact) {
      const f = exactBody(at, start + word.length, quoted[2], 'data');
      if (f !== null) return { data, live, fault: f };
      continue;
    }
    const end = bodyAfter(cmd, start + word.length, quoted[2], cmd[at + 2] === '-', memo);
    if (end === null) continue;
    const lineEnd = maskAt(end.body.from - 1);
    if (lineEnd === '\x00' || lineEnd === SUB_SPAN || counter.openAt(at) || counter.openAt(end.body.from - 1)) {
      return { data, live, fault: { kind: 'open-span', text: quoted[2] } };
    }
    if (/[$<>]\(/.test(cmd.slice(start + word.length, end.body.from - 1))) {
      return { data, live, fault: { kind: 'open-span-substitution', text: quoted[2] } };
    }
    if (end.carriageReturn) return { data, live, fault: { kind: 'carriage-return', text: quoted[2] } };
    take(end.body, 'data');
  }
  return { data, live, fault: null };
}

// The description of a command refused for `fault`, as `offendingDelimiter`
// returned it, for a guard whose refusal helper takes a what and an instead
// sentence, the forms left to `delimiterAdvice`. The word is the command's
// own text on its way to the model, so it passes through `quote`, the fold
// and bracket guard every quoted command word takes.
export function delimiterWhat(fault: DelimiterFault, quote: (text: string) => string): string {
  if (fault.kind === 'word') return `a heredoc whose delimiter ${quote(fault.text)} holds a quote or a backslash and is not plain`;
  if (fault.kind === 'open-span') return `a heredoc whose delimiter ${quote(fault.text)} is introduced inside an open \${, $[ or >( construct, or on a line that ends inside an open quote, substitution or such construct, so the shell does not start the body at the line the gate reads`;
  if (fault.kind === 'open-span-substitution') return `a heredoc whose delimiter ${quote(fault.text)} is followed on its introducing line by a substitution, so the shell can start the body at a line the gate does not read`;
  if (fault.kind === 'split') return `a heredoc introduction ${quote(fault.text)} split across lines by a backslash-newline, which the shell joins into an operator and delimiter the gate does not read`;
  if (fault.kind === 'bare') return `a heredoc whose unquoted delimiter ${quote(fault.text)} is not a plain word, so the shell expands or matches it to a delimiter the gate cannot know`;
  if (fault.kind === 'open-arith') return `a heredoc whose delimiter ${quote(fault.text)} is introduced on a line that leaves an arithmetic (( open, so the shell starts the body past the line the gate reads`;
  return `a heredoc whose terminator line is ${quote(fault.text)} followed by a carriage return, which ends the body for one bash and not another`;
}

// The same description inside the fixed refusal line of a guard whose reason
// is a description of the command alone, so a word fault carries the
// admitted forms in a parenthesis, since no instead sentence follows it.
export function delimiterFault(fault: DelimiterFault, quote: (text: string) => string): string {
  const what = delimiterWhat(fault, quote);
  return fault.kind === 'word'
    ? `${what} (one word of ${PLAIN_DELIMITER_CLASS} inside one pair of quotes, or after one backslash)`
    : what;
}

// The way around the refusal `fault` names, for a guard whose refusal helper
// takes an instead sentence.
export function delimiterAdvice(fault: DelimiterFault): string {
  if (fault.kind === 'word') return `Spell the delimiter as one word of ${PLAIN_DELIMITER_CLASS} inside one pair of quotes, so the gate and the shell end the body at the same line`;
  if (fault.kind === 'open-span') return 'Close every quote, substitution and ${, $[ or >( construct before the << and on its introducing line, so the gate and the shell start the body at the same line';
  if (fault.kind === 'open-span-substitution') return 'Move every substitution after the << on the introducing line ahead of the <<, or into a variable set on an earlier line, so the gate and the shell start the body at the same line';
  if (fault.kind === 'split') return 'Write the << operator and its delimiter word on one line, with no backslash-newline inside them, so the gate and the shell read the same heredoc';
  if (fault.kind === 'bare') return `Spell the delimiter as one plain word of ${PLAIN_DELIMITER_CLASS}, quoted where the body must stay literal, so the gate and the shell end the body at the same line`;
  if (fault.kind === 'open-arith') return 'Close the arithmetic (( )) on the introducing line, or move the << to a line with no open ((, so the gate and the shell start the body at the same line';
  return 'End the terminator line with a bare newline, so the gate and the shell end the body at the same line';
}

// A copy of the masked command with the > characters inside each heredoc body
// blanked. Read as a redirect operator a body's > denies ordinary work, since a
// > in a body is a comparison or an arrow function and writing a driver script
// through a heredoc is how an agent that holds no Write tool authors one. The
// sentinel differs from the NUL quoted spans use because the two need different
// treatment downstream: a > is both a redirect operator and a command boundary,
// and only the first reading is wrong inside a body. `segment` cuts on the
// sentinel as it would on the character, so an operand list still ends where the
// shell ends it, while `writeTargets` does not see a redirect. Erasing the
// boundary instead would merge a body's operands into the command around it.
//
// This blanking is the only thing done here: command-position scanning still runs
// over the body, so a governed verb inside one denies wherever it sits. The whole
// exemption that lets a data sink's body through untouched is decided by
// `heredocExemption` over the whole command string, and its mask is applied in
// `denyReason`.
const BODY_REDIRECT = '\x01';
function maskHeredocRedirects(masked: string, bodies: readonly Span[]): string {
  const chars = masked.split('');
  for (const b of bodies) {
    for (let i = b.from; i < b.to; i++) if (chars[i] === '>') chars[i] = BODY_REDIRECT;
  }
  return chars.join('');
}

// The heredoc-introducing line parsed into a token stream, or null when it is not
// a well-formed quoted-delimiter heredoc line at all (an unbalanced quote, a
// backslash continuation, or a heredoc whose delimiter is unquoted, empty, or
// desyncing). An excluded construct on an otherwise well-formed line sets the
// `blocked` flag instead of failing outright: the tokens parsed before it are
// kept, so `heredocExemption` refuses on the flag rather than on a garbled token
// stream, which is what lets a single check discriminate the excluded-construct
// condition. The excluded constructs are a pipe, a separator, a subshell or brace
// group, a command or process substitution, an input redirect that is not the
// heredoc, a descriptor dup, a word-start comment, and a second heredoc.
//
// Quote-aware and confined to the intro line, so body text (a stray apostrophe
// among it) can never reach this decision, which is the specific defect a
// condition set read off a body-wide quote mask carried. A word records whether
// it was quoted; a redirect records its file-descriptor prefix and its append
// form; a heredoc records its delimiter and dash form.
function parseIntro(intro: string): { stream: IntroToken[]; heredoc: { delim: string; dash: boolean } | null; blocked: boolean } | null {
  if (/\\$/.test(intro)) return null;                 // a backslash continuation
  const n = intro.length;
  const stream: IntroToken[] = [];
  let cur: { text: string; quoted: boolean } | null = null as { text: string; quoted: boolean } | null;
  let heredoc: { delim: string; dash: boolean } | null = null;
  let blocked = false;
  const flush = () => { if (cur) { stream.push({ type: 'word', text: cur.text, quoted: cur.quoted }); cur = null; } };
  let i = 0;
  while (i < n) {
    const c = intro[i];
    if (c === ' ' || c === '\t' || c === '\r') { flush(); i++; continue; }
    if (c === "'") {
      let j = i + 1, s = '';
      while (j < n && intro[j] !== "'") { s += intro[j]; j++; }
      if (j >= n) return null;                    // an unbalanced quote
      cur = cur || { text: '', quoted: false };
      cur.text += s; cur.quoted = true;
      i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, s = '', sub = false;
      while (j < n && intro[j] !== '"') {
        if ((intro[j] === '$' && intro[j + 1] === '(') || intro[j] === '`') { sub = true; break; }   // a live substitution
        if (intro[j] === '\\' && j + 1 < n && /["\\$`]/.test(intro[j + 1])) { s += intro[j + 1]; j += 2; continue; }
        s += intro[j]; j++;
      }
      if (sub) { blocked = true; break; }
      if (j >= n) return null;                    // an unbalanced quote
      cur = cur || { text: '', quoted: false };
      cur.text += s; cur.quoted = true;
      i = j + 1; continue;
    }
    if (c === '\\') { if (i + 1 >= n) return null; cur = cur || { text: '', quoted: false }; cur.text += intro[i + 1]; i += 2; continue; }
    if (c === '#' && cur === null) { blocked = true; break; }    // a comment at word start
    if (c === '|' || c === ';' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}' || c === '`') { blocked = true; break; }
    if (c === '$' && intro[i + 1] === '(') { blocked = true; break; }
    if (c === '<' && intro[i + 1] === '(') { blocked = true; break; }
    if (c === '<' && intro[i + 1] === '<') {
      flush();
      let j = i + 2, dash = false;
      if (intro[j] === '-') { dash = true; j++; }
      while (j < n && (intro[j] === ' ' || intro[j] === '\t')) j++;
      if (intro[j] !== "'" && intro[j] !== '"') return null;   // an unquoted delimiter
      const q = intro[j]; j++;
      let d = '';
      while (j < n && intro[j] !== q) { d += intro[j]; j++; }
      if (j >= n) return null;                    // an unbalanced delimiter quote
      j++;
      if (j < n && !/[ \t\r]/.test(intro[j])) return null;     // a desyncing suffix (<<'EOF'X)
      if (d === '') return null;                  // an empty delimiter
      if (heredoc) { blocked = true; break; }     // a second heredoc
      heredoc = { delim: d, dash };
      stream.push({ type: 'heredoc' });
      i = j; continue;
    }
    if (c === '<') { blocked = true; break; }        // an input redirect that is not a heredoc
    if (c === '>') {
      let fd = '';
      if (cur && !cur.quoted && /^[0-9]+$/.test(cur.text)) { fd = cur.text; cur = null; }
      else flush();
      let j = i + 1, append = false;
      if (intro[j] === '>') { append = true; j++; }
      if (intro[j] === '|') j++;
      if (intro[j] === '&') { blocked = true; break; }         // a descriptor dup
      stream.push({ type: 'redir', fd, append });
      i = j; continue;
    }
    cur = cur || { text: '', quoted: false };
    cur.text += c; i++;
  }
  if (!blocked) flush();
  if (!heredoc && !blocked) return null;              // not a heredoc line at all
  return { stream, heredoc, blocked };
}

// The body range { from, to } to mask as data, or null. The exemption holds only
// where the ENTIRE command string is one simple heredoc write of exactly this
// shape, decided before and independently of the quote mask so body text cannot
// influence it:
//   1. one `cat` or `tee` owns one heredoc whose delimiter is quoted and
//      plain, the exported `offendingDelimiter` having refused the command
//      ahead of this decision where any delimiter word holding a quote or a
//      backslash is outside the forms it admits;
//   2. one `>`/`>>` redirect with no descriptor prefix, or one `tee` file
//      operand, is the only destination;
//   3. that destination resolves inside the class's writable set or outside
//      the git root entirely;
//   4. the terminator is matched by bash's own rule (a line equal to the
//      delimiter for <<, leading tabs stripped for <<-, no other whitespace);
//   5. nothing but whitespace follows the terminator;
//   6. the introducing line carries no excluded construct: a second <<, a
//      separator, a pipe, a further redirect, a subshell or brace group, a
//      command or process substitution, a backslash continuation, an unquoted #,
//      or an unbalanced quote (conditions 1, 2, and 6 are what `parseIntro`
//      enforces on the intro line).
// Because the shape admits no separator, pipe, subshell, substitution, or second
// heredoc, the shell can read no command this mask would hide: the masked window
// cannot be wider than the one the shell parses. Every bypass either review
// round verified requires an excluded construct, so each dies here by
// construction. Anything outside the shape leaves the body scanned, and every
// unresolvable value (a destination built from a variable, a missing terminator)
// refuses.
export async function heredocExemption(cmd: string, cwd: string, strict: boolean, host: LexHost): Promise<{ from: number; to: number } | null> {
  const firstNL = cmd.indexOf('\n');
  if (firstNL < 0) return null;                       // a heredoc body sits on a later line
  const parsed = parseIntro(cmd.slice(0, firstNL));
  if (parsed === null) return null;
  const { stream, heredoc, blocked } = parsed;
  if (blocked) return null;                           // an excluded construct on the intro line
  if (!heredoc || !stream.length || stream[0].type !== 'word' || stream[0].quoted) return null;
  const owner = stream[0].text;
  if (owner !== 'cat' && owner !== 'tee') return null;
  // One destination, and no stray operand that would change what the sink reads.
  const dests = [];
  for (let k = 1; k < stream.length; k++) {
    const t = stream[k];
    if (t.type === 'heredoc') continue;
    if (t.type === 'redir') {
      if (t.fd) return null;                      // a file-descriptor prefix
      const next = stream[k + 1];
      if (!next || next.type !== 'word') return null;
      dests.push(next.text);
      k++;
      continue;
    }
    if (t.text.startsWith('-')) {
      if (owner === 'tee') continue;              // a tee flag
      return null;                                // cat takes no flag in this shape
    }
    if (owner !== 'tee') return null;               // a stray file operand to cat
    dests.push(t.text);
  }
  if (dests.length !== 1) return null;
  const root = await repoRoot(cwd, host);
  const writable = strict ? KIT_ONLY : GATE_OUTPUT_DIRS;
  // The destination must be a place the guard can positively put the body:
  // inside the class's writable set, or outside the tree under review
  // entirely, which mirrors the plain redirect this command is a spelling of
  // (echo hi > /tmp/review.md allows, so a report heredoc aimed at the same
  // path does too). An unresolvable destination refuses, so "outside" is a
  // positive placement rather than a failure to place.
  if (!writableTarget(dests[0], cwd, root, writable, host)
    && (resolveTarget(dests[0], cwd, host) === null || inTreeTarget(dests[0], cwd, root, writable, host))) {
    return null;
  }
  // The terminator, by bash's own rule, and nothing after it. CRLF is normalized
  // to a bare newline and a bare carriage return is refused before the command
  // reaches here, so a terminator line carries no trailing \r and the match is
  // exactly bash's ^DELIM$ (leading tabs stripped for the dash form).
  const bodyStart = firstNL + 1;
  let pos = bodyStart, termStart = -1, termEnd = -1;
  for (const line of cmd.slice(bodyStart).split('\n')) {
    const stripped = heredoc.dash ? line.replace(/^\t+/, '') : line;
    if (stripped === heredoc.delim) { termStart = pos; termEnd = pos + line.length; break; }
    pos += line.length + 1;
  }
  if (termStart < 0) return null;                     // no terminator
  if (/\S/.test(cmd.slice(termEnd))) return null;     // a command after the terminator
  return { from: bodyStart, to: termStart };
}

// The newline index of every genuine line continuation in the command: a
// backslash standing immediately before a newline, where the shell removes the
// pair and joins the text on either side. Only an odd-length run of backslashes
// continues a line: in an even run every backslash is itself escaped and the
// newline after it is a real separator. That is bash's rule and the one
// `heredocBodies` walks its intro line by. A quoted-delimiter heredoc body is
// literal data where bash splices nothing, so a pair inside one of `bodies` is
// no continuation. Bash splices nothing inside a single-quoted span either;
// `outsideSingleQuotes` below drops those pairs, reading the span off a quote
// mask, since this rule carries no quote, comment or dialect state: it reads
// every text, Bash or PowerShell, at every depth, the same way.
function continuationPairs(cmd: string, bodies: readonly Span[]): number[] {
  const pairs: number[] = [];
  for (let i = 1; i < cmd.length; i++) {
    if (cmd[i] !== '\n' || cmd[i - 1] !== '\\') continue;
    let run = 0;
    while (run < i && cmd[i - 1 - run] === '\\') run++;
    if (run % 2 === 0) continue;
    if (bodies.some(b => i - 1 >= b.from && i - 1 < b.to)) continue;
    pairs.push(i);
  }
  return pairs;
}

// Of `pairs`, newline indexes of continuations in `cmd`, those standing
// inside a word: the character before the pair's backslash and the character
// after its newline are both non-whitespace. Removing such a pair glues the
// text on either side into one word, so these are the only pairs whose
// removal can move a word start a reader keys on; a pair beside whitespace
// leaves every word start where it was under either of the splice's
// readings.
export function inWordPairs(cmd: string, pairs: readonly number[]): number[] {
  return pairs.filter(i => i >= 2 && i + 1 < cmd.length && !/\s/.test(cmd[i - 2]) && !/\s/.test(cmd[i + 1]));
}

// Of `pairs`, newline indexes of continuations in the text `masked` is the
// quote mask of, those outside every single-quoted span. The mask is built on
// the text as handed in, under the reading in force, with its heredoc bodies
// blanked: a pair's backslash inside a quoted span is blanked, and the
// blanked run it sits in opens on a single quote, where a run inside a
// double-quoted span opens on a double quote or a substitution sentinel.
// Bash reads a backslash-newline inside single quotes as two literal bytes,
// so the splice leaves such a pair as typed under every reading and the
// composer gives it no reading: a string a user quotes whole, with a
// backslash ending each of its lines, holds any number of such pairs and
// runs as one plain command, read once rather than refused or read per
// pair. Where the span is an executor's payload, the pair reaches the next
// depth as typed, and the composer there reads it as that text's own.
export function outsideSingleQuotes(masked: string, pairs: readonly number[]): number[] {
  if (pairs.length === 0) return [];
  // The nearest unblanked index before each blanked one, read in one pass, so
  // a string holding many pairs costs its length once rather than once per
  // pair.
  const opener = new Int32Array(masked.length);
  let before = -1;
  for (let k = 0; k < masked.length; k++) {
    opener[k] = before;
    if (masked[k] !== '\x00') before = k;
  }
  return pairs.filter(i => masked[i - 1] !== '\x00' || opener[i - 1] < 0 || masked[opener[i - 1]] !== "'");
}

// The command with every line continuation spliced out, in one of its readings,
// with the heredoc body spans carried onto it and a map from any other index into
// the command as it was handed in. A backslash standing immediately before a
// newline is removed by the shell together with the newline, joining the text on
// either side with no boundary between, so `git \<newline>push` runs git push.
// Left in place, that newline ends an operand list in `segment` and every
// positional-subcommand reader loses its subcommand.
//
// The continuations are `continuationPairs` outside `bodies`, less those
// `outsideSingleQuotes` drops off `masked`, the quote mask of `cmd` as handed
// in under the reading in force, with `bodies` blanked. `bodies` are the
// quoted-delimiter bodies alone, literal data where bash splices nothing; an
// unquoted body is live text whose backslash-newlines bash removes as it
// reads the body, so a caller leaves those spans out and maps them through
// `at`. A pair inside a single-quoted span stays as typed under every
// reading, two literal bytes to bash, which a nested executor's payload
// carries to the next depth for the composer there.
//
// `join` picks the reading. With `join` false the pair becomes two spaces, so the
// command keeps its length, every index into it stays valid, `at` is the
// identity, and the join reads as a word boundary. With `join` true the pair is
// removed as the shell removes it, so a command word or a `$(` opener the pair
// fell inside is whole once joined and `commandPositions` and the quoted-span
// mask read it as the shell does, except the one pair whose newline index is
// `boundary`, which takes two spaces as under the first reading. Removal shortens
// the command, so `bodies` comes back shifted and `at` maps any other index: to
// the joined index of that character where it survives, and to the index of the
// next surviving character where the pair took it, so a half-open span maps end
// for end onto the span of its surviving text. The data-sink exemption span and
// docs-write's heredoc introduction indexes go through it.
//
// No single reading matches every reader downstream. Two spaces keep every word
// start a reader keyed on `commandPositions` keys on, the mutation detectors
// here and the gates' call finders among them, but split a word the shell
// reads whole; docs-write's `simpleCommands` reads its command starts another
// way, and the two spaces hold no such promise to it. Removal keeps every word
// whole but can glue a word start onto the text before it where the shell
// reads a word start, as a pair ending an unquoted comment or a pair after a
// PowerShell path separator does, and a text can hold a pair of each kind, so
// that the comment-ending pair hides the governed word under removal and the
// in-word pair hides it under two spaces. A joined reading that keeps the
// comment-ending pair as a boundary shows the reader the whole word at its word
// start. `readUnderContinuations` below composes the readings a text takes:
// two spaces, removal, and removal with each in-word pair as the boundary, a
// refusal from any standing. The composer enumerates its pairs from the
// bodies and the mask of the same reading the guard splices under, through
// `readingSpans`, so a text's composer and each of its readings agree on
// which pairs are continuations.
export type Spliced = { cmd: string; bodies: Span[]; at: (i: number) => number };
export function spliceContinuations(cmd: string, bodies: readonly Span[], masked: string, join: boolean, boundary = -1): Spliced {
  const chars = cmd.split('');
  const keep: boolean[] = new Array(chars.length).fill(true);
  for (const i of outsideSingleQuotes(masked, continuationPairs(cmd, bodies))) {
    if (join && i !== boundary) {
      keep[i - 1] = false;
      keep[i] = false;
    } else {
      chars[i - 1] = ' ';
      chars[i] = ' ';
    }
  }
  if (!join) return { cmd: chars.join(''), bodies: bodies.map(b => ({ from: b.from, to: b.to })), at: (i: number) => i };
  // pos[i] is the count of surviving characters before index i, which is the
  // joined index of cmd[i] where it survives and of the next survivor where not.
  const pos: number[] = new Array(chars.length + 1);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    pos[i] = out.length;
    if (keep[i]) out.push(chars[i]);
  }
  pos[chars.length] = out.length;
  const at = (i: number) => pos[Math.min(Math.max(i, 0), chars.length)];
  return { cmd: out.join(''), bodies: bodies.map(b => ({ from: at(b.from), to: at(b.to) })), at };
}

// The most in-word continuations outside single quotes a text may carry and
// still be read. Each in-word pair adds one reading of its text, so the
// readings grow linearly with the pairs, and a nested text composes once per
// decide call whatever the outer readings, so a call's readings add over the
// texts it reads rather than multiply. The bound holds the pairs a shell
// splices to a small number; a pair inside single quotes, which bash leaves
// as typed, is left as typed and adds no reading, since a quoted string with
// a backslash ending each line is a plain command however many lines it has,
// and a payload carrying such pairs is read at the next depth, where they
// count toward that text's own bound. A text past the bound is refused unread
// with `CONTINUATION_CAP_REASON`.
export const IN_WORD_PAIR_CAP = 8;

// The reason a guard whose refusal describes the command alone gives for a
// text past `IN_WORD_PAIR_CAP`, in the shape of its neighbouring reasons.
export const CONTINUATION_CAP_REASON =
  `a text with more than ${IN_WORD_PAIR_CAP} line continuations inside its words, past what the guard reads (put each command on its own plain line)`;

// The way around that refusal, for a guard whose refusal helper takes an
// instead sentence.
export const CONTINUATION_CAP_ADVICE = 'Put each command on its own plain line, with no backslash-newline inside a word';

// One guard's reading of one text, `text`, under one reading of the splice:
// `join` and `boundary` as `spliceContinuations` takes them.
export type ContinuationRead<T> = (text: string, join: boolean, boundary: number) => T | Promise<T>;

// The heredoc body spans and the quote mask of `cmd` as handed in, under the
// reading `exact` selects: the two a guard's read of that text splices by,
// and the two the composer below enumerates its readings from, so the pairs
// it reads under are the pairs each reading splices. The legacy reading finds
// the quoted-delimiter bodies on a body-blind mask through `heredocBodies` and
// masks with those bodies blanked. The exact reading takes `heredocWalk`'s
// data bodies, and masks with its live bodies read as command text whose
// quotes are bytes, so a quote inside an unquoted body opens no span over the
// pairs after it. A walk fault needs no handling here: the guard's read of the
// text refuses on it under the first reading, and the composer returns that
// refusal before it enumerates anything.
function readingSpans(cmd: string, exact: boolean): { bodies: Span[]; masked: string } {
  if (exact) {
    const walk = heredocWalk(cmd, '', true);
    return { bodies: walk.data, masked: maskExact(cmd, walk.data, walk.live) };
  }
  const bodies = heredocBodies(cmd, maskQuoted(cmd));
  return { bodies, masked: maskQuoted(cmd, bodies) };
}

// A guard's verdict over `cmd` composed from every reading of its continuations,
// so that a refusal under any stands. The first reading is two spaces, so every
// refusal it gives keeps its reason byte for byte; where it allows and the text
// holds no genuine continuation the splice would touch, that allow is the
// verdict, since every reading writes the same bytes. Otherwise the text is
// read joined, then joined with each in-word pair kept as a boundary, and the
// first refusal is the verdict. A text with more than `IN_WORD_PAIR_CAP`
// in-word pairs takes `capped` in place of those readings. The pairs are
// enumerated through `readingSpans` under `exact`, the reading of comments and
// heredoc bodies the guard reads `cmd` under, so a pair inside a body the
// exact walk takes and the legacy reading does not, or the reverse, is read
// as that reading splices it; a pair inside single quotes is left as typed by
// every reading and so is given none, as `outsideSingleQuotes` states.
// `refused` tells a refusal from an allow; `allowed` folds the
// allows into the verdict where every reading allowed, the first one's by
// default, which fits a reader whose allow carries nothing, while a reader whose
// allow carries facts its caller still weighs, as docs-write's `names` does,
// folds them so none is lost. The composer runs on the text in hand at every
// depth, so a pair that forms only once an executor's payload has its quotes
// stripped is read where it exists, and a nested text with no pair costs one
// reading; a guard holds each nested text's composed verdict in a
// `VerdictMemo` through `memoized` below, so a nested text composes once per
// decide call however many outer readings hand it down, and the readings a
// call makes add over its texts rather than multiply. `cmd` is the text
// exactly as each reading splices it, its CRLF pairs already normalized to
// newlines by the guard's decide, so the boundary indexes land on the text
// the reading splices; a reading normalizes nothing itself, since a second
// pass over a terminator ending in two carriage returns would collapse the
// bare one the first pass left and lose the fault it marks.
export async function readUnderContinuations<T>(
  cmd: string,
  exact: boolean,
  read: ContinuationRead<T>,
  refused: (result: T) => boolean,
  capped: () => T,
  allowed: (results: readonly T[]) => T = results => results[0],
): Promise<T> {
  const results: T[] = [await read(cmd, false, -1)];
  if (refused(results[0])) return results[0];
  const { bodies, masked } = readingSpans(cmd, exact);
  const pairs = outsideSingleQuotes(masked, continuationPairs(cmd, bodies));
  if (pairs.length === 0) return results[0];
  const inWord = inWordPairs(cmd, pairs);
  if (inWord.length > IN_WORD_PAIR_CAP) return capped();
  for (const boundary of [-1, ...inWord]) {
    const result = await read(cmd, true, boundary);
    if (refused(result)) return result;
    results.push(result);
  }
  return allowed(results);
}

// The composed verdicts of one decide call's nested texts, keyed by `memoized`
// on the text and on whatever else its verdict depends on within the call, its
// depth among them. A guard's decide makes one and hands it down every
// recursion, so the same nested text handed down by several outer readings
// composes once.
export type VerdictMemo = Map<string, Promise<unknown>>;

// The composed verdict of `text` under `compose`, from `memo` where the call
// has composed that text under `key` before, and composed and stored there
// otherwise. `key` names what the verdict depends on beside the text, so two
// texts alike in bytes at different depths, or under different judges, hold
// their own verdicts. The stored value is the promise, so a verdict in flight
// is shared rather than composed twice.
export function memoized<T>(memo: VerdictMemo, key: string, text: string, compose: () => Promise<T>): Promise<T> {
  const k = JSON.stringify([key, text]);
  let verdict = memo.get(k) as Promise<T> | undefined;
  if (verdict === undefined) {
    verdict = compose();
    memo.set(k, verdict);
  }
  return verdict;
}

// One command out of a chain, pipeline, or multi-line script: the text from
// `from` up to the next unquoted shell separator, redirect, or line break.
// The cut is found in the masked copy, so a separator inside a quoted argument
// (sed -i 's/a/b/;s/c/d/' src/x) or inside a substitution span (git -C $(pwd)
// commit) does not truncate the operand list. A newline ends a command as surely
// as a semicolon; without it the next line's command name reads as an operand of
// this one. Every newline still standing here is one the shell reads, because a
// continued line's backslash-newline pair is spliced out of both copies before the
// masks are built, under any of the splice's readings; a pair the splice
// leaves standing, after an even backslash run or inside a quoted heredoc body,
// keeps a newline the shell reads too. The `)` stays in the cut set for the
// subshell closer the mask
// leaves visible: in (git push), the operand list must end at the paren. A backtick is
// not in it, because every live backtick span is blanked before this runs and a
// tick still visible in the masked copy is a literal character (an escaped tick,
// or data inside a heredoc body), where a cut would truncate the operand list at
// a byte the shell reads as part of a word. The \x01 sentinel is
// maskHeredocRedirects's blanked body redirect, a boundary the shell still
// reads; a bare carriage return is refused at the boundary, so it never reaches
// this cut. The returned text carries the original characters, except that a
// substitution span rides as its sentinel bytes: the expansion's value is
// unknowable, so the span must tokenize as one opaque word rather than as raw
// $( text a whitespace split would break apart.
export function segment(cmd: string, masked: string, from: number): string {
  const cut = masked.slice(from).search(/[;|&<>)\n\x01]/);
  const to = cut < 0 ? cmd.length : from + cut;
  let out = '';
  for (let i = from; i < to; i++) out += masked[i] === SUB_SPAN ? SUB_SPAN : cmd[i];
  return out;
}

// One token with its surrounding quotes removed. Inside double quotes a backslash
// before " \ $ or ` escapes that character, so one level of quoting is undone the
// way the shell would undo it; a Windows path separator (src\file) is left alone.
function unquote(t: string): string {
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  }
  if (t.length > 1 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t.replace(/^["']|["']$/g, '');
}

// The words of a segment, quoting removed the way the shell removes it. A word
// ends at whitespace and nowhere else, so quoted and unquoted runs standing
// adjacent are one word ("git"" push" and --message="x y" are each a single
// argument), which is what the shell hands the command and what a reader comparing
// a subcommand or a nested payload against a name must see: split at the quote
// instead, "git"" push" reads as a git with no subcommand and a stray operand.
// Inside a double-quoted run a backslash escapes " \ $ or ` and nothing else, so a
// Windows separator survives; a single-quoted run is literal; an unterminated
// quote runs to the end of the segment. Outside a quoted run a backslash is taken
// as an escape only before a quote character, which is the one place the reading
// matters here: \" is a literal quote that opens no run, while the backslash in a
// Windows path (src\file) is a separator this host's shells read as one.
//
// Where a caller passes the optional array literal, it receives one boolean per
// word: whether the word reaches the command as the text read here under both
// shells this host runs. A single-quoted run is literal whole. Inside a double-
// quoted run a $ or a backtick expands unless a backslash escapes it. Outside a
// quoted run any character but a letter, a digit or one of _ - . / : = , + is one
// a shell may rewrite (a variable, a brace, a glob, an escape, a PowerShell
// expression or splat), and a substitution span is never literal.
export function tokens(seg: string, literal?: boolean[]): string[] {
  const out: string[] = [];
  let cur: string | null = null as string | null;
  let lit = true;
  const end = () => { out.push(cur as string); if (literal) literal.push(lit); };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (/\s/.test(c)) { if (cur !== null) end(); cur = null; lit = true; continue; }
    if (cur === null) cur = '';
    if (c === '\\' && (seg[i + 1] === '"' || seg[i + 1] === "'")) { cur += seg[i + 1]; i++; lit = false; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < seg.length && seg[j] !== c) {
        if (c === '"' && seg[j] === '\\' && j + 1 < seg.length && /["\\$`]/.test(seg[j + 1])) j++;
        else if (c === '"' && /[$`\x02]/.test(seg[j])) lit = false;
        cur += seg[j];
        j++;
      }
      i = j;
      continue;
    }
    if (!/[A-Za-z0-9_\-./:=,+]/.test(c)) lit = false;
    cur += c;
  }
  if (cur !== null) end();
  return out;
}

// Every index just past an occurrence of one of `names` in command position
// (start of string, or after whitespace, a shell separator, a backtick, or a
// substitution span, all of which open a command position: what follows a
// substitution the shell runs is a fresh word the shell parses, so $(true)git
// stands git in command position exactly as `true`git and ;git do) in the masked
// command, paired with the matched name, lowercased. A substitution span also
// closes the word on the trailing side, so a name glued to one (git$(true) push,
// which the shell resolves to git push when the substitution prints nothing) is
// still matched, and the span rides on as the leading token of its segment, where
// a full-span operand token is stepped over and the real subcommand is read. Only
// a substitution abutting the name is a boundary here: a substitution splitting
// the name itself (g$(x)it) leaves no whole name to match and stays the documented
// assembly miss. An invocation may carry a leading backslash (\git), a directory
// prefix (/usr/bin/git, ./node_modules/.bin/prettier), and an executable suffix
// (git.exe), since all three are ordinary ways to name the same command. Residual
// false hit, accepted: an operand whose final path element is exactly a governed
// name (wc -l docs/rm) reads as an invocation, which matters only if a following
// operand then places in the tree. The mask keeps a name inside a quoted argument
// from matching at all.
export function commandPositions(masked: string, names: readonly string[]): { name: string; at: number }[] {
  const re = new RegExp(
    `(?:^|[\\s;|&(\`${SUB_SPAN}])\\\\?(?:[^\\s;|&(]*[\\\\/])?(${names.join('|')})(?:\\.(?:exe|cmd|bat|ps1))?(?=\\s|$|${SUB_SPAN})`,
    'gi'
  );
  const out: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) out.push({ name: m[1].toLowerCase(), at: m.index + m[0].length });
  return out;
}

// Directories inside the repo a class may mutate freely. .kit/ is gitignored
// scratch for both classes. The gate-runner list is the .NET and Node build
// output a gate legitimately clears; dist and coverage are deliberately absent
// because both are commonly tracked, while bin is present because rm -rf bin obj
// is the canonical clean in this kit's default stack.
const KIT_ONLY = ['.kit'];
const GATE_OUTPUT_DIRS = ['.kit', 'bin', 'obj', 'testresults', 'node_modules', '.vs'];

// The git root at or above `dir`: the nearest ancestor holding a .git entry, or
// `dir` itself when there is none. Containment is judged against this rather than
// against the payload cwd, so a subagent working from a subdirectory cannot reach
// the rest of the tree through a relative path (rm ../README.md).
export async function repoRoot(dir: string, host: LexHost): Promise<string> {
  const path = host.path;
  let cur = dir;
  for (let i = 0; i < 64; i++) {
    try { if (await host.exists(path.join(cur, '.git'))) return cur; } catch { return dir; }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dir;
}

// The target of the last cd / pushd / Set-Location before position `end`, or null
// when the command switches no directory ahead of that point. The verbs are found
// in the masked copy, so one named inside a quoted argument does not count.
function lastPathSwitchBefore(cmd: string, masked: string, end: number): string | null {
  const re = /(?:^|[\s;&|(])(?:cd|pushd|chdir|Set-Location|sl)(?=\s)/gi;
  let target: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    if (m.index >= end) break;
    const t = /^\s*("[^"]*"|'[^']*'|[^\s;&|)]+)/.exec(cmd.slice(m.index + m[0].length));
    if (t) target = t[1];
  }
  return target;
}

// The candidate directories a mutation at `at` could run in. With no directory
// switch ahead of it, the payload cwd. A switch to a literal target that
// resolves to a real directory moves the base there. A literal target that does
// not resolve (the directory does not exist yet, or names a file) yields two
// candidates, because a failed literal cd cannot move the shell out of the
// tree, only deeper into it or nowhere at all: the target as it would resolve
// (an earlier command in the chain may create it, mkdir -p tmp && cd tmp) and
// the cwd itself (with ; a failed cd leaves the shell exactly where it was). A
// target the guard cannot read at all (one routed through a variable or a
// backtick, an option-shaped one such as cd -, an empty one) falls back to the
// payload cwd rather than to no candidate: every caller iterates the returned
// candidates, so an empty list turns the write, mutation, and overwrite checks
// off for the whole command, and a cd prefix would disarm them. The fallback
// restores the payload-cwd baseline rather than the directory the shell is
// actually in: where a readable switch earlier in the chain already moved the
// base elsewhere (cd C:/Users && cd $FOO && rm README.md), judging from the
// payload cwd can deny an operand the shell resolves outside the tree. That
// cost leans toward denial and is the price of keeping the checks armed.
export async function effectiveDirs(cmd: string, masked: string, at: number, cwd: string, host: LexHost): Promise<string[]> {
  const target = lastPathSwitchBefore(cmd, masked, at);
  if (target === null) return [cwd];
  const bare = unquote(target);
  if (!bare || bare.startsWith('-') || /[$%`]/.test(bare)) return [cwd];
  let resolved: string;
  try { resolved = host.path.resolve(cwd, bare); } catch { return [cwd]; }
  try {
    if (await host.isDirectory(resolved)) return [resolved];
  } catch { /* not a directory today: judge both candidates below */ }
  return [resolved, cwd];
}

// A target path resolved against `base`, with the alternate spellings of an
// absolute path normalized first: a \\?\ extended-length prefix on a drive path
// is stripped, and on a Windows host the Git-Bash form /<drive>/<rest> becomes
// <drive>:/<rest> (it is what pwd prints inside the Bash tool, so it names
// in-tree files with no evasive intent). A deterministic subset of shell
// spellings resolves too, because each names a value fixed before the shell
// runs: $PWD, ${PWD}, and %CD% are the directory the command runs in, which is
// `base` itself (base already carries any preceding cd, so this is what the
// shell would compute), and a bare ~ or a ~/ prefix is the home directory,
// which sits outside the repo, so resolving it turns "cannot place" into a
// confirmed out-of-tree answer rather than an unplaceable one. Precision caveat
// on ~: bash expands it only when unquoted, and quotes are stripped above this
// test, so a quoted "~/x" is expanded here where the shell would read
// <base>/~/x; that corner turns a deny into an allow and is accepted rather
// than threading quotedness through every caller. Null for everything else that
// cannot be resolved before the shell runs, which is the fail-open direction: a
// descriptor dup (2>&1), a path built through any other shell or environment
// variable, a ~user path, the null device.
export function resolveTarget(raw: string, base: string, host: LexHost): string | null {
  const path = host.path;
  let s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  if (s.startsWith('&')) return null;                       // a descriptor, not a path
  if (/^\\\\\?\\[A-Za-z]:/.test(s)) s = s.slice(4);         // extended-length prefix
  if (path.sep === '\\' && /^\/[A-Za-z]\//.test(s)) s = `${s[1]}:${s.slice(2)}`;
  s = s.replace(/\$\{PWD\}|\$PWD(?![0-9A-Za-z_])/g, () => base)
    .replace(/%CD%/gi, () => base);
  if (s === '~' || /^~[\\/]/.test(s)) s = path.join(host.home, s.slice(1));
  if (/[$%`]/.test(s) || s.startsWith('~')) return null;    // outside the resolvable subset
  if (/^(?:\/dev\/null|nul)$/i.test(s)) return null;        // the null device
  try { return path.resolve(base, s); } catch { return null; }
}

// True when a target path lands in the tree under review: inside `root` and
// outside the class's writable directories, or an ancestor of `root`, since
// deleting an ancestor takes the tree with it. Relative operands resolve against
// `base`, the directory the command runs in. False for everything the guard
// cannot positively place in the tree.
function inTreeTarget(raw: string, base: string, root: string, writable: readonly string[], host: LexHost): boolean {
  const path = host.path;
  const resolved = resolveTarget(raw, base, host);
  if (resolved === null) return false;
  const outward = (p: string) => path.isAbsolute(p) || /^\.\.(?:[\\/]|$)/.test(p);
  const rel = path.relative(root, resolved);
  if (rel === '') return true;                              // the repo root itself
  // A writable directory counts at any depth, not only at the repo root: .kit/
  // is gitignored wherever it sits, and a solution's build output lives at
  // src/<project>/obj as readily as at obj.
  if (!outward(rel)) {
    return !rel.split(/[\\/]/).some(part => writable.includes(part.toLowerCase()));
  }
  return !outward(path.relative(resolved, root));           // an ancestor of the repo
}

// True when a target path resolves to a place the class may write: inside `root`
// and under one of `writable` at any depth. The inverse of inTreeTarget rather than
// its negation, since both answer false for a path they cannot place, and the
// heredoc exemption needs the positive answer: an unresolvable destination leaves
// the body scanned.
function writableTarget(raw: string, base: string, root: string, writable: readonly string[], host: LexHost): boolean {
  const path = host.path;
  const resolved = resolveTarget(raw, base, host);
  if (resolved === null) return false;
  const rel = path.relative(root, resolved);
  if (rel === '' || path.isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) return false;
  return rel.split(/[\\/]/).some(part => writable.includes(part.toLowerCase()));
}

// True when a target resolves to something that already exists on disk. The
// overwrite rule for the creating commands hangs on this: creating a new file
// is visible in git status, overwriting an existing one destroys its content. A
// stat failure reads as not-there, the fail-open direction.
async function targetExists(raw: string, base: string, host: LexHost): Promise<boolean> {
  const resolved = resolveTarget(raw, base, host);
  if (resolved === null) return false;
  try { return await host.exists(resolved); } catch { return false; }
}

// git subcommands that always change repo, index, worktree, or remote state.
// Whole-token comparison, never a word-boundary regex: "merge-base" is a read a
// reviewer runs constantly to resolve a base ref, and a \b alternation on "merge"
// would match it. symbolic-ref is absent deliberately: reading the current branch
// (git symbolic-ref --quiet --short HEAD) is a read the kit's own hooks run.
// Three entries are deliberate over-blocks, because the mutating form is the
// dangerous one and the read-only form is cheap to lose: "stash" (a reviewer
// stashing the diff under review is the catastrophic case, so git stash list goes
// with it), "clean" (git clean -nd only lists), and "apply" (git apply --check
// only validates).
const GIT_MUTATIONS = new Set([
  'add', 'am', 'apply', 'checkout', 'checkout-index', 'cherry-pick', 'clean',
  'clone', 'commit', 'filter-branch', 'gc', 'init', 'merge', 'mergetool', 'mv',
  'prune', 'pull', 'push', 'read-tree', 'rebase', 'reset', 'restore', 'revert',
  'rm', 'sparse-checkout', 'stash', 'switch', 'update-index', 'update-ref',
]);

// git global flags that take their value as a separate following token. An
// =-joined form (--git-dir=x) is one token and consumes nothing, so the
// subcommand after it is still read correctly.
export const GIT_VALUE_FLAGS = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/;

// git runs an alias as its subcommand, and `-c alias.<name>=<value>` defines one
// for the invocation, so the command's real verb sits in a config value rather
// than in the token the subcommand scan reads: `git -c alias.x='!git push' x`
// pushes, and no shell escape is needed for it, since the bare `alias.p=push`
// spelling reaches the same verb. That value is data to the shell and a command
// to git, so the quote mask is right to treat it as data and cannot be what
// bounds it. The subcommand is therefore unresolvable from the command line and
// denies, per the fail-closed rule. The bound is the alias key rather than the
// value's shape, so an ordinary assignment whose value merely contains a word
// that also names a subcommand (git -c core.pager='less push' log) still allows.
// The alias key is one member of a wider class, and the rest of that class is
// residual here rather than covered: git also runs a command from several other
// config values (core.fsmonitor, core.sshCommand, core.pager carrying a bang,
// credential.helper, diff.external, uploadpack.packObjectsHook, and an
// include.path naming a file that sets any of them), and every one of those
// still allows. They are left open deliberately rather than by oversight,
// because the bound that works for an alias, the key alone, would deny the
// everyday review spelling git -c core.pager=cat log; bounding them needs a
// value-shape rule, a different instrument than this one and not the
// work of this exemption.
const GIT_ALIAS_CONFIG = /^alias\./i;

// A short description of the git state mutation in the command, or null when
// every git invocation in it is a read. Scans the whole string, so a chain
// (git diff && git checkout main) is judged on its worst member, and skips the
// global flags between "git" and the subcommand (git -C . commit,
// git --no-pager checkout) along with any masked substitution span standing
// there (git $(true) push), per the SUB_TOKEN rule. Reads stay allowed,
// including the ones that share a prefix with a mutation (merge-base,
// ls-files), the read subverbs of the subcommands that do both (git submodule
// status, git bisect log, git branch --list), and an invocation asking for
// help. fetch, remote, and config are
// deliberately absent: they touch no tracked file in the tree under review, and
// resolving a base ref (git fetch origin, git config --get) is review work.
// True when a git branch or tag invocation names a ref to create: it carries a
// bare operand and none of its own read flags, which are the ones that turn an
// operand into a filter (git branch --contains abc) rather than a new name.
function refCreation(rest: readonly string[], readLong: RegExp, readShort: RegExp): boolean {
  if (rest.some(a => readLong.test(a) || readShort.test(a))) return false;
  return rest.some(a => !a.startsWith('-'));
}

function gitMutation(cmd: string, masked: string): string | null {
  for (const hit of commandPositions(masked, ['git'])) {
    const toks = tokens(segment(cmd, masked, hit.at));
    let i = 0;
    while (i < toks.length && (toks[i].startsWith('-') || SUB_TOKEN.test(toks[i]))) {
      const aliasKey = ((toks[i] === '-c' || toks[i] === '--config-env')
        && GIT_ALIAS_CONFIG.test(toks[i + 1] || ''))
        || /^--config-env=alias\./i.test(toks[i]);
      if (aliasKey) return 'a git alias defined on the command line (the subcommand is in the alias value, not on the command line)';
      i += GIT_VALUE_FLAGS.test(toks[i]) ? 2 : 1;
    }
    const sub = (toks[i] || '').toLowerCase();
    if (!sub) continue;
    // A substitution spliced into the subcommand token (git $(true)push) leaves
    // a value the guard cannot resolve to a subcommand, so it denies rather than
    // matching no mutation name and falling through, per the fail-closed rule.
    if (spliced(sub)) return 'a git subcommand the guard cannot resolve (a substitution is spliced into it)';
    const rest = toks.slice(i + 1);
    // A help flag is documentation only in the position git itself reads it,
    // immediately after the subcommand. Anywhere later it can be an option's
    // value and the command still acts (git stash push -m "-h" stashes,
    // git clean -fd -e -h deletes with -h as the exclude pattern).
    if (rest[0] === '--help' || rest[0] === '-h') continue;
    if (GIT_MUTATIONS.has(sub)) return `a git state change (git ${sub})`;
    // Subcommands that read in their bare form and mutate either under a flag
    // or by naming a ref to create. Creating a ref is a repo-state change that
    // moves no tracked file, so the two `git status --porcelain` readings the
    // tree-state check compares stay identical and it cannot see the ref at
    // all; a read flag (--list, --contains, --points-at, --merged, --sort) keeps
    // an operand a filter rather than a new name.
    if (sub === 'branch') {
      if (rest.some(a => /^-[dDmMcCf]$/.test(a) || /^--(?:delete|move|copy|force|set-upstream-to|unset-upstream)/.test(a))) {
        return 'a git branch mutation';
      }
      if (refCreation(rest, /^--(?:list|contains|no-contains|points-at|merged|no-merged|sort|format|all|remotes|verbose)/, /^-[alrvq]+$/)) {
        return 'a git branch creation';
      }
    }
    if (sub === 'tag') {
      if (rest.some(a => /^-[dasmufF]$/.test(a) || /^--(?:delete|annotate|sign|local-user|force|file)/.test(a))) {
        return 'a git tag mutation';
      }
      if (refCreation(rest, /^--(?:list|contains|no-contains|points-at|merged|no-merged|sort|format)/, /^-[lnq]+$/)) {
        return 'a git tag creation';
      }
    }
    // Subcommands that mutate under a subverb, which is their first bare
    // operand: git worktree list, git submodule status, and git bisect log
    // stay reads, and a path that merely contains a verb does not count.
    const subverb = (rest.filter(a => !a.startsWith('-') && !SUB_TOKEN.test(a))[0] || '').toLowerCase();
    // The subverb decides the mutation for these three, so a substitution spliced
    // into it (git worktree $(true)add) is as unresolvable as a spliced subcommand.
    if (spliced(subverb) && /^(?:worktree|submodule|bisect)$/.test(sub)) {
      return `a git ${sub} subcommand the guard cannot resolve (a substitution is spliced into it)`;
    }
    if (sub === 'worktree' && /^(?:add|remove|move|prune)$/.test(subverb)) return 'a git worktree mutation';
    if (sub === 'submodule' && /^(?:add|update|deinit|sync|set-url|absorbgitdirs)$/.test(subverb)) return 'a git submodule mutation';
    if (sub === 'bisect' && /^(?:start|good|bad|new|old|skip|reset|run|replay)$/.test(subverb)) return 'a git bisect mutation';
  }
  return null;
}

// gh global flags that take their value as a separate following token, so the
// command group after them is read correctly (gh -R owner/name pr merge).
const GH_VALUE_FLAGS = /^(?:-R|--repo|--json|--jq|--template|--hostname)$/;

// While gh is still finding its command, any other --long flag without = or
// two-character -x flag takes the next token as its value, as gh's command
// finder reads it (gh issue --title x create runs gh issue create). Help is
// read as a boolean in both spellings: whether or not gh's finder takes a
// value after -h, the parse then prints help and runs nothing. The guard reads a value after
// the root's --version, which gh rejects once a group follows it.
const GH_FINDER_VALUE_FLAG = /^(?:--(?!help$)[^=]+|-[^-=h])$/;

// The gh commands that take no subcommand once their name is read, so a flag
// after them is the command's own and the finder rule above stops there.
const GH_LEAF_COMMANDS = /^(?:api|browse|co|status|completion)$/;

function ghFinding(bare: readonly string[]): boolean {
  if (bare.length === 0) return true;
  const group = bare[0].toLowerCase();
  if (bare.length === 1) return !GH_LEAF_COMMANDS.test(group);
  if (bare.length === 2) return group === 'repo' && /^(?:autolink|deploy-key)$/.test(bare[1].toLowerCase());
  return false;
}

// The values gh's flag parser reads as false for a boolean flag (Go's ParseBool).
const GH_FALSE = /^(?:false|False|FALSE|f|F|0)$/;

// The reason a gh command denies with when a word of it is not literal, in the
// sense tokens() reports: the shell may rewrite such a word into a verb, a
// second word or a flag such as --web before gh reads it (gh pr view {1,--web}
// runs gh pr view 1 --web), and gh reads write flags in every position, so no
// one position can be trusted. Spelling the word literally is the remedy.
const GH_UNRESOLVED = 'a gh command the guard cannot resolve (a word in it is one the shell may rewrite before gh reads it: a variable, brace, glob, escape or PowerShell expression); spell each word literally, single-quoted where it carries a special character';

// Whether a token may set a gh boolean flag on, in any spelling gh's flag parser
// accepts: --long bare or =value, and the short letter alone, inside a bundle of
// short flags (-cw) or with =value (-w=true, -cw=1). The guard does not know
// which letters of an arbitrary command take a value, so any letter before the
// first = counts, and only the flag's own letter last with a false value after
// the = turns it off. A value glued to another flag (-lwip) reads as the flag
// too, which denies a read rather than letting the flag through.
function ghFlagOn(tok: string, short: string, long: string): boolean {
  const m = new RegExp(`^--${long}(?:=(.*))?$`).exec(tok);
  if (m) return m[1] === undefined || !GH_FALSE.test(m[1]);
  if (!/^-[A-Za-z]/.test(tok)) return false;
  const eq = tok.indexOf('=');
  const letters = tok.slice(1, eq < 0 ? undefined : eq);
  if (!letters.includes(short)) return false;
  return !(eq >= 0 && letters.indexOf(short) === letters.length - 1 && GH_FALSE.test(tok.slice(eq + 1)));
}

// What one token of a gh browse command does to its print-only flag, read as
// gh's flag parser reads it against browse's own flags: set is true or false
// where the token sets --no-browser and null where it does not, and next says
// the token makes the following token a value. a, p, r, s, w and n are
// booleans, c takes an optional value and so reads its default inside a
// bundle, and b takes the rest of the bundle, or the next token, as a branch.
// A letter browse does not have ends what the guard can read of the bundle
// (gh browse -nR o/r takes o/r as the repository), so the token keeps what the
// letters before it set.
function ghBrowsePrintOnly(tok: string): { set: boolean | null; next: boolean } {
  const m = /^--no-browser(?:=(.*))?$/.exec(tok);
  if (m) return { set: m[1] === undefined || !GH_FALSE.test(m[1]), next: false };
  if (/^--branch$/.test(tok)) return { set: null, next: true };
  if (!/^-[A-Za-z]/.test(tok)) return { set: null, next: false };
  let set: boolean | null = null;
  for (let i = 1; i < tok.length; i++) {
    const c = tok[i];
    if (!'aprswncb'.includes(c)) return { set, next: false };
    if (tok[i + 1] === '=') {
      if (c === 'n') set = !GH_FALSE.test(tok.slice(i + 2));
      return { set, next: false };
    }
    if (c === 'b') return { set, next: i === tok.length - 1 };
    if (c === 'n') set = true;
  }
  return { set, next: false };
}

// A description of a GitHub state mutation in the command, or null. Merging,
// closing, or commenting on the pull request under review, mutating the
// repository or an issue, dispatching a workflow, or writing a secret or
// variable changes the state the review is about, reaches outside the machine,
// and moves no tracked file, so the two `git status --porcelain` readings the
// tree-state check around a review round compares stay identical and it cannot
// see the mutation at all. Reads stay allowed: gh pr view, gh pr diff,
// gh run list, and a GET through gh api. gh api's own default method is GET
// normally and POST once any parameter flag adds a field, so a field or body
// flag with no explicit method is a write.
function ghMutation(cmd: string, masked: string): string | null {
  for (const hit of commandPositions(masked, ['gh'])) {
    const literal: boolean[] = [];
    const toks = tokens(segment(cmd, masked, hit.at), literal);
    const bare: string[] = [];
    const bareAt: number[] = [];
    // The browser flags, read as whole tokens in the same pass that steps
    // over a global flag's value: -w or --web asks gh to open the configured
    // browser, and -n or --no-browser asks gh browse to print the URL instead.
    let web: string | null = null;
    let noBrowser = false;
    let branchValue = false;
    // A bare -- ends gh's flag parsing, so every later token is an operand
    // (gh browse -- -n opens the location -n in the browser).
    let flagsEnded = false;
    for (let i = 0; i < toks.length; i++) {
      // A token that is the branch value gh browse reads (gh browse -b -n
      // opens branch -n) sets nothing, and the last setting wins.
      const isBranchValue = branchValue;
      branchValue = false;
      if (!flagsEnded && !isBranchValue && toks[i] === '--') {
        flagsEnded = true;
        continue;
      }
      if (!flagsEnded && toks[i].startsWith('-')) {
        if (ghFlagOn(toks[i], 'w', 'web')) web = toks[i];
        if (!isBranchValue) {
          const r = ghBrowsePrintOnly(toks[i]);
          if (r.set !== null) noBrowser = r.set;
          branchValue = r.next;
        }
        if (GH_VALUE_FLAGS.test(toks[i])) i++;
        else if (ghFinding(bare) && GH_FINDER_VALUE_FLAG.test(toks[i])) i++;
        continue;
      }
      // gh's finder drops an empty word (gh pr '' merge runs gh pr merge).
      if (toks[i] === '') continue;
      if (SUB_TOKEN.test(toks[i])) continue;
      bare.push(toks[i]);
      bareAt.push(i);
    }
    const group = (bare[0] || '').toLowerCase();
    const verb = (bare[1] || '').toLowerCase();
    // The command group and its verb decide the mutation, so a substitution
    // spliced into either (gh pr $(true)merge 1) leaves an unresolvable value
    // that denies rather than matching no verb and falling through.
    if (spliced(group) || spliced(verb)) {
      return 'a gh subcommand the guard cannot resolve (a substitution is spliced into it)';
    }
    // Each group's list names every verb of the installed gh that writes GitHub
    // state, with the alias gh prints for it (new for create, co for checkout,
    // remove for delete). A verb gh adds later is allowed until the list is
    // reviewed, since an unnamed verb is allowed by design. The group set is
    // partial on the same stance: a group no line below names (gist, project,
    // codespace, cache, ruleset, auth and the rest) has no verb denied, writes
    // included, until a line is added for it, though the browser flag and a
    // word the shell may rewrite still deny there. gh pr checkout, and
    // gh co, the root alias gh ships for it, are denied because they move HEAD
    // and the worktree exactly as the git checkout and git switch the guard
    // denies.
    if (group === 'co' || (group === 'pr' && /^(?:checkout|co)$/.test(verb))) {
      return `a checkout of a pull request into the worktree (gh ${group === 'co' ? 'co' : 'pr ' + verb})`;
    }
    if (group === 'pr'
      && /^(?:create|new|close|comment|edit|lock|merge|ready|reopen|revert|review|unlock|update-branch)$/.test(verb)) {
      return `a pull-request mutation (gh pr ${verb})`;
    }
    if (group === 'release'
      && /^(?:create|new|delete|delete-asset|edit|upload)$/.test(verb)) {
      return `a release mutation (gh release ${verb})`;
    }
    // clone is git clone under another spelling, which the git reader denies.
    if (group === 'repo'
      && /^(?:create|new|delete|edit|rename|archive|unarchive|fork|sync|set-default|clone)$/.test(verb)) {
      return `a repository mutation (gh repo ${verb})`;
    }
    // autolink and deploy-key carry their own subcommands, so the third bare
    // token decides: the reads stay allowed and anything else, a missing
    // token included, is denied. A help flag immediately after the verb is
    // documentation only, as the git reader treats one after a subcommand.
    if (group === 'repo' && /^(?:autolink|deploy-key)$/.test(verb)) {
      const sub = (bare[2] || '').toLowerCase();
      const next = toks[bareAt[1] + 1];
      const help = next === '--help' || next === '-h';
      if (!help && !/^(?:list|ls|view)$/.test(sub)) {
        return `a repository mutation (gh repo ${verb}${sub ? ' ' + sub : ''})`;
      }
    }
    if (group === 'label' && /^(?:clone|create|delete|edit)$/.test(verb)) {
      return `a label mutation (gh label ${verb})`;
    }
    if (group === 'run' && /^(?:cancel|delete|rerun)$/.test(verb)) {
      return `a workflow-run mutation (gh run ${verb})`;
    }
    if (group === 'workflow' && /^(?:run|enable|disable)$/.test(verb)) {
      return `a workflow mutation (gh workflow ${verb})`;
    }
    if ((group === 'secret' || group === 'variable') && /^(?:set|delete|remove)$/.test(verb)) {
      return `a ${group} mutation (gh ${group} ${verb})`;
    }
    // gh alias set x 'issue create' followed by gh x runs a denied verb under a
    // name the guard cannot know, so the write that plants the name is the one
    // the guard can see. An alias already in the machine's gh config is a
    // residual the guard does not see.
    if (group === 'alias' && /^(?:set|delete|import)$/.test(verb)) {
      return `an alias mutation (gh alias ${verb})`;
    }
    if (group === 'issue'
      && /^(?:create|new|close|comment|delete|develop|edit|lock|pin|reopen|transfer|unlock|unpin)$/.test(verb)) {
      return `an issue mutation (gh issue ${verb})`;
    }
    // A key added to the account is a standing credential rather than an
    // occasional public write, so the key groups are named here.
    if ((group === 'ssh-key' || group === 'gpg-key') && /^(?:add|delete)$/.test(verb)) {
      return `a${group === 'ssh-key' ? 'n' : ''} ${group} mutation (gh ${group} ${verb})`;
    }
    // The verbs and flags below are the alias class: each makes gh run a
    // program the agent chooses, which is a route to every denied write. An
    // extension runs under gh's own name once installed, exec runs one by
    // name, create scaffolds one, and browse is a picker that installs. The
    // group's aliases ext and extensions are gh's own.
    if (/^(?:extension|extensions|ext)$/.test(group)
      && /^(?:install|upgrade|remove|uninstall|exec|create|browse)$/.test(verb)) {
      return `an extension mutation (gh ${group} ${verb})`;
    }
    // gh config set names the browser, pager and editor gh runs.
    if (group === 'config' && verb === 'set') {
      return 'a config mutation (gh config set)';
    }
    // gh browse and the -w or --web flag on any command run the configured
    // browser. gh browse under -n or --no-browser prints the URL instead,
    // its own -w (--wiki) included. The flag rule reads -w on gh run list,
    // where it means --workflow, as the browser flag too, and the long
    // spelling --workflow stays a read.
    if (group === 'browse') {
      if (!noBrowser) return 'a browser launch (gh browse would run the configured browser)';
    } else if (web !== null) {
      return `a browser launch (gh ${[group, verb].filter(Boolean).join(' ')} ${web} would run the configured browser)`;
    }
    if (group === 'api') {
      let method: string | null = null;
      let sendsBody = false;
      for (let i = 0; i < toks.length; i++) {
        const m = /^(?:-X|--method)=?(.*)$/.exec(toks[i]);
        if (m) method = m[1] || toks[i + 1] || null;
        if (/^(?:-f|-F|--field|--raw-field|--input)(?:=|$)/.test(toks[i])) sendsBody = true;
      }
      if (method && !/^get$/i.test(method)) return `a write API call (gh api ${method.toUpperCase()})`;
      if (!method && sendsBody) return 'a write API call (gh api with fields defaults to POST)';
    }
    if (literal.includes(false)) return GH_UNRESOLVED;
  }
  return null;
}

// Targets of the shell writers that create, overwrite, or truncate a file, each
// paired with the position of the writer so the caller can resolve it against the
// directory that write would run in: a >, >>, or >| redirect (which covers
// heredoc-into-file, cat > path <<EOF), tee, and sed's in-place file operands.
// The operators are located in the masked copy, so a quoted > is not one, while
// each target is read from the original text. A descriptor dup (2>&1, >&2) is
// captured as a target and rejected by the path classifier rather than by the
// operator.
function writeTargets(cmd: string, masked: string): { target: string; at: number }[] {
  const out: { target: string; at: number }[] = [];
  const redirect = />>?\|?/g;
  let m: RegExpExecArray | null;
  while ((m = redirect.exec(masked)) !== null) {
    const at = m.index + m[0].length;
    const t = /^\s*(&\d*|"[^"]*"|'[^']*'|[^\s;|&<>]+)/.exec(cmd.slice(at));
    if (t) out.push({ target: t[1], at: m.index });
  }
  for (const hit of commandPositions(masked, ['tee'])) {
    // A descriptor prefix standing against the redirect that cut this
    // segment reads as a tee operand and denies, which is the same false
    // denial mutationTargets prices above and is priced for the same reason.
    const seg = segment(cmd, masked, hit.at);
    for (const t of tokens(seg).filter(a => !a.startsWith('-'))) {
      out.push({ target: t, at: hit.at });
    }
  }
  for (const hit of commandPositions(masked, ['sed'])) {
    // The same false denial the tee loop above prices, for the same reason.
    const seg = segment(cmd, masked, hit.at);
    const toks = tokens(seg);
    if (!toks.some(a => /^-i/.test(a) || a === '--in-place')) continue;
    // With -e or -f the script arrives as that flag's value, so every bare
    // operand is a file; with neither, the first bare operand is the script.
    let scripted = false;
    const files: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (/^-[ef]$/.test(t) || /^--(?:expression|file)$/.test(t)) { scripted = true; i++; continue; }
      if (/^--(?:expression|file)=/.test(t)) { scripted = true; continue; }
      if (t.startsWith('-')) continue;
      files.push(t);
    }
    for (const t of (scripted ? files : files.slice(1))) out.push({ target: t, at: hit.at });
  }
  return out;
}

// Shell commands that destroy or displace what they name (rm deletes, mv removes
// its source, truncate empties), and the ones that only create or adjust (touch
// and chmod leave content in place). The split is the class boundary: a
// gate-runner may create, and neither class may destroy. cp and the copy/new
// cmdlets sit on both sides of it: aimed at a path that does not exist they
// create, aimed at one that does (or forced) they overwrite and destroy its
// content, so the gate-runner is denied only their overwriting form
// (overwriteTargets below) while the strict class is denied both forms.
const DESTRUCTIVE_CMDS = ['rm', 'rmdir', 'mv', 'truncate'];
const CREATING_CMDS = ['cp', 'touch', 'chmod'];

// The PowerShell cmdlets that write or truncate a file's content, the ones that
// destroy or displace a file, and the ones that only create a copy or a new item.
// Each list carries the standard aliases alongside the canonical names, because
// PowerShell is the primary shell on the hosts this ships to and an alias is what
// a PowerShell-native writer reaches for. Set-Content's alias "sc" is
// deliberately absent: it collides with sc.exe, the Windows service controller,
// and that false positive costs more than the alias covers. Matched in command
// position, so an embedded name (Reset-Content) does not hit.
const PS_WRITE = ['Out-File', 'Set-Content', 'Add-Content', 'ac', 'Clear-Content', 'clc', 'Tee-Object'];
const PS_DESTRUCTIVE = ['Remove-Item', 'ri', 'rd', 'del', 'erase', 'Move-Item', 'mi', 'move', 'Rename-Item', 'ren', 'rni'];
const PS_CREATING = ['Copy-Item', 'cpi', 'copy', 'New-Item', 'ni'];

// The cmdlet names whose destination operand is the only one that matters, since
// they leave their source in place.
const PS_COPY_NAMES = /^(?:copy-item|cpi|copy)$/;

// Cmdlet parameters whose value is a following token and is never a path, so that
// value is not mistaken for a repo write (-Encoding utf8). Every other parameter
// is treated as a switch (-Force, -Recurse), which leaves the token after it
// available as a positional path.
const PS_VALUE_PARAMS = /^-(?:Encoding|Value|Delimiter|Filter|Include|Exclude|ItemType|Name|NewName|Width|InputObject|Stream)(?::|$)/i;

// A token shaped like a filesystem path: it carries a separator, an extension, or
// a leading dot. Positional operands past the first are filtered through this, so
// a value left over from an unrecognized parameter does not read as a path
// (Out-File -Encoding utf8 <path outside the repo>).
function looksLikePath(s: string): boolean {
  return /[\\/]/.test(s) || s.startsWith('.') || /\.[A-Za-z0-9]{1,8}$/.test(s);
}

// The operands of one cmdlet invocation: the values of the named path parameters
// (-Path / -FilePath / -LiteralPath / -Destination, joined by a space or a
// colon), and the positional operands in order.
export function cmdletOperands(toks: readonly string[]): { named: Record<string, string>; positional: string[] } {
  const named: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.startsWith('-')) { positional.push(t); continue; }
    const m = /^-(FilePath|Path|LiteralPath|Destination)(?::(.+))?$/i.exec(t);
    let value = m && m[2] ? m[2] : null;
    const takesNextToken = (m && !value) || PS_VALUE_PARAMS.test(t);
    if (takesNextToken && i + 1 < toks.length && !toks[i + 1].startsWith('-')) {
      if (!value) value = toks[i + 1];
      i++;                       // the token is this parameter's value
    }
    if (m && value) named[m[1].toLowerCase()] = value;
  }
  return { named, positional };
}

// The path operands of a cmdlet invocation that could change the tree. The first
// positional operand of an item cmdlet is PowerShell's -Path parameter, so it
// counts as a path whatever it looks like (Remove-Item test); later positionals
// are filtered by shape.
export function cmdletPaths(name: string, named: Record<string, string>, positional: readonly string[]): string[] {
  if (PS_COPY_NAMES.test(name)) {
    const dest = named.destination || positional[1];
    return (dest && looksLikePath(dest)) ? [dest] : [];
  }
  const out = [named.filepath, named.path, named.literalpath, named.destination].filter(Boolean);
  positional.forEach((t, i) => {
    if (i === 0 || looksLikePath(t)) out.push(t);
  });
  return out;
}

// Flags of a shell mutator whose value is a following token and is not a path to
// be judged: truncate's size, and the reference file it reads to get one.
const SHELL_VALUE_FLAGS: Record<string, RegExp> = { truncate: /^(?:-s|--size|-r|--reference)$/ };

// The destination of a cp invocation: the value of -t/--target-directory when it
// carries one, else the last bare operand. Only the destination is written, so
// copying a repo file out into scratch is not a mutation of the tree.
function cpDestination(toks: readonly string[]): string | null {
  for (let i = 0; i < toks.length; i++) {
    const m = /^(?:-t|--target-directory)(?:=(.+))?$/.exec(toks[i]);
    if (!m) continue;
    if (m[1]) return m[1];
    return i + 1 < toks.length ? toks[i + 1] : null;
  }
  const bare = toks.filter(a => !a.startsWith('-'));
  return bare.length ? bare[bare.length - 1] : null;
}

// Every {name, target, at} the named shell commands and cmdlets in a command
// would change. Operand rules: rm, rmdir, mv, truncate, touch, and the write
// cmdlets change each operand they name (mv deletes its source, so its source
// counts); cp and Copy-Item keep only their destination; chmod's first operand is
// its mode, not a path.
function mutationTargets(cmd: string, masked: string, shellNames: readonly string[], cmdletNames: readonly string[]): { name: string; target: string; at: number }[] {
  const out: { name: string; target: string; at: number }[] = [];
  for (const hit of commandPositions(masked, shellNames)) {
    // A redirect cuts this segment, so a file-descriptor prefix standing
    // against the operator (the 2 of rm .kit/x 2>&1) is read as an operand
    // and denies. That false denial is deliberate rather than unnoticed.
    // Stripping the digits empties the operand list wherever they are the
    // only operand, and the words bash hands the command past the redirect
    // target (rm 2>/dev/null README.md removes README.md) sit in a segment
    // this scan cannot see, so the strip trades a visible false denial for
    // a silent allow on the invariant the guard exists to hold. Reading the
    // operands past the redirect is what would close both, and until it
    // does the denial is the fail-closed side and is priced here.
    const seg = segment(cmd, masked, hit.at);
    const toks = tokens(seg);
    const valueFlags = SHELL_VALUE_FLAGS[hit.name] || /^$/;
    let operands: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].startsWith('-')) { if (valueFlags.test(toks[i])) i++; continue; }
      operands.push(toks[i]);
    }
    if (hit.name === 'cp') {
      const dest = cpDestination(toks);
      operands = dest === null ? [] : [dest];
    }
    if (hit.name === 'chmod') operands = operands.slice(1);
    for (const target of operands) out.push({ name: hit.name, target, at: hit.at });
  }
  for (const hit of commandPositions(masked, cmdletNames)) {
    const { named, positional } = cmdletOperands(tokens(segment(cmd, masked, hit.at)));
    for (const target of cmdletPaths(hit.name, named, positional)) {
      out.push({ name: hit.name, target, at: hit.at });
    }
  }
  return out;
}

// Every {name, target, at, force} the creating commands would write, for the
// caller's overwrite check: cp overwrites an existing destination by default
// (unless -n/--no-clobber promises not to), and Copy-Item or New-Item under
// -Force overwrites or truncates whatever sits at the target. `force` carries
// the flag so a forced invocation is judged destructive without a stat.
function overwriteTargets(cmd: string, masked: string): { name: string; target: string; at: number; force: boolean }[] {
  const out: { name: string; target: string; at: number; force: boolean }[] = [];
  for (const hit of commandPositions(masked, ['cp'])) {
    const toks = tokens(segment(cmd, masked, hit.at));
    if (toks.some(a => a === '-n' || a === '--no-clobber')) continue;
    const dest = cpDestination(toks);
    if (dest !== null) out.push({ name: 'cp', target: dest, at: hit.at, force: false });
  }
  for (const hit of commandPositions(masked, PS_CREATING)) {
    const toks = tokens(segment(cmd, masked, hit.at));
    const force = toks.some(a => /^-Force$/i.test(a));
    const { named, positional } = cmdletOperands(toks);
    for (const target of cmdletPaths(hit.name, named, positional)) {
      out.push({ name: hit.name, target, at: hit.at, force });
    }
  }
  return out;
}

// Commands a bulk idiom drives whose operands are filenames from somewhere else,
// so no path in the command text can be classified.
const BULK_MUTATORS = /^(?:rm|rmdir|mv|truncate|chmod|remove-item|ri|rd|del|erase|move-item|mi|rename-item|ren|rni|clear-content|clc)$/;

// The cmdlets that enumerate filesystem items into a pipeline. A destructive
// cmdlet fed by one of these is judged as a bulk mutation even when it carries
// an operand the guard cannot resolve (Remove-Item $_ inside a ForEach-Object
// body): the enumeration is what names the items, and the operand is only how
// each one is spelled per item.
const PS_ENUMERATING = ['Get-ChildItem', 'gci', 'dir', 'ls', 'Get-Item', 'Get-Content'];

// A description of a bulk delete or rewrite, or null. git ls-files | xargs rm and
// Get-ChildItem -Recurse | Remove-Item each remove the whole tracked worktree
// while naming no path at all, which is why the idiom is judged rather than its
// operands. Both classes are denied it with no carve-out, and the cost is a
// real false denial rather than an oversight: the gate class may clear its
// build-output directories, and the piped PowerShell spelling of that cleanup
// (Get-ChildItem obj -Recurse | Remove-Item) is refused here while the direct
// spelling is not. A carve-out keyed on the upstream was tried and withdrawn
// after it twice admitted a delete it did not bound, once because the upstream
// named what it read rather than what it emitted and once because an
// intermediate pipeline stage replaced the items downstream of the check. What
// bounds a pipe is not readable from the stage that opens it, so the idiom is
// denied whole and the false denial is the priced cost. `cwd` may be null (a
// payload with no cwd); it grounds the resolvability probe below.
function bulkMutation(cmd: string, masked: string, cwd: string | null, host: LexHost): string | null {
  for (const hit of commandPositions(masked, ['find'])) {
    const toks = tokens(segment(cmd, masked, hit.at));
    if (toks.includes('-delete')) return 'a bulk delete (find -delete)';
    for (let i = 0; i < toks.length; i++) {
      if (toks[i] !== '-exec' && toks[i] !== '-execdir') continue;
      const verb = (toks[i + 1] || '').toLowerCase();
      // The verb decides the mutation, so a substitution spliced into it
      // (find . -exec $(true)rm {} ;) is as unresolvable as a spliced flag.
      if (spliced(verb)) {
        return `a find ${toks[i]} verb the guard cannot resolve (a substitution is spliced into it)`;
      }
      if (BULK_MUTATORS.test(verb) || verb === 'sed') return `a bulk mutation (find ${toks[i]} ${verb})`;
    }
  }
  for (const hit of commandPositions(masked, ['xargs'])) {
    const toks = tokens(segment(cmd, masked, hit.at));
    const bare: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.startsWith('-')) { if (/^-(?:n|I|P|L|d|E|s|a)$/.test(t)) i++; continue; }
      bare.push(t);
    }
    const verb = (bare[0] || '').toLowerCase();
    if (BULK_MUTATORS.test(verb)) return `a piped mutation (xargs ${verb})`;
    if (verb === 'sed' && toks.some(a => /^-i/.test(a) || a === '--in-place')) return 'a piped mutation (xargs sed -i)';
    if (verb === 'git' && GIT_MUTATIONS.has((bare[1] || '').toLowerCase())) return `a piped mutation (xargs git ${bare[1]})`;
  }
  // A destructive cmdlet downstream of a pipe with no path operand takes its
  // items from the pipeline (Get-ChildItem plugins -Recurse | Remove-Item).
  // One whose every path operand fails resolution is the same idiom when the
  // pipeline's upstream is an enumerating cmdlet: in Get-ChildItem |
  // ForEach-Object { Remove-Item $_ } the pipeline variable is an operand no
  // rule can place, and the enumeration upstream is what names the items. The
  // upstream test is what keeps a standalone Remove-Item $x, whose operand is
  // just as unresolvable but whose items come from no enumeration, an
  // operand-ambiguity allow rather than a bulk deny; a statement separator
  // between the two bounds the stage walk, so an enumeration in an earlier
  // statement is not this pipeline's upstream.
  for (const hit of commandPositions(masked, PS_DESTRUCTIVE)) {
    if (masked.lastIndexOf('|', hit.at) < 0) continue;
    const upstream = commandPositions(masked, PS_ENUMERATING).filter(e => {
      if (e.at >= hit.at) return false;
      const between = masked.slice(e.at, hit.at);
      return between.includes('|') && !/[;&\n]/.test(between);
    });
    const { named, positional } = cmdletOperands(tokens(segment(cmd, masked, hit.at)));
    const paths = cmdletPaths(hit.name, named, positional);
    if (paths.length === 0) return `a piped mutation (${hit.name} from a pipeline)`;
    if (upstream.length && paths.every(p => resolveTarget(p, cwd || '.', host) === null)) {
      return `a piped mutation (${hit.name} fed by an enumerating cmdlet)`;
    }
  }
  return null;
}

// Package-manager global flags that take their value as a separate following
// token, so the verb after them is still read correctly (npm --prefix . install).
const PKG_VALUE_FLAGS = /^(?:--prefix|-C|--workspace|-w|--registry|--filter|--dir)$/;

// The verb of a command invocation: its first bare operand, skipping flags and
// the values of the flags `valueFlags` names.
function firstVerb(cmd: string, masked: string, at: number, valueFlags: RegExp): string {
  const toks = tokens(segment(cmd, masked, at));
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].startsWith('-')) { if (valueFlags.test(toks[i])) i++; continue; }
    if (SUB_TOKEN.test(toks[i])) continue;
    return toks[i].toLowerCase();
  }
  return '';
}

// A description of a package-manager mutation, or null. Installing and updating
// rewrite a tracked lockfile, so both classes are denied them under every verb
// alias npm accepts (npm i, npm up); yarn 1 and pnpm install when run with no
// verb at all, so a bare invocation counts too unless it only asks for the
// version or help. npm ci installs from the lockfile without rewriting it,
// which makes it the gate-runner's legitimate way to prepare a suite run.
// Running the gate is untouched either way: npm test and npm run build pass.
function packageMutation(cmd: string, masked: string, strict: boolean): string | null {
  for (const hit of commandPositions(masked, ['npm', 'pnpm', 'yarn'])) {
    const verb = firstVerb(cmd, masked, hit.at, PKG_VALUE_FLAGS);
    // A substitution spliced into the verb (npm $(true)install) is unresolvable,
    // so it denies rather than matching no install alias and falling through.
    // This reader tests the position itself, knowing which token it is about to
    // read; the same evasion in any other name position of any governed
    // invocation is refused by `unresolvableSplice`, which is the chokepoint for
    // the class rather than a check each reader carries.
    if (spliced(verb)) return `a package-manager subcommand the guard cannot resolve (a substitution is spliced into ${hit.name})`;
    if (/^(?:i|in|ins|inst|install|add|up|upgrade|update)$/.test(verb)) {
      return `a package-manager mutation (${hit.name} ${verb})`;
    }
    if (verb === 'ci' && strict) return `a package-manager mutation (${hit.name} ci)`;
    if (!verb && /^(?:pnpm|yarn)$/.test(hit.name)) {
      const toks = tokens(segment(cmd, masked, hit.at));
      if (!toks.some(a => /^(?:--version|-v|--help|-h)$/i.test(a))) {
        return `a package-manager mutation (a bare ${hit.name} installs)`;
      }
    }
  }
  // The .NET equivalents: add and remove rewrite a tracked project file, and new
  // scaffolds files into the tree. dotnet build, test, restore, and run pass.
  for (const hit of commandPositions(masked, ['dotnet'])) {
    const verb = firstVerb(cmd, masked, hit.at, /^$/);
    if (spliced(verb)) return 'a dotnet subcommand the guard cannot resolve (a substitution is spliced into it)';
    if (/^(?:add|remove|new)$/.test(verb)) return `a package-manager mutation (dotnet ${verb})`;
  }
  return null;
}

// A description of a formatter run, or null. A formatter rewrites every tracked
// source file it touches and is no part of running a gate, so both classes are
// denied it: dotnet format in its writing form, prettier with -w/--write, and a
// package script that formats (run format, run fmt, a script named *:fix, or a
// run carrying --fix). Check-only invocations write nothing and are legitimate
// gate steps, so they pass: dotnet build, dotnet test, dotnet format with
// --verify-no-changes or --check, prettier --check, and npm run lint.
function formatterRun(cmd: string, masked: string): string | null {
  for (const hit of commandPositions(masked, ['dotnet'])) {
    if (firstVerb(cmd, masked, hit.at, /^$/) !== 'format') continue;
    const toks = tokens(segment(cmd, masked, hit.at));
    if (toks.includes('--verify-no-changes') || toks.includes('--check')) continue;
    return 'a formatter run (dotnet format)';
  }
  if (commandPositions(masked, ['dotnet-format']).length) return 'a formatter run (dotnet-format)';
  for (const hit of commandPositions(masked, ['prettier'])) {
    if (tokens(segment(cmd, masked, hit.at)).some(a => a === '-w' || a === '--write')) return 'a formatter run (prettier --write)';
  }
  for (const hit of commandPositions(masked, ['npm', 'pnpm', 'yarn'])) {
    const toks = tokens(segment(cmd, masked, hit.at));
    let i = 0;
    while (i < toks.length && (toks[i].startsWith('-') || SUB_TOKEN.test(toks[i]))) {
      i += PKG_VALUE_FLAGS.test(toks[i]) ? 2 : 1;
    }
    if ((toks[i] || '').toLowerCase() !== 'run') continue;
    const script = (toks[i + 1] || '').toLowerCase();
    if (script === 'format' || script === 'fmt' || script.endsWith(':fix') || toks.includes('--fix')) {
      return `a formatter run (${hit.name} run ${script})`;
    }
  }
  return null;
}

// A base64 -EncodedCommand payload hides what it runs, and a governed agent has
// no legitimate use for one, so the flag itself is the verdict for both classes.
// Decoding it would add a parser for no gain. The check is scoped to a PowerShell
// invocation because the abbreviations collide: -ec is also how bash bundles
// -e -c, and `bash -ec 'git diff | head'` is an ordinary read.
function encodedCommand(cmd: string, masked: string): string | null {
  for (const hit of commandPositions(masked, ['pwsh', 'powershell'])) {
    const toks = tokens(segment(cmd, masked, hit.at));
    if (toks.some(a => /^-{1,2}(?:ec|enc|encodedcommand)$/i.test(a))) {
      return 'an encoded command (-EncodedCommand)';
    }
  }
  return null;
}

// Nested executors: a shell or agent that runs command text handed to it as an
// argument. Their flags carry the payload (-c, -lc, -Command, cmd's /c or /k,
// eval's and iex's operands, claude's -p) and so does a here-string
// (bash <<< "..."). cmd and iex matter on a PowerShell-primary host: quoting the
// payload (cmd /c "git commit -m x") is the natural spelling, and without the
// recursion it would mask the verb out of command position entirely.
const NESTED_EXECUTORS = ['sh', 'bash', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd', 'eval', 'iex', 'invoke-expression', 'claude'];
const NESTED_FLAGS = /^-{1,2}(?:[a-z]*c|command|cmd|p|print)$/i;

// The command text a nested executor would run. The caller analyzes each payload
// recursively, so a quoted mutation is judged on what it does, and delegating one
// to another agent (claude -p "git commit") is judged the same way.
//
// Each payload is reconstructed the way its own executor assembles it, because
// the executors differ and the analysis must see the text the executor receives
// rather than the argument list the guard finds convenient. eval and iex join
// every operand with a space and run the result, so `eval "git" "push"` runs
// git push and the operands are scanned joined, not one by one. cmd hands the
// whole tail after /c to its parser the same way. A -c, -Command or -p flag takes
// exactly one word, and adjacent quoting makes one word out of several runs
// (`sh -c "git"" push"`), which the tokenizer already joins.
export function nestedPayloads(cmd: string, masked: string): string[] {
  const out: string[] = [];
  for (const hit of commandPositions(masked, NESTED_EXECUTORS)) {
    // A here-string operand is one word of the segment that follows the <<<,
    // read from that point so the operator itself does not cut it short.
    const hs = /^\s*<<</.exec(masked.slice(hit.at));
    if (hs) {
      const word = tokens(segment(cmd, masked, hit.at + hs[0].length))[0];
      if (word) out.push(word);
    }
    const toks = tokens(segment(cmd, masked, hit.at));
    if (hit.name === 'eval' || hit.name === 'iex' || hit.name === 'invoke-expression') {
      const operands = toks.filter(a => !a.startsWith('-'));
      if (operands.length) out.push(operands.join(' '));
      continue;
    }
    if (hit.name === 'cmd') {
      // The payload is everything after /c or /k; //c is the Git-Bash spelling
      // that keeps MSYS path mangling off the switch, and it reaches cmd as /c.
      for (let i = 0; i < toks.length; i++) {
        if (!/^\/{1,2}[ck]$/i.test(toks[i])) continue;
        const tail = toks.slice(i + 1);
        if (tail.length) out.push(tail.join(' '));
      }
      continue;
    }
    for (let i = 0; i < toks.length; i++) {
      if (!NESTED_FLAGS.test(toks[i])) continue;
      const payload = toks[i + 1];
      if (payload && !payload.startsWith('-')) out.push(payload);
    }
  }
  return out;
}

// Every command name a heuristic in this file scans for, assembled from the lists
// those heuristics use so a name cannot be governed by one and unknown to the
// splice check below. The literals are the names the heuristics spell inline.
const GOVERNED_NAMES = ['git', 'gh', 'npm', 'pnpm', 'yarn', 'dotnet', 'dotnet-format',
  'prettier', 'find', 'xargs', 'sed', 'tee']
  .concat(DESTRUCTIVE_CMDS, CREATING_CMDS, PS_WRITE, PS_DESTRUCTIVE, PS_CREATING, NESTED_EXECUTORS);

// The governed names whose leading bare operands are a subcommand, a verb, or a
// script name the guard compares against a list, rather than a path it resolves.
// git is here for its first operand only: its second is a ref or a pathspec
// (git log <ref>..HEAD), which target resolution handles and no name comparison
// reads, so requiring that one to resolve would refuse ordinary review work.
const VERB_READERS = /^(?:gh|npm|pnpm|yarn|dotnet|xargs|git)$/;

// A governed invocation carrying a substitution spliced into a token the guard
// reads as a name, or null. The shell concatenates such a token into one word
// whose value is whatever the substitution prints (`$(true)rm -$(true)i` reaches
// the executor as `rm -i`), so the token answers to no name the guard knows and
// every equality test against it fails: without this check the reader matches
// nothing and falls through to allow, which is the direction the fail-closed rule
// refuses. It is the chokepoint for that whole class rather than a test each
// reader remembers to make, so a heuristic added later inherits it.
//
// A name position is one of two things, and everything else in an invocation is an
// operand the path and target rules already judge. A token in flag position, since
// every reader here tests its flags by literal name and an unresolvable flag
// silently changes which token the reader takes as the subcommand
// (`git -$(true)C . push` stops consuming a value and reads `.`). And the leading
// bare operands of a verb reader, which are its subcommand, group, verb, or script
// name. A reader that goes deeper into its own grammar (git's worktree, submodule
// and bisect subverbs, gh's verb, find's -exec verb) tests that position itself,
// where it knows which token it is about to read.
function unresolvableSplice(cmd: string, masked: string): string | null {
  for (const hit of commandPositions(masked, GOVERNED_NAMES)) {
    let bare = 0;
    for (const tok of tokens(segment(cmd, masked, hit.at))) {
      const flag = tok.startsWith('-') || /^\/{1,2}[a-z]$/i.test(tok);
      const leading = bare < (hit.name === 'git' ? 1 : 2);
      if (!flag) bare++;
      if ((flag || (VERB_READERS.test(hit.name) && leading)) && spliced(tok)) {
        return `an invocation of ${hit.name} the guard cannot resolve `
          + '(a substitution is spliced into a token it reads as a name)';
      }
    }
  }
  return null;
}

// The reason this command changes the state under review, or null when it is a
// read the class may run. Path-dependent heuristics are skipped when the payload
// carries no cwd, since a target cannot be placed without one; the
// path-independent ones still apply.
//
// Known misses, accepted under the fail-open posture and backstopped by the
// tree-state check executing-work runs around a review round: a writer the
// heuristics do not name (dd of=, install -m, ln -sf, a python or node one-liner,
// an editor), a command name assembled from a variable or split inside the name
// itself by quoting or a substitution ("git" commit, g'i't commit, git${IFS}commit,
// g$(true)it commit), which is the split-name shape and stays a miss, distinct from
// a substitution glued to a whole name (git$(true) push), which the command-position
// scan reads as command position and denies, an ANSI-C quoted word ($'...'), whose
// backslash escapes maskQuoted does not recognize, so an escaped quote inside one
// (echo $'a\'b' ; git push) reads as closing the span and desyncs quote parity,
// masking the live command after the separator to end-of-string and allowing it;
// the cost is a mutation that follows an ANSI-C quoted word on the same line, and
// the shape is adversarial rather than something a cooperative agent emits, so it
// is left to the tree-state bracket rather than closed by touching the quote
// scanner, whose edits have outsized blast radius, an in-tree path spelled as an
// 8.3 short name (ACCOUN~1) or a UNC share (\\localhost\d\...), both of which
// need filesystem round-trips to normalize for a shape that takes deliberate
// evasion to produce, a path operand built through a variable outside the
// resolvable subset ($PWD, ${PWD}, %CD%, and a home-relative path resolve;
// rm $FOO/x does not place), which stays an allow deliberately, priced against
// the false denials a guessed expansion would buy and backstopped by the same
// tree-state bracket, a bulk idiom other than find, xargs, and the two
// PowerShell pipeline shapes the scan names (a destructive cmdlet piped its
// items with no path operand, and one whose operands all fail resolution fed by
// an enumerating cmdlet), so a ForEach-Object body fed by anything outside the
// enumerating list, or a foreach loop, stays a miss, an xargs whose governed
// subcommand arrives on the pipe rather than as a literal token
// (echo push origin main | xargs git runs git push while the scan compares
// only a literal subcommand), an operand standing past a redirect in the same
// simple command (rm >/dev/null README.md hands rm the operand while the
// segmenter's cut at the redirect drops it; the spelling that carries a
// descriptor prefix denies instead, on the prefix itself read as an operand,
// so the bare redirect is the example rather than that one; a miss accepted
// rather than fixed at the segmenter's cut set, whose edits have outsized
// blast radius), and a git
// subcommand that writes files as a side effect of a read (git format-patch,
// git archive), which leaves a tracked-file delta the backstop does see, a
// redirect standing inside a heredoc body (a `>`, `>>`, or `>|` inside a `<<`
// or `<<-` body): maskHeredocRedirects blanks it, which reads an authored
// script's comparison or arrow correctly and also hides a real write when a
// downstream executor runs the body (cat <<'EOF' ... echo pwned > README.md
// ... EOF piped to sh performs the write while the blanked redirect reads as
// data; the governed verbs in such a body still deny, so the residual is the
// body whose only mutation is its redirects), a write whose file delta the
// backstop does see, and a
// literal heredoc body a data sink writes away from the tree that a later,
// separately scanned command then runs. That last one is what the data-sink
// exemption adds. Stated by shape: a body written to a path the class may write
// (.kit/ for the strict class, and the build-output directory list for the gate
// class) or to any path outside the tree under review, and executed by a later
// command that reads it as script (bash <path>, sh <path>, . <path>,
// source <path>, an interpreter with a file operand such as node <path> or
// python <path>, or $(cat <path>) in command position) is
// a repo-state mutation the tree-state check cannot see once that command runs,
// rather than the file delta the check does see. The out-of-tree destination
// widens this residual from the writable set to any path, and it opens nothing
// the `printf '<mutation>' > /tmp/x.sh` spelling did not already leave open. It
// is the heredoc spelling of the miss `printf '<mutation>' > .kit/x.sh` already
// makes, and it is left open because no spelling of it is caught rather than
// because one is: `bash <path>`, `sh <path>`, `. <path>`, `source <path>` and an
// interpreter with a file operand all allow, the whole-shape recognizer having
// replaced the executor screen a shell name would once have been read by. One
// further miss is unreachable rather than exploitable and is recorded as such:
// an unterminated command substitution loses its last character at each
// collection level (`subs` records its interior as ending one character before
// a close that is not there), so the innermost verb of `echo $(( $(git push`
// scans truncated and would allow, but bash refuses the same string with an EOF
// error before running anything, so no shell ever executes what the truncation
// hides. In the
// other direction the residual false hit is a governed verb in genuine command
// position whose effect is not what it looks like (a mutating verb inside a
// heredoc body outside the exemption's shape, a bare `cat <<'EOF'` writing to no
// nameable path among them, since a body whose output the guard cannot follow to
// a resting place may be a command wherever it sits), and a governed invocation
// carrying a substitution spliced into a token the guard reads as a name, which
// denies on the unresolvable token whatever that substitution would have printed.
// Two further false hits are the fail-closed posture's stated price: a command
// substitution nested three deep in ordinary text
// (echo $(basename $(dirname $(pwd)))) denies at the depth bound, and a heredoc
// report body carrying an ANSI escape captured from tool output denies as a
// control character.
// Analysis is
// regex-per-heuristic over the whole string, so cost grows with the square of
// command length (a 80 KB command takes seconds); the agent authoring that string
// is the only party it delays.
//
// What one decide call holds fixed across every reading at every depth: the
// cwd, the agent class, the lexer's host and the quote fold; the memo of
// nested verdicts; the data-sink exemption span, decided once over the
// top-level text, since every top-level reading is handed that same text; and
// the git root above the cwd, walked once at the first reading that asks for
// it.
type Call = {
  cwd: string | null;
  strict: boolean;
  host: LexHost;
  quote: (text: string) => string;
  memo: VerdictMemo;
  exempt: Span | null;
  root: (cwd: string) => Promise<string>;
};

// `join` and `boundary` are the splice's reading of this text alone, as
// `spliceContinuations` takes them. `exact` selects the reading of comments
// and heredoc bodies, legacy or exact, and is the one the guard's decide
// chose for this pass, carried unchanged to every depth. A nested payload or
// substitution interior is read under `readUnderContinuations` on its own
// text, so its continuations are enumerated where they exist, a pair that
// forms only once `tokens` strips the quotes around it among them, and its
// composed verdict is held in the call's memo, keyed on the text, its depth
// and `exact`.
async function denyReason(cmd: string, depth: number, join: boolean, boundary: number, exact: boolean, call: Call): Promise<string | null> {
  const { cwd, strict, host, quote } = call;
  // A CRLF pair is a line break the way a bare newline is, so the guard's decide
  // normalizes each to one before anything reads the command: a Windows-authored
  // report or a multi-line command carries \r\n between its lines, and the two
  // rules that bound a heredoc body's terminator (heredocBodies and
  // heredocExemption) would otherwise disagree about a delimiter line's trailing
  // \r and mask a live command past the terminator the shell reads. The text
  // arrives here normalized once, at every depth, and is normalized no further.

  // A raw control character other than tab or newline has no legitimate place in a
  // governed command, and the guard's own masking sentinels (NUL and \x01) are
  // themselves control characters, so an input carrying one could forge a sentinel
  // and reshape an operand list where the shell reads no boundary at all
  // (rm <0x01> README.md). A bare carriage return joins them: after the CRLF
  // normalization every remaining \r sits mid-line, where bash reads an
  // ordinary word character, so admitting it would only invite the same
  // sentinel-shaped confusion (rm <CR> README.md) and reopen the heredoc
  // terminator desync the normalization closes. Refused at the boundary rather
  // than masked over, which keeps the sentinels unspellable from the input.
  if (depth === 0 && /[\x00-\x08\x0b-\x1f]/.test(cmd)) {
    return 'a control character in the command';
  }

  // A heredoc fault the walk returns, any `DelimiterFault` kind, refuses here,
  // at every depth, before any body range, exemption or mask is built on the
  // command, since bash and the guard would end or start its body at different
  // lines and the commands between would be read as data or blanked by a stray
  // quote.
  // No carriage-return fault reaches here: the check above refuses every bare \r.
  //
  // The legacy reading finds bodies on a body-blind quote mask through
  // `heredocBodies`, so the second mask can treat a body's own quotes as the
  // literal data they are. The exact reading finds them through `heredocWalk`,
  // which builds its own forward mask and reads no mask handed to it, so it is
  // handed none; it also returns the live ranges, and reads a word-start `#`
  // as a comment and an unquoted body as a live range whose quotes are bytes.
  // Either reading collects the interiors of command substitutions found inside
  // double-quoted spans (`subs`), which are live command text scanned on their
  // own below rather than inline, so their delimiters never reshape an operand
  // list.
  const subs: Span[] = [];
  let bodies: Span[];
  let live: readonly Span[] = [];
  if (exact) {
    const walk = heredocWalk(cmd, '', true);
    if (walk.fault !== null) return delimiterFault(walk.fault, quote);
    bodies = walk.data;
    live = walk.live;
  } else {
    const bare = maskQuoted(cmd);
    const delimiter = offendingDelimiter(cmd, bare);
    if (delimiter !== null) return delimiterFault(delimiter, quote);
    bodies = heredocBodies(cmd, bare);
  }

  // The data-sink exemption is decided over the whole command string, before and
  // independently of the quote mask, and holds only at the top level with a cwd
  // to resolve its destination against. Below the top level the text under
  // analysis is a payload some executor was handed, and what consumes that
  // executor's own stdout sits in the command around it, out of this string:
  // `sh -c "cat <<'EOF' ... EOF" | sh` runs the body while the payload alone
  // reads as a sink copying stdin. The guard's decide decides it over the
  // top-level text before any reading, ahead of the line splice below, so its
  // intro line is the physical one the recognizer refuses a continuation on. A
  // qualifying body is masked whole, the way a quoted span is, so every
  // heuristic reading the masked copy passes over it.
  const exemptBody = depth === 0 ? call.exempt : null;

  // Line continuations are spliced out before the masks are built, so no
  // heuristic reads a boundary the shell does not. The splice is handed the
  // data bodies alone and this reading's quote mask of the text as it stands:
  // a quoted-delimiter body is literal data where bash splices nothing, while
  // an unquoted body is live text whose backslash-newlines bash removes as it
  // reads the body, so those are spliced as any command text is, and a pair
  // inside a single-quoted span stays as typed. The joined readings shorten
  // the command, so the data spans come back shifted and the live spans and
  // the exemption span found above are read through the splice's map onto its
  // text. Under the two-space reading the map is the identity.
  const joined = spliceContinuations(cmd, bodies, exact ? maskExact(cmd, bodies, live) : maskQuoted(cmd, bodies), join, boundary);
  cmd = joined.cmd;
  const data = joined.bodies;
  const liveJoined = live.map(s => ({ from: joined.at(s.from), to: joined.at(s.to) }));

  // The exact reading masks comments and takes the live ranges as command text
  // with their quotes read as bytes; only the data ranges reach the body
  // redirect blanking, so a live body keeps its redirects visible.
  let masked = exact
    ? maskHeredocRedirects(maskExact(cmd, data, liveJoined, subs), data)
    : maskHeredocRedirects(maskQuoted(cmd, data, subs), data);
  if (exemptBody) {
    const chars = masked.split('');
    for (let i = joined.at(exemptBody.from); i < joined.at(exemptBody.to); i++) chars[i] = '\x00';
    masked = chars.join('');
  }

  const stateChange = gitMutation(cmd, masked)
    || ghMutation(cmd, masked)
    || formatterRun(cmd, masked)
    || bulkMutation(cmd, masked, cwd, host)
    || encodedCommand(cmd, masked)
    || packageMutation(cmd, masked, strict);
  if (stateChange) return stateChange;

  if (cwd) {
    const root = await call.root(cwd);
    // A gate-runner's build output directories are not the tree under review,
    // so neither writing nor destroying content there is a mutation of
    // reviewed state. The strict class writes only .kit/.
    const writable = strict ? KIT_ONLY : GATE_OUTPUT_DIRS;
    for (const w of writeTargets(cmd, masked)) {
      for (const base of await effectiveDirs(cmd, masked, w.at, cwd, host)) {
        if (inTreeTarget(w.target, base, root, writable, host)) {
          return `a write into the tree under review (${describeTarget(w.target)})`;
        }
      }
    }
    // Destroying content is denied to both classes. Creating a file is a
    // gate-runner's normal operation, visible in git status and caught by the
    // tree-state backstop, so the creating commands are the strict class's
    // alone, except in their overwriting form, which destroys content and is
    // denied to the gate-runner below.
    const groups = [{ shell: DESTRUCTIVE_CMDS, cmdlets: PS_WRITE.concat(PS_DESTRUCTIVE), writable }];
    if (strict) groups.push({ shell: CREATING_CMDS, cmdlets: PS_CREATING, writable: KIT_ONLY });
    for (const g of groups) {
      for (const hit of mutationTargets(cmd, masked, g.shell, g.cmdlets)) {
        for (const base of await effectiveDirs(cmd, masked, hit.at, cwd, host)) {
          if (inTreeTarget(hit.target, base, root, g.writable, host)) {
            return `a path mutation in the tree under review (${hit.name} ${describeTarget(hit.target)})`;
          }
        }
      }
    }
    if (!strict) {
      for (const hit of overwriteTargets(cmd, masked)) {
        for (const base of await effectiveDirs(cmd, masked, hit.at, cwd, host)) {
          if (inTreeTarget(hit.target, base, root, writable, host)
            && (hit.force || await targetExists(hit.target, base, host))) {
            return `a path mutation in the tree under review (${hit.name} ${describeTarget(hit.target)})`;
          }
        }
      }
    }
  }

  // Last among the direct heuristics, so a command the guard does resolve denies
  // on what it resolves to and this reason is reserved for the one it cannot.
  const unresolvable = unresolvableSplice(cmd, masked);
  if (unresolvable) return unresolvable;

  // Every construct whose interior is live command text the guard scans one
  // level deeper: a command substitution's interior (scanned unadorned, since a
  // governed verb in a nested quoted phrase there is read the way the shell
  // reads it, so the quoted spelling denies with the same text the unquoted one
  // does) and a nested executor's payload (adorned "inside a nested shell").
  // Both branches below consult this one list, so the fail-closed property does
  // not depend on two call sites kept in step: a third recursion source added
  // here is expanded within the bound and denied at it in the same place, rather
  // than recursed at one site and silently dropped at the other.
  const recursionSources = [
    ...subs.map(s => ({ text: cmd.slice(s.from, s.to), adorn: (r: string) => r })),
    ...nestedPayloads(cmd, masked).map(text => ({ text, adorn: (r: string) => `${r}, inside a nested shell` })),
  ];
  if (depth < 2) {
    for (const src of recursionSources) {
      const nested = await memoized(call.memo, `${depth + 1}:${exact ? 'exact' : 'legacy'}`, src.text, () => readUnderContinuations(
        src.text,
        exact,
        (text, j, b) => denyReason(text, depth + 1, j, b, exact, call),
        reason => reason !== null,
        () => CONTINUATION_CAP_REASON,
      ));
      if (nested) return src.adorn(nested);
    }
  } else if (recursionSources.length) {
    // Past the recursion depth, the property is uniform: ANY construct left
    // unexpanded, a command substitution's interior or a nested executor's
    // payload alike, is live command text the guard has declined to scan,
    // which under the fail-closed rule is unresolved rather than absent.
    // The exhaustion test reads exactly the sources the in-bound branch above
    // drains, so a construct that recursion would expand is the same one whose
    // survival here denies, and either can carry a git or gh verb whose
    // mutation moves no tracked file, leaving the tree-state backstop's two
    // `git status --porcelain` readings identical and so nothing to detect.
    // echo $(echo $(echo $(git push))) buries the verb past the bound one way;
    // $($(eval "git push")) buries it the other, a substitution wrapper
    // consuming a depth increment before the executor's payload is reached.
    return 'an unresolved command substitution or executor payload (nested past the depth the guard scans)';
  }
  return null;
}

// The fixed words of the hook's refusal after the agent type, which the
// shadow reading looks for in the command hook's error text.
export const READONLY_COMMAND_PHRASE = "subagent may not change the state under review, and this command is";

// The hook's stderr line for a refusal of agent type `t`, byte for byte.
function refusalOf(t: string, reason: string): string {
  return (
    `Blocked: the ${t} subagent may not change the state under review, and this command is ` +
    `${reason}. The tree must stay exactly as the orchestrator left it: an edit here invalidates ` +
    `your own findings and every other in-flight agent's reading of the same state. Findings and ` +
    `recommended changes go in your final message, scratch and evidence files go to .kit/ ` +
    `(gitignored, and writable), and a probe that must mutate the tree is the orchestrator's to ` +
    `run - name it in your findings instead of running it. Reads are unaffected: git diff, ` +
    `git log, git grep, rg, and running the build or the suite all work.\n`
  );
}

// What the guard reaches through hooks/index.ts: the lexer's host for one
// call, its home directory read once, and the fold and bracket guard a quoted
// command word takes on its way to the model, which a refused heredoc
// delimiter word passes through.
export type ReadonlyAgentDeps = { lexHost(): Promise<LexHost>; quote(text: string): string };

/**
 * Denies a strict seat's or the QA verifier's Bash or PowerShell command that
 * changes the state under review, with the hook's refusal as the reason. A
 * call from the main loop matches nothing, since the hook allowed every call
 * that carried no agent type and the main loop's calls carry none; a
 * subagent's call of a type no class governs, or with no command, allows.
 * The cwd is the session's, trimmed, as the hook trimmed the payload's.
 */
export function readonlyAgentGuard(deps: ReadonlyAgentDeps): BeforeGuard {
  return {
    name: "readonly-agent",
    commandPhrase: READONLY_COMMAND_PHRASE,
    matches: (e: GuardCall) => (e.tool === "Bash" || e.tool === "PowerShell") && typeof e.agentId === "string" && e.agentId !== "",
    decide: async (e: GuardCall, ctx: GuardContext) => {
      const t = typeof ctx.agentType === "string" ? ctx.agentType.trim() : "";
      if (!t) return {};
      const cls = reviewAgentClass(t);
      if (cls === null) return {};
      const cmd = e.command;
      if (typeof cmd !== "string" || !cmd.trim()) return {};
      const cwd = typeof ctx.cwd === "string" && ctx.cwd.trim() ? ctx.cwd.trim() : null;
      const host = await deps.lexHost();
      const strict = cls === "strict";
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
      const unix = cmd.replace(/\r\n/g, '\n');
      let root: Promise<string> | null = null;
      const call: Call = {
        cwd, strict, host, quote: deps.quote, memo: new Map(),
        exempt: cwd ? await heredocExemption(unix, cwd, strict, host) : null,
        root: dir => (root ??= repoRoot(dir, host)),
      };
      const under = (exact: boolean) => readUnderContinuations(
        unix,
        exact,
        (text, join, boundary) => denyReason(text, 0, join, boundary, exact, call),
        r => r !== null,
        () => CONTINUATION_CAP_REASON,
      );
      let reason = await under(false);
      if (reason === null && exactReadingDiffers(unix)) reason = await under(true);
      return reason === null ? {} : { deny: refusalOf(t, reason) };
    },
  };
}
