// mid-turn-reprompt.ts: the operator's mid-turn messages, re-prompted as a
// turn of the plugin's own at the turn's end.
//
// A channel message that reaches the session while a turn is running is
// read inside that turn and gets no turn of its own, so the acts that only
// the operator's turn admits, a plan's add among them, are refused where the
// operator asked for them. The harness records such a delivery in the
// session's transcript as a queued_command attachment with the relay's
// origin stamp, a record no text inside a file or a tool result can write;
// docs/persona-security-model.md states the reach of a process that can.
// At an owner turn's end the plugin runs bin/mid-turn-reprompt-scan.mjs over
// that transcript's tail, since a hook reads a file only whole and only
// under 4 MiB, and queues one turn carrying every operator-class message the
// scan took, oldest first. That turn matches a `reprompt` entry, which
// hooks/index.ts reads as the operator's own for the effort gate, the
// autonomy tool and the ask lift.
//
// Dedupe is by time, never by text: the newest record timestamp a queued
// re-prompt covered is kept on the session as repromptCoveredUntil, and a
// record at or before it is never taken again, so the scan's tolerance
// window cannot take a record twice. The operator sending the same words
// again is a new message and is carried again.
//
// The window is carried, never forfeited: repromptWindowFrom holds the start
// of the oldest owner turn whose window has not been read whole. Every owner
// turn end sets it when unset, a reply backstop's and an open turn's
// included, which the drain gate otherwise skips. The scan's stamp is that
// carried start, and only a scan whose every in-window record ended queued,
// none, covered or participant clears it. A refused submit and a failed
// read keep it, so the next owner turn end reads the same records again,
// and the covered timestamp keeps any from being taken twice.
//
// One question splits the read-failed skips into the ones that keep the
// window and the one that clears it: could a later scan ever reach what
// this one missed. A spawn failure, a timeout, a missing transcript and
// output that does not parse each keep it, since the next scan may read
// what this one could not. A scan whose reach stopped short of the carried
// start clears it once what its reach held is queued or none of it is
// fresh, since a transcript only grows and the records before
// the reach's floor are past every later scan too, so a window kept there
// would fail every later turn end and lose every later message. That scan
// still answers what its reach held, which is queued as usual, and its
// read-failed decision names the start it could not reach and the reach's
// floor.
//
// The re-prompts of successive owner turn ends run one after another, on a
// promise chain the session carries as repromptChain. A turn end whose scan
// would overlap an earlier one still in flight starts after that one has
// settled, so it reads the moved covered timestamp and window rather than
// taking the same record twice. A link that throws or is refused settles
// the chain for the next one all the same.
//
// No `import $` and no side effects at load. The engine's loader follows `$`
// only into functions declared in hooks/index.ts and refuses the whole module
// where `$` crosses an import, so this file takes a RepromptHost that
// hooks/index.ts builds over `$`, as the beat and the catalog do.

import type { PluginHost } from "./host";
import { type AgentState, LINE_TERMINATOR, liftAsk, openBlockingAsks } from "./agent-state";
import { launchDirOf } from "./beat";
import { reactivateAskedEntry } from "./plan-route";
import { quoteCarriedLines } from "./operator";
import { scrubText } from "./redactor";
import { RECAP_TIMEOUT_MS } from "./turn-state-text";

// The scan's child process as hooks/index.ts spawns it through runChild,
// with the plugin root the script path is built under and the home its
// transcript root is built under.
export type RepromptHost = Pick<PluginHost, "getHome"> & {
  run(argv: readonly string[], init: { cwd?: string; timeoutMs: number }): Promise<unknown>;
  pluginRoot: string;
};

// The session facts the scan and the dedupe read and write, on the session
// record hooks/index.ts holds. Both re-prompt fields live in memory only:
// after a restart every record of the old session falls before the new
// session's first turn stamp.
export type RepromptSession = {
  mySessionId: string;
  workdir: string;
  // The directory the session was launched in, held across a reload. The scan
  // reads this one: the host keys the transcript folder on the launch
  // directory, while workdir is re-read from wherever the session has moved
  // by a reload. Empty where none is held, and then workdir stands.
  memqLaunchDir: string;
  state: AgentState;
  // The newest record timestamp a queued re-prompt covered, or null where
  // none has been queued this session.
  repromptCoveredUntil: number | null;
  // The start stamp of the oldest owner turn whose window has not been read
  // whole, or null where every window so far was.
  repromptWindowFrom: number | null;
  // Whether the id-pending skip has been logged, which happens once at the
  // first owner turn end of a session whose id never resolved.
  repromptIdPendingLogged: boolean;
  // The settled or in-flight re-prompt of the latest owner turn end, which
  // the next one's starts after. Never rejects.
  repromptChain: Promise<void>;
};

// One message the scan took: the record's timestamp in milliseconds, the
// class the scan read off its tag, and its prompt as the harness recorded it.
export type MidTurnMessage = { at: number; senderClass: "operator"; prompt: string };

// The closed list of reasons a turn end that read the transcript queued no
// re-prompt, as mid_turn_reprompt_skipped carries them.
export type RepromptSkipReason = "participant" | "covered" | "read-failed" | "submit-refused" | "id-pending";

export type RepromptScanOutcome =
  | { kind: "taken"; messages: MidTurnMessage[] }
  | { kind: "skip"; reason: RepromptSkipReason; detail: string }
  | { kind: "none" };

// The first line of the re-prompt turn's text, the plugin's own composing.
// The injection ledger sizes it by name.
export const MID_TURN_REPROMPT_FRAME = "[MID-TURN MESSAGE] These messages reached your thread while your last turn was running, so they got no turn of their own. This turn is theirs: it stands as the operator's, so act on them here as you would on a message that opened a turn. Each message's own lines are quoted below its line.";

// The line that introduces one carried message: a composed line opening `- `
// that names the class the scan read and the record's time, so a reader
// tells it from the carried lines, which open `> `. The injection ledger
// sizes this function's literals.
export function repromptMessageLine(senderClass: "operator", at: number): string {
  return `- ${senderClass} message, recorded ${new Date(at).toISOString()}:`;
}

// The scan's argv: node, the script under the plugin root, then the home,
// the directory the scan keys the transcript folder on, the session id and
// the turn's start stamp. readMidTurnMessages passes the launch directory,
// falling back to the working directory where none is held.
export function repromptScanArgv(pluginRoot: string, home: string, workdir: string, sessionId: string, stamp: number): string[] {
  return ["node", `${pluginRoot}/bin/mid-turn-reprompt-scan.mjs`, home, workdir, sessionId, String(stamp)];
}

// The floor the scan's reach could not get back to, as its closing line
// names it: the window's floor and the stamp of the first record the reach
// held, null where it held no timestamped record.
export type RepromptUnreached = { floor: number; reachFloor: number | null };

export type RepromptScanOutput = { taken: { timestamp: number; prompt: string }[]; participants: number; unreached: RepromptUnreached | null };

// The scan's stdout parsed: one JSON object per line, every line but the
// last a taken record carrying a numeric timestamp and a string prompt, and
// the last the participant count, with the unreached floor beside it where
// the ceiling's reach stopped short. Null where any line fails that shape,
// so a truncated or foreign output reads as a failed read rather than as a
// message.
export function parseRepromptScan(stdout: string): RepromptScanOutput | null {
  const lines = stdout.split(LINE_TERMINATOR).filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;
  const objects: unknown[] = [];
  for (const line of lines) {
    try {
      objects.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  const last = objects[objects.length - 1];
  if (last === null || typeof last !== "object" || Array.isArray(last)) return null;
  const { participants, unreached: unreachedField } = last as { participants?: unknown; unreached?: unknown };
  if (typeof participants !== "number" || !Number.isInteger(participants) || participants < 0) return null;
  let unreached: RepromptUnreached | null = null;
  if (unreachedField !== undefined) {
    if (unreachedField === null || typeof unreachedField !== "object" || Array.isArray(unreachedField)) return null;
    const { floor, reachFloor } = unreachedField as { floor?: unknown; reachFloor?: unknown };
    if (typeof floor !== "number" || !Number.isFinite(floor)) return null;
    if (reachFloor !== null && (typeof reachFloor !== "number" || !Number.isFinite(reachFloor))) return null;
    unreached = { floor, reachFloor: reachFloor as number | null };
  }
  const taken: { timestamp: number; prompt: string }[] = [];
  for (const o of objects.slice(0, -1)) {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
    const { timestamp, prompt } = o as { timestamp?: unknown; prompt?: unknown };
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || typeof prompt !== "string") return null;
    taken.push({ timestamp, prompt });
  }
  return { taken, participants, unreached };
}

// The message's own words: the text between a whole channel envelope's
// opening tag and its closing tag, or the prompt unchanged where it does not
// carry one. The scan took the record on the harness's origin stamp and the
// tag's class, so the tag has done its work and only the words are carried.
export function channelBodyOf(prompt: string): string {
  if (!prompt.startsWith("<channel")) return prompt;
  const open = />\r?\n/.exec(prompt);
  if (open === null) return prompt;
  return prompt.slice(open.index + open[0].length).replace(/<\/channel>\s*$/, "").replace(/\r?\n$/, "");
}

// The re-prompt turn's text before the context blocks frame it: the bracket
// line, then each message oldest first under its composed line, every line
// of its body quoted as carried text. The body has its secrets hidden by the
// same scrub a turn-end answer takes before the plugin re-sends it.
export function repromptText(messages: readonly MidTurnMessage[]): string {
  const lines = [MID_TURN_REPROMPT_FRAME];
  for (const message of messages) {
    lines.push(repromptMessageLine(message.senderClass, message.at));
    lines.push(quoteCarriedLines(scrubText(channelBodyOf(message.prompt)).text));
  }
  return lines.join("\n");
}

function skipped(sess: RepromptSession, reason: RepromptSkipReason, detail: string): void {
  sess.state.decisions.push({
    timestamp: Date.now(),
    loop: "monitor",
    action: "mid_turn_reprompt_skipped",
    detail: `${reason}: ${detail}`.slice(0, 200),
  });
}

// Opens the carried window at an owner turn's end: the closing turn's start
// where no earlier window is still open, else the earlier start stands.
// Called at every owner turn end, before the drain gate decides whether this
// end scans, so a turn end the gate skips still leaves its window for the
// next one that scans.
export function openRepromptWindow(sess: RepromptSession, turnStartedAt: number): void {
  if (sess.repromptWindowFrom === null) sess.repromptWindowFrom = turnStartedAt;
}

// The queued decision, the covered timestamp moved to the newest record the
// re-prompt carries, so the next turn end's scan takes none of them again,
// and the window cleared, since every record in it is now queued or covered.
export function noteRepromptQueued(sess: RepromptSession, messages: readonly MidTurnMessage[]): void {
  const newest = Math.max(...messages.map((m) => m.at));
  sess.repromptCoveredUntil = sess.repromptCoveredUntil === null ? newest : Math.max(sess.repromptCoveredUntil, newest);
  sess.repromptWindowFrom = null;
  sess.state.decisions.push({
    timestamp: Date.now(),
    loop: "monitor",
    action: "mid_turn_reprompt_queued",
    detail: `${messages.length} message(s) re-prompted, recorded at ${messages.map((m) => new Date(m.at).toISOString()).join(", ")}`.slice(0, 200),
  });
}

// The submit-refused skip: the entry has left the list, and neither the
// covered timestamp nor the carried window has moved, so the next owner turn
// end scans from the same start and takes the same records again.
export function noteRepromptRefused(sess: RepromptSession, how: string, reason: string): void {
  skipped(sess, "submit-refused", `${how}: ${reason}`);
}

// Runs one turn end's re-prompt after the previous one has settled, on the
// chain the session carries, and leaves the chain settled whatever this
// link did. The caller awaits the link itself, so its throw is still the
// caller's to log.
export function chainReprompt(sess: RepromptSession, run: () => Promise<void>): Promise<void> {
  const link = sess.repromptChain.then(run);
  sess.repromptChain = link.catch(() => undefined);
  return link;
}

// Reads the transcript tail through the scan and answers what the turn end
// does with it: the messages to carry, oldest first and none at or before
// the covered timestamp; a skip, already pushed as its decision; or nothing,
// where no channel record was in the window. The window's start is the
// carried one, else `turnStartedAt`, the closing turn's own start. A read
// whole, which is none, covered or participant, clears the carried window
// here, and a queued submit clears it in noteRepromptQueued; a read-failed
// skip leaves it, so the next owner turn end scans from the same start.
// The one exception is a scan whose reach stopped short of the start: its
// read-failed decision is pushed here, what the reach held is carried as
// usual, and where it held nothing fresh the window clears here, since no
// later scan reaches further back.
// Never throws: a run that rejects, a non-zero exit and output that does not
// parse are each the read-failed skip. A session whose id is pending names
// no transcript, so it skips with id-pending once and reads nothing after.
export async function readMidTurnMessages(host: RepromptHost, sess: RepromptSession, turnStartedAt: number): Promise<RepromptScanOutcome> {
  const stamp = sess.repromptWindowFrom ?? turnStartedAt;
  if (sess.mySessionId === "pending") {
    if (!sess.repromptIdPendingLogged) {
      sess.repromptIdPendingLogged = true;
      skipped(sess, "id-pending", "the session id never resolved, so no transcript is named; nothing is read this session");
    }
    return { kind: "none" };
  }
  let home: unknown;
  try {
    home = await host.getHome();
  } catch (err) {
    skipped(sess, "read-failed", `home unreadable: ${String(err).slice(0, 150)}`);
    return { kind: "skip", reason: "read-failed", detail: "home unreadable" };
  }
  if (typeof home !== "string" || home === "") {
    skipped(sess, "read-failed", "no home to find the transcript root under");
    return { kind: "skip", reason: "read-failed", detail: "no home" };
  }
  let res: unknown;
  try {
    const scanDir = launchDirOf(sess);
    res = await host.run(repromptScanArgv(host.pluginRoot, home, scanDir, sess.mySessionId, stamp), { cwd: scanDir, timeoutMs: RECAP_TIMEOUT_MS });
  } catch (err) {
    const detail = `run failed: ${String(err).slice(0, 150)}`;
    skipped(sess, "read-failed", detail);
    return { kind: "skip", reason: "read-failed", detail };
  }
  const fields = res !== null && typeof res === "object" ? (res as { exitCode?: unknown; stdout?: unknown; stderr?: unknown }) : {};
  const exitCode = typeof fields.exitCode === "number" ? fields.exitCode : null;
  if (exitCode !== 0) {
    const stderr = typeof fields.stderr === "string" ? fields.stderr : "";
    const firstStderr = (stderr.split(LINE_TERMINATOR).find((line) => line.trim() !== "") ?? "").trim().slice(0, 150);
    const detail = `exit ${exitCode === null ? "unknown" : exitCode}; stderr: ${firstStderr || "none"}`;
    skipped(sess, "read-failed", detail);
    return { kind: "skip", reason: "read-failed", detail };
  }
  const parsed = parseRepromptScan(typeof fields.stdout === "string" ? fields.stdout : "");
  if (parsed === null) {
    const detail = "the scan's output did not parse";
    skipped(sess, "read-failed", detail);
    return { kind: "skip", reason: "read-failed", detail };
  }
  const coveredUntil = sess.repromptCoveredUntil;
  const fresh = parsed.taken.filter((t) => coveredUntil === null || t.timestamp > coveredUntil);
  const covered = parsed.taken.length - fresh.length;
  if (parsed.unreached !== null) {
    const reachFloor = parsed.unreached.reachFloor === null ? "no timestamped record" : new Date(parsed.unreached.reachFloor).toISOString();
    const detail = `the scan's reach stopped short of the window start ${new Date(stamp).toISOString()}; the reach's floor is ${reachFloor}, and no later scan reads before it`;
    skipped(sess, "read-failed", detail);
    if (fresh.length === 0) {
      sess.repromptWindowFrom = null;
      return { kind: "skip", reason: "read-failed", detail };
    }
  }
  if (fresh.length > 0) {
    const messages = fresh
      .map((t): MidTurnMessage => ({ at: t.timestamp, senderClass: "operator", prompt: t.prompt }))
      .sort((a, b) => a.at - b.at);
    return { kind: "taken", messages };
  }
  sess.repromptWindowFrom = null;
  if (covered > 0) {
    const detail = `${covered} record(s) at or before the covered timestamp ${new Date(coveredUntil as number).toISOString()}${parsed.participants > 0 ? `, and ${parsed.participants} participant-class record(s)` : ""}`;
    skipped(sess, "covered", detail);
    return { kind: "skip", reason: "covered", detail };
  }
  if (parsed.participants > 0) {
    const detail = `${parsed.participants} participant-class record(s) in the window, which carry no authority`;
    skipped(sess, "participant", detail);
    return { kind: "skip", reason: "participant", detail };
  }
  return { kind: "none" };
}

// The ask lift the re-prompt turn runs at turn.start, as prompt.submit runs
// it for an operator's own prompt: every open blocking ask lifts, oldest
// first, each lifted node takes the question and the clock, and one
// ask_hold_lifted decision names them. Returns whether anything lifted, so
// the caller knows to persist.
export function liftHeldAsksForReprompt(state: AgentState, liftedAt: number): boolean {
  const held = openBlockingAsks(state).slice().sort((a, b) => a.openedAt - b.openedAt);
  if (held.length === 0) return false;
  for (const entry of held) {
    liftAsk(state, entry.id);
    const liftedNode = state.goals.find((n) => n.id === entry.nodeId);
    if (liftedNode) {
      liftedNode.lastAskQuestion = entry.question;
      liftedNode.lastAskClosedAt = liftedAt;
      reactivateAskedEntry(liftedNode);
    }
  }
  state.decisions.push({
    timestamp: liftedAt,
    loop: "monitor",
    action: "ask_hold_lifted",
    detail: `asks ${held.map((entry) => entry.id).join(", ")} lifted by the operator's mid-turn message, left open`,
  });
  return true;
}
