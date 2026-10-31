// The web pass's rollout source: what each client branch of each repository the page knows carries
// past its last rollout tag. The convention is one annotated tag per deploy, `rollout/<client>/
// <YYYY-MM-DD>`, on the client's branch at the deployed commit, where `<client>` is the branch name
// after `clients/`; a sandbox sibling `clients/<name>_sandbox` is a client of its own.
//
// The roots are the configured board roots and every roster persona's working directory. Each
// root's `origin` URL groups it: the per-client worker checkouts of one repository read as one. A
// group's name, the `repo` its rows carry, is the last path segment of the URL with any `.git`
// stripped; the URL itself reaches no view, log line or page.
//
// Git runs only in a repository the broker owns. Each group has one bare repository under the
// broker's state root, at `<state root>/rollout/<repo folded to lower case>`, made on the group's
// first sight with `init --bare` and an `origin` set to the URL read from the group's first root in
// list order. Every fetch, read, tag and push for the group runs there. A worker's checkout is read
// by exactly two commands, `remote get-url origin` to group it and `symbolic-ref HEAD` to learn its
// branch, and nothing is ever written into one. Per group, no more often than `ROLLOUT_FETCH_MS`,
// the reader asks the remote which branch its HEAD names with `ls-remote --symref`, then fetches
// the client branches, that default branch, the rollout tags and the publish tags, and nothing
// else; it reads the refs on every cycle. Those two are its outward acts on a read. The fetch
// prunes, so a tag the operator removes from the remote leaves the rows on the next fetch, and a
// prune reaches only the broker's own refs.
//
// A repository that ships by publish tags on its default branch, `publish-*` with no client branch,
// reads one publish row instead of client rows: the default branch's first-parent commits past its
// latest publish tag. A repository with client branches reads no publish row, since it ships one way.
//
// Mark rolled out, `mark`, and Mark published, `markPublished`, are the reader's two outward
// writes, each one tag: under the group's lock it fetches, tags `refs/remotes/origin/<client
// branch>` with the day's `rollout/<client>/<YYYY-MM-DD>`, or the default branch's head with the
// day's `publish-<YYYYMMDD>`, pushes that one tag ref to `origin` and nothing else, and recomputes
// the rows, so a second tap finds the first one's tag after its own fetch and never moves it.
//
// Every git call runs through `runGit`, so the environment scrub, the no-shell spawn and the stderr
// drop in `./git.ts` cover every call here. The runner is asynchronous, so a read cycle runs off the
// pass's tick: `read` starts a cycle where none is running and hands back what the last one computed.
// Each group has one lock, which the timed cycle and a tap's re-fetch both take, so two fetches never
// run into one bare repository at once.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { comparablePath } from "../board/events.ts";
import { LOCAL_READ, REMOTE_CALL, runGit } from "./git.ts";
import type { GitLimits, GitRunner } from "./git.ts";
import type { PublishRow, RolloutCheckout, RolloutCommit, RolloutRow, SharedRow } from "./views.ts";

/** How often a repository is fetched at most. */
export const ROLLOUT_FETCH_MS = 5 * 60 * 1000;

/**
 * How long the first fetch into an empty bare repository may run: it brings the whole history of
 * every client branch, since the ancestry reads need it. Every later fetch keeps `REMOTE_CALL`.
 */
export const ROLLOUT_FIRST_FETCH_MS = 10 * 60 * 1000;

/** The most commits a row carries; `toRollOut` is the exact count. */
export const ROLLOUT_COMMIT_CAP = 50;

/** How far back a default-branch commit is listed as shared, against the reader's clock. */
export const SHARED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The most shared rows one repository carries, the newest of those in the window. */
export const SHARED_ROW_CAP = 20;

/** The folder under the state root that holds the bare repositories, one per group name. */
export const ROLLOUT_STATE_FOLDER = "rollout";

const FIRST_FETCH: GitLimits = { timeoutMs: ROLLOUT_FIRST_FETCH_MS, maxBytes: REMOTE_CALL.maxBytes };

/** The prefix a client branch's name opens with; the route refuses any other branch before the reader sees it. */
export const CLIENT_PREFIX = "clients/";
const REMOTE_PREFIX = "refs/remotes/origin/";
const TAG_PREFIX = "refs/tags/rollout/";
const PUBLISH_PREFIX = "refs/tags/publish-";
const PUBLISH_NAME = /^publish-[A-Za-z0-9._-]+$/;
const PUBLISH_DATE = /^publish-(\d{4})(\d{2})(\d{2})(?:-|$)/;
const TAG_DATE = /^(\d{4}-\d{2}-\d{2})(?:-[A-Za-z0-9._-]+)?$/;

/** What `read` hands back: the last cycle's rows and checkouts, and whether the source is held. */
export type RolloutState = {
  rows: readonly RolloutRow[];
  checkouts: readonly RolloutCheckout[];
  /** Every repository's shared rows, in the order its rows come. */
  shared: readonly SharedRow[];
  /** Every repository's publish row, at most one each, from the repositories with no client branch. */
  publish: readonly PublishRow[];
  /** The latest time any repository's refs were read well, null before any has been. */
  readAt: string | null;
  /** Whether a read cycle has completed at all; the pass leaves the source unread until one has. */
  attempted: boolean;
  /** Whether any repository's latest fetch or read failed, or none has ever read. */
  held: boolean;
  /** Whether git answered on this machine in the latest cycle; false only where every origin read failed as `spawn ENOENT`, git missing from PATH. */
  reachedGit: boolean;
};

/** What `mark` found or did for one repository and client branch, after its fetch. */
export type RolloutMark =
  | { status: "unknown-repo" }
  | { status: "unknown-branch" }
  | { status: "exists"; tag: string }
  | { status: "pushed"; tag: string; sha: string }
  | { status: "push-failed"; tag: string; kind: string };

/** What `markPublished` found or did for one repository, after its fetch. */
export type PublishMark =
  | { status: "unknown-repo" }
  | { status: "not-publish" }
  | { status: "moved"; head: string }
  | { status: "exists"; tag: string | null }
  | { status: "pushed"; tag: string; sha: string }
  | { status: "push-failed"; tag: string; kind: string };

export type RolloutReader = {
  /** Starts a cycle over `roots` where none is running, and hands back the last completed one. */
  read(roots: readonly string[]): RolloutState;
  /** Fetches and recomputes one repository now, under its lock; rejects with the runner's error kind. */
  refresh(repo: string): Promise<void>;
  /**
   * Mark rolled out: fetches `repo` now under its lock and, with the lock still held, tags
   * `refs/remotes/origin/<branch>` with the day's rollout tag for that client, an annotated tag
   * whose message names `login`, pushes that one tag to `origin`, and recomputes the rows. Answers
   * `unknown-repo` for a name the reader has not grouped, `unknown-branch` for a `branch` that is
   * not a client branch the fetch brought, `exists` where the tag was there after the fetch, with
   * nothing moved, `push-failed` with the runner's kind where the push failed, the local tag
   * deleted, and `pushed` with the commit sha the tag points at. Rejects with the runner's kind
   * where the fetch or the tag command failed, with nothing tagged or pushed.
   */
  mark(repo: string, branch: string, login: string): Promise<RolloutMark>;
  /**
   * Mark published: fetches `repo` now under its lock and, with the lock still held, tags the
   * default branch's head with the day's publish tag, `publishTagName` over the tags the fetch
   * brought, an annotated tag whose message names `login`, pushes that one tag to `origin`, and
   * recomputes the rows. `head` is the default branch head the page showed, the publish row's
   * `head`. Answers `unknown-repo` for a name the reader has not grouped, `not-publish` for a
   * repository with a client branch, admitted or refused, no default branch, or no publish tag
   * the reader reads on that branch's first-parent line, `moved` with the head the fetch brought
   * where that is not `head`, `exists` where the head already carried a tag opening `publish-`
   * after the fetch, with nothing moved and the tag's name where `publishTagSafe` passes it,
   * `push-failed` with the runner's kind where the push failed, the local tag deleted, and
   * `pushed` with the commit sha the tag points at. Rejects with the runner's kind where the fetch
   * or the tag command failed, with nothing tagged or pushed.
   */
  markPublished(repo: string, login: string, head: string): Promise<PublishMark>;
  /** The bare repository one repository's git commands run in, or null for a name the reader has not grouped. */
  rootOf(repo: string): string | null;
  /** Resolves, with the state as it then stands, once no cycle is running. */
  settled(): Promise<RolloutState>;
};

export type RolloutReaderOptions = {
  log: (message: string) => void;
  /** The broker's state root: each group's bare repository lives under its `rollout` folder. */
  stateRoot: string;
  now?: () => number;
  /** The git runner, injected so a test records, fails or replaces the calls. */
  git?: GitRunner;
  fetchMs?: number;
};

const locks = new Map<string, Promise<void>>();

/**
 * Runs `task` once every task queued before it under `repo` has settled, so the pass's timed fetch
 * and a tap's re-fetch of one repository run one after the other, never into one bare repository
 * at once.
 */
export function underRepoLock<T>(repo: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(repo) ?? Promise.resolve();
  const run = previous.then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(repo, settled);
  void settled.then(() => {
    if (locks.get(repo) === settled) locks.delete(repo);
  });
  return run;
}

/** The Windows device names a file name may not take, with or without an extension, in any case. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Why `name` cannot be one folder name directly under the `rollout` folder, or null where it can.
 * The name comes from a worker checkout's `origin` URL, which the worker controls, and it becomes
 * the folder the broker runs `git init --bare` in: a `..` would put that in the state root itself.
 * Allowed are ASCII letters, digits, `.`, `_` and `-`, in a name that is neither `.` nor `..`,
 * neither opens nor ends with `.`, and is no reserved device name.
 */
export function repoNameFault(name: string): string | null {
  if (name === "." || name === "..") return "dot name";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "character";
  if (name.startsWith(".")) return "leading dot";
  if (name.endsWith(".")) return "trailing dot";
  if (RESERVED_DEVICE.test(name)) return "reserved device name";
  return null;
}

/**
 * The name a repository goes by: the last segment of its `origin` URL with any `.git` stripped,
 * or null where that is empty or `repoNameFault` refuses it as a folder name.
 */
export function repoNameOf(url: string): string | null {
  const segments = url.trim().replace(/[\\/]+$/, "").split(/[\\/:]/);
  const last = segments[segments.length - 1] ?? "";
  const name = last.replace(/\.git$/i, "");
  return name === "" || repoNameFault(name) !== null ? null : name;
}

/**
 * The key one repository's roots group under, whichever way each writes its `origin` URL: any
 * userinfo dropped, the scheme and host lowercased, and a trailing `/` and `.git` stripped. It is
 * a grouping key only, and reaches no view or log line, as the URL does not.
 */
export function repoKeyOf(url: string): string {
  const bare = url.trim().replace(/[\\/]+$/, "").replace(/\.git$/i, "").replace(/[\\/]+$/, "");
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/]*)(.*)$/i.exec(bare);
  if (scheme !== null) return `${(scheme[1] ?? "").toLowerCase()}://${(scheme[2] ?? "").toLowerCase()}${scheme[3] ?? ""}`;
  // The scp-like form, `[user@]host:path`; a one-letter host is a Windows drive, so a local path.
  const scp = /^(?:[^@/\\]+@)?([^:/\\]{2,}):(.*)$/.exec(bare);
  if (scp !== null) return `${(scp[1] ?? "").toLowerCase()}:${scp[2] ?? ""}`;
  return bare;
}

type Tag = { name: string; date: string };

/**
 * The latest rollout tag for a client among `tags`, tag names under `refs/tags/`: the one whose
 * date segment sorts last, then whose name does. The segment is a whole `YYYY-MM-DD`, optionally
 * followed by `-` and a suffix of letters, digits, `.`, `_` and `-`; any other segment is no
 * rollout tag. The date segment decides so a tag made late for an earlier deploy never wins over
 * the later deploy's tag.
 */
export function latestRolloutTag(tags: readonly string[], client: string): Tag | null {
  const prefix = `rollout/${client}/`;
  let latest: Tag | null = null;
  for (const name of tags) {
    if (!name.startsWith(prefix)) continue;
    const segment = name.slice(prefix.length);
    const date = TAG_DATE.exec(segment)?.[1];
    if (date === undefined || segment.includes("/")) continue;
    if (latest === null || date > latest.date || (date === latest.date && name > latest.name)) latest = { name, date };
  }
  return latest;
}

/** A publish tag: its name under `refs/tags/`, and the date its name carries as `YYYY-MM-DD`, or null. */
export type PublishTag = { name: string; date: string | null };

/**
 * Whether `name`, a tag name under `refs/tags/`, is a publish tag the reader reads: `publish-`
 * followed by a non-empty run of ASCII letters, digits, `.`, `_` and `-`. The publish workflow
 * starts on any tag opening `publish-`; the narrower run keeps a name the page prints free of shell
 * syntax, as `clientBranchSafe` does for a client branch.
 */
export function publishTagSafe(name: string): boolean {
  return PUBLISH_NAME.test(name);
}

/**
 * The latest publish tag among `tags`, each a tag name and the commit it points at: the one whose
 * commit has the lowest index in `order`, the default branch's first-parent commits numbered from
 * its head, since that commit is the one the last publish shipped. Two tags on one commit are
 * ordered by name, the later winning; for two names that both carry a `YYYYMMDD` date segment that
 * is the date order too. A tag whose commit `order` does not hold, or whose name `publishTagSafe`
 * refuses, is no candidate. The date segment orders nothing between commits, so a day mixing
 * counter and hash suffixes reads by the commits they sit on.
 */
export function latestPublishTag(tags: readonly { name: string; sha: string }[], order: ReadonlyMap<string, number>): PublishTag | null {
  let latest: { name: string; at: number } | null = null;
  for (const { name, sha } of tags) {
    if (!publishTagSafe(name)) continue;
    const at = order.get(sha);
    if (at === undefined) continue;
    if (latest === null || at < latest.at || (at === latest.at && name > latest.name)) latest = { name, at };
  }
  if (latest === null) return null;
  return { name: latest.name, date: publishDateOf(latest.name) };
}

/** The `YYYYMMDD` date segment a publish tag's name opens with, as `YYYY-MM-DD`, or null where it carries none that is a calendar date. */
function publishDateOf(name: string): string | null {
  const segment = PUBLISH_DATE.exec(name);
  if (segment === null) return null;
  const [year, month, day] = [Number(segment[1]), Number(segment[2]), Number(segment[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return `${segment[1] ?? ""}-${segment[2] ?? ""}-${segment[3] ?? ""}`;
}

/**
 * The rollout tag for `client` made on the day `at` falls on in the host's local time,
 * `rollout/<client>/<YYYY-MM-DD>`: the date the operator declares by tapping that day.
 */
export function rolloutTagName(client: string, at: number): string {
  const day = new Date(at);
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `rollout/${client}/${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * The publish tag for the day `at` falls on in the host's local time, `publish-<YYYYMMDD>`, or
 * where `taken` holds that name, the first of `publish-<YYYYMMDD>-2`, `-3` and so on it does not
 * hold. `taken` is the tag names the fetch brought, so a name the remote has is never made twice;
 * a name with another suffix, such as the workflow's own `-<sha>`, takes no counter.
 */
export function publishTagName(at: number, taken: ReadonlySet<string>): string {
  const day = new Date(at);
  const pad = (part: number): string => String(part).padStart(2, "0");
  const base = `publish-${String(day.getFullYear())}${pad(day.getMonth() + 1)}${pad(day.getDate())}`;
  let name = base;
  for (let counter = 2; taken.has(name); counter += 1) name = `${base}-${String(counter)}`;
  return name;
}

/**
 * Whether the client branch `branch`, `clients/<client>` with any `/` inside the client part, is
 * one the reader accepts. The client part becomes a tag name that the page prints inside an undo
 * command for the operator to paste into a shell, and git's ref rules allow `$`, a backtick, `;`,
 * `|` and `&` in a branch name. Every `/`-separated segment of the client part must be a
 * non-empty run of ASCII letters, digits, `.`, `_` and `-`.
 */
export function clientBranchSafe(branch: string): boolean {
  if (!branch.startsWith(CLIENT_PREFIX)) return false;
  return branch
    .slice(CLIENT_PREFIX.length)
    .split("/")
    .every((segment) => /^[A-Za-z0-9._-]+$/.test(segment));
}

type Refs = {
  defaultRef: string | null;
  clients: string[];
  /** How many client branches the remote has that `clientBranchSafe` refused, left out of `clients`. */
  refused: number;
  /** Whether no remote-tracking ref exists at all, as in a bare repository nothing has been fetched into. */
  empty: boolean;
};

type Group = {
  /** The name as first seen, the `repo` the rows carry. */
  name: string;
  /**
   * The name lowercased, the key the group is held, locked and given its folder under: the folder
   * sits on a file system that may ignore case, and both hosts compare repository names without it.
   */
  folded: string;
  /** The `repoKeyOf` the group's roots share. */
  key: string;
  /** The group's first root in list order, the worker checkout its `origin` URL was read from. */
  root: string;
  url: string;
  /** The bare repository the broker owns for the group, where every git command but the two reads runs. */
  bare: string;
  /** When the last fetch was started, success or not, so a failing remote is retried on the cadence. */
  fetchedAt: number | null;
  rows: RolloutRow[];
  shared: SharedRow[];
  publish: PublishRow[];
  readAt: string | null;
  failed: boolean;
  everRead: boolean;
};

function iso(text: string): string {
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? text : at.toISOString();
}

function lines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line !== "");
}

function kindOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "EINVAL";
}

export function createRolloutReader(options: RolloutReaderOptions): RolloutReader {
  const { log, stateRoot } = options;
  const now = options.now ?? Date.now;
  const git = options.git ?? runGit;
  const fetchMs = options.fetchMs ?? ROLLOUT_FETCH_MS;

  let groups = new Map<string, Group>();
  const skippedRoots = new Set<string>();
  const skippedDuplicates = new Set<string>();
  const unprepared = new Set<string>();
  const refusedClients = new Set<string>();
  let state: RolloutState = { rows: [], checkouts: [], shared: [], publish: [], readAt: null, attempted: false, held: true, reachedGit: false };
  let inFlight: Promise<void> | null = null;
  /**
   * Whether the last cycle could ask git about its roots: true where it had none, or git answered
   * for any one, even to say it holds no repository. False where every root failed before git
   * answered, as on a machine with no git on `PATH`.
   */
  let reachedGit = false;
  /** Whether the last cycle had a root whose origin read failed as anything but git's own `exit <n>`; it holds the source. */
  let unanswered = false;

  /** The remote-tracking refs: the default branch, where one can be named, and the client branches. */
  async function refsOf(root: string): Promise<Refs> {
    const listed = lines(await git(root, ["for-each-ref", "--format=%(refname)%09%(symref)", REMOTE_PREFIX], LOCAL_READ));
    const names = new Set<string>();
    let head: string | null = null;
    for (const line of listed) {
      const [refname = "", symref = ""] = line.split("\t");
      if (refname === `${REMOTE_PREFIX}HEAD`) head = symref === "" ? null : symref;
      else names.add(refname);
    }
    let defaultRef: string | null = null;
    if (head !== null && names.has(head)) defaultRef = head;
    else if (names.has(`${REMOTE_PREFIX}main`)) defaultRef = `${REMOTE_PREFIX}main`;
    else if (names.has(`${REMOTE_PREFIX}master`)) defaultRef = `${REMOTE_PREFIX}master`;
    const named = [...names]
      .filter((name) => name.startsWith(REMOTE_PREFIX + CLIENT_PREFIX))
      .map((name) => name.slice(REMOTE_PREFIX.length))
      .sort();
    const clients = named.filter(clientBranchSafe);
    return { defaultRef, clients, refused: named.length - clients.length, empty: listed.length === 0 };
  }

  /**
   * The group's bare repository, seen to before every due or forced fetch: the folder and the
   * repository are made where missing, and `origin` is added where the repository has none. A
   * repository that already has an `origin` keeps it, and is used only where that `origin` keys as
   * the group's repository by `repoKeyOf`; otherwise preparation fails as `origin moved` and the
   * group stays held. The check runs ahead of each fetch, so it covers a remote that moved, a
   * different repository under the same folded name, and every restart. The broker never changes
   * or deletes that `origin`. The recovery for a moved remote is to remove the group's folder under
   * the state root's `rollout` folder: the next due fetch, or the next tap, makes it again with the
   * group's current URL, whether or not the broker was stopped for the removal.
   */
  async function prepareGroup(group: Group): Promise<void> {
    try {
      mkdirSync(group.bare, { recursive: true });
    } catch (error) {
      throw new Error(`mkdir ${codeOf(error)}`);
    }
    await git(group.bare, ["init", "--bare"], LOCAL_READ);
    let origin: string | null = null;
    try {
      origin = await git(group.bare, ["remote", "get-url", "origin"], LOCAL_READ);
    } catch (error) {
      // Exit 2 is git's answer for a remote the repository does not have.
      if (kindOf(error) !== "exit 2") throw error;
      await git(group.bare, ["remote", "add", "origin", group.url], LOCAL_READ);
    }
    if (origin !== null && repoKeyOf(origin.trim()) !== group.key) throw new Error("origin moved");
  }

  /**
   * The default branch's name as the remote declares it, from the `ref: refs/heads/<branch>\tHEAD`
   * line of `ls-remote --symref`, or null where the remote has no HEAD. Asked before every fetch, so
   * a default branch renamed or moved on the remote is the one fetched: the fetch has to name the
   * branch to bring it, and `set-head` can only name a branch already fetched.
   */
  async function remoteHeadOf(bare: string): Promise<string | null> {
    const output = await git(bare, ["ls-remote", "--symref", "origin", "HEAD"], REMOTE_CALL);
    for (const line of lines(output)) {
      const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line);
      if (match !== null) return match[1] ?? null;
    }
    return null;
  }

  /**
   * The remote's HEAD query, the fetch into the group's bare repository, then `set-head` naming the
   * branch the remote's HEAD named, so `refs/remotes/origin/HEAD` names the default branch. The first
   * fetch into an empty repository brings the whole history and takes `FIRST_FETCH`, and every later
   * one takes `REMOTE_CALL`. `set-head` with a branch named contacts no remote, so it is a local
   * read; the `--` before the branch keeps a name the remote chose from reading as an option.
   */
  async function fetchGroup(group: Group): Promise<void> {
    const refs = await refsOf(group.bare);
    const limits = refs.empty ? FIRST_FETCH : REMOTE_CALL;
    // A remote that names no HEAD keeps the default branch already held.
    const branch = (await remoteHeadOf(group.bare)) ?? refs.defaultRef?.slice(REMOTE_PREFIX.length) ?? null;
    const specs = [`+refs/heads/${CLIENT_PREFIX}*:${REMOTE_PREFIX}${CLIENT_PREFIX}*`];
    if (branch !== null) specs.push(`+refs/heads/${branch}:${REMOTE_PREFIX}${branch}`);
    specs.push(`+${TAG_PREFIX}*:${TAG_PREFIX}*`);
    specs.push(`+${PUBLISH_PREFIX}*:${PUBLISH_PREFIX}*`);
    await git(
      group.bare,
      ["fetch", "--no-tags", "--prune", "--no-write-fetch-head", "--no-auto-maintenance", "--no-recurse-submodules", "origin", ...specs],
      limits,
    );
    if (branch !== null) await git(group.bare, ["remote", "set-head", "origin", "--", branch], LOCAL_READ);
  }

  /**
   * The first-parent commits of `range`, each record its sha, title and committer date between
   * unit separators, ended by the NUL the format itself places there. A commit is counted by that
   * terminator alone: the newline git adds after each record, and any line a host setting adds
   * before one, such as a signature program's, sits before the next record's fields and is dropped.
   */
  async function commitsOf(root: string, range: string, bounds: readonly string[] = []): Promise<RolloutCommit[]> {
    const output = await git(root, ["log", "--first-parent", ...bounds, "--format=%H%x1f%s%x1f%cI%x00", range], LOCAL_READ);
    const records = output.split("\0");
    // What follows the last terminator is no record.
    records.pop();
    return records.map((record) => {
      const [sha = "", title = "", at = ""] = record.slice(record.lastIndexOf("\n") + 1).split("\x1f");
      return { sha, title, at: iso(at), fromDefault: false };
    });
  }

  async function rowOf(root: string, repo: string, refs: Refs, tags: readonly string[], branch: string, readAt: string): Promise<RolloutRow> {
    const client = branch.slice(CLIENT_PREFIX.length);
    const head = REMOTE_PREFIX + branch;
    const tag = latestRolloutTag(tags, client);
    let base: string | null = null;
    if (tag !== null) {
      base = `refs/tags/${tag.name}`;
    } else if (refs.defaultRef !== null) {
      try {
        base = (await git(root, ["merge-base", refs.defaultRef, head], LOCAL_READ)).trim();
      } catch (error) {
        // Exit 1 is git's answer for two histories with no common commit; anything else is the read failing.
        if (kindOf(error) !== "exit 1") throw error;
      }
    }
    const commits = base === null ? [] : await commitsOf(root, `${base}..${head}`);
    if (base !== null && refs.defaultRef !== null && commits.length > 0) {
      // The first-parent commits past the base that the default branch does not contain; the rest are from it.
      const outside = new Set(lines(await git(root, ["rev-list", "--first-parent", head, `^${base}`, `^${refs.defaultRef}`], LOCAL_READ)));
      for (const commit of commits) commit.fromDefault = !outside.has(commit.sha);
    }
    return {
      repo,
      branch,
      client,
      lastTag: tag?.name ?? null,
      lastTagDate: tag?.date ?? null,
      toRollOut: commits.length,
      oldestAt: commits[commits.length - 1]?.at ?? null,
      newestAt: commits[0]?.at ?? null,
      commits: commits.slice(0, ROLLOUT_COMMIT_CAP),
      readAt,
    };
  }

  /**
   * The default branch's first-parent commits from the last `SHARED_WINDOW_MS` of the reader's
   * clock, the newest `SHARED_ROW_CAP`, newest first. The log passes `--since-as-filter`, which
   * walks the whole first-parent line and prints only commits inside the window, because plain
   * `--since` stops the walk at the first commit older than the bound and an old-dated commit
   * would hide every in-window commit behind it. The filter against the clock stays the rule. Each
   * commit carries how many client branches contain it and how many have a latest rollout tag that
   * does, both by ancestry from one `for-each-ref --contains` per kept commit that names whole
   * refs, so a branch or tag whose name only begins with another client's counts for its own
   * client alone. A repository with no default branch or no client branch has no rows, and its
   * log is never read.
   */
  async function sharedOf(root: string, repo: string, refs: Refs, tags: readonly string[]): Promise<SharedRow[]> {
    // A repository with no client branch has no client to roll a commit out to, so its commits are never read.
    if (refs.defaultRef === null || refs.clients.length === 0) return [];
    const from = now() - SHARED_WINDOW_MS;
    const listed = await commitsOf(root, refs.defaultRef, [`--since-as-filter=${new Date(from).toISOString()}`]);
    const kept = listed
      .filter((commit) => Date.parse(commit.at) >= from)
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, SHARED_ROW_CAP);
    const latest = refs.clients.map((branch) => latestRolloutTag(tags, branch.slice(CLIENT_PREFIX.length)));
    // Each pattern is one whole tag refname, which for-each-ref matches exactly; older tags are never read.
    const latestRefs = latest.flatMap((tag) => (tag === null ? [] : [`refs/tags/${tag.name}`]));
    const rows: SharedRow[] = [];
    for (const commit of kept) {
      const containing = new Set(
        lines(await git(root, ["for-each-ref", "--contains", commit.sha, "--format=%(refname)", REMOTE_PREFIX + CLIENT_PREFIX, ...latestRefs], LOCAL_READ)),
      );
      rows.push({
        repo,
        sha: commit.sha,
        title: commit.title,
        at: commit.at,
        fannedOut: refs.clients.filter((branch) => containing.has(REMOTE_PREFIX + branch)).length,
        atClients: latest.filter((tag) => tag !== null && containing.has(`refs/tags/${tag.name}`)).length,
        clients: refs.clients.length,
      });
    }
    return rows;
  }

  /** The commit `<defaultRef>~<count>` names, the default branch's first-parent commit `count` back from its head, or null past its root. */
  async function firstParentAt(root: string, defaultRef: string, count: number): Promise<string | null> {
    try {
      return (await git(root, ["rev-parse", "--verify", "--quiet", `${defaultRef}~${String(count)}^{commit}`], LOCAL_READ)).trim();
    } catch (error) {
      // Exit 1 is git's answer for a name that resolves to nothing; anything else is the read failing.
      if (kindOf(error) !== "exit 1") throw error;
      return null;
    }
  }

  /**
   * The first-parent position of the newest default-branch commit a publish tag sits on: the
   * commit's index from the head, which is also the exact first-parent count past it, keyed by its
   * sha. One counted `rev-list` excluding every publish tag's history finds the first first-parent
   * commit any publish tag reaches; where that commit carries a candidate tag, it is the newest
   * tagged one. Where it does not, a tag off the first-parent line reached it first, and each
   * candidate commit is counted on its own and kept where the commit that far back is itself, the
   * smallest count winning. Every read prints a number or a sha, so none grows with the branch.
   */
  async function newestTagged(root: string, defaultRef: string, candidates: ReadonlySet<string>): Promise<Map<string, number>> {
    const stop = Number((await git(root, ["rev-list", "--first-parent", "--count", defaultRef, "--not", `--glob=${PUBLISH_PREFIX}*`], LOCAL_READ)).trim());
    const reached = await firstParentAt(root, defaultRef, stop);
    if (reached !== null && candidates.has(reached)) return new Map([[reached, stop]]);
    const counted: { sha: string; count: number }[] = [];
    for (const sha of candidates) {
      counted.push({ sha, count: Number((await git(root, ["rev-list", "--first-parent", "--count", `${sha}..${defaultRef}`], LOCAL_READ)).trim()) });
    }
    counted.sort((left, right) => left.count - right.count);
    for (const { sha, count } of counted) {
      if ((await firstParentAt(root, defaultRef, count)) === sha) return new Map([[sha, count]]);
    }
    return new Map();
  }

  /**
   * The publish row of a repository with no client branch: its latest publish tag by
   * `latestPublishTag`, on the newest default-branch commit `newestTagged` finds, and the
   * first-parent commits past it, every one on the default branch. No row where the repository has
   * no publish tag the reader reads on that branch's first-parent line. The tags are listed with
   * each one's commit, peeled where the tag is annotated. `toPublish` is the exact count however
   * old the tag, and the log reads only the `ROLLOUT_COMMIT_CAP` the row carries.
   */
  async function publishOf(root: string, repo: string, defaultRef: string, readAt: string): Promise<PublishRow[]> {
    const listed = lines(await git(root, ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(*objectname)", `${PUBLISH_PREFIX}*`], LOCAL_READ));
    const tags = listed
      .map((line) => {
        const [refname = "", object = "", peeled = ""] = line.split("\t");
        return { name: refname.slice("refs/tags/".length), sha: peeled === "" ? object : peeled };
      })
      .filter((tag) => publishTagSafe(tag.name));
    if (tags.length === 0) return [];
    const order = await newestTagged(root, defaultRef, new Set(tags.map((tag) => tag.sha)));
    const tag = latestPublishTag(tags, order);
    if (tag === null) return [];
    const toPublish = order.values().next().value ?? 0;
    const head = (await git(root, ["rev-parse", "--verify", defaultRef], LOCAL_READ)).trim();
    const commits = (await commitsOf(root, `refs/tags/${tag.name}..${defaultRef}`, [`--max-count=${String(ROLLOUT_COMMIT_CAP)}`])).map((commit) => ({ ...commit, fromDefault: true }));
    // The oldest commit waiting is the one just past the tag, read on its own where the log stops short of it.
    const oldest = toPublish > commits.length ? (await commitsOf(root, `${defaultRef}~${String(toPublish - 1)}`, ["--max-count=1"]))[0] : commits[commits.length - 1];
    return [
      {
        repo,
        branch: defaultRef.slice(REMOTE_PREFIX.length),
        head,
        lastTag: tag.name,
        lastTagDate: tag.date,
        toPublish,
        oldestAt: oldest?.at ?? null,
        newestAt: commits[0]?.at ?? null,
        commits,
        readAt,
      },
    ];
  }

  async function computeGroup(group: Group): Promise<void> {
    const readAt = new Date(now()).toISOString();
    const refs = await refsOf(group.bare);
    if (refs.refused === 0) {
      refusedClients.delete(group.folded);
    } else {
      // Named once while the refusal persists, by group and count, never by branch text.
      if (!refusedClients.has(group.folded)) log(`web rollout: ${group.name} refused ${String(refs.refused)} client branch(es) whose name is outside A-Za-z0-9._-`);
      refusedClients.add(group.folded);
    }
    const tags = lines(await git(group.bare, ["for-each-ref", "--format=%(refname)", TAG_PREFIX], LOCAL_READ)).map((name) =>
      name.slice("refs/tags/".length),
    );
    const rows: RolloutRow[] = [];
    for (const branch of refs.clients) rows.push(await rowOf(group.bare, group.name, refs, tags, branch, readAt));
    // Every list is read before any is stored, so a failed read leaves the last set standing.
    const shared = await sharedOf(group.bare, group.name, refs, tags);
    // A repository ships one way: one with client branches, admitted or refused, reads no publish row.
    const publishRows = refs.clients.length === 0 && refs.refused === 0 && refs.defaultRef !== null ? await publishOf(group.bare, group.name, refs.defaultRef, readAt) : [];
    group.rows = rows;
    group.shared = shared;
    group.publish = publishRows;
    group.readAt = readAt;
  }

  /**
   * One repository's fetch where due or forced, its bare repository prepared ahead of it, or null
   * where no fetch was due. A preparation that fails holds the group with one log line naming it,
   * never its URL, and waits out the fetch interval like a failed fetch, so a group that cannot be
   * prepared does not spawn git on every pass tick. A fetch that fails leaves the refs as they
   * stand and marks the group failed until the next good read. Either failure answers its kind.
   */
  async function fetchDue(group: Group, at: number, force: boolean): Promise<string | null> {
    if (!force && group.fetchedAt !== null && at - group.fetchedAt < fetchMs) return null;
    try {
      await prepareGroup(group);
    } catch (error) {
      group.failed = true;
      group.fetchedAt = at;
      if (!unprepared.has(group.folded)) log(`web rollout: ${group.name} could not be prepared (${kindOf(error)})`);
      unprepared.add(group.folded);
      return kindOf(error);
    }
    unprepared.delete(group.folded);
    group.fetchedAt = at;
    try {
      await fetchGroup(group);
    } catch (error) {
      group.failed = true;
      return kindOf(error);
    }
    return null;
  }

  /** One repository's rows from its refs as they stand; a read that fails leaves the rows and marks the group failed. */
  async function recompute(group: Group): Promise<string | null> {
    try {
      await computeGroup(group);
    } catch (error) {
      group.failed = true;
      return kindOf(error);
    }
    group.failed = false;
    group.everRead = true;
    return null;
  }

  /** One repository's fetch where due or forced, then its rows; the rows are recomputed only after a fetch that succeeded or was not due. */
  async function readGroup(group: Group, at: number, force: boolean): Promise<string | null> {
    return (await fetchDue(group, at, force)) ?? recompute(group);
  }

  /**
   * The tap's own step, run with the group's lock held and its fetch done. The branch is matched
   * exactly against the client branches the fetch brought, so what reaches `git tag` and the tag's
   * own name is a ref name the remote has. The tag exists, after the fetch's prune, where the
   * remote has it; else the annotated tag is made at the branch head and that one ref is pushed. A
   * push that fails has its local tag deleted, so the next tap does not read it as existing; where
   * the delete fails too, the next fetch's prune removes it, since the remote never took it.
   */
  async function tagAndPush(group: Group, branch: string, login: string): Promise<RolloutMark> {
    const refs = await refsOf(group.bare);
    if (!refs.clients.includes(branch)) return { status: "unknown-branch" };
    const tag = rolloutTagName(branch.slice(CLIENT_PREFIX.length), now());
    const ref = `refs/tags/${tag}`;
    try {
      await git(group.bare, ["show-ref", "--verify", "--quiet", ref], LOCAL_READ);
      return { status: "exists", tag };
    } catch (error) {
      // Exit 1 is git's answer for a ref that does not exist; anything else is the read failing.
      if (kindOf(error) !== "exit 1") throw error;
    }
    const head = REMOTE_PREFIX + branch;
    const sha = (await git(group.bare, ["rev-parse", "--verify", head], LOCAL_READ)).trim();
    await git(group.bare, ["tag", "-a", "-m", `Rolled out by ${login} from the Channels page`, tag, head], LOCAL_READ);
    try {
      await git(group.bare, ["push", "origin", ref], REMOTE_CALL);
    } catch (error) {
      try {
        await git(group.bare, ["tag", "-d", tag], LOCAL_READ);
      } catch {
        // Left for the next fetch's prune.
      }
      return { status: "push-failed", tag, kind: kindOf(error) };
    }
    return { status: "pushed", tag, sha };
  }

  /**
   * Mark published's own step, run with the group's lock held and its fetch done. The repository
   * must be one that ships by publish tags, a default branch and no client branch, admitted or
   * refused, as `computeGroup` gates the publish row, and one already published this way: a
   * publish tag the reader reads on the default branch's first-parent line, as `newestTagged`
   * finds the row's, so a repository never published is never first published from the page. The
   * publish tags the fetch brought are read once, by name and by the commit each points at, peeled
   * where annotated. The head the fetch brought must be `shown`, the one the page sent back, else
   * `moved` answers the current head and nothing is tagged. A tag of any name on the head means
   * nothing to publish, and its name is answered only where `publishTagSafe` passes it, since the
   * page prints the answer. Else the day's name past the names taken is made as an annotated tag
   * at the head and that one ref is pushed. A push that fails has its local tag deleted, so the
   * next tap does not read it as taken; where the delete fails too, the next fetch's prune removes
   * it, since the remote never took it.
   */
  async function publishTagAndPush(group: Group, login: string, shown: string): Promise<PublishMark> {
    const refs = await refsOf(group.bare);
    if (refs.defaultRef === null || refs.clients.length > 0 || refs.refused > 0) return { status: "not-publish" };
    const head = refs.defaultRef;
    const sha = (await git(group.bare, ["rev-parse", "--verify", head], LOCAL_READ)).trim();
    const listed = lines(await git(group.bare, ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(*objectname)", `${PUBLISH_PREFIX}*`], LOCAL_READ));
    const taken = new Set<string>();
    const published = new Set<string>();
    let onHead = false;
    let named: string | null = null;
    for (const line of listed) {
      const [refname = "", object = "", peeled = ""] = line.split("\t");
      const name = refname.slice("refs/tags/".length);
      const at = peeled === "" ? object : peeled;
      taken.add(name);
      if (publishTagSafe(name)) published.add(at);
      if (at !== sha) continue;
      onHead = true;
      if (publishTagSafe(name) && (named === null || name > named)) named = name;
    }
    if (published.size === 0 || (await newestTagged(group.bare, head, published)).size === 0) return { status: "not-publish" };
    if (sha !== shown) return { status: "moved", head: sha };
    if (onHead) return { status: "exists", tag: named };
    const tag = publishTagName(now(), taken);
    const ref = `refs/tags/${tag}`;
    await git(group.bare, ["tag", "-a", "-m", `Published by ${login} from the Channels page`, tag, sha], LOCAL_READ);
    try {
      await git(group.bare, ["push", "origin", ref], REMOTE_CALL);
    } catch (error) {
      try {
        await git(group.bare, ["tag", "-d", tag], LOCAL_READ);
      } catch {
        // Left for the next fetch's prune.
      }
      return { status: "push-failed", tag, kind: kindOf(error) };
    }
    return { status: "pushed", tag, sha };
  }

  async function checkoutOf(root: string, repo: string): Promise<RolloutCheckout> {
    try {
      const ref = (await git(root, ["symbolic-ref", "--quiet", "HEAD"], LOCAL_READ)).trim();
      return { root, repo, branch: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null };
    } catch {
      return { root, repo, branch: null };
    }
  }

  function publish(checkouts: readonly RolloutCheckout[]): void {
    const listed = [...groups.values()];
    let readAt: string | null = null;
    for (const group of listed) {
      if (group.readAt !== null && (readAt === null || group.readAt > readAt)) readAt = group.readAt;
    }
    state = {
      rows: listed.flatMap((group) => group.rows),
      checkouts,
      shared: listed.flatMap((group) => group.shared),
      publish: listed.flatMap((group) => group.publish),
      readAt,
      attempted: true,
      // Roots that hold no repository are a good read with no rows; a machine where git never
      // answered, a root whose origin read failed for any reason but git's own `exit <n>`, or a
      // repository that has not read well, holds the source.
      held: !reachedGit || unanswered || listed.some((group) => !group.everRead || group.failed),
      reachedGit,
    };
  }

  async function cycle(roots: readonly string[], at: number): Promise<void> {
    const seen = new Set<string>();
    const byKey = new Map<string, Group>();
    const named = new Map<string, string>();
    const checkouts: RolloutCheckout[] = [];
    let asked = false;
    let answered = false;
    let failedRead = false;
    for (const root of roots) {
      const rootKey = comparablePath(path.resolve(root));
      if (seen.has(rootKey)) continue;
      seen.add(rootKey);
      asked = true;
      let url: string;
      try {
        url = (await git(root, ["remote", "get-url", "origin"], LOCAL_READ)).trim();
      } catch (error) {
        // Not a repository, no origin, or no git at all: named once, by root, never by URL. Only
        // `spawn ENOENT`, git missing from PATH, is git not answering; any other failure, a timeout,
        // a signal kill, `spawn EACCES` or an `exit <n>`, is git answering, so a host whose git
        // hangs reads as held.
        if (kindOf(error) !== "spawn ENOENT") answered = true;
        if (!kindOf(error).startsWith("exit ")) failedRead = true;
        if (!skippedRoots.has(rootKey)) log(`web rollout: ${root} skipped (${kindOf(error)})`);
        skippedRoots.add(rootKey);
        continue;
      }
      answered = true;
      const name = repoNameOf(url);
      if (name === null) {
        // No usable name, an empty last segment or one that is not safe as a folder name among
        // them: named once, by root, never by URL.
        if (!skippedRoots.has(rootKey)) log(`web rollout: ${root} skipped (its origin URL names no repository)`);
        skippedRoots.add(rootKey);
        continue;
      }
      skippedRoots.delete(rootKey);
      const key = repoKeyOf(url);
      const folded = name.toLowerCase();
      let group = byKey.get(key);
      if (group === undefined) {
        const taken = named.get(folded);
        if (taken !== undefined && taken !== key) {
          if (!skippedDuplicates.has(key)) log(`web rollout: ${root} skipped (a repository named ${name} is already read)`);
          skippedDuplicates.add(key);
          continue;
        }
        const held = groups.get(folded);
        if (held !== undefined && held.key === key) {
          // The same object, so a tap's refresh in flight on it lands in the group the cycle keeps.
          held.root = root;
          held.url = url;
          group = held;
        } else {
          group = {
            name,
            folded,
            key,
            root,
            url,
            bare: path.join(stateRoot, ROLLOUT_STATE_FOLDER, folded),
            fetchedAt: null,
            rows: [],
            shared: [],
            publish: [],
            readAt: null,
            failed: false,
            everRead: false,
          };
        }
        byKey.set(key, group);
        named.set(folded, key);
      }
      checkouts.push(await checkoutOf(root, group.name));
    }
    reachedGit = answered || !asked;
    unanswered = failedRead;
    // Swapped whole, so a tap arriving mid-cycle looks a repository up in a complete map.
    groups = new Map([...byKey.values()].map((group) => [group.folded, group]));
    for (const group of groups.values()) {
      await underRepoLock(group.folded, () => readGroup(group, at, false));
    }
    publish(checkouts);
  }

  return {
    read(roots) {
      if (inFlight === null) {
        inFlight = cycle([...roots], now())
          .catch(() => undefined)
          .finally(() => {
            inFlight = null;
          });
      }
      return state;
    },
    async refresh(repo) {
      const group = groups.get(repo.toLowerCase());
      if (group === undefined) throw new Error("unknown repository");
      const kind = await underRepoLock(group.folded, () => readGroup(group, now(), true));
      publish(state.checkouts);
      if (kind !== null) throw new Error(kind);
    },
    mark(repo, branch, login) {
      const group = groups.get(repo.toLowerCase());
      if (group === undefined) return Promise.resolve({ status: "unknown-repo" });
      return underRepoLock(group.folded, async () => {
        const kind = await fetchDue(group, now(), true);
        if (kind !== null) throw new Error(kind);
        const marked = await tagAndPush(group, branch, login);
        // The step's answer stands whatever the rows do next: a read that fails here holds the
        // group as any failed read does, and is no reason to answer that the tag was not pushed.
        await recompute(group);
        return marked;
      }).finally(() => publish(state.checkouts));
    },
    markPublished(repo, login, head) {
      const group = groups.get(repo.toLowerCase());
      if (group === undefined) return Promise.resolve({ status: "unknown-repo" });
      return underRepoLock(group.folded, async () => {
        const kind = await fetchDue(group, now(), true);
        if (kind !== null) throw new Error(kind);
        const marked = await publishTagAndPush(group, login, head);
        // As in `mark`: the step's answer stands whatever the rows do next.
        await recompute(group);
        return marked;
      }).finally(() => publish(state.checkouts));
    },
    rootOf(repo) {
      return groups.get(repo.toLowerCase())?.bare ?? null;
    },
    async settled() {
      await inFlight;
      return state;
    },
  };
}
