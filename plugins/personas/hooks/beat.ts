// beat.ts: one instant for every liveness file. stampBeat takes the instant
// its caller read and writes the four files a session's liveness is read
// from, each stamped with that one time: the sidecar heartbeat the claim at
// session start and a reader's promotion check read, the supervisor's own
// heartbeat file where the launcher named one, the session's commons entry,
// and the meter beat file `memq meter-drain` carries to the memory database.
// The heartbeat tick, turn.start and turn.complete each call it once, so a
// reader comparing two of the files never finds them a tick apart.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts and refuses the whole module
// where `$` crosses an import, so this file takes a BeatHost that
// hooks/index.ts builds over `$`, as the seam and the catalog do.
//
// Each write is its own act with its own catch. A file that cannot be
// written costs that file alone and never the other three, and nothing here
// throws into a tick or a turn handler. The claim writes are not here: a
// claim is an act of taking a persona, not a beat, and hooks/index.ts keeps
// writeClaimDirect and the claim refreshes as they are.

import type { PluginHost } from "./host";
import { commonsKey, type CommonsEntry, type CommonsStore } from "./commons";
import { METER_DIR, meterBeatText } from "./cost-ledger";
import { segment } from "./decision-journal";

// One persona's entry in the heartbeat sidecar. turnStartedAt is the owner's
// clock at turn.start while a turn runs and null between turns: a reader
// session in the same work directory reads it to tell a sender how long the
// owner's turn has held their pending record.
export type HeartbeatEntry = { sessionId: string; epoch: number; lastSeen: number; turnStartedAt?: number | null };

// What the beat needs from the host: the three file calls and the home for
// the sidecar, the supervisor file and the meter folder; the commons store;
// and the meter's own bounded write and its failure decision, which stay in
// hooks/index.ts because the turn line shares them.
export type BeatHost = Pick<PluginHost, "readFile" | "writeFile" | "fileExists" | "getHome"> & {
  // hooks/index.ts's commonsStoreOf over `$`.
  store: CommonsStore;
  // One whole-file meter write bounded at the meter's own timeout. Resolves
  // null once the write finished within the bound, or the failure reason the
  // meter's decision carries; it never rejects. `onWriteSettled` runs when
  // the engine's write itself settles, which may be after the bound answered.
  writeMeterFile(file: string, text: string, onWriteSettled: () => void): Promise<string | null>;
  // The meter's once-a-day failure decision, cause write.
  meterFailed(reason: string): void;
};

// The session facts every liveness file carries, and the meter beat's own
// in-flight flag and last turn id, read and written on the session record
// hooks/index.ts holds.
export type BeatSession = {
  persona: string;
  mySessionId: string;
  myEpoch: number;
  isOwner: boolean;
  turnStartedAt: number | null;
  workdir: string;
  meterBeatInFlight: boolean;
  meterLastTurnId: string;
};

// Where the sidecar and the supervisor file sit: the sidecar path the
// session resolved, and the supervisor's path, or "" where no launcher named
// one or where the caller has already written it from the same instant.
export type BeatFiles = { sidecarPath: string; supervisorPath: string };

// Whether a session id can key a metered row. "pending" is the placeholder
// before $.session.id answers, and every session sharing it would collide.
export function meterSessionKnown(sessionId: string): boolean {
  return typeof sessionId === "string" && sessionId.length > 0 && sessionId !== "pending";
}

// The spool folder under the home the host names, or null where it names
// none.
export async function meterDirOf(host: Pick<PluginHost, "getHome">): Promise<string | null> {
  let home: unknown;
  try {
    home = await host.getHome();
  } catch {
    home = undefined;
  }
  if (typeof home !== "string" || home.trim().length === 0) return null;
  return `${home.trim().replace(/[/\\]+$/, "")}/${METER_DIR}`;
}

// The session's beat file name in the spool folder. The session id passes
// through the decision journal's segment guard, the one place an id becomes
// part of a path under the home.
export function meterBeatFileName(sessionId: string): string {
  return `beat-${segment(sessionId)}.json`;
}

// The sidecar's whole-file read-modify-write of this persona's entry. The
// sidecar has no lock, and every persona launched in one working directory
// reads the whole file, sets its own entry and writes the whole file back.
// Two such writes landing together each revert the other's entry. So the
// write is read back, and where this session's entry is missing, or still
// names this session with a lastSeen other than the one just written, it is
// written once more over what the read returned, at the same instant. That
// recovers the lost update, and the second write lands later than the
// colliding one did. An entry naming another session is left alone: that is
// a takeover, and the heartbeat tick's ownership check is what answers it.
async function writeSidecar(host: BeatHost, sess: BeatSession, path: string, at: number): Promise<void> {
  const hb: Record<string, HeartbeatEntry> =
    await host.fileExists(path)
      ? (JSON.parse(await host.readFile(path)) as Record<string, HeartbeatEntry>)
      : {};
  const entry: HeartbeatEntry = { sessionId: sess.mySessionId, epoch: sess.myEpoch, lastSeen: at, turnStartedAt: sess.turnStartedAt };
  hb[sess.persona] = entry;
  await host.writeFile(path, JSON.stringify(hb, null, 2));
  let after: Record<string, HeartbeatEntry> | null = null;
  try {
    const parsed: unknown = await host.fileExists(path) ? JSON.parse(await host.readFile(path)) : {};
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) after = parsed as Record<string, HeartbeatEntry>;
  } catch { /* the read-back failed; the write above stands */ }
  if (after === null) return;
  const mine = after[sess.persona];
  const lost = mine === undefined || mine === null || (mine.sessionId === sess.mySessionId && mine.lastSeen !== at);
  if (!lost) return;
  after[sess.persona] = { ...entry };
  await host.writeFile(path, JSON.stringify(after, null, 2));
}

// The supervisor's heartbeat file, which only this session writes:
// { sessionId, lastSeen, turnStartedAt }. bin/supervise-poll.mjs reads
// exactly those field names and checks sessionId against the child it
// launched. The file has one writer, so it is written whole with no read,
// merge or lock. Exported for the heartbeat tick, which writes it as its
// first act from the tick's instant, ahead of any store read, and then hands
// stampBeat no supervisor path; the write's catch is the caller's, as it is
// inside stampBeat.
export async function stampSupervisorFile(host: Pick<BeatHost, "writeFile">, sess: Pick<BeatSession, "mySessionId" | "turnStartedAt">, at: number, path: string): Promise<void> {
  await host.writeFile(path, JSON.stringify({ sessionId: sess.mySessionId, lastSeen: at, turnStartedAt: sess.turnStartedAt }));
}

// The session's own commons entry: its turn state and workdir stamped onto
// it and its lastSeen refreshed, its claims left as they are. Creates the
// entry with no claims when absent. One process writes this key, but the
// claim writes in hooks/commons.ts and this stamp each read-modify-write it
// across an await, ordered by the event loop rather than by a lock.
async function stampCommons(store: CommonsStore, sess: BeatSession, at: number): Promise<void> {
  const key = commonsKey(sess.mySessionId);
  const raw = await store.get(key);
  const existing: CommonsEntry = raw
    ? (raw as CommonsEntry)
    : { sessionId: sess.mySessionId, lastSeen: at, claims: [], turnStartedAt: null, workdir: "" };
  existing.turnStartedAt = sess.turnStartedAt;
  existing.workdir = sess.workdir;
  existing.lastSeen = at;
  await store.set(key, existing);
}

// Rewrites this session's meter beat file. At most one beat write is in
// flight: a beat asked for while the engine's write of an earlier one has
// not settled is dropped, and the next call writes once that write settles.
// The flag is read and set before the first await on the write, and cleared
// only when the engine's write itself settles, never when the bound answers
// the caller first, so a write that stalls holds back every later beat
// rather than gaining a new write each call. The write is one whole-file
// write, since $.fs has no rename. Never throws.
async function writeMeterBeat(host: BeatHost, sess: BeatSession, at: number): Promise<void> {
  if (!meterSessionKnown(sess.mySessionId) || sess.meterBeatInFlight) return;
  const dir = await meterDirOf(host);
  if (dir === null) {
    host.meterFailed("no home directory, so the beat was not written");
    return;
  }
  // Read again past the home read, where an earlier call can have started
  // its write.
  if (sess.meterBeatInFlight) return;
  sess.meterBeatInFlight = true;
  let started = false;
  try {
    const file = `${dir}/${meterBeatFileName(sess.mySessionId)}`;
    const text = meterBeatText({
      sessionId: sess.mySessionId,
      persona: sess.persona,
      cwd: sess.workdir,
      beatAt: at,
      lastTurnId: sess.meterLastTurnId.length > 0 ? sess.meterLastTurnId : null,
      turnOpen: sess.turnStartedAt !== null,
    });
    started = true;
    const failure = await host.writeMeterFile(file, text, () => {
      sess.meterBeatInFlight = false;
    });
    if (failure !== null) host.meterFailed(failure);
  } catch {
    // A throw before the write started leaves no write to clear the flag.
    if (!started) sess.meterBeatInFlight = false;
    host.meterFailed("the beat file was not written: its text could not be built");
  }
}

// Stamps every liveness file from the one instant `at`. The supervisor file
// first, where a path is set, since it is what the supervisor reads for
// liveness; then the sidecar, for the owner alone, since a reader stamping
// it would mask the holder's staleness and make its own promotion check
// compare the holder to itself; then the commons entry, owner or reader; then
// the meter beat, whose write is bounded by the host's own meter timeout and
// never rejects, so a spool that stalls holds a caller for that bound at
// most, once: a beat asked for while that write is still pending is dropped
// and waits for nothing. Every write has landed, or given up, when this
// resolves, so a caller's later writes never race a stamp of its own. The
// beat file's `turnOpen` reads the open turn off `turnStartedAt`, which the
// caller derives before stamping.
export async function stampBeat(host: BeatHost, sess: BeatSession, at: number, files: BeatFiles): Promise<void> {
  if (files.supervisorPath !== "") {
    try { await stampSupervisorFile(host, sess, at, files.supervisorPath); } catch { /* the supervisor file was not written; the other files still are */ }
  }
  if (sess.isOwner) {
    try { await writeSidecar(host, sess, files.sidecarPath, at); } catch { /* the sidecar was not written; the other files still are */ }
  }
  try { await stampCommons(host.store, sess, at); } catch { /* the commons entry was not written; the other files still are */ }
  await writeMeterBeat(host, sess, at);
}
