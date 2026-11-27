// The engine's plugin store, read and written from outside the engine.
//
// The store is one JSON file that every Claude Code session loading the
// persona plugin reads and writes, and it holds the fleet's records, replies,
// asks and claims, which have no other copy. The engine writes it in four
// steps: it makes the empty directory `<store file>.lock`, writes
// `<store file>.tmp.<8 hex digits>`, renames that file over the store file,
// and removes the directory. A writer here takes the same steps, so while no
// writer removes a lock directory another writer holds, the engine and this
// module never write the file at once, and every existing reader keeps
// working unchanged.
//
// A lock directory this module did not make is never removed, whatever its
// age: a write that cannot take the lock inside its wait rejects and writes
// nothing. The only removal is by the write that made the directory, once its
// change is done, or at once where it cannot read the directory's identity.
// Directly after making it, the write reads the directory's own identity, its
// device and inode numbers, and before each attempt to remove it after the
// change reads them again; where the directory is gone or is another one, the
// write stops trying and leaves it standing. Nothing is ever written inside
// the lock directory, so it stays empty while it stands. The read and the
// removal are two calls, so a directory replaced between them is still removed;
// that needs another writer to have broken this write's lock while the write
// held it. A write that cannot read the identity tries the removal once with
// nothing to compare and never again, which leaves the same one-call gap.
// Whether the engine ever removes a held lock it did not make is not known.
//
// The caller always names the store file, as an absolute path, which on
// Windows starts with a drive root or a UNC prefix. No default path is
// computed here, and any other path is refused, so neither a left-out argument
// nor the working directory can point a write at another store.
//
// A set or delete that did not fail resolves with what happened, as
// `{ written, lockReleased }`. `written` is true where the store file was
// replaced, and false where the change wrote nothing, such as a delete of an
// absent key. `lockReleased` is false only where the write's own lock
// directory could not be removed and stays, so every later write waits on it
// until something removes it. A write that landed resolves even then, so a
// caller never reads a landed write as failed and writes it twice; a caller
// reading `lockReleased` false logs it and does not try the write again.
//
// Every refusal a store operation (get, set, delete, keys) makes carries a
// string `code`, so a caller tells the rules apart without reading the message:
//   ESTORELOCKED      another writer holds the lock past the wait
//   ESTORELOCKFAILED  the lock directory could not be made inside the wait
//   ESTORELOCKLEFT    a write failed, or its lock directory's identity could
//                     not be read after it was made, and the directory could
//                     not be removed and stays
//   ESTORENOTJSON     a value set is not JSON data
//   ESTOREPARSE       the store's text does not parse, or is not an object
//   ESTORESIZE        the store would pass the engine's 4 MiB bound
// Under ESTORELOCKLEFT the write's own error, or the identity read's, is on
// `err.cause`, and its code on `err.cause.code`.
// A file-system error passed on unchanged keeps node's own code.

import { lstat, mkdir, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import type { CommonsStore } from "../hooks/commons";

// How long a write waits for a lock another writer holds, and how often it
// tries again. The engine holds its lock for milliseconds.
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 25;

// A file step that another process's open handle interrupts is tried again
// this many times, this far apart: the read of the store and the rename over
// it. The read of the lock directory's identity, and the removal of a
// directory whose identity was read, keep trying until the write's deadline
// passes, and never for fewer tries than these. Windows reports a file or
// directory another process holds open, or one in the middle of a
// rename-over, as one of these codes.
const BUSY_RETRIES = 10;
const BUSY_RETRY_MS = 20;
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

// The engine's own bound: it rejects a store over 4 MiB of JSON text in all
// (the store's declaration in .claude/types/claude-code.d.ts). Counted in
// bytes of the UTF-8 text written.
const MAX_STORE_BYTES = 4 * 1024 * 1024;

const LOCKED = "the shared store is locked by another writer; nothing was written";

// A Windows path that names its own root: a drive root, `C:\` or `C:/`, or a
// UNC prefix of two separators.
const WIN32_ROOTED = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/;

type StoreObject = Record<string, unknown>;

export interface FileStoreOptions {
  // The lock wait in milliseconds, for tests that must not wait out the
  // default. Production callers leave it out.
  lockWaitMs?: number;
}

// What a set or delete did: whether it replaced the store file, and whether
// its lock directory is gone.
export interface FileStoreWriteResult {
  written: boolean;
  lockReleased: boolean;
}

// The engine's $.store shape for reads, with set and delete resolving with
// what the write did.
export interface FileStore extends Pick<CommonsStore, "get" | "keys"> {
  set(key: string, value: unknown): Promise<FileStoreWriteResult>;
  delete(key: string): Promise<FileStoreWriteResult>;
}

// A lock directory's identity, read with bigint numbers so a 64-bit inode
// number compares exactly.
interface LockIdentity {
  dev: bigint;
  ino: bigint;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const codeOf = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code;
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

// An error naming the rule that refused, by its code.
function refusal(code: string, message: string, cause?: unknown): Error & { code: string } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

// Runs the step, and runs it again while it fails with a busy code, up to
// BUSY_RETRIES more times. Any other failure, or the last busy one, rejects
// with the step's own error.
async function retryWhileBusy<T>(step: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await step();
    } catch (err) {
      const code = codeOf(err);
      if (code === undefined || !BUSY_CODES.has(code) || retry >= BUSY_RETRIES) throw err;
      await sleep(BUSY_RETRY_MS);
    }
  }
}

// The file's text, or null where there is no file.
async function readStoreText(file: string): Promise<string | null> {
  try {
    return await retryWhileBusy(() => readFile(file, "utf8"));
  } catch (err) {
    if (codeOf(err) === "ENOENT") return null;
    throw err;
  }
}

// The store as an object. An absent file is an empty store; any text that is
// not a JSON object rejects, so no write ever replaces records it could not
// read.
function parseStore(text: string | null, file: string): StoreObject {
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw refusal("ESTOREPARSE", `the shared store ${file} does not parse as JSON: ${messageOf(err)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw refusal("ESTOREPARSE", `the shared store ${file} does not hold a JSON object`);
  }
  return parsed as StoreObject;
}

async function readStore(file: string): Promise<StoreObject> {
  return parseStore(await readStoreText(file), file);
}

// The codes a lock directory another writer holds draws from mkdir: EEXIST
// while it stands, and EPERM on Windows while that writer is removing it.
const HELD_CODES = new Set(["EEXIST", "EPERM"]);

// Makes the lock directory, trying again while another writer holds it, and
// rejects once the deadline passes. The directory is made non-recursively, so
// one that exists is never taken over. Where the last attempt drew EEXIST the
// lock is held and the rejection says so; where it drew EPERM the directory
// could not be made for a reason this module cannot tell from a held lock, and
// the rejection names that code.
async function takeLock(lock: string, deadline: number): Promise<void> {
  for (;;) {
    try {
      await mkdir(lock);
      return;
    } catch (err) {
      const code = codeOf(err);
      if (code === undefined || !HELD_CODES.has(code)) throw err;
      if (performance.now() >= deadline) {
        if (code === "EEXIST") throw refusal("ESTORELOCKED", LOCKED);
        throw refusal("ESTORELOCKFAILED", `the lock directory ${lock} could not be made inside the wait (${code}); nothing was written`, err);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

// Writes the text to a fresh temporary file beside the store and renames it
// over the store file. The temporary name is created exclusively, so a name
// already on disk is neither overwritten nor removed; once this writer has
// created it, any failure removes it before rejecting. A rename a reader's
// open handle blocks is tried again before it counts as a failure.
async function replaceFile(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp.${randomBytes(4).toString("hex")}`;
  const handle = await open(tmp, "wx");
  try {
    try {
      await handle.writeFile(text, "utf8");
    } finally {
      await handle.close();
    }
    await retryWhileBusy(() => rename(tmp, file));
  } catch (err) {
    // The error that stopped the write is the one reported; a removal that
    // fails as well leaves nothing more to tell.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

// Runs the step, and runs it again while it fails with a busy code,
// BUSY_RETRY_MS apart, until the deadline has passed and at least
// BUSY_RETRIES more times, so a write that took the lock late still gets its
// retries. Any other failure, or the last busy one, rejects with the step's
// own error.
async function retryWhileBusyUntil<T>(step: () => Promise<T>, deadline: number): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await step();
    } catch (err) {
      const code = codeOf(err);
      if (code === undefined || !BUSY_CODES.has(code) || (retry >= BUSY_RETRIES && performance.now() >= deadline)) throw err;
      await sleep(BUSY_RETRY_MS);
    }
  }
}

// The lock directory's identity, read again while busy under the deadline.
async function lockIdentity(lock: string, deadline: number): Promise<LockIdentity> {
  const stats = await retryWhileBusyUntil(() => lstat(lock, { bigint: true }), deadline);
  return { dev: stats.dev, ino: stats.ino };
}

type Release = { released: true } | { released: false; error: unknown };

// Removes the lock directory this write made. Where its identity is known,
// each attempt reads the directory's identity again first, and where the
// directory is not the one made, it stops and leaves whatever stands there,
// since a directory made again belongs to another writer; a read or removal
// that fails busy is tried again under the deadline, as retryWhileBusyUntil
// states. Where the identity is null, the removal is tried once with nothing
// to compare and never again, since a later try could remove a lock another
// writer made after this one went. A lock that is gone, or is another
// writer's, is released as far as this write goes. Any other failure, or the
// last busy one, leaves the lock standing, and the result carries that error.
async function releaseLock(lock: string, made: LockIdentity | null, deadline: number): Promise<Release> {
  try {
    if (made === null) {
      await rmdir(lock);
      return { released: true };
    }
    await retryWhileBusyUntil(async () => {
      const now = await lstat(lock, { bigint: true });
      if (now.dev !== made.dev || now.ino !== made.ino) return;
      await rmdir(lock);
    }, deadline);
    return { released: true };
  } catch (err) {
    if (codeOf(err) === "ENOENT") return { released: true };
    return { released: false, error: err };
  }
}

// One write: under the lock, read the store again, apply the change, and
// replace the file. A change returning false writes nothing.
//
// One deadline, counted from the moment the write begins, bounds the wait for
// the lock, the read of the directory's identity and the removal of the
// directory; the read, and the removal of a directory whose identity was
// read, each still get at least BUSY_RETRIES busy retries where it has passed. The read of the store and the rename each
// retry a busy failure up to BUSY_RETRIES times whatever the deadline, so a
// write can hold the lock past its deadline by those retries, the floors of
// the identity read and the removal, and the time the file system takes.
// Where the removal still fails, the lock stays, since this module removes no
// lock on a later call, and every later write waits on it. A write that did
// not fail resolves with `{ written, lockReleased }` either way. A write that
// failed rejects with its own error where its lock was released, and with
// ESTORELOCKLEFT carrying its own message and its error as the cause where
// the lock stays.
//
// Where the directory's identity cannot be read after it is made, nothing is
// written. A directory already gone rejects with the read's own error. One
// still standing gets one removal with nothing to compare, since this write
// made it one call earlier, and no retry, busy or not; the write then rejects
// with the read's own error where the directory is gone, and with
// ESTORELOCKLEFT carrying the read's error as the cause where it stays.
async function writeStore(file: string, waitMs: number, change: (store: StoreObject) => boolean): Promise<FileStoreWriteResult> {
  const lock = `${file}.lock`;
  // A monotonic clock, so a change to the system time cannot cut or stretch
  // the deadline.
  const deadline = performance.now() + waitMs;
  await takeLock(lock, deadline);
  let made: LockIdentity;
  try {
    made = await lockIdentity(lock, deadline);
  } catch (err) {
    if (codeOf(err) === "ENOENT") throw err;
    const release = await releaseLock(lock, null, deadline);
    if (release.released) throw err;
    const removal = codeOf(release.error) ?? messageOf(release.error);
    throw refusal("ESTORELOCKLEFT", `the lock directory ${lock} could not be read after it was made (${codeOf(err) ?? messageOf(err)}); nothing was written, and the directory was left behind, since it could not be removed (${removal})`, err);
  }
  let failed = false;
  let writeError: unknown;
  let written = false;
  try {
    const store = await readStore(file);
    if (change(store)) {
      // The engine's form: two-space indentation and one closing newline.
      const text = JSON.stringify(store, null, 2) + "\n";
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > MAX_STORE_BYTES) {
        throw refusal("ESTORESIZE", `the shared store ${file} would hold ${bytes} bytes, over the engine's bound of 4,194,304; nothing was written`);
      }
      await replaceFile(file, text);
      written = true;
    }
  } catch (err) {
    failed = true;
    writeError = err;
  }
  const release = await releaseLock(lock, made, deadline);
  if (failed) {
    if (release.released) throw writeError;
    const removal = codeOf(release.error) ?? messageOf(release.error);
    throw refusal("ESTORELOCKLEFT", `${messageOf(writeError)}; and its lock directory ${lock} was left behind, since it could not be removed (${removal})`, writeError);
  }
  return { written, lockReleased: release.released };
}

// The store in the file the caller names: the engine's $.store shape, with
// set and delete resolving with what the write did.
export function fileStoreOf(file: string, options: FileStoreOptions = {}): FileStore {
  if (typeof file !== "string" || file === "") throw new TypeError("fileStoreOf takes the store file's path, and was given none");
  // A relative path would resolve against whatever working directory the
  // host chose, and an absent file there reads as an empty store, so a write
  // would silently start a second store. On Windows a path such as
  // \Users\x\store.json passes isAbsolute but takes the working directory's
  // drive, so there the path must also start with a drive root or a UNC prefix.
  if (!isAbsolute(file) || (process.platform === "win32" && !WIN32_ROOTED.test(file))) throw new TypeError(`fileStoreOf takes an absolute store file path, and was given ${JSON.stringify(file)}`);
  const { lockWaitMs } = options;
  if (lockWaitMs !== undefined && !(Number.isFinite(lockWaitMs) && lockWaitMs >= 0)) {
    throw new TypeError(`fileStoreOf takes a lockWaitMs that is a finite number of 0 or more, and was given ${String(lockWaitMs)}`);
  }
  const waitMs = lockWaitMs ?? LOCK_WAIT_MS;
  return {
    async get(key) {
      const store = await readStore(file);
      return Object.hasOwn(store, key) ? store[key] : undefined;
    },
    // The value is serialized once, at the call, and what is stored is that
    // text parsed back, which is what the engine's get reads back for a set
    // value (the store's set declaration in .claude/types/claude-code.d.ts).
    // So a caller changing the object while the write waits on the lock cannot
    // change what is written. A value JSON cannot carry rejects before the
    // lock is taken, as the engine's set rejects a function: JSON.stringify
    // returns undefined for undefined, a function or a symbol, and throws on a
    // cycle or a BigInt.
    async set(key, value) {
      let text: string | undefined;
      try {
        text = JSON.stringify(value);
      } catch (err) {
        throw refusal("ESTORENOTJSON", `the value for key ${JSON.stringify(key)} is not JSON data (${messageOf(err)}); nothing was written`, err);
      }
      if (text === undefined) {
        throw refusal("ESTORENOTJSON", `the value for key ${JSON.stringify(key)} is not JSON data (undefined, a function or a symbol); nothing was written`);
      }
      const data: unknown = JSON.parse(text);
      return writeStore(file, waitMs, (store) => {
        // Defined rather than assigned, so a key such as __proto__ is stored
        // as data. An existing key keeps its place; a new one goes last,
        // except a key shaped like an array index, such as "7", which
        // JavaScript orders before every other key, in ascending order.
        Object.defineProperty(store, key, { value: data, enumerable: true, writable: true, configurable: true });
        return true;
      });
    },
    // A key that is absent writes nothing, and resolves `written` false.
    async delete(key) {
      return writeStore(file, waitMs, (store) => Object.hasOwn(store, key) && delete store[key]);
    },
    async keys() {
      return Object.keys(await readStore(file));
    },
  };
}
