// readonly-agent.ts: the before-tool guard that keeps the state under review
// out of a reviewer's reach. It is the kit's readonly-agent-guard.js ported
// whole, the lexer, its depth bound and its explicit deny on unresolvable
// text included, so a Bash or PowerShell call reads the same verdict here as
// through the command hook.
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
// Nothing here reads `$` (runner.ts says why). The filesystem reads the hook
// made synchronously (the .git walk, the cd target's directory test and the
// overwrite rule's existence test) are made through LexHost, which
// hooks/index.ts builds over `$`, so the functions that reach them are async.
// The path arithmetic the hook took from Node's `path` is the PathOps below,
// Node's win32 and posix algorithms over strings, so a path resolves here as
// it resolved in the hook on the same host.

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

function maskQuoted(cmd: string, bodies?: readonly Span[], subs?: Span[]): string {
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
// a whole word, so the desyncing spellings bash reads differently (<<'EOF'X,
// <<'E'OF) match nothing. And the body starts after the introducing line, walking
// a backslash continuation forward first, so a redirect on that line stays
// outside the range. A body already found is data, so an introduction inside one
// opens nothing: an introduction falling in a range is skipped, which keeps a
// range from running past the terminator the shell reads.
function heredocBodies(cmd: string, masked: string): Span[] {
  const bodies: Span[] = [];
  const intro = /(?<!<)<<-?[ \t]*(?:'([^'\n]*)'|"([^"\n]*)")(?=[ \t\r\n;|&)]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = intro.exec(cmd)) !== null) {
    const at = m.index;
    if (masked[at] === '\x00' || masked[at] === SUB_SPAN) continue;
    if (bodies.some(b => at >= b.from && at < b.to)) continue;
    const delim = m[1] !== undefined ? m[1] : m[2];
    if (delim === '') continue;
    let nl = cmd.indexOf('\n', m.index + m[0].length);
    while (nl >= 0) {
      const trail = /\\+$/.exec(cmd.slice(0, nl));
      if (trail === null || trail[0].length % 2 === 0) break;
      nl = cmd.indexOf('\n', nl + 1);
    }
    if (nl < 0) continue;
    const esc = delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const t = new RegExp('^[ \\t]*' + esc + '[ \\t]*$', 'm').exec(cmd.slice(nl + 1));
    const end = t === null ? cmd.length : nl + 1 + t.index;
    bodies.push({ from: nl + 1, to: end });
  }
  return bodies;
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
//   1. one `cat` or `tee` owns one heredoc whose delimiter is quoted;
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
async function heredocExemption(cmd: string, cwd: string, strict: boolean, host: LexHost): Promise<{ from: number; to: number } | null> {
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

// A copy of the command with every line continuation spliced out: a backslash
// standing immediately before a newline joins the two lines into one, so the shell
// reads no boundary there at all and `git \<newline>push` runs git push. Left in
// place, that newline ends an operand list in `segment` and every
// positional-subcommand reader loses its subcommand. The pair becomes two spaces
// rather than being deleted, so every index into the command stays valid for the
// masks, the heredoc body ranges, and the substitution ranges built alongside them,
// and the join reads as the word boundary the shell also puts there.
//
// Only an odd-length run of backslashes continues a line: in an even run every
// backslash is itself escaped and the newline after it is a real separator. That is
// bash's rule and the one `heredocBodies` walks its intro line by. A quoted-delimiter
// heredoc body is literal data where bash splices nothing, so a pair inside one of
// `bodies` is left exactly as it stands. Bash splices nothing inside a single-quoted
// span either, and a pair there is spliced anyway: a quoted span is blanked out of
// every pattern the guard matches, so the only thing that reading changes is the
// spelling of an operand whose own bytes carry a newline, which resolves to a path
// in the same place either way.
function spliceContinuations(cmd: string, bodies: readonly Span[]): string {
  const chars = cmd.split('');
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] !== '\n' || chars[i - 1] !== '\\') continue;
    let run = 0;
    while (run < i && chars[i - 1 - run] === '\\') run++;
    if (run % 2 === 0) continue;
    if (bodies.some(b => i - 1 >= b.from && i - 1 < b.to)) continue;
    chars[i - 1] = ' ';
    chars[i] = ' ';
  }
  return chars.join('');
}

// One command out of a chain, pipeline, or multi-line script: the text from
// `from` up to the next unquoted shell separator, redirect, or line break.
// The cut is found in the masked copy, so a separator inside a quoted argument
// (sed -i 's/a/b/;s/c/d/' src/x) or inside a substitution span (git -C $(pwd)
// commit) does not truncate the operand list. A newline ends a command as surely
// as a semicolon; without it the next line's command name reads as an operand of
// this one. Every newline still standing here is one the shell reads, because a
// continued line's backslash-newline pair is spliced out of both copies before the
// masks are built. The `)` stays in the cut set for the subshell closer the mask
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
function segment(cmd: string, masked: string, from: number): string {
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
function tokens(seg: string, literal?: boolean[]): string[] {
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
function commandPositions(masked: string, names: readonly string[]): { name: string; at: number }[] {
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
async function effectiveDirs(cmd: string, masked: string, at: number, cwd: string, host: LexHost): Promise<string[]> {
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
function resolveTarget(raw: string, base: string, host: LexHost): string | null {
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
const GIT_VALUE_FLAGS = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/;

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
function cmdletOperands(toks: readonly string[]): { named: Record<string, string>; positional: string[] } {
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
function cmdletPaths(name: string, named: Record<string, string>, positional: readonly string[]): string[] {
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
function nestedPayloads(cmd: string, masked: string): string[] {
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
async function denyReason(cmd: string, cwd: string | null, strict: boolean, depth: number, host: LexHost): Promise<string | null> {
  // A CRLF pair is a line break the way a bare newline is, so it is normalized to
  // one before anything reads the command: a Windows-authored report or a
  // multi-line command carries \r\n between its lines, and the two rules that bound
  // a heredoc body's terminator (heredocBodies and heredocExemption) would
  // otherwise disagree about a delimiter line's trailing \r and mask a live command
  // past the terminator the shell reads.
  if (depth === 0) cmd = cmd.replace(/\r\n/g, '\n');

  // A raw control character other than tab or newline has no legitimate place in a
  // governed command, and the guard's own masking sentinels (NUL and \x01) are
  // themselves control characters, so an input carrying one could forge a sentinel
  // and reshape an operand list where the shell reads no boundary at all
  // (rm <0x01> README.md). A bare carriage return joins them: after the CRLF
  // normalization above every remaining \r sits mid-line, where bash reads an
  // ordinary word character, so admitting it would only invite the same
  // sentinel-shaped confusion (rm <CR> README.md) and reopen the heredoc
  // terminator desync the normalization closes. Refused at the boundary rather
  // than masked over, which keeps the sentinels unspellable from the input.
  if (depth === 0 && /[\x00-\x08\x0b-\x1f]/.test(cmd)) {
    return 'a control character in the command';
  }

  // Heredoc bodies are found first, on a body-blind quote mask, so the second
  // mask can treat a body's own quotes as the literal data they are. The second
  // mask also collects the interiors of command substitutions found inside
  // double-quoted spans (`subs`), which are live command text scanned on their
  // own below rather than inline, so their delimiters never reshape an operand
  // list.
  const subs: Span[] = [];
  const bodies = heredocBodies(cmd, maskQuoted(cmd));

  // The data-sink exemption is decided over the whole command string, before and
  // independently of the quote mask, and holds only at the top level with a cwd
  // to resolve its destination against. Below the top level the text under
  // analysis is a payload some executor was handed, and what consumes that
  // executor's own stdout sits in the command around it, out of this string:
  // `sh -c "cat <<'EOF' ... EOF" | sh` runs the body while the payload alone
  // reads as a sink copying stdin. It is decided here, ahead of the line splice
  // below, so its intro line is the physical one the recognizer refuses a
  // continuation on. A qualifying body is masked whole, the way a quoted span is,
  // so every heuristic reading the masked copy passes over it.
  const exemptBody = (depth === 0 && cwd) ? await heredocExemption(cmd, cwd, strict, host) : null;

  // Line continuations are spliced out before the masks are built, so no
  // heuristic reads a boundary the shell does not.
  cmd = spliceContinuations(cmd, bodies);

  let masked = maskHeredocRedirects(maskQuoted(cmd, bodies, subs), bodies);
  if (exemptBody) {
    const chars = masked.split('');
    for (let i = exemptBody.from; i < exemptBody.to; i++) chars[i] = '\x00';
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
    const root = await repoRoot(cwd, host);
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
      const nested = await denyReason(src.text, cwd, strict, depth + 1, host);
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
// call, its home directory read once.
export type ReadonlyAgentDeps = { lexHost(): Promise<LexHost> };

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
      const reason = await denyReason(cmd, cwd, cls === "strict", 0, await deps.lexHost());
      return reason === null ? {} : { deny: refusalOf(t, reason) };
    },
  };
}
